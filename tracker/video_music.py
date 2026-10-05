"""Video Studio: the music bed under a video.

Nine bundled tracks, one per mood (tracker/video_kit/music, listed in
music.json, fetched by scripts/fetch_video_music.py): all by Sascha Ende
(ende.app), CC BY 4.0, cut to 62-second beds that start after any quiet intro
and evened out to -16 LUFS, so every mood plays at the same level.

The plan's "music" is a track's key or "none". The planner picks the mood; a
plan made before music existed (no "music" at all) stays silent. The bed starts
with the video, fades in over a few tenths of a second and fades out over its
last moments, through HyperFrames' volume lane.
"""

from __future__ import annotations

import functools
import json
import os

from tracker import video_config as cfg

NONE = "none"
FADE_IN_S = 0.3
FADE_OUT_S = 1.2


@functools.lru_cache(maxsize=1)
def manifest():
    with open(os.path.join(cfg.kit_dir(), "music.json")) as fh:
        return json.load(fh)


def tracks():
    return manifest()["tracks"]


def keys():
    return [t["key"] for t in tracks()]


def track(key):
    return next((t for t in tracks() if t["key"] == key), None)


def for_style(style):
    """The mood a style suggests (Calm -> warm), else uplifting."""
    return next((t["key"] for t in tracks() if style in t["styles"]), "uplifting")


def audio_html(key, duration):
    """The <audio> element for a plan's music, or "" for none."""
    t = track(key)
    if not t or duration <= 0:
        return ""
    d = round(float(duration), 3)
    fade_out = min(FADE_OUT_S, d / 4)
    points = [{"t": 0, "v": 0}, {"t": FADE_IN_S, "v": 1}, {"t": round(d - fade_out, 3), "v": 1}, {"t": d, "v": 0}]
    lane = json.dumps({"version": 1, "lanes": [{"target": "volume", "points": points}]}, separators=(",", ":"))
    return ('<audio id="music" src="kit/%s" data-start="0" data-duration="%s" data-track-index="10" '
            "data-automation='%s'></audio>" % (t["file"], ("%.3f" % d).rstrip("0").rstrip("."), lane))


def view(key):
    """What the pages show about a plan's music."""
    t = track(key)
    if not t:
        return None
    return {"key": t["key"], "label": t["label"], "title": t["title"], "credit": t["credit"], "url": t["url"]}


def menu():
    return [{"key": t["key"], "label": t["label"], "suits": t["suits"]} for t in tracks()]
