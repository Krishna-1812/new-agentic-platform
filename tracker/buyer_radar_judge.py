"""Buyer Radar: Claude reads each post and says whether its author wants to buy, then writes to them.

    judge_posts(posts, offers, budget=, model=) -> {post key: verdict}
    draft(lead, offer, sender, budget=, model=) -> {"subject", "email", "note", "message"}

Both are structured-output calls through contact_lab._json_call, so every call is checked against the
run's cap before it is made and booked at its measured cost. Most posts that match a search are not
buyers: vendors promoting their own call analytics, people looking for a job, agencies selling. The
judge is told to score those 0, and only a person asking, in their own words, for a product, a vendor,
an agency or recommendations scores high.
"""
from __future__ import annotations

import copy
import logging
import re

from . import buyer_radar as br

log = logging.getLogger(__name__)

INTENTS = ("seeking_vendor", "asking_recommendations", "hiring_for_it", "pain_point", "none")
INTENT_LABELS = {"seeking_vendor": "Looking for a vendor", "asking_recommendations": "Asking for recommendations",
                 "hiring_for_it": "Hiring for it", "pain_point": "Has the problem", "none": "Not buying"}
ROLES = ("buyer", "seller", "job_seeker", "other")

JUDGE_SYSTEM = (
    "You find buyers on LinkedIn for a sales team. You are given what each of the team's offers sells and "
    "who buys it, then numbered LinkedIn posts. For each post decide, from the post alone:\n"
    "- role: 'buyer' when the author (or their company) wants to get something; 'seller' when they are "
    "promoting their own product, service, agency or content (most posts that mention call analytics or "
    "marketing are sellers); 'job_seeker' when they want a job; else 'other'.\n"
    "- offer: which offer's key fits what they want, or 'none'.\n"
    "- intent: 'seeking_vendor' (they want a product, vendor, agency, freelancer or an RFP response); "
    "'asking_recommendations' (they ask what to use or who to hire); 'hiring_for_it' (they are hiring "
    "people for work the offer could do instead); 'pain_point' (they describe the problem but ask for "
    "nothing); 'none'.\n"
    "- score 0 to 100, how likely a short message from this offer is welcome now: a clear request for "
    "exactly what the offer sells, with a scope, budget or deadline, 85 to 100; asking for recommendations "
    "in the offer's area 70 to 90; hiring for the function 40 to 65; a pain point 30 to 60. Any seller, "
    "job seeker or 'none' offer scores 0 to 10. Older than a month, or the need is already met, lower it.\n"
    "- need: what they want, in one short sentence in plain English.\n"
    "- company: the author's company if the post or headline names it, else ''.\n"
    "- region: the country or city if stated, else ''.\n"
    "- deadline: any date or timing they give, else ''.\n"
    "- reason: why, in one sentence, quoting a few words of the post.\n"
    "Never invent facts that are not in the post or headline. Use the post numbers given.")

JUDGE_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["verdicts"],
                "properties": {"verdicts": {"type": "array", "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["n", "role", "offer", "intent", "score", "need", "company", "region", "deadline",
                                 "reason"],
                    "properties": {"n": {"type": "integer"}, "role": {"type": "string", "enum": list(ROLES)},
                                   "offer": {"type": "string"}, "intent": {"type": "string", "enum": list(INTENTS)},
                                   "score": {"type": "integer"}, "need": {"type": "string"},
                                   "company": {"type": "string"}, "region": {"type": "string"},
                                   "deadline": {"type": "string"}, "reason": {"type": "string"}}}}}}


def judge_schema(offers):
    """JUDGE_SCHEMA with the offer held to the run's offer keys or 'none', so a verdict naming the offer
    some other way ("Markify Digital") is not dropped."""
    schema = copy.deepcopy(JUDGE_SCHEMA)
    schema["properties"]["verdicts"]["items"]["properties"]["offer"] = {"type": "string",
                                                                        "enum": list(offers) + ["none"]}
    return schema


def _offer_key(v, offers):
    got = str(v.get("offer") or "").strip()
    for k, o in offers.items():
        if got.lower() in (k, str(o.get("label") or "").lower()):
            return k
    return "none"


def _offers_text(offers):
    return "\n".join("OFFER %s: %s\nWHO BUYS IT: %s" % (k, o["sells"], o["buyers"]) for k, o in offers.items())


def _post_text(n, p):
    a = p.get("author") or {}
    return "POST %d (posted %s)\nAUTHOR: %s, %s%s\nTEXT: %s" % (
        n, p.get("posted_at") or "date unknown", a.get("name") or "unknown", a.get("headline") or "no headline",
        " (a company page)" if a.get("company") else "", re.sub(r"\s+", " ", p.get("text") or "")[:2500])


