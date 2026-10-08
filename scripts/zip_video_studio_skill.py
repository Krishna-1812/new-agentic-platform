"""Zip the video-studio Claude Code skill for teammates who install it by hand.

    python scripts/zip_video_studio_skill.py [out.zip]

Writes video-studio-skill.zip (default) with one top folder, video-studio/, that unzips straight
into ~/.claude/skills/ (Windows: %USERPROFILE%\\.claude\\skills\\). Leaves out caches and the
analysis virtualenv.
"""

import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL = os.path.join(ROOT, "claude-plugins", "video-studio", "skills", "video-studio")
SKIP_DIRS = {".venv", "__pycache__", ".pytest_cache"}


def build(out):
    n = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for here, dirs, files in os.walk(SKILL):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
            for f in sorted(files):
                if f.endswith(".pyc") or f == ".DS_Store":
                    continue
                path = os.path.join(here, f)
                z.write(path, os.path.join("video-studio", os.path.relpath(path, SKILL)))
                n += 1
    return n


if __name__ == "__main__":
    dest = sys.argv[1] if len(sys.argv) > 1 else "video-studio-skill.zip"
    count = build(dest)
    print("%s: %d files, %.1f MB" % (dest, count, os.path.getsize(dest) / 1e6))
