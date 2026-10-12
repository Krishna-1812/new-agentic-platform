"""People & Signals (the Account Mapper code) (tracker/account_mapper.py, tracker/saleshandy_client.py):
Saleshandy's API read the way its reference describes it (quirks
included), job titles turned into search filters, a company resolved and
its people found, ranked and counted, all on fakes: no key, no network."""
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tracker import account_mapper as am  # noqa: E402
from tracker import saleshandy_client as sh  # noqa: E402


# == the client, against a fake transport ==============================================

class _Resp:
    def __init__(self, status, body, headers=None):
        self.status_code, self._body, self.headers = status, body, headers or {}

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class _Session:
    def __init__(self, *answers):
        self.answers, self.calls = list(answers), []

    def request(self, method, url, json=None, timeout=None, headers=None):
        self.calls.append({"method": method, "url": url, "json": json, "headers": headers})
        a = self.answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return a


def _client(*answers):
    sleeps = []
    c = sh.Client("k-123", session=_Session(*answers), sleep=sleeps.append, clock=lambda: 0.0)
    return c, sleeps


PEOPLE = {"message": "Success", "payload": {
    "status": "success", "display_limit": 10000, "total_results": 2, "page": 1, "per_page": 25, "total_pages": 1,
    "has_next_page": False, "has_previous_page": False, "people": [
        {"id": 1001, "full_name": "Jane Doe", "picture_url": "https://a.example/j.jpg", "job_title": "VP of Sales",
         "company_name": "Acme Corp", "company_website": "https://www.acme.com", "department": "Sales",
         "location": {"country": "United States", "state": "San Francisco", "city": "San Francisco"},
         "total_experience": 96, "decision_maker": True, "company_is_b2b": True},
        {"id": 1002, "full_name": "Alex Smith", "picture_url": "", "job_title": "Account Executive",
         "company_name": "Acme Corp", "company_website": "", "department": "", "location": {},
         "total_experience": None, "decision_maker": False, "company_is_b2b": None}]}}


def test_the_key_goes_in_its_header_and_a_missing_key_says_so(monkeypatch):
    c, _ = _client(_Resp(200, {"message": "Success", "payload": {"totalCredits": 1480, "creditConsumedToday": 2,
                                                                 "creditConsumedThisMonth": 20}}))
    assert c.credits() == {"total": 1480, "today": 2, "month": 20}
    call = c.session.calls[0]
    assert call["url"] == "https://open-api.saleshandy.com/v1/credits"
    assert call["headers"]["x-api-key"] == "k-123"
    monkeypatch.delenv("SALESHANDY_API_KEY", raising=False)
    assert not sh.configured()
    with pytest.raises(sh.AuthError, match="SALESHANDY_API_KEY"):
        sh.Client()


def test_people_are_flattened_and_blank_values_become_none():
    c, _ = _client(_Resp(201, PEOPLE))
    got = c.search_people({"company_domain": {"includes": ["acme.com"]}}, limit_per_company=5)
    assert c.session.calls[0]["json"] == {"company_domain": {"includes": ["acme.com"]}, "page": 1,
                                          "limitPerCompany": 5}
    assert got["total"] == 2 and not got["has_next"]
    jane, alex = got["people"]
    assert jane["first_name"] == "Jane" and jane["last_name"] == "Doe"
    assert jane["domain"] == "acme.com" and jane["experience_years"] == 8.0
    assert jane["location"] == "San Francisco, United States"      # the city repeated as the state is dropped
    assert jane["decision_maker"] is True
    assert alex["photo"] is None and alex["department"] is None and alex["location"] is None
    assert alex["domain"] is None and alex["experience_years"] is None


def test_no_results_come_back_as_an_empty_payload_list():
    c, _ = _client(_Resp(201, {"message": "Success", "payload": []}), _Resp(201, {"message": "Success", "payload": []}))
    assert c.search_people({}) == {"total": 0, "page": 1, "has_next": False, "display_limit": None, "people": []}
    assert c.search_companies({})["companies"] == []


