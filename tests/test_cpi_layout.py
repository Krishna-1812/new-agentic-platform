"""Results and assistant, side by side.

Picking the table used to add `wide` to .cpi-layout, which dropped the
assistant below the results. The view is remembered, so one visit in table
view left the page stacked on every visit after it, with nothing on screen
saying why or how to undo it.

The reason it survived the existing table-view tests is worth stating: that
driver's DOM shim answers document.querySelector() with null for everything,
so the line doing the damage ran `if(lay)` and did nothing. A shim that
cannot return the element cannot see what is done to it. The driver here
resolves .cpi-layout and the tuck button for real.

Skipped, not failed, where node is unavailable.
"""

import json
import os
import re
import shutil
import subprocess
import tempfile

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_JS = os.path.join(_ROOT, "static", "js", "company_people_intelligence.js")
_CSS = os.path.join(_ROOT, "static", "css", "company_people_intelligence.css")
_TPL = os.path.join(_ROOT, "templates", "company_people_intelligence.html")

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")


_DRIVER = r"""
const fs = require("fs");
const bundle = fs.readFileSync(process.argv[2], "utf8");

function makeEl(tag, id){
  const el = {
    tagName: tag||"div", id: id||"", _html: "", value: "", checked: false,
    textContent: "", title: "", style: {}, options: [], dataset: {}, _on: {}, _kids: [],
    classList: { _s: new Set(),
      add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); },
      contains(c){ return this._s.has(c); },
      toggle(c,on){ if(on===undefined) on=!this._s.has(c);
                    if(on) this._s.add(c); else this._s.delete(c); return on; } },
    getAttribute(n){ return this["_a_"+n]===undefined?null:this["_a_"+n]; },
    setAttribute(n,v){ this["_a_"+n]=v; },
    remove(){}, appendChild(c){ this._kids.push(c); }, removeChild(){},
    contains(o){ return o===this || this._kids.indexOf(o)>=0; },
    addEventListener(e,f){ (this._on[e]=this._on[e]||[]).push(f); },
    querySelectorAll(){ return []; }, querySelector(){ return null; },
    closest(){ return null; }, scrollIntoView(){}, focus(){}, click(){},
    getBoundingClientRect(){ return {top:0,left:0,bottom:0,right:0,width:0,height:0}; },
  };
  el.lastChild = { textContent: "" };
  Object.defineProperty(el, "innerHTML", { get(){ return el._html; },
                                           set(v){ el._html = String(v); } });
  return el;
}
const IDS = ["cpiResultsWrap","cpiToolbar","cpiCount","cpiLoadMore","cpiSelectAll",
  "cpiBulk","cpiBulkN","cpiBulkEnrich","cpiToast","cpiFiltersPeople","cpiListN",
  "cpiFiltersCompanies","cpiEntityToggle","fpCompanyDetail","cpiViewToggle","cpiQbar",
  "cpiLiveCount","cpiLiveCountCo","cpiSpend","fpAdvanced","fpMoreBtn","fcAdvanced",
  "fcMoreBtn","cpiChatTuck"];
const els = {};
IDS.forEach(id => els[id] = makeEl("div", id));

/* The whole point of this driver: .cpi-layout resolves to a real element whose
   classList can be read back. */
const LAYOUT = makeEl("div", "");

const STORE = {};
if (process.env.CPI_TUCKED) STORE["cpi-chat-tucked"] = process.env.CPI_TUCKED;
if (process.env.CPI_VIEW) STORE["cpi-view"] = process.env.CPI_VIEW;

global.localStorage = { getItem: k => (k in STORE ? STORE[k] : null),
                        setItem: (k,v) => { STORE[k] = String(v); } };
global.window = global;
global.addEventListener = function(){};
global.matchMedia = () => ({matches:false, addEventListener(){}});
global.requestAnimationFrame = cb => setTimeout(cb,0);
global.getComputedStyle = () => ({});
global.innerWidth = 1600; global.innerHeight = 900;
global.confirm = () => true;
global.document = {
  getElementById(id){ return els[id]||null; },
  querySelectorAll(){ return []; },
  querySelector(sel){ return sel === ".cpi-layout" ? LAYOUT : null; },
  createElement(t){ return makeEl(t); }, addEventListener(){},
  body:{style:{},appendChild(){},removeChild(){}}, documentElement:{style:{}},
};
global.navigator = { clipboard:{ writeText(){ return Promise.resolve(); } } };
global.URL = { createObjectURL(){ return "blob:x"; }, revokeObjectURL(){} };
["HISTORY","EXPORT","VOCAB","COUNT","CREDITS","LIST","PARSE","SEARCH"].forEach(n => {
  global["__CPI_"+n+"_URL__"] = "/"+n.toLowerCase();
});
global.fetch = function(url){
  const u = String(url);
  let payload = {};
  if (u.indexOf("/list") >= 0) payload = {rows:[],count:0,available:true};
  else if (u.indexOf("/credits") >= 0) payload = {available:false};
  return Promise.resolve({ok:true, json(){ return Promise.resolve(payload); }});
};

eval(bundle);

const cls = () => Array.from(LAYOUT.classList._s);
const out = {bootClasses: cls()};

window.cpiSetView("table");
out.afterTable = cls();
window.cpiSetView("cards");
out.afterCards = cls();

window.cpiToggleChat();
out.afterTuck = cls();
out.tuckStored = STORE["cpi-chat-tucked"];
out.tuckAria = els.cpiChatTuck.getAttribute("aria-expanded");
out.tuckLabel = els.cpiChatTuck.getAttribute("aria-label");

/* Tucked and then switching view: the view must not quietly untuck it, and it
   must not re-stack the page either. */
window.cpiSetView("table");
out.afterTuckThenTable = cls();

window.cpiToggleChat();
out.afterUntuck = cls();
out.untuckStored = STORE["cpi-chat-tucked"];
out.untuckAria = els.cpiChatTuck.getAttribute("aria-expanded");

console.log(JSON.stringify(out));
"""


