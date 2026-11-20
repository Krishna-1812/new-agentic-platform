"""The partner pages: white-label paid media for agencies (/outcomesdigital/partners/agencies), the partner
programme for paid marketing consultants (/outcomesdigital/partners/consultants), and the page that
introduces both (/outcomesdigital/partners). They are on the Outcomes Digital site (outcomes_site.py) since
November 2026; the Northaxis addresses they had (/partners and under it) send visitors there for good.

They are outreach landing pages, so each one carries its own application form, and their copy holds a
few lines: the team's location is said as what it gives a partner (hours that cover theirs), never as a
price, and the consultant's commission is one rate (site_pages.PARTNER_COMMISSION) everywhere it is named.
"""

import html as html_lib
import os
import re
import sys
from unittest.mock import patch

import pytest
from markupsafe import escape

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import app as appmod  # noqa: E402
import outcomes_site  # noqa: E402
import site_pages  # noqa: E402
import site_seo  # noqa: E402

HUB = "/outcomesdigital/partners"
AGENCIES, CONSULTANTS = HUB + "/agencies", HUB + "/consultants"
PARTNER_PAGES = {HUB: "Grow with us.", AGENCIES: "Your clients.", CONSULTANTS: "You win them."}


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


@pytest.mark.parametrize("path,heading", sorted(PARTNER_PAGES.items()))
def test_each_partner_page_opens_with_its_heading_on_the_outcomes_site(client, path, heading):
    html = _html(client, path)
    h1 = _text(re.search(r"(?s)<h1.*?</h1>", html).group(0))
    assert heading in h1, h1
    assert '<body data-page="od-' in html and 'class="od"' in html, "the Outcomes Digital layout"
    assert path[len(outcomes_site.PREFIX):] in [p for p, *_ in outcomes_site.PAGES]


@pytest.mark.parametrize("path", sorted(PARTNER_PAGES))
def test_the_partner_pages_stay_listed_on_search_engines(client, path):
    """Unlike the rest of the Outcomes Digital site, the partner pages may be listed: they keep the place in
    search results they had at /partners."""
    r = client.get(path)
    html = r.get_data(as_text=True)
    assert "X-Robots-Tag" not in r.headers and 'name="robots"' not in html
    assert '<link rel="canonical" href="%s%s">' % (appmod.SITE_URL, path) in html
    assert '<meta name="description" content="%s">' % escape(outcomes_site.LISTED[path]) in html
    assert "<loc>%s%s</loc>" % (appmod.SITE_URL, path) in client.get("/sitemap.xml").get_data(as_text=True)
    robots = client.get("/robots.txt").get_data(as_text=True)
    assert "Allow: /outcomesdigital/partners\n" in robots and "Allow: /partners\n" in robots
    # Its own address with a slash is the same page, and a missing page under it is never listed.
    assert "X-Robots-Tag" not in client.get(path + "/").headers
    assert client.get(HUB + "/nope").headers["X-Robots-Tag"] == "noindex, nofollow, noarchive"


@pytest.mark.parametrize("old,new", [("/partners", HUB), ("/partners/", HUB), ("/partners/agencies", AGENCIES),
                                     ("/partners/consultants", CONSULTANTS), ("/partners/nope", HUB)])
def test_the_old_northaxis_addresses_send_visitors_to_the_outcomes_pages(client, old, new):
    r = client.get(old)
    assert r.status_code == 301 and r.headers["Location"].endswith(new), (old, r.headers.get("Location"))


def test_northaxis_no_longer_shows_the_partner_pages_as_its_own(client):
    assert all(not p.startswith("/partners") for p, _ in site_seo.pages())
    assert all(href != "/partners" for href, _ in site_pages.NAV)
    for path in ("/", "/pricing", "/llms.txt", "/llms-full.txt"):
        assert "/partners" not in client.get(path).get_data(as_text=True), path


def test_partners_is_in_the_outcomes_menu_and_marked_on_every_partner_page(client):
    home = _html(client, "/outcomesdigital")
    assert '<a class="nv-link" href="%s">Partners</a>' % HUB in home
    assert '<a href="%s">Partners</a>' % HUB in home, "the footer, and the phone menu"
    for path in PARTNER_PAGES:
        assert '<a class="nv-link" href="%s" aria-current="page">Partners</a>' % HUB in _html(client, path), path


def test_the_hub_leads_to_both_programmes(client):
    hub = _html(client, HUB)
    for kind in site_pages.PARTNER_KINDS:
        assert 'href="%s/%s"' % (HUB, kind["slug"]) in hub
        assert kind["name"] in _text(hub)


@pytest.mark.parametrize("path", [AGENCIES, CONSULTANTS])
def test_each_landing_page_carries_its_own_application_form(client, path):
    html = _html(client, path)
    assert html.count('id="bookForm"') == 1 and 'data-source="outcomes digital"' in html
    assert 'href="#apply"' in html and 'id="apply"' in html
    assert 'name="name"' in html and 'name="email"' in html
    pillar = "Agency partner" if path.endswith("agencies") else "Consultant partner"
    assert "data-next" not in html, "the form thanks them in place, with the partner's own next steps"
    assert '<input type="hidden" name="pillar" value="%s">' % pillar in html


