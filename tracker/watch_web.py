"""Page Watch: what the pages show, and checking what people send.

The routes in app.py stay thin: they check the user and call these. Every
function takes the signed-in user's email and reads through the store's
email-scoped functions, so one person never sees another's watches.

Nothing here opens a browser. A new watch is due at once, so the worker
reads it within seconds; the add flow shows that first reading (the
baseline) as its live preview.
"""

from __future__ import annotations

from datetime import datetime, timezone

from tracker import watch_config as cfg
from tracker import watch_judge, watch_safety, watch_schedule, watch_store

BASE = "/strategic-agents/page-watch"
MAX_NAME = 120
MAX_CLIENT = 80
MAX_NOTE = 1000
MAX_CHANNEL = 80
MAX_IGNORE = 20
MAX_SELECTOR = 600
STATE_LABEL = {"pending": "First look", "ok": "No change", "changed": "Changed", "error": "Can't read",
               "blocked": "Blocked", "paused": "Paused"}
OUTCOME_LABEL = {"baseline": "First look", "same": "No change", "suspected": "Checking again",
                 "changed": "Changed", "glitch": "Glitch, ignored", "error": "Couldn't read",
                 "blocked": "Bot check", "interrupted": "Interrupted", None: "Running"}
IMPORTANCE_LABEL = {"important": "Important", "worth_a_look": "Worth a look", "minor": "Minor"}


class Busy(RuntimeError):
    """The watch is being read right now; the change would race the check."""


class Invalid(ValueError):
    """A sentence the page can show next to the field."""

    def __init__(self, field, message):
        super().__init__(message)
        self.field = field


def _now():
    return datetime.now(timezone.utc)


def _text(data, key, limit, field_label):
    v = " ".join(str(data.get(key) or "").split())
    if len(v) > limit:
        raise Invalid(key, "%s can be at most %d characters." % (field_label, limit))
    return v


def _rects(raw):
    out = []
    for r in raw or []:
        try:
            x, y, w, h = (int(round(float(v))) for v in r)
        except (TypeError, ValueError):
            raise Invalid("ignore", "An ignored area is not a rectangle.")
        if w < 4 or h < 4 or x < 0 or y < 0 or x > 10000 or y > 40000:
            raise Invalid("ignore", "An ignored area is too small or off the page.")
        out.append([x, y, min(w, 10000), min(h, 40000)])
    if len(out) > MAX_IGNORE:
        raise Invalid("ignore", "At most %d ignored areas." % MAX_IGNORE)
    return out


def clean(data, *, partial=False):
    """The fields of a watch from a request body, checked. Raises Invalid."""
    out = {}
    if not partial or "url" in data:
        try:
            out["url"] = watch_safety.normalise(data.get("url") or "")
            watch_safety.check(out["url"])
        except watch_safety.BadURL as exc:
            raise Invalid("url", str(exc))
    if not partial or "name" in data:
        out["name"] = _text(data, "name", MAX_NAME, "The name")
    if not partial or "client" in data:
        out["client"] = _text(data, "client", MAX_CLIENT, "The client or group")
    if not partial or "instructions" in data:
        note = str(data.get("instructions") or "").strip()
        if len(note) > MAX_NOTE:
            raise Invalid("instructions", "The note can be at most %d characters." % MAX_NOTE)
        out["instructions"] = note
    if not partial or "channel" in data:
        ch = _text(data, "channel", MAX_CHANNEL, "The channel").lstrip("#")
        out["channel"] = ch
    if not partial or "schedule" in data:
        try:
            out["schedule"] = watch_schedule.normalise(data.get("schedule"))
        except ValueError as exc:
            raise Invalid("schedule", str(exc))
    for key in ("watch_text", "watch_visual"):
        if not partial or key in data:
            out[key] = bool(data.get(key, True))
    if out.get("watch_text") is False and out.get("watch_visual") is False:
        raise Invalid("watch_text", "Watch the text, the look, or both.")
    if not partial or "area_selector" in data:
        sel = str(data.get("area_selector") or "").strip()
        if len(sel) > MAX_SELECTOR or any(c in sel for c in "{}<"):
            raise Invalid("area_selector", "That area could not be used. Pick it again on the picture.")
        out["area_selector"] = sel or None
        out["area_label"] = _text(data, "area_label", 200, "The area's name") or None
    if not partial or "ignore" in data:
        out["ignore"] = _rects(data.get("ignore"))
    return out


