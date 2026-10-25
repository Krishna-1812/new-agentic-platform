"""Buyer Radar: its runs, leads, sends, settings, opt-outs and cost ledger, in Postgres.

Work is kept by owner, as Market Radar's and People & Signals' is (app.py _mr_email): inside a client
workspace the owner is the workspace's space ("acct:<id>"), shared by the whole team, with who started
each run kept in started_by; otherwise it is the person's own email.

    br_runs       one search, with its stage and summary; trigger "manual" or "daily"
    br_leads      one signal kept as a lead, once per owner (the same post found again is not a new lead):
                  source 'post' (a LinkedIn post), 'comment' (a comment under a buyer's post) or 'jobs'
                  (a company's LinkedIn job ads, once a month) or 'icp' (a person who fits a customer profile)
    br_seen       every post, comment and company Claude has read, kept or not, so the next run does not
                  pay to read it again
    br_identities who each lead is (a person by profile or by name at a company, a hiring company, an RFP
                  by issuer and title), so nobody becomes a new lead twice (buyer_radar.identities)
    br_cursors    where each customer profile's Saleshandy search stopped, so the next run goes on from
                  there instead of the first pages again
    br_sends      every email and LinkedIn message sent, by whom ("" for the automatic send)
    br_settings   each owner's settings (tracker/buyer_radar.py DEFAULTS)
    br_suppress   people who opted out, or must never be written to; for every owner
    br_spend      every paid call: Apify, Claude, Saleshandy; read by the admin panel (tracker/admin_spend.py)
"""
from __future__ import annotations

import json
import logging
import threading
import traceback
from decimal import Decimal

from .market_radar_store import StoreUnavailable, _connect  # noqa: F401  (re-exported)

