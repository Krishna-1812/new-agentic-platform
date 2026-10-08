"""The AI review and the daily Slack digest report each account in its own currency, as the
dashboards do: the currency Google Ads bills it in ("Cost", "Currency code"), not the campaign
report's converted INR. Only an account whose rows carry no currency code, or more than one,
keeps the converted figures."""

import datetime as dt

import pytest

from tests import test_google_ads_ai as A
from tracker import gads_ai as ai
from tracker import gads_digest as d
from tracker import google_ads_insights as g

TODAY = dt.date(2026, 9, 27)


def _row(account, day, native, cur, converted, campaign="Generic - Search", conv=1.0):
    return {"account": account, "customer_id": "1", "campaign": campaign, "state": "Enabled", "type": "Search",
            "day": day, "cost": converted, "currency": "INR", "clicks": 10.0, "impressions": 100.0,
            "conversions": conv, "cost_native": native, "currency_native": cur}


def _week(account, native, cur, rate):
    return [_row(account, "2026-09-%02d" % n, native, cur, native * rate) for n in range(19, 27)]


# ── Slack digest ─────────────────────────────────────────────────────────────
def test_the_digest_reports_a_dollar_account_in_dollars():
    s = d.summarize(_week("US Co", 100.0, "USD", 83.0), "US Co", today=TODAY)
    assert s["cur"] == "USD" and s["now"]["cost"] == 100.0 and s["top"][0]["cost"] == 100.0
    assert d.money(s["now"]["cost"], s["cur"]) == "$100"


def test_the_digest_keeps_converted_figures_without_a_currency_code():
    rows = [dict(r, currency_native="") for r in _week("Old Co", 100.0, "USD", 83.0)]
    s = d.summarize(rows, "Old Co", today=TODAY)
    assert s["cur"] == "INR" and s["now"]["cost"] == 8300.0


def test_the_overview_gives_one_total_per_currency_and_never_adds_them():
    rows = _week("US Co", 100.0, "USD", 83.0) + _week("India Co", 5000.0, "INR", 1.0) + \
        _week("US Two", 50.0, "USD", 83.0)
    ss = [d.summarize(rows, a, today=TODAY) for a in ("US Co", "India Co", "US Two")]
    text = str(d.overview(ss, today=TODAY))
    assert "Total spend by currency" in text and "$150" in text and "₹5,000" in text
    assert "Total spend\\n" not in text
    one = str(d.overview(ss[:1], today=TODAY))
    assert "Total spend\\n*$100*" in one and "by currency" not in one


# ── AI review ────────────────────────────────────────────────────────────────
def test_the_review_reads_an_account_in_the_currency_it_is_billed_in():
    rows = _week("US Co", 100.0, "USD", 83.0) + _week("India Co", 5000.0, "INR", 1.0)
    fx, spend, own = ai._own_money(g, rows, "US Co", g.FX(rows), g.Spend(rows))
    assert own and fx.to == "USD" and fx.rates == {} and spend.cur == "USD"
    assert spend.total("2026-09-19", "2026-09-26", lambda x: x["account"] == "US Co") == 800.0
    fx2, _, own2 = ai._own_money(g, [dict(r, currency_native="") for r in rows], "US Co", g.FX(rows), None)
    assert not own2 and fx2.to == "INR", "no currency code: the converted figures, unchanged"


def test_the_pack_says_its_money_is_the_accounts_own():
    st = A._state()
    pack = ai.build_pack(g, st, A.ACCOUNT, A.REPORT_ROWS, g.FX(A.REPORT_ROWS), g.Spend(A.REPORT_ROWS))
    assert pack["currency"] == "INR"
    assert pack["data_notes"][0] == "Money is in INR, the currency the account is billed in, as Google Ads shows it."


def test_a_rupee_target_is_converted_into_a_dollar_accounts_own_currency():
    rows = [dict(A.REPORT_ROWS[0], cost=830.0, cost_native=10.0, currency_native="USD")]
    pack = {"currency": "USD", "campaigns": [{"campaign": "C", "last_30_days": ai._perf({"cost": 300, "conv": 30}),
                                              "daily_budget": 10, "shared_budget": False}],
            "budgets_this_month": [], "locations": {"costliest": [], "total": None}}
    t = {"targets": [{"metric": "cpa", "scope": "account", "comparison": "at_most", "value": 830, "currency": "INR",
                      "items": [], "description": "CPA under 830 rupees", "quote": "q"}]}
    c = ai.compute_checks(t, pack, g.FX(rows), A.ACCOUNT)[0]
    assert c["status"] == "met", "CPA $10 against 830 / 83 = $10"
    assert "converted at Google's latest rate" in c["actual"]
