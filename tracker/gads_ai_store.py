"""Google Ads AI review: storage for account briefs and reviews.

Postgres when DATABASE_URL is set (Railway: a brief and a finished review must
survive the next deploy), an in-process store otherwise, so local runs and the
test suite need no database. Both backends expose the same functions and
return the same shapes.

Tables:
  gads_ai_briefs   every saved version of an account's brief (insert-only, so
                   a review can always show the brief it was judged against);
                   the latest version per account is the current one.
  gads_ai_reviews  one row per review: the account, who asked, where it has
                   got to, the finished report and what it cost.
  gads_ai_settings a few named values set from the page (the linked context doc).

A review whose heartbeat stops (the process was redeployed mid-run) is marked
failed when next read, so a page never waits on a run that will not finish.
"""

import contextlib
import copy
import json
import logging
import os
import threading
from datetime import datetime, timedelta, timezone

log = logging.getLogger(__name__)

STATUSES = ("queued", "running", "complete", "failed")
REVIEW_FIELDS = ("status", "stage", "report", "cost", "error", "heartbeat_at", "finished_at",
                 "period_from", "period_to", "stats", "brief_id")
JSON_FIELDS = ("report", "cost", "stats")
STALE_AFTER = timedelta(minutes=12)   # a live run beats at least every minute


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
                CREATE TABLE IF NOT EXISTS gads_ai_briefs (
                    id SERIAL PRIMARY KEY,
                    account TEXT NOT NULL,
                    customer_id TEXT NOT NULL DEFAULT '',
                    text TEXT NOT NULL,
                    filename TEXT NOT NULL DEFAULT '',
                    email TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
            cur.execute("CREATE INDEX IF NOT EXISTS gads_ai_briefs_account ON gads_ai_briefs (account, id DESC)")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS gads_ai_reviews (
                    id SERIAL PRIMARY KEY,
                    account TEXT NOT NULL,
                    email TEXT NOT NULL,
                    brief_id INTEGER,
                    status TEXT NOT NULL DEFAULT 'queued',
                    stage TEXT,
                    period_from TEXT,
                    period_to TEXT,
                    report JSONB NOT NULL DEFAULT '{}'::jsonb,
                    cost JSONB NOT NULL DEFAULT '{}'::jsonb,
                    stats JSONB NOT NULL DEFAULT '{}'::jsonb,
                    error TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    heartbeat_at TIMESTAMPTZ,
                    finished_at TIMESTAMPTZ)""")
            cur.execute("CREATE INDEX IF NOT EXISTS gads_ai_reviews_account ON gads_ai_reviews (account, id DESC)")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS gads_ai_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    email TEXT NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
        conn.commit()
        _TABLES_READY = True


_BRIEF_COLS = "id, account, customer_id, text, filename, email, created_at"
_REVIEW_COLS = ("id, account, email, brief_id, status, stage, period_from, period_to, report, cost, stats, "
                "error, created_at, heartbeat_at, finished_at")


def _brief_row(r):
    return {"id": r[0], "account": r[1], "customer_id": r[2], "text": r[3], "filename": r[4],
            "email": r[5], "created_at": _iso(r[6])}


def _review_row(r):
    return {"id": r[0], "account": r[1], "email": r[2], "brief_id": r[3], "status": r[4], "stage": r[5],
            "period_from": r[6], "period_to": r[7], "report": r[8] or {}, "cost": r[9] or {},
            "stats": r[10] or {}, "error": r[11], "created_at": _iso(r[12]), "heartbeat_at": _iso(r[13]),
            "finished_at": _iso(r[14])}


# ── In-process ───────────────────────────────────────────────────────────────
_MEM = {"briefs": [], "reviews": [], "settings": {}}
_MEM_LOCK = threading.Lock()


def reset_memory():
    with _MEM_LOCK:
        _MEM["briefs"].clear()
        _MEM["reviews"].clear()
        _MEM["settings"].clear()


# ── Settings ─────────────────────────────────────────────────────────────────
def get_setting(key):
    """{"value", "email", "updated_at"} or None."""
    if backend() == "memory":
        with _MEM_LOCK:
            v = _MEM["settings"].get(key)
            return dict(v) if v else None
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT value, email, updated_at FROM gads_ai_settings WHERE key = %s", (key,))
            r = cur.fetchone()
            return {"value": r[0], "email": r[1], "updated_at": _iso(r[2])} if r else None


def set_setting(key, value, email):
    if backend() == "memory":
        with _MEM_LOCK:
            _MEM["settings"][key] = {"value": value, "email": email, "updated_at": _iso(_now())}
            return
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("INSERT INTO gads_ai_settings (key, value, email) VALUES (%s, %s, %s) "
                        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, email = EXCLUDED.email, "
                        "updated_at = now()", (key, value, email))


# ── Briefs ───────────────────────────────────────────────────────────────────
def save_brief(account, text, email, customer_id="", filename=""):
    """A new version of an account's brief; returns it."""
    if backend() == "memory":
        with _MEM_LOCK:
            b = {"id": len(_MEM["briefs"]) + 1, "account": account, "customer_id": customer_id or "",
                 "text": text, "filename": filename or "", "email": email, "created_at": _iso(_now())}
            _MEM["briefs"].append(b)
            return copy.deepcopy(b)
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("INSERT INTO gads_ai_briefs (account, customer_id, text, filename, email) "
                        "VALUES (%s, %s, %s, %s, %s) RETURNING " + _BRIEF_COLS,
                        (account, customer_id or "", text, filename or "", email))
            return _brief_row(cur.fetchone())


def get_brief(account=None, brief_id=None):
    """The current brief of an account, or one version by id; None when there is none."""
    if backend() == "memory":
        with _MEM_LOCK:
            rows = [b for b in _MEM["briefs"] if (brief_id and b["id"] == brief_id)
                    or (not brief_id and b["account"] == account)]
            return copy.deepcopy(rows[-1]) if rows else None
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            if brief_id:
                cur.execute("SELECT " + _BRIEF_COLS + " FROM gads_ai_briefs WHERE id = %s", (brief_id,))
            else:
                cur.execute("SELECT " + _BRIEF_COLS + " FROM gads_ai_briefs WHERE account = %s "
                            "ORDER BY id DESC LIMIT 1", (account,))
            r = cur.fetchone()
            return _brief_row(r) if r else None


def brief_history(account, limit=20):
    """Earlier versions, newest first, without their text."""
    if backend() == "memory":
        with _MEM_LOCK:
            rows = [dict(b, text=None) for b in _MEM["briefs"] if b["account"] == account]
            return list(reversed(rows))[:limit]
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT id, account, customer_id, '', filename, email, created_at FROM gads_ai_briefs "
                        "WHERE account = %s ORDER BY id DESC LIMIT %s", (account, limit))
            return [dict(_brief_row(r), text=None) for r in cur.fetchall()]


