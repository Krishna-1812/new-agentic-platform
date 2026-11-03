"""Lead Finder's Warmly source: Warmly's webhook posts companies and people to a workspace's own address,
they wait in an inbox, and the next run reads them like posts, keeps the buyers and writes to them.

The address's token is the only key (Warmly signs nothing), our own people are never kept, a signal a run
could not read waits for the next one, and a message never says the person was seen on our site.
"""

import os
import sys
from decimal import Decimal

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tests.test_buyer_radar import BASE, H, STAFF, FakeStore, _client, deps, mem, verdict  # noqa: E402,F401
from tracker import buyer_radar as br  # noqa: E402
from tracker import buyer_radar_judge as judge  # noqa: E402
from tracker import buyer_radar_store as store  # noqa: E402
from tracker import buyer_radar_warmly as wm  # noqa: E402

# Warmly's own examples (help.warmly.ai, "Setting Up Webhooks"), with an agency in place of Warmly.
CONTACT = {
    "Signal": "Website Visit Contact", "Orchestration Name": "Partner page readers",
    "Webhook Sent At": "2026-11-03T15:11:55.835Z",
    "LinkedIn URL": "https://www.linkedin.com/in/sam-lee-agency/", "Business Email": "Sam@LeeCreative.co.uk",
    "First Name": "Sam", "Last Name": "Lee", "Title": "Founder", "City": "Leeds", "Country": "United Kingdom",
    "Company Name": "Lee Creative", "Website": "leecreative.co.uk", "Industry": "Marketing and Advertising",
    "Employee Count": "11-50", "Seen At": "2026-11-03T14:37:28.001Z", "Session Active Seconds": 103,
    "Pages Viewed": "/partners, /partners/agencies",
    "Pages Viewed Details": [{"URL": "/partners?utm_source=li", "Active Seconds": 13},
                             {"URL": "/partners/agencies", "Active Seconds": 90}],
}
COMPANY = {
    "Signal": "Website Visit Company", "Orchestration Name": "ICP Company Visitors",
    "domain": "brightads.com.au", "name": "Bright Ads", "industry": "Marketing and Advertising",
    "employeesRange": "11-50", "country": "Australia", "description": "A creative and social agency.",
    "Seen At": "2026-11-03T02:00:00Z", "Pages Viewed": "/partners/agencies",
}


# == reading what Warmly sends ===========================================================================

def test_a_contact_from_warmly_becomes_a_signal_with_who_they_are_and_what_they_read():
    s = wm.normalize(CONTACT, "2026-11-03T15:12:00Z")
    assert s["kind"] == "warmly" and s["author"]["key"] == "in/sam-lee-agency" and s["key"].startswith("wm:")
    assert s["contacts"][0]["email"] == "sam@leecreative.co.uk" and s["contacts"][0]["location"] == "Leeds, United Kingdom"
    assert s["company"] == {"name": "Lee Creative", "domain": "leecreative.co.uk", "industry": "Marketing and Advertising",
                            "size": "11-50", "country": "United Kingdom"}
    assert [p["path"] for p in s["warmly"]["pages"]] == ["/partners", "/partners/agencies"]
    assert "/partners/agencies (90s)" in s["text"] and "Partner page readers" in s["text"]
    assert wm.normalize(dict(CONTACT), "later")["key"] == s["key"], "the same visit on the same day is one signal"
    text = wm.text(1, s)
    assert text.startswith("SIGNAL 1") and "Founder at Lee Creative" in text and "Marketing and Advertising" in text


def test_a_company_from_warmly_is_read_from_its_lower_case_fields():
    s = wm.normalize(COMPANY)
    assert s["company"]["name"] == "Bright Ads" and s["company"]["domain"] == "brightads.com.au"
    assert s["contacts"] == [] and s["author"]["company"] is True and s["url"] == "https://brightads.com.au"
    assert "A creative and social agency." in s["text"]


