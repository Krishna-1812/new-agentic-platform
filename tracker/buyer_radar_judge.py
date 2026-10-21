"""Buyer Radar: Claude reads each post and says whether its author wants to buy, then writes to them.

    judge_posts(posts, offers, budget=, model=) -> {post key: verdict}
    judge_posts(signals, offers, ..., system=JOB_SYSTEM, text_of=job_text)          companies hiring
    judge_posts(comments, offers, ..., system=COMMENT_SYSTEM, text_of=comment_text)  people in the comments
    judge_posts(rfps, offers, ..., system=RFP_SYSTEM, text_of=rfp_text)              requests for proposals
    judge_posts(threads, offers, ..., system=REDDIT_SYSTEM, text_of=reddit_text)     Reddit threads
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
import time

from . import buyer_radar as br
from . import claude_workspace

log = logging.getLogger(__name__)

INTENTS = ("seeking_vendor", "asking_recommendations", "hiring_for_it", "pain_point", "none")
INTENT_LABELS = {"seeking_vendor": "Looking for a vendor", "asking_recommendations": "Asking for recommendations",
                 "hiring_for_it": "Hiring for it", "pain_point": "Has the problem", "none": "Not buying",
                 # never the model's to choose: a person a customer profile found, who has said nothing
                 "fits_profile": "Fits your customer profile"}
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

JOB_SYSTEM = (
    "You find companies for a sales team whose open jobs show they need what one of the team's offers "
    "sells. You are given what each offer sells and who buys it, then numbered companies, each with the "
    "jobs it advertises on LinkedIn. For each company decide, from its name and its jobs alone:\n"
    "- role: 'buyer' when the company is building, in house, work an offer does (a marketing team for a "
    "marketing agency's offer; call quality, sales coaching or support quality for a call analytics offer) "
    "and could buy the offer instead of, or as well as, hiring; 'seller' when the company itself sells the "
    "offer's service or product (a marketing agency hiring marketers, a call analytics vendor hiring); "
    "'other' for a recruiter or staffing firm hiring for unnamed clients, or jobs unrelated to every offer.\n"
    "- offer: which offer's key fits, or 'none'.\n"
    "- intent: 'hiring_for_it' when the jobs are the offer's work, else 'none'.\n"
    "- score 0 to 100, how likely a short message about the offer is welcome now: several open roles in the "
    "offer's area, or a first hire for it at a small or mid-sized company, 65 to 85; one such role, 50 to 70; "
    "a large enterprise hiring one specialist, 30 to 50; any seller, recruiter or unrelated job 0 to 10.\n"
    "- need: what they are building, in one short sentence in plain English (\"Building an in-house "
    "performance marketing team\").\n"
    "- company: the company's name. region: the job locations if given, else ''. deadline: ''.\n"
    "- reason: why, in one sentence, naming the roles.\n"
    "Never invent facts that are not in the jobs given. Use the numbers given.")

COMMENT_SYSTEM = (
    "You find buyers for a sales team in the comments under LinkedIn posts where someone asked for what "
    "the team sells. You are given what each offer sells and who buys it, then numbered comments, each "
    "with what the post it is under asked for. For each comment decide whether its author wants the same "
    "thing themselves:\n"
    "- role: 'buyer' when the commenter says they need it too, are also looking, or ask to be told what "
    "the post's author finds ('following', 'interested', 'same question here'); 'seller' when they offer "
    "their own product, service or agency, or invite a message about it (most comments under such posts "
    "are vendors pitching); 'job_seeker' when they want a job; else 'other' (tagging someone, praise, a "
    "recommendation of a product they do not sell).\n"
    "- offer: which offer's key fits what they want, or 'none'. intent: 'seeking_vendor' when they say they "
    "want it, 'asking_recommendations' when they ask to be told, else 'none'.\n"
    "- score 0 to 100, how likely a short message from this offer is welcome now: they say they need it "
    "too, 70 to 90; 'following', 'interested' or 'same question' alone, 50 to 65; any seller, job seeker or "
    "'other' 0 to 10.\n"
    "- need, company (from the headline, else ''), region, deadline, reason as for a post; the reason "
    "quotes a few words of the comment.\n"
    "Never invent facts that are not in the comment or headline. Use the numbers given.")

RFP_SYSTEM = (
    "You find work for a sales team in requests for proposals (RFPs), requests for quotation and tenders "
    "that organisations have published. You are given what each of the team's offers sells and who buys "
    "it, then numbered RFPs, each with who issued it, what it asks for, its due date and where. For each "
    "RFP decide:\n"
    "- role: 'buyer' when the issuer is asking vendors for work an offer does; 'seller' when it is a "
    "vendor's own page, an advert or a list of RFPs sold by a lead service; 'other' when it asks for "
    "something no offer does (construction, printing, hardware).\n"
    "- offer: which offer's key fits, or 'none'. intent: 'seeking_vendor' when it fits, else 'none'.\n"
    "- score 0 to 100, how likely a response from this offer is worth the team's time: exactly the offer's "
    "work with a due date at least a week away, 75 to 95; the offer's work as one part of a wider scope, 55 "
    "to 75; due within a week, or limited to local, certified or registered vendors the offer may not "
    "qualify as, 30 to 55; anything else 0 to 10.\n"
    "- need: what they want, in one short sentence in plain English.\n"
    "- company: the issuer. region: where, if given. deadline: the due date as given, else ''.\n"
    "- reason: why, in one sentence, naming the scope.\n"
    "Never invent facts that are not in the RFP given. Use the numbers given.")

REDDIT_SYSTEM = (
    "You find buyers on Reddit for a sales team. You are given what each of the team's offers sells and "
    "who buys it, then numbered Reddit threads (the title and the opening post). For each thread decide, "
    "from the thread alone:\n"
    "- role: 'buyer' when the poster wants a product, tool, agency or freelancer, or advice choosing one, "
    "for themselves or their company; 'seller' when they promote their own product or service; "
    "'job_seeker' when they want a job or clients; else 'other' (news, a rant, a question about a career).\n"
    "- offer: which offer's key fits what they want, or 'none'.\n"
    "- intent: 'seeking_vendor', 'asking_recommendations', 'pain_point' or 'none', as for a LinkedIn post.\n"
    "- score 0 to 100, how likely a helpful reply in the thread that mentions the offer is welcome: asking "
    "for a vendor or for recommendations in the offer's area, 65 to 90; a pain point the offer solves, 35 "
    "to 60; any seller, job seeker or 'none' offer 0 to 10.\n"
    "- need, company (only if the thread names it, else ''), region, deadline, reason as for a post; the "
    "reason quotes a few words of the thread.\n"
    "Never invent facts that are not in the thread. Use the numbers given.")

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


def job_text(n, p):
    lines = "\n".join("- %s%s%s" % (j.get("title"), (", " + j["location"]) if j.get("location") else "",
                                    (", posted " + str(j["posted_at"])[:10]) if j.get("posted_at") else "")
                      for j in (p.get("jobs") or [])[:8])
    return "COMPANY %d: %s\nOPEN JOBS ON LINKEDIN:\n%s" % (n, (p.get("company") or {}).get("name") or
                                                        (p.get("author") or {}).get("name") or "unknown", lines)


def comment_text(n, p):
    a, parent = p.get("author") or {}, p.get("parent") or {}
    return "COMMENT %d (posted %s)\nUNDER A POST BY %s ASKING FOR: %s\nCOMMENTER: %s, %s\nCOMMENT: %s" % (
        n, p.get("posted_at") or "date unknown", parent.get("author") or "someone", parent.get("need") or "unknown",
        a.get("name") or "unknown", a.get("headline") or "no headline", re.sub(r"\s+", " ", p.get("text") or "")[:1500])


def rfp_text(n, p):
    r = p.get("rfp") or {}
    return "RFP %d\nTITLE: %s\nISSUED BY: %s\nDUE: %s\nWHERE: %s\nWHAT THEY WANT: %s" % (
        n, r.get("title") or "unknown", r.get("issuer") or "unknown", r.get("due") or "not given",
        r.get("location") or "not given", r.get("summary") or re.sub(r"\s+", " ", p.get("text") or "")[:1500])


def reddit_text(n, p):
    return "THREAD %d (posted %s, in r/%s)\nBY: %s\nTEXT: %s" % (
        n, p.get("posted_at") or "date unknown", p.get("subreddit") or "unknown", (p.get("author") or {}).get("name") or "unknown",
        re.sub(r"\s+", " ", p.get("text") or "")[:2500])


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


class Verdicts(dict):
    """{post key: verdict}, and .errors: why the posts left out could not be read, one line per failed call."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.errors = []


