"""Video Studio: hand-written test compositions for the render engine.

Phase 1's proof that the worker can render (docs/video-studio-plan.md):

  title_image_end   10 s landscape: a title, an image, an end card.
  chart_vertical    45 s vertical: a title, a bar chart drawn from numbers,
                    a big number, a list, an end card.

And two drills for the sandbox, run from the staff page:

  outside_drill     the 10 s video, with an image and a request that try to
                    reach the internet. It must render without them, and the
                    job's log must name the addresses that were refused.
  hang_drill        a page that never finishes loading, with a short time
                    limit. The render must be stopped at that limit.

Each sample returns {"files", "shape", "duration_s", "cover_at", "title"},
the same shape a planned video has once it is built.
"""

from __future__ import annotations

import base64
import io

def _fonts():
    from tracker import video_fonts
    return video_fonts.font_css(["Fraunces", "DM Sans"])


PALETTE = """
:root { --paper: #F4EFE6; --ink: #1B1A17; --ink2: #4B473F; --forest: #183A2C; --honey: #C8892B;
        --honey2: #E2B158; --on: #F6F1E6; --on2: #D3DDD0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
.clip { position: absolute; inset: 0; }
.serif { font-family: "Fraunces", serif; font-weight: 600; letter-spacing: -0.02em; }
.line { display: block; overflow: hidden; padding: 0.04em 0 0.12em; }
.w { display: inline-block; }
"""


def _page(width, height, duration, body, script, extra_css="", head_extra=""):
    return """<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=%(w)d, height=%(h)d" />
    <script src="kit/gsap.min.js"></script>%(head_extra)s
    <style>%(fonts)s%(palette)s
      html, body { width: %(w)dpx; height: %(h)dpx; overflow: hidden; background: var(--forest); }
      #root { position: relative; width: 100%%; height: 100%%; overflow: hidden; font-family: "DM Sans", sans-serif; color: var(--on); }
%(css)s
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="%(d)s" data-width="%(w)d" data-height="%(h)d">
%(body)s
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      const words = (sel, at, st) => tl.fromTo(sel, { yPercent: 118 }, { yPercent: 0, duration: 0.7, ease: "power4.out", stagger: st || 0.07 }, at);
      const out = (sel, at) => tl.to(sel, { opacity: 0, y: -30, duration: 0.3, ease: "power2.in" }, at);
%(script)s
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
""" % {"w": width, "h": height, "d": _num(duration), "fonts": _fonts(), "palette": PALETTE, "css": extra_css,
       "body": body, "script": script, "head_extra": head_extra}


def _num(x):
    return ("%.2f" % x).rstrip("0").rstrip(".")


def _words(text, cls=""):
    return " ".join('<span class="w%s">%s</span>' % (" " + cls if cls else "", w) for w in text.split())


def sample_image(width=1600, height=1000):
    """A made-up landscape picture (no file or licence needed): JPEG bytes."""
    from PIL import Image, ImageDraw, ImageFilter
    im = Image.new("RGB", (width, height))
    px = ImageDraw.Draw(im)
    for y in range(height):
        t = y / height
        px.line([(0, y), (width, y)], fill=(int(226 - 120 * t), int(177 - 60 * t), int(88 + 20 * t)))
    for i, (cx, h, col) in enumerate(((0.2, 0.55, (34, 74, 56)), (0.55, 0.42, (24, 58, 44)), (0.85, 0.6, (40, 86, 64)))):
        x = int(cx * width)
        px.polygon([(x - int(0.45 * width), height), (x, int(h * height)), (x + int(0.45 * width), height)], fill=col)
    px.ellipse([int(0.66 * width), int(0.14 * height), int(0.78 * width), int(0.14 * height) + int(0.12 * width)],
               fill=(248, 232, 196))
    im = im.filter(ImageFilter.GaussianBlur(1.2))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=86)
    return buf.getvalue()


def _b64(data):
    return {"b64": base64.b64encode(data).decode("ascii")}


