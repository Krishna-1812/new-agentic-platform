"""Fetch Video Studio's bundled fonts from Google Fonts (all SIL Open Font
License 1.1) into tracker/video_kit/fonts/, and write the manifest
tracker/video_kit/fonts.json that tracker/video_fonts.py reads.

The render browser has no network, so every font a video can use is bundled.
A brand font that is not in this set is mapped to the nearest one in it.

    python scripts/fetch_video_fonts.py

Only the latin and latin-ext subsets are kept (latin-ext carries the rupee
sign and most European letters).
"""

import json
import os
import re
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KIT = os.path.join(ROOT, "tracker", "video_kit")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"

# (family, category, Google Fonts axis spec, italic too)
FAMILIES = [
    ("Inter", "sans", "wght@400..700", False),
    ("Roboto", "sans", "wght@400..700", False),
    ("Open Sans", "sans", "wght@400..700", False),
    ("Lato", "sans", "wght@400;700", False),
    ("Montserrat", "sans", "wght@400..700", False),
    ("Poppins", "sans", "wght@400;600;700", False),
    ("Raleway", "sans", "wght@400..700", False),
    ("Nunito", "sans", "wght@400..700", False),
    ("Work Sans", "sans", "wght@400..700", False),
    ("DM Sans", "sans", "wght@400..700", False),
    ("Manrope", "sans", "wght@400..700", False),
    ("Plus Jakarta Sans", "sans", "wght@400..700", False),
    ("Source Sans 3", "sans", "wght@400..700", False),
    ("IBM Plex Sans", "sans", "wght@400;600;700", False),
    ("Space Grotesk", "sans", "wght@400..700", False),
    ("Playfair Display", "serif", "wght@400..700", True),
    ("Merriweather", "serif", "wght@400;700", False),
    ("Lora", "serif", "wght@400..700", True),
    ("Fraunces", "serif", "wght@400..700", True),
    ("DM Serif Display", "serif", "wght@400", False),
    ("JetBrains Mono", "mono", "wght@400..700", False),
]
SUBSETS = ("latin", "latin-ext")
FACE = re.compile(r"/\* ([\w-]+) \*/\s*@font-face \{(.*?)\}", re.S)


def css_for(family, axes, italic):
    weights = axes.split("@")[1].split(";")
    spec = axes if not italic else "ital,wght@" + ";".join(["0," + w for w in weights] + ["1," + w for w in weights])
    url = "https://fonts.googleapis.com/css2?family=%s:%s&display=swap" % (family.replace(" ", "+"), spec)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=30).read().decode()


def slug(family):
    return re.sub(r"[^a-z0-9]+", "-", family.lower()).strip("-")


def main():
    out_dir = os.path.join(KIT, "fonts")
    os.makedirs(out_dir, exist_ok=True)
    manifest = []
    for family, category, axes, italic in FAMILIES:
        css = css_for(family, axes, italic)
        faces = []
        for subset, body in FACE.findall(css):
            if subset not in SUBSETS:
                continue
            style = re.search(r"font-style: (\w+)", body).group(1)
            weight = re.search(r"font-weight: ([\d ]+);", body).group(1).strip()
            src = re.search(r"url\((https://[^)]+\.woff2)\)", body).group(1)
            ranges = re.search(r"unicode-range: ([^;]+);", body).group(1).strip()
            name = "%s-%s-%s-%s.woff2" % (slug(family), style, weight.replace(" ", "-"), subset)
            data = urllib.request.urlopen(urllib.request.Request(src, headers={"User-Agent": UA}), timeout=30).read()
            with open(os.path.join(out_dir, name), "wb") as fh:
                fh.write(data)
            faces.append({"file": "fonts/" + name, "style": style, "weight": weight, "subset": subset,
                          "unicode_range": ranges, "bytes": len(data)})
        manifest.append({"family": family, "category": category, "faces": faces})
        print(family, len(faces), "files", sum(f["bytes"] for f in faces) // 1024, "KB")
    with open(os.path.join(KIT, "fonts.json"), "w") as fh:
        json.dump({"source": "Google Fonts", "licence": "SIL Open Font License 1.1", "families": manifest}, fh,
                  indent=1)
        fh.write("\n")


if __name__ == "__main__":
    main()
