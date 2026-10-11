"""Contact Finder Lab, Phase 0: can a company name and a few job titles be
turned into the right people, their LinkedIn profiles and their work emails,
with no data platform, and which search backend should do the searching?

    summary = run(settings, budget, progress=print)

For each company the same searches go through every chosen backend (our own
SearXNG service, free; Claude's web_search tool, paid), so the two can be
scored side by side on the same people:

  1. the company's website, unless it was given ("Acme | acme.com");
  2. per job title, its two commonest phrasings on LinkedIn, through search
     results only: LinkedIn's own pages are never fetched (its terms forbid
     scraping, and logged-out pages are a login wall);
  3. addresses at the company's email domain that the web shows.

Then, for everyone found: does the person still work there in one of the
roles asked for (one model call per company, or plain text matching on a
free run), and what is their likely email: published, or built from the
company's pattern, with how sure that pattern is. No mailbox is ever probed;
the run only checks that the domain receives mail (DNS) and, once, whether
this server can reach a mail server at all (port 25), which decides whether
mailbox checks could ever be built.

The company's own pages (team, about, leadership, contact) are read with the
Market Radar site reader: free, robots.txt respected.
"""
from __future__ import annotations

import concurrent.futures
import re
import socket
import threading
import time
import unicodedata
from collections import Counter, defaultdict
from decimal import Decimal
from urllib.parse import urljoin, urlsplit

from . import contact_lab_search as search

MAX_COMPANIES = 10
MAX_ROLES = 5
VARIANTS_PER_ROLE = 2
DEFAULT_CAP_USD = Decimal("3.00")
MODELS = ("claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5")
BACKENDS = ("searxng", "claude")

# Hosts that list a company without being it.
DIRECTORY_HOSTS = (
    "linkedin.com", "wikipedia.org", "crunchbase.com", "facebook.com", "x.com", "twitter.com",
    "instagram.com", "youtube.com", "bloomberg.com", "zoominfo.com", "glassdoor.com", "indeed.com",
    "yelp.com", "apollo.io", "rocketreach.co", "dnb.com", "pitchbook.com", "owler.com", "google.com",
    "bing.com", "amazon.com", "tiktok.com", "reddit.com", "quora.com", "medium.com", "github.com",
    "craft.co", "cbinsights.com", "tracxn.com", "builtin.com", "comparably.com", "g2.com",
    "capterra.com", "trustpilot.com", "bbb.org", "mapquest.com", "yahoo.com", "wikidata.org",
    "dashboard.", "support.", "help.", "docs.")

# Pages on a company's site that tend to name people or show addresses.
SITE_PATHS = ("/about", "/about-us", "/team", "/our-team", "/leadership", "/management", "/people",
              "/company", "/contact", "/contact-us")
SITE_LINK_WORDS = ("team", "leadership", "management", "about", "people", "founders", "contact",
                   "board", "executive")
MAX_SITE_PAGES = 6
SITE_TEXT_FOR_MODEL = 15000

ROLE_LOCALS = {
    "info", "contact", "hello", "hi", "sales", "support", "help", "press", "media", "pr", "admin",
    "office", "careers", "jobs", "hr", "recruiting", "talent", "billing", "accounts", "team",
    "marketing", "privacy", "legal", "noreply", "no-reply", "donotreply", "webmaster", "security",
    "abuse", "partners", "partnerships", "investors", "ir", "events", "feedback", "service",
    "customerservice", "enquiries", "inquiries", "general", "reception", "orders", "returns",
    "compliance", "dpo", "gdpr", "newsletter", "community", "developers", "dev", "api", "bd"}
NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "phd", "mba", "md", "cpa", "pmp", "cfa", "esq", "dr", "mr",
                 "mrs", "ms", "prof"}

# (name, template). Order matters only for ties: commoner patterns first.
PATTERNS = (("first.last", "{f}.{l}"), ("flast", "{fi}{l}"), ("firstlast", "{f}{l}"),
            ("first", "{f}"), ("f.last", "{fi}.{l}"), ("firstl", "{f}{li}"), ("first_last", "{f}_{l}"),
            ("first-last", "{f}-{l}"), ("last.first", "{l}.{f}"), ("lastf", "{l}{fi}"), ("last", "{l}"))

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


# == input ==========================================================================

def parse_companies(text):
    """One company a line, optionally "Name | domain.com". Raises ValueError."""
    out, seen = [], set()
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        name, _, domain = (x.strip() for x in line.partition("|"))
        domain = domain.lower()
        domain = re.sub(r"^https?://", "", domain).split("/")[0]
        domain = domain[4:] if domain.startswith("www.") else domain
        if domain and not re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,}", domain):
            raise ValueError("%r is not a domain (write it as Name | example.com)" % domain)
        if not name or len(name) > 120:
            raise ValueError("every line needs a company name of at most 120 characters")
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        out.append({"name": name, "domain": domain or None})
    if not out:
        raise ValueError("give at least one company")
    if len(out) > MAX_COMPANIES:
        raise ValueError("at most %d companies per lab run" % MAX_COMPANIES)
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
        raise ValueError("at most %d job titles per lab run" % MAX_ROLES)
    return roles


