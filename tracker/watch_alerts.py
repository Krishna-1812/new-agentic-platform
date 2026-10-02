"""Page Watch: telling people. Slack alerts, the daily digest, the weekly
summary, failure and recovery notices, and the watchdog.

What happens to a recorded change (decide()):
    muted category or noise   recorded, not posted
    important / worth a look  posted straight away, with the before-and-after
                              picture and Useful / Not useful / Mute buttons
    minor                     queued for the next daily digest

A watch that fails twice in a row is posted once ("can't read it, here is
why"), and once more when it reads again. A worker that stops beating is
posted once by the watchdog (called from a scheduled GitHub Action, because
a dead worker cannot report itself).

Slack's rules followed here: messages go through chat.postMessage with a bot
token; text is escaped for mrkdwn (&, <, >); the picture is an image block
whose image_url Slack fetches itself, so it is a signed, expiring link the
app serves without a login (the Google Ads digest charts work the same way);
button clicks arrive at the app's one interactions URL, signed with the
app's signing secret, and are acknowledged within 3 seconds.

Environment:
  WATCH_SLACK_BOT_TOKEN    the bot's token (falls back to GOOGLE_ADS_SLACK_BOT_TOKEN,
                           the same Slack app)
  WATCH_SLACK_CHANNEL      the channel for watches that name none, and for
                           worker and digest notices
  PUBLIC_BASE_URL          the site's address, for links and pictures
  SECRET_KEY               signs the picture links (already set on web)
  WATCH_DIGEST_AT          time of the daily digest, India time (default 09:30)
  WATCH_ALERTS             "off" posts nothing (changes are still recorded)
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
from datetime import datetime, timedelta, timezone

from tracker import watch_schedule, watch_store

log = logging.getLogger(__name__)

IMAGE_DAYS = 30
COLORS = {"important": "#FF6022", "worth_a_look": "#FFB500", "minor": "#DBD7D1", "failure": "#FF3B30",
          "recovered": "#17753F", "watchdog": "#FF3B30"}
LABEL = {"important": "Important", "worth_a_look": "Worth a look", "minor": "Minor"}
IMAGE_PATH = "/api/page-watch/alert-image"
FEEDBACK_ACTIONS = {"pw_fb_useful": "useful", "pw_fb_not_useful": "not_useful", "pw_fb_mute": "mute"}


# ── Settings ─────────────────────────────────────────────────────────────────
def token():
    return (os.environ.get("WATCH_SLACK_BOT_TOKEN") or os.environ.get("GOOGLE_ADS_SLACK_BOT_TOKEN") or "").strip()


def default_channel():
    return (os.environ.get("WATCH_SLACK_CHANNEL") or "").strip().lstrip("#")


def base_url():
    return (os.environ.get("PUBLIC_BASE_URL") or "").strip().rstrip("/")


def channel_for(target):
    return ((target or {}).get("channel") or "").strip().lstrip("#") or default_channel()


def digest_at():
    try:
        return watch_schedule.normalise({"every": "daily", "at": os.environ.get("WATCH_DIGEST_AT") or "09:30"})["at"]
    except ValueError:
        return "09:30"


def switched_on():
    return (os.environ.get("WATCH_ALERTS") or "on").strip().lower() not in ("off", "0", "false", "no")


def ready():
    """(ok, why): can alerts be posted at all."""
    if not switched_on():
        return False, "Alerts are switched off (WATCH_ALERTS=off)."
    if not token():
        return False, "No Slack bot token (WATCH_SLACK_BOT_TOKEN or GOOGLE_ADS_SLACK_BOT_TOKEN)."
    return True, ""


# ── The signed picture link ──────────────────────────────────────────────────
def _key():
    secret = os.environ.get("SECRET_KEY") or ""
    return hashlib.sha256(("page-watch-alert-image\x01" + secret).encode()).digest() if secret else b""


def sign(change_id, day):
    k = _key()
    if not k:
        return ""
    return hmac.new(k, ("%s\x01%s" % (int(change_id), day)).encode(), "sha256").hexdigest()[:40]


def image_url(change_id, day=None):
    day = day or datetime.now(timezone.utc).date().isoformat()
    sig, base = sign(change_id, day), base_url()
    if not (sig and base):
        return ""
    return "%s%s/%d/%s/%s.png" % (base, IMAGE_PATH, int(change_id), day, sig)


def check_image(change_id, day, sig, today=None):
    """True for a link this app signed, at most IMAGE_DAYS old."""
    want = sign(change_id, day)
    if not (want and hmac.compare_digest(want, sig or "")):
        return False
    try:
        age = ((today or datetime.now(timezone.utc).date()) - datetime.strptime(day, "%Y-%m-%d").date()).days
    except ValueError:
        return False
    return -1 <= age <= IMAGE_DAYS


# ── What to do with a change ─────────────────────────────────────────────────
def decide(verdict):
    """"now" | "digest" | "skip", and why."""
    v = verdict or {}
    if v.get("muted"):
        return "skip", "muted"
    if v.get("noise"):
        return "skip", "noise"
    if v.get("importance") in ("important", "worth_a_look"):
        return "now", ""
    return "digest", ""


def esc(s):
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _link(url, text):
    url = str(url or "").replace(">", "%3E").replace("|", "%7C")
    return "<%s|%s>" % (url, esc(text)) if url else esc(text)


def _page(change_id):
    return "%s/strategic-agents/page-watch/changes/%d" % (base_url(), int(change_id)) if base_url() else ""


def _watch_page(target_id):
    return "%s/strategic-agents/page-watch/watches/%d" % (base_url(), int(target_id)) if base_url() else ""


# ── Messages ─────────────────────────────────────────────────────────────────
def change_message(target, change, verdict, *, day=None):
    v = verdict or {}
    imp = v.get("importance") or "worth_a_look"
    name = target.get("name") or target.get("url")
    summary = v.get("summary") or change.get("headline") or "The page changed."
    head = "%s · %s" % (LABEL.get(imp, "Change"), name)
    top = [{"type": "section", "text": {"type": "mrkdwn", "text": "*%s*\n%s" % (esc(head), esc(summary))}}]
    blocks = []
    if v.get("explanation"):
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": esc(v["explanation"])}})
    meta = [_link(target.get("url"), "Open the live page")]
    if v.get("category"):
        meta.insert(0, esc(str(v["category"]).capitalize()))
    if target.get("client"):
        meta.insert(0, esc(target["client"]))
    meta.append("Judged by Claude" if v.get("judged_by") == "claude" else "Rated by rules")
    blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": " · ".join(meta)}]})
    img = image_url(change["id"], day) if change.get("composite_id") else ""
    if img:
        blocks.append({"type": "image", "image_url": img, "alt_text": "Before and after, with the changes boxed"})
    actions = []
    page = _page(change["id"])
    if page:
        actions.append({"type": "button", "text": {"type": "plain_text", "text": "See the change"}, "url": page,
                        "action_id": "pw_open", "style": "primary"})
    for action_id, label in (("pw_fb_useful", "Useful"), ("pw_fb_not_useful", "Not useful"), ("pw_fb_mute", "Mute this kind")):
        actions.append({"type": "button", "text": {"type": "plain_text", "text": label}, "action_id": action_id,
                        "value": str(change["id"])})
    blocks.append({"type": "actions", "block_id": "pw_change_%d" % change["id"], "elements": actions})
    return {"text": "%s: %s" % (head, summary)[:300], "blocks": top,
            "attachments": [{"color": COLORS.get(imp, COLORS["worth_a_look"]), "blocks": blocks}]}


def failure_message(target, outcome, detail):
    name = target.get("name") or target.get("url")
    why = "The site shows a bot check instead of the page." if outcome == "blocked" else (detail or "It could not be read.")
    text = "*Can't read %s*\n%s It failed twice in a row; this is the only message until it reads again." % (
        esc(name), esc(why))
    top = [{"type": "section", "text": {"type": "mrkdwn", "text": text}}]
    blocks = [{"type": "context", "elements": [{"type": "mrkdwn", "text": _link(target.get("url"), target.get("url"))}]}]
    page = _watch_page(target["id"])
    if page:
        blocks.append({"type": "actions", "elements": [{"type": "button", "text": {"type": "plain_text", "text": "Open the watch"},
                                                        "url": page, "action_id": "pw_open"}]})
    return {"text": "Can't read %s" % name, "blocks": top, "attachments": [{"color": COLORS["failure"], "blocks": blocks}]}


def recovered_message(target):
    name = target.get("name") or target.get("url")
    blocks = [{"type": "section", "text": {"type": "mrkdwn", "text": "*%s reads again.* Checks are back to normal." % esc(name)}}]
    return {"text": "%s reads again" % name, "blocks": blocks}


def digest_message(items, day_label):
    lines = []
    for it in items[:40]:
        c, t = it["change"], it["target"]
        v = c.get("verdict") or {}
        lines.append("• *%s*: %s %s" % (esc(t.get("name") or t.get("url")), esc(v.get("summary") or c.get("headline")),
                                             _link(_page(c["id"]), "(see it)") if _page(c["id"]) else ""))
    more = len(items) - 40
    if more > 0:
        lines.append("_and %d more on the Page Watch page_" % more)
    text = "*Minor page changes, %s* (%d)\n%s" % (esc(day_label), len(items), "\n".join(lines))
    return {"text": "Minor page changes, %s (%d)" % (day_label, len(items)),
            "blocks": [{"type": "section", "text": {"type": "mrkdwn", "text": text[:2990]}}]}


def weekly_message(items, since_label):
    by = {"important": 0, "worth_a_look": 0, "minor": 0}
    watches = {}
    for it in items:
        imp = (it["change"].get("verdict") or {}).get("importance") or "minor"
        by[imp] = by.get(imp, 0) + 1
        watches.setdefault(it["target"].get("name") or it["target"].get("url"), 0)
        watches[it["target"].get("name") or it["target"].get("url")] += 1
    top = sorted(watches.items(), key=lambda kv: -kv[1])[:8]
    lines = ["*Page Watch, the week since %s*" % esc(since_label),
             "%d changes: %d important, %d worth a look, %d minor." % (len(items), by["important"], by["worth_a_look"], by["minor"])]
    if top:
        lines.append("Most active: " + ", ".join("%s (%d)" % (esc(n), k) for n, k in top))
    imp = [it for it in items if (it["change"].get("verdict") or {}).get("importance") == "important"][:10]
    for it in imp:
        c = it["change"]
        lines.append("• %s: %s" % (esc(it["target"].get("name")), esc((c.get("verdict") or {}).get("summary") or c.get("headline"))))
    return {"text": "Page Watch weekly summary", "blocks": [{"type": "section", "text": {"type": "mrkdwn", "text": "\n".join(lines)[:2990]}}]}


def watchdog_message(health):
    q = health.get("queue") or {}
    why = {"no_worker": "The checker has not reported in for over 3 minutes, so no pages are being checked.",
           "behind": "The checker is running, but %d checks are more than 15 minutes late." % (q.get("late") or 0),
           "no_browser": "The checker is running without a browser, so pages are read as text only."}.get(
        health.get("status"), "The checker needs attention.")
    text = "*Page Watch needs attention.* %s %d pages are being watched." % (why, q.get("active") or 0)
    return {"text": "Page Watch needs attention", "blocks": [{"type": "section", "text": {"type": "mrkdwn", "text": text}}],
            "attachments": [{"color": COLORS["watchdog"], "blocks": [{"type": "context", "elements": [
                {"type": "mrkdwn", "text": "Railway → page-watch-worker → Deployments and Logs. Health: %s" % esc(
                    (base_url() or "") + "/strategic-agents/page-watch/health")}]}]}]}


# ── Posting ──────────────────────────────────────────────────────────────────
def post(channel, msg, session=None):
    """(ok, error, ts). Never raises; the error is Slack's own code."""
    from tracker import gads_digest
    ok, why = ready()
    if not ok:
        return False, "not_configured", ""
    if not channel:
        return False, "no_channel", ""
    return gads_digest.post(token(), channel, msg, session=session)


