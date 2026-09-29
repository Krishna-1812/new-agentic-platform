"""Google Ads dashboard: the insights tabs (impression share, budget pacing,
search terms) -- the Google Ads Script that writes them, the reader that
shapes them, and the page that shows them.

The script is run under Node against fake AdsApp / SpreadsheetApp objects
(tests/google_ads_script_harness.js); the reader against a fake Sheets API;
nothing here calls Google."""

import json
import os
import shutil
import subprocess
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import app as appmod  # noqa: E402
from tracker import google_ads_insights as gai  # noqa: E402

NODE = shutil.which("node")


def _harness(*args):
    out = subprocess.run([NODE, os.path.join(ROOT, "tests", "google_ads_script_harness.js")] + list(args),
                         capture_output=True, text=True, timeout=60, check=True)
    return json.loads(out.stdout)


# ── The Google Ads Script ────────────────────────────────────────────────────

def _raw(res):
    return {k: res["tabs"][t] for k, t in gai.TABS.items() if t in res["tabs"]}


# The harness answers each daily query with every fake row on two days, 26 Sep (the last exported day)
# and 19 Sep, so a whole-window total is twice the row and the 20-26 Sep total is the row itself.
LAST_WEEK = {"start": "2026-09-20", "end": "2026-09-26"}


@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_the_script_writes_its_tabs_after_the_campaign_report():
    res = _harness()
    assert res["order"][0] == "Campaign report", "the report the dashboard already reads stays first"
    assert res["order"][1:] == [gai.TABS[k] for k in ("is", "budgets", "terms", "keywords", "devices", "hours",
                                                      "locations", "conversions", "actions", "ads", "combos",
                                                      "ad_assets", "changes", "health", "recs", "demographics",
                                                      "landing", "about")]
    about = dict(tuple(r) for r in res["tabs"][gai.TABS["about"]][1:])
    assert about["Daily detail"].startswith("2026-06-29 to 2026-09-26 (90 days"), "yesterday and the 89 days before"


@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_the_old_weekly_tab_is_removed_once_impression_share_is_daily():
    res = _harness("oldweekly")
    assert "Insights - IS weekly" not in res["order"], "the weekly trend is now built from the daily figures"


@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_every_daily_row_carries_its_days_and_the_window_totals():
    tabs = _harness()["tabs"]
    head = tabs[gai.TABS["terms"]][0]
    row = next(r for r in tabs[gai.TABS["terms"]][1:] if r[head.index("Search term")] == "free crm software")
    daily = json.loads(row[head.index("Daily")])
    assert daily["v"] == 1 and daily["from"] == "2026-06-29"
    assert [d[0] for d in daily["d"]] == [82, 89], "19 and 26 Sep, counted from 29 Jun"
    assert daily["d"][1] == [89, 60, 5400, 0, 0], "clicks, cost, conversions, conv. value"
    assert row[head.index("Cost")] == 10800 and row[head.index("Date range")] == "2026-06-29 to 2026-09-26"


@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_the_script_keeps_googles_share_limits_and_reads_money_from_micros():
    raw = _raw(_harness())
    ins = gai.build(raw)
    generic = next(r for r in ins["is"] if r["campaign"] == "Generic - Search")
    assert generic["is"] == pytest.approx(0.0999, abs=1e-6) and generic["lb"] == pytest.approx(0.9001, abs=1e-6)
    assert generic["approx"], "built from Google's <10% and >90% markers"
    assert generic["cost"] == 240000.0 and generic["impr"] == 40000
    brand = next(r for r in ins["is"] if r["campaign"] == "Brand - Search")
    assert brand["is"] == pytest.approx(0.92) and brand["top"] == pytest.approx(0.9) and not brand["approx"]
    pmax = next(r for r in ins["is"] if r["campaign"] == "PMax - All")
    assert pmax["is"] is None, "no search share for Performance Max: unknown, not zero"
    assert ins["weekly_grain"] == "week" and sum(w["impr"] for w in ins["weekly"]) == 48000, \
        "the trend counts search impressions only (Brand and Generic, both days)"
    camps = {c["campaign"]: c for c in ins["budget_campaigns"]}
    assert camps["Generic - Search"]["tcpa"] == 2500.0 and camps["PMax - All"]["troas"] == 4.5
    shared = next(b for b in ins["budgets"] if b["name"] == "Shared generic")
    assert shared["shared"] and sorted(shared["campaigns"]) == ["Generic - Search", "PMax - All"]
    assert shared["recommended"] == 8000.0
    term = next(r for r in ins["terms"]["rows"] if r[3] == "free crm software")
    assert term[5] == "crm software" and term[4] == "BROAD" and term[10] == 10800.0
    assert ins["as_of"].startswith("2026-09-27")
    week = gai.build(raw, **LAST_WEEK)
    assert next(r for r in week["is"] if r["campaign"] == "Generic - Search")["cost"] == 120000.0, "one day in range"
    assert week["weekly_grain"] == "day" and [w["week"] for w in week["weekly"]] == ["2026-09-26"]
    assert next(r for r in week["terms"]["rows"] if r[3] == "free crm software")[10] == 5400.0


@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_the_script_exports_keywords_devices_hours_locations_and_conversions():
    ins = gai.build(_raw(_harness()))
    kw = {k["kw"]: k for k in ins["keywords"]["rows"]}
    crm = kw["crm software"]
    assert crm["qs"] == 4 and crm["ctr"] == "BELOW_AVERAGE" and crm["landing"] == "BELOW_AVERAGE"
    assert crm["bid"] == 40.0 and crm["first_page"] == 55.0 and crm["cost"] == 22000.0
    assert crm["is"] == pytest.approx(0.35, abs=1e-6)
    assert kw["acme"]["qs"] is None and kw["acme"]["bid"] is None, "no Quality Score is unknown, not zero"
    assert {d["device"] for d in ins["devices"]} == {"MOBILE", "DESKTOP"}
    assert {(h["day"], h["hour"]) for h in ins["hours"]} == {(5, 10), (5, 2)}, "19 and 26 Sep are Saturdays (Monday is 0)"
    assert ins["meta"]["hours"]["weekdays"] == [13, 13, 13, 13, 13, 13, 12], "how many of each weekday the window holds"
    locs = ins["locations"]["rows"]
    assert (locs[0]["country"], locs[0]["region"], locs[0]["city"]) == ("India", "Maharashtra", "Mumbai")
    assert locs[1]["region"] == "Location 99999", "an unnamed place keeps its id rather than vanishing"
    acts = {a["name"]: a for a in ins["actions"]}
    assert acts["Lead form"]["primary"] and acts["Lead form"]["counting"] == "MANY_PER_CLICK"
    assert acts["Lead form"]["all"] == 128.0 and acts["Pricing page view"]["conv"] == 60.0


