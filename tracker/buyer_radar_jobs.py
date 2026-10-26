"""Lead Finder: companies whose job ads show they need what we sell, from LinkedIn's job search (Unipile).

A company hiring a performance marketing manager or an SEO executive is building marketing it could
hand to an agency (Markify); one hiring call quality analysts is paying people to listen to calls
CallVibe scores (CallVibe). LinkedIn's job search runs from the connected LinkedIn account, free per
result, and shares the day's search limit with the post search (buyer_radar_unipile.day_max).

A company's open roles are read together, once a month: five SEO roles at one company are one lead, and
the same company hiring again next month is a fresh one. Claude reads each company (buyer_radar_judge,
JOB_SYSTEM), and for the companies kept Saleshandy's people search (free; only revealing an email costs
a credit) names who decides: the heads of marketing for Markify, of sales, support or operations for
CallVibe.

    locations(names, account_id=, client=) -> ([LinkedIn location ids], notes)
    collect(queries, days=, per_query=, room=, location_ids=) -> {"jobs", "error", "results", "notes"}
    by_company(jobs, month) -> [signal]      one per company, the shape buyer_radar keeps as a lead's post
    decision_makers(leads, offers, client=) -> note or None; fills each lead's contacts and person
"""
from __future__ import annotations

import logging
import random
import re
import time

log = logging.getLogger(__name__)

PAGE_MAX = 50              # the reference: a jobs page holds up to 50
MAX_COMPANIES = 25         # companies a run looks up people for (Saleshandy's search is free, but not instant)
CONTACTS = 3               # people kept for each company, best first
LEADER_LEVELS = ["C-Level", "Founder", "Owner", "President/Vice President", "Director", "Head"]

# words that end a company name and say nothing about which company it is
_SUFFIX = re.compile(r"\b(inc|llc|ltd|limited|pvt|private|plc|corp|corporation|co|company|gmbh|sa|bv|ag|"
                     r"technologies|technology|solutions|services|group|global|india)\b\.?")


def company_norm(name):
    """A company name with case, punctuation and legal suffixes taken off, to tell whether a person
    found by name works at the company that posted the job."""
    s = re.sub(r"[^a-z0-9 ]+", " ", str(name or "").lower())
    s = _SUFFIX.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


def same_company(a, b):
    a, b = company_norm(a), company_norm(b)
    if not a or not b:
        return False
    if a == b:
        return True
    short, long_ = sorted((a, b), key=len)
    return len(short) >= 4 and (long_.startswith(short + " ") or long_.endswith(" " + short))


def _items(payload):
    if isinstance(payload, dict):
        for key in ("items", "elements", "results", "data"):
            if isinstance(payload.get(key), list):
                return payload[key]
    return payload if isinstance(payload, list) else []


def _cursor(payload):
    if isinstance(payload, dict):
        c = payload.get("cursor") or (payload.get("paging") or {}).get("cursor")
        return c if isinstance(c, str) and c else None
    return None


def locations(names, *, account_id=None, client=None):
    """Each place named in Settings as LinkedIn's location id, the first match for its words. A place
    LinkedIn does not know is noted, and left out rather than searched as the whole world."""
    if client is None:
        from tracker import unipile_client as client
    ids, notes = [], []
    if names and account_id is None:
        account_id, err = client.linkedin_account_id()
        if err is not None:
            return [], ["The job locations could not be looked up (Unipile: %s)." % client.describe_error(err)]
    for name in names or []:
        data, err = client.search_parameters(account_id, "LOCATION", name, limit=3)
        got = [i for i in _items(data) if isinstance(i, dict) and str(i.get("id") or "").strip()] if err is None else []
        if got:
            ids.append(str(got[0]["id"]))
        else:
            notes.append("LinkedIn did not recognise the job location “%s”%s, so it was left out." % (
                name, (" (%s)" % client.describe_error(err)) if err else ""))
    return ids, notes


def normalize(item, query):
    """One job ad in one shape, or None when it has no title or no company to write to."""
    if not isinstance(item, dict):
        return None
    co = item.get("company") if isinstance(item.get("company"), dict) else {}
    title = str(item.get("title") or "").strip()
    name = str(co.get("name") or item.get("company_name") or "").strip()
    if not title or not name:
        return None
    handle = str(co.get("public_identifier") or "").strip()
    url = str(co.get("profile_url") or "").strip() or (
        "https://www.linkedin.com/company/%s/" % handle if handle else "")
    jid = str(item.get("id") or item.get("reference_id") or "").strip()
    job_url = str(item.get("url") or "").strip() or (
        "https://www.linkedin.com/jobs/view/%s/" % jid if jid.isdigit() else "")
    key = ("company/%s" % handle.lower()) if handle else ("company-id/%s" % co.get("id")) if co.get("id") else \
        "company-name/%s" % company_norm(name).replace(" ", "-")
    return {"id": jid, "title": title[:160], "location": str(item.get("location") or "")[:120],
            "posted_at": item.get("posted_at") or "", "url": job_url, "query": query,
            "company": {"name": name[:160], "url": url, "id": str(co.get("id") or ""), "key": key}}


