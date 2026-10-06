"""Client accounts: the profile in the master doc, the list, and the URL names.

The list is the Google Ads campaign report's accounts plus the master doc's tabs
(tracker/client_accounts.py); each account's profile is the block of facts at the
top of its tab (tracker/client_profile.py); its URL name is kept for good
(tracker/client_accounts_store.py), so a shared link never breaks and never
moves to another client.
"""

import pytest

from tracker import client_accounts as ca
from tracker import client_accounts_store as store
from tracker import client_profile as cp


def _p(text, style="NORMAL_TEXT"):
    return {"paragraph": {"elements": [{"textRun": {"content": text + "\n"}}],
                          "paragraphStyle": {"namedStyleType": style}}}


def _table(rows):
    return {"table": {"tableRows": [{"tableCells": [{"content": [_p(c)]} for c in r]} for r in rows]}}


def tab(title, *content):
    return {"tabProperties": {"title": title}, "documentTab": {"body": {"content": [
        c if isinstance(c, dict) else _p(c) for c in content]}}}


ADS = [("Lumina Smiles Dental", "412-118-3390"), ("Core Care Physio", "533-901-2234"),
       ("AA_New", "610-224-8812"), ("Lumina US", "720-554-1209")]


# ── The profile ──────────────────────────────────────────────────────────────
PROFILE = """# Profile
Display name: Lumina Smiles
URL name: Lumina
Google Ads ID: 412-118-3390, 720 554 1209
Website: www.luminasmiles.in/
Industry: Dental clinic
Locations: Pune, Mumbai; Nashik
Competitors: smilecare.in, Dr. Shah's Dental, Bright Teeth (brightteeth.co.in)
Brand colours: #0B5FFF, #FB0
Instagram: @luminasmiles
Social: facebook.com/lumina, linkedin.com/company/lumina
**Goals / KPIs**: CPA under ₹600, 120 leads/month
Services:
- Implants
- Invisalign
# Notes
2026-09-12 Website: www.newsite.in
Industry: something else
"""


def test_the_profile_reads_every_kind_of_fact():
    p = cp.parse(PROFILE)
    assert p["display_name"] == "Lumina Smiles" and p["url_name"] == "Lumina"
    assert p["google_ads_ids"] == ["4121183390", "7205541209"]
    assert p["website"] == "https://www.luminasmiles.in" and p["domain"] == "luminasmiles.in"
    assert p["industry"] == "Dental clinic" and p["locations"] == ["Pune", "Mumbai", "Nashik"]
    assert [c["name"] for c in p["competitors"]] == ["smilecare.in", "Dr. Shah's Dental", "Bright Teeth"]
    assert p["competitors"][2]["domain"] == "brightteeth.co.in" and p["competitors"][1]["website"] == ""
    assert p["colours"] == ["#0b5fff", "#ffbb00"]
    assert p["social"] == {"instagram": "https://www.instagram.com/luminasmiles",
                           "facebook": "https://facebook.com/lumina", "linkedin": "https://linkedin.com/company/lumina"}
    assert p["goals"] == "CPA under ₹600, 120 leads/month", "bold field names are still field names"
    assert p["services"] == ["Implants", "Invisalign"], "a field's items may be bullets under it"
    assert cp.identifies(p)


def test_the_profile_stops_where_the_notes_start_and_the_first_fact_wins():
    p = cp.parse(PROFILE)
    assert p["website"] == "https://www.luminasmiles.in", "a dated note further down never overwrites it"
    assert p["industry"] == "Dental clinic"
    p = cp.parse("Website: a.com\nWebsite: b.com")
    assert p["domain"] == "a.com"


def test_a_two_column_table_is_a_profile_too():
    p = cp.parse("Website | https://x.co.in/en\nIndustry | Retail\nFact | Value")
    assert p["website"] == "https://x.co.in/en" and p["industry"] == "Retail" and p["fields"] == 2


