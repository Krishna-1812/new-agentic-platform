"""Outcomes.digital, the agency's own workspace (asked for on 2026-10-19).

It is always listed (tracker/client_accounts.HOUSE), whether or not the master doc has a tab for it,
and works like any client's: the whole team opens it, every agent opens inside it, and an admin can
share it with someone outside the agency. A master doc tab with its name or website takes its place.
"""

import re

import pytest

import app as appmod
from tracker import client_accounts, client_accounts_store, gads_ai_store, google_ads_insights as gai

HOUSE = client_accounts.HOUSE
ADMIN = sorted(appmod.ADMIN_EMAILS)[0]
STAFF = "reporting@markifydigital.com"
GUEST = "sam@partnerco.com"


def _row(day):
    return {"account": "Lumina Smiles Dental", "customer_id": "412-118-3390", "campaign": "Search", "state": "Enabled",
            "type": "Search", "day": day, "clicks": 10.0, "impressions": 100.0, "cost": 100.0, "currency": "INR",
            "conversions": 1.0, "view_through": 0.0, "top_pct": 0.0, "abs_top_pct": 0.0, "cost_native": 100.0,
            "currency_native": "INR"}


def _p(text):
    return {"paragraph": {"elements": [{"textRun": {"content": text + "\n"}}],
                          "paragraphStyle": {"namedStyleType": "NORMAL_TEXT"}}}


def _doc(*tabs):
    return {"title": "Master", "tabs": [{"tabProperties": {"title": t}, "documentTab": {"body": {"content": [_p(x) for x in lines]}}}
                                        for t, lines in tabs]}


@pytest.fixture(autouse=True)
def world(monkeypatch):
    monkeypatch.setattr(client_accounts, "HOUSE", HOUSE)        # conftest leaves it out of every other test
    client_accounts_store.reset_memory()
    gads_ai_store.reset_memory()
    appmod._acct_reset()
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: [_row("2026-09-%02d" % d) for d in range(1, 31)])
    monkeypatch.setattr(appmod, "_acct_doc", lambda: (None, None, None))
    monkeypatch.setattr(appmod, "_google_ads_insights", lambda rows=None, **kw: dict(gai.empty(), ok=True))
    yield
    client_accounts_store.reset_memory()
    gads_ai_store.reset_memory()
    appmod._acct_reset()


def _client(email):
    c = appmod.app.test_client()
    with c.session_transaction() as sess:
        sess["google_user"] = {"email": email, "name": "T"}
        sess["people_seen"] = True
    return c


def _house(accounts):
    return [a for a in accounts if a["name"] == "Outcomes.digital"]


# ── The list ─────────────────────────────────────────────────────────────────
def test_it_is_listed_with_no_master_doc_and_no_google_ads():
    (a,) = _house(client_accounts.build([("Lumina Smiles Dental", "412-118-3390")]))
    assert a["url_name"] == "outcomes-digital" and a["profile"]["website"] == "https://www.outcomes.digital"
    assert a["ads_names"] == [] and a["customer_ids"] == [] and not a["hidden"] and a["key"] == "doc:outcomes digital"


@pytest.mark.parametrize("tab", [
    ("Outcomes.digital", ["Industry: Agency", "Account manager: Kris"]),
    ("Our agency site", ["Display name: Outcomes Digital HQ", "Website: outcomes.digital"]),
])
def test_a_master_doc_tab_for_it_takes_its_place(tab):
    accounts = client_accounts.build([], _doc(tab))
    assert len(accounts) == 1 and accounts[0]["tab"] == tab[0]


def test_build_can_leave_it_out():
    assert client_accounts.build([], None, house=()) == []


# ── Like any client's workspace ──────────────────────────────────────────────
def test_the_team_opens_it_at_its_own_address_with_every_agent():
    listing = appmod._acct_listing()
    assert "outcomes-digital" in listing["by_slug"]
    html = _client(STAFF).get("/outcomes-digital").get_data(as_text=True)
    assert "Outcomes.digital" in html
    for a in appmod.ACCT_AGENTS:
        page = ("operational-agents/" if a[0] in appmod.paid_catalog.WORKSPACE_SLUGS else "agents/") + a[0]
        assert 'href="/outcomes-digital/%s"' % page in html, a[3]
        assert _client(STAFF).get("/outcomes-digital/" + page).status_code == 200, a[3]
    for page in ("page-watch", "video-studio"):
        assert _client(STAFF).get("/outcomes-digital/" + page).status_code == 200


def test_an_admin_can_share_it_like_a_clients():
    r = _client(ADMIN).post("/outcomes-digital/api/access", json={"who": GUEST}, headers={"X-Requested-With": "fetch"})
    assert r.status_code == 200 and r.get_json()["link"].endswith("/outcomes-digital")
    assert _client(GUEST).get("/outcomes-digital").status_code == 200
    assert _client(GUEST).get("/lumina-smiles-dental").status_code == 403
