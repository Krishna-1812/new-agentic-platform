"""Google Ads AI review: one account, every campaign, judged against its brief.

A review runs in four steps, each saved as a stage so the page can show where it is:

  1. pack     Everything the dashboard knows about the account, per campaign, for
              the last 30 days against the 30 before (tracker/google_ads_insights.py
              views, so every figure is the one the dashboard shows): performance
              and impression share, budgets and month-to-date pacing, bidding,
              search terms, keywords and Quality Score, ads, devices, audiences,
              conversions by action and their setup, locations, hours, landing
              pages, change history, Google's recommendations. Derived figures
              (CTR, CPA, ROAS, changes, shares) are computed here, never left to
              the model.
  2. targets  Claude reads the brief and lists every measurable target and
              requirement in it, each with the sentence it comes from.
  3. checks   Each target is measured against the pack in code: spend and pace
              against budget, ROAS, CPA, conversions, rates, impression share,
              spend inside and outside the target locations, device and campaign
              mix. What code cannot measure is left to the analysis, marked so.
  4. analysis Claude (the most capable model, thinking at high effort) writes the
              review: a scorecard against the brief, where the account does not
              follow it, what is working and what is not, prioritised actions and
              a verdict per campaign, as JSON in a fixed shape.

The SDK is imported inside the calls, so the rest of the app and the tests never
need it.
"""

import datetime as _dt
import io
import json
import logging
import os
import re

log = logging.getLogger(__name__)

MODEL = "claude-opus-5-5"
FALLBACK_BETA = "server-side-fallback-2026-07-01"
PRICE = {"input": 4.00, "output": 20.00}   # USD per million tokens, Claude Opus 5.5
PERIOD_DAYS = 30
BRIEF_MAX_CHARS = 120_000

# How much of each list goes into the pack: the costliest items, which is where a
# review's attention belongs; totals always cover everything.
TOP_TERMS, TOP_WASTE, TOP_CONVERTING = 25, 15, 15
TOP_KEYWORDS = 30
TOP_LOCATIONS, TOP_LANDING, TOP_CHANGES, TOP_ADS = 30, 15, 40, 12
DETAILED_CAMPAIGNS = 30


class ReviewError(Exception):
    def __init__(self, message, kind="api"):
        super().__init__(message)
        self.kind = kind


# ── Brief files ──────────────────────────────────────────────────────────────
BRIEF_TEMPLATE = """ACCOUNT BRIEF: <account name>

Business and offer
- What the business sells, to whom, and what a good customer is worth:

Objectives (in order of importance)
1.
2.

Targets (numbers the account is judged on)
- Monthly budget: <amount and currency>, split by campaign if agreed:
- Target ROAS or ROI: <e.g. 400%>   or   Target cost per conversion (CPA): <amount>
- Conversions per month:
- Other KPIs (CTR, impression share, cost per lead by city…):

Targeting
- Locations to target (cities, radius, countries) and any to exclude:
- Audience, languages, devices, ad schedule:
- Campaign types in scope (Search, Performance Max, Demand Gen, Video, Shopping…):
- Brand terms, competitor terms, negative keyword themes:

Conversions
- Which conversion actions count (primary) and their values:

Account manager
- What the account manager is responsible for and how often (e.g. search term review weekly,
  bid and budget changes, new ad copy monthly, reporting):

Current context
- Recent changes, seasonality, promotions, landing pages, known issues:
"""


def brief_text_from_file(filename, data):
    """The text of an uploaded brief (.txt, .md, .docx or .pdf)."""
    name = (filename or "").lower()
    if name.endswith((".txt", ".md", ".markdown", ".csv")):
        for enc in ("utf-8-sig", "utf-16", "latin-1"):
            try:
                return data.decode(enc)
            except UnicodeDecodeError:
                continue
    if name.endswith(".docx"):
        import docx
        doc = docx.Document(io.BytesIO(data))
        parts = [p.text for p in doc.paragraphs]
        for t in doc.tables:
            for row in t.rows:
                parts.append(" | ".join(c.text.strip() for c in row.cells))
        return "\n".join(parts)
    if name.endswith(".pdf"):
        import pdfplumber
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            return "\n\n".join((p.extract_text() or "") for p in pdf.pages)
    raise ReviewError("Upload a .txt, .md, .docx or .pdf file.", kind="input")


def clean_brief(text):
    text = (text or "").replace("\r\n", "\n").strip()
    if len(text) > BRIEF_MAX_CHARS:
        raise ReviewError("The brief is too long (%d characters; the limit is %d)." % (len(text), BRIEF_MAX_CHARS),
                          kind="input")
    return text


# ── Numbers ──────────────────────────────────────────────────────────────────
def _r(v, n=2):
    return None if v is None else round(float(v), n)


def _div(a, b):
    return (a / b) if b else None


def _perf(x):
    """Totals and the rates derived from them."""
    cost, clicks, impr = x.get("cost") or 0.0, x.get("clicks") or 0.0, x.get("impr") or 0.0
    conv, value = x.get("conv") or 0.0, x.get("value") or 0.0
    return {"cost": _r(cost), "impr": int(impr), "clicks": int(clicks), "conv": _r(conv), "value": _r(value),
            "ctr_pct": _r(_div(clicks, impr) and 100 * clicks / impr),
            "cpc": _r(_div(cost, clicks)), "conv_rate_pct": _r(_div(conv, clicks) and 100 * conv / clicks),
            "cpa": _r(_div(cost, conv)), "roas_pct": _r(_div(value, cost) and 100 * value / cost, 1)}


def _change(now, before):
    """% change of each total, where the earlier period had any."""
    out = {}
    for k in ("cost", "clicks", "conv", "value", "cpa", "roas_pct", "ctr_pct", "cpc"):
        a, b = now.get(k), before.get(k)
        if a is not None and b:
            out[k] = _r(100 * (a - b) / b, 1)
    return out


def _add(into, x, keys=("cost", "clicks", "impr", "conv", "value")):
    for k in keys:
        into[k] = (into.get(k) or 0.0) + (x.get(k) or 0.0)
    return into


