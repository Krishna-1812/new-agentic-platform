#!/usr/bin/env python3
"""Page Watch accuracy harness: false alarms and detection on real pages.

For each page:
  1. read it once for the baseline and twice to calibrate (what differs
     between those readings is learned as noise, as the engine does), then
     once more with nothing changed: the comparison must say "same" (a
     difference here is a false alarm, counted for text and visuals);
  2. read it with three edits made in the browser (a number in a price or
     figure changed, a button recoloured, a paragraph removed): each edit
     must be found, and nothing else;
  3. read it with two more edits (a banner inserted at the top, which pushes
     the whole page down, and one word changed in a heading): both must be
     found, and the push must not make the rest of the page count as changed.

    python tools/watch_accuracy.py                 # the default page list
    python tools/watch_accuracy.py URL [URL ...]   # chosen pages
    python tools/watch_accuracy.py --out results.json

Needs a browser (Playwright's Chromium, or WATCH_CHROMIUM_PATH).
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import watch_capture, watch_detect, watch_visual  # noqa: E402

PAGES = [
    "https://vercel.com/pricing", "https://stripe.com/pricing", "https://www.notion.com/pricing",
    "https://ahrefs.com/pricing", "https://www.hubspot.com/pricing/marketing", "https://www.zendesk.com/pricing/",
    "https://www.figma.com/pricing/", "https://www.zoominfo.com/pricing", "https://www.shopify.com/pricing",
    "https://www.demandbase.com/", "https://www.cloudflare.com/", "https://www.intercom.com/customers",
    "https://jobs.lever.co/spotify", "https://docs.python.org/3/library/asyncio.html", "https://react.dev/",
    "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
    "https://www.hubspot.com/company-news", "https://www.apple.com/iphone/",
]

# Each edit records what it touched (text and box) so the result can be scored.
EDITS_A = r"""
(() => {
  const out = {};
  const box = el => { const r = el.getBoundingClientRect(); return [r.left + scrollX, r.top + scrollY, r.width, r.height]; };
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.1; };
  // 1. A figure: the first visible text node with a digit, one digit changed.
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) {
    const t = n.nodeValue; const el = n.parentElement;
    if (!el || !/\d/.test(t) || t.trim().length > 60 || !vis(el)) continue;
    const r = el.getBoundingClientRect(); if (r.top + scrollY < 120 || r.top + scrollY > 3000) continue;
    const i = t.search(/\d/); const d = t[i] === '7' ? '3' : '7';
    n.nodeValue = t.slice(0, i) + d + t.slice(i + 1);
    out.figure = {before: t.trim(), after: n.nodeValue.trim(), box: box(el)}; break;
  }
  // 2. A button or link in the first screen, recoloured.
  const clicks = [...document.querySelectorAll('a, button')].filter(e => {
    const r = e.getBoundingClientRect(); const t = (e.innerText || '').trim();
    return vis(e) && r.top > 0 && r.bottom < innerHeight && r.width > 50 && r.height > 20 && t.length > 1 && t.length < 30;
  });
  const b = clicks[Math.floor(clicks.length / 2)];
  if (b) { b.style.setProperty('background', '#2563eb', 'important'); b.style.setProperty('color', '#ffffff', 'important');
           out.button = {text: b.innerText.trim(), box: box(b)}; }
  // 3. A paragraph lower down, removed.
  const paras = [...document.querySelectorAll('p, li')].filter(p => vis(p) && (p.innerText || '').split(/\s+/).length >= 8
    && p.getBoundingClientRect().top + scrollY > 900 && p.getBoundingClientRect().top + scrollY < 6000);
  const p = paras[Math.floor(paras.length / 2)];
  if (p) { out.removed = {text: p.innerText.trim().slice(0, 200), box: box(p)}; p.remove(); }
  return out;
})()
"""

EDITS_B = r"""
(() => {
  const out = {};
  const box = el => { const r = el.getBoundingClientRect(); return [r.left + scrollX, r.top + scrollY, r.width, r.height]; };
  const banner = document.createElement('div');
  banner.textContent = 'Announcement: our plans change on November 1. Read what is new for your account.';
  banner.setAttribute('style', 'display:block;padding:22px 24px;background:#111827;color:#ffffff;font:600 18px/1.4 Arial,sans-serif;text-align:center;position:relative;z-index:1');
  document.body.insertBefore(banner, document.body.firstChild);
  out.banner = {text: banner.textContent, box: box(banner)};
  const hs = [...document.querySelectorAll('h1, h2')].filter(h => { const r = h.getBoundingClientRect();
    return r.width > 10 && (h.innerText || '').trim().split(/\s+/).length >= 2 && r.top + scrollY < 4000; });
  const h = hs[0];
  if (h) {
    const tw = document.createTreeWalker(h, NodeFilter.SHOW_TEXT); let n;
    while ((n = tw.nextNode())) { if (/[A-Za-z]{3,}/.test(n.nodeValue)) {
      const before = h.innerText.trim(); n.nodeValue = n.nodeValue.replace(/[A-Za-z]{3,}/, 'Remarkable');
      out.heading = {before, after: h.innerText.trim(), box: box(h)}; break; } }
  }
  return out;
})()
"""


def _flat(text):
    return " ".join((text or "").replace("\xa0", " ").split())


def _first(text, n=40):
    """The first line of a text, flattened: how it appears in one block."""
    line = next((ln for ln in (text or "").splitlines() if ln.strip()), "")
    return _flat(line)[:n]


def _pixels_changed(before, after, box):
    """True when the screenshots differ inside `box` (no alignment: the
    button edit is above the removed paragraph, so nothing has moved there)."""
    if not before or not after or not box:
        return True
    import numpy as np
    a, b = watch_visual.load(before), watch_visual.load(after)
    x, y, w, h = [max(0, int(v)) for v in box]
    pa, pb = a[y:y + h, x:x + w], b[y:y + h, x:x + w]
    if pa.size == 0 or pa.shape != pb.shape:
        return True
    return bool((np.abs(pa.astype(np.int16) - pb.astype(np.int16)) > 32).any())


def _overlaps(a, b, slack=12):
    if not a or not b:
        return False
    return not (a[0] + a[2] + slack < b[0] or b[0] + b[2] + slack < a[0] or
                a[1] + a[3] + slack < b[1] or b[1] + b[3] + slack < a[1])


def run_page(url):
    res = {"url": url}
    t0 = time.time()
    a = watch_capture.capture(url)
    if not a.ok:
        res["skipped"] = a.error or "bot_check"
        res["detail"] = a.error_detail
        return res
    prev = watch_detect.snapshot_from(a, watch_visual.pack_grid(watch_visual.noise_cells(a.screenshot, a.control)))
    # Calibration, as the engine does it for a new watch: two more readings,
    # and whatever differs between them is learned as noise.
    learned = {}
    for _ in range(2):
        c = watch_capture.capture(url)
        if c.ok:
            rep, _ = watch_detect.compare(prev, c, {"learned": learned})
            learned = watch_detect.learn(rep, learned)
    res["learned"] = {"rects": len(learned.get("rects", [])), "sels": len(learned.get("sels", []))}
    settings = {"learned": learned}
    b = watch_capture.capture(url)
    r, _ = watch_detect.compare(prev, b, settings)
    res["same"] = {
        "outcome": r["outcome"], "headline": r["headline"],
        "text_false": 0 if r["text"]["same"] else len(r["text"]["added"]) + len(r["text"]["removed"]) + len(r["text"]["changed"]),
        "visual_false": len(r["visual"]["after"]) if r["visual"] else None,
        "text_detail": None if r["text"]["same"] else {k: r["text"][k][:3] for k in ("added", "removed", "changed")},
        "visual_boxes": r["visual"]["after"][:5] if r["visual"] else None,
        "noise_share": r["visual"]["noise_share"] if r["visual"] else None,
    }
    res["edits_a"] = _score_edits(url, prev, EDITS_A, ("figure", "button", "removed"), settings)
    res["edits_b"] = _score_edits(url, prev, EDITS_B, ("banner", "heading"), settings)
    res["secs"] = round(time.time() - t0, 1)
    return res


def _score_edits(url, prev, script, kinds, settings=None):
    cap = watch_capture.capture(url, mutate=script)
    if not cap.ok:
        return {"skipped": cap.error or "bot_check", "detail": cap.error_detail}
    did = cap.mutation or {}
    r, _ = watch_detect.compare(prev, cap, settings)
    t, v = r["text"], r["visual"] or {"after": [], "before": []}
    added = " ".join(x["text"] for x in t["added"])
    removed = " ".join(x["text"] for x in t["removed"])
    ch_after = " ".join(c["after"] for c in t["changed"])
    ch_before = " ".join(c["before"] for c in t["changed"])
    found, expected_boxes, undone = {}, [], []
    page_text = _flat("\n".join(b["text"] for b in cap.blocks))
    base_text = _flat("\n".join(b["text"] for b in prev["blocks"]))
    for kind in kinds:
        e = did.get(kind)
        if not e:
            found[kind] = None            # the page had nothing to edit this way
            continue
        # Some sites re-render after load and replace the edited element; an
        # edit no longer in the page that was read is not the engine's miss.
        still = {"figure": _flat(e.get("after", ""))[:40] in page_text,
                 "removed": _first(e.get("text", "")) not in page_text,
                 "banner": "Announcement: our plans change" in page_text,
                 "heading": "Remarkable" in page_text}.get(kind, True)
        # An edit nobody could see is not one the engine can miss: a removed
        # paragraph that was never visible (a closed accordion), or a
        # recoloured link that is off screen or hidden in a closed menu.
        visible = True
        if kind == "removed":
            visible = _first(e.get("text", "")) in base_text
        elif kind == "button":
            visible = _pixels_changed(prev.get("screenshot"), cap.screenshot, e["box"])
        if not still or not visible:
            found[kind] = None
            undone.append(kind if not still else kind + " (not visible)")
            continue
        expected_boxes.append(e["box"])
        if kind == "figure":
            found[kind] = e["after"][:40] in ch_after or e["after"][:40] in added
        elif kind == "button":
            found[kind] = any(_overlaps(b, e["box"]) for b in v["after"])
        elif kind == "removed":
            head = _first(e["text"])
            found[kind] = head in _flat(removed) or head in _flat(ch_before)
        elif kind == "banner":
            # Found when its text was added; a banner under a fixed header
            # cannot also be seen, so the picture is not required.
            found[kind] = "Announcement: our plans change" in added
        elif kind == "heading":
            found[kind] = "Remarkable" in ch_after or "Remarkable" in added
    # Areas that match none of the edits are false alarms caused by the edits
    # (the push from the banner, mostly).
    stray = [b for b in v["after"] if not any(_overlaps(b, x, slack=60) for x in expected_boxes)]
    return {"did": {k: (x.get("after") or x.get("text") or "")[:60] for k, x in did.items()}, "undone_by_site": undone,
            "found": found, "stray_areas": len(stray), "stray": stray[:5], "headline": r["headline"],
            "areas": [{"box": a["box"], "label": a["label"]} for a in r["areas"]][:8],
            "text_counts": {k: len(t[k]) for k in ("added", "removed", "changed", "moved")}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("urls", nargs="*")
    ap.add_argument("--out", default="watch_accuracy.json")
    args = ap.parse_args()
    urls = args.urls or PAGES
    results = []
    for url in urls:
        try:
            res = run_page(url)
        except Exception as exc:
            res = {"url": url, "crashed": "%s: %s" % (type(exc).__name__, str(exc)[:300])}
        results.append(res)
        print(json.dumps(res)[:600], flush=True)
        with open(args.out, "w") as fh:
            json.dump(results, fh, indent=1)
    print(summary(results))


def summary(results):
    done = [r for r in results if "same" in r]
    lines = ["pages read: %d of %d" % (len(done), len(results))]
    fa_text = sum(1 for r in done if r["same"]["text_false"])
    fa_vis = sum(1 for r in done if r["same"]["visual_false"])
    lines.append("false alarms (nothing changed): text on %d, visual on %d, of %d pages" % (fa_text, fa_vis, len(done)))
    tally = {}
    stray = 0
    for r in done:
        for part in ("edits_a", "edits_b"):
            rec = r.get(part) or {}
            stray += rec.get("stray_areas") or 0
            for k, val in (rec.get("found") or {}).items():
                if val is not None:
                    tally.setdefault(k, []).append(bool(val))
    for k, vals in tally.items():
        lines.append("  %-9s found on %d of %d pages" % (k, sum(vals), len(vals)))
    lines.append("  stray areas flagged next to the edits: %d" % stray)
    return "\n".join(lines)


if __name__ == "__main__":
    main()
