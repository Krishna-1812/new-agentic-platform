"""Local Business Radar, stage 0: turn two words into a search plan.

    "dentist" + "Austin, TX"  ->  which Google categories to search, which
                                  phrases a customer would type, the exact
                                  area to cover, and the most it can cost.

Business type
    A curated table covers the verticals the agency sells to most. A phrase
    it does not know that is itself a Google category ("thai restaurant" ->
    thai_restaurant) is used directly. Anything else goes to Claude, whose
    answer is checked against Google's own category list (Table A,
    tracker/lbr_place_types.json): a category Google would reject is
    dropped, never sent. Some trades have no Google category at all (HVAC,
    landscaping, cleaning); those are searched by phrase alone.

Location
    Resolved with one Places Text Search. The kind of place Google returns
    decides how the area is searched and filtered: a city or ZIP is covered
    by its viewport, a state by its viewport with every result then checked
    to be inside that state (a state's bounding box overlaps its
    neighbours). A whole country is refused: it is not one market.

Estimate
    The most a run can cost, from the prices in lbr_config and the run's
    hard limits. It is a ceiling the pipeline enforces, not a forecast.
"""

import json
import os
import re
import threading
import time

from tracker import lbr_claude, lbr_config, lbr_geo, lbr_http

PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"

# ── Google's categories ──────────────────────────────────────────────────────
with open(os.path.join(os.path.dirname(__file__), "lbr_place_types.json"), encoding="utf-8") as _f:
    _TYPES_DOC = json.load(_f)
PLACE_TYPES = frozenset(t for ts in _TYPES_DOC["categories"].values() for t in ts)

