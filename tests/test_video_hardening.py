"""Video Studio, Phase 5: hardening.

Every failure in the plan has a test here (and a live drill on the engine
page, tracker/video_drills.py): a restart mid-render, a site that never
answers, bad uploads, Claude unavailable, the monthly budget reached, a
render that fails. Then keeping (version limits, daily limits, the clean-up
of old MP4s), the Slack message when a video is ready, and the security
fixes from the review (WebRTC, the proxy log, Claude's file reads, tables).
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(__file__))
from video_fakes import FakeClaude  # noqa: E402
from test_video_app import (ANA, BASE, BOB, RenderBox, _build_next, _data_url, _plan_next, _png, _post,  # noqa: E402
                            _render_next, _results_video)
from test_video_build import JobBox, ToolClaude  # noqa: E402

from tracker import (video_agent, video_app, video_builder, video_config, video_drills, video_engine,  # noqa: E402
                     video_notify, video_plan, video_planner, video_render, video_sandbox, video_site,
                     video_starts, video_store, video_uploads, video_web, video_worker, watch_capture, watch_safety)


@pytest.fixture
def store(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")
    monkeypatch.delenv("VIDEO_SLACK_CHANNEL", raising=False)
    monkeypatch.setattr(watch_safety, "check", lambda url: None)
    monkeypatch.setattr(video_engine, "status", lambda: {})
    video_store.reset_memory()
    from tracker import watch_store
    watch_store.reset_memory()
    yield video_store
    video_store.reset_memory()


@pytest.fixture
def client(store, monkeypatch):
    import app as appmod
    who = {"email": ANA, "name": "Ana"}
    monkeypatch.setattr(appmod, "_get_user", lambda: who)
    c = appmod.app.test_client()
    c.who = who
    return c


def _made(store):
    """A video planned, built and rendered: (project id, version id)."""
    pid, vid = _results_video(store)
    _plan_next(store)
    video_builder.approve(ANA, vid)
    _build_next(store)
    _render_next(store)
    return pid, vid


# ── A restart mid-render ─────────────────────────────────────────────────────
def test_a_render_stopped_by_a_restart_is_handed_back_and_runs_again(store):
    pid, vid = _results_video(store)
    _plan_next(store)
    video_builder.approve(ANA, vid)
    _build_next(store)

    class Restarting(RenderBox):
        def render(self, seconds, quality="high", timeout=None):
            raise video_engine.Stopped("the worker is shutting down")

    def run(job, stop=None):
        return video_render.run_job(job, stop=stop, sandbox=Restarting)
    video_worker.VideoRunner("w1", run=run).process_one()
    job = video_store.jobs_for_version(vid)[0]
    assert job["kind"] == "render" and job["status"] == "queued" and job["attempts"] == 0
    assert video_store.get_version(vid)["status"] == "queued"
    assert video_app.project_view(ANA, pid)["version"]["phase"] == "making"      # the person sees it carry on
    video_worker.VideoRunner("w2", run=lambda job, stop=None: video_render.run_job(job, stop=stop,
                                                                                  sandbox=RenderBox)).process_one()
    assert video_store.get_version(vid)["status"] == "ready"


def test_a_job_whose_worker_died_twice_is_failed_in_plain_words(store):
    pid, vid = _results_video(store)
    now = datetime.now(timezone.utc)
    for i in range(video_config.MAX_ATTEMPTS):
        assert video_store.claim_job("dead", now=now + timedelta(minutes=10 * i), lease_s=60)
    assert video_store.claim_job("w", now=now + timedelta(hours=1)) is None
    v = video_store.get_version(vid)
    assert v["status"] == "failed" and "interrupted" in video_app.public_error(v["error"])
    assert video_app.project_view(ANA, pid)["version"]["phase"] == "failed"


# ── A site that never answers ────────────────────────────────────────────────
def _cap(url, ok=True, error=None):
    from PIL import Image
    import io
    buf = io.BytesIO()
    Image.new("RGB", (1440, 900), (240, 240, 240)).save(buf, "PNG")
    return watch_capture.Capture(url=url, final_url=url, title="Acme", error=error,
                                 screenshot=buf.getvalue() if ok else None,
                                 blocks=[{"kind": "h1", "text": "Close in five days", "x": 0, "y": 0, "w": 10, "h": 10}]
                                 if ok else [], extra={"links": [{"href": "https://acme.example/pricing", "text": "Pricing"},
                                                                     {"href": "https://acme.example/features",
                                                                      "text": "Features"}]})


def test_a_site_that_never_answers_says_so_and_the_plan_goes_on(store):
    read = video_drills.never_answering_reader(wait_s=0, sleep=lambda s: None)
    out = read("https://acme.example", "a brief")
    assert not out["ok"] and "took too long" in out["message"]
    pid, vid = _results_video(store, website="acme.example")
    _plan_next(store, read_site=read)
    plan = store.get_version(vid)["plan"]
    assert plan["scenes"] and any("took too long" in n for n in plan["notes"])
    assert video_app.project_view(ANA, pid)["version"]["blocked"].startswith("The website took too long")


def test_a_slow_site_is_read_within_the_budget(store):
    t = [0.0]
    calls = []

    def capture(url, **kw):
        calls.append((url, (kw.get("viewport") or {}).get("width")))
        t[0] += 70                       # every page takes 70 s
        return _cap(url)
    out = video_site.read("https://acme.example", "pricing", capture=capture, budget_s=120, clock=lambda: t[0])
    assert out["ok"] and len(calls) == 2                       # the first page and one more, then out of time
    assert all(w != video_site.PHONE["width"] for _, w in calls)        # no phone picture past the budget
    assert out["notes"] == ["The website was slow, so only 2 of its pages were read."]


# ── Bad uploads ──────────────────────────────────────────────────────────────
def test_bad_uploads_are_refused_in_plain_words(client, store, monkeypatch):
    r = _post(client, BASE + "/api/videos", {"brief": "A results video for our leads"})
    pid = r.get_json()["project"]
    up = lambda name, data: _post(client, BASE + "/api/videos/%d/images" % pid, {"name": name, "data": data})  # noqa
    r = up("notes.png", _data_url(b"this is really a text file"))
    assert r.status_code == 400 and "could not be read as an image" in r.get_json()["error"]
    r = up("drawing.svg", _data_url(b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))
    assert r.status_code == 400
    monkeypatch.setattr(video_uploads, "UPLOAD_MAX_BYTES", 1000)
    r = up("big.png", _data_url(_png((800, 800), (10, 200, 30))))
    assert r.status_code == 400 and "larger than" in r.get_json()["error"]
    for table, words in (("just one column\n1\n2", "two columns"), ('a,b\n"1,2\n3,4', "never closed"),
                         ("a,b", "header row"), ("a,b\n" + "1,2\n" * 60, "more than 50 rows"),
                         ("a,b\n" + "1,2\n" * 300000, "too long")):
        r = _post(client, BASE + "/api/videos", {"brief": "A results video for our leads",
                                                  "tables": [{"name": "Leads", "text": table}]})
        assert r.status_code == 400 and r.get_json()["field"] == "sources", table[:20]
        assert words in r.get_json()["error"], (words, r.get_json()["error"])


def test_a_request_over_the_size_limit_is_answered_in_json(client, monkeypatch):
    import app as appmod
    monkeypatch.setitem(appmod.app.config, "MAX_CONTENT_LENGTH", 1024)
    r = _post(client, BASE + "/api/videos/1/images", {"name": "x.png", "data": "A" * 4000})
    assert r.status_code == 413 and "too large" in r.get_json()["error"]


# ── Claude unavailable ───────────────────────────────────────────────────────
def test_claude_unavailable_stops_the_plan_with_nothing_half_made(store):
    pid, vid = _results_video(store)
    _plan_next(store, client=video_drills.DownClaude())
    v = store.get_version(vid)
    assert v["status"] == "failed" and v["plan"] == {} and "could not be reached (529)" in v["error"]
    view = video_app.project_view(ANA, pid)["version"]
    assert view["phase"] == "failed" and view["plan"] is None and "Try again" in view["error"]
    calls = [c for c in video_store._MEM["ai_calls"].values()]
    assert calls and not calls[-1]["ok"]
    new = video_app.retry(ANA, vid)                       # Claude is back
    _plan_next(store)
    assert store.get_version(new)["status"] == "planned"


def test_claude_unavailable_during_a_change_keeps_the_video(store, monkeypatch):
    pid, vid = _made(store)
    new = video_builder.make_changes(ANA, vid, "slower")
    job = store.claim_job("w")
    out = video_builder.run_job(job, client=video_drills.DownClaude(), sandbox=JobBox)
    assert out["outcome"] == "failed" and "could not be reached" in out["error"]
    assert store.get_version(new)["status"] == "failed" and store.get_version(vid)["status"] == "ready"


def test_the_drills_go_through_the_real_planner(store, monkeypatch):
    for which in ("claude_down", "budget"):
        pid, vid = video_drills.start(ANA, which)
        before = len(video_store._MEM["ai_calls"])
        _plan_next(store)
        v = store.get_version(vid)
        assert v["status"] == "failed", which
        assert ("could not be reached" if which == "claude_down" else "budget") in v["error"]
        if which == "budget":
            assert len(video_store._MEM["ai_calls"]) == before            # nothing was called
    monkeypatch.setattr(video_drills, "PAGE_WAIT_S", 0)
    monkeypatch.setattr(video_drills.time, "sleep", lambda s: None)
    pid, vid = video_drills.start(ANA, "site_never_answers")
    _plan_next(store)
    assert any("took too long" in n for n in store.get_version(vid)["plan"]["notes"])
    with pytest.raises(ValueError):
        video_drills.start(ANA, "meteor")


# ── The monthly budget reached ───────────────────────────────────────────────
def test_past_the_budget_finishing_work_is_allowed_and_new_work_says_why(store, monkeypatch):
    pid, vid = _results_video(store)
    _plan_next(store)
    monkeypatch.setattr(video_plan, "spent_this_month", lambda now=None: 99.0)
    with pytest.raises(video_builder.Refused, match="budget"):
        video_app.start_draft(ANA, {"brief": "Another video for our leads"})
    with pytest.raises(video_builder.Refused, match="budget"):
        video_app.another_idea(ANA, vid)
    video_builder.approve(ANA, vid)                                # approving still works
    job = _build_next(store, client=ToolClaude([]))
    v = store.get_version(vid)
    assert v["status"] == "queued_render" and v["plan"]["build"]["ended"] == "templates"   # no review past the budget
    _render_next(store)
    with pytest.raises(video_builder.Refused, match="budget is used up"):
        video_builder.make_changes(ANA, vid, "slower")
    assert video_builder.another_shape(ANA, vid, "vertical")      # no Claude needed
    assert video_app.project_view(ANA, pid, vid)["claude"]["state"] == "capped"


# ── A render that fails ──────────────────────────────────────────────────────
def test_a_failed_render_says_why_and_try_again_only_renders_again(store):
    pid, vid = _results_video(store)
    _plan_next(store)
    video_builder.approve(ANA, vid)
    _build_next(store)

    class TooSlow(RenderBox):
        def render(self, seconds, quality="high", timeout=None):
            raise video_engine.TimedOut("stopped after 350s: hyperframes")
    job = store.claim_job("w")
    out = video_render.run_job(job, sandbox=TooSlow)
    store.finish_job(job["id"], "w", "failed", out["error"])
    view = video_app.project_view(ANA, pid)["version"]
    assert view["phase"] == "failed" and view["error"].startswith("The render took longer than its time limit")
    assert "hyperframes" not in json.dumps(view)
    assert video_app.retry(ANA, vid) == vid
    job = store.claim_job("w")
    assert job["kind"] == "render"                                  # not built again
    video_render.run_job(job, sandbox=RenderBox)
    assert store.get_version(vid)["status"] == "ready"


def test_a_failed_build_is_built_again(store):
    pid, vid = _results_video(store)
    _plan_next(store)
    video_builder.approve(ANA, vid)
    job = store.claim_job("w")
    store.update_version(vid, status="failed", error="The video did not pass its check: text_overflow.")
    store.finish_job(job["id"], "w", "failed")
    assert video_app.retry(ANA, vid) == vid and store.claim_job("w")["kind"] == "build"


def test_the_render_fails_drill_fails_then_works(store):
    pid, vid = video_drills.start(ANA, "render_fails")
    job = store.claim_job("w")
    assert job["kind"] == "render" and job["settings"]["render_timeout_s"] == 3
    assert video_app.project_view(ANA, pid)["version"]["phase"] == "making"
    assert video_app.library_view(ANA) == []                         # drills stay out of the library
    assert video_drills.runs(ANA)[0]["url"] == BASE + "/videos/%d" % pid


def test_public_errors_lose_bracketed_internals_but_keep_the_sentence():
    assert video_app.public_error("The render was stopped (stopped after 60s: hyperframes). Try again.") == \
        "The render was stopped. Try again."
    assert video_app.public_error("Claude could not be reached (529). Try again.") == \
        "Claude could not be reached (529). Try again."


# ── Keeping ──────────────────────────────────────────────────────────────────
def test_old_mp4s_are_removed_and_can_be_made_again(store):
    pid, vid = _made(store)
    later = datetime.now(timezone.utc) + timedelta(days=video_config.keep_days() + 1)
    out = video_store.prune(now=later)
    assert out["mp4s"] == 1 and out["frames"] >= 1
    v = store.get_version(vid)
    assert v["status"] == "ready" and v["mp4_bytes"] == 0 and store.get_media(vid, "mp4") is None
    assert store.get_media(vid, "cover")                           # the cover stays for the library
    r = video_app.project_view(ANA, pid)["version"]["result"]
    assert r["expired"] and r["keep_days"] == 90
    assert video_app.retry(ANA, vid) == vid and store.claim_job("w")["kind"] == "render"
    assert video_store.prune(now=later)["mp4s"] == 0


def test_the_clean_up_keeps_what_is_recent_and_removes_old_drafts(store):
    pid, vid = _made(store)
    draft = video_app.start_draft(ANA, {"brief": "A video that was never started"})
    assert video_store.prune() == {"mp4s": 0, "frames": 0, "drafts": 0}
    out = video_store.prune(now=datetime.now(timezone.utc) + timedelta(days=3))
    assert out == {"mp4s": 0, "frames": 0, "drafts": 1}
    assert store.get_project(draft) is None and store.get_project(pid)


def test_the_worker_cleans_up_on_a_schedule(store, monkeypatch):
    seen = []
    monkeypatch.setattr(video_store, "prune", lambda **kw: seen.append(kw) or {"mp4s": 0})
    monkeypatch.setenv("VIDEO_KEEP_DAYS", "30")
    r = video_worker.VideoRunner("w")
    assert r.housekeeping(now=1000.0) == {"mp4s": 0} and seen == [{"keep_mp4_days": 30}]
    assert r.housekeeping(now=1000.0 + 60) is None
    assert r.housekeeping(now=1000.0 + video_config.PRUNE_EVERY_S) is not None and len(seen) == 2


def test_a_video_has_at_most_so_many_versions(store, monkeypatch):
    monkeypatch.setattr(video_config, "MAX_VERSIONS", 2)
    pid, vid = _made(store)
    video_builder.another_shape(ANA, vid, "vertical")
    for go in (lambda: video_builder.make_changes(ANA, vid, "slower"),
               lambda: video_builder.another_shape(ANA, vid, "portrait")):
        with pytest.raises(video_builder.Refused, match="Duplicate it"):
            go()


def test_daily_limits_on_videos_and_plans(store, monkeypatch):
    monkeypatch.setenv("VIDEO_DAILY_VIDEOS", "1")
    monkeypatch.setenv("VIDEO_DAILY_PLANS", "2")
    pid, vid = _results_video(store)
    _plan_next(store)
    pid2, vid2 = _results_video(store)                              # the second plan of the day
    _plan_next(store)
    video_builder.approve(ANA, vid)
    with pytest.raises(video_builder.Refused, match="today's limit of 1 videos"):
        video_builder.another_shape(ANA, vid, "vertical")
    with pytest.raises(video_builder.Refused, match="today's limit of 2 plans"):
        video_app.start_draft(ANA, {"brief": "A third plan today"})
    with pytest.raises(video_builder.Refused, match="today's limit"):
        video_app.another_idea(ANA, vid2)
    assert video_app.start_draft(BOB, {"brief": "Bob's first plan today"})       # per person
    tomorrow = datetime.now(timezone.utc) + timedelta(days=1)
    assert video_store.jobs_since(ANA, ("plan",), tomorrow.replace(hour=0, minute=0)) == 0


# ── Slack when a video is ready ──────────────────────────────────────────────
class FakeSlack:
    def __init__(self):
        self.posts = []

    def post(self, url, headers=None, json=None, timeout=None):
        from types import SimpleNamespace
        self.posts.append(json)
        return SimpleNamespace(status_code=200, headers={}, json=lambda: {"ok": True, "ts": "1.2"})


def test_a_ready_video_is_announced_in_the_clients_channel(store, monkeypatch):
    monkeypatch.setenv("WATCH_SLACK_BOT_TOKEN", "xoxb-test-not-real")
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://app.example")
    video_app.save_brand(ANA, {"client": "Acme", "background": "#ffffff", "text": "#111111", "accent": "#ff6022",
                               "slack_channel": "#acme-videos"})
    pid, vid = _results_video(store, client="Acme")
    _plan_next(store)
    assert video_store.get_brand(ANA, "acme")["brand"]["slack_channel"] == "acme-videos"   # kept by the plan's save
    video_builder.approve(ANA, vid)
    _build_next(store)
    slack = FakeSlack()
    _render_next(store)
    sent = video_notify.version_finished(vid, True, session=slack)
    assert sent == (True, "")
    msg = slack.posts[-1]
    assert msg["channel"] == "acme-videos" and "Video ready" in msg["text"]
    assert msg["blocks"][1]["elements"][0]["url"] == "https://app.example%s/videos/%d?v=%d" % (BASE, pid, vid)
    store.update_version(vid, status="failed", error="The render failed: chromium crashed (hyperframes).")
    video_notify.version_finished(vid, False, session=slack)
    text = json.dumps(slack.posts[-1])
    assert "could not be made" in text and "chromium" not in text and "hyperframes" not in text


def test_no_channel_no_message_and_drills_are_never_announced(store, monkeypatch):
    monkeypatch.setenv("WATCH_SLACK_BOT_TOKEN", "xoxb-test-not-real")
    pid, vid = _made(store)
    assert video_notify.version_finished(vid, True, session=FakeSlack()) == (False, "no_channel")
    monkeypatch.setenv("VIDEO_SLACK_CHANNEL", "#videos")
    slack = FakeSlack()
    assert video_notify.version_finished(vid, True, session=slack)[0] and slack.posts[0]["channel"] == "videos"
    dpid, dvid = video_drills.start(ANA, "render_fails")
    assert video_notify.version_finished(dvid, False, session=slack)[0] is False
    monkeypatch.setenv("VIDEO_SLACK", "off")
    assert video_notify.version_finished(vid, True, session=slack) == (False, "off")


def test_the_worker_tells_slack_after_a_render_or_a_failure_but_not_a_plan(store, monkeypatch):
    told = []
    monkeypatch.setattr(video_notify, "version_finished", lambda vid, ok, session=None: told.append((vid, ok)))
    r = video_worker.VideoRunner("w")
    r.tell({"kind": "plan", "version_id": 1, "id": 1}, "failed")
    r.tell({"kind": "build", "version_id": 2, "id": 2}, "done")
    r.tell({"kind": "build", "version_id": 3, "id": 3}, "failed")
    r.tell({"kind": "render", "version_id": 4, "id": 4}, "done")
    assert told == [(3, False), (4, True)]


def test_the_slack_channel_is_checked_on_the_brands_page(store):
    with pytest.raises(video_starts.Bad) as e:
        video_app.save_brand(ANA, {"client": "Acme", "background": "#ffffff", "text": "#111111",
                                   "accent": "#ff6022", "slack_channel": "not a channel!"})
    assert e.value.field == "slack_channel"
    view = video_app.save_brand(ANA, {"client": "Acme", "background": "#ffffff", "text": "#111111",
                                      "accent": "#ff6022", "slack_channel": "C0123ABCD"})
    assert view[0]["slack_channel"] == "C0123ABCD"
    view = video_app.save_brand(ANA, {"client": "Acme", "accent": "#123456"})         # kept when not sent
    assert view[0]["slack_channel"] == "C0123ABCD"
    view = video_app.save_brand(ANA, {"client": "Acme", "slack_channel": ""})          # cleared
    assert view[0]["slack_channel"] == ""


# ── The security review's fixes ──────────────────────────────────────────────
def test_the_render_browser_may_not_send_udp_around_the_proxy(store, tmp_path, monkeypatch):
    monkeypatch.setattr(video_config, "work_dir", lambda: str(tmp_path))
    with video_sandbox.Sandbox("t", browser="/bin/true") as box:
        script = open(box.env()["HYPERFRAMES_BROWSER_PATH"]).read()
    assert "--force-webrtc-ip-handling-policy=disable_non_proxied_udp" in script
    assert "--proxy-server=http://127.0.0.1:" in script


def test_the_proxy_log_names_ip_addresses_and_hosts():
    assert video_sandbox._host_of("http://169.254.169.254/latest/meta-data/") == "169.254.169.254"
    assert video_sandbox._host_of("example.com:443") == "example.com"
    assert video_sandbox._host_of("https://Images.Example.com/x.png") == "images.example.com"
    assert video_sandbox._host_of("[::1]:80") == "::1"


def test_claude_cannot_read_through_a_link_out_of_the_project(store, tmp_path):
    from test_video_build import LoopBox, OK
    box = LoopBox(tmp_path, [OK])
    secret = tmp_path / "secret.js"
    secret.write_text("SECRET")
    os.symlink(str(secret), os.path.join(box.project, "leak.js"))
    claude = ToolClaude([[("read_file", {"path": "leak.js"})], [("done", {"summary": "ok"})]])
    video_agent.run_loop(box, claude, plan={"scenes": []}, spans=[], report=OK, frames=[], record={},
                         step=lambda *a: None, deadline=1e12)
    result = claude.calls[0]["messages"][2]["content"][0]          # the answer to the read
    assert result.get("is_error") and "SECRET" not in json.dumps(result)


def test_the_load_run_queues_three_videos_one_of_sixty_seconds(store):
    vids = video_web.start_test(ANA, "load")
    seconds = sorted(video_store.get_version(v)["duration_s"] for v in vids)
    assert len(vids) == 3 and seconds[-1] == 60.0
    assert all(j["kind"] == "render" for v in vids for j in video_store.jobs_for_version(v))


def test_the_engine_page_starts_drills_and_lists_them(client, store):
    r = _post(client, BASE + "/api/drills", {"drill": "claude_down"})
    assert r.status_code == 200 and r.get_json()["url"].startswith(BASE + "/videos/")
    assert r.get_json()["page"]["drills"][0]["title"] == video_drills.DRILLS["claude_down"]
    assert _post(client, BASE + "/api/drills", {"drill": "nope"}).status_code == 400
    body = client.get(BASE + "/engine").get_data(as_text=True)
    assert 'data-drill="render_fails"' in body and 'data-test="load"' in body
    assert client.get(r.get_json()["url"]).status_code == 200            # a drill opens on the video page


# ── The browser on Railway (the "RuntimeError" at "Checking every frame") ───
def _fake_browser(root, build, folder, name):
    path = root / ("chromium_headless_shell-%d" % build) / folder / name
    path.parent.mkdir(parents=True)
    path.write_text("#!/bin/sh\n")
    path.chmod(0o755)
    return str(path)


def test_the_newer_playwright_headless_shell_is_found(tmp_path, monkeypatch):
    """Playwright 1.5x names it chrome-headless-shell in chrome-headless-shell-linux64; the
    worker looked only for the older headless_shell, found nothing and could not check a video."""
    monkeypatch.delenv("VIDEO_BROWSER_PATH", raising=False)
    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(tmp_path))
    monkeypatch.setattr(video_config, "_playwright_root", lambda: "")
    monkeypatch.setattr(video_config.os.path, "expanduser", lambda p: str(tmp_path / "nohome"))
    new = _fake_browser(tmp_path, 1243, "chrome-headless-shell-linux64", "chrome-headless-shell")
    assert video_config.browser_path() == new
    old = _fake_browser(tmp_path, 1194, "chrome-linux", "headless_shell")
    assert video_config.browser_path() == new                       # the newest build wins
    import shutil
    shutil.rmtree(tmp_path / "chromium_headless_shell-1243")
    assert video_config.browser_path() == old


def test_the_browser_is_found_where_playwright_says_it_is(tmp_path, monkeypatch):
    monkeypatch.delenv("VIDEO_BROWSER_PATH", raising=False)
    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(tmp_path / "empty"))
    monkeypatch.setattr(video_config.os.path, "expanduser", lambda p: str(tmp_path / "nohome"))
    elsewhere = tmp_path / "railpack-browsers"
    new = _fake_browser(elsewhere, 1243, "chrome-headless-shell-linux64", "chrome-headless-shell")
    monkeypatch.setattr(video_config, "_playwright_root", lambda: str(elsewhere))
    assert video_config.browser_path() == new


def test_a_missing_engine_is_explained_not_a_runtimeerror(store, monkeypatch):
    pid, vid = _results_video(store)
    _plan_next(store)
    video_builder.approve(ANA, vid)

    class NoBrowser(JobBox):
        def check(self, at=None, timeout=None):
            raise video_engine.EngineMissing("No Chromium headless shell was found")
    job = store.claim_job("w")
    out = video_builder.run_job(job, client=ToolClaude([]), sandbox=NoBrowser)
    assert out["outcome"] == "failed" and out["error"] == video_builder.ENGINE_MISSING
    view = video_app.project_view(ANA, pid)["version"]
    assert view["error"].startswith("The video maker is not ready") and "RuntimeError" not in view["error"]
    log = [e for e in store.get_job(job["id"])["log"] if e["step"] == "engine_missing"]
    assert log and "headless shell" in log[0]["detail"]                 # the reason, for staff


def test_the_worker_installs_the_browser_and_reports_what_is_missing(store, monkeypatch):
    calls = []
    monkeypatch.setattr(video_engine, "ensure_installed", lambda: calls.append("hf"))

    def no_browser():
        calls.append("browser")
        raise video_engine.EngineMissing("No Chromium headless shell was found, and installing one failed")
    monkeypatch.setattr(video_engine, "ensure_browser", no_browser)
    r = video_worker.VideoRunner("w")
    assert "installing one failed" in r.prepare() and calls == ["hf", "browser"]
    r.record_engine()
    assert "installing one failed" in video_worker.engine_status()["problem"]


# ── The render on Railway (ffmpeg's "frame= 0 …" instead of a reason) ────────
# What the failed render printed, cut to its last 600 characters: ffmpeg's
# progress lines. The reason was further up, in HyperFrames' "✗" block.
RAILWAY_TAIL = (
    "Output #0, mp4:\n  Stream #0:0: Video: h264, yuv420p, 1080x1920 [SAR 1:1 DAR 9:16], q=2-31, 30 fps, 90k tbn\n"
    "      Metadata:\n        encoder         : Lavc61.19.101 libx264\n      Side data:\n        ICC Profile\n"
    "        cpb: bitrate max/min/avg: 0/0/0 buffer size: 0 vbv_delay: N/A\n"
    + "frame=    0 fps=0.0 q=0.0 size=       0KiB time=N/A bitrate=N/A speed=N/A    \r" * 4)
RAILWAY_OUTPUT = (
    "Lint: 0 error(s), 5 warning(s) — run with --lint-verbose for full output.\n"
    "Continuing render despite lint issues. Use --strict to block errors.\n"
    "[INFO] [Render] Parallel capture worker phase {\"workerId\":0,\"phase\":\"frame_capture\"}\n"
    "\x1b[31m✗\x1b[0m  \x1b[1mRender failed\x1b[0m\n\n"
    "   Worker 3: Protocol error (HeadlessExperimental.beginFrame): Target closed\n"
    "   ffmpeg stderr (tail):\n" + RAILWAY_TAIL +
    "\n   Try --docker for containerized rendering\n")


def test_a_failed_render_names_the_reason_not_ffmpegs_progress():
    reason = video_sandbox.render_reason(RAILWAY_OUTPUT)
    assert reason == "Render failed: Worker 3: Protocol error (HeadlessExperimental.beginFrame): Target closed"
    log = video_sandbox.render_log(RAILWAY_OUTPUT)
    assert "Target closed" in log and "frame=" not in log and "Lint" not in log and "docker" not in log
    assert video_sandbox.render_reason(RAILWAY_TAIL) == "it ended without a video"
    assert video_sandbox.render_reason("[Render] Chrome crashed: out of memory\n") == \
        "[Render] Chrome crashed: out of memory"


def test_the_render_is_sized_for_this_container_not_the_host(monkeypatch):
    """HyperFrames counts the host's CPUs (dozens on Railway), so the render is sized here."""
    monkeypatch.delenv("VIDEO_RENDER_WORKERS", raising=False)
    assert video_config.render_workers(cpus=48, memory_mb=4096) == 2       # capped
    assert video_config.render_workers(cpus=2, memory_mb=8192) == 1        # one CPU left for the rest
    assert video_config.render_workers(cpus=8, memory_mb=2048) == 1        # little memory: one browser
    monkeypatch.setenv("VIDEO_RENDER_WORKERS", "3")
    assert video_config.render_workers(cpus=1, memory_mb=1024) == 3        # staff can set it
    files = {"/sys/fs/cgroup/cpu.max": "200000 100000", "/sys/fs/cgroup/memory.max": str(3 * 1024 ** 3)}
    monkeypatch.setattr(video_config, "_read", lambda p: files.get(p, ""))
    assert video_config.container_cpus() == 2 and video_config.container_memory_mb() == 3072
    files["/sys/fs/cgroup/cpu.max"], files["/sys/fs/cgroup/memory.max"] = "max 100000", "max"
    assert video_config.container_cpus() >= 1 and video_config.container_memory_mb() > 0


