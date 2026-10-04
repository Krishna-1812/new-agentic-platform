"""Video Studio: the scene library (plan section 3.3).

Sixteen scene templates, written and tested once, that every video is built
from. Each takes the brand (colours, fonts, logo), the scene's words, and its
pictures or numbers, and lays itself out for any of the four shapes. Sizes
come from the canvas (u = the short side / 1080) and the words themselves:
fit() picks the largest type size at which the words fit their box in the
given number of lines, so long and short words both stay inside the frame.

A template returns (html, css, js) for one scene:
  html  the scene's <section class="clip"> with its content;
  css   rules scoped to the scene's id;
  js    lines that add the scene's motion to the GSAP timeline `tl`, at the
        scene's start time.

video_build.compose() puts the scenes together into one composition.
"""

from __future__ import annotations

import html as _html
import json
import math
import re

from tracker.video_site import contrast

TEMPLATES = ("title", "words", "screenshot", "image", "list", "steps", "big_number", "chart", "comparison",
             "quote", "timeline", "people", "phone", "logo_wall", "event_card", "end_card")
# Scenes drawn on the brand's text colour (an inverse), for punch.
INVERSE = ("title", "big_number", "end_card")
CHAR_W = {"serif": 0.56, "sans": 0.54}


def esc(text):
    return _html.escape(str(text or ""), quote=True)


class Ctx:
    """Everything a template needs about the canvas, the brand and the files."""

    def __init__(self, shape, size, brand, assets=None, tables=None):
        self.shape = shape
        self.W, self.H = size
        self.u = min(self.W, self.H) / 1080.0
        u = self.u
        if shape == "landscape":
            self.pad_x, self.pad_top, self.pad_bottom = 120 * u, 100 * u, 100 * u
        elif shape == "vertical":
            # Social apps draw over the top and bottom of a vertical video.
            self.pad_x, self.pad_top, self.pad_bottom = 80 * u, 220 * u, 330 * u
        elif shape == "portrait":
            self.pad_x, self.pad_top, self.pad_bottom = 84 * u, 110 * u, 130 * u
        else:
            self.pad_x, self.pad_top, self.pad_bottom = 84 * u, 96 * u, 104 * u
        self.box_w = self.W - 2 * self.pad_x
        self.box_h = self.H - self.pad_top - self.pad_bottom
        self.wide = self.W / self.H > 1.2
        self.tall = self.H / self.W > 1.4
        c = brand["colors"]
        self.colors = c
        self.fonts = brand["fonts"]
        self.logo = brand.get("logo_path")
        self.assets = assets or {}          # id -> {"path", "w", "h", "kind"}
        self.tables = tables or {}          # id -> numbers data
        self.hl = c["accent"] if contrast(c["accent"], c["background"]) >= 3 else c["text"]
        self.hl_inv = c["accent"] if contrast(c["accent"], c["text"]) >= 3 else c["background"]

    def px(self, v):
        return "%dpx" % round(v)

    def font_kind(self, family):
        from tracker import video_fonts
        return "serif" if video_fonts.category(family) == "serif" else "sans"


def fit(text, width, lines, max_px, min_px, kind="sans", height=None, line_height=1.08):
    """The largest size (px) at which `text` fits `width` in `lines` lines (and `height`)."""
    t = " ".join(str(text or "").split())
    if not t:
        return max_px
    cw = CHAR_W.get(kind, 0.55)
    longest = max(len(w) for w in t.split())
    size = max_px
    while size > min_px:
        per_line = max(1, int(width / (cw * size)))
        if longest <= per_line and _lines(t, per_line) <= lines and \
                (height is None or _lines(t, per_line) * size * line_height <= height):
            break
        size -= 2
    return max(min_px, size)


def _lines(text, per_line):
    n, cur = 1, 0
    for w in text.split():
        add = len(w) + (1 if cur else 0)
        if cur + add > per_line:
            n, cur = n + 1, len(w)
        else:
            cur += add
    return n


def words(text, cls=""):
    out = []
    for w in str(text or "").split():
        out.append('<span class="w%s">%s</span>' % (" " + cls if cls else "", esc(w)))
    return " ".join(out)


def _img(ctx, aid, cls="", style="", moving=False):
    """A picture. `moving` ones (zoomed, scrolled) are cropped by their frame on purpose."""
    a = ctx.assets.get(aid)
    if not a:
        return ""
    return '<img class="%s" src="%s" alt=""%s%s />' % (cls, esc(a["path"]), ' style="%s"' % style if style else "",
                                                     " data-layout-allow-overflow" if moving else "")


def _words_in(sel, at, n):
    stagger = min(0.08, 0.7 / max(1, n))
    return ('tl.fromTo("%s", { opacity: 0, y: U * 26 }, { opacity: 1, y: 0, duration: 0.55, ease: "power3.out", '
            'stagger: %.3f }, %.3f);' % (sel, stagger, at))


def _fade_in(sel, at, dy=24, dur=0.5, stagger=0.0):
    return ('tl.fromTo("%s", { opacity: 0, y: U * %d }, { opacity: 1, y: 0, duration: %.2f, ease: "power3.out"%s }, '
            '%.3f);' % (sel, dy, dur, ", stagger: %.3f" % stagger if stagger else "", at))


def _count(text):
    return len(str(text or "").split())


# ── The templates ────────────────────────────────────────────────────────────
def title(ctx, s, sid, t0, dur):
    u = ctx.u
    hk = ctx.font_kind(ctx.fonts["heading"])
    head_px = fit(s.get("headline"), ctx.box_w * (0.82 if ctx.wide else 1), 3, 150 * u, 56 * u, hk,
                  height=ctx.box_h * 0.55)
    sub_px = fit(s.get("subline"), ctx.box_w * (0.7 if ctx.wide else 1), 3, 46 * u, 30 * u)
    logo = ('<img class="logo" src="%s" alt="" />' % esc(ctx.logo)) if ctx.logo else ""
    html = """<div class="col">%s<i class="bar"></i><h1 class="head">%s</h1>%s</div>""" % (
        logo, words(s.get("headline")), '<p class="sub">%s</p>' % esc(s["subline"]) if s.get("subline") else "")
    css = """
#%(id)s .col { position: absolute; left: %(x)s; right: %(x)s; top: 50%%; transform: translateY(-50%%); }
#%(id)s .logo { display: block; max-height: %(lh)s; max-width: %(lw)s; margin-bottom: %(g)s; object-fit: contain; object-position: left center; }
#%(id)s .bar { display: block; width: %(bw)s; height: %(bh)s; background: var(--hl); border-radius: 99px; margin-bottom: %(g2)s; transform-origin: left center; }
#%(id)s .head { font-size: %(hp)s; line-height: 1.04; max-width: %(mw)s; }
#%(id)s .sub { margin-top: %(g2)s; font-size: %(sp)s; line-height: 1.35; max-width: %(sw)s; opacity: 0.86; }
""" % {"id": sid, "x": ctx.px(ctx.pad_x), "lh": ctx.px(96 * u), "lw": ctx.px(380 * u), "g": ctx.px(48 * u),
       "bw": ctx.px(90 * u), "bh": ctx.px(10 * u), "g2": ctx.px(30 * u), "hp": ctx.px(head_px),
       "mw": ctx.px(ctx.box_w * (0.82 if ctx.wide else 1)), "sp": ctx.px(sub_px),
       "sw": ctx.px(ctx.box_w * (0.7 if ctx.wide else 1))}
    js = [_fade_in("#%s .logo" % sid, t0 + 0.1) if ctx.logo else "",
          'tl.fromTo("#%s .bar", { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: "power3.out" }, %.3f);' % (sid, t0 + 0.2),
          _words_in("#%s .head .w" % sid, t0 + 0.3, _count(s.get("headline"))),
          _fade_in("#%s .sub" % sid, t0 + 0.9) if s.get("subline") else ""]
    return html, css, js


