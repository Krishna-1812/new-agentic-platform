"""Market Radar: where the client and its rivals are, for the map on the Overview.

The client's own sites are located when its profile is built (market_radar_footprint). A rival is
placed from the best evidence there is:

    map listing      the place the map data lists it at (stored when the search found it there):
                     exact, and the reason a nearby clinic sits on the right street;
    stated location  the town or address its own homepage was judged to give, looked up in
                     OpenStreetMap's Nominatim (cached for good, one lookup a second as its policy
                     asks). That is a town, not a door, so the map says so.

A rival with neither (an online brand that states no base, "worldwide", "online") is listed beside
the map as not placed, never put somewhere to fill the picture.

    map_view(client_id, owner_email, store=..., geocode=...) -> {"you", "rivals", "unplaced", ...}

Lookups made in one call are capped (MAX_LOOKUPS): a client with twenty rivals fills in over a few
loads and the answer says how many are still to place (`pending`), so no request waits a minute.
Free: no model, no key.
"""
from __future__ import annotations

import re

MAX_LOOKUPS = 6
MAX_TEXT = 120
# Words that say where something is NOT: a lookup of "Global" would find a village of that name.
NOT_A_PLACE = re.compile(r"\b(online|global|globally|worldwide|world-?wide|remote|nationwide|international|various|"
                         r"multiple|unknown|unclear|n/?a|none|e-?commerce|internet|virtual|everywhere|"
                         r"not (stated|known|given|specified)|several)\b", re.I)


def place_text(location):
    """The text worth looking up for a stated location, or ''."""
    text = " ".join(str(location or "").split()).strip(" ,.;")
    if not text or len(text) > MAX_TEXT or not re.search(r"[^\W\d_]{2}", text) or NOT_A_PLACE.search(text):
        return ""
    return text


def _point(p):
    try:
        lat, lon = float(p["lat"]), float(p["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    return (lat, lon) if -90 <= lat <= 90 and -180 <= lon <= 180 and (lat or lon) else None


def you(profile):
    """The client's own sites, head office first, as pins."""
    from . import market_radar_footprint as fp
    out = []
    for i, p in enumerate(fp.sites(profile)):
        pt = _point(p)
        if pt:
            out.append({"name": fp.short_label(p) or (profile.get("name") or "Your site"), "lat": pt[0], "lon": pt[1],
                        "precision": p.get("precision") or "unknown", "head_office": i == 0})
    return out


def map_view(client_id, owner_email, *, store, geocode=None, budget=MAX_LOOKUPS):
    """None when the client is not the owner's."""
    from . import market_radar_views as views
    client = store.get_client(client_id, owner_email)
    if not client:
        return None
    if geocode is None:
        from . import market_radar_profile as prof
        geocode = prof.geocode
    profile = views.effective_profile(client["profile"] or {}, client["settings"])
    rows = [r for r in views.competitor_rows(client_id, owner_email) if r["status"] != "removed"]
    pins, unplaced, pending = [], [], 0
    for r in rows:
        pt, how, place = _point(r), None, r.get("location") or None
        if pt:
            how = "map listing"
        else:
            text = place_text(r.get("location"))
            if text:
                try:
                    cached = store.cached_geocode(text)
                except store.StoreUnavailable:
                    cached = None
                found = None
                if cached is not None:
                    found = cached.get("point")
                elif budget > 0:
                    budget -= 1
                    found = geocode(text)
                else:
                    pending += 1
                    continue
                pt = _point(found or {})
                how = "stated location"
        if not pt:
            unplaced.append({"entity_id": r["entity_id"], "name": r["name"], "domain": r["domain"], "kind": r["kind"],
                             "why": "no base is stated" if not place_text(r.get("location")) else "its location was not found"})
            continue
        pins.append({"entity_id": r["entity_id"], "name": r["name"], "domain": r["domain"], "kind": r["kind"],
                     "status": r["status"], "score": r["score"], "lat": pt[0], "lon": pt[1], "how": how,
                     "place": place, "distance_km": r.get("distance_km"), "near_site": r.get("near_site"),
                     "sells": r.get("sells"), "reason": r.get("reason")})
    radius = None
    try:
        from . import market_radar_radar as radar
        radius = (radar._search_settings(store, client_id, owner_email) or {}).get("radius_km")
    except Exception:
        radius = None
    from . import market_radar_footprint as fp
    return {"you": you(profile), "rivals": pins, "unplaced": unplaced, "pending": pending,
            "radius_km": radius if fp.serves_locally(profile) else None,
            "local": fp.serves_locally(profile), "name": client.get("name") or client.get("domain")}
