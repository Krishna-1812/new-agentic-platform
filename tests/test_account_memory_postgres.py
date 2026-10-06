"""Account memory's spaces against a REAL Postgres (docs/account-memory-plan.md).

tests/test_account_memory.py runs the in-memory stores; these run the SQL: the space columns added to
tables that already exist, the team's access to an account's work (and nobody's to someone's General
work), boards and libraries by space, claiming earlier work, the account counts, the changes for the
History, an account's stable id, and people's names. They skip without DATABASE_URL; CI runs them in
the Postgres job (.github/workflows/event-intelligence-tests.yml).
"""

import os
import random
import uuid

import pytest

from tracker import client_accounts_store, people_store, video_store, watch_store, workspace

pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"),
                                reason="needs a real Postgres; set DATABASE_URL to a throwaway database")


@pytest.fixture
def who():
    tag = uuid.uuid4().hex[:8]
    a, b = "ana-%s@markifydigital.com" % tag, "raj-%s@markifydigital.com" % tag
    space = workspace.account(random.randint(10 ** 8, 10 ** 9))
    yield {"a": a, "b": b, "space": space, "tag": tag}
    for e in (a, b):
        for t in watch_store.list_targets(e, include_archived=True):
            watch_store.delete_target(t["id"], e)


def test_an_accounts_watches_are_the_teams_and_general_ones_private(who):
    a, b, sp = who["a"], who["b"], who["space"]
    shared = watch_store.create_target(a, "https://example.com/a", space=sp)
    own = watch_store.create_target(a, "https://example.com/b", space=workspace.personal(a))
    assert watch_store.get_target(shared, b)["space"] == sp
    assert watch_store.get_target(own, b) is None and watch_store.get_target(own, a) is not None
    assert watch_store.update_target(shared, b, name="By Raj") is True
    assert watch_store.update_target(own, b, name="x") is False
    cid = watch_store.add_change(shared, None, None, "major", "Prices up", {})
    assert watch_store.get_change(cid, b)["headline"] == "Prices up"
    assert [c["id"] for c in watch_store.list_changes(shared, b)] == [cid]
    assert watch_store.delete_target(shared, b) is False, "only its maker deletes it"
    assert [t["id"] for t in watch_store.dashboard(b, space=sp)] == [shared]
    assert [t["id"] for t in watch_store.dashboard(a)] == [own], "General: your own, not the account's"
    assert watch_store.dashboard(b) == []
    assert watch_store.account_counts(a) == {sp: 1} and watch_store.account_counts(b) == {}
    assert [(c["id"], c["email"]) for c in watch_store.space_changes(sp)] == [(cid, a)]
    assert [t["id"] for t in watch_store.space_targets(sp)] == [shared]
    with pytest.raises(ValueError):
        watch_store.dashboard(a, space="me:" + a)


def test_earlier_watches_are_claimed_by_name_once(who):
    a, sp = who["a"], who["space"]
    name = "claim co %s" % who["tag"]
    old = watch_store.create_target(a, "https://example.com/c", client=" Claim Co %s " % who["tag"])
    filed = watch_store.create_target(a, "https://example.com/d", client="Claim Co %s" % who["tag"],
                                      space=workspace.personal(a))
    assert watch_store.claim_legacy({name: sp}) == 1
    assert watch_store.get_target(old)["space"] == sp and watch_store.get_target(filed)["space"] == "me:" + a
    assert watch_store.claim_legacy({name: sp}) == 0


def test_an_accounts_videos_and_brand_are_the_teams(who):
    a, b, sp = who["a"], who["b"], who["space"]
    name = "vid co %s" % who["tag"]
    shared = video_store.create_project(a, client="Vid Co %s" % who["tag"], brief="x", space=sp)
    own = video_store.create_project(a, client="Vid Co %s" % who["tag"], brief="y", space=workspace.personal(a))
    v = video_store.create_version(shared, plan={"idea": "i"})
    assert video_store.get_project(shared, b) is not None and video_store.get_project(own, b) is None
    assert video_store.get_version(v, b)["id"] == v and [x["id"] for x in video_store.list_versions(shared, b)] == [v]
    assert [p["id"] for p in video_store.library(b, space=sp)] == [shared]
    assert [p["id"] for p in video_store.library(a)] == [own]
    assert video_store.account_counts(a) == {sp: 1}
    assert video_store.delete_project(shared, b) is False
    old = video_store.create_project(b, client="Vid Co %s" % who["tag"], brief="old")
    video_store.save_brand(b, "Vid Co %s" % who["tag"], {"accent": "#abcdef"})
    assert video_store.claim_legacy({name: sp}) == 1
    assert video_store.get_project(old)["space"] == sp
    assert video_store.get_brand(sp, "Vid Co %s" % who["tag"])["brand"]["accent"] == "#abcdef"
    for pid, e in ((shared, a), (own, a), (old, b)):
        video_store.delete_project(pid, e)
    for e in (b, sp):
        video_store.delete_brand(e, "Vid Co %s" % who["tag"])


