"""Local Business Radar, phase 5: the website audit, including the safety of
fetching URLs that anyone can put on a Google profile."""

import os
import sys
from datetime import datetime, timezone

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tracker import lbr_http, lbr_website  # noqa: E402
from lbr_fakes import FakeResponse, FakeSession  # noqa: E402

YEAR = datetime.now(timezone.utc).year

GOOD_HTML = """<!doctype html><html><head><title>Smile Studio | Family Dentist in Austin</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Gentle family dentistry in central Austin.">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234XYZ"></script>
<script>gtag('config', 'AW-123456789');</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Dentist","name":"Smile Studio"}</script>
<link rel="stylesheet" href="/wp-content/themes/x/style.css"></head>
<body><h1>Smile Studio</h1><a href="tel:+15125550100">Call</a>
<a href="mailto:hello@smilestudio.example">Email us</a>
<a href="https://www.facebook.com/smilestudio">Facebook</a><a href="https://instagram.com/smile">IG</a>
<form><input type="email" name="email"><textarea></textarea></form>
<footer>&copy; %d Smile Studio</footer></body></html>""" % YEAR

POOR_HTML = """<html><head><title></title></head><body><p>Welcome to Joe's Plumbing</p>
<a href="/contact-us">Contact</a><footer>Copyright 2016 Joe's</footer></body></html>"""

CONTACT_HTML = """<html><body><a href="mailto:joe@joesplumbing.example">joe@joesplumbing.example</a>
<form><textarea name="msg"></textarea></form></body></html>"""


@pytest.fixture
def web(monkeypatch):
    dns = {"smilestudio.example": {"93.184.216.34"}, "joesplumbing.example": {"93.184.216.35"},
           "www.joesplumbing.example": {"93.184.216.35"}, "evil.example": {"10.0.0.5"},
           "meta.example": {"169.254.169.254"}, "mixed.example": {"93.184.216.36", "127.0.0.1"},
           "v6.example": {"fd00::1"}, "parked.example": {"93.184.216.37"}, "gone.example": {"93.184.216.38"}}

    def resolve(host):
        if host not in dns:
            import socket
            raise socket.gaierror("no such host")
        return dns[host]
    monkeypatch.setattr(lbr_website, "_resolve", resolve)
    s = FakeSession()
    monkeypatch.setattr(lbr_http, "_SESSION", s)
    monkeypatch.setattr(lbr_http.time, "sleep", lambda x: None)
    monkeypatch.delenv("PAGESPEED_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_MAPS_API_KEY", raising=False)
    return s


# ── Before fetching ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("link,kind", [
    ("", "none"), ("https://www.facebook.com/joes", "social_only"), ("instagram.com/joes", "social_only"),
    ("https://linktr.ee/joes", "social_only"), ("https://www.yelp.com/biz/joes", "listing_only"),
    ("https://www.zocdoc.com/practice/x", "listing_only"), ("https://joes-plumbing.business.site/", "google_site_retired"),
    ("https://joesplumbing.example", "site"), ("https://notfacebook.com", "site"),
])
def test_what_a_profile_link_is(link, kind):
    assert lbr_website.classify_link(link) == kind


def test_no_site_needs_no_fetch_and_says_why(web):
    out = lbr_website.audit({"website": "https://joes-plumbing.business.site"}, lbr_http.Ledger())
    assert out["kind"] == "google_site_retired" and out["needs_site"]
    assert "2024" in out["issues"][0]["text"] and web.requests == []


# ── Safety ───────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("url", ["http://evil.example/", "http://meta.example/latest/meta-data",
                                 "http://mixed.example/", "http://v6.example/", "http://localhost/",
                                 "file:///etc/passwd", "ftp://smilestudio.example/", "http://127.0.0.1/"])
def test_private_and_internal_addresses_are_never_fetched(web, url):
    with pytest.raises(lbr_website.Blocked):
        lbr_website.check_public(url)


def test_a_redirect_into_the_private_network_is_refused(web):
    web.on("smilestudio.example", FakeResponse(302, headers={"Location": "http://meta.example/latest/"}))
    out = lbr_website.fetch("https://smilestudio.example/")
    assert out["error"].startswith("blocked") and len(web.requests) == 1


def test_redirects_are_followed_and_capped(web):
    web.on("joesplumbing.example", FakeResponse(301, headers={"Location": "https://joesplumbing.example/"}))
    out = lbr_website.fetch("http://joesplumbing.example/")
    assert out["error"] == "redirect_loop" and len(web.requests) == lbr_website.MAX_REDIRECTS + 1


# ── A working site ───────────────────────────────────────────────────────────

