"""The site lives at its custom domain. Page loads at the old Railway address move there; API calls,
webhooks, sign-in and the health check answer at both; links Flask builds behind Railway's proxy
are https."""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import app as appmod  # noqa: E402

OLD = "https://web-production-6748e.up.railway.app"


def test_the_site_address_is_the_custom_domain():
    assert appmod.SITE_URL == (os.environ.get("PUBLIC_BASE_URL", "").strip().rstrip("/")
                               or "https://northaxis.outcomes.digital")


def test_a_page_at_the_old_address_moves_to_the_same_page_on_the_custom_domain():
    c = appmod.app.test_client()
    r = c.get("/dashboards/google-ads?account=Acme%20Co", base_url=OLD)
    assert r.status_code == 301
    assert r.headers["Location"] == appmod.SITE_URL + "/dashboards/google-ads?account=Acme%20Co"
    assert c.get("/", base_url=OLD).headers["Location"] == appmod.SITE_URL + "/"


def test_api_calls_webhooks_and_the_health_check_answer_at_the_old_address():
    c = appmod.app.test_client()
    assert c.get("/health", base_url=OLD).status_code == 200
    for path in ("/api/dashboards/google-ads/slack-digest", "/api/page-watch/watchdog", "/api/slack/interactions"):
        assert c.post(path, base_url=OLD).status_code != 301, path
    assert c.get("/static/css/google-ads-dashboard.css", base_url=OLD).status_code == 200


def test_the_custom_domain_and_other_hosts_are_served_as_they_are():
    c = appmod.app.test_client()
    assert c.get("/health", base_url=appmod.SITE_URL).status_code == 200
    assert c.get("/login", base_url=appmod.SITE_URL).status_code == 200
    assert c.get("/login", base_url="http://localhost:5000").status_code == 200


def test_links_behind_railways_proxy_are_https():
    from werkzeug.middleware.proxy_fix import ProxyFix
    from werkzeug.test import EnvironBuilder
    fix = appmod.app.wsgi_app
    assert isinstance(fix, ProxyFix) and fix.x_proto == 1 and fix.x_for == 0, "trust the scheme only"
    seen = {}

    def inner(environ, start_response):
        seen["scheme"] = environ["wsgi.url_scheme"]
        start_response("200 OK", [])
        return [b""]
    env = EnvironBuilder(path="/", base_url="http://northaxis.outcomes.digital",
                         headers={"X-Forwarded-Proto": "https"}).get_environ()
    ProxyFix(inner, x_proto=fix.x_proto)(env, lambda *a: None)
    assert seen["scheme"] == "https"


def test_digest_links_called_at_the_old_address_use_the_custom_domain(monkeypatch):
    monkeypatch.delenv("PUBLIC_BASE_URL", raising=False)
    with appmod.app.test_request_context("/api/dashboards/google-ads/slack-digest", base_url=OLD):
        assert appmod._gads_digest_base_url() == appmod.SITE_URL
