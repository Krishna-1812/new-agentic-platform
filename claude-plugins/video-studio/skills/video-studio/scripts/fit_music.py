#!/usr/bin/env python3
"""Cut a music bed to the exact length of a video, the way an editor would, and print its bar map.

    python fit_music.py <track.mp3> --map <track.music.json> --duration 20 \
        --mode natural|button|fade|auto [--anchor 41.9@6.2] [--start 32.0] [--ring 1.0] \
        --out composition/assets/music/bed.wav --timing composition/assets/music/bed.timing.json

Standard library + ffmpeg only. The map comes from analyze_music.py (bundled tracks ship with one
in assets/music/analysis/).

Modes (see references/music.md for when to use which):
  natural  Back-time the track so its real ending lands on the video's last frame. The most
           finished-sounding ending there is; needs the track to be longer than the video.
  button   Start on a downbeat and stop on a later downbeat ~0.5-1.6s before the end, with a short
           release. Put an impact SFX on that downbeat so the stop sounds intentional, and hold the
           logo in its tail.
  fade     Start on a downbeat and fade out over the last bar or so. Safe, least exciting.
  auto     natural if it sounds good for this length, else button.

--anchor M@V forces music time M (seconds in the track, e.g. a lift) to land at video time V.
--start S forces the cut-in point. Both override the automatic choice of where to cut in.

The timing JSON lists, in VIDEO time: every beat, every bar line, section changes, lifts, the
strongest cues, where the music stops and the final downbeat. Time picture to these.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys

DECLICK = 0.012  # every cut gets at least a 12 ms fade so it never clicks
LEAD_IN = 0.025  # the first sound of a file: AAC overshoots by ~4 dB on audio that starts at full level


class CutError(ValueError):
    pass


def _near(xs, t):
    return min(xs, key=lambda x: abs(x - t)) if xs else None


def _section_at(m, t):
    for s in m.get("sections") or []:
        if s["start"] - 1e-6 <= t < s["end"]:
            return s
    return None


def _energy_at(m, t):
    e = m.get("energy") or {}
    vals, step = e.get("values") or [], e.get("step") or 0.5
    if not vals:
        return 0.0
    i = int(max(0, min(len(vals) - 1, t / step)))
    return vals[i]


def _median_energy(m):
    vals = sorted((m.get("energy") or {}).get("values") or [0.0])
    return vals[len(vals) // 2]


def _window(m, s, d):
    """What the video hears if the bed runs from track time s for d seconds, in video time."""
    end = s + d
    pick = lambda xs: [round(x - s, 3) for x in xs if s - 1e-6 <= x <= end + 1e-6]
    return {
        "beats": pick([b["time"] for b in m.get("beats") or []]),
        "bars": pick(m.get("downbeats") or []),
        "phrases": pick(m.get("phrases") or []),
        "sections": [{"videoStart": round(max(0.0, x["start"] - s), 3), "videoEnd": round(min(d, x["end"] - s), 3),
                      "energy": x["energy"], "label": x["label"], "lift": x["lift"]}
                     for x in m.get("sections") or [] if x["end"] > s and x["start"] < end],
        "lifts": pick(m.get("lifts") or []),
        "strongCues": [round(c["time"] - s, 3) for c in sorted(m.get("strongCues") or [],
                                                               key=lambda c: -c["intensity"])
                       if s <= c["time"] <= end][:8],
    }


def _score(m, s, d, last_down=None, natural=False):
    """Higher is better: start on a phrase, start with energy, a lift in the reveal zone, end strong."""
    score, notes = 0.0, []
    med = _median_energy(m)
    phrases, downs = m.get("phrases") or [], m.get("downbeats") or []
    if phrases and abs(_near(phrases, s) - s) < 0.06:
        score += 2.0
    elif downs and abs(_near(downs, s) - s) < 0.06:
        score += 1.0
    if s < m.get("arrival", 0) - 0.1:
        score -= 1.5
        notes.append("starts in the track's intro")
    e0 = sum(_energy_at(m, s + k * 0.5) for k in range(4)) / 4
    if e0 < med - 6:
        score -= 1.5
        notes.append("quiet first 2s")
    w = _window(m, s, d)
    zone = [x for x in w["lifts"] if 0.12 * d <= x <= 0.7 * d]
    if zone:
        score += 2.0
    elif w["lifts"]:
        score += 0.5
    if last_down is not None:
        sec = _section_at(m, s + last_down)
        if sec and sec["label"] in ("high", "mid"):
            score += 1.0
        if sec and sec["label"] in ("outro", "low"):
            score -= 0.5
    ending = m.get("ending") or {}
    if not natural and s + d > ending.get("finalHit", m["duration"]) - 0.5:
        score -= 3.0
        notes.append("runs into the track's own ending")
    return score, notes, w


def plan_cut(m, duration, mode="auto", anchor=None, start=None, ring=None):
    d = float(duration)
    if d <= 0:
        raise CutError("duration must be positive")
    bar = m.get("barSeconds") or 2.0
    downs = m.get("downbeats") or []
    ending = m.get("ending") or {}
    total = m["duration"]
    if mode == "auto":
        try:
            p = plan_cut(m, d, "natural", anchor, start, ring)
            if p["score"] >= 1.0 and d >= 10:
                return p
        except CutError:
            pass
        return plan_cut(m, d, "button", anchor, start, ring)

    notes, video_offset, fade_in = [], 0.0, DECLICK
    last_down = None
    if mode == "natural":
        if anchor or start is not None:
            raise CutError("natural mode back-times from the ending; drop --anchor/--start or use button")
        end = ending.get("lastSound", total) + 0.05
        ideal = end - d
        if ideal < 0:
            raise CutError("track (%.1fs) is shorter than the video; pick a longer track" % total)
        # Cut in on a downbeat near the ideal point: up to 1s early (the last of the ring is faded)
        # or up to 1s late (the music ends just before the last frame, under the logo hold).
        win = max(1.0, min(1.6, bar / 2))
        near = [x for x in downs if abs(x - ideal) <= win]
        beats = [b["time"] for b in m.get("beats") or []]
        if near:
            s = min(near, key=lambda x: abs(x - ideal))
        else:
            nb = [x for x in beats if abs(x - ideal) <= 0.5]
            s = min(nb, key=lambda x: abs(x - ideal)) if nb else ideal
        hit = ending.get("finalHit", end)
        last_down = round(hit - s, 3)
        fade_out = 0.0  # the track fades or rings by itself
        if not near:
            fade_in = 0.15 if abs(s - ideal) <= 0.5 and s != ideal else 0.6
            notes.append("cuts in off the bar line: %.2fs fade-in, or cover it with a whoosh" % fade_in)
        elif s < ideal - 0.02:
            fade_out = round(min(1.0, ideal - s + 0.3), 3)
            notes.append("cuts in on a bar line; the last %.2fs of the ring is faded" % fade_out)
        elif s > ideal + 0.02:
            notes.append("cuts in on a bar line; silent for the last %.2fs" % (s - ideal))
        if ending.get("type") == "hit":
            notes.append("final hit at %.2fs: land the logo on it" % last_down)
        else:
            notes.append("the track's own fade-out ends the video")
        music_end = min(d, end - s)
    elif mode in ("button", "fade"):
        if start is not None or anchor:
            if start is not None:
                s = float(start)
            else:
                mt, vt = anchor
                s = mt - vt
            if s < 0:
                video_offset, s = -s, 0.0
                notes.append("music enters at video %.2fs so the anchor lands" % video_offset)
            cands = [s]
        else:
            cands = [x for x in downs if x + d <= ending.get("finalHit", total) - 0.25] or [0.0]
        best = None
        for s0 in cands:
            span = d - video_offset
            if mode == "button":
                want = ring or 1.0
                lo, hi = (ring, ring) if ring else (0.4, 0.4 + bar)
                stops = list(downs)
                if bar > 2.6:  # slow music: the 3 of the bar is a strong enough place to stop
                    stops += [a + (b - a) / 2 for a, b in zip(downs, downs[1:])]
                ends = [x for x in stops if s0 + span - hi - 0.06 <= x <= s0 + span - lo + 0.06 and x > s0]
                if not ends:
                    ends = [_near(stops, s0 + span - want)] if stops else [s0 + span - want]
                c = min(ends, key=lambda x: abs((s0 + span - x) - want))
                ld = c - s0
            else:
                ld = None
            sc, nn, _ = _score(m, s0, span, ld)
            if mode == "button":
                sc -= 0.6 * abs((span - ld) - (ring or 1.0))  # prefer a ~1s logo hold
            if best is None or sc > best[0]:
                best = (sc, s0, ld, nn)
        _, s, ld, nn = best
        stop_half = mode == "button" and downs and min(abs(s + ld - x) for x in downs) > 0.06
        notes += nn
        span = d - video_offset
        near = _near(downs, s)
        if near is not None and abs(near - s) > 0.06:
            fade_in = 0.35
        if mode == "button":
            last_down = round(ld + video_offset, 3)
            release = 0.25
            music_end = min(d, last_down + release)
            fade_out = release
            notes.append("stops on the %s at %.2fs (%.2fs before the end): impact SFX there, logo holds in its tail"
                         % ("half-bar" if stop_half else "downbeat", last_down, d - last_down))
        else:
            fade_out = min(max(bar, 1.5), 3.0, span / 3)
            music_end = d
            last_down = None
            notes.append("fades over the last %.2fs" % fade_out)
    else:
        raise CutError("unknown mode %r" % mode)

    span = music_end - video_offset
    sc, nn, w = _score(m, s, span, None if last_down is None else last_down - video_offset, mode == "natural")
    notes += [x for x in nn if x not in notes]
    shift = lambda xs: [round(x + video_offset, 3) for x in xs]
    return {
        "mode": mode, "duration": d, "start": round(s, 3), "videoOffset": round(video_offset, 3),
        "musicEnd": round(music_end, 3), "fadeIn": round(fade_in, 3), "fadeOut": round(fade_out, 3),
        "lastDownbeat": last_down, "tempo": m.get("tempo"), "barSeconds": bar,
        "beats": shift(w["beats"]), "bars": shift(w["bars"]), "phrases": shift(w["phrases"]),
        "sections": [dict(x, videoStart=round(x["videoStart"] + video_offset, 3),
                          videoEnd=round(x["videoEnd"] + video_offset, 3)) for x in w["sections"]],
        "lifts": shift(w["lifts"]), "strongCues": shift(w["strongCues"]),
        "score": round(sc, 2), "notes": notes,
    }


def render(track, plan, out, lufs=None):
    """Write the bed: [silence videoOffset] + track[start : start+len] with fades, padded to duration."""
    d, off = plan["duration"], plan["videoOffset"]
    length = plan["musicEnd"] - off
    fo = max(DECLICK, plan["fadeOut"])
    fi = max(LEAD_IN, plan["fadeIn"])
    af = ["atrim=start=%.4f:duration=%.4f" % (plan["start"], length), "asetpts=PTS-STARTPTS",
          "afade=t=in:st=0:d=%.3f" % fi, "afade=t=out:st=%.3f:d=%.3f" % (max(0, length - fo), fo)]
    if off > 0:
        af.append("adelay=%d:all=1" % int(round(off * 1000)))
    af.append("apad=whole_dur=%.3f" % d)
    af.append("atrim=end=%.3f" % d)
    if lufs is not None:
        af.append("volume=%.2fdB" % lufs)
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", track, "-af", ",".join(af), "-ar", "48000", "-ac", "2"]
    cmd += ["-c:a", "pcm_s16le"] if out.lower().endswith(".wav") else ["-c:a", "aac", "-b:a", "256k"]
    subprocess.run(cmd + [out], check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("track")
    ap.add_argument("--map", required=True, help="the track's .music.json from analyze_music.py")
    ap.add_argument("--duration", type=float, required=True, help="video length in seconds")
    ap.add_argument("--mode", default="auto", choices=["auto", "natural", "button", "fade"])
    ap.add_argument("--anchor", help="M@V: track time M lands at video time V (e.g. 41.9@6.2)")
    ap.add_argument("--start", type=float, help="cut in at this track time")
    ap.add_argument("--ring", type=float, help="button mode: seconds from the last downbeat to the end")
    ap.add_argument("--gain-db", type=float, help="extra gain baked into the bed (normally leave it to the mix)")
    ap.add_argument("--out", help="bed file to write (.wav or .m4a); omit to only print the plan")
    ap.add_argument("--timing", help="where to write the timing JSON (default: next to --out)")
    a = ap.parse_args()
    with open(a.map, encoding="utf-8") as fh:
        m = json.load(fh)
    anchor = None
    if a.anchor:
        mt, vt = a.anchor.split("@")
        anchor = (float(mt), float(vt))
    try:
        plan = plan_cut(m, a.duration, a.mode, anchor, a.start, a.ring)
    except CutError as e:
        sys.exit("fit_music: %s" % e)
    plan["track"] = os.path.basename(a.track)
    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        render(a.track, plan, a.out, a.gain_db)
        timing = a.timing or os.path.splitext(a.out)[0] + ".timing.json"
        with open(timing, "w", encoding="utf-8") as fh:
            json.dump(plan, fh, indent=1)
        plan["timingFile"] = timing
    print("mode %s · cut in at %.2fs of %s · music %s→%.2fs of %.2fs · fade in %.2fs / out %.2fs" % (
        plan["mode"], plan["start"], plan["track"], ("%.2f" % plan["videoOffset"]), plan["musicEnd"],
        plan["duration"], plan["fadeIn"], plan["fadeOut"]))
    print("bars (video s): " + ", ".join("%.2f" % x for x in plan["bars"]))
    print("lifts: %s · strongest cues: %s" % (", ".join("%.2f" % x for x in plan["lifts"]) or "none",
                                              ", ".join("%.2f" % x for x in plan["strongCues"][:5]) or "none"))
    if plan["lastDownbeat"] is not None:
        print("final downbeat / hit: %.2fs" % plan["lastDownbeat"])
    for s in plan["sections"]:
        print("  section %5.2f-%5.2f  %s%s  energy %d" % (s["videoStart"], s["videoEnd"], s["label"],
                                                         " LIFT" if s["lift"] else "", s["energy"]))
    for n in plan["notes"]:
        print("note: " + n)
    if a.out:
        print("wrote %s and %s" % (a.out, plan["timingFile"]))


if __name__ == "__main__":
    main()
