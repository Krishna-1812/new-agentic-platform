"""The Warmly engine: a daily routine reads Warmly through its MCP server (the one connected to Claude) and
sends what it found to Lead Finder, which keeps it in the Warmly inbox for its next run.

The visitor and account rows below are the shapes Warmly's MCP server answered with on 2026-11-11, with
the people and company made up; the signal rows are the shape Warmly's help pages document for
list_third_party_signals. The routine's token rides in a header its network proxy adds, never in a URL,
a prompt or a file, and the credits it spends are booked against a monthly budget.
"""

import json
import os
import sys
from datetime import date

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tracker import buyer_radar_judge as judge  # noqa: E402
from tracker import buyer_radar_store as store  # noqa: E402
from tracker import buyer_radar_warmly as wm  # noqa: E402

TOKEN = "T" * 32


def company_profile(**kw):
    cp = {"id": "945f1175-b797-48b2-8678-8775cb6cd007", "logo": "https://brandbadge.clearbit.com/x", "name": "Lee Creative",
          "domain": "leecreative.co.uk", "geo_city": "Leeds", "geo_state": "West Yorkshire",
          "description": "A branding and web agency for consumer brands.", "geo_country": "United Kingdom",
          "geo_stateCode": "WYK", "linkedin_handle": "company/lee-creative", "category_industry": "Marketing and Advertising",
          "category_subIndustry": "Advertising Agencies", "metrics_employeesRange": "11-50",
          "metrics_estimatedAnnualRevenue": None}
    cp.update(kw)
    return cp


VISITOR = {
    "key": "sam@leecreative.co.uk", "email": "sam@leecreative.co.uk", "domain": "leecreative.co.uk", "hasEmail": True,
    "lastSeen": "2026-11-10T09:24:08.372Z", "utmParams": [], "identifier": "sam@leecreative.co.uk",
    "pageVisits": [{"url": "https://northaxis.outcomes.digital/partners/agencies?utm_source=li", "activeSeconds": 94},
                   {"url": "https://northaxis.outcomes.digital/partners", "activeSeconds": 12}],
    "crmAccounts": [], "phoneNumber": None, "sessionTime": 106, "crmProviders": [], "totalSessions": 2,
    "companyProfile": company_profile(),
    "contactProfile": {"id": "adbdb4a1-e5fa-4cff-86af-6130f594047b", "bio": None, "site": None, "email": "sam@leecreative.co.uk",
                       "fuzzy": False, "phone": None, "avatar": "https://brandbadge.clearbit.com/y", "fullName": "Sam Lee",
                       "geo_city": "Leeds", "lastName": "Lee", "location": None, "firstName": "Sam", "geo_state": None,
                       "clearbitId": None, "geo_country": "United Kingdom", "emailProvider": False, "linkedin_handle": "sam-lee-agency",
                       "isPersonalEmail": False, "employment_name": "Lee Creative", "employment_role": "marketing",
                       "employment_title": "Founder", "employment_domain": "leecreative.co.uk",
                       "employment_seniority": "owner", "enrichmentSource": "immagnify"},
    "distinctPagesVisited": 2,
}
ACCOUNT = {
    "key": "brightads.com.au", "domain": "brightads.com.au", "lastSeen": "2026-11-10T02:00:00.000Z", "utmParams": [],
    "pageVisits": [], "crmAccounts": [], "sessionTime": 0, "crmProviders": [], "visitorCount": 2, "totalSessions": 2,
    "companyProfile": company_profile(name="Bright Ads", domain="brightads.com.au", geo_city="Sydney", geo_country="Australia",
                                      linkedin_handle=None, description="A creative and social agency."),
    "clearbitCompanyId": "945f1175-b797-48b2-8678-8775cb6cd007", "identifiedVisitors": 0, "distinctPagesVisited": 0,
}
# Our own team, exactly as Warmly listed them: never a lead.
OURS = dict(VISITOR, email="kris@markifydigital.com", domain="markifydigital.com", pageVisits=[], sessionTime=0,
            companyProfile=company_profile(name="Markify Digital", domain="markifydigital.com"),
            contactProfile=dict(VISITOR["contactProfile"], email="kris@markifydigital.com", fullName=None, firstName=None,
                                lastName=None, linkedin_handle=None, employment_domain="markifydigital.com"))
