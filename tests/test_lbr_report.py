"""Local Business Radar, phase 10: the report. The payload it draws from, the
page that embeds it, the CSV and Excel exports, and the rules the report's
script keeps (text is inserted as text, never parsed as markup)."""

import csv
import io
import json
import os
import re
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tracker import lbr_pipeline, lbr_report, lbr_store  # noqa: E402
from test_lbr_pipeline import _client, _plan, env  # noqa: E402,F401

BASE = "/strategic-agents/local-business-radar"
ME = "p@markifydigital.com"


def _finished(env):
    rid = lbr_pipeline.start(ME, _plan())
    assert lbr_store.get_run(rid)["status"] == "complete"
    return rid


def _payload(rid):
    from app import _lbr_status
    run = lbr_store.get_run(rid, ME)
    status = _lbr_status(run)
    status["plan"] = run["plan"]
    return lbr_report.build(status, lbr_store.get_businesses(rid, ME))


def test_the_payload_puts_researched_leads_first_in_rank_order(env):
    p = _payload(_finished(env))
    bs = p["businesses"]
    assert len(bs) == 6
    leads = [b for b in bs if b["researched"]]
    assert [b["rank"] for b in leads] == [1, 2, 3, 4, 5]
    assert bs[-1]["chain"] and not bs[-1]["researched"] and "score" not in bs[-1]
    cedar = next(b for b in bs if b["name"] == "Cedar Smiles")
    assert cedar["web"]["kind"] == "none" and cedar["web"]["label"] == "No website"
    assert cedar["score"]["top"] == "website" and cedar["pitch"]["headline"] and cedar["facts"]
    assert p["area"]["kind"] == "city" and p["services"]["website"]
    assert p["run"]["summary"]["found"] == 6


def test_the_payload_leaves_out_raw_findings(env):
    p = _payload(_finished(env))
    blob = json.dumps(p)
    assert "reviewer" not in blob.lower(), "reviewer names are never kept or shown"
    b = next(b for b in p["businesses"] if b["researched"])
    assert set(b) >= {"score", "gbp", "web", "rev", "vis", "facts", "pitch"}
    assert "raw" not in b["web"] and "html" not in b["web"]


def test_the_report_page_embeds_the_payload_and_its_headline_figures(env):
    rid = _finished(env)
    r = _client().get(BASE + "/runs/%d/report" % rid)
    assert r.status_code == 200
    body = r.get_data(as_text=True)
    m = re.search(r'<script id="lbr-data" type="application/json">(.*?)</script>', body, re.S)
    assert m, "the payload is embedded once as JSON"
    data = json.loads(m.group(1))
    assert len(data["businesses"]) == 6 and data["run"]["id"] == rid
    assert "lbr-report.js" in body and "lbr-report.css" in body
    assert 'href="%s/runs/%d/export.xlsx"' % (BASE, rid) in body
    assert 'href="%s/runs/%d/export.csv"' % (BASE, rid) in body
    assert "Out of 6 found, 5 were researched in depth." in body


def test_the_embedded_json_cannot_close_its_script_tag(env, monkeypatch):
    rid = _finished(env)
    rows = lbr_store.get_businesses(rid, ME)
    evil = dict(rows[0]["data"])
    evil["profile"] = dict(evil["profile"], name="</script><script>alert(1)</script>")
    lbr_store.upsert_businesses(rid, [{"place_id": rows[0]["place_id"], "data": evil}])
    body = _client().get(BASE + "/runs/%d/report" % rid).get_data(as_text=True)
    assert "</script><script>alert(1)" not in body
    assert body.count("</script>") == body.count("<script")


def test_the_report_and_exports_are_only_for_their_owner(env):
    rid = _finished(env)
    other = _client("someone@markifydigital.com")
    for tail in ("report", "export.csv", "export.xlsx"):
        assert other.get(BASE + "/runs/%d/%s" % (rid, tail)).status_code == 404
    assert _client().get(BASE + "/runs/999999/report").status_code == 404


def test_the_csv_has_one_row_per_lead_with_the_pitch(env):
    rid = _finished(env)
    r = _client().get(BASE + "/runs/%d/export.csv" % rid)
    assert r.status_code == 200 and r.headers["Content-Type"].startswith("text/csv")
    assert 'filename="local-business-radar-' in r.headers["Content-Disposition"]
    rows = list(csv.reader(io.StringIO(r.get_data(as_text=True))))
    assert rows[0] == [c for c, _ in lbr_report.COLUMNS]
    assert len(rows) == 6, "five researched leads; the chain is left out"
    head = rows[0]
    first = dict(zip(head, rows[1]))
    assert first["Rank"] == "1" and first["Tier"] in ("A", "B", "C", "D")
    assert all(dict(zip(head, r))["Headline"] for r in rows[1:])


def test_a_cell_that_looks_like_a_formula_is_written_as_text():
    assert lbr_report._safe("=HYPERLINK(\"x\")") == "'=HYPERLINK(\"x\")"
    assert lbr_report._safe("+1 512 555 0100") == "'+1 512 555 0100"
    assert lbr_report._safe("@SUM(A1)") == "'@SUM(A1)"
    assert lbr_report._safe("-2") == "'-2"
    assert lbr_report._safe("Bright Dental") == "Bright Dental"
    assert lbr_report._safe(None) == "" and lbr_report._safe(4.5) == 4.5


def test_the_excel_export_has_leads_and_everything_found(env):
    openpyxl = pytest.importorskip("openpyxl")
    rid = _finished(env)
    r = _client().get(BASE + "/runs/%d/export.xlsx" % rid)
    assert r.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(r.get_data()))
    assert wb.sheetnames == ["Leads", "Everything found"]
    assert wb["Leads"].max_row == 6 and wb["Everything found"].max_row == 7


# ── The script's own rules ───────────────────────────────────────────────────

def _js():
    with open(os.path.join(ROOT, "static", "js", "lbr-report.js"), encoding="utf-8") as fh:
        return fh.read()


def test_the_script_never_parses_payload_text_as_markup():
    js = _js()
    assert "innerHTML" not in js and "insertAdjacentHTML" not in js and "outerHTML" not in js
    assert "document.write" not in js and "eval(" not in js


def test_every_element_the_script_needs_is_on_the_page(env):
    ids = set(re.findall(r'\$\("([a-z0-9-]+)"\)', _js()))
    rid = _finished(env)
    body = _client().get(BASE + "/runs/%d/report" % rid).get_data(as_text=True)
    missing = sorted(i for i in ids if 'id="%s"' % i not in body)
    assert not missing, missing


def test_links_from_the_payload_open_only_http_urls():
    js = _js()
    assert re.search(r"function safeUrl", js), "every href from the payload goes through safeUrl"
    assert not re.search(r'\.href\s*=(?!\s*(?:safeUrl\(|"))', js)
