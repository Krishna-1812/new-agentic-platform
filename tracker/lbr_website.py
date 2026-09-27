"""Local Business Radar, stage 3: what each business has for a website.

First, what the profile links to, before anything is fetched:

  none                 no website on the profile                   -> build one
  social_only          a Facebook / Instagram / Linktree page       -> build one
  listing_only         a booking or directory page (Zocdoc, Vagaro,
                       Yelp...) that the business does not control  -> build one
  google_site_retired  a business.site address. Google shut these
                       free sites down in March 2024; the links now
                       go nowhere                                   -> build one, urgently

Then the site itself is fetched (the home page, and a contact page when the
home page shows no email) and classified:

  dead | broken | parked | ssl_error | ok

For a working site: HTTPS, mobile viewport, title and description, the
builder it is made with, click-to-call, a contact form, an email address,
LocalBusiness structured data, how recently it was touched (the copyright
year), and which marketing tags it carries (Google Analytics / Tag Manager /
Ads, Meta and TikTok pixels, call tracking). No Google Ads or Meta tag on a
working site is a business that has never run paid media there.

PageSpeed Insights (mobile) adds the performance and SEO scores and Core Web
Vitals when a key is configured; without one those checks are "not checked".

SAFETY: the URLs come from Google profiles, which anyone can edit, and this
server fetches them. Every hop, redirects included, must be http(s) to a
host that resolves only to public addresses; private, loopback, link-local
and cloud-metadata addresses are refused before a connection is made.
(The check resolves the name just before the request does; a DNS answer
that changes between the two is not caught. Pinning the connection to the
checked address would need a custom transport adapter.)
"""

import ipaddress
import re
import socket
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import requests

from tracker import lbr_config, lbr_http

FETCH_TIMEOUT = 12
MAX_BYTES = 1_500_000
MAX_REDIRECTS = 5
WORKERS = 8
PSI_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"
PSI_TIMEOUT = 70
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/129.0 Safari/537.36 LocalBusinessRadar/1.0")

SOCIAL_HOSTS = ("facebook.com", "fb.com", "instagram.com", "linktr.ee", "tiktok.com", "x.com",
                "twitter.com", "youtube.com", "linkedin.com", "nextdoor.com", "pinterest.com")
LISTING_HOSTS = ("yelp.com", "zocdoc.com", "healthgrades.com", "vagaro.com", "booksy.com",
                 "schedulicity.com", "styleseat.com", "mindbodyonline.com", "opentable.com",
                 "toasttab.com", "doordash.com", "ubereats.com", "grubhub.com", "angi.com",
                 "homeadvisor.com", "thumbtack.com", "houzz.com", "bbb.org", "yellowpages.com",
                 "calendly.com", "square.site", "setmore.com", "acuityscheduling.com", "genbook.com")


class Blocked(Exception):
    """A URL this server must not fetch."""


# ── Where a link points ──────────────────────────────────────────────────────
def _host(url):
    try:
        return (urlparse(url).hostname or "").lower().rstrip(".")
    except ValueError:
        return ""


def _on(host, domains):
    return any(host == d or host.endswith("." + d) for d in domains)


def classify_link(url):
    """What the profile's website link is, without fetching it."""
    if not url:
        return "none"
    host = _host(url if "//" in url else "https://" + url)
    if not host:
        return "none"
    if host == "business.site" or host.endswith(".business.site"):
        return "google_site_retired"
    if _on(host, SOCIAL_HOSTS):
        return "social_only"
    if _on(host, LISTING_HOSTS):
        return "listing_only"
    return "site"


# ── Safe fetching ────────────────────────────────────────────────────────────
def _resolve(host):
    return {ai[4][0] for ai in socket.getaddrinfo(host, None)}


def check_public(url):
    """Raise Blocked unless `url` is http(s) to a host with only public addresses."""
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        raise Blocked("not http(s)")
    host = (p.hostname or "").rstrip(".")
    if not host or host == "localhost" or host.endswith(".localhost") or host.endswith(".internal"):
        raise Blocked("internal host")
    try:
        addrs = {str(ipaddress.ip_address(host.strip("[]")))}   # an IP literal needs no lookup
    except ValueError:
        addrs = None
    try:
        addrs = addrs or _resolve(host)
    except (socket.gaierror, UnicodeError) as exc:
        raise requests.ConnectionError("DNS: %s" % exc)
    if not addrs:
        raise requests.ConnectionError("DNS: no address")
    for a in addrs:
        ip = ipaddress.ip_address(a.split("%")[0])
        if not ip.is_global or ip.is_multicast:
            raise Blocked("resolves to a non-public address")


