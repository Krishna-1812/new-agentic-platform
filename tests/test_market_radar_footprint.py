"""Market Radar for a business with a few sites (tracker/market_radar_footprint).

Core Care Clinic (corecareclinic.com, first live run on 2026-10-10) is a
primary care and behavioural health practice with clinics in Waltham MA,
North Andover MA and Tampa FL. Treated as a chain, its run:

  * rejected Waltham Behavioral Health, North Andover Behavioral Health and
    Greater Boston Psych as "a single site, not a rival to a chain at its
    level";
  * never searched the map around its clinics, so the report had no
    "Nearby" section and the nearby scan was skipped with a wrong note;
  * scored Amazon One Medical's new office in Wellesley, about 10 km from
    the Waltham clinic, last of 21 moves, because a chain's moves are
    scored without distance;
  * filled 14 of 21 moves with Mass General Brigham's research, teaching
    and partnership news, and rated LifeStance's shareholders' $280M share
    sale the one MEDIUM move.

No network and no model: map data, geocoder and Claude are fakes.
"""

import json
import os
import sys
from datetime import datetime, timezone

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import market_radar_footprint as fp  # noqa: E402
from tracker import market_radar_profile as prof  # noqa: E402
from tracker import market_radar_radar as radar  # noqa: E402
from tracker import market_radar_report as report  # noqa: E402
from tracker import market_radar_rivals as rv  # noqa: E402
from tracker import market_radar_signals as S  # noqa: E402
from tests.test_market_radar_rivals import (  # noqa: E402
    Scripted, home, place, verdict)
from tests.test_market_radar_signals import Store, by_id, event  # noqa: E402

NOW = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)
WALTHAM = {"lat": 42.3766, "lon": -71.2359, "precision": "street", "source": "geocoded street address",
           "label": "6, Lexington Street, Central Square, Waltham, Middlesex County, Massachusetts"}
NORTH_ANDOVER = {"lat": 42.6987, "lon": -71.1351, "precision": "street", "city": "North Andover",
                 "source": "geocoded site address", "label": "North Andover clinic"}
TAMPA = {"lat": 27.9506, "lon": -82.4572, "precision": "street", "city": "Tampa",
         "source": "geocoded site address", "label": "Tampa clinic"}
WELLESLEY = {"lat": 42.2965, "lon": -71.2924}

CORE_CARE = {
    "name": "Core Care Clinic", "archetype": "multi_location", "location_count": 3,
    "one_liner": "Integrated primary care and behavioral health clinic for adults and seniors.",
    "offerings": ["Primary care", "Behavioral health and psychiatry", "ADHD evaluation"],
    "customer_type": "B2C", "business_model": "Insurance-accepting medical practice",
    "hq": {"street": "6 Lexington Street", "postal_code": "02452", "city": "Waltham",
           "region": "MA", "country_code": "US"},
    "locations": [
        {"label": "Waltham clinic", "street": "6 Lexington Street", "postal_code": "02452",
         "city": "Waltham", "region": "MA", "country_code": "US"},
        {"label": "North Andover clinic", "street": "", "postal_code": "", "city": "North Andover",
         "region": "MA", "country_code": "US"},
        {"label": "Tampa clinic", "street": "", "postal_code": "", "city": "Tampa", "region": "FL",
         "country_code": "US"}],
    "markets": ["US"], "service_area": "Waltham and North Andover MA, Tampa FL, telehealth",
    "industry": {"plain_label": "Primary care and behavioral health clinic",
                 "keywords": ["primary care", "psychiatry"]},
    "competitors_named": [], "languages": ["en"],
    "facts": {"website": "https://www.corecareclinic.com/", "domain": "corecareclinic.com"},
    "hq_point": WALTHAM, "site_points": [NORTH_ANDOVER, TAMPA],
}
ASPEN = dict(CORE_CARE, name="Aspen Dental", location_count=1000, locations=[], site_points=[])


# == who competes locally ================================================================

@pytest.mark.parametrize("over, local", [
    ({"archetype": "local_single", "location_count": 1}, True),
    ({}, True),                                                      # Core Care: 3 sites
    ({"location_count": fp.SMALL_CHAIN_MAX}, True),
    ({"location_count": fp.SMALL_CHAIN_MAX + 1}, False),
    ({"location_count": 1000}, False),                               # Aspen Dental
    ({"location_count": -1, "site_points": []}, False),              # nothing says: a chain
    ({"location_count": -1}, True),                                  # two located sites
    ({"archetype": "ecommerce"}, False),
    ({"archetype": "b2b_services"}, False),
])
def test_a_few_sites_compete_locally_and_a_chain_does_not(over, local):
    assert fp.serves_locally(dict(CORE_CARE, **over)) is local


