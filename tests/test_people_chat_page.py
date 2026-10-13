"""People & Signals chat page (static/js/people_chat.js, templates/account_mapper.html) under Node, with hostile strings:
names, titles, photos, places and company names come from Saleshandy and what the viewer typed. Plus the page's
hooks: both scripts, the two modes, and the runs list showing a question as the question."""
import json
import os
import shutil
import subprocess
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

EVIL = '<img src=x onerror=alert(1)>"\'&'
ADMIN = "kris@markifydigital.com"
BASE = "/strategic-agents/people-signals"
AM_JS = os.path.join(ROOT, "static", "js", "account_mapper.js")
CHAT_JS = os.path.join(ROOT, "static", "js", "people_chat.js")


def run_js(expr):
    if shutil.which("node") is None:
        pytest.skip("node is not installed")
    prog = ("globalThis.window = globalThis; require(%s); require(%s); const AM = globalThis.AM, C = globalThis.AM.chat;\n"
            "process.stdout.write(JSON.stringify((() => { %s })()));") % (json.dumps(AM_JS), json.dumps(CHAT_JS), expr)
    proc = subprocess.run([shutil.which("node"), "-e", prog], capture_output=True, text=True, timeout=30)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def person(i, name, title, **kw):
    return dict({"id": i, "name": name, "title": title, "location": "Austin, Texas"}, **kw)


def run(people=None, status="ready", **kw):
    people = people if people is not None else [person(11, "Jane Doe", "VP of Marketing", decision_maker=True),
                                                person(12, "Raj Patel", "Marketing Manager", new_in_role=True)]
    return dict({"id": 7, "status": status, "stage": "found", "settings": {"chat": {"message": "marketing people at Acme"}},
                 "summary": {"credits": {"total": 412}, "companies": [{
                     "name": "Acme", "display_name": "Acme Inc", "domain": "acme.com",
                     "resolved": {"how": "exact name", "alternatives": [], "company": {"industry": "Software", "employees": 4000}},
                     "roles": [{"role": "Marketing team", "kind": "team", "status": "found", "total": 140,
                                "picked": people, "also": [], "attempts": [{"how": "Marketing department at acme.com", "total": 140, "kept": 2}]}]}]}},
                **kw)


UNDERSTOOD = {"companies": [{"name": "Acme", "domain": "acme.com"}], "asks": [{"kind": "team", "label": "Marketing team", "count": 5}],
              "where": "Austin"}


def test_every_value_is_escaped_and_every_link_is_checked():
    bad = person(1, EVIL, EVIL, photo="javascript:alert(1)", linkedin="javascript:alert(1)", location=EVIL,
                 email={"address": EVIL, "label": "verified", "note": EVIL}, revealed=True)
    r = run([bad])
    r["summary"]["companies"][0]["display_name"] = EVIL
    r["summary"]["companies"][0]["roles"][0]["role"] = EVIL
    r["summary"]["companies"][0]["roles"][0]["note"] = EVIL
    r["summary"]["companies"][0]["resolved"]["alternatives"] = [{"name": EVIL, "domain": "acme.io"}]
    u = {"companies": [{"name": EVIL, "domain": EVIL}], "asks": [{"kind": "team", "label": EVIL}], "where": EVIL, "how": "claude", "note": EVIL}
    html = run_js("return C.renderResult(%s, %s, {api: '/a', client: false}, {});" % (json.dumps(r), json.dumps(u)))
    assert "<img" not in html and "onerror=alert" not in html.replace("onerror=alert(1)&gt;", "")
    assert "&lt;img src=x onerror=alert(1)&gt;" in html
    assert 'href="javascript:' not in html and 'src="javascript:' not in html
    # without a safe profile address the link is a LinkedIn search for the name, never the unsafe value
    assert "linkedin.com/search/results/people/?keywords=" in html and "%3Cimg" in html


def test_a_found_person_shows_title_place_badges_and_a_search_link_until_revealed():
    html = run_js("return C.renderResult(%s, %s, {api: '/a'}, {11: true});" % (json.dumps(run()), json.dumps(UNDERSTOOD)))
    assert "Found 2 people" in html and "Acme Inc" in html
    assert "of 140 listed in Saleshandy" in html and "2 shown" in html
    assert "VP of Marketing" in html and "Austin, Texas" in html and "Decision-maker" in html and "New in role" in html
    assert html.count("Find on LinkedIn") == 2 and "Email: reveal" in html and "in Austin" not in html
    assert "Looking for" in html and "Marketing team" in html and "up to 5" in html and "Austin" in html
    assert 'data-act="cpick" data-run="7" data-key="11" checked' in html and 'data-key="12"' in html
    assert "<b>1</b> of 2 selected" in html and "up to 1 credit" in html


