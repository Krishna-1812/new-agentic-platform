"""Account Mapper: company names and the job titles you sell to in; for
every company, the right people and a picture of the account out.
Built around Saleshandy's Lead Finder (tracker/saleshandy_client.py).
The plan: docs/account-mapper-plan.md.

    summary = map_accounts(settings, client, progress=print)     # free

Mapping is free: Saleshandy charges nothing for searches, only for
revealing a contact. For each company:

  1. RESOLVE  the name to one company and its domain (a domain you give
              wins; otherwise company search, closest name first);
  2. MAP      people per job title: the title's phrasings at that domain,
              minus words that mean "not this job"; when nobody matches,
              broadened to the title's seniority and department, then to the
              company's name; every attempt recorded;
  3. RANK     candidates per title; the best few are picked, the rest kept
              as "also found";
  4. INSIGHT  a few counting searches (capped): team sizes, decision-makers,
              who is new in their role, new leaders, and whether the company
              is hiring (for your titles too) or raised money in the last year.

Revealing emails (credits, only with approval) and the account brief
(Claude, optional) build on this summary.
"""
from __future__ import annotations

import datetime as dt
import math
import re
from decimal import Decimal

from . import saleshandy_client as sh

MAX_COMPANIES = 25
MAX_ROLES = 6
DEFAULT_PER_ROLE = 2
MAX_PER_ROLE = 5
MAX_ALSO = 8
MAX_NEW_LEADERS = 8
PICK_MIN_SCORE = 40
DEFAULT_CLAUDE_CAP_USD = Decimal("0.50")    # the least a run's Claude cap is
MAX_CLAUDE_CAP_USD = Decimal("3.00")

# == input ===========================================================================

def parse_companies(text):
    """One company a line, optionally "Name | domain.com" (the Contact
    Finder Lab's reader, in chunks, so a run can take more companies)."""
    from . import contact_lab as lab
    lines = [l for l in (text or "").splitlines() if l.strip()]
    if not lines:
        raise ValueError("give at least one company")
    if len(lines) > MAX_COMPANIES:
        raise ValueError("at most %d companies per run" % MAX_COMPANIES)
    out, seen = [], set()
    for i in range(0, len(lines), lab.MAX_COMPANIES):
        for c in lab.parse_companies("\n".join(lines[i:i + lab.MAX_COMPANIES])):
            if c["name"].lower() not in seen:
                seen.add(c["name"].lower())
                out.append(c)
    return out


def parse_roles(text):
    roles = []
    for part in re.split(r"[\n;]+", text or ""):
        part = part.strip()
        if part and part.lower() not in (r.lower() for r in roles):
            if len(part) > 80:
                raise ValueError("a job title is at most 80 characters")
            roles.append(part)
    if not roles:
        raise ValueError("give at least one job title")
    if len(roles) > MAX_ROLES:
        raise ValueError("at most %d job titles per run" % MAX_ROLES)
    return roles


# == job titles → search filters ======================================================

ABBREVIATIONS = {
    "ceo": "chief executive officer", "cfo": "chief financial officer", "coo": "chief operating officer",
    "cto": "chief technology officer", "cmo": "chief marketing officer", "cro": "chief revenue officer",
    "cio": "chief information officer", "ciso": "chief information security officer",
    "cpo": "chief product officer", "chro": "chief human resources officer", "cco": "chief commercial officer",
    "cdo": "chief data officer", "cso": "chief strategy officer", "cgo": "chief growth officer",
    "vp": "vice president", "svp": "senior vice president", "evp": "executive vice president",
    "avp": "assistant vice president", "gm": "general manager", "md": "managing director",
    "hr": "human resources", "bd": "business development", "it": "information technology",
}
REVERSE_ABBREVIATIONS = {v: k for k, v in ABBREVIATIONS.items() if k not in ("it", "hr", "bd")}

# Words in a title that mean the person is not in the job asked for.
EXCLUDE_WORDS = ("assistant", "intern", "internship", "former", "trainee", "apprentice", "student", "freelance",
                 "aspiring", "retired", "advisor to", "executive assistant")

