"""Market Radar: the research covers the competitors the user confirmed, not every suggestion.

The agent suggests (say) ten competitors; the user confirms five. The moves collection, the reading and
scoring of what it found, the rival cards, the moves page and the report are then about those five.
Before anything is confirmed nothing has been chosen, so every suggestion is researched and the page says so.
"""
import os
import sys
from datetime import datetime, timezone

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import market_radar_collect as collect  # noqa: E402
from tracker import market_radar_insight as insight  # noqa: E402
from tracker import market_radar_tracking as tracking  # noqa: E402
from tracker import market_radar_views as views  # noqa: E402
from tests.test_market_radar_store import OWNER, pg, world  # noqa: E402,F401  (fixtures)

NOW = datetime(2026, 10, 14, tzinfo=timezone.utc)


def rows(statuses):
    return [{"entity_id": i + 1, "domain": "rival%d.example" % (i + 1), "name": "Rival %d" % (i + 1),
             "kind": "direct", "status": s, "details": {}} for i, s in enumerate(statuses)]


TEN = rows(["confirmed"] * 5 + ["proposed"] * 4 + ["removed"])


# == the rule ==============================================================================

def test_once_some_are_confirmed_only_those_are_researched():
    chosen = tracking.choose(TEN)
    assert [r["entity_id"] for r in chosen] == [1, 2, 3, 4, 5]


def test_before_anything_is_confirmed_every_suggestion_that_was_not_removed_is_researched():
    chosen = tracking.choose(rows(["proposed"] * 3 + ["removed"]))
    assert [r["entity_id"] for r in chosen] == [1, 2, 3]


def test_a_removed_competitor_is_never_researched_even_if_it_was_confirmed_before():
    assert tracking.choose(rows(["removed", "removed"])) == []
    assert [r["entity_id"] for r in tracking.choose(rows(["confirmed", "removed"]))] == [1]


def test_the_summary_says_in_words_what_is_and_is_not_researched():
    s = tracking.summary(TEN)
    assert (s["mode"], s["tracked"], s["not_tracked"]) == ("confirmed", 5, 4)
    assert "Researching the 5 competitors you confirmed" in s["text"]
    assert "4 suggestions are not researched until confirmed" in s["text"]
    none = tracking.summary(rows(["proposed"] * 3))
    assert none["mode"] == "all_suggested" and none["tracked"] == 3
    assert "No competitor is confirmed yet, so all 3 suggestions are being researched" in none["text"]
    one = tracking.summary(rows(["confirmed", "proposed"]))
    assert "Researching the 1 competitor you confirmed. 1 suggestion is not researched" in one["text"]
    assert tracking.summary([])["mode"] == "none" and tracking.summary(rows(["removed"]))["mode"] == "none"


# == what is collected, read, ranked and written ===========================================

class Store:
    def __init__(self, comps):
        self.comps = comps

    def competitors(self, client_id, owner, include_removed=False):
        return [dict(r) for r in self.comps if include_removed or r["status"] != "removed"]

    def get_entity(self, eid):
        return {"name": "Rival %d" % eid, "country": "US"}


def test_the_collection_runs_on_the_five_confirmed_and_not_the_other_five():
    companies, over = collect.targets(1, OWNER, store=Store(TEN))
    assert [c["id"] for c in companies] == [1, 2, 3, 4, 5]
    assert all(c["status"] == "confirmed" for c in companies) and over == 0


def test_with_nothing_confirmed_the_collection_covers_the_suggestions_it_always_did():
    companies, _ = collect.targets(1, OWNER, store=Store(rows(["proposed"] * 4 + ["removed"])))
    assert len(companies) == 4


def test_the_rival_cards_cover_only_the_confirmed_competitors():
    class S(Store):
        def get_client(self, cid, owner):
            return {"entity_id": 99}

        def client_scores(self, cid):
            return {}

        def recent_events(self, ids, *, days=120, limit=400):
            assert sorted(ids) == [1, 2, 3, 4, 5], "events are read for the confirmed five only"
            return []

        def latest_snapshot(self, eid, detector):
            return None

    out = insight.rivals_overview(1, OWNER, store=S(TEN), now=NOW)
    assert out["counts"]["total"] == 5
    assert {c["name"] for c in out["rivals"]} == {"Rival %d" % i for i in range(1, 6)}


