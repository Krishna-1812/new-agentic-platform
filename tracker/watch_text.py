"""Page Watch: what changed in a page's words.

Two captures are compared block by block (a heading, a paragraph, a list
item, a button), not as one long string, so the answer reads the way a
person would say it: "these two lines were added, this price went from $20
to $25, this section was removed".

  key(text)       the text with volatile parts made neutral, for comparing:
                  invisible characters, spacing, and things that change on
                  every load without anything having changed ("3 minutes
                  ago", a session token in visible text). The original text
                  is what is stored and shown.
  diff(a, b)      blocks matched in order (difflib on the keys). A run of
                  replaced blocks is paired by word overlap: a pair close
                  enough is one block edited (with a word-level diff), the
                  rest were removed or added. A block that only moved is
                  reported as moved, not as removed-and-added.
  prices(...)     money amounts that changed, with the words around them.
"""

from __future__ import annotations

import difflib
import hashlib
import re
import unicodedata

from tracker import watch_config as cfg

_INVISIBLE = re.compile(r"[­​-‏  ‪-‮⁠-⁤﻿]")
_SPACE = re.compile(r"\s+")
# Things that differ between two loads of an unchanged page.
_VOLATILE = [
    (re.compile(r"\b(?:\d+|an?|one|few)\s+(?:sec(?:ond)?s?|min(?:ute)?s?|hours?|hrs?|days?|weeks?|months?|years?)\s+ago\b", re.I), "‹ago›"),
    (re.compile(r"\b(?:just now|moments? ago|seconds ago)\b", re.I), "‹ago›"),
    (re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:[ap]\.?m\.?)?\b", re.I), "‹time›"),
    (re.compile(r"\b(?=[A-Za-z0-9_-]{24,}\b)(?=[A-Za-z_-]*\d)(?=[0-9_-]*[A-Za-z])[A-Za-z0-9_-]+\b"), "‹token›"),
]
_WORD = re.compile(r"\S+")
PRICE = re.compile(r"(?:[$€£₹¥]|\b(?:USD|EUR|GBP|INR|Rs\.?)\s?)\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM]\b)?"
                   r"|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|INR)\b")


def clean(text):
    """Display form: normalised characters and single spaces."""
    text = unicodedata.normalize("NFKC", text or "")
    text = _INVISIBLE.sub("", text)
    return _SPACE.sub(" ", text).strip()


def key(text):
    """Comparison form: clean() with volatile parts made neutral."""
    out = clean(text)
    for pattern, repl in _VOLATILE:
        out = pattern.sub(repl, out)
    return out


def fingerprint(blocks):
    """One hash for a page's words, in order; equal when nothing in the text changed."""
    h = hashlib.sha256()
    for b in blocks:
        h.update(key(b["text"]).encode("utf-8"))
        h.update(b"\x1f")
    return h.hexdigest()


def similarity(a, b):
    """Word overlap between two texts, 0..1."""
    wa, wb = a.split(), b.split()
    if not wa and not wb:
        return 1.0
    return difflib.SequenceMatcher(None, wa, wb, autojunk=False).ratio()


# Under the same selector, two longer texts are one element edited when they
# share at least this much (BLOCK_MATCH_RATIO applies everywhere else).
SAME_SEL_RATIO = 0.25


def same_place(a, b):
    """1.0 when two blocks are the same element in the same spot (a short label
    whose words all changed, such as "$20" -> "$25"), else 0.0.

    A selector is a position among siblings, so content inserted before an
    element hands its selector to something else: the same selector alone
    pairs only short labels or texts that still share some words. A long
    text that took an old one's selector was removed and added, not edited.
    """
    ba, bb = a.get("box"), b.get("box")
    if not ba or not bb or a.get("tag") != b.get("tag"):
        return 0.0
    short = len(a.get("text", "").split()) <= 6 and len(b.get("text", "").split()) <= 6
    if a.get("sel") and a.get("sel") == b.get("sel"):
        if short or similarity(key(a.get("text", "")), key(b.get("text", ""))) >= SAME_SEL_RATIO:
            return 1.0
    ca = (ba[0] + ba[2] / 2, ba[1] + ba[3] / 2)
    cb = (bb[0] + bb[2] / 2, bb[1] + bb[3] / 2)
    near = abs(ca[0] - cb[0]) <= 40 and abs(ca[1] - cb[1]) <= 40
    return 1.0 if near and short else 0.0


def word_diff(before, after):
    """[("=", text) | ("-", text) | ("+", text)] at word level."""
    wa, wb = _WORD.findall(before), _WORD.findall(after)
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, wa, wb, autojunk=False).get_opcodes():
        if op == "equal":
            out.append(("=", " ".join(wa[i1:i2])))
        else:
            if i2 > i1:
                out.append(("-", " ".join(wa[i1:i2])))
            if j2 > j1:
                out.append(("+", " ".join(wb[j1:j2])))
    return out


