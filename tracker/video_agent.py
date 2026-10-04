"""Video Studio: building the video (plan section 3.4).

build() turns an approved plan into a composition that passes its check:

  1. compose() lays every scene out from the scene library (video_build).
  2. The sandbox runs `hyperframes check`, sampling each scene once settled.
  3. When Claude is set up, it reviews the result through a short tool loop,
     the way /brag works in Claude Code, but on the server and in the job's
     locked-down folder. It is shown a frame of every scene and the check's
     findings, and can:
        read_file / write_file   the composition's own text files only
        check                    hyperframes check, findings back as text
        snapshot                 chosen frames, back as pictures
        done                     end, with a summary
     It fixes what is wrong (cut-off or crowded words, poor contrast, a
     weak first three seconds, a "custom" scene that needs its own motion),
     and never changes the plan's words or facts.
     Limits: MAX_TOOL_CALLS, MAX_FIX_ROUNDS checks after the first, MAX_LOOP_S,
     and the monthly budget.
  4. The program runs the check one last time itself. Only a composition
     that passes is kept; nothing that fails is ever rendered.

Without Claude (no key, the budget used up, or Claude unreachable) the
templates' composition is used when it passes its check.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import os
import time

from tracker import video_build, video_plan, video_sandbox, video_store

log = logging.getLogger("video_studio.agent")

MAX_TOOL_CALLS = 30
MAX_FIX_ROUNDS = 2
MAX_LOOP_S = 15 * 60
FRAME_WIDTH = 560
WRITABLE = (".html", ".css", ".js")
MAX_WRITE = 2 * 1024 * 1024

TOOLS = [
    {"name": "read_file", "description": "Read one text file of the composition (index.html, or a .css/.js file "
                                         "you wrote). Pictures under media/ and the bundled kit/ cannot be read.",
     "input_schema": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}},
    {"name": "write_file", "description": "Write a whole .html, .css or .js file of the composition (it replaces "
                                          "the file). Never kit/ or media/.",
     "input_schema": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                      "required": ["path", "content"]}},
    {"name": "check", "description": "Run hyperframes check (timing rules, text overflow and overlap, WCAG "
                                     "contrast) at every scene's settled moment. Returns the findings.",
     "input_schema": {"type": "object", "properties": {}}},
    {"name": "snapshot", "description": "Render frames at the given times (seconds) and look at them.",
     "input_schema": {"type": "object", "properties": {"times": {"type": "array", "items": {"type": "number"},
                                                                 "maxItems": 6}},
                      "required": ["times"]}},
    {"name": "done", "description": "Finish. Say in one or two sentences what you changed, or that nothing needed "
                                    "changing.",
     "input_schema": {"type": "object", "properties": {"summary": {"type": "string"}}, "required": ["summary"]}},
]

SYSTEM = """You finish short marketing videos. A program has already built the video as a \
HyperFrames composition (HTML, CSS and one paused GSAP timeline) from a library of tested \
scene templates, following a plan a person approved. You are shown a frame of every scene \
once it has settled, and the findings of `hyperframes check`. Your job is to make it right, \
then call done.

Look for, in this order:
1. Anything the check reports as an error. These must be fixed; the video is not rendered \
otherwise.
2. Words cut off, overlapping, too small to read on a phone, or crowded against an edge.
3. A scene of type "custom": it was drawn as plain words. If its motion line asks for \
something else, build it in that scene's <section> (HTML, scoped CSS, GSAP tweens added to \
the timeline `tl` within the scene's own start and duration).
4. A first three seconds that do not grab: the hook must be on screen and moving by 0.5 s.
5. Anything that looks off-brand or unfinished.
If nothing is wrong, call done straight away: do not change what works.