def _run(env=None):
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "driver.js")
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(_DRIVER)
        proc = subprocess.run([shutil.which("node"), p, _JS], capture_output=True,
                              text=True, timeout=60, env={**os.environ, **(env or {})})
    if proc.returncode != 0:
        pytest.fail("driver failed: %s" % (proc.stderr or proc.stdout)[-3000:])
    return json.loads(proc.stdout.strip().splitlines()[-1])


@pytest.fixture(scope="module")
def out():
    return _run()


# ── The view no longer moves the layout ──────────────────────────────────────

def test_choosing_the_table_does_not_restack_the_page(out):
    """The regression itself. Because the view is remembered, this was not a
    one-off annoyance: it made the stacked layout the permanent one."""
    assert out["afterTable"] == []
    assert out["afterCards"] == []


def test_the_view_toggle_touches_no_layout_class_at_all():
    """Read from the source as well as driven, because a shim that answers
    querySelector with null makes this exact line invisible, which is how it
    went unnoticed in the first place."""
    js = open(_JS, encoding="utf-8").read()
    body = js[js.index("window.cpiSetView = function"):]
    body = body[:body.index("\n};")]
    assert "cpi-layout" not in body
    assert "classList" not in body.replace('b.classList.toggle("on"', "")


def test_no_rule_anywhere_still_stacks_the_two_panels_by_view():
    css = open(_CSS, encoding="utf-8").read()
    assert ".cpi-layout.wide" not in css


# ── The rail can be tucked, on purpose, and comes back ───────────────────────

def test_the_assistant_can_be_tucked_away_for_the_table(out):
    assert out["afterTuck"] == ["chat-tucked"]
    assert out["tuckStored"] == "1"


def test_tucking_is_remembered_like_the_view_is():
    """Both are working preferences rather than per-search decisions, so they
    are remembered the same way."""
    assert _run({"CPI_TUCKED": "1"})["bootClasses"] == ["chat-tucked"]
    assert _run({"CPI_TUCKED": "0"})["bootClasses"] == []


def test_an_unreadable_preference_shows_the_assistant_rather_than_hiding_it():
    """localStorage throws in some privacy modes. The recoverable default is
    the panel being visible: a hidden one with no memory of why is the state
    this whole change exists to prevent."""
    js = open(_JS, encoding="utf-8").read()
    boot = js[js.index("window.cpiToggleChat(("):]
    boot = boot[:boot.index("})());") + 6]
    assert "catch(e){ return false; }" in boot


def test_switching_view_while_tucked_changes_nothing(out):
    assert out["afterTuckThenTable"] == ["chat-tucked"]


def test_it_comes_back(out):
    assert out["afterUntuck"] == []
    assert out["untuckStored"] == "0"


def test_the_control_says_what_it_will_do(out):
    assert out["tuckAria"] == "false" and out["untuckAria"] == "true"
    assert "Show" in out["tuckLabel"]


# ── Markup and styling contracts ─────────────────────────────────────────────

def _css():
    """The stylesheet with formatting normalised away.

    These assertions are about rules, not about how the file is typed, so
    whitespace between tokens is collapsed before matching. Pinning them to a
    no-space writing style meant a reformat failed a test whose subject had
    not changed."""
    raw = open(_CSS, encoding="utf-8").read()
    raw = re.sub(r"/\*.*?\*/", "", raw, flags=re.S)
    raw = re.sub(r"\s+", "", raw)
    return raw.replace(";}", "}")


def _rule(css, selector):
    i = css.index(selector + "{")
    return css[i:css.index("}", i) + 1]


def test_the_two_panels_are_columns_of_one_grid():
    css = _css()
    rule = _rule(css, ".cpi-layout")
    assert "display:grid" in rule
    assert rule.count("minmax(0,1fr)") == 1


