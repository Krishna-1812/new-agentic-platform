"""Video Studio: what a person sees and does (plan sections 2.1 to 2.6).

The pages (Phase 4) are drawn by static/js/video-studio.js from what these
functions return. Nothing here renders or calls Claude: work is queued for
the worker, and the pages poll the state.

  home()          the start page: starting points, choices, saved brands and
                  the library
  start_draft()   the brief and its small sources are stored as a draft;
  add_image()     the pictures are uploaded one by one (each request stays
                  small);
  start()         then the plan is queued
  project_view()  one video: its versions, and for the one shown, the live
                  reading steps, the plan to edit, the live making steps with
                  the key frames, or the result
  save_plan()     the person's edits to a plan, checked by the same rules as
                  Claude's (video_plan.check); words the person types count
                  as facts, because the person stands behind them
  another_idea()  a new plan with a different idea, as a new version
  duplicate()     a new video from an old one's brief, sources and brand
  brands_view(), save_brand(), delete_brand()   saved brands per client

What the pages show holds no internal details: no model names, no service or
variable names (public_error()).
"""

from __future__ import annotations

import base64
import binascii
import io
import re

from tracker import video_brand, video_builder, video_fonts, video_plan, video_starts, video_store, video_uploads
from tracker import video_config as cfg
from tracker import video_web

BASE = "/strategic-agents/video-studio"
HIDDEN_KINDS = ("engine_test", "plan_test")
IMAGE_KINDS = video_plan.IMAGE_KINDS
UPLOAD_KINDS = ("image", "screenshot", "logo")
MAX_TYPED = 200

Refused = video_builder.Refused

# ── The scene menu, in the person's words ────────────────────────────────────
SCENE_MENU = (
    ("title", "Title", "Logo and headline"),
    ("words", "Words", "A line or two, word by word"),
    ("screenshot", "Screenshot", "A website screen with a slow zoom"),
    ("image", "Picture", "A photo with gentle motion"),
    ("list", "List", "Points that build one by one"),
    ("steps", "Steps", "Numbered steps 1, 2, 3"),
    ("big_number", "Big number", "One figure counting up"),
    ("chart", "Chart", "Bar, line or donut from your numbers"),
    ("comparison", "Comparison", "Two sides, or before and after"),
    ("quote", "Quote", "A client's words, word for word"),
    ("timeline", "Timeline", "Dates or milestones in order"),
    ("people", "People", "Photos with names and roles"),
    ("phone", "Phone", "A phone screen scrolling"),
    ("logo_wall", "Logo wall", "Client or partner logos"),
    ("event_card", "Event card", "When, where and who"),
    ("end_card", "End card", "The action and the address"),
)
SCENE_LABELS = dict((k, label) for k, label, _ in SCENE_MENU)
SCENE_LABELS["custom"] = "Custom"

# (min, max, kinds) of pictures a scene type takes.
PICTURES = {"screenshot": (1, 1, ("screenshot", "crop")), "image": (1, 1, ("image", "crop", "screenshot", "logo")),
            "phone": (1, 1, ("screenshot",)), "logo_wall": (2, 12, ("image", "logo")),
            "quote": (0, 1, ("image", "crop")), "comparison": (0, 2, IMAGE_KINDS), "people": (0, 6, ("image", "crop"))}
ITEM_WORDS = {"timeline": ("Date", "What happened"), "people": ("Name", "Role"), "event_card": ("Label", "Detail"),
              "comparison": ("Side", "What it shows"), "steps": ("Step", "Detail"), "list": ("Point", "Detail")}
HEAD_WORDS = {"quote": ("The quote, word for word", ""), "big_number": ("Headline", "What the number is"),
              "end_card": ("The action", "Address or detail"), "title": ("Headline", "Subline")}

SHARE_SUITS = {"landscape": ("linkedin", "x"), "square": ("linkedin", "instagram", "x"),
               "vertical": ("instagram", "x"), "portrait": ("instagram", "x")}
SHARE_LABELS = {"linkedin": "LinkedIn", "x": "X", "instagram": "Instagram"}


