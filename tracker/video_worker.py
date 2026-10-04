"""Video Studio: the job thread on the Page Watch worker.

The worker service (python -m tracker.watch_worker) runs one VideoRunner next
to its page checks: one job at a time per worker ("plan": read the sources
and write the plan; "render"), so Page Watch keeps its own threads.
The pattern is Page Watch's:

  * claim_job takes the oldest open job with a lease; a side thread renews
    the lease every JOB_LEASE_S/3 seconds while the job runs, so a worker
    that dies loses the job within JOB_LEASE_S and another worker runs it.
  * A job interrupted MAX_ATTEMPTS times is failed, not retried for ever.
  * On SIGTERM (a deploy) the render is stopped at once and the job handed
    back, to be run again from the start by whoever runs next.
  * After each job, and at start, the runner records what the engine has on
    this machine (Node, ffmpeg, the browser, the HyperFrames version) for the
    staff page.
  * When a video is ready, or making one failed, the client's Slack channel
    is told (video_notify; optional).
  * Every PRUNE_EVERY_S the clean-up runs (video_store.prune): MP4s older
    than VIDEO_KEEP_DAYS, old key frames, drafts never started.
"""

from __future__ import annotations

import logging
import random
import socket
import threading
import time
from datetime import datetime, timezone

from tracker import video_config as cfg
from tracker import video_engine, video_render, video_store

log = logging.getLogger("video_studio.worker")

ENGINE_META = "video_engine"


def run_any(job, stop=None):
    """Run a job by its kind: "plan", "build", "change" or "render"."""
    if job.get("kind") == "plan":
        from tracker import video_planner
        return video_planner.run_job(job, stop=stop)
    if job.get("kind") in ("build", "change"):
        from tracker import video_builder
        return video_builder.run_job(job, stop=stop)
    return video_render.run_job(job, stop=stop)


class VideoRunner:
    def __init__(self, owner, *, stopping=None, run=None, poll_s=cfg.POLL_S, lease_s=cfg.JOB_LEASE_S):
        self.owner = owner
        self.stopping = stopping or threading.Event()
        self.run = run or run_any
        self.poll_s, self.lease_s = poll_s, lease_s
        self.current = None
        self.jobs = 0
        self._thread = None
        self._last_prune = float("-inf")

    def process_one(self):
        """Claim and run one job. False when there was none."""
        job = video_store.claim_job(self.owner, lease_s=self.lease_s)
        if not job:
            return False
        self.current = job["id"]
        done = threading.Event()
        renewer = threading.Thread(target=self._renew, args=(job["id"], done), daemon=True,
                                   name="video-renew-%s" % job["id"])
        renewer.start()
        try:
            try:
                result = self.run(job, stop=self.stopping)
            except video_engine.Stopped:
                video_store.hand_back(job["id"], self.owner)
                log.info("video job %s handed back", job["id"])
                return True
            except Exception as exc:
                log.exception("video job %s", job["id"])
                what = {"plan": "Making the plan", "build": "Building the video", "change": "Making the change"}
                result = {"outcome": "failed", "error": "%s stopped with an error (%s). Try again." % (
                    what.get(job.get("kind"), "The render"), type(exc).__name__)}
                video_store.update_version(job["version_id"], status="failed", error=result["error"],
                                           finished_at=datetime.now(timezone.utc))
        finally:
            done.set()
            renewer.join(timeout=5)
            self.current = None
        status = "done" if result.get("outcome") == "done" else "failed"
        if not video_store.finish_job(job["id"], self.owner, status, result.get("error", "")):
            log.warning("video job %s: the lease was lost during the render", job["id"])
        self.tell(job, status)
        self.jobs += 1
        log.info("video job %s: %s", job["id"], status)
        self.record_engine()
        return True

    def tell(self, job, status):
        """The optional Slack message: a finished render, or a failed build, change or render."""
        if job.get("kind") == "plan" or (status == "done" and job.get("kind") != "render"):
            return
        try:
            from tracker import video_notify
            video_notify.version_finished(job["version_id"], status == "done")
        except Exception:
            log.exception("video job %s: the Slack message failed", job["id"])

    def housekeeping(self, now=None):
        """The clean-up, at most every PRUNE_EVERY_S."""
        now = now if now is not None else time.monotonic()
        if now - self._last_prune < cfg.PRUNE_EVERY_S:
            return None
        self._last_prune = now
        try:
            out = video_store.prune(keep_mp4_days=cfg.keep_days())
            log.info("video clean-up: %s", out)
            return out
        except Exception:
            log.exception("video clean-up")
            return None

    def _renew(self, job_id, done):
        while not done.wait(self.lease_s / 3):
            try:
                if not video_store.renew_job(job_id, self.owner, lease_s=self.lease_s):
                    log.warning("video job %s: lease lost", job_id)
                    return
            except Exception:
                log.exception("video job %s: lease renewal failed", job_id)

    def loop(self):
        # Install the pinned engine now, so the first video does not wait for npm.
        try:
            video_engine.ensure_installed()
        except Exception as exc:
            log.warning("the video engine is not ready: %s", str(exc)[:300])
        self.record_engine()
        while not self.stopping.is_set():
            self.housekeeping()
            try:
                busy = self.process_one()
            except Exception:
                log.exception("video loop")
                busy = False
                self.stopping.wait(5)
            if not busy:
                self.stopping.wait(self.poll_s * random.uniform(0.8, 1.2))

    def start(self):
        self._thread = threading.Thread(target=self.loop, name="video-render", daemon=True)
        self._thread.start()
        log.info("video renderer started (HyperFrames %s)", cfg.HYPERFRAMES_VERSION)

    def join(self, timeout):
        if self._thread:
            self._thread.join(timeout=timeout)

    def record_engine(self):
        from tracker import watch_store
        try:
            watch_store.set_meta(ENGINE_META, dict(video_engine.status(), worker=self.owner,
                                                   host=socket.gethostname()[:60], jobs=self.jobs,
                                                   at=datetime.now(timezone.utc).isoformat()))
        except Exception:
            log.exception("recording the engine status")


def engine_status():
    """What the last worker recorded about its engine, or None."""
    from tracker import watch_store
    return watch_store.get_meta(ENGINE_META)
