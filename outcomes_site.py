"""outcomes.digital, redesigned in the Northaxis look, at /outcomesdigital (a preview for the Outcomes Digital team).

Unlisted, but for the partner pages (LISTED): nothing on the Northaxis site links here, it is in no sitemap or llms.txt, robots.txt already closes
every path it does not name, and every page and response says noindex. It shares the design system's files
(press.css, site.css, site.js, press-play.js) but nothing that is Northaxis's own: no Northaxis nav, footer,
links or visitor tracking, but for the home page's second slide, which introduces Northaxis as our product
and links to its site. The words are outcomes_content.py's. The forms post to the same intake as
/book, tagged "outcomes digital", so they reach the sheet and Slack.

The partner pages (/outcomesdigital/partners, and /agencies and /consultants under it) moved here from the
Northaxis site's /partners in November 2026; the old addresses send visitors here. Their words are
site_pages.py's (PARTNER_*, AGENCY_*, CONSULTANT_*), and they are the one place here that runs Warmly's
script, once WARMLY_CLIENT_ID is set (WARMLY_PIXEL_PATHS, tracker/warmly_client.py). They are also the only
pages here that search engines may list: they keep the place in Google they had at /partners, so they say
index, carry a canonical address, and are in the Northaxis sitemap and robots.txt (app.py).
"""
from datetime import datetime

from flask import Blueprint, render_template, request

import outcomes_content as od
import site_pages
from tracker import warmly_client as _warmly

PREFIX = "/outcomesdigital"
bp = Blueprint("outcomes", __name__, url_prefix=PREFIX)

# Every page: (address under PREFIX, template, page key, title).
PAGES = [
    ("", "home.html", "home", None),
    ("/about-us", "about.html", "about", "About Us"),
    ("/contact", "contact.html", "contact", "Contact Us"),
    ("/thank-you", "thanks.html", "thanks", "Thank You"),
    ("/case-studies", "case_studies.html", "cases", "Case Studies"),
] + [("/case-study/" + c["slug"], "case_study.html", "case", c["name"]) for c in od.CASES] + \
    [("/" + slug, "service.html", "service", od.SERVICE_PAGES[slug]["page_title"]) for slug, _ in od.SERVICES] + \
    [("/ecommerce-marketing", "ecommerce.html", "ecommerce", "Ecommerce growth that actually pays off"),
     ("/education-marketing", "education.html", "education", "Education Marketing That Fills Seats"),
     ("/real-estate-marketing", "real_estate.html", "real-estate", "Real Estate Marketing Ecosystem"),
     ("/partners", "partners.html", "partners", "Partner with us: agencies and paid media consultants"),
     ("/partners/agencies", "partner_agencies.html", "partner-agencies", "White-label PPC and paid media for agencies"),
     ("/partners/consultants", "partner_consultants.html", "partner-consultants",
      "Partner programme for paid marketing consultants")]

DESCRIPTION = "We don't do marketing. We drive outcomes. " + od.HOME_LEAD

# The pages search engines may list (every other page here says noindex), and what results show for each.
LISTED = {
    PREFIX + "/partners": "Two ways to work with us: white-label Google Ads, Meta and LinkedIn Ads for agencies, "
                          "and a %s recurring commission for consultants." % site_pages.PARTNER_COMMISSION,
    PREFIX + "/partners/agencies": "Google Ads, Meta and LinkedIn Ads for your clients, run by our team under your "
                                   "brand. You keep the client and the margin; no hiring. NDA signed first.",
    PREFIX + "/partners/consultants": "Win the client and stay their lead; our team runs the ads. %s of the client's "
                                      "fee every month they stay, and leads passed to you."
                                      % site_pages.PARTNER_COMMISSION,
}
# The public address a listed page gives as its own canonical one: app.py sets it to its SITE_URL.
SITE_URL = ""


def listed(path):
    """True for a page search engines may list."""
    return path.rstrip("/") in LISTED


def url(path=""):
    """An address on this site."""
    return PREFIX + ("/" + path.strip("/") if path.strip("/") else "")


