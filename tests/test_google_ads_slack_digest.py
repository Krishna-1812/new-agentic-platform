"""Google Ads daily Slack digest (tracker/gads_digest.py, the routes in app.py and the scheduled Action).

Slack is replaced by a recording stand-in and the sheet by fixed rows, so these check the figures,
the alerts, the message, and who may trigger a post; never a real call."""
import datetime as dt
import json
import os

import pytest

from tests import test_google_ads_insights as T
from tracker import gads_ai_store as store
from tracker import gads_digest as d
from tracker import google_ads_insights as g

appmod = T.appmod
ROOT = T.ROOT
TODAY = dt.date(2026, 9, 27)


def _row(account, campaign, day, cost, conv=0.0, clicks=10.0, cur="INR"):
    return {"account": account, "customer_id": "123-456-7890", "campaign": campaign, "state": "Enabled",
            "type": "Search", "day": day, "cost": cost, "currency": cur, "clicks": clicks, "impressions": 100.0,
            "conversions": conv, "cost_native": cost, "currency_native": cur}


def _week(account="Acme", cost=1000.0, conv=4.0, last=None):
    """20-25 Sep at a steady 1,000 a day and 4 conversions; 26 Sep as given."""
    rows = [_row(account, "Generic - Search", "2026-09-%02d" % n, cost, conv) for n in range(20, 26)]
    rows.append(_row(account, "Generic - Search", "2026-09-19", cost, conv))
    if last is not None:
        rows += [_row(account, c, "2026-09-26", v, k) for c, v, k in last]
    return rows


class FakeSlack:
    def __init__(self, *replies):
        self.replies = list(replies) or [(200, {"ok": True})]
        self.calls = []

    def post(self, url, headers=None, json=None, timeout=None):
        self.calls.append({"url": url, "headers": headers, "json": json})
        code, body = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        return _Resp(code, body)


class _Resp:
    def __init__(self, code, body):
        self.status_code, self._body = code, body
        self.headers = {"Retry-After": "2"}

    def json(self):
        return self._body


# ── Figures ──────────────────────────────────────────────────────────────────
def test_the_latest_day_is_compared_with_the_seven_days_before_it():
    rows = _week(last=[("Generic - Search", 1500.0, 3.0), ("Brand - Search", 500.0, 3.0)])
    s = d.summarize(rows, "Acme", today=TODAY)
    assert s["day"] == "2026-09-26" and s["base_days"] == 7
    assert s["now"]["cost"] == 2000.0 and s["now"]["conversions"] == 6.0
    assert s["base"]["cost"] == 1000.0 and s["base"]["conversions"] == 4.0
    assert round(s["cpa"], 2) == 333.33 and s["base_cpa"] == 250.0
    assert [c["campaign"] for c in s["top"]] == ["Generic - Search", "Brand - Search"]


def test_a_day_with_no_rows_counts_as_nothing_spent_in_the_average():
    rows = _week(last=[("Generic - Search", 1000.0, 4.0)])
    rows = [r for r in rows if r["day"] != "2026-09-22"]
    rows.append(_row("Other", "X", "2026-09-22", 10.0))   # the report still covers the 22nd
    s = d.summarize(rows, "Acme", today=TODAY)
    assert s["base_days"] == 7 and round(s["base"]["cost"], 2) == round(6000 / 7, 2)


def test_each_account_is_read_on_its_own_latest_day():
    rows = _week(last=[("Generic - Search", 1000.0, 4.0)]) + [_row("NYC Co", "S", "2026-09-25", 50.0, cur="INR")]
    assert d.summarize(rows, "NYC Co", today=TODAY)["day"] == "2026-09-25"
    assert d.summarize(rows, "Nobody", today=TODAY) is None


# ── Alerts ───────────────────────────────────────────────────────────────────
def _alerts(last, **kw):
    return d.summarize(_week(last=last), "Acme", today=kw.get("today", TODAY))["alerts"]


def test_a_steady_day_needs_no_attention():
    assert _alerts([("Generic - Search", 1100.0, 4.0)]) == []


