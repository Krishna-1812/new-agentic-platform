"""Market Radar precision: the niche, who it sells to, and holding a rival to it.

The case that started this: a men's brand whose whole site says Pima cotton, modal and bamboo, zero
polyester, was profiled as "men's innerwear". That is the category, not the niche, and the competitors,
the buyer and the report all followed the category. These tests use a trimmed copy of that brand's public
home page (its own marketing words) and fake models: nothing here spends anything.
"""
import json
import os
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import market_radar_niche as niche  # noqa: E402
from tracker import market_radar_profile as prof  # noqa: E402
from tracker import market_radar_report as report  # noqa: E402
from tracker import market_radar_rivals as rv  # noqa: E402
from tracker import market_radar_site as site_reader  # noqa: E402
from tracker import market_radar_views as views  # noqa: E402
from tests.test_market_radar_profile import FakeClient, reply  # noqa: E402
from tests.test_market_radar_rivals import (  # noqa: E402
    PROFILE, Scripted, plan_body, run_discover, verdict)

HOME = "https://julymode.example/"
TEXT = """Men's Pima Cotton, Modal & Bamboo Essentials. Skip to content. New: the Thermal Cotton Crew.
Plant fibers. Zero polyester. Designed in the USA, Made in India. Wear Healthy. Plant fibers. Zero polyester.
Men's essentials in Pima cotton, modal, bamboo and long-staple cotton. Shop best sellers. New arrivals.
Shop by category: Polos & Shirts, Boxer Briefs, Sweatshirts & Hoodies, Crews & Henleys.
Eco-Luxe Boxer Brief $20. Stain-Free Polo $42. 6-pack: 6 Eco-Luxe Boxer Briefs $66 $120. Classic Crew $38.
Pima Polo $48. Three fibers, chosen for how they feel.
Cotton: Pima and DCH-32 long-staple cotton. Soft from day one, and it holds its shape. Shop cotton.
Modal: made from beech wood pulp. Smooth, cool and soft against the skin. Shop modal.
Bamboo: bamboo viscose. Light, breathable and easy to care for. Shop bamboo.
Why no polyester? Polyester is plastic. Check your tag. Every style is plant fibers, zero polyester.
Where a style needs stretch, it gets 5% spandex or elastane, never polyester.
100% DCH-32 long-staple cotton Deccan-Luxe Hoodie & Jogger $68. Waffle knit, 95% cotton, 5% spandex Thermal Cotton Crew $42.
100% Pima cotton, brushed inside. The Pima Fleece $58. Cotton boxer briefs, cotton polos, cotton crews."""
SIGNALS = {
    "title": "Men's Pima Cotton, Modal & Bamboo Essentials | July Mode",
    "description": "Men's essentials in Pima and long-staple cotton, modal and bamboo viscose. Zero polyester. "
                   "Crews, polos, hoodies, boxer briefs. Free US shipping over $60.",
    "site_name": None,
    "headings": [{"level": "h1", "text": "Wear Healthy. Plant fibers. Zero polyester."},
                 {"level": "h2", "text": "Eco-Luxe Boxer Brief"}, {"level": "h2", "text": "Shop by category"}],
    "menu_labels": ["Polos & Button Downs", "Sweatshirts", "Thermals", "Hoodies & Joggers", "Underwear",
                    "Best Sellers", "Pima Hi-Neck"],
    "currencies": ["USD"], "platforms": [], "organizations": [], "sitemap": None,
}
SITE = {"status": "ok", "home_url": HOME, "domain": "julymode.example", "texts": {HOME: TEXT},
        "signals": SIGNALS, "country": {"code": "US", "confidence": 0.9, "evidence": []}, "hints": [],
        "pages": [{"kind": "home", "url": HOME, "status": "ok", "note": ""}], "home_notes": [],
        "needs_browser": False, "robots": None, "read_at": "2026-10-14T00:00:00+00:00"}

