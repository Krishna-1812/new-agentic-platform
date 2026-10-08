#!/usr/bin/env python3
"""Pull frames from a rendered video for review: one contact sheet, or single frames at given times.

    python review_frames.py video.mp4 --sheet review/sheet.jpg            # 12 evenly spaced frames
    python review_frames.py video.mp4 --sheet review/sheet.jpg --times 1.2,3.4,7.9,12.0
    python review_frames.py video.mp4 --frames review/ --times 0,0.5,2.8   # full-size PNGs
    python review_frames.py video.mp4 --sheet review/first-second.jpg --from 0 --to 1 --count 6

Read the sheet as an art director would (references/review.md). Frames are taken at exactly the
times given, so pass each scene's settled moment (about 80% through it) to judge layout, and the
middle of a transition to judge motion. The sheet reads left to right, top to bottom, and each tile
is stamped with its time when ffmpeg has a font for drawtext. Standard library + ffmpeg.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path],
                         capture_output=True, text=True, check=True).stdout
    return float(json.loads(out)["format"]["duration"])


def grab(path, t, dest, width=None, label=True):
    vf = []
    if width:
        vf.append("scale=%d:-2" % width)
    if label:
        vf.append("drawtext=text='%.2fs':x=12:y=12:fontsize=h/18:fontcolor=white:box=1:boxcolor=black@0.6:"
                  "boxborderw=8" % t)
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", "%.3f" % t, "-i", path, "-frames:v", "1"]
    res = subprocess.run(cmd + (["-vf", ",".join(vf)] if vf else []) + [dest], capture_output=True, text=True)
    if res.returncode and label:  # no font available for drawtext: grab without the stamp
        return grab(path, t, dest, width, label=False)
    if res.returncode:
        sys.exit("review_frames: could not grab %.2fs: %s" % (t, res.stderr[-300:]))
    return dest


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("video")
    ap.add_argument("--sheet", help="write a contact sheet (.jpg/.png)")
    ap.add_argument("--frames", help="write single full-size frames into this folder")
    ap.add_argument("--times", help="comma-separated seconds")
    ap.add_argument("--count", type=int, default=12)
    ap.add_argument("--from", dest="t0", type=float, default=None)
    ap.add_argument("--to", dest="t1", type=float, default=None)
    ap.add_argument("--cols", type=int, default=0, help="sheet columns (default: by shape)")
    a = ap.parse_args()
    d = duration(a.video)
    if a.times:
        times = [min(max(0.0, float(x)), d - 0.04) for x in a.times.split(",") if x.strip()]
    else:
        t0 = a.t0 if a.t0 is not None else 0.25
        t1 = a.t1 if a.t1 is not None else d - 0.25
        n = max(1, a.count)
        times = [t0 + (t1 - t0) * (i / (n - 1) if n > 1 else 0.5) for i in range(n)]
    if a.frames:
        os.makedirs(a.frames, exist_ok=True)
        for t in times:
            p = grab(a.video, t, os.path.join(a.frames, "frame-%06.2fs.png" % t), label=False)
            print(p)
    if a.sheet:
        probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                "stream=width,height", "-of", "json", a.video], capture_output=True, text=True)
        s = json.loads(probe.stdout)["streams"][0]
        tall = s["height"] > s["width"]
        cols = a.cols or (6 if tall else 4)
        tile_w = 300 if tall else 480
        tmp = tempfile.mkdtemp()
        try:
            for i, t in enumerate(times):
                grab(a.video, t, os.path.join(tmp, "%03d.png" % i), width=tile_w)
            rows = (len(times) + cols - 1) // cols
            os.makedirs(os.path.dirname(os.path.abspath(a.sheet)), exist_ok=True)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "1", "-i", os.path.join(tmp, "%03d.png"),
                            "-vf", "tile=%dx%d:padding=6:margin=6:color=0x202020" % (cols, rows), "-frames:v", "1",
                            "-q:v", "3", a.sheet], check=True)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        print("%s (%d frames: %s)" % (a.sheet, len(times), ", ".join("%.2f" % t for t in times)))


if __name__ == "__main__":
    main()
