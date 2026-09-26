"""The Google Ads campaign dashboard (/dashboards/google-ads).

Fed by a Google Ads "schedule export to Sheets" report -- there is no Ads API
call anywhere in this feature, only a read of whatever rows that export has
already written. These tests fake the Sheets read (a small stand-in for the
googleapiclient chain: spreadsheets().get()/.values().get()) so the parsing
logic is checked without any network call or real credential, using a header
row and a few data rows shaped exactly like the real export (see the
docstring on _fetch_google_ads_rows in app.py).

Filtering, aggregation, and charting all moved client-side (static/js/
google-ads-dashboard.js), so this file only covers what still runs in
Python: row parsing, the currency-symbol pick, and the route's job of
deciding ok/not-ok and embedding the row set. The JS itself is verified in
a real browser (Playwright), the same way the rest of this codebase's
client-side behaviour is checked -- there is no JS test runner here.
"""

import json
import os
import re
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


def test_fetch_rows_reads_ad_position_and_view_through(fake_sheet):
    rows = appmod._fetch_google_ads_rows(force=True)
    assert rows[1]["top_pct"] == pytest.approx(70.42)
    assert rows[1]["abs_top_pct"] == pytest.approx(18.31)
    assert rows[1]["view_through"] == 0.0


def test_fetch_rows_tolerates_an_export_without_the_optional_columns(monkeypatch):
    """Ad position and view-through are extra columns someone could drop from
    the scheduled report; the core figures must still parse without them."""
    keep = [i for i, h in enumerate(_HEADER)
            if h not in ("Impr. (Abs. Top) %", "Impr. (Top) %", "View-through conv.")]
    trimmed = [[r[i] for i in keep if i < len(r)] if len(r) > 3 else r for r in _RAW_ROWS]
    monkeypatch.setattr(appmod, "GOOGLE_ADS_SHEET_ID", "fake-sheet-id")
    monkeypatch.setattr(appmod, "_ads_sheet_service",
                         lambda: _FakeSheetsService(
                             {"sheets": [{"properties": {"title": "T"}}]}, {"values": trimmed}))
    rows = appmod._fetch_google_ads_rows(force=True)
    appmod._google_ads_cache.update(rows=None, at=0.0)
    assert len(rows) == 3
    assert rows[1]["cost"] == pytest.approx(1206.38)
    assert rows[1]["conversions"] == 1.0
    assert rows[1]["top_pct"] == 0.0 and rows[1]["view_through"] == 0.0


def test_fetch_rows_is_cached_between_calls(fake_sheet, monkeypatch):
    appmod._fetch_google_ads_rows(force=True)
    calls = []
    monkeypatch.setattr(appmod, "_ads_sheet_service",
                         lambda: calls.append(1) or (_ for _ in ()).throw(AssertionError("hit the network")))
    # Cached, so this must NOT call _ads_sheet_service again.
    appmod._fetch_google_ads_rows()
    assert not calls


# ── _dominant_ads_currency / _google_ads_currency_symbol ─────────────────────

def test_dominant_currency_is_majority_vote():
    rows = [{"currency": "INR"}, {"currency": "INR"}, {"currency": "USD"}]
    assert appmod._dominant_ads_currency(rows) == "INR"


def test_dominant_currency_falls_back_to_inr_with_nothing_to_vote_on():
    assert appmod._dominant_ads_currency([]) == "INR"
    assert appmod._dominant_ads_currency([{"currency": ""}]) == "INR"


def test_currency_symbol_maps_known_codes_and_passes_through_unknown_ones():
    assert appmod._google_ads_currency_symbol([{"currency": "INR"}]) == "₹"
    assert appmod._google_ads_currency_symbol([{"currency": "USD"}]) == "$"
    assert appmod._google_ads_currency_symbol([{"currency": "AUD"}]) == "AUD "


def test_fetch_rows_raises_past_the_route_when_sheet_id_is_unset(monkeypatch):
    monkeypatch.setattr(appmod, "GOOGLE_ADS_SHEET_ID", "")
    appmod._google_ads_cache.update(rows=None, at=0.0)
    with pytest.raises(RuntimeError):
        appmod._fetch_google_ads_rows(force=True)


# ── The route ────────────────────────────────────────────────────────────────
# Filtering, aggregation, and every chart are client-side now, so the route's
# only contract is: gate on sign-in, embed the exact row set as JSON, and
# fall back to a safe empty state when there is nothing to embed.

def test_route_requires_sign_in():
    c = appmod.app.test_client()
    r = c.get("/dashboards/google-ads")
    assert r.status_code in (302, 303)


def test_route_embeds_the_full_row_set_as_json(fake_sheet):
    r = _staff_client().get("/dashboards/google-ads")
    assert r.status_code == 200
    body = r.get_data(as_text=True)
    assert 'data-kpi="cost"' in body  # the static shell, always present when ok
    assert 'id="gad-account-select"' in body  # the account switcher is the headline
    match = re.search(
        r'<script id="gad-data" type="application/json">(.*?)</script>', body, re.S)
    assert match, "expected an embedded #gad-data JSON payload"
    embedded = json.loads(match.group(1))
    assert len(embedded) == 3
    accounts = {r["account"] for r in embedded}
    assert accounts == {"Turquoise Institute", "Other Co"}
    campaigns = {r["campaign"] for r in embedded}
    assert campaigns == {"NonBrand-MD", "Brand"}


def test_route_sets_the_currency_symbol_for_js_to_read(fake_sheet):
    r = _staff_client().get("/dashboards/google-ads")
    assert 'data-currency-symbol="₹"' in r.get_data(as_text=True)


def test_route_shows_a_safe_empty_state_when_not_configured(monkeypatch):
    monkeypatch.setattr(appmod, "GOOGLE_ADS_SHEET_ID", "")
    appmod._google_ads_cache.update(rows=None, at=0.0)
    r = _staff_client().get("/dashboards/google-ads")
    assert r.status_code == 200
    body = r.get_data(as_text=True)
    assert "GOOGLE_ADS_SHEET_ID" in body
    assert 'id="gad-data"' not in body  # nothing to embed, so nothing embedded


def test_refresh_endpoint_returns_the_fresh_row_set(fake_sheet):
    r = _staff_client().post("/api/dashboards/google-ads/refresh")
    assert r.status_code == 200
    data = r.get_json()
    assert data["ok"] is True
    assert len(data["rows"]) == 3
    assert data["currency_symbol"] == "₹"