def estimate(n_companies, n_roles, backends, model, *, domains_given=0):
    """The Claude searches and the dollars a run could cost, before it runs."""
    from . import market_radar_costs as costs
    per_company = 1 + VARIANTS_PER_ROLE * n_roles + 1
    searches = (n_companies * per_company - domains_given) if "claude" in backends else 0
    if "claude" not in backends:
        return {"claude_searches": 0, "typical_usd": 0.0, "cap_usd": float(DEFAULT_CAP_USD)}
    # A search reads about 6,000 input tokens of results on average; the
    # model calls (titles, the check per company, team pages) about 8,000.
    rates = costs._model_rates(model)[1]
    per_search = Decimal("0.01") + Decimal(6000) * rates[0] / costs.M + Decimal(150) * rates[4] / costs.M
    model_calls = (Decimal(8000) * rates[0] + Decimal(1500) * rates[4]) / costs.M * (n_companies + 1)
    return {"claude_searches": searches, "typical_usd": round(float(per_search * searches + model_calls), 3),
            "cap_usd": float(DEFAULT_CAP_USD)}


# == pure helpers ===================================================================

def host_of(url):
    host = (urlsplit(url or "").hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def _words(text):
    t = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return re.findall(r"[a-z0-9]+", t)


LEGAL_WORDS = {"inc", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "gmbh", "ag", "sa",
               "plc", "group", "holdings", "the", "and", "of"}


def company_tokens(name, domain=None):
    """What identifies the company in a search result: its name's words
    (legal suffixes dropped) and its domain's first label."""
    words = [w for w in _words(name) if w not in LEGAL_WORDS]
    out = {"words": words, "joined": "".join(words)}
    if domain:
        out["stem"] = re.sub(r"[^a-z0-9]", "", domain.split(".")[0])
    return out


def mentions_company(text, tokens):
    words = _words(text)
    if not words or not tokens["words"]:
        return False
    # Whole words only: "Stripes Consulting" is not Stripe. A name of several
    # words also counts written as one ("CoreCare" for Core Care).
    if len(tokens["words"]) > 1 and tokens["joined"] in words:
        return True
    n = len(tokens["words"])
    for i in range(len(words) - n + 1):
        if words[i:i + n] == tokens["words"]:
            return True
    stem = tokens.get("stem")
    return bool(stem and len(stem) >= 4 and stem in words)


def pick_domain(results, company):
    """The company's own site among search results: the first host that is
    not a directory and whose name resembles the company. (domain, candidates)."""
    tokens = company_tokens(company)
    candidates = []
    for r in results:
        host = host_of(r.get("url"))
        if not host or any(host == d or host.endswith("." + d) or host.startswith(d) for d in DIRECTORY_HOSTS):
            continue
        root = ".".join(host.split(".")[-3:]) if re.search(r"\.(co|com|org|net|gov|ac)\.[a-z]{2}$", host) \
            else ".".join(host.split(".")[-2:])
        if root not in candidates:
            candidates.append(root)
    for c in candidates:
        label = re.sub(r"[^a-z0-9]", "", c.split(".")[0])
        if tokens["joined"] and (tokens["joined"] in label or (len(label) >= 4 and label in tokens["joined"])):
            return c, candidates[:5]
    return (candidates[0] if candidates else None), candidates[:5]


LI_PROFILE = re.compile(r"linkedin\.com/in/([A-Za-z0-9\-_%]+)", re.I)


def parse_linkedin(result):
    """A person from a LinkedIn search result's title and snippet, or None.
    Titles read "Jane Doe - VP Marketing - Acme | LinkedIn"."""
    m = LI_PROFILE.search(result.get("url") or "")
    if not m:
        return None
    title = re.sub(r"\s*[|\-–—]\s*LinkedIn\s*$", "", (result.get("title") or "").strip(), flags=re.I)
    title = re.sub(r"\s*\.\.\.$|…$", "", title).strip()
    parts = [p.strip() for p in re.split(r"\s+[-–—|]\s+", title) if p.strip()]
    if not parts:
        return None
    name = parts[0]
    if len(name) > 80 or len(_words(name)) > 6 or not re.search(r"[A-Za-z]", name):
        return None
    snippet = result.get("snippet") or ""
    exp = re.search(r"Experience:\s*([^·|]+)", snippet)
    return {"name": name, "headline": " - ".join(parts[1:]), "linkedin": "https://www.linkedin.com/in/%s" % m.group(1).lower(),
            "experience": exp.group(1).strip() if exp else "", "snippet": snippet[:300],
            "title_raw": result.get("title") or ""}


def emails_in(text, domain):
    """Addresses at the domain (or a subdomain of it) in some text. Escaped
    markup is cleaned first: a page's script gave "u003esales@stripe.com"."""
    out = []
    text = re.sub(r"\\?u00[0-9a-fA-F]{2}|&[a-z]+;|&#\d+;", " ", text or "")
    for e in EMAIL_RE.findall(text):
        e = e.strip(".").lower()
        host = e.split("@", 1)[1]
        # The same name under another ending counts too: a company whose site
        # is .com can write from .org (corecareclinic.com/.org).
        same_name = host.split(".")[0] == domain.split(".")[0] and host.count(".") == domain.count(".")
        if host == domain or host.endswith("." + domain) or same_name:
            if e not in out:
                out.append(e)
    return out


def name_parts(name):
    """(first, last) in lowercase ASCII letters, or (first, None)."""
    n = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    n = re.sub(r"\(.*?\)", " ", n).split(",")[0]
    toks = [re.sub(r"[^a-z]", "", t) for t in n.split()]
    toks = [t for t in toks if t and t not in NAME_SUFFIXES]
    if not toks:
        return None, None
    first = toks[0]
    rest = [t for t in toks[1:] if len(t) > 1]
    return first, (rest[-1] if rest else None)


def render(pattern, first, last):
    template = dict(PATTERNS)[pattern]
    if ("{l" in template) and not last:
        return None
    return template.format(f=first, l=last or "", fi=first[:1], li=(last or "")[:1])


def is_personal(email):
    local = email.split("@", 1)[0]
    return local not in ROLE_LOCALS and not re.search(r"\d{3,}", local) and len(local) >= 2


def infer_pattern(emails, names):
    """The company's address pattern from real addresses: matched against
    known people's names first, then by shape. {"pattern", "level", ...}
    level: "confirmed" (2+ addresses match named people), "likely" (one
    does, or 2+ have its shape), "guess" (nothing to go on)."""
    personal = [e for e in emails if is_personal(e)]
    matched, shape, examples = Counter(), Counter(), defaultdict(list)
    parts = [name_parts(n) for n in names]
    parts = [(f, l) for f, l in parts if f]
    for e in personal:
        local = e.split("@", 1)[0]
        hit = None
        for f, l in parts:
            for pat, _ in PATTERNS:
                if render(pat, f, l) == local:
                    hit = pat
                    break
            if hit:
                break
        if hit:
            matched[hit] += 1
            examples[hit].append(e)
        elif re.fullmatch(r"[a-z]{2,}\.[a-z]{2,}", local):
            shape["first.last"] += 1
            examples["first.last"].append(e)
    if not matched and not shape:
        return {"pattern": "first.last", "level": "guess", "matched": 0, "shape": 0, "examples": [],
                "personal_seen": len(personal)}
    best = max(set(matched) | set(shape), key=lambda p: (matched[p], shape[p]))
    level = "confirmed" if matched[best] >= 2 else "likely" if (matched[best] == 1 or shape[best] >= 2) else "guess"
    return {"pattern": best, "level": level, "matched": matched[best], "shape": shape[best],
            "examples": examples[best][:5], "personal_seen": len(personal)}


def email_for(name, domain, pattern, published):
    """{"address", "label", "evidence"} for one person. label: "published"
    (seen on the web), "pattern_confirmed", "pattern_likely",
    "pattern_guess", or "none" (no usable name)."""
    first, last = name_parts(name)
    if not first or not domain:
        return {"address": None, "label": "none", "evidence": None}
    for e in published:
        local = e.split("@", 1)[0]
        if any(render(p, first, last) == local for p, _ in PATTERNS if render(p, first, last)):
            if e.endswith("@" + domain) or e.split("@", 1)[1].endswith("." + domain):
                return {"address": e, "label": "published", "evidence": "seen on the web"}
    local = render(pattern["pattern"], first, last)
    if not local:
        # "Michel K." gives no surname: an address built from the first name
        # alone would be a guess dressed as a pattern.
        return {"address": None, "label": "none", "evidence": "only a first name is known"}
    return {"address": "%s@%s" % (local, domain), "label": "pattern_" + pattern["level"],
            "evidence": "pattern %s, %s" % (pattern["pattern"],
                                            "%d matching addresses" % pattern["matched"] if pattern["matched"]
                                            else "%d addresses of its shape" % pattern["shape"] if pattern["shape"]
                                            else "no addresses seen: the commonest pattern")}


def former_mention(text, tokens):
    """Does the text place the company in the past ("ex. Stripe", "formerly
    at Stripe") or name it only as a parent ("Privy, a Stripe company")?"""
    words = _words(text)
    n = len(tokens["words"])
    if not n:
        return False
    for i in range(len(words) - n + 1):
        if words[i:i + n] != tokens["words"]:
            continue
        before = words[max(0, i - 3):i]
        if any(w in ("ex", "former", "formerly", "previously", "prev", "alum", "alumni", "past") for w in before):
            return True
        if before[-1:] == ["a"] and words[i + n:i + n + 1] == ["company"]:
            return True
    return False


def role_hit(text, variants):
    t = " %s " % " ".join(_words(text))
    for v in variants:
        w = " ".join(_words(v))
        if w and (" %s " % w) in t:
            return v
    return None


# == checks that cost nothing =======================================================

MAIL_PROVIDERS = (("google.com", "Google Workspace"), ("googlemail.com", "Google Workspace"),
                  ("outlook.com", "Microsoft 365"), ("pphosted.com", "Proofpoint"),
                  ("mimecast.com", "Mimecast"), ("zoho", "Zoho"), ("secureserver.net", "GoDaddy"),
                  ("messagelabs.com", "Broadcom"), ("barracudanetworks.com", "Barracuda"))
SIBLING_TLDS = ("com", "org", "net", "co", "io")


def _doh_mx(domain, session=None):
    """MX hosts by DNS over HTTPS (Cloudflare), or None when it cannot say."""
    import requests
    try:
        r = (session or requests).get("https://cloudflare-dns.com/dns-query", params={"name": domain, "type": "MX"},
                                      headers={"accept": "application/dns-json"}, timeout=8)
        data = r.json()
    except Exception:
        return None
    if data.get("Status") not in (0, 3):     # NOERROR or NXDOMAIN; anything else: cannot say
        return None
    hosts = []
    for a in data.get("Answer") or []:
        if a.get("type") == 15:
            pref, _, host = str(a.get("data", "")).partition(" ")
            hosts.append((int(pref) if pref.isdigit() else 99, host.rstrip(".")))
    return [h for _, h in sorted(hosts)]


def mail_domain(domain, resolver=None, session=None):
    """{"mx": [hosts], "status": "ok" | "none" | "unknown", "provider"}. DNS
    only. A resolver that answers "no MX" is checked once more over HTTPS
    before it is believed: a sandboxed resolver said so for stripe.com
    (2026-10-11), and "no mail server" decides whether an address is worth
    giving."""
    hosts, note = None, ""
    try:
        import dns.resolver
        answers = (resolver or dns.resolver).resolve(domain, "MX", lifetime=6)
        hosts = [h for _, h in sorted((r.preference, str(r.exchange).rstrip(".")) for r in answers)]
    except ImportError:
        note = "dnspython is not installed"
    except Exception as e:
        note = "DNS said %s" % type(e).__name__
    if not hosts:
        doh = _doh_mx(domain, session=session)
        if doh is not None:
            hosts = doh
            note = (note + "; " if note else "") + "checked over HTTPS"
    if hosts is None:
        return {"mx": [], "status": "unknown", "provider": None, "note": note or "no answer"}
    provider = next((name for key, name in MAIL_PROVIDERS for h in hosts if key in h), None)
    return {"mx": hosts[:3], "status": "ok" if hosts else "none", "provider": provider or ("other" if hosts else None),
            "note": note}


def email_domain(domain, published, lookup=None):
    """The domain people's addresses are at: the website's when it receives
    mail; else one the published addresses use; else a sibling (.org for
    .com). corecareclinic.com lists no mail server; the company also owns
    corecareclinic.org (2026-10-11). Returns (domain, mail, note)."""
    lookup = lookup or mail_domain
    mail = lookup(domain)
    if mail["status"] != "none":
        return domain, mail, None
    tried = [domain]
    label = domain.rsplit(".", 1)[0]
    others = [e.split("@", 1)[1] for e in published if not e.endswith("@" + domain)]
    for cand in list(dict.fromkeys(others + ["%s.%s" % (label, t) for t in SIBLING_TLDS])):
        if cand in tried:
            continue
        tried.append(cand)
        m = lookup(cand)
        if m["status"] == "ok":
            return cand, m, "%s receives no mail; %s does, so addresses use it (check it is the same company)" % (
                domain, cand)
    return domain, mail, "%s lists no mail server, and no sibling domain does" % domain


def port25_check(host=None, timeout=6):
    """Can this server open a connection to a mail server at all? Connects to
    Gmail's inbound server, reads its greeting, says QUIT. No address is
    named, nothing is sent."""
    host = host or (mail_domain("gmail.com").get("mx") or ["gmail-smtp-in.l.google.com"])[0]
    started = time.monotonic()
    try:
        with socket.create_connection((host, 25), timeout=timeout) as s:
            s.settimeout(timeout)
            banner = s.recv(200).decode("ascii", "replace").strip()
            try:
                s.sendall(b"QUIT\r\n")
            except OSError:
                pass
        return {"status": "open", "host": host, "banner": banner[:80],
                "ms": int((time.monotonic() - started) * 1000)}
    except Exception as e:
        return {"status": "blocked", "host": host, "note": "%s: %s" % (type(e).__name__, str(e)[:120]),
                "ms": int((time.monotonic() - started) * 1000)}


# == model calls (paid, booked against the run's budget) ============================

def _json_call(budget, stage, model, system, user, schema, max_tokens, client=None):
    from . import market_radar_costs as costs
    from . import market_radar_llm as llm
    reserve = costs.worst_case_model_usd(model, costs.estimate_tokens(system + user) + 400, max_tokens)
    budget.check(reserve)
    client = client or llm.default_client()
    try:
        try:
            resp = llm._request(client, model, max_tokens, system, user, schema, True)
        except Exception as e:
            if "fallback" in str(e).lower() and getattr(e, "status_code", None) == 400:
                resp = llm._request(client, model, max_tokens, system, user, schema, False)
            else:
                raise
    except Exception as e:
        status = getattr(e, "status_code", None)
        if not (isinstance(status, int) and 400 <= status < 500 and status != 429):
            budget.add(stage, model, reserve, None, note="no reply; counted at its reservation")
        raise
    usage = resp.usage.model_dump() if hasattr(resp.usage, "model_dump") else dict(resp.usage or {})
    served = getattr(resp, "model", None) or model
    try:
        usd, _ = costs.model_cost(served, usage)
    except Exception:
        usd = reserve
    budget.add(stage, served, usd, usage)
    return llm._parse(resp, {}, model, max_tokens)[0]


ROLES_SYSTEM = (
    "You help search LinkedIn results for people in given roles. For each job title, give the "
    "phrasings people actually use for that role in their LinkedIn headline, commonest first "
    "(at most 6, including the title itself if it is common), and words that mean the person is "
    "not in the role (intern, assistant to, former, agency). Keep each phrasing short, the way it "
    "appears in a headline.")
ROLES_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["roles"],
                "properties": {"roles": {"type": "array", "items": {
                    "type": "object", "additionalProperties": False, "required": ["role", "variants", "exclude"],
                    "properties": {"role": {"type": "string"},
                                   "variants": {"type": "array", "items": {"type": "string"}},
                                   "exclude": {"type": "array", "items": {"type": "string"}}}}}}}

