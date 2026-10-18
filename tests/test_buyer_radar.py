"""Buyer Radar: LinkedIn posts from people asking for what we sell (tracker/buyer_radar*.py).

What is held here:
  * the search: the actor's input, every shape of its output read the same, a person one key however
    their link is written, LinkedIn's own query rules;
  * the settings: checked, laid over the defaults;
  * Claude's reading: a seller or a job seeker is never a lead whatever score the model gives; a batch
    past the cap keeps what was read;
  * the run: dedupe, the keep score, drafting, auto-send only where switched on and only above the send
    score, Slack only for strong leads, every cost recorded;
  * sending: switched off, opted out, already contacted, daily caps, company pages; the email's opt-out
    link and address; LinkedIn's message or connection request;
  * the routes: the team's settings and sends, the cron token, the opt-out page, a client's search that
    never sends;
  * the page script under Node with hostile strings (posts, names and drafts come from LinkedIn and a model).
"""
import json
import os
import shutil
import subprocess
import sys
from decimal import Decimal

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tracker import buyer_radar as br  # noqa: E402
from tracker import buyer_radar_judge as judge  # noqa: E402
from tracker import buyer_radar_send as send  # noqa: E402
from tracker import buyer_radar_source as src  # noqa: E402
from tracker import buyer_radar_store as store  # noqa: E402
from tracker import contact_lab_search as cls  # noqa: E402

EVIL = '<img src=x onerror=alert(1)>"\'&'
STAFF = "kris@markifydigital.com"
BASE = "/strategic-agents/buyer-radar"


def raw_post(n, text="We are looking for a call analytics tool for our sales team. Demos welcome.", **author):
    """A post as the actor returns it (checked against a live run on 2026-10-18)."""
    a = {"name": "Person %d" % n, "info": "Head of Sales at Acme", "linkedinUrl": "https://www.linkedin.com/in/person-%d/" % n,
         "type": "profile"}
    a.update(author)
    return {"id": "7%015d" % n, "linkedinUrl": "https://www.linkedin.com/posts/p%d-share-7%015d-abc?utm=1" % (n, n),
            "content": text, "postedAt": {"timestamp": 1792137600000, "date": "2026-10-16T08:00:00Z", "postedAgoShort": "2d"},
            "author": a, "engagement": {"likes": 4, "comments": 2, "shares": 0, "reactions": [{"type": "LIKE", "count": 4}]},
            "comments": [{"id": "c1"}], "reactions": [{"type": "LIKE"}],
            "query": {"sortBy": "date", "page": 1, "search": '"call analytics"', "postedLimit": "24h"}}


# == the search ==========================================================================================

def test_the_actor_is_asked_for_recent_posts_sorted_by_date():
    got = src.build_input(['"call analytics"', " ", "x"], posted="week", per_query=30)
    assert got == {"searchQueries": ['"call analytics"', "x"], "maxPosts": 30, "postedLimit": "week",
                   "sortBy": "date", "profileScraperMode": "short"}
    assert src.build_input(["x"], posted="forever")["postedLimit"] == "3months"
    assert src.build_input(["x"])["postedLimit"] == "3months", "buyers post rarely: the last 3 months, not the last day"


def test_a_post_is_read_the_same_whatever_shape_the_actor_returns():
    other = {"url": "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/", "text": "Need an agency",
             "authorName": "Ana", "authorProfileUrl": "https://linkedin.com/in/Ana-B?x=1"}
    posts = src.normalize([raw_post(1), raw_post(1), other, {"content": "no link"}, {"linkedinUrl": "x", "content": " "}, "junk"])
    assert [p["key"] for p in posts] == ["7000000000000001", "7123456789012345678"], "duplicates and empty posts dropped"
    a = posts[0]
    assert a["url"].endswith("-abc") and "?" not in a["url"]
    assert a["author"] == {"name": "Person 1", "headline": "Head of Sales at Acme",
                           "url": "https://www.linkedin.com/in/person-1/", "key": "in/person-1", "company": False}
    assert posts[1]["author"]["key"] == "in/ana-b" and posts[1]["author"]["name"] == "Ana"
    assert (a["query"], a["reactions"], a["comments"], a["posted_at"]) == ('"call analytics"', 4, 2, "2026-10-16T08:00:00Z")
    assert (posts[1]["query"], posts[1]["reactions"], posts[1]["comments"]) == ("", 0, 0)


def test_the_search_a_post_came_from_is_its_text_whatever_shape_it_comes_in():
    """The actor returns the query as a dict; the run looks the offer up by it, so it must be a string."""
    base = raw_post(1)
    for q, want in [({"search": "x"}, "x"), ("y", "y"), ({"page": 1}, ""), (None, ""), (["x"], "")]:
        assert src.normalize([dict(base, query=q)])[0]["query"] == want
    no_counts = dict(base, engagement=None, comments=[{"id": "c1"}], likes=True)
    assert (src.normalize([no_counts])[0]["comments"], src.normalize([no_counts])[0]["reactions"]) == (0, 0)


@pytest.mark.parametrize("url, key", [
    ("https://www.linkedin.com/in/Jane-Doe/", "in/jane-doe"), ("linkedin.com/in/jane-doe?trk=x", "in/jane-doe"),
    ("https://in.linkedin.com/in/jane-doe/details/", "in/jane-doe"), ("https://www.linkedin.com/company/acme/", "company/acme"),
    ("", ""), (None, "")])
def test_a_person_is_one_key_however_their_link_is_written(url, key):
    assert src.profile_key(url) == key


def test_a_company_page_post_is_marked_so_it_is_never_messaged_as_a_person():
    p = src.normalize([raw_post(2, linkedinUrl="https://www.linkedin.com/company/acme/", type="company")])[0]
    assert p["author"]["company"] is True and p["author"]["key"] == "company/acme"


@pytest.mark.parametrize("q, bad", [
    ('"call analytics" AND (vendor OR tool)', None), ("", "is empty"), ("x" * 501, "is longer than 500 characters"),
    ("a AND b OR c AND d OR e NOT f AND g", "has more than 5 AND/OR/NOT")])
def test_queries_follow_linkedins_rules(q, bad):
    assert src.check_query(q) == bad


def test_every_default_search_is_one_linkedin_accepts():
    for offer in br.OFFERS.values():
        assert offer["queries"] and len(offer["queries"]) <= br.MAX_QUERIES
        for q in offer["queries"]:
            assert src.check_query(q) is None, q
            assert '"' in q, "each search holds a quoted phrase, not single words a seller's post also has"
    calls = " ".join(br.OFFERS["callvibe"]["queries"]).lower()
    assert '"call auditing"' in calls and "freelancer" in calls, "finds 'Looking for an AI Solution / Freelancer for Call Auditing'"
    assert '"marketing agency" AND (hiring OR RFP' in " ".join(br.OFFERS["markify"]["queries"]), "finds 'hiring a marketing agency... RFP'"
    assert sum(len(o["queries"]) for o in br.OFFERS.values()) * 25 <= 900, "a run fits in Unipile's day"
    assert br.merged({})["posted"] == "3months" and "3months" in src.POSTED
    assert br.clean_settings({"posted": "3months"})["posted"] == "3months"