def words_scene(ctx, s, sid, t0, dur):
    u = ctx.u
    hk = ctx.font_kind(ctx.fonts["heading"])
    head_px = fit(s.get("headline"), ctx.box_w * (0.86 if ctx.wide else 1), 4, 140 * u, 52 * u, hk,
                  height=ctx.box_h * 0.62)
    sub_px = fit(s.get("subline"), ctx.box_w * 0.8, 3, 44 * u, 30 * u)
    html = '<div class="col"><h2 class="head">%s</h2>%s</div>' % (
        words(s.get("headline")), '<p class="sub">%s</p>' % esc(s["subline"]) if s.get("subline") else "")
    css = """
#%(id)s .col { position: absolute; left: %(x)s; right: %(x)s; top: 50%%; transform: translateY(-50%%); text-align: center; }
#%(id)s .head { font-size: %(hp)s; line-height: 1.06; }
#%(id)s .sub { margin: %(g)s auto 0; font-size: %(sp)s; line-height: 1.35; max-width: %(sw)s; color: var(--muted); }
""" % {"id": sid, "x": ctx.px(ctx.pad_x), "hp": ctx.px(head_px), "g": ctx.px(32 * u), "sp": ctx.px(sub_px),
       "sw": ctx.px(ctx.box_w * 0.8)}
    n = _count(s.get("headline"))
    js = [_words_in("#%s .head .w" % sid, t0 + 0.3, n),
          _fade_in("#%s .sub" % sid, t0 + 0.4 + min(0.08, 0.7 / max(1, n)) * n + 0.2) if s.get("subline") else ""]
    return html, css, js


def _caption(ctx, s, width, lines=3, max_px=None):
    hk = ctx.font_kind(ctx.fonts["heading"])
    u = ctx.u
    px = fit(s.get("headline"), width, lines, max_px or 84 * u, 40 * u, hk)
    sub = fit(s.get("subline"), width, 4, 36 * u, 28 * u)
    return px, sub


def _media_layout(ctx, caption_share=0.36):
    """(media box, caption box) as (x, y, w, h): side by side when wide, stacked when not."""
    u = ctx.u
    x, y, w, h = ctx.pad_x, ctx.pad_top, ctx.box_w, ctx.box_h
    if ctx.wide:
        gap = 72 * u
        cw = w * caption_share
        return (x, y, w - cw - gap, h), (x + w - cw, y, cw, h)
    gap = 48 * u
    ch = h * (0.26 if ctx.tall else 0.3)
    return (x, y + ch + gap, w, h - ch - gap), (x, y, w, ch)


def _box_css(sel, box, ctx):
    x, y, w, h = box
    return "%s { position: absolute; left: %s; top: %s; width: %s; height: %s; }" % (
        sel, ctx.px(x), ctx.px(y), ctx.px(w), ctx.px(h))


def _caption_css(sid, ctx, cap_box, px, sub_px):
    return """
%(box)s
#%(id)s .cap { display: flex; flex-direction: column; justify-content: center; }
#%(id)s .cap h2 { font-size: %(hp)s; line-height: 1.06; }
#%(id)s .cap p { margin-top: %(g)s; font-size: %(sp)s; line-height: 1.4; color: var(--muted); }
""" % {"box": _box_css("#%s .cap" % sid, cap_box, ctx), "id": sid, "hp": ctx.px(px), "g": ctx.px(22 * ctx.u),
       "sp": ctx.px(sub_px)}


def screenshot(ctx, s, sid, t0, dur):
    u = ctx.u
    media, cap = _media_layout(ctx)
    px, sub = _caption(ctx, s, cap[2], 3 if ctx.wide else 2)
    aid = (s.get("asset_ids") or [None])[0]
    a = ctx.assets.get(aid) or {"w": 1440, "h": 900}
    bar = 44 * u
    view_w, view_h = media[2], media[3] - bar
    img_h = view_w * a["h"] / max(1, a["w"])
    travel = max(0.0, min(img_h - view_h, view_h * 1.6))
    html = """<div class="frame"><div class="chrome"><i></i><i></i><i></i></div><div class="view">%s</div></div>
<div class="cap"><h2>%s</h2>%s</div>""" % (_img(ctx, aid, "shot", moving=True), words(s.get("headline")),
                                           "<p>%s</p>" % esc(s["subline"]) if s.get("subline") else "")
    css = """
%(frame)s
#%(id)s .frame { border-radius: %(r)s; overflow: hidden; background: #fff; box-shadow: 0 %(sh)s %(sh2)s rgba(0,0,0,.18); border: %(b)s solid rgba(127,127,127,.25); }
#%(id)s .chrome { height: %(bar)s; background: #eceef1; display: flex; align-items: center; gap: %(dg)s; padding-left: %(dp)s; }
#%(id)s .chrome i { width: %(dot)s; height: %(dot)s; border-radius: 50%%; background: #c9ccd2; }
#%(id)s .view { position: relative; height: calc(100%% - %(bar)s); overflow: hidden; }
#%(id)s .shot { position: absolute; left: 0; top: 0; width: 100%%; height: auto; transform-origin: 50%% 0; }
%(cap)s""" % {"frame": _box_css("#%s .frame" % sid, media, ctx), "id": sid, "r": ctx.px(24 * u),
              "sh": ctx.px(24 * u), "sh2": ctx.px(60 * u), "b": ctx.px(2 * u), "bar": ctx.px(bar),
              "dg": ctx.px(10 * u), "dp": ctx.px(20 * u), "dot": ctx.px(14 * u),
              "cap": _caption_css(sid, ctx, cap, px, sub)}
    js = ['tl.fromTo("#%s .frame", { opacity: 0, y: U * 60, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.7, '
          'ease: "power3.out" }, %.3f);' % (sid, t0 + 0.1),
          'tl.fromTo("#%s .shot", { y: 0, scale: 1.0 }, { y: %d, scale: 1.04, duration: %.2f, ease: "sine.inOut" }, %.3f);'
          % (sid, -round(travel), max(0.5, dur - 0.9), t0 + 0.8),
          _words_in("#%s .cap .w" % sid, t0 + 0.35, _count(s.get("headline"))),
          _fade_in("#%s .cap p" % sid, t0 + 0.9) if s.get("subline") else ""]
    return html, css, js