def test_an_application_reaches_the_team_in_leads_with_every_answer(client):
    rows, slack = [], []
    with patch.object(appmod, "_demo_request_to_sheet", side_effect=lambda row: rows.append(row) or True), \
         patch.object(appmod, "_demo_request_to_slack", side_effect=lambda p, ch="": slack.append((p, ch)) or True), \
         patch.object(appmod, "_demo_request_to_email", return_value=True):
        r = client.post("/api/demo-request", json={
            "name": "Sam", "email": "sam@example.com", "pillar": "Consultant partner",
            "linkedin": "linkedin.com/in/sample", "based": "London", "years": "10 to 15",
            "clients": "1 or 2", "network": "D2C founders in the UK", "message": "Keen.",
            "source": "outcomes digital"})
    assert r.get_json()["ok"] is True
    row = rows[0]
    assert row[4] == "Consultant partner" and row[8] == "outcomes digital"
    assert row[5] == ("Based in: London\nLinkedIn: linkedin.com/in/sample\nYears in paid marketing: 10 to 15\n"
                      "Clients to bring: 1 or 2\nNetwork: D2C founders in the UK\n\nKeen.")
    assert "Clients to bring: 1 or 2" in slack[0][0]["message"] and slack[0][1] == appmod.OUTCOMES_SLACK_CHANNEL


def test_the_form_script_sends_the_partner_answers_and_where_they_came_from():
    js = open(os.path.join(ROOT, "static", "js", "site.js"), encoding="utf-8").read()
    for name in ("based", "linkedin", "years", "clients", "network"):
        assert '%s: val("%s")' % (name, name) in js, name
    assert 'form.getAttribute("data-source")' in js


@pytest.mark.parametrize("path", sorted(PARTNER_PAGES))
def test_the_team_is_placed_by_its_hours_never_by_its_price(client, path):
    text = _text(_html(client, path)).lower()
    assert "india" in text
    for word in ("cheap", "low-cost", "low cost", "labour", "labor", "offshore", "outsourc"):
        assert word not in text, (path, word)


def test_the_commission_is_one_rate_everywhere_it_is_named(client):
    rate = site_pages.PARTNER_COMMISSION
    assert rate == "20%"
    for path in (HUB, CONSULTANTS):
        text = _text(_html(client, path))
        assert rate in text, path
        assert set(re.findall(r"\d+\s?%", text)) <= {rate}, (path, set(re.findall(r"\d+\s?%", text)))
    consultants = _text(_html(client, CONSULTANTS))
    assert "%s recurring commission" % rate in consultants and "partner agreement" in consultants
    assert rate in dict(site_pages.FAQ_CONSULTANT)["How much commission do I earn?"]


def test_linkedin_ads_is_among_the_channels_we_run_for_partners(client):
    agencies = _text(_html(client, AGENCIES))
    assert "LinkedIn Ads" in agencies and "Google Ads, Meta and LinkedIn Ads" in agencies
    assert "LinkedIn Ads" in [name for _ic, name, _items in site_pages.AGENCY_SERVICES]
    assert "LinkedIn Ads" in dict(site_pages.FAQ_AGENCY)["Which channels do you run?"]
    # The agents read Google Ads and Meta; no partner page says they read every account.
    for path in PARTNER_PAGES:
        text = _text(_html(client, path))
        assert "16 agents read every account" not in text and "Agents on every account" not in text, path


def test_the_agency_page_has_no_hours_chart_and_its_sections_count_in_order(client):
    html = _html(client, AGENCIES)
    assert 'id="hours"' not in html and "Brief us as you log off" not in html and "z-track" not in html
    assert not hasattr(site_pages, "AGENCY_ZONES")
    nums = re.findall(r'<div class="shead-l"><span class="idx">(\d\d)<', html)
    assert nums == ["%02d" % i for i in range(int(nums[0]), int(nums[0]) + len(nums))], nums


def test_the_leads_shown_to_consultants_are_signals_and_roles():
    assert set(site_pages.CONSULTANT_SIGNALS) <= set(site_pages.SIGNALS_BY_SLUG)
    for lead in site_pages.CONSULTANT_LEADS:
        assert set(lead) <= {"who", "where", "why", "src", "score", "meeting"}


def test_the_partner_questions_are_plain_and_short():
    assert site_pages.FAQ_AGENCY[0][0] == "What is white-label paid media?"
    assert site_pages.FAQ_CONSULTANT[0][0] == "How does the partner programme work?"
    for q, a in site_pages.FAQ_AGENCY + site_pages.FAQ_CONSULTANT:
        assert q.endswith("?") and a.endswith(".") and len(a) <= 400, q


def test_the_partner_pages_link_only_within_the_outcomes_site(client):
    """No link back to Northaxis: the signals are shown without their Northaxis pages, and the forms thank
    the applicant with a link to this site."""
    consultants = _html(client, CONSULTANTS)
    assert 'href="/signals' not in consultants and consultants.count('class="cell play-cell"') == len(site_pages.CONSULTANT_SIGNALS)
    assert 'href="/outcomesdigital/case-studies">Meanwhile, read our case studies' in consultants
    assert 'href="/outcomesdigital/ppc-management">Meanwhile, see how we run PPC' in _html(client, AGENCIES)
