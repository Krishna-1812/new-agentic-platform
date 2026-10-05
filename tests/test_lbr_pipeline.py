"""Local Business Radar, phase 9: a whole run, end to end, against fakes of
Google Places, SerpAPI and the businesses' own websites; resuming after an
interruption; cancelling; and the routes and page that drive it."""

import os
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tracker import lbr_http, lbr_intake, lbr_pipeline, lbr_store, lbr_website  # noqa: E402
from lbr_fakes import FakeResponse, FakeSession  # noqa: E402
import test_lbr_discover as disc  # noqa: E402
import test_lbr_intake as intake  # noqa: E402

SITE = """<html><head><title>Bright Dental</title><meta name="viewport" content="width=device-width">
<meta name="description" content="Dentist"></head><body><h1>Bright</h1><a href="tel:1">Call</a>
<form><textarea></textarea></form><footer>&copy; 2026</footer></body></html>"""


def world():
    """Six dentists: two with no real website, one chain."""
    bs = [disc._biz(1, 30.27, -97.74, name="Bright Dental", website="https://bright.example", rating=4.8, reviews=210),
          disc._biz(2, 30.28, -97.75, name="Oak Family Dental", website="https://facebook.com/oak", rating=4.0, reviews=22),
          disc._biz(3, 30.29, -97.73, name="Cedar Smiles", website="", rating=3.6, reviews=9),
          disc._biz(4, 30.30, -97.72, name="Aspen Dental - North", website="https://aspendental.com/n"),
          disc._biz(5, 30.31, -97.71, name="River Dentistry", website="https://river.example", rating=4.4, reviews=60),
          disc._biz(6, 30.32, -97.70, name="Hill Country Dental", website="https://joes-dental.business.site",
                    rating=4.2, reviews=35)]
    places = disc.fake_places(bs)

    def places_route(method, url, params, body):
        if "locationRestriction" not in body:
            return FakeResponse(200, {"places": [intake.AUSTIN]})
        return places(method, url, params, body)

    def serp_route(method, url, params, body):
        eng = params.get("engine")
        if eng == "google_maps_reviews":
            return FakeResponse(200, {"reviews": [
                {"rating": 1, "iso_date": "2026-09-01T10:00:00Z", "snippet": "Waited an hour."},
                {"rating": 5, "iso_date": "2026-08-20T10:00:00Z", "snippet": "Lovely staff.",
                 "response": {"iso_date": "2026-08-21T10:00:00Z", "snippet": "Thank you!"}}]})
        if eng == "google_maps":
            return FakeResponse(200, {"local_results": [{"position": 1, "place_id": "p0001", "title": "Bright"},
                                                         {"position": 2, "place_id": "p0099", "title": "Other"}]})
        if eng == "google_ads_transparency_center":
            return FakeResponse(200, {"search_information": {"total_results": 0}})
        raise AssertionError(params)

    s = FakeSession()
    s.on("places:searchText", places_route).on("serpapi.com", serp_route)
    s.on("pagespeedonline", FakeResponse(200, {"lighthouseResult": {
        "categories": {"performance": {"score": 0.62}, "seo": {"score": 0.9}}, "audits": {}}}))
    s.on("bright.example", FakeResponse(200, text=SITE))
    s.on("river.example", FakeResponse(200, text="<html><body>River</body></html>"))
    return s


@pytest.fixture
def env(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    for v in ("APIFY_API_TOKEN", "PAGESPEED_API_KEY", "HUNTER_API_KEY", "LBR_PRICES_JSON", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "maps")
    monkeypatch.setenv("SERPAPI_KEY", "serp")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "claude")
    lbr_store.reset_memory()
    lbr_intake._PLAN_CACHE.clear()
    s = world()
    monkeypatch.setattr(lbr_http, "_SESSION", s)
    monkeypatch.setattr(lbr_http.time, "sleep", lambda x: None)
    monkeypatch.setattr(lbr_website, "_resolve", lambda h: {"93.184.216.34"})
    # Claude is "configured" but every call fails: pitches fall back to the assembled ones.
    from tracker import lbr_claude

    def no_claude(*a, **k):
        raise lbr_claude.ClaudeError("offline in tests")
    monkeypatch.setattr(lbr_claude, "ask_json", no_claude)
    # Run workers inline so the test sees the finished run.
    monkeypatch.setattr(lbr_pipeline, "_spawn", lambda rid: lbr_pipeline._work(rid))
    return s


