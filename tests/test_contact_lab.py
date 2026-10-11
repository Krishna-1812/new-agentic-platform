"""Contact Finder Lab, Phase 0 (tracker/contact_lab*.py): reading search
results into people, working out email patterns, the two search backends
with their failures named, the cost cap, a whole company end to end on
fakes, the admin routes, and the page script under Node with hostile
strings (names and headlines come from search results)."""
import json
import os
import shutil
import subprocess
import sys
from decimal import Decimal

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tracker import contact_lab as lab  # noqa: E402
from tracker import contact_lab_search as search  # noqa: E402

EVIL = '<img src=x onerror=alert(1)>"\'&'


# == input ==========================================================================

def test_companies_take_an_optional_domain_and_are_bounded():
    got = lab.parse_companies("Stripe\n\n Core Care Clinic | https://www.CoreCareClinic.com/about \nstripe")
    assert got == [{"name": "Stripe", "domain": None}, {"name": "Core Care Clinic", "domain": "corecareclinic.com"}]
    with pytest.raises(ValueError):
        lab.parse_companies("Acme | not a domain")
    with pytest.raises(ValueError):
        lab.parse_companies("\n".join("Co %d" % i for i in range(11)))
    with pytest.raises(ValueError):
        lab.parse_companies("  ")


def test_roles_are_split_deduplicated_and_bounded():
    assert lab.parse_roles("CFO; Head of Marketing\ncfo") == ["CFO", "Head of Marketing"]
    with pytest.raises(ValueError):
        lab.parse_roles("\n".join("Role %d" % i for i in range(6)))


def test_an_estimate_counts_claude_searches_only_when_claude_is_used():
    free = lab.estimate(3, 2, ["searxng"], "claude-haiku-5-5")
    assert free["claude_searches"] == 0 and free["typical_usd"] == 0
    paid = lab.estimate(3, 2, ["searxng", "claude"], "claude-haiku-5-5", domains_given=1)
    assert paid["claude_searches"] == 3 * (1 + 2 * 2 + 1) - 1
    assert 0 < paid["typical_usd"] < lab.estimate(3, 2, ["claude"], "claude-opus-5-5")["typical_usd"]


# == reading search results =========================================================

def test_the_website_is_the_first_result_that_is_not_a_directory():
    results = [{"url": "https://www.linkedin.com/company/stripe"}, {"url": "https://en.wikipedia.org/wiki/Stripe"},
               {"url": "https://dashboard.stripe.com/login"}, {"url": "https://stripe.com/payments"},
               {"url": "https://stripe-fan.blog/"}]
    domain, cands = lab.pick_domain(results, "Stripe, Inc.")
    assert domain == "stripe.com" and "stripe-fan.blog" in cands
    assert lab.pick_domain([{"url": "https://www.acme.co.uk/x"}], "Acme Ltd")[0] == "acme.co.uk"
    assert lab.pick_domain([], "Nobody") == (None, [])


@pytest.mark.parametrize("title, name, headline", [
    ("Kanchan Belavadi - Head of Marketing, India at Stripe | LinkedIn", "Kanchan Belavadi", "Head of Marketing, India at Stripe"),
    ("Jane Doe – VP Marketing – Acme | LinkedIn", "Jane Doe", "VP Marketing - Acme"),
    ("Michel K. - Houston, Texas, United States | Professional... | LinkedIn", "Michel K.",
     "Houston, Texas, United States - Professional"),
])
def test_a_linkedin_result_title_gives_the_name_and_headline(title, name, headline):
    p = lab.parse_linkedin({"url": "https://uk.linkedin.com/in/Some-One-12ab?trk=x", "title": title,
                            "snippet": "Experience: Stripe · Location: London"})
    assert p["name"] == name and p["headline"] == headline
    assert p["linkedin"] == "https://www.linkedin.com/in/some-one-12ab" and p["experience"] == "Stripe"


