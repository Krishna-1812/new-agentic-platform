"""Video Studio: putting a plan together as a HyperFrames composition.

compose() turns an approved plan, its brand and its shape into the files of
one composition: index.html (every scene from the scene library, in order,
on one GSAP timeline) and the pictures it uses under media/. The bundled kit
(GSAP, fonts) is added by the sandbox, so the files hold no outside address.

Timing: each scene starts where the one before ends and stays on screen
OVERLAP seconds longer, under the next scene's entrance (a wipe), so cuts
never flash the background. Scenes alternate between two tracks.
"""

from __future__ import annotations

from tracker import video_config as cfg
from tracker import video_fonts, video_music, video_scenes
from tracker.video_site import contrast

OVERLAP = 0.35
EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}

COUNT_UP_JS = r"""
      function countUp(sel, pre, post, dec, grouping, value, at, d) {
        const el = document.querySelector(sel);
        if (!el) return;
        const fmt = (n) => {
          let s = Math.abs(n).toFixed(dec), parts = s.split("."), i = parts[0];
          if (grouping === "indian" && i.length > 3) {
            i = i.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + i.slice(-3);
          } else if (grouping === "intl") {
            i = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
          }
          return (n < 0 ? "-" : "") + i + (parts[1] ? "." + parts[1] : "");
        };
        const box = { v: 0 };
        tl.fromTo(box, { v: 0 }, { v: value, duration: d, ease: "power2.out", immediateRender: true,
          onUpdate: () => { el.textContent = pre + fmt(box.v) + post; } }, at);
      }"""


def _mix(a, b, t):
    from tracker.video_site import rgb
    ra, rb = rgb(a), rgb(b)
    return "#" + "".join("%02x" % round(x + (y - x) * t) for x, y in zip(ra, rb))


def theme_css(brand):
    c = brand["colors"]
    bg, fg, accent = c["background"], c["text"], c["accent"]
    hl = accent if contrast(accent, bg) >= 3 else fg
    hl_inv = accent if contrast(accent, fg) >= 3 else bg
    return """
      :root { --accent: %(accent)s; --on-accent: %(on)s; --head: %(head)s; --body: %(body)s; }
      .scene.base { --bgc: %(bg)s; --fg: %(fg)s; --hl: %(hl)s; --muted: %(muted)s; --card: %(card)s; }
      .scene.inv { --bgc: %(fg)s; --fg: %(bg)s; --hl: %(hl_inv)s; --muted: %(muted_inv)s; --card: %(card_inv)s; }
      .scene { background: var(--bgc); color: var(--fg); }
      .scene .head, .scene h2, .scene h1, .scene h3 { font-family: var(--head); font-weight: 600; letter-spacing: -0.015em; }
      /* Each word rises from behind its own mask; the padding keeps descenders and italics whole. */
      .w { display: inline-block; overflow: hidden; vertical-align: top; padding: 0.1em 0.06em 0.18em; margin: -0.1em -0.06em -0.18em; }
      .wi { display: inline-block; }
      .em { color: var(--hl); }%(em_it)s
""" % {"accent": accent, "on": c["on_accent"], "head": video_fonts.stack(brand["fonts"]["heading"]),
       "body": video_fonts.stack(brand["fonts"]["body"]), "bg": bg, "fg": fg, "hl": hl, "hl_inv": hl_inv,
       "muted": _readable_mix(fg, bg), "card": _mix(fg, bg, 0.93), "muted_inv": _readable_mix(bg, fg),
       "card_inv": _mix(bg, fg, 0.86),
       "em_it": "\n      .em { font-style: italic; }" if video_fonts.has_italic(brand["fonts"]["heading"]) else ""}


def _readable_mix(fg, bg):
    """The softest mix of fg into bg that still reads (4.5:1)."""
    for t in (0.32, 0.26, 0.2, 0.14, 0.08, 0.0):
        m = _mix(fg, bg, t)
        if contrast(m, bg) >= 4.6:
            return m
    return fg


def logo_is_light(data):
    """Whether a logo is drawn in light ink (white on transparent, say), so it needs a dark
    surface or a tint. Judged from its visible pixels; a logo on an opaque box counts as dark."""
    import io
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data)).convert("RGBA")
        im.thumbnail((200, 200))
        raw = im.tobytes()
        px = [tuple(raw[i:i + 4]) for i in range(0, len(raw), 4) if raw[i + 3] > 128]
        if not px or len(px) > 0.97 * im.width * im.height:
            return False
        lum = sum(0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b, a in px) / len(px)
        return lum > 170
    except Exception:
        return False


