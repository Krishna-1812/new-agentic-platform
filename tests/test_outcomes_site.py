"""outcomes.digital redesigned in the Northaxis look, at /outcomesdigital (outcomes_site.py).

The pages keep the live site's words (outcomes_content.py) and are unlisted: every page and response says
noindex, nothing on the Northaxis site (pages, sitemap, llms files, robots.txt) names the address, and the
Outcomes pages carry no Northaxis link, name or tracking but for the home page's second slide, which
introduces Northaxis as our product. Their forms reach the same intake as /book,
tagged "outcomes digital", and post to #leads.
"""
import html
import os
import re
import sys
from unittest.mock import patch

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import app as appmod  # noqa: E402
import outcomes_content as od  # noqa: E402
import outcomes_site as site  # noqa: E402

PATHS = [site.PREFIX + p for p, *_ in site.PAGES]


@pytest.fixture
def client():
    return appmod.app.test_client()


def _text(client, path):
    r = client.get(path)
    assert r.status_code == 200, path
    return html.unescape(r.get_data(as_text=True))


def test_there_are_nineteen_pages_and_each_opens(client):
    assert len(PATHS) == 19 and len(set(PATHS)) == 19
    for path in PATHS + [site.PREFIX + "/", site.PREFIX + "/about-us/"]:
        r = client.get(path)
        assert r.status_code == 200, path
        assert "text/html" in r.headers["Content-Type"]


@pytest.mark.parametrize("path", [p for p in PATHS if not site.listed(p)]
                         + [site.PREFIX + "/no-such-page", site.PREFIX + "/case-study/nope", site.PREFIX + "/partners/nope"])
def test_every_page_and_error_says_never_list_me(client, path):
    """All but the partner pages, which stay listed (tests/test_partner_pages.py)."""
    r = client.get(path)
    assert r.headers["X-Robots-Tag"] == "noindex, nofollow, noarchive"
    body = r.get_data(as_text=True)
    assert '<meta name="robots" content="noindex, nofollow, noarchive">' in body
    assert 'rel="canonical"' not in body and "application/ld+json" not in body


def test_a_missing_page_gets_this_sites_404_not_northaxis(client):
    r = client.get(site.PREFIX + "/case-study/nope")
    body = r.get_data(as_text=True)
    assert r.status_code == 404 and od.BRAND in body and appmod.BRAND["name"] not in body


@pytest.mark.parametrize("path", PATHS)
def test_no_outcomes_page_links_to_or_tracks_for_northaxis(client, path):
    body = client.get(path).get_data(as_text=True)
    if path == site.PREFIX:
        # The home page's second slide, and its tab, introduce Northaxis: the one place that names it.
        body = body[:body.index('id="slide-northaxis"')] + body[body.index('id="slide-bts"'):]
        body = body.replace(od.HOME_SLIDES[1][1], "").replace("slide-northaxis", "slide-2")
    assert appmod.BRAND["name"] not in body and "northaxis" not in body.lower().replace("northaxis.outcomes.digital", "")
    for href in re.findall(r'href="([^"]+)"', body):
        if href == appmod.SITE_URL + path:
            continue  # a listed page's canonical address is its own
        assert href.startswith((site.PREFIX, "/static/", "#", "https://", "mailto:")), (path, href)
        if href.startswith("https://"):
            assert href.startswith((od.CALENDLY, "https://www.linkedin.com/company/outcomes-digital",
                                    "https://www.facebook.com/outcomes.digital", "https://www.instagram.com/outcomes.digital",
                                    "https://fonts.")), (path, href)
    for tracker in ("visitor_track.js", "getwarmly", "googletagmanager", "/login"):
        assert tracker not in body, (path, tracker)


def test_nothing_on_northaxis_names_the_address(client):
    for path in ("/", "/llms.txt", "/llms-full.txt", "/book", "/privacy"):
        assert "outcomesdigital" not in client.get(path).get_data(as_text=True), path
    # The sitemap and robots.txt name the partner pages, the one part of this site that may be listed.
    sitemap = client.get("/sitemap.xml").get_data(as_text=True)
    assert sorted(re.findall(r"<loc>[^<]*(/outcomesdigital[^<]*)</loc>", sitemap)) == sorted(site.LISTED)
    robots = client.get("/robots.txt").get_data(as_text=True)
    assert re.findall(r".*outcomesdigital.*", robots) == ["Allow: /outcomesdigital/partners"]
    for name in os.listdir(os.path.join(ROOT, "templates", "site")):
        with open(os.path.join(ROOT, "templates", "site", name), encoding="utf-8") as f:
            assert "outcomesdigital" not in f.read(), name
    robots = client.get("/robots.txt").get_data(as_text=True)
    assert "Disallow: /\n" in robots, "robots.txt closes every path it does not list, this one included"


# == the live site's words, all of them ==================================================================

def test_the_home_page_keeps_its_words(client):
    t = _text(client, site.PREFIX)
    assert "We don’t do" in t and "We drive" in t and od.HOME_LEAD in t
    for fig, what in od.HOME_STATS:
        assert fig in t and what in t
    for name, ind, img in od.CLIENTS:
        assert name in t and ind in t and "/static/outcomes/img/%s.webp" % img in t
    for tab, title, line, photo in od.HOME_STEPS:
        assert title in t and line in t and "/static/outcomes/img/%s.webp" % photo in t
    for quote, who, sub in od.HOME_QUOTES:
        assert quote in t and who in t and sub in t


def test_the_about_page_keeps_the_team_the_story_and_the_numbers(client):
    t = _text(client, site.PREFIX + "/about-us")
    for role, name, title, bio, img in od.TEAM:
        assert name in t and title in t and bio in t
    for p in od.ABOUT_STORY + od.ABOUT_STACK:
        assert p in t
    for kick, fig, label, line, tag in od.ABOUT_IMPACT:
        assert fig in t and label in t and line in t and tag in t
    for name, pct, line in od.ABOUT_BARS:
        assert name in t and "%d%%" % pct in t and line in t
    for name, line in od.ABOUT_VALUES:
        assert name in t and line in t


