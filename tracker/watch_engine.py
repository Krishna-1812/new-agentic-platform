"""Page Watch: one check of one watched page, from reading it to recording it.

run_check(target_id) is the whole check:

  1. read the page (watch_capture), with the watch's area if it has one;
  2. a bot check or an error is recorded as such, and the page's baseline is
     left alone (an error is never compared, so it can never look like a
     change);
  3. the first good reading becomes the baseline;
  4. later readings are compared with the baseline (watch_detect):
       same     -> nothing is stored but the check row;
       changed  -> the new reading is stored, the evidence and a
                   before-and-after picture are recorded as a change, and the
                   new reading becomes the baseline.

The baseline's screenshot is stored lossless (the next comparison reads it);
when a newer baseline replaces it, it is re-saved lossy, because from then on
it is only looked at.

Scheduling, leases, retries and the confirming re-check arrive in Phase 2
(tracker/watch_worker.py); Claude's judgement in Phase 3. This module does
not post anything.
"""

from __future__ import annotations

import logging

from datetime import datetime, timezone

from tracker import watch_capture, watch_detect, watch_store, watch_visual

log = logging.getLogger(__name__)

# A watch is shown as failing only after this many failed checks in a row, so
# one bad minute on the site does not raise an alarm.
FAILS_BEFORE_ALERT = 2
# Straight after the baseline the page is read this many more times; what
# differs between those readings changes on every visit and is learned as
# noise (watch_detect.learn).
CALIBRATION_READS = 2


def settings_of(target):
    return {"area": target.get("area_selector") or None, "ignore": target.get("ignore") or [],
            "text": bool(target.get("watch_text", True)), "visual": bool(target.get("watch_visual", True)),
            "learned": (target.get("settings") or {}).get("learned")}


def calibrate(target, baseline, read, settings, reads=CALIBRATION_READS):
    """Read the page again `reads` times and learn what differs on every visit.

    Returns the learned {"rects", "sels"} (also saved on the watch). A reading
    that fails is skipped: calibration only ever removes noise.
    """
    learned = settings.get("learned") or {}
    done = 0
    for _ in range(reads):
        try:
            cap = read(target["url"], area=settings["area"], screenshots=settings["visual"])
        except Exception as exc:
            log.info("watch_engine: calibration read failed for watch %s: %s", target["id"], exc)
            continue
        if not cap.ok:
            continue
        report, _ = watch_detect.compare(baseline, cap, dict(settings, learned=learned))
        learned = watch_detect.learn(report, learned)
        done += 1
    extra = dict(target.get("settings") or {})
    extra.update(learned=learned, calibrated_at=datetime.now(timezone.utc).isoformat(), calibration_reads=done)
    watch_store.update_target(target["id"], settings=extra)
    return learned


def _snapshot_data(cap, noise):
    return {"url": cap.url, "final_url": cap.final_url, "status": cap.status, "title": cap.title,
            "engine": cap.engine, "blocks": cap.blocks, "area_box": cap.area_box,
            "page_height": cap.page_height, "width": cap.width, "height": cap.height, "noise": noise,
            "hidden": cap.hidden}


def _store_reading(target_id, cap, noise):
    """Save a reading as a snapshot (lossless screenshot + thumbnail). Returns its id."""
    shot_id = thumb_id = None
    if cap.screenshot:
        shot_id = watch_store.add_image(target_id, "shot", watch_visual.to_webp(cap.screenshot, lossless=True),
                                        width=cap.width, height=cap.height, lossless=True)
        thumb_id = watch_store.add_image(target_id, "thumb", watch_visual.thumbnail(cap.screenshot))
    from tracker import watch_text
    return watch_store.add_snapshot(target_id, watch_text.fingerprint(cap.blocks), _snapshot_data(cap, noise),
                                    shot_id=shot_id, thumb_id=thumb_id)


def load_previous(snapshot_id):
    """A stored snapshot in the shape watch_detect.compare reads, with its screenshot as PNG."""
    snap = watch_store.get_snapshot(snapshot_id)
    if not snap:
        return None
    prev = dict(snap["data"])
    prev["fingerprint"] = snap["fingerprint"]
    prev["screenshot"] = None
    if snap.get("shot_id"):
        img = watch_store.get_image(snap["shot_id"])
        if img:
            prev["screenshot"] = watch_visual.to_png(img["bytes"])
            prev["screenshot_lossless"] = bool(img.get("lossless"))
    prev["_snapshot"] = snap
    return prev


def _retire(snapshot):
    """A replaced baseline's screenshot: re-saved lossy, the lossless copy deleted."""
    shot_id = snapshot.get("shot_id")
    if not shot_id:
        return
    img = watch_store.get_image(shot_id)
    if not img or not img.get("lossless"):
        return
    lossy = watch_store.add_image(snapshot["target_id"], "shot",
                                  watch_visual.to_webp(watch_visual.to_png(img["bytes"]), lossless=False),
                                  width=img.get("width"), height=img.get("height"), lossless=False)
    watch_store.update_snapshot(snapshot["id"], shot_id=lossy)
    watch_store.delete_images([shot_id])


def calibrate_reads(target):
    """Calibration runs once per watch, when its first baseline is taken."""
    return not (target.get("settings") or {}).get("calibrated_at")


