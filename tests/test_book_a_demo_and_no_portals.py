"""Since 2026-10-23: the public site asks people to book a demo, the two client portals are gone, and the
Slot Checker is the Slot Checker Agent.

Sign-in is for the team only (tests/test_staff_only_signin.py), so the public site's "Sign up" buttons
and its one-click Google sign-up pop-up went too: every one of them now opens the demo form. The client
portals (NorthStar Anesthesia, 42 North Dental) were removed with their pages, logos, analytics and
data; the Slot Checker dashboard stays, under a plain name and address.
"""

import os
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import app as appmod  # noqa: E402

# The previous site, kept at /old-site since the October 2026 rebuild. The new site asks for a call
# instead (tests/test_new_site.py).
PUBLIC = ["/old-site", "/old-site/agents", "/old-site/platform", "/old-site/signals", "/old-site/solutions",
          "/old-site/why-intelligence", "/old-site/integrations", "/old-site/resources", "/old-site/industries"]


def _page(path):
    r = appmod.app.test_client().get(path)
    assert r.status_code == 200, path
    return r.get_data(as_text=True)


def _staff():
    c = appmod.app.test_client()
    with c.session_transaction() as sess:
        sess["google_user"] = {"email": "someone@markifydigital.com", "name": "T"}
    return c


@pytest.mark.parametrize("path", PUBLIC)
def test_the_public_pages_offer_a_demo_and_no_sign_up(path):
    body = _page(path)
    assert "data-signup" not in body and ">Sign up<" not in body
    assert 'data-demo data-interest="Book a demo">Book a demo</button>' in body


@pytest.mark.parametrize("path", PUBLIC)
def test_the_google_sign_up_pop_up_is_gone(path):
    body = _page(path)
    assert 'id="suOv"' not in body and "suGsiBtn" not in body


def test_the_demo_form_opens_on_book_a_demo():
    body = _page("/old-site")
    assert 'id="leadOv"' in body
    assert '<button type="button" class="f-pill on" data-interest="Book a demo">Book a demo</button>' in body


def test_an_agent_page_offers_a_demo_and_its_custom_version():
    slug = appmod.AGENTS[0]["slug"]
    body = _page("/old-site/agents/" + slug)
    assert "data-signup" not in body
    assert 'data-interest="Build a custom agent"' in body and ">Book a demo</button>" in body


def test_the_tracker_counts_book_a_demo_as_a_lead():
    js = open(os.path.join(ROOT, "static", "js", "visitor_track.js"), encoding="utf-8").read()
    assert "data-signup" not in js and '"Book a demo"' in js


@pytest.mark.parametrize("path", ["/northstaranesthesia", "/42northdental", "/42northdental/agents/slot-checker",
                                  "/northstaranesthesia/agents/linkedin-intelligence/dashboard/data",
                                  "/northstaranesthesia/history"])
def test_the_client_portals_are_gone(path):
    assert _staff().get(path).status_code == 404


def test_nothing_is_left_of_the_portal_registry():
    for name in ("CLIENTS", "_client_gate", "_client_home", "_fetch_client_usage", "_SLOT_CHECKER_CLIENT_AGENT"):
        assert not hasattr(appmod, name), name
    assert not os.path.exists(os.path.join(ROOT, "static", "clients"))
    for t in ("client_portal", "client_agent", "client_base", "client_denied", "client_embed", "client_history",
              "client_history_detail"):
        assert not os.path.exists(os.path.join(ROOT, "templates", t + ".html")), t


def test_the_admin_portal_analytics_are_gone():
    c = appmod.app.test_client()
    with c.session_transaction() as sess:
        sess["google_user"] = {"email": "kris@markifydigital.com", "name": "K"}
    assert c.get("/admin/client-usage/northstaranesthesia").status_code == 404
    assert c.get("/admin/client-usage/42northdental/data").status_code == 404


def test_the_agents_page_lists_the_slot_checker_agent_under_its_new_name():
    body = _staff().get("/strategic-agents").get_data(as_text=True)
    assert "Slot Checker Agent" in body and 'href="/strategic-agents/slot-checker"' in body
    assert "42 North" not in body and "42-north-dental" not in body


def test_no_page_template_or_script_names_either_client():
    """The Slot Checker's own data keeps the practices' real brand names (Gentle Dental and others), and
    the old addresses still redirect; neither is a page that names the clients."""
    offenders = []
    for folder in ("templates", os.path.join("static", "js"), os.path.join("static", "css")):
        for name in os.listdir(os.path.join(ROOT, folder)):
            path = os.path.join(ROOT, folder, name)
            if not os.path.isfile(path):
                continue
            text = open(path, encoding="utf-8", errors="ignore").read().lower()
            if any(n in text for n in ("42 north", "42northdental", "42-north-dental", "northstar")):
                offenders.append(os.path.join(folder, name))
    assert not offenders, offenders
