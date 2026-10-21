"""Buyer Radar: people and companies showing they need what we sell, in one place, with a message ready.

Each run looks for every offer switched on (CallVibe's call analytics and Markify's marketing services)
in three places, each switched on in Settings ("sources"):

    posts      LinkedIn posts asking for it (Unipile or Apify)
    comments   people in the comments of those posts saying they need it too (Unipile)
    jobs       companies whose LinkedIn job ads are the offer's work (Unipile), with who decides there
               found by Saleshandy's free people search
    icp        people who fit an offer's customer profile at a moment that matters (new in role, funded,
               hiring, using a rival), from Saleshandy's lead database (tracker/buyer_radar_icp.py)

Claude reads each one and says whether it is a buyer, a message is written for each lead, and, where
the workspace has switched it on, they are sent and the strong leads posted to Slack.
docs/buyer-radar-plan.md.

    OFFERS                         what each offer sells and the searches that find its buyers
    clean_settings(body, current)  a workspace's settings, checked
    estimate(settings)             the most a run can cost
    run(run_id, owner, settings)   one run, start to end (tracker/buyer_radar_store.start_run spawns it)

What it spends, every cent recorded in br_spend with who ran it and the workspace (admin panel):
Apify for the search (about $2 per 1,000 posts), Claude Haiku to read and to write, and, only where
"find emails" is on, one Saleshandy credit per email found.
"""
from __future__ import annotations

import logging
import re
from decimal import Decimal

log = logging.getLogger(__name__)

MODEL = "claude-haiku-5-5"

# == the offers ===========================================================================================
# The searches are LinkedIn's own post search (5 AND/OR/NOT at most). Each one is the exact words a buyer
# writes ("looking for a marketing agency", "recommend a call recording"): loose pairs such as
# "marketing agency" AND "looking for" brought back almost only sellers ("Looking to grow? We are an
# agency...") on the first live search, 2026-10-18.
OFFERS = {
    "callvibe": {
        "label": "CallVibe",
        "site": "https://callvibe.ai",
        "sells": ("CallVibe (callvibe.ai) is an AI conversation intelligence platform for sales and support calls. "
                  "It records, transcribes, summarises and scores calls; finds buying signals, objections and "
                  "sentiment; audits call quality, script and compliance adherence; coaches reps; writes follow-up "
                  "emails; and has a built-in CRM and pipeline. It connects to cloud telephony and CRMs such as "
                  "RingCentral, Zoom Phone, Exotel, LeadSquared, GoHighLevel and WhatsApp."),
        "buyers": ("Sales, inside-sales, call-centre, customer-support, QA and revenue-operations leaders, and "
                   "founders, who want call recording, call analytics, call audit or QA, speech analytics, "
                   "conversation intelligence, rep coaching or a cheaper alternative to Gong, Chorus or similar."),
        # who decides, for a company found by its job ads (Saleshandy's department names)
        "decision_makers": ["Sales", "Customer Service", "Operations", "C-Suite"],
        # LinkedIn job titles whose work CallVibe does or makes easier: people paid to listen to calls
        "jobs": ["call quality analyst", "quality analyst call center", "call auditor", "quality assurance analyst BPO",
                 "speech analytics", "sales enablement manager", "sales trainer", "customer support quality analyst",
                 "inside sales manager"],
        "queries": [
            '"looking for a call recording" OR "recommend a call recording" OR "call recording software recommendations"',
            '"looking for a conversation intelligence" OR "recommend a conversation intelligence" OR '
            '"conversation intelligence recommendations"',
            '"alternative to Gong" OR "Gong alternative" OR "alternatives to Gong" OR "cheaper than Gong"',
            '("call QA tool" OR "call auditing tool" OR "call monitoring software") AND (recommend OR "looking for")',
            '"looking for a speech analytics" OR "recommend a speech analytics" OR "speech analytics vendor"',
            '"any recommendations for" AND ("call recording" OR "call analytics" OR "sales call")',
            '"anyone using" AND (Gong OR Chorus OR "call analytics" OR "conversation intelligence")',
            # broader: the topic with any buying word, for posts worded their own way ("Looking for an AI
            # Solution / Freelancer for Call Auditing"); Claude drops the sellers these also find
            '("call audit" OR "call auditing") AND (looking OR vendor OR freelancer OR need)',
            '("call quality monitoring" OR "call QA") AND (looking OR vendor OR solution)',
            '("call analytics" OR "conversation intelligence") AND (looking OR vendor OR recommend)',
            '("speech analytics" OR "call recording") AND (looking OR recommend OR vendor)',
            # more ways buyers say it (2026-10-21): call centre QA, coaching, Gong's price, Indian telephony
            '"call center QA" AND (software OR tool) AND (looking OR recommend)',
            '"sales call" AND (coaching OR analytics) AND (tool OR software) AND recommend',
            '"Chorus alternative" OR "alternative to Chorus" OR "Gong pricing" OR "Gong is expensive"',
            '("AI call analysis" OR "AI call scoring" OR "AI call audit") AND (looking OR need OR recommend)',
            '(Exotel OR LeadSquared OR Ozonetel) AND ("call recording" OR "call analytics")',
            '"listen to calls" AND (QA OR quality OR coaching) AND (tool OR software)',
        ],
    },
    "markify": {
        "label": "Markify Digital",
        "site": "https://markifydigital.com",
        "sells": ("Markify Digital is a digital marketing agency: strategy and positioning, Google Ads and paid "
                  "social, SEO and AI search visibility, websites and landing pages, content, video, social media "
                  "management and lead generation, measured by pipeline."),
        "buyers": ("Founders, CEOs and marketing leaders looking for a marketing, digital, performance, SEO or "
                   "paid-media agency or freelancer, issuing a marketing RFP, asking for agency recommendations, "
                   "or building out marketing that they could hand to an agency."),
        "decision_makers": ["Marketing", "C-Suite"],
        # LinkedIn job titles whose work an agency does: a company hiring them is building marketing in house
        "jobs": ["performance marketing manager", "digital marketing manager", "SEO specialist", "SEO executive",
                 "Google Ads specialist", "PPC specialist", "paid media manager", "social media manager",
                 "growth marketing manager", "content marketing manager"],
        "queries": [
            '"looking for a marketing agency" OR "looking for a digital marketing agency" OR '
            '"looking for a performance marketing agency"',
            '"recommend a marketing agency" OR "recommend a digital marketing agency" OR '
            '"recommendations for a marketing agency"',
            '"looking for an SEO agency" OR "recommend an SEO agency" OR "looking for an SEO consultant"',
            '"looking for a Google Ads" OR "recommend a Google Ads" OR "looking for a PPC agency" OR '
            '"looking for a paid ads agency"',
            '"marketing RFP" OR "RFP for digital marketing" OR "RFP for marketing services" OR "marketing agency RFP"',
            '"looking for a social media agency" OR "looking for a branding agency" OR '
            '"looking for a web design agency" OR "need a marketing agency"',
            # broader: the topic with any buying word ("WAE is hiring a marketing agency... The RFP goes out")
            '"marketing agency" AND (hiring OR RFP OR "looking for" OR seeking)',
            '"marketing partner" AND (looking OR seeking OR hiring)',
            '("SEO agency" OR "SEO partner" OR "SEO consultant") AND (looking OR need OR recommend)',
            '("Google Ads" OR PPC) AND (agency OR freelancer) AND looking',
            '("branding agency" OR "creative agency" OR "web design agency") AND (looking OR need OR RFP)',
            '"request for proposal" AND (marketing OR agency)',
            # more ways buyers say it (2026-10-21): paid social, growth, content, lead generation, fractional
            '"looking for a Meta ads" OR "looking for a Facebook ads" OR "looking for a LinkedIn ads" OR '
            '"looking for a paid social"',
            '"need help with" AND ("Google Ads" OR "Meta ads" OR "paid ads")',
            '"looking for a growth marketer" OR "looking for a growth marketing agency" OR "looking for a fractional CMO"',
            '"lead generation agency" AND (looking OR recommend OR need)',
            '"content marketing agency" AND (looking OR recommend OR need)',
            '"fractional CMO" AND (looking OR hiring OR need)',
            '"website redesign" AND (agency OR freelancer) AND (looking OR need)',
            '"recommend an agency" OR "agency recommendations" OR "can anyone recommend an agency"',
        ],
    },
}

