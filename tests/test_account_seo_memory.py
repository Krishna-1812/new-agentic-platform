"""Account memory, phase 3: the SEO & AEO tools (docs/account-memory-plan.md).

SEO Studio is opened with a signed pass; inside a client account the pass names the account's space,
so the studio files what it saves there (seo-apps/server/utils/space.js, tested by its own
utils/__tests__/space.test.js). When a tool finishes, the page around it (templates/embed.html) hands
the result to POST /api/seo-runs: the run is kept for the account (the whole team's) or as the
person's General work, with a few readable facts (tracker/seo_runs.py), its own page and a download,
and it joins the account's History.
"""

import base64
import hashlib
import hmac
import json
import re
from urllib.parse import parse_qs, urlsplit

import pytest

import app as appmod
from tracker import (client_accounts_store, gads_ai_store, lbr_store, people_store, seo_runs, seo_runs_store,
                     video_store, watch_store)

ANA = "ana@markifydigital.com"
RAJ = "raj@markifydigital.com"
SECRET = "space-pass-secret"
FETCH = {"X-Requested-With": "fetch"}


def _p(text):
    return {"paragraph": {"elements": [{"textRun": {"content": text + "\n"}}],
                          "paragraphStyle": {"namedStyleType": "NORMAL_TEXT"}}}


DOC = {"title": "Master", "tabs": [
    {"tabProperties": {"title": "Lumina Smiles Dental"}, "documentTab": {"body": {"content": [
        _p(x) for x in ("URL name: lumina", "Website: luminasmiles.in", "Services: Dental implants",
                        "Locations: Pune")]}}},
    {"tabProperties": {"title": "Bloom Skin Clinic"}, "documentTab": {"body": {"content": [
        _p(x) for x in ("URL name: bloom", "Website: bloomskin.in")]}}},
]}
AUDIT = {"input": {"url": "https://luminasmiles.in", "keywords": ["dental implants"]},
         "findings": {"scores": {"overall": 78, "band": {"label": "Good"}}, "meta": {"critical": 2, "warnings": 5}},
         "ai": {"priorities": [{"title": "Add FAQ schema"}, {"title": "Shorten the title"}]}}


@pytest.fixture(autouse=True)
def world(monkeypatch):
    stores = (client_accounts_store, watch_store, video_store, gads_ai_store, people_store, lbr_store, seo_runs_store)
    for s in stores:
        s.reset_memory()
    appmod._acct_reset()
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: [])
    monkeypatch.setattr(appmod, "_acct_doc", lambda: (DOC, "https://docs.google.com/document/d/x/edit", None))
    monkeypatch.setattr(appmod, "SEO_STUDIO_SECRET", SECRET)
    people_store.remember(ANA, "Ana Mehta")
    yield
    for s in stores:
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


def _save(c, tool="seo-geo-audit", payload=AUDIT, account=None):
    headers = dict(FETCH, **({"X-Account": account} if account else {}))
    return c.post("/api/seo-runs", json={"tool": tool, "payload": payload}, headers=headers)


def _pass(html):
    src = re.search(r'id="embed-frame"[^>]*src="([^"]+)"|src="([^"]+)"[^>]*id="embed-frame"', html)
    token = parse_qs(urlsplit((src.group(1) or src.group(2)).replace("&amp;", "&")).query)["st"][0]
    body, sig = token.split(".")
    want = base64.urlsafe_b64encode(hmac.new(SECRET.encode(), body.encode(), hashlib.sha256).digest()).rstrip(b"=")
    assert hmac.compare_digest(sig, want.decode())
    return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))


# ── The pass names the account ───────────────────────────────────────────────
def test_the_studio_is_opened_with_the_accounts_space_inside_an_account():
    inside = _pass(_client(ANA).get("/lumina/seo-aeo/on-page-audit").get_data(as_text=True))
    assert inside["s"] == _space("lumina") and inside["e"] == ANA
    general = _pass(_client(ANA).get("/seo-aeo/on-page-audit").get_data(as_text=True))
    assert "s" not in general, "General: the studio files the work as the person's own"


