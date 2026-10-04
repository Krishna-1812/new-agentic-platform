"""Video Studio: reading a website for a video (plan section 3.1).

read(url, brief) opens the given page in Page Watch's browser reader
(watch_capture, with its safety checks: public addresses only, every request
and redirect checked, cookie banners and chat widgets hidden), then up to
MAX_EXTRA_PAGES more pages of the same site, chosen by how well their link
words match the brief. It returns:

  pages     each page's address, title and text blocks (headings, claims,
            prices, buttons, quotes) with where they sit;
  images    a desktop screenshot of each page (1440 wide), a phone
            screenshot of the first (390 wide), and crops: the hero, each
            section under a heading, and the pricing table when there is one;
  brand     the colours computed from the page's CSS (the most-used
            background, the text colour, the accent from its buttons and
            links), the heading and body fonts, and the logo (a picture of
            the header's logo element).

A site that blocks robots, needs a login or cannot be reached comes back
with ok=False and a sentence saying so; the person can upload screenshots
instead.
"""

from __future__ import annotations

import io
import logging
import re
from urllib.parse import urldefrag, urlsplit

from tracker import watch_capture, watch_safety

log = logging.getLogger("video_studio.site")

MAX_EXTRA_PAGES = 4
DESKTOP = {"width": 1440, "height": 900}
PHONE = {"width": 390, "height": 844}
MAX_CROPS = 12
MAX_CROPS_PER_PAGE = 5
CROP_MAX_H = 1100
CROP_MIN_H = 260
SHOT_MAX_H = 6000
PHONE_MAX_H = 2600
# Links worth reading for a video, and links never worth it.
GOOD_LINK = re.compile(r"pric|plan|feature|product|solution|service|how[- ]it[- ]works|about|platform|"
                       r"customer|case[- ]stud|why|tour|demo|benefit|results|team|career|job", re.I)
BAD_LINK = re.compile(r"log[- ]?in|sign[- ]?in|sign[- ]?up|register|account|cart|checkout|privacy|terms|cookie|"
                      r"legal|gdpr|\.pdf$|\.zip$|mailto:|tel:|javascript:|/feed|/rss|/tag/|/author/|/wp-", re.I)
PRICE = re.compile(r"(?:[$€£₹¥]|rs\.?\s?|inr\s?|usd\s?)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:/\s?mo|per month|"
                   r"/month|/yr|per year|/year)", re.I)
STOP = set("a an and the of to for in on with our your you we is are be it this that from by at as or".split())

_EXTRA_JS = r"""
() => {
  const hex = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat);
    if (p.length >= 4 && p[3] < 0.6) return null;
    return '#' + p.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  };
  const bg = {}; let n = 0;
  for (const el of document.querySelectorAll('body, body *')) {
    if (++n > 4000) break;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 4000) continue;
    const c = hex(getComputedStyle(el).backgroundColor);
    if (c) bg[c] = (bg[c] || 0) + r.width * Math.min(r.height, 2000);
  }
  if (!Object.keys(bg).length) bg['#ffffff'] = 1;
  const accent = {};
  for (const el of document.querySelectorAll('a, button, [role=button], input[type=submit], [class*=btn], [class*=button]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 14) continue;
    const cs = getComputedStyle(el);
    const b = hex(cs.backgroundColor), t = hex(cs.color);
    if (b) accent[b] = (accent[b] || 0) + 3;
    if (t) accent[t] = (accent[t] || 0) + 1;
  }
  const head = document.querySelector('h1') || document.querySelector('h2');
  const para = document.querySelector('main p') || document.querySelector('p') || document.body;
  const font = (el) => el ? getComputedStyle(el).fontFamily : '';
  const links = [];
  for (const a of document.querySelectorAll('a[href]')) {
    if (links.length >= 400) break;
    links.push({href: a.href, text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 80)});
  }
  const hint = /logo|brand/i;
  const cands = [];
  for (const root of [document.querySelector('header'), document.querySelector('nav'), document.body]) {
    if (!root) continue;
    for (const el of root.querySelectorAll('img, svg, a[href="/"], a[href="./"], [class*=logo]')) {
      const r = el.getBoundingClientRect();
      if (r.width < 16 || r.height < 10 || r.width > 520 || r.height > 220 || r.top + scrollY > 400) continue;
      const tag = el.tagName.toLowerCase();
      const words = [el.getAttribute('alt'), el.getAttribute('class'), el.id, el.getAttribute('aria-label'),
                     tag === 'img' ? el.getAttribute('src') : '', el.parentElement && el.parentElement.getAttribute('class')]
                    .join(' ');
      let score = hint.test(words) ? 4 : 0;
      if (tag === 'img' || tag === 'svg') score += 2;
      if (el.closest('header, nav')) score += 2;
      if (el.closest('a[href="/"], a[href="./"]')) score += 3;
      score -= r.top / 200 + r.left / 800;
      cands.push({el, score});
    }
    if (cands.length) break;
  }
  cands.sort((a, b) => b.score - a.score);
  let logo = null;
  if (cands.length && cands[0].score > 1) {
    cands[0].el.setAttribute('data-vs-logo', '1');
    const r = cands[0].el.getBoundingClientRect();
    logo = [Math.round(r.left), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)];
  }
  return {bg, accent, text: hex(getComputedStyle(para).color), heading_font: font(head), body_font: font(para),
          links, logo, lang: document.documentElement.lang || ''};
}
"""