@pytest.mark.parametrize("case", od.CASES, ids=[c["slug"] for c in od.CASES])
def test_each_case_study_keeps_its_figures_and_story(client, case):
    t = _text(client, site.PREFIX + "/case-study/" + case["slug"])
    assert (case.get("title") or case["name"]) in t and case["sub"] in t and case["results"] in t
    for fig, label, line in case["top"]:
        assert fig in t and label in t and line in t
    for p in case["challenge"]:
        assert p in t
    for name, line in case["approach"]:
        assert name in t and line in t
    for fig, label in case["figures"]:
        assert fig in t and label in t
    listing = _text(client, site.PREFIX + "/case-studies")
    assert case["name"] in listing and case["date"] in listing


@pytest.mark.parametrize("slug", [s for s, _ in od.SERVICES])
def test_each_service_page_keeps_its_words_and_questions(client, slug):
    s = od.SERVICE_PAGES[slug]
    t = _text(client, site.PREFIX + "/" + slug)
    assert s["lead"] in t and s["cta"] in t and s["problems_title"] in t and s["framework_lead"] in t
    for name, line in s["problems"] + s["why"]:
        assert name in t and line in t
    for step in s["framework"] + s["included"]:
        assert step in t
    for q, a in s["faqs"]:
        assert q in t
        for part in ([a] if isinstance(a, str) else [a[0], a[2]] + [p.split(": ", 1)[-1] for p in a[1]]):
            assert part in t, (slug, q)


def test_the_industry_pages_keep_their_words(client):
    ecom = _text(client, site.PREFIX + "/ecommerce-marketing")
    for group in (od.ECOM_MATTERS, od.ECOM_STEPS):
        for name, line in group:
            assert name in ecom and line in ecom
    for name, line, items in od.ECOM_SERVICES:
        assert name in ecom and all(i in ecom for i in items)
    for area, find, why in od.ECOM_FINDS:
        assert area in ecom and find in ecom and why in ecom
    for brand, where, what, rows in od.ECOM_RESULTS:
        assert brand in ecom and what in ecom and all(m in ecom and b in ecom and a in ecom for m, b, a in rows)
    assert all(q in ecom for q, *_ in od.ECOM_QUOTES) and all(f in ecom for f in od.ECOM_FIT + od.ECOM_PLAN)

    edu = _text(client, site.PREFIX + "/education-marketing")
    assert od.EDU_LEAD in edu and all(s in edu for s in od.EDU_JOURNEY + od.EDU_TRUSTED + od.EDU_FIT + od.EDU_CALL)
    for group in (od.EDU_PROBLEMS, od.EDU_START):
        assert all(n in edu and l in edu for n, l in group)
    assert all(n in edu and t in edu for n, d, t, f in od.EDU_WHO)
    assert all(k in edu and n in edu and l in edu for k, n, l in od.EDU_SYSTEM)

    re_ = _text(client, site.PREFIX + "/real-estate-marketing")
    assert od.RE_LEAD in re_ and all(s in re_ for s in od.RE_FIT + od.RE_CALL + od.RE_STAGES)
    for group in (od.RE_PROBLEMS, od.RE_START):
        assert all(n in re_ and l in re_ for n, l in group)
    assert all(n in re_ and l in re_ for k, n, l in od.RE_SYSTEM)
    assert all(name in re_ and all(m in re_ and c in re_ for m, c in rows) for name, what, rows in od.RE_PROOF)


def test_every_strategy_call_button_books_the_teams_calendar(client):
    for path in (site.PREFIX + p for p in ("/education-marketing", "/real-estate-marketing", "/ecommerce-marketing")):
        body = client.get(path).get_data(as_text=True)
        for tag in re.findall(r'<a [^>]*href="%s"[^>]*>' % re.escape(od.CALENDLY), body):
            assert 'target="_blank"' in tag and 'rel="noopener"' in tag


def test_every_image_a_page_uses_is_stored_here(client):
    seen = set()
    for path in PATHS:
        seen |= set(re.findall(r'/static/outcomes/img/([\w.-]+)', client.get(path).get_data(as_text=True)))
    assert len(seen) >= 20
    for name in seen:
        assert os.path.isfile(os.path.join(ROOT, "static", "outcomes", "img", name)), name


# == the calculators, as the live site models them =======================================================

def test_the_leak_estimator_starts_where_the_live_one_does(client):
    t = _text(client, site.PREFIX + "/ecommerce-marketing")
    for want in ("₹10L/mo", "₹79k", "₹90k", "₹51k", "₹2,20,000", "₹63,36,000", "₹50k", "₹50L"):
        assert want in t, want
    assert site.inr(6336000) == "₹63,36,000" and site.inr(999) == "₹999" and site.inr(12345678) == "₹1,23,45,678"
    assert [site.inr_short(n) for n in (50000, 79200, 1000000, 12500000)] == ["₹50k", "₹79k", "₹10L", "₹1.25Cr"]


def test_the_enrolment_calculator_starts_at_the_live_numbers(client):
    t = _text(client, site.PREFIX + "/education-marketing")
    assert "~27" in re.sub(r"<[^>]+>", "", t) and "15% benchmark" in t
    assert re.search(r'data-seat="now">18<', t) and re.search(r'data-seat="reach">45<', t)


def test_the_scripts_move_the_calculators_and_open_the_thank_you_page():
    js = open(os.path.join(ROOT, "static", "outcomes", "outcomes.js"), encoding="utf-8").read()
    assert 'getElementById("leakCalc")' in js and 'getElementById("seatCalc")' in js and ".od-menu" in js
    sitejs = open(os.path.join(ROOT, "static", "js", "site.js"), encoding="utf-8").read()
    assert 'form.getAttribute("data-next")' in sitejs and 'phone: val("phone")' in sitejs and 'budget: val("budget")' in sitejs


