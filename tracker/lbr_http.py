"""Local Business Radar: every outside call, and what each one cost.

One function, `call()`, makes every HTTP request the agent sends. It:
  - retries what is worth retrying (429, 5xx, a dropped connection) with a
    capped backoff that honours Retry-After, and nothing else;
  - turns a failure into a ToolError whose message an admin can act on and
    that never contains a key (SerpAPI and PageSpeed take theirs in the URL);
  - writes one line per request into the run's Ledger, priced from
    lbr_config.PRICES, so the report can show what the run spent by provider.

A request that fails is recorded at $0: Google does not bill failed requests
and SerpAPI does not count errored searches (see the sources in PRICES).
"""

import logging
import re
import threading
import time

import requests

from tracker import lbr_config

log = logging.getLogger(__name__)

RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_RETRY_WAIT = 10.0

# Tests swap this for a fake; production uses one pooled session per process.
_SESSION = None
_SESSION_LOCK = threading.Lock()


def session():
    global _SESSION
    with _SESSION_LOCK:
        if _SESSION is None:
            s = requests.Session()
            s.headers["User-Agent"] = "LocalBusinessRadar/1.0 (+https://intelligence.position2.com)"
            _SESSION = s
        return _SESSION


def set_session(s):
    """Replace the transport (tests)."""
    global _SESSION
    with _SESSION_LOCK:
        _SESSION = s


class ToolError(Exception):
    """A call to an outside service that did not succeed."""

    def __init__(self, provider, message, status=None, retryable=False):
        super().__init__(message)
        self.provider = provider
        self.status = status
        self.retryable = retryable

    def as_dict(self):
        return {"provider": self.provider, "status": self.status, "message": str(self)}


_SECRET_PARAM = re.compile(r"((?:api_key|key|token)=)[^&\s\"']+", re.I)


def redact(text):
    """Remove any key or token from a URL or message."""
    return _SECRET_PARAM.sub(r"\1[redacted]", str(text or ""))


class Ledger:
    """Every request a run made. Thread-safe: stages call out concurrently."""

    def __init__(self):
        self._lock = threading.Lock()
        self.entries = []

    def add(self, provider, op, units=1, usd=None, ok=True, status=None, ms=0, detail=""):
        entry = {"provider": provider, "op": op, "units": units, "usd": usd, "ok": ok,
                 "status": status, "ms": int(ms), "detail": redact(detail)[:300],
                 "at": time.time()}
        with self._lock:
            self.entries.append(entry)
        return entry

    def add_claude(self, model_name, usage, ok=True, detail=""):
        """One Claude call, priced from its reported token usage."""
        usage = usage or {}
        tin = int(usage.get("input_tokens") or 0) + int(usage.get("cache_creation_input_tokens") or 0) \
            + int(usage.get("cache_read_input_tokens") or 0)
        tout = int(usage.get("output_tokens") or 0)
        usd = lbr_config.claude_usd(model_name, tin, tout) if ok else 0.0
        return self.add("claude", "messages", units=tin + tout, usd=usd, ok=ok, detail=detail)

    def drain(self):
        """Hand back and forget the entries recorded so far (for persisting)."""
        with self._lock:
            out, self.entries = self.entries, []
        return out

    def totals(self):
        with self._lock:
            entries = list(self.entries)
        return summarise(entries)


def summarise(entries):
    """Spend by provider, with what could not be priced counted separately."""
    by = {}
    total = 0.0
    unpriced = 0
    for e in entries:
        p = by.setdefault(e["provider"], {"calls": 0, "failed": 0, "usd": 0.0, "unpriced": 0})
        p["calls"] += 1
        if not e.get("ok"):
            p["failed"] += 1
        if e.get("usd") is None:
            p["unpriced"] += 1
            unpriced += 1
        else:
            p["usd"] += float(e["usd"])
            total += float(e["usd"])
    for p in by.values():
        p["usd"] = round(p["usd"], 4)
    return {"usd": round(total, 4), "calls": len(entries), "unpriced": unpriced, "by_provider": by}


def _human(provider, status, body):
    """A message an admin can act on, for one failed response."""
    name = lbr_config.TOOLS_BY_KEY.get(provider, {}).get("name", provider)
    reason = ""
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            reason = err.get("message") or err.get("status") or ""
        elif isinstance(err, str):
            reason = err
    reason = redact(reason)[:200]
    if status in (401, 403):
        return "%s refused the key (HTTP %s). %s" % (name, status, reason or "Check it is valid and "
                                                     "that the API is enabled for it.")
    if status == 429:
        return "%s is rate-limiting or out of quota (HTTP 429). %s" % (name, reason)
    if status == 400:
        return "%s rejected the request (HTTP 400). %s" % (name, reason)
    return "%s returned HTTP %s. %s" % (name, status, reason)


def call(ledger, provider, op, method, url, *, params=None, json_body=None, headers=None,
         timeout=25, units=1, retries=2, price_op=None, expect_json=True):
    """Make one request; return the parsed JSON (or the Response when expect_json is False).

    `price_op` names the PRICES entry the request is billed under; `units` is
    how many of that entry's unit it counts as.
    """
    rate = lbr_config.price(price_op) if price_op else None
    attempt = 0
    while True:
        started = time.time()
        try:
            resp = session().request(method, url, params=params, json=json_body,
                                     headers=headers, timeout=timeout)
        except requests.RequestException as exc:
            ms = (time.time() - started) * 1000
            if attempt < retries:
                attempt += 1
                time.sleep(min(MAX_RETRY_WAIT, 0.8 * (2 ** (attempt - 1))))
                continue
            ledger.add(provider, op, units, 0.0, ok=False, ms=ms, detail=type(exc).__name__)
            raise ToolError(provider, "%s could not be reached (%s)." % (
                lbr_config.TOOLS_BY_KEY.get(provider, {}).get("name", provider),
                type(exc).__name__), retryable=True)
        ms = (time.time() - started) * 1000
        status = resp.status_code
        if status in RETRY_STATUSES and attempt < retries:
            attempt += 1
            wait = 0.8 * (2 ** (attempt - 1))
            try:
                wait = float(resp.headers.get("Retry-After") or wait)
            except (TypeError, ValueError):
                pass
            time.sleep(min(MAX_RETRY_WAIT, max(0.0, wait)))
            continue
        if status >= 400:
            try:
                body = resp.json()
            except ValueError:
                body = None
            ledger.add(provider, op, units, 0.0, ok=False, status=status, ms=ms,
                       detail=_human(provider, status, body))
            raise ToolError(provider, _human(provider, status, body), status=status,
                            retryable=status in RETRY_STATUSES)
        if not expect_json:
            ledger.add(provider, op, units, None if rate is None else rate * units,
                       ok=True, status=status, ms=ms)
            return resp
        try:
            data = resp.json()
        except ValueError:
            ledger.add(provider, op, units, 0.0, ok=False, status=status, ms=ms, detail="not JSON")
            raise ToolError(provider, "%s sent a reply that is not JSON." % provider, status=status)
        # SerpAPI reports some failures with HTTP 200 and an "error" field.
        if isinstance(data, dict) and isinstance(data.get("error"), str) and provider == "serpapi":
            msg = redact(data["error"])[:200]
            benign = "hasn't returned any results" in msg or "no results" in msg.lower()
            ledger.add(provider, op, units, 0.0, ok=benign, status=status, ms=ms, detail=msg)
            if benign:
                return {}
            raise ToolError(provider, "SerpAPI: %s" % msg, status=status)
        ledger.add(provider, op, units, None if rate is None else rate * units,
                   ok=True, status=status, ms=ms)
        return data