def scene_assets(plan, brand):
    """Every asset id the plan's scenes and the brand's logo use."""
    ids = []
    for s in plan.get("scenes") or []:
        ids.extend(s.get("asset_ids") or [])
    if brand.get("logo_asset"):
        ids.append(brand["logo_asset"])
    return list(dict.fromkeys(i for i in ids if i))


def compose(plan, brand, shape, *, assets, tables):
    """{"files", "duration", "cover_at", "scenes": [(start, end)]}.

    assets: {id: {"bytes", "mime", "width", "height", "kind"}} for the pictures used;
    tables: {id: numbers data} for charts.
    """
    size = cfg.SHAPES[shape]
    files, amap = {}, {}
    for aid, a in assets.items():
        ext = EXT.get(a.get("mime"))
        if not ext or not a.get("bytes"):
            continue
        path = "media/a%d.%s" % (aid, ext)
        files[path] = a["bytes"]
        amap[aid] = {"path": path, "w": a.get("width") or 1, "h": a.get("height") or 1, "kind": a.get("kind")}
    b = dict(brand)
    logo = amap.get(brand.get("logo_asset"))
    b["logo_path"] = logo["path"] if logo else None
    if logo:
        b["logo_w"], b["logo_h"] = logo["w"], logo["h"]
        b["logo_light"] = logo_is_light(assets[brand["logo_asset"]].get("bytes"))
    ctx = video_scenes.Ctx(shape, size, b, amap, tables)
    sections, css, js, spans = [], [], [], []
    scenes = plan.get("scenes") or []
    t = 0.0
    for i, s in enumerate(scenes):
        sec = float(s.get("seconds") or 0)
        last = i == len(scenes) - 1
        sid = "s%d" % (i + 1)
        render = video_scenes.RENDER.get(s.get("type"), video_scenes.words_scene)
        inner, scss, sjs = render(ctx, s, sid, t, sec)
        theme = "inv" if s.get("type") in video_scenes.INVERSE else "base"
        sections.append('<section id="%s" class="clip scene %s" data-start="%s" data-duration="%s" data-track-index="%d">'
                        '%s</section>' % (sid, theme, _n(t), _n(sec if last else sec + OVERLAP), i % 2, inner))
        css.append(scss)
        if i > 0:
            js.append('tl.fromTo("#%s", { clipPath: "inset(100%% 0%% 0%% 0%%)" }, { clipPath: "inset(0%% 0%% 0%% 0%%)", '
                      'duration: 0.5, ease: "power3.inOut" }, %.3f);' % (sid, t))
        js.extend(line for line in sjs if line)
        spans.append((t, t + sec))
        t += sec
    duration = round(t, 3)
    cover = plan.get("cover_scene") if isinstance(plan.get("cover_scene"), int) else 0
    cover = min(max(0, cover), max(0, len(spans) - 1))
    cover_at = round(spans[cover][0] + (spans[cover][1] - spans[cover][0]) * 0.75, 2) if spans else 0.0
    fonts = video_fonts.font_css([brand["fonts"]["heading"], brand["fonts"]["body"]])
    W, H = size
    page = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=%(W)d, height=%(H)d" />
    <title>Video</title>
    <script src="kit/gsap.min.js"></script>
    <style>
%(fonts)s
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: %(W)dpx; height: %(H)dpx; overflow: hidden; background: %(bg)s; }
      #root { position: relative; width: 100%%; height: 100%%; overflow: hidden; font-family: var(--body); }
      .clip { position: absolute; inset: 0; overflow: hidden; }
%(theme)s
%(css)s
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="%(d)s" data-width="%(W)d" data-height="%(H)d">
%(sections)s
%(music)s
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const U = %(u).4f;
      const tl = gsap.timeline({ paused: true });
%(countup)s
%(js)s
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
""" % {"W": W, "H": H, "fonts": fonts, "bg": brand["colors"]["background"], "theme": theme_css(brand),
       "css": "\n".join(css), "d": _n(duration), "sections": "\n".join("      " + x for x in sections),
       "music": "      " + video_music.audio_html(plan.get("music"), duration),
       "u": ctx.u, "countup": COUNT_UP_JS, "js": "\n".join("      " + x for x in js)}
    files["index.html"] = page.encode("utf-8")
    return {"files": files, "duration": duration, "cover_at": cover_at, "scenes": spans}


def _n(x):
    return ("%.3f" % float(x)).rstrip("0").rstrip(".")


def stored(files):
    """Files as stored on a version: text as text, pictures as base64."""
    import base64
    out = {}
    for path, data in files.items():
        if path.endswith((".html", ".css", ".js", ".json", ".svg", ".txt")):
            out[path] = {"text": data.decode("utf-8") if isinstance(data, bytes) else data}
        else:
            out[path] = {"b64": base64.b64encode(data).decode("ascii")}
    return out
