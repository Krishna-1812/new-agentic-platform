"""Google Ads dashboard: the insights tabs written by the Google Ads Script.

scripts/google_ads/export_insights.js, a Google Ads Script installed in the
manager account, writes these tabs at the end of the same sheet the dashboard
already reads. This module reads them back (headers matched by name, so a
column added later does not break it) and shapes them for the page:

  is       one row per campaign, last 30 days: impression share and why it
           was lost (budget or rank), top and absolute-top share, click share
  weekly   search impression share per campaign per week, last 13 weeks
  budgets  one row per enabled campaign: its budget, bidding and spend so far
           this month, grouped into budgets (a shared budget has several)
  terms    search terms, last 30 days: the most expensive per account are
           sent to the page, and totals are kept over every term read
  keywords keywords with Quality Score and its three parts, bids against
           Google's first-page estimate; totals over every keyword read
  devices  campaign x device, last 30 days
  hours    account x day of week x hour (the account's time zone)
  locations region and city, by where people were or what they searched for
  conversions / actions  conversions per action, and how each action is set
           up, with setup problems flagged against Google's own guidance
  ads      every live ad and Performance Max asset group with its ad strength,
           approval, headlines and descriptions, the combinations Google
           served, and how each headline and description performed
  changes  every change made in the last 28 days: what, who, through what
           (web, API, Google's auto-applied recommendations), old and new values
  health   Google's optimization score per account and campaign
  recs     Google's open recommendations with their weekly impact estimate
  demographics  campaign performance by age range and gender
  landing  each final URL: Google's mobile speed score (1-10), share of
           mobile clicks to mobile-friendly pages, and performance

Impression-share values stay as Google reports them: 0.0999 means "below
10%" and 0.9001 "above 90%" (Google Ads API field reference, v25). The page
shows those as <10% and >90%.

Nothing here calls Google Ads. When the tabs are missing (the script has not
run yet) every section is empty and the page leaves its panels hidden.
"""

import json
import re
import threading
import time

TABS = {
    "is": "Insights - Impression share",
    "weekly": "Insights - IS weekly",
    "budgets": "Insights - Budgets",
    "terms": "Insights - Search terms",
    "keywords": "Insights - Keywords",
    "devices": "Insights - Devices",
    "hours": "Insights - Hours",
    "locations": "Insights - Locations",
    "conversions": "Insights - Conversions",
    "actions": "Insights - Conversion actions",
    "ads": "Insights - Ads",
    "combos": "Insights - Ad combinations",
    "ad_assets": "Insights - Ad assets",
    "changes": "Insights - Changes",
    "health": "Insights - Optimization",
    "recs": "Insights - Recommendations",
    "demographics": "Insights - Demographics",
    "landing": "Insights - Landing pages",
    "about": "Insights - About",
}
PREFIX = "Insights - "
CACHE_TTL = 900
TERMS_PER_ACCOUNT = 1500      # sent to the page, by spend
TERMS_ON_PAGE = 8000
KEYWORDS_PER_ACCOUNT = 1500
KEYWORDS_ON_PAGE = 6000
LOCATIONS_PER_ACCOUNT = 600
LOCATIONS_ON_PAGE = 5000
ADS_PER_ACCOUNT = 300
ADS_ON_PAGE = 1500
COMBOS_PER_AD = 3
CHANGES_PER_ACCOUNT = 800     # newest first
CHANGES_ON_PAGE = 4000
RECS_PER_ACCOUNT = 300
LANDING_PER_ACCOUNT = 300     # by spend
LANDING_ON_PAGE = 2000

_LOCK = threading.Lock()
_CACHE = {"at": 0.0, "value": None, "key": None}


def is_insights_tab(title):
    return str(title or "").startswith(PREFIX)


# ── Reading cells ────────────────────────────────────────────────────────────
def _num(v):
    """A number from a cell: None for blank (unknown), never raises."""
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "")
    if not s or s in ("--", " --"):
        return None
    pct = s.endswith("%")
    try:
        x = float(s.rstrip("%").strip())
    except ValueError:
        return None
    return x / 100 if pct else x


def _z(v):
    """A count or amount: blank reads as 0."""
    x = _num(v)
    return 0.0 if x is None else x


def _bool(v):
    if isinstance(v, bool):
        return v
    return str(v).strip().upper() in ("TRUE", "YES", "1")


def _table(values):
    """[{header: cell}] from a tab's values, headers lower-cased."""
    if not values:
        return []
    head = [str(h).strip().lower() for h in values[0]]
    out = []
    for row in values[1:]:
        if not any(str(c).strip() for c in row):
            continue
        out.append({h: (row[i] if i < len(row) else "") for i, h in enumerate(head)})
    return out


def _s(r, key):
    v = r.get(key, "")
    return "" if v is None else str(v).strip()


# ── Sections ─────────────────────────────────────────────────────────────────
def parse_is(values):
    out = []
    for r in _table(values):
        if not _s(r, "campaign"):
            continue
        out.append({
            "account": _s(r, "account"), "cid": _s(r, "customer id"), "cur": _s(r, "currency"),
            "id": _s(r, "campaign id"), "campaign": _s(r, "campaign"), "channel": _s(r, "channel"),
            "sub": _s(r, "sub-channel"), "status": _s(r, "status"), "bid": _s(r, "bidding strategy"),
            "impr": _z(r.get("impressions")), "clicks": _z(r.get("clicks")), "cost": _z(r.get("cost")),
            "conv": _z(r.get("conversions")), "value": _z(r.get("conv. value")),
            "is": _num(r.get("search is")), "top": _num(r.get("search top is")),
            "abs": _num(r.get("search abs. top is")),
            "lb": _num(r.get("search lost is (budget)")), "lr": _num(r.get("search lost is (rank)")),
            "ltb": _num(r.get("search lost top is (budget)")), "ltr": _num(r.get("search lost top is (rank)")),
            "lab": _num(r.get("search lost abs. top is (budget)")),
            "lar": _num(r.get("search lost abs. top is (rank)")),
            "click": _num(r.get("search click share")), "exact": _num(r.get("search exact match is")),
            "dis": _num(r.get("display is")), "dlb": _num(r.get("display lost is (budget)")),
            "dlr": _num(r.get("display lost is (rank)")),
        })
    return out


