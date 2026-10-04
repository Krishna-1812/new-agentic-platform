"""Page Watch, Phase 4: the pages, their data, and the routes behind them.

On the in-memory store with drawn pages and fake readings: what is checked
in a request, what the dashboard and the change page are given, the area
picker, the race between a save and a running check, and every route's
access rules (staff only, one's own watches only, JSON only for writes).
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(__file__))
from test_watch_engine import _fake_reader, blocks, cap_from, page  # noqa: E402

from tracker import watch_config, watch_engine, watch_safety, watch_store, watch_web  # noqa: E402

ANA = "ana@markifydigital.com"
BOB = "bob@markifydigital.com"
UTC = timezone.utc


@pytest.fixture
def store(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(watch_safety, "check", lambda url: None)      # no DNS in tests
    watch_store.reset_memory()
    yield watch_store
    watch_store.reset_memory()


def body(**kw):
    out = {"url": "https://example.com/pricing", "name": "Example pricing", "client": "Competitors",
           "schedule": {"every": "daily", "at": "10:30"}, "instructions": "Only prices.", "channel": "#watch",
           "watch_text": True, "watch_visual": True, "area_selector": "", "ignore": []}
    out.update(kw)
    return out


def with_baseline(store, email=ANA, **kw):
    tid = watch_web.create(email, body(**kw))
    watch_engine.run_check(tid, capture=_fake_reader(cap_from(page(), blk=paths()), cap_from(page(), blk=paths()),
                                                     cap_from(page(), blk=paths())))
    return tid


def paths():
    """blocks() with whole paths, as the capture records them."""
    full = {"main > h1": "body > main > h1", "header > a": "body > header > a",
            "p:nth-of-type(1)": "body > main > section > p:nth-of-type(1)",
            "p:nth-of-type(2)": "body > main > section > p:nth-of-type(2)",
            "p:nth-of-type(3)": "body > main > section > p:nth-of-type(3)",
            "div.price > span": "body > main > div.price > span", "p.updated": "body > main > p.updated"}
    return [dict(b, path=full[b["sel"]]) for b in blocks()]


# ── What a request may contain ───────────────────────────────────────────────
def test_a_good_request_is_cleaned(store):
    out = watch_web.clean(body(url="Example.com/pricing#plans", channel="#competitor-watch",
                               name="  Example   pricing  ", schedule={"every": "weekly", "day": "friday"}))
    assert out["url"] == "https://example.com/pricing" and out["name"] == "Example pricing"
    assert out["channel"] == "competitor-watch" and out["schedule"] == {"every": "weekly", "at": "09:00", "day": "fri"}
    assert out["area_selector"] is None and out["ignore"] == []


@pytest.mark.parametrize("bad,field", [
    ({"url": "javascript:alert(1)"}, "url"),
    ({"name": "x" * 121}, "name"),
    ({"instructions": "x" * 1001}, "instructions"),
    ({"schedule": {"every": "minutely"}}, "schedule"),
    ({"watch_text": False, "watch_visual": False}, "watch_text"),
    ({"ignore": [[0, 0, 2, 2]]}, "ignore"),
    ({"ignore": [["a", 0, 10, 10]]}, "ignore"),
    ({"ignore": [[0, 0, 10, 10]] * 21}, "ignore"),
    ({"area_selector": "div{color:red}"}, "area_selector"),
])
def test_a_bad_request_says_which_field_and_why(store, bad, field):
    with pytest.raises(watch_web.Invalid) as err:
        watch_web.clean(body(**bad))
    assert err.value.field == field and str(err.value).endswith(".")


def test_a_private_address_is_refused_when_added(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(watch_web.Invalid) as err:
        watch_web.clean(body(url="http://169.254.169.254/latest/"))
    assert err.value.field == "url"


def test_each_person_has_a_limit(store, monkeypatch):
    monkeypatch.setattr(watch_config, "MAX_WATCHES_PER_USER", 2)
    watch_web.create(ANA, body()); watch_web.create(ANA, body())
    with pytest.raises(watch_web.Invalid):
        watch_web.create(ANA, body())
    assert watch_web.create(BOB, body())


# ── Changing a watch ─────────────────────────────────────────────────────────
def test_a_new_area_starts_again_from_a_first_look(store):
    tid = with_baseline(store)
    t = store.get_target(tid)
    assert t["baseline_id"] and t["settings"]["calibrated_at"]
    store.update_target(tid, settings=dict(t["settings"], learned={"rects": [[1, 1, 9, 9]], "sels": ["x"]},
                                           muted=["design"]))
    watch_web.update(tid, ANA, {"name": "Renamed"})
    assert store.get_target(tid)["baseline_id"] == t["baseline_id"]               # a name is just a name
    watch_web.update(tid, ANA, {"area_selector": "main > section", "area_label": "Plans"})
    t = store.get_target(tid)
    assert t["baseline_id"] is None and t["state"] == "pending" and t["area_label"] == "Plans"
    assert "learned" not in t["settings"] and "calibrated_at" not in t["settings"]
    assert t["settings"]["muted"] == ["design"]                                    # the user's choices stay
    assert datetime.fromisoformat(t["next_check_at"]) <= datetime.now(UTC)


def test_pausing_and_resuming(store):
    tid = with_baseline(store)
    watch_web.update(tid, ANA, {"status": "paused"})
    assert store.claim_due("w", now=datetime.now(UTC) + timedelta(days=9)) == []
    assert watch_web.dashboard(ANA)["watches"][0]["state"] == "paused"
    watch_web.update(tid, ANA, {"status": "active"})
    assert [t["id"] for t in store.claim_due("w")] == [tid]
    with pytest.raises(watch_web.Invalid):
        watch_web.update(tid, ANA, {"status": "deleted"})


def test_someone_elses_watch_cannot_be_changed(store):
    tid = with_baseline(store)
    assert watch_web.update(tid, BOB, {"name": "Mine now"}) is None
    assert watch_web.check_now(tid, BOB) is False
    assert watch_web.preview(tid, BOB) is None and watch_web.timeline(tid, BOB) is None


def test_what_is_watched_cannot_change_while_the_page_is_being_read(store):
    tid = with_baseline(store)
    store.claim_due("worker", now=datetime.now(UTC) + timedelta(days=9))
    assert watch_web.preview(tid, ANA)["ready"] is False                          # not until it finishes
    with pytest.raises(watch_web.Busy):
        watch_web.update(tid, ANA, {"area_selector": "main > section"})
    watch_web.update(tid, ANA, {"name": "Fine"})                                  # a name can change


def test_a_check_asked_for_during_a_check_is_kept(store):
    tid = with_baseline(store)
    later = datetime.now(UTC) + timedelta(days=9)
    claimed = store.claim_due("worker", now=later)[0]
    watch_web.check_now(tid, ANA)                                                 # pressed mid-check
    tomorrow = datetime.now(UTC) + timedelta(days=1)
    store.release(tid, "worker", tomorrow, seen=claimed["next_check_at"])
    assert datetime.fromisoformat(store.get_target(tid)["next_check_at"]) <= datetime.now(UTC)
    # Untouched during the check: the worker's time is used.
    claimed = store.claim_due("worker")[0]
    store.release(tid, "worker", tomorrow, seen=claimed["next_check_at"])
    assert datetime.fromisoformat(store.get_target(tid)["next_check_at"]) == tomorrow


# ── The area picker ──────────────────────────────────────────────────────────
def test_a_drawn_box_becomes_the_container_of_what_it_covers():
    bl = paths()
    area = watch_web.area_from_rect(bl, [30, 150, 700, 320])                     # the three paragraphs
    assert area["selector"] == "body > main > section" and area["blocks"] == 3
    assert area["label"].startswith("Hobby is free") and area["box"][1] == 160
    one = watch_web.area_from_rect(bl, [30, 890, 140, 70])                       # just the price
    assert one["selector"] == "body > main > div.price > span" and one["blocks"] == 1
    assert watch_web.area_from_rect(bl, [1000, 3000, 50, 50]) is None             # nothing there
    assert watch_web.area_from_rect(bl, [0, 0, 1440, 1100]) is None               # the whole page is not an area


def test_ids_anchor_paths():
    bl = [{"text": "A", "box": [0, 0, 10, 10], "path": "#pricing > div:nth-of-type(1) > p"},
          {"text": "B", "box": [0, 20, 10, 10], "path": "#pricing > div:nth-of-type(2) > p"}]
    assert watch_web.area_from_rect(bl, [0, 0, 50, 50])["selector"] == "#pricing"


# ── What the pages are given ─────────────────────────────────────────────────
def test_the_dashboard_card_has_everything_it_draws(store):
    tid = with_baseline(store)
    r = watch_engine.run_check(tid, confirm=False, capture=_fake_reader(
        cap_from(page(price=False), blk=[dict(b, text="$25") if b["text"] == "$20" else b for b in paths()])))
    store.update_change(r["change_id"], verdict={"summary": "Hobby went to $25", "importance": "important",
                                                 "category": "price", "judged_by": "claude", "muted": False})
    watch_web.create(ANA, body(url="https://other.com/", client="Clients"))
    d = watch_web.dashboard(ANA)
    assert d["counts"] == {"all": 2, "changed": 1, "pending": 1} and d["clients"] == ["Clients", "Competitors"]
    c = next(w for w in d["watches"] if w["id"] == tid)
    assert c["state"] == "changed" and c["state_label"] == "Changed" and c["schedule"] == "Daily at 10:30 IST"
    assert [s["o"] for s in c["strip"]] == ["baseline", "changed"]                # oldest first
    assert c["latest"]["summary"] == "Hobby went to $25" and c["latest"]["importance"] == "important"
    assert c["thumb"].startswith("/strategic-agents/page-watch/images/")
    assert c["url_page"] == "/strategic-agents/page-watch/watches/%d" % tid
    assert watch_web.dashboard(BOB)["watches"] == []


def test_the_preview_waits_for_the_first_look_then_shows_it(store):
    tid = watch_web.create(ANA, body(name=""))
    p = watch_web.preview(tid, ANA)
    assert p["ready"] is False and p["name"] == ""
    watch_engine.run_check(tid, capture=_fake_reader(cap_from(page(), blk=paths()), cap_from(page(), blk=paths()),
                                                     cap_from(page(), blk=paths())))
    p = watch_web.preview(tid, ANA)
    assert p["ready"] and p["title"] == "Pricing" and p["width"] == 800 and p["words"] > 20
    assert p["shot"].startswith("/strategic-agents/page-watch/images/")
    assert all(b["path"] for b in p["blocks"])
    assert watch_web.card(dict(store.get_target(tid), checks=[], latest=None))["name"] == "example.com / pricing"


def test_the_preview_says_when_the_page_could_not_be_read(store):
    tid = watch_web.create(ANA, body())
    broken = cap_from(None, blk=[])
    broken.error, broken.error_detail = "timeout", "The page took too long."
    watch_engine.run_check(tid, capture=_fake_reader(broken))
    p = watch_web.preview(tid, ANA)
    assert p["ready"] is False and p["error"] == {"kind": "error", "detail": "The page took too long."}


def test_the_change_page_has_both_pictures_the_boxes_and_the_words(store):
    tid = with_baseline(store)
    r = watch_engine.run_check(tid, confirm=False, capture=_fake_reader(
        cap_from(page(price=False), blk=[dict(b, text="$25") if b["text"] == "$20" else b for b in paths()])))
    v = watch_web.change_view(r["change_id"], ANA)
    assert v["before"]["shot"] and v["after"]["shot"] and v["composite"]
    assert v["before"]["shot"] != v["after"]["shot"] and v["before"]["width"] == 800
    assert v["boxes_after"] and v["prices"][0]["after"] == ["$25"]
    assert v["changed"][0]["segments"] == [["-", "$20"], ["+", "$25"]]
    assert v["watch"]["name"] == "Example pricing" and v["verdict"]["judged_by"] == "rules"
    assert watch_web.change_view(r["change_id"], BOB) is None


def test_a_link_that_stops_resolving_shows_as_cant_read(store, monkeypatch):
    tid = with_baseline(store)

    def gone(url, **k):
        raise watch_safety.BadURL("That site's name does not resolve.")
    for _ in range(2):
        r = watch_engine.run_check(tid, capture=gone)
    assert r["outcome"] == "error" and r["error"] == "bad_url" and store.get_target(tid)["state"] == "error"


# ── The routes ───────────────────────────────────────────────────────────────
@pytest.fixture
def client(store, monkeypatch):
    import app as appmod
    who = {"email": ANA, "name": "Ana"}
    monkeypatch.setattr(appmod, "_get_user", lambda: who)
    c = appmod.app.test_client()
    c.who = who
    return c


def j(client, method, url, data=None):
    return client.open(url, method=method, data=json.dumps(data if data is not None else {}),
                       content_type="application/json")


BASE = "/strategic-agents/page-watch"


def test_signed_out_and_outside_staff_are_turned_away(store, monkeypatch):
    import app as appmod
    c = appmod.app.test_client()
    monkeypatch.setattr(appmod, "_get_user", lambda: None)
    for url in (BASE, BASE + "/api/watches", BASE + "/watches/1", BASE + "/changes/1", BASE + "/images/1"):
        assert c.get(url).status_code in (301, 302), url
    monkeypatch.setattr(appmod, "_get_user", lambda: {"email": "someone@gmail.com"})
    assert c.get(BASE).status_code in (301, 302)
    assert c.post(BASE + "/api/watches", json=body()).status_code in (301, 302)


def test_writes_take_json_only(client):
    r = client.post(BASE + "/api/watches", data={"url": "https://example.com/"})
    assert r.status_code == 415
    assert client.post(BASE + "/api/find", data={"query": "x"}).status_code == 415
    assert client.post(BASE + "/api/changes/1/feedback", data={"kind": "useful"}).status_code == 415


def test_add_preview_set_up_and_remove_through_the_routes(client, store):
    r = j(client, "POST", BASE + "/api/watches", {"url": "example.com/pricing"})
    assert r.status_code == 201
    tid = r.get_json()["id"]
    assert j(client, "GET", BASE + "/api/watches/%d/preview" % tid).get_json()["ready"] is False
    watch_engine.run_check(tid, capture=_fake_reader(cap_from(page(), blk=paths()), cap_from(page(), blk=paths()),
                                                     cap_from(page(), blk=paths())))
    area = j(client, "POST", BASE + "/api/watches/%d/area" % tid, {"rect": [30, 150, 700, 320]}).get_json()
    assert area["ok"] and area["area"]["selector"] == "body > main > section"
    assert j(client, "POST", BASE + "/api/watches/%d/area" % tid, {"rect": "x"}).status_code == 400
    r = j(client, "PATCH", BASE + "/api/watches/%d" % tid, {"name": "Plans", "area_selector": area["area"]["selector"],
                                                            "area_label": "Plans", "ignore": [[0, 0, 100, 40]]})
    assert r.get_json() == {"ok": True, "restarted": True}
    assert j(client, "PATCH", BASE + "/api/watches/%d" % tid, {"schedule": {"every": "x"}}).get_json()["field"] == "schedule"
    assert j(client, "POST", BASE + "/api/watches/%d/check" % tid).status_code == 200
    assert j(client, "POST", BASE + "/api/watches/%d/mute" % tid, {"category": "design"}).get_json()["muted"] == ["design"]
    assert j(client, "POST", BASE + "/api/watches/%d/mute" % tid, {"category": "weather"}).status_code == 400
    assert client.delete(BASE + "/api/watches/%d" % tid).status_code == 415          # JSON only
    assert j(client, "DELETE", BASE + "/api/watches/%d" % tid).status_code == 200
    assert store.get_target(tid) is None


def test_a_busy_watch_answers_409(client, store):
    tid = with_baseline(store)
    store.claim_due("worker", now=datetime.now(UTC) + timedelta(days=9))
    r = j(client, "PATCH", BASE + "/api/watches/%d" % tid, {"area_selector": "body > main"})
    assert r.status_code == 409 and "being read" in r.get_json()["error"]


def test_one_persons_watches_are_invisible_to_another(client, store):
    tid = with_baseline(store, email=BOB)
    r = watch_engine.run_check(tid, confirm=False, capture=_fake_reader(cap_from(page(price=False), blk=paths())))
    shot = watch_store.get_snapshot(store.get_target(tid)["baseline_id"])["shot_id"]
    for url in ("/watches/%d" % tid, "/changes/%d" % r["change_id"], "/images/%d" % shot, "/api/watches/%d" % tid,
                "/api/watches/%d/preview" % tid):
        assert client.get(BASE + url).status_code == 404, url
    for method, url in (("PATCH", "/api/watches/%d" % tid), ("DELETE", "/api/watches/%d" % tid),
                        ("POST", "/api/watches/%d/check" % tid), ("POST", "/api/changes/%d/feedback" % r["change_id"])):
        assert j(client, method, BASE + url, {"name": "x", "kind": "useful"}).status_code == 404, url
    assert store.get_target(tid) is not None


def test_the_pages_render_and_escape_what_came_from_the_web(client, store):
    hostile = '<img src=x onerror="alert(1)">'
    tid = with_baseline(store, name=hostile, client="<b>c</b>")
    r = watch_engine.run_check(tid, confirm=False, capture=_fake_reader(
        cap_from(page(price=False), blk=[dict(b, text="</script><script>alert(2)</script>") if b["text"] == "$20" else b
                                         for b in paths()])))
    store.update_change(r["change_id"], verdict={"summary": hostile, "explanation": "<script>x</script>",
                                                 "importance": "important", "category": "price", "judged_by": "claude"})
    main = client.get(BASE)
    assert main.status_code == 200 and b'id="pw-data"' in main.data
    assert b'<img src=x onerror' not in main.data and b"</script><script>alert" not in main.data
    payload = main.data.split(b'id="pw-data">')[1].split(b"</script>")[0]
    assert json.loads(payload)["board"]["watches"][0]["name"] == hostile        # data, safely embedded
    watch = client.get(BASE + "/watches/%d" % tid)
    assert watch.status_code == 200 and b"&lt;img src=x" in watch.data and b'<img src=x onerror' not in watch.data
    change = client.get(BASE + "/changes/%d" % r["change_id"])
    assert change.status_code == 200 and b"&lt;script&gt;x&lt;/script&gt;" in change.data
    assert b"<script>alert(2)" not in change.data and b"Picture for alerts" in change.data
    img = client.get(BASE + "/images/%d" % watch_store.get_snapshot(store.get_target(tid)["baseline_id"])["shot_id"])
    assert img.status_code == 200 and img.headers["Content-Type"] == "image/webp"
    assert "private" in img.headers["Cache-Control"] and img.headers["X-Content-Type-Options"] == "nosniff"


def test_feedback_and_find_through_the_routes(client, store, monkeypatch):
    tid = with_baseline(store)
    r = watch_engine.run_check(tid, confirm=False, capture=_fake_reader(cap_from(page(price=False), blk=paths())))
    store.update_change(r["change_id"], verdict={"category": "price"})
    assert j(client, "POST", BASE + "/api/changes/%d/feedback" % r["change_id"], {"kind": "mute"}).get_json() == \
        {"ok": True, "feedback": "mute"}
    assert j(client, "POST", BASE + "/api/changes/%d/feedback" % r["change_id"], {"kind": "x"}).status_code == 400
    assert store.get_target(tid)["settings"]["muted"] == ["price"]
    found = j(client, "POST", BASE + "/api/find", {"query": "vercel.com/pricing"}).get_json()
    assert found["candidates"][0]["url"] == "https://vercel.com/pricing"
    status = j(client, "GET", BASE + "/api/status").get_json()
    assert set(status) == {"worker", "queue", "claude"}


def test_the_directory_and_the_palette_list_page_watch(client):
    d = client.get("/strategic-agents").data
    assert b'href="/strategic-agents/page-watch"' in d and b"Page Watch" in d
    page_html = client.get(BASE).get_data(as_text=True)
    items = json.loads(page_html.split("window.__KP_BASE__ = ", 1)[1].split(";</script>", 1)[0])
    assert any(i["u"] == "/strategic-agents/page-watch" for i in items)
    keys = [i["k"] for i in items]
    assert len(keys) == len(set(keys))                                            # one letter each


def test_the_main_page_shows_no_internals(client, store):
    """No worker command, model name, budget meter or health link on the page
    people use; the badge at the top still says when the checker is down."""
    html = client.get(BASE).data
    for internal in (b"What it runs on", b"tracker.watch_worker", b"pw-meter", b"page-watch/health",
                     b"claude-sonnet", b"claude-opus"):
        assert internal not in html, internal
    assert b"Checker not running" in html or b"Watching" in html
    js = open(os.path.join(os.path.dirname(__file__), "..", "static", "js", "page-watch.js")).read()
    assert "docs/page-watch-plan.md" not in js and "worker service" not in js
