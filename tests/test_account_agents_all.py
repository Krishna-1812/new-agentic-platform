"""Every agent opens inside every client account (app.py ACCT_AGENTS), for the whole team and for the
clients the account shares it with.

The agents page (templates/b2b_agents.html) is the list of agents. Each one on it is in ACCT_AGENTS,
or in ACCT_AGENTS_EXEMPT with the reason it is not, so a new agent cannot ship without a place in the
accounts: this file fails the build until it has one. Each agent in ACCT_AGENTS opens in an account,
names the account on every call, can be shared with a client (its routes and the runs that count) and
shows in the account's History.

Market Radar and People & Signals keep their work by owner: inside an account the owner is the
account's space, so the whole team shares it and no other account or person's General work shows.
"""

import os
import re

import pytest

import app as appmod
from tests import test_account_isolation as T
from tracker import account_history, client_access

seeded = T.seeded
world = T.world
CLIENT = T.CLIENT
XA = {"X-Account": "lumina"}
MR = "/strategic-agents/market-radar"
PS = "/strategic-agents/people-signals"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _share(*tools):
    T._invite("lumina", **{"tool:" + t: True for t in tools})


def _agents_page_hrefs():
    html = open(os.path.join(ROOT, "templates", "b2b_agents.html"), encoding="utf-8").read()
    return set(re.findall(r'<a href="([^"]+)"[^>]*class="sa-card"', html))


# ── Every agent has a place in the accounts ──────────────────────────────────
def test_every_agent_on_the_agents_page_opens_inside_the_accounts_or_says_why_not():
    cards = _agents_page_hrefs()
    assert len(cards) >= 16, "the agents page's cards were not found"
    in_accounts = {a[2] for a in appmod.ACCT_AGENTS}
    missing = cards - in_accounts - set(appmod.ACCT_AGENTS_EXEMPT)
    assert not missing, ("add these agents to ACCT_AGENTS (app.py) so every account has them, or to "
                         "ACCT_AGENTS_EXEMPT with the reason: %s" % sorted(missing))
    assert not set(appmod.ACCT_AGENTS_EXEMPT) - cards, "an exemption for an agent no longer on the page"
    assert not in_accounts & set(appmod.ACCT_AGENTS_EXEMPT), "an agent both in the accounts and exempt"
    assert all(appmod.ACCT_AGENTS_EXEMPT.values()), "every exemption says why"


@pytest.mark.parametrize("agent", appmod.ACCT_AGENTS, ids=lambda a: a[0])
def test_each_agent_in_the_accounts_is_wired_all_the_way(agent):
    slug, endpoint, path = agent[:3]
    assert endpoint in appmod.app.view_functions, "%s: no view %s" % (slug, endpoint)
    assert slug in appmod.CLIENT_TOOL_ROUTES and slug in appmod.CLIENT_RUN_ROUTES, \
        "%s: a client the account shares it with could open but not use it" % slug
    assert slug in appmod.ACCT_TOOL_COLOURS, slug
    assert slug in account_history.AGENT_NAMES, slug
    assert slug in dict(account_history.AGENT_READS) or slug == "company-people-intelligence", \
        "%s: its runs for an account would be missing from the account's History" % slug
    assert any(t["slug"] == slug for t in appmod._acct_tool_catalog()), "%s: not in the Share panel" % slug


@pytest.mark.parametrize("slug", [a[0] for a in appmod.ACCT_AGENTS])
def test_each_agent_opens_in_an_account_for_the_team_and_names_it_on_every_call(seeded, slug):
    html = T._client(T.RAJ).get("/lumina/agents/" + slug)
    assert html.status_code == 200, slug
    assert 'js/account-context.js?v=1" data-acct="lumina"' in html.get_data(as_text=True)
    assert 'href="/lumina/agents/%s"' % slug in T._client(T.RAJ).get("/lumina").get_data(as_text=True)


# ── Market Radar and People & Signals are the account's inside it ─────────────
def test_inside_an_account_their_work_is_the_accounts_and_outside_it_the_persons(seeded):
    with appmod.app.test_request_context(MR + "/api/clients", headers=XA):
        from flask import session
        session["google_user"] = {"email": T.RAJ}
        assert appmod._mr_email() == T._acct("lumina")["space"]
    with appmod.app.test_request_context(MR + "/api/clients"):
        from flask import session
        session["google_user"] = {"email": T.RAJ}
        assert appmod._mr_email() == T.RAJ
    with appmod.app.test_request_context(PS + "/api/runs/3/export.csv?acct=lumina"):
        from flask import session
        session["google_user"] = {"email": T.RAJ}
        assert appmod._mr_email() == T._acct("lumina")["space"], "a download link names the account"
    with appmod.app.test_request_context(PS + "/api/runs?acct=lumina", method="POST"):
        from flask import session
        session["google_user"] = {"email": T.RAJ}
        assert appmod._mr_email() == T.RAJ, "only a GET may name it in the address"


