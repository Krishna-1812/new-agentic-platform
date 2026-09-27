"""Local Business Radar with Apify's Google Maps Scraper as the source: the
area from OpenStreetMap, discovery inside its boundary, each researched
business opened once for its profile and reviews, map rank from Google Maps
searches run by Apify, and a whole run with no Google Places or SerpAPI key."""

import json
import os
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tracker import (apify_transport, lbr_apify_maps, lbr_config, lbr_geo, lbr_http, lbr_intake,  # noqa: E402
                     lbr_pipeline, lbr_store, lbr_website)
from lbr_fakes import FakeResponse, FakeSession  # noqa: E402

ME = "p@markifydigital.com"
# A square "city" from (30.20, -97.80) to (30.35, -97.65), in GeoJSON order (lng, lat).
SQUARE = [[-97.80, 30.20], [-97.65, 30.20], [-97.65, 30.35], [-97.80, 30.35], [-97.80, 30.20]]
NOMINATIM_AUSTIN = [{
    "osm_type": "relation", "osm_id": 113314, "name": "Austin", "addresstype": "city",
    "display_name": "Austin, Travis County, Texas, United States", "lat": "30.27", "lon": "-97.74",
    "boundingbox": ["30.20", "30.35", "-97.80", "-97.65"],
    "address": {"city": "Austin", "county": "Travis County", "state": "Texas", "ISO3166-2-lvl4": "US-TX",
                "country_code": "us"},
    "geojson": {"type": "Polygon", "coordinates": [SQUARE]}}]


def _place(i, lat, lng, **kw):
    return {"placeId": "ChIJ%04d" % i, "title": kw.pop("title", "Practice %d" % i),
            "categoryName": "Dentist", "categories": ["Dentist"], "address": "%d Main St, Austin, TX" % i,
            "street": "%d Main St" % i, "city": "Austin", "state": "Texas", "postalCode": "78701",
            "location": {"lat": lat, "lng": lng}, "website": kw.pop("website", "https://p%d.example" % i),
            "phone": "(512) 555-01%02d" % i, "totalScore": kw.pop("rating", 4.4),
            "reviewsCount": kw.pop("reviews", 40), "url": "https://www.google.com/maps/place/?q=place_id:%d" % i,
            "permanentlyClosed": kw.pop("closed", False), "temporarilyClosed": False,
            "searchString": "dentist", "rank": i}


PLACES = [
    _place(1, 30.27, -97.74, title="Bright Dental", website="https://bright.example", rating=4.8, reviews=210),
    _place(2, 30.28, -97.75, title="Oak Family Dental", website="https://facebook.com/oak", rating=4.0, reviews=22),
    _place(3, 30.29, -97.73, title="Cedar Smiles", website="", rating=3.6, reviews=9),
    _place(4, 30.30, -97.72, title="Aspen Dental - North", website="https://aspendental.com/n"),
    _place(5, 30.31, -97.71, title="River Dentistry", website="https://river.example", rating=4.4, reviews=60),
    _place(6, 30.50, -97.68, title="Round Rock Dental", website="https://rr.example"),       # outside the city
    _place(7, 30.26, -97.76, title="Gone Dental", closed=True),
]
REVIEWS = [
    {"stars": 1, "publishedAtDate": "2026-09-01T10:00:00Z", "text": "Waited an hour.", "reviewId": "a",
     "name": "Should Never Be Stored"},
    {"stars": 5, "publishedAtDate": "2026-08-20T10:00:00Z", "text": "Lovely staff.", "reviewId": "b",
     "responseFromOwnerText": "Thank you!", "responseFromOwnerDate": "2026-08-21T10:00:00Z"},
]


