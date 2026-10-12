"""People & Signals, phase 3: revealing emails, only with approval.

    check = plan_reveal(summary, selection, balance=1480, cap=50)   # before asking
    report = reveal(summary, selection, client, cap=50)             # spends credits

Saleshandy charges 1 credit per verified work email found (7 with a phone),
nothing when nothing is found, and nothing for a contact revealed in the
last 30 days. A reveal is refused before any request when its worst case
(every person found) would pass the run's credit cap or the account's
balance.

After a reveal, each company's address pattern is learned from the emails
Saleshandy verified there, and everyone else found at that company gets an
address built from it, labelled with how sure it is ("pattern, from 2
verified emails"). A company with no verified email gets no built address:
a guess would look like an answer.

Titles nobody in Saleshandy holds can be looked for on the web first
(`web_fill`: Claude's web search on LinkedIn results, paid, optional); the
people found there are revealed by their LinkedIn URL.
"""
from __future__ import annotations

import re
from collections import Counter

from . import account_mapper as am
from . import saleshandy_client as sh

CREDITS_EMAIL = 1
CREDITS_EMAIL_PHONE = 7
DEFAULT_CREDIT_CAP = 50
MAX_CREDIT_CAP = 1000
WEB_PER_ROLE = 2


class RevealRefused(RuntimeError):
    """The reveal could cost more than the cap or the balance; nothing was spent."""


# == who can be revealed =================================================================

def _li_key(url):
    m = re.search(r"linkedin\.com/in/([A-Za-z0-9\-_%]+)", url or "", re.I)
    return m.group(1).lower() if m else None


def people_index(summary):
    """{key: (company, role, person)} for everyone found: Saleshandy people
    by lead id, people found on the web by "li:<profile>"."""
    out = {}
    for c in summary.get("companies") or []:
        for r in c.get("roles") or []:
            for p in (r.get("picked") or []) + (r.get("also") or []):
                if p.get("id") is not None:
                    out.setdefault(p["id"], (c, r, p))
            for p in r.get("web") or []:
                key = _li_key(p.get("linkedin"))
                if key:
                    out.setdefault("li:" + key, (c, r, p))
    return out


def default_selection(summary):
    """The best person per title, plus the best web find for titles
    Saleshandy had nobody for: what a reveal takes unless you choose."""
    keys = []
    for c in summary.get("companies") or []:
        for r in c.get("roles") or []:
            if r.get("picked"):
                keys += [p["id"] for p in r["picked"] if p.get("id") is not None]
            elif r.get("web"):
                key = _li_key(r["web"][0].get("linkedin"))
                if key:
                    keys.append("li:" + key)
    return keys


def _norm_key(k):
    if isinstance(k, str) and not k.startswith("li:"):
        if k.isdigit():
            return int(k)
        lk = _li_key(k)
        return "li:" + lk if lk else k
    return k


def plan_reveal(summary, selection, *, phone=False, cap=DEFAULT_CREDIT_CAP, balance=None):
    """What a reveal would do, before it does it: who, the most it can cost,
    and whether it may go ahead."""
    idx = people_index(summary)
    keys, skipped = [], []
    for k in selection or []:
        k = _norm_key(k)
        if k in keys:
            continue
        if k not in idx:
            skipped.append({"key": k, "why": "not in this run"})
        elif idx[k][2].get("revealed"):
            skipped.append({"key": k, "why": "already revealed"})
        else:
            keys.append(k)
    per = CREDITS_EMAIL_PHONE if phone else CREDITS_EMAIL
    worst = len(keys) * per
    cap = max(0, min(int(cap), MAX_CREDIT_CAP))
    why = None
    if not keys:
        why = "nobody to reveal"
    elif worst > cap:
        why = ("revealing %d people could use up to %d credits, more than this run's cap of %d"
               % (len(keys), worst, cap))
    elif balance is not None and worst > balance:
        why = "revealing %d people could use up to %d credits and the account has %s" % (len(keys), worst, balance)
    return {"keys": keys, "people": len(keys), "worst_credits": worst, "per_person": per, "cap": cap,
            "balance": balance, "skipped": skipped, "ok": why is None, "why": why}


# == the reveal =============================================================================

def _apply(person, rec):
    status = rec.get("email_status")
    if rec.get("email"):
        label = "verified" if status == "valid" else "risky" if status == "risky" else \
            "invalid" if status == "invalid" else "saleshandy"
        person["email"] = {"address": rec["email"], "status": status, "label": label, "source": "saleshandy"}
    else:
        person["email"] = {"address": None, "status": None, "label": "not_found", "source": "saleshandy"}
    if rec.get("linkedin"):
        person["linkedin"] = rec["linkedin"]
    if rec.get("phones"):
        person["phones"] = rec["phones"]
    person["revealed"] = True