# ── Watches ──────────────────────────────────────────────────────────────────
def create(email, data, space=None):
    """A new watch from a request body, saved to `space` (a client account's) or to the person's own
    General work. Returns its id. Raises Invalid."""
    from tracker import workspace
    fields = clean(data)
    if len(watch_store.list_targets(email)) >= cfg.MAX_WATCHES_PER_USER:
        raise Invalid("url", "You are watching %d pages, the most allowed. Remove one first."
                      % cfg.MAX_WATCHES_PER_USER)
    url = fields.pop("url")
    fields["space"] = space if workspace.is_account(space) else workspace.personal(email)
    return watch_store.create_target(email, url, **fields)


def default_name(url):
    from urllib.parse import urlsplit
    p = urlsplit(url)
    host = (p.hostname or "").removeprefix("www.")
    path = p.path.strip("/")
    return (host + (" / " + path.split("/")[-1].replace("-", " ") if path else ""))[:MAX_NAME]


# Changing any of these makes the old baseline a different view of the page:
# the next check starts again from a new first look (and calibration).
REBASELINE = ("url", "area_selector", "watch_text", "watch_visual")


def update(target_id, email, data):
    """Change a watch. Returns the updated watch, or None when it is not theirs.
    Raises Invalid. A change of link, area or what is compared starts again
    from a new first look; pausing and resuming are {"status": ...}."""
    t = watch_store.get_target(target_id, email)
    if not t:
        return None
    fields = clean(data, partial=True)
    if "status" in data:
        status = str(data.get("status"))
        if status not in ("active", "paused"):
            raise Invalid("status", "A watch is either active or paused.")
        fields["status"] = status
        if status == "active" and t.get("status") != "active":
            fields["next_check_at"] = _now()
    if "area_selector" in fields and fields["area_selector"] == t.get("area_selector"):
        fields.pop("area_selector")
    restart = any(k in fields and fields[k] != t.get(k) for k in REBASELINE)
    if restart and watch_store.leased(t):
        raise Busy("The page is being read right now. Try again in a few seconds.")
    if restart:
        stored = dict(t.get("settings") or {})
        for k in ("learned", "flaps", "calibrated_at", "calibration_reads"):
            stored.pop(k, None)
        fields.update(baseline_id=None, pending_id=None, state="pending", fail_count=0,
                      next_check_at=_now(), settings=stored)
    watch_store.update_target(target_id, email, **fields)
    return watch_store.get_target(target_id, email)


def check_now(target_id, email):
    t = watch_store.get_target(target_id, email)
    if not t:
        return False
    return watch_store.update_target(target_id, email, next_check_at=_now())


# ── What the pages show ──────────────────────────────────────────────────────
def image_url(image_id):
    return "%s/images/%d" % (BASE, image_id) if image_id else None


def _verdict_view(change):
    if not change:
        return None
    v = change.get("verdict") or {}
    return {"id": change["id"], "url": "%s/changes/%d" % (BASE, change["id"]),
            "summary": v.get("summary") or change.get("headline"), "headline": change.get("headline"),
            "importance": v.get("importance") or ("worth_a_look" if change.get("level") == "major" else "minor"),
            "importance_label": IMPORTANCE_LABEL.get(v.get("importance"), "Worth a look"
                                                     if change.get("level") == "major" else "Minor"),
            "category": v.get("category"), "muted": bool(v.get("muted")), "noise": bool(v.get("noise")),
            "judged_by": v.get("judged_by"), "feedback": change.get("feedback"),
            "created_at": change.get("created_at")}


