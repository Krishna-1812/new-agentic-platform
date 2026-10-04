"""Page Watch: reading a page the way a visitor sees it.

capture(url) opens the page in headless Chromium and returns a Capture:

  * every visible piece of text as a block (a heading, a paragraph, a list
    item, a table cell, a button), with where it sits on the page;
  * a full-page screenshot, and a second "control" screenshot taken a few
    seconds later, so whatever moves on its own (a carousel, a counter) can be
    told apart from a real change;
  * the page's facts: final address, HTTP status, title, height;
  * what was done to make the page stable, and whether it is a bot check.

Two checks of an unchanged page must look the same, so before anything is
read the page is made still: one fixed window size, language and time zone;
animations, transitions and the caret frozen; lazy content scrolled into
view; cookie banners and chat bubbles hidden. Every one of these choices is
in watch_config.

Without a browser (WATCH_BROWSER=off, Playwright missing, or the browser
failing to start) capture() reads the page over plain HTTP instead: text
blocks without positions, and no screenshots. Capture.engine says which.

SAFETY. Users choose the pages and this server opens them. Every request the
browser makes, sub-resources included, is intercepted and made by
Playwright's request client only after watch_safety.allowed() passes, one
redirect hop at a time, the way tracker/lbr_render.py does it. Other schemes
are refused (data: and blob: stay inside the page). WebSockets are answered
locally and never connected; service workers are blocked; downloads are
refused; certificate errors are not ignored. Analytics beacons are dropped so
a check does not count as a visit. Video and audio are not downloaded.
"""

from __future__ import annotations

import asyncio
import importlib.util
import logging
import re
import threading
import time
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

from tracker import watch_config as cfg
from tracker import watch_safety

log = logging.getLogger(__name__)

REDIRECTS = (301, 302, 303, 307, 308)
BEACONS = re.compile(
    r"google-analytics\.com/(?:g/)?collect|analytics\.google\.com/g/collect|stats\.g\.doubleclick\.net|"
    r"facebook\.com/tr[/?]|analytics\.tiktok\.com/api/|px\.ads\.linkedin\.com|bat\.bing\.com/action|"
    r"googleads\.g\.doubleclick\.net/pagead/viewthroughconversion|google\.com/(?:pagead|ccm)/|"
    r"/collect\?v=2|segment\.io/v1/[tp]|api\.segment\.io|plausible\.io/api/event|clarity\.ms/collect|"
    r"hotjar\.com/api|heapanalytics\.com/h", re.I)
SKIP_TYPES = ("media",)
NO_SERVICE_WORKERS = ("try { Object.defineProperty(Navigator.prototype, 'serviceWorker', "
                      "{ get: function () { return undefined; } }); } catch (e) {}")

# Bot checks and block pages, by the words they show. Matched only when the
# page is short, so an article that mentions "captcha" is not a bot check.
BOT_PATTERNS = re.compile(
    r"just a moment\.\.\.|verify (?:you are|you're) (?:a )?human|checking your browser|"
    r"attention required!? \| cloudflare|are you a robot|press (?:&|and) hold|"
    r"pardon our interruption|request unsuccessful\. incapsula|access to this page has been denied|"
    r"click the button below to continue shopping|enable javascript and cookies to continue|"
    r"please complete the security check|unusual traffic from your computer|"
    r"sorry, you have been blocked|you don't have permission to access", re.I)
BOT_MAX_WORDS = 250


@dataclass
class Capture:
    url: str                       # the link asked for
    final_url: str = ""            # where it ended up
    status: int | None = None      # HTTP status of the page itself
    title: str = ""
    engine: str = "browser"        # "browser" | "http"
    blocks: list = field(default_factory=list)   # [{"tag","text","box":[x,y,w,h]|None,"sel"}]
    screenshot: bytes | None = None   # PNG, full page up to MAX_PAGE_HEIGHT
    control: bytes | None = None      # PNG, the same area a few seconds later
    width: int = 0
    height: int = 0                # screenshot height
    page_height: int = 0           # the page's full height, before the cap
    area_box: list | None = None   # the watched area, when one was asked for
    area_found: bool | None = None
    hidden: list = field(default_factory=list)   # overlays hidden before reading
    bot_check: bool = False
    error: str | None = None       # a short code: dns, blocked, timeout, http_4xx...
    error_detail: str = ""
    elapsed_ms: int = 0
    requests: int = 0
    mutation: dict | None = None   # what the accuracy harness's edit script reported
    extra: dict | None = None      # what a caller's `extra` reader returned (Video Studio)

    @property
    def ok(self):
        return self.error is None and not self.bot_check

    def text(self):
        return "\n".join(b["text"] for b in self.blocks)


