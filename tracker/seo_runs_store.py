"""Storage for SEO & AEO tool runs (tracker/seo_runs.py), by space (tracker/workspace.py).

Postgres when DATABASE_URL is set, an in-process store otherwise (tests, local runs). Every read
names its space or its viewer: get(id, email) reaches the viewer's own runs and client accounts'
runs, list_runs(email, space) a client account's runs or the viewer's own General ones.
"""

from __future__ import annotations

import contextlib
import copy
import json
import os
import threading
from datetime import datetime, timezone

from tracker import workspace

_MEM = {"runs": {}, "next": 1}
_MEM_LOCK = threading.Lock()
_READY = False
_COLS = "id, space, email, tool, title, summary, input, created_at"


def backend():
    return "postgres" if os.environ.get("DATABASE_URL") else "memory"


def reset_memory():
    with _MEM_LOCK:
        _MEM.update(runs={}, next=1)


def _norm(email):
    return (email or "").strip().lower()


@contextlib.contextmanager
def _pg():
    global _READY
    import psycopg2
    conn = psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=8)
    try:
        if not _READY:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS seo_runs (
                        id SERIAL PRIMARY KEY,
                        space TEXT NOT NULL,
                        email TEXT NOT NULL,
                        tool TEXT NOT NULL,
                        title TEXT NOT NULL DEFAULT '',
                        summary JSONB NOT NULL DEFAULT '{}'::jsonb,
                        input JSONB NOT NULL DEFAULT '{}'::jsonb,
                        output JSONB,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
                cur.execute("CREATE INDEX IF NOT EXISTS seo_runs_space ON seo_runs (space, created_at DESC)")
                cur.execute("CREATE INDEX IF NOT EXISTS seo_runs_email ON seo_runs (email, created_at DESC)")
            conn.commit()
            _READY = True
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _row(cur, r):
    d = dict(zip([c[0] for c in cur.description], r))
    if isinstance(d.get("created_at"), datetime):
        d["created_at"] = d["created_at"].isoformat()
    return d


def add(email, space, tool, title, summary, inp, output):
    email = _norm(email)
    if backend() == "memory":
        with _MEM_LOCK:
            rid = _MEM["next"]
            _MEM["next"] += 1
            _MEM["runs"][rid] = {"id": rid, "space": space, "email": email, "tool": tool, "title": title,
                                 "summary": copy.deepcopy(summary), "input": copy.deepcopy(inp),
                                 "output": copy.deepcopy(output),
                                 "created_at": datetime.now(timezone.utc).isoformat()}
            return rid
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO seo_runs (space, email, tool, title, summary, input, output) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                    (space, email, tool, title, json.dumps(summary), json.dumps(inp),
                     json.dumps(output, default=str) if output is not None else None))
        return cur.fetchone()[0]


def get(run_id, email, with_output=False):
    """One run the viewer may reach (their own, or a client account's), or None."""
    if backend() == "memory":
        with _MEM_LOCK:
            r = _MEM["runs"].get(run_id)
            if not r or not workspace.mem_seen(r, email):
                return None
            out = copy.deepcopy(r)
            if not with_output:
                out.pop("output", None)
            return out
    cols = _COLS + (", output" if with_output else "")
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("SELECT %s FROM seo_runs WHERE id = %%s AND %s" % (cols, workspace.seen_sql()),
                    (run_id, _norm(email)))
        r = cur.fetchone()
        return _row(cur, r) if r else None


def list_runs(email, space=None, tool=None, limit=60):
    """A client account's runs (everyone's), or with no space the viewer's own General ones."""
    where, args = workspace.list_sql(_norm(email), space)
    if backend() == "memory":
        with _MEM_LOCK:
            rows = [copy.deepcopy(r) for r in _MEM["runs"].values()
                    if workspace.mem_listed(r, _norm(email), space) and (tool is None or r["tool"] == tool)]
        for r in rows:
            r.pop("output", None)
        return sorted(rows, key=lambda r: r["id"], reverse=True)[:limit]
    if tool is not None:
        where, args = where + " AND tool = %s", args + [tool]
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("SELECT %s FROM seo_runs WHERE %s ORDER BY created_at DESC LIMIT %%s" % (_COLS, where),
                    args + [limit])
        return [_row(cur, r) for r in cur.fetchall()]


def delete(run_id, email):
    """Remove a run: only its maker can."""
    if backend() == "memory":
        with _MEM_LOCK:
            r = _MEM["runs"].get(run_id)
            if not r or r["email"] != _norm(email):
                return False
            del _MEM["runs"][run_id]
            return True
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM seo_runs WHERE id = %s AND email = %s", (run_id, _norm(email)))
        return cur.rowcount > 0
