"""The Google Ads campaign dashboard (/dashboards/google-ads).

Fed by a Google Ads "schedule export to Sheets" report -- there is no Ads API
call anywhere in this feature, only a read of whatever rows that export has
already written. These tests fake the Sheets read (a small stand-in for the
googleapiclient chain: spreadsheets().get()/.values().get()) so the parsing
and aggregation logic is checked without any network call or real credential,
using a header row and a few data rows shaped exactly like the real export
(see the docstring on _fetch_google_ads_rows in app.py).
"""

import os
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)

import app as appmod  # noqa: E402


# ── A fake Sheets API, shaped like the real googleapiclient chain ──────────

class _Exec:
    def __init__(self, payload):
        self._payload = payload

    def execute(self):
        return self._payload


class _ValuesAPI:
    def __init__(self, values_payload):
        self._values_payload = values_payload

    def get(self, spreadsheetId, range):  # noqa: A002 - matches the real API's kwarg name
        return _Exec(self._values_payload)


class _SpreadsheetsAPI:
    def __init__(self, meta_payload, values_payload):
        self._meta_payload = meta_payload
        self._values_api = _ValuesAPI(values_payload)

    def get(self, spreadsheetId):  # noqa: A002
        return _Exec(self._meta_payload)

    def values(self):
        return self._values_api


class _FakeSheetsService:
    def __init__(self, meta_payload, values_payload):
        self._api = _SpreadsheetsAPI(meta_payload, values_payload)

    def spreadsheets(self):
        return self._api


_HEADER = ["Account name", "Customer ID", "Campaign", "Campaign state", "Campaign type",
           "Day", "Clicks", "Impr.", "CTR", "Currency code", "Avg. CPC",
           "Avg. CPC (Converted currency)", "Cost", "Cost (Converted currency)",
           "Impr. (Abs. Top) %", "Impr. (Top) %", "Conversions", "View-through conv.",
           "Cost / conv.", "Cost/conv. (Converted currency)", "Conv. rate",
           "Converted currency code"]

# Two accounts, two campaigns, two days -- exactly the real export's shape
# (a title row, a date-range caption row, the header, then data rows).
_RAW_ROWS = [
    ["Daily Campaign Performance"],
    ["27 August 2026 - 25 September 2026"],
    _HEADER,
    ["Turquoise Institute", "504-185-2393", "NonBrand-MD", "Enabled", "Search",
     "2026-09-17", "8", "91", "8.79%", "USD", "1.36", "129.34", "10.85", "1034.72",
     "9.84%", "67.21%", "0", "0", "--", "--", "0%", "INR"],
    ["Turquoise Institute", "504-185-2393", "NonBrand-MD", "Enabled", "Search",
     "2026-09-18", "9", "106", "8.49%", "USD", "1.41", "134.04", "12.65", "1206.38",
     "18.31%", "70.42%", "1", "0", "12.65", "1206.38", "11.11%", "INR"],
    ["Other Co", "111-222-3333", "Brand", "Enabled", "Search",
     "2026-09-18", "20", "200", "10.00%", "USD", "0.50", "47.65", "10.00", "500.00",
     "50.00%", "80.00%", "2", "0", "5.00", "250.00", "10.00%", "INR"],
    # A blank trailing row, as real exports sometimes have -- must not raise.
    [],
]


@pytest.fixture
def fake_sheet(monkeypatch):
    monkeypatch.setattr(appmod, "GOOGLE_ADS_SHEET_ID", "fake-sheet-id")
    monkeypatch.setattr(appmod, "_ads_sheet_service",
                         lambda: _FakeSheetsService(
                             {"sheets": [{"properties": {"title": "Daily Campaign Performance"}}]},
                             {"values": _RAW_ROWS}))
    appmod._google_ads_cache.update(rows=None, at=0.0)
    yield
    appmod._google_ads_cache.update(rows=None, at=0.0)


def _staff_client():
    c = appmod.app.test_client()
    with c.session_transaction() as sess:
        sess["google_user"] = {"email": "reporting@markifydigital.com", "name": "T"}
    return c


# ── _parse_ads_number ────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    ("1,206.38", 1206.38),
    ("8.49%", 8.49),
    ("--", 0.0),
    ("", 0.0),
    (None, 0.0),
    ("0%", 0.0),
    ("42", 42.0),
])
def test_parse_ads_number(raw, expected):
    assert appmod._parse_ads_number(raw) == pytest.approx(expected)


# ── _fetch_google_ads_rows ───────────────────────────────────────────────────

def test_fetch_rows_finds_the_header_past_the_title_and_date_caption(fake_sheet):
    rows = appmod._fetch_google_ads_rows(force=True)
    assert len(rows) == 3  # the blank trailing row is dropped
    assert rows[0]["account"] == "Turquoise Institute"
    assert rows[0]["campaign"] == "NonBrand-MD"
    assert rows[0]["day"] == "2026-09-17"


def test_fetch_rows_prefers_the_converted_currency_cost_column(fake_sheet):
    rows = appmod._fetch_google_ads_rows(force=True)
    # "Cost" (USD, 10.85) vs "Cost (Converted currency)" (INR, 1034.72) --
    # the converted figure is what a Markify (India) dashboard should show.
    assert rows[0]["cost"] == pytest.approx(1034.72)
    assert rows[0]["currency"] == "INR"


