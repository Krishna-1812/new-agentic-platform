"""The picture in each Slack digest message: daily spend and conversions for the last 14 days.

Two small multiples, each a single series on its own scale (never one chart with two y-axes), drawn
with Pillow on a light card so it reads the same in Slack's light and dark themes. The latest day,
the one the message is about, is the darker bar and the only one labelled; the dashed line is the
7-day average the message compares it with. Colours: the reference data-viz palette's blue (spend)
and aqua (conversions) ramps, text in neutral ink, never in the series colour.
"""
import datetime as _dt
import io
import os

from PIL import Image, ImageDraw, ImageFont

# DejaVu Sans (tracker/fonts, free licence in LICENSE-DejaVu.txt): it has the rupee sign, which
# Pillow's built-in font and many server images lack.
FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")

DAYS = 14
SCALE = 2                      # drawn at twice the size Slack shows it, so it stays sharp
W, H = 1000, 340
SURFACE = (252, 252, 251)
BORDER = (229, 228, 223)
INK = (11, 11, 11)
INK_2 = (82, 81, 78)
INK_3 = (140, 139, 134)
GRID = (236, 235, 231)
SERIES = {"cost": ((134, 182, 239), (28, 92, 171)),        # blue 250 / 550
          "conversions": ((120, 214, 176), (13, 120, 84))}  # aqua light / dark step


def _font(size, bold=False):
    try:
        return ImageFont.truetype(os.path.join(FONT_DIR, "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"),
                                  size * SCALE)
    except OSError:
        return ImageFont.load_default(size=size * SCALE)


def days_for(rows, account, last, days=DAYS):
    """[(day, cost, conversions)] for the `days` days ending on `last`; a day without rows is zero."""
    end = _dt.date.fromisoformat(last)
    span = [(end - _dt.timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)]
    tot = {d: [0.0, 0.0] for d in span}
    for r in rows:
        if r.get("account") == account and r.get("day") in tot:
            tot[r["day"]][0] += r.get("cost") or 0.0
            tot[r["day"]][1] += r.get("conversions") or 0.0
    return [(d, tot[d][0], tot[d][1]) for d in span]


def _short(day):
    d = _dt.date.fromisoformat(day)
    return "%d %s" % (d.day, d.strftime("%b"))


def _panel(draw, box, title, values, labels, avg, fmt, colors):
    x0, y0, x1, y1 = [v * SCALE for v in box]
    light, dark = colors
    f_title, f_latest, f_small = _font(15, bold=True), _font(15, bold=True), _font(12)
    n = len(values)
    # Title row: what it is on the left, the latest day's value on the right (the only value label).
    draw.text((x0, y0), title, font=f_title, fill=INK)
    draw.text((x1, y0), "%s  %s" % (labels[-1], fmt(values[-1])), font=f_latest, fill=INK, anchor="ra")
    # Key row: the dashed line is the 7-day average.
    ky = y0 + 30 * SCALE
    if avg:
        for k in range(3):
            draw.line([(x0 + k * 9 * SCALE, ky + 7 * SCALE), (x0 + k * 9 * SCALE + 5 * SCALE, ky + 7 * SCALE)],
                      fill=INK_2, width=SCALE)
        draw.text((x0 + 30 * SCALE, ky), "7-day average %s" % fmt(avg), font=f_small, fill=INK_2)
    top, base = y0 + 70 * SCALE, y1 - 26 * SCALE
    peak = max(max(values), avg or 0) or 1.0
    # One recessive gridline at the top of the scale, labelled at its right end; the baseline below.
    draw.line([(x0, top), (x1, top)], fill=GRID, width=SCALE)
    draw.text((x1, top - 3 * SCALE), fmt(peak), font=f_small, fill=INK_3, anchor="rd")
    draw.line([(x0, base), (x1, base)], fill=BORDER, width=SCALE)
    slot = (x1 - x0) / n
    bar = min(24 * SCALE, slot * 0.62)
    for i, v in enumerate(values):
        cx = x0 + slot * (i + 0.5)
        h = 0 if peak <= 0 else (base - top) * (v / peak)
        if h > 0:
            h = max(h, 2 * SCALE)
            fill = dark if i == n - 1 else light
            r = min(4 * SCALE, int(bar / 2), int(h))
            # Rounded data end, square at the baseline.
            draw.rounded_rectangle([cx - bar / 2, base - h, cx + bar / 2, base], radius=r, fill=fill)
            draw.rectangle([cx - bar / 2, base - min(h, r), cx + bar / 2, base], fill=fill)
    if avg:
        ya = base - (base - top) * (avg / peak)
        x = x0
        while x < x1:   # dashed 7-day average
            draw.line([(x, ya), (min(x + 8 * SCALE, x1), ya)], fill=INK_2, width=SCALE)
            x += 14 * SCALE
    for i, anchor in ((0, "la"), (n // 2, "ma"), (n - 1, "ra")):
        cx = x0 if anchor == "la" else x1 if anchor == "ra" else x0 + slot * (i + 0.5)
        draw.text((cx, base + 8 * SCALE), labels[i], font=f_small, fill=INK_3, anchor=anchor)


def render(series, money, base_cost=None, base_conv=None):
    """PNG bytes. series: [(day, cost, conversions)]; money: value -> text (e.g. gads_digest.money)."""
    img = Image.new("RGBA", (W * SCALE, H * SCALE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, W * SCALE - 1, H * SCALE - 1], radius=16 * SCALE, fill=SURFACE,
                        outline=BORDER, width=SCALE)
    labels = [_short(s[0]) for s in series]

    def count(v):
        return ("%.0f" % v) if abs(v - round(v)) < 0.05 else ("%.1f" % v)

    _panel(d, (32, 24, 476, H - 20), "Spend", [s[1] for s in series], labels,
           base_cost, money, SERIES["cost"])
    _panel(d, (524, 24, W - 32, H - 20), "Conversions", [s[2] for s in series],
           labels, base_conv, count, SERIES["conversions"])
    out = io.BytesIO()
    img.save(out, "PNG", optimize=True)
    return out.getvalue()
