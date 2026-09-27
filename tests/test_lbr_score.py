"""Local Business Radar, phase 8: need, ability to pay, tiers, evidence, pitch."""

import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tracker import lbr_claude, lbr_http, lbr_score  # noqa: E402

MKT = {"median_rating": 4.6, "median_reviews": 140, "businesses": 80}
PLAN = {"focus": "all", "business": {"queries": ["dentist"], "input": "dentist"}}


def _prof(**kw):
    p = {"name": "Oak Family Dental", "address": "12 Oak St, Austin, TX 78701", "rating": 4.1, "reviews": 38,
         "photos_seen": 4, "primary_type": "dentist", "category": "Dentist", "price_level": "", "locations": 1}
    p.update(kw)
    return p


NO_SITE = {"kind": "social_only", "issues": [{"key": "social_only", "severity": "high",
                                                "text": "Only a social media page stands in for a website."}]}
GOOD_SITE = {"kind": "ok", "score": 92, "issues": [], "checks": {"local_schema": True, "meta_description": True},
             "socials": {"facebook": "x"}, "runs_ads": True}
GBP_WEAK = {"score": 48, "claimed": False, "photos": 4,
            "checks": [{"key": "photos", "status": "missing", "value": 4},
                       {"key": "posts", "status": "missing", "value": 0},
                       {"key": "description", "status": "missing", "value": 0}]}
REV_BAD = {"stats": {"sample": 30, "negative": 30, "unanswered_negative": 6, "reply_rate": 10, "trend": -0.6,
                     "recent_90d": 4, "last_days": 12},
           "themes": {"complaints": [{"theme": "Long waits"}, {"theme": "Billing errors"}]}}
VIS_LOST = {"rank": None, "in_pack": False, "rank_note": 'Not in the first 20 Google Maps results for "dentist" nearby.',
            "market": {"reviews_vs_median": -102, "rating_vs_median": -0.5}, "ads": None}


def test_a_neglected_business_is_tier_a_and_leads_with_its_worst_gap():
    sc = lbr_score.score_one(_prof(), GBP_WEAK, NO_SITE, REV_BAD, VIS_LOST, "all")
    assert sc["tier"] == "A" and sc["total"] >= 70
    assert sc["need"]["website"] == 90 and sc["top_service"] == "website"
    assert sc["need"]["reputation"] >= 70 and sc["need"]["seo"] >= 60


def test_a_polished_business_that_already_advertises_is_not_a_lead():
    prof = _prof(rating=4.9, reviews=420, photos_seen=10)
    vis = {"rank": 1, "in_pack": True, "rank_note": "#1", "market": {"reviews_vs_median": 280},
           "ads": {"active": True, "creatives": 30}}
    gbp = {"score": 96, "claimed": True, "photos": 80, "checks": [{"key": "posts", "status": "good"}]}
    rev = {"stats": {"sample": 60, "negative": 2, "unanswered_negative": 0, "reply_rate": 95, "trend": 0.1,
                     "recent_90d": 25, "last_days": 2}}
    sc = lbr_score.score_one(prof, gbp, GOOD_SITE, rev, vis, "all")
    assert sc["tier"] == "C" and sc["need"]["paid"] == 25


def test_a_chosen_service_drives_the_score():
    web_first = lbr_score.score_one(_prof(), None, NO_SITE, None, None, "website")
    paid_first = lbr_score.score_one(_prof(), None, NO_SITE, None, None, "paid")
    assert web_first["top_service"] == "website" and paid_first["top_service"] == "paid"
    assert web_first["total"] > paid_first["total"], "no site means paid media has nowhere to land yet"


def test_unknown_findings_are_not_scored_as_needs():
    sc = lbr_score.score_one(_prof(rating=None), None, None, None, None, "all")
    assert sc["need"]["website"] is None and sc["need"]["seo"] is None and sc["need"]["reputation"] is None


def test_ability_to_pay_rises_with_volume_price_and_ticket_size():
    small = lbr_score.ability(_prof(reviews=3, primary_type="bakery", category="Bakery"), None, None)
    big = lbr_score.ability(_prof(reviews=400, price_level="PRICE_LEVEL_EXPENSIVE", locations=2),
                            GOOD_SITE, {"ads": {"active": True}})
    assert small < 25 and big >= 85


# ── Evidence ─────────────────────────────────────────────────────────────────

