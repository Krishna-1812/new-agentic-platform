"""Client accounts: the profile block at the top of an account's tab in the master doc.

The master doc is the one running Google Doc the AI review already reads
(tracker/gads_ai_doc.py): one tab per account. A tab may open with a short
profile, one fact per line, that sets up the platform for that account:

    Display name: Lumina Smiles Dental
    URL name: lumina-smiles
    Google Ads ID: 412-118-3390
    Website: https://luminasmiles.in
    Industry: Dental clinic
    Locations: Pune, Mumbai
    Competitors: smilecare.in, Dr. Shah's Dental
    ...
    NOTES
    2026-09-12  The client wants more weekday leads...

A two-column table (field | value) works the same way. Field names are
matched loosely ("Brand colors" or "Colours", "KPIs" or "Goals / KPIs"), and
the profile stops at a line or heading called Notes, Log, Updates or History,
so a dated note further down ("Website: new booking page live") never
overwrites it. Anything not recognised is left to the notes, which the AI
review reads as before.
"""

from __future__ import annotations

import re
import unicodedata
from urllib.parse import urlsplit

# Canonical field -> the names a person might give it, normalised (see _key).
FIELDS = {
    "display_name": ("display name", "client name", "account name", "brand name", "business name", "name"),
    "url_name": ("url name", "url slug", "slug", "link name", "platform url", "page name", "platform link"),
    "google_ads_ids": ("google ads id", "google ads ids", "google ads account", "google ads accounts",
                       "google ads", "google ads customer id", "customer id", "customer ids", "ads account",
                       "ads account id", "ads id", "gads id"),
    "website": ("website", "web site", "site", "domain", "url", "homepage", "web"),
    "industry": ("industry", "category", "business type", "type of business", "sector", "vertical", "niche"),
    "locations": ("locations", "location", "cities", "city", "service area", "service areas", "markets", "market",
                  "geo", "geos", "geography", "regions", "region", "country", "countries", "target locations"),
    "services": ("services", "service", "products", "product", "offer", "offers", "offering", "offerings",
                 "products and services", "products services", "what they sell"),
    "competitors": ("competitors", "competitor", "competition", "rivals", "main competitors"),
    "audience": ("audience", "audiences", "target audience", "icp", "ideal customer", "customers", "who they serve"),
    "goals": ("goals", "goal", "kpis", "kpi", "targets", "target", "objectives", "objective", "goals kpis",
              "goals and kpis", "kpis and targets"),
    "colours": ("brand colours", "brand colors", "brand colour", "brand color", "colours", "colors", "palette",
                "brand palette"),
    "fonts": ("brand fonts", "brand font", "fonts", "font", "typefaces", "typeface"),
    "tone": ("tone", "tone of voice", "voice", "brand voice"),
    "social": ("social", "socials", "social media", "social links", "social profiles"),
    "instagram": ("instagram", "ig"),
    "facebook": ("facebook", "fb"),
    "linkedin": ("linkedin",),
    "youtube": ("youtube",),
    "x": ("x", "twitter", "x twitter"),
    "tiktok": ("tiktok",),
    "manager": ("account manager", "manager", "am", "account owner", "owner", "point of contact"),
    "since": ("client since", "since", "start date", "started", "onboarded"),
    "status": ("status", "platform status"),
    "logo": ("logo", "logo url", "logo link"),
}
_BY_NAME = {name: field for field, names in FIELDS.items() for name in names}
SOCIAL = ("instagram", "facebook", "linkedin", "youtube", "x", "tiktok")
LISTS = ("locations", "services", "fonts")
# The fields that make a tab an account of its own when no Google Ads account matches it: a tab
# with only notes ("Meeting notes", "Ideas") must not become a client.
IDENTIFYING = ("website", "url_name", "google_ads_ids", "industry", "display_name")
# A line or heading that ends the profile: the notes start here.
_NOTES = re.compile(r"^(?:#+\s*)?(?:\*\*)?\s*(?:notes?|account notes|running notes|log|activity log|updates?|"
                    r"history|change ?log|timeline|meeting notes)\b", re.I)
_LINE = re.compile(r"^\s*(?:[-*•]\s+)?(?:\*\*)?([A-Za-z][A-Za-z0-9 /&()'’.+-]{0,40}?)(?:\*\*)?\s*(?::|\|)\s*(.*)$")
_HIDDEN = {"hidden", "hide", "archived", "inactive", "former", "former client", "churned", "off", "paused client"}
_URL = re.compile(r"https?://[^\s,;|<>\"')]+", re.I)
_DOMAIN = re.compile(r"(?<![@\w.-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(/[^\s,;|<>\"')]*)?", re.I)
_HEX = re.compile(r"#(?:[0-9a-f]{6}|[0-9a-f]{3})\b", re.I)
_CID = re.compile(r"(?<!\d)(\d{3})[- ]?(\d{3})[- ]?(\d{4})(?!\d)")
_SOCIAL_HOSTS = {"instagram.com": "instagram", "facebook.com": "facebook", "fb.com": "facebook",
                 "linkedin.com": "linkedin", "youtube.com": "youtube", "youtu.be": "youtube",
                 "x.com": "x", "twitter.com": "x", "tiktok.com": "tiktok"}
