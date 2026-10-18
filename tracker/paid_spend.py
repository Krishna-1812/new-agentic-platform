"""Paid Marketing Agents: what their model calls cost, for the admin panel (tracker/admin_spend.py).

The ported agents write with tracker/market_radar_llm.call_json and no Market Radar run, so nothing books
those calls. Here a request that may spend says who it is for, with `charging(agent, email, space)`, and every
model call made inside it is priced at the model that served it (tracker/market_radar_costs.py) and written
down, one row per call:

    pm_spend   agent, email, space ("acct:<id>" in a client workspace, "" for General), stage, model, usd

A call outside `charging` is not recorded (nothing paid runs there). Recording never fails the agent: a row
that cannot be written is logged, and the page still gets its answer.
"""
from __future__ import annotations

import contextvars
import logging
from contextlib import contextmanager

from . import market_radar_costs as costs
from . import market_radar_llm
from .market_radar_store import StoreUnavailable, _connect  # noqa: F401  (re-exported)

log = logging.getLogger(__name__)

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS pm_spend (
        id BIGSERIAL PRIMARY KEY,
        agent TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        space TEXT NOT NULL DEFAULT '',
        stage TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    "CREATE INDEX IF NOT EXISTS idx_pm_spend_at ON pm_spend (created_at DESC)",
]
_READY = False
_who = contextvars.ContextVar("pm_spend_who", default=None)


def _ensure():
    global _READY
    if _READY:
        return
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(hashtext('pm-spend-v1'))")
            for statement in SCHEMA:
                cur.execute(statement)
        conn.commit()
    finally:
        conn.close()
    _READY = True


def record(agent, email, space, stage, model, usd):
    _ensure()
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO pm_spend (agent, email, space, stage, model, usd) VALUES (%s, %s, %s, %s, %s, %s)",
                        (agent, (email or "").lower(), space or "", stage or "", model or "", usd))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@contextmanager
def charging(agent, email, space=""):
    """Every model call inside this block is booked to the agent, the person and the workspace."""
    token = _who.set((agent, email or "", space or ""))
    try:
        yield
    finally:
        _who.reset(token)


def observe(stage, model, usage):
    """market_radar_llm's hook: one model call made outside a Market Radar run."""
    who = _who.get()
    if who is None or not usage:
        return
    try:
        usd, _ = costs.model_cost(model, usage)
    except (ValueError, costs.UnknownPrice) as e:
        log.warning("paid marketing: %s call on %s not priced: %s", who[0], model, e)
        return
    try:
        record(who[0], who[1], who[2], stage, model, usd)
    except Exception:
        log.exception("paid marketing: %s spend not recorded", who[0])


if observe not in market_radar_llm.OBSERVERS:
    market_radar_llm.OBSERVERS.append(observe)
