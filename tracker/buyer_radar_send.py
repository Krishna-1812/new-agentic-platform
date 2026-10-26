"""Lead Finder: writing to a lead (email, LinkedIn), finding their email, and posting leads to Slack.

Every send, from the page or automatic, goes through the same checks first (can_send):

  * BUYER_RADAR_SEND=off on the service stops every send at once;
  * nobody who opted out (br_suppress) is written to, from any workspace;
  * nobody is written to twice on the same channel, from any workspace;
  * the automatic send keeps to the workspace's daily caps, and LinkedIn to LINKEDIN_DAY_MAX a day
    for the one connected LinkedIn account, whoever sends (Unipile recommends 80 to 100 invitations a
    day for a paid account, developer.unipile.com/docs/provider-limits-and-restrictions).

Email goes through the platform's Gmail sender (tracker/market_radar_deliver.send_email). Every email
carries a one-click opt-out link (List-Unsubscribe, RFC 8058) and the workspace's postal address.
LinkedIn goes through Unipile from the connected LinkedIn account: a message when the person is a
first-degree connection, else a connection request with the note.
"""
from __future__ import annotations

import html
import logging
import os
import time

from . import buyer_radar_source as src

log = logging.getLogger(__name__)
LINKEDIN_DAY_MAX = 60
EMAIL_DAY_MAX = 150
OPTOUT_SALT = "buyer-radar-optout"


def sending_off():
    return (os.environ.get("BUYER_RADAR_SEND") or "").strip().lower() in ("off", "0", "false", "no")


def base_url():
    from . import watch_alerts
    return (watch_alerts.base_url() or "").rstrip("/")


# == opting out ==========================================================================================

def _serializer():
    from itsdangerous import URLSafeSerializer
    return URLSafeSerializer(os.environ.get("SECRET_KEY") or os.environ.get("FLASK_SECRET_KEY") or "dev", salt=OPTOUT_SALT)


def optout_token(address):
    return _serializer().dumps((address or "").strip().lower())


def optout_address(token):
    from itsdangerous import BadSignature
    try:
        got = _serializer().loads(token)
    except BadSignature:
        return None
    return got if isinstance(got, str) and "@" in got else None


def optout_url(address):
    return "%s/buyer-radar/opt-out/%s" % (base_url(), optout_token(address))


# == the checks =========================================================================================

def can_send(owner, lead, channel, settings, *, auto, store=None):
    """None when this lead may be written to on this channel now, else (why, stop): `stop` means no
    further sends on this channel will go through either (a cap reached, sending switched off)."""
    from . import buyer_radar_store
    store = store or buyer_radar_store
    if sending_off():
        return "sending is switched off on this service (BUYER_RADAR_SEND)", True
    if not lead.get("draft"):
        return "there is no message written for this lead yet", False
    person = lead.get("person") or ""
    to = (lead.get("email") or "").lower() if channel == "email" else person
    if not to:
        return ("no email address is known for this person" if channel == "email"
                else "the post's author has no LinkedIn profile to write to"), False
    if channel == "linkedin" and not person.startswith("in/"):
        return "the post is from a company page; LinkedIn messages go to people", False
    if store.suppressed(to, person):
        return "this person asked not to be contacted", False
    if store.already_contacted(channel, person=person, recipient=to):
        return "this person has already been contacted on %s" % ("email" if channel == "email" else "LinkedIn"), False
    if channel == "linkedin" and store.sent_today_all("linkedin") >= LINKEDIN_DAY_MAX:
        return "the LinkedIn account has sent %d today, LinkedIn's safe limit" % LINKEDIN_DAY_MAX, True
    if channel == "email" and store.sent_today_all("email") >= EMAIL_DAY_MAX:
        return "%d emails have gone out today, the most allowed" % EMAIL_DAY_MAX, True
    if auto:
        cap = settings["daily_email_cap"] if channel == "email" else settings["daily_linkedin_cap"]
        if store.sent_today(owner, channel) >= cap:
            return "today's automatic limit of %d is reached" % cap, True
    return None


# == email ==============================================================================================

