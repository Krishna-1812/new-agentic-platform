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
    "/plays": "The plays",
    "/plays/tenders-and-rfps": "Tenders and RFPs",
    "/industries": "Meetings in",
    "/industries/healthcare": "Meetings with clinics",
    "/agents": "Agents do the checking",
    "/compare": "Hire, retain, subscribe",
    "/about": "We get paid when you get buyers",
    "/outreach-policy": "How we reach people",
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
    # The previous site's design system and motion, then the new site's own layer on top.
    press = html.index('<link rel="stylesheet" href="/static/css/press.css')
    assert press < html.index('<link rel="stylesheet" href="/static/css/site.css')
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
    assert '<a class="btn btn-1" href="/book" data-cta="header">Book a call</a>' in html
    assert 'href="/login"' in html and 'href="/privacy"' in html and 'href="/terms"' in html
    assert '<a href="/old-site">Previous site</a>' in html
    assert "Book a demo" not in html and "Sign up" not in html


def test_the_current_page_is_marked_in_the_header(client):
    html = _html(client, "/pricing")
    assert '<a class="nv-link" href="/pricing" aria-current="page">Pricing</a>' in html
    assert '<a class="nv-link" href="/gtm-engineering" aria-current' not in html


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
    ("/platform", "/how-it-works", 301), ("/signals", "/plays", 301),
    ("/solutions", "/gtm-engineering", 301), ("/integrations", "/how-it-works", 301),
    ("/why-intelligence", "/compare", 301),
    ("/agents/signal-tracker", "/old-site/agents/signal-tracker", 302),
    ("/industries/health-tech", "/old-site/industries/health-tech", 302),
    ("/industries/healthcare/agents/patient-answer-visibility",
     "/old-site/industries/healthcare/agents/patient-answer-visibility", 302),
    ("/industries/no-such-industry", "/industries", 302), ("/plays/no-such-play", "/plays", 302),
    ("/resources", "/old-site/resources", 302),
])
def test_the_previous_sites_addresses_go_somewhere_useful(client, old, new, code):
    r = client.get(old)
    assert r.status_code == code and r.headers["Location"].endswith(new), (old, r.status_code)


def test_robots_lists_the_new_pages_and_not_the_old_site(client):
    body = client.get("/robots.txt").get_data(as_text=True)
    for path in ("/gtm-engineering", "/performance-marketing", "/how-it-works", "/pricing", "/book", "/plays",
                 "/industries", "/agents", "/compare", "/about", "/outreach-policy"):
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
    css = re.sub(r"/\*.*?\*/", "", open(os.path.join(root, "static", "css", "site.css"), encoding="utf-8").read(), flags=re.S)
    js = open(os.path.join(root, "static", "js", "site.js"), encoding="utf-8").read()
    assert "/api/demo-request" in js and 'source: "book page"' in js
    # The booking form throws press-play.js's confetti once it has gone through.
    assert "window.pressBurst" in js
    play = open(os.path.join(root, "static", "js", "press-play.js"), encoding="utf-8").read()
    assert "window.pressBurst = burst;" in play
    # Motion only runs when the visitor allows it (press-play.js sets html.play), and nothing
    # arrives card by card: a block's arrival is gated on .play and nothing is delayed by index.
    assert ".play .blk {" in css and "transform" not in css[css.index(".blk {"):css.index("}", css.index(".blk {"))]
    assert "var(--i)" not in css and "transition-delay" not in css and "animation-delay" not in css