def test_only_profile_pages_are_people():
    assert lab.parse_linkedin({"url": "https://www.linkedin.com/company/stripe", "title": "Stripe | LinkedIn"}) is None
    assert lab.parse_linkedin({"url": "https://www.linkedin.com/in/x", "title": ""}) is None


def test_the_company_and_its_past_are_told_apart():
    t = lab.company_tokens("Stripe, Inc.", "stripe.com")
    assert lab.mentions_company("Head of Marketing, India at Stripe", t)
    assert not lab.mentions_company("Stripes Consulting", t)
    for text in ("FinTech CFO - Rho Technologies - ex. Stripe", "Head of Marketing at Privy, a Stripe company",
                 "formerly at Stripe", "Ex-Stripe, now at Plaid"):
        assert lab.former_mention(text, t), text
    assert not lab.former_mention("Head of Marketing at Stripe", t)


def test_emails_are_cleaned_and_kept_to_the_company():
    text = 'x\\u003esales@stripe.com jane.diaz@stripe.com bob@gmail.com ops@eu.stripe.com hi@stripe.org &lt;a@stripe.com&gt;'
    assert lab.emails_in(text, "stripe.com") == ["sales@stripe.com", "jane.diaz@stripe.com", "ops@eu.stripe.com",
                                                 "hi@stripe.org", "a@stripe.com"]


# == email patterns =================================================================

def test_names_lose_accents_titles_and_initials():
    assert lab.name_parts("José Álvarez-Núñez, MBA") == ("jose", "alvareznunez")
    assert lab.name_parts("Alok Desai, CFA") == ("alok", "desai")
    assert lab.name_parts("Kate (Cuicui) Jia") == ("kate", "jia")
    assert lab.name_parts("Michel K.") == ("michel", None)
    assert lab.name_parts("") == (None, None)


def test_a_pattern_is_confirmed_only_by_addresses_that_match_named_people():
    emails = ["jdoe@acme.com", "asmith@acme.com", "info@acme.com", "sales@acme.com"]
    got = lab.infer_pattern(emails, ["Jane Doe", "Alan Smith"])
    assert (got["pattern"], got["level"], got["matched"]) == ("flast", "confirmed", 2)
    one = lab.infer_pattern(["jane.doe@acme.com"], ["Jane Doe"])
    assert (one["pattern"], one["level"]) == ("first.last", "likely")
    shape = lab.infer_pattern(["kim.lee@acme.com", "raj.patel@acme.com"], [])
    assert (shape["pattern"], shape["level"]) == ("first.last", "likely")
    none = lab.infer_pattern(["info@acme.com", "help@acme.com"], ["Jane Doe"])
    assert (none["level"], none["personal_seen"]) == ("guess", 0)


def test_each_person_gets_an_address_labelled_by_how_sure_it_is():
    pat = lab.infer_pattern(["jdoe@acme.com", "asmith@acme.com"], ["Jane Doe", "Alan Smith"])
    assert lab.email_for("Jane Doe", "acme.com", pat, ["jdoe@acme.com"]) == \
        {"address": "jdoe@acme.com", "label": "published", "evidence": "seen on the web"}
    built = lab.email_for("Raj Patel", "acme.com", pat, ["jdoe@acme.com"])
    assert built["address"] == "rpatel@acme.com" and built["label"] == "pattern_confirmed"
    guess = lab.email_for("Raj Patel", "acme.com", lab.infer_pattern([], []), [])
    assert guess["address"] == "raj.patel@acme.com" and guess["label"] == "pattern_guess"
    assert lab.email_for("Michel K.", "acme.com", pat, [])["address"] is None


# == mail and the server ============================================================

class _NoMX:
    def resolve(self, *a, **k):
        class NoAnswer(Exception):
            pass
        raise NoAnswer()


class _DoH:
    def __init__(self, answers):
        self.answers = answers

    def get(self, url, params=None, **k):
        data = self.answers.get(params["name"])

        class R:
            def json(self_inner):
                if data is None:
                    raise ValueError("no")
                return data
        return R()


