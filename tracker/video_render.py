"""Video Studio: one render job, start to finish.

run_job(job) takes a claimed "render" job and its version's composition:

  1. Checks and writes the files into a fresh sandbox (video_sandbox).
  2. Notes any outside address the files name (it will not load).
  3. Runs `hyperframes check`. A composition that fails it is never
     rendered: the job fails with the reasons.
  4. Renders the MP4 at high quality, within its time limit. A render that
     ends without a video is tried once more in the safe mode (one browser,
     plain screenshots) with the time that is left; what went wrong the
     first time is in the log.
  5. Takes the cover frame with ffmpeg.
  6. Stores the MP4, the cover and the step timings on the version.

Every step is written to the job's log, and the addresses the browser tried
to reach are logged too. The result is {"outcome": "done" | "failed",
"error": str}. Stopped (the worker is shutting down) is raised to the caller,
which hands the job back.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from tracker import video_config as cfg
from tracker import video_engine, video_sandbox, video_store

log = logging.getLogger("video_studio.render")

MAX_REASONS = 6
# A safe-mode second try needs at least this long to be worth starting.
MIN_RETRY_S = 90
RENDER_FAILED = ("The video could not be rendered%s, so nothing was made. Use Try again; if it fails again, "
                 "the platform team can see why in this video's log. What went wrong: %s.")


def _failed(job, version_id, message, timings):
    video_store.add_log(job["id"], "failed", message)
    video_store.update_version(version_id, status="failed", error=message[:1000], timings=timings,
                               finished_at=datetime.now(timezone.utc))
    return {"outcome": "failed", "error": message}


def check_reasons(report):
    """The check's errors as short sentences for the job log and the person."""
    lines = []
    for e in report["errors"][:MAX_REASONS]:
        at = " at %.1fs" % e["time"] if isinstance(e.get("time"), (int, float)) and e["time"] else ""
        lines.append("%s%s: %s" % (e.get("code") or e.get("area"), at, e.get("message")))
    more = len(report["errors"]) - MAX_REASONS
    if more > 0:
        lines.append("and %d more" % more)
    return lines


def _log_lines(job, step, text, size=480, most=4):
    """A long text in the log as a few entries (each entry holds 500 characters)."""
    for i in range(0, min(len(text), size * most), size):
        video_store.add_log(job["id"], step, text[i:i + size])


def _render(job, box, duration, limit):
    """Render; when the render ends without a video, try once more in safe mode."""
    started = time.monotonic()
    try:
        return box.render(duration, timeout=limit)
    except video_sandbox.RenderFailed as exc:
        video_store.add_log(job["id"], "render_failed", exc.reason)
        _log_lines(job, "render_log", exc.log)
        left = int(limit - (time.monotonic() - started))
        if left < MIN_RETRY_S:
            raise
        video_store.add_log(job["id"], "render_retry", "safe mode: one browser, plain screenshots; %d s left" % left)
        try:
            return box.render(duration, timeout=left, safe=True)
        except video_sandbox.RenderFailed as again:
            _log_lines(job, "render_log", again.log)
            again.retried = True
            raise


def run_job(job, *, stop=None, sandbox=video_sandbox.Sandbox):
    vid = job["version_id"]
    settings = job.get("settings") or {}
    version = video_store.get_version(vid, files=True)
    if not version:
        return {"outcome": "failed", "error": "The version no longer exists."}
    # The build's timings are kept; the render adds its own.
    timings = dict(version.get("timings") or {})
    video_store.update_version(vid, status="making", error="")
    video_store.add_log(job["id"], "start", "attempt %d" % job.get("attempts", 1))
    duration = float(version.get("duration_s") or 0)
    if not (0 < duration <= cfg.MAX_SECONDS + 1):
        return _failed(job, vid, "The video's length (%.1f s) is not between %d and %d seconds."
                       % (duration, 1, cfg.MAX_SECONDS), timings)
    box = None
    try:
        files = video_sandbox.decode_files(version.get("files"))
        outside = video_sandbox.outside_addresses(files)
        if outside:
            video_store.add_log(job["id"], "outside", "The files name outside addresses, which will not load: "
                                + ", ".join(outside[:10]))
        with sandbox(job["id"], stop=stop) as box:
            box.write(files)
            if not settings.get("skip_check"):
                t = time.monotonic()
                report = box.check()
                timings["check_s"] = round(time.monotonic() - t, 1)
                video_store.add_log(job["id"], "check", "%d errors, %d warnings" % (
                    len(report["errors"]), len(report["warnings"])))
                if not report["ok"]:
                    return _failed(job, vid, "The video did not pass its check, so it was not rendered: "
                                   + "; ".join(check_reasons(report)), timings)
            limit = int(settings.get("render_timeout_s") or cfg.render_timeout(duration))
            t = time.monotonic()
            video_store.add_log(job["id"], "render", "time limit %d s" % limit)
            mp4 = _render(job, box, duration, limit)
            timings["render_s"] = round(time.monotonic() - t, 1)
            cover_at = version.get("cover_at")
            cover_at = float(cover_at) if cover_at is not None else min(duration * 0.4, 3.0)
            t = time.monotonic()
            video_store.add_log(job["id"], "cover", "at %.1f s" % cover_at)
            cover = box.cover(mp4, min(cover_at, max(0.0, duration - 0.1)))
            timings["cover_s"] = round(time.monotonic() - t, 1)
            _log_blocked(job, box)
        video_store.update_version(vid, mp4=mp4, cover=cover, mp4_bytes=len(mp4), status="ready", error="",
                                   timings=timings, finished_at=datetime.now(timezone.utc))
        video_store.add_log(job["id"], "done", "%.1f MB in %.0f s" % (len(mp4) / 1e6, timings["render_s"]))
        return {"outcome": "done", "error": ""}
    except video_engine.Stopped:
        video_store.add_log(job["id"], "stopped", "The worker is restarting; the job goes back to the queue.")
        video_store.update_version(vid, status="queued")
        raise
    except video_engine.EngineMissing as exc:
        video_store.add_log(job["id"], "engine_missing", str(exc)[:500])
        from tracker import video_builder
        return _failed(job, vid, video_builder.ENGINE_MISSING, timings)
    except video_engine.TimedOut as exc:
        _log_blocked(job, box)
        video_store.add_log(job["id"], "timed_out", str(exc))
        return _failed(job, vid, "The render took longer than its time limit, so it was stopped. Try again; if it "
                       "happens again, make the video shorter or simpler.", timings)
    except video_sandbox.BadFile as exc:
        return _failed(job, vid, "A file of the video cannot be used: %s." % exc, timings)
    except video_sandbox.RenderFailed as exc:
        _log_blocked(job, box)
        again = ", even on a second, slower try" if getattr(exc, "retried", False) else ""
        return _failed(job, vid, RENDER_FAILED % (again, exc.reason.rstrip(".")), timings)
    except Exception as exc:
        log.exception("render job %s", job["id"])
        _log_blocked(job, box)
        return _failed(job, vid, "The render failed: %s" % (str(exc)[:600] or type(exc).__name__), timings)


def _log_blocked(job, box):
    hosts = box.blocked if box is not None else []
    if hosts:
        video_store.add_log(job["id"], "blocked", "The browser tried to reach these addresses and was refused: "
                            + ", ".join(hosts[:10]), hosts=hosts[:20])