def fetch(url):
    """GET a page, following redirects by hand so every hop is checked.

    Returns {"url", "status", "https", "html", "redirects", "error"}.
    """
    out = {"url": url, "status": None, "https": url.startswith("https://"), "html": "",
           "redirects": 0, "error": None, "elapsed_ms": None}
    current = url
    for hop in range(MAX_REDIRECTS + 1):
        try:
            check_public(current)
        except Blocked as exc:
            out["error"] = "blocked: %s" % exc
            return out
        except requests.ConnectionError as exc:
            out["error"] = "dns"
            return out
        try:
            resp = lbr_http.session().get(current, timeout=FETCH_TIMEOUT, allow_redirects=False,
                                          stream=True, headers={"User-Agent": BROWSER_UA,
                                                                "Accept": "text/html,*/*;q=0.8"})
        except requests.exceptions.SSLError:
            out["error"] = "ssl"
            return out
        except requests.RequestException as exc:
            out["error"] = "connect" if isinstance(exc, requests.ConnectionError) else "timeout"
            return out
        if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("Location"):
            current = urljoin(current, resp.headers["Location"])
            out["redirects"] = hop + 1
            continue
        out.update(url=current, status=resp.status_code, https=current.startswith("https://"))
        try:
            out["elapsed_ms"] = int(resp.elapsed.total_seconds() * 1000)
        except AttributeError:
            pass
        body, size = [], 0
        for chunk in resp.iter_content(65536):
            body.append(chunk)
            size += len(chunk)
            if size >= MAX_BYTES:
                break
        raw = b"".join(body)
        enc = getattr(resp, "encoding", None) or "utf-8"
        out["html"] = raw.decode(enc, errors="replace")
        return out
    out["error"] = "redirect_loop"
    return out


# ── Reading a page ───────────────────────────────────────────────────────────
class _Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title, self._in_title, self._in_ld = "", False, False
        self.meta, self.links, self.h1, self.forms = {}, [], 0, []
        self.jsonld, self._ld_buf, self.scripts = [], [], []
        self._form = None

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            name = (a.get("name") or a.get("property") or a.get("http-equiv") or "").lower()
            if name:
                self.meta[name] = a.get("content", "")
        elif tag == "a" and a.get("href"):
            self.links.append(a["href"].strip())
        elif tag == "h1":
            self.h1 += 1
        elif tag == "script":
            if "ld+json" in a.get("type", "").lower():
                self._in_ld, self._ld_buf = True, []
            if a.get("src"):
                self.scripts.append(a["src"])
        elif tag == "form":
            self._form = {"email": False, "textarea": False}
        elif tag in ("input", "textarea") and self._form is not None:
            if tag == "textarea" or a.get("type", "").lower() == "email" or "email" in a.get("name", "").lower():
                self._form["email" if tag != "textarea" else "textarea"] = True

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag == "script" and self._in_ld:
            self._in_ld = False
            self.jsonld.append("".join(self._ld_buf))
        elif tag == "form" and self._form is not None:
            self.forms.append(self._form)
            self._form = None

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if self._in_ld:
            self._ld_buf.append(data)


EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}")
BAD_EMAIL = re.compile(r"(\.(png|jpe?g|gif|webp|svg)$|sentry|wixpress|example\.|domain\.com|"
                       r"yourdomain|email\.com$|@2x)", re.I)