JUDGE_SYSTEM = (
    "You check people found in web search results against what a sales team asked for. For each "
    "candidate decide, from the evidence given only: does this person CURRENTLY work at the company "
    "(yes, no, or unclear: a former employee, a different company with a similar name, or a title "
    "that names another employer is no), and which requested role their title matches, if any "
    "(a title must mean the same job; seniority within the role is fine, an assistant to or an "
    "intern is not). Use the candidate numbers given.")
JUDGE_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["verdicts"],
                "properties": {"verdicts": {"type": "array", "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["n", "current", "role", "reason"],
                    "properties": {"n": {"type": "integer"}, "current": {"type": "string", "enum": ["yes", "no", "unclear"]},
                                   "role": {"type": ["string", "null"]}, "reason": {"type": "string"}}}}}}

SITE_SYSTEM = (
    "You read pages of a company's own website and list the people they name as working there, "
    "with the job title the page gives. Only people the page presents as the company's own staff, "
    "leadership or board; not customers, quoted partners or authors of testimonials. If a page "
    "names nobody, return an empty list.")
SITE_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["people"],
               "properties": {"people": {"type": "array", "items": {
                   "type": "object", "additionalProperties": False, "required": ["name", "title", "page"],
                   "properties": {"name": {"type": "string"}, "title": {"type": "string"},
                                  "page": {"type": "string"}}}}}}