def email_parts(lead, settings, address):
    """(subject, text, html, headers): the draft, the signature, the opt-out line and the address."""
    from . import buyer_radar as br
    d = lead["draft"] or {}
    sender = (settings.get("senders") or {}).get(lead["offer"]) or {}
    offer = br.OFFERS.get(lead["offer"], {})
    sig = "\n".join(x for x in (sender.get("name"), sender.get("title"),
                                offer.get("label"), offer.get("site")) if x)
    url = optout_url(address)
    foot = "If this is not useful, you can opt out here and you will not hear from us again: %s" % url
    if settings.get("postal_address"):
        foot += "\n%s" % settings["postal_address"]
    text = "%s\n\n%s\n\n--\n%s" % (d.get("email", "").strip(), sig, foot)
    body = "".join("<p>%s</p>" % html.escape(p).replace("\n", "<br>") for p in d.get("email", "").strip().split("\n\n"))
    page = ('<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#121213">%s'
            '<p>%s</p><p style="font-size:12px;color:#6b6b6b">If this is not useful, '
            '<a href="%s">opt out here</a> and you will not hear from us again.%s</p></div>') % (
        body, html.escape(sig).replace("\n", "<br>"), html.escape(url),
        ("<br>" + html.escape(settings["postal_address"])) if settings.get("postal_address") else "")
    headers = {"List-Unsubscribe": "<%s>" % url, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}
    if sender.get("email"):
        headers["Reply-To"] = sender["email"]
    return (d.get("subject") or "Your post on LinkedIn"), text, page, headers


def email_lead(owner, lead, settings, *, by="", auto=False, deliver=None, store=None):
    """{"ok", "detail", "stop"}. Records the send, sent or failed."""
    from . import buyer_radar_store, market_radar_deliver
    store = store or buyer_radar_store
    if not lead:
        return {"ok": False, "detail": "no such lead", "stop": False}
    refused = can_send(owner, lead, "email", settings, auto=auto, store=store)
    if refused:
        return {"ok": False, "detail": refused[0], "stop": refused[1]}
    to = lead["email"].strip()
    subject, text, page, headers = email_parts(lead, settings, to)
    sender = (settings.get("senders") or {}).get(lead["offer"]) or {}
    deliver = deliver or market_radar_deliver.send_email
    got = market_radar_deliver.attempt(lambda: deliver(subject, text, page, [to], sender=sender.get("email") or None,
                                                       headers=headers, from_name=sender.get("name") or None))
    ok = got["status"] == "sent"
    store.record_send(owner, lead["id"], "email", to, lead.get("person"), "sent" if ok else "failed",
                      got.get("error") or "", by)
    if not ok:
        return {"ok": False, "detail": got.get("error") or "the email was not sent",
                "stop": got["status"] == "not_configured"}
    return {"ok": True, "detail": "emailed %s" % to, "stop": False}


# == LinkedIn ===========================================================================================

def linkedin_lead(owner, lead, settings, *, by="", auto=False, client=None, store=None):
    """A message to a first-degree connection, else a connection request with the note. {"ok", "detail",
    "stop", "kind"}."""
    from . import buyer_radar_store, unipile_client
    store = store or buyer_radar_store
    client = client or unipile_client
    if not lead:
        return {"ok": False, "detail": "no such lead", "stop": False}
    refused = can_send(owner, lead, "linkedin", settings, auto=auto, store=store)
    if refused:
        return {"ok": False, "detail": refused[0], "stop": refused[1]}
    account, err = client.linkedin_account_id()
    if err:
        return {"ok": False, "detail": client.describe_error(err) or "No LinkedIn account is connected to Unipile.",
                "stop": True}
    author = (lead.get("post") or {}).get("author") or {}
    if lead["person"] == author.get("key"):
        # a commenter's link carries LinkedIn's own id, whose case matters; the comment gives it as it is
        ident = author.get("provider_id") or src.public_id(author.get("url")) or lead["person"].split("/", 1)[1]
    else:
        # a company's decision maker, whose LinkedIn profile came with their email
        ident = lead["person"].split("/", 1)[1]
    profile, err = client.get_user_profile(ident, account)
    if err:
        store.record_send(owner, lead["id"], "linkedin", lead["person"], lead["person"], "failed",
                          client.describe_error(err), by)
        return {"ok": False, "detail": client.describe_error(err), "stop": (err or {}).get("status") == 429}
    d = lead["draft"] or {}
    first_degree = str(profile.get("network_distance") or "").upper() in ("FIRST_DEGREE", "DISTANCE_1", "1")
    if first_degree:
        kind, (got, err) = "message", client.start_chat(account, profile["provider_id"], d.get("message") or d.get("note"))
    else:
        kind, (got, err) = "invitation", client.send_invitation(account, profile["provider_id"], d.get("note") or None)
    detail = client.describe_error(err) if err else ("sent a message" if kind == "message" else "sent a connection request")
    store.record_send(owner, lead["id"], "linkedin", lead["person"], lead["person"], "failed" if err else "sent",
                      detail, by)
    if err:
        return {"ok": False, "detail": detail, "stop": (err or {}).get("status") == 429, "kind": kind}
    return {"ok": True, "detail": detail, "stop": False, "kind": kind}


