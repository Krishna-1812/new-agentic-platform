"""Video Studio: the sandbox a composition is checked and rendered in.

A composition is a web page that Claude (or a person) wrote, so it is treated
as untrusted code:

  * Each job gets a fresh folder. Files are written into it only after their
    paths are checked (no absolute paths, no "..", only the allowed kinds of
    file, size limits), and the folder is removed afterwards.
  * The bundled kit (GSAP and the fonts, tracker/video_kit) is copied in, so
    nothing has to be fetched.
  * The browser has no network. HyperFrames starts it through a small script
    that points every request at a proxy inside this process (ProxyTrap),
    which refuses it and records the address. Only the job's own files,
    served by HyperFrames on this machine, load. A composition that tries to
    reach the site, the database or the internet still renders, without what
    it asked for, and the attempt is logged with the job.
  * The programs get a short list of environment variables, never the
    service's secrets (database address, API keys).
  * Every program has a time limit (video_engine.run).
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import re
import shlex
import shutil
import socket
import tempfile
import threading

from tracker import video_config as cfg
from tracker import video_engine

log = logging.getLogger("video_studio.sandbox")

KIT_PREFIX = "kit/"
# Only these are passed to the programs; everything else (DATABASE_URL, API
# keys) is left out.
ENV_KEEP = ("PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "XDG_CACHE_HOME", "XDG_CONFIG_HOME",
            "FONTCONFIG_PATH", "FONTCONFIG_FILE", "NODE_OPTIONS")
# Namespace strings in SVG and XML are addresses that are never fetched.
_HARMLESS = {"www.w3.org"}
_URL = re.compile(r"""(?:https?:)?//([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?""", re.I)


class BadFile(ValueError):
    """A composition file that cannot be written; the message says why."""


def check_path(path):
    """A safe relative path for a composition file, or BadFile."""
    p = str(path or "")
    if not p or len(p) > 200:
        raise BadFile("a file needs a short name")
    if p.startswith(("/", "\\")) or "\\" in p or ":" in p or "\x00" in p:
        raise BadFile("%s: only relative paths inside the project" % p[:80])
    parts = p.split("/")
    if any(part in ("", ".", "..") or part.startswith(".") for part in parts):
        raise BadFile("%s: no '..', hidden or empty parts" % p[:80])
    if p.startswith(KIT_PREFIX):
        raise BadFile("%s: kit/ is reserved for the bundled files" % p[:80])
    if not p.lower().endswith(cfg.ALLOWED_SUFFIXES):
        raise BadFile("%s: that kind of file is not allowed" % p[:80])
    return p


def decode_files(files):
    """{path: bytes} from stored files ({"text": ...} or {"b64": ...}), checked."""
    if not isinstance(files, dict) or not files:
        raise BadFile("the composition has no files")
    if len(files) > cfg.MAX_FILES:
        raise BadFile("too many files (%d; at most %d)" % (len(files), cfg.MAX_FILES))
    if "index.html" not in files:
        raise BadFile("the composition has no index.html")
    out, total = {}, 0
    for path, body in files.items():
        p = check_path(path)
        if isinstance(body, dict) and "text" in body:
            data = str(body["text"]).encode("utf-8")
        elif isinstance(body, dict) and "b64" in body:
            try:
                data = base64.b64decode(body["b64"], validate=True)
            except (binascii.Error, ValueError):
                raise BadFile("%s: the file is damaged" % p)
        else:
            raise BadFile("%s: no contents" % p)
        if len(data) > cfg.MAX_FILE_BYTES:
            raise BadFile("%s is too large" % p)
        total += len(data)
        out[p] = data
    if total > cfg.MAX_JOB_BYTES:
        raise BadFile("the files are too large together")
    return out


def outside_addresses(files):
    """Hosts that the composition's text files name (it will not reach them)."""
    hosts = set()
    for path, data in files.items():
        if not path.lower().endswith((".html", ".css", ".js", ".json", ".svg")):
            continue
        for m in _URL.finditer(data.decode("utf-8", "replace")):
            host = m.group(1).lower()
            if host not in _HARMLESS:
                hosts.add(host)
    return sorted(hosts)


