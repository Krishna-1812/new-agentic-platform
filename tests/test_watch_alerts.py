"""Page Watch, Phase 5: Slack alerts, the digest, the watchdog, and the routes
Slack and GitHub call.

Slack is never called: a fake session records what would be posted and
answers like chat.postMessage, so each test checks the exact message.
"""

import hashlib
import hmac
import json
import os
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(__file__))
from test_watch_engine import _fake_reader, blocks, cap_from, page  # noqa: E402

from tracker import watch_alerts, watch_engine, watch_schedule, watch_store  # noqa: E402

ANA = "ana@markifydigital.com"
UTC = timezone.utc


class FakeSlack:
    def __init__(self, ok=True, error="channel_not_found"):
        self.sent, self.ok, self.error = [], ok, error

    def post(self, url, headers=None, json=None, timeout=None):
        self.sent.append(json)
        body = {"ok": True, "ts": "1700000000.%06d" % len(self.sent)} if self.ok else {"ok": False, "error": self.error}
        return type("R", (), {"status_code": 200, "headers": {}, "json": lambda self: body})()


@pytest.fixture
def slack(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    for k in ("WATCH_SLACK_BOT_TOKEN", "GOOGLE_ADS_SLACK_BOT_TOKEN"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("WATCH_SLACK_BOT_TOKEN", "xoxb-test-not-real")
    monkeypatch.setenv("WATCH_SLACK_CHANNEL", "page-watch")
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://platform.example.com/")
    monkeypatch.setenv("SECRET_KEY", "test-secret-not-real")
    monkeypatch.setenv("WATCH_ALERTS", "on")
    watch_store.reset_memory()
    fake = FakeSlack()
    import tracker.gads_digest as gd
    monkeypatch.setattr(gd, "requests", type("Req", (), {"post": staticmethod(fake.post),
                                                         "RequestException": Exception}))
    yield fake
    watch_store.reset_memory()


def recorded_change(channel="", **verdict):
    tid = watch_store.create_target(ANA, "https://example.com/pricing", name="Example <pricing>", client="Competitors",
                                    channel=channel)
    watch_engine.run_check(tid, capture=_fake_reader(cap_from(page()), cap_from(page()), cap_from(page())))
    r = watch_engine.run_check(tid, confirm=False, capture=_fake_reader(
        cap_from(page(price=False), blk=blocks(**{"$20": {"text": "$25"}}))))
    v = {"summary": "Hobby went from $20 to $25 & more", "explanation": "It costs <more>.", "category": "price",
         "importance": "important", "noise": False, "judged_by": "claude", "muted": False}
    v.update(verdict)
    watch_store.update_change(r["change_id"], verdict=v)
    return watch_store.get_target(tid), r["change_id"], v


# ── Deciding ─────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("verdict,what", [
    ({"importance": "important"}, "now"), ({"importance": "worth_a_look"}, "now"),
    ({"importance": "minor"}, "digest"), ({"importance": "important", "muted": True}, "skip"),
    ({"importance": "minor", "noise": True}, "skip"), ({}, "digest"),
])
def test_what_happens_to_each_kind_of_change(verdict, what):
    assert watch_alerts.decide(verdict)[0] == what


# ── The message ──────────────────────────────────────────────────────────────
def test_the_alert_carries_the_verdict_picture_and_buttons_escaped(slack):
    t, cid, v = recorded_change()
    msg = watch_alerts.change_message(t, watch_store.get_change(cid), v, day="2026-10-02")
    top = msg["blocks"][0]["text"]["text"]
    assert top == "*Important · Example &lt;pricing&gt;*\nHobby went from $20 to $25 &amp; more"
    att = msg["attachments"][0]
    assert att["color"] == "#FF6022"
    kinds = [b["type"] for b in att["blocks"]]
    assert kinds == ["section", "context", "image", "actions"]
    assert att["blocks"][0]["text"]["text"] == "It costs &lt;more&gt;."
    img = att["blocks"][2]["image_url"]
    assert img.startswith("https://platform.example.com/api/page-watch/alert-image/%d/2026-10-02/" % cid)
    buttons = att["blocks"][3]["elements"]
    assert buttons[0]["url"] == "https://platform.example.com/strategic-agents/page-watch/changes/%d" % cid
    assert [b["action_id"] for b in buttons[1:]] == ["pw_fb_useful", "pw_fb_not_useful", "pw_fb_mute"]
    assert all(b["value"] == str(cid) for b in buttons[1:])
    assert "Competitors" in att["blocks"][1]["elements"][0]["text"]


