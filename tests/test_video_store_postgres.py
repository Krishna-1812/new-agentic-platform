"""Video Studio storage against a REAL Postgres.

The in-memory store runs everywhere else; these run the SQL: the tables, the
version numbering, the bytes, the scoped reads, and the queue's claim,
renewal, expiry, attempts and hand-back. They skip without DATABASE_URL; CI
runs them in the Postgres job (.github/workflows/event-intelligence-tests.yml).
"""

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from tracker import video_store

pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"),
                                reason="needs a real Postgres; set DATABASE_URL to a throwaway database")


@pytest.fixture
def email():
    return "video-%s@markifydigital.com" % uuid.uuid4().hex[:10]


def _drain(owner="drain"):
    """Close any open jobs earlier tests left, so claims below see only ours."""
    while True:
        job = video_store.claim_job(owner, lease_s=60)
        if not job:
            return
        video_store.finish_job(job["id"], owner, "done")


def test_projects_versions_and_media_round_trip_and_are_scoped(email):
    assert video_store.backend() == "postgres"
    pid = video_store.create_project(email.upper(), title="Q3 results", kind="results", choices={"shape": "square"})
    assert video_store.get_project(pid, email)["choices"] == {"shape": "square"}
    assert video_store.get_project(pid, "other@markifydigital.com") is None
    v1 = video_store.create_version(pid, plan={"idea": "x"}, files={"index.html": {"text": "<p>é</p>"}},
                                    duration_s=12.5, cover_at=3.0)
    v2 = video_store.create_version(pid, change_request="slower")
    assert [v["number"] for v in video_store.list_versions(pid, email)] == [2, 1]
    got = video_store.get_version(v1, email, files=True)
    assert got["files"]["index.html"]["text"] == "<p>é</p>" and got["duration_s"] == 12.5
    assert "files" not in video_store.get_version(v1, email) and got["has_cover"] is False
    assert video_store.update_version(v1, mp4=b"\x00MP4", cover=b"\xff\xd8", mp4_bytes=4, status="ready",
                                      timings={"render_s": 9.5}, finished_at=datetime.now(timezone.utc))
    assert video_store.get_media(v1, "mp4", email) == b"\x00MP4"
    assert video_store.get_media(v1, "cover", "other@markifydigital.com") is None
    assert video_store.get_version(v1, email)["timings"] == {"render_s": 9.5}
    assert video_store.get_version(v2, "other@markifydigital.com") is None
    assert [p["id"] for p in video_store.list_projects(email, kind="results")] == [pid]


def test_the_queue_claims_once_expires_retries_and_fails(email):
    _drain()
    pid = video_store.create_project(email)
    vid = video_store.create_version(pid, duration_s=10)
    jid = video_store.enqueue(vid, settings={"skip_check": True})
    now = datetime.now(timezone.utc)
    job = video_store.claim_job("w1", now=now, lease_s=60)
    assert job["id"] == jid and job["attempts"] == 1 and job["settings"] == {"skip_check": True}
    assert video_store.claim_job("w2", now=now) is None
    assert video_store.renew_job(jid, "w1", now=now) and not video_store.renew_job(jid, "w2", now=now)
    video_store.add_log(jid, "render", "time limit 350 s")
    video_store.add_log(jid, "blocked", "refused", hosts=["a.example"])
    log = video_store.get_job(jid, email)["log"]
    assert [e["step"] for e in log] == ["render", "blocked"] and log[1]["hosts"] == ["a.example"]
    later = now + timedelta(seconds=120)
    again = video_store.claim_job("w2", now=later, lease_s=60)
    assert again["id"] == jid and again["attempts"] == 2
    assert video_store.hand_back(jid, "w2") is True
    assert video_store.claim_job("w3", now=later, lease_s=60)["attempts"] == 2
    assert video_store.claim_job("w4", now=later + timedelta(seconds=120), lease_s=60) is None
    job = video_store.get_job(jid)
    assert job["status"] == "failed" and video_store.get_version(vid)["status"] == "failed"
    assert video_store.jobs_for_version(vid, "other@markifydigital.com") == []


