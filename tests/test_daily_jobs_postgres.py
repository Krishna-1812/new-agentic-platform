"""The claim a daily job makes before it runs, against a REAL Postgres (tracker/daily_jobs.py): once a day, a pause
between tries, three tries, and never again once it went. They skip without DATABASE_URL; CI runs them in the
Postgres job."""
import os
import uuid

import pytest

from tracker import daily_jobs as dj

pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"),
                                reason="needs a real Postgres; set DATABASE_URL to a throwaway database")


def _backdate(job, day, minutes):
    conn = dj._pg()
    with conn.cursor() as cur:
        cur.execute("UPDATE daily_job_runs SET last_attempt = now() - make_interval(mins => %s) WHERE job = %s AND day = %s",
                    (minutes, job, day))
    conn.commit()
    conn.close()


def _row(job, day):
    conn = dj._pg()
    with conn.cursor() as cur:
        cur.execute("SELECT attempts, done FROM daily_job_runs WHERE job = %s AND day = %s", (job, day))
        got = cur.fetchone()
    conn.close()
    return got


def test_the_claim_is_once_a_day_with_a_pause_between_tries_and_three_tries():
    job, day = "t-" + uuid.uuid4().hex[:8], "2026-10-26"
    assert dj.claim(job, day) is True, "the first caller"
    assert dj.claim(job, day) is False, "another process a second later"
    _backdate(job, day, dj.RETRY_AFTER_MIN + 1)
    assert dj.claim(job, day) is True and _row(job, day) == (2, False), "a failed run is tried again"
    _backdate(job, day, 30)
    assert dj.claim(job, day) is True and _row(job, day) == (3, False)
    _backdate(job, day, 30)
    assert dj.claim(job, day) is False, "three tries in all"
    assert dj.claim(job, "2026-10-27") is True, "tomorrow is its own day"


def test_a_run_that_went_is_not_claimed_again_and_two_claims_at_once_give_one():
    import threading
    job, day = "t-" + uuid.uuid4().hex[:8], "2026-10-26"
    assert dj.claim(job, day)
    dj.finish(job, day, True)
    _backdate(job, day, 60)
    assert dj.claim(job, day) is False and _row(job, day) == (1, True)
    job2, got = "t-" + uuid.uuid4().hex[:8], []
    threads = [threading.Thread(target=lambda: got.append(dj.claim(job2, day))) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert got.count(True) == 1
    dj.finish(job2, day, False)
    assert _row(job2, day) == (1, False), "a run that did not go stays open"
