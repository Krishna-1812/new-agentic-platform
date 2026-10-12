"""Market Radar: what Wikidata and Wikipedia say about a company its own website cannot describe
(tracker/market_radar_outside.py), and how honestly a profile says how much it saw. No network."""
import json
import os
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import market_radar_outside as out  # noqa: E402
from tracker import market_radar_profile as prof  # noqa: E402


def _claim(value, **qualifiers):
    return {"mainsnak": {"snaktype": "value", "datavalue": {"value": value}}, "qualifiers": qualifiers}


def _item(website, **extra):
    claims = {"P856": [_claim(website)], "P571": [_claim({"time": "+1999-01-01T00:00:00Z"})],
              "P1128": [_claim({"amount": "+120"}, P585=[{"datavalue": {"value": {"time": "+2022-01-01T00:00:00Z"}}}]),
                        _claim({"amount": "+150"}, P585=[{"datavalue": {"value": {"time": "+2024-01-01T00:00:00Z"}}}])],
              "P159": [_claim({"id": "Q100"})], "P452": [_claim({"id": "Q200"})]}
    claims.update(extra)
    return {"claims": claims, "labels": {"en": {"value": "Acme Dental"}},
            "descriptions": {"en": {"value": "dental practice management corporation"}},
            "sitelinks": {"enwiki": {"title": "Acme Dental"}}}


def fake_web(entities, labels=None, extract="Acme Dental is a dental group."):
    seen = []
    labels = labels or {"Q100": "Austin", "Q200": "dentistry"}

    def get_json(url):
        seen.append(url)
        if "wbsearchentities" in url:
            return {"search": [{"id": q} for q in entities]}, {"status": "ok"}
        if "props=labels" in url:
            return {"entities": {q: {"labels": {"en": {"value": v}}} for q, v in labels.items()}}, {"status": "ok"}
        if "wbgetentities" in url:
            return {"entities": entities}, {"status": "ok"}
        if "wikipedia.org" in url:
            return {"extract": extract}, {"status": "ok"}
        return None, {"status": "error"}
    get_json.seen = seen
    return get_json


def test_search_names_come_from_the_domain():
    assert out.names_for("https://www.allbirds.com/") == ["allbirds"]
    assert out.names_for("aspen-dental.co.uk") == ["aspen dental"]
    assert out.names_for("apollohospitals.com") == ["apollohospitals", "apollo hospitals"]
    assert out.names_for("") == []


def test_only_the_record_whose_official_website_is_this_domain_is_used():
    web = fake_web({"Q1": _item("https://othername.example/"), "Q2": _item("https://www.acmedental.com/")})
    got = out.outside_facts("acmedental.com", get_json=web)
    assert got["facts"]["wikidata_id"] == "Q2" and got["facts"]["name"] == "Acme Dental"
    f = got["facts"]
    assert (f["founded"], f["employees"], f["employees_year"]) == (1999, 150, "2024"), "the latest count wins"
    assert f["head_office"] == ["Austin"] and f["industry"] == ["dentistry"]
    assert got["extract"] == "Acme Dental is a dental group."
    assert out.outside_facts("acmedental.com", get_json=fake_web({"Q1": _item("https://othername.example/")})) is None


def test_a_failing_source_means_nothing_not_a_crash():
    def broken(url):
        raise ConnectionError("down")
    assert out.outside_facts("acmedental.com", get_json=broken) is None
    assert out.outside_facts("acmedental.com", get_json=lambda u: (None, {"status": "blocked"})) is None
    assert out.outside_facts("acmedental.com") is None, "off in tests unless a reader is given"


def test_an_unreadable_site_is_replaced_by_the_outside_page_and_says_so():
    blocked = {"status": "blocked", "domain": "acmedental.com", "texts": {}, "pages": [], "signals": {},
               "home_notes": ["the site refused this server (HTTP 403)"]}
    got = out.outside_reading(blocked, get_json=fake_web({"Q2": _item("https://acmedental.com/")}))
    text = got["texts"][out.LABEL]
    assert got["status"] == "ok" and got["via_outside"] is True
    assert "Industry: dentistry" in text and "Employees: 150 (2024)" in text and "Acme Dental is a dental group." in text
    assert any("Wikidata and Wikipedia" in n for n in got["home_notes"])
    assert out.read_quality(got)["grade"] == "outside"
    assert out.outside_reading(blocked, get_json=fake_web({})) is None


def test_a_thin_site_gets_the_outside_page_added_and_a_full_site_does_not():
    thin = {"status": "ok", "domain": "acmedental.com", "texts": {"https://acmedental.com/": "Welcome."},
            "pages": [{"status": "ok", "words": 40}], "signals": {}}
    assert out.thin(thin) and not out.thin(dict(thin, pages=[{"status": "ok", "words": 2000}]))
    got = out.add_outside(thin, get_json=fake_web({"Q2": _item("https://acmedental.com/")}))
    assert set(got["texts"]) == {"https://acmedental.com/", out.LABEL}
    assert out.add_outside(thin, get_json=fake_web({})) is thin


@pytest.mark.parametrize("words, grade", [(2400, "full"), (800, "partial"), (60, "thin"), (0, "thin")])
def test_the_read_quality_grades_how_much_was_read(words, grade):
    q = out.read_quality({"pages": [{"status": "ok", "words": words}]})
    assert q["grade"] == grade and str(words) in q["why"]
    assert "archived copy" in out.read_quality({"pages": [], "via_archive": True})["why"]


def test_a_blocked_site_still_gets_a_profile_built_from_the_outside_page(monkeypatch):
    blocked = {"status": "blocked", "domain": "acmedental.com", "home_url": "https://acmedental.com/", "texts": {},
               "pages": [{"kind": "home", "url": "https://acmedental.com/", "status": "blocked", "note": "refused (HTTP 403)"}],
               "signals": {}, "home_notes": ["the site refused this server (HTTP 403)"]}
    monkeypatch.setattr(prof.site_reader, "read_site", lambda url, **kw: dict(blocked))
    monkeypatch.setattr(prof, "geocode", lambda q, conn=None: None)
    monkeypatch.delenv("APOLLO_API_KEY", raising=False)
    from tests.test_market_radar_profile import FakeClient, reply
    client = FakeClient(reply())
    web = fake_web({"Q2": _item("https://acmedental.com/")})
    res = prof.build_profile("https://acmedental.com/", client=client, save=False, outside_get_json=web)
    assert res["status"] == "ok"
    assert "dental practice management corporation" in client.calls[0][1]["messages"][0]["content"]
    p = res["profile"]
    assert p["read_quality"]["grade"] == "outside" and p["facts"]["read_from_outside"] is True
    # With nothing outside either, it is still unreadable.
    res = prof.build_profile("https://acmedental.com/", client=FakeClient(), save=False, outside_get_json=fake_web({}))
    assert res["status"] == "unreadable"