def _match(records, batch, idx):
    """{key: record}: by lead id, then LinkedIn profile, then name."""
    out, by_name = {}, {}
    for key in batch:
        by_name.setdefault((idx[key][2].get("name") or "").strip().lower(), key)
    for rec in records:
        key = None
        lid = rec.get("lead_id")
        if lid is not None:
            lid = _norm_key(str(lid))
            if lid in batch:
                key = lid
        if key is None and rec.get("linkedin"):
            lk = _li_key(rec["linkedin"])
            if lk and ("li:" + lk) in batch:
                key = "li:" + lk
        if key is None and rec.get("name"):
            key = by_name.get(rec["name"].strip().lower())
        if key is not None and key not in out:
            out[key] = rec
    return out


def reveal(summary, selection, client, *, phone=False, cap=DEFAULT_CREDIT_CAP, progress=None, wait_s=600):
    """Reveals the selected people (credits) and learns each company's
    address pattern from what comes back. Raises RevealRefused before any
    request when the worst case passes the cap or the balance."""
    say = progress or (lambda s: None)
    balance = None
    try:
        balance = client.credits().get("total")
    except sh.AuthError:
        raise
    except sh.SaleshandyError:
        balance = None          # unknown: the cap still holds
    check = plan_reveal(summary, selection, phone=phone, cap=cap, balance=balance)
    if not check["ok"]:
        raise RevealRefused(check["why"])
    idx = people_index(summary)
    leads = [k for k in check["keys"] if not (isinstance(k, str) and k.startswith("li:"))]
    webs = [k for k in check["keys"] if isinstance(k, str) and k.startswith("li:")]
    report = {"asked": len(check["keys"]), "found": 0, "verified": 0, "risky": 0, "not_found": 0,
              "credits": 0, "already_revealed": 0, "jobs": [], "phone": bool(phone), "cap": check["cap"],
              "balance_before": balance, "unmatched_records": 0}
    batches = [("lead", leads[i:i + sh.MAX_ENRICH]) for i in range(0, len(leads), sh.MAX_ENRICH)] + \
              [("linkedin", webs[i:i + sh.MAX_ENRICH]) for i in range(0, len(webs), sh.MAX_ENRICH)]
    for n, (kind, batch) in enumerate(batches, 1):
        say("revealing batch %d/%d (%d people)" % (n, len(batches), len(batch)))
        if kind == "lead":
            rid = client.enrich_contacts(lead_ids=batch, reveal_phone=phone)
        else:
            rid = client.enrich_contacts(linkedin_urls=[idx[k][2]["linkedin"] for k in batch], reveal_phone=phone)
        res = client.wait(rid, timeout=wait_s)
        records = [sh.enriched(r) for r in res.get("records") or []]
        matched = _match(records, batch, idx)
        report["unmatched_records"] += max(0, len(records) - len(matched))
        report["credits"] += res.get("credits") or 0
        report["already_revealed"] += res.get("already_revealed") or 0
        report["jobs"].append({"request_id": rid, "status": res.get("status"), "people": len(batch),
                               "credits": res.get("credits"), "succeeded": res.get("succeeded"),
                               "failed": res.get("failed")})
        for key in batch:
            person = idx[key][2]
            if key in matched:
                _apply(person, matched[key])
            elif res.get("status") == "completed":
                _apply(person, {})
            else:
                person["email"] = {"address": None, "status": None, "label": "pending", "source": "saleshandy",
                                   "note": "the job was still %s; reveal again later (no new charge)"
                                           % (res.get("status") or "running")}
    for _, _, p in (idx[k] for k in check["keys"]):
        label = (p.get("email") or {}).get("label")
        if label in ("verified", "risky", "saleshandy", "invalid"):
            report["found"] += 1
        if label == "verified":
            report["verified"] += 1
        elif label == "risky":
            report["risky"] += 1
        elif label == "not_found":
            report["not_found"] += 1
    say("learning each company's email pattern")
    learn_patterns(summary)
    summary.setdefault("reveals", []).append(report)
    return report


# == email patterns from verified emails ====================================================

