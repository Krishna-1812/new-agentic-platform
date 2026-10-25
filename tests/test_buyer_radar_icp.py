"""Buyer Radar's customer profiles (tracker/buyer_radar_icp.py) and Saleshandy sequences (2026-10-21).

What is held here:
  * a profile: checked, its triggers turned into Saleshandy's own filters (a new role, funding, executive
    hires, growth, a product used, jobs advertised), the defaults all valid;
  * finding people: free searches only, each person once across profiles, best first, and a refusal said;
  * the run: people kept as leads that fit a profile, never the same person twice, at most the run's
    number, and the strong ones sent to a sequence where Settings says;
  * a sequence: the same opt-outs, nobody twice and daily caps as an email, the message carried in a field
    when Settings names one, a credit spent only on a yes;
  * Claude's suggested profiles: checked as typed ones are, only after a yes, the cost recorded;
  * the page: the profile editor, the sequence picker and the drawer, with hostile strings.
"""
import json
import os
import sys
from decimal import Decimal

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests.test_buyer_radar import (BASE, EVIL, H, STAFF, XA, FakeStore, SendStore, T, _client, deps,  # noqa: E402
                                    mem, run_js, seeded, world)  # noqa: F401  (fixtures)
from tracker import buyer_radar as br  # noqa: E402
from tracker import buyer_radar_icp as icp  # noqa: E402
from tracker import buyer_radar_judge as judge  # noqa: E402
from tracker import buyer_radar_send as send  # noqa: E402
from tracker import buyer_radar_store as store  # noqa: E402
from tracker import contact_lab_search as cls  # noqa: E402
from tracker import saleshandy_client as sh  # noqa: E402


def profile(**kw):
    raw = {"name": "New marketing leaders", "trigger": "new_in_role", "months": 2, "titles": ["CMO", "VP Marketing"],
           "levels": ["C-Level", "President/Vice President"], "departments": ["Marketing"], "size_min": 11, "size_max": 500}
    raw.update(kw)
    return icp.clean_icp(raw)


def person(i, title="VP Marketing", company="Acme", department="Marketing", **kw):
    p = {"id": i, "name": "Meera Shah%d" % i, "title": title, "company": company, "department": department,
         "location": "Mumbai, India", "domain": "acme.com", "decision_maker": True}
    p.update(kw)
    return p


# == a profile =============================================================================================

def test_every_default_profile_is_valid_and_searchable():
    for offer, rows in icp.DEFAULT_ICPS.items():
        assert offer in br.OFFERS and 1 <= len(rows) <= icp.MAX_ICPS
        for row in rows:
            got = icp.clean_icp(row)
            assert got["trigger"] in icp.TRIGGERS and icp.people_filters(got)
    assert {x["trigger"] for rows in icp.DEFAULT_ICPS.values() for x in rows} >= {"new_in_role", "recently_funded", "uses_tech",
                                                                               "hiring_for"}


def test_a_profile_is_checked_and_tidied():
    got = icp.clean_icp({"name": "  Founders   that raised ", "trigger": "bogus", "titles": "CEO, Founder, CEO,  ",
                         "levels": ["Founder", "Emperor"], "size_min": "500", "size_max": "10", "months": 40, "on": False})
    assert got["name"] == "Founders that raised" and got["trigger"] == "none" and got["titles"] == ["CEO", "Founder"]
    assert got["levels"] == ["Founder"] and (got["size_min"], got["size_max"]) == (10, 500) and got["months"] == 12
    assert got["on"] is False
    for bad in ({"titles": ["x"]}, {"name": "x"}, {"name": "x", "titles": ["y"], "trigger": "uses_tech"},
                {"name": "x", "titles": ["y"], "trigger": "hiring_for"}):
        with pytest.raises(ValueError):
            icp.clean_icp(bad)