def _pct(v):
    return None if v is None else _r(100 * v, 1)


def _day(s):
    return _dt.date.fromisoformat(s)


# ── 1. The pack ──────────────────────────────────────────────────────────────
def periods(st, g, account, camps, fx):
    """(current, previous, end): the last PERIOD_DAYS days the account has figures for, and the
    PERIOD_DAYS before them; None when the export has no daily figures for it."""
    v = g.view(st, None, None, account=account, camps=camps, fx=fx)
    cov = (v.get("meta", {}).get("is") or {}).get("cover") or (v.get("meta", {}).get("devices") or {}).get("cover")
    if not cov:
        return None
    end = _day(cov[1])
    cur = ((end - _dt.timedelta(days=PERIOD_DAYS - 1)).isoformat(), end.isoformat())
    prev = ((end - _dt.timedelta(days=2 * PERIOD_DAYS - 1)).isoformat(),
            (end - _dt.timedelta(days=PERIOD_DAYS)).isoformat())
    if prev[0] < cov[0]:
        prev = None if prev[1] < cov[0] else (cov[0], prev[1])
    return cur, prev, v


def build_pack(g, st, account, rows, fx, spend=None, camps=None):
    """Everything about one account the review reads, as a JSON-ready dict."""
    camps = camps if camps is not None else _campaigns(rows)
    fx, spend, own = _own_money(g, rows, account, fx, spend)
    got = periods(st, g, account, camps, fx)
    if not got:
        raise ReviewError("The insights export has no daily figures for %s yet. Run the Google Ads "
                          "insights script, then try again." % account, kind="data")
    cur, prev, whole = got
    now = g.view(st, cur[0], cur[1], account=account, camps=camps, fx=fx, spend=spend)
    before = g.view(st, prev[0], prev[1], account=account, camps=camps, fx=fx) if prev else None
    currency = (now.get("fx") or {}).get("to") or _report_currency(rows)
    native = sorted({r.get("currency_native") for r in rows if r.get("account") == account and r.get("currency_native")})

    # Campaigns: performance and impression share, both periods.
    def by_campaign(view):
        return {x["campaign"]: x for x in (view or {}).get("is", [])}
    c_now, c_before = by_campaign(now), by_campaign(before)
    budget_of = {c["campaign"]: c for c in now.get("budget_campaigns", [])}
    score_of = {c["campaign"]: c for c in now.get("health", {}).get("campaigns", [])}
    total_now = {}
    for x in c_now.values():
        _add(total_now, x)
    total_before = {}
    for x in c_before.values():
        _add(total_before, x)

    names = sorted(set(c_now) | set(budget_of), key=lambda n: -((c_now.get(n) or {}).get("cost") or 0))
    campaigns = []
    for name in names:
        x, b, bc = c_now.get(name) or {}, c_before.get(name) or {}, budget_of.get(name) or {}
        p_now, p_before = _perf(x), _perf(b)
        c = {"campaign": name,
             "type": x.get("channel") or bc.get("channel") or "",
             "subtype": x.get("sub") or "",
             "status": x.get("status") or bc.get("status") or "",
             "bidding": x.get("bid") or bc.get("bid") or "",
             "target_cpa": _r(bc.get("tcpa")), "target_roas_pct": _pct(bc.get("troas")),
             "daily_budget": _r(bc.get("daily")), "budget_name": bc.get("budget_name") or "",
             "shared_budget": bool(bc.get("shared")),
             "spend_this_month": _r(bc.get("mtd")), "conv_this_month": _r(bc.get("conv_mtd")),
             "optimization_score_pct": _pct((score_of.get(name) or {}).get("score")),
             "last_30_days": p_now, "previous_30_days": p_before if b else None,
             "change_pct": _change(p_now, p_before) if b else {},
             "share_of_account_spend_pct": _r(_div(p_now["cost"], total_now.get("cost")) and
                                              100 * p_now["cost"] / total_now["cost"], 1)}
        if x.get("is") is not None:
            c["impression_share"] = {
                "search_is_pct": _pct(x.get("is")), "lost_to_budget_pct": _pct(x.get("lb")),
                "lost_to_rank_pct": _pct(x.get("lr")), "top_pct": _pct(x.get("top")), "abs_top_pct": _pct(x.get("abs")),
                "approximate": bool(x.get("approx") or x.get("capped")),
                "previous_search_is_pct": _pct(b.get("is")) if b else None}
        campaigns.append(c)
    # Full detail (terms, keywords, ads, devices, audiences) for the campaigns that carry the spend; the
    # small ones keep their figures, which is all a review needs of them.
    in_camp, run = {}, 0.0
    for i, c in enumerate(campaigns):
        spent = c["last_30_days"]["cost"] or 0
        if i < DETAILED_CAMPAIGNS and (run < 0.98 * (total_now.get("cost") or 0) or spent > 0.01 * (total_now.get("cost") or 0)):
            in_camp[c["campaign"]] = c
        elif spent:
            c["detail"] = "Small share of spend: figures only."
        run += spent

    # Devices, audiences, conversions by action: into their campaign.
    for d in now.get("devices", []):
        c = in_camp.get(d["campaign"])
        if c is not None:
            c.setdefault("devices", []).append(dict(device=d["device"], **_perf(d)))
    for d in now.get("demographics", []):
        c = in_camp.get(d["campaign"])
        if c is not None and (d.get("cost") or d.get("impr")):
            c.setdefault("audience", []).append(dict(dimension=d["dim"], segment=d["label"], **_perf(d)))
    for d in now.get("conversions", []):
        c = in_camp.get(d["campaign"])
        if c is not None:
            c.setdefault("conversions_by_action", []).append(
                {"action": d["action"], "category": d.get("category"), "conv": _r(d.get("conv")),
                 "value": _r(d.get("value")), "all_conv": _r(d.get("all"))})

    # Search terms and keywords, per campaign: costliest, wasted and converting.
    cols = now["terms"].get("cols") or []
    terms = [dict(zip(cols, t)) for t in now["terms"].get("rows", [])]
    for name, c in in_camp.items():
        mine = [t for t in terms if t.get("campaign") == name]
        if not mine:
            continue
        row = lambda t: {"term": t["term"], "match": t.get("match"), "keyword": t.get("keyword"),
                         "status": t.get("status"), **_perf(t)}
        c["search_terms"] = {
            "costliest": [row(t) for t in sorted(mine, key=lambda t: -(t.get("cost") or 0))[:TOP_TERMS]],
            "spend_without_conversions": [row(t) for t in sorted((t for t in mine if not t.get("conv")),
                                                                 key=lambda t: -(t.get("cost") or 0))[:TOP_WASTE]],
            "most_conversions": [row(t) for t in sorted((t for t in mine if t.get("conv")),
                                                        key=lambda t: -(t.get("conv") or 0))[:TOP_CONVERTING]]}
    for name, c in in_camp.items():
        mine = [k for k in now["keywords"].get("rows", []) if k.get("campaign") == name]
        if not mine:
            continue
        c["keywords"] = [{"keyword": k["kw"], "match": k.get("match"), "ad_group": k.get("ad_group"),
                          "status": k.get("status"), "serving": k.get("serving"), "quality_score": k.get("qs"),
                          "expected_ctr": k.get("ctr"), "ad_relevance": k.get("relevance"),
                          "landing_page_experience": k.get("landing"), "max_cpc": _r(k.get("bid")),
                          "first_page_bid": _r(k.get("first_page")), "search_is_pct": _pct(k.get("is")),
                          **_perf(k)}
                         for k in sorted(mine, key=lambda k: -(k.get("cost") or 0))[:TOP_KEYWORDS]]
        low = [k for k in mine if k.get("qs") and k["qs"] <= 4]
        c["keywords_summary"] = {"keywords": len(mine),
                                 "quality_score_4_or_less": len(low),
                                 "spend_on_quality_score_4_or_less": _r(sum(k.get("cost") or 0 for k in low))}

    # Ads: their state, and what Google flags about them.
    for name, c in in_camp.items():
        mine = [a for a in now["ads"].get("rows", []) if a.get("campaign") == name]
        if not mine:
            continue
        c["ads"] = [{"kind": a.get("kind"), "ad_group": a.get("ad_group"), "status": a.get("status"),
                     "serving": a.get("primary_status"), "approval": a.get("approval"), "strength": a.get("strength"),
                     "headlines": len(a.get("heads") or []), "descriptions": len(a.get("descs") or []),
                     "final_url": a.get("url"), "google_flags": [f[1] for f in (a.get("flags") or [])],
                     **_perf(a)}
                    for a in sorted(mine, key=lambda a: -(a.get("cost") or 0))[:TOP_ADS]]
        c["ads_summary"] = {"live_ads": len(mine),
                            "disapproved_or_limited": sum(1 for a in mine if a.get("approval") not in (None, "", "APPROVED")),
                            "poor_or_average_strength": sum(1 for a in mine if a.get("strength") in ("POOR", "AVERAGE"))}

    # Changes and recommendations, per campaign and for the account.
    changes = now["changes"].get("rows", [])
    for c in campaigns:
        mine = [ch for ch in changes if ch.get("campaign") == c["campaign"]]
        if mine:
            c["changes_in_period"] = len(mine)
    recs = now["recs"].get("rows", [])

    # Account-level reports.
    hours = {}
    days = {}
    for h in now.get("hours", []):
        _add(hours.setdefault(h["hour"], {}), h)
        _add(days.setdefault(h["day"], {}), h)
    week = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
    loc_rows = now["locations"].get("rows", [])
    loc_total = now["locations"]["totals"].get("__all__") or {}
    pack = {
        "account": account,
        "currency": currency,
        "billed_in": native,
        "exported_at": now.get("as_of"),
        "period": {"last_30_days": list(cur), "previous_30_days": list(prev) if prev else None,
                   "note": "Each account's days end on its own yesterday in its own time zone."},
        "account_totals": {"last_30_days": _perf(total_now),
                           "previous_30_days": _perf(total_before) if before else None,
                           "change_pct": _change(_perf(total_now), _perf(total_before)) if before else {}},
        "budgets_this_month": [{"budget": b["name"], "campaigns": b["campaigns"], "daily_budget": _r(b.get("daily")),
                                "month_budget": _r(b.get("month_budget")), "spent_so_far": _r(b.get("mtd")),
                                "expected_by_now": _r(b.get("expected")), "projected_month": _r(b.get("projected")),
                                "pace_pct": _pct(b.get("pace")), "verdict": b.get("verdict"),
                                "shared": bool(b.get("shared"))}
                               for b in now.get("budgets", [])],
        "limited_by_budget_last_7_days": sorted(k.split("\u0001", 1)[1] for k in (now.get("budget_limited") or {})
                                                if k.startswith(account + "\u0001")),
        "campaigns": campaigns,
        "hours_of_day": [dict(hour=hr, **_perf(v)) for hr, v in sorted(hours.items())],
        "days_of_week": [dict(day=week[d], **_perf(v)) for d, v in sorted(days.items())],
        "time_zone": sorted({h.get("tz") for h in now.get("hours", []) if h.get("tz")}),
        "locations": {"total": _perf(loc_total) if loc_total else None,
                      "costliest": [{"type": "people in the place" if l["type"] == "LOCATION_OF_PRESENCE"
                                     else "people interested in the place",
                                     "country": l.get("country"), "region": l.get("region"), "city": l.get("city"),
                                     **_perf(l)}
                                    for l in sorted((l for l in loc_rows if not l.get("rest")),
                                                    key=lambda l: -(l.get("cost") or 0))[:TOP_LOCATIONS]]},
        "landing_pages": [{"url": l["url"], "mobile_speed_score": l.get("speed"),
                           "mobile_friendly_clicks_pct": _pct(l.get("mobile")), **_perf(l)}
                          for l in sorted((l for l in now["landing"].get("rows", []) if not l.get("rest")),
                                          key=lambda l: -(l.get("cost") or 0))[:TOP_LANDING]],
        "conversion_setup": [{"action": a["name"], "category": a.get("category"), "status": a.get("status"),
                              "primary": a.get("primary"), "counting": a.get("counting"),
                              "attribution": a.get("model"), "default_value": _r(a.get("default_value")),
                              "always_default_value": a.get("always_default"),
                              "click_window_days": a.get("click_window"),
                              "conv_last_30_days": _r(a.get("conv")), "value_last_30_days": _r(a.get("value")),
                              "google_flags": [f[1] for f in (a.get("flags") or [])]}
                             for a in now.get("actions", [])],
        "change_history": {"changes_in_period": len(changes),
                           "by_kind": _count(ch.get("kind") for ch in changes),
                           "by_person": _count(ch.get("by") for ch in changes),
                           "latest": [{"when": ch.get("at"), "by": ch.get("by"), "what": ch.get("kind"),
                                       "campaign": ch.get("campaign"), "ad_group": ch.get("ad_group"),
                                       "operation": ch.get("op"), "changed": [list(d) for d in (ch.get("diffs") or [])][:6]}
                                      for ch in changes[:TOP_CHANGES]]},
        "google_recommendations": [{"type": r.get("label") or r.get("type"), "campaign": r.get("campaign"),
                                    "detail": r.get("detail"), "estimated_gain": {k: _r(v) for k, v in (r.get("gain") or {}).items()}}
                                   for r in recs],
        "optimization_score_pct": _pct((now.get("health") or {}).get("overall")),
    }
    pack["data_notes"] = _data_notes(now, cur, currency, own)
    return pack


