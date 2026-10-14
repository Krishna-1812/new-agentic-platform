"""The admin panel (/admin): one page in place of eight analytics tabs.

Covers who may open it, that the old addresses lead into it, that the menu has the one entry, what each
section's JSON route returns, and that static/js/admin_panel.js draws every section from that real JSON
(run in Node) without letting a hostile name or message become markup.
"""
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as appmod  # noqa: E402
from tracker import admin_spend  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADMIN = "sudheer@markifydigital.com"
STAFF = "not-an-admin@markifydigital.com"
OUTSIDER = "someone@example.com"
NOW = datetime.now(timezone.utc)
EVIL = '<img src=x onerror=alert(1)>'

SECTIONS = ("spend", "team", "clients", "traffic", "inbox")
OLD_TABS = {
    "/admin/internal-usage": "team", "/admin/external-usage": "clients", "/admin/client-usage": "clients",
    "/admin/anonymous-traffic": "traffic", "/admin/public-page-analytics": "traffic",
    "/admin/public-agent-usage": "inbox", "/admin/access-requests": "inbox", "/admin/agent-feedback": "inbox",
}


def _client(email=None):
    c = appmod.app.test_client()
    if email:
        with c.session_transaction() as s:
            s["google_user"] = {"email": email, "name": "T"}
    return c


@pytest.fixture(autouse=True)
def fresh_cache(monkeypatch):
    appmod._PANEL_CACHE.clear()
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(appmod, "_analytics_sheet_health", lambda force=False: {"ok": True})
    yield
    appmod._PANEL_CACHE.clear()


# == who may open it ===========================================================================

@pytest.mark.parametrize("path", ["/admin", "/admin/panel/spend", "/admin/panel/team", "/admin/panel/clients",
                                  "/admin/panel/traffic", "/admin/panel/inbox", "/admin/panel/account/x"])
def test_only_an_admin_gets_in(path):
    signed_out = _client().get(path)
    assert signed_out.status_code == 302 and "/login" in signed_out.headers["Location"]
    assert _client(STAFF).get(path).status_code == 403, "staff who are not admins are refused"
    out = _client(OUTSIDER).get(path)
    assert out.status_code == 302 and out.headers["Location"].endswith("/app")


def test_the_page_is_a_shell_with_every_section_in_it():
    html = _client(ADMIN).get("/admin").get_data(as_text=True)
    for sid in SECTIONS:
        assert 'id="%s"' % sid in html and 'id="%sBody"' % sid in html, sid
        assert 'href="#%s"' % sid in html or sid == "traffic", sid
    assert 'href="#traffic"' in html
    for needle in ('id="admHealth"', "/admin/analytics-health", 'data-days="7"', 'data-days="30"', 'data-days="90"',
                   'id="ctlDrawer"', 'id="ctlRefresh"', "admin_panel.js", "admin_panel.css"):
        assert needle in html, needle
    assert html.count("data-fig=") >= 4 and "Admin" in html


def test_the_old_tabs_lead_into_the_panel():
    c = _client(ADMIN)
    for old, section in OLD_TABS.items():
        r = c.get(old)
        assert r.status_code == 302 and r.headers["Location"].endswith("/admin#" + section), (old, r.status_code, r.headers.get("Location"))
    for old, section in {"/admin/usage": "team", "/admin/visitors": "traffic", "/admin/members": "traffic",
                         "/admin/requests": "inbox", "/admin/agent-runs": "inbox"}.items():
        r = _client().get(old)
        assert r.status_code == 301 and r.headers["Location"].endswith("/admin#" + section), old
    r = c.get("/admin/client-usage/northstaranesthesia")
    assert r.status_code == 302 and r.headers["Location"].endswith("/admin#clients"), "portals are not in the panel"
    assert c.get("/admin/client-usage/no-such-portal").status_code == 404
    assert _client(STAFF).get("/admin/internal-usage").status_code == 403, "the old addresses keep the gate"


def test_the_old_pages_and_their_stylesheets_are_gone():
    gone = ("admin_usage", "admin_external_usage", "admin_client_usage", "admin_client_account", "admin_client_detail",
            "admin_visitors", "admin_members", "admin_agent_runs", "admin_agent_feedback", "admin_requests")
    for name in gone:
        assert not os.path.exists(os.path.join(ROOT, "templates", name + ".html")), name
        assert not os.path.exists(os.path.join(ROOT, "static", "css", name + ".css")), name
    assert not os.path.exists(os.path.join(ROOT, "static", "css", "admin.css"))
    assert not os.path.exists(os.path.join(ROOT, "static", "css", "admin_client_accounts.css"))