# ── 10 s landscape: title, image, end card ───────────────────────────────────
def title_image_end(extra_body="", extra_script=""):
    css = """
      .bg { position: absolute; inset: 0; background: var(--forest); }
      #s1 .copy { position: absolute; left: 140px; right: 140px; top: 330px; }
      #s1 .label { font-size: 30px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--honey2); opacity: 0; }
      #s1 h1 { margin-top: 26px; font-size: 128px; line-height: 1.02; }
      #s1 .it { font-style: italic; color: var(--honey2); }
      #s2 .photo { position: absolute; left: 120px; top: 120px; width: 1060px; height: 840px; border-radius: 32px; overflow: hidden; background: #2a4a3a; }
      #s2 .photo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      #s2 .cap { position: absolute; left: 1260px; right: 120px; top: 380px; }
      #s2 .cap h2 { font-size: 78px; line-height: 1.04; }
      #s2 .cap p { margin-top: 26px; font-size: 32px; line-height: 1.4; color: var(--on2); opacity: 0; }
      #s3 { background: var(--paper); color: var(--ink); }
      #s3 .copy { position: absolute; left: 0; right: 0; top: 360px; text-align: center; }
      #s3 h2 { font-size: 104px; line-height: 1.02; }
      #s3 .cta { display: inline-flex; align-items: center; margin-top: 54px; height: 96px; padding: 0 52px; border-radius: 999px; background: var(--forest); color: var(--on); font-size: 36px; font-weight: 700; opacity: 0; }
"""
    body = """
      <section id="s1" class="clip" data-start="0" data-duration="3.4" data-track-index="0">
        <div class="bg"></div>
        <div class="copy">
          <div class="label" id="s1-label">Video Studio · engine test</div>
          <h1 class="serif"><span class="line">%s</span><span class="line">%s</span></h1>
        </div>
      </section>
      <section id="s2" class="clip" data-start="3.3" data-duration="3.5" data-track-index="1">
        <div class="bg"></div>
        <div class="photo" id="s2-ph"><img id="s2-img" src="media/hills.jpg" alt="" /></div>
        <div class="cap"><h2 class="serif"><span class="line">%s</span><span class="line">%s</span></h2>
          <p id="s2-p">An image with slow motion and a caption.</p></div>
      </section>
      <section id="s3" class="clip" data-start="6.7" data-duration="3.3" data-track-index="0">
        <div class="copy"><h2 class="serif"><span class="line">%s</span></h2>
          <span class="cta" id="s3-cta">The end card</span></div>
      </section>%s
""" % (_words("Rendered on"), _words("the worker.", "it"), _words("Real pictures,"), _words("gently moving."),
       _words("Ready to share."), extra_body)
    script = """
      tl.fromTo("#s1-label", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 0.2);
      words("#s1 .line:nth-child(1) .w", 0.45);
      words("#s1 .line:nth-child(2) .w", 0.8);
      out("#s1 .copy", 3.0);
      tl.fromTo("#s2-ph", { clipPath: "inset(100% 0% 0% 0% round 32px)" }, { clipPath: "inset(0% 0% 0% 0% round 32px)", duration: 0.7, ease: "power3.inOut" }, 3.3);
      tl.fromTo("#s2-img", { scale: 1.14 }, { scale: 1.02, duration: 3.5, ease: "none" }, 3.3);
      words("#s2 .line:nth-child(1) .w", 3.7);
      words("#s2 .line:nth-child(2) .w", 3.95);
      tl.fromTo("#s2-p", { opacity: 0 }, { opacity: 1, duration: 0.5 }, 4.4);
      tl.fromTo("#s3", { clipPath: "inset(100% 0% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.55, ease: "power3.inOut" }, 6.7);
      words("#s3 .w", 7.1);
      tl.fromTo("#s3-cta", { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.8)" }, 7.6);
""" + extra_script
    files = {"index.html": {"text": _page(1920, 1080, 10, body, script, css)},
             "media/hills.jpg": _b64(sample_image())}
    return {"title": "Engine test: title, image, end card (10 s, landscape)", "files": files, "shape": "landscape",
            "duration_s": 10.0, "cover_at": 1.9}


# ── 45 s vertical: a chart and more ──────────────────────────────────────────
CHART = (("Jan", 120), ("Feb", 164), ("Mar", 151), ("Apr", 208), ("May", 247), ("Jun", 290))