def prices(text):
    return [m.group(0).strip() for m in PRICE.finditer(text or "")]


def _clip(text):
    return text if len(text) <= cfg.DIFF_BLOCK_CHARS else text[:cfg.DIFF_BLOCK_CHARS - 1] + "…"


def _item(block):
    return {"text": _clip(clean(block["text"])), "tag": block.get("tag", ""), "box": block.get("box"),
            "sel": block.get("sel", "")}


def diff(before, after):
    """Compare two block lists. Returns a dict (see the module docstring)."""
    ka = [key(b["text"]) for b in before]
    kb = [key(b["text"]) for b in after]
    added, removed, changed = [], [], []
    sm = difflib.SequenceMatcher(None, ka, kb, autojunk=False)
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            continue
        if op == "delete":
            removed += [before[i] for i in range(i1, i2)]
            continue
        if op == "insert":
            added += [after[j] for j in range(j1, j2)]
            continue
        # replace: pair blocks that are the same block edited, in order.
        left, right = list(range(i1, i2)), list(range(j1, j2))
        used = set()
        for i in left:
            best, best_j = 0.0, None
            for j in right:
                if j in used:
                    continue
                s = max(similarity(ka[i], kb[j]), same_place(before[i], after[j]))
                if s > best:
                    best, best_j = s, j
            if best_j is not None and best >= cfg.BLOCK_MATCH_RATIO:
                used.add(best_j)
                changed.append((before[i], after[best_j]))
            else:
                removed.append(before[i])
        added += [after[j] for j in right if j not in used]

    # A block that was removed in one place and added in another only moved.
    moved = []
    added_keys = {}
    for idx, b in enumerate(added):
        added_keys.setdefault(key(b["text"]), []).append(idx)
    keep_removed, drop_added = [], set()
    for b in removed:
        hits = [i for i in added_keys.get(key(b["text"]), []) if i not in drop_added]
        if hits:
            drop_added.add(hits[0])
            moved.append({"text": _clip(clean(b["text"])), "tag": b.get("tag", ""),
                          "box_before": b.get("box"), "box": added[hits[0]].get("box")})
        else:
            keep_removed.append(b)
    added = [b for i, b in enumerate(added) if i not in drop_added]
    removed = keep_removed

    changed_out, price_changes = [], []
    for a, b in changed:
        ta, tb = clean(a["text"]), clean(b["text"])
        changed_out.append({"before": _clip(ta), "after": _clip(tb), "tag": b.get("tag", ""),
                            "box_before": a.get("box"), "box": b.get("box"), "sel": b.get("sel", ""),
                            "segments": word_diff(_clip(ta), _clip(tb))})
        pa, pb = prices(ta), prices(tb)
        if pa != pb:
            price_changes.append({"before": pa, "after": pb, "context": _clip(tb), "box": b.get("box")})
    for b in added:
        if prices(b["text"]):
            price_changes.append({"before": [], "after": prices(b["text"]), "context": _clip(clean(b["text"])),
                                  "box": b.get("box")})
    for b in removed:
        if prices(b["text"]):
            price_changes.append({"before": prices(b["text"]), "after": [], "context": _clip(clean(b["text"])),
                                  "box": b.get("box_before") or b.get("box")})

    words_added = sum(len(b["text"].split()) for b in added) + sum(
        len(t.split()) for c in changed_out for op, t in c["segments"] if op == "+")
    words_removed = sum(len(b["text"].split()) for b in removed) + sum(
        len(t.split()) for c in changed_out for op, t in c["segments"] if op == "-")
    return {
        "same": not (added or removed or changed_out),
        "added": [_item(b) for b in added],
        "removed": [_item(b) for b in removed],
        "changed": changed_out,
        "moved": moved,
        "prices": price_changes,
        "words_added": words_added,
        "words_removed": words_removed,
        "blocks_before": len(before),
        "blocks_after": len(after),
    }


def inside(box, area):
    """True when a block's centre is inside `area` ([x, y, w, h])."""
    if not box or not area:
        return False
    cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
    return area[0] <= cx <= area[0] + area[2] and area[1] <= cy <= area[1] + area[3]


def select(blocks, area=None, ignore=(), skip_sels=()):
    """The blocks to compare: those in the watched area, minus ignored areas and
    the elements learned to change on every visit (`skip_sels`)."""
    skip = set(skip_sels or ())
    out = []
    for b in blocks:
        if area and b.get("box") and not inside(b["box"], area):
            continue
        if b.get("box") and any(inside(b["box"], r) for r in ignore):
            continue
        if skip and b.get("sel") in skip:
            continue
        out.append(b)
    return out