RETRIES = 3                # a rate limit or an overloaded API is waited out this many times per batch


def why(e):
    """One line a person can act on: the API's status and message, or the error's own words."""
    status = getattr(e, "status_code", None)
    msg = getattr(e, "message", None) or getattr(e, "detail", None) or str(e)
    msg = re.sub(r"\s+", " ", str(msg)).strip()
    steps = claude_workspace.explain(msg)
    if steps:
        return steps
    msg = msg[:240]
    return ("Claude API %s: %s" % (status, msg)) if isinstance(status, int) else ("%s: %s" % (type(e).__name__, msg))


def _wait_for(e, attempt):
    """Seconds to wait before asking again, or None when asking again would fail the same way."""
    status = getattr(e, "status_code", None)
    if status not in (429, 500, 502, 503, 504, 529) and getattr(e, "kind", None) != "api_error":
        return None
    try:
        after = float((getattr(getattr(e, "response", None), "headers", None) or {}).get("retry-after") or 0)
    except (TypeError, ValueError):
        after = 0
    return min(60.0, max(after, 5.0 * (attempt + 1)))


def judge_posts(posts, offers, *, budget, model=br.MODEL, call=None, sleep=time.sleep, system=JUDGE_SYSTEM,
                text_of=None):
    """Every post, in batches of buyer_radar.JUDGE_BATCH. A batch that would pass the run's cap raises
    BudgetExceeded, carrying the verdicts read so far as .partial, so the caller keeps them. A rate limit is
    waited out; a reply cut off at its length limit is asked again in two halves; any other failure skips
    the batch and is kept in .errors, so the run can say why posts were not read."""
    from . import contact_lab as lab
    from . import contact_lab_search as cls
    call = call or lab._json_call
    text_of = text_of or _post_text
    out = Verdicts()
    offers_text = _offers_text(offers)
    schema = judge_schema(offers)

    def read(batch):
        user = offers_text + "\n\n" + "\n\n".join(text_of(i + 1, p) for i, p in enumerate(batch))
        for attempt in range(RETRIES + 1):
            try:
                got = call(budget, "read", model, system, user, schema, br.JUDGE_MAX_TOKENS)
                break
            except cls.BudgetExceeded:
                raise
            except Exception as e:
                if getattr(e, "kind", None) == "truncated" and len(batch) > 1:
                    half = len(batch) // 2
                    read(batch[:half])
                    read(batch[half:])
                    return
                wait = _wait_for(e, attempt)
                if wait is not None and attempt < RETRIES:
                    sleep(wait)
                    continue
                log.warning("buyer_radar: Claude could not read %d posts: %s", len(batch), why(e))
                out.errors.append(why(e))
                return
        for v in got.get("verdicts") or []:
            try:
                n = int(v.get("n"))
            except (TypeError, ValueError):
                continue
            if 1 <= n <= len(batch):
                out[batch[n - 1]["key"]] = clean_verdict(v, offers)

    for start in range(0, len(posts), br.JUDGE_BATCH):
        try:
            read(posts[start:start + br.JUDGE_BATCH])
        except cls.BudgetExceeded as e:
            e.partial = out
            raise
    return out


