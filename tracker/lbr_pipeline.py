"""Local Business Radar: running a whole search, and surviving interruptions.

A run is six stages. Each one's findings are merged into its businesses
(lbr_store.upsert_businesses) and its result saved (lbr_store.save_stage)
the moment it finishes, and every request it made is written to the run's
ledger. So when a deploy or a crash stops a run half way, restarting it
skips every finished stage and pays only for what is left.

    discover -> profile -> website -> reviews -> visibility -> score

Where the businesses come from is fixed in the plan (estimate["source"]):
Google's Places API with SerpAPI, or Apify's Google Maps Scraper, which
searches Google Maps itself and opens each researched business once in the
profile stage for its details and reviews (see lbr_apify_maps).

Who runs it. One worker thread per run, started by start(). A run whose
worker died (a deploy restarts the web process) is picked up again the next
time anyone asks for its status: ensure_running() restarts it when its
heartbeat is older than STALE_AFTER. On Postgres a session advisory lock on
the run id guarantees one worker per run across every web process; in
memory a process-local set does the same.

Cancelling sets a flag on the run; every stage checks it between units of
work and stops early, keeping what it has.

The ceiling. lbr_intake.estimate() is the most the run may spend. Discovery
cannot exceed its request budget and each later stage is bounded by the cap,
so the ceiling holds by construction; the pipeline also checks the recorded
spend after each stage and stops the run if it has somehow gone past it.
"""

import logging
import threading
import time
from datetime import datetime, timedelta, timezone

from tracker import (lbr_config, lbr_discover, lbr_http, lbr_profile, lbr_reviews, lbr_score,
                     lbr_store, lbr_visibility, lbr_website)

log = logging.getLogger(__name__)

STAGES = ["discover", "profile", "website", "reviews", "visibility", "score"]
STAGE_LABELS = {"discover": "Finding every business", "profile": "Auditing Google profiles",
                "website": "Checking websites", "reviews": "Reading reviews",
                "visibility": "Checking map rank and ads", "score": "Scoring and writing pitches"}
STALE_AFTER = timedelta(minutes=3)
CEILING_SLACK = 1.10

_LOCAL = set()
_LOCAL_LOCK = threading.Lock()


class Stopped(Exception):
    pass


def _now():
    return datetime.now(timezone.utc)


# ── One worker per run ───────────────────────────────────────────────────────
class _RunLock:
    """Held for the life of a worker. Postgres: a session advisory lock."""

    def __init__(self, run_id):
        self.run_id = run_id
        self.conn = None

    def acquire(self):
        with _LOCAL_LOCK:
            if self.run_id in _LOCAL:
                return False
            _LOCAL.add(self.run_id)
        if lbr_store.backend() == "postgres":
            try:
                import os
                import psycopg2
                self.conn = psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=8)
                self.conn.autocommit = True
                with self.conn.cursor() as cur:
                    cur.execute("SELECT pg_try_advisory_lock(%s, %s)", (74726, self.run_id))
                    if not cur.fetchone()[0]:
                        self.release()
                        return False
            except Exception:
                log.exception("lbr: could not take the run lock for %s", self.run_id)
                self.release()
                return False
        return True

    def release(self):
        if self.conn is not None:
            try:
                self.conn.close()      # closing the session releases the advisory lock
            except Exception:
                pass
            self.conn = None
        with _LOCAL_LOCK:
            _LOCAL.discard(self.run_id)


# ── Starting, stopping, resuming ─────────────────────────────────────────────
def start(email, plan):
    """Create a run for a resolved plan and start it. Returns the run id."""
    run_id = lbr_store.create_run(email, plan["business"]["input"], plan["area"]["input"],
                                  plan["focus"], plan["cap"])
    lbr_store.update_run(run_id, plan=plan, progress={"stage": None, "cancel": False},
                         heartbeat_at=_now())
    _spawn(run_id)
    return run_id


def _spawn(run_id):
    t = threading.Thread(target=_work, args=(run_id,), name="lbr-run-%s" % run_id, daemon=True)
    t.start()
    return t


