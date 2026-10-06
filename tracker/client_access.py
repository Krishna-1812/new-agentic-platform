"""Client accounts: who outside the agency may open an account, and what they see.

An admin invites people to an account by email ("ana@lumina.in") or by their company's email domain
("@lumina.in"). They sign in with Google as that address and see that account only: its home and
whichever of its pages the account shares. Nothing is emailed; the admin sends them the link.

What an account shares (SHARES): the Google Ads dashboard, on unless turned off; the AI review and
the profile from the master doc, off unless turned on (the review is the agency's own critique of
the account, including whether it follows its brief, so sharing it is a choice).

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
PAGE_SHARE = {"": None, "google-ads": "google-ads", "google-ads/ai-review": "ai-review"}

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


def shared(stored):
    """{share: on} with the defaults filled in."""
    stored = stored or {}
    return {k: bool(stored.get(k, default)) for k, _, _, default in SHARES}


def page_open(page, shares):
    """True when a client may open an account's page with these shares."""
    s = PAGE_SHARE.get(page, "__never__")
    if s is None:
        return True
    return bool(shares.get(s))


def view(entries, shares, audit=()):
    """What the Share panel shows."""
    return {"people": [{"who": e["who"], "kind": "domain" if e["who"].startswith("@") else "email",
                        "added_by": e.get("added_by", ""), "added_at": e.get("created_at")} for e in entries],
            "shares": [{"key": k, "label": label, "about": about, "on": bool(shares.get(k))}
                       for k, label, about, _ in SHARES],
            "audit": list(audit)}