def test_a_resolver_that_says_no_mx_is_checked_over_https():
    doh = _DoH({"stripe.com": {"Status": 0, "Answer": [{"type": 15, "data": "10 aspmx.l.google.com."},
                                                        {"type": 15, "data": "20 alt1.aspmx.l.google.com."}]},
                "nomail.com": {"Status": 0, "Authority": []}})
    got = lab.mail_domain("stripe.com", resolver=_NoMX(), session=doh)
    assert got["status"] == "ok" and got["provider"] == "Google Workspace" and got["mx"][0] == "aspmx.l.google.com"
    assert lab.mail_domain("nomail.com", resolver=_NoMX(), session=doh)["status"] == "none"
    assert lab.mail_domain("unknown.com", resolver=_NoMX(), session=doh)["status"] == "unknown"


def test_a_site_without_mail_uses_the_domain_its_addresses_do():
    mx = {"corecareclinic.com": "none", "corecareclinic.org": "ok"}
    look = lambda d: {"status": mx.get(d, "none"), "mx": [], "provider": None}
    domain, mail, note = lab.email_domain("corecareclinic.com", ["appointments@corecareclinic.org"], lookup=look)
    assert domain == "corecareclinic.org" and mail["status"] == "ok" and "corecareclinic.org does" in note
    assert lab.email_domain("acme.com", [], lookup=lambda d: {"status": "ok"})[0] == "acme.com"
    assert "no sibling" in lab.email_domain("zzz.com", [], lookup=look)[2]


# == the search backends ============================================================

class _Resp:
    def __init__(self, status, data):
        self.status_code, self._data = status, data

    def json(self):
        if isinstance(self._data, Exception):
            raise self._data
        return self._data


class _Session:
    def __init__(self, resp):
        self.resp, self.calls = resp, []

    def get(self, url, params=None, **k):
        self.calls.append((url, params))
        return self.resp


def test_searxng_results_carry_their_engines_and_refusals_are_named():
    s = _Session(_Resp(200, {"results": [{"url": "https://stripe.com/", "title": "Stripe", "content": "Payments",
                                          "engines": ["bing", "google cse"]}],
                             "unresponsive_engines": [["google", "access denied"], ["qwant", "CAPTCHA"]]}))
    got = search.searxng("stripe official website", "http://sx:8080/", session=s, engines=["bing", "google"])
    assert got["status"] == "ok" and got["answered"] == ["bing", "google cse"]
    assert got["refused"] == {"google": "access denied", "qwant": "CAPTCHA"}
    assert s.calls[0] == ("http://sx:8080/search", {"q": "stripe official website", "format": "json", "engines": "bing,google"})
    blocked = search.searxng("q", "http://sx", session=_Session(_Resp(200, {"results": [], "unresponsive_engines": [["google", "x"]]})))
    assert blocked["status"] == "blocked"
    assert search.searxng("q", "http://sx", session=_Session(_Resp(200, {"results": []})))["status"] == "empty"
    assert "json under search.formats" in search.searxng("q", "http://sx", session=_Session(_Resp(403, {})))["note"]


def test_searxng_needs_its_address(monkeypatch):
    monkeypatch.delenv("SEARXNG_URL", raising=False)
    assert search.searxng("q")["status"] == "not_configured"
    assert search.searxng_health() == {"configured": False, "ok": False, "note": "SEARXNG_URL is not set"}


class _Block(dict):
    __getattr__ = dict.get


class _Claude:
    """A fake Anthropic client: one web_search per call."""

    def __init__(self, content, usage=None, reject=()):
        self.content, self.calls, self.reject = content, [], set(reject)
        self.usage = usage or {"input_tokens": 6000, "output_tokens": 50, "server_tool_use": {"web_search_requests": 1}}
        self.messages = self

    def create(self, **kw):
        self.calls.append(kw)
        if kw["tools"][0]["type"] in self.reject:
            err = Exception("tool web_search_20250305 is not supported")
            err.status_code = 400
            raise err
        return _Block(content=self.content, usage=self.usage, model=kw["model"], stop_reason="end_turn")


