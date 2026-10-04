"""Drive Video Studio's whole journey in a real browser (Phase 4's check).

    python3 scripts/drive_video_studio.py [--out DIR] [--widths 1440,390]

It runs the website on a local port with the in-process store, signed in as
a test person, and a stand-in worker beside it: Claude, the website reader
and the video engine are stand-ins (the plan, the review and a real small
MP4 made with ffmpeg), so the drive needs no key and no network. Everything
the person touches is real: the pages, the script, the routes, the store.

At each width it makes three videos, a website brief, an uploads-only brief
and a numbers brief, and for each: writes the brief, picks a starting point,
adds the sources, makes the plan, edits it (words, a new scene, the seconds,
the order, a picture, the brand), approves it, watches it being made, and on
the result copies the share text, makes a change and another shape. Then the
library (filters, Duplicate) and the saved brands.

It fails (exit 1) on any script error, any failed request the page did not
ask to fail, any sideways scrolling, or any internal detail on a page.
Screenshots of every step go to --out.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tests"))
for k, v in (("GOOGLE_CLIENT_ID", "drive"), ("GOOGLE_CLIENT_SECRET", "drive"), ("FLASK_SECRET_KEY", "drive")):
    os.environ.setdefault(k, v)
os.environ.pop("DATABASE_URL", None)
os.environ["ANTHROPIC_API_KEY"] = "drive-not-a-real-key"
os.environ["VIDEO_STUDIO"] = "off"

from PIL import Image, ImageDraw  # noqa: E402

EMAIL = "drive@markifydigital.com"
BASE = "/strategic-agents/video-studio"
INTERNAL = ("claude-sonnet", "claude-opus", "anthropic_api_key", "video_claude", "railway", "hyperframes",
            "watch_worker", "chromium", "drive-not-a-real-key")


# ── Stand-ins for the worker's outside world ─────────────────────────────────
def picture(w, h, colour, text, bg=(245, 243, 238)):
    im = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, max(40, h // 12)], fill=colour)
    d.rectangle([w // 12, h // 4, w // 2, h // 4 + h // 10], fill=(30, 30, 30))
    for i in range(5):
        d.rectangle([w // 12, h // 2 + i * h // 14, w - w // 6, h // 2 + i * h // 14 + h // 40], fill=(190, 190, 190))
    d.text((w // 12 + 8, h // 4 + 8), text, fill=(255, 255, 255))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def read_site(url, brief, on_step=None):
    step = on_step or (lambda *a: None)
    step("open", url)
    time.sleep(1.2)
    step("pages", "2 more page(s): /features, /pricing")
    time.sleep(1.0)
    step("screenshots", "3 page(s)")
    time.sleep(0.8)
    step("brand", "colours, fonts and logo")
    shots = [("Desktop: Home", picture(1440, 2000, (124, 92, 255), "Close tracker")),
             ("Desktop: Pricing", picture(1440, 1800, (124, 92, 255), "Pricing")),
             ("Phone: Home", picture(390, 1400, (124, 92, 255), "Close tracker"))]
    images = [{"kind": "screenshot", "name": n, "mime": "image/png", "width": 1440 if "Desktop" in n else 390,
               "height": 2000, "bytes": b, "data": {"phone": "Phone" in n}} for n, b in shots]
    pages = [{"url": url, "title": "Acme close tracker", "blocks": [
        {"kind": "h1", "text": "Close your books in five days"},
        {"kind": "p", "text": "Acme tracks every month-end task, owner and deadline in one place."},
        {"kind": "p", "text": "Start free for 14 days."}]}]
    return {"ok": True, "message": "", "url": url, "pages": pages, "images": images, "logo": None,
            "brand": {"background": "#0B1020", "text": "#F5F5F5", "accent": "#7C5CFF", "heading_font": "Inter",
                      "body_font": "Inter"}}


class Claude:
    """The plan stand-in for plan calls, the review stand-in for review calls."""

    def __init__(self):
        from video_fakes import FakeClaude
        from test_video_build import ToolClaude
        self.plan, self.review = FakeClaude(), ToolClaude([])
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **kw):
        time.sleep(1.5)
        return (self.review if kw.get("tools") else self.plan).create(**kw)


from test_video_build import JobBox  # noqa: E402


class Box(JobBox):
    """A sandbox stand-in with a real project folder: checks pass, frames are
    pictures, the MP4 is real (ffmpeg)."""
    blocked = []
    shape = None

    def write(self, files):
        super().write(files)
        html = files.get("index.html") or b""
        html = html.decode() if isinstance(html, bytes) else html
        import re
        m = re.search(r'data-width="(\d+)" data-height="(\d+)"', html)
        self.shape = (int(m.group(1)), int(m.group(2))) if m else (1920, 1080)

    def check(self, at=None, timeout=None):
        time.sleep(1.0)
        return {"ok": True, "errors": [], "warnings": []}

    def snapshot(self, times, timeout=None):
        time.sleep(1.0)
        w, h = self.shape or (1920, 1080)
        return [picture(w // 2, h // 2, (124, 92, 255), "Frame %.1f s" % t, bg=(11, 16, 32)) for t in times]

    def render(self, seconds, quality="high", timeout=None):
        w, h = self.shape or (1920, 1080)
        out = os.path.join(self.root, "out.mp4")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i",
                        "color=c=0x7c5cff:s=%dx%d:d=2" % (w // 8 * 2, h // 8 * 2), "-pix_fmt", "yuv420p",
                        # VP9: the test browser has no H.264 decoder (Chrome, Edge and Safari do,
                        # and the real renderer makes H.264).
                        "-c:v", "libvpx-vp9", "-b:v", "200k", out], check=True)
        time.sleep(1.0)
        with open(out, "rb") as fh:
            return fh.read()

    def cover(self, mp4, at):
        w, h = self.shape or (1920, 1080)
        im = Image.new("RGB", (w // 4, h // 4), (124, 92, 255))
        buf = io.BytesIO()
        im.save(buf, "JPEG")
        return buf.getvalue()


def worker(stop):
    """The worker's own job runner (lease, renewal, crash handling) with the stand-ins."""
    from tracker import video_builder, video_planner, video_render, video_worker
    claude = Claude()

    def run(job, stop=None):
        if job["kind"] == "plan":
            return video_planner.run_job(job, client=claude, read_site=read_site)
        if job["kind"] in ("build", "change"):
            return video_builder.run_job(job, stop=stop, client=claude, sandbox=Box)
        return video_render.run_job(job, stop=stop, sandbox=Box)
    runner = video_worker.VideoRunner("drive", stopping=stop, run=run)
    runner.record_engine = lambda: None
    while not stop.is_set():
        if not runner.process_one():
            time.sleep(0.4)


