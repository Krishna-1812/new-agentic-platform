"""Video Studio: the brand a video is made in (plan section 3.1, "Brand").

resolve() merges, field by field, in this order: what the person set by
hand, then the brand saved for this client, then what was read from the
website, then a neutral default. The result says where each part came from,
so the plan screen can show it:

    {"colors": {"background", "text", "accent", "on_accent", "muted"},
     "fonts": {"heading", "body"}, "font_swaps": [{"asked", "used", "role"}],
     "logo_asset": id | None, "source": {"colors": "...", "fonts": "...", "logo": "..."}}

Colours are checked: the text must be readable on the background (WCAG 4.5:1)
and the accent must stand out from it, or they are corrected.
"""

from __future__ import annotations

import re

from tracker import video_fonts
from tracker.video_site import contrast, luminance

DEFAULT = {"background": "#F7F5F0", "text": "#16181D", "accent": "#2F5BEA",
           "heading_font": "Inter", "body_font": "Inter"}
_HEX = re.compile(r"^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
COLOR_KEYS = ("background", "text", "accent")
SOURCES = ("manual", "saved", "website", "default")


def hex_colour(value):
    """"#abc", "ABCDEF" -> "#aabbcc"; anything else -> None."""
    m = _HEX.match(str(value or "").strip())
    if not m:
        return None
    h = m.group(1).lower()
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return "#" + h


def _mix(a, b, t):
    from tracker.video_site import rgb
    ra, rb = rgb(a), rgb(b)
    return "#" + "".join("%02x" % round(x + (y - x) * t) for x, y in zip(ra, rb))


def fix_colours(bg, text, accent):
    """Readable text, a visible accent, and the colour to write on the accent."""
    if contrast(bg, text) < 4.5:
        text = "#111111" if luminance(bg) > 0.35 else "#F5F5F5"
    if contrast(bg, accent) < 1.5:
        accent = text
    on_accent = "#111111" if contrast(accent, "#111111") >= contrast(accent, "#FFFFFF") else "#FFFFFF"
    return {"background": bg, "text": text, "accent": accent, "on_accent": on_accent, "muted": _mix(text, bg, 0.35)}


def resolve(manual=None, saved=None, website=None, *, website_logo_asset=None, saved_logo_asset=None,
            manual_logo_asset=None):
    layers = [("manual", manual or {}), ("saved", saved or {}), ("website", website or {}), ("default", DEFAULT)]
    picked, source = {}, {}
    for key in COLOR_KEYS:
        for name, layer in layers:
            c = hex_colour(layer.get(key))
            if c:
                picked[key], source[key] = c, name
                break
    for key in ("heading_font", "body_font"):
        for name, layer in layers:
            if str(layer.get(key) or "").strip():
                picked[key], source[key] = layer[key], name
                break
    colours = fix_colours(picked["background"], picked["text"], picked["accent"])
    swaps, fonts = [], {}
    for key, role in (("heading_font", "heading"), ("body_font", "body")):
        r = video_fonts.resolve(picked[key], role)
        fonts[role] = r["family"]
        if r["swapped"]:
            swaps.append({"asked": r["asked"], "used": r["family"], "role": role})
    logo, logo_src = None, None
    for name, aid in (("manual", manual_logo_asset), ("saved", saved_logo_asset), ("website", website_logo_asset)):
        if aid:
            logo, logo_src = aid, name
            break
    colour_src = sorted({source[k] for k in COLOR_KEYS}, key=SOURCES.index)
    font_src = sorted({source["heading_font"], source["body_font"]}, key=SOURCES.index)
    return {"colors": colours, "fonts": fonts, "font_swaps": swaps, "logo_asset": logo,
            "source": {"colors": colour_src[0], "fonts": font_src[0], "logo": logo_src}}


def to_saved(brand):
    """What is kept for a client: the colours and the fonts as chosen."""
    c = brand["colors"]
    return {"background": c["background"], "text": c["text"], "accent": c["accent"],
            "heading_font": brand["fonts"]["heading"], "body_font": brand["fonts"]["body"]}
