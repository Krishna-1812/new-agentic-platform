"""Sharing an account with its client, tool by tool (tracker/client_access.py, app.py's Share routes).

An admin picks, in the account's Share panel, which of its agents and tools the client may use, and how
many runs a month they may start. The client's home and History then show only those tools. A client
stays inside their account: every other page of ours sends them back to it. Every share, and everything
the client does, lands on the account's card in the admins' Client Usage tab.
"""

import pytest

import app as appmod
from tests import test_account_isolation as T
from tracker import client_access, client_accounts_store

KRIS = "kris@markifydigital.com"       # an admin
FETCH = {"X-Requested-With": "fetch"}

seeded = T.seeded
world = T.world


def _api(c, path, body):
    return c.post("/lumina/api/access" + path, json=body, headers=FETCH)


# ── The Share panel ──────────────────────────────────────────────────────────
def test_the_panel_lists_every_tool_grouped_and_off_until_turned_on():
    d = T._client(KRIS).get("/lumina/api/access", headers=FETCH).get_json()
    assert d["ok"] and [g["key"] for g in d["groups"]] == ["watch", "agents", "seo"]
    slugs = [t["slug"] for t in d["tools"]]
    assert slugs[:2] == ["page-watch", "video-studio"]
    assert {a[0] for a in appmod.ACCT_AGENTS} <= set(slugs) and {s for s, _ in appmod.ACCT_SEO} <= set(slugs)
    assert not any(t["on"] for t in d["tools"]), "nothing is the client's until an admin turns it on"
    assert d["limit"] == client_access.RUN_LIMIT_DEFAULT and d["used"] == 0
    assert all(t["colour"].startswith("#") for t in d["tools"])


def test_an_admin_turns_tools_on_one_or_a_group_at_a_time():
    c = T._client(KRIS)
    d = _api(c, "/share", {"share": "tool:page-watch", "on": True}).get_json()
    assert [t["slug"] for t in d["tools"] if t["on"]] == ["page-watch"]
    agents = {"tool:" + a[0]: True for a in appmod.ACCT_AGENTS}
    d = _api(c, "/share", {"shares": agents}).get_json()
    assert {t["slug"] for t in d["tools"] if t["on"]} == {"page-watch"} | {a[0] for a in appmod.ACCT_AGENTS}
    changes = [a for a in d["audit"] if a["action"] == "shared"]
    assert len(changes) == 1 + len(appmod.ACCT_AGENTS), "one entry per tool that changed"
    assert _api(c, "/share", {"shares": agents}).get_json()["ok"]
    assert len([a for a in client_accounts_store.audit(T._acct("lumina")["key"], 100) if a["action"] == "shared"]) == \
        1 + len(appmod.ACCT_AGENTS), "turning on what is on already changes nothing"
    assert _api(c, "/share", {"share": "tool:rm -rf", "on": True}).status_code == 400
    assert _api(c, "/share", {"shares": {"tool:page-watch": False, "history": True}}).status_code == 400


def test_the_run_limit_is_set_by_admins_within_bounds():
    c = T._client(KRIS)
    assert _api(c, "/limit", {"limit": 50}).get_json()["limit"] == 50
    assert _api(c, "/limit", {"limit": -1}).status_code == 400
    assert _api(c, "/limit", {"limit": 501}).status_code == 400
    assert _api(c, "/limit", {"limit": "lots"}).status_code == 400
    assert _api(c, "/limit", {"limit": 0}).get_json()["limit"] == 0
    assert _api(T._client(T.RAJ), "/limit", {"limit": 99}).status_code == 403, "staff who are not admins see, not change"
    assert _api(T._client(T.CLIENT), "/limit", {"limit": 99}).status_code == 403


def test_the_dialog_has_the_tools_section_and_their_icons():
    html = T._client(KRIS).get("/lumina").get_data(as_text=True)
    assert 'id="sh-tools"' in html and 'id="sh-limit"' in html and 'id="sh-icons"' in html
    for slug in ("page-watch", "video-studio", "local-business-radar", "keyword-research"):
        assert 'data-icon="%s"' % slug in html
    js = open("static/js/account-share.js", encoding="utf-8").read()
    assert "innerHTML" not in js and "/limit" in js and "shares: body" in js


# ── What the client sees ─────────────────────────────────────────────────────
def test_a_client_is_kept_inside_their_account(seeded):
    T._invite("lumina")
    c = T._client(T.CLIENT)
    for path in ("/", "/hub", "/app", "/app/keyword-wizard", "/dashboards/google-ads", "/strategic-agents/local-business-radar",
                 "/seo-aeo/keyword-research", "/admin/client-usage", "/page-watch", "/video-studio"):
        r = c.get(path)
        assert r.status_code == 302 and r.headers["Location"].endswith("/lumina"), (path, r.status_code, r.headers.get("Location"))
    assert c.get("/bloom").status_code == 403, "another account is still refused"
    assert T._client(T.RAJ).get("/hub").status_code == 200, "staff are not fenced"
    outsider = T._client("someone@gmail.com")
    assert outsider.get("/hub").headers["Location"].endswith("/app"), "a Google user with no invite: as before"