def cancel(run_id, email):
    run = lbr_store.get_run(run_id, email)
    if not run or run["status"] not in ("queued", "running"):
        return False
    lbr_store.merge_run(run_id, "progress", {"cancel": True})
    return True


def ensure_running(run):
    """Restart a run whose worker has gone quiet (a deploy, a crash). True if restarted."""
    if run["status"] not in ("queued", "running"):
        return False
    hb = run.get("heartbeat_at")
    try:
        last = datetime.fromisoformat(hb) if isinstance(hb, str) else hb
    except ValueError:
        last = None
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    if last is not None and _now() - last < STALE_AFTER:
        return False
    with _LOCAL_LOCK:
        if run["id"] in _LOCAL:
            return False
    _spawn(run["id"])
    return True


# ── The worker ───────────────────────────────────────────────────────────────
def _work(run_id):
    lock = _RunLock(run_id)
    if not lock.acquire():
        return
    ledger = lbr_http.Ledger()
    try:
        _execute(run_id, ledger)
    except Stopped:
        _flush(run_id, ledger)
        lbr_store.update_run(run_id, status="cancelled", finished_at=_now(),
                             cost=lbr_http.summarise(lbr_store.get_calls(run_id)))
    except Exception as exc:
        log.exception("lbr run %s failed", run_id)
        _flush(run_id, ledger)
        msg = str(exc) if isinstance(exc, lbr_http.ToolError) else "%s: %s" % (type(exc).__name__, exc)
        lbr_store.update_run(run_id, status="failed", error=lbr_http.redact(msg)[:500], finished_at=_now(),
                             cost=lbr_http.summarise(lbr_store.get_calls(run_id)))
    finally:
        lock.release()


def _flush(run_id, ledger):
    lbr_store.add_calls(run_id, ledger.drain())


def _execute(run_id, ledger):
    run = lbr_store.get_run(run_id)
    plan = run["plan"]
    missing = lbr_config.missing_required()
    if missing:
        raise lbr_http.ToolError("config", "Not configured: %s." % ", ".join(missing))
    lbr_store.update_run(run_id, status="running", heartbeat_at=_now())
    state = {"checked": 0.0, "cancel": False}

    def should_stop():
        # Read the cancel flag at most every 3 seconds.
        now = time.time()
        if now - state["checked"] > 3:
            state["checked"] = now
            r = lbr_store.get_run(run_id)
            state["cancel"] = bool(((r or {}).get("progress") or {}).get("cancel"))
            lbr_store.heartbeat(run_id)
        return state["cancel"]

    def progress(p):
        lbr_store.merge_run(run_id, "progress", {"detail": p})
        lbr_store.heartbeat(run_id)

    ceiling = float(plan["estimate"]["usd_max"]) * CEILING_SLACK
    for stage in STAGES:
        if lbr_store.get_stage(run_id, stage) is not None:
            continue
        if should_stop():
            raise Stopped()
        lbr_store.update_run(run_id, stage=stage, heartbeat_at=_now())
        lbr_store.merge_run(run_id, "progress", {"stage": stage, "detail": {},
                                                 "stage_started": _now().isoformat()})
        result = STAGE_FUNCS[stage](run_id, plan, ledger, progress, should_stop)
        _flush(run_id, ledger)
        lbr_store.save_stage(run_id, stage, result)
        spent = lbr_http.summarise(lbr_store.get_calls(run_id))
        lbr_store.update_run(run_id, cost=spent, heartbeat_at=_now())
        if should_stop():
            raise Stopped()
        if spent["usd"] > ceiling:
            raise lbr_http.ToolError("budget", "Stopped at the cost ceiling ($%.2f of $%.2f)." % (
                spent["usd"], plan["estimate"]["usd_max"]))
    summary = summarise(run_id, plan)
    lbr_store.update_run(run_id, status="complete", stage="done", summary=summary, finished_at=_now(),
                         cost=lbr_http.summarise(lbr_store.get_calls(run_id)))