def test_evidence_states_only_what_was_found_with_its_numbers():
    facts = lbr_score.evidence(_prof(), GBP_WEAK, NO_SITE, REV_BAD, VIS_LOST, MKT, "dentist")
    texts = [f["text"] for f in facts]
    assert texts[0] == "Only a social media page stands in for a website."
    assert "Their Google Business Profile is unclaimed." in texts
    assert "4.1 stars from 38 reviews; the typical dentist nearby has 4.6 from 140." in texts
    assert "6 one- and two-star reviews have no reply from the owner." in texts
    assert "Customers complain about: long waits; billing errors." in texts
    assert any(t.startswith("Not in the first 20") for t in texts)
    assert "Only 4 photos on their Google profile." in texts
    assert [f["id"] for f in facts] == ["f%d" % i for i in range(1, len(facts) + 1)]


# ── Pitch ────────────────────────────────────────────────────────────────────

FACTS = [{"id": "f1", "service": "website", "text": "Only a social media page stands in for a website."},
         {"id": "f2", "service": "reputation", "text": "4.1 stars from 38 reviews; the typical dentist nearby has 4.6 from 140."}]


def test_a_pitch_with_an_invented_number_is_rejected_then_assembled(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    calls = []

    def fake(system, user, ledger, **kw):
        calls.append(user)
        return {"headline": "Win 45% more patients", "pitch": "You could add 300 patients a year.",
                "services": [{"service": "website", "fact_ids": ["f1"]}], "email_subject": "Hi", "call_opener": "Hi"}
    monkeypatch.setattr(lbr_claude, "ask_json", fake)
    p = lbr_score.write_pitch(_prof(), FACTS, "website", "all", lbr_http.Ledger())
    assert len(calls) == 2 and p["source"] == "assembled"
    assert p["pitch"] == "Only a social media page stands in for a website."


def test_a_pitch_that_sticks_to_the_facts_is_kept_and_cleaned(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")

    def fake(system, user, ledger, **kw):
        assert "f2 [reputation] 4.1 stars" in user and "Oak Family Dental (Dentist)" in user
        return {"headline": "Your Facebook page is doing a website’s job",
                "pitch": "Patients who search for you land on Facebook — and you have 38 reviews against a "
                         "local norm of 140.",
                "services": [{"service": "website", "fact_ids": ["f1", "f9"]}, {"service": "billboards"}],
                "email_subject": "Oak Family Dental online", "call_opener": "Quick question about your site."}
    monkeypatch.setattr(lbr_claude, "ask_json", fake)
    p = lbr_score.write_pitch(_prof(), FACTS, "website", "all", lbr_http.Ledger())
    assert p["source"] == "claude" and "—" not in p["pitch"]
    assert p["services"] == [{"service": "website", "fact_ids": ["f1"]}], "unknown ids and services are dropped"


def test_numbers_in_the_business_name_or_address_are_allowed():
    assert lbr_score._numbers_ok(["Visit 12 Oak St in 78701"], FACTS, _prof())
    assert not lbr_score._numbers_ok(["Grow revenue by 30%"], FACTS, _prof())


def test_only_tier_a_and_b_get_a_written_pitch_and_everyone_is_ranked(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    wrote = []

    def fake(system, user, ledger, **kw):
        wrote.append(user)
        return {"headline": "No real website", "pitch": "Only a social media page stands in for a website.",
                "services": [], "email_subject": "Hello", "call_opener": "Hello"}
    monkeypatch.setattr(lbr_claude, "ask_json", fake)
    profiles = {"hot": _prof(), "cold": _prof(name="Polished Dental", rating=4.9, reviews=420, photos_seen=10)}
    findings = {"hot": {"profile": GBP_WEAK, "website": NO_SITE, "reviews": REV_BAD, "visibility": VIS_LOST},
                "cold": {"website": GOOD_SITE, "visibility": {"rank": 1, "in_pack": True, "rank_note": "#1",
                                                              "market": {}, "ads": {"active": True, "creatives": 9}}}}
    out = lbr_score.run(["hot", "cold"], profiles, findings, PLAN, MKT, lbr_http.Ledger())
    assert out["hot"]["rank"] == 1 and out["cold"]["rank"] == 2
    assert out["hot"]["pitch"]["source"] == "claude" and out["cold"]["pitch"]["source"] == "assembled"
    assert len(wrote) == 1


def test_without_claude_every_pitch_is_assembled(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    p = lbr_score.write_pitch(_prof(), FACTS, "website", "all", lbr_http.Ledger())
    assert p["source"] == "assembled" and p["services"][0]["service"] == "website"
