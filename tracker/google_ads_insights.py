"""Google Ads dashboard: the insights tabs written by the Google Ads Script.

scripts/google_ads/export_insights.js, a Google Ads Script installed in the
manager account, writes these tabs at the end of the same sheet the dashboard
already reads. This module reads them back (headers matched by name, so a
column added later does not break it) and shapes them for the page:

  is       one row per campaign: impression share and why it was lost (budget
           or rank), top and absolute-top share, click share; the trend chart
           is built from the same daily figures, by day or by week
  budgets  one row per enabled campaign: its budget, bidding and spend so far
           this month, grouped into budgets (a shared budget has several)
  terms    search terms with clicks: the most expensive per account are sent
           to the page; totals, the match-type mix and the word breakdown
           cover every term read
  keywords keywords with Quality Score and its three parts, bids against
           Google's first-page estimate; totals over every keyword read
  devices  campaign x device
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

Date ranges and filters. Every tab with performance figures carries a
"Daily" cell per row: that item's figures for each day of the export window
(the last 90 days by default). load() reads the tabs once; view() adds up the
days inside the date range the page is showing and applies the page's other
filters (account, campaign type, status, search text, one campaign), so every
total is over everything read, not only what fits on the page. Impression
share for a range is rebuilt exactly from Google's daily shares (see
_share_row). Budgets, Quality Score, ad strength, optimization score and
recommendations are current states: they follow the filters, not the dates.
Tabs written by an older version of the script have no "Daily" cell; they are
shown for the period they were exported for, and the page says so.

Impression-share values stay as Google reports them: 0.0999 means "below
10%" and 0.9001 "above 90%" (Google Ads API field reference, v25). The page
shows those as <10% and >90%, and any range built from such days as "≈".

Nothing here calls Google Ads. When the tabs are missing (the script has not
run yet) every section is empty and the page leaves its panels hidden.
"""

import datetime as _dt
import json
import re
import threading
import time
from collections import OrderedDict

TABS = {
    "is": "Insights - Impression share",
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
    "about2": "Insights - About (part 2)",   # written when the script is split into two (PART = 2)
}
PREFIX = "Insights - "
CACHE_TTL = 900
TERMS_PER_ACCOUNT = 1500      # sent to the page, by spend in the range
TERMS_ON_PAGE = 8000
GRAMS_PER_N = 300             # words and phrases sent to the page, by spend
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
DAILY_TREND_DAYS = 31         # the impression-share trend is by day up to this many days, by week beyond

# The figures in each tab's "Daily" cell, in the script's order (export_insights.js).
PERF = ("impr", "clicks", "cost", "conv", "value")
IS_DAILY = ("impr", "clicks", "cost", "conv", "value", "sg", "se", "lbe", "lre", "xe", "xw",
            "tg", "te", "ltbe", "ltre", "ag", "ae", "labe", "lare", "cg", "ce", "dg", "de", "dlbe", "dlre",
            "capped")
TERMS_DAILY = ("clicks", "cost", "conv", "value")
KEYWORDS_DAILY = ("impr", "clicks", "cost", "conv", "value", "sg", "se", "lre", "capped")
CONVERSIONS_DAILY = ("conv", "value", "all", "all_value")
AD_ASSETS_DAILY = ("impr", "clicks", "cost", "conv")

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


# ── Daily detail ─────────────────────────────────────────────────────────────
def _daily(v, width):
    """{"yyyy-mm-dd": [figures]} from a "Daily" cell, or None when there is none (an older export)."""
    obj = v if isinstance(v, dict) else _json_obj(v)
    if obj.get("v") != 1 or not isinstance(obj.get("d"), list):
        return None
    try:
        start = _dt.date.fromisoformat(str(obj.get("from"))[:10])
    except ValueError:
        return None
    out = {}
    for row in obj["d"]:
        if not isinstance(row, list) or not row or isinstance(row[0], bool) or not isinstance(row[0], (int, float)):
            continue
        day = (start + _dt.timedelta(days=int(row[0]))).isoformat()
        vals = [float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) else 0.0 for x in row[1:width + 1]]
        vals += [0.0] * (width - len(vals))
        prev = out.get(day)
        out[day] = vals if prev is None else [a + b for a, b in zip(prev, vals)]
    return out


_RANGE = re.compile(r"^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$")


def _window(r):
    """(from, to) from a row's "Date range" cell, or None (older exports wrote e.g. LAST_30_DAYS)."""
    m = _RANGE.match(_s(r, "date range"))
    return (m.group(1), m.group(2)) if m else None


def _sum_days(days, lo, hi, width):
    """The figures added up over the days in [lo, hi] (either may be None: open); None if no day falls in it."""
    out, hit = [0.0] * width, False
    for d, vals in days.items():
        if (lo and d < lo) or (hi and d > hi):
            continue
        hit = True
        for i in range(width):
            out[i] += vals[i]
    return out if hit else None


# ── Currencies ───────────────────────────────────────────────────────────────
MONEY = ("cost", "value", "all_value")


class FX:
    """Google Ads' own exchange rates, taken from the campaign report the page already shows.

    That report carries each campaign-day's cost twice: in the account's currency ("Cost",
    "Currency code") and converted into the manager account's currency ("Cost (Converted
    currency)", "Converted currency code"). Their ratio, added up over an account's campaigns
    for a day, is the rate Google used for that account and day. The insights come from each
    account in its own currency; converting them with the same rates makes every figure on the
    page agree with the campaign report. A day with no spend in the report takes the nearest
    earlier day's rate (else the nearest later one). An account the report cannot convert keeps
    its own currency, and its money is then never added to other currencies' (see _dominant)."""

    def __init__(self, rows=()):
        sums, native, to = {}, {}, {}
        for r in rows or ():
            a, nat, cur = r.get("account") or "", r.get("currency_native") or "", r.get("currency") or ""
            if cur:
                to[cur] = to.get(cur, 0) + 1
            if nat:
                native[a] = nat
            orig, conv = r.get("cost_native") or 0.0, r.get("cost") or 0.0
            if nat and cur and nat != cur and orig > 0 and conv > 0 and r.get("day"):
                d = sums.setdefault(a, {}).setdefault(r["day"], [0.0, 0.0])
                d[0] += conv
                d[1] += orig
        self.to = max(sorted(to), key=lambda c: to[c]) if to else ""
        self.native = native
        self.rates = {a: {d: c / o for d, (c, o) in days.items()} for a, days in sums.items()}
        self.days = {a: sorted(days) for a, days in self.rates.items()}

    def rate(self, account, day):
        rates, days = self.rates.get(account) or {}, self.days.get(account) or []
        if not days:
            return None
        if day in rates:
            return rates[day]
        import bisect
        i = bisect.bisect_left(days, day)
        return rates[days[i - 1]] if i > 0 else rates[days[0]]

    def latest(self, account):
        days = self.days.get(account)
        return self.rates[account][days[-1]] if days else None

    def converts(self, account, cur):
        """True when an account's figures in `cur` are converted into self.to."""
        return bool(cur and self.to and cur != self.to and self.native.get(account) == cur
                    and self.days.get(account))


NO_FX = FX()


def _money_sum(days, lo, hi, fields, rate):
    """Like _sum_days, with each day's money fields multiplied by rate(day)."""
    width, out, hit = len(fields), [0.0] * len(fields), False
    money = [i for i, f in enumerate(fields) if f in MONEY]
    for d, vals in days.items():
        if (lo and d < lo) or (hi and d > hi):
            continue
        hit = True
        r = rate(d)
        for i in range(width):
            out[i] += vals[i] * r if i in money else vals[i]
    return out if hit else None


def _dated(values, fields):
    """[(row dict, days or None, window or None)] for a tab, with the Daily cell parsed."""
    out = []
    for r in _table(values):
        out.append((r, _daily(r.get("daily"), len(fields)), _window(r)))
    return out