def learn_patterns(summary):
    """Per company: the pattern its verified emails follow, and an address
    built from it for everyone found there without one. Free."""
    from . import contact_lab as lab
    for c in summary.get("companies") or []:
        people = [p for r in c.get("roles") or [] for p in (r.get("picked") or []) + (r.get("also") or []) +
                  (r.get("web") or [])]
        good = [p for p in people if (p.get("email") or {}).get("source") == "saleshandy"
                and p["email"].get("address") and p["email"].get("label") in ("verified", "saleshandy")]
        if not good:
            c["email_pattern"] = None
            continue
        emails = [p["email"]["address"] for p in good]
        domain = Counter(e.split("@", 1)[1] for e in emails).most_common(1)[0][0]
        pat = lab.infer_pattern([e for e in emails if e.endswith("@" + domain)], [p.get("name") for p in good])
        c["email_pattern"] = {"pattern": pat["pattern"], "level": pat["level"], "from": pat["matched"],
                              "domain": domain, "examples": len(pat["examples"])}
        if pat["level"] not in ("confirmed", "likely") or not pat["matched"]:
            continue
        for p in people:
            email = p.get("email") or {}
            if email.get("source") == "saleshandy" and email.get("address"):
                continue
            if email.get("label") == "not_found" and email.get("source") == "saleshandy":
                built_note = "Saleshandy found none; "
            else:
                built_note = ""
            got = lab.email_for(p.get("name"), domain, pat, [])
            if got["address"]:
                p["email"] = {"address": got["address"], "status": None, "source": "pattern",
                              "label": "pattern_" + pat["level"],
                              "note": "%sbuilt from %s, the pattern of %d verified email%s at %s"
                                      % (built_note, pat["pattern"], pat["matched"],
                                         "" if pat["matched"] == 1 else "s", domain)}


# == titles nobody in Saleshandy holds: the web ================================================

def employer_of(headline):
    """(employer, title) from a LinkedIn headline when it names one:
    "VP Sales at Acme", "VP Sales @ Acme", "VP Sales - Acme". (None, None)
    when it doesn't."""
    h = (headline or "").strip()
    m = re.match(r"^(.+?)\s+(?:at|@)\s+(.+)$", h, re.I)
    if m:
        return m.group(2).strip(" .,|"), m.group(1).strip()
    parts = [x.strip() for x in re.split(r"\s+[-\u2013\u2014|]\s+", h) if x.strip()]
    if len(parts) >= 2:
        return parts[-1], " - ".join(parts[:-1])
    return None, None


def web_fill(summary, *, model, budget, progress=None, search_fn=None):
    """For each title with nobody found, one Claude web search of LinkedIn
    results ("Acme" "VP Marketing"). Paid, against `budget`; LinkedIn's own
    pages are never opened. Adds role["web"] candidates."""
    from . import contact_lab as lab
    from . import contact_lab_search as search
    say = progress or (lambda s: None)
    search_fn = search_fn or search.claude
    plans = {p["role"]: p for p in summary.get("plans") or []}
    done = 0
    for c in summary.get("companies") or []:
        tokens = lab.company_tokens(c.get("display_name") or c["name"], c.get("domain"))
        for r in c.get("roles") or []:
            if r.get("status") != "not_found" or r.get("web") is not None:
                continue
            plan = plans.get(r["role"]) or am.role_plan(r["role"])
            say("%s: looking for %s on the web" % (c["name"], r["role"]))
            res = search_fn('"%s" "%s"' % (c.get("display_name") or c["name"], r["role"]), model=model,
                            budget=budget, site="linkedin.com")
            done += 1
            found = []
            for item in res.get("results") or []:
                person = lab.parse_linkedin(item)
                if not person:
                    continue
                text = person["headline"] + " " + person.get("snippet", "")
                if not lab.mentions_company(text, tokens) or lab.former_mention(text, tokens):
                    continue
                employer, title = employer_of(person["headline"])
                if employer and max(am.name_score(c.get("display_name") or c["name"], employer),
                                    am.name_score(c["name"], employer)) < 90:
                    continue     # "Head of Partnerships at Acme Robotics" is not Acme Inc
                score = am.title_score({"title": title or person["headline"]}, plan)
                if score is None or score < am.PICK_MIN_SCORE:
                    continue
                found.append({"name": person["name"], "title": title or person["headline"],
                              "linkedin": person["linkedin"],
                              "score": score, "source": "web"})
            found.sort(key=lambda p: p["score"], reverse=True)
            r["web"] = found[:WEB_PER_ROLE]
            r["web_search"] = {"status": res.get("status"), "cost_usd": res.get("cost_usd"), "note": res.get("note")}
            if r["web"]:
                r["status"] = "web"
    return done
