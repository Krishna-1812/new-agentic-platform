"""Buyer Radar every day: nobody twice, about the same number of new leads each day, the profile search
going on where it stopped, the daily run at the workspace's hour with its Slack message at that hour, and
every lead in a Google Sheet once (tracker/buyer_radar.py, buyer_radar_icp.find, buyer_radar_sheet.py)."""
import json
import os
import sys
from datetime import datetime, timezone

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests.test_buyer_radar import (BASE, EVIL, H, STAFF, FakeStore, _client, deps, mem, run_js,  # noqa: E402,F401
                                    verdict)
from tests.test_buyer_radar_icp import person, profile  # noqa: E402
from tracker import buyer_radar as br  # noqa: E402
from tracker import buyer_radar_icp as icp  # noqa: E402
from tracker import buyer_radar_send as send  # noqa: E402
from tracker import buyer_radar_sheet as sheet  # noqa: E402
from tracker import buyer_radar_store as store  # noqa: E402
from tracker import saleshandy_client as sh  # noqa: E402


def _post_lead(score=80, name="Priya Sharma", key="in/priya", company="Finova", source="post", post_key="p1"):
    return {"source": source, "score": score, "person": key, "offer": "callvibe",
            "post": {"key": post_key, "author": {"name": name, "key": key, "company": False}, "company": {"name": ""}},
            "verdict": {"company": company, "score": score}}


# == who a lead is ========================================================================================

def test_a_person_is_known_by_their_profile_and_by_their_name_at_their_company():
    assert br.identities(_post_lead()) == {"person:in/priya", "name:priya sharma|finova"}
    page = _post_lead(name="Acme", key="company/acme", company="Acme")
    page["post"]["author"]["company"] = True
    assert br.identities(page) == {"person:company/acme"}, "a company page is one author, with no person's name"
    assert br.identities(_post_lead(company="Self-employed")) == {"person:in/priya"}, "no company to match on"
    found = {"source": "icp", "person": "sh/77", "post": {"author": {"name": "Priya Sharma", "key": "sh/77"},
                                                         "company": {"name": "Finova Pvt Ltd"}}, "verdict": {"company": "Finova Pvt Ltd"}}
    assert br.identities(found) == {"person:sh/77", "name:priya sharma|finova"}, "Saleshandy's Priya at Finova is LinkedIn's"


def test_a_hiring_company_is_one_company_whatever_month_and_its_decision_maker_a_person():
    lead = {"source": "jobs", "person": "sh/5",
            "post": {"key": "jobs:company/brightpath:2026-11", "author": {"name": "Brightpath Foods", "key": "company/brightpath", "company": True},
                     "company": {"name": "Brightpath Foods"}, "contacts": [{"key": "sh/5", "name": "Anil Mehta", "linkedin": ""}]},
            "verdict": {"company": "Brightpath Foods"}}
    assert br.identities(lead) == {"person:sh/5", "name:anil mehta|brightpath foods", "hiring:brightpath foods",
                                   "hiring:company/brightpath"}
    lead["person"] = "company/brightpath"
    assert br.identities(lead) == {"hiring:brightpath foods", "hiring:company/brightpath"}, "no decision maker yet"


def test_an_rfp_is_one_rfp_at_any_link():
    a = {"source": "rfp", "person": "", "post": {"rfp": {"issuer": "City of Pune", "title": "RFP: SEO Services!"}, "company": {"name": "City of Pune"},
                                                 "author": {"name": "City of Pune", "company": True}}, "verdict": {"company": "City of Pune"}}
    b = json.loads(json.dumps(a))
    b["post"]["rfp"]["title"] = "rfp seo services"
    assert br.identities(a) == br.identities(b) == {"rfp:city of pune|rfp seo services"}


def test_dedupe_keeps_the_best_of_each_and_drops_the_known():
    leads = [_post_lead(60, post_key="p1"), _post_lead(90, post_key="p2"), _post_lead(70, name="Ravi", key="in/ravi", post_key="p3")]
    kept, dropped = br.dedupe(leads)
    assert [x["post"]["key"] for x in kept] == ["p2", "p3"] and [x["post"]["key"] for x in dropped] == ["p1"]
    kept, dropped = br.dedupe(leads, {"name:ravi|finova"})
    assert [x["post"]["key"] for x in kept] == ["p2"]