def test_the_render_asks_for_its_workers_and_the_safe_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("VIDEO_RENDER_WORKERS", "2")
    args_file = tmp_path / "args.txt"
    hf = tmp_path / "hyperframes"
    # A stand-in HyperFrames: notes its arguments; the safe render makes a video, the other fails.
    hf.write_text("#!/bin/sh\necho \"$@\" >> %s\ncase \"$*\" in *low-memory-mode*)\n"
                  "  while [ \"$1\" != --output ]; do shift; done; printf MP4 > \"$2\"; exit 0;; esac\n"
                  "printf '\\342\\234\\227  Render failed\\n\\n   Worker 1: Target closed\\n' >&2\nexit 1\n" % args_file)
    hf.chmod(0o755)
    browser = tmp_path / "browser"
    browser.write_text("#!/bin/sh\n")
    browser.chmod(0o755)
    with video_sandbox.Sandbox(9, browser=str(browser), hyperframes=str(hf)) as box:
        with pytest.raises(video_sandbox.RenderFailed) as failed:
            box.render(5, timeout=30)
        assert failed.value.reason == "Render failed: Worker 1: Target closed"
        assert box.render(5, timeout=30, safe=True) == b"MP4"
    first, second = args_file.read_text().splitlines()
    assert "--workers 2" in first and "low-memory-mode" not in first
    assert "--workers 1 --low-memory-mode" in second


