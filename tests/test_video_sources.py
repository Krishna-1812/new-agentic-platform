"""Video Studio, Phase 2: the sources and the brand.

Uploads (images re-encoded and cleaned, text, numbers), the bundled fonts and
how a brand's fonts map onto them, the brand's order of precedence and its
colour checks, the starting points and choices, and the website reader with
a stand-in browser (page choice, site chrome, crops, colours, blocked sites).
"""

import io
import json
import os

import pytest
from PIL import Image

from tracker import (video_brand, video_config, video_fonts, video_site, video_starts, video_uploads,
                     watch_capture, watch_safety)


def _img(fmt="PNG", size=(64, 48), mode="RGB", **save):
    im = Image.new(mode, size, (200, 100, 50) if mode == "RGB" else (200, 100, 50, 128))
    buf = io.BytesIO()
    im.save(buf, fmt, **save)
    return buf.getvalue()


# ── Uploads ──────────────────────────────────────────────────────────────────
def test_images_are_re_encoded_without_their_hidden_data():
    exif = Image.Exif()
    exif[0x010F] = "SecretCam"                          # camera make
    jpeg = _img("JPEG", exif=exif.tobytes())
    out = video_uploads.image(jpeg, "photo.jpg")
    assert out["mime"] == "image/jpeg" and (out["width"], out["height"]) == (64, 48)
    assert b"SecretCam" not in out["bytes"]
    assert Image.open(io.BytesIO(out["bytes"])).getexif().get(0x010F) is None
    png = video_uploads.image(_img("PNG", mode="RGBA"), "logo.png")
    assert png["mime"] == "image/png"                   # transparency kept
    gif = video_uploads.image(_img("GIF"), "a.gif")
    assert gif["mime"] == "image/jpeg"


def test_large_images_are_scaled_down():
    out = video_uploads.image(_img("PNG", size=(4000, 1000)), "wide.png")
    assert max(out["width"], out["height"]) == video_uploads.MAX_SIDE


@pytest.mark.parametrize("data", [b"", b"not an image at all", b"%PDF-1.4 fake",
                                  b"<svg xmlns='http://www.w3.org/2000/svg'></svg>"])
def test_what_is_not_an_image_is_refused(data):
    with pytest.raises(video_uploads.Bad):
        video_uploads.image(data, "x")


def test_oversized_files_and_pixel_bombs_are_refused(monkeypatch):
    with pytest.raises(video_uploads.Bad, match="larger than"):
        video_uploads.image(b"x" * (video_uploads.UPLOAD_MAX_BYTES + 1), "big.png")
    monkeypatch.setattr(video_uploads, "MAX_PIXELS", 1000)
    with pytest.raises(video_uploads.Bad, match="pixels"):
        video_uploads.image(_img("PNG", size=(100, 100)), "bomb.png")


def test_text_is_kept_as_given_within_limits():
    assert video_uploads.text("  Line one\r\nLine two \x00 ") == "Line one\nLine two"
    with pytest.raises(video_uploads.Bad):
        video_uploads.text("   ")
    with pytest.raises(video_uploads.Bad):
        video_uploads.text("x" * (video_uploads.MAX_TEXT + 1))


@pytest.mark.parametrize("cell,value", [("42%", 42.0), ("₹1,549", 1549.0), ("-18.5", -18.5), ("$1,200.50", 1200.5),
                                        ("1,20,000", 120000.0), ("3k", 3.0), ("Jan", None), ("", None),
                                        ("12 days", None), ("−7", -7.0)])
def test_numbers_are_read_from_cells(cell, value):
    assert video_uploads.parse_number(cell) == value


def test_tables_from_csv_and_from_a_spreadsheet_paste():
    t = video_uploads.numbers("Month,Leads,Note\nJan,120,ok\nFeb,164,\nMar,151,good\n")
    assert t["columns"] == ["Month", "Leads", "Note"] and t["numeric"] == ["Leads"]
    assert t["values"]["Leads"] == [120.0, 164.0, 151.0]
    pasted = video_uploads.numbers("Metric\tQ2\tQ3\nVisits\t41,200\t58,900\n".encode("utf-8"))
    assert pasted["numeric"] == ["Q2", "Q3"] and pasted["rows"][0] == ["Visits", "41,200", "58,900"]
    semi = video_uploads.numbers("a;b\nx;1\ny;2")
    assert semi["numeric"] == ["b"]