# == a Saleshandy sequence ==============================================================================

def _names(lead):
    """(first, last, title, company) of the person written to: a company's decision maker, else the author."""
    p = lead.get("post") or {}
    a = p.get("author") or {}
    pick = next((c for c in p.get("contacts") or [] if c.get("key") == lead.get("person")
                 or (c.get("linkedin") and src.profile_key(c["linkedin"]) == lead.get("person"))), None)
    name = (pick or {}).get("name") or ("" if a.get("company") else a.get("name")) or ""
    first, _, last = name.strip().partition(" ")
    company = (p.get("company") or {}).get("name") or (lead.get("verdict") or {}).get("company") or ""
    title = (pick or {}).get("title") or ("" if a.get("company") else (a.get("headline") or "").split(" at ")[0])
    return first, last.strip(), title[:120], company[:160]


def sequence_lead(owner, lead, settings, *, by="", auto=False, client=None, store=None, reveal=None):
    """The lead added to their offer's Saleshandy sequence, which sends and follows up on its own schedule.
    Counted as an email: the same opt-outs, the same nobody-twice and the same daily caps. With an email
    address the prospect is imported with it (and, where Settings names a field, the message written);
    with only Saleshandy's id the person is added as a lead, which Saleshandy reveals itself (a credit).
    `reveal` allows that: the team's yes on the page, or "Find work emails" for the automatic send.
    {"ok", "detail", "stop"}."""
    from . import buyer_radar as br, buyer_radar_store, saleshandy_client as sh
    store = store or buyer_radar_store
    if not lead:
        return {"ok": False, "detail": "no such lead", "stop": False}
    if lead.get("source") == "reddit":
        return {"ok": False, "detail": "a Reddit thread is answered in the thread, not by email", "stop": False}
    seq = (settings.get("sequences") or {}).get(lead["offer"]) or {}
    if not seq.get("step_id"):
        return {"ok": False, "detail": "no Saleshandy sequence is chosen for %s in Settings" %
                br.OFFERS.get(lead["offer"], {}).get("label", lead["offer"]), "stop": False}
    if sending_off():
        return {"ok": False, "detail": "sending is switched off on this service (BUYER_RADAR_SEND)", "stop": True}
    person, email = lead.get("person") or "", (lead.get("email") or "").strip().lower()
    reveal = auto and settings.get("find_emails") if reveal is None else reveal
    if not email and not (person.startswith("sh/") and reveal):
        return {"ok": False, "detail": "no email address is known for this person yet", "stop": False}
    if store.suppressed(email, person):
        return {"ok": False, "detail": "this person asked not to be contacted", "stop": False}
    if store.already_contacted("email", person=person, recipient=email):
        return {"ok": False, "detail": "this person has already been contacted by email", "stop": False}
    if auto and store.sent_today(owner, "email") >= settings["daily_email_cap"]:
        return {"ok": False, "detail": "today's automatic limit of %d is reached" % settings["daily_email_cap"], "stop": True}
    if not sh.configured():
        return {"ok": False, "detail": "Saleshandy needs SALESHANDY_API_KEY on this service", "stop": True}
    client = client or sh.Client()
    tags = ["Lead Finder", br.OFFERS.get(lead["offer"], {}).get("label", lead["offer"])]
    title = seq.get("title") or "the sequence"
    try:
        if email:
            first, last, job, company = _names(lead)
            row = {"First Name": first, "Last Name": last, "Email": email, "Company": company, "Job Title": job}
            if settings.get("sequence_field") and (lead.get("draft") or {}).get("email"):
                row[settings["sequence_field"]] = lead["draft"]["email"].strip()
            client.import_to_sequence(seq["step_id"], [row], tags=tags)
        else:
            client.add_leads_to_sequence(seq["id"], seq["step_id"], [person.split("/", 1)[1]], tags=tags)
    except sh.SaleshandyError as e:
        store.record_send(owner, lead["id"], "email", email or person, person, "failed", "Saleshandy: %s" % e, by)
        return {"ok": False, "detail": "Saleshandy did not add them: %s" % e,
                "stop": isinstance(e, (sh.AuthError, sh.RateLimited))}
    detail = "added to the Saleshandy sequence “%s”" % title
    store.record_send(owner, lead["id"], "email", email or person, person, "sent", detail, by)
    return {"ok": True, "detail": detail, "stop": False}


