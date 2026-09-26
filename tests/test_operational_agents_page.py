"""The Operational agents directory (/seo-aeo), rebuilt in the public site's
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
    r = c.get("/seo-aeo")
    assert r.status_code == 200
    return r.get_data(as_text=True)


def test_every_tool_has_a_brief_and_no_brief_is_orphaned():
    slugs = {t["slug"] for t in appmod._seo_tools()}
    briefs = appmod._SEO_TOOL_BRIEFS
    assert slugs - set(briefs) == set(), "tools with no brief on /seo-aeo"
    assert set(briefs) - slugs == set(), "briefs for tools that are not listed"
    for slug, b in briefs.items():
        for key in ("lead", "gives", "gets"):
            assert b.get(key, "").strip(), "%s has no %r" % (slug, key)
            assert "—" not in b[key], "no em dashes in written copy (%s)" % slug


def test_every_tool_gets_exactly_one_card(body):
    for t in appmod._seo_tools():
        assert body.count('data-tool="%s"' % t["slug"]) == 1, t["slug"]
        assert 'id="t-%s"' % t["slug"] in body
        assert 'href="/seo-aeo/%s" id="t-%s"' % (t["slug"], t["slug"]) in body


def test_the_figures_and_chips_count_the_same_list(body):
    tools = appmod._seo_tools()
    assert re.search(r'data-figure="tools">%d<' % len(tools), body)
    assert ">%d live now<" % len(tools) in body
    assert "Showing %d of %d" % (len(tools), len(tools)) in body
    for name, group in appmod._seo_tool_groups():
        key = name.lower()
        assert re.search(r'data-figure="%s">%d<' % (key, len(group)), body), name
        assert re.search(r'data-sa-group="%s">.*?%s <b>%d</b>' % (key, name, len(group)), body), name
        assert 'data-sa-groupbox="%s"' % key in body
        assert "%d tools</span>" % len(group) in body


def test_the_ticker_and_the_path_name_every_tool(body):
    for t in appmod._seo_tools():
        assert 'href="/seo-aeo/%s">' % t["slug"] in body, "missing from the ticker: " + t["slug"]
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
    # The section keeps its own title; only the hub card says "Operational agents".
    assert "SEO + AEO" in body