BROAD = {"niche": "Men's innerwear", "broad_category": "Men's apparel", "category_path": ["Apparel", "Innerwear"],
         "defining_attributes": [], "differentiators": [], "not_this": [],
         "audience": {"who": "Men", "gender": "men", "age_range": "", "geography": "US",
                      "needs": [], "buying_triggers": []},
         "customer_segments": [], "rival_search_phrases": [], "price_note": "", "confidence": "medium"}
PRECISE = {
    "niche": "Pima cotton, modal and bamboo men's basics, zero polyester",
    "broad_category": "Men's apparel", "category_path": ["Apparel", "Men's basics", "Natural-fibre men's basics"],
    "defining_attributes": [
        {"kind": "material", "value": "Pima and long-staple cotton, modal, bamboo viscose",
         "quote": "Men's essentials in Pima cotton, modal, bamboo and long-staple cotton", "url": HOME},
        {"kind": "ethos", "value": "zero polyester", "quote": "Plant fibers. Zero polyester.", "url": HOME}],
    "differentiators": ["No polyester in any style"], "not_this": ["mass-market polyester underwear"],
    "audience": {"who": "US men who want soft, breathable natural-fibre basics and avoid polyester",
                 "gender": "men", "age_range": "25 to 55", "geography": "United States",
                 "needs": ["breathable everyday basics"], "buying_triggers": ["replacing worn underwear"]},
    "customer_segments": [{"name": "Fibre-conscious men", "description": "Read labels and avoid synthetics",
                           "why_they_buy": "Comfort and skin feel"}],
    "rival_search_phrases": ["pima cotton underwear for men", "polyester free men's basics"],
    "price_note": "boxer briefs about $20, tops $38 to $68", "confidence": "high"}


def profile_body(positioning):
    from tests.test_market_radar_profile import GOOD
    return dict(GOOD, name="July Mode", archetype="ecommerce", sells_online=True,
                hq={"city": "", "region": "", "country_code": "US"}, evidence=[], positioning=positioning,
                industry={"plain_label": "Men's innerwear", "naics_code": "315990",
                          "naics_title": "Apparel Accessories", "keywords": ["men's underwear"]})


# == what the site keeps saying (free, no model) ================================================

def test_the_reader_finds_the_words_this_site_keeps_saying():
    st = niche.stresses(SITE)
    terms = {t["term"]: t for t in st["terms"]}
    assert {"cotton", "pima", "bamboo"} <= set(terms)
    assert "title" in terms["pima"]["in"] and terms["cotton"]["mentions"] >= 10
    assert st["materials_named"]["cotton"] > st["materials_named"]["bamboo"] > 0
    assert st["says_it_is_free_of"] == ["polyester"]
    assert "polyester" not in st["materials_named"], "a material it says it avoids is not a material it uses"
    assert st["prices_seen"]["low"] == 20.0 and st["prices_seen"]["high"] == 120.0
    assert st["headline"].startswith("Men's Pima Cotton")
    assert st["audience_words"].get("men", 0) >= 1


def test_web_furniture_and_the_brand_name_are_not_what_it_stresses():
    st = niche.stresses(SITE)
    named = " ".join(t["term"] for t in st["terms"])
    for junk in ("shop", "skip", "content", "july", "mode", "seller"):
        assert junk not in named.split(), junk


def test_spelling_and_plurals_are_one_word():
    assert niche.words("Men's PLANT-fibre boxers") == ["men", "plant", "fiber", "boxer"]
    assert set(niche.words("mens")) == {"men"} or niche.words("mens") == ["men"]


# == checking a niche against it ===============================================================

def test_men_s_innerwear_is_too_broad_for_this_site_and_asks_for_a_second_look():
    flags = niche.check(BROAD, niche.stresses(SITE), SITE)
    texts = " ".join(f["text"] for f in flags)
    assert "cotton" in texts and "pima" in texts           # the site stresses them; the niche omits them
    assert any(f["kind"] == "too_vague" for f in flags)
    assert any(f["kind"] == "unsupported" and "innerwear" in f["text"] for f in flags)
    assert niche.needs_refine(flags)
    assert all(x for x in niche.feedback(flags))


def test_a_niche_that_says_what_the_site_says_passes():
    assert niche.needs_refine(niche.check(PRECISE, niche.stresses(SITE), SITE)) is False