def scene_fields():
    """For the plan editor: what each scene type can hold."""
    out = {}
    for kind, (h, sub, n, _, _) in video_plan.LIMITS.items():
        lo, hi, kinds = PICTURES.get(kind, (0, 0, ()))
        heads = HEAD_WORDS.get(kind, ("Headline", "Subline"))
        out[kind] = {"label": SCENE_LABELS.get(kind, kind), "headline": h, "subline": sub, "items": n,
                     "item_words": ITEM_WORDS.get(kind, ("Label", "Detail")), "head_words": heads,
                     "number": kind == "big_number", "attribution": kind == "quote", "chart": kind == "chart",
                     "pictures": {"min": lo, "max": hi, "kinds": list(kinds)}}
    return out


# ── Words for the person ─────────────────────────────────────────────────────
_INTERNAL = re.compile(r"ANTHROPIC|VIDEO_[A-Z_]+|Railway|worker|hyperframes|chromium|ffmpeg|npm|claude-[\w.-]+", re.I)


def public_error(message):
    """An error as the person sees it: sentences naming internals are dropped."""
    text = " ".join(str(message or "").split())
    if not text:
        return ""
    kept = [s for s in re.split(r"(?<=[.!?])\s+", text) if s and not _INTERNAL.search(s)]
    if not kept:
        return "Video Studio is not fully set up yet. Tell the platform team, and try again later."
    return " ".join(kept)


def _status_label(v):
    st = v.get("status")
    if st in ("queued", "planning") and not (v.get("idea") or (v.get("plan") or {}).get("idea")):
        return "reading", "Planning"
    if st == "planned":
        return "planned", "Plan ready"
    if st == "ready":
        return "ready", "Ready"
    if st == "failed":
        return "failed", "Failed"
    return "making", "Making"


def _claude_state():
    s = video_plan.status()
    return {"state": s["state"], "spent_usd": s["spent_usd"], "cap_usd": s["cap_usd"]}


def _can_plan():
    state = video_plan.status()["state"]
    if state == "capped":
        raise Refused("This month's Video Studio budget is used up. New plans can start on the 1st; videos already "
                      "planned can still be made.")
    if state == "no_key":
        raise Refused("Video Studio is not fully set up yet. Tell the platform team.")


# ── The start page ───────────────────────────────────────────────────────────
def home(email):
    return {"starts": video_starts.starting_points(), "shapes": [{"key": k, "label": cfg.SHAPE_LABELS[k],
                                                                    "w": w, "h": h} for k, (w, h) in cfg.SHAPES.items()],
            "styles": list(video_starts.STYLES), "fonts": video_fonts.families(),
            "limits": {"min_s": cfg.MIN_SECONDS, "max_s": cfg.MAX_SECONDS, "images": video_uploads.MAX_IMAGES,
                       "texts": video_web.MAX_TEXTS, "tables": video_web.MAX_TABLES,
                       "image_mb": video_uploads.UPLOAD_MAX_BYTES // (1024 * 1024), "rows": video_uploads.MAX_ROWS,
                       "brief": video_starts.MAX_BRIEF},
            "brands": brands_view(email), "library": library_view(email), "claude": _claude_state()}


def start_draft(email, body):
    """Store the brief, choices, texts and tables as a draft. Returns the project id."""
    texts = [(str(t.get("name") or "Text")[:80], t.get("text")) for t in (body.get("texts") or [])
             if isinstance(t, dict)]
    tables = [(str(t.get("name") or "Numbers")[:80], t.get("text")) for t in (body.get("tables") or [])
              if isinstance(t, dict)]
    brand = body.get("brand") if isinstance(body.get("brand"), dict) else {}
    _can_plan()
    pid, _ = video_web.new_project(
        email, brief=body.get("brief"), kind=body.get("kind") or None, shape=body.get("shape") or None,
        seconds=body.get("seconds"), style=body.get("style"), words=body.get("words") or "write",
        script=body.get("script") or "", website=str(body.get("website") or "").strip(), brand=brand,
        client=str(body.get("client") or ""), texts=texts, tables=tables, hold=True)
    return pid


def _decode(data):
    s = str(data or "")
    if s.startswith("data:"):
        s = s.split(",", 1)[-1]
    try:
        return base64.b64decode(s, validate=True)
    except (binascii.Error, ValueError):
        raise video_uploads.Bad("The file could not be read; try uploading it again.")


