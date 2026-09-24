"""The internal staff app left the /p2 prefix (2026-09-24).

It used to live at /p2/hub, /p2/admin/..., /p2/strategic-agents/... and now
sits at the top level: /hub, /admin/..., /strategic-agents/.... What has to
stay true:

  * nothing the site serves links to /p2 any more;
  * every old /p2 link or bookmark still lands, one hop, method preserved;
  * the move did not open anything up (the staff gate is on the new paths);
  * "/" is still the public home page (a naive rewrite of the old "/p2/"
    route would have turned it into a redirect to /hub);
  * analytics recorded under /p2 fold into the new paths;
  * search engines stay out of the internal app.
"""

import os
import re
import subprocess
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("SECRET_KEY", "test")

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)

import app as appmod  # noqa: E402

_STAFF = "someone@markifydigital.com"
_OUTSIDER = "someone@example.com"


def _client(email=None):
    c = appmod.app.test_client()
    if email:
        with c.session_transaction() as sess:
            sess["google_user"] = {"email": email, "name": "T"}
    return c


# ── Routes ──────────────────────────────────────────────────────────────────

def test_only_the_redirect_is_left_under_p2():
    rules = [r for r in appmod.app.url_map.iter_rules() if r.rule.startswith("/p2")]
    assert {r.endpoint for r in rules} == {"p2_legacy_redirect"}, sorted(r.rule for r in rules)


def test_the_home_page_is_still_the_public_home_page():
    endpoint, _ = appmod.app.url_map.bind("x").match("/")
    assert endpoint == "index"
    r = _client().get("/")
    assert r.status_code == 200


@pytest.mark.parametrize("old,new", [
    ("/p2", "/hub"),
    ("/p2/", "/hub"),
    ("/p2/hub", "/hub"),
    ("/p2/admin/internal-usage", "/admin/internal-usage"),
    ("/p2/strategic-agents/ad-intelligence", "/strategic-agents/ad-intelligence"),
    ("/p2/seo-aeo/keyword-opportunity-engine?x=1&y=2", "/seo-aeo/keyword-opportunity-engine?x=1&y=2"),
])
def test_an_old_p2_link_lands_on_the_same_page_without_the_prefix(old, new):
    r = _client().get(old)
    assert r.status_code == 308
    assert r.headers["Location"].endswith(new)


def test_an_old_page_posting_to_a_p2_url_keeps_its_method():
    """308, not 301: a browser still holding an old page's JS may POST to the
    old URL, and a 301 would be retried as a GET with the body dropped."""
    r = _client(_STAFF).post("/p2/strategic-agents/company-people-intelligence/chat", json={"q": "x"})
    assert r.status_code == 308


def test_older_section_names_still_resolve_from_the_old_prefix():
    r = _client().get("/p2/gtm/company-people-intelligence")
    assert r.status_code == 308 and r.headers["Location"].endswith("/gtm/company-people-intelligence")
    r = _client().get("/gtm/company-people-intelligence")
    assert r.status_code == 308 and r.headers["Location"].endswith("/strategic-agents/company-people-intelligence")


# ── The gate moved with the pages ───────────────────────────────────────────

@pytest.mark.parametrize("path", ["/hub", "/strategic-agents", "/seo-aeo", "/playbook",
                                  "/abm-signal-tracker/accounts", "/admin/internal-usage"])
def test_signed_out_visitors_are_sent_to_sign_in(path):
    r = _client().get(path)
    assert r.status_code == 302 and "/login" in r.headers["Location"], (path, r.status_code)


@pytest.mark.parametrize("path", ["/hub", "/strategic-agents", "/seo-aeo", "/playbook"])
def test_people_outside_the_company_are_sent_to_the_public_side(path):
    r = _client(_OUTSIDER).get(path)
    assert r.status_code == 302 and r.headers["Location"].endswith("/app"), (path, r.status_code)


def test_staff_land_on_hub_and_admin_pages_stay_admin_only():
    assert _client(_STAFF).get("/hub").status_code == 200
    assert _client(_STAFF).get("/admin/internal-usage").status_code == 403


def test_a_staff_sign_in_that_lands_in_the_internal_app_is_recognised_as_internal():
    for p in ("/hub", "/admin/x", "/strategic-agents/y?z=1", "/seo-aeo", "/p2/hub"):
        assert appmod._is_internal_path(p), p
    for p in ("/app", "/app/settings", "/", "/agents", "/42northdental", "/login"):
        assert not appmod._is_internal_path(p), p


# ── Nothing links to /p2 ────────────────────────────────────────────────────

def test_no_page_script_or_bundle_links_to_p2():
    files = subprocess.check_output(["git", "ls-files", "templates", "static", "ad_intelligence",
                                     "apps/ad-intelligence/src", "apps/ad-intelligence/vite.config.ts",
                                     "reports", "tracker", "scripts"], cwd=_ROOT).decode().split()
    offenders = []
    for f in files:
        if not f.endswith((".html", ".js", ".css", ".ts", ".tsx", ".py", ".json")):
            continue
        src = open(os.path.join(_ROOT, f), encoding="utf-8", errors="ignore").read()
        if re.search(r"""(?<![\w-])/p2(?:/|["'`?#)\s]|$)""", src) or "\\/p2\\/" in src:
            offenders.append(f)
    assert offenders == [], offenders


def test_app_py_mentions_p2_only_in_the_redirect_the_internal_sections_and_history():
    src = open(os.path.join(_ROOT, "app.py"), encoding="utf-8").read()
    code_lines = [l for l in src.splitlines() if "/p2" in l and not l.lstrip().startswith("#")]
    allowed = ('@app.route("/p2', '("/p2/', '"/p2/', 'p2_vid')
    stray = [l.strip() for l in code_lines if not any(a in l for a in allowed)]
    assert stray == [], stray


def test_the_hub_links_to_the_new_paths(monkeypatch):
    body = _client(_STAFF).get("/hub").get_data(as_text=True)
    assert "/p2/" not in body
    assert 'href="/strategic-agents' in body


# ── Analytics recorded under /p2 ────────────────────────────────────────────

@pytest.mark.parametrize("recorded,today", [
    ("/p2/hub", "/hub"),
    ("/p2/admin/internal-usage", "/admin/internal-usage"),
    ("/p2/strategic-agents/ad-intelligence", "/strategic-agents/ad-intelligence"),
    ("/p2/gtm/company-people-intelligence", "/strategic-agents/company-people-intelligence"),
])
def test_page_views_recorded_under_p2_fold_into_the_new_path(recorded, today):
    assert appmod._page_label(recorded) == today
    assert appmod._page_label(today) == today          # and the new path is stable


# ── Search engines ──────────────────────────────────────────────────────────

def test_robots_keeps_the_internal_app_out():
    body = _client().get("/robots.txt").get_data(as_text=True)
    allows = [l.split(":", 1)[1].strip() for l in body.splitlines() if l.startswith("Allow:")]
    for path in ("/hub", "/admin/internal-usage", "/strategic-agents", "/seo-aeo", "/playbook",
                 "/abm-signal-tracker/accounts", "/playbook"):
        assert not any(path.startswith(a.rstrip("$")) and (not a.endswith("$") or path == a[:-1])
                       for a in allows), path
