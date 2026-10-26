"""Buyer Radar became Lead Finder on 2026-10-26: its name is changed wherever people read it, and the
address, the settings and variable names and the tables are not (nothing anyone set up breaks)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as appmod  # noqa: E402
from tests.test_buyer_radar import BASE, STAFF, _client, mem, seeded, world  # noqa: E402,F401  (fixtures)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WHERE_PEOPLE_READ = ["templates", os.path.join("static", "js"), os.path.join("static", "css"), "tracker", ".github"]


def _read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


def test_the_page_and_the_agents_list_say_lead_finder_at_the_same_address(mem):
    html = _client(STAFF).get(BASE).get_data(as_text=True)
    assert "<title>Lead Finder" in html or "Lead Finder" in html
    assert "Buyer Radar" not in html and BASE == "/strategic-agents/lead-finder"
    agents = _read("templates/b2b_agents.html")
    assert 'data-agent-name>Lead Finder</span>' in agents and "Buyer Radar" not in agents
    assert '"t": "Lead Finder"' in _read("templates/_bento.html")
    assert any(a[0] == "lead-finder" and a[3] == "Lead Finder" for a in appmod.ACCT_AGENTS)
    assert not any(a[0] == "buyer-radar" for a in appmod.ACCT_AGENTS)


def test_no_file_people_read_still_says_buyer_radar():
    left = []
    for top in WHERE_PEOPLE_READ:
        path = os.path.join(ROOT, top)
        files = [path] if os.path.isfile(path) else [os.path.join(d, f) for d, _, fs in os.walk(path) for f in fs]
        for p in files:
            if p.endswith((".py", ".js", ".html", ".css", ".yml")) and "Buyer Radar" in open(p, encoding="utf-8").read():
                left.append(os.path.relpath(p, ROOT))
    assert left == []
    old = [ln.strip() for ln in _read("app.py").splitlines() if "Buyer Radar" in ln]
    assert old and all("#" in ln.split("Buyer Radar")[0] or ln == '("Buyer Radar", "Lead Finder"),' for ln in old), \
        "only the analytics alias and comments about the rename"


def test_the_old_name_and_addresses_in_the_analytics_fold_into_the_new_ones():
    assert appmod._page_label("Buyer Radar") == "Lead Finder"
    assert appmod._page_label("/strategic-agents/buyer-radar") == "/strategic-agents/lead-finder"
    assert appmod._page_label("/outcomes-digital/agents/buyer-radar") == "/outcomes-digital/agents/lead-finder"
    assert appmod._page_label("/strategic-agents/lead-finder") == "/strategic-agents/lead-finder"


def test_the_old_addresses_send_you_on_to_the_new_ones_and_keep_a_post_a_post(seeded, mem):
    c = _client(STAFF)
    r = c.get("/strategic-agents/buyer-radar")
    assert r.status_code == 301 and r.headers["Location"].endswith("/strategic-agents/lead-finder")
    r = c.get("/strategic-agents/buyer-radar/api/status?x=1")
    assert r.status_code == 301 and r.headers["Location"].endswith("/strategic-agents/lead-finder/api/status?x=1")
    r = c.post("/strategic-agents/buyer-radar/api/runs", json={})
    assert r.status_code == 308 and r.headers["Location"].endswith("/strategic-agents/lead-finder/api/runs")
    r = _client(None).get("/lumina/agents/buyer-radar")
    assert r.status_code == 301 and r.headers["Location"].endswith("/lumina/agents/lead-finder")
    assert _client(None).get("/strategic-agents/lead-finder").status_code == 302, "the new address is the team's, as before"


def test_the_workflow_the_settings_and_the_variables_keep_their_names():
    flow = _read(".github/workflows/buyer-radar-daily.yml")
    assert flow.startswith("name: Lead Finder daily search") and "BUYER_RADAR_CRON_TOKEN" in flow
    assert '"/api/buyer-radar/daily"' in _read("app.py") and '"/buyer-radar/opt-out/<token>"' in _read("app.py"), \
        "the daily call and the opt-out link in emails already sent keep their addresses"
    assert "BUYER_RADAR_CRON_TOKEN" in _read("app.py") and "BUYER_RADAR_SLACK_BOT_TOKEN" in _read("tracker/buyer_radar_send.py")
