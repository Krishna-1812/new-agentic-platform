"""Buyer Radar: LinkedIn posts that match a search, through Apify.

The actor is HarvestAPI's LinkedIn Post Search (apify.com/harvestapi/linkedin-post-search). It needs no
LinkedIn cookie or account, and takes the same queries as LinkedIn's own search bar, Boolean operators
included (at most 500 characters and 5 operators per query). `maxPosts` is per query. The store page
lists it at $1.50 to $2 per 1,000 posts; the run's real charge is what Apify reports
(usageTotalUsd), and `maxTotalChargeUsd` makes Apify stop charging at the run's cap.

    build_input(queries, posted="24h", per_query=25)
    normalize(raw_items) -> [post]      one shape, whatever the actor returns
    collect(queries, token, ...) -> {"posts", "usd", "error"}

Override the actor with BUYER_RADAR_APIFY_ACTOR_ID.
"""
from __future__ import annotations

import os
import re
from urllib.parse import urlsplit

DEFAULT_ACTOR_ID = "harvestapi/linkedin-post-search"
POSTED = ("1h", "24h", "week", "month")
USD_PER_POST = 0.002            # the store's list price, for estimates only; the real charge is Apify's
MAX_QUERY_CHARS = 500
MAX_OPERATORS = 5


def actor_id():
    return (os.environ.get("BUYER_RADAR_APIFY_ACTOR_ID") or "").strip() or DEFAULT_ACTOR_ID


def check_query(q):
    """The reason LinkedIn's search would refuse a query, or None."""
    q = (q or "").strip()
    if not q:
        return "is empty"
    if len(q) > MAX_QUERY_CHARS:
        return "is longer than %d characters" % MAX_QUERY_CHARS
    if len(re.findall(r"\b(AND|OR|NOT)\b", q)) > MAX_OPERATORS:
        return "has more than %d AND/OR/NOT" % MAX_OPERATORS
    return None


def build_input(queries, posted="24h", per_query=25):
    return {"searchQueries": [q.strip() for q in queries if q and q.strip()],
            "maxPosts": int(per_query), "postedLimit": posted if posted in POSTED else "24h",
            "sortBy": "date", "profileScraperMode": "short"}


def _get(d, *keys):
    for k in keys:
        cur = d
        for part in k.split("."):
            cur = cur.get(part) if isinstance(cur, dict) else None
        if cur not in (None, "", [], {}):
            return cur
    return None


def profile_key(url):
    """A LinkedIn profile or company URL reduced to one key ("in/jane-doe"), so the same person is
    one person however their link was written."""
    if not url or not isinstance(url, str):
        return ""
    parts = [p for p in urlsplit(url.strip()).path.split("/") if p]
    for i, p in enumerate(parts[:-1]):
        if p.lower() in ("in", "company", "school", "showcase"):
            return "%s/%s" % (p.lower(), parts[i + 1].lower())
    return ""


def public_id(url):
    key = profile_key(url)
    return key.split("/", 1)[1] if key.startswith("in/") else ""


def _post_key(item, url):
    pid = _get(item, "id", "urn", "entityId", "shareUrn")
    if pid:
        return str(pid)
    m = re.search(r"(\d{16,})", url or "")
    return m.group(1) if m else (url or "")


def normalize(raw_items):
    """Posts in one shape. A post with no text or no link is dropped: there is nothing to judge or open."""
    out, seen = [], set()
    for item in raw_items or []:
        if not isinstance(item, dict):
            continue
        url = _get(item, "linkedinUrl", "url", "postUrl", "shareUrl")
        text = _get(item, "content", "text", "commentary", "postText")
        if not url or not isinstance(text, str) or not text.strip():
            continue
        key = _post_key(item, url)
        if key in seen:
            continue
        seen.add(key)
        author = item.get("author") if isinstance(item.get("author"), dict) else {}
        a_url = _get(author, "linkedinUrl", "url", "profileUrl") or _get(item, "authorUrl", "authorProfileUrl")
        kind = str(_get(author, "type") or "").lower()
        out.append({
            "key": key, "url": url.split("?")[0], "text": text.strip()[:6000],
            "posted_at": _get(item, "postedAt.date", "postedAt", "postedDate", "date"),
            "author": {"name": _get(author, "name") or _get(item, "authorName") or "",
                       "headline": _get(author, "info", "headline", "position") or "",
                       "url": a_url or "", "key": profile_key(a_url),
                       "company": kind == "company" or profile_key(a_url).startswith("company/")},
            "reactions": _get(item, "engagement.likes", "numLikes", "likes") or 0,
            "comments": _get(item, "engagement.comments", "numComments", "comments") or 0,
            "query": item.get("query") or _get(item, "searchQuery") or "",
        })
    return out


def collect(queries, token, *, posted="24h", per_query=25, max_charge_usd=None, timeout=420, runner=None):
    """One Apify run over every query. Never raises: {"posts", "usd", "error", "status"}."""
    from tracker import apify_transport
    runner = runner or apify_transport.run_actor_collect
    got = runner(actor_id(), build_input(queries, posted, per_query), token, timeout=timeout,
                 max_charge_usd=max_charge_usd)
    return {"posts": normalize(got.get("items")), "usd": float(got.get("usd") or 0),
            "error": got.get("error"), "status": got.get("status")}