def _put(x, fields, sums):
    for i, f in enumerate(fields):
        x[f] = sums[i]
    return x


class Section:
    """One tab's rows as read: each item carries its days (or None for an older export)."""

    def __init__(self, items=(), fields=PERF):
        self.items = list(items)
        self.fields = fields
        wins = [w for _, _, w in self.items if w]
        self.window = (min(w[0] for w in wins), max(w[1] for w in wins)) if wins else None
        self.dated = bool(self.items) and all(d is not None for _, d, _ in self.items)

    def rows(self, lo=None, hi=None, keep_empty=False, fx=NO_FX, acct_cur=None):
        """Each item with its figures for [lo, hi]; items with no day in it are left out (or, with
        keep_empty, kept with zeros). Money is converted day by day into fx.to where fx can (the
        item then carries "native_cur"). Items from an older export (no days) keep the totals they
        were written with, in their own currency."""
        out = []
        for x, days, _ in self.items:
            if days is None:
                out.append(dict(x))
                continue
            a = x.get("account") or ""
            cur = x.get("cur") or (acct_cur or {}).get(a, "")
            if fx.converts(a, cur):
                sums = _money_sum(days, lo, hi, self.fields, lambda d, a=a: fx.rate(a, d))
                if sums is None and keep_empty:
                    sums = [0.0] * len(self.fields)
                if sums is not None:
                    out.append(_put(dict(x, cur=fx.to, native_cur=cur), self.fields, sums))
                continue
            sums = _sum_days(days, lo, hi, len(self.fields))
            if sums is None and keep_empty:
                sums = [0.0] * len(self.fields)
            if sums is not None:
                out.append(_put(dict(x), self.fields, sums))
        return out


def _dominant(rows, cost="cost", cur="cur"):
    """The currency most of the money is in, and whether there was more than one."""
    by = {}
    for r in rows:
        by[r.get(cur) or ""] = by.get(r.get(cur) or "", 0.0) + (r.get(cost) or 0.0)
    if not by:
        return "", False
    return max(sorted(by), key=lambda c: by[c]), len(by) > 1


def _keys(account, cur, dom):
    """The totals a row adds to: its account's, and the overall one when it is in the main currency
    (amounts in different currencies are never added together)."""
    return (account, "__all__") if cur == dom else (account,)


# ── Impression share ─────────────────────────────────────────────────────────
def _ratio(a, b):
    return a / b if b > 0 else None


def share_row(x):
    """Shares from the summed daily figures (IS_DAILY). Eligible impressions are impressions / share,
    and each lost share is a fraction of the same eligible impressions, so for any set of days or
    campaigns: share = impressions / eligible, lost = sum(lost x eligible) / eligible. Top and
    absolute-top shares are fractions of the eligible top and absolute-top impressions, click share
    of the eligible clicks. Exact-match share has no eligible count of its own in the API; it is
    weighted by eligible impressions and so marked approximate."""
    se, te, ae, de = x.get("se") or 0, x.get("te") or 0, x.get("ae") or 0, x.get("de") or 0
    x["is"] = _ratio(x.get("sg") or 0, se)
    x["lb"] = _ratio(x.get("lbe") or 0, se)
    x["lr"] = _ratio(x.get("lre") or 0, se)
    x["exact"] = _ratio(x.get("xe") or 0, x.get("xw") or 0)
    x["top"] = _ratio(x.get("tg") or 0, te)
    x["ltb"] = _ratio(x.get("ltbe") or 0, te)
    x["ltr"] = _ratio(x.get("ltre") or 0, te)
    x["abs"] = _ratio(x.get("ag") or 0, ae)
    x["lab"] = _ratio(x.get("labe") or 0, ae)
    x["lar"] = _ratio(x.get("lare") or 0, ae)
    x["click"] = _ratio(x.get("cg") or 0, x.get("ce") or 0)
    x["dis"] = _ratio(x.get("dg") or 0, de)
    x["dlb"] = _ratio(x.get("dlbe") or 0, de)
    x["dlr"] = _ratio(x.get("dlre") or 0, de)
    x["approx"] = (x.get("capped") or 0) > 0
    return x


def _legacy_share_weights(x):
    """Weights for a row exported without daily figures: eligible = impressions / share, as before."""
    s, impr = x.get("is"), x.get("impr") or 0
    if not s:
        return x
    e = impr / s
    x.update(sg=impr, se=e, lbe=(x.get("lb") or 0) * e, lre=(x.get("lr") or 0) * e,
             tg=(x.get("top") or 0) * e, te=e, ltbe=(x.get("ltb") or 0) * e, ltre=(x.get("ltr") or 0) * e,
             ag=(x.get("abs") or 0) * e, ae=e, labe=(x.get("lab") or 0) * e, lare=(x.get("lar") or 0) * e,
             xe=(x.get("exact") or 0) * e if x.get("exact") is not None else 0,
             xw=e if x.get("exact") is not None else 0)
    if x.get("click"):
        x.update(cg=x.get("clicks") or 0, ce=(x.get("clicks") or 0) / x["click"])
    x["capped"] = 1 if any(v is not None and (abs(v - 0.0999) < 1e-6 or abs(v - 0.9001) < 1e-6)
                           for v in (x.get("is"), x.get("lb"), x.get("lr"), x.get("top"), x.get("abs"),
                                     x.get("click"))) else 0
    return x


WEIGHTS = ("sg", "se", "lbe", "lre", "xe", "xw", "tg", "te", "ltbe", "ltre", "ag", "ae", "labe", "lare",
           "cg", "ce", "dg", "de", "dlbe", "dlre", "capped")


def read_is(values):
    items = []
    for r, days, win in _dated(values, IS_DAILY):
        if not _s(r, "campaign"):
            continue
        x = {"account": _s(r, "account"), "cid": _s(r, "customer id"), "cur": _s(r, "currency"),
             "id": _s(r, "campaign id"), "campaign": _s(r, "campaign"), "channel": _s(r, "channel"),
             "sub": _s(r, "sub-channel"), "status": _s(r, "status"), "bid": _s(r, "bidding strategy")}
        if days is None:
            x.update(impr=_z(r.get("impressions")), clicks=_z(r.get("clicks")), cost=_z(r.get("cost")),
                     conv=_z(r.get("conversions")), value=_z(r.get("conv. value")),
                     **{"is": _num(r.get("search is")), "top": _num(r.get("search top is")),
                        "abs": _num(r.get("search abs. top is")), "lb": _num(r.get("search lost is (budget)")),
                        "lr": _num(r.get("search lost is (rank)")),
                        "ltb": _num(r.get("search lost top is (budget)")),
                        "ltr": _num(r.get("search lost top is (rank)")),
                        "lab": _num(r.get("search lost abs. top is (budget)")),
                        "lar": _num(r.get("search lost abs. top is (rank)")),
                        "click": _num(r.get("search click share")), "exact": _num(r.get("search exact match is")),
                        "dis": _num(r.get("display is")), "dlb": _num(r.get("display lost is (budget)")),
                        "dlr": _num(r.get("display lost is (rank)"))})
            _legacy_share_weights(x)
            x["approx"] = bool(x["capped"])
            x["_legacy"] = True
        items.append((x, days, win))
    return Section(items, IS_DAILY)


def is_rows(sec, lo=None, hi=None, fx=NO_FX):
    """One row per campaign for the range, with its shares and the weights to combine them."""
    return [x if x.get("_legacy") else share_row(x) for x in sec.rows(lo, hi, fx=fx)]


def combine(rows):
    """Shares over several campaigns (or days): the weights added up, then share_row."""
    t = {k: 0.0 for k in WEIGHTS}
    for r in rows:
        for k in WEIGHTS:
            t[k] += r.get(k) or 0.0
    if not t["se"]:
        return None
    share_row(t)
    t["impr"] = t["sg"]
    t["elig"] = t["se"]
    return t


