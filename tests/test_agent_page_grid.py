"""Every agent page sits on the same responsive grid.

`grid-tokens.css` and `ds-tokens.css` define Arena's page side-margin
(`--margin`, stepping 20/32/48/80/120/160/200 by viewport), its column gutter
(`--gutter`) and `--bleed`, the offset that lines a full-width bar up with the
centered container beneath it. Pages load those sheets and then sometimes
hand-type a number anyway.

That regression is invisible on the page it happens to: it only shows up beside
a sibling, which is why nothing caught it for so long. Two pages had a topbar on
a flat 32px while their content sat at 120px, and one had a container on 30px
while every neighbour kept a real margin.

These are file-level checks rather than rendered ones because the suite has no
browser. They catch the thing that actually regresses: someone typing a px value
back into one of these declarations.
"""

import os
import re

import pytest

CSS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "static", "css")

# (stylesheet, container selector). One row per agent page, listed explicitly so
# a new page has to be added here on purpose rather than quietly skipped.
PAGES = [
    ("social_media_intelligence.css", ".main"),
    ("linkedin.css", ".shell"),                     # LinkedIn Intelligence
    ("job_change_alert.css", ".main"),
    ("42_north_dental_slot_checker.css", ".main"),
    ("linkedin_playbook_studio.css", ".main"),
    ("event_conference_intelligence.css", ".main"),
]

# Both are the shared scale: --margin-app is documented in grid-tokens.css as an
# alias of --margin, kept for existing call sites.
MARGIN_TOKENS = ("var(--margin)", "var(--margin-app)")

# Pages migrated to the Bento design system. They are held to the same rule --
# never hand-type a px value where a shared token exists -- but their tokens
# live in bento-tokens.css (--page-pad, --topbar-h) and their shell and topbar
# are shared components in bento-components.css rather than page-local CSS.
# A PRODUCT page belongs in exactly one of these two lists; rows move across as
# they are rebuilt, so a page can never quietly sit on neither grid.
#
# The PUBLIC site is the one deliberate exception and is in neither. It runs on
# its own system (static/css/press.css: paper ground, a serif at display sizes,
# square corners, rules instead of fills) because a marketing page and an
# instrument have opposite jobs. That separation is held by
# tests/test_press_site.py, which asserts the mirror of the rule below --
# press.css must use NEITHER vocabulary -- so the public site cannot quietly
# half-migrate into a system it was never meant to join.
BENTO_PAGES = [
    ("company_people_intelligence.css", "Contact Finder"),
    ("hub.css", "Workspace"),
    ("directory.css", "the agent and SEO listings"),
    ("accounts.css", "ABM Signal Tracker"),
    ("anonymous_visitors.css", "Anonymous Visitors"),
    ("fieldguide.css", "the Field Guide"),
    ("sentiment_pulse.css", "Sentiment Pulse"),
    # The admin family. admin.css is the sheet that harmonizes all nine and is
    # loaded last by each of them; the per-page sheets hold what is specific to
    # one dashboard.
    ("admin.css", "the shared admin layer"),
    ("admin_requests.css", "Access Requests"),
    ("admin_agent_runs.css", "Agent Runs"),
    ("admin_client_usage.css", "Client Usage"),
    ("admin_client_detail.css", "Client Detail"),
    ("admin_visitors.css", "Anonymous Traffic"),
    ("admin_members.css", "Members"),
    ("admin_usage.css", "Internal Usage"),
    ("admin_external_usage.css", "External Usage"),
    ("admin_agent_feedback.css", "Agent Feedback"),
    ("embed.css", "the embedded-tool wrapper"),
    # The workspace family: /app and the co-branded client portals. They keep
    # a sidebar rather than a breadcrumb bar (see workspace.css for why), but
    # they are on the same tokens as everything else and held to the same rule.
    ("workspace.css", "the shared sidebar shell"),
    ("client-portal.css", "the client portal"),
    ("app.css", "the member dashboard"),
    ("app_detail.css", "an agent's detail page"),
    ("app_embed.css", "the agent runner"),
    ("app_history.css", "run history"),
    ("app_history_detail.css", "a single run"),
    ("app_settings.css", "account settings"),
]


