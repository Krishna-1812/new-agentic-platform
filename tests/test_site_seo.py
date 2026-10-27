"""What search engines and AI assistants read about the public site (site_seo.py).

Every page search engines may list is in the sitemap, allowed by robots.txt, listed under one address, and
carries a title, a description and structured data that agree with what the page shows. llms.txt and
llms-full.txt summarise the site for AI assistants from the same content. Pages that must stay out of
results (the previous site, the sign-in page, a missing page, the GitHub Pages copy) say noindex where a
crawler can read it.
"""

import html as html_lib
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from unittest.mock import patch

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import app as appmod  # noqa: E402
import site_pages  # noqa: E402
import site_seo  # noqa: E402

SITE = appmod.SITE_URL
PAGES = [path for path, _page in site_seo.pages()]


@pytest.fixture
def client():
    return appmod.app.test_client()


def _html(client, path):
    r = client.get(path)
    assert r.status_code == 200, path
    return r.get_data(as_text=True)


def _text(html):
    html = re.sub(r"(?s)<(script|style)[^>]*>.*?</\1>", " ", html)
    return re.sub(r"\s+", " ", html_lib.unescape(re.sub(r"<[^>]+>", " ", html)))


def _schema(html):
    found = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    assert len(found) == 1
    return json.loads(found[0])


def _nodes(html, kind):
    return [n for n in _schema(html)["@graph"] if kind == n["@type"] or kind in n["@type"]]


def _robots_allows(body, path):
    """robots.txt's own rule for this file: the longest matching Allow or Disallow wins."""
    best, allowed = -1, True
    for line in body.splitlines():
        if ":" not in line:
            continue
        rule, value = (x.strip() for x in line.split(":", 1))
        if rule not in ("Allow", "Disallow"):
            continue
        hit = path == value[:-1] if value.endswith("$") else path.startswith(value)
        if hit and len(value) > best:
            best, allowed = len(value), rule == "Allow"
    return allowed


# ── Crawling and the sitemap ──────────────────────────────────────────────────────

def test_the_sitemap_lists_every_page_of_the_site_and_nothing_else(client):
    r = client.get("/sitemap.xml")
    assert r.status_code == 200 and r.content_type.startswith("application/xml")
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    root = ET.fromstring(r.get_data())
    locs = [u.find("s:loc", ns).text for u in root.findall("s:url", ns)]
    assert locs == [SITE + path for path in PAGES]
    assert len(set(locs)) == len(locs)
    for p in site_pages.PLAYS:
        assert SITE + "/plays/" + p["slug"] in locs
    for i in site_pages.INDUSTRIES:
        assert SITE + "/industries/" + i["slug"] in locs
    assert not any("old-site" in loc or "/login" in loc for loc in locs)
    for u in root.findall("s:url", ns):
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", u.find("s:lastmod", ns).text)


def test_the_legal_pages_are_dated_by_their_own_last_change(client):
    body = client.get("/sitemap.xml").get_data(as_text=True)
    from datetime import datetime
    legal = datetime.strptime(appmod.LEGAL_UPDATED, "%d %B %Y").strftime("%Y-%m-%d")
    assert "<loc>%s/privacy</loc><lastmod>%s</lastmod>" % (SITE, legal) in body
    assert "<loc>%s/pricing</loc><lastmod>%s</lastmod>" % (SITE, site_seo.UPDATED) in body


@pytest.mark.parametrize("path", PAGES)
def test_every_listed_page_opens_and_robots_lets_it_be_read(client, path):
    _html(client, path)
    assert _robots_allows(client.get("/robots.txt").get_data(as_text=True), path), path


def test_robots_points_at_the_sitemap_and_lets_ai_assistants_read_the_summaries(client):
    body = client.get("/robots.txt").get_data(as_text=True)
    assert "Sitemap: %s/sitemap.xml" % SITE in body.splitlines()
    for path in ("/sitemap.xml", "/llms.txt", "/llms-full.txt", "/static/css/press.css", "/static/og-site.png"):
        assert _robots_allows(body, path), path
    # One group for every crawler, AI assistants' included: a separate group for one of them would
    # replace these rules for it rather than add to them.
    assert body.count("User-agent:") == 1 and "User-agent: *" in body
    for private in ("/hub", "/admin", "/api/demo-request", "/abm-signal-tracker", "/app"):
        assert not _robots_allows(body, private), private