# == a run: nobody twice, and about the same number every day ===========================================

def _icp_rows(n, start=100, a=None):
    a = a or profile()
    return [("markify", a, icp.signal(a, "markify", person(i)), 80) for i in range(start, start + n)]


def test_a_person_or_company_already_a_lead_is_not_a_new_lead_again(monkeypatch):
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    out = {}
    d, posts = deps([92, 91, 90], out)
    author = posts[0]["author"]["key"]
    fake = FakeStore(idents={"person:" + author})
    fake.install(monkeypatch)
    s = br.merged({"source": "apify", "sources": ["posts"], "daily_leads": 0})
    summary = br.run(1, "acct:7", s, deps=d)
    keys = {x["post"]["key"] for x in fake.leads.values()}
    assert posts[0]["key"] not in keys and summary["repeats"] >= 1, "their new post is not a new lead"
    assert posts[0]["key"] in fake.seen, "and is not read again tomorrow"
    for lead in fake.leads.values():
        assert fake.idents["lead:%d" % lead["id"]] == lead["id"], "every saved lead keeps its identities"
        assert any(fake.idents.get(i) == lead["id"] for i in br.identities(lead) if i.startswith("person:"))


def test_the_profiles_fill_the_day_up_to_the_leads_aimed_for_and_leave_the_rest_for_tomorrow(monkeypatch):
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    fake = FakeStore()
    fake.install(monkeypatch)
    out, asked = {}, {}
    d, _ = deps([92, 91], out)
    d["icp"] = lambda pairs, per_icp, known, cursor: asked.update(per=per_icp) or (_icp_rows(40), [])
    s = br.merged({"source": "apify", "daily_leads": 25, "icps": {"markify": [profile()], "callvibe": []}})
    summary = br.run(1, "acct:7", s, deps=d)
    assert summary["new"] == 25 and summary["people"] == 23 and summary["target"] == 25, "2 buyers + 23 who fit = 25"
    assert asked["per"] == 35, "23 wanted, half again, from the one profile"
    taken = {x["post"]["key"] for x in fake.leads.values() if x["source"] == "icp"}
    assert len(taken) == 23 and not ({"icp:%d" % i for i in range(100, 140)} - taken) & fake.seen, \
        "the 17 not needed today are not marked as looked at: tomorrow's run takes them"
    assert not any("under the" in n for n in summary["notes"])


def test_a_short_day_says_so_and_a_target_of_zero_keeps_the_old_per_run_number(monkeypatch):
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    FakeStore().install(monkeypatch)
    d, _ = deps([92], {})
    d["icp"] = lambda pairs, per_icp, known, cursor: (_icp_rows(3), [])
    s = br.merged({"source": "apify", "daily_leads": 30, "icps": {"markify": [profile()], "callvibe": []}})
    summary = br.run(1, "acct:7", s, deps=d)
    assert summary["new"] == 4 and any(n.startswith("4 new leads, under the 30 aimed for") for n in summary["notes"])
    asked = {}
    d["icp"] = lambda pairs, per_icp, known, cursor: asked.update(per=per_icp) or ([], [])
    FakeStore().install(monkeypatch)
    br.run(2, "acct:7", br.merged({"source": "apify", "daily_leads": 0, "icp_per_run": 10,
                                   "icps": {"markify": [profile()], "callvibe": []}}), deps=d)
    assert asked["per"] == 15, "with no target, the profiles add icp_per_run as before"


def test_a_profile_match_who_is_also_todays_post_author_is_one_lead(monkeypatch):
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    fake = FakeStore()
    fake.install(monkeypatch)
    d, posts = deps([92], {})
    d["judge"] = lambda ps, offers, budget, model, **kw: {p["key"]: dict(verdict(92), company="Acme") for p in ps}
    name = posts[0]["author"]["name"]
    a = profile()
    twin = ("markify", a, icp.signal(a, "markify", person(5, name=name, company="Acme")), 80)
    d["icp"] = lambda pairs, per_icp, known, cursor: ([twin] + _icp_rows(1), [])
    br.run(1, "acct:7", br.merged({"source": "apify", "daily_leads": 5, "icps": {"markify": [a], "callvibe": []}}), deps=d)
    assert [x["source"] for x in sorted(fake.leads.values(), key=lambda x: x["id"])] == ["post", "icp"]
    assert "icp:5" in fake.seen, "found twice today: kept once"


