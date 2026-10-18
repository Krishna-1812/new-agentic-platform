"""Buyer Radar's store on a real Postgres (tracker/buyer_radar_store.py): settings per owner, a post kept once
per owner, nobody written to twice from any workspace, opt-outs for everyone, the daily caps' counts, the
month's spend and the runs a workspace's History reads."""
import os
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracker import buyer_radar as br  # noqa: E402
from tracker import buyer_radar_store as store  # noqa: E402
from tests.test_market_radar_store import pg  # noqa: E402,F401  (fixture)


@pytest.fixture
def db(pg, monkeypatch):
    monkeypatch.setattr(store, "_READY", False)
    return store


def _lead(key, score=90, person="in/jane", emails=()):
    return {"post": {"key": key, "url": "https://www.linkedin.com/posts/" + key, "text": "Need a call audit tool",
                     "author": {"name": "Jane", "key": person}},
            "verdict": {"need": "a tool", "score": score}, "offer": "callvibe", "score": score, "person": person,
            "emails": list(emails), "draft": {"subject": "s", "email": "e", "note": "n", "message": "m"}}


def test_settings_are_each_owners_and_the_daily_list_reads_them(db):
    assert db.get_settings("acct:1") == br.merged({})
    db.save_settings("acct:1", br.clean_settings({"daily": True}), "kris@x.com")
    db.save_settings("acct:2", br.clean_settings({"daily": False}))
    db.save_settings("acct:1", br.clean_settings({"daily": True, "per_query": 40}))
    assert db.get_settings("acct:1")["per_query"] == 40 and db.get_settings("acct:2")["daily"] is False
    assert db.daily_owners() == ["acct:1"]


def test_a_post_is_one_lead_per_owner(db):
    run = db.create_run("acct:1", br.merged({}), 2.0, "kris@x.com")
    assert db.add_leads("acct:1", run, [_lead("p1", emails=["jane@acme.com"]), _lead("p2", 70)]) == [1, 2]
    assert db.add_leads("acct:1", run, [_lead("p1")]) == [None], "the same post found again is not a new lead"
    assert db.add_leads("acct:2", run, [_lead("p1")])[0] is not None, "another workspace keeps its own"
    assert db.known_posts("acct:1", ["p1", "p9"]) == {"p1"}
    got = db.list_leads("acct:1")
    assert [x["post"]["key"] for x in got] == ["p1", "p2"] or [x["post"]["key"] for x in got] == ["p2", "p1"]
    one = db.get_lead(1, "acct:1")
    assert one["email"] == "jane@acme.com" and one["email_source"] == "post" and one["draft"]["note"] == "n"
    assert db.get_lead(1, "acct:2") is None
    assert [x["score"] for x in db.list_leads("acct:1", min_score=80)] == [90]
    assert db.update_lead(2, "acct:1", status="dismissed") and db.list_leads("acct:1", status="dismissed")[0]["id"] == 2
    assert not db.update_lead(2, "acct:2", status="new"), "never another owner's lead"
    with pytest.raises(ValueError):
        db.update_lead(2, "acct:1", status="bogus")
    assert db.counts("acct:1") == {"all": 2, "new": 1, "contacted": 0, "replied": 0, "week": 2}


def test_nobody_is_written_to_twice_and_an_opt_out_holds_everywhere(db):
    run = db.create_run("acct:1", {}, 1)
    [lid] = db.add_leads("acct:1", run, [_lead("p1", emails=["jane@acme.com"])])
    assert not db.already_contacted("email", person="in/jane", recipient="jane@acme.com")
    db.record_send("acct:1", lid, "email", "jane@acme.com", "in/jane", "failed", "refused", "kris@x.com")
    assert not db.already_contacted("email", person="in/jane", recipient="jane@acme.com"), "a failed send does not count"
    db.record_send("acct:1", lid, "email", "jane@acme.com", "in/jane", "sent", "", "")
    assert db.already_contacted("email", recipient="JANE@acme.com") and db.already_contacted("email", person="in/jane")
    assert not db.already_contacted("linkedin", person="in/jane"), "each channel on its own"
    assert db.get_lead(lid, "acct:1")["status"] == "contacted"
    sends = db.list_leads("acct:1")[0]["sends"]
    assert [(s["status"], s["by"]) for s in sends] == [("failed", "kris@x.com"), ("sent", "")]
    assert db.sent_today("acct:1", "email") == 1 and db.sent_today("acct:2", "email") == 0 and db.sent_today_all("email") == 1
    assert not db.suppressed("jane@acme.com")
    db.suppress("Jane@Acme.com", "opted out")
    db.suppress("jane@acme.com", "again")
    assert db.suppressed("jane@acme.com") and db.suppressed("x", "JANE@ACME.COM") and not db.suppressed("", None)


def test_runs_and_spend_are_kept_for_the_history_and_the_caps(db):
    a = db.create_run("acct:1", br.merged({}), 2.0, "kris@x.com")
    b = db.create_run("acct:1", br.merged({}), 2.0, None, trigger="daily")
    db.create_run("acct:2", {}, 1)
    db.add_spend(a, "acct:1", "kris@x.com", "apify", "post-search", usd=0.25)
    db.add_spend(a, "acct:1", "kris@x.com", "anthropic", "read", usd=0.0123456)
    db.add_spend(b, "acct:1", None, "saleshandy", "email-reveal", credits=3)
    db.update_run(a, status="ready", stage="done", summary={"kept": 4})
    run = db.get_run(a, "acct:1")
    assert run["status"] == "ready" and run["summary"] == {"kept": 4} and run["spent_usd"] == pytest.approx(0.2623, abs=1e-4)
    assert db.get_run(a, "acct:2") is None
    assert [r["id"] for r in db.list_runs("acct:1")] == [b, a] and "settings" not in db.list_runs("acct:1")[0]
    assert db.running_run("acct:1")["id"] == b
    assert db.ran_today("acct:1") and not db.ran_today("acct:2")
    assert db.month_spend("acct:1") == {"usd": pytest.approx(0.2623, abs=1e-4), "credits": 3.0}
    rows = db.space_runs("acct:1")
    assert [(r["id"], r["trigger"], r["started_by"]) for r in rows] == [(b, "daily", None), (a, "manual", "kris@x.com")]


def test_unipile_results_today_are_counted_across_every_workspace(db):
    assert db.unipile_results_today() == 0
    a = db.create_run("acct:1", br.merged({}), 2.0)
    b = db.create_run("acct:2", br.merged({}), 2.0)
    c = db.create_run("acct:2", br.merged({"source": "apify"}), 2.0)
    db.update_run(a, summary={"source": "unipile", "unipile_results": 300})
    db.update_run(b, summary={"source": "unipile", "unipile_results": 25})
    db.update_run(c, summary={"source": "apify", "posts": 400})
    assert db.unipile_results_today() == 325, "one LinkedIn account searches for every workspace"
    db._exec("UPDATE br_runs SET created_at = now() - interval '2 days' WHERE id=%s", (a,))
    assert db.unipile_results_today() == 25, "yesterday's do not count"
