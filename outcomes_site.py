"""outcomes.digital, redesigned in the Northaxis look, at /outcomesdigital (a preview for the Outcomes Digital team).

Unlisted: nothing on the Northaxis site links here, it is in no sitemap or llms.txt, robots.txt already closes
every path it does not name, and every page and response says noindex. It shares the design system's files
(press.css, site.css, site.js, press-play.js) but nothing that is Northaxis's own: no Northaxis nav, footer,
links, visitor tracking or Warmly script. The words are outcomes_content.py's. The forms post to the same
intake as /book, tagged "outcomes digital", so they reach the sheet and Slack.
"""
from datetime import datetime

from flask import Blueprint, render_template

import outcomes_content as od
import site_pages

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
     ("/real-estate-marketing", "real_estate.html", "real-estate", "Real Estate Marketing Ecosystem")]

DESCRIPTION = "We don't do marketing. We drive outcomes. " + od.HOME_LEAD


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
    return render_template("outcomes/" + template, od=od, site=site_pages, page=page, url=url, inr=inr, inr_short=inr_short,
                           title=(title + " · " + od.BRAND) if title else od.BRAND + " · " + od.TAGLINE,
                           description=DESCRIPTION, year=datetime.now().year, **kw)


@bp.after_request
def _never_listed(resp):
    """Every response here, pages and errors alike, asks search engines not to list or follow it."""
    resp.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp


@bp.route("", strict_slashes=False)
def home():
    return _render("home.html", "home", None)


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


@bp.route("/<path:rest>")
def not_found(rest=""):
    """Any other address under /outcomesdigital: this site's own 404, never the Northaxis one."""
    return _render("404.html", "404", "Page not found"), 404
