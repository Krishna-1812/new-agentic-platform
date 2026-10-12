"""People & Signals: its runs, in Postgres (am_runs), and the background jobs
that fill them.

    run_id = start_map(settings, owner_email)              # free (+ Claude if asked, capped)
    start_reveal(run_id, owner_email, keys, cap_credits)   # credits, only after the page's yes
    get_run(run_id, owner_email)                           # poll

A run is mapped first (status "running" until "ready"). Revealing works on
a ready run and can be repeated; each reveal is recorded in the summary
with what it cost. One job per person at a time. A job records its stage as
it works and its summary after every company, so a deploy mid-run keeps
what was found.
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
    """CREATE TABLE IF NOT EXISTS am_runs (
        id BIGSERIAL PRIMARY KEY,
        owner_email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running'
            CHECK (status IN ('running','ready','failed')),
        stage TEXT,
        settings JSONB NOT NULL,
        summary JSONB,
        error TEXT,
        cost_cap_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
        spent_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
        credits_used NUMERIC(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    "CREATE INDEX IF NOT EXISTS idx_am_runs_owner ON am_runs (owner_email, created_at DESC)",
    # 2026-10-12: inside a client account the owner is the account's space ("acct:<id>"), shared by
    # the whole team; who started the run is kept for the account's History.
    "ALTER TABLE am_runs ADD COLUMN IF NOT EXISTS started_by TEXT",
]
_READY = False


def _ensure():
    global _READY
    if _READY:
        return
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(hashtext('am-schema-v1'))")
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


def create_run(owner_email, settings, cap_usd, started_by=None):
    row = _exec("""INSERT INTO am_runs (owner_email, settings, cost_cap_usd, stage, started_by)
                   VALUES (%s, %s, %s, 'queued', %s) RETURNING id""",
                (owner_email, _json(settings), Decimal(str(cap_usd)), started_by), fetch="one")
    return row[0]


def update_run(run_id, *, status=None, stage=None, summary=None, error=None, spent=None, credits=None,
               clear_error=False):
    sets, params = ["updated_at=now()"], []
    for col, val in (("status", status), ("stage", stage), ("error", error)):
        if val is not None:
            sets.append("%s=%%s" % col)
            params.append(val)
    if clear_error:
        sets.append("error=NULL")
    if summary is not None:
        sets.append("summary=%s")
        params.append(_json(summary))
    if spent is not None:
        sets.append("spent_usd=%s")
        params.append(Decimal(str(spent)))
    if credits is not None:
        sets.append("credits_used=%s")
        params.append(Decimal(str(credits)))
    params.append(run_id)
    _exec("UPDATE am_runs SET %s WHERE id=%%s" % ", ".join(sets), params)


def claim(run_id, owner_email, stage):
    """Marks a ready run as running for a reveal; False if it isn't ready."""
    row = _exec("""UPDATE am_runs SET status='running', stage=%s, updated_at=now()
                   WHERE id=%s AND owner_email=%s AND status='ready' RETURNING id""",
                (stage, run_id, owner_email), fetch="one")
    return bool(row)


COLS = ("id", "status", "stage", "settings", "summary", "error", "cost_cap_usd", "spent_usd", "credits_used",
        "created_at", "updated_at", "idle_seconds")


def _row(r):
    out = dict(zip(COLS, r))
    for k in ("cost_cap_usd", "spent_usd", "credits_used"):
        out[k] = float(out[k]) if out[k] is not None else None
    for k in ("created_at", "updated_at"):
        out[k] = out[k].isoformat() if out[k] else None
    out["idle_seconds"] = int(out["idle_seconds"] or 0)
    if out["status"] == "running" and out["idle_seconds"] > STALE_AFTER_S:
        out["stale"] = "no progress for %d minutes; the worker probably restarted" % (out["idle_seconds"] // 60)
    return out


_SELECT = """SELECT id, status, stage, settings, summary, error, cost_cap_usd, spent_usd, credits_used,
                    created_at, updated_at, EXTRACT(EPOCH FROM now() - updated_at) FROM am_runs"""


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


def space_runs(owner, limit=60):
    """An owner's runs, newest first, for an account's History: what each mapped and who started it."""
    rows = _exec("""SELECT id, status, settings, created_at, started_by, credits_used FROM am_runs
                    WHERE owner_email=%s ORDER BY created_at DESC LIMIT %s""", (owner, limit), fetch="all")
    return [dict(zip(("id", "status", "settings", "created_at", "started_by", "credits_used"), r)) for r in rows]


def running_run(owner_email):
    for run in list_runs(owner_email, limit=5):
        if run["status"] == "running" and not run.get("stale"):
            return run
    return None


def _spawn(spawn, target, args, name):
    if spawn is None:
        threading.Thread(target=target, args=args, name=name, daemon=True).start()
    else:
        spawn(target, args)


# == mapping ===========================================================================

STORED = ("companies", "roles", "per_role", "insights", "use_claude", "web_fill", "briefs", "model")


def start_map(settings, owner_email, *, cap_usd=None, spawn=None, started_by=None):
    from . import account_mapper as am
    cap = Decimal(str(cap_usd)) if cap_usd is not None else am.DEFAULT_CLAUDE_CAP_USD
    stored = {k: settings[k] for k in STORED if k in settings}
    run_id = create_run(owner_email, stored, cap, started_by)
    _spawn(spawn, map_job, (run_id, stored, cap), "am-map-%s" % run_id)
    return run_id


def map_job(run_id, settings, cap, *, client=None, mapper=None, web=None, briefer=None):
    from . import account_mapper as am
    from . import account_mapper_brief as ab
    from . import account_mapper_reveal as ar
    from . import contact_lab_search as search
    from . import saleshandy_client as sh
    budget = search.Budget(cap)

    def stage(text):
        try:
            update_run(run_id, stage=text[:300], spent=budget.spent)
        except Exception:
            logger.warning("account mapper run %s: could not record its stage", run_id)

    def partial(summary):
        try:
            update_run(run_id, summary=dict(summary, partial=True), spent=budget.spent)
        except Exception:
            logger.warning("account mapper run %s: could not save its partial summary", run_id)

    summary = None
    try:
        client = client or sh.Client()
        summary = (mapper or am.map_accounts)(dict(settings, on_company=partial), client, progress=stage,
                                              budget=budget)
        try:
            if settings.get("web_fill"):
                (web or ar.web_fill)(summary, model=settings.get("model"), budget=budget, progress=stage)
        except search.BudgetExceeded as e:
            summary["web_stopped"] = "Stopped at the cost cap: %s" % e
        if settings.get("briefs"):
            (briefer or ab.brief_accounts)(summary, model=settings.get("model"), budget=budget, progress=stage)
        else:
            ab.rank_accounts(summary)
        summary["cost"] = {"spent_usd": float(budget.spent), "cap_usd": float(budget.cap),
                           "by_stage": budget.by_stage(), "calls": len(budget.calls)}
        summary["log"] = list(getattr(client, "log", []))[-400:]
        update_run(run_id, status="ready", stage="mapped", summary=summary, spent=budget.spent,
                   error=summary.get("stopped"))
    except Exception as e:
        logger.exception("account mapper run %s failed", run_id)
        try:
            out = dict(summary or {}, trace=traceback.format_exc()[-1500:],
                       cost={"spent_usd": float(budget.spent)})
            update_run(run_id, status="failed", error="%s: %s" % (type(e).__name__, str(e)[:300]),
                       spent=budget.spent, summary=out)
        except Exception:
            pass


# == revealing =========================================================================

def start_reveal(run_id, owner_email, keys, *, cap_credits, phone=False, spawn=None):
    """Claims the ready run and starts the reveal; False if it isn't ready."""
    if not claim(run_id, owner_email, "revealing"):
        return False
    _spawn(spawn, reveal_job, (run_id, owner_email, list(keys), int(cap_credits), bool(phone)),
           "am-reveal-%s" % run_id)
    return True


def reveal_job(run_id, owner_email, keys, cap_credits, phone, *, client=None):
    from . import account_mapper_reveal as ar
    from . import saleshandy_client as sh
    run = get_run(run_id, owner_email)
    summary = (run or {}).get("summary") or {}

    def stage(text):
        try:
            update_run(run_id, stage=text[:300])
        except Exception:
            pass

    try:
        client = client or sh.Client()
        report = ar.reveal(summary, keys, client, phone=phone, cap=cap_credits, progress=stage)
        used = sum(r.get("credits") or 0 for r in summary.get("reveals") or [])
        summary["log"] = (summary.get("log") or []) + list(getattr(client, "log", []))
        summary["log"] = summary["log"][-400:]
        update_run(run_id, status="ready", stage="revealed %d of %d" % (report["found"], report["asked"]),
                   summary=summary, credits=used, clear_error=True)
    except ar.RevealRefused as e:
        update_run(run_id, status="ready", stage="mapped", error="Reveal refused: %s" % e)
    except Exception as e:
        logger.exception("account mapper reveal %s failed", run_id)
        try:
            summary["reveal_error"] = "%s: %s" % (type(e).__name__, str(e)[:300])
            used = sum(r.get("credits") or 0 for r in summary.get("reveals") or [])
            update_run(run_id, status="ready", stage="reveal failed", summary=summary, credits=used,
                       error="The reveal failed (%s: %s). Credits are charged only for emails found; "
                             "check the balance before trying again." % (type(e).__name__, str(e)[:200]))
        except Exception:
            pass


# == export ============================================================================

CSV_COLUMNS = ("company", "domain", "priority", "title_asked", "name", "first_name", "last_name", "title",
               "email", "email_label", "linkedin", "location", "new_in_role", "decision_maker", "picked", "source",
               "opener")


def csv_rows(summary):
    """One row per person, best accounts first: ready for Saleshandy or a CRM."""
    order = {n: i for i, n in enumerate(summary.get("ranking") or [])}
    companies = sorted(summary.get("companies") or [], key=lambda c: order.get(c["name"], 999))
    rows = []
    for c in companies:
        openers = {o["name"]: o["line"] for o in ((c.get("brief") or {}).get("openers") or [])}
        for r in c.get("roles") or []:
            for kind, people in (("yes", r.get("picked") or []), ("no", r.get("also") or []),
                                 ("yes", r.get("web") or [])):
                for p in people:
                    email = p.get("email") or {}
                    name = p.get("name") or ""
                    first, _, last = name.partition(" ")
                    rows.append({
                        "company": c.get("display_name") or c["name"], "domain": c.get("domain") or "",
                        "priority": (c.get("priority") or {}).get("score", ""), "title_asked": r["role"],
                        "name": name, "first_name": p.get("first_name") or first,
                        "last_name": p.get("last_name") or last.strip(), "title": p.get("title") or "",
                        "email": email.get("address") or "", "email_label": email.get("label") or "",
                        "linkedin": p.get("linkedin") or "", "location": p.get("location") or "",
                        "new_in_role": "yes" if p.get("new_in_role") else "",
                        "decision_maker": "yes" if p.get("decision_maker") else "",
                        "picked": kind, "source": "web search" if p.get("source") == "web" else "Saleshandy",
                        "opener": openers.get(name, "")})
    return rows


def to_csv(summary):
    import csv
    import io
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=CSV_COLUMNS)
    w.writeheader()
    for row in csv_rows(summary):
        # A cell that starts like a formula is quoted so spreadsheets read it as text.
        w.writerow({k: ("'" + v if isinstance(v, str) and v[:1] in ("=", "+", "-", "@") else v)
                    for k, v in row.items()})
    return buf.getvalue()
