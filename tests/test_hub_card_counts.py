"""The hub card's "N dashboards / N live" must match the dashboard page.

These two numbers are hand-written in templates/hub.html while the cards they
describe live in templates/b2b_agents.html, so they drift the moment someone
adds a dashboard and forgets. That is exactly what happened: Contact Finder was
added, the card kept saying "6 dashboards / 5 live", and nothing complained,
because a stale number is not an error, just a quiet lie on the busiest page in
the app.

So the counts are derived from the dashboard page here and compared to what the
hub advertises. Adding a dashboard now fails this test until the card is updated,
which is the only way a hand-maintained number stays honest.

Also checked: every capability the card's prose claims corresponds to a card that
is actually live, so the description cannot promise something unbuilt. Job Change
Alert was the last "Coming soon" card and shipped 2026-08-17 -- there are no soon
cards left on this page now, which is itself worth pinning (the next unbuilt card
added here should make that state visible again, not silently).
"""

import os
import re
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)

import app as appmod  # noqa: E402


def _render(path):
    """Read the RENDERED page rather than the template source.

    Both pages were re-skinned onto the Bento design system, and with that the
    withdrawn rows moved from HTML comments to Jinja comments -- which never
    reach the browser at all, instead of shipping a hidden agent's name and URL
    to every visitor. So there is nothing left to strip here: what renders IS
    the roster.

    What these tests read is data attributes, not class names. The presentation
    is expected to change again; data-agent, data-state, data-count and
    data-figure are the contract, and a re-skin that drops one of them should
    fail loudly rather than quietly stop checking anything.
    """
    c = appmod.app.test_client()
    with c.session_transaction() as sess:
        sess["google_user"] = {"email": "reporting@markifydigital.com", "name": "T"}
    r = c.get(path)
    assert r.status_code == 200, "%s -> %s" % (path, r.status_code)
    return r.get_data(as_text=True)


@pytest.fixture(scope="module")
def dashboard_cards():
    """Two independent axes, and folding them together is a real bug:

      data-state   is this dashboard on the roster at all (active / soon)
      data-badge   is the one on the roster finished (live / building)

    The hub's "N live" counts the FIRST. Two rows are on the roster while still
    being built, so counting data-badge instead would quietly report 9.
    """
    body = _render("/strategic-agents")
    rows = re.findall(
        r'data-agent="[^"]*"\s+data-state="(\w+)"(?:\s+data-badge="(\w+)")?(.*?)</a>',
        body, re.S)
    out = {"live": [], "soon": [], "building": []}
    for state, badge, block in rows:
        m = re.search(r"data-agent-name>(.*?)<", block, re.S)
        name = re.sub(r"\s+", " ", m.group(1)).strip() if m else "?"
        out["live" if state == "active" else "soon"].append(name)
        if badge == "building":
            out["building"].append(name)
    out["total"] = len(out["live"]) + len(out["soon"])
    return out


def _workspace(slug):
    """One workspace tile on the hub, parsed from the rendered page."""
    body = _render("/hub")
    block = body.split('data-ws="%s"' % slug, 1)[1].split("</a>", 1)[0]
    stats = dict((label, int(n)) for label, n in
                 re.findall(r'data-count="(\w+)">(\d+)<', block))
    desc = re.sub(r"\s+", " ",
                  re.search(r"data-ws-desc>(.*?)</p>", block, re.S).group(1)).strip()
    title = re.sub(r"\s+", " ",
                   re.search(r"data-ws-name>(.*?)</div>", block, re.S).group(1)).strip()
    return {"stats": stats, "desc": desc, "title": title}


@pytest.fixture(scope="module")
def hub_card():
    return _workspace("strategic-agents")


# ── The numbers ─────────────────────────────────────────────────────────────

def test_the_advertised_dashboard_count_matches_the_page(hub_card, dashboard_cards):
    assert hub_card["stats"]["dashboards"] == dashboard_cards["total"], (
        "hub says %d dashboards, the page shows %d (%s)"
        % (hub_card["stats"]["dashboards"], dashboard_cards["total"],
           ", ".join(dashboard_cards["live"] + dashboard_cards["soon"])))


