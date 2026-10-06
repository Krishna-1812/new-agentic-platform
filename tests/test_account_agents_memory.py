"""Account memory, phase 2: the agents save their runs to spaces (docs/account-memory-plan.md).

An agent opened inside a client account (/<account>/agents/<agent>) loads static/js/account-context.js
first, so every call the page makes says which account it is for (X-Account). A run it starts is
saved to the account, and its list is the account's runs, the whole team's, with who ran each. The
same agent on its own page is the person's General work. Local Business Radar runs on the in-memory
store here; the other agents keep their runs only in Postgres, so their routes are checked for the
space they hand their store, and their SQL in tests/test_account_memory_postgres.py.
"""

import json
import re

import pytest

import app as appmod
from tracker import (account_history, client_accounts_store, gads_ai_store, lbr_store, people_store, video_store,
                     watch_store, workspace)

ANA = "ana@markifydigital.com"
RAJ = "raj@markifydigital.com"


def _p(text):
    return {"paragraph": {"elements": [{"textRun": {"content": text + "\n"}}],
                          "paragraphStyle": {"namedStyleType": "NORMAL_TEXT"}}}


DOC = {"title": "Master", "tabs": [
    {"tabProperties": {"title": "Lumina Smiles Dental"}, "documentTab": {"body": {"content": [
        _p(x) for x in ("URL name: lumina", "Website: luminasmiles.in", "Industry: Dental clinic",
                        "Locations: Pune")]}}},
    {"tabProperties": {"title": "Bloom Skin Clinic"}, "documentTab": {"body": {"content": [
        _p(x) for x in ("URL name: bloom", "Website: bloomskin.in", "Industry: Skin clinic")]}}},
]}


@pytest.fixture(autouse=True)
def world(monkeypatch):
    for s in (client_accounts_store, watch_store, video_store, gads_ai_store, people_store, lbr_store):
        s.reset_memory()
    appmod._acct_reset()
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: [])
    monkeypatch.setattr(appmod, "_acct_doc", lambda: (DOC, "https://docs.google.com/document/d/x/edit", None))
    people_store.remember(ANA, "Ana Mehta")
    people_store.remember(RAJ, "Raj Kulkarni")
    yield
    for s in (client_accounts_store, watch_store, video_store, gads_ai_store, people_store, lbr_store):
        s.reset_memory()
    appmod._acct_reset()


def _client(email):
    c = appmod.app.test_client()
    with c.session_transaction() as sess:
        sess["google_user"] = {"email": email, "name": email.split("@")[0].title()}
        sess["people_seen"] = True
    return c


def _space(slug):
    return appmod._acct_listing()["by_slug"][slug]["space"]


def _lbr(email, space, label="Dental clinics"):
    rid = lbr_store.create_run(email, label, "Pune", "all", 40, space=space)
    lbr_store.update_run(rid, status="complete", plan={"business": {"label": label}, "area": {"formatted": "Pune"}},
                         summary={"found": 12})
    return rid


# ── The rules, as SQL and as in-process checks ───────────────────────────────
def test_one_rule_for_who_reaches_a_row():
    assert workspace.seen_sql("r") == "(r.email = %s OR r.space ~ '^acct:[0-9]+$')"
    where, args = workspace.list_sql("Ana@X.com")
    assert where == "email = %s AND space = ANY(%s)" and args == ["ana@x.com", ["", "me:ana@x.com"]]
    assert workspace.list_sql("a@x", "acct:4", alias="r") == ("r.space = %s", ["acct:4"])
    with pytest.raises(ValueError):
        workspace.list_sql("a@x", "me:a@x")
    row = {"email": "ana@x.com", "space": "acct:3"}
    assert workspace.mem_seen(row, "raj@x.com") and workspace.mem_seen({"email": "a", "space": ""}, "a")
    assert not workspace.mem_seen({"email": "a", "space": "me:a"}, "b")
    assert workspace.mem_listed(row, "raj@x.com", "acct:3") and not workspace.mem_listed(row, "ana@x.com")