def test_collect_caps_the_charge_and_reports_what_apify_charged():
    seen = {}

    def runner(actor, run_input, token, timeout, max_charge_usd):
        seen.update(actor=actor, input=run_input, cap=max_charge_usd, token=token)
        return {"items": [raw_post(1)], "usd": 0.04, "error": None, "status": "SUCCEEDED"}
    got = src.collect(["x"], "tok", max_charge_usd=1.6, runner=runner)
    assert seen["actor"] == "harvestapi/linkedin-post-search" and seen["cap"] == 1.6 and seen["token"] == "tok"
    assert got["usd"] == 0.04 and len(got["posts"]) == 1


def test_a_refused_start_says_why_in_apifys_own_words(monkeypatch):
    import requests
    from tracker import apify_transport as at

    class R:
        status_code = 403

        def raise_for_status(self):
            raise requests.HTTPError("403 Client Error: Forbidden for url: https://api.apify.com/v2/acts/x/runs", response=self)

        def json(self):
            return {"error": {"type": "insufficient-permissions", "message": "This token is not allowed to run this Actor."}}
    monkeypatch.setattr(at.requests, "post", lambda *a, **k: R())
    got = at.run_actor_collect("x/y", {}, "t")
    assert got["error"] == ("start failed: Apify answered HTTP 403: This token is not allowed to run this Actor. "
                            "(insufficient-permissions)")
    R.json = lambda self: (_ for _ in ()).throw(ValueError("not json"))
    assert "403 Client Error" in at.run_actor_collect("x/y", {}, "t")["error"], "no body: the plain error, as before"


def test_apify_collect_passes_the_cap_and_returns_the_runs_cost(monkeypatch):
    from tracker import apify_transport as at
    calls = []

    class R:
        def __init__(self, data):
            self._d = data

        def raise_for_status(self):
            pass

        def json(self):
            return self._d
    monkeypatch.setattr(at.requests, "post", lambda url, json=None, headers=None, params=None, timeout=None:
                        calls.append(params) or R({"data": {"id": "r1"}}))
    monkeypatch.setattr(at, "_poll_run", lambda *a: {"status": "SUCCEEDED", "usageTotalUsd": 0.31, "defaultDatasetId": "d"})
    monkeypatch.setattr(at, "_fetch_dataset_items", lambda d, t: [{"a": 1}])
    got = at.run_actor_collect("x/y", {}, "t", max_charge_usd=1.5)
    assert calls[0]["maxTotalChargeUsd"] == "1.50" and got["usd"] == 0.31 and got["items"] == [{"a": 1}]


# == settings ============================================================================================

def test_settings_start_from_the_defaults_and_keep_what_was_saved():
    s = br.merged({"daily": True, "senders": {"callvibe": {"name": "Kris", "email": "k@callvibe.ai", "junk": 1}}, "nope": 1})
    assert s["daily"] is True and s["offers"] == ["callvibe", "markify"] and "nope" not in s
    assert s["senders"]["callvibe"] == {"name": "Kris", "title": "", "email": "k@callvibe.ai"}
    assert s["senders"]["markify"] == {"name": "", "title": "", "email": ""}


def test_settings_are_checked():
    ok = br.clean_settings({"offers": ["callvibe"], "per_query": "40", "daily": True, "auto_email": "yes",
                            "queries": {"callvibe": '"call QA" AND vendor\n\n"speech analytics"', "nope": "x"},
                            "slack_channel": "#buyer-leads", "run_cap_usd": "3.456", "keep_score": 60, "alert_score": 40})
    assert ok["offers"] == ["callvibe"] and ok["per_query"] == 40 and ok["daily"] is True
    assert ok["auto_email"] is False, "only a real true switches sending on"
    assert ok["queries"] == {"callvibe": ['"call QA" AND vendor', '"speech analytics"']}
    assert ok["run_cap_usd"] == 3.46 and ok["alert_score"] == 60, "strong is never below kept"
    same = br.clean_settings({"queries": {"markify": "\n".join(br.OFFERS["markify"]["queries"])}})
    assert same["queries"] == {}, "the defaults are not saved as the workspace's own"
    for bad, word in (({"offers": []}, "at least one"), ({"per_query": 500}, "between"), ({"posted": "year"}, "How far back"),
                      ({"queries": {"callvibe": "a AND b AND c AND d AND e AND f AND g"}}, "AND/OR/NOT"),
                      ({"slack_channel": "not a channel!"}, "Slack"), ({"senders": {"markify": {"email": "nope"}}}, "sender"),
                      ({"run_cap_usd": 99}, "between"), ({"daily_linkedin_cap": 500}, "between")):
        with pytest.raises(ValueError) as e:
            br.clean_settings(bad)
        assert word in str(e.value), bad


def test_the_estimate_is_capped_and_honest_about_a_month():
    s = br.merged({"source": "apify"})
    e = br.estimate(s)
    n = sum(len(o["queries"]) for o in br.OFFERS.values())
    assert e["queries"] == n and e["posts"] == n * 25
    assert e["apify_usd"] == pytest.approx(n * 25 * 0.002)
    assert e["typical_usd"] < e["worst_usd"] and e["claude_usd"] > 0
    assert e["month_usd"] == round(min(e["worst_usd"], 2.0) * 30, 2)
    one = br.estimate(br.merged({"offers": ["callvibe"], "per_query": 5, "source": "apify"}))
    assert one["posts"] == len(br.OFFERS["callvibe"]["queries"]) * 5


def test_an_email_written_in_the_post_is_found_free():
    assert br.emails_in("Send decks to Vendors@Acme.com. Or ops@acme.co.uk, logo@x.png; Vendors@acme.com") == \
        ["vendors@acme.com", "ops@acme.co.uk"]


# == Claude's reading ====================================================================================

OFFERS = {k: br.OFFERS[k] for k in ("callvibe", "markify")}


def test_a_seller_or_job_seeker_is_never_a_lead_whatever_score_the_model_gave():
    base = {"offer": "callvibe", "intent": "seeking_vendor", "score": 95, "need": "x", "company": "", "region": "",
            "deadline": "", "reason": "r"}
    assert judge.clean_verdict(dict(base, role="buyer"), OFFERS)["score"] == 95
    assert judge.clean_verdict(dict(base, role="seller"), OFFERS)["score"] == 10
    assert judge.clean_verdict(dict(base, role="job_seeker"), OFFERS)["score"] == 10
    assert judge.clean_verdict(dict(base, role="buyer", offer="gong"), OFFERS)["offer"] == "none"
    assert judge.clean_verdict(dict(base, role="buyer", offer="Markify Digital"), OFFERS)["offer"] == "markify"
    assert judge.clean_verdict(dict(base, role="buyer", offer="CallVibe"), OFFERS)["score"] == 95
    v = judge.clean_verdict(dict(base, role="buyer", score="250", intent="??"), OFFERS)
    assert v["score"] == 10 and v["intent"] == "none" and v["intent_label"] == "Not buying"


def test_posts_are_read_in_batches_and_each_verdict_finds_its_post():
    posts = src.normalize([raw_post(i) for i in range(1, 11)])
    batches = []

    def call(budget, stage, model, system, user, schema, max_tokens):
        batches.append(user)
        offer = schema["properties"]["verdicts"]["items"]["properties"]["offer"]
        assert offer["enum"] == ["callvibe", "markify", "none"], "the model can only name a real offer"
        n = user.count("POST ")
        return {"verdicts": [{"n": i, "role": "buyer", "offer": "callvibe", "intent": "seeking_vendor", "score": 80 + i,
                              "need": "a tool", "company": "", "region": "", "deadline": "", "reason": ""}
                             for i in range(1, n + 1)] + [{"n": 99, "role": "buyer"}, {"n": "x"}]}
    got = judge.judge_posts(posts, OFFERS, budget=cls.Budget(1), call=call)
    assert len(batches) == 2 and batches[0].count("POST ") == 8 and "OFFER callvibe" in batches[0]
    assert "enum" not in judge.JUDGE_SCHEMA["properties"]["verdicts"]["items"]["properties"]["offer"], "not changed in place"
    assert got[posts[0]["key"]]["score"] == 81 and got[posts[8]["key"]]["score"] == 81 and len(got) == 10