_SOCIAL_BASE = {"instagram": "https://www.instagram.com/", "x": "https://x.com/", "tiktok": "https://www.tiktok.com/@",
                "youtube": "https://www.youtube.com/@", "facebook": "https://www.facebook.com/",
                "linkedin": "https://www.linkedin.com/company/"}
MAX_ITEMS = 20
MAX_TEXT = 600


def _key(text):
    """A field name as written ("Brand colours (hex)", "**Goals / KPIs**") -> "brand colours"."""
    t = re.sub(r"\([^)]*\)", " ", text or "")
    t = re.sub(r"[^a-z0-9]+", " ", t.lower())
    return " ".join(t.split())


def field_for(name):
    return _BY_NAME.get(_key(name))


def _split(value):
    """A list as written: commas, semicolons, middle dots, bullets or line breaks."""
    parts = re.split(r"\s*(?:[,;\n•·]|\s\|\s)\s*", value or "")
    out, seen = [], set()
    for p in parts:
        p = p.strip(" \t-*–—").strip()
        if p and p.lower() not in seen:
            seen.add(p.lower())
            out.append(p[:120])
        if len(out) >= MAX_ITEMS:
            break
    return out


def website(value):
    """The first web address in a value, as https://host/path, or ""."""
    m = _URL.search(value or "")
    if m:
        url = m.group(0).rstrip(".")
    else:
        m = _DOMAIN.search(value or "")
        if not m:
            return ""
        url = "https://" + m.group(1) + (m.group(2) or "")
    try:
        parts = urlsplit(url)
    except ValueError:
        return ""
    if parts.scheme not in ("http", "https") or not parts.hostname or "." not in parts.hostname:
        return ""
    path = parts.path.rstrip("/")
    return "https://%s%s" % (parts.hostname.lower(), path)


def domain(url):
    """luminasmiles.in for https://www.luminasmiles.in/book."""
    try:
        host = urlsplit(url or "").hostname or ""
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def customer_ids(value):
    """Google Ads customer IDs in a value, as ten digits each."""
    return ["".join(m.groups()) for m in _CID.finditer(value or "")]


def format_cid(digits):
    d = re.sub(r"\D", "", digits or "")
    return "%s-%s-%s" % (d[:3], d[3:6], d[6:]) if len(d) == 10 else d


def colours(value):
    out = []
    for m in _HEX.finditer(value or ""):
        h = m.group(0).lower()
        if len(h) == 4:
            h = "#" + "".join(c * 2 for c in h[1:])
        if h not in out:
            out.append(h)
    return out[:8]


def _social(platform, value):
    """A profile link for a platform from a URL, a domain path or an @handle."""
    m = _URL.search(value or "")
    if m:
        return m.group(0).rstrip(".")
    m = _DOMAIN.search(value or "")
    if m and m.group(2):
        return "https://" + m.group(1) + m.group(2)
    handle = re.search(r"@?([A-Za-z0-9_.-]{2,60})", (value or "").strip())
    if handle and platform in _SOCIAL_BASE:
        return _SOCIAL_BASE[platform] + handle.group(1).lstrip("@")
    return ""


def _socials(value):
    """{platform: link} from a free list of links ("Social: instagram.com/x, linkedin.com/company/y")."""
    out = {}
    for item in _split(value):
        link = website(item) if not _URL.search(item) else _URL.search(item).group(0)
        host = domain(link)
        for h, platform in _SOCIAL_HOSTS.items():
            if host == h or host.endswith("." + h):
                out.setdefault(platform, link if link.startswith("http") else "https://" + link)
    return out


def _competitors(value):
    out = []
    for item in _split(value):
        site = website(item) if _DOMAIN.search(item) else ""
        name = item
        if site and re.fullmatch(r"(?:https?://)?(?:www\.)?[^\s]+", item.strip(), re.I):
            name = domain(site)
        elif site:   # "Smile Care (smilecare.in)" -> "Smile Care"
            name = re.sub(r"\s*\((?:https?://)?[^()\s]+\.[a-z]{2,}[^()]*\)", "", item, flags=re.I).strip() or domain(site)
        out.append({"name": name[:80], "website": site, "domain": domain(site)})
    return out[:12]


def _text(value):
    return " ".join((value or "").split())[:MAX_TEXT]


def _lines(text):
    """The text's lines without Markdown heading marks, and whether each was a heading."""
    out = []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        heading = line.startswith("#")
        out.append((heading, line.lstrip("#").strip() if heading else line))
    return out


