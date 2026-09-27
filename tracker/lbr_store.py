"""Local Business Radar: storage for runs, their businesses and their spend.

Postgres when DATABASE_URL is set (Railway: a run must survive the next
deploy, and the web process has no persistent disk), an in-process store
otherwise, so local runs and the test suite need no database. Both backends
expose the same functions and return the same shapes.

Tables:
  lbr_runs        one row per request: the three inputs, where it has got
                  to, the resolved plan, the summary and the spend.
  lbr_stages      the finished result of each pipeline stage, so a run that
                  is interrupted resumes at the next stage instead of paying
                  for the finished ones again.
  lbr_businesses  one row per business a run found. `data` is a JSON object
                  each stage adds its own key to (profile, website, reviews,
                  visibility, score, pitch), merged rather than replaced.
  lbr_calls       one row per outside request, priced (tracker/lbr_http.py).

Every read a user can reach is scoped to the run owner's email in the query
itself, never fetched first and checked afterwards.

Retention (purge_expired): Google's Maps Platform terms allow keeping a place
ID indefinitely but restrict caching the rest of a place's content, so once a
run is older than lbr_config.retention_days() its businesses keep only their
place ID and scores, and its stage results are dropped.
"""

import contextlib
import copy
import json
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone

log = logging.getLogger(__name__)

RUN_FIELDS = ("status", "stage", "progress", "plan", "summary", "cost", "error",
              "heartbeat_at", "finished_at")
JSON_FIELDS = ("progress", "plan", "summary", "cost")
STATUSES = ("queued", "running", "complete", "failed", "cancelled")


def backend():
    return "postgres" if os.environ.get("DATABASE_URL") else "memory"


def _now():
    return datetime.now(timezone.utc)


def _iso(v):
    return v.isoformat() if isinstance(v, datetime) else v


# ── Postgres ─────────────────────────────────────────────────────────────────
_TABLES_READY = False
_TABLES_LOCK = threading.Lock()


@contextlib.contextmanager
def _pg():
    """One connection for one unit of work: committed on success, rolled back
    on error, and always closed (psycopg2's own `with conn` only commits)."""
    import psycopg2
    conn = psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=8)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _ensure(conn):
    global _TABLES_READY
    if _TABLES_READY:
        return
    with _TABLES_LOCK:
        if _TABLES_READY:
            return
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS lbr_runs (
                    id SERIAL PRIMARY KEY,
                    email TEXT NOT NULL,
                    business_type TEXT NOT NULL,
                    location TEXT NOT NULL,
                    focus TEXT NOT NULL DEFAULT 'all',
                    cap INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'queued',
                    stage TEXT,
                    progress JSONB NOT NULL DEFAULT '{}'::jsonb,
                    plan JSONB NOT NULL DEFAULT '{}'::jsonb,
                    summary JSONB NOT NULL DEFAULT '{}'::jsonb,
                    cost JSONB NOT NULL DEFAULT '{}'::jsonb,
                    error TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    heartbeat_at TIMESTAMPTZ,
                    finished_at TIMESTAMPTZ,
                    purged_at TIMESTAMPTZ)""")
            cur.execute("CREATE INDEX IF NOT EXISTS lbr_runs_email ON lbr_runs (email, created_at DESC)")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS lbr_stages (
                    run_id INTEGER NOT NULL REFERENCES lbr_runs(id) ON DELETE CASCADE,
                    stage TEXT NOT NULL,
                    result JSONB NOT NULL,
                    done_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    PRIMARY KEY (run_id, stage))""")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS lbr_businesses (
                    run_id INTEGER NOT NULL REFERENCES lbr_runs(id) ON DELETE CASCADE,
                    place_id TEXT NOT NULL,
                    rank INTEGER,
                    data JSONB NOT NULL DEFAULT '{}'::jsonb,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    PRIMARY KEY (run_id, place_id))""")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS lbr_calls (
                    id BIGSERIAL PRIMARY KEY,
                    run_id INTEGER NOT NULL REFERENCES lbr_runs(id) ON DELETE CASCADE,
                    provider TEXT NOT NULL,
                    op TEXT NOT NULL,
                    units INTEGER NOT NULL DEFAULT 1,
                    usd NUMERIC(12,6),
                    ok BOOLEAN NOT NULL,
                    status INTEGER,
                    ms INTEGER NOT NULL DEFAULT 0,
                    detail TEXT,
                    at TIMESTAMPTZ NOT NULL DEFAULT now())""")
            cur.execute("CREATE INDEX IF NOT EXISTS lbr_calls_run ON lbr_calls (run_id)")
        conn.commit()
        _TABLES_READY = True


