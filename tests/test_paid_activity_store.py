"""The Paid Marketing agents' workspace History on a real Postgres (tracker/paid_activity.py): one row per
workspace, agent, ad account and day, moved on by a later read that day, and each workspace reads only its own."""
import os
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import paid_activity as store  # noqa: E402
from tests.test_market_radar_store import pg  # noqa: E402,F401  (fixture)


@pytest.fixture
def db(pg, monkeypatch):
    monkeypatch.setattr(store, "_READY", False)
    return store


def test_a_days_reads_of_one_account_are_one_row_and_the_last_one_shows(db):
    db.record("acct:1", "performance-summarizer", "1234567890", "ana@x.com", "Performance of Example", "2026-10-01 to 2026-10-07")
    db.record("acct:1", "performance-summarizer", "1234567890", "raj@x.com", "Performance of Example", "2026-09-01 to 2026-09-30")
    db.record("acct:1", "performance-summarizer", "2345678901", "raj@x.com", "Performance of Other", "")
    db.record("acct:1", "geo-performance", "1234567890", None, "Geo of Example", "")
    db.record("acct:2", "performance-summarizer", "1234567890", "ana@x.com", "Not this workspace's", "")
    rows = db.space_rows("acct:1")
    assert len(rows) == 3, "one row per agent and account for the day"
    first = [r for r in rows if r["agent"] == "performance-summarizer" and r["account"] == "1234567890"]
    assert len(first) == 1 and first[0]["who"] == "raj@x.com" and first[0]["detail"] == "2026-09-01 to 2026-09-30"
    assert rows[0]["title"] == "Geo of Example" and rows[0]["who"] == "", "newest first; nobody's name is empty"
    assert [r["title"] for r in db.space_rows("acct:2")] == ["Not this workspace's"]


def test_yesterdays_row_stays_and_today_starts_a_new_one(db):
    db.record("acct:1", "performance-summarizer", "1234567890", "ana@x.com", "Yesterday", "")
    db._exec("UPDATE pm_activity SET day = day - 1, created_at = created_at - interval '1 day'")
    db.record("acct:1", "performance-summarizer", "1234567890", "ana@x.com", "Today", "")
    assert [r["title"] for r in db.space_rows("acct:1")] == ["Today", "Yesterday"]
    assert len(db.space_rows("acct:1", limit=1)) == 1