def test_fetch_rows_is_cached_between_calls(fake_sheet, monkeypatch):
    appmod._fetch_google_ads_rows(force=True)
    calls = []
    monkeypatch.setattr(appmod, "_ads_sheet_service",
                         lambda: calls.append(1) or (_ for _ in ()).throw(AssertionError("hit the network")))
    # Cached, so this must NOT call _ads_sheet_service again.
    appmod._fetch_google_ads_rows()
    assert not calls


# ── _google_ads_summary ──────────────────────────────────────────────────────

def test_summary_totals_add_up_across_every_row(fake_sheet):
    s = appmod._google_ads_summary(force=True)
    assert s["ok"] is True
    assert s["total_clicks"] == pytest.approx(8 + 9 + 20)
    assert s["total_impressions"] == pytest.approx(91 + 106 + 200)
    assert s["total_cost"] == pytest.approx(1034.72 + 1206.38 + 500.00)
    assert s["total_conversions"] == pytest.approx(0 + 1 + 2)


def test_summary_counts_distinct_accounts_and_campaigns(fake_sheet):
    s = appmod._google_ads_summary(force=True)
    assert s["accounts_count"] == 2
    # NonBrand-MD appears on two different days but is one campaign.
    assert s["campaigns_count"] == 2


def test_summary_groups_daily_spend_across_accounts(fake_sheet):
    s = appmod._google_ads_summary(force=True)
    by_day = {d["day"]: d["cost"] for d in s["daily"]}
    assert by_day["2026-09-17"] == pytest.approx(1034.72)
    assert by_day["2026-09-18"] == pytest.approx(1206.38 + 500.00)
    assert s["as_of"] == "2026-09-18"


def test_summary_campaign_leaderboard_is_sorted_by_cost(fake_sheet):
    s = appmod._google_ads_summary(force=True)
    costs = [c["cost"] for c in s["campaigns"]]
    assert costs == sorted(costs, reverse=True)
    assert s["campaigns"][0]["campaign"] == "NonBrand-MD"


def test_summary_cost_per_conversion_is_zero_not_a_crash_with_no_conversions(monkeypatch):
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows",
                         lambda force=False: [{"account": "A", "campaign": "C", "state": "Enabled",
                                                "day": "2026-09-17", "clicks": 5.0, "impressions": 50.0,
                                                "cost": 20.0, "currency": "INR", "conversions": 0.0}])
    s = appmod._google_ads_summary(force=True)
    assert s["cost_per_conv"] == 0.0


def test_summary_is_not_ok_with_no_rows(monkeypatch):
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: [])
    s = appmod._google_ads_summary(force=True)
    assert s == {"ok": False, "rows": 0}


def test_summary_raises_past_the_route_when_sheet_id_is_unset(monkeypatch):
    monkeypatch.setattr(appmod, "GOOGLE_ADS_SHEET_ID", "")
    appmod._google_ads_cache.update(rows=None, at=0.0)
    with pytest.raises(RuntimeError):
        appmod._fetch_google_ads_rows(force=True)


# ── _ads_spend_chart ─────────────────────────────────────────────────────────

def test_chart_geometry_needs_at_least_two_days():
    assert appmod._ads_spend_chart([]) is None
    assert appmod._ads_spend_chart([{"day": "2026-09-17", "cost": 10.0}]) is None


def test_chart_geometry_spans_the_full_data_range(fake_sheet):
    s = appmod._google_ads_summary(force=True)
    chart = appmod._ads_spend_chart(s["daily"])
    assert chart is not None
    assert chart["first_day"] == "2026-09-17"
    assert chart["last_day"] == "2026-09-18"
    assert chart["min"] == pytest.approx(1034.72)
    assert chart["max"] == pytest.approx(1706.38)
    assert len(chart["points"].split()) == len(s["daily"])


# ── The route ────────────────────────────────────────────────────────────────

def test_route_requires_sign_in():
    c = appmod.app.test_client()
    r = c.get("/dashboards/google-ads")
    assert r.status_code in (302, 303)


def test_route_renders_the_summary_when_configured(fake_sheet):
    r = _staff_client().get("/dashboards/google-ads")
    assert r.status_code == 200
    body = r.get_data(as_text=True)
    assert "NonBrand-MD" in body
    assert "Turquoise Institute" in body
    assert "Total spend" in body


def test_route_shows_a_safe_empty_state_when_not_configured(monkeypatch):
    monkeypatch.setattr(appmod, "GOOGLE_ADS_SHEET_ID", "")
    appmod._google_ads_cache.update(rows=None, at=0.0)
    r = _staff_client().get("/dashboards/google-ads")
    assert r.status_code == 200
    assert "GOOGLE_ADS_SHEET_ID" in r.get_data(as_text=True)


def test_refresh_endpoint_returns_json(fake_sheet):
    r = _staff_client().post("/api/dashboards/google-ads/refresh")
    assert r.status_code == 200
    assert r.get_json()["ok"] is True