def browser_available():
    return cfg.browser_enabled() and importlib.util.find_spec("playwright") is not None


def capture(url, *, area=None, screenshots=True, mutate=None, viewport=None, control=True, extra=None):
    """Read `url`. `area` is a CSS selector to watch instead of the whole page.

    Video Studio reads pages with the same browser and the same safety:
    `viewport` reads at another window size (a phone), `control=False` skips
    the second screenshot, and `extra` is an async function given the settled
    page whose result is kept in Capture.extra (links, colours, the logo).

    `mutate` is JavaScript run once the page has settled, before it is read:
    the accuracy harness (tools/watch_accuracy.py) uses it to make known edits.
    It is never set from anything a user sends.

    Never raises for a page problem: the Capture carries `error`. Raises
    watch_safety.BadURL only when the link itself is not allowed.
    """
    watch_safety.check(url)
    started = time.monotonic()
    cap = None
    if browser_available():
        try:
            cap = _run_browser(url, area, screenshots, mutate, viewport, control, extra)
        except _BrowserUnavailable as exc:
            log.warning("watch_capture: no browser (%s); reading %s over HTTP", exc, url)
        except Exception as exc:   # a crash or a hang must not stop the watch
            log.warning("watch_capture: browser failed on %s: %s: %s", url, type(exc).__name__, str(exc)[:200])
            cap = Capture(url=url, error="browser", error_detail="%s: %s" % (type(exc).__name__, str(exc)[:200]))
    if cap is None:
        cap = capture_http(url)
    cap.elapsed_ms = int((time.monotonic() - started) * 1000)
    _classify(cap)
    return cap


def _classify(cap):
    """Bot checks, block pages and error statuses, decided from what was read."""
    words = sum(len(b["text"].split()) for b in cap.blocks)
    sample = " ".join(b["text"] for b in cap.blocks[:80]) + " " + (cap.title or "")
    if words <= BOT_MAX_WORDS and BOT_PATTERNS.search(sample):
        cap.bot_check = True
    if cap.error is None and cap.status and cap.status >= 400:
        cap.error = "http_%d" % cap.status
    if cap.error is None and not cap.bot_check and words == 0:
        cap.error = "empty"
        cap.error_detail = "The page loaded but showed no text."


# ── Browser ──────────────────────────────────────────────────────────────────
class _BrowserUnavailable(Exception):
    pass


_SLOTS = threading.BoundedSemaphore(2)

# Fixed overlays that are not the page: cookie notices and chat bubbles.
# Known containers first; then any fixed or sticky box that mentions cookies
# or consent; then any fixed box covering most of the window (a modal).
HIDE_SELECTORS = [
    "#onetrust-consent-sdk", "#onetrust-banner-sdk", "#CybotCookiebotDialog", "#cookiebanner",
    "#didomi-host", "#truste-consent-track", "#consent_blackbar", ".qc-cmp2-container",
    "#usercentrics-root", "#cmpbox", ".cc-window", ".cookie-banner", "#cookie-banner",
    "#cookie-notice", "#cookie-law-info-bar", ".osano-cm-window", "#hs-eu-cookie-confirmation",
    "#termly-code-snippet-support", ".truste_box_overlay", "#gdpr-cookie-message",
    "#intercom-container", ".intercom-lightweight-app", "#intercom-frame",
    "#hubspot-messages-iframe-container", "#drift-widget", "#drift-frame-controller",
    ".crisp-client", "#launcher", "#fc_frame", "#chat-widget-container", ".zsiq_floatmain",
    "iframe[title*='chat' i]", "iframe[src*='intercom']", "iframe[src*='drift']",
]