def add_image(email, project_id, name, data, kind="image"):
    """Upload one picture into a project. Returns its picture view, or None."""
    p = video_store.get_project(project_id, email)
    if not p:
        return None
    if kind not in UPLOAD_KINDS:
        raise video_uploads.Bad("Choose a picture, a screenshot or a logo.")
    mine = [a for a in video_store.list_assets(project_id, email, kinds=UPLOAD_KINDS)
            if (a.get("data") or {}).get("from") == "upload"]
    if len(mine) >= video_uploads.MAX_IMAGES:
        raise video_uploads.Bad("A video can use at most %d uploaded pictures." % video_uploads.MAX_IMAGES)
    im = video_uploads.image(_decode(data), str(name or ""))
    aid = video_store.add_asset(project_id, kind, name=im["name"], mime=im["mime"], width=im["width"],
                                height=im["height"], data={"from": "upload"}, blob=im["bytes"])
    return _picture(video_store.get_asset(aid, email))


def start(email, project_id):
    """Queue the plan of a draft. Returns the version id, or None."""
    p = video_store.get_project(project_id, email)
    if not p:
        return None
    if p.get("status") != "draft" or video_store.list_versions(project_id, email):
        raise Refused("This video has already started.")
    _can_plan()
    video_store.update_project(project_id, status="active")
    return video_web.queue_plan(project_id, p["choices"])


def discard_draft(email, project_id):
    """Remove a draft that was never started (an upload failed)."""
    p = video_store.get_project(project_id, email)
    if not p:
        return False
    if p.get("status") != "draft":
        raise Refused("Only an unstarted video can be discarded.")
    return video_store.delete_project(project_id, email)


# ── One video ────────────────────────────────────────────────────────────────
def _picture(a):
    return {"id": a["id"], "kind": a["kind"], "name": a.get("name") or "", "w": a.get("width"),
            "h": a.get("height"), "from": (a.get("data") or {}).get("from") or "",
            "url": "%s/asset/%d.img" % (BASE, a["id"])}


def phase_of(version, jobs):
    st = version["status"]
    if st == "ready":
        return "result"
    if st == "failed":
        return "failed"
    if st == "planned":
        return "plan"
    if st in ("queued", "planning") and (not jobs or jobs[0]["kind"] == "plan"):
        return "reading"
    return "making"


READ_STEPS = (("open", "Opening the website in a real browser"),
              ("pages", "Reading the pages that matter"),
              ("shots", "Taking screenshots at desktop and phone width"),
              ("brand", "Picking up the brand: logo, colours, fonts"),
              ("sources", "Reading your images, text and numbers"),
              ("plan", "Writing the plan"))
_READ_AT = {"site": "open", "site_open": "open", "site_pages": "pages", "site_screenshots": "shots",
            "site_brand": "brand", "site_done": "brand", "site_blocked": "brand", "brand": "brand",
            "sources": "sources", "plan": "plan"}


def reading_steps(log, website, finished, failed):
    keys = [k for k, _ in READ_STEPS if website or k not in ("open", "pages", "shots")]
    reached, details, blocked = -1, {}, ""
    for e in log:
        key = _READ_AT.get(e.get("step"))
        if e.get("step") == "site_blocked":
            blocked = public_error(e.get("detail"))
        if e.get("step") == "site_done" and e.get("detail"):
            details["shots"] = e["detail"]
        if key in keys:
            reached = max(reached, keys.index(key))
            if e.get("detail") and key in ("pages", "sources"):
                details[key] = e["detail"]
    out = []
    for i, k in enumerate(keys):
        if finished or i < reached:
            state = "done"
        elif i == reached or (reached < 0 and i == 0):
            state = "failed" if failed else "on"
        else:
            state = "todo"
        if blocked and k in ("open", "pages", "shots"):
            state = "blocked"
        out.append({"key": k, "label": dict(READ_STEPS)[k], "state": state, "detail": details.get(k, "")})
    return out, blocked


MAKE_STEPS = (("change", "Making your change"), ("build", "Building the scenes"),
              ("check", "Checking every frame"), ("look", "Looking at it"), ("fix", "Fixing what it found"),
              ("render", "Rendering the video"), ("cover", "Picking the cover frame"))


