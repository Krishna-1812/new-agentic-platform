"""Buyer Radar: every lead in a Google Sheet, one detailed row each, never twice, kept up to date.

A workspace names a Google Sheet in Settings and shares it with the platform's service account (its
address is on the page) as an Editor. After every run (and on "Update the sheet now"):

    Leads   one row per lead, added once. Before adding, the sheet's own "Lead ID" column is read, so a
            lead whose row is there already is never added again, even if the database did not record
            the last update. A lead that changed since (its status, email, messages, who was written to)
            has those cells rewritten in its own row, wherever the row is now (sorting the sheet is fine).
    Runs    one row per run: when, how many new leads from where, repeats skipped, cost, notes.

Columns are found by their header, so the team may move them, and add their own columns, which Buyer
Radar never writes. A header the team deleted is added back at the end. Everything is written as plain
values (RAW): a post that starts with "=" stays text, never a formula.

    sheet_id_of(link) -> id or ""
    sheet_url(id)
    service_email() -> the address to share the sheet with
    check(sheet_id, service=None) -> (ok, message)          sets the tabs up
    sync(owner, settings, store=, service=) -> {"added", "updated"} or {"error"}
    sync_run(owner, settings, run_id=, summary=)             after a run: the leads, then the run's row
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from datetime import timedelta, timezone

log = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
LEADS, RUNS = "Leads", "Runs"
ID_RX = re.compile(r"^[A-Za-z0-9_-]{25,80}$")
LINK_RX = re.compile(r"/spreadsheets/d/([A-Za-z0-9_-]{25,80})")
CELL_MAX = 5000                     # Google's limit is 50,000 characters a cell; a post is never near it
BATCH = 500                         # leads a sync reads at most; the rest go on the next one
IST = timezone(timedelta(minutes=330))
_locks, _locks_guard = {}, threading.Lock()


def sheet_id_of(raw):
    """The sheet's id from its link (or the id itself), or "" when it is neither."""
    raw = str(raw or "").strip()
    m = LINK_RX.search(raw)
    if m:
        return m.group(1)
    return raw if ID_RX.match(raw) else ""


def sheet_url(sheet_id):
    return "https://docs.google.com/spreadsheets/d/%s/edit" % sheet_id if sheet_id else ""


def service_email():
    """The service account's address, which the sheet is shared with; "" when GOOGLE_SA_JSON is not set."""
    try:
        return str(json.loads(os.environ.get("GOOGLE_SA_JSON") or "{}").get("client_email") or "")
    except ValueError:
        return ""


def _service():
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    raw = os.environ.get("GOOGLE_SA_JSON", "")
    if not raw:
        raise RuntimeError("GOOGLE_SA_JSON is not set on this service")
    creds = service_account.Credentials.from_service_account_info(json.loads(raw), scopes=SCOPES)
    return build("sheets", "v4", credentials=creds, cache_discovery=False, static_discovery=True)


def why(e):
    """A Google error in words the team can act on."""
    status = getattr(getattr(e, "resp", None), "status", None) or getattr(e, "status_code", None)
    if str(status) == "403":
        return "Buyer Radar may not open the sheet: share it with %s as an Editor" % (service_email() or "the service account")
    if str(status) == "404":
        return "there is no Google Sheet at that link"
    if str(status) == "429":
        return "Google asked to slow down; the rows go on the next update"
    return "%s: %s" % (type(e).__name__, re.sub(r"\s+", " ", str(e))[:160])


# == what a row says ======================================================================================

def _ist(iso):
    from datetime import datetime
    if not iso:
        return ""
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return str(iso)[:16]
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(IST).strftime("%Y-%m-%d %H:%M")