def test_notes_alone_are_not_an_account_and_nothing_unsafe_becomes_a_link():
    p = cp.parse("Met the client on Tuesday.\nThey want more leads.")
    assert p["fields"] == 0 and not cp.identifies(p)
    p = cp.parse("Website: javascript:alert(1)\nLogo: data:image/png;base64,xx\nInstagram: javascript:alert(1)")
    assert "website" not in p and "logo" not in p
    assert not p.get("social", {}).get("instagram", "").startswith("javascript"), p
    assert cp.parse("Status: Hidden")["hidden"] is True and cp.parse("Status: active")["hidden"] is False


def test_the_template_is_prefilled_with_what_is_known():
    t = cp.template("Core Care", "core-care", ["5339012234"], {"website": "https://corecare.in"})
    assert t.startswith("PROFILE\nDisplay name: Core Care\nURL name: core-care\nGoogle Ads ID: 533-901-2234\n")
    assert "Website: https://corecare.in" in t and "NOTES (newest last)" in t
    assert cp.parse(t)["google_ads_ids"] == ["5339012234"], "the template reads back as a profile"


# ── Names ────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("name, slug", [
    ("Lumina Smiles Dental", "lumina-smiles-dental"), ("AA_New", "aa-new"), ("Dr. Shah's & Sons", "dr-shahs-and-sons"),
    ("Ünïcode Café", "unicode-cafe"), ("  --  ", ""), ("Hare Krishna Movement Charitable Foundation Hyderabad",
                                                       "hare-krishna-movement-charitable-foundation"),
])
def test_names_become_url_names(name, slug):
    assert ca.slugify(name) == slug
    assert not slug or ca.SLUG_RE.match(slug)


def test_an_account_keeps_its_colour_and_its_own_brand_colour_wins():
    a = ca.avatar("Lumina Smiles Dental")
    assert a == ca.avatar("Lumina Smiles Dental") and a["initials"] == "LS"
    own = ca.avatar("Lumina", ["#0b5fff"])
    assert own["bg"] == "#0b5fff" and own["fg"] == "#F6F4F0", "light text on a dark brand colour"
    assert ca.avatar("X", ["#ffbb00"])["fg"] == "#121213"
    assert ca.initials("The Bombay Canteen") == "BC"


# ── The list ─────────────────────────────────────────────────────────────────
DOC = {"title": "Master", "tabs": [
    tab("General", "Report every Monday."),
    tab("Sample - Lumina Smiles Dental", "Website: example.com"),
    tab("Lumina Smiles Dental", "Display name: Lumina Smiles", "URL name: lumina", "Website: luminasmiles.in",
        "Google Ads ID: 720-554-1209"),
    tab("Core Care Physio", "Industry: Physiotherapy"),
    tab("Core Care Physio – old notes", "Website: old.example"),
    tab("Bloom Skin Clinic", _table([["Website", "bloomskin.in"], ["Industry", "Dermatology"]])),
    tab("Meeting notes", "Nothing that names a client."),
]}


def test_the_list_joins_google_ads_and_the_master_doc():
    accts = ca.build(ADS, DOC)
    by = {a["name"]: a for a in accts}
    assert list(by) == ["Lumina Smiles", "Core Care Physio", "AA_New", "Bloom Skin Clinic"], \
        "by spend, then accounts with no Google Ads; General, Sample and notes-only tabs are not accounts"
    lum = by["Lumina Smiles"]
    assert lum["ads_names"] == ["Lumina Smiles Dental", "Lumina US"], "the profile's IDs join a second Google Ads account"
    assert lum["key"] == "cid:4121183390" and lum["url_name"] == "lumina" and lum["tab"] == "Lumina Smiles Dental"
    assert lum["profile"]["domain"] == "luminasmiles.in"
    core = by["Core Care Physio"]
    assert core["tab"] == "Core Care Physio" and core["profile"]["industry"] == "Physiotherapy"
    assert "website" not in core["profile"], "a second tab about an account another tab holds is ignored"
    assert core["key"] == "cid:5339012234"
    bloom = by["Bloom Skin Clinic"]
    assert bloom["ads_names"] == [] and bloom["key"] == "doc:bloom skin clinic"
    assert bloom["profile"]["industry"] == "Dermatology"


