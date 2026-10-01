"""Google Ads AI review: the account context, read from one running Google Doc.

The agency keeps one Google Doc for all accounts and updates it as things change.
Each account has its own part of it, found by name:

  - a tab whose title is the account's name (Google Docs tabs), or
  - a heading (Heading 1-6, or Title) naming the account, up to the next heading of
    the same or a higher level, or
  - a short line on its own naming the account (for docs written without heading
    styles), up to the next such line or heading.

A tab or heading called "General", "All accounts", "Agency", "Common" or "Overall"
is shared: it goes with every account's part (house rules, reporting cadence...).
A heading or tab belongs to the account whose name it contains; where it contains
more than one, the longest name wins; a tab title may shorten the name ("Hare Krishna" for
"Hare Krishna Movement Charitable Foundation Hyderabad") when exactly one account's name starts
with it. Headings must give the account's name in full.

Headings are kept as Markdown (#, ##) and tables as rows, so the review sees the
doc's structure. Read with the same service account that reads the Google Ads
sheet; the doc must be shared with it (Viewer) and the Google Docs API turned on
in its Google Cloud project.
"""

import re
import threading
import time

SCOPE = "https://www.googleapis.com/auth/documents.readonly"
SHARED = ("general", "all accounts", "agency", "common", "overall", "global", "all clients")
CACHE_SECONDS = 60
PSEUDO_HEADING_MAX = 80   # a plain line this short, naming an account, starts its part


class DocError(Exception):
    def __init__(self, message, kind="doc"):
        super().__init__(message)
        self.kind = kind


# ── The doc's address ────────────────────────────────────────────────────────
def doc_id(value):
    """The document ID from a Google Docs link or a bare ID; "" if it is neither."""
    value = (value or "").strip()
    m = re.search(r"/document/(?:u/\d+/)?d/([A-Za-z0-9_-]{20,})", value)
    if m:
        return m.group(1)
    return value if re.fullmatch(r"[A-Za-z0-9_-]{20,}", value) else ""


def doc_url(did):
    return "https://docs.google.com/document/d/%s/edit" % did


# ── Reading ──────────────────────────────────────────────────────────────────
_CACHE = {}
_LOCK = threading.Lock()


def fetch(service_factory, did, sa_email="", force=False):
    """The document (with every tab's content), cached for CACHE_SECONDS."""
    now = time.time()
    with _LOCK:
        hit = _CACHE.get(did)
        if hit and not force and now - hit[0] < CACHE_SECONDS:
            return hit[1]
    try:
        svc = service_factory()
        doc = svc.documents().get(documentId=did, includeTabsContent=True).execute()
    except DocError:
        raise
    except Exception as exc:
        raise _explain(exc, sa_email)
    with _LOCK:
        _CACHE[did] = (now, doc)
    return doc


def clear_cache():
    with _LOCK:
        _CACHE.clear()


def _explain(exc, sa_email):
    """Google's error, as what to do about it."""
    status = getattr(getattr(exc, "resp", None), "status", None)
    text = str(getattr(exc, "reason", "") or exc)
    if status == 403 and ("has not been used" in text or "is disabled" in text or "SERVICE_DISABLED" in text):
        link = re.search(r"https://console\.developers\.google\.com/apis/api/docs\.googleapis\.com/overview\?project=\d+", text)
        return DocError("The Google Docs API is turned off for the service account's Google Cloud project. Turn it on%s "
                        "(one click, then wait a minute) and try again." %
                        (" here: " + link.group(0) if link else " in Google Cloud Console → APIs & Services"),
                        kind="api_off")
    if status in (403, 404):
        return DocError("The service account cannot open this doc. In the doc, click Share and add %s as a Viewer." %
                        (sa_email or "the service account's email"), kind="not_shared")
    if status == 400:
        return DocError("That is not a Google Docs document ID or link.", kind="bad_id")
    return DocError("The Google Doc could not be read (%s)." % (status or type(exc).__name__))


# ── Text and structure ───────────────────────────────────────────────────────
def _level(style):
    """0 for the Title style, 1-6 for Heading 1-6, None for body text."""
    s = (style or {}).get("namedStyleType") or ""
    if s == "TITLE":
        return 0
    m = re.fullmatch(r"HEADING_(\d)", s)
    return int(m.group(1)) if m else None


def _lines(content):
    """[(heading level or None, text)] for a list of structural elements."""
    out = []
    for el in content or []:
        if "paragraph" in el:
            p = el["paragraph"]
            text = "".join((r.get("textRun") or {}).get("content", "") for r in p.get("elements", []))
            text = text.replace("\u000b", "\n").strip()
            if not text:
                continue
            bullet = "- " if p.get("bullet") else ""
            out.append((_level(p.get("paragraphStyle")), bullet + text))
        elif "table" in el:
            for row in el["table"].get("tableRows", []):
                cells = []
                for cell in row.get("tableCells", []):
                    cells.append(" ".join(t for _, t in _lines(cell.get("content"))))
                if any(c.strip() for c in cells):
                    out.append((None, " | ".join(c.strip() for c in cells)))
    return out


