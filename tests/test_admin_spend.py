"""Admin panel spend: what each agent costs, by agent, by workspace and by person.

The folding (rollup) is pure and tested on plain rows. The reading (collect) is tested against a real
Postgres, seeded through each agent's own store, so a renamed column in any ledger fails here.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import admin_spend as spend  # noqa: E402
from tests.test_market_radar_store import OWNER, pg, world  # noqa: E402,F401  (fixtures)

NOW = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)


def row(agent, usd, *, email="a@x.com", space="", days_ago=1, unit="usd"):
    return {"agent": agent, "unit": unit, "email": email, "space": space, "usd": usd,
            "at": NOW - timedelta(days=days_ago)}


ROWS = [
    row("market-radar", 2.00, email="kris@x.com", space="acct:7"),
    row("market-radar", 1.00, email="mia@x.com", space="acct:7", days_ago=3),
    row("video-studio", 4.00, email="mia@x.com", space="acct:8"),
    row("page-watch", 0.50, email="kris@x.com", space=""),
    row("market-radar", 3.00, email="kris@x.com", space="acct:7", days_ago=40),      # the period before
    row("market-radar", 9.00, email="kris@x.com", space="acct:7", days_ago=90),      # older than both
    row("contact-finder", 120, email="kris@x.com", unit="credits"),
]


def out(**kw):
    return spend.rollup(ROWS, days=30, now=NOW, names={"kris@x.com": "Kris Ladha"},
                        workspaces={"acct:7": "Lumina", "acct:8": "Bloom"}, **kw)


# == the totals ================================================================================

def test_the_total_is_this_period_and_is_compared_with_the_one_before_it():
    o = out()
    assert o["total"] == 7.5 and o["previous"] == 3.0 and o["calls"] == 4
    assert o["change_pct"] == 150.0
    assert o["per_day"] == 0.25 and o["projected_month"] == 7.5


def test_no_earlier_spend_means_no_percentage_not_a_division_by_zero():
    assert spend.rollup([row("market-radar", 1.0)], days=30, now=NOW)["change_pct"] is None


def test_credits_are_never_added_to_dollars():
    o = out()
    assert o["total"] == 7.5, "120 Apollo credits are not $120"
    assert o["credits"] == [{"agent": "contact-finder", "label": "Contact Finder", "credits": 120}]
    assert all(a["agent"] != "contact-finder" for a in o["agents"])


def test_the_daily_series_has_one_point_for_every_day_including_quiet_ones():
    s = out()["series"]
    assert len(s) == 30 and s[-1]["day"] == "2026-10-14"
    assert round(sum(p["usd"] for p in s), 4) == 7.5
    assert sum(1 for p in s if p["usd"] == 0) == 28   # the 13th and the 11th have spend


# == by agent, workspace, person ===============================================================

def test_by_agent_ranks_the_costliest_first_with_its_share():
    a = out()["agents"]
    assert [x["agent"] for x in a] == ["video-studio", "market-radar", "page-watch"]
    assert a[0]["usd"] == 4.0 and a[0]["share"] == 53.3
    mr = a[1]
    assert (mr["usd"], mr["calls"], mr["people"], mr["workspaces"]) == (3.0, 2, 2, 1)
    assert len(mr["spark"]) == 30 and round(sum(mr["spark"]), 4) == 3.0


def test_by_workspace_names_accounts_and_keeps_personal_work_apart():
    w = {x["space"]: x for x in out()["workspaces"]}
    assert w["acct:8"]["name"] == "Bloom" and w["acct:8"]["usd"] == 4.0 and w["acct:8"]["top_agent"] == "video-studio"
    assert w["acct:7"]["name"] == "Lumina" and w["acct:7"]["agents"] == {"market-radar": 3.0}
    assert w[""]["general"] is True and w[""]["name"] == "General (personal work)"
    assert out()["workspace_count"] == 2, "General is not a client workspace"


def test_an_account_that_no_longer_exists_is_named_as_removed_not_hidden():
    o = spend.rollup([row("market-radar", 1.0, space="acct:99")], days=30, now=NOW, workspaces={})
    assert o["workspaces"][0]["name"] == "Removed account" and o["total"] == 1.0


def test_by_person_uses_the_name_when_known_and_the_address_when_not():
    p = {x["email"]: x for x in out()["people"]}
    assert p["kris@x.com"]["name"] == "Kris Ladha" and p["kris@x.com"]["usd"] == 2.5
    assert p["mia@x.com"]["name"] == "Mia" and p["mia@x.com"]["usd"] == 5.0
    assert p["kris@x.com"]["top_agent"] == "market-radar" and p["kris@x.com"]["workspaces"] == 1


def test_work_with_no_recorded_person_is_one_honest_row_not_dropped():
    o = spend.rollup([row("account-mapper", 2.0, email="", space="acct:7")], days=30, now=NOW)
    p = o["people"][0]
    assert p["name"] == "Not recorded" and p["recorded"] is False and p["usd"] == 2.0
    assert o["total"] == 2.0 == sum(x["usd"] for x in o["workspaces"])


def test_each_view_adds_up_to_the_same_total():
    o = out()
    for key in ("agents", "workspaces", "people"):
        assert round(sum(x["usd"] for x in o[key]), 4) == o["total"], key


def test_the_grid_lines_workspaces_up_against_the_agents_that_cost_something():
    g = out()["grid"]
    assert [a["agent"] for a in g["agents"]] == ["video-studio", "market-radar", "page-watch"]
    lumina = next(r for r in g["rows"] if r["space"] == "acct:7")
    assert lumina["cells"] == [0.0, 3.0, 0.0] and lumina["total"] == 3.0


# == whose work a ledger row is ================================================================

@pytest.mark.parametrize("owner,by,space,want", [
    ("kris@x.com", None, None, ("kris@x.com", "")),                    # a person's own work
    ("Kris@X.com", None, "me:kris@x.com", ("kris@x.com", "")),         # a personal space is General
    ("acct:7", "Mia@x.com", None, ("mia@x.com", "acct:7")),            # a client account's, who started it kept
    ("acct:7", None, None, ("", "acct:7")),                            # a client account's, nobody kept
    ("kris@x.com", None, "acct:7", ("kris@x.com", "acct:7")),          # an agent with a space column
    ("", None, "acct:7", ("", "acct:7")),
    (None, None, None, ("", "")),
])
def test_whose_work_a_ledger_row_is(owner, by, space, want):
    assert spend._who(owner, by, space) == want


# == reading the real ledgers ==================================================================

def _reset_stores(monkeypatch):
    from tracker import (account_mapper_store, buyer_radar_store, contact_lab_store, event_intel_store, gads_ai_store,
                         lbr_store, market_radar_store, paid_spend, sci_store, video_store, watch_store)
    for mod, flag in ((account_mapper_store, "_READY"), (paid_spend, "_READY"), (buyer_radar_store, "_READY"), (contact_lab_store, "_READY"),
                      (event_intel_store, "_TABLES_READY"), (gads_ai_store, "_TABLES_READY"),
                      (lbr_store, "_TABLES_READY"), (market_radar_store, "_TABLES_READY"),
                      (sci_store, "_TABLES_READY"), (video_store, "_READY"), (watch_store, "_READY")):
        monkeypatch.setattr(mod, flag, False)


def test_every_ledger_is_read_with_who_where_and_how_much(pg, world, monkeypatch):
    from tracker import (account_mapper_store as am, buyer_radar_store as br, contact_lab_store as cl,
                         event_intel_store as evi, gads_ai_store as gads, lbr_store, sci_store, video_store, watch_store)
    _reset_stores(monkeypatch)
    # Market Radar, inside a client account (owner is the space) and as a person's own work
    entity = world["entity"]
    acct_run = pg.create_run(pg.upsert_client("acct:7", entity), "acct:7", "baseline", cost_cap_usd="1")
    pg.set_started_by(acct_run, "Mia@x.com")
    own_run = pg.create_run(pg.upsert_client("kris@x.com", entity), "kris@x.com", "baseline", cost_cap_usd="1")
    with pg._tx() as cur:
        for run, status, actual, reserved in ((acct_run, "done", "0.0400", "0.5"), (own_run, "reserved", None, "0.2")):
            cur.execute("INSERT INTO mr_provider_calls (run_id, stage, provider, status, actual_usd, reserved_usd) "
                        "VALUES (%s, 'profile', 'anthropic', %s, %s, %s)", (run, status, actual, reserved))
    # Local Business Radar and Social Media Intelligence, with their space columns
    lr = lbr_store.create_run("kris@x.com", "dentist", "Austin", "all", 10, space="acct:7")
    lbr_store.add_calls(lr, [{"provider": "apify", "op": "maps", "usd": 0.25, "ok": True},
                             {"provider": "apify", "op": "free", "usd": None, "ok": True}])
    sr = sci_store.save_run("kris@x.com", "Acme", space="acct:8")
    sci_store.log_spend(sr, "linkedin", "apify", "posts", 5, 0.10)
    # Account Mapper, Contact Lab
    amr = am.create_run("acct:7", {}, 1.0, started_by="mia@x.com")
    am.update_run(amr, spent=0.30)
    clr = cl.create_run("kris@x.com", {}, 1.0)
    cl.update_run(clr, spent=0.05)
    # Buyer Radar: dollars (Apify, Claude) and Saleshandy credits in one ledger, inside a client account
    brr = br.create_run("acct:8", {}, 2.0, "mia@x.com")
    br.add_spend(brr, "acct:8", "mia@x.com", "apify", "post-search", usd=0.40)
    br.add_spend(brr, "acct:8", "mia@x.com", "saleshandy", "email-reveal", credits=2)
    # Video Studio and Page Watch, each with a space on the project / watch
    vp = video_store.create_project("mia@x.com", space="acct:8")
    video_store.add_ai_call("plan", email="mia@x.com", project_id=vp, cost_usd=0.60)
    wt = watch_store.create_target("kris@x.com", "https://x.example/p", space="acct:7")
    watch_store.add_ai_call("judge", email="kris@x.com", target_id=wt, cost_usd=0.02)
    # Ads AI review, and the two credit ledgers
    gr = gads.create_review("Lumina Ads", "kris@x.com")
    gads.update_review(gr, cost={"usd": 0.75, "calls": []})
    # The Paid Marketing agents' model calls, inside a client workspace
    from tracker import paid_spend
    paid_spend.record("segment-analysis", "Mia@x.com", "acct:7", "segments", "claude-sonnet-5-5", 0.012)
    er = evi.save_run("kris@x.com", "lookup", "ai summit", space="acct:7")
    evi.update_run(er, credits_spent=40)

    got = spend.collect(datetime.now(timezone.utc) - timedelta(days=1))
    by = {s["agent"]: s for s in got["sources"]}
    assert all(s["ok"] for s in got["sources"]), [s for s in got["sources"] if not s["ok"]]
    assert by["market-radar"]["runs"] == 2 and by["local-business-radar"]["runs"] == 1, "a free call is not a row"

    def one(agent, **match):
        hits = [r for r in got["rows"] if r["agent"] == agent and all(r[k] == v for k, v in match.items())]
        assert len(hits) == 1, (agent, match, got["rows"])
        return hits[0]

    assert one("market-radar", space="acct:7")["usd"] == pytest.approx(0.04) and one("market-radar", space="acct:7")["email"] == "mia@x.com"
    assert one("market-radar", space="")["usd"] == pytest.approx(0.2), "an unmeasured call counts at its reservation"
    assert one("local-business-radar")["space"] == "acct:7" and one("local-business-radar")["usd"] == pytest.approx(0.25)
    assert one("social-media-intelligence")["space"] == "acct:8"
    assert one("account-mapper")["email"] == "mia@x.com" and one("account-mapper")["space"] == "acct:7"
    assert one("contact-lab")["usd"] == pytest.approx(0.05) and one("contact-lab")["space"] == ""
    assert one("buyer-radar")["usd"] == pytest.approx(0.40) and one("buyer-radar")["space"] == "acct:8"
    assert one("buyer-radar")["email"] == "mia@x.com"
    assert one("buyer-radar-emails")["unit"] == "credits" and one("buyer-radar-emails")["usd"] == 2
    assert one("video-studio")["space"] == "acct:8" and one("video-studio")["email"] == "mia@x.com"
    assert one("page-watch")["space"] == "acct:7"
    assert one("google-ads-ai-review")["usd"] == pytest.approx(0.75)
    assert one("event-intelligence")["unit"] == "credits" and one("event-intelligence")["usd"] == 40
    assert one("segment-analysis")["usd"] == pytest.approx(0.012) and one("segment-analysis")["space"] == "acct:7"
    assert one("segment-analysis")["email"] == "mia@x.com"


def test_a_ledger_nobody_has_used_yet_is_reported_as_empty_not_as_broken(pg):
    got = spend.collect(datetime.now(timezone.utc) - timedelta(days=1))
    assert got["rows"] == []
    assert all(s["ok"] for s in got["sources"]), "a missing table means nobody has used that agent"
    assert any(s["note"] == "No runs recorded yet." for s in got["sources"])


def test_one_ledger_failing_does_not_hide_the_others(pg, monkeypatch):
    bad = spend.SOURCES + (("broken", "Broken agent", "usd", "SELECT no_such_column FROM mr_runs"),)
    pg.table_counts()                                   # make mr_runs exist
    got = spend.collect(datetime.now(timezone.utc) - timedelta(days=1), sources=bad)
    broken = [s for s in got["sources"] if s["agent"] == "broken"][0]
    assert broken["ok"] is False and "no_such_column" in broken["note"]
    assert len(got["sources"]) == len(bad)


def test_with_no_database_every_ledger_says_so(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    got = spend.collect(NOW)
    assert got["rows"] == [] and all(not s["ok"] for s in got["sources"])
    assert got["sources"][0]["note"] == "The database could not be reached."


def test_panel_names_people_and_reports_unreadable_ledgers(pg, monkeypatch):
    monkeypatch.setattr(spend, "collect", lambda since, sources=spend.SOURCES: {
        "rows": [row("market-radar", 1.0, email="kris@x.com", days_ago=0, space="acct:7")],
        "sources": [{"agent": "market-radar", "label": "Market Radar", "unit": "usd", "ok": True, "runs": 1, "note": ""},
                    {"agent": "video-studio", "label": "Video Studio", "unit": "usd", "ok": False, "runs": 0, "note": "x"}]})
    o = spend.panel(30, now=NOW, names_of=lambda emails: {"kris@x.com": "Kris Ladha"}, workspaces={"acct:7": "Lumina"})
    assert o["people"][0]["name"] == "Kris Ladha" and o["workspaces"][0]["name"] == "Lumina"
    assert o["missing"] == ["Video Studio"]


def test_every_source_returns_the_five_columns_collect_unpacks():
    for slug, label, unit, sql in spend.SOURCES:
        assert unit in ("usd", "credits") and "%(since)s" in sql and "%" not in sql.replace("%(since)s", ""), slug
    assert len({s[0] for s in spend.SOURCES}) == len(spend.SOURCES)
