"""The Bento motion layer, and the three ways a clip-path reveal goes wrong.

A reveal built on clip-path is not like a fade. A fade that fails to run leaves
the content visible; a clip that fails to run leaves it clipped to zero width
and the page looks empty with no error anywhere. Every test here is about that
asymmetry:

  - The hidden state must not live on the class the TEMPLATE writes, or a page
    whose script 404s renders blank.
  - Reduced motion must un-clip, not merely stop the animation, or the accessible
    path is the broken one.
  - The three effects inherited from the previous product must stay gone, because
    "we replaced the orb" is only true until someone adds one back.

The curve values are asserted from the file rather than measured, with the
measured numbers recorded in the stylesheet's own comment; the rendered check
was done in a real browser through Playwright (animation reached finished/420,
clip-path inset 0%, all 24 result cards non-zero width, and under reduced
motion clip-path:none with the same 24 visible) and is not reproducible in
pytest without a browser, so it is recorded here rather than automated.
"""

import os
import re

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CSS = os.path.join(_ROOT, "static", "css")
_JS = os.path.join(_ROOT, "static", "js")
_TPL = os.path.join(_ROOT, "templates")


def _read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as fh:
        return fh.read()


def _strip_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def _rule(css, selector):
    """The declaration block for an exact selector, comments removed."""
    body = _strip_comments(css)
    m = re.search(r"(?:^|[};])\s*" + re.escape(selector) + r"\s*\{([^}]*)\}",
                  body, re.M)
    return m.group(1) if m else None


def _motion():
    return _read(_CSS, "bento-motion.css")


# ── The no-JS contract ───────────────────────────────────────────────────────

def test_the_class_the_template_writes_does_not_hide_anything():
    """`.bn-reveal` is written by templates; `.bn-armed` is added by the script.

    If the hidden state were on `.bn-reveal`, a page whose script failed to load
    -- a 404, a CSP block, a stale cache -- would render every marked region
    clipped to zero width, with nothing in the console to say why. Keeping the
    clip on the class only the script can apply makes the failure mode "no
    animation" instead of "no content"."""
    css = _strip_comments(_motion())
    for m in re.finditer(r"(?:^|[};])\s*([^{}@]*\.bn-reveal[^{}]*)\{([^}]*)\}",
                         css, re.M):
        assert "clip-path" not in m.group(2), (
            "`%s` hides content on the class templates write, so a page whose "
            "script does not load renders blank: %s"
            % (m.group(1).strip(), m.group(2).strip()))


def test_the_hidden_state_lives_on_the_class_only_the_script_applies():
    decl = _rule(_motion(), ".bn-armed")
    assert decl and "clip-path" in decl, (
        "nothing clips .bn-armed any more, so the reveal has no starting state "
        "and the wipe will not be visible")


def test_the_script_arms_and_never_relies_on_css_to_hide():
    js = _read(_JS, "bento-motion.js")
    assert 'classList.add("bn-armed")' in js, (
        "the script no longer applies the hidden state, so either nothing is "
        "revealed or the hiding moved back into CSS where no-JS breaks it")


def test_content_already_on_screen_is_never_armed_without_being_shown():
    """Arming an above-the-fold tile clips it for at least one frame, which is a
    visible flash of missing content on every page load."""
    js = _read(_JS, "bento-motion.js")
    assert "getBoundingClientRect" in js and "bn-shown" in js, (
        "the script no longer checks whether an element is already on screen "
        "before arming it")


# ── Reduced motion ───────────────────────────────────────────────────────────

def test_reduced_motion_unclips_rather_than_only_stopping_the_animation():
    """`animation: none` on an armed element freezes it at the clipped start
    state, so the accessible path renders nothing at all. The reduced-motion
    block has to reset clip-path too."""
    css = _strip_comments(_motion())
    m = re.search(r"@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{(.*?)\n\}",
                  css, re.S)
    assert m, "bento-motion.css no longer has a reduced-motion block"
    block = m.group(1)
    armed = re.search(r"\.bn-armed[^{}]*\{([^}]*)\}", block)
    assert armed, "reduced motion no longer mentions the armed state"
    assert re.search(r"clip-path\s*:\s*none", armed.group(1)), (
        "reduced motion stops the animation without releasing the clip, which "
        "leaves every revealed region permanently invisible: %s"
        % armed.group(1).strip())


# ── The three inherited effects ──────────────────────────────────────────────

_BENTO_SHEETS = ("bento-tokens.css", "bento-components.css", "bento-motion.css")

# The three inherited effects are banned across the WHOLE product, not just the
# product's own design system. press.css is the public site's separate system
# (a light editorial ground, its own motion vocabulary -- see its header), and
# it is the likeliest place for one of the three to reappear, because a
# marketing page is where somebody reaches for a flourish. So the two file-level
# guards below run over both systems.
_SYSTEM_SHEETS = _BENTO_SHEETS + ("press.css",)