def _count(values):
    out = {}
    for v in values:
        if v:
            out[v] = out.get(v, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def _own_money(g, rows, account, fx, spend):
    """(fx, spend, True) in the currency the account is billed in ("Cost", "Currency code"), as Google
    Ads shows it, nothing converted; else the report's converted ones, unchanged, and False (an account
    whose rows carry no currency code, or more than one)."""
    mine = [r for r in rows if r.get("account") == account]
    nat = {r.get("currency_native") or "" for r in mine}
    if len(nat) != 1 or "" in nat:
        return fx, spend, False
    own = [dict(r, cost=r.get("cost_native") or 0.0, currency=r["currency_native"]) for r in mine]
    return g.FX(own), (g.Spend(own) if spend is not None else None), True


def _data_notes(now, cur, currency, own=False):
    notes = ["Money is in %s, the currency the account is billed in, as Google Ads shows it." % currency if own else
             "Money is in %s. Accounts billed in another currency are converted at the same daily exchange "
             "rates as the campaign report." % currency,
             "Conversions for the last few days can still rise as late conversions are recorded.",
             "Quality Score, ad strength and approval, optimization score and recommendations are current, not "
             "for the period."]
    for key, what in (("terms", "search terms"), ("locations", "locations"), ("landing", "landing pages"),
                      ("ads", "ads")):
        c = (now.get("coverage") or {}).get(key)
        if c and c["spent"] and c["shown"] < c["spent"] * 0.995:
            notes.append("The %s report covers %s of %s spend (%d%%); Google's own report leaves the rest out, so "
                         "totals there are lower than campaign spend." %
                         (what, _fmt(c["shown"]), _fmt(c["spent"]), round(100 * c["shown"] / c["spent"])))
    return notes


def _fmt(v):
    return "{:,.0f}".format(v or 0)


def _campaigns(rows):
    out = {}
    for r in rows:
        x = out.setdefault((r.get("account") or "", r.get("campaign") or ""), {"types": set(), "states": set()})
        x["types"].add(r.get("type") or "")
        x["states"].add(r.get("state") or "")
    return out


def _report_currency(rows):
    by = _count(r.get("currency") for r in rows)
    return next(iter(by), "")


# ── 2. Targets from the brief ────────────────────────────────────────────────
METRICS = ("monthly_spend", "daily_spend", "roas", "cpa", "conversions_per_month", "conversion_rate", "ctr", "cpc",
           "impression_share", "locations_target", "locations_exclude", "devices", "ad_schedule", "campaign_types",
           "other")
COMPARISONS = ("at_least", "at_most", "about", "only", "exclude", "none")

TARGETS_SCHEMA = {
    "type": "object",
    "properties": {
        "business": {"type": "string"},
        "objectives": {"type": "array", "items": {"type": "string"}},
        "targets": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "metric": {"type": "string", "enum": list(METRICS)},
                "scope": {"type": "string"},
                "comparison": {"type": "string", "enum": list(COMPARISONS)},
                "value": {"type": "number"},
                "currency": {"type": "string"},
                "items": {"type": "array", "items": {"type": "string"}},
                "description": {"type": "string"},
                "quote": {"type": "string"}},
            "required": ["metric", "scope", "comparison", "value", "currency", "items", "description", "quote"],
            "additionalProperties": False}},
        "account_manager_tasks": {"type": "array", "items": {
            "type": "object",
            "properties": {"task": {"type": "string"}, "cadence": {"type": "string"}, "quote": {"type": "string"}},
            "required": ["task", "cadence", "quote"], "additionalProperties": False}},
        "brand_terms": {"type": "array", "items": {"type": "string"}},
        "negative_themes": {"type": "array", "items": {"type": "string"}},
        "missing": {"type": "array", "items": {"type": "string"}}},
    "required": ["business", "objectives", "targets", "account_manager_tasks", "brand_terms", "negative_themes",
                 "missing"],
    "additionalProperties": False}

