"""Check Video Studio's scene library with the real HyperFrames.

Builds a composition holding all 16 scene templates for each shape, with
short words and with words at each template's limit, on a light brand and on
a dark one (16 compositions), and runs `hyperframes check` on each, sampling
every scene once it has settled. Prints every error by scene.

    python scripts/check_video_scenes.py [--shape vertical] [--brand dark] [--length long] [--snap DIR]

Needs Node and HyperFrames (VIDEO_ENGINE_DIR) and a headless shell.
"""

import argparse
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import video_brand, video_build, video_samples, video_sandbox  # noqa: E402


VERBOSE = False


def run(shape, brand_name, length, snap=None):
    brand = video_brand.resolve(video_samples.LIGHT_BRAND if brand_name == "light" else video_samples.DARK_BRAND)
    brand["logo_asset"] = 20
    plan = video_samples.library_plan(length)
    out = video_build.compose(plan, brand, shape, assets=video_samples.library_assets(),
                              tables=video_samples.library_tables())
    settled = [round(a + (b - a) * 0.8, 2) for a, b in out["scenes"]]
    with video_sandbox.Sandbox("lib-%s-%s-%s" % (shape, brand_name, length)) as box:
        box.write(out["files"])
        t = time.monotonic()
        report = box.check(at=settled, timeout=600)
        took = time.monotonic() - t
        if snap:
            frames = box.snapshot(settled, timeout=600)
            os.makedirs(snap, exist_ok=True)
            for i, f in enumerate(frames):
                with open(os.path.join(snap, "%s-%s-%s-%02d.png" % (shape, brand_name, length, i + 1)), "wb") as fh:
                    fh.write(f)
    by_scene = {}
    for e in report["errors"]:
        m = re.search(r"#s(\d+)", e.get("selector") or "")
        scene = plan["scenes"][int(m.group(1)) - 1]["type"] if m else "?"
        by_scene.setdefault(scene, []).append("%s: %s (%s)" % (e["code"], e["message"][:120], e.get("selector", "")[:60]))
    print("%-9s %-5s %-5s %s  %.0fs  %d errors, %d warnings" % (shape, brand_name, length,
                                                              "OK  " if report["ok"] else "FAIL", took,
                                                              len(report["errors"]), len(report["warnings"])))
    codes = {}
    for w in report["warnings"]:
        codes[w["code"]] = codes.get(w["code"], 0) + 1
    if codes and VERBOSE:
        print("    warnings: " + ", ".join("%s x%d" % kv for kv in sorted(codes.items())))
    for scene, errs in by_scene.items():
        for e in errs[:4]:
            print("    %-11s %s" % (scene, e))
    return report["ok"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shape", choices=["landscape", "vertical", "square", "portrait"])
    ap.add_argument("--brand", choices=["light", "dark"])
    ap.add_argument("--length", choices=["short", "long"])
    ap.add_argument("--snap")
    ap.add_argument("--verbose", action="store_true")
    a = ap.parse_args()
    global VERBOSE
    VERBOSE = a.verbose
    ok = True
    for shape in [a.shape] if a.shape else ["landscape", "vertical", "square", "portrait"]:
        for brand in [a.brand] if a.brand else ["light", "dark"]:
            for length in [a.length] if a.length else ["short", "long"]:
                ok = run(shape, brand, length, a.snap) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
