"""Account memory, phase 1: every piece of work saved in a space (docs/account-memory-plan.md).

An account's work (its space, "acct:<id>") is the whole team's: everyone sees it, with who made it,
and anyone can carry it on; only its maker or an admin removes it. Work on the global pages is the
person's own General work, which nobody else sees. Two accounts never share anything. Work saved
before spaces moves to the account its client name names. The account's home lists all of it as its
History.
"""

import json
import re

import pytest

import app as appmod
from tracker import (account_history, client_accounts_store, gads_ai_store, people_store, video_store, watch_store,
                     watch_web, workspace)

KRIS = "kris@markifydigital.com"           # an admin
ANA = "ana@markifydigital.com"             # staff
RAJ = "raj@markifydigital.com"             # staff


def _row(day):
    return {"account": "Lumina Smiles Dental", "customer_id": "412-118-3390", "campaign": "Search", "state": "Enabled",
            "type": "Search", "day": day, "clicks": 10.0, "impressions": 100.0, "cost": 100.0, "currency": "INR",
            "conversions": 1.0, "view_through": 0.0, "top_pct": 0.0, "abs_top_pct": 0.0, "cost_native": 100.0,
            "currency_native": "INR"}


def _p(text):
    return {"paragraph": {"elements": [{"textRun": {"content": text + "\n"}}],
                          "paragraphStyle": {"namedStyleType": "NORMAL_TEXT"}}}


def _tab(title, lines):
    return {"tabProperties": {"title": title}, "documentTab": {"body": {"content": [_p(x) for x in lines]}}}


DOC = {"title": "Master", "tabs": [
    _tab("Lumina Smiles Dental", ["URL name: lumina", "Website: luminasmiles.in", "Industry: Dental clinic"]),
    _tab("Bloom Skin Clinic", ["URL name: bloom", "Website: bloomskin.in", "Industry: Skin clinic"]),
]}


@pytest.fixture(autouse=True)
def world(monkeypatch):
    for s in (client_accounts_store, watch_store, video_store, gads_ai_store, people_store):
        s.reset_memory()
    appmod._acct_reset()
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: [_row("2026-09-%02d" % d) for d in range(1, 31)])
    monkeypatch.setattr(appmod, "_acct_doc", lambda: (DOC, "https://docs.google.com/document/d/x/edit", None))
    people_store.remember(KRIS, "Kris Ladha")
    people_store.remember(ANA, "Ana Mehta")
    yield
    for s in (client_accounts_store, watch_store, video_store, gads_ai_store, people_store):
        s.reset_memory()
    appmod._acct_reset()


def _client(email):
    c = appmod.app.test_client()
    with c.session_transaction() as sess:
        sess["google_user"] = {"email": email, "name": email.split("@")[0].title()}
        sess["people_seen"] = True
    return c


def _space(slug):
    return appmod._acct_listing()["by_slug"][slug]["space"]


def _data(html, sid):
    return json.loads(re.search(r'<script type="application/json" id="%s">(.*?)</script>' % sid, html, re.S).group(1))


def _fetch(c, method, url, body=None):
    return c.open(url, method=method, json=body if body is not None else {})


# ── Spaces ───────────────────────────────────────────────────────────────────
def test_spaces_are_named_by_the_accounts_stable_id():
    listing = appmod._acct_listing()
    spaces = {a["slug"]: a["space"] for a in listing["accounts"]}
    assert set(spaces) == {"lumina", "bloom"} and len(set(spaces.values())) == 2
    assert all(workspace.is_account(s) for s in spaces.values())
    assert workspace.personal("Ana@X.com") == "me:ana@x.com" and not workspace.is_account("me:ana@x.com")
    assert not workspace.is_account("acct:") and not workspace.is_account("acct:1 OR 1=1")


def test_a_name_two_accounts_answer_to_claims_nothing():
    names = workspace.legacy_names([{"id": 1, "name": "Same Co", "ads_names": []},
                                    {"id": 2, "name": "Other", "ads_names": ["Same Co"]}])
    assert "same co" not in names and names == {"other": "acct:2"}


