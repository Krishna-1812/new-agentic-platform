"""Lead Finder's other places to find buyers (2026-10-21): companies whose LinkedIn job ads are the work
(tracker/buyer_radar_jobs.py), with who decides there found by Saleshandy's free search, and people in the
comments of a buyer's post who need the same (tracker/buyer_radar_comments.py).

What is held here:
  * job ads: one shape whatever Unipile returns, one lead per company a month, the day's search limit
    and LinkedIn's first refusal, locations LinkedIn knows, the request sent;
  * decision makers: the offer's departments first and the most senior, never someone at another company
    of a similar name, and the run says when Saleshandy is not set up;
  * comments: the post's own author and one-word comments left out, a refusal stops the rest;
  * Claude reads companies and comments with their own instructions, and writes from the signal;
  * the run: every source kept as its own kind of lead, the room shared, emails found by Saleshandy's id;
  * the routes and the page: a filter for each source, finding one email after a yes, hostile strings.
"""
import json
import os
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests.test_buyer_radar import (jobs_on,  # noqa: F401  (fixture)
                                     BASE, EVIL, H, STAFF, XA, FakeStore, SendStore, T, _client, deps, lead,  # noqa: E402
                                    mem, run_js, seeded, verdict, world)  # noqa: F401  (fixtures)
from tracker import buyer_radar as br  # noqa: E402
from tracker import buyer_radar_comments as com  # noqa: E402
from tracker import buyer_radar_jobs as jobs  # noqa: E402
from tracker import buyer_radar_judge as judge  # noqa: E402
from tracker import buyer_radar_send as send  # noqa: E402
from tracker import buyer_radar_store as store  # noqa: E402
from tracker import contact_lab_search as cls  # noqa: E402
from tracker import unipile_client  # noqa: E402


# == job ads ==============================================================================================

def job(n, company="Acme Health", handle="acme-health", title="Performance Marketing Manager", **over):
    """A job as Unipile's search returns it (a SearchResult of type JOB, linkedincontroller_search)."""
    j = {"object": "SearchResult", "type": "JOB", "id": str(4100000000 + n), "reference_id": "r%d" % n, "title": title,
         "location": "Mumbai, Maharashtra, India", "posted_at": "2026-10-%02d" % (10 + n % 10), "reposted": False,
         "url": "https://www.linkedin.com/jobs/view/%d/" % (4100000000 + n),
         "company": {"id": "77%d" % len(handle), "public_identifier": handle, "name": company,
                     "profile_url": "https://www.linkedin.com/company/%s/" % handle, "profile_picture_url": ""}}
    j.update(over)
    return j


class JobClient:
    def __init__(self, pages=2, per_page=2, fail_on=None, places=None):
        self.calls, self.pages, self.per_page, self.fail_on, self.places = [], pages, per_page, fail_on, places or {}

    def linkedin_account_id(self):
        return "acc1", None

    def describe_error(self, err):
        return err["detail"]

    def search_parameters(self, account_id, kind, keywords, limit=5):
        self.calls.append(("params", kind, keywords))
        hit = self.places.get(keywords)
        return ({"items": [{"id": hit, "title": keywords}]} if hit else {"items": []}), None

    def search_jobs(self, account_id, keywords, date_posted_days=None, location_ids=None, cursor=None, limit=25):
        self.calls.append((keywords, date_posted_days, location_ids, cursor, limit))
        if self.fail_on is not None and len(self.calls) == self.fail_on:
            return None, {"detail": "HTTP 429"}
        page = int(cursor or 0)
        items = [job(100 * len(self.calls) + i, company="Co %s" % keywords, handle="co-%s" % keywords) for i in range(min(self.per_page, limit))]
        return {"object": "LinkedinSearch", "items": items, "cursor": str(page + 1) if page + 1 < self.pages else None}, None


def test_a_job_ad_reads_as_one_shape_and_a_company_is_one_key():
    j = jobs.normalize(job(1), "SEO specialist")
    assert j == {"id": "4100000001", "title": "Performance Marketing Manager", "location": "Mumbai, Maharashtra, India",
                 "posted_at": "2026-10-11", "url": "https://www.linkedin.com/jobs/view/4100000001/", "query": "SEO specialist",
                 "company": {"name": "Acme Health", "url": "https://www.linkedin.com/company/acme-health/", "id": "7711",
                             "key": "company/acme-health"}}
    nameless = job(1)
    nameless["company"] = {}
    assert jobs.normalize(job(1, title=""), "q") is None and jobs.normalize(nameless, "q") is None
    raw = job(1, url=None)
    raw["company"] = {"name": "Bare Co", "id": "55"}
    bare = jobs.normalize(raw, "q")
    assert bare["company"]["key"] == "company-id/55" and bare["url"] == "https://www.linkedin.com/jobs/view/4100000001/"


