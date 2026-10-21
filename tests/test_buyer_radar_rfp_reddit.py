"""Buyer Radar's RFP finder, Reddit search and the boost for a company found in several places, without
the network (tracker/buyer_radar_rfp.py, tracker/buyer_radar_reddit.py, buyer_radar.multi_signal)."""
import json
import os
import sys
from datetime import date
from decimal import Decimal

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests.test_buyer_radar import (BASE, EVIL, H, STAFF, FakeStore, _client, deps, mem, run_js,  # noqa: E402,F401
                                    verdict)
from tracker import buyer_radar as br  # noqa: E402
from tracker import buyer_radar_judge as judge  # noqa: E402
from tracker import buyer_radar_reddit as rd  # noqa: E402
from tracker import buyer_radar_rfp as rfp  # noqa: E402
from tracker import buyer_radar_send as send  # noqa: E402
from tracker import contact_lab_search as cls  # noqa: E402

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


# == one company, several places =========================================================================

def _l(source, company, score=60):
    return {"source": source, "score": score, "post": {"company": {"name": ""}}, "verdict": {"company": company, "score": score}}


def test_a_company_in_two_places_scores_higher_and_says_where():
    leads = [_l("jobs", "Acme Ltd"), _l("icp", "ACME"), _l("post", "Other Co", 70), _l("post", "Self-employed"),
             _l("reddit", "")]
    assert br.multi_signal(leads, [("rfp", "Acme Limited"), ("comment", "Other Co"), ("post", "Freelance")]) == 3
    assert [x["score"] for x in leads] == [76, 76, 78, 60, 60], "two other places for Acme, one for Other Co"
    assert leads[0]["verdict"]["signals"] == ["icp", "jobs", "rfp"] and leads[2]["verdict"]["signals"] == ["comment", "post"]
    assert leads[0]["verdict"]["score"] == 76 and "signals" not in leads[3]["verdict"], "no company, no boost"


def test_the_same_place_twice_is_not_two_places_and_the_boost_has_a_ceiling():
    leads = [_l("post", "Acme"), _l("post", "Acme")]
    assert br.multi_signal(leads, [("post", "Acme")]) == 0 and leads[0]["score"] == 60
    leads = [_l("post", "Acme", 95)]
    br.multi_signal(leads, [("jobs", "Acme"), ("icp", "Acme"), ("rfp", "Acme"), ("comment", "Acme")])
    assert leads[0]["score"] == 100 and br.MULTI_BOOST_MAX == 16


# == settings and cost ===================================================================================

def test_rfp_and_reddit_searches_and_their_numbers_are_checked():
    s = br.clean_settings({"rfp_queries": {"markify": "RFP SEO {year}\n\n  tender PPC ", "nobody": "x"},
                           "reddit_queries": {"callvibe": rd.OFFER_QUERIES["callvibe"]}, "rfp_days": 3, "reddit_per_query": 50})
    assert s["rfp_queries"] == {"markify": ["RFP SEO {year}", "tender PPC"]}
    assert s["reddit_queries"] == {}, "the defaults are kept as the defaults"
    assert (s["rfp_days"], s["reddit_per_query"]) == (3, 50)
    for bad in ({"rfp_queries": {"markify": ["x"] * (rfp.MAX_QUERIES + 1)}}, {"reddit_queries": {"callvibe": ["x" * 201]}},
                {"rfp_days": 0}, {"rfp_days": 31}, {"reddit_per_query": 101}):
        with pytest.raises(ValueError):
            br.clean_settings(bad)
    assert br.clean_settings({"sources": ["rfps"]})["sources"] == ["rfps"], "RFPs alone are a search"


