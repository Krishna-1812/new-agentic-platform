"""Local Business Radar, phase 2: business type, location, and the ceiling."""

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

from tracker import lbr_claude, lbr_config, lbr_http, lbr_intake  # noqa: E402
from lbr_fakes import FakeResponse, FakeSession  # noqa: E402


@pytest.fixture
def env(monkeypatch):
    for v in ("GOOGLE_MAPS_API_KEY", "SERPAPI_KEY", "ANTHROPIC_API_KEY", "APIFY_API_TOKEN",
              "LBR_PRICES_JSON", "PAGESPEED_API_KEY"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "maps-key")
    lbr_intake._PLAN_CACHE.clear()
    return monkeypatch


@pytest.fixture
def fake(monkeypatch):
    s = FakeSession()
    monkeypatch.setattr(lbr_http, "_SESSION", s)
    monkeypatch.setattr(lbr_http.time, "sleep", lambda s: None)
    return s


def _place(name, types, formatted, comps, vp=((30.1, -97.9), (30.5, -97.5)), loc=(30.27, -97.74)):
    return {"id": "loc-" + name, "displayName": {"text": name}, "formattedAddress": formatted,
            "types": types, "location": {"latitude": loc[0], "longitude": loc[1]},
            "viewport": {"low": {"latitude": vp[0][0], "longitude": vp[0][1]},
                         "high": {"latitude": vp[1][0], "longitude": vp[1][1]}},
            "addressComponents": [{"longText": l, "shortText": s, "types": t} for l, s, t in comps]}


AUSTIN = _place("Austin", ["locality", "political"], "Austin, TX, USA",
                [("Austin", "Austin", ["locality"]), ("Travis County", "Travis County", ["administrative_area_level_2"]),
                 ("Texas", "TX", ["administrative_area_level_1"]), ("United States", "US", ["country"])])
TEXAS = _place("Texas", ["administrative_area_level_1", "political"], "Texas, USA",
               [("Texas", "TX", ["administrative_area_level_1"]), ("United States", "US", ["country"])],
               vp=((25.8, -106.6), (36.5, -93.5)))


# ── Google's categories ──────────────────────────────────────────────────────

def test_every_curated_vertical_only_uses_real_google_categories():
    for label, aliases, types, queries, sab in lbr_intake.VERTICALS:
        for t in types:
            assert t in lbr_intake.PLACE_TYPES, "%s: %s is not a Table A type" % (label, t)
        assert queries and aliases, label


def test_the_category_list_is_googles_table_a_with_its_source():
    doc = lbr_intake._TYPES_DOC
    assert doc["source"].startswith("https://developers.google.com/maps/")
    assert {"dentist", "plumber", "hair_salon", "italian_restaurant"} <= lbr_intake.PLACE_TYPES
    assert "locality" not in lbr_intake.PLACE_TYPES, "areas are not businesses"


# ── Business type ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("typed,types,label", [
    ("dentist", ["dentist", "dental_clinic"], "Dentists"),
    ("Dentists", ["dentist", "dental_clinic"], "Dentists"),
    ("  a local Plumber ", ["plumber"], "Plumbers"),
    ("HVAC", [], "HVAC contractors"),
    ("law firms", ["lawyer"], "Lawyers"),
])
def test_curated_verticals_resolve_without_a_model(env, typed, types, label):
    ledger = lbr_http.Ledger()
    bt = lbr_intake.resolve_business_type(typed, ledger)
    assert bt["types"] == types and bt["label"] == label and bt["source"] == "curated"
    assert ledger.totals()["calls"] == 0


def test_trades_are_searched_with_service_area_businesses():
    assert lbr_intake.resolve_business_type("plumber", lbr_http.Ledger())["service_area"] is True
    assert lbr_intake.resolve_business_type("dentist", lbr_http.Ledger())["service_area"] is False


def test_a_phrase_that_is_itself_a_google_category_is_used_directly(env):
    bt = lbr_intake.resolve_business_type("thai restaurant", lbr_http.Ledger())
    assert bt["types"] == ["thai_restaurant"] and bt["source"] == "google_category"