def test_without_a_doc_every_google_ads_account_is_listed():
    accts = ca.build(ADS, None)
    assert [a["name"] for a in accts] == [a for a, _ in ADS]
    assert all(a["profile"]["fields"] == 0 for a in accts)


def test_a_doc_written_with_headings_still_gives_each_account_its_profile():
    doc = {"title": "Old", "body": {"content": [
        _p("Core Care Physio", "HEADING_1"), _p("Website: corecare.in"), _p("Industry: Physiotherapy"),
        _p("AA_New", "HEADING_1"), _p("Website: aanew.com")]}}
    by = {a["name"]: a for a in ca.build(ADS, doc)}
    assert by["Core Care Physio"]["profile"]["industry"] == "Physiotherapy"
    assert by["AA_New"]["profile"]["domain"] == "aanew.com"


# ── URL names that never break ──────────────────────────────────────────────
def _acct(key, name, url_name="", alt=()):
    return {"key": key, "name": name, "url_name": url_name, "alt_keys": list(alt)}


def test_slugs_are_stable_and_a_rename_keeps_the_old_link():
    rows, retired, _ = ca.plan_slugs([_acct("cid:1", "Lumina Smiles Dental")], {}, {}, set())
    assert rows == {"cid:1": "lumina-smiles-dental"} and retired == {}
    rows, retired, _ = ca.plan_slugs([_acct("cid:1", "Lumina Smiles Dental", "lumina")], rows, retired, set())
    assert rows == {"cid:1": "lumina"} and retired == {"lumina-smiles-dental": "cid:1"}
    rows2, retired2, _ = ca.plan_slugs([_acct("cid:1", "Lumina Smiles Dental", "lumina")], rows, retired, set())
    assert (rows2, retired2) == (rows, retired), "nothing changes when nothing changed"
    rows, retired, _ = ca.plan_slugs([_acct("cid:1", "Lumina Smiles Dental")], rows, retired, set())
    assert rows == {"cid:1": "lumina-smiles-dental"} and retired == {"lumina": "cid:1"}, \
        "going back reclaims the old slug; the other one now redirects"


def test_a_slug_is_never_handed_to_another_client():
    rows, retired, _ = ca.plan_slugs([_acct("cid:1", "Acme", "acme-old")], {}, {}, set())
    rows, retired, _ = ca.plan_slugs([_acct("cid:1", "Acme")], rows, retired, set())
    assert retired == {"acme-old": "cid:1"}
    rows, retired, _ = ca.plan_slugs([_acct("cid:1", "Acme"), _acct("cid:2", "Acme Old")], rows, retired, set())
    assert rows["cid:2"] == "acme-old-2", "another client's old link stays theirs"
    rows, retired, _ = ca.plan_slugs([_acct("cid:2", "Acme Old"), _acct("cid:3", "Acme")], rows, retired, set())
    assert rows["cid:3"] == "acme-2", "a gone client's slug is never reused either"
    rows, retired, _ = ca.plan_slugs([_acct("cid:2", "Acme Old", "acme")], rows, retired, set())
    assert rows["cid:2"] == "acme-old-2", "asking for a slug someone else had keeps what you have"


def test_reserved_paths_and_route_names_are_never_slugs():
    rows, _, _ = ca.plan_slugs([_acct("cid:1", "Hub"), _acct("cid:2", "Admin", "api")], {}, {}, {"hub", "api"} | ca.RESERVED_WORDS)
    assert rows == {"cid:1": "hub-account", "cid:2": "api-account"}


