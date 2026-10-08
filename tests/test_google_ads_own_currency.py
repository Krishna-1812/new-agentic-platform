"""The Google Ads dashboards show money in each account's own currency, as Google Ads does.

The campaign report carries every campaign-day's cost twice: in the account's currency ("Cost",
"Currency code") and converted into the manager account's ("Cost (Converted currency)"). The pages
open on the first (one currency's accounts at a time, since amounts in different currencies cannot
be added up) and offer "all converted to INR" as an option. Covers the server's rules (app.py,
_google_ads_money and _google_ads_insights), the insights' currency filter, the account cards, and
the page itself in a real browser.
"""

import json
import os
import sys
import threading

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import app as appmod  # noqa: E402
from tracker import client_accounts  # noqa: E402
from tracker import google_ads_insights as gai  # noqa: E402


def _row(account, day, native, cur, converted, campaign="C", type_="Search", clicks=10.0, conv=1.0, to="INR"):
    return {"account": account, "customer_id": "1", "campaign": campaign, "state": "Enabled", "type": type_,
            "day": day, "clicks": clicks, "impressions": clicks * 10, "cost": converted, "currency": to,
            "conversions": conv, "view_through": 0.0, "top_pct": 0.0, "abs_top_pct": 0.0,
            "cost_native": native, "currency_native": cur}


# Two accounts in dollars, one in rupees, one in pounds; the dollars carry the most spend.
ROWS = [
    _row("US One", "2026-09-20", 100.0, "USD", 8300.0),
    _row("US One", "2026-09-21", 120.0, "USD", 9960.0),
    _row("US Two", "2026-09-21", 50.0, "USD", 4150.0, campaign="D"),
    _row("India Co", "2026-09-21", 5000.0, "INR", 5000.0),
    _row("UK Ltd", "2026-09-21", 40.0, "GBP", 4400.0),
]


# ── What the page can show ───────────────────────────────────────────────────
def test_currencies_are_listed_by_spend_and_the_page_opens_on_the_biggest():
    m = appmod._google_ads_money(ROWS)
    assert m["currencies"] == ["USD", "INR", "GBP"], "compared after conversion: 22,410 > 5,000 > 4,400"
    assert m["default"] == "USD" and m["to"] == "INR"
    assert m["accounts"] == {"US One": "USD", "US Two": "USD", "India Co": "INR", "UK Ltd": "GBP"}
    assert m["symbols"] == {"USD": "$", "INR": "₹", "GBP": "£"}


def test_there_is_nothing_to_convert_when_every_account_is_already_in_rupees():
    m = appmod._google_ads_money([_row("India Co", "2026-09-21", 5000.0, "INR", 5000.0)])
    assert m["currencies"] == ["INR"] and m["to"] == ""


def test_without_the_converted_columns_there_is_no_conversion_to_offer():
    rows = [dict(_row("US One", "2026-09-21", 100.0, "USD", 100.0), currency="USD"),
            dict(_row("India Co", "2026-09-21", 5000.0, "INR", 5000.0), currency="INR")]
    m = appmod._google_ads_money(rows)
    assert m["to"] == "" and set(m["currencies"]) == {"USD", "INR"}


def test_a_report_without_the_currency_code_column_still_has_one_currency():
    rows = [dict(_row("A", "2026-09-21", 0.0, "", 100.0), cost_native=100.0, currency_native="")]
    m = appmod._google_ads_money(rows)
    assert m["currencies"] == ["INR"] and m["to"] == ""
    assert appmod._google_ads_own_rows(rows) == rows, "nothing to swap in"


def test_own_rows_carry_the_accounts_own_cost_and_currency():
    own = appmod._google_ads_own_rows(ROWS)
    assert [(r["cost"], r["currency"]) for r in own] == [(100.0, "USD"), (120.0, "USD"), (50.0, "USD"),
                                                         (5000.0, "INR"), (40.0, "GBP")]
    assert ROWS[0]["cost"] == 8300.0, "the rows the page embeds are left as they are"


def test_the_opening_symbol_is_the_default_currencys():
    assert appmod._google_ads_currency_symbol(ROWS) == "$"


