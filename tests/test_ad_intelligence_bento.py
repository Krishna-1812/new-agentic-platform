"""Ad Intelligence (apps/ad-intelligence, built into ad_intelligence/) in the
Outcomes language.

(File name kept from the earlier Bento redesign.) The app was rebuilt at the
source: Tailwind's families are back in their natural light order and point at
the Outcomes colours (orange primary, sky, amber, red, green), the stylesheet
carries the light tokens and a small light-first layer, headings are Fraunces
and text is Zalando Sans, and the previous product's motion stays cut out of the
components. The injected chat widget (scripts/ad_intelligence_widget.html) got
the same treatment: an orange disc opening a white card.

Checked in a real browser at 1440px and 390px: all five tabs, the ad modal
and the open widget, zero script errors, no horizontal overflow at 390px.
Recorded here rather than automated; what is pinned below is what a later
edit could quietly undo.
"""

import glob
import os
import re

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_APP = os.path.join(_ROOT, "apps", "ad-intelligence")


def _read(*parts):
    with open(os.path.join(_ROOT, *parts), encoding="utf-8") as f:
        return f.read()


def _sources():
    out = {}
    for f in glob.glob(os.path.join(_APP, "src", "**", "*.tsx"), recursive=True):
        with open(f, encoding="utf-8") as fh:
            out[os.path.relpath(f, _ROOT)] = fh.read()
    return out


def _css():
    return re.sub(r"/\*.*?\*/", "", _read("apps", "ad-intelligence", "src", "index.css"), flags=re.S)


# ── The banned card entrance ────────────────────────────────────────────────

def test_no_component_staggers_by_index():
    """The staggered fade-and-lift: a delay-N class per card, or an inline
    animationDelay computed from the item's index."""
    for path, src in _sources().items():
        assert not re.search(r"\bdelay-\d+\b", src), path
        assert "animationDelay" not in src, path


def test_the_stylesheet_has_one_motion():
    css = _css()
    keyframes = re.findall(r"@keyframes\s+([\w-]+)", css)
    assert keyframes == ["bn-fade"], keyframes
    assert re.search(r"@keyframes bn-fade\s*\{\s*from\s*\{\s*opacity:\s*0;\s*\}\s*to\s*\{\s*opacity:\s*1;\s*\}\s*\}", css)
    assert "translateY" not in css and "conic-gradient" not in css


def test_the_old_effect_classes_are_gone_from_the_components():
    gone = ("spotlight", "shine-on-hover", "card-glow", "card-lift", "bg-orbs", "dot-bg",
            "stat-shimmer", "cta-shine", "anim-float", "anim-breathe", "title-reveal",
            "gradient-text-anim", "header-glow", "tilt-hover")
    for path, src in _sources().items():
        for cls in gone:
            assert not re.search(r"[\"'` ]%s[\"'` ]" % re.escape(cls), src), (path, cls)


# ── Palette and type ────────────────────────────────────────────────────────

def test_tailwind_families_point_at_the_outcomes_colours():
    cfg = _read("apps", "ad-intelligence", "tailwind.config.js")
    for hex_ in ("#FF6022", "#8CCBFF", "#FFB500", "#FF3B30", "#17753F", "#121213", "#F1EFED"):
        assert hex_ in cfg, hex_
    for fam in ("indigo: orange", "violet: orange", "blue: sky", "emerald: green", "amber: amber", "slate: ink"):
        assert fam in cfg, fam
    assert "Fraunces" in cfg and '"Zalando Sans"' in cfg
    assert "Familjen" not in cfg and "Instrument Sans" not in cfg


def test_the_text_shades_are_text_safe():
    """Light-first components set their links and labels in 600/700."""
    cfg = _read("apps", "ad-intelligence", "tailwind.config.js")
    assert "600:'#C4410F', 700:'#B83C0C'" in cfg      # orange
    assert "600:'#1D65A6', 700:'#1D65A6'" in cfg      # sky


def test_the_previous_accent_colours_are_gone_from_the_source():
    old = ("#6366f1", "#8b5cf6", "#4f46e5", "#818cf8", "#a78bfa", "rgba(99,102,241")
    for path, src in _sources().items():
        low = src.lower()
        for o in old:
            assert o not in low, (path, o)


def test_competitors_have_three_distinct_outcomes_colours():
    types = _read("apps", "ad-intelligence", "src", "lib", "types.ts")
    block = types[types.index("export const COMPETITOR_COLORS"):]
    colours = re.findall(r"'(#[0-9A-Fa-f]{6})'", block.split("};")[0])
    assert sorted(colours) == sorted(["#8CCBFF", "#FFB500", "#FF6022"])
    assert "export const tx = " in types, "colour-as-text needs the text-safe helper"


def test_the_page_loads_the_outcomes_type_faces():
    html = _read("apps", "ad-intelligence", "index.html")
    assert "family=Fraunces" in html and "Zalando+Sans" in html
    assert "family=Inter" not in html and "Familjen" not in html


def test_no_admin_email_is_baked_into_the_bundle_source():
    """Admin links follow /api/whoami's is_admin (ADMIN_EMAILS), not a list."""
    app = _read("apps", "ad-intelligence", "src", "App.tsx")
    assert "@markifydigital.com" not in app
    assert "is_admin" in app


# ── The chat widget ─────────────────────────────────────────────────────────

def test_the_widget_has_no_spinning_ring_or_orb_rings():
    w = _read("scripts", "ad_intelligence_widget.html")
    assert "conic-gradient" not in w
    assert "ppc-ring-spin" not in w
    assert 'class="ppc-orb-ring' not in w
    assert "Space Grotesk" not in w
    assert "Familjen" not in w and "Instrument Sans" not in w


def test_the_widget_button_is_the_orange_disc():
    w = _read("scripts", "ad_intelligence_widget.html")
    style = w[:w.index("</style>")]
    last_btn = style.rindex("#ppc-btn {")
    assert "#FF6022" in style[last_btn:last_btn + 200]


# ── The served build matches the source ────────────────────────────────────

def test_the_served_bundle_is_the_bento_build():
    assets = os.path.join(_ROOT, "ad_intelligence", "assets")
    css = [f for f in os.listdir(assets) if f.endswith(".css")]
    assert len(css) == 1
    built = open(os.path.join(assets, css[0]), encoding="utf-8").read()
    assert "bn-fade" in built and "bn-tile--fill" in built
    served = _read("ad_intelligence", "index.html")
    assert "conic-gradient" not in served, "the injected widget is the pre-Bento copy"