def expand_roles(roles, *, model, budget, use_model):
    if not use_model:
        return [{"role": r, "variants": [r], "exclude": []} for r in roles]
    got = _json_call(budget, "roles", model, ROLES_SYSTEM, "Job titles:\n" + "\n".join("- " + r for r in roles),
                     ROLES_SCHEMA, 2000)
    by = {x["role"].strip().lower(): x for x in got.get("roles") or []}
    out = []
    for r in roles:
        x = by.get(r.lower()) or {}
        variants = [v.strip() for v in x.get("variants") or [] if v.strip()]
        if r not in variants:
            variants.insert(0, r)
        out.append({"role": r, "variants": variants[:6], "exclude": [e for e in x.get("exclude") or [] if e][:6]})
    return out


# == the company's own pages ========================================================

def read_site(domain, fetch=None, fetch_text=None):
    """Up to MAX_SITE_PAGES pages that tend to name people, robots.txt
    respected. {"pages": [{url, status, note}], "texts": {url: text}, "emails": []}"""
    from . import market_radar_site as site
    fetch = fetch or site.fetch
    fetch_text = fetch_text or site.fetch_text
    home = "https://%s/" % domain
    out = {"pages": [], "texts": {}, "emails": []}
    rules, _ = site.parse_robots(fetch_text(urljoin(home, "/robots.txt")) or "")
    first = fetch(home)
    out["pages"].append({"url": home, "status": first["status"], "note": first.get("note") or ""})
    if first["status"] != "ok":
        return out
    base = first.get("final_url") or home
    out["texts"][base] = first["text"]
    links = []
    for href, label in re.findall(r'<a\s[^>]*href=["\']([^"\'#]+)["\'][^>]*>(.*?)</a>', first["html"], re.I | re.S):
        url = urljoin(base, href)
        if host_of(url) != host_of(base):
            continue
        hay = (urlsplit(url).path + " " + re.sub(r"<[^>]+>", " ", label)).lower()
        if any(w in hay for w in SITE_LINK_WORDS):
            links.append(url.split("?")[0])
    links += [urljoin(base, p) for p in SITE_PATHS]
    seen = {base.rstrip("/")}
    for url in links:
        if len(out["pages"]) >= MAX_SITE_PAGES:
            break
        key = url.rstrip("/")
        if key in seen:
            continue
        seen.add(key)
        path = urlsplit(url).path or "/"
        if not site.allowed(path, rules):
            out["pages"].append({"url": url, "status": "robots", "note": "robots.txt asks us not to"})
            continue
        page = fetch(url)
        out["pages"].append({"url": url, "status": page["status"], "note": page.get("note") or ""})
        if page["status"] == "ok":
            out["texts"][page.get("final_url") or url] = page["text"]
            out["emails"] += [e for e in emails_in(page.get("html", "") + " " + page["text"], domain)
                              if e not in out["emails"]]
    out["emails"] += [e for e in emails_in(first.get("html", "") + " " + first["text"], domain) if e not in out["emails"]]
    return out


