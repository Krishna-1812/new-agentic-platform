"""Video Studio: what the website shows (the website never renders).

Phase 1 has one staff page, the engine page: what the worker's engine has,
the queue, and the engine tests (the two test videos and the two sandbox
drills), each with its log, its cover and its MP4 to download.

A person's engine tests live in one project of theirs, kind "engine_test".
"""

from __future__ import annotations

from tracker import video_samples, video_store, video_worker

TEST_KIND = "engine_test"
TESTS = ("samples", "outside_drill", "hang_drill")


def _test_project(email, create=False):
    for p in video_store.list_projects(email, limit=5, kind=TEST_KIND):
        return p["id"]
    if not create:
        return None
    return video_store.create_project(email, title="Engine tests", kind=TEST_KIND)


def start_test(email, which):
    """Queue an engine test; returns the new version ids."""
    if which not in TESTS:
        raise ValueError("Unknown test.")
    names = list(video_samples.SAMPLES) if which == "samples" else [which]
    pid = _test_project(email, create=True)
    out = []
    for name in names:
        s = (video_samples.SAMPLES.get(name) or video_samples.DRILLS[name])()
        vid = video_store.create_version(pid, files=s["files"], shape=s["shape"], duration_s=s["duration_s"],
                                         cover_at=s["cover_at"], status="queued",
                                         plan={"title": s["title"], "test": name})
        video_store.enqueue(vid, settings=video_samples.DRILL_SETTINGS.get(name, {}))
        out.append(vid)
    return out


def engine_page(email, limit=12):
    """Everything the engine page shows, as JSON-ready data."""
    pid = _test_project(email)
    runs = []
    for v in (video_store.list_versions(pid, email) if pid else [])[:limit]:
        jobs = video_store.jobs_for_version(v["id"], email)
        job = jobs[0] if jobs else {}
        runs.append({
            "id": v["id"], "title": (v.get("plan") or {}).get("title") or "Version %d" % v["number"],
            "test": (v.get("plan") or {}).get("test"), "status": v["status"], "error": v.get("error") or "",
            "shape": v.get("shape"), "seconds": v.get("duration_s"), "mb": round((v.get("mp4_bytes") or 0) / 1e6, 1),
            "timings": v.get("timings") or {}, "has_cover": v.get("has_cover"), "created_at": v.get("created_at"),
            "finished_at": v.get("finished_at"), "attempts": job.get("attempts"),
            "log": [{"step": e.get("step"), "detail": e.get("detail"), "at": e.get("at")} for e in job.get("log") or []],
        })
    try:
        engine = video_worker.engine_status()
    except Exception:
        engine = None
    return {"engine": engine, "queue": video_store.queue_stats(), "runs": runs,
            "busy": any(r["status"] in ("queued", "making") for r in runs)}
