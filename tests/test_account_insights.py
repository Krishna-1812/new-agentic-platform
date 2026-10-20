"""An account's briefing on its home: what needs the team today, read from everything saved for that account alone.

tracker/account_insights.py turns each source into insights (fix now, watch, opportunity, win, to do), ranks them and links
each to the agent that found it, inside the account; app.py reads the sources (never Google Ads itself) and draws the
briefing at /<account>/insights for the home (templates/_account_insights.html, static/js/account-insights.js).
"""
import datetime as dt
import os
import re

import pytest

import app as appmod
from tracker import account_insights as ai, client_accounts, client_accounts_store

STAFF = "reporting@markifydigital.com"
NOW = dt.datetime(2026, 10, 20, 9, 0, tzinfo=dt.timezone.utc)
money = client_accounts.money
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _daily(cost_conv):
    """30 days of {day, cost, conv}, ending 19 Oct, from (cost, conv) for the 16 older days, the week before and the last week."""
    (oc, ov), (pc, pv), (lc, lv) = cost_conv
    days = []
    for i in range(30):
        d = (dt.date(2026, 9, 20) + dt.timedelta(days=i)).isoformat()
        c, v = (oc, ov) if i < 16 else (pc, pv) if i < 23 else (lc, lv)
        days.append({"day": d, "cost": c, "conv": v, "clicks": 10, "cpa7": None})
    return days


def _st(**kw):
    daily = kw.pop("daily", None) or _daily(((100, 2), (100, 2), (140, 1)))
    cost = sum(d["cost"] for d in daily)
    conv = sum(d["conv"] for d in daily)
    week = sum(d["conv"] for d in daily[-7:]), sum(d["conv"] for d in daily[-14:-7])
    wcost = sum(d["cost"] for d in daily[-7:]), sum(d["cost"] for d in daily[-14:-7])
    pct = lambda a, b: (a - b) / b * 100 if b else None           # noqa: E731
    cpa7 = wcost[0] / week[0] if week[0] else None
    cpap = wcost[1] / week[1] if week[1] else None
    st = {"currency": "USD", "from": daily[0]["day"], "to": daily[-1]["day"], "days": 30, "cost": cost, "conv": conv,
          "clicks": 300, "impr": 3000, "cpa": cost / conv if conv else None,
          "delta": {"cost": pct(*wcost), "conv": pct(*week), "clicks": 0,
                    "cpa": pct(cpa7, cpap) if cpa7 is not None and cpap else None},
          "daily": daily,
          "campaigns": kw.pop("campaigns", [
              {"name": "Search - Implants", "account": "Lumina", "type": "Search", "state": "Enabled", "cost": cost * 0.6,
               "conv": conv * 0.9, "clicks": 100, "share": 0.6, "cpa": cost * 0.6 / (conv * 0.9)},
              {"name": "PMax - Smiles", "account": "Lumina", "type": "Performance Max", "state": "Enabled", "cost": cost * 0.25,
               "conv": 0.0, "clicks": 80, "share": 0.25, "cpa": None},
              {"name": "Search - Brand", "account": "Lumina", "type": "Search", "state": "Enabled", "cost": cost * 0.15,
               "conv": conv * 0.1, "clicks": 20, "share": 0.15, "cpa": cost * 0.15 / (conv * 0.1)}])}
    st.update(kw)
    return st


# ── Google Ads: the campaign report ──────────────────────────────────────────
def test_a_week_that_costs_more_a_conversion_and_a_campaign_with_none_are_flagged():
    got = {i["key"]: i for i in ai.performance(_st(), money)}
    up = got["perf:cpa-up"]
    assert up["tone"] == "fix" and up["title"] == "Cost per conversion up 180% this week"
    assert up["stat"] == "$140" and up["stat_label"] == "from $50"
    dry = got["perf:dry:PMax - Smiles"]
    assert dry["tone"] == "fix" and dry["title"].startswith("PMax - Smiles spent $") and "25%" in dry["detail"]
    assert dry["stat_label"] == "0 conversions in 30 days"
    assert got["perf:conv-down"]["title"] == "Conversions down 50% on last week"