@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_the_script_exports_ads_what_google_served_and_each_headline():
    ins = gai.build(_raw(_harness()))
    ads = {a["id"]: a for a in ins["ads"]["rows"]}
    crm, brand, pmax = ads["801"], ads["802"], ads["91"]
    assert crm["kind"] == "RSA" and crm["strength"] == "AVERAGE" and crm["pinned"] == 1
    assert [h["t"] for h in crm["heads"]][:2] == ["Free CRM Trial", "Rated #1 by Users"]
    assert crm["cost"] == 18000.0 and crm["impr"] == 3800, "metrics joined from the daily query"
    assert [c["heads"] for c in crm["combos"]] == [["Rated #1 by Users", "Start in 5 Minutes"],
                                                  ["Free CRM Trial", "Rated #1 by Users"]], "most served first"
    assert crm["combos"][1]["descs"] == ["No credit card needed."]
    labels = {x["t"]: x["label"] for x in crm["assets"]}
    assert labels == {"Free CRM Trial": "BEST", "No credit card needed.": "LOW"}
    assert brand["approval"] == "DISAPPROVED" and "TRADEMARKS_IN_AD_TEXT" in brand["topics"]
    assert brand["impr"] == 0 and brand in ins["ads"]["rows"], "a live ad with no impressions is still listed"
    assert pmax["kind"] == "ASSET_GROUP" and pmax["strength"] == "GOOD" and pmax["cost"] == 60000.0
    assert pmax["combos"][0]["category"] == "IMAGE"
    assert pmax["combos"][0]["parts"][0]["img"] == "https://tpc.googlesyndication.com/simgad/123"


@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_the_script_exports_changes_scores_recommendations_audiences_and_landing_pages():
    raw = _raw(_harness())
    ins = gai.build(raw)
    ch = ins["changes"]["rows"]
    assert [c["kind"] for c in ch] == ["budget", "bidding", "keywords"], "newest first, each classified"
    assert ch[0]["diffs"] == [["amount_micros", 5000, 8000]], "budget micros become money, old and new"
    assert ch[1]["diffs"][1] == ["target_impression_share.location_fraction_micros", 0.5, 0.9]
    assert ch[2]["item"] == "crm for startups" and ch[2]["diffs"][0] == ["keyword.text", None, "crm for startups"]
    t = ins["changes"]["totals"]["__all__"]
    assert t["auto"] == 1 and t["people"] == 1 and t["kinds"]["budget"] == 1
    assert t["day_kinds"]["2026-09-25"] == {"budget": 1}
    assert [c["day"] for c in gai.build(raw, **LAST_WEEK)["changes"]["rows"]] == ["2026-09-25", "2026-09-20"], \
        "only the changes made in the dates picked"
    h = ins["health"]
    assert h["accounts"][0]["score"] == 0.72 and h["overall"] == 0.72
    assert {c["campaign"]: c["score"] for c in h["campaigns"]} == {"Brand - Search": 0.95, "Generic - Search": 0.61,
                                                                   "PMax - All": None}
    recs = ins["recs"]["rows"]
    budget = next(r for r in recs if r["type"] == "CAMPAIGN_BUDGET")
    assert budget["campaign"] == "Generic - Search", "campaign named from the optimization query"
    assert (budget["budget_now"], budget["budget_rec"]) == (5000.0, 8000.0)
    assert budget["gain"]["conv"] == 8.0 and budget["gain"]["cost"] == 21000.0
    assert next(r for r in recs if r["type"] == "KEYWORD")["detail"] == "crm pricing (PHRASE)"
    assert next(r for r in recs if r["type"] == "RESPONSIVE_SEARCH_AD_ASSET")["gain"] is None, "no impact: unknown, not zero"
    age = {d["label"]: d for d in ins["demographics"] if d["dim"] == "Age"}
    assert age["25–34"]["cost"] == 90000.0 and age["25–34"]["impr"] == 14000, "ad groups summed per campaign"
    assert age["65+"]["conv"] == 0
    lp = ins["landing"]
    assert [x["speed"] for x in lp["rows"]] == [3, 8] and lp["rows"][0]["mobile"] == 0.62
    assert round(lp["totals"]["__all__"]["avg_speed"], 2) == round((3 * 120000 + 8 * 27000) / 147000, 2)


@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_capped_lists_roll_the_rest_up_per_campaign_so_totals_stay_whole():
    raw = _raw(_harness("smallcaps"))
    ins = gai.build(raw)
    t = ins["terms"]
    assert [r[3] for r in t["rows"]] == ["free crm software"], "one term kept"
    assert t["totals"]["__all__"]["cost"] == 10800 + 1800 and t["totals"]["__all__"]["other_cost"] == 1800
    assert t["totals"]["__all__"]["terms"] == 1, "the rolled-up rest is counted in money, not as a term"
    camps = {("Acme", "Brand - Search"): {"types": {"Search"}, "states": {"Enabled"}},
             ("Acme", "Generic - Search"): {"types": {"Search"}, "states": {"Enabled"}}}
    brand = gai.build(raw, camps=camps, focus="Acme\u0001Brand - Search")["terms"]["totals"]["__all__"]
    assert brand["cost"] == 1800 and brand["terms"] == 0, "the rest belongs to its campaign, so a campaign filter keeps it"
    assert gai.build(raw, camps=camps, type_="Search")["keywords"]["totals"]["__all__"]["cost"] == 22000 + 1800


@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_an_account_result_too_large_for_google_is_cut_but_keeps_its_totals():
    res = _harness("tiny")
    assert any("result too large; terms cut" in line for line in res["logs"])
    t = gai.build(_raw(res))["terms"]["totals"]["__all__"]
    assert t["cost"] == 10800 + 1800, "what was cut is rolled up, not dropped"


def test_change_history_stays_inside_googles_limits():
    with open(os.path.join(ROOT, "scripts", "google_ads", "export_insights.js"), encoding="utf-8") as fh:
        src = fh.read()
    import re
    days = int(re.search(r"var CHANGE_DAYS = (\d+);", src).group(1))
    per = int(re.search(r"var CHANGES_PER_ACCOUNT = (\d+);", src).group(1))
    assert days < 30, "change_event: the date range must be within the past 30 days"
    assert per <= 10000, "change_event: LIMIT of at most 10,000 rows"
    assert "ORDER BY change_event.change_date_time DESC LIMIT" in src