# == the profile search goes on where it stopped =========================================================

class Pages:
    """Saleshandy's people search: `n` people, 25 a page."""

    def __init__(self, n):
        self.n, self.asked = n, []

    def search_people(self, filters, page=1, **kw):
        self.asked.append(page)
        ids = list(range((page - 1) * 25 + 1, min(self.n, page * 25) + 1))
        return {"people": [person(i) for i in ids], "has_next": page * 25 < self.n}


def test_each_run_starts_where_the_last_stopped_and_wraps_at_the_end():
    a = profile(trigger="none")
    pages, cursors, met = Pages(130), {}, set()
    cur = (lambda k: cursors.get(k, 1), lambda k, p: cursors.__setitem__(k, p))
    known = lambda keys: {k for k in keys if k in met}  # noqa: E731
    rows, _ = icp.find([("markify", a)], client=pages, per_icp=10, known=known, cursor=cur)
    assert pages.asked == [1] and cursors[icp.cursor_key(a)] == 1, "page 1 not finished: tomorrow goes on there"
    met.update(r[2]["key"] for r in rows)
    met.update("icp:%d" % i for i in range(11, 26))       # the rest of page 1 seen another way
    pages.asked.clear()
    rows, _ = icp.find([("markify", a)], client=pages, per_icp=10, known=known, cursor=cur)
    assert pages.asked == [1, 2] and [r[2]["key"] for r in rows][:1] == ["icp:26"] and cursors[icp.cursor_key(a)] == 2
    cursors[icp.cursor_key(a)] = 5
    pages.asked.clear()
    met.update("icp:%d" % i for i in range(101, 131))
    rows, notes = icp.find([("markify", a)], client=pages, per_icp=10, known=known, cursor=cur)
    assert pages.asked == [5, 6] and cursors[icp.cursor_key(a)] == 1, "past the last page: back to the first"


def test_a_failed_search_keeps_its_place_and_an_edited_profile_starts_again():
    class Broken:
        def search_people(self, filters, page=1, **kw):
            raise sh.SaleshandyError("boom")
    a = profile(trigger="none")
    cursors = {icp.cursor_key(a): 4}
    icp.find([("markify", a)], client=Broken(), per_icp=5, cursor=(lambda k: cursors.get(k, 1), lambda k, p: cursors.__setitem__(k, p)))
    assert cursors == {icp.cursor_key(a): 4}
    assert icp.cursor_key(profile(trigger="none", titles=["CMO"])) != icp.cursor_key(a)


# == the daily schedule ===================================================================================

def _at(iso):
    return datetime.fromisoformat(iso).replace(tzinfo=timezone.utc)


def test_the_daily_run_starts_in_the_hour_before_its_time_india_time():
    s = br.merged({"daily_hour": 9})
    start, slack = br.daily_slot(s, _at("2026-10-22T03:00:00"))          # 08:30 India
    assert (start, slack) == (_at("2026-10-22T02:30:00"), _at("2026-10-22T03:30:00")), "08:00 and 09:00 India"
    assert br.daily_due(s, _at("2026-10-22T02:29:00"), []) is False
    assert br.daily_due(s, _at("2026-10-22T02:31:00"), []) is True
    late = _at("2026-10-22T19:00:00")                                    # 00:30 India, the next day
    assert br.ist_day_start(late) == _at("2026-10-22T18:30:00") and br.daily_due(s, late, []) is False
    assert br.daily_slot(br.merged({"daily_hour": 0}), late)[0] == _at("2026-10-22T18:30:00"), "never before midnight"


@pytest.mark.parametrize("todays, due", [
    ([{"status": "ready"}], False),
    ([{"status": "running"}], False),
    ([{"status": "running", "stale": "restarted"}], True),
    ([{"status": "failed"}], True),
    ([{"status": "failed"}, {"status": "running", "stale": "x"}], False),
    ([{"status": "failed"}, {"status": "failed"}], False),
])
def test_once_a_day_with_one_more_try_after_a_failure(todays, due):
    assert br.daily_due(br.merged({"daily_hour": 0}), _at("2026-10-22T10:00:00"), todays) is due


