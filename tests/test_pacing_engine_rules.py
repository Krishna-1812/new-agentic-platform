"""The pacing engine's per-client rules are data, never code (paid_marketing/pacing_engine/config.py): with no file
every client gets the generic policy, and a file named by PACING_CLIENT_RULES gives a client its target, its
naming rule, its paused and aliased accounts. The engine runs as scripts in its own folder, so it is asked here
the way tracker/paid_refresh.py runs it: a separate Python in that folder."""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.join(ROOT, "paid_marketing", "pacing_engine")
ASK = ("import json, config, categories, gads; print(json.dumps({"
       "'rules': {k: dict(v, major=sorted(v.get('major', ()))) for k, v in config.CLIENT_RULES.items()},"
       "'paused': sorted(config.PAUSED_ACCOUNTS), 'aliases': gads.ACCOUNT_ALIASES, 'split': sorted(gads.SPLIT_ACCOUNTS),"
       "'by_location': sorted(gads.LOCATION_RULES),"
       "'named': categories.categorise('Acme Dental', 'NA_Springfield_CTScan_ET_B', 'Springfield', 'SEARCH'),"
       "'generic': categories.categorise('Other Co', 'NA_Springfield_CTScan_ET_B', 'Springfield', 'SEARCH')}))")


def ask(env_extra):
    env = dict(os.environ)
    env.pop("PACING_CLIENT_RULES", None)
    env.update(env_extra)
    out = subprocess.run([sys.executable, "-I", "-c", "import sys; sys.path.insert(0, '.'); " + ASK],
                         cwd=ENGINE, env=env, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_with_no_rules_file_every_client_gets_the_generic_policy():
    got = ask({})
    assert got["rules"] == {} and got["paused"] == [] and got["aliases"] == {} and got["split"] == [] and got["by_location"] == []


def test_a_rules_file_gives_a_client_its_target_naming_and_accounts(tmp_path):
    path = tmp_path / "rules.json"
    path.write_text(json.dumps({
        "rules": {"Acme Dental": {"target_cpl": 40, "major": ["Brand", "PMax"], "minor_floor": 5, "naming": "account_prefix"}},
        "paused": ["Quiet Co"], "aliases": {"Acme Dental LLC": "Acme Dental"}, "split": ["Multi Site"], "by_location": ["Chain Co"]}))
    got = ask({"PACING_CLIENT_RULES": str(path)})
    assert got["rules"] == {"acme dental": {"target_cpl": 40, "major": ["Brand", "PMax"], "minor_floor": 5, "naming": "account_prefix"}}
    assert got["paused"] == ["quiet co"] and got["aliases"] == {"acme dental llc": "Acme Dental"}
    assert got["split"] == ["multi site"] and got["by_location"] == ["chain co"]
    assert got["named"] == got["generic"] == "CT Scan", "the account prefix rule reads the category out of the name"


def test_no_client_of_the_source_platform_is_left_in_the_engine():
    banned = ("riccobene", "great hill", "gentle dental", "shapiro", "porters", "heartland", "beta bionics", "position2", "holmes", "c0b322")
    for name in os.listdir(ENGINE):
        if name.endswith((".py", ".md")):
            text = open(os.path.join(ENGINE, name), encoding="utf-8").read().lower()
            assert not [b for b in banned if b in text], name
