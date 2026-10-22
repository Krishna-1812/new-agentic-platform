"""Buyer Radar: people and companies showing they need what we sell, in one place, with a message ready.

Each run looks for every offer switched on (CallVibe's call analytics and Markify's marketing services)
in these places, each switched on in Settings ("sources"):

    posts      LinkedIn posts asking for it (Unipile or Apify)
    comments   people in the comments of those posts saying they need it too (Unipile)
    jobs       companies whose LinkedIn job ads are the offer's work (Unipile), with who decides there
               found by Saleshandy's free people search
    icp        people who fit an offer's customer profile at a moment that matters (new in role, funded,
               hiring, using a rival), from Saleshandy's lead database (tracker/buyer_radar_icp.py)
    rfps       requests for proposals and tenders on the open web, found by Claude's web search every
               rfp_days days (tracker/buyer_radar_rfp.py)
    reddit     Reddit threads asking for it, answered in the thread (tracker/buyer_radar_reddit.py)

A company found in two places (its job ads and a customer profile, an RFP and a post), in this run or
the last 60 days, scores higher and says so (multi_signal).

Claude reads each one and says whether it is a buyer, a message is written for each lead, and, where
the workspace has switched it on, they are sent and the strong leads posted to Slack.
docs/buyer-radar-plan.md.

    OFFERS                         what each offer sells and the searches that find its buyers
    clean_settings(body, current)  a workspace's settings, checked
    estimate(settings)             the most a run can cost
    run(run_id, owner, settings)   one run, start to end (tracker/buyer_radar_store.start_run spawns it)

What it spends, every cent recorded in br_spend with who ran it and the workspace (admin panel):
Apify for the search (about $2 per 1,000 posts), Claude Haiku to read and to write, Claude's web search
for RFPs ($10 per 1,000 searches plus the reading), and, only where "find emails" is on, one Saleshandy
credit per email found.
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
LEAD_SOURCES = {"posts": "LinkedIn posts", "comments": "Their comments", "jobs": "Job ads", "icp": "Customer profiles",
                "rfps": "RFPs and tenders", "reddit": "Reddit"}

DEFAULTS = {
    "source": "unipile",              # who runs the search: Unipile (free per post, as our LinkedIn account) or Apify
    "sources": ["posts", "comments", "jobs", "icp", "rfps", "reddit"],   # where leads come from (LEAD_SOURCES)
    "offers": ["callvibe", "markify"],
    "queries": {},                    # offer -> its own searches, in place of OFFERS[offer]["queries"]
    "job_queries": {},                # offer -> its own job titles, in place of OFFERS[offer]["jobs"]
    "job_locations": [],              # places the job ads are in ("India", "London"); none is anywhere
    "jobs_days": 14,                  # job ads posted in the last this many days
    "jobs_per_query": 20,             # job ads per title
    "comment_posts": 10,              # the best posts kept whose comments are read
    "icps": {},                       # offer -> its customer profiles, in place of buyer_radar_icp.DEFAULT_ICPS
    "icp_per_run": 30,                # the most people the customer profiles add to a run, all profiles together
    "daily_leads": 30,                # new leads a run aims for: the profiles fill what the other places leave
    "rfp_queries": {},                # offer -> its own RFP searches, in place of buyer_radar_rfp.OFFER_QUERIES
    "rfp_days": 7,                    # the RFP search runs once in this many days, not every run
    "reddit_queries": {},             # offer -> its own Reddit searches, in place of buyer_radar_reddit.OFFER_QUERIES
    "reddit_per_query": 25,           # Reddit threads per search, the last month's, newest first
    "sequences": {},                  # offer -> the Saleshandy sequence its leads go to {"id", "step_id", "title"}
    "sequence_field": "",             # a Saleshandy prospect field that carries the message written, if any
    "auto_sequence": False,           # strong leads go to the offer's sequence, in place of one email
    "posted": "3months",              # how far back each search looks; a post already kept is not read again
    "per_query": 25,                  # posts per search
    "keep_score": 50,                 # a post scored below this is not kept as a lead
    "alert_score": 70,                # Slack and the "strong" filter
    "daily": False,                   # the once-a-day run (.github/workflows/buyer-radar-daily.yml)
    "daily_hour": 9,                  # India time: the daily run's Slack message goes out at this hour
    "sheet_id": "",                   # a Google Sheet every lead goes to, one detailed row each (buyer_radar_sheet)
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
          "jobs_per_query": (5, 100), "comment_posts": (0, 30), "icp_per_run": (0, 100), "rfp_days": (1, 30),
          "reddit_per_query": (5, 100), "daily_hour": (0, 23), "daily_leads": (0, 100)}
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
    if "rfps" in on:                  # Claude's web search: ANTHROPIC_API_KEY, which every run needs
        return None
    if "reddit" in on and reddit_ready():
        return None
    return (post_key if "posts" in on else "UNIPILE_API_KEY" if "jobs" in on else "SALESHANDY_API_KEY" if "icp" in on
            else "REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET")


def posts_ready(settings):
    """Is the LinkedIn post search this workspace chose (Unipile or Apify) set up on the service?"""
    import os
    return bool(os.environ.get("UNIPILE_API_KEY" if settings.get("source") == "unipile" else "APIFY_API_TOKEN"))


def reddit_ready():
    from . import sci_reddit_client as rc
    return rc.is_configured()


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


def _own_lists(body, key, defaults, most, what):
    """{offer: lines} for a setting of searches per offer, each checked; an offer whose lines are its
    defaults (or none) is left out, so it follows the defaults."""
    qs = body[key] if isinstance(body[key], dict) else {}
    clean = {}
    for offer, lines in qs.items():
        if offer not in OFFERS:
            continue
        lines = _lines(lines)
        if len(lines) > most:
            raise ValueError("%s: at most %d %s." % (OFFERS[offer]["label"], most, what))
        if any(len(q) > 200 for q in lines):
            raise ValueError("%s: a search is at most 200 characters." % OFFERS[offer]["label"])
        if lines and lines != list(defaults.get(offer, [])):
            clean[offer] = lines
    return clean


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
            raise ValueError("Pick at least one place to look.")
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
    if "rfp_queries" in body:
        from . import buyer_radar_rfp as rfp_mod
        out["rfp_queries"] = _own_lists(body, "rfp_queries", rfp_mod.OFFER_QUERIES, rfp_mod.MAX_QUERIES, "RFP searches")
    if "reddit_queries" in body:
        from . import buyer_radar_reddit as reddit_mod
        out["reddit_queries"] = _own_lists(body, "reddit_queries", reddit_mod.OFFER_QUERIES, reddit_mod.MAX_QUERIES,
                                           "Reddit searches")
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
    if "sheet_id" in body:
        from . import buyer_radar_sheet as sheet
        raw = str(body["sheet_id"] or "").strip()
        sid = sheet.sheet_id_of(raw)
        if raw and not sid:
            raise ValueError("The Google Sheet should be its link (https://docs.google.com/spreadsheets/d/...).")
        out["sheet_id"] = sid
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
    from . import buyer_radar_reddit as reddit_mod, buyer_radar_rfp as rfp_mod, buyer_radar_source as src
    from . import buyer_radar_unipile as uni, contact_lab_search as cls, market_radar_costs as costs
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
    rfp_searches = sum(len(rfp_mod.queries_for(settings, o)) for o in settings["offers"]) if "rfps" in on else 0
    rfps = rfp_searches * 8                       # at most 8 a search
    threads = (sum(len(reddit_mod.queries_for(settings, o)) for o in settings["offers"]) * int(settings.get("reddit_per_query") or 0)
               if "reddit" in on else 0)
    read = posts + jobs // 2 + comments + rfps + threads     # job ads are read a company at a time
    people = int(settings.get("icp_per_run") or 0) if "icp" in on else 0      # drafted, never read
    apify = 0.0 if unipile else posts * src.USD_PER_POST
    batches = -(-read // JUDGE_BATCH)
    judge = float(costs.worst_case_model_usd(MODEL, 900 * JUDGE_BATCH + 1500, JUDGE_MAX_TOKENS)) * batches
    drafts = float(costs.worst_case_model_usd(MODEL, 2500, DRAFT_MAX_TOKENS)) * max(1, read // 4 + people)
    web = float(costs.worst_case_model_usd(MODEL, cls.RESERVE_PROMPT_TOKENS, cls.CLAUDE_MAX_TOKENS, searches=1)) * rfp_searches
    worst = apify + judge + drafts + web
    return {"queries": n_queries, "posts": posts, "job_queries": n_jobs, "jobs": jobs, "comments": comments, "people": people,
            "rfp_searches": rfp_searches, "threads": threads, "web_usd": round(web, 4),
            "source": "unipile" if unipile else "apify",
            "apify_usd": round(apify, 4), "claude_usd": round(judge + drafts + web, 4),
            "worst_usd": round(worst, 4), "typical_usd": round(apify * 0.6 + (judge + drafts) * 0.3 + web * 0.5, 4),
            "usd_cap": float(settings["run_cap_usd"]), "capped": worst > float(settings["run_cap_usd"]),
            "month_usd": round(_month(worst, web, float(settings["run_cap_usd"]), settings.get("rfp_days")), 2)}


def _month(worst, web, cap, rfp_days):
    """A month of daily runs at most: each capped, the RFP search in one run every rfp_days days."""
    rfp_runs = 30 / max(1, int(rfp_days or 7)) if web else 0
    return min(worst, cap) * rfp_runs + min(worst - web, cap) * (30 - rfp_runs)


# == the export ===========================================================================================
SOURCE_LABELS = {"post": "LinkedIn post", "comment": "Comment on a post", "jobs": "Job ads", "icp": "Customer profile",
                 "rfp": "RFP or tender", "reddit": "Reddit thread"}
EXPORT_COLS = [("Found", "created_at"), ("Score", "score"), ("Offer", "offer"), ("Source", "source"), ("Status", "status"),
               ("Name", "name"), ("Headline", "headline"), ("Profile", "profile"), ("Email address", "email"),
               ("What they want", "need"), ("Intent", "intent"), ("Company", "company"), ("Region", "region"),
               ("Deadline", "deadline"), ("Why", "reason"), ("Posted", "posted_at"), ("Post", "url"),
               ("Post text", "text"), ("Also found in", "signals"), ("Contacted", "contacted")]
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
               "signals": ", ".join(SOURCE_LABELS.get(x, x) for x in v.get("signals") or [] if x != lead.get("source")),
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


# == one company, several signals ========================================================================
MULTI_DAYS = 60                    # leads this recent count toward a company's signals
MULTI_BOOST = 8                    # points a lead gains for each other place its company was found in
MULTI_BOOST_MAX = 16
GENERIC_COMPANIES = {"", "self employed", "self", "freelance", "freelancer", "stealth", "stealth startup",
                     "confidential", "independent", "consultant", "various", "na", "none", "unknown", "an organisation"}


def lead_company(lead):
    """The lead's company as Buyer Radar compares it (buyer_radar_jobs.company_norm), or ''."""
    from . import buyer_radar_jobs as jobs_src
    p, v = lead.get("post") or {}, lead.get("verdict") or {}
    name = v.get("company") or (p.get("company") or {}).get("name") or ""
    norm = jobs_src.company_norm(name)
    return "" if norm in GENERIC_COMPANIES or len(norm) < 3 else norm


