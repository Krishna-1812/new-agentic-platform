"""Tests for the public marketing pages: the /security
removal, the privacy and terms pages, and no stray compliance certification claims (HIPAA/SOC 2/ISO 27001)
that don't apply to this product.
"""

import os
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as appmod  # noqa: E402


@pytest.fixture
def client():
    return appmod.app.test_client()


def test_security_page_is_gone(client):
    assert client.get("/security").status_code == 404


def test_no_page_links_to_security(client):
    """The page used to be linked from the home teaser, the resources card and
    the footer nav; all three must be repointed, not just the route removed."""
    for path in ("/", "/resources", "/agents"):
        body = client.get(path).data.decode("utf-8")
        assert "/security" not in body, "%s still links to the removed page" % path


def test_no_agent_is_named_or_slugged_for_hipaa(client):
    """A product-name-level compliance claim (e.g. "HIPAA-Aware ... Auditor")
    is exactly the kind of hardcore claim that had to come off pre-login pages.
    That agent card lives on the healthcare industry page, not /agents."""
    for path in ("/agents", "/industries/healthcare"):
        body = client.get(path).data.decode("utf-8")
        assert "hipaa" not in body.lower(), "%s still names/slugs a HIPAA agent" % path


def test_privacy_and_terms_pages_exist_and_are_public(client):
    """Google's app verification reads these two pages without signing in, and
    a signed-out visitor must be able to open them."""
    for path, heading in (("/privacy", "Privacy"), ("/terms", "Terms of")):
        r = client.get(path)
        assert r.status_code == 200, path
        body = r.data.decode("utf-8")
        assert heading in body, path
        assert "<title>" in body and appmod.BRAND["name"] in body.split("</title>")[0], path


def test_privacy_policy_says_what_google_sign_in_gives_us(client):
    """Google rejected the earlier page for too little content: it has to say what
    is collected from the Google account, why, who else sees it, retention and
    how to have it deleted."""
    body = client.get("/privacy").data.decode("utf-8").lower()
    for needle in ("name, email address and profile picture", "do not read your email",
                   "how we use it", "who else handles it", "how long we keep it",
                   "delete", "myaccount.google.com/permissions", "do not sell personal information"):
        assert needle in body, needle
    assert len(body) > 6000


def test_the_pages_name_the_same_app_as_the_home_page(client):
    """Google compares the consent-screen app name with the home page. The home
    page title and both legal pages must say the same name."""
    name = appmod.BRAND["name"]
    for path in ("/", "/privacy", "/terms"):
        title = client.get(path).data.decode("utf-8").split("</title>")[0]
        assert name in title, path


def test_the_contact_address_comes_from_the_environment(client, monkeypatch):
    monkeypatch.delenv("LEGAL_CONTACT_EMAIL", raising=False)
    assert "mailto:" not in client.get("/privacy").data.decode("utf-8")
    monkeypatch.setenv("LEGAL_CONTACT_EMAIL", "privacy@example.com")
    assert 'mailto:privacy@example.com' in client.get("/privacy").data.decode("utf-8")
    assert 'mailto:privacy@example.com' in client.get("/terms").data.decode("utf-8")
    monkeypatch.setenv("LEGAL_CONTACT_EMAIL", "not an address")
    assert "mailto:" not in client.get("/privacy").data.decode("utf-8")


def test_robots_lets_crawlers_read_the_legal_pages(client):
    body = client.get("/robots.txt").data.decode("utf-8")
    assert "Allow: /privacy" in body and "Allow: /terms" in body


@pytest.mark.parametrize("path", ["/", "/agents", "/resources", "/platform", "/signals",
                                  "/solutions", "/why-intelligence", "/integrations",
                                  "/industries", "/login"])
def test_every_public_page_links_to_privacy_and_terms(client, path):
    """Google wants the policy linked from the home page; the footer carries it everywhere."""
    body = client.get(path).data.decode("utf-8")
    for link in ('href="/privacy"', 'href="/terms"'):
        assert link in body, "%s does not link to %s" % (path, link)


def test_the_cookie_banner_does_not_link_to_privacy():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, "static", "js", "visitor_track.js"), encoding="utf-8") as fh:
        assert 'href="/privacy"' not in fh.read()