def test_spend_swings_and_lost_conversions_are_flagged():
    assert any("Spend up 60%" in a for a in _alerts([("Generic - Search", 1600.0, 6.0)]))
    assert any("Spend down 60%" in a for a in _alerts([("Generic - Search", 400.0, 2.0)]))
    nothing = _alerts([("Generic - Search", 0.0, 0.0)])
    assert any(a.startswith("Spent nothing") for a in nothing)
    no_conv = _alerts([("Generic - Search", 1000.0, 0.0)])
    assert any(a.startswith("No conversions (7-day average 4 a day)") for a in no_conv)


def test_a_dearer_conversion_is_flagged():
    a = _alerts([("Generic - Search", 1000.0, 2.0)])
    assert any("Cost per conversion ₹500, up 100% on the 7-day ₹250" in x for x in a)


def test_data_that_stopped_arriving_is_flagged():
    a = _alerts([("Generic - Search", 1000.0, 4.0)], today=dt.date(2026, 9, 30))
    assert a and a[0].startswith("No data after Sat 26 Sep 2026")


@pytest.mark.skipif(not T.NODE, reason="node is not installed")
def test_pacing_budget_limits_and_disapproved_ads_come_from_the_insights():
    st = g.load(T._raw(T._harness()))
    s = d.summarize(_week(last=[("Generic - Search", 1000.0, 4.0)]), "Acme", st, today=TODAY)
    assert s["pacing"]["under"] == ["Shared generic"] and s["pacing"]["mtd"] == 127400.0
    text = " ".join(s["alerts"])
    assert "Budget under-pacing this month: Shared generic." in text
    assert "Losing searches to budget (last 7 days): Generic - Search." in text
    assert "1 disapproved ad." in text


# ── The message ──────────────────────────────────────────────────────────────
def test_the_message_reads_plainly_and_escapes_names():
    rows = _week(account="A & <B>", last=[("Brand <x>", 1600.0, 2.0)])
    s = d.summarize(rows, "A & <B>", today=TODAY)
    msg = d.message(s, "https://app.example", "https://app.example/chart.png")
    blob = json.dumps(msg["blocks"], ensure_ascii=False)
    assert msg["blocks"][0]["text"]["text"] == "\U0001F7E0  A & <B>", "status light, and plain_text needs no escaping"
    assert "Worth a look" in blob and "Sat 26 Sep 2026" in blob
    assert "Brand &lt;x&gt;" in blob and "Brand <x>" not in blob
    assert '"url": "https://app.example/dashboards/google-ads?account=A%20%26%20%3CB%3E"' in blob
    assert "\u20b91,600" in blob and "_7-day avg \u20b91,000_" in blob
    assert "\u26aa `\u25b2 60%`" in blob, "spend has no good or bad direction: a white pill"
    assert "\U0001F534 `\u25b2 220%`" in blob, "dearer conversions are red"
    assert "\U0001F534 `\u25bc 50%`" in blob, "fewer conversions are red"
    assert {"type": "image", "image_url": "https://app.example/chart.png",
            "alt_text": "Daily spend and conversions for A & <B> over the last 14 days"} in msg["blocks"]
    assert "\U0001F947  *Brand &lt;x&gt;*" in blob, "top campaigns get medals"
    assert msg["text"].startswith("\U0001F7E0 A & <B>, Sat 26 Sep 2026: spend \u20b91,600, 2 conversions")
    assert all(len(f["text"]) < 2000 for b in msg["blocks"] for f in b.get("fields", []))
    assert len(msg["blocks"]) <= 50


def test_alerts_carry_a_level_and_the_most_serious_sets_the_light():
    s = d.summarize(_week(last=[("Generic - Search", 1000.0, 0.0)]), "Acme", today=TODAY)
    assert s["alert_items"][0] == (d.CRITICAL, "No conversions (7-day average 4 a day).") and s["status"] == d.CRITICAL
    calm = d.summarize(_week(last=[("Generic - Search", 1050.0, 4.0)]), "Acme", today=TODAY)
    assert calm["status"] == "good"
    assert "All clear" in json.dumps(d.message(calm)["blocks"])


