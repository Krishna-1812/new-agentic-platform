"""Local Business Radar: the connection check. Free calls only, a clear row
per service, and never a key on the page."""

import os
import sys
import types

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import apify_transport, lbr_geo, lbr_selftest, lbr_store  # noqa: E402

TOKEN, KEY = "apify_api_SECRET123", "sk-ant-SECRET456"


@pytest.fixture
def healthy(monkeypatch):
    for v in ("GOOGLE_MAPS_API_KEY", "SERPAPI_KEY", "PAGESPEED_API_KEY", "HUNTER_API_KEY", "LBR_SOURCE",
              "DATABASE_URL", "ANTHROPIC_MODEL"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("APIFY_API_TOKEN", TOKEN)
    monkeypatch.setenv("ANTHROPIC_API_KEY", KEY)
    lbr_store.reset_memory()
    monkeypatch.setattr(apify_transport, "probe_token", lambda t: ({"username": "markify", "plan": {"id": "FREE"}}, None))
    monkeypatch.setattr(apify_transport, "account_limits",
                        lambda t: ({"current": {"monthlyUsageUsd": 1.25}, "limits": {"maxMonthlyUsageUsd": 5}}, None))
    monkeypatch.setattr(apify_transport, "check_actor", lambda a, t: ({"title": "Google Maps Scraper"}, None))
    monkeypatch.setattr(lbr_geo, "resolve", lambda text, ledger: {"name": "Austin", "kind": "city"})

    class FakeAnthropic:
        def __init__(self, **kw):
            self.models = types.SimpleNamespace(retrieve=lambda m: types.SimpleNamespace(id=m, display_name="Claude Sonnet 5"))
    import anthropic
    monkeypatch.setattr(anthropic, "Anthropic", FakeAnthropic)
    return monkeypatch


def _rows(result):
    return {r["name"]: r for r in result["checks"]}


def test_a_healthy_setup_passes_but_flags_a_missing_database(healthy):
    res = lbr_selftest.run()
    rows = _rows(res)
    assert res["source"] == "apify"
    assert rows["Apify token"]["ok"] and "markify" in rows["Apify token"]["detail"]
    assert rows["Apify credit this month"]["detail"] == "$1.25 used of $5.00; $3.75 left."
    assert rows["Google Maps Scraper"]["ok"] and rows["Claude"]["ok"] and "Claude Sonnet 5" in rows["Claude"]["detail"]
    assert rows["OpenStreetMap (area lookup)"]["ok"]
    assert rows["Database"]["ok"] is False, "without DATABASE_URL runs are lost on every deploy"
    assert rows["SerpAPI"]["ok"] is None and not res["ok"]


def test_a_refused_apify_token_is_shown_plainly(healthy):
    healthy.setattr(apify_transport, "probe_token", lambda t: (None, "Apify rejected this token (401 Unauthorized)."))
    rows = _rows(lbr_selftest.run())
    assert rows["Apify token"]["ok"] is False and "401" in rows["Apify token"]["detail"]


def test_the_page_never_shows_a_key(healthy):
    import app as appmod
    c = appmod.app.test_client()
    with c.session_transaction() as s:
        s["google_user"] = {"email": "p@markifydigital.com", "name": "P"}
    body = c.get("/strategic-agents/local-business-radar/selftest").get_data(as_text=True)
    assert "Connection check" in body and "Google Maps Scraper" in body
    assert TOKEN not in body and KEY not in body
    js = c.get("/strategic-agents/local-business-radar/selftest?format=json").get_json()
    assert js["source"] == "apify" and TOKEN not in str(js) and KEY not in str(js)
    page = c.get("/strategic-agents/local-business-radar").get_data(as_text=True)
    assert 'href="/strategic-agents/local-business-radar/selftest"' in page
