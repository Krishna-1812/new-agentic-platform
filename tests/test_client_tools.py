"""Clients using the tools their account shares with them (app.py: "A client using the tools...").

An invited client may open and run each tool the Share panel turns on, from inside the account, and
nothing else: no other tool, no admin's or test's routes. Everything they do is served under the
account's scope (tracker/workspace.py), so no id, header or address can reach another account's work,
or anyone's General work, and nothing they make is filed anywhere but the account. Each run they start
counts against the account's monthly limit.
"""

import json
import re

import pytest

import app as appmod
from tests import test_account_isolation as T
from tracker import account_history, client_accounts_store, lbr_store, seo_runs_store, watch_store, workspace

seeded = T.seeded
world = T.world
CLIENT = T.CLIENT
LBR = "/strategic-agents/local-business-radar"
PW = "/strategic-agents/page-watch"
VS = "/strategic-agents/video-studio"
XA = {"X-Account": "lumina"}
FETCH = {"X-Requested-With": "fetch"}


def _share(*tools, limit=None):
    T._invite("lumina", **{"tool:" + t: True for t in tools})
    if limit is not None:
        client_accounts_store.set_setting(T._acct("lumina")["key"], "runs_per_month", limit, "kris@markifydigital.com")


@pytest.fixture
def radar(monkeypatch):
    from tracker import lbr_config, lbr_intake, lbr_pipeline
    monkeypatch.setattr(lbr_config, "ready", lambda: True)
    monkeypatch.setattr(lbr_intake, "cached_plan", lambda *a, **k: {
        "business": {"input": "dentist", "label": "Dentists"}, "area": {"input": "Pune"}, "focus": "all", "cap": 40})
    monkeypatch.setattr(lbr_pipeline, "_spawn", lambda run_id: None)


# ── What a client is offered ─────────────────────────────────────────────────
def test_the_client_home_offers_only_the_shared_tools_with_runs_left(seeded):
    _share("local-business-radar", "keyword-research", limit=12)
    html = T._client(CLIENT).get("/lumina").get_data(as_text=True)
    assert "Your tools" in html and "12 runs left this month" in html
    assert 'href="/lumina/agents/local-business-radar"' in html and 'href="/lumina/operational-agents/keyword-research"' in html
    assert 'href="/lumina/agents/social-media-intelligence"' not in html and 'href="/lumina/operational-agents/on-page-audit"' not in html
    assert 'id="sh-dlg"' not in html, "no Share panel for a client"


def test_a_client_with_no_tools_shared_has_no_tools_section(seeded):
    T._invite("lumina")
    assert "Your tools" not in T._client(CLIENT).get("/lumina").get_data(as_text=True)


def test_shared_tool_pages_open_and_others_send_the_client_home(seeded):
    _share("local-business-radar", "page-watch")
    c = T._client(CLIENT)
    assert c.get("/lumina/agents/local-business-radar").status_code == 200
    assert c.get("/lumina/page-watch").status_code == 200
    for path in ("/lumina/agents/social-media-intelligence", "/lumina/video-studio", "/lumina/operational-agents/keyword-research"):
        r = c.get(path)
        assert r.status_code == 302 and r.headers["Location"].endswith("/lumina"), path
    assert c.get("/bloom/agents/local-business-radar").status_code == 403, "never another account's"


# ── Running a tool ───────────────────────────────────────────────────────────
def test_a_client_runs_the_radar_for_their_account_and_it_counts(seeded, radar):
    _share("local-business-radar", limit=1)
    c = T._client(CLIENT)
    r = c.post(LBR + "/run", json={"business_type": "dentist", "location": "Pune"}, headers=XA)
    assert r.status_code == 200, r.get_json()
    run = lbr_store.get_run(r.get_json()["run_id"])
    assert run["space"] == T._acct("lumina")["space"] and run["email"] == CLIENT
    assert client_accounts_store.runs_this_month(T._acct("lumina")["key"]) == 1
    r = c.post(LBR + "/run", json={"business_type": "dentist", "location": "Pune"}, headers=XA)
    assert r.status_code == 429 and "used up" in r.get_json()["error"], "the month's limit holds"
    assert T._client(T.RAJ).post(LBR + "/run", json={"business_type": "dentist", "location": "Pune"},
                                 headers=XA).status_code == 200, "staff are never limited"