def parse_weekly(values):
    out = []
    for r in _table(values):
        week = _s(r, "week")
        if not week or _num(r.get("search is")) is None:
            continue
        out.append({
            "account": _s(r, "account"), "id": _s(r, "campaign id"), "campaign": _s(r, "campaign"),
            "channel": _s(r, "channel"), "week": week[:10],
            "impr": _z(r.get("impressions")), "clicks": _z(r.get("clicks")), "cost": _z(r.get("cost")),
            "conv": _z(r.get("conversions")),
            "is": _num(r.get("search is")), "top": _num(r.get("search top is")),
            "abs": _num(r.get("search abs. top is")),
            "lb": _num(r.get("search lost is (budget)")), "lr": _num(r.get("search lost is (rank)")),
        })
    out.sort(key=lambda x: (x["week"], x["account"], x["campaign"]))
    return out


def parse_budgets(values):
    """Campaign rows plus the budgets they sit on (a shared budget covers several campaigns)."""
    camps, budgets = [], {}
    for r in _table(values):
        if not _s(r, "campaign"):
            continue
        c = {
            "account": _s(r, "account"), "cid": _s(r, "customer id"), "cur": _s(r, "currency"),
            "tz": _s(r, "time zone"), "id": _s(r, "campaign id"), "campaign": _s(r, "campaign"),
            "channel": _s(r, "channel"), "status": _s(r, "status"), "bid": _s(r, "bidding strategy"),
            "tcpa": _num(r.get("target cpa")), "troas": _num(r.get("target roas")),
            "budget_id": _s(r, "budget id"), "budget_name": _s(r, "budget name"),
            "shared": _bool(r.get("shared budget")), "period": _s(r, "budget period"),
            "delivery": _s(r, "delivery"), "daily": _num(r.get("daily budget")),
            "total": _num(r.get("total budget")), "recommended": _num(r.get("recommended daily budget")),
            "today": _z(r.get("cost today")), "yesterday": _z(r.get("cost yesterday")),
            "last7": _z(r.get("cost last 7 days")), "mtd": _z(r.get("cost this month")),
            "clicks_mtd": _z(r.get("clicks this month")), "conv_mtd": _z(r.get("conversions this month")),
            "value_mtd": _z(r.get("conv. value this month")), "last_month": _z(r.get("cost last month")),
            "day": _z(r.get("day of month")), "dim": _z(r.get("days in month")),
            "elapsed": _z(r.get("month elapsed (days)")),
        }
        camps.append(c)
        key = c["account"] + "\u0001" + (c["budget_id"] or ("campaign:" + c["id"]))
        b = budgets.get(key)
        if not b:
            b = budgets[key] = {
                "key": key, "account": c["account"], "cur": c["cur"], "id": c["budget_id"],
                "name": c["budget_name"] or c["campaign"], "shared": c["shared"], "period": c["period"],
                "delivery": c["delivery"], "daily": c["daily"], "total": c["total"],
                "recommended": c["recommended"], "day": c["day"], "dim": c["dim"], "elapsed": c["elapsed"],
                "today": 0.0, "yesterday": 0.0, "last7": 0.0, "mtd": 0.0, "conv_mtd": 0.0,
                "value_mtd": 0.0, "last_month": 0.0, "campaigns": [],
            }
        for k in ("today", "yesterday", "last7", "mtd", "conv_mtd", "value_mtd", "last_month"):
            b[k] += c[k]
        b["campaigns"].append(c["campaign"])
    return camps, [pace(b) for b in budgets.values()]


# Google Ads charges at most the average daily budget x 30.4 in a month
# ("monthly charging limit", Google Ads Help: About average daily budgets).
MONTHLY_FACTOR = 30.4


def pace(b):
    """Adds the month's pacing to one budget: expected spend so far, projection, verdict."""
    daily, dim, elapsed = b.get("daily"), b.get("dim") or 0, b.get("elapsed") or 0
    b["monthly_cap"] = round(daily * MONTHLY_FACTOR, 2) if daily else None
    b["month_budget"] = round(daily * dim, 2) if daily and dim else None
    b["expected"] = round(daily * elapsed, 2) if daily else None
    run_rate = (b["last7"] / 7.0) if b.get("last7") else (b["mtd"] / elapsed if elapsed else 0.0)
    remaining = max(0.0, dim - elapsed)
    b["run_rate"] = round(run_rate, 2)
    b["projected"] = round(b["mtd"] + run_rate * remaining, 2) if dim else None
    b["pace"] = round(b["mtd"] / b["expected"], 3) if b.get("expected") else None
    if not daily or b["pace"] is None:
        b["verdict"] = "unknown"
    elif b["projected"] is not None and b["monthly_cap"] and b["projected"] > b["monthly_cap"] * 0.995:
        b["verdict"] = "capped"          # will hit Google's monthly limit
    elif b["pace"] > 1.1:
        b["verdict"] = "over"
    elif b["pace"] < 0.8:
        b["verdict"] = "under"
    else:
        b["verdict"] = "on_track"
    return b