def test_every_new_page_keeps_the_previous_sites_motion_rules():
    """The pages wear press.css and press-play.js, so the traps tests/test_press_site.py records
    for the old pages hold here too."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tpl_dir = os.path.join(root, "templates", "site")
    for name in sorted(os.listdir(tpl_dir)):
        markup = open(os.path.join(tpl_dir, name), encoding="utf-8").read()
        # A clip-path wipe on the element the reveal observes never un-clips.
        for m in re.finditer(r'class="([^"]*\brv\b[^"]*)"', markup):
            assert "wipe" not in m.group(1).split(), (name, m.group(1))
        # A heading's lines are joined by one space, so its words read as words without CSS.
        assert "</span></span><span class=\"ln\">" not in markup, name
    base = open(os.path.join(tpl_dir, "base.html"), encoding="utf-8").read()
    head = base[:base.index("<body")]
    assert "document.documentElement.className+=' js'" in head and "' vt'" in head
    assert "sessionStorage.getItem('nx-intro')" in head and "{% if page == 'home' %}" in head
    anime = base.index("filename='vendor/anime/anime.nx.min.js'")
    assert anime < base.index("filename='js/press-play.js'") < base.index("</body>")
    assert re.search(r'<script src="[^"]*press-play\.js[^"]*" defer></script>', base)


def test_the_decorative_motion_is_hidden_from_assistive_tech(client):
    html = _html(client, "/")
    assert '<div class="deck" id="deck" aria-hidden="true">' in html
    assert '<div class="kin" aria-hidden="true">' in html and '<div class="toys" aria-hidden="true">' in html
    # The ticker's second copy, there only so the loop is seamless, is not read or tabbed to twice.
    ticker = html[html.index('<div class="tick-track">'):]
    ticker = ticker[:ticker.index("</div>")]
    assert ticker.count('aria-hidden="true" tabindex="-1"') == len(site_pages.PLAYS)


# ── Plays and industries ────────────────────────────────────────────────────────

@pytest.mark.parametrize("play", site_pages.PLAYS, ids=lambda p: p["slug"])
def test_every_play_has_its_own_page(client, play):
    html = _html(client, "/plays/" + play["slug"])
    text = _text(html)
    assert play["name"] in text and play["lead"]["why"] in text and play["message"] in text
    assert "Run every morning by our %s agent." % play["agent"] in text
    for slug in play["fits"]:
        assert 'href="/industries/%s"' % slug in html
    # Three related plays, never itself.
    related = re.findall(r'<a class="cell play-cell" href="/plays/([^"]+)"', html)
    assert len(related) == 3 and play["slug"] not in related


def test_the_plays_page_lists_every_play_in_its_group(client):
    html = _html(client, "/plays")
    for key, label in site_pages.PLAY_GROUPS:
        assert label in html
    for p in site_pages.PLAYS:
        assert 'href="/plays/%s"' % p["slug"] in html
        assert p["group"] in dict(site_pages.PLAY_GROUPS)


@pytest.mark.parametrize("ind", site_pages.INDUSTRIES, ids=lambda i: i["slug"])
def test_every_industry_has_its_own_page(client, ind):
    html = _html(client, "/industries/" + ind["slug"])
    text = _text(html)
    assert ind["headline"] in text and ind["perf"] in text
    for sample in ind["samples"]:
        assert sample["lead"]["why"] in text and sample["message"] in text
    for slug in ind["plays"]:
        assert 'href="/plays/%s"' % slug in html
    for q, _a in ind["faq"]:
        assert q in text
    assert 'aria-current="page">Industries</a>' in html


def test_the_industries_page_lists_every_industry(client):
    html = _html(client, "/industries")
    for ind in site_pages.INDUSTRIES:
        assert 'href="/industries/%s"' % ind["slug"] in html


def test_plays_and_industries_point_at_each_other():
    for ind in site_pages.INDUSTRIES:
        assert set(ind["plays"]) <= set(site_pages.PLAYS_BY_SLUG), ind["slug"]
        assert len(ind["samples"]) == 3
    for play in site_pages.PLAYS:
        assert set(play["fits"]) <= set(site_pages.INDUSTRIES_BY_SLUG), play["slug"]


def test_every_sample_is_a_role_not_a_person():
    leads = [p["lead"] for p in site_pages.PLAYS] + [s["lead"] for i in site_pages.INDUSTRIES for s in i["samples"]]
    for lead in leads:
        assert set(lead) <= {"who", "where", "why", "src", "score", "meeting"}


# ── The agents, Compare, About and how we contact people ────────────────────────

def test_the_agents_page_names_every_agent_we_run(client):
    from tracker import paid_catalog
    text = _text(_html(client, "/agents"))
    for name, _does in site_pages.GTM_AGENTS + site_pages.SEARCH_AGENTS:
        assert name in text, name
    for a in paid_catalog.WORKSPACE:
        assert a["name"] in text and a["about"] in text, a["name"]
    total = len(site_pages.GTM_AGENTS) + len(paid_catalog.WORKSPACE) + len(site_pages.SEARCH_AGENTS)
    assert "%d agents watch" % total in text


def test_the_comparison_has_an_answer_for_every_option(client):
    html = _html(client, "/compare")
    text = _text(html)
    for q, answers in site_pages.COMPARE_ROWS:
        assert len(answers) == len(site_pages.COMPARE_OPTIONS), q
        assert q in text and all(a in text for a in answers), q
    assert html.count('class="us"') == len(site_pages.COMPARE_ROWS) + 1
    # The full comparison and the home page's short one agree on our row.
    assert site_pages.COMPARE[-1][-1] == dict(site_pages.COMPARE_ROWS)["If it doesn't work"][-1]


def test_how_we_contact_people_says_what_the_opt_out_does(client):
    text = _text(_html(client, "/outreach-policy"))
    assert "one-click opt-out" in text and "for every client we work with, for good" in text
    # Leads are de-duplicated per client (br_identities is keyed by owner), so the site never claims
    # nobody is contacted twice across clients.
    for path in PAGES:
        assert "across every client" not in _text(_html(client, path)).replace(
            "honoured for every client at once", ""), path


def test_every_page_links_to_how_we_contact_people(client):
    for path in PAGES:
        assert 'href="/outreach-policy"' in _html(client, path), path