def test_the_menu_has_one_admin_entry_for_admins_and_none_for_everyone_else():
    with appmod.app.test_request_context("/hub"):
        from flask import render_template, session
        session["google_user"] = {"email": ADMIN, "name": "A"}
        menu = render_template("_admin_menu.html", is_admin=True, brand=appmod.BRAND)
        assert menu.count('href="/admin"') == 1 and "Admin panel" in menu
        assert menu.count("/admin/") == 0, "none of the old tabs is linked"
        for gone in ("Internal Usage", "External Usage", "Client Usage", "Agent Feedback", "Anonymous Traffic",
                     "Public Page Analytics", "Public Agent Usage", "Access Requests"):
            assert gone not in menu, gone
        plain = render_template("_admin_menu.html", is_admin=False, brand=appmod.BRAND)
        assert "/admin" not in plain and "Sign out" in plain


# == the sections' JSON ========================================================================

def _rows():
    def row(agent, usd, email, space, days_ago=1, unit="usd"):
        return {"agent": agent, "unit": unit, "email": email, "space": space, "usd": usd, "at": NOW - timedelta(days=days_ago)}
    return [row("market-radar", 3.0, "kris@markifydigital.com", "acct:7"), row("video-studio", 1.5, "mia@x.com", ""),
            row("market-radar", 2.0, "", "acct:7", 3), row("contact-finder", 90, "kris@markifydigital.com", "", unit="credits")]


def _fake_collect(since, sources=admin_spend.SOURCES):
    return {"rows": _rows(), "sources": [{"agent": s[0], "label": s[1], "unit": s[2], "ok": s[0] != "video-studio",
                                         "runs": 1, "note": "" if s[0] != "video-studio" else "Could not be read: boom"}
                                        for s in sources]}


def test_spend_names_workspaces_and_people_and_says_which_ledger_failed(monkeypatch):
    monkeypatch.setattr(admin_spend, "collect", _fake_collect)
    monkeypatch.setattr(appmod, "_panel_workspaces", lambda: {"acct:7": "Lumina Dental"})
    d = _client(ADMIN).get("/admin/panel/spend?days=7").get_json()
    assert d["days"] == 7 and d["total"] == 6.5 and d["credits"][0]["credits"] == 90
    assert {w["name"] for w in d["workspaces"]} == {"Lumina Dental", "General (personal work)"}
    people = {p["email"]: p for p in d["people"]}
    assert people["kris@markifydigital.com"]["staff"] is True and people["mia@x.com"]["staff"] is False
    assert people[""]["name"] == "Not recorded" and people[""]["staff"] is False
    assert d["missing"] == ["Video Studio"] and any(not s["ok"] for s in d["sources"])
    assert len(d["series"]) == 7


def test_an_unknown_period_falls_back_to_thirty_days(monkeypatch):
    monkeypatch.setattr(admin_spend, "collect", _fake_collect)
    monkeypatch.setattr(appmod, "_panel_workspaces", lambda: {})
    assert _client(ADMIN).get("/admin/panel/spend?days=5").get_json()["days"] == 30
    assert _client(ADMIN).get("/admin/panel/spend?days=90").get_json()["days"] == 90
    assert _client(ADMIN).get("/admin/panel/spend").get_json()["days"] == 30


def test_a_section_is_cached_for_a_minute_and_refreshed_on_request(monkeypatch):
    calls = []
    monkeypatch.setattr(appmod, "_panel_team", lambda: calls.append(1) or {"n": len(calls)})
    c = _client(ADMIN)
    assert c.get("/admin/panel/team").get_json() == {"n": 1}
    assert c.get("/admin/panel/team").get_json() == {"n": 1}, "served from the cache"
    assert c.get("/admin/panel/team?fresh=1").get_json() == {"n": 2}


def test_a_section_that_fails_says_so_and_does_not_take_the_others_down(monkeypatch):
    def boom():
        raise RuntimeError("the sheet is unreadable")
    monkeypatch.setattr(appmod, "_panel_team", boom)
    r = _client(ADMIN).get("/admin/panel/team")
    assert r.status_code == 500 and "the sheet is unreadable" in r.get_json()["error"]
    monkeypatch.setattr(appmod, "_panel_traffic", lambda: {"ok": 1})
    assert _client(ADMIN).get("/admin/panel/traffic").get_json() == {"ok": 1}
    assert _client(ADMIN).get("/admin/panel/nonsense").status_code == 404


