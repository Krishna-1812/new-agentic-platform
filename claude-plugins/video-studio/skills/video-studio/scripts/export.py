#!/usr/bin/env python3
"""Make platform-ready copies of a finished video: right codec, loudness, size, and a preview GIF.

    python export.py out/video.mp4 --for social,youtube,web [--gif] [--outdir out/exports]

Each copy is H.264 High (yuv420p, the format every phone and feed plays), AAC 48 kHz, with the
moov atom up front so it starts playing before it has downloaded, mastered to that platform's
loudness (scripts/loudness.py). Shape is not changed here: a vertical cut is a separate render of a
vertical composition, never a crop of the landscape one (references/formats.md).
Standard library + ffmpeg.
"""

import argparse
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loudness  # noqa: E402

PRESETS = {
    # name: (loudness target, crf, max bitrate, audio bitrate)
    "social": ("social", 18, "12M", "192k"),    # Instagram, TikTok, LinkedIn, X, Facebook
    "youtube": ("youtube", 16, "24M", "256k"),
    "web": ("web", 21, "6M", "160k"),           # your site / product page / email link: small and quick
    "master": ("social", 12, "40M", "320k"),    # archive / hand-off copy
}


def export(src, dest, preset):
    """One encode: picture to H.264, sound mastered to the platform's loudness in the same pass."""
    target, crf, maxrate, abr = PRESETS[preset]
    video = ["-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-preset", "slow", "-crf", str(crf),
             "-maxrate", maxrate, "-bufsize", maxrate]
    has_audio = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
                                "-of", "csv=p=0", src], capture_output=True, text=True).stdout.strip()
    if has_audio:
        lufs, tp = loudness.TARGETS[target]
        loudness.master(src, dest, lufs, tp, video_args=video, abr=abr)
    else:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-map", "0:v"] + video +
                       ["-movflags", "+faststart", dest], check=True)
    print("%-8s %s (%.1f MB)" % (preset, dest, os.path.getsize(dest) / 1e6))


def gif(src, dest, width=480, fps=12, seconds=6.0):
    pal = dest + ".palette.png"
    base = "fps=%d,scale=%d:-2:flags=lanczos" % (fps, width)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-t", str(seconds), "-i", src, "-vf", base + ",palettegen=stats_mode=diff",
                    pal], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-t", str(seconds), "-i", src, "-i", pal, "-lavfi",
                    base + "[x];[x][1:v]paletteuse=dither=sierra2_4a", dest], check=True)
    os.remove(pal)
    print("gif      %s (%.1f MB, first %.0fs)" % (dest, os.path.getsize(dest) / 1e6, seconds))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("video")
    ap.add_argument("--for", dest="targets", default="social", help="comma list: " + ", ".join(PRESETS))
    ap.add_argument("--outdir")
    ap.add_argument("--gif", action="store_true", help="also a 6s preview GIF for READMEs and docs")
    a = ap.parse_args()
    out = a.outdir or os.path.join(os.path.dirname(os.path.abspath(a.video)), "exports")
    os.makedirs(out, exist_ok=True)
    stem = os.path.splitext(os.path.basename(a.video))[0]
    for t in [x.strip() for x in a.targets.split(",") if x.strip()]:
        if t not in PRESETS:
            sys.exit("export: unknown target %r (choose from %s)" % (t, ", ".join(PRESETS)))
        export(a.video, os.path.join(out, "%s-%s.mp4" % (stem, t)), t)
    if a.gif:
        gif(a.video, os.path.join(out, stem + "-preview.gif"))


if __name__ == "__main__":
    main()
