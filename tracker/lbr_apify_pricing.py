"""Local Business Radar: what Apify charges this account, read from Apify.

The Google Maps Scraper is priced per event, and the price of most events
depends on the account's discount tier (FREE, BRONZE, SILVER, GOLD,
PLATINUM, DIAMOND): a scraped place is $0.004 on FREE and $0.003 on BRONZE.
Rather than assume the Free plan, the agent reads both halves from Apify:

  * the account's tier: GET /v2/users/me, data.plan.tier;
  * the Actor's current prices: GET /v2/acts/<actor>, the pricingInfos
    record in force now, pricingPerEvent.actorChargeEvents, each event's
    eventTieredPricingUsd[<tier>].tieredEventPriceUsd (or eventPriceUsd for
    an event with one price for everyone, like the Actor start).

Apify's API reference: "The actual price applied is resolved from the
user's tier" (TieredPricingPerEvent, https://docs.apify.com/api/v2).

Both reads are free. They are cached for PRICES_TTL; a failure is cached for
RETRY_AFTER and the list prices in lbr_config.PRICES stand in until then.
LBR_APIFY_PRICING=list turns the lookup off (the tests do).
"""

import os
import threading
import time
from datetime import datetime, timezone

from tracker import apify_transport

ACTOR = "compass/crawler-google-places"
PRICES_TTL = 6 * 3600
RETRY_AFTER = 600
# Apify's pay-per-event names -> the agent's price names (lbr_config.PRICES).
EVENTS = {"place-scraped": "apify.place", "place-details-scraped": "apify.details",
          "review-scraped": "apify.review", "apify-actor-start": "apify.start"}

_LOCK = threading.Lock()
_CACHE = {"at": 0.0, "value": None, "key": None}


def enabled():
    return (os.environ.get("LBR_APIFY_PRICING") or "").strip().lower() not in ("list", "off", "0", "false")


def _when(text):
    try:
        return datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    except ValueError:
        return None


def current_pricing(pricing_infos, now=None):
    """The pricingInfos record in force at `now`: the latest one that has started."""
    now = now or datetime.now(timezone.utc)
    started = [(when, p) for p in pricing_infos or [] if isinstance(p, dict)
               for when in [_when(p.get("startedAt"))] if when and when <= now]
    return max(started, key=lambda x: x[0])[1] if started else None


def prices_for(actor, tier):
    """{"apify.place": usd, ...} for `tier` from an Actor record, or {} when not priced per event."""
    info = current_pricing((actor or {}).get("pricingInfos"))
    if not info or info.get("pricingModel") != "PAY_PER_EVENT":
        return {}
    events = (info.get("pricingPerEvent") or {}).get("actorChargeEvents") or {}
    out = {}
    for name, op in EVENTS.items():
        ev = events.get(name) or {}
        tiered = ev.get("eventTieredPricingUsd") or {}
        usd = (tiered.get(tier) or {}).get("tieredEventPriceUsd") if tier else None
        if usd is None:
            usd = ev.get("eventPriceUsd")
        if isinstance(usd, (int, float)):
            out[op] = float(usd)
    return out


def _read(token):
    account, err = apify_transport.probe_token(token)
    if err:
        return {"error": err}
    plan = (account or {}).get("plan") or {}
    tier = (plan.get("tier") or "").upper() or None
    actor, err = apify_transport.check_actor(ACTOR, token)
    if err:
        return {"error": err}
    prices = prices_for(actor, tier)
    if not tier:
        return {"error": "Apify did not say which pricing tier this account is on."}
    if not prices.get("apify.place"):
        return {"error": "Apify did not list a %s price for the Google Maps Scraper." % tier}
    return {"tier": tier, "plan": plan.get("id") or "", "prices": prices, "read_at": time.time()}


def lookup(token, *, refresh=False):
    """{"tier", "plan", "prices", "read_at"} or {"error"}; None when off or without a token."""
    if not token or not enabled():
        return None
    key = hash(token)
    now = time.time()
    with _LOCK:
        cached, at, same = _CACHE["value"], _CACHE["at"], _CACHE["key"] == key
    if cached is not None and same and not refresh:
        ttl = RETRY_AFTER if cached.get("error") else PRICES_TTL
        if now - at < ttl:
            return cached
    try:
        value = _read(token)
    except Exception as exc:  # never let a price lookup break a plan or a run
        value = {"error": "Could not read Apify prices: %s" % type(exc).__name__}
    with _LOCK:
        _CACHE.update(at=now, value=value, key=key)
    return value


def rate(op, token):
    """This account's price for one apify.* operation, or None to use the list price."""
    found = lookup(token)
    if not found or found.get("error"):
        return None
    return found["prices"].get(op)


def reset():
    with _LOCK:
        _CACHE.update(at=0.0, value=None, key=None)
