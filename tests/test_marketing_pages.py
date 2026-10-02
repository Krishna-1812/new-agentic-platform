"""Tests for the public marketing pages: the /security, /privacy and /terms
removals, and no stray compliance certification claims (HIPAA/SOC 2/ISO 27001)
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


def test_privacy_and_terms_pages_are_gone(client):
    """The privacy policy and terms of use were the previous company's text
    with this brand's name swapped in, not ours, so both pages were removed
    until outcomes.digital's own versions replace them."""
    for path in ("/privacy", "/terms"):
        assert client.get(path).status_code == 404, path


@pytest.mark.parametrize("path", ["/", "/agents", "/resources", "/platform", "/signals",
                                  "/solutions", "/why-intelligence", "/integrations",
                                  "/industries", "/login"])
def test_no_page_links_to_privacy_or_terms(client, path):
    """The pages were linked from the footer, the home page's privacy section
    and a resources card; every link has to go, not just the routes."""
    body = client.get(path).data.decode("utf-8")
    for gone in ('href="/privacy"', 'href="/terms"'):
        assert gone not in body, "%s still links to %s" % (path, gone)


def test_the_cookie_banner_does_not_link_to_privacy():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, "static", "js", "visitor_track.js"), encoding="utf-8") as fh:
        assert 'href="/privacy"' not in fh.read()
