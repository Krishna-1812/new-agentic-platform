"""Video Studio, Phase 3: the scene library, the build, Claude's review loop,
"Make changes" and "Make another shape".

The library is checked here without the engine (every template, every shape,
short and long words, light and dark brands: complete, self-contained,
scoped). The same matrix passes the real `hyperframes check` with
scripts/check_video_scenes.py, which needs Node; VIDEO_LIVE=1 runs it here.
Claude is a scripted stand-in that calls the real tools.
"""

import io
import json
import os
import re
import subprocess
import sys
from types import SimpleNamespace

import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from video_fakes import FakeClaude, scene  # noqa: E402

from tracker import (video_agent, video_brand, video_build, video_builder, video_config, video_plan,  # noqa: E402
                     video_planner, video_samples, video_sandbox, video_scenes, video_store, video_web, video_worker,
                     watch_safety)

ANA = "ana@markifydigital.com"
BOB = "bob@markifydigital.com"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture
def store(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")
    monkeypatch.setattr(watch_safety, "check", lambda url: None)
    video_store.reset_memory()
    from tracker import watch_store
    watch_store.reset_memory()
    yield video_store
    video_store.reset_memory()


def _brand(which="light"):
    b = video_brand.resolve(video_samples.LIGHT_BRAND if which == "light" else video_samples.DARK_BRAND)
    b["logo_asset"] = 20
    return b


# ── The scene library ────────────────────────────────────────────────────────
def test_the_library_has_all_sixteen_templates():
    assert len(video_scenes.TEMPLATES) == 16 and set(video_scenes.TEMPLATES) <= set(video_scenes.RENDER)
    assert set(video_scenes.TEMPLATES) == set(video_plan.SCENES) - {"custom"}
    assert {s["type"] for s in video_samples.library_plan()["scenes"]} == set(video_scenes.TEMPLATES)


@pytest.mark.parametrize("shape", list(video_config.SHAPES))
@pytest.mark.parametrize("brand", ["light", "dark"])
@pytest.mark.parametrize("length", ["short", "long"])
def test_every_template_builds_in_every_shape(shape, brand, length):
    plan = video_samples.library_plan(length)
    out = video_build.compose(plan, _brand(brand), shape, assets=video_samples.library_assets(),
                              tables=video_samples.library_tables())
    html = out["files"]["index.html"].decode()
    W, H = video_config.SHAPES[shape]
    assert 'data-width="%d" data-height="%d"' % (W, H) in html
    assert html.count('<section id="s') == len(plan["scenes"])
    assert out["duration"] == sum(s["seconds"] for s in plan["scenes"])
    starts = [float(x) for x in re.findall(r'<section id="s\d+" class="clip scene \w+" data-start="([\d.]+)"', html)]
    assert starts == sorted(starts) and starts[0] == 0
    assert video_sandbox.outside_addresses({p: d for p, d in out["files"].items()}) == []
    for path in re.findall(r'src="([^"]+)"', html):
        assert path.startswith("kit/") or path in out["files"], path
    for s in plan["scenes"]:
        for w in (s["headline"] or "").split():
            assert video_scenes.esc(w) in html
    assert 'window.__timelines["main"] = tl' in html and "Math.random" not in html and "setTimeout" not in html
    video_sandbox.decode_files(video_build.stored(out["files"]))          # all paths and sizes allowed


def test_words_are_escaped_never_run():
    plan = {"scenes": [scene("title", 3, '<script>alert(1)</script> & "quotes"'), scene("words", 3, "x"),
                       scene("end_card", 3, "y", subline="<img src=x onerror=alert(1)>")], "cover_scene": 0}
    html = video_build.compose(plan, _brand(), "landscape", assets={}, tables={})["files"]["index.html"].decode()
    assert "<script>alert" not in html and "&lt;script&gt;" in html and "<img src=x" not in html


def test_fit_shrinks_long_words_to_the_box_and_keeps_short_ones_big():
    short = video_scenes.fit("Start free", 1500, 2, 140, 40)
    long = video_scenes.fit("Close your books in five days, not twelve, every single month of the year", 1500, 2, 140, 40)
    assert short == 140 and 40 <= long < short
    word = video_scenes.fit("Supercalifragilisticexpialidocious", 600, 3, 140, 20)
    assert word * 0.54 * 34 <= 600 + 1


def test_charts_draw_from_the_numbers_and_say_so_when_there_are_none():
    tables = video_samples.library_tables()
    for kind in ("bar", "line", "donut"):
        plan = {"scenes": [scene("chart", 4, "Leads", chart={"asset_id": 30, "label_column": "Month",
                                                             "value_column": "Leads", "kind": kind})] * 3}
        html = video_build.compose(plan, _brand(), "square", assets={}, tables=tables)["files"]["index.html"].decode()
        assert re.search(r">(Jun · )?290<", html) and re.search(r">Jan( · 120)?<", html), kind
    plan = {"scenes": [scene("chart", 4, "Leads", chart={"asset_id": 99, "label_column": "a", "value_column": "b",
                                                         "kind": "bar"})] * 3}
    html = video_build.compose(plan, _brand(), "square", assets={}, tables=tables)["files"]["index.html"].decode()
    assert "No numbers to draw" in html


def test_a_big_number_counts_up_in_its_own_format():
    for number, grouping in (("₹1,20,000", "indian"), ("$5,500", "intl"), ("42.5%", "none")):
        plan = {"scenes": [scene("big_number", 3, number=number)] * 3}
        html = video_build.compose(plan, _brand(), "vertical", assets={}, tables={})["files"]["index.html"].decode()
        assert 'countUp("#s1 .num"' in html and '"%s"' % grouping in html


def test_the_cover_is_the_chosen_scene_once_settled():
    plan = {"scenes": [scene("title", 2, "a"), scene("words", 4, "b"), scene("end_card", 4, "c")], "cover_scene": 1}
    out = video_build.compose(plan, _brand(), "landscape", assets={}, tables={})
    assert out["cover_at"] == 5.0 and out["scenes"] == [(0, 2), (2, 6), (6, 10)]


def test_readable_muted_text_on_both_themes():
    from tracker.video_site import contrast
    for which in ("light", "dark"):
        b = _brand(which)
        css = video_build.theme_css(b)
        muted = re.findall(r"--muted: (#[0-9a-f]{6})", css)
        bgc = re.findall(r"--bgc: (#[0-9a-f]{6})", css)
        assert contrast(muted[0], bgc[0]) >= 4.5 and contrast(muted[1], bgc[1]) >= 4.5


@pytest.mark.skipif(os.environ.get("VIDEO_LIVE") != "1", reason="runs hyperframes check; set VIDEO_LIVE=1")
def test_live_the_library_passes_hyperframes_check():
    out = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "check_video_scenes.py")],
                         capture_output=True, text=True, timeout=3600)
    assert out.returncode == 0, out.stdout + out.stderr