def test_without_an_address_or_a_secret_there_is_no_picture_link(slack, monkeypatch):
    t, cid, v = recorded_change()
    monkeypatch.delenv("PUBLIC_BASE_URL")
    msg = watch_alerts.change_message(t, watch_store.get_change(cid), v)
    assert "image" not in [b["type"] for b in msg["attachments"][0]["blocks"]]
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://platform.example.com")
    monkeypatch.delenv("SECRET_KEY")
    assert watch_alerts.image_url(cid) == ""


def test_picture_links_are_signed_and_expire(slack):
    sig = watch_alerts.sign(7, "2026-10-02")
    today = datetime(2026, 10, 10).date()
    assert watch_alerts.check_image(7, "2026-10-02", sig, today=today)
    assert not watch_alerts.check_image(8, "2026-10-02", sig, today=today)          # another change
    assert not watch_alerts.check_image(7, "2026-10-03", sig, today=today)          # another day
    assert not watch_alerts.check_image(7, "2026-10-02", sig[:-1] + "0", today=today)
    assert not watch_alerts.check_image(7, "2026-10-02", sig, today=today + timedelta(days=watch_alerts.IMAGE_DAYS))


# ── Posting ──────────────────────────────────────────────────────────────────
def test_an_important_change_is_posted_once_to_its_channel(slack):
    t, cid, v = recorded_change(channel="#clients-acme")
    alert = watch_alerts.alert_change(t, cid, v)
    assert alert["state"] == "sent" and alert["channel"] == "clients-acme" and alert["ts"]
    assert slack.sent[-1]["channel"] == "clients-acme" and slack.sent[-1]["unfurl_links"] is False
    assert watch_store.get_change(cid)["alert"]["state"] == "sent"


def test_minor_is_queued_muted_and_noise_are_not_posted(slack):
    t, cid, v = recorded_change(importance="minor")
    assert watch_alerts.alert_change(t, cid, v)["state"] == "queued"
    t, cid, v = recorded_change(muted=True)
    assert watch_alerts.alert_change(t, cid, v) == {"state": "skipped", "reason": "muted"}
    t, cid, v = recorded_change(noise=True, importance="minor")
    slack.sent.clear()                     # the engine's own alerts while recording
    assert watch_alerts.alert_change(t, cid, v) == {"state": "skipped", "reason": "noise"}
    assert slack.sent == []


def test_a_slack_error_is_recorded_not_raised(slack, monkeypatch):
    t, cid, v = recorded_change()
    slack.ok = False
    alert = watch_alerts.alert_change(t, cid, v)
    assert alert["state"] == "failed" and alert["error"] == "channel_not_found"
    monkeypatch.delenv("WATCH_SLACK_BOT_TOKEN")
    assert watch_alerts.alert_change(t, cid, v)["reason"] == "not_configured"
    monkeypatch.setenv("WATCH_SLACK_BOT_TOKEN", "xoxb-test-not-real")
    monkeypatch.setenv("WATCH_ALERTS", "off")
    assert watch_alerts.alert_change(t, cid, v)["reason"] == "not_configured"
    assert watch_alerts.ready() == (False, "Alerts are switched off (WATCH_ALERTS=off).")