def test_a_client_with_two_accounts_lands_on_the_first_and_can_open_both(seeded):
    T._invite("lumina")
    T._invite("bloom")
    c = T._client(T.CLIENT)
    first = c.get("/hub").headers["Location"]
    assert first.endswith("/lumina") or first.endswith("/bloom")
    assert c.get("/lumina").status_code == 200 and c.get("/bloom").status_code == 200


def test_each_page_a_client_opens_is_recorded_and_staff_are_not(seeded):
    T._invite("lumina", **{"tool:page-watch": True})
    T._client(T.CLIENT).get("/lumina")
    T._client(T.RAJ).get("/lumina")
    ev = client_accounts_store.events(T._acct("lumina")["key"])
    assert [(e["email"], e["kind"], e["path"]) for e in ev] == [(T.CLIENT, "visit", "/lumina")]


# ── Client Usage ─────────────────────────────────────────────────────────────
def test_sharing_an_account_gives_it_a_card_in_client_usage(seeded):
    admin = T._client(KRIS)
    html = admin.get("/admin/client-usage").get_data(as_text=True)
    assert "Shared client accounts" in html and 'href="/admin/client-usage/accounts/lumina"' not in html
    _api(admin, "", {"who": T.CLIENT})
    _api(admin, "/share", {"shares": {"tool:page-watch": True, "tool:local-business-radar": True}})
    T._client(T.CLIENT).get("/lumina")
    html = admin.get("/admin/client-usage").get_data(as_text=True)
    card = html[html.index('href="/admin/client-usage/accounts/lumina"'):]
    card = card[:card.index("</a>")]
    assert "Lumina Smiles Dental" in card and "Shared with 1 person" in card
    assert "Page Watch" in card and "Local Business Radar" in card and "Social Media Intelligence" not in card
    assert "shared Local Business Radar" in card or "shared Page Watch" in card
    assert 'href="/admin/client-usage/accounts/bloom"' not in html, "an account nobody shared has no card"


def test_the_accounts_usage_page_shows_people_tools_visits_and_changes(seeded):
    admin = T._client(KRIS)
    _api(admin, "", {"who": T.CLIENT})
    _api(admin, "/share", {"share": "tool:page-watch", "on": True})
    _api(admin, "/limit", {"limit": 40})
    T._client(T.CLIENT).get("/lumina")
    html = admin.get("/admin/client-usage/accounts/lumina").get_data(as_text=True)
    assert T.CLIENT in html and "1 visit" in html and "opened the home page" in html
    assert "Page Watch" in html and "set the runs a month to 40" in html and "invited " + T.CLIENT in html
    assert "0 of 40 runs used this month" in html
    assert admin.get("/admin/client-usage/accounts/no-such").status_code == 404
    assert T._client(T.RAJ).get("/admin/client-usage/accounts/lumina").status_code in (302, 403), "admins only"


# ── The rules, alone ─────────────────────────────────────────────────────────
def test_shares_default_off_and_ignore_what_they_do_not_know():
    s = client_access.shared({"tool:page-watch": True, "history": True, "tool:x": "yes"}, ["page-watch", "x"])
    assert s["tool:page-watch"] is True and s["tool:x"] is False and "history" not in s
    assert client_access.tools_on(s) == ["page-watch"]
    assert client_access.run_limit({}) == client_access.RUN_LIMIT_DEFAULT
    assert client_access.run_limit({"runs_per_month": "9000"}) == client_access.RUN_LIMIT_MAX
    assert client_access.run_limit({"runs_per_month": "x"}) == client_access.RUN_LIMIT_DEFAULT


@pytest.mark.parametrize("action, detail, text", [
    ("shared", "tool:page-watch", "Kris Ladha shared Page Watch"),
    ("unshared", "ai-review", "Kris Ladha stopped sharing AI review"),
    ("invited", "ana@lumina.in", "Kris Ladha invited ana@lumina.in"),
    ("set", "runs_per_month=30", "Kris Ladha set the runs a month to 30"),
])
def test_each_change_reads_as_a_sentence(action, detail, text):
    names = {KRIS: "Kris Ladha"}
    assert appmod._cu_change_text({"actor": KRIS, "action": action, "detail": detail}, names,
                                  {"page-watch": "Page Watch"}) == text