TARGETS_SYSTEM = """You read the agency's notes on one Google Ads account (its brief: the business, objectives, \
targets, targeting and the account manager's responsibilities) and list what they ask of the account, so the account \
can be checked against it.

The notes are often a running document, updated over time, and may include dated entries and notes shared by all \
accounts. Where two statements conflict, the most recent one is the current requirement (use dates where given, \
otherwise the later position in the notes). A shared note applies unless the account's own notes say otherwise.

List every measurable target and every targeting or process requirement the brief states, each with the exact \
sentence it comes from as the quote. Use only what the brief says: never infer a target it does not state, and \
never fill in a typical value.

For each target:
- metric: the closest listed metric. monthly_spend and daily_spend are budgets; roas is return on ad spend as a \
percentage (ROAS 4x or 4:1 is 400; an ROI target counts as roas only if the brief defines ROI as revenue over ad \
spend, otherwise use other); cpa is cost per conversion, lead or acquisition; conversion_rate, ctr and \
impression_share are percentages (3% is 3); locations_target and locations_exclude list places in items; devices, \
ad_schedule and campaign_types describe the requirement in items and description; anything else is other.
- scope: "account", or the campaign name, campaign group or product line the brief applies it to.
- comparison: at_least, at_most, about (a target to hit), only (only these), exclude, or none.
- value: the number (0 when the target has none); currency: the currency of a money value as a 3-letter code if \
the brief says or clearly implies it, else "".
- description: one plain line saying what is required.

account_manager_tasks: what the brief says the account manager does or must do, with how often.
missing: what a review of this account would need that the brief does not give (for example no target CPA or \
ROAS, no monthly budget, no locations). Keep each entry short."""


