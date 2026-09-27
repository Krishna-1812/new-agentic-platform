"""Local Business Radar: who gets researched. Found in a real run (dentists in
New York, 50 researched): every lead was a business with no website, four were
call-routing listings, and map rank was a blank that could mean anything."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import lbr_discover as D, lbr_intake as I, lbr_report, lbr_score  # noqa: E402

DENTISTS = I.resolve_business_type("Dentists", None)


def _p(name, category="Dentist", site="", rating=4.2, reviews=40, address="1 Main St, New York, NY"):
    return {"name": name, "category": category, "categories": [], "address": address, "website": site,
            "rating": rating, "reviews": reviews, "status": "OPERATIONAL", "lat": None, "lng": None,
            "hours": None, "photos_seen": 0, "service_area_only": not address, "source": "apify"}


def _plan(cap, focus="all"):
    return {"business": DENTISTS, "area": {"name": "New York", "formatted": "New York, United States",
                                           "filter": "none", "kind": "city"},
            "focus": focus, "cap": cap, "estimate": {"source": "apify"}}


def _world():
    ps = {}
    for i in range(60):                      # sixty with no website at all
        ps["n%d" % i] = _p("Nosite Dental %d" % i, reviews=20 + i)
    for i in range(60):                      # sixty with a site, some badly rated
        ps["s%d" % i] = _p("Site Dental %d" % i, site="https://s%d.example" % i, rating=3.0 + i / 30, reviews=50 + i)
    return ps


def test_selling_everything_researches_a_mix_not_only_the_site_less():
    out = D._finish(_plan(20), _world(), {})
    sel, P = out["selected"], out["profiles"]
    with_site = sum(1 for p in sel if P[p]["website"])
    assert 6 <= with_site <= 16, with_site
    assert any((P[p]["rating"] or 5) < 3.5 for p in sel), "the worst-rated get a reputation slot"


def test_one_service_still_takes_the_best_for_it():
    out = D._finish(_plan(20, "website"), _world(), {})
    assert all(not out["profiles"][p]["website"] for p in out["selected"])
    out = D._finish(_plan(20, "reputation"), _world(), {})
    assert max(out["profiles"][p]["rating"] for p in out["selected"]) < 3.7


def test_a_dental_speciality_or_a_miscategorised_practice_is_kept_and_others_dropped():
    terms = D.relevance_terms(DENTISTS)
    assert D.relevant(_p("Bright Smiles", category="Orthodontist"), terms)
    assert D.relevant(_p("Park Oral Surgery", category="Oral surgeon"), terms)
    assert D.relevant(_p("Longwood Dental Office.", category="Medical clinic"), terms), "Google's category is wrong"
    assert not D.relevant(_p("Joe's Pizza", category="Pizza restaurant"), terms)
    assert not D.relevant(_p("Acme Insurance", category="Insurance agency"), terms)


def test_off_category_results_are_dropped_and_counted():
    ps = _world()
    ps["x1"] = _p("Joe's Pizza", category="Pizza restaurant")
    ps["x2"] = _p("Acme Insurance", category="Insurance agency")
    out = D._finish(_plan(10), ps, {})
    assert out["stats"]["off_category"] == 2 and "x1" not in out["profiles"]


def test_law_is_not_lawn():
    terms = D.relevance_terms(I.resolve_business_type("lawyers", None))
    assert D.relevant(_p("Smith & Co", category="Law firm"), terms)
    assert not D.relevant(_p("Green Lawn", category="Lawn care service"), terms)


def test_call_routing_listings_are_set_aside():
    words = D._listing_words(_plan(10))
    assert D.lead_listing(_p("Emerrgency Dentist Solutions", reviews=0, address=""), words)
    assert D.lead_listing(_p("Emergency dentist services in NYC", reviews=0), words)
    assert D.lead_listing(_p("Dentist office", reviews=0), words)
    assert not D.lead_listing(_p("Vanita Dentist", reviews=0), words), "a named new practice is a real lead"
    assert not D.lead_listing(_p("Dentist office", reviews=12), words), "reviews mean real customers"
    ps = _world()
    ps["spam"] = _p("Emergency dentist services in NYC", reviews=0)
    out = D._finish(_plan(10), ps, {})
    assert out["stats"]["listings"] == 1 and "spam" not in out["selected"] and out["profiles"]["spam"]["set_aside"]


def test_map_rank_never_leaves_an_unexplained_blank():
    cell = lbr_report.map_rank_cell
    assert cell({"rank": 2, "in_pack": True}) == 2
    assert cell({"rank": None, "in_pack": False, "depth": 5}) == "Not in top 5"
    assert cell({"rank": None, "in_pack": None, "error": "No map results came back"}) == "Not checked"
    assert cell({"rank": None, "note": "Service-area business: no storefront to rank from."}) == \
        "Not checked (no storefront)"


def test_photo_counts_read_as_english():
    import inspect
    src = inspect.getsource(lbr_score)
    assert "Only %s photos on their Google profile." not in src