def test_a_tool_not_shared_cannot_be_run_or_read(seeded, radar):
    _share("page-watch")
    c = T._client(CLIENT)
    r = c.post(LBR + "/run", json={"business_type": "dentist", "location": "Pune"}, headers=XA)
    assert r.status_code == 403
    assert c.get(LBR + "/runs", headers=XA).status_code == 403
    assert client_accounts_store.runs_this_month(T._acct("lumina")["key"]) == 0


def test_a_limit_of_zero_lets_them_look_but_not_start(seeded, radar):
    _share("local-business-radar", limit=0)
    c = T._client(CLIENT)
    assert c.get(LBR + "/runs", headers=XA).status_code == 200
    assert c.post(LBR + "/run", json={"business_type": "dentist", "location": "Pune"}, headers=XA).status_code == 429


def test_a_failed_start_does_not_count(seeded, monkeypatch):
    from tracker import lbr_config
    monkeypatch.setattr(lbr_config, "ready", lambda: False)
    _share("local-business-radar", limit=5)
    r = T._client(CLIENT).post(LBR + "/run", json={"business_type": "dentist", "location": "Pune"}, headers=XA)
    assert r.status_code >= 400
    assert client_accounts_store.runs_this_month(T._acct("lumina")["key"]) == 0


# ── Only their account ───────────────────────────────────────────────────────
def test_a_client_reads_only_their_accounts_radar_runs(seeded):
    _share("local-business-radar")
    c = T._client(CLIENT)
    runs = c.get(LBR + "/runs", headers=XA).get_json()["runs"]
    assert [x["id"] for x in runs] == [seeded["lumina-mark"]["lbr"]]
    assert c.get(LBR + "/runs/%d/status" % seeded["lumina-mark"]["lbr"], headers=XA).status_code == 200
    for mark in ("bloom-mark", "anas-own-mark", "rajs-own-mark", "legacy-mark"):
        rid = seeded[mark]["lbr"]
        for tail in ("status", "data", "report"):
            r = c.get(LBR + "/runs/%d/%s" % (rid, tail), headers=XA)
            assert r.status_code in (403, 404) or mark not in r.get_data(as_text=True).lower(), (mark, tail, r.status_code)
    assert c.get(LBR + "/runs", headers={"X-Account": "bloom"}).get_json()["runs"] == runs, \
        "naming another account changes nothing: they are not invited to it"


def test_a_client_uses_page_watch_in_their_account_only(seeded, monkeypatch):
    from tracker import watch_safety
    monkeypatch.setattr(watch_safety, "check", lambda url: None)      # no DNS in tests
    _share("page-watch")
    c = T._client(CLIENT)
    r = c.post("/lumina/api/page-watch/watches", json={"url": "https://competitor.example/prices"},
               headers=dict(FETCH, **XA))
    assert r.status_code in (200, 201), r.get_json()
    tid = r.get_json().get("id")
    t = watch_store.get_target(tid)
    assert t["space"] == T._acct("lumina")["space"] and t["email"] == CLIENT
    assert client_accounts_store.runs_this_month(T._acct("lumina")["key"]) == 1, "a new watch counts as a run"
    board = c.get("/lumina/api/page-watch/watches", headers=FETCH).get_data(as_text=True)
    assert "lumina-mark" in board and not T._foreign(board, "lumina-mark")
    for mark in ("bloom-mark", "anas-own-mark", "legacy-mark"):
        other = seeded[mark]["watch"]
        assert c.get(PW + "/api/watches/%d" % other, headers=XA).status_code == 404, mark
        assert c.post(PW + "/api/watches/%d/check" % other, json={}, headers=XA).status_code == 404, mark
        assert c.get("/lumina/page-watch/watches/%d" % other).status_code in (302, 404), mark
    assert c.get(PW + "/api/watches/%d" % seeded["lumina-mark"]["watch"], headers=XA).status_code == 200