def multi_signal(leads, recent=()):
    """A company found in two or more places (job ads and a customer profile, an RFP and a post), in this
    run or among `recent` (source, company) pairs from the last MULTI_DAYS days, is likelier to buy: each
    of its leads gains MULTI_BOOST points for every other place (at most MULTI_BOOST_MAX, never past 100)
    and its verdict lists them ("signals"). Returns how many leads gained."""
    from . import buyer_radar_jobs as jobs_src
    where = {}
    for lead in leads:
        c = lead_company(lead)
        if c:
            where.setdefault(c, set()).add(lead["source"])
    for source, name in recent:
        c = jobs_src.company_norm(name)
        if c in where:
            where[c].add(source)
    n = 0
    for lead in leads:
        places = where.get(lead_company(lead)) or set()
        if len(places) < 2:
            continue
        gain = min(MULTI_BOOST_MAX, MULTI_BOOST * (len(places) - 1))
        lead["score"] = min(100, int(lead["score"]) + gain)
        lead["verdict"] = dict(lead["verdict"], score=lead["score"], signals=sorted(places))
        n += 1
    return n


# == nobody twice ========================================================================================
# A post, comment, job ad, RFP or thread read once is never read again (br_seen), and the same one is never
# two leads (br_leads is unique by key). These go further: the same person, hiring company or RFP is never
# a new lead twice, however it was found again (another post by them, their company's job ads next month,
# the same RFP at another link). br_identities keeps them for every lead.

