"""Page Watch and Video Studio inside a client account (/<account>/page-watch, /<account>/video-studio).

The same tools, set up for the account: Page Watch shows the watches in the account's space (the whole
team's), files new ones there and offers its site and competitors from the master doc; Video Studio
fixes the client, fills in the website and takes the brand from the profile. Staff only; an invited
client is sent to the account's home. (Spaces themselves: tests/test_account_memory.py.)
"""

import json
import re

import pytest

import app as appmod
from tracker import client_accounts_store, video_store, watch_store, watch_web

STAFF = "reporting@markifydigital.com"
ADMIN = sorted(appmod.ADMIN_EMAILS)[0]


def _row(account, cid, day):
    return {"account": account, "customer_id": cid, "campaign": "Search", "state": "Enabled", "type": "Search",
            "day": day, "clicks": 10.0, "impressions": 100.0, "cost": 100.0, "currency": "INR", "conversions": 1.0,
            "view_through": 0.0, "top_pct": 0.0, "abs_top_pct": 0.0, "cost_native": 100.0, "currency_native": "INR"}


ROWS = [_row("Lumina Smiles Dental", "412-118-3390", "2026-09-%02d" % d) for d in range(1, 31)]


def _p(text):
    return {"paragraph": {"elements": [{"textRun": {"content": text + "\n"}}],
                          "paragraphStyle": {"namedStyleType": "NORMAL_TEXT"}}}


DOC = {"title": "Master", "tabs": [{"tabProperties": {"title": "Lumina Smiles Dental"}, "documentTab": {"body": {"content": [
    _p("URL name: lumina"), _p("Website: luminasmiles.in"), _p("Competitors: smilecare.in, clovedental.in, Sabka"),
    _p("Brand colours: #FFB800, #121A2E"), _p("Brand fonts: Poppins, Lora"), _p("Services: Implants"),
    _p("Tone of voice: Warm")]}}}]}


@pytest.fixture(autouse=True)
def world(monkeypatch):
    client_accounts_store.reset_memory()
    watch_store.reset_memory()
    video_store.reset_memory()
    appmod._acct_reset()
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: ROWS)
    monkeypatch.setattr(appmod, "_acct_doc", lambda: (DOC, "https://docs.google.com/document/d/x/edit", None))
    yield
    client_accounts_store.reset_memory()
    watch_store.reset_memory()
    video_store.reset_memory()
    appmod._acct_reset()


def _client(email=STAFF):
    c = appmod.app.test_client()
    with c.session_transaction() as sess:
        sess["google_user"] = {"email": email, "name": "T"}
    return c


def _space(slug="lumina"):
    return appmod._acct_listing()["by_slug"][slug]["space"]


def _data(html, sid):
    return json.loads(re.search(r'<script type="application/json" id="%s">(.*?)</script>' % sid, html, re.S).group(1))


def test_the_accounts_page_watch_shows_its_watches_and_offers_its_sites():
    mine = watch_web.create(STAFF, {"url": "https://smilecare.in/pricing", "client": "Lumina Smiles Dental"}, space=_space())
    other = watch_web.create(STAFF, {"url": "https://example.com", "client": "Someone Else"})
    html = _client().get("/lumina/page-watch").get_data(as_text=True)
    board = _data(html, "pw-data")
    assert [w["id"] for w in board["board"]["watches"]] == [mine], "only the watches filed under the account"
    assert board["board"]["watches"][0]["url_page"] == "/lumina/page-watch/watches/%d" % mine
    assert board["account"] == {"name": "Lumina Smiles Dental", "home": "/lumina/page-watch",
                                "api": "/lumina/api/page-watch/watches"}
    assert board["board"]["watches"][0]["by"] == "You"
    assert 'data-pw-url="https://luminasmiles.in"' in html and 'data-pw-url="https://clovedental.in"' in html
    assert 'data-pw-url="https://smilecare.in"' not in html, "a site already watched is not offered again"
    assert "example.com" not in html
    assert 'data-acct-current="lumina"' in html and 'data-acct-page="page-watch"' in html
    page = _client().get("/lumina/page-watch/watches/%d" % mine)
    assert page.status_code == 200 and 'data-home="/lumina/page-watch"' in page.get_data(as_text=True)
    r = _client().get("/lumina/page-watch/watches/%d" % other)
    assert r.status_code == 302 and r.headers["Location"].endswith("/strategic-agents/page-watch/watches/%d" % other)


def test_the_accounts_video_studio_is_set_up_for_it():
    html = _client().get("/lumina/video-studio").get_data(as_text=True)
    d = _data(html, "vs-data")
    assert d["account"]["name"] == "Lumina Smiles Dental" and d["account"]["website"] == "https://luminasmiles.in"
    assert d["account"]["brand"]["accent"] == "#ffb800" and d["account"]["brand"]["text"] == "#121a2e"
    assert d["account"]["brand"]["heading_font"] == "Poppins" and d["account"]["brand"]["body_font"] == "Lora"
    assert 'value="Lumina Smiles Dental" readonly' in html
    assert "A 20-second ad for Lumina Smiles Dental's implants, warm, ending" in html, "the example brief is theirs"
    pid = video_store.create_project(STAFF, client="Lumina Smiles Dental", brief="Implants ad", space=_space())
    other = video_store.create_project(STAFF, client="Someone Else", brief="x")
    assert _client().get("/lumina/video-studio/videos/%d" % pid).status_code == 200
    r = _client().get("/lumina/video-studio/videos/%d" % other)
    assert r.status_code == 302 and r.headers["Location"].endswith("/strategic-agents/video-studio/videos/%d" % other)


def test_a_brand_font_video_studio_does_not_have_is_left_to_it():
    from tracker import video_fonts
    acct = {"profile": {"colours": ["#ffffff"], "fonts": ["Not A Real Font", video_fonts.families()[0]]}}
    b = appmod._acct_video_brand(acct)
    assert b["accent"] == "#ffffff" and "text" not in b, "white cannot be the text colour on white"
    assert b["heading_font"] == video_fonts.families()[0]


def test_the_home_lists_the_tools_for_staff_only():
    watch_web.create(STAFF, {"url": "https://smilecare.in/pricing", "client": "lumina smiles dental"}, space=_space())
    video_store.create_project(STAFF, client="Lumina Smiles Dental", brief="x", space=_space())
    html = _client().get("/lumina").get_data(as_text=True)
    assert 'href="/lumina/page-watch"' in html and "1 page watched for Lumina Smiles Dental" in html
    assert 'href="/lumina/video-studio"' in html and "1 video for Lumina Smiles Dental" in html
    _post = lambda u, b: _client(ADMIN).post(u, json=b, headers={"X-Requested-With": "fetch"})
    assert _post("/lumina/api/access", {"who": "ana@lumina.in"}).status_code == 200
    client = _client("ana@lumina.in")
    html = client.get("/lumina").get_data(as_text=True)
    assert "/page-watch" not in html and "/video-studio" not in html
    for path in ("/lumina/page-watch", "/lumina/video-studio"):
        r = client.get(path)
        assert r.status_code == 302 and r.headers["Location"].endswith("/lumina"), path


def test_the_picker_knows_the_new_pages():
    d = _client().get("/api/accounts").get_json()
    assert [p["page"] for p in d["accounts"][0]["pages"]] == ["", "google-ads", "google-ads/ai-review", "page-watch",
                                                             "video-studio"]
    assert d["global"]["page-watch"] == "/strategic-agents/page-watch"
    html = _client().get("/strategic-agents/video-studio").get_data(as_text=True)
    assert 'data-acct-page="video-studio"' in html, "from the global page, the picker opens the account's"
