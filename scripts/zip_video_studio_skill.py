"""Zip the video-studio Claude Code skill for teammates who install it by hand.

    python scripts/zip_video_studio_skill.py [out.zip]

Writes video-studio-setup.zip (default). Inside, one folder, video-studio-setup/, holds the one-click
installers (setup-video-studio.bat for Windows, .command for macOS, .sh for Linux), START HERE.txt,
and the skill itself in video-studio/, which the installer copies into ~/.claude/skills/. Leaves out
caches and the analysis virtualenv.
"""

import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL = os.path.join(ROOT, "claude-plugins", "video-studio", "skills", "video-studio")
INSTALL = os.path.join(ROOT, "claude-plugins", "video-studio", "install")
TOP = "video-studio-setup"
SKIP_DIRS = {".venv", "__pycache__", ".pytest_cache"}
EXECUTABLE = (".sh", ".command")


def _add(z, path, arc):
    info = zipfile.ZipInfo.from_file(path, arc)
    if arc.endswith(EXECUTABLE):
        info.external_attr = (0o100755 << 16)  # keep the double-clickable scripts executable on macOS
    info.compress_type = zipfile.ZIP_DEFLATED
    with open(path, "rb") as fh:
        z.writestr(info, fh.read())


def build(out):
    n = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(os.listdir(INSTALL)):
            _add(z, os.path.join(INSTALL, f), "%s/%s" % (TOP, f))
            n += 1
        for here, dirs, files in os.walk(SKILL):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
            for f in sorted(files):
                if f.endswith(".pyc") or f == ".DS_Store":
                    continue
                path = os.path.join(here, f)
                _add(z, path, "/".join([TOP, "video-studio", os.path.relpath(path, SKILL).replace(os.sep, "/")]))
                n += 1
    return n


if __name__ == "__main__":
    dest = sys.argv[1] if len(sys.argv) > 1 else "video-studio-setup.zip"
    count = build(dest)
    print("%s: %d files, %.1f MB" % (dest, count, os.path.getsize(dest) / 1e6))