def test_the_daily_runs_slack_message_waits_for_its_hour(monkeypatch):
    monkeypatch.setenv("APIFY_API_TOKEN", "t")
    FakeStore().install(monkeypatch)
    out = {}
    d, _ = deps([92, 75], out)
    s = dict(br.merged({"source": "apify", "sources": ["posts"], "slack_channel": "#leads", "daily_leads": 0}),
             deliver_at="2999-01-01T03:30:00+00:00")       # as the daily route adds it
    summary = br.run(1, "acct:7", s, deps=d)
    assert "slack" not in out and summary["slack"] == "waiting" and summary["slack_at"] == s["deliver_at"]
    FakeStore().install(monkeypatch)                     # another workspace: the same posts are new to it
    s["deliver_at"] = "2020-01-01T03:30:00+00:00"
    summary = br.run(2, "acct:8", s, deps=d)
    assert out["slack"] == ("#leads", [92, 75]) and out["slack_kw"] == {"total": 2, "daily": True, "by_source": {"post": 2}, "sheet_url": ""}, \
        "finished after its hour: posted at once"


class WaitingStore:
    def __init__(self, rows, claimable=True):
        self.rows, self.claimable, self.results, self.asked = rows, claimable, {}, []

    def slack_waiting(self):
        return self.rows

    def claim_slack(self, run_id):
        return self.claimable

    def get_settings(self, owner):
        return br.merged({"slack_channel": "C0123", "alert_score": 70, "sheet_id": "x" * 30})

    def run_leads(self, owner, run_id, min_score):
        self.asked.append((owner, run_id, min_score))
        return [{"score": 88}]

    def set_run_summary_key(self, run_id, key, value):
        self.results[run_id] = (key, value)


def test_waiting_messages_go_out_once_their_hour_has_come():
    now = _at("2026-10-22T03:31:00")
    st = WaitingStore([(1, "acct:1", {"slack": "waiting", "slack_at": "2026-10-22T03:30:00+00:00", "new": 30}),
                       (2, "acct:2", {"slack": "waiting", "slack_at": "2026-10-22T04:30:00+00:00"})])
    posted = []
    n = br.deliver_waiting(now=now, store=st, post=lambda ch, owner, leads, **kw: posted.append((ch, owner, leads, kw)) or (True, ""))
    assert n == 1 and st.results == {1: ("slack", "sent")} and st.asked == [("acct:1", 1, 70)]
    assert posted[0][3] == {"total": 30, "daily": True, "by_source": {}, "sheet_url": sheet.sheet_url("x" * 30)}
    st = WaitingStore(st.rows[:1], claimable=False)
    assert br.deliver_waiting(now=now, store=st, post=lambda *a, **k: 1 / 0) == 0, "claimed by another call: not twice"
    st = WaitingStore(st.rows[:1])
    br.deliver_waiting(now=now, store=st, post=lambda *a, **k: 1 / 0)
    assert st.results == {1: ("slack", "ZeroDivisionError")}, "a failure is said, never left sending"


def test_the_daily_slack_message_says_how_the_day_went_even_with_nothing_strong():
    msg = send.slack_message("", [], "https://app/br", total=27, daily=True, sheet_url="https://docs.google.com/spreadsheets/d/x/edit")
    text = json.dumps(msg)
    assert "no strong leads today" in text and "27 new leads today, 0 strong, all in the Google Sheet" in text
    assert "Open the Google Sheet" in text and "Open Buyer Radar" in text
    assert "nothing new today" in json.dumps(send.slack_message("", [], "", total=0, daily=True))
    manual = json.dumps(send.slack_message("", [{"post": {"url": "https://x.co/p", "author": {"name": "A"}}, "offer": "callvibe",
                                                 "score": 90, "verdict": {}}], "", total=5))
    assert "5 new leads in all, the 1 strong ones below" in manual and "Open the Google Sheet" not in manual


# == the Google Sheet ====================================================================================

class _Req:
    def __init__(self, fn):
        self.fn = fn

    def execute(self):
        return self.fn()


