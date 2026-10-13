"""Reused Postgres connections (tracker/db_pool.py), against a real Postgres (skipped where there is none; CI has one)."""
import os
import sys
import time

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tests.test_market_radar_store import pg  # noqa: E402,F401  (fixture: a throwaway Postgres, DATABASE_URL set)
from tracker import db_pool  # noqa: E402


@pytest.fixture
def pool(pg, monkeypatch):
    monkeypatch.delenv("DB_POOL", raising=False)
    with db_pool._lock:
        for items in db_pool._idle.values():
            for conn, _b, _l in items:
                db_pool._close(conn)
        db_pool._idle.clear()
    for k in db_pool._stats:
        db_pool._stats[k] = 0
    return db_pool


def url():
    return os.environ["DATABASE_URL"]


def backend_pid(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT pg_backend_pid()")
        return cur.fetchone()[0]


def test_a_closed_connection_is_the_next_callers_and_is_not_a_new_login(pool):
    a = pool.connect(url(), connect_timeout=8)
    pid = backend_pid(a)
    a.close()
    b = pool.connect(url(), connect_timeout=8)
    assert backend_pid(b) == pid
    assert pool.stats()["hits"] == 1 and pool.stats()["new"] == 1
    b.close()


def test_what_one_caller_did_not_commit_is_never_seen_by_the_next(pool):
    a = pool.connect(url(), connect_timeout=8)
    with a.cursor() as cur:
        cur.execute("CREATE TABLE pool_t (v int)")
    a.commit()
    with a.cursor() as cur:
        cur.execute("INSERT INTO pool_t VALUES (1)")        # never committed
    a.close()
    b = pool.connect(url(), connect_timeout=8)
    with b.cursor() as cur:
        cur.execute("SELECT count(*) FROM pool_t")
        assert cur.fetchone()[0] == 0
    b.close()


def test_autocommit_is_switched_back_off_for_the_next_caller(pool):
    a = pool.connect(url(), connect_timeout=8)
    a.autocommit = True
    a.close()
    b = pool.connect(url(), connect_timeout=8)
    assert b.autocommit is False
    b.close()


def test_a_closed_handle_cannot_be_used_and_closing_twice_is_harmless(pool):
    import psycopg2
    a = pool.connect(url(), connect_timeout=8)
    a.close()
    a.close()
    assert a.closed
    with pytest.raises(psycopg2.InterfaceError):
        a.cursor()
    b = pool.connect(url(), connect_timeout=8)        # the connection the dead handle used is b's alone
    with b.cursor() as cur:
        cur.execute("SELECT 1")
    b.close()


def test_with_commits_and_leaves_the_connection_open_like_psycopg2s_own(pool):
    a = pool.connect(url(), connect_timeout=8)
    with a, a.cursor() as cur:
        cur.execute("CREATE TABLE pool_w (v int)")
        cur.execute("INSERT INTO pool_w VALUES (7)")
    assert not a.closed
    a.close()
    b = pool.connect(url(), connect_timeout=8)
    with b.cursor() as cur:
        cur.execute("SELECT v FROM pool_w")
        assert cur.fetchone()[0] == 7
    b.close()


def test_a_connection_the_server_dropped_while_idle_is_replaced_not_an_error(pool, monkeypatch):
    a = pool.connect(url(), connect_timeout=8)
    pid = backend_pid(a)
    a.close()
    killer = pool.connect(url(), connect_timeout=8, application_name="killer")
    killer.autocommit = True
    with killer.cursor() as cur:
        cur.execute("SELECT pg_terminate_backend(%s)", (pid,))
    killer.close()
    monkeypatch.setattr(db_pool, "CHECK_AFTER_S", 0)            # as if it had sat idle a while
    time.sleep(0.05)
    b = pool.connect(url(), connect_timeout=8)
    assert backend_pid(b) != pid
    with b.cursor() as cur:
        cur.execute("SELECT 1")
        assert cur.fetchone()[0] == 1
    b.close()


def test_only_a_few_are_kept_idle_and_old_ones_are_not_reused(pool, monkeypatch):
    monkeypatch.setattr(db_pool, "IDLE_PER_ADDRESS", 2)
    held = [pool.connect(url(), connect_timeout=8) for _ in range(4)]
    for c in held:
        c.close()
    assert pool.stats()["idle"] == 2
    monkeypatch.setattr(db_pool, "MAX_AGE_S", -1)
    c = pool.connect(url(), connect_timeout=8)
    assert pool.stats()["hits"] == 0, "past its age, so a new one"
    c.close()
    assert pool.stats()["idle"] <= 2


def test_turning_it_off_gives_plain_connections(pool, monkeypatch):
    import psycopg2.extensions
    monkeypatch.setenv("DB_POOL", "off")
    c = pool.connect(url(), connect_timeout=8)
    assert isinstance(c, psycopg2.extensions.connection)
    c.close()
    assert pool.stats()["idle"] == 0


def test_something_that_is_not_a_real_connection_is_returned_as_it_is(pool, monkeypatch):
    import psycopg2
    fake = object()
    monkeypatch.setattr(psycopg2, "connect", lambda *a, **k: fake)
    assert pool.connect("anything") is fake


def test_the_advisory_lock_is_never_on_a_pooled_connection(pool):
    from tracker import market_radar_store as store
    with store.advisory_lock(424242) as first:
        assert first is True
        with store.advisory_lock(424242) as second:
            assert second is False, "held by another session while the first block runs"
    with store.advisory_lock(424242) as again:
        assert again is True, "released when the block ended"
    # nothing locked was handed to the pool
    c = pool.connect(url(), connect_timeout=8)
    with c.cursor() as cur:
        cur.execute("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()")
        assert cur.fetchone()[0] == 0
    c.close()
