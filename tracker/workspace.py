"""Spaces: where a piece of work is saved, and who may see it (docs/account-memory-plan.md).

Every saved piece of work (a watch, a video, and from phase 2 an agent's run) has a space:

  "acct:<id>"   a client account's, by the account's stable id (client_accounts_store). Every staff
                member sees it and can carry it on; it shows who ran each piece. Nothing in one
                account's space is ever read for another.
  "me:<email>"  a person's own General work, not for any account. Only they see it.
  ""            work saved before spaces existed. It counts as its owner's General work until
                claim_legacy() moves it to the account its client name names.

The pages that read these are staff-only (/strategic-agents/*, and an account's tools); clients reach
an account's work only through the account's sharing settings, never through these reads.
"""

from __future__ import annotations

ACCOUNT = "acct:"
PERSONAL = "me:"


def _norm(email):
    return (email or "").strip().lower()


def account(account_id):
    return "%s%d" % (ACCOUNT, int(account_id))


def personal(email):
    return PERSONAL + _norm(email)


def is_account(space):
    return isinstance(space, str) and space.startswith(ACCOUNT) and space[len(ACCOUNT):].isdigit()


def account_id(space):
    return int(space[len(ACCOUNT):]) if is_account(space) else None


def personal_spaces(email):
    """The spaces that are `email`'s General work: their own, and work saved before spaces."""
    return ("", personal(email))


def can_see(viewer, space, owner):
    """A staff member sees every account's work, and their own General work."""
    return is_account(space) or (_norm(viewer) == _norm(owner) and space in personal_spaces(owner))


def can_delete(viewer, owner, admin=False):
    """Only whoever made it, or an admin, removes a piece of work."""
    return admin or _norm(viewer) == _norm(owner)


def legacy_names(accounts):
    """{lower-case client name: space} for claiming work saved before spaces. A name that two accounts
    answer to belongs to neither: that work stays its owner's rather than going to the wrong client."""
    seen, out = {}, {}
    for a in accounts:
        if a.get("id") is None:
            continue
        for n in {(x or "").strip().lower() for x in [a.get("name")] + list(a.get("ads_names") or [])}:
            if not n:
                continue
            seen[n] = seen.get(n, 0) + 1
            out[n] = account(a["id"])
    return {n: s for n, s in out.items() if seen[n] == 1}


def claim_legacy(accounts):
    """Move work saved before spaces into the account its client name names. Only rows with no space
    are touched, so work filed on purpose (an account's, or someone's General) never moves. Returns
    {"watches": n, "videos": n}."""
    from tracker import video_store, watch_store
    names = legacy_names(accounts)
    if not names:
        return {"watches": 0, "videos": 0}
    return {"watches": watch_store.claim_legacy(names), "videos": video_store.claim_legacy(names)}


# ── SQL, for the stores ──────────────────────────────────────────────────────
# One definition of who reaches a row, used by every store that keeps work in spaces. A row's
# `space` column holds the space; its `email` column its maker. Literal SQL, no % signs, so it can be
# formatted into a psycopg2 query that also takes parameters.
ACCOUNT_SQL = "^acct:[0-9]+$"


def seen_sql(alias=""):
    """"Theirs, or a client account's": `email` (one %s parameter) may reach the row."""
    p = alias + "." if alias else ""
    return "(%semail = %%s OR %sspace ~ '%s')" % (p, p, ACCOUNT_SQL)


def list_sql(email, space=None, alias=""):
    """(where, args) for a list: a client account's rows (everyone's), or `email`'s own General ones."""
    p = alias + "." if alias else ""
    if space is not None:
        if not is_account(space):
            raise ValueError("not an account's space: %r" % space)
        return "%sspace = %%s" % p, [space]
    return "%semail = %%s AND %sspace = ANY(%%s)" % (p, p), [_norm(email), list(personal_spaces(email))]


def mem_seen(row, email):
    """The in-process stores' form of seen_sql."""
    return email is None or row.get("email") == _norm(email) or is_account(row.get("space"))


def mem_listed(row, email, space=None):
    """The in-process stores' form of list_sql."""
    if space is not None:
        return row.get("space") == space
    return row.get("email") == _norm(email) and row.get("space", "") in personal_spaces(email)