class FakeSheets:
    """Enough of the Sheets API: tabs of rows, header row first."""

    def __init__(self, tabs=None, fail=None):
        self.tabs = {k: [list(r) for r in v] for k, v in (tabs or {}).items()}
        self.fail, self.calls = fail, []

    def spreadsheets(self):
        return self

    def values(self):
        return self

    @staticmethod
    def _tab(rng):
        return rng.split("!")[0].strip("'")

    @staticmethod
    def _cell(ref):
        import re
        m = re.match(r"([A-Z]+)(\d*)", ref)
        col = 0
        for ch in m.group(1):
            col = col * 26 + ord(ch) - 64
        return col, int(m.group(2) or 0)

    def _check(self):
        if self.fail:
            raise self.fail

    def get(self, spreadsheetId, range=None, fields=None):
        def run():
            self._check()
            if fields:
                return {"sheets": [{"properties": {"title": t}} for t in self.tabs]}
            tab, rows = self._tab(range), self.tabs.get(self._tab(range), [])
            ref = range.split("!")[1]
            if ref == "1:1":
                return {"values": rows[:1]}
            col, first = self._cell(ref.split(":")[0])
            return {"values": [[r[col - 1]] if len(r) >= col else [] for r in rows[first - 1:]]}
        return _Req(run)

    def batchUpdate(self, spreadsheetId, body):
        def run():
            self._check()
            self.calls.append(("batchUpdate", body))
            for req in body.get("requests") or []:
                self.tabs.setdefault(req["addSheet"]["properties"]["title"], [])
            for d in body.get("data") or []:
                assert body["valueInputOption"] == "RAW"
                col, row = self._cell(d["range"].split("!")[1])
                rows = self.tabs[self._tab(d["range"])]
                while len(rows[row - 1]) < col:
                    rows[row - 1].append("")
                rows[row - 1][col - 1] = d["values"][0][0]
            return {}
        return _Req(run)

    def update(self, spreadsheetId, range, valueInputOption, body):
        def run():
            assert valueInputOption == "RAW"
            col, row = self._cell(range.split("!")[1])
            rows = self.tabs[self._tab(range)]
            if not rows:
                rows.append([])
            while len(rows[0]) < col - 1:
                rows[0].append("")
            rows[0][col - 1:] = body["values"][0]
            return {}
        return _Req(run)

    def append(self, spreadsheetId, range, valueInputOption, insertDataOption, body):
        def run():
            assert valueInputOption == "RAW"
            self.tabs[self._tab(range)].extend([list(r) for r in body["values"]])
            self.calls.append(("append", len(body["values"])))
            return {}
        return _Req(run)


class SheetStore:
    def __init__(self, leads, mark=True):
        self.leads, self.mark, self.marked = leads, mark, []

    def db_now(self):
        return "T1"

    def sheet_pending(self, owner, limit):
        return [x for x in self.leads if not x.get("_synced")][:limit]

    def mark_sheet(self, owner, ids, at):
        self.marked.append((list(ids), at))
        if self.mark:
            for x in self.leads:
                if x["id"] in ids:
                    x["_synced"] = True

    def get_run(self, run_id, owner):
        return {"id": run_id, "trigger": "daily", "created_at": "2026-10-22T03:00:00+00:00", "spent_usd": 0.42}


def _lead(i, **kw):
    out = {"id": i, "run_id": 3, "score": 80, "offer": "callvibe", "source": "post", "status": "new", "person": "in/p%d" % i,
           "email": None, "email_source": None, "created_at": "2026-10-22T03:05:00+00:00", "updated_at": "2026-10-22T03:05:00+00:00",
           "post": {"key": "p%d" % i, "url": "https://www.linkedin.com/posts/p%d" % i, "text": "=HYPERLINK(\"x\") need call QA",
                    "author": {"name": "Person %d" % i, "headline": "Head of Sales", "url": "https://www.linkedin.com/in/p%d" % i}},
           "verdict": {"need": "Call QA", "intent_label": "Looking for a vendor", "company": "Acme"},
           "draft": {"subject": "s", "email": "e", "note": "n", "message": "m"}, "sends": []}
    out.update(kw)
    return out


