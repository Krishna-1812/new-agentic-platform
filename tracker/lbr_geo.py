"""Local Business Radar: the search area, from OpenStreetMap.

When Apify searches Google Maps (lbr_config.source() == "apify") the area
comes from OpenStreetMap's Nominatim instead of Google's Places API: it is
free, needs no key, and returns the place's real boundary, not just a box.
That boundary is handed to the Google Maps Scraper as its search area
(`customGeolocation`, GeoJSON; the Actor itself uses OpenStreetMap for its
own geolocation) and used again to drop any result outside it.

Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/):
at most one request a second, an identifying User-Agent, attribution, and
no systematic or bulk querying. The agent makes one lookup per plan, cached
per user for an hour by lbr_intake.cached_plan, and serialised here.
"""

import math
import threading
import time

from tracker import lbr_http

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
ATTRIBUTION = "Area boundaries © OpenStreetMap contributors (ODbL)"
MIN_INTERVAL = 1.1
MAX_RING_POINTS = 400

# Nominatim's `addresstype` -> the agent's kind of area.
KIND_BY_ADDRESSTYPE = {
    "country": "country",
    "state": "state", "province": "state", "region": "state", "territory": "state",
    "county": "county", "state_district": "county", "district": "county",
    "city": "city", "town": "city", "village": "city", "municipality": "city", "hamlet": "city",
    "city_district": "district", "borough": "district", "suburb": "district", "quarter": "district",
    "neighbourhood": "district",
    "postcode": "postcode",
}
# A place Nominatim knows only as a point gets a circle this wide.
POINT_RADIUS_KM = {"postcode": 3, "district": 2, "city": 5, "county": 15, "state": 60}

_LOCK = threading.Lock()
_LAST = [0.0]


class GeoError(Exception):
    pass


def _thin(ring):
    """Keep a ring under MAX_RING_POINTS (a state's outline runs to thousands)."""
    if len(ring) <= MAX_RING_POINTS:
        return ring
    step = -(-len(ring) // MAX_RING_POINTS)
    out = ring[::step]
    if out[-1] != ring[-1]:
        out.append(ring[-1])
    return out


def _thin_geometry(g):
    if g.get("type") == "Polygon":
        return {"type": "Polygon", "coordinates": [_thin(r) for r in g["coordinates"]]}
    if g.get("type") == "MultiPolygon":
        return {"type": "MultiPolygon", "coordinates": [[_thin(r) for r in poly] for poly in g["coordinates"]]}
    return g


def _query(text, ledger):
    with _LOCK:
        wait = MIN_INTERVAL - (time.time() - _LAST[0])
        if wait > 0:
            time.sleep(wait)
        try:
            return lbr_http.call(ledger, "openstreetmap", "resolve_location", "GET", NOMINATIM_URL,
                                 params={"q": text, "format": "jsonv2", "addressdetails": 1, "limit": 5,
                                         "polygon_geojson": 1, "polygon_threshold": 0.002},
                                 price_op="osm.nominatim", timeout=20)
        finally:
            _LAST[0] = time.time()


def resolve(text, ledger):
    """The area for what the user typed, shaped like lbr_intake.resolve_location's."""
    try:
        results = _query(text, ledger)
    except lbr_http.ToolError as exc:
        raise GeoError("OpenStreetMap could not be reached to find \"%s\" (%s)." % (text, exc))
    if not isinstance(results, list):
        results = []
    hits = [r for r in results if KIND_BY_ADDRESSTYPE.get(r.get("addresstype"))]
    if not hits:
        raise GeoError("OpenStreetMap could not find a city, county, ZIP or state called \"%s\"." % text)
    r = hits[0]
    kind = KIND_BY_ADDRESSTYPE[r["addresstype"]]
    if kind == "country":
        raise GeoError("A whole country is too large for one run. Pick a state, county or city.")
    try:
        s, n, w, e = (float(v) for v in r["boundingbox"])
        lat, lng = float(r["lat"]), float(r["lon"])
    except (KeyError, TypeError, ValueError):
        raise GeoError("OpenStreetMap returned no boundary for \"%s\"." % text)
    geom = r.get("geojson") or {}
    if geom.get("type") in ("Polygon", "MultiPolygon"):
        shape = _thin_geometry(geom)
    else:
        radius = POINT_RADIUS_KM[kind]
        shape = {"type": "Point", "coordinates": [lng, lat], "radiusKm": radius}
        dlat = radius / 111.0
        dlng = radius / (111.0 * max(0.2, abs(math.cos(math.radians(lat)))))
        s, n, w, e = lat - dlat, lat + dlat, lng - dlng, lng + dlng
    addr = r.get("address") or {}
    iso = addr.get("ISO3166-2-lvl4") or ""
    return {
        "input": text, "place_id": "osm:%s/%s" % (r.get("osm_type") or "", r.get("osm_id") or ""),
        "name": r.get("name") or text, "formatted": r.get("display_name") or text, "kind": kind,
        "viewport": {"low": {"lat": s, "lng": w}, "high": {"lat": n, "lng": e}},
        "center": {"lat": lat, "lng": lng},
        "country": (addr.get("country_code") or "").upper(),
        "admin1": iso.split("-", 1)[1] if "-" in iso else "", "admin1_name": addr.get("state") or "",
        "admin2": addr.get("county") or "",
        # The boundary does the filtering; no name matching is needed.
        "filter": "shape", "shape": shape, "source": "openstreetmap", "attribution": ATTRIBUTION,
    }


# ── Inside or out ────────────────────────────────────────────────────────────
def _in_ring(lng, lat, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def _in_polygon(lng, lat, rings):
    return bool(rings) and _in_ring(lng, lat, rings[0]) and not any(_in_ring(lng, lat, h) for h in rings[1:])


def contains(shape, lat, lng):
    """Whether (lat, lng) falls inside an area's shape. Unknown position -> True."""
    if lat is None or lng is None or not shape:
        return True
    t = shape.get("type")
    if t == "Polygon":
        return _in_polygon(lng, lat, shape["coordinates"])
    if t == "MultiPolygon":
        return any(_in_polygon(lng, lat, p) for p in shape["coordinates"])
    if t == "Point":
        plng, plat = shape["coordinates"]
        dy = (lat - plat) * 111.0
        dx = (lng - plng) * 111.0 * math.cos(math.radians(plat))
        return math.hypot(dx, dy) <= float(shape.get("radiusKm") or 5)
    return True