FAKE_USAGE = dict(
    unique_users=2, total_logins=9, total_page_views=40, total_time_fmt="2h 5m", avg_view_fmt="31s", views_per_user=20.0,
    busiest_day=["2026-10-09", 12], login_days=[["2026-10-08", 3], ["2026-10-09", 6]], top_pages=[["Market Radar", 20]] * 12,
    device_breakdown=[["Desktop", 40]], browser_breakdown=[["Chrome", 40]],
    user_activity=[{"email": "kris@markifydigital.com", "name": EVIL, "logins": 6, "page_views": 30, "time_fmt": "1h 2m",
                    "last_active": "2026-10-09 10:00:00 IST", "first_seen": "2026-09-01", "device": "Desktop", "browser": "Chrome", "os": "mac",
                    "timeline": [{"t": "2026-10-0%d 10:00" % i, "kind": "post", "label": "Page %d" % i} for i in range(1, 12)]},
                   {"email": "mia@markifydigital.com", "name": "Mia", "logins": 3, "page_views": 10, "time_fmt": "—", "timeline": []}])


def test_team_trims_the_staff_usage_and_keeps_the_newest_activity_first(monkeypatch):
    monkeypatch.setattr(appmod, "_fetch_usage_data", lambda internal=True: FAKE_USAGE)
    d = _client(ADMIN).get("/admin/panel/team").get_json()
    assert d["kpis"]["users"] == 2 and d["kpis"]["logins"] == 9 and len(d["top_pages"]) == 8
    kris = d["users"][0]
    assert [e["label"] for e in kris["recent"]][:2] == ["Page 11", "Page 10"] and len(kris["recent"]) == 8
    assert d["users"][1]["recent"] == [] and d["users"][1]["last_active"] == ""


def _fake_account(slug, name, space):
    return {"slug": slug, "name": name, "space": space, "key": "k" + slug, "avatar": {"bg": "#FFB500", "fg": "#121213", "initials": "LD"},
            "people": [{"who": "@lumina.com", "kind": "domain", "added_by": "kris@markifydigital.com", "created_at": NOW}],
            "pages": ["Google Ads"], "tools": [{"slug": "page-watch", "label": "Page Watch"}], "tools_total": 12,
            "visits_30": 4, "visitors_30": 2, "runs": 3, "limit": 20, "last_visit": NOW, "by_person": [], "audit": [], "events": [],
            "last_change": {"text": "Kris shared Page Watch", "at": NOW}, "actor_names": {}}


def test_clients_lists_only_the_shared_accounts_with_totals(monkeypatch):
    monkeypatch.setattr(appmod, "_cu_shared_accounts", lambda: [_fake_account("lumina", "Lumina", "acct:7"), _fake_account("bloom", "Bloom", "acct:8")])
    monkeypatch.setattr(appmod, "_fetch_all_client_summaries", lambda force=False: pytest.fail("portals are not read"))
    d = _client(ADMIN).get("/admin/panel/clients").get_json()
    assert d["totals"] == {"accounts": 2, "people": 2, "visitors_30": 4, "runs": 6}
    a = d["accounts"][0]
    assert a["tools"] == ["Page Watch"] and a["limit"] == 20 and a["space"] == "acct:7" and a["last_change"] == "Kris shared Page Watch"
    assert a["last_visit"] and "T" in a["last_visit"], "dates are sent as ISO text"
    assert "portals" not in d
    assert _client(ADMIN).get("/admin/panel/portal/northstaranesthesia").status_code == 404, "the portal route is gone"


def test_traffic_joins_the_visitor_and_sign_in_figures(monkeypatch):
    monkeypatch.setattr(appmod, "_fetch_visitor_analytics", lambda force=False: {
        "configured": True, "kpis": {"visitors": 10, "pageviews": 40}, "series": [["2026-10-01", 5]], "top_pages": [["Home", 9]] * 20,
        "referrers": [["direct", 5]], "devices": [["Desktop", 5]], "top_landing": []})
    monkeypatch.setattr(appmod, "_fetch_member_analytics", lambda force=False: {
        "kpis": {"members": 3, "signins": 7, "new": 1, "returning": 2, "conv_rate": 30.0, "avg_pre": 4},
        "funnel": {"visitors": 10, "engaged": 6, "members": 3, "returning": 2}, "companies": []})
    d = _client(ADMIN).get("/admin/panel/traffic").get_json()
    assert d["kpis"]["visitors"] == 10 and len(d["top_pages"]) == 8
    assert d["signins"] == {"members": 3, "signins": 7, "new": 1, "returning": 2, "conv_rate": 30.0}
    assert d["funnel"]["engaged"] == 6 and "avg_pre" not in d["signins"]