def test_the_sheet_id_comes_from_its_link():
    sid = "1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789"
    assert sheet.sheet_id_of("https://docs.google.com/spreadsheets/d/%s/edit#gid=0" % sid) == sid
    assert sheet.sheet_id_of(sid) == sid and sheet.sheet_id_of("not a sheet") == "" and sheet.sheet_id_of("") == ""
    assert br.clean_settings({"sheet_id": "https://docs.google.com/spreadsheets/d/%s/edit" % sid})["sheet_id"] == sid
    assert br.clean_settings({"sheet_id": ""})["sheet_id"] == ""
    with pytest.raises(ValueError):
        br.clean_settings({"sheet_id": "https://example.com/x"})
    for bad in ({"daily_hour": 24}, {"daily_hour": -1}, {"daily_leads": 101}):
        with pytest.raises(ValueError):
            br.clean_settings(bad)
    assert br.clean_settings({"daily_hour": 18, "daily_leads": 25})["daily_hour"] == 18


def test_every_lead_gets_one_detailed_row_with_text_kept_as_text():
    svc, st = FakeSheets(), SheetStore([_lead(1), _lead(2, source="rfp", email="bids@pune.gov.in", email_source="rfp")])
    got = sheet.sync("acct:1", {"sheet_id": "x" * 30, "alert_score": 70}, store=st, service=svc)
    assert got == {"added": 2, "updated": 0, "left": 0} and set(svc.tabs) == {"Leads", "Runs"}
    head, rows = svc.tabs["Leads"][0], svc.tabs["Leads"][1:]
    assert head[0] == "Lead ID" and len(head) == len(sheet.lead_columns({})) and len(rows) == 2
    row = dict(zip(head, rows[1]))
    assert row["Lead ID"] == 2 and row["Found in"] == "RFP or tender" and row["Email found by"] == "The RFP"
    assert row["Their words"] == "=HYPERLINK(\"x\") need call QA", "written RAW: never a formula"
    assert row["Found (India time)"] == "2026-10-22 08:35" and row["Strong"] == "Yes" and row["Company"] == "Acme"
    assert st.marked == [([1, 2], "T1")]


def test_a_lead_is_never_added_twice_even_when_the_database_missed_the_last_update():
    st = SheetStore([_lead(1)], mark=False)            # the save after the sheet's update failed
    svc = FakeSheets()
    sheet.sync("acct:1", {"sheet_id": "x" * 30}, store=st, service=svc)
    got = sheet.sync("acct:1", {"sheet_id": "x" * 30}, store=st, service=svc)
    assert len(svc.tabs["Leads"]) == 2 and got == {"added": 0, "updated": 1, "left": 0}, "found by its Lead ID: updated, not added"


def test_a_changed_lead_is_updated_in_its_own_row_after_the_team_sorted_and_added_columns():
    svc = FakeSheets()
    st = SheetStore([_lead(1), _lead(2)])
    sheet.sync("acct:1", {"sheet_id": "x" * 30}, store=st, service=svc)
    rows = svc.tabs["Leads"]
    rows[0].append("Our notes")
    rows[1], rows[2] = rows[2] + ["call Friday"], rows[1] + ["no"]          # sorted, with notes of their own
    changed = _lead(1, status="contacted", email="p1@acme.com", email_source="saleshandy", updated_at="2026-10-22T05:00:00+00:00",
                    sends=[{"channel": "email", "status": "sent", "to": "p1@acme.com", "by": "kris@x.com", "at": "2026-10-22T05:00:00+00:00"}])
    st.leads = [changed]
    got = sheet.sync("acct:1", {"sheet_id": "x" * 30}, store=st, service=svc)
    assert got == {"added": 0, "updated": 1, "left": 0}
    head = svc.tabs["Leads"][0]
    row1 = dict(zip(head, svc.tabs["Leads"][2]))
    assert row1["Lead ID"] == 1 and row1["Status"] == "contacted" and row1["Email"] == "p1@acme.com"
    assert row1["Contacted"] == "Email to p1@acme.com, 2026-10-22 10:30" and row1["Our notes"] == "no", "their column untouched"
    assert dict(zip(head, svc.tabs["Leads"][1]))["Status"] == "new" and len(svc.tabs["Leads"]) == 3


def test_a_sheet_buyer_radar_may_not_open_says_who_to_share_it_with(monkeypatch):
    class E(Exception):
        resp = type("R", (), {"status": 403})()
    monkeypatch.setenv("GOOGLE_SA_JSON", json.dumps({"client_email": "radar@proj.iam.gserviceaccount.com"}))
    got = sheet.sync("acct:1", {"sheet_id": "x" * 30}, store=SheetStore([_lead(1)]), service=FakeSheets(fail=E()))
    assert got == {"error": "Buyer Radar may not open the sheet: share it with radar@proj.iam.gserviceaccount.com as an Editor"}
    ok, msg = sheet.check("x" * 30, service=FakeSheets(fail=E()))
    assert not ok and "radar@proj.iam.gserviceaccount.com" in msg
    assert sheet.check("x" * 30, service=FakeSheets()) == (True, "Connected: Buyer Radar writes to the Leads and Runs tabs.")


