"""What needs the account manager today, for one client account: the home's briefing (templates/_account_insights.html).

Nobody has time to open every Paid Marketing agent for every client, so the home reads what each one last found for this
account and keeps what matters: things to fix, things to watch, opportunities, wins and work not yet done. Each insight says
what was seen with its numbers and opens the agent that found it, inside the account, for the detail.

It reads only what is already saved, never Google Ads itself (no quota is spent by opening a home page):
  - the Google Ads campaign report and the Script's insights tabs (spend, conversions, budgets, ads, conversion actions,
    search terms), cut down to the account's own Google Ads accounts;
  - the master doc (the account's goals) and the Pacing Desk (its budget and target cost per conversion this month);
  - the latest AI review of the account;
  - each Paid Marketing agent's last read for the account's own customer ids (Account Audit, Landing Page Check, Experiment
    Tracker, Geo Performance, Audience Segments, Segment Analysis, Ad Strength, Asset Coverage), its QA Agent checks, and its
    Business Research, Keyword Research and Strategy & Campaign Book builds.

Everything here is a pure function of what app.py reads (app._acct_insight_sources), so each source is tested on its own and
a source that fails to read costs only its own insights. An account's briefing never holds another account's data: every
read is keyed by its customer ids, its Google Ads account names or its workspace."""
from __future__ import annotations

import datetime as dt
import logging
import re

log = logging.getLogger(__name__)

# ── The vocabulary ───────────────────────────────────────────────────────────
# tone -> (label on the card, the weight it starts from when insights are ranked)
TONES = {
    "fix": ("Fix now", 400),
    "watch": ("Watch", 300),
    "opportunity": ("Opportunity", 220),
    "todo": ("To do", 120),
    "win": ("Win", 100),
}
TONE_ORDER = ("fix", "watch", "opportunity", "win", "todo")
SEVERITY_BONUS = {"critical": 80, "high": 50, "medium": 20, "low": 0}
# What one briefing holds. Past this it is noise, and each agent's own page has the rest: at most this many of each kind,
# and from any one source at most this many problems (fix, watch), good news (opportunity, win) and to-dos.
TONE_CAP = {"fix": 6, "watch": 4, "opportunity": 4, "win": 2, "todo": 3}
GROUP = {"fix": "problem", "watch": "problem", "opportunity": "good", "win": "good", "todo": "todo"}
PER_SOURCE = {"problem": 3, "good": 2, "todo": 1}
MAX_ITEMS = 15
STALE_DAYS = 30                # an agent last read longer ago than this is a to-do: run it again

# Where each insight comes from: (label, icon in templates/_agent_icons.html). The key is the agent's slug where it is one.
SOURCES = {
    "google-ads": "Google Ads",
    "performance-summarizer": "Performance Summarizer",
    "ai-review": "AI review",
    "pacing-desk": "Pacing Desk",
    "master-doc": "Master doc",
    "account-audit": "Account Audit",
    "landing-page-check": "Landing Page Check",
    "experiment-tracker": "Experiment Tracker",
    "qa-agent": "QA Agent",
    "search-query-analysis": "Search Query Analysis",
    "geo-performance": "Geo Performance",
    "audience-segments": "Audience Segments",
    "segment-analysis": "Segment Analysis",
    "ad-strength": "Ad Strength",
    "asset-coverage": "Asset Coverage",
    "business-research": "Business Research",
    "ppc-keyword-research": "Keyword Research",
    "campaign-book": "Strategy & Campaign Book",
}
# What an insight on a geo, audience or segment report means, by its kind: money going where it does not pay, or room to grow.
LOSING_KINDS = {"exclude", "trim", "waste", "costly", "lower", "leak"}
GROWING_KINDS = {"push", "best", "raise"}


def href(slug, source, doc_url=""):
    """The page that holds the detail, inside the account where the page is one of its own."""
    if source == "google-ads":
        return "/%s/google-ads" % slug
    if source == "ai-review":
        return "/%s/google-ads/ai-review" % slug
    if source == "pacing-desk":
        return "/operational-agents/pacing-desk"      # one desk for every client, staff only
    if source == "master-doc":
        return doc_url or ""
    return "/%s/operational-agents/%s" % (slug, source)


def _money(money, v, cur):
    return money(v, cur) if v is not None else "—"


def _pct(v):
    return "%d%%" % round(abs(v))


def _days_since(at, now):
    t = _when(at)
    if t is None:
        return None
    return max(0, (now - t).days)


def _when(at):
    """A datetime (UTC) from a datetime, a date or ISO text; None when it is none of them."""
    if not at:
        return None
    if isinstance(at, dt.datetime):
        t = at
    elif isinstance(at, dt.date):
        t = dt.datetime(at.year, at.month, at.day)
    else:
        try:
            t = dt.datetime.fromisoformat(str(at).replace("Z", "+00:00"))
        except ValueError:
            return None
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def ago(at, now=None):
    """"today", "yesterday", "3 days ago", "5 Oct": how fresh what an insight read is."""
    t = _when(at)
    if t is None:
        return ""
    now = now or dt.datetime.now(dt.timezone.utc)
    days = (now.date() - t.astimezone(dt.timezone.utc).date()).days
    if days <= 0:
        return "today"
    if days == 1:
        return "yesterday"
    if days < 7:
        return "%d days ago" % days
    return "%d %s" % (t.day, t.strftime("%b"))


