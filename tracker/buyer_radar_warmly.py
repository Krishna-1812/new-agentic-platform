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
Opening) are read from the same names; every other field a record carries (the post someone engaged with,
their comment, a previous title) goes to Claude as it came, under "Other details from Warmly", so a new
signal type is read without a code change. Each signal has a type (signal_type) that decides what a
message may say about how we came to write: a public comment or a new role may be mentioned, a website
visit or research never.

    new_token()                       a workspace's new secret
    records(body)                     the records in one webhook request (one object or a list)
    normalize(record, received_at)    a record as a Lead Finder signal, or None (ours, or nobody named)
    signal_type(signal)               website, social, new_hire, job_change, hiring, research or other
    extras(record)                    the fields normalize does not read, as "Field: value" lines
    text(n, signal)                   what Claude reads
    from_mcp(kind, row)               a row from Warmly's MCP server (visitors, accounts, signals) as a record

The daily Warmly routine (docs/warmly-engine.md) reads Warmly through its MCP server, the one connected to
Claude, and sends what it finds to /api/lead-finder/warmly-push (scripts/warmly_push.py). from_mcp turns
each of those rows into the record a webhook would have sent, so normalize reads both the same way.
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
# A personal address names a person, not their company: its domain is never taken as the company's.
FREE_MAIL = frozenset(("gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.co.uk", "outlook.com",
                       "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com", "aol.com", "proton.me",
                       "protonmail.com", "yandex.com", "rediffmail.com", "zoho.com", "gmx.com", "mail.com"))
# The fields normalize reads itself; every other field goes to Claude through extras().
READ = frozenset((
    "Signal", "signal", "Orchestration Name", "Webhook Sent At", "Business Email", "Email", "email",
    "LinkedIn URL", "Linkedin URL", "linkedinUrl", "First Name", "Last Name", "Full Name", "Name", "Title",
    "Job Title", "New Title", "Company Name", "name", "Company", "Website", "domain", "Company Domain",
    "Industry", "industry", "subIndustry", "Employee Count", "employeesRange", "Country", "Company Country",
    "country", "IP Country", "City", "Company City", "city", "Seen At", "Pages Viewed", "Pages Viewed Details",
    "Session Active Seconds", "Bombora Research Intent", "Referrer", "UTM Campaign", "description",
    "inboundCollectedFields", "Session URL", "Signal Details"))
# Fields Claude never needs: ids, pictures, other ways to reach someone, network details.
SKIP_RX = re.compile(r"avatar|image|photo|logo|picture|phone|mobile|e-?mail|token|hash|cookie|ip address|"
                     r"^ip$|session url|webhook|password|secret", re.I)
MAX_EXTRAS, EXTRAS_CHARS = 20, 1500


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


def signal_type(signal):
    """What kind of signal a Warmly record is, from its "Signal" name."""
    s = (signal or "").lower()
    if s.startswith("news") or "funding" in s:
        return "news"
    if "social" in s or "engag" in s or "linkedin" in s:
        return "social"
    if "job" in s and "chang" in s:
        return "job_change"
    if "hire" in s or "promot" in s:
        return "new_hire"
    if "opening" in s or "hiring" in s:
        return "hiring"
    if "bombora" in s or "research" in s or "intent" in s:
        return "research"
    if "visit" in s or "website" in s or "page" in s:
        return "website"
    return "other"


def _skip(key):
    k = str(key)
    return (k.lower() in ("id", "uuid") or bool(re.search(r"(?:[ _-](?:id|uuid)|Id|ID|Uuid)$", k))
            or bool(SKIP_RX.search(k)))


def _flat(v, depth=0):
    """A field's value as one short line: lists and objects one level down, nothing deeper."""
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        return _s(v, 300)
    if isinstance(v, list) and depth == 0:
        return _s("; ".join(x for x in (_flat(i, 1) for i in v[:5]) if x), 300)
    if isinstance(v, dict) and depth <= 1:
        parts = []
        for k, x in list(v.items())[:8]:
            got = "" if _skip(k) else _flat(x, depth + 1)
            if got:
                parts.append("%s %s" % (_s(k, 40), got))
        return _s(", ".join(parts), 300)
    return ""


def extras(r):
    """The fields normalize does not read, as "Field: value" lines, so Claude sees what each signal type
    carries (the post, the comment, the previous title) without a reader for each."""
    out, used = [], 0
    for k, v in r.items():
        if k in READ or _skip(k):
            continue
        val = _flat(v)
        if not val:
            continue
        line = "%s: %s" % (_s(k, 60), val)
        if len(out) >= MAX_EXTRAS or used + len(line) > EXTRAS_CHARS:
            break
        out.append(line)
        used += len(line)
    return out


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
    if not domain and email and email.split("@", 1)[1] not in FREE_MAIL:
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
    if r.get("Signal Details"):
        facts.append("What Warmly found: %s" % _s(r["Signal Details"], 1200))
    for label, field in (("Came from", "Referrer"), ("Campaign", "UTM Campaign"), ("About the company", "description")):
        if r.get(field):
            facts.append("%s: %s" % (label, _s(r[field], 300)))
    chat = r.get("inboundCollectedFields") if isinstance(r.get("inboundCollectedFields"), dict) else {}
    if chat:
        facts.append("Told our chat: " + "; ".join("%s %s" % (k, _s(v, 120)) for k, v in list(chat.items())[:6]))
    more = extras(r)
    if more:
        facts.append("Other details from Warmly:\n" + "\n".join("- " + x for x in more))
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
        "warmly": {"signal": signal, "type": signal_type(signal), "orchestration": _s(r.get("Orchestration Name"), 120), "pages": pages,
                   "topics": topics, "session_url": _s(r.get("Session URL"), 300)},
    }