def test_changes_are_classified_by_what_they_touch():
    k = gai.change_kind
    assert k("CAMPAIGN_BUDGET", "UPDATE", ["amount_micros"]) == "budget"
    assert k("CAMPAIGN", "UPDATE", ["maximize_conversions.target_cpa_micros"]) == "bidding"
    assert k("AD_GROUP_CRITERION", "UPDATE", ["cpc_bid_micros"]) == "bidding"
    assert k("AD_GROUP", "UPDATE", ["status"]) == "status"
    assert k("AD_GROUP_CRITERION", "CREATE", ["keyword.text", "status"]) == "keywords"
    assert k("AD_GROUP_AD", "CREATE", ["ad.responsive_search_ad.headlines"]) == "ads"
    assert k("CAMPAIGN_CRITERION", "CREATE", ["location.geo_target_constant"]) == "targeting"
    assert k("CAMPAIGN", "UPDATE", ["name"]) == "other"


def test_a_change_with_unreadable_values_still_lists_its_fields():
    head = ["Account", "Currency", "Changed at", "Resource type", "Operation", "Campaign", "Changed by",
            "Made through", "Fields changed", "Old values", "New values"]
    out = gai.parse_changes([head, ["A", "INR", "2026-09-20 10:00:00", "AD", "UPDATE", "S", "", "GOOGLE_ADS_API",
                                    "responsive_search_ad.headlines", "not json", ""]])
    row = out["rows"][0]
    assert row["fields"] == ["responsive_search_ad.headlines"] and row["diffs"] == [] and row["kind"] == "ads"
    assert out["totals"]["A"]["via"] == {"GOOGLE_ADS_API": 1} and out["totals"]["A"]["people"] == 0


def test_optimization_scores_are_averaged_with_googles_weight():
    accts = [{"score": 0.9, "weight": 1.0}, {"score": 0.5, "weight": 3.0}, {"score": None, "weight": 0.0}]
    assert gai.weighted_score(accts) == pytest.approx((0.9 + 1.5) / 4)
    assert gai.weighted_score([{"score": None, "weight": 0.0}]) is None, "unscored accounts: unknown"


def test_landing_speed_scores_outside_one_to_ten_are_unknown_and_percent_cells_read():
    head = ["Account", "Currency", "Landing page", "Speed score", "Mobile-friendly clicks", "Clicks", "Cost"]
    out = gai.parse_landing([head, ["A", "INR", "https://x.example/a", 0, "62%", 10, 5],
                             ["A", "INR", "https://x.example/b", 7, 0.8, 10, 4]])
    a, b = out["rows"]
    assert a["speed"] is None and a["mobile"] == 0.62
    assert b["speed"] == 7 and b["mobile"] == 0.8
    assert out["totals"]["A"]["avg_speed"] == 7.0, "only scored pages count toward the average"


def test_demographic_segments_are_labelled_and_ordered():
    assert gai.segment_label("AGE_RANGE_25_34") == "25–34"
    assert gai.segment_label("AGE_RANGE_65_UP") == "65+"
    assert gai.segment_label("UNDETERMINED") == "Unknown gender"
    head = ["Account", "Currency", "Campaign", "Dimension", "Segment", "Cost"]
    rows = gai.parse_demographics([head, ["A", "INR", "S", "Age", "AGE_RANGE_65_UP", 5],
                                   ["A", "INR", "S", "Age", "AGE_RANGE_18_24", 5], ["A", "INR", "S", "Region", "X", 5]])
    assert [r["order"] for r in rows] == [5, 0], "unknown dimensions are dropped"


def test_recommendation_types_get_plain_labels():
    assert gai.rec_label("CAMPAIGN_BUDGET") == "Raise a budget"
    assert gai.rec_label("SOME_NEW_TYPE") == "Some new type", "types added later still read"


@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_in_a_manager_account_the_busiest_accounts_are_exported():
    res = _harness("manager")
    accounts = {r[0] for r in res["tabs"][gai.TABS["budgets"]][1:]}
    assert accounts == {"Beta"}, "with the limit at one account, the one that spent most is chosen"
    assert "2 live client accounts under this manager account." in res["logs"], "the test account is skipped"
    assert any(l.startswith("Exporting 1 accounts: 222-222-2222") for l in res["logs"]), "progress is logged"


@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_an_unusable_sheet_time_zone_does_not_stop_the_about_tab():
    for args in (("badzone",), ("manager", "badzone"), ("manager", "badzone", "part=2")):
        res = _harness(*args)
        about = res["tabs"].get(gai.TABS["about"]) or res["tabs"][gai.TABS["about2"]]
        exported = dict((r[0], r[1]) for r in about[1:])["Exported at"]
        assert exported.endswith("(Asia/Kolkata)"), "falls back to the account's own time zone"


@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_the_script_can_be_split_into_two_parts_that_together_write_every_tab():
    one, two = _harness("manager", "part=1"), _harness("manager", "part=2")
    t1, t2 = set(one["order"][1:]), set(two["order"][1:])
    data = {t for k, t in gai.TABS.items() if k not in ("about", "about2")}
    assert t1 & t2 == set(), "no tab is written by both parts"
    assert (t1 | t2) - {gai.TABS["about"], gai.TABS["about2"]} == data
    assert gai.TABS["about"] in t1 and gai.TABS["about2"] in t2, "each part keeps its own About tab"
    assert gai.TABS["is"] in t1 and gai.TABS["changes"] in t2
    assert one["queries"] < _harness("manager")["queries"], "part 1 skips the part 2 queries"
    recs = gai.parse_recs(two["tabs"][gai.TABS["recs"]])
    assert recs["rows"][0]["campaign"] == "Generic - Search", "part 2 still names recommendation campaigns"
    ins = gai.build({"about": one["tabs"][gai.TABS["about"]], "about2": two["tabs"][gai.TABS["about2"]]})
    assert ("Part", "1 of 2") in [tuple(x) for x in ins["about"]] and ("Part", "2 of 2") in [tuple(x) for x in ins["about"]]


def test_the_script_uses_no_deprecated_account_filters():
    with open(os.path.join(ROOT, "scripts", "google_ads", "export_insights.js"), encoding="utf-8") as fh:
        src = fh.read()
    assert ".forDateRange(" not in src, "account selectors can no longer filter by performance"
    assert "PASTE_THE_GOOGLE_ADS_SHEET_URL_HERE" in src, "the sheet is set by whoever installs it, never committed"


# ── Reading the tabs ─────────────────────────────────────────────────────────

IS_HEAD = ["Account", "Currency", "Campaign ID", "Campaign", "Channel", "Impressions", "Clicks", "Cost",
           "Search IS", "Search lost IS (budget)", "Search lost IS (rank)", "Search click share"]