def test_good_weeks_are_wins_and_the_campaign_that_converts_best_is_an_opportunity():
    st = _st(daily=_daily(((100, 2), (100, 2), (100, 5))))
    got = {i["key"]: i for i in ai.performance(st, money)}
    assert got["perf:cpa-down"]["tone"] == "win" and got["perf:conv-up"]["tone"] == "win"
    st["campaigns"][0]["cpa"] = st["cpa"] * 0.5
    best = {i["key"]: i for i in ai.performance(st, money)}["perf:best:Search - Implants"]
    assert best["tone"] == "opportunity" and "cheaper than the account" in best["title"]


def test_spend_that_stopped_is_the_most_urgent_thing():
    daily = _daily(((100, 2), (100, 2), (100, 2)))
    for d in daily[-3:]:
        d["cost"], d["conv"] = 0, 0
    got = ai.performance(_st(daily=daily), money)
    stop = next(i for i in got if i["key"] == "perf:stopped")
    assert stop["title"] == "No spend since 16 Oct" and stop["severity"] == "critical"
    assert ai.rank(got)[0]["key"] == "perf:stopped"


def test_no_campaign_report_no_performance_insights():
    assert ai.performance(None, money) == []


# ── Google Ads: the Script's tabs ───────────────────────────────────────────
def _ins(other=False):
    acct = "Other Clinic" if other else "Lumina"
    return {
        "as_of": "2026-10-19",
        "budget_limited": {acct + "\u0001Search - Implants": 0.23, acct + "\u0001Search - Brand": 0.12},
        "budgets": [{"account": acct, "name": "Implants budget", "verdict": "capped", "projected": 9000, "monthly_cap": 7600, "cur": "USD"}],
        "ads": {"totals": {acct: {"disapproved": 2, "strength": {"POOR": {"n": 3, "cost": 600}, "AVERAGE": {"n": 1, "cost": 200},
                                                                "GOOD": {"n": 4, "cost": 600}}}}},
        "actions": [{"account": acct, "name": "Lead form", "flags": [["info", "Primary, but recorded no conversions in the last 30 days. Check the tag still fires."]]},
                    {"account": acct, "name": "Page view", "flags": [["warn", "A page view action is primary, so bidding optimises for it as if it were a lead or sale."]]}],
        "terms": {"totals": {acct: {"cost": 1000.0, "wasted": 420.0, "wasted_terms": 57, "cur": "USD"}}},
    }


def test_the_scripts_tabs_give_budgets_ads_tracking_and_search_terms():
    got = {i["key"]: i for i in ai.script_insights(_ins(), ["Lumina"], money)}
    assert got["ins:limited"]["title"] == "2 campaigns lose impressions to budget" and got["ins:limited"]["stat"] == "23%"
    assert got["ins:capped:Implants budget"]["tone"] == "watch"
    assert got["ins:disapproved"]["title"] == "2 ads disapproved" and got["ins:disapproved"]["source"] == "ad-strength"
    assert got["ins:weak-ads"]["stat"] == "57%"
    assert got["ins:silent-actions"]["title"] == "\u201cLead form\u201d recorded no conversions in 30 days"
    assert got["ins:silent-actions"]["stat"] == "0" and got["ins:silent-actions"]["stat_label"] == "conversions in 30 days"
    assert got["ins:silent-actions"]["severity"] == "critical"
    assert got["ins:soft-actions"]["title"] == "Bidding optimises for \u201cPage view\u201d"
    wasted = got["ins:wasted-terms"]
    assert wasted["tone"] == "fix" and wasted["stat"] == "$420" and "57 search terms" in wasted["detail"]
    assert wasted["source"] == "search-query-analysis"


def test_another_accounts_rows_in_the_same_tabs_are_never_read():
    assert ai.script_insights(_ins(other=True), ["Lumina"], money) == []


# ── The Pacing Desk and the master doc ───────────────────────────────────────
def _plan(allocated=None, cpa=None):
    return [{"client": "Lumina", "account": "Lumina", "allocated": allocated, "targetCpa": cpa, "channel": "Google"}]


