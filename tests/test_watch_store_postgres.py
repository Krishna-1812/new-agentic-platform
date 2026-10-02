"""Page Watch storage against a REAL Postgres.

Every other Page Watch test runs on the in-memory store. These run the SQL:
the CREATE TABLEs, every INSERT, UPDATE and scoped SELECT, the JSON and the
image bytes, and a whole watch's life through the engine. They skip without
DATABASE_URL; CI runs them in the Postgres job
(.github/workflows/event-intelligence-tests.yml). Locally:

    createdb watch_test
    DATABASE_URL=postgresql://localhost/watch_test pytest tests/test_watch_store_postgres.py
"""

import json
import os
import uuid

import pytest

from tracker import watch_engine, watch_store

pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"),
                                reason="needs a real Postgres; set DATABASE_URL to a throwaway database")


@pytest.fixture
def email():
    addr = "watch-%s@markifydigital.com" % uuid.uuid4().hex[:10]
    yield addr
    for t in watch_store.list_targets(addr, include_archived=True):
        watch_store.delete_target(t["id"], addr)


def test_targets_round_trip_with_json_and_scoping(email):
    assert watch_store.backend() == "postgres"
    tid = watch_store.create_target(email.upper(), "https://example.com/pricing", name="Example",
                                    ignore=[[0, 0, 100, 50]], schedule={"every": "daily", "at": "09:00"},
                                    settings={"learned": {"rects": [], "sels": ["p.x"]}})
    t = watch_store.get_target(tid, email)
    assert t["email"] == email and t["name"] == "Example"
    assert t["ignore"] == [[0, 0, 100, 50]] and t["schedule"]["at"] == "09:00"
    assert t["settings"]["learned"]["sels"] == ["p.x"]
    assert watch_store.get_target(tid, "someone-else@markifydigital.com") is None
    assert watch_store.update_target(tid, "someone-else@markifydigital.com", name="x") is False
    assert watch_store.update_target(tid, email, name="Renamed", ignore=[]) is True
    assert watch_store.get_target(tid, email)["name"] == "Renamed"
    assert [x["id"] for x in watch_store.list_targets(email)] == [tid]


def test_images_keep_their_bytes_and_are_scoped(email):
    tid = watch_store.create_target(email, "https://example.com/")
    data = bytes(range(256)) * 40
    iid = watch_store.add_image(tid, "shot", data, width=10, height=20, lossless=True)
    img = watch_store.get_image(iid, email)
    assert img["bytes"] == data and img["lossless"] is True and img["width"] == 10
    assert watch_store.get_image(iid, "someone-else@markifydigital.com") is None
    assert watch_store.delete_images([iid]) == 1
    assert watch_store.get_image(iid) is None


def test_a_whole_watch_life_through_the_engine(email):
    import sys
    sys.path.insert(0, os.path.dirname(__file__))
    from test_watch_engine import blocks, cap_from, page

    def reader(*caps):
        seq = list(caps)
        return lambda url, area=None, screenshots=True: seq.pop(0)

    tid = watch_store.create_target(email, "https://example.com/pricing")
    first = watch_engine.run_check(tid, capture=reader(cap_from(page()), cap_from(page()), cap_from(page())))
    assert first["outcome"] == "baseline"
    t = watch_store.get_target(tid, email)
    assert t["state"] == "ok" and t["settings"]["calibration_reads"] == 2
    assert watch_engine.run_check(tid, capture=reader(cap_from(page())))["outcome"] == "same"
    def new_price():
        return reader(cap_from(page(price=False), blk=blocks(**{"$20": {"text": "$25"}})))
    suspected = watch_engine.run_check(tid, capture=new_price())
    assert suspected["outcome"] == "suspected"
    assert watch_store.get_target(tid, email)["pending_id"] == suspected["snapshot_id"]
    changed = watch_engine.run_check(tid, capture=new_price())
    assert changed["outcome"] == "changed"
    assert watch_store.get_snapshot(suspected["snapshot_id"]) is None
    change = watch_store.get_change(changed["change_id"], email)
    assert change["headline"] == "Price changed: $20 → $25."
    json.dumps(change["report"])
    assert watch_store.get_image(change["composite_id"], email)["mime"] == "image/png"
    assert watch_store.update_change(change["id"], email, feedback="useful", verdict={"importance": "high"})
    assert watch_store.get_change(change["id"], email)["verdict"] == {"importance": "high"}
    assert watch_store.update_change(change["id"], "someone-else@markifydigital.com", feedback="x") is False
    checks = watch_store.list_checks(tid, email)
    assert [c["outcome"] for c in checks] == ["changed", "suspected", "same", "baseline"]
    assert all(c["finished_at"] for c in checks)
    assert [c["id"] for c in watch_store.list_changes(tid, email)] == [change["id"]]
    # Deleting the watch removes everything it recorded.
    snap = watch_store.get_target(tid, email)["baseline_id"]
    assert watch_store.delete_target(tid, email) is True
    assert watch_store.get_snapshot(snap) is None and watch_store.get_change(change["id"]) is None


