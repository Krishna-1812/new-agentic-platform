""""SEO + AEO" became "Operational agents", 2026-10-18 (the owner).

The page moved from /seo-aeo to /operational-agents, and every agent on it opens at
/operational-agents/<slug>: the SEO Studio tools (were /seo-aeo/<slug>) and the paid marketing
agents (were /strategic-agents/paid-marketing/<slug>). The paid agents' JSON routes stay where they
were; only the pages moved. As with the renames before it, old links keep working and analytics
recorded under the old addresses fold into the new ones. A client workspace still opens its SEO
tools at /<account>/seo-aeo/<tool> and its agents at /<account>/agents/<slug>.
"""
import os
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as appmod  # noqa: E402
from tracker import paid_catalog  # noqa: E402


@pytest.fixture
def client():
    c = appmod.app.test_client()
    with c.session_transaction() as sess:
        sess["google_user"] = {"email": "reporting@markifydigital.com", "name": "T"}
    return c


# ── The new addresses ────────────────────────────────────────────────────────

def test_the_page_and_every_agent_open_under_operational_agents(client):
    assert client.get("/operational-agents").status_code == 200
    assert client.get("/operational-agents/%s" % appmod._SEO_TOOLS[0]["slug"]).status_code == 200
    for a in paid_catalog.AGENTS:
        assert paid_catalog.path(a["slug"]) == "/operational-agents/" + a["slug"]
        assert client.get(paid_catalog.path(a["slug"])).status_code == 200, a["slug"]


def test_a_paid_page_leads_back_to_the_operational_agents_page(client):
    body = client.get("/operational-agents/performance-summarizer").get_data(as_text=True)
    assert 'href="/operational-agents" class="bn-crumb">Operational Agents</a>' in body
    assert 'href="/operational-agents#paid-marketing" class="bn-crumb">Paid marketing</a>' in body
    assert 'href="/seo-aeo' not in body


def test_an_seo_tool_page_leads_back_to_the_operational_agents_page(client):
    body = client.get("/operational-agents/keyword-research").get_data(as_text=True)
    assert "Operational agents" in body and '"/seo-aeo"' not in body


def test_the_paid_json_routes_did_not_move():
    rules = {r.rule for r in appmod.app.url_map.iter_rules()}
    assert paid_catalog.PREFIX + "/api/gads/accounts" in rules
    assert not any(r.startswith("/operational-agents/api") for r in rules)


# ── Old links keep working ──────────────────────────────────────────────────

@pytest.mark.parametrize("old,new", [
    ("/seo-aeo", "/operational-agents"),
    ("/seo-aeo/", "/operational-agents"),
    ("/seo-aeo/keyword-research", "/operational-agents/keyword-research"),
    ("/seo-aeo/runs/7", "/operational-agents/runs/7"),
    ("/seo-aeo/runs/7.json", "/operational-agents/runs/7.json"),
    ("/seo-aeo/keyword-research?fresh=1", "/operational-agents/keyword-research?fresh=1"),
])
def test_an_old_seo_aeo_address_redirects(client, old, new):
    r = client.get(old)
    assert r.status_code == 308
    assert r.headers["Location"].endswith(new)


def test_an_old_seo_aeo_post_keeps_its_method(client):
    assert client.post("/seo-aeo/keyword-research", json={"x": 1}).status_code == 308


def test_an_old_paid_page_redirects_to_its_new_address(client):
    for a in paid_catalog.AGENTS:
        r = client.get("/strategic-agents/paid-marketing/" + a["slug"])
        assert r.status_code == 301, a["slug"]
        assert r.headers["Location"].endswith("/operational-agents/" + a["slug"])
    r = client.get("/strategic-agents/paid-marketing/campaign-book?build=" + "a" * 32)
    assert r.headers["Location"].endswith("/operational-agents/campaign-book?build=" + "a" * 32)


def test_an_old_paid_address_that_was_never_a_page_is_not_found(client):
    assert client.get("/strategic-agents/paid-marketing/not-an-agent").status_code == 404


def test_the_paid_sections_own_address_goes_to_its_group(client):
    r = client.get("/strategic-agents/paid-marketing")
    assert r.headers["Location"].endswith("/operational-agents#paid-marketing")


# ── Analytics recorded under the old addresses ──────────────────────────────

@pytest.mark.parametrize("old,new", [
    ("/seo-aeo", "/operational-agents"),
    ("/seo-aeo/keyword-research", "/operational-agents/keyword-research"),
    ("/p2/seo-aeo/keyword-research", "/operational-agents/keyword-research"),
    ("/p2/seo/keyword-research", "/operational-agents/keyword-research"),
    ("/strategic-agents/paid-marketing/segment-analysis", "/operational-agents/segment-analysis"),
    ("SEO + AEO Dashboards", "Operational Agents"),
])
def test_an_old_label_folds_into_the_new_one(old, new):
    assert appmod._page_label(old) == new


def test_a_workspace_address_is_not_folded():
    """A workspace still opens its SEO tools at /<account>/seo-aeo/<tool>, so that path is current."""
    assert appmod._page_label("/lumina/seo-aeo/keyword-research") == "/lumina/seo-aeo/keyword-research"
    assert appmod._page_label("/seo-aeo-tools") == "/seo-aeo-tools"


# ── The rest of the app knows the new section ───────────────────────────────

def test_the_new_section_is_internal_and_fenced_from_clients():
    assert appmod._is_internal_path("/operational-agents")
    assert "/operational-agents" in appmod.CLIENT_FENCE


def test_a_workspace_page_maps_to_its_new_global_address():
    assert appmod.ACCT_GLOBAL["seo-aeo/keyword-research"] == "/operational-agents/keyword-research"
    slug = paid_catalog.WORKSPACE[0]["slug"]
    assert appmod.ACCT_GLOBAL["agents/" + slug] == "/operational-agents/" + slug


def test_nothing_on_the_hub_links_to_the_old_address(client):
    body = client.get("/hub").get_data(as_text=True)
    assert 'href="/operational-agents"' in body
    assert 'href="/seo-aeo' not in body and '"/seo-aeo"' not in body
