"""Client accounts: storage for the URL names (slugs).

Postgres when DATABASE_URL is set (a client's link must survive the next deploy), an in-process
store otherwise, so local runs and the test suite need no database. Both backends expose the same
functions and return the same shapes.

Tables:
  client_accounts           one row per account ever listed: its key (stable across renames), its
                            slug, the name it last had, and its id. Rows are never deleted, so a slug
                            is never handed to a different client. The id never changes, even when
                            the key does (an account that gains Google Ads): work saved for the
                            account is filed under it (tracker/workspace.py).
  client_account_old_slugs  slugs an account used before; they redirect to its current one.
  client_account_access     who outside the agency may open an account: an email, or "@domain"
                            (tracker/client_access.py). Follows the account's key when it changes.
  client_account_shares     which of an account's pages its clients see.
  client_account_audit      every invite, removal and share change: who, what, when.

sync() works out the slugs (client_accounts.plan_slugs) under an advisory lock, so two web workers
listing the accounts at the same moment cannot give one slug twice, and writes only what changed.
"""

from __future__ import annotations

import contextlib
import logging
import os
import threading

from tracker import client_accounts

log = logging.getLogger(__name__)
LOCK_KEY = 0x6361636374   # "cacct": the advisory lock that serialises sync()


def backend():
    return "postgres" if os.environ.get("DATABASE_URL") else "memory"


# ── Memory ───────────────────────────────────────────────────────────────────
_MEM = {"rows": {}, "names": {}, "retired": {}, "access": {}, "shares": {}, "audit": [], "ids": {}}
_MEM_LOCK = threading.Lock()


def reset_memory():
    with _MEM_LOCK:
        for v in _MEM.values():
            v.clear()


# ── Postgres ─────────────────────────────────────────────────────────────────
_READY = False
_READY_LOCK = threading.Lock()


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
    global _READY
    if _READY:
        return
    with _READY_LOCK:
        if _READY:
            return
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS client_accounts (
                    key TEXT PRIMARY KEY,
                    slug TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
            cur.execute("ALTER TABLE client_accounts ADD COLUMN IF NOT EXISTS id BIGSERIAL")
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS client_accounts_id ON client_accounts (id)")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS client_account_old_slugs (
                    slug TEXT PRIMARY KEY,
                    key TEXT NOT NULL,
                    retired_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS client_account_access (
                    key TEXT NOT NULL REFERENCES client_accounts(key) ON UPDATE CASCADE ON DELETE CASCADE,
                    who TEXT NOT NULL,
                    added_by TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    PRIMARY KEY (key, who))""")
            cur.execute("CREATE INDEX IF NOT EXISTS client_account_access_who ON client_account_access (who)")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS client_account_shares (
                    key TEXT PRIMARY KEY REFERENCES client_accounts(key) ON UPDATE CASCADE ON DELETE CASCADE,
                    shares JSONB NOT NULL DEFAULT '{}'::jsonb,
                    updated_by TEXT NOT NULL DEFAULT '',
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS client_account_audit (
                    id BIGSERIAL PRIMARY KEY,
                    key TEXT NOT NULL,
                    actor TEXT NOT NULL DEFAULT '',
                    action TEXT NOT NULL,
                    detail TEXT NOT NULL DEFAULT '',
                    at TIMESTAMPTZ NOT NULL DEFAULT now())""")
            cur.execute("CREATE INDEX IF NOT EXISTS client_account_audit_key ON client_account_audit (key, id DESC)")
        conn.commit()
        _READY = True


def _read(cur):
    cur.execute("SELECT key, slug, name FROM client_accounts")
    rows, names = {}, {}
    for key, slug, name in cur.fetchall():
        rows[key], names[key] = slug, name
    cur.execute("SELECT slug, key FROM client_account_old_slugs")
    return rows, names, dict(cur.fetchall())


def _ids(cur):
    cur.execute("SELECT key, id FROM client_accounts")
    return {k: int(i) for k, i in cur.fetchall()}


