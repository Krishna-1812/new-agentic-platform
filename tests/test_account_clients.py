"""Client access: someone outside the agency, invited to one account, sees that account and nothing else.

An admin invites an email or a company domain to an account (/<account>/api/access) and chooses
what it shares (tracker/client_access.py). An invited client signs in with Google, lands on their
account, and sees only what it shares: never another account (by URL, API, picker data or the
insights filters), never the platform's own tools, never the agency's notes, costs or the master doc.
"""

import json
import re
from datetime import datetime, timezone

import pytest

import app as appmod
from tracker import client_access, client_accounts_store, gads_ai_store, google_ads_insights as gai

ADMIN = sorted(appmod.ADMIN_EMAILS)[0]
STAFF = "reporting@markifydigital.com"
CLIENT = "ana@lumina.in"


def _row(account, cid, campaign, day, cost=100.0):
    return {"account": account, "customer_id": cid, "campaign": campaign, "state": "Enabled", "type": "Search",
            "day": day, "clicks": 10.0, "impressions": 100.0, "cost": cost, "currency": "INR", "conversions": 1.0,
            "view_through": 0.0, "top_pct": 0.0, "abs_top_pct": 0.0, "cost_native": cost, "currency_native": "INR"}


ROWS = ([_row("Lumina Smiles Dental", "412-118-3390", "Search - Implants", "2026-09-%02d" % d, 300) for d in range(1, 31)]
        + [_row("Harbourline Realty", "610-224-8812", "Search - 2BHK Secret", "2026-09-%02d" % d, 900)
           for d in range(1, 31)])


def _p(text):
    return {"paragraph": {"elements": [{"textRun": {"content": text + "\n"}}],
                          "paragraphStyle": {"namedStyleType": "NORMAL_TEXT"}}}


DOC = {"title": "Master doc", "tabs": [{"tabProperties": {"title": "Lumina Smiles Dental"}, "documentTab": {"body": {"content": [
    _p("URL name: lumina"), _p("Website: luminasmiles.in"), _p("Goals / KPIs: 120 leads a month"),
    _p("NOTES"), _p("Internal: client is slow to pay.")]}}}]}


@pytest.fixture(autouse=True)
def world(monkeypatch):
    client_accounts_store.reset_memory()
    gads_ai_store.reset_memory()
    appmod._acct_reset()
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: ROWS)
    monkeypatch.setattr(appmod, "_acct_doc", lambda: (DOC, "https://docs.google.com/document/d/SECRETDOCID/edit", None))
    monkeypatch.setattr(appmod, "_google_ads_insights", lambda rows=None, **kw: dict(gai.empty(), ok=True,
                                                                                      seen_only=list(kw.get("only") or [])))
    yield
    client_accounts_store.reset_memory()
    gads_ai_store.reset_memory()
    appmod._acct_reset()


def _client(email):
    c = appmod.app.test_client()
    if email:
        with c.session_transaction() as sess:
            sess["google_user"] = {"email": email, "name": "T"}
    return c


def _post(c, url, body):
    return c.post(url, json=body, headers={"X-Requested-With": "fetch"})


def _invite(who=CLIENT, slug="lumina"):
    r = _post(_client(ADMIN), "/%s/api/access" % slug, {"who": who})
    assert r.status_code == 200, r.get_json()
    return r.get_json()


def _share(share, on, slug="lumina"):
    r = _post(_client(ADMIN), "/%s/api/access/share" % slug, {"share": share, "on": on})
    assert r.status_code == 200, r.get_json()


# ── Who can be invited ───────────────────────────────────────────────────────
@pytest.mark.parametrize("raw, stored", [
    ("Ana@Lumina.in", "ana@lumina.in"), ("  @lumina.in ", "@lumina.in"), ("lumina.in", "@lumina.in"),
    ("Ana Rao <ana@lumina.in>", "ana@lumina.in"), ("mailto:ana@lumina.in", "ana@lumina.in"),
])
def test_invites_are_stored_one_way(raw, stored):
    assert client_access.normalise(raw, "markifydigital.com") == stored


@pytest.mark.parametrize("raw", ["@gmail.com", "gmail.com", "@outlook.com", "@markifydigital.com",
                                 "x@markifydigital.com", "not an email", "", "@localhost", "ana@"])
def test_a_domain_anyone_can_join_or_the_agencys_own_is_refused(raw):
    with pytest.raises(client_access.Bad):
        client_access.normalise(raw, "markifydigital.com")