# == the forms ===========================================================================================

def _post(client, **extra):
    rows, slack = [], []
    with patch.object(appmod, "_demo_request_to_sheet", side_effect=lambda r: rows.append(r) or True), \
         patch.object(appmod, "_demo_request_to_slack", side_effect=lambda p, ch="": slack.append((p, ch)) or True), \
         patch.object(appmod, "_demo_request_to_email", return_value=True):
        body = dict({"name": "Sam Lee", "email": "sam@example.com", "company": "Lee Towers",
                     "pillar": "Outcomes Digital · Real estate", "source": "outcomes digital"}, **extra)
        r = client.post("/api/demo-request", json=body)
    return r, rows, slack


def test_an_outcomes_form_reaches_the_sheet_and_leads_with_its_answers(client):
    r, rows, slack = _post(client, phone="+91 90000 00000", city="Bangalore", stage="Some digital marketing",
                           budget="₹5,00,000 - ₹15,00,000")
    assert r.status_code == 200 and r.get_json()["ok"]
    row = rows[0]
    assert row[8] == "outcomes digital" and row[4] == "Outcomes Digital · Real estate"
    for want in ("Phone: +91 90000 00000", "City / location: Bangalore", "Where they are today: Some digital marketing",
                 "Monthly ad budget: ₹5,00,000 - ₹15,00,000"):
        assert want in row[5], want
    assert slack[0][1] == appmod.OUTCOMES_SLACK_CHANNEL == "#leads"


def test_a_northaxis_form_still_posts_where_it_did(client):
    r, rows, slack = _post(client, source="book page", pillar="GTM Engineering")
    assert rows[0][8] == "book page" and slack[0][1] == ""


def test_if_slack_refuses_leads_the_enquiry_still_reaches_the_usual_channel(monkeypatch):
    sent = []

    class Resp:
        def __init__(self, ok):
            self.ok, self._ok, self.text = True, ok, ""

        def json(self):
            return {"ok": self._ok}
    monkeypatch.setattr(appmod, "SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setattr(appmod.requests, "post", lambda url, headers, json, timeout: sent.append(json["channel"]) or
                        Resp(json["channel"] != "#leads"))
    assert appmod._demo_request_to_slack({"name": "Sam", "email": "s@x.com"}, "#leads") is True
    assert sent == ["#leads", appmod.SLACK_CHANNEL_ID]


@pytest.mark.parametrize("path,fields", [
    ("/contact", ("name", "email", "phone", "company", "message")),
    ("/ecommerce-marketing", ("stage", "name", "email", "phone", "website", "budget")),
    ("/education-marketing", ("name", "email", "phone", "company", "message")),
    ("/real-estate-marketing", ("name", "email", "phone", "company", "city", "stage")),
])
def test_each_form_asks_what_the_live_one_asks_and_opens_the_thank_you_page(client, path, fields):
    body = client.get(site.PREFIX + path).get_data(as_text=True)
    form = body[body.index('<form id="bookForm"'):body.index("</form>")]
    assert 'data-source="outcomes digital"' in form and 'data-next="%s/thank-you"' % site.PREFIX in form
    names = re.findall(r'name="(\w+)"', form)
    assert [n for n in names if n != "pillar"] == list(fields), names


def test_the_same_figures_and_call_length_everywhere(client):
    """The team's answers (10 November 2026): 25+ brands, 74%+ retention, a 30-minute Edu Tech call; and the
    PPC page's list is about paid media, not organic growth."""
    about = {label: fig for kick, fig, label, line, tag in od.ABOUT_IMPACT}
    ecom = {label: fig for fig, label in od.ECOM_STATS}
    assert about["Businesses Scaled"] == ecom["Ecommerce & growth-stage brands scaled"] == "25+"
    assert about["Client Retention"] == ecom["Client retention"] == "74%+"
    for path in PATHS:
        t = _text(client, path)
        assert "90%+" not in t and "30+ Ecommerce" not in t and "organic growth:" not in t or path.endswith("seo-services"), path
    edu = _text(client, site.PREFIX + "/education-marketing")
    assert "30 min free strategy call" in edu and "45 min" not in edu
    assert "paid media growth" in _text(client, site.PREFIX + "/ppc-management")


# == the story, the photos, one set of buttons ==========================================================

def test_the_home_page_leads_with_what_we_promise_and_keeps_the_clients_lower(client):
    t = _text(client, site.PREFIX)
    order = ["We drive", "What changes when your agency", "Most agencies stop at the leads", "Six disciplines",
             "Understand the business", "Built for the businesses", "Recent work", "Core Care Clinic", "In their"]
    at = [t.index(x) for x in order]
    assert at == sorted(at), dict(zip(order, at))
    hero = t[:t.index("What changes when your agency")]
    assert od.CTA_PLAN in hero and od.CTA_CALL in hero and "$5M+" in hero and "3X" in hero
    for name, line, link, ic, c in od.PILLARS:
        assert name in t and line in t
    for slug, name, headline, line, photo in od.INDUSTRY_CARDS:
        assert headline in t and site.url(slug) in t


def test_the_home_page_has_no_founders_story_section(client):
    html = client.get(site.PREFIX).get_data(as_text=True)
    assert "polished decks" not in html and "partner we wished we had" not in html
    assert 'id="said"' not in html
    # The difference now follows the hero directly, with a smaller gap above it.
    css = open(os.path.join(ROOT, "static/outcomes/outcomes.css")).read()
    assert ".od-slider + #difference { padding-top: var(--sec-sm); }" in css


# == the home page's one argument: outcomes, not activity ===============================================

def _hero(client):
    t = _text(client, site.PREFIX)
    return t[:t.index("What changes when your agency")]


