"""The public site, and the three ways its design system goes wrong.

static/css/press.css is a SECOND design system, not a variant of the first.
The product is a dark, dense instrument; the public site is warm paper, a
serif at display sizes, square corners and rules instead of fills. The two
share one material on purpose -- Familjen Grotesk, and the lime -- and
nothing else.

That separation is the thing these tests protect, because the failure mode is
not a crash. It is drift: somebody reaches for --page-pad on a marketing page
because it is the token they know, and six months later the two systems are
one mediocre system. Every check here is a file-level check for that.

The other two are traps this rebuild actually fell into, recorded so they do
not have to be found twice:

  - A clip-path reveal must never sit on the element an IntersectionObserver
    is watching. Chromium folds a target's own clip-path into the rect it
    reports, so an element clipped to zero width never intersects, never gets
    its class, and waits forever. The figure simply never appears, with no
    error anywhere.
  - Every hidden state has to be gated on html.js, so a page whose script has
    not run yet shows finished type rather than an empty column.
"""

import os
import re

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CSS = os.path.join(_ROOT, "static", "css")
_TPL = os.path.join(_ROOT, "templates")

# Every template on the public site. Listed explicitly so a new marketing page
# has to be added here on purpose rather than quietly skipped.
PRESS_TEMPLATES = ("agents.html", "login_preview.html")


def _read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as fh:
        return fh.read()


def _press():
    return _read(_CSS, "press.css")


def _strip_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


# ── Two systems, not one ─────────────────────────────────────────────────────

def test_press_is_on_neither_of_the_products_two_grids():
    """test_agent_page_grid.py sorts every PRODUCT sheet into Arena or Bento
    and says a page can never sit on neither. The public site is the one
    deliberate exception, so it has to be held to the opposite rule: it must
    use neither vocabulary, or it is half-migrated into a system it was never
    meant to join."""
    css = _strip_comments(_press())
    for token in ("var(--margin-app)", "var(--bleed)", "var(--gutter)",
                  "var(--page-pad)", "var(--topbar-h)"):
        assert token not in css, "press.css borrows the product token %s" % token


@pytest.mark.parametrize("name", PRESS_TEMPLATES)
def test_a_public_page_loads_press_and_nothing_else(name):
    """A marketing page that also pulls bento-tokens.css inherits the dark
    ground and the 12px radius under a light editorial layout, which is worse
    than either system on its own."""
    markup = _read(_TPL, name)
    assert "press.css" in markup, "%s does not load the public site's system" % name
    for sheet in ("bento-tokens.css", "bento-components.css", "ds-tokens.css",
                  "ds-components.css", "aurora.css", "aurora-app.css", "grid-tokens.css"):
        assert sheet not in markup, "%s still loads %s" % (name, sheet)


@pytest.mark.parametrize("name", PRESS_TEMPLATES)
def test_the_public_site_ships_no_animation_libraries(name):
    """The pages this replaced pulled three.js, GSAP and Lenis off three CDNs
    -- about 700KB -- to decorate a scroll. The motion is CSS now, and the
    only third-party script left is Google's sign-in."""
    markup = _read(_TPL, name)
    for lib in ("three.min.js", "gsap", "lenis", "cdn.jsdelivr.net"):
        assert lib not in markup, "%s still loads %s" % (name, lib)


def test_the_shared_material_is_deliberate():
    """The two systems are meant to share exactly two things, and a reader of
    either stylesheet should be able to see which. If this ever fails it means
    somebody widened the overlap without saying so."""
    css = _strip_comments(_press())
    assert "Familjen Grotesk" in css, "the public site dropped the shared text face"
    assert "#C6F24E" in css, "the public site dropped the shared accent"
    assert "Fraunces" in css, "the public site's display face is gone"
    # The product has no serif and no display face but Familjen Grotesk; the
    # site is the only place Fraunces may appear.
    for sheet in ("bento-tokens.css", "bento-components.css"):
        assert "Fraunces" not in _read(_CSS, sheet), (
            "%s has picked up the public site's display face" % sheet)


# ── The clip-path / IntersectionObserver trap ────────────────────────────────

