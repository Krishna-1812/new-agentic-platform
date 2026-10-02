"""Google Ads daily Slack digest: one message per account, posted each morning.

Each message covers the account's latest day in the campaign report (its own "yesterday", in its own
time zone) against the 7 days before it, with month-to-date budget pacing and what needs attention.
Every figure comes from the same sheet and the same conversions the dashboard uses, so Slack and
/dashboards/google-ads always agree.

Posting uses Slack's chat.postMessage with a bot token (https://api.slack.com/methods/chat.postMessage),
which needs the chat:write scope and the bot to be a member of the channel. Slack allows about one
message per second per channel (https://api.slack.com/apis/rate-limits#posting-messages), so messages
are spaced a second apart and a 429 is retried once after its Retry-After.
"""
import datetime as _dt
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


def money(v, cur):
    if v is None:
        return "n/a"
    sym = SYMBOLS.get(cur, (cur + " ") if cur else "")
    if cur == "INR":
        return sym + _indian(v)
    return sym + ("{:,.0f}".format(v) if abs(v) >= 100 else "{:,.2f}".format(v))


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
    t = {"cost": 0.0, "clicks": 0.0, "impressions": 0.0, "conversions": 0.0}
    for r in rows:
        for k in t:
            t[k] += r.get(k) or 0.0
    return t


def summarize(rows, account, st=None, fx=None, today=None):
    """One account's digest: its latest day against the 7 days before it, and what needs attention.

    rows: the campaign report (app._fetch_google_ads_rows); st: the parsed insights tabs
    (google_ads_insights.store), optional; fx: google_ads_insights.FX(rows)."""
    fx = fx or g.FX(rows)
    mine = [r for r in rows if (r.get("account") or "") == account and r.get("day")]
    if not mine:
        return None
    report_days = sorted({r["day"] for r in rows if r.get("day")})
    day = max(r["day"] for r in mine)
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
    base = None
    if n_base:
        t = _totals([r for r in mine if base_lo <= r["day"] <= base_hi])
        base = {k: v / n_base for k, v in t.items()}

    out = {"account": account, "customer_id": next((r.get("customer_id") for r in mine if r.get("customer_id")), ""),
           "day": day, "cur": cur, "now": now, "base": base, "base_days": n_base,
           "cpa": _ratio(now["cost"], now["conversions"]),
           "base_cpa": _ratio(base["cost"], base["conversions"]) if base else None,
           "ctr": _ratio(now["clicks"], now["impressions"]),
           "roas": None, "base_roas": None, "pacing": None, "alerts": [], "top": []}

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

    out["alerts"] = alerts(out, limited, disapproved, today or today_ist())
    return out


def alerts(s, limited=(), disapproved=0, today=None):
    """What needs a look today, most urgent first, in plain words."""
    a = []
    now, base, cur = s["now"], s["base"], s["cur"]
    if today and (today - _dt.date.fromisoformat(s["day"])).days > STALE_AFTER_DAYS:
        a.append("No data after %s. Check that the Google Ads scripts ran." % day_label(s["day"]))
    if base and base["cost"] > 0:
        if now["cost"] == 0:
            a.append("Spent nothing (7-day average %s a day)." % money(base["cost"], cur))
        elif now["cost"] >= base["cost"] * (1 + SPEND_SWING):
            a.append("Spend up %d%% on the 7-day average." % round(100 * (now["cost"] / base["cost"] - 1)))
        elif now["cost"] <= base["cost"] * (1 - SPEND_SWING):
            a.append("Spend down %d%% on the 7-day average." % round(100 * (1 - now["cost"] / base["cost"])))
    if base and base["conversions"] >= MIN_BASE_CONV and now["conversions"] == 0 and now["cost"] > 0:
        a.append("No conversions (7-day average %s a day)." % number(base["conversions"]))
    if s["cpa"] and s["base_cpa"] and s["cpa"] >= s["base_cpa"] * (1 + CPA_RISE):
        a.append("Cost per conversion %s, up %d%% on the 7-day %s." %
                 (money(s["cpa"], cur), round(100 * (s["cpa"] / s["base_cpa"] - 1)), money(s["base_cpa"], cur)))
    if s["roas"] is not None and s["base_roas"] and s["roas"] <= s["base_roas"] * (1 - ROAS_DROP):
        a.append("ROAS %.2fx, down %d%% on the 7-day %.2fx." %
                 (s["roas"], round(100 * (1 - s["roas"] / s["base_roas"])), s["base_roas"]))
    p = s.get("pacing")
    if p and p["over"]:
        a.append("Budget over-pacing this month: %s." % _names(p["over"]))
    if p and p["under"]:
        a.append("Budget under-pacing this month: %s." % _names(p["under"]))
    if limited:
        a.append("Losing searches to budget (last 7 days): %s." % _names(limited))
    if disapproved:
        a.append("%d disapproved ad%s." % (disapproved, "" if disapproved == 1 else "s"))
    return a


def _names(xs, keep=3):
    xs = list(xs)
    shown = ", ".join(xs[:keep])
    return shown + (" and %d more" % (len(xs) - keep) if len(xs) > keep else "")


