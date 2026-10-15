"""Withdrawing a client's access from the admin panel.

The side panel for a client workspace lists who can sign in and which dashboards and agents are shared. An
admin can now take any of it back from there: remove a person or a whole domain, stop sharing one dashboard or
agent, or withdraw everything at once. The change is immediate (a client's page is checked on every request),
it lands in the account's audit trail with who made it, and it never touches staff.
"""

import os

import pytest

from tests import test_account_isolation as T
from tracker import client_access, client_accounts_store

KRIS = "kris@markifydigital.com"       # an admin
FETCH = {"X-Requested-With": "fetch"}
URL = "/admin/panel/account/lumina/revoke"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

seeded = T.seeded
world = T.world


def _revoke(body, who=KRIS, headers=FETCH, slug="lumina"):
    return T._client(who).post("/admin/panel/account/%s/revoke" % slug, json=body, headers=headers)


def _key():
    return T._acct("lumina")["key"]


def _shared(**shares):
    T._invite("lumina", **shares)


def _audit():
    return [(a["action"], a["detail"]) for a in client_accounts_store.audit(_key(), 100)]


# ── The panel says what can be withdrawn ───────────────────────────────────

def test_the_panel_lists_each_shared_dashboard_and_agent_with_its_key():
    _shared(**{"tool:page-watch": True, "tool:local-business-radar": True, "ai-review": True})
    d = T._client(KRIS).get("/admin/panel/account/lumina").get_json()
    items = {i["key"]: i for i in d["share_items"]}
    assert items["google-ads"]["kind"] == "page", "the Google Ads dashboard is shared by default"
    assert items["ai-review"]["label"] == "AI review" and items["ai-review"]["kind"] == "page"
    assert items["tool:page-watch"]["kind"] == "agent" and items["tool:local-business-radar"]["label"] == "Local Business Radar"
    assert "profile" not in items, "only what is shared now can be withdrawn"


# ── One thing at a time ────────────────────────────────────────────────────

def test_removing_a_person_ends_their_access_at_once(seeded):
    _shared(**{"tool:page-watch": True})
    client = T._client(T.CLIENT)
    assert client.get("/lumina").status_code == 200
    d = _revoke({"people": [T.CLIENT]}).get_json()
    assert d["people"] == [] and "tool:page-watch" in {i["key"] for i in d["share_items"]}, "shares stay"
    assert client.get("/lumina").status_code in (302, 403), "the next request is already refused"
    assert ("removed", T.CLIENT) in _audit()


def test_a_whole_domain_can_be_removed_too(seeded):
    client_accounts_store.add_access(_key(), "@luminasmiles.in", KRIS)
    assert T._client(T.CLIENT).get("/lumina").status_code == 200
    assert _revoke({"people": ["@luminasmiles.in"]}).get_json()["people"] == []
    assert T._client(T.CLIENT).get("/lumina").status_code in (302, 403)


def test_stopping_one_share_leaves_the_rest_and_the_people(seeded):
    _shared(**{"tool:page-watch": True, "tool:local-business-radar": True})
    d = _revoke({"shares": ["tool:page-watch"]}).get_json()
    keys = {i["key"] for i in d["share_items"]}
    assert "tool:page-watch" not in keys and "tool:local-business-radar" in keys and "google-ads" in keys
    assert len(d["people"]) == 1
    assert client_accounts_store.shares(_key())["tool:page-watch"] is False
    assert ("unshared", "tool:page-watch") in _audit()


def test_the_default_google_ads_share_can_be_withdrawn_even_though_it_was_never_stored(seeded):
    _shared()
    assert client_accounts_store.shares(_key()).get("google-ads") is None
    d = _revoke({"shares": ["google-ads"]}).get_json()
    assert "google-ads" not in {i["key"] for i in d["share_items"]}
    assert client_accounts_store.shares(_key())["google-ads"] is False, "an explicit off beats the default on"


# ── Everything at once ─────────────────────────────────────────────────────

def test_withdrawing_all_removes_everyone_and_every_share(seeded):
    _shared(**{"tool:page-watch": True, "tool:video-studio": True, "ai-review": True})
    client_accounts_store.add_access(_key(), "second@luminasmiles.in", KRIS)
    d = _revoke({"people": "all", "shares": "all"}).get_json()
    assert d["people"] == [] and d["share_items"] == [] and d["tools"] == [] and d["pages"] == []
    assert T._client(T.CLIENT).get("/lumina").status_code in (302, 403)
    acts = _audit()
    assert ("removed", T.CLIENT) in acts and ("removed", "second@luminasmiles.in") in acts
    assert {("unshared", "tool:page-watch"), ("unshared", "tool:video-studio"), ("unshared", "ai-review"),
            ("unshared", "google-ads")} <= set(acts)