def tabs(doc):
    """[(tab title, [(level, text)])] for every tab, nested tabs included; a doc without
    tabs is one untitled tab."""
    if not doc.get("tabs"):
        return [("", _lines(((doc.get("body") or {}).get("content"))))]
    out = []

    def walk(ts):
        for t in ts:
            title = (t.get("tabProperties") or {}).get("title") or ""
            body = ((t.get("documentTab") or {}).get("body") or {}).get("content")
            out.append((title, _lines(body)))
            walk(t.get("childTabs") or [])
    walk(doc["tabs"])
    return out


def _norm(s):
    return " ".join(re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).split())


def owner(text, accounts, cids=None, shortened=False):
    """The account a heading or tab title names, or None: the longest account name it contains; else
    its customer ID; else, with `shortened` (tab titles only), the one account whose name starts with
    it word for word, such as "Hare Krishna" (at least 4 letters, never when two accounts do). Headings
    and lines inside a tab never match a shortened name: an ordinary heading such as "Outcomes" must not
    be read as an account called "Outcomes Digital"."""
    t = " %s " % _norm(text)
    best = None
    for a in accounts:
        n = _norm(a)
        if n and " %s " % n in t and (best is None or len(n) > len(_norm(best))):
            best = a
    if best is None and cids:
        digits = re.sub(r"\D", "", text or "")
        for a, cid in cids.items():
            d = re.sub(r"\D", "", cid or "")
            if len(d) >= 8 and d in digits:
                return a
    if best is None and shortened:
        short = _norm(text)
        if len(short.replace(" ", "")) >= 4:
            starts = [a for a in accounts if (_norm(a) + " ").startswith(short + " ")]
            if len(starts) == 1:
                return starts[0]
    return best


def _shared(text):
    n = _norm(text)
    return any(n == s or n.startswith(s + " ") for s in SHARED)


def _md(lines):
    return "\n".join(("#" * max(lv, 1) + " " + tx) if lv is not None else tx for lv, tx in lines)


def parts(doc, accounts, cids=None):
    """{"accounts": {account: [(where, text)]}, "shared": [(where, text)]} for the whole doc."""
    found, shared = {}, []
    for title, lines in tabs(doc):
        who = owner(title, accounts, cids, shortened=True) if title else None
        if who:
            found.setdefault(who, []).append(("tab “%s”" % title, _md(lines)))
            continue
        if title and _shared(title):
            shared.append(("tab “%s”" % title, _md(lines)))
            continue
        # Headings (and short lines naming an account) split the tab into parts.
        i = 0
        while i < len(lines):
            lv, tx = lines[i]
            is_head = lv is not None
            who = owner(tx, accounts, cids) if (is_head or len(tx) <= PSEUDO_HEADING_MAX) else None
            shared_head = is_head and _shared(tx)
            if not who and not shared_head:
                i += 1
                continue
            j = i + 1
            while j < len(lines):
                lv2, tx2 = lines[j]
                if lv2 is not None and (lv is None or lv2 <= lv):
                    break
                if lv is None and len(tx2) <= PSEUDO_HEADING_MAX and owner(tx2, accounts, cids):
                    break
                j += 1
            chunk = _md(lines[i:j])
            where = ("heading “%s”" if is_head else "line “%s”") % tx[:80]
            if who:
                found.setdefault(who, []).append((where, chunk))
            else:
                shared.append((where, chunk))
            i = j
    return {"accounts": found, "shared": shared}


def context_for(doc, account, accounts, cids=None):
    """The account's part of the doc, with the shared parts, as one text; and where it came from."""
    p = parts(doc, accounts, cids)
    mine, shared = p["accounts"].get(account, []), p["shared"]
    text = ""
    if shared:
        text += "\n\n".join("<shared_notes source=\"%s\">\n%s\n</shared_notes>" % (w, t) for w, t in shared)
    if mine:
        text += ("\n\n" if text else "") + "\n\n".join(t for _, t in mine)
    return {"found": bool(mine), "text": text.strip(), "where": [w for w, _ in mine],
            "shared_where": [w for w, _ in shared], "title": doc.get("title") or "",
            "revision": doc.get("revisionId") or ""}


def coverage(doc, accounts, cids=None):
    """Which accounts have a part in the doc, and which do not."""
    p = parts(doc, accounts, cids)
    return {"with": sorted(a for a in accounts if a in p["accounts"]),
            "without": [a for a in accounts if a not in p["accounts"]],
            "shared": [w for w, _ in p["shared"]]}
