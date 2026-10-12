"""Account Mapper, phase 4: what the facts say about each account.

    rank_accounts(summary)                                 # free: priority and its reasons
    brief_accounts(summary, model=..., budget=...)         # Claude: one brief per account

Priority is plain arithmetic over the facts mapping found (free). The brief
is one Claude call per account, built only from those facts and from the
company's own pages (about, careers, news; read free, robots.txt respected),
with the source of every claim. It says what the company does, what
changed, who to contact first and why, and gives one opening line per
person picked. A run's Claude spending is capped like every other run's.
"""
from __future__ import annotations

import re
from urllib.parse import urljoin, urlsplit

from . import account_mapper as am

SITE_PATHS = ("/about", "/about-us", "/company", "/careers", "/jobs", "/news", "/press", "/blog")
MAX_SITE_PAGES = 5
SITE_CHARS_PER_PAGE = 2500
BRIEF_MAX_TOKENS = 1600


# == priority (free) =====================================================================

def priority(c):
    """0..100 and the reasons, from what mapping found: a new person in the
    seat you sell to, hiring for it, money raised, and how much of the
    buying group was found."""
    score, reasons = 0, []
    roles = c.get("roles") or []
    ins = c.get("insights") or {}
    sig = ins.get("signals") or {}
    new_buyers = [p for r in roles for p in r.get("picked") or [] if p.get("new_in_role")]
    if new_buyers:
        score += 30
        reasons.append("%s started in the role you sell to in the last year" %
                       ", ".join("%s (%s)" % (p["name"], p.get("title") or "") for p in new_buyers[:2]))
    elif (ins.get("new_leaders") or {}).get("total"):
        score += 10
        reasons.append("%d leader%s new in the last year" % (ins["new_leaders"]["total"],
                                                             "" if ins["new_leaders"]["total"] == 1 else "s"))
    if sig.get("hiring_your_titles"):
        score += 20
        reasons.append("hiring for the titles you sell to")
    elif sig.get("hiring"):
        score += 5
        reasons.append("hiring")
    if sig.get("funded_last_year"):
        score += 20
        reasons.append("raised money in the last year")
    if roles:
        found = sum(1 for r in roles if r.get("picked") or r.get("web"))
        score += int(30 * found / len(roles))
        reasons.append("%d of %d titles found" % (found, len(roles)))
    return {"score": min(score, 100), "reasons": reasons}


def rank_accounts(summary):
    for c in summary.get("companies") or []:
        c["priority"] = priority(c)
    order = sorted(range(len(summary.get("companies") or [])),
                   key=lambda i: -summary["companies"][i]["priority"]["score"])
    summary["ranking"] = [summary["companies"][i]["name"] for i in order]
    return summary["ranking"]


# == the company's own pages (free) ==========================================================

def read_pages(domain, fetch=None, fetch_text=None):
    """About, careers and news pages, robots.txt respected. {url: text}"""
    from . import market_radar_site as site
    fetch = fetch or site.fetch
    fetch_text = fetch_text or site.fetch_text
    home = "https://%s/" % domain
    rules, _ = site.parse_robots(fetch_text(urljoin(home, "/robots.txt")) or "")
    pages, notes = {}, []
    first = fetch(home)
    if first["status"] != "ok":
        return pages, [{"url": home, "status": first["status"], "note": first.get("note") or ""}]
    base = first.get("final_url") or home
    pages[base] = first["text"][:SITE_CHARS_PER_PAGE]
    for path in SITE_PATHS:
        if len(pages) >= MAX_SITE_PAGES:
            break
        if not site.allowed(path, rules):
            notes.append({"url": urljoin(base, path), "status": "robots", "note": "robots.txt asks us not to"})
            continue
        page = fetch(urljoin(base, path))
        final = page.get("final_url") or urljoin(base, path)
        if page["status"] == "ok" and urlsplit(final).path.rstrip("/") not in ("", "/") and final not in pages:
            pages[final] = page["text"][:SITE_CHARS_PER_PAGE]
        notes.append({"url": urljoin(base, path), "status": page["status"], "note": page.get("note") or ""})
    return pages, notes


# == the brief (Claude) =======================================================================

BRIEF_SYSTEM = (
    "You brief a B2B sales team on one target account. Use ONLY the facts given: the company "
    "profile, the people found with their titles and time in role, counts and signals from a "
    "contact database, and text from the company's own website. Never invent numbers, news, "
    "products or people. Every claim in 'changes' names its source exactly as given (\"Saleshandy\" or "
    "the page URL). Choose who to contact first among the people listed, and say why in one "
    "sentence. Write one short opening line per person listed: specific to their role and to a fact "
    "given, no flattery, no clichés, no exclamation marks. If the facts are thin, say so in "
    "'watch_outs' rather than padding.")