def collect(queries, *, days=14, per_query=20, room=None, location_ids=None, account_id=None, client=None,
            sleep=time.sleep):
    """Every job title searched, page by page, until per_query ads each or `room` results in all. Never
    raises: {"jobs", "error", "results", "notes"}. A refusal stops the rest and keeps what was found."""
    from tracker import buyer_radar_unipile as uni
    if client is None:
        from tracker import unipile_client as client
    room = uni.day_max() if room is None else room
    out = {"jobs": [], "error": None, "results": 0, "notes": []}
    if account_id is None:
        account_id, err = client.linkedin_account_id()
        if err is not None:
            out["error"] = "Unipile: %s" % client.describe_error(err)
            return out
    first = True
    for q in queries:
        cursor, got = None, 0
        while got < per_query and out["results"] < room:
            if not first:
                sleep(random.uniform(*uni.PAUSE_S))
            first = False
            limit = min(PAGE_MAX, per_query - got, room - out["results"])
            data, err = client.search_jobs(account_id, q, date_posted_days=days, location_ids=location_ids,
                                           cursor=cursor, limit=limit)
            if err is not None:
                out["error"] = "Unipile: %s" % client.describe_error(err)
                log.warning("buyer_radar: Unipile job search stopped at %r: %s", q[:60], out["error"])
                break
            items = [i for i in _items(data) if isinstance(i, dict)]
            got += len(items)
            out["results"] += len(items)
            out["jobs"].extend(j for j in (normalize(i, q) for i in items) if j)
            cursor = _cursor(data)
            if not items or not cursor:
                break
        if out["error"] or out["results"] >= room:
            break
    return out


def by_company(jobs, month):
    """The jobs, one signal a company: its open roles together, newest first, under a key that is new
    each month. The signal has a post's shape (key, url, text, author), so the rest of Lead Finder
    reads, keeps and drafts it as it does a post."""
    groups = {}
    for j in jobs:
        g = groups.setdefault(j["company"]["key"], {"company": j["company"], "jobs": {}})
        g["jobs"].setdefault(j["id"] or j["title"].lower(), j)
    out = []
    for key, g in groups.items():
        roles = sorted(g["jobs"].values(), key=lambda j: str(j.get("posted_at") or ""), reverse=True)[:8]
        co = g["company"]
        lines = "; ".join("%s%s" % (j["title"], (" (%s)" % j["location"]) if j["location"] else "") for j in roles)
        out.append({
            "key": "jobs:%s:%s" % (key, month), "kind": "jobs",
            "url": co["url"] or (roles[0]["url"] if roles else ""),
            "text": "%s is hiring on LinkedIn: %s." % (co["name"], lines),
            "posted_at": roles[0].get("posted_at") if roles else "",
            "author": {"name": co["name"], "headline": "Hiring %d role%s" % (len(roles), "" if len(roles) == 1 else "s"),
                       "url": co["url"], "key": key if key.startswith("company/") else "", "company": True},
            "company": co, "jobs": roles, "contacts": [], "reactions": 0, "comments": 0,
            "query": roles[0]["query"] if roles else "", "social_id": ""})
    return out


def _rank(person, departments):
    """Best first: someone who decides (a director or head, or above) before a manager; among them the
    offer's own department before the rest (Marketing before C-Suite for an agency, so a VP Marketing comes
    before the CEO); then the most senior."""
    from . import account_mapper as am
    levels = am.levels_for(person.get("title"))
    level = max([am.LEVEL_RANK.get(x, 1) for x in levels] or [1])
    theirs = [person.get("department")] + am.departments_for(person.get("title"))
    dept = max([len(departments) - departments.index(d) for d in theirs if d in departments] or [0])
    return (level >= am.LEVEL_RANK["Director"], dept, level)


def contacts_at(company, departments, *, client):
    """The people who decide at `company` (its name, and its domain when known), best first: in one of the
    offer's departments and senior. Free: Saleshandy charges only to reveal an email."""
    base = {"company_domain": {"includes": [company["domain"]]}} if company.get("domain") else \
        {"company_name": {"includes": [company["name"]]}}
    found, seen = [], set()
    for filters in (dict(base, management_level={"includes": LEADER_LEVELS}, department={"includes": departments}),
                    dict(base, management_level={"includes": LEADER_LEVELS})):
        for p in client.search_people(filters).get("people") or []:
            if not p.get("id") or p["id"] in seen:
                continue
            if not company.get("domain") and not same_company(p.get("company"), company["name"]):
                continue
            seen.add(p["id"])
            found.append(p)
        if len(found) >= CONTACTS:
            break
    found.sort(key=lambda p: _rank(p, departments), reverse=True)
    return [{"id": p["id"], "name": p.get("name") or "", "title": p.get("title") or "", "location": p.get("location") or "",
             "domain": p.get("domain") or "", "key": "sh/%s" % p["id"], "linkedin": ""} for p in found[:CONTACTS]]


def decision_makers(leads, offers, *, client=None):
    """For each company lead (best first, MAX_COMPANIES at most), who to write to. Fills the lead's
    post["contacts"] and sets its person to the first of them ("sh/<Saleshandy id>"), until revealing
    their email gives a LinkedIn profile. Returns a note for the run, or None."""
    from . import saleshandy_client as sh
    leads = [x for x in leads if (x.get("post") or {}).get("kind") == "jobs"]
    if not leads:
        return None
    if client is None:
        if not sh.configured():
            return ("%d hiring compan%s kept without a person to write to: finding the decision maker needs "
                    "SALESHANDY_API_KEY." % (len(leads), "y" if len(leads) == 1 else "ies"))
        client = sh.Client()
    missed = 0
    for lead in leads[:MAX_COMPANIES]:
        depts = (offers.get(lead["offer"]) or {}).get("decision_makers") or ["C-Suite"]
        try:
            people = contacts_at(lead["post"]["company"], depts, client=client)
        except sh.SaleshandyError as e:
            return "Saleshandy stopped finding decision makers: %s" % e
        lead["post"]["contacts"] = people
        if people:
            lead["person"] = people[0]["key"]
        else:
            missed += 1
    notes = []
    if missed:
        notes.append("Saleshandy knew nobody senior at %d of the hiring companies." % missed)
    if len(leads) > MAX_COMPANIES:
        notes.append("Decision makers were looked up for the best %d hiring companies only." % MAX_COMPANIES)
    return " ".join(notes) or None
