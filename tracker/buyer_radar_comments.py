"""Buyer Radar: people in the comments of a buyer's post who want the same thing.

Under "Can anyone recommend a call analytics tool?" most comments are vendors pitching, but some say
"we are looking for the same", "following" or "interested, please share". Those people have the need
too, and nobody else has noticed them. For the best posts a run keeps, this reads the comments through
Unipile (free, from the connected LinkedIn account), and Claude reads each comment against the post's ask
(buyer_radar_judge.COMMENT_SYSTEM). A comment kept becomes a lead of its own, with the post it was under.

Comment shape from Unipile's reference (postscontroller_listallcomments, read 2026-10-21): id, text,
date, author (the name), author_details {id, headline, profile_url, network_distance}. Not yet
confirmed against a live response, so each field is read defensively.

    collect(leads, per_post=, account_id=, client=) -> {"comments", "error", "notes", "posts"}
"""
from __future__ import annotations

import logging
import random
import time

log = logging.getLogger(__name__)

PER_POST = 60          # comments read under each post
MIN_CHARS = 3


def normalize(item, parent):
    """One comment in a post's shape, or None (no text, no author, or the post's own author replying)."""
    from tracker import buyer_radar_source as src
    if not isinstance(item, dict):
        return None
    text = str(item.get("text") or "").strip()
    d = item.get("author_details") if isinstance(item.get("author_details"), dict) else {}
    name = item.get("author") if isinstance(item.get("author"), str) else str((item.get("author") or {}).get("name") or "")
    url = str(d.get("profile_url") or "").strip()
    cid = str(item.get("id") or "").strip()
    if len(text) < MIN_CHARS or not cid or not (url or d.get("id")):
        return None
    key = src.profile_key(url) or ("li/%s" % d.get("id"))
    pa = parent["post"].get("author") or {}
    if key and key == pa.get("key"):
        return None
    return {"key": "comment:%s" % cid, "kind": "comment", "url": parent["post"]["url"], "text": text[:3000],
            "posted_at": item.get("date") or "",
            "author": {"name": name.strip()[:120], "headline": str(d.get("headline") or "")[:300], "url": url,
                       "key": key, "provider_id": str(d.get("id") or ""), "company": False},
            "parent": {"key": parent["post"]["key"], "url": parent["post"]["url"], "author": pa.get("name") or "",
                       "need": (parent.get("verdict") or {}).get("need") or "", "offer": parent.get("offer") or ""},
            "reactions": item.get("reaction_counter") if isinstance(item.get("reaction_counter"), int) else 0,
            "comments": 0, "query": parent["post"].get("query") or "", "social_id": ""}


def collect(leads, *, per_post=PER_POST, account_id=None, client=None, sleep=time.sleep):
    """The comments under each lead's post that has any. Never raises: {"comments", "error", "notes",
    "posts"} where posts is how many posts were read."""
    if client is None:
        from tracker import unipile_client as client
    out = {"comments": [], "error": None, "notes": [], "posts": 0}
    leads = [x for x in leads if (x.get("post") or {}).get("social_id") and (x["post"].get("comments") or 0) != 0]
    if not leads:
        return out
    if account_id is None:
        account_id, err = client.linkedin_account_id()
        if err is not None:
            out["error"] = "Unipile: %s" % client.describe_error(err)
            return out
    seen = set()
    for i, lead in enumerate(leads):
        if i:
            sleep(random.uniform(1.0, 3.0))
        data, err = client.list_comments(lead["post"]["social_id"], account_id, limit=min(100, per_post))
        if err is not None:
            if (err or {}).get("status") == 429:
                out["error"] = "Unipile: %s" % client.describe_error(err)
                break
            out["notes"].append("The comments of one post could not be read (%s)." % client.describe_error(err))
            continue
        out["posts"] += 1
        items = data.get("items") if isinstance(data, dict) else data if isinstance(data, list) else []
        for item in items or []:
            c = normalize(item, lead)
            if c and c["key"] not in seen:
                seen.add(c["key"])
                out["comments"].append(c)
    return out
