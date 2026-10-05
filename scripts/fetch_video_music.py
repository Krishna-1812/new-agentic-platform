"""Fetch Video Studio's bundled music beds into tracker/video_kit/music/, and
write the manifest tracker/video_kit/music.json that tracker/video_music.py
reads.

The render browser has no network, so every track a video can use is bundled.
All tracks are by Sascha Ende (ende.app), licensed CC BY 4.0: free for any use,
commercial ads included. His FAQ makes the credit voluntary; Video Studio still
shows it on the video page.

    python scripts/fetch_video_music.py

Each track is cut to a 62-second bed (videos are at most 60 seconds), starting
after its quiet intro so the music is there from the first frame, and its
loudness is evened out (-16 LUFS integrated, -1.5 dB true peak), so every mood
plays at the same level. Needs ffmpeg.
"""

import json
import os
import subprocess
import tempfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KIT = os.path.join(ROOT, "tracker", "video_kit")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"
SECONDS = 62
LUFS, TRUE_PEAK = -16, -1.5

# (key, label, what it suits, styles it is the default for, title, song id, file, start s)
TRACKS = [
    ("warm", "Warm and calm", "Brand stories, crafts, food, places: steady acoustic guitars",
     ("Calm",), "Ambient Acoustic Guitars Vol. 6", 13338, "5f5952d2-4633-4959-8eb2-161c6842609d.mp3", 1),
    ("uplifting", "Uplifting", "Launches, offers and good news: bright, positive pop",
     ("Polished",), "Insert More Positive Emotion Here", 13599, "1097ace4-0561-4fa4-b945-61d47964d0d3.mp3", 1),
    ("corporate", "Corporate", "Company films, results, B2B: confident and measured",
     ("Corporate",), "Imagefilm 046", 12239, "ipSKJ7Gj5LonO7EUehRD7FpdTzBy6r6SNNS8W32L.mp3", 2),
    ("upbeat", "Upbeat business", "Short ads and promos: driving, cheerful beat",
     (), "Happy Beats & Business Moves Vol. 1", 12866, "a505103c-c170-473b-ac9e-51edb11a19d3.mp3", 0),
    ("bold", "Bold and energetic", "Hard-cut, high-energy ads: tropical house",
     ("Bold",), "Tropical Island House 2026", 13785, "85fe0d08-94cb-43ac-8c1f-a9b2b9e02f37.mp3", 2),
    ("playful", "Playful", "Light, fun and friendly: sunny and bouncy",
     ("Playful",), "Total Happy Up And Sunny", 555,
     "b139aa54c4205a5c0c9516206fd0c8ea7a9517e6c2cdf77ac5bd86448c5ede5d.mp3", 2),
    ("cinematic", "Cinematic", "Big moments, full-bleed pictures: rising orchestral",
     ("Cinematic",), "Journey Of The Brave", 12233, "FjqiQw4G8HBWwhm5KGLrr3B2CkD7NWdhOFpOz7vP.mp3", 1),
    ("documentary", "Documentary", "Impact, people and causes: thoughtful and hopeful",
     (), "Documentary Music - Small Signs of Change", 13867, "10b60b5b-3ff0-44e6-8fbf-0c6426e6fc10.mp3", 6),
    ("minimal", "Minimal", "Quiet product and how-to videos: soft and spacious",
     ("Minimal",), "Podcast Music Vol. 24 [Morning Light]", 13188, "9b9fadfb-5a19-4dcf-bfcf-a929000b5644.mp3", 0),
]
SOURCE = "https://ende.app/storage/mp3low/"


def fetch(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as fh:
        fh.write(r.read())


def main():
    out_dir = os.path.join(KIT, "music")
    os.makedirs(out_dir, exist_ok=True)
    manifest = {"source": "Sascha Ende, ende.app", "licence": "CC BY 4.0 (creativecommons.org/licenses/by/4.0)",
                "loudness": "%d LUFS, %.1f dBTP" % (LUFS, TRUE_PEAK), "seconds": SECONDS, "tracks": []}
    with tempfile.TemporaryDirectory() as tmp:
        for key, label, suits, styles, title, song, name, start in TRACKS:
            src = os.path.join(tmp, name)
            fetch(SOURCE + name, src)
            dest = os.path.join(out_dir, key + ".mp3")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-t", str(SECONDS), "-i", src,
                            "-af", "loudnorm=I=%d:TP=%s:LRA=11" % (LUFS, TRUE_PEAK), "-ar", "44100", "-ac", "2",
                            "-c:a", "libmp3lame", "-b:a", "160k", dest], check=True)
            manifest["tracks"].append({
                "key": key, "label": label, "suits": suits, "styles": list(styles), "file": "music/%s.mp3" % key,
                "title": title, "by": "Sascha Ende", "url": "https://ende.app/en/song/%d" % song,
                "credit": "Music: \"%s\" by Sascha Ende (ende.app), CC BY 4.0" % title,
                "bytes": os.path.getsize(dest)})
            print("%-12s %-45s %d KB" % (key, title, os.path.getsize(dest) // 1024))
    with open(os.path.join(KIT, "music.json"), "w") as fh:
        json.dump(manifest, fh, indent=1, ensure_ascii=False)
        fh.write("\n")


if __name__ == "__main__":
    main()