# ── Claude's review loop ─────────────────────────────────────────────────────
class LoopBox:
    """A sandbox stand-in with a real project folder and scripted check reports."""

    def __init__(self, tmp_path, reports):
        self.root = str(tmp_path)
        self.project = os.path.join(self.root, "project")
        os.makedirs(os.path.join(self.project, "kit"), exist_ok=True)
        open(os.path.join(self.project, "kit", "gsap.min.js"), "w").write("// kit")
        self.reports = list(reports)
        self.checks = self.snaps = 0

    def write(self, files):
        for p, d in files.items():
            dest = os.path.join(self.project, *video_sandbox.check_path(p).split("/"))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            open(dest, "wb").write(d if isinstance(d, bytes) else d.encode())

    def check(self, at=None, timeout=None):
        self.checks += 1
        return self.reports.pop(0) if len(self.reports) > 1 else self.reports[0]

    def snapshot(self, times, timeout=None):
        self.snaps += 1
        buf = io.BytesIO()
        Image.new("RGB", (64, 36), (20, 20, 20)).save(buf, "PNG")
        return [buf.getvalue() for _ in times]


OK = {"ok": True, "errors": [], "warnings": []}
BAD = {"ok": False, "warnings": [], "errors": [{"area": "layout", "code": "text_overflow", "message": "The title runs off",
                                                "selector": "#s1 .head", "time": 1.0, "fix": "shrink it"}]}


