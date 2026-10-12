"""Market Radar: new pages, apps, Hacker News, company facts and technology on a rival's homepage
(tracker/market_radar_more.py). No network."""
import json
import os
import sys
from datetime import datetime, timezone

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import market_radar_more as more  # noqa: E402

NOW = datetime(2026, 10, 12, 12, tzinfo=timezone.utc)


def ok(body="", **kw):
    return dict({"status": "ok", "body": body, "note": "", "truncated": False}, **kw)


def sitemap(*paths, host="https://rival.example"):
    return "<urlset>%s</urlset>" % "".join("<url><loc>%s%s</loc></url>" % (host, p) for p in paths)


def ctx(get=None, get_json=None, fetch=None, **entity):
    e = dict({"id": 1, "domain": "rival.example", "name": "Rival", "country": "US"}, **entity)
    return {"entity": e, "now": NOW, "site": {"home_url": "https://rival.example/", "robots": {"sitemaps": []}},
            "get": get or (lambda url, **kw: ok(sitemap("/", "/pricing"))), "get_json": get_json, "fetch": fetch}


# == new pages ======================================================================

def test_the_sitemap_is_read_without_product_blog_and_store_pages():
    body = sitemap("/", "/pricing", "/solutions/health", "/blog/post-1", "/products/shoe", "/stores/x", "/a.pdf")
    got = more.read_content(ctx(get=lambda url, **kw: ok(body)))
    assert got["payload"]["paths"] == ["/pricing", "/solutions/health"] and got["items"] == 2
    miss = more.read_content(ctx(get=lambda url, **kw: {"status": "blocked", "body": "", "note": "refused (HTTP 403)"}))
    assert miss["status"] == "blocked" and "could not be read" in miss["note"]
    gone = more.read_content(ctx(get=lambda url, **kw: {"status": "not_found", "body": "", "note": "not found"}))
    assert gone["status"] == "none"


def test_new_pages_become_moves_a_new_country_a_new_section_and_pages_that_matter():
    before = {"paths": ["/pricing", "/about", "/solutions/health"] + ["/docs/%d" % i for i in range(30)], "complete": True}
    after = {"complete": True, "paths": before["paths"] + ["/pricing/enterprise", "/compare/acme", "/de/preise", "/de/produkt", "/de/ueber",
                                         "/industries/retail", "/industries/banking", "/industries/travel"]
             + ["/docs/new-%d" % i for i in range(9)]}
    events = {e["key"]: e for e in more.compare_content(before, after, NOW)}
    assert events["content-market:/de"]["type"] == "new_market" and "3 pages" in events["content-market:/de"]["title"]
    assert events["content-section:/industries"]["type"] == "new_content"
    assert "content-page:/pricing/enterprise" in events and "content-page:/compare/acme" in events
    assert events["content-bulk:/docs:2026-10-12"]["title"] == "9 new pages under /docs"
    assert more.compare_content(before, before, NOW) == []


def test_a_list_cut_short_is_compared_only_where_both_reach():
    before = {"paths": ["/a", "/b", "/c"], "complete": False}
    after = {"paths": ["/a", "/b", "/b2", "/z"], "complete": False}      # /z is past the old cut: not news
    assert [e["key"] for e in more.compare_content(before, after, NOW)] == []
    assert [e["key"] for e in more.compare_content(before, dict(after, complete=True), NOW)] == []
    both = {"paths": ["/a", "/pricing/team", "/z"], "complete": False}
    assert [e["key"] for e in more.compare_content({"paths": ["/a", "/z"], "complete": False}, both, NOW)] == [
        "content-page:/pricing/team"]


def test_a_site_that_renamed_its_pages_is_restructured_not_launching():
    before = {"paths": ["/old/%d" % i for i in range(100)], "complete": True}
    after = {"paths": ["/new/%d" % i for i in range(100)], "complete": True}
    [e] = more.compare_content(before, after, NOW)
    assert e["type"] == "site_restructured" and "100 added, 100 gone" in e["title"]


# == apps ===========================================================================

def itunes(*apps):
    return lambda url: ({"results": list(apps)}, {"status": "ok"})


def app(id, name, seller, version="1.0", **kw):
    return dict({"trackId": id, "trackName": name, "sellerUrl": seller, "version": version,
                 "releaseDate": "2026-09-30T10:00:00Z", "currentVersionReleaseDate": "2026-10-05T10:00:00Z",
                 "averageUserRating": 4.5, "userRatingCount": 900, "trackViewUrl": "https://apps.apple.com/x"}, **kw)


def test_only_apps_that_name_the_rivals_website_are_its_apps():
    got = more.read_apps(ctx(get_json=itunes(app(1, "Rival", "https://www.rival.example/app"),
                                              app(2, "Rival Pizza", "https://rivalpizza.example"),
                                              app(3, "Other", "https://elsewhere.example"))))
    assert [a["id"] for a in got["payload"]["apps"]] == [1]
    none = more.read_apps(ctx(get_json=itunes(app(2, "Rival Pizza", "https://rivalpizza.example"))))
    assert none["status"] == "none" and "rival.example" in none["note"]
    down = more.read_apps(ctx(get_json=lambda url: (None, {"status": "blocked", "note": "refused"})))
    assert down["status"] == "blocked"