def image(ctx, s, sid, t0, dur):
    u = ctx.u
    media, cap = _media_layout(ctx, 0.38)
    px, sub = _caption(ctx, s, cap[2], 3 if ctx.wide else 2)
    aid = (s.get("asset_ids") or [None])[0]
    html = '<div class="photo">%s</div><div class="cap"><h2>%s</h2>%s</div>' % (
        _img(ctx, aid, "pic", moving=True), words(s.get("headline")), "<p>%s</p>" % esc(s["subline"]) if s.get("subline") else "")
    css = """
%(photo)s
#%(id)s .photo { border-radius: %(r)s; overflow: hidden; background: var(--muted); }
#%(id)s .pic { width: 100%%; height: 100%%; object-fit: cover; }
%(cap)s""" % {"photo": _box_css("#%s .photo" % sid, media, ctx), "id": sid, "r": ctx.px(28 * u),
              "cap": _caption_css(sid, ctx, cap, px, sub)}
    js = ['tl.fromTo("#%s .photo", { clipPath: "inset(100%% 0%% 0%% 0%% round %dpx)" }, { clipPath: "inset(0%% 0%% 0%% 0%% '
          'round %dpx)", duration: 0.7, ease: "power3.inOut" }, %.3f);' % (sid, 28 * u, 28 * u, t0 + 0.05),
          'tl.fromTo("#%s .pic", { scale: 1.14 }, { scale: 1.02, duration: %.2f, ease: "none" }, %.3f);' % (sid, dur, t0),
          _words_in("#%s .cap .w" % sid, t0 + 0.45, _count(s.get("headline"))),
          _fade_in("#%s .cap p" % sid, t0 + 1.0) if s.get("subline") else ""]
    return html, css, js


def _rows(ctx, s, sid, t0, dur, marker):
    """list and steps: a headline and rows that build one by one."""
    u = ctx.u
    items = (s.get("items") or [])[:6]
    n = max(1, len(items))
    hk = ctx.font_kind(ctx.fonts["heading"])
    head_px = fit(s.get("headline"), ctx.box_w, 2, 96 * u, 44 * u, hk)
    head_h = (head_px * 1.1 * 2 + 50 * u) if s.get("headline") else 0
    avail = ctx.box_h - head_h
    row_h = min(200 * u, avail / n)
    icon = min(100 * u, row_h * 0.6)
    text_w = ctx.box_w - icon - 36 * u
    has_detail = any(it.get("detail") for it in items)
    label_px = min(fit(max((it.get("label") or "" for it in items), key=len), text_w, 2 if not has_detail else 1,
                       66 * u, 28 * u), row_h * (0.34 if has_detail else 0.46))
    detail_px = max(26 * u, min(40 * u, label_px * 0.68))
    rows = []
    for k, it in enumerate(items, 1):
        mark = str(k) if marker == "number" else "&#10003;"
        rows.append('<li><b>%s</b><div><span class="l">%s</span>%s</div></li>' % (
            mark, esc(it.get("label")), '<span class="d">%s</span>' % esc(it["detail"]) if it.get("detail") else ""))
    html = '<div class="col">%s<ol>%s</ol></div>' % (
        '<h2 class="head">%s</h2>' % words(s["headline"]) if s.get("headline") else "", "".join(rows))
    css = """
#%(id)s .col { position: absolute; left: %(x)s; right: %(x)s; top: %(t)s; bottom: %(bt)s; display: flex; flex-direction: column; justify-content: center; }
#%(id)s .head { font-size: %(hp)s; line-height: 1.08; margin-bottom: %(hg)s; }
#%(id)s ol { list-style: none; display: grid; gap: %(gap)s; }
#%(id)s li { display: flex; align-items: center; gap: %(ig)s; min-height: %(icon)s; }
#%(id)s li b { flex: 0 0 auto; width: %(icon)s; height: %(icon)s; border-radius: %(ir)s; background: var(--accent); color: var(--on-accent); display: flex; align-items: center; justify-content: center; font-family: var(--head); font-size: %(mp)s; font-weight: 700; }
#%(id)s li div { display: flex; flex-direction: column; min-width: 0; }
#%(id)s .l { font-size: %(lp)s; font-weight: 700; line-height: 1.15; }
#%(id)s .d { font-size: %(dp)s; line-height: 1.3; color: var(--muted); margin-top: %(dg)s; }
""" % {"id": sid, "x": ctx.px(ctx.pad_x), "t": ctx.px(ctx.pad_top), "bt": ctx.px(ctx.pad_bottom),
       "hp": ctx.px(head_px), "hg": ctx.px(44 * u), "gap": ctx.px(max(14 * u, row_h - icon - 6 * u)),
       "ig": ctx.px(32 * u), "icon": ctx.px(icon), "ir": ctx.px(icon * (0.5 if marker == "number" else 0.26)),
       "mp": ctx.px(icon * 0.46), "lp": ctx.px(label_px), "dp": ctx.px(detail_px), "dg": ctx.px(6 * u)}
    step = min(0.7, max(0.3, (dur - 1.6) / max(1, n)))
    js = [_words_in("#%s .head .w" % sid, t0 + 0.2, _count(s.get("headline"))),
          'tl.fromTo("#%s li", { opacity: 0, x: -U * 40 }, { opacity: 1, x: 0, duration: 0.5, ease: "power3.out", '
          'stagger: %.3f }, %.3f);' % (sid, step, t0 + 0.7),
          'tl.fromTo("#%s li b", { scale: 0.4 }, { scale: 1, duration: 0.45, ease: "back.out(2)", stagger: %.3f }, %.3f);'
          % (sid, step, t0 + 0.7)]
    return html, css, js


def list_scene(ctx, s, sid, t0, dur):
    return _rows(ctx, s, sid, t0, dur, "check")


def steps(ctx, s, sid, t0, dur):
    return _rows(ctx, s, sid, t0, dur, "number")


_NUMERIC = re.compile(r"^(\D*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$")


def big_number(ctx, s, sid, t0, dur):
    u = ctx.u
    hk = ctx.font_kind(ctx.fonts["heading"])
    number = str(s.get("number") or "").strip()
    num_px = fit(number, ctx.box_w, 1, 330 * u, 90 * u, hk, line_height=1.0)
    sub_px = fit(s.get("subline"), ctx.box_w * 0.86, 3, 54 * u, 32 * u)
    lab_px = fit(s.get("headline"), ctx.box_w, 2, 40 * u, 26 * u)
    m = _NUMERIC.match(number)
    html = '<div class="col">%s<div class="num" data-final="%s">%s</div>%s</div>' % (
        '<p class="lab">%s</p>' % esc(s["headline"]) if s.get("headline") else "", esc(number), esc(number),
        '<p class="sub">%s</p>' % esc(s["subline"]) if s.get("subline") else "")
    css = """
#%(id)s .col { position: absolute; left: %(x)s; right: %(x)s; top: 50%%; transform: translateY(-50%%); text-align: center; }
#%(id)s .lab { font-size: %(lp)s; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--hl); margin-bottom: %(g)s; }
#%(id)s .num { font-family: var(--head); font-weight: 600; font-size: %(np)s; line-height: 1; letter-spacing: -0.02em; color: var(--hl); white-space: nowrap; }
#%(id)s .sub { margin: %(g)s auto 0; font-size: %(sp)s; line-height: 1.3; max-width: %(sw)s; }
""" % {"id": sid, "x": ctx.px(ctx.pad_x), "lp": ctx.px(lab_px), "g": ctx.px(30 * u), "np": ctx.px(num_px),
       "sp": ctx.px(sub_px), "sw": ctx.px(ctx.box_w * 0.86)}
    js = [_fade_in("#%s .lab" % sid, t0 + 0.15) if s.get("headline") else "",
          'tl.fromTo("#%s .num", { opacity: 0, scale: 0.84 }, { opacity: 1, scale: 1, duration: 0.6, ease: "back.out(1.6)" }, %.3f);'
          % (sid, t0 + 0.25),
          _fade_in("#%s .sub" % sid, t0 + 1.2) if s.get("subline") else ""]
    if m:
        pre, digits, post = m.groups()
        decimals = len(digits.split(".")[1]) if "." in digits else 0
        grouping = "indian" if re.search(r"\d,\d\d,\d{3}", digits) else "intl" if "," in digits else "none"
        value = float(digits.replace(",", ""))
        js.append('countUp("#%s .num", %s, %s, %d, "%s", %s, %.3f, %.2f);' % (
            sid, json.dumps(pre), json.dumps(post), decimals, grouping, repr(value),
            t0 + 0.3, min(1.8, max(0.8, dur * 0.45))))
    return html, css, js