@pytest.mark.parametrize("raw", ["", "just one column\n1\n2", "a,b", "a,b\n" + "x,1\n" * 51,
                                 ",".join("c%d" % i for i in range(13)) + "\n" + ",".join("1" * 13)])
def test_bad_tables_are_refused(raw):
    with pytest.raises(video_uploads.Bad):
        video_uploads.numbers(raw)


# ── Fonts ────────────────────────────────────────────────────────────────────
def test_the_bundled_fonts_are_all_there():
    fams = video_fonts.families()
    assert len(fams) == 21 and "Inter" in fams and "Fraunces" in fams and "JetBrains Mono" in fams
    for f in video_fonts.manifest().values():
        assert {x["subset"] for x in f["faces"]} == {"latin", "latin-ext"}
        for face in f["faces"]:
            assert os.path.exists(os.path.join(video_config.kit_dir(), face["file"]))


@pytest.mark.parametrize("stack,family,swapped", [
    ('"Playfair Display", Georgia, serif', "Playfair Display", False),
    ("Inter var, sans-serif", "Inter", False),
    ("Montserrat-Bold", "Montserrat", False),
    ('SourceSansProBold, Arial, sans-serif', "Source Sans 3", True),
    ('"Helvetica Neue", Helvetica, Arial, sans-serif', "Inter", True),
    ("Georgia, serif", "Merriweather", True),
    ('"Canela Web", serif', "Fraunces", True),
    ("ui-monospace, Menlo, monospace", "JetBrains Mono", True),
    ('"Object Sans", "Adjusted Arial", Tahoma, sans-serif', "Open Sans", True),   # the page's own fallback
    ("MyBrandFont", "Inter", True),
    ("Roboto, Corbel, Avenir", "Roboto", False),
])
def test_brand_fonts_map_onto_the_bundled_set(stack, family, swapped):
    r = video_fonts.resolve(stack)
    assert r["family"] == family and r["swapped"] is swapped


def test_font_css_points_at_the_kit_only():
    css = video_fonts.font_css(["Lora", "Inter", "Not A Font", "Inter"])
    assert css.count('font-family: "Lora"') == 4 and css.count('font-family: "Inter"') == 2
    assert "http" not in css and 'src: url("kit/fonts/' in css and "unicode-range" in css
    assert video_fonts.stack("Lora") == '"Lora", serif' and video_fonts.stack("Inter") == '"Inter", sans-serif'


# ── The brand ────────────────────────────────────────────────────────────────
def test_brand_fields_come_from_the_first_source_that_has_them():
    b = video_brand.resolve({"accent": "#E4572E"}, {"background": "#101820", "text": "#F2F2F2",
                                                    "heading_font": "Lora"},
                            {"background": "#ffffff", "text": "#222222", "accent": "#00AA88",
                             "heading_font": "Roboto", "body_font": "Roboto"}, website_logo_asset=7)
    assert b["colors"]["accent"] == "#e4572e" and b["colors"]["background"] == "#101820"
    assert b["fonts"] == {"heading": "Lora", "body": "Roboto"}
    assert b["source"] == {"colors": "manual", "fonts": "saved", "logo": "website"} and b["logo_asset"] == 7


def test_the_default_brand_and_unreadable_colours_are_fixed():
    d = video_brand.resolve()
    assert d["source"]["colors"] == "default" and d["logo_asset"] is None and d["fonts"]["body"] == "Inter"
    bad = video_brand.resolve({"background": "#ffffff", "text": "#eeeeee", "accent": "#fefefe"})
    assert video_site.contrast(bad["colors"]["background"], bad["colors"]["text"]) >= 4.5
    assert bad["colors"]["accent"] == bad["colors"]["text"]
    assert bad["colors"]["on_accent"] in ("#111111", "#FFFFFF")
    assert video_brand.hex_colour("abc") == "#aabbcc" and video_brand.hex_colour("red") is None


def test_swapped_fonts_are_reported():
    b = video_brand.resolve({"heading_font": "Canela", "body_font": "Inter"})
    assert b["font_swaps"] == [{"asked": "Canela", "used": "Fraunces", "role": "heading"}]