def test_a_company_hiring_for_several_roles_is_one_lead_a_month():
    ads = [jobs.normalize(job(i, title=t), "q") for i, t in enumerate(["SEO Executive", "PPC Specialist", "SEO Executive"])]
    ads.append(jobs.normalize(job(9, company="Other Co", handle="other"), "q"))
    ads.append(dict(ads[0]))      # the same ad found by a second search
    got = jobs.by_company(ads, "2026-10")
    assert [g["key"] for g in got] == ["jobs:company/acme-health:2026-10", "jobs:company/other:2026-10"]
    acme = got[0]
    assert len(acme["jobs"]) == 3 and acme["kind"] == "jobs" and acme["author"]["company"] is True
    assert acme["text"].startswith("Acme Health is hiring on LinkedIn: ") and "PPC Specialist (Mumbai" in acme["text"]
    assert acme["author"]["headline"] == "Hiring 3 roles" and acme["url"] == "https://www.linkedin.com/company/acme-health/"
    assert jobs.by_company(ads, "2026-11")[0]["key"].endswith("2026-11"), "hiring again next month is a fresh lead"


def test_job_titles_are_read_page_by_page_within_the_days_room():
    c = JobClient(pages=5, per_page=2)
    got = jobs.collect(["seo", "ppc"], days=7, per_query=5, room=7, location_ids=["102713980"], client=c, sleep=lambda s: None)
    asked = [x for x in c.calls if x[0] in ("seo", "ppc")]
    assert [(x[0], x[4]) for x in asked] == [("seo", 5), ("seo", 3), ("seo", 1), ("ppc", 2)]
    assert asked[0][1] == 7 and asked[0][2] == ["102713980"]
    assert got["results"] == 7 and len(got["jobs"]) == 7 and got["error"] is None
    c = JobClient(pages=3, fail_on=2)
    got = jobs.collect(["seo", "ppc"], per_query=10, room=100, client=c, sleep=lambda s: None)
    assert got["error"] == "Unipile: HTTP 429" and len(got["jobs"]) == 2 and len(c.calls) == 2


def test_a_place_linkedin_does_not_know_is_said_not_searched_worldwide():
    c = JobClient(places={"India": "102713980"})
    ids, notes = jobs.locations(["India", "Atlantis"], account_id="acc1", client=c)
    assert ids == ["102713980"] and len(notes) == 1 and "Atlantis" in notes[0]
    assert ("params", "LOCATION", "India") in c.calls


def test_the_run_can_look_up_places_through_the_connected_account(monkeypatch):
    monkeypatch.setattr(unipile_client, "linkedin_account_id", lambda: ("acc9", None))
    monkeypatch.setattr(unipile_client, "search_parameters", lambda account_id, kind, keywords, limit=5:
                        ({"items": [{"id": "1%s" % account_id, "title": keywords}]}, None))
    assert jobs.locations(["India"]) == (["1acc9"], []), "called as the run calls it, with nothing but the places"
    monkeypatch.setattr(unipile_client, "linkedin_account_id", lambda: (None, {"kind": "not_configured"}))
    ids, notes = jobs.locations(["India"])
    assert ids == [] and "could not be looked up" in notes[0]


def test_the_job_search_and_its_places_use_the_documented_routes(monkeypatch):
    sent = []
    monkeypatch.setattr(unipile_client, "_request", lambda method, path, json_body=None, params=None: sent.append(
        (method, path, json_body, params)) or ({}, None))
    unipile_client.search_jobs("acc1", "SEO specialist", date_posted_days=14, location_ids=[102713980], cursor="c", limit=80)
    unipile_client.search_jobs("acc1", "x")
    unipile_client.search_parameters("acc1", "LOCATION", "India")
    assert sent[0] == ("POST", "/api/v1/linkedin/search",
                       {"api": "classic", "category": "jobs", "keywords": "SEO specialist", "sort_by": "date", "date_posted": 14,
                        "location": ["102713980"]}, {"account_id": "acc1", "limit": 50, "cursor": "c"})
    assert sent[1][2] == {"api": "classic", "category": "jobs", "keywords": "x", "sort_by": "date"}
    assert sent[2] == ("GET", "/api/v1/linkedin/search/parameters", None,
                       {"account_id": "acc1", "type": "LOCATION", "keywords": "India", "limit": 5})


# == who decides at a company hiring ======================================================================

