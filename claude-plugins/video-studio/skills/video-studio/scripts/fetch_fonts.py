#!/usr/bin/env python3
"""Download Google Fonts as local files for a composition, and print the @font-face rules to paste.

    python fetch_fonts.py "EB Garamond:ital,wght@0,500;1,500" "Archivo:wght@500;700;800" \
        --out video-output/composition/assets/fonts

HyperFrames renders offline and lint requires an @font-face for every named font, so fonts must be
files inside the composition. Each argument is a Google Fonts css2 family spec (the part after
`family=` in a fonts.googleapis.com/css2 URL). Latin subset only, woff2. Standard library only.
Check the font's licence for commercial use (Google Fonts are all OFL or Apache: fine).
"""

import argparse
import os
import re
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("families", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--subset", default="latin")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rel = os.path.relpath(a.out, os.path.dirname(os.path.dirname(os.path.abspath(a.out)))).replace(os.sep, "/")
    faces = []
    for fam in a.families:
        url = "https://fonts.googleapis.com/css2?family=%s&display=swap" % urllib.parse.quote(fam, safe=":;@,")
        css = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60).read().decode()
        for subset, body in re.findall(r"/\*\s*([\w-]+)\s*\*/\s*@font-face\s*\{([^}]*)\}", css):
            if subset != a.subset:
                continue
            name = re.search(r"font-family:\s*'([^']+)'", body).group(1)
            style = re.search(r"font-style:\s*(\w+)", body).group(1)
            weight = re.search(r"font-weight:\s*([\d ]+);", body).group(1).strip()
            src = re.search(r"url\((https:[^)]+)\)", body).group(1)
            fn = "%s-%s-%s.woff2" % (name.replace(" ", ""), weight.replace(" ", "-"), style)
            urllib.request.urlretrieve(src, os.path.join(a.out, fn))
            faces.append("@font-face{font-family:'%s';font-style:%s;font-weight:%s;src:url(%s/%s) format('woff2');}"
                         % (name, style, weight, rel, fn))
    print("\n".join(faces) if faces else "no %s faces found: check the family spec" % a.subset)


if __name__ == "__main__":
    main()