def item(source, tone, title, detail="", *, stat="", stat_label="", severity="", impact=0.0, at=None, key=""):
    """One insight. `impact` is the share of the account's spend it is about (0 to 1), so a problem with half the money
    outranks the same problem with a sliver of it."""
    base = TONES[tone][1] + SEVERITY_BONUS.get(severity, 0) + 60 * max(0.0, min(1.0, impact or 0.0))
    return {"key": key or "%s:%s" % (source, re.sub(r"\W+", "-", title.lower())[:60]), "source": source, "tone": tone,
            "title": title.strip(), "detail": (detail or "").strip(), "stat": stat, "stat_label": stat_label,
            "severity": severity, "weight": round(base, 2), "at": at}


# ── Google Ads: the campaign report (last 30 days) ──────────────────────────
def performance(st, money, *, min_conv=3):
    """The account's week against the week before, campaigns spending with nothing back, and the campaign that converts
    best (client_accounts.stats)."""
    if not st:
        return []
    out, cur, d = [], st["currency"], st.get("delta") or {}
    daily = st.get("daily") or []
    at = st.get("to")
    week = lambda k: sum(x.get(k) or 0 for x in daily[-7:])           # noqa: E731
    prev = lambda k: sum(x.get(k) or 0 for x in daily[-14:-7])         # noqa: E731
    cost7, conv7, costp, convp = week("cost"), week("conv"), prev("cost"), prev("conv")
    cpa7 = cost7 / conv7 if conv7 else None
    cpap = costp / convp if convp else None

    # Spend stopped: money went out earlier in the month and nothing the last three days.
    if len(daily) >= 10 and sum(x["cost"] for x in daily[-3:]) == 0 and sum(x["cost"] for x in daily[:-3]) > 0:
        last_spend = next((x["day"] for x in reversed(daily) if x["cost"] > 0), "")
        out.append(item("performance-summarizer", "fix", "No spend since %s" % _short_day(last_spend),
                        "Every campaign has stopped serving. Check billing, budgets and approvals before more days go by.",
                        stat="%s" % _money(money, 0, cur), stat_label="spent in the last 3 days", severity="critical",
                        impact=1.0, at=at, key="perf:stopped"))

    if d.get("cpa") is not None and convp >= min_conv and cpa7 is not None and cpap:
        if d["cpa"] >= 25:
            loud = d["cpa"] >= 50 and convp >= 10          # a jump on a handful of conversions is worth a look, not an alarm
            out.append(item("performance-summarizer", "fix" if loud else "watch",
                            "Cost per conversion up %s this week" % _pct(d["cpa"]),
                            "%s a conversion over the last 7 days against %s the week before, on %s of spend."
                            % (money(cpa7, cur), money(cpap, cur), money(cost7, cur)),
                            stat=money(cpa7, cur), stat_label="from %s" % money(cpap, cur),
                            severity="high" if loud else "medium", impact=0.6, at=at, key="perf:cpa-up"))
        elif d["cpa"] <= -20:
            out.append(item("performance-summarizer", "win", "Cost per conversion down %s this week" % _pct(d["cpa"]),
                            "%s a conversion over the last 7 days, from %s the week before." % (money(cpa7, cur), money(cpap, cur)),
                            stat=money(cpa7, cur), stat_label="from %s" % money(cpap, cur), impact=0.4, at=at,
                            key="perf:cpa-down"))
    if d.get("conv") is not None and convp >= 5:
        if d["conv"] <= -30:
            out.append(item("performance-summarizer", "fix" if convp >= 10 else "watch", "Conversions down %s on last week" % _pct(d["conv"]),
                            "%s conversions in the last 7 days against %s the week before, while spend went %s."
                            % (_n(conv7), _n(convp), _direction(d.get("cost"))),
                            stat=_n(conv7), stat_label="from %s" % _n(convp), severity="high" if convp >= 10 else "medium",
                            impact=0.7, at=at, key="perf:conv-down"))
        elif d["conv"] >= 30:
            out.append(item("performance-summarizer", "win", "Conversions up %s on last week" % _pct(d["conv"]),
                            "%s conversions in the last 7 days against %s the week before." % (_n(conv7), _n(convp)),
                            stat=_n(conv7), stat_label="from %s" % _n(convp), impact=0.5, at=at, key="perf:conv-up"))
    if d.get("cost") is not None and d["cost"] >= 40 and (d.get("conv") or 0) < 10 and costp > 0:
        out.append(item("performance-summarizer", "watch", "Spend up %s with no more conversions" % _pct(d["cost"]),
                        "%s spent in the last 7 days against %s the week before; conversions went %s."
                        % (money(cost7, cur), money(costp, cur), _direction(d.get("conv"))),
                        stat=money(cost7, cur), stat_label="this week", severity="medium", impact=0.5, at=at,
                        key="perf:spend-up"))

    # Campaigns that spent real money and brought nothing back in 30 days.
    total = st.get("cost") or 0
    dry = [c for c in st.get("campaigns") or [] if c["cost"] > 0 and not c["conv"] and c["share"] >= 0.05]
    for c in dry[:2]:
        out.append(item("performance-summarizer", "fix", "%s spent %s with no conversions" % (c["name"], money(c["cost"], cur)),
                        "%s of the account's spend in the last 30 days, and not one conversion. Check its targeting, search "
                        "terms and landing page, or pause it." % _pct(100 * c["share"]),
                        stat=money(c["cost"], cur), stat_label="0 conversions in 30 days", severity="high",
                        impact=c["share"], at=at, key="perf:dry:" + c["name"]))
    if len(dry) > 2:
        rest = dry[2:]
        out.append(item("performance-summarizer", "watch", "%d more campaigns spent with no conversions" % len(rest),
                        ", ".join(c["name"] for c in rest[:4]) + (" and more" if len(rest) > 4 else "") + ".",
                        stat=money(sum(c["cost"] for c in rest), cur), stat_label="between them", impact=sum(c["share"] for c in rest),
                        at=at, key="perf:dry-rest"))

    # The campaign that converts best, when it is well below the account's cost per conversion.
    cpa = st.get("cpa")
    good = [c for c in st.get("campaigns") or [] if c["conv"] >= 5 and c["share"] >= 0.1 and c["cpa"] is not None]
    if cpa and good:
        best = min(good, key=lambda c: c["cpa"])
        if best["cpa"] <= 0.7 * cpa and len(st.get("campaigns") or []) > 1:
            out.append(item("performance-summarizer", "opportunity",
                            "%s converts %s cheaper than the account" % (best["name"], _pct(100 * (1 - best["cpa"] / cpa))),
                            "%s a conversion against %s for the account, on %s of its spend. It may deserve more of the budget."
                            % (money(best["cpa"], cur), money(cpa, cur), _pct(100 * best["share"])),
                            stat=money(best["cpa"], cur), stat_label="a conversion", impact=best["share"], at=at,
                            key="perf:best:" + best["name"]))
    return out


