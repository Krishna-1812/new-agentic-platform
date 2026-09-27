"""Local Business Radar, stage 6: who to pitch first, for what, and how.

Need (0-100 per service, higher = needs it more), each from the findings:
  website      no site / social-only / retired business.site / dead / parked
               near the top; a working site by what is wrong with it
  seo          map-pack rank, profile completeness, reviews against the
               local median, the site's local SEO basics
  reputation   rating against the market, share of bad reviews, unanswered
               bad reviews, reply rate, a falling trend, silence
  paid         never advertised with a working site, not in the map pack
  creatives    few photos, no owner posts, no social presence

Ability to pay (0-100): customer volume (reviews, on a log scale), price
level, a high-ticket category, more than one location, already spending on
ads. A business that needs everything and can pay nothing is not a lead.

Opportunity = 70% need (the chosen service, or a weighted blend for "all")
+ 30% ability. Tier A >= 70, B >= 50, C below.

Evidence and pitch. Every finding worth saying becomes a numbered fact
with the numbers it states. Claude writes the pitch from those facts only,
and the pitch is checked: a number that is in no fact (or in the business's
own name or address) rejects it. One retry, then a pitch assembled from the
facts themselves. Only tier A and B businesses get a written pitch; C get
the assembled one, which costs nothing.
"""

import math
import re
from concurrent.futures import ThreadPoolExecutor

from tracker import lbr_claude, lbr_config
from tracker.lbr_website import VERDICT_TEXT

SERVICES = {
    "website": "Website build & management",
    "seo": "Local SEO & Google Business Profile",
    "paid": "Paid media (Google Ads, Meta, Local Services Ads)",
    "reputation": "Reputation & review management",
    "creatives": "Creatives & social content",
}
BLEND = {"website": 0.30, "seo": 0.25, "reputation": 0.20, "paid": 0.15, "creatives": 0.10}
HIGH_TICKET = {"dentist", "dental_clinic", "lawyer", "skin_care_clinic", "doctor", "medical_clinic",
               "chiropractor", "physiotherapist", "roofing_contractor", "plumber", "electrician",
               "real_estate_agency", "car_dealer", "veterinary_care", "wedding_venue", "insurance_agency",
               "accounting", "moving_company"}
HIGH_TICKET_WORDS = ("hvac", "roof", "remodel", "contractor", "orthodont", "med spa", "dermatolog", "law")
TIER_A, TIER_B = 70, 50
PITCH_WORKERS = 4


def _clamp(v):
    return None if v is None else max(0, min(100, round(v)))


# ── Need, per service ────────────────────────────────────────────────────────
def need_website(web):
    kind = (web or {}).get("kind")
    fixed = {"google_site_retired": 100, "none": 96, "dead": 95, "parked": 95, "broken": 93,
             "social_only": 90, "listing_only": 86, "ssl_error": 84}
    if kind in fixed:
        return fixed[kind]
    if kind != "ok":
        return None
    score = web.get("score")
    base = 100 - score if score is not None else 40
    high = sum(1 for i in web.get("issues") or [] if i.get("severity") == "high")
    return _clamp(base * 0.9 + high * 8)


def need_seo(prof, gbp, web, vis):
    parts = []
    v = vis or {}
    rank = v.get("rank")
    # Only a search that ran counts: not a service-area business, not a failed search.
    if v.get("in_pack") is not None:
        if rank is None:
            parts.append(45)
        elif rank > 10:
            parts.append(35)
        elif rank > 3:
            parts.append(20)
    if gbp and gbp.get("score") is not None:
        parts.append((100 - gbp["score"]) * 0.45)
    mv = ((vis or {}).get("market") or {}).get("reviews_vs_median")
    if mv is not None and mv < 0:
        parts.append(15)
    checks = (web or {}).get("checks") or {}
    if checks and (checks.get("local_schema") is False or checks.get("meta_description") is False):
        parts.append(10)
    if (web or {}).get("kind") not in (None, "ok"):
        parts.append(10)
    return _clamp(sum(parts)) if parts else None