def test_the_hero_says_we_are_not_another_agency_and_shows_it(client):
    hero = _hero(client)
    assert od.HOME_KICKER in hero and od.HOME_HERO_LEAD in hero
    # The outcome board: each row is a real client result that links to its case study.
    for client_name, what, outcome, fig, slug in od.HOME_BOARD:
        assert client_name in hero and outcome in hero and fig in hero
        assert site.url("case-study/" + slug) in hero
        assert slug in od.CASES_BY_SLUG
    for fig, what in od.HOME_STATS:
        assert fig in hero and what in hero
    # The team photo with stickers is gone from the hero; nothing covers the board.
    assert "od-float" not in hero and "step-4.webp" not in hero


def test_the_board_figures_match_the_case_studies_and_industry_pages():
    tops = {slug: {label: fig for fig, label, _ in c["top"]} for slug, c in od.CASES_BY_SLUG.items()}
    assert tops["kfi"]["Website Revenue"] == "2×"
    assert tops["madge-beauty"]["Sales Growth"] == "3×"
    assert tops["artistic-yoga"]["Annual Organic Visits"] == "457K+"
    allure = dict(od.RE_PROOF[0][2])
    assert od.RE_PROOF[0][0] == "Allure Avani" and allure["Site visits"] == "4x"
    board = {slug: fig for _, _, _, fig, slug in od.HOME_BOARD}
    assert board == {"kfi": "2×", "madge-beauty": "3×", "allure-avani": "4×", "artistic-yoga": "457K+"}


def test_the_difference_rows_strike_what_most_agencies_report(client):
    body = client.get(site.PREFIX).get_data(as_text=True)
    sec = body[body.index('id="difference"'):body.index('id="campaign"')]
    assert "What changes when your agency" in sec and "is measured on outcomes." in sec
    rows = re.findall(r'<p class="od-vs-them"><span class="od-vs-tag">Most agencies report</span><s>(.*?)</s></p>.*?'
                      r'<p class="od-vs-us"><span class="od-vs-tag">We&rsquo;re measured on</span>(.*?)</p>', sec, re.S)
    assert [(html.unescape(a), html.unescape(b)) for a, b in rows] == list(od.HOME_VS)


def test_one_real_campaign_is_read_two_ways(client):
    body = client.get(site.PREFIX).get_data(as_text=True)
    sec = body[body.index('id="campaign"'):body.index('id="what"')]
    steps = re.findall(r'<div class="od-chain-step([^"]*)"[^>]*><b>([^<]+)</b><span>([^<]+)</span>', sec)
    assert [(f, w) for _, f, w in steps] == list(od.HOME_CHAIN)
    # What most agencies would report, then what we are measured on.
    assert ["is-us" in cls for cls, _, _ in steps] == [False] * od.HOME_CHAIN_SPLIT + [True] * (len(od.HOME_CHAIN) - od.HOME_CHAIN_SPLIT)
    assert "What most agencies would report" in sec and "What we&rsquo;re measured on" in sec
    # The funnel is the Allure Avani case study's own.
    c = od.CASES_BY_SLUG["allure-avani"]
    figs = dict((w, f) for f, w in c["figures"]) | dict((w, f) for f, w, _ in c["top"])
    assert figs["Impressions"] == "1.28M" and figs["Clicks"] == "16K+" and figs["Total Leads"] == "600+"
    assert figs["Qualified Leads"] == "214" and figs["Site Visits Completed"] == "55"
    # The cost per site visit, and the link under it, were taken off the home page (2026-11-10).
    assert "15,455" not in sec and "per site visit" not in sec and "od-chain-cost" not in body
    # Allure Avani's words sit with its campaign, and are not repeated lower down.
    allure = [q for q in od.HOME_QUOTES if q[1] == "Allure Avani"][0]
    assert html.escape(allure[0], quote=False)[:60] in sec or allure[0][:60] in html.unescape(sec)
    assert html.unescape(body).count(allure[0][:60]) == 1


def test_each_industry_shows_the_outcome_it_is_measured_on(client):
    t = _text(client, site.PREFIX)
    assert set(od.INDUSTRY_OUTCOME) == {slug for slug, *_ in od.INDUSTRY_CARDS}
    for slug, outcome in od.INDUSTRY_OUTCOME.items():
        assert '<span class="od-ind-out">Measured on <b>%s</b></span>' % outcome in t


def test_the_home_hero_stacks_on_small_screens():
    css = open(os.path.join(ROOT, "static/outcomes/outcomes.css")).read()
    i = css.index(".od-home-hero .od-hero-grid { grid-template-columns: minmax(0, 13fr)")
    assert "@media (max-width: 1000px) {\n  .od-home-hero .od-hero-grid { grid-template-columns: 1fr; }" in css[i:i + 400]


@pytest.mark.parametrize("path,photos", [
    ("/education-marketing", ["photo-campus.webp"] + [f for _, f in od.EDU_LOGOS]),
    ("/real-estate-marketing", ["photo-tower.webp", "logo-allure-avani.webp", "logo-govind.webp"]),
    ("/ecommerce-marketing", [f for _, f in od.ECOM_PLATFORMS] + ["logo-madge.webp", "card-material-hunt.webp"]),
    ("/about-us", ["team-sudheer.webp"]),
    ("/seo-services", ["step-3.webp"]), ("/ppc-management", ["step-5.webp"]), ("/cro-services", ["step-1.webp"]),
])
def test_the_pages_carry_their_photos_and_logos(client, path, photos):
    body = client.get(site.PREFIX + path).get_data(as_text=True)
    for f in photos:
        assert "/static/outcomes/img/" + f in body, (path, f)


