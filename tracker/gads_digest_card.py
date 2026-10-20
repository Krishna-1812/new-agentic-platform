"""The picture in each account's Slack update: the client report as an image.

Laid out like the Looker Studio page the clients see, on a white card over a soft grey page: the
account's name and the month so far (the 1st to yesterday) in a navy pill; a navy band with the month's nine figures; the latest day as a one-row table; and
the month's budget as a bar (spent so far, with a tick where an even pace would be by the latest day)
over four boxes: allocation, projected, spent, and over or under. Drawn with Pillow in Inter
(tracker/fonts, SIL Open Font License, LICENSE-Inter.txt), which has the rupee sign, opaque so it reads
the same in Slack's light and dark themes. Text is in ink tones; colour marks status only.

card_data(summary) turns a digest summary (tracker/gads_digest.summarize) into the few strings and
shares the picture shows; that small dict is what the app stores, and render(data) draws it when Slack
asks.
"""
import io
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from tracker import gads_digest as d

FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
WEIGHTS = {"regular": "Inter-Regular.otf", "semibold": "Inter-SemiBold.otf", "bold": "Inter-Bold.otf"}
SCALE = 2                      # drawn at twice the size Slack shows it, so it stays sharp
W = 1200
MARGIN = 20                    # page around the card
PAD = 36                       # inside the card
ON_PACE = 0.1                  # spent within 10% of the even pace counts as on pace

PAGE = (243, 244, 247)
CARD = (255, 255, 255)
LINE = (228, 229, 235)
NAVY = (22, 25, 76)
NAVY_2 = (35, 39, 105)
NAVY_SOFT = (238, 239, 248)
INK = (17, 19, 38)
INK_2 = (84, 87, 105)
INK_3 = (138, 141, 158)
ON_NAVY = (255, 255, 255)
ON_NAVY_2 = (178, 182, 222)
TRACK = (233, 234, 241)
# Status: (mark, tint behind its label). Reserved for status; text beside them stays in ink.
STATUS = {d.CRITICAL: ((208, 59, 59), (252, 235, 235)), d.WARNING: ((214, 150, 10), (253, 244, 222)),
          "good": ((12, 140, 60), (226, 245, 233))}
PACE = {"over": STATUS[d.WARNING], "under": STATUS[d.WARNING], "on": STATUS["good"]}

_FONTS = {}


def _font(size, weight="regular"):
    key = (size, weight)
    if key not in _FONTS:
        try:
            _FONTS[key] = ImageFont.truetype(os.path.join(FONT_DIR, WEIGHTS[weight]), int(size * SCALE))
        except OSError:
            _FONTS[key] = ImageFont.load_default(size=int(size * SCALE))
    return _FONTS[key]


def card_data(s):
    """The strings and shares the picture shows, from one account's digest summary (JSON-safe)."""
    cur, m = s["cur"], s["mtd"]
    b = s.get("budget")
    budget = None
    if b:
        diff = b["diff"]
        pace = b["spent"] / b["projected"] if b["projected"] else None
        state = "on" if pace is None or abs(pace - 1) <= ON_PACE else "over" if diff > 0 else "under"
        word = "Overspent" if diff > 0.005 else "Underspent" if diff < -0.005 else "On budget"
        through = d.range_label(b["through"], b["through"]).split(" - ")[1].split(",")[0]
        budget = {
            "boxes": [["Budget allocation", d.money(b["allocated"], cur, cents=True)],
                      ["Projected to " + through, d.money(b["projected"], cur, cents=True)],
                      ["Spent so far", d.money(b["spent"], cur, cents=True)],
                      [word, ("+" if diff > 0.005 else "") + d.money(diff, cur, cents=True)]],
            "spent_share": b["spent"] / b["allocated"], "expected_share": b["projected"] / b["allocated"],
            "state": state, "through": through,
            "pace": "" if pace is None else (
                "On pace" if state == "on" else "%d%% %s pace" % (round(abs(pace - 1) * 100),
                                                                "ahead of" if diff > 0 else "behind")),
            "daily_budgets": b["source"] != "pacing_desk",
        }
    if s.get("source") == "api":
        note = "Google Ads API  ·  money in %s" % (cur or "the account's currency")
    else:
        note = "From the Google Ads sheet (the API could not be read), so phone calls are missing  ·  money in %s" % (
            cur or "the report's currency")
    if budget and budget["daily_budgets"]:
        note += "  ·  allocation: the campaigns' daily budgets (no Pacing Desk budget this month)"
    day = s["day"]
    return {"account": s.get("name") or s["account"], "span": d.range_label(m["start"], day),
            "kpis": [[label, value] for label, _, value in d._figures(m, cur)],
            "day": d.range_label(day, day).split(" - ")[1],
            "day_values": [[label, value] for label, _, value in d._figures(s.get("day_totals") or s["now"], cur)],
            "budget": budget, "note": note}


