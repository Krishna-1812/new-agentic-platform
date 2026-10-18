"""What the Paid Marketing agents' model calls cost (tracker/paid_spend.py): every call made inside
`charging` is priced at the model that served it and written to pm_spend with who and which workspace, a
call outside it is not, and a reply that comes back unusable was still billed. The admin panel's read of
pm_spend is tests/test_admin_spend.py."""
import os
import sys
from decimal import Decimal
from types import SimpleNamespace

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import market_radar_llm as llm  # noqa: E402
from tracker import paid_spend  # noqa: E402

USAGE = {"input_tokens": 1000, "output_tokens": 500}


class FakeClient:
    """The Anthropic client's two create calls, answering with `text` and a stop reason."""

    def __init__(self, text='{"ok": true}', stop="end_turn", model="claude-sonnet-5-5"):
        reply = lambda **kw: SimpleNamespace(content=[SimpleNamespace(type="text", text=text)], stop_reason=stop,
                                             model=model, usage=SimpleNamespace(model_dump=lambda: dict(USAGE)))
        self.messages = SimpleNamespace(create=reply)
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=lambda betas, fallbacks, **kw: reply(**kw)))


@pytest.fixture
def booked(monkeypatch):
    rows = []
    monkeypatch.setattr(paid_spend, "record", lambda *a: rows.append(a))
    return rows


def ask(client):
    return llm.call_json("s", "u", {"type": "object"}, model="claude-sonnet-5-5", max_tokens=100, stage="segments",
                         client=client)


def test_a_call_inside_charging_is_booked_to_the_agent_the_person_and_the_workspace(booked):
    with paid_spend.charging("segment-analysis", "Ana@x.com", "acct:7"):
        assert ask(FakeClient())[0] == {"ok": True}
    assert len(booked) == 1
    agent, email, space, stage, model, usd = booked[0]
    assert (agent, email, space, stage, model) == ("segment-analysis", "Ana@x.com", "acct:7", "segments", "claude-sonnet-5-5")
    assert usd == Decimal("2") * 1000 / 1_000_000 + Decimal("10") * 500 / 1_000_000


def test_a_call_outside_charging_books_nothing(booked):
    ask(FakeClient())
    assert booked == []


def test_a_reply_cut_off_at_the_token_limit_was_still_billed(booked):
    with paid_spend.charging("segment-analysis", "ana@x.com"):
        with pytest.raises(llm.ModelError):
            ask(FakeClient(stop="max_tokens"))
    assert len(booked) == 1 and booked[0][2] == "", "General work has no workspace"


def test_a_model_with_no_price_is_logged_not_guessed_and_the_answer_still_comes(booked):
    with paid_spend.charging("segment-analysis", "ana@x.com"):
        assert ask(FakeClient(model="some-new-model"))[0] == {"ok": True}
    assert booked == []


def test_a_ledger_outage_never_fails_the_call(monkeypatch):
    def down(*a):
        raise RuntimeError("database down")
    monkeypatch.setattr(paid_spend, "record", down)
    with paid_spend.charging("segment-analysis", "ana@x.com"):
        assert ask(FakeClient())[0] == {"ok": True}


def test_the_observer_is_registered_once():
    assert llm.OBSERVERS.count(paid_spend.observe) == 1
