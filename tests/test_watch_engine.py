"""Page Watch, Phase 1: the detection engine, without a browser or a network.

Screenshots are drawn here with Pillow, so every visual case is exact: a
recoloured button, a removed section, a banner that pushes the page down, a
carousel that changes between a capture and its control shot.
"""

import io
import json

import numpy as np
import pytest
from PIL import Image, ImageDraw

from tracker import (watch_capture, watch_config, watch_detect, watch_engine, watch_safety, watch_store,
                     watch_text, watch_visual)


# ── Drawing pages ────────────────────────────────────────────────────────────
def page(height=1600, width=800, *, button="#111111", price=True, removed=False, banner=0, carousel=0,
         heading_word="Plans"):
    """A fake pricing page. Returns PNG bytes."""
    height -= 120 if removed else 0          # a shorter page, as a real screenshot would be
    im = Image.new("RGB", (width, height + banner), "white")
    d = ImageDraw.Draw(im)
    y0 = banner
    if banner:
        d.rectangle((0, 0, width, banner - 1), fill="#111827")
        d.rectangle((40, 20, 500, 40), fill="#ffffff")
    d.rectangle((40, y0 + 40, 300, y0 + 80), fill="#222222")              # heading
    if heading_word != "Plans":
        d.rectangle((310, y0 + 40, 380, y0 + 80), fill="#222222")
    d.rectangle((600, y0 + 40, 720, y0 + 80), fill=button)                # button
    shift = 0                                                            # paragraphs
    for i in range(6):
        if removed and i == 3:
            shift = 120          # a removed paragraph pulls the rest of the page up
            continue
        top = y0 + 160 + i * 120 - shift
        d.rectangle((40, top, 80 + i * 90, top + 18), fill="#555555")
        d.rectangle((40, top + 30, 620 - i * 40, top + 48), fill="#555555")
    y0 -= shift
    if price:
        d.rectangle((40, y0 + 900, 140, y0 + 950), fill="#000000")
    else:
        d.rectangle((40, y0 + 900, 180, y0 + 950), fill="#000000")
    d.rectangle((300, y0 + 1100, 700, y0 + 1300), fill=["#ef4444", "#3b82f6", "#22c55e"][carousel % 3])
    d.rectangle((0, y0 + shift + height - 120, width, y0 + shift + height), fill="#0f172a")   # footer
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def blocks(**over):
    base = [
        {"tag": "h1", "text": "Plans for every team", "box": [40, 40, 260, 40], "sel": "main > h1"},
        {"tag": "a", "text": "Sign Up", "box": [600, 40, 120, 40], "sel": "header > a"},
        {"tag": "p", "text": "Hobby is free for personal projects and always will be.", "box": [40, 160, 660, 48], "sel": "p:nth-of-type(1)"},
        {"tag": "p", "text": "Pro gives your team more usage and support.", "box": [40, 280, 660, 48], "sel": "p:nth-of-type(2)"},
        {"tag": "p", "text": "Enterprise adds security, compliance and a dedicated manager.", "box": [40, 400, 660, 48], "sel": "p:nth-of-type(3)"},
        {"tag": "span", "text": "$20", "box": [40, 900, 100, 50], "sel": "div.price > span"},
        {"tag": "p", "text": "Updated 3 minutes ago", "box": [40, 1000, 300, 20], "sel": "p.updated"},
    ]
    return [dict(b, **over.get(b["text"], {})) for b in base]


def cap_from(png=None, control=None, blk=None, **kw):
    c = watch_capture.Capture(url="https://example.com/pricing", final_url="https://example.com/pricing",
                              status=200, title="Pricing", blocks=blk if blk is not None else blocks(),
                              screenshot=png, control=control or png, **kw)
    if png:
        im = Image.open(io.BytesIO(png))
        c.width, c.height = im.size
        c.page_height = im.size[1]
    return c


def prev_from(cap):
    noise = watch_visual.pack_grid(watch_visual.noise_cells(cap.screenshot, cap.control)) if cap.screenshot else None
    return watch_detect.snapshot_from(cap, noise)