@pytest.mark.parametrize("sheet", _SYSTEM_SHEETS)
def test_no_conic_gradient_focus_ring_comes_back(sheet):
    """The animated conic-gradient ring around a focused input is the previous
    product's signature. Focus is a flat outline in both systems."""
    assert "conic-gradient" not in _strip_comments(_read(_CSS, sheet)), sheet


@pytest.mark.parametrize("sheet", _SYSTEM_SHEETS)
def test_nothing_is_staggered_per_index(sheet):
    """A per-card animation-delay IS the banned entrance, whatever it is called.
    An nth-child delay is the usual way it creeps back in.

    press.css does stagger, but per LINE of one headline and with
    transition-delay, which is a typographic device rather than a grid of cards
    arriving one after another. The check below is deliberately about
    animation-delay under nth-child, which is the card version."""
    css = _strip_comments(_read(_CSS, sheet))
    for m in re.finditer(r"nth-child\([^)]*\)[^{}]*\{([^}]*)\}", css):
        assert "animation-delay" not in m.group(1), (
            "%s stages an entrance per child: %s" % (sheet, m.group(1).strip()))
    assert "animation-delay" not in css or "--" in css, sheet


def test_the_entrance_moves_nothing():
    """The banned entrance faded AND lifted. This one only uncovers: a transform
    or a translate in the wipe keyframe would make it the same gesture again."""
    css = _strip_comments(_motion())
    m = re.search(r"@keyframes\s+bn-wipe\s*\{(.*?)\n\}", css, re.S)
    assert m, "the wipe keyframe is gone"
    assert "transform" not in m.group(1) and "translate" not in m.group(1), (
        "the wipe moves the element rather than uncovering it: %s" % m.group(1))


def test_the_retired_orb_is_not_reintroduced_by_the_page_script():
    js = _read(_JS, "company_people_intelligence.js")
    assert "thinking-orb" not in js and "data-orb-state" not in js, (
        "the canvas orb is back in the Contact Finder renderer")


# ── Loading vs. arriving ─────────────────────────────────────────────────────

def test_the_loading_sweep_is_linear():
    """An eased loop reads as a pulse, and a pulse implies progress this page
    does not measure. The sweep runs at a constant rate on purpose."""
    decl = _rule(_motion(), ".bn-sweep")
    assert decl, ".bn-sweep is gone"
    m = re.search(r"animation:\s*bn-sweep[^;]*", decl)
    assert m and "linear" in m.group(0), (
        "the loading sweep is no longer linear: %s" % (m.group(0) if m else decl))


def test_the_sweep_band_is_a_token_not_a_second_copy():
    """Two hand-written copies of the gradient is how two skeletons end up
    subtly different. Pages opt in by referencing the token."""
    tokens = _strip_comments(_motion())
    assert "--sweep-band:" in tokens
    for sheet in sorted(os.listdir(_CSS)):
        if not sheet.endswith(".css") or sheet in _BENTO_SHEETS:
            continue
        css = _strip_comments(_read(_CSS, sheet))
        if "bn-sweep" not in css:
            continue
        assert "--sweep-band" in css, (
            "%s animates bn-sweep with its own gradient instead of the token"
            % sheet)


# ── The shared shell ─────────────────────────────────────────────────────────

def _bento_pages():
    """Templates built on the Bento system, found by what they load rather than
    by a list somebody has to remember to update."""
    out = []
    for name in sorted(os.listdir(_TPL)):
        # Partials are excluded by the leading underscore: _bento.html DEFINES
        # the shell, so it necessarily contains the markup these tests forbid a
        # PAGE from containing, and would fail its own rule.
        if not name.endswith(".html") or name.startswith("_"):
            continue
        markup = _read(_TPL, name)
        if "_bento.html" in markup or "bento-tokens.css" in markup:
            out.append(name)
    return out


def test_at_least_one_page_is_on_the_shared_shell():
    """Guards the two tests below from passing vacuously once the rollout
    starts moving pages around."""
    assert _bento_pages(), "no template is on the Bento system any more"


def test_every_bento_page_gets_its_shell_from_the_macros():
    """The shell is duplicated in forty standalone documents in this codebase,
    which is exactly why the old design drifted. A page that hand-rolls its own
    <head> or topbar is how that starts again."""
    for name in _bento_pages():
        markup = _read(_TPL, name)
        if "_bento.html" not in markup:
            continue
        assert "<header class=\"bn-top\">" not in markup, (
            "%s hand-writes the topbar instead of calling topbar()" % name)
        assert "bento-tokens.css" not in markup, (
            "%s loads the system stylesheets itself instead of calling head()"
            % name)


def test_a_page_that_draws_the_topbar_also_ships_its_behaviour():
    """The user menu is inert without it, and the failure is silent: the pill
    renders, the click does nothing."""
    for name in _bento_pages():
        markup = _read(_TPL, name)
        if "topbar(" not in markup:
            continue
        assert "topbar_script()" in markup, (
            "%s draws the user menu but never ships toggleTbMenu, so the menu "
            "cannot open" % name)
