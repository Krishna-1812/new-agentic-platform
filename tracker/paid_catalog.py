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
)

BY_SLUG = {a["slug"]: a for a in AGENTS}
SLUGS = frozenset(BY_SLUG)
NAMES = {a["slug"]: a["name"] for a in AGENTS}


def path(slug):
    return PREFIX + "/" + slug
