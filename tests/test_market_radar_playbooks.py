"""Market Radar: every kind of business has a playbook, and every place that lists the kinds agrees
(tracker/market_radar_playbooks.py). No network, no model."""
import json
import os
import re
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tracker import market_radar_collect as collect  # noqa: E402
from tracker import market_radar_playbooks as pb  # noqa: E402
from tracker import market_radar_profile as prof  # noqa: E402
from tracker import market_radar_radar as radar  # noqa: E402
from tracker import market_radar_rivals as rivals  # noqa: E402
from tracker import market_radar_signals as sig  # noqa: E402
from tracker import market_radar_views as views  # noqa: E402

NEW = {"marketplace", "professional_services", "hospitality_travel", "education", "health_system",
       "real_estate", "financial_services", "nonprofit", "personal_brand"}


def test_every_kind_of_business_has_a_complete_playbook():
    assert NEW <= set(pb.ARCHETYPES) and pb.ARCHETYPES[-1] == "other"
    for key, p in pb.PLAYBOOKS.items():
        assert p["label"] and len(p["describe"]) > 25 and p["rivals"] and len(p["watch"]) >= 3, key
        assert set(p["specialists"]) <= set(pb.GATED), key
        assert not (p["domains"] and not p["entrants"]), "%s: shop domains are part of the entrant scan" % key


def test_the_profile_prompt_and_schema_come_from_the_playbooks():
    assert tuple(prof.PROFILE_SCHEMA["properties"]["archetype"]["enum"]) == pb.ARCHETYPES
    assert views.ARCHETYPES == pb.ARCHETYPES
    for key, p in pb.PLAYBOOKS.items():
        assert "- %s: %s" % (key, p["describe"]) in prof.SYSTEM
    assert "%(archetypes)s" not in prof.SYSTEM and "professional_services, not b2b_services" in prof.SYSTEM


def test_the_pages_script_names_every_kind_of_business():
    for name in ("market_radar.js", "market_radar_report.js"):
        text = open(os.path.join(ROOT, "static", "js", name), encoding="utf-8").read()
        for key in pb.ARCHETYPES:
            assert re.search(r"['\"]?%s['\"]?\s*[:,]" % key, text), "%s is missing %s" % (name, key)
    # and the edit form's list is checked against the playbook labels
    text = open(os.path.join(ROOT, "static", "js", "market_radar.js"), encoding="utf-8").read()
    for key, label in pb.LABELS.items():
        if key in ("local_single", "multi_location", "ecommerce", "b2b_services", "b2b_product"):
            continue
        assert "'%s'" % label in text or key == "other", key


def test_the_specialist_readers_follow_the_playbook_and_the_old_behaviour_is_kept():
    # What ran before: subdomains for B2B and shops; headcount and LinkedIn for B2B and manufacturers.
    assert collect.applies("subdomains", "ecommerce") and collect.applies("subdomains", "b2b_product")
    assert not collect.applies("subdomains", "local_single") and not collect.applies("subdomains", "manufacturer")
    assert collect.applies("headcount", "manufacturer") and not collect.applies("headcount", "ecommerce")
    assert collect.applies("linkedin", "b2b_services") and not collect.applies("linkedin", "multi_location")
    assert collect.applies("filings", "local_single"), "readers the playbooks do not gate run for everyone"
    # New kinds
    assert collect.applies("headcount", "professional_services") and collect.applies("linkedin", "professional_services")
    assert collect.applies("subdomains", "marketplace") and not collect.applies("subdomains", "nonprofit")
    assert not collect.applies("linkedin", None)


def test_the_radar_scans_for_new_rivals_where_the_playbook_says_and_shop_domains_only_for_products():
    assert radar.ENTRANT_ARCHETYPES == pb.entrant_types()
    assert {"ecommerce", "marketplace", "b2b_product", "financial_services", "education"} <= radar.ENTRANT_ARCHETYPES
    assert not radar.ENTRANT_ARCHETYPES & {"local_single", "multi_location", "manufacturer", "health_system"}
    assert pb.get("ecommerce")["domains"] and not pb.get("b2b_product")["domains"]


def test_the_rival_search_is_told_how_each_kind_of_business_finds_its_rivals():
    brief = rivals.client_brief({"name": "Morgan & Co", "archetype": "professional_services"})
    assert "top X firms" in brief["how_its_rivals_are_found"] or "ranking lists" in brief["how_its_rivals_are_found"]
    assert "Partners and senior people joining or leaving" in brief["what_its_rivals_do_that_matters"]
    assert "Follow the profile's how_its_rivals_are_found" in rivals.PLAN_SYSTEM
    assert rivals.client_brief({"archetype": None})["how_its_rivals_are_found"], "an unknown kind still gets a hint"


def test_awards_are_moves_for_a_law_firm_and_left_out_for_a_dentist():
    firm = pb.sector_note("professional_services")
    assert "law firm" not in firm and "award, ranking or accreditation IS a move" in firm
    prompt = sig._system({"note": firm, "awards": True})
    assert "award_ranking" in prompt and "SECTOR: The client is a professional services" in prompt
    assert "- award_or_ranking:" not in prompt and "- award_ranking:" in prompt
    dentist = sig._system(None)
    assert "- award_or_ranking:" in dentist and "award_ranking" not in dentist and "SECTOR" not in dentist
    assert pb.sector_note("other") == "" and pb.sector_note(None) == ""
    assert sig.WEIGHTS["award_ranking"] < sig.WEIGHTS["licence_accreditation"]
    assert views.EVENT_LABELS["award_ranking"] == "Award or ranking"
    assert views.EVENT_LABELS["licence_accreditation"] == "Licence or accreditation"


@pytest.mark.parametrize("kind", sorted(NEW))
def test_a_profile_of_each_new_kind_is_accepted_by_the_edit_form(kind):
    assert views.validate({"archetype": kind}) == {"archetype": kind}