def _table_points(ctx, chart):
    data = ctx.tables.get(chart.get("asset_id")) or {}
    cols = data.get("columns") or []
    if chart.get("label_column") not in cols or chart.get("value_column") not in cols:
        return []
    li, vi = cols.index(chart["label_column"]), cols.index(chart["value_column"])
    vals = (data.get("values") or {}).get(chart["value_column"]) or []
    pts = []
    for r, v in zip(data.get("rows") or [], vals):
        if v is not None:
            pts.append((r[li], v, r[vi]))
    return pts[:12]


def _mix(a, b, t):
    from tracker.video_site import rgb
    ra, rb = rgb(a), rgb(b)
    return "#" + "".join("%02x" % round(x + (y - x) * t) for x, y in zip(ra, rb))


def chart(ctx, s, sid, t0, dur):
    u = ctx.u
    pts = _table_points(ctx, s.get("chart") or {})
    kind = (s.get("chart") or {}).get("kind") or "bar"
    hk = ctx.font_kind(ctx.fonts["heading"])
    head_px = fit(s.get("headline"), ctx.box_w, 2, 84 * u, 40 * u, hk)
    head_h = head_px * 1.1 * 2 + 40 * u if s.get("headline") else 0
    cw, ch = ctx.box_w, ctx.box_h - head_h
    label_px = max(24 * u, min(34 * u, cw / max(1, len(pts)) * 0.22))
    val_px = label_px * 1.08
    svg = []
    js = [_words_in("#%s .head .w" % sid, t0 + 0.2, _count(s.get("headline")))]
    accent, fg = ctx.colors["accent"], ctx.colors["text"]
    if not pts:
        svg.append('<text x="%d" y="%d" class="lbl" text-anchor="middle">No numbers to draw</text>' % (cw / 2, ch / 2))
    elif kind == "donut":
        total = sum(max(0.0, v) for _, v, _ in pts) or 1.0
        beside = not ctx.tall                       # landscape and square: legend beside the donut
        row = 64 * u
        if beside:
            r = min(cw * 0.25, ch * 0.4)
            cx, cy = cw * 0.28, ch / 2
            legend_x, legend_y = cw * 0.58, ch / 2 - (len(pts) - 1) * row / 2 + 12 * u
        else:
            r = max(80 * u, min(cw * 0.36, (ch - len(pts) * row - 110 * u) / 2))
            cx, cy = cw / 2, r + 30 * u
            legend_x, legend_y = cw * 0.18, cy + r + 90 * u
        circ = 2 * math.pi * r
        acc = 0.0
        for k, (lab, v, shown) in enumerate(pts):
            frac = max(0.0, v) / total
            colour = _mix(accent, ctx.colors["background"], min(0.75, k * 0.16)) if k % 2 == 0 else \
                _mix(fg, ctx.colors["background"], min(0.7, 0.2 + k * 0.1))
            svg.append('<circle class="seg" cx="%.1f" cy="%.1f" r="%.1f" fill="none" stroke="%s" stroke-width="%.1f" '
                       'stroke-dasharray="%.2f %.2f" stroke-dashoffset="%.2f" transform="rotate(-90 %.1f %.1f)" />'
                       % (cx, cy, r, colour, r * 0.42, frac * circ, circ, -acc * circ, cx, cy))
            ly = legend_y + k * row
            svg.append('<rect class="leg" x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f" fill="%s" />'
                       % (legend_x, ly - 22 * u, 28 * u, 28 * u, 6 * u, colour))
            svg.append('<text class="lbl leg" x="%.1f" y="%.1f" style="font-size:%dpx">%s · %s</text>'
                       % (legend_x + 44 * u, ly, 34 * u, esc(lab), esc(shown)))
            acc += frac
        js.append('tl.fromTo("#%s .seg", { opacity: 0, scale: 0.6, transformOrigin: "50%% 50%%" }, { opacity: 1, scale: 1, '
                  'duration: 0.6, ease: "back.out(1.4)", stagger: 0.18 }, %.3f);' % (sid, t0 + 0.6))
        js.append(_fade_in("#%s .leg" % sid, t0 + 0.9, 10, 0.4, 0.12))
    else:
        top = max(v for _, v, _ in pts)
        low = min(0.0, min(v for _, v, _ in pts))
        span = (top - low) or 1.0
        base_y = ch - label_px * 2.2
        plot_h = base_y - val_px * 2.2
        slot = cw / len(pts)
        if kind == "line":
            xy = [(slot * (k + 0.5), base_y - (v - low) / span * plot_h) for k, (_, v, _) in enumerate(pts)]
            d = "M" + " L".join("%.1f %.1f" % p for p in xy)
            length = sum(math.dist(xy[k], xy[k + 1]) for k in range(len(xy) - 1)) or 1
            svg.append('<line x1="0" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="%.1f" opacity="0.3" />'
                       % (base_y, cw, base_y, fg, 2 * u))
            svg.append('<path class="ln" d="%s" fill="none" stroke="%s" stroke-width="%.1f" stroke-linecap="round" '
                       'stroke-linejoin="round" stroke-dasharray="%.1f" stroke-dashoffset="%.1f" />'
                       % (d, accent, 8 * u, length, length))
            for k, ((lab, v, shown), (x, y)) in enumerate(zip(pts, xy)):
                svg.append('<circle class="dot" cx="%.1f" cy="%.1f" r="%.1f" fill="%s" />' % (x, y, 10 * u, accent))
                svg.append('<text class="val" x="%.1f" y="%.1f" text-anchor="middle">%s</text>' % (x, y - 26 * u, esc(shown)))
                svg.append('<text class="lbl" x="%.1f" y="%.1f" text-anchor="middle">%s</text>' % (x, ch - label_px * 0.6, esc(lab)))
            js.append('tl.to("#%s .ln", { strokeDashoffset: 0, duration: %.2f, ease: "power2.inOut" }, %.3f);'
                      % (sid, min(2.2, dur * 0.5), t0 + 0.6))
            js.append(_fade_in("#%s .dot, #%s .val" % (sid, sid), t0 + 0.8, 10, 0.35, 0.12))
        else:
            bw = slot * 0.62
            for k, (lab, v, shown) in enumerate(pts):
                h = max(2 * u, (v - low) / span * plot_h)
                x = slot * k + (slot - bw) / 2
                fill = accent if k == len(pts) - 1 else _mix(fg, ctx.colors["background"], 0.55)
                svg.append('<rect class="bar" x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f" fill="%s" />'
                           % (x, base_y - h, bw, h, min(14 * u, bw / 4), fill))
                svg.append('<text class="val" x="%.1f" y="%.1f" text-anchor="middle">%s</text>' % (x + bw / 2, base_y - h - 16 * u, esc(shown)))
                svg.append('<text class="lbl" x="%.1f" y="%.1f" text-anchor="middle">%s</text>' % (x + bw / 2, ch - label_px * 0.6, esc(lab)))
            step = min(0.45, max(0.12, (dur - 2.0) / max(1, len(pts))))
            js.append('tl.fromTo("#%s .bar", { scaleY: 0, transformOrigin: "50%% 100%%" }, { scaleY: 1, duration: 0.8, '
                      'ease: "power3.out", stagger: %.3f }, %.3f);' % (sid, step, t0 + 0.6))
            js.append(_fade_in("#%s .val" % sid, t0 + 1.0, 10, 0.35, step))
    html = '<div class="col">%s<svg class="plot" viewBox="0 0 %d %d" width="%d" height="%d">%s</svg></div>' % (
        '<h2 class="head">%s</h2>' % words(s["headline"]) if s.get("headline") else "", cw, ch, cw, ch, "".join(svg))
    css = """
#%(id)s .col { position: absolute; left: %(x)s; top: %(t)s; width: %(w)s; }
#%(id)s .head { font-size: %(hp)s; line-height: 1.08; margin-bottom: %(g)s; }
#%(id)s .plot { display: block; overflow: visible; }
#%(id)s .lbl { font-family: var(--body); font-size: %(lp)s; fill: var(--muted); font-weight: 600; }
#%(id)s .val { font-family: var(--body); font-size: %(vp)s; fill: currentColor; font-weight: 700; }
""" % {"id": sid, "x": ctx.px(ctx.pad_x), "t": ctx.px(ctx.pad_top), "w": ctx.px(cw), "hp": ctx.px(head_px),
       "g": ctx.px(40 * u), "lp": ctx.px(label_px), "vp": ctx.px(val_px)}
    return html, css, js