def test_companies_sort_their_links_and_tolerate_empty_strings():
    body = {"message": "Success", "payload": {"total_results": 1, "page": 1, "has_next_page": False, "company": [
        {"id": 2001, "name": "Acme Corp", "socials": ["https://linkedin.com/company/acme", "https://www.acme.com",
                                                      "https://twitter.com/acme"],
         "location": {"city": "", "state": "", "country": "United States"}, "founded_year": "",
         "industry": "", "type": "Privately Held", "is_b2b": True, "sic_codes": "", "naics_codes": ["511210"],
         "employee_count": 480}]}}
    c, _ = _client(_Resp(201, body))
    co = c.search_companies({"company_name": {"includes": ["Acme"]}})["companies"][0]
    assert co["domain"] == "acme.com" and co["linkedin"] == "https://linkedin.com/company/acme"
    assert co["socials"]["x"] == "https://twitter.com/acme"
    assert co["founded"] is None and co["industry"] is None and co["sic"] == [] and co["naics"] == ["511210"]
    assert co["hq"] == "United States" and co["employees"] == 480


def test_both_error_shapes_are_read_and_a_bad_key_is_named():
    c, _ = _client(_Resp(400, {"error": True, "type": "auth", "code": 1001, "message": "Invalid token"}))
    with pytest.raises(sh.AuthError, match="Invalid token"):
        c.credits()
    c, _ = _client(_Resp(400, {"statusCode": 400, "message": ["page must be at most 400", "bad filter"],
                               "error": "Bad Request"}))
    with pytest.raises(sh.SaleshandyError, match="page must be at most 400; bad filter"):
        c.search_people({})


def test_rate_limits_and_outages_are_retried_a_bounded_number_of_times():
    c, sleeps = _client(_Resp(429, {}, {"Retry-After": "3"}), _Resp(503, {}), _Resp(201, PEOPLE))
    assert c.search_people({})["total"] == 2
    assert sleeps[:2] == [3.0, 4]
    c, _ = _client(_Resp(429, {}), _Resp(429, {}), _Resp(429, {}))
    with pytest.raises(sh.RateLimited):
        c.search_people({})
    assert [e["status"] for e in c.log] == [429, 429, 429]


def test_searches_are_spaced_out():
    t = [0.0]
    sleeps = []
    c = sh.Client("k", session=_Session(_Resp(201, PEOPLE), _Resp(201, PEOPLE)), sleep=sleeps.append,
                  clock=lambda: t[0])
    c.search_people({})
    t[0] += 0.1
    c.search_people({})
    assert sleeps and abs(sleeps[0] - (sh.SEARCH_GAP_S - 0.1)) < 1e-9


def test_enrichment_is_asked_for_the_way_the_reference_says():
    c, _ = _client(_Resp(200, {"message": "Success", "payload": {"requestId": "r1"}}),
                   _Resp(200, {"message": "Success", "payload": {"requestId": "r2"}}))
    assert c.enrich_contacts(lead_ids=[1, 2]) == "r1"
    assert c.session.calls[0]["json"] == {"lead_id": [1, 2], "email_type": "work_email", "reveal_phone": False}
    c.enrich_contacts(linkedin_urls=["https://linkedin.com/in/x"], profile_only=True)
    assert c.session.calls[1]["json"] == {"linkedin_url": ["https://linkedin.com/in/x"], "profile_only": True}
    with pytest.raises(ValueError):
        c.enrich_contacts()
    with pytest.raises(ValueError):
        c.enrich_contacts(lead_ids=list(range(101)))


def test_a_job_is_polled_until_done_then_its_results_fetched():
    status = lambda s: _Resp(200, {"message": "Success", "payload": {"requestId": "r1", "status": s,
                                                                     "totalRecords": 2, "processed": 1}})
    result = _Resp(200, {"message": "Success", "payload": {
        "requestId": "r1", "status": "completed", "totalRecords": 2, "processed": 2, "succeeded": 1, "failed": 1,
        "alreadyRevealed": 0, "creditsCharged": 1, "results": [{"lead_id": 1, "email": "jane@acme.com"}, "junk"]}})
    c, sleeps = _client(status("in-progress"), status("completed"), result)
    got = c.wait("r1", every=2)
    assert got["status"] == "completed" and got["credits"] == 1 and got["records"] == [
        {"lead_id": 1, "email": "jane@acme.com"}]
    assert sleeps == [2]