# ── Each page ───────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", PAGES)
def test_every_page_is_listed_under_one_address_with_a_title_and_a_description(client, path):
    html = _html(client, path)
    assert re.findall(r'<link rel="canonical" href="([^"]+)">', html) == [SITE + path]
    assert ('<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, '
            'max-video-preview:-1">') in html
    title = html_lib.unescape(re.search(r"<title>(.*?)</title>", html).group(1))
    description = html_lib.unescape(re.search(r'<meta name="description" content="([^"]*)">', html).group(1))
    assert title.endswith(appmod.BRAND["name"]) or title.startswith(appmod.BRAND["name"]), title
    assert 20 <= len(title) <= 80, title
    assert 40 <= len(description) <= 170, (path, len(description))
    assert len(re.findall(r"<h1[\s>]", html)) == 1
    # The share card and the page agree on what the page is called.
    assert '<meta property="og:title" content="%s">' % html_lib.escape(title, quote=True).replace("&#x27;", "&#39;") in html
    assert '<meta property="og:url" content="%s">' % (SITE + path) in html


def test_no_two_pages_share_a_title_or_a_description(client):
    titles, descriptions = {}, {}
    for path in PAGES:
        html = _html(client, path)
        titles.setdefault(re.search(r"<title>(.*?)</title>", html).group(1), []).append(path)
        descriptions.setdefault(re.search(r'name="description" content="([^"]*)"', html).group(1), []).append(path)
    assert all(len(v) == 1 for v in titles.values()), [v for v in titles.values() if len(v) > 1]
    assert all(len(v) == 1 for v in descriptions.values()), [v for v in descriptions.values() if len(v) > 1]


def test_a_query_string_never_makes_a_second_address(client):
    html = _html(client, "/book?for=performance")
    assert '<link rel="canonical" href="%s/book">' % SITE in html


def test_every_play_and_industry_has_its_own_search_title():
    assert set(site_seo.PLAY_TITLES) == set(site_pages.PLAYS_BY_SLUG)
    assert set(site_seo.INDUSTRY_META) == set(site_pages.INDUSTRIES_BY_SLUG)
    for title, description in site_seo.INDUSTRY_META.values():
        assert len(title) <= 60 and 100 <= len(description) <= 160, title


# ── Structured data ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", PAGES)
def test_every_page_says_who_we_are_and_where_it_sits(client, path):
    html = _html(client, path)
    graph = _schema(html)
    assert graph["@context"] == "https://schema.org"
    org = _nodes(html, "Organization")[0]
    assert org["name"] == appmod.BRAND["name"] and org["url"] == SITE + "/"
    assert org["logo"]["url"] == SITE + "/static/logo.png"
    assert _nodes(html, "WebSite")[0]["publisher"] == {"@id": org["@id"]}
    page = next(n for n in graph["@graph"] if n.get("@id") == SITE + path + "#webpage")
    assert page["url"] == SITE + path and page["dateModified"] == site_seo.UPDATED
    assert page["name"] == html_lib.unescape(re.search(r"<title>(.*?)</title>", html).group(1))
    if path == "/":
        assert not _nodes(html, "BreadcrumbList")
    else:
        crumbs = _nodes(html, "BreadcrumbList")[0]["itemListElement"]
        assert crumbs[0]["item"] == SITE + "/" and crumbs[-1]["item"] == SITE + path
        assert [c["position"] for c in crumbs] == list(range(1, len(crumbs) + 1))


