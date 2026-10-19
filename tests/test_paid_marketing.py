"""Paid Marketing Agents: the Pacing Desk's seed and moves.

What is pinned here is what the port changed or must not lose: the seed push is refused without its secret and
checked before anything is stored; the rollup is computed here, not trusted; a move is checked before it is
ticked off, and only from this site as JSON. (The source kept the Search Query Analysis and Client Feedback
tests here too; they come with those agents.)
"""
import json
import os
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import app as appmod  # noqa: E402
from tracker import paid_pacing as pp  # noqa: E402
from tracker import paid_store as store  # noqa: E402

ADMIN = "kris@markifydigital.com"          # in ADMIN_EMAILS
STAFF = "someone@markifydigital.com"

def account(name, landing="ON TARGET", allocated=1000.0, spend=500.0, projected=1000.0, conv=10.0,
            moves=0, capped=False, ambiguous=False):
    return {"name": name, "landing": landing, "allocated": allocated, "spend": spend,
            "projected": projected, "conv": conv, "capped": capped, "ambiguous": ambiguous,
            "moves": [{"from": "A", "to": "B", "amt": 10, "why": "x"}] * moves, "campaigns": []}


def dashboard(**over):
    d = {"asOf": "2026-10-12", "dataThrough": "2026-10-11", "month": "October 2026", "elapsed": 11,
         "daysInMonth": 31, "idealPacing": 0.3548, "tolerance": 2.0,
         "portfolioWarnings": ["Example Co — $84,624 MTD with no budget row"],
         "clients": [
             {"name": "Acme Dental Group", "accounts": [
                 account("Arlington", "WILL OVERSPEND", 1000, 600, 1300, 5, moves=2),
                 account("Burke", "WILL UNDERSPEND", 2000, 300, 1500, 7, capped=True)]},
             {"name": "Springfield Imaging", "accounts": [account("Riverside", "BUDGET UNCLEAR", 999, 999, 999, 3, ambiguous=True)]},
         ]}
    d.update(over)
    return d


# ── Pacing: the seed ───────────────────────────────────────────────────────

def test_rollup_counts_money_only_for_accounts_whose_budget_is_clear():
    meta, rows, latest = pp.build_seed(dashboard())
    assert latest == "2026-10-12"
    assert [s for s, _ in rows] == ["acme-dental-group", "springfield-imaging"]
    assert meta["tAll"] == 3000 and meta["tSp"] == 900 and meta["tPr"] == 2800
    assert meta["tCv"] == 15            # conversions count every account
    assert meta["tMv"] == 2
    assert meta["atRisk"] == 500         # Burke: 2000 allocated, projects 1500
    assert (meta["overCount"], meta["underCount"], meta["okCount"], meta["ambiguousCount"]) == (1, 1, 0, 1)


def test_seed_live_js_shape_is_accepted_and_its_own_rollup_is_ignored():
    d = dashboard()
    body = {"meta": dict({k: d[k] for k in pp.META_KEYS}, tAll=1, tSp=99999999),
            "clients": [{"id": pp.slug(c["name"]), "data": c} for c in d["clients"]],
            "latest": {"date": "2026-10-12"}}
    meta, rows, _ = pp.build_seed(body)
    assert meta["tAll"] == 3000 and meta["tSp"] == 900
    assert rows[0][1]["name"] == "Acme Dental Group"


def test_em_dashes_never_reach_the_page():
    meta, _rows, _ = pp.build_seed(dashboard())
    assert meta["portfolioWarnings"] == ["Example Co, $84,624 MTD with no budget row"]


@pytest.mark.parametrize("mutate, says", [
    (lambda d: d.update(clients=[]), "no clients"),
    (lambda d: d.update(asOf="12/10/2026"), "asOf"),
    (lambda d: d["clients"][0]["accounts"][0].update(landing="SOMEWHERE"), "landing"),
    (lambda d: d["clients"][0]["accounts"][0].update(spend="500"), "spend"),
    (lambda d: d["clients"][0]["accounts"][0].update(moves=None), "moves"),
    (lambda d: d["clients"].append({"name": "Springfield Imaging", "accounts": []}), "share the id"),
    (lambda d: d.update(elapsed=True), "elapsed"),
])
def test_a_bad_push_is_refused_with_the_reason(mutate, says):
    d = dashboard()
    mutate(d)
    with pytest.raises(pp.BadPayload, match=says):
        pp.build_seed(d)


