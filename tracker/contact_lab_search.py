"""Contact Finder Lab (Phase 0): the two web-search backends it compares.

    searxng(query, base_url=None)                      -> result
    claude(query, *, model, budget, site=None, ask=None) -> result

Both return the same shape, so a run can score them side by side:

    {"backend", "query", "status", "results": [{"title", "url", "snippet",
     "engine", "page_age"}], "refused": {engine: reason}, "answered": [engine],
     "reply": str | None, "ms", "searches", "cost_usd", "note"}

status is "ok" (results came back), "empty" (the search ran and matched
nothing), "blocked" (every engine refused: a captcha, a rate limit, access
denied), "failed" (the backend could not be asked) or "not_configured".
A blocked or failed search is never reported as "nothing found".

SearXNG is our own metasearch service (deploy/searxng). It costs nothing per
query, but it asks Google, Bing and the rest from a server, and they refuse
servers often: from a cloud container on 2026-10-11, Google answered "access
denied", DuckDuckGo and Qwant a captcha, Brave "too many requests"; Bing
answered but ignored `site:` and quotes. SearXNG names each refusal in
`unresponsive_engines`, and that is kept per query so the lab can say which
engines a server can actually use.

Claude's web_search tool is $10 per 1,000 searches plus the tokens of the
results it reads. Its results carry a title, a URL and a page age, but no
readable snippet, so anything the lab needs from the text itself (an email
address) is asked of the model in the same call (`ask`).
"""
from __future__ import annotations

import os
import time
from decimal import Decimal

import requests

SEARXNG_TIMEOUT = 20
# The basic tool returns the results as they are; the dynamic-filtering
# version runs code over them first, which costs more and changes what the
# lab would be measuring. The newer one is only the fallback.
CLAUDE_TOOL_VERSIONS = ("web_search_20250305", "web_search_20260209")
CLAUDE_MAX_TOKENS = 1500
# A reservation per search, before the call: the results can run to tens of
# thousands of input tokens.
RESERVE_PROMPT_TOKENS = 40000


class BudgetExceeded(RuntimeError):
    """The next paid call could take the run past its cap; it was not made."""


class Budget:
    """A run's spending: every paid call is checked against the cap at its
    worst case BEFORE it is made, then booked at its measured cost. A lab run
    is one thread, so no lock. A call that could not be measured stays
    counted at its reservation, never at zero."""

    def __init__(self, cap_usd):
        self.cap = Decimal(str(cap_usd))
        self.spent = Decimal(0)
        self.calls = []

    def check(self, worst_case):
        worst_case = Decimal(str(worst_case))
        if self.spent + worst_case > self.cap:
            raise BudgetExceeded("the next call could cost up to $%.3f and $%.3f of the $%.2f cap is "
                                 "spent, so it was not made" % (worst_case, self.spent, self.cap))

    def add(self, stage, model, usd, usage, note=None):
        usd = Decimal(str(usd))
        self.spent += usd
        self.calls.append({"stage": stage, "model": model, "usd": float(usd), "note": note,
                           "input_tokens": (usage or {}).get("input_tokens"),
                           "output_tokens": (usage or {}).get("output_tokens")})

    def by_stage(self):
        out = {}
        for c in self.calls:
            out[c["stage"]] = round(out.get(c["stage"], 0) + c["usd"], 6)
        return out


def _blank(backend, query):
    return {"backend": backend, "query": query, "status": "failed", "results": [], "refused": {},
            "answered": [], "reply": None, "ms": 0, "searches": 0, "cost_usd": 0.0, "note": ""}


# == SearXNG ======================================================================

def searxng_url():
    return (os.environ.get("SEARXNG_URL") or "").strip().rstrip("/")


def searxng(query, base_url=None, *, engines=None, session=None):
    """One query through our SearXNG service. Free; never raises."""
    out = _blank("searxng", query)
    base = (base_url or searxng_url()).rstrip("/")
    if not base:
        out.update(status="not_configured", note="SEARXNG_URL is not set")
        return out
    params = {"q": query, "format": "json"}
    if engines:
        params["engines"] = ",".join(engines)
    started = time.monotonic()
    try:
        r = (session or requests).get(base + "/search", params=params, timeout=SEARXNG_TIMEOUT,
                                      headers={"Accept": "application/json"})
    except Exception as e:
        out["ms"] = int((time.monotonic() - started) * 1000)
        out["note"] = "SearXNG could not be reached (%s)" % type(e).__name__
        return out
    out["ms"] = int((time.monotonic() - started) * 1000)
    if r.status_code == 403:
        out["note"] = "SearXNG refused JSON (HTTP 403): its settings must list json under search.formats"
        return out
    if r.status_code != 200:
        out["note"] = "SearXNG answered HTTP %s" % r.status_code
        return out
    try:
        data = r.json()
    except ValueError:
        out["note"] = "SearXNG did not answer JSON"
        return out
    out["searches"] = 1
    for pair in data.get("unresponsive_engines") or []:
        if isinstance(pair, (list, tuple)) and pair:
            out["refused"][str(pair[0])] = str(pair[1]) if len(pair) > 1 else "no reason given"
    answered = set()
    for item in data.get("results") or []:
        url = item.get("url") or ""
        if not url:
            continue
        engines_of = item.get("engines") or ([item["engine"]] if item.get("engine") else [])
        answered.update(engines_of)
        out["results"].append({"title": item.get("title") or "", "url": url,
                               "snippet": item.get("content") or "",
                               "engine": ",".join(engines_of), "page_age": item.get("publishedDate")})
    out["answered"] = sorted(answered)
    if out["results"]:
        out["status"] = "ok"
    elif out["refused"]:
        out["status"] = "blocked"
        out["note"] = "every engine that was asked refused"
    else:
        out["status"] = "empty"
    return out


