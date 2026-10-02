"""Page Watch: what changed in how a page looks.

compare(before, after, ...) takes two full-page screenshots and finds the
areas that changed, as boxes, while ignoring:

  * what moves on its own: the cells that differ between a capture's
    screenshot and its control shot (taken a few seconds later) are noise
    for that capture, and so are the previous capture's noisy cells;
  * the areas the user chose to ignore;
  * a layout shift. When a section is added near the top, everything below
    it moves down; compared pixel for pixel, the whole rest of the page
    would count as changed. So the two pages are first lined up strip by
    strip (difflib over a fingerprint of each 8px strip): strips that match
    are compared cell by cell, strips only in the new page were added, and
    strips only in the old page were removed.

Cells are CELL px squares on the luminance channel. A cell changed when at
least CELL_CHANGED_SHARE of its pixels moved by more than PIXEL_DELTA; that
leaves anti-aliasing and font smoothing below the line. Changed cells closer
than JOIN_GAP_CELLS are joined into one area, and areas under MIN_AREA_PX are
dropped as stray pixels.

Everything here is pure (bytes in, numbers out), so it is tested without a
browser.
"""

from __future__ import annotations

import difflib
import io
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from tracker import watch_config as cfg

C = cfg.CELL


def load(png):
    """PNG bytes -> RGB uint8 array, height and width multiples of CELL (padded white)."""
    im = Image.open(io.BytesIO(png)).convert("RGB")
    a = np.asarray(im, dtype=np.uint8)
    h, w = a.shape[:2]
    H, W = -(-h // C) * C, -(-w // C) * C
    if (H, W) != (h, w):
        pad = np.full((H, W, 3), 255, dtype=np.uint8)
        pad[:h, :w] = a
        a = pad
    return a


def luma(a):
    """Luminance of an RGB array (for fingerprints and backgrounds)."""
    return (a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114).astype(np.float32)


def _moved(a, b):
    """Pixels where any colour channel differs by more than PIXEL_DELTA."""
    return (np.maximum(a, b) - np.minimum(a, b) > cfg.PIXEL_DELTA).any(axis=2)


def cell_changes(a, b, jitter=cfg.JITTER_PX):
    """Boolean grid (rows x cols of cells): which cells differ between two equal-sized RGB arrays.

    A pixel moved when any colour channel moved by more than PIXEL_DELTA, so a
    red button turned an equally bright blue still counts.

    With `jitter`, a pixel only counts when it differs from the old page at
    every offset up to `jitter` px: a page pushed down by a fractional amount
    (a 69.2px banner) is redrawn a fraction of a pixel off, and thin icons and
    text edges then differ by one pixel without anything having changed. A
    real change (a new colour, new words) differs at every offset.
    """
    d = _moved(a, b)
    if jitter and d.any():
        rows = np.nonzero(d.any(axis=1))[0]
        lo, hi = max(0, rows.min() - jitter), min(d.shape[0], rows.max() + jitter + 1)
        band = a[lo:hi]
        pad = np.pad(band, ((jitter, jitter), (jitter, jitter), (0, 0)), mode="edge")
        hb, wb = band.shape[:2]
        still = d[lo:hi].copy()
        for dy in range(-jitter, jitter + 1):
            for dx in range(-jitter, jitter + 1):
                if dy == 0 and dx == 0:
                    continue
                shifted = pad[jitter + dy:jitter + dy + hb, jitter + dx:jitter + dx + wb]
                still &= _moved(shifted, b[lo:hi])
                if not still.any():
                    break
        d = d.copy()
        d[lo:hi] = still
    rows, cols = d.shape[0] // C, d.shape[1] // C
    share = d[:rows * C, :cols * C].reshape(rows, C, cols, C).mean(axis=(1, 3))
    return share >= cfg.CELL_CHANGED_SHARE


def noise_cells(shot, control):
    """The cells that moved between a screenshot and its control shot, grown a little."""
    a, b = load(shot), load(control)
    h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
    grid = cell_changes(a[:h, :w], b[:h, :w])
    return grow(grid, cfg.NOISE_GROW_CELLS)


def grow(grid, n):
    """Dilate a boolean grid by n cells in every direction (square), with shifts."""
    if n <= 0 or not grid.any():
        return grid.copy()
    rows, cols = grid.shape
    tall = grid.copy()
    for d in range(1, n + 1):
        tall[d:] |= grid[:-d] if d < rows else False
        tall[:-d] |= grid[d:] if d < rows else False
    out = tall.copy()
    for d in range(1, n + 1):
        if d < cols:
            out[:, d:] |= tall[:, :-d]
            out[:, :-d] |= tall[:, d:]
    return out


def _row_sigs(a):
    """One fingerprint per pixel row: mean luminance of 64 column chunks, quantised.

    Rows, not CELL-high strips: a section inserted near the top pushes the
    rest down by any number of pixels, and only rows line up after that.
    """
    L = luma(a)
    h, w = L.shape
    chunks = 64
    edges = np.linspace(0, w, chunks + 1).astype(int)
    cs = np.cumsum(np.pad(L, ((0, 0), (1, 0))), axis=1)
    means = (cs[:, edges[1:]] - cs[:, edges[:-1]]) / np.maximum(1, edges[1:] - edges[:-1])
    q = np.ascontiguousarray((means / 10).astype(np.uint8))
    return [row.tobytes() for row in q]       # comparable across pages, unlike per-page ids


def align(a, b):
    """Line up the rows of two pages. Returns difflib opcodes over row indexes.

    Short "equal" runs between two changes (a blank row that happens to
    match) are folded into the change, and neighbouring changes are merged
    into one "replace", so a section that changed in place is compared cell
    by cell (with the noise masks) rather than as removed-then-added.
    """
    ops = _run_ops(_row_sigs(a), _row_sigs(b))
    folded = []
    for k, op in enumerate(ops):
        short_equal = (op[0] == "equal" and op[2] - op[1] <= 2 * C and 0 < k < len(ops) - 1
                       and ops[k - 1][0] != "equal" and ops[k + 1][0] != "equal")
        folded.append(("replace",) + tuple(op[1:]) if short_equal else op)
    out = []
    for op in folded:
        if op[0] != "equal" and out and out[-1][0] != "equal":
            prev = out.pop()
            op = ("replace", prev[1], op[2], prev[3], op[4])
        out.append(op)
    return out


def _runs(sigs):
    """Rows collapsed into runs of identical rows: ([(sig, length)], [start rows])."""
    runs, starts = [], []
    for i, sg in enumerate(sigs):
        if runs and runs[-1][0] == sg:
            runs[-1][1] += 1
        else:
            runs.append([sg, 1])
            starts.append(i)
    starts.append(len(sigs))
    return [tuple(r) for r in runs], starts


def _run_ops(sa, sb):
    """Row opcodes from matching runs (signature, length), not single rows.

    Pages are full of identical rows (blank space, flat bands); matched one by
    one, a 40px gap and a 120px gap look alike and the matcher anchors on the
    wrong one. As (signature, length) runs, structure decides the match.
    """
    ra, pa = _runs(sa)
    rb, pb = _runs(sb)
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, ra, rb, autojunk=False).get_opcodes():
        out.append((op, pa[i1], pa[i2], pb[j1], pb[j2]))
    return out


