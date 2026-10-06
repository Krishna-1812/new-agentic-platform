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
  watch_workers    one row per worker process: its heartbeat, for the health
                   endpoint.
  watch_ai_calls   one row per Claude call (a change judged, a page found by
                   name): its tokens and what it cost, for the monthly cap.
  watch_meta       a few named values the workers share: when the digest
                   was last posted, whether the watchdog has already warned.

The worker claims due watches with a lease (claim_due), renews it while a
check runs (renew_lease) and hands the watch back with its next time
(release). Claims are serialised by one advisory lock, so two workers never
take the same watch, and never two watches of the same site at once.

Every read a user can reach takes their email and scopes the query to it in
SQL (a row of another table is reached through its watch_targets row), never
"fetch, then check in Python". The worker passes email=None. A watch in a
client account's space (tracker/workspace.py) is the whole team's: any staff
email reaches it (_seen); deleting stays with its owner.
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
                 "archived_at", "lease_until", "lease_owner", "settings", "site", "pending_id", "space")
TARGET_JSON = ("ignore", "schedule", "settings")
STATES = ("pending", "ok", "changed", "error", "blocked")
# suspected: a change seen once, waiting for its confirming re-check.
# glitch: a suspected change that the re-check did not see again.
# interrupted: the worker stopped (a deploy, a crash) before the check finished.
OUTCOMES = ("baseline", "same", "suspected", "changed", "glitch", "error", "blocked", "interrupted")
# Two checks of the same site are at least this far apart, whichever watches
# they belong to: one browser at a time per site, and a pause between.
SITE_GAP_S = 20
# How long a claimed watch stays with its worker without a renewal.
LEASE_S = 180
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
            cur.execute("ALTER TABLE watch_targets ADD COLUMN IF NOT EXISTS space TEXT NOT NULL DEFAULT ''")
            cur.execute("CREATE INDEX IF NOT EXISTS watch_targets_space ON watch_targets (space, created_at DESC)")
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
            # Phase 2 columns, added in place on a database made by Phase 1.
            cur.execute("ALTER TABLE watch_targets ADD COLUMN IF NOT EXISTS site TEXT NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE watch_targets ADD COLUMN IF NOT EXISTS pending_id BIGINT")
            cur.execute("CREATE INDEX IF NOT EXISTS watch_targets_site ON watch_targets (site)")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS watch_workers (
                    id TEXT PRIMARY KEY,
                    host TEXT NOT NULL DEFAULT '',
                    pid INTEGER,
                    version TEXT NOT NULL DEFAULT '',
                    state TEXT NOT NULL DEFAULT 'running',
                    checks INTEGER NOT NULL DEFAULT 0,
                    current JSONB NOT NULL DEFAULT '[]'::jsonb,
                    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    beat_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS watch_ai_calls (
                    id BIGSERIAL PRIMARY KEY,
                    email TEXT NOT NULL DEFAULT '',
                    target_id INTEGER,
                    change_id BIGINT,
                    purpose TEXT NOT NULL,
                    model TEXT NOT NULL DEFAULT '',
                    ok BOOLEAN NOT NULL DEFAULT TRUE,
                    input_tokens INTEGER NOT NULL DEFAULT 0,
                    output_tokens INTEGER NOT NULL DEFAULT 0,
                    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
                    searches INTEGER NOT NULL DEFAULT 0,
                    cost_usd NUMERIC(10, 5) NOT NULL DEFAULT 0,
                    detail TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
            cur.execute("CREATE INDEX IF NOT EXISTS watch_ai_calls_time ON watch_ai_calls (created_at)")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS watch_meta (
                    key TEXT PRIMARY KEY,
                    value JSONB NOT NULL DEFAULT '{}'::jsonb,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
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
        _MEM.update(targets={}, images={}, snapshots={}, changes={}, checks={}, workers={}, ai_calls={}, meta={},
                    ids={"targets": 0, "images": 0, "snapshots": 0, "changes": 0, "checks": 0, "ai_calls": 0})


reset_memory()


def _mem_id(table):
    _MEM["ids"][table] += 1
    return _MEM["ids"][table]


def _mem_target(target_id, email, strict=False):
    t = _MEM["targets"].get(target_id)
    if not t or (email is not None and t["email"] != _norm_email(email)
                 and (strict or not _shared(t.get("space")))):
        return None
    return t


def _shared(space):
    from tracker import workspace
    return workspace.is_account(space)


def _seen(alias=""):
    """The SQL test that `email` may reach a watch: theirs, or in a client account's space."""
    p = alias + "." if alias else ""
    return "(%semail = %%s OR %sspace ~ '^acct:[0-9]+$')" % (p, p)


# ── Targets ──────────────────────────────────────────────────────────────────
TARGET_DEFAULTS = {"name": "", "client": "", "area_selector": None, "area_label": None, "ignore": [],
                   "watch_text": True, "watch_visual": True, "instructions": "", "schedule": {},
                   "channel": "", "status": "active", "state": "pending", "settings": {},
                   "next_check_at": None, "last_check_at": None, "last_change_at": None,
                   "baseline_id": None, "fail_count": 0, "lease_until": None, "lease_owner": None,
                   "archived_at": None, "site": "", "pending_id": None, "space": ""}


def _site(url):
    from tracker import watch_safety
    try:
        return watch_safety.site_key(url)
    except Exception:
        return ""


def create_target(email, url, **fields):
    bad = set(fields) - set(TARGET_FIELDS)
    if bad:
        raise ValueError("unknown fields: %s" % ", ".join(sorted(bad)))
    row = dict(TARGET_DEFAULTS, **fields)
    row["site"] = row["site"] or _site(url)
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
        q += " AND " + _seen()
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
    if "url" in fields and "site" not in fields:
        fields["site"] = _site(fields["url"])
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
        q += " AND " + _seen()
        vals.append(_norm_email(email))
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q, vals)
        return cur.rowcount > 0


def delete_target(target_id, email):
    """Delete a watch and everything it recorded (images, snapshots, changes, checks)."""
    if backend() == "memory":
        with _MEM_LOCK:
            if not _mem_target(target_id, email, strict=True):
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
        q += " AND " + _seen("t")
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
        q += " AND " + _seen("t")
        args.append(_norm_email(email))
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q, args)
        rows = _rows(cur)
        return rows[0] if rows else None


def delete_snapshot(snapshot_id):
    """Delete one snapshot row (its images are deleted separately)."""
    if backend() == "memory":
        with _MEM_LOCK:
            return _MEM["snapshots"].pop(snapshot_id, None) is not None
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM watch_snapshots WHERE id = %s", (snapshot_id,))
        return cur.rowcount > 0


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
        q += " AND " + _seen("t")
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
        q += " AND " + _seen("t")
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
        q += " AND " + _seen("t")
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
        q += " AND " + _seen("t")
        args.append(_norm_email(email))
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q + " ORDER BY k.id DESC LIMIT %s", args + [limit])
        return _rows(cur)


