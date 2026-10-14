"""Social Media Intelligence: what a run costs, recorded and capped.

A run makes a few hundred paid calls (Claude reading each image and video frame, Whisper hearing each
video, Apify scraping, a web-searching identify step, the final report). Until now none of it was written
down, so the admin panel could not show what the agent costs and nothing could stop a run that kept
spending.

    begin(run_id)            called once by the job thread. From then on every paid call made on that
                             thread (and on the platform threads it starts) reports into this run.
    record(...) / claude()   what each paid call calls after it is made. Outside a run they do nothing,
                             so the same modules still work for the free self-tests and the probes.
    over_cap()               true once the run has spent its cap. The steps that fan out into many paid
                             calls (scraping a platform, reading a post) ask before each one and stop.
                             Identify and the final report are small and fixed, so they are never refused,
                             only recorded.

The cap is SCI_RUN_CAP_USD (default $5; 0 or a negative number means no cap). Every call is written to
sci_spend_log, which the admin panel reads (tracker/admin_spend.py) and the report header shows to admins.
Nothing here raises: recording a cost must never be the reason a run fails.
"""
from __future__ import annotations

import contextlib
import contextvars
import logging
import os
import threading

logger = logging.getLogger(__name__)

DEFAULT_CAP_USD = 5.0

# Whisper bills by the minute. Audio is cut to two minutes (sci_audio), and the exact length of what was
# sent is not known after the cut, so it is estimated from the bytes: mono 16 kHz mp3 is about 4 KB a second.
WHISPER_USD_PER_MIN = 0.006
_MP3_BYTES_PER_SEC = 4000

_RUN: contextvars.ContextVar = contextvars.ContextVar("sci_run_spend", default=None)
_PLATFORM: contextvars.ContextVar = contextvars.ContextVar("sci_run_platform", default=None)


def cap_usd():
    """The per-run cap in dollars, or None for no cap."""
    raw = (os.environ.get("SCI_RUN_CAP_USD") or "").strip()
    if not raw:
        return DEFAULT_CAP_USD
    try:
        value = float(raw)
    except ValueError:
        logger.warning("sci_spend: SCI_RUN_CAP_USD=%r is not a number; using $%.2f", raw, DEFAULT_CAP_USD)
        return DEFAULT_CAP_USD
    return value if value > 0 else None


class RunSpend:
    """One run's running total. Shared by the job thread and its platform threads."""

    def __init__(self, run_id, cap):
        self.run_id, self.cap, self.spent = run_id, cap, 0.0
        self._token = None
        self._lock = threading.Lock()

    def add(self, vendor, operation, usd, units=None, platform=None):
        usd = float(usd or 0)
        if usd <= 0:
            return
        with self._lock:
            self.spent += usd
        try:
            from tracker import sci_store
            sci_store.log_spend(self.run_id, platform or _PLATFORM.get(), vendor, operation, units, usd)
        except Exception:
            logger.exception("sci_spend: could not write a cost for run %s", self.run_id)

    def over(self):
        return self.cap is not None and self.spent >= self.cap


def begin(run_id, cap=None):
    """Start counting for this run on this thread. Returns the RunSpend."""
    rs = RunSpend(run_id, cap_usd() if cap is None else (cap if cap > 0 else None))
    rs._token = _RUN.set(rs)
    return rs


def end(rs):
    """Stop counting on this thread. The job calls it when it finishes, so a run never leaves its spend
    attached to a thread that goes on to do something else (a test, a pooled worker)."""
    token = getattr(rs, "_token", None)
    if token is not None:
        try:
            _RUN.reset(token)
        except ValueError:          # begun in another context: nothing to undo here
            pass
        rs._token = None


def current():
    return _RUN.get()


@contextlib.contextmanager
def platform(name):
    """Calls made inside are logged against this platform."""
    token = _PLATFORM.set(name)
    try:
        yield
    finally:
        _PLATFORM.reset(token)


def record(vendor, operation, usd, units=None):
    rs = _RUN.get()
    if rs is not None:
        rs.add(vendor, operation, usd, units)


def over_cap():
    rs = _RUN.get()
    return bool(rs and rs.over())


def spent():
    rs = _RUN.get()
    return rs.spent if rs else 0.0


def cap():
    rs = _RUN.get()
    return rs.cap if rs else None


def usage_dict(usage):
    """An Anthropic usage object (or dict) as the plain dict tracker/watch_judge.cost_usd reads."""
    if usage is None:
        return {}
    if isinstance(usage, dict):
        return usage
    dump = getattr(usage, "model_dump", None)
    if callable(dump):
        try:
            return dump()
        except Exception:
            pass
    return {k: getattr(usage, k, 0) or 0 for k in ("input_tokens", "output_tokens", "cache_read_input_tokens",
                                                    "cache_creation_input_tokens")}


def claude(operation, resp, model=None, searches=None):
    """Record one Claude reply's cost. `searches` defaults to the web searches its usage reports."""
    if _RUN.get() is None or resp is None:
        return
    try:
        from tracker import watch_judge
        usage = getattr(resp, "usage", None)
        if searches is None:
            tool = getattr(usage, "server_tool_use", None)
            searches = (tool.get("web_search_requests") if isinstance(tool, dict)
                        else getattr(tool, "web_search_requests", 0)) or 0
        model = model or os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")
        record("anthropic", operation, watch_judge.cost_usd(model, usage_dict(usage), searches=int(searches)),
               units=(usage_dict(usage).get("input_tokens") or 0) + (usage_dict(usage).get("output_tokens") or 0))
    except Exception:
        logger.exception("sci_spend: could not price a Claude reply")


def whisper(audio_bytes):
    """Record one Whisper call, estimated from the size of the audio sent."""
    if _RUN.get() is None:
        return
    seconds = min(120.0, max(1.0, len(audio_bytes or b"") / _MP3_BYTES_PER_SEC))
    record("openai", "transcribe", seconds / 60.0 * WHISPER_USD_PER_MIN, units=round(seconds, 1))


def apify(run, actor_id=""):
    """Record an Apify actor run's own reported cost (usageTotalUsd on the run)."""
    if _RUN.get() is None or not isinstance(run, dict):
        return
    try:
        usd = float(run.get("usageTotalUsd") or 0)
    except (TypeError, ValueError):
        return
    record("apify", (actor_id or run.get("actId") or "actor")[:30], usd, units=None)


def cap_note(platform_name=None):
    """The sentence shown where work was skipped for the cap."""
    rs = _RUN.get()
    amount = ("$%.2f" % rs.cap) if rs and rs.cap else "its cost cap"
    return "Stopped at this run's cost cap (%s), so %s was not read." % (
        amount, "the rest of this platform" if platform_name else "the rest")
