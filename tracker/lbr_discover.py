"""Local Business Radar, stage 1: find every business of the kind in the area.

Google's Text Search returns at most 60 places per query (20 per page, three
pages; see PLACES docs in lbr_config). A single search for "dentist" over a
city therefore sees a fraction of its dentists. Discovery covers the area
with a quadtree instead:

  1. search the whole area;
  2. any tile that comes back full (60 places) may hold more, so it is split
     into four and each quarter is searched;
  3. repeat until no tile is full, a tile is too small to split, or the
     run's request budget (lbr_intake.DISCOVERY_REQUESTS) is spent.

Sparse ground costs one request; a dense downtown is split as finely as it
needs. When the budget runs out first, coverage is reported as partial with
the number of tiles that were still full, never presented as complete.

Each search asks for the Enterprise fields (website, phone, hours, rating,
review count) directly, so one request profiles up to 20 businesses and no
per-business Place Details call is needed.

Then: duplicates are merged (the same place in overlapping tiles), closed
businesses dropped, a state or county run is held to its own borders, and
chains are set aside (a franchise location buys its marketing centrally).
Finally the businesses to research in depth are chosen, up to the run's cap,
most promising first for what the user wants to sell.
"""

import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

from tracker import lbr_config, lbr_http

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
PAGE_SIZE = 20
MAX_PAGES = 3                 # Google's own ceiling: 60 places per query
MIN_TILE_DEG = 0.004          # about 440 m of latitude; a tile this small is not split
MAX_DEPTH = 10
WORKERS = 4

FIELDS = ["id", "displayName", "formattedAddress", "location", "types", "primaryType",
          "primaryTypeDisplayName", "businessStatus", "googleMapsUri", "websiteUri",
          "nationalPhoneNumber", "internationalPhoneNumber", "regularOpeningHours", "rating",
          "userRatingCount", "priceLevel", "addressComponents", "pureServiceAreaBusiness", "photos"]
FIELD_MASK = ",".join(["places." + f for f in FIELDS] + ["nextPageToken"])


# ── Tiles ────────────────────────────────────────────────────────────────────
def _tile(low_lat, low_lng, high_lat, high_lng, depth=0):
    return {"low": {"lat": low_lat, "lng": low_lng}, "high": {"lat": high_lat, "lng": high_lng},
            "depth": depth}


def split(tile):
    """The four quarters of a tile."""
    lo, hi, d = tile["low"], tile["high"], tile["depth"] + 1
    mlat, mlng = (lo["lat"] + hi["lat"]) / 2, (lo["lng"] + hi["lng"]) / 2
    return [_tile(lo["lat"], lo["lng"], mlat, mlng, d), _tile(lo["lat"], mlng, mlat, hi["lng"], d),
            _tile(mlat, lo["lng"], hi["lat"], mlng, d), _tile(mlat, mlng, hi["lat"], hi["lng"], d)]


def can_split(tile):
    return (tile["depth"] < MAX_DEPTH and
            tile["high"]["lat"] - tile["low"]["lat"] > MIN_TILE_DEG * 2 and
            abs(tile["high"]["lng"] - tile["low"]["lng"]) > MIN_TILE_DEG * 2)


def _restriction(tile):
    return {"rectangle": {"low": {"latitude": tile["low"]["lat"], "longitude": tile["low"]["lng"]},
                          "high": {"latitude": tile["high"]["lat"], "longitude": tile["high"]["lng"]}}}


# ── One query over one tile ──────────────────────────────────────────────────
class Budget:
    """Requests left for discovery. Reserved before a tile is searched."""

    def __init__(self, requests):
        self.left = int(requests)
        self._lock = threading.Lock()

    def take(self, n):
        with self._lock:
            if self.left < n:
                return False
            self.left -= n
            return True

    def give_back(self, n):
        with self._lock:
            self.left += n


