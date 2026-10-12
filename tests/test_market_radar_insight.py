"""Market Radar: the rivals side by side (tracker/market_radar_insight.py): momentum, battlecards,
patterns across rivals, how hot the field is. Arithmetic on stored readings: no network, no model."""
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tracker import market_radar_insight as ins  # noqa: E402

NOW = datetime(2026, 10, 12, 12, tzinfo=timezone.utc)
OWNER = "owner@markifydigital.com"


def ago(days):
    return NOW - timedelta(days=days)


class FakeStore:
    def __init__(self, comps, events, scores, snaps=None):
        self.comps, self.events, self.scores, self.snaps = comps, events, scores, snaps or {}

    def get_client(self, client_id, owner):
        return {"client_id": client_id} if owner == OWNER and client_id == 1 else None

    def competitors(self, client_id, owner):
        return self.comps

    def client_scores(self, client_id):
        return self.scores

    def recent_events(self, ids, days=120, limit=1000):
        return [e for e in self.events if e["entity_id"] in ids]

    def latest_snapshot(self, entity_id, name):
        p = self.snaps.get((entity_id, name))
        return {"payload": p} if p is not None else None


def comp(i, name, kind="direct", status="confirmed", sells=None):
    return {"entity_id": i, "domain": "%s.example" % name.lower(), "name": name, "kind": kind, "status": status,
            "details": {"sells": sells}}


def ev(id, entity, type, days, score, title=None, status="opened", hidden=None):
    return ({"id": id, "entity_id": entity, "type": type, "title": title or type, "status": status,
             "event_date": ago(days), "first_seen_at": ago(days), "hidden_reason": hidden,
             "sources": [{"url": "https://%s.example/p" % entity}]},
            {"score": score, "severity": "HIGH" if score >= 6 else "MEDIUM" if score >= 2.5 else "LOW"})


def world():
    rows = [ev(1, 1, "product_launch", 3, 5), ev(2, 1, "new_location", 6, 8), ev(3, 1, "pricing_change", 40, 6),
            ev(4, 2, "product_launch", 4, 5), ev(5, 2, "hiring_surge", 20, 6), ev(6, 2, "hiring_push", 10, 4),
            ev(7, 3, "promotion", 100, 4), ev(8, 4, "new_market", 2, 9, status="announced"),
            ev(9, 5, "layoffs", 5, 8, hidden="not a move")]
    events = [r[0] for r in rows]
    scores = {r[0]["id"]: r[1] for r in rows}
    comps = [comp(1, "Alpha", sells="running shoes"), comp(2, "Beta"), comp(3, "Gamma", kind="indirect"),
             comp(4, "Delta", kind="aspirational"), comp(5, "Epsilon", status="proposed")]
    snaps = {
        (1, "jobs"): {"open": 12, "places": {"A": 1, "B": 1}, "by_function": {"Sales": 7, "Engineering": 5},
                      "senior_open": ["VP Marketing"]},
        (2, "jobs"): {"open": 4, "places": {"A": 1}, "by_function": {"Sales": 3, "Support": 1}, "senior_open": []},
        (1, "facts"): {"employees": 1500, "employees_year": "2025", "revenue": 2.5e8, "revenue_year": "2025", "ceo": ["Ann Lee"]},
        (1, "apps"): {"apps": [{"name": "Alpha", "rating": 4.6, "ratings": 12000}]},
        (2, "apps"): {"apps": [{"name": "Beta", "rating": 4.1, "ratings": 300}]},
        (1, "stack"): {"tools": ["Klaviyo", "Shopify", "WordPress"]},
        (2, "stack"): {"tools": ["Klaviyo", "Shopify"]},
        (1, "buzz"): {"items": [{"id": "9", "title": "Launch HN: Alpha", "points": 310, "date": "2026-10-01"}]},
        (1, "reviews"): {"scores": {"u1": ["Shoe", 4.5, 120], "u2": ["Boot", 4.8, 30]}},
        (1, "locations"): {"places": ["a/b", "a/c", "a/d"]},
    }
    return FakeStore(comps, events, scores, snaps)


def test_momentum_compares_the_last_fortnight_with_the_one_before():
    st = world()
    m = lambda i: ins.momentum([e for e in st.events if e["entity_id"] == i], st.scores, NOW)  # noqa: E731
    assert m(1)["label"] == "speeding_up" and m(1)["recent"] == 13.0 and m(1)["before"] == 0.0
    assert (m(2)["label"], m(2)["recent"], m(2)["before"]) == ("speeding_up", 9.0, 6.0)
    assert m(3)["label"] == "quiet", "a 100-day-old move is not momentum"
    older = [ev(1, 9, "product_launch", 20, 6)[0]]
    assert ins.momentum(older, {1: {"score": 6}}, NOW)["label"] == "slowing"
    assert ins.momentum([], {}, NOW)["label"] == "quiet"


