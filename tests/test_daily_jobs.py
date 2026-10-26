"""Jobs the site runs itself at a time of day (tracker/daily_jobs.py), and the Google Ads digest at 11:30 India
time: it was started by a scheduled GitHub Action that GitHub ran 4 to 6 hours late."""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as appmod  # noqa: E402
from tracker import daily_jobs as dj  # noqa: E402

IST = dj.IST


def at(hh, mm, day=26, ss=0):
    """An India-time moment on 26 Oct 2026, as the aware datetime the clock gives."""
    return datetime(2026, 10, day, hh, mm, ss, tzinfo=IST)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    dj.reset_memory()
    yield
    dj.reset_memory()


def test_a_time_of_day_is_read_however_it_is_typed():
    assert dj.at_of("11:30") == dj.at_of("11.30") == dj.at_of("11:30 AM") == dj.at_of(" 11 : 30 am ") == (11, 30)
    assert dj.at_of("1:05 pm") == (13, 5) and dj.at_of("12:00 am") == (0, 0) and dj.at_of("12:15 pm") == (12, 15)
    assert dj.at_of("bogus") == dj.at_of("25:00") == dj.at_of("") == dj.at_of(None) == (11, 30), "the morning time"


def test_a_job_is_due_from_its_time_until_its_grace_is_over():
    on = (11, 30)
    assert not dj.due(at(11, 29, ss=59), on, 120) and dj.due(at(11, 30), on, 120)
    assert dj.due(at(13, 29, ss=59), on, 120) and not dj.due(at(13, 30), on, 120), "not in the evening"
    assert not dj.due(at(18, 0), on, 120) and not dj.due(at(2, 0), on, 120)
    utc = datetime(2026, 10, 26, 6, 0, tzinfo=timezone.utc)      # 06:00 UTC is 11:30 in India
    assert dj.due(utc, on, 120) and not dj.due(utc - timedelta(minutes=1), on, 120)


def _jobs(results, name="digest", at_="11:30", grace=120):
    calls = []

    def run():
        calls.append(1)
        r = results[min(len(calls), len(results)) - 1]
        if isinstance(r, Exception):
            raise r
        return r
    return [dj.Job(name, at_, run, grace)], calls


def test_it_runs_once_at_its_time_and_not_again_that_day():
    jobs, calls = _jobs([True])
    assert dj.tick(jobs, at(11, 29)) == [] and not calls, "not before"
    assert dj.tick(jobs, at(11, 31)) == [("digest", True)] and len(calls) == 1
    for minute in (32, 45):
        assert dj.tick(jobs, at(11, minute)) == [] and len(calls) == 1, "done for the day"
    assert dj.tick(jobs, at(11, 31, day=27)) == [("digest", True)] and len(calls) == 2, "tomorrow again"


def test_two_web_processes_looking_at_the_same_moment_run_it_once():
    jobs, calls = _jobs([True])
    assert [dj.tick(jobs, at(11, 30, ss=5)), dj.tick(jobs, at(11, 30, ss=6))] == [[("digest", True)], []] and len(calls) == 1


def test_a_failed_run_is_tried_again_after_a_pause_and_not_for_ever():
    now = datetime(2026, 10, 26, 6, 1, tzinfo=timezone.utc)          # 11:31 in India
    jobs, calls = _jobs([False, RuntimeError("slack down"), True])
    assert dj.tick(jobs, now) == [("digest", False)]
    assert dj.tick(jobs, now + timedelta(minutes=5)) == [] and len(calls) == 1, "not yet: a pause between tries"
    assert dj.tick(jobs, now + timedelta(minutes=11)) == [("digest", False)] and len(calls) == 2, "an error is a failed try"
    assert dj.tick(jobs, now + timedelta(minutes=23)) == [("digest", True)] and len(calls) == 3
    assert dj.tick(jobs, now + timedelta(minutes=40)) == [], "it went"
    dj.reset_memory()
    jobs, calls = _jobs([False])
    for n in range(8):
        dj.tick(jobs, now + timedelta(minutes=12 * n))
    assert len(calls) == dj.MAX_ATTEMPTS == 3, "three tries in all"


def test_a_job_whose_grace_is_over_is_skipped_not_run_in_the_evening():
    jobs, calls = _jobs([True])
    assert dj.tick(jobs, at(17, 40)) == [] and not calls, "the service was down all morning: nothing in the evening"
    assert dj.tick(jobs, at(13, 29)) == [("digest", True)], "but a deploy at lunchtime still posts"


def test_a_job_that_cannot_be_checked_never_stops_the_others():
    def boom(*a, **k):
        raise RuntimeError("database down")
    good, calls = _jobs([True], name="good")
    bad = dj.Job("bad", "11:30", lambda: True)
    assert dj.tick([bad] + good, at(11, 31), claim_fn=lambda n, d, now: boom() if n == "bad" else True,
                   finish_fn=lambda *a: None) == [("good", True)] and len(calls) == 1


def test_the_digest_is_the_sites_job_at_half_past_eleven_and_the_time_can_be_moved(monkeypatch):
    monkeypatch.delenv("GOOGLE_ADS_DIGEST_AT", raising=False)
    (job,) = appmod._daily_jobs()
    assert job.name == "google-ads-digest" and job.at == (11, 30) and job.run is appmod._daily_gads_digest
    monkeypatch.setenv("GOOGLE_ADS_DIGEST_AT", "9.15")
    assert appmod._daily_jobs()[0].at == (9, 15)
    monkeypatch.setenv("GOOGLE_ADS_DIGEST_AT", "nonsense")
    assert appmod._daily_jobs()[0].at == (11, 30)


def test_the_digest_job_says_whether_to_try_again(monkeypatch):
    monkeypatch.delenv("GOOGLE_ADS_SLACK_BOT_TOKEN", raising=False)
    monkeypatch.delenv("GOOGLE_ADS_SLACK_CHANNEL", raising=False)
    monkeypatch.setattr(appmod, "_gads_digest_run", lambda **k: pytest.fail("nowhere to post: nothing is read"))
    assert appmod._daily_gads_digest() is True, "no Slack set up: nothing to do, nothing to retry"
    monkeypatch.setenv("GOOGLE_ADS_SLACK_BOT_TOKEN", "xoxb")
    monkeypatch.setenv("GOOGLE_ADS_SLACK_CHANNEL", "C1")
    seen = {}

    def run(dry_run, force=False, account=""):
        seen.update(dry_run=dry_run, force=force)
        return seen["results"]
    monkeypatch.setattr(appmod, "_gads_digest_run", run)
    seen["results"] = [{"account": "A", "status": "posted", "error": ""}, {"account": "B", "status": "skipped", "error": ""}]
    assert appmod._daily_gads_digest() is True and seen["dry_run"] is False and seen["force"] is False
    seen["results"] = [{"account": "A", "status": "posted", "error": ""}, {"account": "B", "status": "failed", "error": "channel_not_found"}]
    assert appmod._daily_gads_digest() is False, "one account not posted: the others are not posted again, this one is tried"
    seen["results"] = []
    assert appmod._daily_gads_digest() is False


def test_the_links_in_the_digest_need_no_request_and_the_clock_is_not_started_by_the_tests():
    assert appmod._gads_digest_base_url() == appmod.SITE_URL
    assert appmod._start_daily_jobs() is None, "under pytest nothing is started"