def test_only_an_admin_changes_who_sees_an_account():
    r = _post(_client(STAFF), "/lumina/api/access", {"who": CLIENT})
    assert r.status_code == 403
    assert _client(STAFF).get("/lumina/api/access").get_json()["can_change"] is False, "staff may look"
    r = _client(ADMIN).post("/lumina/api/access", json={"who": CLIENT})
    assert r.status_code == 400, "a POST without the page's own header is refused"
    d = _invite()
    assert d["people"][0]["who"] == CLIENT and d["link"].endswith("/lumina") and d["can_change"] is True
    assert d["audit"][0]["action"] == "invited" and d["audit"][0]["actor"] == ADMIN
    r = _post(_client(ADMIN), "/lumina/api/access", {"who": "@gmail.com"})
    assert r.status_code == 400 and "Anyone can have an address" in r.get_json()["error"]


def test_a_client_can_never_manage_access_even_to_their_own_account():
    _invite()
    assert _client(CLIENT).get("/lumina/api/access").status_code == 403
    assert _post(_client(CLIENT), "/lumina/api/access", {"who": "eve@evil.com"}).status_code == 403
    assert _post(_client(CLIENT), "/lumina/api/access/share", {"share": "ai-review", "on": True}).status_code == 403


# ── What an invited client sees ──────────────────────────────────────────────
def test_an_invited_client_sees_their_account_and_only_what_it_shares():
    _invite()
    c = _client(CLIENT)
    html = c.get("/lumina").get_data(as_text=True)
    assert "Lumina Smiles Dental" in html and "₹9,000" in html, "the Google Ads dashboard is shared by default"
    assert 'href="/lumina/google-ads"' in html and "/google-ads/ai-review" not in html, "the AI review is not"
    assert "120 leads a month" not in html, "the profile is not shared by default"
    for internal in ("SECRETDOCID", "Master doc", "Internal use only", "slow to pay", "Jump to", "/hub", "/playbook",
                     "data-share-open", "Google Ads 412-118-3390", "bento-palette.js", "__KP_BASE__"):
        assert internal not in html, internal
    assert "Prepared for you" in html
    assert c.get("/lumina/google-ads").status_code == 200
    r = c.get("/lumina/google-ads/ai-review")
    assert r.status_code == 302 and r.headers["Location"].endswith("/lumina"), "an unshared page leads home"


def test_a_client_never_sees_another_account():
    _invite()
    c = _client(CLIENT)
    r = c.get("/harbourline-realty")
    html = r.get_data(as_text=True)
    assert r.status_code == 403 and "2BHK" not in html and "Harbourline" not in html
    assert 'href="/lumina"' in html, "it points to the account they do have"
    assert c.get("/harbourline-realty/google-ads").status_code == 403
    assert c.get("/harbourline-realty/api/google-ads/insights").status_code == 403
    assert c.get("/dashboards/google-ads").status_code == 302, "the all-accounts dashboard is staff only"
    assert c.get("/api/dashboards/google-ads/insights").status_code == 302
    assert c.get("/hub").status_code == 302


def test_everything_a_clients_page_carries_is_their_own():
    _invite()
    c = _client(CLIENT)
    for path in ("/lumina", "/lumina/google-ads"):
        html = c.get(path).get_data(as_text=True)
        assert "Harbourline" not in html and "2BHK" not in html and "610-224-8812" not in html, path
        nav = json.loads(re.search(r'<script id="acct-data" type="application/json">(.*?)</script>', html, re.S).group(1))
        assert [a["slug"] for a in nav["accounts"]] == ["lumina"] and nav["client"] is True and nav["global"] == {}
    d = c.get("/api/accounts").get_json()
    assert [a["slug"] for a in d["accounts"]] == ["lumina"]
    assert [p["page"] for p in d["accounts"][0]["pages"]] == ["", "google-ads"]


def test_the_clients_insights_and_rows_are_scoped_and_they_cannot_ask_their_way_out():
    _invite()
    c = _client(CLIENT)
    d = c.get("/lumina/api/google-ads/insights?account=Harbourline%20Realty&search=2BHK").get_json()
    assert d["seen_only"] == ["Lumina Smiles Dental"]
    html = c.get("/lumina/google-ads").get_data(as_text=True)
    rows = json.loads(re.search(r'<script id="gad-data" type="application/json">(.*?)</script>', html, re.S).group(1))
    assert {r["account"] for r in rows} == {"Lumina Smiles Dental"}
    assert "data-gad-refresh" not in html and "Prepared for Lumina Smiles Dental" in html
    assert c.post("/lumina/api/google-ads/refresh").status_code == 403, "refreshing the sheet is staff only"
    assert 'id="gad-ai-link"' not in html and "/ai-review" not in html, "no link to an unshared page"


