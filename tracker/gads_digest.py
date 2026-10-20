"""Google Ads daily Slack digest: one message per account, posted each morning.

Each message is laid out like the client report (the Looker Studio page the clients see): the month so
far (impressions, clicks, CTR, average CPC, cost, conversions, phone calls, cost per conversion,
conversion rate), the account's latest day in the campaign report (its own "yesterday", in its own time
zone) as a one-row table, both read from the Google Ads API (the sheet's figures, without phone calls,
when the API cannot be read), and the month's budget: the allocation from the Pacing Desk, what an even pace
would have spent by that day, what has been spent and the difference. What needs attention (the latest
day against the 7 days before it) follows when there is anything.
Every figure comes from the same sheet and the same conversions the dashboard uses, so Slack and
/dashboards/google-ads always agree.

Posting uses Slack's chat.postMessage with a bot token (https://api.slack.com/methods/chat.postMessage),
which needs the chat:write scope and the bot to be a member of the channel. Slack allows about one
message per second per channel (https://api.slack.com/apis/rate-limits#posting-messages), so messages
are spaced a second apart and a 429 is retried once after its Retry-After.
"""
import datetime as _dt
import re
import time
from urllib.parse import quote

import requests

from tracker import google_ads_insights as g

BASELINE_DAYS = 7
SPEND_SWING = 0.5        # spend up or down by half or more against the 7-day average
CPA_RISE = 0.3           # cost per conversion up by 30% or more
ROAS_DROP = 0.3          # return on ad spend down by 30% or more
MIN_BASE_CONV = 1.0      # "no conversions" only matters when the account usually gets one a day
LIMITED_SHARE = 0.1      # search impression share lost to budget, as the pacing panel uses
STALE_AFTER_DAYS = 2     # an account's latest day older than this (in India time) has stopped arriving
TOP_CAMPAIGNS = 3
SLACK_POST = "https://slack.com/api/chat.postMessage"
SPACING_SECONDS = 1.1
SYMBOLS = {"INR": "₹", "USD": "$", "GBP": "£", "EUR": "€", "AUD": "A$", "CAD": "C$",
           "SGD": "S$", "AED": "AED ", "SAR": "SAR "}


def today_ist():
    """Today in India, where the digest is read (UTC+05:30 all year; India has no daylight saving)."""
    return _dt.datetime.now(_dt.timezone(_dt.timedelta(hours=5, minutes=30))).date()


# ── Formatting ───────────────────────────────────────────────────────────────
def _indian(n):
    """12345678 -> "1,23,45,678": lakh and crore grouping, as the dashboard shows rupees."""
    s = str(int(round(abs(n))))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts + [tail])
    return ("-" if n < 0 and round(abs(n)) else "") + s


def money(v, cur, cents=False):
    """An amount as the dashboard shows it: rupees whole with lakh grouping, other currencies with commas, and
    cents below 100 (or always, with cents=True, as the client report shows them)."""
    if v is None:
        return "n/a"
    sym = SYMBOLS.get(cur, (cur + " ") if cur else "")
    if cur == "INR":
        return ("-" if v < 0 and round(abs(v)) else "") + sym + _indian(abs(v))
    sign = "-" if v < 0 and round(abs(v), 2) else ""
    v = abs(v)
    return sign + sym + ("{:,.0f}".format(v) if v >= 100 and not cents else "{:,.2f}".format(v))


def pct(v):
    return "\u2014" if v is None else "%.2f%%" % (100 * v)


def range_label(start, end):
    """"Oct 1 - Oct 15, 2026", the dashboard's date range; the year on both ends when they differ."""
    a, b = _dt.date.fromisoformat(start), _dt.date.fromisoformat(end)
    left = a.strftime("%b ") + str(a.day) + (a.strftime(", %Y") if a.year != b.year else "")
    return "%s - %s%s, %d" % (left, b.strftime("%b "), b.day, b.year)


def number(v):
    if v is None:
        return "n/a"
    return "{:,.0f}".format(v) if abs(v - round(v)) < 0.05 or abs(v) >= 100 else "{:,.1f}".format(v)


def change(now, base):
    """"+12%" against the baseline, or "" when there is no baseline to compare with."""
    if base is None or not base or now is None:
        return ""
    pct = round(100 * (now - base) / base)
    if pct == 0:
        return "flat"
    return ("↑ +%d%%" if pct > 0 else "↓ %d%%") % pct