def need_reputation(prof, rev, vis):
    st = (rev or {}).get("stats") or {}
    if not st and prof.get("rating") is None:
        return None
    s = 0.0
    rating = prof.get("rating")
    if rating is not None:
        s += max(0.0, (4.7 - rating) * 45)
    if st.get("sample"):
        s += st.get("negative", 0) * 0.4
        s += min(25, 5 * st.get("unanswered_negative", 0))
        if st.get("reply_rate") is not None and st["reply_rate"] < 30:
            s += 15
        if st.get("trend") is not None and st["trend"] <= -0.3:
            s += 15
        if st.get("recent_90d") == 0:
            s += 10
    mv = ((vis or {}).get("market") or {}).get("reviews_vs_median")
    if mv is not None and mv < 0:
        s += 15
    if (prof.get("reviews") or 0) < 15:
        s += 10
    return _clamp(s)


def need_paid(prof, web, vis):
    ads = (vis or {}).get("ads")
    kind = (web or {}).get("kind")
    if kind != "ok":
        return 30 if kind else None      # a site first; then ads have somewhere to land
    if ads is None:
        s = 55 if not web.get("runs_ads") else 30
    elif ads.get("error"):
        s = 55 if not web.get("runs_ads") else 30
    elif ads.get("active"):
        return 25                        # optimise existing spend; no bonuses apply
    elif ads.get("creatives"):
        s = 60                           # advertised before, stopped
    else:
        s = 70                           # never advertised
    if (vis or {}).get("in_pack") is False:
        s += 15
    if (prof.get("rating") or 0) >= 4.5:
        s += 10                          # good reviews convert paid clicks
    return _clamp(s)


def need_creatives(prof, gbp, web):
    s = 0
    photos = (gbp or {}).get("photos")
    if photos is None and (prof.get("photos_seen") or 0) < 10:
        photos = prof.get("photos_seen") or 0
    if photos is not None:
        s += 40 if photos < 10 else 20 if photos < 20 else 0
    checks = {c["key"]: c for c in (gbp or {}).get("checks") or []}
    posts = checks.get("posts", {}).get("status")
    if posts == "missing":
        s += 25
    elif posts == "weak":
        s += 10
    socials = (web or {}).get("socials")
    if web and web.get("kind") == "ok" and not socials:
        s += 20
    if checks.get("description", {}).get("status") == "missing":
        s += 10
    if web and web.get("kind") != "ok":
        s += 10
    return _clamp(s)


def ability(prof, web, vis):
    n = prof.get("reviews") or 0
    s = min(40.0, 10 * math.log10(1 + n) * 1.6)      # 10 reviews ~17, 100 ~32, 300+ ~40
    s += {"PRICE_LEVEL_EXPENSIVE": 20, "PRICE_LEVEL_VERY_EXPENSIVE": 25,
          "PRICE_LEVEL_MODERATE": 10}.get(prof.get("price_level") or "", 0)
    ptype = prof.get("primary_type") or ""
    cat = (prof.get("category") or "").lower()
    if ptype in HIGH_TICKET or any(w in cat for w in HIGH_TICKET_WORDS):
        s += 20
    if (prof.get("locations") or 1) >= 2:
        s += 10
    ads = (vis or {}).get("ads") or {}
    if ads.get("active") or (web or {}).get("runs_ads"):
        s += 10
    if (web or {}).get("kind") == "ok":
        s += 5
    return _clamp(s)


# ── Evidence ─────────────────────────────────────────────────────────────────
_NUM = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)")


def _nums(text):
    out = set()
    for m in _NUM.findall(text or ""):
        out.add(m)
        try:
            out.add(str(int(float(m))) if float(m).is_integer() else str(float(m)))
        except ValueError:
            pass
    return out


