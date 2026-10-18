"""The Paid Marketing Agents inside a client workspace (app.py _pm_scope, docs/paid-marketing-plan.md).

Outside a workspace the team reads any account the agency's manager account holds, and any Meta ad account the
token reads. Inside one, only the workspace's own Google Ads accounts (its profile's customer ids) can be listed
or read, by the team and by a client the workspace shares the agent with; no Meta ad account, since a workspace
names none yet. A client keeps their own ad figures (spend, cost), which the platform otherwise hides from
clients as the agency's costs. A read inside a workspace is one History row per agent, account and day.
"""
import pytest

import app as appmod
from tests import test_account_isolation as T
from tracker import account_history, paid_activity, paid_catalog, paid_gads, paid_meta, paid_store

seeded = T.seeded
world = T.world
XA = {"X-Account": "lumina"}
API = "/strategic-agents/paid-marketing/api/gads/"
LUMINA, BLOOM, OTHER, META = "4121183390", "5121183390", "9999999999", "act_1000000000000001"
RANGE = "&start=2026-10-01&end=2026-10-07"


@pytest.fixture(autouse=True)
def ads(monkeypatch):
    noted = []
    monkeypatch.setattr(paid_gads, "config_problem", lambda: None)
    monkeypatch.setattr(paid_meta, "config_problem", lambda: None)
    monkeypatch.setattr(paid_gads, "list_accounts", lambda store, **k: [
        {"id": i, "name": n, "currency": "INR"} for i, n in ((LUMINA, "Lumina Ads"), (BLOOM, "Bloom Ads"), (OTHER, "Other"))])
    monkeypatch.setattr(paid_meta, "list_accounts", lambda store, **k: [{"id": META, "name": "Meta One", "currency": "INR",
                                                                       "platform": "meta"}])
    monkeypatch.setattr(paid_store, "gads_calls", lambda day: 0)
    monkeypatch.setattr(paid_gads, "blocked_until", lambda store=None: None)
    monkeypatch.setattr(paid_gads, "performance_pair", lambda *a, **k: (
        {"days": [], "campaigns": [{"name": "Search", "cost": 1234.5}], "rows": []}, None, []))
    monkeypatch.setattr(paid_activity, "record", lambda *a: noted.append(a))
    return noted


def _ids(resp):
    return [a["id"] for a in resp.get_json()["accounts"]]


def test_outside_a_workspace_the_team_reads_every_account(seeded):
    c = T._client(T.RAJ)
    assert _ids(c.get(API + "accounts?platform=both")) == [LUMINA, BLOOM, OTHER, META]
    assert c.get(API + "performance?account=" + OTHER + RANGE).status_code == 200


def test_inside_a_workspace_only_its_own_google_ads_accounts_are_listed_or_read(seeded, ads):
    c = T._client(T.RAJ)
    r = c.get(API + "accounts?platform=both", headers=XA).get_json()
    assert [a["id"] for a in r["accounts"]] == [LUMINA] and r["scoped"] is True
    assert "own Google Ads accounts only" in r["metaProblem"]
    for other in (BLOOM, OTHER, META):
        bad = c.get(API + "performance?account=" + other + RANGE, headers=XA)
        assert bad.status_code == 400, other
    ok = c.get(API + "performance?account=" + LUMINA + RANGE, headers=XA)
    assert ok.status_code == 200
    space, agent, account, who, title, detail = ads[-1]
    assert (space, agent, account, who) == (T._acct("lumina")["space"], "performance-summarizer", LUMINA, T.RAJ)
    assert "Lumina Ads" in title and "2026-10-01" in detail
    assert c.get(API + "extras?account=" + BLOOM + RANGE, headers=XA).status_code == 400


def test_a_read_outside_a_workspace_is_not_recorded(seeded, ads):
    T._client(T.RAJ).get(API + "performance?account=" + LUMINA + RANGE)
    assert ads == []


