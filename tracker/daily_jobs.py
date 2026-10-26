"""Jobs the site runs itself at a set time of day, in India time.

The Google Ads digest used to be started by a scheduled GitHub Action. GitHub starts scheduled runs when it has
room, and measured over a fortnight that was 4 to 6 hours after the time asked for, so a 12:55 India-time
schedule reached Slack at about 18:00. A schedule that cannot be kept to the hour is not worth much, so the site
now keeps the time itself:

    Job(name, at="11:30", run=callable, grace_min=120)

A thread in each web process looks at the clock every CHECK_EVERY_S seconds. A job is due from its time until
`grace_min` minutes later (a deploy at 11:34 still posts; a service that was down all morning does not post in
the evening, which is the very thing this is meant to stop). It is claimed first, in the database, so the two web
processes (and a deploy that overlaps another) run it once. A run that fails is tried again after
RETRY_AFTER_MIN minutes, MAX_ATTEMPTS times in all, until the grace is over.

    due(now, "11:30", 120)   is it the job's time? (now: an aware datetime)
    tick(jobs)               what is due and claimed is run: [(name, ok)]
    start(jobs)              the thread
"""
from __future__ import annotations

import logging
import os
import random
import threading
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

IST = timezone(timedelta(hours=5, minutes=30))
CHECK_EVERY_S = 30
MAX_ATTEMPTS = 3
RETRY_AFTER_MIN = 10


class Job:
    def __init__(self, name, at, run, grace_min=120):
        self.name, self.run, self.grace_min = name, run, grace_min
        self.at = at_of(at)


def at_of(text, default="11:30"):
    """(hour, minute) from "11:30" (also "11.30" or "11:30 AM"); the default when it is not a time."""
    import re
    m = re.match(r"^\s*(\d{1,2})\s*[:.]\s*(\d{2})\s*(am|pm)?\s*$", str(text or ""), re.I)
    if m:
        h, mi, ap = int(m.group(1)), int(m.group(2)), (m.group(3) or "").lower()
        if ap == "pm" and h < 12:
            h += 12
        if ap == "am" and h == 12:
            h = 0
        if 0 <= h < 24 and 0 <= mi < 60:
            return h, mi
    return at_of(default) if default != text and default else (11, 30)


def slot(now, at):
    return now.astimezone(IST).replace(hour=at[0], minute=at[1], second=0, microsecond=0)


def due(now, at, grace_min):
    """Is `now` from the job's time today until grace_min minutes after it?"""
    start = slot(now, at)
    return start <= now.astimezone(IST) < start + timedelta(minutes=grace_min)


# == who runs it: one claim a job a day ====================================================================

_MEM = {}
_MEM_LOCK = threading.Lock()
_READY = False


def _pg():
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        return None
    try:
        from . import db_pool
        return db_pool.connect(url, connect_timeout=8)
    except Exception as e:
        logger.warning("daily jobs: no database (%s); this process keeps the claims itself", e)
        return None


def _ensure(conn):
    global _READY
    if _READY:
        return
    with conn.cursor() as cur:
        cur.execute("""CREATE TABLE IF NOT EXISTS daily_job_runs (
            job TEXT NOT NULL,
            day DATE NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            last_attempt TIMESTAMPTZ NOT NULL DEFAULT now(),
            done BOOLEAN NOT NULL DEFAULT FALSE,
            PRIMARY KEY (job, day))""")
    conn.commit()
    _READY = True


def claim(job, day, now=None):
    """True for the one caller that may run `job` for this day: it has not finished, has been tried fewer than
    MAX_ATTEMPTS times, and the last try was at least RETRY_AFTER_MIN minutes ago."""
    conn = _pg()
    if conn is None:
        now = now or datetime.now(timezone.utc)
        with _MEM_LOCK:
            row = _MEM.get((job, day))
            if row is None:
                _MEM[(job, day)] = {"attempts": 1, "at": now, "done": False}
                return True
            if row["done"] or row["attempts"] >= MAX_ATTEMPTS or now - row["at"] < timedelta(minutes=RETRY_AFTER_MIN):
                return False
            row.update(attempts=row["attempts"] + 1, at=now)
            return True
    try:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("""INSERT INTO daily_job_runs (job, day, attempts, last_attempt) VALUES (%s, %s, 1, now())
                           ON CONFLICT (job, day) DO UPDATE
                             SET attempts = daily_job_runs.attempts + 1, last_attempt = now()
                             WHERE NOT daily_job_runs.done AND daily_job_runs.attempts < %s
                               AND daily_job_runs.last_attempt < now() - make_interval(mins => %s)
                           RETURNING attempts""", (job, day, MAX_ATTEMPTS, RETRY_AFTER_MIN))
            got = cur.fetchone()
        conn.commit()
        return bool(got)
    except Exception:
        logger.exception("daily jobs: could not claim %s", job)
        try:
            conn.rollback()
        except Exception:
            pass
        return False
    finally:
        try:
            conn.close()
        except Exception:
            pass


def finish(job, day, ok):
    """A run that went well is done for the day; one that did not is left to be tried again."""
    if not ok:
        return
    conn = _pg()
    if conn is None:
        with _MEM_LOCK:
            if (job, day) in _MEM:
                _MEM[(job, day)]["done"] = True
        return
    try:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("UPDATE daily_job_runs SET done = TRUE WHERE job = %s AND day = %s", (job, day))
        conn.commit()
    except Exception:
        logger.exception("daily jobs: could not record that %s is done", job)
    finally:
        try:
            conn.close()
        except Exception:
            pass


def reset_memory():
    with _MEM_LOCK:
        _MEM.clear()


# == the clock ==============================================================================================

def tick(jobs, now=None, *, claim_fn=None, finish_fn=None):
    """Runs what is due and claimed. [(name, ok)]. Never raises."""
    now = now or datetime.now(timezone.utc)
    claim_fn, finish_fn = claim_fn or claim, finish_fn or finish
    day = now.astimezone(IST).date().isoformat()
    ran = []
    for job in jobs:
        try:
            if not due(now, job.at, job.grace_min) or not claim_fn(job.name, day, now):
                continue
            try:
                ok = job.run() is not False
            except Exception:
                logger.exception("daily jobs: %s failed", job.name)
                ok = False
            finish_fn(job.name, day, ok)
            ran.append((job.name, ok))
            logger.info("daily jobs: %s %s", job.name, "done" if ok else "failed, will be tried again")
        except Exception:
            logger.exception("daily jobs: %s could not be checked", job.name)
    return ran


_STOP = threading.Event()


def start(jobs, every=CHECK_EVERY_S):
    """The thread. A second call in the same process does nothing."""
    if getattr(start, "thread", None) and start.thread.is_alive():
        return start.thread

    def loop():
        _STOP.wait(random.uniform(0, 15))        # the web processes do not look at the same second
        while not _STOP.is_set():
            tick(jobs)
            _STOP.wait(every)
    start.thread = threading.Thread(target=loop, name="daily-jobs", daemon=True)
    start.thread.start()
    return start.thread