CHECK_POST = {"key": "check", "text": "We are looking for a call analytics tool for our sales team. Recommendations?",
              "author": {"name": "A test", "headline": "Head of Sales"}, "posted_at": "today"}


def check(offers, *, budget, model=br.MODEL, call=None):
    """One post read before the search is paid for: '' when Claude answers, else why it did not, so a run
    that could read nothing stops before Apify charges for posts."""
    got = judge_posts([CHECK_POST], offers, budget=budget, model=model, call=call)
    return "" if got else (got.errors[0] if got.errors else "Claude returned no verdict for a test post.")


DRAFT_SYSTEM = (
    "You write a first message to someone whose public LinkedIn activity shows they need something your "
    "company sells: a post asking for it, a comment saying they need it too, or their company's job ads "
    "for the work; or who fits the offer's customers at a moment that matters (new in their role, their "
    "company recently funded or hiring), and has asked for nothing. Write as the sender named, for the "
    "offer described. Rules: refer to that signal specifically in the first line, in their terms (for a "
    "post or comment, what they asked for; for job ads, the roles their company is hiring for, as something "
    "public you noticed, never as if they asked you; for a customer profile, the moment, briefly and without "
    "presuming they need anything, and never pretending they posted or asked; for an RFP, name it and its "
    "due date, say the offer means to respond and ask for the full documents or the next step; for a "
    "Reddit thread, follow the instructions given with it); say in one or two sentences how the offer fits that exact need, with no claims beyond what the "
    "offer description says; one clear, low-effort next step (a short call or a demo, or a reply); plain, "
    "warm, professional English; no flattery, no cliches, no exclamation marks, no em dashes, no emoji, no "
    "hashtags. Email: a subject under 60 characters and a body under 110 words, without a greeting line's "
    "name guess beyond their first name, and without a signature (it is added). LinkedIn connection note: "
    "under 280 characters, no link. LinkedIn message (for a first-degree connection): under 500 "
    "characters, may include the website.")

DRAFT_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["subject", "email", "note", "message"],
                "properties": {"subject": {"type": "string"}, "email": {"type": "string"},
                               "note": {"type": "string"}, "message": {"type": "string"}}}
