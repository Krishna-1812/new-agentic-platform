"""Reused Postgres connections.

Every store used to open a new connection for each query and close it after. A new connection is several
round trips (TCP, login, settings) before the first query, so a page that reads the database a few times
spent most of its database time just connecting, and across a long distance (a web service in one region and
its database in another) each connection costs a second or more.

    db_pool.connect(dsn, connect_timeout=8)   a drop-in for psycopg2.connect

The result behaves like the connection it stands for. `close()` does not close it: the connection goes back to
the pool, rolled back and with autocommit off, and the next caller gets it. Rules that keep that safe:

  * the stores that keep a session-level state (an advisory lock held across calls, `SET statement_timeout`,
    autocommit) do not use this, and call psycopg2.connect themselves;
  * a connection idle for DB_POOL_CHECK_S seconds is tested with SELECT 1 before it is handed out, and one that
    fails is dropped and replaced, so a database restart or a dropped idle link costs one extra connect, never
    an error;
  * a connection lives at most DB_POOL_MAX_AGE_S seconds, and at most DB_POOL_IDLE are kept idle per address;
  * a closed handle can no longer be used, as with a real closed connection (it could otherwise write over
    another caller's transaction);
  * DB_POOL=off in the environment goes back to a new connection each time, at once, with no deploy.

Only real psycopg2 connections are pooled; anything else (a test's fake) is returned as it is.
"""
from __future__ import annotations

import os
import threading
import time

IDLE_PER_ADDRESS = int(os.environ.get("DB_POOL_IDLE") or 4)
IDLE_TOTAL = 16
MAX_AGE_S = float(os.environ.get("DB_POOL_MAX_AGE_S") or 300)
CHECK_AFTER_S = float(os.environ.get("DB_POOL_CHECK_S") or 20)
# A dead link is noticed in about a minute instead of never.
KEEPALIVES = {"keepalives": 1, "keepalives_idle": 30, "keepalives_interval": 10, "keepalives_count": 3}

_lock = threading.Lock()
_idle = {}            # key -> [(connection, born, last_used)], newest last
_orphans = []         # connections inherited across a fork: never touched, never closed (the parent uses them)
_pid = [os.getpid()]
_stats = {"hits": 0, "new": 0, "dropped": 0}


def enabled():
    return (os.environ.get("DB_POOL") or "on").strip().lower() not in ("off", "0", "false", "no")


def stats():
    with _lock:
        return dict(_stats, idle=sum(len(v) for v in _idle.values()))


def _after_fork():
    if _pid[0] != os.getpid():
        _pid[0] = os.getpid()
        with _lock:
            for items in _idle.values():
                _orphans.extend(c for c, _b, _l in items)
            _idle.clear()


def _close(conn):
    try:
        conn.close()
    except Exception:
        pass


def _real_connection(conn):
    try:
        import psycopg2.extensions
        return isinstance(conn, psycopg2.extensions.connection)
    except ImportError:
        return False


class PooledConnection:
    """What the stores hold. Everything is the real connection's, except close()."""
    __slots__ = ("_conn", "_key", "_born")

    def __init__(self, conn, key, born):
        object.__setattr__(self, "_conn", conn)
        object.__setattr__(self, "_key", key)
        object.__setattr__(self, "_born", born)

    def _live(self):
        conn = object.__getattribute__(self, "_conn")
        if conn is None:
            import psycopg2
            raise psycopg2.InterfaceError("connection already closed")
        return conn

    def __getattr__(self, name):
        return getattr(self._live(), name)

    def __setattr__(self, name, value):
        setattr(self._live(), name, value)

    def __enter__(self):
        self._live().__enter__()
        return self

    def __exit__(self, *exc):
        return self._live().__exit__(*exc)

    @property
    def closed(self):
        conn = object.__getattribute__(self, "_conn")
        return 1 if conn is None else conn.closed

    def close(self):
        conn = object.__getattribute__(self, "_conn")
        if conn is None:
            return
        object.__setattr__(self, "_conn", None)
        _release(conn, object.__getattribute__(self, "_key"), object.__getattribute__(self, "_born"))


def _release(conn, key, born):
    import psycopg2.extensions as ext
    try:
        if conn.closed:
            return
        if conn.get_transaction_status() != ext.TRANSACTION_STATUS_IDLE:
            conn.rollback()
        if conn.autocommit:
            conn.autocommit = False
        if conn.get_transaction_status() != ext.TRANSACTION_STATUS_IDLE or time.monotonic() - born > MAX_AGE_S:
            _close(conn)
            return
    except Exception:
        _close(conn)
        return
    _after_fork()
    with _lock:
        items = _idle.setdefault(key, [])
        total = sum(len(v) for v in _idle.values())
        if len(items) >= IDLE_PER_ADDRESS or total >= IDLE_TOTAL:
            victim = (items.pop(0) if items else None)
            if victim:
                _close(victim[0])
                _stats["dropped"] += 1
            elif total >= IDLE_TOTAL:
                _close(conn)
                _stats["dropped"] += 1
                return
        items.append((conn, born, time.monotonic()))


def _alive(conn):
    try:
        if conn.closed:
            return False
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        conn.rollback()
        return True
    except Exception:
        _close(conn)
        return False


def connect(dsn, **kwargs):
    """A drop-in for psycopg2.connect (see the module docstring)."""
    import psycopg2
    if not enabled():
        return psycopg2.connect(dsn, **kwargs)
    _after_fork()
    key = (dsn, tuple(sorted((k, repr(v)) for k, v in kwargs.items())))
    while True:
        with _lock:
            items = _idle.get(key)
            entry = items.pop() if items else None
        if entry is None:
            break
        conn, born, last = entry
        if time.monotonic() - born > MAX_AGE_S:
            _close(conn)
            continue
        if time.monotonic() - last > CHECK_AFTER_S and not _alive(conn):
            _stats["dropped"] += 1
            continue
        _stats["hits"] += 1
        return PooledConnection(conn, key, born)
    raw = psycopg2.connect(dsn, **dict(KEEPALIVES, **kwargs))
    if not _real_connection(raw):
        return raw
    _stats["new"] += 1
    return PooledConnection(raw, key, time.monotonic())
