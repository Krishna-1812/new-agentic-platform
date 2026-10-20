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
def _card(msg):
    return msg["attachments"][0]["blocks"]


def _core_care():
    """The client report's example: Core Care Clinic, 1-15 Oct 2026, in US dollars, as the sheet has it."""
    def r(day, impr, clicks, cost, conv):
        return dict(_row("Core Care Clinic", "Search", day, cost, conv, clicks, cur="USD"), impressions=impr)
    return [r("2026-10-01", 14651.0, 460.0, 1614.92, 67.0), r("2026-10-15", 1092.0, 32.0, 115.35, 7.0)]


def _shape(days, missing=()):
    """paid_gads.campaign_days' shape for one campaign: {day: (impressions, clicks, cost, conversions, calls)}."""
    from tracker import paid_gads
    names = [k for k, _ in paid_gads.BASE]
    all_days = ["2026-10-%02d" % n for n in range(1, 16)]
    rows = []
    for day, (impr, clicks, cost, conv, calls) in days.items():
        nums = [0] * len(names)
        for k, v in (("impressions", impr), ("clicks", clicks), ("cost_micros", cost), ("conversions", conv),
                     ("phone_calls", calls)):
            nums[names.index(k)] = v
        rows.append([0, all_days.index(day)] + nums)
    return {"days": all_days, "campaigns": [{"id": "1"}], "rows": rows,
            "missing": [names.index(m) for m in missing]}


CORE_API = {"2026-10-01": (14651, 460, 1614.92, 67.0, 87.0), "2026-10-15": (1092, 32, 115.35, 7.0, 4.0)}


def _core_summary(allocated=3000.0, missing=(), currency="USD"):
    api = d.api_totals(_shape(CORE_API, missing), "2026-10-15", currency)
    return d.summarize(_core_care(), "Core Care Clinic", today=dt.date(2026, 10, 16), allocated=allocated, api=api)


def test_the_message_is_laid_out_like_the_client_report():
    s = _core_summary()
    assert s["source"] == "api"
    msg = d.message(s, "https://app.example")
    assert msg["blocks"] == [{"type": "header", "text": {"type": "plain_text", "text": "Core Care Clinic"}}]
    card = _card(msg)
    assert card[0]["elements"][0]["text"].endswith("Oct 1 - Oct 15, 2026  \u00b7  month to date")
    assert [f["text"] for f in card[1]["fields"]] == [
        "Impressions\n*15,743*", "Clicks\n*492*", "CTR\n*3.13%*", "Avg. CPC\n*$3.52*", "Cost\n*$1,730.27*",
        "Conversions\n*74*", "Phone calls\n*91*", "Cost / conv.\n*$23.38*", "Conv. rate\n*15.04%*"]
    table = card[2]["text"]["text"]
    head, values = table.split("\n")[2:4]
    assert head.split() == ["Day", "Impr.", "Clicks", "CTR", "Avg.", "CPC", "Cost", "Conv.", "Calls", "Cost", "/",
                            "conv.", "Conv.", "rate"]
    assert values.split() == ["Oct", "15,", "2026", "1,092", "32", "2.93%", "$3.60", "$115.35", "7", "4", "$16.48",
                              "21.88%"]
    assert head.index("Clicks") == values.index("32"), "the columns line up"
    budget = next(b for b in card if b.get("fields") and "Budget" in b["fields"][0]["text"])["fields"]
    assert [f["text"] for f in budget] == ["Budget allocation\n*$3,000.00*", "Projected budget to Oct 15\n*$1,451.61*",
                                           "Spent so far\n*$1,730.27*", "Overspent\n*+$278.66*"]
    assert msg["text"] == "Core Care Clinic: Oct 1 - Oct 15, 2026. Cost $1,730.27, 74 conversions"
    blob = json.dumps(msg, ensure_ascii=False)
    assert "Pacing Desk" not in blob and "could not be read" not in blob and "sheet starts" not in blob
    assert '"url": "https://app.example/dashboards/google-ads?account=Core%20Care%20Clinic"' in blob
    assert not any(ord(ch) >= 0x1F000 for ch in blob), "no emoji"
    assert len(card) <= 50 and all(len(f["text"]) < 2000 for b in card for f in b.get("fields", []))


