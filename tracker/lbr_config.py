"""Local Business Radar: the tools it runs on, their prices, and its limits.

Local Business Radar finds every small business of one kind in one place,
audits its Google Business Profile, its website, its reviews and its
visibility, and ranks the ones worth pitching (website build, local SEO,
paid media, reputation, creatives). This module is the single place that
says which outside services it needs and what each one costs.

Every key is read from the environment at call time, never at import, so a
key added in Railway takes effect on the next request without a code change.
A missing REQUIRED tool stops a run before it spends anything; a missing
OPTIONAL tool only removes the findings that tool supplies, and the report
says which ones are absent rather than showing them as clean.
"""

import json
import os

# ── The tools ────────────────────────────────────────────────────────────────
# `env` lists the variables that can supply the tool, first match wins.
TOOLS = [
    {
        "key": "places", "name": "Google Places API (New)", "required": True,
        "required_apify": False,
        "for_apify": "Optional while Apify searches Google Maps. Not used by a run.",
        "env": ["GOOGLE_MAPS_API_KEY"],
        "for": "Finding every business in the area and reading its Google Business Profile: "
               "website, phone, hours, rating and review count.",
        "get": "Google Cloud Console: enable \"Places API (New)\", then Credentials, Create API key. "
               "Restrict the key to that API.",
    },
    {
        "key": "serpapi", "name": "SerpAPI", "required": True,
        "required_apify": False,
        "for_apify": "Optional: whether each business runs Google Ads (Ads Transparency Center). When it is "
                     "set, map rank is read here too, at $0.015 a search instead of Apify's per-place price.",
        "env": ["SERPAPI_KEY"],
        "for": "Every review with the owner's replies (Google's own API returns five), the business's "
               "rank in the map results, and whether it runs Google Ads.",
        "get": "serpapi.com, Dashboard, Your Private API Key.",
    },
    {
        "key": "claude", "name": "Claude (Anthropic)", "required": True,
        "env": ["ANTHROPIC_API_KEY"],
        "for": "Turning a business type into Google categories, reading reviews for themes, and "
               "writing each pitch from the evidence gathered.",
        "get": "console.anthropic.com, API Keys.",
    },
    {
        "key": "pagespeed", "name": "PageSpeed Insights API", "required": False,
        "env": ["PAGESPEED_API_KEY", "GOOGLE_MAPS_API_KEY"],
        "for": "Mobile speed and Core Web Vitals for every business website.",
        "get": "Enable \"PageSpeed Insights API\" on the same Google Cloud project; the Maps key then "
               "works for it too. It is free.",
    },
    {
        "key": "apify", "name": "Apify Google Maps Scraper", "required": False,
        "required_apify": True,
        "env": ["APIFY_API_TOKEN"],
        "for": "Whether the owner has claimed the profile, the photo count and the owner's posts, "
               "none of which Google's own API returns.",
        "for_apify": "Searches Google Maps across the whole area for every business, then opens each one "
                     "researched: claimed or not, hours, photos, owner posts and its newest reviews with "
                     "the owner's replies. Also reads map rank when SerpAPI is not set.",
        "get": "console.apify.com, Settings, API & Integrations, Personal API token.",
    },
    {
        "key": "hunter", "name": "Hunter.io", "required": False,
        "env": ["HUNTER_API_KEY"],
        "for": "Email addresses for businesses whose website lists none.",
        "get": "hunter.io, API, Your API key.",
    },
]
TOOLS_BY_KEY = {t["key"]: t for t in TOOLS}


def key_for(tool_key):
    """The configured value for one tool, or "" when none of its variables is set."""
    tool = TOOLS_BY_KEY[tool_key]
    for name in tool["env"]:
        value = (os.environ.get(name) or "").strip()
        if value:
            return value
    return ""


def env_used(tool_key):
    """Which variable supplied the tool (for display; never the value)."""
    for name in TOOLS_BY_KEY[tool_key]["env"]:
        if (os.environ.get(name) or "").strip():
            return name
    return ""


# ── Where businesses come from ───────────────────────────────────────────────
# "apify": Apify's Google Maps Scraper searches Google Maps itself (the area
#          comes from OpenStreetMap; Google Places is not needed).
# "places": Google's Places API (New), with SerpAPI for reviews and rank.
# LBR_SOURCE picks one; unset, Apify is used whenever its token is set.
SOURCES = ("apify", "places")


def source():
    forced = (os.environ.get("LBR_SOURCE") or "").strip().lower()
    if forced in SOURCES:
        return forced
    return "apify" if key_for("apify") else "places"


