"""Warmly: the REST client the partner outreach reads, and the website script on the partner pages.

The client only makes free calls (visitors, accounts, the balance, and signals as a preview), every call
that reaches Warmly answers 202 whether or not the tool worked, and the script runs only on the pages
WARMLY_PIXEL_PATHS names (the partner pages by default), never for a browser that asks not to be tracked,
and the privacy policy says so whenever it is on.
"""

import os
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import app as appmod  # noqa: E402
from tracker import warmly_client as wm  # noqa: E402

SCRIPT = "https://opps-widget.getwarmly.com/warmly.js?clientId="


@pytest.fixture(autouse=True)
def _no_warmly(monkeypatch):
    for name in ("WARMLY_API_KEY", "WARMLY_ORG_ID", "WARMLY_CLIENT_ID", "WARMLY_PIXEL_PATHS"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def client():
    return appmod.app.test_client()


class _Resp:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


class _Session:
    """Answers each request with the next queued (status, body) and keeps what was asked."""

    def __init__(self, *answers):
        self.answers, self.calls = list(answers), []

    def request(self, method, url, **kw):
        self.calls.append((method, url, kw))
        return _Resp(*self.answers.pop(0))


def _client(*answers):
    s = _Session(*answers)
    return wm.Client("key", "org-1", session=s, sleep=lambda _s: None), s


# == the connection ====================================================================================

def test_warmly_needs_both_the_key_and_the_organisation(monkeypatch):
    assert not wm.configured() and wm.missing() == ["WARMLY_API_KEY", "WARMLY_ORG_ID"]
    monkeypatch.setenv("WARMLY_API_KEY", "k")
    assert not wm.configured() and wm.missing() == ["WARMLY_ORG_ID"]
    monkeypatch.setenv("WARMLY_ORG_ID", "org")
    assert wm.configured() and wm.missing() == []
    with pytest.raises(wm.AuthError, match="WARMLY_API_KEY and WARMLY_ORG_ID"):
        wm.Client("", "", session=_Session()).credits()


def test_a_call_sends_the_key_the_organisation_and_the_tool():
    c, s = _client((202, {"id": "e1", "status": "succeeded", "output": {"success": True, "data": {"remaining": 4980}}}))
    assert c.credits() == {"remaining": 4980}
    method, url, kw = s.calls[0]
    assert (method, url) == ("POST", wm.BASE_URL + "/agent-tools/execute")
    assert kw["headers"]["Authorization"] == "Bearer key"
    assert kw["json"] == {"toolName": "get_credits_remaining", "organizationId": "org-1", "input": {}}


def test_a_202_whose_tool_failed_is_a_failure_with_warmlys_words():
    c, _s = _client((202, {"status": "failed", "userFacingError": "Unknown signal category."}))
    with pytest.raises(wm.WarmlyError, match="Unknown signal category."):
        c.signals(signal_category="nope")
    c, _s = _client((202, {"status": "succeeded", "output": {"success": False, "userFacingError": "Bad window."}}))
    with pytest.raises(wm.WarmlyError, match="Bad window."):
        c.visitors()


def test_an_async_tool_is_read_again_until_it_finishes():
    c, s = _client((202, {"id": "e9", "status": "pending"}), (200, {"id": "e9", "status": "running"}),
                   (200, {"id": "e9", "status": "succeeded", "output": [{"domain": "acme.com"}]}))
    assert c.accounts() == [{"domain": "acme.com"}]
    assert [u for _m, u, _k in s.calls[1:]] == [wm.BASE_URL + "/agent-tools/executions/e9"] * 2


def test_a_refused_key_and_a_rate_limit_say_what_to_do():
    c, _s = _client((401, {"error": "unauthorized"}))
    with pytest.raises(wm.AuthError):
        c.credits()
    c, s = _client((429, {}), (429, {}))
    with pytest.raises(wm.RateLimited, match="minute"):
        c.credits()
    assert len(s.calls) == 1 + wm.RETRIES


def test_the_tools_list_is_read_for_our_organisation():
    c, s = _client((200, [{"name": "list_warm_visitors", "isAsync": False}, {"description": "no name"}]))
    assert [t["name"] for t in c.tools()] == ["list_warm_visitors"]
    assert s.calls[0][2]["params"] == {"organizationId": "org-1"}


def test_nothing_this_client_asks_for_spends_a_credit():
    c, s = _client(*[(202, {"status": "succeeded", "output": []})] * 3)
    c.signals(signal_category="hiring", take=500)
    c.signals(company_domain="acme.com")
    c.visitors(time_window="past_week", take=9999, countries=["GB"], search="")
    sent = [kw["json"]["input"] for _m, _u, kw in s.calls]
    assert sent[0]["preview"] is True and sent[0]["mode"] == "by_signal" and sent[0]["take"] == 100
    assert sent[1]["preview"] is True and sent[1]["mode"] == "by_company" and sent[1]["companyDomain"] == "acme.com"
    assert sent[2] == {"timeWindow": "past_week", "take": 500, "offset": 0, "countries": ["GB"]}
    with pytest.raises(ValueError):
        c.visitors(time_window="past_year")


def test_the_status_says_what_is_missing_before_it_calls_anyone():
    report = wm.status()
    assert report["configured"] is False and report["missing"] == ["WARMLY_API_KEY", "WARMLY_ORG_ID"]
    assert report["pixel"] == {"client_id_set": False, "paths": ["/partners"]}


def test_the_status_page_is_for_admins_only(client):
    r = client.get("/admin/warmly/status")
    assert r.status_code in (301, 302)


# == the website script ================================================================================

def test_the_script_id_is_an_id_or_nothing(monkeypatch):
    monkeypatch.setenv("WARMLY_CLIENT_ID", "abc123XYZ")
    assert wm.pixel_id() == "abc123XYZ"
    monkeypatch.setenv("WARMLY_CLIENT_ID", '<script id="warmly-script-loader" src="%sab12-cd34" defer></script>' % SCRIPT)
    assert wm.pixel_id() == "ab12-cd34"
    monkeypatch.setenv("WARMLY_CLIENT_ID", '"><script>alert(1)</script>')
    assert wm.pixel_id() == ""


def test_the_script_runs_on_the_partner_pages_only_by_default(client, monkeypatch):
    for path in ("/partners", "/partners/agencies", "/partners/consultants", "/"):
        assert SCRIPT not in client.get(path).get_data(as_text=True), path
    monkeypatch.setenv("WARMLY_CLIENT_ID", "abc123")
    for path in ("/partners", "/partners/agencies", "/partners/consultants"):
        html = client.get(path).get_data(as_text=True)
        assert SCRIPT + "abc123" in html, path
        assert 'n.doNotTrack==="1"' in html and "n.globalPrivacyControl===true" in html
    for path in ("/", "/pricing", "/partnership", "/book"):
        r = client.get(path)
        assert SCRIPT not in r.get_data(as_text=True), path
    assert not wm.pixel_on("/partnersX")


def test_the_pages_the_script_runs_on_can_be_widened(client, monkeypatch):
    monkeypatch.setenv("WARMLY_CLIENT_ID", "abc123")
    monkeypatch.setenv("WARMLY_PIXEL_PATHS", "/partners, pricing")
    assert wm.pixel_paths() == ["/partners", "/pricing"]
    assert SCRIPT in client.get("/pricing").get_data(as_text=True)
    assert SCRIPT not in client.get("/").get_data(as_text=True)
    monkeypatch.setenv("WARMLY_PIXEL_PATHS", "/")
    assert SCRIPT in client.get("/").get_data(as_text=True)


def test_the_privacy_policy_names_warmly_whenever_the_script_is_on(client, monkeypatch):
    off = client.get("/privacy").get_data(as_text=True)
    assert "with no third-party tracking scripts" in off and "Warmly" not in off
    monkeypatch.setenv("WARMLY_CLIENT_ID", "abc123")
    on = client.get("/privacy").get_data(as_text=True)
    assert "no third-party tracking scripts" not in on
    assert "a script from Warmly" in on and "<code>/partners</code>" in on
    assert "Do Not Track or Global Privacy Control" in on and "including Warmly" in on
    assert SCRIPT not in on