# ── The insights follow the same choice ──────────────────────────────────────
@pytest.fixture
def captured(monkeypatch):
    seen = {}

    def fetch(svc, sheet_id, **kw):
        seen.clear()
        seen.update(kw)
        return dict(gai.empty(), ok=True, params={"currency": kw.get("currency", "")}, currencies=[])
    monkeypatch.setattr(appmod, "GOOGLE_ADS_SHEET_ID", "fake-sheet-id")
    monkeypatch.setattr(gai, "fetch", fetch)
    return seen


def test_by_default_the_insights_show_the_biggest_currencys_accounts_unconverted(captured):
    ins = appmod._google_ads_insights(ROWS)
    assert captured["currency"] == "USD" and captured["money"] == "own"
    assert captured["fx"].to == "USD" and captured["fx"].rates == {}, "nothing is converted"
    assert captured["spend"].cur == "USD" and len(captured["spend"].rows) == 3, "the USD accounts' own spend"
    assert sum(r[4] for r in captured["spend"].rows) == 270.0
    assert ins["money"] == "own" and ins["params"]["money"] == "own"


def test_the_insights_show_the_currency_asked_for(captured):
    appmod._google_ads_insights(ROWS, currency="GBP")
    assert captured["currency"] == "GBP" and captured["fx"].to == "GBP"
    assert [r[0] for r in captured["spend"].rows] == ["UK Ltd"]
    appmod._google_ads_insights(ROWS, currency="JPY")
    assert captured["currency"] == "USD", "a currency no account is billed in falls back to the default"


def test_converted_insights_use_googles_rates_into_rupees(captured):
    ins = appmod._google_ads_insights(ROWS, money="fx")
    assert captured["money"] == "fx" and captured["currency"] == ""
    assert captured["fx"].to == "INR" and captured["fx"].rate("US One", "2026-09-20") == pytest.approx(83.0)
    assert ins["money"] == "fx"


def test_converting_falls_back_to_own_currency_when_the_report_cannot(captured):
    rows = [dict(r, currency=r["currency_native"], cost=r["cost_native"]) for r in ROWS]
    ins = appmod._google_ads_insights(rows, money="fx")
    assert ins["money"] == "own" and captured["currency"] in ("USD", "INR", "GBP")
    assert captured["fx"].to == captured["currency"]


def _devices():
    cell = json.dumps({"v": 1, "from": "2026-09-10", "d": [[0, 100, 10, 10.0, 1, 20.0]]})
    head = ["Account", "Currency", "Campaign", "Device", "Date range", "Daily"]
    return {"devices": [head, ["US", "USD", "C", "MOBILE", "2026-09-10 to 2026-09-10", cell],
                        ["IN", "INR", "C", "MOBILE", "2026-09-10 to 2026-09-10", cell]]}


def test_the_view_keeps_only_the_accounts_billed_in_the_currency():
    raw = _devices()
    ins = gai.build(raw, currency="USD", fx=gai.FX([_row("US", "2026-09-10", 10.0, "USD", 10.0, to="USD")]))
    assert [(d["account"], d["cur"], d["cost"]) for d in ins["devices"]] == [("US", "USD", 10.0)]
    assert ins["fx"] == {"to": "USD", "converted": {}, "kept": {}}
    assert ins["params"]["currency"] == "USD"
    assert {d["account"] for d in gai.build(raw)["devices"]} == {"US", "IN"}, "no currency: every account"


def test_each_money_choice_is_cached_on_its_own(monkeypatch):
    st = gai.load(_devices())
    monkeypatch.setattr(gai, "store", lambda *a, **k: st)
    gai.reset()
    own = gai.fetch(None, "s", money="own", fx=gai.FX(), currency="USD")
    fx = gai.fetch(None, "s", money="fx", fx=gai.FX(), currency="")
    assert own is not fx and own["params"]["currency"] == "USD"
    gai.reset()


# ── The account cards ────────────────────────────────────────────────────────
def test_an_account_card_is_in_the_currency_its_ads_account_is_billed_in():
    st = client_accounts.stats(ROWS, ["US One", "US Two"])
    assert st["currency"] == "USD" and st["cost"] == 270.0
    assert client_accounts.money(st["cost"], st["currency"]) == "$270"