# Saleshandy's management_level values (GET /search/filters; the API reference).
LEVEL_RULES = (
    (r"\b(chief|c[a-z]o|cxo)\b", "C-Level"),
    (r"\b(vice president|vp|svp|evp|avp|president)\b", "President/Vice President"),
    (r"\bfounder|co-founder|cofounder\b", "Founder"),
    (r"\bowner\b", "Owner"),
    (r"\bpartner\b", "Partner"),
    (r"\bdirector|managing director\b", "Director"),
    (r"\bhead\b", "Head"),
    (r"\bmanager|lead\b", "Manager"),
    (r"\bsenior|sr\b", "Senior"),
    (r"\bspecialist|executive|associate|coordinator\b", "Specialist"),
)
LEVEL_RANK = {"C-Level": 9, "Founder": 9, "Owner": 8, "President/Vice President": 8, "Partner": 7, "Director": 6,
              "Head": 6, "Manager": 4, "Senior": 3, "Specialist": 2, "Intern": 0}

# Saleshandy's department values.
DEPARTMENT_RULES = (
    (r"\b(marketing|growth|brand|demand gen|demand generation|content|seo|communications|cmo|cgo)\b", "Marketing"),
    (r"\b(sales|revenue|business development|account executive|partnerships|commercial|cro|cco)\b", "Sales"),
    (r"\b(finance|financial|accounting|controller|treasury|cfo)\b", "Finance & Accounting"),
    (r"\b(human resources|hr|people|talent|recruiting|recruitment|chro)\b", "Human Resources"),
    (r"\b(engineering|technology|technical|software|developer|it|information technology|data|security|cto|cio|"
     r"ciso|cdo|infrastructure|devops)\b", "Engineering and Technical"),
    (r"\b(product|cpo)\b", "Product"),
    (r"\b(operations|coo|supply chain|logistics|procurement|purchasing)\b", "Operations"),
    (r"\b(legal|counsel|compliance)\b", "Legal"),
    (r"\b(design|creative|ux)\b", "Design"),
    (r"\b(customer success|customer service|support|customer experience)\b", "Customer Service"),
    (r"\b(project|program|programme)\b", "Project Management"),
    (r"\b(research|r&d)\b", "Research"),
    (r"\b(medical|clinical|physician|doctor|nurse)\b", "Medical"),
    (r"\b(ceo|chief executive|founder|co-founder|(?<!vice )president|owner|managing director)\b", "C-Suite"),
)

LEADER_LEVELS = ["C-Level", "President/Vice President", "Founder", "Director", "Head"]


def _low(text):
    return re.sub(r"\s+", " ", (text or "").lower().replace("&", " and ")).strip()


def _expand(title):
    """The title with abbreviations spelled out, and spelled-out titles
    abbreviated: "VP Marketing" ↔ "Vice President Marketing", "CMO" ↔
    "Chief Marketing Officer"."""
    low = _low(title)
    out = []
    words = low.split()
    spelled = " ".join(ABBREVIATIONS.get(w.strip(",."), w) for w in words)
    if spelled != low:
        out.append(spelled)
    short = low
    for long, abbr in sorted(REVERSE_ABBREVIATIONS.items(), key=lambda kv: -len(kv[0])):
        short = re.sub(r"\b%s\b" % re.escape(long), abbr, short)
    if short != low:
        out.append(short)
    return out


def _reorders(title):
    """ "Head of Marketing" ↔ "Marketing Head"; "Director of Sales" ↔ "Sales Director"."""
    low = _low(title)
    m = re.match(r"^(head|director|vp|vice president|manager|lead) of (.+)$", low)
    if m:
        return ["%s %s" % (m.group(2), m.group(1))]
    m = re.match(r"^(vp|vice president|svp|evp|head|director) (?!of )(.+)$", low)
    if m:
        return ["%s of %s" % (m.group(1), m.group(2))]
    m = re.match(r"^(.+) (head|director|manager|lead)$", low)
    if m and " of " not in low:
        return ["%s of %s" % (m.group(2), m.group(1))]
    return []