class SH:
    """saleshandy_client.Client's free people search."""

    def __init__(self, people):
        self.people, self.asked = people, []

    def search_people(self, filters):
        self.asked.append(filters)
        dept = (filters.get("department") or {}).get("includes")
        return {"people": [p for p in self.people if not dept or p.get("department") in dept]}


def person(i, title, company="Acme Health", department=None):
    return {"id": "sh%d" % i, "name": "P%d Last" % i, "title": title, "company": company, "department": department,
            "location": "Mumbai", "domain": None}


@pytest.mark.parametrize("a, b, same", [("Acme Health Pvt. Ltd.", "acme health", True), ("ACME", "Acme Inc", True),
                                        ("Acme Health", "Acme Healthcare Partners", False), ("Ace", "Ace Hardware", False),
                                        ("Infosys", "Infosys BPM", True), ("", "x", False)])
def test_a_person_is_kept_only_at_the_company_that_posted_the_job(a, b, same):
    assert jobs.same_company(a, b) is same


def test_the_decision_makers_are_the_offers_departments_first_and_the_most_senior():
    sh = SH([person(1, "Marketing Manager", department="Marketing"), person(2, "Chief Executive Officer", department="C-Suite"),
             person(3, "VP Marketing", department="Marketing"), person(4, "CMO", company="Acme Healthcare Partners", department="Marketing"),
             person(5, "Head of Finance", department="Finance & Accounting")])
    got = jobs.contacts_at({"name": "Acme Health"}, ["Marketing", "C-Suite"], client=sh)
    assert [c["id"] for c in got] == ["sh3", "sh2", "sh1"], "similar names at another company are left out"
    assert got[0] == {"id": "sh3", "name": "P3 Last", "title": "VP Marketing", "location": "Mumbai", "domain": "",
                      "key": "sh/sh3", "linkedin": ""}
    assert sh.asked[0]["company_name"] == {"includes": ["Acme Health"]} and sh.asked[0]["department"] == {"includes": ["Marketing", "C-Suite"]}
    assert "C-Level" in sh.asked[0]["management_level"]["includes"]


def test_each_company_lead_gets_its_people_and_the_run_hears_when_saleshandy_is_missing(monkeypatch):
    signal = jobs.by_company([jobs.normalize(job(1), "q")], "2026-10")[0]
    leads = [{"post": signal, "offer": "markify", "person": "company/acme-health"},
             {"post": {"kind": "post", "key": "p"}, "offer": "markify", "person": "in/x"}]
    sh = SH([person(1, "Head of Marketing", department="Marketing")])
    assert jobs.decision_makers(leads, br.OFFERS, client=sh) is None
    assert leads[0]["person"] == "sh/sh1" and leads[0]["post"]["contacts"][0]["name"] == "P1 Last"
    assert leads[1]["person"] == "in/x", "posts are left alone"
    assert all(f["company_name"] == {"includes": ["Acme Health"]} for f in sh.asked)
    nobody = [{"post": dict(signal, contacts=[]), "offer": "callvibe", "person": "company/acme-health"}]
    assert "knew nobody senior at 1" in jobs.decision_makers(nobody, br.OFFERS, client=SH([]))
    monkeypatch.delenv("SALESHANDY_API_KEY", raising=False)
    assert "needs SALESHANDY_API_KEY" in jobs.decision_makers(nobody, br.OFFERS)


def test_every_offer_says_who_decides_and_which_jobs_mean_it_needs_us():
    from tracker import account_mapper as am
    known = {d for _, d in am.DEPARTMENT_RULES}
    for o in br.OFFERS.values():
        assert o["decision_makers"] and set(o["decision_makers"]) <= known
        assert 5 <= len(o["jobs"]) <= br.MAX_JOB_QUERIES and all(len(t) <= 100 for t in o["jobs"])


# == comments ============================================================================================

def comment(n, text="We are looking for the same, please share what you find", **details):
    d = {"id": "ACoAAB%d" % n, "headline": "COO at Brightline", "profile_url": "https://www.linkedin.com/in/ACoAAB%d" % n,
         "network_distance": "THIRD_DEGREE"}
    d.update(details)
    return {"object": "Comment", "id": "70000%d" % n, "post_id": "7123", "text": text, "date": "2026-10-19T10:00:00Z",
            "author": "Commenter %d" % n, "author_details": d, "reaction_counter": 2, "reply_counter": 0}


def parent(comments=4, social_id="urn:li:activity:7123"):
    return {"post": {"key": "7123", "url": "https://www.linkedin.com/posts/x-7123", "social_id": social_id, "comments": comments,
                     "author": {"name": "Asker", "key": "in/asker"}, "query": "q"},
            "verdict": {"need": "A call analytics tool"}, "offer": "callvibe"}