def extract_targets(brief, account, client=None):
    """What the brief asks of the account, as TARGETS_SCHEMA; plus the call's usage."""
    if not brief.strip():
        return {"business": "", "objectives": [], "targets": [], "account_manager_tasks": [], "brand_terms": [],
                "negative_themes": [], "missing": ["There are no notes on this account yet: the context Google Doc has no part for it."]}, {}
    text, usage = _call(client, TARGETS_SYSTEM,
                        "Account: %s\n\n<brief>\n%s\n</brief>" % (account, brief),
                        TARGETS_SCHEMA, effort="medium", max_tokens=32000)
    return json.loads(text), usage


# ── 3. Checks the code can make ──────────────────────────────────────────────
def _matches(name, scope):
    s = (scope or "").strip().lower()
    return not s or s in ("account", "all", "all campaigns", "whole account") or s in (name or "").lower()


def _judge(actual, target, comparison):
    """met / at_risk (within 10% on the wrong side) / off_track, for a numeric target."""
    if actual is None or not target:
        return "cannot_verify"
    if comparison == "at_least":
        return "met" if actual >= target else ("at_risk" if actual >= 0.9 * target else "off_track")
    if comparison == "at_most":
        return "met" if actual <= target else ("at_risk" if actual <= 1.1 * target else "off_track")
    gap = abs(actual - target) / target
    return "met" if gap <= 0.1 else ("at_risk" if gap <= 0.2 else "off_track")


def compute_checks(targets, pack, fx=None, account=None):
    """Each target measured against the pack where code can; the rest marked for the analysis."""
    out = []
    cur = pack["currency"]
    camps = pack["campaigns"]
    for t in targets.get("targets", []):
        m, scope, comp, value = t["metric"], t.get("scope") or "account", t.get("comparison"), t.get("value") or 0
        mine = [c for c in camps if _matches(c["campaign"], scope)]
        check = {"metric": m, "scope": scope, "target": t.get("description") or "", "quote": t.get("quote") or "",
                 "status": "cannot_verify", "actual": "", "detail": ""}
        if scope.lower() not in ("account", "all", "", "all campaigns", "whole account") and not mine:
            check["detail"] = "No campaign name contains %r, so this was left to the analysis." % scope
            out.append(check)
            continue
        # Money targets in another currency: Google's own latest rate for the account.
        rate, note = 1.0, ""
        tc = (t.get("currency") or "").upper()
        if tc and tc != cur and m in ("monthly_spend", "daily_spend", "cpa", "cpc"):
            r = fx.latest(account) if fx is not None and account and (fx.native.get(account) == tc) else None
            # The pack in the account's own currency, the target in the report's converted one (INR).
            if not r and fx is not None and account and tc == fx.to and fx.native.get(account) == cur:
                r = fx.latest(account)
                r = 1.0 / r if r else None
            if not r:
                check["detail"] = "The target is in %s and there is no Google rate to %s for it." % (tc, cur)
                out.append(check)
                continue
            rate, note = r, " (target %s %s converted at Google's latest rate, %.4f)" % (tc, _fmt(value), r)
        tot = {}
        for c in mine:
            _add(tot, c["last_30_days"])
        p = _perf(tot)
        target = value * rate
        if m == "monthly_spend":
            month = [b for b in pack["budgets_this_month"] if any(_matches(n, scope) for n in b["campaigns"])]
            projected = sum(b["projected_month"] or 0 for b in month)
            check.update(actual="%s %s projected this month (%s spent so far); %s in the last 30 days" %
                         (cur, _fmt(projected), _fmt(sum(b["spent_so_far"] or 0 for b in month)), _fmt(p["cost"])),
                         status=_judge(projected or p["cost"], target, comp or "about"))
        elif m == "daily_spend":
            daily = p["cost"] / PERIOD_DAYS
            budgets = sum(c["daily_budget"] or 0 for c in mine if not c["shared_budget"])
            check.update(actual="%s %s a day on average over 30 days; daily budgets set: %s" %
                         (cur, _fmt(daily), _fmt(budgets)), status=_judge(daily, target, comp or "about"))
        elif m == "roas":
            if p["value"]:
                check.update(actual="%s%% (value %s on cost %s)" % (p["roas_pct"], _fmt(p["value"]), _fmt(p["cost"])),
                             status=_judge(p["roas_pct"], target, comp or "at_least"))
            else:
                check.update(actual="no conversion value recorded on %s %s of spend" % (cur, _fmt(p["cost"])),
                             detail="ROAS cannot be measured until conversions carry values.")
        elif m == "cpa":
            check.update(actual="%s %s (%s conversions on %s)" % (cur, _fmt(p["cpa"]), p["conv"], _fmt(p["cost"]))
                         if p["cpa"] is not None else "no conversions on %s %s" % (cur, _fmt(p["cost"])),
                         status=_judge(p["cpa"], target, comp or "at_most") if p["cpa"] is not None else
                         ("off_track" if p["cost"] else "cannot_verify"))
        elif m == "conversions_per_month":
            check.update(actual="%s conversions in the last 30 days" % p["conv"],
                         status=_judge(p["conv"], target, comp or "at_least"))
        elif m in ("conversion_rate", "ctr", "cpc"):
            key = {"conversion_rate": "conv_rate_pct", "ctr": "ctr_pct", "cpc": "cpc"}[m]
            check.update(actual="%s%s" % (p[key], "" if m == "cpc" else "%"),
                         status=_judge(p[key], target, comp or ("at_most" if m == "cpc" else "at_least")))
        elif m == "impression_share":
            eligible = [c for c in mine if c.get("impression_share", {}).get("search_is_pct") is not None]
            if eligible:
                w = sum(c["last_30_days"]["impr"] / (c["impression_share"]["search_is_pct"] / 100)
                        for c in eligible if c["impression_share"]["search_is_pct"])
                share = _r(100 * sum(c["last_30_days"]["impr"] for c in eligible) / w, 1) if w else None
                check.update(actual="%s%% search impression share" % share,
                             status=_judge(share, target, comp or "at_least"))
        elif m in ("locations_target", "locations_exclude"):
            check.update(_location_check(t, pack, m))
        elif m == "campaign_types":
            spent = {}
            for c in camps:
                spent[c["type"]] = spent.get(c["type"], 0) + (c["last_30_days"]["cost"] or 0)
            check.update(actual="spend by campaign type: " + ", ".join("%s %s" % (k or "?", _fmt(v))
                                                                     for k, v in sorted(spent.items(), key=lambda kv: -kv[1])),
                         status="cannot_verify", detail="Compared with the brief by the analysis.")
        elif m == "devices":
            dev = {}
            for c in mine:
                for d in c.get("devices", []):
                    dev[d["device"]] = dev.get(d["device"], 0) + (d["cost"] or 0)
            total = sum(dev.values())
            check.update(actual=", ".join("%s %d%%" % (k, round(100 * v / total)) for k, v in
                                          sorted(dev.items(), key=lambda kv: -kv[1])) if total else "",
                         detail="Share of spend by device; compared with the brief by the analysis.")
        else:
            check["detail"] = "Left to the analysis."
        check["actual"] += note
        out.append(check)
    return out