class ToolClaude:
    """Answers each turn with the next scripted list of tool calls."""

    def __init__(self, turns):
        self.turns = list(turns)
        self.calls = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **kw):
        self.calls.append(kw)
        uses = self.turns.pop(0) if self.turns else [("done", {"summary": "ok"})]
        content = [SimpleNamespace(type="text", text="Looking.")]
        for i, (name, args) in enumerate(uses):
            content.append(SimpleNamespace(type="tool_use", id="tu_%d_%d" % (len(self.calls), i), name=name, input=args))
        usage = SimpleNamespace(input_tokens=8000, output_tokens=600, cache_read_input_tokens=0,
                                cache_creation_input_tokens=0)
        return SimpleNamespace(content=content, usage=usage, stop_reason="tool_use", model=kw["model"])


PLAN3 = {"scenes": [scene("title", 3, "Hello there"), scene("custom", 3, "A map", subline=""),
                    scene("end_card", 3, "Start free")], "cover_scene": 0}


def test_the_review_reads_fixes_checks_and_finishes(store, tmp_path):
    box = LoopBox(tmp_path, [BAD, OK, OK])
    fixed = "<html><body>fixed</body></html>"
    claude = ToolClaude([[("read_file", {"path": "index.html"})],
                         [("write_file", {"path": "index.html", "content": fixed}), ("check", {})],
                         [("done", {"summary": "Made the title fit."})]])
    steps = []
    out = video_agent.build(PLAN3, _brand(), "landscape", assets={}, tables={}, box=box, client=claude,
                            record={"email": ANA}, step=lambda *a: steps.append(a[0]))
    assert out["review"]["ended"] == "done" and out["review"]["summary"] == "Made the title fit."
    assert out["files"]["index.html"] == fixed.encode() and "kit/gsap.min.js" not in out["files"]
    assert box.checks == 3 and box.snaps == 1                         # first, Claude's, the program's last
    first = claude.calls[0]
    assert [t["name"] for t in first["tools"]] == ["read_file", "write_file", "check", "snapshot", "done"]
    sent = first["messages"][0]["content"]
    assert "text_overflow (scene 1, title)" in sent[0]["text"] and sum(b["type"] == "image" for b in sent) == 3
    read_back = claude.calls[1]["messages"][2]["content"][0]
    assert read_back["type"] == "tool_result" and "<section" in read_back["content"][0]["text"]
    assert steps[:3] == ["build_compose", "build_check", "build_look"] and "build_write" in steps
    assert video_store.ai_spend(video_plan.month_start())["calls"] == 3


@pytest.mark.parametrize("call,phrase", [
    (("write_file", {"path": "kit/gsap.min.js", "content": "x"}), "reserved"),
    (("write_file", {"path": "../escape.html", "content": "x"}), "Refused"),
    (("write_file", {"path": "media/a1.png", "content": "x"}), "only .html"),
    (("write_file", {"path": "index.html", "content": '<img src="https://evil.example/x.png">'}), "outside addresses"),
    (("read_file", {"path": "/etc/passwd"}), "Refused"),
    (("read_file", {"path": "media/a1.png"}), "only .html"),
    (("teleport", {}), "Unknown tool"),
])
def test_the_tools_refuse_anything_outside_the_composition(store, tmp_path, call, phrase):
    box = LoopBox(tmp_path, [OK])
    claude = ToolClaude([[call], [("done", {"summary": "ok"})]])
    video_agent.build(PLAN3, _brand(), "landscape", assets={}, tables={}, box=box, client=claude)
    result = claude.calls[1]["messages"][2]["content"][0]
    assert result.get("is_error") and phrase in result["content"][0]["text"]
    assert not os.path.exists(os.path.join(str(tmp_path), "escape.html"))