# ── Starting points and choices ──────────────────────────────────────────────
def test_twelve_starting_points_with_custom_the_default():
    starts = video_starts.starting_points()
    assert len(starts) == 12 and starts[-1]["key"] == "custom" and video_starts.DEFAULT == "custom"
    for s in starts:
        assert s["shape"] in video_config.SHAPES and video_config.MIN_SECONDS <= s["seconds"] <= video_config.MAX_SECONDS


def test_choices_fill_from_the_starting_point_and_any_can_be_changed():
    c = video_starts.choices("promo")
    assert (c["shape"], c["seconds"], c["style"]) == ("vertical", 15.0, "Bold")
    c = video_starts.choices("promo", shape="landscape", seconds="45", style="like a 1990s TV advert")
    assert (c["shape"], c["seconds"], c["style"]) == ("landscape", 45.0, "like a 1990s TV advert")
    assert video_starts.choices()["kind"] == "custom"
    exact = video_starts.choices("howto", words="exact", script="One. Two.")
    assert exact["script"] == "One. Two."
    assert video_starts.choices("howto", script="ignored")["script"] == ""


@pytest.mark.parametrize("kw,field", [({"kind": "nope"}, "kind"), ({"shape": "round"}, "shape"),
                                      ({"seconds": 5}, "seconds"), ({"seconds": 61}, "seconds"),
                                      ({"seconds": "ten"}, "seconds"), ({"words": "exact"}, "script"),
                                      ({"words": "mumble"}, "words")])
def test_bad_choices_are_refused_with_their_field(kw, field):
    kind = kw.pop("kind", "custom")
    with pytest.raises(video_starts.Bad) as e:
        video_starts.choices(kind, **kw)
    assert e.value.field == field


def test_the_brief_is_needed_and_kept_short():
    assert video_starts.brief("  A   launch   video  ") == "A launch video"
    with pytest.raises(video_starts.Bad):
        video_starts.brief("hi")
    with pytest.raises(video_starts.Bad):
        video_starts.brief("x" * (video_starts.MAX_BRIEF + 1))


# ── The website reader ───────────────────────────────────────────────────────
def test_pages_are_chosen_by_the_brief_on_the_same_site():
    links = [{"href": "https://acme.com/pricing", "text": "Pricing"},
             {"href": "https://acme.com/features#top", "text": "Features"},
             {"href": "https://acme.com/login", "text": "Log in"},
             {"href": "https://other.com/pricing", "text": "Pricing"},
             {"href": "https://www.acme.com/blog/2019/old-post", "text": "Old post"},
             {"href": "https://acme.com/integrations/slack", "text": "Slack integration"},
             {"href": "mailto:hi@acme.com", "text": "Email"},
             {"href": "https://acme.com/", "text": "Home"}]
    picks = video_site.choose_pages("https://acme.com/", links, "A demo of our Slack integration and pricing")
    assert picks[0] in ("https://acme.com/integrations/slack", "https://acme.com/pricing")
    assert set(picks) <= {"https://acme.com/integrations/slack", "https://acme.com/pricing", "https://acme.com/features"}
    assert all("login" not in p and "other.com" not in p for p in picks)
    assert len(video_site.choose_pages("https://acme.com/", links * 3, "pricing features slack", limit=2)) == 2


def test_colours_come_from_the_css_most_used():
    extra = {"bg": {"#ffffff": 900000, "#0b1f3a": 200000}, "text": "#222222",
             "accent": {"#ffffff": 20, "#ff5a1f": 12, "#cccccc": 30, "#222222": 9}}
    assert video_site.colours(extra) == {"background": "#ffffff", "text": "#222222", "accent": "#ff5a1f"}
    assert video_site.colours({"bg": {"#000000": 1}, "text": "#111111"})["text"] == "#f5f5f5"


def test_site_chrome_and_kinds_of_text():
    pages = [[{"tag": "a", "text": "Pricing"}, {"tag": "h1", "text": "Fast books"}],
             [{"tag": "a", "text": "Pricing"}, {"tag": "h1", "text": "Plans"}],
             [{"tag": "a", "text": "Pricing"}, {"tag": "p", "text": "Close your books in five days, not twelve."}]]
    chrome = video_site.site_chrome(pages)
    assert chrome == {"Pricing"}
    kept = video_site.keep_blocks(pages[2], chrome=chrome)
    assert kept == [{"kind": "claim", "text": "Close your books in five days, not twelve.", "box": None}]
    assert video_site.kind_of({"tag": "p", "text": "Pro plan $49/mo"}) == "price"
    assert video_site.kind_of({"tag": "button", "text": "Start free"}) == "button"
    assert video_site.kind_of({"tag": "p", "text": "“The best tool we have bought this year,” said our CFO."}) == "quote"