def run_check(target_id, *, capture=None):
    """Check one watched page now. Returns a summary dict (also stored on the check row).

    `capture` replaces watch_capture.capture (tests and the accuracy harness).
    """
    target = watch_store.get_target(target_id)
    if not target:
        raise LookupError("no watch %s" % target_id)
    check_id = watch_store.start_check(target_id)
    settings = settings_of(target)
    read = capture or watch_capture.capture
    try:
        cap = read(target["url"], area=settings["area"], screenshots=settings["visual"])
    except watch_capture.watch_safety.BadURL as exc:
        watch_store.finish_check(check_id, outcome="error", error="bad_url", error_detail=str(exc))
        return {"check_id": check_id, "outcome": "error", "error": "bad_url", "detail": str(exc)}

    facts = {"engine": cap.engine, "status": cap.status, "final_url": cap.final_url or None,
             "elapsed_ms": cap.elapsed_ms}
    if cap.bot_check or cap.error:
        outcome = "blocked" if cap.bot_check else "error"
        detail = "The site showed a bot check instead of the page." if cap.bot_check else cap.error_detail
        watch_store.finish_check(check_id, outcome=outcome, error=None if cap.bot_check else cap.error,
                                 error_detail=detail, **facts)
        fails = int(target.get("fail_count") or 0) + 1
        fields = {"fail_count": fails, "last_check_at": datetime.now(timezone.utc)}
        if fails >= FAILS_BEFORE_ALERT:
            fields["state"] = outcome
        watch_store.update_target(target_id, **fields)
        return {"check_id": check_id, "outcome": outcome, "error": cap.error, "detail": detail,
                "fail_count": fails}

    noise = watch_visual.pack_grid(watch_visual.noise_cells(cap.screenshot, cap.control)) \
        if cap.screenshot and cap.control else None

    baseline_id = target.get("baseline_id")
    previous = load_previous(baseline_id) if baseline_id else None
    if previous is None:
        sid = _store_reading(target_id, cap, noise)
        watch_store.update_target(target_id, baseline_id=sid, state="ok", fail_count=0,
                                  last_check_at=datetime.now(timezone.utc))
        learned = calibrate(target, watch_detect.snapshot_from(cap, noise), read, settings) \
            if calibrate_reads(target) else {}
        watch_store.finish_check(check_id, outcome="baseline", snapshot_id=sid, **facts)
        return {"check_id": check_id, "outcome": "baseline", "snapshot_id": sid, "learned": learned}

    # Two readings are only compared when they were made the same way: a page
    # read over plain HTTP has no screenshot and splits its text differently,
    # so against a browser baseline it would look like a wholesale change.
    problem = None
    if previous.get("engine") and cap.engine != previous["engine"]:
        problem = ("engine", "This check could only read the page without a browser, so it was not "
                             "compared. The baseline is kept.")
    elif settings["area"] and cap.area_found is False:
        problem = ("area_missing", "The watched area is no longer on the page.")
    if problem:
        watch_store.finish_check(check_id, outcome="error", error=problem[0], error_detail=problem[1], **facts)
        fails = int(target.get("fail_count") or 0) + 1
        fields = {"fail_count": fails, "last_check_at": datetime.now(timezone.utc)}
        if fails >= FAILS_BEFORE_ALERT:
            fields["state"] = "error"
        watch_store.update_target(target_id, **fields)
        return {"check_id": check_id, "outcome": "error", "error": problem[0], "detail": problem[1],
                "fail_count": fails}

    report, _ = watch_detect.compare(previous, cap, settings)
    if report["outcome"] == "same":
        recovered = {"state": "ok"} if target.get("state") in ("error", "blocked", "pending") else {}
        watch_store.update_target(target_id, fail_count=0, last_check_at=datetime.now(timezone.utc), **recovered)
        watch_store.finish_check(check_id, outcome="same", **facts)
        return {"check_id": check_id, "outcome": "same", "report": report}

    sid = _store_reading(target_id, cap, noise)
    composite_id = None
    if report.get("visual") and previous.get("screenshot") and cap.screenshot:
        try:
            comp = watch_visual.composite(previous["screenshot"], cap.screenshot, report["visual"])
            composite_id = watch_store.add_image(target_id, "composite", comp, mime="image/png")
        except Exception:
            log.exception("watch_engine: composite failed for watch %s", target_id)
    change_id = watch_store.add_change(target_id, baseline_id, sid, report["level"], report["headline"],
                                       _storable(report), composite_id=composite_id)
    _retire(previous["_snapshot"])
    now = datetime.now(timezone.utc)
    watch_store.update_target(target_id, baseline_id=sid, state="changed", fail_count=0,
                              last_change_at=now, last_check_at=now)
    watch_store.finish_check(check_id, outcome="changed", snapshot_id=sid, change_id=change_id, **facts)
    return {"check_id": check_id, "outcome": "changed", "change_id": change_id, "report": report}


def _storable(report):
    """The report without anything that is not JSON (numpy numbers, bytes)."""
    import json

    def fix(v):
        if isinstance(v, dict):
            return {k: fix(x) for k, x in v.items()}
        if isinstance(v, (list, tuple)):
            return [fix(x) for x in v]
        if hasattr(v, "item") and not isinstance(v, (bytes, str)):
            return v.item()
        return v
    out = fix(report)
    json.dumps(out)
    return out