def test_extra_width_goes_to_the_results_not_the_assistant():
    """A rail past about 440px gives its bubbles a line length nobody reads,
    and the results table is what actually wants the room."""
    css = _css()
    # A fixed rail: every extra pixel of viewport goes to the results column,
    # which is the one that wants the room.
    assert "minmax(0,1fr)360px" in _rule(css, ".cpi-layout")


def test_the_only_single_column_layout_is_the_narrow_breakpoint():
    css = _css()
    stacking = re.findall(r"@media\(max-width:(\d+)px\)\{\.cpi-layout\{grid-template-columns:minmax\(0,1fr\)\}", css)
    # exactly one breakpoint stacks the two panels
    assert stacking == ["1180"]


def test_a_tucked_rail_is_narrow_but_never_gone():
    """display:none would leave no way back, which is the failure being fixed,
    not a smaller version of it."""
    css = _css()
    i = css.index(".cpi-layout.chat-tucked{")
    block = css[i:i + 900]
    assert "grid-template-columns:minmax(0,1fr)44px" in block

    # Whatever the tucked state hides, it must never be the rail itself or the
    # header carrying the control that brings it back. Selectors are matched
    # with their bodies, since a grouped rule hides several things at once and
    # only some of them are allowed.
    # The mark stays: a 44px rail showing whose panel it is reads better than
    # a bare chevron, and the header carrying the re-open control must survive.
    hideable = ("cpi-chat-hdr-name", "cpi-chat-live", "cpi-chat-body", "cpi-chat-input-row")
    for selector, body in re.findall(r"([^{}]*chat-tucked[^{}]*)\{([^}]*)\}", _css()):
        if not re.search(r"(^|;)\s*display:\s*none", body):
            continue
        for one in selector.split(","):
            one = one.strip()
            assert any(part in one for part in hideable), one


def test_tucking_is_offered_only_where_there_is_width_to_reclaim():
    """Below the breakpoint the two are already one column, so a 54px rail
    there would hide the assistant and reclaim nothing."""
    css = _css()
    i = css.index(".cpi-layout.chat-tucked{")
    guard = css.rindex("@media", 0, i)
    assert "min-width:1181px" in css[guard:i]
    # ...and below it the control is withdrawn rather than left to do nothing.
    assert "@media(max-width:1180px){.cpi-chat-tuck{display:none}}" in css


def test_the_control_lives_on_the_panel_it_hides():
    tpl = open(_TPL, encoding="utf-8").read()
    hdr = tpl[tpl.index('<div class="cpi-chat-hdr">'):]
    hdr = hdr[:hdr.index("</div>\n      <div class=\"cpi-chat-body\"")]
    assert 'id="cpiChatTuck"' in hdr
    assert 'onclick="cpiToggleChat()"' in hdr
    assert 'aria-expanded' in hdr


# ── The page header row ──────────────────────────────────────────────────────

def test_the_header_is_a_grid_of_tiles_not_a_wrapping_row():
    """The title, the cost rules and the spend used to be one wrapping flex
    row, each item carrying its own margin-left:auto. That fits only while
    everything happens to fit: at 1512px the notice took the row, List
    followed it, and History dropped alone onto a third line against the left
    margin. They are separate grid tiles now, so the arrangement is the same
    at every width instead of a coincidence at some of them."""
    tpl = open(_TPL, encoding="utf-8").read()
    head = tpl[tpl.index('<div class="cpi-head">'):tpl.index('<div class="cpi-layout"')]
    for tile in ("cpi-head-main", "cpi-head-cost", "cpi-head-spend"):
        assert tile in head, tile
    # the controls stay together in one block, inside the title tile
    actions = head[head.index("cpi-head-actions"):]
    for control in ('id="cpiListBtn"', "cpiOpenHistory()"):
        assert control in actions, control
    # and the spend figure keeps its own tile rather than riding the actions row
    assert 'id="cpiSpend"' in head[head.index("cpi-head-spend"):]


def _bodies(css, selector):
    """EVERY rule for this exact selector, not just the first one.

    Reading only the first is how a later override survives a test: the whole
    point of the cascade is that the last one wins, so a check that stops at
    the first is checking the losing declaration."""
    return [b for sel, b in re.findall(r"([^{}]+)\{([^}]*)\}", css)
            if sel.strip().split("\n")[-1].strip() == selector]


def test_no_header_tile_positions_itself_with_an_auto_margin():
    """margin-left:auto is how the old row arranged itself, and why it fell
    apart when it ran out of width. Grid placement does that job now; an auto
    margin creeping back in would reintroduce the same failure."""
    css = _css()
    assert "display:grid" in _rule(css, ".cpi-head")
    for selector in (".cpi-head-main", ".cpi-head-cost", ".cpi-head-spend", ".cpi-head-actions"):
        bodies = _bodies(css, selector)
        assert bodies, selector
        assert not any("margin-left:auto" in b for b in bodies), selector


def test_the_header_tiles_are_content_height():
    """The spend figure is hidden on deployments without Postgres. A stretched
    tile then renders as a tall empty box beside the others."""
    assert "align-items:start" in _rule(_css(), ".cpi-head")
