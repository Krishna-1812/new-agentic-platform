# Paid Marketing Agents

The paid media (PPC) team's agents, ported from the source platform (`ai-positon2/intelligence-platform`, commit
`ddfd61d`) by copying its code and adapting it, never rewriting it: that code carries fixes found against real Google
Ads and Meta accounts. They sit on the Operational Agents page with a **Paid marketing** pill, at
`/strategic-agents/paid-marketing/<agent>`, and open inside every client workspace.

## The rules carried over

- **Read only** toward the ad platforms: Google Ads GAQL `search` and Meta Graph `GET`. No write path, anywhere.
- **Credentials only from the environment**, never logged, returned or put in a URL. A missing one is named and the
  rest of the page still works. The Google Ads manager account comes only from `GOOGLE_ADS_LOGIN_CUSTOMER_ID`: the
  source's default MCC was removed, so an unset one is reported, never replaced.
- **A failure never looks like a result**: a failed read shows as failed or unknown, never as zero or a pass.
- **No em or en dashes** in anything shown or written (model output is stripped of them).
- **Exports are formula-safe**, and every fetch of a user or model supplied URL goes through
  `tracker/event_intel_http.public_get`.

## Status

| Step | What | State |
|---|---|---|
| 1 | The backend: every `tracker/paid_*` module and its module tests | Done (#153) |
| 2 | Performance Summarizer, with the shared page layout, the cards and the workspace wiring | Done |
| 3a | Product Analysis | Done |
| 3b | Segment Analysis, with the agents' spend ledger | This PR |
| 3c | Geo Performance | Done |
| 3d | Seasonality Analysis | Done |
| 3e | Ad Strength Analysis | Done |
| 3f | Audience Segment Analysis | Done |
| 3g | Asset Coverage Audit | Next |
| 4 | Account Audit, Landing Page Check, Experiment Tracker | One PR each |
| 5 | Pacing Desk and Search Query Analysis, with the source's client data taken out | One PR each |
| 6 | Business Research, Keyword Research, Strategy and Campaign Book, QA Agent | One PR each |
| 7 | Call Transcript Analyzer (needs `CALLRAIL_API_KEY`) and Client Feedback (needs Slack and Google OAuth apps) | When those exist |

**Held back from step 1, with their tests:** the Pacing Desk (`paid_pacing*`, `paid_refresh*` and the vendored
engine), Search Query Analysis (`paid_sqr*`) and the Client Feedback Agent (`paid_feedback`). Their code holds the
source's real client names: per-client budget rules, query rulebooks and example prompts. Each comes in its own PR
with those taken out and the algorithm kept.

**What changed from the source in step 1:** the source company's name in model prompts, PDF footers and the fetch
user agents is now the agency's or the brand's (`brand.BRAND`); staff addresses in the tests are the platform's;
the design docs say "the agency". `market_radar_llm` keeps the model's token usage on every reply (the cost ledger
reads it). `pandas` (the pacing engine) and `cryptography` (encrypted OAuth tokens) are in `requirements.txt`.

## How a page is put together

- **The frame** is Northaxis's: `templates/_paid_base.html` (the head, the top bar with Operational Agents >
  Paid marketing > the agent, the paper shell) and the ink hero, `paid_hero` in `templates/_paid_macros.html`.
- **The page itself** is the source's template body and script, unchanged in what they draw into. Its sheet,
  `static/css/paid_marketing.css`, keeps the source's classes; the pages set `data-theme="light"` so its light
  rules apply, and the block at the end maps every `--pm-*` colour onto Northaxis's tokens (one orange accent as
  a fill, its text-safe `--acc-tx` wherever it is the colour of text). The charts use Northaxis's hues
  (`static/js/ps_data.js`), deepened for the white ground.
- **The list** is `tracker/paid_catalog.py`: each agent's slug, page, card words, client routes and runs. The
  Operational Agents page draws the amber "Paid marketing" group from it, each card with a "Paid marketing" pill.

## In every client workspace

- Each agent is in `ACCT_AGENTS` (from the catalog), so it opens at `/<account>/agents/<slug>`.
- **Inside a workspace it reads only that workspace's own Google Ads accounts**, its profile's customer ids
  (`app.py _pm_scope`), for the team and for a client alike; no Meta ad account, since a workspace names none
  yet. A workspace with no customer id says how to add one.
- A client the workspace shares an agent with can use it on their own accounts and **keeps their own ad
  figures** (spend, cost per conversion): the platform's scrub of the agency's costs from client answers skips
  the paid agents. A route several agents share (the account list) is the client's when any of them is shared.
- **History:** a read inside a workspace is one row per agent, ad account and day (`tracker/paid_activity.py`,
  table `pm_activity`), read by `tracker/account_history.py`.

## What the agents spend

The written parts (the Segment Analysis summary, and later the audits, research and campaign books) are model
calls through `tracker/market_radar_llm.call_json`, outside any Market Radar run. A route that may spend wraps
the work in `paid_spend.charging(agent, email, space)`; every call inside it is priced at the model that
served it and written to `pm_spend` (`tracker/paid_spend.py`), including a reply that came back cut off. The
admin panel reads it with one `SOURCES` entry per agent in `tracker/admin_spend.py`. Ad platform reads cost
nothing per call and are not booked.

## Variables (Railway → web → Variables)

| Variable | For |
|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Every Google Ads read |
| `META_ADS_ACCESS_TOKEN` (a System User token with `ads_read`), optional `META_BUSINESS_ID`, `META_API_VERSION` | Every Meta read |
| `ANTHROPIC_API_KEY` | The written parts (already set) |
| `PAGESPEED_API_KEY` | Optional: the Landing Page Check's speed score |