class CommentClient:
    def __init__(self, by_post=None, errors=None):
        self.by_post, self.errors, self.calls = by_post or {}, errors or {}, []

    def linkedin_account_id(self):
        return "acc1", None

    def describe_error(self, err):
        return err["detail"]

    def list_comments(self, post_id, account_id, limit=100):
        self.calls.append(post_id)
        if post_id in self.errors:
            return None, self.errors[post_id]
        return {"object": "CommentList", "items": self.by_post.get(post_id, [])}, None


def test_a_comment_reads_as_a_lead_under_its_post():
    c = com.normalize(comment(1), parent())
    assert c["key"] == "comment:700001" and c["kind"] == "comment" and c["url"] == "https://www.linkedin.com/posts/x-7123"
    assert c["author"] == {"name": "Commenter 1", "headline": "COO at Brightline", "url": "https://www.linkedin.com/in/ACoAAB1",
                           "key": "in/acoaab1", "provider_id": "ACoAAB1", "company": False}
    assert c["parent"] == {"key": "7123", "url": "https://www.linkedin.com/posts/x-7123", "author": "Asker",
                           "need": "A call analytics tool", "offer": "callvibe"}
    own = comment(2, profile_url="https://www.linkedin.com/in/asker")
    assert com.normalize(own, parent()) is None, "the post's own author answering is not a new lead"
    assert com.normalize(comment(3, text="+1"), parent()) is None


def test_comments_are_read_only_under_posts_that_have_them_and_a_refusal_stops_the_rest():
    a, b, none, unknown = parent(), parent(social_id="urn:li:activity:8"), parent(comments=0, social_id="urn:li:activity:9"), parent(social_id="")
    c = CommentClient({"urn:li:activity:7123": [comment(1), comment(1), comment(2, text="DM me, we build exactly this")],
                       "urn:li:activity:8": [comment(4)]})
    got = com.collect([a, none, unknown, b], client=c, sleep=lambda s: None)
    assert c.calls == ["urn:li:activity:7123", "urn:li:activity:8"] and got["posts"] == 2
    assert [x["key"] for x in got["comments"]] == ["comment:700001", "comment:700002", "comment:700004"]
    c = CommentClient(errors={"urn:li:activity:7123": {"detail": "HTTP 422", "status": 422}})
    got = com.collect([a, b], client=c, sleep=lambda s: None)
    assert len(c.calls) == 2 and "could not be read" in got["notes"][0] and got["error"] is None
    c = CommentClient(errors={"urn:li:activity:7123": {"detail": "HTTP 429", "status": 429}})
    got = com.collect([a, b], client=c, sleep=lambda s: None)
    assert c.calls == ["urn:li:activity:7123"] and got["error"] == "Unipile: HTTP 429"


# == Claude reads and writes ==============================================================================

def test_companies_and_comments_are_read_with_their_own_instructions():
    signal = jobs.by_company([jobs.normalize(job(1, title=EVIL), "q")], "2026-10")[0]
    c = com.normalize(comment(1), parent())
    seen = []

    def call(budget, stage, model, system, user, schema, max_tokens):
        seen.append((system, user))
        return {"verdicts": [{"n": 1, "role": "buyer", "offer": "markify", "intent": "hiring_for_it", "score": 70, "need": "x",
                              "company": "", "region": "", "deadline": "", "reason": ""}]}
    got = judge.judge_posts([signal], br.OFFERS, budget=cls.Budget(1), call=call, system=judge.JOB_SYSTEM, text_of=judge.job_text)
    assert got[signal["key"]]["score"] == 70 and got[signal["key"]]["intent_label"] == "Hiring for it"
    assert seen[0][0] == judge.JOB_SYSTEM and "COMPANY 1: Acme Health\nOPEN JOBS ON LINKEDIN:\n- " in seen[0][1]
    judge.judge_posts([c], br.OFFERS, budget=cls.Budget(1), call=call, system=judge.COMMENT_SYSTEM, text_of=judge.comment_text)
    assert seen[1][0] == judge.COMMENT_SYSTEM
    assert "UNDER A POST BY Asker ASKING FOR: A call analytics tool" in seen[1][1] and "COMMENTER: Commenter 1, COO" in seen[1][1]
    for system in (judge.JOB_SYSTEM, judge.COMMENT_SYSTEM):
        assert "'seller'" in system and "0 to 10" in system, "vendors pitching are never leads"