# == settings =============================================================================================
SEARCH_SOURCES = {"unipile": "Unipile", "apify": "Apify"}
# where leads come from; "posts" through the source above, the rest through Unipile
LEAD_SOURCES = {"posts": "LinkedIn posts", "comments": "Their comments", "jobs": "Job ads", "icp": "Customer profiles"}

DEFAULTS = {
    "source": "unipile",              # who runs the search: Unipile (free per post, as our LinkedIn account) or Apify
    "sources": ["posts", "comments", "jobs", "icp"],   # where leads come from (LEAD_SOURCES)
    "offers": ["callvibe", "markify"],
    "queries": {},                    # offer -> its own searches, in place of OFFERS[offer]["queries"]
    "job_queries": {},                # offer -> its own job titles, in place of OFFERS[offer]["jobs"]
    "job_locations": [],              # places the job ads are in ("India", "London"); none is anywhere
    "jobs_days": 14,                  # job ads posted in the last this many days
    "jobs_per_query": 20,             # job ads per title
    "comment_posts": 10,              # the best posts kept whose comments are read
    "icps": {},                       # offer -> its customer profiles, in place of buyer_radar_icp.DEFAULT_ICPS
    "icp_per_run": 30,                # people the customer profiles add to a run, all profiles together
    "sequences": {},                  # offer -> the Saleshandy sequence its leads go to {"id", "step_id", "title"}
    "sequence_field": "",             # a Saleshandy prospect field that carries the message written, if any
    "auto_sequence": False,           # strong leads go to the offer's sequence, in place of one email
    "posted": "3months",              # how far back each search looks; a post already kept is not read again
    "per_query": 25,                  # posts per search
    "keep_score": 50,                 # a post scored below this is not kept as a lead
    "alert_score": 70,                # Slack and the "strong" filter
    "daily": False,                   # the once-a-day run (.github/workflows/buyer-radar-daily.yml)
    "run_cap_usd": 2.0,               # the most one run may spend
    "monthly_cap_usd": 40.0,          # the daily run is skipped once this month's spend reaches it
    "slack_channel": "",
    "auto_email": False,
    "auto_linkedin": False,
    "send_score": 80,                 # auto-send only to leads at or above this
    "daily_email_cap": 20,
    "daily_linkedin_cap": 15,
    "find_emails": False,             # Saleshandy, one credit per email found, only for leads being emailed
    "senders": {o: {"name": "", "title": "", "email": ""} for o in OFFERS},
    "postal_address": "",             # in every email's footer
}
LIMITS = {"per_query": (5, 100), "keep_score": (0, 100), "alert_score": (0, 100), "send_score": (50, 100),
          "daily_email_cap": (0, 100), "daily_linkedin_cap": (0, 80), "jobs_days": (1, 30),
          "jobs_per_query": (5, 100), "comment_posts": (0, 30), "icp_per_run": (0, 100)}