def _plan(cap=10):
    return lbr_intake.plan("dentist", "Austin, TX", "all", cap)


def test_a_whole_run_finds_audits_scores_and_pitches(env):
    rid = lbr_pipeline.start("p@markifydigital.com", _plan())
    run = lbr_store.get_run(rid, "p@markifydigital.com")
    assert run["status"] == "complete", run["error"]
    s = run["summary"]
    assert s["found"] == 6 and s["researched"] == 5 and s["stats"]["chains"] == 1
    assert s["needs_site"] == 3, "Facebook only, no website, and a dead business.site link"
    assert sum(s["tiers"].values()) == 5
    rows = {b["place_id"]: b for b in lbr_store.get_businesses(rid, "p@markifydigital.com")}
    chain = rows["p0004"]["data"]
    assert chain["discovery"]["chain"] and "score" not in chain, "a chain is found but never researched"
    cedar = rows["p0003"]["data"]
    assert cedar["website"]["kind"] == "none" and cedar["score"]["top_service"] == "website"
    assert cedar["pitch"]["source"] == "assembled" and cedar["facts"]
    bright = rows["p0001"]["data"]
    assert bright["visibility"]["rank"] == 1 and bright["website"]["kind"] == "ok"
    assert bright["reviews"]["stats"]["unanswered_negative"] == 1
    ranks = sorted(b["rank"] for b in rows.values() if b["rank"] is not None)
    assert ranks == [1, 2, 3, 4, 5]
    # Every request was recorded and priced.
    calls = lbr_store.get_calls(rid)
    assert {c["provider"] for c in calls} >= {"places", "serpapi"}
    assert run["cost"]["usd"] == pytest.approx(lbr_http.summarise(calls)["usd"])
    assert run["cost"]["usd"] <= run["plan"]["estimate"]["usd_max"]


def test_an_interrupted_run_resumes_without_paying_for_finished_stages(env, monkeypatch):
    real = lbr_pipeline.STAGE_FUNCS["reviews"]
    monkeypatch.setitem(lbr_pipeline.STAGE_FUNCS, "reviews", lambda *a: (_ for _ in ()).throw(RuntimeError("deploy")))
    rid = lbr_pipeline.start("p@markifydigital.com", _plan())
    run = lbr_store.get_run(rid)
    assert run["status"] == "failed" and run["stage"] == "reviews"
    places_before = sum(1 for c in lbr_store.get_calls(rid) if c["provider"] == "places")
    monkeypatch.setitem(lbr_pipeline.STAGE_FUNCS, "reviews", real)
    lbr_store.update_run(rid, status="running", error=None)
    lbr_pipeline._work(rid)
    run = lbr_store.get_run(rid)
    assert run["status"] == "complete"
    assert sum(1 for c in lbr_store.get_calls(rid) if c["provider"] == "places") == places_before, \
        "discovery was not paid for twice"


def test_a_quiet_run_is_restarted_when_its_status_is_asked(env, monkeypatch):
    started = []
    monkeypatch.setattr(lbr_pipeline, "_spawn", lambda rid: started.append(rid))
    rid = lbr_store.create_run("p@markifydigital.com", "dentist", "Austin", "all", 10)
    lbr_store.update_run(rid, status="running")
    assert lbr_pipeline.ensure_running(lbr_store.get_run(rid)) is True and started == [rid]
    lbr_store.heartbeat(rid)
    assert lbr_pipeline.ensure_running(lbr_store.get_run(rid)) is False, "a fresh heartbeat means a live worker"


def test_a_cancelled_run_stops_and_keeps_what_it_has(env, monkeypatch):
    def cancel_during_profile(run_id, *a):
        lbr_store.merge_run(run_id, "progress", {"cancel": True})
        return {"audited": 0}
    monkeypatch.setitem(lbr_pipeline.STAGE_FUNCS, "profile", cancel_during_profile)
    clock = iter(range(10 ** 9, 10 ** 10, 10))       # every read is 10 s later: the flag is re-read
    monkeypatch.setattr(lbr_pipeline.time, "time", lambda: next(clock))
    rid = lbr_pipeline.start("p@markifydigital.com", _plan())
    run = lbr_store.get_run(rid)
    assert run["status"] == "cancelled" and len(lbr_store.get_businesses(rid)) == 6