TAGS = {
    "google_analytics": [r"gtag/js\?id=G-", r"['\"]G-[A-Z0-9]{6,}['\"]", r"google-analytics\.com/analytics\.js",
                         r"['\"]UA-\d{4,}-\d+['\"]"],
    "google_tag_manager": [r"googletagmanager\.com/gtm\.js", r"GTM-[A-Z0-9]{4,}"],
    "google_ads": [r"['\"]AW-\d{6,}", r"googleadservices\.com/pagead/conversion"],
    "meta_pixel": [r"connect\.facebook\.net/[^\"']*/fbevents\.js", r"fbq\(\s*['\"]init"],
    "tiktok_pixel": [r"analytics\.tiktok\.com"],
    "linkedin_insight": [r"snap\.licdn\.com"],
    "call_tracking": [r"cdn\.callrail\.com", r"calltrackingmetrics", r"\.whatconverts\.com"],
    "chat_widget": [r"widget\.intercom\.io", r"js\.driftt\.com", r"embed\.tawk\.to", r"podium\.com",
                    r"birdeye", r"livechatinc\.com"],
}
BUILDERS = [("Wix", r"static\.wixstatic\.com|wix\.com/"), ("Squarespace", r"static1\.squarespace\.com|squarespace"),
            ("GoDaddy Website Builder", r"img1\.wsimg\.com|godaddy website builder"),
            ("Shopify", r"cdn\.shopify\.com"), ("Webflow", r"webflow\.(com|io)"),
            ("Duda", r"multiscreensite|dudaone|irp\.cdn-website\.com"), ("Weebly", r"weebly\.com"),
            ("WordPress", r"wp-content|wp-includes"), ("Joomla", r"/media/jui/|joomla"),
            ("Drupal", r"drupal\.js|/sites/default/files")]
BOOKING = re.compile(r"calendly\.com|zocdoc\.com|vagaro\.com|booksy\.com|opentable\.com|resy\.com|"
                     r"acuityscheduling|squareup\.com/appointments|mindbodyonline|schedulicity|"
                     r"housecallpro|servicetitan|jobber\.com|nexhealth|localmed|weave", re.I)
SOCIAL_LINK = {"facebook": "facebook.com", "instagram": "instagram.com", "linkedin": "linkedin.com",
               "youtube": "youtube.com", "tiktok": "tiktok.com", "x": ("twitter.com", "x.com")}
PARKED = re.compile(r"domain (?:name )?(?:is|may be) for sale|buy this domain|parked free|"
                    r"sedoparking|hugedomains|dan\.com|this domain is parked|domain parking", re.I)
LOCAL_SCHEMA = re.compile(r'"@type"\s*:\s*"(LocalBusiness|Dentist|Physician|MedicalBusiness|'
                          r'MedicalClinic|Plumber|Electrician|HVACBusiness|RoofingContractor|'
                          r'HomeAndConstructionBusiness|AutoRepair|AutomotiveBusiness|LegalService|'
                          r'Attorney|AccountingService|FinancialService|InsuranceAgency|RealEstateAgent|'
                          r'HairSalon|BeautySalon|NailSalon|DaySpa|HealthAndBeautyBusiness|'
                          r'ExerciseGym|SportsActivityLocation|Restaurant|FoodEstablishment|CafeOrCoffeeShop|'
                          r'Bakery|BarOrPub|Store|VeterinaryCare|ChildCare|Locksmith|MovingCompany|'
                          r'ProfessionalService|HomeGoodsStore|LodgingBusiness|Hotel)"', re.I)


def read_page(html, base_url):
    """Everything the audit needs from one HTML page."""
    p = _Page()
    try:
        p.feed(html)
    except Exception:  # malformed markup: keep what was read
        pass
    lower = html.lower()
    host = _host(base_url)
    tags = sorted(k for k, pats in TAGS.items() if any(re.search(pt, html, re.I) for pt in pats))
    builder = next((name for name, rx in BUILDERS if re.search(rx, lower)), "")
    gen = p.meta.get("generator", "")
    if not builder and gen:
        builder = gen.split(" ")[0][:30]
    emails = []
    for href in p.links:
        if href.lower().startswith("mailto:"):
            emails.append(href[7:].split("?")[0].strip())
    emails += EMAIL_RE.findall(re.sub(r"<[^>]+>", " ", html))
    emails = [e.lower() for e in dict.fromkeys(emails) if e and not BAD_EMAIL.search(e)][:5]
    socials = {}
    for href in p.links:
        h = _host(urljoin(base_url, href))
        for name, dom in SOCIAL_LINK.items():
            doms = dom if isinstance(dom, tuple) else (dom,)
            if _on(h, doms) and name not in socials:
                socials[name] = urljoin(base_url, href)
    years = [int(y) for y in re.findall(r"(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d{2})", lower)]
    contact = next((urljoin(base_url, l) for l in p.links
                    if "contact" in l.lower() and _host(urljoin(base_url, l)) == host), "")
    return {
        "title": re.sub(r"\s+", " ", p.title).strip()[:160],
        "description": p.meta.get("description", "")[:300],
        "viewport": "width=device-width" in p.meta.get("viewport", "").replace(" ", ""),
        "h1": p.h1,
        "tel_link": any(l.lower().startswith("tel:") for l in p.links),
        "form": any(f["email"] or f["textarea"] for f in p.forms),
        "emails": emails,
        "booking": bool(BOOKING.search(html)),
        "socials": socials,
        "local_schema": bool(LOCAL_SCHEMA.search(html)),
        "jsonld": bool(p.jsonld),
        "tags": tags,
        "builder": builder,
        "copyright_year": max(years) if years else None,
        "contact_url": contact,
        "parked": bool(PARKED.search(html)) and len(html) < 60000,
        "words": len(re.sub(r"<[^>]+>", " ", html).split()),
    }