def test_blank_shares_are_unknown_and_formatted_cells_are_read():
    ins = gai.build({"is": [IS_HEAD,
                            ["A", "INR", "1", "Search one", "SEARCH", "1,000", "50", "2,500.50", "45%", "0.3", "", ""],
                            ["A", "INR", "2", "", "SEARCH", 1, 1, 1, "", "", "", ""]]})
    assert len(ins["is"]) == 1, "a row with no campaign is skipped"
    r = ins["is"][0]
    assert r["impr"] == 1000 and r["cost"] == 2500.5 and r["is"] == 0.45 and r["lb"] == 0.3
    assert r["lr"] is None and r["click"] is None


def _budget_row(**kw):
    base = {"Account": "A", "Currency": "INR", "Campaign ID": "1", "Campaign": "C1", "Budget ID": "9",
            "Budget name": "B", "Shared budget": False, "Daily budget": 1000, "Cost this month": 0,
            "Cost last 7 days": 7000, "Day of month": 16, "Days in month": 30, "Month elapsed (days)": 15.0}
    base.update(kw)
    return base


def _budgets(*rows):
    head = list(rows[0].keys())
    return gai.parse_budgets([head] + [[r.get(h, "") for h in head] for r in rows])[1]


def test_pacing_expected_projection_and_verdicts():
    on = _budgets(_budget_row(**{"Cost this month": 15000}))[0]
    assert on["expected"] == 15000 and on["pace"] == 1.0 and on["verdict"] == "on_track"
    assert on["projected"] == 15000 + 1000 * 15, "spend so far + the last 7 days' daily average for the rest"
    assert on["monthly_cap"] == 30400 and on["month_budget"] == 30000
    over = _budgets(_budget_row(**{"Cost this month": 18000, "Cost last 7 days": 5600}))[0]
    assert over["projected"] == 18000 + 800 * 15 and over["verdict"] == "over", "ahead, but under the monthly limit"
    ahead_and_capped = _budgets(_budget_row(**{"Cost this month": 18000}))[0]
    assert ahead_and_capped["verdict"] == "capped", "33,000 projected is past the 30,400 limit"
    under = _budgets(_budget_row(**{"Cost this month": 9000, "Cost last 7 days": 4200}))[0]
    assert under["verdict"] == "under"
    capped = _budgets(_budget_row(**{"Cost this month": 25000, "Cost last 7 days": 14000}))[0]
    assert capped["projected"] == 25000 + 2000 * 15 and capped["verdict"] == "capped"
    none = _budgets(_budget_row(**{"Daily budget": ""}))[0]
    assert none["verdict"] == "unknown"


def test_a_shared_budget_adds_up_its_campaigns():
    b = _budgets(_budget_row(**{"Shared budget": "TRUE", "Cost this month": 6000}),
                 _budget_row(**{"Campaign ID": "2", "Campaign": "C2", "Shared budget": "TRUE",
                                "Cost this month": 9000}))
    assert len(b) == 1 and b[0]["mtd"] == 15000 and b[0]["campaigns"] == ["C1", "C2"] and b[0]["shared"]


TERMS_HEAD = ["Account", "Currency", "Campaign", "Ad group", "Search term", "Search term match", "Keyword",
              "Status", "Impressions", "Clicks", "Cost", "Conversions"]


def test_search_terms_totals_cover_every_term_and_the_page_gets_the_costliest():
    rows = [TERMS_HEAD]
    for i in range(30):
        rows.append(["A" if i % 2 else "B", "INR", "C", "G", "term %d" % i, "BROAD", "kw", "NONE",
                     10, 2, float(i), 1 if i % 3 == 0 else 0])
    t = gai.parse_terms(rows, per_account=5, on_page=8)
    assert t["read"] == 30 and t["totals"]["__all__"]["terms"] == 30
    assert t["totals"]["__all__"]["cost"] == float(sum(range(30)))
    assert t["totals"]["__all__"]["wasted"] == float(sum(i for i in range(30) if i % 3 and i))
    assert t["totals"]["__all__"]["converting"] == 10
    assert len(t["rows"]) == 8 and t["rows"][0][3] == "term 29", "most expensive first"
    per = {}
    for r in t["rows"]:
        per[r[0]] = per.get(r[0], 0) + 1
    assert max(per.values()) <= 5, "no account crowds out the others"


KW_HEAD = ["Account", "Currency", "Campaign", "Ad group", "Keyword", "Match type", "Serving", "Quality Score",
           "Expected CTR", "Ad relevance", "Landing page experience", "Max CPC", "First page bid", "Impressions",
           "Clicks", "Cost", "Conversions"]


def test_quality_score_totals_are_impression_weighted_and_count_what_to_fix():
    k = gai.parse_keywords([KW_HEAD,
                            ["A", "INR", "C", "G", "cheap", "BROAD", "ELIGIBLE", 3, "BELOW_AVERAGE", "AVERAGE",
                             "BELOW_AVERAGE", 20, 35, 1000, 50, 3000, 0],
                            ["A", "INR", "C", "G", "brand", "EXACT", "RARELY_SERVED", 9, "ABOVE_AVERAGE",
                             "ABOVE_AVERAGE", "AVERAGE", "", 10, 3000, 300, 1000, 30],
                            ["B", "INR", "C", "G", "new", "PHRASE", "ELIGIBLE", "", "", "", "", 50, 40, 10, 1, 5, 0]])
    t = k["totals"]["__all__"]
    assert t["keywords"] == 3 and t["with_qs"] == 2
    assert t["avg_qs"] == round((3 * 1000 + 9 * 3000) / 4000, 2), "weighted by impressions, unrated left out"
    assert t["low_qs"] == 1 and t["low_qs_cost"] == 3000
    assert t["below_first_page"] == 1, "a blank max CPC (automated bidding) is not counted as below"
    assert t["rarely_served"] == 1
    assert t["parts"]["ctr"] == {"ABOVE_AVERAGE": 1000.0, "AVERAGE": 0.0, "BELOW_AVERAGE": 3000.0}
    assert t["dist"]["3"]["cost"] == 3000 and t["dist"]["9"]["keywords"] == 1
    assert k["totals"]["B"]["avg_qs"] is None