@pytest.mark.parametrize("path", PAGES)
def test_the_questions_marked_up_are_the_questions_on_the_page(client, path):
    """FAQ markup must match what a visitor sees, word for word, and cover every question shown."""
    html = _html(client, path)
    shown = [html_lib.unescape(q) for q in re.findall(r"<summary>(.*?)</summary>", html)]
    page = next(n for n in _schema(html)["@graph"] if n.get("@id", "").endswith("#webpage"))
    marked = page.get("mainEntity") if isinstance(page.get("mainEntity"), list) else []
    assert [q["name"] for q in marked] == shown, path
    assert ("FAQPage" in page["@type"]) == bool(shown)
    text = _text(html)
    for q in marked:
        assert q["acceptedAnswer"]["text"] in text, q["name"]


def test_the_price_in_the_markup_is_the_price_on_the_page(client):
    fee = int(site_pages.GTM_FEE.strip("$").replace(",", ""))
    for path in ("/", "/gtm-engineering", "/pricing"):
        html = _html(client, path)
        service = next(n for n in _nodes(html, "Service") if n["name"] == "GTM Engineering")
        assert service["offers"]["price"] == fee and service["offers"]["priceCurrency"] == "USD"
        assert service["offers"]["priceSpecification"]["unitCode"] == "MON"
        assert site_pages.GTM_FEE + " a month" in _text(html)
    perf = _html(client, "/performance-marketing")
    service = next(n for n in _nodes(perf, "Service") if n["name"] == "Performance Marketing")
    assert service["offers"]["price"] == 0 and "free account audit" in _text(perf).lower()


def test_the_lists_of_plays_and_industries_are_marked_up_as_lists(client):
    for path, links in (("/plays", site_pages.PLAY_LINKS), ("/industries", site_pages.INDUSTRY_LINKS)):
        items = _nodes(_html(client, path), "ItemList")[0]["itemListElement"]
        assert [i["url"] for i in items] == [SITE + href for href, _name in links]


def test_the_plain_questions_come_first_where_people_land():
    assert site_pages.FAQ_HOME[0][0] == "What does %s do?" % appmod.BRAND["name"]
    assert site_pages.FAQ_GTM[0][0] == "What is GTM engineering?"
    assert site_pages.FAQ_PERFORMANCE[0][0] == "What is performance marketing?"
    for q, a in site_pages.FAQ_HOME + site_pages.FAQ_GTM + site_pages.FAQ_PERFORMANCE:
        assert q.endswith("?") and a.endswith(".") and len(a) <= 400, q


# ── Search Console and Bing Webmaster Tools ───────────────────────────────────────

@pytest.mark.parametrize("value,expected", [
    ("abcDEF123_-xyz", "abcDEF123_-xyz"),
    ('<meta name="google-site-verification" content="abcDEF123_-xyz" />', "abcDEF123_-xyz"),
    ("  abcDEF123  ", "abcDEF123"),
    ('"><script>alert(1)</script>', ""),
    ("", ""),
])
def test_a_verification_code_from_railway_is_kept_only_when_it_looks_like_one(value, expected):
    with patch.dict(os.environ, {"GOOGLE_SITE_VERIFICATION": value}):
        assert appmod._verification_code("GOOGLE_SITE_VERIFICATION") == expected


def test_the_verification_tags_appear_once_their_codes_are_set(client):
    with patch.dict(os.environ, {"GOOGLE_SITE_VERIFICATION": "", "BING_SITE_VERIFICATION": ""}):
        html = _html(client, "/")
        assert "google-site-verification" not in html and "msvalidate.01" not in html
    with patch.dict(os.environ, {"GOOGLE_SITE_VERIFICATION": "g00gleCode_1", "BING_SITE_VERIFICATION": "B1NGC0DE"}):
        html = _html(client, "/")
        assert '<meta name="google-site-verification" content="g00gleCode_1">' in html
        assert '<meta name="msvalidate.01" content="B1NGC0DE">' in html


# ── AI assistants ────────────────────────────────────────────────────────────────

def test_llms_txt_summarises_the_site_with_a_link_to_every_page(client):
    r = client.get("/llms.txt")
    assert r.status_code == 200 and r.content_type == "text/plain; charset=utf-8"
    body = r.get_data(as_text=True)
    assert body.startswith("# %s\n\n> %s\n" % (appmod.BRAND["name"], site_seo.SUMMARY))
    links = set(re.findall(r"\]\((%s[^)]*)\)" % re.escape(SITE), body))
    for path in PAGES:
        assert SITE + path in links or path == "/", path
    assert SITE + "/llms-full.txt" in links
    assert site_pages.GTM_FEE in body and "&amp;" not in body and "&rsquo;" not in body