def test_underspent_and_where_the_budget_comes_from():
    s = _core_summary(allocated=5000.0)
    budget = next(b for b in _card(d.message(s)) if b.get("fields") and "Budget" in b["fields"][0]["text"])["fields"]
    assert budget[1]["text"].endswith("*$2,419.35*") and budget[3]["text"] == "Underspent\n*-$689.08*"
    none = _core_summary(allocated=None)
    assert none["budget"] is None
    assert "No budget for this account in the Pacing Desk" in json.dumps(d.message(none))


def test_without_a_pacing_desk_budget_the_campaign_daily_budgets_stand_in():
    s = d.summarize(_core_care(), "Core Care Clinic", today=dt.date(2026, 10, 16))
    s["pacing"] = {"month_budget": 3100.0}
    b = d.budget(s)
    assert b["allocated"] == 3100.0 and round(b["projected"], 2) == 1500.0 and b["source"] == "daily_budgets"
    s["budget"] = b
    assert "campaigns' daily budgets" in json.dumps(d.message(s))


def test_the_pacing_desk_allocation_is_found_by_account_then_client():
    saved = [{"client": "Core Care", "account": "Core Care Clinic", "allocated": 3000.0, "channel": "Google"},
             {"client": "Core Care", "account": "Core Care Clinic", "allocated": 900.0, "channel": "Meta"},
             {"client": "July Mode", "account": "July Mode - Search", "allocated": 1000.0, "channel": "Google"},
             {"client": "July Mode", "account": "July Mode - PMax", "allocated": 500.0, "channel": "Google"}]
    assert d.allocation_for(saved, "Core Care Clinic") == 3000.0, "Meta rows are not Google spend"
    assert d.allocation_for(saved, "July Mode") == 1500.0, "by client: every account of it"
    assert d.allocation_for(saved, "Acme") is None and d.allocation_for([], "Core Care Clinic") is None


def test_without_the_api_the_sheet_figures_stand_in_and_calls_are_a_dash_not_zero():
    for s in (d.summarize(_core_care(), "Core Care Clinic", today=dt.date(2026, 10, 16), allocated=3000.0),
              _core_summary(currency="INR")):   # the API's currency is not the card's: never mixed
        assert s["source"] == "sheet"
        msg = d.message(s)
        fields = [f["text"] for f in _card(msg)[1]["fields"]]
        assert "Phone calls\n*\u2014*" in fields and "Cost\n*$1,730.27*" in fields
        assert "The Google Ads API could not be read" in json.dumps(msg, ensure_ascii=False)
    s = _core_summary(missing=["phone_calls"])
    assert s["source"] == "api" and s["mtd"]["phone_calls"] is None, "Google would not give calls: a dash, not 0"


def test_the_api_figures_replace_the_sheets_for_the_card():
    api = d.api_totals(_shape({"2026-10-01": (1000, 50, 200.0, 5.0, 3.0), "2026-10-15": (500, 20, 80.0, 2.0, 1.0)}),
                       "2026-10-15", "USD")
    assert api["mtd"] == {"impressions": 1500, "clicks": 70, "cost": 280.0, "conversions": 7.0, "phone_calls": 4.0}
    assert api["day"] == {"impressions": 500, "clicks": 20, "cost": 80.0, "conversions": 2.0, "phone_calls": 1.0}
    s = d.summarize(_core_care(), "Core Care Clinic", today=dt.date(2026, 10, 16), allocated=3000.0, api=api)
    assert s["mtd"]["cost"] == 280.0 and s["budget"]["spent"] == 280.0 and s["mtd"]["start"] == "2026-10-01"