def test_a_failed_render_is_tried_again_in_safe_mode(store):
    pid, vid = _results_video(store)
    _plan_next(store)
    video_builder.approve(ANA, vid)
    _build_next(store)
    calls = []

    class FailsOnce(RenderBox):
        def render(self, seconds, quality="high", timeout=None, safe=False):
            calls.append((safe, timeout))
            if not safe:
                raise video_sandbox.RenderFailed("Render failed: Worker 3: Target closed", "Worker 3: Target closed")
            return super().render(seconds, quality, timeout)
    job = store.claim_job("w")
    out = video_render.run_job(job, sandbox=FailsOnce)
    assert out["outcome"] == "done" and [c[0] for c in calls] == [False, True]
    assert calls[1][1] <= calls[0][1]                               # within the same time limit
    steps = [e["step"] for e in store.get_job(job["id"])["log"]]
    assert steps.index("render_failed") < steps.index("render_log") < steps.index("render_retry") < steps.index("done")
    store.finish_job(job["id"], "w", "done")
    assert store.get_version(vid)["status"] == "ready"
    making = video_app.making_steps(store.jobs_for_version(vid, ANA), False, True, False)
    assert next(s for s in making if s["key"] == "render")["detail"] == "Tried a second time, more slowly"


def test_a_render_that_fails_twice_says_why_in_plain_words(store):
    pid, vid = _results_video(store)
    _plan_next(store)
    video_builder.approve(ANA, vid)
    _build_next(store)

    class AlwaysFails(RenderBox):
        def render(self, seconds, quality="high", timeout=None, safe=False):
            raise video_sandbox.RenderFailed("Render failed: Worker 3: Target closed",
                                             video_sandbox.render_log(RAILWAY_OUTPUT))
    job = store.claim_job("w")
    out = video_render.run_job(job, sandbox=AlwaysFails)
    store.finish_job(job["id"], "w", "failed", out["error"])
    assert out["outcome"] == "failed" and "even on a second, slower try" in out["error"]
    assert out["error"].endswith("What went wrong: Render failed: Worker 3: Target closed.")
    view = video_app.project_view(ANA, pid)["version"]
    assert view["error"].startswith("The video could not be rendered") and "frame=" not in view["error"]
    assert "engine page" in view["error"] and "Worker 3" not in json.dumps(view)    # the video page: no internals
    failures = video_web.engine_page(ANA)["failures"]                              # the engine page: why
    assert len(failures) == 1 and failures[0]["url"].endswith("/videos/%d?v=%d" % (pid, vid))
    assert "render_failed: Render failed: Worker 3: Target closed" in failures[0]["details"]
    assert "render_retry: safe mode" in failures[0]["details"] and "frame=" not in failures[0]["details"]
    assert video_app.retry(ANA, vid) == vid and store.claim_job("w")["kind"] == "render"


