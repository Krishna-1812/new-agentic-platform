#!/usr/bin/env python3
"""Market Radar's free reading, scored across kinds of business.

    python3 scripts/market_radar_benchmark.py              # the built-in list, a table
    python3 scripts/market_radar_benchmark.py --json out.json
    python3 scripts/market_radar_benchmark.py --only law_firm,hotel

For each public company website it runs everything Market Radar reads for free, with no model and no key:
the site reader, the Wikidata and Wikipedia stand-in, and the five readers of tracker/market_radar_more.py. It
prints how much of each company the profile could see, and which readers found something. Run it after a change
to the readers to see what got better or worse; the list covers the kinds of business in
tracker/market_radar_playbooks.py.

It reads public pages politely: one site at a time per worker, robots.txt respected beyond the homepage by the
site reader itself, and a refusal is recorded as a refusal, never retried in disguise.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import sys
import time
from collections import Counter
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tracker import market_radar_http as http  # noqa: E402
from tracker import market_radar_more as more  # noqa: E402
from tracker import market_radar_outside as outside  # noqa: E402
from tracker import market_radar_site as site  # noqa: E402

# (key, kind of business, name, website). Public companies, picked to cover the kinds of business.
SITES = [
    ("clinic_us", "local_single", "Aspen Dental", "aspendental.com"),
    ("clinic_in", "health_system", "Apollo Hospitals", "apollohospitals.com"),
    ("restaurant", "local_single", "Shake Shack", "shakeshack.com"),
    ("gym_chain", "multi_location", "Orangetheory", "orangetheory.com"),
    ("salon_chain", "multi_location", "Great Clips", "greatclips.com"),
    ("dtc_shoes", "ecommerce", "Allbirds", "allbirds.com"),
    ("dtc_socks", "ecommerce", "Bombas", "bombas.com"),
    ("dtc_beauty_in", "ecommerce", "Nykaa", "nykaa.com"),
    ("dtc_home", "ecommerce", "Brooklinen", "brooklinen.com"),
    ("marketplace_goods", "marketplace", "Etsy", "etsy.com"),
    ("marketplace_travel", "marketplace", "Airbnb", "airbnb.com"),
    ("marketplace_work", "marketplace", "Upwork", "upwork.com"),
    ("saas_support", "b2b_product", "Gorgias", "gorgias.com"),
    ("saas_crm", "b2b_product", "HubSpot", "hubspot.com"),
    ("saas_dev", "b2b_product", "Vercel", "vercel.com"),
    ("saas_design", "b2b_product", "Figma", "figma.com"),
    ("agency", "b2b_services", "Tenet Partners", "wearetenet.com"),
    ("it_services", "b2b_services", "Thoughtworks", "thoughtworks.com"),
    ("consulting", "professional_services", "McKinsey", "mckinsey.com"),
    ("law_firm", "professional_services", "Morgan Lewis", "morganlewis.com"),
    ("accounting", "professional_services", "BDO", "bdo.com"),
    ("architecture", "professional_services", "Gensler", "gensler.com"),
    ("recruiting", "professional_services", "Robert Half", "roberthalf.com"),
    ("hotel_group", "hospitality_travel", "Hilton", "hilton.com"),
    ("airline", "hospitality_travel", "Delta Air Lines", "delta.com"),
    ("tour_operator", "hospitality_travel", "Intrepid Travel", "intrepidtravel.com"),
    ("university", "education", "Arizona State University", "asu.edu"),
    ("online_learning", "education", "Coursera", "coursera.org"),
    ("bootcamp", "education", "General Assembly", "generalassemb.ly"),
    ("hospital_system", "health_system", "Mayo Clinic", "mayoclinic.org"),
    ("insurer", "financial_services", "Aetna", "aetna.com"),
    ("real_estate_agency", "real_estate", "Compass", "compass.com"),
    ("real_estate_portal", "real_estate", "Zillow", "zillow.com"),
    ("bank", "financial_services", "Chase", "chase.com"),
    ("fintech", "financial_services", "Wise", "wise.com"),
    ("payments", "financial_services", "Stripe", "stripe.com"),
    ("insurtech", "financial_services", "Lemonade", "lemonade.com"),
    ("nonprofit_intl", "nonprofit", "UNICEF", "unicef.org"),
    ("nonprofit_us", "nonprofit", "Habitat for Humanity", "habitat.org"),
    ("association", "nonprofit", "American Bar Association", "americanbar.org"),
    ("manufacturer_hvac", "manufacturer", "Carrier", "carrier.com"),
    ("manufacturer_blender", "manufacturer", "Vitamix", "vitamix.com"),
    ("manufacturer_auto", "manufacturer", "Ford", "ford.com"),
    ("creator", "personal_brand", "Gary Vaynerchuk", "garyvaynerchuk.com"),
    ("author_coach", "personal_brand", "Brene Brown", "brenebrown.com"),
    ("consumer_brand", "ecommerce", "Gymshark", "gymshark.com"),
    ("food_brand", "manufacturer", "Oatly", "oatly.com"),
    ("pharma", "manufacturer", "Pfizer", "pfizer.com"),
    ("media", "other", "The Guardian", "theguardian.com"),
]
READERS = (("content", more.read_content), ("apps", more.read_apps), ("buzz", more.read_buzz),
           ("facts", more.read_facts), ("stack", more.read_stack))
USEFUL = {"ok", "empty", "none"}        # a reader that answered; blocked and failed did not


def one(item):
    key, kind, name, domain = item
    t0 = time.time()
    rs = site.read_site("https://" + domain)
    words = outside.words_read(rs)
    found = outside.outside_facts(domain)
    row = {"key": key, "kind": kind, "name": name, "domain": domain, "site_status": rs.get("status"),
           "words": words, "outside": bool(found), "readers": {}}
    stand_in = outside.outside_reading(rs) if rs.get("status") != "ok" else None
    row["quality"] = outside.read_quality(stand_in or (outside.add_outside(rs) if outside.thin(rs) else rs))["grade"]
    ctx = {"entity": {"id": 1, "domain": domain, "name": name, "country": "US"}, "now": datetime.now(timezone.utc),
           "site": rs, "get": http.get, "get_json": http.get_json, "fetch": site.fetch}
    for rname, read in READERS:
        try:
            r = read(ctx) if (rs.get("status") == "ok" or rname in ("apps", "buzz", "facts")) else \
                {"status": "skipped", "note": "site not readable"}
        except Exception as e:     # a reader that breaks is a finding
            r = {"status": "broken", "note": "%s: %s" % (type(e).__name__, str(e)[:80])}
        row["readers"][rname] = {"status": r["status"], "items": r.get("items") or 0, "note": (r.get("note") or "")[:90]}
    row["seconds"] = round(time.time() - t0, 1)
    return row


def summarise(rows):
    n = len(rows)
    usable = sum(1 for r in rows if r["site_status"] == "ok" or r["outside"])
    out = {"sites": n, "profile_possible": usable, "profile_possible_pct": round(100 * usable / n),
           "site_read": sum(1 for r in rows if r["site_status"] == "ok"),
           "site_blocked": sum(1 for r in rows if r["site_status"] == "blocked"),
           "rescued_by_outside": sum(1 for r in rows if r["site_status"] != "ok" and r["outside"]),
           "unreadable": sum(1 for r in rows if r["site_status"] != "ok" and not r["outside"]),
           "readers": {}}
    for name, _ in READERS:
        c = Counter(r["readers"][name]["status"] for r in rows)
        out["readers"][name] = dict(c, answered_pct=round(100 * sum(v for k, v in c.items() if k in USEFUL) / n))
    kinds = {}
    for r in rows:
        k = kinds.setdefault(r["kind"], {"sites": 0, "profile_possible": 0})
        k["sites"] += 1
        k["profile_possible"] += 1 if (r["site_status"] == "ok" or r["outside"]) else 0
    out["by_kind"] = kinds
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--json", help="write every row and the summary here")
    ap.add_argument("--only", help="comma-separated keys from the list")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args(argv)
    items = [s for s in SITES if not args.only or s[0] in args.only.split(",")]
    with concurrent.futures.ThreadPoolExecutor(args.workers) as pool:
        rows = list(pool.map(one, items))
    print("%-20s %-22s %-8s %6s %-8s %s" % ("site", "kind", "site", "words", "quality", "content apps buzz facts stack"))
    for r in rows:
        print("%-20s %-22s %-8s %6d %-8s %s" % (r["key"], r["kind"], r["site_status"], r["words"], r["quality"],
                                                 "  ".join("%-7s" % r["readers"][n]["status"][:7] for n, _ in READERS)))
    s = summarise(rows)
    print("\nA profile is possible for %d of %d sites (%d%%): %d read directly, %d rescued by Wikidata/Wikipedia, %d not at all."
          % (s["profile_possible"], s["sites"], s["profile_possible_pct"], s["site_read"], s["rescued_by_outside"], s["unreadable"]))
    for name, c in s["readers"].items():
        print("  %-8s answered for %3d%%  %s" % (name, c["answered_pct"], {k: v for k, v in c.items() if k != "answered_pct"}))
    if args.json:
        with open(args.json, "w") as fh:
            json.dump({"summary": s, "rows": rows, "at": datetime.now(timezone.utc).isoformat()}, fh, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
