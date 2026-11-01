"""The partner pages: white-label paid media for agencies (/partners/agencies), the partner programme for
paid marketing consultants (/partners/consultants), and the page that introduces both (/partners).

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

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import app as appmod  # noqa: E402
import site_pages  # noqa: E402
import site_seo  # noqa: E402

PARTNER_PAGES = {
    "/partners": "Grow with us.",
    "/partners/agencies": "Your clients.",
    "/partners/consultants": "You win them.",
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


@pytest.mark.parametrize("path,heading", sorted(PARTNER_PAGES.items()))
def test_each_partner_page_opens_with_its_heading_and_is_listed(client, path, heading):
    html = _html(client, path)
    h1 = _text(re.search(r"(?s)<h1.*?</h1>", html).group(0))
    assert heading in h1, h1
    assert (path, {"/partners": "partners", "/partners/agencies": "partner-agencies",
                   "/partners/consultants": "partner-consultants"}[path]) in site_seo.pages()
    assert "Allow: /partners" in client.get("/robots.txt").get_data(as_text=True)


def test_the_footer_and_the_hub_lead_to_both_programmes(client):
    assert '<a href="/partners">Partners</a>' in _html(client, "/")
    hub = _html(client, "/partners")
    for kind in site_pages.PARTNER_KINDS:
        assert 'href="/partners/%s"' % kind["slug"] in hub
        assert kind["name"] in _text(hub)


@pytest.mark.parametrize("path", ["/partners/agencies", "/partners/consultants"])
def test_each_landing_page_carries_its_own_application_form(client, path):
    html = _html(client, path)
    assert html.count('id="bookForm"') == 1 and 'data-source="partner page"' in html
    assert 'href="#apply"' in html and 'id="apply"' in html
    assert 'name="name"' in html and 'name="email"' in html
    pillar = "Agency partner" if path.endswith("agencies") else "Consultant partner"
    assert '<input type="hidden" name="pillar" value="%s">' % pillar in html


def test_an_application_reaches_the_team_with_every_answer(client):
    rows, slack = [], []
    with patch.object(appmod, "_demo_request_to_sheet", side_effect=lambda row: rows.append(row) or True), \
         patch.object(appmod, "_demo_request_to_slack", side_effect=lambda p: slack.append(p) or True), \
         patch.object(appmod, "_demo_request_to_email", return_value=True):
        r = client.post("/api/demo-request", json={
            "name": "Sam", "email": "sam@example.com", "pillar": "Consultant partner",
            "linkedin": "linkedin.com/in/sample", "based": "London", "years": "10 to 15",
            "clients": "1 or 2", "network": "D2C founders in the UK", "message": "Keen.",
            "source": "partner page"})
    assert r.get_json()["ok"] is True
    row = rows[0]
    assert row[4] == "Consultant partner" and row[8] == "partner page"
    assert row[5] == ("Based in: London\nLinkedIn: linkedin.com/in/sample\nYears in paid marketing: 10 to 15\n"
                      "Clients to bring: 1 or 2\nNetwork: D2C founders in the UK\n\nKeen.")
    assert "Clients to bring: 1 or 2" in slack[0]["message"]


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
    for path in ("/partners", "/partners/consultants"):
        text = _text(_html(client, path))
        assert rate in text, path
        assert set(re.findall(r"\d+\s?%", text)) <= {rate}, (path, set(re.findall(r"\d+\s?%", text)))
    consultants = _text(_html(client, "/partners/consultants"))
    assert "%s recurring commission" % rate in consultants and "partner agreement" in consultants
    assert rate in dict(site_pages.FAQ_CONSULTANT)["How much commission do I earn?"]
    assert rate in client.get("/llms-full.txt").get_data(as_text=True)


def test_linkedin_ads_is_among_the_channels_we_run_for_partners(client):
    agencies = _text(_html(client, "/partners/agencies"))
    assert "LinkedIn Ads" in agencies and "Google Ads, Meta and LinkedIn Ads" in agencies
    assert "LinkedIn Ads" in [name for _ic, name, _items in site_pages.AGENCY_SERVICES]
    assert "LinkedIn Ads" in dict(site_pages.FAQ_AGENCY)["Which channels do you run?"]
    # The agents read Google Ads and Meta; no partner page says they read every account.
    for path in ("/partners", "/partners/agencies", "/partners/consultants"):
        text = _text(_html(client, path))
        assert "16 agents read every account" not in text and "Agents on every account" not in text, path


def test_our_hours_fill_nine_hours_of_each_partners_day():
    for city, _note, work, ours in site_pages.AGENCY_ZONES:
        assert sum(b - a for a, b in ours) == 9, city
        assert all(0 <= a < b <= 24 for a, b in list(ours) + [work]), city


def test_the_leads_shown_to_consultants_are_signals_and_roles():
    assert set(site_pages.CONSULTANT_SIGNALS) <= set(site_pages.SIGNALS_BY_SLUG)
    for lead in site_pages.CONSULTANT_LEADS:
        assert set(lead) <= {"who", "where", "why", "src", "score", "meeting"}


def test_the_partner_questions_are_plain_and_short():
    assert site_pages.FAQ_AGENCY[0][0] == "What is white-label paid media?"
    assert site_pages.FAQ_CONSULTANT[0][0] == "How does the partner programme work?"
    for q, a in site_pages.FAQ_AGENCY + site_pages.FAQ_CONSULTANT:
        assert q.endswith("?") and a.endswith(".") and len(a) <= 400, q


def test_the_agency_page_is_marked_up_as_a_white_label_service(client):
    html = _html(client, "/partners/agencies")
    assert '"name": "White-label paid media"' in html or '"name":"White-label paid media"' in html


def test_llms_full_txt_carries_the_partner_programmes(client):
    body = client.get("/llms-full.txt").get_data(as_text=True)
    assert "### White-label paid media for agencies" in body
    assert "### The partner programme for paid marketing consultants" in body
    for q, a in site_pages.FAQ_AGENCY + site_pages.FAQ_CONSULTANT:
        assert "Q: %s\nA: %s" % (q, a) in body, q