# The accounts the morning digest is about; every other account in the sheet is left out. Spelling, case,
# spaces and punctuation do not have to match the sheet, and a "(...)" tag may be left off on either side
# ("Artistic Yoga(BTA)" finds "Artistic Yoga" and "Artistic Yoga (BTA)"). GOOGLE_ADS_DIGEST_ACCOUNTS
# (Railway -> web -> Variables; names separated by commas, semicolons or new lines) replaces this list
# without a deploy, and "*" sends every account.
DIGEST_ACCOUNTS = ["AIHS", "Alphametic", "AllureAvani", "Basil woods school", "Core Care Clinic",
                   "Madge Beauty", "July Mode", "Greet Technologies", "Artistic Yoga(BTA)",
                   "Turquoise Institute", "City College", "KFI"]


# The name each account goes by in the digest, where the Google Ads account is named otherwise. Matched as
# account names are matched below (case, spaces and punctuation do not matter).
DISPLAY_NAMES = {"AA_New": "AllureAvani", "JulyMode x 2025": "July Mode", "BTay": "Artistic Yoga (BTA)",
                 "Krishnamurti Foundation India": "KFI"}


def display_name(account):
    """The name the digest shows for a Google Ads account: DISPLAY_NAMES's, else its own."""
    keys = _keys(account)
    return next((shown for real, shown in DISPLAY_NAMES.items() if _keys(real) == keys and keys), account)


def wanted_names(env=""):
    """The list to send: the environment's names when it has any, else DIGEST_ACCOUNTS; None means every account."""
    names = [n.strip() for n in re.split(r"[,;\n]", env or "") if n.strip()]
    if names == ["*"]:
        return None
    return names or list(DIGEST_ACCOUNTS)


def _keys(name):
    """The forms of a name that count as the same account: whole, and without its "(...)" tag, letters and digits only."""
    whole = re.sub(r"[^a-z0-9]", "", str(name or "").casefold())
    bare = re.sub(r"[^a-z0-9]", "", re.sub(r"\([^)]*\)", "", str(name or "")).casefold())
    return {k for k in (whole, bare) if k}


def pick_accounts(accounts, names):
    """(the accounts to send, in the order given, and the listed names that matched none of them)."""
    if names is None:
        return list(accounts), []
    chosen, missing = [], []
    wanted = [(n, _keys(n)) for n in names]
    known = {a: _keys(a) | _keys(display_name(a)) for a in accounts}   # its own name or the one it goes by
    for a in accounts:
        if any(known[a] & k for _, k in wanted):
            chosen.append(a)
    for n, k in wanted:
        if not any(known[a] & k for a in accounts):
            missing.append(n)
    return chosen, missing


def esc(s):
    """Slack mrkdwn treats &, < and > as control characters (https://api.slack.com/reference/surfaces/formatting#escaping)."""
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def day_label(day):
    d = _dt.date.fromisoformat(day)
    return d.strftime("%a ") + str(d.day) + d.strftime(" %b %Y")


# ── The figures ──────────────────────────────────────────────────────────────
def _ratio(a, b):
    return a / b if b else None


def _totals(rows):
    """Spend, clicks, impressions and conversions added up. The sheet has no phone calls (None); the card's
    figures come from the Google Ads API when it can be read (api_totals)."""
    t = {"cost": 0.0, "clicks": 0.0, "impressions": 0.0, "conversions": 0.0}
    for r in rows:
        for k in t:
            t[k] += r.get(k) or 0.0
    t["phone_calls"] = None
    return t


def api_totals(shape, day, currency):
    """{"mtd", "day", "currency"} from paid_gads.campaign_days over the 1st of the month to `day`: the month's
    totals and the day's, phone calls included (None when Google would not give that column)."""
    from tracker import paid_gads
    names = [k for k, _ in paid_gads.BASE]
    col = {k: names.index(k) for k in ("impressions", "clicks", "cost_micros", "conversions", "phone_calls")}
    calls_missing = col["phone_calls"] in (shape.get("missing") or [])
    days = shape.get("days") or []

    def add(rows):
        t = {"impressions": 0.0, "clicks": 0.0, "cost": 0.0, "conversions": 0.0, "phone_calls": 0.0}
        for r in rows:
            nums = r[2:]
            t["impressions"] += nums[col["impressions"]]
            t["clicks"] += nums[col["clicks"]]
            t["cost"] += nums[col["cost_micros"]]
            t["conversions"] += nums[col["conversions"]]
            t["phone_calls"] += nums[col["phone_calls"]]
        if calls_missing:
            t["phone_calls"] = None
        return t
    rows = shape.get("rows") or []
    on_day = [r for r in rows if r[1] < len(days) and days[r[1]] == day]
    return {"mtd": add(rows), "day": add(on_day), "currency": currency}


