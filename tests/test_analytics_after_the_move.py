"""The admin analytics pages after the 2026-09-24 moves.

Two changes that day each quietly broke the analytics, and a third problem
kept either from being noticed:

  1. Staff moved from @position2.com to @markifydigital.com. The analytics
     sheets keep the address each row was written with, so the team's whole
     history -- every login, page view and agent run before that day -- was
     classified as public members: Internal Usage lost it, and External
     Usage, Public Page Analytics and Client Usage filled up with the team.
     _was_staff() counts the former domain as staff for RECORDED rows only;
     access still goes through _is_staff(), which it does not change.

  2. _page_label folded renamed paths with a bare substring match, so every
     "/p2/seo-aeo/..." view recorded between the SEO + AEO rename and the
     /p2 move went through the "/p2/seo" rule a second time and came out as
     "/seo-aeo-aeo/...". Path rules now match whole segments.

  3. Every sheet reader swallows its own failure, so a server without the
     variables, or with a key the sheet is not shared with, showed pages of
     zeros and no reason. /admin/analytics-health asks whether the sheet can
     be opened, and each analytics page shows the answer at the top.
"""

import json
import os
import re
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import app as appmod  # noqa: E402

LOGIN_HEADER = ["Timestamp (IST)", "Date", "Time (IST)", "Day of Week", "Hour (IST)", "Email",
                "Full Name", "First Name", "Profile Picture", "IP Address", "Browser",
                "Browser Version", "OS", "Device", "User Agent", "Referrer", "Landing Page",
                "Auth Method", "Session ID", "Platform", "Visitor ID"]
PV_HEADER = ["Timestamp (IST)", "Date", "Time (IST)", "Day", "Email", "Page Title", "Page URL",
             "Seconds", "Duration", "IP", "Browser", "OS", "Device", "Visitor ID"]


def _login(ts, email):
    return [ts, ts[:10], ts[11:19], "Monday", ts[11:13], email, email.split("@")[0], "", "",
            "10.0.0.1", "Chrome", "129", "macOS", "Desktop", "UA", "direct", "/hub",
            "Google OAuth", "s1", "intelligence.position2.com", "v-" + email.split("@")[0]]


def _pv(ts, email, title, url):
    return [ts, ts[:10], ts[11:19], "Monday", email, title, url, "60", "1m 0s",
            "10.0.0.1", "Chrome", "macOS", "Desktop", ""]


# Two staff logins from before the move, one after, and one public member.
TABS = {
    "A:U": [LOGIN_HEADER,
            _login("2026-09-10 10:00:00 IST", "priya@position2.com"),
            _login("2026-09-20 10:00:00 IST", "arjun@position2.com"),
            _login("2026-09-25 10:00:00 IST", "priya@markifydigital.com")],
    "Member Signins!A:T": [appmod._MS_HEADER,
                           ["2026-09-21 09:00:00 IST", "2026-09-21", "09:00:00", "Monday", "09",
                            "dana@acmehealth.com", "Dana Cole", "Dana", "", "v-dana", "10.1.0.1",
                            "Chrome", "129", "macOS", "Desktop", "UA", "google.com", "/app",
                            "m1", "intelligence.position2.com"]],
    "Page Views!A:N": [PV_HEADER,
                       _pv("2026-09-10 10:05:00 IST", "priya@position2.com", "Hub", "/p2/hub"),
                       _pv("2026-09-20 10:05:00 IST", "arjun@position2.com", "Keyword Research",
                           "/p2/seo-aeo/keyword-research"),
                       _pv("2026-09-25 10:05:00 IST", "priya@markifydigital.com", "Hub", "/hub"),
                       _pv("2026-09-21 09:05:00 IST", "dana@acmehealth.com", "Agents", "/app")],
    "Visitor Analytics!A:AM": [appmod._VA_HEADER],
}


@pytest.fixture
def sheet(monkeypatch):
    monkeypatch.setattr(appmod, "LOGIN_LOG_SHEET_ID", "fake-sheet-id")
    monkeypatch.setenv("GOOGLE_SA_JSON", json.dumps({"type": "service_account",
                                                     "client_email": "reader@proj.iam.gserviceaccount.com"}))
    state = {"meta_error": None}

    class Exec:
        def __init__(self, fn):
            self.fn = fn

        def execute(self):
            return self.fn()

    class FakeSvc:
        def spreadsheets(self):
            return self

        def values(self):
            return self

        def get(self, spreadsheetId=None, range=None, fields=None, **kw):
            if range is None:  # spreadsheets().get(): the health check's metadata read
                def meta():
                    if state["meta_error"]:
                        raise state["meta_error"]
                    return {"properties": {"title": "Login Log"}}
                return Exec(meta)
            return Exec(lambda: {"values": TABS.get(range, [])})

    import googleapiclient.discovery as _disc
    monkeypatch.setattr(_disc, "build", lambda *a, **k: FakeSvc())

    class _FakeCreds:
        @staticmethod
        def from_service_account_info(*a, **k):
            return object()

    import google.oauth2.service_account as _sa
    monkeypatch.setattr(_sa, "Credentials", _FakeCreds)
    monkeypatch.setattr(appmod, "_agent_run_rows", lambda force=False: [])
    appmod._SHEET_HEALTH.update(ts=0.0, val=None)
    yield state
    appmod._SHEET_HEALTH.update(ts=0.0, val=None)


# ── 1. The team's history before the domain move ────────────────────────────