def site_people(texts, *, model, budget):
    pages = [(u, t) for u, t in texts.items()
             if any(w in urlsplit(u).path.lower() for w in ("team", "leader", "manage", "people", "about",
                                                             "founder", "board", "executive", "company"))]
    if not pages:
        return []
    chunk, used = [], 0
    for url, text in pages:
        room = SITE_TEXT_FOR_MODEL - used
        if room <= 500:
            break
        piece = text[:room]
        chunk.append("PAGE %s\n%s" % (url, piece))
        used += len(piece)
    got = _json_call(budget, "site_people", model, SITE_SYSTEM, "\n\n".join(chunk), SITE_SCHEMA, 3000)
    return [p for p in got.get("people") or [] if p.get("name")][:40]


# == one company ====================================================================

def _searches(backends, query, *, model, budget, site=None, ask=None, engines=None):
    """The same query through every chosen backend, in parallel."""
    jobs = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        if "searxng" in backends:
            q = ("site:%s %s" % (site + ("/in" if site == "linkedin.com" else ""), query)) if site else query
            jobs["searxng"] = pool.submit(search.searxng, q, engines=engines)
        if "claude" in backends:
            jobs["claude"] = pool.submit(search.claude, query, model=model, budget=budget, site=site, ask=ask)
        out = {}
        for name, fut in jobs.items():
            try:
                out[name] = fut.result()
            except search.BudgetExceeded:
                raise
            except Exception as e:
                r = search._blank(name, query)
                r["note"] = "%s: %s" % (type(e).__name__, str(e)[:200])
                out[name] = r
        return out


