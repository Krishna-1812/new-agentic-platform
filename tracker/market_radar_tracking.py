"""Market Radar: which competitors the research covers.

The competitor list is a set of suggestions the user then goes through: Confirm the ones that matter,
Remove the ones that do not. Everything that costs time or money afterwards (the moves collection, the
scoring and reading of what was found, the rival cards, the written report) is about the competitors the
user chose, not every suggestion.

    rows = tracking.choose(store.competitors(client_id, owner))     # who to research
    tracking.summary(rows)                                         # what to tell the user

The rule is the same everywhere, and lives only here:

    * Once at least one competitor is confirmed, only the confirmed ones are researched. Suggestions that
      were neither confirmed nor removed are listed but left alone.
    * Before any is confirmed, nothing has been chosen yet, so every suggestion that has not been removed
      is researched, and the page says so plainly.
    * A removed competitor is never researched.
"""
from __future__ import annotations


def choose(rows):
    """The competitors to research, from the client's competitor rows (removed ones already dropped, or
    marked by status)."""
    live = [r for r in rows or [] if r.get("status") != "removed"]
    confirmed = [r for r in live if r.get("status") == "confirmed"]
    return confirmed or live


def summary(rows):
    """{"mode", "tracked", "not_tracked", "text"} for the page and the reports.

    mode is "confirmed" (only the ones you confirmed), "all_suggested" (nothing confirmed yet, so every
    suggestion) or "none"."""
    live = [r for r in rows or [] if r.get("status") != "removed"]
    chosen = choose(rows)
    if not live:
        return {"mode": "none", "tracked": 0, "not_tracked": 0, "text": "There are no competitors yet."}
    if any(r.get("status") == "confirmed" for r in live):
        left = len(live) - len(chosen)
        text = "Researching the %d competitor%s you confirmed." % (len(chosen), "" if len(chosen) == 1 else "s")
        if left:
            text += " %d suggestion%s not researched until confirmed." % (left, " is" if left == 1 else "s are")
        return {"mode": "confirmed", "tracked": len(chosen), "not_tracked": left, "text": text}
    return {"mode": "all_suggested", "tracked": len(chosen), "not_tracked": 0,
            "text": "No competitor is confirmed yet, so all %d suggestion%s %s being researched. Confirm the ones "
                    "that matter and only those will be." % (len(chosen), "" if len(chosen) == 1 else "s",
                                                             "is" if len(chosen) == 1 else "are")}