def levels_for(title):
    low = _low(title)
    out = []
    for pattern, level in LEVEL_RULES:
        if re.search(pattern, low) and level not in out:
            out.append(level)
    return out[:2]


def departments_for(title):
    low = " ".join([_low(title)] + _expand(title))
    out = []
    for pattern, dept in DEPARTMENT_RULES:
        if re.search(pattern, low) and dept not in out:
            out.append(dept)
    return out[:3]


def role_plan(role, extra_variants=(), extra_exclude=()):
    """How one job title is searched: its phrasings, the words that rule a
    title out, and its seniority and department for broadening."""
    variants = []
    for v in [role] + _expand(role) + _reorders(role) + list(extra_variants):
        v = re.sub(r"\s+", " ", (v or "")).strip()
        if v and v.lower() not in (x.lower() for x in variants):
            variants.append(v)
    low_role = _low(role)
    exclude = [w for w in list(EXCLUDE_WORDS) + list(extra_exclude)
               if w and _low(w) not in low_role]
    seen, uniq = set(), []
    for w in exclude:
        if _low(w) not in seen:
            seen.add(_low(w))
            uniq.append(w)
    return {"role": role, "variants": variants[:8], "exclude": uniq[:12], "levels": levels_for(role),
            "departments": departments_for(role)}


def plan_roles(roles, *, use_claude=False, model=None, budget=None):
    """Every title's plan; Claude adds the phrasings people actually use
    when asked (one small call for all titles)."""
    extra = {}
    if use_claude:
        from . import contact_lab as lab
        for x in lab.expand_roles(roles, model=model, budget=budget, use_model=True):
            extra[x["role"].lower()] = x
    out = []
    for r in roles:
        x = extra.get(r.lower()) or {}
        out.append(role_plan(r, x.get("variants") or (), x.get("exclude") or ()))
    return out


# == resolving a company ==============================================================

def _name_words(name):
    from . import contact_lab as lab
    return [w for w in lab._words(name) if w not in lab.LEGAL_WORDS]


def name_score(asked, found):
    """How well a found company name matches the one asked for, 0..100."""
    a, f = _name_words(asked), _name_words(found)
    if not a or not f:
        return 0
    if a == f or "".join(a) == "".join(f):
        return 100
    sa, sf = set(a), set(f)
    if sa <= sf:          # "Stripe" vs "Stripe Payments"
        return 80 - 5 * min(len(sf - sa), 4)
    if sf <= sa:
        return 70 - 5 * min(len(sa - sf), 4)
    overlap = len(sa & sf) / len(sa | sf)
    return int(60 * overlap)


def pick_company(asked_name, candidates, domain=None):
    """The best candidate and the runners-up worth showing. A domain match
    wins outright; otherwise the closest name, the larger company breaking
    ties."""
    scored = []
    for c in candidates:
        s = name_score(asked_name, c.get("name") or "")
        if domain and c.get("domain") == domain:
            s += 200
        size = math.log10((c.get("employees") or 0) + 1)
        scored.append((s, size, bool(c.get("domain")), c))
    scored.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
    if not scored or scored[0][0] < 50:
        return None, [x[3] for x in scored[:4]]
    best = scored[0]
    others = [x[3] for x in scored[1:] if x[0] >= 50][:4]
    return dict(best[3], match_score=min(best[0], 100)), others


def resolve(company, client):
    """{"how", "company": card | None, "alternatives": [...], "domain"}"""
    name, given = company["name"], company.get("domain")
    if given:
        found = client.search_companies({"company_domain": {"includes": [given]}})["companies"]
        best, _ = pick_company(name, found, domain=given)
        card = best or next((c for c in found if c.get("domain") == given), None)
        return {"how": "domain you gave", "company": card, "alternatives": [], "domain": given}
    found = client.search_companies({"company_name": {"includes": [name]}})["companies"]
    best, others = pick_company(name, found)
    if best:
        how = "exact name" if best["match_score"] >= 100 else "closest name"
        return {"how": how, "company": best, "alternatives": others, "domain": best.get("domain")}
    return {"how": "not found", "company": None, "alternatives": others, "domain": None}


