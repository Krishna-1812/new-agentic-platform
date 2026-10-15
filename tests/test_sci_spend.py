"""Social Media Intelligence: every paid call is recorded, a run is capped, platforms run side by side.

The audit that prompted this found that nothing wrote to sci_spend_log (so the admin panel showed $0 for the
agent), nothing capped a run, and the page made two paid AI calls on every admin page load. These tests hold
each of those closed. Storage and the vendors are faked; tests/test_sci_spend_pg.py runs the same against
a real Postgres.
"""
import concurrent.futures
import contextvars
import os
import sys
import threading
import time
from types import SimpleNamespace

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import sci_pipeline, sci_spend, sci_store  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OWNER = "kris@markifydigital.com"


@pytest.fixture
def ledger(monkeypatch):
    """Every cost the code writes, as (run_id, platform, vendor, operation, units, usd)."""
    rows = []
    monkeypatch.setattr(sci_store, "log_spend", lambda run_id, platform, vendor, operation, units=None, cost_usd=None:
                        rows.append((run_id, platform, vendor, operation, units, cost_usd)))
    monkeypatch.delenv("SCI_RUN_CAP_USD", raising=False)
    return rows


def in_run(fn, run_id=7, cap=None):
    """Run `fn` as the job thread would: inside its own context, after begin()."""
    def go():
        rs = sci_spend.begin(run_id, cap)
        return fn(rs)
    return contextvars.copy_context().run(go)


# == the cap ===================================================================================

@pytest.mark.parametrize("raw,want", [(None, 5.0), ("", 5.0), ("2.5", 2.5), ("12", 12.0), ("abc", 5.0),
                                       ("0", None), ("-3", None)])
def test_the_cap_comes_from_the_setting_with_five_dollars_as_the_default(monkeypatch, raw, want):
    if raw is None:
        monkeypatch.delenv("SCI_RUN_CAP_USD", raising=False)
    else:
        monkeypatch.setenv("SCI_RUN_CAP_USD", raw)
    assert sci_spend.cap_usd() == want


def test_a_run_is_over_its_cap_once_it_has_spent_it(ledger):
    def go(rs):
        assert not sci_spend.over_cap()
        sci_spend.record("anthropic", "vision", 0.6)
        assert not sci_spend.over_cap() and sci_spend.spent() == pytest.approx(0.6)
        sci_spend.record("anthropic", "vision", 0.5)
        return sci_spend.over_cap()
    assert in_run(go, cap=1.0) is True


def test_no_cap_means_never_over(ledger):
    def go(rs):
        sci_spend.record("anthropic", "vision", 1000)
        return sci_spend.over_cap()
    assert in_run(go, cap=0) is False


def test_outside_a_run_nothing_is_recorded_and_nothing_is_capped(ledger):
    contextvars.copy_context().run(lambda: (sci_spend.record("anthropic", "vision", 9.0), sci_spend.claude("x", SimpleNamespace(usage=None))))
    assert ledger == []
    assert contextvars.copy_context().run(sci_spend.over_cap) is False


# == what each kind of call costs ==============================================================

def test_a_claude_reply_is_priced_from_its_tokens(ledger):
    resp = SimpleNamespace(usage={"input_tokens": 1000, "output_tokens": 500})
    in_run(lambda rs: sci_spend.claude("vision", resp, model="claude-sonnet-5-5"))
    run_id, platform, vendor, op, units, usd = ledger[0]
    assert (run_id, vendor, op, units) == (7, "anthropic", "vision", 1500)
    assert usd == pytest.approx(0.007)          # 1k in at $2/M + 500 out at $10/M


def test_web_searches_are_charged_on_top_of_the_tokens(ledger):
    usage = SimpleNamespace(input_tokens=0, output_tokens=0, cache_read_input_tokens=0, cache_creation_input_tokens=0,
                            server_tool_use=SimpleNamespace(web_search_requests=7))
    in_run(lambda rs: sci_spend.claude("identify", SimpleNamespace(usage=usage), model="claude-sonnet-5-5"))
    assert ledger[0][5] == pytest.approx(0.07)


