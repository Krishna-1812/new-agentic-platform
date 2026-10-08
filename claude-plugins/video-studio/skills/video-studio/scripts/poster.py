#!/usr/bin/env python3
"""Pick the poster frame and bake it in as frame 0, so every player and feed shows it as the thumbnail.

    python poster.py out/video.mp4 --at 3.2              # writes out/video.jpg and rewrites video.mp4
    python poster.py out/video.mp4 --at 3.2 --no-bake    # only the .jpg

Most platforms (Slack, X, Discord, LinkedIn previews) take frame 0 as the thumbnail and ignore
cover-art metadata, so the only reliable way to control it is to make frame 0 the poster. Only the
first frame's pixels change (1/30 s, invisible on playback); duration, frame count and audio stay
exactly as they were. Pick a SETTLED moment: words fully in, nothing mid-transition. From /brag.
"""

import argparse
import os
import subprocess
import sys


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("video")
    ap.add_argument("--at", type=float, required=True, help="seconds: the strongest settled frame")
    ap.add_argument("--jpg", help="poster path (default: next to the video, .jpg)")
    ap.add_argument("--no-bake", action="store_true")
    a = ap.parse_args()
    jpg = a.jpg or os.path.splitext(a.video)[0] + ".jpg"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "%.3f" % a.at, "-i", a.video, "-frames:v", "1",
                    "-q:v", "2", jpg], check=True)
    print("poster: %s (%.2fs)" % (jpg, a.at))
    if a.no_bake:
        return
    tmp = os.path.splitext(a.video)[0] + ".poster-tmp.mp4"
    res = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", a.video, "-i", jpg, "-filter_complex",
                          "[1:v]scale=iw:ih[p];[0:v][p]overlay=0:0:enable='eq(n,0)'[v]", "-map", "[v]", "-map", "0:a?",
                          "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p", "-c:a", "copy",
                          "-movflags", "+faststart", tmp], capture_output=True, text=True)
    if res.returncode:
        sys.exit("poster: baking failed: " + res.stderr[-400:])
    os.replace(tmp, a.video)
    print("baked as frame 0 of %s" % a.video)


if __name__ == "__main__":
    main()