def test_claude_search_reads_results_books_cost_and_respects_the_cap():
    content = [_Block(type="server_tool_use", name="web_search"),
               _Block(type="web_search_tool_result", content=[
                   _Block(url="https://www.linkedin.com/in/jane", title="Jane Doe - CFO - Acme | LinkedIn", page_age="2026")]),
               _Block(type="text", text="jane@acme.com | https://acme.com/team")]
    client = _Claude(content, reject={"web_search_20250305"})
    budget = search.Budget("1.00")
    got = search.claude('"Acme" "CFO"', model="claude-haiku-5-5", budget=budget, site="linkedin.com",
                        ask="list emails", client=client)
    assert got["status"] == "ok" and got["results"][0]["title"].startswith("Jane Doe")
    assert got["reply"] == "jane@acme.com | https://acme.com/team" and got["tool_version"] == "web_search_20260209"
    assert client.calls[-1]["tools"][0]["allowed_domains"] == ["linkedin.com"]
    # $0.01 the search, 6,000 input and 50 output tokens at Haiku's rates
    assert abs(float(budget.spent) - (0.01 + 6000 * 0.10 / 1e6 + 50 * 0.5 / 1e6)) < 1e-9
    with pytest.raises(search.BudgetExceeded):
        search.claude("q", model="claude-opus-5-5", budget=search.Budget("0.05"), client=client)


def test_a_refused_claude_search_is_blocked_not_empty():
    content = [_Block(type="web_search_tool_result", content=_Block(error_code="too_many_requests"))]
    got = search.claude("q", model="claude-haiku-5-5", budget=search.Budget("1"),
                        client=_Claude(content, usage={"input_tokens": 100, "output_tokens": 5,
                                                       "server_tool_use": {"web_search_requests": 1}}))
    assert got["status"] == "blocked" and got["refused"] == {"claude": "too_many_requests"}


# == one company, end to end on fakes ===============================================

