"""People & Signals chat (tracker/people_chat.py): a message in plain words is read into companies and the people
wanted (by rules, free; Claude only when rules find nothing and only for staff), searched on Saleshandy
(free), and shaped like a mapping summary so reveal, CSV and the run list work on it. All on fakes."""
import os
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tracker import account_mapper as am  # noqa: E402
from tracker import account_mapper_store as store  # noqa: E402
from tracker import contact_lab_search as search  # noqa: E402
from tracker import people_chat as pc  # noqa: E402
from tracker import saleshandy_client as sh  # noqa: E402
from tests.test_account_mapper import ACME, FakeSH  # noqa: E402

ADMIN = "kris@markifydigital.com"
BASE = "/strategic-agents/people-signals"


def read(message, **kw):
    return pc.understand(message, **kw)


def shape(r):
    return ([c["name"] + ("|" + c["domain"] if c.get("domain") else "") for c in r.get("companies", [])],
            [(a["kind"], a["label"]) for a in r.get("asks", [])])


# == reading a message =========================================================================

@pytest.mark.parametrize("message, companies, asks", [
    ("marketing people in Company X", ["Company X"], [("team", "Marketing team")]),
    ("marketing people at Stripe", ["Stripe"], [("team", "Marketing team")]),
    ("Who is the CMO of Databricks?", ["Databricks"], [("title", "CMO")]),
    ("Stripe CFO", ["Stripe"], [("title", "CFO")]),
    ("CMOs at Slack", ["Slack"], [("title", "CMO")]),
    ("VP Sales and CFO at Notion and Ramp", ["Notion", "Ramp"], [("title", "VP Sales"), ("title", "CFO")]),
    ("Head of Sales and Marketing at Stripe", ["Stripe"], [("title", "Head of Sales and Marketing")]),
    ("Give me the head of growth and VP of demand generation at Gong", ["Gong"],
     [("title", "Head of Growth"), ("title", "VP of Demand Generation")]),
    ("CFO of Bank of America", ["Bank of America"], [("title", "CFO")]),
    ("find me the sales team at Procter & Gamble", ["Procter & Gamble"], [("team", "Sales team")]),
    ("top 5 engineers at hubspot.com", ["Hubspot|hubspot.com"], [("team", "Engineers")]),
    ("decision makers at https://www.asana.com/about", ["Asana|asana.com"], [("team", "Decision-makers")]),
    ("directors in finance at Shopify", ["Shopify"], [("team", "Finance Directors")]),
    ("product managers at Figma", ["Figma"], [("team", "Product Managers")]),
    ("Customer success people at Intercom", ["Intercom"], [("team", "Customer Success team")]),
    ("10 sales people at \"Product Hunt\"", ["Product Hunt"], [("team", "Sales team")]),
    ("marketing leaders at Airbnb, Uber", ["Airbnb", "Uber"], [("team", "Marketing Leaders")]),
    ("CMO @ Zoom", ["Zoom"], [("title", "CMO")]),
])
def test_plain_words_become_companies_and_the_people_wanted(message, companies, asks):
    r = read(message)
    assert r["kind"] == "search", r
    assert shape(r) == (companies, asks)


def test_a_place_after_the_company_is_a_place_and_numbers_are_counts():
    r = read("recruiters at Meta in Austin")
    assert shape(r) == (["Meta"], [("team", "Recruiters")]) and r["where"] == "Austin"
    r = read("find me the sales team at Procter & Gamble in London")
    assert r["where"] == "London" and r["companies"][0]["name"] == "Procter & Gamble"
    assert read("top 5 engineers at hubspot.com")["asks"][0]["count"] == 5
    assert read("all marketing people at Zoom")["asks"][0]["count"] == pc.MAX_TEAM
    assert read("three CMOs at Zoom")["asks"][0]["count"] == 3
    assert read("500 marketing people at Zoom")["asks"][0].get("count") in (None, pc.MAX_TEAM)


