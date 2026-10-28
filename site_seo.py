"""How the public site (templates/site/) is described to search engines and AI assistants.

Beside its own copy, each page carries:
- the title and description it is listed with in search results (the routes in app.py, and the titles
  for each signal and industry below);
- structured data (schema.org JSON-LD). Search engines read it for rich results, and AI assistants
  read it to describe the business correctly: who Northaxis is, what it sells and at what price,
  where the page sits in the site, and the questions the page answers;
- an entry in /sitemap.xml, and a line in /llms.txt and /llms-full.txt, the plain-text summaries
  AI assistants read.

All of it is built from site_pages.py, so a new signal, industry or question reaches every one of them
on its own. Bump UPDATED when the site's content changes: it is each page's last-modified date in the
sitemap and in the structured data.
"""

import site_pages as S
from brand import BRAND

UPDATED = "2026-10-28"

# What the business is, in one paragraph: the structured data's description and the top of llms.txt.
SUMMARY = ("%s is a GTM engineering and performance marketing agency that works with AI agents. It finds "
           "the people showing they need what a client sells, writes to them in the client's name and books "
           "meetings into the client's calendar for %s a month, with the number of meetings promised in "
           "writing. It also runs Google Ads and Meta, paid on results." % (BRAND["name"], S.GTM_FEE))

KNOWS_ABOUT = ("GTM engineering", "B2B appointment setting", "Outbound lead generation", "Buying signals",
               "Email and LinkedIn outreach", "Performance marketing", "Google Ads", "Meta ads",
               "Pay-per-click advertising", "Answer engine optimisation")

# The company's profiles elsewhere (LinkedIn, Clutch, G2 and the like), as full addresses. Search
# engines use them to tie those profiles to this site; add each one as it goes live.
SAME_AS = ()

# The title each signal and industry page is listed with: what someone looking for it would search.
# The page's own heading stays the signal's or the industry's name.
SIGNAL_TITLES = {
    "visitors-on-your-site": "Identify the companies visiting your website",
    "engaging-with-your-posts": "Turn comments on your LinkedIn posts into meetings",
    "talking-about-your-product": "Find people talking about your product online",
    "rivals-audience": "Prospect your competitors' audience on LinkedIn",
    "unhappy-with-a-rival": "Find people unhappy with a competitor",
    "experts-audience": "Prospect an industry expert's audience",
    "hashtags-you-track": "Find buyers through the LinkedIn hashtags they use",
    "posting-about-the-problem": "Find buyers posting about the problem you solve",
    "asking-for-recommendations": "Find people asking for supplier recommendations",
    "tenders-and-rfps": "Find tenders and RFPs for your services",
    "hiring-for-the-work": "Hiring signals: companies hiring for what you sell",
    "new-in-the-job": "Reach buyers who are new in the job",
    "champion-moved": "Champion tracking: past customers in new jobs",
    "raised-money": "Funding signals: reach recently funded companies",
    "news-that-opens-a-door": "Launch and expansion news as buying signals",
    "growing-fast": "Find fast-growing companies by headcount growth",
    "uses-a-tool": "Technographic signals: companies using a rival's tool",
    "lookalikes": "Find lookalikes of your best customers",
    "same-event": "Meet buyers going to the same events",
    "local-businesses": "Find and score local businesses by city",
    "several-signs-at-once": "Find companies showing several buying signals",
}
# Each industry page's (title, description), in the words its buyers search with.
INDUSTRY_META = {
    "technology-saas": (
        "B2B SaaS lead generation and appointment setting",
        "B2B SaaS lead generation: we find software buyers posting about the problem you solve or engaging "
        "with your competitors, and book them in with your sales team."),
    "agencies": (
        "Lead generation for marketing and creative agencies",
        "We find companies at the moment they need an agency: after a launch, a new marketing lead or a "
        "campaign that isn't working, and book them in with you."),
    "professional-services": (
        "Consulting and professional services lead generation",
        "We find people with a named problem and a deadline in what they post, the tenders they publish and "
        "the changes at their companies, and book them in with you."),
    "it-services": (
        "Lead generation for IT services and cybersecurity",
        "Lead generation for IT and security firms: we find IT leaders facing an audit, a migration or a "
        "tender, and book you in while the decision is open."),
    "financial-services": (
        "Lead generation for fintech and financial services",
        "Lead generation for fintech and financial services: we find finance leaders around funding, a new "
        "CFO, an audit or a new market, and book you in."),
    "healthcare": (
        "Healthcare lead generation and appointment setting",
        "Meetings with clinics, hospitals and health businesses, found through what they publish, the events "
        "they attend and the problems they raise."),
    "real-estate": (
        "Real estate lead generation for developers and brokers",
        "Real estate lead generation: meetings with developers and brokers around a new project, an expansion "
        "or a new leader, and ads that bring buyers to site visits."),
    "education": (
        "Education lead generation for schools and universities",
        "Meetings with schools, colleges and universities, found through tenders, term dates and conferences, "
        "and booked before the decision is made."),
    "ecommerce": (
        "Google Ads and Meta for e-commerce and D2C brands",
        "Google Ads and Meta checked daily across every product, search term and audience, and meetings with "
        "the partners and wholesale buyers you want to meet."),
}


