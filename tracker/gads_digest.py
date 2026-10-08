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
    # Money in the currency the account is billed in ("Cost", "Currency code"), as Google Ads shows it,
    # and its insights unconverted to match. An account whose rows carry no currency code keeps the
    # report's converted figures.
    own = {r.get("currency_native") or "" for r in mine}
    if len(own) == 1 and "" not in own:
        mine = [dict(r, cost=r.get("cost_native") or 0.0, currency=r["currency_native"]) for r in mine]
        fx = g.FX(mine)
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

    out["alert_items"] = alert_items(out, limited, disapproved, today or today_ist())
    out["alerts"] = [t for _, t in out["alert_items"]]
    out["status"] = status(out["alert_items"])
    return out


CRITICAL, WARNING, INFO = "critical", "warning", "info"
LEVEL_HEADING = {CRITICAL: "Action needed", WARNING: "Watch", INFO: "For information"}


def alert_items(s, limited=(), disapproved=0, today=None):
    """What needs a look today as (level, text), most urgent first: critical (money or tracking may be
    broken), warning (a figure moved the wrong way), info (worth knowing)."""
    a = []
    now, base, cur = s["now"], s["base"], s["cur"]
    if today and (today - _dt.date.fromisoformat(s["day"])).days > STALE_AFTER_DAYS:
        a.append((CRITICAL, "No data after %s. Check that the Google Ads scripts ran." % day_label(s["day"])))
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
    if s["cpa"] and s["base_cpa"] and s["cpa"] >= s["base_cpa"] * (1 + CPA_RISE):
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


# The coloured bar down the side of each message (the reference data-viz palette's status colours).
STATUS_COLOR = {CRITICAL: "#d03b3b", WARNING: "#fab219", "good": "#0ca30c"}
STATUS_WORD = {CRITICAL: "Needs action", WARNING: "Worth a look", "good": "On track"}


def _names(xs, keep=3):
    xs = list(xs)
    shown = ", ".join(xs[:keep])
    return shown + (" and %d more" % (len(xs) - keep) if len(xs) > keep else "")


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
    if not items:
        return "*All clear*\nNothing unusual against the last 7 days."
    parts = []
    for lvl in (CRITICAL, WARNING, INFO):
        mine = [t for l, t in items if l == lvl]
        if mine:
            parts.append("*%s*\n" % LEVEL_HEADING[lvl] + "\n".join("\u2022  " + esc(t) for t in mine))
    return "\n\n".join(parts)


def message(s, base_url="", chart_url=""):
    """One account's digest: a header, then a status-coloured card with the figures, a 14-day chart,
    what needs attention, the top campaigns and links. Returns {"text", "blocks", "attachments"}."""
    cur, now, base = s["cur"], s["now"], s["base"]
    b = base or {}
    items = s.get("alert_items") or [(WARNING, t) for t in s.get("alerts") or []]
    st = s.get("status") or status(items)

    def tile(label, value, now_v, base_v, base_text):
        line2 = "*%s*" % value
        d = delta(now_v, base_v)
        if d:
            line2 += "   %s" % d
        text = "%s\n%s" % (label, line2)
        if base_text:
            text += "\n_7-day avg %s_" % base_text
        return {"type": "mrkdwn", "text": text}

    tiles = [
        tile("Spend", money(now["cost"], cur), now["cost"], b.get("cost"), money(b["cost"], cur) if base else ""),
        tile("Conversions", number(now["conversions"]), now["conversions"], b.get("conversions"),
             number(b["conversions"]) if base else ""),
        tile("Cost per conversion", money(s["cpa"], cur) if s["cpa"] else "\u2014", s["cpa"], s["base_cpa"],
             money(s["base_cpa"], cur) if s["base_cpa"] else ""),
        tile("Clicks", number(now["clicks"]), now["clicks"], b.get("clicks"), number(b["clicks"]) if base else ""),
    ]
    if s["roas"] is not None:
        tiles.append(tile("ROAS", "%.2fx" % s["roas"], s["roas"], s["base_roas"],
                          ("%.2fx" % s["base_roas"]) if s["base_roas"] else ""))
    p = s.get("pacing")
    if p:
        text = "Month to date\n*%s*" % money(p["mtd"], p["cur"])
        if p["month_budget"]:
            text += " of %s" % money(p["month_budget"], p["cur"])
        if p["pace"] is not None:
            text += "\n_%d%% of expected pace_" % round(100 * p["pace"])
        tiles.append({"type": "mrkdwn", "text": text})

    card = [
        {"type": "context", "elements": [{"type": "mrkdwn", "text": "*%s*%s%s%scompared with the %d days before" % (
            STATUS_WORD[st], DOT, day_label(s["day"]), DOT, s["base_days"] or BASELINE_DAYS)}]},
        {"type": "section", "fields": tiles[:10]},
    ]
    if chart_url:
        card.append({"type": "image", "image_url": chart_url, "title": {"type": "plain_text", "text": "Last 14 days"},
                     "alt_text": "Daily spend and conversions for %s over the last 14 days" % s["account"][:200]})
    card.append({"type": "divider"})
    card.append({"type": "section", "text": {"type": "mrkdwn", "text": _alert_text(items)[:2900]}})
    if s["top"]:
        lines = ["%d.  %s%s%s%s%s conv." % (i + 1, esc(c["campaign"]), DOT, money(c["cost"], cur), DOT,
                                             number(c["conversions"])) for i, c in enumerate(s["top"])]
        card.append({"type": "section", "text": {"type": "mrkdwn",
                                                  "text": ("*Top campaigns*\n" + "\n".join(lines))[:2900]}})
    if base_url:
        q = "?account=" + quote(s["account"], safe="")
        card.append({"type": "actions", "elements": [
            {"type": "button", "action_id": "open_dashboard", "text": {"type": "plain_text", "text": "Open dashboard"},
             "url": "%s/dashboards/google-ads%s" % (base_url, q)},
            {"type": "button", "action_id": "open_ai_review", "text": {"type": "plain_text", "text": "AI review"},
             "url": "%s/dashboards/google-ads/ai-review%s" % (base_url, q)}]})
    card.append({"type": "context", "elements": [{"type": "mrkdwn", "text":
        "Reply in this thread to ask about %s%sMoney in %s; the latest day can still move slightly as Google "
        "adds late clicks." % (esc(s["account"]), DOT, cur or "the report's currency")}]})

    fallback = "%s: %s, %s. Spend %s, %s conversions" % (
        s["account"], STATUS_WORD[st].lower(), day_label(s["day"]), money(now["cost"], cur), number(now["conversions"]))
    blocks = [{"type": "header", "text": {"type": "plain_text", "text": s["account"][:150]}}]
    return {"text": fallback, "blocks": blocks, "attachments": _attachment(STATUS_COLOR[st], card)}


