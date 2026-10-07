"""Account memory, phase 5: the isolation sweep (docs/account-memory-plan.md).

Every tool's work is seeded in two client accounts, in two people's General spaces and as older
unassigned work, each carrying its own marker. Then every page and API an account has (read from the
app's own routes, so a new one cannot be missed) is opened for one account, by a staff member, with
that account's ids and with everyone else's. Nothing from the other account, or from anyone's General
work, may show. The same holds for the AI's brief of each account, and for what a client sees.
"""

import re

import pytest

import app as appmod
from tracker import (account_brief, account_history, client_accounts_store, gads_ai_store, lbr_store, people_store,
                     seo_runs_store, video_store, watch_store, workspace)

ANA = "ana@markifydigital.com"
RAJ = "raj@markifydigital.com"
CLIENT = "owner@luminasmiles.in"
STORES = (client_accounts_store, watch_store, video_store, gads_ai_store, people_store, lbr_store, seo_runs_store)
ADS = {"lumina": "Lumina Smiles Dental", "bloom": "Bloom Skin Clinic"}


def _p(text):
    return {"paragraph": {"elements": [{"textRun": {"content": text + "\n"}}],
                          "paragraphStyle": {"namedStyleType": "NORMAL_TEXT"}}}


def _tab(title, lines):
    return {"tabProperties": {"title": title}, "documentTab": {"body": {"content": [_p(x) for x in lines]}}}


DOC = {"title": "Master", "tabs": [
    _tab("Lumina Smiles Dental", ["URL name: lumina", "Website: luminasmiles.in", "Industry: Dental clinic"]),
    _tab("Bloom Skin Clinic", ["URL name: bloom", "Website: bloomskin.in", "Industry: Skin clinic"]),
]}


def _row(account, cid, day):
    return {"account": account, "customer_id": cid, "campaign": "Search", "state": "Enabled", "type": "Search",
            "day": day, "clicks": 10.0, "impressions": 100.0, "cost": 100.0, "currency": "INR", "conversions": 1.0,
            "view_through": 0.0, "top_pct": 0.0, "abs_top_pct": 0.0, "cost_native": 100.0, "currency_native": "INR"}


ROWS = [_row(a, c, "2026-09-%02d" % d) for a, c in ((ADS["lumina"], "412-118-3390"), (ADS["bloom"], "512-118-3390"))
        for d in range(1, 31)]


@pytest.fixture(autouse=True)
def world(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    for s in STORES:
        s.reset_memory()
    appmod._acct_reset()
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: ROWS)
    monkeypatch.setattr(appmod, "_acct_doc", lambda: (DOC, "https://docs.google.com/document/d/x/edit", None))
    people_store.remember(ANA, "Ana Mehta")
    people_store.remember(RAJ, "Raj Kulkarni")
    yield
    for s in STORES:
        s.reset_memory()
    appmod._acct_reset()


def _client(email):
    c = appmod.app.test_client()
    with c.session_transaction() as sess:
        sess["google_user"] = {"email": email, "name": email.split("@")[0].title()}
        sess["people_seen"] = True
    return c


def _acct(slug):
    return appmod._acct_listing()["by_slug"][slug]


def _seed(space, mark, email, ads=None):
    """One of everything, in one space, every text carrying `mark`. Returns the ids, by kind."""
    t = watch_store.create_target(email, "https://%s.example/pricing" % mark, space=space, name="%s pricing" % mark)
    c = watch_store.add_change(t, None, None, "major", "%s prices went up" % mark, {})
    watch_store.update_change(c, verdict={"summary": "%s raised prices" % mark, "importance": "important"})
    p = video_store.create_project(email, client=mark, brief="%s launch video" % mark, kind="launch", space=space)
    v = video_store.create_version(p, plan={"idea": "%s idea" % mark})
    video_store.update_version(v, status="ready")
    s = seo_runs_store.add(email, space, "seo-geo-audit", "https://%s.example" % mark,
                           {"facts": [["Overall score", 70]], "highlights": ["%s: add FAQ schema" % mark]},
                           {"url": "https://%s.example" % mark}, {"x": mark})
    r = lbr_store.create_run(email, "%s dentists" % mark, "Pune", "all", 40, space=space)
    lbr_store.update_run(r, status="complete", plan={"business": {"label": "%s dentists" % mark},
                                                     "area": {"formatted": "Pune"}}, summary={"found": 12})
    ids = {"watch": t, "change": c, "video": p, "seo": s, "lbr": r}
    if ads:
        rid = gads_ai_store.create_review(ads, email)
        gads_ai_store.update_review(rid, status="complete", period_from="2026-09-01", period_to="2026-09-30",
                                    report={"headline": "%s headline" % mark, "overall": "on_track",
                                            "actions": [{"priority": "P1", "title": "%s action" % mark}]})
        ids["review"] = rid
    return ids


