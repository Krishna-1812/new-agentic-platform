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
)

BY_SLUG = {a["slug"]: a for a in AGENTS}
SLUGS = frozenset(BY_SLUG)
NAMES = {a["slug"]: a["name"] for a in AGENTS}


def path(slug):
    return PREFIX + "/" + slug
