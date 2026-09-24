#!/usr/bin/env python3
"""Cut the ABM Signal Tracker down to the 50 healthcare companies with the most signals.

Run once on 2026-09-24, when the tracker was reduced to a single account
(Healthcare) and every other account was removed. Kept as the record of the rule
that was applied, and safe to re-run: on an already-pruned database it changes
nothing.

The rule, in order:
  1. Repeat rows are removed. The weekly job used to store the same signal again
     on every run, so 2,585 rows held 671 real signals. Rows are the same signal
     when company, signal type and headline match; the first-saved copy is kept,
     so each signal carries the date it was first detected. (Keeping the latest
     copy would have made old signals look new: 309 "this week" instead of 79.)
  2. Duplicate company records are merged. GoodRx was stored twice (same domain,
     identical signals); the Santa Monica HQ record is kept.
  3. Companies are ranked by distinct signals, ties broken by the most recently
     detected signal, then by name. The top 50 are kept.
  4. Every other company is deleted from the database (companies, snapshots,
     signals) and from apollo-accounts-export.csv, the list the weekly job reads.
"""
import csv
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "tracker.db"
CSV_PATH = ROOT / "apollo-accounts-export.csv"
KEEP = 50
# Same company stored twice; the second id is merged into the first.
DUPLICATE_RECORDS = {"69a861642aaaf10001450854": "69a860802aaaf100014426da"}


def main() -> int:
    con = sqlite3.connect(DB)
    before = con.execute("SELECT COUNT(*) FROM alerts_sent").fetchone()[0]

    # 1. repeat rows: keep the first-saved copy of each signal
    con.execute("""
        DELETE FROM alerts_sent WHERE id NOT IN (
            SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (
                    PARTITION BY apollo_id, signal_type, signal_detail
                    ORDER BY sent_at ASC, id ASC) AS rn
                FROM alerts_sent) WHERE rn = 1)""")

    # 2. duplicate company records
    for dup in DUPLICATE_RECORDS:
        for table in ("alerts_sent", "snapshots", "companies"):
            con.execute("DELETE FROM %s WHERE apollo_id=?" % table, (dup,))

    # 3. rank
    ranked = con.execute("""
        SELECT a.apollo_id, COUNT(*) AS n, MAX(a.sent_at) AS last, c.name
        FROM alerts_sent a JOIN companies c USING (apollo_id)
        WHERE a.dry_run = 0
        GROUP BY a.apollo_id
        ORDER BY n DESC, last DESC, c.name""").fetchall()
    keep = [r[0] for r in ranked[:KEEP]]
    if len(keep) < KEEP:
        print("only %d companies have signals" % len(keep), file=sys.stderr)

    # 4. delete everything else
    marks = ",".join("?" * len(keep))
    for table in ("alerts_sent", "snapshots", "companies"):
        con.execute("DELETE FROM %s WHERE apollo_id NOT IN (%s)" % (table, marks), keep)
    con.commit()
    con.execute("VACUUM")
    after = con.execute("SELECT COUNT(*) FROM alerts_sent").fetchone()[0]
    con.close()

    with CSV_PATH.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fields, rows = reader.fieldnames, list(reader)
    kept_rows = [r for r in rows if r.get("Apollo Account Id") in set(keep)]
    with CSV_PATH.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(kept_rows)

    print("signals %d -> %d | companies kept %d | csv rows %d -> %d"
          % (before, after, len(keep), len(rows), len(kept_rows)))
    for i, (aid, n, last, name) in enumerate(ranked[:KEEP], 1):
        print("%2d  %2d  %s" % (i, n, name))
    return 0


if __name__ == "__main__":
    sys.exit(main())