def close_stale_checks(target_id, before=None):
    """Checks of this watch left open by a worker that stopped mid-check are
    closed as "interrupted". Returns how many."""
    before = before or _now()
    if backend() == "memory":
        with _MEM_LOCK:
            n = 0
            for c in _MEM["checks"].values():
                if c["target_id"] == target_id and not c.get("finished_at") and _dt(c["started_at"]) < before:
                    c.update(outcome="interrupted", finished_at=_now().isoformat(),
                             error_detail="The check was stopped before it finished (a restart or deploy).")
                    n += 1
            return n
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("UPDATE watch_checks SET outcome = 'interrupted', finished_at = now(), "
                    "error_detail = 'The check was stopped before it finished (a restart or deploy).' "
                    "WHERE target_id = %s AND finished_at IS NULL AND started_at < %s", (target_id, before))
        return cur.rowcount


# ── The worker's queue ───────────────────────────────────────────────────────
def _dt(v):
    if v is None or isinstance(v, datetime):
        return v
    return datetime.fromisoformat(v)


def _due_mem(t, now):
    nxt = _dt(t["next_check_at"])
    lease = _dt(t["lease_until"])
    return (t["status"] == "active" and not t["archived_at"] and (nxt is None or nxt <= now)
            and (lease is None or lease <= now))