def test_a_product_range_listed_on_the_page_is_not_a_missing_niche_word():
    flags = niche.check(PRECISE, niche.stresses(SITE), SITE)
    assert not [f for f in flags if "boxer" in f["text"] or "crew" in f["text"]]


def test_a_niche_that_claims_what_no_page_says_is_flagged():
    claim = dict(PRECISE, niche="Organic hemp cotton men's workwear, vegan leather accents")
    flags = niche.check(claim, niche.stresses(SITE), SITE)
    said = " ".join(f["text"] for f in flags if f["kind"] == "unsupported")
    assert "hemp" in said and "workwear" in said and "vegan" in said


def test_a_missing_buyer_is_noted_but_does_not_trigger_a_second_call():
    flags = niche.check(dict(PRECISE, audience={"who": ""}), niche.stresses(SITE), SITE)
    assert [f["kind"] for f in flags] == ["no_audience"] and not niche.needs_refine(flags)


# == the site reader collects headings, menus and slug words ==================================

def test_the_site_reader_keeps_headings_and_menu_labels():
    doc = site_reader.parse_html("<html><head><title>T</title></head><body><nav><a href='/p'>Pima Polos</a>"
                                 "<a href='/b'>Boxer Briefs</a></nav><h1>Wear <b>Healthy</b></h1>"
                                 "<h2>Three fibers</h2><h3>skip me</h3></body></html>")
    assert doc.headings == [("h1", "Wear Healthy"), ("h2", "Three fibers")]
    sig = site_reader.signals_from([("home", {"html": "", "text": "", "final_url": HOME}, doc)], HOME)
    assert sig["headings"][0] == {"level": "h1", "text": "Wear Healthy"}
    assert sig["menu_labels"] == ["Pima Polos", "Boxer Briefs"]


def test_the_sitemap_reports_the_words_in_product_and_collection_addresses(monkeypatch):
    body = "<urlset>" + "".join("<url><loc>https://x.example/products/%s</loc></url>" % s for s in
                               ("pima-boxer-brief", "bamboo-boxer-brief", "pima-polo")) + \
        "<url><loc>https://x.example/collections/modal-tees</loc></url></urlset>"
    monkeypatch.setattr(site_reader, "fetch_text", lambda url, limit=0: body)
    sm = site_reader.read_sitemap("https://x.example/", [])
    words = dict(sm["product_words"])
    assert words["boxer"] == 2 and words["pima"] == 2 and words["modal"] == 1


# == the profile asks for the niche, checks it, and reads again when it is too broad ==========

def build(monkeypatch, *replies):
    monkeypatch.setattr(prof.site_reader, "read_site", lambda url: dict(SITE))
    monkeypatch.setattr(prof, "geocode", lambda q, conn=None: None)
    client = FakeClient(*replies)
    return prof.build_profile(HOME, client=client, save=False), client


def test_the_profile_prompt_asks_for_the_niche_and_the_buyer_and_carries_the_counted_words(monkeypatch):
    out, client = build(monkeypatch, reply(profile_body(PRECISE)))
    kind, kw = client.calls[0]
    assert "Positioning (the niche)" in kw["system"] and "customer_segments" in kw["system"]
    assert '"men\'s innerwear" is a category' in kw["system"]
    sent = kw["messages"][0]["content"]
    assert "what_the_site_stresses" in sent and "pima" in sent and "polyester" in sent
    assert kw["output_config"]["format"]["schema"]["properties"]["positioning"] is prof.POSITIONING_SCHEMA


def test_a_precise_first_reading_costs_one_call_and_is_kept(monkeypatch):
    out, client = build(monkeypatch, reply(profile_body(PRECISE)))
    p = out["profile"]
    assert len(client.calls) == 1 and p["niche_check"]["refined"] is None
    assert p["positioning"]["niche"].startswith("Pima cotton")
    assert p["positioning"]["customer_segments"][0]["name"] == "Fibre-conscious men"
    assert not niche.needs_refine(p["niche_check"]["flags"])
    assert p["niche_check"]["stresses"]["says_it_is_free_of"] == ["polyester"]