def test_a_pydantic_usage_object_is_read_through_model_dump(ledger):
    class U:
        def model_dump(self):
            return {"input_tokens": 2000, "output_tokens": 0}
    in_run(lambda rs: sci_spend.claude("synthesis", SimpleNamespace(usage=U()), model="claude-sonnet-5-5"))
    assert ledger[0][5] == pytest.approx(0.004)


def test_whisper_is_estimated_from_the_audio_it_was_sent(ledger):
    in_run(lambda rs: sci_spend.whisper(b"x" * 60000))          # 15 seconds of audio
    assert ledger[0][2:4] == ("openai", "transcribe") and ledger[0][5] == pytest.approx(0.0015)
    ledger.clear()
    in_run(lambda rs: sci_spend.whisper(b"x" * 10_000_000))     # cut to the two-minute cap
    assert ledger[0][5] == pytest.approx(0.012)


def test_an_apify_run_records_the_cost_apify_reported(ledger):
    in_run(lambda rs: (sci_spend.apify({"usageTotalUsd": 0.42}, "apify/instagram-scraper"),
                       sci_spend.apify({"usageTotalUsd": 0}, "free"), sci_spend.apify({}, "none"),
                       sci_spend.apify({"usageTotalUsd": "n/a"}, "bad")))
    assert [(r[2], r[3], r[5]) for r in ledger] == [("apify", "apify/instagram-scraper", 0.42)]


def test_a_finished_job_leaves_nothing_attached_to_its_thread(ledger, monkeypatch):
    monkeypatch.setattr(sci_pipeline, "run_identify", lambda *a: {})
    monkeypatch.setattr(sci_pipeline, "run_reddit_pulse", lambda *a: None)
    monkeypatch.setattr(sci_pipeline, "run_synthesis", lambda *a: None)
    monkeypatch.setattr(sci_store, "update_run_status", lambda *a, **k: True)
    def go():
        sci_pipeline._sci_run_analysis_job(7, OWNER, "Acme", None)
        return sci_spend.current()
    assert contextvars.copy_context().run(go) is None
    # ...and also when the job fails outright
    monkeypatch.setattr(sci_pipeline, "run_identify", lambda *a: (_ for _ in ()).throw(RuntimeError("boom")))
    assert contextvars.copy_context().run(go) is None


def test_recording_a_cost_never_raises(monkeypatch):
    monkeypatch.setattr(sci_store, "log_spend", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("db down")))
    in_run(lambda rs: sci_spend.record("anthropic", "vision", 0.1))      # must not raise


# == every paid call site reports ==============================================================

class _Resp:
    stop_reason = "end_turn"

    def __init__(self, text="{}"):
        self.content = [SimpleNamespace(type="text", text=text)]
        self.usage = SimpleNamespace(input_tokens=1000, output_tokens=500)


class _Client:
    def __init__(self, text="{}"):
        self.messages = self
        self._text = text

    def create(self, **kw):
        return _Resp(self._text)

    def stream(self, **kw):
        outer = self

        class _S:
            def __enter__(s):
                return s

            def __exit__(s, *a):
                return False

            def get_final_message(s):
                return _Resp(outer._text)
        return _S()


def ops(ledger):
    return [r[3] for r in ledger]


def test_the_vision_reads_are_recorded(ledger, monkeypatch):
    from tracker import sci_vision
    monkeypatch.setattr(sci_vision, "_anthropic", lambda: _Client('{"summary": "a shoe on a table"}'))
    in_run(lambda rs: (sci_vision.analyze_image("https://x/i.jpg"), sci_vision.analyze_image_bytes(b"png")))
    assert ops(ledger) == ["vision", "vision"] and all(r[5] > 0 for r in ledger)


def test_a_vision_reply_that_failed_to_parse_is_still_paid_for(ledger, monkeypatch):
    from tracker import sci_vision
    monkeypatch.setattr(sci_vision, "_anthropic", lambda: _Client("not json at all"))
    out = in_run(lambda rs: sci_vision.analyze_image("https://x/i.jpg"))
    assert "error" in out and ops(ledger) == ["vision"], "the vendor charged for it either way"


