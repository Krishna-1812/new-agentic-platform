"""Local Business Radar, phase 1: tool readiness, prices, the HTTP client and
its cost ledger, and the store (both backends).

The store tests run against the in-process backend always, and against
Postgres too when LBR_TEST_DATABASE_URL (or, in the Postgres CI job,
DATABASE_URL) points at a disposable database.
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tracker import lbr_config, lbr_http, lbr_store  # noqa: E402
from lbr_fakes import FakeResponse, FakeSession  # noqa: E402

TOOL_VARS = ["GOOGLE_MAPS_API_KEY", "SERPAPI_KEY", "ANTHROPIC_API_KEY", "PAGESPEED_API_KEY",
             "APIFY_API_TOKEN", "HUNTER_API_KEY", "LBR_PRICES_JSON"]


@pytest.fixture
def clean_env(monkeypatch):
    for v in TOOL_VARS:
        monkeypatch.delenv(v, raising=False)
    return monkeypatch


# ── Readiness ────────────────────────────────────────────────────────────────

def test_nothing_set_means_three_required_tools_missing(clean_env):
    assert lbr_config.missing_required() == ["Google Places API (New)", "SerpAPI", "Claude (Anthropic)"]
    assert not lbr_config.ready()
    rows = {r["key"]: r for r in lbr_config.readiness()}
    assert not any(r["configured"] for r in rows.values())
    assert rows["pagespeed"]["required"] is False and rows["apify"]["required"] is False


def test_the_three_required_keys_make_it_ready(clean_env):
    for v in ("GOOGLE_MAPS_API_KEY", "SERPAPI_KEY", "ANTHROPIC_API_KEY"):
        clean_env.setenv(v, "k-" + v)
    assert lbr_config.ready()


def test_pagespeed_falls_back_to_the_maps_key_and_says_which_it_used(clean_env):
    clean_env.setenv("GOOGLE_MAPS_API_KEY", "maps")
    assert lbr_config.key_for("pagespeed") == "maps"
    assert lbr_config.env_used("pagespeed") == "GOOGLE_MAPS_API_KEY"
    clean_env.setenv("PAGESPEED_API_KEY", "psi")
    assert lbr_config.key_for("pagespeed") == "psi"


def test_readiness_never_contains_a_key_value(clean_env):
    clean_env.setenv("SERPAPI_KEY", "super-secret-value")
    assert "super-secret-value" not in json.dumps(lbr_config.readiness())


# ── Prices ───────────────────────────────────────────────────────────────────

def test_every_price_names_its_source_and_when_it_was_read():
    for op, p in lbr_config.PRICES.items():
        assert p["source"].startswith("https://"), op
        assert p["checked"], op
        assert p["usd"] is None or p["usd"] >= 0, op


def test_a_price_can_be_overridden_for_your_own_plan(clean_env):
    assert lbr_config.price("serpapi.search") == 0.015
    clean_env.setenv("LBR_PRICES_JSON", json.dumps({"serpapi.search": 0.01}))
    assert lbr_config.price("serpapi.search") == 0.01
    clean_env.setenv("LBR_PRICES_JSON", "{not json")
    assert lbr_config.price("serpapi.search") == 0.015


def test_claude_is_priced_from_its_tokens():
    assert lbr_config.claude_usd("claude-sonnet-5", 1_000_000, 100_000) == pytest.approx(3.0)
    assert lbr_config.claude_usd("some-unknown-model", 10, 10) is None


# ── The HTTP client ──────────────────────────────────────────────────────────

@pytest.fixture
def fake(monkeypatch):
    s = FakeSession()
    monkeypatch.setattr(lbr_http, "_SESSION", s)
    monkeypatch.setattr(lbr_http.time, "sleep", lambda s: None)
    return s


def test_a_success_is_priced_into_the_ledger(fake, clean_env):
    fake.on("places.googleapis.com", FakeResponse(200, {"places": []}))
    ledger = lbr_http.Ledger()
    out = lbr_http.call(ledger, "places", "text_search", "POST",
                        "https://places.googleapis.com/v1/places:searchText",
                        json_body={"textQuery": "dentist"}, price_op="places.text_search_pro")
    assert out == {"places": []}
    t = ledger.totals()
    assert t["calls"] == 1 and t["usd"] == pytest.approx(0.032)
    assert t["by_provider"]["places"]["calls"] == 1


def test_a_rate_limit_is_retried_then_succeeds(fake, clean_env):
    fake.on("serpapi.com", [FakeResponse(429, {"error": "slow down"}, {"Retry-After": "1"}),
                            FakeResponse(200, {"reviews": []})])
    ledger = lbr_http.Ledger()
    assert lbr_http.call(ledger, "serpapi", "reviews", "GET", "https://serpapi.com/search",
                         price_op="serpapi.search") == {"reviews": []}
    assert len(fake.requests) == 2
    assert ledger.totals()["calls"] == 1, "a retried request is billed once"


def test_a_refused_key_is_not_retried_and_says_what_to_check(fake, clean_env):
    fake.on("places.googleapis.com", FakeResponse(403, {"error": {"message": "API key not valid"}}))
    ledger = lbr_http.Ledger()
    with pytest.raises(lbr_http.ToolError) as e:
        lbr_http.call(ledger, "places", "details", "GET", "https://places.googleapis.com/v1/places/x",
                      price_op="places.details_enterprise")
    assert len(fake.requests) == 1
    assert e.value.status == 403 and "refused the key" in str(e.value)
    assert ledger.totals()["usd"] == 0, "a failed request is not billed"


def test_no_error_ever_carries_a_key(fake, clean_env):
    fake.on("serpapi.com", FakeResponse(200, {"error": "Invalid API key. api_key=abc123secret"}))
    ledger = lbr_http.Ledger()
    with pytest.raises(lbr_http.ToolError) as e:
        lbr_http.call(ledger, "serpapi", "reviews", "GET", "https://serpapi.com/search",
                      params={"api_key": "abc123secret"})
    assert "abc123secret" not in str(e.value)
    assert "abc123secret" not in json.dumps(ledger.entries)


def test_serpapi_no_results_is_an_empty_answer_not_a_failure(fake, clean_env):
    fake.on("serpapi.com", FakeResponse(200, {"error": "Google hasn't returned any results for this query."}))
    ledger = lbr_http.Ledger()
    assert lbr_http.call(ledger, "serpapi", "maps", "GET", "https://serpapi.com/search") == {}


def test_a_dropped_connection_is_retried_then_reported(fake, clean_env):
    import requests

    def boom(*a):
        raise requests.ConnectionError("reset")
    fake.on("pagespeedonline", boom)
    ledger = lbr_http.Ledger()
    with pytest.raises(lbr_http.ToolError) as e:
        lbr_http.call(ledger, "pagespeed", "run", "GET",
                      "https://www.googleapis.com/pagespeedonline/v5/runPagespeed", retries=2)
    assert len(fake.requests) == 3 and e.value.retryable


def test_the_ledger_counts_unpriced_calls_separately():
    ledger = lbr_http.Ledger()
    ledger.add("hunter", "domain_search", usd=None)
    ledger.add("serpapi", "reviews", usd=0.015)
    t = ledger.totals()
    assert t["usd"] == 0.015 and t["unpriced"] == 1
    assert ledger.drain() and ledger.totals()["calls"] == 0


# ── The store, on both backends ──────────────────────────────────────────────

PG_URL = os.environ.get("LBR_TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")


@pytest.fixture(params=["memory"] + (["postgres"] if PG_URL else []))
def store(request, monkeypatch):
    if request.param == "memory":
        monkeypatch.delenv("DATABASE_URL", raising=False)
        lbr_store.reset_memory()
    else:
        monkeypatch.setenv("DATABASE_URL", PG_URL)
        monkeypatch.setattr(lbr_store, "_TABLES_READY", False)
        with lbr_store._pg() as conn:
            with conn.cursor() as cur:
                cur.execute("DROP TABLE IF EXISTS lbr_calls, lbr_businesses, lbr_stages, lbr_runs CASCADE")
    return lbr_store


def test_a_run_is_created_and_only_its_owner_can_read_it(store):
    rid = store.create_run("Priya@MarkifyDigital.com", "dentist", "Austin, TX", "all", 200)
    run = store.get_run(rid, "priya@markifydigital.com")
    assert run["status"] == "queued" and run["business_type"] == "dentist" and run["cap"] == 200
    assert store.get_run(rid, "someone@else.com") is None
    assert store.get_run(rid)["id"] == rid
    assert [r["id"] for r in store.list_runs("priya@markifydigital.com")] == [rid]
    assert store.list_runs("someone@else.com") == []


def test_run_fields_update_and_json_fields_merge(store):
    rid = store.create_run("a@b.com", "hvac", "Texas", "seo", 50)
    store.update_run(rid, status="running", stage="discover", progress={"found": 3})
    store.merge_run(rid, "progress", {"audited": 1})
    run = store.get_run(rid, "a@b.com")
    assert run["status"] == "running" and run["stage"] == "discover"
    assert run["progress"] == {"found": 3, "audited": 1}
    with pytest.raises(ValueError):
        store.update_run(rid, email="x@y.com")
    with pytest.raises(ValueError):
        store.update_run(rid, status="exploded")


def test_a_finished_stage_is_kept_for_a_resume(store):
    rid = store.create_run("a@b.com", "hvac", "Texas", "all", 50)
    assert store.get_stage(rid, "discover") is None
    store.save_stage(rid, "discover", {"place_ids": ["p1", "p2"]})
    store.save_stage(rid, "discover", {"place_ids": ["p1", "p2", "p3"]})
    assert store.get_stage(rid, "discover") == {"place_ids": ["p1", "p2", "p3"]}


def test_each_stage_adds_its_findings_without_erasing_another_stages(store):
    rid = store.create_run("a@b.com", "dentist", "Austin, TX", "all", 50)
    store.upsert_businesses(rid, [{"place_id": "p1", "data": {"profile": {"name": "Smile"}}, "rank": 2},
                                  {"place_id": "p2", "data": {"profile": {"name": "Bright"}}, "rank": 1}])
    store.upsert_businesses(rid, [{"place_id": "p1", "data": {"website": {"kind": "none"}}}])
    rows = store.get_businesses(rid, "a@b.com")
    assert [b["place_id"] for b in rows] == ["p2", "p1"], "best rank first"
    p1 = next(b for b in rows if b["place_id"] == "p1")
    assert p1["data"] == {"profile": {"name": "Smile"}, "website": {"kind": "none"}}
    assert p1["rank"] == 2, "a merge without a rank keeps the old one"
    assert store.get_businesses(rid, "intruder@x.com") == []


def test_spend_is_recorded_per_call(store):
    rid = store.create_run("a@b.com", "dentist", "Austin, TX", "all", 50)
    ledger = lbr_http.Ledger()
    ledger.add("places", "text_search", usd=0.032)
    ledger.add("serpapi", "reviews", usd=0.015, ok=False, status=500)
    store.add_calls(rid, ledger.drain())
    calls = store.get_calls(rid)
    assert [c["provider"] for c in calls] == ["places", "serpapi"]
    assert lbr_http.summarise(calls)["usd"] == pytest.approx(0.047)


def test_old_runs_keep_only_place_ids_and_scores(store):
    rid = store.create_run("a@b.com", "dentist", "Austin, TX", "all", 50)
    store.update_run(rid, status="complete", plan={"area": {"viewport": [1, 2]}, "types": ["dentist"]},
                     finished_at=datetime.now(timezone.utc) - timedelta(days=45))
    store.save_stage(rid, "discover", {"place_ids": ["p1"]})
    store.upsert_businesses(rid, [{"place_id": "p1", "data": {"profile": {"name": "Smile"},
                                                              "score": {"total": 81}}}])
    fresh = store.create_run("a@b.com", "dentist", "Austin, TX", "all", 50)
    store.update_run(fresh, status="complete", finished_at=datetime.now(timezone.utc))
    store.upsert_businesses(fresh, [{"place_id": "p9", "data": {"profile": {"name": "Keep"}}}])

    assert store.purge_expired(30) == 1
    old = store.get_businesses(rid, "a@b.com")[0]
    assert old["place_id"] == "p1" and old["data"] == {"score": {"total": 81}}
    assert store.get_stage(rid, "discover") is None
    run = store.get_run(rid, "a@b.com")
    assert run["purged_at"] and run["plan"] == {"types": ["dentist"]}
    assert store.get_businesses(fresh, "a@b.com")[0]["data"]["profile"]["name"] == "Keep"
    assert store.purge_expired(30) == 0, "a purged run is not purged twice"


# ── The route ────────────────────────────────────────────────────────────────

def test_the_readiness_route_is_staff_only_and_lists_every_tool(clean_env):
    import app as appmod
    c = appmod.app.test_client()
    with c.session_transaction() as s:
        s["google_user"] = {"email": "dana@acmehealth.com", "name": "D"}
    assert c.get("/strategic-agents/local-business-radar/readiness").status_code in (302, 403)
    with c.session_transaction() as s:
        s["google_user"] = {"email": "priya@markifydigital.com", "name": "P"}
    d = c.get("/strategic-agents/local-business-radar/readiness").get_json()
    assert d["ready"] is False and len(d["tools"]) == len(lbr_config.TOOLS)
    assert "SerpAPI" in d["missing"]