def test_a_company_is_searched_both_ways_checked_and_scored(monkeypatch):
    def fake_searxng(query, engines=None):
        r = search._blank("searxng", query)
        if "official website" in query:
            r.update(status="ok", results=[{"url": "https://acme.com/", "title": "Acme", "snippet": "", "engine": "bing"}])
        elif "linkedin" in query:
            r.update(status="ok", results=[
                {"url": "https://www.linkedin.com/in/jdoe", "title": "Jane Doe - CFO - Acme | LinkedIn",
                 "snippet": "", "engine": "google cse"},
                {"url": "https://www.linkedin.com/in/bob", "title": EVIL + " - CFO - Elsewhere | LinkedIn",
                 "snippet": "", "engine": "yandex"}], answered=["google cse"])
        else:
            r.update(status="blocked", refused={"google": "access denied"})
        return r

    def fake_claude(query, *, model, budget, site=None, ask=None):
        r = search._blank("claude", query)
        budget.add("search", model, Decimal("0.02"), None)
        r.update(status="ok", cost_usd=0.02, searches=1)
        if "official website" in query:
            r["results"] = [{"url": "https://acme.com/about", "title": "About Acme", "snippet": "", "engine": "claude"}]
        elif site:
            r["results"] = [{"url": "https://www.linkedin.com/in/jdoe", "title": "Jane Doe - CFO at Acme | LinkedIn",
                             "snippet": "", "engine": "claude"}]
        else:
            r["reply"] = "asmith@acme.com | https://acme.com/team\njdoe@acme.com | https://x"
        return r

    monkeypatch.setattr(search, "searxng", fake_searxng)
    monkeypatch.setattr(search, "claude", fake_claude)
    monkeypatch.setattr(lab, "read_site", lambda d: {"pages": [{"url": "https://acme.com/", "status": "ok", "note": ""}],
                                                     "texts": {"https://acme.com/team": "Alan Smith, CEO"},
                                                     "emails": ["info@acme.com"]})
    monkeypatch.setattr(lab, "mail_domain", lambda d, **k: {"status": "ok", "mx": ["mx.acme.com"], "provider": "other"})
    calls = []

    def fake_json(budget, stage, model, system, user, schema, max_tokens, client=None):
        calls.append(stage)
        budget.add(stage, model, Decimal("0.001"), None)
        if stage == "site_people":
            return {"people": [{"name": "Alan Smith", "title": "CEO", "page": "https://acme.com/team"}]}
        lines = [l for l in user.splitlines() if l[:1].isdigit()]
        return {"verdicts": [{"n": int(l.split(".")[0]), "current": "yes" if "Jane" in l else "no",
                              "role": "CFO" if "Jane" in l else None, "reason": "r"} for l in lines]}

    monkeypatch.setattr(lab, "_json_call", fake_json)
    budget = search.Budget("3")
    rec = lab.run_company({"name": "Acme", "domain": None}, [{"role": "CFO", "variants": ["CFO", "Chief Financial Officer"],
                                                             "exclude": []}],
                          backends=["searxng", "claude"], model="claude-haiku-5-5", budget=budget, use_model=True)
    assert rec["domain"] == "acme.com" and rec["domain_source"] == "claude+searxng"
    jane = next(p for p in rec["people"] if p["name"] == "Jane Doe")
    assert sorted(jane["found_by"]) == ["claude", "searxng"] and jane["current"] == "yes" and jane["role"] == "CFO"
    assert jane["email"] == {"address": "jdoe@acme.com", "label": "published", "evidence": "seen on the web"}
    assert rec["email_pattern"]["pattern"] == "flast" and rec["email_pattern"]["level"] == "confirmed"
    assert any(p["name"] == "Alan Smith" and p["found_by"] == ["site"] for p in rec["people"])
    s, c = rec["backends"]["searxng"]["score"], rec["backends"]["claude"]["score"]
    assert (s["matched"], c["matched"]) == (1, 1) and s["blocked"] == 1 and s["profiles"] == 2
    assert c["cost_usd"] == 0.08 and calls == ["site_people", "check"]
    t = lab.totals([rec], ["searxng", "claude"])
    assert t["matched_by_both"] == 1 and t["searxng"]["refusals"] == {"google: access denied": 1}
    assert t["searxng"]["answered_by"]["google cse"] == 2 and t["emails"] == {"published": 1}


def test_a_free_run_checks_people_by_text_and_spends_nothing(monkeypatch):
    def fake_searxng(query, engines=None):
        r = search._blank("searxng", query)
        r.update(status="ok", results=[
            {"url": "https://www.linkedin.com/in/a", "title": "Ann Lee - CFO at Acme | LinkedIn", "snippet": "", "engine": "bing"},
            {"url": "https://www.linkedin.com/in/b", "title": "Bo Ray - CFO - Rho - ex. Acme | LinkedIn", "snippet": "", "engine": "bing"}])
        return r
    monkeypatch.setattr(search, "searxng", fake_searxng)
    monkeypatch.setattr(lab, "read_site", lambda d: {"pages": [], "texts": {}, "emails": []})
    monkeypatch.setattr(lab, "mail_domain", lambda d, **k: {"status": "ok", "mx": [], "provider": None})
    monkeypatch.setattr(lab, "port25_check", lambda: {"status": "blocked"})
    budget = search.Budget("0")
    out = lab.run({"companies": [{"name": "Acme", "domain": "acme.com"}], "roles": ["CFO"], "backends": ["searxng"],
                   "model": "claude-haiku-5-5"}, budget)
    people = {p["name"]: p for p in out["companies"][0]["people"]}
    assert people["Ann Lee"]["current"] == "yes" and people["Ann Lee"]["role"] == "CFO"
    assert people["Bo Ray"]["current"] == "no"
    assert out["cost"]["spent_usd"] == 0 and out["totals"]["searxng"]["matched"] == 1 and out["stopped"] is None