def test_the_estimate_counts_the_web_searches_and_spreads_them_over_the_rfp_days():
    on = br.estimate(br.merged({}))
    off = br.estimate(br.merged({"sources": ["posts", "comments", "jobs", "icp"]}))
    n = sum(len(q) for q in rfp.OFFER_QUERIES.values())
    assert on["rfp_searches"] == n and on["web_usd"] > 0 and off["web_usd"] == 0 and off["rfp_searches"] == 0
    assert on["worst_usd"] > off["worst_usd"] and on["month_usd"] <= on["usd_cap"] * 30
    weekly = br.estimate(br.merged({"run_cap_usd": 20, "rfp_days": 7}))
    daily = br.estimate(br.merged({"run_cap_usd": 20, "rfp_days": 1}))
    assert daily["month_usd"] > weekly["month_usd"], "searching every day costs more than once a week"


# == the run =============================================================================================

def _rfp_signal(issuer="Acme Ltd", email="bids@acme.com"):
    return rfp.normalize({"title": "RFP for call recording", "issuer": issuer, "due": "2099-01-31", "contact_email": email,
                          "url": "https://acme.example/rfp", "summary": "A call recording system."}, "q", date(2026, 10, 21))


def _reddit_signal():
    return rd.normalize({"platform_post_id": "t1", "post_url": "https://www.reddit.com/r/sales/comments/t1/x/",
                         "caption": "Gong is too expensive, what else?", "raw": {"author": "jo", "subreddit": "sales"}}, "q")


def _world(monkeypatch, fake, out, **over):
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    monkeypatch.setenv("REDDIT_CLIENT_ID", "r")
    monkeypatch.setenv("REDDIT_CLIENT_SECRET", "s")
    fake.install(monkeypatch)
    d, posts = deps([], out)
    systems = []

    def judge_posts(ps, offers, budget, model, system=judge.JUDGE_SYSTEM, text_of=None):
        systems.append(system)
        budget.add("read", model, Decimal("0.01"), {})
        return {p["key"]: dict(verdict(85, offer="callvibe"), company=(p.get("company") or {}).get("name") or "") for p in ps}

    def rfps(queries, budget, model):
        out["rfps"] = len(queries)
        budget.add("search", model, Decimal("0.03"), {})
        return {"rfps": [_rfp_signal()], "notes": [], "searches": len(queries)}

    d.update(judge=judge_posts, rfps=rfps, reddit=lambda queries, per_query: out.setdefault("reddit", per_query) and
             {"posts": [_reddit_signal()], "notes": []})
    d.update(over)
    out["systems"] = systems
    return d


def test_a_run_keeps_an_rfp_with_its_address_and_a_reddit_thread_and_never_sends_either(monkeypatch):
    fake, out = FakeStore(recent=[("jobs", "ACME")]), {}
    d = _world(monkeypatch, fake, out)
    s = br.merged({"source": "apify", "auto_email": True, "auto_linkedin": True, "send_score": 50, "reddit_per_query": 40})
    summary = br.run(1, "acct:7", s, started_by="mia@x.com", deps=d)
    assert "reading Reddit" in fake.updates and "searching for RFPs" in fake.updates
    assert judge.REDDIT_SYSTEM in out["systems"] and judge.RFP_SYSTEM in out["systems"] and out["reddit"] == 40
    by = {x["source"]: x for x in fake.leads.values()}
    assert by["rfp"]["email"] == "bids@acme.com" and by["rfp"]["email_source"] == "rfp"
    assert by["rfp"]["verdict"]["deadline"] == "2099-01-31", "the RFP's due date when Claude gave none"
    assert by["rfp"]["score"] == 93 and by["rfp"]["verdict"]["signals"] == ["jobs", "rfp"], \
        "Acme's job ads, kept last month, raise its RFP"
    assert by["reddit"]["person"] == "reddit/jo" and by["reddit"]["score"] == 85
    assert "emailed" not in out and "messaged" not in out, "an RFP is the team's to answer; Reddit is answered in the thread"
    assert summary["by_source"]["rfp"] == 1 and summary["by_source"]["reddit"] == 1 and summary["multi"] == 1
    assert ("anthropic", "rfp-search", 0.03, 0, "acct:7", "mia@x.com") in fake.spend
    assert ("anthropic", "read-rfps", 0.01, 0, "acct:7", "mia@x.com") in fake.spend
    assert {"rfp:" + by["rfp"]["post"]["key"][4:], "reddit:t1"} <= fake.seen