def test_the_months_budget_is_held_against_what_is_being_spent():
    st = _st()        # data through 19 Oct: 19 of 31 days
    over = ai.targets(_plan(3000), st, 2600.0, money)
    assert over[0]["key"] == "pace:over" and over[0]["tone"] == "fix"
    assert over[0]["title"] == "On course to overspend October's budget by $1,242" and over[0]["stat"] == "$4,242"
    under = ai.targets(_plan(3000), st, 1100.0, money)
    assert under[0]["key"] == "pace:under" and "underspend" in under[0]["title"]
    on = ai.targets(_plan(3000), st, 1850.0, money)
    assert on[0]["key"] == "pace:on" and on[0]["tone"] == "win"


def test_no_budget_is_a_to_do_but_an_unreadable_desk_says_nothing():
    st = _st()
    keys = [i["key"] for i in ai.targets([], st, 100.0, money)]
    assert "pace:none" in keys and "doc:goals" in keys
    assert "pace:none" not in [i["key"] for i in ai.targets(None, st, 100.0, money)]
    assert "doc:goals" not in [i["key"] for i in ai.targets([], st, 100.0, money, profile_goals="120 leads a month")]


def test_the_target_cost_per_conversion_is_judged():
    st = _st()        # $3,280 for 53 conversions: $61.89
    over = {i["key"]: i for i in ai.targets(_plan(5000, 50), st, 3000.0, money)}["target:cpa-over"]
    assert over["title"] == "Cost per conversion 24% over target" and over["stat_label"] == "target $50"
    met = {i["key"]: i for i in ai.targets(_plan(5000, 90), st, 3000.0, money)}["target:cpa-met"]
    assert met["tone"] == "win"


def test_the_pacing_desk_rows_are_found_by_any_of_the_accounts_names():
    saved = [{"client": "Allure", "account": "AA_New", "allocated": 900, "channel": "Google"},
             {"client": "Allure", "account": "AA_New", "allocated": 400, "channel": "Meta"},
             {"client": "Other", "account": "Other Ads", "allocated": 5000, "channel": "Google"}]
    assert ai.plan_rows(saved, ["AllureAvani", "AA_New"]) == [saved[0]]
    assert ai.plan_rows(saved, ["Nobody"]) == []
    by_client = [{"client": "Core Care Clinic", "account": "CCC Search", "allocated": 3000, "channel": "Google"}]
    assert ai.plan_rows(by_client, ["Core Care Clinic"]) == by_client


def test_month_to_date_counts_only_this_months_days_of_the_accounts_own_rows():
    rows = [{"account": "Lumina", "day": "2026-09-30", "cost": 50, "cost_native": 50, "currency_native": "USD"},
            {"account": "Lumina", "day": "2026-10-01", "cost": 10, "cost_native": 10, "currency_native": "USD"},
            {"account": "Lumina", "day": "2026-10-19", "cost": 20, "cost_native": 20, "currency_native": "USD"},
            {"account": "Other", "day": "2026-10-05", "cost": 999, "cost_native": 999, "currency_native": "USD"}]
    assert ai.month_to_date(rows, ["Lumina"], "2026-10-19") == (30.0, "USD")


# ── The AI review ────────────────────────────────────────────────────────────
REPORT = {"overall": "off_track", "headline": "Leads are half the target and PMax eats the budget",
          "scorecard": [{"objective": "Leads a month", "target": "120", "actual": "58", "status": "off_track", "evidence": "58 leads in 30 days."},
                        {"objective": "Cost per lead", "target": "$60", "actual": "$55", "status": "met"}],
          "actions": [{"priority": "P1", "title": "Move $1,500 from PMax to Search - Implants", "what_to_do": "Cut PMax to $40 a day.",
                       "expected_impact": "+20 leads a month"},
                      {"priority": "P2", "title": "Add negatives", "what_to_do": "…"}]}


def test_the_ai_review_says_where_the_account_stands_and_what_to_do_first():
    row = {"id": 4, "status": "complete", "created_at": "2026-10-15T08:00:00+00:00", "finished_at": "2026-10-15T08:10:00+00:00"}
    got = {i["key"]: i for i in ai.review(row, REPORT, NOW)}
    assert got["review:overall"]["title"] == "Leads are half the target and PMax eats the budget"
    assert got["review:overall"]["stat"] == "1 of 2" and got["review:overall"]["stat_label"] == "goals off track or at risk"
    assert got["review:goal:Leads a month"]["stat"] == "58" and got["review:goal:Leads a month"]["stat_label"] == "target 120"
    assert got["review:met"]["title"] == "1 goal met"
    p1 = got["review:action:Move $1,500 from PMax to Search - Implants"]
    assert p1["stat"] == "P1" and p1["detail"] == "Cut PMax to $40 a day."
    assert not any(k.startswith("review:action:Add") for k in got), "only the first-priority actions"
    assert "review:stale" not in got


