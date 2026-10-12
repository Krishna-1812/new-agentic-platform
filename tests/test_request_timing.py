"""The per-request timing (tracker/request_timing.py): what it counts, who sees it, and that it only logs slow requests."""
import logging
import os
import sys
import time

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import app as appmod  # noqa: E402
from tracker import request_timing as rt  # noqa: E402


def _client(email=None):
    c = appmod.app.test_client()
    if email:
        with c.session_transaction() as s:
            s["google_user"] = {"email": email, "name": "T"}
    return c


def test_staff_see_where_the_time_went_and_nobody_else_does(monkeypatch):
    monkeypatch.setattr(appmod, "ADMIN_EMAILS", set(appmod.ADMIN_EMAILS) | {"me@example.com"})
    value = _client("me@example.com").get("/health").headers.get("Server-Timing")
    assert value and value.startswith("app;dur=") and 'db-connect;dur=0;desc="0 connections"' in value
    assert "Server-Timing" not in _client().get("/health").headers
    assert "Server-Timing" not in _client("someone@gmail.example").get("/health").headers


def test_each_database_connection_in_a_request_is_counted_and_timed():
    import psycopg2
    assert getattr(psycopg2.connect, "_timed", False), "installed once at start-up"

    def slow(*a, **k):
        time.sleep(0.02)
        return "conn"

    connect = rt.wrap(slow, appmod.g, appmod._has_request_context)
    with appmod.app.test_request_context("/x"):
        rt.begin(appmod.g)
        assert connect("postgresql://nowhere") == "conn" and connect("postgresql://nowhere") == "conn"
        assert appmod.g._pg_connects == 2 and appmod.g._pg_connect_s >= 0.04
        value = rt.finish(appmod.g, "GET", "/x", 200, staff=True, logger=logging.getLogger("t"))
        assert 'desc="2 connections"' in value


def test_a_connection_outside_a_request_is_not_counted_and_a_failure_still_propagates():
    connect = rt.wrap(lambda *a, **k: "ok", appmod.g, appmod._has_request_context)
    assert connect("x") == "ok"

    def refused(*a, **k):
        raise OSError("refused")

    broken = rt.wrap(refused, appmod.g, appmod._has_request_context)
    with appmod.app.test_request_context("/x"):
        try:
            broken("x")
        except OSError:
            pass
        else:
            raise AssertionError("the error must reach the caller")
        assert appmod.g._pg_connects == 1, "a refused connection took time too"


def test_only_a_slow_request_is_logged_and_never_with_its_query_string(caplog):
    log = logging.getLogger("timing-test")
    with appmod.app.test_request_context("/page?token=secret"):
        rt.begin(appmod.g)
        with caplog.at_level(logging.WARNING, logger="timing-test"):
            rt.finish(appmod.g, "GET", "/page", 200, staff=False, logger=log)
        assert caplog.records == [], "a fast request is not logged"
        appmod.g._t0 -= rt.SLOW_REQUEST_S + 1
        appmod.g._pg_connects, appmod.g._pg_connect_s = 5, 1.2
        with caplog.at_level(logging.WARNING, logger="timing-test"):
            assert rt.finish(appmod.g, "GET", "/page", 200, staff=False, logger=log) == ""
        (rec,) = caplog.records
        assert "/page -> 200" in rec.getMessage() and "5 connections took 1.20s" in rec.getMessage()
        assert "secret" not in rec.getMessage()
        caplog.clear()
        appmod.g._t0 -= 99
        with caplog.at_level(logging.WARNING, logger="timing-test"):
            rt.finish(appmod.g, "GET", "/static/app.js", 200, staff=False, logger=log)
        assert caplog.records == [], "static files are not logged"
