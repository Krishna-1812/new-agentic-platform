"""Local Business Radar, phase 4: the Google Business Profile audit."""

import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tracker import apify_transport, lbr_http, lbr_profile  # noqa: E402


def _prof(**kw):
    base = {"name": "Smile Studio", "website": "https://smile.example", "phone": "(512) 555-0100",
            "hours": ["Mon", "Tue", "Wed", "Thu", "Fri"], "photos_seen": 10, "reviews": 120, "rating": 4.8}
    base.update(kw)
    return base


def _by(result):
    return {c["key"]: c for c in result["checks"]}


def test_a_strong_profile_scores_high_and_says_what_it_could_not_check():
    r = lbr_profile.audit(_prof())
    assert r["score"] == 100 and r["gaps"] == []
    assert set(r["unchecked"]) == {"claimed", "photos", "description", "posts"}
    assert _by(r)["photos"]["value"] == "10+"


def test_unknown_checks_are_left_out_of_the_score_not_counted_as_failures():
    r = lbr_profile.audit(_prof(website="", phone=""))
    known = sum(c["weight"] for c in r["checks"] if c["status"] != "unknown")
    lost = lbr_profile.WEIGHTS["website"] + lbr_profile.WEIGHTS["phone"]
    assert r["score"] == round(100 * (known - lost) / known)
    assert r["gaps"] == ["website", "phone"]


def test_fewer_than_ten_photos_from_google_is_the_exact_count():
    r = lbr_profile.audit(_prof(photos_seen=3))
    assert _by(r)["photos"]["status"] == "missing" and _by(r)["photos"]["value"] == 3
    assert r["photos"] == 3 and "photos" not in r["unchecked"]


@pytest.mark.parametrize("rating,reviews,rs,vs", [
    (4.9, 200, "good", "good"), (4.2, 30, "weak", "weak"), (3.6, 4, "missing", "missing"),
    (None, 0, "missing", "missing")])
def test_rating_and_volume_bands(rating, reviews, rs, vs):
    r = _by(lbr_profile.audit(_prof(rating=rating, reviews=reviews)))
    assert r["rating"]["status"] == rs and r["reviews"]["status"] == vs


def test_apify_fills_in_what_googles_api_never_returns():
    recent = (datetime.now(timezone.utc) - timedelta(days=12)).isoformat()
    r = lbr_profile.audit(_prof(), {"claimed": False, "images": 44, "posts": 3, "post_days": 12,
                                    "description": "x" * 300})
    c = _by(r)
    assert c["claimed"]["status"] == "missing" and "Unclaimed" in c["claimed"]["detail"]
    assert c["photos"]["value"] == 44 and c["photos"]["status"] == "good"
    assert c["posts"]["status"] == "good" and c["description"]["status"] == "good"
    assert r["unchecked"] == [] and r["claimed"] is False and "claimed" in r["gaps"]


def test_apify_output_is_read_with_the_actors_own_meaning(monkeypatch):
    """claimThisBusiness is true when Google still shows "Claim this business"."""
    sent = {}
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

    def fake_run(actor, run_input, token, timeout, strict):
        sent.update(actor=actor, input=run_input, strict=strict)
        return [{"placeId": "p1", "claimThisBusiness": True, "imagesCount": 4,
                 "ownerUpdates": [], "description": None},
                {"placeId": "p2", "claimThisBusiness": False, "imagesCount": 60,
                 "ownerUpdates": [{"text": "Open late", "date": now_ms - 5 * 86400000}],
                 "description": "Family dentistry since 1998."}]
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    monkeypatch.setattr(apify_transport, "run_actor_and_wait", fake_run)
    ledger = lbr_http.Ledger()
    extra = lbr_profile.enrich_with_apify(["p1", "p2"], ledger)
    assert sent["actor"] == "compass/crawler-google-places" and sent["strict"] is True
    assert sent["input"]["placeIds"] == ["p1", "p2"] and sent["input"]["scrapePlaceDetailPage"] is True
    assert extra["p1"]["claimed"] is False and extra["p1"]["posts"] == 0 and extra["p1"]["description"] == ""
    assert extra["p2"]["claimed"] is True and extra["p2"]["post_days"] == 5
    # Two places, each a "Scraped place" ($0.004) plus the detail-page add-on ($0.002).
    assert ledger.totals()["by_provider"]["apify"]["usd"] == pytest.approx(0.012)


def test_without_apify_nothing_is_called(monkeypatch):
    monkeypatch.delenv("APIFY_API_TOKEN", raising=False)
    monkeypatch.setattr(apify_transport, "run_actor_and_wait",
                        lambda *a, **k: pytest.fail("Apify called without a token"))
    assert lbr_profile.enrich_with_apify(["p1"], lbr_http.Ledger()) == {}


def test_a_failed_apify_batch_leaves_those_checks_unchecked(monkeypatch):
    def boom(*a, **k):
        raise apify_transport.ApifyTransportError("run ended with status FAILED")
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    monkeypatch.setattr(apify_transport, "run_actor_and_wait", boom)
    ledger = lbr_http.Ledger()
    out = lbr_profile.run(["p1"], {"p1": _prof()}, ledger)
    assert "claimed" in out["p1"]["unchecked"]
    assert ledger.totals()["by_provider"]["apify"]["failed"] == 1 and ledger.totals()["usd"] == 0


def test_large_runs_are_sent_to_apify_in_batches(monkeypatch):
    batches = []
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    monkeypatch.setattr(apify_transport, "run_actor_and_wait",
                        lambda a, ri, *x, **k: batches.append(len(ri["placeIds"])) or [])
    lbr_profile.enrich_with_apify(["p%d" % i for i in range(250)], lbr_http.Ledger())
    assert batches == [100, 100, 50]


@pytest.mark.parametrize("days,status", [(10, "good"), (90, "weak"), (400, "missing")])
def test_post_recency_bands(days, status):
    r = _by(lbr_profile.audit(_prof(), {"claimed": True, "posts": 2, "post_days": days}))
    assert r["posts"]["status"] == status
