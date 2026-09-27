"""Local Business Radar: reading a website in a real browser (crawl4ai).

lbr_website fetches each business's site with a plain HTTP request, which
does not run JavaScript. That misreads three kinds of site:

  * sites built as JavaScript apps (React, Vue, some builders), whose HTML
    is an empty shell until the browser runs it: no title, no phone link,
    no form, so the audit scores them as thin;
  * sites whose marketing tags are loaded by Google Tag Manager, where the
    HTML shows only GTM and the Meta pixel or Google Ads tag it loads is
    invisible, so the business looks as if it has never run paid media;
  * sites that refuse a script's request (401/403/429) but serve a browser,
    which the plain fetch would call broken.

For those, and only those, the page is loaded again in headless Chromium
through crawl4ai (https://github.com/unclecode/crawl4ai), and the rendered
HTML plus the addresses the page requested are read instead.

crawl4ai is optional. Without it, or without a browser, or with
LBR_RENDER=off, render() returns None and the plain reading stands.
On Railway the browser is installed by Railpack when the service has
RAILPACK_PYTHON_PLAYWRIGHT_INSTALL=1 (https://railpack.com/languages/python).

SAFETY. The addresses come from Google profiles that anyone can edit, and a
browser follows redirects, loads sub-resources and runs the page's scripts.
So the browser never touches the network itself:

  * every http(s) request, sub-resources included, is intercepted and made
    by Playwright's request client after lbr_website.check_public passes,
    one hop at a time (max_redirects=0); a redirect is handed back to the
    browser, which requests the next address through the same check;
  * other schemes are refused, except data: and blob:, which stay inside
    the page;
  * WebSockets are answered locally and never connected; service workers,
    whose requests are not intercepted, are switched off before any script
    runs;
  * certificate errors are not ignored: crawl4ai launches Chromium with
    --ignore-certificate-errors, which is removed here, and the request
    client checks certificates (ignore_https_errors=False);
  * images, media and fonts are not downloaded, and analytics beacons are
    recorded but not sent, so the visit does not count in the business's
    analytics.
"""

import asyncio
import importlib.util
import logging
import os
import re
import threading
from urllib.parse import urljoin, urlparse

log = logging.getLogger(__name__)

PAGE_TIMEOUT_MS = 25000
RENDER_TIMEOUT = 45
SETTLE_SECONDS = 1.5
MAX_REQUESTS = 400
MAX_REDIRECTS = 5
REDIRECTS = (301, 302, 303, 307, 308)
CONCURRENCY = int(os.environ.get("LBR_RENDER_CONCURRENCY") or 2)
SKIP_TYPES = ("image", "media", "font")
# Collection endpoints: seen (they prove the tag fires), never sent.
BEACONS = re.compile(r"google-analytics\.com/(?:g/)?collect|analytics\.google\.com/g/collect|"
                     r"stats\.g\.doubleclick\.net|facebook\.com/tr[/?]|analytics\.tiktok\.com/api/|"
                     r"px\.ads\.linkedin\.com|googleads\.g\.doubleclick\.net/pagead/viewthroughconversion|"
                     r"google\.com/(?:pagead|ccm)/", re.I)
# Launch flags crawl4ai adds that this module does not want: certificate
# checks stay on, and the browser does not hide that it is automated.
DROP_ARGS = ("--ignore-certificate-errors", "--disable-blink-features=AutomationControlled")
NO_SERVICE_WORKERS = ("try { Object.defineProperty(Navigator.prototype, 'serviceWorker', "
                      "{ get: function () { return undefined; } }); } catch (e) {}")

_SLOTS = threading.BoundedSemaphore(max(1, CONCURRENCY))


def installed():
    return importlib.util.find_spec("crawl4ai") is not None


def enabled():
    return (os.environ.get("LBR_RENDER") or "").strip().lower() not in ("off", "0", "false", "no") and installed()


# ── When a page needs a browser ──────────────────────────────────────────────
_STRIP = re.compile(r"<(script|style|noscript|template)\b.*?</\1\s*>", re.I | re.S)
APP_ROOT = re.compile(r"<div[^>]+id=[\"'](?:root|app|__next|___gatsby|__nuxt|q-app|svelte)[\"']", re.I)
NEEDS_JS = re.compile(r"(?:enable|requires?|turn on)\s+javascript|javascript (?:is )?(?:required|disabled)", re.I)
GTM = re.compile(r"googletagmanager\.com/gtm\.js|GTM-[A-Z0-9]{4,}")
PAID_TAGS = ("google_ads", "meta_pixel", "tiktok_pixel")


def visible_words(html):
    text = re.sub(r"<[^>]+>", " ", _STRIP.sub(" ", html or ""))
    return len(text.split())


def reason(page, info):
    """Why a plainly fetched page should be read again in a browser, or ""."""
    status = page.get("status")
    if page.get("error"):
        return ""
    if status in (401, 403, 429):
        return "refused"
    if status is None or status >= 400:
        return ""
    html = page.get("html") or ""
    words = visible_words(html)
    if words < 250 and (APP_ROOT.search(html) or NEEDS_JS.search(html)):
        return "script_app"
    if words < 80 and "<script" in html.lower():
        return "script_app"
    if info is not None and GTM.search(html) and not any(t in info.get("tags", ()) for t in PAID_TAGS):
        return "tag_manager"
    return ""