def card(t):
    """One watch as the dashboard draws it."""
    paused = t.get("status") == "paused"
    state = "paused" if paused else (t.get("state") or "pending")
    try:
        schedule = watch_schedule.describe(t.get("schedule") or {})
    except ValueError:
        schedule = watch_schedule.describe({})
    checks = t.get("checks") or []
    last_error = next((c for c in checks if c.get("outcome") in ("error", "blocked")), None)
    return {"id": t["id"], "name": t.get("name") or default_name(t["url"]), "url": t["url"],
            "site": t.get("site") or "", "client": t.get("client") or "",
            "state": state, "state_label": STATE_LABEL.get(state, state.title()),
            "schedule": schedule, "area": t.get("area_label") or ("One area" if t.get("area_selector") else ""),
            "last_check_at": t.get("last_check_at"), "next_check_at": None if paused else t.get("next_check_at"),
            "last_change_at": t.get("last_change_at"), "thumb": image_url(t.get("thumb_id")),
            "strip": [{"o": c.get("outcome") or "running", "at": c.get("started_at"),
                       "label": OUTCOME_LABEL.get(c.get("outcome"), c.get("outcome"))} for c in reversed(checks)],
            "latest": _verdict_view(t.get("latest")),
            "problem": (last_error or {}).get("error") if state in ("error", "blocked") else None,
            "pending": bool(t.get("pending_id")), "fail_count": t.get("fail_count") or 0,
            "owner": t.get("email") or "", "space": t.get("space") or "",
            "url_page": "%s/watches/%d" % (BASE, t["id"])}


def dashboard(email, space=None):
    """A client account's board (everyone's watches for it), or with no space the person's own."""
    cards = [card(t) for t in watch_store.dashboard(email, space=space)]
    counts = {"all": len(cards)}
    for c in cards:
        counts[c["state"]] = counts.get(c["state"], 0) + 1
    clients = sorted({c["client"] for c in cards if c["client"]}, key=str.lower)
    return {"watches": cards, "counts": counts, "clients": clients}


def preview(target_id, email):
    """The watch's first reading, for the add flow and the area picker:
    {"ready": False, ...} until the worker has read it."""
    t = watch_store.get_target(target_id, email)
    if not t:
        return None
    checks = watch_store.list_checks(target_id, email, limit=3)
    last = checks[0] if checks else None
    out = {"id": t["id"], "state": t.get("state"), "ready": False, "checks": len(checks),
           "error": None, "url": t["url"], "name": t.get("name"), "reading": watch_store.leased(t)}
    if last and last.get("outcome") in ("error", "blocked") and not t.get("baseline_id"):
        out["error"] = {"kind": last.get("outcome"), "detail": last.get("error_detail") or last.get("error")}
    snap = watch_store.get_snapshot(t["baseline_id"], email) if t.get("baseline_id") else None
    # Ready only once the worker has finished (a first look goes on to read
    # the page twice more): settings saved before then would race it.
    if not snap or out["reading"]:
        return out
    data = snap.get("data") or {}
    blocks = data.get("blocks") or []
    out.update(ready=True, title=data.get("title") or "", final_url=data.get("final_url") or t["url"],
               engine=data.get("engine"), width=data.get("width"), height=data.get("height"),
               page_height=data.get("page_height"), shot=image_url(snap.get("shot_id")),
               hidden=data.get("hidden") or [], area_box=data.get("area_box"),
               words=sum(len((b.get("text") or "").split()) for b in blocks),
               blocks=[{"text": (b.get("text") or "")[:160], "tag": b.get("tag"), "box": b.get("box"),
                        "sel": b.get("sel"), "path": b.get("path")} for b in blocks[:4000] if b.get("box")],
               settings=t.get("settings") or {})
    return out


def area_from_rect(blocks, rect):
    """The page element that holds what a drawn rectangle covers.

    Each text block knows its unique selector, a path from the page's root
    ("main > section:nth-of-type(2) > div > p"). The blocks inside the
    rectangle share the start of that path; the shared part names their
    nearest common container, which the capture finds again on every visit
    even if it moves. Returns {"selector", "box", "label", "blocks"} or None.
    """
    x, y, w, h = rect

    def route(b):
        return b.get("path") or b.get("sel")
    inside = [b for b in blocks if b.get("box") and route(b)
              and x <= b["box"][0] + b["box"][2] / 2 <= x + w and y <= b["box"][1] + b["box"][3] / 2 <= y + h]
    if not inside:
        return None
    paths = [[p.strip() for p in route(b).split(">")] for b in inside]
    common = []
    for parts in zip(*paths):
        if len(set(parts)) != 1:
            break
        common.append(parts[0])
    if len(inside) == 1:
        common = paths[0]
    if not common or common == ["body"]:
        return None
    selector = " > ".join(common)
    under = [b for b in blocks if route(b) and (route(b) == selector or route(b).startswith(selector + " >"))]
    xs = [b["box"][0] for b in under] + [b["box"][0] + b["box"][2] for b in under]
    ys = [b["box"][1] for b in under] + [b["box"][1] + b["box"][3] for b in under]
    box = [min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)]
    first = next((b["text"] for b in sorted(under, key=lambda b: (b["box"][1], b["box"][0])) if b.get("text")), "")
    label = first[:60] + ("…" if len(first) > 60 else "")
    return {"selector": selector, "box": box, "label": label, "blocks": len(under)}