def test_no_review_or_an_old_one_is_a_to_do():
    assert ai.review(None, None, NOW)[0]["key"] == "review:none"
    old = {"status": "complete", "finished_at": "2026-08-01T00:00:00+00:00"}
    assert "review:stale" in [i["key"] for i in ai.review(old, {"overall": "on_track"}, NOW)]


# ── The Paid Marketing agents ────────────────────────────────────────────────
def test_the_account_audits_worst_failures_and_its_grade():
    report = {"summary": {"score": 58, "grade": "D"},
              "fixFirst": [{"id": "g-conv-primary", "title": "No primary conversion action", "severity": "critical", "result": "fail",
                            "found": "None of the 4 conversion actions is primary."},
                           {"id": "g-neg", "title": "Few negatives", "severity": "high", "result": "warn", "found": "3 negatives."},
                           {"id": "g-x", "title": "Low thing", "severity": "low", "result": "fail", "found": ""}]}
    got = ai.audit(report, "2026-10-18T10:00:00+00:00", NOW)
    assert [i["title"] for i in got] == ["No primary conversion action", "Few negatives"]
    assert got[0]["tone"] == "fix" and got[1]["tone"] == "watch" and got[0]["stat"] == "Grade D"
    assert ai.audit(None, None, NOW)[0]["key"] == "audit:none"
    good = ai.audit({"summary": {"score": 91, "grade": "A"}, "fixFirst": []}, "2026-08-01T00:00:00+00:00", NOW)
    assert [i["key"] for i in good] == ["audit:good", "audit:stale"]


def test_landing_pages_experiments_and_qa():
    lp = ai.landing_pages({"summary": {"pagesAtRisk": 3, "spendAtRisk": 2100, "critical": 1},
                           "fixFirst": [{"id": "lp-404", "severity": "critical", "found": "2 pages answer 404.", "pages": ["a", "b"]}],
                           "catalog": {"lp-404": {"title": "Page not found"}}}, "2026-10-18")
    assert lp[0]["title"] == "3 landing pages put spend at risk" and lp[0]["stat"] == "$2,100"
    assert lp[1]["title"] == "Page not found" and lp[1]["stat"] == "2 pages"
    exp = ai.experiments({"needs": [{"kind": "apply", "title": "Headline test", "text": "B won by 18%.", "ref": "e1", "label": "Apply B"}],
                          "summary": {"winners": 1}}, "2026-10-18")
    assert exp[0]["tone"] == "opportunity" and exp[0]["stat"] == "Apply B" and len(exp) == 1
    qa = ai.qa([{"launch": {"id": 7, "campaignName": "Search - Veneers", "updatedAt": "2026-10-19"},
                 "summary": {"verdict": {"code": "not_ready"}, "failedBlocking": ["a", "b"], "percent": 80}},
                {"launch": {"id": 8, "campaignName": "PMax - New"}, "summary": {"verdict": {"code": "incomplete"}, "percent": 40}},
                {"launch": {"id": 9, "campaignName": "Done"}, "summary": {"verdict": {"code": "ready"}}}])
    assert [i["title"] for i in qa] == ["Search - Veneers is not ready to launch", "Finish the QC of PMax - New"]
    assert qa[0]["detail"] == "2 required checks failed in its QC."


def test_geo_audience_and_segment_insights_become_money_lost_or_room_to_grow():
    rows = [{"kind": "exclude", "severity": "action", "headline": "Exclude Pune", "evidence": "₹9,000, no leads.", "action": "Exclude it."},
            {"kind": "push", "severity": "action", "headline": "Raise bids in Mumbai", "evidence": "CPA 40% below.", "spendShare": 0.3},
            {"kind": "thin", "severity": "watch", "headline": "Thin data", "evidence": ""}]
    got = ai.report_insights("geo-performance", rows, "2026-10-18")
    assert [(i["tone"], i["title"]) for i in got] == [("fix", "Exclude Pune"), ("opportunity", "Raise bids in Mumbai")]
    assert got[0]["detail"] == "₹9,000, no leads. Exclude it." and got[1]["stat"] == "30%"