def cover(window, lo, hi):
    """The part of [lo, hi] a section has figures for, or None when they do not meet."""
    if not window:
        return None
    a, b = max(lo or window[0], window[0]), min(hi or window[1], window[1])
    return (a, b) if a <= b else None


def trend(sec, lo, hi, keep):
    """Impression share over time for the campaigns `keep` lets through: by day for a range of up to
    DAILY_TREND_DAYS days, else by week (Monday to Sunday, as Google Ads' own weeks). A week only
    partly inside the range is marked "partial"."""
    cov = cover(sec.window, lo, hi)
    if not cov:
        return "day", []
    span = (_dt.date.fromisoformat(cov[1]) - _dt.date.fromisoformat(cov[0])).days + 1
    grain = "day" if span <= DAILY_TREND_DAYS else "week"

    def bucket(d):
        if grain == "day":
            return d
        x = _dt.date.fromisoformat(d)
        return (x - _dt.timedelta(days=x.weekday())).isoformat()

    sums, width = {}, len(IS_DAILY)
    for x, days, _ in sec.items:
        if days is None or not keep(x):
            continue
        for d, vals in days.items():
            if d < cov[0] or d > cov[1]:
                continue
            b = sums.setdefault(bucket(d), [0.0] * width)
            for i in range(width):
                b[i] += vals[i]
    out = []
    for key in sorted(sums):
        row = share_row(_put({}, IS_DAILY, sums[key]))
        if row["is"] is None:
            continue
        row.update(week=key, impr=row["sg"], elig=row["se"])
        if grain == "week":
            end = (_dt.date.fromisoformat(key) + _dt.timedelta(days=6)).isoformat()
            row["partial"] = key < cov[0] or end > cov[1]
        out.append(row)
    return grain, out


def parse_is(values):
    """Campaign rows over the whole export window (older exports: as written)."""
    return is_rows(read_is(values))


# ── Budgets and pacing ───────────────────────────────────────────────────────
BUDGET_MONEY = ("tcpa", "daily", "total", "recommended", "today", "yesterday", "last7", "mtd", "value_mtd",
                "last_month")


def parse_budgets(values, fx=NO_FX):
    """Campaign rows plus the budgets they sit on (a shared budget covers several campaigns). Budgets
    and this month's spend are converted at the account's latest rate (one rate for the whole
    budget, so pace and projections are unchanged by the conversion)."""
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
        if fx.converts(c["account"], c["cur"]):
            _convert_now(c, BUDGET_MONEY, fx.latest(c["account"]))
            c["native_cur"], c["cur"] = c["cur"], fx.to
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


# ── Search terms ─────────────────────────────────────────────────────────────
def read_terms(values):
    items = []
    for r, days, win in _dated(values, TERMS_DAILY):
        term, rest = _s(r, "search term"), _num(r.get("rolled up"))
        if not term and not rest:
            continue
        x = {"account": _s(r, "account"), "cur": _s(r, "currency"), "campaign": _s(r, "campaign"),
             "ad_group": _s(r, "ad group"), "term": term, "match": _s(r, "search term match"),
             "keyword": _s(r, "keyword"), "kw_match": _s(r, "keyword match"), "status": _s(r, "status"),
             "rest": int(rest or 0)}
        if days is None:
            x.update(clicks=_z(r.get("clicks")), cost=_z(r.get("cost")), conv=_z(r.get("conversions")),
                     value=_z(r.get("conv. value")))
        items.append((x, days, win))
    return Section(items, TERMS_DAILY)


STOP = {"a", "an", "and", "the", "for", "of", "in", "to", "on", "with", "near", "me", "my", "at", "by", "or",
        "is", "&"}


def ngrams(rows, n, keep=GRAMS_PER_N):
    """Each word (n=1) or n-word phrase with every search term containing it added up, once per term;
    the `keep` that spent most."""
    by = {}
    for r in rows:
        words = [w for w in str(r["term"]).lower().split() if w]
        seen = set()
        for i in range(len(words) - n + 1):
            g = words[i:i + n]
            if n == 1 and g[0] in STOP:
                continue
            k = " ".join(g)
            if k in seen:
                continue
            seen.add(k)
            x = by.setdefault(k, {"gram": k, "terms": 0, "clicks": 0.0, "cost": 0.0, "conv": 0.0, "cur": r["cur"]})
            x["terms"] += 1
            x["clicks"] += r["clicks"]
            x["cost"] += r["cost"]
            x["conv"] += r["conv"]
    out = sorted(by.values(), key=lambda g: (-g["cost"], g["gram"]))
    return out[:keep], len(out)


def summarize_terms(rows, per_account=TERMS_PER_ACCOUNT, on_page=TERMS_ON_PAGE):
    """The most expensive terms per account for the page; totals, the match-type mix and the words
    over every term (and the rolled-up rest, which adds to spend and conversions but is not listed)."""
    listed = [x for x in rows if not x.get("rest")]
    rests = [x for x in rows if x.get("rest")]
    dom, mixed = _dominant(rows)
    totals = {}

    def tot(key, cur):
        return totals.setdefault(key, {"terms": 0, "clicks": 0.0, "cost": 0.0, "conv": 0.0, "value": 0.0,
                                       "wasted": 0.0, "wasted_terms": 0, "converting": 0, "cur": cur,
                                       "other_cost": 0.0, "other_conv": 0.0, "mixed": False})
    for x in listed:
        for key in _keys(x["account"], x["cur"], dom):
            t = tot(key, x["cur"])
            t["terms"] += 1
            t["clicks"] += x["clicks"]
            t["cost"] += x["cost"]
            t["conv"] += x["conv"]
            t["value"] += x["value"]
            if x["conv"] > 0:
                t["converting"] += 1
            elif x["cost"] > 0:
                t["wasted"] += x["cost"]
                t["wasted_terms"] += 1
    for x in rests:
        for key in _keys(x["account"], x["cur"], dom):
            t = tot(key, x["cur"])
            for f in ("clicks", "cost", "conv", "value"):
                t[f] += x[f]
            t["other_cost"] += x["cost"]
            t["other_conv"] += x["conv"]
    if mixed and "__all__" in totals:
        totals["__all__"]["mixed"] = True
    main = [x for x in listed if x["cur"] == dom]
    mix = {}
    for x in main:
        m = mix.setdefault(x["match"] or "OTHER", {"cost": 0.0, "conv": 0.0})
        m["cost"] += x["cost"]
        m["conv"] += x["conv"]
    grams, gram_count = {}, {}
    for n in (1, 2, 3):
        grams[str(n)], gram_count[str(n)] = ngrams(main, n)
    listed.sort(key=lambda x: (-x["cost"], x["term"]))
    kept = _trim(listed, per_account, on_page)
    return {"cols": ["account", "campaign", "ad_group", "term", "match", "keyword", "kw_match", "status",
                     "impr", "clicks", "cost", "conv", "value", "cur"],
            "rows": [[x["account"], x["campaign"], x["ad_group"], x["term"], x["match"], x["keyword"],
                      x["kw_match"], x["status"], None, x["clicks"], x["cost"], x["conv"], x["value"], x["cur"]]
                     for x in kept],
            "totals": totals, "read": len(listed), "mix": {"cur": dom, "parts": mix},
            "grams": grams, "gram_count": gram_count}


def parse_terms(values, per_account=TERMS_PER_ACCOUNT, on_page=TERMS_ON_PAGE):
    return summarize_terms(read_terms(values).rows(), per_account, on_page)


# ── Keywords and Quality Score ───────────────────────────────────────────────
QS_PARTS = (("ctr", "expected ctr"), ("relevance", "ad relevance"), ("landing", "landing page experience"))
BUCKETS = ("ABOVE_AVERAGE", "AVERAGE", "BELOW_AVERAGE")


