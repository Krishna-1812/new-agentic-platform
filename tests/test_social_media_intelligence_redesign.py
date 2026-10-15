"""Social Media Intelligence on the Outcomes design language.

The page and the report were rebuilt as a Bento page: an ink hero with a platform mosaic and a command bar, a
live view of a run in flight, History as cards, and the report as a full-screen sheet with its platform tabs
pinned beside it. These pin the parts a later edit could quietly break: every class the script writes has a
rule, every platform has its colour, a run in flight is followed from History, the report keeps its header
and its way back, and the page no longer leans on the legacy compatibility sheet.
"""

import json
import os
import re
import shutil
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

from test_social_media_intelligence_datasources import _extract_fn, _page_html  # noqa: E402

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CSS = os.path.join(_ROOT, "static", "css", "social_media_intelligence.css")

needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="node is needed to execute the page script")


def _src():
    """The template as written, before Jinja: the shared top bar and the assistant widget are not this page's."""
    with open(os.path.join(_ROOT, "templates", "social_media_intelligence.html"), encoding="utf-8") as f:
        return f.read()


def _css():
    return re.sub(r"/\*.*?\*/", "", open(_CSS, encoding="utf-8").read(), flags=re.S)


# ── The stylesheet covers the markup ───────────────────────────────────────

# Hooks the script reads or sets but that carry no rule of their own, plus the stems of class names the
# script builds from a value (sci-c + 0..5, rd-stance-<key>, ...).
_HOOKS = {"bento-in", "r-by", "sci-c", "sci-datasrc", "sci-field-main", "sci-hero-copy", "sci-hist", "sci-mt-wide",
          "sci-panes-more", "sci-postsec", "sci-printing", "sci-rd-s", "sci-seg-sm", "st", "visible"}


def test_every_class_the_page_writes_has_a_rule():
    page = _src()
    used = set()
    for m in re.finditer(r"""class=\\?["']([^"']+)["']""", page):
        for k in m.group(1).split():
            if re.match(r"^[a-z][a-z0-9_-]*$", k) and not k.endswith("-"):
                used.add(k)
    for m in re.finditer(r"classList\.(?:add|remove|toggle|contains)\('([a-z0-9_-]+)'", page):
        used.add(m.group(1))
    defined = set(re.findall(r"\.([a-zA-Z][\w-]*)", _css()))
    missing = sorted(k for k in used if k not in defined and k not in _HOOKS)
    assert not missing, "classes with no rule in social_media_intelligence.css: %s" % missing


def test_every_platform_has_its_own_colour():
    css = _css()
    for platform in ("instagram", "linkedin", "x", "tiktok", "youtube", "facebook", "reddit"):
        assert re.search(r'\[data-platform="%s"\]\s*\{\s*--pf-color:\s*#[0-9A-Fa-f]{6}' % platform, css), platform


def test_the_page_is_on_bento_alone():
    """No compatibility sheet, no light/dark pair, and no rule redefining the shared shell or bar."""
    page = _src()
    assert "compat=True" not in page, "the page loads bento-compat.css again"
    css = _css()
    assert "data-theme" not in css, "a light/dark override is back: the system is one theme"
    for shared in (".bn-shell", ".bn-top"):
        assert shared + " {" not in css and shared + "{" not in css
    # The old page background gradients and the grain overlay are gone for good.
    assert "sci-aurora" not in page and "sci-grain" not in page


def test_the_report_scrolls_as_one_sheet_with_the_tabs_pinned():
    css = _css()
    sheet = re.search(r"\.sci-drawer-overlay\s*\{([^}]*)\}", css).group(1)
    assert "overflow-y: auto" in sheet and "position: fixed" in sheet
    nav = re.search(r"\.sci-nav\s*\{([^}]*)\}", css).group(1)
    assert "position: sticky" in nav
    panes = re.search(r"\.sci-panes\s*\{([^}]*)\}", css).group(1)
    assert "overflow" not in panes, "a pane that scrolls inside the sheet would hide behind the ink header"


def test_a_running_run_in_history_is_followed_not_opened_as_a_report():
    page = _src()
    assert "followRun(" in page
    assert re.search(r"if r\.status == 'running' else", page), "History does not route a running run to followRun"
    # The live view's four stages are in the markup the script drives.
    assert page.count('class="sci-step"') == 4


def test_one_escape_closes_the_post_detail_and_leaves_the_report_open():
    page = _src()
    start = page.index("function closeCreativeDetail")
    block = page[start:page.index("function renderPostsSection", start)]
    assert "stopImmediatePropagation()" in block


# ── The script ─────────────────────────────────────────────────────────────

_STEPS_SHIM = """
function li(i){ return {i: i, cls: {}, classList: {toggle: function(c, on){ this._o[c] = on; }, _o: {}}}; }
var __items = [li(0), li(1), li(2), li(3)];
__items.forEach(function(x){ x.classList._o = {}; });
global.document = { getElementById: function(id){
  if(id === 'liveSteps') return {querySelectorAll: function(){ return __items; }};
  return null;
} };
function states(){ return __items.map(function(x){ return x.classList._o['is-done'] ? 'done' : (x.classList._o['is-on'] ? 'on' : 'todo'); }); }
"""


