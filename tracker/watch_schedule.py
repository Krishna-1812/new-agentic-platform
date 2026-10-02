"""Page Watch: when each watch is checked next.

A schedule is a small dict stored on the watch:

    {"every": "hourly"}
    {"every": "6h"}                           every 6 hours from 00:00 India time
    {"every": "daily", "at": "09:00"}         India time (the default)
    {"every": "weekly", "day": "mon", "at": "09:00"}

Times are India Standard Time. India has no daylight saving, so a fixed
UTC+05:30 offset is exact and needs no time-zone database on the server.

Jitter: every watch is offset from the exact minute by a few minutes, fixed
per watch (from its id), so a hundred "daily at 09:00" watches do not all
open a browser at 09:00:00, and one watch keeps the same rhythm every day.

Retries: a failed check is tried again sooner than its schedule (5, then 15
minutes later), but never more often than the schedule itself would.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30), "IST")
EVERY = {"hourly": timedelta(hours=1), "6h": timedelta(hours=6),
         "daily": timedelta(days=1), "weekly": timedelta(days=7)}
LABELS = {"hourly": "Every hour", "6h": "Every 6 hours", "daily": "Daily", "weekly": "Weekly"}
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
DAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
DEFAULT = {"every": "daily", "at": "09:00"}
# The most a watch is moved off its minute. Short schedules get less, so an
# hourly watch still runs within its hour.
JITTER = {"hourly": timedelta(minutes=5), "6h": timedelta(minutes=10),
          "daily": timedelta(minutes=10), "weekly": timedelta(minutes=10)}
# After a failed check, try again this much later (then the next step), but
# never later than the schedule's own next run.
RETRY_STEPS = (timedelta(minutes=5), timedelta(minutes=15))
_AT = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


def normalise(schedule):
    """A clean schedule dict, or ValueError with a sentence the page can show."""
    s = dict(DEFAULT) if not schedule else dict(schedule)
    every = str(s.get("every") or "daily").strip().lower()
    if every not in EVERY:
        raise ValueError("Choose how often to check: every hour, every 6 hours, daily or weekly.")
    out = {"every": every}
    if every in ("daily", "weekly"):
        at = str(s.get("at") or "09:00").strip()
        m = _AT.match(at)
        if not m:
            raise ValueError("The time must look like 09:00 (24-hour, India time).")
        out["at"] = "%02d:%02d" % (int(m.group(1)), int(m.group(2)))
    if every == "weekly":
        day = str(s.get("day") or "mon").strip().lower()[:3]
        if day not in DAYS:
            raise ValueError("Choose a day of the week.")
        out["day"] = day
    return out


def describe(schedule):
    """"Daily at 09:00 IST", for the page and the alerts."""
    s = normalise(schedule)
    if s["every"] == "daily":
        return "Daily at %s IST" % s["at"]
    if s["every"] == "weekly":
        return "Weekly on %s at %s IST" % (DAY_NAMES[DAYS.index(s["day"])], s["at"])
    return LABELS[s["every"]]


def jitter(schedule, key):
    """This watch's fixed offset from its minute (0 .. JITTER)."""
    span = JITTER[normalise(schedule)["every"]]
    h = int(hashlib.sha256(("page-watch:%s" % key).encode()).hexdigest()[:8], 16)
    return timedelta(seconds=h % int(span.total_seconds()))


def _utc(dt):
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def next_run(schedule, after, key=""):
    """The first scheduled time strictly after `after` (UTC), jitter included."""
    s = normalise(schedule)
    after = _utc(after)
    off = jitter(s, key)
    local = after.astimezone(IST)
    every = s["every"]
    if every in ("hourly", "6h"):
        step = EVERY[every]
        day0 = local.replace(hour=0, minute=0, second=0, microsecond=0)
        n = int((local - day0 - off) // step) + 1
        cand = day0 + n * step + off
        while cand <= local:
            cand += step
        return cand.astimezone(timezone.utc)
    hh, mm = (int(x) for x in s["at"].split(":"))
    cand = local.replace(hour=hh, minute=mm, second=0, microsecond=0) + off
    if every == "weekly":
        cand += timedelta(days=(DAYS.index(s["day"]) - cand.weekday()) % 7)
    while cand <= local:
        cand += EVERY[every]
    return cand.astimezone(timezone.utc)


def retry_at(schedule, now, fails, key=""):
    """When to try again after the `fails`-th failure in a row (1 = the first)."""
    now = _utc(now)
    regular = next_run(schedule, now, key)
    if fails <= 0 or fails > len(RETRY_STEPS):
        return regular
    return min(regular, now + RETRY_STEPS[fails - 1])