def test_the_identify_step_is_recorded(ledger, monkeypatch):
    from tracker import sci_identify
    monkeypatch.setattr(sci_identify, "_anthropic", lambda: _Client("{}"))
    in_run(lambda rs: sci_identify.identify_handles("Acme"))
    assert "identify" in ops(ledger)


def test_the_report_is_recorded(ledger, monkeypatch):
    from tracker import sci_synthesize
    monkeypatch.setattr(sci_synthesize, "_anthropic", lambda: _Client("{}"))
    monkeypatch.setattr(sci_store, "get_posts", lambda run_id: [
        {"id": 1, "platform": "x", "post_type": "image", "post_url": "u", "metrics": {}, "creative_analysis": None}])
    in_run(lambda rs: sci_synthesize.synthesize_report(7, {"_all": {}}))
    assert "synthesis" in ops(ledger)


def test_the_reddit_analysis_is_recorded(ledger, monkeypatch):
    from tracker import sci_reddit_pulse
    monkeypatch.setattr(sci_reddit_pulse, "_anthropic", lambda: _Client("{}"))
    in_run(lambda rs: sci_reddit_pulse.analyze("Acme", [{"id": "t1", "title": "Acme is great", "subreddit": "x",
                                                         "score": 5, "num_comments": 2, "snippet": "s"}]))
    assert "reddit-analysis" in ops(ledger)


def test_a_transcript_is_recorded(ledger, monkeypatch):
    from tracker import sci_audio
    fake = SimpleNamespace(audio=SimpleNamespace(transcriptions=SimpleNamespace(create=lambda **k: SimpleNamespace(text="hello"))))
    monkeypatch.setattr(sci_audio, "_openai", lambda: fake)
    assert in_run(lambda rs: sci_audio.transcribe(b"x" * 8000)) == "hello"
    assert ops(ledger) == ["transcribe"]


def test_an_apify_run_through_the_shared_transport_is_recorded(ledger, monkeypatch):
    from tracker import apify_transport as t
    monkeypatch.setattr(t, "_start_run", lambda *a, **k: "run1")
    monkeypatch.setattr(t, "_poll_run", lambda *a, **k: {"status": "SUCCEEDED", "defaultDatasetId": "d", "usageTotalUsd": 0.31})
    monkeypatch.setattr(t, "_fetch_dataset_items", lambda *a, **k: [{"id": 1}])
    assert in_run(lambda rs: t.run_actor_and_wait("apify/x-scraper", {}, "tok")) == [{"id": 1}]
    assert [(r[2], r[5]) for r in ledger] == [("apify", 0.31)]
    ledger.clear()
    t.run_actor_and_wait("apify/x-scraper", {}, "tok")           # another agent, no run on this thread
    assert ledger == []


# == the pipeline ==============================================================================

class FakeStore:
    """Just enough of sci_store for the pipeline: what it was asked to write."""

    def __init__(self, posts_by_platform):
        self.posts = posts_by_platform
        self.platform_rows, self.post_rows, self.status = {}, {}, []

    def install(self, monkeypatch):
        monkeypatch.setattr(sci_store, "get_posts", lambda run_id, platform=None: self.posts.get(platform, []))
        monkeypatch.setattr(sci_store, "upsert_platform_run", lambda run_id, platform, **f: self.platform_rows.setdefault(platform, {}).update(f))
        monkeypatch.setattr(sci_store, "update_post_creative_analysis",
                            lambda pid, analysis, status="ok", error=None: self.post_rows.__setitem__(pid, (status, error)))
        monkeypatch.setattr(sci_store, "update_run_status", lambda run_id, status, **k: self.status.append(status))


def _posts(n, base=0):
    return [{"id": base + i, "caption": "c", "post_type": "image", "media_urls": ["https://cdn/x%d.jpg" % i], "raw": {}}
            for i in range(n)]