def _run_row(cur, row):
    cols = [d[0] for d in cur.description]
    out = dict(zip(cols, row))
    for k in ("created_at", "updated_at", "heartbeat_at", "finished_at", "purged_at"):
        out[k] = _iso(out.get(k))
    return out


_RUN_COLS = ("id, email, business_type, location, focus, cap, status, stage, progress, plan, "
             "summary, cost, error, created_at, updated_at, heartbeat_at, finished_at, purged_at")


# ── In-process ───────────────────────────────────────────────────────────────
_MEM = {"runs": {}, "stages": {}, "businesses": {}, "calls": {}, "next": 1}
_MEM_LOCK = threading.RLock()


def reset_memory():
    """Empty the in-process store (tests)."""
    with _MEM_LOCK:
        _MEM.update(runs={}, stages={}, businesses={}, calls={}, next=1)


def _merge(base, extra):
    """Top-level JSON merge, the same as Postgres `jsonb || jsonb`."""
    out = dict(base or {})
    out.update(extra or {})
    return out


# ── Runs ─────────────────────────────────────────────────────────────────────
def create_run(email, business_type, location, focus, cap):
    email = (email or "").strip().lower()
    if backend() == "memory":
        with _MEM_LOCK:
            rid = _MEM["next"]
            _MEM["next"] += 1
            now = _now().isoformat()
            _MEM["runs"][rid] = {
                "id": rid, "email": email, "business_type": business_type, "location": location,
                "focus": focus, "cap": cap, "status": "queued", "stage": None, "progress": {},
                "plan": {}, "summary": {}, "cost": {}, "error": None, "created_at": now,
                "updated_at": now, "heartbeat_at": None, "finished_at": None, "purged_at": None}
            return rid
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("INSERT INTO lbr_runs (email, business_type, location, focus, cap) "
                        "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                        (email, business_type, location, focus, cap))
            return cur.fetchone()[0]


def get_run(run_id, email=None):
    """One run. With `email`, only if that user owns it; the worker passes None."""
    if backend() == "memory":
        with _MEM_LOCK:
            run = _MEM["runs"].get(run_id)
            if not run or (email is not None and run["email"] != email.strip().lower()):
                return None
            return copy.deepcopy(run)
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            if email is None:
                cur.execute("SELECT %s FROM lbr_runs WHERE id = %%s" % _RUN_COLS, (run_id,))
            else:
                cur.execute("SELECT %s FROM lbr_runs WHERE id = %%s AND email = %%s" % _RUN_COLS,
                            (run_id, email.strip().lower()))
            row = cur.fetchone()
            return _run_row(cur, row) if row else None


def list_runs(email, limit=30):
    email = (email or "").strip().lower()
    if backend() == "memory":
        with _MEM_LOCK:
            runs = [copy.deepcopy(r) for r in _MEM["runs"].values() if r["email"] == email]
        runs.sort(key=lambda r: r["id"], reverse=True)
        return runs[:limit]
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT %s FROM lbr_runs WHERE email = %%s ORDER BY id DESC LIMIT %%s"
                        % _RUN_COLS, (email, limit))
            return [_run_row(cur, r) for r in cur.fetchall()]