# ── PageSpeed ────────────────────────────────────────────────────────────────
def pagespeed(url, ledger):
    """Mobile Lighthouse scores and field Core Web Vitals, or None when unavailable."""
    key = lbr_config.key_for("pagespeed")
    if not key:
        return None
    params = [("url", url), ("strategy", "mobile"), ("category", "performance"),
              ("category", "seo"), ("key", key)]
    try:
        data = lbr_http.call(ledger, "pagespeed", "run", "GET", PSI_URL, params=params,
                             timeout=PSI_TIMEOUT, retries=1, price_op="pagespeed.run")
    except lbr_http.ToolError as exc:
        return {"error": str(exc)}
    lh = data.get("lighthouseResult") or {}
    cats = lh.get("categories") or {}
    audits = lh.get("audits") or {}

    def score(name):
        s = (cats.get(name) or {}).get("score")
        return round(s * 100) if isinstance(s, (int, float)) else None

    def num(name):
        v = (audits.get(name) or {}).get("numericValue")
        return round(v, 3) if isinstance(v, (int, float)) else None
    field = ((data.get("loadingExperience") or {}).get("overall_category") or "").lower() or None
    return {"performance": score("performance"), "seo": score("seo"),
            "lcp_ms": num("largest-contentful-paint"), "cls": num("cumulative-layout-shift"),
            "tbt_ms": num("total-blocking-time"), "field": field}


# ── One business ─────────────────────────────────────────────────────────────
def _issue(key, severity, text):
    return {"key": key, "severity": severity, "text": text}


VERDICT_TEXT = {
    "none": "No website at all.",
    "social_only": "Only a social media page stands in for a website.",
    "listing_only": "Only a booking or directory page they do not control stands in for a website.",
    "google_site_retired": "Links to a business.site page. Google shut those sites down in 2024, "
                           "so the link on their profile goes nowhere.",
    "dead": "The website does not load (the domain does not resolve or refuses connections).",
    "broken": "The website returns an error page.",
    "parked": "The domain is parked or for sale; there is no real site.",
    "ssl_error": "The website's security certificate is broken; browsers warn visitors away.",
    "blocked": "The link could not be checked.",
}