# ── Links ────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("raw,want", [
    ("vercel.com/pricing", "https://vercel.com/pricing"),
    ("https://Vercel.com/pricing#plans", "https://vercel.com/pricing"),
    ("HTTP://www.Example.com", "http://www.example.com/"),
    ("//example.com/a?b=1", "https://example.com/a?b=1"),
    ("example.com:8080/x", "https://example.com:8080/x"),
    ("https://example.com:443/x", "https://example.com/x"),
])
def test_links_are_normalised(raw, want):
    assert watch_safety.normalise(raw) == want


@pytest.mark.parametrize("raw", ["", "   ", "javascript:alert(1)", "mailto:a@b.com", "ftp://example.com/x",
                                 "file:///etc/passwd", "https://user:pw@example.com/", "localhost",
                                 "vercel pricing", "x" * 2100])
def test_bad_links_are_refused_with_a_sentence(raw):
    with pytest.raises(watch_safety.BadURL) as err:
        watch_safety.normalise(raw)
    assert str(err.value).endswith(".")


@pytest.mark.parametrize("url", ["http://127.0.0.1/", "http://10.0.0.5/admin", "http://169.254.169.254/latest/",
                                 "http://[::1]/", "http://localhost/", "http://192.168.1.1/"])
def test_private_addresses_are_refused(url):
    with pytest.raises(watch_safety.BadURL):
        watch_safety.check(url)
    assert watch_safety.allowed(url) is False


def test_capture_refuses_a_private_address_before_opening_anything(monkeypatch):
    monkeypatch.setattr(watch_capture, "_run_browser", lambda *a, **k: pytest.fail("opened"))
    with pytest.raises(watch_safety.BadURL):
        watch_capture.capture("http://169.254.169.254/latest/meta-data/")


def test_site_key_drops_www():
    assert watch_safety.site_key("https://www.vercel.com/pricing") == "vercel.com"


# ── Text ─────────────────────────────────────────────────────────────────────
def test_volatile_text_is_neutral_when_comparing():
    assert watch_text.key("Updated 3 minutes ago") == watch_text.key("Updated 12 minutes ago")
    assert watch_text.key("Last run 10:42 am") == watch_text.key("Last run 11:05 am")
    assert watch_text.key("Hello​ world") == "Hello world"
    assert watch_text.key("Ratio 16:9") == "Ratio 16:9"


def test_unchanged_blocks_are_the_same_even_with_volatile_text():
    a = blocks()
    b = blocks(**{"Updated 3 minutes ago": {"text": "Updated 9 minutes ago"}})
    d = watch_text.diff(a, b)
    assert d["same"] and watch_text.fingerprint(a) == watch_text.fingerprint(b)


def test_a_price_edit_is_one_change_with_before_and_after():
    d = watch_text.diff(blocks(), blocks(**{"$20": {"text": "$25"}}))
    assert not d["same"]
    assert len(d["changed"]) == 1 and not d["added"] and not d["removed"]
    assert d["changed"][0]["before"] == "$20" and d["changed"][0]["after"] == "$25"
    assert d["prices"] == [{"before": ["$20"], "after": ["$25"], "context": "$25", "box": [40, 900, 100, 50]}]


def test_an_edited_sentence_gets_a_word_diff():
    b = blocks(**{"Pro gives your team more usage and support.":
                  {"text": "Pro gives your team more usage and priority support."}})
    d = watch_text.diff(blocks(), b)
    c = d["changed"][0]
    assert ("+", "priority") in c["segments"]
    assert d["words_added"] == 1 and d["words_removed"] == 0


def test_added_and_removed_blocks():
    a = blocks()
    b = [x for x in a if not x["text"].startswith("Enterprise")]
    b.insert(2, {"tag": "p", "text": "Startups get 50% off the first year.", "box": [40, 200, 600, 20], "sel": "p.new"})
    d = watch_text.diff(a, b)
    assert [x["text"] for x in d["added"]] == ["Startups get 50% off the first year."]
    assert [x["text"] for x in d["removed"]] == ["Enterprise adds security, compliance and a dedicated manager."]


def test_a_moved_block_is_moved_not_removed_and_added():
    a = blocks()
    b = a[:2] + [a[4], a[2], a[3]] + a[5:]
    d = watch_text.diff(a, b)
    assert not d["added"] and not d["removed"]
    assert len(d["moved"]) == 1