def read_keywords(values):
    items = []
    for r, days, win in _dated(values, KEYWORDS_DAILY):
        text, rest = _s(r, "keyword"), _num(r.get("rolled up"))
        if not text and not rest:
            continue
        qs = _num(r.get("quality score"))
        x = {"account": _s(r, "account"), "cur": _s(r, "currency"), "campaign": _s(r, "campaign"),
             "ad_group": _s(r, "ad group"), "id": _s(r, "keyword id"), "kw": text, "match": _s(r, "match type"),
             "status": _s(r, "status"), "serving": _s(r, "serving"), "qs": int(qs) if qs else None,
             "ctr": _s(r, "expected ctr"), "relevance": _s(r, "ad relevance"),
             "landing": _s(r, "landing page experience"),
             "bid": _num(r.get("max cpc")), "first_page": _num(r.get("first page bid")),
             "top_page": _num(r.get("top of page bid")), "rest": int(rest or 0)}
        if days is None:
            x.update(impr=_z(r.get("impressions")), clicks=_z(r.get("clicks")), cost=_z(r.get("cost")),
                     conv=_z(r.get("conversions")), value=_z(r.get("conv. value")),
                     **{"is": _num(r.get("search is")), "lr": _num(r.get("search lost is (rank)"))})
            x["_legacy"] = True
        items.append((x, days, win))
    return Section(items, KEYWORDS_DAILY)


def keyword_rows(sec, lo=None, hi=None, fx=NO_FX):
    out = []
    for x in sec.rows(lo, hi, fx=fx):
        if not x.get("_legacy"):
            x["is"] = _ratio(x["sg"], x["se"])
            x["lr"] = _ratio(x["lre"], x["se"])
            x["approx"] = x["capped"] > 0
        if x.get("native_cur"):          # bids are settings: converted at the latest rate
            _convert_now(x, ("bid", "first_page", "top_page"), fx.latest(x["account"]))
        out.append(x)
    return out


def _convert_now(x, keys, rate):
    for k in keys:
        if x.get(k) is not None and rate:
            x[k] = x[k] * rate


def summarize_keywords(rows, per_account=KEYWORDS_PER_ACCOUNT, on_page=KEYWORDS_ON_PAGE):
    """Keywords for the page (costliest per account) and Quality Score totals over all read."""
    listed = [k for k in rows if not k.get("rest")]
    dom, mixed = _dominant(rows)
    totals = {}

    def tot(key, cur):
        return totals.setdefault(key, {"keywords": 0, "cost": 0.0, "clicks": 0.0, "conv": 0.0, "cur": cur,
                                       "qs_impr": 0.0, "qs_w": 0.0, "with_qs": 0, "low_qs_cost": 0.0,
                                       "low_qs": 0, "below_first_page": 0, "rarely_served": 0, "other_cost": 0.0,
                                       "mixed": False,
                                       "dist": {str(i): {"keywords": 0, "cost": 0.0, "conv": 0.0} for i in range(1, 11)},
                                       "parts": {p: {b: 0.0 for b in BUCKETS} for p, _ in QS_PARTS}})
    for k in rows:
        for key in _keys(k["account"], k["cur"], dom):
            t = tot(key, k["cur"])
            t["cost"] += k["cost"]
            t["clicks"] += k["clicks"]
            t["conv"] += k["conv"]
            if k.get("rest"):
                t["other_cost"] += k["cost"]
                continue
            t["keywords"] += 1
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
    if mixed and "__all__" in totals:
        totals["__all__"]["mixed"] = True
    listed.sort(key=lambda k: -k["cost"])
    kept = [{f: v for f, v in k.items() if f not in WEIGHTS_KW} for k in _trim(listed, per_account, on_page)]
    return {"rows": kept, "totals": totals, "read": len(listed)}


WEIGHTS_KW = ("sg", "se", "lre", "capped", "rest", "_legacy")


def parse_keywords(values, per_account=KEYWORDS_PER_ACCOUNT, on_page=KEYWORDS_ON_PAGE):
    return summarize_keywords(keyword_rows(read_keywords(values)), per_account, on_page)


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


def _perf_section(values, attrs):
    """A tab of performance rows: attrs(r) -> dict or None to skip; figures from Daily or the columns."""
    items = []
    for r, days, win in _dated(values, PERF):
        x = attrs(r)
        if x is None:
            continue
        if days is None:
            x.update(_perf(r))
        items.append((x, days, win))
    return Section(items, PERF)


# ── Devices, hours, locations ────────────────────────────────────────────────
def read_devices(values):
    return _perf_section(values, lambda r: {"account": _s(r, "account"), "cur": _s(r, "currency"),
                                            "campaign": _s(r, "campaign"), "channel": _s(r, "channel"),
                                            "device": _s(r, "device")} if _s(r, "device") else None)


def parse_devices(values):
    return read_devices(values).rows()


DAYS = ("MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY")


def read_hours(values):
    def attrs(r):
        hour = _num(r.get("hour"))
        if hour is None:
            return None
        x = {"account": _s(r, "account"), "cur": _s(r, "currency"), "tz": _s(r, "time zone"), "hour": int(hour)}
        day = _s(r, "day of week").upper()
        if day:                      # an older export: one row per day of the week and hour
            if day not in DAYS:
                return None
            x["day"] = DAYS.index(day)
        return x
    return _perf_section(values, attrs)


def hour_rows(sec, lo=None, hi=None, fx=NO_FX):
    """Account x day of week (Monday = 0) x hour, added up over the days in the range, money
    converted day by day as in Section.rows."""
    out = {}
    for x, days, _ in sec.items:
        if days is None:
            if "day" in x:
                out[(x["account"], x["day"], x["hour"], len(out))] = dict(x)
            continue
        conv = fx.converts(x["account"], x["cur"])
        for d, vals in days.items():
            if (lo and d < lo) or (hi and d > hi):
                continue
            wd = _dt.date.fromisoformat(d).weekday()
            k = (x["account"], wd, x["hour"])
            h = out.get(k)
            if h is None:
                h = out[k] = {"account": x["account"], "cur": fx.to if conv else x["cur"], "tz": x["tz"], "day": wd,
                              "hour": x["hour"], "impr": 0.0, "clicks": 0.0, "cost": 0.0, "conv": 0.0, "value": 0.0}
                if conv:
                    h["native_cur"] = x["cur"]
            r = fx.rate(x["account"], d) if conv else 1.0
            for i, f in enumerate(PERF):
                h[f] += vals[i] * r if f in MONEY else vals[i]
    return sorted(out.values(), key=lambda h: (h["account"], h["day"], h["hour"]))


def parse_hours(values):
    return hour_rows(read_hours(values))


def read_locations(values):
    def attrs(r):
        region, city, country, rest = _s(r, "region"), _s(r, "city"), _s(r, "country"), _num(r.get("rolled up"))
        if not (region or city or country or rest):
            return None
        return {"account": _s(r, "account"), "cur": _s(r, "currency"), "type": _s(r, "location type"),
                "country": country, "region": region, "city": city, "rest": int(rest or 0)}
    return _perf_section(values, attrs)


def summarize_locations(rows, per_account=LOCATIONS_PER_ACCOUNT, on_page=LOCATIONS_ON_PAGE):
    dom, mixed = _dominant(rows)
    totals = {}
    for x in rows:
        for key in _keys(x["account"], x["cur"], dom):
            t = totals.setdefault(key, {"cost": 0.0, "conv": 0.0, "interest_cost": 0.0, "rows": 0,
                                        "other_cost": 0.0, "cur": x["cur"], "mixed": False})
            t["cost"] += x["cost"]
            t["conv"] += x["conv"]
            if x.get("rest"):
                t["other_cost"] += x["cost"]
                continue
            t["rows"] += 1
            if x["type"] == "AREA_OF_INTEREST":
                t["interest_cost"] += x["cost"]
    if mixed and "__all__" in totals:
        totals["__all__"]["mixed"] = True
    listed = sorted((x for x in rows if not x.get("rest")), key=lambda x: -x["cost"])
    main = [x for x in listed if x["cur"] == dom]
    groups = {level: {kind: location_groups(main, level, kind) for kind in ("all", "LOCATION_OF_PRESENCE",
                                                                             "AREA_OF_INTEREST")}
              for level in ("region", "city")}
    return {"rows": _trim(listed, per_account, on_page), "totals": totals, "read": len(listed),
            "groups": groups, "cur": dom, "mixed": mixed}