def test_a_client_sees_only_their_accounts_videos(seeded):
    _share("video-studio")
    c = T._client(CLIENT)
    lib = c.get(VS + "/api/library?account=lumina", headers=XA).get_data(as_text=True)
    assert "lumina-mark" in lib and not T._foreign(lib, "lumina-mark")
    for mark in ("bloom-mark", "anas-own-mark", "legacy-mark"):
        assert c.get(VS + "/api/videos/%d" % seeded[mark]["video"], headers=XA).status_code in (403, 404), mark


def test_the_platforms_own_pages_and_tests_stay_closed(seeded):
    _share("page-watch", "video-studio", "local-business-radar")
    c = T._client(CLIENT)
    for method, path in (("GET", LBR + "/selftest"), ("GET", LBR + "/readiness"), ("GET", PW + "/health"),
                         ("POST", VS + "/api/drills"), ("GET", VS + "/api/plan-tests"), ("POST", VS + "/api/brands"),
                         ("GET", VS + "/engine"), ("POST", PW + "/api/watches"), ("GET", "/admin/client-usage")):
        r = c.open(path, method=method, json={}, headers=XA)
        assert r.status_code in (302, 403, 404, 405), (method, path, r.status_code)
        assert r.status_code != 302 or "/lumina" in r.headers["Location"], (path, r.headers.get("Location"))


# ── SEO & AEO ────────────────────────────────────────────────────────────────
def test_a_client_gets_a_studio_pass_for_their_account_and_shared_tools_only(seeded, monkeypatch):
    monkeypatch.setattr(appmod, "SEO_STUDIO_SECRET", "s3cret")
    _share("keyword-research", "seo-geo-audit")
    html = T._client(CLIENT).get("/lumina/operational-agents/keyword-research").get_data(as_text=True)
    import base64
    import re
    from urllib.parse import parse_qs, urlsplit
    src = re.search(r'src="([^"]+)"[^>]*id="embed-frame"|id="embed-frame"[^>]*src="([^"]+)"', html)
    token = parse_qs(urlsplit((src.group(1) or src.group(2)).replace("&amp;", "&")).query)["st"][0]
    body = token.split(".")[0]
    p = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    assert p["r"] == "client" and p["s"] == T._acct("lumina")["space"] and p["t"] == ["keyword-research", "seo-geo-audit"]


def test_a_used_up_month_stops_the_studio_opening(seeded):
    _share("keyword-research", limit=0)
    r = T._client(CLIENT).get("/lumina/operational-agents/keyword-research")
    assert r.status_code == 429 and "runs are used up" in r.get_data(as_text=True)


def test_a_clients_finished_seo_run_is_saved_to_the_account_and_counts(seeded):
    _share("keyword-research")
    c = T._client(CLIENT)
    r = c.post("/api/seo-runs", json={"tool": "keyword-research", "payload": {"keyword": "implants", "primary": []}},
               headers=dict(FETCH, **XA))
    assert r.status_code == 201, r.get_json()
    run = seo_runs_store.get(r.get_json()["id"], "kris@markifydigital.com")
    assert run["space"] == T._acct("lumina")["space"] and run["email"] == CLIENT
    assert client_accounts_store.runs_this_month(T._acct("lumina")["key"]) == 1
    assert c.post("/api/seo-runs", json={"tool": "on-page-audit", "payload": {}}, headers=dict(FETCH, **XA)).status_code == 403
    assert c.get("/lumina/operational-agents/runs/%d" % r.get_json()["id"]).status_code == 200
    other = seeded["bloom-mark"]["seo"]
    assert c.get("/lumina/operational-agents/runs/%d" % other).status_code in (302, 404)
    assert c.get("/lumina/operational-agents/runs/%d.json" % seeded["anas-own-mark"]["seo"]).status_code in (302, 404)


