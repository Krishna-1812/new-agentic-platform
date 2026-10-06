"""Video Studio: the "plan" job (plan sections 2.2 and 3.1 to 3.2).

Run by the worker, because reading a website needs the browser and the
Claude key lives there too. For one version of a project it:

  1. reads the website, when one was given (video_site), and stores what it
     found as the project's assets: screenshots, crops, the logo, the text;
     a site that blocks robots is noted, and the plan goes on without it;
  2. settles the brand (video_brand): set by hand, saved for the client,
     read from the website, or the default; and saves it for the client;
  3. makes the plan (video_plan) and stores it on the version, with the
     brand, its problems (if any) and what it cost.

Each step is written to the job's log, which is the live step list the
person sees while they wait.

A job's settings may hold {"reuse_site": True, "brand": {...}, "avoid": [ideas]}
for "Try another idea": the website is not read again, the brand is kept as
it was (with the person's edits), and Claude is asked for a different idea.

The project's choices hold the settings the person gave:
  {"kind", "shape", "seconds", "style", "words", "script",
   "website": url | "", "brand": {background, text, accent, heading_font, body_font} | {}}
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from tracker import video_brand, video_plan, video_site, video_store

log = logging.getLogger("video_studio.planner")

def _site_assets(project_id):
    return [a for a in video_store.list_assets(project_id) if (a.get("data") or {}).get("from") == "website"]


def store_site(project_id, reading):
    """Keep a website reading as assets (replacing an earlier reading). Returns the logo asset id."""
    for old in _site_assets(project_id):
        video_store.delete_asset(old["id"])
    for im in reading["images"]:
        video_store.add_asset(project_id, im["kind"], name=im["name"], mime=im["mime"], width=im["width"],
                              height=im["height"], data=dict(im.get("data") or {}, **{"from": "website"}),
                              blob=im["bytes"])
    video_store.add_asset(project_id, "site", name=reading["url"],
                          data={"from": "website", "url": reading["url"], "pages": reading["pages"]})
    if reading.get("logo"):
        from PIL import Image
        import io
        im = Image.open(io.BytesIO(reading["logo"]))
        return video_store.add_asset(project_id, "logo", name="Logo from the website", mime="image/png",
                                     width=im.width, height=im.height, data={"from": "website"},
                                     blob=reading["logo"])
    return None


def _saved_logo_asset(project_id, saved):
    """Copy a client's saved logo into this project, once."""
    if not saved or not saved.get("logo"):
        return None
    for a in video_store.list_assets(project_id, kinds=("logo",)):
        if (a.get("data") or {}).get("from") == "saved":
            return a["id"]
    from PIL import Image
    import io
    im = Image.open(io.BytesIO(saved["logo"]))
    return video_store.add_asset(project_id, "logo", name="Saved logo", mime="image/png", width=im.width,
                                 height=im.height, data={"from": "saved"}, blob=saved["logo"])


def _earlier(project):
    """The videos already made for the project's client account (tracker/account_brief.py), as
    (text for Claude, what the page shows); nothing for General work, or when they cannot be read."""
    from tracker import account_brief, workspace
    if not workspace.is_account(project.get("space") or ""):
        return "", None
    try:
        b = account_brief.build(project["space"], parts=("videos",), exclude_project=project["id"])
    except Exception:
        log.exception("video planner: earlier videos unreadable")
        return "", None
    if not b["sections"]:
        return "", None
    return "\n".join("- [%s] %s" % (i["at"][:10], i["text"]) for i in b["sections"][0]["items"]), account_brief.shown(b)


