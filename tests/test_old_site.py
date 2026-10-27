"""The previous public site, kept at /old-site.

Before the site moved to GTM engineering and performance marketing, the whole public site was parked
at /old-site so anyone can still see it. These tests hold the three promises that makes: every old
page still opens there, a visitor who follows its links stays inside /old-site, and search engines
are told not to index any of it. The live pages at the top level are unchanged by the parking.
"""

import os
import re
import sys
from unittest.mock import patch

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as appmod  # noqa: E402


@pytest.fixture
def client():
    return appmod.app.test_client()


def _old_pages():
    ind = appmod.INDUSTRIES[0]
    ind_agent = next(a for a in ind["agents"] if a.get("slug"))
    return ["/old-site", "/old-site/", "/old-site/platform", "/old-site/signals", "/old-site/agents",
            "/old-site/agents/" + appmod.AGENTS[0]["slug"], "/old-site/solutions",
            "/old-site/why-intelligence", "/old-site/industries", "/old-site/industries/" + ind["slug"],
            "/old-site/industries/%s/agents/%s" % (ind["slug"], ind_agent["slug"]),
            "/old-site/integrations", "/old-site/resources"]


# Pages a link from the old site may leave /old-site for: shared pages, not part of either site's set.
_SHARED = ("/login", "/logout", "/hub", "/privacy", "/terms", "/static/", "/favicon", "/api/", "/auth/")


def _links(html):
    return re.findall(r'href="(/[^"]*)"', html)


def test_every_page_of_the_old_site_opens(client):
    for path in _old_pages():
        r = client.get(path)
        assert r.status_code == 200, path


def test_the_old_home_page_is_the_old_home_page(client):
    html = client.get("/old-site").get_data(as_text=True)
    assert "Every deal starts" in html


def test_a_signed_in_visitor_still_sees_the_old_home_page(client):
    with client.session_transaction() as s:
        s["google_user"] = {"email": "someone@markifydigital.com", "name": "Someone"}
    r = client.get("/old-site")
    assert r.status_code == 200


def test_links_on_the_old_site_stay_inside_it(client):
    for path in _old_pages():
        html = client.get(path).get_data(as_text=True)
        for href in _links(html):
            if href.startswith(_SHARED):
                continue
            # The banner's one link out, to the new site.
            if href == "/" and 'class="old-bar"' in html:
                continue
            assert href.startswith("/old-site"), (path, href)


def test_every_old_page_says_noindex_and_shows_the_banner(client):
    for path in _old_pages():
        html = client.get(path).get_data(as_text=True)
        assert '<meta name="robots" content="noindex, follow">' in html, path
        assert "This is our previous site" in html, path


def test_robots_txt_does_not_list_the_old_site(client):
    body = client.get("/robots.txt").get_data(as_text=True)
    assert "old-site" not in body
    assert "Disallow: /" in body


def test_unknown_old_pages(client):
    assert client.get("/old-site/no-such-page").status_code == 404
    r = client.get("/old-site/agents/no-such-agent")
    assert r.status_code == 302 and r.headers["Location"].endswith("/old-site/agents")
    r = client.get("/old-site/industries/no-such-industry")
    assert r.status_code == 302 and r.headers["Location"].endswith("/old-site/industries")
    ind = appmod.INDUSTRIES[0]["slug"]
    r = client.get("/old-site/industries/%s/agents/no-such-agent" % ind)
    assert r.status_code == 302 and r.headers["Location"].endswith("/old-site/industries/" + ind)


def test_the_live_pages_are_unchanged(client):
    """Parking the old site does not touch the live pages: no banner, no noindex, links at the top level."""
    for path in ("/", "/platform", "/signals", "/agents", "/industries", "/why-intelligence"):
        html = client.get(path).get_data(as_text=True)
        assert "old-bar" not in html, path
        assert 'name="robots"' not in html, path
        assert not any(h.startswith("/old-site") for h in _links(html)), path
    assert 'href="/platform"' in client.get("/").get_data(as_text=True)


def test_the_old_sites_booking_form_is_marked_old_site(client):
    html = client.get("/old-site").get_data(as_text=True)
    assert "source:'old site'" in html
    assert "source:'old site'" not in client.get("/").get_data(as_text=True)
    rows = []
    with patch.object(appmod, "_demo_request_to_sheet", side_effect=lambda row: rows.append(row) or True), \
         patch.object(appmod, "_demo_request_to_slack", return_value=True), \
         patch.object(appmod, "_demo_request_to_email", return_value=True):
        client.post("/api/demo-request", json={"name": "A", "email": "a@b.co", "source": "old site"})
        client.post("/api/demo-request", json={"name": "A", "email": "a@b.co"})
        client.post("/api/demo-request", json={"name": "A", "email": "a@b.co", "source": "anything else"})
    assert [r[8] for r in rows] == ["old site", "login page", "login page"]


def test_no_client_account_can_take_the_old_site_address():
    with appmod.app.app_context():
        assert "old-site" in appmod._acct_reserved()
