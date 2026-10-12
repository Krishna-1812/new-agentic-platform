"""Market Radar: what the readings add up to. No model, no cost.

The collection stores many small facts about each rival: its moves (scored for this client), jobs
open, locations, review counts, App Store apps, tools on its homepage, new pages, Hacker News stories,
Wikidata facts. This module puts them side by side:

    momentum   is each rival speeding up, steady or quiet (its scored moves, recent against before)
    battlecard everything known about one rival on one card, each fact with where it came from
    patterns   what several rivals are doing at once ("4 of 8 rivals are hiring in sales")
    heat       whether the whole field is heating up or cooling (all rivals' moves, two fortnights)

    rivals_overview(client_id, owner_email, store=..., now=...) -> {"rivals", "patterns", "heat", ...}

Everything is arithmetic on stored readings, so it is free, instant and reproducible: the same
readings always give the same cards. A statement the model writes about the same field is checked
against the evidence pack separately (tracker/market_radar_report.py); nothing here is invented.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone

RECENT_DAYS = 14
WINDOW_DAYS = 60
QUIET_BELOW = 2.0          # a rival whose recent and earlier scored moves sum below this is quiet
SPEEDING_RATIO = 1.5
GROUPS = {   # event types grouped into what a rival is doing
    "launching": {"product_launch", "app_update", "new_content", "sale_started", "promotion", "marketing_campaign"},
    "pricing": {"pricing_change", "price_increase", "price_cut"},
    "expanding": {"new_location", "new_market", "new_job_location", "nearby_opening"},
    "hiring": {"hiring_surge", "hiring_push", "senior_hire_search"},
    "reshaping": {"acquisition", "funding", "leadership_change", "partnership", "rebrand"},
    "under_pressure": {"layoffs", "closed_location", "hiring_slowdown", "legal_regulatory"},
}
GROUP_WORDS = {"launching": "launching products, apps or offers", "pricing": "changing prices",
               "expanding": "opening in new places or markets", "hiring": "hiring up or searching for leaders",
               "reshaping": "changing hands, leaders, money or partners", "under_pressure": "cutting back or under pressure"}


def _day(value):
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(value)[:10]).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def event_day(e):
    return _day(e.get("event_date")) or _day(e.get("first_seen_at"))


def momentum(events, scores, now):
    """{"label", "recent", "before", "moves"} for one rival's events."""
    recent = before = 0.0
    n = 0
    for e in events:
        d = event_day(e)
        sc = (scores.get(e["id"]) or {}).get("score") or 0
        if not d or sc <= 0:
            continue
        age = (now - d).days
        if 0 <= age <= RECENT_DAYS:
            recent += sc
            n += 1
        elif RECENT_DAYS < age <= 2 * RECENT_DAYS:
            before += sc
            n += 1
    if recent + before < QUIET_BELOW:
        label = "quiet"
    elif recent >= SPEEDING_RATIO * max(before, 1.0):
        label = "speeding_up"
    elif before >= SPEEDING_RATIO * max(recent, 1.0):
        label = "slowing"
    else:
        label = "steady"
    return {"label": label, "recent": round(recent, 1), "before": round(before, 1), "moves": n}


def _snap(store, entity_id, name):
    return ((store.latest_snapshot(entity_id, name) or {}).get("payload")) or {}


def _fact(label, value, source):
    return {"label": label, "value": value, "source": source}