def clip(text, limit=160):
    """A description that fits a search result: whole sentences up to the limit, or the first one cut at a
    word."""
    if len(text) <= limit:
        return text
    out = ""
    for sentence in text.replace("? ", "?|").replace(". ", ".|").split("|"):
        if len(out) + len(sentence) + 1 > limit:
            break
        out = (out + " " + sentence).strip()
    return out or text[:limit - 1].rsplit(" ", 1)[0] + "…"


def _fee():
    return int(S.GTM_FEE.strip("$").replace(",", ""))


# ── The pages ──────────────────────────────────────────────────────────────────────────────────────
# Every page search engines may list, in the order the sitemap gives them.
def pages():
    """(path, page) for every page the sitemap lists."""
    out = [("/", "home"), ("/gtm-engineering", "gtm"), ("/performance-marketing", "performance"),
           ("/how-it-works", "how"), ("/pricing", "pricing"), ("/signals", "signals")]
    out += [("/signals/" + s["slug"], "signal") for s in S.SIGNALS]
    out += [("/industries", "industries")]
    out += [("/industries/" + i["slug"], "industry") for i in S.INDUSTRIES]
    out += [("/agents", "agents"), ("/compare", "compare"), ("/about", "about"), ("/book", "book"),
            ("/outreach-policy", "outreach"), ("/privacy", "privacy"), ("/terms", "terms")]
    return out


# ── Structured data ────────────────────────────────────────────────────────────────────────────────

def _organization(site_url):
    org = {"@type": "Organization", "@id": site_url + "/#organization", "name": BRAND["name"],
           "legalName": BRAND["legal_entity"], "url": site_url + "/",
           "logo": {"@type": "ImageObject", "@id": site_url + "/#logo", "url": site_url + "/static/logo.png",
                    "contentUrl": site_url + "/static/logo.png", "width": 512, "height": 512,
                    "caption": BRAND["name"]},
           "image": {"@id": site_url + "/#logo"},
           "description": SUMMARY, "slogan": "Meetings with your buyers, promised every month.",
           "knowsAbout": list(KNOWS_ABOUT),
           "contactPoint": {"@type": "ContactPoint", "contactType": "sales", "url": site_url + "/book",
                            "availableLanguage": "English"}}
    if SAME_AS:
        org["sameAs"] = list(SAME_AS)
    return org


def _website(site_url):
    return {"@type": "WebSite", "@id": site_url + "/#website", "url": site_url + "/", "name": BRAND["name"],
            "description": "GTM engineering and performance marketing, run with AI agents.",
            "publisher": {"@id": site_url + "/#organization"}, "inLanguage": "en"}


