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


def test_a_route_several_agents_share_is_granted_when_any_of_them_is_shared(seeded):
    """The account list is every paid agent's that reads it: sharing any one of them is enough to list the accounts."""
    readers = [a["slug"] for a in paid_catalog.AGENTS if paid_catalog._ACCOUNTS in a["api"]]
    assert len(readers) > 1 and appmod._client_route_tools(API + "accounts") == readers
    assert appmod._client_route_tools(SEG + "accounts") == [a["slug"] for a in paid_catalog.AGENTS
                                                             if paid_catalog._SEGMENTS in a["api"]]
    last = readers[-1]
    T._invite("lumina", **{"tool:" + last: True})
    assert _ids(T._client(T.CLIENT).get(API + "accounts", headers=XA)) == [LUMINA]


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


# ── Segment Analysis: accounts and MCCs, and the summary's cost ───────────────

SEG = "/strategic-agents/paid-marketing/api/segments/"
SEG_RANGE = "&from=2026-10-01&to=2026-10-07"


@pytest.fixture
def segs(monkeypatch):
    from tracker import paid_gads_segments, paid_segment_insights, paid_segments
    monkeypatch.setattr(paid_segment_insights, "build", lambda report: [])
    groups = [{"id": "mcc-1", "name": "Lumina group", "currency": "INR", "accountIds": [LUMINA]},
              {"id": "mcc-2", "name": "Mixed group", "currency": "INR", "accountIds": [LUMINA, OTHER]}]
    monkeypatch.setattr(paid_gads_segments, "config_problem", lambda: None)
    monkeypatch.setattr(paid_gads_segments, "inventory", lambda: {"accounts": [
        {"id": i, "name": n, "currency": "INR", "group": ""} for i, n in ((LUMINA, "Lumina Ads"), (OTHER, "Other"))],
        "groups": groups})
    monkeypatch.setattr(paid_gads_segments, "list_groups", lambda: groups)
    read = []

    def report_for(account, a, b, **k):
        read.append(account)
        return {"account": {"id": account, "name": "Lumina Ads", "currency": "INR"},
                "range": {"from": a, "to": b}, "segments": [], "total": {}, "types": [], "warnings": [],
                "generatedAt": "2026-10-08T00:00:00+00:00"}
    monkeypatch.setattr(paid_segments, "report_for", report_for)
    return read


def test_inside_a_workspace_the_segment_pages_list_its_accounts_and_only_its_whole_mccs(seeded, segs):
    c = T._client(T.RAJ)
    every = c.get(SEG + "accounts").get_json()
    assert [a["id"] for a in every["accounts"]] == [LUMINA, OTHER] and len(every["groups"]) == 2
    mine = c.get(SEG + "accounts", headers=XA).get_json()
    assert [a["id"] for a in mine["accounts"]] == [LUMINA] and [g["id"] for g in mine["groups"]] == ["mcc-1"]
    assert mine["scoped"] is True


def test_inside_a_workspace_a_segment_report_reads_only_what_is_its_own(seeded, segs, ads):
    c = T._client(T.RAJ)
    for other in (OTHER, "mcc-2", META, LUMINA + "+" + META):
        assert c.get(SEG + "report?account=" + other + SEG_RANGE, headers=XA).status_code == 403, other
    assert segs == [], "a refused target is never fetched"
    for mine in (LUMINA, "mcc-1"):
        assert c.get(SEG + "report?account=" + mine + SEG_RANGE, headers=XA).status_code == 200, mine
    assert ads[-1][1:3] == ("segment-analysis", "mcc-1")
    assert c.get(SEG + "report?account=" + OTHER + SEG_RANGE).status_code == 200, "outside a workspace, any account"