# == finding people ===================================================================

def _base(domain, name):
    return {"company_domain": {"includes": [domain]}} if domain else {"company_name": {"includes": [name]}}


def title_filter(plan):
    return {"includes": plan["variants"], "excludes": plan["exclude"], "exactMatch": 0}


def find_people(company_name, domain, plan, client):
    """Candidates for one title, trying narrower searches first. Returns
    (people, attempts)."""
    attempts = []
    tries = [("title at %s" % (domain or company_name), dict(_base(domain, company_name), job_title=title_filter(plan)))]
    if plan["levels"] and plan["departments"]:
        tries.append(("seniority + department at %s" % (domain or company_name),
                      dict(_base(domain, company_name),
                           management_level={"includes": plan["levels"]},
                           department={"includes": plan["departments"]})))
    if domain:
        tries.append(("title at company named %s" % company_name,
                      dict(_base(None, company_name), job_title=title_filter(plan))))
    for how, filters in tries:
        res = client.search_people(filters)
        people = res["people"]
        if "company_domain" not in filters:
            # A name search can bring in namesakes: keep people whose
            # employer has the domain, or a name close to the one asked for.
            people = [p for p in people if (domain and p.get("domain") == domain)
                      or name_score(company_name, p.get("company") or "") >= 70]
        attempts.append({"how": how, "total": res["total"], "kept": len(people)})
        if people:
            return people, attempts
    return [], attempts


def title_score(person, plan):
    """0..120: how well a person's current title fits the title asked for.
    None when a word in their title rules them out."""
    title = _low(person.get("title"))
    if not title:
        return None
    for w in plan["exclude"]:
        if re.search(r"\b%s\b" % re.escape(_low(w)), title):
            return None
    best = 0
    for i, v in enumerate(plan["variants"]):
        lv = _low(v)
        if title == lv:
            best = max(best, 100 - i)
        elif re.search(r"\b%s\b" % re.escape(lv), title):
            best = max(best, 75 - i)
    role_words = set(re.findall(r"[a-z0-9]+", " ".join(_low(v) for v in plan["variants"]))) - \
        {"of", "and", "the", "for", "in"}
    title_words = set(re.findall(r"[a-z0-9]+", " ".join([title] + _expand(title))))
    if role_words:
        best = max(best, int(55 * len(role_words & title_words) / len(role_words)))
    levels = levels_for(person.get("title"))
    if plan["levels"] and levels:
        if set(levels) & set(plan["levels"]):
            best += 10
        elif max(LEVEL_RANK.get(l, 0) for l in levels) < min(LEVEL_RANK.get(l, 0) for l in plan["levels"]) - 2:
            best -= 15     # a Manager when a Chief was asked for
    if plan["departments"] and person.get("department") in plan["departments"]:
        best += 5
    if person.get("decision_maker"):
        best += 5
    return max(0, min(best, 120))


def rank(people, plan, per_role):
    scored = []
    for p in people:
        s = title_score(p, plan)
        if s is not None:
            scored.append(dict(p, score=s))
    scored.sort(key=lambda p: (p["score"], p.get("decision_maker"), p.get("experience_years") or 0), reverse=True)
    picked = [p for p in scored if p["score"] >= PICK_MIN_SCORE][:per_role]
    ids = {p["id"] for p in picked}
    also = [p for p in scored if p["id"] not in ids][:MAX_ALSO]
    return picked, also


# == free insights ====================================================================