@pytest.mark.parametrize("raw, email, status, linkedin", [
    ({"lead_id": 7, "work_email": "Jane@Acme.com", "email_status": "Valid",
      "linkedin_url": "https://linkedin.com/in/jane"}, "jane@acme.com", "valid", "https://linkedin.com/in/jane"),
    ({"id": 7, "emails": [{"email": "j@gmail.com", "type": "personal", "status": "valid"},
                          {"email": "jane@acme.com", "type": "work", "status": "catch-all"}],
      "linkedinUrl": "https://linkedin.com/in/jane"}, "jane@acme.com", "risky", "https://linkedin.com/in/jane"),
    ({"contact": {"leadId": 7, "email": {"value": "jane@acme.com", "verificationStatus": "verified"}}},
     "jane@acme.com", "valid", None),
    ({"lead_id": 7, "email": "not an email"}, None, None, None),
])
def test_enrichment_records_are_read_from_the_names_they_are_likely_to_have(raw, email, status, linkedin):
    got = sh.enriched(raw)
    assert got["lead_id"] == 7
    assert got["email"] == email and got["email_status"] == status and got["linkedin"] == linkedin
    assert got["raw"] == raw


# == job titles ===========================================================================

@pytest.mark.parametrize("role, variant, level, dept", [
    ("CMO", "chief marketing officer", "C-Level", "Marketing"),
    ("VP Marketing", "vp of marketing", "President/Vice President", "Marketing"),
    ("Head of Growth", "growth head", "Head", "Marketing"),
    ("Director of Sales", "sales director", "Director", "Sales"),
    ("Chief Revenue Officer", "cro", "C-Level", "Sales"),
    ("CEO", "chief executive officer", "C-Level", "C-Suite"),
])
def test_a_title_becomes_its_phrasings_seniority_and_department(role, variant, level, dept):
    plan = am.role_plan(role)
    assert plan["variants"][0] == role and variant in [v.lower() for v in plan["variants"]]
    assert level in plan["levels"] and dept in plan["departments"]
    assert "intern" in plan["exclude"]


def test_a_vice_president_is_not_the_c_suite_and_asked_for_words_are_not_excluded():
    assert "C-Suite" not in am.role_plan("VP Sales")["departments"]
    assert "assistant" not in am.role_plan("Assistant Vice President")["exclude"]


def test_titles_are_parsed_and_bounded():
    assert am.parse_roles("CMO; vp marketing\ncmo") == ["CMO", "vp marketing"]
    with pytest.raises(ValueError):
        am.parse_roles(" ")
    with pytest.raises(ValueError):
        am.parse_roles(";".join("Role %d" % i for i in range(7)))


def test_companies_can_be_more_than_the_lab_takes_but_are_bounded():
    got = am.parse_companies("\n".join("Co %d" % i for i in range(14)) + "\nAcme | https://www.acme.com/x\nco 1")
    assert len(got) == 15 and got[-1] == {"name": "Acme", "domain": "acme.com"}
    with pytest.raises(ValueError):
        am.parse_companies("\n".join("Co %d" % i for i in range(26)))
    with pytest.raises(ValueError):
        am.parse_companies("")


# == ranking ==============================================================================

def _p(i, title, **kw):
    return dict({"id": i, "name": "P%d" % i, "title": title, "department": None, "decision_maker": False,
                 "experience_years": 5, "domain": "acme.com", "company": "Acme"}, **kw)


def test_the_closest_titles_are_picked_and_ruled_out_ones_dropped():
    plan = am.role_plan("VP Marketing")
    people = [_p(1, "Marketing Manager"), _p(2, "Vice President Marketing", department="Marketing"),
              _p(3, "Executive Assistant to the VP Marketing"), _p(4, "VP of Marketing & Communications"),
              _p(5, "Former VP Marketing"), _p(6, "Software Engineer")]
    picked, also = am.rank(people, plan, 2)
    assert [p["id"] for p in picked] == [2, 4]
    assert 3 not in [p["id"] for p in picked + also] and 5 not in [p["id"] for p in picked + also]
    assert [p["id"] for p in also][:1] == [1]


def test_a_manager_is_not_picked_when_a_chief_is_asked_for():
    plan = am.role_plan("CMO")
    picked, also = am.rank([_p(1, "Marketing Manager")], plan, 2)
    assert picked == [] and also[0]["id"] == 1