def test_an_account_billed_in_two_currencies_falls_back_to_the_converted_figures():
    st = client_accounts.stats(ROWS, ["US One", "UK Ltd"])
    assert st["currency"] == "INR" and st["cost"] == 8300.0 + 9960.0 + 4400.0


# ── The page in a real browser ───────────────────────────────────────────────
@pytest.fixture(scope="module")
def browser():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        pytest.skip("Playwright is not installed")
    pw = sync_playwright().start()
    b = None
    # Playwright's own build, else the Chromium installed beside it (a pinned Playwright whose
    # headless shell is not the one installed).
    for kw in ({}, {"executable_path": "/opt/pw-browsers/chromium"}):
        try:
            b = pw.chromium.launch(headless=True, **kw)
            break
        except Exception as exc:
            err = exc
    if b is None:
        pw.stop()
        pytest.skip("Chromium cannot start here: %s" % str(err)[:80])
    yield b
    b.close()
    pw.stop()


@pytest.fixture
def page_url(monkeypatch):
    from werkzeug.serving import make_server
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: [dict(r) for r in ROWS])
    monkeypatch.setattr(appmod, "_google_ads_insights", lambda *a, **k: gai.empty())
    client = appmod.app.test_client()
    with client.session_transaction() as sess:
        sess["google_user"] = {"email": "reporting@markifydigital.com", "name": "T"}
    cookie = client.get_cookie(appmod.app.config.get("SESSION_COOKIE_NAME", "session"))
    srv = make_server("127.0.0.1", 0, appmod.app, threaded=True)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield "http://127.0.0.1:%d" % srv.server_port, cookie
    srv.shutdown()


def _open(browser, page_url, query=""):
    base, cookie = page_url
    ctx = browser.new_context(reduced_motion="reduce")
    ctx.add_cookies([{"name": cookie.key, "value": cookie.value, "url": base}])
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base + "/dashboards/google-ads" + query)
    page.wait_for_selector("#gad-money-select")
    return page, errors


def _spend(page):
    return page.eval_on_selector('[data-kpi="cost"] [data-v]', "e => e.getAttribute('data-text')")


def test_the_page_opens_in_dollars_and_converts_on_request(browser, page_url):
    page, errors = _open(browser, page_url)
    assert _spend(page) == "$270", "the USD accounts, in dollars"
    opts = page.eval_on_selector_all("#gad-money-select option", "os => os.map(o => [o.value, o.textContent])")
    assert opts == [["own:USD", "USD accounts (2)"], ["own:INR", "INR accounts (1)"], ["own:GBP", "GBP accounts (1)"],
                    ["fx", "All converted to INR"]]
    assert "USD accounts only" in page.inner_text("#gad-hero-sub")
    ticker = page.inner_text("#gad-tick-track")
    assert "$220" in ticker and "£40" in ticker and "₹5,000" in ticker, "every account in its own currency"

    page.select_option("#gad-money-select", "own:GBP")
    assert _spend(page) == "£40"
    page.select_option("#gad-money-select", "fx")
    assert _spend(page) == "₹31,810", "every account added up in rupees"
    assert "converted to INR" in page.inner_text("#gad-hero-sub")
    page.reload()
    page.wait_for_selector("#gad-money-select")
    assert _spend(page) == "₹31,810", "the choice is remembered for this viewer"
    page.select_option("#gad-money-select", "own:USD")
    assert _spend(page) == "$270"
    assert errors == []
    page.context.close()


def test_choosing_an_account_shows_it_in_its_own_currency(browser, page_url):
    page, errors = _open(browser, page_url)
    page.select_option("#gad-account-select", "India Co")
    assert _spend(page) == "₹5,000"
    assert page.input_value("#gad-money-select") == "own:INR"
    assert "in INR" in page.inner_text("#gad-hero-sub")
    page.select_option("#gad-account-select", "UK Ltd")
    assert _spend(page) == "£40"
    page.context.close()
    page, errors2 = _open(browser, page_url, "?account=US%20Two")
    assert _spend(page) == "$50", "the Slack digest's links open the account in its currency"
    assert errors == [] and errors2 == []
    page.context.close()
