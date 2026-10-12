"""Saleshandy's public API, the calls People & Signals uses.

    sh = Client()                         # key from SALESHANDY_API_KEY
    sh.credits()                          # {"total": 1480, "today": 2, "month": 20}
    found = sh.search_people({"company_domain": {"includes": ["acme.com"]},
                              "job_title": {"includes": ["CMO"]}})
    rid = sh.enrich_contacts(lead_ids=[p["id"] for p in found["people"]])
    result = sh.wait(rid)                 # {"status": "completed", "records": [...], "credits": 2}

Reference: https://developer.saleshandy.com (OpenAPI at /openapi.json).

What costs what (Saleshandy, 2026): searching people and companies is free;
credits are spent only when a contact is revealed (1 per verified work
email, 7 with a phone; nothing when nothing is found; a contact revealed in
the last 30 days is free again), and 0.1 per company enrichment.

The quirks handled here:
- a search with no results answers `payload: []` instead of an object;
- "unknown" often comes back as "" (founded year, SIC codes, website);
- errors come either as {"error": true, "code": 1001, "message": ...} or as
  a validation error {"statusCode": 400, "message": [...]};
- the shape of an enrichment result record is not documented, so
  `enriched()` reads each field from the names it is likely to have and the
  raw record is kept beside it, until a live run confirms the real shape.
"""
from __future__ import annotations

import os
import re
import time
from urllib.parse import urlsplit

BASE_URL = "https://open-api.saleshandy.com/v1"
TIMEOUT = 30
RETRIES = 2              # on 429 and 5xx, after the first try
SEARCH_GAP_S = 0.35      # between calls: searches are free, but be a polite client
MAX_ENRICH = 100         # records per enrichment request (Saleshandy's limit)
PER_PAGE = 25            # Saleshandy's page size for searches


class SaleshandyError(RuntimeError):
    def __init__(self, message, *, status=None, code=None):
        super().__init__(message)
        self.status, self.code = status, code


class AuthError(SaleshandyError):
    """The key is missing, wrong or revoked."""


class RateLimited(SaleshandyError):
    """Saleshandy kept answering 429 after the retries."""


def api_key():
    return (os.environ.get("SALESHANDY_API_KEY") or "").strip()


def configured():
    return bool(api_key())


# == small helpers ===================================================================