_STILL_CSS = """
*, *::before, *::after {
  animation-duration: 0s !important; animation-delay: 0s !important;
  animation-iteration-count: 1 !important; animation-play-state: paused !important;
  transition: none !important; scroll-behavior: auto !important; caret-color: transparent !important;
}
video, audio { visibility: hidden !important; }
"""

# The known banners and widgets, as a stylesheet: a rule also hides one that
# is inserted after the page was checked (consent managers often load late).
_HIDE_CSS = "\n".join("%s { display: none !important; }" % s for s in HIDE_SELECTORS)

_HIDE_JS = r"""
(sels) => {
  const hidden = [];
  const hide = (el, why) => {
    if (!el || el.dataset.pwHidden) return;
    el.dataset.pwHidden = '1';
    el.style.setProperty('display', 'none', 'important');
    hidden.push(why);
  };
  for (const s of sels) {
    try { document.querySelectorAll(s).forEach(el => hide(el, s)); } catch (e) {}
  }
  const vw = innerWidth, vh = innerHeight;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 20) continue;
    const t = (el.innerText || '').slice(0, 2000);
    if (parseFloat(cs.opacity) === 0 || cs.pointerEvents === 'none') continue;
    const cookie = /\b(cookies?|consent|gdpr|privacy preferences|we use)\b/i.test(t) && t.length < 1500;
    const dialog = el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true';
    const modal = cs.position === 'fixed' && r.width * r.height > 0.5 * vw * vh && (dialog || t.trim().length > 20);
    // A small box floating in a bottom corner is a chat or help launcher (it
    // often appears a few seconds after load, so not on every reading).
    const corner = cs.position === 'fixed' && r.width <= 480 && r.height <= 480 &&
        r.bottom >= vh - 48 && r.bottom <= vh + 1 && (r.right >= vw - 48 || r.left <= 48) &&
        r.width < 0.4 * vw;
    if (cookie || modal || corner) hide(el, cookie ? 'cookie notice' : modal ? 'full-screen overlay' : 'corner widget');
  }
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') {
      el.style.setProperty('overflow', 'visible', 'important');
    }
  }
  return hidden;
}
"""