def test_a_good_site_is_read_fully(web):
    web.on("smilestudio.example", FakeResponse(200, text=GOOD_HTML))
    out = lbr_website.audit({"website": "https://smilestudio.example"}, lbr_http.Ledger())
    assert out["kind"] == "ok" and not out["needs_site"]
    c = out["checks"]
    assert c["https"] and c["mobile"] and c["click_to_call"] and c["contact_form"] and c["local_schema"]
    assert c["fresh"] and c["analytics"] and c["email"]
    assert out["emails"] == ["hello@smilestudio.example"]
    assert set(out["socials"]) == {"facebook", "instagram"}
    assert out["builder"] == "WordPress" and out["runs_ads"] is True
    assert {"google_analytics", "google_ads"} <= set(out["tags"])
    assert out["score"] == 100 and out["issues"] == []
    assert out["speed"] is None, "no PageSpeed key: not checked, not failed"


def test_a_poor_site_lists_what_to_fix_and_finds_the_email_on_the_contact_page(web):
    web.on("joesplumbing.example/contact-us", FakeResponse(200, text=CONTACT_HTML))
    web.on("joesplumbing.example", FakeResponse(200, text=POOR_HTML))
    out = lbr_website.audit({"website": "http://joesplumbing.example"}, lbr_http.Ledger())
    assert out["kind"] == "ok"
    keys = {i["key"] for i in out["issues"]}
    assert {"https", "mobile", "click_to_call", "local_schema", "fresh", "analytics"} <= keys
    assert "contact_form" not in keys, "the contact page has a form"
    assert out["emails"] == ["joe@joesplumbing.example"] and out["copyright_year"] == 2016
    assert out["runs_ads"] is False and out["score"] < 50


@pytest.mark.parametrize("resp,kind", [
    (FakeResponse(404, text="Not found"), "broken"),
    (FakeResponse(200, text="<html><body>This domain is for sale! Buy this domain today.</body></html>"), "parked"),
])
def test_broken_and_parked_sites_need_a_new_one(web, resp, kind):
    web.on("parked.example", resp)
    out = lbr_website.audit({"website": "https://parked.example"}, lbr_http.Ledger())
    assert out["kind"] == kind and out["needs_site"]


def test_a_domain_that_does_not_resolve_is_dead(web):
    out = lbr_website.audit({"website": "https://nosuchdomain.example"}, lbr_http.Ledger())
    assert out["kind"] == "dead" and out["needs_site"]


def test_a_site_that_redirects_to_facebook_is_social_only(web):
    web.on("gone.example", FakeResponse(301, headers={"Location": "https://www.facebook.com/joes"}))
    web.on("facebook.com", FakeResponse(200, text="<html>fb</html>"))
    import socket
    real = lbr_website._resolve
    lbr_website._resolve = lambda h: {"157.240.1.35"} if "facebook" in h else real(h)
    try:
        out = lbr_website.audit({"website": "https://gone.example"}, lbr_http.Ledger())
    finally:
        lbr_website._resolve = real
    assert out["kind"] == "social_only" and out["needs_site"]


# ── PageSpeed ────────────────────────────────────────────────────────────────

def test_pagespeed_scores_and_vitals_are_read_and_a_slow_site_is_flagged(web, monkeypatch):
    monkeypatch.setenv("PAGESPEED_API_KEY", "psi")
    web.on("pagespeedonline", FakeResponse(200, {
        "lighthouseResult": {"categories": {"performance": {"score": 0.27}, "seo": {"score": 0.91}},
                             "audits": {"largest-contentful-paint": {"numericValue": 6123.4},
                                        "cumulative-layout-shift": {"numericValue": 0.21},
                                        "total-blocking-time": {"numericValue": 890}}},
        "loadingExperience": {"overall_category": "SLOW"}}))
    web.on("smilestudio.example", FakeResponse(200, text=GOOD_HTML))
    ledger = lbr_http.Ledger()
    out = lbr_website.audit({"website": "https://smilestudio.example"}, ledger)
    assert out["speed"] == {"performance": 27, "seo": 91, "lcp_ms": 6123.4, "cls": 0.21, "tbt_ms": 890,
                            "field": "slow"}
    speed = next(i for i in out["issues"] if i["key"] == "speed")
    assert speed["severity"] == "high" and "27/100" in speed["text"]
    psi = next(r for r in web.requests if "pagespeedonline" in r["url"])
    assert ("strategy", "mobile") in psi["params"] and ("key", "psi") in psi["params"]
    assert out["score"] < 100


def test_one_odd_site_never_ends_the_run(web, monkeypatch):
    def boom(prof, ledger):
        raise RuntimeError("weird")
    monkeypatch.setattr(lbr_website, "audit", boom)
    out = lbr_website.run(["p1"], {"p1": {"website": "https://x.example"}}, lbr_http.Ledger())
    assert out["p1"]["kind"] == "blocked" and out["p1"]["error"] == "RuntimeError"