def making_steps(jobs, is_change, finished, failed):
    """The making steps from the build (or change) and render jobs' logs."""
    keys = [k for k, _ in MAKE_STEPS if is_change or k != "change"]
    seen, writes, current = set(), 0, None
    for j in reversed(jobs):              # oldest job first
        for e in j.get("log") or []:
            name = e.get("step")
            key = None
            if j["kind"] == "change" and name in ("change", "change_planned"):
                key = "change"
            elif name == "build_compose":
                key = "build"
            elif name == "build_check":
                key = "fix" if "look" in seen else "check"
            elif name == "build_look":
                key = "look"
            elif name == "build_write":
                key, writes = "fix", writes + 1
            elif name in ("build_review", "build_final_check"):
                key = "fix" if writes else "look"
            elif name == "done" and j["kind"] in ("build", "change"):
                key = "render"
            elif j["kind"] == "render" and name in ("start", "check", "render", "stopped"):
                key = "render"
            elif name == "cover":
                key = "cover"
            if key in keys:
                seen.add(key)
                current = key
    cur = keys.index(current) if current in keys else 0
    out = []
    for i, k in enumerate(keys):
        if finished:
            state = "done" if k in seen or k not in ("look", "fix", "change") else "skipped"
        elif i < cur:
            state = "done" if k in seen or k not in ("look", "fix") else "skipped"
        elif i == cur:
            state = "failed" if failed else "on"
        else:
            state = "todo"
        if failed and i > cur:
            state = "todo"
        detail = ""
        if k == "fix" and writes:
            detail = "%d fix%s" % (writes, "es" if writes != 1 else "")
        elif k in ("look", "fix") and state == "skipped":
            detail = "Not needed"
        out.append({"key": k, "label": dict(MAKE_STEPS)[k], "state": state, "detail": detail})
    return out


def _brand_view(brand):
    if not brand:
        return None
    return {"colors": brand.get("colors"), "fonts": brand.get("fonts"), "logo_asset": brand.get("logo_asset"),
            "logo_url": "%s/asset/%d.img" % (BASE, brand["logo_asset"]) if brand.get("logo_asset") else None,
            "source": brand.get("source") or {},
            "swaps": [{"asked": s.get("asked"), "used": s.get("used")} for s in brand.get("font_swaps") or []
                      if s.get("asked")]}


def _plan_view(plan, shape):
    share = plan.get("share_copy") or {}
    return {"idea": plan.get("idea") or "", "audience": plan.get("audience") or "", "hook": plan.get("hook") or "",
            "scenes": plan.get("scenes") or [], "cover_scene": plan.get("cover_scene") or 0,
            "share_copy": {k: share.get(k) or "" for k in ("linkedin", "x", "instagram")},
            "share_suits": list(SHARE_SUITS.get(shape, ("x",))),
            "notes": [public_error(n) for n in plan.get("notes") or [] if public_error(n)],
            "problems": plan.get("problems") or [], "brand": _brand_view(plan.get("brand")),
            "edited": bool(plan.get("edited"))}


def _minutes(timings):
    return round(sum(float(v or 0) for v in (timings or {}).values()) / 60, 1)


def _version_row(v):
    phase, label = _status_label(v)
    return {"id": v["id"], "number": v["number"], "status": phase, "status_label": label,
            "change": v.get("change_request") or "", "shape": v["shape"], "shape_label": cfg.SHAPE_LABELS.get(v["shape"]),
            "seconds": v.get("duration_s"), "cost_usd": round(float(v.get("cost_usd") or 0), 2),
            "minutes": _minutes(v.get("timings")), "created_at": v.get("created_at"),
            "cover": "%s/media/%d.jpg" % (BASE, v["id"]) if v.get("has_cover") else None,
            "idea": (v.get("plan") or {}).get("idea") or ""}


