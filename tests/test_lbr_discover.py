"""Local Business Radar, phase 3: discovery.

A fake Places Text Search holds a synthetic city of businesses and applies
Google's real limits (20 per page, 60 per query, results only inside the
locationRestriction rectangle), so these tests check that the quadtree finds
every business, stops at the budget, and says when coverage is partial.
"""

import json
import os
import random
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tracker import lbr_discover, lbr_http  # noqa: E402
from lbr_fakes import FakeResponse, FakeSession  # noqa: E402

VP = {"low": {"lat": 30.10, "lng": -97.95}, "high": {"lat": 30.50, "lng": -97.55}}


def _biz(i, lat, lng, **kw):
    b = {"id": "p%04d" % i, "displayName": {"text": kw.pop("name", "Practice %d" % i)},
         "formattedAddress": "%d Main St, Austin, TX" % i,
         "location": {"latitude": lat, "longitude": lng}, "types": ["dentist"],
         "primaryType": "dentist", "primaryTypeDisplayName": {"text": "Dentist"},
         "businessStatus": kw.pop("status", "OPERATIONAL"),
         "googleMapsUri": "https://maps.google.com/?cid=%d" % i,
         "rating": kw.pop("rating", 4.5), "userRatingCount": kw.pop("reviews", 40),
         "addressComponents": [{"longText": "Austin", "shortText": "Austin", "types": ["locality"]},
                               {"longText": "Travis County", "shortText": "Travis County",
                                "types": ["administrative_area_level_2"]},
                               {"longText": kw.pop("state_long", "Texas"), "shortText": kw.pop("state", "TX"),
                                "types": ["administrative_area_level_1"]}]}
    site = kw.pop("website", "https://practice%d.com" % i)
    if site:
        b["websiteUri"] = site
    b.update(kw)
    return b


def fake_places(businesses):
    """A Places Text Search with Google's own limits."""
    def handler(method, url, params, body):
        rect = body["locationRestriction"]["rectangle"]
        lo, hi = rect["low"], rect["high"]
        inside = [b for b in businesses
                  if lo["latitude"] <= b["location"]["latitude"] < hi["latitude"]
                  and lo["longitude"] <= b["location"]["longitude"] < hi["longitude"]]
        if body.get("includedType"):
            inside = [b for b in inside if body["includedType"] in b["types"]]
        inside = inside[:60]
        offset = int(body.get("pageToken") or 0)
        page = inside[offset:offset + 20]
        out = {"places": page}
        if offset + 20 < len(inside):
            out["nextPageToken"] = str(offset + 20)
        return FakeResponse(200, out)
    return handler


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "maps-key")
    monkeypatch.delenv("LBR_PRICES_JSON", raising=False)
    monkeypatch.setattr(lbr_http.time, "sleep", lambda s: None)
    monkeypatch.setattr(lbr_discover.time, "sleep", lambda s: None)
    return monkeypatch


def _plan(requests=90, cap=200, focus="all", kind="city", filt="none", types=("dentist",)):
    return {"business": {"label": "Dentists", "types": list(types), "queries": ["dentist"],
                         "service_area": False, "input": "dentist"},
            "area": {"kind": kind, "viewport": VP, "filter": filt, "admin1": "TX", "admin2": "Travis County"},
            "focus": focus, "cap": cap, "estimate": {"discovery_requests": requests}}


def _city(n, seed=3):
    rnd = random.Random(seed)
    # Dense downtown plus a sprinkle across the metro, like a real city.
    out = []
    for i in range(n):
        if i % 3:
            lat, lng = 30.27 + rnd.uniform(-0.02, 0.02), -97.74 + rnd.uniform(-0.02, 0.02)
        else:
            lat, lng = rnd.uniform(30.101, 30.499), rnd.uniform(-97.949, -97.551)
        out.append(_biz(i, lat, lng))
    return out


