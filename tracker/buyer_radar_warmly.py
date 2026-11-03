"""Lead Finder: the companies and people Warmly sends us, as leads.

Warmly (warmly.ai) names the companies and people reading our site, and its Orchestrator can watch for
more: new hires, job changes, Bombora research intent, people engaging on LinkedIn. Each orchestration can
end in "Send Contact to Webhook" or "Send Company to Webhook" (and the free plan sends every identified
visitor to one webhook, Settings > Webhooks). Each workspace has its own address for it:

    https://<site>/api/lead-finder/warmly/<token>

The token is the workspace's secret (Warmly signs nothing, so the address is the only key); the team
makes it, or a new one, in Lead Finder's Settings. What arrives waits in br_warmly_inbox and the next run
reads it like a post: Claude scores it against the offers (buyer_radar_judge.WARMLY_SYSTEM), a message is
written, and it goes to the sheet and Slack. Our own people are never a lead.

The payload shapes are Warmly's (help.warmly.ai, "Setting Up Webhooks", read 2026-11-03): contact fields
in Title Case ("Business Email", "LinkedIn URL", "Company Name"), the company of a "Website Visit Company"
in lower case ("domain", "name", "industry"), the signal in "Signal" and the orchestration in
"Orchestration Name". Signals without a published example (New Hire, Job Change, Social Engager, Job
Opening) are read from the same names, and kept whole beside what is read, until a live one shows more.

    new_token()                       a workspace's new secret
    records(body)                     the records in one webhook request (one object or a list)
    normalize(record, received_at)    a record as a Lead Finder signal, or None (ours, or nobody named)
    text(n, signal)                   what Claude reads
"""
from __future__ import annotations

import hashlib
import re
import secrets

MAX_RECORDS = 100          # records one request may carry
MAX_BYTES = 256 * 1024     # one record, as stored
PER_RUN = 60               # signals a run takes from the inbox; the rest wait for the next
TOKEN_RX = re.compile(r"^[A-Za-z0-9_-]{24,64}$")
# Our own companies: a visit from the team is never a lead.
OWN_DOMAINS = ("markifydigital.com", "northaxis.com", "outcomes.digital", "callvibe.ai")


def new_token():
    return secrets.token_urlsafe(24)


def valid_token(token):
    return bool(TOKEN_RX.match(token or ""))


def records(body):
    """The records in one request: Warmly sends one JSON object; a list of them is taken too."""
    items = body if isinstance(body, list) else [body]
    return [r for r in items if isinstance(r, dict)][:MAX_RECORDS]


def _s(v, n=300):
    return re.sub(r"\s+", " ", str(v)).strip()[:n] if v not in (None, "") else ""


def _get(r, *names):
    for name in names:
        v = r.get(name)
        if v not in (None, "", [], {}):
            return v
    return ""


def host_of(v):
    v = _s(v, 200).lower()
    v = re.sub(r"^https?://", "", v).split("/")[0].split("?")[0]
    return v[4:] if v.startswith("www.") else v


def is_ours(domain):
    d = host_of(domain)
    return any(d == o or d.endswith("." + o) for o in OWN_DOMAINS)


def _pages(r):
    details = r.get("Pages Viewed Details") if isinstance(r.get("Pages Viewed Details"), list) else []
    out = []
    for p in details[:25]:
        if isinstance(p, dict) and p.get("URL"):
            path = _s(p["URL"], 200).split("?")[0] or "/"
            secs = p.get("Active Seconds")
            out.append({"path": path, "seconds": int(secs) if isinstance(secs, (int, float)) else None})
    if not out and r.get("Pages Viewed"):
        out = [{"path": _s(x, 200).split("?")[0], "seconds": None} for x in str(r["Pages Viewed"]).split(",") if x.strip()][:25]
    return out


def _topics(r):
    got = r.get("Bombora Research Intent")
    out = []
    for t in got if isinstance(got, list) else []:
        if isinstance(t, dict) and (t.get("Topic") or t.get("topic")):
            out.append({"topic": _s(t.get("Topic") or t.get("topic"), 80), "score": t.get("Score", t.get("score"))})
    return out[:12]


