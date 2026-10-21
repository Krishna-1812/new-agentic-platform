"""Buyer Radar: writing to a lead (email, LinkedIn), finding their email, and posting leads to Slack.

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
    tags = ["Buyer Radar", br.OFFERS.get(lead["offer"], {}).get("label", lead["offer"])]
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


SLACK_KIND = {"post": "Post", "comment": "Comment", "jobs": "Hiring"}


def slack_message(owner_label, leads, page_url):
    from . import buyer_radar as br, watch_alerts
    esc = watch_alerts.esc
    blocks = [{"type": "section", "text": {"type": "mrkdwn", "text": "*Buyer Radar: %d new lead%s%s*" % (
        len(leads), "" if len(leads) == 1 else "s", (" for " + esc(owner_label)) if owner_label else "")}}]
    for lead in leads[:10]:
        p, v = lead["post"], lead["verdict"]
        a = p.get("author") or {}
        kind = p.get("kind") or "post"
        who = esc(a.get("name") or "Someone") + ((", " + esc(a.get("headline")[:90])) if a.get("headline") else "")
        if kind == "jobs" and p.get("contacts"):
            c = p["contacts"][0]
            who += " (write to %s%s)" % (esc(c.get("name") or ""), (", " + esc(c["title"][:60])) if c.get("title") else "")
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": "*%s* · %s · %s · score %d\n%s\n<%s|%s>" % (
            esc(br.OFFERS.get(lead["offer"], {}).get("label", lead["offer"])), SLACK_KIND.get(kind, "Post"),
            esc(v.get("intent_label") or ""), lead["score"], "%s: %s" % (who, esc(v.get("need") or "")), p["url"],
            {"jobs": "Open the company", "comment": "Open the post they commented on"}.get(kind, "Open the post"))}})
    if len(leads) > 10:
        blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": "and %d more" % (len(leads) - 10)}]})
    if page_url:
        blocks.append({"type": "actions", "elements": [{"type": "button", "text": {"type": "plain_text", "text": "Open Buyer Radar"},
                                                        "url": page_url}]})
    return {"text": "Buyer Radar: %d new lead%s" % (len(leads), "" if len(leads) == 1 else "s"), "blocks": blocks}


def slack_leads(channel, owner, leads, *, post=None, owner_label="", page_url=None):
    """(ok, why). Never raises."""
    from . import gads_digest
    token = slack_token()
    if not token:
        return False, "not_configured"
    post = post or gads_digest.post
    url = page_url or (base_url() + "/strategic-agents/buyer-radar")
    try:
        ok, err, _ = post(token, channel, slack_message(owner_label, leads, url))
    except Exception as e:
        return False, "%s" % type(e).__name__
    return (True, "") if ok else (False, err or "failed")