GROUPS_KEPT = 250


def location_groups(rows, level, kind):
    """Rows added up by region (or city), over every location read in the main currency: the
    GROUPS_KEPT that spent most, with totals over all of them."""
    by = {}
    for x in rows:
        if kind != "all" and x["type"] != kind:
            continue
        if level == "city":
            name = x["city"] or "(%s, city not known)" % (x["region"] or x["country"] or "Unknown")
            sub = ", ".join(v for v in (x["region"], x["country"]) if v)
        else:
            name, sub = x["region"] or x["country"] or "Unknown", x["country"]
        g = by.setdefault((name, sub), {"name": name, "sub": sub, "cost": 0.0, "conv": 0.0, "clicks": 0.0,
                                        "impr": 0.0})
        for f in ("cost", "conv", "clicks", "impr"):
            g[f] += x[f]
    groups = sorted(by.values(), key=lambda g: (-g["cost"], g["name"]))
    waste = [g for g in groups if not g["conv"] and g["cost"] > 0]
    return {"list": groups[:GROUPS_KEPT], "count": len(groups), "spent": sum(1 for g in groups if g["cost"] > 0),
            "cost": sum(g["cost"] for g in groups), "conv": sum(g["conv"] for g in groups),
            "waste_cost": sum(g["cost"] for g in waste), "waste_n": len(waste)}


def parse_locations(values, per_account=LOCATIONS_PER_ACCOUNT, on_page=LOCATIONS_ON_PAGE):
    return summarize_locations(read_locations(values).rows(), per_account, on_page)


# ── Conversions ──────────────────────────────────────────────────────────────
def read_conversions(values):
    items = []
    for r, days, win in _dated(values, CONVERSIONS_DAILY):
        if not _s(r, "conversion action"):
            continue
        x = {"account": _s(r, "account"), "campaign": _s(r, "campaign"), "action": _s(r, "conversion action"),
             "category": _s(r, "category")}
        if days is None:
            x.update(conv=_z(r.get("conversions")), value=_z(r.get("conv. value")), all=_z(r.get("all conversions")),
                     all_value=_z(r.get("all conv. value")))
        items.append((x, days, win))
    return Section(items, CONVERSIONS_DAILY)


def parse_conversions(values):
    return read_conversions(values).rows()


# Categories that are leads rather than sales. Google recommends counting "One"
# conversion per click for leads and "Every" for sales (Google Ads Help,
# "About conversion counting options").
LEAD_CATEGORIES = {"SUBMIT_LEAD_FORM", "CONTACT", "SIGNUP", "BOOK_APPOINTMENT", "REQUEST_QUOTE",
                   "PHONE_CALL_LEAD", "IMPORTED_LEAD", "QUALIFIED_LEAD", "CONVERTED_LEAD", "GET_DIRECTIONS"}
SOFT_CATEGORIES = {"PAGE_VIEW", "ENGAGEMENT", "OUTBOUND_CLICK", "DEFAULT"}


def _by_action(conversions):
    got = {}
    for c in conversions:
        k = (c["account"], c["action"])
        g = got.setdefault(k, {"conv": 0.0, "value": 0.0, "all": 0.0, "all_value": 0.0})
        for f in ("conv", "value", "all", "all_value"):
            g[f] += c[f]
    return got


def parse_actions(values, conversions=(), recent=None):
    """Every conversion action with its totals for the period shown (`conversions`) and setup flags.
    "Recorded nothing" is judged on `recent` (the last 30 days of the export), whatever the period."""
    got = _by_action(conversions)
    last30 = _by_action(conversions if recent is None else recent)
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
        if a["primary"] and a["status"] == "ENABLED" and not last30.get((a["account"], name), {}).get("all"):
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


def read_ads(values):
    def attrs(r):
        if not _s(r, "ad id"):
            return None
        return {"account": _s(r, "account"), "cur": _s(r, "currency"), "campaign": _s(r, "campaign"),
                "channel": _s(r, "channel"), "ad_group": _s(r, "ad group"), "ad_group_id": _s(r, "ad group id"),
                "id": _s(r, "ad id"), "kind": _s(r, "kind"), "type": _s(r, "ad type"), "status": _s(r, "status"),
                "primary_status": _s(r, "primary status"), "approval": _s(r, "approval"), "review": _s(r, "review"),
                "topics": _s(r, "policy topics"), "strength": _s(r, "ad strength"), "url": _s(r, "final url"),
                "path1": _s(r, "path 1"), "path2": _s(r, "path 2"),
                "heads": [h for h in _json_list(r.get("headlines")) if isinstance(h, dict)],
                "descs": [d for d in _json_list(r.get("descriptions")) if isinstance(d, dict)],
                "pinned": int(_z(r.get("pinned")))}
    return _perf_section(values, attrs)


def read_ad_assets(values):
    items = []
    for r, days, win in _dated(values, AD_ASSETS_DAILY):
        x = {"account": _s(r, "account"), "campaign": _s(r, "campaign"),
             "key": _s(r, "account") + "\u0001" + _s(r, "ad group id") + "~" + _s(r, "ad id"),
             "f": _s(r, "field"), "t": _s(r, "text"), "pin": _s(r, "pinned to"), "label": _s(r, "performance label")}
        if days is None:
            x.update(impr=_z(r.get("impressions")), clicks=_z(r.get("clicks")), cost=_z(r.get("cost")),
                     conv=_z(r.get("conversions")))
        items.append((x, days, win))
    return Section(items, AD_ASSETS_DAILY)


def read_combos(values):
    by_key = {}
    for r in _table(values):
        key = _s(r, "account") + "\u0001" + _s(r, "ad group id") + "~" + _s(r, "ad id")
        parts = [x for x in (_part(p) for p in _json_list(r.get("assets json"))) if x]
        by_key.setdefault(key, []).append({
            "rank": int(_z(r.get("rank"))), "impr": _num(r.get("impressions")), "category": _s(r, "category"),
            "heads": [p["x"] for p in parts if p["f"].startswith("HEADLINE") and p.get("x")],
            "descs": [p["x"] for p in parts if p["f"].startswith("DESCRIPTION") and p.get("x")],
            "parts": parts})
    return by_key


def summarize_ads(ad_rows, combos, asset_rows, per_account=ADS_PER_ACCOUNT, on_page=ADS_ON_PAGE):
    """Live ads and asset groups with their served combinations, asset performance and flags."""
    perf = {}
    for x in asset_rows:
        perf.setdefault(x["key"], []).append({k: x[k] for k in ("f", "t", "pin", "label", "impr", "clicks",
                                                                  "cost", "conv")})
    rows = []
    for a in ad_rows:
        a = dict(a)
        key = a["account"] + "\u0001" + a.pop("ad_group_id", "") + "~" + a["id"]
        a["combos"] = sorted(combos.get(key, []), key=lambda c: (c["category"], c["rank"]))
        a["assets"] = sorted(perf.get(key, []), key=lambda x: (x["f"], -x["impr"]))
        a["flags"] = _ad_flags(a)
        rows.append(a)
    dom, mixed = _dominant(rows)
    totals = {}
    for a in rows:
        for key in _keys(a["account"], a["cur"], dom):
            t = totals.setdefault(key, {"ads": 0, "rsa": 0, "asset_groups": 0, "other": 0, "cost": 0.0,
                                        "strength": {s: {"n": 0, "cost": 0.0} for s in STRENGTHS},
                                        "disapproved": 0, "limited": 0, "pinned_ads": 0, "low_assets": 0,
                                        "no_impressions": 0, "cur": a["cur"], "mixed": False})
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
    if mixed and "__all__" in totals:
        totals["__all__"]["mixed"] = True
    rows.sort(key=lambda a: (a["approval"] != "DISAPPROVED", -a["cost"]))
    kept = _trim(rows, per_account, on_page)
    for a in kept:
        a["combos"] = [c for c in a["combos"] if c["category"] or c["rank"] <= COMBOS_PER_AD][:12]
    return {"rows": kept, "totals": totals, "read": len(rows)}