def project_view(email, project_id, version_id=None):
    p = video_store.get_project(project_id, email)
    if not p or p["kind"] in HIDDEN_KINDS:
        return None
    versions = video_store.list_versions(project_id, email)
    current = next((v for v in versions if v["id"] == version_id), versions[0] if versions else None)
    choices = p.get("choices") or {}
    start = video_starts.STARTS.get(choices.get("kind") or "custom", video_starts.STARTS["custom"])
    assets = video_store.list_assets(project_id, email)
    view = {"id": p["id"], "brief": p["brief"], "client": p.get("client") or "", "draft": p.get("status") == "draft",
            "choices": {"kind": choices.get("kind"), "kind_label": start[0], "shape": choices.get("shape"),
                        "shape_label": cfg.SHAPE_LABELS.get(choices.get("shape")), "seconds": choices.get("seconds"),
                        "style": choices.get("style") or "", "words": choices.get("words"),
                        "website": choices.get("website") or ""},
            "pictures": [_picture(a) for a in assets if a["kind"] in IMAGE_KINDS],
            "tables": [{"id": a["id"], "name": a.get("name") or "Numbers",
                        "columns": (a.get("data") or {}).get("columns") or [],
                        "numeric": (a.get("data") or {}).get("numeric") or []}
                       for a in assets if a["kind"] == "numbers"],
            "texts": sum(a["kind"] == "text" for a in assets),
            "versions": [_version_row(v) for v in versions], "version": None, "busy": False,
            "claude": _claude_state(), "shapes": [{"key": k, "label": lab} for k, lab in cfg.SHAPE_LABELS.items()]}
    if not current:
        return view
    jobs = video_store.jobs_for_version(current["id"], email)
    phase = phase_of(current, jobs)
    plan = current.get("plan") or {}
    v = {"id": current["id"], "number": current["number"], "phase": phase, "shape": current["shape"],
         "shape_label": cfg.SHAPE_LABELS.get(current["shape"]), "seconds": current.get("duration_s"),
         "target_s": choices.get("seconds"), "change": current.get("change_request") or "",
         "error": public_error(current.get("error")), "cost_usd": round(float(current.get("cost_usd") or 0), 2),
         "minutes": _minutes(current.get("timings")), "plan": _plan_view(plan, current["shape"]) if plan.get("scenes") else None}
    if phase == "reading" or (phase == "failed" and not plan.get("scenes")):
        log = (jobs[0].get("log") or []) if jobs else []
        steps, blocked = reading_steps(log, bool(choices.get("website")), False, phase == "failed")
        v["reading"] = {"steps": steps, "blocked": blocked}
    if phase == "plan":
        blocked = next((public_error(e.get("detail")) for j in jobs for e in j.get("log") or []
                        if e.get("step") == "site_blocked"), "")
        v["blocked"] = blocked
    if phase in ("making", "result") or (phase == "failed" and plan.get("scenes")):
        made = [j for j in jobs if j["kind"] in ("build", "change", "render")]
        v["making"] = {"steps": making_steps(made, any(j["kind"] == "change" for j in made), phase == "result",
                                             phase == "failed"),
                       "frames": sorted(({"url": "%s/asset/%d.img" % (BASE, a["id"]),
                                          "at": (a.get("data") or {}).get("at")}
                                         for a in assets if a["kind"] == "frame"
                                         and (a.get("data") or {}).get("version_id") == current["id"]),
                                        key=lambda f: f["at"] or 0)}
    if phase == "result":
        share = plan.get("share_copy") or {}
        v["result"] = {"mp4": "%s/media/%d.mp4" % (BASE, current["id"]),
                       "download": "%s/media/%d.mp4?download=1" % (BASE, current["id"]),
                       "cover": "%s/media/%d.jpg" % (BASE, current["id"]) if current.get("has_cover") else None,
                       "mb": round((current.get("mp4_bytes") or 0) / 1e6, 1),
                       "share": [{"key": k, "label": SHARE_LABELS[k], "text": share.get(k)}
                                 for k in SHARE_SUITS.get(current["shape"], ("x",)) if share.get(k)],
                       "other_shapes": [{"key": k, "label": lab} for k, lab in cfg.SHAPE_LABELS.items()
                                        if k != current["shape"]]}
    view["version"] = v
    view["busy"] = any(r["status"] in ("reading", "making") for r in view["versions"])
    return view


# ── The person's edits to a plan ─────────────────────────────────────────────
def _texts(plan):
    out = []
    for s in plan.get("scenes") or []:
        out.extend(video_plan.scene_text(s))
    out.extend(t for t in (plan.get("share_copy") or {}).values() if t)
    return out


