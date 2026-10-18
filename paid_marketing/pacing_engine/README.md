# Pacing engine

The Pacing Desk's budget engine (`tracker/paid_refresh.py` runs it in a subprocess on fresh Google Ads and Meta
numbers; nothing here talks to an ad platform). It judges every account on what it has spent this month against
its monthly budget and suggests budget moves between campaigns, all as plain arithmetic:

- `pacing.py` the ideal pace and the schedule math; `engine.py` the moves; `categories.py` campaign to category;
- `loaders.py` and `gads.py` the inputs; `validate.py` twelve self-checks on every run;
- `export_dashboard.py` the dashboard the page reads; `slack_fmt.py` a Slack-ready text file (nothing posts it);
- `config.py` every number a PPC lead would argue about.

Per-client rules (a target cost per lead, the categories that carry the spend, a naming rule, accounts that are
paused, aliases between Google Ads and the budget tracker) are data, never code: a JSON file named by
`PACING_CLIENT_RULES` (see `config.py`). With none, every client is scored by the generic policy.