def test_the_message_escapes_names_and_shows_alerts_only_when_there_are_any():
    rows = _week(account="A & <B>", last=[("Brand <x>", 1600.0, 2.0)])
    s = d.summarize(rows, "A & <B>", today=TODAY)
    msg = d.message(s, "https://app.example")
    blob = json.dumps(msg, ensure_ascii=False)
    assert msg["blocks"] == [{"type": "header", "text": {"type": "plain_text", "text": "A & <B>"}}], \
        "plain_text needs no escaping"
    assert msg["attachments"][0]["color"] == d.BAR_COLOR, "one navy bar for every account"
    assert "Sep 19 - Sep 26, 2026" in blob
    assert "Reply in this thread to ask about A &amp; &lt;B&gt;" in blob
    assert "The sheet starts on Sat 19 Sep 2026" in blob, "a month the sheet does not reach back to is said"
    assert '"url": "https://app.example/dashboards/google-ads?account=A%20%26%20%3CB%3E"' in blob
    texts = [b["text"]["text"] for b in _card(msg) if b["type"] == "section" and "text" in b]
    assert any(t.startswith("\u2022  Spend up 60%") for t in texts)


def test_alerts_are_plain_bullets_most_urgent_first_with_no_status_labels():
    s = d.summarize(_week(last=[("Generic - Search", 1000.0, 0.0)]), "Acme", today=TODAY)
    assert s["alert_items"][0] == (d.CRITICAL, "No conversions (7-day average 4 a day).")
    texts = [b["text"]["text"] for b in _card(d.message(s)) if b["type"] == "section" and "text" in b]
    assert any(t.startswith("\u2022  No conversions") for t in texts)
    calm = d.summarize(_week(last=[("Generic - Search", 1050.0, 4.0)]), "Acme", today=TODAY)
    msg = d.message(calm)
    assert msg["attachments"][0]["color"] == d.BAR_COLOR
    assert not any(b["type"] == "section" and "text" in b and "\u2022" in b["text"]["text"] for b in _card(msg))
    for m in (d.message(s), d.message(calm), d.message(s, card_url="https://x/c.png")):
        blob = json.dumps(m)
        for tag in ("Needs action", "Worth a look", "On track", "Action needed", "Watch", "For information",
                    "need action", "worth a look", "on track", "All clear"):
            assert tag not in blob, tag


def test_the_change_against_the_average():
    assert d.delta(110, 100) == "\u25b2 10%" and d.delta(10, 100) == "\u25bc 90%"
    assert d.delta(102, 100) == "flat" and d.delta(5, 0) == ""


def test_the_morning_overview_lists_accounts_biggest_spend_first_without_labels():
    rows = (_week(last=[("Generic - Search", 1000.0, 0.0)]) + _week("Calm", last=[("S", 900.0, 4.0)])
            + _week("Busy", last=[("S", 1700.0, 6.0)]))
    ss = [d.summarize(rows, a, today=TODAY) for a in ("Calm", "Busy", "Acme")]
    msg = d.overview(ss, "https://app.example", today=TODAY)
    blob = json.dumps(msg, ensure_ascii=False)
    assert blob.index("*Busy*") < blob.index("*Acme*") < blob.index("*Calm*")
    assert "_No conversions (7-day average 4 a day)._" in blob, "an account's main alert under it"
    assert "\u20b93,600" in blob, "one currency: the total is shown"
    assert msg["attachments"][0]["color"] == d.BAR_COLOR
    assert msg["text"] == "Google Ads daily briefing: 3 accounts, Sat 26 Sep 2026."
    for tag in ("Needs action", "Worth a look", "On track", "need action", "worth a look", "on track"):
        assert tag not in blob
    assert not any(ord(ch) >= 0x1F000 for ch in blob)


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
              allocation=lambda a, month: asked.append((a, month)) or (2000.0 if a == "Acme" else None),
              api=lambda a, cid, first, last: read.append((a, cid, first, last)))
    asked, read = [], []
    out = d.run(rows, ["Acme", "Beta"], **kw)
    assert [(r["account"], r["status"]) for r in out] == [(d.OVERVIEW, "posted"), ("Acme", "posted"), ("Beta", "posted")]
    assert len(slack.calls) == 3 and slept == [d.SPACING_SECONDS] * 2
    assert threads == ["", "Acme", "Beta"], "replies under the overview are about every account"
    call = slack.calls[1]
    assert call["url"] == "https://slack.com/api/chat.postMessage"
    assert call["headers"]["Authorization"] == "Bearer xoxb-test" and call["json"]["channel"] == "C123"
    assert ("Acme", "2026-09") in asked and ("Beta", "2026-09") in asked, "each account's budget for its own month"
    assert ("Acme", "123-456-7890", "2026-09-01", "2026-09-26") in read, "the API is asked for the month so far"
    assert "Budget allocation\\n*\u20b92,000*" in json.dumps(call["json"], ensure_ascii=False)
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
    monkeypatch.setenv("GOOGLE_ADS_DIGEST_ACCOUNTS", "*")   # the test sheet's account is not on the real list
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