JOB_CHANGE = {
    "signal_id": "sig_1", "signal_name": "Job change", "signal_type": "workmilestone", "signal_subtype": "jobChange",
    "association": "contact", "detected_at": "2026-11-09T08:00:00Z",
    "company": {"name": "Priya Growth Studio", "domain": "priyagrowth.co", "industries": ["Marketing Services"],
                "employee_count_low": 1, "employee_count_high": 10, "linkedin_url": "linkedin.com/company/priya-growth",
                "ticker": None, "description": "Independent paid media consulting."},
    "contact": {"name": "Priya Shah", "first_name": "Priya", "last_name": "Shah", "email": "priya@priyagrowth.co",
                "job_title": "Independent Paid Media Consultant", "seniority_level": "owner", "department": "marketing",
                "linkedin_url": "linkedin.com/in/priyashah", "city": "London", "state": None, "country": "United Kingdom"},
    "data": {"title": "Priya Shah started as Independent Paid Media Consultant at Priya Growth Studio", "confidence": 0.9,
             "sales_relevance": 0.7, "sentiment": "positive"},
}
FUNDING = {
    "signal_id": "sig_2", "signal_name": "Funding", "signal_type": "news", "signal_subtype": "fundingNews",
    "association": "company", "detected_at": "2026-11-08T10:00:00Z",
    "company": {"name": "Kora Beauty", "domain": "korabeauty.in", "industries": ["Cosmetics", "Retail"],
                "employee_count_low": 51, "employee_count_high": 200, "linkedin_url": "linkedin.com/company/kora"},
    "contact": None,
    "data": {"title": "Kora Beauty raises $4M to grow its D2C skincare brand", "url": "https://news.example.com/kora",
             "published_at": "2026-11-07"},
}
POST = {
    "signal_id": "sig_3", "signal_name": "LinkedIn post", "signal_type": "linkedin-post-contact",
    "signal_subtype": "linkedinPost", "association": "contact", "detected_at": "2026-11-09T12:00:00Z",
    "company": {"name": "Hill & Co Digital", "domain": "hillco.digital", "industries": ["Marketing and Advertising"],
                "employee_count_low": 11, "employee_count_high": 50},
    "contact": {"name": "Dan Hill", "first_name": "Dan", "last_name": "Hill", "job_title": "Managing Director",
                "linkedin_url": "https://www.linkedin.com/in/danhill/", "country": "United States"},
    "data": {"post_text": "We have more Google Ads work than hands. Anyone run white label PPC for agencies?",
             "post_url": "https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000000/", "posted_date": "2026-11-09"},
}


# == the connector's rows, read like the webhook's records ===============================================

def test_a_visitor_row_becomes_a_signal_with_the_person_their_company_and_the_pages():
    rec = wm.from_mcp("visitors", VISITOR)
    assert rec["Signal"] == "Website Visit" and rec["Business Email"] == "sam@leecreative.co.uk"
    assert rec["LinkedIn URL"] == "https://www.linkedin.com/in/sam-lee-agency/"
    assert rec["Company LinkedIn"] == "https://www.linkedin.com/company/lee-creative/"
    s = wm.normalize(rec, "2026-11-11T05:00:00Z")
    assert s["author"]["key"] == "in/sam-lee-agency" and s["author"]["headline"] == "Founder at Lee Creative"
    assert s["company"] == {"name": "Lee Creative", "domain": "leecreative.co.uk", "industry": "Marketing and Advertising",
                            "size": "11-50", "country": "United Kingdom"}
    assert [p["path"] for p in s["warmly"]["pages"]] == ["https://northaxis.outcomes.digital/partners/agencies",
                                                         "https://northaxis.outcomes.digital/partners"]
    assert "/partners/agencies (94s)" in s["text"] and "Time on our site: 106 seconds" in s["text"]
    assert s["warmly"]["type"] == "website" and s["posted_at"] == "2026-11-10T09:24:08.372Z"
    assert "avatar" not in json.dumps(rec) and "logo" not in json.dumps(rec), "pictures never go to Claude"
    assert wm.normalize(wm.from_mcp("visitors", VISITOR), "tomorrow")["key"] == s["key"], "pulled again, one signal"


def test_an_account_row_names_the_company_and_how_many_came():
    s = wm.normalize(wm.from_mcp("accounts", ACCOUNT), "2026-11-11T05:00:00Z")
    assert s["company"]["name"] == "Bright Ads" and s["company"]["domain"] == "brightads.com.au"
    assert s["author"]["company"] is True and s["contacts"] == [] and s["warmly"]["type"] == "website"
    assert "Visitors: 2" in s["text"] and "Time on our site" not in s["text"], "no time when Warmly saw none"


