"""Market Radar: what the world says about a company when its own website cannot say it.

A site can refuse this server, be one page, or be built in the browser. The profile then used to be
thin or missing. This module reads free, public sources instead and hands them to the profile as
another "page":

    Wikidata    the company's own record: what it is, when it began, its head office, country,
                industry, employees, revenue, owner and founders. A record is used only when its
                official website IS this domain, so two firms with one name are never mixed.
    Wikipedia   the opening paragraph of its article.

Free, no model, no key. Every read goes through market_radar_http, so addresses are checked and a
failure says how it failed. Nothing here ever raises.

    outside_reading(site)  -> a site reading standing in for an unreadable one, or None
    add_outside(site)      -> the same reading with the outside page added (a thin site)
    read_quality(site)     -> {"grade", "words", "why"}: how much the profile can be trusted
"""
from __future__ import annotations

import os
import re
from urllib.parse import quote, urlsplit

WIKIDATA = "https://www.wikidata.org/w/api.php"
WIKIPEDIA = "https://en.wikipedia.org/api/rest_v1/page/summary/"
LABEL = "Wikidata and Wikipedia (the company's own website could not be read in full)"
THIN_WORDS = 350            # fewer readable words than this across the pages read: a thin reading
FULL_WORDS = 1500

# Wikidata properties used.
P_WEBSITE, P_INCEPTION, P_EMPLOYEES, P_REVENUE = "P856", "P571", "P1128", "P2139"
P_HQ, P_COUNTRY, P_INDUSTRY, P_INSTANCE = "P159", "P17", "P452", "P31"
P_FOUNDER, P_CEO, P_PARENT, P_OWNER = "P112", "P169", "P749", "P127"
P_STOCK = "P414"
LINKED = (P_HQ, P_COUNTRY, P_INDUSTRY, P_INSTANCE, P_FOUNDER, P_CEO, P_PARENT, P_OWNER, P_STOCK)

_STOP = {"www", "com", "net", "org", "co", "io", "in", "uk", "us", "de", "fr", "app", "shop", "store",
         "online", "the", "group", "inc", "ltd"}


def host_of(url):
    try:
        host = (urlsplit(url if "://" in url else "https://" + url).hostname or "").lower()
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def names_for(domain):
    """Search names for a domain: "allbirds.com" -> ["allbirds"], "aspen-dental.co.uk" -> ["aspen dental"]."""
    host = host_of(domain)
    parts = [p for p in host.split(".") if p and p not in _STOP]
    if not parts:
        return []
    base = parts[0] if len(parts) == 1 else max(parts, key=len)
    words = re.sub(r"[-_]+", " ", base).strip()
    out = [words]
    spaced = re.sub(r"(?<=[a-z])(?=(dental|health|healthcare|group|bank|labs|clinic|clinics|hospital|hospitals|care|media|motors|airlines|foods|pharma|energy|hotels|resorts|realty|homes|capital|insurance|university)$)", " ", words)
    if spaced != words:
        out.append(spaced)
    return list(dict.fromkeys(out))


def _claims(entity, prop):
    return (entity.get("claims") or {}).get(prop) or []


def _values(entity, prop):
    out = []
    for c in _claims(entity, prop):
        snak = c.get("mainsnak") or {}
        if snak.get("snaktype") != "value":
            continue
        out.append((snak.get("datavalue") or {}).get("value"))
    return out


def _qids(entity, prop):
    return [v.get("id") for v in _values(entity, prop) if isinstance(v, dict) and v.get("id")]


def _latest_amount(entity, prop):
    best, best_time = None, ""
    for c in _claims(entity, prop):
        snak = c.get("mainsnak") or {}
        v = (snak.get("datavalue") or {}).get("value")
        if not isinstance(v, dict) or "amount" not in v:
            continue
        when = ""
        for q in (c.get("qualifiers") or {}).get("P585", []):
            when = ((q.get("datavalue") or {}).get("value") or {}).get("time", "") or when
        if best is None or when >= best_time:
            try:
                best, best_time = float(v["amount"]), when
            except ValueError:
                continue
    return best, best_time[1:5] if best_time else None


