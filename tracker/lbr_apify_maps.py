"""Local Business Radar: Google Maps itself, through Apify's Google Maps Scraper.

When lbr_config.source() is "apify", three stages read Google Maps through
the compass/crawler-google-places Actor (https://apify.com/compass/crawler-google-places)
instead of Google's Places API and SerpAPI. Apify runs the browsers and
proxies; nothing is scraped from this server.

  search_area()  stage 1. Every business matching the search phrases inside
                 the area's OpenStreetMap boundary (customGeolocation). The
                 Actor splits a large area itself, past Google Maps' 120
                 results a screen. One charge per place found; no detail
                 pages, so this is the cheapest pass.

  details()      stage 2. Only the businesses chosen for research, by place
                 ID, with their detail page: claimed or not, opening hours,
                 photo count, the owner's description and posts, review tags,
                 and the newest reviews with the owner's replies. Reviewers'
                 names and profiles are never requested
                 (scrapeReviewsPersonalData: false).

  map_ranks()    stage 5, when SerpAPI is not set. A Google Maps search URL
                 centred on each ~1 km cell; the Actor keeps Google's own
                 order for a single search URL (its README: "the results in
                 the same order as Google would provide"), so a place's
                 position is its map rank there.

Money. Each run carries maxTotalChargeUsd, so Apify itself stops charging at
the run's share of the ceiling, and what it was charged is written to the
ledger at the list prices in lbr_config.PRICES (apify.place, apify.details,
apify.review), counted from what came back.
"""

import re
from urllib.parse import quote

from tracker import apify_transport, lbr_config, lbr_http

ACTOR = "compass/crawler-google-places"
SEARCH_TIMEOUT = 3600
DETAILS_TIMEOUT = 2400
RANK_TIMEOUT = 1800
DETAILS_BATCH = 100
RANK_BATCH = 50


def _token():
    tok = lbr_config.key_for("apify")
    if not tok:
        raise lbr_http.ToolError("apify", "Apify is not configured (APIFY_API_TOKEN).")
    return tok


def _price(op):
    return lbr_config.price(op) or 0.0


def _run(run_input, ledger, op, max_usd, timeout, units_fn):
    """One Actor run: its items, and one ledger line priced from what came back."""
    try:
        items = apify_transport.run_actor_and_wait(ACTOR, run_input, _token(), timeout=timeout,
                                                   strict=True, max_charge_usd=max_usd)
    except apify_transport.ApifyTransportError as exc:
        ledger.add("apify", op, 0, 0.0, ok=False, detail=str(exc)[:200])
        raise lbr_http.ToolError("apify", "Apify's Google Maps Scraper failed: %s" % str(exc)[:200])
    units, usd = units_fn(items)
    ledger.add("apify", op, units, round(usd, 4), ok=True)
    return items


# ── Shapes ───────────────────────────────────────────────────────────────────
def _hours(item):
    out = []
    for h in item.get("openingHours") or []:
        if isinstance(h, dict) and h.get("day"):
            out.append("%s: %s" % (h["day"], h.get("hours") or ""))
    return out


def normalise(item):
    """The profile fields the agent uses, from one Google Maps Scraper item.

    Same keys as lbr_discover.normalise (the Places API shape), so every
    later stage reads either source the same way.
    """
    loc = item.get("location") or {}
    status = ("CLOSED_PERMANENTLY" if item.get("permanentlyClosed") else
              "CLOSED_TEMPORARILY" if item.get("temporarilyClosed") else "OPERATIONAL")
    images = item.get("imagesCount")
    return {
        "name": item.get("title") or "",
        "address": item.get("address") or "",
        "lat": loc.get("lat"), "lng": loc.get("lng"),
        "types": [], "primary_type": "",
        "category": item.get("categoryName") or "",
        "categories": [c for c in (item.get("categories") or []) if isinstance(c, str)],
        "status": status,
        "maps_url": item.get("url") or "",
        "website": item.get("website") or "",
        "phone": item.get("phone") or "",
        "phone_intl": item.get("phoneUnformatted") or "",
        # Opening hours come only with the detail page (stage 2); until then unknown.
        "hours": _hours(item) if "openingHours" in item and item.get("openingHours") is not None else None,
        "rating": item.get("totalScore"),
        "reviews": int(item.get("reviewsCount") or 0),
        "price_level": item.get("price") or "",
        "photos_seen": images if isinstance(images, int) else 0,
        "service_area_only": not (item.get("address") or item.get("street")),
        "locality": item.get("city") or "", "admin2": "",
        "admin1": item.get("state") or "", "postcode": item.get("postalCode") or "",
        "source": "apify",
    }


