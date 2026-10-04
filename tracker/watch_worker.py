"""Page Watch worker: runs every due check, on schedule, safely.

    python -m tracker.watch_worker            run until stopped (Railway)
    python -m tracker.watch_worker --once     run what is due now, then exit
    python -m tracker.watch_worker --migrate  create the tables, then exit

It runs as its own Railway service (see docs/page-watch-plan.md, "Where it
runs"), because a browser needs more memory than the website can spare.

How it works:
  * Each of THREADS threads takes one due watch at a time (claim_due). The
    claim is a lease that a side thread renews every LEASE_S/3 seconds while
    the check runs, so a worker that dies loses its watches within LEASE_S
    and another worker takes them; two workers never check one watch.
  * One browser at a time per site, at least SITE_GAP_S apart (the claim
    enforces it across all workers).
  * After a check the watch is handed back with its next time:
      suspected change   -> CONFIRM_DELAY_S later, for the re-check
      error or bot check -> 5, then 15 minutes later, then its schedule
      anything else      -> its schedule (watch_schedule.next_run)
  * A heartbeat row says the worker is alive and what it is doing; the web
    service's health endpoint reads it.
  * Once an hour one worker (the longest-running live one) deletes what is
    past its keeping time (watch_store.prune).
  * SIGTERM (a deploy) stops new claims, lets running checks finish for up
    to GRACE_S, and hands back anything unfinished to be checked at once.
  * Video Studio's renders run in one more thread here (tracker/video_worker.py),
    one at a time, unless VIDEO_STUDIO=off. A deploy stops a render at once
    and hands its job back.
"""

from __future__ import annotations

import logging
import os
import random
import signal
import socket
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

from tracker import watch_config as cfg
from tracker import watch_engine, watch_schedule, watch_store

log = logging.getLogger("page_watch.worker")

THREADS = 2              # WATCH_WORKER_THREADS; each runs one browser at a time
POLL_S = 5               # how often an idle thread looks for due watches
BEAT_S = 30              # heartbeat interval
PRUNE_EVERY_S = 3600
GRACE_S = 60             # how long a stopping worker waits for running checks
# A check still running after this long has hung beyond every timeout: its
# lease is no longer renewed, so it expires and another worker can take it.
MAX_HOLD_S = 900
# A worker whose heartbeat is older than this is shown as silent.
SILENT_AFTER_S = 180


def version():
    sha = os.environ.get("RAILWAY_GIT_COMMIT_SHA") or os.environ.get("GIT_COMMIT") or ""
    return sha[:7] or "dev"


def next_check_time(target, result, now):
    """When to check `target` next, given what its last check returned."""
    schedule = target.get("schedule") or watch_schedule.DEFAULT
    key = target.get("id")
    outcome = (result or {}).get("outcome")
    if outcome == "suspected":
        return now + timedelta(seconds=watch_engine.CONFIRM_DELAY_S)
    if outcome in ("error", "blocked") and (result or {}).get("error") != "bad_url":
        return watch_schedule.retry_at(schedule, now, int(target.get("fail_count") or 1), key)
    if outcome == "crash":
        return watch_schedule.retry_at(schedule, now, len(watch_schedule.RETRY_STEPS), key)
    return watch_schedule.next_run(schedule, now, key)


