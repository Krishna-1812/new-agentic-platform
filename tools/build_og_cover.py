#!/usr/bin/env python3
"""Render the social card (static/og-cover.png) from the site's own system.

The card a link unfurls into is the first thing most people see, and it is the
one asset that cannot be styled by the stylesheet at view time -- it has to be
a flat 1200x630 image. So it is drawn here, in the same tokens, with the same
two typefaces, and rasterised through a real browser rather than hand-drawn in
a vector editor that will drift from press.css the first time the palette
moves.

    python3 tools/build_og_cover.py

Requires Playwright's Chromium, which is why it is not part of
build_static_site.py: that builder must run anywhere Flask runs.
"""

import asyncio
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from brand import BRAND  # noqa: E402

CARD = """<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..900,0..100,0..1;1,9..144,300..900,0..100,0..1&family=Familjen+Grotesk:wght@400..700&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1200px;height:630px;background:#F1EDE3;color:#14140F;
       font-family:'Familjen Grotesk',system-ui,sans-serif;overflow:hidden}
  .card{height:100%;padding:72px 80px;display:flex;flex-direction:column}
  .top{display:flex;align-items:center;gap:14px}
  .mark{width:18px;height:18px;background:#C6F24E}
  .word{font-family:'Fraunces',serif;font-size:30px;font-weight:600;
        letter-spacing:-.03em;font-variation-settings:'SOFT' 0,'WONK' 0,'opsz' 32}
  .lbl{margin-left:auto;font-size:14px;font-weight:600;letter-spacing:.16em;
       text-transform:uppercase;color:#6B6860}
  /* 1.06, not the site's .94: the marker is a background box on an inline
     box, so on a tight leading it covers the descenders of the line above. */
  h1{margin-top:auto;font-family:'Fraunces',serif;font-size:88px;font-weight:600;
     line-height:1.06;letter-spacing:-.028em;
     font-variation-settings:'SOFT' 0,'WONK' 1,'opsz' 144}
  .it{font-style:italic}
  .mk{background:#C6F24E;color:#14140F;padding:.02em .18em;margin:0 -.06em;
      border-radius:.05em .17em .06em .2em / .17em .06em .2em .05em}
  .rule{height:2px;background:#14140F;margin:44px 0 26px}
  p{font-size:23px;line-height:1.45;color:#55534A;max-width:60ch}
</style></head><body><div class="card">
  <div class="top"><span class="mark"></span><span class="word">__NAME__</span>
    <span class="lbl">Agentic revenue intelligence</span></div>
  <h1>Know who&rsquo;s ready<br>to buy <span class="it">before</span><br>they <span class="mk">raise a hand.</span></h1>
  <div class="rule"></div>
  <p>__SUB__</p>
</div></body></html>"""


async def main():
    from playwright.async_api import async_playwright
    # Not brand.tagline: the tagline restates the headline almost word for
    # word, and a card that says the same thing twice reads as a mistake.
    sub = ("The buying signals that show intent, turned into the next account "
           "for your team to reach.")
    html = CARD.replace("__NAME__", BRAND["name"]).replace("__SUB__", sub)
    tmp = os.path.join(ROOT, "static", "_og_card.html")
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(html)
    out = os.path.join(ROOT, "static", "og-cover.png")
    try:
        async with async_playwright() as p:
            exe = os.environ.get("CHROMIUM_PATH", "/opt/pw-browsers/chromium")
            b = await p.chromium.launch(
                executable_path=exe if os.path.exists(exe) else None,
                args=["--no-sandbox", "--force-color-profile=srgb"])
            ctx = await b.new_context(viewport={"width": 1200, "height": 630},
                                      device_scale_factor=1, ignore_https_errors=True)
            pg = await ctx.new_page()
            await pg.goto("file://" + tmp, wait_until="networkidle")
            # The webfonts decide the whole card; a screenshot taken before
            # they land silently ships the Times fallback.
            await pg.evaluate("document.fonts.ready")
            await pg.wait_for_timeout(900)
            await pg.screenshot(path=out)
            await b.close()
    finally:
        os.remove(tmp)
    print("wrote %s" % out)


if __name__ == "__main__":
    asyncio.run(main())