def test_each_trigger_is_saleshandys_own_filter():
    new = icp.people_filters(profile(industries=["Software"], locations=["India"], keywords=["SaaS"]))
    assert new == {"job_title": {"includes": ["CMO", "VP Marketing"], "exactMatch": 0},
                   "management_level": {"includes": ["C-Level", "President/Vice President"]},
                   "department": {"includes": ["Marketing"]}, "company_industry": {"includes": ["Software"]},
                   "location": {"includes": ["India"], "exactMatch": 0}, "keywords": {"includes": ["SaaS"]},
                   "company_size": {"min": "11", "max": "500"}, "jobs_changed_within": {"min": "0", "max": "2"}}
    assert icp.company_filters(profile()) is None, "a new role is the person's, searched among people"
    funded = icp.company_filters(profile(trigger="recently_funded", locations=["India"]))
    assert funded == {"signalIds": [2, 5], "company_hq_location": {"includes": ["India"], "exactMatch": 0},
                      "company_size": {"min": "11", "max": "500"}}
    assert icp.company_filters(profile(trigger="gtm_hires"))["signalIds"] == [3]
    assert icp.company_filters(profile(trigger="rapid_growth"))["signalIds"] == [1]
    assert icp.company_filters(profile(trigger="uses_tech", technologies=["Gong"]))["technologies_used"] == {"includes": ["Gong"]}
    assert icp.company_filters(profile(trigger="hiring_for", hiring=["SEO"]))["active_job_postings_title"] == {"includes": ["SEO"]}
    at = icp.people_filters(profile(trigger="uses_tech", technologies=["Gong"]), company={"name": "Acme", "domain": "acme.com"})
    assert at["company_domain"] == {"includes": ["acme.com"]} and "company_size" not in at and "jobs_changed_within" not in at
    assert icp.people_filters(profile(), company={"name": "Acme"})["company_name"] == {"includes": ["Acme"]}


def test_someone_who_decides_with_a_reason_to_buy_now_scores_highest():
    new = profile()
    assert icp.score(new, person(1)) > icp.score(icp.clean_icp(dict(new, trigger="none")), person(1))
    assert icp.score(new, person(1)) > icp.score(new, person(2, title="Marketing Executive", decision_maker=False, department="Sales"))
    assert all(0 <= icp.score(new, person(i)) <= 95 for i in range(3))


def test_a_person_found_reads_as_a_lead_with_why_now():
    s = icp.signal(profile(), "markify", person(7))
    assert s["key"] == "icp:7" and s["kind"] == "icp" and s["author"]["key"] == "sh/7" and s["url"] == ""
    assert s["text"] == "Meera Shah7, VP Marketing at Acme. Fits the customer profile “New marketing leaders”: " \
                        "started in their role in the last 2 months."
    assert s["icp"] == {"name": "New marketing leaders", "trigger": "new_in_role", "why": "started in their role in the last 2 months",
                        "offer": "markify"}
    assert s["contacts"][0]["key"] == "sh/7"
    tech = icp.signal(profile(trigger="uses_tech", technologies=["Gong", "Chorus"]), "callvibe", person(8), {"name": "Acme"})
    assert tech["icp"]["why"] == "their company uses Gong or Chorus"


# == finding people ========================================================================================

class SH:
    """saleshandy_client.Client's free searches."""

    def __init__(self, people=(), companies=(), at=None, fail=None):
        self.people, self.companies, self.at, self.fail, self.asked = list(people), list(companies), at or {}, fail, []

    def search_people(self, filters, page=1):
        self.asked.append(("people", filters, page))
        if self.fail:
            raise self.fail
        if "company_name" in filters or "company_domain" in filters:
            key = (filters.get("company_domain") or filters.get("company_name"))["includes"][0]
            return {"people": self.at.get(key, []), "has_next": False}
        per = 2
        return {"people": self.people[(page - 1) * per: page * per], "has_next": page * per < len(self.people)}

    def search_companies(self, filters, page=1):
        self.asked.append(("companies", filters, page))
        return {"companies": self.companies if page == 1 else [], "has_next": False}


