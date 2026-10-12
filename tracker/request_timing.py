"""Where a slow page spends its time.

Every store here opens a fresh Postgres connection for each query (tracker/*_store.py). Across the public
database address, one connection costs a TCP and TLS handshake and a login, so a page that reads the database
five times can wait a second before it renders anything. This measures it instead of guessing:

  * `install()` wraps psycopg2.connect once, counting the connections a request makes and the time they took;
  * `begin()` / `finish()` bracket a request. `finish()` returns a Server-Timing header value (shown to staff in
    the browser's Network tab, under Timing) and logs one line for any request slower than SLOW_REQUEST_S.

Nothing here changes what a page does. Free, no model, no key.
"""
from __future__ import annotations

import os
import time

SLOW_REQUEST_S = float(os.environ.get("SLOW_REQUEST_S") or 1.5)


def wrap(real, flask_g, in_request):
    """`real` (a connect function) counting and timing its calls for the request being served."""
    def timed(*args, **kwargs):
        t0 = time.perf_counter()
        try:
            return real(*args, **kwargs)
        finally:
            if in_request():
                flask_g._pg_connects = getattr(flask_g, "_pg_connects", 0) + 1
                flask_g._pg_connect_s = getattr(flask_g, "_pg_connect_s", 0.0) + (time.perf_counter() - t0)

    timed._timed = True
    return timed


def install(flask_g, in_request):
    """Wrap psycopg2.connect once, for every store. Safe to call twice."""
    try:
        import psycopg2
    except ImportError:
        return False
    if not getattr(psycopg2.connect, "_timed", False):
        psycopg2.connect = wrap(psycopg2.connect, flask_g, in_request)
    return True


def begin(flask_g):
    flask_g._t0 = time.perf_counter()


def finish(flask_g, method, path, status, *, staff, logger):
    """The Server-Timing value for staff ('' for anyone else); logs a slow request."""
    t0 = getattr(flask_g, "_t0", None)
    if t0 is None:
        return ""
    total = time.perf_counter() - t0
    n = getattr(flask_g, "_pg_connects", 0)
    connect_s = getattr(flask_g, "_pg_connect_s", 0.0)
    if total >= SLOW_REQUEST_S and not path.startswith("/static/"):
        # The path only, never the query string: it can carry a token or a search.
        logger.warning("slow request: %s %s -> %s in %.2fs (database: %d connections took %.2fs)",
                       method, path, status, total, n, connect_s)
    if not staff:
        return ""
    return 'app;dur=%.0f, db-connect;dur=%.0f;desc="%d connections"' % (total * 1000, connect_s * 1000, n)