def test_a_people_signals_run_in_an_account_is_filed_to_it_with_who_started_it(seeded, monkeypatch):
    from tracker import account_mapper_store as store
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    started = []
    monkeypatch.setattr(store, "running_run", lambda owner: None)
    monkeypatch.setattr(store, "start_map", lambda st, owner, cap_usd=None, started_by=None:
                        started.append((owner, started_by, st)) or 7)
    body = {"companies": "Acme | acme.com", "roles": "VP Marketing", "briefs": False}
    assert T._client(T.RAJ).post(PS + "/api/runs", json=body, headers=XA).status_code == 202
    assert T._client(T.RAJ).post(PS + "/api/runs", json=body).status_code == 202
    assert started[0][:2] == (T._acct("lumina")["space"], T.RAJ)
    assert started[1][:2] == (T.RAJ, None), "General work stays the person's own"


# ── What a client of the account may do ──────────────────────────────────────
@pytest.mark.parametrize("path, tool", [
    (MR + "/api/clients", "market-radar"), (MR + "/api/clients/4", "market-radar"),
    (MR + "/api/clients/4/moves", "market-radar"), (MR + "/api/clients/4/rivals", "market-radar"),
    (MR + "/api/clients/4/map", "market-radar"),
    (MR + "/api/clients/4/report", "market-radar"),
    (MR + "/api/clients/4/monitor", "market-radar"), (MR + "/api/runs", "market-radar"),
    (MR + "/api/runs/9", "market-radar"), (MR + "/api/clients/4/competitors/2", "market-radar"),
    (MR + "/api/clients/4/update-now", None), (MR + "/api/tidy-events", None), (MR + "/api/cost-report", None),
    (PS + "/api/status", "people-signals"), (PS + "/api/runs", "people-signals"),
    (PS + "/api/runs/3/export.csv", "people-signals"), (PS + "/api/runs/3/reveal", None),
])
def test_a_client_reaches_the_agents_own_routes_but_never_the_paid_or_team_only_ones(path, tool):
    assert appmod._client_route_tool(path) == tool


def test_a_client_maps_for_free_and_never_reveals(seeded, monkeypatch):
    from tracker import account_mapper_store as store
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    monkeypatch.setattr(store, "running_run", lambda owner: None)
    started = []
    monkeypatch.setattr(store, "start_map", lambda st, owner, cap_usd=None, started_by=None:
                        started.append((owner, started_by, st, cap_usd)) or 7)
    _share("people-signals")
    c = T._client(CLIENT)
    body = {"companies": "Acme", "roles": "CMO", "briefs": True, "use_claude": True, "web_fill": True,
            "confirm_spend": True}
    r = c.post(PS + "/api/runs", json=body, headers=XA)
    assert r.status_code == 202, r.get_json()
    owner, by, st, cap = started[0]
    assert owner == T._acct("lumina")["space"] and by == CLIENT
    assert not (st["briefs"] or st["use_claude"] or st["web_fill"]) and cap == 0, "none of Claude's paid steps"
    r = c.post(PS + "/api/runs/7/reveal", json={"keys": [1], "cap_credits": 5, "confirm": True}, headers=XA)
    assert r.status_code in (302, 403), "a reveal spends the agency's credits"
    status = c.get(PS + "/api/status", headers=XA).get_json()
    assert status["client"] is True and "credits" not in status["saleshandy"] and "rate_limits" not in status["saleshandy"]
    page = c.get("/lumina/agents/people-signals").get_data(as_text=True)
    assert "data-am-client" in page and "after you confirm the credits" not in page
    staff = T._client(T.RAJ).get("/lumina/agents/people-signals").get_data(as_text=True)
    assert "data-am-client" not in staff and "after you confirm the credits" in staff


def test_a_client_uses_market_radar_without_prices_or_the_weekly_email(seeded):
    _share("market-radar")
    c = T._client(CLIENT)
    page = c.get("/lumina/agents/market-radar").get_data(as_text=True)
    assert "data-mr-client" in page and "$0.15" not in page and "$1.00" not in page and "Weekly updates" not in page
    staff = T._client(T.RAJ).get("/lumina/agents/market-radar").get_data(as_text=True)
    assert "data-mr-client" not in staff and "$0.15" in staff
    r = c.post(MR + "/api/clients/4/monitor", json={"enabled": True}, headers=XA)
    assert r.status_code == 403 and "team" in r.get_json()["error"]
    assert c.post(MR + "/api/clients/4/update-now", json={}, headers=XA).status_code in (302, 403)