def _year(entity, prop):
    for v in _values(entity, prop):
        t = (v or {}).get("time") if isinstance(v, dict) else None
        if t and re.match(r"[+-]\d{4}", t):
            return int(t[1:5])
    return None


def _api(get_json, params):
    url = WIKIDATA + "?" + "&".join("%s=%s" % (k, quote(str(v), safe="|,")) for k, v in params.items())
    data, read = get_json(url)
    return data if isinstance(data, dict) else None


def wikidata_company(domain, *, get_json):
    """The Wikidata record whose official website is this domain, as plain facts, or None."""
    want = host_of(domain)
    if not want:
        return None
    for name in names_for(domain)[:2]:
        found = _api(get_json, {"action": "wbsearchentities", "search": name, "language": "en",
                                "type": "item", "limit": 8, "format": "json"})
        ids = [h.get("id") for h in (found or {}).get("search", []) if h.get("id")]
        if not ids:
            continue
        got = _api(get_json, {"action": "wbgetentities", "ids": "|".join(ids), "format": "json",
                              "props": "claims|descriptions|labels|sitelinks", "languages": "en",
                              "sitefilter": "enwiki"})
        for qid in ids:
            entity = ((got or {}).get("entities") or {}).get(qid)
            if not entity:
                continue
            sites = {host_of(v) for v in _values(entity, P_WEBSITE) if isinstance(v, str)}
            if want not in sites and not any(s.endswith("." + want) or want.endswith("." + s) for s in sites if s):
                continue
            return _facts(entity, qid, get_json)
    return None


def _facts(entity, qid, get_json):
    linked = []
    for prop in LINKED:
        linked += _qids(entity, prop)[:3]
    labels = {}
    if linked:
        got = _api(get_json, {"action": "wbgetentities", "ids": "|".join(dict.fromkeys(linked)),
                              "format": "json", "props": "labels", "languages": "en"})
        labels = {k: ((v.get("labels") or {}).get("en") or {}).get("value")
                  for k, v in ((got or {}).get("entities") or {}).items()}

    def names(prop, n=3):
        return [labels.get(q) for q in _qids(entity, prop)[:n] if labels.get(q)]

    revenue, revenue_year = _latest_amount(entity, P_REVENUE)
    employees, employees_year = _latest_amount(entity, P_EMPLOYEES)
    title = ((entity.get("sitelinks") or {}).get("enwiki") or {}).get("title")
    return {
        "wikidata_id": qid,
        "name": ((entity.get("labels") or {}).get("en") or {}).get("value") or title,
        "description": ((entity.get("descriptions") or {}).get("en") or {}).get("value"),
        "kind": names(P_INSTANCE), "industry": names(P_INDUSTRY), "head_office": names(P_HQ, 1),
        "country": names(P_COUNTRY, 1), "founded": _year(entity, P_INCEPTION),
        "employees": int(employees) if employees else None, "employees_year": employees_year,
        "revenue": revenue, "revenue_year": revenue_year, "founders": names(P_FOUNDER),
        "ceo": names(P_CEO, 1), "parent": names(P_PARENT, 1), "owners": names(P_OWNER),
        "listed_on": names(P_STOCK, 2), "wikipedia_title": title,
    }


def wikipedia_extract(title, *, get_json):
    if not title:
        return ""
    data, _read = get_json(WIKIPEDIA + quote(title.replace(" ", "_"), safe="_()"))
    text = (data or {}).get("extract") if isinstance(data, dict) else ""
    return " ".join((text or "").split())[:1800]


def outside_facts(domain, *, get_json=None):
    """{"facts", "extract"} for a company, or None when no record names this domain as its website."""
    if get_json is None:
        # Off in tests unless a test passes its own reader (tests/conftest.py), like the other outside services.
        if os.environ.get("MR_OUTSIDE") == "off":
            return None
        from . import market_radar_http as http
        get_json = http.get_json
    try:
        facts = wikidata_company(domain, get_json=get_json)
        if not facts:
            return None
        return {"facts": facts, "extract": wikipedia_extract(facts.get("wikipedia_title"), get_json=get_json)}
    except Exception:
        return None