def serve(port):
    import app as appmod
    from tracker import watch_safety
    from werkzeug.serving import make_server
    appmod._get_user = lambda: {"email": EMAIL, "name": "Drive"}
    watch_safety.check = lambda url: None
    import logging
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    srv = make_server("127.0.0.1", port, appmod.app, threaded=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


# ── The drive ────────────────────────────────────────────────────────────────
class Drive:
    def __init__(self, page, width, out, origin):
        self.page, self.width, self.out, self.origin = page, width, out, origin
        self.problems, self.n = [], 0
        self.allowed_fail = 0
        page.on("console", lambda m: m.type == "error" and self.problems.append("console: %s" % m.text))
        page.on("pageerror", lambda e: self.problems.append("script error: %s" % e))
        page.on("response", self._response)

    def _response(self, r):
        if r.status >= 400 and r.url.startswith(self.origin):
            if self.allowed_fail:
                self.allowed_fail -= 1
            else:
                self.problems.append("HTTP %d %s" % (r.status, r.url))

    def shot(self, name):
        self.n += 1
        self.page.screenshot(path=os.path.join(self.out, "%d-%02d-%s.png" % (self.width, self.n, name)), full_page=True)
        self.no_sideways(name)
        body = self.page.content().lower()
        for word in INTERNAL:
            if word in body:
                self.problems.append("%s: the page names an internal detail (%s)" % (name, word))

    def no_sideways(self, name):
        over = self.page.evaluate("""() => {
            const w = document.documentElement.clientWidth;
            if (document.documentElement.scrollWidth <= w + 1) return null;
            const wide = [...document.querySelectorAll('body *')].filter(e => {
              const r = e.getBoundingClientRect(); return r.right > w + 1 && r.width > 0 && getComputedStyle(e).position !== 'fixed';
            }).slice(0, 4).map(e => e.tagName.toLowerCase() + '.' + (e.className || '').toString().split(' ')[0]);
            return document.documentElement.scrollWidth + ' > ' + w + ': ' + wide.join(', ');
        }""")
        if over:
            self.problems.append("%s at %d wide scrolls sideways (%s)" % (name, self.width, over))

    def start(self, brief, kind, setup, label):
        p = self.page
        p.goto(self.origin + BASE)
        p.fill("#vs-brief", brief)
        p.click('.vs-start[data-key="%s"]' % kind)
        setup(p)
        self.shot(label + "-start")
        p.click("#vs-go")
        p.wait_for_url("**/videos/*", timeout=30000)
        seen_reading = False
        try:
            p.wait_for_selector(".vs-reading .vs-steps", timeout=4000)
            seen_reading = True
            self.shot(label + "-reading")
        except Exception:
            pass
        p.wait_for_selector(".vs-scene", timeout=60000)
        if not seen_reading:
            self.problems.append("%s: the reading steps were never seen" % label)
        self.shot(label + "-plan")

    def saved(self):
        self.page.wait_for_function("() => /All changes saved|to fix/.test(document.querySelector('.vs-save').textContent)",
                                    timeout=15000)

    def edit_plan(self, label, swap_picture=False):
        p = self.page
        first = p.locator(".vs-scene").first.locator(".vs-tf input, .vs-tf textarea").first
        first.fill("Close your books in five days")
        self.saved()
        p.click(".vs-add-scene")
        p.wait_for_selector(".vs-menu")
        p.locator(".vs-menu-i", has_text="Words").first.click()
        new = p.locator(".vs-scene").nth(p.locator(".vs-scene").count() - 2)
        new.locator(".vs-tf input").first.fill("One place for every task")
        self.saved()
        if p.locator(".vs-fit").count():
            p.click(".vs-fit")
        self.saved()
        p.locator(".vs-scene").nth(1).get_by_role("button", name="Move scene 2 down").click()
        self.saved()
        if swap_picture and p.locator(".vs-pic:not(.vs-pic--add)").count():
            p.locator(".vs-pic:not(.vs-pic--add)").first.click()
            p.wait_for_selector(".vs-picker")
            self.shot(label + "-picker")
            p.locator(".vs-pick").last.click()
            self.saved()
        if p.locator(".vs-colour-pick input").count():
            p.evaluate("""() => { const i = document.querySelectorAll('.vs-colour-pick input')[2];
                                  i.value = '#ff6022'; i.dispatchEvent(new Event('change', {bubbles: true})); }""")
            self.saved()
        problems = p.locator(".vs-note--bad li").all_inner_texts()
        if problems:
            self.problems.append("%s: the edited plan has problems: %s" % (label, "; ".join(problems)))
        self.shot(label + "-edited")

    def make(self, label, change=True, shape=None):
        p = self.page
        p.get_by_role("button", name="Approve and make the video").click()
        p.wait_for_selector(".vs-making", timeout=20000)
        self.shot(label + "-making")
        try:
            p.wait_for_selector(".vs-frames figure", timeout=30000)
            self.shot(label + "-frames")
        except Exception:
            self.problems.append("%s: no key frames were shown while making" % label)
        p.wait_for_selector(".vs-player video", timeout=90000)
        ok = p.evaluate("""() => new Promise(r => { const v = document.querySelector('.vs-player video');
            if (v.readyState >= 1) return r(v.duration > 0);
            v.addEventListener('loadedmetadata', () => r(v.duration > 0)); setTimeout(() => r(false), 8000); })""")
        if not ok:
            self.problems.append("%s: the video did not load in the player" % label)
        self.shot(label + "-result")
        if p.locator(".vs-share-row .vs-tool").count():
            p.locator(".vs-share-row .vs-tool").first.click()
            p.wait_for_function("() => [...document.querySelectorAll('.vs-share-row .vs-tool')].some(b => b.textContent === 'Copied')",
                                timeout=5000)
        else:
            self.problems.append("%s: no share text on the result" % label)
        if change:
            p.fill(".vs-changes textarea", "Slower, and end on 'Start free'")
            p.get_by_role("button", name="Make the change").click()
            p.wait_for_selector(".vs-making", timeout=20000)
            p.wait_for_selector(".vs-player video", timeout=90000)
            if p.locator(".vs-ver").count() < 2:
                self.problems.append("%s: the change did not make a new version" % label)
            self.shot(label + "-changed")
        if shape:
            p.locator(".vs-shape-btns button", has_text=shape).click()
            p.wait_for_selector(".vs-making", timeout=20000)
            p.wait_for_selector(".vs-player video", timeout=90000)
            self.shot(label + "-shape")
        # An older version opens from the versions rail.
        p.locator(".vs-ver").first.click()
        p.wait_for_function("() => document.querySelector('.vs-ver').classList.contains('is-on')", timeout=10000)

    def library_and_brands(self):
        p = self.page
        p.goto(self.origin + BASE)
        p.wait_for_selector(".vs-card")
        n = p.locator(".vs-card").count()
        p.locator("#vs-kinds .sa-chip").nth(1).click()
        if p.locator(".vs-card").count() >= n and n > 1 and p.locator("#vs-kinds .sa-chip").count() > 2:
            self.problems.append("the kind filter did not filter")
        self.shot("library")
        p.locator("#vs-kinds .sa-chip").first.click()
        p.locator(".vs-dup").first.click()
        p.wait_for_url("**/videos/*", timeout=20000)
        p.wait_for_selector(".vs-scene", timeout=60000)
        self.shot("duplicate")
        p.goto(self.origin + BASE + "/brands")
        p.wait_for_selector(".vs-brand-card")
        if not p.locator(".vs-brand-card h2", has_text="Acme").count():
            self.problems.append("the website's brand was not saved for Acme")
        card = p.locator(".vs-brand-card").last
        card.locator("input:not([type=color]):not([type=file])").first.fill("Drive Client %d" % self.width)
        card.get_by_role("button", name="Save the brand").click()
        p.wait_for_selector(".vs-brand-card h2 >> text=Drive Client %d" % self.width, timeout=10000)
        self.shot("brands")


def journey(page, width, out, origin, files):
    d = Drive(page, width, out, origin)

    def website(p):
        p.fill("#vs-website", "acme.example")
        p.fill("#vs-client", "Acme")
        p.locator("#vs-words button", has_text="Write them for me").click()

    def uploads(p):
        p.set_input_files("#vs-files", files)
        p.click("#vs-add-text")
        p.locator(".vs-block textarea").last.fill("We are hiring a senior product designer in Bengaluru. "
                                                   "Apply by emailing jobs@acme.example.")
        p.locator(".vs-shape", has_text="Vertical").click()

    def numbers(p):
        p.click("#vs-add-table")
        p.locator(".vs-block textarea").last.fill("Month\tLeads\nJuly\t420\nAugust\t515\nSeptember\t597")
        p.fill("#vs-seconds", "24")
        p.locator("#vs-styles button", has_text="Corporate").click()

    d.start("A 20-second launch video for Acme's close tracker, ending on 'Start free'.", "launch", website, "website")
    d.edit_plan("website")
    d.make("website", change=True)
    d.start("A vertical hiring post for a senior product designer at Acme.", "hiring", uploads, "uploads")
    d.edit_plan("uploads", swap_picture=True)
    d.make("uploads", change=False)
    d.start("Show our Q3 results: leads went from 420 in July to 597 in September.", "results", numbers, "numbers")
    d.edit_plan("numbers")
    d.make("numbers", change=False, shape="Landscape")
    d.library_and_brands()
    return d.problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(tempfile.gettempdir(), "vs-drive"))
    ap.add_argument("--widths", default="1440,390")
    ap.add_argument("--port", type=int, default=5077)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    srv = serve(args.port)
    stop = threading.Event()
    threading.Thread(target=worker, args=(stop,), daemon=True).start()
    files = []
    for i, (name, colour) in enumerate((("team-photo.png", (40, 120, 90)), ("office.png", (200, 120, 40)),
                                        ("acme-logo.png", (124, 92, 255)))):
        path = os.path.join(args.out, name)
        with open(path, "wb") as fh:
            fh.write(picture(1200, 800 if i < 2 else 300, colour, name))
        files.append(path)
    from playwright.sync_api import sync_playwright
    problems = {}
    try:
        with sync_playwright() as pw:
            try:
                browser = pw.chromium.launch()
            except Exception:                       # the installed browser build, as the worker finds it
                from tracker import video_config
                browser = pw.chromium.launch(executable_path=video_config.browser_path())
            for w in [int(x) for x in args.widths.split(",")]:
                ctx = browser.new_context(viewport={"width": w, "height": 900 if w > 600 else 844},
                                          device_scale_factor=1, permissions=["clipboard-read", "clipboard-write"])
                page = ctx.new_page()
                page.set_default_timeout(20000)
                started = time.monotonic()
                try:
                    problems[w] = journey(page, w, args.out, "http://127.0.0.1:%d" % args.port, files)
                except Exception as exc:
                    page.screenshot(path=os.path.join(args.out, "%d-failed.png" % w), full_page=True)
                    problems[w] = ["the drive stopped: %s" % str(exc).splitlines()[0]]
                print("%d wide: %d problem(s) in %.0f s" % (w, len(problems[w]), time.monotonic() - started))
                ctx.close()
            browser.close()
    finally:
        stop.set()
        srv.shutdown()
    bad = {w: p for w, p in problems.items() if p}
    print(json.dumps(bad or "no problems", indent=1))
    print("screenshots in", args.out)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
