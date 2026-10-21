"""Buyer Radar: LinkedIn posts that match a search, through Unipile.

Unipile runs LinkedIn's own post search ("Classic - POSTS", POST /api/v1/linkedin/search) from the
connected LinkedIn account, so it costs nothing per post (Unipile is paid per connected account). It is
the same search Apify's actor runs, with two differences:

- `date_posted` is past_day, past_week or past_month only: "Last 3 months" reads the last month.
- It runs as a real LinkedIn account, the one Buyer Radar sends from. Unipile advises about 1,000 search
  results a day for a standard account and warns that more risks the account; DAY_MAX keeps every
  workspace together under that, and the searches are spaced out (PAUSE_S).

Request and Post shapes are from Unipile's API reference (linkedincontroller_search, postscontroller_getpost)
and developer.unipile.com/docs/provider-limits-and-restrictions, read 2026-10-18; not yet confirmed against
a live response, so each field is read defensively.

    collect(queries, posted="3months", per_query=25, room=day_max()) -> {"posts", "usd", "error", "results", "notes"}
"""
from __future__ import annotations

import logging
import random
import re
import time

log = logging.getLogger(__name__)

DATE_POSTED = {"1h": "past_day", "24h": "past_day", "week": "past_week", "month": "past_month",
               "3months": "past_month"}
PAGE_MAX = 49           # the reference: post searches return up to 49 a page
DAY_MAX = 900           # all workspaces together, under Unipile's ~1,000 results a day, with room for other agents
DAY_MAX_CEILING = 2400  # a Sales Navigator account is allowed about 2,500 a day (the same limits page)
PAUSE_S = (2.0, 5.0)    # between requests, at random, as Unipile advises


def day_max():
    """The day's LinkedIn search results across every workspace: DAY_MAX, or BUYER_RADAR_UNIPILE_DAY_MAX
    for an account LinkedIn allows more (Sales Navigator), held under DAY_MAX_CEILING. Posts, job ads and
    every other LinkedIn search share it."""
    import os
    try:
        n = int((os.environ.get("BUYER_RADAR_UNIPILE_DAY_MAX") or "").strip() or DAY_MAX)
    except ValueError:
        n = DAY_MAX
    return max(100, min(DAY_MAX_CEILING, n))


def _items(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("items", "elements", "results", "data"):
            if isinstance(payload.get(key), list):
                return payload[key]
    return []


def _cursor(payload):
    if isinstance(payload, dict):
        c = payload.get("cursor") or (payload.get("paging") or {}).get("cursor")
        return c if isinstance(c, str) and c else None
    return None


def _activity_id(item):
    """The post's activity number, the same key Apify's actor gives the post (its "id"), so a post found
    through either is one post."""
    for v in (item.get("social_id"), item.get("share_url"), item.get("id")):
        m = re.search(r"(\d{16,})", str(v or ""))
        if m:
            return m.group(1)
    return str(item.get("id") or "")


def as_actor_item(item, query):
    """A Unipile Post in the shape of an Apify actor item, so buyer_radar_source.normalize reads both."""
    a = item.get("author") if isinstance(item.get("author"), dict) else {}
    handle = str(a.get("public_identifier") or "").strip()
    company = a.get("is_company") is True
    a_url = ("https://www.linkedin.com/%s/%s/" % ("company" if company else "in", handle)) if handle else ""
    return {"id": _activity_id(item), "social_id": item.get("social_id") or "",
            "linkedinUrl": item.get("share_url") or "", "content": item.get("text") or "",
            "postedAt": {"date": item.get("parsed_datetime") or ""},
            "author": {"name": a.get("name") or "", "info": a.get("headline") or "", "linkedinUrl": a_url,
                       "type": "company" if company else "profile"},
            "engagement": {"likes": item.get("reaction_counter"), "comments": item.get("comment_counter")},
            "query": query}


def collect(queries, *, posted="3months", per_query=25, room=None, account_id=None, client=None,
            sleep=time.sleep):
    """Every query, page by page, until per_query posts each or `room` results in all. Never raises:
    {"posts", "usd": 0, "error", "results", "notes"}. A refusal (LinkedIn's limit shows as HTTP 429 or 500)
    stops the rest, and what was found is kept."""
    from tracker import buyer_radar_source as src
    if client is None:
        from tracker import unipile_client as client
    room = day_max() if room is None else room
    out = {"posts": [], "usd": 0.0, "error": None, "results": 0, "notes": []}
    if posted == "3months":
        out["notes"].append("Unipile looks back a month at most, so this search read the last month.")
    if account_id is None:
        account_id, err = client.linkedin_account_id()
        if err is not None:
            out["error"] = "Unipile: %s" % client.describe_error(err)
            return out
    raw, first = [], True
    for q in queries:
        cursor, got = None, 0
        while got < per_query and out["results"] < room:
            if not first:
                sleep(random.uniform(*PAUSE_S))
            first = False
            limit = min(PAGE_MAX, per_query - got, room - out["results"])
            data, err = client.search_posts_filtered(account_id, keywords=q, date_posted=DATE_POSTED.get(posted, "past_month"),
                                                     sort_by="date", cursor=cursor, limit=limit)
            if err is not None:
                out["error"] = "Unipile: %s" % client.describe_error(err)
                log.warning("buyer_radar: Unipile search stopped at %r: %s", q[:60], out["error"])
                break
            items = [i for i in _items(data) if isinstance(i, dict)]
            got += len(items)
            out["results"] += len(items)
            raw.extend(as_actor_item(i, q) for i in items)
            cursor = _cursor(data)
            if not items or not cursor:
                break
        if out["error"]:
            break
        if out["results"] >= room:
            out["notes"].append("Stopped at today's Unipile limit of %d search results." % day_max())
            break
    out["posts"] = src.normalize(raw)
    return out