def _location_check(t, pack, metric):
    """Spend in (or, for exclusions, in any of) the brief's places, by the geographic report."""
    places = [p.strip().lower() for p in t.get("items") or [] if p and p.strip()]
    locs = pack["locations"]["costliest"]
    total = (pack["locations"].get("total") or {}).get("cost") or 0
    if not places or not total:
        return {"status": "cannot_verify", "detail": "No places named, or no location figures."}

    def hit(l):
        names = [(l.get(k) or "").lower() for k in ("city", "region", "country")]
        return any(p == n or (len(p) > 3 and p in n) for p in places for n in names if n)
    inside = sum(l["cost"] or 0 for l in locs if l["type"] == "people in the place" and hit(l))
    listed = sum(l["cost"] or 0 for l in locs if l["type"] == "people in the place")
    outside = [l for l in locs if l["type"] == "people in the place" and not hit(l)]
    share = _r(100 * inside / total, 1)
    top_out = ", ".join("%s %s" % (l.get("city") or l.get("region") or l.get("country"), _fmt(l["cost"]))
                        for l in outside[:5])
    if metric == "locations_target":
        status = "met" if share >= 95 else ("at_risk" if share >= 85 else "off_track")
        return {"actual": "%s%% of spend from people in the target places; largest spend elsewhere: %s" %
                          (share, top_out or "none"),
                "status": status if listed >= 0.8 * total else "cannot_verify",
                "detail": "From the costliest %d locations in Google's geographic report." % len(locs)}
    status = "met" if share < 1 else ("at_risk" if share < 5 else "off_track")
    return {"actual": "%s%% of spend from people in excluded places" % share, "status": status,
            "detail": "From the costliest %d locations in Google's geographic report." % len(locs)}


# ── 4. The review ────────────────────────────────────────────────────────────
_STR = {"type": "string"}
_STRS = {"type": "array", "items": _STR}


def _obj(props):
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


REVIEW_SCHEMA = _obj({
    "headline": _STR,
    "overall": {"type": "string", "enum": ["on_track", "needs_attention", "off_track"]},
    "scorecard": {"type": "array", "items": _obj({
        "objective": _STR, "target": _STR, "actual": _STR,
        "status": {"type": "string", "enum": ["met", "at_risk", "off_track", "cannot_verify"]},
        "evidence": _STR})},
    "brief_compliance": {"type": "array", "items": _obj({
        "requirement": _STR,
        "status": {"type": "string", "enum": ["followed", "partly", "not_followed", "cannot_verify"]},
        "evidence": _STR, "action": _STR})},
    "working": {"type": "array", "items": _obj({"title": _STR, "evidence": _STR, "where": _STR})},
    "not_working": {"type": "array", "items": _obj({"title": _STR, "evidence": _STR, "impact": _STR, "where": _STR})},
    "actions": {"type": "array", "items": _obj({
        "priority": {"type": "string", "enum": ["P1", "P2", "P3"]},
        "title": _STR, "what_to_do": _STR, "why": _STR, "expected_impact": _STR, "where": _STR,
        "effort": {"type": "string", "enum": ["low", "medium", "high"]}})},
    "campaigns": {"type": "array", "items": _obj({
        "campaign": _STR,
        "verdict": {"type": "string", "enum": ["scale", "keep", "fix", "restructure", "pause", "watch"]},
        "summary": _STR, "issues": _STRS, "opportunities": _STRS})},
    "brief_gaps": _STRS,
    "data_caveats": _STRS,
    "follow_up": _obj({
        "summary": _STR,
        "earlier_actions": {"type": "array", "items": _obj({
            "action": _STR, "status": {"type": "string", "enum": ["done", "partly", "not_done", "cannot_verify"]},
            "evidence": _STR})}})})

