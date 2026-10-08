#!/usr/bin/env python3
"""Map a music track the way an editor hears it: tempo, beats, bars, sections, energy, lifts, ending.

    uv run --project <skill>/scripts python <skill>/scripts/analyze_music.py track.mp3 \
        --output-json track.music.json --output-md track.music.md

The JSON is what scripts/fit_music.py cuts the bed from, and what the composition times its
cuts to. It is a superset of /brag's music-cues schema (duration, tempo, beats[], strongCues[]),
so anything that read brag cue files still works.

What it finds, and how far to trust it:
- beats / tempo: librosa's beat tracker. Reliable on pop, house, corporate and acoustic beds.
  Rubato orchestral or ambient music can drift; the Markdown says when confidence is low.
- downbeats (bar lines): assumes 4/4 (nearly all library music) and picks the beat phase where
  bass and harmony change most. `downbeatConfidence` under ~0.15 means "treat bars as a guess".
- sections: agglomerative clustering of beat-synchronous chroma + timbre, snapped to bar lines.
  Labels (intro / low / mid / high / outro) come from loudness, not from musical theory.
- lifts: section starts that are at least 3 dB louder than what came before. These are the
  "drops" a reveal should land on.
- ending: where the music actually stops, whether it fades or ends on a hit, and that hit's time.
Needs librosa, numpy, scipy, soundfile (uv provisions them from scripts/pyproject.toml).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
from pathlib import Path

import librosa
import numpy as np

SR = 22050
HOP = 256  # ~11.6 ms frames, so beat times are not rounded to 23 ms
BEATS_PER_BAR = 4


def r(x, d=3):
    x = float(x)
    return round(x, d) if math.isfinite(x) else 0.0


def norm(v):
    v = np.nan_to_num(np.asarray(v, dtype=float))
    v = np.maximum(v, 0)
    hi = np.percentile(v, 98) if v.size else 0
    if hi <= 1e-12:
        return np.zeros_like(v)
    return np.clip(v / hi, 0, 1)


def madmom_beats(path):
    """[(time, position-in-bar)] from madmom's downbeat model, or None if madmom is not installed.
    madmom is optional (see references/music.md, "Your own track"); it makes bar lines reliable."""
    if os.environ.get("VIDEO_STUDIO_NO_MADMOM"):
        return None
    try:
        from madmom.features.downbeats import DBNDownBeatTrackingProcessor, RNNDownBeatProcessor
    except Exception:
        return None
    act = RNNDownBeatProcessor()(str(path))
    beats = DBNDownBeatTrackingProcessor(beats_per_bar=[3, 4], fps=100)(act)
    return [(float(t), int(p)) for t, p in beats]


def ffmpeg_loudness(path):
    """Integrated loudness, true peak and loudness range from ffmpeg's ebur128, or None."""
    try:
        out = subprocess.run(["ffmpeg", "-nostats", "-hide_banner", "-i", str(path), "-af", "ebur128=peak=true",
                              "-f", "null", "-"], capture_output=True, text=True, timeout=300).stderr
    except (OSError, subprocess.SubprocessError):
        return None
    summary = out[out.rfind("Summary:"):]
    vals = {}
    for key, rx in (("integratedLufs", r"I:\s+(-?[\d.]+) LUFS"), ("lra", r"LRA:\s+(-?[\d.]+) LU"),
                    ("truePeakDbtp", r"Peak:\s+(-?[\d.]+) dBFS")):
        m = re.search(rx, summary)
        if m:
            vals[key] = float(m.group(1))
    return vals or None


