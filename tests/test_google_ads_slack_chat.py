"""Ads Insight answering questions in Slack (tracker/gads_slack_chat.py and /api/slack/events in app.py).

Slack and Claude are replaced by recording stand-ins, so these check which messages get an answer,
what Claude is given, what is posted back, and who may call the endpoint; never a real call."""
import hashlib
import hmac
import json
import time

import pytest

from tests import test_google_ads_ai as A
from tests import test_google_ads_slack_digest as D
from tracker import gads_ai_store as store
from tracker import gads_digest
from tracker import gads_slack_chat as c
from tracker import google_ads_insights as g

appmod = A.appmod
CHANNEL, BOT = "C123", "UBOT"
SECRET = "signing-secret"


class FakeSlack:
    """Answers Slack Web API calls and keeps them: (method, body)."""

    def __init__(self, history=()):
        self.calls = []
        self.history = list(history)
        self.n = 0

    def post(self, url, headers=None, json=None, timeout=None):
        method = url.rsplit("/", 1)[1]
        self.calls.append((method, json))
        self.n += 1
        return _Resp({"ok": True, "ts": "1700000100.%06d" % self.n})

    def get(self, url, headers=None, params=None, timeout=None):
        self.calls.append((url.rsplit("/", 1)[1], params))
        return _Resp({"ok": True, "messages": self.history})

    def sent(self, method):
        return [b for m, b in self.calls if m == method]


class _Resp:
    def __init__(self, body):
        self.status_code, self._body, self.headers = 200, body, {}

    def json(self):
        return self._body


ROWS = D._week(last=[("Generic - Search", 1600.0, 3.0)]) + D._week("Beta Ltd", last=[("Brand", 900.0, 4.0)])


# ── Signatures ───────────────────────────────────────────────────────────────
def _sign(body, ts=None, secret=SECRET):
    ts = str(int(ts if ts is not None else time.time()))
    mac = hmac.new(secret.encode(), ("v0:%s:" % ts).encode() + body, hashlib.sha256).hexdigest()
    return ts, "v0=" + mac


def test_only_requests_signed_by_slack_in_the_last_five_minutes_pass():
    body = b'{"type":"event_callback"}'
    ts, sig = _sign(body)
    assert c.verify(SECRET, ts, body, sig)
    assert not c.verify(SECRET, ts, body + b" ", sig), "a changed body fails"
    assert not c.verify("other", ts, body, sig)
    old_ts, old_sig = _sign(body, time.time() - 400)
    assert not c.verify(SECRET, old_ts, body, old_sig), "a replayed request fails"
    assert not c.verify("", ts, body, sig) and not c.verify(SECRET, "x", body, sig)


# ── Which messages are questions ─────────────────────────────────────────────
def _q(event, known=()):
    return c.question(dict({"channel": CHANNEL, "user": "UPERSON", "ts": "200.1"}, **event), CHANNEL, BOT,
                      lambda ts: ts in known)


def test_a_mention_starts_or_joins_a_thread():
    assert _q({"type": "app_mention", "text": "<@UBOT> how is Acme doing?"}) == ("200.1", "how is Acme doing?")
    assert _q({"type": "app_mention", "text": "<@UBOT> and Beta?", "thread_ts": "100.0"})[0] == "100.0"


def test_a_reply_under_a_digest_or_an_answer_is_a_question():
    assert _q({"type": "message", "text": "why did CPA rise?", "thread_ts": "100.0"}, known={"100.0"}) == \
        ("100.0", "why did CPA rise?")