def test_the_loop_stops_at_its_limits(store, tmp_path, monkeypatch):
    box = LoopBox(tmp_path, [BAD])
    claude = ToolClaude([[("check", {})]] * 10)
    with pytest.raises(video_agent.BuildError, match="text_overflow"):
        video_agent.build(PLAN3, _brand(), "landscape", assets={}, tables={}, box=box, client=claude)
    texts = [m["content"][0]["content"][0]["text"] for m in claude.calls[-1]["messages"][2::2]]
    assert any("No fix rounds are left" in t for t in texts)
    monkeypatch.setattr(video_agent, "MAX_TOOL_CALLS", 3)
    box = LoopBox(tmp_path, [OK])
    claude = ToolClaude([[("snapshot", {"times": [1]})]] * 10)
    out = video_agent.build(PLAN3, _brand(), "landscape", assets={}, tables={}, box=box, client=claude)
    assert out["review"]["ended"] == "calls" and out["review"]["calls"] == 3


def test_without_claude_the_templates_are_used_and_checked(store, tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    box = LoopBox(tmp_path, [OK])
    out = video_agent.build(PLAN3, _brand(), "vertical", assets={}, tables={}, box=box)
    assert out["review"] is None and box.snaps == 0 and b"data-height=\"1920\"" in out["files"]["index.html"]
    with pytest.raises(video_agent.BuildError):
        video_agent.build(PLAN3, _brand(), "vertical", assets={}, tables={}, box=LoopBox(tmp_path, [BAD]))


def test_an_unreachable_claude_falls_back_to_the_templates(store, tmp_path):
    class Down:
        beta = SimpleNamespace(messages=SimpleNamespace(create=lambda **kw: (_ for _ in ()).throw(TimeoutError())))
    out = video_agent.build(PLAN3, _brand(), "square", assets={}, tables={}, box=LoopBox(tmp_path, [OK]), client=Down())
    assert out["review"]["ended"] == "unreachable"


# ── The jobs: build, change, another shape ───────────────────────────────────
class JobBox(LoopBox):
    def __init__(self, job_id, stop=None):
        import tempfile
        super().__init__(tempfile.mkdtemp(), [OK])

    def __enter__(self):
        return self

    def __exit__(self, *a):
        import shutil
        shutil.rmtree(self.root, ignore_errors=True)
        return False


def _planned(store, **req):
    req = dict({"brief": "Show our leads results", "kind": "results",
                "tables": [("Leads", video_samples.LIBRARY_TABLE)]}, **req)
    pid, vid = video_web.new_project(ANA, **req)
    job = store.claim_job("w")
    video_planner.run_job(job, client=FakeClaude())
    store.finish_job(job["id"], "w", "done")
    return pid, vid


def _run_next(store, client=None):
    job = store.claim_job("w")
    out = video_builder.run_job(job, client=client or ToolClaude([]), sandbox=JobBox)
    store.finish_job(job["id"], "w", "done" if out["outcome"] == "done" else "failed", out["error"])
    return job, out


def test_approving_builds_stores_the_files_and_queues_the_render(store):
    pid, vid = _planned(store)
    assert video_builder.approve(BOB, vid) is None
    video_builder.approve(ANA, vid)
    with pytest.raises(video_builder.Refused, match="already"):
        video_store.update_version(vid, status="building")
        video_builder.approve(ANA, vid)
    video_store.update_version(vid, status="queued_build")
    job, out = _run_next(store)
    assert job["kind"] == "build" and out["outcome"] == "done"
    v = video_store.get_version(vid, ANA, files=True)
    assert v["status"] == "queued_render" and "index.html" in v["files"] and v["plan"]["build"]["ended"] == "done"
    assert v["cost_usd"] > 0 and v["timings"]["build_s"] >= 0
    assert video_store.claim_job("w")["kind"] == "render"


def test_a_plan_with_problems_is_not_built(store):
    pid, vid = _planned(store)
    plan = dict(video_store.get_version(vid)["plan"], problems=["Scene 1: invented"])
    video_store.update_version(vid, plan=plan)
    with pytest.raises(video_builder.Refused, match="rules"):
        video_builder.approve(ANA, vid)


def test_a_words_only_change_skips_the_review(store, monkeypatch):
    pid, vid = _planned(store)
    new = video_builder.make_changes(ANA, vid, "end on 'Find out more'")
    assert new != vid and video_store.get_version(new)["change_request"] == "end on 'Find out more'"
    claude = FakeClaude()                       # answers the plan edit with the same plan
    job = store.claim_job("w")
    out = video_builder.run_job(job, client=claude, sandbox=JobBox)
    v = video_store.get_version(new)
    assert job["kind"] == "change" and out["outcome"] == "done" and v["plan"]["build"]["ended"] == "templates"
    assert "change_planned" in [e["step"] for e in store.get_job(job["id"])["log"]]
    assert video_store.get_version(vid)["plan"]["scenes"]                 # the old version is kept


def test_a_change_that_reshapes_the_scenes_is_built_in_full(store, monkeypatch):
    pid, vid = _planned(store)
    new = video_builder.make_changes(ANA, vid, "add a scene about our team")
    calls = []

    def edit(plan, request, *a, **k):
        calls.append(request)
        p = json.loads(json.dumps({k2: plan[k2] for k2 in ("idea", "audience", "hook", "scenes", "ending",
                                                           "cover_scene", "share_copy", "notes")}))
        p["scenes"][0]["seconds"] -= 3
        p["scenes"].insert(1, scene("words", 3, "Our team"))
        return {"plan": p, "problems": [], "attempts": 1, "cost_usd": 0.05, "model": "m"}
    monkeypatch.setattr(video_plan, "edit_plan", edit)
    job, out = _run_next(store)
    v = video_store.get_version(new)
    assert out["outcome"] == "done" and calls == ["add a scene about our team"]
    assert len(v["plan"]["scenes"]) == len(video_store.get_version(vid)["plan"]["scenes"]) + 1
    assert v["plan"]["build"]["ended"] == "done"


def test_another_shape_is_laid_out_again_without_claude(store):
    pid, vid = _planned(store)
    with pytest.raises(video_builder.Refused):
        video_builder.another_shape(ANA, vid, "square")                  # results start as square
    with pytest.raises(video_builder.Refused):
        video_builder.another_shape(ANA, vid, "round")
    new = video_builder.another_shape(ANA, vid, "vertical")
    claude = ToolClaude([])
    job, out = _run_next(store, client=claude)
    v = video_store.get_version(new, files=True)
    assert out["outcome"] == "done" and v["shape"] == "vertical" and claude.calls == []
    assert 'data-height="1920"' in v["files"]["index.html"]["text"] and v["plan"]["build"]["ended"] == "templates"


def test_changes_need_words_and_a_plan(store):
    pid, vid = _planned(store)
    for bad in ("", "x", "y" * 1001):
        with pytest.raises(video_builder.Refused):
            video_builder.make_changes(ANA, vid, bad)
    assert video_builder.make_changes(BOB, vid, "slower") is None


def test_the_worker_runs_build_and_change_jobs(store, monkeypatch):
    seen = []
    monkeypatch.setattr(video_builder, "run_job", lambda job, stop=None: seen.append(job["kind"]) or {"outcome": "done"})
    video_worker.run_any({"kind": "build"})
    video_worker.run_any({"kind": "change"})
    assert seen == ["build", "change"]


# ── Scoring, and the staff page ──────────────────────────────────────────────
@pytest.fixture
def client(store, monkeypatch):
    import app as appmod
    who = {"email": ANA, "name": "Ana"}
    monkeypatch.setattr(appmod, "_get_user", lambda: who)
    c = appmod.app.test_client()
    c.who = who
    return c


BASE = "/strategic-agents/video-studio"


def _post(c, url, body=None):
    return c.post(url, data=json.dumps(body or {}), content_type="application/json")


def test_the_staff_page_makes_videos_scores_them_and_changes_them(client, store):
    store_ids = video_briefs_run(store)
    r = _post(client, BASE + "/api/plan-tests/build")
    assert r.status_code == 200 and r.get_json()["queued"] == 15
    vid = store_ids[0]
    assert store.get_version(vid)["status"] == "queued_build"
    assert _post(client, BASE + "/api/versions/%d/score" % vid, {"scores": {"good_to_post": True}}).status_code == 404
    video_store.update_version(vid, status="ready", mp4=b"\x00\x00\x00\x18ftyp", mp4_bytes=8, timings={"build_s": 60,
                                                                                                    "render_s": 120})
    r = _post(client, BASE + "/api/versions/%d/score" % vid,
              {"scores": {k: True for k in video_web.SCORE_KEYS}, "note": " great "})
    page = r.get_json()["page"]
    assert page["videos"]["ready"] == 1 and page["videos"]["good_to_post"] == 1 and page["videos"]["avg_minutes"] == 3.0
    assert video_store.get_version(vid)["plan"]["score"]["note"] == "great"
    r = _post(client, BASE + "/api/versions/%d/change" % vid, {"request": "slower"})
    assert r.status_code == 200
    assert _post(client, BASE + "/api/versions/%d/change" % vid, {"request": ""}).status_code == 400
    assert _post(client, BASE + "/api/versions/%d/shape" % vid, {"shape": "vertical"}).status_code == 200
    assert _post(client, BASE + "/api/versions/%d/shape" % vid, {"shape": "landscape"}).status_code == 400   # already
    assert _post(client, BASE + "/api/versions/%d/teleport" % vid).status_code == 404
    client.who["email"] = BOB
    assert _post(client, BASE + "/api/versions/%d/change" % vid, {"request": "slower"}).status_code == 404


def video_briefs_run(store):
    from tracker import video_briefs
    vids = video_briefs.run_all(ANA)
    fake = FakeClaude()

    def read(url, brief, on_step=None):
        return {"ok": False, "message": "The website would not let a robot read it.", "images": [], "pages": []}
    for _ in vids:
        job = store.claim_job("w")
        video_planner.run_job(job, read_site=read, client=fake)
        store.finish_job(job["id"], "w", "done")
    return vids


def test_the_real_sdk_sends_the_review_loop_the_api_expects(store, tmp_path, monkeypatch):
    """The installed SDK sends the tools, the frames and a tool result to a
    local server that answers like the Messages API."""
    pytest.importorskip("anthropic")
    import http.server
    import threading
    bodies = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            bodies.append(body)
            if len(bodies) == 1:
                content = [{"type": "tool_use", "id": "toolu_1", "name": "snapshot", "input": {"times": [1.0]}}]
            else:
                content = [{"type": "tool_use", "id": "toolu_2", "name": "done", "input": {"summary": "Fine as it is."}}]
            reply = {"id": "msg_t", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5",
                     "content": content, "stop_reason": "tool_use", "stop_sequence": None,
                     "usage": {"input_tokens": 9000, "output_tokens": 50}}
            data = json.dumps(reply).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *a):
            pass
    srv = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        from anthropic import Anthropic
        cl = Anthropic(api_key="test-key-not-real", base_url="http://127.0.0.1:%d" % srv.server_address[1], max_retries=0)
        out = video_agent.build(PLAN3, _brand(), "landscape", assets={}, tables={}, box=LoopBox(tmp_path, [OK]), client=cl)
    finally:
        srv.shutdown()
    assert out["review"]["ended"] == "done" and out["review"]["summary"] == "Fine as it is."
    first, second = bodies
    assert [t["name"] for t in first["tools"]] == ["read_file", "write_file", "check", "snapshot", "done"]
    assert first["fallbacks"] == "default" and first["output_config"] == {"effort": "medium"}
    assert second["messages"][1]["content"][0]["type"] == "tool_use"
    result = second["messages"][2]["content"][0]
    assert result["type"] == "tool_result" and result["tool_use_id"] == "toolu_1"
    assert [b["type"] for b in result["content"]] == ["text", "image"]
