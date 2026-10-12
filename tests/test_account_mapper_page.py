"""People & Signals phase 5: the admin routes (admin only, no spending
without its confirmation, one job at a time), the CSV export, runs kept in
Postgres per owner with mapping and revealing as separate jobs, and the
page script under Node with hostile strings (names, titles, photos and
briefs come from Saleshandy, the web and a model)."""
import json
import os
import re
import shutil
import subprocess
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tracker import account_mapper_store as store  # noqa: E402
from tracker import saleshandy_client as sh  # noqa: E402

EVIL = '<img src=x onerror=alert(1)>"\'&'
ADMIN = "kris@markifydigital.com"
BASE = "/admin/account-mapper"


def _client(email):
    import app as appmod
    c = appmod.app.test_client()
    if email:
        with c.session_transaction() as sess:
            sess["google_user"] = {"email": email, "name": "T"}
    return c


def _summary():
    jane = {"id": 11, "name": "Jane Doe", "first_name": "Jane", "last_name": "Doe", "title": "VP of Marketing",
            "new_in_role": True, "decision_maker": True, "location": "Austin, United States"}
    raj = {"id": 12, "name": "Raj Patel", "title": "=HYPERLINK(\"http://x\")", "location": None}
    return {"ranking": ["Acme"], "plans": [], "companies": [{
        "name": "Acme", "display_name": "Acme Inc", "domain": "acme.com", "priority": {"score": 70, "reasons": ["x"]},
        "brief": {"openers": [{"name": "Jane Doe", "line": "Congrats on the new role."}]},
        "roles": [{"role": "VP Marketing", "status": "found", "picked": [jane], "also": [raj]}]}]}


# == routes ===========================================================================

@pytest.mark.parametrize("method, path", [
    ("get", BASE), ("get", BASE + "/api/status"), ("get", BASE + "/api/runs"), ("post", BASE + "/api/runs"),
    ("get", BASE + "/api/runs/1"), ("get", BASE + "/api/runs/1/export.csv"), ("post", BASE + "/api/estimate"),
    ("post", BASE + "/api/runs/1/reveal")])
@pytest.mark.parametrize("email, status", [(None, 302), ("someone@markifydigital.com", 403)])
def test_every_route_is_admin_only(method, path, email, status):
    c = _client(email)
    resp = getattr(c, method)(path, json={}) if method == "post" else c.get(path)
    assert resp.status_code == status


def test_the_page_renders_with_its_script_and_menu_entry():
    html = _client(ADMIN).get(BASE).get_data(as_text=True)
    assert "js/account_mapper.js" in html and "css/account_mapper.css" in html and 'href="/admin/account-mapper"' in html
    assert "<title>People &amp; Signals" in html and "People &amp; Signals" in html.split('href="/admin/account-mapper"', 1)[1][:2000]
    assert "Account Mapper" not in html


def test_status_says_when_the_key_is_missing_and_shows_the_balance_when_set(monkeypatch):
    monkeypatch.delenv("SALESHANDY_API_KEY", raising=False)
    j = _client(ADMIN).get(BASE + "/api/status").get_json()
    assert j["saleshandy"] == {"configured": False} and "claude-haiku-5-5" in j["models"]

    class Fake:
        def __init__(self, *a, **k):
            pass

        def credits(self):
            return {"total": 1480, "today": 1, "month": 9}

        def rate_limits(self):
            return {"minute": {"limit": 30, "remaining": 30}}
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    monkeypatch.setattr(sh, "Client", Fake)
    j = _client(ADMIN).get(BASE + "/api/status").get_json()
    assert j["saleshandy"]["ok"] and j["saleshandy"]["credits"]["total"] == 1480


