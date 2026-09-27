"""Google Ads dashboard: the insights tabs (impression share, budget pacing,
search terms) -- the Google Ads Script that writes them, the reader that
shapes them, and the page that shows them.

The script is run under Node against fake AdsApp / SpreadsheetApp objects
(tests/google_ads_script_harness.js); the reader against a fake Sheets API;
nothing here calls Google."""

import json
import os
import shutil
import subprocess
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import app as appmod  # noqa: E402
from tracker import google_ads_insights as gai  # noqa: E402

NODE = shutil.which("node")


def _harness(*args):
    out = subprocess.run([NODE, os.path.join(ROOT, "tests", "google_ads_script_harness.js")] + list(args),
                         capture_output=True, text=True, timeout=60, check=True)
    return json.loads(out.stdout)


# ── The Google Ads Script ────────────────────────────────────────────────────

@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_the_script_writes_its_tabs_after_the_campaign_report():
    res = _harness()
    assert res["order"][0] == "Campaign report", "the report the dashboard already reads stays first"
    assert res["order"][1:] == [gai.TABS[k] for k in ("is", "weekly", "budgets", "terms", "about")]


@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_the_script_keeps_googles_share_limits_and_reads_money_from_micros():
    tabs = _harness()["tabs"]
    ins = gai.build({"is": tabs[gai.TABS["is"]], "weekly": tabs[gai.TABS["weekly"]],
                     "budgets": tabs[gai.TABS["budgets"]], "terms": tabs[gai.TABS["terms"]],
                     "about": tabs[gai.TABS["about"]]})
    generic = next(r for r in ins["is"] if r["campaign"] == "Generic - Search")
    assert generic["is"] == 0.0999 and generic["lb"] == 0.9001, "Google's <10% and >90% markers are kept"
    assert generic["cost"] == 120000.0
    pmax = next(r for r in ins["is"] if r["campaign"] == "PMax - All")
    assert pmax["is"] is None, "no search share for Performance Max: unknown, not zero"
    assert [w["campaign"] for w in ins["weekly"]] == ["Brand - Search"], "non-search campaigns are left out"
    camps = {c["campaign"]: c for c in ins["budget_campaigns"]}
    assert camps["Generic - Search"]["tcpa"] == 2500.0 and camps["PMax - All"]["troas"] == 4.5
    shared = next(b for b in ins["budgets"] if b["name"] == "Shared generic")
    assert shared["shared"] and sorted(shared["campaigns"]) == ["Generic - Search", "PMax - All"]
    assert shared["recommended"] == 8000.0
    term = next(r for r in ins["terms"]["rows"] if r[3] == "free crm software")
    assert term[5] == "crm software" and term[4] == "BROAD" and term[10] == 5400.0
    assert ins["as_of"].startswith("2026-09-27")


@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_in_a_manager_account_the_busiest_accounts_are_exported():
    tabs = _harness("manager")["tabs"]
    accounts = {r[0] for r in tabs[gai.TABS["budgets"]][1:]}
    assert accounts == {"Beta"}, "with the limit at one account, the one that spent most is chosen"


def test_the_script_uses_no_deprecated_account_filters():
    with open(os.path.join(ROOT, "scripts", "google_ads", "export_insights.js"), encoding="utf-8") as fh:
        src = fh.read()
    assert ".forDateRange(" not in src, "account selectors can no longer filter by performance"
    assert "PASTE_THE_GOOGLE_ADS_SHEET_URL_HERE" in src, "the sheet is set by whoever installs it, never committed"


# ── Reading the tabs ─────────────────────────────────────────────────────────

IS_HEAD = ["Account", "Currency", "Campaign ID", "Campaign", "Channel", "Impressions", "Clicks", "Cost",
           "Search IS", "Search lost IS (budget)", "Search lost IS (rank)", "Search click share"]


def test_blank_shares_are_unknown_and_formatted_cells_are_read():
    ins = gai.build({"is": [IS_HEAD,
                            ["A", "INR", "1", "Search one", "SEARCH", "1,000", "50", "2,500.50", "45%", "0.3", "", ""],
                            ["A", "INR", "2", "", "SEARCH", 1, 1, 1, "", "", "", ""]]})
    assert len(ins["is"]) == 1, "a row with no campaign is skipped"
    r = ins["is"][0]
    assert r["impr"] == 1000 and r["cost"] == 2500.5 and r["is"] == 0.45 and r["lb"] == 0.3
    assert r["lr"] is None and r["click"] is None