def test_inbox_collects_requests_feedback_and_public_agent_use(monkeypatch):
    from tracker import agent_feedback
    monkeypatch.setattr(appmod, "_read_access_requests", lambda limit=300: [{"ts": "t", "name": "A", "email": "a@x.com", "company": "X", "interest": "", "message": "hi"}] * 70)
    monkeypatch.setattr(appmod, "_agent_access_requests_raw", lambda limit=2000: [{"ts": "t", "name": "B", "email": "b@x.com", "slug": "s", "agent_name": "Job Change Alert", "message": ""}])
    monkeypatch.setattr(agent_feedback, "summary", lambda days=30, agent_slug=None: [
        {"agent_slug": "company-people-intelligence", "section_key": "a", "section_label": "A", "up": 5, "down": 1, "total": 6, "down_pct": 16.7},
        {"agent_slug": "company-people-intelligence", "section_key": "b", "section_label": "B", "up": 2, "down": 0, "total": 2, "down_pct": 0}])
    monkeypatch.setattr(agent_feedback, "list_recent", lambda agent_slug=None, rating=None, limit=200: [
        {"id": 1, "email": "e", "agent_slug": "company-people-intelligence", "run_id": "1", "section_key": "a", "section_label": "A",
         "rating": "down", "reason": "wrong company", "created_at": NOW.isoformat()}])
    monkeypatch.setattr(appmod, "_fetch_agent_run_stats", lambda: {
        "configured": True, "cap": 3, "total_runs": 8, "total_users": 2, "users_at_cap": 1,
        "agents": [{"slug": "k", "name": "Keyword Finder", "runs": 6}, {"slug": "z", "name": "Idle", "runs": 0}],
        "users": [{"email": "u@x.com", "name": "U", "total": 8, "last_run": "t", "agents": []}]})
    d = _client(ADMIN).get("/admin/panel/inbox").get_json()
    assert d["requests"]["total"] == 70 and len(d["requests"]["rows"]) == 60, "the count is the whole list, the rows the latest 60"
    assert d["agent_requests"]["total"] == 1
    fb = d["feedback"]["agents"][0]
    assert (fb["label"], fb["up"], fb["down"]) == ("Contact Finder", 7, 1), "sections add up per agent"
    assert d["feedback"]["down"][0]["reason"] == "wrong company" and d["feedback"]["down"][0]["label"] == "Contact Finder"
    assert [a["name"] for a in d["agent_use"]["agents"]] == ["Keyword Finder"] and d["agent_use"]["at_cap"] == 1


# == the script, run for real in Node ==========================================================

NODE = shutil.which("node")

DRIVER = r"""
const fs = require('fs'), vm = require('vm');
const data = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const failing = new Set(data.__fail || []);
const els = {};
function el(sel) {
  if (!els[sel]) els[sel] = { innerHTML: '', textContent: '', value: '', dataset: {}, style: {}, disabled: false, className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, setAttribute() {}, focus() {}, lastChild: {}, addEventListener() {} };
  return els[sel];
}
global.document = { readyState: 'complete', querySelector: el, querySelectorAll: () => [], addEventListener() {}, createElement: () => el('a'),
                    body: { appendChild() {} }, activeElement: null };
global.window = { addEventListener() {} };
global.location = { hash: process.argv[4] || '', pathname: '/admin', search: '' };
global.history = { replaceState() {} };
const asked = [];
global.fetch = (url) => {
  asked.push(url);
  const path = url.split('?')[0].replace('/admin/panel/', '');
  const section = path.split('/')[0];
  if (failing.has(section)) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: data.__error || 'boom' }) });
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data[path] || data[section]) });
};
vm.runInThisContext(fs.readFileSync(process.argv[2], 'utf8'));
setTimeout(() => {
  const out = {};
  Object.keys(els).forEach((k) => { out[k] = els[k].innerHTML || els[k].textContent; });
  console.log(JSON.stringify({ out, asked }));
}, 150);
"""