Rules:
- Never change the words, numbers, names or order of the scenes: the person approved them. \
Fix how they are shown, not what they say.
- Keep each <section>'s data-start, data-duration and data-track-index unless a timing \
error requires otherwise. Keep `window.__timelines["main"] = tl`.
- Motion must be seek-safe: only tweens on the one paused timeline `tl`; no setTimeout, \
setInterval, requestAnimationFrame, Math.random or Date; no CSS animations.
- Use only the files that are there: kit/gsap.min.js, the fonts already declared, and the \
pictures under media/. Never add an address outside the project (the browser has no network).
- Edit with write_file (whole file). Run check after a fix. You have %(fixes)d fix rounds \
(checks after the first) and %(calls)d tool calls in all.
- Never use em dashes in anything you write."""


class BuildError(RuntimeError):
    """The video could not be built; the message is for the person."""


def settled_times(spans):
    return [round(a + (b - a) * 0.8, 2) for a, b in spans]


def _frame_block(png, width=FRAME_WIDTH):
    from PIL import Image
    im = Image.open(io.BytesIO(png)).convert("RGB")
    if im.width > width:
        im = im.resize((width, max(1, int(im.height * width / im.width))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=80)
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                        "data": base64.standard_b64encode(buf.getvalue()).decode()}}


def report_text(report, plan_scenes, spans):
    """The check's findings as lines, with the scene each belongs to."""
    lines = ["Check: %s, %d error(s), %d warning(s)." % ("PASSED" if report["ok"] else "FAILED",
                                                       len(report["errors"]), len(report["warnings"]))]
    for kind, items in (("ERROR", report["errors"]), ("warning", report["warnings"])):
        for f in items[:25]:
            if kind == "warning" and f["code"] in ("nested_structure_needs_subcomposition", "timeline_track_too_dense",
                                                   "duplicate_media_discovery_risk"):
                continue
            lines.append("%s %s%s: %s%s" % (kind, f["code"], _scene_of(f, plan_scenes, spans), f["message"],
                                            " Fix hint: " + f["fix"] if f.get("fix") else ""))
    return "\n".join(lines)


def _scene_of(f, plan_scenes, spans):
    import re
    m = re.search(r"#s(\d+)", f.get("selector") or "")
    if m:
        i = int(m.group(1)) - 1
        if 0 <= i < len(plan_scenes):
            return " (scene %d, %s)" % (i + 1, plan_scenes[i]["type"])
    t = f.get("time")
    if isinstance(t, (int, float)):
        for i, (a, b) in enumerate(spans):
            if a <= t < b:
                return " (at %.1fs, scene %d)" % (t, i + 1)
    return ""


def _blocks(resp):
    """The response's content as plain dicts, to send back next turn."""
    out = []
    for b in getattr(resp, "content", None) or []:
        if hasattr(b, "model_dump"):
            d = b.model_dump(exclude_none=True)
        else:
            d = {k: v for k, v in vars(b).items() if v is not None}
        if d.get("type") in ("text", "tool_use"):
            out.append({k: d[k] for k in ("type", "text", "id", "name", "input") if k in d})
    return out


def _project_files(box):
    """Every file in the job's project except the bundled kit, as {path: bytes}."""
    out = {}
    for root, dirs, files in os.walk(box.project):
        rel_root = os.path.relpath(root, box.project)
        if rel_root.split(os.sep)[0] == "kit":
            continue
        for name in files:
            rel = os.path.normpath(os.path.join(rel_root, name)).replace(os.sep, "/")
            try:
                video_sandbox.check_path(rel)
            except video_sandbox.BadFile:
                continue                     # the engine's own working files
            with open(os.path.join(root, name), "rb") as fh:
                out[rel] = fh.read()
    return out


