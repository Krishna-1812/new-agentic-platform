"""outcomes.digital redesigned in the Northaxis look, at /outcomesdigital (outcomes_site.py).

The pages keep the live site's words (outcomes_content.py) and are unlisted: every page and response says
noindex, nothing on the Northaxis site (pages, sitemap, llms files, robots.txt) names the address, and the
Outcomes pages carry no Northaxis link, name or tracking. Their forms reach the same intake as /book,
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


def test_there_are_sixteen_pages_and_each_opens(client):
    assert len(PATHS) == 16 and len(set(PATHS)) == 16
    for path in PATHS + [site.PREFIX + "/", site.PREFIX + "/about-us/"]:
        r = client.get(path)
        assert r.status_code == 200, path
        assert "text/html" in r.headers["Content-Type"]


@pytest.mark.parametrize("path", PATHS + [site.PREFIX + "/no-such-page", site.PREFIX + "/case-study/nope"])
def test_every_page_and_error_says_never_list_me(client, path):
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
    assert appmod.BRAND["name"] not in body and "northaxis" not in body.lower().replace("northaxis.outcomes.digital", "")
    for href in re.findall(r'href="([^"]+)"', body):
        assert href.startswith((site.PREFIX, "/static/", "#", "https://", "mailto:")), (path, href)
        if href.startswith("https://"):
            assert href.startswith((od.CALENDLY, "https://www.linkedin.com/company/outcomes-digital",
                                    "https://www.facebook.com/outcomes.digital", "https://www.instagram.com/outcomes.digital",
                                    "https://fonts.")), (path, href)
    for tracker in ("visitor_track.js", "getwarmly", "googletagmanager", "/login"):
        assert tracker not in body, (path, tracker)


def test_nothing_on_northaxis_names_the_address(client):
    for path in ("/", "/sitemap.xml", "/llms.txt", "/llms-full.txt", "/robots.txt", "/partners", "/book"):
        assert "outcomesdigital" not in client.get(path).get_data(as_text=True), path
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
    for tab, title, line in od.HOME_STEPS:
        assert title in t and line in t
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