def test_a_run_without_the_required_keys_fails_before_spending(env, monkeypatch):
    plan = _plan()
    monkeypatch.delenv("SERPAPI_KEY")
    rid = lbr_pipeline.start("p@markifydigital.com", plan)
    run = lbr_store.get_run(rid)
    assert run["status"] == "failed" and "SerpAPI" in run["error"]
    assert [c for c in lbr_store.get_calls(rid)] == []


# ── Routes and page ──────────────────────────────────────────────────────────

def _client(email="p@markifydigital.com"):
    import app as appmod
    c = appmod.app.test_client()
    with c.session_transaction() as s:
        s["google_user"] = {"email": email, "name": "P"}
    return c


def test_the_page_lists_the_tools_and_the_history(env):
    rid = lbr_pipeline.start("p@markifydigital.com", _plan())
    body = _client().get("/strategic-agents/local-business-radar").get_data(as_text=True)
    assert "Every local business," in body and 'data-ready="true"' in body
    assert "Google Places API (New)" in body and "SERPAPI_KEY" in body
    assert 'href="/strategic-agents/local-business-radar/runs/%d/report"' % rid in body
    assert "local-business-radar.js" in body and "strategic-agents.css" in body


def test_starting_needs_every_required_tool(env, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    r = _client().post("/strategic-agents/local-business-radar/run",
                       json={"business_type": "dentist", "location": "Austin, TX"})
    assert r.status_code == 400 and "Claude" in r.get_json()["error"]
    body = _client().get("/strategic-agents/local-business-radar").get_data(as_text=True)
    assert 'data-ready="false"' in body and "disabled" in body


def test_start_status_and_data_routes(env):
    c = _client()
    r = c.post("/strategic-agents/local-business-radar/run",
               json={"business_type": "dentist", "location": "Austin, TX", "cap": 10})
    rid = r.get_json()["run_id"]
    st = c.get("/strategic-agents/local-business-radar/runs/%d/status" % rid).get_json()
    assert st["status"] == "complete" and [s["state"] for s in st["stages"]] == ["done"] * 6
    assert st["counts"]["found"] == 6 and st["counts"]["researched"] == 5
    d = c.get("/strategic-agents/local-business-radar/runs/%d/data" % rid).get_json()
    assert len(d["businesses"]) == 6 and d["plan"]["area"]["kind"] == "city"
    other = _client("someone@markifydigital.com")
    assert other.get("/strategic-agents/local-business-radar/runs/%d/status" % rid).status_code == 404
    assert other.get("/strategic-agents/local-business-radar/runs/%d/data" % rid).status_code == 404


def test_the_agent_is_on_the_directory_and_in_the_palette(env):
    body = _client().get("/strategic-agents").get_data(as_text=True)
    assert 'data-agent="c-lbr"' in body and "Local Business Radar" in body
    hub = _client().get("/hub").get_data(as_text=True)
    assert "/strategic-agents/local-business-radar" in hub


# ── A restarted run is checked against its own source; Resume; unscored reports ─

def test_a_run_is_checked_against_the_source_it_was_planned_with(env, monkeypatch):
    """The California run: planned with Apify, restarted when the website saw Places
    as the source, and failed asking for Places and SerpAPI keys it never needed."""
    from tracker import lbr_config
    plan = _plan()
    plan["estimate"]["source"] = "apify"
    monkeypatch.setenv("APIFY_API_TOKEN", "apify")
    monkeypatch.delenv("GOOGLE_MAPS_API_KEY")
    monkeypatch.delenv("SERPAPI_KEY")
    monkeypatch.setenv("LBR_SOURCE", "places")              # what a new run would pick now
    assert lbr_config.missing_required() == ["Google Places API (New)", "SerpAPI"]
    assert lbr_config.missing_message(lbr_pipeline.run_source(plan)) == ""
    monkeypatch.delenv("APIFY_API_TOKEN")                     # the token really is gone: say so
    why = lbr_config.missing_message(lbr_pipeline.run_source(plan))
    assert "searches with Apify" in why and "APIFY_API_TOKEN" in why and "SerpAPI" not in why


def test_a_stopped_run_resumes_from_its_saved_stages(env, monkeypatch):
    real = lbr_pipeline.STAGE_FUNCS["score"]
    monkeypatch.setitem(lbr_pipeline.STAGE_FUNCS, "score", lambda *a: (_ for _ in ()).throw(
        lbr_http.ToolError("config", "Not configured: something.")))
    rid = lbr_pipeline.start("p@markifydigital.com", _plan())
    run = lbr_store.get_run(rid)
    assert run["status"] == "failed" and lbr_pipeline.resumable(run) == (True, "")
    paid = len(lbr_store.get_calls(rid))
    assert lbr_pipeline.resume(rid, "other@markifydigital.com") is False
    monkeypatch.setitem(lbr_pipeline.STAGE_FUNCS, "score", real)
    assert lbr_pipeline.resume(rid, "p@markifydigital.com") is True
    run = lbr_store.get_run(rid)
    assert run["status"] == "complete" and run["error"] is None and run["summary"]["tiers"]
    new_calls = lbr_store.get_calls(rid)[paid:]
    assert not [c for c in new_calls if c["provider"] in ("places", "serpapi")], "nothing gathered is bought again"
    with pytest.raises(ValueError, match="Only a run that stopped"):
        lbr_pipeline.resume(rid, "p@markifydigital.com")


def test_some_runs_cannot_be_resumed(env, monkeypatch):
    base = {"status": "failed", "plan": {"estimate": {}}, "error": "x"}
    assert lbr_pipeline.resumable(dict(base, status="complete"))[0] is False
    assert lbr_pipeline.resumable(dict(base, error="Stopped at the cost ceiling ($9 of $8)."))[0] is False
    assert lbr_pipeline.resumable(dict(base, purged_at="2026-10-01"))[0] is False
    assert lbr_pipeline.resumable(dict(base, status="cancelled")) == (True, "")
    monkeypatch.setitem(lbr_pipeline.STAGE_FUNCS, "reviews", lambda *a: (_ for _ in ()).throw(RuntimeError("x")))
    rid = lbr_pipeline.start("p@markifydigital.com", _plan())
    monkeypatch.delenv("SERPAPI_KEY")
    with pytest.raises(ValueError, match="SERPAPI_KEY"):
        lbr_pipeline.resume(rid, "p@markifydigital.com")
    assert lbr_store.get_run(rid)["status"] == "failed"                # not started without its keys


def test_a_report_that_stopped_before_scoring_says_so(env, monkeypatch):
    import json
    from tracker import lbr_report
    monkeypatch.setitem(lbr_pipeline.STAGE_FUNCS, "score", lambda *a: (_ for _ in ()).throw(
        lbr_http.ToolError("config", "Not configured: Google Places API (New), SerpAPI.")))
    rid = lbr_pipeline.start("p@markifydigital.com", _plan())
    c = _client()
    r = c.get("/strategic-agents/local-business-radar/runs/%d/report" % rid)
    body = r.get_data(as_text=True)
    assert r.status_code == 200 and "not yet ranked" in body and "worth a call" not in body
    assert 'id="lbrr-resume"' in body and "nothing already gathered is paid for again" in body
    payload = json.loads(body.split('id="lbr-data" type="application/json">', 1)[1].split("</script>", 1)[0])
    assert payload["scored"] is False and payload["resumable"] is True and payload["researched"] == 5
    assert all(b.get("score") is None for b in payload["businesses"])        # no {"total": null}
    assert c.get("/strategic-agents/local-business-radar/runs/%d/status" % rid).get_json()["resumable"] is True
    monkeypatch.setitem(lbr_pipeline.STAGE_FUNCS, "score", lbr_pipeline._stage_score)
    r = c.post("/strategic-agents/local-business-radar/runs/%d/resume" % rid, json={})
    assert r.status_code == 200 and lbr_store.get_run(rid)["status"] == "complete"
    body = c.get("/strategic-agents/local-business-radar/runs/%d/report" % rid).get_data(as_text=True)
    assert "worth a call" in body and 'id="lbrr-resume"' not in body
    assert c.post("/strategic-agents/local-business-radar/runs/%d/resume" % rid, json={}).status_code == 400