# ── The verticals the agency sells to most ───────────────────────────────────
# key: what the user typed (normalised); types: Table A categories searched
# (empty when Google has none); queries: the phrases searched; sab: service-
# area businesses, which often have no storefront, so Google must be asked to
# include them.
VERTICALS = [
    ("Dentists", ["dentist", "dentists", "dental", "dental clinic", "dental office", "dentistry"],
     ["dentist", "dental_clinic"], ["dentist"], False),
    ("Orthodontists", ["orthodontist", "orthodontists", "braces"], ["dentist"], ["orthodontist"], False),
    ("Chiropractors", ["chiropractor", "chiropractors", "chiropractic"], ["chiropractor"], ["chiropractor"], False),
    ("Physical therapists", ["physical therapist", "physical therapy", "physiotherapist", "physiotherapy", "pt clinic"],
     ["physiotherapist"], ["physical therapy"], False),
    ("Doctors & clinics", ["doctor", "doctors", "clinic", "medical clinic", "family doctor", "primary care"],
     ["doctor", "medical_clinic"], ["doctor"], False),
    ("Dermatologists", ["dermatologist", "dermatologists", "dermatology"], ["doctor", "skin_care_clinic"],
     ["dermatologist"], False),
    ("Med spas", ["med spa", "medspa", "medical spa", "aesthetics clinic"], ["skin_care_clinic", "spa"],
     ["med spa"], False),
    ("Veterinarians", ["vet", "vets", "veterinarian", "veterinarians", "veterinary", "animal hospital"],
     ["veterinary_care"], ["veterinarian"], False),
    ("Plumbers", ["plumber", "plumbers", "plumbing"], ["plumber"], ["plumber"], True),
    ("Electricians", ["electrician", "electricians", "electrical contractor"], ["electrician"], ["electrician"], True),
    ("HVAC contractors", ["hvac", "hvac contractor", "air conditioning", "ac repair", "heating and cooling",
                          "furnace repair"], [], ["HVAC contractor", "air conditioning repair"], True),
    ("Roofers", ["roofer", "roofers", "roofing", "roofing contractor"], ["roofing_contractor"], ["roofing contractor"], True),
    ("Painters", ["painter", "painters", "house painter", "painting contractor"], ["painter"], ["house painter"], True),
    ("Locksmiths", ["locksmith", "locksmiths"], ["locksmith"], ["locksmith"], True),
    ("Movers", ["mover", "movers", "moving company", "moving"], ["moving_company"], ["moving company"], True),
    ("Landscapers", ["landscaper", "landscapers", "landscaping", "lawn care", "lawn service"], [],
     ["landscaping company", "lawn care service"], True),
    ("Cleaning services", ["cleaning", "cleaners", "cleaning service", "house cleaning", "maid service",
                           "janitorial"], [], ["house cleaning service"], True),
    ("Pest control", ["pest control", "exterminator", "exterminators"], [], ["pest control service"], True),
    ("General contractors", ["general contractor", "contractor", "contractors", "home builder", "remodeling",
                             "remodeler"], [], ["general contractor", "home remodeling"], True),
    ("Auto repair shops", ["auto repair", "car repair", "mechanic", "mechanics", "auto shop", "garage"],
     ["car_repair"], ["auto repair shop"], False),
    ("Auto body shops", ["auto body", "body shop", "collision repair"], ["car_repair"], ["auto body shop"], False),
    ("Car washes", ["car wash", "car washes", "auto detailing", "car detailing"], ["car_wash"], ["car wash"], False),
    ("Tire shops", ["tire shop", "tire shops", "tires"], ["tire_shop"], ["tire shop"], False),
    ("Car dealers", ["car dealer", "car dealers", "car dealership", "auto dealer"], ["car_dealer"], ["car dealership"], False),
    ("Lawyers", ["lawyer", "lawyers", "attorney", "attorneys", "law firm", "law firms"], ["lawyer"], ["law firm"], False),
    ("Accountants", ["accountant", "accountants", "cpa", "accounting", "bookkeeping", "tax preparer"],
     ["accounting"], ["accountant"], False),
    ("Insurance agencies", ["insurance", "insurance agent", "insurance agency"], ["insurance_agency"],
     ["insurance agency"], False),
    ("Real estate agencies", ["real estate", "realtor", "realtors", "real estate agent", "real estate agency"],
     ["real_estate_agency"], ["real estate agency"], False),
    ("Hair salons", ["hair salon", "hair salons", "salon", "salons", "hairdresser"], ["hair_salon", "beauty_salon"],
     ["hair salon"], False),
    ("Barbers", ["barber", "barbers", "barber shop", "barbershop"], ["barber_shop"], ["barber shop"], False),
    ("Nail salons", ["nail salon", "nail salons", "nails", "manicure"], ["nail_salon"], ["nail salon"], False),
    ("Spas & massage", ["spa", "spas", "massage", "day spa", "massage therapist"], ["spa", "massage"], ["spa"], False),
    ("Tattoo studios", ["tattoo", "tattoo shop", "tattoo studio", "tattoo parlor"], ["body_art_service"],
     ["tattoo shop"], False),
    ("Gyms", ["gym", "gyms", "fitness", "fitness center", "health club"], ["gym", "fitness_center"], ["gym"], False),
    ("Yoga studios", ["yoga", "yoga studio", "pilates", "pilates studio"], ["yoga_studio"], ["yoga studio"], False),
    ("Restaurants", ["restaurant", "restaurants", "diner", "eatery"], ["restaurant"], ["restaurant"], False),
    ("Cafés", ["cafe", "cafes", "café", "coffee shop", "coffee shops", "coffee"], ["cafe", "coffee_shop"],
     ["coffee shop"], False),
    ("Bakeries", ["bakery", "bakeries", "cake shop"], ["bakery"], ["bakery"], False),
    ("Bars", ["bar", "bars", "pub", "pubs"], ["bar", "pub"], ["bar"], False),
    ("Caterers", ["caterer", "caterers", "catering"], ["catering_service"], ["catering service"], True),
    ("Florists", ["florist", "florists", "flower shop"], ["florist"], ["florist"], False),
    ("Jewelry stores", ["jeweler", "jewelers", "jewelry", "jewelry store"], ["jewelry_store"], ["jewelry store"], False),
    ("Furniture stores", ["furniture", "furniture store"], ["furniture_store"], ["furniture store"], False),
    ("Pet groomers", ["pet groomer", "dog groomer", "grooming", "pet grooming"], ["pet_care"], ["pet groomer"], False),
    ("Pet boarding", ["dog boarding", "pet boarding", "kennel", "doggy daycare"], ["pet_boarding_service"],
     ["dog boarding"], False),
    ("Daycares", ["daycare", "daycares", "child care", "childcare", "preschool"], ["child_care_agency", "preschool"],
     ["daycare"], False),
    ("Hotels", ["hotel", "hotels", "motel", "inn"], ["hotel", "motel", "inn"], ["hotel"], False),
    ("Wedding venues", ["wedding venue", "wedding venues", "event venue", "banquet hall"],
     ["wedding_venue", "event_venue", "banquet_hall"], ["wedding venue"], False),
    ("Funeral homes", ["funeral home", "funeral homes", "mortuary"], ["funeral_home"], ["funeral home"], False),
    ("Photographers", ["photographer", "photographers", "photography studio"], [], ["photographer"], True),
    ("Tutoring centers", ["tutor", "tutoring", "tutoring center"], [], ["tutoring center"], False),
    ("Driving schools", ["driving school", "driving schools"], [], ["driving school"], False),
    ("Martial arts schools", ["martial arts", "karate", "jiu jitsu", "taekwondo"], ["sports_school"],
     ["martial arts school"], False),
    ("Dance studios", ["dance studio", "dance school", "dance studios"], [], ["dance studio"], False),
    ("Optometrists", ["optometrist", "optometrists", "eye doctor", "optician"], [], ["optometrist"], False),
    ("Pharmacies", ["pharmacy", "pharmacies", "drugstore"], ["pharmacy", "drugstore"], ["pharmacy"], False),
]

