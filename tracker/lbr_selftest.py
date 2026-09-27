"""Local Business Radar: check every connected service without spending anything.

One row per check, each {"name", "ok", "detail"} with ok True, False or None
(None: not connected, and not needed for this source). Every call here is
free: Apify's account and Actor metadata, Claude's model lookup, and one
OpenStreetMap search. No key or token value is ever put in a row.
"""

from tracker import apify_transport, lbr_config, lbr_geo, lbr_http, lbr_store

ACTOR = "compass/crawler-google-places"


def _row(name, ok, detail):
    return {"name": name, "ok": ok, "detail": detail}


def _apify():
    token = lbr_config.key_for("apify")
    if not token:
        return [_row("Apify token", False if lbr_config.source() == "apify" else None,
                     "APIFY_API_TOKEN is not set.")]
    rows = []
    account, err = apify_transport.probe_token(token)
    if err:
        return [_row("Apify token", False, err)]
    plan = (account.get("plan") or {}).get("id") or "unknown plan"
    rows.append(_row("Apify token", True, "Signed in as %s (%s)." % (account.get("username") or "?", plan)))
    limits, err = apify_transport.account_limits(token)
    if limits:
        used = (limits.get("current") or {}).get("monthlyUsageUsd")
        cap = (limits.get("limits") or {}).get("maxMonthlyUsageUsd")
        if used is not None and cap is not None:
            left = max(0.0, float(cap) - float(used))
            rows.append(_row("Apify credit this month", left > 0.5,
                             "$%.2f used of $%.2f; $%.2f left." % (float(used), float(cap), left)))
    actor, err = apify_transport.check_actor(ACTOR, token)
    rows.append(_row("Google Maps Scraper", not err,
                     err or "%s is available to this account." % (actor.get("title") or ACTOR)))
    return rows


def _claude():
    key = lbr_config.key_for("claude")
    model = lbr_config.model()
    if not key:
        return _row("Claude", False, "ANTHROPIC_API_KEY is not set.")
    try:
        from anthropic import Anthropic
        info = Anthropic(api_key=key, timeout=20.0, max_retries=1).models.retrieve(model)
    except Exception as exc:
        status = getattr(exc, "status_code", None)
        why = {401: "the key was refused", 403: "the key lacks access", 404: "the model %s was not found" % model}
        return _row("Claude", False, "Claude check failed: %s." % why.get(status, type(exc).__name__))
    return _row("Claude", True, "Key works; model %s (%s) is available." % (
        model, getattr(info, "display_name", "") or model))


def _osm():
    try:
        area = lbr_geo.resolve("Austin, TX", lbr_http.Ledger())
    except lbr_geo.GeoError as exc:
        return _row("OpenStreetMap (area lookup)", False, str(exc))
    how = "a bounding box (fallback service)" if area.get("approximate") else "its exact boundary"
    return _row("OpenStreetMap (area lookup)", True, "Found %s as a %s, with %s." % (
        area["name"], area["kind"], how))


def _store():
    try:
        lbr_store.list_runs("selftest@local", limit=1)
    except Exception as exc:
        return _row("Database", False, "Runs cannot be stored: %s." % type(exc).__name__)
    if lbr_store.backend() == "postgres":
        return _row("Database", True, "Postgres: runs are kept across deploys and shared by every worker.")
    return _row("Database", False, "DATABASE_URL is not set: runs live in one process's memory and are lost "
                                   "on every deploy.")


def run():
    source = lbr_config.source()
    rows = [_row("Source", True, "Google Maps via Apify's Google Maps Scraper." if source == "apify"
                 else "Google Places API with SerpAPI.")]
    missing = lbr_config.missing_required()
    rows.append(_row("Required keys", not missing, "All set." if not missing else "Missing: %s." % ", ".join(missing)))
    rows.append(_store())
    rows.extend(_apify())
    rows.append(_claude())
    if source == "apify":
        rows.append(_osm())
    for key, label, what in (("serpapi", "SerpAPI", "Google Ads checks (and cheaper map rank)"),
                             ("pagespeed", "PageSpeed Insights", "website speed scores"),
                             ("hunter", "Hunter.io", "extra contact emails")):
        on = bool(lbr_config.key_for(key))
        rows.append(_row(label, True if on else None, "Connected." if on else "Optional, not connected: no %s." % what))
    return {"source": source, "ok": all(r["ok"] is not False for r in rows), "checks": rows}