# ── The browser ──────────────────────────────────────────────────────────────
def safe_args(args):
    """Chromium launch flags without the ones in DROP_ARGS."""
    return [a for a in args if not a.startswith(DROP_ARGS)]


def _allowed(url):
    from tracker import lbr_website
    try:
        lbr_website.check_public(url)
        return True
    except Exception:
        return False


async def _render(url, user_agent):
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig

    seen = []

    async def guard(route, request):
        # A request still in flight when the page closes fails to answer; that
        # must not fail the render.
        try:
            await _guard(route, request)
        except Exception:
            try:
                await route.abort()
            except Exception:
                pass

    async def _guard(route, request):
        target = request.url
        scheme = urlparse(target).scheme
        if scheme in ("data", "blob"):
            await route.continue_()
            return
        if len(seen) < MAX_REQUESTS:
            seen.append(target)
        if scheme not in ("http", "https") or request.resource_type in SKIP_TYPES or BEACONS.search(target):
            await route.abort()
            return
        # A redirect handed back to Chromium would be followed by Chromium itself,
        # unchecked; so redirects are followed here, each hop checked, and only
        # the final response is handed back.
        resp = None
        for _ in range(MAX_REDIRECTS + 1):
            if not await asyncio.to_thread(_allowed, target):
                break
            try:
                resp = await route.fetch(url=target, max_redirects=0, timeout=PAGE_TIMEOUT_MS)
            except Exception:
                resp = None
                break
            location = resp.headers.get("location")
            if resp.status not in REDIRECTS or not location:
                break
            target = urljoin(target, location)
            if len(seen) < MAX_REQUESTS:
                seen.append(target)
            resp = None
        if resp is None:
            await route.abort("blockedbyclient")
            return
        await route.fulfill(response=resp)

    async def on_context(page, context=None, **_):
        await context.route("**/*", guard)
        await context.route_web_socket(re.compile(".*"), lambda ws: None)   # never connected
        return page

    browser = BrowserConfig(headless=True, verbose=False, ignore_https_errors=False, user_agent=user_agent,
                            viewport_width=1280, viewport_height=900, java_script_enabled=True,
                            init_scripts=[NO_SERVICE_WORKERS])
    run = CrawlerRunConfig(cache_mode=CacheMode.BYPASS, wait_until="load", page_timeout=PAGE_TIMEOUT_MS,
                           delay_before_return_html=SETTLE_SECONDS, verbose=False)
    crawler = AsyncWebCrawler(config=browser)
    strategy = crawler.crawler_strategy
    manager = strategy.browser_manager
    build = manager._build_browser_args

    def safer_args():
        out = build()
        out["args"] = safe_args(out.get("args", []))
        return out
    manager._build_browser_args = safer_args
    strategy.set_hook("on_page_context_created", on_context)
    await crawler.start()
    try:
        result = await crawler.arun(url, config=run)
    finally:
        await crawler.close()
    final = result.redirected_url or result.url or url
    html = result.html or ""
    out = {"url": final, "status": result.status_code, "https": final.startswith("https://"),
           "html": html, "requests": seen, "error": None}
    # crawl4ai marks a very short page as "blocked by anti-bot protection"; a
    # page that loaded is still read, and judged by lbr_website like any other.
    if not html or (result.status_code or 0) >= 400:
        out["error"] = (result.error_message or "render failed")[:300]
    return out


def render(url, user_agent=None):
    """Load `url` in headless Chromium. {"url", "status", "https", "html", "requests", "error"}.

    None when rendering is off or unavailable; the caller keeps its own reading.
    """
    if not enabled() or not _allowed(url):
        return None
    from tracker import lbr_website
    with _SLOTS:
        try:
            return asyncio.run(asyncio.wait_for(_render(url, user_agent or lbr_website.BROWSER_UA),
                                                RENDER_TIMEOUT))
        except Exception as exc:  # no browser, a crash, a timeout: keep the plain reading
            log.warning("lbr_render: %s could not be rendered: %s: %s", url, type(exc).__name__,
                        str(exc)[:200])
            return None


def selftest():
    """(ok, detail) for the connection check: can a browser start here? ok is None when off."""
    if (os.environ.get("LBR_RENDER") or "").strip().lower() in ("off", "0", "false", "no"):
        return None, "Switched off (LBR_RENDER=off). Websites are read without a browser."
    if not installed():
        return None, "crawl4ai is not installed. Websites are read without a browser."
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            pw.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"]).close()
    except Exception as exc:
        log.warning("lbr_render: no browser: %s", str(exc)[:300])
        return False, ("crawl4ai is installed but Chromium could not start (%s). On Railway, add the variable "
                       "RAILPACK_PYTHON_PLAYWRIGHT_INSTALL=1 and redeploy. Until then websites are read "
                       "without a browser." % type(exc).__name__)
    return True, "Headless Chromium started. JavaScript sites and tag-manager tags are read in a browser."
