"""Buyer Radar became Lead Finder on 2026-10-26: its name is changed wherever people read it, and the
address, the settings and variable names and the tables are not (nothing anyone set up breaks)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as appmod  # noqa: E402
from tests.test_buyer_radar import BASE, STAFF, _client, mem  # noqa: E402,F401  (fixtures)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WHERE_PEOPLE_READ = ["templates", os.path.join("static", "js"), os.path.join("static", "css"), "tracker", ".github"]


def _read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


def test_the_page_and_the_agents_list_say_lead_finder_at_the_same_address(mem):
    html = _client(STAFF).get(BASE).get_data(as_text=True)
    assert "<title>Lead Finder" in html or "Lead Finder" in html
    assert "Buyer Radar" not in html and BASE == "/strategic-agents/buyer-radar"
    agents = _read("templates/b2b_agents.html")
    assert 'data-agent-name>Lead Finder</span>' in agents and "Buyer Radar" not in agents
    assert '"t": "Lead Finder"' in _read("templates/_bento.html")
    assert any(a[0] == "buyer-radar" and a[3] == "Lead Finder" for a in appmod.ACCT_AGENTS)


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
    assert old and all(ln.startswith("#") or ln == '("Buyer Radar", "Lead Finder"),' for ln in old), "only the analytics alias"


def test_the_old_name_in_the_analytics_folds_into_the_new_one_and_the_address_does_not_change():
    assert appmod._page_label("Buyer Radar") == "Lead Finder"
    assert appmod._page_label("/strategic-agents/buyer-radar") == "/strategic-agents/buyer-radar"


def test_the_workflow_the_settings_and_the_variables_keep_their_names():
    flow = _read(".github/workflows/buyer-radar-daily.yml")
    assert flow.startswith("name: Lead Finder daily search") and "BUYER_RADAR_CRON_TOKEN" in flow
    assert "BUYER_RADAR_CRON_TOKEN" in _read("app.py") and "BUYER_RADAR_SLACK_BOT_TOKEN" in _read("tracker/buyer_radar_send.py")