# == finding an email ===================================================================================

def find_emails(leads, *, client=None, wait_s=180):
    """Work emails through Saleshandy (one credit per email found, about $0.026): by LinkedIn profile for
    people found by their post or comment ("in/..."), and by Saleshandy's own id for the decision makers
    its search named at a hiring company ("sh/<id>"), whose LinkedIn profile comes back with the email.
    ({lead id: email, or {"email", "linkedin"} for a decision maker}, credits charged, note)."""
    from . import saleshandy_client as sh
    if not sh.configured():
        return {}, 0, "Finding emails needs SALESHANDY_API_KEY on this service."
    client = client or sh.Client()
    by_key = {lead["person"]: lead for lead in leads if lead.get("person", "").startswith("in/")}
    by_id = {lead["person"].split("/", 1)[1]: lead for lead in leads if lead.get("person", "").startswith("sh/")}
    if not by_key and not by_id:
        return {}, 0, None
    found, credits = {}, 0.0
    for kind, keys in (("linkedin_urls", list(by_key)[:sh.MAX_ENRICH]), ("lead_ids", list(by_id)[:sh.MAX_ENRICH])):
        if not keys:
            continue
        ask = ["https://www.linkedin.com/%s" % k for k in keys] if kind == "linkedin_urls" else keys
        try:
            res = client.wait(client.enrich_contacts(**{kind: ask}), timeout=wait_s)
        except sh.SaleshandyError as e:
            return found, credits, "Saleshandy could not find emails: %s" % e
        got = 0
        for r in (sh.enriched(x) for x in res.get("records") or []):
            if not r.get("email") or r.get("email_status") in ("invalid",):
                continue
            if kind == "linkedin_urls":
                lead = by_key.get(src.profile_key(r.get("linkedin")))
                if lead:
                    found[lead["id"]] = r["email"]
                    got += 1
            else:
                lead = by_id.get(str(r.get("lead_id") or ""))
                if lead:
                    found[lead["id"]] = {"email": r["email"], "linkedin": r.get("linkedin") or ""}
                    got += 1
        try:
            credits += float(res["credits"]) if res.get("credits") is not None else float(got)
        except (TypeError, ValueError):
            credits += float(got)
    return found, credits, None


# == Slack ==============================================================================================

def slack_token():
    return (os.environ.get("BUYER_RADAR_SLACK_BOT_TOKEN") or os.environ.get("GOOGLE_ADS_SLACK_BOT_TOKEN")
            or os.environ.get("SLACK_BOT_TOKEN") or "")


SLACK_KIND = {"post": "Post", "comment": "Comment", "jobs": "Hiring", "icp": "Customer profile", "rfp": "RFP",
              "reddit": "Reddit"}
SLACK_LINK = {"jobs": "Open the company", "comment": "Open the post they commented on", "rfp": "Open the RFP",
              "reddit": "Open the thread"}


