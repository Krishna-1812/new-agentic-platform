"""Sign-in is for the team alone (STAFF_ONLY in app.py).

Only staff -- an @markifydigital.com address, or an admin on any domain (Krishna's personal Gmail) -- may sign
in. Anyone else is refused at /auth/google, a session that is already open for someone else is closed on the
next request, and the public member area (/app) is gone: it sends everyone to the staff hub.
"""

import os
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as appmod  # noqa: E402

STAFF = "someone@markifydigital.com"
KRISHNA_GMAIL = "ladhakrishna2022@gmail.com"
OUTSIDER = "someone@gmail.com"
CLIENT = "ops@acme-dental.com"


def _client(email=None):
    c = appmod.app.test_client()
    if email:
        with c.session_transaction() as sess:
            sess["google_user"] = {"email": email, "name": "T"}
    return c


@pytest.fixture
def google(monkeypatch):
    """/auth/google with Google's token check answering for whatever address the test names."""
    from google.oauth2 import id_token
    seen = {}

    def verify(credential, request, audience):
        return dict(seen["info"])
    monkeypatch.setattr(id_token, "verify_oauth2_token", verify)
    for name in ("_log_login_to_sheet", "_log_member_signin", "_remember_person"):
        monkeypatch.setattr(appmod, name, lambda *a, **k: None)
    monkeypatch.setattr(appmod, "GOOGLE_CLIENT_ID", "test")

    def sign_in(email, **extra):
        seen["info"] = {"email": email, "name": "T", "email_verified": True, **extra}
        c = appmod.app.test_client()
        r = c.post("/auth/google", json={"credential": "x.y.z"})
        with c.session_transaction() as sess:
            signed_in = (sess.get("google_user") or {}).get("email")
        return r, signed_in
    return sign_in


def test_the_switch_is_on():
    assert appmod.STAFF_ONLY is True


@pytest.mark.parametrize("email", [STAFF, "KRIS@markifydigital.com", KRISHNA_GMAIL, "sudheer@markifydigital.com"])
def test_staff_and_krishnas_gmail_can_sign_in_and_land_on_the_hub(google, email):
    r, signed_in = google(email)
    assert r.status_code == 200 and r.get_json() == {"success": True, "redirect": "/hub"}
    assert signed_in == email


@pytest.mark.parametrize("email", [OUTSIDER, CLIENT, "someone@position2.com",
                                   "someone@markifydigital.com.evil.com", "markifydigital.com@gmail.com", ""])
def test_anyone_else_is_refused_and_gets_no_session(google, email):
    r, signed_in = google(email)
    assert r.status_code == 403
    assert r.get_json() == {"success": False, "error": appmod.STAFF_ONLY_REFUSAL}
    assert signed_in is None


def test_a_staff_address_google_has_not_verified_is_refused(google):
    r, signed_in = google(STAFF, email_verified=False)
    assert r.status_code == 403 and signed_in is None


def test_an_outsider_already_signed_in_is_signed_out_on_the_next_request():
    c = _client(OUTSIDER)
    r = c.get("/hub")
    assert r.status_code == 302 and "/login" in r.headers["Location"]
    with c.session_transaction() as sess:
        assert "google_user" not in sess


def test_a_staff_session_is_kept():
    c = _client(STAFF)
    assert c.get("/hub").status_code == 200
    with c.session_transaction() as sess:
        assert sess["google_user"]["email"] == STAFF


@pytest.mark.parametrize("path", ["/app", "/app/", "/app/keyword-finder", "/app/keyword-finder/use",
                                  "/app/history", "/app/history/3", "/app/settings"])
@pytest.mark.parametrize("email", [None, STAFF, OUTSIDER])
def test_the_public_app_area_is_gone(path, email):
    r = _client(email).get(path)
    assert r.status_code == 302 and r.headers["Location"].endswith("/hub")


@pytest.mark.parametrize("path", ["/app/keyword-finder/request-access", "/app/keyword-finder/use/log-run",
                                  "/app/keyword-finder/use/finish-run"])
def test_the_public_app_area_takes_no_posts(path):
    assert _client(STAFF).post(path, json={}).status_code == 404


def test_a_logged_out_visitor_to_app_ends_on_the_sign_in_page():
    r = appmod.app.test_client().get("/app", follow_redirects=True)
    assert r.status_code == 200 and b"For the Markify Digital team" in r.data


def test_the_sign_in_page_says_it_is_for_the_team_and_drops_the_new_account_line():
    page = appmod.app.test_client().get("/login").data
    assert b"For the Markify Digital team" in page
    assert b"The same click creates your account" not in page and b"set you up automatically" not in page


def test_a_signed_in_staff_member_opening_the_sign_in_page_goes_to_the_hub():
    r = _client(STAFF).get("/login")
    assert r.status_code == 302 and r.headers["Location"].endswith("/hub")


def test_the_public_marketing_site_still_opens():
    for path in ("/", "/gtm-engineering", "/pricing", "/book", "/old-site", "/old-site/agents", "/privacy", "/terms"):
        assert appmod.app.test_client().get(path).status_code == 200


def test_turning_the_switch_off_opens_sign_in_again(google, monkeypatch):
    monkeypatch.setattr(appmod, "STAFF_ONLY", False)
    r, signed_in = google(OUTSIDER)
    assert r.status_code == 200 and signed_in == OUTSIDER