class ProxyTrap:
    """A proxy on 127.0.0.1 that refuses every request and records where it was going."""

    def __init__(self):
        self.blocked = []
        self._lock = threading.Lock()
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.bind(("127.0.0.1", 0))
        self._sock.listen(32)
        self._sock.settimeout(0.5)
        self.port = self._sock.getsockname()[1]
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._serve, name="video-proxy-trap", daemon=True)
        self._thread.start()

    def _serve(self):
        while not self._stop.is_set():
            try:
                conn, _ = self._sock.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            threading.Thread(target=self._refuse, args=(conn,), daemon=True).start()

    def _refuse(self, conn):
        try:
            conn.settimeout(3)
            first = conn.recv(4096).split(b"\r\n", 1)[0].decode("latin-1", "replace")
            parts = first.split()
            target = parts[1] if len(parts) > 1 else "?"
            m = _URL.search(target) if "//" in target else None
            host = (m.group(1) if m else target.rsplit(":", 1)[0]).lower()[:200]
            with self._lock:
                if host not in self.blocked:
                    self.blocked.append(host)
            conn.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        except OSError:
            pass
        finally:
            conn.close()

    def close(self):
        self._stop.set()
        try:
            self._sock.close()
        except OSError:
            pass
        self._thread.join(timeout=2)