def test_after_a_run_its_row_goes_on_the_runs_tab_once():
    svc, st = FakeSheets(), SheetStore([_lead(1)])
    summary = {"new": 26, "target": 30, "strong": 9, "by_source": {"post": 3, "icp": 23}, "repeats": 4, "read": 120,
               "slack": "waiting", "slack_at": "2026-10-22T03:30:00+00:00", "notes": ["a note"]}
    got = sheet.sync_run("acct:1", {"sheet_id": "x" * 30}, run_id=3, summary=summary, store=st, service=svc)
    sheet.sync_run("acct:1", {"sheet_id": "x" * 30}, run_id=3, summary=summary, store=st, service=svc)
    assert got["added"] == 1 and len(svc.tabs["Runs"]) == 2
    row = dict(zip(svc.tabs["Runs"][0], svc.tabs["Runs"][1]))
    assert (row["Run ID"], row["Daily or by hand"], row["New leads"], row["From customer profiles"], row["Repeats skipped"],
            row["Slack"], row["Cost ($)"]) == (3, "Daily", 26, 23, 4, "At 2026-10-22 09:00", 0.42)


def test_a_failed_sheet_update_is_a_note_and_never_stops_the_run():
    summary = {"notes": []}
    got = sheet.sync_run("acct:1", {"sheet_id": "x" * 30}, run_id=3, summary=summary, store=SheetStore([_lead(1)]),
                         service=FakeSheets(fail=RuntimeError("down")))
    assert got["error"].startswith("RuntimeError") and summary["notes"][0].startswith("The Google Sheet was not updated")


# == routes and page ======================================================================================

def test_the_team_checks_and_updates_its_sheet(mem, monkeypatch):
    c = _client(STAFF)
    assert c.post(BASE + "/api/sheet", json={"action": "check"}, headers=H).status_code == 400, "no sheet saved yet"
    mem["settings"][STAFF] = br.merged({"sheet_id": "x" * 30})
    monkeypatch.setattr(sheet, "check", lambda sid: (True, "Connected"))
    monkeypatch.setattr(sheet, "sync", lambda owner, settings: {"added": 3, "updated": 1, "left": 0})
    assert c.post(BASE + "/api/sheet", json={"action": "check"}, headers=H).get_json() == {"ok": True, "detail": "Connected"}
    assert c.post(BASE + "/api/sheet", json={"action": "sync"}, headers=H).get_json() == {"ok": True, "added": 3, "updated": 1, "left": 0}
    monkeypatch.setattr(sheet, "sync", lambda owner, settings: {"error": "nope"})
    assert "nope" in c.post(BASE + "/api/sheet", json={"action": "sync"}, headers=H).get_json()["error"]
    monkeypatch.setenv("GOOGLE_SA_JSON", json.dumps({"client_email": "radar@proj.iam.gserviceaccount.com"}))
    st = c.get(BASE + "/api/status").get_json()
    assert st["sheet"] == {"email": "radar@proj.iam.gserviceaccount.com", "url": sheet.sheet_url("x" * 30)}


def test_settings_show_the_hour_the_target_and_the_sheet():
    s = br.merged({"daily_hour": 18, "daily_leads": 25, "sheet_id": "x" * 30})
    html = run_js("return BR.renderSettings(%s, {callvibe: {label: 'CallVibe', site: 'x', queries: ['a'], jobs: ['j']}}, {}, {},"
                  " {sheet: {email: %s}});" % (json.dumps(s), json.dumps(EVIL)))
    assert '<option value="18" selected>6:00 PM</option>' in html and 'id="brDailyN"' in html and 'value="25"' in html
    assert 'https://docs.google.com/spreadsheets/d/%s/edit' % ("x" * 30) in html and 'data-sheet="check"' in html
    assert "<img" not in html and "&lt;img" in html
    assert run_js("return [BR.hourLabel(0), BR.hourLabel(12), BR.hourLabel(new Date('2026-10-22T03:30:00Z'))];") == \
        ["12:00 AM", "12:00 PM", "9:00 AM"]


