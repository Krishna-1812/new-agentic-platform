"""Google Ads dashboard: the insights tabs (impression share, budgets, search terms).

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

Impression-share values stay as Google reports them: 0.0999 means "below
10%" and 0.9001 "above 90%" (Google Ads API field reference, v25). The page
shows those as <10% and >90%.

Nothing here calls Google Ads. When the tabs are missing (the script has not
run yet) every section is empty and the page leaves its panels hidden.
"""

import threading
import time

TABS = {
    "is": "Insights - Impression share",
    "weekly": "Insights - IS weekly",
    "budgets": "Insights - Budgets",
    "terms": "Insights - Search terms",
    "about": "Insights - About",
}
PREFIX = "Insights - "
CACHE_TTL = 900
TERMS_PER_ACCOUNT = 1500      # sent to the page, by spend
TERMS_ON_PAGE = 8000

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


def parse_about(values):
    out = []
    for row in values[1:] if values else []:
        if row and str(row[0]).strip():
            out.append([str(row[0]).strip(), str(row[1]).strip() if len(row) > 1 else ""])
    return out


def empty():
    return {"ok": False, "is": [], "weekly": [], "budgets": [], "budget_campaigns": [],
            "terms": {"cols": [], "rows": [], "totals": {}, "read": 0}, "about": [], "as_of": "",
            "currencies": []}


def build(raw):
    """The page's insights from {"is": values, "weekly": values, ...} (missing keys: empty)."""
    out = empty()
    out["is"] = parse_is(raw.get("is"))
    out["weekly"] = parse_weekly(raw.get("weekly"))
    out["budget_campaigns"], out["budgets"] = parse_budgets(raw.get("budgets"))
    out["terms"] = parse_terms(raw.get("terms"))
    out["about"] = parse_about(raw.get("about"))
    out["as_of"] = next((v for k, v in out["about"] if k == "Exported at"), "")
    curs = {}
    for r in out["is"] + out["budget_campaigns"]:
        if r.get("cur"):
            curs[r["cur"]] = curs.get(r["cur"], 0) + (r.get("cost") or r.get("mtd") or 0)
    out["currencies"] = sorted(curs, key=lambda c: -curs[c])
    out["ok"] = bool(out["is"] or out["budgets"] or out["terms"]["rows"])
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