def _ago(iso, now=None):
    """\"today\", \"2 days ago\"... for a post's date; "" when it has none."""
    from datetime import datetime, timezone
    if not iso:
        return ""
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return ""
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    days = ((now or datetime.now(timezone.utc)) - d).days
    if days < 0:
        return ""
    return "today" if days == 0 else "yesterday" if days == 1 else "%d days ago" % days if days < 60 else d.strftime("%d %b %Y")


def _slack_details(lead, kind):
    """The facts that decide whether to act, on one line: company, place, deadline, how fresh, and what
    can be done now (an email address is known, a Reddit thread is answered in the thread)."""
    from . import watch_alerts
    esc = watch_alerts.esc
    p, v = lead.get("post") or {}, lead.get("verdict") or {}
    a = p.get("author") or {}
    company = v.get("company") or (p.get("company") or {}).get("name") or (a.get("name") if a.get("company") else "")
    bits = []
    if company and company != a.get("name"):
        bits.append("🏢 " + esc(company[:60]))
    if v.get("region"):
        bits.append("📍 " + esc(str(v["region"])[:40]))
    if v.get("deadline"):
        bits.append("⏰ due " + esc(str(v["deadline"])[:30]))
    ago = _ago(p.get("posted_at"))
    if ago:
        bits.append("🕒 " + ago)
    if kind == "reddit":
        bits.append("💬 answer in the thread")
    elif lead.get("email"):
        bits.append("✉️ email known")
    elif (a.get("url") or "").startswith("https://www.linkedin.com/"):
        bits.append("🔗 LinkedIn profile")
    return "  ·  ".join(bits)


SLACK_SOURCE_COUNT = {"post": "posts", "comment": "comments", "jobs": "job ads", "icp": "customer profiles", "rfp": "RFPs",
                      "reddit": "Reddit threads"}


def _slack_summary(total, strong, daily, sheet_url, by_source):
    """The context line under the headline: how the day went, where leads came from, who they are for."""
    from . import buyer_radar as br
    if not daily:
        return "%d new leads in all, the %d strong ones below" % (total, len(strong))
    line = "%d new lead%s today, %d strong" % (total, "" if total == 1 else "s", len(strong))
    where = ", ".join("%d %s" % (n, SLACK_SOURCE_COUNT.get(k, k)) for k, n in
                      sorted((by_source or {}).items(), key=lambda kv: -kv[1]) if n)
    if where:
        line += " (" + where + ")"
    if sheet_url:
        line += ", all in the Google Sheet"
    offers = {}
    for lead in strong:
        label = br.OFFERS.get(lead["offer"], {}).get("label", lead["offer"])
        offers[label] = offers.get(label, 0) + 1
    if len(offers) > 1:
        line += "\nStrong by offer: " + ", ".join("%s %d" % (k, n) for k, n in sorted(offers.items(), key=lambda kv: -kv[1]))
    return line


def _slack_card(i, n, lead):
    """One strong lead as its own message: who and what they are, what they want, the facts that say how to
    act, and the link."""
    from . import buyer_radar as br, watch_alerts
    esc = watch_alerts.esc
    p, v = lead["post"], lead["verdict"]
    a = p.get("author") or {}
    kind = p.get("kind") or "post"
    name = esc(a.get("name") or "Someone")
    headline = (a.get("headline") or "")[:90]
    if kind == "jobs" and p.get("contacts"):
        c = p["contacts"][0]
        headline = "write to %s%s" % (c.get("name") or "", (", " + c["title"][:60]) if c.get("title") else "")
    if len(v.get("signals") or []) > 1:
        headline += (" · " if headline else "") + "also found by %s" % ", ".join(
            SLACK_KIND.get(x, x).lower() for x in v["signals"] if x != kind)
    url = p.get("url") or ""
    offer = esc(br.OFFERS.get(lead["offer"], {}).get("label", lead["offer"]))
    text = "*%d of %d · %s*%s\n%s · %s · for *%s* · score *%d*" % (
        i, n, name, (" — " + esc(headline)) if headline else "", SLACK_KIND.get(kind, "Post"),
        esc(v.get("intent_label") or "Lead"), offer, lead["score"])
    if v.get("need"):
        text += "\n*Wants:* " + esc(v["need"])
    details = _slack_details(lead, kind)
    if details:
        text += "\n" + details
    # One message after another from the same sender runs together in Slack (no name or picture between
    # them), so each card starts with a line and ends with a button: room round it, and the link easy to hit.
    blocks = [{"type": "divider"}, {"type": "section", "text": {"type": "mrkdwn", "text": text[:2900]}}]
    if url.startswith(("https://", "http://")):
        blocks.append({"type": "actions", "elements": [{"type": "button", "url": url, "text": {
            "type": "plain_text", "text": SLACK_LINK.get(kind, "Open the post")}}]})
    return {"text": "Lead Finder: lead %d of %d, %s, score %d" % (i, n, a.get("name") or "Someone", lead["score"]),
            "blocks": blocks}