def test_the_market_radar_report_opens_inside_the_account(seeded):
    staff = T._client(T.RAJ).get("/lumina/agents/market-radar/report/4")
    html = staff.get_data(as_text=True)
    assert staff.status_code == 200 and 'data-acct="lumina"' in html and 'data-home="/lumina/agents/market-radar"' in html
    assert 'href="/lumina/agents/market-radar#company-4"' in html
    c = T._client(CLIENT)
    T._invite("lumina")
    r = c.get("/lumina/agents/market-radar/report/4")
    assert r.status_code == 302 and r.headers["Location"].endswith("/lumina"), "not shared: back to the account"
    _share("market-radar")
    assert c.get("/lumina/agents/market-radar/report/4").status_code == 200
    assert c.get("/bloom/agents/market-radar/report/4").status_code == 403, "never another account's"


def test_a_client_never_sees_credits_or_caps():
    out = appmod._client_scrub({"runs": [{"id": 1, "credits_used": 4, "cost_cap_usd": 1.0}],
                                "usd_cap": 2, "usd_typical": 1, "credits_default": 9, "worst_credits": 3, "roles": 2})
    assert out == {"runs": [{"id": 1}], "roles": 2}


def test_the_pages_keep_their_links_inside_the_account():
    mr = open(os.path.join(ROOT, "static", "js", "market_radar.js"), encoding="utf-8").read()
    assert "'/strategic-agents/market-radar/report/'" in mr and mr.count("REPORT + encodeURIComponent") == 2
    assert "href=\"/strategic-agents/market-radar/report/" not in mr
    ps = open(os.path.join(ROOT, "static", "js", "account_mapper.js"), encoding="utf-8").read()
    assert "'/export.csv' + (AQ ? '?' + AQ : '')" in ps


# ── The account's History ────────────────────────────────────────────────────
def test_their_runs_show_in_the_accounts_history(seeded, monkeypatch):
    from datetime import datetime, timezone
    from tracker import account_mapper_store, market_radar_store
    acct = T._acct("lumina")
    at = datetime(2026, 10, 12, 9, tzinfo=timezone.utc)
    seen = []
    monkeypatch.setattr(market_radar_store, "space_runs", lambda owner, limit=60: seen.append(owner) or [
        {"id": 3, "client_id": 4, "mode": "collect", "status": "complete", "created_at": at,
         "started_by": T.RAJ, "domain": "lumina-mark.example", "name": "Lumina"}])
    monkeypatch.setattr(account_mapper_store, "space_runs", lambda owner, limit=60: seen.append(owner) or [
        {"id": 8, "status": "ready", "created_at": at, "started_by": T.ANA, "credits_used": 0,
         "settings": {"companies": [{"name": "Acme"}], "roles": ["CMO"]}}])
    rows = account_history.entries(acct)
    mr = next(r for r in rows if r.get("agent") == "market-radar")
    ps = next(r for r in rows if r.get("agent") == "people-signals")
    assert seen == [acct["space"], acct["space"]]
    assert mr["title"] == "Collected rivals' moves for Lumina" and mr["who"] == T.RAJ and mr["state"] == "ready"
    assert mr["href"] == "/lumina/agents/market-radar#company-4"
    assert ps["title"] == "Mapped Acme" and ps["detail"] == "CMO" and ps["state"] == "ready"
    assert ps["href"] == "/lumina/agents/people-signals#run-8"
    shown = account_history.for_client(rows, "lumina", tools=["market-radar"])
    assert [r["agent"] for r in shown if r.get("agent") in ("market-radar", "people-signals")] == ["market-radar"]


# ── On Postgres: an account's space is an owner like any other ───────────────
from tests.test_market_radar_store import pg  # noqa: E402,F401  (fixture)


def test_an_accounts_market_radar_and_people_signals_are_its_own(pg, monkeypatch):
    from decimal import Decimal
    from tracker import account_mapper_store as am_store, market_radar_store as mr_store
    monkeypatch.setattr(am_store, "_READY", False)
    lumina, bloom = "acct:1", "acct:2"
    entity = mr_store.upsert_entity("lumina-dental.com", name="Lumina Dental")
    client = mr_store.upsert_client(lumina, entity)
    run = mr_store.create_run(client, lumina, "baseline")
    mr_store.set_started_by(run, "Raj@MarkifyDigital.com")
    assert mr_store.get_client(client, lumina) and mr_store.get_client(client, bloom) is None
    assert mr_store.list_clients(bloom) == [] and mr_store.get_run(run, "raj@markifydigital.com") is None
    [row] = mr_store.space_runs(lumina)
    assert row["started_by"] == "raj@markifydigital.com" and row["name"] == "Lumina Dental" and row["mode"] == "baseline"
    assert mr_store.space_runs(bloom) == []
    rid = am_store.create_run(lumina, {"companies": [{"name": "Acme"}], "roles": ["CMO"]}, Decimal("0"),
                              started_by="raj@markifydigital.com")
    [got] = am_store.space_runs(lumina)
    assert got["id"] == rid and got["started_by"] == "raj@markifydigital.com"
    assert am_store.space_runs(bloom) == [] and am_store.get_run(rid, bloom) is None
