# Paid Marketing Agents

The paid media (PPC) team's agents, ported from the source platform (`ai-positon2/intelligence-platform`, commit
`ddfd61d`) by copying its code and adapting it, never rewriting it: that code carries fixes found against real Google
Ads and Meta accounts. They sit on the Operational Agents page with a **Paid marketing** pill, at
`/operational-agents/<agent>` (first on that page, ahead of the SEO tools), and open inside every client
workspace. Their JSON routes are under `/strategic-agents/paid-marketing/api/`; the pages' old addresses,
`/strategic-agents/paid-marketing/<agent>`, redirect.

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
| 3b | Segment Analysis, with the agents' spend ledger | Done |
| 3c | Geo Performance | Done |
| 3d | Seasonality Analysis | Done |
| 3e | Ad Strength Analysis | Done |
| 3f | Audience Segment Analysis | Done |
| 3g | Asset Coverage Audit | Done |
| 4a | Account Audit | Done |
| 4b | Landing Page Check | Done |
| 4c | Experiment Tracker | Done |
| 5a | Pacing Desk, the engine's client rules moved to data | Done |
| 5b | Search Query Analysis, with the source's client rulebooks taken out | Done |
| 6a | QA Agent | Done |
| 6b | Business Research, Keyword Research, Strategy and Campaign Book (one build machinery, one PR) | Done |
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

- Each agent is in `ACCT_AGENTS` (from the catalog), so it opens at `/<account>/operational-agents/<slug>`
  (beside the account's SEO tools; its address before 2026-10-19, `/<account>/agents/<slug>`, redirects).
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

The three research builds (Business Research, Keyword Research, Strategy and Campaign Book) run in a background
thread and already total what each build spent, model and web search, in `pm_strategies.cost`; the admin panel
reads that with the person who started it and the workspace it was started in (`inputs.space`), so those calls
are not booked twice. **Social Media Intelligence** inside a build is a paid Apify run: its card starts off and
runs only when turned on, and its run is filed in the build's workspace, where its own ledger (`sci_spend_log`)
shows it. Campaign names carry the agency's prefix, `PAID_CAMPAIGN_PREFIX` (default `NA`); the QA Agent's name
check accepts any prefix, or none.

## Variables (Railway → web → Variables)

| Variable | For |
|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Every Google Ads read (every agent but the research builds' website reading) |
| `GOOGLE_ADS_DAILY_LIMIT` | Optional: the app's own daily ceiling on Google Ads requests. Default 14,000, below Google's 15,000 a day on Basic access (the project moved from Explorer, 2,880 a day, on 2026-10-19). Raise it after a move to Standard access |
| `META_ADS_ACCESS_TOKEN` (a System User token with `ads_read`; `business_management` too for pixel stats), optional `META_BUSINESS_ID`, `META_API_VERSION` | Every Meta read |
| `ANTHROPIC_API_KEY` (already set) | The written parts: Segment, Geo, Ad Strength, Account Audit, Landing Page Check, QA Agent, Search Query Analysis, and the three research builds |
| `PAGESPEED_API_KEY` | Optional: the Landing Page Check's lab speed test |
| `PACING_SEED_SECRET` | Optional: lets the pacing engine push a run from a machine (`pacing_engine/push.py`) |
| `PACING_CLIENT_RULES` | Optional: a JSON file of per-client pacing rules (`pacing_engine/config.py`) |
| `PAID_CAMPAIGN_PREFIX` | Optional: the agency's campaign name prefix in the campaign books (default `NA`) |
| `CALLRAIL_API_KEY` | The Call Transcript Analyzer, when it is built |

## Known limitations (carried over from the source, stated honestly)

- A Meta token without `business_management` leaves pixel stats and business info "unknown" (Account Audit checks
  M-TRK-03, M-TRK-05, M-ACC-03).
- Segment Analysis's "All" cost per lead mixes Meta result kinds; the weekly overlay on partial weeks is not aligned.
- Keyword Research merges keys with symbols (c++ and c#) and reordered words (on purpose).
- The Performance Max business name account-level fallback, the Campaign Book's video limits and a Demand Gen
  portrait-only image rule are unverified; the Google speed score can come back empty (reported as unknown).
- The model-driven agents (Keyword Research, Business Research, Campaign Book, QA Agent) are verified by code and
  tests; a live model run costs money, so the first one should be deliberate and its cost read off the admin panel.
- Meta pacing was verified through the read probe and fakes, not a full production run.
- Large Google segment reports can be about 10 MB and take 45 seconds; the server runs gunicorn with
  `--timeout 120 --workers 2 --threads 4`, as the source did.
- Not built yet: the **Call Transcript Analyzer** (needs `CALLRAIL_API_KEY`, and a decision on how a CallRail
  account belongs to a client workspace; its data is HIPAA data and is never stored or sent to a model) and the
  **Client Feedback Agent** (needs Slack, Google and Zoom OAuth apps; its source code held client names and a real
  Drive folder, which must come out first).
