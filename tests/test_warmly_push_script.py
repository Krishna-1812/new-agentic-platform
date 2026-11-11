"""scripts/warmly_push.py: what the daily Warmly routine runs to send its rows to Lead Finder."""

import importlib.util
import json
import os
from datetime import datetime, timezone

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("warmly_push", os.path.join(ROOT, "scripts", "warmly_push.py"))
push = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(push)

NOW = datetime(2026, 11, 11, 1, 17, tzinfo=timezone.utc)
FRESH = {"key": "a@agency.co", "email": "a@agency.co", "lastSeen": "2026-11-10T09:00:00.000Z"}
OLD = {"key": "b@brand.com", "email": "b@brand.com", "lastSeen": "2026-11-01T09:00:00.000Z"}
AGENCY_HIRING = {"signal_type": "hiring-trends", "signal_subtype": "hiringMarketingRoles",
                 "company": {"name": "Hill & Co", "industries": ["Marketing and Advertising"]}}
BRAND_HIRING = {"signal_type": "hiring-trends", "signal_subtype": "hiringMarketingRoles",
                "company": {"name": "Kora Beauty", "industries": ["Cosmetics"]}}
JOB_CHANGE = {"signal_type": "workmilestone", "signal_subtype": "jobChange", "company": {"name": "X"}}


class Answer:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class Http:
    def __init__(self, status=200, body=None):
        self.calls, self.status, self.body = [], status, body if body is not None else {"ok": True}

    def request(self, method, url, json=None, headers=None, timeout=None):
        self.calls.append({"method": method, "url": url, "json": json, "headers": headers, "timeout": timeout})
        return Answer(self.status, self.body)


def test_rows_come_from_a_list_or_from_a_warmly_tools_whole_answer():
    assert push.rows_of([FRESH, "x", 3]) == [FRESH]
    assert push.rows_of({"total": 1, "results": [FRESH], "defaultView": {}}) == [FRESH]
    assert push.rows_of({"results": "nope"}) == [] and push.rows_of(None) == []


def test_old_visits_and_brands_hiring_are_left_out_before_sending():
    since = NOW.replace(day=9)
    bs, left = push.batches({"visitors": {"results": [FRESH, OLD]}, "accounts": [], "signals": [AGENCY_HIRING, BRAND_HIRING, JOB_CHANGE]}, since)
    assert bs == [{"kind": "visitors", "rows": [FRESH]}, {"kind": "signals", "rows": [AGENCY_HIRING, JOB_CHANGE]}]
    assert left == {"visitors": 1, "accounts": 0, "signals": 1}
    assert push.recent({"key": "no date"}, since), "a row with no date is the site's to judge"


def test_push_sends_the_rows_and_the_credits_and_no_token_of_its_own(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("WARMLY_PUSH_TOKEN", raising=False)
    f = tmp_path / "found.json"
    f.write_text(json.dumps({"visitors": [FRESH, OLD], "signals": {"results": [JOB_CHANGE]}}))
    http = Http(body={"ok": True, "kept": 2})
    assert push.main(["push", str(f), "--credits", "6"], http=http, now=NOW) == 0
    call = http.calls[0]
    assert call["method"] == "POST" and call["url"] == push.SITE + "/api/lead-finder/warmly-push"
    assert call["json"] == {"batches": [{"kind": "visitors", "rows": [FRESH]}, {"kind": "signals", "rows": [JOB_CHANGE]}],
                            "credits": 6.0}
    assert push.HEADER not in call["headers"], "the proxy adds the token, not the script"
    out = json.loads(capsys.readouterr().out)
    assert out["kept"] == 2 and out["left_out_before_sending"] == {"visitors": 1, "accounts": 0, "signals": 0}


def test_a_token_in_the_environment_is_sent_in_the_header_never_the_address(tmp_path, monkeypatch):
    monkeypatch.setenv("WARMLY_PUSH_TOKEN", "T" * 32)
    http = Http(body={"ok": True, "budget": 1000, "used": 0, "today": 34})
    assert push.main(["budget"], http=http) == 0
    assert http.calls[0]["method"] == "GET" and http.calls[0]["headers"][push.HEADER] == "T" * 32
    assert "T" * 32 not in http.calls[0]["url"]


def test_an_unknown_token_says_which_network_secret_is_missing(monkeypatch, capsys):
    monkeypatch.delenv("WARMLY_PUSH_TOKEN", raising=False)
    http = Http(status=404, body={"ok": False, "error": "Unknown token."})
    assert push.main(["budget"], http=http) == 1
    out = json.loads(capsys.readouterr().out)
    assert "X-Warmly-Push-Token" in out["hint"] and "Lead Finder > Settings" in out["hint"]


def test_an_answer_without_json_is_a_failure_in_words(monkeypatch, capsys):
    monkeypatch.delenv("WARMLY_PUSH_TOKEN", raising=False)
    assert push.main(["budget"], http=Http(status=502, body=ValueError("html"))) == 1
    assert "without JSON" in json.loads(capsys.readouterr().out)["error"]


def test_a_file_that_is_not_rows_by_kind_is_refused(tmp_path):
    f = tmp_path / "found.json"
    f.write_text(json.dumps([FRESH]))
    assert push.main(["push", str(f)], http=Http(), now=NOW) == 2


def test_the_push_body_is_what_the_site_reads(monkeypatch):
    """The script and the endpoint agree: what the script sends, the site keeps."""
    os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
    os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
    os.environ.setdefault("FLASK_SECRET_KEY", "test")
    import sys
    sys.path.insert(0, ROOT)
    import app as appmod
    from tests.test_warmly_engine import ACCOUNT, JOB_CHANGE as SIGNAL, VISITOR
    from tracker import buyer_radar_store as store
    kept = []
    monkeypatch.setattr(store, "owner_of_warmly_token", lambda t: "acct:7" if t == "T" * 32 else None)
    monkeypatch.setattr(store, "warmly_credits_month", lambda owner: 0.0)
    monkeypatch.setattr(store, "warmly_add", lambda owner, signal, payload: kept.append(signal["key"]) or True)
    monkeypatch.setattr(store, "add_spend", lambda *a, **k: None)
    monkeypatch.setenv("WARMLY_PUSH_TOKEN", "T" * 32)
    client = appmod.app.test_client()

    class Flask:
        def request(self, method, url, json=None, headers=None, timeout=None):
            r = client.open(url.replace(push.SITE, ""), method=method, json=json, headers=headers)
            return Answer(r.status_code, r.get_json())
    bs, _ = push.batches({"visitors": [VISITOR], "accounts": [ACCOUNT], "signals": [SIGNAL]}, NOW.replace(day=9))
    status, data = push._call("POST", {"batches": bs, "credits": 2}, http=Flask())
    assert status == 200 and data["kept"] == 3 and len(kept) == 3


def test_without_requests_the_standard_library_makes_the_same_call(monkeypatch):
    import io
    import urllib.request
    seen = {}

    class Resp(io.BytesIO):
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def urlopen(req, timeout=None, context=None):
        seen.update(method=req.get_method(), url=req.full_url, body=req.data, ctype=req.get_header("Content-type"))
        return Resp(b'{"ok": true, "kept": 1}')
    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    r = push._Urllib().request("POST", "https://x.test/api", json={"batches": []}, headers={"Accept": "application/json"}, timeout=5)
    assert r.status_code == 200 and r.json() == {"ok": True, "kept": 1}
    assert seen["method"] == "POST" and json.loads(seen["body"]) == {"batches": []} and seen["ctype"] == "application/json"