def overview(summaries, base_url="", today=None):
    """The morning's first message: every account at a glance, grouped by status, most urgent first."""
    order = {CRITICAL: 0, WARNING: 1, "good": 2}
    ss = sorted(summaries, key=lambda s: (order[s["status"]], -s["now"]["cost"]))
    counts = {k: sum(1 for s in ss if s["status"] == k) for k in order}
    worst = next((k for k in order if counts[k]), "good")
    curs = {s["cur"] for s in ss}
    days = sorted({s["day"] for s in ss})
    blocks = [{"type": "header", "text": {"type": "plain_text", "text": "Google Ads daily briefing"}}]
    card = [{"type": "context", "elements": [{"type": "mrkdwn", "text": "%s%s%d account%s%seach account's latest day against its 7-day average" % (
        day_label((today or today_ist()).isoformat()), DOT, len(ss), "" if len(ss) == 1 else "s", DOT)}]}]
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
    fields.append({"type": "mrkdwn", "text": "Accounts\n*%d* need action%s*%d* worth a look%s*%d* on track" % (
        counts[CRITICAL], DOT, counts[WARNING], DOT, counts["good"])})
    card.append({"type": "section", "fields": fields})
    card.append({"type": "divider"})
    for k in order:
        group = [s for s in ss if s["status"] == k]
        if not group:
            continue
        lines = []
        for s in group:
            line = "*%s*%s%s%s%s conv." % (esc(s["account"]), DOT, money(s["now"]["cost"], s["cur"]), DOT,
                                         number(s["now"]["conversions"]))
            if s.get("alerts"):
                line += "\n_%s_" % esc(s["alerts"][0])
            lines.append(line)
        chunk = "*%s*" % STATUS_WORD[k]
        for line in lines:   # Slack allows 3,000 characters per section
            if len(chunk) + len(line) > 2800:
                card.append({"type": "section", "text": {"type": "mrkdwn", "text": chunk}})
                chunk = ""
            chunk += ("\n" if chunk else "") + line
        card.append({"type": "section", "text": {"type": "mrkdwn", "text": chunk}})
    if base_url:
        card.append({"type": "actions", "elements": [
            {"type": "button", "action_id": "open_dashboard_all", "text": {"type": "plain_text", "text": "Open dashboard"},
             "url": "%s/dashboards/google-ads" % base_url}]})
    note = "Each account's briefing follows. Reply under any of them, or mention @Ads Insight, to ask a question."
    if len(days) > 1:
        note += "%sLatest days differ by account (%s to %s)." % (DOT, days[0], days[-1])
    card.append({"type": "context", "elements": [{"type": "mrkdwn", "text": note}]})
    text = "Google Ads daily briefing: %d accounts, %d need action, %d worth a look." % (
        len(ss), counts[CRITICAL], counts[WARNING])
    return {"text": text, "blocks": blocks, "attachments": _attachment(STATUS_COLOR[worst], card[:49])}


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
        chart_url=None):
    """Post the morning overview (with two or more accounts), then each account's digest, in the order given.

    last_posted(key) -> the day last posted for an account (or OVERVIEW), so a retried run never posts
    twice; mark_posted(key, day) records a post; on_thread(account, ts) records which account a posted
    message is about ("" for the overview), so Ads Insight can answer replies under it;
    chart_url(account, day) -> the address of the account's chart image, or "". Returns one result
    per account (and one for the overview, account OVERVIEW):
    {"account", "day", "status": posted | skipped | preview | failed | no_data, "error", "message"}."""
    fx = g.FX(rows)
    today = today or today_ist()
    out, sent = [], [0]
    summaries = []
    for account in accounts:
        s = summarize(rows, account, st, fx, today)
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
        url = chart_url(s["account"], s["day"]) if chart_url else ""
        send(s["account"], s["day"], message(s, base_url, url), s["account"], {"alerts": len(s["alerts"])})
    return out