def run_loop(box, client, *, plan, spans, report, frames, record, step, deadline):
    """Claude's review of a built composition. Returns {"summary", "calls", "cost_usd", "rounds", "ended"}."""
    scenes = plan.get("scenes") or []
    intro = ["The plan the person approved (do not change its words):",
             json.dumps({"idea": plan.get("idea"), "scenes": [
                 {k: s.get(k) for k in ("type", "seconds", "headline", "subline", "items", "number", "attribution",
                                        "motion")} for s in scenes]}, ensure_ascii=False),
             "", "Scene times (start-end, s): " + ", ".join("%d: %.1f-%.1f" % (i + 1, a, b) for i, (a, b) in
                                                             enumerate(spans)),
             "", report_text(report, scenes, spans), "", "A frame of each scene once settled follows."]
    content = [{"type": "text", "text": "\n".join(intro)}]
    for i, f in enumerate(frames):
        content.append({"type": "text", "text": "Scene %d (%s):" % (i + 1, scenes[i]["type"] if i < len(scenes) else "?")})
        content.append(_frame_block(f))
    messages = [{"role": "user", "content": content}]
    calls = rounds = 0
    cost = 0.0
    summary, ended = "", "no_done"
    system = SYSTEM % {"fixes": MAX_FIX_ROUNDS, "calls": MAX_TOOL_CALLS}
    checks = 0
    while True:
        if time.monotonic() > deadline:
            ended = "time"
            break
        if video_plan.spent_this_month() >= video_plan.monthly_cap():
            ended = "budget"
            break
        try:
            resp = client.beta.messages.create(
                model=video_plan.model(), max_tokens=16000,
                betas=["server-side-fallback-2026-07-01"], fallbacks="default",
                system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                output_config={"effort": video_plan.effort()}, tools=TOOLS, messages=messages)
        except Exception as exc:
            status = getattr(exc, "status_code", None)
            video_store.add_ai_call("build", ok=False, detail="%s %s" % (type(exc).__name__, status or ""), **record)
            ended = "unreachable"
            break
        usage = video_plan._usage(resp)
        served = getattr(resp, "model", None) or video_plan.model()
        c = video_plan.cost_usd(served, usage)
        cost += c
        video_store.add_ai_call("build", ok=True, cost_usd=c, input_tokens=usage.get("input_tokens", 0),
                                output_tokens=usage.get("output_tokens", 0),
                                cache_read_tokens=usage.get("cache_read_input_tokens", 0), **dict(record, model=served))
        blocks = _blocks(resp)
        messages.append({"role": "assistant", "content": blocks})
        uses = [b for b in blocks if b["type"] == "tool_use"]
        if not uses:
            ended = "end_turn"
            break
        results, finished = [], False
        for u in uses:
            calls += 1
            name, args = u["name"], u.get("input") or {}
            if calls > MAX_TOOL_CALLS:
                results.append(_result(u, "The tool-call limit is reached. Call done now.", error=True))
                continue
            try:
                if name == "done":
                    summary, finished, ended = str(args.get("summary") or "")[:600], True, "done"
                    results.append(_result(u, "Finished."))
                elif name == "read_file":
                    path = video_sandbox.check_path(args.get("path"))
                    if not path.endswith(WRITABLE):
                        raise video_sandbox.BadFile("only .html, .css and .js files can be read")
                    full = os.path.join(box.project, *path.split("/"))
                    if not os.path.realpath(full).startswith(os.path.realpath(box.project) + os.sep):
                        raise video_sandbox.BadFile("only files inside the project can be read")
                    with open(full, encoding="utf-8") as fh:
                        results.append(_result(u, fh.read()))
                elif name == "write_file":
                    path = video_sandbox.check_path(args.get("path"))
                    data = str(args.get("content") or "").encode("utf-8")
                    if not path.endswith(WRITABLE) or path.startswith("media/"):
                        raise video_sandbox.BadFile("only .html, .css and .js files can be written")
                    if len(data) > MAX_WRITE:
                        raise video_sandbox.BadFile("the file is too large")
                    outside = video_sandbox.outside_addresses({path: data})
                    if outside:
                        raise video_sandbox.BadFile("outside addresses are not allowed: " + ", ".join(outside))
                    box.write({path: data})
                    step("build_write", path)
                    results.append(_result(u, "Written: %s (%d bytes)." % (path, len(data))))
                elif name == "check":
                    checks += 1
                    if checks > MAX_FIX_ROUNDS + 1:
                        results.append(_result(u, "No fix rounds are left. Call done.", error=True))
                        continue
                    rounds = max(0, checks - 1)
                    rep = box.check(at=settled_times(spans))
                    step("build_check", "%d errors, %d warnings" % (len(rep["errors"]), len(rep["warnings"])))
                    results.append(_result(u, report_text(rep, scenes, spans)))
                elif name == "snapshot":
                    times = [float(t) for t in (args.get("times") or [])][:6]
                    pngs = box.snapshot(times) if times else []
                    out = []
                    for t, p in zip(times, pngs):
                        out += [{"type": "text", "text": "Frame at %.2fs:" % t}, _frame_block(p)]
                    results.append({"type": "tool_result", "tool_use_id": u["id"],
                                    "content": out or [{"type": "text", "text": "No frames."}]})
                else:
                    results.append(_result(u, "Unknown tool.", error=True))
            except (video_sandbox.BadFile, OSError, ValueError, RuntimeError) as exc:
                results.append(_result(u, "Refused: %s" % exc, error=True))
        messages.append({"role": "user", "content": results})
        if finished or calls >= MAX_TOOL_CALLS:
            if not finished:
                ended = "calls"
            break
    return {"summary": summary, "calls": calls, "cost_usd": round(cost, 5), "rounds": rounds, "ended": ended}