# ── Drawing helpers (coordinates in the size Slack shows; SCALE applied here) ──
def _fit(draw, text, width, size, weight="regular", smallest=9):
    """The largest font no bigger than `size` that fits `text` in `width`."""
    while size > smallest:
        f = _font(size, weight)
        if draw.textlength(text, font=f) <= width * SCALE:
            return f
        size -= 0.5
    return _font(smallest, weight)


def _text(draw, xy, text, font, fill, anchor="la"):
    draw.text((xy[0] * SCALE, xy[1] * SCALE), text, font=font, fill=fill, anchor=anchor)


def _len(draw, text, font):
    return draw.textlength(text, font=font) / SCALE


def _box(draw, box, radius=0, fill=None, outline=None, width=1):
    x0, y0, x1, y1 = box
    draw.rounded_rectangle([x0 * SCALE, y0 * SCALE, x1 * SCALE, y1 * SCALE], radius=radius * SCALE,
                           fill=fill, outline=outline, width=width * SCALE if outline else 0)


def _gradient(img, box, radius, top, bottom):
    """A rounded box filled with a vertical gradient from `top` to `bottom`."""
    x0, y0, x1, y1 = [int(v * SCALE) for v in box]
    w, h = x1 - x0, y1 - y0
    grad = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        grad.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    grad = grad.resize((w, h))
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=int(radius * SCALE), fill=255)
    img.paste(grad, (x0, y0), mask)


def _shadow(img, box, radius):
    x0, y0, x1, y1 = [int(v * SCALE) for v in box]
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle([x0, y0 + 6 * SCALE, x1, y1 + 6 * SCALE], radius=int(radius * SCALE),
                                            fill=(22, 25, 76, 34))
    layer = layer.filter(ImageFilter.GaussianBlur(14 * SCALE))
    img.paste(layer, (0, 0), layer)


def _section(draw, x, y, title, aside=""):
    f = _font(13, "semibold")
    _text(draw, (x, y), title.upper(), f, INK_2)
    if aside:
        _text(draw, (x + _len(draw, title.upper(), f) + 10, y), aside, _font(13), INK_3)


def _initials(name):
    words = [w for w in "".join(c if c.isalnum() else " " for c in name).split() if w]
    return "".join(w[0] for w in words[:2]).upper() or "?"