def test_the_pill_and_meter():
    assert d.pill(110, 100, d.GOOD_UP) == "\U0001F7E2 `\u25b2 10%`"
    assert d.pill(110, 100, d.GOOD_DOWN) == "\U0001F534 `\u25b2 10%`"
    assert d.pill(102, 100, d.GOOD_UP) == "`= flat`" and d.pill(5, 0, d.GOOD_UP) == ""
    assert d.meter(0.32) == "\u25b0" * 3 + "\u25b1" * 7 and d.meter(1.7) == "\u25b0" * 10


def test_the_morning_overview_ranks_accounts_most_urgent_first():
    rows = (_week(last=[("Generic - Search", 1000.0, 0.0)]) + _week("Calm", last=[("S", 1000.0, 4.0)])
            + _week("Busy", last=[("S", 1700.0, 6.0)]))
    ss = [d.summarize(rows, a, today=TODAY) for a in ("Calm", "Busy", "Acme")]
    msg = d.overview(ss, "https://app.example", today=TODAY)
    blob = json.dumps(msg["blocks"], ensure_ascii=False)
    assert blob.index("*Acme*") < blob.index("*Busy*") < blob.index("*Calm*")
    assert "\U0001F534 1  \u00b7  \U0001F7E0 1  \u00b7  \U0001F7E2 1" in blob
    assert "\u20b93,700" in blob, "one currency: the total is shown"
    assert msg["text"] == "Google Ads morning briefing: 3 accounts, 1 need action, 1 worth a look."


def test_rupees_use_lakh_grouping_and_other_currencies_commas():
    assert d.money(12345678, "INR") == "₹1,23,45,678"
    assert d.money(610591.4, "INR") == "₹6,10,591"
    assert d.money(999, "INR") == "₹999"
    assert d.money(12345.6, "USD") == "$12,346" and d.money(12.5, "USD") == "$12.50"
    assert d.money(None, "INR") == "n/a"


# ── Posting ──────────────────────────────────────────────────────────────────
def test_an_overview_then_one_message_per_account_spaced_a_second_apart_and_never_twice():
    rows = _week(last=[("Generic - Search", 1000.0, 4.0)]) + _week("Beta", last=[("Generic - Search", 900.0, 4.0)])
    slack, slept, posted, threads = FakeSlack((200, {"ok": True, "ts": "1.1"})), [], {}, []
    kw = dict(token="xoxb-test", channel="C123", today=TODAY, session=slack, sleep=slept.append,
              last_posted=posted.get, mark_posted=posted.__setitem__, on_thread=lambda a, ts: threads.append(a),
              chart_url=lambda a, day: "https://x/%s/%s.png" % (a, day))
    out = d.run(rows, ["Acme", "Beta"], **kw)
    assert [(r["account"], r["status"]) for r in out] == [(d.OVERVIEW, "posted"), ("Acme", "posted"), ("Beta", "posted")]
    assert len(slack.calls) == 3 and slept == [d.SPACING_SECONDS] * 2
    assert threads == ["", "Acme", "Beta"], "replies under the overview are about every account"
    call = slack.calls[1]
    assert call["url"] == "https://slack.com/api/chat.postMessage"
    assert call["headers"]["Authorization"] == "Bearer xoxb-test" and call["json"]["channel"] == "C123"
    assert {"type": "image", "image_url": "https://x/Acme/2026-09-26.png",
            "alt_text": "Daily spend and conversions for Acme over the last 14 days"} in call["json"]["blocks"]
    assert posted == {d.OVERVIEW: "2026-09-27", "Acme": "2026-09-26", "Beta": "2026-09-26"}
    again = d.run(rows, ["Acme", "Beta"], **kw)
    assert [r["status"] for r in again] == ["skipped"] * 3 and len(slack.calls) == 3
    forced = d.run(rows, ["Acme"], force=True, **kw)
    assert [r["account"] for r in forced] == ["Acme"], "one account: no overview"
    assert forced[0]["status"] == "posted" and len(slack.calls) == 4


def test_slack_errors_are_reported_and_a_rate_limit_is_retried_once():
    rows = _week(last=[("Generic - Search", 1000.0, 4.0)])
    slack, slept = FakeSlack((429, {}), (200, {"ok": True})), []
    assert d.run(rows, ["Acme"], token="t", channel="C", session=slack, sleep=slept.append)[0]["status"] == "posted"
    assert slept == [2] and len(slack.calls) == 2
    bad = FakeSlack((200, {"ok": False, "error": "not_in_channel"}))
    res = d.run(rows, ["Acme"], token="t", channel="C", session=bad, sleep=lambda s: None)[0]
    assert res["status"] == "failed" and res["error"] == "not_in_channel"