def searxng_health(base_url=None, *, session=None):
    """{"configured", "ok", "note"}: is the service up? Free."""
    base = (base_url or searxng_url()).rstrip("/")
    if not base:
        return {"configured": False, "ok": False, "note": "SEARXNG_URL is not set"}
    try:
        r = (session or requests).get(base + "/healthz", timeout=8)
    except Exception as e:
        return {"configured": True, "ok": False, "note": "not reachable (%s)" % type(e).__name__}
    return {"configured": True, "ok": r.status_code == 200,
            "note": "up" if r.status_code == 200 else "HTTP %s" % r.status_code}


# == Claude web_search =============================================================

def claude_configured():
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _client():
    from anthropic import Anthropic
    return Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], timeout=180, max_retries=2)


SEARCH_SYSTEM = (
    "You run web searches for a research tool. Search the web exactly once, with exactly the "
    "query you are given, word for word. Do not search again and do not answer from memory. "
    "After the search, follow the instruction that comes with the query, using only what the "
    "search returned.")


def _get(obj, key, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _usage_dict(resp):
    usage = _get(resp, "usage")
    if usage is None:
        return {}
    if hasattr(usage, "model_dump"):
        return usage.model_dump()
    return dict(usage) if isinstance(usage, dict) else {}


def _unsupported_tool(err):
    status = getattr(err, "status_code", None)
    if isinstance(status, int) and (status == 429 or status >= 500):
        return False
    text = str(err).lower()
    return status == 400 and ("tool" in text or "web_search" in text)


def claude(query, *, model, budget, site=None, ask=None, client=None):
    """One web search through Claude. Paid: reserved against `budget` first,
    and refused (BudgetExceeded propagates) when the run's cap would be
    passed. `site` limits results to one domain; `ask` is what to report
    from the results, read into `reply`."""
    from . import market_radar_costs as costs
    out = _blank("claude", query)
    if client is None:
        if not claude_configured():
            out.update(status="not_configured", note="ANTHROPIC_API_KEY is not set")
            return out
        client = _client()
    reserve = costs.worst_case_model_usd(model, RESERVE_PROMPT_TOKENS, CLAUDE_MAX_TOKENS, searches=1)
    budget.check(reserve)
    instruction = ask or "Reply with the single word DONE."
    user = "Query: %s\n\nInstruction: %s" % (query, instruction)
    started = time.monotonic()
    resp, last_error = None, None
    for version in CLAUDE_TOOL_VERSIONS:
        tool = {"type": version, "name": "web_search", "max_uses": 1}
        if site:
            tool["allowed_domains"] = [site]
        try:
            resp = client.messages.create(model=model, max_tokens=CLAUDE_MAX_TOKENS, system=SEARCH_SYSTEM,
                                          messages=[{"role": "user", "content": user}], tools=[tool])
            out["tool_version"] = version
            break
        except Exception as e:
            last_error = e
            if not _unsupported_tool(e):
                break
    out["ms"] = int((time.monotonic() - started) * 1000)
    if resp is None:
        status = getattr(last_error, "status_code", None)
        # A request the API refused outright was not billed.
        if not (isinstance(status, int) and 400 <= status < 500 and status != 429):
            budget.add("search", model, Decimal(reserve), None, note="no reply; counted at its reservation")
            out["cost_usd"] = float(reserve)
        out["note"] = "the search call failed (%s: %s)" % (type(last_error).__name__, str(last_error)[:200])
        return out
    usage = _usage_dict(resp)
    served = _get(resp, "model") or model
    try:
        usd, _ = costs.model_cost(served, usage)
    except Exception as e:
        usd = Decimal(reserve)
        out["note"] = "could not price the call (%s); counted at its reservation" % e
    budget.add("search", served, usd, usage)
    out["cost_usd"] = float(usd)
    tool_use = usage.get("server_tool_use") or {}
    out["searches"] = int(tool_use.get("web_search_requests") or 0) if isinstance(tool_use, dict) else 0
    errors = []
    for block in _get(resp, "content") or []:
        if _get(block, "type") != "web_search_tool_result":
            continue
        content = _get(block, "content")
        if isinstance(content, list):
            for item in content:
                url = _get(item, "url") or ""
                if url:
                    out["results"].append({"title": _get(item, "title") or "", "url": url, "snippet": "",
                                           "engine": "claude", "page_age": _get(item, "page_age")})
        elif content is not None:
            errors.append(_get(content, "error_code") or "error")
    out["reply"] = "".join(_get(b, "text") or "" for b in _get(resp, "content") or []
                           if _get(b, "type") == "text").strip() or None
    if _get(resp, "stop_reason") == "refusal":
        out["note"] = "the model declined"
    if out["results"]:
        out["status"] = "ok"
    elif errors:
        out["status"] = "blocked"
        out["refused"] = {"claude": ", ".join(errors)}
        out["note"] = "the search tool returned an error: %s" % ", ".join(errors)
    elif out["searches"] == 0:
        out["status"] = "failed"
        out["note"] = out["note"] or "the model did not run the search"
    else:
        out["status"] = "empty"
    out["answered"] = ["claude"] if out["results"] else []
    return out