# The page's visible text as blocks. A block is the nearest ancestor of a text
# node that is not displayed inline (inline-block counts as a block, so a
# button or a badge is its own block). Each block's text is only the text that
# belongs to it, not its nested blocks', in reading order. Its box is the union
# of its text's rectangles, in page coordinates.
_BLOCKS_JS = r"""
(limits) => {
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','SVG','IFRAME','OBJECT','CANVAS']);
  const blocks = new Map(); const order = [];
  const owner = (n) => {
    let el = n.parentElement;
    while (el && el !== document.body) {
      const d = getComputedStyle(el).display;
      if (d !== 'contents' && (d && !d.startsWith('inline') || d === 'inline-block' || d === 'inline-flex' || d === 'inline-grid')) return el;
      el = el.parentElement;
    }
    return el || document.body;
  };
  const seen = new WeakMap();
  const visible = (el) => {
    if (!el || el === document.documentElement) return true;
    if (seen.has(el)) return seen.get(el);
    const cs = getComputedStyle(el);
    const v = !(cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0 ||
                SKIP.has(el.tagName.toUpperCase())) && visible(el.parentElement);
    seen.set(el, v);
    return v;
  };
  // A selector that names this one element: built upwards until it matches
  // nothing else on the page (an id that is unique ends it early).
  const unique = (s) => { try { return document.querySelectorAll(s).length === 1; } catch (e) { return false; } };
  const sel = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) {
      if (e === document.body) { parts.unshift('body'); break; }
      let p = e.tagName.toLowerCase();
      if (e.id && /^[A-Za-z][\w-]{0,60}$/.test(e.id) && unique('#' + e.id)) { parts.unshift('#' + e.id); break; }
      const sib = e.parentElement ? [...e.parentElement.children].filter(c => c.tagName === e.tagName) : [];
      if (sib.length > 1) p += ':nth-of-type(' + (sib.indexOf(e) + 1) + ')';
      parts.unshift(p);
      if (parts.length >= 3 && unique(parts.join(' > '))) break;
    }
    return parts.join(' > ');
  };
  // The element's whole path, from the nearest uniquely named ancestor (or
  // the body) down. Unlike sel(), it never stops early, so the paths of two
  // blocks share a start exactly as far as the blocks share ancestors: the
  // area picker (watch_web.area_from_rect) finds their common container so.
  const ids = new Map();
  const path = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) {
      if (e === document.body) { parts.unshift('body'); break; }
      if (e.id && /^[A-Za-z][\w-]{0,60}$/.test(e.id)) {
        if (!ids.has(e.id)) ids.set(e.id, unique('#' + e.id));
        if (ids.get(e.id)) { parts.unshift('#' + e.id); break; }
      }
      let p = e.tagName.toLowerCase();
      const sib = e.parentElement ? [...e.parentElement.children].filter(c => c.tagName === e.tagName) : [];
      if (sib.length > 1) p += ':nth-of-type(' + (sib.indexOf(e) + 1) + ')';
      parts.unshift(p);
    }
    return parts.join(' > ');
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let n, count = 0;
  while ((n = walker.nextNode())) {
    const raw = n.nodeValue;
    if (!raw || !raw.trim()) continue;
    const parent = n.parentElement;
    if (!parent || !visible(parent)) continue;
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
    if (!rects.length) continue;
    const el = owner(n);
    let b = blocks.get(el);
    if (!b) {
      if (order.length >= limits.maxBlocks) continue;
      b = {el, parts: [], x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity};
      blocks.set(el, b); order.push(b);
    }
    b.parts.push(raw);
    for (const r of rects) {
      b.x1 = Math.min(b.x1, r.left + scrollX); b.y1 = Math.min(b.y1, r.top + scrollY);
      b.x2 = Math.max(b.x2, r.right + scrollX); b.y2 = Math.max(b.y2, r.bottom + scrollY);
    }
    if (++count > limits.maxNodes) break;
  }
  return order.map(b => {
    let tag = b.el.tagName.toLowerCase();
    const click = b.el.closest('button,[role=button],a[href],input[type=submit],summary');
    if (click) tag = click.tagName === 'A' ? 'a' : 'button';
    const text = b.parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, limits.maxChars);
    return {tag, text,
            box: [Math.round(b.x1), Math.round(b.y1), Math.round(b.x2 - b.x1), Math.round(b.y2 - b.y1)],
            sel: sel(b.el), path: path(b.el)};
  }).filter(b => b.text && b.box[0] + b.box[2] > 0 && b.box[1] + b.box[3] > 0 && b.box[2] > 1 && b.box[3] > 1);
}
"""

_AREA_JS = r"""
(s) => {
  let el = null;
  try { el = document.querySelector(s); } catch (e) { return null; }
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)];
}
"""


def _run_browser(url, area, screenshots, mutate=None, viewport=None, control=True, extra=None):
    with _SLOTS:
        try:
            return asyncio.run(asyncio.wait_for(_browse(url, area, screenshots, mutate, viewport, control, extra),
                                                cfg.CHECK_TIMEOUT_S))
        except asyncio.TimeoutError:
            return Capture(url=url, error="timeout", error_detail="The page took over %ds." % cfg.CHECK_TIMEOUT_S)


