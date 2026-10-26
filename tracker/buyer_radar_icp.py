"""Lead Finder: people who fit an offer's ideal customer profile (ICP), at the moment something changed for
them, from Saleshandy's lead database.

A post, a comment or a job ad is someone showing a need. An ICP finds the people likely to have it before
they say so: the title, seniority, department, industry, size and place of the people an offer sells to,
narrowed by a trigger that makes now a good time:

    new_in_role       started their job in the last few months (Saleshandy: jobs_changed_within)
    recently_funded   their company raised money recently (company signal "Recently Funded",
                      "Freshly Funded & Hiring Fast")
    gtm_hires         their company just hired new sales or marketing executives ("New Executive Hires in GTM")
    rapid_growth      their company is growing fast ("Rapid Growth")
    uses_tech         their company uses a product named (a rival, or one the offer works with)
    hiring_for        their company advertises jobs with these titles
    none              fit alone

Searching Saleshandy is free; only revealing an email costs a credit (one, about $0.026). So a run finds
the people and writes them a message; their email is revealed when the team asks, or automatically for
the strong ones when "Find work emails" is on.

    TRIGGERS, DEFAULT_ICPS            the triggers, and each offer's starting ICPs
    clean_icp(raw, offer)             one ICP, checked; raises ValueError in words for the page
    people_filters(icp)               Saleshandy's people-search filters for an ICP
    company_filters(icp)              its company-search filters, when the trigger is about the company
    find([(offer, icp)], client=, per_icp=, known=) -> ([(offer, icp, signal, score)], notes)
    score(icp, person) -> 0..100
"""
from __future__ import annotations

import re
import time

TRIGGERS = {
    "new_in_role": "New in their role",
    "recently_funded": "Recently funded",
    "gtm_hires": "New sales or marketing leaders",
    "rapid_growth": "Growing fast",
    "uses_tech": "Uses a product",
    "hiring_for": "Hiring for the work",
    "none": "Fit alone",
}
# Saleshandy's company signals (SearchCompaniesOpenAPIDto.signalIds, its OpenAPI, read 2026-10-21)
SIGNAL_IDS = {"rapid_growth": [1], "recently_funded": [2, 5], "gtm_hires": [3]}
COMPANY_TRIGGERS = ("recently_funded", "gtm_hires", "rapid_growth", "uses_tech", "hiring_for")
WHY_NOW = {
    "new_in_role": "started in their role in the last %(months)d months",
    "recently_funded": "their company raised money recently",
    "gtm_hires": "their company just hired new sales or marketing leaders",
    "rapid_growth": "their company is growing fast",
    "uses_tech": "their company uses %(tech)s",
    "hiring_for": "their company is hiring for %(hiring)s",
    "none": "",
}
TRIGGER_POINTS = {"new_in_role": 20, "recently_funded": 18, "gtm_hires": 15, "hiring_for": 18, "uses_tech": 15,
                  "rapid_growth": 12, "none": 0}
LEVELS = ["C-Level", "Founder", "Owner", "President/Vice President", "Partner", "Director", "Head", "Manager", "Senior"]
LIST_FIELDS = ("titles", "levels", "departments", "industries", "locations", "keywords", "technologies", "hiring")
MAX_ICPS = 6
MAX_ITEMS = 15
PER_ICP = 25          # people a run takes from each ICP
MAX_PAGES = 5         # pages of Saleshandy's results (25 a page) a run reads past people already met
COMPANIES = 15        # companies a company-trigger ICP looks inside
RATE_WAIT_S = 60      # when Saleshandy says slow down: wait this long, then search the profile again
RATE_RETRIES = 1      # such waits for one profile
RATE_GIVE_UP = 2      # profiles in a row it still refuses: the rest wait for the next search