def test_an_unknown_type_goes_to_claude_and_invented_categories_are_dropped(env, monkeypatch):
    env.setenv("ANTHROPIC_API_KEY", "k")
    seen = {}

    def fake_ask(system, user, ledger, **kw):
        seen["user"] = user
        return {"label": "Aquarium stores", "types": ["pet_store", "fish_emporium"],
                "queries": ["aquarium store", "fish store", "third"], "service_area": False}
    monkeypatch.setattr(lbr_claude, "ask_json", fake_ask)
    bt = lbr_intake.resolve_business_type("aquarium shops", lbr_http.Ledger())
    assert bt["types"] == ["pet_store"], "a category Google would reject is never sent"
    assert bt["queries"] == ["aquarium store", "fish store"] and bt["source"] == "claude"
    assert "Table A types" in seen["user"] and "pet_store" in seen["user"]


def test_without_claude_an_unknown_type_is_searched_as_typed(env):
    bt = lbr_intake.resolve_business_type("aquarium shops", lbr_http.Ledger())
    assert bt == {"label": "aquarium shops", "types": [], "queries": ["aquarium shops"],
                  "service_area": False, "source": "phrase_only", "input": "aquarium shops"}


def test_a_failing_claude_falls_back_to_the_phrase(env, monkeypatch):
    env.setenv("ANTHROPIC_API_KEY", "k")

    def boom(*a, **k):
        raise lbr_claude.ClaudeError("down")
    monkeypatch.setattr(lbr_claude, "ask_json", boom)
    assert lbr_intake.resolve_business_type("aquarium shops", lbr_http.Ledger())["source"] == "phrase_only"


@pytest.mark.parametrize("bad", ["", "x", "y" * 81])
def test_a_business_type_must_be_a_sensible_length(env, bad):
    with pytest.raises(lbr_intake.IntakeError):
        lbr_intake.resolve_business_type(bad, lbr_http.Ledger())


# ── Location ─────────────────────────────────────────────────────────────────

def test_a_city_resolves_to_its_viewport_and_keeps_its_metro(env, fake):
    fake.on("places:searchText", FakeResponse(200, {"places": [AUSTIN]}))
    ledger = lbr_http.Ledger()
    area = lbr_intake.resolve_location("Austin, TX", ledger)
    assert area["kind"] == "city" and area["name"] == "Austin" and area["admin1"] == "TX"
    assert area["country"] == "US" and area["filter"] == "none"
    assert area["viewport"] == {"low": {"lat": 30.1, "lng": -97.9}, "high": {"lat": 30.5, "lng": -97.5}}
    req = fake.requests[0]
    assert req["headers"]["X-Goog-Api-Key"] == "maps-key"
    assert "places.viewport" in req["headers"]["X-Goog-FieldMask"]
    assert req["json"]["textQuery"] == "Austin, TX"
    assert ledger.totals()["usd"] == pytest.approx(0.032)


def test_a_state_is_filtered_to_itself(env, fake):
    fake.on("places:searchText", FakeResponse(200, {"places": [TEXAS]}))
    area = lbr_intake.resolve_location("Texas", lbr_http.Ledger())
    assert area["kind"] == "state" and area["filter"] == "admin1" and area["admin1"] == "TX"


def test_a_business_that_shares_the_name_is_skipped_for_the_place(env, fake):
    shop = {"id": "x", "displayName": {"text": "Austin Dental"}, "types": ["dentist"]}
    fake.on("places:searchText", FakeResponse(200, {"places": [shop, AUSTIN]}))
    assert lbr_intake.resolve_location("Austin", lbr_http.Ledger())["name"] == "Austin"


def test_a_country_is_refused(env, fake):
    usa = _place("United States", ["country", "political"], "USA", [("United States", "US", ["country"])])
    fake.on("places:searchText", FakeResponse(200, {"places": [usa]}))
    with pytest.raises(lbr_intake.IntakeError, match="country"):
        lbr_intake.resolve_location("USA", lbr_http.Ledger())


