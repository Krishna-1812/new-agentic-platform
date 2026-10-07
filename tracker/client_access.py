"""Client accounts: who outside the agency may open an account, and what they see.

An admin invites people to an account by email ("ana@lumina.in") or by their company's email domain
("@lumina.in"). They sign in with Google as that address and see that account only: its home and
whichever of its pages the account shares. Nothing is emailed; the admin sends them the link.

What an account shares (SHARES): the Google Ads dashboard, on unless turned off; the AI review and
the profile from the master doc, off unless turned on (the review is the agency's own critique of
the account, including whether it follows its brief, so sharing it is a choice).

Tools (TOOL_PREFIX + slug): each of the account's tools and agents, off unless turned on. A tool
that is on is the client's to open and run inside their account, and its finished work joins the
History they see (account_history.for_client). Every run a client starts counts against the
account's monthly limit (RUN_LIMIT, set in the same panel).

A domain that anyone can sign up to (gmail.com and the like) can never be invited as a whole, and
neither can the agency's own domain, whose people are staff and see every account anyway.
"""

from __future__ import annotations

import re

# (key, label, what it shows, on by default)
SHARES = (
    ("google-ads", "Google Ads dashboard", "Spend, results and every insight panel, for this account only", True),
    ("ai-review", "AI review", "Claude's latest finished review, including where the account does not follow its brief",
     False),
    ("profile", "Profile from the master doc", "Website, goals, audience, competitors and brand", False),
)
SHARE_KEYS = tuple(k for k, *_ in SHARES)
# An account's page -> the share that opens it to clients ("" is the account's home, always open).
PAGE_SHARE = {"": None, "google-ads": "google-ads", "google-ads/ai-review": "ai-review",
              "page-watch": "tool:page-watch", "video-studio": "tool:video-studio"}

PUBLIC_DOMAINS = {
    "gmail.com", "googlemail.com", "outlook.com", "outlook.in", "hotmail.com", "hotmail.co.uk", "hotmail.in",
    "live.com", "live.in", "msn.com", "yahoo.com", "yahoo.co.in", "yahoo.in", "yahoo.co.uk", "ymail.com",
    "rocketmail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me",
    "zoho.com", "zohomail.com", "zohomail.in", "rediffmail.com", "rediff.com", "gmx.com", "gmx.net", "mail.com",
    "yandex.com", "yandex.ru", "fastmail.com", "hey.com", "tutanota.com", "tuta.io", "duck.com", "qq.com",
    "163.com", "126.com", "naver.com",
}
_EMAIL = re.compile(r"^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$")
_DOMAIN = re.compile(r"^@?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$")


class Bad(ValueError):
    pass


def normalise(who, staff_domain):
    """An invite as stored: a lower-case email, or "@domain". Raises Bad with what to fix."""
    w = (who or "").strip().lower().replace("mailto:", "")
    w = re.sub(r"^.*<([^>]+)>.*$", r"\1", w).strip()
    if not w:
        raise Bad("Type an email address, or @ and a company domain.")
    m = _EMAIL.match(w)
    if m:
        if m.group(1) == staff_domain:
            raise Bad("People at %s are staff: they see every account already." % staff_domain)
        return w
    m = _DOMAIN.match(w)
    if m and "." in m.group(1):
        d = m.group(1)
        if d == staff_domain:
            raise Bad("People at %s are staff: they see every account already." % staff_domain)
        if d in PUBLIC_DOMAINS:
            raise Bad("Anyone can have an address at %s, so it cannot be invited as a whole. Invite the person's "
                      "own address instead." % d)
        return "@" + d
    raise Bad("That is not an email address or a domain. Try name@company.com or @company.com.")


def matches(email, entries):
    """True when a signed-in address is one of the invites: itself, or its domain."""
    e = (email or "").strip().lower()
    if "@" not in e:
        return False
    return e in entries or ("@" + e.rsplit("@", 1)[1]) in entries


TOOL_PREFIX = "tool:"
RUN_LIMIT = "runs_per_month"
RUN_LIMIT_DEFAULT = 20
RUN_LIMIT_MAX = 500


def tool_key(slug):
    return TOOL_PREFIX + slug


def shared(stored, tools=()):
    """{share: on} with the defaults filled in: the pages, then each tool in `tools` (slugs), off
    unless turned on. Anything stored that is neither (an old share) is left out."""
    stored = stored or {}
    out = {k: bool(stored.get(k, default)) for k, _, _, default in SHARES}
    out.update({tool_key(t): stored.get(tool_key(t)) is True for t in tools})
    return out


def tools_on(shares):
    """The slugs of the tools these shares turn on."""
    return [k[len(TOOL_PREFIX):] for k, on in (shares or {}).items() if on and k.startswith(TOOL_PREFIX)]


def run_limit(stored):
    """The account's monthly limit on runs its clients start."""
    try:
        n = int((stored or {}).get(RUN_LIMIT, RUN_LIMIT_DEFAULT))
    except (TypeError, ValueError):
        n = RUN_LIMIT_DEFAULT
    return max(0, min(RUN_LIMIT_MAX, n))


def page_open(page, shares):
    """True when a client may open an account's page with these shares."""
    s = PAGE_SHARE.get(page, "__never__")
    if s is None:
        return True
    return bool(shares.get(s))


def view(entries, shares, audit=(), tools=(), limit=RUN_LIMIT_DEFAULT, used=0):
    """What the Share panel shows. `tools` is [{"slug", "label", "about", "group"}], in order."""
    return {"people": [{"who": e["who"], "kind": "domain" if e["who"].startswith("@") else "email",
                        "added_by": e.get("added_by", ""), "added_at": e.get("created_at")} for e in entries],
            "shares": [{"key": k, "label": label, "about": about, "on": bool(shares.get(k))}
                       for k, label, about, _ in SHARES],
            "tools": [dict(t, key=tool_key(t["slug"]), on=bool(shares.get(tool_key(t["slug"])))) for t in tools],
            "limit": limit, "used": used, "limit_max": RUN_LIMIT_MAX,
            "audit": list(audit)}