def test_ad_strength_asset_coverage_and_the_builds():
    s = ai.ad_strength({"summary": {"reviewed": 10, "belowGood": 4, "poor": 1, "average": 3, "impressionsBelowGood": 600, "impressions": 1000}}, "x")
    assert s[0]["title"] == "4 of 10 ads rated below Good" and s[0]["tone"] == "fix" and s[0]["stat"] == "60%"
    a = ai.assets({"summary": {"campaigns": 4, "withGaps": 2, "gaps": {"high": 3}, "disapprovedAssets": 1}}, "x")
    assert [i["title"] for i in a] == ["1 asset disapproved", "2 campaigns missing key assets"]
    kw = ai.builds("keywords", {"status": "done", "plan": {"plan": {"quickWins": [{"what": "Bid on 'dental implants cost'", "why": "1,900 searches."}]}}})
    assert kw[0]["tone"] == "opportunity" and kw[0]["source"] == "ppc-keyword-research"
    biz = ai.builds("business", {"status": "done", "plan": {"implications": {
        "questions": [{"area": "Offer", "question": "Is the free consult still on?", "why": "Ads lead with it.", "urgency": "high"},
                      {"question": "Low one", "urgency": "low"}], "advertiseFirst": ["Same-day implants"]}}})
    assert [i["title"] for i in biz] == ["Is the free consult still on?", "Advertise first: Same-day implants"]
    assert ai.builds("strategy", {"status": "running", "plan": {}}) == []


# ── Ranking and the briefing ────────────────────────────────────────────────
def test_the_most_important_comes_first_and_no_source_crowds_the_rest_out():
    items = [ai.item("account-audit", "fix", "Audit %d" % n, severity="high") for n in range(5)]
    items += [ai.item("pacing-desk", "win", "On pace"), ai.item("ai-review", "fix", "Off track", severity="critical"),
              ai.item("ai-review", "fix", "Off track", severity="critical")]
    got = ai.rank(items)
    assert got[0]["title"] == "Off track" and [i["source"] for i in got].count("account-audit") == ai.PER_SOURCE["problem"]
    assert [i["title"] for i in got].count("Off track") == 1, "one of each"
    assert got[-1]["tone"] == "win"


def test_a_bad_day_keeps_to_the_most_important_but_never_loses_its_best_win_or_first_to_do():
    items = [ai.item("src%d" % n, t, "%s %d" % (t, n), severity="high") for n in range(30) for t in ("fix", "watch", "opportunity", "todo")]
    items += [ai.item("ai-review", "fix", "Off track", severity="critical"), ai.item("ai-review", "win", "1 goal met")]
    got = ai.rank(items)
    tones = [i["tone"] for i in got]
    assert len(got) == ai.MAX_ITEMS and got[0]["title"] == "Off track"
    assert tones.count("fix") == ai.TONE_CAP["fix"] and set(tones) == {"fix", "watch", "opportunity", "win", "todo"}
    assert "1 goal met" in [i["title"] for i in got], "a source's good news is not crowded out by its own problems"


def test_a_small_week_is_worth_a_look_not_an_alarm():
    st = _st(daily=_daily(((20, 1), (20, 1), (60, 0.5))))      # 7 conversions the week before
    got = {i["key"]: i for i in ai.performance(st, money)}
    assert got["perf:cpa-up"]["tone"] == "watch" and got["perf:conv-down"]["tone"] == "watch"