# ── Which accounts the digest covers ─────────────────────────────────────────
THE_TWELVE = ["AIHS", "Alphametic", "AllureAvani", "Basil woods school", "Core Care Clinic", "Madge Beauty",
              "July Mode", "Greet Technologies", "Artistic Yoga(BTA)", "Turquoise Institute", "City College", "KFI"]


def test_the_digest_covers_exactly_the_twelve_listed_accounts():
    assert d.DIGEST_ACCOUNTS == THE_TWELVE
    assert d.wanted_names("") == THE_TWELVE


def test_spelling_case_spacing_and_a_bracketed_tag_do_not_matter():
    sheet = ["aihs", "Allure Avani", "BASIL WOODS SCHOOL", "Artistic Yoga", "Artistic Yoga (BTA)", "K.F.I", "Other Client"]
    got, missing = d.pick_accounts(sheet, d.DIGEST_ACCOUNTS)
    assert got == ["aihs", "Allure Avani", "BASIL WOODS SCHOOL", "Artistic Yoga", "Artistic Yoga (BTA)", "K.F.I"]
    assert "Other Client" not in got
    assert "Alphametic" in missing and "AIHS" not in missing and "Artistic Yoga(BTA)" not in missing


def test_a_name_must_match_whole_not_part_of_another_account():
    got, missing = d.pick_accounts(["KFI Foods", "City College of Art", "Basil"], ["KFI", "City College", "Basil woods school"])
    assert got == [] and missing == ["KFI", "City College", "Basil woods school"]


def test_the_environment_can_replace_the_list_or_send_everything():
    assert d.wanted_names("Acme; Beta,\nGamma") == ["Acme", "Beta", "Gamma"]
    assert d.wanted_names("*") is None
    assert d.pick_accounts(["A", "B"], None) == (["A", "B"], [])


def test_only_the_listed_accounts_get_a_message_and_a_missing_one_is_reported(site, monkeypatch):
    rows = _week("AIHS", last=[("Generic - Search", 1000.0, 4.0)]) + _week("Not Listed") + _week("Core Care Clinic")
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: rows)
    monkeypatch.delenv("GOOGLE_ADS_DIGEST_ACCOUNTS")
    r = appmod.app.test_client().post("/api/dashboards/google-ads/slack-digest",
                                      headers={"Authorization": "Bearer s3cret"})
    body = r.get_json()
    assert r.status_code == 200 and body["counts"] == {"posted": 3, "not_found": 10}, body
    sent = json.dumps([c["json"] for c in site.calls])
    assert "AIHS" in sent and "Core Care Clinic" in sent and "Not Listed" not in sent
    assert "Alphametic" not in r.get_data(as_text=True), "the Action's log never sees account names"


def test_the_preview_names_the_listed_accounts_it_could_not_find(site, monkeypatch):
    monkeypatch.setenv("GOOGLE_ADS_DIGEST_ACCOUNTS", "Acme, Ghost Co")
    body = T._client().get("/api/dashboards/google-ads/slack-digest/preview").get_json()
    by = {r["account"]: r["status"] for r in body["results"]}
    assert by["Acme"] == "preview" and by["Ghost Co"] == "not_found"


def test_the_schedule_is_1pm_india_time_and_the_log_shows_no_figures():
    with open(os.path.join(ROOT, ".github", "workflows", "google-ads-slack-digest.yml")) as f:
        wf = f.read()
    assert "cron: '25 7 * * *'" in wf, "07:25 UTC = 12:55 IST, posting at about 13:00 after GitHub's usual delay"
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


