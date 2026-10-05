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


# ── The scene library, every template in one plan (Phase 3) ──────────────────
LIGHT_BRAND = {"background": "#F7F5F0", "text": "#16181D", "accent": "#2F5BEA", "heading_font": "Fraunces",
               "body_font": "Inter"}
DARK_BRAND = {"background": "#101820", "text": "#F2EFE8", "accent": "#F2B134", "heading_font": "Montserrat",
              "body_font": "DM Sans"}
LIBRARY_TABLE = "Month,Leads\nJan,120\nFeb,164\nMar,151\nApr,208\nMay,247\nJun,290\n"


def library_assets():
    """{id: asset} for the library plan: photos, a screenshot, a phone screen, people, logos."""
    from tracker import video_briefs
    from PIL import Image
    pics = {}

    def add(aid, kind, data, name):
        im = Image.open(io.BytesIO(data))
        pics[aid] = {"bytes": data, "mime": "image/png" if data[:4] == b"\x89PNG" else "image/jpeg",
                     "width": im.width, "height": im.height, "kind": kind, "name": name}
    add(1, "image", sample_image(), "Hills")
    add(2, "screenshot", video_briefs.app_screen("Reports"), "Reports screen")
    tall = Image.new("RGB", (390, 1800), (246, 247, 250))
    from PIL import ImageDraw
    d = ImageDraw.Draw(tall)
    for k in range(12):
        d.rounded_rectangle([20, 30 + k * 145, 370, 150 + k * 145], 18, fill=(255, 255, 255), outline=(220, 224, 232))
        d.rectangle([40, 60 + k * 145, 40 + 120 + (k % 3) * 60, 76 + k * 145], fill=(47, 91, 234))
    buf = io.BytesIO()
    tall.save(buf, "PNG")
    add(3, "screenshot", buf.getvalue(), "Phone screen")
    add(4, "image", video_briefs.person(), "Priya Raman")
    add(5, "image", video_briefs.person((60, 90, 160)), "Arjun Iyer")
    add(6, "image", video_briefs.person((150, 70, 80)), "Mei Tan")
    for k, word in enumerate(("Northwind", "Kestrel", "Ledgerly", "Brightdesk", "Acme", "Globex"), 7):
        add(k, "logo", video_briefs.text_logo(word), word)
    add(20, "logo", video_briefs.text_logo("Studio"), "Brand logo")
    return pics