def audit(prof, ledger):
    """The website finding for one business."""
    link = prof.get("website") or ""
    kind = classify_link(link)
    out = {"link": link, "kind": kind, "needs_site": kind != "site", "issues": [], "checks": {},
           "score": None, "tags": [], "emails": [], "socials": {}, "speed": None}
    if kind != "site":
        out["issues"].append(_issue(kind, "high", VERDICT_TEXT[kind]))
        return out
    url = link if "//" in link else "https://" + link
    page = fetch(url)
    if page["error"] or page["status"] is None:
        err = page["error"] or "connect"
        kind = "ssl_error" if err == "ssl" else "blocked" if err.startswith("blocked") else "dead"
    elif page["status"] >= 400:
        kind = "broken"
    else:
        info = read_page(page["html"], page["url"])
        final_kind = classify_link(page["url"])
        kind = final_kind if final_kind != "site" else ("parked" if info["parked"] else "ok")
    out.update(kind=kind, final_url=page["url"], status=page["status"], needs_site=kind != "ok")
    if kind != "ok":
        out["issues"].append(_issue(kind, "high", VERDICT_TEXT.get(kind, "The website could not be read.")))
        return out

    if not info["emails"] and info["contact_url"]:
        contact = fetch(info["contact_url"])
        if not contact["error"] and (contact["status"] or 500) < 400:
            more = read_page(contact["html"], contact["url"])
            info["emails"] = more["emails"]
            info["form"] = info["form"] or more["form"]
            info["tel_link"] = info["tel_link"] or more["tel_link"]
    speed = pagespeed(page["url"], ledger)
    this_year = datetime.now(timezone.utc).year
    yr = info["copyright_year"]
    checks = {
        "https": page["https"],
        "mobile": info["viewport"],
        "title": bool(info["title"]),
        "meta_description": bool(info["description"]),
        "h1": info["h1"] >= 1,
        "click_to_call": info["tel_link"],
        "contact_form": info["form"],
        "email": bool(info["emails"]),
        "local_schema": info["local_schema"],
        "fresh": None if yr is None else yr >= this_year - 1,
        "analytics": any(t in info["tags"] for t in ("google_analytics", "google_tag_manager")),
    }
    weights = {"https": 12, "mobile": 14, "title": 6, "meta_description": 6, "h1": 4, "click_to_call": 10,
               "contact_form": 8, "email": 4, "local_schema": 8, "fresh": 8, "analytics": 5}
    perf = (speed or {}).get("performance")
    if perf is not None:
        checks["speed"] = perf >= 50
        weights["speed"] = 15
    known = {k: v for k, v in checks.items() if v is not None}
    total = sum(weights[k] for k in known)
    got = sum(weights[k] for k, v in known.items() if v)
    if perf is not None and perf < 50:
        got += weights["speed"] * max(0, perf) / 100   # partial credit on a slow site
    score = round(100 * got / total) if total else None

    iss = out["issues"]
    if not checks["https"]:
        iss.append(_issue("https", "high", "No HTTPS: browsers mark the site \"Not secure\"."))
    if not checks["mobile"]:
        iss.append(_issue("mobile", "high", "Not built for phones (no mobile viewport)."))
    if perf is not None and perf < 50:
        iss.append(_issue("speed", "high" if perf < 30 else "medium",
                          "Slow on mobile: PageSpeed performance %d/100." % perf))
    if not checks["click_to_call"]:
        iss.append(_issue("click_to_call", "medium", "No tap-to-call phone link."))
    if not (checks["contact_form"] or info["booking"]):
        iss.append(_issue("contact_form", "medium", "No contact form or online booking."))
    if not checks["local_schema"]:
        iss.append(_issue("local_schema", "medium", "No LocalBusiness structured data for Google."))
    if not checks["meta_description"] or not checks["title"]:
        iss.append(_issue("meta", "low", "Missing a page title or meta description."))
    if checks["fresh"] is False:
        iss.append(_issue("fresh", "medium", "Looks untouched since %d (copyright year)." % yr))
    if not checks["analytics"]:
        iss.append(_issue("analytics", "low", "No analytics: they cannot see where visitors come from."))
    out.update(checks=checks, score=score, speed=speed, tags=info["tags"], emails=info["emails"],
               socials=info["socials"], builder=info["builder"], booking=info["booking"],
               title=info["title"], copyright_year=yr,
               runs_ads=any(t in info["tags"] for t in ("google_ads", "meta_pixel", "tiktok_pixel")))
    return out


def run(selected, profiles, ledger, *, on_progress=None, should_stop=None):
    """Audit every selected business's website. Returns {place_id: finding}."""
    ids = [pid for pid in selected if pid in profiles]
    results = {}

    def one(pid):
        if should_stop and should_stop():
            return pid, None
        try:
            return pid, audit(profiles[pid], ledger)
        except Exception as exc:  # one odd site must never end the run
            return pid, {"link": profiles[pid].get("website"), "kind": "blocked", "needs_site": False,
                         "issues": [_issue("blocked", "low", "The website could not be read.")],
                         "error": type(exc).__name__}
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for i, (pid, res) in enumerate(pool.map(one, ids), 1):
            if res is not None:
                results[pid] = res
            if on_progress and i % 10 == 0:
                on_progress({"stage": "website", "done": i, "of": len(ids)})
    return results
