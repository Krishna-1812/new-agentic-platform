"""The public site after the October 2026 rebuild: GTM engineering and performance marketing.

The site promises a number of booked meetings each month for a fixed fee (only meetings that take
place count; each missing one is credited on the next bill), and performance marketing paid on
results. These tests hold the pages, the promise as it is worded, every link, the moves from the
previous site's addresses, and the booking form.
"""

import html as html_lib
import os
import re
import sys
from unittest.mock import patch

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as appmod  # noqa: E402
import site_pages  # noqa: E402

PAGES = {
    "/": "Meetings with your buyers",
    "/gtm-engineering": "booked for you",
    "/performance-marketing": "Ad accounts checked",
    "/how-it-works": "A small ask of you",
    "/pricing": "A fixed monthly fee",
    "/book": "Tell us who you want",
    "/privacy": "Privacy",
    "/terms": "Terms of",
}


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


@pytest.mark.parametrize("path,heading", sorted(PAGES.items()))
def test_every_page_opens_with_its_heading(client, path, heading):
    html = _html(client, path)
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.S)
    assert h1 and heading in re.sub(r"<[^>]+>", "", h1.group(1)), path
    assert '<link rel="stylesheet" href="/static/css/site.css' in html
    assert "<title>" in html and 'name="description" content="' in html


def test_a_signed_in_person_still_goes_straight_to_their_workspace(client):
    with client.session_transaction() as s:
        s["google_user"] = {"email": "someone@markifydigital.com", "name": "Someone"}
    r = client.get("/")
    assert r.status_code == 302 and r.headers["Location"].endswith("/hub")


@pytest.mark.parametrize("path", sorted(PAGES))
def test_every_link_on_every_page_goes_somewhere(client, path):
    html = _html(client, path)
    for href in set(re.findall(r'href="(/[^"#]*)', html)):
        if href.startswith(("/static/", "/favicon")):
            continue
        code = client.get(href).status_code
        assert code in (200, 301, 302), (path, href, code)


@pytest.mark.parametrize("path", sorted(PAGES))
def test_every_page_has_the_header_the_call_and_the_footer(client, path):
    html = _html(client, path)
    for href, _label in site_pages.NAV:
        assert 'href="%s"' % href in html, (path, href)
    assert '<a class="btn btn-ink" href="/book" data-cta="header">Book a call</a>' in html
    assert 'href="/login"' in html and 'href="/privacy"' in html and 'href="/terms"' in html
    assert '<a href="/old-site">Previous site</a>' in html
    assert "Book a demo" not in html and "Sign up" not in html


def test_the_current_page_is_marked_in_the_header(client):
    html = _html(client, "/pricing")
    assert '<a href="/pricing" aria-current="page">Pricing</a>' in html
    assert '<a href="/gtm-engineering" aria-current' not in html


def test_the_promise_is_worded_the_same_everywhere(client):
    home = _text(_html(client, "/"))
    assert "$1,000 a month" in home
    assert "Shortfall credited on your next bill" in home
    pricing = _text(_html(client, "/pricing"))
    assert "Each missing meeting is credited on your next bill" in pricing
    assert "A no-show doesn’t count towards the promise" in pricing
    assert "Paid on results" in pricing
    for path in ("/", "/gtm-engineering"):
        assert "A no-show doesn't count." in _text(_html(client, path)), path


def test_the_worked_example_adds_up(client):
    text = _text(_html(client, "/pricing"))
    fee, promised, missing = 1000, 6, 1
    credit = round(fee / promised)
    assert "6 meetings a month for $1,000" in text and "$%d" % credit in text
    assert "$%d" % (fee - credit * missing) in text


def test_the_site_says_nothing_about_warming_up_sending_accounts(client):
    for path in PAGES:
        assert "warm" not in _text(_html(client, path)).lower(), path


def test_hiring_signals_stay_off():
    assert not any("hiring" in (p["name"] + p["sign"]).lower() for p in site_pages.PLAYS)