def is_required(tool, src=None):
    """Whether a run needs the tool. src is the run's own source ("apify" or "places"),
    from its plan; without one, the source a new run would use now."""
    return tool.get("required_apify", tool["required"]) if (src or source()) == "apify" else tool["required"]


def readiness():
    """One row per tool: what it does, whether it is set, and how to get it."""
    apify_mode = source() == "apify"
    rows = []
    for t in TOOLS:
        rows.append({
            "key": t["key"], "name": t["name"], "required": is_required(t),
            "configured": bool(key_for(t["key"])), "env": t["env"],
            "env_used": env_used(t["key"]),
            "for": t.get("for_apify", t["for"]) if apify_mode else t["for"], "get": t["get"],
        })
    return rows


def missing_required(src=None):
    return [t["name"] for t in TOOLS if is_required(t, src) and not key_for(t["key"])]


def missing_message(src):
    """Why a run with this source cannot go on, naming each missing tool and its variable; "" when ready."""
    missing = [t for t in TOOLS if is_required(t, src) and not key_for(t["key"])]
    if not missing:
        return ""
    how = "Apify" if src == "apify" else "Google Places and SerpAPI"
    return ("This run searches with %s, and the website's service is missing: %s. Set %s in Railway "
            "(web service, Variables), then resume the run." % (
                how, "; ".join("%s (%s)" % (t["name"], " or ".join(t["env"])) for t in missing),
                "it" if len(missing) == 1 else "them"))


def ready():
    return not missing_required()


# ── Run limits ───────────────────────────────────────────────────────────────
DEFAULT_CAP = 200     # businesses researched in depth per run
MIN_CAP = 10
MAX_CAP = 500
# SerpAPI pages of reviews per business, newest first. The first page's size
# is fixed by SerpAPI (`num` is refused on it); later pages ask for 20.
MAX_REVIEW_PAGES = 3
# Apify: newest reviews read per researched business, and how many map
# results a rank search reads: the map pack (the first three) and the two
# just below it. Each result is a paid place, so deeper costs more.
APIFY_MAX_REVIEWS = 30
APIFY_RANK_DEPTH = 5
# Apify discovery pays per place found ($0.004 each on the Free plan), so the
# search is sized to the research: ten candidates for every business researched
# (the best are picked from those), never fewer than APIFY_DISCOVERY_MIN, and
# never more than the area's own ceiling. Per search phrase; at most two.
APIFY_DISCOVERY_PLACES = {"postcode": 200, "district": 300, "city": 800, "county": 1200, "state": 2500}
APIFY_CANDIDATES_PER_BUSINESS = 10
APIFY_DISCOVERY_MIN = 100


def apify_discovery_places(kind, cap):
    """Places the Apify search may find (and be charged for) per phrase."""
    ceiling = APIFY_DISCOVERY_PLACES.get(kind, 800)
    return min(ceiling, max(APIFY_DISCOVERY_MIN, int(cap or DEFAULT_CAP) * APIFY_CANDIDATES_PER_BUSINESS))


def retention_days():
    """How long a finished run keeps each business's profile content.

    Google's Maps Platform terms let a customer keep a place ID indefinitely
    but restrict caching the rest of a place's content. After this many days
    the store blanks every business's gathered content and keeps only the
    place ID and its scores; re-running refreshes it.
    """
    try:
        return max(1, int(os.environ.get("LBR_RETENTION_DAYS") or 30))
    except ValueError:
        return 30


def model():
    return (os.environ.get("ANTHROPIC_MODEL") or "claude-sonnet-5").strip()