def test_our_own_team_as_warmly_lists_them_is_never_a_lead():
    assert wm.normalize(wm.from_mcp("visitors", OURS), "now") is None
    assert wm.normalize(wm.from_mcp("accounts", dict(ACCOUNT, domain="markifydigital.com",
                                                     companyProfile=company_profile(domain="markifydigital.com"))), "now") is None


def test_a_personal_address_never_makes_gmail_the_company():
    row = dict(VISITOR, email="sam.lee@gmail.com", domain=None, companyProfile=None,
               contactProfile=dict(VISITOR["contactProfile"], email="sam.lee@gmail.com", employment_domain=None,
                                   employment_name=None, isPersonalEmail=True))
    s = wm.normalize(wm.from_mcp("visitors", row), "now")
    assert s["company"]["domain"] == "" and s["contacts"][0]["email"] == "sam.lee@gmail.com"
    assert wm.normalize({"Signal": "Website Visit Contact", "Business Email": "a@yahoo.com"}, "now")["company"]["domain"] == ""


def test_a_job_change_signal_names_the_person_the_new_role_and_may_be_mentioned():
    rec = wm.from_mcp("signals", JOB_CHANGE)
    assert rec["Signal"] == "Job Change" and rec["Employee Count"] == "1-10" and rec["Industry"] == "Marketing Services"
    assert rec["LinkedIn URL"] == "https://linkedin.com/in/priyashah"
    s = wm.normalize(rec, "now")
    assert s["warmly"]["type"] == "job_change" and s["author"]["key"] == "in/priyashah"
    assert s["author"]["headline"] == "Independent Paid Media Consultant at Priya Growth Studio"
    assert "What Warmly found: Priya Shah started as Independent Paid Media Consultant" in s["text"]
    assert s["posted_at"] == "2026-11-09T08:00:00Z" and s["contacts"][0]["location"] == "London, United Kingdom"


def test_company_news_is_a_news_signal_with_its_headline():
    s = wm.normalize(wm.from_mcp("signals", FUNDING), "now")
    assert s["warmly"]["type"] == "news" and s["company"]["name"] == "Kora Beauty" and s["company"]["size"] == "51-200"
    assert "raises $4M" in s["text"] and "Source link: https://news.example.com/kora" in s["text"]
    assert s["contacts"] == [] and s["author"]["company"] is True
    assert "news" in judge.WARMLY_MAY_SAY and "Never say how" in judge.WARMLY_MAY_SAY["news"]


def test_a_linkedin_post_is_social_and_its_words_reach_claude():
    s = wm.normalize(wm.from_mcp("signals", POST), "now")
    assert s["warmly"]["type"] == "social" and s["author"]["key"] == "in/danhill"
    assert "more Google Ads work than hands" in s["text"] and "white label PPC" in s["text"]


@pytest.mark.parametrize("kind,sub,name,kind_of", [
    ("workmilestone", "promotion", "Promotion", "new_hire"),
    ("hiring-trends", "hiringMarketingRoles", "Hiring: marketing roles", "hiring"),
    ("news", "expands_offices_in", "News: expands offices in", "news"),
    ("linkedin-comment", "linkedinPostComment", "LinkedIn comment", "social"),
    ("website-traffic", "trafficDecline", "Website traffic estimate: traffic decline", "website"),
    ("g2-product-review", "PricingConcerns", "g2 product review: pricing concerns", "other"),
])
def test_every_signal_kind_has_a_name_and_a_type_that_decides_what_a_message_may_say(kind, sub, name, kind_of):
    assert wm.signal_name(kind, sub) == name and wm.signal_type(name) == kind_of
    assert kind_of in judge.WARMLY_MAY_SAY


def test_a_row_of_a_kind_the_engine_does_not_read_is_left_out():
    assert wm.from_mcp("chats", {"email": "a@b.com"}) is None and wm.from_mcp("visitors", "nope") is None


def test_linkedin_addresses_come_out_whole_from_every_form_warmly_uses():
    assert wm.linkedin_url("sam") == "https://www.linkedin.com/in/sam/"
    assert wm.linkedin_url("in/sam/") == "https://www.linkedin.com/in/sam/"
    assert wm.linkedin_url("acme", "company") == "https://www.linkedin.com/company/acme/"
    assert wm.linkedin_url("linkedin.com/company/acme") == "https://linkedin.com/company/acme"
    assert wm.linkedin_url("https://www.linkedin.com/in/sam/") == "https://www.linkedin.com/in/sam/"
    assert wm.linkedin_url(None) == "" and wm.linkedin_url("") == ""


