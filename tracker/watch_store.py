"""Page Watch: storage.

Postgres when DATABASE_URL is set (Railway: the web and worker processes have
no persistent disk), an in-process store otherwise, so tests and local runs
need no database. Both backends expose the same functions and return the same
shapes. The pattern follows tracker/lbr_store.py.

Tables
  watch_targets    one row per watched page: the link and how to watch it.
  watch_checks     one row per check: when, what happened, how long it took.
  watch_snapshots  one row per kept reading of a page: its text blocks and
                   facts (`data`), the screenshot it compared with, a thumbnail.
  watch_changes    one row per change found: the evidence (`report`), the
                   picture, Claude's verdict (Phase 3) and the alert (Phase 5).
  watch_images     the image bytes (WebP or PNG), kept out of the other rows
                   so listing pages never loads them.

Every read a user can reach takes their email and scopes the query to it in
SQL (a row of another table is reached through its watch_targets row), never
"fetch, then check in Python". The worker passes email=None.
"""

from __future__ import annotations

import contextlib
import copy
import json
import os
import threading
from datetime import datetime, timezone

TARGET_FIELDS = ("name", "client", "url", "area_selector", "area_label", "ignore", "watch_text",
                 "watch_visual", "instructions", "schedule", "channel", "status", "state",
                 "next_check_at", "last_check_at", "last_change_at", "baseline_id", "fail_count",
                 "archived_at", "lease_until", "lease_owner", "settings")
TARGET_JSON = ("ignore", "schedule", "settings")
STATES = ("pending", "ok", "changed", "error", "blocked")
OUTCOMES = ("baseline", "same", "changed", "glitch", "error", "blocked")
IMAGE_KINDS = ("shot", "thumb", "composite", "crop")


def backend():
    return "postgres" if os.environ.get("DATABASE_URL") else "memory"


def _now():
    return datetime.now(timezone.utc)


def _iso(v):
    return v.isoformat() if isinstance(v, datetime) else v


def _norm_email(email):
    return (email or "").strip().lower()


# ── Postgres ─────────────────────────────────────────────────────────────────
_READY = False
_READY_LOCK = threading.Lock()