log = logging.getLogger(__name__)
STALE_AFTER_S = 1200
LEAD_STATUSES = ("new", "contacted", "replied", "dismissed")
LEAD_SOURCES = ("post", "comment", "jobs", "icp", "rfp", "reddit")

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS br_runs (
        id BIGSERIAL PRIMARY KEY,
        owner TEXT NOT NULL,
        started_by TEXT,
        trigger TEXT NOT NULL DEFAULT 'manual',
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','ready','failed')),
        stage TEXT,
        settings JSONB NOT NULL,
        summary JSONB,
        error TEXT,
        cost_cap_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    "CREATE INDEX IF NOT EXISTS idx_br_runs_owner ON br_runs (owner, created_at DESC)",
    """CREATE TABLE IF NOT EXISTS br_leads (
        id BIGSERIAL PRIMARY KEY,
        owner TEXT NOT NULL,
        run_id BIGINT,
        post_key TEXT NOT NULL,
        post JSONB NOT NULL,
        offer TEXT NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        verdict JSONB NOT NULL,
        draft JSONB,
        person TEXT NOT NULL DEFAULT '',
        email TEXT,
        email_source TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (owner, post_key))""",
    "CREATE INDEX IF NOT EXISTS idx_br_leads_owner ON br_leads (owner, created_at DESC)",
    "ALTER TABLE br_leads ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'post'",
    """CREATE TABLE IF NOT EXISTS br_seen (
        owner TEXT NOT NULL,
        key TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (owner, key))""",
    """CREATE TABLE IF NOT EXISTS br_sends (
        id BIGSERIAL PRIMARY KEY,
        owner TEXT NOT NULL,
        lead_id BIGINT,
        channel TEXT NOT NULL,
        recipient TEXT NOT NULL,
        person TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        detail TEXT,
        by_email TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    "CREATE INDEX IF NOT EXISTS idx_br_sends_owner ON br_sends (owner, channel, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_br_sends_person ON br_sends (person, channel)",
    """CREATE TABLE IF NOT EXISTS br_settings (
        owner TEXT PRIMARY KEY,
        settings JSONB NOT NULL,
        updated_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    """CREATE TABLE IF NOT EXISTS br_suppress (
        key TEXT PRIMARY KEY,
        reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    """CREATE TABLE IF NOT EXISTS br_spend (
        id BIGSERIAL PRIMARY KEY,
        run_id BIGINT,
        owner TEXT NOT NULL,
        started_by TEXT,
        provider TEXT NOT NULL,
        op TEXT,
        usd NUMERIC(12,6) NOT NULL DEFAULT 0,
        credits NUMERIC(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    "CREATE INDEX IF NOT EXISTS idx_br_spend_at ON br_spend (created_at)",
    """CREATE TABLE IF NOT EXISTS br_identities (
        owner TEXT NOT NULL,
        ident TEXT NOT NULL,
        lead_id BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (owner, ident))""",
    """CREATE TABLE IF NOT EXISTS br_cursors (
        owner TEXT NOT NULL,
        key TEXT NOT NULL,
        page INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (owner, key))""",
    # when the lead's row last went to the workspace's Google Sheet (buyer_radar_sheet.sync)
    "ALTER TABLE br_leads ADD COLUMN IF NOT EXISTS sheet_at TIMESTAMPTZ",
]
# Job-ad leads ("Hiring for it") were switched off on 2026-10-25. What they left is deleted once a process
# starts, unless someone was written to through one (that record of who was contacted stays). Their people
# are forgotten too, so a person who also fits a customer profile can still be found that way. The
# sheet's rows go with the next sheet update (buyer_radar_sheet.RETIRED_FOUND_IN).
_NEVER_CONTACTED = "NOT EXISTS (SELECT 1 FROM br_sends s WHERE s.lead_id = br_leads.id)"
RETIRED_SOURCES = [
    "DELETE FROM br_identities WHERE lead_id IN (SELECT id FROM br_leads WHERE source = 'jobs' AND " + _NEVER_CONTACTED + ")",
    "DELETE FROM br_leads WHERE source = 'jobs' AND " + _NEVER_CONTACTED,
]
_READY = False


def _ensure():
    global _READY
    if _READY:
        return
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(hashtext('br-schema-v1'))")
            for statement in SCHEMA:
                cur.execute(statement)
            for statement in RETIRED_SOURCES:
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


def _iso(v):
    return v.isoformat() if v else None


# == settings ============================================================================================

def get_settings(owner):
    from . import buyer_radar as br
    row = _exec("SELECT settings FROM br_settings WHERE owner=%s", (owner,), fetch="one")
    return br.merged(row[0] if row else None)


def save_settings(owner, settings, by=None):
    _exec("""INSERT INTO br_settings (owner, settings, updated_by) VALUES (%s, %s, %s)
             ON CONFLICT (owner) DO UPDATE SET settings=EXCLUDED.settings, updated_by=EXCLUDED.updated_by,
             updated_at=now()""", (owner, _json(settings), by))


def daily_owners():
    """Owners whose daily run is on."""
    rows = _exec("SELECT owner FROM br_settings WHERE (settings->>'daily')::boolean IS TRUE ORDER BY owner",
                 fetch="all")
    return [r[0] for r in rows]


# == runs ================================================================================================

def create_run(owner, settings, cap_usd, started_by=None, trigger="manual"):
    row = _exec("""INSERT INTO br_runs (owner, started_by, trigger, settings, cost_cap_usd, stage)
                   VALUES (%s, %s, %s, %s, %s, 'queued') RETURNING id""",
                (owner, started_by, trigger, _json(settings), Decimal(str(cap_usd))), fetch="one")
    return row[0]


def update_run(run_id, *, status=None, stage=None, summary=None, error=None):
    sets, params = ["updated_at=now()"], []
    for col, val in (("status", status), ("stage", stage), ("error", error)):
        if val is not None:
            sets.append("%s=%%s" % col)
            params.append(val)
    if summary is not None:
        sets.append("summary=%s")
        params.append(_json(summary))
    params.append(run_id)
    _exec("UPDATE br_runs SET %s WHERE id=%%s" % ", ".join(sets), params)


RUN_COLS = ("id", "owner", "started_by", "trigger", "status", "stage", "settings", "summary", "error",
            "cost_cap_usd", "created_at", "updated_at", "idle_seconds", "spent_usd")
_RUN_SELECT = """SELECT r.id, r.owner, r.started_by, r.trigger, r.status, r.stage, r.settings, r.summary, r.error,
                        r.cost_cap_usd, r.created_at, r.updated_at, EXTRACT(EPOCH FROM now() - r.updated_at),
                        (SELECT COALESCE(SUM(s.usd), 0) FROM br_spend s WHERE s.run_id = r.id)
                   FROM br_runs r"""


def _run(r):
    out = dict(zip(RUN_COLS, r))
    out["cost_cap_usd"] = float(out["cost_cap_usd"] or 0)
    out["spent_usd"] = round(float(out["spent_usd"] or 0), 4)
    out["created_at"], out["updated_at"] = _iso(out["created_at"]), _iso(out["updated_at"])
    out["idle_seconds"] = int(out["idle_seconds"] or 0)
    if out["status"] == "running" and out["idle_seconds"] > STALE_AFTER_S:
        out["stale"] = "no progress for %d minutes; the service probably restarted" % (out["idle_seconds"] // 60)
    return out


def get_run(run_id, owner):
    r = _exec(_RUN_SELECT + " WHERE r.id=%s AND r.owner=%s", (run_id, owner), fetch="one")
    return _run(r) if r else None


def list_runs(owner, limit=20):
    rows = _exec(_RUN_SELECT + " WHERE r.owner=%s ORDER BY r.created_at DESC LIMIT %s", (owner, limit), fetch="all")
    out = []
    for r in rows:
        run = _run(r)
        run.pop("settings", None)
        out.append(run)
    return out


def space_runs(owner, limit=60):
    """An owner's runs, newest first, for a workspace's History."""
    rows = _exec("""SELECT id, status, trigger, summary, started_by, created_at FROM br_runs
                    WHERE owner=%s ORDER BY created_at DESC LIMIT %s""", (owner, limit), fetch="all")
    return [dict(zip(("id", "status", "trigger", "summary", "started_by", "created_at"), r)) for r in rows]


def running_run(owner):
    for run in list_runs(owner, limit=3):
        if run["status"] == "running" and not run.get("stale"):
            return run
    return None


def daily_runs_since(owner, since):
    """[{"id", "status", "stale"}] of this owner's daily runs started since `since` (an aware datetime):
    the daily schedule's view of today."""
    rows = _exec("""SELECT id, status, EXTRACT(EPOCH FROM now() - updated_at) FROM br_runs
                    WHERE owner=%s AND trigger='daily' AND created_at >= %s ORDER BY id""", (owner, since), fetch="all")
    return [{"id": r[0], "status": r[1], "stale": r[1] == "running" and float(r[2] or 0) > STALE_AFTER_S} for r in rows]


def slack_waiting():
    """Runs whose Slack message waits for its time: [(run id, owner, summary)]."""
    rows = _exec("""SELECT id, owner, summary FROM br_runs WHERE status='ready' AND summary->>'slack' = 'waiting'
                    ORDER BY id""", fetch="all")
    return [(r[0], r[1], r[2] or {}) for r in rows]


def claim_slack(run_id):
    """Marks a waiting Slack message as being sent, once: True for the caller that gets it."""
    row = _exec("""UPDATE br_runs SET summary = jsonb_set(summary, '{slack}', '"sending"'), updated_at=now()
                   WHERE id=%s AND summary->>'slack' = 'waiting' RETURNING id""", (run_id,), fetch="one")
    return bool(row)


def claim_resend(run_id):
    """Marks a finished run's Slack message as being sent again, once at a time: True for the caller that gets
    it. Not while the message waits for its hour, nor while one is being sent (unless that stopped 10 minutes
    ago and never finished)."""
    row = _exec("""UPDATE br_runs SET summary = jsonb_set(COALESCE(summary, '{}'::jsonb), '{slack}', '"sending"'), updated_at=now()
                   WHERE id=%s AND status='ready' AND (COALESCE(summary->>'slack', '') NOT IN ('waiting', 'sending')
                     OR (summary->>'slack' = 'sending' AND updated_at < now() - interval '10 minutes'))
                   RETURNING id""", (run_id,), fetch="one")
    return bool(row)


def set_run_summary_key(run_id, key, value):
    _exec("UPDATE br_runs SET summary = jsonb_set(COALESCE(summary, '{}'::jsonb), %s, %s::jsonb) WHERE id=%s",
          ("{%s}" % key, json.dumps(value), run_id))


def ran_today(owner, trigger="daily"):
    row = _exec("""SELECT 1 FROM br_runs WHERE owner=%s AND trigger=%s
                   AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' LIMIT 1""",
                (owner, trigger), fetch="one")
    return bool(row)


def ran_within(owner, days):
    """Did a search for this owner finish well in the last `days` days? The daily search then reads only
    the last week of posts, so its results are new posts rather than the same ones again."""
    row = _exec("""SELECT 1 FROM br_runs WHERE owner=%s AND status='ready'
                   AND created_at >= now() - make_interval(days => %s) LIMIT 1""", (owner, int(days)), fetch="one")
    return bool(row)


def unipile_results_today():
    """LinkedIn search results read through Unipile today, across every owner: Unipile's daily advice is
    per LinkedIn account, and there is one."""
    row = _exec("""SELECT COALESCE(SUM((summary->>'unipile_results')::int), 0) FROM br_runs
                   WHERE summary ? 'unipile_results'
                   AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'""",
                fetch="one")
    return int(row[0] or 0)


# == spend ===============================================================================================

def add_spend(run_id, owner, started_by, provider, op, *, usd=0, credits=0):
    _exec("""INSERT INTO br_spend (run_id, owner, started_by, provider, op, usd, credits)
             VALUES (%s, %s, %s, %s, %s, %s, %s)""",
          (run_id, owner, started_by or None, provider, op, Decimal(str(round(float(usd or 0), 6))),
           Decimal(str(credits or 0))))


def spent_within(owner, op, hours):
    """Did this owner pay for `op` (as booked by a run) in the last `hours` hours? The RFP search runs
    every few days, not every run."""
    row = _exec("""SELECT 1 FROM br_spend WHERE owner=%s AND op=%s AND usd > 0
                   AND created_at >= now() - make_interval(hours => %s) LIMIT 1""", (owner, op, int(hours)), fetch="one")
    return bool(row)


def month_spend(owner):
    row = _exec("""SELECT COALESCE(SUM(usd), 0), COALESCE(SUM(credits), 0) FROM br_spend
                   WHERE owner=%s AND created_at >= date_trunc('month', now())""", (owner,), fetch="one")
    return {"usd": round(float(row[0] or 0), 4), "credits": float(row[1] or 0)}


# == leads ===============================================================================================

def known_posts(owner, keys):
    """The keys this owner has kept as a lead or Claude has already read: neither is read again."""
    keys = [k for k in keys if k]
    if not keys:
        return set()
    rows = _exec("""SELECT post_key FROM br_leads WHERE owner=%s AND post_key = ANY(%s)
                    UNION SELECT key FROM br_seen WHERE owner=%s AND key = ANY(%s)""",
                 (owner, keys, owner, keys), fetch="all")
    return {r[0] for r in rows}


def mark_seen(owner, keys):
    """Posts, comments and companies Claude read for this owner, kept or not."""
    keys = sorted({k for k in keys if k})
    if keys:
        _exec("""INSERT INTO br_seen (owner, key) SELECT %s, unnest(%s::text[])
                 ON CONFLICT (owner, key) DO NOTHING""", (owner, keys))


def recent_companies(owner, days=60):
    """(source, company) for this owner's leads of the last `days` days, the ones marked not a fit left
    out: a company seen in two places scores higher (buyer_radar.multi_signal)."""
    rows = _exec("""SELECT source, COALESCE(NULLIF(verdict->>'company', ''), post->'company'->>'name', '')
                    FROM br_leads WHERE owner=%s AND status <> 'dismissed'
                    AND created_at >= now() - make_interval(days => %s)""", (owner, int(days)), fetch="all")
    return [(r[0], r[1]) for r in rows if r[1]]


def known_identities(owner, idents):
    """The identities this owner already has a lead for (buyer_radar.identities)."""
    idents = sorted({i for i in idents if i})
    if not idents:
        return set()
    rows = _exec("SELECT ident FROM br_identities WHERE owner=%s AND ident = ANY(%s)", (owner, idents), fetch="all")
    return {r[0] for r in rows}


def add_identities(owner, pairs):
    """[(lead id, [identity])] remembered; an identity already there keeps its first lead."""
    rows = [(owner, i, lead_id) for lead_id, idents in pairs for i in sorted(set(idents)) if i]
    if not rows:
        return
    _exec("""INSERT INTO br_identities (owner, ident, lead_id)
             SELECT %s, x.ident, x.lead_id FROM unnest(%s::text[], %s::bigint[]) AS x(ident, lead_id)
             ON CONFLICT (owner, ident) DO NOTHING""",
          (owner, [r[1] for r in rows], [r[2] for r in rows]))


def leads_without_identities(owner, limit=2000):
    """Leads saved before identities were kept (or whose save stopped between the two): to be given them."""
    rows = _exec(_LEAD_SELECT + """ WHERE owner=%s AND NOT EXISTS (
                     SELECT 1 FROM br_identities i WHERE i.owner = br_leads.owner AND i.lead_id = br_leads.id)
                     ORDER BY id LIMIT %s""", (owner, int(limit)), fetch="all")
    return [_lead(r) for r in rows]


def get_cursor(owner, key):
    row = _exec("SELECT page FROM br_cursors WHERE owner=%s AND key=%s", (owner, key), fetch="one")
    return int(row[0]) if row else 1


def set_cursor(owner, key, page):
    _exec("""INSERT INTO br_cursors (owner, key, page) VALUES (%s, %s, %s)
             ON CONFLICT (owner, key) DO UPDATE SET page=EXCLUDED.page, updated_at=now()""", (owner, key, int(page)))


def add_leads(owner, run_id, leads):
    """Each lead's id, or None where the post was already a lead of this owner's."""
    ids = []
    for lead in leads:
        p = lead["post"]
        email = (lead.get("emails") or [None])[0]
        source = lead.get("source") if lead.get("source") in LEAD_SOURCES else "post"
        row = _exec("""INSERT INTO br_leads (owner, run_id, post_key, post, offer, score, verdict, draft, person,
                                             email, email_source, source)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (owner, post_key) DO NOTHING RETURNING id""",
                    (owner, run_id, p["key"], _json(p), lead["offer"], int(lead["score"]), _json(lead["verdict"]),
                     _json(lead["draft"]) if lead.get("draft") else None, lead.get("person") or "", email,
                     (lead.get("email_source") or "post") if email else None, source), fetch="one")
        ids.append(row[0] if row else None)
    return ids


LEAD_COLS = ("id", "run_id", "post", "offer", "score", "verdict", "draft", "person", "email", "email_source",
             "status", "created_at", "updated_at", "source", "sheet_at")
_LEAD_SELECT = "SELECT %s FROM br_leads" % ", ".join(LEAD_COLS)


def _lead(r):
    out = dict(zip(LEAD_COLS, r))
    out["created_at"], out["updated_at"], out["sheet_at"] = _iso(out["created_at"]), _iso(out["updated_at"]), _iso(out["sheet_at"])
    return out


def _with_sends(owner, leads):
    if leads:
        sent = _exec("""SELECT lead_id, channel, status, recipient, by_email, created_at, detail FROM br_sends
                        WHERE owner=%s AND lead_id = ANY(%s) ORDER BY created_at""",
                     (owner, [x["id"] for x in leads]), fetch="all")
        by = {}
        for lead_id, channel, st, to, who, at, detail in sent:
            by.setdefault(lead_id, []).append({"channel": channel, "status": st, "to": to, "by": who,
                                               "at": _iso(at), "detail": detail})
        for x in leads:
            x["sends"] = by.get(x["id"], [])
    return leads


def run_leads(owner, run_id, min_score=0):
    """The leads one run kept, best first: its Slack message, sent at the workspace's time."""
    rows = _exec(_LEAD_SELECT + " WHERE owner=%s AND run_id=%s AND score >= %s ORDER BY score DESC, id",
                 (owner, run_id, int(min_score)), fetch="all")
    return [_lead(r) for r in rows]


def sheet_pending(owner, limit=1000):
    """Leads whose row is not in the Google Sheet yet, or changed since it went there, oldest first."""
    rows = _exec(_LEAD_SELECT + """ WHERE owner=%s AND (sheet_at IS NULL OR updated_at > sheet_at)
                 ORDER BY id LIMIT %s""", (owner, int(limit)), fetch="all")
    return _with_sends(owner, [_lead(r) for r in rows])


def db_now():
    """The database's clock: what a lead's updated_at is compared with."""
    return _exec("SELECT now()", fetch="one")[0]


def mark_sheet(owner, ids, at):
    """The leads' rows are in the sheet as of `at` (when they were read), so a change after it is sent again."""
    if ids:
        _exec("UPDATE br_leads SET sheet_at=%s WHERE owner=%s AND id = ANY(%s)", (at, owner, list(ids)))


def list_leads(owner, *, status=None, offer=None, source=None, min_score=0, limit=200):
    where, params = ["owner=%s", "score >= %s"], [owner, int(min_score)]
    if status:
        where.append("status=%s")
        params.append(status)
    if offer:
        where.append("offer=%s")
        params.append(offer)
    if source:
        where.append("source=%s")
        params.append(source)
    params.append(int(limit))
    rows = _exec(_LEAD_SELECT + " WHERE %s ORDER BY created_at DESC, score DESC LIMIT %%s" % " AND ".join(where),
                 params, fetch="all")
    return _with_sends(owner, [_lead(r) for r in rows])


def get_lead(lead_id, owner):
    r = _exec(_LEAD_SELECT + " WHERE id=%s AND owner=%s", (lead_id, owner), fetch="one")
    return _lead(r) if r else None


def update_lead(lead_id, owner, *, status=None, email=None, email_source=None, draft=None, person=None, post=None):
    sets, params = ["updated_at=now()"], []
    if status is not None:
        if status not in LEAD_STATUSES:
            raise ValueError("unknown status")
        sets.append("status=%s")
        params.append(status)
    if email is not None:
        sets.append("email=%s")
        params.append(email or None)
    if email_source is not None:
        sets.append("email_source=%s")
        params.append(email_source)
    if draft is not None:
        sets.append("draft=%s")
        params.append(_json(draft))
    if person is not None:
        sets.append("person=%s")
        params.append(person)
    if post is not None:
        sets.append("post=%s")
        params.append(_json(post))
    params += [lead_id, owner]
    row = _exec("UPDATE br_leads SET %s WHERE id=%%s AND owner=%%s RETURNING id" % ", ".join(sets), params,
                fetch="one")
    if row and person:
        add_identities(owner, [(lead_id, ["person:" + person])])    # found by their LinkedIn now too
    return bool(row)


def backfill_identities(owner, identities_of):
    """Gives every lead saved before identities were kept its identities, so it counts against repeats."""
    leads = leads_without_identities(owner)
    add_identities(owner, [(x["id"], set(identities_of(x)) | {"lead:%d" % x["id"]}) for x in leads])
    return len(leads)


def counts(owner):
    row = _exec("""SELECT COUNT(*), COUNT(*) FILTER (WHERE status='new'), COUNT(*) FILTER (WHERE status='contacted'),
                          COUNT(*) FILTER (WHERE status='replied'),
                          COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')
                     FROM br_leads WHERE owner=%s""", (owner,), fetch="one")
    out = dict(zip(("all", "new", "contacted", "replied", "week"), [int(x or 0) for x in row]))
    rows = _exec("SELECT source, COUNT(*) FROM br_leads WHERE owner=%s GROUP BY source", (owner,), fetch="all")
    out["by_source"] = {r[0]: int(r[1] or 0) for r in rows}
    return out


# == sends and opt-outs ===================================================================================

def record_send(owner, lead_id, channel, recipient, person, status, detail="", by=""):
    _exec("""INSERT INTO br_sends (owner, lead_id, channel, recipient, person, status, detail, by_email)
             VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
          (owner, lead_id, channel, recipient, person or "", status, (detail or "")[:500], by or ""))
    if status == "sent" and lead_id:
        # every send changes the lead (its Google Sheet row says who was written to, and when)
        _exec("""UPDATE br_leads SET status = CASE WHEN status='new' THEN 'contacted' ELSE status END, updated_at=now()
                 WHERE id=%s""", (lead_id,))


def sent_today(owner, channel):
    """Sends today (UTC) for one owner and channel: what the daily caps count."""
    row = _exec("""SELECT COUNT(*) FROM br_sends WHERE owner=%s AND channel=%s AND status='sent'
                   AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'""",
                (owner, channel), fetch="one")
    return int(row[0] or 0)


def sent_today_all(channel):
    """Sends today across every owner: LinkedIn's limits are per LinkedIn account, and there is one."""
    row = _exec("""SELECT COUNT(*) FROM br_sends WHERE channel=%s AND status='sent'
                   AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'""",
                (channel,), fetch="one")
    return int(row[0] or 0)


def already_contacted(channel, *, person="", recipient=""):
    """Has anyone, from any workspace, already reached this person on this channel? Nobody is written to
    twice."""
    keys = [k for k in (person, (recipient or "").lower()) if k]
    if not keys:
        return False
    row = _exec("""SELECT 1 FROM br_sends WHERE channel=%s AND status='sent'
                   AND (person = ANY(%s) OR lower(recipient) = ANY(%s)) LIMIT 1""", (channel, keys, keys), fetch="one")
    return bool(row)


def suppress(key, reason=""):
    key = (key or "").strip().lower()
    if key:
        _exec("""INSERT INTO br_suppress (key, reason) VALUES (%s, %s)
                 ON CONFLICT (key) DO UPDATE SET reason=EXCLUDED.reason""", (key, (reason or "")[:200]))


def suppressed(*keys):
    keys = [k.strip().lower() for k in keys if k and k.strip()]
    if not keys:
        return False
    return bool(_exec("SELECT 1 FROM br_suppress WHERE key = ANY(%s) LIMIT 1", (keys,), fetch="one"))


# == the background run ==================================================================================

def _spawn(target, args):
    threading.Thread(target=target, args=args, name="buyer-radar-%s" % args[0], daemon=True).start()


def start_run(owner, settings, *, started_by=None, trigger="manual", spawn=None, deps=None):
    run_id = create_run(owner, settings, settings["run_cap_usd"], started_by, trigger)
    (spawn or _spawn)(_work, (run_id, owner, settings, started_by, deps))
    return run_id


def _work(run_id, owner, settings, started_by, deps=None):
    from . import buyer_radar as br
    try:
        summary = br.run(run_id, owner, settings, started_by=started_by, deps=deps)
        update_run(run_id, status="ready", stage="done", summary=summary)
    except Exception as e:
        log.warning("buyer radar run %s failed: %s\n%s", run_id, e, traceback.format_exc())
        try:
            update_run(run_id, status="failed", stage="failed", error=("%s" % e)[:500])
        except Exception:
            log.exception("buyer radar: run %s could not be marked failed", run_id)
