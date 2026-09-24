"""Nothing on the site follows the pointer around.

The previous product's kits drew a disc under the cursor (#lx-halo, 340px)
and a spotlight that chased it (#alive-spot, 620px), and carried 3D tilt and
magnetic buttons. Two admin pages (Internal Usage, External Usage) still
loaded both kits after the redesign; with the light palette the spotlight's
screen blend turned into a solid white circle under the pointer. Both kits
are gone; this keeps them gone, from every template, script and stylesheet
the app serves. (The public site's own motion, static/js/press-play.js, is
covered by tests/test_press_play.py and follows none of these patterns.)
"""

import os
import re
import subprocess

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_SIGNATURES = (
    "lx-halo", "alive-spot", "__LUX_CFG", "__ALIVE_CFG",   # the two kits
    "alive-mag", "alive-tilt",                              # their magnetic / tilt hooks
)


def _served_files():
    out = subprocess.check_output(["git", "ls-files", "templates", "static"], cwd=_ROOT).decode().split()
    return [f for f in out if f.endswith((".html", ".js", ".css"))]


def test_no_page_loads_the_old_pointer_kits():
    hits = []
    for f in _served_files():
        src = open(os.path.join(_ROOT, f), encoding="utf-8", errors="ignore").read()
        for sig in _SIGNATURES:
            if sig in src and not f.endswith("bento-compat.css"):   # that file only HIDES them
                hits.append((f, sig))
    assert hits == [], hits


def test_nothing_tilts_in_3d_under_the_pointer():
    rx = re.compile(r"perspective\(\d+px\)\s*rotate[XY]")
    hits = [f for f in _served_files()
            if rx.search(open(os.path.join(_ROOT, f), encoding="utf-8", errors="ignore").read())]
    assert hits == [], hits