def test_the_segment_summary_is_booked_to_the_person_and_the_workspace(seeded, segs, monkeypatch):
    from tracker import paid_segment_insights, paid_spend
    booked = []
    monkeypatch.setattr(paid_segment_insights, "cached_summary", lambda key, report, items, **k: (
        booked.append(paid_spend._who.get()) or {"summary": "ok", "topActions": [], "source": "model"}))
    appmod._SEGMENT_SUMMARY_USES.clear()
    body = {"account": LUMINA, "from": "2026-10-01", "to": "2026-10-07"}
    r = T._client(T.RAJ).post(SEG + "summary", json=body, headers=dict(XA, Origin="http://localhost"))
    assert r.status_code == 200 and booked == [("segment-analysis", T.RAJ, T._acct("lumina")["space"])]
    assert paid_spend._who.get() is None, "nothing outside the request is charged"
    appmod._SEGMENT_SUMMARY_USES.clear()


def test_inside_a_workspace_a_geo_report_reads_only_what_is_its_own(seeded, segs, ads, monkeypatch):
    from tracker import paid_geo
    read = []
    monkeypatch.setattr(paid_geo, "report_for", lambda account, level, a, b, **k: read.append(account) or {
        "account": {"id": account, "name": "Lumina Ads"}, "level": level, "range": {"from": a, "to": b}, "views": {}})
    c = T._client(T.RAJ)
    geo = "/strategic-agents/paid-marketing/api/geo/report?level=city&account="
    for other in (OTHER, "mcc-2", META):
        assert c.get(geo + other + SEG_RANGE, headers=XA).status_code == 403, other
    assert read == []
    assert c.get(geo + LUMINA + SEG_RANGE, headers=XA).status_code == 200 and read == [LUMINA]
    assert ads[-1][1:3] == ("geo-performance", LUMINA) and "by city" in ads[-1][5]


def test_inside_a_workspace_seasonality_reads_only_its_own_accounts(seeded, ads, monkeypatch):
    from tracker import paid_seasonality
    read = []
    monkeypatch.setattr(paid_seasonality, "report", lambda store, accts, months: read.append([a["id"] for a in accts]) or {"months": months})
    c = T._client(T.RAJ)
    for other in (BLOOM, META, LUMINA + "+" + META):
        assert c.get(API + "seasonality?account=" + other, headers=XA).status_code == 400, other
    assert read == []
    assert c.get(API + "seasonality?account=" + LUMINA, headers=XA).status_code == 200 and read == [[LUMINA]]
    assert ads[-1][1:3] == ("seasonality-analysis", LUMINA) and "Lumina Ads" in ads[-1][4]


def test_inside_a_workspace_the_audience_and_ad_strength_reports_read_only_what_is_its_own(seeded, segs, ads, monkeypatch):
    from tracker import paid_adstrength, paid_audiences
    read = []
    monkeypatch.setattr(paid_audiences, "report_for", lambda account, a, b, **k: read.append(account) or {
        "account": {"id": account, "name": "Lumina Ads"}, "range": {"from": a, "to": b}})
    monkeypatch.setattr(paid_adstrength, "report_for", lambda account, **k: read.append(account) or {
        "account": {"id": account, "name": "Lumina Ads"}})
    c = T._client(T.RAJ)
    base = "/strategic-agents/paid-marketing/api/"
    for route in ("audiences/report?" + SEG_RANGE[1:] + "&account=", "adstrength/report?account="):
        for other in (OTHER, "mcc-2", META):
            assert c.get(base + route + other, headers=XA).status_code == 403, (route, other)
        assert c.get(base + route + LUMINA, headers=XA).status_code == 200, route
    assert read == [LUMINA, LUMINA]
    assert [a[1] for a in ads[-2:]] == ["audience-segments", "ad-strength"]