def claim_due(owner, *, now=None, limit=1, lease_s=LEASE_S, site_gap_s=SITE_GAP_S):
    """Take up to `limit` due watches for `owner`, oldest due first.

    A watch is due when it is active, not archived, its next check time has
    passed (a new watch has none, so it is due at once) and nobody holds it.
    A watch is passed over while another watch of the same site is being
    checked or was checked in the last `site_gap_s` seconds. Returns the
    claimed watches (full rows).
    """
    now = now or _now()
    until = now + _td(lease_s)
    gap_from = now - _td(site_gap_s)
    if backend() == "memory":
        with _MEM_LOCK:
            busy = {}                     # site -> ids holding it (another watch must not)
            for t in _MEM["targets"].values():
                lease = _dt(t["lease_until"])
                last = _dt(t["last_check_at"])
                if t["site"] and ((lease and lease > now) or (last and last > gap_from)):
                    busy.setdefault(t["site"], set()).add(t["id"])
            due = sorted((t for t in _MEM["targets"].values() if _due_mem(t, now)),
                         key=lambda t: (_dt(t["next_check_at"]) or datetime.min.replace(tzinfo=timezone.utc), t["id"]))
            out = []
            for t in due:
                if len(out) >= limit:
                    break
                if t["site"] and busy.get(t["site"], set()) - {t["id"]}:
                    continue
                t.update(lease_owner=owner, lease_until=until.isoformat())
                if t["site"]:
                    busy.setdefault(t["site"], set()).add(t["id"])
                out.append(copy.deepcopy(t))
            return out
    with _pg() as conn, conn.cursor() as cur:
        # One claim at a time across all workers: the site rule needs to see
        # every other claim, which row locks alone would not give.
        cur.execute("SELECT pg_advisory_xact_lock(hashtext('watch_claim'))")
        cur.execute("""
            SELECT t.id, t.site FROM watch_targets t
            WHERE t.status = 'active' AND t.archived_at IS NULL
              AND (t.next_check_at IS NULL OR t.next_check_at <= %(now)s)
              AND (t.lease_until IS NULL OR t.lease_until <= %(now)s)
              AND (t.site = '' OR NOT EXISTS (
                    SELECT 1 FROM watch_targets o
                    WHERE o.site = t.site AND o.id <> t.id
                      AND (o.lease_until > %(now)s OR o.last_check_at > %(gap)s)))
            ORDER BY t.next_check_at NULLS FIRST, t.id
            LIMIT %(scan)s""", {"now": now, "gap": gap_from, "scan": max(limit * 5, 20)})
        ids, sites = [], set()
        for tid, site in cur.fetchall():
            if len(ids) >= limit:
                break
            if site and site in sites:
                continue
            sites.add(site)
            ids.append(tid)
        if not ids:
            return []
        cur.execute("UPDATE watch_targets SET lease_owner = %s, lease_until = %s WHERE id = ANY(%s) RETURNING *",
                    (owner, until, ids))
        rows = _rows(cur)
        return sorted(rows, key=lambda r: ids.index(r["id"]))


def _td(seconds):
    from datetime import timedelta
    return timedelta(seconds=seconds)


def renew_lease(target_id, owner, *, now=None, lease_s=LEASE_S):
    """Extend a held lease. False when the lease was lost (expired and taken)."""
    now = now or _now()
    until = now + _td(lease_s)
    if backend() == "memory":
        with _MEM_LOCK:
            t = _MEM["targets"].get(target_id)
            if not t or t["lease_owner"] != owner:
                return False
            t["lease_until"] = until.isoformat()
            return True
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("UPDATE watch_targets SET lease_until = %s WHERE id = %s AND lease_owner = %s",
                    (until, target_id, owner))
        return cur.rowcount > 0


_UNSEEN = object()


def release(target_id, owner, next_check_at, seen=_UNSEEN):
    """Hand a watch back with its next check time. False when not held by owner.

    `seen` is the next check time the watch had when it was claimed. If
    someone changed it during the check ("Check now", or a new area that
    restarts the watch), their time is kept when it is earlier, so a request
    made mid-check is never overwritten by the check that was running."""
    if backend() == "memory":
        with _MEM_LOCK:
            t = _MEM["targets"].get(target_id)
            if not t or t["lease_owner"] != owner:
                return False
            nxt = next_check_at
            if seen is not _UNSEEN and t["next_check_at"] != _iso(seen) and t["next_check_at"]:
                nxt = min(_dt(t["next_check_at"]), next_check_at)
            t.update(lease_owner=None, lease_until=None, next_check_at=_iso(nxt))
            return True
    with _pg() as conn, conn.cursor() as cur:
        if seen is _UNSEEN:
            cur.execute("UPDATE watch_targets SET lease_owner = NULL, lease_until = NULL, next_check_at = %s, "
                        "updated_at = now() WHERE id = %s AND lease_owner = %s", (next_check_at, target_id, owner))
        else:
            cur.execute("""
                UPDATE watch_targets SET lease_owner = NULL, lease_until = NULL, updated_at = now(),
                    next_check_at = CASE
                        WHEN next_check_at IS DISTINCT FROM %(seen)s AND next_check_at IS NOT NULL
                        THEN LEAST(next_check_at, %(next)s) ELSE %(next)s END
                WHERE id = %(id)s AND lease_owner = %(owner)s""",
                        {"seen": _dt(seen), "next": next_check_at, "id": target_id, "owner": owner})
        return cur.rowcount > 0


