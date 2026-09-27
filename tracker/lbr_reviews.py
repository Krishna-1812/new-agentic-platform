"""Local Business Radar, stage 4: reviews and what the public thinks.

Reviews come from SerpAPI's Google Maps Reviews API, newest first, up to
lbr_config.MAX_REVIEW_PAGES pages per business (Google's own Places API
returns five); or, when Apify is the source, from the newest
lbr_config.APIFY_MAX_REVIEWS that Apify's Google Maps Scraper read with each
business's detail page in stage 2. Each review keeps its stars, its text, its dates and the
owner's reply, never the reviewer's name: nothing the pitch needs.

Two kinds of finding, kept apart on purpose:

  The numbers (computed here, never by a model): rating mix, sentiment
  from the stars (4-5 positive, 3 neutral, 1-2 negative), how many came in
  the last 90 days, the trend between the newer and older half, how often
  and how fast the owner replies, and how many bad reviews sit unanswered.

  The themes (Claude): what customers praise and complain about, the
  operational fixes the complaints point to, a compliant plan to earn more
  reviews, and draft replies to unanswered negative reviews. Claude cites
  reviews by id; the quote shown is always the real text of that review,
  looked up here, so a quote can never be invented, and a theme citing no
  real review is dropped.

Compliance. The plan must never suggest buying, faking, incentivising or
"gating" reviews (asking only happy customers): Google's policy prohibits
it, and in the US the FTC's rule on consumer reviews (16 CFR Part 465, in
force since October 2024) makes fake and bought reviews unlawful. The model
is told so, and any recommendation that slips through with that intent is
removed before it reaches the report.
"""

import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from tracker import lbr_claude, lbr_config, lbr_http

SERP_URL = "https://serpapi.com/search.json"
FETCH_WORKERS = 6
THEME_WORKERS = 4
MAX_TEXTS = 60
MAX_TEXT_CHARS = 600

COMPLIANCE = {
    "rule": "Never buy, fake, incentivise or gate reviews. Ask every customer the same way.",
    "sources": [
        {"name": "Google Maps User Generated Content Policy: prohibited & restricted content "
                 "(fake engagement; incentives; selectively soliciting positive reviews)",
         "url": "https://support.google.com/contributionpolicy/answer/7400114"},
        {"name": "FTC Trade Regulation Rule on the Use of Consumer Reviews and Testimonials, 16 CFR Part 465 "
                 "(in force 21 October 2024)",
         "url": "https://www.ftc.gov/legal-library/browse/federal-register-notices/"
                "16-cfr-part-465-trade-regulation-rule-use-consumer-reviews-testimonials-final-rule"},
    ],
}
_NONCOMPLIANT = re.compile(
    r"\b(discount|coupon|gift ?card|free (gift|service|item|month)|reward|incentiv|in exchange for|"
    r"pay(ing)? for reviews?|buy(ing)? reviews?|purchase reviews?|fake reviews?|only (ask|invite|request)"
    r"[^.]{0,40}(happy|satisf|positive)|filter(ing)? (out )?(unhappy|negative|dissatisfied)|"
    r"review gating|gate reviews?|remove (negative|bad) reviews?|flag (all|every) negative)\b", re.I)


# ── Dates ────────────────────────────────────────────────────────────────────
def _parse(iso):
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ── Fetching ─────────────────────────────────────────────────────────────────
def normalise(r, idx):
    resp = r.get("response") or {}
    text = r.get("snippet") or (r.get("extracted_snippet") or {}).get("original") or ""
    return {"id": "r%d" % idx, "rating": r.get("rating"), "text": text.strip(),
            "date": r.get("iso_date") or "", "when": r.get("date") or "",
            "likes": r.get("likes") or 0,
            "reply": ({"date": resp.get("iso_date") or "", "text": (resp.get("snippet") or "").strip()}
                      if resp else None)}


def fetch(place_id, ledger, pages=None):
    """Newest reviews for one place, and Google's topic chips. ({"reviews", "topics", "pages"})"""
    key = lbr_config.key_for("serpapi")
    if not key:
        raise lbr_http.ToolError("serpapi", "SerpAPI is not configured (SERPAPI_KEY).")
    pages = pages or lbr_config.MAX_REVIEW_PAGES
    reviews, topics, token, used = [], [], None, 0
    for page in range(pages):
        params = {"engine": "google_maps_reviews", "place_id": place_id, "sort_by": "newestFirst",
                  "hl": "en", "api_key": key}
        if token:
            params.update(next_page_token=token, num=20)
        data = lbr_http.call(ledger, "serpapi", "maps_reviews", "GET", SERP_URL, params=params,
                             price_op="serpapi.search", timeout=40)
        used += 1
        if page == 0:
            topics = [{"keyword": t.get("keyword"), "mentions": t.get("mentions")}
                      for t in (data.get("topics") or []) if t.get("keyword")][:12]
        for r in data.get("reviews") or []:
            reviews.append(normalise(r, len(reviews) + 1))
        token = (data.get("serpapi_pagination") or {}).get("next_page_token")
        if not token:
            break
    return {"reviews": reviews, "topics": topics, "pages": used}


