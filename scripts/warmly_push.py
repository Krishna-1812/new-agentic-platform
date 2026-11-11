#!/usr/bin/env python3
"""Sends what the daily Warmly routine found to Lead Finder (docs/warmly-engine.md).

The routine reads Warmly through its MCP server, saves the rows it got to a JSON file, and runs:

    python3 scripts/warmly_push.py budget                      # the month's credits, and today's share
    python3 scripts/warmly_push.py push FILE --credits N       # the rows, and the credits the pulls spent

FILE holds the rows by kind, each a list of rows or the whole answer of the Warmly tool (its "results"
are read):

    {"visitors": [...], "accounts": [...], "signals": [...]}

The workspace's Warmly token is never in a file, a prompt or this script: the routine's network proxy
adds it to every request to the site as the X-Warmly-Push-Token header (a network secret on the cloud
environment). WARMLY_PUSH_TOKEN, when set, is sent instead, for a run on a machine without that proxy.

Before sending, rows the site would only count as repeats are left out (a visit last seen before
--since-hours), and so are hiring signals from companies that are not agencies: the team does not want
"hiring for it" leads for brands, and an agency hiring paid media people is a partner lead.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

SITE = os.environ.get("LEAD_FINDER_URL", "https://northaxis.outcomes.digital").rstrip("/")
PATH = "/api/lead-finder/warmly-push"
HEADER = "X-Warmly-Push-Token"
KINDS = ("visitors", "accounts", "signals")
HIRING = ("hiring-trends", "hiring-velocity")
AGENCY_WORDS = ("marketing", "advertising", "media", "public relations", "design services")
TIMEOUT = 60


def rows_of(value):
    """A list of rows, from a list or from a Warmly tool's whole answer ({"results": [...]})."""
    if isinstance(value, dict):
        value = value.get("results") if isinstance(value.get("results"), list) else []
    return [r for r in value if isinstance(r, dict)] if isinstance(value, list) else []


def _when(v):
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None


def recent(row, since):
    """A visit last seen at or after `since`; a row with no date is kept (the site decides)."""
    seen = _when(row.get("lastSeen")) if row.get("lastSeen") else None
    return seen is None or seen >= since


def agency(row):
    co = row.get("company") if isinstance(row.get("company"), dict) else {}
    words = " ".join(str(i) for i in (co.get("industries") or []) if i).lower() + " " + str(co.get("description") or "").lower()
    return any(w in words for w in AGENCY_WORDS)


def wanted_signal(row):
    return row.get("signal_type") not in HIRING or agency(row)


def batches(found, since):
    """[{"kind", "rows"}] from the file's rows, and how many were left out, by kind."""
    out, left = [], {}
    for kind in KINDS:
        rows = rows_of(found.get(kind))
        keep = [r for r in rows if (kind == "signals" and wanted_signal(r)) or (kind != "signals" and recent(r, since))]
        left[kind] = len(rows) - len(keep)
        if keep:
            out.append({"kind": kind, "rows": keep})
    return out, left


def _headers():
    h = {"Accept": "application/json"}
    token = (os.environ.get("WARMLY_PUSH_TOKEN") or "").strip()
    if token:
        h[HEADER] = token
    return h


class _Answer:
    def __init__(self, status, raw):
        self.status_code, self._raw = status, raw

    def json(self):
        return json.loads(self._raw.decode("utf-8") or "null")


class _Urllib:
    """requests' request(), from the standard library, for a machine without requests. It trusts the CA
    bundle the environment names for requests or curl (the cloud session's proxy has its own)."""

    def request(self, method, url, json=None, headers=None, timeout=None):
        import json as _json
        import ssl
        import urllib.error
        import urllib.request
        data = _json.dumps(json).encode() if json is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers=dict(headers or {}))
        if data is not None:
            req.add_header("Content-Type", "application/json")
        ca = os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("CURL_CA_BUNDLE") or None
        ctx = ssl.create_default_context(cafile=ca)
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
                return _Answer(r.status, r.read())
        except urllib.error.HTTPError as e:
            return _Answer(e.code, e.read())


def _http():
    try:
        import requests
        return requests
    except ImportError:
        return _Urllib()


def _call(method, body=None, *, http=None):
    http = http or _http()
    r = http.request(method, SITE + PATH, json=body, headers=_headers(), timeout=TIMEOUT)
    try:
        data = r.json()
    except ValueError:
        data = {"ok": False, "error": "The site answered %s without JSON." % r.status_code}
    if r.status_code == 404:
        data = dict(data, hint=("The site did not know the token. The cloud environment needs the network secret "
                                "%s for %s, holding the workspace's Warmly token (Lead Finder > Settings)."
                                % (HEADER, SITE.split("//", 1)[-1])))
    return r.status_code, data


def main(argv=None, *, http=None, now=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("budget")
    push = sub.add_parser("push")
    push.add_argument("file")
    push.add_argument("--credits", type=float, default=0.0, help="Warmly credits the routine's pulls spent")
    push.add_argument("--since-hours", type=float, default=48.0, help="visits last seen within this many hours")
    a = p.parse_args(argv)
    if a.cmd == "budget":
        status, data = _call("GET", http=http)
    else:
        with open(a.file, encoding="utf-8") as fh:
            found = json.load(fh)
        if not isinstance(found, dict):
            print(json.dumps({"ok": False, "error": "FILE holds {\"visitors\": [...], \"accounts\": [...], \"signals\": [...]}."}))
            return 2
        since = (now or datetime.now(timezone.utc)) - timedelta(hours=a.since_hours)
        bs, left = batches(found, since)
        status, data = _call("POST", {"batches": bs, "credits": max(0.0, a.credits)}, http=http)
        data = dict(data, left_out_before_sending=left)
    print(json.dumps(data, indent=2, sort_keys=True))
    return 0 if status == 200 and data.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
