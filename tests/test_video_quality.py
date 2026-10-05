"""Video Studio: the look (after "the quality is way too bad").

The first videos looked like slides: small words on flat colour, photos as
small squares under a caption, a bare end card. The scenes now follow the
/brag ads: the hook over a full-bleed photo on a brand-tinted scrim, words
rising from behind their own masks, the key words in the accent colour, big
photo panels, and an end card with the logo, the offer, facts as chips,
product photos and a button. The planner chooses photos, emphasis and chips
for them, and Claude's review works to that bar.
"""

import io
import os
import re
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))

from tracker import video_app, video_build, video_config, video_plan, video_scenes  # noqa: E402
from tracker.video_site import contrast  # noqa: E402

BRAND = {"colors": {"background": "#ffffff", "text": "#030302", "accent": "#004a2b", "on_accent": "#ffffff",
                    "muted": "#6b6964"}, "fonts": {"heading": "Poppins", "body": "Poppins"}, "logo_asset": 7}


def _png(colour, size=(600, 300), alpha=True):
    im = Image.new("RGBA" if alpha else "RGB", size, (0, 0, 0, 0) if alpha else (255, 255, 255))
    for x in range(100, 500):
        for y in range(100, 200):
            im.putpixel((x, y), colour)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def _assets():
    photo = io.BytesIO()
    Image.new("RGB", (1600, 1000), (40, 90, 60)).save(photo, "JPEG")
    out = {k: {"bytes": photo.getvalue(), "mime": "image/jpeg", "width": 1600, "height": 1000, "kind": "image"}
           for k in (1, 2, 3, 4)}
    out[7] = {"bytes": _png((255, 255, 255, 255)), "mime": "image/png", "width": 600, "height": 300, "kind": "logo"}
    return out


def _scene(kind, **kw):
    s = {"type": kind, "seconds": 3, "headline": "Every gift from the forest has three shares", "subline": "",
         "items": [], "asset_ids": [], "emphasis": "three shares", "number": "", "attribution": ""}
    s.update(kw)
    return s


def _compose(scenes, shape="vertical"):
    out = video_build.compose({"scenes": scenes, "cover_scene": 0}, BRAND, shape, assets=_assets(), tables={})
    return out["files"]["index.html"].decode()


# ── Words ─────────────────────────────────────────────────────────────────────
def test_key_words_are_marked_and_every_word_rises_from_its_own_mask():
    html = video_scenes.words("Corporate hampers from ₹999.", emphasis="from ₹999")
    assert html.count('class="w"') == 2 and html.count('class="w em"') == 2
    assert html.count('<span class="wi" data-layout-allow-overlap>') == 4
    assert video_scenes.words("One for the forest.", emphasis="Forest").count(" em") == 1   # case and stop ignored
    assert " em" not in video_scenes.words("One for the forest.", emphasis="the people")   # not in the line: none
    js = video_scenes._words_in("#s1 .head .w", 1.0, 4)
    assert '"#s1 .head .w > .wi"' in js and "yPercent: 115" in js


def test_the_page_masks_words_and_colours_the_key_ones():
    html = _compose([_scene("title")])
    assert ".w { display: inline-block; overflow: hidden;" in html and ".em { color: var(--hl); }" in html
    assert ".em { font-style: italic; }" not in html                     # Poppins has no italic
    serif = dict(BRAND, fonts={"heading": "Fraunces", "body": "Inter"})
    out = video_build.compose({"scenes": [_scene("title")], "cover_scene": 0}, serif, "vertical", assets=_assets(),
                              tables={})
    assert ".em { font-style: italic; }" in out["files"]["index.html"].decode()


# ── Colour ────────────────────────────────────────────────────────────────────
def test_the_dark_surface_is_brand_tinted_and_the_accent_reads_on_it():
    for accent, text in (("#004a2b", "#030302"), ("#2f5bea", "#111111"), ("#ffd400", "#1c1a16"),
                         ("#ffffff", "#222222"), ("#ff6022", "#000000")):
        deep = video_scenes.deep_colour(accent, text)
        hl = video_scenes.light_accent(accent, deep)
        assert contrast("#ffffff", deep) >= 12 and contrast(hl, deep) >= 5, (accent, deep, hl)
    deep = video_scenes.deep_colour("#004a2b", "#030302")
    r, g, b = int(deep[1:3], 16), int(deep[3:5], 16), int(deep[5:7], 16)
    assert g > r and g > b                                                # green-tinted, not plain black


# ── Scenes ────────────────────────────────────────────────────────────────────
def test_the_hook_sits_over_a_full_bleed_photo_with_a_scrim():
    html = _compose([_scene("title", asset_ids=[1])])
    assert 'class="bdi"' in html and "media/a1.jpg" in html and 'class="scrim"' in html
    assert re.search(r"#s1 \{ --bgc: #[0-9a-f]{6}; --fg: #ffffff;", html)
    assert 'tl.fromTo("#s1 .bdi", { scale: 1.14 }' in html                  # the slow push-in
    plain = _compose([_scene("title")])
    assert 'class="bdi"' not in plain and "--fg: #ffffff" in plain        # without one: the deep surface