def _slim(res):
    return {k: res.get(k) for k in ("query", "status", "refused", "answered", "ms", "searches", "cost_usd", "note")} | \
        {"results": len(res.get("results") or [])}


def run_company(company, roles, *, backends, model, budget, use_model, engines=None, progress=None):
    say = progress or (lambda s: None)
    name, given = company["name"], company.get("domain")
    rec = {"name": name, "domain": given, "domain_source": "given" if given else None,
           "backends": {b: {"queries": [], "profiles": [], "emails": [], "domain": None} for b in backends},
           "notes": []}

    def log(backend, res):
        rec["backends"][backend]["queries"].append(_slim(res))

    # 1. The website.
    if not given:
        say("finding the website")
        got = _searches(backends, '"%s" official website' % name, model=model, budget=budget, engines=engines)
        picks = {}
        for b, res in got.items():
            log(b, res)
            domain, cands = pick_domain(res["results"], name)
            rec["backends"][b]["domain"] = domain
            rec["backends"][b]["domain_candidates"] = cands
            if domain:
                picks[b] = domain
        values = list(picks.values())
        if values and all(v == values[0] for v in values):
            rec["domain"], rec["domain_source"] = values[0], "+".join(sorted(picks))
        elif picks:
            pick = picks.get("claude") or values[0]
            rec["domain"], rec["domain_source"] = pick, "disagreed: %s" % ", ".join("%s says %s" % kv for kv in sorted(picks.items()))
    domain = rec["domain"]
    tokens = company_tokens(name, domain)

    # 2. People through LinkedIn search results, per role.
    for role in roles:
        for variant in role["variants"][:VARIANTS_PER_ROLE]:
            say("LinkedIn results for %s" % variant)
            got = _searches(backends, '"%s" "%s"' % (name, variant), model=model, budget=budget,
                            site="linkedin.com", engines=engines)
            for b, res in got.items():
                log(b, res)
                for r in res["results"]:
                    p = parse_linkedin(r)
                    if p:
                        p["query_role"] = role["role"]
                        p["engine"] = r.get("engine")
                        rec["backends"][b]["profiles"].append(p)

    # 3. The company's own pages and its mail domain.
    site_texts, site_found = {}, []
    if domain:
        say("reading the website")
        site_read = read_site(domain)
        rec["site"] = {"pages": site_read["pages"], "emails": site_read["emails"]}
        site_texts = site_read["texts"]

        if use_model and site_texts:
            try:
                site_found = site_people(site_texts, model=model, budget=budget)
            except search.BudgetExceeded:
                raise
            except Exception as e:
                rec["notes"].append("team pages not read by the model: %s" % str(e)[:160])
        rec["site"]["people"] = site_found

        # 4. Addresses at the domain the web shows.
        say("looking for addresses at %s" % domain)
        ask = ("List every email address ending in @%s that appears in the search results, one per line, "
               "written as: address | url of the page. If there are none, reply NONE." % domain)
        got = _searches(backends, '"@%s"' % domain, model=model, budget=budget, ask=ask, engines=engines)
        for b, res in got.items():
            log(b, res)
            text = (res.get("reply") or "") + " " + " ".join(r["title"] + " " + r["snippet"] for r in res["results"])
            rec["backends"][b]["emails"] = emails_in(text, domain)
    else:
        rec["notes"].append("no website found, so no team pages, mail check or addresses")

    # 5. One list of people, each with who found them.
    people = {}
    for b in backends:
        for p in rec["backends"][b]["profiles"]:
            key = p["linkedin"]
            cur = people.setdefault(key, dict(p, found_by=[], roles_searched=[]))
            if b not in cur["found_by"]:
                cur["found_by"].append(b)
            if p["query_role"] not in cur["roles_searched"]:
                cur["roles_searched"].append(p["query_role"])
    for p in site_found:
        key = "site:" + " ".join(_words(p["name"]))
        match = next((k for k, v in people.items() if " ".join(_words(v["name"])) == " ".join(_words(p["name"]))), None)
        if match:
            people[match]["found_by"].append("site")
            people[match]["site_title"] = p["title"]
        else:
            people[key] = {"name": p["name"], "headline": p["title"], "linkedin": None, "experience": "",
                           "snippet": "", "title_raw": "", "found_by": ["site"], "roles_searched": [],
                           "site_page": p.get("page")}
    plist = list(people.values())

    # 6. Still there, and in a role asked for?
    variants = {r["role"]: r["variants"] for r in roles}
    if use_model and plist:
        say("checking %d people" % len(plist))
        lines = []
        for i, p in enumerate(plist, 1):
            lines.append("%d. %s | headline: %s | experience: %s | snippet: %s | page title: %s" % (
                i, p["name"], p["headline"], p.get("experience", ""), p.get("snippet", "")[:200], p.get("title_raw", "")))
        user = ("Company: %s (%s)\nRequested roles: %s\n\nCandidates:\n%s" % (
            name, domain or "website unknown", "; ".join(variants), "\n".join(lines)))
        try:
            got = _json_call(budget, "check", model, JUDGE_SYSTEM, user, JUDGE_SCHEMA, 4000)
            by_n = {v["n"]: v for v in got.get("verdicts") or []}
            for i, p in enumerate(plist, 1):
                v = by_n.get(i) or {}
                p["current"] = v.get("current") or "unclear"
                p["role"] = v.get("role") if v.get("role") in variants else None
                p["why"] = v.get("reason")
        except search.BudgetExceeded:
            raise
        except Exception as e:
            rec["notes"].append("the check could not run: %s" % str(e)[:160])
            use_model = False
    if not use_model:
        for p in plist:
            text = " ".join([p["headline"], p.get("experience", ""), p.get("title_raw", "")])
            if p["found_by"] == ["site"]:
                p["current"] = "yes"
            elif former_mention(text, tokens):
                p["current"] = "no"
            else:
                p["current"] = "yes" if mentions_company(text, tokens) else "unclear"
            p["role"] = next((r for r, vs in variants.items() if role_hit(p["headline"] + " " + p.get("site_title", ""), vs)), None)
            p["why"] = "text match (no model on a free run)"

    # 7. Emails, at the domain that actually receives mail.
    published = list(dict.fromkeys(
        (rec.get("site") or {}).get("emails", []) + [e for b in backends for e in rec["backends"][b]["emails"]]))
    mail_at = None
    if domain:
        mail_at, rec["mail"], note = email_domain(domain, published)
        rec["email_domain"] = mail_at
        if note:
            rec["notes"].append(note)
    names = [p["name"] for p in plist] + [p["name"] for p in site_found]
    pattern = infer_pattern([e for e in published if e.endswith("@" + mail_at)] if mail_at else [], names) \
        if domain else None
    rec["email_pattern"] = pattern
    rec["published_emails"] = published[:30]
    for p in plist:
        p["email"] = email_for(p["name"], mail_at, pattern, published) if pattern else \
            {"address": None, "label": "none", "evidence": "no website"}
        if (rec.get("mail") or {}).get("status") == "none" and p["email"]["address"]:
            p["email"]["evidence"] += "; the domain lists no mail server"
    plist.sort(key=lambda p: (p.get("current") != "yes", p.get("role") is None, p["name"].lower()))
    rec["people"] = plist

    # 8. The scoreboard for this company.
    for b in backends:
        mine = [p for p in plist if b in p["found_by"]]
        q = rec["backends"][b]["queries"]
        rec["backends"][b]["score"] = {
            "queries": len(q), "blocked": sum(1 for x in q if x["status"] in ("blocked", "failed")),
            "profiles": len({p["linkedin"] for p in rec["backends"][b]["profiles"]}),
            "matched": sum(1 for p in mine if p.get("current") == "yes" and p.get("role")),
            "emails": len(rec["backends"][b]["emails"]),
            "ms": sum(x["ms"] for x in q), "cost_usd": round(sum(x["cost_usd"] for x in q), 4)}
        rec["backends"][b].pop("profiles", None)
    return rec