def test_select_keeps_the_area_and_drops_ignored_areas():
    area = [0, 100, 800, 500]
    kept = watch_text.select(blocks(), area=area)
    assert [b["text"][:5] for b in kept] == ["Hobby", "Pro g", "Enter"]
    kept = watch_text.select(blocks(), ignore=[[0, 990, 800, 40]])
    assert all(not b["text"].startswith("Updated") for b in kept)


def test_prices_are_found_in_several_forms():
    assert watch_text.prices("From $1,299.00/mo or €49 or ₹2,000 or USD 15") == ["$1,299.00", "€49", "₹2,000", "USD 15"]


# ── Visuals ──────────────────────────────────────────────────────────────────
def test_identical_screenshots_are_the_same():
    r = watch_visual.compare(page(), page())
    assert r["same"] and r["after"] == [] and r["changed_share"] == 0


def test_a_recoloured_button_is_one_box_around_the_button():
    r = watch_visual.compare(page(), page(button="#2563eb"))
    assert not r["same"] and len(r["after"]) == 1
    x, y, w, h = r["after"][0]
    assert x <= 600 and x + w >= 720 and y <= 40 and y + h >= 80
    assert w < 200 and h < 80


def test_a_removed_section_and_the_shift_below_it():
    r = watch_visual.compare(page(), page(removed=True))
    # The removed paragraph is a box on the old page; everything below moved
    # up but did not change, so the new page has nothing (or only the gap) boxed.
    assert r["before"], r
    assert r["removed_px"] > 0
    assert all(b[1] < 700 for b in r["after"])


def test_a_banner_pushing_the_page_down_is_only_the_banner():
    r = watch_visual.compare(page(), page(banner=80))
    assert r["added_px"] >= 72
    assert len(r["after"]) == 1, r["after"]
    assert r["after"][0][1] < 80


def test_what_moves_on_its_own_is_ignored():
    before = page(carousel=0)
    after, control = page(carousel=1), page(carousel=2)
    r = watch_visual.compare(before, after, after_control=control)
    assert r["same"], r


def test_the_previous_captures_noise_is_ignored_too():
    noise = watch_visual.noise_cells(page(carousel=0), page(carousel=1))
    r = watch_visual.compare(page(carousel=1), page(carousel=2), before_noise=noise)
    assert r["same"]


def test_ignored_areas_are_left_out():
    r = watch_visual.compare(page(), page(button="#2563eb"), ignore=[[590, 30, 140, 60]])
    assert r["same"]


def test_comparing_only_an_area():
    r = watch_visual.compare(page(), page(button="#2563eb"), area=[0, 120, 800, 900])
    assert r["same"]
    r = watch_visual.compare(page(), page(price=False), area=[0, 850, 800, 200])
    assert len(r["after"]) == 1 and r["after"][0][1] >= 850