async def _browse(url, area, screenshots, mutate=None, viewport=None, control=True, extra=None):
    viewport = viewport or cfg.VIEWPORT
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise _BrowserUnavailable("playwright not installed") from exc

    cap = Capture(url=url, engine="browser")
    counter = {"n": 0}

    async def guard(route, request):
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
        counter["n"] += 1
        if (scheme not in ("http", "https") or counter["n"] > cfg.MAX_REQUESTS
                or request.resource_type in SKIP_TYPES or BEACONS.search(target)):
            await route.abort()
            return
        # Redirects are followed here, each hop checked, and only the final
        # response is handed back: Chromium would follow one unchecked.
        resp = None
        for _ in range(cfg.MAX_REDIRECTS + 1):
            if not await asyncio.to_thread(watch_safety.allowed, target):
                resp = None
                break
            try:
                resp = await route.fetch(url=target, max_redirects=0, timeout=cfg.NAV_TIMEOUT_MS)
            except Exception:
                resp = None
                break
            location = resp.headers.get("location")
            if resp.status not in REDIRECTS or not location:
                break
            target = urljoin(target, location)
            resp = None
        if resp is None:
            await route.abort("blockedbyclient")
            return
        await route.fulfill(response=resp)

    async with async_playwright() as pw:
        try:
            browser = await pw.chromium.launch(
                headless=True, executable_path=cfg.chromium_path(),
                args=["--disable-dev-shm-usage", "--hide-scrollbars", "--disable-gpu",
                      "--font-render-hinting=none", "--force-color-profile=srgb"])
        except Exception as exc:
            raise _BrowserUnavailable(str(exc)[:200]) from exc
        ctx = None
        try:
            ctx = await browser.new_context(
                viewport=viewport, device_scale_factor=1, locale=cfg.LOCALE, timezone_id=cfg.TIMEZONE,
                user_agent=cfg.USER_AGENT, reduced_motion="reduce", color_scheme="light",
                service_workers="block", accept_downloads=False, ignore_https_errors=False,
                java_script_enabled=True, extra_http_headers={"Accept-Language": "en-US,en;q=0.9"})
            await ctx.add_init_script(NO_SERVICE_WORKERS)
            await ctx.route("**/*", guard)
            await ctx.route_web_socket(re.compile(".*"), lambda ws: None)
            page = await ctx.new_page()
            try:
                resp = await page.goto(url, wait_until="domcontentloaded", timeout=cfg.NAV_TIMEOUT_MS)
            except Exception as exc:
                msg = str(exc)
                cap.error = ("blocked" if "blockedbyclient" in msg.lower() or "ERR_BLOCKED" in msg
                             else "dns" if "ERR_NAME_NOT_RESOLVED" in msg
                             else "ssl" if "ERR_CERT" in msg or "SSL" in msg
                             else "timeout" if "Timeout" in msg
                             else "connect")
                cap.error_detail = msg.splitlines()[0][:200]
                return cap
            cap.status = resp.status if resp else None
            await _settle(page)
            if mutate:
                cap.mutation = await page.evaluate(mutate)
            await page.add_style_tag(content=_STILL_CSS + _HIDE_CSS)
            cap.hidden = await page.evaluate(_HIDE_JS, HIDE_SELECTORS)
            # Lazy images load as they are scrolled to, so some readings would
            # catch them half-loaded: ask for all of them now, then wait.
            await page.evaluate(_EAGER_JS)
            await _scroll_through(page)
            await _images_loaded(page)
            await page.evaluate("document.fonts && document.fonts.ready")
            # Again, for what appeared while scrolling and loading.
            for why in await page.evaluate(_HIDE_JS, HIDE_SELECTORS):
                if why not in cap.hidden:
                    cap.hidden.append(why)
            await page.wait_for_timeout(400)
            cap.final_url = page.url
            cap.title = (await page.title() or "").strip()[:300]
            cap.page_height = int(await page.evaluate(
                "Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)"))
            cap.blocks = await page.evaluate(_BLOCKS_JS, {"maxBlocks": 5000, "maxNodes": 40000, "maxChars": 2000})
            if area:
                cap.area_box = await page.evaluate(_AREA_JS, area)
                cap.area_found = cap.area_box is not None and cap.area_box[2] > 0 and cap.area_box[3] > 0
            if extra:
                cap.extra = await extra(page)
            if screenshots:
                height = max(1, min(cap.page_height or viewport["height"], cfg.MAX_PAGE_HEIGHT))
                clip = {"x": 0, "y": 0, "width": viewport["width"], "height": height}
                cap.screenshot = await page.screenshot(full_page=True, clip=clip, type="png",
                                                       animations="disabled", caret="hide")
                if control:
                    await page.wait_for_timeout(cfg.CONTROL_GAP_MS)
                    cap.control = await page.screenshot(full_page=True, clip=clip, type="png",
                                                        animations="disabled", caret="hide")
                cap.width, cap.height = viewport["width"], height
            cap.requests = counter["n"]
        finally:
            # Requests still in flight when the page closes would otherwise
            # each log "Target page, context or browser has been closed".
            if ctx is not None:
                try:
                    await ctx.unroute_all(behavior="ignoreErrors")
                except Exception:
                    pass
            await browser.close()
    return cap


