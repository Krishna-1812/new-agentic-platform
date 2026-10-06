"""An account's History: everything the team has done for one client account, newest first, each with
who did it and when (docs/account-memory-plan.md).

It is read from each tool's own records, never copied into a log of its own, so it cannot drift from
them: Page Watch's watches and the changes they found, Video Studio's videos and the AI reviews of the
account's Google Ads accounts. Every read names the account's space (or its Google Ads accounts), so
nothing from another account, or from anyone's General work, is ever listed. Staff only.

entries(acct) -> [{"tool", "kind", "title", "detail", "who", "at", "href", "state", "state_label"}]
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger(__name__)

TOOLS = {"page-watch": "Page Watch", "video-studio": "Video Studio", "ai-review": "AI review"}
LIMIT = 60


def _iso(v):
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()
    return str(v or "")


def _watches(acct):
    from tracker import watch_store, watch_web
    out = []
    for t in watch_store.space_targets(acct["space"], limit=LIMIT):
        archived = bool(t.get("archived_at"))
        out.append({"tool": "page-watch", "kind": "watch", "who": t.get("email") or "", "at": _iso(t.get("created_at")),
                    "title": "Started watching " + (t.get("name") or watch_web.default_name(t["url"])),
                    "detail": t.get("site") or t["url"],
                    "href": None if archived else "/%s/page-watch/watches/%d" % (acct["slug"], t["id"]),
                    "state": "archived" if archived else (t.get("status") if t.get("status") == "paused" else ""),
                    "state_label": "Removed" if archived else ("Paused" if t.get("status") == "paused" else "")})
    for c in watch_store.space_changes(acct["space"], limit=LIMIT):
        v = watch_web._verdict_view(c)
        if v["muted"] or v["noise"]:
            continue
        out.append({"tool": "page-watch", "kind": "change", "who": "", "at": _iso(c.get("created_at")),
                    "title": v["summary"] or "The page changed",
                    "detail": "On " + (c.get("name") or watch_web.default_name(c["url"])),
                    "href": "/%s/page-watch/changes/%d" % (acct["slug"], c["id"]),
                    "state": "changed" if v["importance"] != "minor" else "", "state_label": v["importance_label"]})
    return out


def _videos(acct, library):
    out = []
    for v in library:
        out.append({"tool": "video-studio", "kind": "video", "who": v.get("owner") or "", "at": _iso(v.get("created_at")),
                    "title": v.get("brief") or "A video", "href": v.get("url"),
                    "detail": " · ".join(x for x in (v.get("kind_label"), v.get("shape_label")) if x),
                    "state": v.get("status") or "", "state_label": v.get("status_label") or "",
                    "cover": v.get("cover")})
    return out


def _reviews(acct):
    from tracker import client_accounts, gads_ai_store
    out = []
    for name in acct.get("ads_names") or []:
        for r in gads_ai_store.list_reviews(name, limit=20):
            label = {"complete": "Done", "failed": "Failed"}.get(r.get("status"), "Running")
            period = " to ".join(x for x in (client_accounts.nice_day(r.get("period_from")),
                                             client_accounts.nice_day(r.get("period_to"))) if x)
            href = "/%s/google-ads/ai-review" % acct["slug"]
            if len(acct["ads_names"]) > 1:
                from urllib.parse import quote
                href += "?account=" + quote(name)
            out.append({"tool": "ai-review", "kind": "review", "who": r.get("email") or "", "at": _iso(r.get("created_at")),
                        "title": "AI review of " + name, "detail": ("Covering " + period) if period else "",
                        "href": href, "state": r.get("status") or "", "state_label": label})
    return out


def entries(acct, library=None, limit=LIMIT):
    """The account's History, newest first. A tool whose records cannot be read is left out (and
    logged) rather than failing the page."""
    rows = []
    for name, read in (("page-watch", lambda: _watches(acct)), ("video-studio", lambda: _videos(acct, library or [])),
                       ("ai-review", lambda: _reviews(acct))):
        try:
            rows += read()
        except Exception:
            log.exception("account history: %s unreadable", name)
    rows.sort(key=lambda r: r["at"], reverse=True)
    for r in rows:
        r["tool_label"] = TOOLS[r["tool"]]
    return rows[:limit]


def summary(rows):
    """What the History's filter offers: [{"key", "label", "n"}] per tool, and the people in it."""
    tools = [{"key": k, "label": lab, "n": sum(1 for r in rows if r["tool"] == k)} for k, lab in TOOLS.items()]
    people = sorted({r["by"] for r in rows if r.get("by")})
    return {"tools": [t for t in tools if t["n"]], "people": people}
