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
    for sel in (".deck {", ".foot-word .ch", ".mk {", ".track.is-pinned", ".limeband {",
                ".said-t .sw", ".said-b {", ".inkband.portal", ".sticker {", ".deck.grabbing"):
        for m in re.finditer(re.escape(sel), css):
            line_start = css.rfind("\n", 0, m.start()) + 1
            line = css[line_start:m.end()]
            if sel in (".deck {", ".said-b {", ".sticker {", ".limeband {") and line.strip().startswith(sel):
                continue  # the static layout, not a hidden or moved state
            assert ".play" in line or ".odo" in line, (sel, line)


def test_the_page_curtain_is_gated_before_first_paint():
    for tpl in ("agents.html", "login_preview.html"):
        html = _read("templates", tpl)
        head = html[:html.index("<body")]
        assert "' vt'" in head and "prefers-reduced-motion: reduce" in head, tpl
    css = _play_css()
    assert ".vt::view-transition-new(root)" in css


def test_no_card_is_staggered_by_the_play_layer():
    """Per-index timing is per LETTER of a wordmark (the footer's, and the
    opening sequence's), never per card. The only other delays are the four
    stripes of the opening curtain, set one by one, not by index."""
    css = _play_css()
    rules = re.findall(r"([^{}]*)\{([^}]*)\}", css)
    for sel, body in rules:
        if "calc(var(--i)" in body:
            assert sel.strip().endswith(".ch"), sel
        if "transition-delay" in body:
            assert ".intro-bar" in sel, sel
        if "calc(var(--i)" in body or "transition-delay" in body:
            for card in (".deck-card", ".track-card", ".ag", ".cell", ".stat", ".said-b", ".toy", ".kin"):
                assert card not in sel, (card, sel)
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


# ── The louder layer ────────────────────────────────────────────────────────

def test_the_opening_sequence_is_gated_and_cannot_trap_the_page():
    """Home only, once a session, never under reduced motion, and never when
    arriving from another page of the site. The cover goes up in <head> so
    the page is not drawn first; if the script never runs, CSS lifts it."""
    html = _read("templates", "agents.html")
    head = html[:html.index("<body")]
    gate = head[head.index("{% if page == 'home' %}"):]
    # " vt" is only set when reduced motion is off.
    for must in ("/ vt/.test(", "sessionStorage.getItem('nx-intro')", "document.referrer", "intro-on"):
        assert must in gate[:gate.index("{% endif %}")], must
    css = _play_css()
    assert re.search(r"\.intro-on body::after \{[^}]*animation: pr-intro-failsafe [^;]*3s forwards", css)
    js = _read("static", "js", "press-play.js")
    intro = js[js.index("(function intro()"):]
    assert 'sessionStorage.setItem("nx-intro"' in intro
    assert '"keydown"' in intro and '"click"' in intro, "any key or click must skip it"


def test_the_deck_sits_above_the_hero_text_it_is_thrown_across():
    """The hero's text blocks run full width at z-index 1; under them the
    deck never received a press, so it could be neither dealt nor thrown."""
    css = _play_css()
    assert re.search(r"\.play \.deck \{[^}]*z-index: 2;", css)
    js = _read("static", "js", "press-play.js")
    down = js.index('deck.addEventListener("pointerdown"')
    assert "e.preventDefault();" in js[down:down + 300]


def test_confetti_is_elements_that_clean_up_after_themselves():
    js = _read("static", "js", "press-play.js")
    b = js[js.index("function burst("):js.index("window.pressFlip")]
    assert "layer.remove()" in b and 'setAttribute("aria-hidden", "true")' in b


def test_the_directory_filters_without_the_glide_too():
    html = _read("templates", "agents.html")
    assert "if (window.pressFlip) window.pressFlip(cards, apply); else apply();" in html
    js = _read("static", "js", "press-play.js")
    flip = js[js.index("window.pressFlip"):js.index("/* ── 17.")]
    assert "delay" not in flip, "cards that come back pop in together"


def test_scrambled_labels_end_on_their_own_words():
    js = _read("static", "js", "press-play.js")
    start = js.index("function scramble(")
    sc = js[start:js.index("raf(frame);\n  }", start)]
    assert "el.textContent = text;" in sc


def test_decorative_motion_is_hidden_from_assistive_tech():
    html = _read("templates", "agents.html")
    assert '<div class="kin" aria-hidden="true">' in html
    assert '<div class="toys" aria-hidden="true">' in html
    assert re.search(r'<div class="deck" id="deck" aria-hidden="true">[\s\S]*?<svg class="sticker"', html)