def test_a_team_ask_knows_its_department_and_a_leaders_ask_its_levels():
    team = read("marketing people at Stripe")["asks"][0]
    assert team["departments"] == ["Marketing"] and "Marketing" in team["keywords"] and team["levels"] == []
    directors = read("directors in finance at Shopify")["asks"][0]
    assert directors["departments"] == ["Finance & Accounting"] and directors["levels"] == ["Director"]
    leaders = read("leaders at Stripe")["asks"][0]
    assert "C-Level" in leaders["levels"] and leaders["departments"] == []
    title = read("VP of Marketing at Stripe")["asks"][0]
    assert title["kind"] == "title" and title["role"] == "VP of Marketing"


def test_a_message_missing_the_company_or_the_people_asks_for_it():
    r = read("Stripe")
    assert r["kind"] == "clarify" and r["need"] == "role" and "Leadership" in r["choices"]
    r = read("marketing people")
    assert r["kind"] == "clarify" and r["need"] == "company"
    for hello in ("hi", "what can you do?", "help", "thanks"):
        assert read(hello)["kind"] == "help"
    assert read("")["kind"] == "help"
    assert read("zzz qqq")["kind"] in ("clarify", "search")


def test_a_follow_up_keeps_the_half_it_does_not_name():
    ctx = pc.clean_context({"companies": [{"name": "Stripe", "domain": "stripe.com"}],
                            "asks": [{"kind": "team", "label": "Marketing team", "departments": ["Marketing"],
                                      "keywords": ["Marketing"]}]})
    r = read("and their sales team?", context=ctx)
    assert r["kind"] == "search" and r["how"] == "context"
    assert shape(r) == (["Stripe|stripe.com"], [("team", "Sales team")])
    r = read("what about Notion?", context=ctx)
    assert r["kind"] == "search" and shape(r) == (["Notion"], [("team", "Marketing team")])
    r = read("CFO at Ramp", context=ctx)
    assert shape(r) == (["Ramp"], [("title", "CFO")]) and r["how"] == "rules"


def test_the_limits_are_kept_and_said():
    r = read("CFO at A1, B2, C3, D4, E5, F6, G7")
    assert len(r["companies"]) == pc.MAX_COMPANIES and "first 5" in r["note"]


def test_a_hand_made_context_cannot_say_more_than_the_module_would():
    ctx = pc.clean_context({"companies": [{"name": "x" * 500, "domain": "not a domain"}, "junk", {"name": 5}],
                            "asks": [{"kind": "evil", "label": "x"},
                                     {"kind": "team", "label": "T", "departments": ["Marketing", "Nope"],
                                      "levels": ["Director", "God"], "keywords": ["a"] * 20}, 7]})
    assert len(ctx["companies"]) == 1 and len(ctx["companies"][0]["name"]) == 120 and ctx["companies"][0]["domain"] is None
    assert len(ctx["asks"]) == 1 and ctx["asks"][0]["departments"] == ["Marketing"]
    assert ctx["asks"][0]["levels"] == ["Director"] and len(ctx["asks"][0]["keywords"]) == 6
    assert pc.clean_context("nope") == {"companies": [], "asks": []}


# == Claude, only when the rules find nothing ====================================================

def test_claude_is_asked_only_when_the_rules_find_nothing():
    asked = []

    def claude(message, context):
        asked.append(message)
        return pc.from_claude({"companies": [{"name": "Acme", "domain": "acme.com"}], "count": 4, "location": "Berlin",
                               "asks": [{"kind": "team", "label": "Revenue ops", "titles": ["Revenue Operations"],
                                         "department": "Sales", "seniority": ["Manager", "Nonsense"]}], "reply": ""})
    assert read("marketing people at Stripe", claude=claude)["how"] == "rules" and asked == []
    r = read("whoever keeps the funnel honest over at acme.com, 4 of them", claude=claude)
    assert asked and r["how"] == "claude" and r["where"] == "Berlin"
    assert r["companies"] == [{"name": "Acme", "domain": "acme.com"}]
    ask = r["asks"][0]
    assert ask["kind"] == "team" and ask["departments"] == ["Sales"] and ask["levels"] == ["Manager"]
    assert ask["count"] == 4


def test_a_claude_reply_with_a_question_is_passed_on_and_a_failure_falls_back_to_asking():
    def asks_back(message, context):
        return pc.from_claude({"companies": [], "asks": [], "count": 0, "location": "", "reply": "Which company?"})
    r = read("the thing from before", claude=asks_back)
    assert r["kind"] == "clarify" and r["reply"] == "Which company?"

    def broken(message, context):
        raise RuntimeError("boom")
    assert read("the thing from before", claude=broken)["kind"] == "clarify"


