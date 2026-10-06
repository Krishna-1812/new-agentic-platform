# Handoff: the whole platform, for a new Claude Code session

Written 2026-10-02 to move this work to a different Claude account. **Read this file first.** It describes the platform as it is on `main` at `59b1862` (PR #46), how to work in this repo, what was built and in what order, what is still open, and the rules that must not be broken.

For older, deeper history of individual agents (Contact Finder, Event & Conference Intelligence, Social Media Intelligence and so on), see `docs/CONTEXT_FOR_NEW_CHAT_V30.md`. That file was written for the original Position² codebase before it was imported here. Its agent internals are still accurate, but several platform-level facts in it are out of date. Section 13 lists them.

---

## Contents

1. [What this is](#1-what-this-is)
2. [Quick facts](#2-quick-facts)
3. [How to work in this repo](#3-how-to-work-in-this-repo)
4. [Rules that must never be broken](#4-rules-that-must-never-be-broken)
5. [Repo map](#5-repo-map)
6. [Surfaces, sign-in and access](#6-surfaces-sign-in-and-access)
7. [What the platform does](#7-what-the-platform-does)
8. [Google Ads dashboard, in depth](#8-google-ads-dashboard-in-depth-the-most-recent-work)
9. [Local Business Radar](#9-local-business-radar)
10. [Environment variables](#10-environment-variables-railway--web--variables)
11. [Deploy and operations](#11-deploy-and-operations)
12. [History: every PR in this repo](#12-history-every-pr-in-this-repo)
13. [What `CONTEXT_FOR_NEW_CHAT_V30.md` gets wrong now](#13-what-context_for_new_chat_v30md-gets-wrong-now)
14. [Open items](#14-open-items)
15. [Gotchas learned the hard way](#15-gotchas-learned-the-hard-way)
16. [Moving to a new Claude account: what does and does not carry over](#16-moving-to-a-new-claude-account-what-does-and-does-not-carry-over)
17. [The prompt to paste into the new session](#17-the-prompt-to-paste-into-the-new-session)

---

## 1. What this is

A Flask web platform of AI "agents" and dashboards for a digital-marketing agency. It started as a copy of Position²'s "Intelligence by Position²" platform and has been re-branded for a sister company. The staff are **Markify Digital** (`@markifydigital.com`).

On 2026-09-22 it was imported into this repo with fresh history (`2ddcc69`, byte-identical to the source). Since then it has been:

- redesigned twice: first on "Bento", then on the "Outcomes" design language;
- moved off the `/p2` URL prefix;
- given SEO Studio inside the repo;
- given a new agent, **Local Business Radar**;
- given a **Google Ads dashboard** with deep insights, multi-currency conversion and a Claude-powered **AI review** that checks each account against a running Google Doc of account briefs.

The user-facing product name is a placeholder. `brand.py` holds the name "Northaxis", the domain "northaxis.com", the assistant name "Atlas" and the legal entity "Northaxis, Inc.". Every user-visible product string comes from `brand.py`, so renaming is a one-file edit once the real name is decided.

## 2. Quick facts

| | |
|---|---|
| Repo | `Krishna-1812/new-agentic-platform` (GitHub). Default branch `main`. |
| Working branch used so far | `claude/sharp-johnson-4i67y6`. A new session may be given a different branch name; use whatever it is told. |
| Live web app | `https://web-production-6748e.up.railway.app` (Railway service **web**). No custom domain yet; `app.markifydigital.com` was suggested. |
| SEO Studio | `https://seo-apps-production-37a6.up.railway.app` (Railway service built from `seo-apps/`) |
| Database | Railway Postgres (`DATABASE_URL`). Several features fall back to in-memory or SQLite when it is unset. |
| Hosting | Railway, **auto-deploys every push to `main`**. Railpack builder, gunicorn (`railway.toml`, `Procfile`), Python 3.11, ffmpeg via `railpack.json`. Health check `/health`. |
| Public marketing site | Also published as a static build to GitHub Pages from `/docs` (`index.html`, `agents/`, `platform/` …). |
| Admins | `ADMIN_EMAILS` in `app.py`: `sudheer@markifydigital.com`, `ladhakrishna2022@gmail.com`. Admins count as staff on any domain. |
| Staff gate | Any `@markifydigital.com` account (`brand.py` `staff_domain`, override with `STAFF_EMAIL_DOMAIN`), plus the admins. |
| Size | `app.py` ≈ 19,900 lines, 256 `@app.route`. `tracker/` ≈ 130 modules. 223 test files. |
| Tests | `PYTHONDONTWRITEBYTECODE=1 python3 -B -m pytest tests/ -q`. Last full run: **5,378 passed, 87 skipped, 0 failed**. CI (`run-tests.yml`) runs on every PR and push to `main`. |

## 3. How to work in this repo

**The owner's standing instruction** (given repeatedly; do not ask again): for every change, commit, push, **open the PR and merge it into `main`** once CI is green. Don't ask for confirmation each time. The flow:

1. Start from fresh `main`: `git fetch origin main && git checkout -B <branch> origin/main`.
2. Make the change, with tests. Run the targeted tests, then the whole suite.
3. Run the secret check from section 4. It must print nothing.
4. Commit. Use a plain-English subject that says what changed for the user, for example "Google Ads AI review: account context from one running Google Doc".
5. Push with `git push -u origin <branch>`. Use `--force-with-lease` when the branch was reset onto `main`.
6. Open the PR with the GitHub MCP tools. There is no `gh` CLI in the cloud sessions.
7. Subscribe to PR activity and schedule a check-in about 10 minutes later.
8. When every check is green (`pytest`, `postgres`, `build`, `deploy`, `report-build-status`), merge with the exact head SHA.
9. Then unsubscribe, delete the check-in, and reset the branch to the new `main`.

**Style of the code base.** Comments explain *why*, often citing the vendor documentation they rely on. User-facing text is plain, short English with no jargon and no em dashes in generated client copy. Front-end JavaScript builds DOM with `textContent`, never `innerHTML` with data. Every integration reads its key from the environment at call time and fails closed on that one feature; the rest of the app keeps working. Prefer extending the existing module for a feature over adding a new framework.

**Owner's preferences.** The owner is a CA, CMA, Registered Valuer and Insolvency Professional (20 years at Deloitte). They want accurate answers backed by references: vendor docs for Google Ads behaviour, and statute or standard for Indian law and accounting. No loose statements. They communicate briefly, often by screenshot, and expect step-by-step click paths when something has to be done in a third-party UI (Google Ads, Google Cloud, Railway, Google Docs).

**Checking a page in a browser.** Chromium and Playwright are available in cloud sessions. The established pattern: run the Flask app locally on a spare port with a fake staff session, or call the route through `app.test_client()`, then screenshot at 1440px and 390px wide and check for horizontal overflow and JS errors.

## 4. Rules that must never be broken

1. **No secrets in the repo, ever.** That covers service-account keys, API keys, the Google Ads sheet URL or ID, and the context Google Doc ID. The repo keeps the placeholder `PASTE_THE_GOOGLE_ADS_SHEET_URL_HERE` in the Ads scripts. Before every commit, run:

   ```bash
   grep -rlE 'BEGIN [P]RIVATE KEY|"private_key(_id)?"[[:space:]]*:' \
        --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=__pycache__ .
   ```

   Also grep for the service account's email and for the sheet and doc IDs if you have been given them. Every check must print nothing. The brackets in the pattern stop the command from matching its own text in this file.
2. **Never paste secret values into chat**, and never ask the owner to paste an API key into chat. Keys go into Railway → web → Variables.
3. **Personal data.** The Google Ads change history carries the email addresses of people who made changes. The analytics and login-log sheets hold user data. `data/identity_graph.db` (visitor PII) is gitignored. Read live data only when the owner has approved that specific read, and delete any local cache afterwards.
4. **Never weaken TLS** (no Chromium `--ignore-certificate-errors` and the like, no `verify=False`). Outbound HTTPS in cloud sessions goes through a proxy with its own CA bundle; see `/root/.ccr/README.md`.
5. **Don't kill processes with `pkill -f <pattern>`** or `grep [x]pattern`. The pattern matches the shell's own command line and kills it (exit 144). Find the PID by scanning `/proc/*/cmdline` for a command line that ends with the script name, then `kill` that PID.
6. Never skip, disable or quarantine a test to get CI green. Never force-push someone else's branch.
7. **`ADMIN_EMAILS` and `STAFF_EMAIL_DOMAIN` change together.** Changing one alone can lock the admins out.
8. Renaming a persisted URL or slug: the old one keeps redirecting (301), and every read keyed on the old slug is aliased too.

## 5. Repo map

```
app.py                 Every route: auth, hub, agents, dashboards, admin, client portals, APIs.
                       Section-comment banners act as its map. One file by design so far.
brand.py               Product naming (placeholder "Northaxis"), staff email domain.
tracker/               Domain logic, one module family per agent:
  google_ads_insights.py   reads the "Insights - …" tabs, date windows, currency, coverage
  gads_ai.py               AI review: data pack, targets, computed checks, Claude analysis
  gads_ai_doc.py           reads the context Google Doc, finds each account's part
  gads_ai_store.py         briefs, reviews, settings (Postgres or in-memory)
  client_accounts.py       client accounts: the list (Google Ads + master doc), URL names, numbers
  client_profile.py        the profile block at the top of an account's tab in the master doc
  client_accounts_store.py URL names kept for good, old ones redirect (Postgres or in-memory)
  lbr_*.py                 Local Business Radar (config, intake, discover, profile, website,
                           reviews, visibility, score, pipeline, store, report, apify, render)
  event_intel_*.py         Event & Conference Intelligence
  sci_*.py                 Social Media Intelligence
  tlpr_*.py, thought_leader_pr.py   Thought Leader Intelligence
  apollo_*.py              Contact Finder (Apollo.io)
  slot_checker*.py         42 North Dental Slot Checker
  job_change_*.py          Job Change Alert
  signal_score.py, news_*.py, change_detector.py …   ABM Signal Tracker
visitor_intelligence/  Anonymous-visitor de-anonymisation engine.
templates/             Jinja pages. google_ads_dashboard.html, google_ads_ai_review.html,
                       local_business_radar.html, lbr_report.html, hub.html, …
static/css, static/js  Per-page assets. google-ads-*.js/css (dashboard, insights, AI review).
                       Design tokens: Outcomes language (light paper, orange blocks, pill
                       buttons, Zalando Sans body, Fraunces headings).
scripts/google_ads/    The three Google Ads Scripts (run inside Google Ads, not on the server)
                       and their README. Read that README; it is detailed and current.
scripts/               Other operational scripts (dashboard refresh, snapshot imports, frontend build).
seo-apps/              SEO Studio: Node + React service, deployed as its own Railway service.
apps/ad-intelligence/  Ad Intelligence React/Vite source; built output committed in ad_intelligence/.
data/, reports/        Committed SQLite/JSON snapshots and pre-rendered HTML. Railway has no disk,
                       so these files are the durable store for the ABM tracker.
docs/                  The static public site for GitHub Pages, plus planning docs and this file.
tests/                 pytest suite, plus Node harnesses for the Google Ads Scripts
                       (google_ads_script_harness.js, google_ads_report_harness.js).
archive/               Git bundle of every branch of the original seo-apps repository.
main.py                ABM Signal Tracker weekly CLI (see README.md).
```

## 6. Surfaces, sign-in and access

Google Sign-In is open to any Google account, so access is split into surfaces:

| Surface | Who | Gate | Paths |
|---|---|---|---|
| Public marketing site | anyone | none | `/`, `/agents`, `/platform`, `/signals`, `/resources` … (`/privacy` and `/terms` were removed until outcomes.digital's own text is added) |
| Member workspace | any signed-in Google user | `@login_required` | `/app/*` |
| Internal staff app | `@markifydigital.com` and the admins | `@position2_required` (the decorator's name is historical) | `/hub`, `/strategic-agents/*`, `/seo-aeo/*`, `/dashboards/*`, `/abm-signal-tracker/*`, `/playbook/*` |
| Admin | `ADMIN_EMAILS` only | `@admin_required` | `/admin/*` |
| Client portals | per-client gate `_client_gate()` | | `/<client-slug>/*` (`CLIENTS` registry in `app.py`; currently `northstaranesthesia`) |
| Client accounts | staff; invited clients (email or domain) see their own account's shared pages | `_acct_view()` | `/<account>`, `/<account>/google-ads`, `/<account>/google-ads/ai-review` (see "Client accounts" below and `docs/account-workspaces-plan.md`) |

Old `/p2/*` URLs 301 to the new paths (PR #3). The hub (`/hub`) has three hero workspaces:

- **Dashboards**, which links to `/dashboards/google-ads`;
- **Agents**, at `/strategic-agents`;
- **SEO & AEO**, at `/seo-aeo`.

## 7. What the platform does

The agent catalogue is in `README.md`. That file was written before this repo, so read it with section 13 in mind. In short:

- **Strategic agents** (`/strategic-agents/*`): Contact Finder (Apollo), Job Change Alert, LinkedIn Strategy Researcher (Arena), 42 North Dental Slot Checker, Social Media Intelligence (Claude vision over six platforms plus Reddit), Event & Conference Intelligence, Thought Leader Intelligence, LinkedIn Intelligence, Competitor Ad Intelligence, ABM Signal Tracker, and **Local Business Radar** (new, section 9). LinkedIn Social Researcher is hidden (`HIDDEN_AGENT_SLUGS`).
- **SEO & AEO suite** (`/seo-aeo/*`): 18 tools from SEO Studio (`seo-apps/`), embedded in an iframe. The studio checks a per-user HMAC pass signed with `SEO_STUDIO_SECRET`. GBP QC Agent now lives inside SEO Studio.
- **ABM Signal Tracker**: one account, Healthcare, cut to its top 50 companies on 2026-09-24. CSG and NorthStar were removed. A weekly GitHub Action refreshes it, and signals older than 90 days age out.
- **Admin analytics** (`/admin/*`): usage, visitors, access requests, agent runs and feedback.
- **Assistant** (named by `brand.assistant`, "Atlas"): an embedded chat at `/api/ppc-chat` and `/api/vimi-chat/<account_id>`.

The agent roster is defined in several independent lists that must be edited together: `AGENTS`, `APP_AGENTS`, `HIDDEN_AGENT_SLUGS`, a JS array in `templates/context.html`, and the hand-written cards in `b2b_agents.html`.

## 8. Google Ads dashboard, in depth (the most recent work)

### 8.1 Data flow

```
Google Ads manager (MCC) account
  ├─ Script 3  export_campaign_report.js  → tab "Daily Campaign Performance" (moved to first position)
  ├─ Script 1  export_insights.js PART=1   → tabs "Insights - …" groups 1–2 (appended at the end)
  └─ Script 2  export_insights.js PART=2   → tabs "Insights - …" groups 3–4
                 │  (all three write ONE Google Sheet; its ID is the Railway variable GOOGLE_ADS_SHEET_ID)
                 ▼
Flask (web) reads the sheet with a read-only service account (GOOGLE_ADS_SHEET_SA_JSON, else GOOGLE_SA_JSON)
  ├─ _fetch_google_ads_rows()  campaign report rows, cached 15 min (app.py)
  ├─ tracker/google_ads_insights.py  insights tabs, cached 15 min, sliced to any date range
  └─ /dashboards/google-ads  page  +  /api/dashboards/google-ads/insights (filters)  +  /refresh
                 ▼
AI review  /dashboards/google-ads/ai-review
  ├─ reads the context Google Doc (Docs API, read-only, same service account)
  └─ Claude (ANTHROPIC_API_KEY) → stored in Postgres (gads_ai_* tables)
```

The server needs no Google Ads API developer token, because the scripts run inside Google Ads.

### 8.2 The three Google Ads Scripts (`scripts/google_ads/`)

Read `scripts/google_ads/README.md`. It has install steps, every tab, the limits and the sources.

- **`export_insights.js`** is installed twice in the manager account: "Dashboard insights part 1" with `PART = 1` and "Dashboard insights part 2" with `PART = 2`. Each gets Google's 60-minute allowance for manager scripts using `executeInParallel`, which covers at most 50 accounts. Both run daily: part 1 around 06:00, part 2 an hour later. Settings: `SPREADSHEET_URL`, `PART`, `ACCOUNT_IDS` (empty means every live client account; above 50, the top 50 by 30-day spend), `DAYS = 90`, `SETTLE_HOURS = 6`. It writes per-day "Daily" cells so the server can sum any date range. It never clears a tab when a new result is empty.
- **`export_campaign_report.js`** (PR #46, the newest) writes the **Daily Campaign Performance** tab. This used to come from a report scheduled in the Google Ads UI. It writes the same 22 columns, one row per campaign per day with impressions, for 30 days ending on each account's own yesterday. The Google Ads API has no converted-currency cost, so it converts to the manager account's currency at **ECB daily reference rates** from `api.frankfurter.app`. USD-pegged currencies use fixed pegs: AED 3.6725, SAR 3.75, QAR 3.64, OMR 0.3845, BHD 0.376, JOD 0.709. Row 2 states the rate source; the dashboard detects "European Central Bank" there and words its currency notes accordingly (`rate_source = "ecb"`). Google's own rates differ by about 0.5% (95.44 vs 95.88 USD→INR on one day checked). It must run **before** the insights scripts. **The old Google Ads scheduled report must be turned off** so the two don't overwrite each other.
- Tests run the scripts under Node against stand-ins for `AdsApp`, `SpreadsheetApp` and `Utilities`: `tests/google_ads_script_harness.js` and `tests/google_ads_report_harness.js`.

### 8.3 What the dashboard shows

- The main report comes from the campaign tab: account switcher, filters, four charts, sortable table, detail panels. It covers dates (Last day, 7D, 14D, 30D, All, custom), account, campaign type, status, search, and a focused campaign.
- **Insights panels** follow every filter: impression share (rebuilt exactly from daily eligible impressions, never averaged), budget pacing, search terms, keywords and Quality Score, devices, hours, locations, conversions and conversion-action setup checks, ads and ad strength, served combinations, ad assets, change history, optimisation score and recommendations, age and gender, landing pages.
- **Currency.** Everything is shown in the campaign report's currency. Each account-day is converted at the report's own converted ÷ native rate, so panels agree with the campaign report to the paisa. A day with no spend takes the nearest earlier rate. `fx.estimated` flags days outside the report's dates. An account with no rate stays in its own currency and is never added to other currencies.
- **Same days for every account** (PR #41). `common_window()` adds up only the days every account in view has. Accounts in different time zones finish "yesterday" at different times, and the panel says when later days are not yet in for every account.
- **Coverage lines** (PR #41). Search terms, locations, landing pages and ads say how much of the campaign report's spend they account for, for example "₹6,10,591 of the ₹9,37,265 spent on Search campaigns in these dates (65%)". Google withholds rare search terms and so on.
- **Live check, 2026-09-30.** Every panel matched the campaign report to the paisa except the latest day, which differed by ₹8 and ₹158 on two accounts because of snapshot timing.

### 8.4 AI review (PRs #42–#45)

The page is `/dashboards/google-ads/ai-review`, linked from the dashboard and keeping `?account=`. Claude reviews one account, every campaign, against the account's brief.

**Pipeline** (`tracker/gads_ai.py`, `run_review`), with stages: context, pack, targets, checks, analysis.

1. **Context.** Read the account's part of the Google Doc. A snapshot is stored as a brief version with author `google-doc`, so every review records exactly what it read.
2. **Pack** (`build_pack`). Last 30 days vs the previous 30 for every campaign (detailed for the top 30), month-to-date pacing, bidding, impression share, search terms, keywords and Quality Score, ads, devices, age and gender, conversions and their setup, locations, hours, landing pages, change history and recommendations.
3. **Targets.** Claude extracts the brief's targets and requirements as JSON (`TARGETS_SCHEMA`). The doc is treated as a running log: where notes conflict, the latest wins.
4. **Checks.** Code measures each target from the data, not Claude: spend and pace, ROAS, CPA, conversions, rates, impression share, and spend inside and outside target locations.
5. **Analysis.** Claude writes the review as JSON (`REVIEW_SCHEMA`): a scorecard against the brief, where the account deviates, what is working and what isn't, P1–P3 actions, a verdict per campaign, and what the brief is missing.

**Claude call details.** Model `claude-opus-5-5`, adaptive thinking (effort medium for targets, high for analysis). It streams via `client.beta.messages.stream` with structured output (`output_config` json_schema), betas `["server-side-fallback-2026-07-01"]` and `fallbacks="default"`. A heartbeat thread runs during the call. A review takes a few minutes and costs about US$0.50–2; the cost is shown next to it.

**Storage** (`tracker/gads_ai_store.py`). Tables `gads_ai_briefs`, `gads_ai_reviews` and `gads_ai_settings` on Postgres; in-memory without `DATABASE_URL`. A review whose heartbeat is older than 12 minutes counts as stale.

**Routes** (all staff-only; POSTs require the header `X-Requested-With: fetch`):

- `GET/POST /api/dashboards/google-ads/ai/brief`
- `GET /context`
- `POST /context-doc`
- `GET/POST /reviews`
- `GET /reviews/<id>`

**The context Google Doc** (`tracker/gads_ai_doc.py`):

- One running doc for all accounts, linked once on the AI review page (stored as setting `context_doc`) or set with the `GOOGLE_ADS_CONTEXT_DOC` variable.
- It must be shared (Viewer) with the service account that reads the Ads sheet, and the **Google Docs API** must be enabled in that service account's Google Cloud project. Both are done.
- An account's part is found as one of:
  - a **tab** titled with the account name;
  - a **heading** containing the full name;
  - a short plain line naming the account.
- Matching rules:
  - Where several names fit, the longest contained name wins. Failing that, the customer ID is used.
  - **Tab titles only** may shorten a name: a unique word-prefix of at least 4 letters, such as "Hare Krishna" for the full charity name. Headings never shorten, so "Outcomes" isn't misread as an account (PR #45).
  - Tabs or headings called General, All accounts, Agency, Common, Overall, Global or All clients are shared with every account.
- Errors are explained in plain words: API off, doc not shared, bad ID.

**Status of the owner's doc** (its link is with the owner, not in this repo):

- Tabs exist for General, AA_New, AIHS, Btay, Core Care Clinic, and "Sample – Lumina Smiles Dental". The sample is a complete example write-up for account managers, added by Claude via the Docs API.
- Seven accounts don't have a tab yet.
- The same sample also exists as a Claude Doc under the old account, "Account notes for the AI review: how to write them".

**Needs:** `ANTHROPIC_API_KEY` and `DATABASE_URL`.

## 9. Local Business Radar

`/strategic-agents/local-business-radar` (PRs #20–#31, `tracker/lbr_*.py`). It finds every small business of one kind in one place and audits:

- the Google Business Profile;
- the website (JavaScript sites through a real browser via crawl4ai when `LBR_RENDER` is on);
- reviews and sentiment;
- visibility: map rank, paid search, local market.

It then scores and tiers the businesses worth pitching (website build, local SEO, paid media, reputation, creatives), with a pitch for each.

- **Pipeline:** `discover → profile → website → reviews → visibility → score`. Each stage is saved as it finishes, so a run interrupted by a deploy resumes and pays only for what is left. One worker thread per run, a heartbeat, and a Postgres advisory lock. Runs can be cancelled.
- **Restarts and Resume.** A restarted run is checked against the source it was planned with (`plan.estimate.source`), not the one a new run would pick. An Apify run is never stopped for want of Places or SerpAPI keys, and a key that really is gone is named with its variable. A failed or cancelled run has **Resume the run** on its report (`POST /runs/<id>/resume`), which carries on from the saved stages. It is not offered past the cost ceiling or the retention window. A report that stopped before scoring says "not yet ranked", with no ranks or scores.
- **Cost ceiling.** `lbr_intake.estimate()` is the most a run may spend, enforced by construction and re-checked after each stage. Every request goes to a cost ledger.
- **Two discovery sources:** Google Places API (New) with SerpAPI, or **Apify's Google Maps Scraper** (`LBR_SOURCE`), priced at the account's own Apify tier.
- **Report:** a dashboard with CSV and XLSX export (formula-neutralised), plus a self-test page at `/strategic-agents/local-business-radar/selftest`.
- **Keys:**
  - required: `GOOGLE_MAPS_API_KEY` (Places API (New)), `SERPAPI_KEY`, `ANTHROPIC_API_KEY`;
  - optional: `APIFY_API_TOKEN`, `PAGESPEED_API_KEY` (or the Maps key), `HUNTER_API_KEY`;
  - tuning: `LBR_SOURCE`, `LBR_RENDER`, `LBR_RENDER_CONCURRENCY`, `LBR_RETENTION_DAYS`, `LBR_PRICES_JSON`, `LBR_APIFY_PRICING`.

### 9a. Page Watch (built: all 5 phases; switching on needs the checklist in docs/page-watch-plan.md, section 7)

Watches any web page and reports, in plain words and with a before-and-after picture, when it changes. The plan and the five phases are in `docs/page-watch-plan.md`. Phase 1 is the detection engine (`tracker/watch_*.py`); Phase 2 the worker and schedules; Phase 3 Claude's verdict; Phase 4 the pages: `/strategic-agents/page-watch` (add flow and dashboard), `/watches/<id>` (timeline and settings) and `/changes/<id>` (verdict and before/after slider), backed by `tracker/watch_web.py`. Phase 5 is Slack: `tracker/watch_alerts.py` handles alerts, the digest, the weekly summary, failure and recovery notices, and the watchdog (`.github/workflows/page-watch-watchdog.yml`).

- **Reading a page** (`watch_capture`): headless Chromium at 1440×900, fixed language and time zone, animations frozen, cookie notices and chat bubbles hidden, lazy content scrolled into view. Returns every visible text block with its position, a full-page screenshot and a control screenshot a few seconds later. Every request the browser makes is checked against private addresses, one redirect at a time (same rule as Local Business Radar). Without a browser it reads plain HTTP (text only).
- **Comparing** (`watch_text`, `watch_visual`, `watch_detect`): text block by block (volatile text such as "3 minutes ago" neutralised); screenshots row-aligned to the pixel, so an inserted banner does not make the rest of the page count as changed; content that only moved (one column shifting, a fixed sidebar) is recognised and left out.
- **Calibration** (`watch_engine.calibrate`): a new watch's page is read twice more straight after its baseline; whatever differs between those readings (a random button colour, a rotating quote) is learned as noise for that watch.
- **Accuracy harness:** `python tools/watch_accuracy.py` measures false alarms and detection of known edits on real pages.
- **Storage** (`watch_store`): `watch_targets`, `watch_checks`, `watch_snapshots`, `watch_changes`, `watch_images` on Postgres (in-memory without `DATABASE_URL`). The baseline screenshot is stored lossless; replaced baselines are re-saved lossy.
- **Worker** (`watch_worker`, a second Railway service, `page-watch-worker`, whose Custom Start Command is `python -m tracker.watch_worker` (`railway.worker.toml` records its settings); setup steps in the plan, section 6):
  - claims due watches with a 3-minute lease that is renewed while a check runs;
  - checks one page per site at a time, 20 seconds apart;
  - reruns a failed check after 5, then 15 minutes, then returns to its schedule;
  - writes a heartbeat row and runs the hourly retention job;
  - on SIGTERM, lets running checks finish and hands back the rest.
- **Schedules** (`watch_schedule`): hourly, 6-hourly, daily at a time, or weekly, in India time. Each watch is offset a few minutes from the exact time, fixed per watch.
- **Confirmation:** a change is held as "suspected" and re-read 3 minutes later. If it is gone, it is a glitch. An area that flickers twice is learned as noise.
- **Claude's verdict** (`watch_judge`):
  - each recorded change gets a summary, explanation, category, importance, a noise flag and a confidence level;
  - the model is Opus 5.5 at medium effort, with the fallback on and structured output;
  - without a key, past the monthly cap, or on any Claude failure, a rules verdict takes over;
  - calls and costs are logged in `watch_ai_calls`;
  - feedback (useful, not useful, mute this kind) is shown to Claude on later changes, and a muted category is never alerted;
  - `find_pages` turns a name into candidate links using web search.
  - Tests never call Claude: `conftest.py` sets `WATCH_JUDGE=off`, and `tests/test_watch_judge.py` uses a fake client plus the real SDK against a local stand-in server.
- **Health:** `/strategic-agents/page-watch/health` (staff only) returns JSON with `ok`, `behind`, `no_worker`, `no_browser` or `idle`.
- **Env:** `WATCH_BROWSER=off` turns the browser off; `WATCH_CHROMIUM_PATH` points at a Chromium to use; `WATCH_WORKER_THREADS` (default 2); `RAILPACK_PYTHON_PLAYWRIGHT_INSTALL=1` and `ANTHROPIC_API_KEY` on the worker service; `WATCH_CLAUDE_MODEL`, `WATCH_CLAUDE_EFFORT`, `WATCH_CLAUDE_MONTHLY_USD`, `WATCH_JUDGE`; `WATCH_SLACK_CHANNEL`, `WATCH_SLACK_BOT_TOKEN` (falls back to `GOOGLE_ADS_SLACK_BOT_TOKEN`), `WATCH_DIGEST_AT`, `WATCH_ALERTS`, `WATCH_CRON_TOKEN` (web, and the GitHub secret for the watchdog), `PUBLIC_BASE_URL` and `SECRET_KEY` (also on the worker).

### Client accounts (phases A–D built; plan and progress: `docs/account-workspaces-plan.md`)

- **What it is:** one space per client at `/<account>`. The switch is in every page's top bar
  (where "Workspace" was) and is the hub's headline ("Working on / All accounts"); the hub also
  lists every account as a card. Picking an account opens its home, or the same page for it
  (the Google Ads dashboard, the AI review).
- **The list:** the Google Ads campaign report's accounts plus the master doc's tabs. The master
  doc **is** the AI review's context doc: each account's tab opens with a profile block (website,
  industry, locations, competitors, brand, goals...; `tracker/client_profile.py`), and the notes
  under it are what the AI review reads. A tab may link to its Google Ads account by a
  `Google Ads ID:` line, and to several for a client with more than one.
- **URL names:** the profile's `URL name`, else the name. Kept in `client_accounts` /
  `client_account_old_slugs`; a renamed account's old address redirects, and a slug is never given
  to a different client. `/<acct:slug>` matches only listed accounts, so nothing else changes.
- **Scoping:** an account's pages embed only its rows; its insights go through
  `google_ads_insights.view(only=...)`.
- **Smoothness:** speculation rules prerender an account on hover; cross-document view transitions
  carry its name from the picker into the page title. Respects reduced motion.
- **Client access:**
  - Admins invite an email or a company domain from **Share** on the account's home. Public mail
    domains and the staff domain are refused.
  - The account shares the Google Ads dashboard (on by default), the AI review (off; read-only,
    finished reviews only) and the profile (off).
  - A client sees only their own account, with no internal tools, notes, costs or links, and lands
    on it after sign-in.
  - Tables: `client_account_access`, `client_account_shares`, `client_account_audit`.
  - Tests: `tests/test_account_clients.py`.
- **Page Watch and Video Studio inside an account** (staff):
  - `/<account>/page-watch` shows and files watches under the account. Its site and competitors
    from the profile are one-tap watches.
  - `/<account>/video-studio` fixes the client, fills in the website and takes the brand from the
    profile.
- **SEO & AEO tools and agents inside an account** (staff):
  - `/<account>/seo-aeo/<tool>` hands SEO Studio `?pf_url|pf_keyword|pf_domain|pf_service`, read by
    `seo-apps/client/src/lib/prefill.js`.
  - `/<account>/agents/<agent>` renders the agent's own page and fills its fields from the profile
    (`static/js/account-prefill.js`). It covers Social Media Intelligence, Local Business Radar,
    Event & Conference Intelligence, Contact Finder and Thought Leader Intelligence.
  - The account's home lists them all under "Run for <account>".

### Video Studio (being built; plan and progress: `docs/video-studio-plan.md`)

- **What it is:** a short video from a brief the user writes. Claude plans it, builds it as a HyperFrames composition, and the worker renders it.
- **Phase 1 (built):** the render engine on the Page Watch worker (`tracker/video_*.py`).
  - One render thread per worker, queue `video_jobs` with a lease, two attempts, hand-back on SIGTERM.
  - HyperFrames is pinned (`video_config.HYPERFRAMES_VERSION`) and installed with npm on the worker's first start. Node 22 comes from `railpack.json`.
  - The sandbox gives the render browser no network: a refusing proxy inside the worker records every outside address it was asked for. Programs get no secrets, and every program has a time limit that stops its whole process group.
  - Staff page: `/strategic-agents/video-studio/engine` runs the two test videos and the two drills.
  - Tests never render: `conftest.py` sets `VIDEO_STUDIO=off`; `VIDEO_LIVE=1` runs the one live render test.
- **Phase 2 (built):** sources, brand and the plan.
  - Websites are read on the worker (`video_site`, on `watch_capture`). Uploads are checked and re-encoded (`video_uploads`).
  - Brand fonts map onto 21 bundled fonts (`video_fonts`). The brand is saved per client (`video_brands`).
  - The plan is one structured Claude call with server checks: seconds, sources, word limits, nothing invented, exact script. It gets one retry (`video_plan`), and runs as a "plan" job on the worker (`video_planner`).
  - Calls and costs go to `video_ai_calls`.
  - Staff page `/strategic-agents/video-studio/plans` runs the 15 test briefs (`video_briefs`) with the real Claude.
  - Tests use a stand-in Claude (`tests/video_fakes.py`).
- **Phase 3 (built):** building the video.
  - The scene library has 16 templates × 4 shapes (`video_scenes`). The composer is `video_build`.
  - Claude's review loop is `video_agent`: tools `read_file`, `write_file`, `check`, `snapshot` and `done`, with a 30-call limit, 2 fix rounds, 15 minutes and the budget. The program's final check is the gate.
  - Jobs `build` and `change` (`video_builder`) cover Approve, Make changes and Make another shape.
  - `scripts/check_video_scenes.py` checks the library with the real engine.
- **Phase 4 (built):** the pages.
  - `/strategic-agents/video-studio` is the start page and library; `/videos/<id>` is one video (reading, plan editor, making, result, versions); `/brands` holds the saved brands.
  - The logic is in `video_app`; the pages are drawn by `static/js/video-studio.js`. Writes are JSON only, and pictures are uploaded one per request.
  - Edits are checked by `video_plan.check`; words the person types count as facts (`plan["typed"]`). Key frames are stored as assets of kind `frame`.
  - `scripts/drive_video_studio.py` drives the whole journey in a real browser with stand-ins for the worker's outside world.
- **Phase 5 (built):** hardening.
  - Failures, their tests and drills: `tests/test_video_hardening.py` and `tracker/video_drills.py`, run from the engine page.
  - Limits: 20 versions, 20 videos and 40 plans per person per day. The worker's clean-up (`video_store.prune`) removes MP4s after 90 days ("Make it again" renders them back).
  - The optional Slack message is `video_notify`.
  - `scripts/check_video_sandbox.py` attacks the sandbox; `scripts/load_video_studio.py` is the load run (peak 2.06 GB, so the worker needs 4 GB).
  - The launch checklist is in `docs/video-studio-plan.md` section 7. The badge stays "building" until it has been followed.
  - The render browser is Playwright's headless shell. `video_config.browser_path()` finds both its old layout (`chrome-linux/headless_shell`) and the one Playwright 1.5x installs on Railway (`chrome-headless-shell-linux64/chrome-headless-shell`). It also asks Playwright where its browsers are, and the worker installs the shell at start if it is missing.
  - A missing engine part fails a video with a plain message, and the reason appears on the engine page and in the job log.
- **Music:** 9 CC BY 4.0 beds by Sascha Ende in `tracker/video_kit/music` (`scripts/fetch_video_music.py`); the planner picks `plan.music`, the editor can change it or turn it off, the video page shows the credit. See docs/video-studio-plan.md, "Music".
- **Look:** scenes follow the /brag ads (masked word reveals, `emphasis` in the accent colour, photo-backed hooks, big photo panels, an end card with chips, product photos and a button); the planner sees 16 pictures and Claude reviews as an art director. See docs/video-studio-plan.md, "Quality pass".
- **Env:** `VIDEO_STUDIO=off` (worker) stops video jobs; `VIDEO_CLAUDE_MODEL` (default claude-sonnet-5-5), `VIDEO_CLAUDE_EFFORT` (medium), `VIDEO_CLAUDE_MONTHLY_USD` (10); `VIDEO_ENGINE_DIR`, `VIDEO_WORK_DIR`, `VIDEO_BROWSER_PATH` override the defaults; `VIDEO_ENCODER_THREADS` sets the video encoder's threads (default the container's CPUs, at most 4; more threads hold more frames in memory); `VIDEO_RENDER_WORKERS` sets the browsers one render uses (default 1–2, from the container's own CPU and memory limits; a failed render is retried once in HyperFrames' safe mode); `VIDEO_DAILY_VIDEOS` (20), `VIDEO_DAILY_PLANS` (40), `VIDEO_KEEP_DAYS` (90), `VIDEO_SLACK_CHANNEL`, `VIDEO_SLACK=off`.

## 10. Environment variables (Railway → web → Variables)

Names only. Values live in Railway and must never be copied into the repo or chat. A missing variable disables only its feature.

- **Core:** `SECRET_KEY` (must be set; otherwise sessions can be forged), `DATABASE_URL`, `GOOGLE_CLIENT_ID` (Google Sign-In), `STAFF_EMAIL_DOMAIN` (optional, default markifydigital.com).
- **Google service accounts and sheets:**
  - `GOOGLE_SA_JSON` (shared);
  - `GOOGLE_ADS_SHEET_SA_JSON` (dedicated read-only account for the Ads sheet and the context doc);
  - `GOOGLE_ADS_SHEET_ID`, `GOOGLE_ADS_CONTEXT_DOC` (optional; the page setting wins);
  - `LOGIN_LOG_SHEET_ID`, `DEMO_REQUEST_SHEET_ID`, `DEMO_NOTIFY_EMAIL`.
- **AI:** `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_INSIGHTS_MODEL`, `OPENAI_REASONING_EFFORT`.
- **Data providers:**
  - `APOLLO_API_KEY`, `ARENA_API_KEY`, `UNIPILE_API_KEY`, `UNIPILE_DSN`;
  - `APIFY_API_TOKEN` and the `SCI_APIFY_*_ACTOR_ID` / `TLPR_APIFY_*_ACTOR_ID` variables;
  - `SERPAPI_KEY`, `SERP_PLATFORM_TOKEN`, `YOUTUBE_API_KEY`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`;
  - `IPINFO_TOKEN`, `IDENTIFY_TOKEN`;
  - `GOOGLE_MAPS_API_KEY`, `PAGESPEED_API_KEY`, `HUNTER_API_KEY`.
- **SEO Studio:** `SEO_STUDIO_URL`, `SEO_STUDIO_SECRET` (the same secret on both services).
- **Google Ads Slack digest:** `GOOGLE_ADS_SLACK_BOT_TOKEN`, `GOOGLE_ADS_SLACK_CHANNEL`, `GOOGLE_ADS_DIGEST_TOKEN` (the same value is the GitHub secret of that name), `PUBLIC_BASE_URL` (optional, for the links); for answering questions in Slack, `GOOGLE_ADS_SLACK_SIGNING_SECRET` and optionally `GOOGLE_ADS_SLACK_MAX_QUESTIONS_PER_DAY` (default 150). See `scripts/google_ads/README.md`.
- **Slack, email, GitHub:** `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`, `SLACK_WEBHOOK_URL`, `SMTP_*`, `GMAIL_SENDER` (SMTP doesn't work on Railway), `GH_DISPATCH_TOKEN`, `GH_REPO`, `GH_WORKFLOW`.

Note: the website's own AI features bill the **Anthropic API key in Railway** (Anthropic Console). That is separate from any claude.ai subscription, so moving Claude accounts changes nothing on the live site.

## 11. Deploy and operations

- **Deploys.** Push to `main` and Railway redeploys **web** in about 1–2 minutes and **seo-apps** in a few minutes. If a deploy doesn't start: Railway → web → Deployments → "Deploy Latest Commit".
- **GitHub Actions:**
  - `run-tests.yml`: the suite on every PR and push;
  - `event-intelligence-tests.yml`: real `postgres:16`;
  - `seo-studio-tests.yml`;
  - `build-frontend.yml`: rebuilds Ad Intelligence when `apps/ad-intelligence/**` changes;
  - `refresh-dashboards.yml` and `weekly_tracker.yml`: the ABM tracker;
  - `sync-job-change-alerts.yml`.

  PR checks seen so far: `pytest`, `postgres`, `build`, `deploy`, `report-build-status`.
- **Event & Conference Intelligence worker.** Not deployed (removed from the `Procfile`, PR #2). Its runs stay queued unless a second service runs `python -m tracker.event_intel_jobs`.
- **Google Ads daily cycle.** The scripts run in the early morning. The dashboard picks up new data within 15 minutes, or at once with the page's **Refresh** button.

## 12. History: every PR in this repo

| PR | Date | What |
|---|---|---|
| — | 09-22 → 09-24 | Import (`2ddcc69`), Bento redesign phases 0–6, public site rebuilt and published to GitHub Pages, ABM cut to Healthcare top 50, Ad Intelligence rebuilt, Outcomes design language, motion layer, Markify staff access |
| #1 | 09-24 | Fix the one test failing on a clean install (anthropic 1.x / httpx) |
| #2 | 09-24 | Event worker removed from the Procfile |
| #3 | 09-24 | Internal app moved out of `/p2` |
| #4 | 09-25 | Remove pointer-following circle on two admin pages |
| #5 | 09-25 | SEO Studio runs from this repo (Railway Postgres, login gate, GBP QC, deploy config) |
| #6–#7 | 09-25 | Embedded tools fill the page; SEO Studio on the Outcomes look |
| #8 | 09-25 | Agent and SEO+AEO directories redesigned; scroll-reveal deadlock fixed |
| #9–#12 | 09-25 | Hub's third hero workspace: Dashboards |
| #13–#16 | 09-26 | Google Ads campaign performance dashboard: built, made rich, restyled, detail panels |
| #17–#18 | 09-26 | Go-to-market and Operational agents pages in the public site's style |
| #19 | 09-26 | Admin analytics fixed after the domain and `/p2` moves |
| #20–#31 | 09-27 → 09-28 | Local Business Radar, phases 1–10, Apify engine, real-run fixes, crawl4ai, Apify pricing |
| #32–#35 | 09-28 | Google Ads insights groups 1–4 (script + reader + panels) |
| #36 | 09-28 | Insights script split into two parts; live accounts listed in one query |
| #37 | 09-29 | ABM test allows the 90-day retention |
| #38 | 09-29 | Insights follow every dashboard filter, including dates (per-day export) |
| #39 | 09-29 | One currency, converted at Google's own daily rates |
| #40 | 09-29 | Script: landing speed no longer fails when Google omits metrics (`r.metrics \|\| {}`) |
| #41 | 09-30 | Same days for every account; coverage lines; `SETTLE_HOURS` |
| #42 | 09-30 | AI review: Claude reviews an account against its brief |
| #43 | 09-30 | AI review: account context from one running Google Doc |
| #44–#45 | 09-30 → 10-01 | Shortened tab titles name their account (tab titles only) |
| #46 | 10-01 | Third script: writes the Daily Campaign Performance tab (ECB rates) |

## 13. What `CONTEXT_FOR_NEW_CHAT_V30.md` gets wrong now

V30 was written in the original Position² repo and was imported unchanged. In this repo:

- The repo is `Krishna-1812/new-agentic-platform`, not `ai-positon2/intelligence-platform`.
- The live URL is the Railway address in section 2, not `intelligence.position2.com`.
- Staff are `@markifydigital.com`, not Position².
- There is no `/p2` prefix; the old paths redirect.
- SEO Studio is in `seo-apps/` here.
- The brand is the `brand.py` placeholder.
- The ABM tracker has only Healthcare's top 50.
- The look is the Outcomes design language, not the old dark or aurora themes.

Its per-agent internals remain the best deep reference.

## 14. Open items

### For the owner (outside the code)

1. **Rotate the Railway secrets** that were visible in a screenshot earlier in the old session: Railway → web → Variables. Generate new values at each vendor, update them in Railway, and revoke the old ones.
2. **Google Ads:**
   - install `export_campaign_report.js` as a third script in the manager account, scheduled daily before the insights scripts;
   - run it once and check the tab;
   - then **turn off the schedule of the saved report "Daily Campaign Performance"** (Reports → Report editor → open it → Schedule).
3. **Context Google Doc:**
   - add a tab for each of the seven accounts that have none (named exactly as in Google Ads), following the Sample tab;
   - link the doc on the AI review page if not yet linked;
   - run a first AI review.
4. Decide the real brand name and domain (`brand.py`); get the privacy policy and terms reviewed by counsel (they name the placeholder "Northaxis, Inc."); optionally add a custom domain.
5. Earlier, it was suggested the GitHub repo be made private. Check this.

### Carried over from the "Platform Separation — Open Items" tracker (rev 21, 2026-09-24)

These were open at the time. Some have moved since; verify before acting.

- **A1.** Restyle the SEO tools. SEO Studio is now in-repo and on the Outcomes look (PRs #5, #7), so this is likely done.
- **A2.** GBP QC. Now inside SEO Studio (PR #5).
- **A3.** LinkedIn Social Researcher. An external app (`watchtower-by-position2.vercel.app`) that can't be restyled from here. Currently hidden.
- **A6.** Make the public agent list match the product (decision D4).
- **B1–B7.** Move every account off Position²'s keys: AI accounts, data providers (Apollo, Apify, Unipile, SerpAPI, IPinfo, YouTube, Reddit, Arena), Google sign-in client and session secret, service account and sheets, hosting, database and domain, email and Slack, GitHub workflow secrets. Also change the `GH_REPO` default in `app.py`, which still points at Position²'s repo and is used by the dashboard's Refresh-workflow trigger.
- **B8.** What to do with Position²'s client data in `data/` and `reports/`. It includes personal data, so it needs a legal view, including the DPDP Act, 2023.
- **B9.** Keep or remove the NorthStar Anesthesia client portal.
- **C1.** Re-point the AI relevance scoring (`tracker/news_relevance.py`, `signal_score.py`, `jobs_client.py`) at what the sister company sells.
- **C2–C7.** Old name or domain in invisible places: the SEC EDGAR contact, the Reddit user agent, news feeds, the login-log domain, the image self-test, LinkedIn Intelligence's label, the README, and `scripts/legacy/`.
- **D1–D4.** Decisions: brand and domain, legal entity and counsel review, staff domain and admins (done: Markify), which agents to keep.
- **E1.** Six agent pages call `/api/insights/healthcare`, which doesn't exist.
- **E2.** Some admin data endpoints are missing. PR #19 fixed the admin analytics pages; verify.
- **E3.** Sentiment Pulse is switched off.
- **E5.** Near-duplicate ABM signals.
- **E6.** There is no Insights tab on phones in the ABM dashboard.
- **E7.** Three pre-existing lint errors in Ad Intelligence.

### Known security gaps (from the V30 audit, not yet fixed; ask before changing)

- No CSRF tokens. The AI review's POSTs are guarded by requiring `X-Requested-With: fetch`.
- No explicit `SESSION_COOKIE_SECURE` or `SESSION_COOKIE_SAMESITE`.
- `X-Forwarded-For` is trusted without `ProxyFix`.
- No security headers (CSP, HSTS, `X-Content-Type-Options`).

## 15. Gotchas learned the hard way

- **Google Ads Scripts:**
  - `report rows` may omit `metrics` entirely; guard every read (`r.metrics || {}`).
  - Manager scripts: `executeInParallel` handles at most 50 accounts, returns at most 10 MB per account, and runs at most 60 minutes.
  - `GOOGLEFINANCE` historical data can't be read from Apps Script.
  - `UrlFetchApp` needs `followRedirects: true` for frankfurter.app, which answers with a 301.
  - Google keeps adding late clicks to "yesterday" for hours, hence `SETTLE_HOURS = 6`.
- **Google Docs API:**
  - `documents.get(includeTabsContent=True)` is needed to see tabs.
  - Writing is limited to 60 requests a minute per user, so sleep about 1.2 s between writes.
  - A service account can't create a doc in its own Drive (403). Write into a tab of a doc the owner shared with it instead (`addDocumentTab`, then `insertText` and friends).
- **Tests:**
  - Always run with `python3 -B` and `PYTHONDONTWRITEBYTECODE=1`, because stale `.pyc` files once let a reverted fix keep passing.
  - Don't monkeypatch `threading.Thread` globally; it hangs the suite. Patch `app._gads_ai_spawn` instead.
- **Live data checks** need the owner's approval each time (see section 4). They are done by reading the sheet with the service account key and comparing against the dashboard's own functions, then deleting the cache.

## 16. Moving to a new Claude account: what does and does not carry over

| Thing | Carries over? | What to do |
|---|---|---|
| The code, history, PRs, this file | Yes, it's all on GitHub | In the new account, connect GitHub (claude.ai → Settings → Connectors → GitHub) as a GitHub user who can push to `Krishna-1812/new-agentic-platform`. The Claude GitHub App is already installed on the repo; if access is refused, re-install it for that repo. |
| The live website, Railway, Postgres, all API keys | Yes, they don't depend on Claude | Nothing. |
| Google Sheet, context Google Doc, Google Ads scripts, service account | Yes, they live in Google | Nothing. Have the doc link handy for the new session. |
| Cloud-environment settings (network access, setup script) | No, they are per account | Create an environment for the repo. Allow outbound network access to at least GitHub, PyPI and npm. For live checks it also needs Google APIs (`*.googleapis.com`) and `api.frankfurter.app`. |
| The uploaded service-account key file | No | Upload it again in the new session **only** when a live check is needed. Never commit it. |
| Old session's chat, Routines and check-ins | No | Nothing pending: every PR is merged and every check-in deleted. |
| Claude Docs made in the old account ("Platform Separation — Open Items" tracker; "Account notes for the AI review: how to write them") | No, they are owned by the old account | The open items are copied into section 14 above. The sample write-up is already a tab in the owner's Google Doc. If you want the originals, export them from the old account first. |

## 17. The prompt to paste into the new session

Start a new Claude Code session on `Krishna-1812/new-agentic-platform` (branch `main`), then paste the following. Replace the two bracketed parts first, or delete those lines.

```text
You are taking over an existing project from another Claude account. Before doing anything
else, read docs/HANDOFF.md in this repo end to end, then scripts/google_ads/README.md. Skim
README.md and docs/CONTEXT_FOR_NEW_CHAT_V30.md only for agent internals; HANDOFF.md section 13
says what in them is out of date.

Then confirm your understanding in under 15 lines: what the platform is, where it is live, how
it deploys, the Google Ads pipeline (three scripts → one sheet → dashboard → AI review with the
context Google Doc), and the open items in HANDOFF.md section 14. Do not change any code yet.

Standing rules (from HANDOFF.md sections 3 and 4; follow them for the whole session):
- For every change: branch from fresh main, add tests, run the full suite with
  `PYTHONDONTWRITEBYTECODE=1 python3 -B -m pytest tests/ -q`, run the secret check, commit,
  push, open the PR, wait for every check to go green, then merge it into main yourself.
  Don't ask me for permission to open or merge PRs.
- Never commit or paste secrets: service-account keys, API keys, the Google Ads sheet
  URL/ID or the context Google Doc ID. Never ask me to paste an API key into chat; keys
  go in Railway → web → Variables.
- Read live Google Ads or analytics data only after I approve that specific read,
  and delete any local copy afterwards.
- Never weaken TLS. Don't kill processes with `pkill -f`.
- I'm a CA, CMA, Registered Valuer and Insolvency Professional. Back statements with
  references (vendor docs, statute, standards) and keep answers short and precise. When I
  must click through Google Ads, Google Cloud, Railway or Google Docs, give exact steps.

My context Google Doc for the AI review: [PASTE THE GOOGLE DOC LINK HERE]
(It's already shared with the service account and the Docs API is on. Don't commit its ID.)

Where I left off: [e.g. "installing the third Google Ads script and turning off the old
scheduled report" / "adding account tabs to the context doc"]. After your summary, wait for
my next instruction.
```