def test_the_photos_are_high_resolution_and_credited():
    """Every photo is an Unsplash photo, credited once in PHOTO_CREDITS, saved at 2400x1600 and again at
    1200x800 for phones, and kept light enough to load fast."""
    from PIL import Image
    names = [n for n, _, _ in od.PHOTO_CREDITS]
    assert len(set(names)) == len(names) and len({i for _, _, i in od.PHOTO_CREDITS}) == len(names)
    assert {s[3] for s in od.HOME_STEPS} | {c[4] for c in od.INDUSTRY_CARDS} <= set(names)
    for n in names:
        big = os.path.join(ROOT, "static/outcomes/img/%s.webp" % n)
        small = os.path.join(ROOT, "static/outcomes/img/%s-1200.webp" % n)
        assert Image.open(big).size == (2400, 1600), big
        assert Image.open(small).size == (1200, 800), small
        assert os.path.getsize(big) < 460 * 1024 and os.path.getsize(small) < 250 * 1024, n
    # The old office stock photos were never shown; they are gone.
    assert not any(n.startswith("office-") for n in os.listdir(os.path.join(ROOT, "static/outcomes/img")))


def test_every_credited_photo_is_shown_at_the_right_size_with_words_for_it(client):
    """The pages bring the photos in through the pic macro: the small file for phones and the large one
    for wide screens, lazily below the fold. Every credited photo is used, and none is shown uncredited."""
    credited = {n for n, _, _ in od.PHOTO_CREDITS}
    seen = set()
    for path in PATHS:
        t = _text(client, path)
        for tag in re.findall(r"<img [^>]*srcset=[^>]*>", t):
            n = re.search(r'/static/outcomes/img/([\w-]+)-1200\.webp 1200w', tag).group(1)
            assert n in credited, (path, n)
            assert "/static/outcomes/img/%s.webp 2400w" % n in tag and 'sizes="' in tag, (path, tag)
            assert 'width="1200" height="800"' in tag, (path, tag)
            seen.add(n)
        # Each industry page's steps each carry their own photo, with words for it.
        if path.endswith(("ecommerce-marketing", "education-marketing", "real-estate-marketing")):
            cards = re.findall(r'<article class="track-card track-card-ph[^"]*"[^>]*>.*?</article>', t, re.S)
            assert len(cards) == 5, path
            assert all(re.search(r'<figure class="track-ph"><img [^>]*alt="[^"]+"', c) for c in cards), path
    assert seen == credited, credited - seen
    for key, photos in od.STEP_PHOTOS.items():
        assert len(photos) == 5 and all(alt for _, alt in photos), key


def test_the_photo_layer_lays_nothing_but_solid_cards_over_photos():
    """The photo pass adds no gradient and no overlay on a photo; its captions are solid cards, and it
    leaves the photos still for people who ask for less motion."""
    css = open(os.path.join(ROOT, "static/outcomes/outcomes.css"), encoding="utf-8").read()
    layer = css.split("/* ════ v6: the photo pass", 1)[1]
    assert "gradient" not in layer and "::after" not in layer
    assert "body.od .od-band-cap {" in layer and "background: var(--card)" in layer
    motion = layer.split("@media (prefers-reduced-motion: reduce)", 1)[1].split("\n}\n", 1)[0]
    assert "transform: none !important" in motion and "clip-path: none !important" in motion


@pytest.mark.parametrize("path", PATHS)
def test_one_pair_of_buttons_and_sentence_case_heads_everywhere(client, path):
    t = _text(client, path)
    for old in ("Get Growth Plan", "Book a meeting", "Click here", "How We Work", "Real Numbers", "Great Indian Philosopher",
                "Book a strategy call<", "Get Started", "Request a callback<"):
        assert old not in t, (path, old)
    assert od.CTA_PLAN in t
    nums = re.findall(r'<div class="shead-l"><span class="idx">(\d\d)<|<span class="lbl">(?:<span class="idx">)?(\d\d)(?: · |</span>)', t)
    nums = [a or b for a, b in nums]
    # The partner pages number their hero "01 / ...", so their sections count on from 02.
    first = 2 if re.search(r'<span class="idx[^"]*">01 / ', t) else 1
    if nums:
        assert nums == ["%02d" % i for i in range(first, first + len(nums))], (path, nums)


@pytest.mark.parametrize("slug", [s for s, _ in od.SERVICES])
def test_each_service_hero_shows_a_result_from_its_case_study(client, slug):
    s = od.SERVICE_PAGES[slug]
    case, fig, label = s["proof"]
    hero = _text(client, site.PREFIX + "/" + slug).split('id="main"', 1)[1].split("</header>", 1)[0]
    assert fig in hero and label in hero and site.url("case-study/" + case) in hero
    assert fig in [f for f, *_ in od.CASES_BY_SLUG[case]["top"] + od.CASES_BY_SLUG[case]["figures"]]


def test_the_leak_estimator_stacks_its_totals_so_the_largest_fits(client):
    t = client.get(site.PREFIX + "/ecommerce-marketing").get_data(as_text=True)
    assert 'class="od-calc-sum"' in t and 'class="od-calc-tot"' not in t
    assert site.inr(round(5000000 * 0.22 * 12 * 2.4)) == "₹3,16,80,000", "the most the slider reaches"


# ── Logos scroll in a carousel, like the live site's, instead of sitting in a wall ──
@pytest.mark.parametrize("path,items", [
    ("/education-marketing", od.EDU_LOGOS),
    ("/ecommerce-marketing", od.ECOM_PLATFORMS),
    ("/about-us", od.CLIENT_LOGOS),
])
def test_logos_scroll_in_a_carousel(client, path, items):
    body = client.get(site.PREFIX + path).get_data(as_text=True)
    assert 'class="od-marquee' in body and "od-marquee-track" in body
    assert "od-logos-big" not in body and 'class="od-logos"' not in body and "tick-track" not in body
    track = body[body.index("od-marquee-track"):]
    track = track[:track.index("</div>")]
    tiles = re.findall(r'<span class="od-logo-tile[^"]*"( aria-hidden="true")?><img src="/static/outcomes/img/([^"]+)" alt="([^"]*)"', track)
    # Two equal halves, each wide enough to fill a big screen, so the loop never shows a gap.
    assert len(tiles) % 2 == 0 and len(tiles) // 2 >= 12
    # Screen readers hear each logo once; the repeats are hidden from them.
    named = [(f, alt) for hidden, f, alt in tiles if not hidden]
    assert named == [(f, name) for name, f in items]
    assert all(alt == "" for hidden, f, alt in tiles if hidden)


