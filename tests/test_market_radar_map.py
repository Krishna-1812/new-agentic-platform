"""Market Radar's map of the client's sites and its rivals: where each pin comes from
(tracker/market_radar_map.py) and what the page script draws (static/js/market_radar_map.js, run under Node).

No network, no model, no Postgres: the store and the geocoder are fakes. The map drawing itself (Leaflet and the
tiles) was checked in a real browser; what is tested here is everything that decides which pins there are.
"""
import json
import os
import shutil
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tracker import market_radar_map as M  # noqa: E402
from tracker import market_radar_views as views  # noqa: E402

JS = os.path.join(ROOT, "static", "js", "market_radar_map.js")
OWNER = "owner@example.com"


class FakeStore:
    class StoreUnavailable(Exception):
        pass

    def __init__(self, rows, cache=None, profile=None, run=None):
        self.rows, self.cache, self.run = rows, dict(cache or {}), run
        self.profile = profile or {"name": "Acme", "archetype": "local_single",
                                   "hq": {"city": "Tampa"},
                                   "hq_point": {"lat": 27.95, "lon": -82.45, "precision": "street", "city": "Tampa"}}

    def get_client(self, client_id, owner, conn=None):
        return {"profile": self.profile, "settings": {}, "name": "Acme", "domain": "acme.example"} if client_id == 1 else None

    def competitors(self, client_id, owner, include_removed=False, conn=None):
        return self.rows

    def found_in_runs(self, *a, **k):
        return {}

    def cached_geocode(self, text, conn=None):
        return self.cache.get(text)

    def latest_run(self, client_id, owner, **k):
        return self.run


def row(i, name, *, status="proposed", kind="direct", location=None, lat=None, lon=None, distance=None):
    d = {"location": location, "lat": lat, "lon": lon, "distance_km": distance, "score": 70}
    return {"entity_id": i, "domain": "%s.example" % name.lower(), "name": name, "kind": kind, "status": status,
            "confidence": 0.7, "found_via": ["x"], "details": d, "updated_at": None}


@pytest.fixture
def view_of(monkeypatch):
    def run(rows, *, cache=None, geocode=None, budget=M.MAX_LOOKUPS, **kw):
        fake = FakeStore(rows, cache, **kw)
        monkeypatch.setattr(views, "store", fake)
        return M.map_view(1, OWNER, store=fake, geocode=geocode or (lambda text: None), budget=budget)
    return run


# == where each pin comes from ==================================================================

def test_what_is_worth_looking_up_as_a_place():
    assert M.place_text("  Tampa,  FL ") == "Tampa, FL"
    assert M.place_text("12 Bay St, Tampa") == "12 Bay St, Tampa"
    for not_a_place in ("", None, "Online only", "Global", "worldwide", "Nationwide (online)", "unclear", "N/A",
                        "not stated", "123", "x" * 200):
        assert M.place_text(not_a_place) == "", not_a_place


def test_a_rival_the_map_lists_is_pinned_where_the_map_lists_it_and_never_looked_up(view_of):
    out = view_of([row(2, "Near", kind="local", location="1 Bay St, Tampa", lat=27.96, lon=-82.46, distance=1.4)],
                  geocode=lambda text: pytest.fail("a listing needs no lookup"))
    (pin,) = out["rivals"]
    assert (pin["lat"], pin["lon"], pin["how"], pin["distance_km"]) == (27.96, -82.46, "map listing", 1.4)
    assert out["unplaced"] == [] and out["pending"] == 0
    assert out["you"] == [{"name": "Tampa", "lat": 27.95, "lon": -82.45, "precision": "street", "head_office": True}]


def test_a_stated_town_is_looked_up_and_labelled_as_a_town(view_of):
    seen = []
    out = view_of([row(2, "Shop", location="Portland, OR")],
                  geocode=lambda text: seen.append(text) or {"lat": 45.52, "lon": -122.68, "label": "Portland"})
    (pin,) = out["rivals"]
    assert seen == ["Portland, OR"] and (pin["how"], pin["place"]) == ("stated location", "Portland, OR")


def test_a_rival_with_no_base_or_an_unfound_town_is_listed_not_placed(view_of):
    out = view_of([row(2, "Online", location="Online only"), row(3, "Lost", location="Nowhereville"),
                   row(4, "Blank")], geocode=lambda text: None)
    assert out["rivals"] == []
    assert {u["name"]: u["why"] for u in out["unplaced"]} == {
        "Online": "no base is stated", "Blank": "no base is stated", "Lost": "its location was not found"}


