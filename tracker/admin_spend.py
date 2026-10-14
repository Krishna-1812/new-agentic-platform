"""Admin panel: what the agents cost, by agent, by workspace and by person.

Every agent that spends money keeps its own ledger, in its own table, in its own shape. This module is
the one place that reads them all, read-only, and folds them into one list of rows:

    {"agent": "market-radar", "email": "who@x.com", "space": "acct:7" | "", "usd": 0.0123, "at": datetime}

`space` is the client account's space ("acct:<id>") when the work was done for a client account, and ""
for a person's own General work. `email` is the person who ran it; it is "" where an agent files a client
account's work under the account alone and kept no name.

    collect(since)    read every ledger from `since` on. Never raises: a ledger that cannot be read is
                      reported with its reason, and a ledger whose table does not exist yet (an agent
                      nobody has used) is reported as having no runs. Nothing here creates a table.
    rollup(rows, ...) fold the rows into the totals the admin panel shows. Pure, no database.

What is counted is what each agent's own page shows as its cost. Market Radar counts a call it could not
measure at its reservation (see tracker/market_radar_ledger.py), so this does too.
Apollo and Event Intelligence spend credits, not dollars; they are kept apart (`unit` = "credits") and are
never added to a dollar total.
"""
from __future__ import annotations

import logging
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

ACCOUNT = "acct:"
GENERAL = ""

# slug, label, unit, SQL. Each SQL takes %(since)s and returns (owner, started_by, space, amount, at).
# `to_jsonb(t)->>'col'` reads a column that older databases may not have yet, as NULL, instead of failing.
SOURCES = (
    ("market-radar", "Market Radar", "usd", """
        SELECT r.owner_email, to_jsonb(r)->>'started_by', NULL::text,
               CASE WHEN p.status IN ('done', 'failed') THEN COALESCE(p.actual_usd, 0)
                    ELSE COALESCE(p.reserved_usd, 0) END, p.created_at
          FROM mr_provider_calls p JOIN mr_runs r ON r.id = p.run_id
         WHERE p.created_at >= %(since)s"""),
    ("local-business-radar", "Local Business Radar", "usd", """
        SELECT r.email, NULL::text, to_jsonb(r)->>'space', c.usd, c.at
          FROM lbr_calls c JOIN lbr_runs r ON r.id = c.run_id
         WHERE c.at >= %(since)s AND c.usd > 0"""),
    ("social-media-intelligence", "Social Media Intelligence", "usd", """
        SELECT r.email, NULL::text, to_jsonb(r)->>'space', l.cost_usd, l.created_at
          FROM sci_spend_log l LEFT JOIN sci_runs r ON r.id = l.run_id
         WHERE l.created_at >= %(since)s AND l.cost_usd > 0"""),
    ("account-mapper", "Account Mapper", "usd", """
        SELECT owner_email, to_jsonb(am_runs)->>'started_by', NULL::text, spent_usd, created_at
          FROM am_runs WHERE created_at >= %(since)s AND spent_usd > 0"""),
    ("contact-lab", "Contact Lab", "usd", """
        SELECT owner_email, NULL::text, NULL::text, spent_usd, created_at
          FROM cl_runs WHERE created_at >= %(since)s AND spent_usd > 0"""),
    ("video-studio", "Video Studio", "usd", """
        SELECT COALESCE(NULLIF(c.email, ''), p.email), NULL::text, to_jsonb(p)->>'space', c.cost_usd, c.created_at
          FROM video_ai_calls c LEFT JOIN video_projects p ON p.id = c.project_id
         WHERE c.created_at >= %(since)s AND c.cost_usd > 0"""),
    ("page-watch", "Page Watch", "usd", """
        SELECT COALESCE(NULLIF(c.email, ''), t.email), NULL::text, to_jsonb(t)->>'space', c.cost_usd, c.created_at
          FROM watch_ai_calls c LEFT JOIN watch_targets t ON t.id = c.target_id
         WHERE c.created_at >= %(since)s AND c.cost_usd > 0"""),
    ("google-ads-ai-review", "Google Ads AI review", "usd", """
        SELECT email, NULL::text, NULL::text, NULLIF(cost->>'usd', '')::numeric, created_at
          FROM gads_ai_reviews
         WHERE created_at >= %(since)s AND COALESCE(NULLIF(cost->>'usd', '')::numeric, 0) > 0"""),
    ("event-intelligence", "Event & Conference Intelligence", "credits", """
        SELECT email, NULL::text, to_jsonb(evi_runs)->>'space', credits_spent, created_at
          FROM evi_runs WHERE created_at >= %(since)s AND credits_spent > 0"""),
    ("contact-finder", "Contact Finder", "credits", """
        SELECT email, NULL::text, NULL::text, credits, created_at
          FROM cpi_credit_ledger WHERE created_at >= %(since)s AND credits > 0"""),
)
LABELS = {s[0]: s[1] for s in SOURCES}
UNITS = {s[0]: s[2] for s in SOURCES}