def _budget_row(**kw):
    base = {"Account": "A", "Currency": "INR", "Campaign ID": "1", "Campaign": "C1", "Budget ID": "9",
            "Budget name": "B", "Shared budget": False, "Daily budget": 1000, "Cost this month": 0,
            "Cost last 7 days": 7000, "Day of month": 16, "Days in month": 30, "Month elapsed (days)": 15.0}
    base.update(kw)
    return base


def _budgets(*rows):
    head = list(rows[0].keys())
    return gai.parse_budgets([head] + [[r.get(h, "") for h in head] for r in rows])[1]


def test_pacing_expected_projection_and_verdicts():
    on = _budgets(_budget_row(**{"Cost this month": 15000}))[0]
    assert on["expected"] == 15000 and on["pace"] == 1.0 and on["verdict"] == "on_track"
    assert on["projected"] == 15000 + 1000 * 15, "spend so far + the last 7 days' daily average for the rest"
    assert on["monthly_cap"] == 30400 and on["month_budget"] == 30000
    over = _budgets(_budget_row(**{"Cost this month": 18000, "Cost last 7 days": 5600}))[0]
    assert over["projected"] == 18000 + 800 * 15 and over["verdict"] == "over", "ahead, but under the monthly limit"
    ahead_and_capped = _budgets(_budget_row(**{"Cost this month": 18000}))[0]
    assert ahead_and_capped["verdict"] == "capped", "33,000 projected is past the 30,400 limit"
    under = _budgets(_budget_row(**{"Cost this month": 9000, "Cost last 7 days": 4200}))[0]
    assert under["verdict"] == "under"
    capped = _budgets(_budget_row(**{"Cost this month": 25000, "Cost last 7 days": 14000}))[0]
    assert capped["projected"] == 25000 + 2000 * 15 and capped["verdict"] == "capped"
    none = _budgets(_budget_row(**{"Daily budget": ""}))[0]
    assert none["verdict"] == "unknown"


def test_a_shared_budget_adds_up_its_campaigns():
    b = _budgets(_budget_row(**{"Shared budget": "TRUE", "Cost this month": 6000}),
                 _budget_row(**{"Campaign ID": "2", "Campaign": "C2", "Shared budget": "TRUE",
                                "Cost this month": 9000}))
    assert len(b) == 1 and b[0]["mtd"] == 15000 and b[0]["campaigns"] == ["C1", "C2"] and b[0]["shared"]


TERMS_HEAD = ["Account", "Currency", "Campaign", "Ad group", "Search term", "Search term match", "Keyword",
              "Status", "Impressions", "Clicks", "Cost", "Conversions"]


def test_search_terms_totals_cover_every_term_and_the_page_gets_the_costliest():
    rows = [TERMS_HEAD]
    for i in range(30):
        rows.append(["A" if i % 2 else "B", "INR", "C", "G", "term %d" % i, "BROAD", "kw", "NONE",
                     10, 2, float(i), 1 if i % 3 == 0 else 0])
    t = gai.parse_terms(rows, per_account=5, on_page=8)
    assert t["read"] == 30 and t["totals"]["__all__"]["terms"] == 30
    assert t["totals"]["__all__"]["cost"] == float(sum(range(30)))
    assert t["totals"]["__all__"]["wasted"] == float(sum(i for i in range(30) if i % 3 and i))
    assert t["totals"]["__all__"]["converting"] == 10
    assert len(t["rows"]) == 8 and t["rows"][0][3] == "term 29", "most expensive first"
    per = {}
    for r in t["rows"]:
        per[r[0]] = per.get(r[0], 0) + 1
    assert max(per.values()) <= 5, "no account crowds out the others"


class _Exec:
    def __init__(self, v):
        self.v = v

    def execute(self):
        return self.v


class _Values:
    def __init__(self, tabs, calls):
        self.tabs, self.calls = tabs, calls

    def batchGet(self, spreadsheetId, ranges, valueRenderOption, dateTimeRenderOption):  # noqa: N802,N803
        self.calls.append(ranges)
        return _Exec({"valueRanges": [{"values": self.tabs[r.split("'")[1]]} for r in ranges]})


class _Sheets:
    def __init__(self, tabs, calls):
        self.tabs, self.calls = tabs, calls

    def values(self):
        return _Values(self.tabs, self.calls)

    def get(self, spreadsheetId):  # noqa: N803
        return _Exec({"sheets": [{"properties": {"title": t}} for t in ["Report"] + list(self.tabs)]})


