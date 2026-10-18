"""Paid Marketing Agents: the list of them, in one place.

Each agent's slug, page endpoint, name and the words its card says. app.py builds from it the agents' place
on the Operational Agents page (templates/seo.html, the "Paid marketing" group), their entries in every
client workspace (ACCT_AGENTS), their workspace colour, and the client routes; tracker/account_history.py
reads it for each agent's name and History. An agent is added here when its page ships
(docs/paid-marketing-plan.md), so the page never lists one that does not open yet.

    slug      /strategic-agents/paid-marketing/<slug>, and /<account>/agents/<slug> in a workspace
    endpoint  the Flask view of its page
    api       its JSON routes, as regexes after /strategic-agents/ (for a client the workspace shares it with)
    runs      the requests that start one of its runs (counted against a client's monthly runs)
"""
from __future__ import annotations

PREFIX = "/strategic-agents/paid-marketing"
COLOUR = "#FFB500"            # amber, the Paid marketing group's hue on the directory and in workspaces

# The account list and the reads every Google Ads or Meta page shares.
_ACCOUNTS = r"paid-marketing/api/gads/accounts"
_SEGMENTS = r"paid-marketing/api/segments/accounts"      # accounts and MCCs, for the segment-based pages

AGENTS = (
    {"slug": "performance-summarizer", "endpoint": "paid_performance_summarizer",
     "name": "Performance Summarizer", "icon": "P",
     "about": "Live Google Ads and Meta numbers, charted any way you like",
     "lead": "Reads an ad account live from Google Ads or Meta, or both side by side, and charts any metric against any "
             "other: the key numbers, the trend, campaigns, devices, networks, days and hours, and impression share.",
     "gives": "An ad account and a date range",
     "gets": "Every number, charted and compared with the period before",
     "tags": ["Google Ads", "Meta"],
     "api": (_ACCOUNTS, r"paid-marketing/api/gads/(performance|extras)"),
     "runs": (r"paid-marketing/api/gads/performance",)},
    {"slug": "product-analysis", "endpoint": "paid_product_analysis",
     "name": "Product Analysis", "icon": "A",
     "about": "Which products earn their ad spend, from Shopping, Performance Max and Meta catalogs",
     "lead": "Reads product-level numbers from Google Shopping and Performance Max, and from Meta catalog ads, and sorts "
             "every product into stars, steady sellers, drags and money pits, with the few clear things to do about each.",
     "gives": "An ecommerce ad account and a date range",
     "gets": "Every product sorted, with what to do about it",
     "tags": ["Shopping", "Ecommerce"],
     "api": (_ACCOUNTS, r"paid-marketing/api/gads/products"),
     "runs": (r"paid-marketing/api/gads/products",)},
    {"slug": "segment-analysis", "endpoint": "paid_segment_analysis",
     "name": "Segment Analysis", "icon": "S",
     "about": "Where an account really performs, by day, hour, age, gender, city, device and network",
     "lead": "Reads Google Ads or Meta live and lays out the seven segments the team used to build by hand, then says "
             "what to change: where to push, where spend is leaking, and how far each table can be trusted.",
     "gives": "An ad account or MCC and a date range",
     "gets": "Seven segment tables, the insights and a written summary",
     "tags": ["Google Ads", "Meta"],
     "api": (_ACCOUNTS, _SEGMENTS, r"paid-marketing/api/segments/(report|summary)"),
     "runs": (r"paid-marketing/api/segments/report",)},
    {"slug": "geo-performance", "endpoint": "paid_geo_performance",
     "name": "Geo Performance", "icon": "G",
     "about": "Which places earn their spend, which leak it, and the bid adjustment each deserves",
     "lead": "Reads Google Ads or Meta live at the level you choose, from country down to postal code, charts every place, "
             "judges each against the account's own average and says where to raise bids, where to cut and where spend leaks.",
     "gives": "An ad account or MCC, a date range and a location level",
     "gets": "Every place judged, with its bid adjustment and a briefing",
     "tags": ["Google Ads", "Meta"],
     "api": (_ACCOUNTS, _SEGMENTS, r"paid-marketing/api/geo/(report|summary)"),
     "runs": (r"paid-marketing/api/geo/report",)},
    {"slug": "seasonality-analysis", "endpoint": "paid_seasonality_analysis",
     "name": "Seasonality Analysis", "icon": "Y",
     "about": "When in the year an account earns, and what to do with budgets next",
     "lead": "Turns two to three years of daily Google Ads or Meta numbers into the shape of the year: which months and days "
             "carry the account, what the holidays really did, and what to do with budgets in the next three months.",
     "gives": "An ad account (or one of each platform) and how many months to look back",
     "gets": "The year's shape, the holidays and a three-month budget plan",
     "tags": ["Google Ads", "Meta"],
     "api": (_ACCOUNTS, r"paid-marketing/api/gads/seasonality(/warm)?"),
     "runs": (r"paid-marketing/api/gads/seasonality",)},
    {"slug": "ad-strength", "endpoint": "paid_ad_strength",
     "name": "Ad Strength Analysis", "icon": "R",
     "about": "Every ad Google rates below Good, busiest first, and how to lift it",
     "lead": "Reads Google's ad strength rating for every live Responsive Search Ad and Performance Max asset group, lists the "
             "ones below Good with Google's own tips beside the headlines and descriptions, and suggests new text on request.",
     "gives": "A Google Ads account or MCC",
     "gets": "The weak ads, worst and busiest first, with what to change",
     "tags": ["Google Ads", "Ad copy"],
     "api": (_SEGMENTS, r"paid-marketing/api/adstrength/(report|suggest)"),
     "runs": (r"paid-marketing/api/adstrength/report",)},
    {"slug": "audience-segments", "endpoint": "paid_audience_segments",
     "name": "Audience Segment Analysis", "icon": "U",
     "about": "Which audiences earn their bids, and where an adjustment would do nothing",
     "lead": "Compares every audience an account uses on Google Ads, Meta or both (in-market, affinity, interests, remarketing, "
             "customer lists, lookalikes) against the account's own average, and says where a bid, an ad set or an exclusion would pay.",
     "gives": "An ad account or MCC and a date range",
     "gets": "Every audience judged, with what to do and the lists' sizes",
     "tags": ["Google Ads", "Meta"],
     "api": (_ACCOUNTS, _SEGMENTS, r"paid-marketing/api/audiences/report"),
     "runs": (r"paid-marketing/api/audiences/report",)},
    {"slug": "asset-coverage", "endpoint": "paid_asset_coverage",
     "name": "Asset Coverage Audit", "icon": "C",
     "about": "What every campaign's assets are missing, and exactly what to add",
     "lead": "Reads every asset an account's live campaigns carry (sitelinks, callouts, snippets, images, logos, videos, headlines) "
             "and holds each campaign and asset group against what its kind should have, busiest first, with how many to add.",
     "gives": "A Google Ads account or MCC",
     "gets": "Every gap, with how many to add, and each asset opened",
     "tags": ["Google Ads", "Assets"],
     "api": (_SEGMENTS, r"paid-marketing/api/assets/(report|campaign|library)"),
     "runs": (r"paid-marketing/api/assets/report",)},
)

BY_SLUG = {a["slug"]: a for a in AGENTS}
SLUGS = frozenset(BY_SLUG)
NAMES = {a["slug"]: a["name"] for a in AGENTS}


def path(slug):
    return PREFIX + "/" + slug