def test_research_topics_are_kept_and_nobody_of_ours_or_nobody_at_all_is_a_signal():
    s = wm.normalize(dict(COMPANY, Signal="Bombora Research Intent",
                          **{"Bombora Research Intent": [{"Topic": "Pay Per Click (PPC)", "Score": 0.8}]}))
    assert s["warmly"]["topics"] == [{"topic": "Pay Per Click (PPC)", "score": 0.8}] and "Pay Per Click" in s["text"]
    for ours in ("kris@markifydigital.com", "a@northaxis.com", "b@team.outcomes.digital", "c@callvibe.ai"):
        assert wm.normalize(dict(CONTACT, **{"Business Email": ours, "Website": ""})) is None, ours
    assert wm.normalize(dict(CONTACT, Website="www.markifydigital.com")) is None
    assert wm.normalize({"Signal": "Website Visit Contact", "First Name": "Nobody"}) is None
    assert wm.normalize("junk") is None


def test_one_request_carries_one_record_or_a_list_and_tokens_are_secret_sized():
    assert wm.records(CONTACT) == [CONTACT] and wm.records([CONTACT, "x", COMPANY]) == [CONTACT, COMPANY]
    assert len(wm.records([CONTACT] * 500)) == wm.MAX_RECORDS
    t = wm.new_token()
    assert wm.valid_token(t) and t != wm.new_token()
    assert not wm.valid_token("short") and not wm.valid_token("../../etc/passwd" + "a" * 30)


# == the webhook =========================================================================================

@pytest.fixture
def inbox(monkeypatch):
    got = {"rows": []}
    monkeypatch.setattr(store, "owner_of_warmly_token", lambda token: "acct:7" if token == "T" * 32 else None)

    def add(owner, signal, payload):
        if any(k == signal["key"] for _, k, _ in got["rows"]):
            return False
        got["rows"].append((owner, signal["key"], payload))
        return True
    monkeypatch.setattr(store, "warmly_add", add)
    return got


def test_warmly_posts_to_a_workspaces_address_and_only_that_address(inbox):
    import app as appmod
    c = appmod.app.test_client()
    url = "/api/lead-finder/warmly/" + "T" * 32
    r = c.post(url, json=CONTACT)
    assert r.status_code == 200 and r.get_json() == {"ok": True, "kept": 1, "skipped": 0, "repeats": 0}
    assert inbox["rows"][0][0] == "acct:7" and inbox["rows"][0][2] == CONTACT, "Warmly's record is kept whole"
    r = c.post(url, json=[CONTACT, COMPANY, dict(CONTACT, **{"Business Email": "me@markifydigital.com", "Website": "", "LinkedIn URL": ""})])
    assert r.get_json() == {"ok": True, "kept": 1, "skipped": 1, "repeats": 1}
    assert c.post("/api/lead-finder/warmly/" + "X" * 32, json=CONTACT).status_code == 404
    assert c.post("/api/lead-finder/warmly/short", json=CONTACT).status_code == 404
    assert c.post(url, data="not json", headers={"Content-Type": "text/plain"}).status_code == 400
    assert len(inbox["rows"]) == 2


def test_the_team_makes_the_address_and_a_new_one_replaces_it(mem, monkeypatch):
    monkeypatch.setattr(store, "warmly_counts", lambda owner: {"waiting": 3, "week": 5, "last": "2026-11-03T10:00:00+00:00"})
    c = _client(STAFF)
    st = c.get(BASE + "/api/status").get_json()
    assert st["warmly"]["url"] == "" and st["warmly"]["waiting"] == 3
    one = c.post(BASE + "/api/warmly", json={}, headers=H).get_json()
    assert one["url"].endswith("/api/lead-finder/warmly/" + one["settings"]["warmly_token"])
    assert one["url"].startswith(br.SITE)
    two = c.post(BASE + "/api/warmly", json={}, headers=H).get_json()
    assert two["url"] != one["url"], "a new address; the old one stops working"
    saved = c.post(BASE + "/api/settings", json={"keep_score": 55, "warmly_token": "mine" * 8}, headers=H).get_json()
    assert saved["settings"]["warmly_token"] == two["settings"]["warmly_token"], "settings never set the token"
    assert c.post(BASE + "/api/warmly", json={}, headers={"Origin": "https://evil.example"}).status_code == 403, "same-origin only"


