"""Video Studio: the video engine on the worker.

HyperFrames (npm `hyperframes`, pinned in video_config.HYPERFRAMES_VERSION)
is installed once per deploy into video_config.engine_dir() with npm, the
first time a render needs it. Node 22 comes from the build (railpack.json,
"packages"); ffmpeg is already there for Social Media Intelligence.

run() starts every outside program in its own process group with a time
limit. A program still running at its limit is stopped with its whole group
(the browser HyperFrames started included), never by name.
"""

from __future__ import annotations

import collections
import json
import logging
import os
import shutil
import signal
import subprocess
import threading
import time

from tracker import video_config as cfg

log = logging.getLogger("video_studio.engine")

_INSTALL_LOCK = threading.Lock()


class EngineMissing(RuntimeError):
    """A part of the video engine is missing on this service (Node, HyperFrames, the browser,
    ffmpeg). The message says which, for the staff engine page and the job's log."""


class TimedOut(RuntimeError):
    """A program ran past its time limit and was stopped."""


class Stopped(RuntimeError):
    """The worker is stopping; the program was stopped with it."""


def run(args, *, cwd=None, env=None, timeout, stop=None, stdout_path=None):
    """Run a program; return (exit code, output). Output is stdout and stderr
    together, the last 20,000 characters; with `stdout_path`, stdout goes to
    that file whole (a large JSON report) and output is stderr only. Raises
    TimedOut past `timeout` seconds, or Stopped when the `stop` event is set
    first."""
    out_file = open(stdout_path, "wb") if stdout_path else None
    try:
        proc = subprocess.Popen(args, cwd=cwd, env=env, stdout=out_file or subprocess.PIPE,
                                stderr=subprocess.PIPE if out_file else subprocess.STDOUT,
                                stdin=subprocess.DEVNULL, start_new_session=True)
    finally:
        if out_file:
            out_file.close()
    stream = proc.stderr if out_file else proc.stdout
    chunks = collections.deque(maxlen=64)          # the last ~256 KB is plenty
    reader = threading.Thread(target=lambda: chunks.extend(iter(lambda: stream.read(4096), b"")),
                              daemon=True)
    reader.start()
    deadline = time.monotonic() + timeout
    why = None
    while proc.poll() is None:
        if time.monotonic() >= deadline:
            why = "timeout"
            break
        if stop is not None and stop.is_set():
            why = "stop"
            break
        time.sleep(0.2)
    if why:
        _kill_group(proc)
    reader.join(timeout=5)
    out = b"".join(chunks).decode("utf-8", "replace")[-20000:]
    if why == "timeout":
        raise TimedOut("stopped after %ds: %s" % (timeout, os.path.basename(str(args[0]))))
    if why == "stop":
        raise Stopped("stopped: the worker is shutting down")
    return proc.returncode, out


def _kill_group(proc):
    """Stop a program and everything it started (its own process group)."""
    for sig, wait in ((signal.SIGTERM, 5), (signal.SIGKILL, 5)):
        try:
            os.killpg(proc.pid, sig)
        except ProcessLookupError:
            return
        try:
            proc.wait(timeout=wait)
            return
        except subprocess.TimeoutExpired:
            continue


def node_path():
    return shutil.which("node")


def ffmpeg_path():
    return shutil.which("ffmpeg")


def _bin():
    return os.path.join(cfg.engine_dir(), "node_modules", ".bin", "hyperframes")


def installed_version():
    try:
        with open(os.path.join(cfg.engine_dir(), "node_modules", "hyperframes", "package.json")) as fh:
            return json.load(fh).get("version")
    except (OSError, ValueError):
        return None


def ensure_installed(timeout=cfg.INSTALL_TIMEOUT_S):
    """The path of the pinned hyperframes program, installing it if needed."""
    with _INSTALL_LOCK:
        if installed_version() == cfg.HYPERFRAMES_VERSION and os.path.exists(_bin()):
            return _bin()
        npm = shutil.which("npm")
        if not npm or not node_path():
            raise EngineMissing("Node is not installed on this service (railpack.json adds Node 22 to the build).")
        root = cfg.engine_dir()
        os.makedirs(root, exist_ok=True)
        with open(os.path.join(root, "package.json"), "w") as fh:
            json.dump({"name": "video-studio-engine", "private": True}, fh)
        log.info("installing hyperframes %s into %s", cfg.HYPERFRAMES_VERSION, root)
        code, out = run([npm, "install", "--no-audit", "--no-fund", "--save-exact", "--prefix", root,
                         "hyperframes@" + cfg.HYPERFRAMES_VERSION], cwd=root, env=dict(os.environ), timeout=timeout)
        if code != 0 or installed_version() != cfg.HYPERFRAMES_VERSION:
            raise EngineMissing("npm could not install hyperframes: " + out[-600:])
        return _bin()


def ensure_browser(timeout=cfg.INSTALL_TIMEOUT_S):
    """The headless browser to render with, installing Playwright's if it is missing."""
    found = cfg.browser_path()
    if found:
        return found
    import sys
    log.info("no headless browser found; installing Playwright's chromium-headless-shell")
    code, out = run([sys.executable, "-m", "playwright", "install", "chromium-headless-shell"],
                    env=dict(os.environ), timeout=timeout)
    cfg._playwright_root.cache_clear()
    found = cfg.browser_path()
    if not found:
        raise EngineMissing("No Chromium headless shell was found, and installing one failed: " + out[-400:])
    return found


def status():
    """What the engine has on this machine, for the staff page."""
    browser = cfg.browser_path()
    return {"node": bool(node_path()), "ffmpeg": bool(ffmpeg_path()), "browser": bool(browser),
            "hyperframes": installed_version(), "pinned": cfg.HYPERFRAMES_VERSION,
            "switched_on": cfg.switched_on()}
