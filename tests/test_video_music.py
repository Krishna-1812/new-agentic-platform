"""Video Studio: the music bed (asked for after the look was redone).

Nine bundled CC BY 4.0 tracks by Sascha Ende (ende.app), one per mood, cut to
62-second beds and evened out to -16 LUFS. The planner picks a mood; the
person can change it or turn it off and listen first; the composition carries
one <audio id="music"> that fades in and out; the video page shows the credit.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from test_video_app import (ANA, BASE, _build_next, _plan_next, _post, _render_next, _results_video,  # noqa: E402
                            client, store)  # noqa: F401

from tracker import video_app, video_build, video_config, video_music, video_plan  # noqa: E402


def test_nine_moods_are_bundled_with_their_credit():
    m = video_music.manifest()
    assert m["licence"].startswith("CC BY 4.0") and len(m["tracks"]) == 9
    assert {"warm", "uplifting", "corporate", "cinematic", "minimal"} <= set(video_music.keys())
    for t in m["tracks"]:
        path = os.path.join(video_config.kit_dir(), t["file"])
        assert os.path.getsize(path) == t["bytes"] and 500_000 < t["bytes"] < 2_000_000
        assert t["credit"].startswith('Music: "%s" by Sascha Ende' % t["title"]) and t["url"].startswith("https://ende.app/")
    styles = [s for t in m["tracks"] for s in t["styles"]]
    assert len(styles) == len(set(styles))                                    # one default per style
    assert video_music.for_style("Calm") == "warm" and video_music.for_style("Something else") == "uplifting"


def test_the_bed_fades_in_and_out_on_the_volume_lane():
    html = video_music.audio_html("warm", 15)
    assert html.startswith('<audio id="music" src="kit/music/warm.mp3" data-start="0" data-duration="15"')
    lane = json.loads(html.split("data-automation='")[1].split("'")[0])
    points = lane["lanes"][0]["points"]
    assert lane["lanes"][0]["target"] == "volume" and points[0] == {"t": 0, "v": 0} and points[-1] == {"t": 15, "v": 0}
    assert points[1] == {"t": video_music.FADE_IN_S, "v": 1} and points[2]["t"] == 15 - video_music.FADE_OUT_S
    assert video_music.audio_html("none", 15) == "" and video_music.audio_html(None, 15) == ""
    assert video_music.audio_html("no-such-mood", 15) == ""


def _plan(**extra):
    s = {"type": "words", "seconds": 4, "headline": "Hello there", "subline": "", "items": [], "asset_ids": []}
    return dict({"scenes": [s], "cover_scene": 0}, **extra)


def test_the_composition_carries_the_chosen_music_only():
    brand = {"colors": {"background": "#ffffff", "text": "#111111", "accent": "#2f5bea", "on_accent": "#ffffff"},
             "fonts": {"heading": "Inter", "body": "Inter"}}
    with_music = video_build.compose(_plan(music="cinematic"), brand, "square", assets={}, tables={})
    page = with_music["files"]["index.html"].decode()
    assert page.count("<audio ") == 1 and 'src="kit/music/cinematic.mp3"' in page and 'data-duration="4"' in page
    assert not any(p.endswith(".mp3") for p in with_music["files"])        # from the kit, not stored per version
    for silent in (_plan(), _plan(music="none")):                          # an older plan, or turned off
        assert "<audio" not in video_build.compose(silent, brand, "square", assets={}, tables={})["files"]["index.html"].decode()


def test_the_planner_chooses_a_mood_from_the_list():
    assert video_plan.SCHEMA["properties"]["music"]["enum"] == video_music.keys() + ["none"]
    assert "music" in video_plan.SCHEMA["required"]
    system = video_plan._system()
    assert "Calm suits warm" in system and "- documentary:" in system and "- none: no music" in system
    assert video_plan.clean({"scenes": [], "music": "bold"})["music"] == "bold"
    assert video_plan.clean({"scenes": [], "music": "jazz"})["music"] == "none"
    assert video_plan.clean({"scenes": []})["music"] is None


def test_the_person_sees_hears_and_changes_the_music(client, store):
    pid, vid = _results_video(store)
    _plan_next(store)
    plan = client.get(BASE + "/api/videos/%d" % pid).get_json()["video"]["version"]["plan"]
    assert plan["music"] == "uplifting" and [m["key"] for m in plan["music_menu"]] == video_music.keys()
    r = client.get(BASE + "/music/warm.mp3")
    assert r.status_code == 200 and r.mimetype == "audio/mpeg" and len(r.get_data()) > 500_000
    assert client.get(BASE + "/music/nothing.mp3").status_code == 404
    body = {"scenes": plan["scenes"], "share_copy": plan["share_copy"], "cover_scene": 0, "music": "none"}
    assert _post(client, BASE + "/api/versions/%d/plan" % vid, body).status_code == 200
    assert store.get_version(vid)["plan"]["music"] == "none"
    body["music"] = "warm"
    _post(client, BASE + "/api/versions/%d/plan" % vid, body)
    assert store.get_version(vid)["plan"]["music"] == "warm"


def test_the_finished_video_names_its_music(store):
    pid, vid = _results_video(store)
    _plan_next(store)
    from tracker import video_builder
    video_builder.approve(ANA, vid)
    _build_next(store)
    _render_next(store)
    music = video_app.project_view(ANA, pid)["version"]["result"]["music"]
    assert music["key"] == "uplifting" and "Sascha Ende" in music["credit"] and music["url"].startswith("https://ende.app/")
    files = store.get_version(vid, files=True)["files"]
    assert 'src="kit/music/uplifting.mp3"' in files["index.html"]["text"]


def test_the_review_keeps_the_music():
    from tracker import video_agent
    assert '<audio id="music">' in video_agent.SYSTEM and "person chose that music" in video_agent.SYSTEM