def test_once_the_cap_is_reached_the_rest_of_a_platform_is_skipped_and_says_why(ledger, monkeypatch):
    fs = FakeStore({"instagram": _posts(5)})
    fs.install(monkeypatch)
    monkeypatch.setattr(sci_pipeline, "_run_claude_creative_analysis",
                        lambda pid, *a, **k: (sci_spend.record("anthropic", "vision", 0.6), fs.post_rows.__setitem__(pid, ("ok", None))))
    in_run(lambda rs: sci_pipeline.run_platform_creative_analysis(7, "instagram"), cap=1.0)
    states = [fs.post_rows[i][0] for i in range(5)]
    assert states == ["ok", "ok", "skipped", "skipped", "skipped"]
    assert "cost cap ($1.00)" in fs.post_rows[2][1]
    note = fs.platform_rows["instagram"]["status_detail"]
    assert "3 of 5 posts were collected but not described" in note and "cost cap" in note
    assert fs.platform_rows["instagram"]["analyzed_at"], "the platform still finishes"


def test_a_run_under_its_cap_reads_every_post_and_adds_no_note(ledger, monkeypatch):
    fs = FakeStore({"instagram": _posts(3)})
    fs.install(monkeypatch)
    monkeypatch.setattr(sci_pipeline, "_run_claude_creative_analysis",
                        lambda pid, *a, **k: (sci_spend.record("anthropic", "vision", 0.1), fs.post_rows.__setitem__(pid, ("ok", None))))
    in_run(lambda rs: sci_pipeline.run_platform_creative_analysis(7, "instagram"), cap=5.0)
    assert [fs.post_rows[i][0] for i in range(3)] == ["ok"] * 3
    assert "status_detail" not in fs.platform_rows["instagram"]


def _identify(*platforms):
    return {p: {"handle": "acme", "profile_url": None, "confidence": "high", "reasoning": ""} for p in platforms}


def test_a_platform_that_starts_after_the_cap_is_not_collected_at_all(ledger, monkeypatch):
    fs = FakeStore({})
    fs.install(monkeypatch)
    monkeypatch.setenv("SCI_PARALLEL_PLATFORMS", "1")
    monkeypatch.setenv("SCI_RUN_CAP_USD", "1")
    monkeypatch.setattr(sci_pipeline, "run_identify", lambda *a: _identify("instagram", "tiktok"))
    collected = []

    def collect(run_id, platform, handle, **k):
        collected.append(platform)
        sci_spend.record("apify", "scrape", 1.5)           # one scrape blows the cap
    monkeypatch.setattr(sci_pipeline, "run_platform_collection", collect)
    monkeypatch.setattr(sci_pipeline, "run_platform_creative_analysis", lambda *a: None)
    monkeypatch.setattr(sci_pipeline, "run_reddit_pulse", lambda *a: None)
    monkeypatch.setattr(sci_pipeline, "run_synthesis", lambda *a: None)
    contextvars.copy_context().run(sci_pipeline._sci_run_analysis_job, 7, OWNER, "Acme", None)
    assert collected == ["instagram"]
    row = fs.platform_rows["tiktok"]
    assert row["status"] == "scrape_failed" and "cost cap ($1.00)" in row["status_detail"]
    assert fs.status[-1] == "done", "a capped run still finishes, with what it has"


def test_the_report_is_still_written_when_the_cap_was_reached(ledger, monkeypatch):
    fs = FakeStore({})
    fs.install(monkeypatch)
    monkeypatch.setenv("SCI_RUN_CAP_USD", "0.5")
    monkeypatch.setattr(sci_pipeline, "run_identify", lambda *a: _identify("x"))
    monkeypatch.setattr(sci_pipeline, "run_platform_collection", lambda *a, **k: sci_spend.record("apify", "scrape", 2.0))
    monkeypatch.setattr(sci_pipeline, "run_platform_creative_analysis", lambda *a: None)
    monkeypatch.setattr(sci_pipeline, "run_reddit_pulse", lambda *a: None)
    wrote = []
    monkeypatch.setattr(sci_pipeline, "run_synthesis", lambda run_id: wrote.append(run_id))
    contextvars.copy_context().run(sci_pipeline._sci_run_analysis_job, 7, OWNER, "Acme", None)
    assert wrote == [7]