def _run_script(tmp_path, data, hash_=""):
    d = tmp_path / "data.json"
    d.write_text(json.dumps(data, default=str))
    drv = tmp_path / "driver.js"
    drv.write_text(DRIVER)
    r = subprocess.run([NODE, str(drv), os.path.join(ROOT, "static", "js", "admin_panel.js"), str(d), hash_],
                       capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def _real_json(monkeypatch):
    """Every section's JSON as the real routes produce it, from fakes with hostile names in them."""
    monkeypatch.setattr(admin_spend, "collect", lambda since, sources=admin_spend.SOURCES: dict(_fake_collect(since, sources), rows=_rows() + [
        {"agent": "market-radar", "unit": "usd", "email": "evil@x.com", "space": "acct:9", "usd": 1.0, "at": NOW}]))
    monkeypatch.setattr(appmod, "_panel_workspaces", lambda: {"acct:7": "Lumina Dental", "acct:9": EVIL})
    monkeypatch.setattr(appmod, "_fetch_usage_data", lambda internal=True: FAKE_USAGE)
    monkeypatch.setattr(appmod, "_cu_shared_accounts", lambda: [_fake_account("lumina", EVIL, "acct:7")])
    monkeypatch.setattr(appmod, "_fetch_visitor_analytics", lambda force=False: {
        "configured": True, "kpis": {"visitors": 2840, "pageviews": 9120, "new": 5, "returning": 6, "bounce_rate": 41, "conversions": 17},
        "series": [["2026-10-01", 5], ["2026-10-02", 9]], "top_pages": [[EVIL, 9]], "referrers": [["direct", 5]], "devices": [["Desktop", 5]], "top_landing": []})
    monkeypatch.setattr(appmod, "_fetch_member_analytics", lambda force=False: {"kpis": {"members": 64, "signins": 7, "new": 1, "returning": 2, "conv_rate": 2.3},
                                                                                "funnel": {"visitors": 10, "engaged": 6, "members": 3, "returning": 2}, "companies": []})
    monkeypatch.setattr(appmod, "_read_access_requests", lambda limit=300: [{"ts": "2026-10-13 11:00:00 IST", "name": EVIL, "email": "a@x.com", "company": "X",
                                                                             "interest": "Build a custom agent", "message": "<script>alert(1)</script>"}])
    monkeypatch.setattr(appmod, "_agent_access_requests_raw", lambda limit=2000: [])
    from tracker import agent_feedback
    monkeypatch.setattr(agent_feedback, "summary", lambda days=30, agent_slug=None: [{"agent_slug": "company-people-intelligence", "section_key": "a", "section_label": "A", "up": 5, "down": 1, "total": 6, "down_pct": 16.7}])
    monkeypatch.setattr(agent_feedback, "list_recent", lambda agent_slug=None, rating=None, limit=200: [
        {"id": 1, "email": "e", "agent_slug": "company-people-intelligence", "run_id": "1", "section_key": "a", "section_label": EVIL, "rating": "down", "reason": EVIL, "created_at": NOW.isoformat()}])
    monkeypatch.setattr(appmod, "_fetch_agent_run_stats", lambda: {"configured": True, "cap": 3, "total_runs": 8, "total_users": 2, "users_at_cap": 1,
                                                                   "agents": [{"slug": "k", "name": EVIL, "runs": 6}], "users": []})
    c = _client(ADMIN)
    data = {s: c.get("/admin/panel/%s" % s).get_json() for s in SECTIONS}
    data["account/lumina"] = {"slug": "lumina", "name": EVIL, "space": "acct:7", "avatar": {"bg": "#FFB500", "fg": "#121213", "initials": "LD"}, "pages": [EVIL], "tools": [EVIL],
                              "tools_total": 12, "visits_30": 4, "visitors_30": 2, "runs": 3, "limit": 20,
                              "people": [{"who": EVIL, "kind": "email", "added_by": EVIL, "at": NOW.isoformat()}],
                              "by_person": [{"name": EVIL, "email": "x@y.com", "visits": 2, "runs": 1, "last": NOW.isoformat()}],
                              "audit": [{"text": EVIL, "at": NOW.isoformat()}], "events": [{"at": NOW.isoformat(), "kind": "run", "who": EVIL, "where": EVIL}]}
    return data


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_script_draws_every_section_and_escapes_what_it_was_given(monkeypatch, tmp_path):
    data = _real_json(monkeypatch)
    got = _run_script(tmp_path, data)
    out = got["out"]
    for sec in SECTIONS:
        assert out["#%sBody" % sec], sec + " drew nothing"
        assert "could not be loaded" not in out["#%sBody" % sec], sec
    assert any(u.startswith("/admin/panel/spend?days=30") for u in got["asked"])
    assert out['[data-fig="spend"]'] == "$7.50" or out['[data-fig="spend"]'].startswith("$7"), out['[data-fig="spend"]']
    assert "Lumina Dental" in out["#spendBody"] and "Market Radar" in out["#spendBody"] and "Contact Finder" in out["#spendBody"]
    assert out['[data-fig="staff"]'] == "2" and "Mia" in out["#teamBody"] and "Page 11" not in out["#teamBody"], "row detail is closed until clicked"
    assert "2,840" in out["#trafficBody"] and "From visit to member" in out["#trafficBody"]
    assert "Access requests" in out["#inboxBody"] and "Thumbs on agent reports" in out["#inboxBody"]
    assert 'data-account="lumina"' in out["#clientsBody"]
    assert "portal" not in out["#clientsBody"].lower(), "no Client portals section"
    everything = "\n".join(out.values())
    assert "<img" not in everything, "a hostile name became markup"
    assert "&lt;img src=x onerror=alert(1)&gt;" in everything, "it is shown as text"
    assert "<script>alert" not in everything and "&lt;script&gt;alert(1)&lt;/script&gt;" in out["#inboxBody"]


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_a_failing_section_shows_its_error_in_place_and_the_rest_still_draw(monkeypatch, tmp_path):
    data = _real_json(monkeypatch)
    data["__fail"] = ["team"]
    data["__error"] = "the sheet said " + EVIL
    out = _run_script(tmp_path, data)["out"]
    assert "could not be loaded" in out["#teamBody"] and 'data-retry="team"' in out["#teamBody"]
    assert "<img" not in out["#teamBody"] and "&lt;img" in out["#teamBody"], "the error text is escaped too"
    assert out["#spendBody"] and "could not be loaded" not in out["#spendBody"]
    assert out["#clientsBody"] and "could not be loaded" not in out["#clientsBody"]


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_a_link_to_one_workspace_opens_its_side_panel(monkeypatch, tmp_path):
    data = _real_json(monkeypatch)
    got = _run_script(tmp_path, data, "#client-lumina")
    assert "/admin/panel/account/lumina" in got["asked"]
    body = got["out"]["#ctlDrawerBody"]
    assert "People who can sign in" in body and "Changes to what is shared" in body and "Shared with the client" in body
    assert "<img" not in body and "&lt;img src=x onerror=alert(1)&gt;" in body


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_script_has_no_syntax_errors_and_does_not_reach_outside_the_panel():
    r = subprocess.run([NODE, "--check", os.path.join(ROOT, "static", "js", "admin_panel.js")], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    js = open(os.path.join(ROOT, "static", "js", "admin_panel.js"), encoding="utf-8").read()
    assert not re.search(r"\beval\(|document\.write|new Function", js)
    urls = set(re.findall(r"""['"](/[a-z][^'"?]*)""", js))
    assert all(u.startswith("/admin/panel/") for u in urls if u.startswith("/admin")), urls
    assert "innerHTML" in js and "function esc" in js


def test_every_figure_and_section_the_script_fills_is_in_the_page():
    html = open(os.path.join(ROOT, "templates", "admin_panel.html"), encoding="utf-8").read()
    js = open(os.path.join(ROOT, "static", "js", "admin_panel.js"), encoding="utf-8").read()
    for fig in set(re.findall(r"f\('([a-z]+)'", js)):
        assert 'data-fig="%s"' % fig in html and 'data-fig-sub="%s"' % fig in html, fig
    for sid in re.findall(r"#([a-zA-Z]+)'", js):
        if sid.startswith("ctl"):
            assert 'id="%s"' % sid in html, sid
    for sec in SECTIONS:
        assert 'id="%sBody"' % sec in html


def test_the_stylesheet_follows_the_design_rules():
    css = open(os.path.join(ROOT, "static", "css", "admin_panel.css"), encoding="utf-8").read()
    bare = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    assert "conic-gradient" not in bare and "perspective(" not in bare
    assert not re.search(r"nth-child\([^)]*\)[^{}]*\{[^}]*animation-delay", bare)
    assert "var(--page-pad)" in bare and not re.search(r"(?:^|[};])\s*\.bn-(?:shell|top)\s*\{", bare)
    assert "prefers-reduced-motion" in bare and "@media (max-width: 720px)" in bare