def test_antialiasing_noise_is_below_the_line():
    im = Image.open(io.BytesIO(page())).convert("RGB")
    a = np.asarray(im).astype(np.int16)
    jitter = np.clip(a + np.random.default_rng(1).integers(-12, 13, a.shape), 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(jitter).save(buf, "PNG")
    assert watch_visual.compare(page(), buf.getvalue())["same"]


def test_lossless_storage_round_trips_exactly():
    png = page()
    back = watch_visual.to_png(watch_visual.to_webp(png, lossless=True))
    assert np.array_equal(np.asarray(Image.open(io.BytesIO(png)).convert("RGB")),
                          np.asarray(Image.open(io.BytesIO(back)).convert("RGB")))
    assert watch_visual.compare(png, back)["same"]


def test_noise_grids_pack_and_unpack():
    g = watch_visual.noise_cells(page(carousel=0), page(carousel=1))
    assert g.any()
    assert np.array_equal(watch_visual.unpack_grid(watch_visual.pack_grid(g)), g)
    json.dumps(watch_visual.pack_grid(g))


def test_composite_is_a_png_with_both_sides():
    r = watch_visual.compare(page(), page(button="#2563eb"))
    png = watch_visual.composite(page(), page(button="#2563eb"), r)
    im = Image.open(io.BytesIO(png))
    assert im.format == "PNG" and im.width > 2 * watch_config.COMPOSITE_WIDTH * 0.9


def test_grow_is_a_square_dilation():
    g = np.zeros((10, 10), bool)
    g[5, 5] = True
    out = watch_visual.grow(g, 2)
    assert out.sum() == 25 and out[3:8, 3:8].all()


# ── Deciding ─────────────────────────────────────────────────────────────────
def test_nothing_changed_reports_same():
    a = cap_from(page())
    report, _ = watch_detect.compare(prev_from(a), cap_from(page()))
    assert report["outcome"] == "same" and report["headline"] == "No change."


def test_a_price_change_is_major_and_says_so():
    a = cap_from(page())
    b = cap_from(page(price=False), blk=blocks(**{"$20": {"text": "$25"}}))
    report, _ = watch_detect.compare(prev_from(a), b)
    assert report["outcome"] == "changed" and report["level"] == "major"
    assert "price" in report["reasons"]
    assert report["headline"] == "Price changed: $20 → $25."


def test_a_visual_only_change_is_named_by_the_element_under_it():
    a = cap_from(page())
    report, _ = watch_detect.compare(prev_from(a), cap_from(page(button="#2563eb")))
    assert report["outcome"] == "changed"
    assert report["areas"][0]["label"] == "the link “Sign Up”"
    assert report["headline"] == "Looks different around the link “Sign Up”."


def test_text_only_watch_ignores_visuals():
    a = cap_from(page())
    report, _ = watch_detect.compare(prev_from(a), cap_from(page(button="#2563eb")), {"visual": False})
    assert report["outcome"] == "same"


def test_a_redirect_and_a_status_change_are_facts():
    a = cap_from(page())
    b = cap_from(page())
    b.final_url = "https://example.com/plans"
    report, _ = watch_detect.compare(prev_from(a), b)
    assert report["facts"]["final_url"][1] == "https://example.com/plans"
    assert report["headline"].startswith("The page now redirects")


def test_a_watched_area_that_disappeared_is_reported():
    a = cap_from(page(), area_box=[0, 100, 800, 500], area_found=True)
    b = cap_from(page(), area_box=None, area_found=False)
    report, _ = watch_detect.compare(prev_from(a), b, {"area": "#plans"})
    assert report["area_lost"] and report["headline"] == "The watched area is no longer on the page."


# ── Reading without a browser ────────────────────────────────────────────────
def test_plain_http_reading_splits_text_into_blocks(monkeypatch):
    html = ("<html><head><title> Plans </title><style>.x{}</style></head><body><nav><a href=/>Home</a></nav>"
            "<h1>Plans &amp; pricing</h1><p>Pro is <b>$20</b> a month.</p><script>var x=1</script>"
            "<ul><li>One</li><li>Two</li></ul></body></html>")
    from tracker import lbr_website
    monkeypatch.setattr(lbr_website, "fetch", lambda url: {"url": url, "status": 200, "html": html, "error": None})
    cap = watch_capture.capture_http("https://example.com/")
    assert cap.engine == "http" and cap.title == "Plans"
    assert [b["text"] for b in cap.blocks] == ["Home", "Plans & pricing", "Pro is $20 a month.", "One", "Two"]


def test_bot_checks_are_recognised():
    c = watch_capture.Capture(url="https://x.com", status=403, title="Just a moment...",
                              blocks=[{"tag": "p", "text": "Checking your browser before accessing x.com", "box": None}])
    watch_capture._classify(c)
    assert c.bot_check and not c.ok


def test_a_long_page_mentioning_captcha_is_not_a_bot_check():
    words = "word " * 400
    c = watch_capture.Capture(url="https://x.com", status=200, title="Our captcha guide",
                              blocks=[{"tag": "p", "text": "Are you a robot? " + words, "box": None}])
    watch_capture._classify(c)
    assert not c.bot_check and c.ok


def test_an_error_status_and_an_empty_page_are_errors():
    c = watch_capture.Capture(url="https://x.com", status=404, blocks=[{"tag": "p", "text": "Not found", "box": None}])
    watch_capture._classify(c)
    assert c.error == "http_404"
    c = watch_capture.Capture(url="https://x.com", status=200, blocks=[])
    watch_capture._classify(c)
    assert c.error == "empty"


# ── Storage and the whole check ──────────────────────────────────────────────
@pytest.fixture
def store(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    watch_store.reset_memory()
    yield watch_store
    watch_store.reset_memory()


def test_reads_are_scoped_to_the_owner(store):
    tid = store.create_target("Ana@Markifydigital.com", "https://example.com/", name="Example")
    assert store.get_target(tid, "ana@markifydigital.com")["name"] == "Example"
    assert store.get_target(tid, "bob@markifydigital.com") is None
    assert store.update_target(tid, "bob@markifydigital.com", name="Hijack") is False
    img = store.add_image(tid, "thumb", b"x")
    assert store.get_image(img, "bob@markifydigital.com") is None
    assert store.get_image(img, "ana@markifydigital.com")["bytes"] == b"x"
    assert store.list_targets("bob@markifydigital.com") == []
    assert store.delete_target(tid, "bob@markifydigital.com") is False


def test_unknown_fields_are_refused(store):
    with pytest.raises(ValueError):
        store.create_target("a@b.com", "https://example.com/", colour="red")


def _fake_reader(*caps):
    seq = list(caps)

    def read(url, area=None, screenshots=True):
        return seq.pop(0)
    return read


def test_a_full_watch_lifecycle(store):
    tid = store.create_target("ana@markifydigital.com", "https://example.com/pricing", name="Example pricing")
    first = watch_engine.run_check(tid, capture=_fake_reader(cap_from(page()), cap_from(page()), cap_from(page())))
    assert first["outcome"] == "baseline" and first["learned"] == {"rects": [], "sels": []}
    t = store.get_target(tid)
    assert t["state"] == "ok" and t["baseline_id"] == first["snapshot_id"]
    shot = store.get_image(store.get_snapshot(t["baseline_id"])["shot_id"])
    assert shot["lossless"]

    same = watch_engine.run_check(tid, capture=_fake_reader(cap_from(page())))
    assert same["outcome"] == "same"
    assert store.get_target(tid)["baseline_id"] == first["snapshot_id"]

    # Seen once: held back, the reading kept, nothing recorded as a change.
    new_price = dict(price=False), blocks(**{"$20": {"text": "$25"}})
    suspected = watch_engine.run_check(tid, capture=_fake_reader(cap_from(page(**new_price[0]), blk=new_price[1])))
    assert suspected["outcome"] == "suspected" and suspected["confirm_in_s"] == watch_engine.CONFIRM_DELAY_S
    t = store.get_target(tid)
    assert t["pending_id"] == suspected["snapshot_id"] and t["baseline_id"] == first["snapshot_id"]
    assert store.list_changes(tid) == [] and t["state"] == "ok"
    # Seen again on the re-check: recorded.
    changed = watch_engine.run_check(tid, capture=_fake_reader(cap_from(page(**new_price[0]), blk=new_price[1])))
    assert changed["outcome"] == "changed"
    t = store.get_target(tid)
    assert t["state"] == "changed" and t["baseline_id"] != first["snapshot_id"] and t["pending_id"] is None
    assert store.get_snapshot(suspected["snapshot_id"]) is None       # the held reading is not kept twice
    change = store.get_change(changed["change_id"], "ana@markifydigital.com")
    assert change["headline"] == "Price changed: $20 → $25." and change["level"] == "major"
    assert store.get_image(change["composite_id"], "ana@markifydigital.com")["mime"] == "image/png"
    json.dumps(change["report"])
    # The replaced baseline's screenshot was re-saved lossy, the lossless copy deleted.
    old = store.get_snapshot(first["snapshot_id"])
    assert store.get_image(old["shot_id"])["lossless"] is False
    assert [c["outcome"] for c in store.list_checks(tid)] == ["changed", "suspected", "same", "baseline"]


def test_errors_and_bot_checks_never_touch_the_baseline(store):
    tid = store.create_target("ana@markifydigital.com", "https://example.com/")
    watch_engine.run_check(tid, capture=_fake_reader(cap_from(page()), cap_from(page()), cap_from(page())))
    base = store.get_target(tid)["baseline_id"]
    broken = cap_from(None, blk=[])
    broken.error, broken.error_detail = "timeout", "The page took too long."
    r = watch_engine.run_check(tid, capture=_fake_reader(broken))
    assert r["outcome"] == "error" and store.get_target(tid)["state"] == "ok"      # one failure is not an alarm
    bot = cap_from(None, blk=[{"tag": "p", "text": "Verify you are human", "box": None}])
    bot.bot_check = True
    r = watch_engine.run_check(tid, capture=_fake_reader(bot))
    assert r["outcome"] == "blocked" and r["fail_count"] == 2
    t = store.get_target(tid)
    assert t["state"] == "blocked" and t["baseline_id"] == base
    watch_engine.run_check(tid, capture=_fake_reader(cap_from(page())))
    t = store.get_target(tid)
    assert t["state"] == "ok" and t["fail_count"] == 0


def test_a_shorter_control_shot_does_not_break_the_comparison():
    short = page(height=1500)
    r = watch_visual.compare(page(), page(), after_control=short)
    assert r["same"]
    after = page(banner=80)
    im = Image.open(io.BytesIO(after))
    buf = io.BytesIO()
    im.crop((0, 0, im.width, im.height - 200)).save(buf, "PNG")      # the same page, 200px shorter
    r = watch_visual.compare(page(), after, after_control=buf.getvalue())
    assert len(r["after"]) == 1 and r["after"][0][1] < 80


def test_calibration_learns_what_changes_on_every_visit(store):
    """A button whose colour differs per visit and a rotating quote are learned
    as noise at the baseline, so a later visit showing other variants is "same",
    while a real price change is still found."""
    rotating = {"Updated 3 minutes ago": {"text": "Quote of the day: ship it", "sel": "p.quote"}}
    other = {"Updated 3 minutes ago": {"text": "Quote of the day: measure twice", "sel": "p.quote"}}
    tid = store.create_target("ana@markifydigital.com", "https://example.com/pricing")
    first = watch_engine.run_check(tid, capture=_fake_reader(
        cap_from(page(button="#111111"), blk=blocks(**rotating)),
        cap_from(page(button="#db2777"), blk=blocks(**other)),
        cap_from(page(button="#111111"), blk=blocks(**rotating))))
    learned = first["learned"]
    assert len(learned["rects"]) == 1 and learned["sels"] == ["p.quote"]
    later = watch_engine.run_check(tid, capture=_fake_reader(
        cap_from(page(button="#db2777"), blk=blocks(**{"Updated 3 minutes ago": {"text": "Quote: be kind", "sel": "p.quote"}}))))
    assert later["outcome"] == "same"
    price = watch_engine.run_check(tid, confirm=False, capture=_fake_reader(
        cap_from(page(price=False), blk=blocks(**dict(rotating, **{"$20": {"text": "$25"}})))))
    assert price["outcome"] == "changed" and price["report"]["headline"] == "Price changed: $20 → $25."


def test_calibration_runs_once_and_survives_a_failed_read(store):
    tid = store.create_target("ana@markifydigital.com", "https://example.com/")
    broken = cap_from(None, blk=[])
    broken.error = "timeout"

    def flaky(*caps):
        seq = list(caps)

        def read(url, area=None, screenshots=True):
            item = seq.pop(0)
            if isinstance(item, Exception):
                raise item
            return item
        return read
    r = watch_engine.run_check(tid, capture=flaky(cap_from(page()), broken, RuntimeError("crash")))
    t = store.get_target(tid)
    assert r["outcome"] == "baseline" and t["settings"]["calibration_reads"] == 0
    assert t["settings"]["calibrated_at"]


def two_column(removed=False):
    """A docs page: a sidebar that stays put, and a main column whose
    paragraphs move up when one is removed."""
    im = Image.new("RGB", (900, 1400), "white")
    d = ImageDraw.Draw(im)
    for i in range(12):                                        # sidebar links
        d.rectangle((20, 40 + i * 60, 160 - (i % 4) * 20, 56 + i * 60), fill="#334155")
    y = 40
    for i in range(10):                                        # main column
        if removed and i == 2:
            continue
        d.rectangle((240, y, 860 - (i % 5) * 60, y + 18), fill="#475569")
        d.rectangle((240, y + 28, 700 - (i % 3) * 80, y + 46), fill="#475569")
        y += 110
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def test_one_column_moving_up_is_a_move_not_a_change():
    blocks_a = [{"tag": "p", "text": "Paragraph %d text here" % i, "box": [240, 40 + i * 110, 600, 46]} for i in range(10)]
    blocks_b = [{"tag": "p", "text": "Paragraph %d text here" % i,
                 "box": [240, 40 + (i if i < 2 else i - 1) * 110, 600, 46]} for i in range(10) if i != 2]
    sh = watch_detect.shifts(blocks_a, blocks_b)
    assert (0, -110) in sh
    r = watch_visual.compare(two_column(), two_column(removed=True), shifts=sh)
    assert r["after"] == [], r["after"]                 # nothing on the new page changed, it moved
    assert len(r["before"]) == 1 and 248 <= r["before"][0][1] <= 280   # the removed paragraph (cell-aligned)
    assert r["moved_areas"] >= 1


def test_a_real_change_is_not_explained_away_as_a_move():
    r = watch_visual.compare(page(), page(button="#2563eb"), shifts=[(0, 0), (0, 120), (0, -120)])
    assert len(r["after"]) == 1


def test_a_one_pixel_redraw_is_not_a_change_but_a_thin_new_line_is():
    im = Image.open(io.BytesIO(page())).convert("RGB")
    nudged = Image.new("RGB", im.size, "white")
    nudged.paste(im, (1, 1))                      # everything one pixel off, as after a fractional shift
    buf = io.BytesIO()
    nudged.save(buf, "PNG")
    grid = watch_visual.cell_changes(watch_visual.load(page()), watch_visual.load(buf.getvalue()))
    # The paste leaves a blank 1px strip along the left and top edges, which a
    # real shift never does; everything inside is unchanged.
    assert grid[1:, 1:].sum() == 0
    d = ImageDraw.Draw(im)
    d.line((40, 1050, 700, 1050), fill="#dc2626", width=2)    # a new 2px rule
    buf = io.BytesIO()
    im.save(buf, "PNG")
    r = watch_visual.compare(page(), buf.getvalue())
    assert len(r["after"]) == 1 and abs(r["after"][0][1] - 1050) <= 16


def test_a_reading_made_another_way_is_never_compared(store):
    tid = store.create_target("ana@markifydigital.com", "https://example.com/")
    watch_engine.run_check(tid, capture=_fake_reader(cap_from(page()), cap_from(page()), cap_from(page())))
    base = store.get_target(tid)["baseline_id"]
    http_read = cap_from(None, engine="http")
    r = watch_engine.run_check(tid, capture=_fake_reader(http_read))
    assert r["outcome"] == "error" and r["error"] == "engine"
    assert store.get_target(tid)["baseline_id"] == base and store.list_changes(tid) == []


def test_a_missing_watched_area_is_an_error_not_a_change(store):
    tid = store.create_target("ana@markifydigital.com", "https://example.com/", area_selector="#plans")
    good = [cap_from(page(), area_box=[0, 100, 800, 500], area_found=True) for _ in range(3)]
    watch_engine.run_check(tid, capture=_fake_reader(*good))
    gone = cap_from(page(), area_box=None, area_found=False)
    r = watch_engine.run_check(tid, capture=_fake_reader(gone))
    assert r["outcome"] == "error" and r["error"] == "area_missing"
    assert store.list_changes(tid) == []
    r = watch_engine.run_check(tid, capture=_fake_reader(cap_from(page(), area_box=None, area_found=False)))
    assert store.get_target(tid)["state"] == "error"


# ── Ignored areas follow the content ─────────────────────────────────────────
def _pushed(dy, extra=(), **over):
    """blocks() as on a page pushed down by `dy` px, plus `extra` blocks."""
    out = [dict(b, box=[b["box"][0], b["box"][1] + dy, b["box"][2], b["box"][3]]) for b in blocks(**over)]
    return list(extra) + out


BANNER = {"tag": "div", "text": "Announcement: our plans change on November 1.", "box": [40, 20, 460, 20],
          "sel": "body > div:nth-of-type(1)"}


def test_an_ignored_area_follows_its_content_when_a_banner_pushes_it_down():
    """The ignored area covers the heading on the old page. A banner inserted
    above it pushes the heading 60px down: the banner (on rows the new page
    added) is still seen, and the edited heading (where the ignored area now
    is) is still ignored, in the text and in the picture."""
    before = cap_from(page(), blk=blocks())
    after = cap_from(page(banner=60, heading_word="Remarkable"),
                     blk=_pushed(60, [BANNER], **{"Plans for every team": {"text": "Remarkable plans for every team"}}))
    report, _ = watch_detect.compare(prev_from(before), after, {"ignore": [[0, 30, 800, 60]]})
    assert [a["text"] for a in report["text"]["added"]] == [BANNER["text"]]
    assert report["text"]["changed"] == [] and report["text"]["removed"] == []
    boxes = report["visual"]["after"]
    assert boxes and all(y + h <= 64 for x, y, w, h in boxes), boxes
    assert "_rows" in report and "rows" not in report["visual"]


def test_an_ignored_area_still_ignores_when_nothing_moved():
    before = cap_from(page(), blk=blocks())
    after = cap_from(page(heading_word="Remarkable"),
                     blk=blocks(**{"Plans for every team": {"text": "Remarkable plans for every team"}}))
    report, _ = watch_detect.compare(prev_from(before), after, {"ignore": [[0, 30, 400, 60]]})
    assert report["outcome"] == "same", report["headline"]


def test_carry_moves_areas_onto_the_new_baseline_and_drops_removed_ones():
    pushed, _ = watch_detect.compare(prev_from(cap_from(page(), blk=blocks())),
                                     cap_from(page(banner=60), blk=_pushed(60, [BANNER])))
    assert watch_detect.carry([[300, 1100, 400, 200]], pushed) == [[300, 1160, 400, 200]]
    shorter, _ = watch_detect.compare(prev_from(cap_from(page(), blk=blocks())),
                                      cap_from(page(removed=True), blk=blocks()))
    gone = [40, 528, 400, 32]                       # the removed paragraph's rows
    assert watch_detect.carry([gone], shorter) == []
    assert watch_detect.carry([gone], shorter, keep_removed=True) == [gone]
    # Without screenshots there is no alignment, and nothing moves.
    assert watch_detect.carry([[1, 2, 3, 4]], {"_rows": None}) == [[1, 2, 3, 4]]


def test_after_a_change_the_watch_keeps_ignoring_the_same_content(store):
    tid = store.create_target("ana@markifydigital.com", "https://example.com/pricing", ignore=[[280, 1090, 440, 220]])
    watch_engine.run_check(tid, capture=_fake_reader(cap_from(page()), cap_from(page()), cap_from(page())))
    changed = watch_engine.run_check(tid, confirm=False,
                                     capture=_fake_reader(cap_from(page(banner=60), blk=_pushed(60, [BANNER]))))
    assert changed["outcome"] == "changed"
    assert "_rows" not in store.get_change(changed["change_id"])["report"]
    assert store.get_target(tid)["ignore"] == [[280, 1150, 440, 220]]
    # The carousel inside the area rotates on the next visit: not a change.
    later = watch_engine.run_check(tid, capture=_fake_reader(
        cap_from(page(banner=60, carousel=1), blk=_pushed(60, [BANNER]))))
    assert later["outcome"] == "same", later["report"]["headline"]


# ── A selector handed to new content ─────────────────────────────────────────
def test_a_long_text_that_takes_an_old_selector_is_added_not_an_edit():
    old = [{"tag": "div", "text": "Free shipping on every order over fifty dollars this month only",
            "box": [0, 0, 800, 40], "sel": "body > div:nth-of-type(1)"}]
    new = [{"tag": "div", "text": "Announcement: our plans change on November 1. Read what is new.",
            "box": [0, 0, 800, 40], "sel": "body > div:nth-of-type(1)"}]
    d = watch_text.diff(old, new)
    assert [a["text"] for a in d["added"]] == [new[0]["text"]]
    assert [r["text"] for r in d["removed"]] == [old[0]["text"]] and d["changed"] == []


def test_the_same_selector_still_pairs_a_short_label_and_a_light_edit():
    a = {"tag": "span", "text": "$20", "box": [0, 0, 40, 20], "sel": "div.price > span"}
    b = dict(a, text="$25", box=[0, 300, 40, 20])
    assert watch_text.same_place(a, b) == 1.0
    long_a = {"tag": "p", "text": "Pro gives your team more usage, support and early access to new features.",
              "box": [0, 0, 600, 40], "sel": "main > p"}
    long_b = dict(long_a, text="Pro gives every team more usage and priority support on all plans.", box=[0, 400, 600, 40])
    assert watch_text.same_place(long_a, long_b) == 1.0