_EAGER_JS = """() => {
  for (const el of document.querySelectorAll('img[loading="lazy"], iframe[loading="lazy"]')) el.loading = 'eager';
  for (const el of document.querySelectorAll('img[data-src]:not([src]), img[data-src][src=""]')) el.src = el.dataset.src;
}"""


async def _images_loaded(page):
    """Wait (up to IMAGES_MS) until every image on the page has finished loading or failed."""
    try:
        await page.wait_for_function(
            "() => [...document.images].every(i => i.complete)", timeout=cfg.IMAGES_MS, polling=250)
    except Exception:
        pass


async def _settle(page, timeout_ms=None):
    """Wait for the network to go quiet, but never for longer than NETWORK_IDLE_MS."""
    try:
        await page.wait_for_load_state("networkidle", timeout=timeout_ms or cfg.NETWORK_IDLE_MS)
    except Exception:
        pass


async def _scroll_through(page):
    """Scroll down in window-sized steps so lazy content loads, then back to the top."""
    step = cfg.VIEWPORT["height"] - 100
    y = 0
    for _ in range(int(cfg.MAX_PAGE_HEIGHT / step) + 1):
        height = await page.evaluate("document.documentElement.scrollHeight")
        if y >= min(height, cfg.MAX_PAGE_HEIGHT):
            break
        y += step
        await page.evaluate("y => window.scrollTo(0, y)", y)
        await page.wait_for_timeout(150)
    await page.evaluate("window.scrollTo(0, 0)")
    await _settle(page, cfg.SCROLL_IDLE_MS)


# ── Plain HTTP ───────────────────────────────────────────────────────────────
_BLOCK_TAGS = {"p", "div", "li", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article",
               "header", "footer", "nav", "main", "aside", "blockquote", "pre", "dt", "dd", "figcaption",
               "button", "label", "option", "tr", "ul", "ol", "table", "form", "summary", "caption", "br"}
_SKIP_TAGS = {"script", "style", "noscript", "template", "svg", "head", "iframe", "object"}


class _TextBlocks(HTMLParser):
    """Visible text split at block elements, for pages read without a browser."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks, self.buf, self.stack, self.skip, self.title, self.in_title = [], [], [], 0, "", False

    def _flush(self):
        text = re.sub(r"\s+", " ", "".join(self.buf)).strip()
        if text:
            tag = next((t for t in reversed(self.stack) if t in _BLOCK_TAGS), "div")
            self.blocks.append({"tag": tag, "text": text[:2000], "box": None, "sel": ""})
        self.buf = []

    def handle_starttag(self, tag, attrs):
        if tag in _SKIP_TAGS:
            self.skip += 1
        if tag == "title":
            self.in_title = True
        if tag in _BLOCK_TAGS:
            self._flush()
        if tag not in ("br", "img", "input", "meta", "link", "hr"):
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in _SKIP_TAGS and self.skip:
            self.skip -= 1
        if tag == "title":
            self.in_title = False
        if tag in _BLOCK_TAGS:
            self._flush()
        if tag in self.stack:
            while self.stack and self.stack.pop() != tag:
                pass

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        elif not self.skip:
            self.buf.append(data)


def capture_http(url):
    """Read the page without a browser: text blocks, no positions, no screenshots."""
    from tracker import lbr_website
    got = lbr_website.fetch(url)
    cap = Capture(url=url, engine="http", final_url=got.get("url") or url, status=got.get("status"))
    if got.get("error"):
        err = got["error"]
        cap.error = "blocked" if err.startswith("blocked") else err
        cap.error_detail = err
        return cap
    parser = _TextBlocks()
    try:
        parser.feed(got.get("html") or "")
        parser.close()
    except Exception:
        pass
    parser._flush()
    cap.blocks = parser.blocks[:5000]
    cap.title = re.sub(r"\s+", " ", parser.title).strip()[:300]
    return cap