def test_the_embed_hands_finished_runs_to_the_platform():
    html = _client(ANA).get("/lumina/seo-aeo/keyword-research").get_data(as_text=True)
    assert 'var ACCT = {"name": "Lumina Smiles Dental", "slug": "lumina"}' in html
    assert "'agent-run-finished'" in html and "fetch('/api/seo-runs'" in html and "headers['X-Account'] = ACCT.slug" in html
    assert "var ACCT = null" in _client(ANA).get("/seo-aeo/keyword-research").get_data(as_text=True)


def test_every_tool_reports_its_finished_run():
    import pathlib
    src = pathlib.Path("seo-apps/client/src")
    reported = set()
    for f in list(src.rglob("*.jsx")) + list(src.rglob("*.js")):
        reported |= set(re.findall(r"notifyAgentRunFinished\('([a-z-]+)'", f.read_text(encoding="utf-8")))
    hook = (src / "hooks" / "useSeoGeoAudit.js").read_text(encoding="utf-8")
    assert "notifyAgentRunFinished(persistKey" in hook
    reported |= {"seo-geo-audit", "seo-geo-snapshot"}
    assert {slug for slug, _ in appmod.ACCT_SEO} <= reported, "every account SEO tool reports its runs"
    assert reported <= set(seo_runs.TOOLS), "and the platform knows every one it reports"


# ── Saving a run ─────────────────────────────────────────────────────────────
def test_a_run_inside_an_account_is_the_teams():
    r = _save(_client(ANA), account="lumina")
    assert r.status_code == 201, r.get_json()
    j = r.get_json()
    assert j["page"] == "/lumina/seo-aeo/runs/%d" % j["id"] and j["where"] == "Lumina Smiles Dental Workspace"
    run = seo_runs_store.get(j["id"], RAJ)
    assert run["space"] == _space("lumina") and run["title"] == "https://luminasmiles.in"
    assert run["summary"]["facts"][:2] == [["Overall score", 78], ["Band", "Good"]]
    assert run["summary"]["highlights"] == ["Add FAQ schema", "Shorten the title"]
    page = _client(RAJ).get(j["page"])
    html = page.get_data(as_text=True)
    assert page.status_code == 200 and "Run by <b>Ana Mehta</b>" in html and "for Lumina Smiles Dental" in html
    assert "Add FAQ schema" in html and 'href="/lumina/seo-aeo/seo-geo-audit"' in html
    assert ">Delete<" not in html, "only its maker deletes it"
    assert _client(RAJ).delete("/api/seo-runs/%d" % j["id"], headers=FETCH).status_code == 403
    dl = _client(RAJ).get("/lumina/seo-aeo/runs/%d.json" % j["id"])
    assert dl.status_code == 200 and json.loads(dl.data)["output"]["findings"]["scores"]["overall"] == 78
    r = _client(RAJ).get("/seo-aeo/runs/%d" % j["id"])
    assert r.status_code == 302 and r.headers["Location"].endswith("/lumina/seo-aeo/runs/%d" % j["id"])
    assert _client(RAJ).get("/bloom/seo-aeo/runs/%d" % j["id"]).status_code == 302, "never shown inside another account"
    assert _client(ANA).delete("/api/seo-runs/%d" % j["id"], headers=FETCH).status_code == 200


def test_a_general_run_is_private():
    j = _save(_client(ANA)).get_json()
    assert j["page"] == "/seo-aeo/runs/%d" % j["id"] and j["where"] == "Ana's Workspace"
    assert _client(ANA).get(j["page"]).status_code == 200
    assert _client(RAJ).get(j["page"]).status_code == 404
    assert _client(RAJ).get("/seo-aeo/runs/%d.json" % j["id"]).status_code == 404
    assert seo_runs_store.list_runs(ANA)[0]["id"] == j["id"] and seo_runs_store.list_runs(RAJ) == []


