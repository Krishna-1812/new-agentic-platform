"""Local Business Radar: Apify is priced at the account's own tier, read from
Apify, with the list prices standing in when that cannot be read."""

import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tracker import apify_transport, lbr_apify_pricing, lbr_config, lbr_intake, lbr_selftest  # noqa: E402


def _event(free, bronze, silver):
    return {"eventTieredPricingUsd": {"FREE": {"tieredEventPriceUsd": free},
                                      "BRONZE": {"tieredEventPriceUsd": bronze},
                                      "SILVER": {"tieredEventPriceUsd": silver}}}


# Shaped like GET /v2/acts/compass~crawler-google-places (figures as read on 2026-09-27).
NOW_PRICES = {"pricingModel": "PAY_PER_EVENT", "startedAt": "2026-06-30T13:23:33.247Z",
              "pricingPerEvent": {"actorChargeEvents": {
                  "place-scraped": _event(0.004, 0.003, 0.002),
                  "place-details-scraped": _event(0.002, 0.002, 0.0015),
                  "review-scraped": _event(0.0005, 0.0005, 0.00037),
                  "apify-actor-start": {"eventPriceUsd": 0.00005}}}}
OLD_PRICES = dict(NOW_PRICES, startedAt="2025-01-01T00:00:00Z",
                  pricingPerEvent={"actorChargeEvents": {"place-scraped": _event(0.009, 0.009, 0.009)}})
NEXT_PRICES = dict(NOW_PRICES, startedAt="2099-01-01T00:00:00Z",
                   pricingPerEvent={"actorChargeEvents": {"place-scraped": _event(0.001, 0.001, 0.001)}})
ACTOR = {"title": "Google Maps Scraper", "pricingInfos": [OLD_PRICES, NOW_PRICES, NEXT_PRICES]}


@pytest.fixture
def apify(monkeypatch):
    monkeypatch.setenv("LBR_APIFY_PRICING", "live")
    monkeypatch.setenv("APIFY_API_TOKEN", "apify_api_TEST")
    monkeypatch.delenv("LBR_PRICES_JSON", raising=False)
    monkeypatch.delenv("LBR_SOURCE", raising=False)
    monkeypatch.delenv("SERPAPI_KEY", raising=False)
    lbr_apify_pricing.reset()
    state = {"tier": "BRONZE", "calls": 0, "actor": ACTOR, "account_error": None}

    def probe(token):
        state["calls"] += 1
        if state["account_error"]:
            return None, state["account_error"]
        return {"username": "markify", "plan": {"id": "STARTER", "tier": state["tier"]}}, None
    monkeypatch.setattr(apify_transport, "probe_token", probe)
    monkeypatch.setattr(apify_transport, "check_actor", lambda a, t: (state["actor"], None))
    yield state
    lbr_apify_pricing.reset()


def test_the_account_tier_sets_every_apify_price(apify):
    assert lbr_config.price("apify.place") == 0.003
    assert lbr_config.price("apify.details") == 0.002
    assert lbr_config.price("apify.review") == 0.0005
    assert lbr_config.price("apify.start") == 0.00005, "an event with one price for everyone"
    apify["tier"] = "SILVER"
    lbr_apify_pricing.reset()
    assert lbr_config.price("apify.place") == 0.002 and lbr_config.price("apify.review") == 0.00037


def test_the_price_record_in_force_now_is_used_not_an_old_or_a_scheduled_one(apify):
    assert lbr_apify_pricing.current_pricing(ACTOR["pricingInfos"]) is NOW_PRICES
    assert lbr_config.price("apify.place") == 0.003


def test_prices_are_read_once_and_cached(apify):
    for _ in range(20):
        lbr_config.price("apify.place")
    assert apify["calls"] == 1


def test_without_an_answer_from_apify_the_list_prices_stand(apify):
    apify["account_error"] = "Could not reach Apify: timeout"
    assert lbr_config.price("apify.place") == lbr_config.PRICES["apify.place"]["usd"] == 0.004
    assert lbr_config.apify_pricing() == {"live": False, "why": "Could not reach Apify: timeout"}


def test_an_unknown_tier_or_an_unpriced_actor_falls_back(apify):
    apify["tier"] = ""
    assert lbr_config.price("apify.place") == 0.004
    lbr_apify_pricing.reset()
    apify["tier"], apify["actor"] = "BRONZE", {"title": "x", "pricingInfos": []}
    assert lbr_config.price("apify.place") == 0.004


def test_an_explicit_override_still_wins(apify, monkeypatch):
    monkeypatch.setenv("LBR_PRICES_JSON", '{"apify.place": 0.0025}')
    assert lbr_config.price("apify.place") == 0.0025


def test_other_services_are_not_looked_up(apify):
    assert lbr_config.price("serpapi.search") == 0.015 and apify["calls"] == 0


def test_the_estimate_is_priced_and_labelled_at_the_accounts_tier(apify):
    bt = {"label": "Dentists", "queries": ["dentist"], "types": ["dentist"]}
    bronze = lbr_intake.estimate("city", 10, bt)
    assert bronze["apify_tier"] == "BRONZE" and "BRONZE-tier prices ($0.003 a place)" in bronze["basis"]
    search = next(l for l in bronze["lines"] if l["what"].startswith("Google Maps search"))
    assert search["usd"] == round(search["units"] * 0.003, 2)
    apify["account_error"] = "Apify rejected this token (401 Unauthorized)."
    lbr_apify_pricing.reset()
    listed = lbr_intake.estimate("city", 10, bt)
    assert listed["apify_tier"] is None and "Free-plan list prices" in listed["basis"]
    assert listed["usd_max"] > bronze["usd_max"], "the fallback is the higher, safer figure"


def test_the_connection_check_shows_the_tier_and_its_prices(apify, monkeypatch):
    monkeypatch.setattr(apify_transport, "account_limits", lambda t: (None, "n/a"))
    rows = {r["name"]: r for r in lbr_selftest._apify()}
    row = rows["Apify prices"]
    assert row["ok"] is True
    assert row["detail"].startswith("BRONZE tier (STARTER plan): $0.003 a place, $0.002 for its details, "
                                    "$0.0005 a review.")
    assert "apify_api_TEST" not in str(rows)


def test_a_failed_price_read_is_shown_but_does_not_fail_the_check(apify, monkeypatch):
    monkeypatch.setattr(apify_transport, "account_limits", lambda t: (None, "n/a"))
    apify["tier"] = ""
    row = {r["name"]: r for r in lbr_selftest._apify()}["Apify prices"]
    assert row["ok"] is False and row.get("optional") and "Free-plan list prices" in row["detail"]