def test_a_former_staff_address_counts_as_staff_in_analytics_but_gets_no_access():
    assert appmod._was_staff("priya@position2.com")
    assert appmod._was_staff("PRIYA@Position2.com ")
    assert appmod._was_staff("priya@markifydigital.com")
    assert appmod._was_staff("ladhakrishna2022@gmail.com")
    assert not appmod._was_staff("dana@acmehealth.com")
    assert not appmod._was_staff("someone@notposition2.com")
    # Access is unchanged: a former-domain address is not staff today.
    assert not appmod._is_staff("priya@position2.com")


def test_internal_usage_keeps_the_logins_from_before_the_move(sheet):
    d = appmod._fetch_usage_data(internal=True)
    assert d["total_logins"] == 3
    assert d["unique_users"] == 3


def test_external_usage_does_not_list_the_team(sheet):
    d = appmod._fetch_usage_data(internal=False)
    body = json.dumps(d)
    assert "dana@acmehealth.com" in body
    assert "position2.com" not in body, "former staff are listed as external people"
    assert "markifydigital.com" not in body


def test_every_analytics_reader_classifies_with_was_staff():
    """The five places recorded rows are split into team and public."""
    src = open(os.path.join(ROOT, "app.py"), encoding="utf-8").read()
    for line in ('entry["type"] = "staff" if _was_staff(entry["email"]) else "member"',
                 'if e and (not _was_staff(e) or path.startswith("/app")):',
                 'external_out = [x for x in out_members if not _was_staff(x["email"])]',
                 "def _is_p2(e): return _was_staff(e)"):
        assert line in src, line
    assert re.search(r"def seg_of\(email\):\s+e = \(email or \"\"\)\.lower\(\)\s+if _was_staff\(e\):", src)


# ── 2. Renamed paths fold once ──────────────────────────────────────────────

@pytest.mark.parametrize("recorded,today", [
    ("/p2/seo-aeo/keyword-research", "/seo-aeo/keyword-research"),
    ("/p2/seo-aeo", "/seo-aeo"),
    ("/p2/seo/keyword-research", "/seo-aeo/keyword-research"),
    ("/p2/seo", "/seo-aeo"),
    ("/p2/seo?tool=x", "/seo-aeo?tool=x"),
    ("/seo-aeo/gbp-qc", "/seo-aeo/gbp-qc"),
    ("/p2/gtm/ad-intelligence", "/strategic-agents/ad-intelligence"),
    ("/p2/b2b-agents/gentle-dental-slot-checker", "/strategic-agents/42-north-dental-slot-checker"),
    ("/p2/strategic-agents", "/strategic-agents"),
    ("/p2/hub", "/hub"),
    ("SEO Dashboards", "SEO + AEO Dashboards"),
    ("SEO + AEO Dashboards", "SEO + AEO Dashboards"),
])
def test_a_recorded_page_folds_to_its_current_name_exactly_once(recorded, today):
    assert appmod._page_label(recorded) == today


# ── 3. A sheet that cannot be read says so ──────────────────────────────────

def _admin_client():
    c = appmod.app.test_client()
    with c.session_transaction() as s:
        s["google_user"] = {"email": "sudheer@markifydigital.com", "name": "S"}
    return c


def test_the_health_check_names_the_missing_variables(monkeypatch):
    monkeypatch.setattr(appmod, "LOGIN_LOG_SHEET_ID", "")
    monkeypatch.delenv("GOOGLE_SA_JSON", raising=False)
    appmod._SHEET_HEALTH.update(ts=0.0, val=None)
    d = _admin_client().get("/admin/analytics-health?fresh=1").get_json()
    assert d["ok"] is False and d["configured"] is False
    assert "GOOGLE_SA_JSON" in d["detail"] and "LOGIN_LOG_SHEET_ID" in d["detail"]
    appmod._SHEET_HEALTH.update(ts=0.0, val=None)


def test_the_health_check_passes_when_the_sheet_opens(sheet):
    d = _admin_client().get("/admin/analytics-health?fresh=1").get_json()
    assert d["ok"] is True


def test_a_sheet_not_shared_with_the_key_names_the_address_to_share_with(sheet):
    class Resp:
        status = 403

    class HttpErr(Exception):
        resp = Resp()

    sheet["meta_error"] = HttpErr("forbidden")
    d = _admin_client().get("/admin/analytics-health?fresh=1").get_json()
    assert d["ok"] is False and d["configured"] is True
    assert "reader@proj.iam.gserviceaccount.com" in d["detail"]
    assert "Share the sheet" in d["detail"]


def test_the_health_check_is_admin_only():
    c = appmod.app.test_client()
    with c.session_transaction() as s:
        s["google_user"] = {"email": "dana@acmehealth.com", "name": "D"}
    assert c.get("/admin/analytics-health").status_code in (302, 403)


@pytest.mark.parametrize("path", ["/admin/internal-usage", "/admin/external-usage",
                                  "/admin/client-usage", "/admin/anonymous-traffic",
                                  "/admin/public-page-analytics", "/admin/public-agent-usage",
                                  "/admin/access-requests"])
def test_every_sheet_backed_page_shows_the_health_note(path):
    body = _admin_client().get(path).get_data(as_text=True)
    assert 'id="admHealth"' in body
    assert "/admin/analytics-health" in body


def test_no_page_writes_an_icon_into_text():
    """textContent = '<svg ...>' prints the markup itself as visible text."""
    tdir = os.path.join(ROOT, "templates")
    for name in os.listdir(tdir):
        if name.endswith(".html"):
            src = open(os.path.join(tdir, name), encoding="utf-8").read()
            assert not re.search(r"\.(?:textContent|innerText)\s*=\s*['\"]<svg", src), name