def downbeat_phase(beat_frames, bass_n, chroma, votes=None, accents=None):
    """The beat phase (0-3) that starts bars, from four independent clues, each a vote over phases:
    A. harmony changes across a whole bar (the chord of the bar before vs the bar after),
    B. where the loudest accents fall (crashes and hits mark the 1),
    C. where section boundaries fall (sections start on the 1),
    D. bass on the beat.
    Confidence is how far the winner beats the runner-up, after the votes are combined."""
    nb = len(beat_frames)
    if nb < BEATS_PER_BAR * 4:
        return 0, 0.0, [0.25] * BEATS_PER_BAR
    sync = librosa.util.sync(chroma, beat_frames, aggregate=np.mean)[:, :nb]
    nov = np.zeros(nb)
    for i in range(BEATS_PER_BAR, nb - BEATS_PER_BAR):
        a = sync[:, i - BEATS_PER_BAR:i].mean(axis=1)
        b = sync[:, i:i + BEATS_PER_BAR].mean(axis=1)
        den = (np.linalg.norm(a) * np.linalg.norm(b)) or 1.0
        nov[i] = 1 - float(a @ b) / den
    bass_at = np.array([bass_n[min(f, bass_n.size - 1)] for f in beat_frames])

    def share(v):
        v = np.asarray(v, dtype=float)
        v = v - v.min()
        return v / v.sum() if v.sum() > 0 else np.full(BEATS_PER_BAR, 0.25)

    A = share([nov[p::BEATS_PER_BAR].mean() for p in range(BEATS_PER_BAR)])
    D = share([bass_at[p::BEATS_PER_BAR].mean() for p in range(BEATS_PER_BAR)])
    B = np.full(BEATS_PER_BAR, 0.25)
    if accents is not None and len(accents) == nb:
        top = np.argsort(accents)[::-1][:max(8, nb // 10)]
        B = share(np.bincount(top % BEATS_PER_BAR, minlength=BEATS_PER_BAR) + 0.0)
    C = share(votes) if votes is not None and votes.sum() else np.full(BEATS_PER_BAR, 0.25)
    total = 0.40 * A + 0.20 * B + 0.25 * C + 0.15 * D
    order = np.argsort(total)[::-1]
    best, second = total[order[0]], total[order[1]]
    conf = (best - second) / best if best > 0 else 0.0
    return int(order[0]), r(conf, 2), [r(x, 3) for x in total]


def smooth_db(rms_db, frames):
    k = max(1, int(frames))
    return np.convolve(rms_db, np.ones(k) / k, mode="same")


def analyze(path: Path, window: float = 25.0):
    y, sr = librosa.load(str(path), sr=SR, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))
    fps = sr / HOP

    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    onset_n = norm(onset)
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=HOP)[0]
    rms_db = librosa.amplitude_to_db(np.maximum(rms, 1e-6), ref=1.0)
    spec = np.abs(librosa.stft(y, n_fft=4096, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=4096)
    bass = spec[(freqs >= 30) & (freqs <= 180)].mean(axis=0)
    bass_n = norm(bass)
    rms_n = norm(rms)
    chroma = librosa.feature.chroma_stft(S=spec ** 2, sr=sr, hop_length=HOP)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=HOP, n_mfcc=13)

    n = min(onset_n.size, rms_db.size, bass_n.size, chroma.shape[1], mfcc.shape[1])
    onset_n, rms_db, bass_n, rms_n = onset_n[:n], rms_db[:n], bass_n[:n], rms_n[:n]
    chroma, mfcc = chroma[:, :n], mfcc[:, :n]
    contrast = np.zeros(n)
    rad = max(1, int(0.5 * fps))
    for i in range(n):
        lo, hi = max(0, i - rad), min(n, i + rad + 1)
        contrast[i] = max(0.0, onset_n[i] - float(np.median(onset_n[lo:hi])))
    contrast_n = norm(contrast)

    def intensity(f):
        f = int(np.clip(f, 0, n - 1))
        return float(np.clip(0.45 * onset_n[f] + 0.25 * contrast_n[f] + 0.20 * rms_n[f] + 0.10 * bass_n[f], 0, 1))

    beat_source, bpb = "librosa", BEATS_PER_BAR
    mm = madmom_beats(path)
    if mm:
        # A trained downbeat model: the bar lines can be trusted.
        beat_source = "madmom"
        beat_times = np.array([t for t, _ in mm])
        positions = [p for _, p in mm]
        bpb = max(positions)
        beat_frames = librosa.time_to_frames(beat_times, sr=sr, hop_length=HOP)
        keep = beat_frames < n
        beat_frames, beat_times = beat_frames[keep], beat_times[keep]
        positions = [p for p, k in zip(positions, keep) if k]
        tempo = 0.0
    else:
        tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset[:n], sr=sr, hop_length=HOP, units="frames")
        tempo = float(np.asarray(tempo).reshape(-1)[0]) if np.asarray(tempo).size else 0.0
        beat_frames = np.asarray(beat_frames, dtype=int)
        beat_frames = beat_frames[beat_frames < n]
        beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP)
    if len(beat_times) > 8:
        # The slope of beat time against beat number: immune to frame rounding, unlike a median gap.
        idx = np.arange(len(beat_times))
        beat_period = float(np.polyfit(idx, beat_times, 1)[0])
        gaps = np.diff(beat_times)
        regularity = float(np.median(np.abs(gaps - np.median(gaps))) / beat_period)
    else:
        beat_period = 60.0 / tempo if tempo else 0.5
        regularity = 1.0

    # Section boundaries found on the beat grid vote for the bar phase: sections start on the 1.
    votes = np.zeros(BEATS_PER_BAR)
    raw_bounds = []
    if len(beat_frames) > 16:
        feats = np.vstack([librosa.util.normalize(chroma, axis=1), librosa.util.normalize(mfcc, axis=1),
                           librosa.util.normalize(rms_db[np.newaxis, :] - rms_db.min(), axis=1)])
        sync = librosa.util.sync(feats, beat_frames, aggregate=np.median)
        k = int(np.clip(round(duration / 18.0), 4, 12))
        k = min(k, sync.shape[1] - 1)
        raw_bounds = [int(b) for b in librosa.segment.agglomerative(sync, k) if b > 0]
        fine = librosa.segment.agglomerative(sync, min(sync.shape[1] - 1, k * 3))
        for b in fine:
            if b > 0:
                votes[int(b) % BEATS_PER_BAR] += 1
    if beat_source == "madmom":
        downbeats = [float(t) for t, p in zip(beat_times, positions) if p == 1]
        db_conf, phase_scores = 1.0, None
    else:
        accents = np.array([intensity(f) for f in beat_frames])
        phase, db_conf, phase_scores = downbeat_phase(beat_frames, bass_n, chroma, votes, accents)
        downbeats = [float(beat_times[i]) for i in range(phase, len(beat_frames), BEATS_PER_BAR)]
    bar = float(np.median(np.diff(downbeats))) if len(downbeats) > 2 else beat_period * bpb

    # Loudness landmarks.
    med = float(np.median(rms_db))
    sm = smooth_db(rms_db, fps)  # 1 s moving average
    audible = np.where(rms_db > med - 30)[0]
    music_start = float(audible[0] / fps) if audible.size else 0.0
    last_sound = float(audible[-1] / fps) if audible.size else duration
    arrive = np.where(sm >= med - 6)[0]
    arrival = float(arrive[0] / fps) if arrive.size else music_start

    # Sections: cluster beat-synchronous chroma + timbre + loudness, snap to bar lines.
    sections = []
    if raw_bounds:
        btimes = sorted(set([0.0] + [float(beat_times[min(b, len(beat_times) - 1)]) for b in raw_bounds]))
        snapped = [0.0]
        for t in btimes[1:]:
            near = min(downbeats, key=lambda d: abs(d - t)) if downbeats else t
            if near - snapped[-1] >= 2 * bar - 0.05 and near < last_sound - bar:
                snapped.append(near)
        edges = snapped + [last_sound]
        sec_db = []
        for a, b in zip(edges[:-1], edges[1:]):
            fa, fb = int(a * fps), max(int(a * fps) + 1, int(b * fps))
            sec_db.append(float(np.mean(rms_db[fa:fb])))
        lo, hi = np.percentile(sec_db, 20), np.percentile(sec_db, 80)
        for i, (a, b) in enumerate(zip(edges[:-1], edges[1:])):
            d = sec_db[i]
            level = int(np.clip(1 + round(4 * (d - lo) / (hi - lo)) if hi > lo else 3, 1, 5))
            if i == 0 and d < med - 3:
                label = "intro"
            elif i == len(edges) - 2 and d < sec_db[i - 1] - 2:
                label = "outro"
            else:
                label = "high" if level >= 4 else ("low" if level <= 2 else "mid")
            rise = d - sec_db[i - 1] if i else 0.0
            sections.append({"start": r(a), "end": r(b), "bars": int(round((b - a) / bar)) if bar else 0,
                             "loudnessDb": r(d, 1), "energy": level, "label": label,
                             "riseDb": r(rise, 1), "lift": bool(i and rise >= 2.5)})

    # Phrase starts: every 4 bars from each section start (where an edit sounds natural).
    phrases = []
    for s in sections or [{"start": 0.0, "end": last_sound}]:
        for d in downbeats:
            if s["start"] - 0.05 <= d < s["end"] - 0.05:
                k = int(round((d - s["start"]) / bar)) if bar else 0
                if k % 4 == 0:
                    phrases.append(r(d))
    phrases = sorted(set(phrases))

    # Ending: fade or hit, and the time of the last real hit.
    tail = 8.0
    fa = int(max(0, last_sound - tail) * fps)
    seg = sm[fa:int(last_sound * fps) + 1]
    drop = float(seg[: max(1, len(seg) // 4)].mean() - seg[-max(1, len(seg) // 4):].mean()) if seg.size else 0.0
    end_onsets = librosa.onset.onset_detect(onset_envelope=onset[:n], sr=sr, hop_length=HOP, units="frames")
    end_onsets = [int(f) for f in end_onsets if last_sound - 6 <= f / fps <= last_sound and onset_n[f] > 0.25]
    final_hit = float(end_onsets[-1] / fps) if end_onsets else last_sound
    if drop > 12 and last_sound - final_hit > 2.5:
        etype = "fade"
    elif last_sound - final_hit <= 4.0:
        etype = "hit"
    else:
        etype = "fade"
    ending = {"type": etype, "finalHit": r(final_hit), "lastSound": r(last_sound),
              "ringOut": r(last_sound - final_hit, 2), "tailDropDb": r(drop, 1)}

    beats = [{"time": r(t, 4), "intensity": r(intensity(f), 4)} for f, t in zip(beat_frames, beat_times)]

    # Strong cues (brag-compatible): beats and onset peaks, deduped, intensity >= 0.45.
    cands = [{"time": b["time"], "intensity": b["intensity"], "kind": "strong_beat"} for b in beats]
    for f in librosa.onset.onset_detect(onset_envelope=onset[:n], sr=sr, hop_length=HOP, units="frames"):
        cands.append({"time": r(f / fps, 4), "intensity": r(intensity(f), 4), "kind": "onset_peak"})
    cands.sort(key=lambda c: c["intensity"], reverse=True)
    strong = []
    for c in cands:
        if c["intensity"] < 0.45 or len(strong) >= 64:
            continue
        if all(abs(c["time"] - s["time"]) >= 0.18 for s in strong):
            strong.append(c)
    strong.sort(key=lambda c: c["time"])

    step = 0.5
    energy = [r(float(np.mean(rms_db[int(t * fps):int((t + step) * fps) + 1])), 1)
              for t in np.arange(0, duration, step)]

    data = {
        "schemaVersion": 2,
        "source": {"filename": path.name, "trackStem": path.stem},
        "duration": r(duration),
        "tempo": r(60.0 / beat_period if beat_period else tempo, 2),
        "beatSeconds": r(beat_period, 4),
        "beatsPerBar": int(bpb),
        "beatSource": beat_source,
        "barSeconds": r(bar, 4),
        "beatRegularity": r(regularity, 3),
        "downbeatConfidence": db_conf,
        "downbeatPhaseScores": phase_scores,
        "loudness": ffmpeg_loudness(path),
        "musicStart": r(music_start),
        "arrival": r(arrival),
        "ending": ending,
        "sections": sections,
        "lifts": [s["start"] for s in sections if s["lift"]],
        "phrases": phrases,
        "downbeats": [r(d, 4) for d in downbeats],
        "beats": beats,
        "strongCues": strong,
        "energy": {"step": step, "unit": "dBFS RMS", "values": energy},
        "analysis": {"sampleRate": SR, "hopLength": HOP, "windowStart": 0.0, "windowDuration": window,
                     "tool": "video-studio analyze_music.py"},
    }
    return data


def markdown(data, cuts=None):
    def t(x):
        m, s = divmod(float(x), 60)
        return "%d:%05.2f" % (m, s)

    lines = ["# Music map: %s" % data["source"]["trackStem"], "",
             "- File: `%s`" % data["source"]["filename"],
             "- Length: %s · tempo %.1f BPM · beat %.3fs · bar %.3fs (%d/4)" % (
                 t(data["duration"]), data["tempo"], data["beatSeconds"], data["barSeconds"], data["beatsPerBar"]),
]
    if data.get("loudness"):
        L = data["loudness"]
        lines.append("- Loudness: %s LUFS integrated, %s dBTP peak, LRA %s LU" % (
            L.get("integratedLufs"), L.get("truePeakDbtp"), L.get("lra")))
    trust = []
    if data.get("beatSource") == "madmom":
        trust.append("beats and bar lines from a trained downbeat model (madmom)")
    elif data["downbeatConfidence"] < 0.15:
        trust.append("bar lines are a guess (downbeat confidence %.2f): cut on beats and section starts, "
                     "and check a bar line by snapshot before locking a big reveal to it" % data["downbeatConfidence"])
    else:
        trust.append("bar lines estimated without a model (confidence %.2f)" % data["downbeatConfidence"])
    if data["beatRegularity"] > 0.08:
        trust.append("tempo drifts (regularity %.3f): treat the grid as approximate and favour phrase starts" % data["beatRegularity"])
    lines.append("- Trust: " + "; ".join(trust))
    lines += ["- Sound starts %s; full energy arrives %s" % (t(data["musicStart"]), t(data["arrival"])),
              "- Ending: **%s**: last hit %s, silence by %s (rings %.2fs)" % (
                  data["ending"]["type"], t(data["ending"]["finalHit"]), t(data["ending"]["lastSound"]),
                  data["ending"]["ringOut"]), "", "## Sections", "",
              "| # | Start | End | Bars | Energy | Label | Rise |", "|---|---|---|---|---|---|---|"]
    for i, s in enumerate(data["sections"], 1):
        lines.append("| %d | %s | %s | %d | %s | %s%s | %+.1f dB |" % (
            i, t(s["start"]), t(s["end"]), s["bars"], "●" * s["energy"] + "○" * (5 - s["energy"]),
            s["label"], " **LIFT**" if s["lift"] else "", s["riseDb"]))
    lines += ["", "## Lifts (land reveals here)", "",
              ", ".join("%.2fs" % x for x in data["lifts"]) or "none (energy is flat; use phrase starts)", "",
              "## Phrase starts (natural edit points, every 4 bars)", "",
              ", ".join("%.2f" % x for x in data["phrases"][:60]), ""]
    if cuts:
        lines += ["## Ready-made cuts (scripts/fit_music.py)", "",
                  "| Video length | Mode | Start in track | Lift lands at | Final hit or stop | Notes |",
                  "|---|---|---|---|---|---|"]
        for c in cuts:
            lines.append("| %ss | %s | %.2fs | %s | %s | %s |" % (
                c["duration"], c["mode"], c["start"],
                ", ".join("%.2fs" % x for x in c["lifts"][:2]) or "—",
                "%.2fs" % c["lastDownbeat"] if c.get("lastDownbeat") is not None else "—",
                "; ".join(c["notes"])))
        lines.append("")
    lines += ["## How to use", "",
              "Cut the bed with `scripts/fit_music.py` (it reads this map), then time picture to the "
              "bar lines it prints in video time. Big reveals land on a lift or a downbeat within ±0.10s; "
              "readable text never changes faster than its reading time just to hit a beat.", ""]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("input", type=Path)
    ap.add_argument("--output-json", type=Path, required=True)
    ap.add_argument("--output-md", type=Path)
    ap.add_argument("--no-cuts", action="store_true", help="skip the ready-made cuts table")
    ap.add_argument("--from-json", action="store_true", help="rebuild the Markdown from an existing --output-json")
    a = ap.parse_args()
    if a.from_json:
        data = json.loads(a.output_json.read_text(encoding="utf-8"))
    else:
        data = analyze(a.input)
        a.output_json.parent.mkdir(parents=True, exist_ok=True)
        a.output_json.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
    if a.output_md:
        cuts = None
        if not a.no_cuts:
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            import fit_music  # noqa: E402
            cuts = []
            for d in (15, 20, 30, 45, 60):
                for mode in ("natural", "button"):
                    try:
                        p = fit_music.plan_cut(data, d, mode)
                        cuts.append(p)
                    except fit_music.CutError:
                        pass
        a.output_md.parent.mkdir(parents=True, exist_ok=True)
        a.output_md.write_text(markdown(data, cuts), encoding="utf-8")
    print("%s: %.1f BPM, bar %.2fs, %d sections, lifts %s, ending %s at %.2fs" % (
        a.input.name, data["tempo"], data["barSeconds"], len(data["sections"]),
        [round(x, 1) for x in data["lifts"]], data["ending"]["type"], data["ending"]["finalHit"]))


if __name__ == "__main__":
    main()