def _n(v):
    v = float(v or 0)
    return ("%.1f" % v).rstrip("0").rstrip(".") if abs(v - round(v)) > 1e-9 else "{:,}".format(int(round(v)))


def _direction(p):
    if p is None or abs(p) < 5:
        return "flat"
    return "up %s" % _pct(p) if p > 0 else "down %s" % _pct(p)


def _short_day(day):
    t = _when(day)
    return "%d %s" % (t.day, t.strftime("%b")) if t else "a while"


# ── Google Ads: the Script's insights tabs ───────────────────────────────────
def script_insights(ins, names, money, total_cost=0.0):
    """Budgets, ads, conversion tracking and search terms from google_ads_insights.view, for the account's own Google Ads
    accounts (`names`)."""
    if not ins:
        return []
    names = set(names)
    out = []
    at = ins.get("as_of") or None
    # Campaigns losing impressions to their budget (last 7 days).
    limited = [(k.split("\u0001", 1)[1], v) for k, v in (ins.get("budget_limited") or {}).items()
               if k.split("\u0001", 1)[0] in names]
    if limited:
        limited.sort(key=lambda x: -x[1])
        worst = limited[0]
        out.append(item("google-ads", "opportunity",
                        "%s lose%s impressions to budget" % (worst[0] if len(limited) == 1 else "%d campaigns" % len(limited),
                                                            "s" if len(limited) == 1 else ""),
                        "%s misses %s of the searches it could show on because its budget runs out%s. If it converts well, "
                        "more budget buys more of the same." % (worst[0], _pct(100 * worst[1]),
                                                               "" if len(limited) == 1 else "; " + ", ".join(n for n, _ in limited[1:4])
                                                               + " too"),
                        stat=_pct(100 * worst[1]), stat_label="impressions lost to budget", impact=0.4, at=at,
                        key="ins:limited"))
    # Budgets that will hit Google's monthly cap or run far over pace.
    for b in ins.get("budgets") or []:
        if b.get("account") not in names:
            continue
        if b.get("verdict") == "capped":
            out.append(item("google-ads", "watch", "%s will hit Google's monthly limit" % b["name"],
                            "On course to spend %s this month; Google charges at most %s on this daily budget."
                            % (money(b.get("projected"), b.get("cur")), money(b.get("monthly_cap"), b.get("cur"))),
                            stat=money(b.get("projected"), b.get("cur")), stat_label="projected this month", severity="medium",
                            impact=0.3, at=at, key="ins:capped:" + b["name"]))
    # Ads: disapproved, limited, weak.
    t = (ins.get("ads") or {}).get("totals") or {}
    dis = sum((t.get(n) or {}).get("disapproved", 0) for n in names)
    if dis:
        out.append(item("ad-strength", "fix", "%d ad%s disapproved" % (dis, "" if dis == 1 else "s"),
                        "Disapproved ads cannot run until they are fixed or appealed.", stat=str(dis),
                        stat_label="disapproved", severity="critical" if dis >= 3 else "high", impact=0.3, at=at,
                        key="ins:disapproved"))
    strengths = {}
    for n in names:
        for s, v in ((t.get(n) or {}).get("strength") or {}).items():
            strengths[s] = strengths.get(s, 0.0) + (v.get("cost") or 0)
    rated = sum(strengths.values())
    weak = strengths.get("POOR", 0) + strengths.get("AVERAGE", 0)
    if rated and weak / rated >= 0.3:
        out.append(item("ad-strength", "watch", "%s of ad spend is on Poor or Average ads" % _pct(100 * weak / rated),
                        "Ads Google rates below Good show less often and cost more a click. More unique headlines and "
                        "descriptions lift the rating.", stat=_pct(100 * weak / rated), stat_label="of ad spend below Good",
                        severity="medium", impact=weak / rated * 0.6, at=at, key="ins:weak-ads"))
    # Conversion tracking: a primary action that recorded nothing is a broken tag, and bidding is flying blind.
    silent = [a for a in ins.get("actions") or [] if a.get("account") in names
              and any(f[1].startswith("Primary, but recorded no conversions") for f in a.get("flags") or [])]
    if silent:
        one = len(silent) == 1
        out.append(item("account-audit", "fix", "%s recorded no conversions in 30 days" %
                        ("\u201c%s\u201d" % silent[0]["name"] if one else "%d primary conversion actions" % len(silent)),
                        "%s primary, so Smart Bidding optimises for %s. Check the tag still fires on the site."
                        % ("It is" if one else "They are", "it" if one else "them"),
                        stat="0" if one else str(len(silent)), stat_label="conversions in 30 days" if one else "silent primary actions",
                        severity="critical", impact=0.8, at=at, key="ins:silent-actions"))
    soft = [a for a in ins.get("actions") or [] if a.get("account") in names
            and any("is primary, so bidding optimises" in f[1] for f in a.get("flags") or [])]
    if soft:
        out.append(item("account-audit", "watch", "Bidding optimises for %s" % ("\u201c%s\u201d" % soft[0]["name"] if len(soft) == 1 else
                                                                             "%d soft conversion actions" % len(soft)),
                        "A page view or similar action is primary, so Smart Bidding chases it as if it were a lead or sale.",
                        stat=str(len(soft)), stat_label="soft primary action%s" % ("" if len(soft) == 1 else "s"),
                        severity="high", impact=0.5, at=at, key="ins:soft-actions"))
    # Search terms that spent without converting.
    terms = (ins.get("terms") or {}).get("totals") or {}
    wasted = sum((terms.get(n) or {}).get("wasted", 0) for n in names)
    spent = sum((terms.get(n) or {}).get("cost", 0) for n in names)
    cur = next(((terms.get(n) or {}).get("cur") for n in names if terms.get(n)), "")
    n_terms = sum((terms.get(n) or {}).get("wasted_terms", 0) for n in names)
    if spent and wasted / spent >= 0.15:
        out.append(item("search-query-analysis", "fix" if wasted / spent >= 0.3 else "watch",
                        "%s of search-term spend brought no conversion" % _pct(100 * wasted / spent),
                        "%s on %s search terms that never converted. Review them and add the irrelevant ones as negatives."
                        % (money(wasted, cur), "{:,}".format(n_terms)),
                        stat=money(wasted, cur), stat_label="on non-converting terms",
                        severity="high" if wasted / spent >= 0.3 else "medium", impact=wasted / spent, at=at,
                        key="ins:wasted-terms"))
    return out


