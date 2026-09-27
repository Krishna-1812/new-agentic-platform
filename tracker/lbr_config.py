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
        "env": ["GOOGLE_MAPS_API_KEY"],
        "for": "Finding every business in the area and reading its Google Business Profile: "
               "website, phone, hours, rating and review count.",
        "get": "Google Cloud Console: enable \"Places API (New)\", then Credentials, Create API key. "
               "Restrict the key to that API.",
    },
    {
        "key": "serpapi", "name": "SerpAPI", "required": True,
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
        "env": ["APIFY_API_TOKEN"],
        "for": "Whether the owner has claimed the profile, the photo count and the owner's posts, "
               "none of which Google's own API returns.",
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


def readiness():
    """One row per tool: what it does, whether it is set, and how to get it."""
    rows = []
    for t in TOOLS:
        rows.append({
            "key": t["key"], "name": t["name"], "required": t["required"],
            "configured": bool(key_for(t["key"])), "env": t["env"],
            "env_used": env_used(t["key"]), "for": t["for"], "get": t["get"],
        })
    return rows


def missing_required():
    return [t["name"] for t in TOOLS if t["required"] and not key_for(t["key"])]


def ready():
    return not missing_required()


# ── Run limits ───────────────────────────────────────────────────────────────
DEFAULT_CAP = 200     # businesses researched in depth per run
MIN_CAP = 10
MAX_CAP = 500
# SerpAPI pages of reviews per business, newest first. The first page's size
# is fixed by SerpAPI (`num` is refused on it); later pages ask for 20.
MAX_REVIEW_PAGES = 3


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
        "note": "Listed from $1.50 per 1,000 places; the place-details add-on used here is billed on "
                "top, so the estimate uses $4 per 1,000 until you set your own rate.",
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
    entry = PRICES.get(op)
    return entry["usd"] if entry else None


def claude_usd(model_name, input_tokens, output_tokens):
    rate = next((v for k, v in CLAUDE_RATES.items()
                 if model_name == k or str(model_name).startswith(k + "-")), None)
    if not rate:
        return None
    return (input_tokens * rate[0] + output_tokens * rate[1]) / 1_000_000
