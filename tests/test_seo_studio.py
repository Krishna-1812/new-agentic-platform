"""SEO Studio (seo-apps/, its own Railway service) as the platform sees it.

The studio refuses every API call without a signed pass (seo-apps/server/
routes/auth.js), so each iframe onto it has to carry one. These tests cover
that pass, where the studio's address comes from, and that /seo-aeo lists
exactly the tools the studio itself offers."""

import base64
import hashlib
import hmac
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app as appmod  # noqa: E402

SECRET = "cross-check-secret"
# The same string is asserted on the studio side (seo-apps/server/routes/
# __tests__/auth.test.js), so a change to either implementation's format
# breaks one of the two suites instead of every login.
FROM_PYTHON = ("eyJlIjoic3VkaGVlckBtYXJraWZ5ZGlnaXRhbC5jb20iLCJyIjoic3RhZmYiLCJ4Ijo0MTAyNDQ0ODAwfQ"
               ".5f8_nH9huXrRgSauept0y55TZqsXXQr-yoGTF1Fh6rM")


def _decode(token):
    body, sig = token.split(".")
    expected = base64.urlsafe_b64encode(
        hmac.new(SECRET.encode(), body.encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
    assert hmac.compare_digest(sig, expected), "signature does not verify"
    return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))


@pytest.fixture
def secret(monkeypatch):
    monkeypatch.setattr(appmod, "SEO_STUDIO_SECRET", SECRET)


def _client(email):
    c = appmod.app.test_client()
    with c.session_transaction() as sess:
        sess["google_user"] = {"email": email, "name": "T"}
    return c


def _iframe_src(body):
    m = re.search(r'<iframe[^>]+src="([^"]+)"', body)
    assert m, "no iframe on the page"
    return m.group(1).replace("&amp;", "&")


# ── The pass ─────────────────────────────────────────────────────────────────

def test_the_pass_matches_the_studios_format_byte_for_byte(secret, monkeypatch):
    monkeypatch.setattr(appmod.time, "time", lambda: 4102444800 - appmod._STUDIO_PASS_TTL)
    assert appmod._studio_pass("Sudheer@markifydigital.com", "staff") == FROM_PYTHON


def test_the_pass_expires_after_twelve_hours(secret):
    import time
    payload = _decode(appmod._studio_pass("a@markifydigital.com", "staff"))
    assert 0 < payload["x"] - time.time() <= 12 * 3600


def test_staff_open_a_tool_with_a_staff_pass(secret):
    r = _client("sudheer@markifydigital.com").get("/seo-aeo/keyword-research")
    assert r.status_code == 200
    src = _iframe_src(r.get_data(as_text=True))
    q = parse_qs(urlsplit(src).query)
    assert "pt" not in q, "the old shared token must not be sent once a secret is set"
    payload = _decode(q["st"][0])
    assert payload["e"] == "sudheer@markifydigital.com"
    assert payload["r"] == "staff"


def test_a_public_member_gets_an_app_pass(secret, monkeypatch):
    monkeypatch.setattr(appmod, "_agent_run_counts", lambda email: {})
    r = _client("someone@gmail.com").get("/app/keyword-finder/use")
    assert r.status_code == 200
    src = _iframe_src(r.get_data(as_text=True))
    q = parse_qs(urlsplit(src).query)
    assert q["embed"] == ["1"]
    assert _decode(q["st"][0])["r"] == "app", "public members must not get a staff pass"


def test_without_a_secret_the_legacy_shared_token_is_still_sent(monkeypatch):
    monkeypatch.setattr(appmod, "SEO_STUDIO_SECRET", "")
    monkeypatch.setenv("SERP_PLATFORM_TOKEN", "legacy")
    r = _client("sudheer@markifydigital.com").get("/seo-aeo/keyword-research")
    q = parse_qs(urlsplit(_iframe_src(r.get_data(as_text=True))).query)
    assert q == {"pt": ["legacy"]}


# ── Where the studio lives ───────────────────────────────────────────────────

def test_the_studio_url_comes_from_the_environment():
    """Read at import, so checked in a fresh interpreter rather than by
    reloading app.py under the other tests."""
    import subprocess
    env = dict(os.environ, SEO_STUDIO_URL="https://seo-studio.example.com/")
    out = subprocess.run([sys.executable, "-c", "import app; print(app._SERP_BASE)"],
                         cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)
    assert out.stdout.strip().splitlines()[-1] == "https://seo-studio.example.com"


# ── The tool list ────────────────────────────────────────────────────────────

def _studio_menu_ids():
    src = (ROOT / "seo-apps" / "client" / "src" / "toolsMeta.js").read_text(encoding="utf-8")
    return set(re.findall(r"\{\s*id:\s*'([^']+)'", src))


def test_every_studio_tool_has_a_page_here():
    """The studio reports its tool id back to /seo-aeo/<id> (embed.html keeps
    the address bar in sync), so an id with no slug here is a 404 on reload."""
    slugs = {t["slug"] for t in appmod._seo_tools()}
    missing = _studio_menu_ids() - slugs
    assert not missing, "studio tools with no /seo-aeo page: %s" % sorted(missing)


def test_every_tool_here_points_at_a_real_studio_route():
    app_jsx = (ROOT / "seo-apps" / "client" / "src" / "App.jsx").read_text(encoding="utf-8")
    routes = set(re.findall(r'<Route path="([^"]+)"', app_jsx))
    for tool in appmod._seo_tools():
        assert tool["path"] in routes, "%s points at %s, which the studio does not serve" % (
            tool["slug"], tool["path"])


def test_retired_tools_redirect_instead_of_404ing():
    c = _client("sudheer@markifydigital.com")
    assert c.get("/seo-aeo/hub-spoke").headers["Location"].endswith("/seo-aeo/content-architect")
    assert c.get("/seo-aeo/gbp-qc-agent").headers["Location"].endswith("/seo-aeo/gbp-qc")
    assert c.get("/seo-aeo/team-insights").headers["Location"].endswith("/seo-aeo")


def test_no_tool_points_at_another_organisations_service():
    for tool in appmod._seo_tools():
        assert not tool.get("url"), "%s still points at an external service" % tool["slug"]