def test_a_cached_town_costs_no_lookup_and_a_miss_that_was_cached_stays_unplaced(view_of):
    cache = {"Austin, TX": {"point": {"lat": 30.27, "lon": -97.74}}, "Atlantis": {"point": None}}
    out = view_of([row(2, "A", location="Austin, TX"), row(3, "B", location="Atlantis")], cache=cache,
                  geocode=lambda text: pytest.fail("both were cached"))
    assert [p["name"] for p in out["rivals"]] == ["A"] and [u["name"] for u in out["unplaced"]] == ["B"]


def test_lookups_in_one_call_are_capped_and_the_rest_are_pending(view_of):
    rows = [row(i, "R%d" % i, location="Town %d" % i) for i in range(2, 12)]
    calls = []
    out = view_of(rows, geocode=lambda text: calls.append(text) or {"lat": 40.0, "lon": -100.0}, budget=4)
    assert len(calls) == 4 and len(out["rivals"]) == 4 and out["pending"] == 6
    again = view_of(rows, cache={t: {"point": {"lat": 40.0, "lon": -100.0}} for t in calls},
                    geocode=lambda text: {"lat": 41.0, "lon": -101.0}, budget=4)
    assert len(again["rivals"]) == 8 and again["pending"] == 2, "the earlier four cost nothing the second time"


def test_removed_rivals_are_left_off_and_an_unknown_client_is_none(view_of, monkeypatch):
    out = view_of([row(2, "Gone", status="removed", lat=27.9, lon=-82.4), row(3, "Here", lat=27.9, lon=-82.4)])
    assert [p["name"] for p in out["rivals"]] == ["Here"] and out["unplaced"] == []
    assert M.map_view(99, OWNER, store=FakeStore([])) is None


def test_only_a_local_business_gets_a_search_radius(view_of):
    run = {"summary": {"result": {"coverage": {"places": {"categories": ["dental_clinic"], "radius_km": 8}}}}}
    assert view_of([], run=run)["radius_km"] == 8 and view_of([], run=run)["local"] is True
    shop = {"name": "Shop", "archetype": "ecommerce", "hq": {"city": "Portland"},
            "hq_point": {"lat": 45.5, "lon": -122.7, "precision": "city"}}
    out = view_of([], run=run, profile=shop)
    assert out["radius_km"] is None and out["local"] is False and len(out["you"]) == 1


def test_a_corrupt_coordinate_is_never_pinned(view_of):
    out = view_of([row(2, "Bad", lat=999, lon=5), row(3, "Zero", lat=0, lon=0), row(4, "Text", lat="x", lon="y")])
    assert out["rivals"] == [] and len(out["unplaced"]) == 3


# == what the page script draws =================================================================

def run_js(expr):
    if shutil.which("node") is None:
        pytest.skip("node is not installed")
    prog = ("globalThis.window = globalThis; require(%s); const M = globalThis.MRMap;\n"
            "process.stdout.write(JSON.stringify((() => { %s })()));") % (json.dumps(JS), expr)
    proc = subprocess.run([shutil.which("node"), "-e", prog], capture_output=True, text=True, timeout=30)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


DATA = {"name": "Acme", "local": True, "radius_km": 5, "pending": 0,
        "you": [{"name": "Tampa", "lat": 27.95, "lon": -82.45, "head_office": True}],
        "rivals": [
            {"entity_id": 1, "name": "Low", "domain": "low.example", "kind": "local", "status": "confirmed", "score": 50, "lat": 27.9, "lon": -82.4},
            {"entity_id": 2, "name": "High", "domain": "high.example", "kind": "direct", "status": "proposed", "score": 90, "lat": 27.91, "lon": -82.41, "how": "stated location"},
            {"entity_id": 3, "name": "Removed", "domain": "r.example", "kind": "direct", "status": "confirmed", "score": 99, "lat": 27.9, "lon": -82.4},
            {"entity_id": 4, "name": "Nowhere", "domain": "n.example", "kind": "direct", "status": "confirmed", "score": 60, "lat": 123, "lon": 5},
            {"entity_id": 5, "name": "Odd", "domain": "o.example", "kind": "mystery", "status": "confirmed", "score": 10, "lat": 27.8, "lon": -82.3}],
        "unplaced": [{"entity_id": 6, "name": "Online", "domain": "online.example", "kind": "indirect"},
                     {"entity_id": 7, "name": "Dropped", "domain": "d.example", "kind": "indirect"}]}