def test_move_ids_and_bodies_are_checked():
    good = {"date": "2026-10-12", "loc": "Arlington", "from": "Brand", "to": "PMax", "amt": 12.5, "applied": True}
    mid = "2026-10-12__arlington__brand__1a2b3c4d"
    assert pp.check_move(mid, good)["from_campaign"] == "Brand"
    for bad_id in ("x", "2026-10-12__a__b__xyz", "../../etc"):
        with pytest.raises(pp.BadPayload):
            pp.check_move(bad_id, good)
    for patch in ({"date": "2026-10-11"}, {"applied": "yes"}, {"amt": "12"}, {"from": ""}):
        with pytest.raises(pp.BadPayload):
            pp.check_move(mid, dict(good, **patch))


def test_the_page_and_the_server_build_the_same_move_id_shape():
    js = open(os.path.join(ROOT, "static", "js", "pacing_desk.js")).read()
    assert 'date+"__"+slug(loc).slice(0,24)+"__"+slug(from).slice(0,24)+"__"+hashStr(' in js
    assert pp.MOVE_ID_RE.pattern.count("{0,24}") == 2


def client_as(email):
    c = appmod.app.test_client()
    if email:
        with c.session_transaction() as sess:
            sess["google_user"] = {"email": email, "name": "T"}
    return c


SAME = {"Origin": "http://localhost"}


def test_seed_is_refused_without_the_secret(monkeypatch):
    stored = []
    monkeypatch.setattr(store, "save_snapshot", lambda *a: stored.append(a))
    c = client_as(None)
    url = "/strategic-agents/paid-marketing/api/pacing/seed"
    monkeypatch.delenv("PACING_SEED_SECRET", raising=False)
    monkeypatch.delenv("SEED_SECRET", raising=False)
    assert c.post(url, json=dashboard(), headers={"X-Seed-Secret": ""}).status_code == 403
    monkeypatch.setenv("PACING_SEED_SECRET", "s3cret")
    assert c.post(url, json=dashboard(), headers={"X-Seed-Secret": "nope"}).status_code == 403
    assert c.post(url, json=dashboard(clients=[]), headers={"X-Seed-Secret": "s3cret"}).status_code == 400
    assert not stored
    r = c.post(url, json=dashboard(), headers={"X-Seed-Secret": "s3cret"})
    assert r.status_code == 200 and r.get_json()["accounts"] == 3
    assert stored[0][0]["asOf"] == "2026-10-12" and stored[0][2] == "2026-10-12"


def test_seed_accepts_the_older_secret_name(monkeypatch):
    monkeypatch.setattr(store, "save_snapshot", lambda *a: None)
    monkeypatch.delenv("PACING_SEED_SECRET", raising=False)
    monkeypatch.setenv("SEED_SECRET", "0lder")
    c = client_as(None)
    url = "/strategic-agents/paid-marketing/api/pacing/seed"
    assert c.post(url, json=dashboard(), headers={"X-Seed-Secret": "nope"}).status_code == 403
    assert c.post(url, json=dashboard(), headers={"X-Seed-Secret": "0lder"}).status_code == 200


def test_state_changes_must_come_from_this_site_as_json(monkeypatch):
    monkeypatch.setattr(store, "set_move", lambda mid, **f: {"id": mid, **f})
    c = client_as(STAFF)
    url = "/strategic-agents/paid-marketing/api/pacing/moves/2026-10-12__a__b__1f"
    body = {"date": "2026-10-12", "loc": "A", "from": "B", "to": "C", "amt": 5, "applied": True}
    assert c.put(url, json=body, headers={"Origin": "https://evil.example"}).status_code == 403
    assert c.put(url, data="x", headers=SAME).status_code == 415
    r = c.put(url, json=body, headers=SAME)
    assert r.status_code == 200 and r.get_json()["move"]["by"] == STAFF


def test_the_desk_renders_for_staff_and_not_for_anyone_else():
    path = "/operational-agents/pacing-desk"
    assert client_as(STAFF).get(path).status_code == 200
    assert client_as(None).get(path).status_code == 302
    assert client_as("someone@gmail.com").get(path).status_code == 302