def test_people_are_found_free_once_each_and_best_first():
    c = SH(people=[person(1, title="Marketing Manager", decision_maker=False), person(2), person(3), person(2)])
    found, notes = icp.find([("markify", profile()), ("markify", profile(name="Again"))], client=c, per_icp=1)
    assert [f[2]["key"] for f in found] == ["icp:2", "icp:1"], \
        "each keeps its best; one the first passed over may go to the second, never one it kept"
    assert found[0][3] >= found[1][3] and notes == []
    assert [a[2] for a in c.asked] == [1, 1]
    c = SH(people=[person(2), person(1, title="Marketing Manager", decision_maker=False), person(3)])
    found, _ = icp.find([("markify", profile()), ("markify", profile(name="Again"))], client=c, per_icp=2)
    assert [f[2]["key"] for f in found] == ["icp:2", "icp:1", "icp:3"] and [a[2] for a in c.asked] == [1, 1, 2], \
        "the second reads on past the people the first kept"


def test_the_search_reads_on_past_people_met_on_earlier_days():
    c = SH(people=[person(i) for i in range(1, 9)])
    found, notes = icp.find([("markify", profile())], client=c, per_icp=2, known=lambda keys: {k for k in keys if k < "icp:6"})
    assert sorted(f[2]["key"] for f in found) == ["icp:6", "icp:7"] and [a[2] for a in c.asked] == [1, 2, 3, 4]
    c = SH(people=[person(i) for i in range(1, 30)])
    icp.find([("markify", profile())], client=c, per_icp=2, known=lambda keys: set(keys))
    assert len(c.asked) == icp.MAX_PAGES, "never more than a few pages"


def test_a_company_trigger_finds_the_companies_then_who_decides_inside():
    acme, beta = {"name": "Acme", "domain": "acme.com"}, {"name": "Beta", "domain": None}
    c = SH(companies=[acme, beta], at={"acme.com": [person(1), person(2), person(3)], "Beta": [person(4, company="Beta")]})
    found, notes = icp.find([("markify", profile(trigger="recently_funded"))], client=c)
    assert [f[2]["key"] for f in found] == ["icp:1", "icp:2", "icp:4"], "two a company at most"
    assert found[0][2]["icp"]["why"] == "their company raised money recently" and found[2][2]["company"]["name"] == "Beta"
    assert c.asked[0] == ("companies", {"signalIds": [2, 5], "company_size": {"min": "11", "max": "500"}}, 1)
    found, notes = icp.find([("markify", profile(trigger="gtm_hires"))], client=SH())
    assert found == [] and "found no companies" in notes[0]


def test_saleshandy_saying_no_is_noted_and_a_bad_key_stops_the_rest():
    found, notes = icp.find([("markify", profile()), ("callvibe", profile(name="B"))], client=SH(fail=sh.SaleshandyError("boom")))
    assert found == [] and len(notes) == 2 and "boom" in notes[0]
    found, notes = icp.find([("markify", profile()), ("callvibe", profile(name="B"))], client=SH(fail=sh.AuthError("bad key")))
    assert len(notes) == 1, "the same key would fail every profile"
    off = profile(on=False)
    c = SH(people=[person(1)])
    assert icp.find([("markify", off)], client=c) == ([], []) and c.asked == []


class RateSH(SH):
    """Saleshandy's searches, refusing as scripted: `refuse(profile call number) -> bool`."""

    def __init__(self, refuse, **kw):
        super().__init__(**kw)
        self.refuse, self.calls = refuse, 0

    def search_people(self, filters, page=1):
        self.calls += 1
        if self.refuse(self.calls):
            self.asked.append(("refused", filters, page))
            raise sh.RateLimited("Saleshandy's rate limit was hit; try again in a minute", status=429)
        return super().search_people(filters, page=page)