# ── Prices ───────────────────────────────────────────────────────────────────
# List prices per unit, in US dollars, with where each came from and when it
# was read. Estimates only: they ignore Google's free monthly usage and any
# volume tier, so a real bill is at most this. Any entry can be overridden
# with LBR_PRICES_JSON, e.g. {"serpapi.search": 0.01} for the Production plan.
# The apify.* prices are read from Apify for the account's own pricing tier
# (tracker/lbr_apify_pricing.py); the figures here stand in when that fails.
PRICES = {
    "places.text_search_pro": {
        "usd": 0.032, "unit": "request",
        "source": "https://developers.google.com/maps/billing-and-pricing/pricing",
        "note": "Text Search Pro, $32.00 per 1,000 requests (first tier). Up to 20 places per request.",
        "checked": "2026-09-27"},
    "places.text_search_enterprise": {
        "usd": 0.035, "unit": "request",
        "source": "https://developers.google.com/maps/billing-and-pricing/pricing",
        "note": "Text Search Enterprise, $35.00 per 1,000 requests (first tier). Discovery asks for "
                "website, phone, hours, rating and review count in the search itself, so each "
                "request covers up to 20 businesses and no per-business Place Details call is needed.",
        "checked": "2026-09-27"},
    "places.details_enterprise": {
        "usd": 0.020, "unit": "request",
        "source": "https://developers.google.com/maps/billing-and-pricing/pricing",
        "note": "Place Details Enterprise, $20.00 per 1,000 (websiteUri, phone, hours, rating, "
                "userRatingCount are Enterprise fields).",
        "checked": "2026-09-27"},
    "serpapi.search": {
        "usd": 0.015, "unit": "search",
        "source": "https://serpapi.com/pricing",
        "note": "Developer plan, $75 for 5,000 searches. Cached and failed searches are not counted.",
        "checked": "2026-09-27"},
    "pagespeed.run": {
        "usd": 0.0, "unit": "request",
        "source": "https://developers.google.com/speed/docs/insights/v5/get-started",
        "note": "Free.", "checked": "2026-09-27"},
    "apify.place": {
        "usd": 0.004, "unit": "place",
        "source": "https://apify.com/compass/crawler-google-places",
        "note": "Pay per event, 'Scraped place': $0.004 on Apify's Free plan, $0.003 Bronze, $0.002 "
                "Silver, $0.0015 Gold (the listed 'from $1.50 per 1,000'). Your tier's price is read "
                "from Apify; this Free-plan figure is the fallback.",
        "checked": "2026-09-27"},
    "apify.details": {
        "usd": 0.002, "unit": "place",
        "source": "https://apify.com/compass/crawler-google-places",
        "note": "'Add-on: Additional place details scraped', $0.002 per place on Free and Bronze. "
                "Charged for every place opened for its details or reviews.",
        "checked": "2026-09-27"},
    "apify.review": {
        "usd": 0.0005, "unit": "review",
        "source": "https://apify.com/compass/crawler-google-places",
        "note": "'Add-on: Review scraped', $0.0005 per review on Free and Bronze.",
        "checked": "2026-09-27"},
    "apify.start": {
        "usd": 0.00005, "unit": "run",
        "source": "https://apify.com/compass/crawler-google-places",
        "note": "'Actor Start', $0.00005 once per run.", "checked": "2026-09-27"},
    "osm.nominatim": {
        "usd": 0.0, "unit": "request",
        "source": "https://operations.osmfoundation.org/policies/nominatim/",
        "note": "Free: one lookup per plan, at most one a second, with attribution. Data (c) "
                "OpenStreetMap contributors, ODbL.",
        "checked": "2026-09-27"},
    "hunter.domain_search": {
        "usd": None, "unit": "request",
        "source": "https://hunter.io/pricing",
        "note": "Depends on your Hunter plan; set it in LBR_PRICES_JSON to include it.",
        "checked": "2026-09-27"},
}

# Claude, per million tokens (input, output). Same source and figures as the
# Event Intelligence ledger (tracker/event_intel_costs.py).
CLAUDE_RATES = {"claude-sonnet-5": (2.0, 10.0), "claude-sonnet-4-6": (3.0, 15.0),
                "claude-sonnet-4-5": (3.0, 15.0)}
CLAUDE_PRICE_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing"


def price(op):
    """US dollars per unit for one operation, or None when it is not priced."""
    try:
        override = json.loads(os.environ.get("LBR_PRICES_JSON") or "{}")
    except ValueError:
        override = {}
    if isinstance(override, dict) and op in override:
        try:
            return float(override[op])
        except (TypeError, ValueError):
            return None
    if op.startswith("apify."):
        from tracker import lbr_apify_pricing
        live = lbr_apify_pricing.rate(op, key_for("apify"))
        if live is not None:
            return live
    entry = PRICES.get(op)
    return entry["usd"] if entry else None


def apify_pricing():
    """How Apify runs are priced: {"tier", "plan", "prices", "live"} or, on list prices, {"live": False, "why"}."""
    from tracker import lbr_apify_pricing
    token = key_for("apify")
    found = lbr_apify_pricing.lookup(token)
    if found and not found.get("error"):
        return {"live": True, "tier": found["tier"], "plan": found["plan"], "prices": dict(found["prices"])}
    why = (found or {}).get("error") or ("No Apify token." if not token else "Live pricing is switched off.")
    return {"live": False, "why": why}


def claude_usd(model_name, input_tokens, output_tokens):
    rate = next((v for k, v in CLAUDE_RATES.items()
                 if model_name == k or str(model_name).startswith(k + "-")), None)
    if not rate:
        return None
    return (input_tokens * rate[0] + output_tokens * rate[1]) / 1_000_000
