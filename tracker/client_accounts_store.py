"""Client accounts: storage for the URL names (slugs).

Postgres when DATABASE_URL is set (a client's link must survive the next deploy), an in-process
store otherwise, so local runs and the test suite need no database. Both backends expose the same
functions and return the same shapes.

Tables:
  client_accounts           one row per account ever listed: its key (stable across renames), its
                            slug and the name it last had. Rows are never deleted, so a slug is
                            never handed to a different client.
  client_account_old_slugs  slugs an account used before; they redirect to its current one.

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
_MEM = {"rows": {}, "names": {}, "retired": {}}
_MEM_LOCK = threading.Lock()


def reset_memory():
    with _MEM_LOCK:
        _MEM["rows"].clear()
        _MEM["names"].clear()
        _MEM["retired"].clear()


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
            cur.execute("""
                CREATE TABLE IF NOT EXISTS client_account_old_slugs (
                    slug TEXT PRIMARY KEY,
                    key TEXT NOT NULL,
                    retired_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
        conn.commit()
        _READY = True


def _read(cur):
    cur.execute("SELECT key, slug, name FROM client_accounts")
    rows, names = {}, {}
    for key, slug, name in cur.fetchall():
        rows[key], names[key] = slug, name
    cur.execute("SELECT slug, key FROM client_account_old_slugs")
    return rows, names, dict(cur.fetchall())


def load():
    """{"rows": {key: slug}, "retired": {old slug: key}} as stored."""
    if backend() == "memory":
        with _MEM_LOCK:
            return {"rows": dict(_MEM["rows"]), "retired": dict(_MEM["retired"])}
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            rows, _, retired = _read(cur)
    return {"rows": rows, "retired": retired}


def sync(accounts, reserved):
    """Give every account its slug, store what changed, and return {"rows", "retired"} as stored."""
    if backend() == "memory":
        with _MEM_LOCK:
            rows, retired, _ = client_accounts.plan_slugs(accounts, _MEM["rows"], _MEM["retired"], reserved)
            _MEM["rows"], _MEM["retired"] = rows, retired
            for a in accounts:
                _MEM["names"][a["key"]] = a["name"]
            return {"rows": dict(rows), "retired": dict(retired)}
    with _pg() as conn:
        _ensure(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK_KEY,))
            old_rows, old_names, old_retired = _read(cur)
            rows, retired, rekeys = client_accounts.plan_slugs(accounts, old_rows, old_retired, reserved)
            for old, new in rekeys:
                cur.execute("UPDATE client_accounts SET key = %s, updated_at = now() WHERE key = %s", (new, old))
                cur.execute("UPDATE client_account_old_slugs SET key = %s WHERE key = %s", (new, old))
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
    return {"rows": rows, "retired": retired}
