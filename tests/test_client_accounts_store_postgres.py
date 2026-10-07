"""Client accounts' URL names against a REAL Postgres.

The in-memory store runs everywhere else; these run the SQL: the tables, a rename that retires the
old slug, an account that gains Google Ads and keeps its row, two moves at once, and two syncs at
the same moment. They skip without DATABASE_URL; CI runs them in the Postgres job
(.github/workflows/event-intelligence-tests.yml).
"""

import os
import threading
import uuid

import pytest

from tracker import client_accounts_store as store

pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"),
                                reason="needs a real Postgres; set DATABASE_URL to a throwaway database")


def _acct(key, name, url_name="", alt=()):
    return {"key": key, "name": name, "url_name": url_name, "alt_keys": list(alt)}


@pytest.fixture
def tag():
    return uuid.uuid4().hex[:8]


def test_slugs_are_stored_renamed_and_redirected(tag):
    assert store.backend() == "postgres"
    a = _acct("cid:%s1" % tag, "Lumina %s" % tag)
    out = store.sync([a], set())
    assert out["rows"][a["key"]] == "lumina-%s" % tag
    out = store.sync([dict(a, url_name="lum-%s" % tag)], set())
    assert out["rows"][a["key"]] == "lum-%s" % tag and out["retired"]["lumina-%s" % tag] == a["key"]
    assert store.load()["rows"][a["key"]] == "lum-%s" % tag
    out = store.sync([a], set())
    assert out["rows"][a["key"]] == "lumina-%s" % tag and out["retired"]["lum-%s" % tag] == a["key"]
    assert "lumina-%s" % tag not in out["retired"], "a slug taken back is live again, not retired"


def test_an_account_that_gains_google_ads_keeps_its_row(tag):
    doc = _acct("doc:bloom %s" % tag, "Bloom %s" % tag)
    store.sync([doc], set())
    gained = _acct("cid:%s9" % tag, "Bloom %s" % tag, alt=["doc:bloom %s" % tag])
    out = store.sync([gained], set())
    assert out["rows"][gained["key"]] == "bloom-%s" % tag and doc["key"] not in store.load()["rows"]


def test_two_accounts_can_trade_places_without_a_clash(tag):
    a, b = _acct("cid:%sa" % tag, "A %s" % tag, "x-%s" % tag), _acct("cid:%sb" % tag, "B %s" % tag, "y-%s" % tag)
    store.sync([a, b], set())
    out = store.sync([dict(a, url_name="x2-%s" % tag), dict(b, url_name="y2-%s" % tag)], set())
    assert out["rows"][a["key"]] == "x2-%s" % tag and out["rows"][b["key"]] == "y2-%s" % tag


def test_syncs_at_the_same_moment_give_one_slug_once(tag):
    accts = [_acct("cid:%s%d" % (tag, i), "Same Name %s" % tag) for i in range(4)]
    errors = []

    def run():
        try:
            store.sync(accts, set())
        except Exception as e:   # noqa: BLE001 - any failure is the finding
            errors.append(e)
    threads = [threading.Thread(target=run) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert not errors
    rows = store.load()["rows"]
    slugs = [rows[a["key"]] for a in accts]
    assert len(set(slugs)) == 4 and "same-name-%s" % tag in slugs


def test_invites_shares_and_the_history_are_stored_and_follow_the_account(tag):
    doc = _acct("doc:co %s" % tag, "Co %s" % tag)
    store.sync([doc], set())
    assert store.add_access(doc["key"], "ana@co-%s.in" % tag, "admin@x") is True
    assert store.add_access(doc["key"], "ana@co-%s.in" % tag, "admin@x") is False, "once"
    assert store.add_access(doc["key"], "@co-%s.in" % tag, "admin@x") is True
    assert store.keys_for("ANA@co-%s.in" % tag) == {doc["key"]}
    assert store.keys_for("raj@co-%s.in" % tag) == {doc["key"]}, "by domain"
    assert store.keys_for("raj@other-%s.in" % tag) == set()
    store.set_share(doc["key"], "ai-review", True, "admin@x")
    store.set_share(doc["key"], "profile", True, "admin@x")
    store.set_share(doc["key"], "profile", False, "admin@x")
    assert store.shares(doc["key"]) == {"ai-review": True, "profile": False}
    gained = _acct("cid:%s7" % tag, "Co %s" % tag, alt=[doc["key"]])
    store.sync([gained], set())
    assert store.keys_for("ana@co-%s.in" % tag) == {gained["key"]}, "invites follow the new key"
    assert store.shares(gained["key"])["ai-review"] is True
    assert store.remove_access(gained["key"], "ana@co-%s.in" % tag, "admin@x") is True
    assert [e["who"] for e in store.access(gained["key"])] == ["@co-%s.in" % tag]
    log = store.audit(gained["key"])
    assert [a["action"] for a in log][:2] == ["removed", "unshared"] and len(log) == 6


def test_tool_shares_the_run_limit_and_what_clients_do_are_stored(tag):
    a = _acct("doc:usage %s" % tag, "Usage %s" % tag)
    store.sync([a], set())
    k = a["key"]
    store.set_share(k, "tool:page-watch", True, "kris@x.com")
    store.set_setting(k, "runs_per_month", 35, "kris@x.com")
    assert store.shares(k) == {"tool:page-watch": True, "runs_per_month": 35}
    assert store.audit(k)[0]["action"] == "set" and store.audit(k)[0]["detail"] == "runs_per_month=35"
    store.record(k, "Ana@Lumina.in", "visit", tool="", path="/usage")
    store.record(k, "ana@lumina.in", "run", tool="page-watch", path="/x")
    assert store.runs_this_month(k) == 1
    ev = store.events(k)
    assert [(e["email"], e["kind"]) for e in ev] == [("ana@lumina.in", "run"), ("ana@lumina.in", "visit")]
    assert k in store.shared_keys()