FOCUS = ("all", "website", "seo", "paid", "reputation", "creatives")
FOCUS_LABELS = {"all": "Everything", "website": "Website build", "seo": "Local SEO",
                "paid": "Paid media", "reputation": "Reputation", "creatives": "Creatives & social"}


class IntakeError(Exception):
    """Something the user must change before a run can start."""


def _norm(text):
    text = re.sub(r"[^\w\s&'-]", " ", (text or "").lower())
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"^(?:(?:a|an|the|all|local|small|independent)\s+)+", "", text)


_ALIAS = {}
for _label, _aliases, _types, _queries, _sab in VERTICALS:
    for _a in _aliases:
        _ALIAS[_norm(_a)] = {"label": _label, "types": list(_types), "queries": list(_queries),
                             "service_area": _sab, "source": "curated"}


def _singular(t):
    return t[:-1] if t.endswith("s") and not t.endswith("ss") else t


def _clean_types(types):
    return [t for t in dict.fromkeys(types or []) if t in PLACE_TYPES][:3]


_BT_SYSTEM = (
    "You map a kind of local business to Google Places categories. Answer with one JSON object "
    "and nothing else: {\"label\": short plural name, \"types\": up to 3 Google Places Table A "
    "types copied exactly from the list given (empty if none fits well; a wrong category is worse "
    "than none), \"queries\": 1-2 short phrases a customer would type into Google Maps to find "
    "one, \"service_area\": true if these businesses usually travel to the customer and often "
    "have no storefront}. Never invent a type that is not in the list.")


def resolve_business_type(text, ledger):
    """The categories and phrases to search for one business type."""
    raw = (text or "").strip()
    if not (2 <= len(raw) <= 80):
        raise IntakeError("Describe the kind of business in 2 to 80 characters, e.g. \"dentist\".")
    n = _norm(raw)
    hit = _ALIAS.get(n) or _ALIAS.get(_singular(n))
    if hit:
        return dict(hit, input=raw)
    direct = n.replace(" ", "_")
    for cand in (direct, _singular(direct)):
        if cand in PLACE_TYPES:
            return {"label": raw[:1].upper() + raw[1:], "types": [cand], "queries": [raw.lower()],
                    "service_area": False, "source": "google_category", "input": raw}
    if not lbr_config.key_for("claude"):
        return {"label": raw, "types": [], "queries": [raw.lower()], "service_area": False,
                "source": "phrase_only", "input": raw}
    listing = ", ".join(sorted(PLACE_TYPES))
    try:
        obj = lbr_claude.ask_json(_BT_SYSTEM, "Business type: %s\n\nTable A types:\n%s" % (raw, listing),
                                  ledger, max_tokens=400, purpose="business_type",
                                  require=("types", "queries"))
    except lbr_claude.ClaudeError:
        return {"label": raw, "types": [], "queries": [raw.lower()], "service_area": False,
                "source": "phrase_only", "input": raw}
    queries = [str(q).strip()[:60] for q in (obj.get("queries") or []) if str(q).strip()][:2] or [raw.lower()]
    return {"label": str(obj.get("label") or raw).strip()[:60], "types": _clean_types(obj.get("types")),
            "queries": queries, "service_area": bool(obj.get("service_area")), "source": "claude",
            "input": raw}


# ── Location ─────────────────────────────────────────────────────────────────
KIND_BY_TYPE = [
    ("country", "country"),
    ("administrative_area_level_1", "state"),
    ("administrative_area_level_2", "county"),
    ("locality", "city"), ("postal_town", "city"), ("administrative_area_level_3", "city"),
    ("sublocality", "district"), ("sublocality_level_1", "district"), ("neighborhood", "district"),
    ("postal_code", "postcode"),
]
_LOCATION_FIELDS = ",".join("places." + f for f in (
    "id", "displayName", "formattedAddress", "types", "viewport", "location", "addressComponents"))


