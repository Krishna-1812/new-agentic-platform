"""Lead Finder's page stays short: the leads, the recent searches and the settings each scroll inside their own
card, with a thin scrollbar of their own (the heading and filters of a card stay put above its list)."""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


CSS = _read("static/css/buyer_radar.css")
BOXES = (".br-leads", ".br-runs .mr-card-b", ".br-set-b")


def _rule(selector):
    """The declarations of every rule that starts a line with exactly this selector, together."""
    found = re.findall(r"(?m)^%s\s*\{([^}]*)\}" % re.escape(selector), CSS)
    assert found, selector
    return " ".join(found)


def test_each_section_has_a_height_of_its_own_and_scrolls_inside_it():
    for box in (".br-leads", ".br-runs .mr-card-b", ".br-set-b"):
        height = _rule(box)
        assert re.search(r"max-height:\s*min\(\d+vh,\s*\d+px\)", height), box + " needs a height so the page stays short"
    shared = _rule(", ".join(BOXES))
    assert "overflow-y: auto" in shared and "overscroll-behavior: contain" in shared and "overflow-x: hidden" in shared


def test_the_scrollbars_are_thin_and_styled_in_chrome_and_firefox():
    for part in ("", "-track", "-thumb", "-thumb:hover"):
        assert all(b + "::-webkit-scrollbar" + part in CSS for b in BOXES), part
    assert re.search(r"::-webkit-scrollbar\s*\{\s*width:\s*10px", CSS), "slim"
    thumb = _rule(", ".join(b + "::-webkit-scrollbar-thumb" for b in BOXES))
    assert "border-radius: 99px" in thumb and "background-clip: padding-box" in thumb
    firefox = CSS[CSS.index("@-moz-document url-prefix()"):]
    assert "scrollbar-width: thin" in firefox and all(b in firefox for b in BOXES)
    assert "scrollbar-width" not in CSS[:CSS.index("@-moz-document url-prefix()")].split("Each section scrolls inside")[-1], \
        "the standard properties would switch the WebKit styling off in Chrome, so only Firefox gets them"


def test_the_scrolling_lists_can_be_reached_from_the_keyboard_and_the_style_sheet_is_reloaded():
    page = _read("templates/buyer_radar.html")
    assert re.search(r'id="brLeads"[^>]*tabindex="0"[^>]*role="region"', page)
    assert re.search(r'id="brRuns"[^>]*tabindex="0"[^>]*role="region"', page)
    assert "buyer_radar.css?v=11" in page