def host_of(url):
    url = (url or "").strip()
    if url and "://" not in url:
        url = "https://" + url
    host = (urlsplit(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def _blank(v):
    return v is None or v == "" or v == [] or v == {}


def _clean(v):
    return None if _blank(v) else v


def _int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _list(v):
    if _blank(v):
        return []
    return v if isinstance(v, list) else [v]


SOCIAL_KINDS = (("linkedin.com/company", "linkedin"), ("linkedin.com/school", "linkedin"),
                ("linkedin.com/showcase", "linkedin"), ("twitter.com", "x"), ("x.com", "x"),
                ("facebook.com", "facebook"), ("instagram.com", "instagram"), ("crunchbase.com", "crunchbase"),
                ("youtube.com", "youtube"), ("github.com", "github"), ("angel.co", "angellist"),
                ("wellfound.com", "angellist"), ("tiktok.com", "tiktok"), ("pinterest.com", "pinterest"))


def social_kind(url):
    low = (url or "").lower()
    for needle, kind in SOCIAL_KINDS:
        if needle in low:
            return kind
    return None


# == normalised records ===============================================================

def person(raw):
    """A people-search result, flattened. Location strings are tidied:
    Saleshandy sometimes repeats the city as the state."""
    raw = raw or {}
    loc = raw.get("location") or {}
    city, state, country = ((loc.get(k) or "").strip() for k in ("city", "state", "country"))
    if state and state == city:
        state = ""
    name = (raw.get("full_name") or "").strip()
    first, _, last = name.partition(" ")
    months = _int(raw.get("total_experience"))
    website = (raw.get("company_website") or "").strip()
    return {
        "id": raw.get("id"),
        "name": name, "first_name": first, "last_name": last.strip(),
        "title": (raw.get("job_title") or "").strip(),
        "company": (raw.get("company_name") or "").strip(),
        "website": website or None,
        "domain": host_of(website) or None,
        "department": _clean((raw.get("department") or "").strip()),
        "city": city or None, "state": state or None, "country": country or None,
        "location": ", ".join(x for x in (city, state, country) if x) or None,
        "experience_years": round(months / 12, 1) if months else None,
        "decision_maker": bool(raw.get("decision_maker")),
        "photo": _clean(raw.get("picture_url")),
        "b2b": raw.get("company_is_b2b"),
    }


def company(raw):
    """A company-search result, flattened: its links sorted by kind and its
    own website picked out of them."""
    raw = raw or {}
    socials, website = {}, None
    for url in _list(raw.get("socials")):
        if not isinstance(url, str) or not url.strip():
            continue
        kind = social_kind(url)
        if kind:
            socials.setdefault(kind, url.strip())
        elif website is None:
            website = url.strip()
    loc = raw.get("location") or {}
    city, state, country = ((loc.get(k) or "").strip() for k in ("city", "state", "country"))
    if state and state == city:
        state = ""
    return {
        "id": raw.get("id"),
        "name": (raw.get("name") or "").strip(),
        "website": website,
        "domain": host_of(website) or None,
        "linkedin": socials.get("linkedin"),
        "socials": socials,
        "hq": ", ".join(x for x in (city, state, country) if x) or None,
        "country": country or None,
        "founded": _int(raw.get("founded_year")),
        "industry": _clean((raw.get("industry") or "").strip()),
        "type": _clean(raw.get("type")),
        "b2b": raw.get("is_b2b"),
        "sic": [str(x) for x in _list(raw.get("sic_codes"))],
        "naics": [str(x) for x in _list(raw.get("naics_codes"))],
        "employees": _int(raw.get("employee_count")),
    }


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)
GOOD_STATUSES = ("valid", "verified", "deliverable", "safe", "ok")
RISKY_STATUSES = ("risky", "catch-all", "catch_all", "catchall", "accept_all", "accept-all", "unknown")


def _dig(raw, *keys):
    """The first non-blank value under any of `keys`, at the top level or
    one level down in the containers results tend to use."""
    places = [raw] + [raw.get(k) for k in ("contact", "person", "lead", "data", "profile", "result")
                      if isinstance(raw.get(k), dict)]
    for place in places:
        for k in keys:
            v = place.get(k)
            if not _blank(v):
                return v
    return None


def _status_word(v):
    v = (str(v or "")).strip().lower().replace(" ", "_")
    if not v:
        return None
    if v in GOOD_STATUSES:
        return "valid"
    if v in RISKY_STATUSES:
        return "risky"
    if v in ("invalid", "bad", "undeliverable"):
        return "invalid"
    return v


def _emails(raw):
    """[(email, kind, status)] from whatever shape the record uses."""
    out = []

    def add(e, kind, status):
        if isinstance(e, str) and EMAIL_RE.match(e.strip()):
            e = e.strip().lower()
            if e not in [x[0] for x in out]:
                out.append((e, kind, _status_word(status)))

    top_status = _dig(raw, "email_status", "emailStatus", "verification_status", "verificationStatus",
                      "email_verification_status")
    for key, kind in (("work_email", "work"), ("workEmail", "work"), ("business_email", "work"),
                      ("email", "work"), ("personal_email", "personal"), ("personalEmail", "personal")):
        v = _dig(raw, key)
        if isinstance(v, dict):
            add(v.get("email") or v.get("value") or v.get("address"), kind,
                v.get("status") or v.get("verificationStatus") or v.get("verification_status") or top_status)
        else:
            add(v, kind, top_status)
    for key in ("emails", "email_addresses", "emailAddresses", "work_emails", "personal_emails"):
        for item in _list(_dig(raw, key)):
            if isinstance(item, dict):
                kind = str(item.get("type") or item.get("kind") or item.get("email_type") or "").lower()
                kind = "personal" if "personal" in kind or key == "personal_emails" else "work"
                add(item.get("email") or item.get("value") or item.get("address"), kind,
                    item.get("status") or item.get("verificationStatus") or item.get("verification_status")
                    or top_status)
            else:
                add(item, "personal" if key == "personal_emails" else "work", top_status)
    return out


def _phones(raw):
    out = []
    for key in ("phone", "mobile_phone", "mobilePhone", "phone_number", "phoneNumber", "phones", "phone_numbers",
                "phoneNumbers"):
        for item in _list(_dig(raw, key)):
            num = item.get("number") or item.get("phone") or item.get("value") if isinstance(item, dict) else item
            if isinstance(num, (str, int)) and str(num).strip() and str(num).strip() not in out:
                out.append(str(num).strip())
    return out


def enriched(raw):
    """One enrichment result record, read field by field. The raw record is
    kept until a live run confirms the real shape."""
    raw = raw if isinstance(raw, dict) else {}
    emails = _emails(raw)
    work = next((e for e in emails if e[1] == "work"), None)
    personal = next((e for e in emails if e[1] == "personal"), None)
    linkedin = _dig(raw, "linkedin_url", "linkedinUrl", "linkedin", "linkedin_profile", "linkedinProfile")
    name = _dig(raw, "full_name", "fullName", "name")
    if not name:
        name = " ".join(x for x in (_dig(raw, "first_name", "firstName"), _dig(raw, "last_name", "lastName")) if x)
    status = str(_dig(raw, "enrichment_status", "status", "state") or "").lower()
    return {
        "lead_id": _dig(raw, "lead_id", "leadId", "id"),
        "name": name or None,
        "title": _dig(raw, "job_title", "jobTitle", "title"),
        "company": _dig(raw, "company_name", "companyName"),
        "email": work[0] if work else None,
        "email_status": work[2] if work else None,
        "personal_email": personal[0] if personal else None,
        "linkedin": linkedin if isinstance(linkedin, str) else None,
        "phones": _phones(raw),
        "found": bool(work or personal) or status in ("success", "succeeded", "found", "completed"),
        "raw": raw,
    }


def _payload_list(payload, key):
    """A search page: `payload` is an object holding `key`, or `[]` when
    nothing matched."""
    if isinstance(payload, list) or not isinstance(payload, dict):
        return [], {"total": 0, "page": 1, "has_next": False, "display_limit": None}
    return payload.get(key) or [], {
        "total": _int(payload.get("total_results")) or 0, "page": _int(payload.get("page")) or 1,
        "has_next": bool(payload.get("has_next_page")), "display_limit": _int(payload.get("display_limit"))}


# == the client ======================================================================

class Client:
    def __init__(self, key=None, *, session=None, base_url=None, sleep=time.sleep, clock=time.monotonic):
        import requests
        self.key = key if key is not None else api_key()
        if not self.key:
            raise AuthError("SALESHANDY_API_KEY is not set on this service")
        self.session = session or requests.Session()
        self.base = (base_url or BASE_URL).rstrip("/")
        self.sleep, self.clock = sleep, clock
        self.log = []            # one entry per request: what was asked and how it went
        self._last = None

    # -- transport ---------------------------------------------------------------
    def _req(self, method, path, body=None, *, gap=True):
        if gap and self._last is not None:
            wait = SEARCH_GAP_S - (self.clock() - self._last)
            if wait > 0:
                self.sleep(wait)
        attempt = 0
        while True:
            started = self.clock()
            entry = {"method": method, "path": path, "status": None, "ms": 0, "note": ""}
            try:
                resp = self.session.request(method, self.base + path, json=body, timeout=TIMEOUT,
                                            headers={"x-api-key": self.key, "Accept": "application/json"})
            except Exception as e:
                entry.update(note="%s: %s" % (type(e).__name__, str(e)[:160]),
                             ms=int((self.clock() - started) * 1000))
                self.log.append(entry)
                self._last = self.clock()
                if attempt < RETRIES:
                    attempt += 1
                    self.sleep(2 ** attempt)
                    continue
                raise SaleshandyError("Saleshandy could not be reached: %s" % entry["note"]) from e
            self._last = self.clock()
            entry.update(status=resp.status_code, ms=int((self._last - started) * 1000))
            self.log.append(entry)
            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt < RETRIES:
                    attempt += 1
                    try:
                        wait = min(float(resp.headers.get("Retry-After") or 0), 30)
                    except ValueError:
                        wait = 0
                    self.sleep(wait or 2 ** attempt)
                    continue
                if resp.status_code == 429:
                    entry["note"] = "rate limited"
                    raise RateLimited("Saleshandy's rate limit was hit; try again in a minute", status=429)
                raise SaleshandyError("Saleshandy answered %s" % resp.status_code, status=resp.status_code)
            try:
                data = resp.json()
            except ValueError:
                data = {}
            if resp.status_code >= 400 or (isinstance(data, dict) and data.get("error") is True):
                message, code = self._error(data, resp.status_code)
                entry["note"] = message[:200]
                if code == 1001 or resp.status_code in (401, 403):
                    raise AuthError("Saleshandy did not accept the API key (%s)" % message,
                                    status=resp.status_code, code=code)
                raise SaleshandyError(message, status=resp.status_code, code=code)
            return data.get("payload") if isinstance(data, dict) and "payload" in data else data

    @staticmethod
    def _error(data, status):
        if not isinstance(data, dict):
            return "Saleshandy answered %s" % status, None
        msg = data.get("message")
        if isinstance(msg, list):
            msg = "; ".join(str(m) for m in msg)
        return (str(msg or data.get("error") or "Saleshandy answered %s" % status)), _int(data.get("code"))

    # -- account -----------------------------------------------------------------
    def credits(self):
        p = self._req("GET", "/credits", gap=False) or {}
        return {"total": p.get("totalCredits"), "today": p.get("creditConsumedToday"),
                "month": p.get("creditConsumedThisMonth")}

    def rate_limits(self):
        p = self._req("GET", "/enrich/rate-limits", gap=False) or {}
        out = {}
        for k, name in (("perMinute", "minute"), ("perHour", "hour"), ("perDay", "day")):
            v = p.get(k) or {}
            out[name] = {"limit": v.get("limit"), "remaining": v.get("remaining")}
        return out

    def filters(self):
        return self._req("GET", "/search/filters", gap=False)

    # -- search (free) -------------------------------------------------------------
    def search_people(self, filters, *, page=1, limit_per_company=None):
        body = dict(filters, page=page)
        if limit_per_company:
            body["limitPerCompany"] = limit_per_company
        rows, meta = _payload_list(self._req("POST", "/search/people", body), "people")
        return dict(meta, people=[person(r) for r in rows if isinstance(r, dict)])

    def count_people(self, filters):
        """How many people match: one free search; `total` is across all pages."""
        return self.search_people(filters)["total"]

    def search_companies(self, filters, *, page=1):
        rows, meta = _payload_list(self._req("POST", "/search/companies", dict(filters, page=page)), "company")
        return dict(meta, companies=[company(r) for r in rows if isinstance(r, dict)])

    # -- enrichment (credits) --------------------------------------------------------
    def enrich_contacts(self, *, lead_ids=(), linkedin_urls=(), names=(), reveal_phone=False,
                        profile_only=False, email_type="work_email", webhook_url=None):
        """Starts a job and returns its request id. `names` are
        {"first_name", "last_name", "company_domain"}. Spends credits."""
        lead_ids, linkedin_urls, names = list(lead_ids), list(linkedin_urls), list(names)
        if not (lead_ids or linkedin_urls or names):
            raise ValueError("nothing to enrich")
        if max(len(lead_ids), len(linkedin_urls), len(names)) > MAX_ENRICH:
            raise ValueError("at most %d records of each kind per request" % MAX_ENRICH)
        body = {}
        if lead_ids:
            body["lead_id"] = lead_ids
        if linkedin_urls:
            body["linkedin_url"] = linkedin_urls
        if names:
            body["full_name_with_company"] = names
        if profile_only:
            body["profile_only"] = True
        else:
            body["email_type"] = email_type
            body["reveal_phone"] = bool(reveal_phone)
        if webhook_url:
            body["webhook_url"] = webhook_url
        p = self._req("POST", "/enrich/contact", body) or {}
        rid = p.get("requestId")
        if not rid:
            raise SaleshandyError("Saleshandy started no enrichment job")
        return rid

    def enrich_companies(self, domains):
        domains = list(domains)
        if not domains or len(domains) > MAX_ENRICH:
            raise ValueError("between 1 and %d domains per request" % MAX_ENRICH)
        p = self._req("POST", "/enrich/company", {"company_domain": domains}) or {}
        rid = p.get("requestId")
        if not rid:
            raise SaleshandyError("Saleshandy started no enrichment job")
        return rid

    @staticmethod
    def _job(p):
        p = p or {}
        return {"request_id": p.get("requestId"), "status": p.get("status"), "total": p.get("totalRecords"),
                "processed": p.get("processed"), "succeeded": p.get("succeeded"), "failed": p.get("failed"),
                "already_revealed": p.get("alreadyRevealed"), "credits": p.get("creditsCharged")}

    def job_status(self, request_id):
        return self._job(self._req("GET", "/enrich/status/%s" % request_id, gap=False))

    def job_result(self, request_id):
        p = self._req("GET", "/enrich/status/result/%s" % request_id, gap=False) or {}
        out = self._job(p)
        out["records"] = [r for r in p.get("results") or [] if isinstance(r, dict)]
        return out

    def wait(self, request_id, *, timeout=600, every=4):
        """Polls until the job is done, then returns its results. A job still
        running at `timeout` comes back as it stands, status "in-progress"."""
        deadline = self.clock() + timeout
        while True:
            st = self.job_status(request_id)
            if st["status"] in ("completed", "failed"):
                return self.job_result(request_id)
            if self.clock() >= deadline:
                st["records"] = []
                return st
            self.sleep(every)
