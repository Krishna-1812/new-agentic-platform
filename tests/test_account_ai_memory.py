"""Account memory, phase 4: the AI's brief of an account's earlier work (docs/account-memory-plan.md).

tracker/account_brief.py builds it from one client account's space only: its earlier AI reviews, the
page changes seen, SEO & AEO runs, agent runs and videos. The Google Ads AI review is given it (and
says which earlier actions were done); Video Studio is told which videos were already made. These
prove what goes in, that nothing from another account or anyone's General work does, and that the
run's page shows what the AI was given (to staff, never to a client).
"""

import json

import pytest

import app as appmod
from tests import test_google_ads_ai as R
from tracker import (account_brief, gads_ai, gads_ai_store, lbr_store, people_store, seo_runs_store, video_app,
                     video_plan, video_planner, video_store, watch_store, workspace)

ANA = "ana@markifydigital.com"
RAJ = "raj@markifydigital.com"
LUMINA, BLOOM = workspace.account(11), workspace.account(22)
STORES = (gads_ai_store, lbr_store, people_store, seo_runs_store, video_store, watch_store)


@pytest.fixture(autouse=True)
def world(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    for s in STORES:
        s.reset_memory()
    people_store.remember(ANA, "Ana Mehta")
    yield
    for s in STORES:
        s.reset_memory()


def _review(account, headline, action, email=ANA):
    rid = gads_ai_store.create_review(account, email)
    gads_ai_store.update_review(rid, status="complete", period_from="2026-08-01", period_to="2026-08-30",
                                report={"headline": headline, "overall": "needs_attention",
                                        "scorecard": [{"objective": "CPA", "target": "INR 900", "actual": "INR 1,200",
                                                       "status": "off_track", "evidence": "e"}],
                                        "actions": [{"priority": "P1", "title": action, "what_to_do": "Add 'free' as a negative",
                                                     "where": "Generic - Search"}]})
    return rid


def _seed(space, tag, email=ANA):
    """One of everything, in one space, each marked with `tag`."""
    t = watch_store.create_target(email, "https://%s.in/pricing" % tag, space=space, name="%s pricing" % tag)
    cid = watch_store.add_change(t, None, None, "major", "%s prices went up" % tag, {})
    watch_store.update_change(cid, verdict={"summary": "%s raised its prices" % tag, "importance": "important"})
    seo_runs_store.add(email, space, "seo-geo-audit", "https://%s.in" % tag,
                       {"facts": [["Overall score", 71]], "highlights": ["%s: add FAQ schema" % tag]}, {}, None)
    lbr_store.create_run(email, "%s dentists" % tag, "Pune", "all", 40, space=space)
    video_store.create_project(email, client=tag, brief="%s launch video" % tag, kind="launch", space=space)


# ── What the brief holds ─────────────────────────────────────────────────────
def test_the_brief_holds_the_accounts_earlier_work_and_nothing_else():
    _seed(LUMINA, "lumina")
    _seed(BLOOM, "bloom", email=RAJ)
    _seed(workspace.personal(ANA), "anas-own")
    _seed("", "legacy")
    _review("Lumina Ads", "Lumina negatives", "Add negatives for lumina")
    _review("Bloom Ads", "Bloom spend", "Cut bloom spend")
    b = account_brief.build(LUMINA, ["Lumina Ads"])
    text = b["text"]
    for want in ("lumina raised its prices", "lumina pricing", "https://lumina.in", "lumina: add FAQ schema",
                 "lumina dentists", "lumina launch video", "Add negatives for lumina", "Lumina negatives",
                 "Objective off track: CPA", "by Ana Mehta"):
        assert want in text, want
    for never in ("bloom", "Bloom", "anas-own", "legacy"):
        assert never not in text, never
    assert [s["key"] for s in b["sections"]] == ["reviews", "changes", "seo", "agents", "videos"]
    assert b["counts"] == {"reviews": 1, "changes": 1, "seo": 1, "agents": 1, "videos": 1}


@pytest.mark.parametrize("space", ["", "me:" + ANA, "acct:", "acct:x", None])
def test_a_brief_is_built_only_from_an_accounts_space(space):
    with pytest.raises(ValueError):
        account_brief.build(space)


def test_an_account_with_no_work_has_an_empty_brief():
    b = account_brief.build(LUMINA, ["Lumina Ads"])
    assert b["text"] == "" and b["sections"] == [] and account_brief.shown(b)["sections"] == []


def test_the_review_being_written_and_unfinished_ones_are_left_out():
    done = _review("Lumina Ads", "Earlier one", "Old action")
    now = _review("Lumina Ads", "This one", "New action")
    gads_ai_store.create_review("Lumina Ads", ANA)          # still queued
    text = account_brief.build(LUMINA, ["Lumina Ads"], exclude=now)["text"]
    assert "Old action" in text and "New action" not in text and done


def test_a_long_history_is_cut_to_size_oldest_first(monkeypatch):
    monkeypatch.setattr(account_brief, "MAX_CHARS", 900)
    for i in range(8):
        seo_runs_store.add(ANA, LUMINA, "keyword-research", "keyword %d %s" % (i, "x" * 80), {}, {}, None)
    b = account_brief.build(LUMINA)
    assert len(b["text"]) <= 900 and "keyword 7" in b["text"] and "keyword 0" not in b["text"]


def test_a_part_that_cannot_be_read_is_left_out(monkeypatch):
    _seed(LUMINA, "lumina")

    def broken(*a, **k):
        raise RuntimeError("down")
    monkeypatch.setattr(seo_runs_store, "list_runs", broken)
    b = account_brief.build(LUMINA)
    assert "seo" not in b["counts"] and b["counts"]["videos"] == 1


# ── The Google Ads AI review is given it ─────────────────────────────────────
def _run(rid, account, memory=None, review=None):
    fake = R.FakeClaude(review or R.REVIEW)          # no notes on the account: one call, the review
    st = R._state()
    gads_ai.run_review(rid, account, lambda: (R.g, st, R.REPORT_ROWS, R.g.FX(R.REPORT_ROWS), None, None),
                       gads_ai_store, client=fake, beat_every=0.05, memory=memory)
    return fake.calls[-1]["messages"][0]["content"], gads_ai_store.get_review(rid)


def test_the_review_is_asked_to_follow_up_on_the_last_one():
    _review(R.ACCOUNT, "Leads too dear", "Add negatives for free")
    _seed(LUMINA, "lumina")
    rid = gads_ai_store.create_review(R.ACCOUNT, RAJ)
    follow = {"summary": "One of one earlier actions was done.",
              "earlier_actions": [{"action": "Add negatives for free", "status": "done", "evidence": "Change history"}]}
    body, r = _run(rid, R.ACCOUNT, lambda account, review_id: account_brief.build(LUMINA, [account], exclude=review_id),
                   dict(R.REVIEW, follow_up=follow))
    earlier = body[body.index("<earlier_work>"):body.index("</earlier_work>")]
    assert "Add negatives for free" in earlier and "lumina raised its prices" in earlier
    assert body.index("</data_pack>") < body.index("<earlier_work>") and body.endswith("Write the review of %s." % R.ACCOUNT)
    assert "Pick up where the last review left off" in gads_ai.REVIEW_SYSTEM
    assert r["status"] == "complete" and r["report"]["follow_up"] == follow
    mem = r["report"]["memory"]
    assert mem["counts"]["reviews"] == 1 and mem["sections"][0]["items"][0]["by"] == "Ana Mehta"
    assert "who" not in json.dumps(mem), "the page is shown names, not addresses"


def test_without_earlier_work_the_review_is_asked_as_before():
    rid = gads_ai_store.create_review(R.ACCOUNT, RAJ)
    body, r = _run(rid, R.ACCOUNT, lambda account, review_id: account_brief.build(LUMINA, [account], exclude=review_id))
    assert "<earlier_work>" not in body and "memory" not in r["report"]
    rid = gads_ai_store.create_review(R.ACCOUNT, RAJ)
    body, r = _run(rid, R.ACCOUNT, None)
    assert "<earlier_work>" not in body and r["status"] == "complete"


def test_a_brief_that_fails_never_stops_the_review():
    def broken(account, review_id):
        raise RuntimeError("store down")
    rid = gads_ai_store.create_review(R.ACCOUNT, RAJ)
    body, r = _run(rid, R.ACCOUNT, broken)
    assert r["status"] == "complete" and "<earlier_work>" not in body


def test_follow_up_is_in_the_strict_schema():
    fu = gads_ai.REVIEW_SCHEMA["properties"]["follow_up"]
    assert fu["additionalProperties"] is False and set(fu["required"]) == {"summary", "earlier_actions"}
    assert "follow_up" in gads_ai.REVIEW_SCHEMA["required"]


def _listing(*accts):
    return {"by_slug": {a["slug"]: a for a in accts}}


def test_the_review_finds_its_client_account_by_its_google_ads_account(monkeypatch):
    lumina = {"slug": "lumina", "space": LUMINA, "ads_names": ["Lumina Ads", "Lumina Brand"]}
    bloom = {"slug": "bloom", "space": BLOOM, "ads_names": ["Bloom Ads"]}
    monkeypatch.setattr(appmod, "_acct_listing", lambda force=False: _listing(lumina, bloom, dict(lumina, slug="old")))
    _review("Lumina Brand", "Brand", "Raise brand bids")
    _review("Bloom Ads", "Bloom", "Cut bloom spend")
    _seed(BLOOM, "bloom")
    text = appmod._gads_ai_memory("Lumina Ads", 999)["text"]
    assert "Raise brand bids" in text, "the client account's other Google Ads accounts count too"
    assert "bloom" not in text.lower()
    assert appmod._gads_ai_memory("Unknown Ads", 1) is None
    twice = dict(bloom, slug="bloom2", space=workspace.account(33), ads_names=["Bloom Ads"])
    monkeypatch.setattr(appmod, "_acct_listing", lambda force=False: _listing(lumina, bloom, twice))
    assert appmod._gads_ai_memory("Bloom Ads", 1) is None, "an account two clients answer to gets no memory"


def test_starting_a_review_hands_it_the_memory(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: R.REPORT_ROWS)
    monkeypatch.setattr(appmod, "_gads_ai_doc_setting", lambda: ("", "", ""))
    seen = []
    monkeypatch.setattr(appmod, "_gads_ai_spawn", lambda fn, *a, **kw: seen.append(kw))
    c = appmod.app.test_client()
    with c.session_transaction() as s:
        s["google_user"], s["people_seen"] = {"email": "reporting@markifydigital.com", "name": "R"}, True
    r = c.post("/api/dashboards/google-ads/ai/reviews", json={"account": R.ACCOUNT}, headers={"X-Requested-With": "fetch"})
    assert r.status_code == 202, r.get_json()
    assert seen[0]["memory"] is appmod._gads_ai_memory


def test_a_client_never_sees_what_the_ai_was_given():
    out = appmod._acct_review_out({"id": 1, "report": {"headline": "h", "context": {"kind": "doc", "found": True},
                                                        "memory": {"sections": [{"label": "x"}]},
                                                        "follow_up": {"summary": "s", "earlier_actions": []}}}, full=True)
    assert "memory" not in out["report"] and out["report"]["follow_up"]["summary"] == "s"


def test_the_review_page_shows_the_follow_up_and_what_it_was_given():
    src = open("static/js/google-ads-ai.js", encoding="utf-8").read()
    assert "Since the last review" in src and "What the AI was given about earlier work" in src
    assert "innerHTML" not in src


# ── Video Studio is told the videos already made ─────────────────────────────
def test_a_video_for_an_account_is_planned_knowing_its_earlier_videos():
    old = video_store.create_project(RAJ, client="Lumina", brief="Implant offer reel", kind="promo", space=LUMINA)
    video_store.create_project(ANA, client="Bloom", brief="Bloom facial reel", kind="promo", space=BLOOM)
    video_store.create_project(ANA, client="Lumina", brief="Ana's own test", kind="promo", space=workspace.personal(ANA))
    new = video_store.create_project(ANA, client="Lumina", brief="Clinic tour", kind="launch", space=LUMINA)
    text, given = video_planner._earlier(video_store.get_project(new))
    assert "Implant offer reel" in text and "Promotion / ad video" in text
    assert "Clinic tour" not in text, "never the video being planned"
    assert "Bloom" not in text and "own test" not in text
    assert given["counts"] == {"videos": 1} and old
    view = video_app._plan_view({"memory": given}, "square")
    assert view["earlier"] == [given["sections"][0]["items"][0]["text"]]


def test_general_videos_get_no_earlier_videos():
    video_store.create_project(ANA, brief="One", kind="promo", space=workspace.personal(ANA))
    mine = video_store.create_project(ANA, brief="Two", kind="promo", space=workspace.personal(ANA))
    assert video_planner._earlier(video_store.get_project(mine)) == ("", None)
    legacy = video_store.create_project(ANA, brief="Three", kind="promo")
    assert video_planner._earlier(video_store.get_project(legacy)) == ("", None)


def test_the_plan_request_carries_the_earlier_videos_as_history_not_sources(monkeypatch):
    sent = []

    def ask(client, messages, record):
        sent.append(messages[0]["content"])
        raise video_plan.PlanError("stop here")
    monkeypatch.setattr(video_plan, "_ask", ask)
    monkeypatch.setattr(video_plan, "spent_this_month", lambda now=None: 0.0)
    brand = {"colors": {"background": "#fff", "text": "#000", "accent": "#f00"},
             "fonts": {"heading": "Inter", "body": "Inter"}, "font_swaps": []}
    choices = {"kind": "launch", "shape": "square", "seconds": 15}
    for earlier in ("- [2026-09-01] Promotion / ad video: Implant offer reel", ""):
        with pytest.raises(video_plan.PlanError):
            video_plan.make_plan("Clinic tour", choices, brand, {"assets": []}, client=object(), earlier=earlier)
    texts = [[b.get("text", "") for b in c] for c in sent]
    note = [t for t in texts[0] if t.startswith("Videos the team already made")]
    assert note and "Implant offer reel" in note[0] and "take no words or numbers from them" in note[0]
    assert texts[0][-1] == "Make the plan." and not any("already made" in t for t in texts[1])
    assert "Implant offer reel" not in video_plan.corpus("Clinic tour", choices, {"assets": []}), \
        "an earlier video's words are never a source the plan may quote"
