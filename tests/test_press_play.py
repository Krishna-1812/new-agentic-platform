"""The public site's playful motion (static/js/press-play.js + the PLAY
section of press.css) and the app's small touches (bento-motion).

Filmed frame by frame in a real browser at 1440px and 390px: the hero deck
deals, the highlighter draws, headline letters swell under the pointer,
buttons and cards flood from the pointer, stats roll like an odometer, the
colour-block track slides while the page scrolls, and the footer wordmark
rises. Also loaded with reduced motion and with JavaScript off, where the page
is the finished static page. What that review cannot keep true is pinned here.
"""

import os
import re

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(_ROOT, *parts), encoding="utf-8") as f:
        return f.read()


def _strip(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def _play_css():
    css = _strip(_read("static", "css", "press.css"))
    return css[css.index(":root { --spring"):]


def test_both_public_templates_load_the_play_script_deferred():
    for tpl in ("agents.html", "login_preview.html"):
        html = _read("templates", tpl)
        assert re.search(r"<script src=\"[^\"]*press-play\.js[^\"]*\" defer></script>", html), tpl


def test_reduced_motion_switches_everything_off():
    js = _read("static", "js", "press-play.js")
    head = js[:js.index('root.classList.add("play")')]
    assert "prefers-reduced-motion: reduce" in head and "return;" in head


def test_every_play_rule_waits_for_the_script():
    """Hidden or moved resting states (the deck, the footer letters, the
    undrawn highlighter, the pinned track) may only exist under html.play,
    which the script sets; with JS off the page is complete."""
    css = _play_css()
    for sel in (".deck {", ".foot-word .ch", ".mk {", ".track.is-pinned", ".inkband, .play .limeband"):
        for m in re.finditer(re.escape(sel), css):
            line_start = css.rfind("\n", 0, m.start()) + 1
            line = css[line_start:m.end()]
            if sel == ".deck {" and line.strip().startswith(".deck {"):
                continue  # the static layout of the deck, not a hidden state
            assert ".play" in line or ".odo" in line, (sel, line)


def test_the_page_curtain_is_gated_before_first_paint():
    for tpl in ("agents.html", "login_preview.html"):
        html = _read("templates", tpl)
        head = html[:html.index("<body")]
        assert "' vt'" in head and "prefers-reduced-motion: reduce" in head, tpl
    css = _play_css()
    assert ".vt::view-transition-new(root)" in css


def test_no_card_is_staggered_by_the_play_layer():
    """The only per-index timing is per letter of the footer wordmark."""
    css = _play_css()
    delays = re.findall(r"[^{}]*\{[^}]*calc\(var\(--i\)[^}]*\}", css)
    assert len(delays) == 1 and ".foot-word .ch" in delays[0], delays
    assert "animation-delay" not in css


def test_the_odometer_leaves_the_number_in_the_markup():
    """The final figure is server-rendered; the roll is built only when the
    stat scrolls in, and the plain number goes back once it lands."""
    js = _read("static", "js", "press-play.js")
    assert "el.textContent = final" in js
    html = _read("templates", "agents.html")
    assert re.search(r'data-count="26">26<', html)


def test_no_animation_library_and_no_old_brand_signatures():
    js = _read("static", "js", "press-play.js")
    code = re.sub(r"/\*.*?\*/|//[^\n]*", "", js, flags=re.S)
    for banned in ("gsap", "THREE.", "three.js", "Lenis", "<canvas", "getContext(", "conic-gradient",
                   "rotateX", "rotateY", "perspective"):
        assert banned not in code, banned


def test_the_app_count_up_gives_way_to_the_page():
    js = _read("static", "js", "bento-motion.js")
    assert "el.textContent !== last" in js, "the count-up must stop when the page writes a value"
    assert "if (REDUCED) return;" in js[js.index("function play()"):]