def test_claudes_answer_is_checked_before_use():
    got = pc.from_claude({"companies": [{"name": "  Acme  ", "domain": "http://bad"}, {"name": ""}, {"name": "acme"}],
                          "asks": [{"kind": "team", "label": "x", "titles": [], "department": "Space", "seniority": []},
                                   {"kind": "title", "label": "CFO", "titles": ["CFO", "Finance Chief"],
                                    "department": "", "seniority": []}], "count": -3, "location": "", "reply": ""})
    assert got["companies"] == [{"name": "Acme", "domain": None}] and got["count"] is None
    assert [a["kind"] for a in got["asks"]] == ["title"] and got["asks"][0]["variants"] == ["Finance Chief"]


# == searching ==================================================================================

WORLD = [
    {"id": 11, "name": "Jane Doe", "title": "VP of Marketing", "company": "Acme Inc", "domain": "acme.com",
     "department": "Marketing", "level": "President/Vice President", "decision_maker": True, "location": "Austin, Texas, United States",
     "experience_years": 14},
    {"id": 12, "name": "Raj Patel", "title": "Marketing Manager", "company": "Acme Inc", "domain": "acme.com",
     "department": "Marketing", "level": "Manager", "location": "London, United Kingdom", "experience_years": 6},
    {"id": 13, "name": "Mia Chen", "title": "Content Marketing Lead", "company": "Acme Inc", "domain": "acme.com",
     "department": "Marketing", "level": "Manager", "location": "London, United Kingdom", "experience_years": 4},
    {"id": 14, "name": "Tom Intern", "title": "Marketing Intern", "company": "Acme Inc", "domain": "acme.com",
     "department": "Marketing", "level": "Intern"},
    {"id": 15, "name": "Lee Wong", "title": "Chief Revenue Officer", "company": "Acme Inc", "domain": "acme.com",
     "department": "Sales", "level": "C-Level", "decision_maker": True, "location": "Austin, Texas, United States"},
    {"id": 16, "name": "Old Timer", "title": "Former VP of Marketing", "company": "Acme Inc", "domain": "acme.com",
     "department": "Marketing", "level": "President/Vice President"},
    {"id": 17, "name": "Sam Roe", "title": "VP Marketing", "company": "Acme Robotics", "domain": "acmerobotics.com",
     "department": "Marketing", "level": "President/Vice President"},
]


def fake():
    return FakeSH([ACME, {"id": 2, "name": "Acme Robotics", "domain": "acmerobotics.com", "employees": 40}], WORLD)


def test_a_team_comes_back_most_senior_first_without_interns_or_former_staff():
    parsed = read("marketing people at Acme")
    summary = pc.answer(parsed, fake(), message="marketing people at Acme")
    (company,) = summary["companies"]
    role = company["roles"][0]
    assert company["domain"] == "acme.com" and role["kind"] == "team" and role["status"] == "found"
    assert [p["name"] for p in role["picked"]] == ["Jane Doe", "Raj Patel", "Mia Chen"]      # VP, then the managers
    names = [p["name"] for p in role["picked"] + role["also"]]
    assert "Tom Intern" not in names and "Old Timer" not in names and "Sam Roe" not in names
    assert role["total"] >= 3 and role["attempts"][0]["how"].startswith("Marketing department")
    assert summary["totals"]["people_picked"] == 3 and summary["credits"]["total"] == 1480
    assert summary["chat"]["message"] == "marketing people at Acme"


def test_how_many_were_asked_for_limits_the_list_and_the_rest_are_also_found():
    parsed = read("top 2 marketing people at Acme")
    role = pc.answer(parsed, fake())["companies"][0]["roles"][0]
    assert [p["name"] for p in role["picked"]] == ["Jane Doe", "Raj Patel"]
    assert [p["name"] for p in role["also"]] == ["Mia Chen"]


