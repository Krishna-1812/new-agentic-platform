"""Local Business Radar: the one call to Claude. What is sent (room for
thinking, low effort where the model takes it) and how a reply is read."""

import os
import sys
from types import SimpleNamespace as NS

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import lbr_claude, lbr_http  # noqa: E402


class FakeClient:
    def __init__(self, replies):
        self.replies = list(replies)
        self.sent = []
        self.messages = self

    def create(self, **kw):
        self.sent.append(kw)
        return self.replies.pop(0)


def _reply(text, stop="end_turn", thinking=True):
    blocks = [NS(type="thinking", thinking="", signature="x")] if thinking else []
    blocks.append(NS(type="text", text=text))
    return NS(content=blocks, stop_reason=stop, usage=NS(input_tokens=100, output_tokens=50,
                                                         cache_read_input_tokens=0,
                                                         cache_creation_input_tokens=0))


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    monkeypatch.delenv("ANTHROPIC_MODEL", raising=False)

    def use(replies):
        c = FakeClient(replies)
        monkeypatch.setattr(lbr_claude, "_client", lambda: c)
        return c
    return use


def test_sonnet_5_gets_room_to_think_and_low_effort(client):
    c = client([_reply('{"a": 1}')])
    assert lbr_claude.ask_json("sys", "user", lbr_http.Ledger(), max_tokens=400) == {"a": 1}
    sent = c.sent[0]
    assert sent["model"] == "claude-sonnet-5"
    assert sent["max_tokens"] >= 8000, "thinking tokens come out of max_tokens"
    assert sent["output_config"] == {"effort": "low"}
    assert "thinking" not in sent


def test_an_older_model_is_not_sent_effort(monkeypatch):
    assert "output_config" not in lbr_claude.request_options("claude-sonnet-4-5", 400)
    assert lbr_claude.request_options("claude-opus-5", 3000)["max_tokens"] == 12000


def test_only_text_blocks_are_read(client):
    c = client([NS(content=[NS(type="thinking", thinking='{"wrong": true}'), NS(type="text", text='{"ok": 1}')],
                   stop_reason="end_turn", usage=None)])
    assert lbr_claude.ask_json("s", "u", lbr_http.Ledger()) == {"ok": 1}
    assert len(c.sent) == 1


def test_a_cut_off_reply_is_retried_with_more_room(client):
    c = client([_reply('{"a": ', stop="max_tokens"), _reply('{"a": 2}')])
    assert lbr_claude.ask_json("s", "u", lbr_http.Ledger(), max_tokens=400) == {"a": 2}
    assert c.sent[1]["max_tokens"] == 2 * c.sent[0]["max_tokens"]


def test_a_refusal_is_an_error_and_not_retried(client):
    c = client([_reply("", stop="refusal", thinking=False)])
    with pytest.raises(lbr_claude.ClaudeError) as e:
        lbr_claude.ask_json("s", "u", lbr_http.Ledger())
    assert e.value.kind == "refusal" and len(c.sent) == 1


def test_every_call_is_priced(client):
    client([_reply('{"a": 1}')])
    ledger = lbr_http.Ledger()
    lbr_claude.ask_json("s", "u", ledger)
    assert ledger.totals()["by_provider"]["claude"]["usd"] == pytest.approx((100 * 2 + 50 * 10) / 1e6)