# == the monthly budget ==================================================================================

def test_the_months_credits_are_shared_evenly_over_the_days_left():
    assert wm.allowance(0, 1000, date(2026, 11, 1)) == 34, "1,000 over 30 days, rounded up"
    assert wm.allowance(0, 1000, date(2026, 11, 30)) == 1000, "the last day may spend what is left"
    assert wm.allowance(900, 1000, date(2026, 11, 21)) == 10
    assert wm.allowance(1000, 1000, date(2026, 11, 2)) == 0 and wm.allowance(1200, 1000, date(2026, 11, 2)) == 0


def test_the_budget_is_1000_unless_the_service_says_otherwise(monkeypatch):
    monkeypatch.delenv("WARMLY_ENGINE_CREDITS", raising=False)
    assert wm.engine_budget() == 1000
    monkeypatch.setenv("WARMLY_ENGINE_CREDITS", "400")
    assert wm.engine_budget() == 400
    monkeypatch.setenv("WARMLY_ENGINE_CREDITS", "lots")
    assert wm.engine_budget() == 1000
    monkeypatch.setenv("WARMLY_ENGINE_CREDITS", "999999")
    assert wm.engine_budget() == 5000


# == the push ============================================================================================

@pytest.fixture
def pushed(monkeypatch):
    got = {"rows": [], "spend": [], "used": 0.0}
    monkeypatch.setattr(store, "owner_of_warmly_token", lambda token: "acct:7" if token == TOKEN else None)
    monkeypatch.setattr(store, "warmly_credits_month", lambda owner: got["used"])
    monkeypatch.setattr(store, "warmly_counts", lambda owner: {"waiting": len(got["rows"]), "week": len(got["rows"]), "last": None})

    def add(owner, signal, payload):
        if any(k == signal["key"] for _, k, _ in got["rows"]):
            return False
        got["rows"].append((owner, signal["key"], payload))
        return True

    def spend(run_id, owner, by, provider, op, usd=0, credits=0):
        got["spend"].append((run_id, owner, by, provider, op, usd, credits))
    monkeypatch.setattr(store, "warmly_add", add)
    monkeypatch.setattr(store, "add_spend", spend)
    monkeypatch.delenv("WARMLY_ENGINE_CREDITS", raising=False)
    return got


def _client():
    import app as appmod
    return appmod.app.test_client()


def test_the_routine_reads_its_budget_with_its_token_in_a_header(pushed):
    c = _client()
    r = c.get("/api/lead-finder/warmly-push", headers={wm.PUSH_HEADER: TOKEN})
    body = r.get_json()
    assert r.status_code == 200 and body["budget"] == 1000 and body["used"] == 0 and body["today"] > 0
    assert body["inbox"] == {"waiting": 0, "week": 0, "last": None}
    assert c.get("/api/lead-finder/warmly-push").status_code == 404, "no token, no answer"
    assert c.get("/api/lead-finder/warmly-push", headers={wm.PUSH_HEADER: "X" * 32}).status_code == 404
    assert c.get("/api/lead-finder/warmly-push?token=" + TOKEN).status_code == 404, "never in the address"


def test_the_routine_pushes_what_warmly_found_and_the_inbox_keeps_it_once(pushed):
    c = _client()
    body = {"batches": [{"kind": "visitors", "rows": [VISITOR, OURS]}, {"kind": "accounts", "rows": [ACCOUNT]},
                        {"kind": "signals", "rows": [JOB_CHANGE, FUNDING, POST]}], "credits": 7}
    r = c.post("/api/lead-finder/warmly-push", json=body, headers={wm.PUSH_HEADER: TOKEN})
    out = r.get_json()
    assert r.status_code == 200 and out["kept"] == 5
    assert out["kinds"] == {"visitors": {"kept": 1, "skipped": 1, "repeats": 0}, "accounts": {"kept": 1, "skipped": 0, "repeats": 0},
                            "signals": {"kept": 3, "skipped": 0, "repeats": 0}}
    assert out["used"] == 7 and out["budget"] == 1000
    assert pushed["spend"] == [(None, "acct:7", "warmly-routine", "warmly", "signals", 0, 7.0)]
    assert all(o == "acct:7" for o, _, _ in pushed["rows"])
    assert pushed["rows"][0][2]["Signal"] == "Website Visit", "the inbox keeps the record the run reads"
    again = c.post("/api/lead-finder/warmly-push", json=dict(body, credits=0), headers={wm.PUSH_HEADER: TOKEN}).get_json()
    assert again["kept"] == 0 and again["kinds"]["signals"]["repeats"] == 3 and len(pushed["spend"]) == 1, \
        "the same rows again are repeats, and nothing is booked"