def test_a_battlecard_holds_every_fact_with_where_it_came_from():
    out = ins.rivals_overview(1, OWNER, store=world(), now=NOW)
    alpha = next(c for c in out["rivals"] if c["name"] == "Alpha")
    facts = {f["label"]: f for f in alpha["facts"]}
    assert facts["Staff"]["value"] == "1,500 (2025)" and facts["Staff"]["source"] == "Wikidata"
    assert facts["Revenue"]["value"] == "250.0 million (2025)"
    assert facts["Locations"]["value"] == "3 listed on its site" and facts["Locations"]["source"] == "its sitemap"
    assert facts["Reviews"]["value"] == "150 reviews, up to 4.8 stars"
    assert facts["App"]["value"] == "Alpha, 4.6 stars from 12,000 ratings" and facts["App"]["source"] == "App Store"
    assert facts["Tools"]["value"] == "Klaviyo, Shopify, WordPress"
    assert alpha["hiring"]["open"] == 12 and alpha["buzz"]["points"] == 310
    assert [m["title"] for m in alpha["moves"]] == ["new_location", "pricing_change", "product_launch"], "biggest first"
    assert alpha["moves"][0]["url"] == "https://1.example/p"
    assert "Searching for: VP Marketing" in alpha["watch"] and any("12 open roles, most in Sales (7)" in w for w in alpha["watch"])


def test_rivals_are_ordered_speeding_first_and_removed_or_hidden_ones_do_not_count():
    st = world()
    st.comps.append(comp(6, "Zeta", status="removed"))
    out = ins.rivals_overview(1, OWNER, store=st, now=NOW)
    names = [c["name"] for c in out["rivals"]]
    assert "Zeta" not in names and set(names[:3]) == {"Alpha", "Beta", "Delta"} and set(names[3:]) == {"Gamma", "Epsilon"}
    eps = next(c for c in out["rivals"] if c["name"] == "Epsilon")
    assert eps["total_moves"] == 0, "a hidden event is not a move"
    assert out["counts"]["total"] == 5 and out["counts"]["quiet"] >= 1


def test_what_several_rivals_do_at_once_is_a_pattern_and_one_rival_is_not():
    out = ins.rivals_overview(1, OWNER, store=world(), now=NOW)
    texts = [p["text"] for p in out["patterns"]]
    assert "2 of 5 rivals are launching products, apps or offers" in texts
    assert "2 of 5 rivals are hiring; most open roles are in Sales (10)" in texts
    assert "2 of 5 rivals have a mobile app" in texts
    assert any(t.startswith("Most rivals use Klaviyo (2)") for t in texts)
    assert not any("pricing" in t for t in texts), "only Alpha changed prices, and 40 days ago"
    launching = next(p for p in out["patterns"] if p["kind"] == "launching")
    assert sorted(launching["rivals"]) == ["Alpha", "Beta"]
    assert ins.patterns([{"entity_id": 1, "name": "Solo"}], [], {}, NOW) == []


def test_the_whole_field_heats_up_or_cools_down():
    st = world()
    assert ins.heat(st.events, st.scores, NOW)["label"] == "heating_up"
    old = [ev(1, 1, "product_launch", 25, 8)[0]]
    assert ins.heat(old, {1: {"score": 8}}, NOW)["label"] == "cooling"
    assert ins.heat([], {}, NOW)["label"] == "quiet"
    both = [ev(1, 1, "product_launch", 5, 5)[0], ev(2, 1, "product_launch", 20, 5)[0]]
    assert ins.heat(both, {1: {"score": 5}, 2: {"score": 5}}, NOW)["label"] == "steady"


def test_another_owners_company_is_not_found():
    assert ins.rivals_overview(1, "someone@else.example", store=world(), now=NOW) is None
    assert ins.rivals_overview(2, OWNER, store=world(), now=NOW) is None


def test_a_company_with_no_rivals_gets_an_empty_overview():
    out = ins.rivals_overview(1, OWNER, store=FakeStore([], [], {}), now=NOW)
    assert out["rivals"] == [] and out["patterns"] == [] and out["counts"]["total"] == 0


# == the page script ================================================================

JS = os.path.join(ROOT, "static", "js", "market_radar.js")
EVIL = '<img src=x onerror=alert(1)>"\'&'


def run_js(expr):
    if shutil.which("node") is None:
        pytest.skip("node is not installed")
    prog = ("globalThis.window = globalThis; require(%s); const MR = globalThis.MR;\n"
            "process.stdout.write(JSON.stringify((() => { %s })()));") % (json.dumps(JS), expr)
    proc = subprocess.run([shutil.which("node"), "-e", prog], capture_output=True, text=True, timeout=30)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def test_the_rival_cards_render_everything_escaped_and_with_their_sources():
    data = ins.rivals_overview(1, OWNER, store=world(), now=NOW)
    data["rivals"][0]["name"] = EVIL
    data["rivals"][0]["sells"] = EVIL
    data["rivals"][0]["moves"][0]["url"] = "javascript:alert(1)"
    data["patterns"][0]["text"] = EVIL
    html = run_js("return MR.renderRivals(%s);" % json.dumps(data))
    assert "<img" not in html and "onerror=alert(1)>" not in html.replace("&gt;", "") and "javascript:alert" not in html
    assert "mr-rc-grid" in html and "Speeding up" in html and "The field is heating up" in html
    assert "What several rivals are doing at once" in html and "Wikidata" in html and "App Store" in html
    assert "Watch" in html and "Biggest recent moves" in html and "mr-rc--speeding_up" in html
    assert run_js("return MR.renderRivals(null);") is None
    empty = run_js("return MR.renderRivals({rivals: [], counts: {}});")
    assert "No rivals yet" in empty
    nav = run_js("return MR.SECTIONS.map(s => s[0]);")
    assert nav.index("rivals") == nav.index("moves") + 1
