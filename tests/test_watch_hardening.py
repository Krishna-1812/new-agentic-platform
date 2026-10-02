"""Page Watch, Phase 5: does it hold up? Soak, load and failure.

  soak     the same page read many times, each reading differently noisy in
           the ways real browsers are (anti-aliasing, a pixel of jitter, a
           carousel caught mid-turn, a "minutes ago" line): it must never
           report a change, and a real edit must still be found at the end
  load     hundreds of watches: the dashboard and the queue stay fast
  failure  a capture that raises, a store that fails mid-check, a worker
           thread that keeps going after a bad check
"""

import io
import os
import random
import sys
import time
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from test_watch_engine import _fake_reader, blocks, cap_from, page  # noqa: E402

from tracker import watch_engine, watch_store, watch_web, watch_worker  # noqa: E402

ANA = "ana@markifydigital.com"


@pytest.fixture
def store(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    watch_store.reset_memory()
    yield watch_store
    watch_store.reset_memory()


def noisy(png, rng, jitter=True):
    """The same page as another visit would draw it: a few hundred pixels
    nudged by less than the change threshold, and maybe a 1px shift."""
    a = np.array(Image.open(io.BytesIO(png)).convert("RGB")).astype(np.int16)
    ys = rng.integers(0, a.shape[0], 600)
    xs = rng.integers(0, a.shape[1], 600)
    a[ys, xs] = np.clip(a[ys, xs] + rng.integers(-20, 21, (600, 3)), 0, 255)
    if jitter and rng.random() < 0.3:
        a = np.roll(a, 1, axis=1)
    buf = io.BytesIO()
    Image.fromarray(a.astype(np.uint8)).save(buf, "PNG")
    return buf.getvalue()


def visit(rng, n, **kw):
    """One reading: a carousel that turns between the screenshot and its
    control, noise, and a relative time that is different every visit."""
    turn = int(rng.integers(0, 3))
    shot = noisy(page(carousel=turn, **kw), rng)
    control = noisy(page(carousel=turn + 1, **kw), rng, jitter=False)
    blk = blocks(**{"Updated 3 minutes ago": {"text": "Updated %d minutes ago" % (n % 50 + 1)}})
    if kw.get("price") is False:
        blk = [dict(b, text="$25") if b["text"] == "$20" else b for b in blk]
    return cap_from(shot, control=control, blk=blk)


def test_soak_forty_noisy_visits_of_an_unchanged_page_are_all_the_same(store):
    rng = np.random.default_rng(7)
    tid = store.create_target(ANA, "https://example.com/pricing")
    watch_engine.run_check(tid, capture=_fake_reader(visit(rng, 0), visit(rng, 1), visit(rng, 2)))
    outcomes = [watch_engine.run_check(tid, capture=_fake_reader(visit(rng, i)))["outcome"] for i in range(3, 43)]
    assert outcomes == ["same"] * 40, outcomes
    # ...and a real edit on a noisy visit is still found and confirmed.
    assert watch_engine.run_check(tid, capture=_fake_reader(visit(rng, 50, price=False)))["outcome"] == "suspected"
    r = watch_engine.run_check(tid, capture=_fake_reader(visit(rng, 51, price=False)))
    assert r["outcome"] == "changed" and r["report"]["headline"] == "Price changed: $20 → $25."


def test_load_four_hundred_watches_stay_fast(store):
    now = datetime.now(timezone.utc)
    for i in range(400):
        tid = store.create_target(ANA, "https://site%d.example.com/" % i, name="Site %d" % i, client="C%d" % (i % 7),
                                  next_check_at=now - timedelta(minutes=i % 30))
        for k in range(30):
            cid = store.start_check(tid)
            store.finish_check(cid, outcome="same" if k % 9 else "changed")
    t0 = time.perf_counter()
    board = watch_web.dashboard(ANA)
    took = time.perf_counter() - t0
    assert board["counts"]["all"] == 400 and all(len(w["strip"]) == 30 for w in board["watches"])
    assert took < 5, took
    t0 = time.perf_counter()
    got = store.claim_due("w", limit=50)
    assert len(got) == 50 and len({w["site"] for w in got}) == 50
    assert time.perf_counter() - t0 < 2
    assert store.queue_stats()["running"] == 50


def test_a_capture_that_raises_is_retried_later_and_the_worker_carries_on(store):
    calls = []

    def run(tid):
        calls.append(tid)
        if len(calls) == 1:
            raise MemoryError("the browser ran out of memory")
        return {"outcome": "same"}
    a = store.create_target(ANA, "https://a.example.com/")
    b = store.create_target(ANA, "https://b.example.com/")
    w = watch_worker.Worker(1, run=run, worker_id="w1")
    assert w.drain() == 2 and sorted(calls) == sorted([a, b])
    first = store.get_target(calls[0])
    assert first["lease_owner"] is None
    nxt = datetime.fromisoformat(first["next_check_at"])
    assert nxt - datetime.now(timezone.utc) < timedelta(minutes=16)              # retried soon, not tomorrow


def test_a_store_that_fails_mid_check_leaves_the_watch_to_be_retried(store, monkeypatch):
    tid = store.create_target(ANA, "https://a.example.com/")
    real = store.add_snapshot

    def broken(*a, **k):
        raise ConnectionError("the database went away")
    monkeypatch.setattr(store, "add_snapshot", broken)
    w = watch_worker.Worker(1, worker_id="w1",
                            run=lambda t: watch_engine.run_check(t, capture=_fake_reader(cap_from(page()))))
    assert w.process_one() is True                                               # the worker survives
    monkeypatch.setattr(store, "add_snapshot", real)
    t = store.get_target(tid)
    assert t["baseline_id"] is None and t["lease_owner"] is None
    # The half-finished check is closed as interrupted when it next runs.
    store.update_target(tid, next_check_at=None)
    watch_engine.run_check(tid, capture=_fake_reader(cap_from(page()), cap_from(page()), cap_from(page())))
    assert [c["outcome"] for c in store.list_checks(tid)] == ["baseline", "interrupted"]


def test_a_site_that_never_answers_counts_as_a_failure_not_a_hang(store):
    tid = store.create_target(ANA, "https://slow.example.com/")
    watch_engine.run_check(tid, capture=_fake_reader(cap_from(page()), cap_from(page()), cap_from(page())))
    slow = cap_from(None, blk=[])
    slow.error, slow.error_detail = "timeout", "Page.goto: Timeout 30000ms exceeded."
    r = watch_engine.run_check(tid, capture=_fake_reader(slow))
    assert r["outcome"] == "error" and r["fail_count"] == 1
    assert store.get_target(tid)["baseline_id"]                                   # the baseline is kept