def parse_ads(values, combos=None, assets=None, per_account=ADS_PER_ACCOUNT, on_page=ADS_ON_PAGE):
    return summarize_ads(read_ads(values).rows(keep_empty=True), read_combos(combos),
                         read_ad_assets(assets).rows(keep_empty=True), per_account, on_page)


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
        flags.append(["info", "No impressions in the period shown."])
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


def read_changes(values):
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
    return rows


def summarize_changes(rows, per_account=CHANGES_PER_ACCOUNT, on_page=CHANGES_ON_PAGE):
    totals = {}
    for x in rows:
        for key in (x["account"], "__all__"):
            t = totals.setdefault(key, {"n": 0, "kinds": {k: 0 for k in CHANGE_KINDS}, "via": {}, "auto": 0,
                                        "days": {}, "day_kinds": {}, "people": 0, "_people": set(), "first": x["day"],
                                        "last": x["day"]})
            t["n"] += 1
            t["kinds"][x["kind"]] += 1
            t["via"][x["via"] or "UNKNOWN"] = t["via"].get(x["via"] or "UNKNOWN", 0) + 1
            t["auto"] += x["via"] == AUTO_APPLIED
            t["days"][x["day"]] = t["days"].get(x["day"], 0) + 1
            dk = t["day_kinds"].setdefault(x["day"], {})
            dk[x["kind"]] = dk.get(x["kind"], 0) + 1
            if x["by"]:
                t["_people"].add(x["by"])
            t["first"], t["last"] = min(t["first"], x["day"]), max(t["last"], x["day"])
    for t in totals.values():
        t["people"] = len(t.pop("_people"))
    return {"rows": _trim(rows, per_account, on_page), "totals": totals, "read": len(rows)}


def parse_changes(values, per_account=CHANGES_PER_ACCOUNT, on_page=CHANGES_ON_PAGE):
    return summarize_changes(read_changes(values), per_account, on_page)


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


def read_recs(values):
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
    return rows


def convert_recs(rows, fx):
    """Google's impact estimates and budget amounts are in the account's currency: converted at
    the account's latest rate (they are forecasts and settings, not spend on a given day)."""
    out = []
    for x in rows:
        if not fx.converts(x["account"], x["cur"]):
            out.append(x)
            continue
        r = fx.latest(x["account"])
        y = dict(x, cur=fx.to, native_cur=x["cur"])
        _convert_now(y, ("budget_now", "budget_rec"), r)
        for k in ("base", "pot", "gain"):
            if y[k]:
                y[k] = dict(y[k], cost=y[k]["cost"] * r, value=y[k]["value"] * r)
        out.append(y)
    return out


def summarize_recs(rows, per_account=RECS_PER_ACCOUNT):
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


def parse_recs(values, per_account=RECS_PER_ACCOUNT):
    return summarize_recs(read_recs(values), per_account)


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


def read_demographics(values):
    def attrs(r):
        dim, seg = _s(r, "dimension"), _s(r, "segment")
        if dim not in ("Age", "Gender") or not seg:
            return None
        order = AGE_ORDER if dim == "Age" else GENDER_ORDER
        return {"account": _s(r, "account"), "cur": _s(r, "currency"), "campaign": _s(r, "campaign"),
                "channel": _s(r, "channel"), "dim": dim, "seg": seg, "label": segment_label(seg),
                "order": order.index(seg) if seg in order else len(order)}
    return _perf_section(values, attrs)


def parse_demographics(values):
    return read_demographics(values).rows()


def _frac(v):
    """A share as 0-1, whether the cell holds 0.62 or 62."""
    x = _num(v)
    if x is None:
        return None
    return x / 100 if x > 1 else x


# ── Landing pages ────────────────────────────────────────────────────────────
def read_landing(values):
    """Final URLs with Google's mobile speed score: "a 10-point scale, 1 being very slow and 10
    being extremely fast" (Google, "Speed matters when providing assistive experiences", 2018).
    Speed and mobile-friendly clicks are Google's readings for the last 30 days, whatever the period."""
    def attrs(r):
        url, rest = _s(r, "landing page"), _num(r.get("rolled up"))
        if not url and not rest:
            return None
        speed = _num(r.get("speed score"))
        return {"account": _s(r, "account"), "cur": _s(r, "currency"), "url": url[:500],
                "speed": int(speed) if speed is not None and 1 <= speed <= 10 and not rest else None,
                "mobile": None if rest else _frac(r.get("mobile-friendly clicks")),
                "amp": None if rest else _frac(r.get("valid amp clicks")), "rest": int(rest or 0)}
    return _perf_section(values, attrs)


def summarize_landing(rows, per_account=LANDING_PER_ACCOUNT, on_page=LANDING_ON_PAGE):
    dom, mixed = _dominant(rows)
    totals = {}
    for x in rows:
        for key in _keys(x["account"], x["cur"], dom):
            t = totals.setdefault(key, {"pages": 0, "cost": 0.0, "conv": 0.0, "clicks": 0.0, "scored_cost": 0.0,
                                        "speed_w": 0.0, "speeds": [0] * 10, "speed_cost": [0.0] * 10,
                                        "mobile_w": 0.0, "mobile_clicks": 0.0, "other_cost": 0.0,
                                        "cur": x["cur"], "mixed": False})
            t["cost"] += x["cost"]
            t["conv"] += x["conv"]
            t["clicks"] += x["clicks"]
            if x.get("rest"):
                t["other_cost"] += x["cost"]
                continue
            t["pages"] += 1
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
    if mixed and "__all__" in totals:
        totals["__all__"]["mixed"] = True
    listed = sorted((x for x in rows if not x.get("rest")), key=lambda x: -x["cost"])
    return {"rows": _trim(listed, per_account, on_page), "totals": totals, "read": len(listed)}


def parse_landing(values, per_account=LANDING_PER_ACCOUNT, on_page=LANDING_ON_PAGE):
    return summarize_landing(read_landing(values).rows(), per_account, on_page)


def parse_about(values):
    out = []
    for row in values[1:] if values else []:
        if row and str(row[0]).strip():
            out.append([str(row[0]).strip(), str(row[1]).strip() if len(row) > 1 else ""])
    return out


def empty():
    return {"ok": False, "is": [], "weekly": [], "weekly_grain": "day", "budgets": [], "budget_campaigns": [],
            "budget_limited": {},
            "terms": {"cols": [], "rows": [], "totals": {}, "read": 0, "mix": {"cur": "", "parts": {}},
                      "grams": {"1": [], "2": [], "3": []}, "gram_count": {}},
            "about": [], "as_of": "",
            "currencies": [], "keywords": {"rows": [], "totals": {}, "read": 0}, "devices": [], "hours": [],
            "locations": {"rows": [], "totals": {}, "read": 0, "groups": {}}, "conversions": [], "actions": [],
            "ads": {"rows": [], "totals": {}, "read": 0},
            "changes": {"rows": [], "totals": {}, "read": 0},
            "health": {"accounts": [], "campaigns": [], "overall": None},
            "recs": {"rows": [], "totals": {}, "read": 0}, "demographics": [],
            "landing": {"rows": [], "totals": {}, "read": 0},
            "range": {"from": None, "to": None}, "meta": {}, "params": {}, "has": {}}