def _connect():
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        return None
    from tracker import db_pool
    return db_pool.connect(url, connect_timeout=8)


def _who(owner, started_by, space):
    """(email, space) of one ledger row. A client account's work is filed under the account; the person
    who started it is `started_by` where the agent kept one."""
    owner, started_by, space = (owner or "").strip(), (started_by or "").strip().lower(), (space or "").strip()
    if space.startswith(ACCOUNT):
        return (owner.lower() if "@" in owner else started_by), space
    if owner.startswith(ACCOUNT):
        return started_by, owner
    return owner.lower(), GENERAL


def collect(since, *, sources=SOURCES):
    """{"rows": [...], "sources": [{"agent", "label", "unit", "ok", "runs", "note"}]} from `since` on."""
    rows, report = [], []
    try:
        conn = _connect()
    except Exception as exc:
        logger.warning("admin spend: no database: %s", exc)
        conn = None
    if conn is None:
        return {"rows": [], "sources": [{"agent": s[0], "label": s[1], "unit": s[2], "ok": False, "runs": 0,
                                          "note": "The database could not be reached."} for s in sources]}
    try:
        for slug, label, unit, sql in sources:
            entry = {"agent": slug, "label": label, "unit": unit, "ok": True, "runs": 0, "note": ""}
            try:
                with conn.cursor() as cur:
                    cur.execute(sql, {"since": since})
                    got = cur.fetchall()
                conn.commit()
                for owner, by, space, amount, at in got:
                    email, sp = _who(owner, by, space)
                    rows.append({"agent": slug, "unit": unit, "email": email, "space": sp,
                                 "usd": float(amount or 0), "at": at})
                entry["runs"] = len(got)
            except Exception as exc:
                try:
                    conn.rollback()
                except Exception:
                    pass
                if getattr(exc, "pgcode", None) == "42P01":      # undefined_table: nobody has used this agent
                    entry["note"] = "No runs recorded yet."
                else:
                    logger.warning("admin spend: %s unreadable: %s", slug, exc)
                    entry.update(ok=False, note="Could not be read: %s" % str(exc).strip().splitlines()[0][:140])
            report.append(entry)
    finally:
        try:
            conn.close()
        except Exception:
            pass
    return {"rows": rows, "sources": report}


# == folding the rows into the panel's numbers ==================================================

def _r(x, places=4):
    return round(float(x or 0), places)


def _day(at):
    return at.astimezone(timezone.utc).date() if at.tzinfo else at.date()


def _top(counter):
    return max(counter.items(), key=lambda kv: kv[1])[0] if counter else ""