@contextlib.contextmanager
def _pg():
    import psycopg2
    conn = psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=8)
    try:
        _ensure(conn)
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _ensure(conn):
    global _READY
    if _READY:
        return
    with _READY_LOCK:
        if _READY:
            return
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS watch_targets (
                    id SERIAL PRIMARY KEY,
                    email TEXT NOT NULL,
                    name TEXT NOT NULL DEFAULT '',
                    client TEXT NOT NULL DEFAULT '',
                    url TEXT NOT NULL,
                    area_selector TEXT,
                    area_label TEXT,
                    ignore JSONB NOT NULL DEFAULT '[]'::jsonb,
                    watch_text BOOLEAN NOT NULL DEFAULT TRUE,
                    watch_visual BOOLEAN NOT NULL DEFAULT TRUE,
                    instructions TEXT NOT NULL DEFAULT '',
                    schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
                    channel TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'active',
                    state TEXT NOT NULL DEFAULT 'pending',
                    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
                    next_check_at TIMESTAMPTZ,
                    last_check_at TIMESTAMPTZ,
                    last_change_at TIMESTAMPTZ,
                    baseline_id INTEGER,
                    fail_count INTEGER NOT NULL DEFAULT 0,
                    lease_until TIMESTAMPTZ,
                    lease_owner TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    archived_at TIMESTAMPTZ)""")
            cur.execute("CREATE INDEX IF NOT EXISTS watch_targets_email ON watch_targets (email, created_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS watch_targets_due ON watch_targets (next_check_at) "
                        "WHERE status = 'active' AND archived_at IS NULL")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS watch_images (
                    id BIGSERIAL PRIMARY KEY,
                    target_id INTEGER NOT NULL REFERENCES watch_targets(id) ON DELETE CASCADE,
                    kind TEXT NOT NULL,
                    mime TEXT NOT NULL,
                    width INTEGER, height INTEGER,
                    lossless BOOLEAN NOT NULL DEFAULT FALSE,
                    bytes BYTEA NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
            cur.execute("CREATE INDEX IF NOT EXISTS watch_images_target ON watch_images (target_id, created_at)")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS watch_snapshots (
                    id BIGSERIAL PRIMARY KEY,
                    target_id INTEGER NOT NULL REFERENCES watch_targets(id) ON DELETE CASCADE,
                    fingerprint TEXT NOT NULL,
                    data JSONB NOT NULL,
                    shot_id BIGINT REFERENCES watch_images(id) ON DELETE SET NULL,
                    thumb_id BIGINT REFERENCES watch_images(id) ON DELETE SET NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
            cur.execute("CREATE INDEX IF NOT EXISTS watch_snapshots_target ON watch_snapshots (target_id, created_at DESC)")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS watch_changes (
                    id BIGSERIAL PRIMARY KEY,
                    target_id INTEGER NOT NULL REFERENCES watch_targets(id) ON DELETE CASCADE,
                    before_id BIGINT REFERENCES watch_snapshots(id) ON DELETE SET NULL,
                    after_id BIGINT REFERENCES watch_snapshots(id) ON DELETE SET NULL,
                    level TEXT NOT NULL,
                    headline TEXT NOT NULL,
                    report JSONB NOT NULL,
                    verdict JSONB NOT NULL DEFAULT '{}'::jsonb,
                    composite_id BIGINT REFERENCES watch_images(id) ON DELETE SET NULL,
                    feedback TEXT,
                    alert JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
            cur.execute("CREATE INDEX IF NOT EXISTS watch_changes_target ON watch_changes (target_id, created_at DESC)")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS watch_checks (
                    id BIGSERIAL PRIMARY KEY,
                    target_id INTEGER NOT NULL REFERENCES watch_targets(id) ON DELETE CASCADE,
                    outcome TEXT,
                    engine TEXT,
                    status INTEGER,
                    final_url TEXT,
                    error TEXT,
                    error_detail TEXT,
                    elapsed_ms INTEGER,
                    snapshot_id BIGINT REFERENCES watch_snapshots(id) ON DELETE SET NULL,
                    change_id BIGINT REFERENCES watch_changes(id) ON DELETE SET NULL,
                    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    finished_at TIMESTAMPTZ)""")
            cur.execute("CREATE INDEX IF NOT EXISTS watch_checks_target ON watch_checks (target_id, started_at DESC)")
        conn.commit()
        _READY = True


def _rows(cur):
    cols = [d[0] for d in cur.description]
    out = []
    for row in cur.fetchall():
        rec = dict(zip(cols, row))
        for k, v in list(rec.items()):
            if isinstance(v, datetime):
                rec[k] = v.isoformat()
            elif isinstance(v, memoryview):
                rec[k] = bytes(v)
        out.append(rec)
    return out


def _j(v):
    return json.dumps(v) if v is not None else None


# ── In-process ───────────────────────────────────────────────────────────────
_MEM = {}
_MEM_LOCK = threading.RLock()


def reset_memory():
    """Empty the in-process store (tests)."""
    with _MEM_LOCK:
        _MEM.clear()
        _MEM.update(targets={}, images={}, snapshots={}, changes={}, checks={},
                    ids={"targets": 0, "images": 0, "snapshots": 0, "changes": 0, "checks": 0})


reset_memory()


def _mem_id(table):
    _MEM["ids"][table] += 1
    return _MEM["ids"][table]


def _mem_target(target_id, email):
    t = _MEM["targets"].get(target_id)
    if not t or (email is not None and t["email"] != _norm_email(email)):
        return None
    return t


# ── Targets ──────────────────────────────────────────────────────────────────
TARGET_DEFAULTS = {"name": "", "client": "", "area_selector": None, "area_label": None, "ignore": [],
                   "watch_text": True, "watch_visual": True, "instructions": "", "schedule": {},
                   "channel": "", "status": "active", "state": "pending", "settings": {},
                   "next_check_at": None, "last_check_at": None, "last_change_at": None,
                   "baseline_id": None, "fail_count": 0, "lease_until": None, "lease_owner": None,
                   "archived_at": None}