USD_LIMITS = {"run_cap_usd": (0.1, 20.0), "monthly_cap_usd": (1.0, 500.0)}
MAX_QUERIES = 20
MAX_JOB_QUERIES = 20
MAX_JOB_LOCATIONS = 5
CHANNEL_RX = re.compile(r"^[#]?[A-Za-z0-9._-]{1,80}$")
EMAIL_RX = re.compile(r"^[^@\s<>\"']+@[^@\s<>\"']+\.[A-Za-z]{2,}$")


def merged(saved):
    """The defaults with what a workspace saved on top, so a setting added later has a value."""
    out = {k: (dict(v) if isinstance(v, dict) else list(v) if isinstance(v, list) else v) for k, v in DEFAULTS.items()}
    out["senders"] = {o: dict(s) for o, s in DEFAULTS["senders"].items()}
    for k, v in (saved or {}).items():
        if k == "senders" and isinstance(v, dict):
            for o, s in v.items():
                if o in out["senders"] and isinstance(s, dict):
                    out["senders"][o].update({f: str(s.get(f) or "") for f in ("name", "title", "email")})
        elif k in out:
            out[k] = v
    return out


def search_missing(settings):
    """The variable the chosen search needs and this service lacks, or None. Posts need their search's
    key; comments and job ads need Unipile's. A run can go when one source switched on can."""
    import os
    on = sources_on(settings)
    post_key = "UNIPILE_API_KEY" if settings.get("source") == "unipile" else "APIFY_API_TOKEN"
    if "posts" in on and os.environ.get(post_key):
        return None
    if "jobs" in on and os.environ.get("UNIPILE_API_KEY"):
        return None
    if "icp" in on and os.environ.get("SALESHANDY_API_KEY"):
        return None
    return post_key if "posts" in on else "UNIPILE_API_KEY" if "jobs" in on else "SALESHANDY_API_KEY"


def split_room(room, demands):
    """The day's Unipile search results shared between the sources that use them: each gets what it
    asks for when there is room, else an equal share, with what a smaller one leaves over going to the
    rest. {name: results}."""
    out, left = {}, max(0, int(room))
    pending = sorted(((max(0, int(d)), k) for k, d in demands.items()))
    while pending:
        share = left // len(pending)
        d, k = pending.pop(0)
        out[k] = min(d, share) if pending else min(d, left)
        left -= out[k]
    return out


def queries_for(settings, offer):
    own = (settings.get("queries") or {}).get(offer)
    return list(own) if own else list(OFFERS[offer]["queries"])


def job_queries_for(settings, offer):
    own = (settings.get("job_queries") or {}).get(offer)
    return list(own) if own else list(OFFERS[offer]["jobs"])


def sources_on(settings):
    return [x for x in settings.get("sources") or [] if x in LEAD_SOURCES]


def _lines(v):
    lines = v.splitlines() if isinstance(v, str) else v if isinstance(v, list) else []
    return [re.sub(r"\s+", " ", str(x)).strip() for x in lines if str(x).strip()]


def _num(v, lo, hi, cast):
    try:
        v = cast(v)
    except (TypeError, ValueError):
        raise ValueError("must be a number")
    if not lo <= v <= hi:
        raise ValueError("must be between %s and %s" % (lo, hi))
    return v


