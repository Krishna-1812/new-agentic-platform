#!/usr/bin/env bash
# One-click setup for the video-studio Claude Code skill (macOS and Linux).
# macOS: double-click setup-video-studio.command. Linux: bash setup-video-studio.sh
#
# Installs what is missing (Node.js 22+, FFmpeg, Python 3, Claude Code; Homebrew on macOS), sets up
# HyperFrames (its skills and a render browser), copies the skill into ~/.claude/skills, and checks
# everything. Safe to run again: it skips what is already there and updates the skill.
#   --deps-only   install the programs but do not copy the skill (e.g. you installed the plugin)

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/video-studio"
DST="$HOME/.claude/skills/video-studio"
DEPS_ONLY=0
[ "${1:-}" = "--deps-only" ] && DEPS_ONLY=1
FAILED=()
OS="$(uname -s)"

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
say() { printf '    %s\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }
node_major() { have node && node --version | sed -E 's/^v([0-9]+).*/\1/' || echo 0; }

printf '\n  video-studio setup\n  Studio-quality videos in Claude Code. This takes 5-15 minutes the first time.\n'

if [ $DEPS_ONLY = 0 ] && [ ! -f "$SRC/SKILL.md" ]; then
  echo "Can't find the 'video-studio' folder next to this installer. Unzip the whole zip first, then run it from the unzipped folder."
  exit 1
fi

if [ "$OS" = "Darwin" ]; then
  step "Homebrew (the macOS package manager)"
  if ! have brew; then
    for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
  fi
  if have brew; then say "ok"; else
    say "Installing Homebrew (it will ask for your Mac password)..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
    have brew || FAILED+=("Homebrew (https://brew.sh)")
  fi
  install_pkg() { have brew && brew install "$1"; }
else
  APT=""
  have apt-get && APT="apt-get"
  SUDO=""
  [ "$(id -u)" != 0 ] && have sudo && SUDO="sudo"
  install_pkg() { [ -n "$APT" ] && $SUDO apt-get install -y "$1"; }
  [ -n "$APT" ] && { step "Updating the package list"; $SUDO apt-get update -y >/dev/null || true; }
fi

step "Node.js 22 or newer"
if [ "$(node_major)" -ge 22 ]; then say "ok: $(node --version)"; else
  if [ "$OS" = "Darwin" ]; then install_pkg node
  elif [ -n "${APT:-}" ]; then curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash - && $SUDO apt-get install -y nodejs
  fi
  hash -r
  [ "$(node_major)" -ge 22 ] || FAILED+=("Node.js 22+ (https://nodejs.org)")
fi

step "FFmpeg"
if have ffmpeg && have ffprobe; then say "ok"; else install_pkg ffmpeg; hash -r; have ffmpeg || FAILED+=("FFmpeg"); fi

step "Python 3"
if have python3; then say "ok: $(python3 --version)"; else
  if [ "$OS" = "Darwin" ]; then install_pkg python; else install_pkg python3; fi
  hash -r; have python3 || FAILED+=("Python 3")
fi

step "Claude Code"
if have claude; then say "ok: $(claude --version)"; else
  curl -fsSL https://claude.ai/install.sh | bash
  export PATH="$HOME/.local/bin:$PATH"; hash -r
  have claude || FAILED+=("Claude Code (https://claude.com/claude-code)")
fi

if have npx; then
  step "HyperFrames skills (the video engine Claude uses)"
  npx --yes hyperframes skills || FAILED+=("HyperFrames skills")
  step "Render browser (headless Chrome for HyperFrames)"
  npx --yes hyperframes browser ensure || FAILED+=("Render browser")
else
  FAILED+=("HyperFrames (needs Node.js)")
fi

if [ $DEPS_ONLY = 0 ]; then
  step "Installing the video-studio skill"
  mkdir -p "$(dirname "$DST")"
  rm -rf "$DST"
  cp -R "$SRC" "$DST"
  say "copied to $DST"
fi

step "Final check"
if have python3; then
  DOC="$DST/scripts/doctor.py"; [ $DEPS_ONLY = 1 ] && DOC="$SRC/scripts/doctor.py"
  python3 "$DOC" || FAILED+=("final check (see the lines marked MISS above)")
fi

echo
if [ ${#FAILED[@]} -eq 0 ]; then
  printf '  \033[32mAll set.\033[0m\n'
  echo "  1. Quit Claude Code if it is open, then open it again (new programs need a fresh start)."
  echo "  2. In any project folder, type:   /video-studio make a 20 second launch video for this"
  exit 0
else
  printf '  \033[33mAlmost there. These need attention:\033[0m\n'
  for f in "${FAILED[@]}"; do echo "   - $f"; done
  echo "  Open a new terminal and run this installer again. Still stuck? In Claude Code: /video-studio help me finish setup"
  exit 1
fi
