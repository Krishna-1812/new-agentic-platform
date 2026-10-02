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

A change is confirmed before it is recorded: the first check that sees it
keeps the reading as "suspected", and the next check (the worker runs it a
few minutes later) records it or calls it a glitch. See run_check.

Scheduling, leases and retries live in tracker/watch_worker.py; Claude's
judgement arrives in Phase 3. This module does not post anything.
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
# A change seen once is looked at again this long after, before it is told.
CONFIRM_DELAY_S = 180
# A part of the page that shows up as changed and is gone on the re-check
# this many times is learned as noise.
FLAPS_TO_LEARN = 2


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


def _store_reading(target_id, cap, noise, suspect=None):
    """Save a reading as a snapshot (lossless screenshot + thumbnail). Returns its id.

    `suspect` is kept with a reading that waits for its re-check: what it
    was suspected of, so a glitch can be counted against the right areas."""
    shot_id = thumb_id = None
    if cap.screenshot:
        shot_id = watch_store.add_image(target_id, "shot", watch_visual.to_webp(cap.screenshot, lossless=True),
                                        width=cap.width, height=cap.height, lossless=True)
        thumb_id = watch_store.add_image(target_id, "thumb", watch_visual.thumbnail(cap.screenshot))
    from tracker import watch_text
    data = _snapshot_data(cap, noise)
    if suspect:
        data["suspect"] = suspect
    return watch_store.add_snapshot(target_id, watch_text.fingerprint(cap.blocks), data,
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


def _read(read, target, settings):
    """Read the page; a browser that crashed is given one more go."""
    cap = read(target["url"], area=settings["area"], screenshots=settings["visual"])
    if cap.error == "browser":
        log.info("watch_engine: browser crashed on watch %s, reading again: %s", target["id"], cap.error_detail)
        cap = read(target["url"], area=settings["area"], screenshots=settings["visual"])
    return cap


def _failed(target, check_id, outcome, error, detail, facts):
    watch_store.finish_check(check_id, outcome=outcome, error=error, error_detail=detail, **facts)
    fails = int(target.get("fail_count") or 0) + 1
    fields = {"fail_count": fails, "last_check_at": datetime.now(timezone.utc)}
    if fails >= FAILS_BEFORE_ALERT:
        fields["state"] = outcome if outcome in watch_store.STATES else "error"
    watch_store.update_target(target["id"], **fields)
    return {"check_id": check_id, "outcome": outcome, "error": error, "detail": detail, "fail_count": fails}


def _drop_snapshot(snapshot_id):
    """Delete a reading nobody will look at (a glitch's), with its images."""
    snap = watch_store.get_snapshot(snapshot_id)
    if snap:
        watch_store.delete_snapshot(snapshot_id)
        watch_store.delete_images([snap.get("shot_id"), snap.get("thumb_id")])


def _flapped(target, found):
    """A suspected change that the re-check did not see: count its areas and
    elements as flickering. One that flickers FLAPS_TO_LEARN times is learned
    as noise; once is not enough, so a real change that happened to be
    undone within minutes does not silence that part of the page for good.
    Returns the settings to save."""
    stored = dict(target.get("settings") or {})
    flaps = dict(stored.get("flaps") or {})
    rects = [list(r) for r in flaps.get("rects") or []]
    sels = dict(flaps.get("sels") or {})
    promote = {"rects": [], "sels": []}
    counted = set()                      # one glitch counts each area once
    for x, y, w, h in found.get("rects") or []:
        hit = next((r for r in rects if watch_detect._overlap(r[:4], [x, y, w, h]) > 0), None)
        if hit:
            x0, y0 = min(hit[0], x), min(hit[1], y)
            x1, y1 = max(hit[0] + hit[2], x + w), max(hit[1] + hit[3], y + h)
            hit[:4] = [x0, y0, x1 - x0, y1 - y0]
            if id(hit) not in counted:
                hit[4] += 1
        else:
            hit = [x, y, w, h, 1]
            rects.append(hit)
        counted.add(id(hit))
    for sel in dict.fromkeys(found.get("sels") or []):
        sels[sel] = sels.get(sel, 0) + 1
    keep_rects = []
    for r in rects:
        (promote["rects"] if r[4] >= FLAPS_TO_LEARN else keep_rects).append(r[:4] if r[4] >= FLAPS_TO_LEARN else r)
    promote["sels"] = [k for k, n in sels.items() if n >= FLAPS_TO_LEARN]
    stored["flaps"] = {"rects": keep_rects, "sels": {k: n for k, n in sels.items() if n < FLAPS_TO_LEARN}}
    if promote["rects"] or promote["sels"]:
        stored["learned"] = watch_detect.absorb(stored.get("learned"), promote)
    return stored


def run_check(target_id, *, capture=None, confirm=None):
    """Check one watched page now. Returns a summary dict (also stored on the check row).

    `capture` replaces watch_capture.capture (tests and the accuracy harness).
    `confirm` (default: on, or the watch's settings["confirm"]) holds a
    change back until a second reading confirms it: the first check that
    sees it returns "suspected" and keeps the reading; the next check (the
    worker runs it CONFIRM_DELAY_S later) either confirms it ("changed") or
    finds it gone ("glitch").
    """
    target = watch_store.get_target(target_id)
    if not target:
        raise LookupError("no watch %s" % target_id)
    watch_store.close_stale_checks(target_id)
    check_id = watch_store.start_check(target_id)
    settings = settings_of(target)
    if confirm is None:
        confirm = bool((target.get("settings") or {}).get("confirm", True))
    read = capture or watch_capture.capture
    try:
        cap = _read(read, target, settings)
    except watch_capture.watch_safety.BadURL as exc:
        watch_store.finish_check(check_id, outcome="error", error="bad_url", error_detail=str(exc))
        return {"check_id": check_id, "outcome": "error", "error": "bad_url", "detail": str(exc)}

    facts = {"engine": cap.engine, "status": cap.status, "final_url": cap.final_url or None,
             "elapsed_ms": cap.elapsed_ms}
    if cap.bot_check:
        return _failed(target, check_id, "blocked", None, "The site showed a bot check instead of the page.", facts)
    if cap.error:
        return _failed(target, check_id, "error", cap.error, cap.error_detail, facts)

    noise = watch_visual.pack_grid(watch_visual.noise_cells(cap.screenshot, cap.control)) \
        if cap.screenshot and cap.control else None

    baseline_id = target.get("baseline_id")
    previous = load_previous(baseline_id) if baseline_id else None
    if previous is None:
        sid = _store_reading(target_id, cap, noise)
        watch_store.update_target(target_id, baseline_id=sid, state="ok", fail_count=0, pending_id=None,
                                  last_check_at=datetime.now(timezone.utc))
        learned = calibrate(target, watch_detect.snapshot_from(cap, noise), read, settings) \
            if calibrate_reads(target) else {}
        watch_store.finish_check(check_id, outcome="baseline", snapshot_id=sid, **facts)
        return {"check_id": check_id, "outcome": "baseline", "snapshot_id": sid, "learned": learned}

    # Two readings are only compared when they were made the same way: a page
    # read over plain HTTP has no screenshot and splits its text differently,
    # so against a browser baseline it would look like a wholesale change.
    if previous.get("engine") and cap.engine != previous["engine"]:
        return _failed(target, check_id, "error", "engine", "This check could only read the page without a "
                       "browser, so it was not compared. The baseline is kept.", facts)
    if settings["area"] and cap.area_found is False:
        return _failed(target, check_id, "error", "area_missing", "The watched area is no longer on the page.", facts)

    report, _ = watch_detect.compare(previous, cap, settings)
    pending_id = target.get("pending_id")
    pending = load_previous(pending_id) if pending_id else None
    now = datetime.now(timezone.utc)

    if pending is not None:
        # The confirming re-check. A part that differs between the two fresh
        # readings and from the baseline changes on its own (a rotating
        # quote, a live counter): it is left out of this comparison and
        # counted as a flicker. It is learned only when it flickers again,
        # so a real change caught half-loaded the first time is delayed by
        # one check, never lost.
        moving = {"rects": [], "sels": []}
        between, _ = watch_detect.compare(pending, cap, settings)
        if between["outcome"] == "changed" and report["outcome"] == "changed":
            moving = watch_detect.unstable(between, onto=report, only=report)
            if moving["rects"] or moving["sels"]:
                report, _ = watch_detect.compare(previous, cap, dict(
                    settings, learned=watch_detect.absorb(settings.get("learned"), moving)))
        watch_store.update_target(target_id, pending_id=None)
        _drop_snapshot(pending_id)
        suspect = pending.get("suspect") or {}
        if report["outcome"] == "same":
            flicker = {"rects": list(suspect.get("rects") or []) + moving["rects"],
                       "sels": list(suspect.get("sels") or []) + moving["sels"]}
            stored = _flapped(target, flicker)
            watch_store.update_target(target_id, settings=stored, fail_count=0, last_check_at=now,
                                      **({"state": "ok"} if target.get("state") in ("error", "blocked", "pending") else {}))
            watch_store.finish_check(check_id, outcome="glitch", snapshot_id=None,
                                     error_detail="Seen once, gone on the re-check: %s" % (suspect.get("headline") or "a change"),
                                     **facts)
            return {"check_id": check_id, "outcome": "glitch", "report": report, "suspected": suspect.get("headline")}
        if moving["rects"] or moving["sels"]:
            target["settings"] = _flapped(target, moving)
            watch_store.update_target(target_id, settings=target["settings"])
        return _record_change(target, check_id, previous, cap, noise, report, facts, settings_of(target))

    if report["outcome"] == "same":
        recovered = {"state": "ok"} if target.get("state") in ("error", "blocked", "pending") else {}
        watch_store.update_target(target_id, fail_count=0, last_check_at=now, **recovered)
        watch_store.finish_check(check_id, outcome="same", **facts)
        return {"check_id": check_id, "outcome": "same", "report": report}

    if not confirm:
        return _record_change(target, check_id, previous, cap, noise, report, facts, settings)

    # Seen once: keep the reading and look again before telling anyone.
    suspect = dict(watch_detect.unstable(report, onto=report), headline=report["headline"])
    sid = _store_reading(target_id, cap, noise, suspect=suspect)
    watch_store.update_target(target_id, pending_id=sid, fail_count=0, last_check_at=now)
    watch_store.finish_check(check_id, outcome="suspected", snapshot_id=sid, error_detail=report["headline"], **facts)
    return {"check_id": check_id, "outcome": "suspected", "snapshot_id": sid, "report": report,
            "confirm_in_s": CONFIRM_DELAY_S}


def _record_change(target, check_id, previous, cap, noise, report, facts, settings):
    """Store the new reading, the evidence and the picture; it becomes the baseline."""
    target_id = target["id"]
    baseline_id = target.get("baseline_id")
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
    # The ignored, learned and flickering areas were drawn on the old
    # baseline; move them to where their content is on the new one.
    moved = {}
    if settings["ignore"]:
        moved["ignore"] = watch_detect.carry(settings["ignore"], report, keep_removed=True)
    stored = dict(target.get("settings") or {})
    learned = stored.get("learned") or {}
    if learned.get("rects"):
        stored["learned"] = dict(learned, rects=watch_detect.carry(learned["rects"], report))
        moved["settings"] = stored
    flaps = stored.get("flaps") or {}
    if flaps.get("rects"):
        carried = []
        for r in flaps["rects"]:
            new = watch_detect.carry([r[:4]], report)
            if new:
                carried.append(new[0] + [r[4]])
        stored["flaps"] = dict(flaps, rects=carried)
        moved["settings"] = stored
    watch_store.update_target(target_id, baseline_id=sid, state="changed", fail_count=0, pending_id=None,
                              last_change_at=now, last_check_at=now, **moved)
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
    out = fix({k: v for k, v in report.items() if not k.startswith("_")})
    json.dumps(out)
    return out