def test_a_title_and_a_team_in_one_message_do_not_repeat_a_person():
    parsed = read("CRO and sales people at Acme")
    assert [a["kind"] for a in parsed["asks"]] == ["title", "team"]
    roles = pc.answer(parsed, fake())["companies"][0]["roles"]
    assert [p["name"] for p in roles[0]["picked"]] == ["Lee Wong"]
    assert roles[1]["picked"] == [] and roles[1]["status"] == "not_found"       # Lee is already shown above


def test_a_place_narrows_the_list_and_says_so_or_says_it_could_not():
    london = pc.answer(read("marketing people at Acme in London"), fake())["companies"][0]["roles"][0]
    assert [p["name"] for p in london["picked"]] == ["Raj Patel", "Mia Chen"] and "London" in london["note"]
    nowhere = pc.answer(read("marketing people at Acme in Tokyo"), fake())["companies"][0]["roles"][0]
    assert len(nowhere["picked"]) == 3 and "None of them list Tokyo" in nowhere["note"]


def test_a_company_that_is_not_found_is_kept_with_its_state():
    summary = pc.answer(read("CFO at Zzzzz Qqqq"), fake())
    (company,) = summary["companies"]
    assert company["domain"] is None and company["roles"][0]["status"] == "not_found"


def test_a_rate_limit_keeps_the_companies_before_it():
    class Limited(FakeSH):
        def search_people(self, filters, **kw):
            if len(self.asked) > 3:
                raise sh.RateLimited("slow down")
            return super().search_people(filters, **kw)
    c = Limited([ACME], WORLD)
    summary = pc.answer(read("marketing people at Acme, Acme Inc"), c)
    assert summary["stopped"] and "rate limit" in summary["stopped"].lower() or summary["stopped"]
    assert len(summary["companies"]) >= 1


def test_a_bad_key_is_not_swallowed():
    c = FakeSH([ACME], WORLD, fail=sh.AuthError("bad key"))
    with pytest.raises(sh.AuthError):
        pc.answer(read("marketing people at Acme"), c)


def test_the_result_works_with_the_reveal_and_the_csv():
    from tracker import account_mapper_reveal as ar
    summary = pc.answer(read("marketing people at Acme"), fake())
    assert ar.default_selection(summary) == [11, 12, 13]
    assert ar.plan_reveal(summary, [11, 12], cap=10)["ok"]
    rows = store.csv_rows(summary)
    assert [r["name"] for r in rows][:3] == ["Jane Doe", "Raj Patel", "Mia Chen"] and rows[0]["title_asked"] == "Marketing team"


# == the route =================================================================================

def _client(email):
    import app as appmod
    c = appmod.app.test_client()
    if email:
        with c.session_transaction() as sess:
            sess["google_user"] = {"email": email, "name": "T"}
    return c


def test_the_chat_route_is_for_the_team_only():
    for email, loc in ((None, "/login"), ("someone@gmail.example", "/app")):
        r = _client(email).post(BASE + "/api/chat", json={"message": "CFO at Stripe"})
        assert r.status_code == 302 and (loc in r.headers["Location"] or loc == "/login")