def normalize(r, received_at=""):
    """One Warmly record as a Lead Finder signal (the shape buyer_radar_source.normalize gives a post), or
    None when it names nobody we could write to, or is one of us."""
    from . import buyer_radar_source as src
    if not isinstance(r, dict):
        return None
    signal = _s(_get(r, "Signal", "signal"), 60) or "Warmly signal"
    email = _s(_get(r, "Business Email", "Email", "email"), 200).lower()
    if email and "@" not in email:
        email = ""
    linkedin = _s(_get(r, "LinkedIn URL", "Linkedin URL", "linkedinUrl"), 300)
    first, last = _s(_get(r, "First Name"), 80), _s(_get(r, "Last Name"), 80)
    name = _s(" ".join(x for x in (first, last) if x), 160) or _s(_get(r, "Full Name", "Name"), 160)
    title = _s(_get(r, "Title", "Job Title", "New Title"), 160)
    company = _s(_get(r, "Company Name", "name", "Company"), 160)
    domain = host_of(_get(r, "Website", "domain", "Company Domain"))
    if not domain and email:
        domain = email.split("@", 1)[1]
    if is_ours(domain) or (email and is_ours(email.split("@", 1)[1])):
        return None
    person_key = src.profile_key(linkedin) if linkedin else ""
    if not (person_key or email or domain):
        return None
    industry = _s(_get(r, "Industry", "industry", "subIndustry"), 120)
    size = _s(_get(r, "Employee Count", "employeesRange"), 40)
    country = _s(_get(r, "Country", "Company Country", "country", "IP Country"), 80)
    city = _s(_get(r, "City", "Company City", "city"), 80)
    pages = _pages(r)
    topics = _topics(r)
    seen_at = _s(_get(r, "Seen At", "Webhook Sent At"), 40) or received_at
    who = person_key or ("wm/" + email if email else "")
    day = (seen_at or received_at or "")[:10]
    key = "wm:" + hashlib.sha1(("%s|%s|%s|%s" % (signal.lower(), who or domain, domain, day)).encode()).hexdigest()[:20]
    facts = ["Warmly signal: %s" % signal]
    if r.get("Orchestration Name"):
        facts.append("From the Warmly workflow: %s" % _s(r["Orchestration Name"], 120))
    if pages:
        facts.append("Pages read on our site: " + ", ".join(
            "%s%s" % (p["path"], " (%ds)" % p["seconds"] if p["seconds"] else "") for p in pages[:10]))
    if r.get("Session Active Seconds"):
        facts.append("Time on our site: %s seconds" % _s(r["Session Active Seconds"], 10))
    if topics:
        facts.append("Researching (Bombora): " + ", ".join(t["topic"] for t in topics))
    for label, field in (("Came from", "Referrer"), ("Campaign", "UTM Campaign"), ("About the company", "description")):
        if r.get(field):
            facts.append("%s: %s" % (label, _s(r[field], 300)))
    chat = r.get("inboundCollectedFields") if isinstance(r.get("inboundCollectedFields"), dict) else {}
    if chat:
        facts.append("Told our chat: " + "; ".join("%s %s" % (k, _s(v, 120)) for k, v in list(chat.items())[:6]))
    contact = {"name": name, "title": title, "email": email, "linkedin": linkedin,
               "location": ", ".join(x for x in (city, country) if x)}
    return {
        "key": key, "kind": "warmly", "query": "warmly",
        "url": linkedin or ("https://" + domain if domain else ""),
        "posted_at": seen_at, "text": "\n".join(facts),
        "author": {"name": name or company or domain, "headline": " at ".join(x for x in (title, company) if x),
                   "url": linkedin, "key": who, "company": not name},
        "company": {"name": company or domain, "domain": domain, "industry": industry, "size": size, "country": country},
        "contacts": [contact] if (name or email or linkedin) else [],
        "warmly": {"signal": signal, "orchestration": _s(r.get("Orchestration Name"), 120), "pages": pages,
                   "topics": topics, "session_url": _s(r.get("Session URL"), 300)},
    }


def text(n, p):
    """What Claude reads for one Warmly signal."""
    a, c = p.get("author") or {}, p.get("company") or {}
    return "SIGNAL %d (seen %s)\nPERSON: %s\nCOMPANY: %s (%s), industry %s, %s people, %s\n%s" % (
        n, p.get("posted_at") or "date unknown", (a.get("headline") or a.get("name") or "not named"),
        c.get("name") or "unknown", c.get("domain") or "no website", c.get("industry") or "unknown",
        c.get("size") or "unknown", c.get("country") or "country unknown", (p.get("text") or "")[:2000])