MARKS = ("lumina-mark", "bloom-mark", "anas-own-mark", "rajs-own-mark", "legacy-mark")


@pytest.fixture
def seeded():
    out = {"lumina-mark": _seed(_acct("lumina")["space"], "lumina-mark", ANA, ADS["lumina"]),
           "bloom-mark": _seed(_acct("bloom")["space"], "bloom-mark", RAJ, ADS["bloom"]),
           "anas-own-mark": _seed(workspace.personal(ANA), "anas-own-mark", ANA),
           "rajs-own-mark": _seed(workspace.personal(RAJ), "rajs-own-mark", RAJ),
           "legacy-mark": _seed("", "legacy-mark", RAJ)}
    return out


# ── Every account page and API ───────────────────────────────────────────────
INT_ROUTES = {           # an account route that takes an id -> the kind of id it takes
    "/<acct:slug>/page-watch/changes/<int:change_id>": "change",
    "/<acct:slug>/page-watch/watches/<int:target_id>": "watch",
    "/<acct:slug>/seo-aeo/runs/<int:run_id>": "seo",
    "/<acct:slug>/seo-aeo/runs/<int:run_id>.json": "seo",
    "/<acct:slug>/video-studio/videos/<int:project_id>": "video",
    "/<acct:slug>/api/ai-review/reviews/<int:review_id>": "review",
}


def _urls(slug):
    """Every GET an account has, as (route, url), its slugged routes expanded."""
    out = []
    for rule in appmod.app.url_map.iter_rules():
        if not rule.rule.startswith("/<acct:slug>") or "GET" not in rule.methods or rule.rule in INT_ROUTES:
            continue
        path = rule.rule.replace("<acct:slug>", slug)
        if "<agent_slug>" in path:
            out += [(rule.rule, path.replace("<agent_slug>", a[0])) for a in appmod.ACCT_AGENTS]
        elif "<tool_slug>" in path:
            out += [(rule.rule, path.replace("<tool_slug>", t)) for t, _ in appmod.ACCT_SEO]
        else:
            assert "<" not in path, "a new account route takes %s: add it to the sweep" % rule.rule
            out.append((rule.rule, path + ("?account=" + ADS[slug] if path.endswith("/reviews") else "")))
    return out


def _foreign(body, own):
    text = body.lower()
    return [m for m in MARKS if m != own and m in text]


def test_every_account_page_and_api_shows_only_that_accounts_work(seeded):
    staff = _client(RAJ)        # Raj made Bloom's work and has General work of his own: neither may show
    seen = set()
    for route, url in _urls("lumina"):
        r = staff.get(url)
        seen.add(route)
        assert r.status_code in (200, 302, 403), (url, r.status_code)
        assert not _foreign(r.get_data(as_text=True), "lumina-mark"), (url, _foreign(r.get_data(as_text=True), ""))
    home = staff.get("/lumina").get_data(as_text=True)
    assert "lumina-mark" in home, "the sweep would prove nothing if the account's own work did not show"
    for route, kind in INT_ROUTES.items():
        own = seeded["lumina-mark"][kind]
        r = staff.get(route.replace("<acct:slug>", "lumina").replace(re.search(r"<int:\w+>", route).group(0), str(own)))
        assert r.status_code == 200, (route, r.status_code)
        for mark in MARKS[1:]:
            other = seeded[mark].get(kind)
            if other is None:
                continue
            url = route.replace("<acct:slug>", "lumina").replace(re.search(r"<int:\w+>", route).group(0), str(other))
            r = staff.get(url)
            assert r.status_code != 200 or not _foreign(r.get_data(as_text=True), "lumina-mark"), (url, mark)
            if r.status_code == 302:
                assert "/lumina/" not in r.headers["Location"], (url, "never kept inside another account")
        seen.add(route)
    every = {r.rule for r in appmod.app.url_map.iter_rules() if r.rule.startswith("/<acct:slug>") and "GET" in r.methods}
    assert every <= seen, "account routes the sweep did not open: %s" % sorted(every - seen)


