"""Video Studio: the bundled fonts, and mapping a brand's fonts onto them.

The render browser has no network, so a video can only use the fonts in
tracker/video_kit/fonts (listed in fonts.json, fetched by
scripts/fetch_video_fonts.py; all SIL Open Font License). A brand font that
is bundled is used as it is. Any other is swapped for the nearest bundled
one: a known look-alike first (Helvetica -> Inter), then one of the same kind
(serif, sans, mono), and the swap is reported so the plan can say so.
"""

from __future__ import annotations

import functools
import json
import os
import re

from tracker import video_config as cfg

DEFAULT_SANS = "Inter"
DEFAULT_SERIF = "Fraunces"
DEFAULT_MONO = "JetBrains Mono"

# Fonts people often have that are not bundled, and the bundled font closest
# to each in shape and width.
LOOKALIKES = {
    "helvetica": "Inter", "helvetica neue": "Inter", "arial": "Inter", "sf pro": "Inter",
    "sf pro display": "Inter", "sf pro text": "Inter", "-apple-system": "Inter", "system-ui": "Inter",
    "blinkmacsystemfont": "Inter", "segoe ui": "Open Sans", "graphik": "Inter", "circular": "DM Sans",
    "circular std": "DM Sans", "gt walsheim": "DM Sans", "proxima nova": "Montserrat", "gotham": "Montserrat",
    "avenir": "Nunito", "avenir next": "Nunito", "futura": "Poppins", "gilroy": "Plus Jakarta Sans",
    "sofia pro": "Plus Jakarta Sans", "aeonik": "Manrope", "suisse intl": "Inter", "neue haas grotesk": "Inter",
    "basier circle": "DM Sans", "apercu": "Work Sans", "brandon grotesque": "Raleway", "calibri": "Source Sans 3",
    "verdana": "Open Sans", "tahoma": "Open Sans", "trebuchet ms": "Source Sans 3", "noto sans": "Open Sans",
    "source sans pro": "Source Sans 3", "ibm plex": "IBM Plex Sans", "geist": "Inter", "satoshi": "Manrope",
    "general sans": "Manrope", "space mono": "JetBrains Mono", "times": "Lora", "times new roman": "Lora",
    "georgia": "Merriweather", "garamond": "Lora", "eb garamond": "Lora", "cormorant": "Playfair Display",
    "cormorant garamond": "Playfair Display", "libre baskerville": "Merriweather", "baskerville": "Merriweather",
    "tiempos": "Lora", "tiempos headline": "Playfair Display", "canela": "Fraunces", "recoleta": "Fraunces",
    "gt sectra": "Fraunces", "freight": "Lora", "noto serif": "Merriweather", "dm serif": "DM Serif Display",
    "courier": "JetBrains Mono", "courier new": "JetBrains Mono", "menlo": "JetBrains Mono",
    "monaco": "JetBrains Mono", "consolas": "JetBrains Mono", "sf mono": "JetBrains Mono",
    "fira code": "JetBrains Mono", "roboto mono": "JetBrains Mono", "ui-monospace": "JetBrains Mono",
}
GENERIC = {"serif": DEFAULT_SERIF, "sans-serif": DEFAULT_SANS, "monospace": DEFAULT_MONO, "ui-serif": DEFAULT_SERIF,
           "ui-sans-serif": DEFAULT_SANS, "cursive": DEFAULT_SERIF, "fantasy": DEFAULT_SANS}
_SERIF_HINT = re.compile(r"serif|garamond|baskerville|times|georgia|playfair|slab|didot|bodoni|caslon|"
                         r"tiempos|freight|canela|recoleta|merriweather|lora|cormorant", re.I)
_MONO_HINT = re.compile(r"mono|code|courier|consol", re.I)


@functools.lru_cache(maxsize=1)
def manifest():
    with open(os.path.join(cfg.kit_dir(), "fonts.json")) as fh:
        return {f["family"]: f for f in json.load(fh)["families"]}


def families():
    return sorted(manifest())


def category(family):
    f = manifest().get(family)
    return f["category"] if f else None


def _clean(name):
    return re.sub(r"\s+", " ", str(name or "").strip().strip("'\"")).strip()


def _key(name):
    return _clean(name).lower()


_WEIGHT = re.compile(r"(?:[-_ ]?(?:thin|extralight|light|regular|book|medium|semibold|demibold|bold|extrabold|"
                     r"black|heavy|italic|oblique|variable|var|vf|web|webfont|pro|std))+$", re.I)


def _squash(name):
    """"SourceSansProBold" and "Source Sans 3" both -> "sourcesans"."""
    k = re.sub(r"[^a-z0-9]", "", _WEIGHT.sub("", _clean(name)).lower())
    return re.sub(r"\d+$", "", k)


def resolve(stack, role="body"):
    """{"family", "asked", "swapped"} for a CSS font-family stack or a name.

    role "heading" prefers a serif when nothing in the stack can be placed,
    "body" a sans-serif."""
    names = [_clean(n) for n in str(stack or "").split(",") if _clean(n)]
    by_key = {k.lower(): k for k in manifest()}
    asked = names[0] if names else ""
    for n in names:
        if n.lower() in by_key:
            fam = by_key[n.lower()]
            return {"family": fam, "asked": asked, "swapped": n.lower() != asked.lower()}
    squashed = {_squash(k): k for k in manifest()}
    for n in names:
        if _squash(n) in squashed:
            fam = squashed[_squash(n)]
            return {"family": fam, "asked": asked,
                    "swapped": n != asked or _WEIGHT.sub("", _clean(n)).strip().lower() != fam.lower()}
    for n in names:
        k = n.lower()
        if k in LOOKALIKES:
            return {"family": LOOKALIKES[k], "asked": asked, "swapped": True}
        for known, fam in LOOKALIKES.items():
            if len(known) > 4 and k.startswith(known):
                return {"family": fam, "asked": asked, "swapped": True}
    for n in names:
        k = n.lower()
        if k in GENERIC:
            return {"family": GENERIC[k], "asked": asked, "swapped": bool(asked) and asked.lower() not in GENERIC}
    if asked and _MONO_HINT.search(asked):
        return {"family": DEFAULT_MONO, "asked": asked, "swapped": True}
    if asked and _SERIF_HINT.search(asked):
        return {"family": DEFAULT_SERIF, "asked": asked, "swapped": True}
    fallback = DEFAULT_SERIF if role == "heading" and not asked else DEFAULT_SANS
    return {"family": fallback, "asked": asked, "swapped": bool(asked)}


def has_italic(family):
    """Whether a bundled family has an italic face (for emphasised words)."""
    f = manifest().get(family)
    return bool(f) and any(face["style"] == "italic" for face in f["faces"])


def font_css(fams, prefix="kit/"):
    """@font-face rules for the given bundled families (others are skipped)."""
    out = []
    for fam in dict.fromkeys(fams):
        f = manifest().get(fam)
        if not f:
            continue
        for face in f["faces"]:
            out.append('@font-face { font-family: "%s"; font-style: %s; font-weight: %s; font-display: block; '
                       'src: url("%s%s") format("woff2"); unicode-range: %s; }'
                       % (fam, face["style"], face["weight"], prefix, face["file"], face["unicode_range"]))
    return "\n".join(out)


def stack(family):
    """A CSS font-family value for a bundled family, with a generic fallback."""
    generic = {"serif": "serif", "mono": "monospace"}.get(category(family) or "", "sans-serif")
    return '"%s", %s' % (family, generic)