def test_platforms_run_side_by_side_and_each_reports_its_own_cost(ledger, monkeypatch):
    fs = FakeStore({})
    fs.install(monkeypatch)
    monkeypatch.setenv("SCI_PARALLEL_PLATFORMS", "3")
    names = ("instagram", "tiktok", "youtube")
    monkeypatch.setattr(sci_pipeline, "run_identify", lambda *a: _identify(*names))
    barrier = threading.Barrier(3, timeout=5)           # all three must be inside collection at once
    threads = {}

    def collect(run_id, platform, handle, **k):
        threads[platform] = threading.current_thread().name
        barrier.wait()
        sci_spend.record("apify", "scrape", 0.1)
    monkeypatch.setattr(sci_pipeline, "run_platform_collection", collect)
    monkeypatch.setattr(sci_pipeline, "run_platform_creative_analysis", lambda *a: None)
    monkeypatch.setattr(sci_pipeline, "run_reddit_pulse", lambda *a: None)
    monkeypatch.setattr(sci_pipeline, "run_synthesis", lambda *a: None)
    contextvars.copy_context().run(sci_pipeline._sci_run_analysis_job, 7, OWNER, "Acme", None)
    assert len(set(threads.values())) == 3 and all(n.startswith("sci-platform") for n in threads.values())
    assert sorted((r[1], r[5]) for r in ledger) == [("instagram", 0.1), ("tiktok", 0.1), ("youtube", 0.1)]
    assert fs.status[-1] == "done"


def test_one_platform_blowing_up_leaves_the_others_and_the_run_intact(ledger, monkeypatch):
    fs = FakeStore({})
    fs.install(monkeypatch)
    monkeypatch.setattr(sci_pipeline, "run_identify", lambda *a: _identify("instagram", "tiktok", "youtube"))
    done = []

    def collect(run_id, platform, handle, **k):
        if platform == "tiktok":
            raise RuntimeError("actor blocked")
        done.append(platform)
    monkeypatch.setattr(sci_pipeline, "run_platform_collection", collect)
    monkeypatch.setattr(sci_pipeline, "run_platform_creative_analysis", lambda *a: None)
    monkeypatch.setattr(sci_pipeline, "run_reddit_pulse", lambda *a: None)
    monkeypatch.setattr(sci_pipeline, "run_synthesis", lambda *a: None)
    contextvars.copy_context().run(sci_pipeline._sci_run_analysis_job, 7, OWNER, "Acme", None)
    assert sorted(done) == ["instagram", "youtube"]
    assert fs.platform_rows["tiktok"]["status"] == "error" and "actor blocked" in fs.platform_rows["tiktok"]["status_detail"]
    assert fs.status[-1] == "done"


@pytest.mark.parametrize("raw,want", [(None, 3), ("1", 1), ("5", 5), ("0", 1), ("x", 3)])
def test_the_number_of_platforms_at_once_is_a_setting_with_one_as_the_floor(monkeypatch, raw, want):
    if raw is None:
        monkeypatch.delenv("SCI_PARALLEL_PLATFORMS", raising=False)
    else:
        monkeypatch.setenv("SCI_PARALLEL_PLATFORMS", raw)
    assert sci_pipeline._parallel_platforms() == want


# == the routes ================================================================================

def _client(email=OWNER):
    import app as appmod
    c = appmod.app.test_client()
    with c.session_transaction() as s:
        s["google_user"] = {"email": email, "name": "T"}
    return c


def test_a_second_analysis_while_one_is_running_is_refused_and_points_at_the_first(monkeypatch):
    started = []
    monkeypatch.setattr(sci_store, "active_run", lambda email: {"id": 41, "company_name": "Nike", "status": "running"})
    monkeypatch.setattr(sci_store, "save_run", lambda *a, **k: started.append(a) or 99)
    monkeypatch.setattr(threading, "Thread", lambda *a, **k: started.append("thread") or SimpleNamespace(start=lambda: None))
    r = _client().post("/strategic-agents/social-media-intelligence/analyze", json={"company_name": "Adidas"})
    assert r.status_code == 409
    body = r.get_json()
    assert body["run_id"] == 41 and "Nike" in body["error"] and "already" in body["error"]
    assert started == [], "nothing was saved and no thread was started"