def summarize(rows, account, st=None, fx=None, today=None, allocated=None, api=None, day=None):
    """One account's digest: the month so far, its latest day against the 7 days before it, the month's
    budget, and what needs attention.

    rows: the campaign report (app._fetch_google_ads_rows); st: the parsed insights tabs
    (google_ads_insights.store), optional; fx: google_ads_insights.FX(rows); allocated: what the client
    agreed to spend this month (the Pacing Desk's budget for the account), or None; api: api_totals for the
    month so far, whose figures (phone calls among them) the card shows when its currency is the card's;
    day: the day reported on (the digest's is always yesterday in India), else the account's latest day in the sheet."""
    fx = fx or g.FX(rows)
    mine = [r for r in rows if (r.get("account") or "") == account and r.get("day")]
    if not mine:
        return None
    # Money in the currency the account is billed in ("Cost", "Currency code"), as Google Ads shows it,
    # and its insights unconverted to match. An account whose rows carry no currency code keeps the
    # report's converted figures.
    own = {r.get("currency_native") or "" for r in mine}
    if len(own) == 1 and "" not in own:
        mine = [dict(r, cost=r.get("cost_native") or 0.0, currency=r["currency_native"]) for r in mine]
        fx = g.FX(mine)
    report_days = sorted({r["day"] for r in rows if r.get("day")})
    sheet_day = max(r["day"] for r in mine)
    day = day or sheet_day
    mine = [r for r in mine if r["day"] <= day] or mine[:0]
    if not mine:
        return None
    cur = max(sorted({r.get("currency") or "" for r in mine}),
              key=lambda c: sum(r.get("cost") or 0 for r in mine if (r.get("currency") or "") == c))
    d = _dt.date.fromisoformat(day)
    base_lo = (d - _dt.timedelta(days=BASELINE_DAYS)).isoformat()
    base_hi = (d - _dt.timedelta(days=1)).isoformat()
    # Campaigns appear in the report only on days with impressions, so a missing day is a day of
    # nothing; the average is over every day of the 7 the report itself covers.
    covered = [x for x in report_days if base_lo <= x <= base_hi]
    n_base = len(covered)
    now = _totals([r for r in mine if r["day"] == day])
    use_api = bool(api and api.get("currency") == cur)
    if use_api:   # the day from Google itself, so a sheet a day behind never reads as a day of nothing
        now = dict(api["day"])
    base = None
    if n_base:
        t = _totals([r for r in mine if base_lo <= r["day"] <= base_hi])
        base = {k: None if v is None else v / n_base for k, v in t.items()}

    out = {"account": account, "name": display_name(account), "sheet_day": sheet_day,
           # The sheet has not reached the day and the API could not stand in: no figure for it to judge.
           "day_missing": not use_api and sheet_day < day,
           "customer_id": next((r.get("customer_id") for r in mine if r.get("customer_id")), ""),
           "day": day, "cur": cur, "now": now, "base": base, "base_days": n_base,
           "cpa": _ratio(now["cost"], now["conversions"]),
           "base_cpa": _ratio(base["cost"], base["conversions"]) if base else None,
           "ctr": _ratio(now["clicks"], now["impressions"]),
           "roas": None, "base_roas": None, "pacing": None, "alerts": [], "top": []}

    # The month so far: the 1st of the latest day's month to that day, as the dashboard's date range reads.
    first = d.replace(day=1).isoformat()
    month_rows = [r for r in mine if first <= r["day"] <= day]
    out["mtd"] = dict(_totals(month_rows), start=min([r["day"] for r in month_rows] or [first]),
                      partial=min(report_days) > first)
    out["day_totals"], out["source"] = now, "sheet"
    if use_api:
        out["mtd"] = dict(api["mtd"], start=first, partial=False)
        out["day_totals"], out["source"] = api["day"], "api"

    # Top campaigns on the day, by spend.
    camps = {}
    for r in mine:
        if r["day"] == day:
            c = camps.setdefault(r.get("campaign") or "", {"campaign": r.get("campaign") or "", "cost": 0.0,
                                                           "conversions": 0.0, "clicks": 0.0})
            for k in ("cost", "conversions", "clicks"):
                c[k] += r.get(k) or 0.0
    out["top"] = sorted(camps.values(), key=lambda c: -c["cost"])[:TOP_CAMPAIGNS]

    limited, disapproved, budgets = [], 0, []
    if st and st.get("ok"):
        # Conversion value comes from the insights export (the campaign report has none). ROAS is a
        # ratio of two figures in the same currency, so it needs no conversion.
        def value_cost(lo, hi):
            xs = [x for x in g.is_rows(st["is"], lo, hi, fx) if x.get("account") == account]
            return sum(x.get("value") or 0 for x in xs), sum(x.get("cost") or 0 for x in xs)
        if st["is"].dated:
            v, c = value_cost(day, day)
            bv, bc = value_cost(base_lo, base_hi)
            if v or bv:
                out["roas"], out["base_roas"] = _ratio(v, c), _ratio(bv, bc)
            since = (d - _dt.timedelta(days=BASELINE_DAYS - 1)).isoformat()
            limited = sorted({x["campaign"] for x in g.is_rows(st["is"], since, day, fx)
                              if x.get("account") == account and (x.get("lb") or 0) >= LIMITED_SHARE})
        _, budgets = g.parse_budgets(st.get("budgets") or [], fx)
        budgets = [b for b in budgets if b["account"] == account]
        disapproved = sum(1 for x, _, _ in st["ads"].items
                          if x.get("account") == account and x.get("approval") == "DISAPPROVED")
    if budgets:
        mtd = sum(b["mtd"] for b in budgets)
        expected = sum(b["expected"] or 0 for b in budgets)
        month = sum(b["month_budget"] or 0 for b in budgets)
        out["pacing"] = {"mtd": mtd, "expected": expected, "month_budget": month,
                         "pace": _ratio(mtd, expected), "cur": budgets[0]["cur"],
                         "over": [b["name"] for b in budgets if b["verdict"] in ("over", "capped")],
                         "under": [b["name"] for b in budgets if b["verdict"] == "under"]}

    out["budget"] = budget(out, allocated)
    out["alert_items"] = alert_items(out, limited, disapproved, today or today_ist())
    out["alerts"] = [t for _, t in out["alert_items"]]
    out["status"] = status(out["alert_items"])
    return out


