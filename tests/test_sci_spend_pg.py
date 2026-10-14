"""Social Media Intelligence's spend and its one-run-at-a-time rule, against a real Postgres.

A whole run goes through the real pipeline, store, pattern classifier and report writer with only the outside
vendors faked, and the admin panel's reader (tracker/admin_spend.py) is then asked what it cost: the loop
that was open until now (nothing wrote the cost, so the panel read $0).
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests.test_market_radar_store import pg  # noqa: E402,F401  (a throwaway Postgres; skips without one)
from tracker import admin_spend, sci_identify, sci_pipeline, sci_store, sci_synthesize, sci_vision  # noqa: E402

OWNER = "kris@markifydigital.com"
OTHER = "mia@markifydigital.com"


@pytest.fixture
def db(pg, monkeypatch):
    monkeypatch.setattr(sci_store, "_TABLES_READY", False)
    monkeypatch.delenv("SCI_RUN_CAP_USD", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    return monkeypatch


# == the store =================================================================================

def test_a_runs_cost_is_the_sum_of_what_was_logged_by_vendor(db):
    rid = sci_store.save_run(OWNER, "Acme")
    sci_store.log_spend(rid, "instagram", "anthropic", "vision", 1500, 0.05)
    sci_store.log_spend(rid, "instagram", "anthropic", "vision", 1500, 0.07)
    sci_store.log_spend(rid, "tiktok", "apify", "scrape", None, 0.30)
    other = sci_store.save_run(OWNER, "Other")
    sci_store.log_spend(other, None, "anthropic", "identify", 10, 9.0)
    got = sci_store.run_spend(rid)
    assert got["usd"] == pytest.approx(0.42) and got["by_vendor"] == {"anthropic": 0.12, "apify": 0.3}
    assert sci_store.run_spend(999) == {"usd": 0.0, "by_vendor": {}}


def test_a_running_analysis_blocks_that_persons_next_one_and_nobody_elses(db):
    rid = sci_store.save_run(OWNER, "Nike")
    assert sci_store.active_run(OWNER)["id"] == rid
    assert sci_store.active_run(OTHER) is None, "another person is not blocked"
    sci_store.update_run_status(rid, "done")
    assert sci_store.active_run(OWNER) is None, "a finished run blocks nothing"


def test_a_run_a_deploy_killed_does_not_block_forever(db):
    rid = sci_store.save_run(OWNER, "Nike")
    old = datetime.now(timezone.utc) - timedelta(minutes=sci_store.STALE_RUN_MINUTES + 5)
    db.setattr(sci_store, "run_last_activity", lambda run_id: old)
    assert sci_store.active_run(OWNER) is None
    assert sci_store.get_run(rid, OWNER)["status"] == "error", "it was settled as interrupted"


# == a whole run, then the admin panel =========================================================

class Blk:
    type = "text"

    def __init__(self, t):
        self.text = t


class Resp:
    stop_reason = "end_turn"

    def __init__(self, t):
        self.content = [Blk(t)]
        self.usage = SimpleNamespace(input_tokens=1000, output_tokens=500)


class Client:
    def __init__(self, kind):
        self.kind, self.messages = kind, self

    def create(self, **kw):
        if self.kind == "vision":
            return Resp(json.dumps({"summary": "a product shot", "messaging": "buy now"}))
        posts = json.loads(kw["messages"][0]["content"])["posts"]
        ids = [p["id"] for p in posts]
        plats = {p["platform"]: {"summary": "s", "claims": [{"text": "c", "post_ids": ids[:2]}]} for p in posts}
        return Resp(json.dumps({"platforms": plats, "cross_platform": {"summary": "x", "claims": [{"text": "y", "post_ids": ids[:2]}]}}))


def _posts(n, plat):
    now = datetime.now(timezone.utc)
    return [{"platform_post_id": "%s%d" % (plat, i), "post_url": "https://x/%d" % i, "post_type": "image", "caption": "c",
             "posted_at": (now - timedelta(days=i)).isoformat(), "media_urls": ["https://cdn.x/%s%d.jpg" % (plat, i)],
             "metrics": {"likes": i}, "raw": {}} for i in range(n)]


def _run(db, n_posts, space=""):
    ident = {p: {"handle": None, "profile_url": None, "confidence": "none", "reasoning": "no"} for p in
             ("linkedin", "x", "tiktok", "facebook", "reddit")}
    ident["instagram"] = {"handle": "acme", "profile_url": None, "confidence": "high", "reasoning": ""}
    ident["youtube"] = {"handle": "acme", "profile_url": None, "confidence": "high", "reasoning": ""}
    db.setattr(sci_identify, "identify_handles", lambda name, url=None: ident)
    db.setattr(sci_vision, "_anthropic", lambda: Client("vision"))
    db.setattr(sci_synthesize, "_anthropic", lambda: Client("synth"))
    db.setattr(sci_pipeline, "_collect_instagram", lambda h: (_posts(n_posts, "ig"), "apify"))
    db.setattr(sci_pipeline, "_collect_youtube", lambda h: (_posts(n_posts, "yt"), "youtube_api", "UC1"))
    db.setattr(sci_pipeline, "run_reddit_pulse", lambda *a, **k: None)
    rid = sci_store.save_run(OWNER, "Acme", "https://acme.example", space=space)
    sci_pipeline._sci_run_analysis_job(rid, OWNER, "Acme", "https://acme.example")
    return rid


def test_a_whole_run_writes_its_cost_and_the_admin_panel_reads_it(db):
    rid = _run(db, 6, space="acct:7")
    run = sci_store.get_run(rid, OWNER)
    assert run["status"] == "done" and run["synthesis"] and "error" not in run["synthesis"]
    cost = sci_store.run_spend(rid)
    assert cost["usd"] > 0 and set(cost["by_vendor"]) == {"anthropic"}
    # 12 posts read + the report = 13 Claude replies at $0.007 each (identify is faked)
    assert cost["usd"] == pytest.approx(13 * 0.007, rel=0.01)
    got = admin_spend.collect(datetime.now(timezone.utc) - timedelta(days=1))
    sci = [r for r in got["rows"] if r["agent"] == "social-media-intelligence"]
    assert len(sci) == 13 and {r["space"] for r in sci} == {"acct:7"} and {r["email"] for r in sci} == {OWNER}
    assert sum(r["usd"] for r in sci) == pytest.approx(cost["usd"])
    status = [s for s in got["sources"] if s["agent"] == "social-media-intelligence"][0]
    assert status["ok"] and status["runs"] == 13


def test_each_logged_cost_names_the_platform_it_belongs_to(db):
    rid = _run(db, 4)
    import psycopg2
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    cur.execute("SELECT platform, count(*) FROM sci_spend_log WHERE run_id = %s GROUP BY platform", (rid,))
    got = dict(cur.fetchall())
    assert got.get("instagram") == 4 and got.get("youtube") == 4
    assert got.get(None) == 1, "the report belongs to the run, not a platform"


def test_a_tight_cap_stops_the_reading_but_the_run_still_ends_with_a_report(db):
    db.setenv("SCI_RUN_CAP_USD", "0.03")                 # five Claude replies at $0.007 pass it
    db.setenv("SCI_PARALLEL_PLATFORMS", "1")             # one after another, so which stops is certain
    rid = _run(db, 8)
    run = sci_store.get_run(rid, OWNER)
    states = [p["creative_analysis_status"] for p in sci_store.get_posts(rid)]
    assert states.count("ok") == 5 and states.count("skipped") == 3, "Instagram: five read, three left"
    plats = {p["platform"]: p for p in sci_store.get_platform_runs(rid)}
    assert "3 of 8 posts were collected but not described" in plats["instagram"]["status_detail"]
    assert plats["youtube"]["status"] == "scrape_failed" and "cost cap ($0.03)" in plats["youtube"]["status_detail"], \
        "YouTube, which would have started after the cap, was not even collected"
    assert sci_store.run_spend(rid)["usd"] == pytest.approx(5 * 0.007 + 0.007, rel=0.01), "five reads and the report"
    assert run["status"] == "done" and run["synthesis"] and "error" not in run["synthesis"], \
        "a capped run still finishes with a report of what it read"
