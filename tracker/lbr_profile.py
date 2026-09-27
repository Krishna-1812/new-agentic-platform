"""Local Business Radar, stage 2: audit each Google Business Profile.

What a customer sees before they ever reach a website: is there a phone,
opening hours, enough photos, enough reviews at a good enough rating, a
description, recent posts, and has the owner even claimed the profile?

Discovery already carries website, phone, hours, rating, review count and up
to ten photo references (Google's Places API returns no more than ten).
Three things Google's API never returns come from Apify's Google Maps
Scraper when APIFY_API_TOKEN is set:

  claimThisBusiness   true when Google still shows "Claim this business",
                      i.e. the owner has NOT claimed the profile (per the
                      actor's README: false on a claimed listing);
  imagesCount         every photo on the profile, not just the first ten;
  ownerUpdates        the owner's posts (needs scrapePlaceDetailPage);
  description         the owner's own business description.

A check whose data is missing is marked "not checked" and left out of the
score's denominator, never scored as a pass or a fail.
"""

from datetime import datetime, timezone

from tracker import apify_transport, lbr_config

ACTOR = "compass/crawler-google-places"
APIFY_BATCH = 100
APIFY_TIMEOUT = 900

# key, label, weight
CHECKS = [
    ("claimed", "Profile claimed by the owner", 18),
    ("website", "Website linked", 14),
    ("phone", "Phone number", 10),
    ("hours", "Opening hours", 10),
    ("photos", "Photos", 14),
    ("reviews", "Review volume", 12),
    ("rating", "Star rating", 10),
    ("description", "Business description", 6),
    ("posts", "Recent owner posts", 6),
]
LABELS = {k: l for k, l, _ in CHECKS}
WEIGHTS = {k: w for k, _, w in CHECKS}


def _days_ago(value):
    """Days since an ISO date or epoch-ms value, or None."""
    if value in (None, ""):
        return None
    try:
        if isinstance(value, (int, float)):
            dt = datetime.fromtimestamp(value / 1000 if value > 1e11 else value, timezone.utc)
        else:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
    except (ValueError, OverflowError, OSError):
        return None
    return max(0, (datetime.now(timezone.utc) - dt).days)


def _latest_post_days(updates):
    ages = []
    for u in updates or []:
        if not isinstance(u, dict):
            continue
        for k in ("date", "postDate", "postedAt", "publishedAt", "time", "timestamp"):
            d = _days_ago(u.get(k))
            if d is not None:
                ages.append(d)
                break
    return min(ages) if ages else None


def enrich_with_apify(place_ids, ledger, *, should_stop=None):
    """{place_id: extra} for the fields Google's API does not return.

    Returns {} when Apify is not configured; the checks it feeds are then
    "not checked". A batch that fails is recorded and skipped, not retried
    into a loop: its businesses simply have those checks unchecked.
    """
    token = lbr_config.key_for("apify")
    if not token or not place_ids:
        return {}
    out = {}
    # Each place is scraped and opened for its details: two charges per place.
    rate = (lbr_config.price("apify.place") or 0) + (lbr_config.price("apify.details") or 0)
    for i in range(0, len(place_ids), APIFY_BATCH):
        if should_stop and should_stop():
            break
        batch = place_ids[i:i + APIFY_BATCH]
        run_input = {"placeIds": batch, "maxReviews": 0, "maxImages": 0,
                     "scrapePlaceDetailPage": True, "language": "en"}
        try:
            items = apify_transport.run_actor_and_wait(ACTOR, run_input, token,
                                                       timeout=APIFY_TIMEOUT, strict=True)
        except apify_transport.ApifyTransportError as exc:
            ledger.add("apify", "google_maps_places", len(batch), 0.0, ok=False, detail=str(exc)[:200])
            continue
        ledger.add("apify", "google_maps_places", len(items), rate * len(items), ok=True)
        for it in items:
            pid = it.get("placeId")
            if not pid:
                continue
            claim = it.get("claimThisBusiness")
            out[pid] = {
                "claimed": None if claim is None else not bool(claim),
                "images": it.get("imagesCount") if isinstance(it.get("imagesCount"), int) else None,
                "posts": len(it.get("ownerUpdates") or []) if "ownerUpdates" in it else None,
                "post_days": _latest_post_days(it.get("ownerUpdates")),
                "description": (it.get("description") or "").strip() if "description" in it else None,
            }
    return out


