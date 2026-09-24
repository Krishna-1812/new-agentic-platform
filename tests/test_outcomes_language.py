"""The product in the Outcomes language.

The platform takes its look from the sister company's site (outcomes.digital,
measured in a browser on 2026-09-24): warm paper ground, white cards, colour in
whole blocks (orange, amber, sky, red, ink), pill controls, Zalando Sans for
text -- with one thing kept exactly as it was: the headings are Fraunces,
semi-bold, SOFT 0 / WONK 1 / opsz 144.

Checked by eye in a real browser at 1440px and 390px across every app page,
the public site, the ABM dashboard and Ad Intelligence, with an automated pass
for leftover dark panels and text under 4.5:1. What that review cannot keep
true on its own is pinned here.
"""

import os
import re
import subprocess

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(_ROOT, *parts), encoding="utf-8") as f:
        return f.read()


def _strip(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def _tracked(*globs):
    out = subprocess.check_output(["git", "ls-files", *globs], cwd=_ROOT).decode().split()
    return [f for f in out if os.path.exists(os.path.join(_ROOT, f))]


# ── Tokens ──────────────────────────────────────────────────────────────────

def test_the_ground_is_paper_and_the_accent_is_orange():
    t = _strip(_read("static", "css", "bento-tokens.css"))
    for decl in ("--bg:      #F1EFED", "--s1:      #FFFFFF", "--tx:      #121213",
                 "--acc:     #FF6022", "--sky:     #8CCBFF", "--cream:   #FFB500",
                 "--clay:    #FF3B30"):
        assert decl in t, decl


def test_every_accent_has_a_text_safe_shade():
    """The block colours fail as text on white (sky 1.7:1, amber 1.8:1,
    orange 3.0:1). Pages set accent-coloured text through these instead."""
    t = _strip(_read("static", "css", "bento-tokens.css"))
    for decl in ("--acc-tx:   #B83C0C", "--clay-tx:  #C8261B",
                 "--sky-tx:   #1D65A6", "--cream-tx: #8A5A00"):
        assert decl in t, decl


def test_no_page_sets_a_raw_block_colour_as_text():
    rx = re.compile(r"(?<![-\w])color\s*:\s*var\(--(acc|sky|clay|cream)\)")
    offenders = []
    for f in _tracked("static/css/*.css", "templates/*.html", "static/js/*.js"):
        if f.endswith(("press.css", "bento-tokens.css", "bento-compat.css")) or "agents.html" in f:
            continue
        if rx.search(_read(f)):
            offenders.append(f)
    assert not offenders, offenders


# ── Type ────────────────────────────────────────────────────────────────────

def test_the_shells_load_fraunces_and_zalando_and_nothing_older():
    for tpl in ("_bento.html", "app_base.html", "client_base.html", "agents.html"):
        html = _read("templates", tpl)
        assert "family=Fraunces" in html and "Zalando+Sans" in html, tpl
        for old in ("Familjen+Grotesk", "Instrument+Sans", "family=Inter", "family=Sora"):
            assert old not in html, (tpl, old)


def test_headings_keep_the_public_sites_fraunces_settings():
    t = _strip(_read("static", "css", "bento-tokens.css"))
    assert "--font-display: 'Fraunces'" in t
    assert "--display-axes: 'SOFT' 0, 'WONK' 1, 'opsz' 144" in t
    assert "--display-weight: 600" in t
    compat = _strip(_read("static", "css", "bento-compat.css"))
    assert re.search(r"body h1 \{[^}]*var\(--font-display\) !important", compat)


def test_no_page_names_a_font_that_is_never_loaded():
    rx = re.compile(r"font-family\s*:[^;}\"]*(Space Grotesk|JetBrains Mono|Instrument Serif|Bricolage|Familjen|Instrument Sans|'Sora'|'Inter')")
    offenders = [f for f in _tracked("static/css/*.css", "templates/*.html", "static/js/*.js")
                 if rx.search(_read(f))]
    assert not offenders, offenders


# ── Two bugs this redesign found ────────────────────────────────────────────

def test_no_stylesheet_redefines_a_surface_token_in_terms_of_itself():
    """`--s2: var(--s2)` is a cycle; the browser discards it and every var()
    falls back. The LinkedIn page lost all its card backgrounds this way, and
    the assistant widget drew the old dark palette on every page."""
    rx = re.compile(r"--(s1|s2|s3|bg)\s*:\s*var\(--(s1|s2|s3|bg)\b")
    for f in ("static/css/linkedin.css", "templates/ppc_chat_widget.html"):
        assert not rx.search(_strip(_read(f))), f


def test_the_reveal_does_not_leave_a_clip_on_its_element():
    """Holding the wipe's last frame left a 16px rounded clip on the element,
    which shaved the first letter off corner-aligned text."""
    m = _strip(_read("static", "css", "bento-motion.css"))
    assert re.search(r"\.bn-wipe \{\s*animation: bn-wipe [^;]*backwards;", m)
    assert re.search(r"\.bn-armed\.bn-shown\s*\{\s*clip-path: none;", m)


# ── The banned effects stay out ─────────────────────────────────────────────

def test_no_card_or_row_is_staggered_by_index():
    """The staggered card entrance: a per-index delay on cards, rows or
    list items, set from script or CSS."""
    patterns = (
        r"animation-delay:'\s*\+",                       # string-built inline delay
        r"animation-delay:\$\{",                        # template literal
        r"transitionDelay\s*=\s*Math\.min\(i\s*\*",       # scroll reveal per index
        r"setTimeout\(function\(\)\{\s*c\.classList\.add\('visible'\);\s*\},\s*i\s*\*",
        r"animation-delay:\s*calc\(var\(--i",             # CSS index variable
    )
    offenders = []
    for f in _tracked("static/css/*.css", "static/js/*.js", "templates/*.html"):
        src = _read(f)
        for p in patterns:
            if re.search(p, src):
                offenders.append((f, p))
    assert not offenders, offenders


def test_no_conic_ring_anywhere_in_the_product():
    offenders = [f for f in _tracked("static/css/*.css", "templates/*.html", "static/js/*.js")
                 if "conic-gradient(" in _strip(_read(f))]
    assert not offenders, offenders