def test_no_second_try_when_the_time_is_nearly_used(store):
    vid = _results_video(store)[1]
    job = {"id": video_store.enqueue(vid, kind="render")}
    calls = []

    class Box:
        def render(self, seconds, timeout=None, safe=False):
            calls.append(safe)
            raise video_sandbox.RenderFailed("Render failed: Target closed")
    with pytest.raises(video_sandbox.RenderFailed) as failed:
        video_render._render(job, Box(), 15, video_render.MIN_RETRY_S - 30)
    assert calls == [False] and not getattr(failed.value, "retried", False)
    assert [e["step"] for e in store.get_job(job["id"])["log"]][-1] == "render_failed"


def test_the_engine_page_lists_only_failed_videos_of_people(store):
    pid, vid = _results_video(store)
    _plan_next(store)
    video_builder.approve(ANA, vid)
    _build_next(store)
    _render_next(store)
    tid = video_web.start_test(ANA, "outside_drill")[0]
    store.update_version(tid, status="failed", error="a test run")
    assert video_web.engine_page(ANA)["failures"] == []                  # engine tests are listed with the runs
    assert video_web.failure_details([{"log": [{"step": "render", "detail": "time limit 435 s"}]}]) == ""


# ── The encoder on Railway ("Streaming encoder exited before frame 102") ──────
def test_the_encoder_is_sized_for_this_container(monkeypatch):
    """libx264 counts the host's CPUs: at 128 threads it held 3.4 GB before writing a frame."""
    monkeypatch.delenv("VIDEO_ENCODER_THREADS", raising=False)
    assert video_config.encoder_threads(cpus=64) == 4
    assert video_config.encoder_threads(cpus=2) == 2
    assert video_config.encoder_threads(cpus=1) == 1
    monkeypatch.setenv("VIDEO_ENCODER_THREADS", "6")
    assert video_config.encoder_threads(cpus=64) == 6