def evidence(prof, gbp, web, rev, vis, mkt, query):
    """The facts worth saying, most important first. [{"id", "service", "text"}]"""
    facts = []

    def add(service, text):
        facts.append({"id": "f%d" % (len(facts) + 1), "service": service, "text": text})
    kind = (web or {}).get("kind")
    if kind and kind != "ok":
        add("website", VERDICT_TEXT.get(kind, "No working website."))
    elif kind == "ok":
        for i in (web.get("issues") or [])[:3]:
            add("website", i["text"])
    if gbp and gbp.get("claimed") is False:
        add("seo", "Their Google Business Profile is unclaimed.")
    rating, count = prof.get("rating"), prof.get("reviews") or 0
    if rating is not None and mkt and mkt.get("median_rating") is not None:
        add("reputation", "%.1f stars from %d reviews; the typical %s nearby has %.1f from %d." % (
            rating, count, query, mkt["median_rating"], mkt.get("median_reviews") or 0))
    st = (rev or {}).get("stats") or {}
    if st.get("unanswered_negative"):
        add("reputation", "%d one- and two-star reviews have no reply from the owner." % st["unanswered_negative"])
    if st.get("trend") is not None and st["trend"] <= -0.3:
        add("reputation", "Recent reviews average %.1f stars lower than older ones." % abs(st["trend"]))
    if st.get("last_days") is not None and st["last_days"] > 120:
        add("reputation", "The last review was %d days ago." % st["last_days"])
    comp = ((rev or {}).get("themes") or {}).get("complaints") or []
    if comp:
        add("reputation", "Customers complain about: %s." % "; ".join(c["theme"].lower() for c in comp[:2]))
    if vis:
        if vis.get("rank") is None and "Not in the first" in (vis.get("rank_note") or ""):
            add("seo", vis["rank_note"])
        elif vis.get("rank") and vis["rank"] > 3:
            add("seo", "Ranks #%d on Google Maps for \"%s\" nearby, outside the top 3." % (vis["rank"], query))
        ads = vis.get("ads") or {}
        if kind == "ok" and ads and not ads.get("error"):
            if ads.get("active"):
                add("paid", "Already running Google Ads (%d ads on record)." % ads.get("creatives", 0))
            elif not ads.get("creatives"):
                add("paid", "No Google Ads on record for their website.")
    if gbp:
        checks = {c["key"]: c for c in gbp.get("checks") or []}
        ph = checks.get("photos")
        if ph and ph["status"] == "missing":
            add("creatives", "Only %s photos on their Google profile." % ph["value"])
        if checks.get("posts", {}).get("status") == "missing":
            add("creatives", "No recent posts on their Google profile.")
    return facts


# ── Pitch ────────────────────────────────────────────────────────────────────
_PITCH_SYSTEM = """You write the opening pitch a digital marketing agency will use with one small local
business. You are given numbered facts about the business; they are the ONLY things you may state
about it. Answer with ONE JSON object and nothing else:
{"headline": "under 12 words, the single biggest gap",
 "pitch": "2-3 sentences, plain and specific, written to the owner",
 "services": [{"service": "website|seo|paid|reputation|creatives", "fact_ids": ["f1"]}],
 "email_subject": "under 9 words",
 "call_opener": "one sentence to open a phone call"}
Rules: use only numbers that appear in the facts; never invent revenue, customer counts, prices or
guarantees; no hype words ("skyrocket", "guaranteed", "#1"); no em dashes; at most 3 services,
most important first, each citing the fact ids that justify it."""


def _numbers_ok(texts, facts, prof):
    allowed = set()
    for f in facts:
        allowed |= _nums(f["text"])
    allowed |= _nums(prof.get("name")) | _nums(prof.get("address")) | {"1", "2", "3"}
    return all(_nums(t) <= allowed for t in texts)


def assembled_pitch(prof, facts, top):
    """A pitch built from the facts themselves: always true, never fancy."""
    lead = [f for f in facts if f["service"] == top] or facts
    lines = [f["text"] for f in lead[:2]]
    name = prof.get("name") or "your business"
    return {"headline": (lead[0]["text"].rstrip(".") if lead else "A quick look at %s" % name)[:90],
            "pitch": " ".join(lines) or "We looked at how %s shows up online." % name,
            "services": [{"service": top, "fact_ids": [f["id"] for f in lead[:2]]}] if top else [],
            "email_subject": ("A quick look at %s online" % name)[:80],
            "call_opener": "I was looking at %s on Google and noticed a couple of things worth fixing." % name,
            "source": "assembled"}