def test_hours_locations_and_devices_are_read_by_header():
    h = gai.parse_hours([["Account", "Day of week", "Hour", "Clicks", "Cost"], ["A", "SUNDAY", 23, 4, 10],
                         ["A", "FUNDAY", 1, 1, 1]])
    assert h == [{"account": "A", "cur": "", "tz": "", "day": 6, "hour": 23, "impr": 0.0, "clicks": 4.0,
                  "cost": 10.0, "conv": 0.0, "value": 0.0}]
    loc = gai.parse_locations([["Account", "Location type", "Country", "Region", "City", "Cost", "Conversions"],
                               ["A", "LOCATION_OF_PRESENCE", "India", "Delhi", "New Delhi", 900, 3],
                               ["A", "AREA_OF_INTEREST", "India", "Goa", "", 100, 0]])
    assert loc["totals"]["A"]["cost"] == 1000 and loc["totals"]["A"]["interest_cost"] == 100
    assert loc["rows"][0]["city"] == "New Delhi"
    dev = gai.parse_devices([["Account", "Campaign", "Device", "Cost"], ["A", "C", "MOBILE", 5], ["A", "C", "", 1]])
    assert [d["device"] for d in dev] == ["MOBILE"]


ACT_HEAD = ["Account", "Conversion action", "Category", "Status", "Primary for goal", "Counting"]


def test_conversion_setup_is_checked_against_googles_guidance():
    conv = gai.parse_conversions([["Account", "Campaign", "Conversion action", "Conversions", "All conversions"],
                                  ["A", "C", "Lead form", 10, 12], ["A", "C", "Contact page view", 0, 40],
                                  ["A", "C", "Purchase", 5, 5]])
    acts = {a["name"]: a for a in gai.parse_actions([
        ACT_HEAD,
        ["A", "Lead form", "SUBMIT_LEAD_FORM", "ENABLED", True, "MANY_PER_CLICK"],
        ["A", "Purchase", "PURCHASE", "ENABLED", True, "MANY_PER_CLICK"],
        ["A", "Contact page view", "PAGE_VIEW", "ENABLED", False, "ONE_PER_CLICK"],
        ["A", "Homepage view", "PAGE_VIEW", "ENABLED", True, "ONE_PER_CLICK"],
    ], conv)}
    assert acts["Lead form"]["flags"][0][0] == "warn" and "one per click for leads" in acts["Lead form"]["flags"][0][1]
    assert acts["Purchase"]["flags"] == [], "counting every purchase is what Google recommends for sales"
    assert acts["Contact page view"]["flags"] == [], "a secondary page view does not drive bidding"
    kinds = [f[0] for f in acts["Homepage view"]["flags"]]
    assert kinds == ["warn", "info"], "a primary page view, and one that recorded nothing"
    assert acts["Lead form"]["conv"] == 10 and acts["Lead form"]["all"] == 12


AD_HEAD = ["Account", "Currency", "Campaign", "Ad group ID", "Ad group", "Ad ID", "Kind", "Approval", "Policy topics",
           "Ad strength", "Headlines", "Descriptions", "Pinned", "Impressions", "Cost"]


def _ad(**kw):
    base = {"Account": "A", "Currency": "INR", "Campaign": "C", "Ad group ID": "1", "Ad group": "G", "Ad ID": "9",
            "Kind": "RSA", "Approval": "APPROVED", "Policy topics": "", "Ad strength": "EXCELLENT",
            "Headlines": json.dumps([{"t": "h%d" % i, "pin": ""} for i in range(15)]),
            "Descriptions": json.dumps([{"t": "d%d" % i, "pin": ""} for i in range(4)]), "Pinned": 0,
            "Impressions": 100, "Cost": 50}
    base.update(kw)
    return [base[h] for h in AD_HEAD]


def test_a_complete_approved_excellent_ad_has_nothing_to_fix():
    a = gai.parse_ads([AD_HEAD, _ad()])["rows"][0]
    assert a["flags"] == []


def test_ad_flags_follow_googles_own_rules():
    rows = gai.parse_ads([AD_HEAD,
                          _ad(**{"Ad ID": "1", "Approval": "DISAPPROVED", "Policy topics": "TRADEMARKS_IN_AD_TEXT (PROHIBITED)",
                                 "Impressions": 0}),
                          _ad(**{"Ad ID": "2", "Approval": "APPROVED_LIMITED", "Ad strength": "POOR", "Pinned": 2,
                                 "Headlines": json.dumps([{"t": "only", "pin": "HEADLINE_1"}])}),
                          _ad(**{"Ad ID": "3", "Impressions": 0})])["rows"]
    by = {a["id"]: [f[0] for f in a["flags"]] for a in rows}
    assert by["1"] == ["bad"], "disapproved: no 'no impressions' note on top, the reason is already clear"
    assert by["2"] == ["warn", "warn", "info", "info"], "limited, poor strength, 1 of 15 headlines, pinned"
    assert by["3"] == ["info"]
    two = next(a for a in rows if a["id"] == "2")
    assert "1 of 15 headlines" in two["flags"][2][1] and "pinning" in two["flags"][3][1]
    assert rows[0]["id"] == "1", "disapproved ads come first"


def test_served_assets_only_keep_https_images_and_real_video_ids():
    assert gai._part({"f": "MARKETING_IMAGE", "img": "javascript:alert(1)"}) is None
    assert gai._part({"f": "MARKETING_IMAGE", "img": "http://example.com/x.png"}) is None
    assert gai._part({"f": "YOUTUBE_VIDEO", "vid": "abc\"><script>"}) is None
    assert gai._part({"f": "YOUTUBE_VIDEO", "vid": "dQw4w9WgXcQ"}) == {"f": "YOUTUBE_VIDEO", "vid": "dQw4w9WgXcQ"}
    assert gai._part({"f": "HEADLINE_1", "x": "Hello"}) == {"f": "HEADLINE_1", "x": "Hello"}


def test_ad_totals_count_strength_by_spend_and_problems():
    t = gai.parse_ads([AD_HEAD, _ad(**{"Ad ID": "1", "Ad strength": "POOR", "Cost": 300}),
                       _ad(**{"Ad ID": "2", "Approval": "DISAPPROVED", "Cost": 0}),
                       _ad(**{"Ad ID": "3", "Kind": "ASSET_GROUP", "Ad strength": "GOOD", "Cost": 700,
                              "Headlines": "[]", "Descriptions": "[]"})])["totals"]["__all__"]
    assert t["ads"] == 3 and t["rsa"] == 2 and t["asset_groups"] == 1
    assert t["strength"]["POOR"] == {"n": 1, "cost": 300.0} and t["strength"]["GOOD"]["cost"] == 700.0
    assert t["disapproved"] == 1 and t["cost"] == 1000.0


class _Exec:
    def __init__(self, v):
        self.v = v

    def execute(self):
        return self.v