def test_sites_put_the_head_office_first_name_it_and_never_repeat_one():
    near_hq = dict(WALTHAM, lat=WALTHAM["lat"] + 0.001, city="Waltham")      # ~110 m away
    points = fp.sites(dict(CORE_CARE, site_points=[near_hq, NORTH_ANDOVER, TAMPA]))
    assert [fp.short_label(p) for p in points] == ["Waltham", "North Andover", "Tampa"]
    assert fp.sites(dict(CORE_CARE, hq_point=None, site_points=[])) == []
    km, p = fp.nearest(points, WELLESLEY["lat"], WELLESLEY["lon"])
    assert fp.short_label(p) == "Waltham" and 8 < km < 12


def test_the_profile_asks_for_every_site_and_calls_a_three_clinic_practice_multi_location():
    assert "locations" in prof.PROFILE_SCHEMA["required"]
    assert "at most 12 physical sites" in prof.SYSTEM and "Never invent an address" in prof.SYSTEM
    assert "clinics in two or three towns" in prof.SYSTEM


def test_each_stated_site_is_geocoded_most_precise_first(monkeypatch):
    asked = []
    answers = {"6 Lexington Street, 02452, Waltham, US": {"lat": 42.3766, "lon": -71.2359, "label": "W"},
               "North Andover, MA, US": {"lat": 42.6987, "lon": -71.1351, "label": "NA"},
               "Tampa, FL, US": {"lat": 27.9506, "lon": -82.4572, "label": "T"}}

    def geocode(q, conn=None):
        asked.append(q)
        return answers.get(q)
    monkeypatch.setattr(prof, "geocode", geocode)
    got = prof.locate_sites(dict(CORE_CARE, site_points=None))
    assert [(p["city"], p["precision"]) for p in got] == [
        ("Waltham", "street"), ("North Andover", "city"), ("Tampa", "city")]
    assert asked[0] == "6 Lexington Street, 02452, Waltham, US"
    # A chain, an online shop and an unlocatable site get no site list.
    assert prof.locate_sites(dict(CORE_CARE, locations=CORE_CARE["locations"] * 2)) == []
    assert prof.locate_sites(dict(CORE_CARE, archetype="ecommerce")) == []
    answers.clear()
    assert prof.locate_sites(CORE_CARE) == []


def test_a_stored_site_list_is_cleaned_like_the_rest_of_the_profile():
    site = {"texts": {}, "signals": {}, "pages": []}
    parsed = dict(CORE_CARE, locations=[{"label": "Tampa — clinic", "street": "", "postal_code": "",
                                         "city": "Tampa", "region": "FL", "country_code": "us"}],
                  evidence=[], unknowns=[], confidence={})
    p = prof.assemble(site, parsed, {})
    assert p["locations"] == [{"label": "Tampa, clinic", "street": "", "postal_code": "",
                               "city": "Tampa", "region": "FL", "country_code": "US"}]


# == the competitor search ===============================================================

class SitePlaces:
    """Overture, by site: what lies near each clinic."""
    SELF_RADIUS_KM = 0.4

    def __init__(self, by_site):
        self.by_site, self.calls = by_site, []

    def query(self, lat, lon, radius_km, categories=(), terms=()):
        self.calls.append((round(lat, 2), radius_km))
        if radius_km == self.SELF_RADIUS_KM:
            return []
        for (slat, slon), rows in self.by_site.items():
            if abs(slat - lat) < 0.05 and abs(slon - lon) < 0.05:
                return rows
        return []