def test_a_run_needs_the_key_its_confirmation_and_starts_once(monkeypatch):
    monkeypatch.delenv("SALESHANDY_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    c = _client(ADMIN)
    body = {"companies": "Acme | acme.com", "roles": "VP Marketing", "briefs": False, "model": "claude-haiku-5-5"}
    assert c.post(BASE + "/api/runs", json=body, headers={"Origin": "https://evil.example"}).status_code == 403
    r = c.post(BASE + "/api/runs", json=body)
    assert r.status_code == 400 and "SALESHANDY_API_KEY" in r.get_json()["error"]
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    r = c.post(BASE + "/api/runs", json=dict(body, briefs=True))
    assert r.status_code == 400 and "confirm" in r.get_json()["error"]
    r = c.post(BASE + "/api/runs", json=dict(body, briefs=True, confirm_spend=True))
    assert r.status_code == 400 and "ANTHROPIC_API_KEY" in r.get_json()["error"]
    assert c.post(BASE + "/api/runs", json=dict(body, roles="")).status_code == 400
    started, going = [], {}
    monkeypatch.setattr(store, "running_run", lambda email: going.get("run"))

    def start(settings, email, cap_usd=None):
        started.append((settings, cap_usd))
        going["run"] = {"id": 5}
        return 5
    monkeypatch.setattr(store, "start_map", start)
    r = c.post(BASE + "/api/runs", json=dict(body, per_role="9"))
    assert r.status_code == 202 and r.get_json() == {"run_id": 5}
    settings, cap = started[0]
    assert settings["companies"] == [{"name": "Acme", "domain": "acme.com"}] and settings["per_role"] == 5
    assert settings["briefs"] is False and cap == 0                     # free: no Claude cap needed
    assert c.post(BASE + "/api/runs", json=body).status_code == 409 and len(started) == 1


def test_the_estimate_is_free_until_claude_is_ticked():
    c = _client(ADMIN)
    free = c.post(BASE + "/api/estimate", json={"companies": "A\nB", "roles": "CMO\nCFO"}).get_json()
    assert free["credits_default"] == 4 and free["usd_typical"] == 0 and free["claude"] is False
    paid = c.post(BASE + "/api/estimate", json={"companies": "A\nB", "roles": "CMO", "briefs": True,
                                               "model": "claude-haiku-5-5"}).get_json()
    assert paid["claude"] and 0 < paid["usd_typical"] < paid["usd_cap"]
    assert c.post(BASE + "/api/estimate", json={"companies": "", "roles": "CMO"}).status_code == 400


def test_a_reveal_is_planned_free_refused_over_its_cap_and_needs_a_yes(monkeypatch):
    monkeypatch.setenv("SALESHANDY_API_KEY", "k")
    run = {"id": 4, "status": "ready", "summary": _summary()}
    monkeypatch.setattr(store, "get_run", lambda rid, email: run if rid == 4 else None)

    class Fake:
        def __init__(self, *a, **k):
            pass

        def credits(self):
            return {"total": 100}
    monkeypatch.setattr(sh, "Client", Fake)
    started = []
    monkeypatch.setattr(store, "start_reveal", lambda rid, email, keys, cap_credits, phone: started.append(
        (keys, cap_credits, phone)) or True)
    c = _client(ADMIN)
    url = BASE + "/api/runs/4/reveal"
    check = c.post(url, json={"keys": [11, "12"], "cap_credits": 10, "dry_run": True}).get_json()
    assert check["ok"] and check["worst_credits"] == 2 and check["balance"] == 100 and not started
    r = c.post(url, json={"keys": [11, 12], "cap_credits": 1})
    assert r.status_code == 400 and "cap of 1" in r.get_json()["error"]
    r = c.post(url, json={"keys": [11, 12], "cap_credits": 10})
    assert r.status_code == 400 and "confirm" in r.get_json()["error"] and not started
    r = c.post(url, json={"keys": [11, 12], "cap_credits": 10, "confirm": True})
    assert r.status_code == 202 and started == [([11, 12], 10, False)]
    assert c.post(url, json={"keys": [], "cap_credits": 10}).status_code == 400
    assert c.post(BASE + "/api/runs/9/reveal", json={"keys": [1], "cap_credits": 10}).status_code == 404
    run["status"] = "running"
    assert c.post(url, json={"keys": [11], "cap_credits": 10, "confirm": True}).status_code == 409


def test_the_csv_has_a_row_per_person_and_no_formulas(monkeypatch):
    monkeypatch.setattr(store, "get_run", lambda rid, email: {"id": rid, "status": "ready", "summary": _summary()})
    r = _client(ADMIN).get(BASE + "/api/runs/4/export.csv")
    assert r.status_code == 200 and r.headers["Content-Type"].startswith("text/csv")
    text = r.get_data(as_text=True)
    lines = text.strip().splitlines()
    assert lines[0].startswith("company,domain,priority,title_asked,name") and len(lines) == 3
    assert "Jane Doe,Jane,Doe,VP of Marketing" in lines[1] and "Congrats on the new role." in lines[1]
    assert "'=HYPERLINK" in text and ",=HYPERLINK" not in text


# == storage, on a real Postgres ======================================================

from tests.test_market_radar_store import OWNER, OTHER, pg  # noqa: E402,F401  (fixture)


class _FakeSH:
    log = [{"path": "/search/people", "status": 201}]

    def credits(self):
        return {"total": 100}

    def enrich_contacts(self, **kw):
        return "r1"

    def wait(self, rid, timeout=None):
        return {"status": "completed", "credits": 1, "records": [
            {"lead_id": 11, "email": "jane.doe@acme.com", "email_status": "valid"}]}


def test_a_run_maps_then_reveals_and_is_kept_to_its_owner(pg, monkeypatch):
    monkeypatch.setattr(store, "_READY", False)

    def mapper(settings, client, progress=None, budget=None):
        progress("company 1/1 (Acme): finding the company")
        settings["on_company"]({"companies": [{"name": "Acme"}]})
        return dict(_summary(), totals={"titles": 1, "titles_found": 1})

    spawned = []
    run_id = store.start_map({"companies": [{"name": "Acme", "domain": None}], "roles": ["VP Marketing"],
                              "briefs": False, "on_company": "not stored"}, OWNER,
                             spawn=lambda fn, args: spawned.append((fn, args)))
    assert store.running_run(OWNER)["id"] == run_id and store.running_run(OTHER) is None
    fn, args = spawned.pop()
    fn(*args, client=_FakeSH(), mapper=mapper)
    run = store.get_run(run_id, OWNER)
    assert run["status"] == "ready" and run["summary"]["log"] and "on_company" not in run["settings"]
    assert run["summary"]["ranking"] == ["Acme"] and store.get_run(run_id, OTHER) is None
    assert store.start_reveal(run_id, OTHER, [11], cap_credits=5) is False         # not theirs
    assert store.start_reveal(run_id, OWNER, [11], cap_credits=5, spawn=lambda f, a: spawned.append((f, a)))
    assert store.get_run(run_id, OWNER)["status"] == "running"
    assert store.start_reveal(run_id, OWNER, [11], cap_credits=5) is False         # busy
    fn, args = spawned.pop()
    fn(*args, client=_FakeSH())
    run = store.get_run(run_id, OWNER)
    jane = run["summary"]["companies"][0]["roles"][0]["picked"][0]
    assert run["status"] == "ready" and run["credits_used"] == 1 and jane["email"]["label"] == "verified"
    assert run["stage"] == "revealed 1 of 1"
    [listed] = store.list_runs(OWNER)
    assert listed["credits_used"] == 1 and "summary" not in listed


def test_a_bad_key_fails_the_run_with_its_reason(pg, monkeypatch):
    monkeypatch.setattr(store, "_READY", False)
    from decimal import Decimal

    def mapper(settings, client, progress=None, budget=None):
        raise sh.AuthError("Saleshandy did not accept the API key (Invalid token)")
    run_id = store.create_run(OWNER, {"companies": []}, Decimal("0"))
    store.map_job(run_id, {"companies": [], "roles": []}, Decimal("0"), client=_FakeSH(), mapper=mapper)
    run = store.get_run(run_id, OWNER)
    assert run["status"] == "failed" and "Invalid token" in run["error"]


# == the page script ==================================================================

JS = os.path.join(ROOT, "static", "js", "account_mapper.js")


def run_js(expr):
    if shutil.which("node") is None:
        pytest.skip("node is not installed")
    prog = ("globalThis.window = globalThis; require(%s); const AM = globalThis.AM;\n"
            "process.stdout.write(JSON.stringify((() => { %s })()));") % (json.dumps(JS), expr)
    proc = subprocess.run([shutil.which("node"), "-e", prog], capture_output=True, text=True, timeout=30)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def _run():
    person = {"id": 11, "name": EVIL, "title": EVIL, "photo": "javascript:alert(1)", "linkedin": "javascript:alert(1)",
              "location": EVIL, "new_in_role": True, "decision_maker": True,
              "email": {"address": EVIL, "label": "verified", "note": EVIL}}
    revealed = dict(person, id=12, name="Old Hand", revealed=True, photo="https://img.example/a.jpg",
                    email={"address": "old@acme.com", "label": "pattern_confirmed", "note": "built"})
    web = {"name": "Mia Chen", "title": "Head of Partnerships", "linkedin": "https://www.linkedin.com/in/miachen",
           "source": "web"}
    company = {"name": EVIL, "display_name": EVIL, "domain": "acme.com",
               "resolved": {"how": "closest name", "alternatives": [{"name": EVIL, "domain": "acme.io"}],
                            "company": {"industry": EVIL, "employees": 4000, "linkedin": "javascript:x"}},
               "priority": {"score": 70, "reasons": [EVIL]}, "errors": [EVIL],
               "email_pattern": {"pattern": "first.last", "level": "confirmed", "domain": "acme.com"},
               "insights": {"people_in_saleshandy": 300, "decision_makers": 20,
                            "teams": [{"department": EVIL, "people": 40}, {"department": "Sales", "people": 80}],
                            "new_leaders": {"total": 2, "people": [{"name": EVIL, "title": EVIL}]},
                            "signals": {"hiring": True, "hiring_your_titles": True, "funded_last_year": False}},
               "brief": {"one_liner": EVIL, "shape": EVIL, "changes": [{"text": EVIL, "source": "javascript:x"},
                                                                        {"text": "Hiring", "source": "https://acme.com/careers"}],
                         "first_contact": {"name": EVIL, "why": EVIL}, "openers": [{"name": EVIL, "line": EVIL}],
                         "watch_outs": [EVIL]},
               "roles": [{"role": EVIL, "status": "found", "picked": [person], "also": [revealed],
                          "attempts": [{"how": EVIL, "total": 3, "kept": 1}]},
                         {"role": "Head of Partnerships", "status": "web", "picked": [], "also": [], "web": [web]}]}
    return {"id": 3, "status": "ready", "created_at": "2026-10-12T05:00:00Z", "credits_used": 4, "stage": "mapped",
            "settings": {"roles": [EVIL], "companies": [{"name": EVIL}]},
            "summary": {"companies": [company], "ranking": [EVIL],
                        "totals": {"titles": 2, "titles_found": 1, "companies": 1, "companies_resolved": 1,
                                   "people_picked": 1, "people_also": 1, "new_in_role": 1},
                        "reveals": [{"found": 1, "asked": 2, "credits": 1}], "cost": {"spent_usd": 0.01},
                        "plan_note": EVIL}}


def test_the_page_shows_a_run_and_no_markup_from_its_data():
    out = run_js("const r = %s; const sel = AM.bestSelection(r); return [AM.renderRun(r, {selected: sel, cap: 20}),"
                 "AM.renderRuns([r], 3), AM.renderReady({saleshandy: {configured: true, ok: false, error: %s}, claude: {}}),"
                 "Object.keys(sel)];" % (json.dumps(_run()), json.dumps(EVIL)))
    page, runs, ready, sel = out
    for html in (page, runs, ready):
        assert "onerror=alert(1)>" not in html.replace("&gt;", "") and "<img src=x" not in html
        assert not [h for h in re.findall(r'(?:href|src)="([^"]*)"', html) if "javascript" in h]
    assert sel == ["11", "li:miachen"]                              # the revealed person is not ticked again
    assert "1 of 2 seats filled across 1 account" in page and "Work these first" in page
    assert "2 people ticked" in page and "Up to 2 credits" in page and 'value="20"' in page
    assert "Last reveal: 1 of 2 found, 1 credits" in page
    assert "New in role" in page and "Decision-maker" in page and "Verified" in page and "Pattern" in page
    assert "Hiring for your titles" in page and "2 new leaders this year" in page
    assert "Contact first" in page and "Other companies with this name" in page and "Found on the web" in page
    assert 'src="https://img.example/a.jpg"' in page and 'referrerpolicy="no-referrer"' in page
    assert 'href="https://acme.com/careers"' in page and "export.csv" in page
    assert page.count('data-act="pick"') == 2                       # not on the revealed person
    assert "Saleshandy: " in ready and "Run 3" in runs and "4 credits" in runs


def test_the_estimate_and_reveal_bar_say_what_costs_what():
    out = run_js("return [AM.renderEstimate({companies: 2, roles: 3, free_searches: 60, credits_default: 6, claude: true,"
                 " usd_typical: 0.012, usd_cap: 0.5}), AM.renderEstimate({companies: 1, roles: 1, credits_default: 1, claude: false}),"
                 "AM.renderRevealBar({status: 'ready', summary: {}}, {'1': true, '2': true, '3': false}, {phone: true}),"
                 "AM.renderRevealBar({status: 'running', summary: {}}, {}, {})];")
    assert "6 credits at most" in out[0] and "$0.012" in out[0] and "$0.500" in out[0]
    assert "$0" in out[1] and "No Claude steps ticked" in out[1]
    assert "2 people ticked" in out[2] and "Up to 14 credits" in out[2] and "7 each" in out[2]
    assert 'data-act="reveal" disabled' in out[3]
