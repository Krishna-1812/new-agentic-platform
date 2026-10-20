"""ANTHROPIC_WORKSPACE_ID reaches every Claude request as the anthropic-workspace-id header."""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from tracker import buyer_radar_judge as judge
from tracker import claude_workspace as cw

REFUSAL = ("Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', 'message': "
           "'This API key is not scoped to a workspace, so this request must include the "
           "anthropic-workspace-id header with the ID of the workspace to use.'}}")


def test_apply_adds_the_header():
    env = {"ANTHROPIC_WORKSPACE_ID": " wrkspc_01AbC "}
    assert cw.apply(env) == "wrkspc_01AbC"
    assert env["ANTHROPIC_CUSTOM_HEADERS"] == "anthropic-workspace-id: wrkspc_01AbC"


def test_apply_keeps_other_headers_and_replaces_an_old_workspace():
    env = {"ANTHROPIC_WORKSPACE_ID": "wrkspc_new",
           "ANTHROPIC_CUSTOM_HEADERS": "x-trace: 1\nAnthropic-Workspace-Id: wrkspc_old"}
    cw.apply(env)
    assert env["ANTHROPIC_CUSTOM_HEADERS"] == "x-trace: 1\nanthropic-workspace-id: wrkspc_new"
    cw.apply(env)  # twice changes nothing
    assert env["ANTHROPIC_CUSTOM_HEADERS"] == "x-trace: 1\nanthropic-workspace-id: wrkspc_new"


@pytest.mark.parametrize("value", ["", "   ", "my workspace", "wrkspc_bad id", "https://console.anthropic.com"])
def test_apply_ignores_missing_or_malformed_ids(value):
    env = {"ANTHROPIC_WORKSPACE_ID": value}
    assert cw.apply(env) == ""
    assert "ANTHROPIC_CUSTOM_HEADERS" not in env


def test_explain_only_for_the_unscoped_key_refusal():
    assert "ANTHROPIC_WORKSPACE_ID" in cw.explain(REFUSAL)
    assert cw.explain("Error code: 401 invalid x-api-key") == ""
    assert cw.explain(None) == ""


def test_buyer_radar_shows_the_fix_not_the_raw_error():
    class Err(Exception):
        status_code, message = 400, REFUSAL
    msg = judge.why(Err())
    assert msg == cw.STEPS
    assert "console.anthropic.com" in msg and "Railway" in msg


def test_importing_tracker_applies_it():
    src = open("tracker/__init__.py").read()
    assert "claude_workspace" in src and ".apply()" in src


def test_a_real_client_sends_the_header(monkeypatch):
    seen = {}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            seen["workspace"] = self.headers.get("anthropic-workspace-id")
            self.rfile.read(int(self.headers.get("content-length") or 0))
            body = json.dumps({"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-haiku-5-5",
                               "content": [{"type": "text", "text": "{}"}], "stop_reason": "end_turn",
                               "stop_sequence": None, "usage": {"input_tokens": 1, "output_tokens": 1}}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        monkeypatch.setenv("ANTHROPIC_WORKSPACE_ID", "wrkspc_test1")
        monkeypatch.setenv("ANTHROPIC_CUSTOM_HEADERS", "")  # so the header is removed again after the test
        cw.apply()
        from anthropic import Anthropic
        client = Anthropic(api_key="test", base_url="http://127.0.0.1:%d" % server.server_port, max_retries=0)
        client.messages.create(model="claude-haiku-5-5", max_tokens=10, messages=[{"role": "user", "content": "hi"}])
        assert seen.pop("workspace") == "wrkspc_test1"
        # The call Buyer Radar and Market Radar make: the beta endpoint with server-side fallbacks.
        from tracker import market_radar_llm
        market_radar_llm._request(client, "claude-haiku-5-5", 10, "s", "u", {"type": "object"}, True)
        assert seen["workspace"] == "wrkspc_test1"
    finally:
        server.shutdown()