# ── Page Watch ───────────────────────────────────────────────────────────────
def test_an_accounts_watches_are_the_whole_teams_with_who_added_each():
    tid = watch_web.create(ANA, {"url": "https://smilecare.in/pricing"}, space=_space("lumina"))
    raj = _client(RAJ)
    board = _data(raj.get("/lumina/page-watch").get_data(as_text=True), "pw-data")["board"]
    assert [(w["id"], w["by"]) for w in board["watches"]] == [(tid, "Ana Mehta")]
    assert raj.get("/lumina/page-watch/watches/%d" % tid).status_code == 200
    assert _fetch(raj, "PATCH", "/strategic-agents/page-watch/api/watches/%d" % tid, {"status": "paused"}).status_code == 200
    assert watch_store.get_target(tid)["status"] == "paused", "anyone on the team carries the account's work on"
    r = _fetch(raj, "DELETE", "/strategic-agents/page-watch/api/watches/%d" % tid)
    assert r.status_code == 403 and "Ana Mehta" in r.get_json()["error"]
    assert watch_store.get_target(tid) is not None
    assert _fetch(_client(KRIS), "DELETE", "/strategic-agents/page-watch/api/watches/%d" % tid).status_code == 200, \
        "an admin can remove it"
    assert watch_store.get_target(tid) is None


def test_a_watch_added_inside_an_account_is_saved_to_it():
    c = _client(ANA)
    r = _fetch(c, "POST", "/lumina/api/page-watch/watches", {"url": "https://clovedental.in", "client": "Someone else"})
    assert r.status_code == 201 and r.get_json()["page"].startswith("/lumina/page-watch/watches/")
    t = watch_store.get_target(r.get_json()["id"])
    assert t["space"] == _space("lumina") and t["client"] == "Lumina Smiles Dental" and t["email"] == ANA
    assert [w["id"] for w in _fetch(_client(RAJ), "GET", "/lumina/api/page-watch/watches").get_json()["watches"]] == [t["id"]]


def test_general_watches_are_private_to_their_maker():
    tid = watch_web.create(ANA, {"url": "https://example.com"})
    assert watch_store.get_target(tid)["space"] == "me:" + ANA
    ana_board = _data(_client(ANA).get("/strategic-agents/page-watch").get_data(as_text=True), "pw-data")["board"]
    assert [w["id"] for w in ana_board["watches"]] == [tid]
    raj = _client(RAJ)
    assert _data(raj.get("/strategic-agents/page-watch").get_data(as_text=True), "pw-data")["board"]["watches"] == []
    assert raj.get("/strategic-agents/page-watch/watches/%d" % tid).status_code == 404
    assert _fetch(raj, "GET", "/strategic-agents/page-watch/api/watches/%d" % tid).status_code == 404
    assert _fetch(raj, "PATCH", "/strategic-agents/page-watch/api/watches/%d" % tid, {"status": "paused"}).status_code == 404
    assert _fetch(_client(KRIS), "GET", "/strategic-agents/page-watch/api/watches/%d" % tid).status_code == 404, \
        "not even an admin reads someone's General work"


def test_general_lists_only_your_own_and_points_to_your_account_work():
    watch_web.create(ANA, {"url": "https://example.com"})
    in_acct = watch_web.create(ANA, {"url": "https://smilecare.in"}, space=_space("lumina"))
    html = _client(ANA).get("/strategic-agents/page-watch").get_data(as_text=True)
    ids = [w["id"] for w in _data(html, "pw-data")["board"]["watches"]]
    assert in_acct not in ids and len(ids) == 1
    assert 'class="ws-elsewhere' in html and 'href="/lumina/page-watch"' in html and "1 watch" in html
    r = _client(ANA).get("/strategic-agents/page-watch/watches/%d" % in_acct)
    assert r.status_code == 302 and r.headers["Location"].endswith("/lumina/page-watch/watches/%d" % in_acct)


def test_two_accounts_never_see_each_others_watches():
    lum = watch_web.create(ANA, {"url": "https://smilecare.in"}, space=_space("lumina"))
    blo = watch_web.create(ANA, {"url": "https://skinco.in"}, space=_space("bloom"))
    c = _client(RAJ)
    assert [w["id"] for w in _fetch(c, "GET", "/lumina/api/page-watch/watches").get_json()["watches"]] == [lum]
    assert [w["id"] for w in _fetch(c, "GET", "/bloom/api/page-watch/watches").get_json()["watches"]] == [blo]
    r = c.get("/bloom/page-watch/watches/%d" % lum)
    assert r.status_code == 302 and r.headers["Location"].endswith("/lumina/page-watch/watches/%d" % lum)
    cid = watch_store.add_change(lum, None, None, "major", "Prices went up", {})
    r = c.get("/bloom/page-watch/changes/%d" % cid)
    assert r.status_code == 302 and r.headers["Location"].endswith("/lumina/page-watch/changes/%d" % cid)
    bloom = appmod._acct_listing()["by_slug"]["bloom"]
    assert [e["href"] for e in account_history.entries(bloom)] == ["/bloom/page-watch/watches/%d" % blo]


