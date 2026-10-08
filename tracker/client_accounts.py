"""Client accounts: every client the agency runs, each with its own space at /<url name>.

Where the list comes from
  - The Google Ads campaign report: every account in it (name and customer ID), by spend.
  - The master doc (the AI review's running Google Doc, tracker/gads_ai_doc.py): each account's
    tab, and its profile block (tracker/client_profile.py). A tab joins the Google Ads account it
    names (its title, or the Google Ads ID in its profile; one tab may name several Google Ads
    accounts, for a client with more than one). A tab that names no Google Ads account becomes an
    account of its own when its profile identifies one (a website, a URL name, an industry...), so a
    client with no Google Ads (SEO only, say) is listed too. General, Sample and Template tabs are not
    accounts.

Each account gets a key that does not change when it is renamed ("cid:" and its lowest customer
ID, or "doc:" and its tab's name), and a URL name (slug): the profile's "URL name", else the
account's name, made URL-safe. tracker/client_accounts_store.py keeps every slug ever given, so a
renamed account's old link keeps working (301) and a slug is never handed to a different client.
"""

from __future__ import annotations

import hashlib
import re
from datetime import date, timedelta

from tracker import client_profile, gads_ai_doc

SAMPLE = ("sample", "example", "template", "how to", "howto", "readme", "instructions", "guide", "archive")
# First path segments an account may never take, besides every route the app has (app.py adds those).
RESERVED_WORDS = {
    "account", "accounts", "admin", "api", "app", "apps", "assets", "auth", "billing", "clients", "client",
    "dashboard", "dashboards", "docs", "favicon", "health", "help", "hub", "invite", "invites", "join",
    "login", "logout", "me", "new", "oauth", "p2", "privacy", "public", "robots", "settings", "share",
    "signin", "signout", "signup", "static", "status", "support", "terms", "workspace", "www",
}
SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
SLUG_MAX = 48

# Avatar fills: the design system's blocks, each with the text colour it was measured for.
_INK, _PAPER = "#121213", "#F6F4F0"
PALETTE = (("#FF6022", _INK), ("#8CCBFF", _INK), ("#FFB500", _INK), ("#121213", _PAPER),
           ("#FF3B30", _INK), ("#DBD7D1", _INK), ("#A8D8FF", _INK), ("#FF8B5D", _INK))


# ── Names ────────────────────────────────────────────────────────────────────
def norm(text):
    return " ".join(re.sub(r"[^a-z0-9]+", " ", client_profile.ascii_fold(text or "").lower()).split())