def clean_settings(body, current=None):
    """`body` laid over `current` (a workspace's saved settings), each value checked. Raises ValueError
    with what is wrong, in words for the page."""
    from . import buyer_radar_source as src
    out = merged(current)
    body = body if isinstance(body, dict) else {}
    if "offers" in body:
        offers = [o for o in body["offers"] or [] if o in OFFERS] if isinstance(body["offers"], list) else []
        if not offers:
            raise ValueError("Pick at least one offer to look for.")
        out["offers"] = list(dict.fromkeys(offers))
    if "queries" in body:
        qs = body["queries"] if isinstance(body["queries"], dict) else {}
        clean = {}
        for offer, lines in qs.items():
            if offer not in OFFERS:
                continue
            lines = lines.splitlines() if isinstance(lines, str) else lines if isinstance(lines, list) else []
            lines = [str(q).strip() for q in lines if str(q).strip()]
            if len(lines) > MAX_QUERIES:
                raise ValueError("%s: at most %d searches." % (OFFERS[offer]["label"], MAX_QUERIES))
            for q in lines:
                why = src.check_query(q)
                if why:
                    raise ValueError("%s: the search “%s” %s." % (OFFERS[offer]["label"], q[:60], why))
            if lines and lines != OFFERS[offer]["queries"]:
                clean[offer] = lines
        out["queries"] = clean
    if "sources" in body:
        got = [x for x in body["sources"] or [] if x in LEAD_SOURCES] if isinstance(body["sources"], list) else []
        if not got:
            raise ValueError("Pick at least one place to look: posts, their comments or job ads.")
        if got == ["comments"]:
            raise ValueError("Their comments are read under the posts found, so LinkedIn posts must be on too.")
        out["sources"] = [x for x in LEAD_SOURCES if x in got]
    if "job_queries" in body:
        qs = body["job_queries"] if isinstance(body["job_queries"], dict) else {}
        clean = {}
        for offer, lines in qs.items():
            if offer not in OFFERS:
                continue
            lines = _lines(lines)
            if len(lines) > MAX_JOB_QUERIES:
                raise ValueError("%s: at most %d job titles." % (OFFERS[offer]["label"], MAX_JOB_QUERIES))
            if any(len(q) > 100 for q in lines):
                raise ValueError("%s: a job title is at most 100 characters." % OFFERS[offer]["label"])
            if lines and lines != OFFERS[offer]["jobs"]:
                clean[offer] = lines
        out["job_queries"] = clean
    if "job_locations" in body:
        places = _lines(body["job_locations"].replace(",", "\n") if isinstance(body["job_locations"], str)
                        else body["job_locations"])
        if len(places) > MAX_JOB_LOCATIONS:
            raise ValueError("At most %d job locations." % MAX_JOB_LOCATIONS)
        if any(len(x) > 60 for x in places):
            raise ValueError("A job location is at most 60 characters.")
        out["job_locations"] = list(dict.fromkeys(places))
    if "source" in body:
        if body["source"] not in SEARCH_SOURCES:
            raise ValueError("Search with must be Unipile or Apify.")
        out["source"] = body["source"]
    if "posted" in body:
        if body["posted"] not in src.POSTED:
            raise ValueError("How far back must be one of %s." % ", ".join(src.POSTED))
        out["posted"] = body["posted"]
    for k, (lo, hi) in LIMITS.items():
        if k in body:
            try:
                out[k] = _num(body[k], lo, hi, int)
            except ValueError as e:
                raise ValueError("%s %s." % (k.replace("_", " ").capitalize(), e))
    for k, (lo, hi) in USD_LIMITS.items():
        if k in body:
            try:
                out[k] = round(_num(body[k], lo, hi, float), 2)
            except ValueError as e:
                raise ValueError("%s %s." % (k.replace("_usd", "").replace("_", " ").capitalize(), e))
    if "icps" in body:
        from . import buyer_radar_icp as icp_mod
        given = body["icps"] if isinstance(body["icps"], dict) else {}
        clean = dict(out.get("icps") or {})
        for offer, rows in given.items():
            if offer not in OFFERS:
                continue
            if rows is None:
                clean.pop(offer, None)            # back to the defaults
                continue
            rows = rows if isinstance(rows, list) else []
            if len(rows) > icp_mod.MAX_ICPS:
                raise ValueError("%s: at most %d customer profiles." % (OFFERS[offer]["label"], icp_mod.MAX_ICPS))
            clean[offer] = [icp_mod.clean_icp(r, OFFERS[offer]["label"]) for r in rows]
        out["icps"] = clean
    if "sequences" in body:
        seqs = body["sequences"] if isinstance(body["sequences"], dict) else {}
        clean = {}
        for offer, sq in seqs.items():
            if offer in OFFERS and isinstance(sq, dict) and str(sq.get("id") or "").strip() and str(sq.get("step_id") or "").strip():
                clean[offer] = {k: str(sq.get(k) or "").strip()[:120] for k in ("id", "step_id", "title")}
        out["sequences"] = clean
    if "sequence_field" in body:
        out["sequence_field"] = re.sub(r"\s+", " ", str(body["sequence_field"] or "")).strip()[:60]
    for k in ("daily", "auto_email", "auto_linkedin", "find_emails", "auto_sequence"):
        if k in body:
            out[k] = body[k] is True
    if "slack_channel" in body:
        ch = str(body["slack_channel"] or "").strip()
        if ch and not CHANNEL_RX.match(ch):
            raise ValueError("The Slack channel should look like #buyer-leads or a channel ID.")
        out["slack_channel"] = ch
    if "postal_address" in body:
        out["postal_address"] = str(body["postal_address"] or "").strip()[:200]
    if isinstance(body.get("senders"), dict):
        for offer, s in body["senders"].items():
            if offer not in OFFERS or not isinstance(s, dict):
                continue
            row = {f: str(s.get(f) or "").strip()[:120] for f in ("name", "title", "email")}
            if row["email"] and not EMAIL_RX.match(row["email"]):
                raise ValueError("%s: the sender's email does not look right." % OFFERS[offer]["label"])
            out["senders"][offer] = row
    if out["alert_score"] < out["keep_score"]:
        out["alert_score"] = out["keep_score"]
    return out


# == what a run can cost ==================================================================================
JUDGE_BATCH = 8
# Claude Haiku 5.5 thinks before it answers, and its thinking counts toward these limits: room for both.
JUDGE_MAX_TOKENS = 6000
DRAFT_MAX_TOKENS = 3000