NOTE_MAX = 300                     # LinkedIn's limit for a paid account's invitation note (Unipile's limits page)
MESSAGE_MAX = 1000


def _no_dashes(s):
    return re.sub(r"\s*[—–]\s*", ", ", s or "").strip()


def _signal_text(lead):
    """What the person did that makes them a lead, for the writer: their post, their comment, or their
    company's job ads, and who the message goes to."""
    p, v = lead["post"], lead["verdict"]
    a = p.get("author") or {}
    kind = p.get("kind") or "post"
    if kind == "jobs":
        c = (p.get("contacts") or [{}])[0]
        roles = "; ".join("%s%s" % (j.get("title"), (" (%s)" % j["location"]) if j.get("location") else "")
                          for j in (p.get("jobs") or [])[:6])
        who = ("%s, %s at %s" % (c["name"], c.get("title") or "", a.get("name"))) if c.get("name") else \
            "the team at %s (no name known)" % a.get("name")
        first = (c.get("name") or "").split(" ")[0]
        return ("WRITING TO: %s\n\nTHEIR COMPANY'S OPEN JOBS ON LINKEDIN (%s): %s\n\nWHAT THEY ARE BUILDING: %s"
                % (who, a.get("name"), roles, v.get("need") or "")), first
    if kind == "icp":
        icp = p.get("icp") or {}
        c = (p.get("contacts") or [{}])[0]
        return ("WRITING TO: %s, %s\n\nWHY THEM: they fit the customer profile “%s”%s.\nThey have not asked for "
                "anything: this is a cold first message." % (a.get("name") or "them", a.get("headline") or "",
                                                              icp.get("name") or "", ("; " + icp["why"]) if icp.get("why") else "")
                ), (c.get("name") or a.get("name") or "").split(" ")[0]
    if kind == "rfp":
        r = p.get("rfp") or {}
        return ("WRITING TO: the contact for a request for proposals published by %s\n\nTHE RFP: %s. %s%s%s\n\n"
                "WHAT THEY WANT: %s\nThey published this for vendors to answer: say you saw it, never that they "
                "asked you." % (r.get("issuer") or "an organisation", r.get("title") or "", r.get("summary") or "",
                                (" Due %s." % r["due"]) if r.get("due") else "", (" %s." % r["location"]) if r.get("location") else "",
                                v.get("need") or "")), ""
    if kind == "reddit":
        return ("A PUBLIC REDDIT THREAD by %s %s:\n%s\n\nWHAT THEY WANT: %s\n\nWrite 'message' as a reply to post in "
                "the thread, under 600 characters: answer their question helpfully first, then say plainly that you "
                "work on the offer and that it may fit, in one sentence, with the website. No sales tone, no link "
                "beyond the website. Leave 'subject', 'email' and 'note' as empty strings: nobody on Reddit is "
                "emailed." % (a.get("name") or "someone", a.get("headline") or "", re.sub(r"\s+", " ", p.get("text") or "")[:2500],
                               v.get("need") or "")), ""
    first = (a.get("name") or "").split(" ")[0] if not a.get("company") else ""
    body = re.sub(r"\s+", " ", p.get("text") or "")[:2500]
    if kind == "comment":
        parent = p.get("parent") or {}
        return ("THEIR COMMENT (by %s, %s), under a LinkedIn post by %s asking for: %s\n%s\n\nWHAT THEY WANT: %s"
                % (a.get("name") or "the author", a.get("headline") or "", parent.get("author") or "someone",
                   parent.get("need") or "", body, v.get("need") or "")), first
    return ("THEIR POST (by %s, %s):\n%s\n\nWHAT THEY WANT: %s" % (
        a.get("name") or "the author", a.get("headline") or "", body, v.get("need") or "")), first


def draft(lead, offer, sender, *, budget, model=br.MODEL, call=None):
    from . import contact_lab as lab
    call = call or lab._json_call
    signal, first = _signal_text(lead)
    user = ("OFFER: %s (%s)\n%s\n\nSENDER: %s%s\n\n%s\nTheir first name, to greet them by: %s" % (
        offer["label"], offer["site"], offer["sells"], sender.get("name") or "the team",
        (", " + sender["title"]) if sender.get("title") else "", signal, first or "(none; use no name)"))
    got = call(budget, "draft", model, DRAFT_SYSTEM, user, DRAFT_SCHEMA, br.DRAFT_MAX_TOKENS)
    out = {k: _no_dashes(got.get(k)) for k in ("subject", "email", "note", "message")}
    out["subject"] = out["subject"][:120]
    out["note"] = out["note"][:NOTE_MAX]
    out["message"] = out["message"][:MESSAGE_MAX]
    return out