# ── The master doc and the Pacing Desk: what the account is meant to spend and pay ─────────────────────
def month_to_date(rows, names, last_day):
    """(spend this month up to `last_day`, currency) from the campaign report, in the currency client_accounts.stats uses."""
    names = set(names)
    first = last_day[:8] + "01"
    mine = [r for r in rows if r.get("account") in names and first <= (r.get("day") or "") <= last_day]
    own = {r.get("currency_native") or "" for r in mine}
    native = len(own) == 1 and "" not in own
    cost = sum(float((r.get("cost_native") if native else r.get("cost")) or 0) for r in mine)
    return cost, (next(iter(own)) if native else "")


def _keys(name):
    """The forms of a name that count as the same account: whole, and without a "(...)" tag, letters and digits only."""
    whole = re.sub(r"[^a-z0-9]", "", str(name or "").casefold())
    bare = re.sub(r"[^a-z0-9]", "", re.sub(r"\([^)]*\)", "", str(name or "")).casefold())
    return {k for k in (whole, bare) if k}


def plan_rows(saved, names):
    """The Pacing Desk's Google rows this month for the account: those naming one of its accounts (`names`: its Google Ads
    account names, its own name and the names the team uses), else those of a client by one of those names."""
    keys = set().union(*(_keys(n) for n in names)) if names else set()
    google = [r for r in saved or [] if (r.get("channel") or "Google") == "Google"]
    return [r for r in google if _keys(r.get("account")) & keys] or [r for r in google if _keys(r.get("client")) & keys]


