"""Video Studio: the optional Slack message when a video is ready (or failed).

Sent by the worker when a version's render finishes, or when making a
video fails, to the Slack channel chosen for the video's client (saved with
the client's brand, on the brands page), else to VIDEO_SLACK_CHANNEL. With no
channel, or no bot token, nothing is sent: the video waits in the library as
always. Plans are not announced; the person is usually watching that page.

It uses Page Watch's Slack app (the same bot token) and its poster, so the
rules are the same: chat.postMessage, mrkdwn escaped, never raises.

Environment:
  VIDEO_SLACK_CHANNEL   the channel for clients without their own (optional)
  VIDEO_SLACK           "off" sends nothing
  PUBLIC_BASE_URL       the site's address, for the link
  WATCH_SLACK_BOT_TOKEN / GOOGLE_ADS_SLACK_BOT_TOKEN   the bot's token
"""

from __future__ import annotations

import logging
import os
import re

from tracker import video_config as cfg
from tracker import video_store, watch_alerts

log = logging.getLogger("video_studio.notify")

BASE = "/strategic-agents/video-studio"
CHANNEL = re.compile(r"^#?[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")


def switched_on():
    return (os.environ.get("VIDEO_SLACK") or "on").strip().lower() not in ("off", "0", "false", "no")


def clean_channel(value):
    """A channel name or id as typed ("#video", "C0123ABC"), or "" when unusable."""
    v = str(value or "").strip()
    return v.lstrip("#") if v and CHANNEL.match(v) else ""


def channel_for(email, client):
    saved = video_store.get_brand(email, client) if client else None
    own = clean_channel(((saved or {}).get("brand") or {}).get("slack_channel"))
    return own or clean_channel(os.environ.get("VIDEO_SLACK_CHANNEL"))


def _esc(text):
    return str(text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def message(project, version, ok):
    brief = " ".join(str(project.get("brief") or "").split())
    brief = brief if len(brief) <= 160 else brief[:159] + "…"
    link = "%s%s/videos/%d?v=%d" % (watch_alerts.base_url(), BASE, project["id"], version["id"])
    shape = cfg.SHAPE_LABELS.get(version.get("shape"), "")
    secs = ("%.0f s" % float(version.get("duration_s") or 0)) if version.get("duration_s") else ""
    head = "Video ready" if ok else "A video could not be made"
    who = ("%s · " % _esc(project["client"])) if project.get("client") else ""
    detail = " · ".join(x for x in (shape, secs, "version %d" % version["number"]) if x)
    lines = ["*%s*: %s" % (head, _esc(brief)), "%s%s" % (who, detail)]
    if not ok and version.get("error"):
        from tracker import video_app
        lines.append(_esc(video_app.public_error(version["error"]))[:300])
    text = "\n".join(lines)
    blocks = [{"type": "section", "text": {"type": "mrkdwn", "text": text}}]
    if watch_alerts.base_url():
        blocks.append({"type": "actions", "elements": [{
            "type": "button", "text": {"type": "plain_text", "text": "Open the video" if ok else "See why"},
            "url": link}]})
    return {"text": "%s: %s" % (head, brief), "blocks": blocks}


def version_finished(version_id, ok, *, session=None):
    """Tell the client's channel a video is ready or failed. Returns (sent, why)."""
    if not switched_on():
        return False, "off"
    v = video_store.get_version(version_id)
    p = video_store.get_project(v["project_id"]) if v else None
    if not p or p["kind"] in ("engine_test", "plan_test", "drill"):
        return False, "not_a_person's_video"
    channel = channel_for(p["email"], p.get("client"))
    if not channel:
        return False, "no_channel"
    tok = watch_alerts.token()
    if not tok:
        return False, "no_token"
    from tracker import gads_digest
    sent, err, _ = gads_digest.post(tok, channel, message(p, v, ok), session=session)
    if not sent:
        log.warning("video %s: Slack message not sent: %s", version_id, err)
    return sent, err