def test_the_render_runs_ffmpeg_with_the_encoders_threads_fixed(tmp_path, monkeypatch):
    monkeypatch.setenv("VIDEO_ENCODER_THREADS", "3")
    seen = tmp_path / "args.txt"
    real = tmp_path / "ffmpeg"
    real.write_text("#!/bin/sh\nfor a in \"$@\"; do printf '%%s\\n' \"$a\"; done > %s\n" % seen)
    real.chmod(0o755)
    monkeypatch.setattr(video_engine, "ffmpeg_path", lambda: str(real))
    browser = tmp_path / "browser"
    browser.write_text("#!/bin/sh\n")
    browser.chmod(0o755)
    import subprocess
    with video_sandbox.Sandbox(9, browser=str(browser), hyperframes="/bin/true") as box:
        wrapper = box.env()["HYPERFRAMES_FFMPEG_PATH"]
        args = ["-f", "image2pipe", "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "16",
                "-x264-params", "a b:c", "-y", "out file.mp4"]
        subprocess.run([wrapper] + args, check=True)
        assert seen.read_text().splitlines() == args[:6] + ["-threads", "3"] + args[6:]
        subprocess.run([wrapper, "-version"], check=True)                    # other calls pass through
        assert seen.read_text().splitlines() == ["-version"]
        subprocess.run([wrapper], check=True)
        assert seen.read_text() == ""
    monkeypatch.setattr(video_engine, "ffmpeg_path", lambda: None)
    with video_sandbox.Sandbox(9, browser=str(browser), hyperframes="/bin/true") as box:
        assert "HYPERFRAMES_FFMPEG_PATH" not in box.env()                   # HyperFrames says it is missing