def library_plan(length="short"):
    """All 16 templates, with short words or with words at each template's limit."""
    long = length == "long"

    def sc(kind, seconds, **kw):
        out = {"type": kind, "seconds": seconds, "purpose": "", "headline": "", "subline": "", "items": [],
               "number": "", "attribution": "", "asset_ids": [],
               "chart": {"asset_id": 0, "label_column": "", "value_column": "", "kind": "none"}, "motion": ""}
        out.update(kw)
        out["items"] = [{"label": a, "detail": b} for a, b in out["items"]]
        return out
    L = lambda short, longer: longer if long else short          # noqa: E731
    scenes = [
        sc("title", 3, headline=L("Books closed fast", "Close your books in five days, not twelve, every month"),
           emphasis=L("fast", "five days,"), asset_ids=[1] if long else [],
           subline=L("Ledgerly for finance teams", "The month-end close tool built for finance teams who are tired of spreadsheets")),
        sc("words", 3, headline=L("Month-end, without dread", "Month-end used to mean late nights, missed weekends and a lot of copy and paste"),
           emphasis=L("without dread", "late nights,"), asset_ids=[] if long else [1],
           subline=L("", "Here is what changed for one finance team in a single quarter")),
        sc("screenshot", 4, headline=L("Every report in one place", "Every report your board asks for, in one place"),
           subline=L("", "Built from the ledger, updated as entries post"), asset_ids=[2]),
        sc("image", 3, headline=L("Made in the hills", "Grown and packed by the people who live in these hills"),
           emphasis=L("hills", "these hills"), subline=L("", "Every box says where it came from"), asset_ids=[1]),
        sc("list", 4, headline=L("What you get", "What every plan includes from the very first day"),
           items=[("Bank feeds", L("", "Every account, synced each morning")), ("Auto-matching", L("", "Most entries matched before you log in")),
                  ("Close checklist", L("", "Every task with an owner and a due date"))] + ([("Audit trail", "Every change recorded, with who and when"),
                                                                                           ("Board pack", "Reports ready the morning after close")] if long else [])),
        sc("steps", 4, headline=L("How to start", "How to get started in less than one afternoon"),
           items=[("Connect your bank", L("", "Read-only, in two minutes")), ("Import last year", L("", "From a spreadsheet or your old tool")),
                  ("Invite your team", L("", "Everyone sees what is theirs"))] + ([("Run your first close", "With the checklist, end to end")] if long else [])),
        sc("big_number", 3, headline=L("Leads", "Leads from paid search, January to June"), number="142%",
           subline=L("more in June", "more leads in June than in January, at a lower cost per lead")),
        sc("chart", 5, headline=L("Leads by month", "Leads by month, from January to June this year"),
           chart={"asset_id": 30, "label_column": "Month", "value_column": "Leads", "kind": "bar"}),
        sc("chart", 4, headline=L("The trend", "The same months, as a line"),
           chart={"asset_id": 30, "label_column": "Month", "value_column": "Leads", "kind": "line"}),
        sc("chart", 4, headline=L("Share by month", "How the six months add up"),
           chart={"asset_id": 30, "label_column": "Month", "value_column": "Leads", "kind": "donut"}),
        sc("comparison", 4, headline=L("Before and after", "What changed between last year and this year"),
           items=[("Before", L("12 days to close", "Twelve days to close, with most of the team working late every night")),
                  ("After", L("5 days to close", "Five days to close, with the checklist doing the chasing for everyone"))],
           asset_ids=[1, 2] if long else []),
        sc("quote", 4, headline=L("We finally get weekends back.",
                                  "We used to dread month-end. With Ledgerly our close went from twelve days to five, and my team finally gets weekends back."),
           attribution=L("Anita Shah, Kestrel Foods", "Anita Shah, Finance Director, Kestrel Foods"), asset_ids=[4] if long else []),
        sc("timeline", 4, headline=L("Our year", "How the year went, quarter by quarter"),
           items=[("Q1", L("Launch", "Launched in India with two pilot customers")), ("Q2", L("100 clients", "Reached one hundred paying clients")),
                  ("Q3", L("New office", "Opened the Bengaluru office"))] + ([("Q4", "Partner programme goes live")] if long else [])),
        sc("people", 4, headline=L("Your speakers", "The people you will hear from on the day"),
           items=[("Priya Raman", L("CFO", "Chief Financial Officer, Ledgerly")), ("Arjun Iyer", L("Head of Product", "Head of Product, Ledgerly"))]
           + ([("Mei Tan", "Finance Director, Kestrel Foods")] if long else []), asset_ids=[4, 5, 6] if long else [4, 5]),
        sc("phone", 4, headline=L("On your phone too", "Approve entries from your phone, wherever you are"),
           subline=L("", "The same checklist, in your pocket"), asset_ids=[3]),
        sc("logo_wall", 3, headline=L("Trusted by", "Trusted by finance teams at these companies"),
           asset_ids=[7, 8, 9, 10, 11, 12] if long else [7, 8, 9]),
        sc("event_card", 4, headline=L("Budgeting for AI", "Webinar: Budgeting for AI in 2027, what finance teams need to know"),
           items=[("When", L("12 Nov, 4 pm", "Thursday 12 November 2026, 4 pm IST")), ("Where", L("Online", "Online on Zoom, free"))]
           + ([("Speaker", "Priya Raman, CFO of Ledgerly")] if long else []), asset_ids=[4] if long else []),
        sc("end_card", 3, headline=L("Start free", "Start your free trial of Ledgerly today"), emphasis=L("free", "free trial"),
           subline=L("ledgerly.example", "Start at ledgerly.example, no card"),
           items=[("Five-day close", "")] + ([("No card needed", ""), ("Cancel any time", "")] if long else []),
           asset_ids=[1, 4, 5] if long else []),
    ]
    return {"idea": "Library test", "hook": "", "scenes": scenes, "cover_scene": 0,
            "share_copy": {"linkedin": "", "x": "", "instagram": ""}, "notes": []}


def library_tables():
    from tracker import video_uploads
    return {30: video_uploads.numbers(LIBRARY_TABLE)}


def sixty_seconds():
    """All 16 templates in one 60-second landscape video (the load run's long render)."""
    from tracker import video_brand, video_build
    plan = library_plan("short")
    total = sum(sc["seconds"] for sc in plan["scenes"])
    for sc in plan["scenes"]:
        sc["seconds"] = round(sc["seconds"] * 60.0 / total, 2)
    plan["scenes"][-1]["seconds"] = round(60.0 - sum(sc["seconds"] for sc in plan["scenes"][:-1]), 2)
    out = video_build.compose(plan, video_brand.resolve(LIGHT_BRAND), "landscape", assets=library_assets(),
                              tables=library_tables())
    return {"files": video_build.stored(out["files"]), "shape": "landscape", "duration_s": out["duration"],
            "cover_at": out["cover_at"], "title": "Load run: 60 s landscape, all 16 templates"}