def _rule(css, selector):
    """The base rule for `selector`: comments stripped, media-query copies
    excluded by refusing `{` as the opening delimiter."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    m = re.search(r"(?:^|[};])\s*%s\s*\{([^{}]*)\}" % re.escape(selector), css, re.S)
    return m.group(1) if m else None


def _padding(body):
    m = re.search(r"padding:\s*([^;}]+)", body or "")
    return " ".join(m.group(1).split()) if m else None


@pytest.mark.parametrize("sheet,container", PAGES,
                         ids=[p[0].replace(".css", "") for p in PAGES])
def test_the_page_container_takes_its_side_margin_from_the_token(sheet, container):
    path = os.path.join(CSS_DIR, sheet)
    assert os.path.exists(path), "%s is gone; update PAGES" % sheet
    body = _rule(open(path, encoding="utf-8").read(), container)
    assert body is not None, "no base %s rule in %s" % (container, sheet)
    pad = _padding(body)
    assert pad, "%s sets no padding in %s" % (container, sheet)
    assert any(t in pad for t in MARGIN_TOKENS), (
        "%s %s hand-types its side padding instead of taking the shared "
        "responsive margin: %r" % (sheet, container, pad))


@pytest.mark.parametrize("sheet,container", PAGES,
                         ids=[p[0].replace(".css", "") for p in PAGES])
def test_the_full_width_bar_bleeds_with_the_shared_offset(sheet, container):
    """A bar on a flat number does not move when the margin under it does, so
    the logo stops sitting above the content it belongs to."""
    body = _rule(open(os.path.join(CSS_DIR, sheet), encoding="utf-8").read(), ".topbar")
    assert body is not None, "no base .topbar rule in %s" % sheet
    pad = _padding(body)
    assert pad, ".topbar sets no padding in %s" % sheet
    assert "var(--bleed)" in pad, (
        "%s .topbar does not use --bleed, so it will not line up with the "
        "content container: %r" % (sheet, pad))


@pytest.mark.parametrize("sheet,container", PAGES,
                         ids=[p[0].replace(".css", "") for p in PAGES])
def test_the_bar_is_the_same_height_on_every_agent_page(sheet, container):
    """Chrome that changes height between agents reads as a page reload."""
    body = _rule(open(os.path.join(CSS_DIR, sheet), encoding="utf-8").read(), ".topbar")
    m = re.search(r"height:\s*(\d+)px", body or "")
    assert m, "%s .topbar sets no explicit height" % sheet
    assert m.group(1) == "62", (
        "%s .topbar is %spx tall; every other agent page is 62px"
        % (sheet, m.group(1)))


def test_the_embed_wrapper_has_no_bar_of_its_own():
    """embed.html used to hand-roll a .topbar in an inline <style>, at the same
    62px as its siblings but on --margin-app rather than --bleed, because a
    full-bleed iframe has no centered container for --bleed to line up with.

    It takes the shared shell's bar now, so the thing to protect is no longer
    the number -- it is that the page has not grown a second bar of its own
    beside the shared one. Its side padding is checked with every other Bento
    page above.
    """
    tpl = os.path.join(os.path.dirname(CSS_DIR), "..", "templates", "embed.html")
    tpl = os.path.normpath(tpl)
    markup = open(tpl, encoding="utf-8").read()
    assert "topbar(" in markup, "embed.html no longer calls the shared topbar()"
    assert "<style" not in markup, (
        "embed.html has an inline <style> again; its rules belong in embed.css")
    css = open(os.path.join(CSS_DIR, "embed.css"), encoding="utf-8").read()
    assert _rule(css, ".topbar") is None, (
        "embed.css redefines .topbar; the shared .bn-top owns the bar now")


# ── Pages on the Bento design system ─────────────────────────────────────────

def _bento(name):
    return open(os.path.join(CSS_DIR, name), encoding="utf-8").read()


@pytest.mark.parametrize("sheet,label", BENTO_PAGES,
                         ids=[p[0].replace(".css", "") for p in BENTO_PAGES])
def test_a_bento_page_is_not_still_on_the_arena_grid(sheet, label):
    """Half-migrated is the state that actually breaks: an Arena container
    under a Bento topbar lines up with neither."""
    css = _bento(sheet)
    assert ".shell{" not in re.sub(r"\s+", "", css), (
        "%s still defines the Arena .shell container" % sheet)
    for token in ("var(--margin-app)", "var(--bleed)", "var(--gutter)"):
        assert token not in css, "%s still uses the Arena token %s" % (sheet, token)


@pytest.mark.parametrize("sheet,label", BENTO_PAGES,
                         ids=[p[0].replace(".css", "") for p in BENTO_PAGES])
def test_a_bento_page_hand_types_no_side_padding(sheet, label):
    """The shell and the topbar are shared components; the page sheet must not
    re-declare their side padding with a number of its own."""
    css = re.sub(r"/\*.*?\*/", "", _bento(sheet), flags=re.S)
    for selector in (".bn-shell", ".bn-top"):
        assert re.search(r"(?:^|[};])\s*%s\s*\{" % re.escape(selector), css) is None, (
            "%s redefines the shared component %s" % (sheet, selector))


def test_the_shared_bento_shell_and_bar_take_their_padding_from_tokens():
    comp = open(os.path.join(CSS_DIR, "bento-components.css"), encoding="utf-8").read()
    for selector in (".bn-shell", ".bn-top"):
        body = _rule(comp, selector)
        assert body, "no base %s rule in bento-components.css" % selector
        pad = _padding(body)
        assert pad and "var(--page-pad)" in pad, (
            "%s hand-types its side padding instead of taking --page-pad: %r"
            % (selector, pad))
    assert "var(--topbar-h)" in _rule(comp, ".bn-top"), (
        ".bn-top does not take its height from --topbar-h")