class _Values:
    def __init__(self, tabs, calls):
        self.tabs, self.calls = tabs, calls

    def batchGet(self, spreadsheetId, ranges, valueRenderOption, dateTimeRenderOption):  # noqa: N802,N803
        self.calls.append(ranges)
        return _Exec({"valueRanges": [{"values": self.tabs[r.split("'")[1]]} for r in ranges]})


class _Sheets:
    def __init__(self, tabs, calls):
        self.tabs, self.calls = tabs, calls

    def values(self):
        return _Values(self.tabs, self.calls)

    def get(self, spreadsheetId):  # noqa: N803
        return _Exec({"sheets": [{"properties": {"title": t}} for t in ["Report"] + list(self.tabs)]})


class _Svc:
    def __init__(self, tabs, calls):
        self.s = _Sheets(tabs, calls)

    def spreadsheets(self):
        return self.s


def test_only_tabs_that_exist_are_read_in_one_batch_and_cached():
    gai.reset()
    calls = []
    tabs = {gai.TABS["is"]: [IS_HEAD, ["A", "INR", "1", "S", "SEARCH", 10, 1, 5, 0.5, 0.2, 0.3, ""]]}
    ins = gai.fetch(lambda: _Svc(tabs, calls), "SHEET")
    assert ins["ok"] and len(ins["is"]) == 1 and ins["budgets"] == [] and ins["currencies"] == ["INR"]
    assert calls == [["'%s'!A:AZ" % gai.TABS["is"]]]
    gai.fetch(lambda: _Svc(tabs, calls), "SHEET")
    assert len(calls) == 1, "cached"
    gai.reset()


def test_a_failed_read_is_empty_never_an_error():
    gai.reset()

    def boom():
        raise RuntimeError("no credentials")
    ins = gai.fetch(boom, "SHEET")
    assert ins["ok"] is False and ins["error"] == "RuntimeError"
    gai.reset()


# ── The page ─────────────────────────────────────────────────────────────────

ROWS = [{"account": "A", "customer_id": "1", "campaign": "S", "state": "Enabled", "type": "Search",
         "day": "2026-09-20", "clicks": 1.0, "impressions": 10.0, "cost": 5.0, "currency": "INR",
         "conversions": 1.0, "view_through": 0.0, "top_pct": 0.0, "abs_top_pct": 0.0}]


def _client():
    c = appmod.app.test_client()
    with c.session_transaction() as sess:
        sess["google_user"] = {"email": "reporting@markifydigital.com", "name": "T"}
    return c


def test_the_page_shows_the_insights_panels_when_the_tabs_exist(monkeypatch):
    tabs = {gai.TABS["is"]: [IS_HEAD, ["A", "INR", "1", "S", "SEARCH", 10, 1, 5, 0.5, 0.2, 0.3, ""]]}
    ins = gai.build({"is": tabs[gai.TABS["is"]]})
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: ROWS)
    monkeypatch.setattr(appmod, "_google_ads_insights", lambda *a, **k: dict(ins, symbols={"INR": "₹"}))
    body = _client().get("/dashboards/google-ads").get_data(as_text=True)
    for pid in ("gai-share-panel", "gai-pace-panel", "gai-terms-panel", "gai-kw-panel", "gai-dev-panel",
                "gai-hour-panel", "gai-loc-panel", "gai-conv-panel", "gai-ads-panel", "gai-health-panel",
                "gai-chg-panel", "gai-demo-panel", "gai-lp-panel", "gad-insights"):
        assert 'id="%s"' % pid in body
    assert "google-ads-insights.js" in body
    assert body.index("google-ads-insights.js") < body.index("google-ads-dashboard.js"), \
        "the panels listen before the page's first render"


def test_without_the_tabs_the_page_explains_how_to_switch_them_on(monkeypatch):
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: ROWS)
    monkeypatch.setattr(appmod, "_google_ads_insights", lambda *a, **k: dict(gai.empty(), symbols={}))
    body = _client().get("/dashboards/google-ads").get_data(as_text=True)
    assert "scripts/google_ads/export_insights.js" in body
    assert 'id="gai-share-panel"' not in body and "google-ads-insights.js" not in body


def test_the_campaign_report_is_the_first_tab_that_is_not_an_insights_tab(monkeypatch):
    class Values:
        def get(self, spreadsheetId, range):  # noqa: A002,N803
            assert range == "'Campaign report'!A:Z"
            return _Exec({"values": [["Account name", "Campaign", "Day", "Clicks"], ["A", "S", "2026-09-20", "3"]]})

    class Sheets:
        def get(self, spreadsheetId):  # noqa: N803
            return _Exec({"sheets": [{"properties": {"title": gai.TABS["about"]}},
                                     {"properties": {"title": "Campaign report"}}]})

        def values(self):
            return Values()

    class Svc:
        def spreadsheets(self):
            return Sheets()
    monkeypatch.setattr(appmod, "GOOGLE_ADS_SHEET_ID", "SHEET")
    monkeypatch.setattr(appmod, "_ads_sheet_service", lambda: Svc())
    rows = appmod._fetch_google_ads_rows(force=True)
    assert rows and rows[0]["campaign"] == "S"


def test_the_panels_script_inserts_text_never_markup():
    with open(os.path.join(ROOT, "static", "js", "google-ads-insights.js"), encoding="utf-8") as fh:
        js = fh.read()
    assert "innerHTML" not in js and "insertAdjacentHTML" not in js and "outerHTML" not in js
    assert "eval(" not in js and "document.write" not in js


# ── Date ranges and filters ──────────────────────────────────────────────────

def _is_tab(*days, window="2026-09-01 to 2026-09-30"):
    """An impression-share tab with one campaign and the given days: (date, impressions, share, lost budget)."""
    d = [[gai._dt.date.fromisoformat(day).toordinal() - gai._dt.date(2026, 9, 1).toordinal()] +
         [0] * len(gai.IS_DAILY) for day, *_ in days]
    for row, (day, impr, s, lb) in zip(d, days):
        e = impr / s
        vals = dict(impr=impr, sg=impr, se=e, lbe=lb * e, capped=1 if s == 0.0999 else 0)
        for k, v in vals.items():
            row[1 + gai.IS_DAILY.index(k)] = v
    cell = json.dumps({"v": 1, "from": "2026-09-01", "d": d})
    return [["Account", "Currency", "Campaign", "Channel", "Date range", "Daily"],
            ["A", "INR", "S", "SEARCH", window, cell]]