def test_the_thought_leader_store_spells_the_same_rule():
    """Its queries are plain strings, so the rule is written out; it must stay workspace's."""
    src = open("tracker/thought_leader_pr.py", encoding="utf-8").read()
    assert src.count("AND (email = %s OR space ~ '^acct:[0-9]+$')") == 15
    assert workspace.ACCOUNT_SQL == "^acct:[0-9]+$"


# ── The page inside an account ───────────────────────────────────────────────
def test_an_agent_inside_an_account_says_which_account_before_its_own_scripts():
    html = _client(ANA).get("/lumina/agents/local-business-radar").get_data(as_text=True)
    m = re.search(r'<script src="/static/js/account-context\.js\?v=\d+" data-acct="lumina"></script>', html)
    assert m, "the account's context script is on the page"
    first_script = html.find("<script")
    assert first_script == m.start(), "it runs before any of the page's own scripts"
    assert "account-context.js" not in _client(ANA).get("/strategic-agents/local-business-radar").get_data(as_text=True)


def test_the_context_script_tags_only_this_sites_calls():
    js = open("static/js/account-context.js", encoding="utf-8").read()
    assert 'h.set("X-Account", ACCT)' in js and 'setRequestHeader("X-Account", ACCT)' in js
    assert "location.origin" in js and "textContent" not in js


def test_a_header_naming_no_account_files_nothing_in_one():
    with appmod.app.test_request_context(headers={"X-Account": "no-such"}):
        from flask import session
        session["google_user"] = {"email": ANA}
        assert appmod._work_space(ANA) == "me:" + ANA and appmod._list_space() is None
    with appmod.app.test_request_context(headers={"X-Account": "lumina"}):
        from flask import session
        session["google_user"] = {"email": "someone@gmail.com"}
        assert appmod._work_acct() is None, "only staff work inside an account"
    with appmod.app.test_request_context(headers={"X-Account": "lumina"}):
        from flask import session
        session["google_user"] = {"email": ANA}
        assert appmod._work_space(ANA) == _space("lumina")


# ── Local Business Radar, end to end ─────────────────────────────────────────
def test_a_radar_run_started_inside_an_account_is_saved_to_it(monkeypatch):
    from tracker import lbr_config, lbr_intake, lbr_pipeline
    monkeypatch.setattr(lbr_config, "ready", lambda: True)
    monkeypatch.setattr(lbr_intake, "cached_plan", lambda *a, **k: {"business": {"input": "dentist", "label": "Dentists"},
                                                                    "area": {"input": "Pune"}, "focus": "all", "cap": 40})
    monkeypatch.setattr(lbr_pipeline, "_spawn", lambda run_id: None)
    c = _client(ANA)
    r = c.post("/strategic-agents/local-business-radar/run", json={"business_type": "dentist", "location": "Pune"},
               headers={"X-Account": "lumina"})
    assert r.status_code == 200, r.get_json()
    assert lbr_store.get_run(r.get_json()["run_id"])["space"] == _space("lumina")
    r = c.post("/strategic-agents/local-business-radar/run", json={"business_type": "dentist", "location": "Pune"})
    assert lbr_store.get_run(r.get_json()["run_id"])["space"] == "me:" + ANA


def test_an_accounts_radar_runs_are_the_teams_and_general_ones_private():
    shared = _lbr(ANA, _space("lumina"))
    own = _lbr(ANA, "me:" + ANA, "Cafes")
    other = _lbr(ANA, _space("bloom"), "Salons")
    raj = _client(RAJ)
    runs = raj.get("/strategic-agents/local-business-radar/runs", headers={"X-Account": "lumina"}).get_json()["runs"]
    assert [(x["id"], x["by"]) for x in runs] == [(shared, "Ana Mehta")]
    html = raj.get("/lumina/agents/local-business-radar").get_data(as_text=True)
    assert 'data-run="%d"' % shared in html and 'data-run="%d"' % own not in html and 'data-run="%d"' % other not in html
    assert "by Ana Mehta" in html and "The team&#39;s searches for Lumina Smiles Dental" in html
    assert raj.get("/strategic-agents/local-business-radar/runs/%d/status" % shared).status_code == 200
    assert raj.get("/strategic-agents/local-business-radar/runs/%d/report" % shared).status_code == 200
    assert raj.get("/strategic-agents/local-business-radar/runs/%d/status" % own).status_code == 404
    assert raj.get("/strategic-agents/local-business-radar/runs").get_json()["runs"] == []
    mine = _client(ANA).get("/strategic-agents/local-business-radar/runs").get_json()["runs"]
    assert [x["id"] for x in mine] == [own], "General lists only your own General runs"