def test_a_revealed_person_shows_the_email_with_its_status_and_the_real_profile():
    p = person(11, "Jane Doe", "VP of Marketing", revealed=True, linkedin="https://www.linkedin.com/in/jane-doe",
               email={"address": "jane.doe@acme.com", "label": "verified"})
    q = person(12, "Raj Patel", "Marketing Manager", revealed=True, email={"address": None, "label": "not_found"})
    html = run_js("return C.renderResult(%s, %s, {api: '/a'}, {});" % (json.dumps(run([p, q])), json.dumps(UNDERSTOOD)))
    assert "jane.doe@acme.com" in html and "Verified" in html and 'href="https://www.linkedin.com/in/jane-doe"' in html
    assert "Not found" in html and html.count("Find on LinkedIn") == 1
    assert 'data-act="ccopyall"' in html and "Copy 1 email" in html
    assert "creveal" not in html and "Everyone shown has been revealed." in html


def test_the_reveal_button_counts_credits_and_waits_for_a_choice():
    r = json.dumps(run())
    none = run_js("return C.renderResult(%s, null, {api: '/a'}, {});" % r)
    assert 'data-act="creveal"' in none and "disabled" in none and "choose who" in none and "<b>0</b> of 2 selected" in none
    two = run_js("return C.renderResult(%s, null, {api: '/a'}, {11: true, 12: true});" % r)
    assert "up to 2 credits" in two and "<b>2</b> of 2 selected" in two
    assert run_js("return C.selectedKeys(%s, {11: true, 12: false, 99: true});" % r) == ["11"]       # only people in this answer
    assert sorted(run_js("return Object.keys(C.defaultSelection(%s));" % r)) == ["11", "12"]


def test_a_client_sees_no_credits_ticks_or_reveal_and_cannot_delete():
    html = run_js("return C.renderResult(%s, %s, {api: '/a', client: true}, {11: true});" % (json.dumps(run()), json.dumps(UNDERSTOOD)))
    assert "credit" not in html.lower() and "creveal" not in html and "cpick" not in html and "cremove" not in html
    assert "Email: reveal" not in html and "Find on LinkedIn" in html and "export.csv" in html
    assert "added by your account manager" in html


def test_working_failed_and_empty_answers():
    working = run_js("return C.renderResult(%s, %s, {api: '/a'}, {});" % (
        json.dumps({"id": 7, "status": "running", "stage": "finding Acme", "summary": {}}), json.dumps(UNDERSTOOD)))
    assert "Searching Saleshandy" in working and "finding Acme" in working and "creveal" not in working
    revealing = run_js("return C.renderResult(%s, null, {api: '/a'}, {});" % json.dumps(dict(run(), status="running", stage="revealing")))
    assert "Getting emails and LinkedIn profiles" in revealing and "cpick" not in revealing        # ticks lock while it works
    failed = run_js("return C.renderResult(%s, null, {api: '/a'}, {});" % json.dumps(
        {"id": 7, "status": "failed", "error": EVIL, "summary": {}}))
    assert "did not finish" in failed and 'data-act="cretry"' in failed and "<img" not in failed
    empty = run_js("return C.renderResult(%s, null, {api: '/a'}, {});" % json.dumps(run([])))
    assert "No one found" in empty and "Nobody matched" in empty and "Nobody found" in empty
    nomatch = run()
    nomatch["summary"]["companies"][0].update(domain=None, resolved={"how": "not found", "alternatives": [{"name": "Acme Robotics", "domain": "acmerobotics.com"}]})
    html = run_js("return C.renderResult(%s, null, {api: '/a'}, {});" % json.dumps(nomatch))
    assert "no company matched" in html and "acmerobotics.com" in html and "Write the website" in html


def test_the_thread_shows_questions_answers_hints_and_choices():
    items = [{"t": "day", "text": "Oct 13"}, {"t": "user", "text": EVIL},
             {"t": "bot", "kind": "clarify", "text": "Who at Stripe?", "choices": ["Leadership", EVIL]},
             {"t": "bot", "kind": "error", "text": EVIL},
             {"t": "run", "id": 7, "run": run(), "understood": UNDERSTOOD}, {"t": "run", "id": 8, "run": None, "understood": None}]
    html = run_js("return C.renderThread(%s, {api: '/a'}, {7: {11: true}});" % json.dumps(items))
    assert "<img" not in html and html.count("amc-msg me") == 1 and html.count("amc-msg bot") == 4
    assert 'data-act="csay" data-say="Leadership"' in html and "amc-msg bot err" in html
    assert "Searching Saleshandy" in html and "Found 2 people" in html