# == the report, the page and the stored list (Postgres) ===================================

def test_the_competitor_list_marks_which_are_researched_and_says_so(pg, world):
    ids = []
    for n in range(6):
        e = pg.upsert_entity("rival%d.example" % n, name="Rival %d" % n)
        pg.propose_competitor(world["client"], OWNER, e, "direct", confidence=0.9 - n / 20)
        ids.append(e)
    view = views.client_view(world["client"], OWNER)
    assert view["tracking"]["mode"] == "all_suggested" and view["tracking"]["tracked"] == 6
    assert all(r["researched"] for r in view["competitors"])
    for e in ids[:2]:
        pg.set_competitor_status(world["client"], OWNER, e, "confirmed")
    pg.set_competitor_status(world["client"], OWNER, ids[5], "removed")
    view = views.client_view(world["client"], OWNER)
    assert view["tracking"]["mode"] == "confirmed" and view["tracking"]["tracked"] == 2
    assert view["tracking"]["not_tracked"] == 3
    got = {r["name"]: r["researched"] for r in view["competitors"]}
    assert got == {"Rival 0": True, "Rival 1": True, "Rival 2": False, "Rival 3": False,
                   "Rival 4": False, "Rival 5": False}


def test_the_moves_page_the_collection_and_the_report_follow_the_confirmed_list(pg, world):
    ids = []
    for n in range(4):
        e = pg.upsert_entity("rival%d.example" % n, name="Rival %d" % n)
        pg.propose_competitor(world["client"], OWNER, e, "direct", confidence=0.9)
        ids.append(e)
        pg.record_event(e, "k%d" % n, type="promotion", title="Offer from Rival %d" % n,
                        source={"detector": "promotions", "url": "https://x.example/%d" % n})
    pg.set_competitor_status(world["client"], OWNER, ids[0], "confirmed")
    pg.set_competitor_status(world["client"], OWNER, ids[1], "confirmed")
    moves = views.moves_view(world["client"], OWNER)
    assert {c["name"] for c in moves["competitors"]} == {"Rival 0", "Rival 1"}
    assert {e["name"] for e in moves["events"]} == {"Rival 0", "Rival 1"}, "no moves from unconfirmed rivals"
    assert moves["tracking"]["mode"] == "confirmed" and moves["tracking"]["not_tracked"] == 2
    companies, _ = collect.targets(world["client"], OWNER)
    assert {c["domain"] for c in companies} == {"rival0.example", "rival1.example"}
    from tracker import market_radar_report as report
    pack = report.build_pack(world["client"], OWNER, store=pg, now=NOW)
    assert {c["name"] for c in pack["competitors"]} == {"Rival 0", "Rival 1"}
    assert any("Researching the 2 competitors you confirmed" in line for line in pack["coverage"])
    # Confirming a third brings it in; removing one takes it out.
    pg.set_competitor_status(world["client"], OWNER, ids[2], "confirmed")
    pg.set_competitor_status(world["client"], OWNER, ids[0], "removed")
    companies, _ = collect.targets(world["client"], OWNER)
    assert {c["domain"] for c in companies} == {"rival1.example", "rival2.example"}


# == what the page says ====================================================================

def test_the_page_tells_the_user_which_competitors_are_researched():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    js = open(os.path.join(root, "static", "js", "market_radar.js"), encoding="utf-8").read()
    assert "Only the ones you confirm are researched" in js
    assert "Not researched until you confirm it" in js
    assert "moves.tracking.text" in js and "renderCompetitors(v.competitors, state.filter, v.tracking)" in js


def test_the_niche_cards_do_not_borrow_the_tab_bars_class():
    """.mr-seg is the pill tab bar; the ideal-customer cards had borrowed its name and its border."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    css = open(os.path.join(root, "static", "css", "market_radar.css"), encoding="utf-8").read()
    js = open(os.path.join(root, "static", "js", "market_radar.js"), encoding="utf-8").read()
    assert ".mr-icp {" in css and ".mr-icps {" in css
    import re
    assert not re.search(r"\.mr-seg\s+(?:b|p)\s*\{", css), "tab bars must not pick up card text styles"
    assert not re.search(r"\.mr-seg\s*\{[^}]*rgba\(255, 255, 255, \.03\)", css)
    assert 'class="mr-icp"' in js and 'class="mr-seg"><b>' not in js