# == a whole run ====================================================================

def run(settings, budget, progress=None):
    """settings: {"companies": [...], "roles": [...], "backends": [...],
    "model": str, "engines": [...] | None}. Returns the summary."""
    say = progress or (lambda s: None)
    backends = [b for b in settings["backends"] if b in BACKENDS]
    model = settings["model"]
    use_model = "claude" in backends
    out = {"settings": {k: settings.get(k) for k in ("roles", "backends", "model", "engines")},
           "port25": None, "roles": None, "companies": [], "stopped": None}
    say("checking whether this server can reach a mail server")
    out["port25"] = port25_check()
    try:
        say("phrasing the job titles")
        out["roles"] = expand_roles(settings["roles"], model=model, budget=budget, use_model=use_model)
        for i, company in enumerate(settings["companies"], 1):
            def step(s, i=i, n=company["name"]):
                say("company %d/%d (%s): %s" % (i, len(settings["companies"]), n, s))
            out["companies"].append(run_company(company, out["roles"], backends=backends, model=model,
                                                budget=budget, use_model=use_model,
                                                engines=settings.get("engines"), progress=step))
            if settings.get("on_company"):
                settings["on_company"](out)
    except search.BudgetExceeded as e:
        out["stopped"] = "Stopped at the cost cap: %s" % e
    out["totals"] = totals(out["companies"], backends)
    out["cost"] = {"spent_usd": float(budget.spent), "cap_usd": float(budget.cap), "by_stage": budget.by_stage(),
                   "calls": len(budget.calls)}
    return out