def facts_of(store, entity_id):
    """The facts known about one rival, each with where it came from: [{"label", "value", "source"}]."""
    out = []
    w = _snap(store, entity_id, "facts")
    if w.get("employees"):
        out.append(_fact("Staff", "{:,}{}".format(w["employees"], " (%s)" % w["employees_year"] if w.get("employees_year") else ""), "Wikidata"))
    if w.get("revenue"):
        from .market_radar_outside import _money
        out.append(_fact("Revenue", "%s%s" % (_money(w["revenue"]), " (%s)" % w["revenue_year"] if w.get("revenue_year") else ""), "Wikidata"))
    if w.get("ceo"):
        out.append(_fact("Chief executive", ", ".join(w["ceo"]), "Wikidata"))
    if w.get("parent") or w.get("owners"):
        out.append(_fact("Owned by", ", ".join((w.get("parent") or []) + (w.get("owners") or []))[:120], "Wikidata"))
    if w.get("head_office"):
        out.append(_fact("Head office", ", ".join(w["head_office"]), "Wikidata"))
    if w.get("listed_on"):
        out.append(_fact("Listed on", ", ".join(w["listed_on"]), "Wikidata"))
    loc = _snap(store, entity_id, "locations")
    if loc.get("places"):
        out.append(_fact("Locations", "{:,} listed on its site".format(len(loc["places"])), "its sitemap"))
    rev = _snap(store, entity_id, "reviews")
    scores = list((rev.get("scores") or {}).values())
    if scores:
        total = sum(int(s[2] or 0) for s in scores if len(s) > 2)
        best = max((float(s[1] or 0) for s in scores if len(s) > 2), default=0)
        if total:
            out.append(_fact("Reviews", "{:,} reviews, up to {:.1f} stars".format(total, best), "its product pages"))
    apps = _snap(store, entity_id, "apps").get("apps") or []
    if apps:
        a = apps[0]
        out.append(_fact("App", "%s%s%s" % (a.get("name"), ", %.1f stars" % a["rating"] if a.get("rating") else "",
                                              " from {:,} ratings".format(a["ratings"]) if a.get("ratings") else ""), "App Store"))
    tools = _snap(store, entity_id, "stack").get("tools") or []
    if tools:
        out.append(_fact("Tools", ", ".join(tools[:8]), "its homepage"))
    pages = _snap(store, entity_id, "content").get("paths") or []
    if pages:
        out.append(_fact("Site", "{:,} pages in its sitemap".format(len(pages)), "its sitemap"))
    return out


def hiring_of(store, entity_id):
    jp = _snap(store, entity_id, "jobs")
    if "open" not in jp:
        return None
    return {"open": jp.get("open") or 0, "places": len(jp.get("places") or {}),
            "functions": list((jp.get("by_function") or {}).items())[:4],
            "senior": (jp.get("senior_open") or [])[:3]}


def buzz_of(store, entity_id):
    items = _snap(store, entity_id, "buzz").get("items") or []
    if not items:
        return None
    top = max(items, key=lambda i: i.get("points") or 0)
    return {"title": top.get("title"), "points": top.get("points"), "date": top.get("date"),
            "url": "https://news.ycombinator.com/item?id=%s" % top.get("id")}


def watch_lines(card):
    """What to keep an eye on at this rival, from its own readings."""
    out = []
    h = card.get("hiring") or {}
    if h.get("senior"):
        out.append("Searching for: %s" % h["senior"][0])
    if h.get("open") and h.get("functions"):
        fn, n = h["functions"][0]
        out.append("%d open roles, most in %s (%d)" % (h["open"], fn, n))
    m = card.get("momentum") or {}
    if m.get("label") == "speeding_up":
        out.append("Its moves are speeding up: %.0f points in the last fortnight against %.0f before" % (m["recent"], m["before"]))
    top = (card.get("moves") or [None])[0]
    if top and top.get("status") in ("planned", "announced", "rumored"):
        out.append("%s: %s" % (top["status"].capitalize(), top["title"]))
    return out[:3]


def battlecard(store, comp, events, scores, names, now):
    mine = [e for e in events if e["entity_id"] == comp["entity_id"] and not e.get("hidden_reason") and e["id"] in scores]
    mine.sort(key=lambda e: -((scores[e["id"]].get("score")) or 0))
    moves = []
    for e in mine[:4]:
        sc = scores[e["id"]]
        src = (e.get("sources") or [{}])[0]
        moves.append({"event_id": e["id"], "type": e["type"], "title": e["title"], "status": e["status"],
                      "date": (event_day(e) or now).strftime("%Y-%m-%d"), "severity": sc.get("severity"),
                      "score": sc.get("score"), "url": src.get("url")})
    card = {"entity_id": comp["entity_id"], "name": comp.get("name") or comp["domain"], "domain": comp["domain"],
            "kind": comp.get("kind"), "status": comp.get("status"), "sells": (comp.get("details") or {}).get("sells"),
            "momentum": momentum(mine, scores, now), "moves": moves, "facts": facts_of(store, comp["entity_id"]),
            "hiring": hiring_of(store, comp["entity_id"]), "buzz": buzz_of(store, comp["entity_id"]),
            "total_moves": len(mine)}
    card["watch"] = watch_lines(card)
    return card