def _kind(types):
    for t, kind in KIND_BY_TYPE:
        if t in (types or []):
            return kind
    return None


def _component(place, type_name):
    for c in place.get("addressComponents") or []:
        if type_name in (c.get("types") or []):
            return {"long": c.get("longText") or "", "short": c.get("shortText") or ""}
    return None


def resolve_location(text, ledger):
    """The area to search, from what the user typed.

    With Apify as the source the area comes from OpenStreetMap (lbr_geo):
    its real boundary is both the Actor's search area and the filter.
    """
    raw = (text or "").strip()
    if not (2 <= len(raw) <= 120):
        raise IntakeError("Give a city, county, ZIP or state in 2 to 120 characters, e.g. \"Austin, TX\".")
    if lbr_config.source() == "apify":
        try:
            return lbr_geo.resolve(raw, ledger)
        except lbr_geo.GeoError as exc:
            raise IntakeError(str(exc))
    key = lbr_config.key_for("places")
    if not key:
        raise IntakeError("Google Places is not configured (GOOGLE_MAPS_API_KEY), so the area cannot be found.")
    data = lbr_http.call(ledger, "places", "resolve_location", "POST", PLACES_SEARCH_URL,
                         json_body={"textQuery": raw, "pageSize": 5},
                         headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": _LOCATION_FIELDS},
                         price_op="places.text_search_pro")
    places = [p for p in (data.get("places") or []) if _kind(p.get("types"))]
    if not places:
        raise IntakeError("Google could not find a city, county, ZIP or state called \"%s\"." % raw)
    place = places[0]
    kind = _kind(place.get("types"))
    if kind == "country":
        raise IntakeError("A whole country is too large for one run. Pick a state, county or city.")
    vp = place.get("viewport") or {}
    low, high = vp.get("low") or {}, vp.get("high") or {}
    if not all(k in low and k in high for k in ("latitude", "longitude")):
        raise IntakeError("Google returned no boundary for \"%s\"." % raw)
    country = _component(place, "country") or {}
    admin1 = _component(place, "administrative_area_level_1") or {}
    return {
        "input": raw, "place_id": place.get("id"),
        "name": (place.get("displayName") or {}).get("text") or raw,
        "formatted": place.get("formattedAddress") or raw, "kind": kind,
        "viewport": {"low": {"lat": low["latitude"], "lng": low["longitude"]},
                     "high": {"lat": high["latitude"], "lng": high["longitude"]}},
        "center": {"lat": (place.get("location") or {}).get("latitude"),
                   "lng": (place.get("location") or {}).get("longitude")},
        "country": country.get("short", ""), "admin1": admin1.get("short", ""),
        "admin1_name": admin1.get("long", ""),
        # States and counties are filtered to results actually inside them;
        # cities keep their metro (suburbs are the same market) and tag it.
        "filter": {"state": "admin1", "county": "admin2"}.get(kind, "none"),
        "admin2": (_component(place, "administrative_area_level_2") or {}).get("long", ""),
    }


# ── The ceiling ──────────────────────────────────────────────────────────────
# Discovery requests allowed per kind of area; each request covers a tile of
# up to 20 businesses. The pipeline stops splitting tiles at this number.
DISCOVERY_REQUESTS = {"postcode": 30, "district": 40, "city": 90, "county": 160, "state": 420}

# Per researched business, at most: the review pages, one map-rank search,
# one ads search, one Apify place, and two Claude calls sized as below.
CLAUDE_TOKENS_PER_BUSINESS = (9000, 2200)   # (input, output) across themes + pitch, upper bound