def test_impression_share_for_a_range_is_rebuilt_from_eligible_impressions_not_averaged():
    tab = _is_tab(("2026-09-10", 900, 0.9, 0.05), ("2026-09-11", 100, 0.1, 0.8))
    r = gai.build({"is": tab})["is"][0]
    # 900 of 1,000 eligible, then 100 of 1,000: 1,000 of 2,000 = 50%, not the 50% average by luck of equal days...
    assert r["is"] == pytest.approx(0.5)
    assert r["lb"] == pytest.approx((0.05 * 1000 + 0.8 * 1000) / 2000)
    uneven = gai.build({"is": _is_tab(("2026-09-10", 900, 0.9, 0), ("2026-09-11", 100, 0.5, 0))})["is"][0]
    assert uneven["is"] == pytest.approx(1000 / 1200), "…and here the plain average (70%) would be wrong"
    one = gai.build({"is": tab}, start="2026-09-11", end="2026-09-11")["is"][0]
    assert one["is"] == pytest.approx(0.1) and one["impr"] == 100


def test_a_range_with_a_capped_day_is_marked_approximate():
    r = gai.build({"is": _is_tab(("2026-09-10", 900, 0.9, 0), ("2026-09-11", 50, 0.0999, 0.9001))})["is"][0]
    assert r["approx"]
    clean = gai.build({"is": _is_tab(("2026-09-10", 900, 0.9, 0), ("2026-09-11", 50, 0.0999, 0.9001))},
                      start="2026-09-10", end="2026-09-10")["is"][0]
    assert not clean["approx"] and clean["is"] == pytest.approx(0.9)


def test_the_trend_is_daily_for_a_month_or_less_and_weekly_beyond():
    tab = _is_tab(("2026-09-07", 100, 0.5, 0), ("2026-09-08", 100, 0.5, 0), ("2026-09-14", 100, 0.25, 0))
    assert gai.build({"is": tab}, start="2026-09-01", end="2026-09-30")["weekly_grain"] == "day"
    assert gai.build({"is": tab}, start="2026-08-01", end="2026-09-30")["weekly_grain"] == "day", \
        "61 days asked but only 30 held: the grain follows the days shown"
    tab = _is_tab(("2026-09-07", 100, 0.5, 0), ("2026-09-08", 100, 0.5, 0), ("2026-09-14", 100, 0.25, 0),
                  window="2026-07-01 to 2026-09-30")
    wk = gai.build({"is": tab}, start="2026-08-01", end="2026-09-30")
    assert wk["weekly_grain"] == "week"
    pts = {p["week"]: p for p in wk["weekly"]}
    assert set(pts) == {"2026-09-07", "2026-09-14"}, "weeks start on Monday"
    assert pts["2026-09-07"]["is"] == pytest.approx(0.5) and pts["2026-09-14"]["is"] == pytest.approx(0.25)


def test_a_range_outside_the_export_is_empty_and_says_so():
    ins = gai.build({"is": _is_tab(("2026-09-10", 900, 0.9, 0))}, start="2026-07-01", end="2026-07-31")
    assert ins["is"] == [] and ins["meta"]["is"]["cover"] is None
    part = gai.build({"is": _is_tab(("2026-09-10", 900, 0.9, 0))}, start="2026-08-15", end="2026-09-12")
    assert part["meta"]["is"]["cover"] == ["2026-09-01", "2026-09-12"], "the page says the figures start later"


def test_an_older_export_without_daily_figures_is_shown_as_it_was_and_flagged():
    ins = gai.build({"is": [IS_HEAD, ["A", "INR", "1", "S", "SEARCH", 1000, 50, 2500, 0.45, 0.3, "", ""]]},
                    start="2026-09-20", end="2026-09-26")
    assert len(ins["is"]) == 1 and ins["is"][0]["is"] == 0.45
    assert ins["meta"]["is"]["dated"] is False, "the page labels it 'last 30 days, as exported'"


CAMPS = {("A", "Brand"): {"types": {"Search"}, "states": {"Enabled"}},
         ("A", "PMax"): {"types": {"Performance Max"}, "states": {"Paused"}}}


def _devices_and_hours():
    cell = json.dumps({"v": 1, "from": "2026-09-01", "d": [[0, 10, 1, 100, 1, 0]]})
    dev = [["Account", "Campaign", "Device", "Date range", "Daily"],
           ["A", "Brand", "MOBILE", "2026-09-01 to 2026-09-30", cell], ["A", "PMax", "MOBILE", "2026-09-01 to 2026-09-30", cell],
           ["A", "Unknown", "MOBILE", "2026-09-01 to 2026-09-30", cell], ["B", "Brand", "MOBILE", "2026-09-01 to 2026-09-30", cell]]
    hrs = [["Account", "Hour", "Date range", "Daily"], ["A", 9, "2026-09-01 to 2026-09-30", cell],
           ["B", 9, "2026-09-01 to 2026-09-30", cell]]
    return {"devices": dev, "hours": hrs}


def test_campaign_panels_follow_type_status_search_and_focus_like_the_report():
    raw = _devices_and_hours()
    by = lambda **kw: sorted((d["account"], d["campaign"]) for d in gai.build(raw, camps=CAMPS, **kw)["devices"])
    assert by() == [("A", "Brand"), ("A", "PMax"), ("A", "Unknown"), ("B", "Brand")]
    assert by(type_="Search") == [("A", "Brand")], "a campaign the report does not know is left out under a type filter"
    assert by(status="Paused") == [("A", "PMax")]
    assert by(search="pmax") == [("A", "PMax")]
    assert by(search="b") == [("A", "Brand"), ("B", "Brand")], "search text matches campaign or account names"
    assert by(focus="A\u0001Brand") == [("A", "Brand")]
    assert by(account="B") == [("B", "Brand")]


def test_account_level_panels_follow_the_account_and_dates_but_not_campaign_filters():
    raw = _devices_and_hours()
    ins = gai.build(raw, camps=CAMPS, type_="Search", account="A")
    assert [(h["account"], h["hour"]) for h in ins["hours"]] == [("A", 9)]
    assert ins["meta"]["hours"]["scope"] == "account", "the page says the campaign filters do not apply"
    assert gai.build(raw, start="2026-09-02", end="2026-09-30")["hours"] == [], "the only day, 1 Sep, is outside"


def test_a_shared_budget_stays_whole_when_one_of_its_campaigns_is_filtered_in():
    head = ["Account", "Currency", "Campaign ID", "Campaign", "Budget ID", "Budget name", "Shared budget",
            "Daily budget", "Cost this month", "Cost last 7 days", "Day of month", "Days in month", "Month elapsed (days)"]
    raw = {"budgets": [head, ["A", "INR", "1", "Brand", "9", "Shared", True, 1000, 6000, 3500, 16, 30, 15.0],
                       ["A", "INR", "2", "PMax", "9", "Shared", True, 1000, 9000, 3500, 16, 30, 15.0]]}
    b = gai.build(raw, camps=CAMPS, type_="Search")["budgets"]
    assert len(b) == 1 and b[0]["mtd"] == 15000, "pace is worked out from the whole budget's spend"