def _norm_words(v):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(v or "").lower())).strip()


def _lead_person_name(lead):
    p = lead.get("post") or {}
    if lead.get("source") == "jobs":         # the company's decision maker the lead is written to
        from . import buyer_radar_source as src
        person = lead.get("person") or ""
        for c in p.get("contacts") or []:
            if person and person in (c.get("key"), src.profile_key(c.get("linkedin"))):
                return c.get("name") or ""
        return ""
    a = p.get("author") or {}
    return "" if a.get("company") else (a.get("name") or "")


def identities(lead):
    """Who or what a lead is, each a string kept in br_identities:
        person:<key>            their LinkedIn profile, Saleshandy id, LinkedIn member id or Reddit name
        name:<name>|<company>   a person by name at their company (a LinkedIn author found again by Saleshandy)
        hiring:<company>        a company found by its job ads, once ever, not once a month
        rfp:<issuer>|<title>    an RFP, whatever link it was found at
    A company page's posts count as one author; "Self-employed" and the like are never a company."""
    p = lead.get("post") or {}
    source = lead.get("source") or "post"
    out = set()
    person = str(lead.get("person") or "").strip()
    if person and not (source == "jobs" and person.startswith("company/")):
        out.add("person:" + person)
    name, company = _norm_words(_lead_person_name(lead)), lead_company(lead)
    if name and company:
        out.add("name:%s|%s" % (name, company))
    if source == "jobs":
        from . import buyer_radar_jobs as jobs_src
        co = jobs_src.company_norm((p.get("company") or {}).get("name") or (p.get("author") or {}).get("name"))
        if co and co not in GENERIC_COMPANIES:
            out.add("hiring:" + co)
        key = (p.get("author") or {}).get("key") or ""
        if key.startswith("company/"):
            out.add("hiring:" + key)
    if source == "rfp":
        r = p.get("rfp") or {}
        issuer, title = _norm_words(r.get("issuer")), _norm_words(r.get("title"))
        if title:
            out.add("rfp:%s|%s" % (issuer, title))
    return out


