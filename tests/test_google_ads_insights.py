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

@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_the_script_writes_its_tabs_after_the_campaign_report():
    res = _harness()
    assert res["order"][0] == "Campaign report", "the report the dashboard already reads stays first"
    assert res["order"][1:] == [gai.TABS[k] for k in ("is", "weekly", "budgets", "terms", "keywords", "devices", "hours",
                                                      "locations", "conversions", "actions", "ads", "combos",
                                                      "ad_assets", "changes", "health", "recs", "demographics",
                                                      "landing", "about")]


@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_the_script_keeps_googles_share_limits_and_reads_money_from_micros():
    tabs = _harness()["tabs"]
    ins = gai.build({"is": tabs[gai.TABS["is"]], "weekly": tabs[gai.TABS["weekly"]],
                     "budgets": tabs[gai.TABS["budgets"]], "terms": tabs[gai.TABS["terms"]],
                     "about": tabs[gai.TABS["about"]]})
    generic = next(r for r in ins["is"] if r["campaign"] == "Generic - Search")
    assert generic["is"] == 0.0999 and generic["lb"] == 0.9001, "Google's <10% and >90% markers are kept"
    assert generic["cost"] == 120000.0
    pmax = next(r for r in ins["is"] if r["campaign"] == "PMax - All")
    assert pmax["is"] is None, "no search share for Performance Max: unknown, not zero"
    assert [w["campaign"] for w in ins["weekly"]] == ["Brand - Search"], "non-search campaigns are left out"
    camps = {c["campaign"]: c for c in ins["budget_campaigns"]}
    assert camps["Generic - Search"]["tcpa"] == 2500.0 and camps["PMax - All"]["troas"] == 4.5
    shared = next(b for b in ins["budgets"] if b["name"] == "Shared generic")
    assert shared["shared"] and sorted(shared["campaigns"]) == ["Generic - Search", "PMax - All"]
    assert shared["recommended"] == 8000.0
    term = next(r for r in ins["terms"]["rows"] if r[3] == "free crm software")
    assert term[5] == "crm software" and term[4] == "BROAD" and term[10] == 5400.0
    assert ins["as_of"].startswith("2026-09-27")


@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_the_script_exports_keywords_devices_hours_locations_and_conversions():
    tabs = _harness()["tabs"]
    ins = gai.build({k: tabs[t] for k, t in gai.TABS.items() if t in tabs})
    kw = {k["kw"]: k for k in ins["keywords"]["rows"]}
    crm = kw["crm software"]
    assert crm["qs"] == 4 and crm["ctr"] == "BELOW_AVERAGE" and crm["landing"] == "BELOW_AVERAGE"
    assert crm["bid"] == 40.0 and crm["first_page"] == 55.0 and crm["cost"] == 11000.0
    assert kw["acme"]["qs"] is None and kw["acme"]["bid"] is None, "no Quality Score is unknown, not zero"
    assert {d["device"] for d in ins["devices"]} == {"MOBILE", "DESKTOP"}
    assert {(h["day"], h["hour"]) for h in ins["hours"]} == {(0, 10), (6, 2)}, "Monday is 0, Sunday 6"
    locs = ins["locations"]["rows"]
    assert (locs[0]["country"], locs[0]["region"], locs[0]["city"]) == ("India", "Maharashtra", "Mumbai")
    assert locs[1]["region"] == "Location 99999", "an unnamed place keeps its id rather than vanishing"
    acts = {a["name"]: a for a in ins["actions"]}
    assert acts["Lead form"]["primary"] and acts["Lead form"]["counting"] == "MANY_PER_CLICK"
    assert acts["Lead form"]["all"] == 64.0 and acts["Pricing page view"]["conv"] == 30.0


@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_the_script_exports_ads_what_google_served_and_each_headline():
    tabs = _harness()["tabs"]
    ins = gai.build({k: tabs[t] for k, t in gai.TABS.items() if t in tabs})
    ads = {a["id"]: a for a in ins["ads"]["rows"]}
    crm, brand, pmax = ads["801"], ads["802"], ads["91"]
    assert crm["kind"] == "RSA" and crm["strength"] == "AVERAGE" and crm["pinned"] == 1
    assert [h["t"] for h in crm["heads"]][:2] == ["Free CRM Trial", "Rated #1 by Users"]
    assert crm["cost"] == 9000.0 and crm["impr"] == 1900, "metrics joined from the second query"
    assert [c["heads"] for c in crm["combos"]] == [["Rated #1 by Users", "Start in 5 Minutes"],
                                                  ["Free CRM Trial", "Rated #1 by Users"]], "most served first"
    assert crm["combos"][1]["descs"] == ["No credit card needed."]
    labels = {x["t"]: x["label"] for x in crm["assets"]}
    assert labels == {"Free CRM Trial": "BEST", "No credit card needed.": "LOW"}
    assert brand["approval"] == "DISAPPROVED" and "TRADEMARKS_IN_AD_TEXT" in brand["topics"]
    assert pmax["kind"] == "ASSET_GROUP" and pmax["strength"] == "GOOD" and pmax["cost"] == 30000.0
    assert pmax["combos"][0]["category"] == "IMAGE"
    assert pmax["combos"][0]["parts"][0]["img"] == "https://tpc.googlesyndication.com/simgad/123"


@pytest.mark.skipif(not NODE, reason="node is not installed")
def test_the_script_exports_changes_scores_recommendations_audiences_and_landing_pages():
    tabs = _harness()["tabs"]
    ins = gai.build({k: tabs[t] for k, t in gai.TABS.items() if t in tabs})
    ch = ins["changes"]["rows"]
    assert [c["kind"] for c in ch] == ["budget", "bidding", "keywords"], "newest first, each classified"
    assert ch[0]["diffs"] == [["amount_micros", 5000, 8000]], "budget micros become money, old and new"
    assert ch[1]["diffs"][1] == ["target_impression_share.location_fraction_micros", 0.5, 0.9]
    assert ch[2]["item"] == "crm for startups" and ch[2]["diffs"][0] == ["keyword.text", None, "crm for startups"]
    t = ins["changes"]["totals"]["__all__"]
    assert t["auto"] == 1 and t["people"] == 1 and t["kinds"]["budget"] == 1
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
    assert age["25–34"]["cost"] == 45000.0 and age["25–34"]["impr"] == 7000, "ad groups summed per campaign"
    assert age["65+"]["conv"] == 0
    lp = ins["landing"]
    assert [x["speed"] for x in lp["rows"]] == [3, 8] and lp["rows"][0]["mobile"] == 0.62
    assert round(lp["totals"]["__all__"]["avg_speed"], 2) == round((3 * 120000 + 8 * 27000) / 147000, 2)


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
    monkeypatch.setattr(appmod, "_google_ads_insights", lambda force=False: dict(ins, symbols={"INR": "₹"}))
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
    monkeypatch.setattr(appmod, "_google_ads_insights", lambda force=False: dict(gai.empty(), symbols={}))
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