def _rich_lead(**kw):
    out = {"id": 1, "offer": "markify", "score": 90, "email": "", "source": "post",
           "post": {"url": "https://www.linkedin.com/posts/x", "kind": "post", "posted_at": "2026-10-22T08:00:00Z",
                    "author": {"name": "Tahiti Tourisme", "headline": "Tourism board", "url": "https://www.linkedin.com/company/tt"}},
           "verdict": {"need": "A digital agency for Instagram and TikTok", "intent_label": "Looking for a vendor",
                       "reason": "Names the service and asks for a vendor", "region": "French Polynesia", "deadline": "Nov 6",
                       "company": "Tahiti Tourisme Board"}}
    out.update(kw)
    return out


def test_the_daily_slack_message_shows_what_decides_whether_to_act(monkeypatch):
    monkeypatch.setattr(send, "_ago", lambda iso, now=None: "2 days ago" if iso else "")
    leads = [_rich_lead(), _rich_lead(id=2, offer="callvibe", score=84, email="cmo@acme.com",
                                      verdict={"need": "Call QA", "intent_label": "Asking for recommendations"})]
    msg = send.slack_message("", leads, "https://app/br", total=84, daily=True, sheet_url="https://docs.google.com/spreadsheets/d/x/edit",
                             by_source={"post": 50, "comment": 24, "jobs": 10})
    text = json.dumps(msg, ensure_ascii=False)
    assert "84 new leads today, 2 strong (50 posts, 24 comments, 10 job ads), all in the Google Sheet\\nStrong by offer: " in text
    assert "CallVibe 1" in text
    assert "*1. Tahiti Tourisme* — Tourism board" in text and "score *90*" in text and "for *Markify Digital*" in text
    assert "*Wants:* A digital agency for Instagram and TikTok" in text
    assert "Why it fits" not in text and "Names the service" not in text
    assert "🏢 Tahiti Tourisme Board" in text and "📍 French Polynesia" in text and "⏰ due Nov 6" in text and "🕒 2 days ago" in text
    assert "🔗 LinkedIn profile" in text and "✉️ email known" in text
    assert [b["type"] for b in msg["blocks"]].count("divider") == 1, "one between the two leads, none after the last"


def test_the_slack_message_leaves_out_what_a_lead_does_not_have_and_escapes_the_rest():
    bare = {"id": 3, "offer": "markify", "score": 75, "post": {"kind": "reddit", "url": "https://www.reddit.com/r/x/1",
                                                                   "author": {"name": "<b>u/x</b>"}},
            "verdict": {"need": "<!channel> an agency"}}
    text = json.dumps(send.slack_message("", [bare], "", total=1), ensure_ascii=False)
    assert "Wants" in text and "📍" not in text and "⏰" not in text
    assert "💬 answer in the thread" in text and "<!channel>" not in text and "&lt;!channel&gt;" in text
    assert "Strong by offer" not in text and "divider" not in text


def test_a_long_run_names_the_rest_and_stays_inside_slacks_limits():
    leads = [_rich_lead(id=i, verdict={"need": "n" * 4000}) for i in range(14)]
    msg = send.slack_message("", leads, "u", total=90, daily=True, sheet_url="https://docs.google.com/spreadsheets/d/x/edit")
    assert len(msg["blocks"]) <= 50
    assert all(len(b["text"]["text"]) <= 3000 for b in msg["blocks"] if b["type"] == "section")
    assert "and 4 more in the Google Sheet" in json.dumps(msg)


def test_how_fresh_a_post_is():
    from datetime import datetime, timezone
    now = datetime(2026, 10, 24, 12, tzinfo=timezone.utc)
    assert send._ago("2026-10-24T01:00:00Z", now) == "today" and send._ago("2026-10-23T01:00:00Z", now) == "yesterday"
    assert send._ago("2026-10-21T01:00:00Z", now) == "3 days ago" and send._ago("2026-06-01T01:00:00Z", now) == "01 Jun 2026"
    assert send._ago("", now) == "" and send._ago("not a date", now) == "" and send._ago("2027-01-01T00:00:00Z", now) == ""