def load():
    """{"rows": {key: slug}, "retired": {old slug: key}, "ids": {key: id}} as stored."""
    if backend() == "memory":
        with _MEM_LOCK:
            return {"rows": dict(_MEM["rows"]), "retired": dict(_MEM["retired"]), "ids": dict(_MEM["ids"])}
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            rows, _, retired = _read(cur)
            ids = _ids(cur)
    return {"rows": rows, "retired": retired, "ids": ids}


def sync(accounts, reserved):
    """Give every account its slug, store what changed, and return {"rows", "retired", "ids"} as stored."""
    if backend() == "memory":
        with _MEM_LOCK:
            rows, retired, rekeys = client_accounts.plan_slugs(accounts, _MEM["rows"], _MEM["retired"], reserved)
            _MEM["rows"], _MEM["retired"] = rows, retired
            for old, new in rekeys:          # invites and shares follow the account to its new key
                for table in ("access", "shares"):
                    if old in _MEM[table]:
                        _MEM[table][new] = _MEM[table].pop(old)
                for a in _MEM["audit"]:
                    if a["key"] == old:
                        a["key"] = new
                if old in _MEM["ids"]:
                    _MEM["ids"][new] = _MEM["ids"].pop(old)
            for k in rows:
                if k not in _MEM["ids"]:
                    _MEM["ids"][k] = max(_MEM["ids"].values(), default=0) + 1
            for a in accounts:
                _MEM["names"][a["key"]] = a["name"]
            return {"rows": dict(rows), "retired": dict(retired), "ids": dict(_MEM["ids"])}
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK_KEY,))
            old_rows, old_names, old_retired = _read(cur)
            rows, retired, rekeys = client_accounts.plan_slugs(accounts, old_rows, old_retired, reserved)
            for old, new in rekeys:
                cur.execute("UPDATE client_accounts SET key = %s, updated_at = now() WHERE key = %s", (new, old))
                cur.execute("UPDATE client_account_old_slugs SET key = %s WHERE key = %s", (new, old))
                cur.execute("UPDATE client_account_audit SET key = %s WHERE key = %s", (new, old))
                old_rows[new] = old_rows.pop(old)
                old_names[new] = old_names.pop(old, "")
            # Retire first: a slug leaving one row must be free before another row takes it.
            for slug, key in retired.items():
                if old_retired.get(slug) != key:
                    cur.execute("""INSERT INTO client_account_old_slugs (slug, key) VALUES (%s, %s)
                                   ON CONFLICT (slug) DO UPDATE SET key = EXCLUDED.key, retired_at = now()""",
                                (slug, key))
            for slug in set(old_retired) - set(retired):
                cur.execute("DELETE FROM client_account_old_slugs WHERE slug = %s", (slug,))
            names = {a["key"]: a["name"] for a in accounts}
            moved = [k for k, s in rows.items() if k in old_rows and old_rows[k] != s]
            for k in moved:        # park, then set, so two moves can never collide mid-way
                cur.execute("UPDATE client_accounts SET slug = %s WHERE key = %s", ("~" + k, k))
            for k in moved:
                cur.execute("UPDATE client_accounts SET slug = %s, name = %s, updated_at = now() WHERE key = %s",
                            (rows[k], names.get(k, old_names.get(k, "")), k))
            for k, s in rows.items():
                if k not in old_rows:
                    cur.execute("INSERT INTO client_accounts (key, slug, name) VALUES (%s, %s, %s)",
                                (k, s, names.get(k, "")))
                elif k in names and names[k] != old_names.get(k) and k not in moved:
                    cur.execute("UPDATE client_accounts SET name = %s, updated_at = now() WHERE key = %s",
                                (names[k], k))
            ids = _ids(cur)
    return {"rows": rows, "retired": retired, "ids": ids}


# ── Who may open an account, and what they see ──────────────────────────────
def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc)