def leased(target, now=None):
    """Is a worker checking this watch right now?"""
    until = _dt(target.get("lease_until"))
    return bool(target.get("lease_owner")) and until is not None and until > (now or _now())


def beat(worker_id, *, host="", pid=None, version="", state="running", checks=0, current=(), now=None):
    """Record a worker's heartbeat."""
    now = now or _now()
    rec = {"id": worker_id, "host": host, "pid": pid, "version": version, "state": state,
           "checks": int(checks), "current": list(current), "beat_at": now.isoformat()}
    if backend() == "memory":
        with _MEM_LOCK:
            old = _MEM["workers"].get(worker_id)
            rec["started_at"] = old["started_at"] if old else now.isoformat()
            _MEM["workers"][worker_id] = rec
            return
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO watch_workers (id, host, pid, version, state, checks, current, started_at, beat_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET host = EXCLUDED.host, pid = EXCLUDED.pid, version = EXCLUDED.version,
                state = EXCLUDED.state, checks = EXCLUDED.checks, current = EXCLUDED.current,
                beat_at = EXCLUDED.beat_at""",
                    (worker_id, host, pid, version, state, int(checks), _j(list(current)), now, now))


def list_workers(since=None):
    """Workers that beat after `since` (all when None), latest first."""
    if backend() == "memory":
        with _MEM_LOCK:
            rows = [dict(w) for w in _MEM["workers"].values() if since is None or _dt(w["beat_at"]) >= since]
            return sorted(rows, key=lambda w: w["beat_at"], reverse=True)
    q, args = "SELECT * FROM watch_workers", []
    if since is not None:
        q += " WHERE beat_at >= %s"
        args.append(since)
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q + " ORDER BY beat_at DESC", args)
        return _rows(cur)


def queue_stats(*, now=None, late_s=900):
    """{"active", "due", "late", "running", "states": {state: n}} over every watch."""
    now = now or _now()
    late_from = now - _td(late_s)
    if backend() == "memory":
        with _MEM_LOCK:
            act = [t for t in _MEM["targets"].values() if t["status"] == "active" and not t["archived_at"]]
            states = {}
            for t in act:
                states[t["state"]] = states.get(t["state"], 0) + 1
            return {"active": len(act),
                    "due": sum(_due_mem(t, now) for t in act),
                    "late": sum(_due_mem(t, now) and (_dt(t["next_check_at"]) or now) < late_from for t in act),
                    "running": sum(bool(_dt(t["lease_until"]) and _dt(t["lease_until"]) > now) for t in act),
                    "states": states}
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT count(*),
                   count(*) FILTER (WHERE (next_check_at IS NULL OR next_check_at <= %(now)s)
                                     AND (lease_until IS NULL OR lease_until <= %(now)s)),
                   count(*) FILTER (WHERE next_check_at < %(late)s
                                     AND (lease_until IS NULL OR lease_until <= %(now)s)),
                   count(*) FILTER (WHERE lease_until > %(now)s)
            FROM watch_targets WHERE status = 'active' AND archived_at IS NULL""", {"now": now, "late": late_from})
        active, due, late, running = cur.fetchone()
        cur.execute("SELECT state, count(*) FROM watch_targets WHERE status = 'active' AND archived_at IS NULL "
                    "GROUP BY state")
        return {"active": active, "due": due, "late": late, "running": running, "states": dict(cur.fetchall())}


# ── Retention ────────────────────────────────────────────────────────────────
KEEP_DAYS = 365          # changes, their pictures and their snapshots
KEEP_CHECK_DAYS = 400    # the check log (a little longer, for the yearly view)
KEEP_CHANGES = 300       # at most this many changes per watch
WORKER_DAYS = 7          # a worker row that has not beaten for this long


