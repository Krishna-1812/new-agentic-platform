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
    changed = watch_engine.run_check(tid, capture=reader(
        cap_from(page(price=False), blk=blocks(**{"$20": {"text": "$25"}}))))
    assert changed["outcome"] == "changed"
    change = watch_store.get_change(changed["change_id"], email)
    assert change["headline"] == "Price changed: $20 → $25."
    json.dumps(change["report"])
    assert watch_store.get_image(change["composite_id"], email)["mime"] == "image/png"
    assert watch_store.update_change(change["id"], email, feedback="useful", verdict={"importance": "high"})
    assert watch_store.get_change(change["id"], email)["verdict"] == {"importance": "high"}
    assert watch_store.update_change(change["id"], "someone-else@markifydigital.com", feedback="x") is False
    checks = watch_store.list_checks(tid, email)
    assert [c["outcome"] for c in checks] == ["changed", "same", "baseline"]
    assert all(c["finished_at"] for c in checks)
    assert [c["id"] for c in watch_store.list_changes(tid, email)] == [change["id"]]
    # Deleting the watch removes everything it recorded.
    snap = watch_store.get_target(tid, email)["baseline_id"]
    assert watch_store.delete_target(tid, email) is True
    assert watch_store.get_snapshot(snap) is None and watch_store.get_change(change["id"]) is None