def test_white_logos_sit_on_a_dark_tile(client):
    body = client.get(site.PREFIX + "/education-marketing").get_data(as_text=True)
    for f in ("logo-basil-woods.svg", "logo-city-college.webp"):
        assert f in od.LOGOS_ON_DARK
        assert re.search(r'<span class="od-logo-tile is-dark"[^>]*><img src="/static/outcomes/img/' + re.escape(f), body), f
    assert re.search(r'<span class="od-logo-tile"><img src="/static/outcomes/img/logo-acharya.webp"', body)
    re_body = client.get(site.PREFIX + "/real-estate-marketing").get_data(as_text=True)
    assert '<span class="od-proof-logo is-dark"><img src="/static/outcomes/img/logo-allure-avani.webp"' in re_body
    assert '<span class="od-proof-logo"><img src="/static/outcomes/img/logo-govind.webp"' in re_body
    for f in od.LOGOS_ON_DARK:
        assert os.path.exists(os.path.join(ROOT, "static/outcomes/img", f)), f


def test_the_carousel_pauses_and_respects_reduced_motion():
    css = open(os.path.join(ROOT, "static/outcomes/outcomes.css")).read()
    assert ".od-marquee:hover .od-marquee-track" in css and "animation-play-state: paused" in css
    rm = css[css.index("@media (prefers-reduced-motion: reduce) {\n  .od-marquee"):]
    assert "animation: none" in rm[:300]


def test_the_home_page_story_stands_still_for_reduced_motion():
    css = open(os.path.join(ROOT, "static/outcomes/outcomes.css")).read()
    # Every reduced-motion block, each up to its closing brace at the start of a line.
    rm = "".join(b.split("\n}\n", 1)[0] for b in css.split("@media (prefers-reduced-motion: reduce) {")[1:])
    for sel in (".od-board-rows li", ".od-chain-step", ".od-vs-them s", ".od-live i"):
        assert sel in rm, sel


def test_every_card_sits_straight():
    """No card is tilted, at rest or on hover: the only turn left is the menu's arrow."""
    import re
    css = open(os.path.join(ROOT, "static/outcomes/outcomes.css")).read()
    turns = [line.strip() for line in css.splitlines() if re.search(r"rotate|skew", line)]
    assert turns == [".od-menu:hover .od-menu-btn span, .od-menu.open .od-menu-btn span { transform: rotate(180deg); }"], turns
    # The shared .model card tilts on hover elsewhere; here it only lifts.
    assert ".play .model:hover { transform: translateY(-8px); }" in css


def test_quote_cards_in_a_row_sit_level_and_match_in_height():
    css = open(os.path.join(ROOT, "static/outcomes/outcomes.css")).read()
    assert ".od-quotes { display: grid;" in css and "align-items: stretch; }" in css.split(".od-quotes {", 1)[1].split("\n", 1)[0]
    assert ".od-quotes .od-quote:nth-child" not in css, "no quote card is pushed lower than the one beside it"


# == the slides at the top of the home page =============================================================

def _slides(client):
    body = client.get(site.PREFIX).get_data(as_text=True)
    return html.unescape(body[body.index('id="highlights"'):body.index('id="difference"')])


def test_the_home_page_opens_on_three_slides_with_a_tab_each(client):
    t = _slides(client)
    assert 'aria-roledescription="carousel"' in t and 'data-seconds="%d"' % od.SLIDE_SECONDS in t
    for k, (sid, label) in enumerate(od.HOME_SLIDES):
        assert 'id="slide-%s"' % sid in t and "%d of %d: %s" % (k + 1, len(od.HOME_SLIDES), label) in t
        assert 'href="#slide-%s"' % sid in t and 'aria-controls="slide-%s"' % sid in t
    # The first slide is the home page's own hero: its one h1 and its board.
    first = t[:t.index('id="slide-northaxis"')]
    assert first.count("<h1") == 1 and t.count("<h1") == 1 and "We drive" in first and "od-board" in first
    # Arrows, and a pause button that only shows once the script runs.
    assert 'data-step="-1"' in t and 'data-step="1"' in t and 'class="od-ctl od-ctl-play" type="button"' in t
    assert 'aria-pressed="false" hidden>' in t


def test_the_northaxis_slide_shows_the_product_and_links_to_its_site(client):
    t = _slides(client)
    nx = t[t.index('id="slide-northaxis"'):t.index('id="slide-bts"')]
    assert od.NX_KICKER in nx and od.NX_LEAD.format(signals=len(site.site_pages.SIGNALS)) in nx
    for what, detail, fig, note in od.NX_BOARD:
        assert what in nx and detail in nx and fig in nx and note in nx
    for fig, what in od.NX_SUM:
        assert fig in nx and what in nx
    assert "a sample" in nx  # the lead is sample data, and says so
    assert site.site_pages.GTM_FEE in nx
    links = re.findall(r'href="([^"]+)"', nx)
    assert len(links) == 2 and links[1] == links[0] + "signals" and links[0].endswith("/"), links
    # The links go to the Northaxis site itself, never back into these pages.
    assert not any(h.startswith(site.PREFIX) or "outcomesdigital" in h for h in links), links