def test_the_quadtree_finds_every_business_in_a_dense_city(env, monkeypatch):
    city = _city(400)
    s = FakeSession().on("places:searchText", fake_places(city))
    monkeypatch.setattr(lbr_http, "_SESSION", s)
    ledger = lbr_http.Ledger()
    out = lbr_discover.discover(_plan(requests=400), ledger)
    assert out["stats"]["found"] == 400, "one search sees at most 60; the tiles must cover the rest"
    assert out["stats"]["coverage"] == "complete"
    assert out["stats"]["requests_used"] == ledger.totals()["calls"]
    assert ledger.totals()["usd"] == pytest.approx(0.035 * ledger.totals()["calls"])
    sent = s.requests[0]
    assert sent["headers"]["X-Goog-FieldMask"].startswith("places.id,")
    assert "places.websiteUri" in sent["headers"]["X-Goog-FieldMask"]
    assert "nextPageToken" in sent["headers"]["X-Goog-FieldMask"]
    assert sent["json"]["includedType"] == "dentist" and sent["json"]["strictTypeFiltering"] is True


def test_a_small_budget_stops_early_and_says_coverage_is_partial(env, monkeypatch):
    s = FakeSession().on("places:searchText", fake_places(_city(400)))
    monkeypatch.setattr(lbr_http, "_SESSION", s)
    ledger = lbr_http.Ledger()
    out = lbr_discover.discover(_plan(requests=12), ledger)
    assert ledger.totals()["calls"] <= 12, "never more requests than the budget"
    assert out["stats"]["coverage"] == "partial" and out["stats"]["tiles_still_full"] > 0
    assert 60 <= out["stats"]["found"] < 400


def test_a_sparse_area_costs_one_request(env, monkeypatch):
    s = FakeSession().on("places:searchText", fake_places(_city(12)))
    monkeypatch.setattr(lbr_http, "_SESSION", s)
    ledger = lbr_http.Ledger()
    out = lbr_discover.discover(_plan(), ledger)
    assert out["stats"]["found"] == 12 and ledger.totals()["calls"] == 1
    assert out["stats"]["coverage"] == "complete"


def test_closed_businesses_and_other_states_are_dropped(env, monkeypatch):
    bs = [_biz(1, 30.2, -97.7), _biz(2, 30.2, -97.71, status="CLOSED_PERMANENTLY"),
          _biz(3, 30.2, -97.72, state="OK", state_long="Oklahoma")]
    monkeypatch.setattr(lbr_http, "_SESSION", FakeSession().on("places:searchText", fake_places(bs)))
    out = lbr_discover.discover(_plan(kind="state", filt="admin1"), lbr_http.Ledger())
    assert set(out["profiles"]) == {"p0001"}
    assert out["stats"]["closed"] == 1 and out["stats"]["outside_area"] == 1
    # A city keeps its metro: the same Oklahoma-tagged result is not dropped.
    out = lbr_discover.discover(_plan(), lbr_http.Ledger())
    assert "p0003" in out["profiles"]


def test_the_same_place_in_two_queries_is_counted_once(env, monkeypatch):
    b = _biz(1, 30.2, -97.7)
    b["types"] = ["dentist", "dental_clinic"]
    monkeypatch.setattr(lbr_http, "_SESSION", FakeSession().on("places:searchText", fake_places([b])))
    out = lbr_discover.discover(_plan(types=("dentist", "dental_clinic")), lbr_http.Ledger())
    assert out["stats"]["found"] == 1


# ── Profiles ─────────────────────────────────────────────────────────────────

def test_a_place_becomes_the_profile_the_agent_uses():
    p = _biz(7, 30.2, -97.7, website="https://smile.example", nationalPhoneNumber="(512) 555-0100",
             regularOpeningHours={"weekdayDescriptions": ["Monday: 8 AM – 5 PM"]},
             photos=[{}, {}, {}], pureServiceAreaBusiness=False, priceLevel="PRICE_LEVEL_MODERATE")
    prof = lbr_discover.normalise(p)
    assert prof["name"] == "Practice 7" and prof["website"] == "https://smile.example"
    assert prof["phone"] == "(512) 555-0100" and prof["hours"] == ["Monday: 8 AM – 5 PM"]
    assert prof["photos_seen"] == 3 and prof["admin1"] == "TX" and prof["locality"] == "Austin"
    assert prof["rating"] == 4.5 and prof["reviews"] == 40 and prof["category"] == "Dentist"


# ── Chains ───────────────────────────────────────────────────────────────────

def _profiles(*rows):
    return {"p%d" % i: dict(lbr_discover.normalise(_biz(i, 30.2, -97.7, name=n, website=w)))
            for i, (n, w) in enumerate(rows)}


def test_a_known_brand_is_a_chain_even_once():
    ps = lbr_discover.mark_chains(_profiles(("Aspen Dental - Round Rock", "https://www.aspendental.com/x"),
                                            ("Great Clips (Mueller)", "")))
    assert all(p["chain"] and p["chain_reason"] == "known brand" for p in ps.values())