def render(data):
    """PNG bytes of one account's card."""
    budget = data.get("budget")
    budget_h = 214 if budget else 70
    card_h = PAD + 64 + 26 + 124 + 34 + 128 + 34 + budget_h + 16 + PAD - 12
    h = card_h + 2 * MARGIN
    img = Image.new("RGB", (W * SCALE, h * SCALE), PAGE)
    card = (MARGIN, MARGIN, W - MARGIN, MARGIN + card_h)
    _shadow(img, card, 22)
    dr = ImageDraw.Draw(img)
    _box(dr, card, 22, fill=CARD, outline=LINE)
    x0, x1 = MARGIN + PAD, W - MARGIN - PAD
    inner = x1 - x0
    y = MARGIN + PAD

    # Header: initials, name, status; the month so far on the right.
    _box(dr, (x0, y, x0 + 56, y + 56), 16, fill=NAVY)
    _text(dr, (x0 + 28, y + 28), _initials(data["account"]), _font(21, "bold"), ON_NAVY, "mm")
    pill = _font(15, "semibold")
    span = data["span"]
    pw = _len(dr, span, pill) + 40
    name_w = inner - 76 - pw - 24
    _text(dr, (x0 + 74, y + 2), data["account"], _fit(dr, data["account"], name_w, 27, "bold"), INK)
    _text(dr, (x0 + 74, y + 50), "Daily performance  \u00b7  month to date", _font(13.5), INK_3, "lm")
    _box(dr, (x1 - pw, y + 8, x1, y + 48), 20, fill=NAVY)
    _text(dr, (x1 - pw / 2, y + 28), span, pill, ON_NAVY, "mm")
    y += 64 + 26

    # The month's nine figures on a navy band, divided by hairlines.
    band = (x0, y, x1, y + 124)
    _gradient(img, band, 18, NAVY_2, NAVY)
    dr = ImageDraw.Draw(img)
    kpis = data["kpis"]
    col = inner / len(kpis)
    big = min((_fit(dr, v, col - 18, 27, "bold") for _, v in kpis), key=lambda f: f.size)
    for i, (label, value) in enumerate(kpis):
        cx = x0 + col * i + col / 2
        if i:
            lx = x0 + col * i
            dr.line([(lx * SCALE, (y + 30) * SCALE), (lx * SCALE, (y + 94) * SCALE)], fill=(58, 62, 128), width=SCALE)
        _text(dr, (cx, y + 44), label, _fit(dr, label, col - 14, 13.5, "semibold"), ON_NAVY_2, "mm")
        _text(dr, (cx, y + 80), value, big, ON_NAVY, "mm")
    y += 124 + 34

    # The latest day as a table.
    _section(dr, x0, y, "Yesterday", data["day"])
    y += 28
    heads = ["Day"] + [label for label, _ in data["day_values"]]
    vals = [data["day"]] + [v for _, v in data["day_values"]]
    _box(dr, (x0, y, x1, y + 100), 14, fill=CARD, outline=LINE)
    _box(dr, (x0 + 1, y + 1, x1 - 1, y + 42), 13, fill=NAVY_SOFT)
    _box(dr, (x0 + 1, y + 28, x1 - 1, y + 42), 0, fill=NAVY_SOFT)
    dr.line([((x0 + 1) * SCALE, (y + 42) * SCALE), ((x1 - 1) * SCALE, (y + 42) * SCALE)], fill=LINE, width=SCALE)
    first = 136
    rest = (inner - first) / (len(heads) - 1)
    for i, (head, val) in enumerate(zip(heads, vals)):
        cx0 = x0 + (0 if i == 0 else first + rest * (i - 1))
        w = first if i == 0 else rest
        _text(dr, (cx0 + w / 2, y + 22), head, _fit(dr, head, w - 10, 12.5, "semibold"), INK_2, "mm")
        _text(dr, (cx0 + w / 2, y + 71), val, _fit(dr, val, w - 10, 16, "semibold" if i else "regular"), INK, "mm")
    y += 100 + 34

    # The month's budget: a bar, then four boxes.
    if budget:
        _section(dr, x0, y, "Budget this month")
        pmark, ptint = PACE[budget["state"]]
        pace = budget["pace"]
        if pace:
            pf = _font(12.5, "semibold")
            pw2 = _len(dr, pace, pf) + 36
            _box(dr, (x1 - pw2, y - 5, x1, y + 19), 12, fill=ptint)
            _box(dr, (x1 - pw2 + 12, y + 3, x1 - pw2 + 20, y + 11), 4, fill=pmark)
            _text(dr, (x1 - pw2 + 28, y + 7), pace, pf, INK, "lm")
        y += 34
        bar_y = y + 8
        _box(dr, (x0, bar_y, x1, bar_y + 14), 7, fill=TRACK)
        spent = max(0.0, min(1.0, budget["spent_share"]))
        if spent > 0:
            _box(dr, (x0, bar_y, x0 + max(14, inner * spent), bar_y + 14), 7, fill=NAVY)
        ex = x0 + inner * max(0.0, min(1.0, budget["expected_share"]))
        _box(dr, (ex - 1.5, bar_y - 7, ex + 1.5, bar_y + 21), 1.5, fill=INK)
        lbl = "Even pace by " + budget["through"]
        lf = _font(12)
        lw = _len(dr, lbl, lf)
        _text(dr, (min(max(ex - lw / 2, x0), x1 - lw), bar_y + 26), lbl, lf, INK_2)
        y = bar_y + 54
        gap = 14
        bw = (inner - 3 * gap) / 4
        for i, (label, value) in enumerate(budget["boxes"]):
            bx = x0 + i * (bw + gap)
            last = i == 3
            _box(dr, (bx, y, bx + bw, y + 92), 14, fill=ptint if last else NAVY_SOFT)
            if last:
                _box(dr, (bx + 18, y + 24, bx + 26, y + 32), 4, fill=pmark)
            _text(dr, (bx + (34 if last else 18), y + 28), label, _fit(dr, label, bw - 50, 13.5, "semibold"), INK_2, "lm")
            _text(dr, (bx + 18, y + 62), value, _fit(dr, value, bw - 36, 25, "bold"), INK, "lm")
        y += 92 + 30
    else:
        _section(dr, x0, y, "Budget this month")
        _text(dr, (x0, y + 30), "No budget for this account in the Pacing Desk this month. Add one there to see "
              "the budget.", _font(14.5), INK_2)
        y += 70
    note = data.get("note") or ""
    _text(dr, (x0, y), note, _fit(dr, note, inner, 12), INK_3)

    out = io.BytesIO()
    img.save(out, "PNG", optimize=True)
    return out.getvalue()
