"""Apify actor transport: start a run, poll it to completion, fetch its
dataset. Actor-agnostic; every platform-specific scraper (sci_source_*.py)
builds its own actor input and normalizes its own output on top of this.

Mirrors tracker/apollo_client.py's convention: the token is an explicit
parameter on every public function, never read from the environment in here
-- the caller (app.py / sci_pipeline.py) reads APIFY_API_TOKEN and decides
what an unset token means for that call site (a cheap check degrades to [],
a user-initiated action returns a clear "not configured" error).
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.apify.com/v2"


class ApifyTransportError(Exception):
    """Raised by run_actor_and_wait(strict=True) so callers can distinguish
    'the vendor call failed' from 'the vendor call succeeded with no rows'."""


def _headers(token: str) -> dict:
    return {"Authorization": "Bearer " + token, "Content-Type": "application/json"}


def _normalize_actor_id(actor_id: str) -> str:
    """Every DEFAULT_ACTOR_ID in sci_source_*.py is written in Apify's own
    "owner/name" console-URL form (e.g. "apify/facebook-posts-scraper"),
    because that is the form Apify's docs and store pages show and the one a
    human would type into an env var override. The REST API does not accept
    that form as a single path segment: /v2/acts/<actor_id> and
    /v2/acts/<actor_id>/runs both 404 on a literal slash and require the
    owner and name joined with "~" instead (confirmed live, unauthenticated,
    against api.apify.com). Normalize at the transport boundary so every
    caller and every env var can keep writing the readable slash form."""
    return actor_id.replace("/", "~", 1) if actor_id and "/" in actor_id else actor_id


def _start_run(actor_id: str, run_input: dict, token: str, max_charge_usd: float | None = None) -> str:
    url = f"{_BASE_URL}/acts/{_normalize_actor_id(actor_id)}/runs"
    # maxTotalChargeUsd: for pay-per-event Actors, Apify stops charging (and
    # the run stops producing) once this much has been charged.
    params = {"maxTotalChargeUsd": "%.2f" % max_charge_usd} if max_charge_usd else None
    resp = requests.post(url, json=run_input, headers=_headers(token), params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()["data"]["id"]


def _poll_run(run_id: str, token: str, timeout: int, poll_interval: int) -> dict:
    url = f"{_BASE_URL}/actor-runs/{run_id}"
    deadline = time.monotonic() + timeout
    while True:
        resp = requests.get(url, headers=_headers(token), timeout=30)
        resp.raise_for_status()
        data = resp.json()["data"]
        status = data.get("status")
        if status in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"):
            return data
        if time.monotonic() >= deadline:
            raise ApifyTransportError(
                "Apify run %s did not finish within %ss (last status: %s)" % (run_id, timeout, status))
        time.sleep(poll_interval)


def _fetch_dataset_items(dataset_id: str, token: str) -> list[dict]:
    url = f"{_BASE_URL}/datasets/{dataset_id}/items"
    resp = requests.get(url, headers=_headers(token), params={"format": "json"}, timeout=60)
    resp.raise_for_status()
    items = resp.json()
    return items if isinstance(items, list) else []


def run_actor_collect(actor_id: str, run_input: dict, token: str, timeout: int = 240,
                      poll_interval: int = 5, memory_mb: int | None = None) -> dict:
    """Run an actor for at most `timeout` seconds and keep whatever it saved.

    For actors whose partial output is worth having (a crawler that loaded
    30 of 35 pages before its time ran out). Apify is told to stop the run
    itself at `timeout`; whatever state it ends in, its dataset is read.
    A run still going when polling gives up is aborted first. Never raises:
    returns {"items": [...], "status": str|None, "error": str|None}."""
    out: dict = {"items": [], "status": None, "error": None}
    try:
        url = f"{_BASE_URL}/acts/{_normalize_actor_id(actor_id)}/runs"
        params = {"timeout": int(timeout)}
        if memory_mb:
            params["memory"] = int(memory_mb)
        resp = requests.post(url, json=run_input, headers=_headers(token),
                             params=params, timeout=30)
        resp.raise_for_status()
        run = resp.json()["data"]
    except Exception as e:
        out["error"] = "start failed: %s" % str(e)[:200]
        return out
    try:
        run = _poll_run(run["id"], token, timeout + 30, poll_interval)
    except Exception as e:
        out["error"] = str(e)[:200]
        try:
            requests.post(f"{_BASE_URL}/actor-runs/{run['id']}/abort",
                          headers=_headers(token), timeout=30)
        except Exception:
            pass
    out["status"] = run.get("status")
    if run.get("defaultDatasetId"):
        try:
            out["items"] = _fetch_dataset_items(run["defaultDatasetId"], token)
        except Exception as e:
            out["error"] = out["error"] or "dataset read failed: %s" % str(e)[:200]
    return out


def run_actor_and_wait(actor_id: str, run_input: dict, token: str, timeout: int = 300,
                       poll_interval: int = 5, strict: bool = False,
                       max_charge_usd: float | None = None) -> list[dict]:
    """Start `actor_id` with `run_input`, poll until it finishes (or `timeout`
    seconds elapse), and return its dataset items as a list of raw dicts.

    strict=True re-raises any transport/actor failure instead of returning [].
    Use strict=True anywhere an empty result would otherwise be shown to a
    person as "this company has no posts here" -- [] must never conflate a
    scraper that couldn't run with a platform confirmed to have nothing.
    On strict=False, any failure is logged and swallowed to [] so the caller
    can mark that platform scrape_failed and move on to the next platform.
    """
    try:
        run_id = _start_run(actor_id, run_input, token, max_charge_usd)
        run = _poll_run(run_id, token, timeout, poll_interval)
        if run.get("status") != "SUCCEEDED":
            raise ApifyTransportError(
                "Apify actor %s run %s ended with status %s" % (actor_id, run_id, run.get("status")))
        dataset_id = run.get("defaultDatasetId")
        if not dataset_id:
            raise ApifyTransportError("Apify run %s succeeded with no defaultDatasetId" % run_id)
        return _fetch_dataset_items(dataset_id, token)
    except Exception as e:
        # Deliberately broad: a transport error, a malformed vendor response
        # (KeyError/ValueError), or anything else must all collapse to the
        # same "this scrape did not produce data" outcome -- never let an
        # unanticipated failure shape escape and take the whole platform
        # (or the whole run) down with it.
        logger.warning("apify_transport: run_actor_and_wait failed for actor %s: %s", actor_id, e)
        if strict:
            raise ApifyTransportError(str(e)) from e
        return []


TERMINAL = ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT")
DATASET_PAGE = 1000


def _get_run(run_id: str, token: str) -> dict:
    resp = requests.get(f"{_BASE_URL}/actor-runs/{run_id}", headers=_headers(token), timeout=30)
    resp.raise_for_status()
    return resp.json()["data"]


def abort_run(run_id: str, token: str) -> None:
    """Ask Apify to stop a run (it keeps what it has already produced and charged)."""
    try:
        requests.post(f"{_BASE_URL}/actor-runs/{run_id}/abort", headers=_headers(token), timeout=30)
    except Exception as e:  # best effort: the run's own timeout still ends it
        logger.warning("apify_transport: abort of run %s failed: %s", run_id, e)


def dataset_items(dataset_id: str, token: str) -> list[dict]:
    """Every item in a dataset, a page at a time (a big search returns thousands)."""
    out, offset = [], 0
    while True:
        resp = requests.get(f"{_BASE_URL}/datasets/{dataset_id}/items", headers=_headers(token),
                            params={"format": "json", "clean": "true", "offset": offset, "limit": DATASET_PAGE},
                            timeout=120)
        resp.raise_for_status()
        page = resp.json()
        page = page if isinstance(page, list) else []
        out.extend(page)
        if len(page) < DATASET_PAGE:
            return out
        offset += DATASET_PAGE


def run_actor(actor_id: str, run_input: dict, token: str, *, timeout: int, max_charge_usd: float | None = None,
              poll_interval: int = 5, on_poll=None, should_abort=None, resume_run_id: str | None = None,
              on_start=None) -> tuple[list[dict], dict]:
    """Run an Actor to the end and return (items, run).

    Unlike run_actor_and_wait this never throws away what a run produced: a run
    that timed out, was aborted, or hit maxTotalChargeUsd still returns its
    items (Apify has charged for them), with run["status"] saying how it ended.
    Apify is told the same `timeout`, so a run cannot outlive its caller.
    `on_poll(run)` is called on every poll (progress, heartbeats);
    `should_abort()` returning True aborts the run and keeps what it has.
    `resume_run_id` re-attaches to a run this caller started before it was
    interrupted (a redeploy), so the same work is never started and paid for
    twice; `on_start(run_id)` is told the id of a newly started run.
    Raises ApifyTransportError when the run cannot be started or read, or when
    it failed having produced nothing.
    """
    run = None
    if resume_run_id:
        try:
            run = _get_run(resume_run_id, token)
        except Exception as e:  # gone or unreadable: start afresh
            logger.warning("apify_transport: could not re-attach to run %s: %s", resume_run_id, e)
            run = None
    if run is None:
        try:
            url = f"{_BASE_URL}/acts/{_normalize_actor_id(actor_id)}/runs"
            params = {"timeout": int(timeout)}
            if max_charge_usd:
                params["maxTotalChargeUsd"] = "%.2f" % max_charge_usd
            resp = requests.post(url, json=run_input, headers=_headers(token), params=params, timeout=30)
            resp.raise_for_status()
            run = resp.json()["data"]
        except Exception as e:
            raise ApifyTransportError("could not start %s: %s" % (actor_id, e)) from e
        if on_start:
            on_start(run["id"])
    run_id = run["id"]
    deadline = time.monotonic() + timeout + 120
    misses = 0
    aborted = False
    while run.get("status") not in TERMINAL:
        time.sleep(poll_interval)
        if not aborted and ((should_abort and should_abort()) or time.monotonic() > deadline):
            abort_run(run_id, token)
            aborted = True
            deadline = time.monotonic() + 120          # give the abort time to land
        elif aborted and time.monotonic() > deadline:
            break
        try:
            run = _get_run(run_id, token)
            misses = 0
        except Exception as e:
            misses += 1
            if misses >= 6:
                raise ApifyTransportError("lost track of run %s: %s" % (run_id, e)) from e
            continue
        if on_poll:
            on_poll(run)
    items = []
    if run.get("defaultDatasetId"):
        try:
            items = dataset_items(run["defaultDatasetId"], token)
        except Exception as e:
            raise ApifyTransportError("could not read the results of run %s: %s" % (run_id, e)) from e
    if run.get("status") == "FAILED" and not items:
        raise ApifyTransportError("Apify run %s failed" % run_id)
    return items, run


def probe_token(token: str) -> tuple[dict | None, str | None]:
    """GET /v2/users/me: confirms `token` is valid without starting or
    paying for anything. Returns (account_info, None) on success, or
    (None, error_message) on any failure -- never raises, so a self-test
    route can call this directly and always get a renderable result."""
    if not token:
        return None, "No token given."
    try:
        resp = requests.get(f"{_BASE_URL}/users/me", headers=_headers(token), timeout=15)
    except requests.RequestException as e:
        return None, "Could not reach Apify: %s" % e
    if resp.status_code == 401:
        return None, "Apify rejected this token (401 Unauthorized)."
    try:
        resp.raise_for_status()
    except requests.HTTPError as e:
        return None, "Apify returned HTTP %s: %s" % (resp.status_code, str(e)[:200])
    return (resp.json().get("data") or {}), None


def account_limits(token: str) -> tuple[dict | None, str | None]:
    """GET /v2/users/me/limits: this month's usage and the plan's limit. Free."""
    try:
        resp = requests.get(f"{_BASE_URL}/users/me/limits", headers=_headers(token), timeout=15)
        resp.raise_for_status()
        return (resp.json().get("data") or {}), None
    except Exception as e:
        return None, "Could not read Apify usage: %s" % str(e)[:200]


def check_actor(actor_id: str, token: str) -> tuple[dict | None, str | None]:
    """GET /v2/acts/<actor_id>: confirms the actor exists and this token can
    see it. A metadata READ, never a run -- costs nothing and starts
    nothing, unlike run_actor_and_wait. Returns (actor_info, None) or
    (None, error_message)."""
    if not actor_id:
        return None, "No actor id given."
    try:
        resp = requests.get(f"{_BASE_URL}/acts/{_normalize_actor_id(actor_id)}",
                            headers=_headers(token), timeout=15)
    except requests.RequestException as e:
        return None, "Could not reach Apify: %s" % e
    if resp.status_code == 404:
        return None, "Actor %s not found or not accessible with this token." % actor_id
    if resp.status_code == 401:
        return None, "Apify rejected this token (401 Unauthorized)."
    try:
        resp.raise_for_status()
    except requests.HTTPError as e:
        return None, "Apify returned HTTP %s: %s" % (resp.status_code, str(e)[:200])
    return (resp.json().get("data") or {}), None
