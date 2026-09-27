"""Local Business Radar, stage 5: how visible each business is, and against whom.

Map rank
    Where the business appears when someone near it searches Google Maps for
    the category ("dentist"), read from SerpAPI's Google Maps engine with the
    map centred on the business at zoom 14 (a few kilometres across). The
    top three is the "map pack" customers actually see. Businesses within
    about a kilometre of each other share one search: the same street sees
    the same results, and it halves the cost in a dense downtown.

Paid search
    Whether the business's own domain has ads in Google's Ads Transparency
    Center (SerpAPI's google_ads_transparency_center engine), and whether
    any ran in the last 30 days. Only businesses with a working website of
    their own are checked: without one there is no domain to look up.

The local market (no outside calls)
    From every business the run found: the median rating and review count,
    and each business's standing against them. "You have 18 reviews; the
    typical dentist near you has 140" is a pitch line; it has to be true.
"""

import statistics
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from tracker import lbr_config, lbr_discover, lbr_http

SERP_URL = "https://serpapi.com/search.json"
ZOOM = "14z"
CELL = 2              # decimal places a vantage point is rounded to (~1.1 km of latitude)
WORKERS = 6
ACTIVE_DAYS = 30


def _cell(lat, lng):
    return (round(lat, CELL), round(lng, CELL))


def map_search(query, lat, lng, ledger, gl=None):
    """The first page of Google Maps results for `query` seen from (lat, lng)."""
    key = lbr_config.key_for("serpapi")
    params = {"engine": "google_maps", "type": "search", "q": query, "ll": "@%.6f,%.6f,%s" % (lat, lng, ZOOM),
              "hl": "en", "api_key": key}
    if gl:
        params["gl"] = gl.lower()
    data = lbr_http.call(ledger, "serpapi", "maps_rank", "GET", SERP_URL, params=params,
                         price_op="serpapi.search", timeout=40)
    return [{"position": r.get("position"), "place_id": r.get("place_id"), "title": r.get("title"),
             "rating": r.get("rating"), "reviews": r.get("reviews")}
            for r in (data.get("local_results") or [])]


def rank_in(results, place_id):
    for r in results:
        if r.get("place_id") == place_id:
            return r.get("position")
    return None


def ads(domain, ledger):
    """Whether a domain advertises on Google, from the Ads Transparency Center."""
    key = lbr_config.key_for("serpapi")
    data = lbr_http.call(ledger, "serpapi", "ads_transparency", "GET", SERP_URL,
                         params={"engine": "google_ads_transparency_center", "text": domain, "num": 20,
                                 "api_key": key},
                         price_op="serpapi.search", timeout=40)
    creatives = data.get("ad_creatives") or []
    now = datetime.now(timezone.utc).timestamp()
    last = [c.get("last_shown") for c in creatives if isinstance(c.get("last_shown"), (int, float))]
    total = (data.get("search_information") or {}).get("total_results")
    return {"creatives": total if isinstance(total, int) else len(creatives),
            "active": any(now - t <= ACTIVE_DAYS * 86400 for t in last),
            "last_seen_days": int((now - max(last)) / 86400) if last else None,
            "formats": sorted({c.get("format") for c in creatives if c.get("format")})}


def market(profiles):
    """Medians across every business found (chains included: they are the competition)."""
    ratings = [p["rating"] for p in profiles.values() if isinstance(p.get("rating"), (int, float))]
    counts = [p.get("reviews") or 0 for p in profiles.values()]
    sites = sum(1 for p in profiles.values() if p.get("website"))
    return {"businesses": len(profiles),
            "median_rating": round(statistics.median(ratings), 2) if ratings else None,
            "median_reviews": int(statistics.median(counts)) if counts else 0,
            "top_quartile_reviews": int(statistics.quantiles(counts, n=4)[2]) if len(counts) >= 4 else None,
            "with_website_pct": round(100 * sites / len(profiles)) if profiles else None}