class Sandbox:
    """with Sandbox(job_id) as box: box.write(files); box.check(); box.render(...)"""

    def __init__(self, job_id, *, stop=None, hyperframes=None, browser=None):
        self.job_id = job_id
        self.stop = stop
        self._hyperframes = hyperframes
        self._browser = browser
        self.root = None
        self.trap = None

    # ── Setting up and taking down ──────────────────────────────────────────
    def __enter__(self):
        self.root = tempfile.mkdtemp(prefix="video-job-%s-" % self.job_id, dir=cfg.work_dir())
        self.project = os.path.join(self.root, "project")
        shutil.copytree(cfg.kit_dir(), os.path.join(self.project, "kit"),
                        ignore=shutil.ignore_patterns("*.md"))
        self.trap = ProxyTrap()
        return self

    def __exit__(self, *exc):
        if self.trap:
            self.trap.close()
        if self.root:
            shutil.rmtree(self.root, ignore_errors=True)
        return False

    @property
    def blocked(self):
        return list(self.trap.blocked) if self.trap else []

    def write(self, files):
        """Write checked composition files ({path: bytes}) into the project."""
        for path, data in files.items():
            dest = os.path.join(self.project, *check_path(path).split("/"))
            if not os.path.realpath(dest).startswith(os.path.realpath(self.project) + os.sep):
                raise BadFile("%s: outside the project" % path)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as fh:
                fh.write(data)

    def _browser_script(self):
        browser = self._browser or cfg.browser_path()
        if not browser:
            raise RuntimeError("No Chromium headless shell was found (on Railway set "
                               "RAILPACK_PYTHON_PLAYWRIGHT_INSTALL=1, as Page Watch does).")
        path = os.path.join(self.root, "browser.sh")
        with open(path, "w") as fh:
            fh.write("#!/bin/sh\n# Every request that is not to this machine goes to the proxy trap.\n")
            fh.write("exec %s %s %s \"$@\"\n" % (
                shlex.quote(browser), shlex.quote("--proxy-server=http://127.0.0.1:%d" % self.trap.port),
                shlex.quote("--proxy-bypass-list=<-loopback>;127.0.0.1;localhost")))
        os.chmod(path, 0o700)
        return path

    def env(self):
        env = {k: os.environ[k] for k in ENV_KEEP if k in os.environ}
        env.update(HYPERFRAMES_BROWSER_PATH=self._browser_script(), HYPERFRAMES_NO_TELEMETRY="1",
                   HYPERFRAMES_NO_UPDATE_CHECK="1", HYPERFRAMES_NO_AUTO_INSTALL="1", HYPERFRAMES_NO_FEEDBACK="1",
                   CI="1", NO_COLOR="1")
        return env

    def _hf(self, *args, timeout):
        program = self._hyperframes or video_engine.ensure_installed()
        return video_engine.run([program] + list(args), cwd=self.project, env=self.env(), timeout=timeout,
                                stop=self.stop)

    # ── The steps ───────────────────────────────────────────────────────────
    def check(self, timeout=cfg.CHECK_TIMEOUT_S):
        """hyperframes check: {"ok", "errors": [...], "warnings": [...]}."""
        code, out = self._hf("check", "--json", timeout=timeout)
        report = parse_check(out)
        if report is None:
            return {"ok": False, "errors": [{"code": "check_failed", "message": out.strip()[-600:] or
                                             "hyperframes check exited with %s" % code}], "warnings": []}
        return report

    def snapshot(self, times, timeout=cfg.CHECK_TIMEOUT_S):
        """PNG bytes of the frames at `times` (seconds), in order."""
        out_dir = os.path.join(self.root, "snaps")
        shutil.rmtree(out_dir, ignore_errors=True)
        at = ",".join("%.2f" % float(t) for t in times)
        code, out = self._hf("snapshot", "--at", at, "--no-end", "--describe", "false", "-o", out_dir,
                             timeout=timeout)
        if code != 0 or not os.path.isdir(out_dir):
            raise RuntimeError("snapshot failed: " + out[-400:])
        names = sorted(n for n in os.listdir(out_dir) if n.lower().endswith(".png"))
        frames = []
        for n in names:
            with open(os.path.join(out_dir, n), "rb") as fh:
                frames.append(fh.read())
        return frames

    def render(self, seconds, *, quality="high", timeout=None):
        """Render the project to MP4; return its bytes."""
        out = os.path.join(self.root, "out.mp4")
        code, text = self._hf("render", "--quality", quality, "--output", out,
                              timeout=timeout or cfg.render_timeout(seconds))
        if code != 0 or not os.path.exists(out) or os.path.getsize(out) == 0:
            raise RuntimeError("render failed: " + text[-600:])
        if os.path.getsize(out) > cfg.MAX_MP4_BYTES:
            raise RuntimeError("the video is too large (%d MB)" % (os.path.getsize(out) // 1_000_000))
        with open(out, "rb") as fh:
            return fh.read()

    def cover(self, mp4, at):
        """A JPEG of the frame at `at` seconds."""
        ffmpeg = video_engine.ffmpeg_path()
        if not ffmpeg:
            raise RuntimeError("ffmpeg is not installed on this service")
        src = os.path.join(self.root, "cover-src.mp4")
        dst = os.path.join(self.root, "cover.jpg")
        with open(src, "wb") as fh:
            fh.write(mp4)
        code, out = video_engine.run([ffmpeg, "-y", "-loglevel", "error", "-ss", "%.3f" % max(0.0, float(at)),
                                      "-i", src, "-frames:v", "1", "-q:v", "3", dst],
                                     env=self.env_plain(), timeout=cfg.COVER_TIMEOUT_S, stop=self.stop)
        if code != 0 or not os.path.exists(dst):
            raise RuntimeError("the cover frame could not be taken: " + out[-300:])
        with open(dst, "rb") as fh:
            return fh.read()

    def env_plain(self):
        return {k: os.environ[k] for k in ENV_KEEP if k in os.environ}


def parse_check(output):
    """The JSON report in hyperframes check's output, cut down to what we use."""
    start = output.find("{")
    while start != -1:
        try:
            data, _ = json.JSONDecoder().raw_decode(output[start:])
            if isinstance(data, dict) and "ok" in data:
                break
        except ValueError:
            pass
        start = output.find("{", start + 1)
    else:
        return None
    errors, warnings = [], []
    for section in ("lint", "runtime", "layout", "motion", "contrast"):
        part = data.get(section) or {}
        for f in part.get("findings") or []:
            item = {"area": section, "code": f.get("code", ""), "message": str(f.get("message", ""))[:400],
                    "selector": f.get("selector", ""), "time": f.get("time"), "fix": str(f.get("fixHint", ""))[:300]}
            (errors if f.get("severity") == "error" else warnings).append(item)
    return {"ok": bool(data.get("ok")) and not errors, "errors": errors, "warnings": warnings}