# ── The stages ───────────────────────────────────────────────────────────────
class ApifyRuns:
    """Which Apify runs this search started, kept with the run.

    A redeploy stops the worker mid-stage; when the run resumes, a stage that
    had started an Apify run re-attaches to it instead of starting (and paying
    for) the same search again. Flat keys, because the store merges one level.
    """

    def __init__(self, run_id):
        self.run_id = run_id

    def get(self, key):
        run = lbr_store.get_run(self.run_id) or {}
        return (run.get("progress") or {}).get("apify_run:" + key)

    def put(self, key, apify_run_id):
        lbr_store.merge_run(self.run_id, "progress", {"apify_run:" + key: apify_run_id})


def _profiles(run_id):
    return {b["place_id"]: b["data"]["profile"] for b in lbr_store.get_businesses(run_id)
            if "profile" in b["data"]}


def _selected(run_id):
    return (lbr_store.get_stage(run_id, "discover") or {}).get("selected") or []


def _stage_discover(run_id, plan, ledger, progress, should_stop):
    out = lbr_discover.discover(plan, ledger, on_progress=progress, should_stop=should_stop,
                                memo=ApifyRuns(run_id))
    selected = set(out["selected"])
    rows = []
    for pid, prof in out["profiles"].items():
        disc = {k: prof.pop(k) for k in ("chain", "chain_reason", "locations", "triage", "set_aside") if k in prof}
        prof.pop("triage_by", None)
        prof["locations"] = disc.get("locations", 1)
        disc["selected"] = pid in selected
        rows.append({"place_id": pid, "data": {"profile": prof, "discovery": disc}})
    lbr_store.upsert_businesses(run_id, rows)
    return {"selected": out["selected"], "stats": out["stats"],
            "market": lbr_visibility.market(out["profiles"])}


def _merge_stage(run_id, key, results):
    lbr_store.upsert_businesses(run_id, [{"place_id": pid, "data": {key: res}} for pid, res in results.items()])


def _apify_mode(plan):
    return (plan.get("estimate") or {}).get("source") == "apify"


def _stage_profile(run_id, plan, ledger, progress, should_stop):
    selected, profiles = _selected(run_id), _profiles(run_id)
    if not _apify_mode(plan):
        res = lbr_profile.run(selected, profiles, ledger, should_stop=should_stop)
        _merge_stage(run_id, "gbp", res)
        return {"audited": len(res)}
    # Apify: open each business once, for its profile details and its newest reviews.
    from tracker import lbr_apify_maps
    progress({"stage": "profile", "done": 0, "of": len(selected), "note": "Apify is opening each business"})
    opened = lbr_apify_maps.details(selected, ledger, should_stop=should_stop, on_progress=progress,
                                    memo=ApifyRuns(run_id))
    rows = []
    for pid, o in opened.items():
        prof = dict(profiles.get(pid) or {})
        fresh = o.get("profile") or {}
        # The detail page adds hours and a firm review count; keep discovery's values otherwise.
        for k, v in fresh.items():
            if v not in (None, "", []) or k == "hours":
                prof[k] = v
        prof["locations"] = (profiles.get(pid) or {}).get("locations", 1)
        profiles[pid] = prof
        rows.append({"place_id": pid, "data": {"profile": prof,
                                               "reviews_raw": {"reviews": o["reviews"], "topics": o["topics"]}}})
    lbr_store.upsert_businesses(run_id, rows)
    res = lbr_profile.run(selected, profiles, ledger, should_stop=should_stop, opened=opened)
    _merge_stage(run_id, "gbp", res)
    return {"audited": len(res), "opened": len(opened)}


def _stage_website(run_id, plan, ledger, progress, should_stop):
    res = lbr_website.run(_selected(run_id), _profiles(run_id), ledger, on_progress=progress,
                          should_stop=should_stop)
    _merge_stage(run_id, "website", res)
    return {"checked": len(res)}


def _stage_reviews(run_id, plan, ledger, progress, should_stop):
    prefetched = None
    if _apify_mode(plan):
        prefetched = {b["place_id"]: b["data"]["reviews_raw"] for b in lbr_store.get_businesses(run_id)
                      if b["data"].get("reviews_raw") is not None}
    res = lbr_reviews.run(_selected(run_id), _profiles(run_id), ledger, on_progress=progress,
                          should_stop=should_stop, prefetched=prefetched)
    _merge_stage(run_id, "reviews", res)
    return {"read": len(res)}