def comparison(ctx, s, sid, t0, dur):
    u = ctx.u
    items = (s.get("items") or [])[:2]
    while len(items) < 2:
        items.append({"label": "", "detail": ""})
    pics = [a for a in (s.get("asset_ids") or []) if a in ctx.assets][:2]
    hk = ctx.font_kind(ctx.fonts["heading"])
    head_px = fit(s.get("headline"), ctx.box_w, 2, 84 * u, 40 * u, hk)
    head_h = head_px * 1.1 * 2 + 44 * u if s.get("headline") else 0
    side = ctx.wide or ctx.shape == "square"
    gap = 40 * u
    cw = (ctx.box_w - gap) / 2 if side else ctx.box_w
    ch = (ctx.box_h - head_h) if side else (ctx.box_h - head_h - gap) / 2
    pic_h = ch * 0.48 if len(pics) == 2 else 0
    lab_px = fit(max((i["label"] for i in items), key=len), cw - 64 * u, 2, 88 * u, 30 * u, hk)
    det_px = fit(max((i["detail"] for i in items), key=len), cw - 64 * u, 5, 56 * u, 26 * u,
                 height=ch - pic_h - lab_px * 2.4 - 100 * u, line_height=1.3)
    cards = []
    for k, it in enumerate(items):
        pic = '<div class="pic">%s</div>' % _img(ctx, pics[k]) if len(pics) == 2 else ""
        cards.append('<div class="card c%d">%s<h3>%s</h3><p>%s</p></div>' % (k, pic, esc(it["label"]), esc(it["detail"])))
    html = '<div class="col">%s<div class="pair">%s</div></div>' % (
        '<h2 class="head">%s</h2>' % words(s["headline"]) if s.get("headline") else "", "".join(cards))
    css = """
#%(id)s .col { position: absolute; left: %(x)s; top: %(t)s; width: %(w)s; height: %(h)s; display: flex; flex-direction: column; }
#%(id)s .head { font-size: %(hp)s; line-height: 1.08; margin-bottom: %(hg)s; }
#%(id)s .pair { flex: 1 1 auto; display: grid; grid-template-%(axis)s: 1fr 1fr; gap: %(gap)s; min-height: 0; }
#%(id)s .card { border-radius: %(r)s; padding: %(p)s; background: var(--card); display: flex; flex-direction: column; justify-content: center; overflow: hidden; min-height: 0; }
#%(id)s .c1 { background: var(--accent); color: var(--on-accent); }
#%(id)s .pic { height: %(ph)s; margin: -%(p)s -%(p)s %(p)s; flex: 0 0 auto; }
#%(id)s .pic img { width: 100%%; height: 100%%; object-fit: cover; }
#%(id)s h3 { font-family: var(--head); font-size: %(lp)s; line-height: 1.1; }
#%(id)s p { margin-top: %(dg)s; font-size: %(dp)s; line-height: 1.3; opacity: 0.88; }
""" % {"id": sid, "x": ctx.px(ctx.pad_x), "t": ctx.px(ctx.pad_top), "w": ctx.px(ctx.box_w), "h": ctx.px(ctx.box_h),
       "hp": ctx.px(head_px), "hg": ctx.px(44 * u), "axis": "columns" if side else "rows", "gap": ctx.px(gap),
       "r": ctx.px(28 * u), "p": ctx.px(32 * u), "ph": ctx.px(pic_h), "lp": ctx.px(lab_px), "dg": ctx.px(16 * u),
       "dp": ctx.px(det_px)}
    js = [_words_in("#%s .head .w" % sid, t0 + 0.2, _count(s.get("headline"))),
          _fade_in("#%s .c0" % sid, t0 + 0.55, 40, 0.6),
          'tl.fromTo("#%s .c1", { clipPath: "inset(0%% 100%% 0%% 0%%)" }, { clipPath: "inset(0%% 0%% 0%% 0%%)", duration: 0.7, '
          'ease: "power3.inOut" }, %.3f);' % (sid, t0 + min(1.4, dur * 0.4))]
    return html, css, js


