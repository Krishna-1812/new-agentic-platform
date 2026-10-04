"""Video Studio: the failure drills (Phase 5), run on the live worker.

Each drill makes one video, as a person would, that meets one failure on the
real worker, so staff can see what the person sees and that Try again works.
Drill videos are of kind "drill": they open on the video page like any other,
but stay out of the library and send no Slack message.

  site_never_answers  the website never answers. Each page waits out its
                      limit; the reading's budget stops it; the plan goes on
                      without the site and says so.
  claude_down         Claude cannot be reached. The plan step fails with a
                      plain message and nothing half-made; Try again plans
                      it for real.
  budget              the month's budget is spent (for this plan only). The
                      plan step says so; nothing is called.
  render_fails        a built video whose render runs out of time. The
                      reason is shown; Try again renders it again, and that
                      render finishes.

A restart mid-render and a bad upload are drilled by hand (docs section 7):
redeploy the worker while a video renders, and upload a renamed text file, a
very large picture and a broken table on the start page.
"""

from __future__ import annotations

import time

from tracker import video_samples, video_store, video_web

KIND = "drill"
DRILLS = {
    "site_never_answers": "Drill: a website that never answers",
    "claude_down": "Drill: Claude cannot be reached",
    "budget": "Drill: this month's budget is used up",
    "render_fails": "Drill: a render that fails, then works",
}
# How long each page of the never-answering site waits (the real limit is 90 s
# a page; the drill is shorter so it ends in about a minute).
PAGE_WAIT_S = 25
READ_BUDGET_S = 45
BRIEF = ("A 15-second explainer of what our agency does, calm and clear, ending on 'Book a call'. "
         "We help B2B companies find buyers and turn them into meetings.")


def never_answering_reader(wait_s=PAGE_WAIT_S, budget_s=READ_BUDGET_S, sleep=time.sleep):
    """video_site.read with a capture that never gets an answer from the site."""
    from tracker import video_site, watch_capture

    def capture(url, **kw):
        sleep(wait_s)
        return watch_capture.Capture(url=url, error="timeout", error_detail="The page took over %ds." % wait_s)

    def read(url, brief, on_step=None):
        return video_site.read(url, brief, capture=capture, on_step=on_step, budget_s=budget_s)
    return read


class DownClaude:
    """A Claude client whose every call fails as an overloaded API does."""

    class Overloaded(Exception):
        status_code = 529

    def __init__(self):
        from types import SimpleNamespace
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **kw):
        raise self.Overloaded("overloaded")


def start(email, which):
    """Queue a drill. Returns (project id, version id)."""
    if which not in DRILLS:
        raise ValueError("Unknown drill.")
    title = DRILLS[which]
    if which == "render_fails":
        s = video_samples.title_image_end()
        pid = video_store.create_project(email, title=title, brief=title, kind=KIND,
                                         choices={"kind": "custom", "shape": s["shape"], "seconds": s["duration_s"],
                                                  "style": "", "words": "write", "website": "", "brand": {}})
        # Built already (so Try again only renders it again); the first render
        # has a limit far too short to finish.
        plan = {"idea": title, "scenes": [{"type": "title", "seconds": s["duration_s"], "headline": "Drill"}],
                "build": {"ended": "templates", "summary": "A drill."}}
        vid = video_store.create_version(pid, files=s["files"], shape=s["shape"], duration_s=s["duration_s"],
                                         cover_at=s["cover_at"], status="queued_render", plan=plan)
        video_store.enqueue(vid, kind="render", settings={"render_timeout_s": 3, "skip_check": True})
        return pid, vid
    choices = {"kind": "explainer", "shape": "landscape", "seconds": 15, "style": "Calm", "words": "write",
               "script": "", "website": "https://example.com" if which == "site_never_answers" else "",
               "brand": {}}
    pid = video_store.create_project(email, title=title, brief=BRIEF, kind=KIND, choices=choices)
    vid = video_web.queue_plan(pid, choices, {"drill": which})
    return pid, vid


def runs(email, limit=12):
    """The person's drill videos, newest first, for the engine page."""
    out = []
    for p in video_store.list_projects(email, limit=limit, kind=KIND):
        versions = video_store.list_versions(p["id"], email)
        latest = versions[0] if versions else None
        out.append({"project": p["id"], "title": p["title"], "url": "/strategic-agents/video-studio/videos/%d" % p["id"],
                    "status": latest["status"] if latest else "draft", "versions": len(versions),
                    "error": (latest or {}).get("error") or "", "created_at": p.get("created_at")})
    return out