def gtm_service(site_url):
    return {"@type": "Service", "@id": site_url + "/gtm-engineering#service", "name": "GTM Engineering",
            "serviceType": "GTM engineering and B2B appointment setting", "url": site_url + "/gtm-engineering",
            "description": ("We find the people showing they need what you sell, write to them in your name by "
                            "email and LinkedIn, handle the replies and book the interested ones into your "
                            "calendar. The number of meetings is promised in writing each month; only meetings "
                            "that take place with someone who fits the agreed profile count."),
            "provider": {"@id": site_url + "/#organization"},
            "offers": {"@type": "Offer", "url": site_url + "/pricing", "price": _fee(), "priceCurrency": "USD",
                       "priceSpecification": {"@type": "UnitPriceSpecification", "price": _fee(),
                                              "priceCurrency": "USD", "unitCode": "MON", "unitText": "month"},
                       "description": ("A promised number of meetings each month. Each missing meeting is "
                                       "credited on the next bill, at the monthly fee divided by the number "
                                       "promised.")}}


def performance_service(site_url):
    return {"@type": "Service", "@id": site_url + "/performance-marketing#service", "name": "Performance Marketing",
            "serviceType": "Google Ads and Meta ads management", "url": site_url + "/performance-marketing",
            "description": ("Google Ads (Search, Shopping and Performance Max) and Meta, checked every day by 16 "
                            "agents, with every change made by a person on our team. Paid on results: what "
                            "counts as a result, and the rate, are agreed after a free account audit."),
            "provider": {"@id": site_url + "/#organization"},
            "offers": {"@type": "Offer", "name": "Free account audit", "price": 0, "priceCurrency": "USD",
                       "url": site_url + "/book?for=performance",
                       "description": ("About 50 checks with read-only access, and a written report of what "
                                       "the account is missing.")}}


def _breadcrumbs(site_url, url, crumbs):
    trail = [("Home", site_url + "/")] + [(name, site_url + path) for name, path in crumbs]
    return {"@type": "BreadcrumbList", "@id": url + "#breadcrumb",
            "itemListElement": [{"@type": "ListItem", "position": n, "name": name, "item": link}
                                for n, (name, link) in enumerate(trail, 1)]}


def _item_list(url, name, items):
    return {"@type": "ItemList", "@id": url + "#list", "name": name, "numberOfItems": len(items),
            "itemListElement": [{"@type": "ListItem", "position": n, "name": label, "url": link}
                                for n, (link, label) in enumerate(items, 1)]}


# The kind of page each one is, where schema.org has a better word than WebPage.
_PAGE_TYPES = {"about": "AboutPage", "book": "ContactPage", "signals": "CollectionPage",
               "industries": "CollectionPage"}


def graph(site_url, page, url, title, description, crumbs=(), faqs=()):
    """The page's structured data: the organisation and the website on every page, the page itself
    (with its questions when it has any), where it sits in the site, and what it sells or lists."""
    webpage = {"@type": [_PAGE_TYPES.get(page, "WebPage")] + (["FAQPage"] if faqs else []),
               "@id": url + "#webpage", "url": url, "name": title, "description": description,
               "isPartOf": {"@id": site_url + "/#website"}, "about": {"@id": site_url + "/#organization"},
               "inLanguage": "en", "dateModified": UPDATED}
    nodes = [_organization(site_url), _website(site_url), webpage]
    if crumbs:
        webpage["breadcrumb"] = {"@id": url + "#breadcrumb"}
        nodes.append(_breadcrumbs(site_url, url, crumbs))
    if faqs:
        webpage["mainEntity"] = [{"@type": "Question", "name": q,
                                  "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faqs]
    if page in ("home", "gtm", "pricing"):
        nodes.append(gtm_service(site_url))
    if page in ("home", "performance", "pricing"):
        nodes.append(performance_service(site_url))
    if page == "signals":
        nodes.append(_item_list(url, "Buying signals", [(site_url + h, n) for h, n in S.SIGNAL_LINKS]))
    if page == "industries":
        nodes.append(_item_list(url, "Industries", [(site_url + h, n) for h, n in S.INDUSTRY_LINKS]))
    if page in ("signals", "industries") and not faqs:
        webpage["mainEntity"] = {"@id": url + "#list"}
    return {"@context": "https://schema.org", "@graph": nodes}