def test_the_empty_thread_has_a_welcome_and_suggestions_and_no_made_up_people():
    html = run_js("return C.renderEmpty(null, {api: '/a'});")
    assert "Who are you <em>looking for</em>?" in html and html.count('class="amc-s"') == 4 and 'data-say="Marketing people at HubSpot"' in html
    assert "Example answer" not in html and "Northwind" not in html and "Made-up" not in html and "amc-row" not in html
    assert "creveal" not in html and "cpick" not in html and "ccopyall" not in html and "cremove" not in html


def test_follow_ups_skip_what_was_asked_and_context_comes_from_the_last_answer():
    items = [{"t": "run", "id": 7, "run": run(), "understood": UNDERSTOOD}]
    html = run_js("return C.renderFollow(%s, {});" % json.dumps(items))
    assert "Marketing team" not in html and "Leadership" in html and 'data-say="and their leadership?"' in html
    assert run_js("return C.renderFollow(%s, {});" % json.dumps([{"t": "run", "id": 7, "run": run(status="running"), "understood": UNDERSTOOD}])) == ""
    assert run_js("return C.contextOf(%s);" % json.dumps(items)) == {"companies": UNDERSTOOD["companies"], "asks": UNDERSTOOD["asks"]}
    assert run_js("return C.contextOf([]);") == {}


def test_a_question_in_the_runs_list_reads_as_the_question():
    runs = [{"id": 9, "status": "ready", "created_at": "2026-10-13T08:00:00Z", "credits_used": 3, "totals": {"people_picked": 8},
             "settings": {"companies": [{"name": "Acme"}], "chat": {"message": EVIL}}},
            {"id": 8, "status": "ready", "created_at": "2026-10-13T07:00:00Z", "totals": {"titles": 2, "titles_found": 1},
             "settings": {"companies": [{"name": "Acme"}]}}]
    html = run_js("return AM.renderRuns(%s, 9);" % json.dumps(runs))
    assert "<img" not in html and "8 people found" in html and "Run 8" in html and "am-runq" in html and "Run 9" not in html


# == the page ==========================================================================

def _client(email):
    import app as appmod
    c = appmod.app.test_client()
    if email:
        with c.session_transaction() as sess:
            sess["google_user"] = {"email": email, "name": "T"}
    return c


def test_the_page_has_the_chat_the_two_modes_and_both_scripts():
    html = _client(ADMIN).get(BASE).get_data(as_text=True)
    assert 'id="amAsk"' in html and 'id="amComposer"' in html and 'id="amMsg"' in html and 'id="amThread"' in html
    assert 'data-mode="ask"' in html and 'data-mode="map"' in html and 'id="amForm"' in html
    assert html.index("js/account_mapper.js") < html.index("js/people_chat.js")
    assert 'maxlength="500"' in html and "marketing people at Stripe" in html


def test_the_chat_reaches_clients_as_a_run_that_counts_and_questions_do_not():
    import app as appmod
    assert appmod._client_route_tool(BASE + "/api/chat") == "people-signals"
    assert appmod._CLIENT_RUN_RX["people-signals"].match(BASE + "/api/chat")


def test_the_two_scripts_agree_on_what_they_share():
    src = open(CHAT_JS).read()
    for name in ("esc", "safeUrl", "ic", "chip", "hue", "avatar", "num", "when", "plural", "link", "EMAIL", "initials", "keyOf", "renderSetup"):
        assert name in run_js("return Object.keys(AM);"), name
        assert "AM." + name in src or name in ("keyOf",), name


def test_the_companies_to_choose_from_are_listed_with_what_tells_them_apart():
    needs = [{"name": "Position2", "candidates": [
        {"name": "Position2 Inc", "domain": "position2.com", "industry": "Marketing Services", "employees": 220,
         "hq": "Sunnyvale, United States", "linkedin": "https://www.linkedin.com/company/position2", "founded": 2003},
        {"name": EVIL, "domain": "position2.in", "industry": EVIL, "employees": 40, "hq": None,
         "linkedin": "javascript:alert(1)"}]}]
    it = {"t": "choose", "state": "open", "message": "marketing people at Position2", "understood": UNDERSTOOD, "needs": needs}
    html = run_js("return C.renderThread(%s, {api: '/a'}, {});" % json.dumps([it]))
    assert "Which &ldquo;Position2&rdquo; do you mean?" in html and "2 companies with a similar name" in html
    assert html.count('data-act="cchoose"') == 2 and 'data-domain="position2.com"' in html and 'data-item="0" data-need="0"' in html
    assert "Marketing Services" in html and "220 employees" in html and "founded 2003" in html and "Sunnyvale" in html
    assert 'href="https://position2.com/"' in html and 'href="https://www.linkedin.com/company/position2"' in html
    assert "<img" not in html and "javascript:" not in html and "None of these" in html and "This one" in html


