#!/usr/bin/env python3
"""Bring any music track to the library's level: -16 LUFS integrated, -1.5 dBTP, 48 kHz stereo.

    python prepare_track.py client-song.mp3 composition/assets/music/client-song.mp3 [--lufs -16]

Two-pass EBU R128 normalisation in linear mode, so the track's dynamics are kept: the whole
track moves up or down; nothing is squashed. Every library track is prepared this way, which is
why one bed volume (references/music.md, "Levels") works for all of them. Standard library + ffmpeg.
Then map it: uv run --project scripts python scripts/analyze_music.py <out> --output-json ... --output-md ...
"""

import argparse
import json
import re
import subprocess
import sys


def measure(path, lufs, tp, lra):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af",
                          "loudnorm=I=%s:TP=%s:LRA=%s:print_format=json" % (lufs, tp, lra), "-f", "null", "-"],
                         capture_output=True, text=True, check=True).stderr
    blob = re.findall(r"\{[^{}]*\"input_i\"[^{}]*\}", out, re.S)
    if not blob:
        sys.exit("prepare_track: ffmpeg did not report loudness for %s" % path)
    return json.loads(blob[-1])


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("input")
    ap.add_argument("output", help=".mp3 (192k unless --bitrate), .m4a (256k AAC) or .wav")
    ap.add_argument("--lufs", type=float, default=-16.0)
    ap.add_argument("--true-peak", type=float, default=-1.5)
    ap.add_argument("--lra", type=float, default=20.0, help="kept high so linear mode is not refused")
    ap.add_argument("--bitrate", default="192k", help="for .mp3 output")
    a = ap.parse_args()
    m = measure(a.input, a.lufs, a.true_peak, a.lra)
    flt = ("loudnorm=I={I}:TP={TP}:LRA={LRA}:measured_I={mi}:measured_TP={mtp}:measured_LRA={mlra}:"
           "measured_thresh={mth}:offset={off}:linear=true").format(
        I=a.lufs, TP=a.true_peak, LRA=a.lra, mi=m["input_i"], mtp=m["input_tp"], mlra=m["input_lra"],
        mth=m["input_thresh"], off=m["target_offset"])
    codec = {"mp3": ["-c:a", "libmp3lame", "-b:a", a.bitrate], "m4a": ["-c:a", "aac", "-b:a", "256k"],
             "wav": ["-c:a", "pcm_s16le"]}.get(a.output.rsplit(".", 1)[-1].lower())
    if not codec:
        sys.exit("prepare_track: output must end in .mp3, .m4a or .wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", a.input, "-af", flt, "-ar", "48000", "-ac", "2"] + codec +
                   [a.output], check=True)
    after = measure(a.output, a.lufs, a.true_peak, a.lra)
    print("%s: %s LUFS / %s dBTP  ->  %s LUFS / %s dBTP" % (a.output, m["input_i"], m["input_tp"],
                                                             after["input_i"], after["input_tp"]))


if __name__ == "__main__":
    main()