DEFAULT_ICPS = {
    "callvibe": [
        {"name": "New sales leaders at inside-sales teams", "trigger": "new_in_role", "months": 3,
         "titles": ["VP Sales", "Head of Sales", "Director of Sales", "Head of Inside Sales", "Chief Revenue Officer"],
         "levels": ["C-Level", "President/Vice President", "Director", "Head"], "departments": ["Sales"],
         "industries": ["Financial Services", "Insurance", "Real Estate", "Education", "Software Development",
                        "Hospitals and Health Care"], "size_min": 50, "size_max": 2000, "locations": ["India"]},
        {"name": "Support and quality heads at contact centres", "trigger": "none",
         "titles": ["Head of Customer Support", "Head of Quality", "Quality Manager", "Head of Customer Experience",
                    "Contact Center Manager"],
         "levels": ["President/Vice President", "Director", "Head", "Manager"],
         "departments": ["Customer Service", "Operations"],
         "industries": ["Outsourcing and Offshoring Consulting", "Business Process Outsourcing", "Telecommunications",
                        "Financial Services", "Insurance"], "size_min": 100, "size_max": 10000, "locations": ["India"]},
        {"name": "Sales leaders at companies on Gong or Chorus", "trigger": "uses_tech",
         "technologies": ["Gong", "Chorus", "Avoma", "Fireflies"],
         "titles": ["VP Sales", "Head of Sales", "Sales Enablement", "Revenue Operations"],
         "levels": ["C-Level", "President/Vice President", "Director", "Head"], "departments": ["Sales"],
         "size_min": 20, "size_max": 1000},
    ],
    "markify": [
        {"name": "New marketing leaders at growing companies", "trigger": "new_in_role", "months": 3,
         "titles": ["CMO", "VP Marketing", "Head of Marketing", "Marketing Director", "Head of Growth"],
         "levels": ["C-Level", "President/Vice President", "Director", "Head"], "departments": ["Marketing"],
         "size_min": 11, "size_max": 500},
        {"name": "Founders of companies that just raised", "trigger": "recently_funded",
         "titles": ["Founder", "Co-Founder", "CEO"], "levels": ["Founder", "C-Level", "Owner"],
         "departments": ["C-Suite"], "size_min": 5, "size_max": 200},
        {"name": "Companies hiring their first marketers", "trigger": "hiring_for",
         "hiring": ["Performance Marketing", "Digital Marketing", "SEO", "Growth Marketing", "Paid Media"],
         "titles": ["CEO", "Founder", "CMO", "Head of Marketing", "VP Marketing"],
         "levels": ["C-Level", "Founder", "President/Vice President", "Head", "Director"],
         "departments": ["Marketing", "C-Suite"], "size_min": 11, "size_max": 300},
    ],
}


def _list(v):
    items = v.split(",") if isinstance(v, str) else v if isinstance(v, list) else []
    out = []
    for x in items:
        x = re.sub(r"\s+", " ", str(x)).strip()[:80]
        if x and x not in out:
            out.append(x)
    return out[:MAX_ITEMS]