def test_the_insights_api_answers_for_the_pages_filters(monkeypatch):
    seen = {}

    def fake(rows=None, force=False, **params):
        seen.update(params)
        return dict(gai.empty(), ok=True, params=params)
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: ROWS)
    monkeypatch.setattr(appmod, "_google_ads_insights", fake)
    c = _client()
    r = c.get("/api/dashboards/google-ads/insights?from=2026-09-20&to=2026-09-26&account=A&type=Search"
              "&status=Enabled&search=brand&focus=")
    assert r.status_code == 200 and r.get_json()["ok"]
    assert seen == {"start": "2026-09-20", "end": "2026-09-26", "account": "A", "type_": "Search",
                    "status": "Enabled", "search": "brand", "focus": ""}
    assert c.get("/api/dashboards/google-ads/insights?from=20-09-2026").status_code == 400


def test_the_page_opens_on_the_reports_whole_range(monkeypatch):
    seen = {}
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: ROWS + [dict(ROWS[0], day="2026-09-26")])
    monkeypatch.setattr(appmod, "_google_ads_insights", lambda rows=None, **kw: seen.update(kw) or gai.empty())
    _client().get("/dashboards/google-ads")
    assert (seen["start"], seen["end"]) == ("2026-09-20", "2026-09-26"), "the same range the page's 'All' shows"


def test_the_page_script_announces_every_filter_to_the_panels():
    with open(os.path.join(ROOT, "static", "js", "google-ads-dashboard.js"), encoding="utf-8") as fh:
        src = fh.read()
    for k in ("from: state.from", "to: state.to", "type: state.type", "status: state.status", "focus: state.focus"):
        assert k in src
    with open(os.path.join(ROOT, "static", "js", "google-ads-insights.js"), encoding="utf-8") as fh:
        ins = fh.read()
    assert "/api/dashboards/google-ads/insights?" in ins and "my !== seq" in ins, "stale answers are dropped"


# ── Currencies ───────────────────────────────────────────────────────────────

def _report(account, day, native, converted, nat_cur, cur="INR"):
    return {"account": account, "campaign": "C", "day": day, "cost": converted, "currency": cur,
            "cost_native": native, "currency_native": nat_cur}


def test_googles_own_rate_comes_from_the_campaign_report_per_account_and_day():
    fx = gai.FX([_report("US", "2026-09-10", 10.0, 830.0, "USD"), _report("US", "2026-09-10", 5.0, 415.0, "USD"),
                 _report("US", "2026-09-12", 10.0, 845.0, "USD"), _report("IN", "2026-09-10", 100.0, 100.0, "INR")])
    assert fx.to == "INR"
    assert fx.rate("US", "2026-09-10") == pytest.approx(83.0) and fx.rate("US", "2026-09-12") == pytest.approx(84.5)
    assert fx.rate("US", "2026-09-11") == pytest.approx(83.0), "a day without spend takes the day before's rate"
    assert fx.rate("US", "2026-09-01") == pytest.approx(83.0), "…or the first one known"
    assert fx.latest("US") == pytest.approx(84.5)
    assert fx.converts("US", "USD") and not fx.converts("IN", "INR") and not fx.converts("CA", "CAD")


def _usd_devices():
    cell = json.dumps({"v": 1, "from": "2026-09-10", "d": [[0, 100, 10, 10.0, 1, 20.0], [2, 100, 10, 10.0, 1, 0]]})
    head = ["Account", "Currency", "Campaign", "Device", "Date range", "Daily"]
    return {"devices": [head, ["US", "USD", "C", "MOBILE", "2026-09-10 to 2026-09-12", cell],
                        ["IN", "INR", "C", "MOBILE", "2026-09-10 to 2026-09-12", cell],
                        ["CA", "CAD", "C", "MOBILE", "2026-09-10 to 2026-09-12", cell]]}


def test_money_is_converted_day_by_day_into_the_reports_currency():
    fx = gai.FX([_report("US", "2026-09-10", 10.0, 830.0, "USD"), _report("US", "2026-09-12", 10.0, 845.0, "USD"),
                 _report("IN", "2026-09-10", 1.0, 1.0, "INR")])
    ins = gai.build(_usd_devices(), fx=fx)
    by = {d["account"]: d for d in ins["devices"]}
    assert by["US"]["cost"] == pytest.approx(10 * 83 + 10 * 84.5) and by["US"]["cur"] == "INR"
    assert by["US"]["value"] == pytest.approx(20 * 83) and by["US"]["native_cur"] == "USD"
    assert by["US"]["clicks"] == 20, "counts are never converted"
    assert by["IN"]["cost"] == 20.0 and by["IN"]["cur"] == "INR"
    assert by["CA"]["cur"] == "CAD" and by["CA"]["cost"] == 20.0, "no rate for CAD: kept in CAD, not guessed"
    assert ins["fx"] == {"to": "INR", "converted": {"USD": ["US"]}, "kept": {"CAD": ["CA"]}}


def test_without_a_rate_other_currencies_are_never_added_to_the_main_one():
    head = TERMS_HEAD
    t = gai.parse_terms([head, ["A", "INR", "C", "G", "a", "BROAD", "kw", "NONE", 1, 1, 100.0, 1],
                         ["B", "USD", "C", "G", "b", "BROAD", "kw", "NONE", 1, 1, 5.0, 0]])
    assert t["totals"]["__all__"]["cost"] == 100.0 and t["totals"]["__all__"]["mixed"]
    assert t["totals"]["B"]["cost"] == 5.0 and t["totals"]["B"]["cur"] == "USD"


def test_the_page_warns_when_the_campaign_report_mixes_currencies(monkeypatch):
    rows = [dict(ROWS[0]), dict(ROWS[0], account="B", currency="USD")]
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: rows)
    monkeypatch.setattr(appmod, "_google_ads_insights", lambda *a, **k: gai.empty())
    assert "Currencies are mixed" in _client().get("/dashboards/google-ads").get_data(as_text=True)
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: ROWS)
    assert "Currencies are mixed" not in _client().get("/dashboards/google-ads").get_data(as_text=True)


def test_landing_speed_row_without_metrics_does_not_fail_the_query():
    # Google leaves out the metrics object when a page has no speed score and no click shares.
    tabs = _harness()["tabs"]
    failed = [r for rows in tabs.values() for r in rows if r and r[0] == "Query failed"]
    assert not failed, failed