def test_a_batch_past_the_cap_keeps_what_was_read():
    posts = src.normalize([raw_post(i) for i in range(1, 11)])
    calls = []

    def call(budget, stage, model, system, user, schema, max_tokens):
        calls.append(1)
        if len(calls) == 2:
            raise cls.BudgetExceeded("cap")
        return {"verdicts": [{"n": 1, "role": "buyer", "offer": "markify", "intent": "seeking_vendor", "score": 90,
                              "need": "", "company": "", "region": "", "deadline": "", "reason": ""}]}
    with pytest.raises(cls.BudgetExceeded) as e:
        judge.judge_posts(posts, OFFERS, budget=cls.Budget(1), call=call)
    assert list(e.value.partial) == [posts[0]["key"]]


def test_a_draft_has_no_em_dashes_and_a_note_linkedin_accepts():
    lead = {"post": src.normalize([raw_post(1)])[0], "verdict": {"need": "a call audit tool"}}
    seen = {}

    def call(budget, stage, model, system, user, schema, max_tokens):
        seen["user"] = user
        return {"subject": "Your call audit post", "email": "Hi Person — we built this.", "note": "n" * 400, "message": "m"}
    d = judge.draft(lead, br.OFFERS["callvibe"], {"name": "Kris", "title": "Founder"}, budget=cls.Budget(1), call=call)
    assert d["email"] == "Hi Person, we built this." and len(d["note"]) == 300
    assert "Kris, Founder" in seen["user"] and "Person" in seen["user"] and "a call audit tool" in seen["user"]


# == the run =============================================================================================

class FakeStore:
    def __init__(self, known=(), unipile_today=0):
        self.known, self.spend, self.leads, self.updates, self.sent = set(known), [], {}, [], {"email": 0, "linkedin": 0}
        self.unipile_today = unipile_today

    def install(self, monkeypatch):
        monkeypatch.setenv("UNIPILE_API_KEY", "u")
        for name in ("update_run", "add_spend", "known_posts", "add_leads", "get_lead", "update_lead", "sent_today",
                     "unipile_results_today"):
            monkeypatch.setattr(store, name, getattr(self, name))

    def unipile_results_today(self):
        return self.unipile_today

    def update_run(self, run_id, **kw):
        self.updates.append(kw.get("stage"))

    def add_spend(self, run_id, owner, who, provider, op, usd=0, credits=0):
        self.spend.append((provider, op, round(float(usd), 6), credits, owner, who))

    def known_posts(self, owner, keys):
        return {k for k in keys if k in self.known}

    def add_leads(self, owner, run_id, leads):
        ids = []
        for lead in leads:
            i = len(self.leads) + 1
            self.leads[i] = dict(lead, id=i, email=(lead.get("emails") or [None])[0], draft=lead.get("draft"))
            ids.append(i)
        return ids

    def get_lead(self, lead_id, owner):
        return self.leads.get(lead_id)

    def update_lead(self, lead_id, owner, **kw):
        self.leads[lead_id].update(kw)
        return True

    def sent_today(self, owner, channel):
        return self.sent[channel]


def verdict(score, offer="callvibe", role="buyer"):
    return {"role": role, "offer": offer, "intent": "seeking_vendor", "score": score, "need": "a tool",
            "company": "", "region": "", "deadline": "", "reason": "", "intent_label": ""}


def deps(scores, out, **over):
    """A run's outside world: the search returns one post per score; Claude scores them as given."""
    raws = [raw_post(i, text="Looking for call analytics. Write to buyer%d@acme.com" % i if i == 1 else "Need it")
            for i in range(1, len(scores) + 1)]
    posts = src.normalize(raws)

    def search(queries, token, posted, per_query, max_charge_usd):
        out["search"] = (len(queries), posted, per_query, max_charge_usd)
        return {"posts": src.normalize([dict(raw, query={"search": queries[0], "page": 1}) for raw in raws]),
                "usd": 0.25, "error": None}

    def unipile_search(queries, posted, per_query, room):
        out["unipile"] = (len(queries), posted, per_query, room)
        return {"posts": src.normalize([dict(raw, query=queries[0]) for raw in raws]), "usd": 0.0, "error": None,
                "results": len(raws), "notes": ["Unipile looks back a month at most, so this search read the last month."]}

    def judge_posts(ps, offers, budget, model):
        budget.add("read", model, Decimal("0.01"), {})
        return {p["key"]: verdict(s) for p, s in zip(posts, scores) if p["key"] in {x["key"] for x in ps}}

    def draft(lead, offer, sender, budget, model):
        budget.add("draft", model, Decimal("0.002"), {})
        return {"subject": "s", "email": "e", "note": "n", "message": "m"}

    def send_email(owner, lead, settings, by, auto):
        out.setdefault("emailed", []).append(lead["id"])
        return {"ok": True}

    def send_linkedin(owner, lead, settings, by, auto):
        out.setdefault("messaged", []).append(lead["id"])
        return {"ok": True}

    def slack(channel, owner, leads):
        out["slack"] = (channel, [x["score"] for x in leads])
        return True, ""

    def find_emails(leads):
        out["find"] = [x["id"] for x in leads]
        return {x["id"]: "found%d@acme.com" % x["id"] for x in leads}, len(leads), None
    d = {"search": search, "unipile_search": unipile_search, "judge": judge_posts, "draft": draft, "send_email": send_email, "send_linkedin": send_linkedin,
         "slack": slack, "find_emails": find_emails}
    d.update(over)
    return d, posts


def test_a_run_keeps_the_buyers_drafts_them_and_records_every_cost(monkeypatch):
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    fake = FakeStore()
    fake.install(monkeypatch)
    out = {}
    d, posts = deps([92, 40, 75, 10], out)
    s = br.merged({"source": "apify"})
    summary = br.run(1, "acct:7", s, started_by="mia@x.com", deps=d)
    assert out["search"] == (sum(len(o["queries"]) for o in br.OFFERS.values()), "3months", 25, pytest.approx(1.6))
    assert (summary["posts"], summary["read"], summary["kept"], summary["strong"], summary["drafted"]) == (4, 4, 2, 2, 2)
    assert [x["score"] for x in fake.leads.values()] == [92, 75], "best first, below 50 not kept"
    assert fake.leads[1]["email"] == "buyer1@acme.com", "the address in the post is kept"
    assert "emailed" not in out and "messaged" not in out and "slack" not in out, "nothing sent unless switched on"
    assert ("apify", "post-search", 0.25, 0, "acct:7", "mia@x.com") in fake.spend
    assert ("anthropic", "read", 0.01, 0, "acct:7", "mia@x.com") in fake.spend
    assert ("anthropic", "draft", 0.004, 0, "acct:7", "mia@x.com") in fake.spend
    assert fake.updates[:3] == ["searching", "reading", "drafting"]
    assert [(c["score"], c["role"]) for c in summary["closest"]] == [(40, "buyer"), (10, "buyer")], \
        "the best posts not kept, so a search that keeps nothing says how close it came"
    assert summary["closest"][0]["url"].startswith("https://www.linkedin.com/posts/") and summary["notes"] == []


