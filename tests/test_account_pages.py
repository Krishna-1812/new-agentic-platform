"""Client accounts in the app: the switch in every top bar, the hub, and each account's pages.

/<account> is the account's home; /<account>/google-ads and /<account>/google-ads/ai-review are
the dashboard and the AI review for that account alone. An account's pages and its APIs read only
its own Google Ads rows; a renamed account's old address redirects; anything that is not an
account is the same 404 it always was.
"""

import json
import re

import pytest

import app as appmod
from tracker import client_accounts_store, google_ads_insights as gai

STAFF = "reporting@markifydigital.com"


def _row(account, cid, campaign, day, cost=100.0, conv=1.0):
    return {"account": account, "customer_id": cid, "campaign": campaign, "state": "Enabled", "type": "Search",
            "day": day, "clicks": 10.0, "impressions": 100.0, "cost": cost, "currency": "INR", "conversions": conv,
            "view_through": 0.0, "top_pct": 0.0, "abs_top_pct": 0.0, "cost_native": cost, "currency_native": "INR"}


ROWS = ([_row("Lumina Smiles Dental", "412-118-3390", "Search - Implants", "2026-09-%02d" % d, 300) for d in range(1, 31)]
        + [_row("Harbourline Realty", "610-224-8812", "Search - 2BHK Secret", "2026-09-%02d" % d, 900)
           for d in range(1, 31)]
        + [_row("Orbit Fitness", "456-002-3318", "Search - Gym", "2026-09-30", 10)])


def _p(text):
    return {"paragraph": {"elements": [{"textRun": {"content": text + "\n"}}],
                          "paragraphStyle": {"namedStyleType": "NORMAL_TEXT"}}}


def _tab(title, *lines):
    return {"tabProperties": {"title": title}, "documentTab": {"body": {"content": [_p(x) for x in lines]}}}


DOC = {"title": "Master", "tabs": [
    _tab("Lumina Smiles Dental", "URL name: lumina", "Website: luminasmiles.in", "Industry: Dental clinic",
         "Goals / KPIs: 120 leads a month", "Competitors: smilecare.in"),
    _tab("Orbit Fitness", "Status: hidden"),
    _tab("Bloom Skin Clinic", "Website: bloomskin.in", "Industry: Dermatology"),
]}
STATE = {"doc": DOC}


@pytest.fixture(autouse=True)
def accounts(monkeypatch):
    client_accounts_store.reset_memory()
    appmod._acct_reset()
    STATE["doc"] = DOC
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: ROWS)
    monkeypatch.setattr(appmod, "_acct_doc", lambda: (STATE["doc"], "https://docs.google.com/document/d/x/edit", None))
    yield
    client_accounts_store.reset_memory()
    appmod._acct_reset()


def _client(email=STAFF):
    c = appmod.app.test_client()
    if email:
        with c.session_transaction() as sess:
            sess["google_user"] = {"email": email, "name": "T"}
    return c


def _json_script(html, sid):
    m = re.search(r'<script id="%s" type="application/json">(.*?)</script>' % sid, html, re.S)
    assert m, sid
    return json.loads(m.group(1))


# ── The list ─────────────────────────────────────────────────────────────────
def test_staff_get_every_account_for_the_picker():
    d = _client().get("/api/accounts").get_json()
    assert [a["slug"] for a in d["accounts"]] == ["harbourline-realty", "lumina", "bloom-skin-clinic"], \
        "by spend; a hidden account is left out; an account with no Google Ads comes from the doc"
    lum = d["accounts"][1]
    assert lum["name"] == "Lumina Smiles Dental" and lum["domain"] == "luminasmiles.in"
    assert lum["spend_fmt"] == "₹9,000" and len(lum["spark"]) == 30
    assert [p["page"] for p in lum["pages"]] == ["", "google-ads", "google-ads/ai-review", "page-watch", "video-studio"]
    assert [p["page"] for p in d["accounts"][2]["pages"]] == ["", "page-watch", "video-studio"], \
        "no Google Ads, no Google Ads pages"
    assert d["global"]["google-ads"] == "/dashboards/google-ads"


