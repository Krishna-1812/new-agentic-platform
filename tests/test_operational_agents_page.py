"""The Operational agents directory (/operational-agents, was /seo-aeo), rebuilt in the public site's
voice on the same system as the Go-to-market directory.

Every figure, chip, step, ticker item and card on the page is generated from
_seo_tools() / _seo_tool_groups() and _SEO_TOOL_BRIEFS (app.py). What this
file pins is that those stay in step: a tool added to the studio's menu must
arrive with its brief, get exactly one card, and be counted everywhere the
page counts.
"""

import os
import re
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as appmod  # noqa: E402


@pytest.fixture
def body():
    c = appmod.app.test_client()
    with c.session_transaction() as sess:
        sess["google_user"] = {"email": "reporting@markifydigital.com", "name": "T"}
    r = c.get("/operational-agents")
    assert r.status_code == 200
    return r.get_data(as_text=True)


def test_every_tool_has_a_brief_and_no_brief_is_orphaned():
    slugs = {t["slug"] for t in appmod._seo_tools()}
    briefs = appmod._SEO_TOOL_BRIEFS
    assert slugs - set(briefs) == set(), "tools with no brief on /operational-agents"
    assert set(briefs) - slugs == set(), "briefs for tools that are not listed"
    for slug, b in briefs.items():
        for key in ("lead", "gives", "gets"):
            assert b.get(key, "").strip(), "%s has no %r" % (slug, key)
            assert "—" not in b[key], "no em dashes in written copy (%s)" % slug


def test_every_tool_gets_exactly_one_card(body):
    for t in appmod._seo_tools():
        assert body.count('data-tool="%s"' % t["slug"]) == 1, t["slug"]
        assert 'id="t-%s"' % t["slug"] in body
        assert 'href="/operational-agents/%s" id="t-%s"' % (t["slug"], t["slug"]) in body


def test_the_figures_and_chips_count_the_same_list(body):
    from tracker import paid_catalog
    tools = appmod._seo_tools()
    total = len(tools) + len(paid_catalog.AGENTS)
    assert re.search(r'data-figure="tools">%d<' % len(tools), body)
    # The paid agents are Live (2026-10-19); only the SEO tools are still counted as in build.
    assert ">%d live<" % len(paid_catalog.AGENTS) in body and ">%d in build<" % len(tools) in body
    assert "Showing %d of %d" % (total, total) in body and "All <b>%d</b>" % total in body
    assert re.search(r'data-figure="paid-marketing">%d<' % len(paid_catalog.AGENTS), body)
    for name, group in appmod._seo_tool_groups():
        key = name.lower()
        assert re.search(r'data-figure="%s">%d<' % (key, len(group)), body), name
        assert re.search(r'data-sa-group="%s">.*?%s <b>%d</b>' % (key, name, len(group)), body), name
        assert 'data-sa-groupbox="%s"' % key in body
        assert "%d tools</span>" % len(group) in body


def test_every_operational_agent_is_building_and_tagged_seo(body):
    """All the operational agents are still being built (2026-10-17, the owner): each card is
    Building, none Live, and each carries an "SEO" tag first, once."""
    import re as _re
    cards = [c for c in _re.findall(r'<a href="/operational-agents/[^"]+" id="t-[^"]+" class="sa-card".*?</a>', body, _re.S)
             if 'data-group="paid-marketing"' not in c]
    assert len(cards) == len(appmod._seo_tools())       # the SEO tools; the paid agents are pinned below
    for card in cards:
        assert 'data-badge="building"' in card and "sa-state--build" in card and ">Building<" in card
        assert "sa-state--live" not in card and ">Live<" not in card
        tags = _re.findall(r'<span class="sa-tag">([^<]*)</span>', card)
        assert tags[0] == "SEO" and tags.count("SEO") == 1, tags


def test_the_ticker_and_the_path_name_every_tool(body):
    for t in appmod._seo_tools():
        assert 'href="/operational-agents/%s">' % t["slug"] in body, "missing from the ticker: " + t["slug"]
        assert '<a href="#t-%s">' % t["slug"] in body, "missing from the path: " + t["slug"]