def test_a_profile_saleshandy_slowed_down_is_waited_for_and_searched_again():
    naps, pages = [], {}
    c = RateSH(lambda n: n == 1, people=[person(1), person(2)])
    found, notes = icp.find([("markify", profile())], client=c, per_icp=2, sleep=naps.append,
                            cursor=(lambda key: 1, lambda key, page: pages.__setitem__(key, page)))
    assert sorted(f[2]["key"] for f in found) == ["icp:1", "icp:2"]
    assert notes == [] and naps == [icp.RATE_WAIT_S] == [60]
    assert [a[0] for a in c.asked[:2]] == ["refused", "people"] and c.asked[0][2] == c.asked[1][2] == 1, \
        "the same page again, not the next"
    assert list(pages.values()) == [1], "and where it stopped is saved once, after it worked"


def test_a_profile_still_refused_after_the_wait_is_noted_and_the_others_go_on():
    naps = []
    c = RateSH(lambda n: n in (1, 2), people=[person(1), person(2)])
    found, notes = icp.find([("markify", profile(name="Gong or Chorus")), ("callvibe", profile(name="B"))], client=c,
                            per_icp=2, sleep=naps.append)
    assert len(notes) == 1 and notes[0].startswith("Saleshandy stopped at “Gong or Chorus”") and "rate limit" in notes[0]
    assert sorted(f[2]["key"] for f in found) == ["icp:1", "icp:2"] and all(f[0] == "callvibe" for f in found), "B was searched"
    assert naps == [icp.RATE_WAIT_S]


def test_saleshandy_refusing_profile_after_profile_stops_the_rest_for_this_search():
    naps = []
    c = RateSH(lambda n: True, people=[person(1)])
    found, notes = icp.find([("markify", profile(name=n)) for n in ("A", "B", "C", "D")], client=c, sleep=naps.append)
    assert found == [] and len(notes) == icp.RATE_GIVE_UP + 1 and "still rate limiting" in notes[-1] and "“B”" in notes[-1]
    assert c.calls == 2 * (icp.RATE_RETRIES + 1), "A and B, each twice; C and D not asked"
    assert naps == [icp.RATE_WAIT_S] * 2
    c = RateSH(lambda n: n in (1, 2), people=[person(1)])
    found, notes = icp.find([("markify", profile(name=n)) for n in ("A", "B", "C")], client=c, sleep=lambda s: None)
    assert [f[0] for f in found] and not any("still rate limiting" in n for n in notes), "a good profile resets the count"


# == the run ================================================================================================

def test_a_run_keeps_people_who_fit_a_profile_each_once_and_no_more_than_asked(monkeypatch):
    fake = FakeStore(known={"icp:9"})
    fake.install(monkeypatch)
    out = {}
    d, _ = deps([], out)
    a, b = profile(), profile(name="Funded founders", trigger="recently_funded")
    rows = [("markify", a, icp.signal(a, "markify", person(i)), 80 - i) for i in (1, 2, 3, 9)]
    rows += [("markify", b, icp.signal(b, "markify", person(i)), 40) for i in (5,)]
    seen = {}
    d.update(icp=lambda pairs, per_icp, known, cursor: seen.update(pairs=len(pairs), per=per_icp, met=known(["icp:9", "icp:1"])) or
             (rows, ["a note"]))
    s = br.merged({"sources": ["icp"], "icp_per_run": 2,
                   "icps": {"markify": [a, b], "callvibe": []}})
    summary = br.run(1, "acct:7", s, started_by="mia@x.com", deps=d)
    assert seen == {"pairs": 2, "per": 3, "met": {"icp:9"}}, "2 wanted, asked half again over the 2 profiles, 3 at least"
    kept = sorted(fake.leads.values(), key=lambda x: -x["score"])
    assert [x["post"]["key"] for x in kept] == ["icp:1", "icp:2"], "the best 2; one already met skipped; under 50 not kept"
    assert kept[0]["source"] == "icp" and kept[0]["person"] == "sh/1" and kept[0]["verdict"]["intent"] == "fits_profile"
    assert kept[0]["verdict"]["need"] == "Started in their role in the last 2 months" and kept[0]["draft"]
    assert summary["by_source"] == {"icp": 2} and summary["people"] == 2 and "a note" in summary["notes"]
    assert "icp:5" in fake.seen and "icp:3" not in fake.seen, \
        "one under the score is not looked at again; one not needed today is left for another day"