def test_only_staff_get_the_list_and_no_one_else_gets_anything():
    r = _client("someone@gmail.com").get("/api/accounts")
    assert r.status_code == 403 and r.get_json()["accounts"] == [], "not invited anywhere: nothing"
    assert _client(None).get("/api/accounts").status_code == 302


# ── An account's home ────────────────────────────────────────────────────────
def test_an_account_has_its_own_home():
    html = _client().get("/lumina").get_data(as_text=True)
    assert "Lumina Smiles Dental" in html and 'data-acct-current="lumina"' in html
    assert "luminasmiles.in" in html and "120 leads a month" in html and "smilecare.in" in html
    assert "₹9,000" in html and 'href="/lumina/google-ads"' in html and 'href="/lumina/google-ads/ai-review"' in html
    assert "Search - Implants" in html and "Search - 2BHK Secret" not in html, "only this account's campaigns"
    assert 'view-transition-name: acct-name' in html


def test_an_account_without_a_profile_offers_one_filled_in():
    html = _client().get("/harbourline-realty").get_data(as_text=True)
    assert "No profile for Harbourline Realty yet." in html
    assert "Google Ads ID: 610-224-8812" in html and "URL name: harbourline-realty" in html


def test_an_account_from_the_doc_alone_has_no_google_ads_pages():
    c = _client()
    html = c.get("/bloom-skin-clinic").get_data(as_text=True)
    assert "No Google Ads account linked" in html and "Dermatology" in html
    r = c.get("/bloom-skin-clinic/google-ads")
    assert r.status_code == 302 and r.headers["Location"].endswith("/bloom-skin-clinic")


def test_a_hidden_account_still_opens_by_its_address():
    assert _client().get("/orbit-fitness").status_code == 200


def test_anything_that_is_not_an_account_is_still_a_404_and_routes_are_untouched():
    c = _client()
    assert c.get("/no-such-client").status_code == 404
    assert c.get("/no-such-client/google-ads").status_code == 404
    assert c.get("/hub").status_code == 200
    assert c.get("/Lumina").status_code == 404, "URL names are lower case"


def test_signing_in_is_needed_and_only_staff_get_in():
    r = _client(None).get("/lumina")
    assert r.status_code == 302 and "/login" in r.headers["Location"]
    r = _client("someone@gmail.com").get("/lumina/google-ads")
    html = r.get_data(as_text=True)
    assert r.status_code == 403 and "have access to it." in html and "someone@gmail.com" in html
    assert "Lumina" not in html and "₹" not in html, "nothing about the account"
    r = _client("someone@gmail.com").get("/lumina/api/google-ads/insights")
    assert r.status_code == 403 and r.get_json()["ok"] is False


def test_a_renamed_account_keeps_its_old_address():
    c = _client()
    assert c.get("/lumina").status_code == 200
    STATE["doc"] = {"title": "Master", "tabs": [_tab("Lumina Smiles Dental", "URL name: lumina-dental")]}
    appmod._acct_listing(force=True)
    r = c.get("/lumina/google-ads?from=2026-09-01")
    assert r.status_code == 301 and r.headers["Location"].endswith("/lumina-dental/google-ads?from=2026-09-01")
    assert c.get("/lumina-dental").status_code == 200
    r = c.post("/lumina/api/google-ads/refresh")
    assert r.status_code == 308, "a POST keeps its method on the way"


# ── Google Ads and the AI review, for one account ────────────────────────────
def test_the_dashboard_for_an_account_holds_only_its_rows(monkeypatch):
    seen = {}
    monkeypatch.setattr(appmod, "_google_ads_insights", lambda rows=None, **kw: seen.update(kw) or gai.empty())
    html = _client().get("/lumina/google-ads").get_data(as_text=True)
    rows = _json_script(html, "gad-data")
    assert {r["account"] for r in rows} == {"Lumina Smiles Dental"} and len(rows) == 30
    assert "Search - 2BHK Secret" not in json.dumps(rows)
    assert seen["only"] == ("Lumina Smiles Dental",), "the insights are scoped to the account"
    assert 'data-api-base="/lumina/api/google-ads"' in html and 'data-all-label="Lumina Smiles Dental"' in html
    assert 'href="/lumina/google-ads/ai-review"' in html
    assert 'data-acct-picker data-acct-page="google-ads"' in html, "the title switches account"