BRIEF_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["one_liner", "shape", "changes", "first_contact", "openers", "watch_outs"],
    "properties": {
        "one_liner": {"type": "string"},
        "shape": {"type": "string"},
        "changes": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                               "required": ["text", "source"],
                                               "properties": {"text": {"type": "string"},
                                                              "source": {"type": "string"}}}},
        "first_contact": {"type": "object", "additionalProperties": False, "required": ["name", "why"],
                          "properties": {"name": {"type": ["string", "null"]}, "why": {"type": "string"}}},
        "openers": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                               "required": ["name", "line"],
                                               "properties": {"name": {"type": "string"},
                                                              "line": {"type": "string"}}}},
        "watch_outs": {"type": "array", "items": {"type": "string"}},
    }}


def facts(c, pages):
    """The text Claude reads for one account."""
    co = (c.get("resolved") or {}).get("company") or {}
    ins = c.get("insights") or {}
    lines = ["ACCOUNT: %s (%s)" % (c.get("display_name") or c["name"], c.get("domain") or "domain unknown")]
    prof = [("industry", co.get("industry")), ("employees", co.get("employees")), ("founded", co.get("founded")),
            ("HQ", co.get("hq")), ("type", co.get("type"))]
    lines.append("PROFILE (Saleshandy): " + "; ".join("%s %s" % (k, v) for k, v in prof if v) or "none")
    if ins:
        teams = ", ".join("%s %s" % (t["department"], t["people"]) for t in ins.get("teams") or [])
        lines.append("COUNTS (Saleshandy): %s people listed; %s decision-makers%s" % (
            ins.get("people_in_saleshandy"), ins.get("decision_makers"), ("; teams: " + teams) if teams else ""))
        nl = ins.get("new_leaders") or {}
        if nl.get("total"):
            lines.append("NEW IN A LEADERSHIP ROLE IN THE LAST YEAR (Saleshandy): %d, including %s" % (
                nl["total"], "; ".join("%s, %s" % (p["name"], p.get("title") or "") for p in nl.get("people") or [])))
        sig = ins.get("signals") or {}
        if sig:
            lines.append("SIGNALS (Saleshandy): hiring %s; hiring for the target titles %s; funding announced in "
                         "the last year %s" % tuple("yes" if sig.get(k) else "not shown"
                                                    for k in ("hiring", "hiring_your_titles", "funded_last_year")))
    lines.append("PEOPLE FOUND:")
    n = 0
    for r in c.get("roles") or []:
        for p in (r.get("picked") or []) + (r.get("web") or []):
            n += 1
            bits = [p.get("title") or "", "asked for: " + r["role"]]
            if p.get("new_in_role"):
                bits.append("new in role in the last year")
            if p.get("experience_years"):
                bits.append("%s years' experience" % p["experience_years"])
            if p.get("decision_maker"):
                bits.append("decision-maker")
            if p.get("location"):
                bits.append(p["location"])
            lines.append("- %s: %s" % (p.get("name"), "; ".join(b for b in bits if b)))
    if not n:
        lines.append("- nobody")
    for url, text in pages.items():
        lines.append("WEBSITE PAGE %s:\n%s" % (url, re.sub(r"\s+", " ", text).strip()))
    return "\n".join(lines)


def brief(c, pages, *, model, budget, call=None):
    from . import contact_lab as lab
    call = call or lab._json_call
    got = call(budget, "brief", model, BRIEF_SYSTEM, facts(c, pages), BRIEF_SCHEMA, BRIEF_MAX_TOKENS)
    names = {p.get("name") for r in c.get("roles") or [] for p in (r.get("picked") or []) + (r.get("web") or [])}
    # Openers and the first contact only for people actually listed.
    got["openers"] = [o for o in got.get("openers") or [] if o.get("name") in names]
    fc = got.get("first_contact") or {}
    if fc.get("name") and fc["name"] not in names:
        got["first_contact"] = {"name": None, "why": fc.get("why") or ""}
    return got


def estimate_usd(n_accounts, model):
    """A typical brief reads about 4,000 tokens and writes about 700."""
    from . import market_radar_costs as costs
    rates = costs._model_rates(model)[1]
    per = (4000 * rates[0] + 700 * rates[4]) / costs.M
    return round(float(per * n_accounts), 4)


def brief_accounts(summary, *, model, budget, progress=None, read_site=True, reader=None, call=None):
    """Priority for every account (free), then a brief per account, best
    first, until the budget stops it."""
    from . import contact_lab_search as search
    say = progress or (lambda s: None)
    reader = reader or read_pages
    rank_accounts(summary)
    by_name = {c["name"]: c for c in summary.get("companies") or []}
    written = 0
    for name in summary["ranking"]:
        c = by_name[name]
        pages = {}
        if read_site and c.get("domain"):
            say("%s: reading its website" % name)
            try:
                pages, notes = reader(c["domain"])
                c["site"] = {"pages": list(pages), "notes": notes}
            except Exception as e:
                c["site"] = {"pages": [], "notes": [{"status": "error", "note": "%s" % type(e).__name__}]}
        say("%s: writing the brief" % name)
        try:
            c["brief"] = brief(c, pages, model=model, budget=budget, call=call)
            written += 1
        except search.BudgetExceeded as e:
            summary["brief_stopped"] = "Stopped at the cost cap: %s" % e
            break
        except Exception as e:
            c["brief_error"] = "%s: %s" % (type(e).__name__, str(e)[:200])
    return written