def test_strong_leads_go_to_their_offers_sequence_and_the_rest_by_email(monkeypatch):
    fake = FakeStore()
    fake.install(monkeypatch)
    out = {}
    d, posts = deps([92, 91], out)
    d["judge"] = lambda items, offers, budget, model, **kw: {
        p["key"]: dict(judge.clean_verdict({"role": "buyer", "offer": "callvibe" if i == 0 else "markify", "intent": "seeking_vendor",
                                             "score": 92 - i}, br.OFFERS)) for i, p in enumerate(items)}
    s = br.merged({"sources": ["posts"], "auto_sequence": True, "auto_email": True, "comment_posts": 0,
                   "sequences": {"callvibe": {"id": "S1", "step_id": "P1", "title": "CallVibe intro"}}})
    summary = br.run(1, "acct:7", s, deps=d)
    by_offer = {x["offer"]: i for i, x in fake.leads.items()}
    assert out["sequenced"] == [by_offer["callvibe"]] and summary["sequenced"] == 1
    assert out.get("emailed") == [] or by_offer["callvibe"] not in out.get("emailed", []), "nobody sent twice"
    assert fake.updates.count("adding to Saleshandy") == 1


# == a Saleshandy sequence ===================================================================================

class SeqClient:
    def __init__(self, fail=None):
        self.calls, self.fail = [], fail

    def import_to_sequence(self, step_id, prospects, tags=()):
        if self.fail:
            raise self.fail
        self.calls.append(("import", step_id, prospects, list(tags)))
        return "req1"

    def add_leads_to_sequence(self, sequence_id, step_id, lead_ids, tags=()):
        self.calls.append(("leads", sequence_id, step_id, lead_ids, list(tags)))
        return "1 Lead(s) will be added to Sequence."


SEQ = br.merged({"sequences": {"markify": {"id": "S1", "step_id": "P1", "title": "Markify intro"}}, "sequence_field": "BR message"})


def lead_for(**kw):
    sig = icp.signal(profile(), "markify", person(7))
    out = {"id": 3, "offer": "markify", "post": sig, "person": "sh/7", "email": "meera@acme.com", "score": 80,
           "draft": {"subject": "s", "email": "Hi Meera,\n\nCongrats on the new role.", "note": "n", "message": "m"},
           "verdict": {"need": "x", "company": "Acme"}}
    out.update(kw)
    return out


def test_a_lead_with_an_email_is_imported_with_the_message_in_its_field(monkeypatch):
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    st, c = SendStore(), SeqClient()
    got = send.sequence_lead("o", lead_for(), SEQ, by="mia@x.com", client=c, store=st)
    assert got == {"ok": True, "detail": "added to the Saleshandy sequence “Markify intro”", "stop": False}
    assert c.calls == [("import", "P1", [{"First Name": "Meera", "Last Name": "Shah7", "Email": "meera@acme.com",
                                          "Company": "Acme", "Job Title": "VP Marketing",
                                          "BR message": "Hi Meera,\n\nCongrats on the new role."}], ["Buyer Radar", "Markify Digital"])]
    assert st.records == [("o", 3, "email", "meera@acme.com", "sh/7", "sent", got["detail"], "mia@x.com")], \
        "counted as an email: nobody is written to twice"


def test_without_an_email_saleshandy_adds_them_only_on_a_yes(monkeypatch):
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    st, c = SendStore(), SeqClient()
    got = send.sequence_lead("o", lead_for(email=None), SEQ, client=c, store=st)
    assert not got["ok"] and "no email address" in got["detail"] and c.calls == []
    got = send.sequence_lead("o", lead_for(email=None), SEQ, client=c, store=st, reveal=True)
    assert got["ok"] and c.calls == [("leads", "S1", "P1", ["7"], ["Buyer Radar", "Markify Digital"])]
    got = send.sequence_lead("o", lead_for(email=None), dict(SEQ, find_emails=True), auto=True, client=SeqClient(), store=SendStore())
    assert got["ok"], "the automatic send may when Find work emails is on"