class Worker:
    def __init__(self, threads=None, *, run=None, poll_s=POLL_S, beat_s=BEAT_S, lease_s=watch_store.LEASE_S,
                 grace_s=GRACE_S, max_hold_s=MAX_HOLD_S, worker_id=None):
        self.threads = max(1, int(threads or os.environ.get("WATCH_WORKER_THREADS") or THREADS))
        self.run = run or watch_engine.run_check
        self.poll_s, self.beat_s, self.lease_s, self.grace_s = poll_s, beat_s, lease_s, grace_s
        self.max_hold_s = max_hold_s
        self.id = worker_id or "%s-%d-%s" % (socket.gethostname()[:40], os.getpid(), uuid.uuid4().hex[:6])
        self.stopping = threading.Event()
        self.current = {}                 # thread name -> watch id
        self.checks = 0
        self._lock = threading.Lock()
        self._last_prune = 0.0
        self.browser = None

    # ── One check ───────────────────────────────────────────────────────────
    def process_one(self):
        """Claim and check one due watch. False when nothing was due."""
        claimed = watch_store.claim_due(self.id, limit=1, lease_s=self.lease_s)
        if not claimed:
            return False
        target = claimed[0]
        tid = target["id"]
        name = threading.current_thread().name
        with self._lock:
            self.current[name] = tid
        done = threading.Event()
        renewer = threading.Thread(target=self._renew, args=(tid, done), daemon=True, name="renew-%s" % tid)
        renewer.start()
        try:
            try:
                result = self.run(tid)
            except Exception as exc:
                log.exception("watch %s: the check failed", tid)
                result = {"outcome": "crash", "error": type(exc).__name__}
        finally:
            done.set()
            renewer.join(timeout=5)
            with self._lock:
                self.current.pop(name, None)
        fresh = watch_store.get_target(tid)
        if fresh is not None:
            nxt = next_check_time(fresh, result, datetime.now(timezone.utc))
            if not watch_store.release(tid, self.id, nxt, seen=target.get("next_check_at")):
                log.warning("watch %s: the lease was lost during the check", tid)
        with self._lock:
            self.checks += 1
        log.info("watch %s: %s", tid, (result or {}).get("outcome"))
        return True

    def _renew(self, tid, done):
        until = time.monotonic() + self.max_hold_s
        while not done.wait(self.lease_s / 3):
            if time.monotonic() >= until:
                log.error("watch %s: the check has run for %ds; letting its lease expire", tid, self.max_hold_s)
                return
            try:
                if not watch_store.renew_lease(tid, self.id, lease_s=self.lease_s):
                    log.warning("watch %s: lease lost", tid)
                    return
            except Exception:
                log.exception("watch %s: lease renewal failed", tid)

    # ── Threads ─────────────────────────────────────────────────────────────
    def _loop(self):
        while not self.stopping.is_set():
            try:
                busy = self.process_one()
            except Exception:
                log.exception("worker loop")
                busy = False
                self.stopping.wait(5)
            if not busy:
                self.stopping.wait(self.poll_s * random.uniform(0.8, 1.2))

    def beat(self, state="running"):
        with self._lock:
            current = sorted(self.current.values())
            checks = self.checks
        if self.browser is False and state == "running":
            state = "running (no browser)"
        watch_store.beat(self.id, host=socket.gethostname()[:60], pid=os.getpid(), version=version(),
                         state=state, checks=checks, current=current)

    def _leader(self):
        """The longest-running live worker does the housekeeping."""
        since = datetime.now(timezone.utc) - timedelta(seconds=SILENT_AFTER_S)
        live = [w for w in watch_store.list_workers(since) if w.get("state", "").startswith("running")]
        if not live:
            return True
        first = min(live, key=lambda w: (w.get("started_at") or "", w["id"]))
        return first["id"] == self.id

    def _housekeeping(self):
        while not self.stopping.wait(self.beat_s):
            try:
                self.beat()
                if time.monotonic() - self._last_prune >= PRUNE_EVERY_S and self._leader():
                    self._last_prune = time.monotonic()
                    log.info("retention: %s", watch_store.prune())
                # The daily digest: due once a day; claim_meta lets one worker post it.
                from tracker import watch_alerts
                done = watch_alerts.run_digest()
                if done:
                    log.info("digest: %s", done)
            except Exception:
                log.exception("heartbeat")

    def start(self):
        self.browser = _browser_ok()
        if self.browser is False:
            log.warning("No browser could start here: pages are read as text only and cannot be compared "
                        "with browser baselines. On Railway set RAILPACK_PYTHON_PLAYWRIGHT_INSTALL=1.")
        self.beat()
        self._last_prune = time.monotonic() - PRUNE_EVERY_S + 60      # first clean-up a minute in
        self._workers = [threading.Thread(target=self._loop, name="check-%d" % i, daemon=True)
                         for i in range(self.threads)]
        for t in self._workers:
            t.start()
        self._keeper = threading.Thread(target=self._housekeeping, name="heartbeat", daemon=True)
        self._keeper.start()
        self.video = None
        from tracker import video_config
        if video_config.switched_on():
            from tracker import video_worker
            self.video = video_worker.VideoRunner(self.id, stopping=self.stopping)
            self.video.start()
        log.info("%s started: %d threads, version %s", self.id, self.threads, version())

    def stop(self):
        """Stop claiming; wait up to grace_s for running checks; hand back the rest."""
        self.stopping.set()
        deadline = time.monotonic() + self.grace_s
        for t in getattr(self, "_workers", []):
            t.join(timeout=max(0.0, deadline - time.monotonic()))
        if getattr(self, "video", None):
            # The render was stopped when `stopping` was set; this waits for its hand-back.
            self.video.join(timeout=max(5.0, deadline - time.monotonic()))
        with self._lock:
            left = sorted(self.current.values())
        now = datetime.now(timezone.utc)
        for tid in left:
            # Checked again straight away by whoever is running then.
            watch_store.release(tid, self.id, now)
        try:
            self.beat(state="stopped")
        except Exception:
            log.exception("final heartbeat")
        log.info("%s stopped; %d unfinished check(s) handed back", self.id, len(left))
        return left

    def drain(self):
        """Run due checks in this thread until none is due (--once, tests)."""
        n = 0
        while self.process_one():
            n += 1
        return n