def save_plan(email, version_id, body):
    """Save a person's edits (scenes, share copy, cover, brand). Returns the plan view, or None."""
    v = video_store.get_version(version_id, email)
    if not v:
        return None
    p = video_store.get_project(v["project_id"], email)
    old = v.get("plan") or {}
    if v["status"] != "planned" or not old.get("scenes"):
        raise Refused("This plan is already being made. Use Make changes on the video instead.")
    scenes = body.get("scenes")
    if not isinstance(scenes, list) or not all(isinstance(s, dict) for s in scenes):
        raise Refused("The scenes could not be read.")
    if len(scenes) > video_plan.MAX_SCENES:
        raise Refused("A video can have at most %d scenes." % video_plan.MAX_SCENES)
    raw = {k: old.get(k) for k in ("idea", "audience", "hook", "ending", "notes")}
    raw.update(scenes=scenes, share_copy=body.get("share_copy") if isinstance(body.get("share_copy"), dict)
               else old.get("share_copy"), cover_scene=body.get("cover_scene", old.get("cover_scene")))
    try:
        new = video_plan.clean(raw)
    except (ValueError, TypeError):
        raise Refused("The plan could not be read.")
    new["cover_scene"] = min(max(0, new["cover_scene"]), max(0, len(new["scenes"]) - 1))
    before = set(_texts(old)) | set(old.get("typed") or [])
    typed = list(old.get("typed") or [])
    for t in _texts(new):
        if t not in before and t not in typed:
            typed.append(t)
    typed = typed[-MAX_TYPED:]
    assets = [a for a in video_store.list_assets(p["id"], email) if a["kind"] != "frame"]
    brand = _edited_brand(email, p, old.get("brand") or {}, body.get("brand"), assets)
    problems = video_plan.check(new, p.get("choices") or {}, {"assets": assets}, p.get("brief") or "", typed)
    plan = dict(old, **new)
    plan.update(brand=brand, problems=problems, typed=typed, edited=True)
    video_store.update_version(version_id, plan=plan)
    return _plan_view(plan, v["shape"])


def _edited_brand(email, project, old, edits, assets):
    if not isinstance(edits, dict) or not old.get("colors"):
        return old
    colors = {}
    for k in video_brand.COLOR_KEYS:
        c = video_brand.hex_colour(edits.get(k) or old["colors"].get(k))
        if not c:
            raise Refused("%s is not a colour like #1A2B3C." % edits.get(k))
        colors[k] = c
    fonts = {}
    for role in ("heading", "body"):
        f = str(edits.get(role) or old["fonts"].get(role) or "")
        if f not in video_fonts.manifest():
            raise Refused("Choose a font from the list.")
        fonts[role] = f
    logo = edits.get("logo_asset", old.get("logo_asset"))
    logo = int(logo) if isinstance(logo, (int, float)) and logo else None
    if logo and not any(a["id"] == logo and a["kind"] in IMAGE_KINDS for a in assets):
        raise Refused("Choose the logo from the pictures of this video.")
    same = all(colors[k] == old["colors"].get(k) for k in colors) and fonts == old.get("fonts") and \
        logo == old.get("logo_asset")
    if same:
        return old
    brand = dict(old, colors=video_brand.fix_colours(colors["background"], colors["text"], colors["accent"]),
                 fonts=fonts, logo_asset=logo, font_swaps=[],
                 source={"colors": "manual", "fonts": "manual", "logo": "manual" if logo else None})
    if project.get("client"):
        logo_bytes = None
        if logo:
            logo_bytes = _png((video_store.get_asset(logo, email, blob=True) or {}).get("bytes"))
        video_store.save_brand(email, project["client"], video_brand.to_saved(brand), logo_bytes,
                               clear_logo=not logo)
    return brand


def _png(data):
    """Saved logos are kept as PNG (the planner reads them as PNG)."""
    if not data:
        return None
    from PIL import Image
    im = Image.open(io.BytesIO(data))
    buf = io.BytesIO()
    im.convert("RGBA").save(buf, "PNG", optimize=True)
    return buf.getvalue()


def another_idea(email, version_id):
    """A new version with a different plan. Returns its id, or None."""
    v = video_store.get_version(version_id, email)
    if not v:
        return None
    p = video_store.get_project(v["project_id"], email)
    jobs = video_store.jobs_for_version(version_id, email)
    if phase_of(v, jobs) not in ("plan", "failed"):
        raise Refused("Another idea can be asked for while the plan is waiting for approval.")
    _can_plan()
    plan = v.get("plan") or {}
    settings = {}
    if plan.get("scenes"):
        ideas = [(x.get("plan") or {}).get("idea") for x in video_store.list_versions(p["id"], email)
                 if (x.get("plan") or {}).get("idea")]
        settings = {"reuse_site": True, "avoid": list(dict.fromkeys(ideas))[:6]}
        if plan.get("brand"):
            settings["brand"] = plan["brand"]
    return video_web.queue_plan(p["id"], p.get("choices") or {}, settings)


def retry(email, version_id):
    """Try a failed version again: its plan, or making it. Returns the version id to show."""
    v = video_store.get_version(version_id, email)
    if not v:
        return None
    if v["status"] != "failed":
        raise Refused("Only a failed video can be tried again.")
    plan = v.get("plan") or {}
    if not plan.get("scenes"):
        return another_idea(email, version_id)
    if plan.get("problems"):
        raise Refused("The plan breaks some rules; use Try another idea, or make a new video.")
    video_builder.approve(email, version_id)
    return version_id