# ── The scope itself ─────────────────────────────────────────────────────────
def test_under_a_client_scope_nothing_can_be_filed_as_general_work():
    with workspace.client_scope("acct:7"):
        with pytest.raises(workspace.OutOfScope):
            workspace.personal("a@b.c")
        assert workspace.personal_spaces("a@b.c") == ()
        assert workspace.seen_sql() == "(%s IS NOT NULL AND space = 'acct:7')"
        assert workspace.list_sql("a@b.c") == ("space = %s", ["acct:7"])
        with pytest.raises(workspace.OutOfScope):
            workspace.list_sql("a@b.c", "acct:8")
        assert workspace.mem_seen({"space": "acct:7", "email": "x"}, "a@b.c")
        assert not workspace.mem_seen({"space": "acct:8", "email": "a@b.c"}, "a@b.c")
        assert not workspace.mem_seen({"space": "me:a@b.c", "email": "a@b.c"}, "a@b.c")
    assert workspace.scope() is None and workspace.personal("a@b.c") == "me:a@b.c"
    with pytest.raises(ValueError):
        workspace.set_scope("acct:7' OR 1=1 --")


def test_the_scope_ends_with_the_request(seeded):
    _share("local-business-radar")
    T._client(CLIENT).get(LBR + "/runs", headers=XA)
    assert workspace.scope() is None
    staff = T._client(T.RAJ).get(LBR + "/runs").get_json()["runs"]
    assert [x["id"] for x in staff] == [seeded["rajs-own-mark"]["lbr"], seeded["legacy-mark"]["lbr"]] or \
        {x["id"] for x in staff} == {seeded["rajs-own-mark"]["lbr"], seeded["legacy-mark"]["lbr"]}


# ── The sweep, for a client with every tool ─────────────────────────────────
def test_a_client_with_every_tool_reaches_nothing_outside_their_account(seeded):
    T._invite("lumina", **{"tool:" + t["slug"]: True for t in appmod._acct_tool_catalog()})
    c = T._client(CLIENT)
    ids = {k: [seeded[m][k] for m in T.MARKS[1:] if k in seeded[m]] for k in ("watch", "change", "video", "seo", "lbr")}
    urls = ["/lumina", "/lumina/page-watch", "/lumina/video-studio", LBR + "/runs", "/lumina/api/page-watch/watches",
            VS + "/api/library", "/strategic-agents/company-people-intelligence/history",
            "/strategic-agents/event-conference-intelligence/profiles"]
    urls += [account_history.agent_href("lumina", a[0]) for a in appmod.ACCT_AGENTS]
    urls += ["/lumina/page-watch/watches/%d" % i for i in ids["watch"]]
    urls += ["/lumina/page-watch/changes/%d" % i for i in ids["change"]]
    urls += [PW + "/api/watches/%d" % i for i in ids["watch"]] + [PW + "/api/watches/%d/preview" % i for i in ids["watch"]]
    urls += ["/lumina/video-studio/videos/%d" % i for i in ids["video"]] + [VS + "/api/videos/%d" % i for i in ids["video"]]
    urls += ["/lumina/operational-agents/runs/%d" % i for i in ids["seo"]] + ["/lumina/operational-agents/runs/%d.json" % i for i in ids["seo"]]
    urls += [LBR + "/runs/%d/%s" % (i, t) for i in ids["lbr"] for t in ("status", "data", "report", "export.csv")]
    for url in urls:
        r = c.get(url, headers=XA)
        body = r.get_data(as_text=True)
        assert r.status_code in (200, 302, 403, 404), (url, r.status_code)
        assert not T._foreign(body, "lumina-mark"), (url, T._foreign(body, "lumina-mark"))
    assert "lumina-mark" in c.get("/lumina/page-watch").get_data(as_text=True), "the sweep would prove nothing otherwise"