@pytest.mark.parametrize("name", PRESS_TEMPLATES)
def test_no_wipe_sits_on_the_element_that_is_observed(name):
    """`class="rv wipe"` renders an empty rectangle forever.

    .rv is what the script watches; .wipe clips its element to zero width
    until the script adds .in. Chromium intersects a target's own clip-path
    into the rect it hands IntersectionObserver, so a zero-width target never
    reports as intersecting and the callback that would un-clip it never runs.
    The wipe belongs on a CHILD of the observed element."""
    markup = _read(_TPL, name)
    for m in re.finditer(r'class="([^"]*\brv\b[^"]*)"', markup):
        assert "wipe" not in m.group(1).split(), (
            "%s clips the element it observes: class=%r" % (name, m.group(1)))


def test_the_wipe_rule_only_matches_a_child():
    """The template-side check above is only half of it: if press.css itself
    still offers `.wipe.in`, the pattern stays one edit away from coming back."""
    css = _strip_comments(_press())
    assert ".wipe.in" not in css.replace(" ", ""), (
        "press.css still un-clips a .wipe on the observed element itself")
    assert ".in > .wipe" in css or ".in .wipe" in css, "the wipe never un-clips at all"


# ── The no-JS contract ───────────────────────────────────────────────────────

@pytest.mark.parametrize("hidden_state", [
    (".ln > span", "transform"),
    (".rule", "transform"),
    (".wipe", "clip-path"),
    (".fade", "opacity"),
])
def test_every_hidden_state_is_released_without_javascript(hidden_state):
    """The asymmetry that matters: a fade that never runs leaves content
    visible, a mask or a clip that never runs leaves the page blank with no
    error. So each hidden state needs a matching html:not(.js) escape, and the
    .js class is written by an inline script before first paint."""
    selector, prop = hidden_state
    css = _strip_comments(_press())
    pattern = r"html:not\(\.js\)\s+%s\s*\{[^}]*%s" % (re.escape(selector), re.escape(prop))
    assert re.search(pattern, css), (
        "no html:not(.js) escape for %s -- a page whose script never runs "
        "renders it hidden" % selector)


@pytest.mark.parametrize("name", PRESS_TEMPLATES)
def test_the_js_class_is_set_before_the_first_stylesheet_paints(name):
    """If the .js class were added at the end of the body the reveal states
    would arm after first paint, which is a flash of finished type that then
    hides itself."""
    markup = _read(_TPL, name)
    marker = "document.documentElement.className+=' js'"
    assert marker in markup, "%s never sets the .js class" % name
    assert markup.index(marker) < markup.index("<body"), (
        "%s sets the .js class after <body>, so the reveal states arm too late" % name)


@pytest.mark.parametrize("hidden_state", [".ln > span", ".rule", ".wipe", ".fade"])
def test_reduced_motion_releases_the_hidden_state_rather_than_freezing_it(hidden_state):
    """Setting animation-duration to 0.01ms under prefers-reduced-motion does
    NOT help a transform or a clip that is applied as a resting state: it
    freezes the page in the hidden half. The reduced-motion block has to
    un-hide, not just stop."""
    css = _strip_comments(_press())
    m = re.search(r"@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{(.*?)\n\}\n", css, re.S)
    assert m, "press.css has no reduced-motion block"
    block = m.group(1)
    assert re.search(r"%s\s*\{[^}]*(transform|clip-path|opacity)[^}]*!important"
                     % re.escape(hidden_state), block), (
        "reduced motion does not release %s; it would stay hidden" % hidden_state)


# ── Rule 3: the site is square ───────────────────────────────────────────────

def test_the_only_rounded_thing_is_the_marker():
    """Rule 3 of the system: --r is 0, and the one exception is the marker
    highlight, whose unequal radii are meant to read as a hand rather than a
    component. A second rounded object is the first step back towards the
    product's shape language."""
    css = _strip_comments(_press())
    assert re.search(r"--r:\s*0\s*;", css), "press.css no longer sets --r to 0"
    # The product figures are authored in the PRODUCT's tokens on purpose (they
    # ARE the product), so their 12px radii are excluded by name.
    body = re.sub(r"\.(shot|acct)[^{]*\{[^}]*\}", "", css)
    strays = [d for d in re.findall(r"border-radius:\s*([^;}]+)", body)
              if "var(--r" not in d and d.strip() not in ("0", "50%")]
    assert not strays, "press.css rounds something other than the marker: %r" % strays
