"""Warmly's REST API (the "agent tools"), the calls the partner outreach uses.

    wm = Client()                         # key from WARMLY_API_KEY, org from WARMLY_ORG_ID
    wm.credits()                          # what get_credits_remaining says is left this month
    wm.tools()                            # the tools this organisation may call, with their input schemas
    wm.visitors(time_window="past_week")  # people Warmly identified on our site (free)
    wm.accounts(time_window="past_week")  # the same, grouped by company (free)
    wm.signals(signal_category="...")     # third-party buying signals, as a free preview only

Reference: https://help.warmly.ai/articles/9641856032-warmly-technical-documentation-rest-api

What costs what (Warmly, 2026): one pool of credits per workspace, shared with the rest of Warmly and
reset each month. Listing visitors and accounts and reading the balance are free; the credits are spent
by Warmly itself when its script on our site identifies a visitor (1 for the company, 1 for the person,
at most 2 per visitor a month). list_third_party_signals costs 1 credit per new company and 1 per new
contact on a row, unless it is called with preview: true. This client only ever asks for the preview, so
nothing it does spends a credit; a paid pull is a later change, with its own cost ledger in
tracker/admin_spend.py.

The quirks handled here:
- every call that reaches Warmly answers 202, even when the tool failed: success is `status` and
  `output.success` in the body, and a failure carries `userFacingError`;
- an async tool answers `pending` or `running` and is read again from /agent-tools/executions/<id>;
- 429 means wait about a minute (60 calls a minute on the free plan, 120 on paid ones).
"""
from __future__ import annotations

import os
import re
import time

import requests

BASE_URL = "https://opps-api.getwarmly.com/api"
TIMEOUT = 30
RETRIES = 1              # on 429 and 5xx, after the first try
RETRY_WAIT_S = 2         # Warmly asks for ~60s after a 429; a page request will not wait that long
POLL_S = 2
POLL_FOR_S = 60
TIME_WINDOWS = ("past_day", "past_week")
FREE_TOOLS = ("list_warm_visitors", "list_warm_accounts", "get_credits_remaining")


class WarmlyError(RuntimeError):
    def __init__(self, message, *, status=None):
        super().__init__(message)
        self.status = status


class AuthError(WarmlyError):
    """The key or the organisation id is missing, wrong or revoked."""


class RateLimited(WarmlyError):
    """Warmly kept answering 429."""


def api_key():
    return (os.environ.get("WARMLY_API_KEY") or "").strip()


def org_id():
    return (os.environ.get("WARMLY_ORG_ID") or "").strip()


def configured():
    return bool(api_key() and org_id())


def missing():
    """The Railway variables still to set, in the order to set them."""
    return [name for name, v in (("WARMLY_API_KEY", api_key()), ("WARMLY_ORG_ID", org_id())) if not v]


def pixel_id():
    """The client id in Warmly's website script (Settings → General in Warmly). It is public by nature (it
    sits in the page), but it is checked so nothing but an id can reach the page."""
    raw = (os.environ.get("WARMLY_CLIENT_ID") or "").strip()
    m = re.search(r"clientId=([A-Za-z0-9_\-]+)", raw)       # the whole <script> tag pasted works too
    raw = m.group(1) if m else raw
    return raw if re.fullmatch(r"[A-Za-z0-9_\-]{4,100}", raw) else ""


def pixel_paths():
    """Where the website script runs: WARMLY_PIXEL_PATHS, comma-separated path prefixes. It defaults to
    the partner pages, because every visitor Warmly identifies spends up to 2 credits."""
    raw = os.environ.get("WARMLY_PIXEL_PATHS")
    paths = [p.strip() for p in (raw if raw is not None else "/partners").split(",") if p.strip()]
    return [p if p.startswith("/") else "/" + p for p in paths]


def pixel_on(path):
    """True when the website script belongs on this page."""
    if not pixel_id():
        return False
    for prefix in pixel_paths():
        if prefix == "/" or path == prefix or path.startswith(prefix.rstrip("/") + "/"):
            return True
    return False


def _clean_input(d):
    return {k: v for k, v in d.items() if v is not None and v != [] and v != ""}