def standing(prof, mkt):
    """One business against the local market."""
    out = {}
    if mkt.get("median_reviews") is not None:
        out["reviews_vs_median"] = (prof.get("reviews") or 0) - mkt["median_reviews"]
    if mkt.get("median_rating") is not None and isinstance(prof.get("rating"), (int, float)):
        out["rating_vs_median"] = round(prof["rating"] - mkt["median_rating"], 2)
    return out


def run(selected, profiles, plan, ledger, *, websites=None, on_progress=None, should_stop=None):
    """Map rank, ads and market standing for every selected business. {place_id: finding}"""
    websites = websites or {}
    ids = [pid for pid in selected if pid in profiles]
    query = (plan["business"].get("queries") or [plan["business"].get("input")])[0]
    gl = (plan.get("area") or {}).get("country") or None
    mkt = market(profiles)
    have_serp = bool(lbr_config.key_for("serpapi"))

    # One map search per ~1 km cell.
    cells = {}
    for pid in ids:
        p = profiles[pid]
        if p.get("lat") is not None and p.get("lng") is not None and not p.get("service_area_only"):
            cells.setdefault(_cell(p["lat"], p["lng"]), []).append(pid)
    seen = {}

    def search_cell(item):
        cell, members = item
        if should_stop and should_stop():
            return cell, None
        lat = sum(profiles[m]["lat"] for m in members) / len(members)
        lng = sum(profiles[m]["lng"] for m in members) / len(members)
        try:
            return cell, map_search(query, lat, lng, ledger, gl)
        except lbr_http.ToolError as exc:
            return cell, {"error": str(exc)}
    if have_serp:
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            for i, (cell, res) in enumerate(pool.map(search_cell, list(cells.items())), 1):
                seen[cell] = res
                if on_progress and i % 10 == 0:
                    on_progress({"stage": "visibility", "done": i, "of": len(cells)})

    # Ads, for businesses with a working site of their own.
    domains = {}
    for pid in ids:
        w = websites.get(pid) or {}
        if w.get("kind") == "ok":
            d = lbr_discover.site_domain(w.get("final_url") or w.get("link") or "")
            if d and d not in lbr_discover.SHARED_HOSTS:
                domains.setdefault(d, []).append(pid)
    ad_by_domain = {}

    def check_ads(d):
        if should_stop and should_stop():
            return d, None
        try:
            return d, ads(d, ledger)
        except lbr_http.ToolError as exc:
            return d, {"error": str(exc)}
    if have_serp and domains:
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            for d, res in pool.map(check_ads, list(domains)):
                ad_by_domain[d] = res

    out = {}
    for pid in ids:
        p = profiles[pid]
        entry = {"market": standing(p, mkt), "rank": None, "in_pack": None, "competitors": [], "ads": None}
        if p.get("service_area_only"):
            entry["rank_note"] = "Service-area business: no storefront to rank from."
        cell = _cell(p["lat"], p["lng"]) if p.get("lat") is not None else None
        res = seen.get(cell)
        if isinstance(res, list):
            pos = rank_in(res, pid)
            entry["rank"] = pos
            entry["in_pack"] = bool(pos and pos <= 3)
            entry["rank_note"] = ("#%d in Google Maps for \"%s\" nearby." % (pos, query) if pos else
                                  "Not in the first %d Google Maps results for \"%s\" nearby." % (len(res), query))
            entry["competitors"] = [r for r in res if r.get("place_id") != pid][:3]
        elif isinstance(res, dict):
            entry["rank_error"] = res["error"]
        w = websites.get(pid) or {}
        d = lbr_discover.site_domain(w.get("final_url") or w.get("link") or "") if w.get("kind") == "ok" else ""
        if d in ad_by_domain:
            entry["ads"] = ad_by_domain[d]
        out[pid] = entry
    return {"businesses": out, "market": mkt, "searches": len(seen), "ad_checks": len(ad_by_domain)}