def test_a_too_broad_reading_is_read_again_once_with_the_problems_listed(monkeypatch):
    out, client = build(monkeypatch, reply(profile_body(BROAD)), reply(PRECISE))
    p = out["profile"]
    assert len(client.calls) == 2
    second = client.calls[1][1]
    assert second["system"] is prof.REFINE_SYSTEM
    assert second["output_config"]["format"]["schema"] is prof.POSITIONING_SCHEMA
    ask = second["messages"][0]["content"]
    assert "Men's innerwear" in ask and "PROBLEMS FOUND IN IT" in ask
    assert "the site stresses" in ask.lower() and "cotton" in ask
    assert p["positioning"]["niche"] == PRECISE["niche"]
    assert p["niche_check"]["refined"]["before"] == "Men's innerwear"
    assert p["niche_check"]["refined"]["problems"]
    assert p["industry"]["plain_label"] == PRECISE["niche"]       # what the rest of the product reads
    assert not niche.needs_refine(p["niche_check"]["flags"])


def test_a_second_look_that_fails_keeps_the_first_reading_and_shows_why(monkeypatch):
    out, client = build(monkeypatch, reply(profile_body(BROAD)), reply("{not json"))
    p = out["profile"]
    assert out["status"] == "ok" and p["positioning"]["niche"] == "Men's innerwear"
    assert "bad_json" in p["niche_check"]["refined"]["failed"]
    assert niche.needs_refine(p["niche_check"]["flags"]), "the flags stay on the profile"
    assert p["industry"]["plain_label"] == "Men's innerwear"


def test_a_quote_behind_a_defining_attribute_that_is_not_on_the_page_is_flagged(monkeypatch):
    fake = json.loads(json.dumps(PRECISE))
    fake["defining_attributes"][0]["quote"] = "Hand-loomed in the Himalayas"
    out, _ = build(monkeypatch, reply(profile_body(fake)))
    assert any("defining attributes do not appear" in c for c in out["profile"]["checks"])


def test_the_model_s_positioning_is_bounded_and_in_house_style():
    cleaned = prof.clean_positioning({
        "niche": "Pima — cotton basics", "defining_attributes": [{"kind": "x", "value": ""}] * 3
        + [{"kind": "material", "value": "cotton", "quote": "q", "url": "u"}] * 20,
        "differentiators": ["a"] * 20, "rival_search_phrases": ["q"] * 40,
        "customer_segments": [{"name": "n", "description": "d", "why_they_buy": "w"}] * 9,
        "confidence": "certain"})
    assert cleaned["niche"] == "Pima, cotton basics"
    assert len(cleaned["defining_attributes"]) == 8 and len(cleaned["differentiators"]) == 5
    assert len(cleaned["rival_search_phrases"]) == 10 and len(cleaned["customer_segments"]) == 3
    assert cleaned["confidence"] == "low"
    assert prof.clean_positioning(None)["niche"] == ""


def test_the_refining_prompt_carries_the_same_rules_as_the_profile_prompt():
    assert prof.POSITIONING_RULES in prof.SYSTEM and prof.POSITIONING_RULES in prof.REFINE_SYSTEM
    assert "never add an attribute no page states" in prof.POSITIONING_RULES


# == competitors are found and judged by the niche =============================================

NICHE_PROFILE = dict(PROFILE, positioning=PRECISE)


def test_the_competitor_brief_leads_with_the_niche_and_the_buyer():
    brief = rv.client_brief(NICHE_PROFILE)
    assert brief["niche"] == PRECISE["niche"]
    assert "material: Pima and long-staple cotton, modal, bamboo viscose" in brief["defining_attributes"]
    assert brief["not_in_these_categories"] == ["mass-market polyester underwear"]
    assert brief["sells_to"]["gender"] == "men" and "searches_a_buyer_would_type" in brief
    assert brief["customer_segments"][0]["name"] == "Fibre-conscious men"
    assert "niche" not in rv.client_brief(PROFILE), "a profile without a niche reads as before"


