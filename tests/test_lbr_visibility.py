"""Local Business Radar, phase 7: map rank, paid search, and the local market."""

import os
import sys
import time

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tracker import lbr_http, lbr_visibility  # noqa: E402
from lbr_fakes import FakeResponse, FakeSession  # noqa: E402

PLAN = {"business": {"queries": ["dentist"], "input": "dentist"}, "area": {"country": "US"}}


def _p(lat, lng, rating=4.5, reviews=40, website="", sab=False):
    return {"name": "x", "lat": lat, "lng": lng, "rating": rating, "reviews": reviews, "website": website,
            "service_area_only": sab}


@pytest.fixture
def serp(monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "serp-key")
    monkeypatch.delenv("LBR_PRICES_JSON", raising=False)
    s = FakeSession()
    monkeypatch.setattr(lbr_http, "_SESSION", s)
    monkeypatch.setattr(lbr_http.time, "sleep", lambda x: None)
    return s


def _maps(results):
    return FakeResponse(200, {"local_results": [
        {"position": i + 1, "place_id": pid, "title": "Biz %s" % pid, "rating": 4.6, "reviews": 100}
        for i, pid in enumerate(results)]})


def test_rank_is_read_from_a_search_centred_on_the_business(serp):
    serp.on("serpapi.com", _maps(["c1", "p1", "c2", "c3"]))
    ledger = lbr_http.Ledger()
    out = lbr_visibility.run(["p1"], {"p1": _p(30.2671, -97.7431)}, PLAN, ledger)
    b = out["businesses"]["p1"]
    assert b["rank"] == 2 and b["in_pack"] is True and "#2" in b["rank_note"]
    assert [c["place_id"] for c in b["competitors"]] == ["c1", "c2", "c3"]
    params = serp.requests[0]["params"]
    assert params["engine"] == "google_maps" and params["type"] == "search" and params["q"] == "dentist"
    assert params["ll"] == "@30.267100,-97.743100,14z" and params["gl"] == "us"
    assert ledger.totals()["usd"] == pytest.approx(0.015)


def test_neighbours_share_one_search(serp):
    serp.on("serpapi.com", _maps(["p1", "p2"]))
    profiles = {"p1": _p(30.2671, -97.7431), "p2": _p(30.2689, -97.7412), "p3": _p(30.4000, -97.7000)}
    out = lbr_visibility.run(["p1", "p2", "p3"], profiles, PLAN, lbr_http.Ledger())
    assert out["searches"] == 2 and len(serp.requests) == 2
    assert out["businesses"]["p3"]["rank"] is None and "Not in the first" in out["businesses"]["p3"]["rank_note"]


def test_a_service_area_business_is_not_given_a_misleading_rank(serp):
    out = lbr_visibility.run(["p1"], {"p1": _p(30.2, -97.7, sab=True)}, PLAN, lbr_http.Ledger())
    assert serp.requests == [] and out["businesses"]["p1"]["rank"] is None
    assert "Service-area" in out["businesses"]["p1"]["rank_note"]


def test_ads_are_checked_only_for_a_working_site_of_their_own(serp):
    now = time.time()

    def route(method, url, params, body):
        if params["engine"] == "google_ads_transparency_center":
            assert params["text"] == "smilestudio.example"
            return FakeResponse(200, {"search_information": {"total_results": 14},
                                      "ad_creatives": [{"format": "text", "last_shown": now - 3 * 86400},
                                                       {"format": "image", "last_shown": now - 90 * 86400}]})
        return _maps([])
    serp.handlers = [("serpapi.com", route)]
    profiles = {"p1": _p(30.2, -97.7), "p2": _p(30.5, -97.5), "p3": _p(30.3, -97.9)}
    websites = {"p1": {"kind": "ok", "final_url": "https://www.smilestudio.example/home"},
                "p2": {"kind": "social_only", "link": "https://facebook.com/x"},
                "p3": {"kind": "ok", "final_url": "https://x.wixsite.com/p3"}}
    out = lbr_visibility.run(["p1", "p2", "p3"], profiles, PLAN, lbr_http.Ledger(), websites=websites)
    assert out["ad_checks"] == 1, "a shared host like wixsite.com says nothing about the business"
    a = out["businesses"]["p1"]["ads"]
    assert a["creatives"] == 14 and a["active"] is True and a["last_seen_days"] == 3
    assert a["formats"] == ["image", "text"]
    assert out["businesses"]["p2"]["ads"] is None


def test_the_local_market_is_every_business_found():
    profiles = {"a": _p(0, 0, 4.9, 300), "b": _p(0, 0, 4.1, 20), "c": _p(0, 0, 4.6, 140),
                "d": _p(0, 0, 3.8, 5, website="https://d.example"), "e": _p(0, 0, None, 0)}
    m = lbr_visibility.market(profiles)
    assert m["businesses"] == 5 and m["median_rating"] == 4.35 and m["median_reviews"] == 20
    assert m["with_website_pct"] == 20
    s = lbr_visibility.standing(profiles["b"], m)
    assert s == {"reviews_vs_median": 0, "rating_vs_median": -0.25}


def test_without_serpapi_the_market_standing_still_comes_back(monkeypatch):
    monkeypatch.delenv("SERPAPI_KEY", raising=False)
    s = FakeSession()
    monkeypatch.setattr(lbr_http, "_SESSION", s)
    out = lbr_visibility.run(["p1"], {"p1": _p(30.2, -97.7, reviews=10)}, PLAN, lbr_http.Ledger())
    assert s.requests == [] and out["businesses"]["p1"]["market"]["reviews_vs_median"] == 0


def test_a_failed_search_is_reported_not_read_as_unranked(serp):
    serp.on("serpapi.com", FakeResponse(401, {"error": "Invalid API key."}))
    out = lbr_visibility.run(["p1"], {"p1": _p(30.2, -97.7)}, PLAN, lbr_http.Ledger())
    b = out["businesses"]["p1"]
    assert b["rank"] is None and b["in_pack"] is None and "rank_error" in b