class _Svc:
    def __init__(self, tabs, calls):
        self.s = _Sheets(tabs, calls)

    def spreadsheets(self):
        return self.s


def test_only_tabs_that_exist_are_read_in_one_batch_and_cached():
    gai.reset()
    calls = []
    tabs = {gai.TABS["is"]: [IS_HEAD, ["A", "INR", "1", "S", "SEARCH", 10, 1, 5, 0.5, 0.2, 0.3, ""]]}
    ins = gai.fetch(lambda: _Svc(tabs, calls), "SHEET")
    assert ins["ok"] and len(ins["is"]) == 1 and ins["budgets"] == [] and ins["currencies"] == ["INR"]
    assert calls == [["'%s'!A:AZ" % gai.TABS["is"]]]
    gai.fetch(lambda: _Svc(tabs, calls), "SHEET")
    assert len(calls) == 1, "cached"
    gai.reset()


def test_a_failed_read_is_empty_never_an_error():
    gai.reset()

    def boom():
        raise RuntimeError("no credentials")
    ins = gai.fetch(boom, "SHEET")
    assert ins["ok"] is False and ins["error"] == "RuntimeError"
    gai.reset()


# ── The page ─────────────────────────────────────────────────────────────────

ROWS = [{"account": "A", "customer_id": "1", "campaign": "S", "state": "Enabled", "type": "Search",
         "day": "2026-09-20", "clicks": 1.0, "impressions": 10.0, "cost": 5.0, "currency": "INR",
         "conversions": 1.0, "view_through": 0.0, "top_pct": 0.0, "abs_top_pct": 0.0}]


def _client():
    c = appmod.app.test_client()
    with c.session_transaction() as sess:
        sess["google_user"] = {"email": "reporting@markifydigital.com", "name": "T"}
    return c


def test_the_page_shows_the_insights_panels_when_the_tabs_exist(monkeypatch):
    tabs = {gai.TABS["is"]: [IS_HEAD, ["A", "INR", "1", "S", "SEARCH", 10, 1, 5, 0.5, 0.2, 0.3, ""]]}
    ins = gai.build({"is": tabs[gai.TABS["is"]]})
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: ROWS)
    monkeypatch.setattr(appmod, "_google_ads_insights", lambda force=False: dict(ins, symbols={"INR": "₹"}))
    body = _client().get("/dashboards/google-ads").get_data(as_text=True)
    for pid in ("gai-share-panel", "gai-pace-panel", "gai-terms-panel", "gad-insights"):
        assert 'id="%s"' % pid in body
    assert "google-ads-insights.js" in body
    assert body.index("google-ads-insights.js") < body.index("google-ads-dashboard.js"), \
        "the panels listen before the page's first render"


def test_without_the_tabs_the_page_explains_how_to_switch_them_on(monkeypatch):
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: ROWS)
    monkeypatch.setattr(appmod, "_google_ads_insights", lambda force=False: dict(gai.empty(), symbols={}))
    body = _client().get("/dashboards/google-ads").get_data(as_text=True)
    assert "scripts/google_ads/export_insights.js" in body
    assert 'id="gai-share-panel"' not in body and "google-ads-insights.js" not in body


def test_the_campaign_report_is_the_first_tab_that_is_not_an_insights_tab(monkeypatch):
    class Values:
        def get(self, spreadsheetId, range):  # noqa: A002,N803
            assert range == "'Campaign report'!A:Z"
            return _Exec({"values": [["Account name", "Campaign", "Day", "Clicks"], ["A", "S", "2026-09-20", "3"]]})

    class Sheets:
        def get(self, spreadsheetId):  # noqa: N803
            return _Exec({"sheets": [{"properties": {"title": gai.TABS["about"]}},
                                     {"properties": {"title": "Campaign report"}}]})

        def values(self):
            return Values()

    class Svc:
        def spreadsheets(self):
            return Sheets()
    monkeypatch.setattr(appmod, "GOOGLE_ADS_SHEET_ID", "SHEET")
    monkeypatch.setattr(appmod, "_ads_sheet_service", lambda: Svc())
    rows = appmod._fetch_google_ads_rows(force=True)
    assert rows and rows[0]["campaign"] == "S"


def test_the_panels_script_inserts_text_never_markup():
    with open(os.path.join(ROOT, "static", "js", "google-ads-insights.js"), encoding="utf-8") as fh:
        js = fh.read()
    assert "innerHTML" not in js and "insertAdjacentHTML" not in js and "outerHTML" not in js
    assert "eval(" not in js and "document.write" not in js
