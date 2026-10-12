"""People & Signals phases 3-4 (tracker/account_mapper_reveal.py,
tracker/account_mapper_brief.py): a reveal is refused before it can pass
its credit cap or the balance, its results are matched back to the people
asked for, each company's email pattern is learned from verified emails
only, titles nobody holds are looked for on the web, and the brief is
built from the facts with names it cannot invent. All on fakes."""
import copy
import os
import sys
from decimal import Decimal

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tracker import account_mapper as am  # noqa: E402
from tracker import account_mapper_brief as ab  # noqa: E402
from tracker import account_mapper_reveal as ar  # noqa: E402
from tracker import contact_lab_search as search  # noqa: E402
from tracker import saleshandy_client as sh  # noqa: E402


def _person(i, name, title, **kw):
    return dict({"id": i, "name": name, "title": title, "domain": "acme.com", "company": "Acme"}, **kw)


def _summary():
    return {"plans": am.plan_roles(["VP Marketing", "CRO", "Head of Partnerships"]), "companies": [{
        "name": "Acme", "display_name": "Acme Inc", "domain": "acme.com",
        "resolved": {"company": {"name": "Acme Inc", "industry": "Software", "employees": 4000, "hq": "Austin"}},
        "insights": {"people_in_saleshandy": 300, "decision_makers": 20,
                     "teams": [{"department": "Marketing", "people": 40}],
                     "new_leaders": {"total": 1, "people": [{"name": "Jane Doe", "title": "VP of Marketing"}]},
                     "signals": {"hiring": True, "hiring_your_titles": True, "funded_last_year": False}},
        "roles": [
            {"role": "VP Marketing", "status": "found",
             "picked": [_person(11, "Jane Doe", "VP of Marketing", new_in_role=True)],
             "also": [_person(12, "Raj Patel", "Marketing Manager")]},
            {"role": "CRO", "status": "found", "picked": [_person(13, "Lee Wong", "Chief Revenue Officer")],
             "also": []},
            {"role": "Head of Partnerships", "status": "not_found", "picked": [], "also": []}]}]}


class FakeSH:
    def __init__(self, records, *, balance=1480, status="completed", credits=None):
        self.records, self.balance, self.status, self.credits_charged = records, balance, status, credits
        self.enriched = []

    def credits(self):
        return {"total": self.balance}

    def enrich_contacts(self, **kw):
        self.enriched.append(kw)
        return "r%d" % len(self.enriched)

    def wait(self, rid, timeout=None):
        recs = self.records.pop(0) if self.records else []
        return {"status": self.status, "records": recs, "credits": self.credits_charged if self.credits_charged
                is not None else sum(1 for r in recs if r.get("email") or r.get("work_email")),
                "already_revealed": 0, "succeeded": len(recs), "failed": 0}


def test_the_default_reveal_is_the_best_person_per_title():
    assert ar.default_selection(_summary()) == [11, 13]


def test_a_reveal_over_its_cap_or_the_balance_is_refused_before_any_request():
    s = _summary()
    check = ar.plan_reveal(s, [11, "13", 12, 11, 999], cap=2)
    assert check["keys"] == [11, 13, 12] and check["worst_credits"] == 3 and not check["ok"]
    assert "cap of 2" in check["why"] and check["skipped"] == [{"key": 999, "why": "not in this run"}]
    assert not ar.plan_reveal(s, [11], phone=True, cap=50, balance=5)["ok"]          # 7 credits with a phone
    fake = FakeSH([], balance=1)
    with pytest.raises(ar.RevealRefused, match="account has 1"):
        ar.reveal(s, [11, 13], fake)
    assert fake.enriched == []


def test_a_reveal_matches_results_back_and_learns_the_pattern_from_verified_emails():
    s = _summary()
    fake = FakeSH([[{"lead_id": "11", "email": "jane.doe@acme.com", "email_status": "valid",
                     "linkedin_url": "https://linkedin.com/in/janedoe"},
                    {"full_name": "Lee Wong", "work_email": "lee.wong@acme.com", "email_status": "valid"}]])
    report = ar.reveal(s, [11, 13], fake, cap=10)
    assert fake.enriched == [{"lead_ids": [11, 13], "reveal_phone": False}]
    assert report["found"] == 2 and report["verified"] == 2 and report["credits"] == 2
    jane = s["companies"][0]["roles"][0]["picked"][0]
    assert jane["email"]["label"] == "verified" and jane["linkedin"] == "https://linkedin.com/in/janedoe"
    raj = s["companies"][0]["roles"][0]["also"][0]
    assert raj["email"]["address"] == "raj.patel@acme.com" and raj["email"]["label"] == "pattern_confirmed"
    assert "2 verified emails" in raj["email"]["note"]
    assert s["companies"][0]["email_pattern"]["pattern"] == "first.last"
    # Revealed people are not revealed twice.
    assert ar.plan_reveal(s, [11])["why"] == "nobody to reveal"


def test_no_pattern_is_built_from_risky_emails_and_a_miss_is_said_plainly():
    s = _summary()
    fake = FakeSH([[{"lead_id": 11, "email": "jdoe@acme.com", "email_status": "catch-all"}]])
    report = ar.reveal(s, [11, 13], fake)
    assert report["risky"] == 1 and report["not_found"] == 1
    lee = s["companies"][0]["roles"][1]["picked"][0]
    assert lee["email"]["label"] == "not_found"
    raj = s["companies"][0]["roles"][0]["also"][0]
    assert "email" not in raj and s["companies"][0]["email_pattern"] is None


