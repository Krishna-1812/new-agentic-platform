"""Video Studio: the agent's name, its fixed settings, and its environment.

Plan: docs/video-studio-plan.md. The website stores projects and shows them;
the Page Watch worker service renders them (tracker/video_worker.py), because
only the worker has a browser, ffmpeg and Node.

Environment:
  DATABASE_URL              Postgres. Without it the store is in-memory.
  VIDEO_STUDIO              "off" stops the worker taking render jobs.
  VIDEO_ENGINE_DIR          Where the pinned HyperFrames is installed
                            (default ~/.cache/video-studio/engine).
  VIDEO_WORK_DIR            Where each job's folder is made (default: the
                            system's temporary folder).
  VIDEO_BROWSER_PATH        A Chromium headless shell to render with, instead
                            of the one Playwright installed.
"""

import functools
import glob
import re
import os

NAME = "Video Studio"
SLUG = "video-studio"

# The video engine (HeyGen HyperFrames, Apache-2.0). Pinned: an upgrade is
# made on purpose, with the tests and the two test videos run again.
HYPERFRAMES_VERSION = "0.8.111"

# ── Shapes and lengths ───────────────────────────────────────────────────────
SHAPES = {
    "landscape": (1920, 1080),
    "vertical": (1080, 1920),
    "square": (1080, 1080),
    "portrait": (1080, 1350),
}
SHAPE_LABELS = {"landscape": "Landscape 16:9", "vertical": "Vertical 9:16",
                "square": "Square 1:1", "portrait": "Portrait 4:5"}
MIN_SECONDS = 6
MAX_SECONDS = 60

# ── Time limits ──────────────────────────────────────────────────────────────
# hyperframes check on one composition.
CHECK_TIMEOUT_S = 240
# A render gets a fixed allowance for starting the browser and encoding, plus
# time per second of video. A 60-second video may run for 20 minutes; past
# that it has hung, and the render is stopped.
RENDER_BASE_S = 180
RENDER_PER_SECOND_S = 17
# Installing the pinned engine on a fresh worker (npm, once per deploy).
INSTALL_TIMEOUT_S = 600
# ffmpeg pulling one cover frame.
COVER_TIMEOUT_S = 60

# ── The queue ────────────────────────────────────────────────────────────────
# A claimed job stays with its worker this long without a renewal.
JOB_LEASE_S = 120
# A job interrupted this many times (a deploy, a crash) is failed, not retried.
MAX_ATTEMPTS = 2
POLL_S = 5

# ── Sizes ────────────────────────────────────────────────────────────────────
# Composition files a job may hold, and the largest of each.
MAX_FILES = 80
MAX_FILE_BYTES = 12 * 1024 * 1024
MAX_JOB_BYTES = 60 * 1024 * 1024
# What a composition may be built from. Anything else is refused on write.
ALLOWED_SUFFIXES = (".html", ".css", ".js", ".json", ".svg", ".png", ".jpg", ".jpeg", ".webp",
                    ".woff2", ".woff", ".ttf", ".otf", ".txt")
# The finished video is refused above this (a 60-second 1080p video is ~20 MB).
MAX_MP4_BYTES = 80 * 1024 * 1024


# ── Keeping ──────────────────────────────────────────────────────────────────
# Versions one video may have (each change and shape is one).
MAX_VERSIONS = 20
# The clean-up runs on the worker this often.
PRUNE_EVERY_S = 6 * 3600


def _int_env(name, default, low=0):
    try:
        return max(low, int(os.environ.get(name) or default))
    except ValueError:
        return default


def daily_videos():
    """Videos one person may have made a day (approve, change, another shape): VIDEO_DAILY_VIDEOS."""
    return _int_env("VIDEO_DAILY_VIDEOS", 20)


def daily_plans():
    """Plans one person may ask for a day (new video, another idea, duplicate): VIDEO_DAILY_PLANS."""
    return _int_env("VIDEO_DAILY_PLANS", 40)


def keep_days():
    """Days a finished MP4 is kept before the clean-up removes it: VIDEO_KEEP_DAYS."""
    return _int_env("VIDEO_KEEP_DAYS", 90, low=1)


def switched_on():
    return (os.environ.get("VIDEO_STUDIO") or "on").strip().lower() not in ("off", "0", "false", "no")


def render_timeout(seconds):
    return int(RENDER_BASE_S + RENDER_PER_SECOND_S * max(1.0, float(seconds or 0)))


def engine_dir():
    return (os.environ.get("VIDEO_ENGINE_DIR") or "").strip() or \
        os.path.join(os.path.expanduser("~"), ".cache", "video-studio", "engine")


def work_dir():
    return (os.environ.get("VIDEO_WORK_DIR") or "").strip() or None


def kit_dir():
    """Files bundled with every composition: GSAP and the fonts."""
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "video_kit")


def browser_path():
    """The Chromium headless shell to render with, or None.

    HyperFrames drives frames with begin-frame control, which the headless
    shell supports. Playwright installs one next to its Chromium (on Railway:
    RAILPACK_PYTHON_PLAYWRIGHT_INSTALL=1, already set for Page Watch)."""
    own = (os.environ.get("VIDEO_BROWSER_PATH") or "").strip()
    if own:
        return own if os.path.exists(own) else None
    roots = [os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or "", _playwright_root(),
             os.path.join(os.path.expanduser("~"), ".cache", "ms-playwright"), "/opt/pw-browsers"]
    for root in roots:
        if not root:
            continue
        found = []
        # Older Playwright: chrome-linux/headless_shell. Newer (1.5x on):
        # chrome-headless-shell-linux64/chrome-headless-shell.
        for name in ("headless_shell", "chrome-headless-shell"):
            found += glob.glob(os.path.join(root, "chromium_headless_shell-*", "chrome-*", name))
        found = [f for f in found if os.access(f, os.X_OK)]
        if found:
            return max(found, key=_build_number)
    return None


def _build_number(path):
    m = re.search(r"chromium_headless_shell-(\d+)", path)
    return int(m.group(1)) if m else 0


@functools.lru_cache(maxsize=1)
def _playwright_root():
    """Where the installed Playwright keeps its browsers (asked of Playwright itself), or ""."""
    import subprocess
    import sys
    try:
        out = subprocess.run([sys.executable, "-m", "playwright", "install", "--dry-run", "chromium-headless-shell"],
                             capture_output=True, text=True, timeout=30).stdout
    except Exception:
        return ""
    m = re.search(r"Install location:\s*(\S+)", out or "")
    return os.path.dirname(m.group(1)) if m else ""