def _review(r, idx):
    reply = (r.get("responseFromOwnerText") or "").strip()
    return {"id": "r%d" % idx, "rating": r.get("stars"),
            "text": (r.get("text") or r.get("textTranslated") or "").strip(),
            "date": r.get("publishedAtDate") or "", "when": r.get("publishAt") or "",
            "likes": r.get("likesCount") or 0,
            "reply": {"date": r.get("responseFromOwnerDate") or "", "text": reply} if reply else None}


# ── Stage 1: every business in the area ──────────────────────────────────────
def search_input(plan):
    business, area = plan["business"], plan["area"]
    phrases = [q for q in (business.get("queries") or [business.get("input") or ""]) if q][:2]
    cap = lbr_config.APIFY_DISCOVERY_PLACES.get(area["kind"], 800)
    return {
        "searchStringsArray": phrases,
        "customGeolocation": area["shape"],
        "maxCrawledPlacesPerSearch": cap,
        "language": "en",
        "scrapePlaceDetailPage": False,
        "maxReviews": 0, "maxImages": 0, "maxQuestions": 0,
        "scrapeContacts": False, "maximumLeadsEnrichmentRecords": 0,
        "scrapeReviewsPersonalData": False,
        "skipClosedPlaces": False,
        "website": "allPlaces", "searchMatching": "all",
    }


def search_area(plan, ledger):
    """{place_id: raw item} for everything the Actor found (all phrases merged)."""
    run_input = search_input(plan)
    most = len(run_input["searchStringsArray"]) * run_input["maxCrawledPlacesPerSearch"]
    max_usd = most * _price("apify.place")
    items = _run(run_input, ledger, "maps_search", max_usd, SEARCH_TIMEOUT,
                 lambda xs: (len(xs), len(xs) * _price("apify.place")))
    out = {}
    for it in items:
        pid = it.get("placeId")
        if pid and pid not in out:
            out[pid] = it
    return out


# ── Stage 2: the researched businesses, opened ───────────────────────────────
def _latest_post_days(updates):
    from tracker import lbr_profile
    return lbr_profile._latest_post_days(updates)


def details(place_ids, ledger, *, should_stop=None, max_reviews=None):
    """{place_id: {"extra", "profile", "reviews", "topics"}} for each place opened."""
    max_reviews = lbr_config.APIFY_MAX_REVIEWS if max_reviews is None else max_reviews
    out = {}
    per_place = _price("apify.place") + _price("apify.details") + max_reviews * _price("apify.review")

    def units(xs):
        n_rev = sum(len(x.get("reviews") or []) for x in xs)
        return len(xs), len(xs) * (_price("apify.place") + _price("apify.details")) + n_rev * _price("apify.review")

    for i in range(0, len(place_ids), DETAILS_BATCH):
        if should_stop and should_stop():
            break
        batch = place_ids[i:i + DETAILS_BATCH]
        run_input = {"placeIds": batch, "language": "en", "scrapePlaceDetailPage": True,
                     "maxReviews": max_reviews, "reviewsSort": "newest", "reviewsOrigin": "google",
                     "scrapeReviewsPersonalData": False, "maxImages": 0, "maxQuestions": 0,
                     "scrapeContacts": False, "maximumLeadsEnrichmentRecords": 0}
        try:
            items = _run(run_input, ledger, "place_details", len(batch) * per_place, DETAILS_TIMEOUT, units)
        except lbr_http.ToolError:
            continue            # recorded; these businesses keep "not checked" findings
        for it in items:
            pid = it.get("placeId")
            if not pid or pid not in batch:
                continue
            entry = out.setdefault(pid, {"reviews": []})
            claim = it.get("claimThisBusiness")
            entry["extra"] = {
                "claimed": None if claim is None else not bool(claim),
                "images": it.get("imagesCount") if isinstance(it.get("imagesCount"), int) else None,
                "posts": len(it.get("ownerUpdates") or []) if "ownerUpdates" in it else None,
                "post_days": _latest_post_days(it.get("ownerUpdates")),
                "description": (it.get("description") or "").strip() if "description" in it else None,
            }
            entry["profile"] = normalise(it)
            entry["topics"] = [{"keyword": t.get("title"), "mentions": t.get("count")}
                               for t in (it.get("reviewsTags") or []) if isinstance(t, dict) and t.get("title")]
            # The Actor stores a place twice when it has over 5,000 reviews; keep adding.
            entry["reviews"].extend(it.get("reviews") or [])
    for entry in out.values():
        entry["reviews"] = [_review(r, n) for n, r in enumerate(entry["reviews"][:max_reviews], 1)]
        entry.setdefault("extra", {})
        entry.setdefault("topics", [])
    return out