def test_llms_full_txt_carries_every_play_industry_question_and_the_price(client):
    r = client.get("/llms-full.txt")
    assert r.status_code == 200 and r.content_type == "text/plain; charset=utf-8"
    body = r.get_data(as_text=True)
    for p in site_pages.PLAYS:
        assert "### " + p["name"] in body and p["finds"] in body and p["message"] in body
    for i in site_pages.INDUSTRIES:
        assert "### " + i["name"] in body and i["lead"] in body
    for q, a in site_pages.FAQ_GTM + site_pages.FAQ_PERFORMANCE + site_pages.FAQ_PRICING:
        assert "Q: %s\nA: %s" % (q, a) in body, q
    for q, answers in site_pages.COMPARE_ROWS:
        assert "| %s | %s |" % (q, " | ".join(answers)) in body
    assert "6 meetings promised a month for %s" % site_pages.GTM_FEE in body and "$833" in body
    assert "&amp;" not in body and "{{" not in body and "{%" not in body


def test_the_summary_names_the_price_and_both_services():
    assert site_pages.GTM_FEE in site_seo.SUMMARY
    for words in ("GTM engineering", "performance marketing", "Google Ads", "Meta", "paid on results"):
        assert words in site_seo.SUMMARY, words


# ── Kept out of results ──────────────────────────────────────────────────────────

def test_a_missing_page_is_a_404_the_site_draws_and_search_engines_skip(client):
    r = client.get("/plays-that-do-not-exist")
    assert r.status_code == 404
    html = r.get_data(as_text=True)
    assert '<meta name="robots" content="noindex, follow">' in html
    assert 'rel="canonical"' not in html and "application/ld+json" not in html
    assert 'href="/book"' in html and "This page" in html


def test_api_calls_and_files_keep_the_plain_404(client):
    for path in ("/api/no-such-thing", "/static/no-such-file.css"):
        r = client.get(path)
        assert r.status_code == 404 and "This page" not in r.get_data(as_text=True), path
    r = client.post("/no-such-form")
    assert r.status_code in (404, 405) and "This page" not in r.get_data(as_text=True)


def test_the_sign_in_page_is_crawlable_only_to_read_its_noindex(client):
    assert _robots_allows(client.get("/robots.txt").get_data(as_text=True), "/login")
    assert '<meta name="robots" content="noindex, follow">' in _html(client, "/login")


def test_the_github_pages_copy_is_kept_out_of_results():
    """docs/ is a preview of the previous site on GitHub Pages; listed, it would compete with the live
    site for the brand's own name."""
    files = subprocess.check_output(["git", "ls-files", "docs/*.html", "docs/**/*.html"], cwd=ROOT).decode().split()
    assert files
    for f in files:
        with open(os.path.join(ROOT, f), encoding="utf-8") as fh:
            assert re.search(r'<meta name="robots" content="noindex', fh.read()), f
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    from build_static_site import noindex
    built = noindex('<head>\n<meta charset="utf-8">\n<title>x</title>')
    assert '<meta name="robots" content="noindex, follow">' in built
    assert noindex(built) == built


# ── The pictures search engines and link previews use ─────────────────────────────

def test_the_share_card_and_the_logo_exist_at_the_sizes_they_claim(client):
    from PIL import Image
    html = _html(client, "/")
    assert '<meta property="og:image" content="%s/static/og-site.png?v=1">' % SITE in html
    with Image.open(os.path.join(ROOT, "static", "og-site.png")) as im:
        assert im.size == (1200, 630)
    with Image.open(os.path.join(ROOT, "static", "logo.png")) as im:
        assert im.size == (512, 512)
    assert client.get("/static/og-site.png").status_code == 200
    assert client.get("/static/logo.png").status_code == 200