# ── What a client is never shown ─────────────────────────────────────────────
def test_a_client_never_sees_what_a_run_cost(seeded):
    lbr_store.update_run(seeded["lumina-mark"]["lbr"], cost={"usd": 1.84, "lines": [{"usd": 1.0}]})
    _share("local-business-radar")
    runs = T._client(CLIENT).get(LBR + "/runs", headers=XA).get_json()["runs"]
    assert runs and "cost" not in json.dumps(runs) and "1.84" not in json.dumps(runs)
    staff = T._client(T.RAJ).get(LBR + "/runs", headers=XA).get_json()["runs"]
    assert "1.84" in json.dumps(staff), "staff still see it"
    page = T._client(CLIENT).get("/lumina/agents/local-business-radar").get_data(as_text=True)
    assert ".lbr-plan-cost > :not(.lbr-start)" in page and "$1.84" not in page
    assert ".lbr-plan-cost > :not(.lbr-start)" not in T._client(T.RAJ).get("/lumina/agents/local-business-radar").get_data(as_text=True)
    assert appmod._client_scrub({"a": [{"cost_usd": 2, "keep": 1}], "credits_spent": 4}) == {"a": [{"keep": 1}]}


def test_page_watch_shows_a_client_their_runs_left_not_our_spend(seeded):
    _share("page-watch", limit=9)
    html = T._client(CLIENT).get("/lumina/page-watch").get_data(as_text=True)
    assert "Runs left this month" in html and "Claude this month" not in html
    assert "Claude this month" in T._client(T.RAJ).get("/lumina/page-watch").get_data(as_text=True)


# ── Every tool the Share panel turns on reaches the client ─────────────────────
def test_page_watch_and_video_studio_are_offered_as_tools_even_alone(seeded):
    """Shared on their own, they used to leave the client's home with no "Your tools" at all: only
    the agents' and SEO tools' cards were built for a client, so the two looked unshared."""
    _share("page-watch", "video-studio")
    html = T._client(CLIENT).get("/lumina").get_data(as_text=True)
    assert "Your tools" in html and "Watch &amp; make" in html
    assert 'class="rx-ag rx-ag--page-watch" href="/lumina/page-watch"' in html
    assert 'class="rx-ag rx-ag--video-studio" href="/lumina/video-studio"' in html


def test_page_watch_alone_is_offered_without_video_studio(seeded):
    _share("page-watch")
    html = T._client(CLIENT).get("/lumina").get_data(as_text=True)
    assert 'href="/lumina/page-watch"' in html and "rx-ag--video-studio" not in html


def test_every_tool_the_share_panel_can_turn_on_shows_on_the_home_and_opens(seeded):
    catalog = appmod._acct_tool_catalog()
    _share(*[t["slug"] for t in catalog])
    c = T._client(CLIENT)
    home = c.get("/lumina").get_data(as_text=True)
    for t in catalog:
        s = t["slug"]
        path = "/lumina/" + s if s in ("page-watch", "video-studio") else \
            "/lumina/operational-agents/" + s if s in dict(appmod.ACCT_SEO) else account_history.agent_href("lumina", s)
        assert 'href="%s"' % path in home, "%s is shared but not offered" % s
        assert c.get(path).status_code == 200, s


def test_the_two_tools_pages_name_their_account_on_every_call(seeded):
    _share("page-watch", "video-studio")
    c = T._client(CLIENT)
    for path in ("/lumina/page-watch", "/lumina/video-studio",
                 "/lumina/page-watch/watches/%d" % seeded["lumina-mark"]["watch"]):
        html = c.get(path).get_data(as_text=True)
        assert 'js/account-context.js?v=1" data-acct="lumina"' in html, path