def test_every_job_step_points_at_a_card_on_the_page(body):
    targets = re.findall(r'href="#t-([a-z0-9-]+)" data-sa-jump', body)
    assert len(targets) >= 9, "the three common jobs should list their tools"
    for slug in targets:
        assert 'id="t-%s"' % slug in body


def test_the_page_runs_on_the_shared_directory_system(body):
    assert "strategic-agents.css?v=" in body
    assert "js/strategic-agents.js" in body
    assert 'class="sa"' in body
    # The page is "Operational agents" now (it was "SEO + AEO").
    assert "<title>Operational agents &middot;" in body
    assert '<span class="bn-crumb-cur" aria-current="page">Operational agents</span>' in body


def test_the_paid_marketing_agents_are_a_group_of_their_own_with_a_paid_marketing_pill(body):
    """Each paid agent is one card in the amber "Paid marketing" group, linking to its own page (not an SEO
    Studio embed), Live (2026-10-19, once Google Ads was connected), and leading its tags with "Paid marketing" where the SEO tools say "SEO"."""
    from tracker import paid_catalog
    assert 'id="paid-marketing" data-sa-groupbox="paid-marketing"' in body and "sa-group--d" in body
    assert 'data-sa-group="paid-marketing"><i class="sa-dot sa-dot--d"></i>Paid marketing <b>%d</b>' % len(paid_catalog.AGENTS) in body
    cards = [c for c in re.findall(r'<a href="/operational-agents/[^"]+" id="t-[^"]+" class="sa-card".*?</a>', body, re.S)
             if 'data-group="paid-marketing"' in c]
    assert len(cards) == len(paid_catalog.AGENTS) >= 1
    for a, card in zip(paid_catalog.AGENTS, cards):
        assert 'id="t-%s"' % a["slug"] in card and 'data-group="paid-marketing"' in card
        assert 'data-badge="live"' in card and "sa-state--live" in card and ">Live<" in card and ">Building<" not in card
        tags = re.findall(r'<span class="sa-tag">([^<]*)</span>', card)
        assert tags[0] == "Paid marketing" and "SEO" not in tags, tags
        assert 'class="sa-tick-i sa-tick-i--d" href="/operational-agents/%s"' % a["slug"] in body


def test_the_heading_says_operational_agents(body):
    h1 = re.search(r'<h1 class="sa-h1".*?</h1>', body, re.S).group(0)
    words = re.sub(r"<[^>]+>", " ", h1).split()
    assert words == ["Operational", "agents."], words
    assert "Own the answer" not in body


def test_the_paid_marketing_agents_come_first_and_the_seo_tools_after(body):
    """Paid marketing heads the page everywhere it lists agents: the ticker, the figures, the chips and the
    directory, where every paid card comes before every SEO card and is numbered first."""
    from tracker import paid_catalog
    paid = {a["slug"] for a in paid_catalog.AGENTS}
    seo = [t["slug"] for t in appmod._seo_tools()]
    cards = re.findall(r'<a href="/operational-agents/([^"]+)" id="t-[^"]+" class="sa-card"', body)
    assert cards[:len(paid)] == [a["slug"] for a in paid_catalog.AGENTS]
    assert set(cards[len(paid):]) == set(seo) and len(cards) == len(paid) + len(seo)
    nums = re.findall(r'<span class="sa-num">(\d+)</span>', body)
    assert nums == ["%02d" % i for i in range(1, len(cards) + 1)]
    ticker = re.findall(r'class="sa-tick-i[^"]*" href="/operational-agents/([^"]+)"', body)
    assert ticker[:len(paid)] == [a["slug"] for a in paid_catalog.AGENTS] and set(ticker[len(paid):]) == set(seo)
    assert body.index('data-figure="paid-marketing"') < body.index('data-figure="tools"')
    assert body.index('data-sa-group="paid-marketing"') < body.index('data-sa-group="research"')
    # The directory comes before the SEO guide sections.
    assert body.index('id="sa-dir-t"') < body.index('id="sa-flow-t"') < body.index('id="sa-jobs-t"')


def test_no_seo_tool_and_paid_agent_share_an_address():
    from tracker import paid_catalog
    assert not {t["slug"] for t in appmod._seo_tools()} & paid_catalog.SLUGS
    assert "runs" not in paid_catalog.SLUGS and "runs" not in {t["slug"] for t in appmod._seo_tools()}