def _stage(platforms):
    html = _page_html()
    js = _STEPS_SHIM + "\n" + _extract_fn(html, "renderLiveSteps") + \
        "\nrenderLiveSteps(" + json.dumps(platforms) + ");\nconsole.log(JSON.stringify(states()));"
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr[-1500:]
    return json.loads(r.stdout.strip().splitlines()[-1])


@needs_node
def test_the_live_stages_follow_what_the_platform_rows_say():
    P = lambda status, analyzed=None: {"platform": "x", "status": status, "analyzed_at": analyzed}  # noqa: E731
    assert _stage([]) == ["on", "todo", "todo", "todo"], "no accounts yet is the find stage"
    assert _stage([P("collecting"), P("pending")]) == ["done", "on", "todo", "todo"]
    assert _stage([P("ok", "2026-10-01T00:00:00Z"), P("identifying")]) == ["done", "on", "todo", "todo"]
    assert _stage([P("ok"), P("scrape_failed")]) == ["done", "done", "on", "todo"], "collected, not yet read"
    assert _stage([P("ok", "2026-10-01T00:00:00Z"), P("no_presence")]) == ["done", "done", "done", "on"]


@needs_node
def test_the_report_has_its_ink_header_its_way_back_and_its_close_button():
    from test_sci_report_behaviour import _run, _render_run_probe
    html = _run(_render_run_probe("html;"))
    assert 'class="sci-rep"' in html and 'class="sci-rep-head"' in html
    assert 'class="sci-nav-back"' in html and "All analyses" in html
    assert html.count('class="sci-drawer-close"') == 1 and 'aria-label="Close report"' in html
    # The way back sits ahead of the tabs and is not one of them.
    assert html.index("sci-nav-back") < html.index('class="sci-nav-item active"')


def test_the_thumbs_widget_is_loaded_and_styled_here_not_by_the_compat_sheet():
    """The report writes a thumbs control at the foot of every pane through window.agentFeedbackHtml, which
    only exists once agent_feedback.js has loaded. It never was loaded on this page, so no one could rate a
    pane. The shared agent-feedback.css speaks the compat vocabulary (--sp3, --b1 ...) this page no longer
    loads, so the control is styled in this page's own sheet instead."""
    head = _src()[:_src().index("</head>")]
    assert '"agent_feedback.js"' in head
    assert "agent-feedback.css" not in head
    css = _css()
    for cls in (".agent-fb", ".agent-fb-btn", ".agent-fb-reason-input", ".agent-fb-reason-send"):
        assert ".sci " + cls in css, cls
    # Both thumbs carry a drawn icon: an empty button is not a control anyone can find.
    js = open(os.path.join(_ROOT, "static", "js", "agent_feedback.js"), encoding="utf-8").read()
    assert js.count('<svg viewBox="0 0 24 24"') >= 2


# ── Company suggestions are optional ───────────────────────────────────────

def _suggestions(error, companies=None, admin=False):
    html = _page_html()
    from test_social_media_intelligence_datasources import _extract_line_fn
    src = "\n".join([
        "var IS_ADMIN = %s;" % ("true" if admin else "false"),
        "global.document = {getElementById: function(){ return __panel; }}; global.window = {};",
        "var __panel = {innerHTML: '', style: {}};",
        _extract_line_fn(html, "esc"),
        _extract_fn(html, "sciSuggestRow"),
        _extract_fn(html, "sciAdminDiagControl"),
        _extract_fn(html, "renderCompanySuggestions"),
    ])
    js = src + "\nrenderCompanySuggestions(%s, %s, 'acme');\nconsole.log(JSON.stringify(__panel.innerHTML));" % (
        json.dumps(companies or []), json.dumps(error))
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr[-1500:]
    return json.loads(r.stdout.strip().splitlines()[-1])


@needs_node
def test_a_missing_apollo_key_is_a_quiet_note_not_a_red_alarm():
    """Suggestions are a convenience: a run never calls Apollo (identify uses the web). With no key the page
    says suggestions are off and that the form still works, and only an admin is told which variable."""
    err = {"code": "not_configured", "message": "Company search is not configured on this deployment: APOLLO_API_KEY is missing.",
           "detail": "APOLLO_API_KEY is not set on this deployment."}
    member = _suggestions(err)
    assert "sci-suggest-note" in member and "sci-suggest-error" not in member
    assert "press Analyze" in member
    assert "APOLLO_API_KEY" not in member, "a member is not shown an environment variable"
    admin = _suggestions(err, admin=True)
    assert "sci-suggest-note" in admin and "APOLLO_API_KEY" in admin and "sci-suggest-error" not in admin


@needs_node
def test_a_real_provider_failure_is_still_an_error():
    out = _suggestions({"code": "http", "message": "Apollo rejected our API key (HTTP 401).", "detail": "HTTP 401"})
    assert "sci-suggest-error" in out and "HTTP 401" in out