def test_a_client_without_a_referer_still_reaches_the_shared_tools(seeded):
    """Browsers that strip the Referer: the X-Account header the page now sends is enough."""
    _share("page-watch", "video-studio")
    c = T._client(CLIENT)
    assert c.get(PW + "/api/watches/%d" % seeded["lumina-mark"]["watch"], headers=XA).status_code == 200
    lib = c.get(VS + "/api/library?account=lumina", headers=XA)
    assert lib.status_code == 200 and "lumina-mark" in lib.get_data(as_text=True)


# ── Every tool an admin can share, a client can open and use ──────────────────
def _tool_page(slug):
    return "/lumina/" + slug if slug in ("page-watch", "video-studio") else \
        "/lumina/operational-agents/" + slug if slug in dict(appmod.ACCT_SEO) else account_history.agent_href("lumina", slug)


def test_an_admin_shares_every_tool_from_the_share_panel_and_the_client_gets_each(seeded):
    """Page Watch and Video Studio once looked shared in the panel and never reached the client."""
    admin = T._client(sorted(appmod.ADMIN_EMAILS)[0])
    assert admin.post("/lumina/api/access", json={"who": CLIENT}, headers=FETCH).status_code == 200
    catalog = appmod._acct_tool_catalog()
    for t in catalog:
        r = admin.post("/lumina/api/access/share", json={"share": "tool:" + t["slug"], "on": True}, headers=FETCH)
        assert r.status_code == 200, (t["slug"], r.get_json())
        assert next(x for x in r.get_json()["tools"] if x["slug"] == t["slug"])["on"], t["slug"]
    c = T._client(CLIENT)
    home = c.get("/lumina").get_data(as_text=True)
    for t in catalog:
        assert 'href="%s"' % _tool_page(t["slug"]) in home, "%s is shared but not on the client's home" % t["slug"]
        assert c.get(_tool_page(t["slug"])).status_code == 200, t["slug"]


def test_every_link_on_a_shared_tools_page_stays_open_to_the_client(seeded):
    """A link a client follows from a tool they were given must not send them back home (the agents
    page in the breadcrumb, the team's saved brands, the radar's connection check did)."""
    catalog = appmod._acct_tool_catalog()
    _share(*[t["slug"] for t in catalog])
    c = T._client(CLIENT)
    bad = []
    pages = ["/lumina"] + [_tool_page(t["slug"]) for t in catalog]
    pages.append(LBR + "/runs/%d/report" % seeded["lumina-mark"]["lbr"])        # a page opened from a tool
    pages.append("/lumina/agents/market-radar/report/4")
    for page in pages:
        r = c.get(page, headers={"Referer": "http://localhost/lumina/agents/local-business-radar"})
        assert r.status_code == 200, (page, r.status_code)
        html = r.get_data(as_text=True)
        for href in sorted(set(re.findall(r'href="(/[^"#]*)', html))):
            if href.startswith(("/static/", "/logout", "/auth")):
                continue
            r = c.get(href.replace("&amp;", "&"), headers={"Referer": "http://localhost" + page})
            loc = r.headers.get("Location", "")
            if r.status_code >= 400 or (300 <= r.status_code < 400 and loc.rstrip("/").endswith("/lumina")):
                bad.append((page, href, r.status_code))
    assert not bad, bad
    staff = T._client(T.RAJ).get("/lumina/video-studio").get_data(as_text=True)
    assert 'href="/strategic-agents/video-studio/brands"' in staff and 'href="/strategic-agents"' in staff, \
        "staff keep their links"


