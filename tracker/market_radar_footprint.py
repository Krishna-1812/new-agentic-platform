"""Market Radar: where a business serves its customers, and whether its
competition is local.

A business with one site, or a few, competes with the businesses near each
of its sites. A chain with many sites competes with other chains. The line
between them is SMALL_CHAIN_MAX sites: Core Care Clinic (corecareclinic.com,
2026-10-10) is a practice with clinics in Waltham MA, North Andover MA and
Tampa FL. Treated as a chain like Aspen Dental, its competitor search
rejected the behavioural health practices in Waltham and North Andover as
"a single site, not a rival to a chain at its level", never searched the map
around its clinics, and scored Amazon One Medical's new office 10 km from
its Waltham clinic last of 21 moves, because a chain's moves are scored
without distance.

    serves_locally(profile)    -> True for one site or up to SMALL_CHAIN_MAX
    sites(profile)             -> [{"lat", "lon", "label", ...}], HQ first
    nearest(points, lat, lon)  -> (km, point) or (None, None)
"""
from __future__ import annotations

import math

SMALL_CHAIN_MAX = 5          # more sites than this: a chain
SAME_SITE_KM = 0.4           # two geocodes this close are one site


def site_count(profile):
    """The number of sites the profile supports: the stated count, else the
    sites it located. None when nothing says."""
    n = profile.get("location_count")
    if isinstance(n, int) and n > 0:
        return n
    located = len(profile.get("site_points") or [])
    return located or None


def serves_locally(profile):
    """Does this business compete with the businesses near its sites?"""
    archetype = profile.get("archetype")
    if archetype == "local_single":
        return True
    if archetype == "multi_location":
        n = site_count(profile)
        return n is not None and n <= SMALL_CHAIN_MAX
    return False


def _km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(a)))


def _located(point):
    return isinstance(point, dict) and point.get("lat") is not None and point.get("lon") is not None


def sites(profile):
    """Every located site, the head office first, none twice. A profile read
    before sites were listed has only its head office."""
    out = []
    hq = profile.get("hq_point")
    if _located(hq) and not hq.get("city"):
        hq = dict(hq, city=(profile.get("hq") or {}).get("city") or "")
    for p in [hq] + list(profile.get("site_points") or []):
        if not _located(p):
            continue
        if any(_km(p["lat"], p["lon"], q["lat"], q["lon"]) <= SAME_SITE_KM for q in out):
            continue
        out.append(p)
    return out[:SMALL_CHAIN_MAX * 2]


def nearest(points, lat, lon):
    """(km, point) of the site nearest to (lat, lon)."""
    best = (None, None)
    for p in points or []:
        if not _located(p):
            continue
        km = _km(p["lat"], p["lon"], lat, lon)
        if best[0] is None or km < best[0]:
            best = (km, p)
    return best


def short_label(point):
    """The site's town ("Waltham"), else the first part of its label."""
    label = (point or {}).get("city") or (point or {}).get("label") or ""
    return label.split(",")[0].strip()
