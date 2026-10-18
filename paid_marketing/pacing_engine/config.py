"""Budget Optimization Agent — tunable policy.

Every number a PPC lead would argue about lives here, not in the engine.
"""

# ---------------------------------------------------------------- pacing band
# Ideal pacing = (today - 1) / days_in_month  e.g. 6/30 = 20.00% on Sep 7 2026.
# A campaign/account is "on pace" inside [ideal - LOWER_TOL, ideal + UPPER_TOL].
UPPER_TOL_PP = 2.0   # allowed to run up to 2pp AHEAD of ideal  (the team's rule)
LOWER_TOL_PP = 1.0   # small grace below ideal before we call it underpacing

# Which benchmark drives the verdict:
#   "calendar"  -> (day-1)/days_in_month           <- the team's stated rule (default)
#   "schedule"  -> active_days_elapsed/active_days (respects Mon-Fri etc.)
#   "baseplan"  -> planned-to-date from the sheet's own base plan
PACING_BENCHMARK = "calendar"

# ------------------------------------------------------------ move guardrails
MIN_MOVE_PER_DAY      = 5.00   # $/day — anything smaller is noise, suppress
MIN_MOVE_REL          = 0.10   # and must be >=10% of the campaign's daily budget
MAX_DONATE_REL        = 0.30   # never strip more than 30% of a campaign in one go
MAX_RECEIVE_REL       = 0.50   # never more than +50% in one go (bid-strategy safety)
MAX_MOVES_PER_ACCOUNT = 4      # per LOCATION group
MAX_MOVES_PER_ACCOUNT_TOTAL = 8  # per account across all its locations

# Learning-phase protection: campaign types that reset when budget swings hard.
# Relative cap applied on INCREASES only.
TYPE_RECEIVE_CAP = {
    "Performance Max": 0.30,
    "Pmax":            0.30,
    "Demand Gen":      0.30,
    "Video":           0.30,
}

# Floors — share of the account's daily budget a type must keep.
# Brand is cheap insurance; starving it hands your own name to competitors.
TYPE_MIN_SHARE = {
    "Brand": 0.05,
}
# Ceilings — stop any one type eating the account.
TYPE_MAX_SHARE = {
    "Brand":           0.35,
    "Performance Max": 0.55,
    "Pmax":            0.55,
}

# ------------------------------------------------------------ scoring weights
W_EFFICIENCY = 0.40   # CPA vs target
W_VOLUME     = 0.25   # share of conversions produced
W_ABSORPTION = 0.25   # can it actually spend more? (budget-capped signal)
W_TYPE       = 0.10   # strategic type preference

# Strategic preference by type when all else is equal (0..1)
TYPE_PREFERENCE = {
    "Brand":           0.55,
    "Non Brand":       0.75,
    "Generic":         0.65,
    "Performance Max": 0.60,
    "Pmax":            0.60,
    "Demand Gen":      0.45,
    "Shopping":        0.60,
}
DEFAULT_TYPE_PREFERENCE = 0.55

# -------------------------------------------------------------- data quality
TRAILING_DAYS      = 7     # active days used for run-rate / absorption
ZERO_CONV_SPEND_X  = 1.5   # spend >= 1.5x target CPA with 0 conv = strong donor
MIN_SPEND_TO_JUDGE = 25.0  # below this MTD spend, don't judge CPA — too thin

# The tracker's "Target CPA/ROAS/CPM" column mixes units. If an account's
# blended CPA exceeds the stated target by more than this multiple, the number
# is not a CPA and is ignored rather than trusted.
TARGET_CPA_IMPLAUSIBLE_X = 5.0

# Efficiency index clipping (target_cpa / actual_cpa)
EFF_CLIP_LO, EFF_CLIP_HI = 0.25, 2.50

# --------------------------------------------------------- per-client rules
# How a specific client is actually managed, in their own terms. Overrides the
# generic scoring where the team has an explicit policy.
#
#   target_cpl   : the number the team judges against, overriding the tracker's
#                  "Target CPA/ROAS/CPM" column
#   major        : categories that legitimately carry most of the spend
#   minor_floor  : $/day floor for every other category
#   floor_relief : when the account is on track to UNDERSPEND, the minor floor
#                  is allowed to rise to this multiple of itself, so the small
#                  campaigns soak up the surplus instead of Brand/PMax
# Per-client rules are data, never code: a JSON file named by PACING_CLIENT_RULES (the platform writes it), keyed
# by the client as the budget tracker names it, lower case, e.g.
#   {"rules": {"acme dental": {"target_cpl": 40, "major": ["Brand", "PMax"], "minor_floor": 5, "floor_relief": 4,
#                              "type_max_share": {"Brand": 0.85}}},
#    "paused": ["an account deliberately paused"],
#    "aliases": {"google ads account name": "Budget Tracker account name"},
#    "split": ["a google ads account that holds many budgeted locations"],
#    "by_location": ["a google ads account whose <Location>_<Type> campaigns share one budget line"]}
# With no file, every client is scored by the generic policy above.
def _client_data():
    import json
    import os
    path = os.environ.get("PACING_CLIENT_RULES", "")
    if not path:
        return {}, {}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    rules = {}
    for name, rule in (data.get("rules") or {}).items():
        rule = dict(rule)
        if "major" in rule:
            rule["major"] = set(rule["major"])
        rules[str(name).lower()] = rule
    return rules, data


CLIENT_RULES, _DATA = _client_data()
ACCOUNT_ALIASES = {str(k).lower(): v for k, v in (_DATA.get("aliases") or {}).items()}
SPLIT_ACCOUNTS = {str(a).lower() for a in _DATA.get("split") or []}
LOCATION_ACCOUNTS = {str(a).lower() for a in _DATA.get("by_location") or []}

# ------------------------------------------------------------------- output
CURRENCY = "$"
SLACK_CHANNEL_ID = ""              # the Slack text is written to a file; nothing posts it

# Accounts deliberately paused. Suppressed from "budget but no data" warnings
# so a known-quiet account never reads as a missing-data problem.
PAUSED_ACCOUNTS = {str(a).lower() for a in _DATA.get("paused") or []}