def _cell(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "Yes" if v else "No"
    if isinstance(v, (int, float)):
        return v
    return str(v)[:CELL_MAX]


def _contact(lead):
    """The person written to: a hiring company's decision maker, else the author."""
    from . import buyer_radar_source as src
    p = lead.get("post") or {}
    person = lead.get("person") or ""
    for c in p.get("contacts") or []:
        if person and person in (c.get("key"), src.profile_key(c.get("linkedin"))):
            return c
    if lead.get("source") == "jobs":
        return {}
    a = p.get("author") or {}
    return {"name": a.get("name"), "title": a.get("headline"), "linkedin": a.get("url") if not a.get("company") else ""}


def _sends(lead):
    return "; ".join("%s to %s, %s%s" % ({"email": "Email", "linkedin": "LinkedIn"}.get(s.get("channel"), s.get("channel")),
                                         s.get("to") or "", _ist(s.get("at")), " (automatic)" if s.get("by") == "" else "")
                     for s in lead.get("sends") or [] if s.get("status") == "sent")


def lead_columns(settings):
    """[(header, value of a lead, kept up to date?)]: what a Leads row says, in its order."""
    from . import buyer_radar as br
    alert = int(settings.get("alert_score") or 70)

    def p(lead):
        return lead.get("post") or {}

    def v(lead):
        return lead.get("verdict") or {}

    def d(lead):
        return lead.get("draft") or {}

    def company(lead):
        return v(lead).get("company") or (p(lead).get("company") or {}).get("name") or \
            ((p(lead).get("author") or {}).get("name") if (p(lead).get("author") or {}).get("company") else "")

    def jobs(lead):
        return "; ".join("%s%s" % (j.get("title"), (" (%s)" % j["location"]) if j.get("location") else "")
                         for j in p(lead).get("jobs") or [])

    def deciders(lead):
        return "; ".join("%s, %s" % (c.get("name"), c.get("title") or "") for c in p(lead).get("contacts") or []
                         if lead.get("source") == "jobs")

    def parent(lead):
        x = p(lead).get("parent") or {}
        return ("%s asked for: %s (%s)" % (x.get("author") or "Someone", x.get("need") or "", x.get("url") or "")) if x else ""

    return [
        ("Lead ID", lambda x: x.get("id"), False),
        ("Found (India time)", lambda x: _ist(x.get("created_at")), False),
        ("Run ID", lambda x: x.get("run_id"), False),
        ("Score", lambda x: x.get("score"), False),
        ("Strong", lambda x: int(x.get("score") or 0) >= alert, False),
        ("Offer", lambda x: br.OFFERS.get(x.get("offer"), {}).get("label", x.get("offer")), False),
        ("Found in", lambda x: br.SOURCE_LABELS.get(x.get("source") or "post", x.get("source")), False),
        ("Intent", lambda x: v(x).get("intent_label") or v(x).get("intent"), False),
        ("Status", lambda x: x.get("status"), True),
        ("Name", lambda x: _contact(x).get("name"), True),
        ("Title / headline", lambda x: _contact(x).get("title"), True),
        ("Company", company, False),
        ("Company website", lambda x: (p(x).get("company") or {}).get("domain"), False),
        ("Company size", lambda x: (p(x).get("company") or {}).get("size") or (p(x).get("company") or {}).get("employees"), False),
        ("Industry", lambda x: (p(x).get("company") or {}).get("industry"), False),
        ("Location", lambda x: v(x).get("region"), False),
        ("LinkedIn profile", lambda x: _contact(x).get("linkedin"), True),
        ("Email", lambda x: x.get("email"), True),
        ("Email found by", lambda x: {"post": "Their post", "saleshandy": "Saleshandy", "typed": "Typed in",
                                      "rfp": "The RFP"}.get(x.get("email_source") or "", x.get("email_source")), True),
        ("What they want", lambda x: v(x).get("need"), False),
        ("Why it was kept", lambda x: v(x).get("reason"), False),
        ("Deadline / due", lambda x: v(x).get("deadline"), False),
        ("Also found in", lambda x: ", ".join(br.SOURCE_LABELS.get(s, s) for s in v(x).get("signals") or []
                                              if s != x.get("source")), False),
        ("Link", lambda x: p(x).get("url"), False),
        ("Posted on", lambda x: _ist(p(x).get("posted_at")), False),
        ("Their words", lambda x: p(x).get("text"), False),
        ("Found by the search", lambda x: p(x).get("query") if isinstance(p(x).get("query"), str) else
         json.dumps(p(x).get("query")) if p(x).get("query") else "", False),
        ("Under the post", parent, False),
        ("Open jobs", jobs, False),
        ("Who decides there", deciders, True),
        ("Customer profile", lambda x: (p(x).get("icp") or {}).get("name"), False),
        ("Why now", lambda x: (p(x).get("icp") or {}).get("why"), False),
        ("RFP title", lambda x: (p(x).get("rfp") or {}).get("title"), False),
        ("RFP issued by", lambda x: (p(x).get("rfp") or {}).get("issuer"), False),
        ("RFP contact", lambda x: (p(x).get("rfp") or {}).get("contact_email"), False),
        ("Subreddit", lambda x: p(x).get("subreddit"), False),
        ("Email subject", lambda x: d(x).get("subject"), True),
        ("Email message", lambda x: d(x).get("email"), True),
        ("LinkedIn note", lambda x: d(x).get("note"), True),
        ("LinkedIn message / Reddit reply", lambda x: d(x).get("message"), True),
        ("Contacted", _sends, True),
        ("Last updated (India time)", lambda x: _ist(x.get("updated_at")), True),
    ]


RUN_HEADERS = ["Run ID", "Started (India time)", "Daily or by hand", "New leads", "Aimed for", "Strong",
               "From posts", "From comments", "Hiring companies", "From customer profiles", "RFPs", "From Reddit",
               "Repeats skipped", "Read by Claude", "Several places", "Slack", "Cost ($)", "Notes"]


def run_row(run, summary):
    by = summary.get("by_source") or {}
    return [run.get("id"), _ist(run.get("created_at")), "Daily" if run.get("trigger") == "daily" else "By hand",
            summary.get("new", summary.get("kept", 0)), summary.get("target") or "", summary.get("strong", 0),
            by.get("post", 0), by.get("comment", 0), by.get("jobs", 0), by.get("icp", 0), by.get("rfp", 0), by.get("reddit", 0),
            summary.get("repeats", 0), summary.get("read", 0), summary.get("multi", 0),
            {"waiting": "At %s" % _ist(summary.get("slack_at")), "sent": "Sent"}.get(summary.get("slack"), summary.get("slack") or ""),
            run.get("spent_usd", ""), _cell(" | ".join(summary.get("notes") or []))]


# == the sheet ===========================================================================================

def _col(n):
    """1 -> A, 27 -> AA."""
    out = ""
    while n:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out


def _quote(tab):
    return "'%s'" % tab.replace("'", "''")


def _tabs(svc, sheet_id, wanted):
    """The tabs there, any of `wanted` added that were missing."""
    meta = svc.spreadsheets().get(spreadsheetId=sheet_id, fields="sheets.properties.title").execute()
    have = {s["properties"]["title"] for s in meta.get("sheets") or []}
    missing = [t for t in wanted if t not in have]
    if missing:
        svc.spreadsheets().batchUpdate(spreadsheetId=sheet_id, body={"requests": [
            {"addSheet": {"properties": {"title": t, "gridProperties": {"frozenRowCount": 1}}}} for t in missing]}).execute()


def _headers(svc, sheet_id, tab, wanted):
    """The tab's header row, with any of `wanted` missing written at its end. [header] in sheet order."""
    got = svc.spreadsheets().values().get(spreadsheetId=sheet_id, range="%s!1:1" % _quote(tab)).execute()
    row = [str(x).strip() for x in ((got.get("values") or [[]])[0])]
    add = [h for h in wanted if h not in row]
    if add:
        svc.spreadsheets().values().update(
            spreadsheetId=sheet_id, range="%s!%s1" % (_quote(tab), _col(len(row) + 1)), valueInputOption="RAW",
            body={"values": [add]}).execute()
        row += add
    return row


def _id_rows(svc, sheet_id, tab, headers, id_header):
    """{id as text: row number} from the tab's own id column."""
    col = _col(headers.index(id_header) + 1)
    got = svc.spreadsheets().values().get(spreadsheetId=sheet_id, range="%s!%s2:%s" % (_quote(tab), col, col)).execute()
    out = {}
    for i, r in enumerate(got.get("values") or [], start=2):
        key = str(r[0]).strip().replace(",", "") if r else ""
        if key and key not in out:
            out[key] = i
    return out


def _append(svc, sheet_id, tab, rows):
    if rows:
        svc.spreadsheets().values().append(
            spreadsheetId=sheet_id, range="%s!A1" % _quote(tab), valueInputOption="RAW", insertDataOption="INSERT_ROWS",
            body={"values": rows}).execute()


def check(sheet_id, service=None):
    """(ok, message): can Buyer Radar write to the sheet? Sets up its Leads and Runs tabs and headers."""
    if not sheet_id:
        return False, "No Google Sheet is set in Settings."
    try:
        svc = service or _service()
        _tabs(svc, sheet_id, [LEADS, RUNS])
        _headers(svc, sheet_id, LEADS, [h for h, _, _ in lead_columns({})])
        _headers(svc, sheet_id, RUNS, RUN_HEADERS)
    except Exception as e:
        return False, "The Google Sheet could not be used: %s." % why(e)
    return True, "Connected: Buyer Radar writes to the Leads and Runs tabs."


def _lock(owner):
    with _locks_guard:
        return _locks.setdefault(owner, threading.Lock())


def sync(owner, settings, *, store=None, service=None):
    """Every lead not in the sheet yet gets its row; every lead changed since its row was written has its
    kept-up-to-date cells rewritten. {"added", "updated", "left"} or {"error"}. Never raises."""
    from . import buyer_radar_store
    store = store or buyer_radar_store
    sheet_id = settings.get("sheet_id") or ""
    if not sheet_id:
        return {"error": "no Google Sheet is set"}
    with _lock(owner):
        try:
            svc = service or _service()
            at = store.db_now()
            leads = store.sheet_pending(owner, BATCH + 1)
            left = max(0, len(leads) - BATCH)
            leads = leads[:BATCH]
            if not leads:
                return {"added": 0, "updated": 0, "left": 0}
            cols = lead_columns(settings)
            _tabs(svc, sheet_id, [LEADS, RUNS])
            headers = _headers(svc, sheet_id, LEADS, [h for h, _, _ in cols])
            where = _id_rows(svc, sheet_id, LEADS, headers, "Lead ID")
            by_header = {h: (fn, live) for h, fn, live in cols}
            new, data, updated = [], [], 0
            for lead in leads:
                row_no = where.get(str(lead["id"]))
                if row_no is None:
                    new.append([_cell(by_header[h][0](lead)) if h in by_header else "" for h in headers])
                    where[str(lead["id"])] = -1          # never twice in one batch
                elif row_no > 0:
                    updated += 1
                    for i, h in enumerate(headers):
                        if h in by_header and by_header[h][1]:
                            data.append({"range": "%s!%s%d" % (_quote(LEADS), _col(i + 1), row_no),
                                         "values": [[_cell(by_header[h][0](lead))]]})
            _append(svc, sheet_id, LEADS, new)
            if data:
                svc.spreadsheets().values().batchUpdate(spreadsheetId=sheet_id, body={
                    "valueInputOption": "RAW", "data": data}).execute()
            store.mark_sheet(owner, [lead["id"] for lead in leads], at)
        except Exception as e:
            log.warning("buyer radar sheet: %s could not be updated: %s", owner, e)
            return {"error": why(e)}
    return {"added": len(new), "updated": updated, "left": left}


def add_run(owner, settings, run_id, summary, *, store=None, service=None):
    """The run's row on the Runs tab, once (its Run ID is looked for first). None, or why not."""
    from . import buyer_radar_store
    store = store or buyer_radar_store
    try:
        svc = service or _service()
        run = store.get_run(run_id, owner) or {"id": run_id}
        _tabs(svc, settings["sheet_id"], [LEADS, RUNS])
        headers = _headers(svc, settings["sheet_id"], RUNS, RUN_HEADERS)
        if str(run_id) in _id_rows(svc, settings["sheet_id"], RUNS, headers, "Run ID"):
            return None
        values = dict(zip(RUN_HEADERS, run_row(run, summary)))
        _append(svc, settings["sheet_id"], RUNS, [[values.get(h, "") for h in headers]])
    except Exception as e:
        return why(e)
    return None


def sync_run(owner, settings, *, run_id, summary, store=None, service=None):
    """After a run: its leads, then its row. What happened, for the run's summary; never raises."""
    try:
        svc = service or _service()
    except Exception as e:
        summary.setdefault("notes", []).append("The Google Sheet was not updated: %s." % why(e))
        return {"error": why(e)}
    got = sync(owner, settings, store=store, service=svc)
    if got.get("error"):
        summary.setdefault("notes", []).append("The Google Sheet was not updated: %s. The rows go on the next update." % got["error"])
        return got
    if got.get("left"):
        summary.setdefault("notes", []).append("%d more leads go to the Google Sheet on the next update." % got["left"])
    problem = add_run(owner, settings, run_id, summary, store=store, service=svc)
    if problem:
        got["runs_error"] = problem
    return got