def alert_change(target, change_id, verdict, *, session=None, now=None):
    """Post or queue one recorded change. Returns the alert dict stored on it."""
    now = now or datetime.now(timezone.utc)
    change = watch_store.get_change(change_id)
    if not change:
        return None
    what, why = decide(verdict)
    channel = channel_for(target)
    if what == "skip":
        alert = {"state": "skipped", "reason": why}
    elif what == "digest":
        alert = {"state": "queued", "channel": channel, "queued_at": now.isoformat()}
    elif not ready()[0] or not channel:
        alert = {"state": "unsent", "reason": "not_configured" if not ready()[0] else "no_channel"}
    else:
        ok, err, ts = post(channel, change_message(target, change, verdict, day=now.date().isoformat()), session=session)
        alert = ({"state": "sent", "channel": channel, "ts": ts, "sent_at": now.isoformat()} if ok
                 else {"state": "failed", "channel": channel, "error": err, "at": now.isoformat()})
        if not ok:
            log.warning("page watch: alert for change %s not posted: %s", change_id, err)
    watch_store.update_change(change_id, alert=alert)
    return alert


def alert_failure(target, outcome, detail, *, session=None):
    """The one message when a watch starts failing."""
    channel = channel_for(target)
    if not (ready()[0] and channel):
        return False
    ok, err, _ = post(channel, failure_message(target, outcome, detail), session=session)
    if not ok:
        log.warning("page watch: failure notice for watch %s not posted: %s", target.get("id"), err)
    return ok