def test_a_preview_posts_nothing():
    rows = _week(last=[("Generic - Search", 1000.0, 4.0)])
    slack = FakeSlack()
    res = d.run(rows, ["Acme"], dry_run=True, session=slack)[0]
    assert res["status"] == "preview" and res["message"]["blocks"] and slack.calls == []


# ── The routes ───────────────────────────────────────────────────────────────
@pytest.fixture
def site(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    store.reset_memory()
    rows = _week(last=[("Generic - Search", 1000.0, 4.0)])
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: rows)
    monkeypatch.setattr(g, "store", lambda *a, **k: {"ok": False})
    monkeypatch.setattr(d, "today_ist", lambda: TODAY)
    monkeypatch.setattr(d, "SPACING_SECONDS", 0)
    slack = FakeSlack()
    monkeypatch.setattr(d, "requests", type("R", (), {"post": slack.post, "RequestException": Exception}))
    for k, v in (("GOOGLE_ADS_DIGEST_TOKEN", "s3cret"), ("GOOGLE_ADS_SLACK_BOT_TOKEN", "xoxb-test"),
                 ("GOOGLE_ADS_SLACK_CHANNEL", "C123")):
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("PUBLIC_BASE_URL", raising=False)
    yield slack
    store.reset_memory()


def test_only_the_scheduled_caller_with_the_token_can_post(site, monkeypatch):
    c = appmod.app.test_client()
    url = "/api/dashboards/google-ads/slack-digest"
    assert c.post(url).status_code == 403
    assert c.post(url, headers={"Authorization": "Bearer wrong"}).status_code == 403
    r = c.post(url, headers={"Authorization": "Bearer s3cret"}, base_url="http://web.example")
    body = r.get_json()
    assert r.status_code == 200 and body == {"ok": True, "accounts": 1, "counts": {"posted": 1}, "errors": []}
    assert "Acme" not in r.get_data(as_text=True), "the Action's log never sees account names"
    assert "https://web.example/dashboards/google-ads?account=Acme" in json.dumps(site.calls[0]["json"])
    again = c.post(url, headers={"Authorization": "Bearer s3cret"}).get_json()
    assert again["counts"] == {"skipped": 1} and len(site.calls) == 1, "a retried run does not post twice"
    monkeypatch.delenv("GOOGLE_ADS_DIGEST_TOKEN")
    assert c.post(url, headers={"Authorization": "Bearer "}).status_code == 503, "no token set: closed"


def test_without_its_own_slack_settings_nothing_is_posted(site, monkeypatch):
    monkeypatch.delenv("GOOGLE_ADS_SLACK_CHANNEL")
    monkeypatch.setenv("SLACK_CHANNEL_ID", "C-OTHER")
    r = appmod.app.test_client().post("/api/dashboards/google-ads/slack-digest",
                                      headers={"Authorization": "Bearer s3cret"})
    assert r.status_code == 503 and "GOOGLE_ADS_SLACK_CHANNEL" in r.get_json()["error"] and site.calls == []


def test_a_slack_failure_turns_the_run_red(site):
    site.replies = [(200, {"ok": False, "error": "channel_not_found"})]
    r = appmod.app.test_client().post("/api/dashboards/google-ads/slack-digest",
                                      headers={"Authorization": "Bearer s3cret"})
    assert r.status_code == 502 and r.get_json()["errors"] == ["channel_not_found"]


def test_staff_can_preview_the_messages(site):
    assert appmod.app.test_client().get("/api/dashboards/google-ads/slack-digest/preview").status_code in (302, 401, 403)
    body = T._client().get("/api/dashboards/google-ads/slack-digest/preview?account=Acme").get_json()
    assert body["ok"] and body["channel_set"] and body["token_set"]
    assert body["results"][0]["status"] == "preview" and site.calls == []