def test_the_briefing_links_each_insight_to_its_agent_inside_the_account():
    items = [dict(ai.item("account-audit", "fix", "No primary conversion action", at="2026-10-18T10:00:00+00:00"), via="account-audit"),
             dict(ai.item("pacing-desk", "watch", "Overspending"), via="pacing-desk"),
             dict(ai.item("master-doc", "todo", "No goals in the master doc"), via="pacing-desk"),
             dict(ai.item("ai-review", "opportunity", "Shift budget"), via="ai-review"),
             dict(ai.item("google-ads", "win", "Conversions up"), via="google-ads")]
    reads = [{"key": k, "ok": True, "at": ""} for k in ("google-ads", "pacing-desk", "ai-review", "account-audit")] + \
            [{"key": "qa-agent", "ok": False, "at": ""}]
    b = ai.finish("lumina", items, reads, doc_url="https://docs.google.com/document/d/x/edit", now=NOW)
    by = {i["title"]: i for i in b["items"]}
    assert by["No primary conversion action"]["href"] == "/lumina/operational-agents/account-audit"
    assert by["No primary conversion action"]["when"] == "2 days ago" and by["No primary conversion action"]["label"] == "Fix now"
    assert by["Overspending"]["href"] == "/operational-agents/pacing-desk"
    assert by["Shift budget"]["href"] == "/lumina/google-ads/ai-review"
    assert by["Conversions up"]["href"] == "/lumina/google-ads"
    assert by["No goals in the master doc"]["href"].startswith("https://docs.google.com/") and by["No goals in the master doc"]["external"]
    assert b["counts"] == {"fix": 1, "watch": 1, "opportunity": 1, "win": 1, "todo": 1}
    assert [p["text"] for p in b["headline"]] == ["thing to fix now", "to watch", "opportunity", "win", "thing to do"]
    assert {r["key"]: r["n"] for r in b["read"]}["pacing-desk"] == 2 and b["read_ok"] == 4


def test_a_source_that_cannot_be_read_costs_only_its_own_insights():
    def broken():
        raise RuntimeError("no database")
    b = ai.gather({"slug": "lumina"}, {"pacing-desk": lambda: ([ai.item("pacing-desk", "win", "On pace")], "2026-10-19"),
                                       "qa-agent": broken}, money=money, now=NOW)
    assert [i["title"] for i in b["items"]] == ["On pace"]
    assert [(r["key"], r["ok"]) for r in b["read"]] == [("pacing-desk", True), ("qa-agent", False)]


def test_every_source_has_its_own_icon():
    with open(os.path.join(ROOT, "templates", "_agent_icons.html")) as f:
        icons = f.read()
    missing = [k for k in ai.SOURCES if 'slug == "%s"' % k not in icons and '"%s"' % k not in icons]
    assert missing == []


# ── The page ────────────────────────────────────────────────────────────────
def _row(account, cid, campaign, day, cost, conv):
    return {"account": account, "customer_id": cid, "campaign": campaign, "state": "Enabled", "type": "Search", "day": day,
            "clicks": 10.0, "impressions": 100.0, "cost": cost, "currency": "USD", "conversions": conv, "cost_native": cost,
            "currency_native": "USD"}


ROWS = ([_row("Lumina Smiles Dental", "412-118-3390", "Search - Implants", "2026-10-%02d" % d, 300, 3) for d in range(1, 20)]
        + [_row("Harbourline Realty", "610-224-8812", "Search - 2BHK Secret", "2026-10-%02d" % d, 900, 0) for d in range(1, 20)]
        + [_row("Harbourline Realty", "610-224-8812", "Search - Villas", "2026-10-%02d" % d, 100, 2) for d in range(1, 20)])


def _p(text):
    return {"paragraph": {"elements": [{"textRun": {"content": text + "\n"}}], "paragraphStyle": {"namedStyleType": "NORMAL_TEXT"}}}


DOC = {"title": "Master", "tabs": [
    {"tabProperties": {"title": "Lumina Smiles Dental"}, "documentTab": {"body": {"content": [_p("URL name: lumina"), _p("Goals / KPIs: 120 leads a month")]}}},
    {"tabProperties": {"title": "Harbourline Realty"}, "documentTab": {"body": {"content": [_p("URL name: harbourline")]}}}]}


@pytest.fixture
def site(monkeypatch):
    client_accounts_store.reset_memory()
    appmod._acct_reset()
    appmod._ACCT_INSIGHTS.clear()
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: ROWS)
    monkeypatch.setattr(appmod, "_acct_doc", lambda: (DOC, "https://docs.google.com/document/d/x/edit", None))
    monkeypatch.setattr(appmod, "GOOGLE_ADS_SHEET_ID", "")          # the Script's tabs: none in tests
    from tracker import paid_gads

    def never(*a, **k):
        raise AssertionError("the briefing never asks Google Ads")
    monkeypatch.setattr(paid_gads, "search", never)
    monkeypatch.setattr(paid_gads, "_post", never)
    yield
    client_accounts_store.reset_memory()
    appmod._acct_reset()
    appmod._ACCT_INSIGHTS.clear()