def test_a_job_still_running_is_pending_not_a_miss():
    s = _summary()
    report = ar.reveal(s, [11], FakeSH([[]], status="in-progress", credits=0))
    assert s["companies"][0]["roles"][0]["picked"][0]["email"]["label"] == "pending"
    assert report["not_found"] == 0


def test_a_title_nobody_holds_is_looked_for_on_the_web_and_revealed_by_linkedin():
    s = _summary()
    asked = []

    def fake_search(query, **kw):
        asked.append((query, kw["site"]))
        return {"status": "ok", "cost_usd": 0.01, "results": [
            {"title": "Mia Chen - Head of Partnerships - Acme Inc | LinkedIn",
             "url": "https://www.linkedin.com/in/miachen"},
            {"title": "Bo Li - Head of Partnerships at Acme Robotics | LinkedIn", "url": "https://linkedin.com/in/boli"},
            {"title": "Al Ray - Former Head of Partnerships, Acme Inc | LinkedIn", "url": "https://linkedin.com/in/alray"}]}

    assert ar.web_fill(s, model="claude-haiku-5-5", budget=search.Budget(1), search_fn=fake_search) == 1
    assert asked == [('"Acme Inc" "Head of Partnerships"', "linkedin.com")]
    role = s["companies"][0]["roles"][2]
    assert [p["name"] for p in role["web"]] == ["Mia Chen"] and role["status"] == "web"
    assert ar.default_selection(s) == [11, 13, "li:miachen"]
    fake = FakeSH([[{"lead_id": 11, "email": "jane.doe@acme.com", "email_status": "valid"}],
                   [{"linkedin": "https://www.linkedin.com/in/miachen", "email": "mia.chen@acme.com",
                     "email_status": "valid"}]])
    ar.reveal(s, [11, "https://linkedin.com/in/MiaChen/"], fake)
    assert fake.enriched[1] == {"linkedin_urls": ["https://www.linkedin.com/in/miachen"], "reveal_phone": False}
    assert role["web"][0]["email"]["address"] == "mia.chen@acme.com"


# == priority and the brief =====================================================================

def test_priority_rewards_a_new_buyer_hiring_and_coverage():
    s = _summary()
    p = ab.priority(s["companies"][0])
    assert p["score"] == 30 + 20 + 20
    assert any("Jane Doe" in r for r in p["reasons"]) and "2 of 3 titles found" in p["reasons"]
    quiet = {"name": "Q", "roles": [{"role": "CMO", "picked": [], "also": []}], "insights": {}}
    assert ab.priority(quiet)["score"] == 0
    s["companies"].append(quiet)
    assert ab.rank_accounts(s) == ["Acme", "Q"]


def test_the_facts_carry_profile_counts_signals_people_and_pages():
    text = ab.facts(_summary()["companies"][0], {"https://acme.com/careers": "We are   hiring\n SDRs"})
    assert "PROFILE (Saleshandy): industry Software; employees 4000" in text
    assert "hiring for the target titles yes; funding announced in the last year not shown" in text
    assert "- Jane Doe: VP of Marketing; asked for: VP Marketing; new in role in the last year" in text
    assert "WEBSITE PAGE https://acme.com/careers:\nWe are hiring SDRs" in text


def test_the_brief_cannot_name_people_who_were_not_found():
    def call(budget, stage, model, system, user, schema, max_tokens):
        assert stage == "brief" and "ONLY the facts" in system
        return {"one_liner": "x", "shape": "y", "changes": [], "watch_outs": [],
                "first_contact": {"name": "Elon Musk", "why": "famous"},
                "openers": [{"name": "Jane Doe", "line": "a"}, {"name": "Made Up", "line": "b"}]}
    got = ab.brief(_summary()["companies"][0], {}, model="m", budget=None, call=call)
    assert got["first_contact"]["name"] is None and [o["name"] for o in got["openers"]] == ["Jane Doe"]


def test_briefs_go_best_account_first_and_stop_at_the_cap():
    s = _summary()
    s["companies"].append({"name": "Q", "domain": None, "roles": [], "insights": {}})
    calls = []

    def call(budget, stage, model, system, user, schema, max_tokens):
        calls.append(user.splitlines()[0])
        if len(calls) == 2:
            raise search.BudgetExceeded("cap")
        return {"one_liner": "", "shape": "", "changes": [], "watch_outs": [], "first_contact": {"name": None,
                "why": ""}, "openers": []}

    n = ab.brief_accounts(s, model="m", budget=None, call=call, reader=lambda d: ({}, []))
    assert n == 1 and calls[0].startswith("ACCOUNT: Acme Inc") and s["brief_stopped"].startswith("Stopped")
    assert "brief" in s["companies"][0] and "brief" not in s["companies"][1]


def test_a_brief_costs_cents_on_haiku():
    assert 0 < ab.estimate_usd(10, "claude-haiku-5-5") < 0.10


def test_site_pages_respect_robots_and_skip_the_home_page_twice():
    pages = {"https://acme.com/": "home", "https://acme.com/about": "about us", "https://acme.com/careers": "jobs"}

    def fetch(url):
        if url in pages:
            return {"status": "ok", "final_url": url, "text": pages[url]}
        return {"status": "not_found", "note": "404"}

    got, notes = ab.read_pages("acme.com", fetch=fetch, fetch_text=lambda u: "User-agent: *\nDisallow: /careers")
    assert list(got) == ["https://acme.com/", "https://acme.com/about"]
    assert {"url": "https://acme.com/careers", "status": "robots", "note": "robots.txt asks us not to"} in notes