def prune(*, now=None):
    """Delete what is past its keeping time. Returns {table: rows deleted}.

    Never deletes a watch's baseline or the reading waiting for its re-check.
    Images no snapshot or change points to any more (a glitch's reading, a
    replaced copy) are deleted once they are a day old.
    """
    now = now or _now()
    old = now - _td(KEEP_DAYS * 86400)
    old_checks = now - _td(KEEP_CHECK_DAYS * 86400)
    day = now - _td(86400)
    old_workers = now - _td(WORKER_DAYS * 86400)
    if backend() == "memory":
        with _MEM_LOCK:
            out = {"checks": 0, "changes": 0, "snapshots": 0, "images": 0, "workers": 0}
            for k in [k for k, c in _MEM["checks"].items() if _dt(c["started_at"]) < old_checks]:
                del _MEM["checks"][k]
                out["checks"] += 1
            by_target = {}
            for c in _MEM["changes"].values():
                by_target.setdefault(c["target_id"], []).append(c)
            for rows in by_target.values():
                rows.sort(key=lambda c: c["id"], reverse=True)
                for i, c in enumerate(rows):
                    if i >= KEEP_CHANGES or _dt(c["created_at"]) < old:
                        del _MEM["changes"][c["id"]]
                        out["changes"] += 1
            keep = {t.get("baseline_id") for t in _MEM["targets"].values()} | \
                   {t.get("pending_id") for t in _MEM["targets"].values()}
            used = set()
            for c in _MEM["changes"].values():
                used |= {c["before_id"], c["after_id"]}
            for k in [k for k, x in _MEM["snapshots"].items()
                      if k not in keep and (k not in used or _dt(x["created_at"]) < old) and _dt(x["created_at"]) < day]:
                del _MEM["snapshots"][k]
                out["snapshots"] += 1
            refs = {c.get("composite_id") for c in _MEM["changes"].values()}
            for x in _MEM["snapshots"].values():
                refs |= {x.get("shot_id"), x.get("thumb_id")}
            for k in [k for k, im in _MEM["images"].items() if k not in refs and _dt(im["created_at"]) < day]:
                del _MEM["images"][k]
                out["images"] += 1
            for k in [k for k, w in _MEM["workers"].items() if _dt(w["beat_at"]) < old_workers]:
                del _MEM["workers"][k]
                out["workers"] += 1
            for k in [k for k, a in _MEM["ai_calls"].items() if _dt(a["created_at"]) < old_checks]:
                del _MEM["ai_calls"][k]
            return out
    out = {}
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM watch_checks WHERE started_at < %s", (old_checks,))
        out["checks"] = cur.rowcount
        cur.execute("""
            DELETE FROM watch_changes WHERE id IN (
                SELECT id FROM (
                    SELECT id, created_at, row_number() OVER (PARTITION BY target_id ORDER BY id DESC) AS n
                    FROM watch_changes) x
                WHERE x.n > %s OR x.created_at < %s)""", (KEEP_CHANGES, old))
        out["changes"] = cur.rowcount
        cur.execute("""
            DELETE FROM watch_snapshots s
            WHERE s.created_at < %(day)s
              AND NOT EXISTS (SELECT 1 FROM watch_targets t WHERE t.baseline_id = s.id OR t.pending_id = s.id)
              AND (s.created_at < %(old)s OR NOT EXISTS (
                    SELECT 1 FROM watch_changes c WHERE c.before_id = s.id OR c.after_id = s.id))""",
                    {"day": day, "old": old})
        out["snapshots"] = cur.rowcount
        cur.execute("""
            DELETE FROM watch_images i
            WHERE i.created_at < %s
              AND NOT EXISTS (SELECT 1 FROM watch_snapshots s WHERE s.shot_id = i.id OR s.thumb_id = i.id)
              AND NOT EXISTS (SELECT 1 FROM watch_changes c WHERE c.composite_id = i.id)""", (day,))
        out["images"] = cur.rowcount
        cur.execute("DELETE FROM watch_workers WHERE beat_at < %s", (old_workers,))
        out["workers"] = cur.rowcount
        cur.execute("DELETE FROM watch_ai_calls WHERE created_at < %s", (old_checks,))
    return out


# ── Claude calls and their cost ──────────────────────────────────────────────
AI_FIELDS = ("email", "target_id", "change_id", "purpose", "model", "ok", "input_tokens", "output_tokens",
             "cache_read_tokens", "searches", "cost_usd", "detail")