NEAR = {
    (WALTHAM["lat"], WALTHAM["lon"]): [
        place("Waltham Behavioral Health", "https://walthambehavioralhealth.org", 0.8,
              cat="psychiatrist")] + [place("W%d" % i, "https://w%d.example" % i, 2 + i / 10,
                                            cat="doctor") for i in range(9)],
    (NORTH_ANDOVER["lat"], NORTH_ANDOVER["lon"]): [
        place("North Andover Behavioral Health", "https://northandoverbh.com", 1.1,
              cat="psychiatrist")] + [place("N%d" % i, "https://n%d.example" % i, 3 + i / 10,
                                            cat="doctor") for i in range(9)],
    (TAMPA["lat"], TAMPA["lon"]): [
        place("Ibis Healthcare", "https://ibishealthcare.org", 2.4, cat="doctor")]
    + [place("T%d" % i, "https://t%d.example" % i, 4 + i / 10, cat="doctor") for i in range(9)],
}
PLAN = {"place_categories": ["psychiatrist", "doctor"], "place_terms": ["psych"], "radius_km": 5}


def test_the_map_is_searched_around_every_clinic_and_each_find_names_its_site():
    pool = rv.Pool("corecareclinic.com")
    sp = SitePlaces(NEAR)
    meta = rv.from_places(pool, CORE_CARE, PLAN, places=sp)
    assert {lat for lat, r in sp.calls if r != sp.SELF_RADIUS_KM} == {42.38, 42.7, 27.95}
    assert [s["site"] for s in meta["sites"]] == ["Waltham", "North Andover", "Tampa"]
    # Ten places with a website near each clinic, under the cap of 15 a site: all kept.
    assert rv.MIN_PLACES_PER_SITE == 15
    assert all(s["added"] == 10 for s in meta["sites"])
    assert meta["added"] == 30 and meta["categories"] == ["doctor", "psychiatrist"]
    via = pool.items["northandoverbh.com"]["via"][0]
    assert via["near"] == "North Andover" and via["distance_km"] == 1.1
    assert rv._via_label(via) == "on the map 1.1 km from the North Andover site (psychiatrist)"


def test_a_single_site_keeps_the_single_site_search():
    pool = rv.Pool("acme.example")
    one = dict(CORE_CARE, archetype="local_single", location_count=1, site_points=[])
    meta = rv.from_places(pool, one, PLAN, places=SitePlaces(NEAR))
    assert "sites" not in meta and meta["added"] == 10
    assert "near" not in pool.items["walthambehavioralhealth.org"]["via"][0]


def run_core_care(profile, verdicts=None):
    def fake_search(queries, **k):
        return {"results": [], "error": None, "charged_usd": 0.0}
    client = Scripted(verdicts=verdicts or {})
    out = rv.discover(profile, client=client, token="t", search=fake_search,
                      places=SitePlaces(NEAR), reader=home(), fetch=lambda url: {"status": "error"},
                      archive_reader=lambda item: {"status": "error", "note": "no copy"})
    return out, client


def test_one_site_practices_next_to_a_clinic_are_kept_as_rivals():
    out, client = run_core_care(CORE_CARE)
    got = {c["domain"]: c for c in out["competitors"]}
    assert out["coverage"]["places"]["status"] == "ok"
    assert {"walthambehavioralhealth.org", "northandoverbh.com", "ibishealthcare.org"} <= set(got)
    assert got["northandoverbh.com"]["near_site"] == "North Andover"
    assert not [r for r in out["rejected"] if "single site" in (r.get("why") or "")]
    assert len(out["competitors"]) == rv.LIMITS["local_single"]
    # The planner and the ranker are told where the sites are.
    brief = json.loads(client.calls[0]["messages"][0]["content"].split("COMPANY PROFILE:\n", 1)[1])
    assert brief["sites"] == ["Waltham, MA", "North Andover, MA", "Tampa, FL"]
    assert brief["competes_locally"] is True
    assert "write searches for each town" in rv.PLAN_SYSTEM
    assert "near any one of them is local to that site" in rv.RANK_SYSTEM
    assert "nearest of the client's sites" in rv.VERIFY_SYSTEM


def test_a_real_chain_still_drops_single_offices_and_skips_the_map():
    out, _ = run_core_care(ASPEN)
    assert out["coverage"]["places"]["status"] == "not_run"
    assert "up to %d sites" % fp.SMALL_CHAIN_MAX in out["coverage"]["places"]["note"]
    assert {"domain": "rival.example", "site_type": "business",
            "why": "a single site, not a rival to a chain at its level"} in out["rejected"]
    assert rv.too_small_for(verdict("x.example", locations="one"), ASPEN)
    assert not rv.too_small_for(verdict("x.example", locations="one"), CORE_CARE)


