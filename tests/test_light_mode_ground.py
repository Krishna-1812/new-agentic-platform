"""The light-mode page ground, and the selector shape that broke it.

aurora-app.css shipped its light ground as
`:root[data-theme="light"] html,[data-theme="light"] html`. Both halves are
unmatchable. `:root` IS `html`, so the first asks for an html nested inside a
light-themed html; the second asks for an html nested inside anything at all,
and html is never a descendant. Nothing errors, no build warns, and light mode
just keeps the dark ground on every page that does not define its own. Measured
on Contact Finder before the fix: body text rgb(23,33,58) on ground rgb(7,9,18),
a contrast ratio of 1.24:1 against the 4.5:1 that AA asks for. After: 14.12:1.

What these tests can and cannot see: the specificity claims below are computed
arithmetically from the selector text, not by rendering. The rendered check was
done in a browser against the real pages (Contact Finder, and all three pages
that carry their own ground, in both themes) and is not reproducible in pytest
without a headless browser, so it is recorded here rather than automated.

WHERE THIS STANDS NOW. aurora-app.css was deleted in the cleanup pass: no page
loaded it after the Bento rebuild, and the five tests here that measured its
cascade went with it. Light mode survives in exactly one place -- three pages
(Social Media, LinkedIn Strategy Researcher, Event Intelligence) switch to
data-theme="light" for the moment before window.print(), so a report prints
on white paper. What is left below guards properties that still hold on the
pages that exist: no rule made only of selectors that cannot match, and a
page's own html:root ground always carrying a real background-color.
"""

import os
import re

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CSS = os.path.join(_ROOT, "static", "css")


def _read(name):
    with open(os.path.join(_CSS, name), encoding="utf-8") as fh:
        return fh.read()


def _strip_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


# Selectors that can never match, because html is the root element and :root is
# html. Any of these reappearing means the bug is back.
_DEAD = (
    ':root[data-theme="light"] html',
    ':root[data-theme="dark"] html',
    '[data-theme="light"] html',
    '[data-theme="dark"] html',
)


def _is_dead(sel):
    sel = " ".join(sel.split())
    return any(sel == d or sel.startswith(d + " ") or sel.startswith(d + ":")
               for d in _DEAD)


def test_no_rule_is_made_entirely_of_selectors_that_cannot_match():
    """Scoped to whole rules on purpose. `[data-theme="light"] html` appearing
    in a list next to `[data-theme="light"] body` is dead weight but the rule
    still applies through its other members, and two scrollbar rules are
    written exactly that way. What broke light mode was a rule where EVERY
    selector was of this shape, so nothing applied it and nothing complained."""
    doomed = []
    for f in sorted(os.listdir(_CSS)):
        if not f.endswith(".css"):
            continue
        for sel in re.findall(r"(?:^|[}\n])\s*([^{}@\n][^{}@]*?)\s*\{",
                              _strip_comments(_read(f))):
            parts = [p for p in sel.split(",") if p.strip()]
            if parts and all(_is_dead(p) for p in parts):
                doomed.append("%s: %s" % (f, " ".join(sel.split())[:80]))
    assert not doomed, (
        "every selector on these rules targets html as a descendant of a "
        "themed element, which can never match, so the whole rule is inert: "
        "%s" % doomed)



@pytest.mark.parametrize("page", [
    "anonymous_visitors.css", "job_change_alert.css", "linkedin_playbook_studio.css",
])
def test_a_moved_ground_never_carries_important(page):
    """A page's dark ground on html:root must not be !important.

    The original reason was aurora's light rule, which had to outrank these
    grounds on specificity; aurora is gone. The reason that remains is the
    print path: linkedin_playbook_studio.html switches the document to
    data-theme="light" before window.print(), and an !important on the dark
    ground would beat the light one and print a dark page. The other two
    have no light mode at all, but the same rule costs nothing there and
    keeps the three grounds written one way.

    gtm.css and seo.css were in this list. Both were deleted in the cleanup
    pass -- nothing had loaded either since the Bento rebuild -- and their
    rows went with them, as the note here asked."""
    body = _strip_comments(_read(page))
    m = re.search(r"html:root\s*\{([^}]*)\}", body)
    assert m, "%s no longer sets its ground on html:root" % page
    assert "!important" not in m.group(1), (
        "%s: !important on the dark page ground beats the light ground the "
        "print path switches to: %s" % (page, m.group(1).strip()[:80]))
    assert "background-color" in m.group(1), (
        "%s: a gradient-only `background` shorthand resets background-color to "
        "transparent, and macOS overscroll then paints white past the document "
        "edge" % page)


@pytest.mark.parametrize("page", [
    "event_conference_intelligence.css",
    "social_media_intelligence.css",
    "42_north_dental_slot_checker.css",
    "thought_leader_pr.css",
])
def test_a_page_with_its_own_dark_ground_still_sets_a_background_color(page):
    """These four set their own dark ground on html:root, so trap #3 has to be
    checked there too: a gradient-only
    `background` shorthand resets background-color to transparent, and
    whatever the four radial gradients don't tile -- a wide/tall viewport, or
    what a fast overscroll bounce exposes beyond the document box -- falls
    through to the browser's white canvas. thought_leader_pr.css shipped
    without this (caught 2026-09-18): its dark ground computed
    rgba(0,0,0,0), confirmed live before the fix."""
    body = _strip_comments(_read(page))
    m = re.search(r"(?:^|\n)html:root\s*\{([^}]*)\}", body)
    assert m, "%s no longer sets its own ground on html:root" % page
    assert "background-color" in m.group(1), (
        "%s: this page's own dark html:root ground has no background-color, "
        "so gaps in its gradients render the browser's white canvas" % page)