def quote(ctx, s, sid, t0, dur):
    u = ctx.u
    hk = ctx.font_kind(ctx.fonts["heading"])
    aid = next((a for a in (s.get("asset_ids") or []) if a in ctx.assets), None)
    photo = 150 * u if aid else 0
    q_px = fit(s.get("headline"), ctx.box_w, 7, 108 * u, 38 * u, hk, height=ctx.box_h - 260 * u - photo, line_height=1.22)
    att_px = fit(s.get("attribution"), ctx.box_w - photo - 30 * u, 2, 38 * u, 26 * u)
    html = """<div class="col"><blockquote>%s</blockquote>
<div class="who">%s<span>%s</span></div></div>""" % (
        words(s.get("headline")), '<div class="face">%s</div>' % _img(ctx, aid) if aid else "", esc(s.get("attribution")))
    css = """
#%(id)s .col { position: absolute; left: %(x)s; right: %(x)s; top: 50%%; transform: translateY(-50%%); }
#%(id)s .col { padding-top: %(mh)s; }
#%(id)s blockquote { position: relative; font-family: var(--head); font-size: %(qp)s; line-height: 1.2; }
#%(id)s blockquote::before { content: "“"; position: absolute; left: 0; top: -%(mh)s; font-size: %(mp)s; line-height: 1; height: %(mh)s; color: var(--hl); }
#%(id)s .who { display: flex; align-items: center; gap: %(g)s; margin-top: %(wg)s; font-size: %(ap)s; font-weight: 700; }
#%(id)s .face { width: %(ph)s; height: %(ph)s; border-radius: 50%%; overflow: hidden; flex: 0 0 auto; }
#%(id)s .face img { width: 100%%; height: 100%%; object-fit: cover; }
""" % {"id": sid, "x": ctx.px(ctx.pad_x), "mp": ctx.px(200 * u), "mh": ctx.px(120 * u), "qp": ctx.px(q_px),
       "g": ctx.px(26 * u), "wg": ctx.px(48 * u), "ap": ctx.px(att_px), "ph": ctx.px(photo)}
    n = _count(s.get("headline"))
    js = ['tl.fromTo("#%s blockquote .w", { opacity: 0 }, { opacity: 1, duration: 0.4, stagger: %.3f }, %.3f);'
          % (sid, min(0.06, max(0.02, (dur * 0.45) / max(1, n))), t0 + 0.35),
          _fade_in("#%s .who" % sid, t0 + min(dur * 0.55, 0.5 + 0.05 * n))]
    return html, css, js


def timeline(ctx, s, sid, t0, dur):
    u = ctx.u
    items = (s.get("items") or [])[:6]
    n = max(1, len(items))
    hk = ctx.font_kind(ctx.fonts["heading"])
    head_px = fit(s.get("headline"), ctx.box_w, 2, 84 * u, 40 * u, hk)
    head_h = head_px * 1.1 * 2 + 50 * u if s.get("headline") else 0
    across = ctx.wide
    if across:
        slot = ctx.box_w / n
        lab_px = fit(max((i.get("label") or "" for i in items), key=len), slot - 24 * u, 1, 68 * u, 26 * u, hk)
        det_px = fit(max((i.get("detail") or "" for i in items), key=len), slot - 24 * u, 4, 42 * u, 22 * u)
    else:
        row = (ctx.box_h - head_h) / n
        lab_px = fit(max((i.get("label") or "" for i in items), key=len), ctx.box_w - 80 * u, 1, 64 * u, 26 * u, hk)
        det_px = fit(max((i.get("detail") or "" for i in items), key=len), ctx.box_w - 80 * u, 2, 42 * u, 22 * u,
                     height=row - lab_px * 1.3 - 20 * u, line_height=1.3)
    li = "".join('<li><i></i><b>%s</b><span>%s</span></li>' % (esc(i.get("label")), esc(i.get("detail"))) for i in items)
    html = '<div class="col">%s<div class="track"><div class="rail"></div><ol>%s</ol></div></div>' % (
        '<h2 class="head">%s</h2>' % words(s["headline"]) if s.get("headline") else "", li)
    base = """
#%(id)s .col { position: absolute; left: %(x)s; top: %(t)s; width: %(w)s; height: %(h)s; display: flex; flex-direction: column; }
#%(id)s .head { font-size: %(hp)s; line-height: 1.08; margin-bottom: %(hg)s; }
#%(id)s .track { position: relative; flex: 1 1 auto; }
#%(id)s ol { list-style: none; position: absolute; inset: 0; display: grid; }
#%(id)s li i { position: absolute; width: %(dot)s; height: %(dot)s; border-radius: 50%%; background: var(--accent); }
#%(id)s li b { font-family: var(--head); font-size: %(lp)s; color: var(--hl); display: block; white-space: nowrap; }
#%(id)s li span { font-size: %(dp)s; line-height: 1.3; display: block; margin-top: %(dg)s; color: var(--muted); }
#%(id)s .rail { position: absolute; background: var(--fg); opacity: 0.22; }
""" % {"id": sid, "x": ctx.px(ctx.pad_x), "t": ctx.px(ctx.pad_top), "w": ctx.px(ctx.box_w), "h": ctx.px(ctx.box_h),
       "hp": ctx.px(head_px), "hg": ctx.px(50 * u), "dot": ctx.px(28 * u), "lp": ctx.px(lab_px), "dp": ctx.px(det_px),
       "dg": ctx.px(10 * u)}
    if across:
        css = base + """
#%(id)s .rail { left: 0; right: 0; top: 50%%; height: %(rh)s; transform-origin: left center; }
#%(id)s ol { grid-template-columns: repeat(%(n)d, 1fr); }
#%(id)s li { position: relative; padding: 0 %(lp)s; }
#%(id)s li i { left: %(lp)s; top: calc(50%% - %(half)s); }
#%(id)s li b { position: absolute; left: %(lp)s; right: %(lp)s; bottom: calc(50%% + %(off)s); }
#%(id)s li span { position: absolute; left: %(lp)s; right: %(lp)s; top: calc(50%% + %(off)s); }
""" % {"id": sid, "rh": ctx.px(6 * u), "n": n, "lp": ctx.px(12 * u), "half": ctx.px(14 * u), "off": ctx.px(40 * u)}
        rail_from, rail_to = '{ scaleX: 0 }', '{ scaleX: 1'
    else:
        css = base + """
#%(id)s .rail { left: %(rl)s; top: 0; bottom: 0; width: %(rh)s; transform-origin: center top; }
#%(id)s ol { grid-template-rows: repeat(%(n)d, 1fr); }
#%(id)s li { position: relative; padding-left: %(pl)s; display: flex; flex-direction: column; justify-content: center; }
#%(id)s li i { left: 0; top: calc(50%% - %(half)s); }
""" % {"id": sid, "rl": ctx.px(11 * u), "rh": ctx.px(6 * u), "n": n, "pl": ctx.px(70 * u), "half": ctx.px(14 * u)}
        rail_from, rail_to = '{ scaleY: 0 }', '{ scaleY: 1'
    step = min(0.6, max(0.25, (dur - 1.8) / n))
    js = [_words_in("#%s .head .w" % sid, t0 + 0.2, _count(s.get("headline"))),
          'tl.fromTo("#%s .rail", %s, %s, duration: %.2f, ease: "power2.inOut" }, %.3f);'
          % (sid, rail_from, rail_to, step * n + 0.3, t0 + 0.5),
          'tl.fromTo("#%s li", { opacity: 0, y: U * 20 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out", '
          'stagger: %.3f }, %.3f);' % (sid, step, t0 + 0.6)]
    return html, css, js