def test_a_profile_read_before_sites_were_listed_is_read_again_once():
    from tracker import market_radar_run as mrun
    import tracker.market_radar_store as real
    stored = dict(CORE_CARE)
    stored.pop("site_points")
    built, runs = [], {}
    saved = {k: getattr(real, k) for k in ("get_entity", "update_run", "get_client")}
    real.get_entity = lambda eid: {"profile": stored}
    real.update_run = lambda run_id, **kw: runs.update(kw)
    real.get_client = lambda cid, email: {"settings": {}, "radius_km": None}
    try:
        def build(url, **k):
            built.append(url)
            return {"status": "ok", "profile": CORE_CARE}
        mrun.job(1, "https://www.corecareclinic.com/", "o", 1, 1, True, build_profile=build,
                 discover=lambda p, **k: {"status": "none_found", "competitors": []})
    finally:
        for k, v in saved.items():
            setattr(real, k, v)
    assert built == ["https://www.corecareclinic.com/"]
    assert "predates the list of sites" in runs["summary"]["profile_note"]
    # A profile that already has its sites is reused.
    stored = dict(CORE_CARE)
    built.clear()
    real.get_entity = lambda eid: {"profile": stored}
    real.update_run = lambda run_id, **kw: runs.update(kw)
    real.get_client = lambda cid, email: {"settings": {}, "radius_km": None}
    try:
        mrun.job(2, "https://www.corecareclinic.com/", "o", 1, 1, True,
                 build_profile=lambda url, **k: built.append(url),
                 discover=lambda p, **k: {"status": "none_found", "competitors": []})
    finally:
        for k, v in saved.items():
            setattr(real, k, v)
    assert built == [] and runs["summary"]["profile_note"] == "reused the stored profile"


# == the nearby scan =====================================================================

def test_the_nearby_scan_runs_around_each_site_and_keeps_a_find_once():
    def scan(point):
        name = fp.short_label(point)
        shared = {"key": "p1", "name": "New Psych", "distance_km": 3.0 if name == "Waltham" else 9.0}
        own = {"key": name, "name": "Clinic near " + name, "distance_km": 1.0}
        return {"status": "ok", "note": "%s note" % name, "findings": [dict(shared), own],
                "news": [{"title": "Opening"}], "coverage": {"places_now": 5}}
    got = radar.scan_sites(fp.sites(CORE_CARE), scan)
    assert got["status"] == "ok"
    assert [(f["key"], f["near"]) for f in got["findings"]] == [
        ("Waltham", "Waltham"), ("North Andover", "North Andover"), ("Tampa", "Tampa"),
        ("p1", "Waltham")]
    assert len(got["news"]) == 1
    assert got["note"].startswith("Waltham: Waltham note; North Andover:")
    assert [s["site"] for s in got["coverage"]["sites"]] == ["Waltham", "North Andover", "Tampa"]
    one = radar.scan_sites(fp.sites(CORE_CARE)[:1], scan)
    assert "near" not in one["findings"][0]


def test_a_nearby_find_says_which_site_it_is_near():
    store = Store()
    f = {"key": "p1", "name": "New Psych", "category": "psychiatrist", "distance_km": 1.4,
         "status": "opened", "certain": True, "evidence": ["its website was registered recently"],
         "lat": 42.7, "lon": -71.1, "address": "1 Main St", "near": "North Andover"}
    radar._record(store, 99, "radar_local", {"findings": [f]}, NOW)
    e = next(iter(store.events.values()))
    assert e["title"] == "New nearby: New Psych (psychiatrist, 1.4 km from your North Andover site)"
    assert e["location"]["near"] == "North Andover"


def test_the_nearby_scan_explains_itself_for_a_chain_and_before_a_map_search():
    class S2(Store):
        def latest_run(self, client_id, owner_email):
            return {"summary": {"result": {"coverage": {"places": {"status": "not_run"}}}}}

        def latest_snapshot(self, entity_id, detector):
            return None
    store = S2()
    store.clients[1] = {"entity_id": 99, "domain": "corecareclinic.com", "profile": ASPEN,
                        "settings": {}, "radius_km": None}
    io = {"get": None, "fetch": None, "fetch_home": None}
    out = radar.run_for_client(1, "o", store=store, io=io, now=NOW, places=object())
    assert "chain" in out["local"]["note"] and out["local"]["status"] == "skipped"
    store.clients[1]["profile"] = CORE_CARE
    out = radar.run_for_client(1, "o", store=store, io=io, now=NOW, places=object())
    assert "did not search the map" in out["local"]["note"]
    assert "run a competitor search first" not in out["local"]["note"]