def parse_terms(values, per_account=TERMS_PER_ACCOUNT, on_page=TERMS_ON_PAGE):
    """The most expensive terms per account for the page, and totals over all terms read."""
    rows = []
    for r in _table(values):
        term = _s(r, "search term")
        if not term:
            continue
        rows.append([
            _s(r, "account"), _s(r, "campaign"), _s(r, "ad group"), term,
            _s(r, "search term match"), _s(r, "keyword"), _s(r, "keyword match"), _s(r, "status"),
            _z(r.get("impressions")), _z(r.get("clicks")), _z(r.get("cost")), _z(r.get("conversions")),
            _z(r.get("conv. value")), _s(r, "currency"),
        ])
    totals = {}
    for row in rows:
        for key in (row[0], "__all__"):
            t = totals.setdefault(key, {"terms": 0, "impr": 0.0, "clicks": 0.0, "cost": 0.0, "conv": 0.0,
                                        "value": 0.0, "wasted": 0.0, "wasted_terms": 0, "converting": 0,
                                        "cur": row[13]})
            t["terms"] += 1
            t["impr"] += row[8]
            t["clicks"] += row[9]
            t["cost"] += row[10]
            t["conv"] += row[11]
            t["value"] += row[12]
            if row[11] > 0:
                t["converting"] += 1
            if t["cur"] != row[13]:
                t["cur"] = "mixed"
            if row[11] <= 0 and row[10] > 0:
                t["wasted"] += row[10]
                t["wasted_terms"] += 1
    rows.sort(key=lambda x: -x[10])
    kept, per = [], {}
    for row in rows:
        if per.get(row[0], 0) >= per_account:
            continue
        per[row[0]] = per.get(row[0], 0) + 1
        kept.append(row)
        if len(kept) >= on_page:
            break
    return {"cols": ["account", "campaign", "ad_group", "term", "match", "keyword", "kw_match", "status",
                     "impr", "clicks", "cost", "conv", "value", "cur"],
            "rows": kept, "totals": totals, "read": len(rows)}


QS_PARTS = (("ctr", "expected ctr"), ("relevance", "ad relevance"), ("landing", "landing page experience"))
BUCKETS = ("ABOVE_AVERAGE", "AVERAGE", "BELOW_AVERAGE")


def parse_keywords(values, per_account=KEYWORDS_PER_ACCOUNT, on_page=KEYWORDS_ON_PAGE):
    """Keywords for the page (costliest per account) and Quality Score totals over all read."""
    rows = []
    for r in _table(values):
        text = _s(r, "keyword")
        if not text:
            continue
        qs = _num(r.get("quality score"))
        rows.append({
            "account": _s(r, "account"), "cur": _s(r, "currency"), "campaign": _s(r, "campaign"),
            "ad_group": _s(r, "ad group"), "id": _s(r, "keyword id"), "kw": text, "match": _s(r, "match type"),
            "status": _s(r, "status"), "serving": _s(r, "serving"), "qs": int(qs) if qs else None,
            "ctr": _s(r, "expected ctr"), "relevance": _s(r, "ad relevance"), "landing": _s(r, "landing page experience"),
            "bid": _num(r.get("max cpc")), "first_page": _num(r.get("first page bid")),
            "top_page": _num(r.get("top of page bid")),
            "impr": _z(r.get("impressions")), "clicks": _z(r.get("clicks")), "cost": _z(r.get("cost")),
            "conv": _z(r.get("conversions")), "value": _z(r.get("conv. value")),
            "is": _num(r.get("search is")), "lr": _num(r.get("search lost is (rank)")),
        })
    totals = {}
    for k in rows:
        for key in (k["account"], "__all__"):
            t = totals.setdefault(key, {"keywords": 0, "cost": 0.0, "clicks": 0.0, "conv": 0.0, "cur": k["cur"],
                                        "qs_impr": 0.0, "qs_w": 0.0, "with_qs": 0, "low_qs_cost": 0.0,
                                        "low_qs": 0, "below_first_page": 0, "rarely_served": 0,
                                        "dist": {str(i): {"keywords": 0, "cost": 0.0, "conv": 0.0} for i in range(1, 11)},
                                        "parts": {p: {b: 0.0 for b in BUCKETS} for p, _ in QS_PARTS}})
            if t["cur"] != k["cur"]:
                t["cur"] = "mixed"
            t["keywords"] += 1
            t["cost"] += k["cost"]
            t["clicks"] += k["clicks"]
            t["conv"] += k["conv"]
            if k["qs"]:
                t["with_qs"] += 1
                t["qs_impr"] += k["impr"]
                t["qs_w"] += k["qs"] * k["impr"]
                d = t["dist"][str(k["qs"])]
                d["keywords"] += 1
                d["cost"] += k["cost"]
                d["conv"] += k["conv"]
                if k["qs"] <= 4:
                    t["low_qs"] += 1
                    t["low_qs_cost"] += k["cost"]
            for part, _ in QS_PARTS:
                if k[part] in BUCKETS:
                    t["parts"][part][k[part]] += k["cost"]
            if k["bid"] and k["first_page"] and k["bid"] < k["first_page"]:
                t["below_first_page"] += 1
            if k["serving"] == "RARELY_SERVED":
                t["rarely_served"] += 1
    for t in totals.values():
        t["avg_qs"] = round(t["qs_w"] / t["qs_impr"], 2) if t["qs_impr"] else None
    rows.sort(key=lambda k: -k["cost"])
    return {"rows": _trim(rows, per_account, on_page), "totals": totals, "read": len(rows)}


def _trim(rows, per_account, on_page):
    kept, per = [], {}
    for row in rows:
        a = row["account"] if isinstance(row, dict) else row[0]
        if per.get(a, 0) >= per_account:
            continue
        per[a] = per.get(a, 0) + 1
        kept.append(row)
        if len(kept) >= on_page:
            break
    return kept


def _perf(r):
    return {"impr": _z(r.get("impressions")), "clicks": _z(r.get("clicks")), "cost": _z(r.get("cost")),
            "conv": _z(r.get("conversions")), "value": _z(r.get("conv. value"))}


def parse_devices(values):
    out = []
    for r in _table(values):
        if not _s(r, "device"):
            continue
        d = {"account": _s(r, "account"), "cur": _s(r, "currency"), "campaign": _s(r, "campaign"),
             "channel": _s(r, "channel"), "device": _s(r, "device")}
        d.update(_perf(r))
        out.append(d)
    return out


DAYS = ("MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY")


def parse_hours(values):
    out = []
    for r in _table(values):
        day = _s(r, "day of week").upper()
        hour = _num(r.get("hour"))
        if day not in DAYS or hour is None:
            continue
        h = {"account": _s(r, "account"), "cur": _s(r, "currency"), "tz": _s(r, "time zone"),
             "day": DAYS.index(day), "hour": int(hour)}
        h.update(_perf(r))
        out.append(h)
    return out