def create_target(email, url, **fields):
    bad = set(fields) - set(TARGET_FIELDS)
    if bad:
        raise ValueError("unknown fields: %s" % ", ".join(sorted(bad)))
    row = dict(TARGET_DEFAULTS, **fields)
    email = _norm_email(email)
    if backend() == "memory":
        with _MEM_LOCK:
            tid = _mem_id("targets")
            now = _now().isoformat()
            rec = dict(row, id=tid, email=email, url=url, created_at=now, updated_at=now)
            for k in ("next_check_at", "last_check_at", "last_change_at", "archived_at", "lease_until"):
                rec[k] = _iso(rec[k])
            _MEM["targets"][tid] = rec
            return tid
    cols = ["email", "url"] + [k for k in row]
    vals = [email, url] + [_j(row[k]) if k in TARGET_JSON else row[k] for k in row]
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO watch_targets (%s) VALUES (%s) RETURNING id"
                    % (", ".join(cols), ", ".join(["%s"] * len(cols))), vals)
        return cur.fetchone()[0]


def get_target(target_id, email=None):
    if backend() == "memory":
        with _MEM_LOCK:
            t = _mem_target(target_id, email)
            return copy.deepcopy(t) if t else None
    q = "SELECT * FROM watch_targets WHERE id = %s"
    args = [target_id]
    if email is not None:
        q += " AND email = %s"
        args.append(_norm_email(email))
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q, args)
        rows = _rows(cur)
        return rows[0] if rows else None


def list_targets(email, include_archived=False):
    email = _norm_email(email)
    if backend() == "memory":
        with _MEM_LOCK:
            rows = [copy.deepcopy(t) for t in _MEM["targets"].values() if t["email"] == email
                    and (include_archived or not t["archived_at"])]
            return sorted(rows, key=lambda t: t["created_at"], reverse=True)
    q = "SELECT * FROM watch_targets WHERE email = %s"
    if not include_archived:
        q += " AND archived_at IS NULL"
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q + " ORDER BY created_at DESC", [email])
        return _rows(cur)


def update_target(target_id, email=None, **fields):
    """Change a watch's fields. Returns True when the row exists (for that email)."""
    bad = set(fields) - set(TARGET_FIELDS)
    if bad:
        raise ValueError("unknown fields: %s" % ", ".join(sorted(bad)))
    if not fields:
        return get_target(target_id, email) is not None
    if backend() == "memory":
        with _MEM_LOCK:
            t = _mem_target(target_id, email)
            if not t:
                return False
            for k, v in fields.items():
                t[k] = _iso(v)
            t["updated_at"] = _now().isoformat()
            return True
    sets = ", ".join("%s = %%s" % k for k in fields) + ", updated_at = now()"
    vals = [_j(v) if k in TARGET_JSON else v for k, v in fields.items()]
    q = "UPDATE watch_targets SET %s WHERE id = %%s" % sets
    vals.append(target_id)
    if email is not None:
        q += " AND email = %s"
        vals.append(_norm_email(email))
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q, vals)
        return cur.rowcount > 0


def delete_target(target_id, email):
    """Delete a watch and everything it recorded (images, snapshots, changes, checks)."""
    if backend() == "memory":
        with _MEM_LOCK:
            if not _mem_target(target_id, email):
                return False
            del _MEM["targets"][target_id]
            for table in ("images", "snapshots", "changes", "checks"):
                for k in [k for k, v in _MEM[table].items() if v["target_id"] == target_id]:
                    del _MEM[table][k]
            return True
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM watch_targets WHERE id = %s AND email = %s", (target_id, _norm_email(email)))
        return cur.rowcount > 0


# ── Images ───────────────────────────────────────────────────────────────────
def add_image(target_id, kind, data, *, mime="image/webp", width=None, height=None, lossless=False):
    if kind not in IMAGE_KINDS:
        raise ValueError("unknown image kind %r" % kind)
    if backend() == "memory":
        with _MEM_LOCK:
            iid = _mem_id("images")
            _MEM["images"][iid] = {"id": iid, "target_id": target_id, "kind": kind, "mime": mime,
                                   "width": width, "height": height, "lossless": lossless,
                                   "bytes": bytes(data), "created_at": _now().isoformat()}
            return iid
    import psycopg2
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO watch_images (target_id, kind, mime, width, height, lossless, bytes) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                    (target_id, kind, mime, width, height, lossless, psycopg2.Binary(data)))
        return cur.fetchone()[0]


