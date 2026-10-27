#!/usr/bin/env python3
"""Render the social cards from the site's own system.

The card a link unfurls into is the first thing most people see, and it is the
one asset that cannot be styled by the stylesheet at view time -- it has to be
a flat 1200x630 image. So it is drawn here, in the same tokens, with the same
two typefaces, and rasterised through a real browser rather than hand-drawn in
a vector editor that will drift from press.css the first time the palette
moves.

Two cards:
- site: static/og-site.png, the public site's (templates/site/base.html).
- cover: static/og-cover.png, the previous site's (/old-site).

    python3 tools/build_og_cover.py            # both
    python3 tools/build_og_cover.py site       # one

The webfonts are downloaded here, with the certificate checked, and handed to
the browser inline, so the browser needs no network of its own.

Requires Playwright's Chromium, which is why it is not part of
build_static_site.py: that builder must run anywhere Flask runs.
"""

import asyncio
import base64
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from brand import BRAND  # noqa: E402
import site_pages  # noqa: E402

FONTS_CSS = ("https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..900,"
             "0..100,0..1;1,9..144,300..900,0..100,0..1&family=Zalando+Sans:ital,wght@0,300..900;1,300..900"
             "&display=swap")
# Google Fonts answers with woff2 only to a browser it recognises.
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/124.0 Safari/537.36")

CARD = """<!doctype html><html><head><meta charset="utf-8">
<style>
  __FONTS__
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1200px;height:630px;background:#F1EFED;color:#121213;
       font-family:'Zalando Sans',system-ui,sans-serif;overflow:hidden}
  .card{height:100%;padding:72px 80px;display:flex;flex-direction:column}
  .top{display:flex;align-items:center;gap:14px}
  .mark{width:18px;height:18px;border-radius:50%;background:#FF6022}
  .word{font-family:'Fraunces',serif;font-size:30px;font-weight:600;
        letter-spacing:-.03em;font-variation-settings:'SOFT' 0,'WONK' 1,'opsz' 144}
  .lbl{margin-left:auto;font-size:14px;font-weight:500;letter-spacing:.04em;
       text-transform:uppercase;color:#6F6B66}
  /* 1.22, not the site's .94: the marker is a background box on an inline
     box, so on a tight leading it covers the descenders of the line above. */
  h1{margin-top:auto;font-family:'Fraunces',serif;font-size:84px;font-weight:600;
     line-height:1.22;letter-spacing:-.028em;
     font-variation-settings:'SOFT' 0,'WONK' 1,'opsz' 144}
  .it{font-style:italic}
  .mk{background:linear-gradient(90deg,#FF6022 0%,#FF8B5D 100%);color:#121213;
      padding:.02em .14em;margin:0 -.04em;border-radius:.06em}
  .rule{flex:none;height:2px;background:#121213;margin:40px 0 26px}
  p{font-size:23px;line-height:1.45;color:#444444;max-width:60ch}
</style></head><body><div class="card">
  <div class="top"><span class="mark"></span><span class="word">__NAME__</span>
    <span class="lbl">__LABEL__</span></div>
  <h1>__HEADLINE__</h1>
  <div class="rule"></div>
  <p>__SUB__</p>
</div></body></html>"""

CARDS = {
    "site": {
        "out": "og-site.png",
        "label": "GTM engineering &middot; Performance marketing",
        "headline": "Meetings with<br>your buyers, <span class=\"it\">promised</span><br><span class=\"mk\">every month.</span>",
        "sub": ("%s a month for a promised number of meetings. Each missing meeting is credited on your "
                "next bill." % site_pages.GTM_FEE),
    },
    "cover": {
        "out": "og-cover.png",
        "label": "Agentic revenue intelligence",
        "headline": "Know who&rsquo;s ready<br>to buy <span class=\"it\">before</span><br>they <span class=\"mk\">raise a hand.</span>",
        # Not brand.tagline: the tagline restates the headline almost word for
        # word, and a card that says the same thing twice reads as a mistake.
        "sub": "The buying signals that show intent, turned into the next account for your team to reach.",
    },
}


def inline_fonts():
    """The site's two webfonts as @font-face rules with the files inline."""
    import requests
    css = requests.get(FONTS_CSS, headers={"User-Agent": BROWSER_UA}, timeout=30)
    css.raise_for_status()
    text = css.text

    def embed(m):
        font = requests.get(m.group(1), timeout=60)
        font.raise_for_status()
        return "url(data:font/woff2;base64,%s)" % base64.b64encode(font.content).decode()
    return re.sub(r"url\((https://[^)]+)\)", embed, text)


async def render(names):
    from playwright.async_api import async_playwright
    fonts = inline_fonts()
    async with async_playwright() as p:
        exe = os.environ.get("CHROMIUM_PATH", "/opt/pw-browsers/chromium")
        b = await p.chromium.launch(executable_path=exe if os.path.exists(exe) else None,
                                    args=["--force-color-profile=srgb"])
        ctx = await b.new_context(viewport={"width": 1200, "height": 630}, device_scale_factor=1)
        pg = await ctx.new_page()
        for name in names:
            card = CARDS[name]
            await pg.set_content(CARD.replace("__FONTS__", fonts).replace("__NAME__", BRAND["name"])
                                 .replace("__LABEL__", card["label"]).replace("__HEADLINE__", card["headline"])
                                 .replace("__SUB__", card["sub"]))
            # The webfonts decide the whole card; a screenshot taken before
            # they are ready silently ships the Times fallback.
            await pg.evaluate("document.fonts.ready")
            await pg.wait_for_timeout(300)
            out = os.path.join(ROOT, "static", card["out"])
            await pg.screenshot(path=out)
            print("wrote %s" % out)
        await b.close()


if __name__ == "__main__":
    wanted = sys.argv[1:] or list(CARDS)
    unknown = [n for n in wanted if n not in CARDS]
    if unknown:
        sys.exit("unknown card: %s (choose from %s)" % (", ".join(unknown), ", ".join(CARDS)))
    asyncio.run(render(wanted))