def insights(company_name, domain, plans, client, *, today=None):
    """Counting searches, capped: each answers one question about the
    account. A zero means Saleshandy shows nothing, not that there is
    nothing."""
    today = today or dt.date.today()
    base = _base(domain, company_name)
    out = {"searches": 0}

    def count(filters):
        out["searches"] += 1
        return client.count_people(dict(base, **filters))

    all_variants = [v for p in plans for v in p["variants"]][:30]
    out["people_in_saleshandy"] = count({})
    out["decision_makers"] = count({"decision_maker": True})
    depts = []
    for p in plans:
        for d in p["departments"]:
            if d not in depts and d != "C-Suite":
                depts.append(d)
    out["teams"] = [{"department": d, "people": count({"department": {"includes": [d]}})} for d in depts[:3]]

    out["searches"] += 1
    new_res = client.search_people(dict(base, job_title={"includes": all_variants, "exactMatch": 0},
                                        current_role_tenure={"min": "0", "max": "1"}))
    out["new_in_role_ids"] = [p["id"] for p in new_res["people"]]

    out["searches"] += 1
    leaders = client.search_people(dict(base, management_level={"includes": LEADER_LEVELS},
                                        current_role_tenure={"min": "0", "max": "1"}))
    out["new_leaders"] = {"total": leaders["total"],
                          "people": [{k: p.get(k) for k in ("id", "name", "title", "department", "photo")}
                                     for p in leaders["people"][:MAX_NEW_LEADERS]]}

    if domain:
        cbase = {"company_domain": {"includes": [domain]}}
        year_ago = (today - dt.timedelta(days=365)).isoformat()

        def probe(filters):
            out["searches"] += 1
            return client.search_companies(dict(cbase, **filters))["total"] > 0

        signals = {"hiring": probe({"active_job_postings_count": {"min": "1"}})}
        signals["hiring_your_titles"] = probe({"active_job_postings_title": {"includes": all_variants[:15]}}) \
            if signals["hiring"] else False
        signals["funded_last_year"] = probe({"last_funding_round_announced_date":
                                             {"min": year_ago, "max": today.isoformat()}})
        out["signals"] = signals
    return out


# == one company, a whole run ===========================================================

def map_company(company, plans, client, *, per_role=DEFAULT_PER_ROLE, with_insights=True, progress=None):
    say = progress or (lambda s: None)
    rec = {"name": company["name"], "input_domain": company.get("domain"), "domain": None, "resolved": None,
           "roles": [], "insights": None, "errors": []}
    say("finding the company")
    r = resolve(company, client)
    rec["resolved"] = r
    rec["domain"] = r["domain"]
    if r["company"] and r["company"].get("name"):
        rec["display_name"] = r["company"]["name"]
    seen = set()
    for plan in plans:
        say("looking for %s" % plan["role"])
        people, attempts = find_people(company["name"], rec["domain"], plan, client)
        people = [p for p in people if p["id"] not in seen]
        picked, also = rank(people, plan, per_role)
        seen |= {p["id"] for p in picked}
        rec["roles"].append({"role": plan["role"], "picked": picked, "also": also, "attempts": attempts,
                             "status": "found" if picked else ("close" if also else "not_found")})
    if with_insights:
        say("reading the account")
        try:
            rec["insights"] = insights(company["name"], rec["domain"], plans, client)
        except sh.AuthError:
            raise
        except sh.SaleshandyError as e:
            rec["errors"].append("insights: %s" % e)
        new_ids = set((rec["insights"] or {}).get("new_in_role_ids") or [])
        for role in rec["roles"]:
            for p in role["picked"] + role["also"]:
                p["new_in_role"] = p["id"] in new_ids
    return rec