def test_the_accounts_apis_answer_for_it_alone(monkeypatch):
    seen = {}
    monkeypatch.setattr(appmod, "_google_ads_insights", lambda rows=None, **kw: seen.update(kw, rows=rows) or
                        dict(gai.empty(), ok=True))
    c = _client()
    r = c.get("/lumina/api/google-ads/insights?from=2026-09-20&to=2026-09-26&account=Harbourline%20Realty")
    assert r.status_code == 200
    assert seen["only"] == ("Lumina Smiles Dental",) and {x["account"] for x in seen["rows"]} == {"Lumina Smiles Dental"}
    assert c.get("/lumina/api/google-ads/insights?from=1-9-2026").status_code == 400
    d = c.post("/lumina/api/google-ads/refresh").get_json()
    assert {x["account"] for x in d["rows"]} == {"Lumina Smiles Dental"}


def test_the_ai_review_opens_on_the_account():
    html = _client().get("/lumina/google-ads/ai-review").get_data(as_text=True)
    assert "data-acct-single" in html
    opts = re.findall(r'<option value="([^"]*)"', html)
    assert opts == ["Lumina Smiles Dental"], "no other account to pick on this page"
    assert 'href="/lumina/google-ads"' in html


def test_insights_scoped_to_an_account_leave_every_other_account_out():
    cell = json.dumps({"v": 1, "from": "2026-09-01", "d": [[0, 10, 1, 100, 1, 0]]})
    raw = {"devices": [["Account", "Campaign", "Device", "Date range", "Daily"],
                       ["A", "Brand", "MOBILE", "2026-09-01 to 2026-09-30", cell],
                       ["B", "Secret", "MOBILE", "2026-09-01 to 2026-09-30", cell]],
           "hours": [["Account", "Hour", "Date range", "Daily"], ["A", 9, "2026-09-01 to 2026-09-30", cell],
                     ["B", 9, "2026-09-01 to 2026-09-30", cell]],
           "about": [["Key", "Value"], ["Exported at", "2026-10-01"], ["Accounts", "12"],
                     ["Failed", "B: quota"]]}
    ins = gai.build(raw, only=("A",))
    assert {d["account"] for d in ins["devices"]} == {"A"} and {h["account"] for h in ins["hours"]} == {"A"}
    assert ins["about"] == [["Exported at", "2026-10-01"]], "nothing about the other accounts"
    assert gai.build(raw, only=("A",), account="B")["devices"] == [], "the page cannot ask its way out"
    assert len(gai.build(raw)["about"]) == 3, "the all-accounts dashboard is unchanged"


# ── The switch, everywhere ───────────────────────────────────────────────────
def test_the_top_bar_names_the_account_or_all_accounts():
    c = _client()
    html = c.get("/dashboards/google-ads").get_data(as_text=True)
    assert 'class="ap-pill" data-acct-picker data-acct-page="google-ads"' in html and ">All accounts<" in html
    assert "account-picker.js" in html and 'type="speculationrules"' in html
    html = c.get("/lumina/google-ads").get_data(as_text=True)
    assert 'data-acct-current="lumina"' in html and "Lumina Smiles Dental</span>" in html
    html = c.get("/strategic-agents").get_data(as_text=True)
    assert 'data-acct-picker data-acct-page=""' in html, "a page with no account version opens the account's home"


def test_the_hub_leads_with_the_switch_and_lists_every_account():
    html = _client().get("/hub").get_data(as_text=True)
    assert 'class="as-switch" data-acct-picker' in html and "All accounts" in html
    assert html.count('class="as-card"') == 3 and 'href="/lumina" data-acct-card="lumina"' in html
    assert [a["slug"] for a in _json_script(html, "acct-data")["accounts"]] == \
        ["harbourline-realty", "lumina", "bloom-skin-clinic"]


def test_the_scripts_build_text_never_markup():
    for name in ("account-picker.js", "account-space.js"):
        with open("static/js/" + name, encoding="utf-8") as fh:
            src = fh.read()
        assert "innerHTML" not in src and "insertAdjacentHTML" not in src, name