# == scoring =============================================================================

def test_a_move_is_scored_by_its_distance_to_the_nearest_clinic(monkeypatch):
    from tracker import market_radar_views as views
    monkeypatch.setattr(views, "effective_profile", lambda p, s: p)
    store = Store()
    store.clients[1] = {"entity_id": 99, "profile": CORE_CARE, "settings": {}}
    store.comps[1] = [{"entity_id": 10, "kind": "aspirational", "status": "proposed"}]
    store.record_event(10, "k", type="new_location", title="Amazon One Medical opens in Wellesley",
                       source={"url": "u", "detector": "news"}, location={"label": "Wellesley, MA"})
    S.score_client(1, "o", store=store, now=NOW, geocode=lambda q: WELLESLEY)
    link = store.links[(1, 1)]
    assert 8 < link["distance_km"] < 12
    # 25 km or less: 1.25; no chain discount on a rival's new office.
    expected = 8 * S.recency(NOW.date(), NOW) * 1.25 * 0.5 * 0.85
    assert link["score"] == pytest.approx(expected, abs=0.01)
    # Tampa's clinic counts too: an opening there is near, not 2,000 km away.
    rows, _ = S.score_events([event(2, "nearby_opening", location={"lat": 27.96, "lon": -82.46})],
                             tiers={}, now=NOW, points=fp.sites(CORE_CARE))
    assert rows[0]["km"] < 2


def test_peripheral_moves_and_one_companys_flood_count_less():
    evs = [dict(event(1, "partnership"), scope="peripheral"), event(2, "partnership", entity=11)]
    rows, _ = S.score_events(evs, tiers={}, now=NOW)
    assert by_id(rows)[1]["score"] == pytest.approx(by_id(rows)[2]["score"] * S.PERIPHERAL_WEIGHT)
    # Fourteen moves of fourteen types by one health system: each further one
    # counts 0.85 less, so one rival's single move outranks its tenth.
    types = ["partnership", "closed_location", "new_location", "product_launch", "other_move",
             "rebrand", "leadership_change", "promotion", "pricing_change", "layoffs",
             "new_market", "legal_regulatory", "hiring_push", "marketing_campaign"]
    flood = [event(i + 1, t) for i, t in enumerate(types)]
    rival = event(100, "product_launch", entity=11)
    rows, _ = S.score_events(flood + [rival], tiers={}, now=NOW)
    r = by_id(rows)
    tenth = sorted((x for x in rows if x["entity_id"] == 10), key=lambda x: -x["score"])[9]
    assert r[100]["score"] > tenth["score"]


def test_a_shareholders_share_sale_is_not_funding():
    assert "secondary offering" in S._system() and "raises nothing for the company" in S._system()


class ScopeStore(Store):
    def __init__(self):
        super().__init__()
        self.scopes = {}

    def set_event_scope(self, event_id, scope):
        self.scopes[event_id] = scope
        super().set_event_scope(event_id, scope)


class ScopeLLM:
    """Answers only the scope check, with `answer(user)`."""

    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def call_json(self, system, user, schema, *, model, max_tokens, run_id=None, stage, client=None):
        self.calls.append({"stage": stage, "user": user})
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer(user), {}


MGB = {"id": 12, "domain": "massgeneralbrigham.org", "name": "Mass General Brigham"}


def test_each_move_is_judged_core_or_peripheral_once():
    store = ScopeStore()
    a, _ = store.record_event(12, "n1", type="partnership",
                              title="Mass General Brigham and GE HealthCare expand radiation research",
                              source={"url": "u1", "detector": "news"})
    b, _ = store.record_event(12, "n2", type="new_location",
                              title="Mass General Brigham signs lease in Assembly Square",
                              source={"url": "u2", "detector": "news"})

    def answer(user):
        assert "Watched for what it sells: primary care and psychiatry." in user
        return {"moves": [{"ref": "E1", "scope": "core"}, {"ref": "E2", "scope": "peripheral"},
                          {"ref": "E9", "scope": "peripheral"}, {"ref": "E1", "scope": "bogus"}]}
    llm = ScopeLLM(answer)
    row = S.triage_company(MGB, store=store, now=NOW, llm=llm, sells="primary care and psychiatry")
    assert [c["stage"] for c in llm.calls] == ["signals_scope"]          # no headlines: no triage
    assert store.scopes == {b: "core", a: "peripheral"} and row["peripheral"] == 1
    # Judged moves are not sent again.
    S.triage_company(MGB, store=store, now=NOW, llm=llm, sells="primary care and psychiatry")
    assert len(llm.calls) == 1