def test_sample_leads_are_roles_not_people():
    for lead in site_pages.SAMPLE_LEADS:
        assert set(lead) <= {"who", "where", "why", "src", "score", "meeting"}


@pytest.mark.parametrize("old,new,code", [
    ("/platform", "/how-it-works", 301), ("/signals", "/gtm-engineering#plays", 301),
    ("/solutions", "/gtm-engineering", 301), ("/integrations", "/how-it-works", 301),
    ("/why-intelligence", "/pricing", 302),
    ("/agents", "/old-site/agents", 302), ("/agents/signal-tracker", "/old-site/agents/signal-tracker", 302),
    ("/industries", "/old-site/industries", 302),
    ("/industries/healthcare", "/old-site/industries/healthcare", 302),
    ("/resources", "/old-site/resources", 302),
])
def test_the_previous_sites_addresses_go_somewhere_useful(client, old, new, code):
    r = client.get(old)
    assert r.status_code == code and r.headers["Location"].endswith(new), (old, r.status_code)


def test_robots_lists_the_new_pages_and_not_the_old_site(client):
    body = client.get("/robots.txt").get_data(as_text=True)
    for path in ("/gtm-engineering", "/performance-marketing", "/how-it-works", "/pricing", "/book"):
        assert "Allow: " + path in body
    assert "old-site" not in body and "Allow: /platform" not in body


def test_the_booking_form_reaches_the_team_with_every_answer(client):
    html = _html(client, "/book")
    for name in ("name", "email", "company", "website", "pillar", "sells", "meet", "spend", "country", "message"):
        assert 'name="%s"' % name in html, name
    rows, slack = [], []
    with patch.object(appmod, "_demo_request_to_sheet", side_effect=lambda row: rows.append(row) or True), \
         patch.object(appmod, "_demo_request_to_slack", side_effect=lambda p: slack.append(p) or True), \
         patch.object(appmod, "_demo_request_to_email", return_value=True):
        r = client.post("/api/demo-request", json={
            "name": "Asha", "email": "asha@example.com", "company": "Acme", "website": "acme.example",
            "pillar": "Both", "sells": "Payroll software", "meet": "HR heads in the US",
            "spend": "Under $5,000", "country": "US", "message": "Soon, please.", "source": "book page"})
    assert r.get_json()["ok"] is True
    row = rows[0]
    assert row[1:5] == ["Asha", "asha@example.com", "Acme", "Both"]
    assert row[5] == ("Website: acme.example\nSells: Payroll software\nWants to meet: HR heads in the US\n"
                      "Monthly ad spend: Under $5,000\nBuyers in: US\n\nSoon, please.")
    assert row[8] == "book page"
    assert slack[0]["interest"] == "Both" and "Wants to meet: HR heads in the US" in slack[0]["message"]


def test_the_booking_form_still_needs_a_name_and_an_email(client):
    r = client.post("/api/demo-request", json={"name": "", "email": "nope", "source": "book page"})
    assert r.status_code == 400


def test_book_for_performance_preselects_better_ads(client):
    html = _html(client, "/book?for=performance")
    assert 'value="Performance Marketing" checked' in html
    assert 'value="GTM Engineering" checked' not in html
    assert 'value="GTM Engineering" checked' in _html(client, "/book")


def test_the_legal_pages_point_people_to_the_booking_page(client):
    for path in ("/privacy", "/terms"):
        html = _html(client, path)
        if 'href="mailto:' not in html:
            assert 'href="/book">Book a call</a> page' in html, path


def test_the_stylesheet_and_script_exist():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    css = open(os.path.join(root, "static", "css", "site.css"), encoding="utf-8").read()
    js = open(os.path.join(root, "static", "js", "site.js"), encoding="utf-8").read()
    assert "--acc:" in css and "--sky:" in css
    # Motion only runs when the visitor allows it, and the feed arrives as one object.
    assert "html.js.motion .feed {" in css and "var(--i)" not in css
    assert "/api/demo-request" in js and 'source: "book page"' in js