def _audit(cur, key, actor, action, detail):
    if cur is None:
        _MEM["audit"].append({"key": key, "actor": actor, "action": action, "detail": detail, "at": _now()})
    else:
        cur.execute("INSERT INTO client_account_audit (key, actor, action, detail) VALUES (%s, %s, %s, %s)",
                    (key, actor, action, detail))


def access(key):
    """The account's invites, oldest first: [{"who", "added_by", "created_at"}]."""
    if backend() == "memory":
        with _MEM_LOCK:
            return [dict(e) for e in sorted(_MEM["access"].get(key, {}).values(), key=lambda e: e["created_at"])]
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT who, added_by, created_at FROM client_account_access WHERE key = %s "
                        "ORDER BY created_at, who", (key,))
            return [{"who": w, "added_by": b, "created_at": c} for w, b, c in cur.fetchall()]


def add_access(key, who, actor):
    """Invite `who` (already normalised); False when it was there already."""
    if backend() == "memory":
        with _MEM_LOCK:
            have = _MEM["access"].setdefault(key, {})
            if who in have:
                return False
            have[who] = {"who": who, "added_by": actor, "created_at": _now()}
            _audit(None, key, actor, "invited", who)
            return True
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("INSERT INTO client_account_access (key, who, added_by) VALUES (%s, %s, %s) "
                        "ON CONFLICT DO NOTHING", (key, who, actor))
            if not cur.rowcount:
                return False
            _audit(cur, key, actor, "invited", who)
            return True


def remove_access(key, who, actor):
    if backend() == "memory":
        with _MEM_LOCK:
            if _MEM["access"].get(key, {}).pop(who, None) is None:
                return False
            _audit(None, key, actor, "removed", who)
            return True
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("DELETE FROM client_account_access WHERE key = %s AND who = %s", (key, who))
            if not cur.rowcount:
                return False
            _audit(cur, key, actor, "removed", who)
            return True


def keys_for(email):
    """The keys of every account an address is invited to, itself or by its domain."""
    e = (email or "").strip().lower()
    if "@" not in e:
        return set()
    whos = (e, "@" + e.rsplit("@", 1)[1])
    if backend() == "memory":
        with _MEM_LOCK:
            return {k for k, have in _MEM["access"].items() if any(w in have for w in whos)}
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT key FROM client_account_access WHERE who = ANY(%s)", (list(whos),))
            return {k for (k,) in cur.fetchall()}


def shares(key):
    """The account's stored share choices ({} until someone changes one)."""
    if backend() == "memory":
        with _MEM_LOCK:
            return dict(_MEM["shares"].get(key, {}))
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT shares FROM client_account_shares WHERE key = %s", (key,))
            row = cur.fetchone()
            return dict(row[0]) if row else {}


def set_share(key, share, on, actor):
    import json
    if backend() == "memory":
        with _MEM_LOCK:
            _MEM["shares"].setdefault(key, {})[share] = bool(on)
            _audit(None, key, actor, "shared" if on else "unshared", share)
            return
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("""INSERT INTO client_account_shares (key, shares, updated_by) VALUES (%s, %s::jsonb, %s)
                           ON CONFLICT (key) DO UPDATE SET shares = client_account_shares.shares || EXCLUDED.shares,
                           updated_by = EXCLUDED.updated_by, updated_at = now()""",
                        (key, json.dumps({share: bool(on)}), actor))
            _audit(cur, key, actor, "shared" if on else "unshared", share)


def audit(key, limit=20):
    """The account's latest access changes, newest first."""
    if backend() == "memory":
        with _MEM_LOCK:
            rows = [dict(a) for a in _MEM["audit"] if a["key"] == key]
        return list(reversed(rows))[:limit]
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT actor, action, detail, at FROM client_account_audit WHERE key = %s "
                        "ORDER BY id DESC LIMIT %s", (key, limit))
            return [{"actor": a, "action": b, "detail": c, "at": d} for a, b, c, d in cur.fetchall()]