def _browser_ok():
    if not cfg.browser_enabled():
        return False
    try:
        import asyncio
        from playwright.async_api import async_playwright

        async def probe():
            async with async_playwright() as pw:
                b = await pw.chromium.launch(headless=True, executable_path=cfg.chromium_path())
                await b.close()
        asyncio.run(probe())
        return True
    except Exception as exc:
        log.warning("browser probe: %s", str(exc)[:200])
        return False


def health(now=None):
    """What the health endpoint shows: workers, queue, and one word for it all."""
    now = now or datetime.now(timezone.utc)
    workers = watch_store.list_workers(now - timedelta(days=1))
    out = []
    for w in workers:
        beat = w.get("beat_at")
        beat = datetime.fromisoformat(beat) if isinstance(beat, str) else beat
        age = int((now - beat).total_seconds()) if beat else None
        out.append({"id": w["id"], "state": w.get("state"), "version": w.get("version"),
                    "checks": w.get("checks"), "current": w.get("current") or [],
                    "seconds_since_beat": age,
                    "alive": age is not None and age <= SILENT_AFTER_S and str(w.get("state", "")).startswith("running")})
    queue = watch_store.queue_stats(now=now)
    alive = [w for w in out if w["alive"]]
    if not alive:
        status = "no_worker" if queue["active"] else "idle"
    elif queue["late"]:
        status = "behind"
    elif any("no browser" in (w["state"] or "") for w in alive):
        status = "no_browser"
    else:
        status = "ok"
    return {"status": status, "workers": out, "queue": queue, "checked_at": now.isoformat()}


def setup_logging():
    """Log to stdout: Railway colours everything on stderr red, as if it
    were an error, even routine INFO lines."""
    logging.basicConfig(level=logging.INFO, stream=sys.stdout,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description="Page Watch worker")
    parser.add_argument("--once", action="store_true", help="run every check that is due now, then exit")
    parser.add_argument("--migrate", action="store_true", help="create the tables, then exit")
    parser.add_argument("--threads", type=int, default=None)
    args = parser.parse_args(argv)
    setup_logging()
    if watch_store.backend() != "postgres":
        log.warning("DATABASE_URL is not set: the worker would only see its own in-memory store.")
    if args.migrate:
        watch_store.queue_stats()
        return 0
    worker = Worker(args.threads)
    if args.once:
        worker.browser = _browser_ok()
        worker.beat()
        n = worker.drain()
        worker.beat(state="stopped")
        log.info("ran %d check(s)", n)
        return 0
    stop = threading.Event()

    def on_signal(signum, _frame):
        log.info("signal %s: stopping", signum)
        stop.set()
    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    worker.start()
    while not stop.wait(1):
        pass
    worker.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