def _posted_card(site, n=-1):
    """The picture a posted message shows: its address answers with a PNG, and the figures it was drawn from."""
    from urllib.parse import parse_qs, urlsplit
    blocks = site.calls[n]["json"]["attachments"][0]["blocks"]
    img = next(b for b in blocks if b["type"] == "image")
    url = urlsplit(img["image_url"])
    assert url.path.startswith("/api/dashboards/google-ads/slack-card/2026-09-26/")
    r = appmod.app.test_client().get(url.path + "?" + url.query)
    assert r.status_code == 200 and r.mimetype == "image/png" and r.data[:8] == b"\x89PNG\r\n\x1a\n"
    account = parse_qs(url.query)["a"][0]
    return json.loads(store.get_setting("slack_card:2026-09-26:" + account)["value"]), blocks


def test_each_account_is_posted_as_a_picture_of_the_client_report(site):
    c = appmod.app.test_client()
    c.post("/api/dashboards/google-ads/slack-digest", headers={"Authorization": "Bearer s3cret"}, base_url="http://web.example")
    data, blocks = _posted_card(site)
    assert data["account"] == "Acme" and data["span"] == "Sep 19 - Sep 26, 2026"
    assert [k for k, _ in data["kpis"]] == ["Impressions", "Clicks", "CTR", "Avg. CPC", "Cost", "Conversions",
                                            "Phone calls", "Cost / conv.", "Conv. rate"]
    assert [b["type"] for b in blocks] == ["image", "actions", "context"], "no alerts: picture, buttons, the note"
    assert site.calls[0]["json"]["blocks"][0]["text"]["text"] == "Acme"
    img = blocks[0]
    assert img["alt_text"].startswith("Acme: Sep 19 - Sep 26, 2026")
    path = img["image_url"].split("web.example")[1]
    assert c.get(path.replace("a=Acme", "a=Other")).status_code == 404, "signed for one account"
    assert c.get(path.replace("/2026-09-26/", "/2026-09-25/")).status_code == 404, "and one day"


def test_without_a_signing_token_the_figures_are_written_out(site, monkeypatch):
    monkeypatch.setattr(appmod, "_gads_chart_sig", lambda *a: "")
    appmod.app.test_client().post("/api/dashboards/google-ads/slack-digest", headers={"Authorization": "Bearer s3cret"})
    blocks = site.calls[0]["json"]["attachments"][0]["blocks"]
    assert not any(b["type"] == "image" for b in blocks) and blocks[1]["fields"][0]["text"].startswith("Impressions")


def test_the_card_reads_the_pacing_desk_and_needs_no_database(site, monkeypatch):
    from tracker import paid_pacing_budget_store as bstore
    c = appmod.app.test_client()
    monkeypatch.setattr(bstore, "list_month", lambda m: [{"client": "Acme", "account": "Acme", "allocated": 30000.0}])
    c.post("/api/dashboards/google-ads/slack-digest", headers={"Authorization": "Bearer s3cret"})
    assert _posted_card(site)[0]["budget"]["boxes"][0] == ["Budget allocation", "\u20b930,000"]

    def down(m):
        raise RuntimeError("no database")
    monkeypatch.setattr(bstore, "list_month", down)
    c.post("/api/dashboards/google-ads/slack-digest", json={"force": True}, headers={"Authorization": "Bearer s3cret"})
    assert _posted_card(site)[0]["budget"] is None


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


def test_the_posted_digest_reads_the_card_from_the_google_ads_api(site, monkeypatch):
    from tracker import paid_gads
    asked = []
    monkeypatch.setattr(paid_gads, "config_problem", lambda: None)
    monkeypatch.setattr(paid_gads, "list_accounts", lambda store: [{"id": "1234567890", "currency": "INR"}])

    def days(store, cid, start, end):
        asked.append((cid, start, end))
        names = [k for k, _ in paid_gads.BASE]
        nums = [0] * len(names)
        nums[names.index("phone_calls")], nums[names.index("cost_micros")] = 9, 777.0
        return {"days": [end], "rows": [[0, 0] + nums], "missing": []}
    monkeypatch.setattr(paid_gads, "campaign_days", days)
    appmod.app.test_client().post("/api/dashboards/google-ads/slack-digest", headers={"Authorization": "Bearer s3cret"})
    assert asked == [("1234567890", "2026-09-01", "2026-09-26")], "one read per account, the month so far"
    data = _posted_card(site, 0)[0]
    assert ["Phone calls", "9"] in data["kpis"] and ["Cost", "₹777"] in data["kpis"]
    assert data["note"].startswith("Google Ads API")

    monkeypatch.setattr(paid_gads, "campaign_days", lambda *a, **k: (_ for _ in ()).throw(paid_gads.AdsError("down")))
    appmod.app.test_client().post("/api/dashboards/google-ads/slack-digest", json={"force": True},
                                  headers={"Authorization": "Bearer s3cret"})
    assert "API could not be read" in _posted_card(site)[0]["note"], "a failed read falls back to the sheet"


