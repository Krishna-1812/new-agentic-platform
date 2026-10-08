#!/usr/bin/env python3
"""Check that this machine can make videos with the video-studio skill, and say how to fix what is missing.

    python doctor.py          (Windows: py doctor.py)

Required: Node.js 22+, FFmpeg and ffprobe, the HyperFrames CLI (npx hyperframes), and the
HyperFrames skills. Optional: uv (only to map a music track of your own) and madmom (better bar
lines for your own tracks).
"""

import json
import os
import re
import shutil
import subprocess
import sys

OK, BAD, OPT = "ok  ", "MISS", "opt "


def run(cmd, timeout=180):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, shell=(os.name == "nt"))
        return p.returncode, (p.stdout + p.stderr).strip()
    except (OSError, subprocess.SubprocessError) as e:
        return 1, str(e)


def main():
    problems = 0
    node = shutil.which("node")
    code, out = run(["node", "--version"]) if node else (1, "")
    m = re.search(r"v(\d+)", out)
    if m and int(m.group(1)) >= 22:
        print(OK, "Node.js", out)
    else:
        problems += 1
        print(BAD, "Node.js 22 or newer (found %s). Install from https://nodejs.org (LTS)." % (out or "none"))
    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool):
            print(OK, tool, run([tool, "-version"])[1].splitlines()[0][:60])
        else:
            problems += 1
            print(BAD, tool, "- Windows: winget install Gyan.FFmpeg · macOS: brew install ffmpeg · Linux: apt install ffmpeg")
    if node:
        code, out = run(["npx", "--yes", "hyperframes", "--version"], timeout=300)
        if code == 0:
            print(OK, "HyperFrames CLI", out.splitlines()[-1][:40])
            code, out = run(["npx", "--yes", "hyperframes", "doctor", "--json"], timeout=300)
            try:
                d = json.loads(out[out.index("{"):])
                for c in d.get("checks") or []:
                    if c.get("ok"):
                        continue
                    detail = c.get("detail") or ""
                    optional = "optional" in detail.lower() or c.get("name") in ("Docker", "Docker running")
                    if not optional:
                        problems += 1
                    print(OPT if optional else BAD, "%s: %s%s" % (c.get("name"), detail,
                                                                 (" -> " + c["hint"]) if c.get("hint") else ""))
                if os.environ.get("HYPERFRAMES_BROWSER_PATH"):
                    print(OK, "HYPERFRAMES_BROWSER_PATH =", os.environ["HYPERFRAMES_BROWSER_PATH"])
            except ValueError:
                print(OPT, "hyperframes doctor gave no JSON; run `npx hyperframes doctor` yourself")
        else:
            problems += 1
            print(BAD, "HyperFrames CLI: `npx hyperframes --version` failed:", out[-200:])
    home = os.path.expanduser("~")
    places = [os.path.join(home, ".claude", "skills"), os.path.join(os.getcwd(), ".claude", "skills"),
              os.path.join(home, ".agents", "skills")]
    found = [p for p in places if os.path.isdir(os.path.join(p, "hyperframes-core"))]
    if found:
        print(OK, "HyperFrames skills in", found[0])
    else:
        print(OPT, "HyperFrames skills not found in the usual folders. If /hyperframes-core is not listed in "
                   "Claude Code, run: npx hyperframes skills   (or: npx skills add heygen-com/hyperframes --all)")
    print(OK if shutil.which("uv") else OPT, "uv", "(needed only to map your own music track: "
          "https://docs.astral.sh/uv/getting-started/installation/)" if not shutil.which("uv") else "")
    print("\n%s" % ("Ready to make videos." if not problems else "%d thing(s) to fix above." % problems))
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
