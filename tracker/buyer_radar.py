"""Buyer Radar: LinkedIn posts from people asking for what we sell, in one place, with a message ready.

Each run searches LinkedIn posts for every offer switched on (CallVibe's call analytics and Markify's
marketing services), has Claude read each post and say whether its author is looking to buy, writes an
email and a LinkedIn note for each lead, and, where the workspace has switched it on, sends them and posts
the strong leads to Slack. docs/buyer-radar-plan.md.

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
        "queries": [
            '"looking for a call recording" OR "recommend a call recording" OR "call recording software recommendations"',
            '"looking for a conversation intelligence" OR "recommend a conversation intelligence" OR '
            '"conversation intelligence recommendations"',
            '"alternative to Gong" OR "Gong alternative" OR "alternatives to Gong" OR "cheaper than Gong"',
            '("call QA tool" OR "call auditing tool" OR "call monitoring software") AND (recommend OR "looking for")',
            '"looking for a speech analytics" OR "recommend a speech analytics" OR "speech analytics vendor"',
            '"any recommendations for" AND ("call recording" OR "call analytics" OR "sales call")',
            '"anyone using" AND (Gong OR Chorus OR "call analytics" OR "conversation intelligence")',
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
        ],
    },
}

# == settings =============================================================================================
DEFAULTS = {
    "offers": ["callvibe", "markify"],
    "queries": {},                    # offer -> its own searches, in place of OFFERS[offer]["queries"]
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
          "daily_email_cap": (0, 100), "daily_linkedin_cap": (0, 80)}
USD_LIMITS = {"run_cap_usd": (0.1, 20.0), "monthly_cap_usd": (1.0, 500.0)}
MAX_QUERIES = 12
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


def queries_for(settings, offer):
    own = (settings.get("queries") or {}).get(offer)
    return list(own) if own else list(OFFERS[offer]["queries"])


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
    for k in ("daily", "auto_email", "auto_linkedin", "find_emails"):
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
JUDGE_MAX_TOKENS = 2400
DRAFT_MAX_TOKENS = 900


def estimate(settings):
    """The most one run can cost, and what it usually costs. Apify is the search, at its list price for
    every post the searches may return; Claude reads each post (in batches) and drafts for up to one in
    four. The run's cap (run_cap_usd) is what is enforced."""
    from . import buyer_radar_source as src, market_radar_costs as costs
    n_queries = sum(len(queries_for(settings, o)) for o in settings["offers"])
    posts = n_queries * int(settings["per_query"])
    apify = posts * src.USD_PER_POST
    batches = -(-posts // JUDGE_BATCH)
    judge = float(costs.worst_case_model_usd(MODEL, 900 * JUDGE_BATCH + 1500, JUDGE_MAX_TOKENS)) * batches
    drafts = float(costs.worst_case_model_usd(MODEL, 2500, DRAFT_MAX_TOKENS)) * max(1, posts // 4)
    worst = apify + judge + drafts
    return {"queries": n_queries, "posts": posts, "apify_usd": round(apify, 4), "claude_usd": round(judge + drafts, 4),
            "worst_usd": round(worst, 4), "typical_usd": round(apify * 0.6 + (judge + drafts) * 0.3, 4),
            "usd_cap": float(settings["run_cap_usd"]), "capped": worst > float(settings["run_cap_usd"]),
            "month_usd": round(min(worst, float(settings["run_cap_usd"])) * 30, 2)}


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
    what was found. deps replaces the outside world in tests: search, judge, draft, find_emails,
    send_email, send_linkedin, slack."""
    from . import buyer_radar_judge as judge, buyer_radar_send as send, buyer_radar_source as src
    from . import buyer_radar_store as store, contact_lab_search as cls
    deps = dict({"search": src.collect, "judge": judge.judge_posts, "draft": judge.draft,
                 "find_emails": send.find_emails, "send_email": send.email_lead, "send_linkedin": send.linkedin_lead,
                 "slack": send.slack_leads}, **(deps or {}))
    who = started_by or ""
    cap = Decimal(str(settings["run_cap_usd"]))
    summary = {"offers": list(settings["offers"]), "searched": 0, "posts": 0, "new_posts": 0, "read": 0,
               "kept": 0, "strong": 0, "drafted": 0, "emailed": 0, "messaged": 0, "notes": []}

    def stage(name):
        store.update_run(run_id, stage=name, summary=summary)

    def spend(provider, op, usd=0, credits=0):
        store.add_spend(run_id, owner, who, provider, op, usd=usd, credits=credits)

    # 1. search: one Apify run for every offer's searches, capped at what the run may spend
    stage("searching")
    import os
    token = os.environ.get("APIFY_API_TOKEN", "")
    if not token:
        raise RuntimeError("APIFY_API_TOKEN is not set on this service (Railway → web → Variables).")
    queries, offer_of = [], {}
    for offer in settings["offers"]:
        for q in queries_for(settings, offer):
            queries.append(q)
            offer_of.setdefault(q, offer)
    summary["searched"] = len(queries)
    apify_cap = float(cap) * 0.8
    got = deps["search"](queries, token, posted=settings["posted"], per_query=settings["per_query"],
                         max_charge_usd=apify_cap)
    apify_usd = float(got.get("usd") or 0)
    if not got.get("usd") and got.get("posts"):
        apify_usd = len(got["posts"]) * src.USD_PER_POST      # not reported: counted at the list price
    if apify_usd:
        spend("apify", "post-search", usd=apify_usd)
    if got.get("error") and not got.get("posts"):
        raise RuntimeError("The LinkedIn search did not run: %s" % got["error"])
    if got.get("error"):
        summary["notes"].append("The search stopped early (%s); what it found is used." % got["error"][:120])
    posts = got.get("posts") or []
    for p in posts:
        p["offer_hint"] = offer_of.get(p.get("query")) or ""
    summary["posts"] = len(posts)
    known = store.known_posts(owner, [p["key"] for p in posts])
    posts = [p for p in posts if p["key"] not in known]
    summary["new_posts"] = len(posts)

    # 2. read: Claude says who is buying, and what
    stage("reading")
    budget = cls.Budget(max(Decimal("0.05"), cap - Decimal(str(apify_usd))))
    offers = {o: OFFERS[o] for o in settings["offers"]}
    verdicts = {}
    try:
        verdicts = deps["judge"](posts, offers, budget=budget, model=MODEL)
    except cls.BudgetExceeded as e:
        verdicts = getattr(e, "partial", {})
        summary["notes"].append("Stopped reading at the run's cost cap: %s" % e)
    finally:
        _book_claude(budget, spend, "read")
    summary["read"] = len(verdicts)
    if len(verdicts) < len(posts) and not any("cost cap" in n for n in summary["notes"]):
        summary["notes"].append("Claude could not read %d of the %d posts." % (len(posts) - len(verdicts), len(posts)))
    leads = []
    for p in posts:
        v = verdicts.get(p["key"])
        if not v or v.get("offer") not in offers or v.get("score", 0) < settings["keep_score"]:
            continue
        leads.append({"post": p, "verdict": v, "offer": v["offer"], "score": int(v["score"]),
                      "emails": emails_in(p["text"]), "person": p["author"].get("key") or ""})
    leads.sort(key=lambda lead: -lead["score"])
    kept = {lead["post"]["key"] for lead in leads}
    misses = sorted((p for p in posts if p["key"] in verdicts and p["key"] not in kept),
                    key=lambda p: -verdicts[p["key"]].get("score", 0))[:3]
    summary["closest"] = [{"url": p["url"], "score": verdicts[p["key"]].get("score", 0),
                           "role": verdicts[p["key"]].get("role"), "reason": verdicts[p["key"]].get("reason", "")[:200]}
                          for p in misses]
    summary["kept"] = len(leads)
    summary["strong"] = sum(1 for lead in leads if lead["score"] >= settings["alert_score"])

    # 3. draft: an email and a LinkedIn note for every lead, best first, until the cap
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
            lead["draft_error"] = "%s: %s" % (type(e).__name__, str(e)[:160])
    _book_claude(budget, spend, "draft", since=spent_before)
    saved = store.add_leads(owner, run_id, leads)
    for lead, lead_id in zip(leads, saved):
        lead["id"] = lead_id
    leads = [lead for lead in leads if lead.get("id")]

    # 4. send, where the workspace switched it on
    sendable = [lead for lead in leads if lead["score"] >= settings["send_score"] and lead.get("draft")]
    if settings["auto_email"] and sendable:
        stage("sending emails")
        if settings["find_emails"]:
            need = [lead for lead in sendable if not lead["emails"] and lead["person"].startswith("in/")]
            room = max(0, settings["daily_email_cap"] - store.sent_today(owner, "email"))
            if need and room:
                found, credits, note = deps["find_emails"](need[:room])
                if credits:
                    spend("saleshandy", "email-reveal", credits=credits)
                if note:
                    summary["notes"].append(note)
                for lead in need:
                    if found.get(lead["id"]):
                        lead["emails"] = [found[lead["id"]]]
                        store.update_lead(lead["id"], owner, email=found[lead["id"]], email_source="saleshandy")
        for lead in sendable:
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

    # 5. Slack: the strong leads
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