# ── The library ──────────────────────────────────────────────────────────────
def library_view(email, limit=200):
    out = []
    for r in video_store.library(email, limit=limit, exclude_kinds=HIDDEN_KINDS):
        latest, ready = r.get("latest") or {}, r.get("ready") or {}
        start = video_starts.STARTS.get(r["kind"], video_starts.STARTS["custom"])
        if r.get("status") == "draft":
            phase, label = "draft", "Not started"
        elif latest:
            phase, label = _status_label(latest)
        else:
            phase, label = "draft", "Not started"
        shown = ready or latest
        out.append({"id": r["id"], "url": "%s/videos/%d" % (BASE, r["id"]), "brief": r["brief"],
                    "client": r.get("client") or "", "kind": r["kind"], "kind_label": start[0],
                    "shape_label": cfg.SHAPE_LABELS.get((shown or {}).get("shape") or (r.get("choices") or {}).get("shape")),
                    "seconds": (shown or {}).get("duration_s") or (r.get("choices") or {}).get("seconds"),
                    "versions": int(r.get("versions") or 0), "status": phase, "status_label": label,
                    "idea": (shown or {}).get("idea") or "",
                    "cover": "%s/media/%d.jpg" % (BASE, ready["id"]) if ready else None,
                    "created_at": r.get("created_at")})
    return out


def duplicate(email, project_id):
    """A new video from an old one's brief, sources and brand. Returns (project id, version id), or None."""
    p = video_store.get_project(project_id, email)
    if not p or p["kind"] in HIDDEN_KINDS:
        return None
    _can_plan()
    pid = video_store.create_project(email, client=p.get("client") or "", title=p.get("title") or "",
                                     brief=p["brief"], kind=p["kind"], choices=p.get("choices") or {})
    for a in video_store.list_assets(project_id, email):
        if (a.get("data") or {}).get("from") == "upload" or a["kind"] in ("text", "numbers"):
            full = video_store.get_asset(a["id"], email, blob=True)
            video_store.add_asset(pid, a["kind"], name=a.get("name") or "", mime=a.get("mime") or "",
                                  width=a.get("width"), height=a.get("height"), data=a.get("data") or {},
                                  blob=full.get("bytes"))
    return pid, video_web.queue_plan(pid, p.get("choices") or {})


# ── Saved brands ─────────────────────────────────────────────────────────────
def brand_logo_url(client):
    from urllib.parse import quote
    return "%s/brands/logo?client=%s" % (BASE, quote(client))


def brands_view(email):
    out = []
    for r in video_store.list_brands(email):
        b = r.get("brand") or {}
        name = b.get("name") or r["client"]
        out.append({"client": name, "key": r["client"],
                    "colors": {k: b.get(k) for k in video_brand.COLOR_KEYS},
                    "fonts": {"heading": b.get("heading_font"), "body": b.get("body_font")},
                    "logo": brand_logo_url(r["client"]) if r.get("has_logo") else None,
                    "updated_at": r.get("updated_at")})
    return out


def save_brand(email, body):
    """Save or edit a client's brand from the brands page. Returns the brands view."""
    client = " ".join(str(body.get("client") or "").split())[:120]
    if not client:
        raise video_starts.Bad("Name the client.", "client")
    old = (video_store.get_brand(email, client) or {}).get("brand") or {}
    saved = {}
    for k in video_brand.COLOR_KEYS:
        c = video_brand.hex_colour(body.get(k) or old.get(k))
        if not c:
            raise video_starts.Bad("Set the %s colour, like #1A2B3C." % k, k)
        saved[k] = c
    for key in ("heading_font", "body_font"):
        f = str(body.get(key) or old.get(key) or "Inter")
        if f not in video_fonts.manifest():
            raise video_starts.Bad("Choose a font from the list.", key)
        saved[key] = f
    logo = None
    if body.get("logo"):
        im = video_uploads.image(_decode(body["logo"]), "logo")
        logo = _png(im["bytes"])
    video_store.save_brand(email, client, saved, logo, clear_logo=bool(body.get("remove_logo")) and not logo)
    return brands_view(email)


def delete_brand(email, client):
    return video_store.delete_brand(email, client)


def brand_logo(email, client):
    b = video_store.get_brand(email, client)
    return (b or {}).get("logo")