def alert_recovered(target, *, session=None):
    channel = channel_for(target)
    if not (ready()[0] and channel):
        return False
    return post(channel, recovered_message(target), session=session)[0]


# ── The digest, the weekly summary and the watchdog ──────────────────────────
def digest_due(now=None):
    """True once a day, at WATCH_DIGEST_AT India time or later."""
    now = (now or datetime.now(timezone.utc)).astimezone(watch_schedule.IST)
    hh, mm = (int(x) for x in digest_at().split(":"))
    return (now.hour, now.minute) >= (hh, mm)


def run_digest(now=None, session=None):
    """Post the day's digest (once a day, by whichever worker gets there
    first). Returns {"posted": n_messages, "changes": n} or None when not due."""
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(watch_schedule.IST).date().isoformat()
    if not digest_due(now) or not watch_store.claim_meta("digest_day", today, unless=today):
        return None
    out = {"posted": 0, "changes": 0, "weekly": False}
    items = watch_store.queued_alerts()
    by_channel = {}
    for it in items:
        ch = (it["change"].get("alert") or {}).get("channel") or channel_for(it["target"])
        by_channel.setdefault(ch, []).append(it)
    label = now.astimezone(watch_schedule.IST).strftime("%a %d %b")
    for ch, group in by_channel.items():
        if not ch or not ready()[0]:
            continue
        ok, err, _ = post(ch, digest_message(group, label), session=session)
        state = {"state": "digested", "channel": ch, "at": now.isoformat()} if ok else \
            {"state": "queued", "channel": ch, "error": err}
        for it in group:
            watch_store.update_change(it["change"]["id"], alert=dict(it["change"].get("alert") or {}, **state))
        if ok:
            out["posted"] += 1
            out["changes"] += len(group)
    # Mondays: the week, in the default channel.
    if now.astimezone(watch_schedule.IST).weekday() == 0 and default_channel() and ready()[0]:
        since = now - timedelta(days=7)
        week = watch_store.changes_between(since, now)
        if week:
            out["weekly"] = post(default_channel(), weekly_message(
                week, since.astimezone(watch_schedule.IST).strftime("%a %d %b")), session=session)[0]
    return out


def watchdog(health, session=None):
    """Post once when the checker stops (or falls behind); clear when it is
    healthy again. Returns "alerted" | "already" | "ok" | "quiet" | "unconfigured"."""
    status = health.get("status")
    active = (health.get("queue") or {}).get("active") or 0
    bad = status in ("no_worker", "behind", "no_browser") and active > 0
    if not bad:
        if watch_store.get_meta("watchdog") not in (None, "ok"):
            watch_store.set_meta("watchdog", "ok")
        return "ok" if active else "quiet"
    if not (ready()[0] and default_channel()):
        return "unconfigured"
    if not watch_store.claim_meta("watchdog", status, unless=status):
        return "already"
    ok, err, _ = post(default_channel(), watchdog_message(health), session=session)
    if not ok:
        watch_store.set_meta("watchdog", "ok")          # try again next time
        log.warning("page watch: watchdog notice not posted: %s", err)
    return "alerted" if ok else "failed"