# ── Stage 5: map rank, seen from each cell ───────────────────────────────────
_AT = re.compile(r"@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)")
MATCH_DEG = 0.02            # a loaded search page may drift a little from the URL asked for


def _cell_of(item, urls, points):
    """Which cell's search an item came from: its search URL, else the nearest centre."""
    for key in (item.get("searchPageUrl"), item.get("searchPageLoadedUrl")):
        if key and key in urls:
            return urls[key]
    for key in (item.get("searchPageUrl"), item.get("searchPageLoadedUrl")):
        m = _AT.search(key or "")
        if m:
            lat, lng = float(m.group(1)), float(m.group(2))
            best = min(points, key=lambda p: (p[1] - lat) ** 2 + (p[2] - lng) ** 2)
            if abs(best[1] - lat) <= MATCH_DEG and abs(best[2] - lng) <= MATCH_DEG:
                return best[0]
    return None
def search_url(query, lat, lng):
    return "https://www.google.com/maps/search/%s/@%.6f,%.6f,14z?hl=en" % (quote(query), lat, lng)


def map_ranks(query, points, ledger, *, should_stop=None):
    """{cell: [{"position", "place_id", "title", "rating", "reviews"}]} for each (cell, lat, lng)."""
    depth = lbr_config.APIFY_RANK_DEPTH
    out = {}
    for i in range(0, len(points), RANK_BATCH):
        if should_stop and should_stop():
            break
        batch = points[i:i + RANK_BATCH]
        urls = {search_url(query, lat, lng): cell for cell, lat, lng in batch}
        run_input = {"startUrls": [{"url": u} for u in urls], "maxCrawledPlacesPerSearch": depth,
                     "language": "en", "scrapePlaceDetailPage": False, "maxReviews": 0, "maxImages": 0,
                     "scrapeReviewsPersonalData": False, "scrapeContacts": False,
                     "maximumLeadsEnrichmentRecords": 0}
        try:
            items = _run(run_input, ledger, "maps_rank", len(urls) * depth * _price("apify.place"),
                         RANK_TIMEOUT, lambda xs: (len(xs), len(xs) * _price("apify.place")))
        except lbr_http.ToolError as exc:
            for cell in urls.values():
                out[cell] = {"error": str(exc)}
            continue
        grouped = {}
        for it in items:
            cell = _cell_of(it, urls, batch)
            if cell is not None:
                grouped.setdefault(cell, []).append(it)
        for cell in urls.values():
            rows = [r for r in grouped.get(cell, []) if not r.get("isAdvertisement")]
            if not rows:
                out[cell] = {"error": "No map results came back for this search."}
                continue
            rows.sort(key=lambda r: r.get("rank") if isinstance(r.get("rank"), int) else 10 ** 6)
            out[cell] = [{"position": n, "place_id": r.get("placeId"), "title": r.get("title"),
                          "rating": r.get("totalScore"), "reviews": r.get("reviewsCount")}
                         for n, r in enumerate(rows, 1)]
    return out