def add_ai_call(purpose, *, now=None, **fields):
    """Record one Claude call. Returns its id."""
    bad = set(fields) - set(AI_FIELDS)
    if bad:
        raise ValueError("unknown fields: %s" % ", ".join(sorted(bad)))
    rec = {"email": "", "target_id": None, "change_id": None, "model": "", "ok": True, "input_tokens": 0,
           "output_tokens": 0, "cache_read_tokens": 0, "searches": 0, "cost_usd": 0.0, "detail": ""}
    rec.update(fields)
    rec["purpose"] = purpose
    rec["email"] = _norm_email(rec["email"])
    rec["detail"] = (rec["detail"] or "")[:300]
    now = now or _now()
    if backend() == "memory":
        with _MEM_LOCK:
            aid = _mem_id("ai_calls")
            _MEM["ai_calls"][aid] = dict(rec, id=aid, created_at=now.isoformat())
            return aid
    cols = list(rec) + ["created_at"]
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO watch_ai_calls (%s) VALUES (%s) RETURNING id"
                    % (", ".join(cols), ", ".join(["%s"] * len(cols))), [rec[k] for k in rec] + [now])
        return cur.fetchone()[0]


def ai_spend(since, until=None, email=None):
    """{"calls", "cost_usd", "input_tokens", "output_tokens", "searches"} from `since` on."""
    until = until or _now() + _td(1)
    if backend() == "memory":
        with _MEM_LOCK:
            rows = [r for r in _MEM["ai_calls"].values() if since <= _dt(r["created_at"]) < until
                    and (email is None or r["email"] == _norm_email(email))]
        return {"calls": len(rows), "cost_usd": round(sum(float(r["cost_usd"]) for r in rows), 5),
                "input_tokens": sum(r["input_tokens"] for r in rows),
                "output_tokens": sum(r["output_tokens"] for r in rows),
                "searches": sum(r["searches"] for r in rows)}
    q = ("SELECT count(*), COALESCE(sum(cost_usd), 0), COALESCE(sum(input_tokens), 0), "
         "COALESCE(sum(output_tokens), 0), COALESCE(sum(searches), 0) FROM watch_ai_calls "
         "WHERE created_at >= %s AND created_at < %s")
    args = [since, until]
    if email is not None:
        q += " AND email = %s"
        args.append(_norm_email(email))
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q, args)
        n, cost, tin, tout, searches = cur.fetchone()
        return {"calls": int(n), "cost_usd": round(float(cost), 5), "input_tokens": int(tin),
                "output_tokens": int(tout), "searches": int(searches)}


def list_feedback(target_id, limit=10):
    """The watch's latest changes that someone rated, newest first:
    [{"id", "headline", "verdict", "feedback", "created_at"}]."""
    if backend() == "memory":
        with _MEM_LOCK:
            rows = [c for c in _MEM["changes"].values() if c["target_id"] == target_id and c.get("feedback")]
            rows = sorted(rows, key=lambda c: c["id"], reverse=True)[:limit]
            return [{k: copy.deepcopy(c[k]) for k in ("id", "headline", "verdict", "feedback", "created_at")}
                    for c in rows]
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, headline, verdict, feedback, created_at FROM watch_changes "
                    "WHERE target_id = %s AND feedback IS NOT NULL ORDER BY id DESC LIMIT %s", (target_id, limit))
        return _rows(cur)