SLACK_HOT_SCORE = 85            # a lead this strong gets a message of its own; the others share one list in a thread
SLACK_LIST_CHARS = 2800         # a section holds 3000 characters
SLACK_LIST_LINES = 25


def _slack_line(lead):
    """One lead as a line of the thread's list: score, who, offer, and what can be done about it."""
    from . import buyer_radar as br, watch_alerts
    esc = watch_alerts.esc
    p, v = lead["post"], lead["verdict"]
    a = p.get("author") or {}
    kind = p.get("kind") or "post"
    who = "*%s*" % esc(a.get("name") or "Someone")
    if a.get("headline") and kind != "jobs":
        who += ", " + esc(a["headline"][:60])
    tag = {"icp": " (customer profile)", "reddit": " (Reddit)", "comment": " (comment)", "rfp": " (RFP)"}.get(kind, "")
    bits = [esc(br.OFFERS.get(lead["offer"], {}).get("label", lead["offer"]))]
    bits += [d for d in _slack_details(lead, kind).split("  ·  ") if d]
    if len(v.get("signals") or []) > 1:
        bits.append("also found by %s" % ", ".join(SLACK_KIND.get(x, x).lower() for x in v["signals"] if x != kind))
    url = p.get("url") or ""
    if url.startswith(("https://", "http://")):
        bits.append("<%s|Open>" % url)
    return ("• *%d* · %s%s · %s" % (lead["score"], who, tag, " · ".join(bits)))[:600]


def _slack_thread(rest):
    """The leads that are not hot, as messages for a thread: lines in sections of what a section can hold."""
    messages, chunk, size = [], [], 0
    for line in [_slack_line(lead) for lead in rest]:
        if chunk and (size + len(line) > SLACK_LIST_CHARS or len(chunk) >= SLACK_LIST_LINES):
            messages.append(chunk)
            chunk, size = [], 0
        chunk.append(line)
        size += len(line) + 1
    if chunk:
        messages.append(chunk)
    out = []
    for i, lines in enumerate(messages):
        title = "*The other %d strong lead%s*" % (len(rest), "" if len(rest) == 1 else "s") if i == 0 else "*…and more*"
        out.append({"text": "Lead Finder: the other %d strong leads" % len(rest), "thread": True,
                    "blocks": [{"type": "section", "text": {"type": "mrkdwn", "text": title + "\n" + "\n".join(lines)}}]})
    return out