def briefed_accounts():
    """{account: when its current brief was saved}."""
    if backend() == "memory":
        with _MEM_LOCK:
            return {b["account"]: b["created_at"] for b in _MEM["briefs"]}
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT account, max(created_at) FROM gads_ai_briefs GROUP BY account")
            return {r[0]: _iso(r[1]) for r in cur.fetchall()}


# ── Reviews ──────────────────────────────────────────────────────────────────
def create_review(account, email, brief_id=None):
    if backend() == "memory":
        with _MEM_LOCK:
            r = {"id": len(_MEM["reviews"]) + 1, "account": account, "email": email, "brief_id": brief_id,
                 "status": "queued", "stage": None, "period_from": None, "period_to": None, "report": {},
                 "cost": {}, "stats": {}, "error": None, "created_at": _iso(_now()),
                 "heartbeat_at": _iso(_now()), "finished_at": None}
            _MEM["reviews"].append(r)
            return r["id"]
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("INSERT INTO gads_ai_reviews (account, email, brief_id, heartbeat_at) "
                        "VALUES (%s, %s, %s, now()) RETURNING id", (account, email, brief_id))
            return cur.fetchone()[0]


def update_review(review_id, **fields):
    bad = set(fields) - set(REVIEW_FIELDS)
    if bad:
        raise ValueError("unknown review fields: %s" % ", ".join(sorted(bad)))
    if "status" in fields and fields["status"] not in STATUSES:
        raise ValueError("unknown status %r" % fields["status"])
    if backend() == "memory":
        with _MEM_LOCK:
            for r in _MEM["reviews"]:
                if r["id"] == review_id:
                    r.update({k: (_iso(v) if isinstance(v, datetime) else copy.deepcopy(v)) for k, v in fields.items()})
            return
    from psycopg2.extras import Json
    sets, vals = [], []
    for k, v in fields.items():
        sets.append("%s = %%s" % k)
        vals.append(Json(v) if k in JSON_FIELDS else v)
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("UPDATE gads_ai_reviews SET " + ", ".join(sets) + " WHERE id = %s", vals + [review_id])


def beat(review_id, stage=None):
    fields = {"heartbeat_at": _now()}
    if stage:
        fields["stage"] = stage
    update_review(review_id, **fields)


def _expire(r):
    """A queued or running review whose heartbeat stopped reads as failed (and is saved so)."""
    if r and r["status"] in ("queued", "running") and r.get("heartbeat_at"):
        at = r["heartbeat_at"]
        at = datetime.fromisoformat(at) if isinstance(at, str) else at
        if at and _now() - at > STALE_AFTER:
            msg = "The review stopped before it finished (the server restarted). Run it again."
            update_review(r["id"], status="failed", error=msg, finished_at=_now())
            r = dict(r, status="failed", error=msg)
    return r


def get_review(review_id):
    if backend() == "memory":
        with _MEM_LOCK:
            r = next((copy.deepcopy(x) for x in _MEM["reviews"] if x["id"] == review_id), None)
        return _expire(r)
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT " + _REVIEW_COLS + " FROM gads_ai_reviews WHERE id = %s", (review_id,))
            r = cur.fetchone()
    return _expire(_review_row(r)) if r else None


def list_reviews(account, limit=20):
    """An account's reviews, newest first, without their reports."""
    if backend() == "memory":
        with _MEM_LOCK:
            rows = [dict(copy.deepcopy(r), report={}) for r in _MEM["reviews"] if r["account"] == account]
        return [_expire(r) for r in reversed(rows)][:limit]
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT " + _REVIEW_COLS.replace("report,", "'{}'::jsonb,") +
                        " FROM gads_ai_reviews WHERE account = %s ORDER BY id DESC LIMIT %s", (account, limit))
            rows = [_review_row(r) for r in cur.fetchall()]
    return [_expire(r) for r in rows]


def active_review(account):
    """The account's review still in progress, if any (one at a time per account)."""
    for r in list_reviews(account, limit=5):
        if r["status"] in ("queued", "running"):
            return r
    return None


def dumps(v):
    return json.dumps(v, default=str)