def test_a_recorded_change_is_alerted_by_the_engine(slack):
    tid = watch_store.create_target(ANA, "https://example.com/pricing", name="Example")
    watch_engine.run_check(tid, capture=_fake_reader(cap_from(page()), cap_from(page()), cap_from(page())))
    r = watch_engine.run_check(tid, confirm=False, capture=_fake_reader(
        cap_from(page(price=False), blk=blocks(**{"$20": {"text": "$25"}}))))
    # Without Claude the rules call a price change important: posted at once.
    assert watch_store.get_change(r["change_id"])["alert"]["state"] == "sent"
    assert "Price changed: $20" in slack.sent[-1]["text"]


def test_a_failing_watch_is_announced_once_and_its_recovery_once(slack):
    tid = watch_store.create_target(ANA, "https://example.com/", name="Example")
    watch_engine.run_check(tid, capture=_fake_reader(cap_from(page()), cap_from(page()), cap_from(page())))
    broken = cap_from(None, blk=[])
    broken.error, broken.error_detail = "timeout", "The page took too long."
    for _ in range(4):
        watch_engine.run_check(tid, capture=_fake_reader(broken))
    fails = [m for m in slack.sent if m["text"].startswith("Can't read")]
    assert len(fails) == 1 and "took too long" in fails[0]["blocks"][0]["text"]["text"]
    watch_engine.run_check(tid, capture=_fake_reader(cap_from(page())))
    watch_engine.run_check(tid, capture=_fake_reader(cap_from(page())))
    back = [m for m in slack.sent if "reads again" in m["text"]]
    assert len(back) == 1


# ── The digest and the weekly summary ────────────────────────────────────────
def test_the_digest_posts_once_a_day_per_channel_after_its_time(slack):
    for ch in ("", "", "#other"):
        t, cid, v = recorded_change(channel=ch, importance="minor", summary="A small wording change")
        watch_alerts.alert_change(t, cid, v)
    slack.sent.clear()                     # the engine's own alerts while recording
    before = datetime(2026, 10, 2, 9, 0, tzinfo=watch_schedule.IST)                # a Friday, before 09:30
    assert watch_alerts.run_digest(before) is None and slack.sent == []
    at = datetime(2026, 10, 2, 9, 31, tzinfo=watch_schedule.IST)
    out = watch_alerts.run_digest(at)
    assert out == {"posted": 2, "changes": 3, "weekly": False}
    chans = sorted(m["channel"] for m in slack.sent)
    assert chans == ["other", "page-watch"]
    main = next(m for m in slack.sent if m["channel"] == "page-watch")
    assert "(2)" in main["text"] and "A small wording change" in main["blocks"][0]["text"]["text"]
    assert watch_alerts.run_digest(at + timedelta(hours=1)) is None                # once a day
    assert all(c["alert"]["state"] == "digested" for c in watch_store._MEM["changes"].values())


def test_mondays_bring_the_week(slack):
    t, cid, v = recorded_change()
    watch_alerts.alert_change(t, cid, v)
    monday = datetime.now(UTC).astimezone(watch_schedule.IST)
    monday = (monday + timedelta(days=(7 - monday.weekday()) % 7)).replace(hour=10, minute=0)
    out = watch_alerts.run_digest(monday)
    assert out["weekly"] is True
    week = slack.sent[-1]
    assert week["channel"] == "page-watch" and "1 changes: 1 important" in week["blocks"][0]["text"]["text"]


# ── The watchdog ─────────────────────────────────────────────────────────────
def test_the_watchdog_warns_once_then_clears(slack):
    sick = {"status": "no_worker", "queue": {"active": 3, "late": 0}}
    assert watch_alerts.watchdog(sick) == "alerted"
    assert watch_alerts.watchdog(sick) == "already"
    assert "3 pages are being watched" in slack.sent[-1]["blocks"][0]["text"]["text"]
    assert watch_alerts.watchdog({"status": "ok", "queue": {"active": 3}}) == "ok"
    assert watch_alerts.watchdog(sick) == "alerted"                                  # a new incident
    assert watch_alerts.watchdog({"status": "no_worker", "queue": {"active": 0}}) == "quiet"