def budget(s, allocated=None):
    """The month's budget against what has been spent: the allocation (the Pacing Desk's, else the campaigns'
    daily budgets for the whole month), what should have been spent by the latest day at an even pace, what
    has been, and the difference (over is positive). None with no budget to compare with."""
    p, source = s.get("pacing"), "pacing_desk"
    if not allocated:
        allocated, source = (p or {}).get("month_budget"), "daily_budgets"
    if not allocated:
        return None
    d = _dt.date.fromisoformat(s["day"])
    dim = (d.replace(day=28) + _dt.timedelta(days=4)).replace(day=1) - _dt.timedelta(days=1)
    projected = allocated * d.day / dim.day
    spent = s["mtd"]["cost"]
    return {"allocated": allocated, "projected": projected, "spent": spent, "diff": spent - projected,
            "source": source, "through": s["day"]}


def allocation_for(saved, account):
    """The month's allocation for an account from the Pacing Desk's saved rows (Google rows only): the rows
    naming the account, else the rows of a client by that name. Names match as pick_accounts matches them."""
    google = [r for r in saved or [] if (r.get("channel") or "Google") == "Google"]
    keys = _keys(account)
    mine = [r for r in google if _keys(r.get("account")) & keys] or [r for r in google if _keys(r.get("client")) & keys]
    total = sum(float(r.get("allocated") or 0) for r in mine)
    return total or None


CRITICAL, WARNING, INFO = "critical", "warning", "info"


