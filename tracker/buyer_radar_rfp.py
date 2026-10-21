"""Buyer Radar: requests for proposals and tenders on the open web, found by Claude's web search.

An organisation that publishes an RFP for digital marketing, SEO or a call recording system has a
budget, a scope and a deadline, and is asking vendors to write to it. Governments, universities,
hospitals and companies post them on their own sites and on tender portals. Claude runs each search
once (contact_lab_search.claude, $10 per 1,000 searches plus the reading) and reads what it found into a
list: the title, who issued it, the due date, where, a contact address and a one-line summary. Claude
then reads each RFP against the offers (buyer_radar_judge.RFP_SYSTEM) like a post. An RFP whose due date
has passed is left out, and so is one whose link the search never returned (the model's own invention).
A search may say {year} for this year. The run searches every rfp_days days, not every run: an RFP stays
open for weeks, and each search is paid.

    OFFER_QUERIES           each offer's starting searches
    queries_for(settings, offer)
    collect(queries, budget=, model=, search=) -> {"rfps": [signal], "notes", "searches"}
    normalize(item, query, today, urls) -> signal or None
"""
from __future__ import annotations

import hashlib
import re
from datetime import date

MAX_QUERIES = 8
OFFER_QUERIES = {
    "markify": ["RFP digital marketing services proposals due {year}", "request for proposals SEO services {year}",
                "RFP social media management services {year}", "RFP paid media advertising agency services {year}",
                "tender digital marketing agency India {year}", "RFQ website redesign and digital marketing {year}"],
    "callvibe": ["RFP call recording software {year}", "RFP contact center quality monitoring software {year}",
                 "tender call recording and speech analytics system {year}", "RFP conversation analytics call center {year}"],
}
YEAR = "{year}"                 # in a search, this year: "RFP SEO services {year}"
ASK = (
    "From the search results only, list every request for proposals, request for quotation or tender that "
    "is still open (its due date is after %s, or not given), at most 8. Reply with JSON only, no prose: "
    '{"rfps": [{"title": "", "issuer": "the organisation that issued it", "due": "YYYY-MM-DD or \'\'", '
    '"location": "city or country, or \'\'", "contact_email": "an address the RFP gives, or \'\'", '
    '"url": "the result URL it came from", "summary": "what they want, in one sentence"}]}. '
    'If there is none, reply {"rfps": []}. Never invent an RFP, a date or an address.')


def queries_for(settings, offer):
    own = (settings.get("rfp_queries") or {}).get(offer)
    return list(own) if own else list(OFFER_QUERIES.get(offer, []))


def _url_key(u):
    return str(u or "").strip().lower().rstrip("/")


def _due(v):
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", str(v or ""))
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


EMAIL_RX = re.compile(r"^[^@\s<>\"']+@[^@\s<>\"']+\.[A-Za-z]{2,}$")


def normalize(item, query, today, urls=None):
    """One RFP in a post's shape, or None: no title or link, a link not among `urls` (the search's own
    results, so not one the model made up; None skips the check), or a due date already past."""
    if not isinstance(item, dict):
        return None
    title = re.sub(r"\s+", " ", str(item.get("title") or "")).strip()[:200]
    url = str(item.get("url") or "").strip()
    if not title or not re.match(r"^https?://", url) or (urls is not None and _url_key(url) not in urls):
        return None
    due = _due(item.get("due"))
    if due and due < today:
        return None
    issuer = re.sub(r"\s+", " ", str(item.get("issuer") or "")).strip()[:160]
    email = str(item.get("contact_email") or "").strip().lower()
    email = email if EMAIL_RX.match(email) else ""
    summary = re.sub(r"\s+", " ", str(item.get("summary") or "")).strip()[:500]
    where = str(item.get("location") or "").strip()[:120]
    text = "%s%s. %s%s%s" % (title, (" (%s)" % issuer) if issuer else "", summary,
                              (" Due %s." % due.isoformat()) if due else "", (" %s." % where) if where else "")
    return {"key": "rfp:%s" % hashlib.sha1(_url_key(url).encode()).hexdigest()[:16], "kind": "rfp", "url": url,
            "text": text.strip()[:3000], "posted_at": "",
            "author": {"name": issuer or "An organisation", "headline": "Request for proposals", "url": url,
                       "key": "", "company": True},
            "rfp": {"title": title, "issuer": issuer, "due": due.isoformat() if due else "", "location": where,
                    "contact_email": email, "summary": summary},
            "company": {"name": issuer}, "reactions": 0, "comments": 0, "query": query, "social_id": ""}


def collect(queries, *, budget, model, today=None, search=None):
    """Every query searched once. Never raises except at the run's cap (BudgetExceeded, with what was found
    so far as .partial): {"rfps", "notes", "searches"}."""
    from . import claude_websearch as cws, contact_lab_search as cls
    search = search or cls.claude
    today = today or date.today()
    out = {"rfps": [], "notes": [], "searches": 0}
    seen = set()
    for q in queries:
        q = q.replace(YEAR, str(today.year))
        try:
            got = search(q, model=model, budget=budget, ask=ASK % today.isoformat())
        except cls.BudgetExceeded as e:
            e.partial = out
            raise
        out["searches"] += int(got.get("searches") or 0)
        if got.get("status") not in ("ok", "empty"):
            out["notes"].append("The RFP search “%s” %s." % (q[:60], got.get("note") or got.get("status")))
            continue
        urls = {_url_key(r.get("url")) for r in got.get("results") or [] if r.get("url")}
        parsed = cws.extract_json(got.get("reply") or "", require="rfps") or {}
        for item in parsed.get("rfps") or []:
            rfp = normalize(item, q, today, urls)
            if rfp and rfp["key"] not in seen:
                seen.add(rfp["key"])
                out["rfps"].append(rfp)
    return out
