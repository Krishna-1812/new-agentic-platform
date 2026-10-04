"""Video Studio: what people upload, checked and made safe to use.

  image()    PNG, JPEG, WebP or GIF (its first frame), up to UPLOAD_MAX_BYTES.
             It is decoded by Pillow, which refuses anything that is not
             really an image, then re-encoded: that strips hidden data
             (EXIF, location, comments) and caps the long side at 2560 px.
  text()     a script, notes, a quote: kept as given, up to MAX_TEXT chars.
  numbers()  a CSV file or a table pasted from a spreadsheet, up to MAX_ROWS
             rows. Each cell is read as a number when it is one ("42%",
             "₹1,549", "-18.5"), so a chart can use it; the text is kept too.

Each raises Bad with a sentence that can be shown to the person.
"""

from __future__ import annotations

import csv
import io
import itertools
import re

MAX_IMAGES = 12
UPLOAD_MAX_BYTES = 15 * 1024 * 1024
MAX_PIXELS = 40_000_000          # decoded size; a larger file is a decompression bomb
MAX_SIDE = 2560
MAX_TEXT = 20_000
MAX_ROWS = 50
MAX_COLS = 12
MAX_CELL = 200
# A pasted or uploaded table, in characters (the CSV file limit is 512 KB).
MAX_TABLE_CHARS = 512 * 1024
ALLOWED_FORMATS = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp", "GIF": "image/gif"}


class Bad(ValueError):
    """An upload that cannot be used; the message is for the person."""


def image(data, name=""):
    """{"bytes", "mime", "width", "height", "name"}: the image re-encoded."""
    from PIL import Image, ImageOps
    if not data:
        raise Bad("%s is empty." % (name or "The image"))
    if len(data) > UPLOAD_MAX_BYTES:
        raise Bad("%s is larger than %d MB." % (name or "The image", UPLOAD_MAX_BYTES // (1024 * 1024)))
    try:
        # Opening reads only the header, so the size is checked before any
        # pixels are decoded (Pillow's own global limit is left alone).
        with Image.open(io.BytesIO(data)) as probe:
            fmt = probe.format
            if fmt not in ALLOWED_FORMATS:
                raise Bad("%s is not a PNG, JPEG, WebP or GIF image." % (name or "The file"))
            if probe.width * probe.height > MAX_PIXELS:
                raise Bad("%s is too large in pixels." % (name or "The image"))
            probe.verify()
        im = Image.open(io.BytesIO(data))
        im.seek(0)
        im = ImageOps.exif_transpose(im)
        im.load()
    except Bad:
        raise
    except Image.DecompressionBombError:
        raise Bad("%s is too large in pixels." % (name or "The image"))
    except Exception:
        raise Bad("%s could not be read as an image." % (name or "The file"))
    alpha = im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info)
    im = im.convert("RGBA" if alpha else "RGB")
    if max(im.size) > MAX_SIDE:
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    out = io.BytesIO()
    if alpha:
        im.save(out, "PNG", optimize=True)
        mime = "image/png"
    else:
        im.save(out, "JPEG", quality=88, optimize=True, progressive=True)
        mime = "image/jpeg"
    return {"bytes": out.getvalue(), "mime": mime, "width": im.width, "height": im.height,
            "name": _name(name)}


def _name(name):
    return re.sub(r"[^\w .()-]+", "", str(name or ""))[:120].strip() or "image"


def text(value, name="text"):
    t = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    t = "".join(c for c in t if c in "\n\t" or ord(c) >= 32).strip()
    if not t:
        raise Bad("The %s is empty." % name)
    if len(t) > MAX_TEXT:
        raise Bad("The %s is longer than %d characters." % (name, MAX_TEXT))
    return t


_NUM = re.compile(r"^\s*([-+−]?)\s*([$€£₹¥]|rs\.?|inr|usd|eur)?\s*([-+−]?)(\d{1,3}(?:,\d{2,3})+|\d+)(\.\d+)?\s*"
                  r"(%|k|m|bn|mn|cr|lakh|lakhs|crore|crores)?\s*$", re.I)


def parse_number(cell):
    """The number in a cell ("₹1,549" -> 1549.0, "42%" -> 42.0), or None."""
    m = _NUM.match(str(cell or ""))
    if not m:
        return None
    sign = -1 if (m.group(1) or m.group(3)) in ("-", "−") else 1
    try:
        return sign * float(m.group(4).replace(",", "") + (m.group(5) or ""))
    except ValueError:
        return None


def numbers(raw, name="numbers"):
    """{"columns": [...], "rows": [[...]], "numeric": [col names], "values": {col: [float|None]}}."""
    if isinstance(raw, bytes):
        if len(raw) > 512 * 1024:
            raise Bad("The %s file is too large." % name)
        for enc in ("utf-8-sig", "cp1252"):
            try:
                raw = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
    t = str(raw or "").strip()
    if not t:
        raise Bad("The %s are empty." % name)
    if len(t) > MAX_TABLE_CHARS:
        raise Bad("The %s are too long; keep the table under %d rows." % (name, MAX_ROWS))
    t = t.replace("\x00", "")
    first = t.splitlines()[0]
    delim = max(("\t", ",", ";", "|"), key=lambda d: first.count(d))
    if first.count(delim) == 0:
        raise Bad("The %s need at least two columns (a label and a value)." % name)
    try:
        # Stop reading one row past the limit: a huge paste is refused, not parsed.
        rows = [r for r in itertools.islice((r for r in csv.reader(io.StringIO(t), delimiter=delim)
                                             if any(c.strip() for c in r)), MAX_ROWS + 2)]
    except csv.Error:
        raise Bad("The %s could not be read as a table." % name)
    if any("\n" in c for r in rows for c in r):
        raise Bad("The %s have a quote mark that is never closed; check the table." % name)
    if len(rows) < 2:
        raise Bad("The %s need a header row and at least one row of values." % name)
    if len(rows) - 1 > MAX_ROWS:
        raise Bad("The %s have more than %d rows." % (name, MAX_ROWS))
    width = len(rows[0])
    if width > MAX_COLS:
        raise Bad("The %s have more than %d columns." % (name, MAX_COLS))
    header = [c.strip()[:60] or "Column %d" % (i + 1) for i, c in enumerate(rows[0])]
    body = []
    for r in rows[1:]:
        r = [c.strip()[:MAX_CELL] for c in r][:width]
        body.append(r + [""] * (width - len(r)))
    values = {h: [parse_number(r[i]) for r in body] for i, h in enumerate(header)}
    numeric = [h for h in header if sum(v is not None for v in values[h]) >= max(1, (len(body) + 1) // 2)]
    return {"columns": header, "rows": body, "numeric": numeric, "values": values}