def test_the_search_planner_is_told_to_search_by_the_niche_not_the_category():
    assert "build the queries from its defining_attributes" in rv.PLAN_SYSTEM
    assert "never only \"men's innerwear brands\"" in rv.PLAN_SYSTEM
    assert "not_in_these_categories" in rv.PLAN_SYSTEM
    c = Scripted()
    rv.plan_search(NICHE_PROFILE, client=c)
    sent = c.calls[0]["messages"][0]["content"]
    assert PRECISE["niche"] in sent and "pima cotton underwear for men" in sent


def test_each_candidate_is_judged_against_the_niche():
    props = rv.VERIFY_SCHEMA["properties"]["verdicts"]["items"]
    assert "same_niche" in props["required"]
    assert props["properties"]["same_niche"]["enum"] == ["yes", "adjacent", "no", "unclear"]
    assert "same_niche" in rv.VERIFY_SYSTEM and "not_in_these_categories" in rv.VERIFY_SYSTEM
    assert "direct also needs same_niche" in rv.RANK_SYSTEM


def test_a_same_category_brand_is_held_below_a_same_niche_one_even_if_the_model_scores_it_high():
    verdicts = {"near.example": verdict("near.example", same_niche="yes"),
                "broad.example": verdict("broad.example", same_niche="adjacent"),
                "other.example": verdict("other.example", same_niche="no")}
    ranked = {"competitors": [
        {"domain": "broad.example", "kind": "direct", "score": 95, "reason": "Sells men's underwear."},
        {"domain": "other.example", "kind": "direct", "score": 90, "reason": "Sells apparel."},
        {"domain": "near.example", "kind": "direct", "score": 80, "reason": "Sells Pima cotton basics."}],
        "left_out": [], "gaps": []}
    c = Scripted(verdicts=verdicts, ranked=ranked)
    out = run_discover(c, profile=NICHE_PROFILE,
                       search_results=[{"query": "q", "position": i, "title": t, "url": "https://%s/" % d}
                                       for i, (t, d) in enumerate([("A", "near.example"),
                                                                   ("B", "broad.example"),
                                                                   ("C", "other.example")], 1)],
                       found=[])
    got = {x["domain"]: x for x in out["competitors"]}
    assert got["near.example"]["kind"] == "direct" and got["near.example"]["niche_fit"] == "yes"
    assert got["broad.example"]["kind"] == "indirect" and got["broad.example"]["score"] == 69
    assert "other.example" not in got, "a different category is left out"
    assert [x["domain"] for x in out["competitors"]][0] == "near.example"
    assert any(l["domain"] == "other.example" for l in out["left_out"])


def test_without_a_niche_the_ranking_is_not_touched():
    verdicts = {"broad.example": verdict("broad.example", same_niche="adjacent")}
    ranked = {"competitors": [{"domain": "broad.example", "kind": "direct", "score": 95, "reason": "r"}],
              "left_out": [], "gaps": []}
    out = run_discover(Scripted(verdicts=verdicts, ranked=ranked),
                       search_results=[{"query": "q", "position": 1, "title": "B",
                                        "url": "https://broad.example/"}], found=[])
    [c] = [x for x in out["competitors"] if x["domain"] == "broad.example"]
    assert c["kind"] == "direct" and c["score"] == 95


# == the rest of the product follows the niche =================================================

def test_the_report_writer_is_told_the_niche_and_the_buyer():
    pack = {"client": {"name": "July Mode", "domain": "julymode.example", "one_liner": "Men's basics.",
                       "archetype": "ecommerce", "industry": "Men's basics", "city": None, "country": "US",
                       "offerings": ["boxer briefs"], "niche": PRECISE["niche"],
                       "buyer": PRECISE["audience"]["who"], "segments": ["Fibre-conscious men"]},
            "competitors": [], "moves": [], "nearby": [], "entrants": [], "themes": [], "rules": [],
            "hiring": [], "patterns": [], "coverage": []}
    text = report.pack_text(pack)
    assert "Niche: Pima cotton" in text and "Sells to: US men who want" in text
    assert "Fibre-conscious men" in text
    assert "write for that niche and that buyer" in report.WRITER_SYSTEM


