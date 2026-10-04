"""The Phase 5 load run: three videos queued at once while Page Watch checks.

    python3 scripts/load_video_studio.py [--watch-url URL] [--watch-threads 2]

Needs the engine (VIDEO_ENGINE_DIR with HyperFrames installed), a browser and
ffmpeg, as on the worker. It queues three renders: the 10-second landscape
sample, the 45-second vertical chart sample and a 60-second landscape video
of all 16 scene templates. The worker's own VideoRunner renders them, one at
a time as on Railway, while Page Watch-style checks of --watch-url run in
--watch-threads threads (the worker's default is 2), with the real browser.

It samples the memory of this process and everything it starts (the render
browser, Node, ffmpeg and Page Watch's browser) twice a second, as PSS
(shared pages counted once), and prints the peak, the peak per program, how
long each render took, and how many page checks ran.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.pop("DATABASE_URL", None)


class Sampler:
    def __init__(self, every=0.5):
        import psutil
        self.me = psutil.Process()
        self.every = every
        self.peak, self.peak_by = 0, defaultdict(int)
        self.samples = 0
        self._stop = threading.Event()
        self._t = threading.Thread(target=self.run, daemon=True)

    @staticmethod
    def kind(p):
        try:
            name = (p.name() or "").lower()
        except Exception:
            return "other"
        for k in ("chrome", "headless", "node", "ffmpeg", "python"):
            if k in name:
                return "browser" if k in ("chrome", "headless") else k
        return name[:20] or "other"

    def run(self):
        while not self._stop.is_set():
            total, by = 0, defaultdict(int)
            for p in [self.me] + self.me.children(recursive=True):
                try:
                    m = p.memory_full_info()
                    used = getattr(m, "pss", 0) or m.rss
                except Exception:
                    continue
                total += used
                by[self.kind(p)] += used
            self.samples += 1
            if total > self.peak:
                self.peak, self.peak_by = total, dict(by)
            self._stop.wait(self.every)

    def start(self):
        self._t.start()

    def stop(self):
        self._stop.set()
        self._t.join(timeout=5)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--watch-url", default="https://www.python.org/")
    ap.add_argument("--watch-threads", type=int, default=2)
    args = ap.parse_args()

    from tracker import video_samples, video_store, video_worker, watch_capture
    video_store.reset_memory()
    pid = video_store.create_project("load@markifydigital.com", title="Load run", kind="engine_test")
    jobs = []
    for name, s in (("10 s landscape", video_samples.title_image_end()),
                    ("45 s vertical chart", video_samples.chart_vertical())):
        vid = video_store.create_version(pid, files=s["files"], shape=s["shape"], duration_s=s["duration_s"],
                                         cover_at=s["cover_at"], status="queued", plan={"title": name})
        jobs.append((name, vid, video_store.enqueue(vid)))
    big = video_samples.sixty_seconds()
    vid = video_store.create_version(pid, files=big["files"], shape="landscape", duration_s=big["duration_s"],
                                     cover_at=big["cover_at"], status="queued", plan={"title": big["title"]})
    jobs.append(("60 s landscape, 18 scenes", vid, video_store.enqueue(vid)))

    sampler = Sampler()
    sampler.start()
    stop = threading.Event()
    checks = {"ok": 0, "failed": 0}

    def watch_loop():
        while not stop.is_set():
            cap = watch_capture.capture(args.watch_url, screenshots=True)
            checks["ok" if cap.ok else "failed"] += 1
    watchers = [threading.Thread(target=watch_loop, daemon=True) for _ in range(args.watch_threads)]
    for t in watchers:
        t.start()

    runner = video_worker.VideoRunner("load")
    runner.record_engine = lambda: None
    started = time.monotonic()
    while runner.process_one():
        pass
    took = time.monotonic() - started
    stop.set()
    for t in watchers:
        t.join(timeout=120)
    sampler.stop()

    mb = lambda b: round(b / 1048576)        # noqa: E731
    out = {"renders": [], "all_renders_s": round(took), "page_checks": checks,
           "peak_mb": mb(sampler.peak), "peak_by_program_mb": {k: mb(v) for k, v in sorted(sampler.peak_by.items())},
           "samples": sampler.samples}
    for name, vid, jid in jobs:
        v = video_store.get_version(vid)
        out["renders"].append({"video": name, "status": v["status"], "error": v.get("error") or "",
                               "mp4_mb": round((v.get("mp4_bytes") or 0) / 1e6, 1), "timings": v.get("timings")})
    print(json.dumps(out, indent=1))
    sys.exit(0 if all(r["status"] == "ready" for r in out["renders"]) else 1)


if __name__ == "__main__":
    main()