def alert_items(s, limited=(), disapproved=0, today=None):
    """What needs a look today as (level, text), most urgent first: critical (money or tracking may be
    broken), warning (a figure moved the wrong way), info (worth knowing)."""
    a = []
    now, base, cur = s["now"], s["base"], s["cur"]
    seen = s.get("sheet_day") or s["day"]
    if today and (today - _dt.date.fromisoformat(seen)).days > STALE_AFTER_DAYS:
        a.append((CRITICAL, "No data after %s. Check that the Google Ads scripts ran." % day_label(seen)))
    if s.get("day_missing"):
        base = None
    if base and base["cost"] > 0:
        if now["cost"] == 0:
            a.append((CRITICAL, "Spent nothing (7-day average %s a day)." % money(base["cost"], cur)))
        elif now["cost"] >= base["cost"] * (1 + SPEND_SWING):
            a.append((WARNING, "Spend up %d%% on the 7-day average." % round(100 * (now["cost"] / base["cost"] - 1))))
        elif now["cost"] <= base["cost"] * (1 - SPEND_SWING):
            a.append((WARNING, "Spend down %d%% on the 7-day average." % round(100 * (1 - now["cost"] / base["cost"]))))
    if base and base["conversions"] >= MIN_BASE_CONV and now["conversions"] == 0 and now["cost"] > 0:
        a.append((CRITICAL, "No conversions (7-day average %s a day)." % number(base["conversions"])))
    if disapproved:
        a.append((CRITICAL, "%d disapproved ad%s." % (disapproved, "" if disapproved == 1 else "s")))
    if base and s["cpa"] and s["base_cpa"] and s["cpa"] >= s["base_cpa"] * (1 + CPA_RISE):
        a.append((WARNING, "Cost per conversion %s, up %d%% on the 7-day %s." %
                  (money(s["cpa"], cur), round(100 * (s["cpa"] / s["base_cpa"] - 1)), money(s["base_cpa"], cur))))
    if s["roas"] is not None and s["base_roas"] and s["roas"] <= s["base_roas"] * (1 - ROAS_DROP):
        a.append((WARNING, "ROAS %.2fx, down %d%% on the 7-day %.2fx." %
                  (s["roas"], round(100 * (1 - s["roas"] / s["base_roas"])), s["base_roas"])))
    p = s.get("pacing")
    if p and p["over"]:
        a.append((WARNING, "Budget over-pacing this month: %s." % _names(p["over"])))
    if limited:
        a.append((WARNING, "Losing searches to budget (last 7 days): %s." % _names(limited)))
    if p and p["under"]:
        a.append((INFO, "Budget under-pacing this month: %s." % _names(p["under"])))
    order = {CRITICAL: 0, WARNING: 1, INFO: 2}
    return sorted(a, key=lambda x: order[x[0]])


def alerts(s, limited=(), disapproved=0, today=None):
    """What needs a look today, most urgent first, in plain words."""
    return [t for _, t in alert_items(s, limited, disapproved, today)]


def status(items):
    """The account's light: the most serious level among its alerts, else "good"."""
    levels = {lvl for lvl, _ in items}
    return CRITICAL if CRITICAL in levels else WARNING if WARNING in levels else "good"


# The bar down the side of every message: the report's navy, the same for every account (no status labels).
BAR_COLOR = "#16194c"


def _names(xs, keep=3):
    xs = list(xs)
    shown = ", ".join(xs[:keep])
    return shown + (" and %d more" % (len(xs) - keep) if len(xs) > keep else "")


def daily_budgets(rows):
    """(campaigns, total a day) from paid_pacing_read.q_enabled()'s rows: each enabled campaign with its daily
    budget, and the account's total with a shared budget counted once, as the card's estimate counts it."""
    from tracker import paid_pacing_read
    camps, seen, total = [], set(), 0.0
    for r in rows:
        c = paid_pacing_read._campaign(r)
        if not c["id"]:
            continue
        camps.append(c)
        key = str(((r.get("campaignBudget") or {}).get("id")) or "campaign:" + c["id"])
        if key not in seen:
            seen.add(key)
            total += c["budget"]
    camps.sort(key=lambda c: (-c["budget"], c["name"].lower()))
    return camps, round(total, 2)


# ── The Slack message ────────────────────────────────────────────────────────
UP, DOWN = "\u25B2", "\u25BC"
DOT = "  \u00b7  "


def delta(now, base):
    """The change against the 7-day average: "▲ 22%", "▼ 90%", "flat", or "" with nothing to compare."""
    if now is None or not base:
        return ""
    pct = round(100 * (now - base) / base)
    if abs(pct) < 5:
        return "flat"
    return "%s %d%%" % (UP if pct > 0 else DOWN, abs(pct))


def _attachment(color, blocks):
    """Blocks inside an attachment get Slack's coloured side bar: the account's status at a glance."""
    return [{"color": color, "blocks": blocks}]


def _alert_text(items):
    """What needs a look, most urgent first, as plain bullets (no headings or labels)."""
    return "\n".join("\u2022  " + esc(t) for _, t in items)


def _links(s, base_url):
    if not base_url:
        return []
    q = "?account=" + quote(s["account"], safe="")
    return [{"type": "actions", "elements": [
        {"type": "button", "action_id": "open_dashboard", "text": {"type": "plain_text", "text": "Open dashboard"},
         "url": "%s/dashboards/google-ads%s" % (base_url, q)},
        {"type": "button", "action_id": "open_ai_review", "text": {"type": "plain_text", "text": "AI review"},
         "url": "%s/dashboards/google-ads/ai-review%s" % (base_url, q)}]}]