def map_accounts(settings, client, *, progress=None, budget=None):
    """settings: {"companies": [{name, domain}], "roles": [str], "per_role": int,
    "insights": bool, "use_claude": bool, "model": str}. Free unless
    use_claude (one small call for the title phrasings, against `budget`)."""
    say = progress or (lambda s: None)
    per_role = max(1, min(int(settings.get("per_role") or DEFAULT_PER_ROLE), MAX_PER_ROLE))
    out = {"settings": {k: settings.get(k) for k in ("roles", "per_role", "insights", "use_claude", "model")},
           "plans": None, "companies": [], "stopped": None, "credits": None}
    try:
        out["credits"] = client.credits()
    except sh.AuthError:
        raise
    except sh.SaleshandyError as e:
        out["credits"] = {"error": str(e)}
    say("planning the job titles")
    try:
        out["plans"] = plan_roles(settings["roles"], use_claude=bool(settings.get("use_claude")),
                                  model=settings.get("model"), budget=budget)
    except Exception as e:
        out["plans"] = plan_roles(settings["roles"])
        out["plan_note"] = "Claude's phrasings were skipped (%s: %s)" % (type(e).__name__, str(e)[:160])
    companies = settings["companies"]
    for i, company in enumerate(companies, 1):
        def step(s, i=i, n=company["name"]):
            say("company %d/%d (%s): %s" % (i, len(companies), n, s))
        try:
            out["companies"].append(map_company(company, out["plans"], client, per_role=per_role,
                                                with_insights=settings.get("insights", True), progress=step))
        except sh.RateLimited as e:
            out["stopped"] = "Stopped: %s. The companies before it are kept." % e
            break
        except sh.AuthError:
            raise
        except sh.SaleshandyError as e:
            out["companies"].append({"name": company["name"], "input_domain": company.get("domain"),
                                     "domain": company.get("domain"), "resolved": None, "roles": [],
                                     "insights": None, "errors": [str(e)]})
        if settings.get("on_company"):
            settings["on_company"](out)
    out["totals"] = totals(out["companies"])
    out["requests"] = len(client.log)
    return out


def totals(companies):
    roles = [r for c in companies for r in c.get("roles") or []]
    return {
        "companies": len(companies),
        "companies_resolved": sum(1 for c in companies if c.get("domain")),
        "titles": len(roles),
        "titles_found": sum(1 for r in roles if r["status"] == "found"),
        "titles_close": sum(1 for r in roles if r["status"] == "close"),
        "people_picked": sum(len(r["picked"]) for r in roles),
        "people_also": sum(len(r["also"]) for r in roles),
        "new_in_role": sum(1 for r in roles for p in r["picked"] if p.get("new_in_role")),
        "searches": sum(((c.get("insights") or {}).get("searches") or 0) for c in companies),
    }


# == what a run could cost, before it runs ================================================

def estimate(n_companies, n_roles, *, use_claude=False, web_fill=False, briefs=False, model=None):
    """Mapping is free. Credits are spent only on a reveal you approve: by
    default the best person per title, 1 credit each when an email is found.
    Claude (optional) is capped per run."""
    from . import account_mapper_brief as ab
    from . import market_radar_costs as costs
    usd = Decimal(0)
    web_max = n_companies * n_roles if web_fill else 0
    if use_claude or web_fill or briefs:
        rates = costs._model_rates(model)[1]
        if use_claude:
            usd += (Decimal(600) * rates[0] + Decimal(1200) * rates[4]) / costs.M
        if web_fill:
            # About a third of titles go unfound; each search is $0.01 plus
            # the results it reads.
            per = Decimal("0.01") + Decimal(6000) * rates[0] / costs.M + Decimal(150) * rates[4] / costs.M
            usd += per * Decimal(max(1, round(web_max / 3)))
        if briefs:
            usd += Decimal(str(ab.estimate_usd(n_companies, model)))
    return {"free_searches": n_companies * (1 + 2 * n_roles + 8), "credits_default": n_companies * n_roles,
            "credits_note": "at most 1 credit per person revealed, only when an email is found",
            "usd_typical": round(float(usd), 4), "usd_cap": float(claude_cap(usd)),
            "web_searches_max": web_max, "claude": bool(use_claude or web_fill or briefs)}


def claude_cap(typical_usd):
    """A run's Claude cap: twice its estimate, between $0.50 and $3.00."""
    cap = max(DEFAULT_CLAUDE_CAP_USD, (Decimal(str(typical_usd)) * 2).quantize(Decimal("0.01")))
    return min(cap, MAX_CLAUDE_CAP_USD)