@pytest.mark.parametrize("lead_kw, store_kw, settings, why, stop", [
    ({"offer": "callvibe"}, {}, SEQ, "no Saleshandy sequence is chosen for CallVibe", False),
    ({}, {"suppressed": {"meera@acme.com"}}, SEQ, "asked not to be contacted", False),
    ({}, {"contacted": True}, SEQ, "already been contacted by email", False),
    ({}, {"today": 20}, SEQ, "automatic limit of 20", True),
])
def test_a_sequence_keeps_every_rule_an_email_keeps(monkeypatch, lead_kw, store_kw, settings, why, stop):
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    c = SeqClient()
    got = send.sequence_lead("o", lead_for(**lead_kw), settings, auto=True, client=c, store=SendStore(**store_kw))
    assert not got["ok"] and why in got["detail"] and got["stop"] is stop and c.calls == []


def test_sending_switched_off_or_saleshandy_refusing_stops_and_is_recorded(monkeypatch):
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    monkeypatch.setenv("BUYER_RADAR_SEND", "off")
    assert send.sequence_lead("o", lead_for(), SEQ, client=SeqClient(), store=SendStore())["stop"] is True
    monkeypatch.delenv("BUYER_RADAR_SEND")
    st = SendStore()
    got = send.sequence_lead("o", lead_for(), SEQ, client=SeqClient(fail=sh.AuthError("bad key")), store=st)
    assert not got["ok"] and got["stop"] is True and st.records[-1][5] == "failed"


class Resp:
    def __init__(self, payload, status=200):
        self.status_code, self._p, self.headers = status, payload, {}

    def json(self):
        return self._p


class Session:
    def __init__(self, payload):
        self.payload, self.sent = payload, []

    def request(self, method, url, json=None, timeout=None, headers=None):
        self.sent.append((method, url, json))
        return Resp(self.payload)


def test_the_sequence_calls_are_saleshandys_documented_routes():
    s = Session({"message": "ok", "payload": [{"id": "S1", "title": "Intro", "active": True, "steps": [{"id": "P1", "name": "Step 1"}]},
                                              {"title": "no id"}]})
    c = sh.Client("k", session=s, sleep=lambda x: None)
    assert c.sequences() == [{"id": "S1", "title": "Intro", "active": True, "steps": [{"id": "P1", "name": "Step 1"}]}]
    s.payload = {"payload": {"requestId": "r9"}}
    assert c.import_to_sequence("P1", [{"Email": "a@b.co"}], tags=["Buyer Radar"]) == "r9"
    s.payload = {"payload": {"message": "1 Lead(s) will be added to Sequence."}}
    assert "1 Lead" in c.add_leads_to_sequence("S1", "P1", [7], tags=["Buyer Radar"])
    assert s.sent[0][:2] == ("GET", sh.BASE_URL + "/sequences")
    assert s.sent[1] == ("POST", sh.BASE_URL + "/sequences/prospects/import-with-field-name",
                         {"prospectList": [{"Email": "a@b.co"}], "stepId": "P1", "conflictAction": "noUpdate", "tags": ["Buyer Radar"]})
    assert s.sent[2] == ("POST", sh.BASE_URL + "/leads/bulk-actions/add-to-sequence",
                         {"leadIds": [7], "sequenceId": "S1", "stepId": "P1", "newTags": ["Buyer Radar"]})


# == Claude writes to them, and suggests profiles ==============================================================

def test_the_message_to_a_profile_lead_is_a_cold_one_that_names_the_moment():
    seen = []

    def call(budget, stage, model, system, user, schema, max_tokens):
        seen.append((system, user))
        return {"subject": "s", "email": "e", "note": "n", "message": "m"}
    judge.draft(lead_for(), br.OFFERS["markify"], {}, budget=cls.Budget(1), call=call)
    system, user = seen[0]
    assert "WHY THEM: they fit the customer profile “New marketing leaders”; started in their role" in user
    assert "They have not asked for anything" in user and user.endswith("greet them by: Meera")
    assert "never pretending they posted or asked" in system