def test_the_advertised_live_count_matches_the_page(hub_card, dashboard_cards):
    assert hub_card["stats"]["live"] == len(dashboard_cards["live"]), (
        "hub says %d live, the page has %d: %s"
        % (hub_card["stats"]["live"], len(dashboard_cards["live"]),
           ", ".join(dashboard_cards["live"])))


def test_the_directory_hero_figures_match_its_own_rows(dashboard_cards):
    """The agents page opens with three figures (agents, live, in build) set in
    its hero. They are typed into the markup so the page reads correctly with
    JS off, which means they can drift from the rows below them exactly the
    way the hub card could, so they are held to the same rows."""
    body = _render("/strategic-agents")
    figs = dict(re.findall(r'data-figure="(\w+)">([\d,]+)<', body))
    assert int(figs["agents"]) == dashboard_cards["total"]
    assert int(figs["live"]) == len(dashboard_cards["live"]) - len(dashboard_cards["building"])
    assert int(figs["building"]) == len(dashboard_cards["building"])
    assert ">%d live now<" % int(figs["live"]) in body.replace("<i></i>", "")


def test_live_is_never_more_than_total(hub_card):
    assert hub_card["stats"]["live"] <= hub_card["stats"]["dashboards"]


def test_contact_finder_is_one_of_the_live_dashboards(dashboard_cards):
    """The dashboard whose addition caused the drift. Pinned so the counts have
    a concrete reason to be what they are."""
    assert "Contact Finder" in dashboard_cards["live"]


def test_soon_cards_would_be_counted_as_dashboards_but_not_as_live(dashboard_cards):
    """No "Coming soon" card exists on this page right now (Job Change Alert,
    the last one, shipped 2026-08-17) -- this just pins that the total/live
    split still adds up correctly, so it keeps holding whenever a soon card is
    reintroduced rather than only being checked incidentally."""
    assert dashboard_cards["total"] == len(dashboard_cards["live"]) + len(dashboard_cards["soon"])


def test_job_change_alert_is_one_of_the_live_dashboards(dashboard_cards):
    """The dashboard whose shipping retired the last "Coming soon" card."""
    assert "Job Change Alert" in dashboard_cards["live"]


def test_linkedin_playbook_studio_is_one_of_the_live_dashboards(dashboard_cards):
    """The dashboard that bumped the count from 6/6 to 7/7 on 2026-08-20."""
    assert "LinkedIn Strategy Researcher" in dashboard_cards["live"]


# ── The prose ───────────────────────────────────────────────────────────────

def test_the_card_is_named_b2b_agents(hub_card):
    """Named from brand.py rather than pinned to a string.

    This started life guarding a rename ("GTM" -> "B2B Agents" -> "Strategic
    Agents") reaching the hub. The section's name is now a single value in
    brand.py that every surface reads, so asserting today's literal would only
    re-break on the next rename while proving nothing; what still matters is
    that the tile agrees with that value and carries no retired name.
    """
    from brand import BRAND
    assert hub_card["title"] == BRAND["agents_plural"]
    assert hub_card["title"] not in ("GTM", "B2B Agents")


def test_the_description_mentions_contact_lookup(hub_card):
    """A whole live dashboard was missing from the copy."""
    assert "contact lookup" in hub_card["desc"].lower()


def test_the_description_mentions_job_change_alerts_now_that_it_shipped(hub_card, dashboard_cards):
    """Job Change Alert shipped 2026-08-17 -- the description saying so is no
    longer overselling an unbuilt card, it's the same "every live capability is
    named" rule test_the_description_mentions_contact_lookup pins above."""
    assert "job change" in hub_card["desc"].lower() or "job-change" in hub_card["desc"].lower()
    assert "Job Change Alert" in dashboard_cards["live"]


def test_42_north_dental_slot_checker_is_one_of_the_live_dashboards(dashboard_cards):
    """The dashboard that took the count from 7/7 to 8/8 on 2026-08-21."""
    assert "42 North Dental Slot Checker" in dashboard_cards["live"]


