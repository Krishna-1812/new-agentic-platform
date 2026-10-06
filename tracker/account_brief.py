"""The AI's memory of a client account (docs/account-memory-plan.md, phase 4).

Before an AI run for an account, the account's earlier work is put into a short brief, so the AI picks
up where the team left off instead of starting cold: the last AI reviews' verdicts and actions, the page
changes Page Watch saw, the SEO & AEO runs and their findings, the agents' runs and the videos made.

The brief is built only from that account's space (tracker/workspace.py) and its own Google Ads
accounts' reviews. Nothing from another account, or from anyone's General work, can reach it: every
read below names the space, and build() refuses anything that is not an account's space.

build(space, ads_names=(), parts=PARTS, exclude=None) ->
    {"text", "sections": [{"key", "label", "items": [{"at", "who", "text"}]}], "built_at", "counts"}

`text` is what the AI is given; `sections` is what the run's page shows it was given. A part whose
records cannot be read is left out (and logged), never failing the run.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from tracker import workspace

log = logging.getLogger(__name__)

PARTS = ("reviews", "changes", "seo", "agents", "videos")
LABELS = {"reviews": "Earlier AI reviews", "changes": "Page changes seen", "seo": "SEO & AEO runs",
          "agents": "Agent runs", "videos": "Videos made"}
KEEP = {"reviews": 3, "changes": 10, "seo": 8, "agents": 8, "videos": 6}
MAX_CHARS = 12000           # the whole brief; the oldest items go first when it is over
ACTIONS = 6                 # actions kept from each earlier review


def _iso(v):
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()
    return str(v or "")


def _day(v):
    return _iso(v)[:10]


def _clip(text, n):
    text = " ".join(str(text or "").split())
    return text if len(text) <= n else text[:n - 1].rstrip() + "…"


def _item(at, who, text):
    return {"at": _iso(at), "who": (who or "").strip().lower(), "text": text}


# ── The parts ────────────────────────────────────────────────────────────────
OVERALL = {"on_track": "on track", "needs_attention": "needs attention", "off_track": "off track"}


def _reviews(space, ads_names, exclude):
    from tracker import gads_ai_store
    rows = []
    for name in ads_names:
        rows += [r for r in gads_ai_store.list_reviews(name, limit=10)
                 if r.get("status") == "complete" and r.get("id") != exclude]
    rows.sort(key=lambda r: _iso(r.get("created_at")), reverse=True)
    out = []
    for r in rows[:KEEP["reviews"]]:
        full = gads_ai_store.get_review(r["id"]) or {}
        rep = full.get("report") or {}
        lines = ["AI review of %s (covering %s to %s): %s. %s" % (
            r.get("account"), _day(r.get("period_from")) or "?", _day(r.get("period_to")) or "?",
            OVERALL.get(rep.get("overall"), rep.get("overall") or "no verdict"), _clip(rep.get("headline"), 300))]
        for s in (rep.get("scorecard") or [])[:8]:
            if isinstance(s, dict) and s.get("status") in ("at_risk", "off_track"):
                lines.append("  Objective %s: %s (target %s, actual %s)" % (
                    s.get("status").replace("_", " "), _clip(s.get("objective"), 120), _clip(s.get("target"), 60),
                    _clip(s.get("actual"), 60)))
        for a in (rep.get("actions") or [])[:ACTIONS]:
            if isinstance(a, dict):
                lines.append("  Action %s: %s — %s%s" % (
                    a.get("priority") or "", _clip(a.get("title"), 140), _clip(a.get("what_to_do"), 260),
                    (" (where: %s)" % _clip(a.get("where"), 80)) if a.get("where") else ""))
        out.append(_item(r.get("created_at"), r.get("email"), "\n".join(lines)))
    return out


def _changes(space):
    from tracker import watch_store, watch_web
    out = []
    for c in watch_store.space_changes(space, limit=40):
        v = watch_web._verdict_view(c)
        if v["muted"] or v["noise"]:
            continue
        out.append(_item(c.get("created_at"), "", "%s on %s (%s)" % (
            _clip(v["summary"] or "The page changed", 220), c.get("name") or watch_web.default_name(c["url"]),
            v["importance_label"].lower())))
        if len(out) >= KEEP["changes"]:
            break
    return out


def _seo(space):
    from tracker import seo_runs, seo_runs_store
    out = []
    for r in seo_runs_store.list_runs("", space=space, limit=KEEP["seo"]):
        s = r.get("summary") or {}
        facts = "; ".join("%s %s" % (k, v) for k, v in (s.get("facts") or []))
        top = "; ".join(s.get("highlights") or [])
        out.append(_item(r.get("created_at"), r.get("email"), "%s of %s%s%s" % (
            seo_runs.TOOLS.get(r["tool"], r["tool"]), _clip(r.get("title"), 160),
            (": " + _clip(facts, 260)) if facts else "", (". At the top: " + _clip(top, 300)) if top else "")))
    return out


def _agents(space):
    from tracker import account_history
    rows = []
    for name, read in account_history.AGENT_READS:
        if name == "seo":
            continue
        try:
            rows += read({"space": space, "slug": ""})
        except Exception:
            log.exception("account brief: %s unreadable", name)
    rows.sort(key=lambda r: r["at"], reverse=True)
    return [_item(r["at"], r.get("who"), "%s: %s%s (%s)" % (
        r["tool_label"], _clip(r["title"], 160), (" — " + _clip(r["detail"], 120)) if r.get("detail") else "",
        r["state_label"].lower())) for r in rows[:KEEP["agents"]]]


def _videos(space, exclude_project=None):
    from tracker import video_app, video_starts, video_store
    out = []
    for p in video_store.library("", space=space, limit=KEEP["videos"] + 1, exclude_kinds=video_app.LIBRARY_HIDDEN):
        if p["id"] == exclude_project:
            continue
        v = p.get("ready") or p.get("latest") or {}
        out.append(_item(p.get("created_at"), p.get("email"), "%s video%s: %s%s" % (
            (video_starts.STARTS.get(p.get("kind")) or ("Custom",))[0],
            (", %ss" % int(v["duration_s"])) if v.get("duration_s") else "", _clip(p.get("brief"), 220),
            (" — idea: " + _clip(v["idea"], 160)) if v.get("idea") else "")))
    return out[:KEEP["videos"]]


# ── The brief ────────────────────────────────────────────────────────────────
def _who(items):
    from tracker import people_store
    known = people_store.names([i["who"] for i in items if i["who"]])
    for i in items:
        i["by"] = people_store.display(i["who"], known) if i["who"] else ""


def _render(sections):
    if not sections:
        return ""
    out = ["What the team has already done for this client, newest first. Build on it; do not repeat it."]
    for s in sections:
        out += ["", "## " + s["label"]]
        for i in s["items"]:
            out.append("- [%s%s] %s" % (_day(i["at"]), (", by " + i["by"]) if i["by"] else "", i["text"]))
    return "\n".join(out)


def build(space, ads_names=(), parts=PARTS, exclude=None, exclude_project=None):
    """The account's brief. `exclude` is the review being written (never its own memory),
    `exclude_project` the video being planned."""
    if not workspace.is_account(space):
        raise ValueError("a brief is built only from a client account's space: %r" % (space,))
    reads = {"reviews": lambda: _reviews(space, ads_names, exclude), "changes": lambda: _changes(space),
             "seo": lambda: _seo(space), "agents": lambda: _agents(space),
             "videos": lambda: _videos(space, exclude_project)}
    sections = []
    for key in parts:
        try:
            items = reads[key]()
        except Exception:
            log.exception("account brief: %s unreadable", key)
            continue
        if items:
            sections.append({"key": key, "label": LABELS[key], "items": items})
    try:
        _who([i for s in sections for i in s["items"]])
    except Exception:
        log.exception("account brief: names unreadable")
        for s in sections:
            for i in s["items"]:
                i["by"] = ""
    text = _render(sections)
    while len(text) > MAX_CHARS and sections:     # the oldest item of the longest part goes first
        longest = max(sections, key=lambda s: sum(len(i["text"]) for i in s["items"]))
        longest["items"].pop()
        sections = [s for s in sections if s["items"]]
        text = _render(sections)
    return {"text": text, "sections": sections, "built_at": datetime.now(timezone.utc).isoformat(),
            "counts": {s["key"]: len(s["items"]) for s in sections}}


def shown(brief):
    """What a run's page shows it was given: the sections without the addresses."""
    if not brief:
        return None
    return {"built_at": brief.get("built_at"), "counts": brief.get("counts") or {},
            "sections": [{"key": s["key"], "label": s["label"],
                          "items": [{"at": i["at"], "by": i.get("by", ""), "text": i["text"]} for i in s["items"]]}
                         for s in brief.get("sections") or []]}
