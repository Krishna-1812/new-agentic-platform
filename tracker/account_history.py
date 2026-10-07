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

TOOLS = {"page-watch": "Page Watch", "video-studio": "Video Studio", "ai-review": "AI review", "agents": "Agents",
         "seo": "SEO & AEO"}
LIMIT = 60                # each tool's records read
SHOWN = 200               # the History's rows, all tools together (the page shows 40 at a time)


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


# ── The agents (phase 2) ─────────────────────────────────────────────────────
STATE = {"complete": ("ready", "Done"), "done": ("ready", "Done"), "confirmed": ("ready", "Done"),
         "failed": ("failed", "Failed"), "error": ("failed", "Failed"), "cancelled": ("", "Stopped"),
         "needs_review": ("changed", "Needs a look")}


def _state(status):
    return STATE.get(status or "", ("running", "Running"))


AGENT_NAMES = {"local-business-radar": "Local Business Radar", "social-media-intelligence": "Social Media Intelligence",
               "event-conference-intelligence": "Event & Conference Intelligence",
               "thought-leader-pr": "Thought Leader Intelligence", "company-people-intelligence": "Contact Finder"}


def agent_entry(acct, agent, title, detail, who, at, status, href=None):
    """One agent run as a History row (also used for Contact Finder's, read in app.py)."""
    st, label = _state(status)
    return {"tool": "agents", "kind": "run", "agent": agent, "who": who or "", "at": _iso(at), "title": title,
            "detail": detail, "href": href or "/%s/agents/%s" % (acct["slug"], agent), "state": st,
            "state_label": label, "tool_label": AGENT_NAMES[agent]}


_agent = agent_entry


def _lbr(acct):
    from tracker import lbr_store
    out = []
    for r in lbr_store.list_runs("", limit=LIMIT, space=acct["space"]):
        plan = r.get("plan") or {}
        label = (plan.get("business") or {}).get("label") or r.get("business_type") or "Businesses"
        area = (plan.get("area") or {}).get("formatted") or r.get("location") or ""
        found = (r.get("summary") or {}).get("found")
        out.append(_agent(acct, "local-business-radar", "%s in %s" % (label, area),
                          ("%d businesses found" % found) if found else "", r.get("email"), r.get("created_at"),
                          r.get("status"), "/strategic-agents/local-business-radar/runs/%d/report" % r["id"]))
    return out


def _smi(acct):
    from tracker import sci_store
    return [_agent(acct, "social-media-intelligence", r.get("company_name") or "A company",
                   r.get("company_url") or "", r.get("email"), r.get("created_at"), r.get("status"))
            for r in sci_store.list_runs("", limit=LIMIT, space=acct["space"])]


EVI_KINDS = {"recommend": "Scored calendar", "lookup": "Event roster", "workroom": "Room worked",
             "discover": "Audience search"}


def _evi(acct):
    from tracker import event_intel_store
    return [_agent(acct, "event-conference-intelligence",
                   "%s: %s" % (EVI_KINDS.get(r.get("mode"), "Event run"), r.get("event_name") or r.get("query") or ""),
                   ("%d listed" % r["participant_count"]) if r.get("participant_count") else "",
                   r.get("email"), r.get("created_at"), r.get("status"))
            for r in event_intel_store.list_runs("", limit=LIMIT, space=acct["space"])]


def _tlpr(acct):
    from tracker import thought_leader_pr
    out = []
    for r in thought_leader_pr.list_runs("", limit=LIMIT, space=acct["space"]):
        who = r.get("identity") or {}
        out.append(_agent(acct, "thought-leader-pr", r.get("input_name") or "A person",
                          " · ".join(x for x in (who.get("title"), who.get("company")) if x) if isinstance(who, dict) else "",
                          r.get("email"), r.get("created_at"), r.get("status")))
    return out


