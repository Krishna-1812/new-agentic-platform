"""Hosting on Railway, and what search engines may index.

Railway builds with Railpack (its current default; the Nixpacks builder this
repo used to name is no longer offered), so the build settings live in
railway.toml, railpack.json and .python-version. robots.txt used to shut the
whole site out of search; the public marketing pages are now indexable and
every signed-in, internal and client area stays out.
"""

import json
import os
import re
import sys

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("SECRET_KEY", "test")

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)

import app as appmod  # noqa: E402


def _read(name):
    with open(os.path.join(_ROOT, name), encoding="utf-8") as f:
        return f.read()


# ── Build and deploy settings ───────────────────────────────────────────────

def test_railway_builds_with_railpack_and_starts_the_flask_app():
    toml = _read("railway.toml")
    assert re.search(r'^builder = "RAILPACK"$', toml, re.M)
    assert "NIXPACKS" not in toml
    # Railpack's own Flask default is `gunicorn main:app`; main.py here is the
    # tracker CLI, so the start command must stay explicit.
    assert re.search(r'^startCommand = "gunicorn app:app --bind 0\.0\.0\.0:\$PORT', toml, re.M)
    assert re.search(r'^healthcheckPath = "/health"$', toml, re.M)
    assert appmod.app.test_client().get("/health").status_code == 200


def test_ffmpeg_is_installed_without_dropping_railpacks_own_packages():
    cfg = json.loads(_read("railpack.json"))
    assert cfg["deploy"]["aptPackages"] == ["...", "ffmpeg"]
    assert not os.path.exists(os.path.join(_ROOT, "nixpacks.toml")), "Railpack ignores it"


def test_python_is_pinned_to_the_version_the_tests_run_on():
    """Railpack would otherwise pick its own default (3.13 at the time of
    writing); the suite and every GitHub workflow run 3.11."""
    assert _read(".python-version").strip() == "3.11"


# ── robots.txt ──────────────────────────────────────────────────────────────

def _rules():
    body = appmod.app.test_client().get("/robots.txt").get_data(as_text=True)
    rules = []
    for line in body.splitlines():
        kind, _, path = line.partition(":")
        if kind in ("Allow", "Disallow"):
            rules.append((kind == "Allow", path.strip()))
    return rules


def _allowed(path, rules):
    """Google's reading: the longest matching rule wins; "$" anchors the end."""
    best = None
    for allow, pat in rules:
        anchored = pat.endswith("$")
        core = pat[:-1] if anchored else pat
        if (path == core) if anchored else path.startswith(core):
            if best is None or len(pat) > len(best[1]):
                best = (allow, pat)
    return True if best is None else best[0]


def test_the_public_marketing_pages_can_be_indexed():
    rules = _rules()
    for path in ("/", "/agents", "/agents/signal-tracker", "/industries/health-tech",
                 "/platform", "/signals", "/solutions", "/why-intelligence",
                 "/integrations", "/resources", "/privacy", "/terms", "/static/css/press.css"):
        assert _allowed(path, rules), path


def test_signed_in_internal_and_client_areas_cannot():
    rules = _rules()
    client = sorted(appmod.CLIENTS)[0]
    for path in ("/hub", "/admin/members", "/app", "/app/settings", "/api/whoami",
                 "/auth/google", "/login", "/logout", "/ppc", "/dashboard/healthcare",
                 "/" + client, "/" + client + "/agents/x"):
        assert not _allowed(path, rules), path