# == resolving a company ==================================================================

@pytest.mark.parametrize("asked, found, low, high", [
    ("Stripe", "Stripe, Inc.", 100, 100), ("Core Care", "CoreCare", 100, 100),
    ("Stripe", "Stripe Payments", 70, 80), ("Stripe", "Stripes Consulting", 0, 10)])
def test_company_names_are_compared_by_their_words(asked, found, low, high):
    assert low <= am.name_score(asked, found) <= high


def test_the_closest_name_wins_and_size_breaks_ties():
    cands = [{"name": "Acme Robotics", "domain": "acmerobotics.com", "employees": 40},
             {"name": "Acme", "domain": "acme.io", "employees": 12},
             {"name": "Acme Inc", "domain": "acme.com", "employees": 4000}]
    best, others = am.pick_company("Acme", cands)
    assert best["domain"] == "acme.com" and best["match_score"] == 100
    assert [o["domain"] for o in others][:1] == ["acme.io"]
    best, others = am.pick_company("Zeta", cands)
    assert best is None


# == a company end to end, on a fake Saleshandy =============================================

class FakeSH:
    """Answers searches from a small world, and counts what it was asked."""

    def __init__(self, companies, people, *, counts=None, fail=None):
        self.companies, self.people, self.counts = companies, people, counts or {}
        self.asked, self.log, self.fail = [], [], fail

    def credits(self):
        return {"total": 1480, "today": 0, "month": 20}

    def _match(self, p, f):
        if "company_domain" in f and p["domain"] not in f["company_domain"]["includes"]:
            return False
        if "company_name" in f and not any(am.name_score(n, p["company"]) >= 70 for n in f["company_name"]["includes"]):
            return False
        if "job_title" in f:
            t = p["title"].lower()
            if not any(v.lower() in t for v in f["job_title"]["includes"]):
                return False
            if any(x.lower() in t for x in f["job_title"].get("excludes") or []):
                return False
        if "management_level" in f and p.get("level") not in f["management_level"]["includes"]:
            return False
        if "department" in f and p.get("department") not in f["department"]["includes"]:
            return False
        if "current_role_tenure" in f and not p.get("new"):
            return False
        if f.get("decision_maker") and not p.get("decision_maker"):
            return False
        return True

    def search_people(self, filters, **kw):
        self.asked.append(("people", filters))
        self.log.append(1)
        if self.fail:
            raise self.fail
        hits = [dict(p) for p in self.people if self._match(p, filters)]
        return {"total": len(hits), "people": hits[:25], "page": 1, "has_next": False}

    def count_people(self, filters):
        return self.search_people(filters)["total"]

    def search_companies(self, filters, **kw):
        self.asked.append(("companies", filters))
        self.log.append(1)
        if "company_domain" in filters:
            d = filters["company_domain"]["includes"][0]
            extra = [k for k in filters if k != "company_domain"]
            if extra:
                return {"total": int(bool(self.counts.get((d, extra[0])))), "companies": []}
            hits = [c for c in self.companies if c["domain"] == d]
        else:
            n = filters["company_name"]["includes"][0]
            hits = [c for c in self.companies if am.name_score(n, c["name"]) > 0]
        return {"total": len(hits), "companies": hits}


ACME = {"id": 1, "name": "Acme Inc", "domain": "acme.com", "employees": 4000, "industry": "Software"}
WORLD = [
    {"id": 11, "name": "Jane Doe", "title": "VP of Marketing", "company": "Acme Inc", "domain": "acme.com",
     "department": "Marketing", "level": "President/Vice President", "decision_maker": True, "new": True},
    {"id": 12, "name": "Raj Patel", "title": "Marketing Manager", "company": "Acme Inc", "domain": "acme.com",
     "department": "Marketing", "level": "Manager"},
    {"id": 13, "name": "Lee Wong", "title": "Chief Revenue Officer", "company": "Acme Inc", "domain": "acme.com",
     "department": "Sales", "level": "C-Level", "decision_maker": True},
    {"id": 14, "name": "Sam Roe", "title": "VP Marketing", "company": "Acme Robotics", "domain": "acmerobotics.com",
     "department": "Marketing", "level": "President/Vice President"},
]