def test_a_domain_invite_lets_everyone_at_the_company_in():
    _invite("@lumina.in")
    assert _client("raj@lumina.in").get("/lumina").status_code == 200
    assert _client("raj@lumina.in.evil.com").get("/lumina").status_code == 403
    assert _client("raj@notlumina.in").get("/lumina").status_code == 403


def test_removing_someone_shuts_them_out_at_once():
    _invite()
    c = _client(CLIENT)
    assert c.get("/lumina").status_code == 200
    r = _post(_client(ADMIN), "/lumina/api/access/remove", {"who": CLIENT})
    assert r.get_json()["people"] == [] and r.get_json()["audit"][0]["action"] == "removed"
    assert c.get("/lumina").status_code == 403


def test_sharing_the_profile_and_the_ai_review():
    _invite()
    _share("profile", True)
    _share("ai-review", True)
    rid = gads_ai_store.create_review("Lumina Smiles Dental", STAFF)
    gads_ai_store.update_review(rid, status="complete", report={"headline": "Leads up", "overall": "on_track",
                                                                "context": {"kind": "doc", "found": True,
                                                                            "title": "Master doc", "where": ["tab x"]}},
                                cost={"usd": 1.23}, finished_at=datetime.now(timezone.utc))
    running = gads_ai_store.create_review("Lumina Smiles Dental", STAFF)
    gads_ai_store.update_review(running, status="running")
    c = _client(CLIENT)
    html = c.get("/lumina").get_data(as_text=True)
    assert "120 leads a month" in html and "slow to pay" not in html and 'href="/lumina/google-ads/ai-review"' in html
    page = c.get("/lumina/google-ads/ai-review").get_data(as_text=True)
    assert "data-review-readonly" in page and 'data-review-api="/lumina/api/ai-review"' in page
    assert 'id="gar-run"' not in page and 'id="gar-brief"' not in page and "US$" not in page
    lst = c.get("/lumina/api/ai-review/reviews?account=Lumina%20Smiles%20Dental").get_json()
    assert [r["id"] for r in lst["reviews"]] == [rid], "only finished reviews"
    assert "email" not in lst["reviews"][0] and "cost_usd" not in lst["reviews"][0]
    one = c.get("/lumina/api/ai-review/reviews/%d" % rid).get_json()["review"]
    assert one["report"]["headline"] == "Leads up" and one["report"]["context"] == {"kind": "doc", "found": True}
    assert "email" not in one and "cost_usd" not in one
    assert c.get("/lumina/api/ai-review/reviews/%d" % running).status_code == 404
    assert c.get("/lumina/api/ai-review/reviews?account=Harbourline%20Realty").status_code == 400
    other = gads_ai_store.create_review("Harbourline Realty", STAFF)
    gads_ai_store.update_review(other, status="complete", report={"headline": "secret"})
    assert c.get("/lumina/api/ai-review/reviews/%d" % other).status_code == 404, "another account's review"


def test_the_client_lands_on_their_account_after_signing_in():
    assert appmod._acct_landing("nobody@x.com") == "/app"
    _invite()
    assert appmod._acct_landing(CLIENT) == "/lumina"
    r = _client(CLIENT).get("/")
    assert r.status_code == 302 and r.headers["Location"].endswith("/lumina")


def test_a_client_with_one_account_has_no_switch_and_one_with_two_has_only_theirs():
    _invite()
    html = _client(CLIENT).get("/lumina").get_data(as_text=True)
    assert "ap-pill--static" in html and "data-acct-picker" not in html
    _invite(CLIENT, slug="harbourline-realty")
    html = _client(CLIENT).get("/lumina").get_data(as_text=True)
    assert 'class="ap-pill" data-acct-picker' in html
    nav = _client(CLIENT).get("/api/accounts").get_json()
    assert sorted(a["slug"] for a in nav["accounts"]) == ["harbourline-realty", "lumina"]


def test_invites_follow_an_account_when_its_key_changes():
    client_accounts_store.sync([{"key": "doc:bloom", "name": "Bloom", "url_name": "", "alt_keys": []}], set())
    client_accounts_store.add_access("doc:bloom", "x@bloom.in", ADMIN)
    client_accounts_store.sync([{"key": "cid:1", "name": "Bloom", "url_name": "", "alt_keys": ["doc:bloom"]}], set())
    assert client_accounts_store.keys_for("x@bloom.in") == {"cid:1"}