class Client:
    def __init__(self, key=None, org=None, *, session=None, sleep=time.sleep):
        self.key = (key if key is not None else api_key()).strip()
        self.org = (org if org is not None else org_id()).strip()
        self.http = session or requests.Session()
        self.sleep = sleep

    # -- transport ---------------------------------------------------------------------------------

    def _request(self, method, path, *, params=None, body=None):
        if not self.key or not self.org:
            raise AuthError("Warmly needs WARMLY_API_KEY and WARMLY_ORG_ID on this service "
                            "(Railway → web → Variables).")
        headers = {"Authorization": "Bearer " + self.key, "Accept": "application/json"}
        for attempt in range(RETRIES + 1):
            r = self.http.request(method, BASE_URL + path, headers=headers, params=params, json=body,
                                  timeout=TIMEOUT)
            if r.status_code == 429 or r.status_code >= 500:
                if attempt < RETRIES:
                    self.sleep(RETRY_WAIT_S)
                    continue
                if r.status_code == 429:
                    raise RateLimited("Warmly is rate limiting this key; try again in a minute.", status=429)
                raise WarmlyError("Warmly answered %s." % r.status_code, status=r.status_code)
            break
        try:
            data = r.json()
        except ValueError:
            data = {}
        if r.status_code in (401, 403):
            raise AuthError(_message(data) or ("Warmly refused the key (%s): check WARMLY_API_KEY, and that "
                                               "WARMLY_ORG_ID is the same organisation." % r.status_code),
                            status=r.status_code)
        if r.status_code >= 400:
            raise WarmlyError(_message(data) or "Warmly answered %s." % r.status_code, status=r.status_code)
        return data

    # -- the API -----------------------------------------------------------------------------------

    def tools(self):
        """[{"name", "description", "isAsync", "inputSchema"}] this organisation may call."""
        data = self._request("GET", "/agent-tools/tools", params={"organizationId": self.org})
        rows = data if isinstance(data, list) else (data.get("tools") or data.get("data") or [])
        return [t for t in rows if isinstance(t, dict) and t.get("name")]

    def execute(self, tool, tool_input=None, *, reasoning=None, external_ref=None):
        """Run one tool and return its output. A tool that failed raises, whatever the HTTP status."""
        body = {"toolName": tool, "organizationId": self.org, "input": _clean_input(tool_input or {})}
        if reasoning:
            body["reasoning"] = reasoning
        if external_ref:
            body["externalRef"] = external_ref
        run = self._request("POST", "/agent-tools/execute", body=body)
        waited = 0
        while _status(run) in ("pending", "running") and waited < POLL_FOR_S:
            run_id = run.get("id") or run.get("executionId")
            if not run_id:
                break
            self.sleep(POLL_S)
            waited += POLL_S
            run = self._request("GET", "/agent-tools/executions/%s" % run_id)
        return _output(tool, run)

    def credits(self):
        return self.execute("get_credits_remaining")

    def visitors(self, *, time_window="past_day", take=25, offset=0, require_business_contact=None,
                 search=None, countries=None, industries=None, employee_bands=None, pages_visited=None):
        return self.execute("list_warm_visitors", {
            "timeWindow": _window(time_window), "take": max(1, min(int(take), 500)), "offset": int(offset),
            "requireBusinessContact": require_business_contact, "searchTerm": search, "countries": countries,
            "industries": industries, "employeeSizeBands": employee_bands, "pagesVisitedContains": pages_visited})

    def accounts(self, *, time_window="past_day", take=25, offset=0, search=None, countries=None,
                 industries=None, employee_bands=None, pages_visited=None):
        return self.execute("list_warm_accounts", {
            "timeWindow": _window(time_window), "take": max(1, min(int(take), 500)), "offset": int(offset),
            "searchTerm": search, "countries": countries, "industries": industries,
            "employeeSizeBands": employee_bands, "pagesVisitedContains": pages_visited})

    def signals(self, *, signal_category=None, signal_type=None, signal_subtype=None, company_domain=None,
                detected_since=None, take=25, offset=0):
        """Third-party buying signals, always as a preview: free, and never charged."""
        return self.execute("list_third_party_signals", {
            "mode": "by_company" if company_domain else "by_signal", "signalCategory": signal_category,
            "signalType": signal_type, "signalSubtype": signal_subtype, "companyDomain": company_domain,
            "detectedSince": detected_since, "take": max(1, min(int(take), 100)), "offset": int(offset),
            "preview": True})


def _window(w):
    if w not in TIME_WINDOWS:
        raise ValueError("time_window is one of %s" % ", ".join(TIME_WINDOWS))
    return w


def _status(run):
    return (run.get("status") or "").lower() if isinstance(run, dict) else ""


def _message(data):
    if not isinstance(data, dict):
        return ""
    out = data.get("output") if isinstance(data.get("output"), dict) else {}
    for v in (data.get("userFacingError"), out.get("userFacingError"), data.get("message"), data.get("error")):
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _output(tool, run):
    status = _status(run)
    out = run.get("output") if isinstance(run, dict) else None
    ok = status in ("succeeded", "success", "completed", "done") or (not status and out is not None)
    if isinstance(out, dict) and out.get("success") is False:
        ok = False
    if status in ("pending", "running"):
        raise WarmlyError("Warmly is still running %s; read it again in a minute." % tool)
    if status == "awaiting_approval":
        raise WarmlyError("Warmly is holding %s for approval in the Warmly app." % tool)
    if not ok:
        raise WarmlyError(_message(run) or "Warmly could not run %s (%s)." % (tool, status or "no status"))
    if isinstance(out, dict) and "data" in out and set(out) <= {"data", "success", "meta", "userFacingError"}:
        return out["data"]
    return out


def status():
    """What /admin/warmly/status shows: whether Warmly is connected, the balance, the tools it allows, and
    where the website script runs. Only free calls."""
    report = {"configured": configured(), "missing": missing(), "pixel": {
        "client_id_set": bool(pixel_id()), "paths": pixel_paths()}}
    if not report["configured"]:
        return report
    wm = Client()
    try:
        report["tools"] = [{"name": t["name"], "async": bool(t.get("isAsync")),
                            "spends_credits": t["name"] not in FREE_TOOLS} for t in wm.tools()]
        report["credits"] = wm.credits()
        report["ok"] = True
    except WarmlyError as e:
        report["ok"], report["error"] = False, str(e)
    return report
