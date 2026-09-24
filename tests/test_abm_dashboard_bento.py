"""The Healthcare ABM dashboard (reports/dashboard.html) in the Outcomes language.

(File name kept from the earlier Bento redesign; the dashboard now carries the
light Outcomes language taken from outcomes.digital -- paper ground, white
cards, orange / sky / amber / red blocks, Fraunces headings, Zalando Sans.)

The file is hand-customised and its `const DATA = ...;` line is replaced every
week by scripts/refresh-dashboards.py, so the redesign was done in place: its
palette literals were remapped once to the Outcomes palette, the old decoration and
motion were cut out of the source, and static/css/abm-dashboard.css — linked
last in <head> — carries the rest.

What a visual review cannot keep true on its own is pinned here: the refresh
markers survive, the banned card entrance is gone from the source (not just
overridden), the old assistant name does not show, and the phone layout the
file's own rules could not reach stays reachable.

The rendered checks were done in a real browser (1440px and 390px, every
section, the refresh and KPI modals, zero script errors, no horizontal
overflow at 390px) and are recorded here rather than automated.
"""

import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
_DASH = _ROOT / "reports" / "dashboard.html"
_SKIN = _ROOT / "static" / "css" / "abm-dashboard.css"


def _code():
    """The dashboard without its data line, so company names and signal text
    can never make an assertion pass or fail."""
    return re.sub(r"^const DATA = .*;$", "", _DASH.read_text(encoding="utf-8"), flags=re.M)


def _skin():
    return re.sub(r"/\*.*?\*/", "", _SKIN.read_text(encoding="utf-8"), flags=re.S)


# ── The weekly refresh can still splice into it ─────────────────────────────

def test_refresh_markers_survive():
    src = _DASH.read_text(encoding="utf-8")
    for marker in ("INSIGHTS v10 JS", 'id="vimi-plat"'):
        assert marker in src
    assert len(re.findall(r"^const DATA = .*;$", src, re.M)) == 1


# ── Bento skin is wired in, last ────────────────────────────────────────────

def test_the_skin_is_linked_after_every_style_block():
    head = _code().split("</head>")[0]
    link = head.rfind("/static/css/abm-dashboard.css")
    assert link != -1
    assert head.rfind("<style") < link, "a <style> block after the skin would override it"


def test_the_outcomes_type_faces_are_loaded_and_the_old_ones_are_not():
    head = _code().split("</head>")[0]
    assert "family=Fraunces" in head and "Zalando+Sans" in head
    for old in ("Familjen+Grotesk", "Instrument+Sans", "Space+Grotesk"):
        assert old not in head, old


def test_the_favicon_is_the_current_version():
    assert "/favicon.svg?v=7" in _code()
    assert "/favicon.svg?v=6" not in _code()


def test_the_ground_is_light_and_the_first_kpi_is_the_orange_block():
    skin = _skin()
    root = skin[skin.index(":root"):skin.index("}", skin.index(":root"))]
    assert "--bg: #F1EFED" in root and "--card: #FFFFFF" in root and "--text: #121213" in root
    assert "--abm-acc: #FF6022" in root
    assert re.search(r"\.kpi-card:first-child \{\s*background: var\(--abm-acc\)", skin)


def test_no_script_staggers_the_feed_rows_or_sidebar():
    """The feed, table rows and sidebar items were brought in one after another
    from script (a delay per index), which the CSS could not fully undo."""
    code = _code()
    assert "i * 38" not in code and "i * 16" not in code and "i * 44" not in code
    assert "transitionDelay = (i * 55)" not in code
    assert "function staggerSignals() {}" in code


def test_the_crossfade_wrapper_passes_the_clicked_tab_through():
    """A wrapper around showSection dropped its second argument, so no sidebar
    tab was ever marked active."""
    code = _code()
    assert "window.showSection = function(name, btn)" in code
    assert "origShow(name);" not in code


# ── The banned card entrance is removed, not just overridden ───────────────

def test_no_staggered_entrance_by_nth_child():
    code = _code()
    assert not re.search(r"\.kpi-card:nth-child\(\d+\)\{animation-delay", code)
    assert not re.search(r"\.nav-item:nth-child\(\d+\)\{animation:", code)


def test_no_per_index_animation_delay_in_rendered_cards():
    """Insights cards used to carry style="animation-delay:'+(i*.06)+'s", one
    step later per card: the staggered fade-and-lift the brief bans."""
    assert not re.search(r"animation-delay:'\s*\+\s*\(\s*[ij]\s*\*", _code())


def test_the_skin_allows_only_one_motion():
    skin = _skin()
    assert re.search(r"@keyframes abm-fade\s*\{\s*from\s*\{\s*opacity:\s*0;?\s*\}\s*to\s*\{\s*opacity:\s*1;?\s*\}\s*\}", skin)
    assert "translateY" not in skin
    assert "conic-gradient" not in skin


def test_no_decorative_mesh_orbs_or_blobs_are_created():
    code = _code()
    assert "document.createElement('div'); m.id = 'ev3-mesh-bg'" not in code
    assert 'class="ir9-eorb"' not in code
    assert 'class="ir9-lorb"' not in code
    assert 'class="ir9-blob' not in code


# ── Identity ────────────────────────────────────────────────────────────────

def test_the_old_assistant_name_is_gone():
    assert "VIMI" not in _code()


def test_there_is_no_account_switcher_with_one_account():
    assert "Switch Account" not in _code()


def test_navigation_uses_line_icons_not_emoji():
    code = _code()
    nav = code[code.index('<nav id="sidebar">'):code.index("</nav>")]
    tabs = code[code.index('<div id="bottom-tabs">'):code.index("<!-- KPI Modal -->")]
    for block in (nav, tabs):
        assert not re.search("[\U0001F300-\U0001FAFF]", block)
        assert "<svg" in block


def test_the_old_palette_is_gone_outside_the_data():
    """The previous product's indigo/violet family, remapped to Bento hues."""
    code = _code().lower()
    for old in ("#6366f1", "#4f46e5", "#8b5cf6", "#7c3aed", "#a5b4fc", "#818cf8",
                "rgba(99,102,241", "rgba(129,140,248", "rgba(139,92,246"):
        assert old not in code, old


# ── The phone layout is reachable ───────────────────────────────────────────

def test_the_phone_layout_overrides_the_pinned_sidebar_margin():
    """A later `#main{margin-left:var(--sb-w)!important}` in the file beat its
    own mobile rules, so at 390px the page ran ~1,190px wide. The skin has to
    win that fight below the breakpoint."""
    skin = _skin()
    m = re.search(r"@media \(max-width: 820px\) \{(.*?)\n\}", skin, re.S)
    assert m, "no phone block in the skin"
    block = m.group(1)
    assert re.search(r"html body #main \{[^}]*margin-left: 0 !important", block)
    assert re.search(r"html body #sidebar \{[^}]*display: none !important", block)
    assert re.search(r"html body #bottom-tabs \{[^}]*display: flex !important", block)