def test_the_agents_lists_inside_an_account_hold_only_its_runs(seeded):
    runs = _client(RAJ).get("/strategic-agents/local-business-radar/runs", headers={"X-Account": "lumina"}).get_json()["runs"]
    assert [r["id"] for r in runs] == [seeded["lumina-mark"]["lbr"]]
    mine = _client(RAJ).get("/strategic-agents/local-business-radar/runs").get_json()["runs"]
    assert {r["id"] for r in mine} == {seeded["rajs-own-mark"]["lbr"], seeded["legacy-mark"]["lbr"]}, \
        "General: Raj's own, older unassigned work included, and nobody else's"


def test_general_work_is_its_makers_only(seeded):
    for mark, owner, other in (("anas-own-mark", ANA, RAJ), ("rajs-own-mark", RAJ, ANA)):
        ids = seeded[mark]
        assert _client(other).get("/seo-aeo/runs/%d" % ids["seo"]).status_code == 404
        assert _client(owner).get("/seo-aeo/runs/%d" % ids["seo"]).status_code == 200
        assert watch_store.get_target(ids["watch"], other) is None and video_store.get_project(ids["video"], other) is None
        assert lbr_store.get_run(ids["lbr"], other) is None


# ── The AI's brief of each account ───────────────────────────────────────────
@pytest.mark.parametrize("slug, mark", [("lumina", "lumina-mark"), ("bloom", "bloom-mark")])
def test_each_accounts_brief_holds_its_own_work_only(seeded, slug, mark):
    acct = _acct(slug)
    text = account_brief.build(acct["space"], acct["ads_names"])["text"].lower()
    for kind in ("%s raised prices", "%s launch video", "%s: add faq schema", "%s dentists", "%s action"):
        assert kind % mark in text
    assert not _foreign(text, mark)
    assert appmod._gads_ai_memory(ADS[slug], 0)["text"] == account_brief.build(acct["space"], acct["ads_names"])["text"]


# ── What a client sees ───────────────────────────────────────────────────────
ALL_TOOLS = {"tool:page-watch": True, "tool:video-studio": True, "tool:local-business-radar": True,
             "tool:seo-geo-audit": True}


def _invite(slug, who=CLIENT, **shares):
    key = _acct(slug)["key"]
    client_accounts_store.add_access(key, who, "kris@markifydigital.com")
    for share, on in shares.items():
        client_accounts_store.set_share(key, share, on, "kris@markifydigital.com")


def test_a_client_sees_no_history_unless_the_account_shares_it(seeded):
    _invite("lumina")
    html = _client(CLIENT).get("/lumina").get_data(as_text=True)
    assert 'id="history"' not in html and "lumina-mark" not in html


def test_a_shared_history_is_finished_work_without_names_or_links(seeded):
    unfinished = lbr_store.create_run(ANA, "lumina-mark running", "Pune", "all", 40, space=_acct("lumina")["space"])
    _invite("lumina", **ALL_TOOLS)
    c = _client(CLIENT)
    html = c.get("/lumina").get_data(as_text=True)
    hist = html[html.index('id="history"'):]
    hist = hist[:hist.index("</section>")]
    assert "What we have done" in hist
    for want in ("lumina-mark pricing", "lumina-mark raised prices", "lumina-mark launch video", "https://lumina-mark.example",
                 "lumina-mark dentists"):
        assert want in hist, want
    assert not _foreign(hist, "lumina-mark")
    assert "Ana Mehta" not in hist and "Raj Kulkarni" not in hist and "data-hist-who" not in hist, "no names"
    links = re.findall(r'<a class="as-ev-main" href="([^"]+)"', hist)
    assert links and all(h.startswith("/lumina/") for h in links), "links only into their own account's tools"
    assert "lumina-mark running" not in hist and "AI review of" not in hist, "finished work; reviews only when shared"
    assert unfinished
    _invite("lumina", **{"ai-review": True})
    hist = c.get("/lumina").get_data(as_text=True)
    assert "AI review of Lumina Smiles Dental" in hist and 'href="/lumina/google-ads/ai-review"' in hist



