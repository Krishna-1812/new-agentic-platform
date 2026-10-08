#!/usr/bin/env python3
"""Maintainer tool: write assets/music/library.json and LIBRARY.md from the track list below and
the maps in assets/music/analysis/. Run after adding a track (prepare_track.py, then analyze_music.py).

    python scripts/build_library.py
"""

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MUSIC = os.path.join(ROOT, "assets", "music")

# id, title, moods, energy 1-5, good under a voice, character, best for, tones
TRACKS = [
    ("upbeat-business-1", "Happy Beats & Business Moves Vol. 1", ["upbeat", "cheerful", "driving"], 4, False,
     "Driving, cheerful pop-funk groove. Full energy from the first bar; a 4-bar breakdown at 0:32 drops back in at 0:40.",
     "Launch videos, promos, product demos with energy, the /brag default.", ["default", "app-store", "chaotic"]),
    ("laidback-business-9", "Happy Beats & Business Moves Vol. 9", ["upbeat", "laid-back", "friendly"], 3, False,
     "Mid-energy, slightly laid-back groove. Relaxed confidence; ends on a clean final hit.",
     "Friendly product tours, founder updates, deadpan startup parody.", ["default", "yc-parody"]),
    ("punchy-business-10", "Happy Beats & Business Moves Vol. 10", ["punchy", "upbeat", "compact"], 4, False,
     "A compact one-minute cue: punchy from bar one, with its own ending at 0:59. Built for short ads.",
     "15-30s social ads and hype reels; back-time it and the ending is already there.", ["default", "chaotic"]),
    ("warm-business-11", "Happy Beats & Business Moves Vol. 11", ["warm", "business", "positive"], 3, False,
     "Warm, business-like, positive. Even energy throughout; a clean ending at 1:26.",
     "B2B explainers, app-store style feature tours, parody launches played straight.", ["yc-parody", "app-store"]),
    ("steady-business-12", "Happy Beats & Business Moves Vol. 12", ["steady", "clean", "confident"], 3, True,
     "Steady and clean, with a 9-second intro before the groove arrives. Sits well under words.",
     "Polished product films, calm launches, very low under deadpan pieces.", ["polished", "deadpan", "cinematic"]),
    ("uplifting-pop", "Insert More Positive Emotion Here", ["uplifting", "bright", "positive"], 4, False,
     "Bright, positive pop. An 8-second intro, then a lift on the bar at 0:08 (a ready-made hook-to-reveal).",
     "Launches, offers, good news, celebrations, recruiting.", ["default", "app-store", "polished"]),
    ("corporate-imagefilm", "Imagefilm 046", ["corporate", "confident", "measured"], 3, True,
     "Confident, measured corporate score with clear 8-bar phrases and lifts at 1:34, 1:58 and 2:22.",
     "Company films, results and case studies, B2B, investor updates.", ["polished", "app-store", "yc-parody"]),
    ("bold-tropical-house", "Tropical Island House 2026", ["bold", "energetic", "house"], 5, False,
     "Tropical house at 100 BPM. Quieter opening, then the drop at 0:36; hard-cut friendly.",
     "High-energy ads, events, fashion, food and travel promos, fast social cuts.", ["chaotic", "default"]),
    ("playful-sunny", "Total Happy Up And Sunny", ["playful", "sunny", "bouncy"], 4, False,
     "Sunny, bouncy and light. A short intro, then a lift at 0:13.",
     "Consumer apps, kids and family, food, anything light and friendly.", ["default", "app-store"]),
    ("cinematic-brave", "Journey Of The Brave", ["cinematic", "orchestral", "rising"], 4, False,
     "Rising orchestral score at 75 BPM. It drops to almost nothing at 1:19 and rebuilds (lifts at 1:25 and "
     "1:35) to a big final hit at 2:26.",
     "Trailers, big claims, launches played epic, brand anthems.", ["cinematic", "polished"]),
    ("documentary-hopeful", "Documentary Music - Small Signs of Change", ["documentary", "hopeful", "thoughtful"], 2,
     True, "Thoughtful, hopeful documentary bed at 82 BPM. Gentle growth, no hard hits; fades out at the end.",
     "Impact stories, people and causes, testimonials, case studies with a voice.", ["polished", "deadpan"]),
    ("minimal-morning-light", "Podcast Music Vol. 24 [Morning Light]", ["minimal", "soft", "spacious"], 2, True,
     "Soft, spacious and unobtrusive. Leaves the middle of the spectrum free for a voice.",
     "How-to and tutorial videos, narrated explainers, quiet product walkthroughs.", ["deadpan", "polished"]),
    ("warm-acoustic", "Ambient Acoustic Guitars Vol. 6", ["warm", "calm", "acoustic"], 2, True,
     "Warm, steady acoustic guitars at 78 BPM. Human and unhurried; grows at 0:55.",
     "Brand stories, craft, food, hospitality, places, founders talking.", ["polished", "deadpan"]),
]


