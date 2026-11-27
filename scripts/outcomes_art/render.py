"""Render the /outcomesdigital step images from steps.html into static/outcomes/img/step-1..5.webp.

    python3 scripts/outcomes_art/render.py            # all five
    python3 scripts/outcomes_art/render.py 3          # just step 3

Each is drawn at 1200x800 and saved at 2x (2400x1600), as WebP. Needs Playwright's Chromium and the
network for the site's two Google Fonts.
"""
import io
import os
import pathlib
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent.parent / "static" / "outcomes" / "img"


def render(steps):
    with sync_playwright() as p:
        # A Chromium installed apart from this Playwright (CHROMIUM_PATH, or /opt/pw-browsers/chromium) is used if present.
        exe = os.environ.get("CHROMIUM_PATH") or "/opt/pw-browsers/chromium"
        browser = p.chromium.launch(executable_path=exe) if os.path.exists(exe) else p.chromium.launch()
        page = browser.new_page(viewport={"width": 1200, "height": 800}, device_scale_factor=2)
        for n in steps:
            page.goto((HERE / "steps.html").as_uri() + "?n=%d" % n)
            page.evaluate("document.fonts.ready")
            page.wait_for_timeout(400)
            png = page.screenshot(clip={"x": 0, "y": 0, "width": 1200, "height": 800})
            out = OUT / ("step-%d.webp" % n)
            Image.open(io.BytesIO(png)).convert("RGB").save(out, "WEBP", quality=84, method=6)
            print(out, out.stat().st_size // 1024, "KB")
        browser.close()


if __name__ == "__main__":
    render([int(a) for a in sys.argv[1:]] or [1, 2, 3, 4, 5])