def test_the_log_keeps_its_newest_lines(email):
    pid = video_store.create_project(email)
    jid = video_store.enqueue(video_store.create_version(pid))
    for i in range(video_store.MAX_LOG + 3):
        video_store.add_log(jid, "s", str(i))
    log = video_store.get_job(jid)["log"]
    assert len(log) == video_store.MAX_LOG and log[0]["detail"] == "3" and log[-1]["detail"] == str(video_store.MAX_LOG + 2)


def test_assets_brands_and_claude_calls_round_trip(email):
    pid = video_store.create_project(email, client="Acme")
    a = video_store.add_asset(pid, "image", name="Photo", mime="image/jpeg", width=10, height=8,
                              data={"from": "upload"}, blob=b"\xff\xd8bytes")
    t = video_store.add_asset(pid, "numbers", name="Leads", data={"columns": ["Month", "Leads"], "rows": [["Jan", "1"]]})
    assert [x["kind"] for x in video_store.list_assets(pid, email)] == ["image", "numbers"]
    assert "bytes" not in video_store.list_assets(pid, email)[0]
    assert video_store.get_asset(a, email, blob=True)["bytes"] == b"\xff\xd8bytes"
    assert video_store.get_asset(a, "other@markifydigital.com") is None
    assert [x["id"] for x in video_store.list_assets(pid, kinds=("numbers",))] == [t]
    assert video_store.delete_asset(t) and video_store.delete_assets(pid, ("image",)) == 1
    assert video_store.list_assets(pid) == []
    assert video_store.save_brand(email, "Acme", {"accent": "#ff0000"}, b"PNGLOGO")
    assert video_store.save_brand(email, "acme", {"accent": "#00ff00"})              # logo kept
    b = video_store.get_brand(email, " ACME ")
    assert b["brand"] == {"accent": "#00ff00", "name": "acme"} and b["logo"] == b"PNGLOGO"
    assert video_store.get_brand("other@markifydigital.com", "acme") is None
    since = datetime.now(timezone.utc) - timedelta(seconds=5)
    video_store.add_ai_call("plan", email=email, project_id=pid, version_id=None, model="m", cost_usd=0.25,
                            input_tokens=10, output_tokens=5)
    assert video_store.ai_spend(since)["cost_usd"] >= 0.25


def test_the_library_drafts_and_brands_for_the_pages(email):
    """Phase 4's store: the library in one query, drafts, and the brands list."""
    a = video_store.create_project(email, client="Acme", brief="First", kind="results", status="draft")
    b = video_store.create_project(email, brief="Second", kind="hiring")
    hidden = video_store.create_project(email, brief="Engine", kind="engine_test")
    v1 = video_store.create_version(b, plan={"idea": "Plan one"}, status="ready", duration_s=20, shape="vertical")
    v2 = video_store.create_version(b, plan={"idea": "Plan two"}, status="queued", duration_s=20)
    video_store.create_version(hidden, status="ready")
    rows = video_store.library(email, exclude_kinds=("engine_test", "plan_test"))
    assert [r["id"] for r in rows] == [b, a]
    assert rows[0]["versions"] == 2 and rows[0]["latest"]["id"] == v2 and rows[0]["latest"]["idea"] == "Plan two"
    assert rows[0]["ready"]["id"] == v1 and rows[0]["ready"]["shape"] == "vertical"
    assert rows[1]["latest"] is None and rows[1]["ready"] is None and rows[1]["status"] == "draft"
    assert video_store.library("other@markifydigital.com") == []
    assert video_store.update_project(a, status="active") and video_store.get_project(a)["status"] == "active"
    assert not video_store.delete_project(a, "other@markifydigital.com")
    assert video_store.delete_project(b, email) and video_store.get_version(v1) is None
    assert video_store.save_brand(email, "Acme  Co", {"accent": "#ff0000"}, b"PNGLOGO")
    assert video_store.save_brand(email, "acme co", {"accent": "#00ff00"}, clear_logo=True)
    rows = video_store.list_brands(email)
    assert len(rows) == 1 and rows[0]["brand"]["name"] == "acme co" and rows[0]["has_logo"] is False
    assert video_store.delete_brand(email, "ACME CO") and video_store.list_brands(email) == []
