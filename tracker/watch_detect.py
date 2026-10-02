"""Page Watch: deciding whether a page changed, and saying what changed.

compare(previous, current, settings) puts the text and visual comparisons
together into one report:

  outcome     "same" | "changed"
  text        watch_text.diff over the watched area, minus ignored areas
  visual      watch_visual.compare, or None when either side has no screenshot
  facts       the page's title, final address and status, when they changed
  areas       each changed area on the new page, named by the text under it
              ("the button “Sign Up”"), so a visual-only change can be said
  level       "minor" | "major" by rule (Claude's judgement replaces it in
              Phase 3, and this stays as the fallback when Claude is off)
  headline    one plain sentence from the evidence

`previous` is a snapshot dict (see snapshot_from); `current` a Capture.
"""

from __future__ import annotations

from tracker import watch_config as cfg
from tracker import watch_text, watch_visual

DEFAULTS = {"area": None, "ignore": [], "text": True, "visual": True, "learned": None}
# A learned area is padded by this much, so the same element drawn a few
# pixels away on the next visit is still covered.
LEARN_PAD = 8
_TAG_NAMES = {"button": "button", "a": "link", "h1": "heading", "h2": "heading", "h3": "heading",
              "h4": "heading", "li": "list item", "td": "table cell", "th": "table heading",
              "label": "label", "p": "text", "img": "image"}


def snapshot_from(cap, noise=None):
    """What is kept of a successful capture to compare the next one against."""
    return {
        "url": cap.url, "final_url": cap.final_url, "status": cap.status, "title": cap.title,
        "engine": cap.engine, "blocks": cap.blocks, "area_box": cap.area_box,
        "page_height": cap.page_height, "width": cap.width, "height": cap.height,
        "fingerprint": watch_text.fingerprint(cap.blocks),
        "screenshot": cap.screenshot, "noise": noise,
    }


def compare(previous, current, settings=None):
    s = dict(DEFAULTS, **(settings or {}))
    area_prev = previous.get("area_box") if s["area"] else None
    area_now = current.area_box if s["area"] else None
    learned = s.get("learned") or {}
    ignore = list(s.get("ignore") or []) + list(learned.get("rects") or [])
    skip = learned.get("sels") or []

    # Ignored areas are drawn on the old page. The old page's blocks are
    # tested against them as they are; the new page's are first mapped back
    # to where they were (see watch_visual.compare), which needs the visual
    # alignment, so the visual comparison runs first.
    blocks_prev = watch_text.select(previous.get("blocks") or [], area_prev, ignore, skip)
    unfiltered_now = watch_text.select(current.blocks, area_now, (), skip)

    visual = None
    noise_now = None
    rows = None
    if s["visual"] and previous.get("screenshot") and current.screenshot:
        if current.control:
            noise_now = watch_visual.noise_cells(current.screenshot, current.control)
        visual = watch_visual.compare(
            previous["screenshot"], current.screenshot, after_control=current.control,
            before_noise=watch_visual.unpack_grid(previous.get("noise")) if isinstance(
                previous.get("noise"), dict) else previous.get("noise"),
            ignore=ignore, area=area_now or area_prev, shifts=shifts(blocks_prev, unfiltered_now))
        rows = visual.pop("rows", None)
    blocks_now = [b for b in unfiltered_now if not _ignored_now(b, ignore, rows)]
    text = watch_text.diff(blocks_prev, blocks_now) if s["text"] else None

    facts = {}
    if (previous.get("title") or "") != (current.title or "") and not s["area"]:
        facts["title"] = [previous.get("title") or "", current.title or ""]
    if _host_path(previous.get("final_url")) != _host_path(current.final_url) and current.final_url:
        facts["final_url"] = [previous.get("final_url") or "", current.final_url]
    if (previous.get("status") or 200) != (current.status or 200):
        facts["status"] = [previous.get("status"), current.status]
    area_lost = bool(s["area"]) and current.area_found is False

    text_changed = bool(text) and not text["same"]
    visual_changed = bool(visual) and not visual["same"]
    changed = text_changed or visual_changed or bool(facts) or area_lost
    areas = name_areas(visual["after"] if visual else [], blocks_now, text) if visual_changed else []
    report = {
        "outcome": "changed" if changed else "same",
        "text": text, "visual": visual, "facts": facts, "areas": areas, "area_lost": area_lost,
        "fingerprint": watch_text.fingerprint(blocks_now),
        "_rows": rows,                    # for carry(); never stored
    }
    report["level"], report["reasons"] = level(report)
    report["headline"] = headline(report)
    return report, watch_visual.pack_grid(noise_now)