def _check(key, status, value, detail):
    return {"key": key, "label": LABELS[key], "status": status, "value": value, "detail": detail,
            "weight": WEIGHTS[key]}


def audit(prof, extra=None):
    """Score one profile 0-100 over the checks that could be made.

    status: "good" (full weight), "weak" (half), "missing" (none) or
    "unknown" (not counted either way).
    """
    extra = extra or {}
    checks = []

    claimed = extra.get("claimed")
    if claimed is None:
        checks.append(_check("claimed", "unknown", None, "Needs Apify to read."))
    elif claimed:
        checks.append(_check("claimed", "good", True, "The owner has claimed it."))
    else:
        checks.append(_check("claimed", "missing", False,
                             "Unclaimed: Google still invites anyone to claim it."))

    site = prof.get("website") or ""
    checks.append(_check("website", "good" if site else "missing", site or None,
                         "Linked from the profile." if site else "No website on the profile."))
    checks.append(_check("phone", "good" if prof.get("phone") else "missing", prof.get("phone") or None,
                         "Listed." if prof.get("phone") else "No phone number on the profile."))
    hours = prof.get("hours") or []
    checks.append(_check("hours", "good" if len(hours) >= 5 else "weak" if hours else "missing",
                         len(hours), "Hours for %d days." % len(hours) if hours else "No opening hours."))

    images = extra.get("images")
    seen = prof.get("photos_seen") or 0
    if images is None and seen >= 10:
        checks.append(_check("photos", "unknown", "10+", "At least 10; the exact count needs Apify."))
    else:
        n = images if images is not None else seen
        status = "good" if n >= 20 else "weak" if n >= 8 else "missing"
        checks.append(_check("photos", status, n, "%d photo%s on the profile." % (n, "" if n == 1 else "s")))

    count = prof.get("reviews") or 0
    checks.append(_check("reviews", "good" if count >= 50 else "weak" if count >= 15 else "missing", count,
                         "%d review%s." % (count, "" if count == 1 else "s")))
    rating = prof.get("rating")
    if rating is None:
        checks.append(_check("rating", "missing", None, "No rating yet."))
    else:
        checks.append(_check("rating", "good" if rating >= 4.5 else "weak" if rating >= 4.0 else "missing",
                             rating, "%.1f stars." % rating))

    desc = extra.get("description")
    if desc is None:
        checks.append(_check("description", "unknown", None, "Needs Apify to read."))
    else:
        checks.append(_check("description", "good" if len(desc) >= 250 else "weak" if desc else "missing",
                             len(desc), "%d characters." % len(desc) if desc else "No business description."))

    posts, days = extra.get("posts"), extra.get("post_days")
    if posts is None:
        checks.append(_check("posts", "unknown", None, "Needs Apify to read."))
    elif not posts:
        checks.append(_check("posts", "missing", 0, "The owner has never posted."))
    elif days is None:
        checks.append(_check("posts", "weak", posts, "%d post(s); dates not shown." % posts))
    else:
        checks.append(_check("posts", "good" if days <= 30 else "weak" if days <= 120 else "missing", days,
                             "Last post %d day%s ago." % (days, "" if days == 1 else "s")))

    known = [c for c in checks if c["status"] != "unknown"]
    total = sum(c["weight"] for c in known)
    got = sum(c["weight"] * {"good": 1.0, "weak": 0.5}.get(c["status"], 0.0) for c in known)
    return {
        "score": round(100 * got / total) if total else None,
        "checks": checks,
        "gaps": [c["key"] for c in known if c["status"] == "missing"],
        "unchecked": [c["key"] for c in checks if c["status"] == "unknown"],
        "claimed": claimed, "photos": images if images is not None else (seen if seen < 10 else None),
    }


def run(selected, profiles, ledger, *, should_stop=None, opened=None):
    """Audit every selected business. Returns {place_id: audit}.

    `opened` is lbr_apify_maps.details() output when Apify is the source: the
    detail pages were already read (with the reviews), so nothing is fetched.
    """
    if opened is not None:
        extra = {pid: o.get("extra") or {} for pid, o in opened.items()}
    else:
        extra = enrich_with_apify(list(selected), ledger, should_stop=should_stop)
    return {pid: audit(profiles[pid], extra.get(pid)) for pid in selected if pid in profiles}