def test_a_question_or_a_hint_is_answered_at_once_and_uses_no_run(monkeypatch):
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    started = []
    monkeypatch.setattr(store, "start_chat", lambda *a, **k: started.append(1) or 1)
    c = _client(ADMIN)
    assert c.post(BASE + "/api/chat", json={"message": "x"}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert c.post(BASE + "/api/chat", json={}).status_code == 400
    assert c.post(BASE + "/api/chat", json={"message": "x" * 600}).status_code == 400
    j = c.post(BASE + "/api/chat", json={"message": "hi"}).get_json()
    assert j["kind"] == "help" and "marketing people" in j["reply"]
    j = c.post(BASE + "/api/chat", json={"message": "Stripe"}).get_json()
    assert j["kind"] == "clarify" and j["need"] == "role" and j["choices"] and j["usd"] == 0
    assert started == []


class OneCompany(FakeSH):
    """Saleshandy where "Acme" and "Company X" are each one company: nothing to choose."""

    def search_companies(self, filters, **kw):
        self.asked.append(("companies", filters))
        if "company_domain" in filters:
            return {"total": 0, "companies": []}
        n = filters["company_name"]["includes"][0]
        return {"total": 1, "companies": [{"id": 1, "name": n, "domain": "x.com", "employees": 5}]}


def _fake_saleshandy(monkeypatch, cls=OneCompany):
    monkeypatch.setattr(sh, "Client", lambda *a, **k: cls([ACME], WORLD))


def test_a_search_needs_the_key_and_starts_once(monkeypatch):
    _fake_saleshandy(monkeypatch)
    monkeypatch.delenv("SALESHANDY_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    c = _client(ADMIN)
    body = {"message": "marketing people in Company X"}
    r = c.post(BASE + "/api/chat", json=body)
    assert r.status_code == 400 and "SALESHANDY_API_KEY" in r.get_json()["error"]
    assert r.get_json()["understood"]["companies"][0]["name"] == "Company X"          # still read, so the page can say so
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    started, going = [], {}
    monkeypatch.setattr(store, "running_run", lambda email: going.get("run"))

    def start(parsed, message, email, usd=0, started_by=None):
        started.append((parsed, message, usd))
        going["run"] = {"id": 8}
        return 8
    monkeypatch.setattr(store, "start_chat", start)
    r = c.post(BASE + "/api/chat", json=body)
    j = r.get_json()
    assert r.status_code == 202 and j["run_id"] == 8 and j["kind"] == "search" and j["usd"] == 0
    parsed, message, usd = started[0]
    assert message == body["message"] and parsed["asks"][0]["label"] == "Marketing team"
    r = c.post(BASE + "/api/chat", json=body)
    assert r.status_code == 409 and len(started) == 1


def test_the_follow_up_context_comes_from_the_page(monkeypatch):
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    _fake_saleshandy(monkeypatch)
    monkeypatch.setattr(store, "running_run", lambda email: None)
    got = []
    monkeypatch.setattr(store, "start_chat", lambda parsed, message, email, usd=0, started_by=None: got.append(parsed) or 3)
    ctx = {"companies": [{"name": "Stripe", "domain": "stripe.com"}]}
    r = _client(ADMIN).post(BASE + "/api/chat", json={"message": "and their CFO?", "context": ctx})
    assert r.status_code == 202
    assert got[0]["companies"] == [{"name": "Stripe", "domain": "stripe.com"}] and got[0]["asks"][0]["label"] == "CFO"


def test_claude_reads_a_message_only_for_staff_with_a_key_and_is_capped(monkeypatch):
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    _fake_saleshandy(monkeypatch)
    monkeypatch.setattr(store, "running_run", lambda email: None)
    monkeypatch.setattr(store, "start_chat", lambda parsed, message, email, usd=0, started_by=None: 9)
    seen = {}

    def reader(model, budget):
        seen["cap"] = budget.cap
        seen["model"] = model

        def read_it(message, context):
            budget.add("chat_read", model, 0.0004, {})
            return pc.from_claude({"companies": [{"name": "Acme", "domain": ""}], "count": 0, "location": "", "reply": "",
                                   "asks": [{"kind": "title", "label": "CFO", "titles": ["CFO"], "department": "",
                                             "seniority": []}]})
        return read_it
    monkeypatch.setattr(pc, "claude_reader", reader)
    c = _client(ADMIN)
    j = c.post(BASE + "/api/chat", json={"message": "the money person at acme"}).get_json()
    assert j["understood"]["how"] == "claude" and j["usd"] == 0.0004
    assert seen["cap"] == pc.PARSE_CAP_USD and seen["model"] == "claude-haiku-5-5"
    seen.clear()
    j = c.post(BASE + "/api/chat", json={"message": "marketing people at Acme"}).get_json()
    assert j["usd"] == 0 and j["understood"]["how"] == "rules"


# == which company? ============================================================================

P2 = [{"id": 11, "name": "Position2 Inc", "domain": "position2.com", "employees": 220, "industry": "Marketing Services",
       "hq": "Sunnyvale, United States"},
      {"id": 12, "name": "Position2", "domain": "position2.in", "employees": 40, "industry": "Advertising Services"},
      {"id": 13, "name": "Position2 Solutions Ltd", "domain": "position2solutions.co.uk", "employees": 8},
      {"id": 14, "name": "Unrelated Co", "domain": "unrelated.com", "employees": 99}]
P2_WORLD = WORLD + [
    {"id": 300, "name": "Right Person", "title": "Chief Marketing Officer", "company": "Position2 Inc", "domain": "position2.com",
     "department": "Marketing", "level": "C-Level", "decision_maker": True, "location": "Bengaluru, India"},
    {"id": 301, "name": "Namesake Person", "title": "Marketing Director", "company": "Position2 Solutions Ltd",
     "domain": "position2solutions.co.uk", "department": "Marketing", "level": "Director", "location": "London, United Kingdom"}]


def test_a_name_that_several_companies_answer_to_is_put_to_the_user():
    c = FakeSH([ACME] + P2, P2_WORLD)
    parsed = read("marketing people at Position2")
    companies, needs = pc.resolve_plan(parsed, c)
    assert companies == [{"name": "Position2", "domain": None}]
    (need,) = needs
    assert need["name"] == "Position2"
    assert [x["domain"] for x in need["candidates"]] == ["position2.com", "position2.in", "position2solutions.co.uk"]
    assert need["candidates"][0]["industry"] == "Marketing Services" and "Unrelated Co" not in str(need)


def test_one_exact_company_is_settled_without_asking_and_a_website_is_never_asked_about():
    c = FakeSH([ACME] + P2, P2_WORLD)
    companies, needs = pc.resolve_plan(read("CFO at Acme"), c)
    assert needs == [] and companies == [{"name": "Acme", "domain": "acme.com"}]
    c = FakeSH([ACME] + P2, P2_WORLD)
    companies, needs = pc.resolve_plan(read("CFO at position2.in"), c)
    assert needs == [] and companies[0]["domain"] == "position2.in" and c.asked == []          # not even looked up


def test_a_near_name_only_or_no_company_at_all_is_also_put_to_the_user():
    c = FakeSH([ACME] + P2, P2_WORLD)
    _, needs = pc.resolve_plan(read("CFO at Position2 Solutions"), c)
    assert [x["domain"] for x in needs[0]["candidates"]][0] == "position2solutions.co.uk"      # one candidate, still confirmed
    assert len(needs[0]["candidates"]) >= 1
    _, needs = pc.resolve_plan(read("CFO at Zzzzz Qqqq"), FakeSH([ACME], WORLD))
    assert needs == [{"name": "Zzzzz Qqqq", "candidates": []}]


def test_the_likely_website_finds_a_company_listed_under_another_name():
    world = [{"id": 1, "name": "Pos Two Digital", "domain": "position2.com", "employees": 10}]
    cands = pc.candidates_for("Position2", FakeSH(world, []))
    assert [c["domain"] for c in cands] == ["position2.com"] and cands[0]["score"] >= 40


def test_a_company_the_user_chose_is_searched_only_at_its_website():
    """The namesake's marketing director never appears: no search by the company's name once the website is known."""
    c = FakeSH([ACME] + P2, P2_WORLD)
    parsed = pc.apply_picks(read("marketing people at Position2"), {"Position2": "position2.com"})
    assert parsed["companies"] == [{"name": "Position2", "domain": "position2.com"}]
    role = pc.answer(parsed, c)["companies"][0]["roles"][0]
    assert [p["name"] for p in role["picked"] + role["also"]] == ["Right Person"]
    assert all("company_name" not in f for kind, f in c.asked if kind == "people")
    title = pc.answer(pc.apply_picks(read("CMO at Position2"), {"Position2": "position2.com"}), FakeSH([ACME] + P2, P2_WORLD))
    assert [p["name"] for p in title["companies"][0]["roles"][0]["picked"]] == ["Right Person"]


def test_a_request_sent_back_after_choosing_is_checked_and_a_pick_cannot_be_a_non_domain():
    parsed = read("top 3 marketing people at Position2 in Bengaluru")
    back = pc.clean_request(dict(parsed, companies=[{"name": "Position2", "domain": None}]))
    assert back["asks"][0]["count"] == 3 and back["where"] == "Bengaluru" and back["kind"] == "search"
    assert pc.clean_request({"companies": [], "asks": []}) is None and pc.clean_request("x") is None
    assert pc.apply_picks(back, {"Position2": "javascript:alert(1)", "Other": "x.com"})["companies"][0]["domain"] is None
    assert pc.apply_picks(back, {"Position2": "www.position2.com"})["companies"][0]["domain"] == "position2.com"


def test_the_route_lists_the_companies_then_searches_the_one_chosen(monkeypatch):
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(sh, "Client", lambda *a, **k: FakeSH([ACME] + P2, P2_WORLD))
    monkeypatch.setattr(store, "running_run", lambda email: None)
    started = []
    monkeypatch.setattr(store, "start_chat", lambda parsed, message, email, usd=0, started_by=None: started.append(parsed) or 4)
    c = _client(ADMIN)
    r = c.post(BASE + "/api/chat", json={"message": "marketing people at Position2"})
    j = r.get_json()
    assert r.status_code == 200 and j["kind"] == "choose" and started == []
    assert [x["domain"] for x in j["needs"][0]["candidates"]][:2] == ["position2.com", "position2.in"]
    r = c.post(BASE + "/api/chat", json={"message": "marketing people at Position2",
                                         "resume": {"understood": j["understood"], "picks": {"Position2": "position2.com"}}})
    assert r.status_code == 202 and r.get_json()["run_id"] == 4
    assert started[0]["companies"] == [{"name": "Position2", "domain": "position2.com"}]
    assert started[0]["asks"][0]["label"] == "Marketing team"
    r = c.post(BASE + "/api/chat", json={"message": "x", "resume": {"understood": {"companies": [], "asks": []}, "picks": {}}})
    assert r.status_code == 400 and len(started) == 1


def test_saleshandy_failing_while_looking_a_company_up_is_said_not_hidden(monkeypatch):
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(store, "running_run", lambda email: None)
    monkeypatch.setattr(sh, "Client", lambda *a, **k: FakeSH([ACME], WORLD, fail=None))

    class Down(FakeSH):
        def search_companies(self, filters, **kw):
            raise sh.AuthError("the key was refused") if "company_name" in filters else sh.SaleshandyError("down")
    monkeypatch.setattr(sh, "Client", lambda *a, **k: Down([ACME], WORLD))
    r = _client(ADMIN).post(BASE + "/api/chat", json={"message": "CFO at Acme"})
    assert r.status_code == 400 and "refused" in r.get_json()["error"]


# == the run, on a real Postgres ===============================================================

from tests.test_market_radar_store import OWNER, OTHER, pg  # noqa: E402,F401  (fixture)


def test_a_chat_run_is_saved_free_and_works_with_the_reveal(pg, monkeypatch):
    monkeypatch.setattr(store, "_READY", False)
    parsed = read("marketing people at Acme")
    started = []
    run_id = store.start_chat(parsed, "marketing people at Acme", OWNER,
                              spawn=lambda target, args: started.append((target, args)))
    run = store.get_run(run_id, OWNER)
    assert run["status"] == "running" and run["settings"]["chat"]["message"] == "marketing people at Acme"
    assert run["settings"]["roles"] == ["Marketing team"] and run["cost_cap_usd"] == 0
    target, args = started[0]
    target(*args, client=fake())
    run = store.get_run(run_id, OWNER)
    assert run["status"] == "ready" and run["stage"] == "found" and run["error"] is None
    role = run["summary"]["companies"][0]["roles"][0]
    assert [p["name"] for p in role["picked"]] == ["Jane Doe", "Raj Patel", "Mia Chen"]
    assert run["summary"]["ranking"] == ["Acme"] and run["summary"]["cost"]["spent_usd"] == 0
    assert store.get_run(run_id, OTHER) is None                             # another owner never sees it
    listed = store.list_runs(OWNER)
    assert listed[0]["id"] == run_id and listed[0]["totals"]["people_picked"] == 3


def test_a_chat_run_that_fails_says_why(pg, monkeypatch):
    monkeypatch.setattr(store, "_READY", False)
    run_id = store.start_chat(read("CFO at Acme"), "CFO at Acme", OWNER, spawn=lambda t, a: None)

    class Broken(FakeSH):
        def credits(self):
            raise sh.AuthError("bad key")
    store.chat_job(run_id, read("CFO at Acme"), "CFO at Acme", client=Broken([ACME], WORLD))
    run = store.get_run(run_id, OWNER)
    assert run["status"] == "failed" and "bad key" in run["error"]