def targets(plan, st, mtd, money, *, profile_goals=""):
    """The month's budget and target cost per conversion (the Pacing Desk's rows for the account) against what is being
    spent and paid; a to-do when the account has no budget this month. `plan` None: the Pacing Desk could not be read."""
    out = []
    if not st:
        return out
    cur, last = st["currency"], st["to"]
    d = dt.date.fromisoformat(last)
    month = d.strftime("%B")
    dim = (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
    allocated = sum(float(r.get("allocated") or 0) for r in plan or [])
    if allocated:
        projected = mtd / d.day * dim.day
        pace = mtd / (allocated * d.day / dim.day)
        if pace >= 1.15:
            out.append(item("pacing-desk", "fix" if pace >= 1.3 else "watch",
                            "On course to overspend %s's budget by %s" % (month, money(projected - allocated, cur)),
                            "%s spent by %s against %s planned by now; at this rate the month ends at %s of %s."
                            % (money(mtd, cur), _short_day(last), money(allocated * d.day / dim.day, cur),
                               money(projected, cur), money(allocated, cur)),
                            stat=money(projected, cur), stat_label="projected of %s" % money(allocated, cur),
                            severity="high" if pace >= 1.3 else "medium", impact=0.8, at=last, key="pace:over"))
        elif pace <= 0.85 and d.day >= 5:
            out.append(item("pacing-desk", "watch" if pace > 0.7 else "fix",
                            "On course to underspend %s's budget by %s" % (month, money(allocated - projected, cur)),
                            "%s spent by %s against %s planned by now; the client's budget is not being used."
                            % (money(mtd, cur), _short_day(last), money(allocated * d.day / dim.day, cur)),
                            stat=money(projected, cur), stat_label="projected of %s" % money(allocated, cur),
                            severity="medium", impact=0.6, at=last, key="pace:under"))
        else:
            out.append(item("pacing-desk", "win", "%s's budget is on pace" % month,
                            "%s spent by %s, within 15%% of the %s planned by now." % (money(mtd, cur), _short_day(last),
                                                                                       money(allocated * d.day / dim.day, cur)),
                            stat=money(mtd, cur), stat_label="of %s" % money(allocated, cur), at=last, key="pace:on"))
    elif plan is not None:
        out.append(item("pacing-desk", "todo", "No budget set for %s in the Pacing Desk" % month,
                        "Without one, nobody is warned when the account over- or underspends. Add the client's agreed budget "
                        "and target cost per conversion.", key="pace:none"))
    target = next((float(r["targetCpa"]) for r in plan or [] if r.get("targetCpa")), None)
    cpa = st.get("cpa")
    if target and cpa and st.get("conv", 0) >= 3:
        if cpa >= 1.2 * target:
            out.append(item("pacing-desk", "fix", "Cost per conversion %s over target" % _pct(100 * (cpa / target - 1)),
                            "%s a conversion over the last 30 days against the %s target." % (money(cpa, cur), money(target, cur)),
                            stat=money(cpa, cur), stat_label="target %s" % money(target, cur), severity="high", impact=0.9,
                            at=last, key="target:cpa-over"))
        elif cpa <= target:
            out.append(item("pacing-desk", "win", "Beating the %s target cost per conversion" % money(target, cur),
                            "%s a conversion over the last 30 days, %s under target." % (money(cpa, cur), _pct(100 * (1 - cpa / target))),
                            stat=money(cpa, cur), stat_label="target %s" % money(target, cur), at=last, key="target:cpa-met"))
    if not (profile_goals or "").strip() and not target:
        out.append(item("master-doc", "todo", "No goals in the master doc",
                        "The AI review and these insights judge the account against its goals. Add what the client wants "
                        "(leads, sales, a cost per lead) to its tab.", key="doc:goals"))
    return out


# ── The AI review ────────────────────────────────────────────────────────────
def review(row, report, now):
    """The latest AI review: how the account stands against its goals, its first actions and the goals off track. A to-do
    when there is none, or it is old."""
    if not row or row.get("status") != "complete" or not report:
        return [item("ai-review", "todo", "No AI review yet" if not row else "The AI review did not finish",
                     "Claude reads every campaign against the account's goals in the master doc: what works, what does not and "
                     "what to do next.", key="review:none")]
    out, at = [], row.get("finished_at") or row.get("created_at")
    age = _days_since(at, now)
    overall = report.get("overall")
    card = report.get("scorecard") or []
    off = [s for s in card if s.get("status") in ("off_track", "at_risk")]
    if overall in ("off_track", "needs_attention") and report.get("headline"):
        out.append(item("ai-review", "fix" if overall == "off_track" else "watch", report["headline"],
                        "The AI review judges the account %s against its goals in the master doc."
                        % ("off track" if overall == "off_track" else "in need of attention"),
                        stat="%d of %d" % (len(off), len(card)) if card else ("Off track" if overall == "off_track" else "At risk"),
                        stat_label="goals off track or at risk" if card else "overall verdict",
                        severity="high" if overall == "off_track" else "medium", impact=0.7, at=at, key="review:overall"))
    for s in report.get("scorecard") or []:
        if s.get("status") == "off_track":
            out.append(item("ai-review", "fix", "%s is off target" % s.get("objective", "A goal"),
                            "Target %s, actual %s. %s" % (s.get("target", "?"), s.get("actual", "?"), s.get("evidence", "")),
                            stat=str(s.get("actual") or ""), stat_label="target %s" % s.get("target", "?"), severity="high",
                            impact=0.6, at=at, key="review:goal:" + str(s.get("objective"))))
    met = [s for s in report.get("scorecard") or [] if s.get("status") == "met"]
    if met:
        out.append(item("ai-review", "win", "%d goal%s met" % (len(met), "" if len(met) == 1 else "s"),
                        "; ".join("%s: %s against %s" % (s.get("objective"), s.get("actual"), s.get("target")) for s in met[:3]),
                        stat="%d of %d" % (len(met), len(report.get("scorecard") or [])), stat_label="goals met", at=at,
                        key="review:met"))
    for a in [a for a in report.get("actions") or [] if a.get("priority") == "P1"][:2]:
        out.append(item("ai-review", "fix" if overall == "off_track" else "watch", a.get("title", "An action"),
                        a.get("what_to_do") or a.get("why") or "", stat="P1", stat_label=(a.get("expected_impact") or "")[:60],
                        severity="high", impact=0.5, at=at, key="review:action:" + str(a.get("title"))))
    if age is not None and age > STALE_DAYS:
        out.append(item("ai-review", "todo", "The AI review is %d days old" % age,
                        "Run it again so the account is judged on this month's campaigns.", at=at, key="review:stale"))
    return out


# ── The Paid Marketing agents' last reads ────────────────────────────────────
def audit(report, at, now):
    """Account Audit (paid_audit.assemble): the grade, and the most severe checks it failed."""
    if not report:
        return [item("account-audit", "todo", "No Account Audit yet",
                     "A scored check of the whole account: tracking, structure, bidding, keywords, ads and settings.",
                     key="audit:none")]
    out, s = [], report.get("summary") or {}
    fails = [f for f in report.get("fixFirst") or [] if f.get("severity") in ("critical", "high")]
    for f in fails[:2]:
        out.append(item("account-audit", "fix" if f.get("result") == "fail" else "watch", f.get("title", "A check failed"),
                        f.get("found") or f.get("why") or "", stat="Grade %s" % s.get("grade", "?") if s.get("grade") else "",
                        stat_label="score %s" % s.get("score") if s.get("score") is not None else "",
                        severity=f.get("severity", ""), impact=0.5, at=at, key="audit:" + str(f.get("id"))))
    if not fails and s.get("grade") in ("A", "B"):
        out.append(item("account-audit", "win", "The Account Audit grades the account %s" % s["grade"],
                        "No critical or high-severity check failed.", stat="Grade %s" % s["grade"],
                        stat_label="score %s" % s.get("score"), at=at, key="audit:good"))
    age = _days_since(at, now)
    if age is not None and age > STALE_DAYS:
        out.append(item("account-audit", "todo", "The Account Audit is %d days old" % age, "Run it again to check this month's setup.",
                        at=at, key="audit:stale"))
    return out


def landing_pages(report, at, catalog_title=None):
    """Landing Page Check (paid_lp.assemble): spend on pages that put it at risk, and the worst page check."""
    if not report:
        return []
    out, s = [], report.get("summary") or {}
    catalog = report.get("catalog") or {}
    risk, pages = s.get("spendAtRisk") or 0, s.get("pagesAtRisk") or 0
    if pages:
        out.append(item("landing-page-check", "fix" if (s.get("critical") or 0) else "watch",
                        "%d landing page%s put spend at risk" % (pages, "" if pages == 1 else "s"),
                        "Pages that are slow, broken or do not match their ads lose the clicks already paid for.",
                        stat="${:,.0f}".format(risk) if risk else str(pages), stat_label="of spend at risk" if risk else "pages at risk",
                        severity="critical" if (s.get("critical") or 0) else "high", impact=0.6, at=at, key="lp:risk"))
    for f in [f for f in report.get("fixFirst") or [] if f.get("severity") == "critical"][:1]:
        title = (catalog.get(f.get("id")) or {}).get("title") or (catalog_title(f.get("id")) if catalog_title else "") or "A page check failed"
        out.append(item("landing-page-check", "fix", title, f.get("found") or "", stat="%d page%s" % (len(f.get("pages") or []),
                        "" if len(f.get("pages") or []) == 1 else "s"), stat_label="affected", severity="critical", impact=0.5,
                        at=at, key="lp:" + str(f.get("id"))))
    if not out and s.get("grade") in ("A", "B"):
        out.append(item("landing-page-check", "win", "Landing pages grade %s" % s["grade"], "No page puts spend at risk.",
                        stat="Grade %s" % s["grade"], stat_label="landing pages", at=at, key="lp:good"))
    return out


def experiments(report, at):
    """Experiment Tracker (paid_exp.assemble): tests with a winner to apply, and tests that need a decision."""
    if not report:
        return []
    out = []
    tones = {"apply": "opportunity", "decide": "watch", "end": "watch", "pause": "fix", "stuck": "watch", "check": "watch"}
    for n in (report.get("needs") or [])[:3]:
        out.append(item("experiment-tracker", tones.get(n.get("kind"), "watch"), n.get("title") or "A test needs you",
                        n.get("text") or "", stat=n.get("label") or n.get("kind", "").capitalize(), stat_label="next step",
                        severity="medium", at=at, key="exp:%s:%s" % (n.get("kind"), n.get("ref"))))
    s = report.get("summary") or {}
    if s.get("winners") and not any(n.get("kind") == "apply" for n in report.get("needs") or []):
        out.append(item("experiment-tracker", "win", "%d test%s found a winner" % (s["winners"], "" if s["winners"] == 1 else "s"),
                        "A variant beat the original with confidence.", stat=str(s["winners"]), stat_label="winning tests", at=at,
                        key="exp:winners"))
    return out


def qa(launches):
    """QA Agent: campaigns going live with checks that fail, or not yet checked. `launches` are paid_qa.payload()s, newest first."""
    out = []
    for p in launches[:5]:
        s, launch = p.get("summary") or {}, p.get("launch") or {}
        code = (s.get("verdict") or {}).get("code")
        name = launch.get("campaign_name") or launch.get("campaignName") or "a campaign"
        at = launch.get("updated_at") or launch.get("updatedAt") or launch.get("created_at") or launch.get("createdAt")
        if code == "not_ready":
            n = len(s.get("failedBlocking") or [])
            out.append(item("qa-agent", "fix", "%s is not ready to launch" % name,
                            "%d required check%s failed in its QC." % (n, "" if n == 1 else "s"), stat=str(n),
                            stat_label="checks failed", severity="high", impact=0.4, at=at, key="qa:" + str(launch.get("id"))))
        elif code == "incomplete":
            out.append(item("qa-agent", "todo", "Finish the QC of %s" % name,
                            "%s%% of its checks are done." % s.get("percent", 0), stat="%s%%" % s.get("percent", 0),
                            stat_label="checked", at=at, key="qa:" + str(launch.get("id"))))
    return out


def report_insights(source, insights, at, money_share=None):
    """Geo Performance, Audience Segments and Segment Analysis: their own insights marked `action`, as money that is
    being lost (an exclusion, a trim) or room to grow (a place or audience to push)."""
    out = []
    for i in [i for i in insights or [] if i.get("severity") == "action"][:3]:
        kind = i.get("kind") or ""
        tone = "fix" if kind in LOSING_KINDS else "opportunity" if kind in GROWING_KINDS else "watch"
        detail = " ".join(x for x in (i.get("evidence"), i.get("action")) if x)
        out.append(item(source, tone, i.get("headline") or "An insight", detail, stat=_pct(100 * i["spendShare"]) if i.get("spendShare") else "",
                        stat_label="of spend" if i.get("spendShare") else "", severity="medium",
                        impact=i.get("spendShare") or 0.3, at=at, key="%s:%s:%s" % (source, kind, i.get("id") or i.get("headline"))))
    return out


def ad_strength(report, at):
    """Ad Strength: how many ads Google rates below Good, and how many impressions they take."""
    s = (report or {}).get("summary") or {}
    if not s.get("reviewed"):
        return []
    share = (s.get("impressionsBelowGood") or 0) / s["impressions"] if s.get("impressions") else 0
    if s.get("belowGood"):
        return [item("ad-strength", "watch" if share < 0.5 else "fix",
                     "%d of %d ads rated below Good" % (s["belowGood"], s["reviewed"]),
                     "%d Poor and %d Average; they take %s of impressions. Each has its own list of what to add."
                     % (s.get("poor", 0), s.get("average", 0), _pct(100 * share)),
                     stat=_pct(100 * share), stat_label="of impressions below Good", severity="medium", impact=share * 0.6, at=at,
                     key="adstrength:below")]
    return [item("ad-strength", "win", "Every ad is rated Good or better", "%d ads reviewed." % s["reviewed"],
                 stat=str(s["reviewed"]), stat_label="ads Good or Excellent", at=at, key="adstrength:good")]


def assets(report, at):
    """Asset Coverage: disapproved assets, and campaigns missing the assets Google needs to show them well."""
    s = (report or {}).get("summary") or {}
    if not s.get("campaigns"):
        return []
    out = []
    if s.get("disapprovedAssets"):
        out.append(item("asset-coverage", "fix", "%d asset%s disapproved" % (s["disapprovedAssets"], "" if s["disapprovedAssets"] == 1 else "s"),
                        "Disapproved sitelinks, images or callouts do not show. Fix or replace them.", stat=str(s["disapprovedAssets"]),
                        stat_label="disapproved", severity="high", impact=0.3, at=at, key="assets:disapproved"))
    high = (s.get("gaps") or {}).get("high") or 0
    if high:
        out.append(item("asset-coverage", "watch", "%d campaign%s missing key assets" % (s.get("withGaps") or high, "" if (s.get("withGaps") or high) == 1 else "s"),
                        "%d high-priority gaps: sitelinks, callouts, images or logos Google needs to show the ads at full size." % high,
                        stat=str(high), stat_label="high-priority gaps", severity="medium", impact=0.3, at=at, key="assets:gaps"))
    return out


def builds(kind, rec):
    """The latest finished Business Research, Keyword Research or Strategy & Campaign Book build for the account."""
    if not rec or rec.get("status") != "done":
        return []
    plan, at, out = rec.get("plan") or {}, rec.get("updated_at") or rec.get("created_at"), []
    if kind == "keywords":
        for w in ((plan.get("plan") or {}).get("quickWins") or [])[:2]:
            out.append(item("ppc-keyword-research", "opportunity", w.get("what") or "A quick win", w.get("why") or "",
                            stat="Quick win", stat_label="from keyword research", impact=0.2, at=at, key="kw:" + str(w.get("what"))))
    elif kind == "business":
        imp = plan.get("implications") or {}
        for q in [q for q in imp.get("questions") or [] if str(q.get("urgency", "")).lower() in ("high", "urgent")][:2]:
            out.append(item("business-research", "todo", q.get("question") or "A question for the client", q.get("why") or "",
                            stat=q.get("area") or "", stat_label="ask the client", at=at, key="biz:" + str(q.get("question"))))
        for a in (imp.get("advertiseFirst") or [])[:1]:
            text = a if isinstance(a, str) else (a.get("what") or a.get("title") or "")
            if text:
                out.append(item("business-research", "opportunity", "Advertise first: " + text,
                                "" if isinstance(a, str) else (a.get("why") or ""), stat="Lead with", stat_label="from the research",
                                impact=0.2, at=at, key="biz:first"))
    else:
        strategy = plan.get("strategy") or {}
        for r in (strategy.get("risks") or [])[:1]:
            text = r if isinstance(r, str) else (r.get("risk") or r.get("title") or "")
            if text:
                out.append(item("campaign-book", "watch", text, "" if isinstance(r, str) else (r.get("mitigation") or ""),
                                stat="Risk", stat_label="in the campaign book", at=at, key="book:risk"))
    return out


# ── Putting it together ──────────────────────────────────────────────────────
def rank(items):
    """Most important first, one of each key, within TONE_CAP, PER_SOURCE and MAX_ITEMS. However much is wrong, every kind
    found keeps at least one place: the day is never only alarms."""
    seen, per, kinds, out = set(), {}, {}, []
    for it in sorted(items, key=lambda i: (-i["weight"], i["title"])):
        group = (it["source"], GROUP[it["tone"]])
        if it["key"] in seen or per.get(group, 0) >= PER_SOURCE[group[1]] or kinds.get(it["tone"], 0) >= TONE_CAP[it["tone"]]:
            continue
        seen.add(it["key"])
        per[group] = per.get(group, 0) + 1
        kinds[it["tone"]] = kinds.get(it["tone"], 0) + 1
        out.append(it)
    while len(out) > MAX_ITEMS:
        drop = next(i for i in reversed(out) if kinds[i["tone"]] > 1)
        kinds[drop["tone"]] -= 1
        out.remove(drop)
    return out


def finish(slug, items, reads, *, doc_url="", now=None):
    """The briefing the template draws: insights ranked and linked, counts by tone, and what was read."""
    now = now or dt.datetime.now(dt.timezone.utc)
    ranked = []
    for it in rank(items):
        link = href(slug, it["source"], doc_url)
        ranked.append(dict(it, href=link, external=it["source"] == "master-doc", label=TONES[it["tone"]][0],
                           source_label=SOURCES.get(it["source"], it["source"]), when=ago(it.get("at"), now),
                           at=_iso(it.get("at"))))
    counts = {t: sum(1 for i in ranked if i["tone"] == t) for t in TONE_ORDER}
    by_source = {}                                  # by the read each came from, for the source chips
    for i in ranked:
        by_source[i.get("via", i["source"])] = by_source.get(i.get("via", i["source"]), 0) + 1
    read = [dict(r, n=by_source.get(r["key"], 0), label=SOURCES.get(r["key"], r["key"])) for r in reads]
    return {"items": ranked, "counts": counts, "total": len(ranked), "read": read,
            "read_ok": sum(1 for r in reads if r.get("ok")), "at": now.isoformat(timespec="seconds"),
            "headline": headline(counts)}


def headline(counts):
    """"3 things to fix, 2 opportunities and a win." -- the briefing in one line (numbers marked for the template)."""
    parts = []
    for tone, one, many in (("fix", "thing to fix now", "things to fix now"), ("watch", "to watch", "to watch"),
                            ("opportunity", "opportunity", "opportunities"), ("win", "win", "wins"),
                            ("todo", "thing to do", "things to do")):
        n = counts.get(tone, 0)
        if n:
            parts.append({"n": n, "text": one if n == 1 else many, "tone": tone})
    return parts


def _iso(at):
    t = _when(at)
    return t.isoformat(timespec="seconds") if t else ""


def gather(acct, sources, *, money, doc_url="", now=None):
    """Every source read for the account, each on its own: one that fails costs only its insights. `sources` maps a
    source key to a function returning (insights, read-at); see app._acct_insight_sources."""
    now = now or dt.datetime.now(dt.timezone.utc)
    items, reads = [], []
    for key, fn in sources.items():
        try:
            got, at = fn()
            items += [dict(i, via=key) for i in got]
            reads.append({"key": key, "ok": True, "at": _iso(at)})
        except Exception:                               # noqa: BLE001 (one unreadable source never costs the briefing)
            log.warning("account insights: %s unreadable for one account", key, exc_info=True)
            reads.append({"key": key, "ok": False, "at": ""})
    return finish(acct["slug"], items, reads, doc_url=doc_url, now=now)
