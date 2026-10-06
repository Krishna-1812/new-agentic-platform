"""People's names, for "by Kris" on shared work.

Google sends a name with every sign-in; it is kept here by email, so a page can say who ran a piece of
work without anyone else's session. Postgres when DATABASE_URL is set, an in-process store otherwise.
"""

from __future__ import annotations

import contextlib
import os
import threading

_MEM = {}
_MEM_LOCK = threading.Lock()
_READY = False


def backend():
    return "postgres" if os.environ.get("DATABASE_URL") else "memory"


def reset_memory():
    with _MEM_LOCK:
        _MEM.clear()


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
                    CREATE TABLE IF NOT EXISTS people (
                        email TEXT PRIMARY KEY,
                        name TEXT NOT NULL DEFAULT '',
                        seen_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
            conn.commit()
            _READY = True
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def remember(email, name):
    email, name = _norm(email), " ".join((name or "").split())[:120]
    if not email:
        return
    if backend() == "memory":
        with _MEM_LOCK:
            _MEM[email] = name or _MEM.get(email, "")
        return
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO people (email, name) VALUES (%s, %s) ON CONFLICT (email) DO UPDATE SET "
                    "name = CASE WHEN EXCLUDED.name = '' THEN people.name ELSE EXCLUDED.name END, seen_at = now()",
                    (email, name))


def names(emails):
    """{email: name} for those with one stored."""
    want = sorted({_norm(e) for e in emails if e})
    if not want:
        return {}
    if backend() == "memory":
        with _MEM_LOCK:
            return {e: _MEM[e] for e in want if _MEM.get(e)}
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("SELECT email, name FROM people WHERE email = ANY(%s) AND name <> ''", (want,))
        return dict(cur.fetchall())


def display(email, known=None):
    """The person's name when known, else their address's name part: "kris@x" is "Kris"."""
    email = _norm(email)
    name = (known if known is not None else names([email])).get(email, "")
    if name:
        return name
    local = email.split("@")[0].replace(".", " ").replace("_", " ").replace("-", " ").split()
    return (local[0].title() if local else email) or "Someone"