def parse_locations(values, per_account=LOCATIONS_PER_ACCOUNT, on_page=LOCATIONS_ON_PAGE):
    rows = []
    for r in _table(values):
        region, city, country = _s(r, "region"), _s(r, "city"), _s(r, "country")
        if not (region or city or country):
            continue
        x = {"account": _s(r, "account"), "cur": _s(r, "currency"), "type": _s(r, "location type"),
             "country": country, "region": region, "city": city}
        x.update(_perf(r))
        rows.append(x)
    totals = {}
    for x in rows:
        for key in (x["account"], "__all__"):
            t = totals.setdefault(key, {"cost": 0.0, "conv": 0.0, "interest_cost": 0.0, "rows": 0})
            t["rows"] += 1
            t["cost"] += x["cost"]
            t["conv"] += x["conv"]
            if x["type"] == "AREA_OF_INTEREST":
                t["interest_cost"] += x["cost"]
    rows.sort(key=lambda x: -x["cost"])
    return {"rows": _trim(rows, per_account, on_page), "totals": totals, "read": len(rows)}


def parse_conversions(values):
    out = []
    for r in _table(values):
        if not _s(r, "conversion action"):
            continue
        out.append({"account": _s(r, "account"), "campaign": _s(r, "campaign"), "action": _s(r, "conversion action"),
                    "category": _s(r, "category"), "conv": _z(r.get("conversions")),
                    "value": _z(r.get("conv. value")), "all": _z(r.get("all conversions")),
                    "all_value": _z(r.get("all conv. value"))})
    return out


# Categories that are leads rather than sales. Google recommends counting "One"
# conversion per click for leads and "Every" for sales (Google Ads Help,
# "About conversion counting options").
LEAD_CATEGORIES = {"SUBMIT_LEAD_FORM", "CONTACT", "SIGNUP", "BOOK_APPOINTMENT", "REQUEST_QUOTE",
                   "PHONE_CALL_LEAD", "IMPORTED_LEAD", "QUALIFIED_LEAD", "CONVERTED_LEAD", "GET_DIRECTIONS"}
SOFT_CATEGORIES = {"PAGE_VIEW", "ENGAGEMENT", "OUTBOUND_CLICK", "DEFAULT"}


def parse_actions(values, conversions=()):
    """Every conversion action with its 30-day totals and setup flags."""
    got = {}
    for c in conversions:
        k = (c["account"], c["action"])
        g = got.setdefault(k, {"conv": 0.0, "value": 0.0, "all": 0.0, "all_value": 0.0})
        for f in ("conv", "value", "all", "all_value"):
            g[f] += c[f]
    out = []
    for r in _table(values):
        name = _s(r, "conversion action")
        if not name:
            continue
        a = {"account": _s(r, "account"), "id": _s(r, "action id"), "name": name, "category": _s(r, "category"),
             "status": _s(r, "status"), "type": _s(r, "type"), "origin": _s(r, "origin"),
             "primary": _bool(r.get("primary for goal")), "in_conversions": _bool(r.get('in "conversions"')),
             "counting": _s(r, "counting"), "click_window": _num(r.get("click-through window (days)")),
             "view_window": _num(r.get("view-through window (days)")), "default_value": _num(r.get("default value")),
             "always_default": _bool(r.get("always use default value")), "model": _s(r, "attribution model")}
        a.update(got.get((a["account"], name), {"conv": 0.0, "value": 0.0, "all": 0.0, "all_value": 0.0}))
        flags = []
        if a["category"] in LEAD_CATEGORIES and a["counting"] == "MANY_PER_CLICK":
            flags.append(["warn", "Counts every conversion. Google recommends counting one per click for leads, "
                                  "so repeat form fills do not inflate the total."])
        if a["primary"] and a["category"] in SOFT_CATEGORIES and a["status"] == "ENABLED":
            flags.append(["warn", "A %s action is primary, so bidding optimises for it as if it were a lead or sale."
                          % a["category"].replace("_", " ").lower()])
        if a["primary"] and a["status"] == "ENABLED" and not a["all"]:
            flags.append(["info", "Primary, but recorded no conversions in the last 30 days. Check the tag still fires."])
        if a["status"] == "HIDDEN":
            flags.append(["info", "Hidden: still counted if primary, but not shown in the conversion list."])
        a["flags"] = flags
        out.append(a)
    out.sort(key=lambda a: (-a["all"], a["name"]))
    return out


STRENGTHS = ("EXCELLENT", "GOOD", "AVERAGE", "POOR", "PENDING")
RSA_MAX_HEADLINES, RSA_MAX_DESCRIPTIONS = 15, 4      # Google Ads Help, "About responsive search ads"
_YT_ID = re.compile(r"^[A-Za-z0-9_-]{6,20}$")


def _json_list(v):
    try:
        out = json.loads(v) if isinstance(v, str) and v.strip() else []
    except ValueError:
        return []
    return out if isinstance(out, list) else []


def _part(p):
    """One served asset for the page: text, an https image, or a YouTube id; anything else dropped."""
    if not isinstance(p, dict):
        return None
    out = {"f": str(p.get("f") or "")}
    if p.get("x"):
        out["x"] = str(p["x"])[:300]
    img = str(p.get("img") or "")
    if img.startswith("https://"):
        out["img"] = img
    vid = str(p.get("vid") or "")
    if _YT_ID.match(vid):
        out["vid"] = vid
    return out if len(out) > 1 else None