def timeline(target_id, email, limit=60):
    t = watch_store.get_target(target_id, email)
    if not t:
        return None
    from tracker import workspace
    rows = watch_store.dashboard(email, space=t["space"] if workspace.is_account(t.get("space")) else None)
    row = next((r for r in rows if r["id"] == target_id), None) or dict(t, checks=[], latest=None, thumb_id=None)
    view = card(row)
    view["checks"] = [{"id": c["id"], "outcome": c.get("outcome"),
                       "label": OUTCOME_LABEL.get(c.get("outcome"), c.get("outcome")),
                       "at": c.get("started_at"), "elapsed_ms": c.get("elapsed_ms"), "status": c.get("status"),
                       "detail": c.get("error_detail") if c.get("outcome") in (
                           "error", "blocked", "glitch", "suspected", "interrupted") else None,
                       "change": "%s/changes/%d" % (BASE, c["change_id"]) if c.get("change_id") else None}
                      for c in watch_store.list_checks(target_id, email, limit=limit)]
    view["changes"] = [_verdict_view(c) for c in watch_store.list_changes(target_id, email, limit=limit)]
    view.update(instructions=t.get("instructions") or "", channel=t.get("channel") or "",
                schedule_raw=t.get("schedule") or watch_schedule.DEFAULT, ignore=t.get("ignore") or [],
                area_selector=t.get("area_selector"), watch_text=t.get("watch_text", True),
                watch_visual=t.get("watch_visual", True), status=t.get("status"),
                muted=(t.get("settings") or {}).get("muted") or [])
    return view


def change_view(change_id, email):
    """Everything the change page shows."""
    c = watch_store.get_change(change_id, email)
    if not c:
        return None
    t = watch_store.get_target(c["target_id"], email)
    before = watch_store.get_snapshot(c["before_id"], email) if c.get("before_id") else None
    after = watch_store.get_snapshot(c["after_id"], email) if c.get("after_id") else None
    report = c.get("report") or {}
    text = report.get("text") or {}
    visual = report.get("visual") or {}
    v = _verdict_view(c)
    v.update(explanation=(c.get("verdict") or {}).get("explanation") or "",
             confidence=(c.get("verdict") or {}).get("confidence"),
             model=(c.get("verdict") or {}).get("model"))
    return {"id": c["id"], "watch": {"id": t["id"], "name": t.get("name") or default_name(t["url"]),
                                      "url": t["url"], "client": t.get("client") or "",
                                      "space": t.get("space") or "", "owner": t.get("email") or "",
                                      "page": "%s/watches/%d" % (BASE, t["id"])},
            "verdict": v, "created_at": c.get("created_at"),
            "before": {"shot": image_url((before or {}).get("shot_id")),
                       "width": ((before or {}).get("data") or {}).get("width"),
                       "height": ((before or {}).get("data") or {}).get("height")},
            "after": {"shot": image_url((after or {}).get("shot_id")),
                      "width": ((after or {}).get("data") or {}).get("width"),
                      "height": ((after or {}).get("data") or {}).get("height")},
            "composite": image_url(c.get("composite_id")),
            "boxes_before": visual.get("before") or [], "boxes_after": visual.get("after") or [],
            "areas": [{"box": a.get("box"), "label": a.get("label")} for a in report.get("areas") or []],
            "changed": [{"before": x.get("before"), "after": x.get("after"), "segments": x.get("segments") or []}
                        for x in (text.get("changed") or [])[:60]],
            "added": [x.get("text") for x in (text.get("added") or [])[:60]],
            "removed": [x.get("text") for x in (text.get("removed") or [])[:60]],
            "prices": text.get("prices") or [],
            "facts": report.get("facts") or {}, "headline": c.get("headline"),
            "share": visual.get("changed_share")}


def agent_status():
    """The strip at the top of the page: is the worker running, is Claude on."""
    from tracker import watch_worker
    try:
        health = watch_worker.health()
    except Exception:
        health = {"status": "unavailable", "workers": [], "queue": {}}
    return {"worker": health["status"], "queue": health.get("queue") or {}, "claude": watch_judge.status()}