# ── The Slack message ────────────────────────────────────────────────────────
def message(s, base_url=""):
    """Slack Block Kit blocks and a plain-text fallback for one account's digest."""
    cur, now, base = s["cur"], s["now"], s["base"]

    def field(label, value, now_v=None, base_v=None, base_text=None):
        line = "*%s*\n%s" % (label, value)
        ch = change(now_v, base_v)
        if ch:
            line += "  %s" % ch
        if base_text:
            line += "\n_7-day avg %s_" % base_text
        return {"type": "mrkdwn", "text": line}

    b = base or {}
    fields = [
        field("Spend", money(now["cost"], cur), now["cost"], b.get("cost"),
              money(b["cost"], cur) if base else None),
        field("Conversions", number(now["conversions"]), now["conversions"], b.get("conversions"),
              number(b["conversions"]) if base else None),
        field("Cost per conversion", money(s["cpa"], cur), s["cpa"], s["base_cpa"],
              money(s["base_cpa"], cur) if s["base_cpa"] else None),
        field("Clicks", number(now["clicks"]), now["clicks"], b.get("clicks"),
              number(b["clicks"]) if base else None),
    ]
    if s["roas"] is not None:
        fields.append(field("ROAS", "%.2fx" % s["roas"], s["roas"], s["base_roas"],
                            ("%.2fx" % s["base_roas"]) if s["base_roas"] else None))
    p = s.get("pacing")
    if p:
        text = money(p["mtd"], p["cur"])
        if p["month_budget"]:
            text += " of %s budget" % money(p["month_budget"], p["cur"])
        if p["pace"] is not None:
            text += "\n_%d%% of the spend expected by now_" % round(100 * p["pace"])
        fields.append({"type": "mrkdwn", "text": "*Month to date*\n" + text})

    blocks = [
        {"type": "header", "text": {"type": "plain_text", "text": ("Google Ads · " + s["account"])[:150]}},
        {"type": "context", "elements": [{"type": "mrkdwn", "text": "*%s* compared with the %d days before it" %
                                          (day_label(s["day"]), s["base_days"] or BASELINE_DAYS)}]},
        {"type": "section", "fields": fields[:10]},
    ]
    if s["alerts"]:
        text = "*Needs attention*\n" + "\n".join("• " + esc(x) for x in s["alerts"])
    else:
        text = "*Needs attention*\nNothing unusual."
    blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": text[:2900]}})
    if s["top"]:
        lines = ["• %s: %s, %s conv." % (esc(c["campaign"]), money(c["cost"], cur), number(c["conversions"]))
                 for c in s["top"]]
        blocks.append({"type": "section", "text": {"type": "mrkdwn",
                                                    "text": ("*Top campaigns by spend*\n" + "\n".join(lines))[:2900]}})
    links = []
    if base_url:
        q = "?account=" + quote(s["account"], safe="")
        links = ["<%s/dashboards/google-ads%s|Open the dashboard>" % (base_url, q),
                 "<%s/dashboards/google-ads/ai-review%s|AI review>" % (base_url, q)]
    links.append("Money in %s, from the campaign report. Google adds late clicks for a few hours, so the "
                 "latest day can still move slightly." % (cur or "the report's currency"))
    blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": " · ".join(links)}]})

    fallback = "Google Ads %s, %s: spend %s, %s conversions" % (
        s["account"], day_label(s["day"]), money(now["cost"], cur), number(now["conversions"]))
    if s["alerts"]:
        fallback += ". %d thing%s need%s attention." % (len(s["alerts"]), "" if len(s["alerts"]) == 1 else "s",
                                                          "s" if len(s["alerts"]) == 1 else "")
    return {"text": fallback, "blocks": blocks}


# ── Posting ──────────────────────────────────────────────────────────────────
def post(token, channel, msg, session=None, sleep=time.sleep):
    """Post one message. Returns (ok, error, ts): Slack's own error code on failure, never the token, and
    the message's timestamp (its id in the channel, so replies under it can be told apart)."""
    http = session or requests
    body = {"channel": channel, "text": msg["text"], "blocks": msg["blocks"],
            "unfurl_links": False, "unfurl_media": False}
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


def run(rows, accounts, st=None, token="", channel="", base_url="", dry_run=False, force=False,
        last_posted=None, mark_posted=None, on_thread=None, today=None, session=None, sleep=time.sleep):
    """Build and post the digest for each account, in the order given.

    last_posted(account) -> the day last posted for it (so a retried run never posts twice);
    mark_posted(account, day) records a post; on_thread(account, ts) records which account a posted
    message is about, so Ads Insight can answer replies under it. Returns one result per account:
    {"account", "day", "status": posted | skipped | preview | failed | no_data, "error", "message"}."""
    fx = g.FX(rows)
    out, sent = [], 0
    for account in accounts:
        s = summarize(rows, account, st, fx, today)
        if not s:
            out.append({"account": account, "day": "", "status": "no_data", "error": ""})
            continue
        msg = message(s, base_url)
        res = {"account": account, "day": s["day"], "status": "", "error": "", "alerts": len(s["alerts"])}
        if dry_run:
            res.update(status="preview", message=msg)
        elif not force and last_posted and last_posted(account) == s["day"]:
            res["status"] = "skipped"
        else:
            if sent:
                sleep(SPACING_SECONDS)
            ok, err, ts = post(token, channel, msg, session=session, sleep=sleep)
            sent += 1
            res.update(status="posted" if ok else "failed", error=err)
            if ok and mark_posted:
                mark_posted(account, s["day"])
            if ok and ts and on_thread:
                on_thread(account, ts)
        out.append(res)
    return out
