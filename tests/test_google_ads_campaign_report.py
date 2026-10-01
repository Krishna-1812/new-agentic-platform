"""scripts/google_ads/export_campaign_report.js, run against fakes (tests/google_ads_report_harness.js),
and what it writes read back by the dashboard's own campaign-report reader."""
import json
import os
import shutil
import subprocess

import pytest

from tests import test_google_ads_insights as T

appmod = T.appmod
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(not NODE, reason="node is not installed")


def _run(*args):
    out = subprocess.run([NODE, os.path.join(T.ROOT, "tests", "google_ads_report_harness.js")] + list(args),
                         capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def _shown(res):
    """The sheet as the dashboard reads it (formatted values, as the Sheets API returns them)."""
    fmt = {int(c): f["f"] for c, f in res["formats"].items()}
    rows = []
    for i, row in enumerate(res["grid"]):
        if i < 3:
            rows.append([str(v) for v in row])
            continue
        cells = []
        for j, v in enumerate(row):
            f = fmt.get(j + 1)
            if f == "0.00%":
                cells.append("%.2f%%" % (v * 100))
            elif f == "0.00":
                cells.append("%.2f" % v)
            elif f == "0":
                cells.append(str(int(v)))
            else:
                cells.append(str(v))
        rows.append(cells)
    return rows


def _read_back(monkeypatch, res):
    values = _shown(res)

    class Svc:
        def spreadsheets(self):
            return self

        def values(self):
            return self

        def get(self, **kw):
            self.kw = kw
            return self

        def execute(self):
            if "range" in self.kw:
                return {"values": values}
            return {"sheets": [{"properties": {"title": "Daily Campaign Performance"}}]}

    monkeypatch.setattr(appmod, "_ads_sheet_service", lambda: Svc())
    monkeypatch.setattr(appmod, "GOOGLE_ADS_SHEET_ID", "test")
    return appmod._fetch_google_ads_rows(force=True)


def test_the_report_has_the_columns_and_rows_the_dashboard_reads():
    res = _run()
    g = res["grid"]
    assert g[0][0] == "Daily Campaign Performance" and g[1][0] == "28 August 2026 - 26 September 2026"
    assert g[2] == ["Account name", "Customer ID", "Campaign", "Campaign state", "Campaign type", "Day", "Clicks",
                    "Impr.", "CTR", "Currency code", "Avg. CPC", "Avg. CPC (Converted currency)", "Cost",
                    "Cost (Converted currency)", "Impr. (Abs. Top) %", "Impr. (Top) %", "Conversions",
                    "View-through conv.", "Cost / conv.", "Cost / conv. (Converted currency)", "Conv. rate",
                    "Converted currency code"]
    assert res["order"][0] == "Daily Campaign Performance", "the dashboard reads the first tab"
    assert res["formats"]["6"]["f"] == "@" and res["formats"]["2"]["f"] == "@", "days and IDs stay text"
    assert [r[6] for r in g[3:]] == sorted((r[6] for r in g[3:]), reverse=True), "sorted by clicks"
    assert res["queries"] == 5, "one client list, then one query per account (the test account skipped)"


def test_money_is_converted_at_the_reference_rates_with_pegs_and_weekends():
    g = _run()["grid"]
    by = {(r[0], r[5]): r for r in g[3:]}
    usd_sat = by[("Beta US", "2026-09-26")]
    assert usd_sat[12] == 50 and usd_sat[13] == 4800 and usd_sat[21] == "INR", "Saturday: Friday's rate, 96"
    usd_sun = by[("Beta US", "2026-09-20")]
    assert usd_sun[13] == round(12.345678 * 95, 2), "Sunday: the last published rate, Friday 18 Sep"
    aed = by[("Gulf Co", "2026-09-26")]
    assert aed[13] == round(50 / 3.6725 * 96, 2), "AED through its fixed US dollar rate"
    eur = by[("Euro Ltd", "2026-09-26")]
    assert eur[13] == 50 and eur[21] == "EUR", "no rate: left in its own currency, never guessed"
    inr = by[("Acme India", "2026-09-26")]
    assert inr[12] == inr[13] == 5000 and inr[18] == 500 and inr[19] == 500
    assert by[("Acme India", "2026-09-20")][19] == "--", "no conversions: no cost per conversion"
    assert "European Central Bank" in g[1][2]


def test_one_request_per_currency_pair():
    res = _run()
    assert sorted(res["fetched"]) == sorted(set(res["fetched"])) and len(res["fetched"]) == 2


def test_the_dashboard_reads_the_report_and_names_the_rates(monkeypatch):
    res = _run()
    rows = _read_back(monkeypatch, res)
    assert len(rows) == 8
    us = next(r for r in rows if r["account"] == "Beta US" and r["day"] == "2026-09-26")
    assert (us["cost"], us["currency"], us["cost_native"], us["currency_native"]) == (4800.0, "INR", 50.0, "USD")
    assert us["top_pct"] == 80.0 and us["abs_top_pct"] == 50.0 and us["view_through"] == 1.0
    pmax = next(r for r in rows if r["campaign"] == "PMax | All")
    assert pmax["type"] == "Performance Max" and pmax["state"] == "Paused"
    assert appmod._google_ads_cache["rate_source"] == "ecb"
    assert appmod._google_ads_mixed_currencies(rows) == ["EUR", "INR"], "the unconverted EUR account is flagged"
    from tracker import google_ads_insights as g
    fx = g.FX(rows)
    assert fx.rate("Beta US", "2026-09-26") == pytest.approx(96.0) and fx.rate("Gulf Co", "2026-09-26") == pytest.approx(96 / 3.6725, rel=1e-4)


def test_without_any_rate_every_account_keeps_its_own_currency():
    g = _run("norates")["grid"]
    assert all(r[21] == r[9] for r in g[3:]) and g[1][2] == ""


def test_the_page_names_the_rates_the_report_used():
    with open(os.path.join(T.ROOT, "static", "js", "google-ads-insights.js"), encoding="utf-8") as fh:
        src = fh.read()
    assert 'INS.rate_source === "ecb"' in src and "European Central Bank" in src