def inr(n):
    """Rupees with Indian grouping, as the live estimator shows them: 6336000 -> "₹63,36,000"."""
    s = str(int(round(n)))
    head, tail = s[:-3], s[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return "₹" + ",".join(groups + [tail]) if groups else "₹" + tail


def inr_short(n):
    """Rupees in short, as the live estimator writes them: ₹50k, ₹10L, ₹1.5Cr."""
    def fmt(v, places):
        return ("%d" % v) if v == int(v) else ("%." + str(places) + "f") % v
    if n >= 1e7:
        return "₹" + fmt(n / 1e7, 2) + "Cr"
    if n >= 1e5:
        return "₹" + fmt(round(n / 1e5, 1), 1) + "L"
    if n >= 1e3:
        return "₹" + ("%d" % round(n / 1e3) if n >= 1e4 else "%.1f" % (n / 1e3)) + "k"
    return "₹%d" % n


def _render(template, page, title, **kw):
    # Warmly's script, only on the pages WARMLY_PIXEL_PATHS names (the partner pages unless set).
    kw.setdefault("warmly_pixel", _warmly.pixel_id() if _warmly.pixel_on(request.path) else "")
    # A listed page gives its own description and canonical address; a 404 is never listed.
    path = request.path.rstrip("/")
    on_list = listed(path) and page != "404"
    base = SITE_URL or request.url_root.rstrip("/")
    return render_template("outcomes/" + template, od=od, site=site_pages, page=page, url=url, inr=inr, inr_short=inr_short,
                           title=(title + " · " + od.BRAND) if title else od.BRAND + " · " + od.TAGLINE,
                           description=LISTED[path] if on_list else DESCRIPTION,
                           canonical=base + path if on_list else "", year=datetime.now().year, **kw)


@bp.after_request
def _never_listed(resp):
    """Every response here, pages and errors alike, asks search engines not to list or follow it: all but
    the partner pages themselves (LISTED)."""
    if not (resp.status_code == 200 and listed(request.path)):
        resp.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp


@bp.route("", strict_slashes=False)
def home():
    # The home page's second slide introduces Northaxis, our product, and links to its site: the one place
    # on these pages that names or links it.
    return _render("home.html", "home", None, nx_home=(SITE_URL or request.url_root.rstrip("/")) + "/")


@bp.route("/about-us", strict_slashes=False)
def about():
    return _render("about.html", "about", "About Us")


@bp.route("/contact", strict_slashes=False)
def contact():
    return _render("contact.html", "contact", "Contact Us")


@bp.route("/thank-you", strict_slashes=False)
def thanks():
    return _render("thanks.html", "thanks", "Thank You")


@bp.route("/case-studies", strict_slashes=False)
def case_studies():
    return _render("case_studies.html", "cases", "Case Studies")


@bp.route("/case-study/<slug>", strict_slashes=False)
def case_study(slug):
    case = od.CASES_BY_SLUG.get(slug)
    if not case:
        return not_found()
    others = [c for c in od.CASES if c["slug"] != slug][:3]
    return _render("case_study.html", "case", case["name"], case=case, others=others)


def _service(slug):
    return _render("service.html", "service", od.SERVICE_PAGES[slug]["page_title"], s=od.SERVICE_PAGES[slug],
                   slug=slug)


@bp.route("/seo-services", strict_slashes=False)
def seo_services():
    return _service("seo-services")


@bp.route("/ppc-management", strict_slashes=False)
def ppc_management():
    return _service("ppc-management")


@bp.route("/cro-services", strict_slashes=False)
def cro_services():
    return _service("cro-services")


@bp.route("/ecommerce-marketing", strict_slashes=False)
def ecommerce():
    return _render("ecommerce.html", "ecommerce", "Ecommerce growth that actually pays off")


@bp.route("/education-marketing", strict_slashes=False)
def education():
    return _render("education.html", "education", "Education Marketing That Fills Seats")


@bp.route("/real-estate-marketing", strict_slashes=False)
def real_estate():
    return _render("real_estate.html", "real-estate", "Real Estate Marketing Ecosystem")


# The partner pages: (template, page key, title) by address under /partners.
PARTNER_PAGES = {p[len("/partners"):]: (t, k, title) for p, t, k, title in PAGES if p.startswith("/partners")}


@bp.route("/partners", strict_slashes=False)
def partners():
    return _render(*PARTNER_PAGES[""])


@bp.route("/partners/agencies", strict_slashes=False)
def partner_agencies():
    return _render(*PARTNER_PAGES["/agencies"], faqs=site_pages.FAQ_AGENCY)


@bp.route("/partners/consultants", strict_slashes=False)
def partner_consultants():
    return _render(*PARTNER_PAGES["/consultants"], faqs=site_pages.FAQ_CONSULTANT,
                   signals=[site_pages.SIGNALS_BY_SLUG[s] for s in site_pages.CONSULTANT_SIGNALS])


@bp.route("/<path:rest>")
def not_found(rest=""):
    """Any other address under /outcomesdigital: this site's own 404, never the Northaxis one."""
    return _render("404.html", "404", "Page not found"), 404