REVIEW_SYSTEM = """You are the senior paid-search strategist at a performance marketing agency. You review one \
Google Ads account for the agency's leadership and its account manager, and they will act on what you write.

You are given:
- the account brief: the agency's running notes on this account (the business, objectives, targets, targeting, \
what the account manager is meant to do, and updates over time). Where notes conflict, the most recent is current; \
use older entries as history, for example to judge whether something agreed was done;
- the targets extracted from it, each with the sentence it came from;
- checks the system has already measured against those targets (figures computed from the account data; trust them);
- the account's data pack: every campaign for the last 30 days against the 30 before, month-to-date budgets and \
pacing, bidding and targets, impression share, search terms, keywords and Quality Score, ads, devices, age and \
gender, conversions by action and their setup, locations, hours, landing pages, change history and Google's \
recommendations;
- sometimes, the account's earlier work (earlier_work): the team's earlier AI reviews of this account with their \
verdicts and actions, the changes Page Watch saw on the client's pages, SEO and agent runs, and the videos made. \
It is history, not data for the last 30 days: never quote a figure from it as a current one.

How to review:
- The brief is the yardstick. Check the account against every target and requirement in it: budget and pacing, \
efficiency (ROAS, CPA), volume, locations, audiences, schedule, campaign mix, conversion setup, and the account \
manager's agreed tasks (use the change history to judge whether they are being done). Where the account does not \
follow the brief, say so plainly, with the evidence. Where the brief is silent on something the review needs, list \
it as a brief gap; never invent a target.
- Go through every campaign with spend, and judge it on its own numbers and against its role in the brief.
- Every point must be specific to this account and backed by figures from the pack, quoted as given: name the \
campaign, ad group, keyword, search term, location or page. Do not recompute figures the pack gives, and do not \
state any figure that is not in it.
- Only what matters. Rank by money at stake and by the brief's objectives. Leave out generic best practice, \
anything the data does not support, and anything already done (check the change history before recommending a \
change that was just made).
- Be careful with small numbers: a few clicks or conversions are a signal, not a conclusion; say when a sample is \
too small. Compare periods only where both have volume.
- Know the data's limits (data_notes): Google withholds rare search terms, recent conversions can still arrive, \
some figures are current rather than for the period. A limit of the data is not a fault of the account; list \
limits that affect your conclusions as data caveats.
- Actions say exactly what to change, where, and to what, with the expected effect, in priority order: P1 for \
what is costing money or breaking the brief now, P2 for clear gains, P3 for the rest. Nothing vague such as \
"optimise bids" or "improve ad copy" without saying which, how and why.
- Pick up where the last review left off. When earlier_work has an earlier AI review, go through its actions in \
follow_up: for each, say from the change history and the numbers whether it was done, partly done or not done \
(cannot_verify when the data cannot show it), and what changed since. Then build on it: do not repeat an action \
that was done, say plainly when one that was not done is still costing money, and point out what moved since that \
review. Use the rest of earlier_work where it bears on the account (a landing page that changed, an SEO finding \
about a page the ads send people to). With no earlier review, leave follow_up's summary empty and its list empty.
- Money is in the pack's currency; write amounts with it. Write plainly: short sentences, no jargon a client \
director would not know, no filler."""


def review_prompt(account, brief, targets, checks, pack, earlier=""):
    """What the review is asked; `earlier` (the account's earlier work, tracker/account_brief.py) goes after
    the data pack, when there is any."""
    body = ("Account: %s\n\n<brief>\n%s\n</brief>\n\n<targets_from_brief>\n%s\n</targets_from_brief>\n\n"
            "<measured_checks>\n%s\n</measured_checks>\n\n<data_pack>\n%s\n</data_pack>\n\n" %
            (account, brief.strip() or "(There are no notes on this account yet. Review the account on its own "
                                       "numbers, and say in brief_gaps what a brief needs to state.)",
             json.dumps(targets, ensure_ascii=False, separators=(",", ":")),
             json.dumps(checks, ensure_ascii=False, separators=(",", ":")),
             json.dumps(pack, ensure_ascii=False, separators=(",", ":"), default=str)))
    if (earlier or "").strip():
        body += "<earlier_work>\n" + earlier.strip() + "\n</earlier_work>\n\n"
    return body + "Write the review of " + account + "."


def analyse(account, brief, targets, checks, pack, client=None, earlier=""):
    text, usage = _call(client, REVIEW_SYSTEM, review_prompt(account, brief, targets, checks, pack, earlier),
                        REVIEW_SCHEMA, effort="high", max_tokens=64000)
    return json.loads(text), usage


# ── Calling Claude ───────────────────────────────────────────────────────────
def configured():
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _client():
    if not configured():
        raise ReviewError("Claude is not configured: set ANTHROPIC_API_KEY.", kind="config")
    from anthropic import Anthropic
    return Anthropic(timeout=900.0, max_retries=2)


def _call(client, system, user, schema, effort, max_tokens):
    """One streamed request for JSON in `schema`: (text, usage). Claude Opus 5.5 thinks adaptively (always on);
    a declined request is re-run server-side on the model Anthropic recommends for it."""
    client = client or _client()
    try:
        with client.beta.messages.stream(
                model=MODEL, max_tokens=max_tokens, system=system,
                messages=[{"role": "user", "content": user}],
                thinking={"type": "adaptive"},
                output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
                betas=[FALLBACK_BETA], fallbacks="default") as stream:
            msg = stream.get_final_message()
    except ReviewError:
        raise
    except Exception as exc:  # the SDK's error classes, without importing them at module load
        status = getattr(exc, "status_code", None)
        if status in (401, 403):
            raise ReviewError("Claude refused the API key (HTTP %s)." % status, kind="config")
        if status == 429:
            raise ReviewError("Claude's rate limit was reached. Try again in a few minutes.", kind="rate")
        if status and status >= 500 or type(exc).__name__ in ("APIConnectionError", "APITimeoutError"):
            raise ReviewError("Claude could not be reached (%s). Try again." % (status or type(exc).__name__))
        raise ReviewError("Claude rejected the request (%s: %s)." % (status or type(exc).__name__,
                                                                   str(getattr(exc, "message", exc))[:300]))
    usage = _usage(msg)
    if msg.stop_reason == "refusal":
        raise ReviewError("Claude declined to write this review.", kind="refusal")
    if msg.stop_reason == "max_tokens":
        raise ReviewError("Claude's answer was cut off before it finished.", kind="truncated")
    text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    try:
        json.loads(text)
    except ValueError:
        raise ReviewError("Claude's answer was not readable.", kind="unparsable")
    return text, usage