def test_three_locations_sharing_a_domain_are_a_chain_two_are_not():
    three = lbr_discover.mark_chains(_profiles(("Bright Smiles North", "https://brightsmiles.com/n"),
                                               ("Bright Smiles South", "https://brightsmiles.com/s"),
                                               ("Bright Smiles East", "https://www.brightsmiles.com/e")))
    assert all(p["chain"] and p["locations"] == 3 for p in three.values())
    two = lbr_discover.mark_chains(_profiles(("Oak Dental - North", "https://oakdental.com"),
                                             ("Oak Dental - South", "https://oakdental.com")))
    assert not any(p["chain"] for p in two.values()) and all(p["locations"] == 2 for p in two.values())


def test_businesses_sharing_a_page_builder_or_facebook_are_not_a_chain():
    ps = lbr_discover.mark_chains(_profiles(("A", "https://facebook.com/a"), ("B", "https://facebook.com/b"),
                                            ("C", "https://facebook.com/c"), ("D", "https://d.wixsite.com/d"),
                                            ("E", "https://e.wixsite.com/e"), ("F", "https://f.wixsite.com/f")))
    assert not any(p["chain"] for p in ps.values())


def test_three_unrelated_law_offices_are_not_a_chain():
    ps = lbr_discover.mark_chains(_profiles(("Law Office of Jane Doe", ""), ("Law Office of John Roe", ""),
                                            ("Law Office of Ann Poe, PLLC", "")))
    assert not any(p["chain"] for p in ps.values())


def test_generic_names_are_not_mistaken_for_brands():
    ps = lbr_discover.mark_chains(_profiles(("Gentle Dental Care of Austin", ""), ("Downtown Urgent Care", "")))
    assert not any(p["chain"] for p in ps.values())


# ── Which to research ────────────────────────────────────────────────────────

def test_chains_are_never_researched_and_the_cap_holds(env, monkeypatch):
    bs = [_biz(i, 30.2 + i * 0.0001, -97.7) for i in range(30)]
    bs.append(_biz(99, 30.25, -97.7, name="Aspen Dental", website="https://aspendental.com"))
    monkeypatch.setattr(lbr_http, "_SESSION", FakeSession().on("places:searchText", fake_places(bs)))
    out = lbr_discover.discover(_plan(cap=10), lbr_http.Ledger())
    assert len(out["selected"]) == 10 and "p0099" not in out["selected"]
    assert out["stats"]["chains"] == 1 and out["stats"]["candidates"] == 30


def test_a_website_focus_puts_businesses_without_one_first(env, monkeypatch):
    bs = [_biz(i, 30.2 + i * 0.0001, -97.7) for i in range(20)]
    bs += [_biz(50, 30.3, -97.7, website=""), _biz(51, 30.3, -97.71, website="https://facebook.com/x")]
    monkeypatch.setattr(lbr_http, "_SESSION", FakeSession().on("places:searchText", fake_places(bs)))
    out = lbr_discover.discover(_plan(cap=5, focus="website"), lbr_http.Ledger())
    assert out["selected"][:2] == ["p0050", "p0051"]


def test_a_cancelled_run_stops_searching(env, monkeypatch):
    s = FakeSession().on("places:searchText", fake_places(_city(400)))
    monkeypatch.setattr(lbr_http, "_SESSION", s)
    calls = {"n": 0}

    def stop():
        calls["n"] += 1
        return calls["n"] > 1
    out = lbr_discover.discover(_plan(requests=400), lbr_http.Ledger(), should_stop=stop)
    assert out["stats"]["coverage"] == "stopped" and len(s.requests) <= 3


def test_service_area_trades_ask_google_to_include_them(env, monkeypatch):
    s = FakeSession().on("places:searchText", fake_places([]))
    monkeypatch.setattr(lbr_http, "_SESSION", s)
    plan = _plan(types=())
    plan["business"].update(types=[], queries=["HVAC contractor", "air conditioning repair"], service_area=True)
    lbr_discover.discover(plan, lbr_http.Ledger())
    assert [r["json"]["textQuery"] for r in s.requests] == ["HVAC contractor", "air conditioning repair"]
    assert all(r["json"]["includePureServiceAreaBusinesses"] is True and "includedType" not in r["json"]
               for r in s.requests)