def test_photos_are_big_panels_on_tall_shapes_and_full_bleed_on_wide_ones():
    tall = _compose([_scene("image", asset_ids=[2], headline="One for the forest.", emphasis="forest.")])
    assert 'class="photo"' in tall and 'class="bdi"' not in tall
    height = int(re.search(r"#s1 \.photo \{[^}]*height: (\d+)px", tall).group(1))
    assert height > 1920 * 0.45                                          # most of the frame, not a thumbnail
    wide = _compose([_scene("image", asset_ids=[2], headline="One for the forest.")], "landscape")
    assert 'class="bdi"' in wide and 'class="photo"' not in wide


def test_the_end_card_has_the_logo_the_offer_chips_photos_and_a_button():
    s = _scene("end_card", headline="Corporate gift hampers from ₹999", emphasis="from ₹999",
               subline="Get a bulk quote", items=[{"label": "12 ready-made hampers", "detail": ""},
                                                  {"label": "Dispatched in 15 days", "detail": ""}],
               asset_ids=[1, 2, 3])
    html = _compose([_scene("title"), s])
    assert html.count('class="chip"') == 2 and html.count('class="th"') == 3
    assert '<span class="btn">Get a bulk quote<b>&rarr;</b></span>' in html
    # The white logo would vanish on the white page: it is drawn through a mask in the text colour.
    assert 'class="logo mask"' in html and "background: #030302" in html
    square = _compose([_scene("title"), dict(s, items=s["items"] + [{"label": "Handmade by Adivasi women", "detail": ""}])],
                      "square")
    assert square.count('class="th"') == 0                               # no room: the photos go, not the words


def test_a_light_logo_is_told_from_a_dark_one():
    assert video_build.logo_is_light(_png((255, 255, 255, 255)))
    assert not video_build.logo_is_light(_png((20, 40, 30, 255)))
    assert not video_build.logo_is_light(_png((255, 255, 255, 255), alpha=False))   # opaque box: shown as is
    assert not video_build.logo_is_light(b"not an image")


# ── The planner and the review ────────────────────────────────────────────────
def _sources():
    return {"assets": [{"id": 1, "kind": "image", "name": "forest"}, {"id": 2, "kind": "screenshot", "name": "site"},
                       {"id": 3, "kind": "image", "name": "hamper"}, {"id": 4, "kind": "image", "name": "box"},
                       {"id": 5, "kind": "image", "name": "jar"}]}


def _plan(scenes):
    return {"scenes": scenes, "cover_scene": 0, "share_copy": {}}


def test_the_planner_asks_for_photos_emphasis_and_a_real_close():
    system = video_plan._system()
    assert "not a slide deck" in system and "emphasis:" in system and "as a button" in system
    scene_props = video_plan.SCHEMA["properties"]["scenes"]["items"]
    assert "emphasis" in scene_props["required"] and "emphasis" in scene_props["properties"]
    assert video_plan.MAX_IMAGES >= 16
    cleaned = video_plan.clean({"scenes": [_scene("title", asset_ids=[1])]})
    assert cleaned["scenes"][0]["emphasis"] == "three shares"


def test_the_plan_check_holds_photos_and_emphasis_to_their_limits():
    choices = {"seconds": 9}
    ok = _plan([_scene("title", asset_ids=[1]), _scene("image", headline="One for the forest.", asset_ids=[3]),
                _scene("end_card", headline="Hampers for your team", emphasis="your team", subline="Get a quote",
                       items=[{"label": "Twelve hampers", "detail": ""}], asset_ids=[3, 4, 5])])
    assert video_plan.check(ok, choices, _sources(), "brief") == []
    bad = _plan([_scene("title", asset_ids=[2], emphasis="Every gift from the forest has"), _scene("words"),
                 _scene("end_card", headline="Hampers", subline="Get a quote", asset_ids=[1, 3, 4, 5])])
    problems = " ".join(video_plan.check(bad, choices, _sources(), "brief"))
    assert "is a screenshot; this scene shows photos only" in problems
    assert "the emphasis has 6 words; at most 4" in problems and "at most 3 picture(s)" in problems


def test_the_editor_offers_the_highlight_and_photos_where_they_now_go():
    f = video_app.scene_fields()
    assert f["title"]["emphasis"] and f["image"]["emphasis"] and not f["quote"]["emphasis"]
    assert f["title"]["pictures"]["max"] == 1 and f["end_card"]["pictures"]["max"] == 3
    assert f["end_card"]["item_words"] == ["Fact", ""] or f["end_card"]["item_words"] == ("Fact", "")
    assert f["end_card"]["head_words"][1].startswith("Button")


def test_the_review_aims_for_an_ad_not_a_slide():
    from tracker import video_agent
    s = video_agent.SYSTEM % {"fixes": video_agent.MAX_FIX_ROUNDS, "calls": video_agent.MAX_TOOL_CALLS}
    assert "not a slide deck" in s and "data-layout-allow-overlap" in s and "Never change the words" in s
    assert video_agent.MAX_FIX_ROUNDS >= 3