def run_job(job, *, stop=None, read_site=video_site.read, client=None):
    vid = job["version_id"]
    jid = job["id"]
    version = video_store.get_version(vid)
    project = video_store.get_project(version["project_id"]) if version else None
    if not project:
        return {"outcome": "failed", "error": "The project no longer exists."}
    pid, email = project["id"], project["email"]
    choices = project.get("choices") or {}
    brief = project.get("brief") or ""
    video_store.update_version(vid, status="planning", error="")
    started = datetime.now(timezone.utc)
    notes, website_brand, website_logo = [], None, None

    def step(name, detail=""):
        video_store.add_log(jid, name, detail)

    settings = job.get("settings") or {}
    drill = settings.get("drill")                     # the failure drills (video_drills)
    if drill == "site_never_answers":
        from tracker import video_drills
        read_site = video_drills.never_answering_reader()
    elif drill == "claude_down":
        from tracker import video_drills
        client = video_drills.DownClaude()
    # "Try another idea" keeps the website reading and the brand of the plan
    # before it (with the person's edits), and asks for a different idea.
    reuse = bool(settings.get("reuse_site"))

    # 1. The website.
    url = (choices.get("website") or "").strip()
    if url and reuse and _site_assets(pid):
        step("site_done", "Using the website reading from before")
        website_logo = next((a["id"] for a in video_store.list_assets(pid, kinds=("logo",))
                             if (a.get("data") or {}).get("from") == "website"), None)
    elif url and reuse:
        # It could not be read last time; it is not tried again.
        message = "The website could not be read before, so this plan uses your own pictures and text."
        notes.append(message)
        step("site_blocked", message)
    elif url:
        step("site", "Opening %s" % url)
        try:
            reading = read_site(url, brief, on_step=lambda k, d="": step("site_" + k, d))
        except Exception as exc:
            log.warning("site reading failed for %s: %s", url, exc)
            reading = {"ok": False, "message": "The website could not be read (%s). Upload your own screenshots "
                                               "instead." % type(exc).__name__}
        if reading.get("ok"):
            notes.extend(reading.get("notes") or [])
            website_logo = store_site(pid, reading)
            website_brand = reading.get("brand")
            step("site_done", "%d page(s), %d picture(s)" % (len(reading["pages"]), len(reading["images"])))
        else:
            notes.append(reading.get("message") or "The website could not be read.")
            step("site_blocked", reading.get("message") or "")
    else:
        # Keep what an earlier reading found, if any.
        website_logo = next((a["id"] for a in video_store.list_assets(pid, kinds=("logo",))
                             if (a.get("data") or {}).get("from") == "website"), None)

    # 2. The brand.
    step("brand", "Settling colours, fonts and logo")
    kept = settings.get("brand") if isinstance(settings.get("brand"), dict) else None
    if kept and kept.get("colors") and kept.get("fonts"):
        brand = kept
    else:
        saved = video_store.get_brand(video_store.brand_owner(project), project.get("client"))
        manual_logo = next((a["id"] for a in video_store.list_assets(pid, kinds=("logo",))
                            if (a.get("data") or {}).get("from") == "upload"), None)
        brand = video_brand.resolve(choices.get("brand") or {}, (saved or {}).get("brand"), website_brand,
                                    website_logo_asset=website_logo, manual_logo_asset=manual_logo,
                                    saved_logo_asset=_saved_logo_asset(pid, saved))
    if project.get("client") and brand["source"]["colors"] != "default" and not kept:
        logo_bytes = None
        if brand.get("logo_asset"):
            logo_bytes = (video_store.get_asset(brand["logo_asset"], blob=True) or {}).get("bytes")
        video_store.save_brand(video_store.brand_owner(project), project["client"], video_brand.to_saved(brand),
                               logo_bytes)

    # 3. The plan.
    sources = {"assets": [a for a in video_store.list_assets(pid) if a["kind"] != "frame"]}
    mine = [a for a in sources["assets"] if (a.get("data") or {}).get("from") != "website" and a["kind"] != "site"]
    step("sources", "%d picture(s), %d text(s), %d table(s)" % (
        sum(a["kind"] in video_plan.IMAGE_KINDS for a in mine), sum(a["kind"] == "text" for a in mine),
        sum(a["kind"] == "numbers" for a in mine)))
    step("plan", "Writing the plan")
    avoid = [str(x)[:300] for x in (settings.get("avoid") or []) if x][:6]
    earlier, given = _earlier(project)
    try:
        result = video_plan.make_plan(brief, choices, brand, sources, client=client, email=email, project_id=pid,
                                      version_id=vid, avoid=avoid, cap=0.0 if drill == "budget" else None,
                                      earlier=earlier,
                                      load_blob=lambda aid: (video_store.get_asset(aid, blob=True) or {}).get("bytes"))
    except video_plan.PlanError as exc:
        step("failed", str(exc))
        video_store.update_version(vid, status="failed", error=str(exc), finished_at=datetime.now(timezone.utc))
        return {"outcome": "failed", "error": str(exc)}
    plan = dict(result["plan"], brand=brand, problems=result["problems"], attempts=result["attempts"],
                model=result["model"], notes=(result["plan"].get("notes") or []) + notes,
                seconds_taken=round((datetime.now(timezone.utc) - started).total_seconds(), 1))
    if given:
        plan["memory"] = given
    if any(f["asked"] for f in brand["font_swaps"]):
        plan["notes"].append("Fonts swapped for ones the video can use: " + "; ".join(
            "%s became %s" % (f["asked"], f["used"]) for f in brand["font_swaps"] if f["asked"]))
    video_store.update_version(vid, plan=plan, status="planned", shape=choices.get("shape") or "landscape",
                               duration_s=float(choices.get("seconds") or 0), cost_usd=result["cost_usd"],
                               finished_at=datetime.now(timezone.utc))
    step("done", "%d scenes%s, $%.3f" % (len(plan["scenes"]),
                                         ", %d problem(s) left" % len(plan["problems"]) if plan["problems"] else "",
                                         result["cost_usd"]))
    return {"outcome": "done", "error": ""}
