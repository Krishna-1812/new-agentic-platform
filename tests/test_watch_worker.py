"""Page Watch, Phase 2: schedules, the worker's queue, the confirming re-check.

All on the in-memory store with drawn pages (see test_watch_engine.py), so
every case is exact and needs no browser, network or database. The SQL of
the same functions is exercised in test_watch_store_postgres.py.
"""

import os
import sys
import threading
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(__file__))
from test_watch_engine import _fake_reader, blocks, cap_from, page  # noqa: E402

from tracker import watch_engine, watch_schedule, watch_store, watch_worker  # noqa: E402

UTC = timezone.utc
EMAIL = "ana@markifydigital.com"


@pytest.fixture
def store(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    watch_store.reset_memory()
    yield watch_store
    watch_store.reset_memory()


def ist(y, mo, d, h, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=watch_schedule.IST)


# ── Schedules ────────────────────────────────────────────────────────────────
def test_the_default_schedule_is_daily_at_nine_india_time():
    assert watch_schedule.normalise(None) == {"every": "daily", "at": "09:00"}
    assert watch_schedule.describe({}) == "Daily at 09:00 IST"
    assert watch_schedule.describe({"every": "weekly", "day": "Friday", "at": "7:30"}) == \
        "Weekly on Friday at 07:30 IST"


@pytest.mark.parametrize("bad", [{"every": "minutely"}, {"every": "daily", "at": "25:00"},
                                 {"every": "daily", "at": "nine"}, {"every": "weekly", "day": "someday"}])
def test_bad_schedules_are_refused_with_a_sentence(bad):
    with pytest.raises(ValueError) as err:
        watch_schedule.normalise(bad)
    assert str(err.value).endswith(".")


def test_daily_runs_at_the_time_plus_this_watchs_fixed_offset():
    s = {"every": "daily", "at": "09:00"}
    off = watch_schedule.jitter(s, 7)
    assert timedelta(0) <= off < watch_schedule.JITTER["daily"]
    assert watch_schedule.jitter(s, 7) == off                     # fixed per watch
    before = ist(2026, 10, 3, 8, 0)
    assert watch_schedule.next_run(s, before, 7) == ist(2026, 10, 3, 9, 0) + off
    # Straight after a run, the next one is tomorrow.
    assert watch_schedule.next_run(s, ist(2026, 10, 3, 9, 0) + off, 7) == ist(2026, 10, 4, 9, 0) + off


def test_offsets_spread_watches_over_the_window():
    s = {"every": "daily", "at": "09:00"}
    offsets = {watch_schedule.jitter(s, i) for i in range(50)}
    assert len(offsets) > 40


def test_weekly_hourly_and_six_hourly():
    sat = ist(2026, 10, 3, 2, 40)                     # a Saturday
    w = watch_schedule.next_run({"every": "weekly", "day": "mon", "at": "09:00"}, sat, 1)
    assert w.astimezone(watch_schedule.IST).weekday() == 0 and w > sat
    assert w - sat < timedelta(days=7)
    h = watch_schedule.next_run({"every": "hourly"}, sat, 1)
    assert timedelta(0) < h - sat <= timedelta(hours=1)
    six = watch_schedule.next_run({"every": "6h"}, sat, 1)
    assert six.astimezone(watch_schedule.IST).hour == 6


def test_retries_come_sooner_but_never_past_the_schedule():
    s = {"every": "daily", "at": "09:00"}
    now = ist(2026, 10, 3, 12, 0)
    assert watch_schedule.retry_at(s, now, 1, 1) == now + timedelta(minutes=5)
    assert watch_schedule.retry_at(s, now, 2, 1) == now + timedelta(minutes=15)
    assert watch_schedule.retry_at(s, now, 3, 1) == watch_schedule.next_run(s, now, 1)
    hourly = {"every": "hourly"}
    late = ist(2026, 10, 3, 12, 58)
    assert watch_schedule.retry_at(hourly, late, 2, 1) == watch_schedule.next_run(hourly, late, 1)


# ── The queue ────────────────────────────────────────────────────────────────
def test_a_new_watch_is_due_at_once_and_is_claimed_by_one_worker(store):
    tid = store.create_target(EMAIL, "https://www.example.com/pricing")
    assert store.get_target(tid)["site"] == "example.com"
    a = store.claim_due("worker-a")
    assert [t["id"] for t in a] == [tid] and a[0]["lease_owner"] == "worker-a"
    assert store.claim_due("worker-b") == []
    assert store.renew_lease(tid, "worker-b") is False and store.renew_lease(tid, "worker-a") is True
    assert store.release(tid, "worker-b", datetime.now(UTC)) is False
    later = datetime.now(UTC) + timedelta(hours=1)
    assert store.release(tid, "worker-a", later) is True
    assert store.claim_due("worker-b") == []                          # not due yet
    assert [t["id"] for t in store.claim_due("worker-b", now=later + timedelta(seconds=1))] == [tid]


def test_an_expired_lease_is_taken_over():
    watch_store.reset_memory()
    tid = watch_store.create_target(EMAIL, "https://example.com/")
    now = datetime.now(UTC)
    watch_store.claim_due("dead-worker", now=now, lease_s=60)
    assert watch_store.claim_due("live-worker", now=now + timedelta(seconds=30)) == []
    taken = watch_store.claim_due("live-worker", now=now + timedelta(seconds=61))
    assert [t["id"] for t in taken] == [tid]
    assert watch_store.renew_lease(tid, "dead-worker") is False


def test_one_check_per_site_at_a_time_with_a_gap(store):
    a = store.create_target(EMAIL, "https://example.com/pricing")
    b = store.create_target(EMAIL, "https://www.example.com/blog")
    c = store.create_target(EMAIL, "https://other.com/")
    now = datetime.now(UTC)
    got = store.claim_due("w", now=now, limit=5)
    assert sorted(t["id"] for t in got) == [a, c]                     # b waits: same site as a
    store.update_target(a, last_check_at=now)
    store.release(a, "w", now + timedelta(days=1))
    assert store.claim_due("w", now=now + timedelta(seconds=5)) == []  # within the gap
    assert [t["id"] for t in store.claim_due("w", now=now + timedelta(seconds=watch_store.SITE_GAP_S + 1))] == [b]


def test_paused_and_archived_watches_are_not_claimed(store):
    store.create_target(EMAIL, "https://a.com/", status="paused")
    store.create_target(EMAIL, "https://b.com/", archived_at=datetime.now(UTC))
    assert store.claim_due("w", limit=5) == []
    assert store.queue_stats()["active"] == 0


def test_queue_stats_count_due_late_and_running(store):
    now = datetime.now(UTC)
    a = store.create_target(EMAIL, "https://a.com/", next_check_at=now - timedelta(minutes=5))
    store.create_target(EMAIL, "https://b.com/", next_check_at=now + timedelta(hours=2))
    c = store.create_target(EMAIL, "https://c.com/")
    # A new watch (never checked) goes first, then the longest overdue.
    assert [t["id"] for t in store.claim_due("w", now=now, limit=1)] == [c]
    q = store.queue_stats(now=now)
    assert q["active"] == 3 and q["running"] == 1 and q["due"] == 1 and q["late"] == 0
    store.update_target(a, next_check_at=now - timedelta(hours=1))
    assert store.queue_stats(now=now)["late"] == 1
    assert store.queue_stats(now=now)["states"] == {"pending": 3}


# ── The worker ───────────────────────────────────────────────────────────────
def test_the_worker_checks_due_watches_and_schedules_the_next(store):
    seen = []

    def run(tid):
        seen.append(tid)
        store.update_target(tid, last_check_at=datetime.now(UTC))
        return {"outcome": "same"}
    tid = store.create_target(EMAIL, "https://example.com/", schedule={"every": "daily", "at": "09:00"})
    w = watch_worker.Worker(1, run=run, worker_id="w1")
    assert w.drain() == 1 and seen == [tid]
    t = store.get_target(tid)
    assert t["lease_owner"] is None
    nxt = datetime.fromisoformat(t["next_check_at"])
    assert nxt == watch_schedule.next_run(t["schedule"], nxt - timedelta(seconds=1), tid)
    assert w.drain() == 0                                             # nothing else is due


@pytest.mark.parametrize("result,fails,expect", [
    ({"outcome": "suspected"}, 0, timedelta(seconds=watch_engine.CONFIRM_DELAY_S)),
    ({"outcome": "error", "error": "timeout"}, 1, timedelta(minutes=5)),
    ({"outcome": "blocked"}, 2, timedelta(minutes=15)),
    ({"outcome": "crash"}, 0, timedelta(minutes=15)),
])
def test_next_check_time_after_each_outcome(result, fails, expect):
    now = ist(2026, 10, 3, 12, 0)
    target = {"id": 3, "schedule": {"every": "daily", "at": "09:00"}, "fail_count": fails}
    assert watch_worker.next_check_time(target, result, now) == now + expect


def test_a_bad_link_waits_for_its_schedule():
    now = ist(2026, 10, 3, 12, 0)
    t = {"id": 3, "schedule": {"every": "hourly"}, "fail_count": 0}
    got = watch_worker.next_check_time(t, {"outcome": "error", "error": "bad_url"}, now)
    assert got == watch_schedule.next_run({"every": "hourly"}, now, 3)


def test_a_check_that_crashes_is_retried_and_the_worker_carries_on(store):
    def run(tid):
        raise RuntimeError("boom")
    a = store.create_target(EMAIL, "https://a.com/")
    w = watch_worker.Worker(1, run=run, worker_id="w1")
    assert w.process_one() is True
    t = store.get_target(a)
    assert t["lease_owner"] is None and t["next_check_at"]


def test_a_long_check_keeps_its_lease(store):
    gate = threading.Event()

    def run(tid):
        gate.wait(2)
        return {"outcome": "same"}
    tid = store.create_target(EMAIL, "https://a.com/")
    w = watch_worker.Worker(1, run=run, worker_id="w1", lease_s=0.3)
    th = threading.Thread(target=w.process_one)
    th.start()
    import time
    time.sleep(0.8)                         # well past the first lease
    assert store.claim_due("w2") == []      # still held: renewed
    gate.set()
    th.join(5)
    assert store.get_target(tid)["lease_owner"] is None


def test_a_hung_check_lets_its_lease_expire(store):
    gate = threading.Event()

    def run(tid):
        gate.wait(5)
        return {"outcome": "same"}
    store.create_target(EMAIL, "https://a.com/")
    w = watch_worker.Worker(1, run=run, worker_id="w1", lease_s=0.3, max_hold_s=0.4)
    th = threading.Thread(target=w.process_one)
    th.start()
    import time
    time.sleep(1.2)
    assert [t["id"] for t in store.claim_due("w2")]           # free for another worker
    gate.set()
    th.join(5)


def test_a_watch_checked_moments_ago_is_not_blocked_by_itself(store):
    now = datetime.now(UTC)
    a = store.create_target(EMAIL, "https://a.com/", last_check_at=now - timedelta(seconds=5))
    assert [t["id"] for t in store.claim_due("w", now=now)] == [a]


def test_stopping_hands_back_unfinished_checks_and_says_so(store):
    started, gate = threading.Event(), threading.Event()

    def run(tid):
        started.set()
        gate.wait(5)
        return {"outcome": "same"}
    tid = store.create_target(EMAIL, "https://a.com/")
    w = watch_worker.Worker(1, run=run, worker_id="w1", grace_s=0.2, poll_s=0.05)
    w.browser = True
    w._workers = [threading.Thread(target=w._loop, daemon=True)]
    w._workers[0].start()
    assert started.wait(2)
    left = w.stop()
    assert left == [tid]
    t = store.get_target(tid)
    assert t["lease_owner"] is None
    assert datetime.fromisoformat(t["next_check_at"]) <= datetime.now(UTC)
    assert store.list_workers()[0]["state"] == "stopped"
    gate.set()


def test_health_reports_workers_and_the_queue(store):
    h = watch_worker.health()
    assert h["status"] == "idle" and h["workers"] == []
    store.create_target(EMAIL, "https://a.com/")
    assert watch_worker.health()["status"] == "no_worker"
    w = watch_worker.Worker(1, worker_id="w1")
    w.browser = True
    w.beat()
    h = watch_worker.health()
    assert h["status"] == "ok" and h["workers"][0]["alive"] and h["queue"]["due"] == 1
    w.browser = False
    w.beat()
    assert watch_worker.health()["status"] == "no_browser"
    later = datetime.now(UTC) + timedelta(seconds=watch_worker.SILENT_AFTER_S + 5)
    assert watch_worker.health(now=later)["status"] == "no_worker"


def test_only_the_longest_running_worker_cleans_up(store):
    a = watch_worker.Worker(1, worker_id="a")
    a.beat()
    b = watch_worker.Worker(1, worker_id="b")
    b.beat()
    assert a._leader() is True and b._leader() is False


# ── The confirming re-check ──────────────────────────────────────────────────
def _baseline(store, **kw):
    tid = store.create_target(EMAIL, "https://example.com/pricing", **kw)
    watch_engine.run_check(tid, capture=_fake_reader(cap_from(page()), cap_from(page()), cap_from(page())))
    return tid


def test_a_change_that_is_gone_on_the_recheck_is_a_glitch_and_leaves_nothing(store):
    tid = _baseline(store)
    images_before = len(store._MEM["images"])
    price = blocks(**{"$20": {"text": "$25"}})
    s = watch_engine.run_check(tid, capture=_fake_reader(cap_from(page(price=False), blk=price)))
    assert s["outcome"] == "suspected"
    g = watch_engine.run_check(tid, capture=_fake_reader(cap_from(page())))
    assert g["outcome"] == "glitch" and g["suspected"] == "Price changed: $20 → $25."
    t = store.get_target(tid)
    assert t["pending_id"] is None and store.list_changes(tid) == []
    assert store.get_snapshot(s["snapshot_id"]) is None
    assert len(store._MEM["images"]) == images_before                 # the held reading's images are gone
    flaps = t["settings"]["flaps"]
    assert flaps["sels"] == {"div.price > span": 1} and len(flaps["rects"]) >= 1
    assert not (t["settings"]["learned"]["sels"])                     # once is not enough to learn
    check = store.list_checks(tid)[0]
    assert check["outcome"] == "glitch" and "Price changed" in check["error_detail"]


def test_a_part_that_flickers_twice_is_learned_but_once_is_not(store):
    tid = _baseline(store)
    price = blocks(**{"$20": {"text": "$25"}})
    for _ in range(2):
        assert watch_engine.run_check(tid, capture=_fake_reader(
            cap_from(page(price=False), blk=price)))["outcome"] == "suspected"
        assert watch_engine.run_check(tid, capture=_fake_reader(cap_from(page())))["outcome"] == "glitch"
    t = store.get_target(tid)
    assert "div.price > span" in t["settings"]["learned"]["sels"]
    assert t["settings"]["flaps"]["sels"] == {}
    # Now that flicker is noise.
    assert watch_engine.run_check(tid, capture=_fake_reader(
        cap_from(page(price=False), blk=price)))["outcome"] == "same"


def test_what_differs_between_the_two_fresh_readings_is_left_out(store):
    """A carousel rotates between every visit. The re-check sees it in a
    third state: that part is learned at once, and only the price change,
    present in both fresh readings, is recorded."""
    tid = _baseline(store)
    price = blocks(**{"$20": {"text": "$25"}})
    s = watch_engine.run_check(tid, capture=_fake_reader(cap_from(page(price=False, carousel=1), blk=price)))
    assert s["outcome"] == "suspected" and len(s["report"]["visual"]["after"]) == 2
    c = watch_engine.run_check(tid, capture=_fake_reader(cap_from(page(price=False, carousel=2), blk=price)))
    assert c["outcome"] == "changed" and c["report"]["headline"] == "Price changed: $20 → $25."
    boxes = c["report"]["visual"]["after"]
    assert len(boxes) == 1 and boxes[0][1] < 1000                     # the price, not the carousel (y 1100+)
    # Counted as a flicker; not learned from one sighting.
    t = store.get_target(tid)
    assert [r[4] for r in t["settings"]["flaps"]["rects"]] == [1] and not t["settings"]["learned"]["rects"]


def test_a_rotating_part_alone_is_a_glitch_and_is_learned_the_second_time(store):
    tid = _baseline(store)
    for _ in range(2):
        assert watch_engine.run_check(tid, capture=_fake_reader(cap_from(page(carousel=1))))["outcome"] == "suspected"
        assert watch_engine.run_check(tid, capture=_fake_reader(cap_from(page(carousel=2))))["outcome"] == "glitch"
    assert store.get_target(tid)["settings"]["learned"]["rects"]
    assert watch_engine.run_check(tid, capture=_fake_reader(cap_from(page(carousel=1))))["outcome"] == "same"


def test_a_real_change_caught_half_loaded_is_delayed_not_lost(store):
    """The first reading caught the new picture half-drawn, the re-check
    whole: both differ from the baseline and from each other. It is not
    recorded this time, nor learned; the next check sees it settled."""
    tid = _baseline(store)
    assert watch_engine.run_check(tid, capture=_fake_reader(cap_from(page(carousel=1))))["outcome"] == "suspected"
    assert watch_engine.run_check(tid, capture=_fake_reader(cap_from(page(carousel=2))))["outcome"] == "glitch"
    assert not store.get_target(tid)["settings"]["learned"]["rects"]
    assert watch_engine.run_check(tid, capture=_fake_reader(cap_from(page(carousel=2))))["outcome"] == "suspected"
    assert watch_engine.run_check(tid, capture=_fake_reader(cap_from(page(carousel=2))))["outcome"] == "changed"


def test_a_crashed_browser_is_given_one_more_go(store):
    tid = _baseline(store)
    crashed = cap_from(None, blk=[])
    crashed.error, crashed.error_detail = "browser", "Target crashed"
    r = watch_engine.run_check(tid, capture=_fake_reader(crashed, cap_from(page())))
    assert r["outcome"] == "same" and store.get_target(tid)["fail_count"] == 0
    twice = cap_from(None, blk=[])
    twice.error = "browser"
    r = watch_engine.run_check(tid, capture=_fake_reader(twice, twice))
    assert r["outcome"] == "error" and r["fail_count"] == 1


def test_a_check_cut_short_is_closed_as_interrupted(store):
    tid = _baseline(store)
    store.start_check(tid)                         # a worker died here
    watch_engine.run_check(tid, capture=_fake_reader(cap_from(page())))
    outcomes = [c["outcome"] for c in store.list_checks(tid)]
    assert outcomes[:2] == ["same", "interrupted"]
    assert all(c["finished_at"] for c in store.list_checks(tid))


def test_a_suspected_change_survives_a_restart(store):
    """The held reading is in the store, not in the worker's memory: the
    re-check works after a deploy, from any worker."""
    tid = _baseline(store)
    price = blocks(**{"$20": {"text": "$25"}})
    watch_engine.run_check(tid, capture=_fake_reader(cap_from(page(price=False), blk=price)))
    assert store.get_target(tid)["pending_id"]
    r = watch_engine.run_check(tid, capture=_fake_reader(cap_from(page(price=False), blk=price)))
    assert r["outcome"] == "changed"


# ── Retention ────────────────────────────────────────────────────────────────
def test_retention_keeps_baselines_and_changes_and_deletes_the_rest(store):
    tid = _baseline(store)
    price = blocks(**{"$20": {"text": "$25"}})
    watch_engine.run_check(tid, confirm=False, capture=_fake_reader(cap_from(page(price=False), blk=price)))
    stray = store.add_image(tid, "crop", b"old")
    orphan = store.add_snapshot(tid, "f", {"blocks": []})
    t = store.get_target(tid)
    soon = datetime.now(UTC) + timedelta(days=2)
    out = store.prune(now=soon)
    assert out["images"] == 1 and out["snapshots"] == 1 and out["changes"] == 0
    assert store.get_image(stray) is None and store.get_snapshot(orphan) is None
    assert store.get_snapshot(t["baseline_id"]) is not None
    change = store.list_changes(tid)[0]
    assert store.get_snapshot(change["before_id"]) and store.get_image(change["composite_id"])
    # A year on, the change and its pictures go; the baseline stays.
    out = store.prune(now=datetime.now(UTC) + timedelta(days=watch_store.KEEP_DAYS + 2))
    assert out["changes"] == 1 and store.list_changes(tid) == []
    assert store.get_snapshot(t["baseline_id"]) is not None
    assert store.get_image(store.get_snapshot(t["baseline_id"])["shot_id"]) is not None


def test_a_held_reading_is_never_pruned(store):
    tid = _baseline(store)
    s = watch_engine.run_check(tid, capture=_fake_reader(
        cap_from(page(price=False), blk=blocks(**{"$20": {"text": "$25"}}))))
    store.prune(now=datetime.now(UTC) + timedelta(days=30))
    assert store.get_snapshot(s["snapshot_id"]) is not None


# ── The health page ──────────────────────────────────────────────────────────
def test_the_health_page_is_for_staff_only(store, monkeypatch):
    import app as app_module
    client = app_module.app.test_client()
    r = client.get("/strategic-agents/page-watch/health")
    assert r.status_code in (301, 302)
    monkeypatch.setattr(app_module, "_get_user", lambda: {"email": "someone@gmail.com"})
    assert client.get("/strategic-agents/page-watch/health").status_code in (301, 302)
    monkeypatch.setattr(app_module, "_get_user", lambda: {"email": "ana@markifydigital.com"})
    r = client.get("/strategic-agents/page-watch/health")
    assert r.status_code == 200 and r.get_json()["status"] == "idle"