def _result(use, text, error=False):
    out = {"type": "tool_result", "tool_use_id": use["id"], "content": [{"type": "text", "text": str(text)}]}
    if error:
        out["is_error"] = True
    return out


def build(plan, brand, shape, *, assets, tables, box, client=None, review=True, record=None, step=None,
          on_frames=None):
    """Build and check a composition in `box`. Returns
    {"files", "duration", "cover_at", "review": {...} | None, "warnings", "cost_usd"}.
    Raises BuildError when it cannot be made to pass its check.

    on_frames(pngs, times) is called with the key frames Claude is shown,
    as soon as they are taken (the making screen shows them)."""
    step = step or (lambda *a: None)
    out = video_build.compose(plan, brand, shape, assets=assets, tables=tables)
    box.write(out["files"])
    times = settled_times(out["scenes"])
    step("build_compose", "%d scenes, %.1f s" % (len(out["scenes"]), out["duration"]))
    report = box.check(at=times)
    step("build_check", "%d errors, %d warnings" % (len(report["errors"]), len(report["warnings"])))
    review_out = None
    use_claude = review and (client is not None or video_plan._key()) and \
        video_plan.spent_this_month() < video_plan.monthly_cap()
    if use_claude:
        frames = box.snapshot(times[:12])
        if on_frames:
            try:
                on_frames(frames, times[:12])
            except Exception:
                log.exception("keeping the key frames")
        step("build_look", "%d frames" % len(frames))
        review_out = run_loop(box, client or video_plan._client(), plan=plan, spans=out["scenes"], report=report,
                              frames=frames, record=record or {}, step=step,
                              deadline=time.monotonic() + MAX_LOOP_S)
        step("build_review", "%s: %s" % (review_out["ended"], review_out["summary"] or "no summary"))
        report = box.check(at=times)
        step("build_final_check", "%d errors, %d warnings" % (len(report["errors"]), len(report["warnings"])))
    if not report["ok"]:
        from tracker import video_render
        raise BuildError("The video did not pass its check: " + "; ".join(video_render.check_reasons(report)))
    return {"files": _project_files(box), "duration": out["duration"], "cover_at": out["cover_at"],
            "review": review_out, "warnings": len(report["warnings"]),
            "cost_usd": review_out["cost_usd"] if review_out else 0.0}
