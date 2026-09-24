"""Why /strategic-agents no longer ships a substitute scrollbar.

The rail existed for one reason: gtm.css zeroes the native scrollbar on every
element it touches --

    *{scrollbar-width:none}
    *::-webkit-scrollbar{width:0 !important;display:none !important}

-- so the page had no scroll indicator at all and drew its own hairline one to
put it back. Two files, a <link>, a deferred <script> and a fixed-position
overlay, to restore something the page had removed from itself.

The page was rebuilt on the Bento design system and does not load gtm.css. The
native scrollbar is styled there (bento-tokens.css) rather than suppressed, so
there is nothing to substitute for and the rail is retired.

This file therefore no longer tests the rail's wiring. It tests the PREMISE,
which is the part that can silently come back: if a Bento page starts hiding
the native scrollbar again, it needs a rail again, and the failure mode is a
long page with no scroll affordance whatsoever -- which nothing errors on and
nobody files a bug about, they just stop scrolling.
"""

import os
import re

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CSS = os.path.join(_ROOT, "static", "css")
_TPL = os.path.join(_ROOT, "templates")


def _read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as fh:
        return fh.read()


def _strip_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def _bento_pages():
    """Pages on the Bento system, found by what they load rather than by a list
    somebody has to remember to update."""
    return [n for n in sorted(os.listdir(_TPL))
            if n.endswith(".html") and not n.startswith("_")
            and ("_bento.html" in _read(_TPL, n) or "bento-tokens.css" in _read(_TPL, n))]


def _sheets_of(page):
    """Every stylesheet a page loads, including the ones the shell macro adds."""
    markup = _read(_TPL, page)
    named = set(re.findall(r"css/([\w./-]+\.css)", markup))
    if "_bento.html" in markup:
        named |= {"bento-tokens.css", "bento-components.css", "bento-motion.css"}
    return named


def test_the_agent_directory_no_longer_hides_its_own_scrollbar():
    """The whole reason the rail existed. Loading gtm.css here would zero the
    native scrollbar again and leave the page with no scroll indicator."""
    assert "gtm.css" not in _sheets_of("b2b_agents.html")


def test_no_bento_page_suppresses_the_native_scrollbar():
    """Stated as a property of every Bento page rather than of one file, because
    the next page rebuilt is the one that would reintroduce it."""
    offenders = []
    for page in _bento_pages():
        for sheet in _sheets_of(page):
            path = os.path.join(_CSS, sheet)
            if not os.path.exists(path):
                continue
            css = _strip_comments(_read(path))
            if re.search(r"scrollbar-width\s*:\s*none", css) or \
               re.search(r"::-webkit-scrollbar\s*\{[^}]*display\s*:\s*none", css):
                offenders.append("%s -> %s" % (page, sheet))
    assert not offenders, (
        "these Bento pages hide the native scrollbar, so they have no scroll "
        "indicator and would need a substitute rail put back: %s" % offenders)


def test_the_bento_tokens_style_the_scrollbar_rather_than_removing_it():
    """The positive half of the rule above: a styled scrollbar is what makes the
    rail unnecessary. If this block goes away the page falls back to the
    browser's default, which is still visible -- so this is about the system
    being deliberate, not about it being broken."""
    css = _strip_comments(_read(_CSS, "bento-tokens.css"))
    assert "::-webkit-scrollbar-thumb" in css
    assert not re.search(r"scrollbar-width\s*:\s*none", css)


def test_the_rail_is_not_linked_by_any_page_now():
    """It is retired, not disabled. A page picking it up again would draw a
    second scroll indicator beside the native one -- which is the exact failure
    the old version of this file guarded against in the other direction."""
    linking = [n for n in sorted(os.listdir(_TPL))
               if n.endswith(".html") and "scroll-rail" in _read(_TPL, n)]
    assert linking == [], linking