def clean_verdict(v, offers):
    """A verdict the code can trust: a known offer and intent, a score held to 0..100, and a seller or job
    seeker never kept as a lead whatever score the model gave."""
    offer = _offer_key(v, offers)
    intent = v.get("intent") if v.get("intent") in INTENTS else "none"
    role = v.get("role") if v.get("role") in ROLES else "other"
    try:
        score = max(0, min(100, int(v.get("score") or 0)))
    except (TypeError, ValueError):
        score = 0
    if role in ("seller", "job_seeker") or offer == "none" or intent == "none":
        score = min(score, 10)
    out = {k: str(v.get(k) or "")[:300] for k in ("need", "company", "region", "deadline", "reason")}
    out.update(role=role, offer=offer, intent=intent, score=score, intent_label=INTENT_LABELS[intent])
    return out


def judge_posts(posts, offers, *, budget, model=br.MODEL, call=None):
    """Every post, in batches of buyer_radar.JUDGE_BATCH. A batch that would pass the run's cap raises
    BudgetExceeded, carrying the verdicts read so far as .partial, so the caller keeps them."""
    from . import contact_lab as lab
    call = call or lab._json_call
    out = {}
    offers_text = _offers_text(offers)
    schema = judge_schema(offers)
    for start in range(0, len(posts), br.JUDGE_BATCH):
        batch = posts[start:start + br.JUDGE_BATCH]
        user = offers_text + "\n\n" + "\n\n".join(_post_text(i + 1, p) for i, p in enumerate(batch))
        try:
            got = call(budget, "read", model, JUDGE_SYSTEM, user, schema, br.JUDGE_MAX_TOKENS)
        except Exception as e:
            from . import contact_lab_search as cls
            if isinstance(e, cls.BudgetExceeded):
                e.partial = out
                raise
            log.warning("buyer_radar: Claude could not read posts %d-%d: %s: %s", start + 1, start + len(batch),
                        type(e).__name__, str(e)[:200])
            continue                       # one batch the model could not read is skipped, not the run
        for v in got.get("verdicts") or []:
            try:
                n = int(v.get("n"))
            except (TypeError, ValueError):
                continue
            if 1 <= n <= len(batch):
                out[batch[n - 1]["key"]] = clean_verdict(v, offers)
    return out


DRAFT_SYSTEM = (
    "You write a first message to someone who posted on LinkedIn asking for something your company "
    "sells. Write as the sender named, for the offer described. Rules: refer to their post specifically "
    "(what they asked for, in their terms) in the first line; say in one or two sentences how the offer "
    "fits that exact need, with no claims beyond what the offer description says; one clear, low-effort "
    "next step (a short call or a demo, or a reply); plain, warm, professional English; no flattery, no "
    "cliches, no exclamation marks, no em dashes, no emoji, no hashtags. Email: a subject under 60 "
    "characters and a body under 110 words, without a greeting line's name guess beyond their first name, "
    "and without a signature (it is added). LinkedIn connection note: under 280 characters, no link. "
    "LinkedIn message (for a first-degree connection): under 500 characters, may include the website.")

DRAFT_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["subject", "email", "note", "message"],
                "properties": {"subject": {"type": "string"}, "email": {"type": "string"},
                               "note": {"type": "string"}, "message": {"type": "string"}}}
NOTE_MAX = 300                     # LinkedIn's limit for a paid account's invitation note (Unipile's limits page)
MESSAGE_MAX = 1000


def _no_dashes(s):
    return re.sub(r"\s*[—–]\s*", ", ", s or "").strip()


def draft(lead, offer, sender, *, budget, model=br.MODEL, call=None):
    from . import contact_lab as lab
    call = call or lab._json_call
    p, v = lead["post"], lead["verdict"]
    a = p.get("author") or {}
    first = (a.get("name") or "").split(" ")[0] if not a.get("company") else ""
    user = ("OFFER: %s (%s)\n%s\n\nSENDER: %s%s\n\nTHEIR POST (by %s, %s):\n%s\n\nWHAT THEY WANT: %s\n"
            "Their first name, to greet them by: %s" % (
                offer["label"], offer["site"], offer["sells"], sender.get("name") or "the team",
                (", " + sender["title"]) if sender.get("title") else "", a.get("name") or "the author",
                a.get("headline") or "", re.sub(r"\s+", " ", p.get("text") or "")[:2500], v.get("need") or "",
                first or "(none; use no name)"))
    got = call(budget, "draft", model, DRAFT_SYSTEM, user, DRAFT_SCHEMA, br.DRAFT_MAX_TOKENS)
    out = {k: _no_dashes(got.get(k)) for k in ("subject", "email", "note", "message")}
    out["subject"] = out["subject"][:120]
    out["note"] = out["note"][:NOTE_MAX]
    out["message"] = out["message"][:MESSAGE_MAX]
    return out