def test_watches_from_before_spaces_move_to_their_account():
    old = watch_store.create_target(ANA, "https://smilecare.in", client="lumina smiles dental ")
    other = watch_store.create_target(ANA, "https://example.com", client="Someone Else")
    filed = watch_store.create_target(ANA, "https://x.in", client="Lumina Smiles Dental", space="me:" + ANA)
    appmod._acct_listing()
    assert watch_store.get_target(old)["space"] == _space("lumina")
    assert watch_store.get_target(other)["space"] == "", "no account by that name: it stays its owner's"
    assert watch_store.get_target(filed)["space"] == "me:" + ANA, "work filed on purpose never moves"
    ids = [w["id"] for w in _data(_client(ANA).get("/strategic-agents/page-watch").get_data(as_text=True),
                                  "pw-data")["board"]["watches"]]
    assert sorted(ids) == sorted([other, filed]), "earlier work with no account is the owner's General work"


# ── Video Studio ─────────────────────────────────────────────────────────────
def test_an_accounts_videos_are_the_whole_teams():
    pid = video_store.create_project(ANA, client="Lumina Smiles Dental", brief="Implants ad", space=_space("lumina"))
    mine = video_store.create_project(ANA, client="Lumina Smiles Dental", brief="Just mine", space="me:" + ANA)
    raj = _client(RAJ)
    lib = _data(raj.get("/lumina/video-studio").get_data(as_text=True), "vs-data")["library"]
    assert [(v["id"], v["by"], v["url"]) for v in lib] == [(pid, "Ana Mehta", "/lumina/video-studio/videos/%d" % pid)]
    assert raj.get("/lumina/video-studio/videos/%d" % pid).status_code == 200
    assert [v["id"] for v in raj.get("/strategic-agents/video-studio/api/library?account=lumina").get_json()["library"]] == [pid]
    assert raj.get("/strategic-agents/video-studio/videos/%d" % mine).status_code == 404
    r = raj.get("/strategic-agents/video-studio/videos/%d" % pid)
    assert r.status_code == 302 and r.headers["Location"].endswith("/lumina/video-studio/videos/%d" % pid)
    html = _client(ANA).get("/strategic-agents/video-studio").get_data(as_text=True)
    assert [v["id"] for v in _data(html, "vs-data")["library"]] == [mine]
    assert 'href="/lumina/video-studio"' in html


def test_a_video_started_inside_an_account_is_saved_to_it(monkeypatch):
    from tracker import video_app
    monkeypatch.setattr(video_app, "_can_plan", lambda email=None: None)   # no Claude key here
    body = {"brief": "A 20-second ad for our implants, ending on a call to action.", "kind": "custom",
            "shape": "vertical", "seconds": 20, "words": "write", "client": "Typed by hand"}
    r = _client(ANA).post("/strategic-agents/video-studio/api/videos", json=dict(body, account="lumina"))
    assert r.status_code == 200, r.get_json()
    p = video_store.get_project(r.get_json()["project"])
    assert p["space"] == _space("lumina") and p["client"] == "Lumina Smiles Dental"
    r = _client(ANA).post("/strategic-agents/video-studio/api/videos", json=body)
    assert video_store.get_project(r.get_json()["project"])["space"] == "me:" + ANA
    assert _client(ANA).post("/strategic-agents/video-studio/api/videos",
                             json=dict(body, account="no-such")).status_code == 400


def test_an_accounts_brand_is_the_teams():
    acct_p = {"email": ANA, "space": _space("lumina")}
    assert video_store.brand_owner(acct_p) == _space("lumina")
    assert video_store.brand_owner({"email": ANA, "space": "me:" + ANA}) == ANA
    video_store.save_brand(_space("lumina"), "Lumina Smiles Dental", {"accent": "#ffb800"})
    data = _data(_client(RAJ).get("/lumina/video-studio").get_data(as_text=True), "vs-data")
    assert [b["client"] for b in data["brands"]] == ["Lumina Smiles Dental"]
    assert _data(_client(RAJ).get("/strategic-agents/video-studio").get_data(as_text=True), "vs-data")["brands"] == []