def test_claudes_profiles_are_checked_as_typed_ones_are():
    def call(budget, stage, model, system, user, schema, max_tokens):
        assert stage == "icp-suggest" and "WHO BUYS IT" in user and "Indian D2C" in user
        assert schema["properties"]["icps"]["items"]["properties"]["trigger"]["enum"] == list(icp.TRIGGERS)
        return {"icps": [dict(profile(), name="Good"), {"name": "No people", "trigger": "none"},
                         dict(profile(), name="Rival users", trigger="uses_tech", technologies=[])]}
    got = icp.suggest(br.OFFERS["markify"], "We sell to Indian D2C brands", budget=cls.Budget(1), model="m", call=call)
    assert [x["name"] for x in got] == ["Good"], "a profile that could not be searched is dropped"


# == the routes ==============================================================================================

def test_profiles_and_sequences_are_saved_with_the_settings(mem):
    c = _client(STAFF)
    body = {"icps": {"markify": [dict(profile(), name=EVIL)], "callvibe": None}, "icp_per_run": 20, "auto_sequence": True,
            "sequences": {"markify": {"id": "S1", "step_id": "P1", "title": "Intro"}, "callvibe": {"id": "", "step_id": "x"}},
            "sequence_field": "  BR   message "}
    r = c.post(BASE + "/api/settings", json=body, headers=H)
    assert r.status_code == 200
    s = r.get_json()["settings"]
    assert s["icps"]["markify"][0]["name"] == EVIL[:80] and "callvibe" not in s["icps"], "None goes back to the defaults"
    assert s["sequences"] == {"markify": {"id": "S1", "step_id": "P1", "title": "Intro"}} and s["sequence_field"] == "BR message"
    st = c.get(BASE + "/api/status").get_json()
    assert st["icps"]["callvibe"] == [icp.clean_icp(x) for x in icp.DEFAULT_ICPS["callvibe"]]
    assert st["triggers"] == icp.TRIGGERS and st["estimate"]["people"] == 20
    r = c.post(BASE + "/api/settings", json={"icps": {"markify": [{"name": "x"}]}}, headers=H)
    assert r.status_code == 400 and "titles" in r.get_json()["error"]


def test_the_sequence_routes_are_the_teams_and_need_a_yes(mem, monkeypatch):
    c = _client(STAFF)
    monkeypatch.delenv("SALESHANDY_API_KEY", raising=False)
    assert "SALESHANDY_API_KEY" in c.get(BASE + "/api/sequences").get_json()["error"]
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    monkeypatch.setattr(sh.Client, "sequences", lambda self: [{"id": "S1", "title": "Intro", "active": True, "steps": []}])
    assert c.get(BASE + "/api/sequences").get_json()["sequences"][0]["id"] == "S1"
    assert c.post(BASE + "/api/leads/7/sequence", json={}, headers=H).status_code == 400
    got = []
    monkeypatch.setattr(send, "sequence_lead", lambda owner, lead, settings, by, auto, reveal: got.append((lead["id"], by, auto, reveal))
                        or {"ok": True, "detail": "added to the Saleshandy sequence “Intro”"})
    r = c.post(BASE + "/api/leads/7/sequence", json={"confirm": True, "reveal": True}, headers=H)
    assert r.get_json()["ok"] and got == [(7, STAFF, False, True)]
    assert c.post(BASE + "/api/leads/99/sequence", json={"confirm": True}, headers=H).status_code == 404