def parse(text):
    """The profile from an account's part of the doc (gads_ai_doc's Markdown: headings as "#", table rows
    as "a | b"). Returns a dict; "fields" counts the recognised facts."""
    found = {}
    pending = None            # a field written on its own line, its items as bullets below it
    for heading, line in _lines(text):
        if _NOTES.match(line):
            break
        if heading:
            pending = None
            continue
        m = _LINE.match(line)
        field = field_for(m.group(1)) if m else None
        if field:
            value = m.group(2).strip().strip("|").strip()
            if " | " in value:                 # a table row with more cells: the second is the value
                value = value.split(" | ")[0].strip()
            if not value:
                pending = field
                continue
            pending = None
            if field in found and field not in ("social",):
                continue                       # the first time a fact is given is the profile's
            found[field] = value if field != "social" else (found.get("social", "") + ", " + value).strip(", ")
            continue
        if pending and line.lstrip().startswith(("-", "*", "•")):
            item = line.lstrip(" -*•").strip()
            found[pending] = (found.get(pending, "") + ", " + item).strip(", ")
            continue
        pending = None
    return _clean(found)


def _clean(found):
    p = {"fields": 0}
    for field, value in found.items():
        if field == "google_ads_ids":
            ids = customer_ids(value)
            if ids:
                p["google_ads_ids"] = ids
        elif field == "website":
            site = website(value)
            if site:
                p["website"], p["domain"] = site, domain(site)
        elif field == "colours":
            c = colours(value)
            if c:
                p["colours"] = c
        elif field in LISTS:
            items = _split(value)
            if items:
                p[field] = items
        elif field == "competitors":
            c = _competitors(value)
            if c:
                p["competitors"] = c
        elif field == "social":
            for platform, link in _socials(value).items():
                p.setdefault("social", {}).setdefault(platform, link)
        elif field in SOCIAL:
            link = _social(field, value)
            if link:
                p.setdefault("social", {})[field] = link
        elif field == "status":
            p["hidden"] = _key(value) in _HIDDEN
            p["status"] = _text(value)[:40]
        elif field == "logo":
            site = _URL.search(value or "")
            if site:
                p["logo"] = site.group(0)
        elif field == "url_name":
            p["url_name"] = _text(value)[:64]
        elif field == "display_name":
            p["display_name"] = _text(value)[:80]
        else:
            t = _text(value)
            if t:
                p[field] = t
    p["fields"] = sum(1 for k in p if k not in ("fields", "domain", "hidden"))
    return p


def identifies(profile):
    """True when a tab's profile is enough to make it an account of its own."""
    return any(profile.get(f) for f in IDENTIFYING)


# ── The template, for a tab that has no profile yet ─────────────────────────
TEMPLATE_FIELDS = (
    ("Display name", "display_name"), ("URL name", "url_name"), ("Google Ads ID", "google_ads_ids"),
    ("Website", "website"), ("Industry", "industry"), ("Locations", "locations"), ("Services", "services"),
    ("Competitors", "competitors"), ("Audience", "audience"), ("Goals / KPIs", "goals"),
    ("Brand colours", "colours"), ("Brand fonts", "fonts"), ("Tone of voice", "tone"),
    ("Instagram", "instagram"), ("Facebook", "facebook"), ("LinkedIn", "linkedin"), ("YouTube", "youtube"),
    ("Account manager", "manager"),
)


def template(name="", url_name="", ids=(), profile=None):
    """The profile block to paste at the top of an account's tab, filled with what is already known."""
    profile = profile or {}
    known = {"display_name": profile.get("display_name") or name, "url_name": profile.get("url_name") or url_name,
             "google_ads_ids": ", ".join(format_cid(i) for i in (profile.get("google_ads_ids") or ids)),
             "website": profile.get("website", ""), "industry": profile.get("industry", ""),
             "locations": ", ".join(profile.get("locations") or []),
             "services": ", ".join(profile.get("services") or []),
             "competitors": ", ".join(c.get("domain") or c.get("name") for c in profile.get("competitors") or []),
             "audience": profile.get("audience", ""), "goals": profile.get("goals", ""),
             "colours": ", ".join(profile.get("colours") or []), "fonts": ", ".join(profile.get("fonts") or []),
             "tone": profile.get("tone", ""), "manager": profile.get("manager", "")}
    for platform in ("instagram", "facebook", "linkedin", "youtube"):
        known[platform] = (profile.get("social") or {}).get(platform, "")
    lines = ["PROFILE"] + ["%s: %s" % (label, known.get(field, "")) for label, field in TEMPLATE_FIELDS]
    return "\n".join(lines + ["", "NOTES (newest last)", ""])


def ascii_fold(text):
    return unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode("ascii")