def row_map(ops, rows_after):
    """For each row of the new page, the old page's row it shows, or -1 (added)."""
    m = np.full(rows_after, -1, dtype=np.int64)
    for op, i1, i2, j1, j2 in ops:
        if op == "equal" or (op == "replace" and i2 - i1 == j2 - j1):
            m[j1:j2] = np.arange(i1, i2)
        elif op == "replace":
            n = min(i2 - i1, j2 - j1)
            m[j1:j1 + n] = np.arange(i1, i1 + n)
    return m


def regions(grid, min_area=cfg.MIN_AREA_PX, gap=cfg.JOIN_GAP_CELLS):
    """Boxes [x, y, w, h] in px around groups of changed cells."""
    if not grid.any():
        return []
    joined = grow(grid, gap // 2 + 1) if gap > 0 else grid
    rows, cols = grid.shape
    seen = np.zeros_like(joined)
    boxes = []
    for y0, x0 in zip(*np.nonzero(joined)):
        if seen[y0, x0]:
            continue
        q = deque([(y0, x0)])
        seen[y0, x0] = True
        cells = []
        while q:
            y, x = q.popleft()
            if grid[y, x]:
                cells.append((y, x))
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < rows and 0 <= nx < cols and joined[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        if not cells:
            continue
        ys = [c[0] for c in cells]
        xs = [c[1] for c in cells]
        box = [int(min(xs)) * C, int(min(ys)) * C, int(max(xs) - min(xs) + 1) * C, int(max(ys) - min(ys) + 1) * C]
        if box[2] * box[3] >= min_area:
            boxes.append(box)
    boxes.sort(key=lambda b: (b[1], b[0]))
    return boxes


def _mask_rects(grid, rects):
    """Clear the cells covered by px rects [x, y, w, h]."""
    rows, cols = grid.shape
    for x, y, w, h in rects or ():
        r0, r1 = max(0, int(y) // C), min(rows, -(-int(y + h) // C))
        c0, c1 = max(0, int(x) // C), min(cols, -(-int(x + w) // C))
        if r1 > r0 and c1 > c0:
            grid[r0:r1, c0:c1] = False
    return grid


def _fit(grid, shape):
    """A noise grid made the same shape as `shape` (cropped or padded with False)."""
    out = np.zeros(shape, dtype=bool)
    if grid is None:
        return out
    h, w = min(shape[0], grid.shape[0]), min(shape[1], grid.shape[1])
    out[:h, :w] = grid[:h, :w]
    return out


def _matches_at(src, dst, box, dx, dy, tolerance=0.02):
    """True when `box` in `dst` shows what `src` shows at the box moved by (-dx, -dy).

    Used to tell a block that only moved (a column shifted up after a
    removal, a fixed sidebar that stayed put while the page was pushed down)
    from one that changed.
    """
    x, y, w, h = [int(v) for v in box]
    sx, sy = x - int(dx), y - int(dy)
    if w <= 0 or h <= 0 or sx < 0 or sy < 0 or sx + w > src.shape[1] or sy + h > src.shape[0] \
            or x + w > dst.shape[1] or y + h > dst.shape[0]:
        return False
    W, H = -(-w // C) * C, -(-h // C) * C

    def pad(arr):
        out = np.full((H, W, 3), 255, dtype=np.uint8)
        out[:arr.shape[0], :arr.shape[1]] = arr
        return out
    g = cell_changes(pad(src[sy:sy + h, sx:sx + w]), pad(dst[y:y + h, x:x + w]))
    return g.mean() <= tolerance


def _drop_moves(a, b, boxes_after, boxes_before, shifts):
    """Leave out the areas whose content is the same, just moved by one of `shifts`."""
    cand = [(0, 0)] + [tuple(sh) for sh in shifts if tuple(sh) != (0, 0)]
    kept_after = [bx for bx in boxes_after if not any(_matches_at(a, b, bx, dx, dy) for dx, dy in cand)]
    kept_before = [bx for bx in boxes_before if not any(_matches_at(b, a, bx, -dx, -dy) for dx, dy in cand)]
    return kept_after, kept_before, len(boxes_after) - len(kept_after) + len(boxes_before) - len(kept_before)


def compare(before, after, *, after_control=None, before_noise=None, ignore=(), area=None, shifts=()):
    """Find what changed visually between two screenshots (PNG bytes).

    before_noise   the previous capture's noise grid (from noise_cells), or None.
    ignore         px rects on the OLD page to leave out (an area the user
                   picked, or one learned at calibration). They follow the
                   content: where the page moved, the new page's rows are
                   mapped back to the old page's, and rows the new page added
                   are never ignored, so a section inserted above an ignored
                   area neither hides under it nor pushes content out of it.
    area           px rect [x, y, w, h]: compare only inside it (cropped from both).

    Returns {"same", "after": [boxes], "before": [boxes], "added_px", "removed_px",
             "changed_share", "aligned", "noise_share", "size_before", "size_after",
             "rows"}; "rows" is the row map for watch_detect and is not stored.
    """
    a, b = load(before), load(after)
    noise_after = noise_cells(after, after_control) if after_control else np.zeros(
        (b.shape[0] // C, b.shape[1] // C), dtype=bool)
    ox = oy = 0
    if area:
        a, b, noise_after, before_noise = _crop_area(a, b, noise_after, before_noise, area)
        ox, oy = max(0, int(area[0])) // C * C, max(0, int(area[1])) // C * C
    w = min(a.shape[1], b.shape[1])
    a, b = a[:, :w], b[:, :w]
    # The control shot can come out a little shorter than the screenshot (the
    # page shrank between them); a noise grid always matches its page's shape.
    noise_after = _fit(noise_after, (b.shape[0] // C, w // C))
    noise_before = _fit(before_noise, (a.shape[0] // C, w // C))

    rows_b, cols = b.shape[0] // C, w // C
    rows_a = a.shape[0] // C
    ops = align(a, b)
    aligned = any(op[0] == "equal" for op in ops)
    amap = row_map(ops, b.shape[0])                       # new-page row -> old-page row
    mapped = amap >= 0

    # The old page redrawn in the new page's rows; unmapped rows copy the new
    # page, so they compare equal here and are judged as added below.
    redrawn = b.copy()
    redrawn[mapped] = a[amap[mapped]]
    changed = cell_changes(redrawn, b)

    # Noise: the new capture's own, and the old capture's carried across.
    cell_rows = np.arange(rows_b) * C + C // 2
    src = amap[np.minimum(cell_rows, b.shape[0] - 1)]
    carried = np.zeros((rows_b, cols), dtype=bool)
    ok = src >= 0
    carried[ok] = noise_before[np.minimum(src[ok] // C, noise_before.shape[0] - 1)]
    changed &= ~noise_after & ~carried

    # Rows only in the new page were added; rows only in the old were removed.
    added_rows = ~mapped
    used = np.zeros(a.shape[0], dtype=bool)
    used[amap[mapped]] = True
    removed_rows = ~used
    added_cells = added_rows[:rows_b * C].reshape(rows_b, C).mean(axis=1) > 0.5
    removed_cells = removed_rows[:rows_a * C].reshape(rows_a, C).mean(axis=1) > 0.5
    grid_after = changed | (_content(b) & added_cells[:, None] & ~noise_after)
    grid_before = _content(a) & removed_cells[:, None] & ~noise_before
    # A changed cell on the new page is also boxed where it was on the old page.
    rs, cs_ = np.nonzero(changed)
    if len(rs):
        old_rows = src[rs]
        keep = old_rows >= 0
        grid_before[np.minimum(old_rows[keep] // C, rows_a - 1), cs_[keep]] = True
    added_px = int(added_rows.sum())
    removed_px = int(removed_rows.sum())
    if ignore:
        old_ignored = ~_mask_rects(np.ones((rows_a, cols), dtype=bool),
                                   [[x - ox, y - oy, rw, rh] for x, y, rw, rh in ignore])
        new_ignored = np.zeros((rows_b, cols), dtype=bool)
        new_ignored[ok] = old_ignored[np.minimum(src[ok] // C, rows_a - 1)]
        grid_after &= ~new_ignored
        grid_before &= ~old_ignored
    boxes_after = regions(grid_after)
    boxes_before = regions(grid_before)
    # Row alignment lines up whole rows; content that moved on its own (one
    # column of a two-column page, or a fixed element left in place while
    # the page around it moved) is recognised here and left out.
    row_shifts = sorted({j1 - i1 for op, i1, i2, j1, j2 in ops if op == "equal"})
    moved = 0
    if boxes_after or boxes_before:
        boxes_after, boxes_before, moved = _drop_moves(a, b, boxes_after, boxes_before,
                                                       list(shifts) + [(0, d) for d in row_shifts])
    total = max(1, rows_b * cols)
    if area:
        boxes_after = [[x + ox, y + oy, bw, bh] for x, y, bw, bh in boxes_after]
        boxes_before = [[x + ox, y + oy, bw, bh] for x, y, bw, bh in boxes_before]
    return {
        "same": not boxes_after and not boxes_before,
        "after": boxes_after,
        "before": boxes_before,
        "added_px": added_px,
        "removed_px": removed_px,
        "changed_share": round(float(grid_after.sum()) / total, 5),
        "aligned": aligned,
        "noise_share": round(float(noise_after.sum()) / total, 5),
        "moved_areas": moved,
        "size_before": [int(a.shape[1]), int(a.shape[0])],
        "size_after": [int(b.shape[1]), int(b.shape[0])],
        "rows": RowMap(amap, oy, a.shape[0]),
    }


class RowMap:
    """Where each row of the new page was on the old page (page px), or None
    for a row the new page added."""

    def __init__(self, amap, offset=0, old_height=None):
        self._m, self._off = amap, offset
        self._old_h = int(old_height if old_height is not None else int(amap.max(initial=-1)) + 1)

    def old_y(self, y):
        i = int(y) - self._off
        if i < 0 or i >= len(self._m):
            return int(y)                  # outside the compared band: unmoved
        r = int(self._m[i])
        return None if r < 0 else r + self._off

    def old_span(self, y0, y1):
        """The old page's rows [top, bottom) shown by new rows y0..y1, or None
        when all of them were added by the new page."""
        lo, hi = max(0, int(y0) - self._off), min(len(self._m), int(y1) - self._off)
        if hi <= 0 or lo >= len(self._m):
            return int(y0), int(y1)        # outside the compared band: unmoved
        rows = self._m[lo:hi]
        rows = rows[rows >= 0]
        if not len(rows):
            return None
        return int(rows.min()) + self._off, int(rows.max()) + 1 + self._off

    def new_span(self, y0, y1):
        """The new page's rows [top, bottom) that show old rows y0..y1, or
        None when none do (that part of the old page was removed)."""
        lo, hi = int(y0) - self._off, int(y1) - self._off
        if hi <= 0 or lo >= self._old_h:
            return int(y0), int(y1)        # outside the compared band: unmoved
        hit = np.nonzero((self._m >= lo) & (self._m < hi))[0]
        if not len(hit):
            return None
        return int(hit[0]) + self._off, int(hit[-1]) + 1 + self._off


def _content(strip):
    """Cells in an added or removed strip that hold something (not flat background)."""
    rows, cols = strip.shape[0] // C, strip.shape[1] // C
    if rows == 0:
        return np.zeros((0, cols), dtype=bool)
    strip = luma(strip)
    cells = strip[:rows * C, :cols * C].reshape(rows, C, cols, C)
    spread = cells.max(axis=(1, 3)).astype(np.int16) - cells.min(axis=(1, 3)).astype(np.int16)
    # A flat cell (blank background) is not content, but a whole flat strip
    # that differs from the page background is (a new coloured band).
    bg = int(np.median(strip))
    tone = np.abs(cells.mean(axis=(1, 3)) - bg) > cfg.PIXEL_DELTA
    return (spread > cfg.PIXEL_DELTA) | tone


def _crop_area(a, b, noise_after, before_noise, area):
    x, y, w, h = [max(0, int(v)) for v in area]
    x, y = x // C * C, y // C * C
    w, h = -(-w // C) * C, -(-h // C) * C

    def cut(arr):
        part = arr[y:y + h, x:x + w]
        out = np.full((h, w, 3), 255, dtype=np.uint8)
        out[:part.shape[0], :part.shape[1]] = part
        return out

    def cut_grid(g):
        if g is None:
            return None
        part = g[y // C:(y + h) // C, x // C:(x + w) // C]
        out = np.zeros((h // C, w // C), dtype=bool)
        out[:part.shape[0], :part.shape[1]] = part
        return out
    return cut(a), cut(b), cut_grid(noise_after), cut_grid(before_noise)


# ── Pictures for people ──────────────────────────────────────────────────────
def _font(size):
    import os
    path = os.path.join(os.path.dirname(__file__), "fonts", "DejaVuSans-Bold.ttf")
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


RED = (220, 38, 38)
GREEN = (22, 163, 74)


def composite(before, after, result, *, focus=True, margin=160, max_height=1400, title_before="Before",
              title_after="After", rows=None):
    """Before and after side by side, changed areas boxed. PNG bytes.

    With `focus`, both are cropped to the vertical band holding the changes
    (plus `margin`), so a change in the footer of a long page is visible.
    `rows` (the comparison's RowMap) lines the two bands up: each side shows
    the same stretch of the page, so a removed paragraph on the left faces
    the place it closed up on the right, and both panels are equally tall.
    """
    A = Image.open(io.BytesIO(before)).convert("RGB")
    B = Image.open(io.BytesIO(after)).convert("RGB")
    boxes_a, boxes_b = result.get("before") or [], result.get("after") or []
    if focus:
        top_a, bot_a, top_b, bot_b = bands(boxes_a, boxes_b, A.height, B.height, rows=rows,
                                           margin=margin, max_height=max_height)
    else:
        top_a, bot_a, top_b, bot_b = 0, A.height, 0, B.height
    A, B = _boxed(A, boxes_a, RED), _boxed(B, boxes_b, RED)
    A = A.crop((0, top_a, A.width, max(top_a + 1, bot_a)))
    B = B.crop((0, top_b, B.width, max(top_b + 1, bot_b)))
    scale = cfg.COMPOSITE_WIDTH / max(A.width, B.width)
    A = A.resize((max(1, int(A.width * scale)), max(1, int(A.height * scale))), Image.LANCZOS)
    B = B.resize((max(1, int(B.width * scale)), max(1, int(B.height * scale))), Image.LANCZOS)
    pad, head = 28, 64
    W = A.width + B.width + pad * 3
    H = max(A.height, B.height) + head + pad
    out = Image.new("RGB", (W, H), (246, 247, 249))
    out.paste(A, (pad, head))
    out.paste(B, (A.width + pad * 2, head))
    d = ImageDraw.Draw(out)
    f = _font(22)
    d.text((pad, 22), title_before, fill=(32, 36, 44), font=f)
    d.text((A.width + pad * 2, 22), title_after, fill=(32, 36, 44), font=f)
    for x, y, w, h in ((pad - 1, head - 1, A.width + 2, A.height + 2),
                       (A.width + pad * 2 - 1, head - 1, B.width + 2, B.height + 2)):
        d.rectangle((x, y, x + w, y + h), outline=(214, 218, 225), width=1)
    buf = io.BytesIO()
    out.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def bands(boxes_a, boxes_b, height_a, height_b, *, rows=None, margin=160, max_height=1400):
    """(top_a, bot_a, top_b, bot_b): the stretch of each page the composite
    shows. Each covers its changed boxes plus `margin`; with `rows` each is
    widened to the other's stretch as it appears on its page; both are then
    made equally tall, within the page and `max_height`."""
    top_a, bot_a = _span(boxes_a, height_a, margin, max_height)
    top_b, bot_b = _span(boxes_b, height_b, margin, max_height)
    if boxes_b and not boxes_a:
        top_a, bot_a = top_b, min(height_a, bot_b)
    if boxes_a and not boxes_b:
        top_b, bot_b = top_a, min(height_b, bot_a)
    if rows is not None and boxes_a and boxes_b:
        old = rows.old_span(top_b, bot_b)
        new = rows.new_span(top_a, bot_a)
        if old:
            top_a, bot_a = min(top_a, old[0]), max(bot_a, old[1])
        if new:
            top_b, bot_b = min(top_b, new[0]), max(bot_b, new[1])
    tall = min(max(bot_a - top_a, bot_b - top_b), max_height)
    bot_a, bot_b = min(height_a, top_a + tall), min(height_b, top_b + tall)
    top_a, top_b = max(0, bot_a - tall), max(0, bot_b - tall)
    return top_a, bot_a, top_b, bot_b


def _span(boxes, height, margin, max_height):
    if not boxes:
        return 0, min(height, max_height)
    top = max(0, min(b[1] for b in boxes) - margin)
    bot = min(height, max(b[1] + b[3] for b in boxes) + margin)
    if bot - top > max_height:
        bot = top + max_height
    return top, bot


def _boxed(im, boxes, colour):
    im = im.copy()
    d = ImageDraw.Draw(im)
    for x, y, w, h in boxes:
        d.rectangle((x - 3, y - 3, x + w + 3, y + h + 3), outline=colour, width=4)
    return im


def crop_pair(before, after, box_before, box_after, pad=40):
    """Two crops (PNG bytes) around one changed area, for a closer look."""
    out = []
    for png, box in ((before, box_before), (after, box_after)):
        im = Image.open(io.BytesIO(png)).convert("RGB")
        if not box:
            out.append(None)
            continue
        x, y, w, h = box
        im = im.crop((max(0, x - pad), max(0, y - pad), min(im.width, x + w + pad), min(im.height, y + h + pad)))
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=True)
        out.append(buf.getvalue())
    return out


def thumbnail(png, width=480, height=300):
    """The top of a page, small, as WebP bytes (for cards)."""
    im = Image.open(io.BytesIO(png)).convert("RGB")
    crop_h = int(im.width * height / width)
    im = im.crop((0, 0, im.width, min(im.height, crop_h)))
    im = im.resize((width, max(1, int(im.height * width / im.width))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=78, method=4)
    return buf.getvalue()


def to_webp(png, *, lossless, quality=80):
    """A screenshot as WebP for storage.

    The copy the next check compares against must be lossless: lossy
    compression softens text edges by more than PIXEL_DELTA, and every word on
    the page would then count as changed. Older copies, kept only to be looked
    at, can be lossy (about a fifth of the size).
    """
    im = Image.open(io.BytesIO(png)).convert("RGB")
    buf = io.BytesIO()
    if lossless:
        im.save(buf, "WEBP", lossless=True, quality=60, method=4)
    else:
        im.save(buf, "WEBP", quality=quality, method=4)
    return buf.getvalue()


def to_png(data):
    """Stored image bytes (WebP or PNG) back to PNG for comparing."""
    im = Image.open(io.BytesIO(data)).convert("RGB")
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def pack_grid(grid):
    """A noise grid as a small dict for storage."""
    if grid is None:
        return None
    return {"shape": list(grid.shape), "bits": np.packbits(grid.astype(np.uint8)).tobytes().hex()}


def unpack_grid(packed):
    if not packed:
        return None
    shape = tuple(packed["shape"])
    bits = np.unpackbits(np.frombuffer(bytes.fromhex(packed["bits"]), dtype=np.uint8))
    return bits[:shape[0] * shape[1]].reshape(shape).astype(bool)