def summary(m):
    lifts = ", ".join("%d:%02d" % divmod(int(round(x)), 60) for x in m["lifts"]) or "none"
    end = m["ending"]
    return {"tempo": m["tempo"], "barSeconds": m["barSeconds"], "duration": m["duration"],
            "intro": m["arrival"], "lifts": m["lifts"], "ending": end["type"], "finalHit": end["finalHit"],
            "beatSource": m.get("beatSource"), "text": "%.0f BPM, bar %.2fs, lifts %s, ends with a %s at %d:%02d" % (
                m["tempo"], m["barSeconds"], lifts, "final hit" if end["type"] == "hit" else "fade-out",
                *divmod(int(round(end["finalHit"])), 60))}


def main():
    out = {"artist": "Sascha Ende", "source": "https://ende.app",
           "license": "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)",
           "licenseNote": "Commercial use, ads included. Credit the track; see CREDITS.md.",
           "loudness": "about -16 LUFS integrated, true peak below -1.5 dBTP (linear, dynamics kept)",
           "tracks": []}
    for tid, title, moods, energy, voice, character, best, tones in TRACKS:
        with open(os.path.join(MUSIC, "analysis", tid + ".music.json"), encoding="utf-8") as fh:
            m = json.load(fh)
        out["tracks"].append({
            "id": tid, "file": "assets/music/%s.mp3" % tid, "map": "assets/music/analysis/%s.music.json" % tid,
            "mapSummary": "assets/music/analysis/%s.music.md" % tid, "title": title, "moods": moods,
            "energy": energy, "goodUnderVoice": voice, "character": character, "bestFor": best, "tones": tones,
            "credit": 'Music: "%s" by Sascha Ende (ende.app), CC BY 4.0' % title, **summary(m)})
    with open(os.path.join(MUSIC, "library.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    lines = ["# Music library", "", "13 full-length tracks by Sascha Ende (ende.app), CC BY 4.0: commercial use, "
             "ads included, with a credit. All prepared to the same loudness, so one bed level works for all. "
             "Each has a map in `analysis/` (bars, sections, lifts, ending, ready-made cuts).", "",
             "| Track | Moods | Energy | Under a voice | Shape | Best for |", "|---|---|---|---|---|---|"]
    for t in out["tracks"]:
        lines.append("| `%s`<br>%s | %s | %s | %s | %s | %s |" % (
            t["id"], t["title"], ", ".join(t["moods"]), "●" * t["energy"] + "○" * (5 - t["energy"]),
            "yes" if t["goodUnderVoice"] else "light VO only", t["text"], t["bestFor"]))
    lines += ["", "Character notes:", ""] + ["- `%s`: %s" % (t["id"], t["character"]) for t in out["tracks"]] + [""]
    with open(os.path.join(MUSIC, "LIBRARY.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    print("library: %d tracks" % len(out["tracks"]))


if __name__ == "__main__":
    main()