def test_every_slide_is_built_like_the_first(client):
    """The three slides share one look: the same paper, kicker, headline, lead, buttons and figures, beside the
    same dark report card. Only the words change."""
    t = _slides(client)
    at = [t.index('id="slide-%s"' % sid) for sid, _ in od.HOME_SLIDES] + [t.index("od-slider-bar")]
    for k in range(len(od.HOME_SLIDES)):
        s = t[at[k]:at[k + 1]]
        for part in ('class="wrap hero od-home-hero"', 'class="lbl od-kicker', 'class="d1 rv"', 'class="mk"',
                     'class="lead rv fade"', 'class="btn btn-1"', "btn-2", 'class="od-proof-row', 'class="od-board-wrap rv"',
                     'class="od-board-top"', 'class="od-board-rows"', 'class="od-board-sum"', 'class="c-orange"',
                     'class="c-sky"', 'class="od-board-foot"'):
            assert part in s, (od.HOME_SLIDES[k][0], part)
        assert s.count("<dd>") == 3, od.HOME_SLIDES[k][0]
    css = open(os.path.join(ROOT, "static/outcomes/outcomes.css")).read()
    for gone in ("od-stage", "od-pass", "od-bts-", "inkband"):
        assert gone not in css[css.index("/* ════ The slides at the top"):css.index("/* ════ v5: the brand pass")], gone


def test_the_summit_slide_keeps_the_facts_and_the_pass(client):
    t = _slides(client)
    bts = t[t.index('id="slide-bts"'):]
    b = od.BTS
    for fact in (b["name"], b["theme"], b["dates"], b["mentors"], b["startups"]):
        assert fact in bts, fact
    assert od.BTS_LEAD.format(edition=b["edition"], who=od.TEAM[0][1], mentors=b["mentors"],
                              startups=b["startups"]) in bts
    assert od.BTS_KICKER in bts and od.TEAM[0][1] in bts and od.CALENDLY in bts
    assert 'href="%s"' % site.url("about-us") in bts
    # The summit's mark, on its own white plate on the pass, named for a screen reader.
    assert '<img src="/static/outcomes/img/bts-logo.webp" alt="%s"' % b["name"] in bts
    assert os.path.getsize(os.path.join(ROOT, "static/outcomes/img/bts-logo.webp")) > 1000


def test_the_slides_scroll_without_the_script_and_stand_still_for_reduced_motion():
    css = open(os.path.join(ROOT, "static/outcomes/outcomes.css")).read()
    track = css[css.index(".od-slides {"):]
    track = track[:track.index("}")]
    assert "scroll-snap-type: x mandatory" in track and "overflow-x: auto" in track
    # Every reduced-motion block, each up to its closing brace at the start of a line.
    rm = "".join(b.split("\n}\n", 1)[0] for b in css.split("@media (prefers-reduced-motion: reduce) {")[1:])
    assert ".od-board-plate" in rm and ".od-slide-bg img" in rm and ".od-reel-track" in rm
    js = open(os.path.join(ROOT, "static/outcomes/outcomes.js")).read()
    # Autoplay never runs for reduced motion, and holds while the pointer or focus is on the slides.
    assert "stopped = still" in js and '"mouseenter"' in js and '"focusin"' in js and "doc.hidden" in js


def test_the_site_carries_no_toy_decoration(client):
    """The quiet pass: no giant drifting words, toy shapes, scrolling word bands or footer shape tiles on any
    page; the figures still count up, and nothing follows the mouse."""
    for path in PATHS:
        body = client.get(path).get_data(as_text=True)
        for gone in ('class="od-deco"', 'class="od-toy', 'class="kin"', 'class="toys"'):
            assert gone not in body, (path, gone)
    css = open(os.path.join(ROOT, "static/outcomes/outcomes.css")).read()
    for gone in (".od-word", ".od-toy", "--od-spin", "od-aura"):
        assert gone not in css, gone
    js = open(os.path.join(ROOT, "static/outcomes/outcomes.js")).read()
    assert "var count = function (slide)" in js and "if (!still) count(slides[0]);" in js and "--mx" not in js


def test_the_brand_pass_is_one_typeface_no_gradients_and_stays_on_these_pages():
    """Built from the logo: its navy and orange, tints of those two where amber, sky and red filled blocks, one
    typeface (Zalando Sans) for headings too, no italics, and no gradient left to paint. Every override sits
    under body.od, so the Northaxis pages keep press.css as it was."""
    css = open(os.path.join(ROOT, "static/outcomes/outcomes.css")).read()
    layer = css[css.index("/* ════ v5: the brand pass"):]
    root = layer[layer.index("body.od {"):]
    root = root[:root.index("\n}")]
    for token in ("--nv: #08192C", "--acc: #FC5A08", "--amber: #FFE4D3", "--sky:   #E4EBF3", "--red:   #FFD0B5",
                  "--marker: none", "--face-display: 'Zalando Sans'"):
        assert token in root, token
    assert "body.od .it, body.od .it * { font-style: normal !important; }" in layer
    assert "body.od .od-ind::before { display: none; }" in layer and "mask-image: none" in layer
    # Nothing in the layer draws a real gradient: a solid fill is the only linear-gradient it uses.
    for g in re.findall(r"linear-gradient\(([^)]*)\)", layer):
        assert len(set(x.strip() for x in g.split(","))) == 1, g
    bare = re.sub(r"/\*.*?\*/", "", layer, flags=re.S)
    for chunk in bare.split("}"):
        if "@keyframes" in chunk:
            # A keyframe's frames have no selector of their own; its name is this site's.
            assert re.search(r"@keyframes od-[\w-]+ \{", chunk), chunk
        elif "{" in chunk:
            sel = chunk.split("{")[-2].strip() if chunk.count("{") > 1 else chunk.split("{")[0].strip()
            assert sel.startswith(("body.od", "html:has(body.od)", "html.js body.od")), sel
    press = open(os.path.join(ROOT, "static/css/press.css")).read()
    assert "--amber:   #FFB500;" in press and "--sky:     #8CCBFF;" in press and "--face-display: 'Fraunces'" in press


