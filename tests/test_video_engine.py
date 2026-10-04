"""Video Studio, Phase 1: the store and queue, the sandbox, the engine's
programs, the render job, the worker's render thread, the test compositions,
the staff page and the build.

On the in-memory store with fake sandboxes, except where a test needs the
real thing: the proxy trap is a real socket, and the time limit stops a real
process group. Rendering for real needs HyperFrames and a browser; that test
skips unless VIDEO_LIVE=1 (it is the check run on the worker from the
engine page).
"""

import base64
import json
import os
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest

from tracker import (video_config, video_engine, video_render, video_samples, video_sandbox, video_store,
                     video_web, video_worker)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANA = "ana@markifydigital.com"
BOB = "bob@markifydigital.com"
UTC = timezone.utc


@pytest.fixture
def store(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    video_store.reset_memory()
    from tracker import watch_store
    watch_store.reset_memory()
    yield video_store
    video_store.reset_memory()


def _version(email=ANA, duration=10.0, files=None, **kw):
    pid = video_store.create_project(email, title="t", kind="custom")
    files = files or {"index.html": {"text": "<html></html>"}}
    return video_store.create_version(pid, files=files, duration_s=duration, status="queued", **kw)


# ── The store and the queue ──────────────────────────────────────────────────
def test_versions_are_numbered_and_scoped_to_their_owner(store):
    pid = store.create_project(ANA.upper(), title="Launch", brief="A launch video", kind="launch",
                               choices={"shape": "vertical"})
    v1 = store.create_version(pid, plan={"idea": "x"})
    v2 = store.create_version(pid, change_request="slower")
    assert [v["number"] for v in store.list_versions(pid, ANA)] == [2, 1]
    assert store.get_project(pid, ANA)["choices"] == {"shape": "vertical"}
    assert store.get_project(pid, BOB) is None
    assert store.get_version(v1, BOB) is None and store.list_versions(pid, BOB) == []
    assert store.get_version(v2, ANA)["change_request"] == "slower"
    assert "files" not in store.get_version(v1, ANA) and "mp4" not in store.get_version(v1, ANA)
    store.update_version(v1, mp4=b"MP4", cover=b"JPG", mp4_bytes=3)
    assert store.get_media(v1, "mp4", ANA) == b"MP4" and store.get_media(v1, "cover", ANA) == b"JPG"
    assert store.get_media(v1, "mp4", BOB) is None
    assert store.get_version(v1, ANA)["has_cover"] is True
    with pytest.raises(ValueError):
        store.create_project(ANA, colour="red")
    with pytest.raises(ValueError):
        store.get_media(v1, "files")


def test_a_job_is_claimed_once_renewed_and_finished(store):
    vid = _version()
    jid = store.enqueue(vid)
    job = store.claim_job("w1")
    assert job["id"] == jid and job["attempts"] == 1 and job["status"] == "running"
    assert store.claim_job("w2") is None                      # held
    assert store.renew_job(jid, "w1") and not store.renew_job(jid, "w2")
    assert store.queue_stats()["running"] == 1
    assert store.finish_job(jid, "w2", "done") is False
    assert store.finish_job(jid, "w1", "done") is True
    assert store.get_job(jid)["status"] == "done"
    assert store.claim_job("w1") is None
    assert store.get_job(jid, BOB) is None and store.get_job(jid, ANA)["id"] == jid


def test_a_job_whose_worker_died_runs_again_then_fails(store):
    vid = _version()
    jid = store.enqueue(vid)
    now = datetime.now(UTC)
    assert store.claim_job("w1", now=now, lease_s=60)["attempts"] == 1
    assert store.queue_stats(now=now + timedelta(seconds=61))["stalled"] == 1
    again = store.claim_job("w2", now=now + timedelta(seconds=61), lease_s=60)
    assert again["id"] == jid and again["attempts"] == 2
    # The second worker dies too: the third claim fails the job instead.
    assert store.claim_job("w3", now=now + timedelta(seconds=200), lease_s=60) is None
    job = store.get_job(jid)
    assert job["status"] == "failed" and "interrupted 2 times" in job["error"]
    assert store.get_version(vid)["status"] == "failed"


def test_a_job_handed_back_on_a_deploy_keeps_its_attempts(store):
    vid = _version()
    jid = store.enqueue(vid)
    store.claim_job("w1")
    assert store.hand_back(jid, "w2") is False
    assert store.hand_back(jid, "w1") is True
    job = store.get_job(jid)
    assert job["status"] == "queued" and job["attempts"] == 0
    assert store.claim_job("w2")["attempts"] == 1


def test_jobs_are_taken_oldest_first_and_the_log_is_capped(store):
    a, b = _version(), _version()
    ja, jb = store.enqueue(a), store.enqueue(b)
    assert store.claim_job("w")["id"] == ja
    for i in range(video_store.MAX_LOG + 5):
        store.add_log(ja, "step", "line %d" % i)
    log = store.get_job(ja)["log"]
    assert len(log) == video_store.MAX_LOG and log[-1]["detail"] == "line %d" % (video_store.MAX_LOG + 4)
    assert store.claim_job("w")["id"] == jb
    with pytest.raises(ValueError):
        store.enqueue(a, kind="publish")


# ── The sandbox ──────────────────────────────────────────────────────────────
@pytest.mark.parametrize("bad", ["/etc/passwd", "../x.html", "a/../../x.html", "kit/gsap.min.js", ".env.js",
                                 "a\\b.html", "C:/x.html", "run.sh", "x.py", "", "a//b.html", "img/.x.png"])
def test_unsafe_file_paths_are_refused(bad):
    with pytest.raises(video_sandbox.BadFile):
        video_sandbox.check_path(bad)


def test_safe_paths_and_stored_files_decode():
    assert video_sandbox.check_path("media/photo.JPG") == "media/photo.JPG"
    files = video_sandbox.decode_files({"index.html": {"text": "<p>é</p>"},
                                        "media/a.png": {"b64": base64.b64encode(b"\x89PNG").decode()}})
    assert files == {"index.html": "<p>é</p>".encode(), "media/a.png": b"\x89PNG"}
    for bad in ({}, {"a.html": {"text": ""}}, {"index.html": {}}, {"index.html": {"b64": "!!not base64"}},
                {"index.html": {"text": "x" * (video_config.MAX_FILE_BYTES + 1)}}):
        with pytest.raises(video_sandbox.BadFile):
            video_sandbox.decode_files(bad)
    many = {"index.html": {"text": ""}}
    many.update({"f%d.css" % i: {"text": ""} for i in range(video_config.MAX_FILES)})
    with pytest.raises(video_sandbox.BadFile):
        video_sandbox.decode_files(many)


def test_outside_addresses_are_found_but_svg_namespaces_are_not():
    files = {"index.html": b'<svg xmlns="http://www.w3.org/2000/svg"></svg><img src="https://cdn.example.net/a.png">'
                           b'<script>fetch("//api.example.org/x")</script>',
             "style.css": b'@import url("https://fonts.googleapis.com/css2?family=Inter");',
             "media/a.png": b"https://not-text.example.com"}
    assert video_sandbox.outside_addresses(files) == ["api.example.org", "cdn.example.net", "fonts.googleapis.com"]


def test_the_proxy_trap_refuses_and_records_every_request():
    trap = video_sandbox.ProxyTrap()
    try:
        for line in (b"CONNECT images.example.com:443 HTTP/1.1\r\nHost: images.example.com:443\r\n\r\n",
                     b"GET http://api.example.org/beacon HTTP/1.1\r\nHost: api.example.org\r\n\r\n"):
            s = socket.create_connection(("127.0.0.1", trap.port), timeout=3)
            s.sendall(line)
            assert s.recv(100).startswith(b"HTTP/1.1 403")
            s.close()
        deadline = time.monotonic() + 3
        while len(trap.blocked) < 2 and time.monotonic() < deadline:
            time.sleep(0.02)
        assert trap.blocked == ["images.example.com", "api.example.org"]
    finally:
        trap.close()


def test_the_sandbox_hides_secrets_points_the_browser_at_the_trap_and_cleans_up(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-secret")
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setenv("VIDEO_WORK_DIR", str(tmp_path))
    fake_browser = tmp_path / "headless_shell"
    fake_browser.write_text("")
    with video_sandbox.Sandbox(7, browser=str(fake_browser), hyperframes="/bin/true") as box:
        assert os.path.exists(os.path.join(box.project, "kit", "gsap.min.js"))
        assert os.path.exists(os.path.join(box.project, "kit", "fonts.json"))
        assert len(os.listdir(os.path.join(box.project, "kit", "fonts"))) >= 40
        box.write({"index.html": b"<html></html>", "media/a.png": b"x"})
        assert open(os.path.join(box.project, "media", "a.png"), "rb").read() == b"x"
        env = box.env()
        assert "ANTHROPIC_API_KEY" not in env and "SLACK_BOT_TOKEN" not in env and "DATABASE_URL" not in env
        script = open(env["HYPERFRAMES_BROWSER_PATH"]).read()
        assert "--proxy-server=http://127.0.0.1:%d" % box.trap.port in script and str(fake_browser) in script
        assert env["HYPERFRAMES_NO_TELEMETRY"] == "1"
        with pytest.raises(video_sandbox.BadFile):
            box.write({"../escape.html": b"x"})
        root = box.root
    assert not os.path.exists(root)


def test_the_check_report_is_read_from_the_programs_output():
    out = "progress lines\n{bad json\n" + json.dumps({
        "ok": False,
        "lint": {"findings": [{"code": "placeholder_media_url", "severity": "error", "message": "img 404",
                               "selector": "img", "time": 0, "fixHint": "use a real file"}]},
        "layout": {"findings": [{"code": "text_occluded", "severity": "warning", "message": "hidden", "time": 4.5}]},
        "contrast": {"findings": []}}) + "\ntrailing"
    r = video_sandbox.parse_check(out)
    assert r["ok"] is False and r["errors"][0]["code"] == "placeholder_media_url"
    assert r["warnings"][0]["time"] == 4.5
    assert video_sandbox.parse_check("no json here") is None
    assert video_sandbox.parse_check(json.dumps({"ok": True}))  is None             # a progress line, not the report
    assert video_sandbox.parse_check(json.dumps({"ok": True, "lint": {}}))["ok"] is True


# ── The engine's programs ────────────────────────────────────────────────────
def test_a_program_past_its_limit_is_stopped_with_everything_it_started(tmp_path):
    marker = tmp_path / "child.pid"
    script = "sleep 30 & echo $! > %s; wait" % marker
    t = time.monotonic()
    with pytest.raises(video_engine.TimedOut):
        video_engine.run(["sh", "-c", script], timeout=1)
    assert time.monotonic() - t < 15
    child = int(marker.read_text().strip())
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        try:
            os.kill(child, 0)
        except ProcessLookupError:
            break
        time.sleep(0.1)
    else:
        pytest.fail("the child process outlived its time limit")


def test_a_program_is_stopped_when_the_worker_stops():
    stop = threading.Event()
    threading.Timer(0.5, stop.set).start()
    with pytest.raises(video_engine.Stopped):
        video_engine.run(["sleep", "30"], timeout=60, stop=stop)


def test_a_program_returns_its_code_and_output():
    code, out = video_engine.run([sys.executable, "-c", "print('hello'); raise SystemExit(3)"], timeout=30)
    assert code == 3 and "hello" in out


def test_without_node_the_engine_says_so(monkeypatch, tmp_path):
    monkeypatch.setenv("VIDEO_ENGINE_DIR", str(tmp_path / "engine"))
    monkeypatch.setattr(video_engine.shutil, "which", lambda name: None)
    with pytest.raises(RuntimeError, match="Node"):
        video_engine.ensure_installed()
    st = video_engine.status()
    assert st["node"] is False and st["hyperframes"] is None and st["pinned"] == video_config.HYPERFRAMES_VERSION


def test_render_time_limits_grow_with_the_length():
    assert video_config.render_timeout(10) < video_config.render_timeout(60)
    assert video_config.render_timeout(60) <= 1200


# ── One render job ───────────────────────────────────────────────────────────
class FakeBox:
    """Stands in for video_sandbox.Sandbox; records what the job asked of it."""
    instances = []

    def __init__(self, job_id, *, stop=None, check=None, render=None, blocked=()):
        self.job_id, self.stop = job_id, stop
        self._check = check or {"ok": True, "errors": [], "warnings": []}
        self._render = render
        self.blocked = list(blocked)
        self.written, self.calls = {}, []
        FakeBox.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def write(self, files):
        self.written.update(files)

    def check(self):
        self.calls.append("check")
        return self._check

    def render(self, seconds, timeout=None):
        self.calls.append(("render", timeout))
        if isinstance(self._render, Exception):
            raise self._render
        return b"MP4DATA"

    def cover(self, mp4, at):
        self.calls.append(("cover", at))
        return b"JPEG"


def box_factory(**kw):
    FakeBox.instances = []
    return lambda job_id, stop=None: FakeBox(job_id, stop=stop, **kw)


def _job(vid, settings=None):
    jid = video_store.enqueue(vid, settings=settings or {})
    return video_store.claim_job("w1")


def test_a_render_job_stores_the_video_its_cover_and_its_timings(store):
    s = video_samples.title_image_end()
    vid = _version(files=s["files"], duration=s["duration_s"], cover_at=s["cover_at"])
    job = _job(vid)
    result = video_render.run_job(job, sandbox=box_factory(blocked=["cdn.example.net"]))
    assert result == {"outcome": "done", "error": ""}
    box = FakeBox.instances[0]
    assert set(box.written) == {"index.html", "media/hills.jpg"}
    assert box.calls[0] == "check" and box.calls[1] == ("render", video_config.render_timeout(10))
    assert box.calls[2] == ("cover", s["cover_at"])
    v = store.get_version(vid)
    assert v["status"] == "ready" and v["mp4_bytes"] == 7 and set(v["timings"]) == {"check_s", "render_s", "cover_s"}
    assert store.get_media(vid, "mp4") == b"MP4DATA" and store.get_media(vid, "cover") == b"JPEG"
    steps = [e["step"] for e in store.get_job(job["id"])["log"]]
    assert steps == ["start", "check", "render", "cover", "blocked", "done"]


def test_a_composition_that_fails_its_check_is_never_rendered(store):
    vid = _version()
    job = _job(vid)
    report = {"ok": False, "warnings": [], "errors": [
        {"area": "layout", "code": "text_overflow", "message": "The title runs off the frame", "time": 2.5}]}
    result = video_render.run_job(job, sandbox=box_factory(check=report))
    assert result["outcome"] == "failed" and "text_overflow at 2.5s: The title runs off the frame" in result["error"]
    assert FakeBox.instances[0].calls == ["check"]
    assert store.get_version(vid)["status"] == "failed"


def test_a_render_past_its_limit_fails_with_the_reason(store):
    vid = _version()
    job = _job(vid, {"skip_check": True, "render_timeout_s": 60})
    result = video_render.run_job(job, sandbox=box_factory(render=video_engine.TimedOut("stopped after 60s")))
    assert result["outcome"] == "failed" and "time limit" in result["error"]
    assert FakeBox.instances[0].calls == [("render", 60)]


def test_outside_addresses_in_the_files_are_logged(store):
    s = video_samples.outside_drill()
    vid = _version(files=s["files"])
    job = _job(vid)
    video_render.run_job(job, sandbox=box_factory(blocked=list(video_samples.OUTSIDE_HOSTS)))
    log = {e["step"]: e for e in store.get_job(job["id"])["log"]}
    for host in video_samples.OUTSIDE_HOSTS:
        assert host in log["outside"]["detail"] and host in log["blocked"]["detail"]
    assert store.get_version(vid)["status"] == "ready"


def test_a_stopping_worker_puts_the_version_back_in_the_queue(store):
    vid = _version()
    job = _job(vid)
    with pytest.raises(video_engine.Stopped):
        video_render.run_job(job, sandbox=box_factory(render=video_engine.Stopped("bye")))
    assert store.get_version(vid)["status"] == "queued"


def test_bad_files_and_bad_lengths_fail_cleanly(store):
    job = _job(_version(files={"index.html": {"text": "x"}, "../x.css": {"text": ""}}))
    assert "cannot be used" in video_render.run_job(job, sandbox=box_factory())["error"]
    job = _job(_version(duration=0))
    assert "length" in video_render.run_job(job, sandbox=box_factory())["error"]


# ── The worker's render thread ───────────────────────────────────────────────
def test_the_runner_finishes_jobs_and_records_the_engine(store, monkeypatch):
    monkeypatch.setattr(video_engine, "status", lambda: {"node": True, "hyperframes": "x"})
    vid = _version()
    jid = video_store.enqueue(vid)
    seen = []
    r = video_worker.VideoRunner("w1", run=lambda job, stop: seen.append(job["id"]) or {"outcome": "done"})
    assert r.process_one() is True and seen == [jid]
    assert video_store.get_job(jid)["status"] == "done"
    assert r.process_one() is False
    assert video_worker.engine_status()["worker"] == "w1"


def test_the_runner_hands_back_a_stopped_job_and_fails_a_crashed_one(store, monkeypatch):
    monkeypatch.setattr(video_engine, "status", lambda: {})

    def stopped(job, stop):
        raise video_engine.Stopped("deploy")
    a = video_store.enqueue(_version())
    video_worker.VideoRunner("w1", run=stopped).process_one()
    assert video_store.get_job(a)["status"] == "queued"

    def crash(job, stop):
        raise KeyError("boom")
    video_worker.VideoRunner("w1", run=crash).process_one()
    job = video_store.get_job(a)
    assert job["status"] == "failed" and "stopped with an error (KeyError)" in job["error"]
    assert video_store.get_version(job["version_id"])["status"] == "failed"


def test_the_runner_keeps_its_lease_while_a_long_render_runs(store, monkeypatch):
    monkeypatch.setattr(video_engine, "status", lambda: {})
    jid = video_store.enqueue(_version())
    leases = []

    def slow(job, stop):
        for _ in range(4):
            time.sleep(0.25)
            leases.append(video_store.get_job(jid)["lease_until"])
        return {"outcome": "done"}
    video_worker.VideoRunner("w1", run=slow, lease_s=0.3).process_one()
    assert len(set(leases)) > 1 and video_store.get_job(jid)["status"] == "done"


def test_the_page_watch_worker_starts_one_renderer_unless_switched_off(store, monkeypatch):
    from tracker import watch_worker
    started = []

    class Fake:
        def __init__(self, owner, stopping=None):
            self.owner = owner

        def start(self):
            started.append(self.owner)

        def join(self, timeout):
            pass
    monkeypatch.setattr(video_worker, "VideoRunner", Fake)
    monkeypatch.setattr(watch_worker, "_browser_ok", lambda: False)
    monkeypatch.setenv("VIDEO_STUDIO", "on")
    w = watch_worker.Worker(1, run=lambda tid: {"outcome": "same"}, worker_id="w1", grace_s=0.1, poll_s=0.05)
    w.start()
    w.stop()
    assert started == ["w1"]
    monkeypatch.setenv("VIDEO_STUDIO", "off")
    w = watch_worker.Worker(1, run=lambda tid: {"outcome": "same"}, worker_id="w2", grace_s=0.1, poll_s=0.05)
    w.start()
    w.stop()
    assert started == ["w1"] and w.video is None


# ── The test compositions ────────────────────────────────────────────────────
@pytest.mark.parametrize("name", list(video_samples.SAMPLES) + list(video_samples.DRILLS))
def test_each_test_composition_is_complete_and_loads_only_its_own_files(name):
    s = (video_samples.SAMPLES.get(name) or video_samples.DRILLS[name])()
    files = video_sandbox.decode_files(s["files"])
    html = files["index.html"].decode()
    w, h = video_config.SHAPES[s["shape"]]
    assert 'data-width="%d" data-height="%d"' % (w, h) in html
    assert 'data-duration="%s"' % video_samples._num(s["duration_s"]) in html
    assert 'src="kit/gsap.min.js"' in html and 'window.__timelines["main"] = tl' in html
    assert 0 <= s["cover_at"] < s["duration_s"]
    expected = sorted(video_samples.OUTSIDE_HOSTS) if name == "outside_drill" else []
    assert video_sandbox.outside_addresses(files) == expected
    import re
    refs = re.findall(r'url\("kit/(fonts/[^"]+)"\)', html)
    assert refs and all(os.path.exists(os.path.join(video_config.kit_dir(), r)) for r in refs)
    assert 'font-family: "Fraunces"' in html and 'font-family: "DM Sans"' in html


def test_the_two_test_videos_match_the_plan():
    a, b = video_samples.title_image_end(), video_samples.chart_vertical()
    assert (a["shape"], a["duration_s"]) == ("landscape", 10.0)
    assert (b["shape"], b["duration_s"]) == ("vertical", 45.0)
    assert 'class="chart"' in b["files"]["index.html"]["text"]
    assert video_samples.DRILL_SETTINGS["hang_drill"]["render_timeout_s"] == 60


@pytest.mark.skipif(os.environ.get("VIDEO_LIVE") != "1", reason="renders for real; set VIDEO_LIVE=1")
def test_live_the_short_test_video_renders(store):
    s = video_samples.title_image_end()
    vid = _version(files=s["files"], duration=s["duration_s"], cover_at=s["cover_at"])
    job = _job(vid)
    assert video_render.run_job(job)["outcome"] == "done"
    assert video_store.get_media(vid, "mp4")[4:8] == b"ftyp"


# ── The staff page ───────────────────────────────────────────────────────────
@pytest.fixture
def client(store, monkeypatch):
    import app as appmod
    who = {"email": ANA, "name": "Ana"}
    monkeypatch.setattr(appmod, "_get_user", lambda: who)
    c = appmod.app.test_client()
    c.who = who
    return c


BASE = "/strategic-agents/video-studio"


def test_the_engine_page_queues_tests_and_serves_only_ones_own_videos(client, store):
    r = client.get(BASE + "/engine")
    assert r.status_code == 200 and b'id="ve-data"' in r.data and b"video-engine.js" in r.data
    r = client.post(BASE + "/api/engine-tests", data=json.dumps({"test": "samples"}), content_type="application/json")
    page = r.get_json()["page"]
    assert r.status_code == 200 and len(page["runs"]) == 2 and page["busy"] and page["queue"]["queued"] == 2
    assert {x["test"] for x in page["runs"]} == {"title_image_end", "chart_vertical"}
    assert client.post(BASE + "/api/engine-tests", data="test=samples").status_code == 400
    assert client.post(BASE + "/api/engine-tests", data=json.dumps({"test": "nope"}),
                       content_type="application/json").status_code == 400
    vid = page["runs"][0]["id"]
    assert client.get(BASE + "/media/%d.mp4" % vid).status_code == 404        # not rendered yet
    video_store.update_version(vid, mp4=b"\x00\x00\x00\x18ftypmp42", cover=b"\xff\xd8", status="ready")
    r = client.get(BASE + "/media/%d.mp4?download=1" % vid)
    assert r.status_code == 200 and r.headers["Content-Type"] == "video/mp4" and "attachment" in r.headers["Content-Disposition"]
    assert client.get(BASE + "/media/%d.jpg" % vid).headers["Content-Type"] == "image/jpeg"
    assert client.get(BASE + "/media/%d.exe" % vid).status_code == 404
    client.who["email"] = BOB
    assert client.get(BASE + "/media/%d.mp4" % vid).status_code == 404
    assert client.get(BASE + "/api/engine-tests").get_json()["page"]["runs"] == []


def test_the_engine_page_is_for_staff_only(store, monkeypatch):
    import app as appmod
    c = appmod.app.test_client()
    assert c.get(BASE + "/engine").status_code == 302
    monkeypatch.setattr(appmod, "_get_user", lambda: {"email": "someone@gmail.com"})
    assert c.get(BASE + "/engine").status_code == 302
    assert c.post(BASE + "/api/engine-tests", data=json.dumps({"test": "samples"}),
                  content_type="application/json").status_code == 302
    assert video_store.queue_stats()["queued"] == 0


def test_the_engine_page_shows_what_the_worker_reported(client, store):
    from tracker import watch_store
    watch_store.set_meta(video_worker.ENGINE_META, {"node": True, "ffmpeg": True, "browser": True,
                                                    "hyperframes": video_config.HYPERFRAMES_VERSION,
                                                    "switched_on": True, "at": datetime.now(UTC).isoformat()})
    data = video_web.engine_page(ANA)
    assert data["engine"]["hyperframes"] == video_config.HYPERFRAMES_VERSION and data["runs"] == []


# ── The build ────────────────────────────────────────────────────────────────
def test_the_build_adds_node_22_and_keeps_ffmpeg():
    cfg = json.load(open(os.path.join(ROOT, "railpack.json")))
    assert cfg["packages"]["node"] == "22"
    assert cfg["deploy"]["aptPackages"] == ["...", "ffmpeg"]


def test_the_kit_holds_gsap_and_the_fonts_with_their_licences():
    kit = video_config.kit_dir()
    assert open(os.path.join(kit, "gsap.min.js")).read(200).find("GSAP 3.") != -1
    manifest = json.load(open(os.path.join(kit, "fonts.json")))
    assert len(manifest["families"]) == 21 and manifest["licence"] == "SIL Open Font License 1.1"
    for fam in manifest["families"]:
        for face in fam["faces"]:
            assert open(os.path.join(kit, face["file"]), "rb").read(4) == b"wOF2"
    text = open(os.path.join(kit, "LICENSES.md")).read()
    assert "Open Font License" in text and "No Charge" in text


def test_the_browser_is_found_where_playwright_puts_it(monkeypatch, tmp_path):
    monkeypatch.delenv("VIDEO_BROWSER_PATH", raising=False)
    shell = tmp_path / "chromium_headless_shell-1194" / "chrome-linux" / "headless_shell"
    shell.parent.mkdir(parents=True)
    shell.write_text("")
    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(tmp_path))
    assert video_config.browser_path() == str(shell)
    monkeypatch.setenv("VIDEO_BROWSER_PATH", str(tmp_path / "missing"))
    assert video_config.browser_path() is None


def test_a_large_report_goes_to_a_file_whole(tmp_path):
    """hyperframes check prints a report far larger than the output kept in
    memory; read from the kept tail it was cut off and misread."""
    big = json.dumps({"ok": False, "lint": {"findings": [{"severity": "warning", "code": "w", "message": "x" * 200}] * 3000},
                      "layout": {"findings": [{"severity": "error", "code": "text_overflow", "message": "cut off"}]}})
    src = tmp_path / "big.json"
    src.write_text(big)
    out = tmp_path / "report.json"
    code, err = video_engine.run([sys.executable, "-c", "import sys; sys.stderr.write('progress'); "
                                  "sys.stdout.write(open(%r).read())" % str(src)], timeout=30, stdout_path=str(out))
    assert code == 0 and err == "progress" and len(big) > 256 * 1024
    report = video_sandbox.parse_check(out.read_text())
    assert report["ok"] is False and report["errors"][0]["code"] == "text_overflow"
    assert video_sandbox.parse_check(big[-200000:]) is None          # what the old tail-only reading saw