def test_posts_claude_could_not_read_are_said_in_the_runs_notes(monkeypatch):
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    FakeStore().install(monkeypatch)
    d, posts = deps([92, 91, 90], {})
    d["judge"] = lambda ps, offers, budget, model: {posts[0]["key"]: verdict(92)}
    summary = br.run(1, "k", br.merged({}), deps=d)
    assert summary["read"] == 1 and summary["kept"] == 1 and summary["closest"] == []
    assert summary["notes"][-1] == "Claude could not read 2 of the 3 posts."


def test_a_post_already_kept_is_not_read_again(monkeypatch):
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    out = {}
    d, posts = deps([92, 91], out)
    fake = FakeStore(known={posts[0]["key"]})
    fake.install(monkeypatch)
    summary = br.run(1, "kris@x.com", br.merged({}), deps=d)
    assert summary["posts"] == 2 and summary["new_posts"] == 1 and summary["kept"] == 1


def test_auto_send_goes_only_to_leads_above_the_send_score_and_slack_gets_the_strong(monkeypatch):
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    fake = FakeStore()
    fake.install(monkeypatch)
    out = {}
    d, _ = deps([92, 75, 85], out)
    s = br.merged({"auto_email": True, "auto_linkedin": True, "find_emails": True, "slack_channel": "#leads",
                   "daily_email_cap": 1})
    summary = br.run(1, "kris@x.com", s, deps=d)
    by_score = {x["score"]: i for i, x in fake.leads.items()}
    assert out["find"] == [by_score[85]], "emails found only for strong leads without one, within the cap"
    assert sorted(out["emailed"]) == sorted([by_score[92], by_score[85]]), "the post's own address, and the one found"
    assert sorted(out["messaged"]) == sorted([by_score[92], by_score[85]]), "75 is below the send score of 80"
    assert ("saleshandy", "email-reveal", 0.0, 1, "kris@x.com", "") in fake.spend
    assert out["slack"] == ("#leads", [92, 85, 75]) and summary["slack"] == "sent"
    assert summary["emailed"] == 2 and summary["messaged"] == 2


def test_a_cap_or_a_switched_off_send_stops_the_rest(monkeypatch):
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    fake = FakeStore()
    fake.install(monkeypatch)
    out = {}
    d, _ = deps([92, 91, 90], out, send_linkedin=lambda *a, **k: out.setdefault("li", []).append(1) or
                {"ok": False, "stop": True, "detail": "today's automatic limit of 0 is reached"})
    summary = br.run(1, "kris@x.com", br.merged({"auto_linkedin": True}), deps=d)
    assert out["li"] == [1] and summary["messaged"] == 0
    assert any("LinkedIn stopped" in n for n in summary["notes"])


def test_a_search_that_did_not_run_fails_the_run_and_one_cut_short_keeps_its_posts(monkeypatch):
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    FakeStore().install(monkeypatch)
    d, _ = deps([90], {}, search=lambda *a, **k: {"posts": [], "usd": 0, "error": "start failed: 401"})
    with pytest.raises(RuntimeError) as e:
        br.run(1, "k", br.merged({"source": "apify"}), deps=d)
    assert "did not run" in str(e.value)
    monkeypatch.delenv("APIFY_API_TOKEN")
    with pytest.raises(RuntimeError) as e:
        br.run(1, "k", br.merged({"source": "apify"}), deps=d)
    assert "APIFY_API_TOKEN" in str(e.value)
    monkeypatch.delenv("UNIPILE_API_KEY")
    with pytest.raises(RuntimeError) as e:
        br.run(1, "k", br.merged({}), deps=d)
    assert "UNIPILE_API_KEY" in str(e.value)


def test_a_unipile_search_is_free_keeps_to_the_days_limit_and_says_how_far_back_it_read(monkeypatch):
    from tracker import buyer_radar_unipile as uni
    monkeypatch.delenv("APIFY_API_TOKEN", raising=False)
    fake = FakeStore(unipile_today=uni.DAY_MAX - 100)
    fake.install(monkeypatch)
    out = {}
    d, _ = deps([92, 40], out)
    summary = br.run(1, "acct:7", br.merged({}), started_by="mia@x.com", deps=d)
    assert br.merged({})["source"] == "unipile", "Unipile is the default: nothing to pay per post"
    n = sum(len(o["queries"]) for o in br.OFFERS.values())
    assert out["unipile"] == (n, "3months", 25, 100) and "search" not in out, "the room left today, not more"
    assert summary["source"] == "unipile" and summary["unipile_results"] == 2 and summary["kept"] == 1
    assert not any(s[0] == "apify" for s in fake.spend), "no Apify spend through Unipile"
    assert any("a month at most" in n for n in summary["notes"])
    FakeStore(unipile_today=uni.DAY_MAX).install(monkeypatch)
    with pytest.raises(RuntimeError) as e:
        br.run(2, "acct:7", br.merged({}), deps=d)
    assert "Unipile limit" in str(e.value) and "Apify" in str(e.value)


def test_search_with_is_unipile_or_apify_and_the_estimate_follows_it():
    assert br.clean_settings({"source": "apify"})["source"] == "apify"
    with pytest.raises(ValueError):
        br.clean_settings({"source": "phantom"})
    uni, apify = br.estimate(br.merged({})), br.estimate(br.merged({"source": "apify"}))
    n = sum(len(o["queries"]) for o in br.OFFERS.values())
    assert uni["source"] == "unipile" and uni["apify_usd"] == 0 and apify["apify_usd"] == pytest.approx(n * 25 * 0.002)
    assert br.estimate(br.merged({"per_query": 100}))["posts"] == 900, "a Unipile run reads at most the day's limit"
    assert uni["worst_usd"] < apify["worst_usd"]


def test_a_run_stopped_at_the_cap_keeps_its_leads(monkeypatch):
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    fake = FakeStore()
    fake.install(monkeypatch)
    out = {}
    d, posts = deps([90, 88], out)

    def judge_posts(ps, offers, budget, model):
        e = cls.BudgetExceeded("cap")
        e.partial = {posts[0]["key"]: verdict(90)}
        raise e

    def draft(*a, **k):
        raise cls.BudgetExceeded("cap")
    d.update(judge=judge_posts, draft=draft)
    summary = br.run(1, "k", br.merged({}), deps=d)
    assert summary["kept"] == 1 and summary["drafted"] == 0 and len(fake.leads) == 1
    assert sum("cost cap" in n for n in summary["notes"]) == 2


def test_the_background_job_marks_the_run_done_or_failed(monkeypatch):
    marks = []
    monkeypatch.setattr(store, "update_run", lambda run_id, **kw: marks.append(kw))
    monkeypatch.setattr(br, "run", lambda *a, **k: {"kept": 3})
    store._work(5, "o", {}, "a@x.com")
    monkeypatch.setattr(br, "run", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("Apify said no")))
    store._work(5, "o", {}, "a@x.com")
    assert marks[0] == {"status": "ready", "stage": "done", "summary": {"kept": 3}}
    assert marks[1]["status"] == "failed" and marks[1]["error"] == "Apify said no"


# == sending =============================================================================================