def get_image(image_id, email=None):
    """{"id","target_id","kind","mime","bytes",...} or None; scoped to the watch's owner."""
    if backend() == "memory":
        with _MEM_LOCK:
            im = _MEM["images"].get(image_id)
            if not im or not _mem_target(im["target_id"], email):
                return None
            return dict(im)
    q = ("SELECT i.* FROM watch_images i JOIN watch_targets t ON t.id = i.target_id WHERE i.id = %s")
    args = [image_id]
    if email is not None:
        q += " AND t.email = %s"
        args.append(_norm_email(email))
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q, args)
        rows = _rows(cur)
        return rows[0] if rows else None


def delete_images(image_ids):
    ids = [i for i in image_ids if i]
    if not ids:
        return 0
    if backend() == "memory":
        with _MEM_LOCK:
            n = 0
            for i in ids:
                n += _MEM["images"].pop(i, None) is not None
            return n
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM watch_images WHERE id = ANY(%s)", (ids,))
        return cur.rowcount


# ── Snapshots ────────────────────────────────────────────────────────────────
def add_snapshot(target_id, fingerprint, data, shot_id=None, thumb_id=None):
    if backend() == "memory":
        with _MEM_LOCK:
            sid = _mem_id("snapshots")
            _MEM["snapshots"][sid] = {"id": sid, "target_id": target_id, "fingerprint": fingerprint,
                                      "data": copy.deepcopy(data), "shot_id": shot_id, "thumb_id": thumb_id,
                                      "created_at": _now().isoformat()}
            return sid
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO watch_snapshots (target_id, fingerprint, data, shot_id, thumb_id) "
                    "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                    (target_id, fingerprint, _j(data), shot_id, thumb_id))
        return cur.fetchone()[0]


def get_snapshot(snapshot_id, email=None):
    if backend() == "memory":
        with _MEM_LOCK:
            s = _MEM["snapshots"].get(snapshot_id)
            if not s or not _mem_target(s["target_id"], email):
                return None
            return copy.deepcopy(s)
    q = "SELECT s.* FROM watch_snapshots s JOIN watch_targets t ON t.id = s.target_id WHERE s.id = %s"
    args = [snapshot_id]
    if email is not None:
        q += " AND t.email = %s"
        args.append(_norm_email(email))
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q, args)
        rows = _rows(cur)
        return rows[0] if rows else None


def update_snapshot(snapshot_id, **fields):
    allowed = {"shot_id", "thumb_id", "data"}
    bad = set(fields) - allowed
    if bad:
        raise ValueError("unknown fields: %s" % ", ".join(sorted(bad)))
    if backend() == "memory":
        with _MEM_LOCK:
            s = _MEM["snapshots"].get(snapshot_id)
            if not s:
                return False
            s.update(copy.deepcopy(fields))
            return True
    sets = ", ".join("%s = %%s" % k for k in fields)
    vals = [_j(v) if k == "data" else v for k, v in fields.items()] + [snapshot_id]
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("UPDATE watch_snapshots SET %s WHERE id = %%s" % sets, vals)
        return cur.rowcount > 0


# ── Changes ──────────────────────────────────────────────────────────────────
def add_change(target_id, before_id, after_id, level, headline, report, composite_id=None):
    if backend() == "memory":
        with _MEM_LOCK:
            cid = _mem_id("changes")
            _MEM["changes"][cid] = {"id": cid, "target_id": target_id, "before_id": before_id,
                                    "after_id": after_id, "level": level, "headline": headline,
                                    "report": copy.deepcopy(report), "verdict": {}, "composite_id": composite_id,
                                    "feedback": None, "alert": {}, "created_at": _now().isoformat()}
            return cid
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO watch_changes (target_id, before_id, after_id, level, headline, report, "
                    "composite_id) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                    (target_id, before_id, after_id, level, headline, _j(report), composite_id))
        return cur.fetchone()[0]


def get_change(change_id, email=None):
    if backend() == "memory":
        with _MEM_LOCK:
            c = _MEM["changes"].get(change_id)
            if not c or not _mem_target(c["target_id"], email):
                return None
            return copy.deepcopy(c)
    q = "SELECT c.* FROM watch_changes c JOIN watch_targets t ON t.id = c.target_id WHERE c.id = %s"
    args = [change_id]
    if email is not None:
        q += " AND t.email = %s"
        args.append(_norm_email(email))
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q, args)
        rows = _rows(cur)
        return rows[0] if rows else None