def _stage_visibility(run_id, plan, ledger, progress, should_stop):
    businesses = {b["place_id"]: b["data"] for b in lbr_store.get_businesses(run_id)}
    websites = {pid: d.get("website") for pid, d in businesses.items() if d.get("website")}
    out = lbr_visibility.run(_selected(run_id), _profiles(run_id), plan, ledger, websites=websites,
                             on_progress=progress, should_stop=should_stop, memo=ApifyRuns(run_id))
    _merge_stage(run_id, "visibility", out["businesses"])
    return {"market": out["market"], "searches": out["searches"], "ad_checks": out["ad_checks"]}


def _stage_score(run_id, plan, ledger, progress, should_stop):
    businesses = {b["place_id"]: b["data"] for b in lbr_store.get_businesses(run_id)}
    profiles = {pid: d["profile"] for pid, d in businesses.items() if "profile" in d}
    findings = {pid: {"profile": d.get("gbp"), "website": d.get("website"), "reviews": d.get("reviews"),
                      "visibility": d.get("visibility")} for pid, d in businesses.items()}
    market = (lbr_store.get_stage(run_id, "discover") or {}).get("market") or {}
    out = lbr_score.run(_selected(run_id), profiles, findings, plan, market, ledger, should_stop=should_stop)
    lbr_store.upsert_businesses(run_id, [
        {"place_id": pid, "rank": e["rank"],
         "data": {"score": e["score"], "facts": e["facts"], "pitch": e.get("pitch")}}
        for pid, e in out.items()])
    return {"scored": len(out)}


STAGE_FUNCS = {"discover": _stage_discover, "profile": _stage_profile, "website": _stage_website,
               "reviews": _stage_reviews, "visibility": _stage_visibility, "score": _stage_score}


# ── The headline numbers ─────────────────────────────────────────────────────
def summarise(run_id, plan):
    """What the report opens with."""
    rows = [b["data"] for b in lbr_store.get_businesses(run_id)]
    disc = lbr_store.get_stage(run_id, "discover") or {}
    researched = [d for d in rows if (d.get("discovery") or {}).get("selected")]
    tiers = {"A": 0, "B": 0, "C": 0}
    top = {k: 0 for k in lbr_score.SERVICES}
    for d in researched:
        sc = d.get("score") or {}
        if sc.get("tier") in tiers:
            tiers[sc["tier"]] += 1
        if sc.get("top_service") in top:
            top[sc["top_service"]] += 1
    web_kinds = {}
    for d in researched:
        k = (d.get("website") or {}).get("kind")
        if k:
            web_kinds[k] = web_kinds.get(k, 0) + 1
    needs_site = sum(v for k, v in web_kinds.items() if k not in ("ok", "blocked"))
    unclaimed = sum(1 for d in researched if (d.get("gbp") or {}).get("claimed") is False)
    no_ads = sum(1 for d in researched
                 if (d.get("website") or {}).get("kind") == "ok"
                 and (d.get("visibility") or {}).get("ads") is not None
                 and not ((d.get("visibility") or {}).get("ads") or {}).get("active"))
    unanswered = sum(((d.get("reviews") or {}).get("stats") or {}).get("unanswered_negative", 0) for d in researched)
    not_in_pack = sum(1 for d in researched if (d.get("visibility") or {}).get("in_pack") is False)
    return {"found": disc.get("stats", {}).get("found", 0), "stats": disc.get("stats", {}),
            "researched": len(researched), "tiers": tiers, "top_services": top, "website_kinds": web_kinds,
            "needs_site": needs_site, "unclaimed": unclaimed, "no_ads": no_ads,
            "unanswered_negative": unanswered, "not_in_pack": not_in_pack,
            "market": disc.get("market", {}), "compliance": lbr_reviews.COMPLIANCE,
            "unchecked_tools": [t["name"] for t in lbr_config.readiness() if not t["configured"]
                                and not (_apify_mode(plan) and t["key"] == "places")],
            "source": "apify" if _apify_mode(plan) else "places",
            "attribution": (plan.get("area") or {}).get("attribution") or ""}