def _money(v):
    if v is None:
        return None
    for limit, word in ((1e9, "billion"), (1e6, "million")):
        if abs(v) >= limit:
            return "%.1f %s" % (v / limit, word)
    return "%d" % v


def as_text(found):
    f, extract = found["facts"], found["extract"]
    lines = ["Name: %s" % f["name"]] if f.get("name") else []
    for label, key in (("Description", "description"), ("Kind of organisation", "kind"),
                       ("Industry", "industry"), ("Head office", "head_office"), ("Country", "country"),
                       ("Founders", "founders"), ("Chief executive", "ceo"), ("Part of", "parent"),
                       ("Owned by", "owners"), ("Listed on", "listed_on")):
        v = f.get(key)
        if v:
            lines.append("%s: %s" % (label, ", ".join(v) if isinstance(v, list) else v))
    if f.get("founded"):
        lines.append("Founded: %d" % f["founded"])
    if f.get("employees"):
        lines.append("Employees: %s%s" % (f"{f['employees']:,}", " (%s)" % f["employees_year"] if f.get("employees_year") else ""))
    if f.get("revenue"):
        lines.append("Revenue: %s%s" % (_money(f["revenue"]), " (%s)" % f["revenue_year"] if f.get("revenue_year") else ""))
    if extract:
        lines.append("")
        lines.append(extract)
    return "\n".join(lines)


def words_read(site):
    return sum(int(p.get("words") or 0) for p in site.get("pages") or [] if p.get("status") == "ok")


def thin(site):
    return site.get("status") == "ok" and words_read(site) < THIN_WORDS


def outside_reading(site, *, get_json=None):
    """A reading to stand in for a site that could not be read: the outside page alone, flagged."""
    found = outside_facts(site.get("domain") or "", get_json=get_json)
    if not found:
        return None
    text = as_text(found)
    f = found["facts"]
    return dict(site, status="ok", via_outside=True, texts={LABEL: text}, outside=f,
                signals=dict(site.get("signals") or {}, title=f.get("name"), description=f.get("description")),
                home_notes=list(site.get("home_notes") or []) +
                ["the website could not be read, so the profile was built from Wikidata and Wikipedia instead"])


def add_outside(site, *, get_json=None):
    """A thin reading plus the outside page, so the model has more than a few lines."""
    found = outside_facts(site.get("domain") or "", get_json=get_json)
    if not found:
        return site
    texts = dict(site.get("texts") or {})
    texts[LABEL] = as_text(found)
    return dict(site, texts=texts, outside=found["facts"], via_outside=True,
                home_notes=list(site.get("home_notes") or []) +
                ["the website had little text, so Wikidata and Wikipedia were added"])


def read_quality(site):
    """How much of the company the profile could see, said plainly: full, partial, thin or outside only."""
    words = words_read(site)
    via = [k for k in ("via_browser", "via_archive", "via_apollo", "via_outside") if site.get(k)]
    if site.get("via_outside") and not words:
        grade, why = "outside", "The company's website could not be read; this profile comes from Wikidata and Wikipedia only."
    elif site.get("via_apollo") and not words:
        grade, why = "outside", "The company's website could not be read; this profile comes from Apollo's company record only."
    elif words >= FULL_WORDS:
        grade, why = "full", "The website was read in full (%d words)." % words
    elif words >= THIN_WORDS:
        grade, why = "partial", "The website was read in part (%d words); some things may be missing." % words
    else:
        grade, why = "thin", "The website gave very little to read (%d words); treat this profile as a first guess." % words
    if site.get("via_archive"):
        why += " It is an archived copy, not today's page."
    if site.get("via_browser"):
        why += " It was opened in a real browser."
    if site.get("via_outside") and words:
        why += " Wikidata and Wikipedia were added."
    return {"grade": grade, "words": words, "why": why, "via": via}