class SendStore:
    def __init__(self, **kw):
        self.suppressed_keys = set(kw.get("suppressed", ()))
        self.contacted = kw.get("contacted", False)
        self.today = kw.get("today", 0)
        self.today_all = kw.get("today_all", 0)
        self.records = []

    def suppressed(self, *keys):
        return any(k in self.suppressed_keys for k in keys)

    def already_contacted(self, channel, person="", recipient=""):
        return self.contacted

    def sent_today(self, owner, channel):
        return self.today

    def sent_today_all(self, channel):
        return self.today_all

    def record_send(self, *a):
        self.records.append(a)


def lead(**kw):
    p = src.normalize([raw_post(3)])[0]
    out = {"id": 4, "offer": "callvibe", "post": p, "person": "in/person-3", "email": "buyer@acme.com", "score": 90,
           "draft": {"subject": "Your post", "email": "Hi Person,\n\nWe can help.", "note": "Saw your post", "message": "Hi"},
           "verdict": {"need": "x"}}
    out.update(kw)
    return out


SETTINGS = br.merged({"senders": {"callvibe": {"name": "Kris L", "title": "Founder", "email": "kris@callvibe.ai"}},
                      "postal_address": "CallVibe, 1 Main St, Pune, India"})


@pytest.mark.parametrize("kw, store_kw, channel, auto, why, stop", [
    ({}, {}, "email", False, None, None),
    ({"draft": None}, {}, "email", False, "no message written", False),
    ({"email": None}, {}, "email", False, "no email address", False),
    ({"person": "company/acme"}, {}, "linkedin", False, "company page", False),
    ({}, {"suppressed": {"buyer@acme.com"}}, "email", False, "asked not to be contacted", False),
    ({}, {"suppressed": {"in/person-3"}}, "linkedin", False, "asked not to be contacted", False),
    ({}, {"contacted": True}, "linkedin", False, "already been contacted on LinkedIn", False),
    ({}, {"today": 20}, "email", True, "automatic limit of 20", True),
    ({}, {"today": 20}, "email", False, None, None),
    ({}, {"today_all": 60}, "linkedin", False, "safe limit", True),
])
def test_who_may_be_written_to(kw, store_kw, channel, auto, why, stop):
    got = send.can_send("o", lead(**kw), channel, SETTINGS, auto=auto, store=SendStore(**store_kw))
    if why is None:
        assert got is None
    else:
        assert why in got[0] and got[1] is stop


def test_sending_can_be_switched_off_for_everyone(monkeypatch):
    monkeypatch.setenv("BUYER_RADAR_SEND", "off")
    assert send.can_send("o", lead(), "email", SETTINGS, auto=False, store=SendStore())[1] is True