def test_the_rfp_search_waits_its_days_and_reddit_without_keys_is_skipped(monkeypatch):
    fake, out = FakeStore(rfp_hours_ago=30), {}
    d = _world(monkeypatch, fake, out)
    monkeypatch.delenv("REDDIT_CLIENT_ID")
    summary = br.run(1, "acct:7", br.merged({"source": "apify"}), deps=d)
    assert "rfps" not in out and "reddit" not in out
    assert any("RFPs were searched in the last 7 days" in n for n in summary["notes"])
    assert not any("Reddit" in n for n in summary["notes"]), "on by default: the page says it is not set up"
    out.clear()
    br.run(2, "acct:7", br.merged({"source": "apify", "rfp_days": 1}), deps=_world(monkeypatch, FakeStore(rfp_hours_ago=30), out))
    assert out["rfps"] == sum(len(q) for q in rfp.OFFER_QUERIES.values()), "a day later, with rfp_days 1, it searches"
    monkeypatch.delenv("REDDIT_CLIENT_ID")
    with pytest.raises(RuntimeError) as e:
        br.run(3, "acct:7", br.merged({"sources": ["reddit"]}), deps=d)
    assert "REDDIT_CLIENT_ID" in str(e.value)


def test_an_rfp_search_stopped_at_the_cap_keeps_what_it_found_and_books_it(monkeypatch):
    fake, out = FakeStore(), {}

    def rfps(queries, budget, model):
        budget.add("search", model, Decimal("0.05"), {})
        e = cls.BudgetExceeded("cap")
        e.partial = {"rfps": [_rfp_signal()], "notes": []}
        raise e
    d = _world(monkeypatch, fake, out, rfps=rfps)
    summary = br.run(1, "acct:7", br.merged({"source": "apify", "sources": ["rfps"]}), deps=d)
    assert any("Stopped searching for RFPs" in n for n in summary["notes"])
    assert ("anthropic", "rfp-search", 0.05, 0, "acct:7", "") in fake.spend


# == what is written, and where it goes ===================================================================

def test_the_writer_is_told_an_rfp_was_published_and_a_reddit_reply_is_posted_in_the_thread():
    text, first = judge._signal_text({"post": _rfp_signal(), "verdict": {"need": "call recording"}})
    assert "RFP for call recording" in text and "Due 2099-01-31" in text and "never that they asked" in text and first == ""
    text, first = judge._signal_text({"post": _reddit_signal(), "verdict": {"need": "a cheaper Gong"}})
    assert "reply to post in the thread" in text and "nobody on Reddit is emailed" in text and first == ""
    assert "RFP 1\nTITLE: RFP for call recording" in judge.rfp_text(1, _rfp_signal())
    assert "in r/sales" in judge.reddit_text(2, _reddit_signal())


def test_slack_names_the_places_and_never_links_nowhere():
    icp = {"post": {"kind": "icp", "url": "", "author": {"name": "Meera", "headline": "VP Sales"}}, "offer": "callvibe",
           "score": 80, "verdict": {"intent_label": "Fits", "need": "x", "signals": ["icp", "jobs"]}}
    r = {"post": _rfp_signal(), "offer": "callvibe", "score": 90, "verdict": {"intent_label": "Looking", "need": "y"}}
    msg = json.dumps(send.slack_message("", [icp, r], "https://app/br"))
    assert "<|" not in msg and "Customer profile" in msg and "also found by hiring" in msg
    assert "<https://acme.example/rfp|Open the RFP>" in msg


def test_a_reddit_lead_never_goes_to_a_sequence():
    got = send.sequence_lead("o", {"source": "reddit", "offer": "callvibe"}, {"sequences": {"callvibe": {"step_id": "s"}}})
    assert got["ok"] is False and "in the thread" in got["detail"]