def _usage(msg):
    u = getattr(msg, "usage", None)
    out = {k: int(getattr(u, k, 0) or 0) for k in ("input_tokens", "output_tokens", "cache_read_input_tokens",
                                                   "cache_creation_input_tokens")} if u else {}
    out["model"] = getattr(msg, "model", MODEL)
    return out


def cost_usd(usages):
    """What the calls cost at Claude Opus 5.5's list price (a fallback model's price may differ)."""
    tin = sum((u.get("input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0) * 1.25 +
              (u.get("cache_read_input_tokens") or 0) * 0.1 for u in usages)
    tout = sum(u.get("output_tokens") or 0 for u in usages)
    return round(tin / 1e6 * PRICE["input"] + tout / 1e6 * PRICE["output"], 4)


# ── The whole run ────────────────────────────────────────────────────────────
def run_review(review_id, account, load, store, client=None, beat_every=30.0, context=None, memory=None):
    """Run one review end to end, saving each stage. `load()` returns (g, st, rows, fx, spend, camps).
    `context(account)`, when given, reads the account's part of the linked Google Doc
    (tracker/gads_ai_doc.context_for), or returns None when no doc is linked.
    `memory(account, review_id)`, when given, returns the client account's brief of earlier work
    (tracker/account_brief.build), or None when the Google Ads account belongs to no client account.
    A heartbeat is saved every `beat_every` seconds while it runs, so a review cut off by a restart is
    recognised as stopped (gads_ai_store._expire) rather than left running."""
    import threading
    done = threading.Event()

    def pulse():
        while not done.wait(beat_every):
            try:
                store.beat(review_id)
            except Exception:  # a missed beat is harmless
                pass
    threading.Thread(target=pulse, name="gads-ai-beat", daemon=True).start()
    try:
        _run(review_id, account, load, store, client, context, memory)
    finally:
        done.set()


def _brief_for(review_id, account, store, context):
    """(text, source): the account's context from the linked doc (snapshotted as a brief version, so the
    review keeps exactly what it read), else the notes saved on the page."""
    review = store.get_review(review_id) or {}
    saved = store.get_brief(brief_id=review["brief_id"]) if review.get("brief_id") else None
    ctx = context(account) if context else None
    if ctx is None:
        return (saved or {}).get("text") or "", {"kind": "page" if saved else "none"}
    source = {"kind": "doc", "title": ctx.get("title"), "url": ctx.get("url"), "where": ctx.get("where"),
              "shared": ctx.get("shared_where"), "found": ctx["found"]}
    text = ctx["text"]
    if not ctx["found"] and saved and saved.get("email") != DOC_AUTHOR:
        text = (text + "\n\n" if text else "") + saved["text"]
        source["page_notes"] = True
    if text:
        latest = store.get_brief(account)
        if not latest or latest.get("text") != text:
            latest = store.save_brief(account, text, DOC_AUTHOR, filename=("Google Doc: " + (ctx.get("title") or ""))[:200])
        store.update_review(review_id, brief_id=latest["id"])
    return text, source


DOC_AUTHOR = "google-doc"


def _earlier(review_id, account, memory):
    """The account's brief of earlier work, or None; a brief that cannot be built never stops the review."""
    if not memory:
        return None
    try:
        return memory(account, review_id)
    except Exception:
        log.exception("gads_ai review %s: earlier work unreadable", review_id)
        return None


def _run(review_id, account, load, store, client, context=None, memory=None):
    usages = []
    try:
        store.update_review(review_id, status="running", stage="context")
        try:
            brief, source = _brief_for(review_id, account, store, context)
        except Exception as exc:
            from tracker.gads_ai_doc import DocError
            if isinstance(exc, DocError):
                raise ReviewError(str(exc), kind="context")
            raise
        store.beat(review_id, "pack")
        g, st, rows, fx, spend, camps = load()
        pack = build_pack(g, st, account, rows, fx, spend, camps)
        store.update_review(review_id, period_from=pack["period"]["last_30_days"][0],
                            period_to=pack["period"]["last_30_days"][1],
                            stats={"campaigns": len(pack["campaigns"]), "pack_chars": len(json.dumps(pack, default=str))})
        store.beat(review_id, "targets")
        targets, u = extract_targets(brief, account, client)
        if u:
            usages.append(u)
        store.beat(review_id, "checks")
        checks = compute_checks(targets, pack, fx, account)
        store.beat(review_id, "analysis")
        earlier = _earlier(review_id, account, memory)
        report, u = analyse(account, brief, targets, checks, pack, client, (earlier or {}).get("text", ""))
        usages.append(u)
        report["targets"] = targets
        report["checks"] = checks
        report["period"] = pack["period"]
        report["currency"] = pack["currency"]
        report["has_brief"] = bool(brief)
        report["context"] = source
        if earlier and earlier.get("text"):
            from tracker import account_brief
            report["memory"] = account_brief.shown(earlier)
        store.update_review(review_id, status="complete", stage="done", report=report,
                            cost={"usd": cost_usd(usages), "calls": usages},
                            finished_at=_dt.datetime.now(_dt.timezone.utc))
    except ReviewError as exc:
        store.update_review(review_id, status="failed", error=str(exc), cost={"usd": cost_usd(usages), "calls": usages},
                            finished_at=_dt.datetime.now(_dt.timezone.utc))
    except Exception as exc:  # never leave a review running
        log.exception("gads_ai review %s failed", review_id)
        store.update_review(review_id, status="failed", error="The review failed (%s)." % type(exc).__name__,
                            cost={"usd": cost_usd(usages), "calls": usages},
                            finished_at=_dt.datetime.now(_dt.timezone.utc))