def test_a_company_is_resolved_its_people_found_ranked_and_counted():
    fake = FakeSH([ACME, {"id": 2, "name": "Acme Robotics", "domain": "acmerobotics.com", "employees": 40}], WORLD,
                  counts={("acme.com", "active_job_postings_count"): 1})
    plans = am.plan_roles(["VP Marketing", "CRO", "Head of Partnerships"])
    rec = am.map_company({"name": "Acme", "domain": None}, plans, fake)
    assert rec["domain"] == "acme.com" and rec["resolved"]["how"] == "exact name"
    assert [a["name"] for a in rec["resolved"]["alternatives"]] == ["Acme Robotics"]   # shown, so a wrong pick shows
    vp, cro, partner = rec["roles"]
    assert [p["name"] for p in vp["picked"]] == ["Jane Doe"] and vp["picked"][0]["new_in_role"] is True
    assert "Sam Roe" not in [p["name"] for p in vp["picked"] + vp["also"]]       # another company
    assert [p["name"] for p in cro["picked"]] == ["Lee Wong"]
    assert partner["status"] == "not_found" and len(partner["attempts"]) == 3
    ins = rec["insights"]
    assert ins["people_in_saleshandy"] == 3 and ins["decision_makers"] == 2
    assert {"department": "Marketing", "people": 2} in ins["teams"]
    assert ins["new_leaders"]["total"] == 1 and ins["new_leaders"]["people"][0]["name"] == "Jane Doe"
    assert ins["signals"] == {"hiring": True, "hiring_your_titles": False, "funded_last_year": False}
    assert ins["searches"] <= 10


def test_a_given_domain_wins_and_an_empty_search_is_broadened():
    world = [{"id": 21, "name": "Ana Lima", "title": "Diretora de Marketing", "company": "Acme", "domain": "acme.com",
              "department": "Marketing", "level": "Director"}]
    fake = FakeSH([ACME], world)
    rec = am.map_company({"name": "Whatever", "domain": "acme.com"}, am.plan_roles(["Marketing Director"]), fake,
                         with_insights=False)
    assert rec["resolved"]["how"] == "domain you gave" and rec["domain"] == "acme.com"
    role = rec["roles"][0]
    assert role["attempts"][0]["total"] == 0 and role["attempts"][1]["how"].startswith("seniority + department")
    assert role["status"] in ("found", "close") and (role["picked"] + role["also"])[0]["name"] == "Ana Lima"


def test_one_person_is_not_picked_for_two_titles():
    fake = FakeSH([ACME], WORLD)
    rec = am.map_company({"name": "Acme", "domain": "acme.com"}, am.plan_roles(["VP Marketing", "VP of Marketing"]),
                         fake, with_insights=False)
    names = [p["name"] for r in rec["roles"] for p in r["picked"]]
    assert names.count("Jane Doe") == 1


def test_a_run_maps_every_company_saves_as_it_goes_and_stops_on_a_rate_limit():
    saved = []
    fake = FakeSH([ACME], WORLD)
    out = am.map_accounts({"companies": [{"name": "Acme", "domain": None}, {"name": "Nobody", "domain": None}],
                           "roles": ["VP Marketing"], "insights": False, "on_company": lambda s: saved.append(1)},
                          fake)
    assert out["credits"]["total"] == 1480 and len(saved) == 2
    assert out["companies"][1]["resolved"]["how"] == "not found"
    assert out["totals"]["titles_found"] == 1 and out["totals"]["people_picked"] == 1
    json.dumps(out)
    limited = FakeSH([ACME], WORLD, fail=sh.RateLimited("slow down"))
    out = am.map_accounts({"companies": [{"name": "Acme", "domain": "acme.com"}], "roles": ["CMO"]}, limited)
    assert out["stopped"].startswith("Stopped: slow down")


def test_a_bad_key_stops_the_run_instead_of_failing_every_company():
    class Bad(FakeSH):
        def credits(self):
            raise sh.AuthError("Saleshandy did not accept the API key")
    with pytest.raises(sh.AuthError):
        am.map_accounts({"companies": [{"name": "Acme", "domain": None}], "roles": ["CMO"]}, Bad([ACME], WORLD))