# ── The SEO & AEO tools (phase 3) ────────────────────────────────────────────
def _seo(acct):
    from tracker import seo_runs, seo_runs_store
    out = []
    for r in seo_runs_store.list_runs("", space=acct["space"], limit=LIMIT):
        facts = (r.get("summary") or {}).get("facts") or []
        out.append({"tool": "seo", "kind": "run", "seo_tool": r["tool"], "who": r.get("email") or "",
                    "at": _iso(r.get("created_at")), "title": r.get("title") or seo_runs.TOOLS.get(r["tool"], ""),
                    "detail": " · ".join("%s %s" % (k, v) for k, v in facts[:2]),
                    "href": "/%s/seo-aeo/runs/%d" % (acct["slug"], r["id"]), "state": "ready", "state_label": "Done",
                    "tool_label": seo_runs.TOOLS.get(r["tool"], "SEO & AEO")})
    return out


AGENT_READS = (("seo", _seo), ("local-business-radar", _lbr), ("social-media-intelligence", _smi),
               ("event-conference-intelligence", _evi), ("thought-leader-pr", _tlpr))


def entries(acct, library=None, limit=SHOWN, extra=()):
    """The account's History, newest first. A tool whose records cannot be read is left out (and
    logged) rather than failing the page. `extra` is rows read elsewhere (Contact Finder's, in
    app.py), in the same shape."""
    rows = list(extra)
    reads = [("page-watch", lambda: _watches(acct)), ("video-studio", lambda: _videos(acct, library or [])),
             ("ai-review", lambda: _reviews(acct))] + [(n, (lambda f=f: f(acct))) for n, f in AGENT_READS]
    for name, read in reads:
        try:
            rows += read()
        except Exception:
            log.exception("account history: %s unreadable", name)
    rows.sort(key=lambda r: r["at"], reverse=True)
    for r in rows:
        r["tool_label"] = r.get("tool_label") or TOOLS[r["tool"]]
    return rows[:limit]


# ── What a client sees ───────────────────────────────────────────────────────
# Only the tools the account shares with its clients (tracker/client_access.py: each tool's own switch),
# and AI reviews only when it shares its AI review, whose page is then the link. Finished work only,
# without who did it or links into the agency's tools.
CLIENT_KEEP_STATES = {"page-watch": {"", "paused", "changed"}, "video-studio": {"ready"}, "ai-review": {"complete"},
                      "agents": {"ready"}, "seo": {"ready"}}
CLIENT_KEYS = ("tool", "kind", "title", "detail", "at", "state", "state_label", "tool_label")


def tool_slug(row):
    """The tool a row belongs to, as the Share panel names it: page-watch, video-studio, an agent's slug
    or an SEO & AEO tool's slug ("" for an AI review)."""
    if row["tool"] in ("page-watch", "video-studio"):
        return row["tool"]
    return row.get("agent") or row.get("seo_tool") or ""


def for_client(rows, slug, tools=(), review_shared=False):
    tools = set(tools)
    out = []
    for r in rows:
        if r["tool"] == "ai-review":
            if not review_shared:
                continue
        elif tool_slug(r) not in tools:
            continue
        if r.get("state") not in CLIENT_KEEP_STATES.get(r["tool"], ()):
            continue
        row = {k: r.get(k) for k in CLIENT_KEYS}
        row.update(who="", by="", href="/%s/google-ads/ai-review" % slug if r["tool"] == "ai-review" else None)
        if r["tool"] == "ai-review":
            row["state"], row["state_label"] = "", ""
        out.append(row)
    return out


def summary(rows):
    """What the History's filter offers: [{"key", "label", "n"}] per tool, the people in it, and whether
    any of it is automatic (found by Page Watch on its own, with nobody's name)."""
    tools = [{"key": k, "label": lab, "n": sum(1 for r in rows if r["tool"] == k)} for k, lab in TOOLS.items()]
    people = sorted({r["by"] for r in rows if r.get("by")})
    return {"tools": [t for t in tools if t["n"]], "people": people,
            "automatic": any(not r.get("by") for r in rows)}
