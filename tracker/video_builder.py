"""Video Studio: the "build" and "change" jobs, and starting them.

  approve(version)         queue the build of an approved plan
  make_changes(version, …) a new version from plain words ("slower", "end on
                           'Start free'"); the old one is kept
  another_shape(version, …) the same plan as a new version in another shape,
                           laid out again for it (not cropped)

Jobs, run by the worker:
  build   lay the plan out from the scene library, check it, let Claude
          review it (video_agent), store the files, and queue the render.
          A new shape is built without the review unless its check fails.
  change  Claude edits the plan (video_plan.edit_plan, with the same checks).
          When only words changed, the video is laid out again and checked
          without the review, which is quicker and cheaper; otherwise it is
          built in full. Then it is rendered.

Each version's cost adds up its Claude calls; its timings say how long each
step took.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from tracker import video_agent, video_build, video_config as cfg, video_plan, video_sandbox, video_store

log = logging.getLogger("video_studio.builder")


class Refused(ValueError):
    """The request cannot be done; the message is for the person."""


# ── Limits ───────────────────────────────────────────────────────────────────
def _today():
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def check_daily(email, what):
    """Refuse past a person's daily limit: what is "videos" or "plans"."""
    kinds, limit = (("build", "change"), cfg.daily_videos()) if what == "videos" else (("plan",), cfg.daily_plans())
    if video_store.jobs_since(email, kinds, _today()) >= limit:
        raise Refused("You have reached today's limit of %d %s. It starts again at midnight (UTC)."
                      % (limit, "videos" if what == "videos" else "plans"))


def check_versions(project_id):
    if len(video_store.list_versions(project_id)) >= cfg.MAX_VERSIONS:
        raise Refused("This video has %d versions, the most one video can have. Duplicate it to carry on."
                      % cfg.MAX_VERSIONS)


def check_budget():
    """Changes need Claude; past the monthly budget they wait, but approving does not."""
    if video_plan.spent_this_month() >= video_plan.monthly_cap():
        raise Refused("This month's Video Studio budget is used up, so changes in words wait until the 1st. "
                      "Approving plans, another shape and downloads still work.")


# ── Starting work ────────────────────────────────────────────────────────────
def _plan_ready(version):
    plan = version.get("plan") or {}
    if not plan.get("scenes"):
        raise Refused("This version has no plan yet.")
    if plan.get("problems"):
        raise Refused("The plan still breaks some rules; fix them before making the video.")
    return plan


def approve(email, version_id):
    v = video_store.get_version(version_id, email)
    if not v:
        return None
    _plan_ready(v)
    if v["status"] in ("building", "making", "queued_render", "queued_build"):
        raise Refused("This video is already being made.")
    check_daily(email, "videos")
    video_store.update_version(version_id, status="queued_build", error="")
    return video_store.enqueue(version_id, kind="build", settings={"review": True})


def _copy(version, email, **fields):
    pid = version["project_id"]
    plan = dict(version.get("plan") or {})
    plan.pop("review", None)
    plan.pop("score", None)
    return video_store.create_version(pid, plan=plan, shape=fields.pop("shape", version["shape"]),
                                      duration_s=version["duration_s"], status="queued", **fields)


def make_changes(email, version_id, request):
    v = video_store.get_version(version_id, email)
    if not v:
        return None
    _plan_ready(v)
    text = " ".join(str(request or "").split())
    if len(text) < 3:
        raise Refused("Say what to change, for example 'slower' or 'end on Start free'.")
    if len(text) > 1000:
        raise Refused("Keep the change under 1,000 characters.")
    check_versions(v["project_id"])
    check_budget()
    check_daily(email, "videos")
    new = _copy(v, email, change_request=text)
    video_store.enqueue(new, kind="change", settings={"from": version_id})
    return new


def another_shape(email, version_id, shape):
    v = video_store.get_version(version_id, email)
    if not v:
        return None
    _plan_ready(v)
    if shape not in cfg.SHAPES:
        raise Refused("Pick a shape: %s." % ", ".join(cfg.SHAPE_LABELS.values()))
    if shape == v["shape"]:
        raise Refused("This version is already %s." % cfg.SHAPE_LABELS[shape])
    check_versions(v["project_id"])
    check_daily(email, "videos")
    new = _copy(v, email, shape=shape, change_request="Make it %s" % cfg.SHAPE_LABELS[shape])
    video_store.enqueue(new, kind="build", settings={"review": False})
    return new


# ── Key frames, for the making screen ────────────────────────────────────────
FRAME_WIDTH = 480


def keep_frames(project_id, version_id, pngs, times):
    """Store the frames a build looked at as small JPEGs (assets of kind "frame")."""
    import io
    from PIL import Image
    drop_frames(project_id, version_id)
    for png, at in zip(pngs, times):
        im = Image.open(io.BytesIO(png)).convert("RGB")
        if im.width > FRAME_WIDTH:
            im = im.resize((FRAME_WIDTH, max(1, round(im.height * FRAME_WIDTH / im.width))), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=78)
        video_store.add_asset(project_id, "frame", name="Frame at %.1f s" % at, mime="image/jpeg", width=im.width,
                              height=im.height, data={"version_id": version_id, "at": round(float(at), 2)},
                              blob=buf.getvalue())


