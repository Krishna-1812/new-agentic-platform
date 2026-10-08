#!/usr/bin/env python3
"""Check that this computer can make videos with the video-studio skill, and say exactly how to fix
what is missing.

    python doctor.py            a readable report (Windows: py doctor.py)
    python doctor.py --json     the same as JSON, with the fix command for this OS (Claude reads this)
    python doctor.py --quick    instant "ready" if a full check passed in the last 14 days

Required: Node.js 22+, FFmpeg and ffprobe, the HyperFrames CLI, the HyperFrames skills and a
headless browser for rendering. Optional: uv (only to map a music track of your own).
A passing full check is remembered in ~/.claude/video-studio/ready.json.
"""

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time

READY = os.path.join(os.path.expanduser("~"), ".claude", "video-studio", "ready.json")
FRESH_DAYS = 14
OS = "windows" if os.name == "nt" else ("mac" if sys.platform == "darwin" else "linux")
SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSTALLER = {"windows": "setup-video-studio.bat (double-click it)", "mac": "setup-video-studio.command",
             "linux": "setup-video-studio.sh"}

# What fixes each missing piece, per OS. Claude runs these after the person says yes.
FIX = {
    "node": {"windows": "winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements",
             "mac": "brew install node", "linux": "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"},
    "ffmpeg": {"windows": "winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements",
               "mac": "brew install ffmpeg", "linux": "sudo apt-get install -y ffmpeg"},
    "hyperframes": {"windows": "npx --yes hyperframes --version", "mac": "npx --yes hyperframes --version",
                    "linux": "npx --yes hyperframes --version"},
    "skills": {"windows": "npx --yes hyperframes skills", "mac": "npx --yes hyperframes skills",
               "linux": "npx --yes hyperframes skills"},
    "browser": {"windows": "npx --yes hyperframes browser ensure", "mac": "npx --yes hyperframes browser ensure",
                "linux": "npx --yes hyperframes browser ensure"},
    "uv": {"windows": "winget install -e --id astral-sh.uv --accept-source-agreements --accept-package-agreements",
           "mac": "brew install uv", "linux": "curl -LsSf https://astral.sh/uv/install.sh | sh"},
}
AFTER_INSTALL = {"windows": "Close and reopen Claude Code (or the terminal) so new programs are found.",
                 "mac": "Open a new terminal (or restart Claude Code) so new programs are found.",
                 "linux": "Open a new terminal (or restart Claude Code) so new programs are found."}


def run(cmd, timeout=240):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, shell=(os.name == "nt"))
        return p.returncode, (p.stdout + p.stderr).strip()
    except (OSError, subprocess.SubprocessError) as e:
        return 1, str(e)


def check():
    items = []

    def add(key, name, ok, detail, required=True):
        items.append({"key": key, "name": name, "ok": bool(ok), "required": required, "detail": detail,
                      "fix": None if ok else FIX.get(key, {}).get(OS)})

    code, out = run(["node", "--version"]) if shutil.which("node") else (1, "")
    m = re.search(r"v(\d+)", out)
    add("node", "Node.js 22+", m and int(m.group(1)) >= 22, out or "not found")
    ff = shutil.which("ffmpeg") and shutil.which("ffprobe")
    add("ffmpeg", "FFmpeg + ffprobe", ff, run(["ffmpeg", "-version"])[1].splitlines()[0][:60] if ff else "not found")

    browser_ok, hf_ok = False, False
    if shutil.which("node"):
        code, out = run(["npx", "--yes", "hyperframes", "--version"], timeout=300)
        hf_ok = code == 0
        add("hyperframes", "HyperFrames CLI", hf_ok, out.splitlines()[-1][:60] if out else "no output")
        if hf_ok:
            code, out = run(["npx", "--yes", "hyperframes", "doctor", "--json"], timeout=300)
            try:
                d = json.loads(out[out.index("{"):])
                chrome = [c for c in d.get("checks") or [] if c.get("name") == "Chrome"]
                browser_ok = (chrome and chrome[0].get("ok")) or bool(os.environ.get("HYPERFRAMES_BROWSER_PATH"))
                add("browser", "Render browser (Chrome headless)", browser_ok,
                    (chrome[0].get("detail") if chrome else "unknown") or "")
            except ValueError:
                add("browser", "Render browser (Chrome headless)", False, "hyperframes doctor gave no JSON")
    else:
        add("hyperframes", "HyperFrames CLI", False, "needs Node.js first")

    home = os.path.expanduser("~")
    places = [os.path.join(home, ".claude", "skills"), os.path.join(os.getcwd(), ".claude", "skills"),
              os.path.join(home, ".agents", "skills")]
    found = [p for p in places if os.path.isdir(os.path.join(p, "hyperframes-core"))]
    add("skills", "HyperFrames skills", found, found[0] if found else "not found in ~/.claude/skills")
    add("uv", "uv (only for mapping your own music)", shutil.which("uv"), shutil.which("uv") or "not found",
        required=False)
    ready = all(i["ok"] for i in items if i["required"])
    return {"ready": ready, "os": OS, "python": platform.python_version(), "skillDir": SKILL_DIR,
            "checkedAt": int(time.time()), "items": items, "afterInstall": AFTER_INSTALL[OS],
            "installer": INSTALLER[OS]}


def remember(result):
    if result["ready"]:
        os.makedirs(os.path.dirname(READY), exist_ok=True)
        with open(READY, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=1)
    elif os.path.exists(READY):
        os.remove(READY)


def cached():
    try:
        with open(READY, encoding="utf-8") as fh:
            r = json.load(fh)
    except (OSError, ValueError):
        return None
    age = time.time() - r.get("checkedAt", 0)
    if r.get("ready") and 0 <= age < FRESH_DAYS * 86400:
        r["cached"] = True
        return r
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--quick", action="store_true", help="trust a recent passing check")
    a = ap.parse_args()
    r = (cached() if a.quick else None) or check()
    if not r.get("cached"):
        remember(r)
    if a.json:
        print(json.dumps(r, indent=1))
    else:
        if r.get("cached"):
            print("ok   Ready (checked %s; run without --quick to re-check)." %
                  time.strftime("%Y-%m-%d", time.localtime(r["checkedAt"])))
        for i in r["items"] if not r.get("cached") else []:
            tag = "ok  " if i["ok"] else ("MISS" if i["required"] else "opt ")
            print("%s %s: %s" % (tag, i["name"], i["detail"]))
            if not i["ok"] and i["fix"]:
                print("       fix: %s" % i["fix"])
        if not r["ready"]:
            print("\nNot ready. Easiest fix: run the installer, %s, or the fix commands above. %s"
                  % (r["installer"], r["afterInstall"]))
        elif not r.get("cached"):
            print("\nReady to make videos.")
    sys.exit(0 if r["ready"] else 1)


if __name__ == "__main__":
    main()