def test_a_workspace_with_no_google_ads_account_says_how_to_add_one(seeded, monkeypatch):
    monkeypatch.setattr(appmod, "_pm_scope", lambda: set())
    r = T._client(T.RAJ).get(API + "accounts", headers=XA)
    assert r.status_code == 409 and "customer id" in r.get_json()["configProblem"]
    r = T._client(T.RAJ).get(API + "accounts?platform=meta", headers=XA)
    assert r.status_code == 409 and "own Google Ads accounts only" in r.get_json()["error"]
    r = T._client(T.RAJ).get(API + "accounts?platform=both", headers=XA)
    assert r.status_code == 409 and "no Google Ads account" in r.get_json()["googleProblem"]


def test_a_client_reads_only_their_workspaces_accounts_and_keeps_their_own_ad_figures(seeded):
    T._invite("lumina", **{"tool:performance-summarizer": True})
    c = T._client(T.CLIENT)
    assert _ids(c.get(API + "accounts?platform=both", headers=XA)) == [LUMINA]
    assert c.get(API + "performance?account=" + BLOOM + RANGE, headers=XA).status_code == 400
    j = c.get(API + "performance?account=" + LUMINA + RANGE, headers=XA).get_json()
    assert j["current"]["campaigns"][0]["cost"] == 1234.5, "a client's own ad spend is not the agency's cost"
    assert c.get("/lumina/agents/performance-summarizer").status_code == 200


def test_a_client_the_agent_is_not_shared_with_cannot_read(seeded):
    T._invite("lumina")
    c = T._client(T.CLIENT)
    r = c.get(API + "accounts", headers=XA)
    assert r.status_code in (302, 403)


def test_a_route_several_agents_share_is_granted_when_any_of_them_is_shared(monkeypatch):
    """The account list is every paid agent's: sharing one agent must be enough to list the accounts."""
    monkeypatch.setitem(appmod._CLIENT_TOOL_RX, "zz-other-paid", appmod._CLIENT_TOOL_RX["performance-summarizer"])
    assert appmod._client_route_tools(API + "accounts") == ["performance-summarizer", "zz-other-paid"]


def test_the_history_shows_what_each_agent_read_in_the_workspace(seeded, monkeypatch):
    acct = T._acct("lumina")
    monkeypatch.setattr(paid_activity, "space_rows", lambda space, limit=50: [
        {"agent": "performance-summarizer", "account": LUMINA, "who": T.RAJ, "title": "Performance of Lumina Ads",
         "detail": "2026-10-01 to 2026-10-07", "at": "2026-10-18T10:00:00+00:00"},
        {"agent": "some-other-agent", "account": LUMINA, "who": T.RAJ, "title": "x", "detail": "", "at": "2026-10-18T09:00:00+00:00"}])
    rows = dict(account_history.AGENT_READS)["performance-summarizer"](acct)
    assert [(r["title"], r["tool_label"], r["href"]) for r in rows] == [
        ("Performance of Lumina Ads", "Performance Summarizer", "/lumina/agents/performance-summarizer")]


def test_every_paid_agent_is_in_every_workspace_with_its_colour():
    for a in paid_catalog.AGENTS:
        assert (a["slug"], a["endpoint"], paid_catalog.path(a["slug"])) in [x[:3] for x in appmod.ACCT_AGENTS]
        assert appmod.ACCT_TOOL_COLOURS[a["slug"]] == paid_catalog.COLOUR
        assert a["slug"] in appmod.CLIENT_TOOL_ROUTES and a["slug"] in appmod.CLIENT_RUN_ROUTES
        assert "—" not in a["lead"] + a["about"] + a["gives"] + a["gets"]


def test_the_workspace_home_has_a_paid_marketing_group_starting_with_its_google_ads_accounts(seeded):
    html = T._client(T.RAJ).get("/lumina").get_data(as_text=True)
    assert "Paid marketing <em>%d</em>" % len(paid_catalog.AGENTS) in html
    research = html.split("Paid marketing <em>", 1)[0]
    for a in paid_catalog.AGENTS:
        assert 'class="rx-ag rx-ag--%s" href="/lumina/agents/%s"' % (a["slug"], a["slug"]) in html
        assert 'rx-ag--%s"' % a["slug"] not in research, "a paid agent is in its own group, not among the research agents"
    assert "412-118-3390" in html.split("Paid marketing <em>", 1)[1].split("</ul>", 1)[0]