def parse_ads(values, combos=None, assets=None, per_account=ADS_PER_ACCOUNT, on_page=ADS_ON_PAGE):
    """Live ads and asset groups with their served combinations, asset performance and flags."""
    by_key = {}
    for r in _table(combos):
        key = _s(r, "account") + "\u0001" + _s(r, "ad group id") + "~" + _s(r, "ad id")
        parts = [x for x in (_part(p) for p in _json_list(r.get("assets json"))) if x]
        by_key.setdefault(key, []).append({
            "rank": int(_z(r.get("rank"))), "impr": _num(r.get("impressions")), "category": _s(r, "category"),
            "heads": [p["x"] for p in parts if p["f"].startswith("HEADLINE") and p.get("x")],
            "descs": [p["x"] for p in parts if p["f"].startswith("DESCRIPTION") and p.get("x")],
            "parts": parts})
    perf = {}
    for r in _table(assets):
        key = _s(r, "account") + "\u0001" + _s(r, "ad group id") + "~" + _s(r, "ad id")
        perf.setdefault(key, []).append({
            "f": _s(r, "field"), "t": _s(r, "text"), "pin": _s(r, "pinned to"), "label": _s(r, "performance label"),
            "impr": _z(r.get("impressions")), "clicks": _z(r.get("clicks")), "cost": _z(r.get("cost")),
            "conv": _z(r.get("conversions"))})
    rows = []
    for r in _table(values):
        if not _s(r, "ad id"):
            continue
        a = {"account": _s(r, "account"), "cur": _s(r, "currency"), "campaign": _s(r, "campaign"),
             "channel": _s(r, "channel"), "ad_group": _s(r, "ad group"), "id": _s(r, "ad id"),
             "kind": _s(r, "kind"), "type": _s(r, "ad type"), "status": _s(r, "status"),
             "primary_status": _s(r, "primary status"), "approval": _s(r, "approval"), "review": _s(r, "review"),
             "topics": _s(r, "policy topics"), "strength": _s(r, "ad strength"), "url": _s(r, "final url"),
             "path1": _s(r, "path 1"), "path2": _s(r, "path 2"),
             "heads": [h for h in _json_list(r.get("headlines")) if isinstance(h, dict)],
             "descs": [d for d in _json_list(r.get("descriptions")) if isinstance(d, dict)],
             "pinned": int(_z(r.get("pinned")))}
        a.update(_perf(r))
        key = a["account"] + "\u0001" + _s(r, "ad group id") + "~" + a["id"]
        a["combos"] = sorted(by_key.get(key, []), key=lambda c: (c["category"], c["rank"]))
        a["assets"] = sorted(perf.get(key, []), key=lambda x: (x["f"], -x["impr"]))
        a["flags"] = _ad_flags(a)
        rows.append(a)
    totals = {}
    for a in rows:
        for key in (a["account"], "__all__"):
            t = totals.setdefault(key, {"ads": 0, "rsa": 0, "asset_groups": 0, "other": 0, "cost": 0.0,
                                        "strength": {s: {"n": 0, "cost": 0.0} for s in STRENGTHS},
                                        "disapproved": 0, "limited": 0, "pinned_ads": 0, "low_assets": 0,
                                        "no_impressions": 0, "cur": a["cur"]})
            if t["cur"] != a["cur"]:
                t["cur"] = "mixed"
            t["ads"] += 1
            t["rsa" if a["kind"] == "RSA" else "asset_groups" if a["kind"] == "ASSET_GROUP" else "other"] += 1
            t["cost"] += a["cost"]
            if a["strength"] in t["strength"]:
                t["strength"][a["strength"]]["n"] += 1
                t["strength"][a["strength"]]["cost"] += a["cost"]
            t["disapproved"] += a["approval"] == "DISAPPROVED"
            t["limited"] += a["approval"] == "APPROVED_LIMITED"
            t["pinned_ads"] += a["pinned"] > 0
            t["low_assets"] += sum(1 for x in a["assets"] if x["label"] == "LOW")
            t["no_impressions"] += not a["impr"]
    rows.sort(key=lambda a: (a["approval"] != "DISAPPROVED", -a["cost"]))
    kept = _trim(rows, per_account, on_page)
    for a in kept:
        a["combos"] = [c for c in a["combos"] if c["category"] or c["rank"] <= COMBOS_PER_AD][:12]
    return {"rows": kept, "totals": totals, "read": len(rows)}


def _ad_flags(a):
    """What to fix on one ad, each from Google's own rules or reports."""
    flags = []
    if a["approval"] == "DISAPPROVED":
        flags.append(["bad", "Disapproved" + (": " + a["topics"].replace("_", " ").lower() if a["topics"] else "") +
                      ". It cannot run until fixed or appealed."])
    elif a["approval"] == "APPROVED_LIMITED":
        flags.append(["warn", "Approved (limited)" + (": " + a["topics"].replace("_", " ").lower() if a["topics"] else "") +
                      ". It shows in fewer places."])
    if a["strength"] in ("POOR", "AVERAGE"):
        flags.append(["warn", "Ad strength is %s." % a["strength"].lower()])
    if a["kind"] == "RSA":
        nh, nd = len(a["heads"]), len(a["descs"])
        if nh < RSA_MAX_HEADLINES or nd < RSA_MAX_DESCRIPTIONS:
            flags.append(["info", "%d of %d headlines and %d of %d descriptions. Google recommends as many unique "
                                  "headlines as you can." % (nh, RSA_MAX_HEADLINES, nd, RSA_MAX_DESCRIPTIONS)])
        if a["pinned"]:
            flags.append(["info", "%d pinned. Google: pinning \u201cisn\u2019t recommended for most advertisers and "
                                  "can affect ad strength\u201d." % a["pinned"]])
    low = [x for x in a["assets"] if x["label"] == "LOW"]
    if low:
        flags.append(["info", "Google rates %d of its headlines and descriptions Low: replace them." % len(low)])
    if not a["impr"] and a["approval"] != "DISAPPROVED":
        flags.append(["info", "No impressions in the last 30 days."])
    return flags


# ── Change history ───────────────────────────────────────────────────────────
# "Made through" values, from Google's ChangeClientType enum (API v25).
# GOOGLE_ADS_RECOMMENDATIONS_SUBSCRIPTION is "Changes made by subscribing to
# Google Ads recommendations", i.e. auto-applied recommendations.
AUTO_APPLIED = "GOOGLE_ADS_RECOMMENDATIONS_SUBSCRIPTION"
CHANGE_KINDS = ("budget", "bidding", "status", "keywords", "ads", "targeting", "other")
_BIDDING = re.compile(r"bidding|target_cpa|target_roas|maximize_|manual_c|target_impression_share|"
                      r"target_spend|percent_cpc|cpc_bid|cpm_bid|cpv_bid|bid_modifier")
_ADS = ("AD", "AD_GROUP_AD", "ASSET", "AD_GROUP_ASSET", "CAMPAIGN_ASSET", "CUSTOMER_ASSET", "ASSET_SET",
        "ASSET_SET_ASSET", "CAMPAIGN_ASSET_SET", "FEED", "FEED_ITEM", "AD_GROUP_FEED", "CAMPAIGN_FEED")