def _int(v, lo, hi, default):
    try:
        v = int(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def clean_icp(raw, offer_label="this offer"):
    """One ICP from the page or from Claude, checked and tidied. Raises ValueError in words for the page."""
    raw = raw if isinstance(raw, dict) else {}
    name = re.sub(r"\s+", " ", str(raw.get("name") or "")).strip()[:80]
    if not name:
        raise ValueError("%s: each customer profile needs a name." % offer_label)
    trigger = raw.get("trigger") if raw.get("trigger") in TRIGGERS else "none"
    out = {"name": name, "trigger": trigger, "on": raw.get("on") is not False}
    for f in LIST_FIELDS:
        out[f] = _list(raw.get(f))
    out["levels"] = [x for x in out["levels"] if x in LEVELS]
    out["months"] = _int(raw.get("months"), 1, 12, 3)
    lo = _int(raw.get("size_min"), 1, 100000, 0) if raw.get("size_min") not in (None, "") else 0
    hi = _int(raw.get("size_max"), 1, 1000000, 0) if raw.get("size_max") not in (None, "") else 0
    if lo and hi and lo > hi:
        lo, hi = hi, lo
    out["size_min"], out["size_max"] = lo, hi
    if not (out["titles"] or out["levels"] or out["departments"]):
        raise ValueError("%s, “%s”: name the titles, seniority or department of the people to find." % (offer_label, name))
    if trigger == "uses_tech" and not out["technologies"]:
        raise ValueError("%s, “%s”: name the products their company uses." % (offer_label, name))
    if trigger == "hiring_for" and not out["hiring"]:
        raise ValueError("%s, “%s”: name the jobs their company is hiring for." % (offer_label, name))
    return out


def icps_for(settings, offer):
    """The workspace's ICPs for an offer, or the defaults, each checked."""
    own = (settings.get("icps") or {}).get(offer)
    return [clean_icp(x) for x in (own if own is not None else DEFAULT_ICPS.get(offer, []))]


def _size(icp):
    if not (icp.get("size_min") or icp.get("size_max")):
        return None
    out = {}
    if icp.get("size_min"):
        out["min"] = str(icp["size_min"])
    if icp.get("size_max"):
        out["max"] = str(icp["size_max"])
    return out


def people_filters(icp, *, company=None):
    """Saleshandy's people search for an ICP. `company` narrows it to one company (its domain, else its
    name), for the triggers that find the companies first."""
    f = {}
    if icp.get("titles"):
        f["job_title"] = {"includes": icp["titles"], "exactMatch": 0}
    if icp.get("levels"):
        f["management_level"] = {"includes": icp["levels"]}
    if icp.get("departments"):
        f["department"] = {"includes": icp["departments"]}
    if company is not None:
        if company.get("domain"):
            f["company_domain"] = {"includes": [company["domain"]]}
        else:
            f["company_name"] = {"includes": [company["name"]]}
        return f
    if icp.get("industries"):
        f["company_industry"] = {"includes": icp["industries"]}
    if icp.get("locations"):
        f["location"] = {"includes": icp["locations"], "exactMatch": 0}
    if icp.get("keywords"):
        f["keywords"] = {"includes": icp["keywords"]}
    if _size(icp):
        f["company_size"] = _size(icp)
    if icp.get("trigger") == "new_in_role":
        f["jobs_changed_within"] = {"min": "0", "max": str(icp.get("months") or 3)}
    return f


def company_filters(icp):
    """Saleshandy's company search for an ICP whose trigger is about the company, else None."""
    t = icp.get("trigger")
    if t not in COMPANY_TRIGGERS:
        return None
    f = {}
    if t in SIGNAL_IDS:
        f["signalIds"] = SIGNAL_IDS[t]
    if t == "uses_tech":
        f["technologies_used"] = {"includes": icp["technologies"]}
    if t == "hiring_for":
        f["active_job_postings_title"] = {"includes": icp["hiring"]}
    if icp.get("industries"):
        f["company_industry"] = {"includes": icp["industries"]}
    if icp.get("locations"):
        f["company_hq_location"] = {"includes": icp["locations"], "exactMatch": 0}
    if icp.get("keywords"):
        f["keywords"] = {"includes": icp["keywords"]}
    if _size(icp):
        f["company_size"] = _size(icp)
    return f


def why_now(icp, company=None):
    t = icp.get("trigger") or "none"
    return WHY_NOW[t] % {"months": icp.get("months") or 3, "tech": " or ".join(icp.get("technologies") or []) or "it",
                         "hiring": ", ".join((icp.get("hiring") or [])[:3]) or "the work"}


def score(icp, person):
    """How likely a message is welcome, without a word from them: 55 for fitting the profile, more for a
    trigger, for someone who decides and for the profile's own department."""
    from . import account_mapper as am
    levels = am.levels_for(person.get("title"))
    rank = max([am.LEVEL_RANK.get(x, 1) for x in levels] or [1])
    s = 55 + TRIGGER_POINTS.get(icp.get("trigger") or "none", 0)
    s += 6 if rank >= am.LEVEL_RANK["Director"] else 0
    s += 4 if person.get("decision_maker") else 0
    if icp.get("departments") and person.get("department") in icp["departments"]:
        s += 4
    return max(0, min(95, s))


def signal(icp, offer, person, company=None):
    """A person found by an ICP, in a post's shape, so the rest of Lead Finder keeps and writes to them as
    it does a post's author. Their key is Saleshandy's id: once a person, never again."""
    co = person.get("company") or (company or {}).get("name") or ""
    reason = why_now(icp, company)
    text = "%s, %s at %s. Fits the customer profile “%s”%s." % (
        person.get("name") or "Someone", person.get("title") or "", co or "their company", icp["name"],
        (": " + reason) if reason else "")
    return {"key": "icp:%s" % person["id"], "kind": "icp", "url": "", "text": text, "posted_at": "",
            "author": {"name": person.get("name") or "", "headline": "%s at %s" % (person.get("title") or "", co),
                       "url": "", "key": "sh/%s" % person["id"], "company": False},
            "company": {"name": co, "domain": person.get("domain") or (company or {}).get("domain") or "",
                        "size": (company or {}).get("employees"), "industry": (company or {}).get("industry") or ""},
            "icp": {"name": icp["name"], "trigger": icp.get("trigger") or "none", "why": reason, "offer": offer},
            "contacts": [{"id": person["id"], "name": person.get("name") or "", "title": person.get("title") or "",
                          "location": person.get("location") or "", "key": "sh/%s" % person["id"], "linkedin": ""}],
            "reactions": 0, "comments": 0, "query": icp["name"], "social_id": ""}


def cursor_key(icp):
    """One profile's search, as its filters: editing the profile starts its search again from page 1."""
    import hashlib
    import json
    raw = json.dumps([people_filters(icp), company_filters(icp)], sort_keys=True, default=str)
    return "icp:" + hashlib.sha1(raw.encode()).hexdigest()[:16]


def find(icps, *, client=None, per_icp=PER_ICP, known=None, cursor=None, sleep=time.sleep):
    """The people each ICP finds that the workspace has not met, best first, at most per_icp each:
    [(offer, icp, signal, score)] and notes. `icps` is [(offer, icp)]; `known(keys)` says which of the keys
    the workspace has met before (a lead, or looked at), so the search pages on past them (MAX_PAGES at
    most). Free.

    `cursor` is (get(key) -> page, set(key, page)): where each profile's search stopped last time. A run
    starts there, so day after day it goes on through Saleshandy's results instead of reading the same
    first pages and running dry. It stays on a page it did not finish (the people left on it are for the
    next run) and goes back to page 1 at the end of the results, where people who newly fit (new in their
    role this week) come first."""
    from . import saleshandy_client as sh
    client = client or sh.Client()
    known = known or (lambda keys: set())
    get_page, set_page = cursor or (lambda key: 1, lambda key, page: None)
    out, notes, taken = [], [], set()      # taken: people an earlier profile kept this run

    limited = 0                             # profiles in a row that Saleshandy refused even after the wait
    for offer, icp in icps:
        if not icp.get("on", True):
            continue
        cf = company_filters(icp)
        ckey = cursor_key(icp)
        start = max(1, int(get_page(ckey) or 1))
        for attempt in range(RATE_RETRIES + 1):
            found, looked, failed, refused = [], set(), False, False

            def fresh(pairs):
                pairs = [(p, c) for p, c in pairs if p.get("id") and "icp:%s" % p["id"] not in taken | looked]
                old = known(["icp:%s" % p["id"] for p, _ in pairs])
                new = []
                for p, c in pairs:
                    key = "icp:%s" % p["id"]
                    if key not in looked and key not in old:
                        new.append((p, c))
                    looked.add(key)
                return new

            next_page = start
            try:
                for page in range(start, start + MAX_PAGES):
                    if cf is None:
                        res = client.search_people(people_filters(icp), page=page)
                        found += fresh([(p, None) for p in res.get("people") or []])
                    else:
                        res = client.search_companies(cf, page=page)
                        companies = res.get("companies") or []
                        if page == 1 and not companies:
                            notes.append("“%s” found no companies on Saleshandy." % icp["name"])
                        for c in companies[:COMPANIES]:
                            found += fresh([(p, c) for p in (client.search_people(people_filters(icp, company=c)).get("people") or [])[:2]])
                            if len(found) >= per_icp:
                                break
                    more = bool(res.get("has_next"))
                    if len(found) >= per_icp:
                        next_page = page                 # not finished: the rest of this page is the next run's
                        break
                    next_page = page + 1 if more else 1  # the end of the results: back to the newest
                    if not more:
                        break
            except sh.SaleshandyError as e:
                if isinstance(e, sh.RateLimited) and attempt < RATE_RETRIES:
                    sleep(RATE_WAIT_S)               # Saleshandy asked us to slow down: wait, then this profile again
                    continue
                notes.append("Saleshandy stopped at “%s”: %s" % (icp["name"], e))
                failed, refused = True, isinstance(e, sh.RateLimited)
                if isinstance(e, sh.AuthError):
                    limited = None
            break
        if limited is None:
            break                                    # a wrong key stops every profile
        limited = limited + 1 if refused else 0
        if not failed:
            set_page(ckey, next_page)
        rows = sorted(((offer, icp, signal(icp, offer, p, c), score(icp, p)) for p, c in found), key=lambda r: -r[3])[:per_icp]
        taken.update(r[2]["key"] for r in rows)
        out += rows
        if not rows and cf is None and not failed:
            notes.append("“%s” found nobody new on Saleshandy." % icp["name"])
        if limited >= RATE_GIVE_UP:
            notes.append("Saleshandy is still rate limiting, so the profiles after “%s” wait for the next search." % icp["name"])
            break
    return out, notes


# == Claude drafts the profiles ===========================================================================
SUGGEST_SYSTEM = (
    "You define ideal customer profiles (ICPs) for a B2B sales team, to search a lead database of people "
    "and companies. You are given what one offer sells and who buys it, and the team's own notes. Propose "
    "three to five distinct profiles, each a group of people the offer can sell to, at a moment that makes a "
    "first message timely. For each: a short name; the trigger (new_in_role: started their job in the last "
    "few months; recently_funded; gtm_hires: their company just hired sales or marketing executives; "
    "rapid_growth; uses_tech: their company uses named products, such as a rival or a product the offer "
    "works with; hiring_for: their company advertises named jobs; none); for new_in_role the months (1 to 12); "
    "the job titles to search (as people write them, 3 to 8); seniority levels and departments from the "
    "lists given; industries (as LinkedIn names them) and locations (countries or cities) only when the "
    "notes or the offer call for them, else empty; company size in employees; for uses_tech the products, "
    "for hiring_for the job titles. Prefer the people who decide and pay. No two profiles alike. Never "
    "invent facts about the offer.")


def suggest_schema():
    from . import account_mapper as am
    depts = sorted({d for _, d in am.DEPARTMENT_RULES})
    strs = {"type": "array", "items": {"type": "string"}}
    item = {"type": "object", "additionalProperties": False,
            "required": ["name", "trigger", "months", "titles", "levels", "departments", "industries", "locations",
                         "keywords", "technologies", "hiring", "size_min", "size_max"],
            "properties": {"name": {"type": "string"}, "trigger": {"type": "string", "enum": list(TRIGGERS)},
                           "months": {"type": "integer"}, "titles": strs,
                           "levels": {"type": "array", "items": {"type": "string", "enum": LEVELS}},
                           "departments": {"type": "array", "items": {"type": "string", "enum": depts}},
                           "industries": strs, "locations": strs, "keywords": strs, "technologies": strs, "hiring": strs,
                           "size_min": {"type": "integer"}, "size_max": {"type": "integer"}}}
    return {"type": "object", "additionalProperties": False, "required": ["icps"],
            "properties": {"icps": {"type": "array", "items": item}}}


def suggest(offer, notes, *, budget, model, call=None):
    """Customer profiles Claude proposes for an offer, each checked as one typed on the page would be. The
    page shows them to edit; nothing is saved until the team saves Settings."""
    from . import contact_lab as lab
    call = call or lab._json_call
    user = "OFFER: %s (%s)\n%s\n\nWHO BUYS IT: %s\n\nTHE TEAM'S NOTES: %s" % (
        offer["label"], offer["site"], offer["sells"], offer["buyers"], (notes or "none").strip()[:1500])
    got = call(budget, "icp-suggest", model, SUGGEST_SYSTEM, user, suggest_schema(), 4000)
    out = []
    for raw in (got.get("icps") or [])[:MAX_ICPS]:
        try:
            out.append(clean_icp(raw, offer["label"]))
        except ValueError:
            continue
    return out