def test_a_message_is_written_from_the_signal_and_to_the_person_who_decides():
    seen = []

    def call(budget, stage, model, system, user, schema, max_tokens):
        seen.append(user)
        return {"subject": "s", "email": "e", "note": "n", "message": "m"}
    signal = jobs.by_company([jobs.normalize(job(1), "q")], "2026-10")[0]
    signal["contacts"] = [{"name": "Meera Shah", "title": "VP Marketing", "key": "sh/1"}]
    judge.draft({"post": signal, "verdict": {"need": "Building a paid team"}}, br.OFFERS["markify"], {}, budget=cls.Budget(1), call=call)
    assert "WRITING TO: Meera Shah, VP Marketing at Acme Health" in seen[0] and "Performance Marketing Manager (Mumbai" in seen[0]
    assert seen[0].endswith("Their first name, to greet them by: Meera")
    judge.draft({"post": com.normalize(comment(1), parent()), "verdict": {"need": "the same"}}, br.OFFERS["callvibe"], {},
                budget=cls.Budget(1), call=call)
    assert "THEIR COMMENT (by Commenter 1, COO at Brightline), under a LinkedIn post by Asker asking for: A call analytics tool" in seen[1]
    assert "never as if they asked" in judge.DRAFT_SYSTEM


# == the run ==============================================================================================

@pytest.mark.usefixtures("jobs_on")
def test_a_run_keeps_posts_comments_and_hiring_companies_each_as_its_kind(monkeypatch):
    fake = FakeStore()
    fake.install(monkeypatch)
    out = {}
    d, posts = deps([92, 40], out)
    signal = jobs.by_company([jobs.normalize(job(1), "seo")], "2026-10")
    found = [com.normalize(comment(1), {"post": posts[0], "verdict": verdict(92), "offer": "callvibe"}),
             com.normalize(comment(2, text="We sell this, DM me"), {"post": posts[0], "verdict": verdict(92), "offer": "callvibe"})]
    reads = []

    def judge_any(items, offers, budget, model, system=judge.JUDGE_SYSTEM, text_of=None):
        from decimal import Decimal
        budget.add("read", model, Decimal("0.01"), {})
        reads.append((system, [x["key"] for x in items]))
        scores = {posts[0]["key"]: 92, posts[1]["key"]: 40, signal[0]["key"]: 75, found[0]["key"]: 80, found[1]["key"]: 5}
        return {x["key"]: verdict(scores[x["key"]], offer="markify" if x.get("kind") == "jobs" else "callvibe") for x in items}

    def people(leads, offers):
        for x in leads:
            if x["post"].get("kind") == "jobs":
                x["post"]["contacts"] = [{"id": "s1", "name": "Meera Shah", "key": "sh/s1"}]
                x["person"] = "sh/s1"
        return None
    d.update(judge=judge_any, people=people,
             jobs_search=lambda titles, days, per_query, room, location_ids: out.update(jobs=(len(titles), days, room, location_ids)) or
             {"jobs": [jobs.normalize(job(1), "seo")], "results": 1, "error": None, "notes": []},
             comments=lambda leads: {"comments": found, "error": None, "notes": [], "posts": 1})
    s = br.merged({"job_locations": ["India"], "jobs_days": 7})
    summary = br.run(1, "acct:7", s, started_by="mia@x.com", deps=d)
    assert [r[0] for r in reads] == [judge.JUDGE_SYSTEM, judge.JOB_SYSTEM, judge.COMMENT_SYSTEM]
    assert out["jobs"][1] == 7 and out["jobs"][3] == ["101"], "the place, as LinkedIn's id"
    kinds = sorted((x["source"], x["score"], x["person"]) for x in fake.leads.values())
    assert kinds == [("comment", 80, "in/acoaab1"), ("jobs", 75, "sh/s1"), ("post", 92, "in/person-1")]
    assert summary["by_source"] == {"post": 1, "jobs": 1, "comment": 1, "icp": 0, "rfp": 0} and summary["kept"] == 3
    assert summary["companies"] == 1 and summary["unipile_results"] == 3 and summary["comments"] == 2
    assert {"read", "read-jobs", "read-comments", "draft"} <= {s[1] for s in fake.spend}
    assert fake.seen >= {posts[1]["key"], found[1]["key"]}, "what was read and not kept is not read again"