def test_the_description_mentions_appointment_availability(hub_card, dashboard_cards):
    """Same "every live capability is named" rule as contact lookup and job
    changes above: the Slot Checker is a whole live dashboard, so the copy has to
    account for it rather than leaving it invisible on the busiest page."""
    assert "appointment availability" in hub_card["desc"].lower()
    assert "42 North Dental Slot Checker" in dashboard_cards["live"]


def test_social_media_intelligence_analyst_is_one_of_the_live_dashboards(dashboard_cards):
    """The dashboard that took the count from 8/8 to 9/9 on 2026-08-26, once
    all 6 platforms and the synthesis report shipped and it came out from
    behind HIDDEN_AGENT_SLUGS."""
    assert "Social Media Intelligence" in dashboard_cards["live"]


def test_the_description_mentions_creative_analysis(hub_card, dashboard_cards):
    """Same "every live capability is named" rule as the others above."""
    assert "creative analysis" in hub_card["desc"].lower()
    assert "Social Media Intelligence" in dashboard_cards["live"]


def test_the_description_does_not_call_it_scraping(hub_card):
    """The tool is LinkedIn Intelligence; "LinkedIn scraping" both misnamed it
    and read badly on the busiest page in the app."""
    assert "scraping" not in hub_card["desc"].lower()


def test_the_description_has_no_em_dash(hub_card):
    assert "—" not in hub_card["desc"]


# ── The other card, so this file covers the whole hub ───────────────────────

def test_the_seo_card_count_matches_the_tool_list():
    """Same class of drift, different tile: this count is generated from
    _seo_tools(), so it can be checked against the source of truth directly."""
    assert _workspace("seo-aeo")["stats"]["dashboards"] == len(appmod._seo_tools())


# ── The "by the numbers" band, same hand-maintained-number risk ─────────────

def _hub_band():
    """The figures are tiles of the hub grid now rather than a band beneath it,
    and each renders its value directly instead of being counted up from zero by
    a script. data-figure is what identifies them."""
    body = _render("/hub")
    return dict((label, int(n.replace(",", "").rstrip("+")))
                for label, n in
                re.findall(r'data-figure="(\w+)">([\d,]+\+?)<', body))


def test_the_hub_band_dashboard_total_matches_the_live_cards(hub_card, dashboard_cards):
    """The band counts LIVE dashboards across all three workspaces (Strategic
    Agents + SEO Studio + Company Signal Tracker) plus the Google Ads
    dashboard behind the Dashboards card, so it drifts on exactly the same
    trigger as the card stats above. If someone later decides it should count
    every card including "Coming soon" ones, this is the test to change
    deliberately rather than discover by accident."""
    expected = (len(dashboard_cards["live"]) + len(appmod._seo_tools())
                + sum(1 for cfg in appmod.ACCOUNTS.values() if cfg["dashboard"].exists())
                + 1)  # the Google Ads dashboard
    assert _hub_band()["dashboards"] == expected, (
        "band says %d dashboards, live cards total %d"
        % (_hub_band()["dashboards"], expected))


# ── The third workspace, Dashboards ──────────────────────────────────────────

def test_the_dashboards_card_opens_the_google_ads_dashboard():
    ws = _workspace("dashboards")
    assert ws["title"] == "Dashboards"
    assert ws["stats"] == {"dashboards": 1, "live": 1}
    assert re.search(r'<a href="/dashboards/google-ads"[^>]*data-ws="dashboards"', _render("/hub"))


def test_the_operational_agents_card_replaced_seo_aeo(hub_card):
    """The SEO + AEO workspace card reads "Operational agents" now; its own
    page (/seo-aeo) keeps its original title untouched."""
    assert _workspace("seo-aeo")["title"] == "Operational agents"


def test_the_card_copy_makes_no_unverifiable_headcount_claim(hub_card):
    """The Strategic Agents card cites no company figure of its own. The two places that
    do quote one (the band below, and the ABM card on the dashboard page) now both
    derive it from the dashboards, which is what stopped them disagreeing; adding a
    third hardcoded figure here would restart the problem."""
    assert not re.search(r"\d[\d,]*\+", hub_card["desc"]), \
        "quote the derived tracked_companies value or no figure at all"
