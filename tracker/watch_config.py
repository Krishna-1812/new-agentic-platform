"""Page Watch: the agent's name, its fixed settings, and its environment.

Every number that decides what counts as a change lives here, with the reason
for it, so a tuning change is one edit in one place and its test fails loudly.

Environment:
  DATABASE_URL            Postgres. Without it the store is in-memory.
  WATCH_BROWSER           "off" turns the browser off; checks then read the
                          page over plain HTTP (text only, no screenshots).
  WATCH_CHROMIUM_PATH     A Chromium to launch instead of Playwright's own.
  WATCH_SLACK_CHANNEL     Default channel for alerts (Phase 5).
"""

import os

NAME = "Page Watch"
SLUG = "page-watch"
USER_AGENT = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/141.0 Safari/537.36 PageWatch/1.0")

# ── The browser's view ────────────────────────────────────────────────────────
# One fixed desktop size, language and time zone for every check, so two
# checks of an unchanged page see the same page. A different viewport moves
# every line, and a different time zone changes every printed date.
VIEWPORT = {"width": 1440, "height": 900}
LOCALE = "en-US"
TIMEZONE = "UTC"
# Full-page screenshots stop here. A 20,000px page is mostly footer and
# infinite feed; past this the comparison would cost more than it finds.
MAX_PAGE_HEIGHT = 9000
# Loading: the navigation itself, then the quiet period waited for after it.
NAV_TIMEOUT_MS = 30000
NETWORK_IDLE_MS = 5000
# After scrolling to the bottom and back, a shorter wait for what that loaded.
SCROLL_IDLE_MS = 3000
# Then at most this long for every image on the page to finish loading.
IMAGES_MS = 6000
# A second screenshot this long after the first shows what moves on its own.
CONTROL_GAP_MS = 2500
CHECK_TIMEOUT_S = 90
MAX_REQUESTS = 600
MAX_REDIRECTS = 5

# ── Text ─────────────────────────────────────────────────────────────────────
# Two blocks are "the same block, edited" when their words overlap this much;
# below it, one was removed and the other added.
BLOCK_MATCH_RATIO = 0.55
# Blocks longer than this are clipped in stored diffs (the snapshot keeps all).
DIFF_BLOCK_CHARS = 600

# ── Visuals ──────────────────────────────────────────────────────────────────
# The screenshots are compared in square cells. A cell counts as changed when
# enough of its pixels moved by more than PIXEL_DELTA (0-255 on the luminance
# channel). Anti-aliasing and JPEG-like rendering noise stay under these.
CELL = 8
PIXEL_DELTA = 32
CELL_CHANGED_SHARE = 0.04
# A pixel must differ at every offset up to this many px to count (see
# watch_visual.cell_changes): absorbs sub-pixel redraws after a layout shift.
JITTER_PX = 1
# Changed cells closer than this many cells are one area.
JOIN_GAP_CELLS = 3
# Areas smaller than this (px^2) are a stray pixel run, not a change.
MIN_AREA_PX = 120
# The noise mask from the control shot is grown by this many cells, so a
# carousel that drifts a little between shots is still covered.
NOISE_GROW_CELLS = 2
# Composite image: each screenshot is scaled to this width side by side.
COMPOSITE_WIDTH = 900

# ── Deciding ─────────────────────────────────────────────────────────────────
# A visual-only change smaller than this share of the page, with no text
# change and no named element under it, is recorded as minor.
MINOR_VISUAL_SHARE = 0.002


def browser_enabled():
    return (os.environ.get("WATCH_BROWSER") or "on").strip().lower() not in ("off", "0", "false", "no")


def chromium_path():
    return (os.environ.get("WATCH_CHROMIUM_PATH") or "").strip() or None