# ── Reading once, viewing by range and filters ──────────────────────────────
CHANGE_DAYS = 28      # the script's change-history window
LIMITED_DAYS = 7      # "losing searches to budget" on the pacing panel: the last 7 days exported


def load(raw):
    """Everything the tabs hold, parsed once: {"is": Section, ..., "about": [...]}. Cached by fetch()."""
    about = parse_about(raw.get("about")) + parse_about(raw.get("about2"))
    st = {
        "is": read_is(raw.get("is")),
        "budgets": raw.get("budgets") or [],
        "terms": read_terms(raw.get("terms")),
        "keywords": read_keywords(raw.get("keywords")),
        "devices": read_devices(raw.get("devices")),
        "hours": read_hours(raw.get("hours")),
        "locations": read_locations(raw.get("locations")),
        "conversions": read_conversions(raw.get("conversions")),
        "actions": raw.get("actions") or [],
        "ads": read_ads(raw.get("ads")),
        "combos": read_combos(raw.get("combos")),
        "ad_assets": read_ad_assets(raw.get("ad_assets")),
        "changes": read_changes(raw.get("changes")),
        "health": parse_health(raw.get("health")),
        "recs": read_recs(raw.get("recs")),
        "demographics": read_demographics(raw.get("demographics")),
        "landing": read_landing(raw.get("landing")),
        "about": about,
        "as_of": next((v for k, v in about if k == "Exported at"), ""),
    }
    # Each account's own currency, from every tab that states it (the conversions tab does not).
    curs, acct_cur = {}, {}
    for k in ("is", "terms", "keywords", "devices", "hours", "locations", "ads", "demographics", "landing"):
        for x, _, _ in st[k].items:
            if x.get("cur"):
                curs[x["cur"]] = curs.get(x["cur"], 0) + 1
                acct_cur.setdefault(x["account"], x["cur"])
    for c in parse_budgets(st["budgets"])[0] + st["changes"] + st["recs"]:
        if c.get("cur"):
            curs[c["cur"]] = curs.get(c["cur"], 0) + 1
            acct_cur.setdefault(c["account"], c["cur"])
    st["currencies"] = sorted(curs, key=lambda c: -curs[c])
    st["acct_cur"] = acct_cur
    st["ok"] = any(st[k].items for k in ("is", "terms", "keywords", "devices", "hours", "locations", "ads",
                                         "demographics", "landing")) or bool(
        st["budgets"][1:] or st["actions"][1:] or st["changes"] or st["health"]["accounts"] or st["recs"])
    return st


class Filters:
    """The page's filters, applied the way the campaign report above applies them
    (google-ads-dashboard.js, matches()): account, campaign type, campaign status, one campaign, and
    search text that matches the campaign or account name. Type and status come from the campaign
    report itself (`camps`: {(account, campaign): {"types": set, "states": set}}), so a campaign
    the report does not know is left out while either filter is on."""

    def __init__(self, account="", type_="", status="", search="", focus="", camps=None):
        self.account = "" if account in (None, "", "__all__") else account
        self.type = "" if type_ in (None, "", "__all__") else type_
        self.status = "" if status in (None, "", "__all__") else status
        self.search = (search or "").strip().lower()
        self.focus = focus or ""
        self.camps = camps or {}

    @property
    def narrowed(self):
        """True when a filter below account level is on (campaign-level panels follow it)."""
        return bool(self.type or self.status or self.search or self.focus)

    def in_account(self, x):
        return not self.account or x.get("account") == self.account

    def campaign(self, x):
        """A row that belongs to one campaign."""
        a, c = x.get("account") or "", x.get("campaign") or ""
        if not self.in_account(x):
            return False
        if self.focus and (a + "\u0001" + c) != self.focus:
            return False
        if self.type or self.status:
            info = self.camps.get((a, c))
            if not info:
                return False
            if self.type and self.type not in info["types"]:
                return False
            if self.status and self.status not in info["states"]:
                return False
        if self.search and self.search not in c.lower() and self.search not in a.lower():
            return False
        return True

    def whole_account(self, x):
        """A row that is not one campaign's (a rolled-up rest, an account-level change): kept when no
        campaign-level filter is on, or when the search text matches its account's name."""
        if not self.in_account(x):
            return False
        if self.type or self.status or self.focus:
            return False
        return not self.search or self.search in (x.get("account") or "").lower()

    def row(self, x):
        """A row of a tab with both kinds: one campaign's (a rolled-up rest included, as the script
        rolls up per campaign), or the whole account's."""
        return self.campaign(x) if x.get("campaign") else self.whole_account(x)


def _meta(sec, lo, hi, scope):
    win = sec.window if isinstance(sec, Section) else sec
    dated = sec.dated if isinstance(sec, Section) else bool(win)
    cov = cover(win, lo, hi) if win else None
    return {"from": win[0] if win else None, "to": win[1] if win else None,
            "cover": list(cov) if cov else None, "dated": dated, "scope": scope,
            "empty": isinstance(sec, Section) and not sec.items}