def test_the_card_picture_shows_the_client_report():
    import io
    from PIL import Image
    from tracker import gads_digest_card as card
    data = card.card_data(_core_summary())
    assert data["span"] == "Oct 1 - Oct 15, 2026" and data["day"] == "Oct 15, 2026"
    assert data["kpis"][4] == ["Cost", "$1,730.27"] and data["day_values"][6] == ["Phone calls", "4"]
    b = data["budget"]
    assert b["boxes"] == [["Budget allocation", "$3,000.00"], ["Projected to Oct 15", "$1,451.61"],
                          ["Spent so far", "$1,730.27"], ["Overspent", "+$278.66"]]
    assert b["state"] == "over" and b["pace"] == "19% ahead of pace" and round(b["expected_share"], 3) == 0.484
    assert card.card_data(_core_summary(allocated=3600.0))["budget"]["pace"] == "On pace", "within 10%: on pace"
    assert card.card_data(_core_summary(allocated=5000.0))["budget"]["pace"] == "28% behind pace"
    img = Image.open(io.BytesIO(card.render(data)))
    assert img.format == "PNG" and img.size[0] == card.W * card.SCALE
    without = Image.open(io.BytesIO(card.render(dict(data, budget=None))))
    assert without.size[1] < img.size[1], "no budget: a line, not four empty boxes"
    assert json.loads(json.dumps(data)) == data, "what is stored is plain JSON"


def test_staff_can_see_every_card_on_one_page_without_posting(site):
    assert appmod.app.test_client().get("/api/dashboards/google-ads/slack-digest/preview/cards").status_code in (302, 401, 403)
    r = T._client().get("/api/dashboards/google-ads/slack-digest/preview/cards")
    page = r.get_data(as_text=True)
    assert r.status_code == 200 and "<h2>Acme</h2>" in page and site.calls == [], "nothing is posted"
    src = page.split('<img src="')[1].split('"')[0].replace("&amp;", "&")
    path = "/" + src.split("://", 1)[1].split("/", 1)[1]
    got = appmod.app.test_client().get(path)
    assert got.status_code == 200 and got.mimetype == "image/png", "the picture Slack would fetch"


def test_the_page_of_cards_heads_each_account_by_the_name_the_team_uses(site, monkeypatch):
    rows = []
    for a in ("AA_New", "JulyMode x 2025", "BTay", "Krishnamurti Foundation India"):
        rows += _week(a, last=[("Generic - Search", 1000.0, 4.0)])
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: rows)
    monkeypatch.delenv("GOOGLE_ADS_DIGEST_ACCOUNTS")
    page = T._client().get("/api/dashboards/google-ads/slack-digest/preview/cards").get_data(as_text=True)
    for shown in ("AllureAvani", "July Mode", "Artistic Yoga (BTA)", "KFI"):
        assert "<h2>%s</h2>" % shown in page
    for real in ("AA_New", "JulyMode x 2025", "BTay", "Krishnamurti Foundation India"):
        assert "<h2>%s</h2>" % real not in page
    one = T._client().get("/api/dashboards/google-ads/slack-digest/preview/cards?account=AllureAvani")
    assert "<h2>AllureAvani</h2>" in one.get_data(as_text=True) and "<h2>KFI</h2>" not in one.get_data(as_text=True)