def test_the_pins_are_the_valid_unremoved_rivals_best_first_with_counts():
    out = run_js("""return M.prepare(%s, {status: (id, s) => id === 3 || id === 7 ? 'removed' : s});""" % json.dumps(DATA))
    assert [p["name"] for p in out["pins"]] == ["High", "Low", "Odd"]
    assert out["pins"][2]["kind"] == "direct", "an unknown kind is drawn as direct, not dropped"
    assert out["counts"] == {"direct": 2, "local": 1}
    assert [u["name"] for u in out["unplaced"]] == ["Online"], "a removed rival is not listed as unplaced either"
    assert out["radius_km"] == 5 and out["local"] is True and out["you"][0]["head"] is True


def test_new_nearby_places_are_marks_only_when_confirmed_opening_or_planned():
    opened = [{"name": "A", "lat": 1, "lon": 2, "status": "opened"}, {"name": "B", "lat": 1, "lon": 2, "status": "planned"},
              {"name": "C", "lat": 1, "lon": 2, "status": "unknown"}, {"name": "D", "lat": 1, "lon": 2, "status": "unknown", "certain": True},
              {"name": "E", "status": "opened"}, {"name": "F", "lat": 200, "lon": 2, "status": "opened"}]
    out = run_js("return M.prepare({}, {opened: %s}).opened.map(o => o.name);" % json.dumps(opened))
    assert out == ["A", "B", "D"]


def test_the_note_says_what_is_pinned_what_is_not_and_how_precise_a_pin_is():
    note = run_js("return M.noteOf(M.prepare(%s, {}));" % json.dumps(DATA))
    assert note.startswith("4 rivals on the map") and "2 not placed (Online, Dropped): no base is stated" in note
    assert "A pin at the town a website states is a town, not a street." in note
    many = dict(DATA, unplaced=[{"name": "U%d" % i} for i in range(5)], pending=2)
    note = run_js("return M.noteOf(M.prepare(%s, {}));" % json.dumps(many))
    assert "5 not placed (U0, U1, U2 and 2 more)" in note and "placing 2 more" in note
    assert run_js("return M.noteOf(M.prepare({rivals: [{entity_id: 1, name: 'A', kind: 'direct', lat: 1, lon: 1, how: 'map listing'}]}, {}));") == "1 rival on the map."


def test_pins_that_would_overlap_become_one_counted_pin():
    groups = run_js("return M.group([{x: 10, y: 10}, {x: 20, y: 15}, {x: 200, y: 200}, {x: 205, y: 190}, {x: 90, y: 90}], 34);")
    assert groups == [[0, 1], [2, 3], [4]]
    assert run_js("return M.group([], 34);") == []


def test_distance_between_two_places():
    km = run_js("return M.km({lat: 27.95, lon: -82.45}, {lat: 28.05, lon: -82.45});")
    assert 10.5 < km < 11.7


def test_the_slot_says_what_is_missing_and_escapes_what_it_shows():
    evil = "<img src=x onerror=alert(1)>"
    out = run_js("""const slot = () => ({innerHTML: ''}); const r = {};
        let s = slot(); M.attach(s, null, {}); r.wait = s.innerHTML;
        s = slot(); M.attach(s, {error: %s}, {}); r.error = s.innerHTML;
        s = slot(); M.attach(s, {you: [], rivals: [], unplaced: []}, {}); r.empty = s.innerHTML;
        s = slot(); M.attach(s, {you: [], rivals: [], unplaced: [{name: 'A'}, {name: 'B'}]}, {}); r.none_based = s.innerHTML;
        s = slot(); M.attach(s, {you: [], rivals: [{entity_id: 1, name: %s, domain: 'x.example', kind: 'direct', lat: 1, lon: 2, place: %s}], unplaced: []}, {});
        r.fallback = s.innerHTML; return r;""" % (json.dumps(evil), json.dumps(evil), json.dumps(evil)))
    assert "Placing your rivals on the map" in out["wait"]
    assert "could not be loaded" in out["error"] and "<img" not in out["error"]
    assert "Nothing to put on a map yet" in out["empty"] and "Search again" in out["empty"]
    assert "None of the 2 rivals states where it is based" in out["none_based"]
    assert "could not start in this browser" in out["fallback"] and "<img" not in out["fallback"]
    assert "&lt;img" in out["fallback"], "without Leaflet the rivals are listed, escaped"