def test_the_schedule_is_10am_india_time_and_the_log_shows_no_figures():
    with open(os.path.join(ROOT, ".github", "workflows", "google-ads-slack-digest.yml")) as f:
        wf = f.read()
    assert "cron: '25 4 * * *'" in wf, "04:25 UTC = 09:55 IST, posting at about 10:00 after GitHub's usual delay"
    assert "secrets.GOOGLE_ADS_DIGEST_TOKEN" in wf and "/api/dashboards/google-ads/slack-digest" in wf
    assert "permissions: {}" in wf


def test_the_dashboard_opens_on_the_account_in_its_link():
    with open(os.path.join(ROOT, "static", "js", "google-ads-dashboard.js")) as f:
        js = f.read()
    assert 'URLSearchParams(window.location.search).get("account")' in js
    assert js.index("ACCOUNTS.indexOf(wanted)") < js.index("  initControls();\n  initDrawer();")


# ── The chart ────────────────────────────────────────────────────────────────
def test_the_chart_covers_14_days_with_missing_days_as_zero_and_is_a_png():
    from tracker import gads_digest_chart as ch
    rows = _week(last=[("Generic - Search", 1600.0, 6.0)])
    series = ch.days_for(rows, "Acme", "2026-09-26")
    assert len(series) == 14 and series[0] == ("2026-09-13", 0.0, 0.0) and series[-1] == ("2026-09-26", 1600.0, 6.0)
    png = ch.render(series, lambda v: d.money(v, "INR"), 1000.0, 4.0)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    from PIL import Image
    import io
    assert Image.open(io.BytesIO(png)).size == (ch.W * ch.SCALE, ch.H * ch.SCALE)
    assert os.path.exists(os.path.join(ch.FONT_DIR, "DejaVuSans.ttf")), "a font with the rupee sign ships with the code"


def test_the_chart_address_is_signed_for_one_account_and_day(site, monkeypatch):
    c = appmod.app.test_client()
    url = appmod._gads_chart_url("https://web.example", "Acme", "2026-09-26")
    assert url.startswith("https://web.example/api/dashboards/google-ads/slack-chart/2026-09-26/") and url.endswith("?a=Acme")
    path = url[len("https://web.example"):]
    r = c.get(path)
    assert r.status_code == 200 and r.mimetype == "image/png" and "max-age" in r.headers["Cache-Control"]
    assert c.get(path.replace("?a=Acme", "?a=Other")).status_code == 404, "the signature names the account"
    assert c.get(path.replace("2026-09-26/", "2026-09-25/", 1)).status_code == 404, "and the day"
    monkeypatch.setattr(d, "today_ist", lambda: dt.date(2026, 12, 31))
    assert c.get(path).status_code == 404, "old charts expire"
    monkeypatch.delenv("GOOGLE_ADS_DIGEST_TOKEN")
    assert appmod._gads_chart_url("https://web.example", "Acme", "2026-09-26") == ""


def test_the_posted_digest_links_its_chart(site):
    appmod.app.test_client().post("/api/dashboards/google-ads/slack-digest",
                                  headers={"Authorization": "Bearer s3cret"}, base_url="http://web.example")
    blocks = site.calls[0]["json"]["blocks"]
    img = next(b for b in blocks if b["type"] == "image")
    assert img["image_url"].startswith("https://web.example/api/dashboards/google-ads/slack-chart/2026-09-26/")


def test_button_clicks_are_acknowledged_only_for_slack(site, monkeypatch):
    import hashlib
    import hmac
    import time
    c = appmod.app.test_client()
    monkeypatch.setenv("GOOGLE_ADS_SLACK_SIGNING_SECRET", "sig")
    body = b"payload=%7B%7D"
    ts = str(int(time.time()))
    sig = "v0=" + hmac.new(b"sig", ("v0:%s:" % ts).encode() + body, hashlib.sha256).hexdigest()
    h = {"X-Slack-Request-Timestamp": ts, "X-Slack-Signature": sig}
    assert c.post("/api/slack/interactions", data=body, headers=h,
                  content_type="application/x-www-form-urlencoded").status_code == 200
    assert c.post("/api/slack/interactions", data=body, content_type="application/x-www-form-urlencoded").status_code == 401