def text(n, p):
    """What Claude reads for one Warmly signal."""
    a, c = p.get("author") or {}, p.get("company") or {}
    return "SIGNAL %d (seen %s)\nPERSON: %s\nCOMPANY: %s (%s), industry %s, %s people, %s\n%s" % (
        n, p.get("posted_at") or "date unknown", (a.get("headline") or a.get("name") or "not named"),
        c.get("name") or "unknown", c.get("domain") or "no website", c.get("industry") or "unknown",
        c.get("size") or "unknown", c.get("country") or "country unknown", (p.get("text") or "")[:2000])


# == rows from Warmly's MCP server =======================================================================
# The shapes are the ones Warmly's MCP server answered with (list_warm_visitors and list_warm_accounts, read
# 2026-11-11) and, for list_third_party_signals, the rows its help pages document ("The full signal
# catalog", read 2026-11-11): snake_case, with company, contact and data objects.

MCP_KINDS = ("visitors", "accounts", "signals")
MAX_ROWS = 500             # rows one push may carry, all kinds together
ENGINE_CREDITS = 1000      # Warmly credits the daily routine may spend a month (WARMLY_ENGINE_CREDITS)
PUSH_HEADER = "X-Warmly-Push-Token"


def engine_budget():
    """The month's Warmly credits for the daily routine: WARMLY_ENGINE_CREDITS, else ENGINE_CREDITS."""
    import os
    try:
        n = int((os.environ.get("WARMLY_ENGINE_CREDITS") or "").strip() or ENGINE_CREDITS)
    except ValueError:
        n = ENGINE_CREDITS
    return max(0, min(5000, n))


