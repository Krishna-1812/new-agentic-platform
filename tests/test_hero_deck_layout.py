"""The home hero's card deck sits beside the headline, and its sticker reads cleanly.

The deck used to be pinned to the right margin at a fixed top, so at common laptop
widths it crowded the headline and at wide ones it floated in empty space.
press-play.js now seats it from the headline's real right edge; these tests pin
the pieces that make that work.
"""
import os
import re

import app as app_module

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


def test_sticker_text_fits_its_circle():
    html = app_module.app.test_client().get("/").get_data(as_text=True)
    m = re.search(r'<textPath href="#stk"([^>]*)>([^<]*)</textPath>', html)
    assert m, "sticker text missing"
    # Fitted to the path, so the loop never runs one phrase into the next
    # ("DAY AND NIGHTREADING ...").
    assert 'textLength="272"' in m.group(1) and 'lengthAdjust="spacing"' in m.group(1)
    assert "READING THE MARKET" in m.group(2) and "DAY AND NIGHT" in m.group(2)


def test_deck_is_seated_by_script_with_css_fallback():
    js = _read("static/js/press-play.js")
    seat = js.index("Seat the hero deck")
    # Layout runs before the reduced-motion early return, so everyone gets it.
    assert seat < js.index('if (RM) { root.classList.add("rm"); return; }')
    assert "textRight()" in js and 'window.addEventListener("resize", later)' in js
    css = _read("static/css/press.css")
    assert ".deck.unseated { display: none; }" in css


def test_footer_columns_wrap_before_they_overflow():
    css = _read("static/css/press.css")
    assert "@media (max-width: 1180px) { .foot-in { grid-template-columns: 1fr; }" in css
    assert ".foot-cols { display: flex; gap: clamp(var(--s6), 4vw, var(--s9)); }" in css


def test_asset_versions_bumped_together():
    for tpl in ("templates/agents.html", "templates/login_preview.html"):
        src = _read(tpl)
        assert "press.css?v=5" in src and "press-play.js') }}?v=4" in src, tpl