def people(ctx, s, sid, t0, dur):
    u = ctx.u
    items = (s.get("items") or [])[:6]
    pics = list(s.get("asset_ids") or [])
    n = max(1, len(items))
    hk = ctx.font_kind(ctx.fonts["heading"])
    head_px = fit(s.get("headline"), ctx.box_w, 2, 84 * u, 40 * u, hk)
    head_h = head_px * 1.1 * 2 + 50 * u if s.get("headline") else 0
    cols = n if n <= (4 if ctx.wide else 2) else (3 if ctx.wide else 2)
    rows = math.ceil(n / cols)
    gap = 36 * u
    cell_w = (ctx.box_w - gap * (cols - 1)) / cols
    cell_h = (ctx.box_h - head_h - gap * (rows - 1)) / rows
    name_px = fit(max((i.get("label") or "" for i in items), key=len), cell_w, 2, 40 * u, 24 * u)
    role_px = max(22 * u, min(30 * u, name_px * 0.78))
    face = max(90 * u, min(cell_w * 0.62, cell_h - name_px * 2.6 - role_px * 2.8 - 30 * u, 320 * u))
    cards = []
    for k, it in enumerate(items):
        aid = pics[k] if k < len(pics) and pics[k] in ctx.assets else None
        initials = "".join(w[0] for w in (it.get("label") or "?").split()[:2]).upper()
        inner = _img(ctx, aid) if aid else '<span class="ini">%s</span>' % esc(initials)
        cards.append('<div class="p"><div class="face">%s</div><b>%s</b><span>%s</span></div>' % (
            inner, esc(it.get("label")), esc(it.get("detail"))))
    html = '<div class="col">%s<div class="grid">%s</div></div>' % (
        '<h2 class="head">%s</h2>' % words(s["headline"]) if s.get("headline") else "", "".join(cards))
    css = """
#%(id)s .col { position: absolute; left: %(x)s; top: %(t)s; width: %(w)s; height: %(h)s; display: flex; flex-direction: column; }
#%(id)s .head { font-size: %(hp)s; line-height: 1.08; margin-bottom: %(hg)s; }
#%(id)s .grid { flex: 1 1 auto; display: grid; grid-template-columns: repeat(%(cols)d, 1fr); gap: %(gap)s; align-content: center; }
#%(id)s .p { display: flex; flex-direction: column; align-items: center; text-align: center; min-width: 0; }
#%(id)s .face { width: %(f)s; height: %(f)s; border-radius: 50%%; overflow: hidden; background: var(--accent); color: var(--on-accent); display: flex; align-items: center; justify-content: center; margin-bottom: %(fg)s; }
#%(id)s .face img { width: 100%%; height: 100%%; object-fit: cover; }
#%(id)s .ini { font-family: var(--head); font-size: %(ip)s; }
#%(id)s .p b { font-size: %(np)s; line-height: 1.15; }
#%(id)s .p span { font-size: %(rp)s; line-height: 1.3; color: var(--muted); margin-top: %(rg)s; }
""" % {"id": sid, "x": ctx.px(ctx.pad_x), "t": ctx.px(ctx.pad_top), "w": ctx.px(ctx.box_w), "h": ctx.px(ctx.box_h),
       "hp": ctx.px(head_px), "hg": ctx.px(50 * u), "cols": cols, "gap": ctx.px(gap), "f": ctx.px(face),
       "fg": ctx.px(22 * u), "ip": ctx.px(face * 0.36), "np": ctx.px(name_px), "rp": ctx.px(role_px),
       "rg": ctx.px(6 * u)}
    js = [_words_in("#%s .head .w" % sid, t0 + 0.2, _count(s.get("headline"))),
          'tl.fromTo("#%s .p", { opacity: 0, y: U * 40 }, { opacity: 1, y: 0, duration: 0.55, ease: "power3.out", '
          'stagger: %.3f }, %.3f);' % (sid, min(0.35, (dur - 1.5) / n), t0 + 0.6)]
    return html, css, js


def phone(ctx, s, sid, t0, dur):
    u = ctx.u
    aid = (s.get("asset_ids") or [None])[0]
    a = ctx.assets.get(aid) or {"w": 390, "h": 844}
    if ctx.wide:
        ph = ctx.box_h
        pw = ph * 0.49
        frame = (ctx.pad_x + ctx.box_w * 0.12, ctx.pad_top, pw, ph)
        cap = (ctx.pad_x + ctx.box_w * 0.12 + pw + 100 * u, ctx.pad_top, ctx.box_w * 0.88 - pw - 100 * u, ctx.box_h)
    else:
        cap_h = ctx.box_h * 0.22
        ph = ctx.box_h - cap_h - 40 * u
        pw = min(ph * 0.49, ctx.box_w * 0.8)
        ph = pw / 0.49
        frame = (ctx.pad_x + (ctx.box_w - pw) / 2, ctx.pad_top + cap_h + 40 * u, pw, ph)
        cap = (ctx.pad_x, ctx.pad_top, ctx.box_w, cap_h)
    px, sub = _caption(ctx, s, cap[2], 3 if ctx.wide else 2)
    bezel = 14 * u
    screen_w, screen_h = pw - 2 * bezel, ph - 2 * bezel
    img_h = screen_w * a["h"] / max(1, a["w"])
    travel = max(0.0, img_h - screen_h)
    html = '<div class="phone"><div class="screen">%s</div></div><div class="cap"><h2>%s</h2>%s</div>' % (
        _img(ctx, aid, "shot", moving=True), words(s.get("headline")), "<p>%s</p>" % esc(s["subline"]) if s.get("subline") else "")
    css = """
%(frame)s
#%(id)s .phone { background: #121316; border-radius: %(r)s; padding: %(b)s; box-shadow: 0 %(sh)s %(sh2)s rgba(0,0,0,.25); }
#%(id)s .screen { width: 100%%; height: 100%%; border-radius: %(r2)s; overflow: hidden; position: relative; background: #fff; }
#%(id)s .shot { position: absolute; left: 0; top: 0; width: 100%%; height: auto; }
%(cap)s""" % {"frame": _box_css("#%s .phone" % sid, frame, ctx), "id": sid, "r": ctx.px(pw * 0.14), "b": ctx.px(bezel),
              "sh": ctx.px(30 * u), "sh2": ctx.px(70 * u), "r2": ctx.px(pw * 0.11),
              "cap": _caption_css(sid, ctx, cap, px, sub)}
    js = ['tl.fromTo("#%s .phone", { opacity: 0, y: U * 120 }, { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" }, %.3f);'
          % (sid, t0 + 0.05),
          'tl.fromTo("#%s .shot", { y: 0 }, { y: %d, duration: %.2f, ease: "sine.inOut" }, %.3f);'
          % (sid, -round(min(travel, screen_h * 2.5)), max(0.5, dur - 1.2), t0 + 0.9),
          _words_in("#%s .cap .w" % sid, t0 + 0.4, _count(s.get("headline"))),
          _fade_in("#%s .cap p" % sid, t0 + 1.0) if s.get("subline") else ""]
    return html, css, js