def update_run(run_id, **fields):
    """Set some of RUN_FIELDS. JSON fields are replaced whole; use merge_run for a patch."""
    bad = set(fields) - set(RUN_FIELDS)
    if bad:
        raise ValueError("not a run field: %s" % ", ".join(sorted(bad)))
    if "status" in fields and fields["status"] not in STATUSES:
        raise ValueError("unknown status %r" % fields["status"])
    if backend() == "memory":
        with _MEM_LOCK:
            run = _MEM["runs"].get(run_id)
            if not run:
                return False
            for k, v in fields.items():
                run[k] = _iso(v)
            run["updated_at"] = _now().isoformat()
            return True
    sets, vals = [], []
    for k, v in fields.items():
        sets.append("%s = %%s" % k)
        vals.append(json.dumps(v) if k in JSON_FIELDS else v)
    sets.append("updated_at = now()")
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("UPDATE lbr_runs SET %s WHERE id = %%s" % ", ".join(sets), vals + [run_id])
            return cur.rowcount == 1


def merge_run(run_id, field, patch):
    """Merge a dict into one JSON field (progress, summary...) without a read."""
    if field not in JSON_FIELDS:
        raise ValueError("not a JSON field: %s" % field)
    if backend() == "memory":
        with _MEM_LOCK:
            run = _MEM["runs"].get(run_id)
            if not run:
                return False
            run[field] = _merge(run.get(field), patch)
            run["updated_at"] = _now().isoformat()
            return True
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("UPDATE lbr_runs SET %s = %s || %%s::jsonb, updated_at = now() WHERE id = %%s"
                        % (field, field), (json.dumps(patch), run_id))
            return cur.rowcount == 1


def heartbeat(run_id):
    return update_run(run_id, heartbeat_at=_now())


# ── Stage results ────────────────────────────────────────────────────────────
def save_stage(run_id, stage, result):
    if backend() == "memory":
        with _MEM_LOCK:
            _MEM["stages"][(run_id, stage)] = copy.deepcopy(result)
            return
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("INSERT INTO lbr_stages (run_id, stage, result) VALUES (%s, %s, %s) "
                        "ON CONFLICT (run_id, stage) DO UPDATE SET result = EXCLUDED.result, "
                        "done_at = now()", (run_id, stage, json.dumps(result)))


def get_stage(run_id, stage):
    """A finished stage's result, or None when the stage has not finished."""
    if backend() == "memory":
        with _MEM_LOCK:
            v = _MEM["stages"].get((run_id, stage))
            return copy.deepcopy(v) if v is not None else None
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT result FROM lbr_stages WHERE run_id = %s AND stage = %s", (run_id, stage))
            row = cur.fetchone()
            return row[0] if row else None


# ── Businesses ───────────────────────────────────────────────────────────────
def upsert_businesses(run_id, rows):
    """Merge each row's `data` into what the business already has.

    `rows` is an iterable of dicts with `place_id`, `data` and optionally
    `rank`. A stage only ever adds its own keys, so running two stages over
    the same business never erases the other's findings.
    """
    rows = [r for r in rows if r.get("place_id")]
    if not rows:
        return 0
    if backend() == "memory":
        with _MEM_LOCK:
            for r in rows:
                key = (run_id, r["place_id"])
                cur = _MEM["businesses"].get(key) or {"run_id": run_id, "place_id": r["place_id"],
                                                     "rank": None, "data": {}}
                cur["data"] = _merge(cur["data"], copy.deepcopy(r.get("data") or {}))
                if r.get("rank") is not None:
                    cur["rank"] = r["rank"]
                cur["updated_at"] = _now().isoformat()
                _MEM["businesses"][key] = cur
        return len(rows)
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            for r in rows:
                cur.execute(
                    "INSERT INTO lbr_businesses (run_id, place_id, rank, data) VALUES (%s, %s, %s, %s) "
                    "ON CONFLICT (run_id, place_id) DO UPDATE SET "
                    "data = lbr_businesses.data || EXCLUDED.data, "
                    "rank = COALESCE(EXCLUDED.rank, lbr_businesses.rank), updated_at = now()",
                    (run_id, r["place_id"], r.get("rank"), json.dumps(r.get("data") or {})))
    return len(rows)