def test_a_withdrawn_account_keeps_its_card_but_is_no_longer_counted_as_shared(seeded):
    admin = T._client(KRIS)
    _shared(**{"tool:page-watch": True})
    d = admin.get("/admin/panel/clients?fresh=1").get_json()
    assert [c["slug"] for c in d["accounts"]] == ["lumina"] and d["totals"]["accounts"] == 1
    assert d["accounts"][0]["withdrawn"] is False
    _revoke({"people": "all", "shares": "all"})
    d = admin.get("/admin/panel/clients?fresh=1").get_json()
    card = d["accounts"][0]
    assert card["withdrawn"] is True and card["people"] == [] and card["pages"] == [] and card["tools"] == []
    assert d["totals"]["accounts"] == 0 and d["totals"]["people"] == 0, "the hero figure no longer counts it"
    assert card["last_change"], "the history of what was withdrawn is still on the card"
    admin.post("/lumina/api/access", json={"who": T.CLIENT}, headers=FETCH)
    admin.post("/lumina/api/access/share", json={"share": "tool:page-watch", "on": True}, headers=FETCH)
    assert T._client(T.CLIENT).get("/lumina").status_code == 200, "sharing again is the same panel it always was"
    assert admin.get("/admin/panel/clients?fresh=1").get_json()["totals"]["accounts"] == 1


def test_withdrawing_what_is_already_gone_changes_nothing(seeded):
    _shared(**{"tool:page-watch": True})
    _revoke({"people": "all", "shares": "all"})
    before = len(client_accounts_store.audit(_key(), 100))
    d = _revoke({"people": "all", "shares": "all"}).get_json()
    assert d["people"] == [] and len(client_accounts_store.audit(_key(), 100)) == before
    assert _revoke({"people": ["nobody@elsewhere.com"], "shares": ["tool:page-watch"]}).status_code == 200
    assert len(client_accounts_store.audit(_key(), 100)) == before


def test_staff_keep_their_own_access(seeded):
    _shared(**{"tool:page-watch": True})
    _revoke({"people": "all", "shares": "all"})
    assert T._client(T.RAJ).get("/lumina").status_code == 200


# ── Who may do it ──────────────────────────────────────────────────────────

def test_only_an_admin_from_the_pages_own_script_can_withdraw(seeded):
    _shared(**{"tool:page-watch": True})
    assert _revoke({"people": "all"}, who=T.RAJ).status_code == 403, "staff who are not admins can see, not change"
    assert _revoke({"people": "all"}, who=T.CLIENT).status_code in (302, 403)
    assert _revoke({"people": "all"}, headers={}).status_code == 400, "a cross-site form cannot send the header"
    assert T._client(KRIS).get(URL).status_code == 405
    assert [p["who"] for p in client_accounts_store.access(_key())] == [T.CLIENT], "nothing changed"


def test_an_unknown_share_or_account_is_refused(seeded):
    assert _revoke({"shares": ["tool:rm -rf"]}).status_code == 400
    assert _revoke({"shares": ["google-ads", "history"]}).status_code == 400
    assert _revoke({"people": "all"}, slug="no-such-account").status_code == 404


# ── The panel's script ─────────────────────────────────────────────────────

def test_the_side_panel_script_asks_before_it_withdraws_and_sends_the_header():
    js = open(os.path.join(ROOT, "static", "js", "admin_panel.js"), encoding="utf-8").read()
    for hook in ("data-revoke-share", "data-revoke-person", "data-revoke-all"):
        assert hook in js, hook
    assert "window.confirm(ask)" in js, "every withdrawal is confirmed first"
    assert "'X-Requested-With': 'fetch'" in js and "/revoke'" in js
    assert "Withdraw all access" in js and "Stop sharing" in js
    css = open(os.path.join(ROOT, "static", "css", "admin_panel.css"), encoding="utf-8").read()
    for cls in (".ctl-rv", ".ctl-danger-btn", ".ctl-danger-sm", ".ctl-dnote"):
        assert cls in css, cls