def slugify(text, max_len=SLUG_MAX):
    """"Lumina Smiles Dental" -> "lumina-smiles-dental"; "AA_New" -> "aa-new"; "" if nothing is left."""
    t = client_profile.ascii_fold(text or "").lower().replace("&", " and ").replace("'", "").replace("’", "")
    t = re.sub(r"[^a-z0-9]+", "-", t).strip("-")
    if len(t) > max_len:
        t = t[:max_len]
        t = t[:t.rfind("-")] if "-" in t[max_len // 2:] else t
        t = t.strip("-")
    return t if SLUG_RE.match(t or "") else ""


def initials(name):
    words = [w for w in re.split(r"[\s_/&-]+", client_profile.ascii_fold(name or "")) if w]
    words = [w for w in words if w.lower() not in ("the", "and", "of", "pvt", "ltd", "llc", "inc")] or words
    letters = "".join(w[0] for w in words[:2] if w[0].isalnum()).upper()
    return letters or (name or "?")[:1].upper()


def _luminance(hex_colour):
    h = hex_colour.lstrip("#")
    rgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast(a, b):
    la, lb = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def avatar(name, colours=()):
    """{"bg", "fg", "initials"}: the account's own brand colour when the profile gives one, else a fill
    from the design system picked by the name, so an account keeps its colour on every page."""
    for c in colours or ():
        if re.fullmatch(r"#[0-9a-f]{6}", c or ""):
            fg = _INK if contrast(c, _INK) >= contrast(c, _PAPER) else _PAPER
            return {"bg": c, "fg": fg, "initials": initials(name)}
    i = int(hashlib.sha1(norm(name).encode()).hexdigest(), 16) % len(PALETTE)
    bg, fg = PALETTE[i]
    return {"bg": bg, "fg": fg, "initials": initials(name)}


def _is_sample(title):
    n = norm(title)
    return any(n == s or n.startswith(s + " ") for s in SAMPLE)


# ── The list ─────────────────────────────────────────────────────────────────
def build(ads, doc=None):
    """The accounts, in order (by spend, then accounts with no Google Ads by name).

    ads  [(Google Ads account name, customer ID)] from the campaign report, by spend
    doc  the master doc as the Docs API returns it, or None
    Each account: key, name, ads_names, customer_ids, tab, profile, hidden, alt_keys.
    """
    names = [a for a, _ in ads]
    cids = {a: re.sub(r"\D", "", c or "") for a, c in ads}
    by_cid = {c: a for a, c in cids.items() if c}
    claimed = {}                     # Google Ads name -> the tab that claims it
    tab_accounts = []
    if doc:
        for title, lines in gads_ai_doc.tabs(doc):
            if not title or gads_ai_doc._shared(title) or _is_sample(title):
                continue
            profile = client_profile.parse(gads_ai_doc._md(lines))
            named = []
            who = gads_ai_doc.owner(title, names, {a: c for a, c in ads}, shortened=True)
            if who:
                named.append(who)
            for cid in profile.get("google_ads_ids") or []:
                if by_cid.get(cid) and by_cid[cid] not in named:
                    named.append(by_cid[cid])
            own = [a for a in named if a not in claimed]
            if named and not own:
                continue           # a second tab about an account another tab already holds
            if not own and not client_profile.identifies(profile):
                continue
            for a in own:
                claimed[a] = title
            tab_accounts.append({"tab": title, "profile": profile, "ads_names": sorted(own, key=names.index)})
        # Docs written with headings rather than tabs: an account's part still carries its profile.
        heading_parts = gads_ai_doc.parts(doc, names, {a: c for a, c in ads})["accounts"]
    else:
        heading_parts = {}

    accounts = []
    for t in tab_accounts:
        accounts.append(_account(t["ads_names"], cids, t["tab"], t["profile"]))
    for a in names:
        if a in claimed:
            continue
        text = "\n\n".join(chunk for where, chunk in heading_parts.get(a, []) if not where.startswith("tab "))
        accounts.append(_account([a], cids, None, client_profile.parse(text) if text else {"fields": 0}))
    order = {a: i for i, a in enumerate(names)}
    accounts.sort(key=lambda x: (0, order[x["ads_names"][0]]) if x["ads_names"] else (1, norm(x["name"])))
    return accounts


def _account(ads_names, cids, tab, profile):
    ids = sorted({cids[a] for a in ads_names if cids.get(a)} | set(profile.get("google_ads_ids") or []))
    # A tab linked by its Google Ads ID alone ("Aster Aesthetics" for the Google Ads account "AA_New")
    # names the client; a tab whose title is (part of) the Google Ads name does not add anything.
    titled = tab and not any(norm(tab) in norm(a) or norm(a) in norm(tab) for a in ads_names)
    if profile.get("display_name"):
        name = profile["display_name"]
    elif len(ads_names) == 1 and not titled:
        name = ads_names[0]
    else:
        name = tab or (ads_names[0] if ads_names else "")
    key = "cid:" + ids[0] if ids else "doc:" + norm(tab or name)
    alt = ["cid:" + i for i in ids] + ["doc:" + norm(tab or "")] + ["doc:" + norm(name)]
    alt = [k for k in dict.fromkeys(alt) if k != key and k not in ("doc:",)]
    return {"key": key, "name": name, "ads_names": list(ads_names), "customer_ids": ids, "tab": tab,
            "profile": profile, "hidden": bool(profile.get("hidden")), "alt_keys": alt,
            "url_name": profile.get("url_name") or ""}


# ── URL names ────────────────────────────────────────────────────────────────
def wanted_slug(account, reserved):
    want = slugify(account.get("url_name") or "") or slugify(account.get("name") or "") or "account"
    if want in reserved:
        want = (want + "-account")[:SLUG_MAX]
    return want


def plan_slugs(accounts, rows, retired, reserved):
    """Give every account a slug, keeping links stable. Pure: returns (rows, retired, rekeys).

    rows     {key: slug} as stored
    retired  {old slug: key} slugs an account used before (they redirect to it)
    reserved first path segments no account may take

    An account keeps its slug until the slug it should have (its URL name, else its name) changes;
    then it moves and the old one is retired to it, never given to another account. An account whose
    key changed (a no-Google-Ads account that now has one) takes over its old row (rekeys). A wanted
    slug that another account holds, now or before, is not taken: a new account gets "-2" and so on;
    an existing one keeps the slug it has.
    """
    rows, retired = dict(rows), dict(retired)
    rekeys = []
    live = {a["key"] for a in accounts}
    for a in accounts:
        if a["key"] in rows:
            continue
        for k in a.get("alt_keys") or ():
            if k in rows and k not in live:
                rows[a["key"]] = rows.pop(k)
                rekeys.append((k, a["key"]))
                for s, owner in list(retired.items()):
                    if owner == k:
                        retired[s] = a["key"]
                break
    taken = {slug: key for key, slug in rows.items()}
    # Accounts that ask for a URL name go first, so a name someone chose wins over one derived.
    for a in sorted(accounts, key=lambda x: 0 if x.get("url_name") else 1):
        key, want = a["key"], wanted_slug(a, reserved)
        cur = rows.get(key)
        if cur == want:
            continue
        holder = taken.get(want) or retired.get(want)
        if holder in (None, key):
            if cur:
                retired[cur] = key
                taken.pop(cur, None)
            retired.pop(want, None)
            rows[key] = want
            taken[want] = key
        elif cur is None:
            n = 2
            while ("%s-%d" % (want, n)) in taken or ("%s-%d" % (want, n)) in retired or \
                    ("%s-%d" % (want, n)) in reserved:
                n += 1
            slug = "%s-%d" % (want, n)
            rows[key] = slug
            taken[slug] = key
    return rows, retired, rekeys


# ── Numbers from the campaign report ─────────────────────────────────────────
CURRENCY_SYMBOLS = {"INR": "₹", "USD": "$", "GBP": "£", "EUR": "€", "AED": "AED ", "AUD": "A$", "CAD": "C$",
                    "SGD": "S$"}


def _indian(n):
    s = str(int(n))
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return ",".join(groups) + "," + tail


def money(v, currency="INR"):
    """₹3,12,489 / $12,480: whole units, the currency's own grouping."""
    v = float(v or 0)
    sign = "-" if v < 0 else ""
    n = round(abs(v))
    digits = _indian(n) if currency == "INR" else "{:,}".format(int(n))
    return sign + CURRENCY_SYMBOLS.get(currency, (currency + " ") if currency else "") + digits


def number(v, decimals=0):
    v = float(v or 0)
    if decimals and abs(v - round(v)) > 1e-9:
        return "{:,.{}f}".format(v, decimals)
    return "{:,}".format(int(round(v)))


def _pct(cur, prev):
    if not prev:
        return None
    return round((cur - prev) / prev * 100, 1)


def stats(rows, ads_names, days=30):
    """The account's last `days` days in the campaign report: totals, a daily series, last 7 days
    against the 7 before, and its campaigns by spend. None when it has no rows.

    Money is in the currency its Google Ads accounts are billed in ("Cost", "Currency code"), as
    Google Ads shows it. Only when they are billed in different currencies, which cannot be added
    up, is it in the report's converted currency ("Cost (Converted currency)")."""
    want = set(ads_names or ())
    mine = [r for r in rows if r.get("account") in want and r.get("day")]
    if not mine:
        return None
    own = {r.get("currency_native") or "" for r in mine}
    if len(own) == 1 and "" not in own:
        mine = [dict(r, cost=r.get("cost_native") or 0.0, currency=r["currency_native"]) for r in mine]
    last = max(r["day"] for r in mine)
    end = date.fromisoformat(last)
    start = end - timedelta(days=days - 1)
    series = {(start + timedelta(days=i)).isoformat(): {"cost": 0.0, "conv": 0.0, "clicks": 0, "impr": 0}
              for i in range(days)}
    camps, currencies = {}, {}
    for r in mine:
        d = series.get(r["day"])
        if d is None:
            continue
        cost, conv = float(r.get("cost") or 0), float(r.get("conversions") or 0)
        d["cost"] += cost
        d["conv"] += conv
        d["clicks"] += int(r.get("clicks") or 0)
        d["impr"] += int(r.get("impressions") or 0)
        c = camps.setdefault((r.get("account"), r.get("campaign")), {
            "name": r.get("campaign") or "", "account": r.get("account") or "", "type": r.get("type") or "",
            "state": r.get("state") or "", "cost": 0.0, "conv": 0.0, "clicks": 0})
        c["cost"] += cost
        c["conv"] += conv
        c["clicks"] += int(r.get("clicks") or 0)
        if r.get("currency"):
            currencies[r["currency"]] = currencies.get(r["currency"], 0) + 1
    daily = [dict(v, day=k) for k, v in sorted(series.items())]
    # Cost per conversion day by day is mostly noise (a day with one conversion), so the series is
    # each day's last 7 days: cost over conversions, None until there is a conversion to divide by.
    for i, d in enumerate(daily):
        week = daily[max(0, i - 6):i + 1]
        c, v = sum(x["cost"] for x in week), sum(x["conv"] for x in week)
        d["cpa7"] = c / v if v else None
    tot = {"cost": sum(d["cost"] for d in daily), "conv": sum(d["conv"] for d in daily),
           "clicks": sum(d["clicks"] for d in daily), "impr": sum(d["impr"] for d in daily)}
    last7 = {k: sum(d[k] for d in daily[-7:]) for k in ("cost", "conv", "clicks")}
    prev7 = {k: sum(d[k] for d in daily[-14:-7]) for k in ("cost", "conv", "clicks")}
    cpa = tot["cost"] / tot["conv"] if tot["conv"] else None
    cpa7 = last7["cost"] / last7["conv"] if last7["conv"] else None
    cpap = prev7["cost"] / prev7["conv"] if prev7["conv"] else None
    currency = max(currencies, key=currencies.get) if currencies else "INR"
    campaigns = sorted(camps.values(), key=lambda c: -c["cost"])
    for c in campaigns:
        c["share"] = c["cost"] / tot["cost"] if tot["cost"] else 0
        c["cpa"] = c["cost"] / c["conv"] if c["conv"] else None
    types = {}
    for c in campaigns:
        types[c["type"] or "Other"] = types.get(c["type"] or "Other", 0) + c["cost"]
    return {
        "currency": currency, "from": daily[0]["day"], "to": last, "days": days,
        "cost": tot["cost"], "conv": tot["conv"], "clicks": tot["clicks"], "impr": tot["impr"],
        "cpa": cpa, "ctr": tot["clicks"] / tot["impr"] if tot["impr"] else None,
        "delta": {"cost": _pct(last7["cost"], prev7["cost"]), "conv": _pct(last7["conv"], prev7["conv"]),
                  "clicks": _pct(last7["clicks"], prev7["clicks"]),
                  "cpa": _pct(cpa7, cpap) if (cpa7 is not None and cpap) else None},
        "daily": [{"day": d["day"], "cost": round(d["cost"], 2), "conv": round(d["conv"], 2),
                   "clicks": d["clicks"], "cpa7": round(d["cpa7"], 2) if d["cpa7"] is not None else None}
                  for d in daily],
        "campaigns": campaigns,
        "live_campaigns": sum(1 for c in campaigns if (c["state"] or "").lower() in ("enabled", "active", "")),
        "types": sorted(({"type": t, "cost": v, "share": v / tot["cost"] if tot["cost"] else 0}
                         for t, v in types.items()), key=lambda x: -x["cost"]),
    }


SOCIAL_LABELS = {"instagram": "Instagram", "facebook": "Facebook", "linkedin": "LinkedIn", "youtube": "YouTube",
                 "x": "X", "tiktok": "TikTok"}


def social_label(platform):
    return SOCIAL_LABELS.get(platform, platform.title())


def nice_day(v):
    """"5 Oct 2026" for a date, a datetime or an ISO string; "" when it is none of them."""
    if not v:
        return ""
    try:
        d = v if isinstance(v, date) else date.fromisoformat(str(v)[:10])
    except ValueError:
        return ""
    return "%d %s %d" % (d.day, d.strftime("%b"), d.year)


def delta_text(p):
    """"▲ 12% on the week before" for last 7 days against the 7 before; "" when there is nothing to
    compare (no spend that week)."""
    if p is None:
        return ""
    if abs(p) < 0.5:
        return "Flat on the week before"
    return "%s %d%% on the week before" % ("▲" if p > 0 else "▼", round(abs(p)))


def card(account, st=None):
    """What a picker row or a hub card shows for an account (JSON-safe, nothing internal)."""
    p = account.get("profile") or {}
    out = {"slug": account["slug"], "name": account["name"], "avatar": avatar(account["name"], p.get("colours")),
           "domain": p.get("domain", ""), "industry": p.get("industry", ""), "has_ads": bool(account["ads_names"]),
           "locations": (p.get("locations") or [])[:3], "spend": None, "spend_fmt": "", "conv": None,
           "conv_fmt": "", "currency": "", "delta": None, "spark": [], "to": "", "cpa_fmt": ""}
    if st:
        cur = st["currency"]
        out.update(spend=round(st["cost"], 2), spend_fmt=money(st["cost"], cur), conv=round(st["conv"], 2),
                   conv_fmt=number(st["conv"], 1), currency=cur, delta=st["delta"]["cost"],
                   spark=[round(d["cost"], 2) for d in st["daily"]], to=st["to"],
                   cpa_fmt=money(st["cpa"], cur) if st["cpa"] is not None else "")
    return out