def test_the_home_slides_open_on_photos_and_the_page_ends_on_the_clients_own_words(client):
    """Each of the three slides has a photo behind it (dimmed by the navy under it, never by a gradient), the
    first case study leads Recent work, the brands drift past in a reel whose copy is hidden from screen
    readers, and each home quote carries the client's picture."""
    t = _text(client, site.PREFIX)
    slides = re.findall(r'<div class="od-slide [^"]*" id="slide-[\w-]+".*?</figure>', t, re.S)
    assert len(slides) == len(od.HOME_SLIDES) == 3
    credits = {n: by for n, by, _ in od.PHOTO_CREDITS}
    for (sid, _), s in zip(od.HOME_SLIDES, slides):
        name = od.HOME_SLIDE_PHOTOS[sid]
        # A blurred copy tints the stage; the photo itself shows in the window. Its credit lives in the code.
        assert '<img class="od-slide-haze" src="/static/outcomes/img/%s-1200.webp" alt=""' % name in s, sid
        assert '<span class="od-slide-win"><img src="/static/outcomes/img/%s-1200.webp"' % name in s, sid
        assert "loading=" not in s and name in credits, sid
    # Each tab carries its slide's photo as a thumbnail.
    tabs = t.split('<div class="od-tabs">', 1)[1].split("</div>", 1)[0]
    for sid, _ in od.HOME_SLIDES:
        assert '/static/outcomes/img/%s-1200.webp' % od.HOME_SLIDE_PHOTOS[sid] in tabs, sid
    assert "od-case-feature" in t
    reel = t.split('<div class="od-reel"', 1)[1].split("</div>\n</div>", 1)[0]
    assert reel.count('class="od-card"') == 2 * len(od.CLIENTS) and reel.count('aria-hidden="true"') == len(od.CLIENTS)
    quotes = t.split('class="od-quotes od-quotes-2"', 1)[1].split("</section>", 1)[0]
    faces = {n: img for n, _, img in od.CLIENTS}
    for q, who, sub in od.HOME_QUOTES:
        if who != "Allure Avani":
            assert 'class="od-av od-av-img" src="/static/outcomes/img/%s.webp"' % faces[who] in quotes, who
    css = open(os.path.join(ROOT, "static/outcomes/outcomes.css"), encoding="utf-8").read()
    layer = css.split("/* ════ v7: the home page, finished", 1)[1]
    assert "gradient" not in layer and "body.od .od-slide-bg img { display: block;" in layer


def test_every_inner_page_opens_on_a_spread_with_a_credited_photo(client):
    """The inner pages open as the home page does: a navy stage with the page's photo (credited in the
    code) in the angled window and a blurred copy tinting the stage; the photo is decoration (empty alt, hidden from
    screen readers), and the partner pages no longer repeat it in a band below."""
    credits = {n: by for n, by, _ in od.PHOTO_CREDITS}
    pages = dict(od.SPREAD_PHOTOS)
    pages.update({slug: od.SERVICE_PAGES[slug]["photo"][0] for slug, _ in od.SERVICES})
    for path, name in pages.items():
        t = _text(client, site.PREFIX + "/" + path)
        spread = t.split('<div class="od-spread">', 1)[1].split("</header>", 1)[0]
        assert '<figure class="od-slide-bg" aria-hidden="true">' in spread, path
        assert '<img class="od-slide-haze" src="/static/outcomes/img/%s-1200.webp" alt=""' % name in spread, path
        assert '<span class="od-slide-win"><img src="/static/outcomes/img/%s-1200.webp"' % name in spread, path
        assert name in credits, path
        assert "od-band-top" not in t and 'class="od-hero-photo"' not in t, path
    css = open(os.path.join(ROOT, "static/outcomes/outcomes.css"), encoding="utf-8").read()
    layer = css.split("/* ════ v9: every page opens on a spread", 1)[1]
    assert "gradient" not in layer and "@keyframes od-win-open" in layer
    assert "body.od .od-spread .od-slide-win, body.od .od-spread .od-slide-win img { animation: none !important; }" in layer


def test_no_page_prints_a_photo_credit(client):
    """The photographers are credited in PHOTO_CREDITS, in the code; no page prints a credit line."""
    for path in PATHS:
        t = _text(client, path)
        assert "Unsplash" not in t and "Photo: " not in t and "od-slide-cap" not in t, path


def test_what_stands_on_a_photo_is_glass_that_still_reads():
    """The cards on the slide and page photos are frosted glass: translucent navy over a blurred, darkened
    photo, with a solid navy fallback where the browser cannot blur; the figure tiles stay solid."""
    css = open(os.path.join(ROOT, "static/outcomes/outcomes.css"), encoding="utf-8").read()
    layer = css.split("/* ════ v10: glass over the photos", 1)[1]
    assert "gradient" not in layer
    assert "body.od :is(.od-slider, .od-spread) :is(.od-board, .od-calc) {" in layer
    assert "backdrop-filter: blur(22px) saturate(1.4) brightness(.72)" in layer and "-webkit-backdrop-filter" in layer
    fallback = layer.split("@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {", 1)[1]
    assert "background: var(--nv)" in fallback
    assert ".od-board-sum" not in layer.split("background: rgba(8, 25, 44", 1)[0]


@pytest.mark.parametrize("case", od.CASES, ids=[c["slug"] for c in od.CASES])
def test_each_case_study_opens_on_its_own_cover_with_its_results_on_glass(client, case):
    """A case study opens on the spread with its client's own cover in the window (never a stock photo),
    and its three headline results as a report card, each with its line, over it."""
    t = _text(client, site.PREFIX + "/case-study/" + case["slug"])
    spread = t.split('<div class="od-spread">', 1)[1].split("</header>", 1)[0]
    cover = "/static/outcomes/img/case-%s.webp" % case["slug"]
    assert '<img class="od-slide-haze" src="%s" alt=""' % cover in spread
    assert '<span class="od-slide-win"><img src="%s" alt=""' % cover in spread
    board = spread.split('class="od-board-wrap od-cs-board rv"', 1)[1]
    for fig, label, line in case["top"]:
        assert fig in board and label in board and line in board
    assert t.count('class="blk-price"') == 0
