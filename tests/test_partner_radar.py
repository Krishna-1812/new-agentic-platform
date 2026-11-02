"""Partner Radar: Lead Finder's two partner offers, agencies for white-label paid media and senior paid
marketing consultants for the partner programme (/partners).

The buyer here is itself an agency or a consultant, so the judge is told to follow each offer's "who buys
it" over its rule that agencies and freelancers are sellers. What a message may claim is only what the
partner pages say and the team confirmed: the channels, the team in India, white-label delivery, and the
consultant's recurring commission, the same rate as the page.
"""

import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import site_pages  # noqa: E402
from tracker import buyer_radar as br  # noqa: E402
from tracker import buyer_radar_icp as icp  # noqa: E402
from tracker import buyer_radar_judge as judge  # noqa: E402
from tracker import buyer_radar_reddit as rd  # noqa: E402
from tracker import buyer_radar_source as src  # noqa: E402

PARTNER = {"agency_partners": "/partners/agencies", "consultant_partners": "/partners/consultants"}


@pytest.mark.parametrize("key,path", sorted(PARTNER.items()))
def test_each_partner_offer_points_at_its_page_and_searches_linkedin_as_it_accepts(key, path):
    o = br.OFFERS[key]
    assert o["label"].startswith("Partners: ") and o["site"] == "https://northaxis.com" + path
    assert 8 <= len(o["queries"]) <= br.MAX_QUERIES
    for q in o["queries"]:
        assert src.check_query(q) is None and '"' in q, q
    assert o["decision_makers"] and 5 <= len(o["jobs"]) <= br.MAX_JOB_QUERIES


def test_the_offers_say_only_what_the_partner_pages_promise():
    agency, consultant = br.OFFERS["agency_partners"], br.OFFERS["consultant_partners"]
    for o in (agency, consultant):
        text = (o["sells"] + " " + o["buyers"]).lower()
        assert site_pages.PARTNER_CHANNELS.lower() in o["sells"].lower() and "india" in text
        for word in ("cheap", "low-cost", "low cost", "labour", "labor", " nda", "pilot", "one working day", "09:30"):
            assert word not in text, (o["label"], word)
    assert "%s commission" % site_pages.PARTNER_COMMISSION in consultant["sells"]
    assert "%" not in agency["sells"], "no price or commission is promised to agencies"
    assert "white-label" in agency["sells"] and "agency is the buyer, not a seller" in agency["buyers"]
    assert "consultant is the buyer, not a seller" in consultant["buyers"]


def test_the_judge_follows_who_buys_a_partner_offer_over_its_seller_rule():
    for system in (judge.JUDGE_SYSTEM, judge.JOB_SYSTEM, judge.COMMENT_SYSTEM, judge.REDDIT_SYSTEM):
        assert system.endswith(judge.PARTNER_RULE)
    assert "is a 'buyer' for that offer, not a 'seller'" in judge.PARTNER_RULE
    both = judge._offers_text({k: br.OFFERS[k] for k in PARTNER})
    assert "OFFER agency_partners:" in both and "OFFER consultant_partners:" in both


def test_a_workspace_switches_the_partner_offers_on_and_the_defaults_stay_as_they_were():
    assert br.DEFAULTS["offers"] == ["callvibe", "markify"], "Unipile's day is not split four ways unasked"
    st = br.clean_settings({"offers": ["agency_partners", "consultant_partners"]})
    assert st["offers"] == ["agency_partners", "consultant_partners"]
    assert set(PARTNER) <= set(st["senders"])


def test_each_partner_offer_has_its_customer_profiles_and_reddit_searches():
    for key in PARTNER:
        rows = icp.DEFAULT_ICPS[key]
        assert 1 <= len(rows) <= icp.MAX_ICPS
        for row in rows:
            clean = icp.clean_icp(row, br.OFFERS[key]["label"])
            assert clean["titles"], row["name"]
        assert rd.queries_for({}, key) == rd.OFFER_QUERIES[key] and len(rd.OFFER_QUERIES[key]) <= rd.MAX_QUERIES
    agency_rows = icp.DEFAULT_ICPS["agency_partners"]
    assert all("Advertising Services" in r["industries"] for r in agency_rows), "agencies, not brands"
    assert any(r["trigger"] == "hiring_for" and "PPC" in r["hiring"] for r in agency_rows)
    assert all(r.get("size_max", 0) <= 10 for r in icp.DEFAULT_ICPS["consultant_partners"]), "independents"


def test_a_message_for_a_partner_lead_carries_the_partner_page():
    sent = []

    def call(_budget, _what, _model, _system, user, _schema, _max):
        sent.append(user)
        return {"subject": "Paid media under your name", "email": "Hi Sam", "note": "Hi", "message": "Hi"}

    lead = {"post": {"kind": "post", "text": "Anyone know a white label PPC partner? We are at capacity.",
                     "author": {"name": "Sam Lee", "headline": "Founder, Lee Creative"}},
            "verdict": {"need": "A white-label PPC partner for overflow work"}}
    out = judge.draft(lead, br.OFFERS["agency_partners"], {"name": "Kris", "title": "Founder"},
                      budget=None, call=call)
    assert out["subject"] == "Paid media under your name"
    assert "https://northaxis.com/partners/agencies" in sent[0] and "white label PPC partner" in sent[0]


def test_when_linkedin_results_run_short_every_offer_is_still_searched():
    st = br.merged({"offers": ["callvibe", "markify", "agency_partners", "consultant_partners"]})
    queries, offer_of = br.search_order(st)
    assert [offer_of[q] for q in queries[:4]] == ["callvibe", "markify", "agency_partners", "consultant_partners"]
    assert len(queries) == sum(len(br.OFFERS[k]["queries"]) for k in st["offers"])
    assert br.fair_share(900, 10, 25) == 25, "room for all: each search reads what it asks"
    assert br.fair_share(300, 60, 25) == 5 and br.fair_share(0, 60, 25) == br.FAIR_MIN
    assert br.fair_share(500, 0, 25) == 25