def search_tile(tile, spec, ledger, key, budget):
    """Up to three pages of one query over one tile.

    Returns (places, full): `full` is True when Google had at least as many
    places as it will return for one query, so the tile may hold more.
    Reserves three requests up front and returns what it did not use.
    """
    if not budget.take(MAX_PAGES):
        return None, False
    used, places, token = 0, [], None
    body = {"textQuery": spec["query"], "pageSize": PAGE_SIZE,
            "locationRestriction": _restriction(tile)}
    if spec.get("type"):
        body["includedType"] = spec["type"]
        body["strictTypeFiltering"] = True
    if spec.get("service_area"):
        body["includePureServiceAreaBusinesses"] = True
    try:
        for page in range(MAX_PAGES):
            req = dict(body, pageToken=token) if token else body
            headers = {"X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELD_MASK}
            try:
                used += 1
                data = lbr_http.call(ledger, "places", "text_search", "POST", SEARCH_URL, json_body=req,
                                     headers=headers, price_op="places.text_search_enterprise")
            except lbr_http.ToolError as exc:
                # A fresh page token can need a moment before Google accepts
                # it. One more try, paid from the budget like any request.
                if not (token and exc.status == 400 and budget.take(1)):
                    raise
                time.sleep(1.5)
                data = lbr_http.call(ledger, "places", "text_search", "POST", SEARCH_URL, json_body=req,
                                     headers=headers, price_op="places.text_search_enterprise")
            places.extend(data.get("places") or [])
            token = data.get("nextPageToken")
            if not token:
                break
    finally:
        budget.give_back(max(0, MAX_PAGES - used))
    full = len(places) >= PAGE_SIZE * MAX_PAGES or bool(token)
    return places, full


# ── What one place tells us ──────────────────────────────────────────────────
def _comp(p, t, field="longText"):
    for c in p.get("addressComponents") or []:
        if t in (c.get("types") or []):
            return c.get(field) or ""
    return ""


def normalise(p):
    """The profile fields the agent uses, from one Places result."""
    loc = p.get("location") or {}
    hours = p.get("regularOpeningHours") or {}
    return {
        "name": (p.get("displayName") or {}).get("text") or "",
        "address": p.get("formattedAddress") or "",
        "lat": loc.get("latitude"), "lng": loc.get("longitude"),
        "types": p.get("types") or [],
        "primary_type": p.get("primaryType") or "",
        "category": (p.get("primaryTypeDisplayName") or {}).get("text") or "",
        "status": p.get("businessStatus") or "",
        "maps_url": p.get("googleMapsUri") or "",
        "website": p.get("websiteUri") or "",
        "phone": p.get("nationalPhoneNumber") or "",
        "phone_intl": p.get("internationalPhoneNumber") or "",
        "hours": list(hours.get("weekdayDescriptions") or []),
        "rating": p.get("rating"),
        "reviews": int(p.get("userRatingCount") or 0),
        "price_level": p.get("priceLevel") or "",
        # Google returns at most ten photo references, so this is "up to 10".
        "photos_seen": len(p.get("photos") or []),
        "service_area_only": bool(p.get("pureServiceAreaBusiness")),
        "locality": _comp(p, "locality"), "admin2": _comp(p, "administrative_area_level_2"),
        "admin1": _comp(p, "administrative_area_level_1", "shortText"),
        "postcode": _comp(p, "postal_code"),
    }


# ── Chains ───────────────────────────────────────────────────────────────────
# National and regional brands whose locations buy marketing centrally. A
# location of one is set aside, not pitched. Matched on the normalised name
# (whole words, from the start) or the website's registered domain.
KNOWN_CHAINS = {
    "aspen dental", "western dental", "bright now dental", "coast dental",
    "monarch dental", "castle dental", "kool smiles", "smile brands", "clearchoice",
    "great clips", "supercuts", "sport clips", "fantastic sams", "cost cutters", "hair cuttery",
    "regis salon", "ulta beauty", "european wax center", "massage envy", "hand stone",
    "jiffy lube", "midas", "meineke", "firestone", "pep boys", "valvoline", "take 5 oil change",
    "goodyear", "discount tire", "big o tires", "les schwab", "christian brothers automotive",
    "maaco", "caliber collision", "service king", "gerber collision",
    "roto rooter", "mr rooter", "mister sparky", "one hour heating", "benjamin franklin plumbing",
    "ars rescue rooter", "terminix", "orkin", "truly nolen", "two men and a truck",
    "merry maids", "molly maid", "the maids", "servpro", "servicemaster", "stanley steemer",
    "h r block", "jackson hewitt", "liberty tax", "the ups store", "fedex office",
    "state farm", "allstate", "farmers insurance", "edward jones", "keller williams", "re max",
    "remax", "coldwell banker", "century 21", "berkshire hathaway homeservices", "exp realty",
    "planet fitness", "anytime fitness", "orangetheory", "la fitness", "24 hour fitness",
    "gold s gym", "crunch fitness", "snap fitness", "f45 training", "pure barre", "club pilates",
    "banfield", "vca", "bluepearl", "petco", "petsmart", "starbucks", "dunkin", "mcdonald s",
    "subway", "chick fil a", "taco bell", "wendy s", "burger king", "domino s", "pizza hut",
    "papa john s", "little caesars", "chipotle", "panera", "walgreens", "cvs", "rite aid",
    "minuteclinic", "concentra", "carenow", "fastmed",
    "kumon", "mathnasium", "sylvan learning", "huntington learning", "kindercare",
    "primrose school", "the goddard school", "la petite academy", "the learning experience",
    "marriott", "hilton", "holiday inn", "hampton inn", "best western", "motel 6", "la quinta",
    "comfort inn", "days inn", "super 8", "red roof",
}
KNOWN_CHAIN_DOMAINS = {
    "aspendental.com", "westerndental.com", "brightnow.com", "greatclips.com", "supercuts.com",
    "sportclips.com", "jiffylube.com", "midas.com", "meineke.com", "firestonecompleteautocare.com",
    "pepboys.com", "valvoline.com", "discounttire.com", "rotorooter.com", "mrrooter.com",
    "mistersparky.com", "onehourheatandair.com", "terminix.com", "orkin.com",
    "twomenandatruck.com", "merrymaids.com", "mollymaid.com", "servpro.com", "hrblock.com",
    "jacksonhewitt.com", "theupsstore.com", "statefarm.com", "allstate.com", "edwardjones.com",
    "kw.com", "remax.com", "coldwellbanker.com", "century21.com", "planetfitness.com",
    "anytimefitness.com", "orangetheory.com", "lafitness.com", "massageenvy.com",
    "handandstone.com", "waxcenter.com", "banfield.com", "vcahospitals.com", "petco.com",
    "petsmart.com", "starbucks.com", "walgreens.com", "cvs.com", "kumon.com", "mathnasium.com",
    "kindercare.com", "primroseschools.com", "goddardschool.com", "marriott.com", "hilton.com",
    "ihg.com", "bestwestern.com", "motel6.com", "caliber.com", "maaco.com", "ulta.com",
}
# Hosts that are not the business's own website: the domain says nothing
# about the business, so two businesses sharing one is not a chain.
SHARED_HOSTS = {"facebook.com", "instagram.com", "linktr.ee", "business.site", "google.com",
                "sites.google.com", "yelp.com", "wixsite.com", "squarespace.com", "godaddysites.com",
                "square.site", "weebly.com", "wordpress.com", "blogspot.com", "tiktok.com",
                "x.com", "twitter.com", "youtube.com", "nextdoor.com", "angi.com", "homeadvisor.com",
                "thumbtack.com", "vagaro.com", "booksy.com", "schedulicity.com", "zocdoc.com",
                "healthgrades.com", "opentable.com", "toasttab.com", "doordash.com", "ubereats.com",
                "grubhub.com", "linkedin.com", "mindbodyonline.com", "calendly.com"}

_SUFFIX = re.compile(r"\b(llc|l\.l\.c|inc|incorporated|co|corp|corporation|ltd|pllc|pc|p\.c|dds|dmd|"
                     r"md|pa|p\.a|and associates|& associates)\b\.?", re.I)


def name_key(name):
    """A name reduced to what identifies the brand: no location suffix, no legal form."""
    n = (name or "").lower()
    n = re.split(r"\s+[-|–—:]\s+|\s+\(", n)[0]           # "Smile Co - North Austin" -> "smile co"
    n = _SUFFIX.sub(" ", n)
    n = re.sub(r"[^a-z0-9]+", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def site_domain(url):
    """The registered part of a website's host (www and subdomains dropped)."""
    try:
        host = (urlparse(url if "//" in url else "https://" + url).hostname or "").lower()
    except ValueError:
        return ""
    host = host[4:] if host.startswith("www.") else host
    parts = host.split(".")
    if len(parts) >= 3 and len(parts[-1]) == 2 and parts[-2] in ("co", "com", "org", "net", "ac", "gov"):
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def _known_chain(key, domain):
    if domain and domain in KNOWN_CHAIN_DOMAINS:
        return True
    return any(key == c or key.startswith(c + " ") for c in KNOWN_CHAINS)


def mark_chains(profiles):
    """Set `chain` (set aside) and `locations` (how many share its brand here).

    A known brand is a chain wherever it appears. Otherwise three or more
    locations sharing a name, or a website domain that is the business's own,
    in this one run make a chain; two make a small multi-location business,
    which is still pitched. "X of <place>" is deliberately NOT folded into X:
    three unrelated "Law Office of <name>" firms would become one chain.
    """
    by_name, by_domain = {}, {}
    for pid, prof in profiles.items():
        prof["_key"] = name_key(prof["name"])
        d = site_domain(prof["website"]) if prof["website"] else ""
        prof["_domain"] = d if d and d not in SHARED_HOSTS else ""
        by_name.setdefault(prof["_key"], []).append(pid)
        if prof["_domain"]:
            by_domain.setdefault(prof["_domain"], []).append(pid)
    for pid, prof in profiles.items():
        n = len(by_name.get(prof["_key"], []))
        d = len(by_domain.get(prof["_domain"], [])) if prof["_domain"] else 0
        prof["locations"] = max(n, d, 1)
        known = _known_chain(prof["_key"], prof["_domain"])
        prof["chain"] = bool(known or prof["locations"] >= 3)
        prof["chain_reason"] = ("known brand" if known else
                                "%d locations in this area" % prof["locations"] if prof["chain"] else "")
        prof.pop("_key")
        prof.pop("_domain")
    return profiles


# ── Which to research ────────────────────────────────────────────────────────
SOCIAL_ONLY = ("facebook.com", "instagram.com", "linktr.ee", "tiktok.com", "x.com", "twitter.com",
               "yelp.com", "nextdoor.com")


def triage(prof, focus):
    """A quick 0-100 read of how promising a business looks, from discovery alone.

    Only chooses which businesses get the paid deep research when there are
    more than the cap; the report's scores come from the full audit (stage 7).
    """
    site = (prof.get("website") or "").lower()
    no_site = not site
    weak_site = site and any(h in site for h in SOCIAL_ONLY + ("business.site",))
    rating = prof.get("rating")
    reviews = prof.get("reviews") or 0
    s = {"website": 100 if no_site else 80 if weak_site else 10,
         "reputation": (60 if rating is None else max(0, min(100, (4.7 - rating) * 60 + 20)))
                       + (20 if reviews < 25 else 0),
         "seo": 40 + (25 if reviews < 50 else 0) + (20 if prof.get("hours") == [] else 0)
                + (15 if prof.get("photos_seen", 0) < 5 else 0),
         "paid": 50 + (25 if site and not weak_site else 0),
         "creatives": 40 + (40 if prof.get("photos_seen", 0) < 5 else 0)}
    s = {k: min(100, v) for k, v in s.items()}
    if focus in s:
        base = s[focus]
    else:
        base = 0.35 * s["website"] + 0.25 * s["reputation"] + 0.25 * s["seo"] + 0.15 * s["creatives"]
    # A business with some traction can pay; one with none may not exist next year.
    traction = 10 if reviews >= 15 else 0
    return round(min(100, base * 0.9 + traction))


# ── The whole stage ──────────────────────────────────────────────────────────
def specs_for(business):
    """The queries to run: one per Google category, else one per phrase (at most two)."""
    sab = bool(business.get("service_area"))
    phrase = (business.get("queries") or [business.get("input") or ""])[0]
    if business.get("types"):
        return [{"query": phrase, "type": t, "service_area": sab} for t in business["types"][:2]]
    return [{"query": q, "type": None, "service_area": sab} for q in business["queries"][:2]]


def _in_area(prof, area):
    f = area.get("filter")
    if f == "shape":
        from tracker import lbr_geo
        return lbr_geo.contains(area.get("shape"), prof.get("lat"), prof.get("lng"))
    if f == "admin1":
        return bool(area.get("admin1")) and prof["admin1"] == area["admin1"]
    if f == "admin2":
        return bool(area.get("admin2")) and prof["admin2"] == area["admin2"]
    return True


def discover(plan, ledger, *, on_progress=None, should_stop=None, memo=None):
    """Run stage 1. Returns every business found, and which to research.

    `on_progress(dict)` is told how far it has got; `should_stop()` returning
    True ends the search early (a cancelled run) with coverage "stopped".
    """
    # The plan fixes the source, so a run resumed after a config change keeps its own.
    if (plan.get("estimate") or {}).get("source") == "apify" or plan["area"].get("filter") == "shape":
        return _discover_apify(plan, ledger, on_progress=on_progress, should_stop=should_stop, memo=memo)
    key = lbr_config.key_for("places")
    if not key:
        raise lbr_http.ToolError("places", "Google Places is not configured (GOOGLE_MAPS_API_KEY).")
    area, business = plan["area"], plan["business"]
    vp = area["viewport"]
    budget = Budget(plan["estimate"]["discovery_requests"])
    raw = {}
    full_left = 0
    stopped = False
    searched = 0
    specs = specs_for(business)
    for spec in specs:
        level = [_tile(vp["low"]["lat"], vp["low"]["lng"], vp["high"]["lat"], vp["high"]["lng"])]
        while level:
            if should_stop and should_stop():
                stopped = True
                break
            with ThreadPoolExecutor(max_workers=WORKERS) as pool:
                results = list(pool.map(lambda t: (t, search_tile(t, spec, ledger, key, budget)), level))
            nxt = []
            for tile, (places, full) in results:
                if places is None:          # the budget ran out before this tile
                    full_left += 1
                    continue
                searched += 1
                for p in places:
                    if p.get("id"):
                        raw[p["id"]] = p
                if full:
                    if can_split(tile):
                        nxt.extend(split(tile))
                    else:
                        full_left += 1
            level = nxt
            if on_progress:
                on_progress({"stage": "discover", "tiles_searched": searched, "found": len(raw),
                             "requests_left": budget.left})
        if stopped:
            break

    coverage = "stopped" if stopped else ("partial" if full_left else "complete")
    stats = {"tiles_searched": searched, "tiles_still_full": full_left, "coverage": coverage,
             "requests_used": plan["estimate"]["discovery_requests"] - budget.left}
    return _finish(plan, {pid: normalise(p) for pid, p in raw.items()}, stats)


def _discover_apify(plan, ledger, *, on_progress=None, should_stop=None, memo=None):
    """Stage 1 through Apify's Google Maps Scraper, inside the area's boundary."""
    from tracker import lbr_apify_maps
    if on_progress:
        on_progress({"stage": "discover", "found": 0, "note": "Apify is searching Google Maps"})
    def polled(p):
        if on_progress:
            on_progress(dict(p, stage="discover", found=p.get("places") or 0))
    raw = lbr_apify_maps.search_area(plan, ledger, on_progress=polled, should_stop=should_stop, memo=memo)
    stopped = bool(should_stop and should_stop())
    most = lbr_config.APIFY_DISCOVERY_PLACES.get(plan["area"]["kind"], 800)
    # The Actor stops at maxCrawledPlacesPerSearch; a phrase that reached it may have had more.
    by_phrase = {}
    for it in raw.values():
        by_phrase[it.get("searchString") or ""] = by_phrase.get(it.get("searchString") or "", 0) + 1
    capped = any(n >= most for n in by_phrase.values())
    stats = {"tiles_searched": 0, "tiles_still_full": 0, "requests_used": 0,
             "coverage": "stopped" if stopped else ("partial" if capped else "complete"), "places_limit": most,
             "source": "apify"}
    if on_progress:
        on_progress({"stage": "discover", "found": len(raw)})
    return _finish(plan, {pid: lbr_apify_maps.normalise(it) for pid, it in raw.items()}, stats)


def _finish(plan, normalised, stats):
    """Shared by both sources: drop closed and out-of-area places, set chains aside, pick the research list."""
    area = plan["area"]
    profiles, closed, outside = {}, 0, 0
    for pid, prof in normalised.items():
        if prof["status"] in ("CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"):
            closed += 1
            continue
        if not _in_area(prof, area):
            outside += 1
            continue
        profiles[pid] = prof
    mark_chains(profiles)
    candidates = [pid for pid, prof in profiles.items() if not prof["chain"]]
    for pid in profiles:
        profiles[pid]["triage"] = triage(profiles[pid], plan.get("focus", "all"))
    candidates.sort(key=lambda pid: (-profiles[pid]["triage"], -profiles[pid]["reviews"], pid))
    selected = candidates[:plan["cap"]]
    return {
        "profiles": profiles, "selected": selected,
        "stats": dict(stats, found=len(normalised), kept=len(profiles), closed=closed, outside_area=outside,
                      chains=sum(1 for p in profiles.values() if p["chain"]),
                      candidates=len(candidates), selected=len(selected)),
    }