def estimate(settings):
    """The most one run can cost, and what it usually costs. Through Apify the post search is paid at its
    list price for every post the searches may return; through Unipile it is free per result, and every
    LinkedIn search a run makes (posts, job ads) reads at most the day's Unipile limit. Claude reads each
    post, company and comment (in batches) and drafts for up to one in four. The run's cap (run_cap_usd)
    is what is enforced."""
    from . import buyer_radar_source as src, buyer_radar_unipile as uni, market_radar_costs as costs
    on = sources_on(settings)
    n_queries = sum(len(queries_for(settings, o)) for o in settings["offers"]) if "posts" in on else 0
    n_jobs = (sum(len(job_queries_for(settings, o)) for o in settings["offers"]) * max(1, len(settings.get("job_locations") or []))
              if "jobs" in on else 0)
    posts = n_queries * int(settings["per_query"])
    jobs = n_jobs * int(settings["jobs_per_query"])
    unipile = settings.get("source") == "unipile"
    room = split_room(uni.day_max(), {"posts": posts if unipile else 0, "jobs": jobs})
    if unipile:
        posts = room["posts"]
    jobs = room["jobs"]
    comments = int(settings["comment_posts"]) * 30 if "comments" in on and "posts" in on else 0
    read = posts + jobs // 2 + comments          # job ads are read a company at a time
    people = int(settings.get("icp_per_run") or 0) if "icp" in on else 0      # drafted, never read
    apify = 0.0 if unipile else posts * src.USD_PER_POST
    batches = -(-read // JUDGE_BATCH)
    judge = float(costs.worst_case_model_usd(MODEL, 900 * JUDGE_BATCH + 1500, JUDGE_MAX_TOKENS)) * batches
    drafts = float(costs.worst_case_model_usd(MODEL, 2500, DRAFT_MAX_TOKENS)) * max(1, read // 4 + people)
    worst = apify + judge + drafts
    return {"queries": n_queries, "posts": posts, "job_queries": n_jobs, "jobs": jobs, "comments": comments, "people": people,
            "source": "unipile" if unipile else "apify",
            "apify_usd": round(apify, 4), "claude_usd": round(judge + drafts, 4),
            "worst_usd": round(worst, 4), "typical_usd": round(apify * 0.6 + (judge + drafts) * 0.3, 4),
            "usd_cap": float(settings["run_cap_usd"]), "capped": worst > float(settings["run_cap_usd"]),
            "month_usd": round(min(worst, float(settings["run_cap_usd"])) * 30, 2)}


# == the export ===========================================================================================
SOURCE_LABELS = {"post": "LinkedIn post", "comment": "Comment on a post", "jobs": "Job ads"}
EXPORT_COLS = [("Found", "created_at"), ("Score", "score"), ("Offer", "offer"), ("Source", "source"), ("Status", "status"),
               ("Name", "name"), ("Headline", "headline"), ("Profile", "profile"), ("Email address", "email"),
               ("What they want", "need"), ("Intent", "intent"), ("Company", "company"), ("Region", "region"),
               ("Deadline", "deadline"), ("Why", "reason"), ("Posted", "posted_at"), ("Post", "url"),
               ("Post text", "text"), ("Contacted", "contacted")]
EXPORT_DRAFT_COLS = [("Email subject", "subject"), ("Email body", "email_body"), ("LinkedIn note", "note"),
                     ("LinkedIn message", "message")]


def _cell(v):
    """A spreadsheet cell that is only ever text: a value starting = + - @ (or a tab or return) would be
    read by Excel or Sheets as a formula, and a post is written by anyone on LinkedIn."""
    v = "" if v is None else str(v)
    return "'" + v if v[:1] in ("=", "+", "-", "@", "\t", "\r") else v


def leads_csv(leads, *, drafts=True):
    """The leads as CSV text, one row each, with the post, the person and what Claude read. `drafts` adds
    the messages written for them (the team's; a client does not see them on the page either). Starts with
    a byte order mark so Excel on Windows opens it as UTF-8."""
    import csv
    import io
    cols = EXPORT_COLS + (EXPORT_DRAFT_COLS if drafts else [])
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([label for label, _ in cols])
    for lead in leads:
        post, v, d = lead.get("post") or {}, lead.get("verdict") or {}, lead.get("draft") or {}
        a = post.get("author") or {}
        sent = sorted({"%s (%s)" % (s.get("channel"), (s.get("at") or "")[:10]) for s in lead.get("sends") or []
                       if s.get("status") == "sent"})
        row = {"created_at": (lead.get("created_at") or "")[:10], "score": lead.get("score"),
               "offer": OFFERS.get(lead.get("offer"), {}).get("label", lead.get("offer")), "status": lead.get("status"),
               "source": SOURCE_LABELS.get(lead.get("source") or "post", lead.get("source")),
               "name": a.get("name"), "headline": a.get("headline"), "profile": a.get("url"), "email": lead.get("email"),
               "need": v.get("need"), "intent": v.get("intent_label") or v.get("intent"), "company": v.get("company"),
               "region": v.get("region"), "deadline": v.get("deadline"), "reason": v.get("reason"),
               "posted_at": (post.get("posted_at") or "")[:10], "url": post.get("url"), "text": post.get("text"),
               "contacted": ", ".join(sent), "subject": d.get("subject"), "email_body": d.get("email"),
               "note": d.get("note"), "message": d.get("message")}
        w.writerow([_cell(row[key]) for _, key in cols])
    return "\ufeff" + buf.getvalue()


# == emails in a post ====================================================================================
POST_EMAIL_RX = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def emails_in(text):
    """Addresses the author wrote in the post ("send your deck to x@y.com"). Free, and the best address
    there is: they asked to be written to there."""
    seen = []
    for e in POST_EMAIL_RX.findall(text or ""):
        e = e.strip(".").lower()
        if e not in seen and not e.endswith((".png", ".jpg", ".jpeg", ".gif")):
            seen.append(e)
    return seen[:3]


# == one run ==============================================================================================

def run(run_id, owner, settings, *, started_by=None, deps=None):
    """Search, read, keep, draft, then (if switched on) find emails, send and post to Slack. Every stage is
    saved as it ends, and the leads are saved before anything is sent, so a failure late in the run keeps
    what was found. deps replaces the outside world in tests: search, unipile_search, jobs_search,
    job_locations, comments, people, judge, draft, check, find_emails, send_email, send_linkedin, slack."""
    import os
    from datetime import datetime, timezone
    from . import buyer_radar_comments as comments_src, buyer_radar_icp as icp_src, buyer_radar_jobs as jobs_src
    from . import buyer_radar_judge as judge, buyer_radar_send as send, buyer_radar_source as src
    from . import buyer_radar_store as store, contact_lab_search as cls
    from . import buyer_radar_unipile as uni
    deps = dict({"search": src.collect, "unipile_search": uni.collect, "judge": judge.judge_posts, "draft": judge.draft,
                 "check": judge.check, "jobs_search": jobs_src.collect, "job_locations": jobs_src.locations,
                 "comments": comments_src.collect, "people": jobs_src.decision_makers, "icp": icp_src.find,
                 "sequence": send.sequence_lead,
                 "find_emails": send.find_emails, "send_email": send.email_lead, "send_linkedin": send.linkedin_lead,
                 "slack": send.slack_leads}, **(deps or {}))
    who = started_by or ""
    cap = Decimal(str(settings["run_cap_usd"]))
    on = sources_on(settings) or ["posts"]
    summary = {"offers": list(settings["offers"]), "sources": on, "searched": 0, "posts": 0, "new_posts": 0, "read": 0,
               "kept": 0, "strong": 0, "drafted": 0, "emailed": 0, "messaged": 0, "sequenced": 0, "notes": [],
               "by_source": {}}

    def stage(name):
        store.update_run(run_id, stage=name, summary=summary)

    def spend(provider, op, usd=0, credits=0):
        store.add_spend(run_id, owner, who, provider, op, usd=usd, credits=credits)

    # 1. search: posts (Unipile or Apify) and job ads (Unipile), sharing the day's Unipile results
    stage("searching")
    source = settings.get("source") if settings.get("source") in SEARCH_SOURCES else "apify"
    summary["source"] = source
    has_unipile = bool(os.environ.get("UNIPILE_API_KEY"))
    token = os.environ.get("APIFY_API_TOKEN", "")
    want_posts, want_jobs, want_icp = "posts" in on, "jobs" in on, "icp" in on and bool(settings.get("icp_per_run"))
    missing = []
    for want, key, what in ((want_posts, "APIFY_API_TOKEN" if source == "apify" else "UNIPILE_API_KEY", "Posts were not searched"),
                            (want_jobs, "UNIPILE_API_KEY", "Job ads were not searched"),
                            (want_icp, "SALESHANDY_API_KEY", "Customer profiles were not searched")):
        if want and not os.environ.get(key):
            missing.append((key, what))
    if missing and len(missing) == sum((want_posts, want_jobs, want_icp)):
        raise RuntimeError("%s is not set on this service (Railway → web → Variables)." % missing[0][0])
    for key, what in missing:
        summary["notes"].append("%s: %s is not set on this service." % (what, key))
        want_posts = want_posts and not what.startswith("Posts")
        want_jobs = want_jobs and not what.startswith("Job")
        want_icp = want_icp and not what.startswith("Customer")
    # Claude reads one test post first: a run it cannot read would pay for the search and keep nothing.
    check_budget = cls.Budget(Decimal("0.05"))
    try:
        problem = deps["check"]({o: OFFERS[o] for o in settings["offers"]}, budget=check_budget, model=MODEL)
    finally:
        _book_claude(check_budget, spend, "check")
    if problem:
        raise RuntimeError("Claude could not read posts, so LinkedIn was not searched and nothing was charged "
                           "for posts: %s" % problem)
    queries, offer_of = [], {}
    if want_posts:
        for offer in settings["offers"]:
            for q in queries_for(settings, offer):
                queries.append(q)
                offer_of.setdefault(q, offer)
    titles = [q for o in settings["offers"] for q in job_queries_for(settings, o)] if want_jobs else []
    places = list(settings.get("job_locations") or [])
    summary["searched"] = len(queries)
    room = {"posts": 0, "jobs": 0}
    if (want_posts and source == "unipile") or want_jobs:
        left = uni.day_max() - store.unipile_results_today()
        if left <= 0:
            raise RuntimeError("Today's Unipile limit of %d LinkedIn search results is reached, across every "
                               "workspace. Search with Apify, or again tomorrow." % uni.day_max())
        room = split_room(left, {"posts": len(queries) * int(settings["per_query"]) if want_posts and source == "unipile" else 0,
                                 "jobs": len(titles) * max(1, len(places)) * int(settings["jobs_per_query"])})
    summary["unipile_results"] = 0
    apify_usd, posts = 0.0, []
    if want_posts and source == "unipile":
        got = deps["unipile_search"](queries, posted=settings["posted"], per_query=settings["per_query"], room=room["posts"])
        summary["unipile_results"] += int(got.get("results") or 0)
        summary["notes"].extend(got.get("notes") or [])
    elif want_posts:
        apify_cap = float(cap) * 0.8
        got = deps["search"](queries, token, posted=settings["posted"], per_query=settings["per_query"],
                             max_charge_usd=apify_cap)
        apify_usd = float(got.get("usd") or 0)
        if not got.get("usd") and got.get("posts"):
            apify_usd = len(got["posts"]) * src.USD_PER_POST      # not reported: counted at the list price
    else:
        got = {"posts": []}
    if apify_usd:
        spend("apify", "post-search", usd=apify_usd)
    if got.get("error") and not got.get("posts") and not want_jobs:
        raise RuntimeError("The LinkedIn search did not run: %s" % got["error"])
    if got.get("error"):
        summary["notes"].append(("The post search stopped early (%s); what it found is used." if got.get("posts") else
                                 "The post search did not run (%s).") % got["error"][:120])
    posts = got.get("posts") or []
    for p in posts:
        p["offer_hint"] = offer_of.get(p.get("query")) or ""
    signals = []
    if want_jobs:
        ids = []
        if places:
            ids, notes = deps["job_locations"](places)
            summary["notes"].extend(notes)
        if places and not ids:
            summary["notes"].append("Job ads were not searched: none of the job locations was recognised.")
        else:
            jg = deps["jobs_search"](titles, days=settings["jobs_days"], per_query=settings["jobs_per_query"],
                                     room=room["jobs"], location_ids=ids or None)
            summary["unipile_results"] += int(jg.get("results") or 0)
            summary["job_ads"] = len(jg.get("jobs") or [])
            summary["notes"].extend(jg.get("notes") or [])
            if jg.get("error"):
                summary["notes"].append("The job search %s (%s)." % (
                    "stopped early" if jg.get("jobs") else "did not run", jg["error"][:120]))
            signals = jobs_src.by_company(jg.get("jobs") or [], datetime.now(timezone.utc).strftime("%Y-%m"))
    if not posts and not signals and got.get("error") and not want_icp:
        raise RuntimeError("The LinkedIn search did not run: %s" % got["error"])
    summary["posts"] = len(posts)
    summary["companies"] = len(signals)
    known = store.known_posts(owner, [p["key"] for p in posts + signals])
    posts = [p for p in posts if p["key"] not in known]
    signals = [p for p in signals if p["key"] not in known]
    summary["new_posts"] = len(posts)

    # 2. read: Claude says who is buying, and what
    stage("reading")
    budget = cls.Budget(max(Decimal("0.05"), cap - Decimal(str(apify_usd))))
    offers = {o: OFFERS[o] for o in settings["offers"]}
    stopped = False

    def read(items, **kw):
        nonlocal stopped
        if not items or stopped:
            return {}
        try:
            got = deps["judge"](items, offers, budget=budget, model=MODEL, **kw)
        except cls.BudgetExceeded as e:
            got = getattr(e, "partial", {})
            stopped = True
            summary["notes"].append("Stopped reading at the run's cost cap: %s" % e)
        store.mark_seen(owner, list(got))
        return got

    def kept(items, verdicts, source):
        out = []
        for p in items:
            v = verdicts.get(p["key"])
            if not v or v.get("offer") not in offers or v.get("score", 0) < settings["keep_score"]:
                continue
            out.append({"post": p, "verdict": v, "offer": v["offer"], "score": int(v["score"]), "source": source,
                        "emails": emails_in(p["text"]) if source != "jobs" else [], "person": p["author"].get("key") or ""})
        return out

    try:
        verdicts = read(posts)
    finally:
        _book_claude(budget, spend, "read")
    summary["read"] = len(verdicts)
    errors = getattr(verdicts, "errors", [])
    if posts and not verdicts and errors and not signals:
        raise RuntimeError("Claude could not read any of the %d posts, so no leads were kept: %s" % (len(posts), errors[0]))
    if len(verdicts) < len(posts) and not stopped:
        summary["notes"].append("Claude could not read %d of the %d posts%s." % (
            len(posts) - len(verdicts), len(posts), (" (%s)" % errors[0]) if errors else ""))
    leads = kept(posts, verdicts, "post")
    taken = {lead["post"]["key"] for lead in leads}
    misses = sorted((p for p in posts if p["key"] in verdicts and p["key"] not in taken),
                    key=lambda p: -verdicts[p["key"]].get("score", 0))[:3]
    summary["closest"] = [{"url": p["url"], "score": verdicts[p["key"]].get("score", 0),
                           "role": verdicts[p["key"]].get("role"), "reason": verdicts[p["key"]].get("reason", "")[:200]}
                          for p in misses]
    if want_posts:
        summary["by_source"]["post"] = len(leads)

    if signals:
        spent_before = budget.spent
        try:
            jv = read(signals, system=judge.JOB_SYSTEM, text_of=judge.job_text)
        finally:
            _book_claude(budget, spend, "read-jobs", since=spent_before)
        summary["read"] += len(jv)
        job_leads = kept(signals, jv, "jobs")
        summary["by_source"]["jobs"] = len(job_leads)
        leads += job_leads

    # 3. the comments under the best posts kept: people saying they need it too
    if "comments" in on and has_unipile and settings["comment_posts"] and not stopped:
        best = sorted((x for x in leads if x["source"] == "post"), key=lambda x: -x["score"])[:settings["comment_posts"]]
        if best:
            stage("reading comments")
            cg = deps["comments"](best)
            summary["notes"].extend(cg.get("notes") or [])
            if cg.get("error"):
                summary["notes"].append("Reading comments stopped (%s)." % cg["error"][:120])
            found = cg.get("comments") or []
            seen_c = store.known_posts(owner, [c["key"] for c in found])
            found = [c for c in found if c["key"] not in seen_c]
            summary["comments"] = len(found)
            spent_before = budget.spent
            try:
                cv = read(found, system=judge.COMMENT_SYSTEM, text_of=judge.comment_text)
            finally:
                _book_claude(budget, spend, "read-comments", since=spent_before)
            summary["read"] += len(cv)
            comment_leads = kept(found, cv, "comment")
            summary["by_source"]["comment"] = len(comment_leads)
            leads += comment_leads

    # 4. people who fit a customer profile at a moment that matters: Saleshandy's search, free
    pairs = [(o, x) for o in settings["offers"] for x in icp_src.icps_for(settings, o) if x.get("on", True)] if want_icp else []
    if pairs:
        stage("finding people")
        per = -(-int(settings["icp_per_run"]) // len(pairs))
        found, notes = deps["icp"](pairs, per_icp=per, known=lambda keys: store.known_posts(owner, keys))
        summary["notes"].extend(notes)
        met = store.known_posts(owner, [f[2]["key"] for f in found])
        taken, icp_leads = {}, []
        for offer, x, sig, sc in found:
            if sig["key"] in met or taken.get(x["name"], 0) >= per:
                continue
            taken[x["name"]] = taken.get(x["name"], 0) + 1
            if sc < settings["keep_score"]:
                continue
            why = sig["icp"]["why"]
            icp_leads.append({"post": sig, "offer": offer, "score": sc, "source": "icp", "emails": [], "person": sig["author"]["key"],
                              "verdict": {"role": "buyer", "offer": offer, "intent": "fits_profile", "score": sc,
                                          "intent_label": judge.INTENT_LABELS["fits_profile"],
                                          "need": (why[:1].upper() + why[1:]) if why else "Fits “%s”" % x["name"],
                                          "company": sig["company"]["name"], "region": sig["contacts"][0]["location"],
                                          "deadline": "", "reason": sig["text"]}})
        store.mark_seen(owner, [f[2]["key"] for f in found if f[2]["key"] not in met])
        icp_leads = sorted(icp_leads, key=lambda x: -x["score"])[:int(settings["icp_per_run"])]
        summary["people"] = len(icp_leads)
        summary["by_source"]["icp"] = len(icp_leads)
        leads += icp_leads

    leads.sort(key=lambda lead: -lead["score"])
    summary["kept"] = len(leads)
    summary["strong"] = sum(1 for lead in leads if lead["score"] >= settings["alert_score"])

    # 5. who to write to at each company hiring: Saleshandy's people search, free
    if any(lead["source"] == "jobs" for lead in leads):
        stage("finding decision makers")
        note = deps["people"](leads, offers)
        if note:
            summary["notes"].append(note)

    # 6. draft: an email and a LinkedIn note for every lead, best first, until the cap
    stage("drafting")
    spent_before = budget.spent
    for lead in leads:
        try:
            lead["draft"] = deps["draft"](lead, OFFERS[lead["offer"]], settings["senders"].get(lead["offer"]) or {},
                                          budget=budget, model=MODEL)
            summary["drafted"] += 1
        except cls.BudgetExceeded as e:
            summary["notes"].append("Stopped writing messages at the run's cost cap: %s" % e)
            break
        except Exception as e:
            lead["draft_error"] = judge.why(e)
    _book_claude(budget, spend, "draft", since=spent_before)
    failed = [lead["draft_error"] for lead in leads if lead.get("draft_error")]
    if failed:
        summary["notes"].append("Claude could not write messages for %d of the %d leads (%s)." % (
            len(failed), len(leads), failed[0]))
    saved = store.add_leads(owner, run_id, leads)
    for lead, lead_id in zip(leads, saved):
        lead["id"] = lead_id
    leads = [lead for lead in leads if lead.get("id")]

    # 7. send, where the workspace switched it on: to the offer's Saleshandy sequence, or one email
    sendable = [lead for lead in leads if lead["score"] >= settings["send_score"] and lead.get("draft")]
    in_sequence = {o for o, sq in (settings.get("sequences") or {}).items() if sq.get("step_id")} \
        if settings.get("auto_sequence") else set()
    if in_sequence and sendable:
        stage("adding to Saleshandy")
        for lead in sendable:
            if lead["offer"] in in_sequence:
                res = deps["sequence"](owner, store.get_lead(lead["id"], owner), settings, by="", auto=True)
                summary["sequenced"] += 1 if res.get("ok") else 0
                if res.get("stop"):
                    summary["notes"].append("Adding to Saleshandy stopped: %s" % res["detail"])
                    break
    sendable_email = [lead for lead in sendable if lead["offer"] not in in_sequence]
    if settings["auto_email"] and sendable_email:
        stage("sending emails")
        if settings["find_emails"]:
            need = [lead for lead in sendable_email if not lead["emails"] and lead["person"].startswith(("in/", "sh/"))]
            room_e = max(0, settings["daily_email_cap"] - store.sent_today(owner, "email"))
            if need and room_e:
                found, credits, note = deps["find_emails"](need[:room_e])
                if credits:
                    spend("saleshandy", "email-reveal", credits=credits)
                if note:
                    summary["notes"].append(note)
                for lead in need:
                    hit = found.get(lead["id"])
                    if not hit:
                        continue
                    hit = hit if isinstance(hit, dict) else {"email": hit}
                    lead["emails"] = [hit["email"]]
                    kw = {"email": hit["email"], "email_source": "saleshandy"}
                    if hit.get("linkedin") and lead["person"].startswith("sh/"):
                        lead["person"] = src.profile_key(hit["linkedin"]) or lead["person"]
                        kw["person"] = lead["person"]
                    store.update_lead(lead["id"], owner, **kw)
        for lead in sendable_email:
            if lead["emails"]:
                res = deps["send_email"](owner, store.get_lead(lead["id"], owner), settings, by="", auto=True)
                summary["emailed"] += 1 if res.get("ok") else 0
                if res.get("stop"):
                    summary["notes"].append("Emails stopped: %s" % res["detail"])
                    break
    if settings["auto_linkedin"] and sendable:
        stage("sending on LinkedIn")
        for lead in sendable:
            if lead["person"].startswith("in/"):
                res = deps["send_linkedin"](owner, store.get_lead(lead["id"], owner), settings, by="", auto=True)
                summary["messaged"] += 1 if res.get("ok") else 0
                if res.get("stop"):
                    summary["notes"].append("LinkedIn stopped: %s" % res["detail"])
                    break

    # 7. Slack: the strong leads
    strong = [lead for lead in leads if lead["score"] >= settings["alert_score"]]
    if settings["slack_channel"] and strong:
        stage("posting to Slack")
        ok, why = deps["slack"](settings["slack_channel"], owner, strong)
        summary["slack"] = "sent" if ok else why
    return summary


def _book_claude(budget, spend, op, since=Decimal(0)):
    usd = float(budget.spent - since)
    if usd > 0:
        spend("anthropic", op, usd=usd)