def dedupe(leads, known=()):
    """The leads, best first, without any whose person, company or RFP is already a lead (`known`, from
    br_identities) or came earlier in this list. (kept, dropped)."""
    seen, kept, dropped = set(known), [], []
    for lead in sorted(leads, key=lambda x: -int(x.get("score") or 0)):
        ids = identities(lead)
        if ids & seen:
            dropped.append(lead)
            continue
        seen |= ids
        kept.append(lead)
    return kept, dropped


# == the daily schedule ===================================================================================
# .github/workflows/buyer-radar-daily.yml asks the site every hour. A workspace's daily run starts in the
# hour before its time (daily_hour, India time) and its Slack message waits for the time itself; a run
# that failed is tried once more that day; one that finished late posts as soon as it is done.
IST_OFFSET_MIN = 330
DAILY_LEAD_MIN = 60               # the run starts this long before the Slack time
DAILY_TRIES = 2


def ist_day_start(now):
    """Midnight India time on now's India date, as an aware UTC datetime."""
    from datetime import timedelta, timezone
    ist = now.astimezone(timezone(timedelta(minutes=IST_OFFSET_MIN)))
    return ist.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)


def daily_slot(settings, now):
    """(start from, Slack at) for today's daily run, as aware UTC datetimes."""
    from datetime import timedelta
    day = ist_day_start(now)
    at = day + timedelta(hours=int(settings.get("daily_hour", DEFAULTS["daily_hour"]) or 0))
    return max(day, at - timedelta(minutes=DAILY_LEAD_MIN)), at