def test_claudes_suggestion_needs_a_yes_and_its_cost_is_recorded(mem, monkeypatch):
    c = _client(STAFF)
    url = BASE + "/api/icps/suggest"
    assert c.post(url, json={"offer": "nope", "confirm": True}, headers=H).status_code == 400
    assert c.post(url, json={"offer": "markify"}, headers=H).status_code == 400
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    spent = []
    monkeypatch.setattr(store, "add_spend", lambda *a, **k: spent.append((a, k)))

    def suggest(offer, notes, budget, model):
        budget.add("icp-suggest", model, Decimal("0.004"), {})
        return [profile()]
    monkeypatch.setattr(icp, "suggest", suggest)
    r = c.post(url, json={"offer": "markify", "confirm": True, "notes": "D2C"}, headers=H)
    assert r.status_code == 200 and r.get_json()["icps"][0]["name"] == "New marketing leaders"
    assert spent[0][0][3:5] == ("anthropic", "icp-suggest") and spent[0][1]["usd"] == pytest.approx(0.004)
    monkeypatch.setattr(icp, "suggest", lambda *a, **k: [])
    assert c.post(url, json={"offer": "markify", "confirm": True}, headers=H).status_code == 502


def test_a_client_never_reaches_sequences_or_profiles(seeded, mem, monkeypatch):
    T._invite("lumina", **{"tool:buyer-radar": True})
    cl = T._client(T.CLIENT)
    for method, path in (("get", "/api/sequences"), ("post", "/api/leads/7/sequence"), ("post", "/api/icps/suggest")):
        r = getattr(cl, method)(BASE + path, json={"confirm": True, "offer": "markify"}, headers=XA)
        assert r.status_code in (302, 403, 404), path


# == the page ==================================================================================================

def test_a_profile_lead_and_its_drawer_offer_the_sequence_and_escape_everything():
    sig = icp.signal(profile(name=EVIL), "markify", person(7, name=EVIL, company=EVIL))
    lead = {"id": 3, "offer": "markify", "score": 80, "status": "new", "person": "sh/7", "source": "icp", "post": sig,
            "verdict": {"need": EVIL, "intent": "fits_profile"}, "draft": {"subject": "s"}, "sends": []}
    settings = {"sequences": {"markify": {"id": "S1", "step_id": "P1", "title": EVIL}}}
    card, drawer, nothing = run_js(
        "const l = %s; return [BR.renderLead(l), BR.renderDrawer(l, {email: true, linkedin: true, saleshandy: true}, %s), "
        "BR.renderDrawer(l, {saleshandy: true}, {})];" % (json.dumps(lead), json.dumps(settings)))
    for html in (card, drawer):
        assert "<img" not in html and "javascript:" not in html
    assert "br-kind--icp" in card and ">Profile<" in card and "Open the post" not in card
    assert 'data-act="sequence"' in drawer and "for one credit" in drawer and 'data-act="find"' in drawer
    assert 'data-act="sequence"' not in nothing and "Choose a sequence for this offer in Settings" in nothing


def test_the_settings_hold_the_profile_editor_and_the_sequence_picker():
    s = br.merged({"sequences": {"markify": {"id": "S1", "step_id": "P1", "title": "Old one"}}})
    form, opts = run_js(
        "const s = %s; return [BR.renderSettings(s, {markify: {label: 'Markify', site: 'x', queries: ['a'], jobs: ['j']}}, {}, {}, "
        "{icps: {markify: [%s]}, triggers: %s}), "
        "BR.seqOptions({id: 'S2'}, [{id: 'S1', title: 'Intro', active: true, steps: [{id: 'P1'}]}, "
        "{id: 'S2', title: 'Paused one', active: false, steps: [{id: 'P9'}]}, {id: 'S3', title: 'No steps', steps: []}])];"
        % (json.dumps(s), json.dumps(dict(profile(), name=EVIL)), json.dumps(icp.TRIGGERS)))
    for id_ in ("brIcps-markify", "brIcpNotes-markify", "brSeq-markify", "brIcpN", "brAutoSeq", "brSeqField", "brSrc-icp"):
        assert 'id="%s"' % id_ in form, id_
    assert 'data-icp="add"' in form and 'data-icp="suggest"' in form and 'data-icp="remove"' in form
    assert 'data-f="titles" value="CMO, VP Marketing"' in form and "<img" not in form
    assert 'value="new_in_role" selected' in form and "Old one" in form, "the saved sequence shows before Saleshandy answers"
    assert 'value="S2|P9|Paused one" selected' in opts and "(paused)" in opts and "No steps" not in opts