def test_a_new_app_and_a_new_version_are_moves():
    old = {"apps": [{"id": 1, "name": "Rival", "version": "1.0", "released": "2026-01-01", "updated": "2026-01-01"}]}
    new = {"apps": [{"id": 1, "name": "Rival", "version": "1.1", "updated": "2026-10-10", "notes": "Dark mode", "url": "u"},
                    {"id": 2, "name": "Rival Pro", "version": "1.0", "released": "2026-10-11", "url": "u2"}]}
    ev = {e["key"]: e for e in more.compare_apps(old, new, NOW)}
    assert ev["app+:2"]["type"] == "product_launch" and ev["app+:2"]["title"] == "New app: Rival Pro"
    assert ev["app-update:1:1.1"]["type"] == "app_update" and ev["app-update:1:1.1"]["summary"] == "Dark mode"
    first = more.baseline_apps({"apps": [{"id": 1, "name": "Rival", "version": "2", "released": "2025-01-01",
                                          "updated": "2026-10-01"}]}, NOW)
    assert [e["type"] for e in first] == ["app_update"], "only what is recent: no 2025 release"


# == Hacker News ====================================================================

def hits(*rows):
    return lambda url: ({"hits": list(rows)}, {"status": "ok"})


def hit(id, url, points, title="Launch HN: Rival"):
    return {"objectID": id, "url": url, "points": points, "num_comments": 12, "title": title,
            "created_at": "2026-10-08T09:00:00.000Z"}


def test_hacker_news_stories_must_link_to_the_rivals_own_site():
    got = more.read_buzz(ctx(get_json=hits(hit("1", "https://rival.example/launch", 300),
                                           hit("2", "https://rival.example.evil.com/x", 900),
                                           hit("3", "https://blog.rival.example/p", 20))))
    assert [i["id"] for i in got["payload"]["items"]] == ["1", "3"]
    assert more.read_buzz(ctx(get_json=hits()))["status"] == "empty"


def test_only_stories_that_took_off_and_are_new_are_moves():
    cur = {"items": [{"id": "1", "title": "Launch HN: Rival", "points": 300, "comments": 90, "date": "2026-10-08"},
                     {"id": "2", "title": "small", "points": 5, "comments": 0, "date": "2026-10-09"}]}
    assert [e["key"] for e in more.compare_buzz({"items": []}, cur, NOW)] == ["hn:1"]
    assert more.compare_buzz(cur, cur, NOW) == []
    assert "300 points" in more.baseline_buzz(cur, NOW)[0]["title"]


# == company facts ==================================================================

def test_a_new_chief_executive_owner_staff_count_and_revenue_are_moves():
    old = {"name": "Rival", "ceo": ["Ann"], "parent": [], "employees": 1000, "employees_year": "2024",
           "revenue": 1e9, "revenue_year": "2024"}
    new = {"name": "Rival", "ceo": ["Bo"], "parent": ["MegaCorp"], "employees": 1300, "employees_year": "2025",
           "revenue": 1.2e9, "revenue_year": "2025"}
    ev = {e["type"]: e for e in more.compare_facts(old, new, NOW)}
    assert "new chief executive, Bo (was Ann)" in ev["leadership_change"]["title"]
    assert ev["acquisition"]["title"] == "Rival is now part of MegaCorp"
    assert "from 1,000 to 1,300" in ev["hiring_surge"]["title"]
    assert "1.2 billion reported for 2025" in ev["financial_results"]["title"]
    assert more.compare_facts(old, old, NOW) == []
    small = dict(new, employees=1050)
    assert "hiring_surge" not in {e["type"] for e in more.compare_facts(old, small, NOW)}


def test_facts_are_read_from_the_record_whose_website_is_the_domain():
    item = {"claims": {"P856": [{"mainsnak": {"snaktype": "value", "datavalue": {"value": "https://rival.example/"}}}]},
            "labels": {"en": {"value": "Rival"}}, "descriptions": {"en": {"value": "a firm"}}, "sitelinks": {}}

    def web(url):
        if "wbsearchentities" in url:
            return {"search": [{"id": "Q9"}]}, {"status": "ok"}
        return {"entities": {"Q9": item}}, {"status": "ok"}
    got = more.read_facts(ctx(get_json=web))
    assert got["status"] == "ok" and got["payload"]["wikidata_id"] == "Q9"
    assert more.read_facts(ctx(get_json=lambda url: ({"search": []}, {"status": "ok"})))["status"] == "none"


# == technology =====================================================================

def page(html):
    return lambda url: {"status": "ok", "html": html, "text": "", "note": ""}


def test_the_homepage_tools_are_recognised_and_a_switch_is_a_move():
    shopify = '<script src="https://cdn.shopify.com/x.js"></script><script src="https://static.klaviyo.com/k.js"></script>'
    woo = '<link href="/wp-content/plugins/woocommerce/a.css"><script src="https://js.hs-scripts.com/1.js"></script>'
    a = more.read_stack(ctx(fetch=page(shopify)))
    b = more.read_stack(ctx(fetch=page(woo)))
    assert a["payload"]["tools"] == ["Klaviyo", "Shopify"] and "HubSpot" in b["payload"]["tools"]
    ev = more.compare_stack(a["payload"], b["payload"], NOW)
    titles = [e["title"] for e in ev]
    assert "Now uses WooCommerce (shop platform)" in titles and "No longer uses Shopify (shop platform)" in titles
    assert "Now uses HubSpot (marketing and sales)" in titles
    assert more.read_stack(ctx(fetch=page("<html></html>")))["status"] == "empty"
    assert more.read_stack(ctx(fetch=lambda url: {"status": "blocked", "note": "refused"}))["status"] == "blocked"