def allowance(used, budget, today=None):
    """Credits the routine may spend today: what is left of the month's budget, shared evenly over the days
    left, today included, so a quiet day leaves more for the rest of the month."""
    import calendar
    from datetime import datetime, timezone
    today = today or datetime.now(timezone.utc).date()
    left = max(0, int(budget - (used or 0)))
    days_left = calendar.monthrange(today.year, today.month)[1] - today.day + 1
    return -(-left // days_left) if left else 0

# signal_type/signal_subtype -> the "Signal" a record carries; signal_type() above reads these names.
SIGNAL_NAMES = {
    ("workmilestone", "jobChange"): "Job Change",
    ("workmilestone", "promotion"): "Promotion",
    ("workmilestone", "workAnniversary"): "Work anniversary",
    ("hiring-velocity", "hiringVelocity"): "Hiring fast",
    ("linkedin-post-company", None): "LinkedIn post by the company",
    ("linkedin-post-contact", None): "LinkedIn post",
    ("linkedin-comment", None): "LinkedIn comment",
}


def _words(camel):
    """hiringMarketingRoles -> "marketing roles"; fundingNews -> "funding news"."""
    w = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", str(camel or "")).replace("_", " ").replace("-", " ").lower().strip()
    return re.sub(r"^hiring ", "", w)


def signal_name(signal_type_, subtype):
    """What a third-party signal is called on the lead, from Warmly's type and subtype."""
    t, sub = (signal_type_ or "").strip(), (subtype or "").strip()
    name = SIGNAL_NAMES.get((t, sub)) or SIGNAL_NAMES.get((t, None))
    if name:
        return name
    if t == "hiring-trends":
        return "Hiring: " + (_words(sub) or "new roles")
    if t == "news" or (t in ("financial", "social_media", "website") and "funding" in sub.lower()):
        return "News: " + (_words(sub) or "company news")
    if t == "website-traffic":
        return "Website traffic estimate: " + (_words(sub) or "change")
    return ("%s: %s" % (_words(t), _words(sub))).strip(": ") or "Warmly signal"


def linkedin_url(handle, kind="in"):
    """A LinkedIn address from what Warmly gives: a full URL, "linkedin.com/company/acme", "in/x" or a bare
    handle."""
    h = _s(handle, 300)
    if not h:
        return ""
    if "linkedin.com" in h.lower():
        return h if h.lower().startswith("http") else "https://" + h.lstrip("/")
    h = h.strip("/")
    if h.startswith(("in/", "company/")):
        return "https://www.linkedin.com/%s/" % h
    return "https://www.linkedin.com/%s/%s/" % (kind, h)


def _d(v):
    return v if isinstance(v, dict) else {}


def _page_visits(visits):
    """pageVisits as the webhook's "Pages Viewed Details". Its items are not documented: a URL or path, and
    seconds when one is given, are read under the names they are likely to carry."""
    out = []
    for v in visits if isinstance(visits, list) else []:
        if isinstance(v, str):
            url, secs = v, None
        elif isinstance(v, dict):
            url = _get(v, "url", "URL", "pathname", "path", "page", "pageUrl")
            secs = _get(v, "activeSeconds", "active_seconds", "timeOnPage", "duration", "seconds")
        else:
            continue
        if url:
            out.append({"URL": _s(url, 300), "Active Seconds": secs if isinstance(secs, (int, float)) else None})
    return out[:25]


def _company_profile(cp):
    cp = _d(cp)
    return {"Company Name": cp.get("name"), "Website": cp.get("domain"),
            "Industry": cp.get("category_industry") or cp.get("category_subIndustry"),
            "Employee Count": cp.get("metrics_employeesRange"), "Country": cp.get("geo_country"),
            "City": cp.get("geo_city"), "description": cp.get("description"),
            "Company LinkedIn": linkedin_url(cp.get("linkedin_handle"), "company"),
            "Estimated revenue": cp.get("metrics_estimatedAnnualRevenue")}


def _visit_fields(row):
    pages = _page_visits(row.get("pageVisits"))
    secs = row.get("sessionTime")
    return {"Seen At": row.get("lastSeen"), "Pages Viewed Details": pages,
            "Session Active Seconds": secs if isinstance(secs, (int, float)) and secs > 0 else None,
            "Sessions": row.get("totalSessions"), "Pages visited": row.get("distinctPagesVisited") or None,
            "Campaigns": row.get("utmParams") or None}


def _from_visitor(row):
    ct = _d(row.get("contactProfile"))
    rec = {"Signal": "Website Visit"}
    rec.update(_company_profile(row.get("companyProfile")))
    rec.update({"Business Email": row.get("email") or ct.get("email"), "First Name": ct.get("firstName"),
                "Last Name": ct.get("lastName"), "Full Name": ct.get("fullName"),
                "Title": ct.get("employment_title"), "LinkedIn URL": linkedin_url(ct.get("linkedin_handle")),
                "Seniority": ct.get("employment_seniority"), "Department": ct.get("employment_role"),
                "Bio": ct.get("bio")})
    if not rec.get("Website"):
        rec["Website"] = ct.get("employment_domain") or row.get("domain")
    rec.update(_visit_fields(row))
    return rec


def _from_account(row):
    rec = {"Signal": "Website Visit Company"}
    rec.update(_company_profile(row.get("companyProfile")))
    if not rec.get("Website"):
        rec["Website"] = row.get("domain")
    rec.update(_visit_fields(row))
    rec.update({"Visitors": row.get("visitorCount"), "Identified visitors": row.get("identifiedVisitors")})
    return rec


def _from_signal(row):
    co, ct, data = _d(row.get("company")), _d(row.get("contact")), _d(row.get("data"))
    lo, hi = co.get("employee_count_low"), co.get("employee_count_high")
    size = ("%s-%s" % (lo, hi)) if lo and hi else (str(hi or lo) if (hi or lo) else "")
    industries = co.get("industries") if isinstance(co.get("industries"), list) else []
    details = " ".join(_s(x, 900) for x in (data.get("title"), data.get("post_text")) if x)
    return {"Signal": signal_name(row.get("signal_type"), row.get("signal_subtype")),
            "Company Name": co.get("name"), "Website": co.get("domain"),
            "Industry": ", ".join(_s(i, 60) for i in industries[:3]), "Employee Count": size,
            "Country": ct.get("country"), "City": ct.get("city"), "description": co.get("description"),
            "Company LinkedIn": linkedin_url(co.get("linkedin_url"), "company"),
            "First Name": ct.get("first_name"), "Last Name": ct.get("last_name"), "Full Name": ct.get("name"),
            "Title": ct.get("job_title"), "Business Email": ct.get("email"),
            "LinkedIn URL": linkedin_url(ct.get("linkedin_url")), "Seniority": ct.get("seniority_level"),
            "Department": ct.get("department"), "Seen At": row.get("detected_at"),
            "Signal Details": details, "Signal name": row.get("signal_name"),
            "Source link": data.get("url") or data.get("post_url") or data.get("source_url"),
            "Published": data.get("published_at") or data.get("posted_date") or data.get("filing_date"),
            "Sentiment": data.get("sentiment"), "Warmly relevance": data.get("sales_relevance") or data.get("relevance")}


def from_mcp(kind, row):
    """One row from Warmly's MCP server as the record a webhook would have sent, with the fields nobody
    gave left out; None for a kind this does not read."""
    if not isinstance(row, dict):
        return None
    make = {"visitors": _from_visitor, "accounts": _from_account, "signals": _from_signal}.get(kind)
    if not make:
        return None
    return {k: v for k, v in make(row).items() if v not in (None, "", [], {})}