def _figures(t, cur):
    """The client report's figures for a stretch of days, in its order: (label, short label, value)."""
    calls = t.get("phone_calls")
    return [
        ("Impressions", "Impr.", number(t["impressions"])),
        ("Clicks", "Clicks", number(t["clicks"])),
        ("CTR", "CTR", pct(_ratio(t["clicks"], t["impressions"]))),
        ("Avg. CPC", "Avg. CPC", money(_ratio(t["cost"], t["clicks"]), cur, cents=True) if t["clicks"] else "\u2014"),
        ("Cost", "Cost", money(t["cost"], cur, cents=True)),
        ("Conversions", "Conv.", number(t["conversions"])),
        ("Phone calls", "Calls", "\u2014" if calls is None else number(calls)),
        ("Cost / conv.", "Cost / conv.", money(_ratio(t["cost"], t["conversions"]), cur, cents=True)
         if t["conversions"] else "\u2014"),
        ("Conv. rate", "Conv. rate", pct(_ratio(t["conversions"], t["clicks"]))),
    ]


def day_table(day, t, cur):
    """The latest day as a two-line table in a code block, so its columns line up in Slack."""
    cols = [("Day", _dt.date.fromisoformat(day).strftime("%b ") + str(_dt.date.fromisoformat(day).day)
             + _dt.date.fromisoformat(day).strftime(", %Y"))] + [(short, v) for _, short, v in _figures(t, cur)]
    widths = [max(len(h), len(v)) for h, v in cols]
    line = lambda xs: "  ".join(x.ljust(w) for x, w in zip(xs, widths)).rstrip()
    return "```\n%s\n%s\n```" % (line([h for h, _ in cols]), line([v for _, v in cols]))


def message(s, base_url="", card_url=""):
    """One account's update, laid out like the client report: the month so far, the latest day, then the
    month's budget, in a card whose coloured bar is the account's status, with what needs attention and
    links. With card_url (tracker/gads_digest_card.py's picture of the same), the picture replaces the
    figures; without one they are written out. Returns {"text", "blocks", "attachments"}."""
    cur, now, m = s["cur"], s["now"], s["mtd"]
    items = s.get("alert_items") or [(WARNING, t) for t in s.get("alerts") or []]
    name = s.get("name") or s["account"]
    span = range_label(m["start"], s["day"])
    fallback = "%s: %s. Cost %s, %s conversions" % (
        name, span, money(m["cost"], cur, cents=True), number(m["conversions"]))
    blocks = [{"type": "header", "text": {"type": "plain_text", "text": name[:150]}}]

    if card_url:
        card = [{"type": "image", "image_url": card_url, "alt_text": fallback[:1900]}]
        if items:
            card.append({"type": "section", "text": {"type": "mrkdwn", "text": _alert_text(items)[:2900]}})
        card += _links(s, base_url)
        card.append({"type": "context", "elements": [{"type": "mrkdwn", "text":
            "Reply in this thread to ask about %s" % esc(name)}]})
        return {"text": fallback, "blocks": blocks, "attachments": _attachment(BAR_COLOR, card)}

    card = [
        {"type": "context", "elements": [{"type": "mrkdwn", "text": "*%s*%s%s%smonth to date" % (
            "Daily performance", DOT, span, DOT)}]},
        {"type": "section", "fields": [{"type": "mrkdwn", "text": "%s\n*%s*" % (label, value)}
                                       for label, _, value in _figures(m, cur)]},
        {"type": "section", "text": {"type": "mrkdwn", "text": "*Yesterday*\n" + day_table(
            s["day"], s.get("day_totals") or now, cur)}},
    ]
    b = s.get("budget")
    if b:
        diff = b["diff"]
        word = "Overspent" if diff > 0.005 else "Underspent" if diff < -0.005 else "On budget"
        card.append({"type": "divider"})
        card.append({"type": "section", "fields": [
            {"type": "mrkdwn", "text": "Budget allocation\n*%s*" % money(b["allocated"], cur, cents=True)},
            {"type": "mrkdwn", "text": "Projected budget to %s\n*%s*" % (
                range_label(b["through"], b["through"]).split(" - ")[1].split(",")[0], money(b["projected"], cur, cents=True))},
            {"type": "mrkdwn", "text": "Spent so far\n*%s*" % money(b["spent"], cur, cents=True)},
            {"type": "mrkdwn", "text": "%s\n*%s%s*" % (word, "+" if diff > 0.005 else "",
                                                       money(diff, cur, cents=True))},
        ]})
        if b["source"] != "pacing_desk":
            card.append({"type": "context", "elements": [{"type": "mrkdwn", "text":
                "No budget for this account in the Pacing Desk this month, so the allocation is its campaigns' "
                "daily budgets for the whole month."}]})
    else:
        card.append({"type": "context", "elements": [{"type": "mrkdwn", "text":
            "No budget for this account in the Pacing Desk this month. Add one there to see the budget row."}]})
    if items:
        card.append({"type": "divider"})
        card.append({"type": "section", "text": {"type": "mrkdwn", "text": _alert_text(items)[:2900]}})
    card += _links(s, base_url)
    note = "Reply in this thread to ask about %s%sMoney in %s; the latest day can still move slightly as Google " \
           "adds late clicks." % (esc(name), DOT, cur or "the report's currency")
    if m.get("partial"):
        note += "%sThe sheet starts on %s, so the month so far begins there." % (DOT, day_label(m["start"]))
    if s.get("source") != "api":
        note += "%sThe Google Ads API could not be read, so these figures are the sheet's and phone calls are " \
                "missing." % DOT
    card.append({"type": "context", "elements": [{"type": "mrkdwn", "text": note}]})
    return {"text": fallback, "blocks": blocks, "attachments": _attachment(BAR_COLOR, card)}