def test_with_nothing_running_an_analysis_starts(monkeypatch):
    started = []
    monkeypatch.setattr(sci_store, "active_run", lambda email: None)
    monkeypatch.setattr(sci_store, "save_run", lambda *a, **k: 99)
    monkeypatch.setattr(threading, "Thread", lambda *a, **k: started.append(k.get("args")) or SimpleNamespace(start=lambda: None))
    r = _client().post("/strategic-agents/social-media-intelligence/analyze", json={"company_name": "Adidas"})
    assert r.status_code == 200 and r.get_json() == {"run_id": 99, "status": "running"}
    assert started and started[0][0] == 99


def test_only_admins_are_sent_what_a_run_cost(monkeypatch):
    run = {"id": 5, "status": "done", "error": None, "company_name": "Acme", "email": OWNER, "space": ""}
    monkeypatch.setattr(sci_store, "get_run", lambda rid, email: dict(run))
    monkeypatch.setattr(sci_store, "resolve_stale_run", lambda r: r)
    monkeypatch.setattr(sci_store, "get_platform_runs", lambda rid: [])
    monkeypatch.setattr(sci_store, "get_posts", lambda rid, platform=None: [])
    monkeypatch.setattr(sci_store, "run_spend", lambda rid: {"usd": 1.23, "by_vendor": {"anthropic": 1.0, "apify": 0.23}})
    url = "/strategic-agents/social-media-intelligence/runs/5"
    assert _client(OWNER).get(url).get_json()["cost"]["usd"] == 1.23
    staff = _client("not-an-admin@markifydigital.com").get(url).get_json()
    assert "cost" not in staff, "the agency's own spend is not shown to anyone who is not an admin"


# == the page and the report call ==============================================================

def _page():
    return open(os.path.join(ROOT, "templates", "social_media_intelligence.html"), encoding="utf-8").read()


def test_opening_the_page_makes_no_paid_call():
    page = _page()
    start = page.index("function renderDataSourcesPanel")
    body = page[start:page.index("\n    }\n", start)]
    on_load = body[body.index("</div>';\n      loadDataSources();"):]     # what runs when the panel is drawn
    assert "loadDataSources();" in on_load and "loadApifyDataSources();" in on_load, "the free checks still run"
    assert "loadVisionClaudeCheck();" not in on_load and "loadVisionClaudeUrlCheck();" not in on_load
    assert 'onclick="loadVisionClaudeCheck()"' in body and 'onclick="loadVisionClaudeUrlCheck()"' in body, "each has its button"
    assert "loadVisionClaudeCheck();'" in body and "loadVisionClaudeUrlCheck();\">Refresh" in body, "Refresh still runs them"


def test_all_seven_platforms_have_an_icon():
    page = _page()
    mosaic = page[page.index('<div class="sci-mosaic"'):page.index('<form class="sci-cmd"')]
    for name in ("Instagram", "LinkedIn", "X", "TikTok", "YouTube", "Facebook", "Reddit"):
        assert "<b>%s</b>" % name in mosaic, name
    assert "across seven platforms" in page


def test_a_refused_second_run_resumes_the_one_already_going():
    page = _page()
    start = page.index("function startAnalysis")
    body = page[start:page.index("function renderPlatforms", start)]
    assert "data.run_id" in body and "pollRun(data.run_id)" in body


def test_the_run_cost_is_shown_to_admins_only():
    page = _page()
    start = page.index("function costChip")
    chip = page[start:page.index("function reportHead", start)]
    assert "if(!IS_ADMIN" in chip and "run.cost.usd" in chip
    assert "costChip(run)" in page


def test_the_report_call_has_five_minutes_not_ninety_seconds(monkeypatch):
    from tracker import sci_synthesize
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    assert sci_synthesize._anthropic().timeout == 300.0