# ── The dashboard, in a fixed number of queries ──────────────────────────────
def dashboard(email, strip=30, space=None):
    """The watches of a space (archived ones left out): a client account's ("acct:<id>", everyone's),
    or with no space `email`'s own General ones. Each with:
       checks   its last `strip` checks, newest first [{outcome, started_at, error}]
       latest   its newest change {id, headline, level, verdict, feedback, created_at} or None
       thumb_id the thumbnail of its baseline, or None
    Four queries however many watches there are."""
    from tracker import workspace
    email = _norm_email(email)
    if space is not None and not workspace.is_account(space):
        raise ValueError("not an account's space: %r" % space)
    mine = workspace.personal_spaces(email)

    def wanted(t):
        return t.get("space") == space if space is not None else (t["email"] == email and t.get("space", "") in mine)
    if backend() == "memory":
        with _MEM_LOCK:
            out = []
            for t in sorted((t for t in _MEM["targets"].values() if wanted(t) and not t["archived_at"]),
                            key=lambda t: t["created_at"], reverse=True):
                rec = copy.deepcopy(t)
                checks = sorted((c for c in _MEM["checks"].values() if c["target_id"] == t["id"]),
                                key=lambda c: c["id"], reverse=True)[:strip]
                rec["checks"] = [{"outcome": c["outcome"], "started_at": c["started_at"], "error": c.get("error")}
                                 for c in checks]
                changes = sorted((c for c in _MEM["changes"].values() if c["target_id"] == t["id"]),
                                 key=lambda c: c["id"], reverse=True)
                rec["latest"] = ({k: copy.deepcopy(changes[0][k]) for k in
                                  ("id", "headline", "level", "verdict", "feedback", "created_at")}
                                 if changes else None)
                snap = _MEM["snapshots"].get(t.get("baseline_id"))
                rec["thumb_id"] = snap.get("thumb_id") if snap else None
                out.append(rec)
            return out
    with _pg() as conn, conn.cursor() as cur:
        if space is not None:
            cur.execute("SELECT * FROM watch_targets WHERE space = %s AND archived_at IS NULL "
                        "ORDER BY created_at DESC", [space])
        else:
            cur.execute("SELECT * FROM watch_targets WHERE email = %s AND space = ANY(%s) AND archived_at IS NULL "
                        "ORDER BY created_at DESC", [email, list(mine)])
        targets = _rows(cur)
        if not targets:
            return []
        ids = [t["id"] for t in targets]
        cur.execute("""
            SELECT target_id, outcome, started_at, error FROM (
                SELECT target_id, outcome, started_at, error,
                       row_number() OVER (PARTITION BY target_id ORDER BY id DESC) AS n
                FROM watch_checks WHERE target_id = ANY(%s)) x
            WHERE n <= %s ORDER BY target_id, n""", (ids, strip))
        checks = {}
        for r in _rows(cur):
            checks.setdefault(r.pop("target_id"), []).append(r)
        cur.execute("""
            SELECT DISTINCT ON (target_id) target_id, id, headline, level, verdict, feedback, created_at
            FROM watch_changes WHERE target_id = ANY(%s) ORDER BY target_id, id DESC""", (ids,))
        latest = {r.pop("target_id"): r for r in _rows(cur)}
        cur.execute("SELECT t.id, s.thumb_id FROM watch_targets t JOIN watch_snapshots s ON s.id = t.baseline_id "
                    "WHERE t.id = ANY(%s)", (ids,))
        thumbs = dict(cur.fetchall())
    for t in targets:
        t["checks"] = checks.get(t["id"], [])
        t["latest"] = latest.get(t["id"])
        t["thumb_id"] = thumbs.get(t["id"])
    return targets


# ── Spaces ───────────────────────────────────────────────────────────────────
def claim_legacy(names):
    """Watches saved before spaces whose client is one of `names` ({lower-case name: space}) move to
    that space. Only rows with no space move. Returns how many."""
    if not names:
        return 0
    if backend() == "memory":
        n = 0
        with _MEM_LOCK:
            for t in _MEM["targets"].values():
                to = names.get((t.get("client") or "").strip().lower())
                if not t.get("space") and to:
                    t["space"], n = to, n + 1
        return n
    with _pg() as conn, conn.cursor() as cur:   # one statement, however many names
        cur.execute("UPDATE watch_targets t SET space = m.sp FROM unnest(%s::text[], %s::text[]) AS m(name, sp) "
                    "WHERE t.space = '' AND lower(btrim(t.client)) = m.name", (list(names), list(names.values())))
        return cur.rowcount


def account_counts(email):
    """{space: n} of `email`'s own live watches in client accounts' spaces."""
    from tracker import workspace
    email = _norm_email(email)
    if backend() == "memory":
        out = {}
        with _MEM_LOCK:
            for t in _MEM["targets"].values():
                if t["email"] == email and not t["archived_at"] and workspace.is_account(t.get("space")):
                    out[t["space"]] = out.get(t["space"], 0) + 1
        return out
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("SELECT space, count(*) FROM watch_targets WHERE email = %s AND archived_at IS NULL "
                    "AND space ~ '^acct:[0-9]+$' GROUP BY space", (email,))
        return {k: int(v) for k, v in cur.fetchall()}


def space_targets(space, limit=200):
    """A client account's watches, archived ones too, newest first (its history)."""
    if backend() == "memory":
        with _MEM_LOCK:
            rows = [copy.deepcopy(t) for t in _MEM["targets"].values() if t.get("space") == space]
        return sorted(rows, key=lambda t: t["created_at"], reverse=True)[:limit]
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM watch_targets WHERE space = %s ORDER BY created_at DESC LIMIT %s", (space, limit))
        return _rows(cur)