# ── Phase 2: the worker's queue, on real SQL ─────────────────────────────────
def _mine(rows, ids, owner):
    """Claims of this test's watches; anything else claimed is handed back."""
    from datetime import datetime, timezone
    out = []
    for r in rows:
        if r["id"] in ids:
            out.append(r["id"])
        else:
            watch_store.release(r["id"], owner, datetime.now(timezone.utc))
    return out


def test_claims_leases_and_the_site_rule_in_sql(email):
    from datetime import datetime, timedelta, timezone
    tag = uuid.uuid4().hex[:8]
    a = watch_store.create_target(email, "https://%s.example.com/a" % tag)
    b = watch_store.create_target(email, "https://www.%s.example.com/b" % tag)
    c = watch_store.create_target(email, "https://%s.example.org/" % tag)
    assert watch_store.get_target(a)["site"] == "%s.example.com" % tag
    now = datetime.now(timezone.utc)
    got = _mine(watch_store.claim_due("w1", now=now, limit=20), {a, b, c}, "w1")
    assert sorted(got) == [a, c]                                     # b shares a's site
    assert _mine(watch_store.claim_due("w2", now=now, limit=20), {a, b, c}, "w2") == []
    assert watch_store.renew_lease(a, "w2") is False and watch_store.renew_lease(a, "w1") is True
    watch_store.update_target(a, last_check_at=now)
    assert watch_store.release(a, "w1", now + timedelta(days=1)) is True
    assert watch_store.release(c, "w1", now + timedelta(days=1)) is True
    soon = now + timedelta(seconds=watch_store.SITE_GAP_S + 1)
    assert _mine(watch_store.claim_due("w2", now=soon, limit=20), {a, b, c}, "w2") == [b]
    # An expired lease is taken over; the old owner can no longer renew or release.
    later = soon + timedelta(seconds=watch_store.LEASE_S + 1)
    assert _mine(watch_store.claim_due("w3", now=later, limit=20), {a, b, c}, "w3") == [b]
    assert watch_store.release(b, "w2", later) is False and watch_store.release(b, "w3", later) is True


def test_concurrent_workers_never_claim_the_same_watch(email):
    import threading
    tag = uuid.uuid4().hex[:8]
    ids = {watch_store.create_target(email, "https://s%d-%s.example.net/" % (i, tag)) for i in range(12)}
    claimed, lock = [], threading.Lock()

    def worker(n):
        owner = "w%d" % n
        for _ in range(100):             # bounded, whatever else the database holds
            rows = watch_store.claim_due(owner, limit=1)
            mine = _mine(rows, ids, owner)
            if not rows:
                return
            with lock:
                claimed.extend(mine)
    threads = [threading.Thread(target=worker, args=(n,)) for n in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    assert sorted(claimed) == sorted(ids)                            # each exactly once


def test_heartbeats_queue_stats_and_stale_checks_in_sql(email):
    from datetime import datetime, timedelta, timezone
    wid = "test-%s" % uuid.uuid4().hex[:8]
    watch_store.beat(wid, host="h", pid=1, version="abc", checks=3, current=[7])
    watch_store.beat(wid, host="h", pid=1, version="abc", checks=4, current=[])
    row = next(w for w in watch_store.list_workers() if w["id"] == wid)
    assert row["checks"] == 4 and row["current"] == [] and row["started_at"] <= row["beat_at"]
    q = watch_store.queue_stats()
    assert set(q) == {"active", "due", "late", "running", "states"}
    tid = watch_store.create_target(email, "https://example.com/stale")
    watch_store.start_check(tid)
    assert watch_store.close_stale_checks(tid, before=datetime.now(timezone.utc) + timedelta(seconds=1)) == 1
    assert watch_store.list_checks(tid)[0]["outcome"] == "interrupted"


def test_retention_in_sql_keeps_the_baseline(email):
    from datetime import datetime, timedelta, timezone
    import sys
    sys.path.insert(0, os.path.dirname(__file__))
    from test_watch_engine import cap_from, page

    def reader(*caps):
        seq = list(caps)
        return lambda url, area=None, screenshots=True: seq.pop(0)
    tid = watch_store.create_target(email, "https://example.com/keep")
    watch_engine.run_check(tid, capture=reader(cap_from(page()), cap_from(page()), cap_from(page())))
    base = watch_store.get_target(tid, email)["baseline_id"]
    stray = watch_store.add_image(tid, "crop", b"x")
    orphan = watch_store.add_snapshot(tid, "f", {"blocks": []})
    out = watch_store.prune(now=datetime.now(timezone.utc) + timedelta(days=2))
    assert out["images"] >= 1 and out["snapshots"] >= 1
    assert watch_store.get_image(stray) is None and watch_store.get_snapshot(orphan) is None
    snap = watch_store.get_snapshot(base)
    assert snap is not None and watch_store.get_image(snap["shot_id"]) is not None
    assert watch_store.delete_snapshot(base) is True
