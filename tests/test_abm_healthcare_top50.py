"""The ABM Signal Tracker is one account, Healthcare, cut to its top 50 companies.

On 2026-09-24 the CSG and NorthStar Anesthesia accounts were removed and the
Healthcare universe (1,251 companies) was cut to the 50 with the most distinct
signals, by tools/prune_abm_to_top50.py. The same pass found the weekly job had
been storing one signal again on every run -- 2,585 rows held 671 real signals --
so the repeats were removed and the job now skips a signal it already holds.

Pinned here: the committed data is in that state, the three places that name the
universe (database, company CSV, dashboard) agree with each other, nothing still
points at the removed accounts, and the job cannot re-create the repeats.
"""

import csv
import json
import os
import re
import sqlite3
import sys
from pathlib import Path

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
os.environ.setdefault("FLASK_SECRET_KEY", "test")

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))

import app as appmod  # noqa: E402
from tracker.snapshot_store import SnapshotStore  # noqa: E402

_DB = _ROOT / "data" / "tracker.db"
_CSV = _ROOT / "apollo-accounts-export.csv"
_DASH = _ROOT / "reports" / "dashboard.html"


def _db_ids():
    con = sqlite3.connect(_DB)
    try:
        return {r[0] for r in con.execute("SELECT apollo_id FROM companies")}
    finally:
        con.close()


def _csv_ids():
    with _CSV.open(newline="", encoding="utf-8-sig") as f:
        return {r["Apollo Account Id"] for r in csv.DictReader(f)}


def _dashboard_data():
    src = _DASH.read_text(encoding="utf-8")
    m = re.search(r"^const DATA = (.*);$", src, re.M)
    return json.loads(m.group(1))


# ── One account ─────────────────────────────────────────────────────────────

def test_healthcare_is_the_only_account():
    assert list(appmod.ACCOUNTS) == ["healthcare"]


@pytest.mark.parametrize("path", [
    "reports/dashboard_csg.html", "reports/dashboard_northstar.html",
    "reports/dashboard_northstar_client.html", "reports/opportunities_csg.csv",
    "data/tracker_csg_v2.db", "data/tracker_northstar.db",
    "data/northstar_signals_manual.json",
])
def test_the_removed_accounts_files_are_gone(path):
    assert not (_ROOT / path).exists()


@pytest.mark.parametrize("path", [
    "app.py", "scripts/refresh-dashboards.py", "scripts/legacy/weekly_digest.py",
    ".github/workflows/refresh-dashboards.yml", "templates/b2b_agents.html",
])
def test_nothing_still_points_at_the_removed_accounts(path):
    text = (_ROOT / path).read_text(encoding="utf-8")
    for needle in ("tracker_csg_v2", "dashboard_csg", "tracker_northstar",
                   "dashboard_northstar", "fetch_csg", '"csg"'):
        assert needle not in text, "%s still mentions %s" % (path, needle)


def test_the_northstar_portal_no_longer_offers_the_signal_tracker():
    client = appmod.CLIENTS["northstaranesthesia"]
    assert "signal-tracker" not in client["agents"]
    assert "signal-tracker" not in (client.get("dashboards") or {})


# ── Fifty companies, in agreement everywhere ─────────────────────────────────

def test_the_database_holds_exactly_fifty_companies():
    assert len(_db_ids()) == 50


def test_the_company_csv_matches_the_database():
    """The weekly job reads its company list from the CSV; a company left there
    but not in the database would be re-added on the next run."""
    assert _csv_ids() == _db_ids()


def test_the_dashboard_matches_the_database():
    data = _dashboard_data()
    assert data["meta"]["total_companies"] == 50
    assert {c["apollo_id"] for c in data["companies"]} == _db_ids()


def test_every_kept_company_has_signals_and_nothing_else_does():
    con = sqlite3.connect(_DB)
    try:
        with_signals = {r[0] for r in con.execute("SELECT DISTINCT apollo_id FROM alerts_sent")}
        orphan_snaps = con.execute(
            "SELECT COUNT(*) FROM snapshots WHERE apollo_id NOT IN "
            "(SELECT apollo_id FROM companies)").fetchone()[0]
    finally:
        con.close()
    assert with_signals == _db_ids()
    assert orphan_snaps == 0


def test_goodrx_is_stored_once():
    con = sqlite3.connect(_DB)
    try:
        n = con.execute("SELECT COUNT(*) FROM companies WHERE name='GoodRx'").fetchone()[0]
    finally:
        con.close()
    assert n == 1


# ── No repeated signals ─────────────────────────────────────────────────────

def test_no_signal_is_stored_twice():
    con = sqlite3.connect(_DB)
    try:
        dupes = con.execute(
            "SELECT COUNT(*) FROM (SELECT 1 FROM alerts_sent "
            "GROUP BY apollo_id, signal_type, signal_detail HAVING COUNT(*) > 1)"
        ).fetchone()[0]
    finally:
        con.close()
    assert dupes == 0


def test_has_alert_sees_a_signal_saved_long_ago(tmp_path):
    """The old check only looked back dedup_days (7), so a signal the source
    reported again a week later was stored again. has_alert has no window."""
    store = SnapshotStore(tmp_path / "t.db")
    store.record_alert("a1", "C-Suite Join", "Jane Doe — Appointed as CFO", "HIGH")
    con = sqlite3.connect(tmp_path / "t.db")
    con.execute("UPDATE alerts_sent SET sent_at='2026-01-01T00:00:00+00:00'")
    con.commit()
    con.close()
    assert not store.was_alert_sent_recently("a1", "C-Suite Join", 7,
                                             signal_detail="Jane Doe — Appointed as CFO")
    assert store.has_alert("a1", "C-Suite Join", "Jane Doe — Appointed as CFO")
    assert not store.has_alert("a1", "C-Suite Join", "Someone Else — Appointed as CEO")


def test_the_weekly_job_checks_has_alert_before_storing():
    src = (_ROOT / "main.py").read_text(encoding="utf-8")
    block = src[src.index("# ── Dedup, send, record"):src.index("store.record_alert(")]
    assert "store.has_alert(" in block
