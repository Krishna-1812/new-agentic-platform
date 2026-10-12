"""Market Radar: five more things worth knowing about a rival, all free and public.

Each follows the detector contract in tracker/market_radar_collect.py: read(ctx) -> {"status", "note",
"payload", "items", "complete"}, then compare(prev, cur, now) and baseline(cur, now) -> events.

  content   New pages in the site's sitemap. A new pricing, comparison or industry page, a new country
            section (/de/, /en-ae/), a flood of pages under one section: how a rival repositions before
            it announces anything.
  apps      Apple App Store: a rival's new app or a new version. Matched by the app's seller website, so
            a namesake is never taken for the rival.
  buzz      Hacker News stories that link to the rival's site and took off: launches the tech crowd saw.
  facts     Wikidata: a new chief executive, a new owner or parent, a change of staff count or revenue.
  stack     The tools the rival's homepage loads (shop platform, email, analytics, chat, booking...): a
            switch of shop platform or a new marketing tool says what it is investing in.

Nothing here spends a credit or calls a model. A source that does not answer is reported as not read.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlsplit

from . import market_radar_outside as outside
from .market_radar_detectors import _capped, _date, _event, _fail, _h, read_sitemaps

# == new pages ========================================================================

MAX_PATHS = 6000
SITEMAP_FILES = 12
NOISE = re.compile(r"/(blog|blogs|news|article|articles|post|posts|tag|tags|author|authors|category|categories|"
                   r"page/\d+|feed|wp-json|cdn-cgi|search|cart|checkout|account|login|"
                   r"product|products|collections?|shop|store|stores|locations?|clinics?|offices?|dentist)(/|$)|"
                   r"\.(jpg|jpeg|png|gif|webp|svg|pdf|css|js|xml|txt)$", re.I)
LOCALE = re.compile(r"^/([a-z]{2}(?:-[a-z]{2})?)(?:/|$)")
SIGNAL_PAGES = re.compile(r"pricing|plans?|compare|vs-|-vs-|alternative|integrations?|partners?|customers?|"
                          r"case-stud|industries|industry|solutions?|use-cases?|enterprise|platform|"
                          r"services?|practice-areas?|programmes?|programs?|courses?|destinations?|rooms?|"
                          r"careers?-in|new$", re.I)
MIN_SECTION = 3


def _site_paths(ctx):
    rs, get = ctx["site"], ctx["get"]
    sitemaps = (rs.get("robots") or {}).get("sitemaps") or []
    if not sitemaps:
        sitemaps = [rs["home_url"].rstrip("/") + "/sitemap.xml"]
    return read_sitemaps(get, sitemaps, prefer=re.compile(r"page|post|sitemap|solution|resource", re.I),
                         keep=lambda p: not NOISE.search(p), max_files=SITEMAP_FILES, max_urls=40_000)


def read_content(ctx):
    got = _site_paths(ctx)
    paths = sorted({(urlsplit(u).path or "/").rstrip("/").lower() or "/" for u in got["entries"]} - {"/"})
    if not paths:
        if got["refused"]:
            return _fail("blocked", "the sitemap could not be read (%s)" % got["failed"][0][:120])
        return {"status": "none", "note": "the site has no readable sitemap", "payload": None,
                "items": 0, "complete": True}
    complete = got["complete"] and len(paths) <= MAX_PATHS
    paths = paths[:MAX_PATHS]
    return {"status": "ok", "note": "%d pages in the sitemap%s" % (len(paths), "" if complete else " (not all read)"),
            "payload": {"paths": paths, "complete": complete}, "items": len(paths), "complete": complete}


def _section(path):
    seg = [s for s in path.split("/") if s]
    return "/" + seg[0] if seg else "/"


def compare_content(prev, cur, now):
    day = now.strftime("%Y-%m-%d")
    before, after = set(prev.get("paths") or []), set(cur.get("paths") or [])
    if not (prev.get("complete") and cur.get("complete")) and before and after:
        # A list cut at MAX_PATHS holds the alphabetical start of the site: compare only the part both hold,
        # or a page pushed past the cut would look new (or gone).
        cutoff = min(max(before), max(after))
        before, after = {p for p in before if p <= cutoff}, {p for p in after if p <= cutoff}
    new = sorted(after - before)
    gone = before - after
    if not new:
        return []
    if len(new) >= max(40, 0.4 * max(len(before), 1)) and len(gone) >= 0.25 * max(len(before), 1):
        return [_event("content-reshaped:%s" % day, "site_restructured",
                       "The site's pages were reorganised (%d added, %d gone)" % (len(new), len(gone)), date=day,
                       summary="Not read as new content: the address scheme changed.")]
    events, by_section = [], {}
    old_sections = {_section(p) for p in before}
    for p in new:
        by_section.setdefault(_section(p), []).append(p)
    for sec, pages in sorted(by_section.items(), key=lambda kv: -len(kv[1])):
        loc = LOCALE.match(sec + "/")
        if sec not in old_sections and len(pages) >= MIN_SECTION and loc and len(sec) <= 6:
            events.append(_event("content-market:" + sec, "new_market",
                                 "New country or language section: %s (%d pages)" % (sec, len(pages)),
                                 status="announced", date=day, url=None,
                                 summary="A new %s section appeared on the site with %d pages, often the first sign "
                                         "of a launch in a new market." % (sec, len(pages))))
        elif sec not in old_sections and len(pages) >= MIN_SECTION:
            events.append(_event("content-section:" + sec, "new_content",
                                 "New section on the site: %s (%d pages)" % (sec, len(pages)), status="announced",
                                 date=day, summary="A whole new part of the site: %s." % ", ".join(pages[:4])))
        else:
            signal = [p for p in pages if SIGNAL_PAGES.search(p)]
            for p in signal[:3]:
                events.append(_event("content-page:" + p, "new_content", "New page: " + p, status="announced",
                                     date=day))
            rest = len(pages) - min(len(signal), 3)
            if rest >= 8:
                events.append(_event("content-bulk:%s:%s" % (sec, day), "new_content",
                                     "%d new pages under %s" % (rest, sec), date=day))
    return _capped(events, "site changes", "content-many:%s" % day, date=day)


# == apps =============================================================================

ITUNES = "https://itunes.apple.com/search?term=%s&entity=software&country=%s&limit=25"


def read_apps(ctx):
    ent = ctx["entity"]
    name, domain = (ent.get("name") or "").strip(), outside.host_of(ent["domain"])
    term = name or (outside.names_for(domain) or [""])[0]
    if not term:
        return {"status": "none", "note": "no name to look for", "payload": None, "items": 0, "complete": True}
    country = (ent.get("country") or ctx.get("client_country") or "us").lower()
    data, read = ctx["get_json"](ITUNES % (quote(term), country if len(country) == 2 else "us"))
    if not isinstance(data, dict):
        return _fail("blocked" if read.get("status") == "blocked" else "failed",
                     "the App Store did not answer (%s)" % (read.get("note") or read.get("status")))
    apps = []
    for r in data.get("results") or []:
        seller = outside.host_of(r.get("sellerUrl") or "")
        if seller and (seller == domain or seller.endswith("." + domain) or domain.endswith("." + seller)):
            apps.append({"id": r.get("trackId"), "name": r.get("trackName"), "version": r.get("version"),
                         "released": _date(r.get("releaseDate")), "updated": _date(r.get("currentVersionReleaseDate")),
                         "rating": round(r.get("averageUserRating") or 0, 2), "ratings": r.get("userRatingCount") or 0,
                         "price": r.get("formattedPrice"), "url": r.get("trackViewUrl"), "notes": (r.get("releaseNotes") or "")[:240]})
    apps.sort(key=lambda a: -(a["ratings"] or 0))
    if not apps:
        return {"status": "none", "note": "no app on the App Store lists %s as its website" % domain,
                "payload": None, "items": 0, "complete": True}
    return {"status": "ok", "note": "%d apps listed on the App Store" % len(apps), "payload": {"apps": apps[:10]},
            "items": len(apps), "complete": True}


def compare_apps(prev, cur, now):
    day = now.strftime("%Y-%m-%d")
    old = {a["id"]: a for a in prev.get("apps") or []}
    events = []
    for a in cur.get("apps") or []:
        before = old.get(a["id"])
        if before is None:
            events.append(_event("app+:%s" % a["id"], "product_launch", "New app: %s" % a["name"], status="opened",
                                 date=a.get("released") or day, url=a.get("url"),
                                 summary="Listed on the App Store (version %s)." % a.get("version")))
        elif a.get("version") and a["version"] != before.get("version"):
            events.append(_event("app-update:%s:%s" % (a["id"], a["version"]), "app_update",
                                 "%s updated to version %s" % (a["name"], a["version"]), status="completed",
                                 date=a.get("updated") or day, url=a.get("url"), summary=a.get("notes") or None))
    return events[:6]


def baseline_apps(cur, now):
    out = []
    for a in cur.get("apps") or []:
        for when, kind, title in ((a.get("released"), "app-new", "App released: %s"),
                                  (a.get("updated"), "app-upd", "%s updated")):
            if when and (now - datetime.strptime(when, "%Y-%m-%d").replace(tzinfo=timezone.utc)).days <= 45:
                out.append(_event("%s:%s:%s" % (kind, a["id"], when), "product_launch" if kind == "app-new" else "app_update",
                                  title % a["name"], status="opened" if kind == "app-new" else "completed", date=when,
                                  url=a.get("url"), summary=("Version %s." % a.get("version")) if a.get("version") else None))
    return out[:4]


# == Hacker News ======================================================================

HN = "https://hn.algolia.com/api/v1/search_by_date?query=%s&restrictSearchableAttributes=url&tags=story&hitsPerPage=40&numericFilters=created_at_i>%d"
HN_MIN_POINTS = 40


def read_buzz(ctx):
    domain = outside.host_of(ctx["entity"]["domain"])
    since = int((ctx["now"] - timedelta(days=90)).timestamp())
    data, read = ctx["get_json"](HN % (quote(domain), since))
    if not isinstance(data, dict):
        return _fail("blocked" if read.get("status") == "blocked" else "failed",
                     "Hacker News did not answer (%s)" % (read.get("note") or read.get("status")))
    items = []
    for h in data.get("hits") or []:
        url_host = outside.host_of(h.get("url") or "")
        if url_host == domain or url_host.endswith("." + domain):
            items.append({"id": h.get("objectID"), "title": (h.get("title") or "")[:200], "points": h.get("points") or 0,
                          "comments": h.get("num_comments") or 0, "date": _date(h.get("created_at")), "url": h.get("url")})
    items.sort(key=lambda i: -i["points"])
    if not items:
        return {"status": "empty", "note": "no Hacker News stories link to the site in 90 days",
                "payload": {"items": []}, "items": 0, "complete": True}
    return {"status": "ok", "note": "%d Hacker News stories link to the site" % len(items),
            "payload": {"items": items[:15]}, "items": len(items), "complete": True}


def _buzz_event(i):
    return _event("hn:%s" % i["id"], "community_buzz",
                  "On Hacker News: %s (%d points, %d comments)" % (i["title"], i["points"], i["comments"]),
                  status="announced", date=i.get("date"), url="https://news.ycombinator.com/item?id=%s" % i["id"],
                  summary="A page on their site took off with developers and founders.")


def compare_buzz(prev, cur, now):
    seen = {i["id"] for i in prev.get("items") or []}
    return [_buzz_event(i) for i in cur.get("items") or [] if i["id"] not in seen and i["points"] >= HN_MIN_POINTS][:4]


def baseline_buzz(cur, now):
    out = []
    for i in cur.get("items") or []:
        if i["points"] >= HN_MIN_POINTS and i.get("date"):
            age = (now - datetime.strptime(i["date"], "%Y-%m-%d").replace(tzinfo=timezone.utc)).days
            if age <= 45:
                out.append(_buzz_event(i))
    return out[:3]


# == company facts (Wikidata) =========================================================

def read_facts(ctx):
    found = outside.outside_facts(ctx["entity"]["domain"], get_json=ctx["get_json"])
    if not found:
        return {"status": "none", "note": "no Wikidata record lists %s as its website" % ctx["entity"]["domain"],
                "payload": None, "items": 0, "complete": True}
    f = found["facts"]
    keep = {k: f.get(k) for k in ("wikidata_id", "name", "ceo", "parent", "owners", "employees", "employees_year",
                                  "revenue", "revenue_year", "listed_on", "head_office")}
    return {"status": "ok", "note": "Wikidata record %s" % f["wikidata_id"], "payload": keep, "items": 1, "complete": True}


def compare_facts(prev, cur, now):
    day = now.strftime("%Y-%m-%d")
    name = cur.get("name") or "The company"
    events = []
    if cur.get("ceo") and prev.get("ceo") and cur["ceo"] != prev["ceo"]:
        events.append(_event("fact-ceo:" + _h(",".join(cur["ceo"])), "leadership_change",
                             "%s: new chief executive, %s (was %s)" % (name, ", ".join(cur["ceo"]), ", ".join(prev["ceo"])),
                             status="announced", date=day))
    if cur.get("parent") and cur["parent"] != prev.get("parent"):
        events.append(_event("fact-parent:" + _h(",".join(cur["parent"])), "acquisition",
                             "%s is now part of %s" % (name, ", ".join(cur["parent"])), status="announced", date=day))
    e0, e1 = prev.get("employees"), cur.get("employees")
    if e0 and e1 and cur.get("employees_year") != prev.get("employees_year") and abs(e1 - e0) / e0 >= 0.15:
        up = e1 > e0
        events.append(_event("fact-staff:%s" % cur.get("employees_year"), "hiring_surge" if up else "hiring_slowdown",
                             "%s: staff %s from %s to %s" % (name, "up" if up else "down", f"{e0:,}", f"{e1:,}"),
                             status="announced", date=day, summary="From its Wikidata record (%s)." % cur.get("employees_year")))
    r1 = cur.get("revenue")
    if r1 and cur.get("revenue_year") != prev.get("revenue_year"):
        events.append(_event("fact-revenue:%s" % cur.get("revenue_year"), "financial_results",
                             "%s: revenue of %s reported for %s" % (name, outside._money(r1), cur.get("revenue_year")),
                             status="announced", date=day))
    return events


# == technology stack =================================================================

STACK = [   # (name, what it tells you, pattern on the homepage's code)
    ("Shopify", "shop platform", r"cdn\.shopify\.com|Shopify\.theme"),
    ("WooCommerce", "shop platform", r"woocommerce"),
    ("BigCommerce", "shop platform", r"bigcommerce\.com"),
    ("Magento", "shop platform", r"Magento_|mage/cookies"),
    ("Webflow", "site builder", r"data-wf-site|webflow\.com/"),
    ("WordPress", "site builder", r"wp-content/|wp-includes/"),
    ("Wix", "site builder", r"wixstatic\.com"),
    ("Squarespace", "site builder", r"squarespace"),
    ("Next.js", "site framework", r"/_next/static"),
    ("HubSpot", "marketing and sales", r"js\.hs-scripts\.com|hsforms\.net|hubspot\.com/"),
    ("Salesforce / Pardot", "marketing and sales", r"pardot\.com|salesforce\.com/|pi\.pardot"),
    ("Marketo", "marketing and sales", r"marketo\.(com|net)|munchkin"),
    ("Klaviyo", "email marketing", r"klaviyo\.com"),
    ("Mailchimp", "email marketing", r"chimpstatic\.com|mailchimp\.com"),
    ("Intercom", "chat and support", r"intercom(cdn)?\.(io|com)"),
    ("Drift", "chat and support", r"drift\.com|driftt\.com"),
    ("Zendesk", "chat and support", r"zdassets\.com|zendesk\.com"),
    ("Gorgias", "chat and support", r"gorgias\.chat|gorgias\.io"),
    ("LiveChat", "chat and support", r"livechatinc\.com"),
    ("Calendly", "booking", r"calendly\.com"),
    ("Segment", "analytics", r"cdn\.segment\.com"),
    ("Google Tag Manager", "analytics", r"googletagmanager\.com/gtm"),
    ("Google Analytics 4", "analytics", r"gtag/js\?id=G-|googletagmanager\.com/gtag"),
    ("Meta Pixel", "advertising", r"connect\.facebook\.net/.+/fbevents|fbq\("),
    ("TikTok Pixel", "advertising", r"analytics\.tiktok\.com"),
    ("LinkedIn Insight", "advertising", r"snap\.licdn\.com|linkedin\.com/px"),
    ("Google Ads tag", "advertising", r"googleadservices\.com|AW-\d{6,}"),
    ("Hotjar", "analytics", r"hotjar\.com"),
    ("Stripe", "payments", r"js\.stripe\.com"),
    ("Klarna", "payments", r"klarna\.com"),
    ("Afterpay", "payments", r"afterpay\.com|clearpay"),
    ("Yotpo", "reviews", r"yotpo\.com"),
    ("Trustpilot", "reviews", r"trustpilot\.com"),
    ("Bazaarvoice", "reviews", r"bazaarvoice\.com"),
    ("Optimizely", "testing", r"optimizely\.com"),
    ("Cloudflare", "hosting", r"cdn-cgi/|cloudflare"),
]
STACK_MEANING = {"shop platform": "a change of shop platform is a rebuild: new features and some disruption to follow",
                 "marketing and sales": "investing in lead generation and sales automation",
                 "email marketing": "investing in email and retention",
                 "chat and support": "investing in customer support and conversion",
                 "advertising": "starting or widening paid advertising",
                 "booking": "making it easier to book", "reviews": "investing in social proof",
                 "testing": "running tests on its pages", "payments": "adding ways to pay",
                 "analytics": "measuring more of its audience", "site builder": "rebuilding its site",
                 "site framework": "rebuilding its site", "hosting": "changed where its site is served"}


def read_stack(ctx):
    home = ctx["site"]["home_url"]
    page = ctx["fetch"](home)
    if page.get("status") != "ok":
        return _fail("blocked" if page.get("status") == "blocked" else "failed",
                     "the homepage could not be read (%s)" % (page.get("note") or page.get("status")))
    html = page["html"][:2_500_000]
    found = sorted(n for n, _kind, pat in STACK if re.search(pat, html, re.I))
    if len(found) < 1:
        return {"status": "empty", "note": "no known tools were recognised on the homepage",
                "payload": {"tools": []}, "items": 0, "complete": True}
    return {"status": "ok", "note": "%d tools recognised on the homepage" % len(found),
            "payload": {"tools": found}, "items": len(found), "complete": True}


_KIND = {n: k for n, k, _p in STACK}


def compare_stack(prev, cur, now):
    day = now.strftime("%Y-%m-%d")
    before, after = set(prev.get("tools") or []), set(cur.get("tools") or [])
    events = []
    for t in sorted(after - before):
        kind = _KIND.get(t, "tool")
        events.append(_event("stack+:" + t, "stack_change", "Now uses %s (%s)" % (t, kind), date=day,
                             summary="Seen for the first time on its homepage: %s." % STACK_MEANING.get(kind, "a new tool")))
    for t in sorted(before - after):
        kind = _KIND.get(t, "tool")
        events.append(_event("stack-:" + t, "stack_change", "No longer uses %s (%s)" % (t, kind), date=day,
                             summary="No longer on its homepage."))
    return events[:6]