def logo_wall(ctx, s, sid, t0, dur):
    u = ctx.u
    logos = [a for a in (s.get("asset_ids") or []) if a in ctx.assets][:12]
    n = max(1, len(logos))
    hk = ctx.font_kind(ctx.fonts["heading"])
    head_px = fit(s.get("headline"), ctx.box_w, 2, 84 * u, 40 * u, hk)
    head_h = head_px * 1.1 * 2 + 50 * u if s.get("headline") else 0
    cols = min(n, 4 if ctx.wide else 3 if ctx.shape == "square" else 2) if n > 1 else 1
    rows = math.ceil(n / cols)
    gap = 28 * u
    cell_h = min(220 * u, (ctx.box_h - head_h - gap * (rows - 1)) / rows)
    cards = "".join('<div class="lg">%s</div>' % _img(ctx, a) for a in logos)
    html = '<div class="col">%s<div class="grid">%s</div></div>' % (
        '<h2 class="head">%s</h2>' % words(s["headline"]) if s.get("headline") else "", cards)
    css = """
#%(id)s .col { position: absolute; left: %(x)s; top: %(t)s; width: %(w)s; height: %(h)s; display: flex; flex-direction: column; justify-content: center; }
#%(id)s .head { font-size: %(hp)s; line-height: 1.08; margin-bottom: %(hg)s; text-align: center; }
#%(id)s .grid { display: grid; grid-template-columns: repeat(%(cols)d, 1fr); gap: %(gap)s; }
#%(id)s .lg { height: %(ch)s; border-radius: %(r)s; background: #ffffff; display: flex; align-items: center; justify-content: center; padding: %(p)s; }
#%(id)s .lg img { max-width: 100%%; max-height: 100%%; object-fit: contain; }
""" % {"id": sid, "x": ctx.px(ctx.pad_x), "t": ctx.px(ctx.pad_top), "w": ctx.px(ctx.box_w), "h": ctx.px(ctx.box_h),
       "hp": ctx.px(head_px), "hg": ctx.px(50 * u), "cols": cols, "gap": ctx.px(gap), "ch": ctx.px(cell_h),
       "r": ctx.px(20 * u), "p": ctx.px(28 * u)}
    js = [_words_in("#%s .head .w" % sid, t0 + 0.2, _count(s.get("headline"))),
          'tl.fromTo("#%s .lg", { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(1.6)", '
          'stagger: %.3f }, %.3f);' % (sid, min(0.15, (dur - 1.4) / n), t0 + 0.6)]
    return html, css, js


def event_card(ctx, s, sid, t0, dur):
    u = ctx.u
    items = (s.get("items") or [])[:4]
    hk = ctx.font_kind(ctx.fonts["heading"])
    aid = next((a for a in (s.get("asset_ids") or []) if a in ctx.assets), None)
    head_px = fit(s.get("headline"), ctx.box_w, 3, 110 * u, 48 * u, hk, height=ctx.box_h * 0.36)
    face = (220 * u if ctx.wide else 180 * u) if aid else 0
    text_w = ctx.box_w - 2 * 44 * u - (face + 40 * u if aid else 0)
    det_px = fit(max((i.get("detail") or "" for i in items), key=len) if items else "", text_w, 2, 60 * u, 26 * u)
    rows = "".join('<div class="row"><b>%s</b><span>%s</span></div>' % (esc(i.get("label")), esc(i.get("detail"))) for i in items)
    html = '<div class="col"><h2 class="head">%s</h2><div class="card">%s<div class="rows">%s</div></div></div>' % (
        words(s.get("headline")), '<div class="face">%s</div>' % _img(ctx, aid) if aid else "", rows)
    css = """
#%(id)s .col { position: absolute; left: %(x)s; right: %(x)s; top: 50%%; transform: translateY(-50%%); }
#%(id)s .head { font-size: %(hp)s; line-height: 1.06; margin-bottom: %(hg)s; }
#%(id)s .card { display: flex; align-items: center; gap: %(fg)s; border-radius: %(r)s; padding: %(p)s; background: var(--card); }
#%(id)s .face { width: %(f)s; height: %(f)s; border-radius: 50%%; overflow: hidden; flex: 0 0 auto; }
#%(id)s .face img { width: 100%%; height: 100%%; object-fit: cover; }
#%(id)s .rows { display: grid; gap: %(rg)s; min-width: 0; }
#%(id)s .row b { display: block; font-size: %(lp)s; letter-spacing: 0.12em; text-transform: uppercase; color: var(--hl); }
#%(id)s .row span { display: block; font-size: %(dp)s; font-weight: 600; line-height: 1.25; margin-top: %(sg)s; }
""" % {"id": sid, "x": ctx.px(ctx.pad_x), "hp": ctx.px(head_px), "hg": ctx.px(44 * u), "fg": ctx.px(40 * u),
       "r": ctx.px(28 * u), "p": ctx.px(44 * u), "f": ctx.px(face), "rg": ctx.px(26 * u), "lp": ctx.px(max(24 * u, det_px * 0.5)),
       "dp": ctx.px(det_px), "sg": ctx.px(6 * u)}
    js = [_words_in("#%s .head .w" % sid, t0 + 0.2, _count(s.get("headline"))),
          _fade_in("#%s .card" % sid, t0 + 0.7, 40, 0.6),
          _fade_in("#%s .row" % sid, t0 + 0.95, 16, 0.4, 0.18)]
    return html, css, js


def end_card(ctx, s, sid, t0, dur):
    u = ctx.u
    hk = ctx.font_kind(ctx.fonts["heading"])
    head_px = fit(s.get("headline"), ctx.box_w * 0.9, 2, 140 * u, 56 * u, hk)
    sub_px = fit(s.get("subline"), ctx.box_w * 0.8 - 80 * u, 1, 44 * u, 26 * u)
    logo = ('<img class="logo" src="%s" alt="" />' % esc(ctx.logo)) if ctx.logo else ""
    html = '<div class="col">%s<h2 class="head">%s</h2>%s</div>' % (
        logo, words(s.get("headline")), '<div><span class="pill">%s</span></div>' % esc(s["subline"]) if s.get("subline") else "")
    css = """
#%(id)s .col { position: absolute; left: %(x)s; right: %(x)s; top: 50%%; transform: translateY(-50%%); text-align: center; }
#%(id)s .logo { display: block; margin: 0 auto %(g)s; max-height: %(lh)s; max-width: %(lw)s; object-fit: contain; }
#%(id)s .head { font-size: %(hp)s; line-height: 1.04; }
#%(id)s .pill { display: inline-flex; align-items: center; margin-top: %(g)s; min-height: %(ph)s; padding: %(pp)s %(px2)s; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-size: %(sp)s; font-weight: 700; max-width: %(pw)s; }
""" % {"id": sid, "x": ctx.px(ctx.pad_x), "g": ctx.px(48 * u), "lh": ctx.px(110 * u), "lw": ctx.px(420 * u),
       "hp": ctx.px(head_px), "ph": ctx.px(sub_px * 2.1), "pp": ctx.px(10 * u), "px2": ctx.px(40 * u),
       "sp": ctx.px(sub_px), "pw": ctx.px(ctx.box_w * 0.9)}
    js = [_fade_in("#%s .logo" % sid, t0 + 0.15) if ctx.logo else "",
          _words_in("#%s .head .w" % sid, t0 + 0.3, _count(s.get("headline"))),
          'tl.fromTo("#%s .pill", { opacity: 0, scale: 0.88 }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.8)" }, %.3f);'
          % (sid, t0 + 0.9) if s.get("subline") else "",
          'tl.to("#%s .pill", { scale: 1.04, duration: 0.3, yoyo: true, repeat: 1, ease: "sine.inOut" }, %.3f);'
          % (sid, t0 + min(dur - 0.8, 2.2)) if s.get("subline") and dur > 2.5 else ""]
    return html, css, js


RENDER = {"title": title, "words": words_scene, "screenshot": screenshot, "image": image, "list": list_scene,
          "steps": steps, "big_number": big_number, "chart": chart, "comparison": comparison, "quote": quote,
          "timeline": timeline, "people": people, "phone": phone, "logo_wall": logo_wall, "event_card": event_card,
          "end_card": end_card, "custom": words_scene}