def patterns(cards, events, scores, now):
    """What several rivals are doing at once: [{"kind", "text", "rivals": [names]}]."""
    n = len(cards)
    if n < 2:
        return []
    out = []
    by_group = {g: {} for g in GROUPS}
    for e in events:
        d = event_day(e)
        if not d or (now - d).days > 45 or e["id"] not in scores or e.get("hidden_reason"):
            continue
        for g, types in GROUPS.items():
            if e["type"] in types:
                by_group[g].setdefault(e["entity_id"], []).append(e)
    names = {c["entity_id"]: c["name"] for c in cards}
    for g, per in sorted(by_group.items(), key=lambda kv: -len(kv[1])):
        if len(per) >= 2 and len(per) >= 0.25 * n:
            who = [names[i] for i in per if i in names]
            out.append({"kind": g, "text": "%d of %d rivals are %s" % (len(who), n, GROUP_WORDS[g]),
                        "rivals": who[:6]})
    fn = Counter()
    hiring = 0
    for c in cards:
        h = c.get("hiring") or {}
        if h.get("open"):
            hiring += 1
            for name, k in h.get("functions") or []:
                fn[name] += k
    if hiring >= 2 and fn:
        name, k = fn.most_common(1)[0]
        out.append({"kind": "hiring_focus", "text": "%d of %d rivals are hiring; most open roles are in %s (%d)" % (hiring, n, name, k),
                    "rivals": [c["name"] for c in cards if (c.get("hiring") or {}).get("open")][:6]})
    tools = Counter()
    for c in cards:
        for f in c.get("facts") or []:
            if f["label"] == "Tools":
                tools.update(t.strip() for t in f["value"].split(","))
    common = [(t, k) for t, k in tools.most_common(6) if k >= max(2, n // 2) and t not in ("Cloudflare", "Google Tag Manager", "WordPress")]
    if common:
        out.append({"kind": "shared_tools", "text": "Most rivals use " + ", ".join("%s (%d)" % kv for kv in common[:3]), "rivals": []})
    with_app = [c["name"] for c in cards if any(f["label"] == "App" for f in c.get("facts") or [])]
    if len(with_app) >= 2:
        out.append({"kind": "apps", "text": "%d of %d rivals have a mobile app" % (len(with_app), n), "rivals": with_app[:6]})
    return out[:6]


def heat(events, scores, now):
    """Is the whole field speeding up? {"label", "recent", "before"} over all rivals' scored moves."""
    recent = before = 0.0
    for e in events:
        d, sc = event_day(e), (scores.get(e["id"]) or {}).get("score") or 0
        if not d or sc <= 0 or e.get("hidden_reason"):
            continue
        age = (now - d).days
        if 0 <= age <= RECENT_DAYS:
            recent += sc
        elif RECENT_DAYS < age <= 2 * RECENT_DAYS:
            before += sc
    if recent + before < QUIET_BELOW:
        label = "quiet"
    elif recent >= SPEEDING_RATIO * max(before, 1.0):
        label = "heating_up"
    elif before >= SPEEDING_RATIO * max(recent, 1.0):
        label = "cooling"
    else:
        label = "steady"
    return {"label": label, "recent": round(recent, 1), "before": round(before, 1)}


def rivals_overview(client_id, owner_email, *, store, now=None):
    """The rivals side by side. None when the client is not the owner's."""
    now = now or datetime.now(timezone.utc)
    if not store.get_client(client_id, owner_email):
        return None
    comps = [c for c in store.competitors(client_id, owner_email) if c["status"] != "removed"]
    ids = [c["entity_id"] for c in comps]
    scores = store.client_scores(client_id)
    events = [e for e in store.recent_events(ids, days=WINDOW_DAYS + 30, limit=1500) if e["id"] in scores] if ids else []
    names = {c["entity_id"]: c.get("name") or c["domain"] for c in comps}
    cards = [battlecard(store, c, events, scores, names, now) for c in comps]
    order = {"speeding_up": 0, "steady": 1, "slowing": 2, "quiet": 3}
    cards.sort(key=lambda c: (order[c["momentum"]["label"]], -(c["momentum"]["recent"] + c["momentum"]["before"]), c["name"].lower()))
    return {"rivals": cards, "patterns": patterns(cards, events, scores, now), "heat": heat(events, scores, now),
            "counts": {"speeding_up": sum(1 for c in cards if c["momentum"]["label"] == "speeding_up"),
                       "quiet": sum(1 for c in cards if c["momentum"]["label"] == "quiet"),
                       "total": len(cards), "with_facts": sum(1 for c in cards if c["facts"])},
            "built_at": now.isoformat(timespec="seconds")}