# ── The numbers ──────────────────────────────────────────────────────────────
def stats(reviews, total_on_profile=None, now=None):
    """Everything countable about a set of reviews."""
    now = now or datetime.now(timezone.utc)
    rated = [r for r in reviews if isinstance(r.get("rating"), (int, float))]
    n = len(rated)
    out = {"sample": n, "total": total_on_profile, "mix": {str(s): 0 for s in range(1, 6)},
           "positive": 0, "neutral": 0, "negative": 0, "avg": None, "recent_90d": 0, "recent_avg": None,
           "last_days": None, "per_month": None, "trend": None, "reply_rate": None,
           "negative_reply_rate": None, "reply_days_median": None, "unanswered_negative": 0}
    if not n:
        return out
    for r in rated:
        out["mix"][str(int(round(r["rating"])))] += 1
    pos = sum(1 for r in rated if r["rating"] >= 4)
    neg = sum(1 for r in rated if r["rating"] <= 2)
    out.update(positive=round(100 * pos / n), negative=round(100 * neg / n),
               neutral=100 - round(100 * pos / n) - round(100 * neg / n),
               avg=round(sum(r["rating"] for r in rated) / n, 2))
    dated = [(d, r) for r in rated for d in [_parse(r.get("date"))] if d]
    if dated:
        dated.sort(key=lambda x: x[0], reverse=True)
        ages = [(now - d).days for d, _ in dated]
        recent = [r for (d, r), a in zip(dated, ages) if a <= 90]
        out["recent_90d"] = len(recent)
        out["recent_avg"] = round(sum(r["rating"] for r in recent) / len(recent), 2) if recent else None
        out["last_days"] = max(0, ages[0])
        span = max(1, ages[-1] - ages[0])
        if len(dated) >= 3:
            out["per_month"] = round(len(dated) / (span / 30.4), 1)
        if len(dated) >= 8:
            half = len(dated) // 2
            newer = sum(r["rating"] for _, r in dated[:half]) / half
            older = sum(r["rating"] for _, r in dated[half:]) / (len(dated) - half)
            out["trend"] = round(newer - older, 2)
    replied = [r for r in rated if r.get("reply")]
    out["reply_rate"] = round(100 * len(replied) / n)
    negs = [r for r in rated if r["rating"] <= 3]
    if negs:
        out["negative_reply_rate"] = round(100 * sum(1 for r in negs if r.get("reply")) / len(negs))
    out["unanswered_negative"] = sum(1 for r in rated if r["rating"] <= 2 and not r.get("reply"))
    lags = sorted(max(0, (rd - d).days) for r in replied
                  for d, rd in [(_parse(r.get("date")), _parse((r.get("reply") or {}).get("date")))] if d and rd)
    if lags:
        out["reply_days_median"] = lags[len(lags) // 2]
    return out


# ── The themes ───────────────────────────────────────────────────────────────
_THEMES_SYSTEM = """You analyse customer reviews of one local business for a marketing agency that
will pitch its services to that business. Answer with ONE JSON object and nothing else:
{
 "summary": "two sentences: how customers see this business, plainly",
 "praise": [{"theme": "short", "review_ids": ["r3", "r7"]}],
 "complaints": [{"theme": "short", "severity": "high|medium|low", "review_ids": ["r2"]}],
 "fixes": ["an operational change the complaints point to"],
 "review_plan": ["a compliant way to earn more genuine reviews"],
 "reply_drafts": [{"review_id": "r2", "draft": "a calm, specific owner reply"}]
}
Rules:
- Cite only review ids that appear in the input. Every theme needs at least one id.
- At most 4 praise themes, 4 complaint themes, 4 fixes, 4 review_plan items, 2 reply drafts.
- reply_drafts: only for reviews of 1-2 stars that have NO owner reply. Never admit legal liability,
  never share private details, never argue.
- review_plan must be lawful: never suggest buying, faking, rewarding, discounting for, or
  incentivising reviews, and never suggest asking only happy customers or filtering out unhappy
  ones ("review gating"). Google's policy and the FTC rule (16 CFR Part 465) prohibit these.
- Do not invent facts about the business beyond what the reviews say."""


def _clean_list(items, limit=4):
    return [str(x).strip()[:240] for x in (items or []) if str(x).strip()][:limit]


def themes(name, reviews, st, ledger):
    """Claude's reading of the reviews, with every quote checked. None when not possible."""
    texts = [r for r in reviews if r.get("text")][:MAX_TEXTS]
    if not texts or not lbr_config.key_for("claude"):
        return None
    lines = []
    for r in texts:
        reply = " [owner replied]" if r.get("reply") else " [no owner reply]"
        lines.append("%s | %s stars | %s%s | %s" % (r["id"], r["rating"], (r.get("date") or "")[:10], reply,
                                                    r["text"][:MAX_TEXT_CHARS].replace("\n", " ")))
    user = ("Business: %s\nAverage in sample: %s from %d reviews; %d%% positive, %d%% negative.\n\n"
            "Reviews (id | stars | date | reply | text):\n%s") % (
        name, st.get("avg"), st.get("sample"), st.get("positive"), st.get("negative"), "\n".join(lines))
    try:
        obj = lbr_claude.ask_json(_THEMES_SYSTEM, user, ledger, max_tokens=1800, purpose="review_themes",
                                  require=("praise", "complaints"))
    except lbr_claude.ClaudeError as exc:
        return {"error": str(exc)}
    by_id = {r["id"]: r for r in reviews}

    def theme_list(items, with_severity=False):
        out = []
        for t in (items or [])[:4]:
            ids = [i for i in (t.get("review_ids") or []) if i in by_id]
            if not ids or not str(t.get("theme") or "").strip():
                continue
            q = by_id[ids[0]]
            entry = {"theme": str(t["theme"]).strip()[:80], "mentions": len(ids),
                     "quote": q["text"][:280], "quote_stars": q["rating"], "review_ids": ids[:6]}
            if with_severity:
                entry["severity"] = t.get("severity") if t.get("severity") in ("high", "medium", "low") else "medium"
            out.append(entry)
        return out
    drafts = []
    for d in (obj.get("reply_drafts") or [])[:2]:
        r = by_id.get(d.get("review_id"))
        if r and not r.get("reply") and (r.get("rating") or 5) <= 2 and str(d.get("draft") or "").strip():
            drafts.append({"review_id": r["id"], "review": r["text"][:280], "stars": r["rating"],
                           "draft": str(d["draft"]).strip()[:700]})
    plan = [p for p in _clean_list(obj.get("review_plan")) if not _NONCOMPLIANT.search(p)]
    fixes = [f for f in _clean_list(obj.get("fixes")) if not _NONCOMPLIANT.search(f)]
    return {"summary": str(obj.get("summary") or "").strip()[:400],
            "praise": theme_list(obj.get("praise")),
            "complaints": theme_list(obj.get("complaints"), True),
            "fixes": fixes, "review_plan": plan, "reply_drafts": drafts}


# ── The stage ────────────────────────────────────────────────────────────────
def run(selected, profiles, ledger, *, on_progress=None, should_stop=None, prefetched=None):
    """Reviews, numbers and themes for every selected business. {place_id: finding}

    `prefetched` ({place_id: {"reviews", "topics"}}) holds reviews already read
    by Apify with each business's detail page; those are not fetched again.
    """
    ids = [pid for pid in selected if pid in profiles]
    fetched = {}

    def get(pid):
        if should_stop and should_stop():
            return pid, None
        if not profiles[pid].get("reviews"):
            return pid, {"reviews": [], "topics": [], "pages": 0}
        if prefetched is not None:
            got = prefetched.get(pid)
            if got is None:
                return pid, {"error": "Apify could not open this business's reviews."}
            return pid, {"reviews": got.get("reviews") or [], "topics": got.get("topics") or [], "pages": 1}
        try:
            return pid, fetch(pid, ledger)
        except lbr_http.ToolError as exc:
            return pid, {"error": str(exc)}
    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
        for i, (pid, res) in enumerate(pool.map(get, ids), 1):
            if res is not None:
                fetched[pid] = res
            if on_progress and i % 10 == 0:
                on_progress({"stage": "reviews", "done": i, "of": len(ids)})

    def analyse(pid):
        f = fetched[pid]
        if "error" in f:
            return pid, {"error": f["error"], "stats": stats([], profiles[pid].get("reviews"))}
        st = stats(f["reviews"], profiles[pid].get("reviews"))
        th = None if (should_stop and should_stop()) else themes(profiles[pid]["name"], f["reviews"], st, ledger)
        recent = [{"stars": r["rating"], "text": r["text"][:280], "date": r["date"][:10],
                   "replied": bool(r.get("reply"))} for r in f["reviews"][:6]]
        return pid, {"stats": st, "topics": f["topics"], "themes": th, "recent": recent,
                     "pages": f.get("pages", 0)}
    out = {}
    with ThreadPoolExecutor(max_workers=THEME_WORKERS) as pool:
        for pid, res in pool.map(analyse, list(fetched)):
            out[pid] = res
    return out