def rollup(rows, *, days=30, now=None, names=None, workspaces=None, top=12):
    """The panel's spend numbers for the last `days` days, with the `days` before them for comparison.

    rows         collect()["rows"]
    names        {email: person's name}
    workspaces   {space: account name}; a space missing here is shown as "Removed account"
    Dollar rows only: credit rows (unit "credits") are totalled on their own under "credits".
    """
    now = now or datetime.now(timezone.utc)
    names, workspaces = names or {}, workspaces or {}
    start = (now - timedelta(days=days)).date()
    prev_start = (now - timedelta(days=2 * days)).date()
    today = now.date()
    cur = [r for r in rows if r["unit"] == "usd" and start < _day(r["at"]) <= today]
    prev = [r for r in rows if r["unit"] == "usd" and prev_start < _day(r["at"]) <= start]
    total, prev_total = sum(r["usd"] for r in cur), sum(r["usd"] for r in prev)

    series = {start + timedelta(days=i + 1): 0.0 for i in range(days)}
    by_agent_day = defaultdict(lambda: defaultdict(float))
    for r in cur:
        series[_day(r["at"])] += r["usd"]
        by_agent_day[r["agent"]][_day(r["at"])] += r["usd"]

    def group(key_of):
        out = defaultdict(lambda: {"usd": 0.0, "calls": 0, "agents": defaultdict(float),
                                   "people": defaultdict(float), "spaces": defaultdict(float), "last": None})
        for r in cur:
            g = out[key_of(r)]
            g["usd"] += r["usd"]
            g["calls"] += 1
            g["agents"][r["agent"]] += r["usd"]
            g["people"][r["email"]] += r["usd"]
            g["spaces"][r["space"]] += r["usd"]
            g["last"] = max(g["last"], r["at"]) if g["last"] else r["at"]
        return out

    def share(usd):
        return _r(100.0 * usd / total, 1) if total else 0.0

    agents = []
    for slug, g in sorted(group(lambda r: r["agent"]).items(), key=lambda kv: -kv[1]["usd"]):
        agents.append({"agent": slug, "label": LABELS.get(slug, slug), "usd": _r(g["usd"]), "share": share(g["usd"]),
                       "calls": g["calls"], "people": len({e for e in g["people"] if e}),
                       "workspaces": len({s for s in g["spaces"] if s}),
                       "spark": [_r(by_agent_day[slug].get(d, 0.0)) for d in sorted(series)]})
    spaces = []
    for space, g in sorted(group(lambda r: r["space"]).items(), key=lambda kv: -kv[1]["usd"]):
        general = space == GENERAL
        spaces.append({"space": space, "general": general,
                       "name": "General (personal work)" if general else workspaces.get(space, "Removed account"),
                       "usd": _r(g["usd"]), "share": share(g["usd"]), "calls": g["calls"],
                       "people": len({e for e in g["people"] if e}), "top_agent": _top(g["agents"]),
                       "agents": {a: _r(v) for a, v in sorted(g["agents"].items(), key=lambda kv: -kv[1])},
                       "last": g["last"].isoformat() if g["last"] else None})
    people = []
    for email, g in sorted(group(lambda r: r["email"]).items(), key=lambda kv: -kv[1]["usd"]):
        people.append({"email": email, "name": (names.get(email) or "").strip() or (
                           email.split("@")[0].replace(".", " ").title() if email else "Not recorded"),
                       "recorded": bool(email), "usd": _r(g["usd"]), "share": share(g["usd"]), "calls": g["calls"],
                       "top_agent": _top(g["agents"]), "workspaces": len({s for s in g["spaces"] if s}),
                       "agents": {a: _r(v) for a, v in sorted(g["agents"].items(), key=lambda kv: -kv[1])},
                       "last": g["last"].isoformat() if g["last"] else None})

    # The heat grid: the costliest workspaces against the agents that cost anything.
    live_agents = [a["agent"] for a in agents]
    grid = {"agents": [{"agent": a, "label": LABELS.get(a, a)} for a in live_agents],
            "rows": [{"space": s["space"], "name": s["name"], "total": s["usd"],
                      "cells": [s["agents"].get(a, 0.0) for a in live_agents]} for s in spaces[:top]]}

    credits = defaultdict(float)
    for r in rows:
        if r["unit"] == "credits" and start < _day(r["at"]) <= today:
            credits[r["agent"]] += r["usd"]

    return {
        "days": days,
        "total": _r(total), "previous": _r(prev_total),
        "change_pct": _r(100.0 * (total - prev_total) / prev_total, 1) if prev_total else None,
        "calls": len(cur),
        "per_day": _r(total / days),
        "projected_month": _r(total / days * 30),
        "today": _r(series.get(today, 0.0)),
        "series": [{"day": d.isoformat(), "usd": _r(v)} for d, v in sorted(series.items())],
        "agents": agents, "workspaces": spaces[:top * 3], "people": people[:top * 3], "grid": grid,
        "workspace_count": len([s for s in spaces if not s["general"]]),
        "credits": [{"agent": a, "label": LABELS.get(a, a), "credits": int(v)}
                    for a, v in sorted(credits.items(), key=lambda kv: -kv[1])],
    }


def panel(days=30, *, now=None, names_of=None, workspaces=None, sources=SOURCES):
    """collect() and rollup() together, for the admin panel: the numbers plus which ledgers were read.
    names_of(emails) -> {email: name} looks people up once the rows are known."""
    now = now or datetime.now(timezone.utc)
    got = collect(now - timedelta(days=2 * days + 1), sources=sources)
    names = {}
    if names_of is not None:
        try:
            names = names_of(sorted({r["email"] for r in got["rows"] if r["email"]})) or {}
        except Exception:
            logger.exception("admin spend: names could not be read")
    out = rollup(got["rows"], days=days, now=now, names=names, workspaces=workspaces)
    out["sources"] = got["sources"]
    out["missing"] = [s["label"] for s in got["sources"] if not s["ok"]]
    return out