class FakeApify:
    """Stands in for apify_transport.run_actor_and_wait; answers by the kind of input."""

    def __init__(self):
        self.calls = []
        self.fail_details = False

    def __call__(self, actor, run_input, token, timeout=300, poll_interval=5, strict=False, max_charge_usd=None):
        self.calls.append({"actor": actor, "input": run_input, "max": max_charge_usd, "strict": strict})
        assert actor == "compass/crawler-google-places" and token == "apify-token"
        if "customGeolocation" in run_input:
            return [dict(p) for p in PLACES]
        if "placeIds" in run_input:
            if self.fail_details:
                raise apify_transport.ApifyTransportError("run FAILED")
            out = []
            for pid in run_input["placeIds"]:
                base = next(dict(p) for p in PLACES if p["placeId"] == pid)
                base.update({"claimThisBusiness": pid == "ChIJ0003", "imagesCount": 3 if pid == "ChIJ0003" else 40,
                             "ownerUpdates": [], "description": "",
                             "openingHours": [{"day": d, "hours": "9 AM to 5 PM"} for d in
                                              ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")],
                             "reviewsTags": [{"title": "wait", "count": 4}],
                             "reviews": [dict(r) for r in REVIEWS][:run_input["maxReviews"]]})
                out.append(base)
            return out
        if "startUrls" in run_input:
            out = []
            for su in run_input["startUrls"]:
                # Bright Dental is first everywhere; an advertisement is never counted.
                out.append({"searchPageUrl": su["url"], "isAdvertisement": True, "placeId": "ChIJ9999",
                            "title": "Sponsored", "rank": 1})
                for n, pid in enumerate(["ChIJ0001", "ChIJ0005", "ChIJ0004"], 2):
                    out.append({"searchPageUrl": su["url"], "placeId": pid, "title": pid, "rank": n})
            return out
        raise AssertionError(run_input)


SITE = """<html><head><title>Bright</title><meta name="viewport" content="width=device-width">
<meta name="description" content="Dentist"></head><body><a href="tel:1">Call</a><form><textarea></textarea>
</form></body></html>"""


@pytest.fixture
def world(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    for v in ("GOOGLE_MAPS_API_KEY", "SERPAPI_KEY", "PAGESPEED_API_KEY", "HUNTER_API_KEY", "LBR_PRICES_JSON",
              "LBR_SOURCE"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("APIFY_API_TOKEN", "apify-token")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "claude")
    lbr_store.reset_memory()
    lbr_intake._PLAN_CACHE.clear()
    s = FakeSession()
    s.on("nominatim.openstreetmap.org", FakeResponse(200, NOMINATIM_AUSTIN))
    s.on("bright.example", FakeResponse(200, text=SITE))
    s.on("river.example", FakeResponse(200, text="<html><body>River</body></html>"))
    monkeypatch.setattr(lbr_http, "_SESSION", s)
    monkeypatch.setattr(lbr_http.time, "sleep", lambda x: None)
    monkeypatch.setattr(lbr_geo.time, "sleep", lambda x: None)
    monkeypatch.setattr(lbr_website, "_resolve", lambda h: {"93.184.216.34"})
    fake = FakeApify()
    monkeypatch.setattr(apify_transport, "run_actor_and_wait", fake)
    from tracker import lbr_claude

    def no_claude(*a, **k):
        raise lbr_claude.ClaudeError("offline in tests")
    monkeypatch.setattr(lbr_claude, "ask_json", no_claude)
    monkeypatch.setattr(lbr_pipeline, "_spawn", lambda rid: lbr_pipeline._work(rid))
    return {"session": s, "apify": fake}


def _osm(world, body):
    """Answer the next OpenStreetMap lookups with `body` (ahead of the default Austin)."""
    world["session"].handlers.insert(0, ("nominatim.openstreetmap.org", lambda *a: FakeResponse(200, body)))


def _plan(cap=10):
    return lbr_intake.plan("dentist", "Austin, TX", "all", cap)


# ── Which tools a run needs ──────────────────────────────────────────────────

def test_apify_is_the_source_whenever_its_token_is_set(world, monkeypatch):
    assert lbr_config.source() == "apify"
    req = {r["key"]: r["required"] for r in lbr_config.readiness()}
    assert req["apify"] and req["claude"] and not req["places"] and not req["serpapi"]
    assert lbr_config.missing_required() == [], "no Google Places or SerpAPI key is needed"
    monkeypatch.setenv("LBR_SOURCE", "places")
    assert lbr_config.source() == "places"
    assert set(lbr_config.missing_required()) == {"Google Places API (New)", "SerpAPI"}


def test_without_an_apify_token_the_places_api_is_used(world, monkeypatch):
    monkeypatch.delenv("APIFY_API_TOKEN")
    assert lbr_config.source() == "places" and "Apify Google Maps Scraper" not in lbr_config.missing_required()


# ── The area ─────────────────────────────────────────────────────────────────

def test_the_area_comes_from_openstreetmap_with_its_real_boundary(world):
    area = _plan()["area"]
    assert area["kind"] == "city" and area["source"] == "openstreetmap" and area["filter"] == "shape"
    assert area["country"] == "US" and area["admin1"] == "TX"
    assert area["shape"]["type"] == "Polygon" and "OpenStreetMap" in area["attribution"]
    req = world["session"].requests[-1]
    assert req["params"]["polygon_geojson"] == 1 and req["params"]["format"] == "jsonv2"
    assert lbr_geo.contains(area["shape"], 30.27, -97.74) and not lbr_geo.contains(area["shape"], 30.50, -97.68)


def test_a_place_known_only_as_a_point_gets_a_circle(world):
    _osm(world, [{
        "osm_type": "node", "osm_id": 1, "name": "78701", "addresstype": "postcode", "lat": "30.27",
        "lon": "-97.74", "boundingbox": ["30.27", "30.27", "-97.74", "-97.74"],
        "display_name": "78701, Austin", "address": {"country_code": "us"},
        "geojson": {"type": "Point", "coordinates": [-97.74, 30.27]}}])
    area = lbr_geo.resolve("78701", lbr_http.Ledger())
    assert area["kind"] == "postcode" and area["shape"]["type"] == "Point" and area["shape"]["radiusKm"] == 3
    assert lbr_geo.contains(area["shape"], 30.28, -97.74) and not lbr_geo.contains(area["shape"], 30.40, -97.74)
    assert area["viewport"]["high"]["lat"] > area["viewport"]["low"]["lat"]


def test_a_country_is_refused_and_nothing_found_is_explained(world):
    _osm(world, [{"addresstype": "country", "lat": "20", "lon": "77", "boundingbox": ["6", "35", "68", "97"],
                  "name": "India"}])
    with pytest.raises(lbr_intake.IntakeError, match="country"):
        lbr_intake.plan("dentist", "India")
    _osm(world, [])
    with pytest.raises(lbr_intake.IntakeError, match="could not find"):
        lbr_intake.plan("dentist", "Nowhereville")


def test_a_big_outline_is_thinned_before_it_is_sent():
    ring = [[i / 1000.0, 0.0] for i in range(3000)] + [[0.0, 0.0]]
    g = lbr_geo._thin_geometry({"type": "Polygon", "coordinates": [ring]})
    assert len(g["coordinates"][0]) <= lbr_geo.MAX_RING_POINTS + 1 and g["coordinates"][0][-1] == ring[-1]


# ── The estimate ─────────────────────────────────────────────────────────────

def test_the_estimate_prices_apify_per_place_and_per_review(world, monkeypatch):
    est = _plan(cap=100)["estimate"]
    assert est["source"] == "apify" and est["discovery_requests"] == 0
    search = next(l for l in est["lines"] if l["what"].startswith("Google Maps search"))
    assert search["units"] == 800 and search["usd"] == pytest.approx(3.2), "800 places x $0.004 for a city"
    opened = next(l for l in est["lines"] if l["what"].startswith("Each business opened"))
    assert opened["usd"] == pytest.approx(100 * (0.004 + 0.002 + 30 * 0.0005))
    rank = next(l for l in est["lines"] if l["what"].startswith("Map rank"))
    assert rank["provider"] == "apify" and rank["usd"] == pytest.approx(100 * lbr_config.APIFY_RANK_DEPTH * 0.004)
    assert not any(l["provider"] in ("places", "serpapi") for l in est["lines"])
    monkeypatch.setenv("SERPAPI_KEY", "serp")
    lbr_intake._PLAN_CACHE.clear()
    est = _plan(cap=100)["estimate"]
    assert any(l["provider"] == "serpapi" and "Map rank and Google Ads" in l["what"] for l in est["lines"])


# ── The Actor's input and output ─────────────────────────────────────────────

def test_the_search_asks_for_the_area_and_no_personal_data(world):
    plan = _plan()
    ri = lbr_apify_maps.search_input(plan)
    assert ri["customGeolocation"] == plan["area"]["shape"] and ri["searchStringsArray"] == ["dentist"]
    assert ri["scrapeReviewsPersonalData"] is False and ri["maxReviews"] == 0 and ri["scrapeContacts"] is False
    assert ri["maxCrawledPlacesPerSearch"] == lbr_config.APIFY_DISCOVERY_PLACES["city"]


def test_an_item_reads_as_the_same_profile_shape_as_the_places_api():
    p = lbr_apify_maps.normalise(dict(PLACES[0], openingHours=[{"day": "Monday", "hours": "9 AM to 5 PM"}],
                                      imagesCount=12, price="$$"))
    assert p["name"] == "Bright Dental" and p["lat"] == 30.27 and p["category"] == "Dentist"
    assert p["hours"] == ["Monday: 9 AM to 5 PM"] and p["photos_seen"] == 12 and p["status"] == "OPERATIONAL"
    assert lbr_apify_maps.normalise(PLACES[0])["hours"] is None, "no detail page yet: hours unknown, not missing"
    assert lbr_apify_maps.normalise(PLACES[6])["status"] == "CLOSED_PERMANENTLY"


def test_rank_results_are_matched_to_their_search_even_when_the_url_drifts(world):
    ledger = lbr_http.Ledger()

    def drift(actor, run_input, token, **kw):
        u = run_input["startUrls"][0]["url"]
        loaded = u.replace("@30.270000,-97.740000", "@30.2712,-97.7405")
        return [{"searchPageUrl": loaded, "placeId": "ChIJ0005", "rank": 1},
                {"searchPageUrl": loaded, "placeId": "ChIJ0001", "rank": 2}]
    import tracker.apify_transport as at
    at_orig = at.run_actor_and_wait
    at.run_actor_and_wait = drift
    try:
        out = lbr_apify_maps.map_ranks("dentist", [((30.27, -97.74), 30.27, -97.74), ((30.1, -97.1), 30.1, -97.1)],
                                       ledger)
    finally:
        at.run_actor_and_wait = at_orig
    assert [r["place_id"] for r in out[(30.27, -97.74)]] == ["ChIJ0005", "ChIJ0001"]
    assert "error" in out[(30.1, -97.1)], "no results is 'could not read', never 'not in the top 0'"


# ── A whole run ──────────────────────────────────────────────────────────────

def test_a_whole_run_on_apify_alone(world):
    rid = lbr_pipeline.start(ME, _plan())
    run = lbr_store.get_run(rid, ME)
    assert run["status"] == "complete", run["error"]
    s = run["summary"]
    assert s["found"] == 7 and s["stats"]["closed"] == 1 and s["stats"]["outside_area"] == 1
    assert s["stats"]["chains"] == 1, "Aspen Dental is a known chain"
    assert s["researched"] >= 4 and s["source"] == "apify" and "OpenStreetMap" in s["attribution"]
    assert "Google Places API (New)" not in s["unchecked_tools"]
    rows = {b["place_id"]: b["data"] for b in lbr_store.get_businesses(rid, ME)}
    assert "ChIJ0006" not in rows and "ChIJ0007" not in rows
    cedar = rows["ChIJ0003"]
    assert cedar["gbp"]["claimed"] is False, "claimThisBusiness true means NOT claimed"
    assert cedar["profile"]["hours"] and cedar["website"]["kind"] == "none"
    bright = rows["ChIJ0001"]
    assert bright["reviews"]["stats"]["unanswered_negative"] == 1
    assert bright["visibility"]["rank"] == 1, "the sponsored result is not counted"
    assert bright["visibility"]["ads"] is None, "no SerpAPI: Google Ads not checked"
    assert "Should Never Be Stored" not in json.dumps(rows)

    kinds = [c["input"] for c in world["apify"].calls]
    assert "customGeolocation" in kinds[0] and "placeIds" in kinds[1] and "startUrls" in kinds[2]
    assert len(kinds) == 3, "each business is opened once, for profile and reviews together"
    assert kinds[1]["scrapeReviewsPersonalData"] is False and kinds[1]["reviewsSort"] == "newest"
    assert all(c["max"] and c["max"] > 0 and c["strict"] for c in world["apify"].calls)

    calls = lbr_store.get_calls(rid)
    assert {c["provider"] for c in calls} <= {"apify", "openstreetmap", "claude", "pagespeed"}
    assert run["cost"]["usd"] <= run["plan"]["estimate"]["usd_max"]
    places = next(c for c in calls if c["op"] == "maps_search")
    assert places["units"] == 7 and places["usd"] == pytest.approx(7 * 0.004)


def test_a_failed_details_run_leaves_findings_unchecked_not_wrong(world):
    world["apify"].fail_details = True
    rid = lbr_pipeline.start(ME, _plan())
    run = lbr_store.get_run(rid, ME)
    assert run["status"] == "complete", run["error"]
    rows = {b["place_id"]: b["data"] for b in lbr_store.get_businesses(rid, ME)}
    assert rows["ChIJ0001"]["gbp"]["claimed"] is None
    assert "error" in rows["ChIJ0001"]["reviews"]
    failed = [c for c in lbr_store.get_calls(rid) if c["provider"] == "apify" and not c["ok"]]
    assert failed and failed[0]["usd"] == 0.0


def test_a_run_needs_the_apify_token_in_apify_mode(world, monkeypatch):
    plan = _plan()
    monkeypatch.setenv("LBR_SOURCE", "apify")
    monkeypatch.delenv("APIFY_API_TOKEN")
    rid = lbr_pipeline.start(ME, plan)
    run = lbr_store.get_run(rid)
    assert run["status"] == "failed" and "Apify" in run["error"] and lbr_store.get_calls(rid) == []


def test_the_page_says_apify_is_what_it_runs_on(world):
    import app as appmod
    c = appmod.app.test_client()
    with c.session_transaction() as sess:
        sess["google_user"] = {"email": ME, "name": "P"}
    body = c.get("/strategic-agents/local-business-radar").get_data(as_text=True)
    assert 'data-ready="true"' in body
    assert "Searches Google Maps across the whole area" in body
    assert "two</em> of them essential" in body
    # How to get an unconnected tool's key, not Python's dict.get method.
    assert "Google Cloud Console: enable" in body and "built-in method" not in body