@pytest.mark.parametrize("event,why", [
    ({"type": "message", "text": "hello", "thread_ts": "555.0"}, "a thread Ads Insight is not part of"),
    ({"type": "message", "text": "top-level chat"}, "not a reply"),
    ({"type": "message", "text": "<@UANA> can you check?", "thread_ts": "100.0"}, "addressed to someone else"),
    ({"type": "message", "text": "<@UBOT> why?", "thread_ts": "100.0"}, "the mention event answers it"),
    ({"type": "message", "text": "edited", "thread_ts": "100.0", "subtype": "message_changed"}, "an edit"),
    ({"type": "message", "text": "x", "thread_ts": "100.0", "bot_id": "B1"}, "a bot"),
    ({"type": "app_mention", "text": "<@UBOT>"}, "nothing asked"),
    ({"type": "app_mention", "text": "<@UBOT> hi", "channel": "COTHER"}, "another channel"),
    ({"type": "app_mention", "text": "<@UBOT> hi", "channel": "D999"}, "a direct message"),
])
def test_everything_else_is_left_alone(event, why):
    with pytest.raises(c.Skip):
        _q(event, known={"100.0"})


def test_a_question_names_its_account_by_the_longest_name_it_contains():
    assert c.account_named("how is beta ltd doing", ["Beta", "Beta Ltd", "Acme"]) == "Beta Ltd"
    assert c.account_named("all good?", ["Acme"]) == ""


# ── What Claude is given, and what is posted ─────────────────────────────────
def test_an_answer_replaces_the_placeholder_and_reads_the_thread_and_the_account(monkeypatch):
    slack = FakeSlack(history=[{"ts": "100.0", "bot_id": "B1", "text": "Google Ads Acme: spend up"},
                               {"ts": "150.0", "user": "UPERSON", "text": "is that normal?"},
                               {"ts": "160.0", "bot_id": "B1", "text": c.THINKING},
                               {"ts": "200.1", "user": "UPERSON", "text": "why did CPA rise?"}])
    claude = A.FakeClaude("**CPA rose** because Generic - Search spent ₹1,600 for 3 conversions.")
    remembered = {}
    res = c.answer({"ts": "200.1"}, token="xoxb", channel=CHANNEL, bot=BOT, accounts=["Acme", "Beta Ltd"],
                   rows=ROWS, thread="100.0", text="why did CPA rise?", thread_account="Acme",
                   load_pack=lambda a: {"campaigns": [{"campaign": "Generic - Search"}]},
                   context=lambda a: {"text": "Target CPA 300."}, latest_review=lambda a: None,
                   remember=remembered.__setitem__, client=claude, session=slack, base_url="https://app.example")
    assert res["ok"] and res["account"] == "Acme" and remembered == {"100.0": "Acme"}
    placeholder = slack.sent("chat.postMessage")[0]
    assert placeholder == {"channel": CHANNEL, "thread_ts": "100.0", "text": c.THINKING, "blocks": c.thinking_blocks()}
    final = slack.sent("chat.update")[0]
    assert final["ts"] == "1700000100.000001", "the placeholder is replaced, not followed"
    assert final["text"].startswith("*CPA rose* because"), "Slack bold, not Markdown"
    blob = json.dumps(final["blocks"], ensure_ascii=False)
    assert final["blocks"][0]["elements"][0]["text"] == "*Acme*"
    assert final["blocks"][1]["text"]["text"].startswith("*CPA rose* because")
    assert "Google Ads data up to Sat 26 Sep 2026" in blob
    assert '"url": "https://app.example/dashboards/google-ads?account=Acme"' in blob
    call = claude.calls[0]
    assert call["model"] == "claude-opus-5-5" and call["output_config"] == {"effort": "medium"}
    assert call["fallbacks"] == "default" and call["thinking"] == {"type": "adaptive"}
    data = call["system"][1]
    assert data["cache_control"] == {"type": "ephemeral"}
    assert '"last_30_days_vs_previous_30"' in data["text"] and '"campaign_report_by_day"' in data["text"]
    assert "<brief>\nTarget CPA 300.\n</brief>" in data["text"] and "Beta Ltd" not in data["text"]
    asked = call["messages"][0]["content"]
    assert "Ads Insight: Google Ads Acme: spend up\nperson: is that normal?" in asked
    assert c.THINKING not in asked and asked.endswith("Question: why did CPA rise?")
    assert "why did CPA rise?\n" not in asked.split("</thread>")[0], "the question itself is not repeated"