def test_bad_saves_are_refused():
    c = _client(ANA)
    assert c.post("/api/seo-runs", json={"tool": "seo-geo-audit", "payload": AUDIT}).status_code == 400, "fetch only"
    assert _save(c, tool="rm -rf").status_code == 400
    assert c.post("/api/seo-runs", json={"tool": "seo-geo-audit", "payload": "x"}, headers=FETCH).status_code == 415
    assert _client("someone@gmail.com").post("/api/seo-runs", json={"tool": "seo-geo-audit", "payload": AUDIT},
                                             headers=FETCH).status_code in (302, 403), "staff only"


def test_a_huge_result_keeps_its_summary_only(monkeypatch):
    monkeypatch.setattr(seo_runs, "MAX_OUTPUT", 200)
    j = _save(_client(ANA), payload=dict(AUDIT, junk="x" * 500), account="lumina").get_json()
    run = seo_runs_store.get(j["id"], ANA, with_output=True)
    assert run["output"] is None and run["summary"]["truncated"] is True and run["summary"]["facts"]
    html = _client(ANA).get(j["page"]).get_data(as_text=True)
    assert "too large to keep" in html and "Download the full result" not in html


@pytest.mark.parametrize("tool, payload, title, fact", [
    ("agent-readiness-audit", {"input": {"url": "https://lumina.in"}, "site": {"score": 64, "level": "Emerging"}},
     "https://lumina.in", ["Score", 64]),
    ("on-page-audit", {"input": {"url": "https://lumina.in/implants", "primaryKeywords": ["implants"]},
                       "sections": [{"status": "pass"}, {"status": "fail"}, {"status": "pass"}]},
     "https://lumina.in/implants", ["Sections passed", 2]),
    ("image-alt-audit", {"input": {"urls": ["a", "b"]}, "pages": [{"ok": True, "contentCount": 4}, {"ok": False}]},
     "2 pages", ["Pages read", 1]),
    ("keyword-research", {"keyword": "dental implants pune", "primary": [{"keyword": "implant cost"}], "secondary": []},
     "dental implants pune", ["Primary keywords", 1]),
    ("content-architect", {"input": {"domain": "https://lumina.in"}, "clusters": [{"name": "Implants"}]},
     "https://lumina.in", ["Clusters", 1]),
    ("market-potential", {"input": {"service": "Dental implants"}, "rows": [{"name": "Pune"}, {"name": "Mumbai"}]},
     "Dental implants", ["Markets compared", 2]),
])
def test_each_tool_gets_a_readable_title_and_facts(tool, payload, title, fact):
    s = seo_runs.summarize(tool, payload)
    assert s["title"] == title and fact in s["facts"]


def test_a_reshaped_result_never_breaks_the_save():
    s = seo_runs.summarize("on-page-audit", {"sections": "not a list", "input": "nope"})
    assert s["title"] == "On-Page SEO Audit" and isinstance(s["facts"], list)


# ── History and the account home ─────────────────────────────────────────────
def test_the_accounts_history_and_home_show_its_seo_runs():
    _save(_client(ANA), account="lumina")
    _save(_client(ANA), tool="keyword-research", payload={"keyword": "skin care", "primary": []}, account="bloom")
    _save(_client(ANA), tool="keyword-research", payload={"keyword": "my own", "primary": []})
    html = _client(RAJ).get("/lumina").get_data(as_text=True)
    assert 'data-tool="seo"' in html and "https://luminasmiles.in" in html and "SEO &amp; GEO Audit" in html
    assert "skin care" not in html and "my own" not in html
    assert "Overall score 78 · Band Good" in html
    assert re.search(r"SEO &amp; GEO Audit</span>.*?Last run [^<]* by Ana Mehta", html, re.S)