@pytest.mark.usefixtures("jobs_on")
def test_a_hiring_companys_decision_maker_is_emailed_once_saleshandy_reveals_them(monkeypatch):
    fake = FakeStore()
    fake.install(monkeypatch)
    out = {}
    d, _ = deps([], out)
    sig = jobs.by_company([jobs.normalize(job(1), "seo")], "2026-10")

    def people(leads, offers):
        leads[0]["post"]["contacts"] = [{"id": "s1", "name": "Meera Shah", "key": "sh/s1"}]
        leads[0]["person"] = "sh/s1"

    def find(leads):
        out["find"] = [x["person"] for x in leads]
        return {leads[0]["id"]: {"email": "meera@acme.com", "linkedin": "https://www.linkedin.com/in/meera-shah"}}, 1, None
    d.update(judge=lambda items, offers, budget, model, **kw: {x["key"]: verdict(90, offer="markify") for x in items},
             jobs_search=lambda *a, **k: {"jobs": [jobs.normalize(job(1), "seo")], "results": 1, "error": None, "notes": []},
             people=people, find_emails=find)
    s = br.merged({"sources": ["jobs"], "auto_email": True, "auto_linkedin": True, "find_emails": True})
    br.run(1, "acct:7", s, deps=d)
    [kept] = fake.leads.values()
    assert out["find"] == ["sh/s1"] and kept["post"]["key"] == sig[0]["key"]
    assert kept["email"] == "meera@acme.com" and kept["person"] == "in/meera-shah", "the profile came with the email"
    assert out["emailed"] == [kept["id"]] and out["messaged"] == [kept["id"]]


def test_the_days_room_is_shared_fairly_between_the_searches():
    assert br.split_room(900, {"posts": 925, "jobs": 380}) == {"jobs": 380, "posts": 520}
    assert br.split_room(100, {"posts": 925, "jobs": 380}) == {"posts": 50, "jobs": 50}
    assert br.split_room(900, {"posts": 0, "jobs": 380}) == {"posts": 0, "jobs": 380}
    assert br.split_room(0, {"posts": 10}) == {"posts": 0}


@pytest.mark.usefixtures("jobs_on")
def test_the_new_settings_are_checked():
    s = br.clean_settings({"sources": ["jobs", "posts", "bogus"], "job_locations": "India, Dubai,, India",
                           "job_queries": {"markify": "SEO lead\n\n  PPC   manager ", "nobody": "x"}, "jobs_days": 7,
                           "comment_posts": 0})
    assert s["sources"] == ["posts", "jobs"] and s["job_locations"] == ["India", "Dubai"]
    assert s["job_queries"] == {"markify": ["SEO lead", "PPC manager"]} and s["jobs_days"] == 7 and s["comment_posts"] == 0
    assert br.clean_settings({"job_queries": {"markify": "\n".join(br.OFFERS["markify"]["jobs"])}})["job_queries"] == {}, \
        "the defaults are kept as the defaults, so a later change to them reaches every workspace"
    for bad in ({"sources": []}, {"sources": ["bogus"]}, {"sources": ["comments"]}, {"job_locations": "a,b,c,d,e,f"}, {"jobs_days": 31},
                {"job_queries": {"markify": ["x"] * 21}}, {"job_queries": {"callvibe": ["x" * 101]}}):
        with pytest.raises(ValueError):
            br.clean_settings(bad)
    assert br.merged({})["sources"] == ["posts", "comments", "jobs", "icp", "rfps", "reddit"]


@pytest.mark.usefixtures("jobs_on")
def test_a_run_with_only_job_ads_needs_only_unipile(monkeypatch):
    monkeypatch.delenv("APIFY_API_TOKEN", raising=False)
    monkeypatch.setenv("UNIPILE_API_KEY", "u")
    assert br.search_missing(br.merged({"source": "apify"})) is None, "the job ads can still run"
    assert br.search_missing(br.merged({"source": "apify", "sources": ["posts"]})) == "APIFY_API_TOKEN"
    monkeypatch.delenv("UNIPILE_API_KEY")
    assert br.search_missing(br.merged({"sources": ["jobs"]})) == "UNIPILE_API_KEY"


def test_the_unipile_day_limit_can_be_raised_for_sales_navigator_but_not_past_its_ceiling(monkeypatch):
    from tracker import buyer_radar_unipile as uni
    monkeypatch.delenv("BUYER_RADAR_UNIPILE_DAY_MAX", raising=False)
    assert uni.day_max() == 900
    for raw, want in (("2000", 2000), ("99999", uni.DAY_MAX_CEILING), ("5", 100), ("lots", 900)):
        monkeypatch.setenv("BUYER_RADAR_UNIPILE_DAY_MAX", raw)
        assert uni.day_max() == want


# == sending ==============================================================================================