def _json_obj(v):
    try:
        out = json.loads(v) if isinstance(v, str) and v.strip() else {}
    except ValueError:
        return {}
    return out if isinstance(out, dict) else {}


def _cell(v):
    """An old or new value for the page: short text or a number."""
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, (int, float)):
        return v
    return str(v)[:200]


def change_kind(rtype, op, fields):
    joined = " ".join(fields)
    if rtype == "CAMPAIGN_BUDGET":
        return "budget"
    if rtype == "AD_GROUP_BID_MODIFIER" or (rtype in ("CAMPAIGN", "AD_GROUP", "AD_GROUP_CRITERION")
                                           and _BIDDING.search(joined)):
        return "bidding"
    if op == "UPDATE" and any(f == "status" or f.endswith(".status") for f in fields):
        return "status"
    if rtype == "AD_GROUP_CRITERION" and ("keyword" in joined or not fields):
        return "keywords"
    if rtype in _ADS:
        return "ads"
    if rtype in ("AD_GROUP_CRITERION", "CAMPAIGN_CRITERION"):
        return "targeting"
    return "other"


def parse_changes(values, per_account=CHANGES_PER_ACCOUNT, on_page=CHANGES_ON_PAGE):
    rows = []
    for r in _table(values):
        at = _s(r, "changed at")
        if not at:
            continue
        fields = [f.strip() for f in _s(r, "fields changed").split(",") if f.strip()]
        old, new = _json_obj(r.get("old values")), _json_obj(r.get("new values"))
        diffs = []
        for f in fields:
            if f in old or f in new:
                diffs.append([f, _cell(old.get(f)), _cell(new.get(f))])
        rtype, op = _s(r, "resource type"), _s(r, "operation")
        rows.append({"account": _s(r, "account"), "cur": _s(r, "currency"), "at": at[:16], "day": at[:10],
                     "type": rtype, "op": op, "campaign_id": _s(r, "campaign id"), "campaign": _s(r, "campaign"),
                     "ad_group": _s(r, "ad group"), "item": _s(r, "item"), "by": _s(r, "changed by"),
                     "via": _s(r, "made through"), "fields": fields, "diffs": diffs[:12],
                     "kind": change_kind(rtype, op, fields)})
    rows.sort(key=lambda x: x["at"], reverse=True)
    totals = {}
    for x in rows:
        for key in (x["account"], "__all__"):
            t = totals.setdefault(key, {"n": 0, "kinds": {k: 0 for k in CHANGE_KINDS}, "via": {}, "auto": 0,
                                        "days": {}, "people": 0, "_people": set(), "first": x["day"],
                                        "last": x["day"]})
            t["n"] += 1
            t["kinds"][x["kind"]] += 1
            t["via"][x["via"] or "UNKNOWN"] = t["via"].get(x["via"] or "UNKNOWN", 0) + 1
            t["auto"] += x["via"] == AUTO_APPLIED
            t["days"][x["day"]] = t["days"].get(x["day"], 0) + 1
            if x["by"]:
                t["_people"].add(x["by"])
            t["first"], t["last"] = min(t["first"], x["day"]), max(t["last"], x["day"])
    for t in totals.values():
        t["people"] = len(t.pop("_people"))
    return {"rows": _trim(rows, per_account, on_page), "totals": totals, "read": len(rows)}


# ── Optimization score and recommendations ───────────────────────────────────
def parse_health(values):
    """Optimization score per account and campaign. Google: 0.0 to 1.0, null when unscored."""
    accounts, campaigns = [], []
    for r in _table(values):
        level = _s(r, "level").upper()
        x = {"account": _s(r, "account"), "cur": _s(r, "currency"), "score": _num(r.get("optimization score")),
             "cost": _z(r.get("cost")), "conv": _z(r.get("conversions"))}
        if level == "ACCOUNT":
            x["weight"] = _z(r.get("score weight"))
            accounts.append(x)
        elif level == "CAMPAIGN" and _s(r, "campaign"):
            x.update(id=_s(r, "campaign id"), campaign=_s(r, "campaign"), channel=_s(r, "channel"),
                     status=_s(r, "status"))
            campaigns.append(x)
    campaigns.sort(key=lambda c: -c["cost"])
    return {"accounts": accounts, "campaigns": campaigns, "overall": weighted_score(accounts)}


def weighted_score(accounts):
    """Scores averaged with Google's optimization score weight, the field Google provides for
    aggregating scores across accounts; None when no account is scored."""
    w = sum(a["weight"] for a in accounts if a["score"] is not None and a["weight"] > 0)
    if not w:
        return None
    return sum(a["score"] * a["weight"] for a in accounts if a["score"] is not None and a["weight"] > 0) / w