def carry(rects, report, keep_removed=False):
    """Move rects drawn on the old page to where that content is on the new
    one, when the new reading becomes the baseline. A rect whose content was
    removed is dropped, or kept where it was with `keep_removed` (an area
    the user drew stays theirs to edit)."""
    rows = (report or {}).get("_rows")
    if rows is None:
        return [list(r) for r in rects or []]
    out = []
    for x, y, w, h in rects or []:
        span = rows.new_span(y, y + h)
        if span is None:
            if keep_removed:
                out.append([x, y, w, h])
            continue
        out.append([x, span[0], w, span[1] - span[0]])
    return out


def _ignored_now(block, ignore, rows):
    """Is a block of the NEW page inside an ignored area of the OLD page?"""
    box = block.get("box")
    if not ignore or not box:
        return False
    if rows is not None:
        old = rows.old_y(box[1] + box[3] / 2)
        if old is None:                   # on rows the new page added
            return False
        box = [box[0], old - box[3] / 2, box[2], box[3]]
    return any(watch_text.inside(box, r) for r in ignore)


def shifts(before, after, most=16):
    """How unchanged text blocks moved between two readings: [(dx, dy)], commonest first.

    Only blocks whose text appears exactly once on each side are used, so a
    repeated label ("Learn more") cannot suggest a false move.
    """
    from collections import Counter
    def unique(blocks):
        seen = Counter(watch_text.key(b["text"]) for b in blocks if b.get("box"))
        return {watch_text.key(b["text"]): b["box"] for b in blocks if b.get("box")
                and seen[watch_text.key(b["text"])] == 1}
    ua, ub = unique(before), unique(after)
    moves = Counter()
    for k, box in ub.items():
        old = ua.get(k)
        if old:
            moves[(int(round(box[0] - old[0])), int(round(box[1] - old[1])))] += 1
    return [m for m, _ in moves.most_common(most)]


def _host_path(url):
    from urllib.parse import urlsplit
    p = urlsplit(url or "")
    return ((p.hostname or "").lower().removeprefix("www."), p.path.rstrip("/"))


def _overlap(a, b):
    if not a or not b:
        return 0
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
    return max(0, x2 - x1) * max(0, y2 - y1)


def _label(block):
    words = watch_text.clean(block["text"])
    words = words if len(words) <= 60 else words[:57] + "…"
    return "the %s “%s”" % (_TAG_NAMES.get(block.get("tag"), "text"), words)


def name_areas(boxes, blocks, text, most=2):
    """Each changed area with the text blocks that best name it.

    Nearby changes are joined into one area, so an area can hold more than
    one changed element: up to `most` are named, edited text and buttons,
    links and headings first, then the largest overlap.
    """
    changed_sel = {c.get("sel") for c in (text or {}).get("changed", []) if c.get("sel")}
    changed_sel |= {a.get("sel") for a in (text or {}).get("added", []) if a.get("sel")}
    out = []
    for box in boxes:
        ranked = []
        for b in blocks:
            ov = _overlap(box, b.get("box"))
            if not ov:
                continue
            area = max(1, b["box"][2] * b["box"][3])
            rank = (b.get("sel") in changed_sel, b.get("tag") in ("button", "a", "h1", "h2", "h3"), ov / area, ov)
            ranked.append((rank, b))
        ranked.sort(key=lambda x: x[0], reverse=True)
        picked, seen = [], set()
        for rank, b in ranked:
            # Only blocks mostly inside the area name it (a big container
            # touching its edge does not).
            if rank[2] < 0.5 or b["text"] in seen:
                continue
            seen.add(b["text"])
            picked.append(b)
            if len(picked) == most:
                break
        labels = [_label(b) for b in picked]
        out.append({"box": box, "label": " and ".join(labels) if labels else None, "labels": labels,
                    "tag": picked[0].get("tag") if picked else None})
    return out