def test_a_push_that_is_not_what_the_routine_sends_is_refused(pushed):
    c = _client()
    h = {wm.PUSH_HEADER: TOKEN}
    assert c.post("/api/lead-finder/warmly-push", json={"rows": [VISITOR]}, headers=h).status_code == 400
    assert c.post("/api/lead-finder/warmly-push", json={"batches": [{"kind": "chats", "rows": []}]}, headers=h).status_code == 400
    assert c.post("/api/lead-finder/warmly-push", json={"batches": [], "credits": -1}, headers=h).status_code == 400
    assert c.post("/api/lead-finder/warmly-push", json={"batches": [], "credits": "x"}, headers=h).status_code == 400
    assert c.post("/api/lead-finder/warmly-push", json={"batches": [{"kind": "visitors", "rows": [VISITOR]}]}).status_code == 404
    assert pushed["rows"] == [] and pushed["spend"] == []


def test_one_push_carries_at_most_500_rows(pushed):
    rows = [dict(ACCOUNT, domain="agency%d.com" % i, companyProfile=company_profile(name="Agency %d" % i, domain="agency%d.com" % i))
            for i in range(wm.MAX_ROWS + 3)]
    out = _client().post("/api/lead-finder/warmly-push", json={"batches": [{"kind": "accounts", "rows": rows}]},
                         headers={wm.PUSH_HEADER: TOKEN}).get_json()
    assert out["kept"] == wm.MAX_ROWS and out["kinds"]["accounts"]["skipped"] == 3


def test_the_admin_panel_counts_warmly_credits_apart_from_saleshandys():
    from tracker import admin_spend as spend
    sql = {s[0]: s[3] for s in spend.SOURCES}
    assert "provider = 'warmly'" in sql["buyer-radar-warmly"] and "provider <> 'warmly'" in sql["buyer-radar-emails"]
    assert spend.UNITS["buyer-radar-warmly"] == "credits" and spend.LABELS["buyer-radar-warmly"] == "Lead Finder (Warmly)"


# == the Outcomes Digital offer ==========================================================================

def test_outcomes_digital_is_an_offer_that_claims_only_what_its_site_says():
    import outcomes_content as od
    from tracker import buyer_radar as br
    o = br.OFFERS["outcomes"]
    assert o["label"] == "Outcomes Digital" and o["site"] == "https://outcomes.digital"
    for fig, _ in od.PROOF_STATS[:3]:
        assert fig in o["sells"], fig
    for word in ("eCommerce", "schools, colleges and universities", "real estate developers"):
        assert word in o["sells"], word
    for outcome in od.INDUSTRY_OUTCOME.values():
        assert outcome.lower() in o["sells"].lower(), outcome
    assert "agencies and freelancers selling the same are not" in o["buyers"]
    assert br.clean_settings({"offers": ["markify", "outcomes", "agency_partners", "consultant_partners"]})["offers"] == \
        ["markify", "outcomes", "agency_partners", "consultant_partners"]


def test_outcomes_digital_has_its_own_profiles_and_reddit_searches():
    from tracker import buyer_radar_icp as icp, buyer_radar_reddit as reddit
    rows = icp.icps_for({}, "outcomes")
    assert [r["name"] for r in rows] == ["Founders and growth heads of D2C brands",
                                         "Admissions and marketing heads at schools and colleges",
                                         "Marketing and sales heads at real estate developers"]
    assert all("India" in r["locations"] for r in rows)
    assert reddit.queries_for({}, "outcomes")


def test_the_judge_sees_outcomes_digital_when_the_workspace_has_it_on():
    from tracker import buyer_radar as br
    offers = {k: br.OFFERS[k] for k in ("markify", "outcomes")}
    sent = judge._offers_text(offers)
    assert "OFFER outcomes: Outcomes Digital" in sent and "admissions" in sent and "OFFER markify:" in sent