def view(st, start=None, end=None, account="", type_="", status="", search="", focus="", camps=None, fx=None):
    """The page's insights for one date range and set of filters, money in fx.to where the campaign
    report gives Google's rate for an account (see FX)."""
    fx = fx or NO_FX
    ac = (st or {}).get("acct_cur", {})
    out = empty()
    if not st or not st.get("ok"):
        out["about"] = (st or {}).get("about", [])
        return out
    lo, hi = start or None, end or None
    f = Filters(account, type_, status, search, focus, camps)
    meta = {}

    # Impression share, and its trend by day or week.
    rows = [x for x in is_rows(st["is"], lo, hi, fx) if f.campaign(x)]
    out["is"] = rows
    out["weekly_grain"], out["weekly"] = trend(st["is"], lo, hi, f.campaign)
    meta["is"] = _meta(st["is"], lo, hi, "campaign")

    # Budgets (this month, now): a budget stays whole when any of its campaigns passes the filters,
    # so a shared budget's pace is never worked out from part of its spend.
    camps_b, budgets = parse_budgets(st["budgets"], fx)
    out["budget_campaigns"] = [c for c in camps_b if f.campaign(c)]
    out["budgets"] = [b for b in budgets
                      if any(f.campaign({"account": b["account"], "campaign": c}) for c in b["campaigns"])]
    win = st["is"].window
    if win:
        last = _dt.date.fromisoformat(win[1])
        since = (last - _dt.timedelta(days=LIMITED_DAYS - 1)).isoformat()
        for x in is_rows(st["is"], since, win[1]):
            if (x.get("lb") or 0) >= 0.1:
                out["budget_limited"][x["account"] + "\u0001" + x["campaign"]] = x["lb"]
    meta["budgets"] = {"scope": "current", "dated": False, "from": None, "to": None, "cover": None,
                       "limited_from": since if win else None, "limited_to": win[1] if win else None}

    # Search terms and keywords: every row read counts toward the totals.
    out["terms"] = summarize_terms([x for x in st["terms"].rows(lo, hi, fx=fx) if f.row(x)])
    meta["terms"] = _meta(st["terms"], lo, hi, "campaign")
    out["keywords"] = summarize_keywords([x for x in keyword_rows(st["keywords"], lo, hi, fx) if f.row(x)])
    meta["keywords"] = _meta(st["keywords"], lo, hi, "campaign")

    out["devices"] = [x for x in st["devices"].rows(lo, hi, fx=fx) if f.campaign(x)]
    meta["devices"] = _meta(st["devices"], lo, hi, "campaign")
    # Hours, locations and landing pages are account-level reports: account and dates only.
    out["hours"] = [x for x in hour_rows(st["hours"], lo, hi, fx) if f.in_account(x)]
    meta["hours"] = _meta(st["hours"], lo, hi, "account")
    cov = cover(st["hours"].window, lo, hi)
    if cov:
        n = [0] * 7
        d = _dt.date.fromisoformat(cov[0])
        while d.isoformat() <= cov[1]:
            n[d.weekday()] += 1
            d += _dt.timedelta(days=1)
        meta["hours"]["weekdays"] = n
    out["locations"] = summarize_locations([x for x in st["locations"].rows(lo, hi, fx=fx) if f.in_account(x)])
    meta["locations"] = _meta(st["locations"], lo, hi, "account")

    out["conversions"] = [dict(x, cur=x.get("cur") or ac.get(x["account"], ""))
                          for x in st["conversions"].rows(lo, hi, fx=fx, acct_cur=ac) if f.campaign(x)]
    meta["conversions"] = _meta(st["conversions"], lo, hi, "campaign")
    recent = None
    cwin = st["conversions"].window
    if cwin:
        end_ = _dt.date.fromisoformat(cwin[1])
        recent = st["conversions"].rows((end_ - _dt.timedelta(days=29)).isoformat(), cwin[1], fx=fx, acct_cur=ac)
    out["actions"] = [a for a in parse_actions(st["actions"], out["conversions"], recent) if f.in_account(a)]
    for a in out["actions"]:
        a["native_cur"] = ac.get(a["account"], "")
        a["cur"] = next((c["cur"] for c in out["conversions"] if c["account"] == a["account"]),
                        fx.to if fx.converts(a["account"], a["native_cur"]) else a["native_cur"])

    # Ads: the live ones now, with their performance in the range.
    ad_rows = [x for x in st["ads"].rows(lo, hi, keep_empty=True, fx=fx) if f.campaign(x)]
    asset_rows = st["ad_assets"].rows(lo, hi, keep_empty=True, fx=fx, acct_cur=ac)
    out["ads"] = summarize_ads(ad_rows, st["combos"], asset_rows)
    meta["ads"] = _meta(st["ads"], lo, hi, "campaign")

    # Change history: the changes made inside the range.
    changes = [c for c in st["changes"] if (not lo or c["day"] >= lo) and (not hi or c["day"] <= hi) and f.row(c)]
    out["changes"] = summarize_changes(changes)
    cwin = None
    if st["as_of"][:10]:
        try:
            made = _dt.date.fromisoformat(st["as_of"][:10])
            cwin = ((made - _dt.timedelta(days=CHANGE_DAYS)).isoformat(), made.isoformat())
        except ValueError:
            cwin = None
    meta["changes"] = _meta(cwin, lo, hi, "campaign")

    h = st["health"]
    accounts = [dict(a) for a in h["accounts"] if f.in_account(a)]
    campaigns = [dict(c) for c in h["campaigns"] if f.campaign(c)]
    # Spend beside each score: the last 30 days exported, from the daily figures (converted like
    # every other panel) whenever the export has them.
    if st["is"].dated and st["is"].window:
        last = _dt.date.fromisoformat(st["is"].window[1])
        spend = {}
        for x in is_rows(st["is"], (last - _dt.timedelta(days=29)).isoformat(), st["is"].window[1], fx):
            spend[(x["account"], x["id"])] = x
        for c in campaigns:
            x = spend.get((c["account"], c["id"]))
            c.update(cost=x["cost"] if x else 0.0, conv=x["conv"] if x else 0.0, cur=x["cur"] if x else c["cur"])
        for a in accounts:
            mine = [x for (acct, _), x in spend.items() if acct == a["account"]]
            a.update(cost=sum(x["cost"] for x in mine), conv=sum(x["conv"] for x in mine),
                     cur=mine[0]["cur"] if mine else a["cur"])
    out["health"] = {"accounts": accounts, "campaigns": campaigns, "overall": weighted_score(accounts)}
    out["recs"] = summarize_recs(convert_recs([r for r in st["recs"] if f.row(r)], fx))
    meta["health"] = meta["recs"] = {"scope": "current", "dated": False, "from": None, "to": None, "cover": None}

    out["demographics"] = [x for x in st["demographics"].rows(lo, hi, fx=fx) if f.campaign(x)]
    meta["demographics"] = _meta(st["demographics"], lo, hi, "campaign")
    out["landing"] = summarize_landing([x for x in st["landing"].rows(lo, hi, fx=fx) if f.in_account(x)])
    meta["landing"] = _meta(st["landing"], lo, hi, "account")

    out["about"] = st["about"]
    out["as_of"] = st["as_of"]
    # Which accounts were converted, and which could not be (their money stays in their own currency
    # and is never added to another currency's).
    converted, kept = {}, {}
    for a, cur in sorted(ac.items()):
        if not f.in_account({"account": a}) or not cur or cur == fx.to or not fx.to:
            continue
        (converted if fx.converts(a, cur) else kept).setdefault(cur, []).append(a)
    out["fx"] = {"to": fx.to, "converted": converted, "kept": kept}
    out["currencies"] = sorted(set(st["currencies"]) | ({fx.to} if fx.to else set()))
    out["meta"] = meta
    out["range"] = {"from": lo, "to": hi}
    out["params"] = {"from": lo or "", "to": hi or "", "account": f.account, "type": f.type, "status": f.status,
                     "search": f.search, "focus": f.focus}
    out["has"] = {"is": bool(st["is"].items), "budgets": bool(budgets), "terms": bool(st["terms"].items),
                  "keywords": bool(st["keywords"].items), "devices": bool(st["devices"].items),
                  "hours": bool(st["hours"].items), "locations": bool(st["locations"].items),
                  "conversions": bool(st["conversions"].items or st["actions"][1:]), "ads": bool(st["ads"].items),
                  "changes": bool(st["changes"]), "health": bool(h["accounts"] or st["recs"]),
                  "demographics": bool(st["demographics"].items), "landing": bool(st["landing"].items)}
    out["ok"] = True
    return out


def build(raw, **kw):
    """The page's insights from {"is": values, ...} (missing keys: empty), for the whole export window
    unless start and end are given."""
    return view(load(raw), **kw)


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


_LOCK = threading.Lock()
_CACHE = {"at": 0.0, "value": None, "key": None, "error": None}
_VIEWS = OrderedDict()
VIEWS_KEPT = 32


def store(svc_factory, sheet_id, titles=None, force=False):
    """The parsed tabs, cached for CACHE_TTL. Never raises: a failure reads as empty."""
    now = time.time()
    with _LOCK:
        if (not force and _CACHE["value"] is not None and _CACHE["key"] == sheet_id
                and now - _CACHE["at"] < CACHE_TTL):
            return _CACHE["value"]
    error = None
    try:
        svc = svc_factory()
        if titles is None:
            meta = svc.spreadsheets().get(spreadsheetId=sheet_id).execute()
            titles = [s["properties"]["title"] for s in meta.get("sheets", [])]
        value = load(read(svc, sheet_id, titles))
    except Exception as exc:  # the rest of the dashboard must still load
        value, error = {"ok": False, "about": []}, type(exc).__name__
    with _LOCK:
        _CACHE.update(at=now, value=value, key=sheet_id, error=error)
        _VIEWS.clear()
    return value


def fetch(svc_factory, sheet_id, titles=None, force=False, **params):
    """The page's insights for the given range and filters (see view), from the cached tabs."""
    st = store(svc_factory, sheet_id, titles, force)
    camps = params.pop("camps", None)
    fx = params.pop("fx", None)
    key = (id(st), tuple(sorted(params.items())), params.get("camps_key"))
    params.pop("camps_key", None)
    with _LOCK:
        hit = _VIEWS.get(key)
        if hit is not None:
            _VIEWS.move_to_end(key)
            return hit
    value = view(st, camps=camps, fx=fx, **params)
    if _CACHE.get("error"):
        value["error"] = _CACHE["error"]
    with _LOCK:
        _VIEWS[key] = value
        while len(_VIEWS) > VIEWS_KEPT:
            _VIEWS.popitem(last=False)
    return value


def reset():
    with _LOCK:
        _CACHE.update(at=0.0, value=None, key=None, error=None)
        _VIEWS.clear()