def test_a_decision_maker_is_found_by_saleshandys_id_and_comes_back_with_their_profile(monkeypatch):
    class Reveal:
        def __init__(self):
            self.asked = []

        def enrich_contacts(self, **kw):
            self.asked.append(kw)
            return "req"

        def wait(self, rid, timeout):
            if "lead_ids" in self.asked[-1]:
                return {"credits": 1, "records": [{"lead_id": "s1", "work_email": "meera@acme.com", "email_status": "valid",
                                                   "linkedin_url": "https://www.linkedin.com/in/meera-shah"}]}
            return {"credits": 1, "records": [{"linkedin_url": "https://www.linkedin.com/in/person-3", "work_email": "p3@acme.com"}]}
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    c = Reveal()
    found, credits, note = send.find_emails([lead(), lead(id=6, person="sh/s1")], client=c)
    assert found == {4: "p3@acme.com", 6: {"email": "meera@acme.com", "linkedin": "https://www.linkedin.com/in/meera-shah"}}
    assert credits == 2 and note is None and c.asked[1] == {"lead_ids": ["s1"]}


def test_a_commenter_is_written_to_by_linkedins_own_id_whose_case_matters():
    from tests.test_buyer_radar import FakeUnipile
    c = com.normalize(comment(1), parent())
    u = FakeUnipile()
    got = send.linkedin_lead("o", lead(post=c, person=c["author"]["key"]), br.merged({}), client=u, store=SendStore())
    assert got["ok"] and u.calls[0] == ("profile", "ACoAAB1")


def test_the_slack_message_says_where_each_lead_came_from():
    signal = jobs.by_company([jobs.normalize(job(1), "q")], "2026-10")[0]
    signal["contacts"] = [{"name": "Meera Shah", "title": "VP Marketing"}]
    leads = [dict(lead(), post=signal, offer="markify", verdict={"need": "a team"}),
             dict(lead(), post=com.normalize(comment(1), parent()), verdict={"need": "the same"})]
    text = json.dumps(send.slack_messages("", leads, "u"))
    assert "Hiring" in text and "write to Meera Shah, VP Marketing" in text and "Open the company" in text
    assert "Comment" in text and "Open the post they commented on" in text


# == the routes ============================================================================================

def test_leads_filter_by_where_they_came_from(mem):
    c = _client(STAFF)
    assert c.get(BASE + "/api/leads?source=jobs").status_code == 200
    assert mem["asked"][-1][1]["source"] == "jobs"
    assert c.get(BASE + "/api/leads?source=tiktok").status_code == 400
    r = c.get(BASE + "/api/leads/export?source=comment")
    assert r.status_code == 200 and "-comment.csv" in r.headers["Content-Disposition"]


def test_finding_one_email_needs_a_yes_and_saleshandy_and_picks_the_person(mem, monkeypatch):
    signal = jobs.by_company([jobs.normalize(job(1), "q")], "2026-10")[0]
    signal["contacts"] = [{"id": "s1", "name": "A", "key": "sh/s1", "linkedin": ""}, {"id": "s2", "name": "B", "key": "sh/s2", "linkedin": ""}]
    mem["leads"][8] = {"id": 8, "offer": "markify", "status": "new", "score": 80, "post": signal, "verdict": {}, "draft": None,
                       "sends": [], "person": "sh/s1", "email": None, "email_source": None, "source": "jobs"}
    spent, asked = [], []
    monkeypatch.setattr(store, "add_spend", lambda *a, **k: spent.append((a, k)))
    c = _client(STAFF)
    url = BASE + "/api/leads/8/find-email"
    assert c.post(url, json={}, headers=H).status_code == 400
    monkeypatch.delenv("SALESHANDY_API_KEY", raising=False)
    assert "SALESHANDY_API_KEY" in c.post(url, json={"confirm": True}, headers=H).get_json()["error"]
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    assert c.post(url, json={"confirm": True, "contact": 5}, headers=H).status_code == 400
    monkeypatch.setattr(send, "find_emails", lambda leads: asked.append(leads[0]["person"]) or
                        ({8: {"email": "b@acme.com", "linkedin": "https://www.linkedin.com/in/bee"}}, 1.0, None))
    r = c.post(url, json={"confirm": True, "contact": 1}, headers=H)
    assert r.status_code == 200 and asked == ["sh/s2"], "the second person, as picked"
    got = mem["leads"][8]
    assert got["email"] == "b@acme.com" and got["person"] == "in/bee" and got["email_source"] == "saleshandy"
    assert got["post"]["contacts"][1]["linkedin"] == "https://www.linkedin.com/in/bee"
    assert spent and spent[0][0][3:5] == ("saleshandy", "email-reveal") and spent[0][1] == {"credits": 1.0}
    monkeypatch.setattr(send, "find_emails", lambda leads: ({}, 0, None))
    assert c.post(BASE + "/api/leads/7/find-email", json={"confirm": True}, headers=H).status_code == 404