def test_a_failed_scope_call_judges_nothing():
    store = ScopeStore()
    store.record_event(12, "n1", type="partnership", title="t", source={"url": "u", "detector": "news"})
    S.triage_company(MGB, store=store, now=NOW, llm=ScopeLLM(RuntimeError("down")))
    assert store.scopes == {}
    assert S.scope_moves(MGB, [], llm=ScopeLLM(RuntimeError("never called"))) == {}


def test_the_scope_rules_name_what_a_competitor_does_not_compete_with():
    for rule in ("Research, clinical trials", "university arms", "secondary", "insurance plan",
                 "When unsure, answer core"):
        assert rule in S.SCOPE_SYSTEM, rule


# == the report ==========================================================================

def test_the_report_says_which_clinic_a_nearby_find_and_a_move_are_near():
    n = {"ref": "N1", "name": "New Psych", "category": "psychiatrist", "distance_km": 1.4,
         "near": "North Andover", "status": "opened", "certain": True, "evidence": ["x"]}
    assert "1.4 km from the client's North Andover site" in report.evidence_text(n)
    m = {"ref": "M1", "company": "One Medical", "label": "New location", "status": "opened",
         "date": "2026-07-21", "title": "Amazon One Medical opens in Wellesley", "place": "Wellesley, MA",
         "distance_km": 9.6, "type": "new_location", "summary": None, "sources": []}
    assert "9.6 km from the client (its nearest site)" in report.evidence_text(m)


# == the database ========================================================================

from tests.test_market_radar_store import pg  # noqa: E402,F401  (fixture)


def test_a_moves_scope_is_stored_and_read_back(pg):
    e = pg.upsert_entity("massgeneralbrigham.org", name="Mass General Brigham")
    eid, _ = pg.record_event(e, "news:r1", type="partnership", title="Radiation research deal",
                             source={"url": "https://news.example/r1", "detector": "news"})
    (row,) = pg.recent_events([e])
    assert row["scope"] is None
    pg.set_event_scope(eid, "peripheral")
    (row,) = pg.recent_events([e])
    assert row["scope"] == "peripheral"
    with pytest.raises(ValueError):
        pg.set_event_scope(eid, "unrelated")


# == what the first free run on real data found (2026-10-10) ===========================

def test_the_map_query_sorts_nearest_first_before_its_limit():
    seen = {}

    def runner(sql, params):
        seen["sql"], seen["params"] = sql, params
        return []
    from tracker import market_radar_places as places
    places.query(42.3766, -71.2359, 5, categories=["psychiatry"], terms=["Mental!"],
                 release="2026-09-23.1", runner=runner)
    sql = seen["sql"]
    assert sql.index("ORDER BY") < sql.index("LIMIT")
    assert seen["params"][-4:] == [42.3766, 42.3766, -71.2359, -71.2359]
    # A stem matches at the start of a word, cleaned of anything but [a-z0-9_].
    assert "regexp_matches(basic_category, ?)" in sql and "(^|_)mental" in seen["params"]
    assert "LIKE" not in sql


@pytest.mark.parametrize("category, matches", [
    ("behavioral_or_mental_health_clinic", True), ("mental_health_service", True),
    ("environmental_conservation_organization", False), ("psychiatry", True),
])
def test_a_stem_matches_only_at_the_start_of_a_word(category, matches):
    import re
    stem = {"behavioral_or_mental_health_clinic": "mental", "mental_health_service": "mental",
            "environmental_conservation_organization": "mental", "psychiatry": "psych"}[category]
    assert bool(re.search("(^|_)" + stem, category)) is matches


def test_the_public_map_is_read_unsigned_whatever_aws_keys_are_set():
    import inspect
    from tracker import market_radar_places as places
    src = inspect.getsource(places._connection)
    assert "CREATE OR REPLACE SECRET overture_public" in src and "KEY_ID ''" in src