def test_every_email_has_an_opt_out_link_and_the_postal_address(monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://northaxis.example")
    subject, text, page, headers = send.email_parts(lead(), SETTINGS, "buyer@acme.com")
    url = headers["List-Unsubscribe"].strip("<>")
    assert url.startswith("https://northaxis.example/buyer-radar/opt-out/") and url in text and url in page
    assert headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click" and headers["Reply-To"] == "kris@callvibe.ai"
    assert "CallVibe, 1 Main St" in text and "Kris L\nFounder\nCallVibe\nhttps://callvibe.ai" in text
    assert send.optout_address(url.rsplit("/", 1)[1]) == "buyer@acme.com"
    assert send.optout_address(url.rsplit("/", 1)[1] + "x") is None and send.optout_address("junk") is None
    evil = send.email_parts(lead(draft={"subject": "s", "email": EVIL}), SETTINGS, "a@b.co")[2]
    assert "<img" not in evil


def test_an_email_is_sent_as_the_offers_sender_and_recorded(monkeypatch):
    st = SendStore()
    seen = {}

    def deliver(subject, text, page, to, sender=None, headers=None, from_name=None):
        seen.update(to=to, sender=sender, name=from_name, subject=subject)
    got = send.email_lead("o", lead(), SETTINGS, by="mia@x.com", deliver=deliver, store=st)
    assert got["ok"] and seen == {"to": ["buyer@acme.com"], "sender": "kris@callvibe.ai", "name": "Kris L", "subject": "Your post"}
    assert st.records == [("o", 4, "email", "buyer@acme.com", "in/person-3", "sent", "", "mia@x.com")]

    def refuse(*a, **k):
        raise RuntimeError("unauthorized_client")
    got = send.email_lead("o", lead(), SETTINGS, deliver=refuse, store=st)
    assert not got["ok"] and "unauthorized_client" in got["detail"] and st.records[-1][5] == "failed"


class FakeUnipile:
    def __init__(self, distance="SECOND_DEGREE", err=None):
        self.distance, self.err, self.calls = distance, err, []

    def linkedin_account_id(self):
        return "acc1", None

    def describe_error(self, err):
        return "Unipile is rate-limiting us." if err.get("status") == 429 else "error"

    def get_user_profile(self, ident, account):
        self.calls.append(("profile", ident))
        return ({"provider_id": "P1", "network_distance": self.distance}, None) if not self.err else (None, self.err)

    def start_chat(self, account, pid, text):
        self.calls.append(("chat", pid, text))
        return {"chat_id": "c"}, None

    def send_invitation(self, account, pid, note):
        self.calls.append(("invite", pid, note))
        return {}, None


def test_linkedin_messages_a_connection_and_invites_anyone_else():
    u, st = FakeUnipile("FIRST_DEGREE"), SendStore()
    got = send.linkedin_lead("o", lead(), SETTINGS, client=u, store=st)
    assert got["kind"] == "message" and u.calls == [("profile", "person-3"), ("chat", "P1", "Hi")]
    u = FakeUnipile()
    got = send.linkedin_lead("o", lead(), SETTINGS, client=u, store=st)
    assert got["kind"] == "invitation" and u.calls[-1] == ("invite", "P1", "Saw your post")
    assert st.records[-1][2:6] == ("linkedin", "in/person-3", "in/person-3", "sent")
    got = send.linkedin_lead("o", lead(), SETTINGS, client=FakeUnipile(err={"kind": "http_status", "status": 429}), store=st)
    assert not got["ok"] and got["stop"] is True and st.records[-1][5] == "failed"


def test_emails_are_found_by_linkedin_profile_and_credits_counted():
    class SH:
        def enrich_contacts(self, linkedin_urls):
            self.urls = linkedin_urls
            return "req"

        def wait(self, rid, timeout):
            return {"credits": 1, "records": [{"linkedin_url": "https://www.linkedin.com/in/person-3", "work_email": "p3@acme.com",
                                               "email_status": "valid"},
                                              {"linkedin_url": "https://www.linkedin.com/in/someone-else", "work_email": "x@y.com"}]}
    c = SH()
    os.environ["SALESHANDY_API_KEY"] = "k"
    try:
        found, credits, note = send.find_emails([lead(), lead(id=5, person="in/person-9")], client=c)
    finally:
        del os.environ["SALESHANDY_API_KEY"]
    assert found == {4: "p3@acme.com"} and credits == 1 and note is None
    assert c.urls == ["https://www.linkedin.com/in/person-3", "https://www.linkedin.com/in/person-9"]


def test_the_slack_message_names_each_strong_lead_and_links_the_page():
    leads = [dict(lead(), score=90 + i, verdict={"need": EVIL, "intent_label": "Looking for a vendor"}) for i in range(12)]
    msg = send.slack_message("Lumina", leads, "https://x.example/strategic-agents/buyer-radar")
    assert msg["text"] == "Buyer Radar: 12 new leads"
    text = json.dumps(msg)
    assert "<img" not in text and "and 2 more" in text and "Open Buyer Radar" in text
    posted = []
    ok, why = send.slack_leads("#c", "o", leads[:1], post=lambda t, c, m: posted.append(c) or (True, None, "1"))
    assert (ok, why) == (False, "not_configured") and not posted
    os.environ["BUYER_RADAR_SLACK_BOT_TOKEN"] = "xoxb"
    try:
        assert send.slack_leads("#c", "o", leads[:1], post=lambda t, c, m: posted.append(c) or (True, None, "1")) == (True, "")
    finally:
        del os.environ["BUYER_RADAR_SLACK_BOT_TOKEN"]
    assert posted == ["#c"]


def test_the_unipile_sends_use_the_documented_routes(monkeypatch):
    from tracker import unipile_client as u
    seen = []

    class R:
        status_code, text = 201, '{"ok": 1}'

        def json(self):
            return {"ok": 1}
    monkeypatch.setenv("UNIPILE_API_KEY", "k")
    monkeypatch.setenv("UNIPILE_DSN", "api1.unipile.com:13000")
    monkeypatch.setattr(u.requests, "request", lambda method, url, **kw: seen.append((method, url, kw)) or R())
    u.send_invitation("acc", "P1", "note")
    u.start_chat("acc", "P1", "hello")
    assert seen[0][:2] == ("POST", "https://api1.unipile.com:13000/api/v1/users/invite")
    assert seen[0][2]["json"] == {"account_id": "acc", "provider_id": "P1", "message": "note"}
    assert seen[1][:2] == ("POST", "https://api1.unipile.com:13000/api/v1/chats")
    assert seen[1][2]["files"] == {"account_id": (None, "acc"), "attendees_ids": (None, "P1"), "text": (None, "hello")}
    monkeypatch.setenv("UNIPILE_LINKEDIN_ACCOUNT_ID", "pinned")
    assert u.linkedin_account_id() == ("pinned", None)


# == the routes ==========================================================================================

def _client(email):
    import app as appmod
    c = appmod.app.test_client()
    if email:
        with c.session_transaction() as sess:
            sess["google_user"] = {"email": email, "name": "T"}
    return c


H = {"X-Requested-With": "fetch", "Origin": "http://localhost"}


@pytest.fixture
def mem(monkeypatch):
    """The store, in memory: settings, leads and runs for the routes."""
    db = {"settings": {}, "runs": [], "leads": {7: {"id": 7, "offer": "callvibe", "status": "new", "score": 88, "post": {"url": "u"},
                                                   "verdict": {}, "draft": {"subject": "s"}, "sends": [{"channel": "email", "status": "sent",
                                                                                                        "to": "a@b.co", "by": STAFF, "at": None, "detail": ""}],
                                                   "person": "in/x", "email": None, "email_source": None}}}
    monkeypatch.setattr(store, "get_settings", lambda owner: br.merged(db["settings"].get(owner)))
    monkeypatch.setattr(store, "save_settings", lambda owner, s, by=None: db["settings"].__setitem__(owner, s))
    monkeypatch.setattr(store, "counts", lambda owner: {"all": 1, "new": 1, "contacted": 0, "replied": 0, "week": 1})
    monkeypatch.setattr(store, "month_spend", lambda owner: {"usd": db.get("month", 0.5), "credits": 0})
    monkeypatch.setattr(store, "running_run", lambda owner: None)
    monkeypatch.setattr(store, "list_runs", lambda owner, limit=20: [])
    monkeypatch.setattr(store, "list_leads", lambda owner, **kw: db.setdefault("asked", []).append((owner, kw)) or list(db["leads"].values()))
    monkeypatch.setattr(store, "get_lead", lambda lead_id, owner: db["leads"].get(lead_id))
    monkeypatch.setattr(store, "update_lead", lambda lead_id, owner, **kw: db["leads"][lead_id].update(kw) or True
                        if lead_id in db["leads"] else False)

    def start_run(owner, settings, started_by=None, trigger="manual", spawn=None):
        db["runs"].append((owner, settings, started_by, trigger))
        return len(db["runs"])
    monkeypatch.setattr(store, "start_run", start_run)
    return db


def test_the_page_and_its_routes_are_the_teams(mem):
    for email in (None, "someone@gmail.example"):
        assert _client(email).get(BASE).status_code == 302
        assert _client(email).get(BASE + "/api/leads").status_code == 302
    html = _client(STAFF).get(BASE).get_data(as_text=True)
    assert "They ask." in html and 'id="brSettings"' in html and "js/buyer_radar.js" in html and "data-br-client" not in html


def test_status_says_what_is_connected_and_what_a_run_costs(mem, monkeypatch):
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    monkeypatch.delenv("UNIPILE_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    st = _client(STAFF).get(BASE + "/api/status").get_json()
    assert st["source"] == "unipile" and st["sources"] == {"unipile": "Unipile", "apify": "Apify"}
    assert st["ready"]["search"] is False, "the search ready is the chosen source's: Unipile here"
    monkeypatch.setenv("UNIPILE_API_KEY", "u")
    st = _client(STAFF).get(BASE + "/api/status").get_json()
    assert st["ready"]["search"] is True and st["ready"]["claude"] is False and st["client"] is False
    assert st["estimate"]["posts"] > 0 and st["month"]["usd"] == 0.5 and st["settings"]["offers"] == ["callvibe", "markify"]


def test_settings_are_saved_for_the_workspace_only_from_this_site(mem):
    c = _client(STAFF)
    assert c.post(BASE + "/api/settings", json={"daily": True}, headers={"Origin": "https://evil.example"}).status_code == 403
    r = c.post(BASE + "/api/settings", json={"daily": True, "per_query": 10}, headers=H)
    assert r.status_code == 200 and mem["settings"][STAFF]["daily"] is True and r.get_json()["estimate"]["posts"] > 0
    r = c.post(BASE + "/api/settings", json={"offers": []}, headers=H)
    assert r.status_code == 400 and "at least one" in r.get_json()["error"]
    r = c.post(BASE + "/api/settings", json={"source": "apify"}, headers=H)
    assert r.status_code == 200 and mem["settings"][STAFF]["source"] == "apify" and mem["settings"][STAFF]["daily"] is True
    assert c.post(BASE + "/api/settings", json={"source": "x"}, headers=H).status_code == 400


def test_a_search_needs_its_keys_and_a_yes(mem, monkeypatch):
    c = _client(STAFF)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    monkeypatch.delenv("UNIPILE_API_KEY", raising=False)
    assert "UNIPILE_API_KEY" in c.post(BASE + "/api/runs", json={"confirm_spend": True}, headers=H).get_json()["error"]
    mem["settings"][STAFF] = br.merged({"source": "apify"})
    monkeypatch.delenv("APIFY_API_TOKEN", raising=False)
    assert "APIFY_API_TOKEN" in c.post(BASE + "/api/runs", json={"confirm_spend": True}, headers=H).get_json()["error"]
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    r = c.post(BASE + "/api/runs", json={}, headers=H)
    assert r.status_code == 400 and "confirm" in r.get_json()["error"]
    r = c.post(BASE + "/api/runs", json={"confirm_spend": True}, headers=H)
    assert r.status_code == 202 and mem["runs"][0][0] == STAFF and mem["runs"][0][2] == STAFF
    monkeypatch.setattr(store, "running_run", lambda owner: {"id": 3})
    r = c.post(BASE + "/api/runs", json={"confirm_spend": True}, headers=H)
    assert r.status_code == 409 and r.get_json()["run_id"] == 3


def test_leads_are_filtered_and_a_lead_can_be_edited(mem):
    c = _client(STAFF)
    got = c.get(BASE + "/api/leads?status=new&offer=callvibe&min=70").get_json()
    assert got["leads"][0]["draft"] == {"subject": "s"}
    assert mem["asked"][-1] == (STAFF, {"status": "new", "offer": "callvibe", "min_score": 70})
    assert c.get(BASE + "/api/leads?status=bogus").status_code == 400
    r = c.post(BASE + "/api/leads/7", json={"email": "Buyer@Acme.com", "draft": {"subject": "x" * 500, "note": "n" * 400}}, headers=H)
    assert r.status_code == 200 and mem["leads"][7]["email"] == "Buyer@Acme.com" and mem["leads"][7]["email_source"] == "typed"
    assert len(mem["leads"][7]["draft"]["subject"]) == 120 and len(mem["leads"][7]["draft"]["note"]) == 300
    assert c.post(BASE + "/api/leads/7", json={"email": "nope"}, headers=H).status_code == 400
    assert c.post(BASE + "/api/leads/7", json={"status": "dismissed"}, headers=H).status_code == 200
    assert c.post(BASE + "/api/leads/99", json={"status": "new"}, headers=H).status_code == 404


def test_sending_from_the_page_needs_a_yes_and_says_why_it_did_not(mem, monkeypatch):
    c = _client(STAFF)
    assert c.post(BASE + "/api/leads/7/send", json={"channel": "sms", "confirm": True}, headers=H).status_code == 400
    assert c.post(BASE + "/api/leads/7/send", json={"channel": "email"}, headers=H).status_code == 400
    got = []
    monkeypatch.setattr(send, "email_lead", lambda owner, lead, settings, by, auto: got.append((owner, lead["id"], by, auto)) or
                        {"ok": False, "detail": "no email address is known for this person"})
    r = c.post(BASE + "/api/leads/7/send", json={"channel": "email", "confirm": True}, headers=H)
    assert r.status_code == 400 and "no email address" in r.get_json()["error"] and got == [(STAFF, 7, STAFF, False)]
    monkeypatch.setattr(send, "linkedin_lead", lambda *a, **k: {"ok": True, "detail": "sent a connection request"})
    r = c.post(BASE + "/api/leads/7/send", json={"channel": "linkedin", "confirm": True}, headers=H)
    assert r.get_json() == {"ok": True, "detail": "sent a connection request"}


def test_the_daily_search_needs_the_token_and_keeps_to_each_cap(mem, monkeypatch):
    c = _client(None)
    monkeypatch.delenv("BUYER_RADAR_CRON_TOKEN", raising=False)
    assert c.post("/api/buyer-radar/daily").status_code == 503
    monkeypatch.setenv("BUYER_RADAR_CRON_TOKEN", "s3cret")
    assert c.post("/api/buyer-radar/daily", headers={"Authorization": "Bearer nope"}).status_code == 403
    monkeypatch.setenv("UNIPILE_API_KEY", "u")
    monkeypatch.delenv("APIFY_API_TOKEN", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    mem["settings"].update({"acct:1": {"daily": True}, "acct:2": {"daily": True}, "acct:3": {"daily": True, "monthly_cap_usd": 1},
                            "acct:4": {"daily": True, "source": "apify"}})
    monkeypatch.setattr(store, "daily_owners", lambda: ["acct:1", "acct:2", "acct:3", "acct:4"])
    monkeypatch.setattr(store, "ran_today", lambda owner: owner == "acct:2")
    monkeypatch.setattr(store, "month_spend", lambda owner: {"usd": 5.0 if owner == "acct:3" else 0, "credits": 0})
    r = c.post("/api/buyer-radar/daily", headers={"Authorization": "Bearer s3cret"})
    assert r.get_json() == {"ok": True, "started": 1, "skipped": {"ran_today": 1, "monthly_cap": 1, "running": 0,
                                                                   "no_search_key": 1}}, "acct:4 searches with Apify, unset"
    assert [x[0] for x in mem["runs"]] == ["acct:1"] and mem["runs"][0][3] == "daily"


def test_the_opt_out_page_asks_then_opts_the_address_out_for_good(monkeypatch):
    gone = []
    monkeypatch.setattr(store, "suppress", lambda key, reason="": gone.append(key))
    c = _client(None)
    token = send.optout_token("Buyer@Acme.com")
    page = c.get("/buyer-radar/opt-out/" + token)
    assert page.status_code == 200 and "Opt me out" in page.get_data(as_text=True) and not gone, "a link scanner opts nobody out"
    done = c.post("/buyer-radar/opt-out/" + token)
    assert done.status_code == 200 and "You are opted out" in done.get_data(as_text=True) and gone == ["buyer@acme.com"]
    assert c.get("/buyer-radar/opt-out/forged").status_code == 404


# == inside a workspace, and for its client ==============================================================

from tests import test_account_isolation as T  # noqa: E402

seeded = T.seeded
world = T.world
XA = {"X-Account": "lumina", "X-Requested-With": "fetch", "Origin": "http://localhost"}


def test_inside_a_workspace_the_work_is_the_workspaces(seeded, mem, monkeypatch):
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    monkeypatch.setenv("UNIPILE_API_KEY", "u")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    space = T._acct("lumina")["space"]
    assert T._client(T.RAJ).post(BASE + "/api/runs", json={"confirm_spend": True}, headers=XA).status_code == 202
    assert T._client(T.RAJ).post(BASE + "/api/settings", json={"daily": True}, headers=XA).status_code == 200
    assert mem["runs"][0][0] == space and mem["runs"][0][2] == T.RAJ and mem["settings"][space]["daily"] is True
    html = T._client(T.RAJ).get("/lumina/agents/buyer-radar").get_data(as_text=True)
    assert 'data-acct="lumina"' in html and "They ask." in html


def test_a_client_searches_and_reads_but_never_sends_or_sees_costs(seeded, mem, monkeypatch):
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    monkeypatch.setenv("UNIPILE_API_KEY", "u")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    T._invite("lumina", **{"tool:buyer-radar": True})
    space = T._acct("lumina")["space"]
    mem["settings"][space] = br.merged({"auto_email": True, "auto_linkedin": True, "find_emails": True, "slack_channel": "#x"})
    c = T._client(T.CLIENT)
    page = c.get("/lumina/agents/buyer-radar").get_data(as_text=True)
    assert "data-br-client" in page and 'id="brSettings"' not in page
    st = c.get(BASE + "/api/status", headers=XA).get_json()
    assert st["client"] is True and "estimate" not in st and "month" not in st and "senders" not in st["settings"]
    r = c.post(BASE + "/api/runs", json={"confirm_spend": True}, headers=XA)
    assert r.status_code == 202
    owner, settings, by, trigger = mem["runs"][-1]
    assert owner == space and by == T.CLIENT
    assert not (settings["auto_email"] or settings["auto_linkedin"] or settings["find_emails"] or settings["slack_channel"])
    leads = c.get(BASE + "/api/leads", headers=XA).get_json()["leads"]
    assert "draft" not in leads[0] and leads[0]["sends"] == [{"channel": "email", "status": "sent", "at": None}]
    assert c.post(BASE + "/api/leads/7", json={"status": "replied"}, headers=XA).status_code == 200
    assert c.post(BASE + "/api/leads/7", json={"email": "x@y.co"}, headers=XA).status_code == 403
    for path in ("/api/settings", "/api/leads/7/send"):
        assert c.post(BASE + path, json={"channel": "email", "confirm": True}, headers=XA).status_code in (302, 403), path


def test_its_runs_show_in_the_workspaces_history(seeded, monkeypatch):
    from datetime import datetime, timezone
    from tracker import account_history
    acct = T._acct("lumina")
    at = datetime(2026, 10, 17, 6, tzinfo=timezone.utc)
    seen = []
    monkeypatch.setattr(store, "space_runs", lambda owner, limit=60: seen.append(owner) or [
        {"id": 9, "status": "ready", "trigger": "daily", "started_by": "", "created_at": at,
         "summary": {"kept": 4, "strong": 2, "emailed": 1, "messaged": 1}},
        {"id": 8, "status": "running", "trigger": "manual", "started_by": T.RAJ, "created_at": at, "summary": None}])
    rows = [r for r in account_history.entries(acct) if r.get("agent") == "buyer-radar"]
    assert seen == [acct["space"]]
    assert rows[0]["title"] == "Daily LinkedIn search for buyers" and rows[0]["detail"] == "4 leads · 2 strong · 2 written to"
    assert rows[0]["href"] == "/lumina/agents/buyer-radar#run-9" and rows[0]["state"] == "ready"
    assert rows[1]["title"] == "Searched LinkedIn for buyers" and rows[1]["who"] == T.RAJ and rows[1]["state"] == "running"


# == the page script =====================================================================================

JS = os.path.join(ROOT, "static", "js", "buyer_radar.js")


def run_js(expr):
    if shutil.which("node") is None:
        pytest.skip("node is not installed")
    prog = ("globalThis.window = globalThis; require(%s); const BR = globalThis.BR;\n"
            "BR.offers = {callvibe: {label: 'CallVibe'}, markify: {label: 'Markify Digital'}};\n"
            "process.stdout.write(JSON.stringify((() => { %s })()));") % (json.dumps(JS), expr)
    proc = subprocess.run([shutil.which("node"), "-e", prog], capture_output=True, text=True, timeout=30)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def _lead_js():
    return json.dumps({"id": 3, "offer": "callvibe", "score": 91, "status": "new", "person": "in/x", "email": EVIL,
                       "post": {"url": "javascript:alert(1)", "text": EVIL * 3, "posted_at": None,
                                "author": {"name": EVIL, "headline": EVIL, "url": "javascript:alert(1)"}},
                       "verdict": {"need": EVIL, "intent": "seeking_vendor", "reason": EVIL, "region": EVIL, "deadline": EVIL},
                       "draft": {"subject": EVIL, "email": EVIL, "note": EVIL, "message": EVIL},
                       "sends": [{"channel": "email", "status": "sent", "to": EVIL, "by": "", "at": None}]})


def test_the_page_escapes_everything_from_linkedin_and_the_model():
    out = run_js("const l = %s; return [BR.renderLead(l), BR.renderDrawer(l, {email: true, linkedin: true}), "
                 "BR.renderRuns([{id: 1, status: 'failed', error: '%s', summary: {}}])];" % (_lead_js(), "<b>x</b>"))
    for html in out:
        assert "<img" not in html and "<b>x</b>" not in html
        assert "javascript:" not in html
    assert "br-lead--hot" in out[0] and "Looking for a vendor" in out[0] and "CallVibe" in out[0]
    assert "Already sent" in out[1] and 'data-channel="email" disabled' in out[1], "nobody is emailed twice from the page"


def test_the_toggle_at_the_top_says_who_searches_and_what_it_costs():
    out = run_js("return [BR.renderSource('unipile', {unipile: 'Unipile', apify: 'Apify'}), BR.renderSource('apify'), "
                 "BR.renderEstimate(%s, {posted: '3months'}), BR.renderEstimate(%s, {posted: '3months'}), "
                 "BR.renderRuns([{id: 1, status: 'ready', summary: {posts: 9, read: 9, kept: 2, source: 'unipile'}}])];"
                 % (json.dumps(br.estimate(br.merged({}))), json.dumps(br.estimate(br.merged({"source": "apify"})))))
    uni, apify, est_uni, est_apify, runs = out
    assert 'role="radiogroup"' in uni and 'data-source="unipile"' in uni and 'aria-checked="true" data-source="unipile"' in uni
    assert 'aria-checked="false" data-source="apify"' in uni and "Free per post" in uni and "900 results a day" in uni
    assert 'aria-checked="true" data-source="apify"' in apify and "$0.002 a post" in apify
    assert "last month (Unipile looks back no further)" in est_uni and "free through Unipile" in est_uni
    assert "last 3 months" in est_apify and "free through Unipile" not in est_apify
    assert "via Unipile" in runs


def test_a_search_that_kept_nothing_shows_the_best_post_it_read():
    closest = [{"url": "javascript:alert(1)", "score": 45, "role": "seller", "reason": EVIL}]
    out = run_js("return [BR.renderRuns([{id: 1, status: 'ready', summary: {posts: 152, read: 150, kept: 0, closest: %s}}]), "
                 "BR.renderRuns([{id: 2, status: 'ready', summary: {posts: 9, read: 9, kept: 1, closest: %s}}])];"
                 % (json.dumps(closest), json.dumps(closest)))
    assert "152 posts found" in out[0] and "150 read by Claude" in out[0]
    assert "Best post not kept: scored 45, a seller" in out[0] and "<img" not in out[0] and "javascript:" not in out[0]
    assert "Best post not kept" not in out[1] and "read by Claude" not in out[1]


def test_the_page_offers_the_filters_and_queries_the_right_leads():
    assert run_js("return BR.leadQuery('strong', 85);") == "?min=85", "Strong follows the workspace's strong-lead score"
    out = run_js("return [BR.renderFilters('strong', BR.offers), BR.leadQuery('strong'), BR.leadQuery('offer:markify'), "
                 "BR.leadQuery('new'), BR.leadQuery('all'), BR.renderLeads([], 'new'), BR.renderLeads([], 'all')];")
    assert 'data-filter="strong" aria-pressed="true"' in out[0] and "Markify Digital" in out[0]
    assert out[1:5] == ["?min=70", "?offer=markify", "?status=new", ""]
    assert "Nothing here with this filter" in out[5] and "No leads yet" in out[6]


def test_the_settings_form_holds_every_setting_and_the_estimate_reads_plainly():
    s = br.merged({"queries": {"callvibe": ['"call QA"']}, "senders": {"markify": {"name": EVIL}}})
    out = run_js("const s = %s; return [BR.renderSettings(s, {callvibe: {label: 'CallVibe', site: 'x', queries: ['a']}, "
                 "markify: {label: 'Markify', site: 'y', queries: ['b']}}, {}), BR.renderEstimate(%s, s)];"
                 % (json.dumps(s), json.dumps(br.estimate(s))))
    form, est = out
    for id_ in ("brQ-callvibe", "brSn-markify", "brPosted", "brPer", "brKeep", "brDaily", "brCap", "brMonth", "brAlert",
                "brSlack", "brAutoEmail", "brAutoLi", "brFind", "brSend", "brEcap", "brLcap", "brAddr"):
        assert 'id="%s"' % id_ in form, id_
    assert "&quot;call QA&quot;" in form and "<img" not in form
    assert "searches</b>" in est and "the run's cap" in est