def test_videos_from_before_spaces_move_with_their_saved_brand():
    pid = video_store.create_project(ANA, client="Lumina Smiles Dental", brief="old")
    video_store.save_brand(ANA, "Lumina Smiles Dental", {"accent": "#123456"})
    appmod._acct_listing()
    assert video_store.get_project(pid)["space"] == _space("lumina")
    assert (video_store.get_brand(_space("lumina"), "Lumina Smiles Dental") or {}).get("brand", {}).get("accent") == "#123456"


# ── History ──────────────────────────────────────────────────────────────────
def test_the_history_lists_everything_done_for_the_account_with_who():
    sp = _space("lumina")
    tid = watch_web.create(ANA, {"url": "https://smilecare.in/pricing", "name": "Smilecare pricing"}, space=sp)
    watch_store.add_change(tid, None, None, "major", "Prices went up", {})
    video_store.create_project(KRIS, client="Lumina Smiles Dental", brief="Implants ad", space=sp, status="active")
    gads_ai_store.create_review("Lumina Smiles Dental", RAJ)
    watch_web.create(ANA, {"url": "https://mine.in"})                                   # General: not listed
    watch_web.create(ANA, {"url": "https://skinco.in"}, space=_space("bloom"))         # another account's
    html = _client(ANA).get("/lumina").get_data(as_text=True)
    assert 'id="as-hist-h">History<' in html
    with appmod.app.test_request_context():
        rows = appmod._acct_history(appmod._acct_listing()["by_slug"]["lumina"])["rows"]
    got = {(r["tool"], r["kind"], r["by"]) for r in rows}
    assert got == {("page-watch", "watch", "Ana Mehta"), ("page-watch", "change", ""),
                   ("video-studio", "video", "Kris Ladha"), ("ai-review", "review", "Raj")}
    assert "mine.in" not in html and "skinco.in" not in html
    assert "Started watching Smilecare pricing" in html and ">Automatic<" in html
    assert [r["at"] for r in rows] == sorted((r["at"] for r in rows), reverse=True)


def test_the_history_is_staff_only():
    watch_web.create(ANA, {"url": "https://smilecare.in"}, space=_space("lumina"))
    post = _client(KRIS).post("/lumina/api/access", json={"who": "dr@luminasmiles.in"},
                              headers={"X-Requested-With": "fetch"})
    assert post.status_code == 200
    html = _client("dr@luminasmiles.in").get("/lumina").get_data(as_text=True)
    assert "as-hist" not in html and "Ana" not in html and "smilecare" not in html


def test_an_empty_history_says_what_will_appear():
    html = _client(ANA).get("/bloom").get_data(as_text=True)
    assert 'class="as-hist-empty"' in html and "with who made it" in html


# ── People ───────────────────────────────────────────────────────────────────
def test_a_signed_in_persons_name_is_kept_once_a_session():
    c = appmod.app.test_client()
    with c.session_transaction() as sess:
        sess["google_user"] = {"email": "Neha@markifydigital.com", "name": "Neha Rao"}
    c.get("/hub")
    assert people_store.names(["neha@markifydigital.com"]) == {"neha@markifydigital.com": "Neha Rao"}
    assert people_store.display("sam.k@x.com", {}) == "Sam", "no name stored: the address's name part"


def test_the_picker_calls_your_own_work_your_workspace():
    html = _client(ANA).get("/strategic-agents/page-watch").get_data(as_text=True)
    assert '<span class="ap-pill-t">Ana&#39;s Workspace</span>' in html
    js = open("static/js/account-picker.js", encoding="utf-8").read()
    assert "DATA.me" in js and "Only you see it" in js and '"General"' not in js
    assert appmod.my_workspace_name({"name": "Kris Ladha"}) == "Kris's Workspace"
    assert appmod.my_workspace_name({"given_name": "Krishna", "name": "Krishna L"}) == "Krishna's Workspace"
    assert appmod.my_workspace_name({"email": "sam.k@x.com"}) == "Sam's Workspace"
    assert appmod.my_workspace_name({}) == "Your Workspace"