def list_changes(target_id, email=None, limit=50):
    if backend() == "memory":
        with _MEM_LOCK:
            if not _mem_target(target_id, email):
                return []
            rows = [copy.deepcopy(c) for c in _MEM["changes"].values() if c["target_id"] == target_id]
            return sorted(rows, key=lambda c: c["id"], reverse=True)[:limit]
    q = ("SELECT c.* FROM watch_changes c JOIN watch_targets t ON t.id = c.target_id "
         "WHERE c.target_id = %s")
    args = [target_id]
    if email is not None:
        q += " AND t.email = %s"
        args.append(_norm_email(email))
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q + " ORDER BY c.id DESC LIMIT %s", args + [limit])
        return _rows(cur)


def update_change(change_id, email=None, **fields):
    allowed = {"verdict", "feedback", "alert", "level", "headline", "composite_id"}
    bad = set(fields) - allowed
    if bad:
        raise ValueError("unknown fields: %s" % ", ".join(sorted(bad)))
    if backend() == "memory":
        with _MEM_LOCK:
            c = _MEM["changes"].get(change_id)
            if not c or not _mem_target(c["target_id"], email):
                return False
            c.update(copy.deepcopy(fields))
            return True
    sets = ", ".join("%s = %%s" % k for k in fields)
    vals = [_j(v) if k in ("verdict", "alert") else v for k, v in fields.items()]
    q = "UPDATE watch_changes c SET %s FROM watch_targets t WHERE c.id = %%s AND t.id = c.target_id" % sets
    vals.append(change_id)
    if email is not None:
        q += " AND t.email = %s"
        vals.append(_norm_email(email))
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q, vals)
        return cur.rowcount > 0


# ── Checks ───────────────────────────────────────────────────────────────────
CHECK_FIELDS = ("outcome", "engine", "status", "final_url", "error", "error_detail", "elapsed_ms",
                "snapshot_id", "change_id", "finished_at")


def start_check(target_id):
    if backend() == "memory":
        with _MEM_LOCK:
            cid = _mem_id("checks")
            _MEM["checks"][cid] = dict({k: None for k in CHECK_FIELDS}, id=cid, target_id=target_id,
                                       started_at=_now().isoformat())
            return cid
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO watch_checks (target_id) VALUES (%s) RETURNING id", (target_id,))
        return cur.fetchone()[0]


def finish_check(check_id, **fields):
    bad = set(fields) - set(CHECK_FIELDS)
    if bad:
        raise ValueError("unknown fields: %s" % ", ".join(sorted(bad)))
    fields.setdefault("finished_at", _now())
    if backend() == "memory":
        with _MEM_LOCK:
            c = _MEM["checks"].get(check_id)
            if not c:
                return False
            c.update({k: _iso(v) for k, v in fields.items()})
            return True
    sets = ", ".join("%s = %%s" % k for k in fields)
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("UPDATE watch_checks SET %s WHERE id = %%s" % sets, list(fields.values()) + [check_id])
        return cur.rowcount > 0


def list_checks(target_id, email=None, limit=30):
    if backend() == "memory":
        with _MEM_LOCK:
            if not _mem_target(target_id, email):
                return []
            rows = [dict(c) for c in _MEM["checks"].values() if c["target_id"] == target_id]
            return sorted(rows, key=lambda c: c["id"], reverse=True)[:limit]
    q = ("SELECT k.* FROM watch_checks k JOIN watch_targets t ON t.id = k.target_id WHERE k.target_id = %s")
    args = [target_id]
    if email is not None:
        q += " AND t.email = %s"
        args.append(_norm_email(email))
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q + " ORDER BY k.id DESC LIMIT %s", args + [limit])
        return _rows(cur)