def test_a_client_never_finds_emails(seeded, mem, monkeypatch):
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    T._invite("lumina", **{"tool:lead-finder": True})
    r = T._client(T.CLIENT).post(BASE + "/api/leads/7/find-email", json={"confirm": True}, headers=XA)
    assert r.status_code in (302, 403, 404) and mem["leads"][7]["email"] is None, "not a client's to spend"


# == the page ===============================================================================================

@pytest.mark.usefixtures("jobs_on")
def test_a_hiring_company_and_a_comment_show_where_they_came_from_and_escape_everything():
    signal = jobs.by_company([jobs.normalize(job(1, title=EVIL, company=EVIL), "q")], "2026-10")[0]
    signal["contacts"] = [{"name": EVIL, "title": EVIL, "key": "sh/1", "linkedin": "javascript:alert(1)"}]
    jl = {"id": 1, "offer": "markify", "score": 80, "status": "new", "person": "sh/1", "source": "jobs", "post": signal,
          "verdict": {"need": EVIL, "intent": "hiring_for_it", "reason": EVIL}, "draft": {"subject": "s"}, "sends": []}
    cm = com.normalize(comment(1, text=EVIL), parent())
    cl = {"id": 2, "offer": "callvibe", "score": 70, "status": "new", "person": cm["author"]["key"], "source": "comment", "post": cm,
          "verdict": {"need": "x", "intent": "seeking_vendor"}, "sends": []}
    out = run_js("return [BR.renderLead(%s), BR.renderLead(%s), BR.renderDrawer(%s, {email: true, linkedin: true, saleshandy: true}), "
                 "BR.renderFilters('source:jobs', BR.offers), BR.leadQuery('source:comment')];"
                 % (json.dumps(jl), json.dumps(cl), json.dumps(jl)))
    job_card, comment_card, drawer, filters, query = out
    for html in out[:3]:
        assert "<img" not in html and "javascript:" not in html
    assert "br-kind--jobs" in job_card and ">Hiring<" in job_card and "Who decides" in job_card and "Open the company" in job_card
    assert "br-kind--comment" in comment_card and "Asker&#39;s post" in comment_card
    assert 'name="brWho"' in drawer and 'data-act="find"' in drawer and "Find their email first" in drawer
    assert "source:jobs" not in filters and ">Comments<" in filters and ">Hiring<" not in filters, "job ads are switched off"
    assert query == "?source=comment"


def test_the_settings_form_holds_the_sources_and_nothing_about_job_ads():
    form = run_js("const s = %s; return BR.renderSettings(s, {callvibe: {label: 'CallVibe', site: 'x', queries: ['a'], jobs: ['j']}}, {}, {});"
                  % json.dumps(br.merged({})))
    for id_ in ("brSrc-posts", "brSrc-comments", "brSrc-icp", "brSrc-rfps", "brSrc-reddit", "brComPosts"):
        assert 'id="%s"' % id_ in form, id_
    for gone in ("brSrc-jobs", "brJ-callvibe", "brJobLoc", "brJobDays", "brJobPer", "Job ads", "Job titles"):
        assert gone not in form, "job ads are switched off: " + gone
    assert "Where to look" in form


def test_job_ads_are_switched_off_for_every_workspace(monkeypatch):
    assert "jobs" not in br.LEAD_SOURCES and "jobs" not in br.DEFAULTS["sources"] and "jobs" in br.ALL_LEAD_SOURCES
    saved = br.merged({"sources": ["posts", "jobs", "reddit"]})
    assert br.sources_on(saved) == ["posts", "reddit"], "a workspace that saved it is not searched for it"
    assert br.clean_settings({"sources": ["posts", "jobs"]})["sources"] == ["posts"]
    est = br.estimate(br.merged({}))
    assert est["jobs"] == 0 and est["job_queries"] == 0
    monkeypatch.setenv("UNIPILE_API_KEY", "u")
    monkeypatch.delenv("APIFY_API_TOKEN", raising=False)
    FakeStore().install(monkeypatch)
    out = {}
    d, _ = deps([92], out)

    def boom(*a, **k):
        raise AssertionError("job ads were searched")
    d["jobs_search"] = boom
    summary = br.run(1, "acct:7", br.merged({"sources": ["posts", "jobs"]}), deps=d)
    assert "jobs" not in summary["by_source"] and summary["kept"] == 1 and "job_ads" not in summary
