"""Inside a client workspace, the operational agents open at /<account>/operational-agents/<slug>, 2026-10-19
(the owner), as they do at /operational-agents: each SEO Studio tool (was /<account>/seo-aeo/<tool>) and each
paid marketing agent (was /<account>/agents/<slug>). The old addresses redirect. The other agents stay at
/<account>/agents/<slug>. What a page is called for access, sharing and Client Usage did not change.
"""
import app as appmod
from tests import test_account_isolation as T
from tracker import account_history, paid_catalog

seeded = T.seeded
world = T.world


def test_an_seo_tool_and_a_paid_agent_open_under_operational_agents():
    c = T._client(T.RAJ)
    for slug in ("keyword-research", "performance-summarizer"):
        r = c.get("/lumina/operational-agents/" + slug)
        assert r.status_code == 200, slug
        assert 'data-acct-page="operational-agents/%s"' % slug in r.get_data(as_text=True), slug


def test_the_seo_tool_keeps_the_address_bar_inside_the_account():
    html = T._client(T.RAJ).get("/lumina/operational-agents/keyword-research").get_data(as_text=True)
    assert 'var SEO_BASE = "/lumina/operational-agents"' in html


def test_an_old_workspace_seo_address_redirects():
    c = T._client(T.RAJ)
    for old, new in (("/lumina/seo-aeo/keyword-research", "/lumina/operational-agents/keyword-research"),
                     ("/lumina/seo-aeo/keyword-research?x=1", "/lumina/operational-agents/keyword-research?x=1"),
                     ("/lumina/seo-aeo/runs/7", "/lumina/operational-agents/runs/7"),
                     ("/lumina/seo-aeo/runs/7.json", "/lumina/operational-agents/runs/7.json")):
        r = c.get(old)
        assert r.status_code == 301, old
        assert r.headers["Location"].endswith(new), (old, r.headers["Location"])
    assert c.post("/lumina/seo-aeo/keyword-research").status_code == 308


def test_an_old_workspace_paid_agent_address_redirects_and_the_other_agents_stay():
    c = T._client(T.RAJ)
    for slug in paid_catalog.WORKSPACE_SLUGS:
        r = c.get("/lumina/agents/" + slug)
        assert r.status_code == 301, slug
        assert r.headers["Location"].endswith("/lumina/operational-agents/" + slug)
    assert c.get("/lumina/agents/local-business-radar").status_code == 200


def test_the_pacing_desk_does_not_open_inside_a_workspace():
    assert T._client(T.RAJ).get("/lumina/operational-agents/pacing-desk").status_code != 200


def test_the_workspace_home_and_history_link_to_the_new_addresses(seeded):
    html = T._client(T.RAJ).get("/lumina").get_data(as_text=True)
    assert 'href="/lumina/operational-agents/keyword-research"' in html
    assert 'href="/lumina/operational-agents/performance-summarizer"' in html
    assert 'href="/lumina/seo-aeo/' not in html
    assert account_history.agent_href("lumina", "performance-summarizer") == "/lumina/operational-agents/performance-summarizer"
    assert account_history.agent_href("lumina", "local-business-radar") == "/lumina/agents/local-business-radar"


def test_a_client_opens_a_shared_seo_tool_at_its_new_address(seeded):
    T._invite("lumina", **{"tool:keyword-research": True})
    c = T._client(T.CLIENT)
    assert c.get("/lumina/operational-agents/keyword-research").status_code == 200
    assert c.get("/lumina/operational-agents/on-page-audit").status_code in (302, 403)


def test_switching_accounts_keeps_the_page():
    assert appmod.ACCT_GLOBAL["operational-agents/keyword-research"] == "/operational-agents/keyword-research"