# ── The routes ───────────────────────────────────────────────────────────────
@pytest.fixture
def client(slack, monkeypatch):
    import app as appmod
    monkeypatch.setattr(appmod, "_get_user", lambda: None)                        # nobody signed in
    return appmod.app.test_client()


def test_the_alert_picture_needs_a_good_signature_not_a_login(client):
    t, cid, v = recorded_change()
    day = datetime.now(UTC).date().isoformat()
    good = "/api/page-watch/alert-image/%d/%s/%s.png" % (cid, day, watch_alerts.sign(cid, day))
    r = client.get(good)
    assert r.status_code == 200 and r.data[:8] == b"\x89PNG\r\n\x1a\n" and r.headers["X-Content-Type-Options"] == "nosniff"
    assert client.get(good.replace(".png", "0.png")).status_code == 404
    assert client.get("/api/page-watch/alert-image/%d/not-a-day/%s.png" % (cid, "0" * 40)).status_code == 404


def test_the_watchdog_route_needs_its_token(client, monkeypatch):
    assert client.post("/api/page-watch/watchdog").status_code == 503
    monkeypatch.setenv("WATCH_CRON_TOKEN", "cron-test-not-real")
    assert client.post("/api/page-watch/watchdog", headers={"Authorization": "Bearer nope"}).status_code == 403
    r = client.post("/api/page-watch/watchdog", headers={"Authorization": "Bearer cron-test-not-real"})
    assert r.status_code == 200 and r.get_json() == {"ok": True, "status": "idle", "result": "quiet"}


def _signed(secret, body, ts=None):
    ts = str(int(ts or time.time()))
    sig = "v0=" + hmac.new(secret.encode(), ("v0:%s:%s" % (ts, body)).encode(), hashlib.sha256).hexdigest()
    return {"X-Slack-Request-Timestamp": ts, "X-Slack-Signature": sig,
            "Content-Type": "application/x-www-form-urlencoded"}


def test_slack_buttons_record_feedback_when_signed(client, monkeypatch):
    import app as appmod
    t, cid, v = recorded_change()
    monkeypatch.setenv("GOOGLE_ADS_SLACK_SIGNING_SECRET", "signing-test-not-real")
    told = []
    monkeypatch.setattr(appmod.requests, "post", lambda url, json=None, timeout=None: told.append((url, json)))
    payload = {"type": "block_actions", "response_url": "https://hooks.slack.com/actions/T/1/x",
               "actions": [{"action_id": "pw_fb_mute", "value": str(cid)}]}
    body = "payload=" + urllib.parse.quote(json.dumps(payload))
    assert client.post("/api/slack/interactions", data=body,
                       headers=_signed("wrong-secret", body)).status_code == 401
    assert watch_store.get_change(cid)["feedback"] is None
    r = client.post("/api/slack/interactions", data=body, headers=_signed("signing-test-not-real", body))
    assert r.status_code == 200
    assert watch_store.get_change(cid)["feedback"] == "mute"
    assert watch_store.get_target(t["id"])["settings"]["muted"] == ["price"]
    for _ in range(50):
        if told:
            break
        time.sleep(0.05)
    assert told and told[0][1]["response_type"] == "ephemeral" and "Muted" in told[0][1]["text"]


def test_other_slack_clicks_are_left_alone(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_ADS_SLACK_SIGNING_SECRET", "signing-test-not-real")
    payload = {"actions": [{"action_id": "open_dashboard", "value": "x"}, {"action_id": "pw_fb_useful", "value": "nope"},
                           {"action_id": "pw_fb_useful", "value": "999999"}]}
    body = "payload=" + urllib.parse.quote(json.dumps(payload))
    assert client.post("/api/slack/interactions", data=body,
                       headers=_signed("signing-test-not-real", body)).status_code == 200


def test_the_watchdog_workflow_is_quiet_until_configured():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, ".github/workflows/page-watch-watchdog.yml")) as f:
        wf = f.read()
    assert "secrets.WATCH_CRON_TOKEN" in wf and "exit 0" in wf and "/api/page-watch/watchdog" in wf
    assert "permissions: {}" in wf