# ── The other agents hand their store the space ──────────────────────────────
def test_social_media_intelligence_saves_and_lists_by_space(monkeypatch):
    from tracker import sci_pipeline, sci_store
    seen = {}
    monkeypatch.setattr(sci_store, "save_run", lambda email, name, url, logo, space="": seen.setdefault("save", space) and 7)
    monkeypatch.setattr(sci_store, "list_runs", lambda email, limit=100, space=None: seen.setdefault("list", [space]) and [])
    monkeypatch.setattr(sci_pipeline, "_sci_run_analysis_job", lambda *a: None)
    c = _client(ANA)
    c.post("/strategic-agents/social-media-intelligence/analyze", json={"company_name": "Lumina"},
           headers={"X-Account": "lumina"})
    assert seen["save"] == _space("lumina")
    c.get("/lumina/agents/social-media-intelligence")
    assert seen["list"] == [_space("lumina")]


def test_event_intelligence_saves_and_lists_by_space(monkeypatch):
    from tracker import event_intel_jobs, event_intel_store
    seen = {}
    monkeypatch.setattr(event_intel_jobs, "start", lambda email, mode, query, kw, key, space="": seen.update(save=space) or 9)
    monkeypatch.setattr(event_intel_store, "list_runs", lambda email, limit=60, space=None: seen.update(list=space) or [])
    monkeypatch.setattr(event_intel_store, "list_profiles", lambda email: [])
    c = _client(ANA)
    r = c.post("/strategic-agents/event-conference-intelligence/run", json={"mode": "lookup", "query": "Dental Expo"},
               headers={"X-Account": "lumina"})
    assert r.status_code == 200, r.get_json()
    assert seen["save"] == _space("lumina")
    c.get("/lumina/agents/event-conference-intelligence")
    assert seen["list"] == _space("lumina")
    c.post("/strategic-agents/event-conference-intelligence/run", json={"mode": "lookup", "query": "Dental Expo"})
    assert seen["save"] == "me:" + ANA


def test_thought_leader_saves_and_lists_by_space(monkeypatch):
    from tracker import thought_leader_pr as tlpr
    seen = {}
    monkeypatch.setattr(tlpr, "create_run", lambda **kw: seen.update(save=kw.get("space")) or 3)
    monkeypatch.setattr(tlpr, "resolve_identity", lambda *a, **k: {"status": "failed"})
    monkeypatch.setattr(tlpr, "save_result", lambda *a: True)
    monkeypatch.setattr(tlpr, "list_runs", lambda email, limit=25, space=None: seen.update(list=space) or [])
    c = _client(ANA)
    c.post("/strategic-agents/thought-leader-pr/resolve", json={"name": "Dr Mehta"}, headers={"X-Account": "lumina"})
    assert seen["save"] == _space("lumina")
    c.get("/lumina/agents/thought-leader-pr")
    assert seen["list"] == _space("lumina")


# ── History and the account home ─────────────────────────────────────────────
def test_the_accounts_history_and_home_show_its_agent_runs():
    _lbr(ANA, _space("lumina"))
    _lbr(RAJ, _space("bloom"), "Salons")
    _lbr(ANA, "me:" + ANA, "Cafes")
    lumina = appmod._acct_listing()["by_slug"]["lumina"]
    rows = [r for r in account_history.entries(lumina) if r["tool"] == "agents"]
    assert [(r["title"], r["tool_label"], r["state_label"], r["detail"]) for r in rows] == [
        ("Dental clinics in Pune", "Local Business Radar", "Done", "12 businesses found")]
    html = _client(RAJ).get("/lumina").get_data(as_text=True)
    assert "Dental clinics in Pune" in html and "Salons" not in html and "Cafes" not in html
    assert 'data-tool="agents"' in html and "Last run" in html and "by Ana Mehta" in html