def test_a_question_naming_no_account_compares_them_all():
    slack, claude = FakeSlack(), A.FakeClaude("Acme spent most.")
    res = c.answer({"ts": "200.1"}, token="x", channel=CHANNEL, bot=BOT, accounts=["Acme", "Beta Ltd"], rows=ROWS,
                   thread="200.1", text="which account spent most?", thread_account="", client=claude, session=slack)
    assert res["ok"] and res["account"] == ""
    text = claude.calls[0]["system"][1]["text"]
    assert '"account": "Acme"' in text and '"account": "Beta Ltd"' in text


def test_a_failure_is_told_in_the_thread_not_left_hanging():
    slack = FakeSlack()
    claude = A.FakeClaude(RuntimeError("boom"))
    res = c.answer({"ts": "200.1"}, token="x", channel=CHANNEL, bot=BOT, accounts=["Acme"], rows=ROWS,
                   thread="200.1", text="how is Acme?", thread_account="", client=claude, session=slack)
    assert not res["ok"] and slack.sent("chat.update")[0]["text"].startswith("Sorry, I couldn't answer that.")


def test_one_missing_source_does_not_stop_the_answer():
    def broken(account):
        raise A.ai.ReviewError("The insights export has no daily figures for Acme yet.")
    data = c.account_data("Acme", ROWS, load_pack=broken)
    assert data["last_30_days_vs_previous_30"]["unavailable"].startswith("ReviewError: The insights export")
    assert data["latest_day"]["day"] == "2026-09-26" and len(data["campaign_report_by_day"]) == 8


def test_long_answers_are_cut_at_a_line_and_headings_become_bold():
    assert c.to_slack("## Summary\nok") == "*Summary*\nok"
    long = ("line\n" * 2000)
    out = c.to_slack(long)
    assert len(out) < c.MAX_ANSWER_CHARS + 60 and out.endswith("_(cut short; ask for the rest)_")


def test_the_digest_remembers_each_messages_account_so_replies_are_answered():
    seen = {}
    gads_digest.run(ROWS, ["Acme"], token="t", channel=CHANNEL, session=D.FakeSlack((200, {"ok": True, "ts": "123.4"})),
                    sleep=lambda s: None, on_thread=seen.__setitem__)
    assert seen == {"Acme": "123.4"}