def test_an_account_that_gains_google_ads_keeps_its_link():
    doc_only = _acct("doc:bloom skin clinic", "Bloom Skin Clinic")
    rows, retired, _ = ca.plan_slugs([doc_only], {}, {}, set())
    gained = _acct("cid:9", "Bloom Skin Clinic", alt=["doc:bloom skin clinic"])
    rows, retired, rekeys = ca.plan_slugs([gained], rows, retired, set())
    assert rows == {"cid:9": "bloom-skin-clinic"} and rekeys == [("doc:bloom skin clinic", "cid:9")]


def test_the_memory_store_keeps_slugs_between_lists():
    store.reset_memory()
    try:
        out = store.sync([_acct("cid:1", "Lumina")], set())
        assert out["rows"] == {"cid:1": "lumina"}
        out = store.sync([_acct("cid:1", "Lumina", "lum")], set())
        assert out == {"rows": {"cid:1": "lum"}, "retired": {"lumina": "cid:1"}}
        assert store.load() == out
    finally:
        store.reset_memory()


# ── Numbers ──────────────────────────────────────────────────────────────────
def _rows():
    out = []
    for d in range(1, 31):
        day = "2026-09-%02d" % d
        out.append({"account": "A", "campaign": "Search - X", "type": "Search", "state": "Enabled", "day": day,
                    "cost": 100.0, "conversions": 2 if d > 23 else 1, "clicks": 10, "impressions": 100,
                    "currency": "INR"})
        out.append({"account": "B", "campaign": "Other", "type": "Search", "state": "Enabled", "day": day,
                    "cost": 999.0, "conversions": 0, "clicks": 1, "impressions": 5, "currency": "INR"})
    return out


def test_stats_are_the_accounts_own_last_30_days():
    st = ca.stats(_rows(), ["A"])
    assert st["cost"] == 3000 and st["conv"] == 37 and st["clicks"] == 300 and len(st["daily"]) == 30
    assert st["from"] == "2026-09-01" and st["to"] == "2026-09-30"
    assert st["delta"]["cost"] == 0 and st["delta"]["conv"] == 100.0, "last 7 days against the 7 before"
    assert [c["name"] for c in st["campaigns"]] == ["Search - X"], "another account's campaigns are not in it"
    assert st["daily"][-1]["cpa7"] == 50.0 and ca.stats(_rows(), ["Z"]) is None


def test_money_is_written_the_way_each_currency_groups_it():
    assert ca.money(312489.4, "INR") == "₹3,12,489" and ca.money(12480, "USD") == "$12,480"
    assert ca.money(999, "INR") == "₹999" and ca.money(-1500, "INR") == "-₹1,500"
    assert ca.delta_text(None) == "" and ca.delta_text(12.4) == "▲ 12% on the week before"
    assert ca.delta_text(0.2) == "Flat on the week before" and ca.nice_day("2026-10-05") == "5 Oct 2026"


def test_the_ai_review_finds_a_tab_by_the_google_ads_id_in_its_profile_too():
    from tracker import gads_ai_doc
    doc = {"title": "Master", "tabs": [tab("Aster Aesthetics", "Google Ads ID: 610-224-8812", "Website: aster.in",
                                           "NOTES", "Target CPA ₹700.")]}
    ctx = gads_ai_doc.context_for(doc, "AA_New", [a for a, _ in ADS], dict(ADS))
    assert ctx["found"] and "Target CPA ₹700." in ctx["text"] and ctx["where"] == ["tab “Aster Aesthetics”"]
    acct = ca.build(ADS, doc)[2]
    assert acct["ads_names"] == ["AA_New"] and acct["profile"]["domain"] == "aster.in"
    assert acct["name"] == "Aster Aesthetics", "the tab's title names the client when it is not the Google Ads name"
    hk = ca.build([("Hare Krishna Movement Charitable Foundation Hyderabad", "1")],
                  {"title": "M", "tabs": [tab("Hare Krishna", "Website: hk.org")]})[0]
    assert hk["name"] == "Hare Krishna Movement Charitable Foundation Hyderabad", "a shortened title is not a new name"