REC_LABELS = {
    "CAMPAIGN_BUDGET": "Raise a budget", "FORECASTING_CAMPAIGN_BUDGET": "Raise a budget (forecast)",
    "MARGINAL_ROI_CAMPAIGN_BUDGET": "Raise a budget (return)", "MOVE_UNUSED_BUDGET": "Move unused budget",
    "KEYWORD": "Add a keyword", "USE_BROAD_MATCH_KEYWORD": "Use broad match", "KEYWORD_MATCH_TYPE": "Change match type",
    "RESPONSIVE_SEARCH_AD": "Add a responsive search ad", "RESPONSIVE_SEARCH_AD_ASSET": "Add headlines or descriptions",
    "RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH": "Improve ad strength",
    "IMPROVE_PERFORMANCE_MAX_AD_STRENGTH": "Improve Performance Max ad strength",
    "IMPROVE_DEMAND_GEN_AD_STRENGTH": "Improve Demand Gen ad strength",
    "SITELINK_ASSET": "Add sitelinks", "CALLOUT_ASSET": "Add callouts", "CALL_ASSET": "Add a call asset",
    "LEAD_FORM_ASSET": "Add a lead form", "TARGET_CPA_OPT_IN": "Bid to a target CPA",
    "SET_TARGET_CPA": "Set a target CPA", "RAISE_TARGET_CPA": "Raise the target CPA",
    "TARGET_ROAS_OPT_IN": "Bid to a target ROAS", "SET_TARGET_ROAS": "Set a target ROAS",
    "LOWER_TARGET_ROAS": "Lower the target ROAS", "MAXIMIZE_CONVERSIONS_OPT_IN": "Maximize conversions",
    "MAXIMIZE_CONVERSION_VALUE_OPT_IN": "Maximize conversion value", "MAXIMIZE_CLICKS_OPT_IN": "Maximize clicks",
    "ENHANCED_CPC_OPT_IN": "Turn on enhanced CPC", "SEARCH_PARTNERS_OPT_IN": "Add search partners",
    "DISPLAY_EXPANSION_OPT_IN": "Add Display expansion", "PERFORMANCE_MAX_OPT_IN": "Try Performance Max",
    "IMPROVE_GOOGLE_TAG_COVERAGE": "Put the Google tag on more pages", "OPTIMIZE_AD_ROTATION": "Optimize ad rotation",
    "CUSTOM_AUDIENCE_OPT_IN": "Add a custom audience", "DYNAMIC_IMAGE_EXTENSION_OPT_IN": "Turn on dynamic images",
    "PERFORMANCE_MAX_FINAL_URL_OPT_IN": "Turn on final URL expansion",
    "REFRESH_CUSTOMER_MATCH_LIST": "Refresh a customer list",
}
# Google's impact estimate is weekly ("Weekly account performance metrics", RecommendationMetrics).
REC_METRICS = ("impr", "clicks", "cost", "conv", "value")


def rec_label(t):
    return REC_LABELS.get(t) or (t.replace("_", " ").capitalize() if t else "Recommendation")


def parse_recs(values, per_account=RECS_PER_ACCOUNT):
    rows = []
    for r in _table(values):
        t = _s(r, "type")
        if not t:
            continue
        base = {"impr": _z(r.get("base impressions")), "clicks": _z(r.get("base clicks")),
                "cost": _z(r.get("base cost")), "conv": _z(r.get("base conversions")),
                "value": _z(r.get("base conv. value"))}
        pot = {"impr": _z(r.get("potential impressions")), "clicks": _z(r.get("potential clicks")),
               "cost": _z(r.get("potential cost")), "conv": _z(r.get("potential conversions")),
               "value": _z(r.get("potential conv. value"))}
        has = any(base.values()) or any(pot.values())
        rows.append({"account": _s(r, "account"), "cur": _s(r, "currency"), "type": t, "label": rec_label(t),
                     "campaign": _s(r, "campaign"), "detail": _s(r, "detail"),
                     "budget_now": _num(r.get("current budget")), "budget_rec": _num(r.get("recommended budget")),
                     "base": base if has else None, "pot": pot if has else None,
                     "gain": {k: pot[k] - base[k] for k in REC_METRICS} if has else None})
    rows.sort(key=lambda x: -((x["gain"] or {}).get("conv") or 0) * 1e6 - ((x["gain"] or {}).get("clicks") or 0))
    totals = {}
    for x in rows:
        for key in (x["account"], "__all__"):
            t = totals.setdefault(key, {"n": 0, "types": {}, "gain": {k: 0.0 for k in REC_METRICS}, "cur": x["cur"]})
            if t["cur"] != x["cur"]:
                t["cur"] = "mixed"
            t["n"] += 1
            t["types"][x["label"]] = t["types"].get(x["label"], 0) + 1
            for k in REC_METRICS:
                t["gain"][k] += (x["gain"] or {}).get(k) or 0
    return {"rows": _trim(rows, per_account, per_account * 60), "totals": totals, "read": len(rows)}


# ── Age and gender ───────────────────────────────────────────────────────────
AGE_ORDER = ("AGE_RANGE_18_24", "AGE_RANGE_25_34", "AGE_RANGE_35_44", "AGE_RANGE_45_54", "AGE_RANGE_55_64",
             "AGE_RANGE_65_UP", "AGE_RANGE_UNDETERMINED")
GENDER_ORDER = ("FEMALE", "MALE", "UNDETERMINED")


def segment_label(seg):
    if seg.startswith("AGE_RANGE_"):
        rest = seg[len("AGE_RANGE_"):]
        if rest == "65_UP":
            return "65+"
        if rest == "UNDETERMINED":
            return "Unknown age"
        return rest.replace("_", "–")
    return {"FEMALE": "Female", "MALE": "Male", "UNDETERMINED": "Unknown gender"}.get(seg, seg.title())


def parse_demographics(values):
    out = []
    for r in _table(values):
        dim, seg = _s(r, "dimension"), _s(r, "segment")
        if dim not in ("Age", "Gender") or not seg:
            continue
        order = AGE_ORDER if dim == "Age" else GENDER_ORDER
        x = {"account": _s(r, "account"), "cur": _s(r, "currency"), "campaign": _s(r, "campaign"),
             "channel": _s(r, "channel"), "dim": dim, "seg": seg, "label": segment_label(seg),
             "order": order.index(seg) if seg in order else len(order)}
        x.update(_perf(r))
        out.append(x)
    return out


def _frac(v):
    """A share as 0-1, whether the cell holds 0.62 or 62."""
    x = _num(v)
    if x is None:
        return None
    return x / 100 if x > 1 else x