async def _extra(page):
    data = await page.evaluate(_EXTRA_JS)
    data["logo_png"] = None
    if data.get("logo"):
        try:
            data["logo_png"] = await page.locator("[data-vs-logo]").first.screenshot(omit_background=True,
                                                                                    timeout=5000)
        except Exception as exc:
            log.info("logo picture failed: %s", str(exc)[:120])
    return data


# ── Colours ──────────────────────────────────────────────────────────────────
def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def luminance(h):
    def ch(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb(h)
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def saturation(h):
    r, g, b = [c / 255 for c in rgb(h)]
    mx, mn = max(r, g, b), min(r, g, b)
    return 0 if mx == 0 else (mx - mn) / mx


def colours(extra):
    """{"background", "text", "accent"} from what the page's CSS uses most."""
    bg = max((extra.get("bg") or {"#ffffff": 1}).items(), key=lambda kv: kv[1])[0]
    text = extra.get("text") or ("#111111" if luminance(bg) > 0.4 else "#f5f5f5")
    if contrast(bg, text) < 3:
        text = "#111111" if luminance(bg) > 0.4 else "#f5f5f5"
    accent = None
    for c, _ in sorted((extra.get("accent") or {}).items(), key=lambda kv: -kv[1]):
        if saturation(c) >= 0.25 and contrast(c, bg) >= 1.6 and c not in (bg, text):
            accent = c
            break
    return {"background": bg, "text": text, "accent": accent or text}


# ── Choosing pages ───────────────────────────────────────────────────────────
def _words(text):
    return {w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if w not in STOP and len(w) > 2}


def choose_pages(start, links, brief, limit=MAX_EXTRA_PAGES):
    """Up to `limit` same-site links, best match to the brief first."""
    site = watch_safety.site_key(start)
    want = _words(brief)
    seen = {urldefrag(start)[0].rstrip("/")}
    scored = []
    for link in links or []:
        href = urldefrag(str(link.get("href") or ""))[0]
        parts = urlsplit(href)
        if parts.scheme not in ("http", "https") or watch_safety.site_key(href) != site:
            continue
        key = href.rstrip("/")
        if key in seen or BAD_LINK.search(href) or BAD_LINK.search(link.get("text") or ""):
            continue
        seen.add(key)
        label = "%s %s" % (link.get("text") or "", parts.path.replace("/", " ").replace("-", " "))
        score = 3 * len(want & _words(label)) + (2 if GOOD_LINK.search(label) else 0)
        score -= parts.path.count("/") * 0.3 + (1 if parts.query else 0)
        if score > 0:
            scored.append((score, href))
    scored.sort(key=lambda x: -x[0])
    return [h for _, h in scored[:limit]]


# ── Text ─────────────────────────────────────────────────────────────────────
def kind_of(block):
    tag, text = block.get("tag", ""), block.get("text", "")
    if tag in ("h1", "h2", "h3"):
        return tag
    if PRICE.search(text) and len(text) < 160:
        return "price"
    if tag in ("button", "a") and len(text) <= 40:
        return "button"
    if tag == "blockquote" or (re.match(r"^[\"“‘']", text) and len(text) > 40):
        return "quote"
    if tag in ("p", "li", "div", "span", "td") and 20 <= len(text) <= 400:
        return "claim"
    return None


def keep_blocks(blocks, limit=160, chrome=frozenset()):
    """The blocks worth a video, without the site's own navigation and footer
    (`chrome`: texts that repeat on every page read)."""
    out = []
    for b in blocks:
        if b["text"] in chrome:
            continue
        k = kind_of(b)
        if k:
            out.append({"kind": k, "text": b["text"][:400], "box": b.get("box")})
        if len(out) >= limit:
            break
    return out


def site_chrome(pages_blocks):
    """Texts on more than half of the pages read: menus, footers, banners."""
    if len(pages_blocks) < 2:
        return frozenset()
    counts = {}
    for blocks in pages_blocks:
        for t in {b["text"] for b in blocks}:
            counts[t] = counts.get(t, 0) + 1
    return frozenset(t for t, n in counts.items() if n > len(pages_blocks) / 2 and len(t) <= 80)


# ── Pictures ─────────────────────────────────────────────────────────────────
def _jpeg(im, max_w=1440):
    from PIL import Image
    if im.width > max_w:
        im = im.resize((max_w, int(im.height * max_w / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=84, optimize=True)
    return buf.getvalue(), im.width, im.height


def crops(png, blocks, page_name):
    """The hero, one crop per section heading, and the pricing area."""
    from PIL import Image
    im = Image.open(io.BytesIO(png))
    W, H = im.size
    out = [("Hero of %s" % page_name, (0, 0, W, min(H, DESKTOP["height"])))]
    heads = [b for b in blocks if b["kind"] in ("h2", "h3") and b.get("box")]
    heads = sorted(heads, key=lambda b: b["box"][1])
    # Headings side by side (columns, cards) start one crop, not one each.
    rows = []
    for b in heads:
        if rows and b["box"][1] - rows[-1]["box"][1] < 80:
            continue
        rows.append(b)
    heads = rows
    for i, b in enumerate(heads):
        top = max(0, b["box"][1] - 40)
        nxt = heads[i + 1]["box"][1] - 20 if i + 1 < len(heads) else top + CROP_MAX_H
        bottom = min(H, top + CROP_MAX_H, max(nxt, top + CROP_MIN_H))
        if bottom - top >= CROP_MIN_H and top >= DESKTOP["height"] * 0.6:
            out.append(("%s: %s" % (page_name, b["text"][:60]), (0, top, W, bottom)))
    prices = [b for b in blocks if b["kind"] == "price" and b.get("box")]
    if len(prices) >= 2:
        top = max(0, min(b["box"][1] for b in prices) - 220)
        bottom = min(H, max(b["box"][1] + b["box"][3] for b in prices) + 260, top + CROP_MAX_H)
        out.append(("Pricing on %s" % page_name, (0, top, W, bottom)))
    result = []
    for name, box in out[:MAX_CROPS_PER_PAGE]:
        data, w, h = _jpeg(im.crop(box))
        result.append({"kind": "crop", "name": name, "mime": "image/jpeg", "width": w, "height": h, "bytes": data,
                       "data": {"page": page_name, "box": list(box)}})
    return result


def _shot(png, name, max_h, kind="screenshot", extra=None):
    from PIL import Image
    im = Image.open(io.BytesIO(png))
    if im.height > max_h:
        im = im.crop((0, 0, im.width, max_h))
    data, w, h = _jpeg(im)
    return {"kind": kind, "name": name, "mime": "image/jpeg", "width": w, "height": h, "bytes": data,
            "data": extra or {}}


def _page_name(cap, i):
    return (cap.title or urlsplit(cap.final_url or cap.url).path or "page %d" % (i + 1))[:80]


BLOCKED_MESSAGE = ("The website would not let a robot read it (it showed a security check). Upload your own "
                   "screenshots instead, or try another page of the site.")


def _failure(cap):
    if cap.bot_check:
        return BLOCKED_MESSAGE
    if cap.error == "http_403":
        return ("The website refused to show the page to a robot (it answered 'forbidden'). Upload your own "
                "screenshots instead.")
    if cap.error == "http_401":
        return "The website refused to show the page without a login. Upload your own screenshots instead."
    if cap.error == "http_404":
        return "That page does not exist (the site said 'not found'). Check the address."
    if cap.error in ("dns", "connect"):
        return "The website could not be reached. Check the address."
    if cap.error == "timeout":
        return "The website took too long to load. Try again, or upload your own screenshots."
    if cap.error == "empty":
        return "The page loaded but showed no text. Upload your own screenshots instead."
    return "The website could not be read (%s). Upload your own screenshots instead." % (cap.error or "unknown")


def read(url, brief="", *, capture=watch_capture.capture, on_step=None):
    """Read a site for a video. {"ok", "message", "url", "pages", "images", "brand", "logo"}."""
    step = on_step or (lambda *a: None)
    url = watch_safety.normalise(url)
    watch_safety.check(url)
    step("open", url)
    first = capture(url, screenshots=True, control=False, viewport=DESKTOP, extra=_extra)
    if not first.ok:
        return {"ok": False, "message": _failure(first), "url": url, "pages": [], "images": [], "brand": None,
                "logo": None}
    extra = first.extra or {}
    picks = choose_pages(first.final_url or url, extra.get("links"), brief)
    step("pages", "%d more page(s): %s" % (len(picks), ", ".join(picks)))
    caps = [first]
    for link in picks:
        try:
            cap = capture(link, screenshots=True, control=False, viewport=DESKTOP)
        except watch_safety.BadURL:
            continue
        if cap.ok:
            caps.append(cap)
    pages, images = [], []
    step("screenshots", "%d page(s)" % len(caps))
    chrome = site_chrome([c.blocks for c in caps])
    used = set()
    for i, cap in enumerate(caps):
        name = _page_name(cap, i)
        if name in used:                     # two pages with one title: tell them apart by address
            name = "%s (%s)" % (name[:60], urlsplit(cap.final_url or cap.url).path[:40])
        used.add(name)
        blocks = keep_blocks(cap.blocks, chrome=chrome)
        pages.append({"url": cap.final_url or cap.url, "title": cap.title, "blocks": blocks})
        if cap.screenshot:
            images.append(_shot(cap.screenshot, "Desktop: %s" % name, SHOT_MAX_H,
                                extra={"page": name, "url": cap.final_url or cap.url}))
            if sum(im["kind"] == "crop" for im in images) < MAX_CROPS:
                images.extend(crops(cap.screenshot, blocks, name)[:MAX_CROPS - sum(im["kind"] == "crop" for im in images)])
    try:
        phone = capture(first.final_url or url, screenshots=True, control=False, viewport=PHONE)
        if phone.ok and phone.screenshot:
            images.append(_shot(phone.screenshot, "Phone: %s" % _page_name(phone, 0), PHONE_MAX_H,
                                extra={"page": _page_name(phone, 0), "phone": True}))
    except Exception as exc:
        log.info("phone screenshot failed: %s", str(exc)[:160])
    step("brand", "colours, fonts and logo")
    brand = dict(colours(extra), heading_font=extra.get("heading_font") or "", body_font=extra.get("body_font") or "")
    return {"ok": True, "message": "", "url": first.final_url or url, "pages": pages, "images": images,
            "brand": brand, "logo": extra.get("logo_png")}