def test_once_chosen_the_cards_lock_and_the_chosen_one_is_marked():
    needs = [{"name": "Position2", "picked": "position2.com", "candidates": [
        {"name": "Position2 Inc", "domain": "position2.com"}, {"name": "Position2", "domain": "position2.in"}]}]
    it = {"t": "choose", "state": "done", "understood": UNDERSTOOD, "needs": needs}
    html = run_js("return C.renderThread(%s, {api: '/a'}, {});" % json.dumps([it]))
    assert html.count("disabled") == 2 and "Chosen" in html and "None of these" not in html and "choose past" in html


def test_a_name_nobody_lists_asks_for_the_website_instead():
    it = {"t": "choose", "state": "open", "understood": UNDERSTOOD, "needs": [{"name": "Zzzzz Qqqq", "candidates": []}]}
    html = run_js("return C.renderThread(%s, {api: '/a'}, {});" % json.dumps([it]))
    assert "could not find &ldquo;Zzzzz Qqqq&rdquo;" in html and "zzzzzqqqq.com" in html and "cchoose" not in html


def test_a_reload_starts_a_new_chat_and_only_a_running_search_is_brought_back():
    src = open(CHAT_JS).read()
    init = src[src.index("AMChat.init = function"):src.index("AMChat.setStatus")]
    assert "resumeRunning(runs)" in init and "restore" not in src
    body = src[src.index("function resumeRunning"):src.index("AMChat.init = function")]
    assert "r.status === 'running'" in body and "slice(" not in body          # never the old finished chats


def test_recent_groups_by_day_filters_and_never_trusts_what_it_shows():
    now = "2026-10-13T08:00:00Z"
    runs = [{"id": 9, "status": "ready", "created_at": now, "credits_used": 0, "totals": {"people_picked": 2},
             "settings": {"companies": [{"name": "Acme"}], "chat": {"message": EVIL}}},
            {"id": 8, "status": "running", "stage": "mapping", "created_at": now, "settings": {"companies": [{"name": EVIL}, {"name": "B"}, {"name": "C"}]}},
            {"id": 7, "status": "failed", "created_at": "2020-01-02T08:00:00Z", "settings": {"companies": [{"name": "Old"}]}}]
    html = run_js("return AM.renderRuns(%s, 9);" % json.dumps(runs))
    assert "<img" not in html and html.count('class="amr-day"') == 2 and "Mapped" in html and " +1" in html
    assert "am-spin sm" in html and "Failed" in html and "Run 8" in html and "Run 7" in html
    only = run_js("return AM.renderRuns(%s, null, 'ask');" % json.dumps(runs))
    assert "Run 8" not in only and "2 people found" in only
    assert "Questions you ask appear here" in run_js("return AM.renderRuns(%s, null, 'ask');" % json.dumps(runs[1:2]))
    empty = run_js("return AM.renderRuns([], null);")
    assert "Nothing yet" in empty and "amr-stack" in empty
    both = run_js("return AM.renderRunFilters(%s, 'map');" % json.dumps(runs))
    assert 'data-f="ask"' in both and 'data-f="map"' in both and 'aria-pressed="true"' in both
    assert run_js("return AM.renderRunFilters(%s, 'all');" % json.dumps(runs[:1])) == ""            # one kind: nothing to filter


def test_the_form_previews_what_was_typed_as_chips_without_trusting_it():
    html = run_js("return AM.renderChips(['HubSpot | hubspot.com', %s, '  ', 'Gong'], 'co');" % json.dumps(EVIL + " | " + EVIL))
    assert html.count("am-chip co") == 3 and "<small>hubspot.com</small>" in html and "<img" not in html
    titles = run_js("return AM.renderChips(['VP Marketing', %s], 'ti');" % json.dumps(EVIL))
    assert titles.count("am-chip ti") == 2 and "<img" not in titles


def test_the_page_has_the_polished_pieces():
    html = _client(ADMIN).get(BASE).get_data(as_text=True)
    for hook in ('id="amAskSt"', 'id="amRunsF"', 'id="amRunsN"', 'id="amCompaniesChips"', 'am-opt', 'am-price', 'am-step', 'am-map-h'):
        assert hook in html, hook
    for hook in ("amPhrasings", "amWeb", "amBriefs", "amInsights", "amPerRole", "amModel"):         # the script reads these
        assert 'id="%s"' % hook in html, hook