def overview(summaries, base_url="", today=None):
    """The morning's first message: yesterday's spend and conversions, then every account, biggest spend first."""
    ss = sorted(summaries, key=lambda s: -s["now"]["cost"])
    curs = {s["cur"] for s in ss}
    days = sorted({s["day"] for s in ss})
    blocks = [{"type": "header", "text": {"type": "plain_text", "text": "Google Ads daily briefing"}}]
    when = day_label(days[-1]) if days else day_label(((today or today_ist()) - _dt.timedelta(days=1)).isoformat())
    card = [{"type": "context", "elements": [{"type": "mrkdwn", "text": "%s%s%d account%s%sagainst each account's 7-day average" % (
        when, DOT, len(ss), "" if len(ss) == 1 else "s", DOT)}]}]
    fields = []
    # Each account is in its own currency; amounts in different currencies are never added together,
    # so with several the total spend is one line per currency.
    def spent(c):
        group = [s for s in ss if s["cur"] == c]
        return money(sum(s["now"]["cost"] for s in group), c), \
            delta(sum(s["now"]["cost"] for s in group), sum((s["base"] or {}).get("cost", 0) for s in group))
    conv = sum(s["now"]["conversions"] for s in ss)
    bconv = sum((s["base"] or {}).get("conversions", 0) for s in ss)
    if len(curs) == 1:
        fields.append({"type": "mrkdwn", "text": "Total spend\n*%s*   %s" % spent(next(iter(curs)))})
    elif curs:
        by = sorted(curs, key=lambda c: (-sum(1 for s in ss if s["cur"] == c), c))
        fields.append({"type": "mrkdwn", "text": "Total spend by currency\n" +
                       "\n".join("*%s*   %s" % spent(c) for c in by)})
    fields.append({"type": "mrkdwn", "text": "Conversions\n*%s*   %s" % (number(conv), delta(conv, bconv))})
    card.append({"type": "section", "fields": fields})
    card.append({"type": "divider"})
    chunk = ""
    for s in ss:
        line = "*%s*%s%s%s%s conv." % (esc(s.get("name") or s["account"]), DOT, money(s["now"]["cost"], s["cur"]), DOT,
                                     number(s["now"]["conversions"]))
        if s.get("alerts"):
            line += "\n_%s_" % esc(s["alerts"][0])
        if chunk and len(chunk) + len(line) > 2800:   # Slack allows 3,000 characters per section
            card.append({"type": "section", "text": {"type": "mrkdwn", "text": chunk}})
            chunk = ""
        chunk += ("\n" if chunk else "") + line
    if chunk:
        card.append({"type": "section", "text": {"type": "mrkdwn", "text": chunk}})
    if base_url:
        card.append({"type": "actions", "elements": [
            {"type": "button", "action_id": "open_dashboard_all", "text": {"type": "plain_text", "text": "Open dashboard"},
             "url": "%s/dashboards/google-ads" % base_url}]})
    note = "Each account's report follows. Reply under any of them, or mention @Ads Insight, to ask a question."
    card.append({"type": "context", "elements": [{"type": "mrkdwn", "text": note}]})
    text = "Google Ads daily briefing: %d accounts, %s." % (len(ss), when)
    return {"text": text, "blocks": blocks, "attachments": _attachment(BAR_COLOR, card[:49])}