@pytest.mark.parametrize("domain, own, also, mine", [
    ("corecareclinic.org", "corecareclinic.com", (), True),      # its .org map listing
    ("www.corecareclinic.com", "corecareclinic.com", (), True),
    ("book.corecareclinic.org", "corecareclinic.com", ("corecareclinic.org",), True),
    ("acme.org", "acme.com", (), False),                          # too short a name to tell
    ("acme.co.uk", "acme.com", (), False),
    ("mailclinic.net", "corecareclinic.com", ("mailclinic.net",), True),
    ("onemedical.com", "corecareclinic.com", ("corecareclinic.org",), False),
])
def test_the_clients_own_sites_are_never_its_competitors(domain, own, also, mine):
    assert rv.is_own(domain, own, also) is mine


def test_own_domains_come_from_the_website_and_its_email_but_not_free_mail():
    p = {"facts": {"domain": "corecareclinic.com",
                   "emails": ["appointments@corecareclinic.org", "drsmith@gmail.com", "junk"]}}
    assert rv.own_domains(p) == {"corecareclinic.com", "corecareclinic.org"}
    pool = rv.Pool("corecareclinic.com", rv.own_domains(p))
    assert pool.add("https://www.corecareclinic.org/", "places") is None


def test_the_own_listing_adds_only_its_specific_category_and_keeps_stems_in_its_branch():
    own = dict(place("Core Care Clinic", "https://www.corecareclinic.org/", 0.01,
                     cat="medical_service"), taxonomy="medical_service_organization",
               hierarchy=["health_care", "medical_service", "medical_service_organization"])

    def listed(name, web, km, cat, root):
        return dict(place(name, web, km, cat=cat), hierarchy=[root, cat])
    near = [listed("Psychic Reader", "https://psychic.example", 0.3, "psychic_advising",
                   "arts_and_entertainment"),
            listed("Trail Friends", "https://trail.example", 1.2,
                   "environmental_conservation_organization", "public_service"),
            listed("Real Psych", "https://realpsych.example", 0.8, "psychotherapy", "health_care"),
            listed("Named Cat", "https://named.example", 0.9, "family_practice", "other_root")]

    class P:
        SELF_RADIUS_KM = 0.4

        def __init__(self):
            self.cats = []

        def query(self, lat, lon, radius_km, categories=(), terms=()):
            if radius_km == self.SELF_RADIUS_KM:
                return [own]
            self.cats.append(sorted(categories))
            return near * 3
    p = P()
    pool = rv.Pool("corecareclinic.com", {"corecareclinic.org"})
    one = dict(CORE_CARE, archetype="local_single", location_count=1, site_points=[])
    meta = rv.from_places(pool, one, {"place_categories": ["family_practice"],
                                      "place_terms": ["psych", "mental"], "radius_km": 5},
                          places=p)
    assert p.cats[0] == ["family_practice", "medical_service_organization"]   # not medical_service
    assert meta["own_listing"]["taxonomy"] == "medical_service_organization"
    assert set(pool.items) == {"realpsych.example", "named.example"}
    assert meta["outside_own_category"] == 6


def test_a_suite_number_does_not_stop_the_street_being_found(monkeypatch):
    for street, bare in [("451 Andover Street, Suite 206A", "451 Andover Street"),
                         ("100 Main St Ste 4", "100 Main St"), ("12 High St #3", "12 High St"),
                         ("9 Elm St, Floor 2", "9 Elm St"), ("1 Unity Way", "1 Unity Way"),
                         ("200 Building Rd", "200 Building Rd"), ("77 Suite Lane", "77 Suite Lane")]:
        assert prof.street_only(street) == bare, street
    asked = []

    def geocode(q, conn=None):
        asked.append(q)
        return {"lat": 42.6732, "lon": -71.1267, "label": "451 Andover St"} \
            if q == "451 Andover Street, 01845, North Andover, US" else None
    monkeypatch.setattr(prof, "geocode", geocode)
    loc = {"label": "North Andover", "street": "451 Andover Street, Suite 206A",
           "postal_code": "01845", "city": "North Andover", "region": "MA", "country_code": "US"}
    (site,) = prof.locate_sites(dict(CORE_CARE, locations=[loc]))
    assert site["precision"] == "street" and asked[0].startswith("451 Andover Street, Suite 206A")
    hq = prof.locate_hq({"hq": {"street": "451 Andover Street, Suite 206A", "postal_code": "01845",
                                "city": "North Andover", "country_code": "US"}, "facts": {}})
    assert hq["precision"] == "street"