# Routes of a shareable tool that its clients never reach, and why. Every other route under a tool's
# address must be open to the clients it is shared with, so a new route cannot be left out by mistake.
TEAM_ONLY = {
    "/strategic-agents/page-watch/api/status": "the workers' state, for the team",
    "/strategic-agents/page-watch/health": "the workers' health, for the team",
    "/strategic-agents/page-watch/api/watches": "inside an account it is /<account>/api/page-watch/watches",
    "/strategic-agents/page-watch/changes/<int:change_id>": "inside an account it is /<account>/page-watch/changes/<id>",
    "/strategic-agents/page-watch/watches/<int:target_id>": "inside an account it is /<account>/page-watch/watches/<id>",
    "/strategic-agents/video-studio/videos/<int:project_id>": "inside an account it is /<account>/video-studio/videos/<id>",
    "/strategic-agents/video-studio/brands": "every client's saved brands",
    "/strategic-agents/video-studio/api/brands": "every client's saved brands",
    "/strategic-agents/video-studio/engine": "the render engine's tests",
    "/strategic-agents/video-studio/plans": "the planner's tests",
    "/strategic-agents/video-studio/api/drills": "the team's drills",
    "/strategic-agents/video-studio/api/engine-tests": "the render engine's tests",
    "/strategic-agents/video-studio/api/plan-tests": "the planner's tests",
    "/strategic-agents/video-studio/api/plan-tests/<int:version_id>/review": "the planner's tests",
    "/strategic-agents/video-studio/api/plan-tests/build": "the planner's tests",
    "/strategic-agents/video-studio/api/plan-tests/export": "the planner's tests",
    "/strategic-agents/people-signals/api/runs/<int:run_id>/delete": "removing a run from the shared list is the team's",
    "/strategic-agents/local-business-radar/readiness": "which paid services are connected",
    "/strategic-agents/local-business-radar/selftest": "the connection check",
    "/strategic-agents/market-radar/api/clients/<int:client_id>/update-now": "sends the weekly email",
    "/strategic-agents/market-radar/api/cost-report": "what runs cost the agency",
    "/strategic-agents/market-radar/api/tidy-events": "a one-off tidy for the team",
    "/strategic-agents/market-radar/api/tidy-suggestions": "a one-off tidy for the team",
    "/strategic-agents/market-radar/report/<int:client_id>": "inside an account it is /<account>/agents/market-radar/report/<id>",
    "/strategic-agents/people-signals/api/runs/<int:run_id>/reveal": "spends the agency's Saleshandy credits",
    "/strategic-agents/buyer-radar/api/settings": "what to search, the caps and automatic sending are the team's",
    "/strategic-agents/buyer-radar/api/leads/<int:lead_id>/send": "writes to people for the agency",
    "/strategic-agents/buyer-radar/api/leads/<int:lead_id>/find-email": "spends the agency's Saleshandy credits",
    "/strategic-agents/buyer-radar/api/leads/<int:lead_id>/sequence": "writes to people for the agency",
    "/strategic-agents/buyer-radar/api/sequences": "the agency's Saleshandy sequences",
    "/strategic-agents/buyer-radar/api/icps/suggest": "the customer profiles are the team's settings",
    "/strategic-agents/buyer-radar/api/sheet": "the Google Sheet is the team's setting, and holds the drafted messages",
    "/strategic-agents/buyer-radar/api/runs/<int:run_id>/slack": "posts to the agency's Slack channel",
}


def test_every_route_of_a_shareable_tool_is_open_to_its_clients_or_named_team_only():
    seen = set()
    for t in appmod._acct_tool_catalog():
        if t["group"] == "seo":
            continue
        prefix = "/strategic-agents/%s/" % t["slug"]
        for rule in appmod.app.url_map.iter_rules():
            if not rule.rule.startswith(prefix):
                continue
            sample = re.sub(r"<[^>]+>", "x", re.sub(r"<int:[^>]+>", "7", rule.rule))
            if rule.rule in TEAM_ONLY:
                seen.add(rule.rule)
                assert appmod._client_route_tool(sample) is None, "%s is team only but open to clients" % rule.rule
            else:
                assert appmod._client_route_tool(sample) == t["slug"], (
                    "%s: a client the account shares %s with cannot reach it. Add it to CLIENT_TOOL_ROUTES "
                    "(app.py), or to TEAM_ONLY here with why" % (rule.rule, t["slug"]))
    assert seen == set(TEAM_ONLY), "a team-only route that no longer exists: %s" % sorted(set(TEAM_ONLY) - seen)