def write_pitch(prof, facts, top, focus, ledger):
    if not facts or not lbr_config.key_for("claude"):
        return assembled_pitch(prof, facts, top)
    user = "Business: %s (%s)\nService to lead with: %s\n\nFacts:\n%s" % (
        prof.get("name"), prof.get("category") or "local business", SERVICES.get(top, top),
        "\n".join("%s [%s] %s" % (f["id"], f["service"], f["text"]) for f in facts))
    ids = {f["id"] for f in facts}
    for _ in range(2):
        try:
            obj = lbr_claude.ask_json(_PITCH_SYSTEM, user, ledger, max_tokens=700, purpose="pitch",
                                      require=("headline", "pitch"))
        except lbr_claude.ClaudeError:
            break
        head = str(obj.get("headline") or "").replace("—", ", ").strip()[:120]
        body = str(obj.get("pitch") or "").replace("—", ", ").strip()[:700]
        subj = str(obj.get("email_subject") or "").replace("—", ", ").strip()[:90]
        opener = str(obj.get("call_opener") or "").replace("—", ", ").strip()[:240]
        if not _numbers_ok([head, body, subj, opener], facts, prof):
            continue
        services = []
        for s in (obj.get("services") or [])[:3]:
            if s.get("service") in SERVICES:
                services.append({"service": s["service"], "fact_ids": [i for i in (s.get("fact_ids") or []) if i in ids]})
        return {"headline": head, "pitch": body, "services": services, "email_subject": subj,
                "call_opener": opener, "source": "claude"}
    return assembled_pitch(prof, facts, top)


# ── The stage ────────────────────────────────────────────────────────────────
def score_one(prof, gbp, web, rev, vis, focus):
    need = {"website": need_website(web), "seo": need_seo(prof, gbp, web, vis),
            "reputation": need_reputation(prof, rev, vis), "paid": need_paid(prof, web, vis),
            "creatives": need_creatives(prof, gbp, web)}
    known = {k: v for k, v in need.items() if v is not None}
    if focus in SERVICES:
        headline_need = need.get(focus)
        if headline_need is None:
            headline_need = 0
    else:
        w = sum(BLEND[k] for k in known)
        headline_need = sum(BLEND[k] * v for k, v in known.items()) / w if w else 0
        # a business that badly needs ONE thing is a lead even if it is fine elsewhere
        if known:
            headline_need = max(headline_need, 0.85 * max(known.values()))
    pay = ability(prof, web, vis)
    total = _clamp(0.7 * headline_need + 0.3 * (pay or 0))
    if focus in SERVICES:
        top = focus
    elif known.get("website", 0) >= 85:
        top = "website"      # no real site: every other channel needs somewhere to send people first
    else:
        top = max(known, key=known.get) if known else None
    tier = "A" if total >= TIER_A else "B" if total >= TIER_B else "C"
    return {"total": total, "tier": tier, "need": need, "ability": pay, "top_service": top,
            "services_ranked": sorted(known, key=known.get, reverse=True)}


def run(selected, profiles, findings, plan, market, ledger, *, should_stop=None):
    """Score, rank and pitch every selected business. {place_id: {"score", "facts", "pitch"}}"""
    focus = plan.get("focus", "all")
    query = (plan["business"].get("queries") or [plan["business"].get("input")])[0]
    out = {}
    for pid in selected:
        if pid not in profiles:
            continue
        f = findings.get(pid) or {}
        prof = profiles[pid]
        sc = score_one(prof, f.get("profile"), f.get("website"), f.get("reviews"), f.get("visibility"), focus)
        facts = evidence(prof, f.get("profile"), f.get("website"), f.get("reviews"), f.get("visibility"),
                         market, query)
        out[pid] = {"score": sc, "facts": facts}
    order = sorted(out, key=lambda p: (-out[p]["score"]["total"], -(profiles[p].get("reviews") or 0), p))
    for rank, pid in enumerate(order, 1):
        out[pid]["rank"] = rank

    def pitch(pid):
        if should_stop and should_stop():
            return pid, None
        e = out[pid]
        top = e["score"]["top_service"]
        if e["score"]["tier"] in ("A", "B"):
            return pid, write_pitch(profiles[pid], e["facts"], top, focus, ledger)
        return pid, assembled_pitch(profiles[pid], e["facts"], top)
    with ThreadPoolExecutor(max_workers=PITCH_WORKERS) as pool:
        for pid, p in pool.map(pitch, order):
            if p is not None:
                out[pid]["pitch"] = p
    return out