def slack_messages(owner_label, leads, page_url, *, total=None, daily=False, sheet_url="", by_source=None,
                   hot_score=SLACK_HOT_SCORE):
    """What a run posts, every strong lead of it: first the headline (how many leads, how the day went, how
    many are hot, the buttons); then each hot lead (score `hot_score` or more) as a message of its own; and
    the other strong leads as one list, marked "thread": true, which goes under the headline as replies.
    `total` is every new lead of the run (the strong ones are some of them), `by_source` how many came from
    each place; the daily run says how its day went even when none is strong; `sheet_url` adds a button to
    the workspace's Google Sheet. A list of {"text", "blocks"}, the headline first."""
    from . import watch_alerts
    esc = watch_alerts.esc
    leads = sorted(leads, key=lambda lead: -int(lead.get("score") or 0))
    hot = [lead for lead in leads if int(lead.get("score") or 0) >= hot_score]
    rest = leads[len(hot):]
    who = (" for " + esc(owner_label)) if owner_label else ""
    if leads:
        head = "*Lead Finder: %d new lead%s%s*" % (len(leads), "" if len(leads) == 1 else "s", who)
    else:
        head = "*Lead Finder%s: no strong leads today*" % who if total else "*Lead Finder%s: nothing new today*" % who
    blocks = [{"type": "divider"}, {"type": "section", "text": {"type": "mrkdwn", "text": head}}]
    if total is not None and (daily or total > len(leads)):
        blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": _slack_summary(
            total, leads, daily, sheet_url, by_source)}]})
    if leads:
        parts = []
        if hot:
            parts.append("🔥 %d hot below" % len(hot))
        if rest:
            parts.append("%d %sin the thread" % (len(rest), "more " if hot else "strong leads " if len(rest) > 1 else "strong lead "))
        blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": " · ".join(parts)}]})
    buttons = []
    if page_url:
        buttons.append({"type": "button", "text": {"type": "plain_text", "text": "Open Lead Finder"}, "url": page_url})
    if sheet_url:
        buttons.append({"type": "button", "text": {"type": "plain_text", "text": "Open the Google Sheet"}, "url": sheet_url})
    if buttons:
        blocks.append({"type": "actions", "elements": buttons})
    first = {"text": "Lead Finder: %d new lead%s" % (len(leads), "" if len(leads) == 1 else "s"), "blocks": blocks}
    return [first] + [_slack_card(i, len(hot), lead) for i, lead in enumerate(hot, 1)] + _slack_thread(rest)


SLACK_PAUSE_S = 0.6             # a channel takes about a message a second in bursts; 429s are waited out by gads_digest.post


def slack_leads(channel, owner, leads, *, post=None, owner_label="", page_url=None, total=None, daily=False, sheet_url="",
                by_source=None, sleep=time.sleep, posted=None):
    """(ok, why). The headline, then every hot lead as a message of its own, then the other strong leads as a
    list in a thread under the headline (see slack_messages). Never raises. A message Slack refused is said
    in `why` (the others still go out). `posted`, a list,
    gets {"channel", "ts"} for every message that went out, so the run can delete them if it is sent again."""
    from . import gads_digest
    token = slack_token()
    if not token:
        return False, "not_configured"
    meta = {}
    post = post or (lambda t, c, m: gads_digest.post(t, c, m, meta=meta))
    posted = [] if posted is None else posted
    url = page_url or (base_url() + "/strategic-agents/buyer-radar")

    def send_one(msg, thread_ts=""):
        msg = {k: v for k, v in msg.items() if k != "thread"}
        if thread_ts:
            msg["thread_ts"] = thread_ts
        ok, err, ts = post(token, channel, msg)
        if ok and ts:
            posted.append({"channel": meta.get("channel") or channel, "ts": ts})
        return ok, err, ts

    try:
        messages = slack_messages(owner_label, leads, url, total=total, daily=daily, sheet_url=sheet_url,
                                  by_source=by_source)
        ok, err, head_ts = send_one(messages[0])
        if not ok:
            return False, err or "failed"
        failed, last = 0, ""
        for msg in messages[1:]:
            sleep(SLACK_PAUSE_S)
            ok, err, _ = send_one(msg, head_ts if msg.get("thread") else "")
            if not ok:
                failed, last = failed + 1, err or "failed"
    except Exception as e:
        return False, "%s" % type(e).__name__
    return (True, "") if not failed else (False, "%d of %d messages not posted (%s)" % (failed, len(messages) - 1, last))


def delete_messages(messages, *, delete=None, sleep=time.sleep):
    """Deletes messages Lead Finder posted: [{"channel", "ts"}]. (how many are gone, those still there).
    Never raises."""
    from . import gads_digest
    token = slack_token()
    delete = delete or gads_digest.delete
    gone, left = 0, []
    for m in messages or []:
        try:
            ok = bool(token) and delete(token, m.get("channel"), m.get("ts"))[0]
        except Exception:
            ok = False
        if ok:
            gone += 1
        else:
            left.append(m)
        sleep(0.3)
    return gone, left