def test_an_unknown_place_is_said_plainly(env, fake):
    fake.on("places:searchText", FakeResponse(200, {}))
    with pytest.raises(lbr_intake.IntakeError, match="could not find"):
        lbr_intake.resolve_location("Nowhereville", lbr_http.Ledger())


def test_without_a_places_key_the_area_cannot_be_found(env):
    env.delenv("GOOGLE_MAPS_API_KEY")
    with pytest.raises(lbr_intake.IntakeError, match="GOOGLE_MAPS_API_KEY"):
        lbr_intake.resolve_location("Austin", lbr_http.Ledger())


# ── The ceiling ──────────────────────────────────────────────────────────────

def test_the_estimate_is_a_priced_ceiling_that_grows_with_the_area_and_cap(env):
    bt = {"types": ["dentist", "dental_clinic"], "queries": ["dentist"]}
    city = lbr_intake.estimate("city", 100, bt)
    state = lbr_intake.estimate("state", 100, bt)
    bigger = lbr_intake.estimate("city", 200, bt)
    assert state["usd_max"] > city["usd_max"] and bigger["usd_max"] > city["usd_max"]
    assert city["discovery_requests"] == 180
    serp = next(l for l in city["lines"] if l["provider"] == "serpapi")
    assert serp["units"] == 100 * (lbr_config.MAX_REVIEW_PAGES + 2)
    assert serp["usd"] == pytest.approx(100 * (lbr_config.MAX_REVIEW_PAGES + 2) * 0.015)
    assert city["usd_max"] == pytest.approx(round(sum(l["usd"] or 0 for l in city["lines"]), 2))
    assert not any(l["provider"] == "apify" for l in city["lines"]), "an unset optional tool costs nothing"


@pytest.mark.parametrize("given,cap", [(None, 200), ("50", 50), (5, 10), (10_000, 500), ("lots", 200)])
def test_the_cap_is_clamped(given, cap):
    assert lbr_intake.clamp_cap(given if given is not None else lbr_config.DEFAULT_CAP) == cap


# ── The whole plan, and the route ────────────────────────────────────────────

def test_a_preview_then_a_start_resolves_the_inputs_once(env, fake):
    fake.on("places:searchText", FakeResponse(200, {"places": [AUSTIN]}))
    first = lbr_intake.cached_plan("p@markifydigital.com", "Dentists", "Austin, TX", "seo", 60)
    again = lbr_intake.cached_plan("p@markifydigital.com", "dentists", "austin, tx", "all", 120)
    assert len(fake.requests) == 1
    assert again["cached"] and again["cap"] == 120 and again["focus"] == "all"
    assert again["area"] == first["area"] and again["planning_cost"]["usd"] == 0
    lbr_intake.cached_plan("someone@markifydigital.com", "dentists", "Austin, TX")
    assert len(fake.requests) == 2, "another user's preview is not shared"


def test_the_plan_route(env, fake):
    import app as appmod
    fake.on("places:searchText", FakeResponse(200, {"places": [AUSTIN]}))
    c = appmod.app.test_client()
    with c.session_transaction() as s:
        s["google_user"] = {"email": "priya@markifydigital.com", "name": "P"}
    r = c.post("/strategic-agents/local-business-radar/plan",
               json={"business_type": "dentist", "location": "Austin, TX", "focus": "website", "cap": 80})
    d = r.get_json()
    assert r.status_code == 200 and d["area"]["kind"] == "city" and d["cap"] == 80
    assert d["focus_label"] == "Website build" and d["estimate"]["usd_max"] > 0
    bad = c.post("/strategic-agents/local-business-radar/plan", json={"business_type": "x", "location": "Austin"})
    assert bad.status_code == 400 and "2 to 80" in bad.get_json()["error"]
    wrong = c.post("/strategic-agents/local-business-radar/plan",
                   json={"business_type": "dentist", "location": "Austin", "focus": "everything"})
    assert wrong.status_code == 400