def totals(companies, backends):
    """Per backend, summed over companies, plus SearXNG's refusals by engine."""
    out = {}
    for b in backends:
        t = defaultdict(float)
        refusals, answered = Counter(), Counter()
        domains = 0
        for c in companies:
            s = (c["backends"].get(b) or {}).get("score") or {}
            for k, v in s.items():
                t[k] += v
            if c["backends"].get(b, {}).get("domain") and c["backends"][b]["domain"] == c.get("domain"):
                domains += 1
            for q in c["backends"].get(b, {}).get("queries", []):
                for eng, why in (q.get("refused") or {}).items():
                    refusals["%s: %s" % (eng, re.sub(r"^Suspended:\s*", "", why))] += 1
                for eng in q.get("answered") or []:
                    answered[eng] += 1
        t = {k: (round(v, 4) if k == "cost_usd" else int(v)) for k, v in t.items()}
        t["domains_right"] = domains
        t["refusals"] = dict(refusals.most_common(12))
        t["answered_by"] = dict(answered.most_common(12))
        out[b] = t
    both = sum(1 for c in companies for p in c.get("people", [])
               if p.get("current") == "yes" and p.get("role") and len([x for x in p["found_by"] if x in BACKENDS]) > 1)
    out["matched_by_both"] = both
    out["emails"] = Counter(p["email"]["label"] for c in companies for p in c.get("people", [])
                            if p.get("current") == "yes" and p.get("role"))
    return out