@pytest.mark.parametrize("text, city, other", [
    ("24/7 community mental health hub to open in Waltham Forest in 2028 Waltham Forest Echo",
     "Waltham", True),
    ("New clinic opens in Waltham Wicked Local", "Waltham", False),
    ("Waltham Forest firm opens a clinic in Waltham, MA", "Waltham", False),
    ("Psychiatry practice opens in Tampa Bay Tampa Bay Times", "Tampa", False),
    ("Clinic opens in North Andover Eagle-Tribune", "North Andover", False),
])
def test_a_town_named_only_inside_another_places_name_is_not_local_news(text, city, other):
    assert radar.names_other_place(text, city) is other


def test_the_clients_own_listing_under_another_ending_is_not_a_new_business_nearby():
    cur = [dict(place("Core Care Clinic", "https://www.corecareclinic.org/", 0.0), id="a"),
           dict(place("New Psych", "https://newpsych.example", 1.0), id="b")]
    fresh = radar.new_listings(cur, [], own_domain="corecareclinic.com")
    assert [p["id"] for p in fresh] == ["b"]


def test_directories_of_therapists_are_never_candidates():
    for d in ("psychologytoday.com", "www.psychologytoday.com", "webmd.com", "vitals.com"):
        assert rv.skip_domain(d), d


# == the second paid run (2026-10-10): Waltham's places were home care ===================

def test_the_closest_kind_of_business_fills_a_sites_places_before_a_broader_branch():
    def listed(name, km, tax, basic, h):
        return dict(place(name, "https://%s.example" % name.lower().replace(" ", ""), km, cat=basic),
                    taxonomy=tax, hierarchy=h)
    home = [listed("Home Care %d" % i, 0.1 + i / 100, "home_health_care", "medical_service",
                   ["health_care", "medical_service", "home_health_care"]) for i in range(20)]
    psych = [listed("Psych %d" % i, 3 + i / 10, "psychiatry", "behavioral_or_mental_health_clinic",
                    ["health_care", "outpatient_care_facility", "behavioral_or_mental_health_clinic",
                     "psychiatry_or_psychology_service", "psychiatry"]) for i in range(5)]
    word = [listed("Mental Word", 0.05, "mental_wellness_coach", "health_care",
                   ["health_care", "mental_wellness_coach"])]
    assert rv.match_tier(psych[0], {"psychiatry", "medical_service"}) == 0
    assert rv.match_tier(home[0], {"psychiatry", "medical_service"}) == 1
    assert rv.match_tier(word[0], {"psychiatry", "medical_service"}) == 2

    class P:
        SELF_RADIUS_KM = 0.4

        def query(self, lat, lon, radius_km, categories=(), terms=()):
            return [] if radius_km == self.SELF_RADIUS_KM else home + psych + word
    pool = rv.Pool("corecareclinic.com")
    meta = rv.from_places(pool, CORE_CARE, {"place_categories": ["psychiatry", "medical_service"],
                                            "place_terms": ["mental"], "radius_km": 5}, places=P())
    waltham = meta["sites"][0]
    # All five psychiatry practices first though 3 km away, then the nearest home care.
    assert waltham["by_match"] == {"own_category": 5, "broader_branch": 10, "word_only": 0}
    assert all(d in pool.items for d in ("psych0.example", "psych4.example"))


def test_the_page_shows_what_the_map_was_asked_for_and_which_site_a_rival_is_near():
    from tracker import market_radar_views as views
    run = {"id": 1, "status": "complete", "stage": "done", "error": None, "summary": {"result": {
        "coverage": {"places": {"status": "ok", "categories": ["psychiatry"], "terms": ["psych"],
                                "own_listing": {"taxonomy": "medical_service_organization"},
                                "sites": [{"site": "Waltham"}], "outside_own_category": 3}},
        "plan": {"place_categories": ["psychiatry"], "radius_km": 10, "queries": []}}}}
    v = views.run_view(run)
    assert v["sources"]["places"]["categories"] == ["psychiatry"]
    assert v["sources"]["places"]["own_listing"]["taxonomy"] == "medical_service_organization"
    assert v["sources"]["places"]["outside_own_category"] == 3
    assert v["plan"]["radius_km"] == 10
    import inspect
    assert '"near_site": d.get("near_site")' in inspect.getsource(views.competitor_rows)
