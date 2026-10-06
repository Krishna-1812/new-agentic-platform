"""The SEO & AEO tools and the agents, opened for one client account.

/<account>/seo-aeo/<tool> embeds the SEO Studio tool with the account's website, keyword or service
in its address (?pf_*, read by seo-apps/client/src/lib/prefill.js); /<account>/agents/<agent> renders
the agent's own page with its fields filled in from the profile (static/js/account-prefill.js). The
account's home lists every one with what it will be given. Staff only.
"""

import json
import os
import re
from urllib.parse import parse_qs, urlsplit

import pytest

import app as appmod
from tracker import client_accounts_store

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAFF = "reporting@markifydigital.com"
ADMIN = sorted(appmod.ADMIN_EMAILS)[0]


def _row(day):
    return {"account": "Lumina Smiles Dental", "customer_id": "412-118-3390", "campaign": "Search", "state": "Enabled",
            "type": "Search", "day": day, "clicks": 10.0, "impressions": 100.0, "cost": 100.0, "currency": "INR",
            "conversions": 1.0, "view_through": 0.0, "top_pct": 0.0, "abs_top_pct": 0.0, "cost_native": 100.0,
            "currency_native": "INR"}


def _p(text):
    return {"paragraph": {"elements": [{"textRun": {"content": text + "\n"}}],
                          "paragraphStyle": {"namedStyleType": "NORMAL_TEXT"}}}


PROFILE = ["URL name: lumina", "Website: luminasmiles.in", "Industry: Dental clinic", "Locations: Pune, Mumbai",
           "Services: Dental implants, Invisalign"]
STATE = {"lines": PROFILE}


@pytest.fixture(autouse=True)
def world(monkeypatch):
    client_accounts_store.reset_memory()
    appmod._acct_reset()
    STATE["lines"] = PROFILE
    monkeypatch.setattr(appmod, "_fetch_google_ads_rows", lambda force=False: [_row("2026-09-%02d" % d) for d in range(1, 31)])
    monkeypatch.setattr(appmod, "_acct_doc", lambda: ({"title": "M", "tabs": [{"tabProperties": {"title": "Lumina Smiles Dental"},
                                                                             "documentTab": {"body": {"content": [_p(x) for x in STATE["lines"]]}}}]},
                                                      "https://docs.google.com/document/d/x/edit", None))
    yield
    client_accounts_store.reset_memory()
    appmod._acct_reset()


def _client(email=STAFF):
    c = appmod.app.test_client()
    with c.session_transaction() as sess:
        sess["google_user"] = {"email": email, "name": "T"}
    return c


def _embed(html):
    src = re.search(r'id="embed-frame"[^>]*src="([^"]+)"|src="([^"]+)"[^>]*id="embed-frame"', html)
    url = (src.group(1) or src.group(2)).replace("&amp;", "&")
    return parse_qs(urlsplit(url).query)


@pytest.mark.parametrize("tool, key, value", [
    ("seo-geo-audit", "pf_url", "https://luminasmiles.in"), ("on-page-audit", "pf_url", "https://luminasmiles.in"),
    ("keyword-research", "pf_keyword", "dental implants pune"), ("content-architect", "pf_domain", "luminasmiles.in"),
    ("market-potential", "pf_service", "Dental implants"),
])
def test_a_tool_opens_with_the_accounts_details(tool, key, value):
    r = _client().get("/lumina/seo-aeo/" + tool)
    html = r.get_data(as_text=True)
    assert r.status_code == 200 and _embed(html)[key] == [value]
    assert 'data-acct-current="lumina"' in html and 'data-acct-page="seo-aeo/%s"' % tool in html
    assert 'var SEO_BASE = "/lumina/seo-aeo"' in html, "the address follows the tool inside the account"


def test_a_tool_with_nothing_to_give_still_opens_inside_the_account():
    q = _embed(_client().get("/lumina/seo-aeo/knowledge-base").get_data(as_text=True))
    assert not [k for k in q if k.startswith("pf_")]
    assert _client().get("/lumina/seo-aeo/no-such-tool").status_code == 302


def test_an_agent_opens_on_its_own_page_with_the_fields_filled():
    r = _client().get("/lumina/agents/local-business-radar")
    html = r.get_data(as_text=True)
    assert r.status_code == 200 and 'id="lbr-type"' in html
    m = re.search(r"window.__ACCT_PREFILL__=(\{.*?\});</script>", html)
    assert json.loads(m.group(1)) == {"fields": {"#lbr-type": "Dental clinic", "#lbr-where": "Pune"},
                                      "name": "Lumina Smiles Dental"}
    assert "account-prefill.js" in html and 'data-acct-current="lumina"' in html
    assert _client().get("/lumina/agents/no-such-agent").status_code == 404


def test_profile_text_cannot_break_out_of_the_script():
    STATE["lines"] = PROFILE[:2] + ["Industry: x</script><script>alert(1)</script>"]
    html = _client().get("/lumina/agents/local-business-radar").get_data(as_text=True)
    assert "x</script><script>alert(1)" not in html and "x<\\/script>" in html


def test_the_home_lists_what_to_run_for_staff_only():
    html = _client().get("/lumina").get_data(as_text=True)
    assert "Run for Lumina Smiles Dental" in html
    assert 'href="/lumina/seo-aeo/seo-geo-audit"' in html and "dental implants pune" in html
    assert 'href="/lumina/agents/local-business-radar"' in html and "Dental clinic · Pune" in html
    post = _client(ADMIN).post("/lumina/api/access", json={"who": "ana@lumina.in"}, headers={"X-Requested-With": "fetch"})
    assert post.status_code == 200
    client = _client("ana@lumina.in")
    assert "Run for" not in client.get("/lumina").get_data(as_text=True)
    for path in ("/lumina/seo-aeo/seo-geo-audit", "/lumina/agents/local-business-radar"):
        r = client.get(path)
        assert r.status_code == 302 and r.headers["Location"].endswith("/lumina"), path


def test_from_a_global_tool_the_picker_opens_it_for_the_account():
    html = _client().get("/seo-aeo/keyword-research").get_data(as_text=True)
    assert 'data-acct-page="seo-aeo/keyword-research"' in html
    html = _client().get("/strategic-agents/local-business-radar").get_data(as_text=True)
    assert 'data-acct-page="agents/local-business-radar"' in html


def test_each_studio_form_reads_what_the_platform_hands_it():
    """The studio's forms start from ?pf_* (seo-apps/client/src/lib/prefill.js); the keys must match
    what app.py sends (ACCT_SEO)."""
    src = os.path.join(ROOT, "seo-apps", "client", "src")
    with open(os.path.join(src, "lib", "prefill.js"), encoding="utf-8") as fh:
        assert "get('pf_' + key)" in fh.read()
    want = {"pages/OnPageAuditPage.jsx": "url", "pages/AgentReadinessAuditPage.jsx": "url",
            "pages/ImageAltAuditPage.jsx": "url", "hooks/useSeoGeoAudit.js": "url",
            "pages/ContentArchitectPage.jsx": "domain", "pages/KeywordResearchPage.jsx": "keyword",
            "pages/ContentResearchPage.jsx": "keyword", "pages/MarketPotentialPage.jsx": "service"}
    for path, key in want.items():
        with open(os.path.join(src, path), encoding="utf-8") as fh:
            body = fh.read()
        assert "import { prefill } from '../lib/prefill';" in body and "prefill('%s')" % key in body, path
    sent = {k for _, k in appmod.ACCT_SEO}
    assert sent <= {"url", "domain", "keyword", "service"}
