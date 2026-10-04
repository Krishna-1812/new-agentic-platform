"""Video Studio, Phase 4: the experience.

The start (a draft, its pictures uploaded one by one, then the plan queued),
one video's page in each phase (reading, the plan, making, the result,
failed), the person's edits to a plan and the rules they are held to, Try
another idea, Duplicate, the library, the saved brands, the pages and their
routes, and that what the pages get holds no internal details.

Claude is a stand-in (tests/video_fakes.py); the sandbox is a stand-in box.
The real-browser drive of the whole journey at 1440 and 390 wide is
scripts/drive_video_studio.py.
"""

import base64
import io
import json
import os
import sys

import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from video_fakes import FakeClaude, scene  # noqa: E402
from test_video_build import OK, JobBox, ToolClaude  # noqa: E402

from tracker import (video_app, video_builder, video_plan, video_planner, video_render, video_samples,  # noqa: E402
                     video_starts, video_store, video_uploads, video_web, watch_safety)

ANA = "ana@markifydigital.com"
BOB = "bob@markifydigital.com"
BASE = "/strategic-agents/video-studio"


@pytest.fixture
def store(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")
    monkeypatch.setattr(watch_safety, "check", lambda url: None)
    video_store.reset_memory()
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


def _png(size=(320, 200), colour=(30, 90, 160)):
    buf = io.BytesIO()
    Image.new("RGB", size, colour).save(buf, "PNG")
    return buf.getvalue()


def _data_url(blob):
    return "data:image/png;base64," + base64.b64encode(blob).decode()


def _post(c, url, body=None):
    return c.post(url, data=json.dumps(body if body is not None else {}), content_type="application/json")


def _plan_next(store, client=None, read_site=None):
    job = store.claim_job("w")
    kw = {"client": client or FakeClaude()}
    if read_site:
        kw["read_site"] = read_site
    out = video_planner.run_job(job, **kw)
    store.finish_job(job["id"], "w", "done" if out["outcome"] == "done" else "failed", out["error"])
    return job


def _build_next(store, client=None):
    job = store.claim_job("w")
    out = video_builder.run_job(job, client=client or ToolClaude([]), sandbox=JobBox)
    store.finish_job(job["id"], "w", "done" if out["outcome"] == "done" else "failed", out["error"])
    return job


class RenderBox(JobBox):
    blocked = []

    def render(self, seconds, quality="high", timeout=None):
        return b"\x00\x00\x00\x18ftypmp42"

    def cover(self, mp4, at):
        return _png((160, 90))


def _render_next(store):
    job = store.claim_job("w")
    out = video_render.run_job(job, sandbox=RenderBox)
    store.finish_job(job["id"], "w", "done" if out["outcome"] == "done" else "failed", out["error"])
    return job


def _results_video(store, **extra):
    body = dict({"brief": "Show our Q3 leads: up 42% in six months.", "kind": "results",
                 "tables": [{"name": "Leads", "text": video_samples.LIBRARY_TABLE}]}, **extra)
    pid = video_app.start_draft(ANA, body)
    vid = video_app.start(ANA, pid)
    return pid, vid


# ── Starting: a draft, its pictures, then the plan ───────────────────────────
def test_a_video_starts_as_a_draft_then_its_pictures_then_the_plan(store):
    pid = video_app.start_draft(ANA, {"brief": "A launch video for our new site", "kind": "launch",
                                      "texts": [{"name": "Notes", "text": "It is faster."}],
                                      "brand": {"accent": "#ff6022"}, "client": "  Acme   Co "})
    p = store.get_project(pid, ANA)
    assert p["status"] == "draft" and store.list_versions(pid) == [] and store.claim_job("w") is None
    assert p["client"] == "Acme Co" and p["choices"]["brand"] == {"accent": "#ff6022"}
    pic = video_app.add_image(ANA, pid, "home.png", _data_url(_png()), "screenshot")
    assert pic["kind"] == "screenshot" and pic["url"] == BASE + "/asset/%d.img" % pic["id"]
    assert video_app.add_image(BOB, pid, "x.png", _data_url(_png())) is None          # not Bob's
    with pytest.raises(video_uploads.Bad):
        video_app.add_image(ANA, pid, "x.png", "not base64 at all!")
    with pytest.raises(video_uploads.Bad):
        video_app.add_image(ANA, pid, "x.png", _data_url(_png()), "video")
    with pytest.raises(video_uploads.Bad):
        video_app.add_image(ANA, pid, "x.txt", _data_url(b"hello"))
    vid = video_app.start(ANA, pid)
    assert store.get_project(pid)["status"] == "active"
    job = store.claim_job("w")
    assert job["kind"] == "plan" and job["version_id"] == vid
    with pytest.raises(video_builder.Refused, match="already"):
        video_app.start(ANA, pid)
    assert video_app.start(BOB, pid) is None


def test_the_limit_on_uploaded_pictures(store, monkeypatch):
    monkeypatch.setattr(video_uploads, "MAX_IMAGES", 2)
    pid = video_app.start_draft(ANA, {"brief": "A video of our photos"})
    for _ in range(2):
        video_app.add_image(ANA, pid, "a.png", _data_url(_png()))
    with pytest.raises(video_uploads.Bad, match="at most 2"):
        video_app.add_image(ANA, pid, "a.png", _data_url(_png()))


def test_a_draft_whose_upload_failed_is_discarded(store):
    pid = video_app.start_draft(ANA, {"brief": "A video that never starts"})
    video_app.add_image(ANA, pid, "a.png", _data_url(_png()))
    assert video_app.discard_draft(BOB, pid) is False
    assert video_app.discard_draft(ANA, pid) is True
    assert store.get_project(pid) is None and store.list_assets(pid) == []
    pid, vid = _results_video(store)
    with pytest.raises(video_builder.Refused):
        video_app.discard_draft(ANA, pid)                               # started: kept


def test_no_plan_starts_without_claude_or_past_the_budget(store, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    with pytest.raises(video_builder.Refused, match="not fully set up"):
        video_app.start_draft(ANA, {"brief": "A launch video for our new site"})
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")
    monkeypatch.setattr(video_plan, "spent_this_month", lambda now=None: 99.0)
    with pytest.raises(video_builder.Refused, match="budget"):
        video_app.start_draft(ANA, {"brief": "A launch video for our new site"})


# ── The phases of one video ──────────────────────────────────────────────────
def test_reading_steps_follow_the_plan_job_and_say_when_a_site_blocks(store):
    pid, vid = _results_video(store, website="acme.com")
    view = video_app.project_view(ANA, pid)
    assert view["version"]["phase"] == "reading" and view["busy"]
    steps = view["version"]["reading"]["steps"]
    assert [s["key"] for s in steps] == ["open", "pages", "shots", "brand", "sources", "plan"]
    assert steps[0]["state"] == "on" and steps[1]["state"] == "todo"
    log = [{"step": "site", "detail": "Opening"}, {"step": "site_blocked", "detail": "The website would not let a "
                                                                                     "robot read it."},
           {"step": "brand"}, {"step": "sources", "detail": "1 picture(s), 0 text(s), 1 table(s)"}, {"step": "plan"}]
    steps, blocked = video_app.reading_steps(log, True, False, False)
    assert blocked.startswith("The website would not let")
    assert [s["state"] for s in steps] == ["blocked", "blocked", "blocked", "done", "done", "on"]
    assert steps[4]["detail"].startswith("1 picture")
    steps, _ = video_app.reading_steps([{"step": "brand"}], False, False, True)
    assert [s["key"] for s in steps] == ["brand", "sources", "plan"] and steps[0]["state"] == "failed"


def test_making_steps_follow_the_build_and_render_logs():
    def job(kind, *names):
        return {"kind": kind, "log": [{"step": n} for n in names]}
    full = [job("render", "start", "check", "render"),
            job("build", "build_compose", "build_check", "build_look", "build_write", "build_check", "build_review",
                "build_final_check", "done")]
    steps = video_app.making_steps(full, False, False, False)
    assert [(s["key"], s["state"]) for s in steps] == [
        ("build", "done"), ("check", "done"), ("look", "done"), ("fix", "done"), ("render", "on"), ("cover", "todo")]
    assert steps[3]["detail"] == "1 fix"
    quick = [job("change", "change", "change_planned", "build_compose", "build_check", "done")]
    steps = video_app.making_steps(quick, True, False, False)
    assert [(s["key"], s["state"]) for s in steps][:5] == [
        ("change", "done"), ("build", "done"), ("check", "done"), ("look", "skipped"), ("fix", "skipped")]
    steps = video_app.making_steps(quick, True, True, False)
    assert all(s["state"] in ("done", "skipped") for s in steps)
    failed = [job("build", "build_compose", "build_check", "failed")]
    steps = video_app.making_steps(failed, False, False, True)
    assert steps[1]["state"] == "failed" and steps[2]["state"] == "todo"


def test_a_video_goes_from_plan_to_making_with_frames_to_the_result(store):
    pid, vid = _results_video(store)
    _plan_next(store)
    view = video_app.project_view(ANA, pid)
    v = view["version"]
    assert v["phase"] == "plan" and v["plan"]["scenes"] and not v["plan"]["problems"] and not view["busy"]
    assert view["tables"][0]["columns"] and v["plan"]["share_suits"] == ["linkedin", "instagram", "x"]
    video_builder.approve(ANA, vid)
    assert video_app.project_view(ANA, pid)["version"]["phase"] == "making"
    _build_next(store)
    view = video_app.project_view(ANA, pid)
    making = view["version"]["making"]
    assert view["version"]["phase"] == "making" and view["busy"]
    assert making["frames"] and all(f["url"].startswith(BASE + "/asset/") for f in making["frames"])
    frame = store.get_asset(int(making["frames"][0]["url"].split("/")[-1].split(".")[0]), ANA, blob=True)
    assert frame["kind"] == "frame" and frame["mime"] == "image/jpeg" and frame["bytes"][:2] == b"\xff\xd8"
    assert [s["state"] for s in making["steps"]][:4] == ["done", "done", "done", "skipped"]
    _render_next(store)
    view = video_app.project_view(ANA, pid)
    r = view["version"]["result"]
    assert view["version"]["phase"] == "result" and not view["busy"]
    assert r["mp4"] == BASE + "/media/%d.mp4" % vid and r["cover"] and r["download"].endswith("download=1")
    assert {s["key"] for s in r["share"]} <= {"linkedin", "instagram", "x"}
    assert "square" not in [s["key"] for s in r["other_shapes"]]
    timings = store.get_version(vid)["timings"]
    assert "build_s" in timings and "render_s" in timings          # the render keeps the build's timings
    # Frames are only for the making screen: never offered as pictures, never sent to Claude.
    assert all(p["kind"] != "frame" for p in view["pictures"])


def test_a_failed_video_says_why_in_plain_words_and_can_be_tried_again(store):
    pid, vid = _results_video(store)
    _plan_next(store, client=FakeClaude(fail=RuntimeError("boom")))
    v = video_app.project_view(ANA, pid)["version"]
    assert v["phase"] == "failed" and "Claude could not be reached" in v["error"] and v["reading"]
    again = video_app.retry(ANA, vid)
    assert again != vid and store.claim_job("w")["kind"] == "plan"
    with pytest.raises(video_builder.Refused):
        video_app.retry(ANA, again)                                       # not failed


def test_what_the_pages_get_holds_no_internal_details():
    assert video_app.public_error("Claude is not set up: add ANTHROPIC_API_KEY to the worker service in Railway.") \
        == "Video Studio is not fully set up yet. Tell the platform team, and try again later."
    assert video_app.public_error("This month's budget ($10.00) is used up. New plans wait until the 1st, or raise "
                                  "VIDEO_CLAUDE_MONTHLY_USD.") == "This month's budget ($10.00) is used up."
    assert video_app.public_error("The render failed: chromium crashed.") == \
        "Video Studio is not fully set up yet. Tell the platform team, and try again later."
    assert video_app.public_error("The title runs off at 3.0s.") == "The title runs off at 3.0s."


# ── The person's edits ───────────────────────────────────────────────────────
def _planned(store, **extra):
    pid, vid = _results_video(store, **extra)
    _plan_next(store)
    return pid, vid, store.get_version(vid)["plan"]


def test_edits_are_saved_and_checked_by_the_same_rules(store):
    pid, vid, plan = _planned(store)
    scenes = json.loads(json.dumps(plan["scenes"]))
    # Words the person types are theirs to stand behind: a new figure is fine.
    scenes[0]["headline"] = "Leads up 57% this quarter"
    out = video_app.save_plan(ANA, vid, {"scenes": scenes, "share_copy": plan["share_copy"], "cover_scene": 0})
    assert out["problems"] == [] and out["edited"]
    saved = store.get_version(vid)["plan"]
    assert saved["scenes"][0]["headline"] == "Leads up 57% this quarter" and "Leads up 57% this quarter" in saved["typed"]
    assert saved["idea"] == plan["idea"] and saved["brand"] == plan["brand"]
    # Removing a scene breaks the length; too many words breaks a limit.
    shorter = json.loads(json.dumps(scenes[1:]))
    shorter[0]["headline"] = " ".join(["word"] * 30)
    out = video_app.save_plan(ANA, vid, {"scenes": shorter})
    assert any("add up to" in p for p in out["problems"]) and any("headline has 30 words" in p for p in out["problems"])
    with pytest.raises(video_builder.Refused, match="rules"):
        video_builder.approve(ANA, vid)
    # A picture that is not this video's is a problem too.
    scenes[0]["asset_ids"] = [999999]
    assert any("not in the sources" in p for p in video_app.save_plan(ANA, vid, {"scenes": scenes})["problems"])
    scenes[0]["asset_ids"] = []
    assert video_app.save_plan(ANA, vid, {"scenes": scenes})["problems"] == []
    video_builder.approve(ANA, vid)
    with pytest.raises(video_builder.Refused, match="already being made"):
        video_app.save_plan(ANA, vid, {"scenes": scenes})
    assert video_app.save_plan(BOB, vid, {"scenes": scenes}) is None


def test_the_editor_refuses_what_it_cannot_read(store):
    pid, vid, plan = _planned(store)
    for bad in ({}, {"scenes": "x"}, {"scenes": [1, 2]}, {"scenes": [scene("words", 1, "a")] * 13}):
        with pytest.raises(video_builder.Refused):
            video_app.save_plan(ANA, vid, bad)


def test_a_typed_figure_survives_a_later_change(store):
    pid, vid, plan = _planned(store)
    scenes = json.loads(json.dumps(plan["scenes"]))
    scenes[0]["headline"] = "Leads up 57% this quarter"
    video_app.save_plan(ANA, vid, {"scenes": scenes})
    new = video_builder.make_changes(ANA, vid, "slower")
    assert store.get_version(new)["plan"]["typed"] == ["Leads up 57% this quarter"]
    problems = video_plan.check(store.get_version(new)["plan"], store.get_project(pid)["choices"],
                                {"assets": store.list_assets(pid)}, store.get_project(pid)["brief"],
                                store.get_version(new)["plan"]["typed"])
    assert problems == []


def test_brand_edits_are_fixed_for_contrast_and_saved_for_the_client(store):
    pid, vid, plan = _planned(store, client="Acme")
    logo = video_app.add_image(ANA, pid, "logo.png", _data_url(_png((200, 80))), "logo")
    edits = {"background": "#ffffff", "text": "#fefefe", "accent": "#ff6022", "heading": "Fraunces", "body": "Inter",
             "logo_asset": logo["id"]}
    out = video_app.save_plan(ANA, vid, {"scenes": plan["scenes"], "brand": edits})
    b = out["brand"]
    assert b["colors"]["text"] == "#111111"                         # unreadable text was fixed
    assert b["fonts"] == {"heading": "Fraunces", "body": "Inter"} and b["logo_asset"] == logo["id"]
    saved = store.get_brand(ANA, "acme")
    assert saved["brand"]["heading_font"] == "Fraunces" and saved["logo"][:8] == b"\x89PNG\r\n\x1a\n"
    with pytest.raises(video_builder.Refused, match="colour"):
        video_app.save_plan(ANA, vid, {"scenes": plan["scenes"], "brand": dict(edits, accent="orange")})
    with pytest.raises(video_builder.Refused, match="font"):
        video_app.save_plan(ANA, vid, {"scenes": plan["scenes"], "brand": dict(edits, heading="Comic Sans MS")})
    with pytest.raises(video_builder.Refused, match="logo"):
        video_app.save_plan(ANA, vid, {"scenes": plan["scenes"], "brand": dict(edits, logo_asset=999999)})


def test_another_idea_keeps_the_reading_and_the_brand_and_asks_for_a_different_idea(store):
    pages = [{"url": "https://acme.com", "title": "Acme", "blocks": [{"kind": "h1", "text": "Close in five days"}]}]
    reads = []

    def read(url, brief, on_step=None):
        reads.append(url)
        return {"ok": True, "url": url, "pages": pages, "images": [], "logo": None, "brand": None}
    pid, vid = _results_video(store, website="acme.com")
    _plan_next(store, read_site=read)
    plan = store.get_version(vid)["plan"]
    scenes = json.loads(json.dumps(plan["scenes"]))
    edits = {"background": "#101820", "text": "#f2f2f2", "accent": "#ffb500", "heading": "Inter", "body": "Inter"}
    video_app.save_plan(ANA, vid, {"scenes": scenes, "brand": edits})
    new = video_app.another_idea(ANA, vid)
    assert new != vid and store.get_version(vid)["status"] == "planned"          # the first plan is kept
    claude = FakeClaude()
    _plan_next(store, client=claude, read_site=read)
    assert len(reads) == 1                                                      # not read again
    asked = " ".join(b.get("text", "") for b in claude.calls[0]["messages"][0]["content"] if b.get("type") == "text")
    assert "asked for another idea" in asked and plan["idea"] in asked
    assert store.get_version(new)["plan"]["brand"]["colors"]["background"] == "#101820"
    video_builder.approve(ANA, new)
    with pytest.raises(video_builder.Refused):
        video_app.another_idea(ANA, new)                                      # being made


def test_another_idea_does_not_retry_a_site_that_blocked(store):
    reads = []

    def read(url, brief, on_step=None):
        reads.append(url)
        return {"ok": False, "message": "The website would not let a robot read it.", "images": [], "pages": []}
    pid, vid = _results_video(store, website="acme.com")
    _plan_next(store, read_site=read)
    video_app.add_image(ANA, pid, "shot.png", _data_url(_png()), "screenshot")
    new = video_app.another_idea(ANA, vid)
    _plan_next(store, read_site=read)
    assert len(reads) == 1
    assert any("could not be read before" in n for n in store.get_version(new)["plan"]["notes"])
    assert video_app.project_view(ANA, pid, vid)["version"]["blocked"].startswith("The website would not")


# ── The library and Duplicate ────────────────────────────────────────────────
def test_the_library_lists_videos_newest_first_without_the_staff_tests(store):
    pid1, vid1 = _results_video(store, client="Acme")
    _plan_next(store)
    video_web.start_test(ANA, "samples")                                    # an engine test: hidden
    pid2 = video_app.start_draft(ANA, {"brief": "A hiring video for designers", "kind": "hiring"})
    lib = video_app.library_view(ANA)
    assert [v["id"] for v in lib] == [pid2, pid1]
    assert lib[0]["status"] == "draft" and lib[0]["kind_label"] == "Hiring"
    assert lib[1]["status"] == "planned" and lib[1]["client"] == "Acme" and lib[1]["versions"] == 1
    assert lib[1]["idea"] and lib[1]["cover"] is None and lib[1]["url"] == BASE + "/videos/%d" % pid1
    store.update_version(vid1, status="ready", cover=_png((16, 9)), mp4=b"mp4", mp4_bytes=3)
    assert video_app.library_view(ANA)[1]["cover"] == BASE + "/media/%d.jpg" % vid1
    assert video_app.library_view(BOB) == []


def test_duplicate_starts_a_new_video_from_the_brief_sources_and_brand(store):
    def read(url, brief, on_step=None):
        return {"ok": True, "url": url, "pages": [], "images": [
            {"kind": "screenshot", "name": "Home", "mime": "image/png", "width": 320, "height": 200, "bytes": _png()}],
            "logo": None, "brand": None}
    pid, vid = _results_video(store, website="acme.com", client="Acme", brand={"accent": "#ff6022"})
    video_app.add_image(ANA, pid, "team.png", _data_url(_png()), "image")
    _plan_next(store, read_site=read)
    made = video_app.duplicate(ANA, pid)
    new_pid, new_vid = made
    p, old = store.get_project(new_pid, ANA), store.get_project(pid, ANA)
    assert p["brief"] == old["brief"] and p["choices"] == old["choices"] and p["client"] == "Acme"
    kinds = sorted(a["kind"] for a in store.list_assets(new_pid))
    assert kinds == ["image", "numbers"]                         # the website is read again, not copied
    assert store.claim_job("w")["version_id"] == new_vid
    assert video_app.duplicate(BOB, pid) is None


# ── Saved brands ─────────────────────────────────────────────────────────────
def test_brands_can_be_added_edited_and_removed(store):
    logo = _data_url(_png((120, 60)))
    view = video_app.save_brand(ANA, {"client": "Acme  Co", "background": "#FFFFFF", "text": "#111", "accent": "#ff6022",
                                      "heading_font": "Fraunces", "body_font": "Inter", "logo": logo})
    assert view == [{"client": "Acme Co", "key": "acme co", "colors": {"background": "#ffffff", "text": "#111111",
                                                                      "accent": "#ff6022"},
                     "fonts": {"heading": "Fraunces", "body": "Inter"},
                     "logo": BASE + "/brands/logo?client=acme%20co", "slack_channel": "",
                     "updated_at": view[0]["updated_at"]}]
    assert video_app.brand_logo(ANA, "ACME CO")[:4] == b"\x89PNG"
    view = video_app.save_brand(ANA, {"client": "acme co", "accent": "#2f5bea"})      # the rest is kept
    assert view[0]["colors"]["accent"] == "#2f5bea" and view[0]["fonts"]["heading"] == "Fraunces" and view[0]["logo"]
    view = video_app.save_brand(ANA, {"client": "acme co", "remove_logo": True})
    assert view[0]["logo"] is None
    for bad, field in (({}, "client"), ({"client": "X", "background": "white"}, "background"),
                       ({"client": "X", "background": "#fff", "text": "#000", "accent": "#f60", "heading_font": "Papyrus"}, "heading_font")):
        with pytest.raises(video_starts.Bad) as e:
            video_app.save_brand(ANA, bad)
        assert e.value.field == field
    assert video_app.brands_view(BOB) == []
    assert video_app.delete_brand(ANA, "Acme Co") and video_app.brands_view(ANA) == []


def test_a_saved_brand_is_used_for_the_clients_next_video(store):
    video_app.save_brand(ANA, {"client": "Acme", "background": "#101820", "text": "#f2f2f2", "accent": "#ffb500",
                               "heading_font": "Fraunces", "body_font": "Inter", "logo": _data_url(_png((90, 30)))})
    pid, vid = _results_video(store, client="acme")
    _plan_next(store)
    brand = store.get_version(vid)["plan"]["brand"]
    assert brand["colors"]["background"] == "#101820" and brand["fonts"]["heading"] == "Fraunces"
    assert brand["source"]["colors"] == "saved" and brand["logo_asset"]


# ── The pages and routes ─────────────────────────────────────────────────────
def test_the_pages_render_and_hold_no_internal_details(client, store):
    pid, vid = _results_video(store, client="Acme")
    _plan_next(store)
    for url in (BASE, BASE + "/videos/%d" % pid, BASE + "/brands"):
        r = client.get(url)
        body = r.get_data(as_text=True)
        assert r.status_code == 200, url
        for secret in ("claude-sonnet", "claude-opus", "ANTHROPIC", "VIDEO_CLAUDE", "railway", "hyperframes",
                       "watch_worker"):
            assert secret.lower() not in body.lower(), (url, secret)
    body = client.get(BASE).get_data(as_text=True)
    assert 'id="vs-brief"' in body and "Make a plan" in body and "Show our Q3 leads" in body
    r = client.get(BASE + "/api/videos/%d" % pid)
    text = json.dumps(r.get_json())
    assert r.status_code == 200 and "claude-" not in text and '"model"' not in text
    assert client.get(BASE + "/videos/999999").status_code == 404
    client.who["email"] = BOB
    assert client.get(BASE + "/videos/%d" % pid).status_code == 404
    assert client.get(BASE + "/api/videos/%d" % pid).status_code == 404


def test_the_staff_test_projects_have_no_video_page(client, store):
    video_web.start_test(ANA, "samples")
    pid = store.list_projects(ANA, kind="engine_test")[0]["id"]
    assert client.get(BASE + "/videos/%d" % pid).status_code == 404


def test_the_journey_through_the_routes(client, store):
    r = _post(client, BASE + "/api/videos", {"brief": "x"})
    assert r.status_code == 400 and r.get_json()["field"] == "brief"
    r = _post(client, BASE + "/api/videos", {"brief": "A promo for the Diwali sale: 20% off until 5 November.",
                                              "kind": "promo", "seconds": 99})
    assert r.status_code == 400 and r.get_json()["field"] == "seconds"
    r = _post(client, BASE + "/api/videos", {"brief": "A promo for the Diwali sale: 20% off until 5 November.",
                                              "kind": "promo", "website": "not a site"})
    assert r.status_code == 400 and r.get_json()["field"] == "website"
    assert client.post(BASE + "/api/videos", data={"brief": "A promo for the Diwali sale"}).status_code == 400
    r = _post(client, BASE + "/api/videos", {"brief": "A promo for the Diwali sale: 20% off until 5 November.",
                                              "kind": "promo"})
    pid = r.get_json()["project"]
    r = _post(client, BASE + "/api/videos/%d/images" % pid, {"name": "sale.png", "data": _data_url(_png())})
    assert r.status_code == 200 and r.get_json()["picture"]["kind"] == "image"
    r = _post(client, BASE + "/api/videos/%d/images" % pid, {"name": "bad.png", "data": _data_url(b"nope")})
    assert r.status_code == 400 and "image" in r.get_json()["error"]
    r = _post(client, BASE + "/api/videos/%d/start" % pid)
    assert r.status_code == 200 and r.get_json()["url"] == BASE + "/videos/%d" % pid
    vid = r.get_json()["version"]
    assert _post(client, BASE + "/api/videos/%d/start" % pid).status_code == 400
    assert _post(client, BASE + "/api/videos/%d/fly" % pid).status_code == 404
    _plan_next(store)
    plan = store.get_version(vid)["plan"]
    r = _post(client, BASE + "/api/versions/%d/plan" % vid, {"scenes": plan["scenes"], "cover_scene": 1})
    assert r.status_code == 200 and r.get_json()["plan"]["cover_scene"] == 1
    assert _post(client, BASE + "/api/versions/%d/plan" % vid, {"scenes": "x"}).status_code == 400
    r = _post(client, BASE + "/api/versions/%d/idea" % vid, {"view": "video"})
    new = r.get_json()["version"]
    assert r.status_code == 200 and new != vid and r.get_json()["video"]["version"]["phase"] == "reading"
    _plan_next(store)
    r = _post(client, BASE + "/api/versions/%d/approve" % new, {"view": "video"})
    assert r.status_code == 200 and r.get_json()["version"] == new and r.get_json()["video"]["version"]["phase"] == "making"
    r = _post(client, BASE + "/api/videos/%d/duplicate" % pid)
    assert r.status_code == 200 and r.get_json()["project"] != pid
    assert client.get(BASE + "/api/library").get_json()["library"][0]["id"] == r.get_json()["project"]
    r = _post(client, BASE + "/api/videos/%d/discard" % pid)
    assert r.status_code == 400                                             # started: not a draft


def test_the_brand_routes(client, store):
    r = _post(client, BASE + "/api/brands", {"client": "Acme", "background": "#ffffff", "text": "#111111",
                                             "accent": "#ff6022", "logo": _data_url(_png((60, 30)))})
    assert r.status_code == 200 and r.get_json()["brands"][0]["client"] == "Acme"
    r = client.get(BASE + "/brands/logo?client=acme")
    assert r.status_code == 200 and r.headers["Content-Type"] == "image/png"
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    r = _post(client, BASE + "/api/brands", {"client": "Acme", "accent": "nope"})
    assert r.status_code == 400 and r.get_json()["field"] == "accent"
    client.who["email"] = BOB
    assert client.get(BASE + "/brands/logo?client=acme").status_code == 404
    client.who["email"] = ANA
    assert _post(client, BASE + "/api/brands", {"delete": True, "client": "acme"}).get_json()["brands"] == []


def test_the_scene_menu_and_fields_cover_every_scene_type():
    fields = video_app.scene_fields()
    assert set(fields) == set(video_plan.SCENES)
    assert [k for k, _, _ in video_app.SCENE_MENU] == [k for k in video_plan.SCENES if k != "custom"]
    assert fields["chart"]["chart"] and fields["big_number"]["number"] and fields["quote"]["attribution"]
    assert fields["logo_wall"]["pictures"] == {"min": 2, "max": 12, "kinds": ["image", "logo"]}
    for kind, (lo, hi, kinds) in video_app.PICTURES.items():
        assert set(kinds) <= set(video_plan.IMAGE_KINDS)
        if kind in video_plan.NEEDS_ASSET:
            assert lo >= 1 and set(kinds) <= set(video_plan.NEEDS_ASSET[kind])


def test_the_directory_card_links_to_the_studio(client):
    body = client.get("/strategic-agents").get_data(as_text=True)
    card = body.split('id="a-c-vs"', 1)[1].split("</a>", 1)[0]
    assert 'data-badge="building"' in body.split('id="a-c-vs"', 1)[0][-400:] + card
    assert "Video Studio" in card and BASE in body