def _client(email=STAFF):
    c = appmod.app.test_client()
    if email:
        with c.session_transaction() as sess:
            sess["google_user"] = {"email": email, "name": "T"}
    return c


def _text(html):
    return re.sub(r"\s+", " ", re.sub(r"<svg.*?</svg>", "", html, flags=re.S))


def test_staff_see_the_briefing_of_one_account_and_nothing_of_another(site):
    lumina = _text(_client().get("/lumina/insights").get_data(as_text=True))
    harbour = _text(_client().get("/harbourline/insights").get_data(as_text=True))
    assert "Search - 2BHK Secret spent $17,100 with no conversions" in harbour
    assert 'href="/harbourline/operational-agents/performance-summarizer"' in harbour
    assert "2BHK" not in lumina and "Harbourline" not in lumina and "/harbourline/" not in lumina
    assert "Lumina Smiles Dental alone" in lumina
    assert "No goals in the master doc" in harbour and "No goals in the master doc" not in lumina, "Lumina's tab has its goals"


def test_the_briefing_is_staff_only(site):
    assert _client(None).get("/lumina/insights").status_code == 401
    assert _client("someone@client.example").get("/lumina/insights").status_code in (403, 404)


def test_the_briefing_is_reused_until_read_again(site, monkeypatch):
    calls = []
    real = appmod._acct_insight_sources

    def counted(acct):
        calls.append(acct["slug"])
        return real(acct)
    monkeypatch.setattr(appmod, "_acct_insight_sources", counted)
    c = _client()
    c.get("/lumina/insights")
    c.get("/lumina/insights")
    assert calls == ["lumina"]
    c.get("/lumina/insights?fresh=1")
    assert calls == ["lumina", "lumina"]


def test_a_briefing_that_fails_to_build_says_so_and_keeps_the_home_up(site, monkeypatch):
    def boom(acct, fresh=False):
        raise RuntimeError("down")
    monkeypatch.setattr(appmod, "_acct_briefing", boom)
    r = _client().get("/lumina/insights")
    assert r.status_code == 200 and "The briefing could not be read just now." in r.get_data(as_text=True)


def test_the_home_holds_the_briefing_for_staff_and_not_for_a_client(site):
    home = _client().get("/lumina").get_data(as_text=True)
    assert 'data-insights="/lumina/insights"' in home and "account-insights.js" in home and "account-insights.css" in home
    assert home.index('id="briefing"') < home.index('id="as-mods-h"'), "the first section under the numbers"


def test_the_briefing_draws_every_kind_with_its_dial_filters_and_links(site, monkeypatch):
    spread = [("ai-review", "fix"), ("account-audit", "fix"), ("google-ads", "fix"), ("pacing-desk", "fix"),
              ("landing-page-check", "watch"), ("geo-performance", "watch"), ("ad-strength", "watch"),
              ("experiment-tracker", "opportunity"), ("ppc-keyword-research", "opportunity"), ("pacing-desk", "win"),
              ("business-research", "todo")]
    items = [dict(ai.item(src, t, "%s from %s" % (t, src), severity="critical" if n == 0 else ""), via=src)
             for n, (src, t) in enumerate(spread)]
    b = ai.finish("lumina", items, [{"key": k, "ok": True, "at": ""} for k in dict.fromkeys(s for s, _ in spread)] +
                  [{"key": "qa-agent", "ok": False, "at": ""}], now=NOW)
    monkeypatch.setattr(appmod, "_acct_briefing", lambda acct, fresh=False: b)
    html = _client().get("/lumina/insights").get_data(as_text=True)
    assert html.count('class="ib-cell') == 11 and html.count("ib-card--lead") == 1
    assert 'class="ib-card ib-card--fix ib-card--lead is-critical"' in html
    assert html.count('class="ib-dial-seg') == 5
    assert 'data-ib-tone="opportunity"' in html and 'data-ib-via="qa-agent"' in html and "not readable" in html
    assert "Show all 11" in html
    assert re.search(r'<b class="ib-n" data-ib-count="4">4</b> things to fix now', html)
