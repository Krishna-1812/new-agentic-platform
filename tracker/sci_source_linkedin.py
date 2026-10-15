"""LinkedIn adapter for Social Media Intelligence, through Apify.

LinkedIn is the platform most exposed to scraping detection, so it keeps a kill switch the others do
not have: set SCI_APIFY_LINKEDIN_ACTOR_ID to off (or none, disabled, 0, false) and actor_id() returns
None, which sci_pipeline treats as "this platform is disabled" rather than a transport failure. It then
never calls apify_transport at all, so there is no retry storm against a fragile actor, and switching
LinkedIn off needs no deploy. Set it to another actor id and that actor is used instead (its input and
output must match build_input / normalize below). Unset, the default actor is used.

The default, harvestapi/linkedin-company-posts, needs no LinkedIn cookies or account, takes company
page URLs, and is billed per post it returns (about $2 per 1,000 posts, so a 25-post read is about
5 cents). A connected Unipile account, when there is one, is still tried first (sci_pipeline).
"""

from __future__ import annotations

import logging
import os

from tracker import apify_transport

logger = logging.getLogger(__name__)

PLATFORM = "linkedin"


DEFAULT_ACTOR_ID = "harvestapi/linkedin-company-posts"
_OFF = {"off", "none", "disabled", "0", "false", "no"}


def actor_id() -> str | None:
    raw = (os.environ.get("SCI_APIFY_LINKEDIN_ACTOR_ID") or "").strip()
    if raw.lower() in _OFF:
        return None
    return raw or DEFAULT_ACTOR_ID


def build_input(handle: str, max_posts: int = 25) -> dict:
    url = handle if handle.startswith("http") else f"https://www.linkedin.com/company/{handle.lstrip('@')}/"
    return {
        "targetUrls": [url],
        "maxPosts": max_posts,
        # Reactions and comments are billed as extra items; the report reads the posts only.
        "scrapeReactions": False,
        "scrapeComments": False,
    }


def _url_of(entry):
    if isinstance(entry, dict):
        return entry.get("url") or entry.get("src") or entry.get("videoUrl")
    return entry if isinstance(entry, str) else None


def _video_url(item: dict):
    for key in ("postVideo", "video", "videoUrl"):
        url = _url_of(item.get(key))
        if url:
            return url
    return None


def _image_urls(item: dict) -> list:
    out = []
    for img in item.get("postImages") or item.get("images") or item.get("imageUrls") or []:
        u = _url_of(img)
        if u:
            out.append(u)
    # A document post (a PDF carousel) is shown as its cover pages.
    doc = item.get("document")
    if isinstance(doc, dict):
        for page in doc.get("coverPages") or []:
            if isinstance(page, dict):
                out += [u for u in (page.get("imageUrls") or []) if isinstance(u, str)]
    return out


def _post_type(item: dict) -> str:
    if _video_url(item):
        return "video"
    images = _image_urls(item)
    if len(images) > 1:
        return "carousel"
    return "image" if images else "text"


def _media_urls(item: dict) -> list:
    urls = []
    video = _video_url(item)
    if video:
        urls.append(video)
    urls += _image_urls(item)
    return urls


def _posted_at(item: dict):
    posted = item.get("postedAt")
    if isinstance(posted, dict):
        return posted.get("date") or posted.get("timestamp")
    return posted or item.get("publishedAt") or item.get("date")


def _count(item: dict, *names):
    engagement = item.get("engagement") if isinstance(item.get("engagement"), dict) else {}
    for name in names:
        for source in (engagement, item):
            if source.get(name) is not None:
                return source[name]
    return None


def normalize(raw_items: list[dict]) -> list[dict]:
    out = []
    for item in raw_items or []:
        if not isinstance(item, dict):
            continue
        # The actor can also return a post's reactions and comments as items of their own.
        if item.get("type") not in (None, "post", "repost", "quote"):
            continue
        pid = str(item.get("id") or item.get("postId") or item.get("urn") or "").strip()
        if not pid:
            continue
        out.append({
            "platform_post_id": pid,
            "post_url": item.get("linkedinUrl") or item.get("postUrl") or item.get("url"),
            "post_type": _post_type(item),
            "caption": item.get("content") or item.get("text") or item.get("commentary") or "",
            "posted_at": _posted_at(item),
            "media_urls": _media_urls(item),
            "metrics": {
                "likes": _count(item, "likes", "numLikes", "likesCount"),
                "comments": _count(item, "comments", "numComments", "commentsCount"),
                "shares": _count(item, "shares", "numShares", "sharesCount"),
            },
            "raw": item,
        })
    return out


def collect(handle: str, token: str, max_posts: int = 25, strict: bool = True) -> list[dict]:
    """Only ever called by sci_pipeline after it has confirmed actor_id() is
    not None -- see sci_pipeline._collect_linkedin. Assumes a real actor id."""
    raw_items = apify_transport.run_actor_and_wait(
        actor_id(), build_input(handle, max_posts), token, strict=strict)
    return normalize(raw_items)