# ── Landing pages ────────────────────────────────────────────────────────────
def parse_landing(values, per_account=LANDING_PER_ACCOUNT, on_page=LANDING_ON_PAGE):
    """Final URLs with Google's mobile speed score: "a 10-point scale, 1 being very slow and 10
    being extremely fast" (Google, "Speed matters when providing assistive experiences", 2018)."""
    rows = []
    for r in _table(values):
        url = _s(r, "landing page")
        if not url:
            continue
        speed = _num(r.get("speed score"))
        x = {"account": _s(r, "account"), "cur": _s(r, "currency"), "url": url[:500],
             "speed": int(speed) if speed is not None and 1 <= speed <= 10 else None,
             "mobile": _frac(r.get("mobile-friendly clicks")), "amp": _frac(r.get("valid amp clicks"))}
        x.update(_perf(r))
        rows.append(x)
    rows.sort(key=lambda x: -x["cost"])
    totals = {}
    for x in rows:
        for key in (x["account"], "__all__"):
            t = totals.setdefault(key, {"pages": 0, "cost": 0.0, "conv": 0.0, "clicks": 0.0, "scored_cost": 0.0,
                                        "speed_w": 0.0, "speeds": [0] * 10, "speed_cost": [0.0] * 10,
                                        "mobile_w": 0.0, "mobile_clicks": 0.0})
            t["pages"] += 1
            t["cost"] += x["cost"]
            t["conv"] += x["conv"]
            t["clicks"] += x["clicks"]
            if x["speed"] is not None:
                t["speeds"][x["speed"] - 1] += 1
                t["speed_cost"][x["speed"] - 1] += x["cost"]
                t["scored_cost"] += x["cost"]
                t["speed_w"] += x["speed"] * x["cost"]
            if x["mobile"] is not None and x["clicks"]:
                t["mobile_w"] += x["mobile"] * x["clicks"]
                t["mobile_clicks"] += x["clicks"]
    for t in totals.values():
        t["avg_speed"] = t["speed_w"] / t["scored_cost"] if t["scored_cost"] else None
        t["mobile_share"] = t["mobile_w"] / t["mobile_clicks"] if t["mobile_clicks"] else None
    return {"rows": _trim(rows, per_account, on_page), "totals": totals, "read": len(rows)}


def parse_about(values):
    out = []
    for row in values[1:] if values else []:
        if row and str(row[0]).strip():
            out.append([str(row[0]).strip(), str(row[1]).strip() if len(row) > 1 else ""])
    return out


def empty():
    return {"ok": False, "is": [], "weekly": [], "budgets": [], "budget_campaigns": [],
            "terms": {"cols": [], "rows": [], "totals": {}, "read": 0}, "about": [], "as_of": "",
            "currencies": [], "keywords": {"rows": [], "totals": {}, "read": 0}, "devices": [], "hours": [],
            "locations": {"rows": [], "totals": {}, "read": 0}, "conversions": [], "actions": [],
            "ads": {"rows": [], "totals": {}, "read": 0},
            "changes": {"rows": [], "totals": {}, "read": 0},
            "health": {"accounts": [], "campaigns": [], "overall": None},
            "recs": {"rows": [], "totals": {}, "read": 0}, "demographics": [],
            "landing": {"rows": [], "totals": {}, "read": 0}}


def build(raw):
    """The page's insights from {"is": values, "weekly": values, ...} (missing keys: empty)."""
    out = empty()
    out["is"] = parse_is(raw.get("is"))
    out["weekly"] = parse_weekly(raw.get("weekly"))
    out["budget_campaigns"], out["budgets"] = parse_budgets(raw.get("budgets"))
    out["terms"] = parse_terms(raw.get("terms"))
    out["keywords"] = parse_keywords(raw.get("keywords"))
    out["devices"] = parse_devices(raw.get("devices"))
    out["hours"] = parse_hours(raw.get("hours"))
    out["locations"] = parse_locations(raw.get("locations"))
    out["conversions"] = parse_conversions(raw.get("conversions"))
    out["actions"] = parse_actions(raw.get("actions"), out["conversions"])
    out["ads"] = parse_ads(raw.get("ads"), raw.get("combos"), raw.get("ad_assets"))
    out["changes"] = parse_changes(raw.get("changes"))
    out["health"] = parse_health(raw.get("health"))
    out["recs"] = parse_recs(raw.get("recs"))
    out["demographics"] = parse_demographics(raw.get("demographics"))
    out["landing"] = parse_landing(raw.get("landing"))
    out["about"] = parse_about(raw.get("about"))
    out["as_of"] = next((v for k, v in out["about"] if k == "Exported at"), "")
    curs = {}
    for r in out["is"] + out["budget_campaigns"]:
        if r.get("cur"):
            curs[r["cur"]] = curs.get(r["cur"], 0) + (r.get("cost") or r.get("mtd") or 0)
    out["currencies"] = sorted(curs, key=lambda c: -curs[c])
    out["ok"] = bool(out["is"] or out["budgets"] or out["terms"]["rows"] or out["keywords"]["rows"]
                     or out["devices"] or out["hours"] or out["locations"]["rows"] or out["actions"]
                     or out["ads"]["rows"] or out["changes"]["rows"] or out["health"]["accounts"]
                     or out["recs"]["rows"] or out["demographics"] or out["landing"]["rows"])
    return out


# ── The sheet ────────────────────────────────────────────────────────────────
def read(svc, sheet_id, titles):
    """{key: values} for the insights tabs present in `titles`, in one batch read."""
    wanted = {k: t for k, t in TABS.items() if t in set(titles)}
    if not wanted:
        return {}
    res = svc.spreadsheets().values().batchGet(
        spreadsheetId=sheet_id, ranges=["'%s'!A:AZ" % t for t in wanted.values()],
        valueRenderOption="UNFORMATTED_VALUE", dateTimeRenderOption="FORMATTED_STRING").execute()
    out = {}
    for key, vr in zip(wanted, res.get("valueRanges", [])):
        out[key] = vr.get("values", [])
    return out


def fetch(svc_factory, sheet_id, titles=None, force=False):
    """The page's insights, cached for CACHE_TTL. Never raises: a failure reads as empty."""
    now = time.time()
    with _LOCK:
        if (not force and _CACHE["value"] is not None and _CACHE["key"] == sheet_id
                and now - _CACHE["at"] < CACHE_TTL):
            return _CACHE["value"]
    try:
        svc = svc_factory()
        if titles is None:
            meta = svc.spreadsheets().get(spreadsheetId=sheet_id).execute()
            titles = [s["properties"]["title"] for s in meta.get("sheets", [])]
        value = build(read(svc, sheet_id, titles))
    except Exception as exc:  # the rest of the dashboard must still load
        value = empty()
        value["error"] = type(exc).__name__
    with _LOCK:
        _CACHE.update(at=now, value=value, key=sheet_id)
    return value


def reset():
    with _LOCK:
        _CACHE.update(at=0.0, value=None, key=None)