# == the routes and the page ==============================================================================

def test_status_has_the_rfp_and_reddit_defaults_and_says_a_run_can_go_on_rfps_alone(mem, monkeypatch):
    monkeypatch.delenv("UNIPILE_API_KEY", raising=False)
    monkeypatch.delenv("REDDIT_CLIENT_ID", raising=False)
    st = _client(STAFF).get(BASE + "/api/status").get_json()
    assert st["rfp_defaults"]["markify"] == rfp.OFFER_QUERIES["markify"] and st["reddit_defaults"]["callvibe"]
    assert st["ready"]["search"] is False and st["ready"]["run"] is True and st["ready"]["reddit"] is False


def test_there_is_no_email_to_find_for_an_rfp(mem, monkeypatch):
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    mem["leads"][9] = {"id": 9, "offer": "markify", "status": "new", "score": 80, "post": _rfp_signal(), "verdict": {},
                       "draft": None, "sends": [], "person": "", "email": None, "email_source": None, "source": "rfp"}
    r = _client(STAFF).post(BASE + "/api/leads/9/find-email", json={"confirm": True}, headers=H)
    assert r.status_code == 400 and "the address it gives" in r.get_json()["error"]


def test_the_page_shows_an_rfp_and_a_reddit_thread_as_themselves_and_escapes_them():
    r = _rfp_signal(issuer=EVIL)
    r["rfp"]["title"] = EVIL
    lead_r = {"id": 1, "offer": "callvibe", "score": 90, "status": "new", "source": "rfp", "person": "", "email": "bids@acme.com",
              "email_source": "rfp", "post": r, "verdict": {"need": "x", "deadline": "2099-01-31", "signals": ["jobs", "rfp"]},
              "draft": {"subject": "s", "email": "e", "note": "", "message": ""}, "sends": []}
    lead_t = {"id": 2, "offer": "callvibe", "score": 80, "status": "new", "source": "reddit", "person": "reddit/jo", "post": _reddit_signal(),
              "verdict": {"need": "y"}, "draft": {"subject": "", "email": "", "note": "", "message": EVIL}, "sends": []}
    out = run_js("const r = %s, t = %s; const ready = {email: true, linkedin: true, saleshandy: true};"
                 "return [BR.renderLead(r), BR.renderDrawer(r, ready, {sequences: {callvibe: {id: 'q'}}}), BR.renderLead(t),"
                 " BR.renderDrawer(t, ready, {}), BR.renderFilters('all', {})];" % (json.dumps(lead_r), json.dumps(lead_t)))
    card, drawer, tcard, tdrawer, filters = out
    for html in out:
        assert "<img" not in html
    assert "RFP" in card and "due 2099-01-31" in card and "Open the RFP" in card and "Also: Hiring" in card
    assert "The contact the RFP gives." in drawer and "never sent automatically" in drawer
    assert "Saleshandy sequence" not in drawer and "LinkedIn profile" in drawer
    assert "Open the thread" in tcard and 'data-act="copy"' in tdrawer and 'id="brTo"' not in tdrawer
    assert "Send email" not in tdrawer and "&lt;img" in tdrawer
    assert ">RFPs<" in filters and ">Reddit<" in filters and ">Hirings<" not in filters


def test_settings_have_rfp_and_reddit_searches_per_offer():
    html = run_js("return BR.renderSettings(%s, {callvibe: {label: 'CallVibe', site: 'x', queries: ['a'], jobs: ['j']}}, {}, {},"
                  " {rfpDefaults: {callvibe: ['RFP one {year}']}, redditDefaults: {callvibe: ['reddit one']}});"
                  % json.dumps(br.merged({})))
    assert 'id="brR-callvibe"' in html and "RFP one {year}" in html and 'id="brRd-callvibe"' in html and "reddit one" in html
    assert 'id="brRfpDays"' in html and 'id="brRdPer"' in html and 'id="brSrc-rfps"' in html and 'id="brSrc-reddit"' in html