# ── Names and the day reported ───────────────────────────────────────────────
def test_accounts_go_by_the_names_the_team_uses():
    sheet = ["AA_New", "JulyMode x 2025", "BTay", "Krishnamurti Foundation India", "Core Care Clinic", "KFI Foods"]
    chosen, missing = d.pick_accounts(sheet, d.wanted_names(""))
    assert chosen == ["AA_New", "JulyMode x 2025", "BTay", "Krishnamurti Foundation India", "Core Care Clinic"]
    assert "AllureAvani" not in missing and "July Mode" not in missing and "KFI" not in missing
    assert "Artistic Yoga(BTA)" not in missing
    assert [d.display_name(a) for a in sheet] == ["AllureAvani", "July Mode", "Artistic Yoga (BTA)", "KFI",
                                                  "Core Care Clinic", "KFI Foods"]
    rows = [dict(_row("AA_New", "S", "2026-09-%02d" % n, 1000.0, 4.0)) for n in range(19, 27)]
    s = d.summarize(rows, "AA_New", today=TODAY)
    msg = d.message(s)
    assert msg["blocks"][0]["text"]["text"] == "AllureAvani" and msg["text"].startswith("AllureAvani:")
    from tracker import gads_digest_card as card
    assert card.card_data(s)["account"] == "AllureAvani"


def test_the_pacing_desk_budget_is_found_under_either_name():
    rows = [dict(_row("AA_New", "S", "2026-09-%02d" % n, 1000.0, 4.0)) for n in range(19, 27)]
    asked = []
    out = d.run(rows, ["AA_New"], today=TODAY, dry_run=True,
                allocation=lambda a, m: asked.append(a) or (30000.0 if a == "AllureAvani" else None))
    assert asked == ["AllureAvani"] and out[0]["message"]
    assert "\u20b930,000" in json.dumps(out[0]["message"], ensure_ascii=False)


def test_the_report_is_always_for_yesterday_in_india():
    # Sent on 20 Oct: the latest day is 19 Oct and the month runs from 1 Oct, even if the sheet has 20 Oct already
    # or has not reached 19 Oct yet.
    today = dt.date(2026, 10, 20)
    ahead = [dict(_row("Acme", "S", "2026-10-%02d" % n, 100.0, 1.0)) for n in range(1, 21)]
    out = d.run(ahead, ["Acme"], today=today, dry_run=True)
    assert out[0]["day"] == "2026-10-19"
    assert "Oct 1 - Oct 19, 2026" in json.dumps(out[0]["message"]) and "Oct 20" not in json.dumps(out[0]["message"])
    s = d.summarize(ahead, "Acme", today=today, day="2026-10-19")
    assert s["mtd"]["cost"] == 1900.0 and s["now"]["cost"] == 100.0

    behind = [dict(_row("Acme", "S", "2026-10-%02d" % n, 100.0, 1.0)) for n in range(1, 19)]
    s = d.summarize(behind, "Acme", today=today, day="2026-10-19")
    assert s["day"] == "2026-10-19" and s["now"]["cost"] == 0 and s["day_missing"]
    assert not any("Spent nothing" in t or "No conversions" in t for t in s["alerts"]), \
        "a sheet a day behind is not a day of nothing"
    api = {"mtd": {"impressions": 1900, "clicks": 190, "cost": 1900.0, "conversions": 19.0, "phone_calls": 3.0},
           "day": {"impressions": 100, "clicks": 10, "cost": 100.0, "conversions": 1.0, "phone_calls": 0.0},
           "currency": "INR"}
    s = d.summarize(behind, "Acme", today=today, day="2026-10-19", api=api)
    assert s["now"]["cost"] == 100.0 and not s["day_missing"] and s["alerts"] == [], "the API has the day"

    first = d.run(ahead, ["Acme"], today=dt.date(2026, 11, 1), dry_run=True)
    assert first[0]["day"] == "2026-10-31" and "Oct 1 - Oct 31, 2026" in json.dumps(first[0]["message"]), \
        "on the 1st, the whole of last month"


def test_the_picture_has_no_status_label():
    from tracker import gads_digest_card as card
    data = card.card_data(_core_summary())
    assert "status" not in data
    assert card.render(data)[:8] == b"\x89PNG\r\n\x1a\n"