def test_an_accounts_id_is_stored_and_survives_gaining_google_ads(who):
    t = who["tag"]
    doc = {"key": "doc:mem %s" % t, "name": "Mem %s" % t, "url_name": "", "alt_keys": []}
    first = client_accounts_store.sync([doc], set())["ids"][doc["key"]]
    gained = {"key": "cid:%s" % t, "name": "Mem %s" % t, "url_name": "", "alt_keys": [doc["key"]]}
    out = client_accounts_store.sync([gained], set())
    assert out["ids"][gained["key"]] == first and client_accounts_store.load()["ids"][gained["key"]] == first


def test_peoples_names_are_kept(who):
    people_store.remember(who["a"].upper(), "Ana Mehta")
    people_store.remember(who["a"], "")
    assert people_store.names([who["a"], who["b"]]) == {who["a"]: "Ana Mehta"}, "a blank name keeps the one stored"


# ── Phase 2: the agents' runs ────────────────────────────────────────────────
def test_social_media_intelligence_runs_by_space(who):
    from tracker import sci_store
    a, b, sp = who["a"], who["b"], who["space"]
    shared = sci_store.save_run(a, "Shared Co", space=sp)
    own = sci_store.save_run(a, "Own Co", space=workspace.personal(a))
    assert sci_store.get_run(shared, b)["space"] == sp and sci_store.get_run(own, b) is None
    assert [r["id"] for r in sci_store.list_runs(b, space=sp)] == [shared]
    assert [r["id"] for r in sci_store.list_runs(a)] == [own]
    assert sci_store.list_runs("", space=sp)[0]["email"] == a


def test_thought_leader_runs_by_space_and_the_team_carries_them_on(who):
    from tracker import thought_leader_pr as tlpr
    a, b, sp = who["a"], who["b"], who["space"]
    shared = tlpr.create_run(email=a, input_name="Dr Shared", space=sp)
    own = tlpr.create_run(email=a, input_name="Dr Own", space=workspace.personal(a))
    assert tlpr.get_run(shared, b)["email"] == a and tlpr.get_run(own, b) is None
    assert tlpr.save_result(shared, b, {"status": "failed", "error": {"detail": "x"}}) is True, "a teammate carries it on"
    assert tlpr.save_result(own, b, {"status": "failed", "error": {"detail": "x"}}) is False
    assert [r["id"] for r in tlpr.list_runs(b, space=sp)] == [shared]
    assert [r["id"] for r in tlpr.list_runs(a)] == [own]


def test_event_intelligence_runs_by_space(who):
    from tracker import event_intel_store
    a, b, sp = who["a"], who["b"], who["space"]
    shared = event_intel_store.save_run(a, "lookup", "Shared Expo", space=sp)
    own = event_intel_store.save_run(a, "lookup", "Own Expo", space=workspace.personal(a))
    assert event_intel_store.get_run(shared, b)["space"] == sp and event_intel_store.get_run(own, b) is None
    assert [r["id"] for r in event_intel_store.list_runs(b, space=sp)] == [shared]
    assert [r["id"] for r in event_intel_store.list_runs(a)] == [own]


def test_contact_finder_history_by_space(who, monkeypatch):
    import app as appmod
    a, b = who["a"], who["b"]
    monkeypatch.setattr(appmod, "_acct_listing", lambda force=False: {"by_slug": {"memco": {"space": who["space"]}}})

    def client(email):
        c = appmod.app.test_client()
        with c.session_transaction() as s:
            s["google_user"], s["people_seen"] = {"email": email, "name": "X"}, True
        return c
    row = [{"name": "Someone"}]
    r = client(a).post("/strategic-agents/company-people-intelligence/history", json={"rows": row, "entity": "people"},
                       headers={"X-Account": "memco"})
    shared = r.get_json()["id"]
    own = client(a).post("/strategic-agents/company-people-intelligence/history",
                         json={"rows": row, "entity": "people"}).get_json()["id"]
    team = client(b).get("/strategic-agents/company-people-intelligence/history", headers={"X-Account": "memco"})
    assert [(e["id"], e["owner"]) for e in team.get_json()["entries"]] == [(shared, a)]
    assert client(b).get("/strategic-agents/company-people-intelligence/history/%d" % shared).status_code == 200
    assert client(b).get("/strategic-agents/company-people-intelligence/history/%d" % own).status_code == 404
    assert client(b).delete("/strategic-agents/company-people-intelligence/history/%d" % shared).get_json() == \
        {"deleted": False}, "only its maker deletes it"
    for i in (shared, own):
        client(a).delete("/strategic-agents/company-people-intelligence/history/%d" % i)