def test_inside_a_workspace_asset_coverage_and_the_assets_it_opens_are_its_own(seeded, segs, ads, monkeypatch):
    from tracker import paid_assets
    read = []
    monkeypatch.setattr(paid_assets, "report_for", lambda account, **k: read.append(account) or {"account": {"id": account, "name": "Lumina Ads"}})
    monkeypatch.setattr(paid_assets, "campaign_detail_for", lambda account, campaign, **k: read.append(account) or {})
    monkeypatch.setattr(paid_assets, "library_for", lambda account, kind=None, state="all", level=None, **k: read.append(account) or {})
    c = T._client(T.RAJ)
    base = "/strategic-agents/paid-marketing/api/assets/"
    for route in ("report?account=", "campaign?campaign=5&account=", "library?kind=SITELINK&account="):
        for other in (OTHER, "mcc-2", META):
            assert c.get(base + route + other, headers=XA).status_code == 403, (route, other)
        assert c.get(base + route + LUMINA, headers=XA).status_code == 200, route
    assert read == [LUMINA] * 3
    assert [a[1] for a in ads] == ["asset-coverage"], "the report writes the History row, opening an asset does not"


def test_inside_a_workspace_the_audit_and_its_saved_copies_are_its_own(seeded, segs, ads, monkeypatch):
    from tracker import paid_audit, paid_audit_store
    read = []
    monkeypatch.setattr(paid_audit, "report_for", lambda account, **k: read.append(account) or {
        "accounts": [{"name": "Lumina Ads"}], "score": 72})
    monkeypatch.setattr(paid_audit_store, "get", lambda sid, key=None: {"id": sid, "accountKey": OTHER, "createdBy": T.RAJ})
    monkeypatch.setattr(paid_audit_store, "delete", lambda *a, **k: pytest.fail("deleted another account's audit"))
    c = T._client(T.RAJ)
    base = "/strategic-agents/paid-marketing/api/audit/"
    for other in (OTHER, META, LUMINA + "+" + META):
        assert c.get(base + "report?account=" + other, headers=XA).status_code == 403, other
        assert c.get(base + "download?file=pdf&account=" + other, headers=XA).status_code == 403, other
    assert read == []
    assert c.get(base + "report?account=" + LUMINA, headers=XA).status_code == 200 and read == [LUMINA]
    assert ads[-1][1:3] == ("account-audit", LUMINA) and ads[-1][5] == "Score 72"
    assert c.delete(base + "history/s1", headers=dict(XA, Origin="http://localhost"), content_type="application/json").status_code == 403


def test_inside_a_workspace_the_landing_page_check_reads_only_its_own_accounts(seeded, segs, ads, monkeypatch):
    from tracker import paid_lp, paid_spend
    read = []
    monkeypatch.setattr(paid_lp, "report_for", lambda account, **k: read.append(account) or {"accounts": [{"name": "Lumina Ads"}]})
    monkeypatch.setattr(paid_lp, "explain", lambda account, page: read.append((account, paid_spend._who.get()[0])) or {})
    c, same = T._client(T.RAJ), dict(XA, Origin="http://localhost")
    base = "/strategic-agents/paid-marketing/api/lp/"
    for other in (OTHER, META):
        assert c.get(base + "report?account=" + other, headers=XA).status_code == 403, other
        assert c.post(base + "read", json={"account": other, "page": "https://a.test/"}, headers=same).status_code == 403, other
    assert read == []
    assert c.get(base + "report?account=" + LUMINA, headers=XA).status_code == 200
    assert c.post(base + "read", json={"account": LUMINA, "page": "https://a.test/"}, headers=same).status_code == 200
    assert read == [LUMINA, (LUMINA, "landing-page-check")] and ads[-1][1:3] == ("landing-page-check", LUMINA)


def test_inside_a_workspace_the_experiment_tracker_reads_only_its_own_accounts(seeded, segs, ads, monkeypatch):
    from tracker import paid_exp
    read = []
    monkeypatch.setattr(paid_exp, "report_for", lambda account, **k: read.append(account) or {"accounts": [{"name": "Lumina Ads"}]})
    c, base = T._client(T.RAJ), "/strategic-agents/paid-marketing/api/exp/"
    for other in (OTHER, META):
        assert c.get(base + "report?account=" + other, headers=XA).status_code == 403, other
        assert c.get(base + "download?file=pdf&account=" + other, headers=XA).status_code == 403, other
    assert read == [] and c.get(base + "report?account=" + LUMINA, headers=XA).status_code == 200
    assert ads[-1][1:3] == ("experiment-tracker", LUMINA)
