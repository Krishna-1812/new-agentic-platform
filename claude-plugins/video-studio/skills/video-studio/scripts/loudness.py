#!/usr/bin/env python3
"""Measure and master a rendered video's sound: loudness, true peak, range, and a per-second timeline.

    python loudness.py video.mp4                        # measure against the default target (social)
    python loudness.py video.mp4 --timeline             # also print loudness second by second
    python loudness.py video.mp4 --master out.mp4 --target youtube

Mastering is plain gain to the target plus an oversampled peak limiter at the ceiling: the whole
mix moves to the target and its balance and dynamics are untouched. The picture is copied, not re-encoded.
Standard library + ffmpeg. Targets and why: references/music.md, "Loudness and delivery".
"""

import argparse
import json
import os
import re
import subprocess
import sys

TARGETS = {  # integrated LUFS, true-peak ceiling dBTP
    "social": (-14.0, -1.0),     # Instagram, TikTok, X, LinkedIn, Facebook: they play loud, and turn loud down
    "youtube": (-14.0, -1.0),
    "web": (-16.0, -1.0),        # your own site, product pages, email: a little gentler
    "podcast": (-16.0, -1.0),
    "broadcast": (-23.0, -1.0),  # EBU R128 TV; ATSC A/85 is -24
}


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def measure(path):
    err = run(["ffmpeg", "-nostats", "-hide_banner", "-v", "verbose", "-i", path, "-vn", "-af", "ebur128=peak=true",
               "-f", "null", "-"]).stderr
    if "Summary:" not in err:
        sys.exit("loudness: no audio measured in %s (is there an audio stream?)" % path)
    tail = err[err.rfind("Summary:"):]
    get = lambda rx: float(re.search(rx, tail).group(1))
    out = {"integrated": get(r"I:\s+(-?[\d.]+) LUFS"), "lra": get(r"LRA:\s+(-?[\d.]+) LU"),
           "truePeak": get(r"Peak:\s+(-?[\d.]+) dBFS")}
    # Per-frame lines: "t: 1.2  TARGET:-23 LUFS  M: -18.3 S: -19.0 ..."
    frames = re.findall(r"t:\s*([\d.]+)\s+TARGET:[^M]*M:\s*(-?[\d.]+|-inf)\s+S:\s*(-?[\d.]+|-inf)", err)
    per_sec = {}
    for t, mom, short in frames:
        sec = int(float(t))
        if mom != "-inf":
            per_sec.setdefault(sec, []).append(float(mom))
    out["timeline"] = {s: max(v) for s, v in sorted(per_sec.items())}
    return out


CODEC_HEADROOM = 0.5  # AAC adds up to ~0.5 dB of inter-sample peak; aim under the ceiling by this much
LEAD_IN = "afade=t=in:d=0.025"  # audio that starts at full level on sample 0 makes AAC overshoot ~4 dB


def master(path, dest, lufs, tp, video_args=("-c:v", "copy"), abr="192k"):
    """Gain to the target, then a 4x-oversampled peak limiter at the ceiling.

    Plain gain keeps the mix's dynamics exactly (a quiet build stays quiet next to its drop); the
    limiter only catches the few peaks the gain pushed over the ceiling. ffmpeg's loudnorm is not
    used for this: when the gain needed is large it silently switches to dynamic mode and flattens
    the music."""
    m = measure(path)
    gain = lufs - m["integrated"]
    ceiling = 10 ** ((tp - CODEC_HEADROOM) / 20.0)
    flt = ("%s,volume=%.2fdB,aresample=192000,alimiter=limit=%.4f:attack=1:release=60:level=false:asc=1,"
           "aresample=48000" % (LEAD_IN, gain, ceiling))
    res = run(["ffmpeg", "-v", "error", "-y", "-i", path, "-map", "0:v?", "-map", "0:a"] + list(video_args) +
              ["-af", flt, "-ar", "48000", "-c:a", "aac", "-b:a", abr, "-movflags", "+faststart", dest])
    if res.returncode:
        sys.exit("loudness: mastering failed: " + res.stderr[-400:])
    # The limiter took a little loudness off the peaks: one small correction pass if it matters.
    after = measure(dest)
    if abs(after["integrated"] - lufs) > 0.5 and abs(lufs - after["integrated"]) < 3:
        tmp = dest + ".fix.mp4"
        flt2 = flt.replace("volume=%.2fdB" % gain, "volume=%.2fdB" % (gain + lufs - after["integrated"]))
        res = run(["ffmpeg", "-v", "error", "-y", "-i", path, "-map", "0:v?", "-map", "0:a"] + list(video_args) +
                  ["-af", flt2, "-ar", "48000", "-c:a", "aac", "-b:a", abr, "-movflags", "+faststart", tmp])
        if res.returncode == 0:
            os.replace(tmp, dest)


def report(name, m, lufs, tp, timeline=False):
    ok_i = abs(m["integrated"] - lufs) <= 1.0
    ok_tp = m["truePeak"] <= tp + 0.1
    print("%s: %.1f LUFS (target %.1f %s) · true peak %.1f dBTP (ceiling %.1f %s) · range %.1f LU" % (
        name, m["integrated"], lufs, "ok" if ok_i else "OFF", m["truePeak"], tp, "ok" if ok_tp else "OVER", m["lra"]))
    tl = m["timeline"]
    if tl:
        vals = list(tl.values())
        med = sorted(vals)[len(vals) // 2]
        jumps = [s for s, v in tl.items() if v > med + 6]
        holes = [s for s, v in tl.items() if v < med - 20 and 0 < s < max(tl) - 1]
        if jumps:
            print("  louder than the mix by 6+ LU at: %s s (an SFX or hit that jumps out?)" % jumps)
        if holes:
            print("  near-silent at: %s s (a gap in the bed?)" % holes)
    if timeline:
        for s, v in tl.items():
            bar = "#" * max(0, int((v + 40) / 1.5))
            print("  %4ds %6.1f LUFS-M  %s" % (s, v, bar))
    return ok_i and ok_tp


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("video")
    ap.add_argument("--target", default="social", choices=sorted(TARGETS))
    ap.add_argument("--lufs", type=float, help="override the target's loudness")
    ap.add_argument("--true-peak", type=float, help="override the target's true-peak ceiling")
    ap.add_argument("--timeline", action="store_true")
    ap.add_argument("--master", metavar="OUT", help="write a mastered copy here")
    a = ap.parse_args()
    lufs, tp = TARGETS[a.target]
    lufs = a.lufs if a.lufs is not None else lufs
    tp = a.true_peak if a.true_peak is not None else tp
    m = measure(a.video)
    ok = report(a.video, m, lufs, tp, a.timeline)
    if a.master:
        master(a.video, a.master, lufs, tp)
        ok = report(a.master, measure(a.master), lufs, tp)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