def test_a_run_stops_at_the_cap_and_keeps_what_it_has(monkeypatch):
    monkeypatch.setattr(lab, "port25_check", lambda: {"status": "blocked"})

    def broke(*a, **k):
        raise search.BudgetExceeded("over")
    monkeypatch.setattr(lab, "expand_roles", lambda *a, **k: [{"role": "CFO", "variants": ["CFO"], "exclude": []}])
    monkeypatch.setattr(lab, "run_company", broke)
    out = lab.run({"companies": [{"name": "Acme", "domain": None}], "roles": ["CFO"], "backends": ["claude"],
                   "model": "claude-haiku-5-5"}, search.Budget("0.01"))
    assert out["stopped"].startswith("Stopped at the cost cap") and out["companies"] == []


def test_the_budget_refuses_before_spending():
    b = search.Budget("0.10")
    b.check("0.10")
    b.add("search", "m", "0.08", {"input_tokens": 5})
    with pytest.raises(search.BudgetExceeded):
        b.check("0.03")
    assert b.by_stage() == {"search": 0.08}


# == routes =========================================================================

ADMIN = "kris@markifydigital.com"
BASE = "/admin/contact-lab"


def _client(email):
    import app as appmod
    c = appmod.app.test_client()
    if email:
        with c.session_transaction() as sess:
            sess["google_user"] = {"email": email, "name": "T"}
    return c


@pytest.mark.parametrize("method, path", [("get", BASE), ("get", BASE + "/api/status"), ("get", BASE + "/api/runs"),
                                          ("post", BASE + "/api/runs"), ("get", BASE + "/api/runs/1"),
                                          ("post", BASE + "/api/estimate")])
@pytest.mark.parametrize("email, status", [(None, 302), ("someone@markifydigital.com", 403)])
def test_every_lab_route_is_admin_only(method, path, email, status):
    c = _client(email)
    resp = getattr(c, method)(path, json={}) if method == "post" else c.get(path)
    assert resp.status_code == status


def test_a_run_is_refused_from_another_site_and_without_its_pieces(monkeypatch):
    monkeypatch.setenv("SEARXNG_URL", "http://sx:8080")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    c = _client(ADMIN)
    body = {"companies": "Acme", "roles": "CFO", "backends": ["searxng", "claude"], "model": "claude-haiku-5-5"}
    assert c.post(BASE + "/api/runs", json=body, headers={"Origin": "https://evil.example"}).status_code == 403
    r = c.post(BASE + "/api/runs", json=body)
    assert r.status_code == 400 and "confirm" in r.get_json()["error"]
    r = c.post(BASE + "/api/runs", json=dict(body, confirm_spend=True))
    assert r.status_code == 400 and "ANTHROPIC_API_KEY" in r.get_json()["error"]
    assert c.post(BASE + "/api/runs", json=dict(body, companies="")).status_code == 400
    assert c.post(BASE + "/api/runs", json=dict(body, backends=[])).status_code == 400
    assert c.post(BASE + "/api/runs", json=dict(body, model="gpt")).status_code == 400


def test_a_free_run_starts_once(monkeypatch):
    from tracker import contact_lab_store as store
    monkeypatch.setenv("SEARXNG_URL", "http://sx:8080")
    started, going = [], {}
    monkeypatch.setattr(store, "running_run", lambda email: going.get("run"))

    def start(settings, email):
        started.append(settings)
        going["run"] = {"id": 7}
        return 7
    monkeypatch.setattr(store, "start", start)
    c = _client(ADMIN)
    body = {"companies": "Acme | acme.com", "roles": "CFO", "backends": ["searxng"], "model": "claude-haiku-5-5"}
    r = c.post(BASE + "/api/runs", json=body)
    assert r.status_code == 202 and r.get_json() == {"run_id": 7}
    assert started[0]["companies"] == [{"name": "Acme", "domain": "acme.com"}] and started[0]["backends"] == ["searxng"]
    r = c.post(BASE + "/api/runs", json=body)
    assert r.status_code == 409 and r.get_json()["run_id"] == 7 and len(started) == 1


