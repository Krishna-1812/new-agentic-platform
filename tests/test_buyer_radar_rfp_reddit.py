"""Buyer Radar's RFP finder and Reddit search, without the network (tracker/buyer_radar_rfp.py,
tracker/buyer_radar_reddit.py)."""
from datetime import date

import pytest

from tracker import buyer_radar_reddit as rd, buyer_radar_rfp as rfp, contact_lab_search as cls

TODAY = date(2026, 10, 21)


def _item(**kw):
    out = {"title": "RFP for SEO services", "issuer": "City of Pune", "due": "2026-11-15", "location": "Pune",
           "contact_email": "Procurement@Pune.gov.in", "url": "https://pune.gov.in/rfp/seo",
           "summary": "SEO for the city's website."}
    out.update(kw)
    return out


def test_an_open_rfp_becomes_a_signal_with_its_contact_address():
    got = rfp.normalize(_item(), "q", TODAY, {"https://pune.gov.in/rfp/seo"})
    assert got["kind"] == "rfp" and got["key"].startswith("rfp:")
    assert got["rfp"]["contact_email"] == "procurement@pune.gov.in"
    assert got["rfp"]["due"] == "2026-11-15" and "Due 2026-11-15" in got["text"]
    assert got["company"]["name"] == "City of Pune" and got["author"]["key"] == ""


def test_a_past_due_date_a_bad_address_or_a_link_the_search_never_returned_is_left_out():
    assert rfp.normalize(_item(due="2026-10-01"), "q", TODAY) is None
    assert rfp.normalize(_item(url="https://elsewhere.example/rfp"), "q", TODAY, {"https://pune.gov.in/rfp/seo"}) is None
    assert rfp.normalize(_item(url="https://pune.gov.in/rfp/seo"), "q", TODAY, set()) is None
    assert rfp.normalize(_item(contact_email="not an email"), "q", TODAY)["rfp"]["contact_email"] == ""
    assert rfp.normalize(_item(title=""), "q", TODAY) is None


def test_a_trailing_slash_or_case_does_not_make_a_link_new_or_unknown():
    a = rfp.normalize(_item(url="https://pune.gov.in/rfp/seo/"), "q", TODAY, {"https://pune.gov.in/rfp/seo"})
    b = rfp.normalize(_item(url="https://PUNE.gov.in/rfp/seo"), "q", TODAY)
    assert a and b and a["key"] == b["key"]


def test_collect_fills_in_the_year_reads_the_reply_and_counts_searches():
    asked = []

    def search(q, *, model, budget, ask):
        asked.append(q)
        return {"status": "ok", "searches": 1, "results": [{"url": "https://pune.gov.in/rfp/seo"}],
                "reply": 'Here: {"rfps": [%s]}' % __import__("json").dumps(_item())}

    got = rfp.collect(["RFP SEO {year}", "RFP SEO again {year}"], budget=None, model="m", today=TODAY, search=search)
    assert asked == ["RFP SEO 2026", "RFP SEO again 2026"]
    assert len(got["rfps"]) == 1 and got["searches"] == 2 and got["notes"] == []


def test_collect_notes_a_failed_search_and_carries_what_it_found_past_the_cap():
    calls = []

    def search(q, *, model, budget, ask):
        calls.append(q)
        if len(calls) == 1:
            return {"status": "failed", "note": "the model did not run the search"}
        raise cls.BudgetExceeded("cap")

    with pytest.raises(cls.BudgetExceeded) as e:
        rfp.collect(["a", "b"], budget=None, model="m", today=TODAY, search=search)
    assert "did not run" in e.value.partial["notes"][0]


def test_own_searches_replace_the_defaults():
    assert rfp.queries_for({"rfp_queries": {"markify": ["x"]}}, "markify") == ["x"]
    assert rfp.queries_for({}, "callvibe") == rfp.OFFER_QUERIES["callvibe"]
    assert rd.queries_for({}, "markify") == rd.OFFER_QUERIES["markify"]


def _thread(**kw):
    out = {"platform_post_id": "abc", "post_url": "https://www.reddit.com/r/PPC/comments/abc/x/",
           "caption": "Any PPC agency you would recommend for a small SaaS?", "posted_at": "2026-10-20T00:00:00+00:00",
           "metrics": {"likes": 4, "comments": 7}, "raw": {"author": "Founder_Jo", "subreddit": "PPC"}}
    out.update(kw)
    return out


def test_a_reddit_thread_reads_as_a_post_by_its_author():
    got = rd.normalize(_thread(), "q")
    assert got["key"] == "reddit:abc" and got["kind"] == "reddit"
    assert got["author"]["name"] == "u/Founder_Jo" and got["author"]["key"] == "reddit/founder_jo"
    assert got["author"]["headline"] == "in r/PPC" and got["comments"] == 7


def test_deleted_authors_and_automoderator_are_left_out():
    assert rd.normalize(_thread(raw={"author": "[deleted]"}), "q") is None
    assert rd.normalize(_thread(raw={"author": "AutoModerator"}), "q") is None
    assert rd.normalize(_thread(platform_post_id=""), "q") is None


def test_reddit_collect_keeps_each_thread_once_and_notes_a_failure():
    def search(q, **kw):
        if q == "bad":
            raise RuntimeError("boom")
        assert kw == {"sort": "new", "time_filter": "month", "limit": 25}
        return [_thread(), _thread()]

    got = rd.collect(["a", "b", "bad"], search=search)
    assert [p["key"] for p in got["posts"]] == ["reddit:abc"]
    assert "RuntimeError" in got["notes"][0]