# ── The endpoint ─────────────────────────────────────────────────────────────
@pytest.fixture
def events(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    store.reset_memory()
    appmod._slack_seen.clear()
    for k, v in (("GOOGLE_ADS_SLACK_SIGNING_SECRET", SECRET), ("GOOGLE_ADS_SLACK_BOT_TOKEN", "xoxb-test"),
                 ("GOOGLE_ADS_SLACK_CHANNEL", CHANNEL)):
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("GOOGLE_ADS_SLACK_MAX_QUESTIONS_PER_DAY", raising=False)
    started = []
    monkeypatch.setattr(appmod, "_slack_spawn", lambda fn, *args: started.append(args))
    slack = FakeSlack()
    monkeypatch.setattr(c, "requests", type("R", (), {"post": slack.post, "get": slack.get,
                                                      "RequestException": Exception}))
    yield started, slack
    store.reset_memory()


def _post(payload, headers=None, sign=True):
    body = json.dumps(payload).encode()
    h = dict(headers or {})
    if sign:
        ts, sig = _sign(body)
        h.update({"X-Slack-Request-Timestamp": ts, "X-Slack-Signature": sig})
    return appmod.app.test_client().post("/api/slack/events", data=body, headers=h, content_type="application/json")


def _event(event, eid="Ev1"):
    return {"type": "event_callback", "event_id": eid, "authorizations": [{"user_id": BOT, "is_bot": True}],
            "event": dict({"channel": CHANNEL, "user": "UPERSON", "ts": "300.1"}, **event)}


def test_slack_can_verify_the_address_and_nobody_else_gets_in(events, monkeypatch):
    r = _post({"type": "url_verification", "challenge": "abc"})
    assert r.status_code == 200 and r.get_json() == {"challenge": "abc"}
    assert _post({"type": "url_verification", "challenge": "abc"}, sign=False).status_code == 401
    monkeypatch.delenv("GOOGLE_ADS_SLACK_SIGNING_SECRET")
    assert _post({"type": "url_verification", "challenge": "abc"}).status_code == 503


def test_a_mention_is_answered_in_the_background_once(events):
    started, _ = events
    r = _post(_event({"type": "app_mention", "text": "<@UBOT> how is Acme?"}))
    assert r.status_code == 200 and len(started) == 1
    event, bot, thread, text, thread_account, base = started[0]
    assert (bot, thread, text, thread_account) == (BOT, "300.1", "how is Acme?", "")
    _post(_event({"type": "app_mention", "text": "<@UBOT> how is Acme?"}))
    _post(_event({"type": "app_mention", "text": "<@UBOT> how is Acme?"}, eid="Ev2"), headers={"X-Slack-Retry-Num": "1"})
    assert len(started) == 1, "the same event and Slack's retries are answered once"


def test_a_reply_under_a_digest_is_about_that_digests_account(events):
    started, _ = events
    appmod._slack_thread_remember("Acme", "100.0")
    _post(_event({"type": "message", "text": "why?", "thread_ts": "100.0"}))
    assert started[0][2:5] == ("100.0", "why?", "Acme")
    _post(_event({"type": "message", "text": "and this?", "thread_ts": "999.0"}, eid="Ev3"))
    assert len(started) == 1, "a thread Ads Insight is not part of is left alone"


def test_questions_stop_at_the_daily_limit(events, monkeypatch):
    started, slack = events
    monkeypatch.setenv("GOOGLE_ADS_SLACK_MAX_QUESTIONS_PER_DAY", "1")
    _post(_event({"type": "app_mention", "text": "<@UBOT> one"}, eid="E1"))
    _post(_event({"type": "app_mention", "text": "<@UBOT> two"}, eid="E2"))
    assert len(started) == 1 and "today's limit" in slack.sent("chat.postMessage")[0]["text"]


def test_the_background_half_answers_from_the_dashboards_data(events, monkeypatch):
    _, slack = events
    claude = A.FakeClaude("Spend rose on Generic - Search.")
    real = c.ask_claude
    monkeypatch.setattr(c, "ask_claude", lambda system, messages, client=None: real(system, messages, claude))
    st = g.load(D.T._raw(D.T._harness())) if D.T.NODE else {"ok": False}
    monkeypatch.setattr(appmod, "_gads_ai_load",
                        lambda: (g, st, ROWS, g.FX(ROWS), g.Spend(ROWS), appmod._google_ads_campaigns(ROWS)))
    monkeypatch.setattr(appmod, "_gads_ai_context", lambda account, force=False: None)
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: ROWS)
    appmod._slack_answer({"ts": "300.1"}, BOT, "300.1", "how is Acme?", "", "https://app.example")
    assert slack.sent("chat.update")[0]["text"].startswith("Spend rose on Generic - Search.")
    assert appmod._slack_thread_account("300.1") == "Acme", "follow-ups in this thread stay on Acme"


def test_a_long_answer_is_split_into_sections_slack_accepts():
    blocks = c.answer_blocks(("line of the answer\n" * 400).strip(), "Acme", "2026-09-26", "https://app.example")
    sections = [b for b in blocks if b["type"] == "section"]
    assert len(sections) >= 3 and all(len(b["text"]["text"]) <= 3000 for b in sections)
    assert blocks[-1]["elements"][0]["text"]["text"].endswith("Open Acme")
    failed = c.answer_blocks("Sorry, I couldn't answer that.", "", "", "https://app.example", ok=False)
    assert failed[0]["elements"][0]["text"].endswith("*Couldn't answer*") and failed[-1]["type"] == "section"