def chart_vertical():
    top = max(v for _, v in CHART)
    bars = "\n".join(
        '<div class="bar" id="b%d"><div class="val">%d</div><div class="fill" style="height:%dpx"></div>'
        '<div class="lab">%s</div></div>' % (i, v, int(820 * v / top), m) for i, (m, v) in enumerate(CHART))
    css = """
      .bg { position: absolute; inset: 0; background: var(--forest); }
      .paper { background: var(--paper); color: var(--ink); }
      .it { font-style: italic; color: var(--honey2); }
      .paper .it { color: #93601A; }
      #s1 .copy { position: absolute; left: 90px; right: 90px; top: 700px; }
      #s1 h1 { font-size: 132px; line-height: 1.0; }
      #s2 h2, #s4 h2 { position: absolute; left: 90px; right: 90px; top: 190px; font-size: 84px; line-height: 1.04; }
      #s2 .chart { position: absolute; left: 90px; right: 90px; bottom: 260px; height: 1100px; display: flex; align-items: flex-end; gap: 26px; }
      #s2 .bar { flex: 1 1 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
      #s2 .fill { width: 100%; border-radius: 18px 18px 6px 6px; background: var(--forest); transform-origin: 50% 100%; }
      #s2 .bar:last-child .fill { background: var(--honey); }
      #s2 .val { font-size: 40px; font-weight: 700; margin-bottom: 14px; color: var(--ink); }
      #s2 .lab { margin-top: 18px; font-size: 34px; font-weight: 600; color: var(--ink2); }
      #s3 .num { position: absolute; left: 0; right: 0; top: 640px; text-align: center; font-size: 300px; line-height: 1; color: var(--honey2); }
      #s3 p { position: absolute; left: 120px; right: 120px; top: 1010px; text-align: center; font-size: 52px; line-height: 1.25; }
      #s4 ol { position: absolute; left: 90px; right: 90px; top: 560px; list-style: none; display: grid; gap: 40px; }
      #s4 li { display: flex; align-items: center; gap: 34px; font-size: 52px; font-weight: 600; opacity: 0; }
      #s4 li b { flex: 0 0 auto; width: 104px; height: 104px; border-radius: 28px; background: var(--honey); color: var(--forest); display: flex; align-items: center; justify-content: center; font-family: "Fraunces", serif; font-size: 52px; }
      #s5 .copy { position: absolute; left: 0; right: 0; top: 760px; text-align: center; }
      #s5 h2 { font-size: 112px; line-height: 1.02; }
      #s5 .cta { display: inline-flex; align-items: center; margin-top: 64px; height: 120px; padding: 0 64px; border-radius: 999px; background: var(--honey); color: #1B1206; font-size: 46px; font-weight: 700; opacity: 0; }
"""
    body = """
      <section id="s1" class="clip" data-start="0" data-duration="5" data-track-index="0">
        <div class="bg"></div>
        <div class="copy"><h1 class="serif"><span class="line">%s</span><span class="line">%s</span><span class="line">%s</span></h1></div>
      </section>
      <section id="s2" class="clip paper" data-start="4.9" data-duration="14.6" data-track-index="1">
        <h2 class="serif"><span class="line">%s</span><span class="line">%s</span></h2>
        <div class="chart">%s</div>
      </section>
      <section id="s3" class="clip" data-start="19.4" data-duration="8.1" data-track-index="0">
        <div class="bg"></div>
        <div class="num serif" id="s3-num">0%%</div>
        <p id="s3-p">more leads in June than in January</p>
      </section>
      <section id="s4" class="clip" data-start="27.4" data-duration="10.1" data-track-index="1">
        <div class="bg"></div>
        <h2 class="serif"><span class="line">%s</span></h2>
        <ol><li><b>1</b>Search ads rebuilt</li><li><b>2</b>Landing pages tested</li><li><b>3</b>Follow-up within an hour</li></ol>
      </section>
      <section id="s5" class="clip paper" data-start="37.4" data-duration="7.6" data-track-index="0">
        <div class="copy"><h2 class="serif"><span class="line">%s</span><span class="line">%s</span></h2>
          <span class="cta" id="s5-cta">Book a review call</span></div>
      </section>
""" % (_words("Six"), _words("months"), _words("of leads.", "it"), _words("Leads per month,"),
       _words("January to June", "it"), bars, _words("What changed"), _words("Your results,"),
       _words("next quarter.", "it"))
    growth = round(100 * (CHART[-1][1] - CHART[0][1]) / CHART[0][1])
    script = """
      words("#s1 .line:nth-child(1) .w", 0.3);
      words("#s1 .line:nth-child(2) .w", 0.6);
      words("#s1 .line:nth-child(3) .w", 0.9);
      out("#s1 .copy", 4.6);
      tl.fromTo("#s2", { clipPath: "inset(100%% 0%% 0%% 0%%)" }, { clipPath: "inset(0%% 0%% 0%% 0%%)", duration: 0.6, ease: "power3.inOut" }, 4.9);
      words("#s2 h2 .line:nth-child(1) .w", 5.3);
      words("#s2 h2 .line:nth-child(2) .w", 5.6);
      tl.fromTo("#s2 .fill", { scaleY: 0 }, { scaleY: 1, duration: 1.1, ease: "power3.out", stagger: 0.55 }, 6.4);
      tl.fromTo("#s2 .val", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.55 }, 7.1);
      tl.to("#s2 .bar:last-child .fill", { scaleX: 1.06, duration: 0.4, yoyo: true, repeat: 1, ease: "sine.inOut" }, 12.0);
      tl.fromTo("#s3-num", { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.6, ease: "back.out(1.6)" }, 19.6);
      const counter = { n: 0 };
      tl.to(counter, { n: %(growth)d, duration: 2.2, ease: "power2.out",
        onUpdate: () => { document.getElementById("s3-num").textContent = Math.round(counter.n) + "%%"; } }, 19.8);
      tl.fromTo("#s3-p", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6 }, 21.2);
      words("#s4 h2 .w", 27.7);
      tl.fromTo("#s4 li", { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 0.6, ease: "power3.out", stagger: 1.6 }, 28.6);
      tl.fromTo("#s5", { clipPath: "inset(100%% 0%% 0%% 0%%)" }, { clipPath: "inset(0%% 0%% 0%% 0%%)", duration: 0.6, ease: "power3.inOut" }, 37.4);
      words("#s5 .line:nth-child(1) .w", 37.9);
      words("#s5 .line:nth-child(2) .w", 38.2);
      tl.fromTo("#s5-cta", { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.8)" }, 39.0);
""" % {"growth": growth}
    return {"title": "Engine test: chart (45 s, vertical)", "shape": "vertical", "duration_s": 45.0, "cover_at": 14.0,
            "files": {"index.html": {"text": _page(1080, 1920, 45, body, script, css)}}}