def estimate(kind, cap, business_type):
    """The most a run can spend, by provider. Enforced as a budget by the pipeline."""
    queries = max(1, len(business_type.get("types") or []) or len(business_type.get("queries") or []))
    discovery = DISCOVERY_REQUESTS.get(kind, 90) * min(queries, 2)
    serp = lbr_config.MAX_REVIEW_PAGES + 2
    lines = []
    price = lbr_config.price

    def line(provider, what, units, op=None, usd_each=None):
        each = price(op) if op else usd_each
        lines.append({"provider": provider, "what": what, "units": units,
                      "usd": None if each is None else round(units * each, 2)})

    apify_mode = lbr_config.source() == "apify"
    if apify_mode:
        phrases = min(2, len(business_type.get("queries") or []) or 1)
        places = lbr_config.APIFY_DISCOVERY_PLACES.get(kind, 800) * phrases
        discovery = 0
        line("apify", "Google Maps search of the whole area (up to %d places)" % places, places, "apify.place")
        per = (price("apify.place") or 0) + (price("apify.details") or 0) \
            + lbr_config.APIFY_MAX_REVIEWS * (price("apify.review") or 0)
        line("apify", "Each business opened: profile and newest %d reviews" % lbr_config.APIFY_MAX_REVIEWS,
             cap, usd_each=per)
        if lbr_config.key_for("serpapi"):
            line("serpapi", "Map rank and Google Ads (up to 2 per business)", cap * 2, "serpapi.search")
        else:
            line("apify", "Map rank (top %d, up to one search per business)" % lbr_config.APIFY_RANK_DEPTH,
                 cap, usd_each=lbr_config.APIFY_RANK_DEPTH * (price("apify.place") or 0))
    else:
        line("places", "Discovery searches (up to %d)" % discovery, discovery, "places.text_search_enterprise")
        line("serpapi", "Reviews, map rank and ads (up to %d per business)" % serp, cap * serp, "serpapi.search")
    tin, tout = CLAUDE_TOKENS_PER_BUSINESS
    line("claude", "Review themes and pitches", cap,
         usd_each=lbr_config.claude_usd(lbr_config.model(), tin, tout))
    if not apify_mode and lbr_config.key_for("apify"):
        line("apify", "Claimed status, photos, owner posts", cap,
             usd_each=(price("apify.place") or 0) + (price("apify.details") or 0))
    line("pagespeed", "Website speed checks", cap, "pagespeed.run")
    total = round(sum(l["usd"] or 0 for l in lines), 2)
    return {"usd_max": total, "discovery_requests": discovery, "businesses": cap, "lines": lines,
            "source": "apify" if apify_mode else "places",
            "basis": "List prices in lbr_config.PRICES, before any free monthly usage or credit. The "
                     "run stops before it can spend more than this."}


def clamp_cap(value):
    try:
        cap = int(value)
    except (TypeError, ValueError):
        cap = lbr_config.DEFAULT_CAP
    return max(lbr_config.MIN_CAP, min(lbr_config.MAX_CAP, cap))


def plan(business_type, location, focus="all", cap=None, ledger=None):
    """Everything a run needs to start: what, where, how many, and the ceiling."""
    ledger = ledger or lbr_http.Ledger()
    focus = (focus or "all").strip().lower()
    if focus not in FOCUS:
        raise IntakeError("Pick what to sell: %s." % ", ".join(FOCUS_LABELS.values()))
    bt = resolve_business_type(business_type, ledger)
    area = resolve_location(location, ledger)
    cap = clamp_cap(cap if cap is not None else lbr_config.DEFAULT_CAP)
    return {"business": bt, "area": area, "focus": focus, "focus_label": FOCUS_LABELS[focus],
            "cap": cap, "estimate": estimate(area["kind"], cap, bt),
            "planning_cost": ledger.totals()}


# ── Previews are cached ──────────────────────────────────────────────────────
# The intake page previews a plan (area, categories, ceiling) before the user
# starts the run; starting it right after must not pay to resolve the same
# two inputs again. Keyed per user, on the normalised inputs; an hour is long
# enough for "preview, adjust the cap, start" and short enough that a
# boundary change at Google is picked up the same day.
_PLAN_CACHE = {}
_PLAN_LOCK = threading.Lock()
PLAN_TTL = 3600


def cached_plan(email, business_type, location, focus="all", cap=None):
    """plan(), reusing a resolved business type and area for up to PLAN_TTL."""
    key = ((email or "").lower(), _norm(business_type), _norm(location), lbr_config.source())
    now = time.time()
    with _PLAN_LOCK:
        hit = _PLAN_CACHE.get(key)
        if hit and now - hit[0] > PLAN_TTL:
            _PLAN_CACHE.pop(key, None)
            hit = None
    if hit:
        _, bt, area = hit
        focus_n = (focus or "all").strip().lower()
        if focus_n not in FOCUS:
            raise IntakeError("Pick what to sell: %s." % ", ".join(FOCUS_LABELS.values()))
        capv = clamp_cap(cap if cap is not None else lbr_config.DEFAULT_CAP)
        return {"business": bt, "area": area, "focus": focus_n, "focus_label": FOCUS_LABELS[focus_n],
                "cap": capv, "estimate": estimate(area["kind"], capv, bt),
                "planning_cost": {"usd": 0.0, "calls": 0, "unpriced": 0, "by_provider": {}},
                "cached": True}
    out = plan(business_type, location, focus, cap)
    with _PLAN_LOCK:
        _PLAN_CACHE[key] = (now, out["business"], out["area"])
    return out
