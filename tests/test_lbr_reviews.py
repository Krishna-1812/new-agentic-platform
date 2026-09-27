"""Local Business Radar, phase 6: reviews, the numbers and the themes."""

import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tracker import lbr_claude, lbr_http, lbr_reviews  # noqa: E402
from lbr_fakes import FakeResponse, FakeSession  # noqa: E402

NOW = datetime(2026, 9, 27, tzinfo=timezone.utc)


def _iso(days_ago):
    return (NOW - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _review(stars, days, text="Great visit", reply_after=None):
    r = {"rating": stars, "iso_date": _iso(days), "date": "%d days ago" % days, "snippet": text,
         "user": {"name": "Private Person", "link": "https://maps.google.com/contrib/1"}}
    if reply_after is not None:
        r["response"] = {"iso_date": _iso(days - reply_after), "snippet": "Thanks!"}
    return r


@pytest.fixture
def serp(monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "serp-key")
    monkeypatch.delenv("LBR_PRICES_JSON", raising=False)
    s = FakeSession()
    monkeypatch.setattr(lbr_http, "_SESSION", s)
    monkeypatch.setattr(lbr_http.time, "sleep", lambda x: None)
    return s


# ── Fetching ─────────────────────────────────────────────────────────────────

def test_reviews_are_paged_newest_first_and_each_page_is_billed(serp):
    pages = [FakeResponse(200, {"reviews": [_review(5, 3), _review(1, 9)], "topics": [{"keyword": "staff", "mentions": 12}],
                                "serpapi_pagination": {"next_page_token": "T2"}}),
             FakeResponse(200, {"reviews": [_review(4, 40)], "serpapi_pagination": {"next_page_token": "T3"}}),
             FakeResponse(200, {"reviews": [_review(3, 80)]})]
    serp.on("serpapi.com", pages)
    ledger = lbr_http.Ledger()
    out = lbr_reviews.fetch("ChIJabc", ledger)
    assert [r["id"] for r in out["reviews"]] == ["r1", "r2", "r3", "r4"] and out["pages"] == 3
    first, second = serp.requests[0]["params"], serp.requests[1]["params"]
    assert first["engine"] == "google_maps_reviews" and first["place_id"] == "ChIJabc"
    assert first["sort_by"] == "newestFirst" and "num" not in first, "num is refused on the first page"
    assert second["next_page_token"] == "T2" and second["num"] == 20
    assert out["topics"] == [{"keyword": "staff", "mentions": 12}]
    assert ledger.totals()["usd"] == pytest.approx(0.045)


def test_reviewer_names_are_never_kept(serp):
    serp.on("serpapi.com", FakeResponse(200, {"reviews": [_review(5, 3)]}))
    out = lbr_reviews.fetch("ChIJabc", lbr_http.Ledger())
    assert "Private Person" not in repr(out) and "contrib" not in repr(out)


def test_a_business_with_no_reviews_costs_nothing(serp):
    out = lbr_reviews.run(["p1"], {"p1": {"name": "New Co", "reviews": 0}}, lbr_http.Ledger())
    assert serp.requests == [] and out["p1"]["stats"]["sample"] == 0


# ── The numbers ──────────────────────────────────────────────────────────────

def _norm(rows):
    return [lbr_reviews.normalise(r, i + 1) for i, r in enumerate(rows)]


def test_sentiment_comes_from_the_stars_not_a_model():
    st = lbr_reviews.stats(_norm([_review(5, 1), _review(4, 2), _review(3, 3), _review(1, 4)]), 40, now=NOW)
    assert st["positive"] == 50 and st["neutral"] == 25 and st["negative"] == 25
    assert st["mix"] == {"1": 1, "2": 0, "3": 1, "4": 1, "5": 1} and st["avg"] == 3.25 and st["total"] == 40


def test_recency_velocity_and_trend():
    rows = [_review(2, d) for d in (5, 10, 20, 30)] + [_review(5, d) for d in (200, 220, 240, 260)]
    st = lbr_reviews.stats(_norm(rows), now=NOW)
    assert st["recent_90d"] == 4 and st["recent_avg"] == 2.0 and st["last_days"] == 5
    assert st["trend"] == -3.0, "the newer half averages 3 stars below the older half"
    assert st["per_month"] == pytest.approx(round(8 / (255 / 30.4), 1))


def test_owner_replies_are_measured_and_unanswered_bad_reviews_counted():
    rows = [_review(5, 10, reply_after=2), _review(1, 20), _review(2, 30, reply_after=6), _review(1, 40)]
    st = lbr_reviews.stats(_norm(rows), now=NOW)
    assert st["reply_rate"] == 50 and st["negative_reply_rate"] == 33
    assert st["unanswered_negative"] == 2 and st["reply_days_median"] == 6


def test_no_reviews_is_empty_numbers_not_an_error():
    st = lbr_reviews.stats([], 0, now=NOW)
    assert st["sample"] == 0 and st["avg"] is None and st["reply_rate"] is None


# ── The themes ───────────────────────────────────────────────────────────────

REVIEWS = _norm([_review(1, 3, "Waited 90 minutes past my appointment. Nobody apologised."),
                 _review(5, 5, "Dr Lee was gentle and explained everything."),
                 _review(2, 8, "Front desk was rude on the phone and billing was wrong.", reply_after=1),
                 _review(5, 12, "Staff were lovely, spotless office.")])


def test_every_quote_is_the_real_text_of_the_review_cited(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")

    def fake(system, user, ledger, **kw):
        assert "r1 | 1 stars" in user and "[no owner reply]" in user
        return {"summary": "Loved clinically, frustrating to deal with.",
                "praise": [{"theme": "Gentle dentist", "review_ids": ["r2", "r4"]},
                           {"theme": "Invented praise", "review_ids": ["r99"]}],
                "complaints": [{"theme": "Long waits", "severity": "high", "review_ids": ["r1"]},
                               {"theme": "Front desk", "severity": "extreme", "review_ids": ["r3"]}],
                "fixes": ["Text patients when the schedule runs late."],
                "review_plan": ["Ask every patient for a review at checkout with a QR card.",
                                "Offer a 10% discount for a 5-star review.",
                                "Only ask happy patients to leave a review."],
                "reply_drafts": [{"review_id": "r1", "draft": "We're sorry about the wait..."},
                                 {"review_id": "r3", "draft": "already has a reply"},
                                 {"review_id": "r2", "draft": "not negative"}]}
    monkeypatch.setattr(lbr_claude, "ask_json", fake)
    st = lbr_reviews.stats(REVIEWS, now=NOW)
    th = lbr_reviews.themes("Smile Studio", REVIEWS, st, lbr_http.Ledger())
    assert [t["theme"] for t in th["praise"]] == ["Gentle dentist"], "a theme citing no real review is dropped"
    assert th["praise"][0]["quote"] == "Dr Lee was gentle and explained everything."
    assert th["praise"][0]["mentions"] == 2
    assert th["complaints"][0]["quote"].startswith("Waited 90 minutes")
    assert th["complaints"][1]["severity"] == "medium", "an unknown severity is not passed through"
    assert th["review_plan"] == ["Ask every patient for a review at checkout with a QR card."], \
        "incentives and review gating are removed"
    assert [d["review_id"] for d in th["reply_drafts"]] == ["r1"]


def test_without_claude_the_numbers_still_come_back(monkeypatch, serp):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    serp.on("serpapi.com", FakeResponse(200, {"reviews": [_review(5, 3), _review(1, 4)]}))
    out = lbr_reviews.run(["p1"], {"p1": {"name": "Smile", "reviews": 2}}, lbr_http.Ledger())
    assert out["p1"]["themes"] is None and out["p1"]["stats"]["sample"] == 2
    assert out["p1"]["recent"][0]["stars"] == 5


def test_a_failed_fetch_is_reported_for_that_business_only(monkeypatch, serp):
    serp.on("place_id=bad", FakeResponse(500, {"error": "boom"}))
    ok = FakeResponse(200, {"reviews": [_review(4, 3)]})

    def route(method, url, params, body):
        return FakeResponse(401, {"error": "Invalid API key"}) if params.get("place_id") == "bad" else ok
    serp.handlers = [("serpapi.com", route)]
    out = lbr_reviews.run(["bad", "good"], {"bad": {"name": "B", "reviews": 5}, "good": {"name": "G", "reviews": 5}},
                          lbr_http.Ledger())
    assert "error" in out["bad"] and out["good"]["stats"]["sample"] == 1


@pytest.mark.parametrize("text", ["Give a free month to anyone who reviews", "Use review gating via a survey",
                                  "Buy reviews from a vendor", "Filter out unhappy customers before asking"])
def test_the_compliance_filter_catches_noncompliant_advice(text):
    assert lbr_reviews._NONCOMPLIANT.search(text)


@pytest.mark.parametrize("text", ["Ask every customer for a review by text after each visit",
                                  "Reply to every review within two days", "Put a QR code at checkout"])
def test_the_compliance_filter_leaves_good_advice_alone(text):
    assert not lbr_reviews._NONCOMPLIANT.search(text)