def test_a_client_sees_only_the_history_of_the_tools_shared_with_them(seeded):
    _invite("lumina", **{"tool:page-watch": True})
    hist = _client(CLIENT).get("/lumina").get_data(as_text=True)
    hist = hist[hist.index('id="history"'):]
    hist = hist[:hist.index("</section>")]
    assert "lumina-mark pricing" in hist and "lumina-mark raised prices" in hist, "Page Watch is shared"
    for hidden in ("lumina-mark launch video", "lumina-mark dentists", "https://lumina-mark.example"):
        assert hidden not in hist, "%s: its tool is not shared" % hidden
    assert 'data-hist-tool="agents"' not in hist and 'data-hist-tool="seo"' not in hist
    _invite("lumina", **{"tool:page-watch": False, "tool:local-business-radar": True})
    hist = _client(CLIENT).get("/lumina").get_data(as_text=True)
    assert "lumina-mark dentists" in hist and "lumina-mark raised prices" not in hist


def test_contact_finder_rows_are_a_clients_only_when_it_is_shared():
    acct = {"slug": "lumina", "space": workspace.account(1)}
    row = account_history.agent_entry(acct, "company-people-intelligence", "Priya Shah, CMO", "", ANA,
                                      "2026-10-01T00:00:00+00:00", "complete")
    smi = account_history.agent_entry(acct, "social-media-intelligence", "Lumina", "", ANA,
                                      "2026-10-01T00:00:00+00:00", "complete")
    assert [r["title"] for r in account_history.for_client([row, smi], "lumina", tools={"social-media-intelligence"})] \
        == ["Lumina"]
    assert len(account_history.for_client([row, smi], "lumina", tools={"company-people-intelligence",
                                                                       "social-media-intelligence"})) == 2


def test_the_staff_history_says_whether_the_client_sees_it(seeded):
    staff = _client(RAJ)
    assert "the client does not" in staff.get("/lumina").get_data(as_text=True)
    _invite("lumina", **{"tool:page-watch": True})
    appmod._acct_reset()
    assert "the client sees the finished work of the tools shared with them, without names" in staff.get("/lumina").get_data(as_text=True)


def test_the_history_filter_offers_search_people_and_automatic(seeded):
    html = _client(RAJ).get("/lumina").get_data(as_text=True)
    assert "data-hist-q" in html and "data-hist-more" in html
    assert '<option value="Ana Mehta">' in html and '<option value="~auto">Automatic</option>' in html
    js = open("static/js/account-space.js", encoding="utf-8").read()
    assert "h_tool" in js and "h_by" in js and "h_q" in js and "~auto" in js and "innerHTML" not in js


def test_the_history_is_a_coloured_timeline_with_the_mix_and_the_team(seeded):
    html = _client(RAJ).get("/lumina").get_data(as_text=True)
    hist = html[html.index('id="history"'):]
    assert 'class="hx-mix"' in hist and "hx-seg--seo" in hist and "hx-seg--page-watch" in hist
    assert 'class="hx-team"' in hist and "worked on it" in hist
    assert 'class="hx-go"' in hist, "an entry that opens somewhere shows its arrow"
    css = open("static/css/account-space.css", encoding="utf-8").read()
    for tool in account_history.TOOLS:
        assert '.as-ev[data-tool="%s"]' % tool in css, "every tool has its colour on the timeline: %s" % tool
    _invite("lumina", **ALL_TOOLS)
    client = _client(CLIENT).get("/lumina").get_data(as_text=True)
    assert 'class="hx-mix"' in client and 'class="hx-team"' not in client, "the client sees the mix, never the team"
