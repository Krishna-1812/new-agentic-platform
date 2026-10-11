"""Contact Finder Lab: its runs, in Postgres (cl_runs), and the background
runner that fills them.

    run_id = start(settings, owner_email)    # returns at once
    get_run(run_id, owner_email)             # poll; the summary fills in per company

A run is one thread; it records its stage while it works and its summary
after every company, so a long run shows its results as they come and a run
cut short by a deploy keeps what it had. Spending is capped per run
(tracker/contact_lab_search.Budget) and recorded with the summary.
"""
from __future__ import annotations

import json
import logging
import threading
import traceback
from decimal import Decimal

from .market_radar_store import StoreUnavailable, _connect  # noqa: F401  (re-exported)

logger = logging.getLogger(__name__)
STALE_AFTER_S = 900

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS cl_runs (
        id BIGSERIAL PRIMARY KEY,
        owner_email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running'
            CHECK (status IN ('running','complete','failed')),
        stage TEXT,
        settings JSONB NOT NULL,
        summary JSONB,
        error TEXT,
        cost_cap_usd NUMERIC(10,4) NOT NULL,
        spent_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    "CREATE INDEX IF NOT EXISTS idx_cl_runs_owner ON cl_runs (owner_email, created_at DESC)",
]
_READY = False


def _ensure():
    global _READY
    if _READY:
        return
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(hashtext('cl-schema-v1'))")
            for statement in SCHEMA:
                cur.execute(statement)
        conn.commit()
    finally:
        conn.close()
    _READY = True


def _exec(sql, params=(), fetch=None):
    _ensure()
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall() if fetch == "all" else cur.fetchone() if fetch == "one" else None
        conn.commit()
        return rows
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _json(value):
    return json.dumps(value, default=lambda o: float(o) if isinstance(o, Decimal) else str(o))


def create_run(owner_email, settings, cap_usd):
    row = _exec("""INSERT INTO cl_runs (owner_email, settings, cost_cap_usd, stage)
                   VALUES (%s, %s, %s, 'queued') RETURNING id""",
                (owner_email, _json(settings), Decimal(str(cap_usd))), fetch="one")
    return row[0]


def update_run(run_id, *, status=None, stage=None, summary=None, error=None, spent=None):
    sets, params = ["updated_at=now()"], []
    for col, val in (("status", status), ("stage", stage), ("error", error)):
        if val is not None:
            sets.append("%s=%%s" % col)
            params.append(val)
    if summary is not None:
        sets.append("summary=%s")
        params.append(_json(summary))
    if spent is not None:
        sets.append("spent_usd=%s")
        params.append(Decimal(str(spent)))
    params.append(run_id)
    _exec("UPDATE cl_runs SET %s WHERE id=%%s" % ", ".join(sets), params)


COLS = ("id", "status", "stage", "settings", "summary", "error", "cost_cap_usd", "spent_usd",
        "created_at", "updated_at", "idle_seconds")


def _row(r):
    out = dict(zip(COLS, r))
    for k in ("cost_cap_usd", "spent_usd"):
        out[k] = float(out[k]) if out[k] is not None else None
    for k in ("created_at", "updated_at"):
        out[k] = out[k].isoformat() if out[k] else None
    out["idle_seconds"] = int(out["idle_seconds"] or 0)
    if out["status"] == "running" and out["idle_seconds"] > STALE_AFTER_S:
        out["stale"] = "no progress for %d minutes; the worker probably restarted" % (out["idle_seconds"] // 60)
    return out


_SELECT = """SELECT id, status, stage, settings, summary, error, cost_cap_usd, spent_usd, created_at,
                    updated_at, EXTRACT(EPOCH FROM now() - updated_at) FROM cl_runs"""


def get_run(run_id, owner_email):
    r = _exec(_SELECT + " WHERE id=%s AND owner_email=%s", (run_id, owner_email), fetch="one")
    return _row(r) if r else None


def list_runs(owner_email, limit=20):
    rows = _exec(_SELECT + " WHERE owner_email=%s ORDER BY created_at DESC LIMIT %s",
                 (owner_email, limit), fetch="all")
    out = []
    for r in rows:
        run = _row(r)
        summary = run.pop("summary") or {}
        run["totals"] = summary.get("totals")
        run["companies_done"] = len(summary.get("companies") or [])
        out.append(run)
    return out


def running_run(owner_email):
    for run in list_runs(owner_email, limit=5):
        if run["status"] == "running" and not run.get("stale"):
            return run
    return None


# == the background runner ==========================================================

def start(settings, owner_email, *, cap_usd=None, spawn=None):
    from . import contact_lab as lab
    cap = Decimal(str(cap_usd)) if cap_usd is not None else lab.DEFAULT_CAP_USD
    stored = {k: settings[k] for k in ("companies", "roles", "backends", "model", "engines") if k in settings}
    run_id = create_run(owner_email, stored, cap)
    args = (run_id, stored, cap)
    if spawn is None:
        threading.Thread(target=job, args=args, name="cl-run-%s" % run_id, daemon=True).start()
    else:
        spawn(job, args)
    return run_id


def job(run_id, settings, cap, *, runner=None):
    from . import contact_lab as lab
    from . import contact_lab_search as search
    runner = runner or lab.run
    budget = search.Budget(cap)

    def stage(text):
        try:
            update_run(run_id, stage=text[:300], spent=budget.spent)
        except Exception:
            logger.warning("contact lab run %s: could not record its stage", run_id)

    def partial(summary):
        try:
            update_run(run_id, summary=dict(summary, partial=True), spent=budget.spent)
        except Exception:
            logger.warning("contact lab run %s: could not save its partial summary", run_id)

    try:
        summary = runner(dict(settings, on_company=partial), budget, progress=stage)
        update_run(run_id, status="complete", stage="done", summary=summary, spent=budget.spent,
                   error=summary.get("stopped"))
    except Exception as e:
        logger.exception("contact lab run %s failed", run_id)
        try:
            update_run(run_id, status="failed", error="%s: %s" % (type(e).__name__, str(e)[:300]),
                       spent=budget.spent,
                       summary={"trace": traceback.format_exc()[-1500:], "cost": {"spent_usd": float(budget.spent)}})
        except Exception:
            pass