def test_the_estimate_route_explains_bad_input():
    c = _client(ADMIN)
    r = c.post(BASE + "/api/estimate", json={"companies": "A\nB", "roles": "CFO", "backends": ["claude"],
                                             "model": "claude-haiku-5-5"})
    assert r.status_code == 200 and r.get_json()["claude_searches"] == 2 * 4
    assert c.post(BASE + "/api/estimate", json={"companies": "", "roles": "CFO"}).status_code == 400


def test_the_page_renders_with_its_script_and_menu_entry():
    html = _client(ADMIN).get(BASE).get_data(as_text=True)
    assert "js/contact_lab.js" in html and "css/contact_lab.css" in html and 'href="/admin/contact-lab"' in html


# == the page script ================================================================

JS = os.path.join(ROOT, "static", "js", "contact_lab.js")


def run_js(expr):
    if shutil.which("node") is None:
        pytest.skip("node is not installed")
    prog = ("globalThis.window = globalThis; require(%s); const CL = globalThis.CL;\n"
            "process.stdout.write(JSON.stringify((() => { %s })()));") % (json.dumps(JS), expr)
    proc = subprocess.run([shutil.which("node"), "-e", prog], capture_output=True, text=True, timeout=30)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def _run():
    person = {"name": EVIL, "headline": EVIL, "linkedin": "javascript:alert(1)", "found_by": ["searxng", "claude"],
              "current": "yes", "role": "CFO", "why": EVIL,
              "email": {"address": EVIL, "label": "pattern_likely", "evidence": EVIL}}
    other = dict(person, name="Not There", current="no", role=None, linkedin="https://www.linkedin.com/in/x")
    company = {"name": EVIL, "domain": "acme.com", "domain_source": "claude+searxng", "email_domain": "acme.org",
               "mail": {"status": "ok", "provider": "Google Workspace", "mx": ["a"]},
               "email_pattern": {"pattern": "first.last", "level": "likely", "examples": [EVIL]},
               "people": [person, other], "published_emails": [EVIL], "notes": [EVIL],
               "backends": {"searxng": {"queries": [{"query": EVIL, "status": "blocked", "refused": {EVIL: EVIL},
                                                     "ms": 900, "cost_usd": 0, "note": EVIL, "results": 0}]}}}
    totals = {"searxng": {"queries": 4, "blocked": 1, "profiles": 9, "matched": 1, "emails": 2, "ms": 9000,
                          "cost_usd": 0, "domains_right": 1, "refusals": {EVIL: 3}, "answered_by": {"bing": 3}},
              "claude": {"queries": 4, "blocked": 0, "profiles": 7, "matched": 1, "emails": 1, "ms": 20000,
                         "cost_usd": 0.05, "domains_right": 1, "refusals": {}, "answered_by": {"claude": 4}},
              "matched_by_both": 1, "emails": {"pattern_likely": 1}}
    return {"id": 3, "status": "complete", "created_at": "2026-10-11T20:00:00Z",
            "settings": {"roles": [EVIL], "companies": [{"name": EVIL}], "backends": ["searxng", "claude"]},
            "summary": {"settings": {"backends": ["searxng", "claude"]}, "companies": [company], "totals": totals,
                        "port25": {"status": "blocked", "note": EVIL}, "cost": {"spent_usd": 0.05, "cap_usd": 3}}}