def _screenshot(h=2400):
    im = Image.new("RGB", (1440, h), (250, 250, 250))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def _cap(url, blocks, **kw):
    c = watch_capture.Capture(url=url, final_url=url, status=200, title=kw.pop("title", "Acme"), blocks=blocks,
                              screenshot=_screenshot(), width=1440, height=2400)
    for k, v in kw.items():
        setattr(c, k, v)
    return c


def test_reading_a_site_gives_pages_pictures_and_the_brand(monkeypatch):
    monkeypatch.setattr(watch_safety, "check", lambda url: None)
    blocks = [{"tag": "h1", "text": "Books closed in five days", "box": [100, 200, 800, 80]},
              {"tag": "h2", "text": "Features", "box": [100, 1000, 400, 50]},
              {"tag": "h2", "text": "Pricing", "box": [100, 1600, 400, 50]},
              {"tag": "p", "text": "Starter $29/mo", "box": [100, 1700, 300, 30]},
              {"tag": "p", "text": "Growth $79/mo", "box": [500, 1700, 300, 30]},
              {"tag": "a", "text": "Log in", "box": [1300, 20, 60, 20]}]
    calls = []

    def fake(url, **kw):
        calls.append((url, kw.get("viewport"), bool(kw.get("extra"))))
        extra = {"bg": {"#ffffff": 10}, "text": "#1b1b1b", "accent": {"#5b3df5": 4}, "links": [
            {"href": "https://acme.com/pricing", "text": "Pricing"}], "heading_font": "Lora, serif",
            "body_font": "Inter", "logo_png": _img("PNG")} if kw.get("extra") else None
        page = blocks if "pricing" not in url else [blocks[-1], {"tag": "h1", "text": "Plans for every team",
                                                                 "box": [100, 200, 800, 80]}]
        return _cap(url, page, extra=extra, title="Acme")
    steps = []
    r = video_site.read("acme.com", "A launch video with our pricing", capture=fake,
                        on_step=lambda *a: steps.append(a[0]))
    assert r["ok"] and r["url"] == "https://acme.com/" and len(r["pages"]) == 2
    assert calls[0] == ("https://acme.com/", video_site.DESKTOP, True)
    assert calls[-1][1] == video_site.PHONE
    kinds = [im["kind"] for im in r["images"]]
    assert kinds.count("screenshot") == 3 and "crop" in kinds
    assert [b["text"] for b in r["pages"][1]["blocks"]] == ["Plans for every team"]      # "Log in" is site chrome
    assert any(im["name"].startswith("Pricing on") for im in r["images"])
    names = [im["name"] for im in r["images"] if im["kind"] == "screenshot"]
    assert names == ["Desktop: Acme", "Desktop: Acme (/pricing)", "Phone: Acme"]       # same title, told apart
    assert r["brand"]["accent"] == "#5b3df5" and r["brand"]["heading_font"] == "Lora, serif" and r["logo"]
    assert steps == ["open", "pages", "screenshots", "brand"]
    for im in r["images"]:
        assert Image.open(io.BytesIO(im["bytes"])).format == "JPEG" and im["width"] <= 1440


@pytest.mark.parametrize("kw,phrase", [({"bot_check": True}, "robot"), ({"error": "http_403"}, "robot"),
                                       ({"error": "http_401"}, "login"), ({"error": "dns"}, "reached"),
                                       ({"error": "timeout"}, "too long"), ({"error": "http_404"}, "not found")])
def test_a_site_that_cannot_be_read_says_why(monkeypatch, kw, phrase):
    monkeypatch.setattr(watch_safety, "check", lambda url: None)
    r = video_site.read("https://blocked.example/", "x", capture=lambda url, **k: _cap(url, [], **kw))
    assert r["ok"] is False and phrase in r["message"]
    assert r["images"] == [] and r["brand"] is None


def test_a_private_address_is_never_read():
    with pytest.raises(watch_safety.BadURL):
        video_site.read("http://127.0.0.1/admin", "x", capture=lambda *a, **k: pytest.fail("opened"))