def level(report):
    """("major" | "minor", [reasons]) by rule."""
    reasons = []
    t, v, f = report.get("text") or {}, report.get("visual") or {}, report.get("facts") or {}
    if t.get("prices"):
        reasons.append("price")
    if f.get("status"):
        reasons.append("status")
    if f.get("final_url"):
        reasons.append("redirect")
    if f.get("title"):
        reasons.append("title")
    if report.get("area_lost"):
        reasons.append("area_lost")
    words = (t.get("words_added") or 0) + (t.get("words_removed") or 0)
    if words >= 15:
        reasons.append("text")
    if (v.get("changed_share") or 0) >= 0.05 or (v.get("added_px") or 0) + (v.get("removed_px") or 0) >= 300:
        reasons.append("visual")
    if reasons:
        return "major", reasons
    if words or (v.get("changed_share") or 0) >= cfg.MINOR_VISUAL_SHARE or any(
            a.get("label") for a in report.get("areas") or []):
        return "minor", ["small"]
    return "minor", ["tiny"]


def _plural(n, one, many):
    return "%d %s" % (n, one if n == 1 else many)


def headline(report):
    """One plain sentence from the evidence, without a model."""
    if report["outcome"] == "same":
        return "No change."
    t, f = report.get("text") or {}, report.get("facts") or {}
    if f.get("status"):
        return "The page now answers HTTP %s (was %s)." % (f["status"][1], f["status"][0] or 200)
    if report.get("area_lost"):
        return "The watched area is no longer on the page."
    if f.get("final_url"):
        return "The page now redirects to %s." % f["final_url"][1]
    for p in t.get("prices") or []:
        if p["before"] and p["after"]:
            return "Price changed: %s → %s." % (", ".join(p["before"]), ", ".join(p["after"]))
        if p["after"]:
            return "New price shown: %s." % ", ".join(p["after"])
        return "Price removed: %s." % ", ".join(p["before"])
    bits = []
    if t.get("changed"):
        bits.append(_plural(len(t["changed"]), "line edited", "lines edited"))
    if t.get("added"):
        bits.append(_plural(len(t["added"]), "line added", "lines added"))
    if t.get("removed"):
        bits.append(_plural(len(t["removed"]), "line removed", "lines removed"))
    if bits:
        lead = ""
        first = (t.get("changed") or [None])[0]
        if first and len(t["changed"]) == 1 and not t.get("added") and not t.get("removed"):
            lead = "“%s” → “%s”. " % (_short(first["before"]), _short(first["after"]))
        return (lead + ", ".join(bits).capitalize() + ".").strip()
    if f.get("title"):
        return "The page title changed to “%s”." % _short(f["title"][1])
    named = [a["label"] for a in report.get("areas") or [] if a.get("label")]
    if named:
        more = len(report["areas"]) - 1
        return "Looks different around %s%s." % (named[0], " and %s" % _plural(more, "other area", "other areas")
                                                 if more else "")
    n = len(report.get("areas") or [])
    return "The page looks different in %s." % _plural(max(1, n), "area", "areas")


def _short(text, n=70):
    text = watch_text.clean(text)
    return text if len(text) <= n else text[:n - 1] + "…"


def learn(report, known=None):
    """What a comparison of two readings of an unchanged page teaches.

    Called on calibration readings (the page read again straight after its
    baseline): whatever differs there differs on every visit (a rotating
    testimonial, a randomly chosen button colour, an A/B test), so its areas
    and its elements are left out of every later comparison.
    Returns the merged {"rects": [...], "sels": [...]}.
    """
    known = known or {}
    rects = [list(r) for r in known.get("rects") or []]
    sels = list(known.get("sels") or [])
    v = report.get("visual") or {}
    for x, y, w, h in v.get("after") or []:
        r = [max(0, x - LEARN_PAD), max(0, y - LEARN_PAD), w + 2 * LEARN_PAD, h + 2 * LEARN_PAD]
        if r not in rects:
            rects.append(r)
    t = report.get("text") or {}
    for item in (t.get("changed") or []) + (t.get("added") or []) + (t.get("removed") or []):
        sel = item.get("sel")
        if sel and sel not in sels:
            sels.append(sel)
    return {"rects": rects, "sels": sels}