def space_changes(space, limit=100):
    """A client account's recent page changes, newest first, with their watch's name, url and owner."""
    if backend() == "memory":
        with _MEM_LOCK:
            out = []
            for c in _MEM["changes"].values():
                t = _MEM["targets"].get(c["target_id"])
                if t and t.get("space") == space:
                    out.append(dict(copy.deepcopy(c), name=t.get("name"), url=t["url"], email=t["email"]))
        return sorted(out, key=lambda c: c["id"], reverse=True)[:limit]
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("SELECT c.id, c.target_id, c.level, c.headline, c.verdict, c.created_at, t.name, t.url, t.email "
                    "FROM watch_changes c JOIN watch_targets t ON t.id = c.target_id WHERE t.space = %s "
                    "ORDER BY c.id DESC LIMIT %s", (space, limit))
        return _rows(cur)


# ── Shared values and the alert queue ────────────────────────────────────────
def get_meta(key, default=None):
    if backend() == "memory":
        with _MEM_LOCK:
            return copy.deepcopy(_MEM["meta"].get(key, default))
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("SELECT value FROM watch_meta WHERE key = %s", (key,))
        row = cur.fetchone()
        return row[0] if row else default


def set_meta(key, value):
    if backend() == "memory":
        with _MEM_LOCK:
            _MEM["meta"][key] = copy.deepcopy(value)
            return
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO watch_meta (key, value, updated_at) VALUES (%s, %s, now()) "
                    "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", (key, _j(value)))


def claim_meta(key, value, unless):
    """Set `key` to `value` only if its current value is not `unless`. True
    when this caller set it: the one worker that should post a daily message."""
    if backend() == "memory":
        with _MEM_LOCK:
            if _MEM["meta"].get(key) == unless:
                return False
            _MEM["meta"][key] = copy.deepcopy(value)
            return True
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO watch_meta (key, value, updated_at) VALUES (%(k)s, %(v)s, now())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
            WHERE watch_meta.value IS DISTINCT FROM %(u)s::jsonb RETURNING key""",
                    {"k": key, "v": _j(value), "u": _j(unless)})
        return cur.fetchone() is not None


def queued_alerts(limit=500):
    """Changes waiting for the digest, oldest first, each with its watch:
    [{"change": {...}, "target": {...}}]."""
    if backend() == "memory":
        with _MEM_LOCK:
            rows = sorted((c for c in _MEM["changes"].values() if (c.get("alert") or {}).get("state") == "queued"),
                          key=lambda c: c["id"])[:limit]
            return [{"change": copy.deepcopy(c), "target": copy.deepcopy(_MEM["targets"].get(c["target_id"]))}
                    for c in rows if c["target_id"] in _MEM["targets"]]
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT c.id, c.target_id, c.headline, c.level, c.verdict, c.alert, c.created_at,
                   t.email, t.name, t.url, t.client, t.channel
            FROM watch_changes c JOIN watch_targets t ON t.id = c.target_id
            WHERE c.alert->>'state' = 'queued' ORDER BY c.id LIMIT %s""", (limit,))
        out = []
        for r in _rows(cur):
            out.append({"change": {k: r[k] for k in ("id", "target_id", "headline", "level", "verdict", "alert",
                                                    "created_at")},
                        "target": {"id": r["target_id"], "email": r["email"], "name": r["name"], "url": r["url"],
                                   "client": r["client"], "channel": r["channel"]}})
        return out


def changes_between(since, until):
    """Every change recorded in [since, until), with its watch, for the weekly summary."""
    if backend() == "memory":
        with _MEM_LOCK:
            rows = sorted((c for c in _MEM["changes"].values() if since <= _dt(c["created_at"]) < until),
                          key=lambda c: c["id"])
            return [{"change": copy.deepcopy(c), "target": copy.deepcopy(_MEM["targets"].get(c["target_id"]))}
                    for c in rows if c["target_id"] in _MEM["targets"]]
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT c.id, c.target_id, c.headline, c.level, c.verdict, c.alert, c.created_at,
                   t.email, t.name, t.url, t.client, t.channel
            FROM watch_changes c JOIN watch_targets t ON t.id = c.target_id
            WHERE c.created_at >= %s AND c.created_at < %s ORDER BY c.id""", (since, until))
        return [{"change": {k: r[k] for k in ("id", "target_id", "headline", "level", "verdict", "alert", "created_at")},
                 "target": {"id": r["target_id"], "email": r["email"], "name": r["name"], "url": r["url"],
                            "client": r["client"], "channel": r["channel"]}} for r in _rows(cur)]