# ── Posting ──────────────────────────────────────────────────────────────────
def post(token, channel, msg, session=None, sleep=time.sleep):
    """Post one message. Returns (ok, error, ts): Slack's own error code on failure, never the token, and
    the message's timestamp (its id in the channel, so replies under it can be told apart)."""
    http = session or requests
    body = {"channel": channel, "text": msg["text"], "blocks": msg["blocks"],
            "unfurl_links": False, "unfurl_media": False}
    if msg.get("attachments"):
        body["attachments"] = msg["attachments"]
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json; charset=utf-8"}
    for attempt in range(2):
        try:
            r = http.post(SLACK_POST, headers=headers, json=body, timeout=15)
        except requests.RequestException as exc:
            return False, type(exc).__name__, ""
        if r.status_code == 429 and attempt == 0:
            try:
                wait = min(30, int(r.headers.get("Retry-After", "1")))
            except ValueError:
                wait = 1
            sleep(wait)
            continue
        try:
            data = r.json()
        except ValueError:
            return False, "http_%d" % r.status_code, ""
        if data.get("ok"):
            return True, "", str(data.get("ts") or "")
        return False, str(data.get("error") or "unknown_error")[:80], ""
    return False, "ratelimited", ""


OVERVIEW = "__overview__"


def run(rows, accounts, st=None, token="", channel="", base_url="", dry_run=False, force=False,
        last_posted=None, mark_posted=None, on_thread=None, today=None, session=None, sleep=time.sleep,
        allocation=None, api=None, card_url=None):
    """Post the morning overview (with two or more accounts), then each account's digest, in the order given.

    last_posted(key) -> the day last posted for an account (or OVERVIEW), so a retried run never posts
    twice; mark_posted(key, day) records a post; on_thread(account, ts) records which account a posted
    message is about ("" for the overview), so Ads Insight can answer replies under it;
    allocation(account, "YYYY-MM") -> the month's budget the client agreed (the Pacing Desk's), or None.
    api(account, customer_id, first, last) -> api_totals from the Google Ads API, or None (the sheet's figures).
    card_url(summary) -> the address of the account's picture (tracker/gads_digest_card.py), or "" to write
    the figures out instead.
    Returns one result
    per account (and one for the overview, account OVERVIEW):
    {"account", "day", "status": posted | skipped | preview | failed | no_data, "error", "message"}."""
    fx = g.FX(rows)
    today = today or today_ist()
    out, sent = [], [0]
    summaries = []
    # Always yesterday in India, whatever day the sheet has reached: sent on 20 Oct, the report is for 19 Oct,
    # and the month so far runs from the 1st to then.
    day = (today - _dt.timedelta(days=1)).isoformat()
    for account in accounts:
        allocated = None
        if allocation:
            allocated = allocation(display_name(account), day[:7]) or (
                allocation(account, day[:7]) if display_name(account) != account else None)
        figures = None
        if api:
            cid = next((r.get("customer_id") for r in rows if r.get("account") == account and r.get("customer_id")), "")
            figures = api(account, cid, day[:8] + "01", day)
        s = summarize(rows, account, st, fx, today, allocated, figures, day=day)
        if s:
            summaries.append(s)
        else:
            out.append({"account": account, "day": "", "status": "no_data", "error": ""})

    def send(key, day, msg, thread_account, extra=None):
        res = {"account": key, "day": day, "status": "", "error": ""}
        res.update(extra or {})
        if dry_run:
            res.update(status="preview", message=msg)
        elif not force and last_posted and last_posted(key) == day:
            res["status"] = "skipped"
        else:
            if sent[0]:
                sleep(SPACING_SECONDS)
            ok, err, ts = post(token, channel, msg, session=session, sleep=sleep)
            sent[0] += 1
            res.update(status="posted" if ok else "failed", error=err)
            if ok and mark_posted:
                mark_posted(key, day)
            if ok and ts and on_thread:
                on_thread(thread_account, ts)
        out.append(res)

    if len(summaries) > 1:
        send(OVERVIEW, today.isoformat(), overview(summaries, base_url, today), "")
    for s in summaries:
        url = card_url(s) if card_url else ""
        send(s["account"], s["day"], message(s, base_url, url), s["account"], {"alerts": len(s["alerts"])})
    return out