def daily_due(settings, now, todays):
    """Should today's daily run start now? `todays` is this owner's daily runs since India midnight
    (buyer_radar_store.daily_runs_since). Not before its start time; not when one finished or is going;
    not after DAILY_TRIES failed (a stale "running" one, whose service restarted, counts as failed)."""
    start, _ = daily_slot(settings, now)
    if now < start:
        return False
    if any(r["status"] == "ready" or (r["status"] == "running" and not r.get("stale")) for r in todays):
        return False
    return sum(1 for r in todays if r["status"] == "failed" or r.get("stale")) < DAILY_TRIES


# == one run ==============================================================================================

def run(run_id, owner, settings, *, started_by=None, deps=None):
    """Search, read, keep, draft, then (if switched on) find emails, send and post to Slack. Every stage is
    saved as it ends, and the leads are saved before anything is sent, so a failure late in the run keeps
    what was found. deps replaces the outside world in tests: search, unipile_search, jobs_search,
    job_locations, comments, people, icp, rfps, reddit, judge, draft, check, find_emails, send_email,
    send_linkedin, sequence, slack."""
    import os
    from datetime import datetime, timezone
    from . import buyer_radar_comments as comments_src, buyer_radar_icp as icp_src, buyer_radar_jobs as jobs_src
    from . import buyer_radar_judge as judge, buyer_radar_reddit as reddit_src, buyer_radar_rfp as rfp_src
    from . import buyer_radar_send as send, buyer_radar_source as src
    from . import buyer_radar_store as store, contact_lab_search as cls
    from . import buyer_radar_unipile as uni
    from . import buyer_radar_sheet as sheet
    deps = dict({"search": src.collect, "unipile_search": uni.collect, "judge": judge.judge_posts, "draft": judge.draft,
                 "sheet": sheet.sync_run,
                 "check": judge.check, "jobs_search": jobs_src.collect, "job_locations": jobs_src.locations,
                 "comments": comments_src.collect, "people": jobs_src.decision_makers, "icp": icp_src.find,
                 "rfps": rfp_src.collect, "reddit": reddit_src.collect,
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
    want_rfps, want_reddit = "rfps" in on, "reddit" in on
    post_key = "APIFY_API_TOKEN" if source == "apify" else "UNIPILE_API_KEY"
    checks = {"posts": (want_posts, bool(os.environ.get(post_key)), post_key, "Posts were not searched"),
              "jobs": (want_jobs, has_unipile, "UNIPILE_API_KEY", "Job ads were not searched"),
              "icp": (want_icp, bool(os.environ.get("SALESHANDY_API_KEY")), "SALESHANDY_API_KEY",
                      "Customer profiles were not searched"),
              "reddit": (want_reddit, reddit_ready(), "REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET", "Reddit was not searched")}
    missing = [(k, key, what) for k, (want, ok, key, what) in checks.items() if want and not ok]
    if missing and len(missing) == sum(1 for w, *_ in checks.values() if w) and not want_rfps:
        raise RuntimeError("%s is not set on this service (Railway → web → Variables)." % missing[0][1])
    for k, key, what in missing:
        if k == "reddit":             # on by default, and the page says it is not set up: not a note every run
            continue
        summary["notes"].append("%s: %s %s not set on this service." % (what, key, "are" if " and " in key else "is"))
    gone = {k for k, _, _ in missing}
    want_posts, want_jobs = want_posts and "posts" not in gone, want_jobs and "jobs" not in gone
    want_icp, want_reddit = want_icp and "icp" not in gone, want_reddit and "reddit" not in gone
    store.backfill_identities(owner, identities)     # leads from before identities were kept count too
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
    if got.get("error") and not got.get("posts") and not (want_jobs or want_icp or want_rfps or want_reddit):
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
    if not posts and not signals and got.get("error") and not (want_icp or want_rfps or want_reddit):
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
            lead = {"post": p, "verdict": v, "offer": v["offer"], "score": int(v["score"]), "source": source,
                    "emails": emails_in(p["text"]) if source in ("post", "comment") else [],
                    "person": p["author"].get("key") or ""}
            if source == "rfp":
                r = p.get("rfp") or {}
                lead["emails"] = [r["contact_email"]] if r.get("contact_email") else []
                lead["email_source"] = "rfp"
                if r.get("due") and not v.get("deadline"):
                    lead["verdict"] = dict(v, deadline=r["due"])
            out.append(lead)
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

    # 4. Reddit threads asking for it: Reddit's own search, free
    if want_reddit and not stopped:
        stage("reading Reddit")
        rq = [q for o in settings["offers"] for q in reddit_src.queries_for(settings, o)]
        rg = deps["reddit"](rq, per_query=int(settings.get("reddit_per_query") or 25))
        summary["notes"].extend(rg.get("notes") or [])
        threads = rg.get("posts") or []
        seen_t = store.known_posts(owner, [t["key"] for t in threads])
        threads = [t for t in threads if t["key"] not in seen_t]
        summary["threads"] = len(threads)
        spent_before = budget.spent
        try:
            tv = read(threads, system=judge.REDDIT_SYSTEM, text_of=judge.reddit_text)
        finally:
            _book_claude(budget, spend, "read-reddit", since=spent_before)
        summary["read"] += len(tv)
        reddit_leads = kept(threads, tv, "reddit")
        summary["by_source"]["reddit"] = len(reddit_leads)
        leads += reddit_leads

    # 5. requests for proposals and tenders: Claude's web search, paid, so once in rfp_days days
    rfp_hours = int(settings.get("rfp_days") or 7) * 24 - 3     # a daily run a little early still counts as a day
    if want_rfps and not stopped and store.spent_within(owner, "rfp-search", rfp_hours):
        summary["notes"].append("RFPs were searched in the last %d days; the next search is due after that." % int(settings.get("rfp_days") or 7))
    elif want_rfps and not stopped:
        stage("searching for RFPs")
        rq = [q for o in settings["offers"] for q in rfp_src.queries_for(settings, o)]
        spent_before = budget.spent
        try:
            rg = deps["rfps"](rq, budget=budget, model=MODEL)
        except cls.BudgetExceeded as e:
            rg = getattr(e, "partial", None) or {"rfps": [], "notes": []}
            stopped = True
            summary["notes"].append("Stopped searching for RFPs at the run's cost cap: %s" % e)
        finally:
            _book_claude(budget, spend, "rfp-search", since=spent_before)
        summary["notes"].extend(rg.get("notes") or [])
        rfps = rg.get("rfps") or []
        summary["rfp_searches"] = int(rg.get("searches") or 0)
        seen_r = store.known_posts(owner, [r["key"] for r in rfps])
        rfps = [r for r in rfps if r["key"] not in seen_r]
        summary["rfps"] = len(rfps)
        spent_before = budget.spent
        try:
            rv = read(rfps, system=judge.RFP_SYSTEM, text_of=judge.rfp_text)
        finally:
            _book_claude(budget, spend, "read-rfps", since=spent_before)
        summary["read"] += len(rv)
        rfp_leads = kept(rfps, rv, "rfp")
        summary["by_source"]["rfp"] = len(rfp_leads)
        leads += rfp_leads

    # nobody twice: a person, hiring company or RFP already a lead is not a new one (identities)
    def fresh_only(items):
        idents = set().union(*(identities(x) for x in items)) if items else set()
        kept_, dropped_ = dedupe(items, store.known_identities(owner, idents))
        if dropped_:
            store.mark_seen(owner, [x["post"]["key"] for x in dropped_])
        summary["repeats"] = summary.get("repeats", 0) + len(dropped_)
        return kept_

    leads = fresh_only(leads)

    # 6. people who fit a customer profile at a moment that matters: Saleshandy's search, free. They fill
    # the run up to its daily_leads, whatever the other places found today, so every day brings about as
    # many new leads (icp_per_run at most)
    target = int(settings.get("daily_leads") or 0)
    want = min(int(settings["icp_per_run"]), max(0, target - len(leads))) if target else int(settings["icp_per_run"])
    summary["target"] = target
    pairs = [(o, x) for o in settings["offers"] for x in icp_src.icps_for(settings, o) if x.get("on", True)] if want_icp else []
    if pairs and want:
        stage("finding people")
        per = max(3, -(-want * 3 // (2 * len(pairs))))      # half again as many as needed: some are repeats
        found, notes = deps["icp"](pairs, per_icp=per, known=lambda keys: store.known_posts(owner, keys),
                                   cursor=(lambda key: store.get_cursor(owner, key),
                                           lambda key, page: store.set_cursor(owner, key, page)))
        summary["notes"].extend(notes)
        met = store.known_posts(owner, [f[2]["key"] for f in found])
        candidates, low = [], []
        for offer, x, sig, sc in found:
            if sig["key"] in met:
                continue
            if sc < settings["keep_score"]:
                low.append(sig["key"])
                continue
            why = sig["icp"]["why"]
            candidates.append({"post": sig, "offer": offer, "score": sc, "source": "icp", "emails": [], "person": sig["author"]["key"],
                               "verdict": {"role": "buyer", "offer": offer, "intent": "fits_profile", "score": sc,
                                           "intent_label": judge.INTENT_LABELS["fits_profile"],
                                           "need": (why[:1].upper() + why[1:]) if why else "Fits “%s”" % x["name"],
                                           "company": sig["company"]["name"], "region": sig["contacts"][0]["location"],
                                           "deadline": "", "reason": sig["text"]}})
        store.mark_seen(owner, low)
        # against the workspace's leads and this run's own: a person already found today is not found again
        mine = set().union(*(identities(x) for x in leads)) if leads else set()
        idents = set().union(*(identities(x) for x in candidates)) if candidates else set()
        icp_leads, dropped = dedupe(candidates, store.known_identities(owner, idents) | mine)
        store.mark_seen(owner, [x["post"]["key"] for x in dropped])
        summary["repeats"] = summary.get("repeats", 0) + len(dropped)
        icp_leads = icp_leads[:want]           # the rest stay unread, for another day
        summary["people"] = len(icp_leads)
        summary["by_source"]["icp"] = len(icp_leads)
        leads += icp_leads
        if target and len(leads) < target:
            summary["notes"].append("%d new leads, under the %d aimed for: the customer profiles found %d new people "
                                    "who fit. Widen them in Settings (more titles, places or industries)."
                                    % (len(leads), target, len(icp_leads)))

    # one company in two places scores higher: this run's leads, and the workspace's of the last 60 days
    if leads:
        summary["multi"] = multi_signal(leads, store.recent_companies(owner, MULTI_DAYS))
    leads.sort(key=lambda lead: -lead["score"])

    # 7. who to write to at each company hiring: Saleshandy's people search, free
    if any(lead["source"] == "jobs" for lead in leads):
        stage("finding decision makers")
        note = deps["people"](leads, offers)
        if note:
            summary["notes"].append(note)
        leads = fresh_only(leads)              # a decision maker who is already a lead is not written to again
    summary["kept"] = len(leads)
    summary["strong"] = sum(1 for lead in leads if lead["score"] >= settings["alert_score"])

    # 8. draft: an email and a LinkedIn note for every lead, best first, until the cap
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
    store.add_identities(owner, [(lead["id"], identities(lead) | {"lead:%d" % lead["id"]}) for lead in leads])
    summary["new"] = len(leads)

    # 9. send, where the workspace switched it on: to the offer's Saleshandy sequence, or one email. An RFP
    # is answered by the team, and a Reddit thread in the thread, so neither is ever sent automatically.
    sendable = [lead for lead in leads if lead["score"] >= settings["send_score"] and lead.get("draft")
                and lead["source"] not in ("rfp", "reddit")]
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

    # 10. the Google Sheet: a row for each new lead, and the changed ones brought up to date
    if settings.get("sheet_id"):
        stage("updating the Google Sheet")
        summary["sheet"] = deps["sheet"](owner, settings, run_id=run_id, summary=summary)

    # 11. Slack: the strong leads. The daily run's message waits for the workspace's hour (deliver_at),
    # and the hourly call posts it then (deliver_waiting); a manual run's goes now.
    strong = [lead for lead in leads if lead["score"] >= settings["alert_score"]]
    daily = bool(settings.get("deliver_at"))
    if settings["slack_channel"] and (strong or daily):
        if daily and datetime.now(timezone.utc) < datetime.fromisoformat(settings["deliver_at"]):
            summary["slack"], summary["slack_at"] = "waiting", settings["deliver_at"]
        else:
            stage("posting to Slack")
            ok, why = deps["slack"](settings["slack_channel"], owner, strong, **slack_extra(settings, summary, daily))
            summary["slack"] = "sent" if ok else why
    return summary


def slack_extra(settings, summary, daily):
    """What a Slack message adds to its strong leads: the run's count of new leads, whether it is the
    daily one (which posts even with none strong), and the Google Sheet's link."""
    from . import buyer_radar_sheet as sheet
    return {"total": int(summary.get("new") or 0), "daily": daily,
            "sheet_url": sheet.sheet_url(settings.get("sheet_id")) if settings.get("sheet_id") else ""}


def deliver_waiting(*, now=None, store=None, post=None):
    """Posts every daily run's Slack message whose hour has come (the hourly call, app.py). Each is
    claimed first, so two calls never post it twice. How many were posted."""
    from datetime import datetime, timezone
    from . import buyer_radar_send as send, buyer_radar_store
    store = store or buyer_radar_store
    post = post or send.slack_leads
    now = now or datetime.now(timezone.utc)
    n = 0
    for run_id, owner, summary in store.slack_waiting():
        try:
            at = datetime.fromisoformat(summary.get("slack_at") or "")
        except ValueError:
            at = now
        if at > now or not store.claim_slack(run_id):
            continue
        settings = store.get_settings(owner)
        result = "not_configured"
        if settings.get("slack_channel"):
            strong = store.run_leads(owner, run_id, settings["alert_score"])
            try:
                ok, why = post(settings["slack_channel"], owner, strong, **slack_extra(settings, summary, True))
            except Exception as e:             # never leave it "sending": say why
                ok, why = False, type(e).__name__
            result = "sent" if ok else why
            n += 1 if ok else 0
        store.set_run_summary_key(run_id, "slack", result)
    return n


def _book_claude(budget, spend, op, since=Decimal(0)):
    usd = float(budget.spent - since)
    if usd > 0:
        spend("anthropic", op, usd=usd)