# == a run reads them ====================================================================================

def test_a_run_reads_what_warmly_sent_keeps_the_buyers_and_writes_to_them(monkeypatch):
    fake = FakeStore()
    fake.install(monkeypatch)
    sigs = [wm.normalize(CONTACT), wm.normalize(COMPANY), wm.normalize(dict(CONTACT, **{"First Name": "Jo", "LinkedIn URL": "https://www.linkedin.com/in/jo/",
                                                                                     "Business Email": "jo@x.com", "Title": "Student"}))]
    fake.warmly = sigs
    out, read = {}, []
    d, _ = deps([], out)

    def judge_posts(items, offers, budget, model, system=judge.JUDGE_SYSTEM, text_of=None):
        budget.add("read", model, Decimal("0.004"), {})
        if system is judge.WARMLY_SYSTEM:
            read.extend(text_of(i, p) for i, p in enumerate(items, 1))
            scores = {sigs[0]["key"]: 88, sigs[1]["key"]: 64}            # the third: Claude could not read it
            return {p["key"]: verdict(scores[p["key"]], offer="agency_partners") for p in items if p["key"] in scores}
        return {}
    d["judge"] = judge_posts
    settings = br.merged({"offers": ["agency_partners"], "sources": ["warmly"], "icp_per_run": 0})
    summary = br.run(5, "acct:7", settings, started_by="kris@x.com", deps=d)
    assert summary["by_source"]["warmly"] == 2 and summary["warmly"] == 3
    assert "reading Warmly" in fake.updates and read and read[0].startswith("SIGNAL 1")
    kept = sorted(fake.leads.values(), key=lambda x: -x["score"])
    assert [x["source"] for x in kept] == ["warmly", "warmly"]
    assert kept[0]["email"] == "sam@leecreative.co.uk" and kept[0]["person"] == "in/sam-lee-agency"
    assert kept[1]["emails"] == [] and kept[0]["draft"]
    assert sorted(fake.taken) == [1, 2], "the signal Claude could not read waits for the next run"
    assert any(s[1] == "read-warmly" for s in fake.spend)


def test_a_workspace_with_only_warmly_on_can_run():
    assert br.search_missing(br.merged({"sources": ["warmly"]})) is None
    assert "warmly" in br.LEAD_SOURCES and "warmly" in store.LEAD_SOURCES


def test_a_message_to_a_warmly_lead_never_says_they_were_seen():
    sent = []

    def call(_b, _w, _m, _s, user, _sch, _mx):
        sent.append(user)
        return {"subject": "s", "email": "e", "note": "n", "message": "m"}
    lead = {"post": wm.normalize(CONTACT), "verdict": {"need": "White-label paid media"}, "source": "warmly"}
    judge.draft(lead, br.OFFERS["agency_partners"], {"name": "Kris"}, budget=None, call=call)
    assert "Never say or hint that you saw them on the website" in sent[0] and "Sam Lee, Founder, Lee Creative" in sent[0]
    assert "Their first name, to greet them by: Sam" in sent[0]
    assert judge.WARMLY_SYSTEM.endswith(judge.PARTNER_RULE)


def test_the_page_shows_the_address_and_lets_the_team_copy_or_replace_it():
    js = open(os.path.join(ROOT, "static", "js", "buyer_radar.js"), encoding="utf-8").read()
    assert "function renderWarmly(w)" in js and 'data-warmly="copy"' in js and 'data-warmly="make"' in js
    assert "warmly: ['Warmly'," in js and "'reading Warmly'" in js