def test_the_page_shows_a_run_and_no_markup_from_search_results():
    import re
    out = run_js("const r = %s; return [CL.renderRun(r, {}), CL.renderRun(r, {showAll: true}),"
                 "CL.renderRuns([r], 3), CL.renderReady({searxng: {configured: true, ok: false, note: %s}, claude: {}})];"
                 % (json.dumps(_run()), json.dumps(EVIL)))
    for html in out:
        assert "<img" not in html and "onerror=alert(1)>" not in html.replace("&gt;", "")
        assert not [h for h in re.findall(r'href="([^"]*)"', html) if "javascript" in h]
    page, everyone = out[0], out[1]
    assert "Which way of searching found the people?" in page and "1 of the right people were found both ways" in page
    assert "Not There" not in page and "Not There" in everyone and "Show everyone found (2)" in page
    assert "Pattern, likely" in page and "mail at acme.org" in page and "Port 25 blocked" in page
    assert "25%" in page and "$0.050" in page and "Search service: down" in out[3]
    assert "Run 3" in out[2] and 'class="cl-run on"' in out[2]


def test_the_estimate_line_says_free_or_what_it_costs():
    out = run_js("return [CL.renderEstimate({companies: 2, roles: 1, claude_searches: 8, typical_usd: 0.12, cap_usd: 3}, ['claude']),"
                 "CL.renderEstimate({companies: 1, roles: 1}, ['searxng']), CL.renderEstimate({error: %s}, [])];" % json.dumps(EVIL))
    assert "8 Claude searches" in out[0] and "$0.120" in out[0] and "$3.00" in out[0]
    assert "Free" in out[1] and "<img" not in out[2]


# == storage, on a real Postgres ====================================================

from tests.test_market_radar_store import OWNER, OTHER, pg  # noqa: E402,F401  (fixture)


def test_a_run_is_stored_fills_in_per_company_and_is_kept_to_its_owner(pg, monkeypatch):
    from tracker import contact_lab_store as store
    monkeypatch.setattr(store, "_READY", False)
    seen = []

    def runner(settings, budget, progress=None):
        progress("company 1/1 (Acme): finding the website")
        budget.add("search", "claude-haiku-5-5", Decimal("0.02"), None)
        partial = {"companies": [{"name": "Acme", "people": []}]}
        settings["on_company"](partial)
        seen.append(store.get_run(run_id, OWNER))
        return {"companies": partial["companies"], "totals": {"searxng": {"matched": 0}}, "stopped": None,
                "cost": {"spent_usd": 0.02}}

    spawned = []
    run_id = store.start({"companies": [{"name": "Acme", "domain": None}], "roles": ["CFO"], "backends": ["claude"],
                          "model": "claude-haiku-5-5", "engines": None, "on_company": "not stored"}, OWNER,
                         spawn=lambda fn, args: spawned.append((fn, args)))
    assert store.running_run(OWNER)["id"] == run_id and store.running_run(OTHER) is None
    fn, args = spawned[0]
    fn(*args, runner=runner)
    mid = seen[0]
    assert mid["status"] == "running" and mid["summary"]["partial"] is True and mid["stage"].startswith("company 1/1")
    done = store.get_run(run_id, OWNER)
    assert done["status"] == "complete" and done["spent_usd"] == 0.02 and done["cost_cap_usd"] == 3.0
    assert "on_company" not in done["settings"] and done["summary"]["companies"][0]["name"] == "Acme"
    assert store.get_run(run_id, OTHER) is None
    [listed] = store.list_runs(OWNER)
    assert listed["companies_done"] == 1 and "summary" not in listed and store.running_run(OWNER) is None


def test_a_run_that_breaks_is_failed_with_what_it_spent(pg, monkeypatch):
    from tracker import contact_lab_store as store
    monkeypatch.setattr(store, "_READY", False)

    def runner(settings, budget, progress=None):
        budget.add("search", "m", Decimal("0.01"), None)
        raise RuntimeError("boom")
    run_id = store.create_run(OWNER, {"companies": []}, Decimal("3"))
    store.job(run_id, {"companies": []}, Decimal("3"), runner=runner)
    run = store.get_run(run_id, OWNER)
    assert run["status"] == "failed" and "boom" in run["error"] and run["spent_usd"] == 0.01
