"""Buyer Radar: Reddit threads from people asking for what we sell.

Founders and managers ask Reddit what nobody on LinkedIn sees them ask: "Any PPC agency you would
recommend for a small SaaS?" in r/PPC, "Gong is too expensive, what else?" in r/sales. Reddit's own
search (tracker/sci_reddit_client.search_posts, through its sanctioned API, free) finds the last month's
threads, newest first; Claude reads them as it reads posts.

Nobody on Reddit can be emailed or invited from here: a Reddit lead is answered on Reddit, by a person,
in the thread. The message written for it is a reply to post there.

Needs REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET (a Reddit app, reddit.com/prefs/apps).

    OFFER_QUERIES           each offer's starting searches
    queries_for(settings, offer)
    collect(queries, per_query=, search=) -> {"posts": [signal], "notes"}
"""
from __future__ import annotations

MAX_QUERIES = 10
OFFER_QUERIES = {
    "callvibe": ['"call recording software" recommend', '"conversation intelligence" recommend', '"Gong alternative"',
                 '"call center QA" software', '"call analytics" tool recommend'],
    "markify": ['"looking for a marketing agency"', '"recommend a PPC agency"', '"looking for an SEO agency"',
                '"hire a marketing agency"', '"Google Ads agency" recommend'],
}


def configured():
    from . import sci_reddit_client as rc
    return rc.is_configured()


def queries_for(settings, offer):
    own = (settings.get("reddit_queries") or {}).get(offer)
    return list(own) if own else list(OFFER_QUERIES.get(offer, []))


def normalize(post, query):
    """A Reddit thread (sci_reddit_client.normalize's shape) in a post's shape, or None."""
    raw = post.get("raw") or {}
    author = str(raw.get("author") or "")
    if not post.get("platform_post_id") or not post.get("post_url") or author in ("", "[deleted]", "AutoModerator"):
        return None
    sub = raw.get("subreddit") or ""
    return {"key": "reddit:%s" % post["platform_post_id"], "kind": "reddit", "url": post["post_url"],
            "text": str(post.get("caption") or "")[:4000], "posted_at": post.get("posted_at") or "",
            "author": {"name": "u/%s" % author, "headline": ("in r/%s" % sub) if sub else "on Reddit",
                       "url": "https://www.reddit.com/user/%s/" % author, "key": "reddit/%s" % author.lower(),
                       "company": False},
            "subreddit": sub, "reactions": (post.get("metrics") or {}).get("likes") or 0,
            "comments": (post.get("metrics") or {}).get("comments") or 0, "query": query, "social_id": ""}


def collect(queries, *, per_query=25, search=None):
    """The last month's threads for every query, each once. Never raises: {"posts", "notes"}."""
    from . import sci_reddit_client as rc
    search = search or rc.search_posts
    out, seen = {"posts": [], "notes": []}, set()
    for q in queries:
        try:
            got = search(q, sort="new", time_filter="month", limit=per_query)
        except Exception as e:      # the client returns [] on its own failures; anything else is noted
            out["notes"].append("The Reddit search “%s” failed (%s)." % (q[:60], type(e).__name__))
            continue
        for item in got or []:
            p = normalize(item, q)
            if p and p["key"] not in seen:
                seen.add(p["key"])
                out["posts"].append(p)
    return out
