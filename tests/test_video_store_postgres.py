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