def get_businesses(run_id, email=None):
    """Every business of a run, best rank first. With `email`, owner-scoped."""
    if backend() == "memory":
        with _MEM_LOCK:
            run = _MEM["runs"].get(run_id)
            if not run or (email is not None and run["email"] != email.strip().lower()):
                return []
            rows = [copy.deepcopy(b) for (rid, _), b in _MEM["businesses"].items() if rid == run_id]
    else:
        with _pg() as conn:
            _ensure(conn)
            with conn.cursor() as cur:
                sql = ("SELECT b.place_id, b.rank, b.data FROM lbr_businesses b "
                       "JOIN lbr_runs r ON r.id = b.run_id WHERE b.run_id = %s")
                args = [run_id]
                if email is not None:
                    sql += " AND r.email = %s"
                    args.append(email.strip().lower())
                cur.execute(sql, args)
                rows = [{"run_id": run_id, "place_id": p, "rank": rk, "data": d}
                        for p, rk, d in cur.fetchall()]
    rows.sort(key=lambda b: (b["rank"] is None, b["rank"] if b["rank"] is not None else 0,
                             b["place_id"]))
    return rows


# ── Spend ────────────────────────────────────────────────────────────────────
def add_calls(run_id, entries):
    entries = list(entries or [])
    if not entries:
        return 0
    if backend() == "memory":
        with _MEM_LOCK:
            _MEM["calls"].setdefault(run_id, []).extend(copy.deepcopy(entries))
        return len(entries)
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            for e in entries:
                cur.execute(
                    "INSERT INTO lbr_calls (run_id, provider, op, units, usd, ok, status, ms, detail, at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, to_timestamp(%s))",
                    (run_id, e["provider"], e["op"], int(e.get("units") or 1), e.get("usd"),
                     bool(e.get("ok")), e.get("status"), int(e.get("ms") or 0),
                     (e.get("detail") or "")[:300], float(e.get("at") or time.time())))
    return len(entries)


def get_calls(run_id):
    if backend() == "memory":
        with _MEM_LOCK:
            return copy.deepcopy(_MEM["calls"].get(run_id, []))
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT provider, op, units, usd, ok, status, ms, detail, "
                        "extract(epoch from at) FROM lbr_calls WHERE run_id = %s ORDER BY id", (run_id,))
            return [{"provider": p, "op": o, "units": u, "usd": float(usd) if usd is not None else None,
                     "ok": ok, "status": st, "ms": ms, "detail": d, "at": float(at)}
                    for p, o, u, usd, ok, st, ms, d, at in cur.fetchall()]


# ── Retention ────────────────────────────────────────────────────────────────
# What survives a purge: the place ID (the row key), the scores, and the
# rank. Everything read from Google goes.
KEPT_AFTER_PURGE = ("score",)


def purge_expired(days):
    """Blank the Google content of runs finished more than `days` ago. Returns runs purged."""
    cutoff = _now() - timedelta(days=days)
    if backend() == "memory":
        n = 0
        with _MEM_LOCK:
            for rid, run in _MEM["runs"].items():
                fin = run.get("finished_at")
                if run.get("purged_at") or not fin or datetime.fromisoformat(fin) > cutoff:
                    continue
                for (brid, pid), b in _MEM["businesses"].items():
                    if brid == rid:
                        b["data"] = {k: b["data"][k] for k in KEPT_AFTER_PURGE if k in b["data"]}
                for key in [k for k in _MEM["stages"] if k[0] == rid]:
                    del _MEM["stages"][key]
                run["plan"] = {k: v for k, v in (run.get("plan") or {}).items() if k != "area"}
                run["purged_at"] = _now().isoformat()
                n += 1
        return n
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM lbr_runs WHERE purged_at IS NULL AND finished_at IS NOT NULL "
                        "AND finished_at < %s", (cutoff,))
            ids = [r[0] for r in cur.fetchall()]
            if not ids:
                return 0
            keep = "jsonb_strip_nulls(jsonb_build_object(%s))" % ", ".join(
                "'%s', data->'%s'" % (k, k) for k in KEPT_AFTER_PURGE)
            cur.execute("UPDATE lbr_businesses SET data = %s WHERE run_id = ANY(%%s)" % keep, (ids,))
            cur.execute("DELETE FROM lbr_stages WHERE run_id = ANY(%s)", (ids,))
            cur.execute("UPDATE lbr_runs SET plan = plan - 'area', purged_at = now() WHERE id = ANY(%s)",
                        (ids,))
            return len(ids)