def drop_frames(project_id, version_id):
    for a in video_store.list_assets(project_id, kinds=("frame",)):
        if (a.get("data") or {}).get("version_id") == version_id:
            video_store.delete_asset(a["id"])


# ── Running the jobs ─────────────────────────────────────────────────────────
def _inputs(project_id, plan):
    """The pictures the plan uses and every numbers table of the project."""
    brand = plan["brand"]
    wanted = set(video_build.scene_assets(plan, brand))
    assets, tables = {}, {}
    for a in video_store.list_assets(project_id):
        if a["kind"] == "numbers":
            tables[a["id"]] = a.get("data") or {}
        elif a["id"] in wanted:
            full = video_store.get_asset(a["id"], blob=True)
            assets[a["id"]] = {"bytes": full.get("bytes"), "mime": a.get("mime"), "width": a.get("width"),
                               "height": a.get("height"), "kind": a["kind"]}
    return assets, tables


def run_job(job, *, stop=None, client=None, sandbox=video_sandbox.Sandbox):
    vid, jid = job["version_id"], job["id"]
    version = video_store.get_version(vid)
    project = video_store.get_project(version["project_id"]) if version else None
    if not project:
        return {"outcome": "failed", "error": "The project no longer exists."}
    settings = job.get("settings") or {}
    timings = dict(version.get("timings") or {})
    cost = float(version.get("cost_usd") or 0)
    record = {"email": project["email"], "project_id": project["id"], "version_id": vid}

    def step(name, detail=""):
        video_store.add_log(jid, name, detail)

    def fail(message):
        step("failed", message)
        video_store.update_version(vid, status="failed", error=message[:1000], timings=timings, cost_usd=cost,
                                   finished_at=datetime.now(timezone.utc))
        return {"outcome": "failed", "error": message}

    plan = version.get("plan") or {}
    review = bool(settings.get("review", True))
    started = time.monotonic()
    video_store.update_version(vid, status="building", error="")
    if job["kind"] == "change":
        step("change", version.get("change_request") or "")
        choices = dict(project.get("choices") or {}, shape=version["shape"])
        sources = {"assets": [a for a in video_store.list_assets(project["id"]) if a["kind"] != "frame"]}
        try:
            out = video_plan.edit_plan(plan, version.get("change_request"), project.get("brief") or "", choices,
                                       plan["brand"], sources, client=client, **record,
                                       load_blob=lambda aid: (video_store.get_asset(aid, blob=True) or {}).get("bytes"))
        except video_plan.PlanError as exc:
            return fail(str(exc))
        cost += out["cost_usd"]
        new_plan = dict(out["plan"], brand=plan["brand"], problems=out["problems"], attempts=out["attempts"],
                        model=out["model"], typed=plan.get("typed") or [])
        if out["problems"]:
            video_store.update_version(vid, plan=new_plan, cost_usd=cost)
            return fail("The change could not be made within the rules: " + "; ".join(out["problems"][:4]))
        review = not video_plan.same_shape_of_plan(plan, new_plan)
        step("change_planned", "words only, quick rebuild" if not review else "scenes changed, full build")
        plan = new_plan
        video_store.update_version(vid, plan=plan, cost_usd=cost)
    timings["plan_change_s" if job["kind"] == "change" else "prepare_s"] = round(time.monotonic() - started, 1)
    assets, tables = _inputs(project["id"], plan)
    drop_frames(project["id"], vid)
    t = time.monotonic()
    try:
        with sandbox(jid, stop=stop) as box:
            try:
                built = video_agent.build(plan, plan["brand"], version["shape"], assets=assets, tables=tables,
                                          box=box, client=client, review=review, record=record, step=step,
                                          on_frames=lambda pngs, times: keep_frames(project["id"], vid, pngs, times))
            except video_agent.BuildError:
                if review:
                    raise
                step("build_retry", "The quick build failed its check; building in full.")
                built = video_agent.build(plan, plan["brand"], version["shape"], assets=assets, tables=tables,
                                          box=box, client=client, review=True, record=record, step=step,
                                          on_frames=lambda pngs, times: keep_frames(project["id"], vid, pngs, times))
    except video_agent.BuildError as exc:
        timings["build_s"] = round(time.monotonic() - t, 1)
        return fail(str(exc))
    timings["build_s"] = round(time.monotonic() - t, 1)
    cost += built["cost_usd"]
    plan = dict(plan, build=built["review"] or {"ended": "templates", "summary": "Built from the templates."})
    video_store.update_version(vid, files=video_build.stored(built["files"]), plan=plan, cost_usd=round(cost, 5),
                               duration_s=built["duration"], cover_at=built["cover_at"], timings=timings,
                               status="queued_render")
    video_store.enqueue(vid, kind="render")
    step("done", "built in %.0f s; queued to render" % timings["build_s"])
    return {"outcome": "done", "error": ""}