def test_staff_can_correct_the_niche_and_the_correction_reaches_the_competitor_search():
    clean = views.validate({"positioning.niche": "  Cotton-first men's underwear  ",
                            "positioning.not_this": "polyester activewear, women's intimates",
                            "positioning.audience.who": "Men who want breathable cotton"})
    assert clean["positioning.not_this"] == ["polyester activewear", "women's intimates"]
    reading = {"positioning": json.loads(json.dumps(PRECISE)), "archetype": "ecommerce"}
    effective = views.effective_profile(reading, {"profile_overrides": clean})
    assert effective["positioning"]["niche"] == "Cotton-first men's underwear"
    assert effective["positioning"]["audience"]["who"] == "Men who want breathable cotton"
    assert effective["positioning"]["category_path"] == PRECISE["category_path"], "the rest is kept"
    assert rv.client_brief(dict(PROFILE, **effective))["niche"] == "Cotton-first men's underwear"
    assert "positioning.niche" in effective["edited_fields"]


def test_a_stored_profile_without_a_niche_is_read_again_once_on_the_next_run():
    from tracker import market_radar_run as mrun
    import tracker.market_radar_store as real
    built, runs = [], {}
    saved = {k: getattr(real, k) for k in ("get_entity", "update_run", "get_client")}
    real.get_entity = lambda eid: {"profile": {"archetype": "ecommerce", "name": "July Mode"}}
    real.update_run = lambda run_id, **kw: runs.update(kw)
    real.get_client = lambda cid, email: {"settings": {}, "radius_km": None}
    try:
        def build_one(url, **k):
            built.append(url)
            return {"status": "ok", "profile": dict(PROFILE, positioning=PRECISE)}
        mrun.job(1, HOME, "o", 1, 1, True, build_profile=build_one,
                 discover=lambda p, **k: {"status": "none_found", "competitors": []})
    finally:
        for k, v in saved.items():
            setattr(real, k, v)
    assert built == [HOME] and "predates the niche" in runs["summary"]["profile_note"]


def test_the_profile_view_carries_the_niche_and_what_the_program_found():
    from tracker import market_radar_views as v
    client = {"profile": {"positioning": PRECISE, "niche_check": {"flags": [], "stresses": {"terms": []}}},
              "settings": {}}
    view = v.profile_view(client)
    assert view["positioning"]["niche"] == PRECISE["niche"]
    assert view["niche_check"]["stresses"] == {"terms": []}
    assert view["fields"]["positioning.niche"] == PRECISE["niche"]


# == a local business: where it is, is not what it sells =======================================

def test_the_town_a_business_is_in_is_not_a_missing_niche_word():
    home = "https://pembridge.example/"
    text = ("Private dentist in Notting Hill, West London. Private dentistry for the whole family. "
            "Our Notting Hill dentist offers private check-ups. West London trusted dentist. " * 3)
    site = {"home_url": home, "domain": "pembridge.example", "texts": {home: text},
            "signals": {"title": "Private Dentist Notting Hill | West London Dentist", "description": "",
                        "headings": [{"level": "h1", "text": "Private dentist in Notting Hill"}],
                        "menu_labels": [], "sitemap": None}}
    pos = {"niche": "Private family dentistry", "category_path": [], "defining_attributes": [],
           "audience": {"who": "Families", "geography": "Notting Hill"}}
    st = niche.stresses(site)
    where = niche.place_words("London", "", "Notting Hill", "")
    said = " ".join(f["text"] for f in niche.check(pos, st, site, where))
    assert "notting" not in said and "west" not in said and "london" not in said
    assert "private" not in said            # the niche already says it


def test_only_things_a_company_says_it_avoids_are_listed_as_what_it_is_free_of():
    text = "Zero polyester. No bulk. No pulling. No spam. Free of sugar. No sugar added. No plastic."
    site = {"home_url": "https://x.example/", "domain": "x.example", "texts": {"https://x.example/": text},
            "signals": {"title": "", "description": "", "headings": [], "menu_labels": [], "sitemap": None}}
    assert niche.stresses(site)["says_it_is_free_of"] == ["plastic", "polyester", "sugar"]
