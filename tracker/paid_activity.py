"""Paid Marketing Agents: what each agent read inside a client workspace, for the workspace's History.

Most paid agents keep no runs: they read an ad account live (tracker/paid_gads.py, paid_meta.py) and the
reads are cached by account and day, not by who asked. A workspace's History still shows them, one row per
agent, ad account and day, from here: the first read of the day makes the row, a later one that day only
moves its time and detail on, so changing the date range ten times is one row, not ten.

    pm_activity   (space, agent, account, day) once each: who read it last, a title and a detail line

Outside a workspace nothing is recorded (the person's own General work has no History).
"""
from __future__ import annotations

import logging

from .market_radar_store import StoreUnavailable, _connect  # noqa: F401  (re-exported)

log = logging.getLogger(__name__)

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS pm_activity (
        id BIGSERIAL PRIMARY KEY,
        space TEXT NOT NULL,
        agent TEXT NOT NULL,
        account TEXT NOT NULL DEFAULT '',
        day DATE NOT NULL DEFAULT CURRENT_DATE,
        started_by TEXT,
        title TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (space, agent, account, day))""",
    "CREATE INDEX IF NOT EXISTS idx_pm_activity_space ON pm_activity (space, created_at DESC)",
]
_READY = False


def _ensure():
    global _READY
    if _READY:
        return
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(hashtext('pm-activity-v1'))")
            for statement in SCHEMA:
                cur.execute(statement)
        conn.commit()
    finally:
        conn.close()
    _READY = True


def _exec(sql, params=(), fetch=None):
    _ensure()
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall() if fetch == "all" else None
        conn.commit()
        return rows
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def record(space, agent, account, who, title, detail=""):
    """The day's row for this agent and account in the workspace, made or moved on to now."""
    _exec("""INSERT INTO pm_activity (space, agent, account, started_by, title, detail)
             VALUES (%s, %s, %s, %s, %s, %s)
             ON CONFLICT (space, agent, account, day) DO UPDATE SET started_by=EXCLUDED.started_by,
             title=EXCLUDED.title, detail=EXCLUDED.detail, created_at=now()""",
          (space, agent, account or "", who or None, (title or "")[:200], (detail or "")[:300]))


def space_rows(space, limit=50):
    """The workspace's rows, newest first: {agent, account, who, title, detail, at}."""
    rows = _exec("""SELECT agent, account, started_by, title, detail, created_at FROM pm_activity
                    WHERE space=%s ORDER BY created_at DESC LIMIT %s""", (space, int(limit)), fetch="all")
    return [{"agent": a, "account": acc, "who": who or "", "title": t, "detail": d, "at": at}
            for a, acc, who, t, d, at in rows]