# ── Drills ───────────────────────────────────────────────────────────────────
# Real-looking outside addresses (a placeholder such as example.com is already
# refused by hyperframes check, which would stop the drill before the render).
OUTSIDE_HOSTS = ("images.unsplash.com", "api.ipify.org")


def outside_drill():
    s = title_image_end(
        extra_body='\n      <img class="clip" data-start="0" data-duration="10" data-track-index="3" '
                   'src="https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=40" alt="" '
                   'style="position:absolute;left:auto;top:auto;right:0;bottom:0;width:4px;height:4px;inset:auto 0 0 auto" />',
        extra_script='      try { fetch("https://api.ipify.org/?format=json").catch(function () {}); } catch (e) {}\n')
    s["title"] = "Drill: a composition that reaches outside (10 s)"
    return s


def hang_drill():
    """A page that never becomes ready: its script spins before the timeline exists."""
    s = title_image_end()
    html = s["files"]["index.html"]["text"].replace(
        "window.__timelines = window.__timelines || {};",
        "var t0 = Date.now(); while (Date.now() - t0 < 1e9) {}\n      window.__timelines = window.__timelines || {};")
    s["files"]["index.html"] = {"text": html}
    s["title"] = "Drill: a render that hangs (stopped at its time limit)"
    return s


SAMPLES = {"title_image_end": title_image_end, "chart_vertical": chart_vertical}
DRILLS = {"outside_drill": outside_drill, "hang_drill": hang_drill}
# Settings the drills run with: the hang drill skips the check (which would
# also hang) and has a short limit, so the drill is quick.
DRILL_SETTINGS = {"outside_drill": {}, "hang_drill": {"skip_check": True, "render_timeout_s": 60}}
