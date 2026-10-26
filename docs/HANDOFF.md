# Northaxis platform: full handoff for a new Claude chat

Written 2026-10-17. It describes the platform as it is on `main` at **`66cbe6c` (PR #141)**.

**How to use this file:** start a new Claude Code session on the repo `Krishna-1812/new-agentic-platform` and paste the prompt in section 20. The session reads this file (`docs/HANDOFF.md`) first, then `docs/HANDOFF_2026-10-02.md` for depth on the Google Ads pipeline, Local Business Radar, Page Watch, Video Studio and client accounts. That older handoff is accurate in depth but stops at PR #46 (2026-10-02); this file covers everything since and corrects what changed.

A context file is a snapshot. Before trusting a number here, run `git fetch origin main && git log origin/main -5` and check.

---

## Contents

1. What this is
2. Quick facts
3. Standing rules (the owner's, verbatim; never break them)
4. How to work in this repo (the PR loop)
5. The owner and how they like to work
6. Repo map
7. Surfaces, sign-in and access
8. Workspaces: client accounts, sharing, memory
9. Every agent, with status
10. Google Ads: dashboard, AI review, Slack "Ads Insight"
11. Admin panel (`/admin`)
12. Public site
13. Environment variables (names only)
14. Railway, deploys, regions, speed
15. GitHub Actions
16. History: PRs #47 to #141
17. Open items
18. Gotchas learned the hard way
19. Things that live outside the repo
20. The prompt to paste into the new chat

---

## 1. What this is

**Northaxis** is a Flask web platform of AI agents and dashboards for a digital-marketing agency. It is a product of **Outcomes.Digital**. The internal staff are **Markify Digital** (`@markifydigital.com`).

- It began as a copy of Position²'s "Intelligence by Position²" platform. It was imported into this repo on 2026-09-22 and has since been rebuilt and re-branded.
- It is **not** part of Position². Don't describe it as Position²'s, and don't put Position² client data or branding into new work.
- `brand.py` holds every user-visible product string: name "Northaxis", the assistant name "Atlas", the legal entity, and the staff email domain.

**What it does, in one line:** every client gets a workspace. In it the team, and clients the team invites, use:
- a Google Ads dashboard with a Claude-written AI review;
- market, competitor, people and social intelligence agents;
- a page-change watcher;
- a video maker;
- SEO and AEO tools.

Work done inside a workspace is remembered there.

## 2. Quick facts

| | |
|---|---|
| Repo | `Krishna-1812/new-agentic-platform`, default branch `main` |
| Working branch | `claude/google-ads-handoff-j2ra5j` (reset from `main` for every change). A new session may be told a different branch; use what it is told. |
| Live site | **https://northaxis.outcomes.digital**, a custom domain on the Railway service **web**. The old `web-production-6748e.up.railway.app` redirects page loads to it; APIs, webhooks, Slack and `/health` answer on both. `PUBLIC_BASE_URL` sets the address used in links. |
| SEO Studio | Separate Railway service built from `seo-apps/` (Node + React). Shares `SEO_STUDIO_SECRET` with web. |
| Worker | Railway service **page-watch-worker**: `python -m tracker.watch_worker`. Runs Page Watch checks and Video Studio renders. Settings are in `railway.worker.toml`. |
| Database | Railway Postgres (`DATABASE_URL`, private address). Most stores fall back to memory or SQLite without it. |
| Region | The owner moved **web and Postgres to Southeast Asia** (2026-10-13). Keep web, worker and Postgres in the same region. |
| Hosting plan | Railway Hobby ($5). |
| Deploys | **Every push to `main` auto-deploys.** About 1–2 minutes for web. |
| Admins | `ADMIN_EMAILS` in `app.py`: `sudheer@markifydigital.com`, `kris@markifydigital.com`, `ladhakrishna2022@gmail.com`. Admins count as staff on any domain. |
| Staff | Any `@markifydigital.com` Google account (`STAFF_EMAIL_DOMAIN`), plus the admins. |
| Size | `app.py` 23,761 lines with 379 `@app.route` lines. `tracker/` has 210 modules. `templates/` has 64 pages. `tests/` has 303 Python test files. |
| Tests | `PYTHONDONTWRITEBYTECODE=1 python3 -B -m pytest tests/ -q`. **7,669 tests collected.** CI runs `pytest` and a real-Postgres job on every PR and push. |

## 3. Standing rules (the owner's, verbatim; never break them)

- "For every change: branch from fresh main, add tests, run the full suite with `PYTHONDONTWRITEBYTECODE=1 python3 -B -m pytest tests/ -q`, run the secret check, commit, push, open the PR, wait for every check to go green, then merge it into main yourself. Don't ask me for permission to open or merge PRs."
- "Never commit or paste secrets: service-account keys, API keys, the Google Ads sheet URL/ID or the context Google Doc ID. Never ask me to paste an API key into chat; keys go in Railway → web → Variables."
- "Read live Google Ads or analytics data only after I approve that specific read, and delete any local copy afterwards."
- "Never weaken TLS. Don't kill processes with `pkill -f`." Kill by exact PID only: find it in `/proc/*/cmdline`.
- **Secret check.** Run it before every commit; it must print nothing:
  ```bash
  grep -rlE 'BEGIN [P]RIVATE KEY|"private_key(_id)?"[[:space:]]*:' --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=__pycache__ .
  ```
- **Paid runs.** Ask before any run that spends money, such as Social Media Intelligence or Market Radar live runs, and state the cost first. Keep `MR_MONITOR_DISABLED` set, so Market Radar's scheduled monitor never runs on its own.
- **From `CLAUDE.md`, enforced by tests:**
  - **Every new agent goes into every client workspace.** Add it to `ACCT_AGENTS` in `app.py`, save its runs to the workspace's space, add its client routes and run routes, and give it a History reader. `tests/test_account_agents_all.py` fails until this is done. `ACCT_AGENTS_EXEMPT` is only for an agent that really is not about one client, and it needs a reason.
  - **Every agent that spends money goes into the admin panel.** Record each cost in a table with who ran it and its space, and add one entry to `SOURCES` in `tracker/admin_spend.py`. `tests/test_admin_spend.py` seeds every ledger.
- **Also:**
  - Never skip, disable or quarantine a test to get CI green.
  - `ADMIN_EMAILS` and `STAFF_EMAIL_DOMAIN` change together.
  - When a persisted URL or slug is renamed, the old one keeps redirecting (301), and every read keyed on it is aliased too.
- **Attribution.** No model identifiers in commit messages, PR text, code or comments. End commits and PR bodies with the attribution lines the session's system reminder gives.

## 4. How to work in this repo (the PR loop)

1. `git fetch origin main && git checkout -B claude/google-ads-handoff-j2ra5j origin/main`.
2. Make the change with tests. Run the targeted tests, then the full suite.
3. Run the secret check.
4. Commit with a plain-English subject that says what changed for the user. Example: "Admin panel: withdraw a client's access from the client workspace panel".
5. Push with `git push -u origin <branch> --force-with-lease`.
6. Open the PR with the GitHub MCP tools; there is no `gh` CLI. Subscribe to PR activity.
7. When every check is green, **squash-merge using the full 40-character head SHA** as `expectedHeadSha`.
8. Unsubscribe from the PR, then reset the local and remote branch to the new `main`.

**Checking a page in a browser.** Chromium and Playwright are installed. Use `executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'` if the pinned Playwright version asks to download a browser. The established pattern:
- run the Flask app locally on a spare port with a fake staff session, or call routes through `app.test_client()`;
- screenshot at 1440px and 390px wide;
- check for horizontal overflow and JavaScript errors.

Several redesign PRs used a small fixture server in the scratchpad to render a page with realistic data.

**Code style:**
- Comments explain *why* and cite vendor docs.
- User-facing text is short, plain English, with no jargon and no em dashes in generated client copy.
- Front-end JavaScript builds the DOM with `textContent`, never `innerHTML` with data.
- Each integration reads its key at call time and fails closed on that one feature only.
- Extend the existing module for a feature rather than adding a framework.
- Admin POST routes require the header `X-Requested-With: fetch`; there are no CSRF tokens.

## 5. The owner and how they like to work

- **The owner works on a Windows laptop.** Give exact click-through steps for Railway, Google Cloud, Google Ads, Slack and Search Console, written for Windows.
- They write briefly, often with screenshots, and often ask for "a list of 10 options" to choose from (names, headlines, bullets).
- They want things **"super beautiful", premium and polished**. Redesign requests expect real visual effort and a browser check at desktop and phone width.
- They want honest status: whether something is really built end to end, what is left for them to do, and which keys are needed.
- Never ask them to paste a key into chat. Tell them the exact variable name to add in Railway → web → Variables.

## 6. Repo map

```
app.py            Every route. Section-comment banners are its map. One file by design.
brand.py          Product naming ("Northaxis", "Atlas"), staff domain.
CLAUDE.md         The two enforced rules for new agents (section 3).
tracker/          Domain logic, one module family per agent:
  google_ads_insights.py, gads_ai*.py, gads_digest*.py, gads_slack_chat.py   Google Ads
  client_accounts*.py, client_access.py, client_profile.py, workspace.py,
    account_history.py, account_brief.py, people_store.py                   Workspaces
  admin_spend.py, request_timing.py, db_pool.py                             Admin and speed
  market_radar_*.py (≈45 modules)                                            Market Radar
  account_mapper*.py, saleshandy client, people-signals chat                People & Signals
  contact_lab*.py                                                           Contact Finder Lab (hidden)
  sci_*.py, sci_spend.py                                                    Social Media Intelligence
  lbr_*.py                                                                  Local Business Radar
  watch_*.py                                                                Page Watch
  video_*.py, video_kit/                                                    Video Studio
  event_intel_*.py                                                          Event & Conference Intelligence
  tlpr_*.py, thought_leader_pr.py                                           Thought Leader Intelligence
  apollo_*.py                                                               Contact Finder (Apollo)
  job_change_*.py, slot_checker*.py, signal_score.py, news_*.py              Older agents, ABM tracker
templates/, static/css, static/js   Pages and per-page assets. Design: "Bento" + "Outcomes" language.
scripts/google_ads/  The three Google Ads Scripts (run inside Google Ads) + a detailed README.
seo-apps/         SEO Studio service.
claude-plugins/video-studio/   The "video-studio" Claude Code skill and installers (PRs #88–#89).
deploy/searxng/   A SearXNG search service config (Contact Lab used it).
docs/             Public static site (GitHub Pages) + plans: HANDOFF.md, account-workspaces-plan.md,
                  account-memory-plan.md, page-watch-plan.md, video-studio-plan.md,
                  market-radar-setup.md, market-radar-depth.md, account-mapper-plan.md,
                  contact-lab-phase0.md, performance.md. CONTEXT_FOR_NEW_CHAT_V30.md is the old
                  Position²-era deep reference (agent internals still useful, platform facts stale).
tests/            pytest suite, plus Node harnesses for the Google Ads Scripts and page JS.
```

## 7. Surfaces, sign-in and access

Google Sign-In is open to any Google account, so access is split into surfaces.

| Surface | Who | Gate | Paths |
|---|---|---|---|
| Public site | anyone | none | `/`, `/agents`, `/platform`, `/industries/*`, `/privacy`, `/terms` … |
| Member area | closed: sign-in is staff only (`STAFF_ONLY`, 2026-10-23) and `/app/*` redirects to `/hub` | | `/app/*` |
| Staff app | Markify staff and the admins | `@position2_required` (the name is historical) | `/hub`, `/strategic-agents/*`, `/seo-aeo/*`, `/dashboards/*`, `/abm-signal-tracker/*` |
| Admin | `ADMIN_EMAILS` only | `@admin_required` | `/admin` and `/admin/*` |
| Client workspaces | staff, and invited clients for what is shared with them | `_acct_view()` | `/<account>/…` |

- Old `/p2/*` URLs 301 to the new paths.
- An invited client lands on their own workspace after signing in. They are fenced inside it: no internal tools, notes, costs or links.

## 8. Workspaces: client accounts, sharing, memory

**Naming (PR #87).** These are called **workspaces**. A person's own space is "Kris's Workspace" (it used to be "General"). A client's is "AA_New Workspace", meaning AA_New is the client.

**The account list** comes from:
- the Google Ads campaign report's accounts;
- the tabs of the **master Google Doc**, which is also the AI review's context doc. Each tab opens with a profile block (website, industry, locations, competitors, brand, goals) read by `tracker/client_profile.py`.

`client_accounts.id` never changes, so renames never orphan work.

**Pages in a workspace:**
- `/<account>` (home, with "Run for <account>" agent cards, SEO and AEO tool cards, and History);
- `/<account>/google-ads` and `/<account>/google-ads/ai-review`;
- `/<account>/page-watch` and `/<account>/video-studio`;
- `/<account>/seo-aeo/<tool>`;
- `/<account>/agents/<agent>`. The agent's own page opens with fields pre-filled from the profile (`static/js/account-prefill.js`), and calls carry `X-Account` (`static/js/account-context.js`).

**Every agent in every workspace (PR #113).** `ACCT_AGENTS` lists each one by slug, page, label, blurb and prefill fields:
- Social Media Intelligence
- Local Business Radar
- Event & Conference Intelligence
- Contact Finder
- Thought Leader Intelligence
- Market Radar
- People & Signals

`ACCT_AGENTS_EXEMPT` lists the exceptions, each with its reason:
- Page Watch and Video Studio have their own workspace pages (`ACCT_PAGES`).
- The Slot Checker Agent reads one fixed set of dental practices, not a client account.
- Older agents don't yet save runs to spaces: ABM tracker, Anonymous Visitors, LinkedIn Intelligence, LinkedIn Strategy Researcher, LinkedIn Social Researcher, Ad Intelligence and Sentiment Pulse.

The owner said to leave the exempt ones as they are for now.

**Client access and sharing (PRs #75, #85, #86, #111, #114, #141):**
- Admins invite an email or a whole company domain from **Share** on the workspace home. Public mail domains and the staff domain are refused.
- Shares (`tracker/client_access.py` `SHARES`):
  - Google Ads dashboard: on by default;
  - AI review: off; finished reviews only;
  - Profile: off.
- Admins also tick **each tool** to share (`tool:<slug>`): any agent, plus Page Watch and Video Studio. A client can run a shared tool only inside their own workspace.
- Tables: `client_account_access`, `client_account_shares`, `client_account_audit`.
- **Withdrawing access (PR #141).** In the admin panel's client-workspace view, an admin can:
  - remove one share or tool;
  - remove one person;
  - withdraw everything.

  This uses `POST /admin/panel/account/<slug>/revoke` with `{"people": [...]|"all", "shares": [...]|"all"}`. Each action asks to confirm. A workspace with nothing left shows "Access withdrawn" and is not counted in the totals.

**Account memory (all 5 phases built, PRs #79–#83; `docs/account-memory-plan.md`):**
- Spaces (`tracker/workspace.py`):
  - `acct:<id>` belongs to the client: the whole team sees it, with who made each piece.
  - `me:<email>` is a person's own workspace: only they see it.
- Every agent's runs, Page Watch, Video Studio and SEO and AEO runs save to the space they were made in.
- The workspace home's **History** lists it all, newest first, with filters. Clients see History only for tools shared with them.
- Phase 4: `tracker/account_brief.py` gives the AI a brief of the account's earlier work, so nobody has to re-explain the client.

## 9. Every agent, with status

The agents page is `templates/b2b_agents.html`, which groups agents into Signals, People & Research, and Vertical Tools. Badge = what the page shows.

The owner-facing plain-English guide is a Claude Doc called **"Northaxis agents: what each one does"**: https://claude.ai/code/artifact/64be5428-49cb-4bc5-a38b-b16d88719d3d. One open comment on it asks whether Page Watch belongs under "Ads, SEO and content".

| Agent | Route | Badge | Notes |
|---|---|---|---|
| **Market Radar** | `/strategic-agents/market-radar` | building | See below. |
| **People & Signals** | `/strategic-agents/people-signals` | building | See below. |
| **Social Media Intelligence** | `/strategic-agents/social-media-intelligence` | live | See below. |
| **Page Watch** | `/strategic-agents/page-watch` | building | See below. |
| **Video Studio** | `/strategic-agents/video-studio` | building | See below. |
| Local Business Radar | `/strategic-agents/local-business-radar` | live | Finds and audits local businesses of one kind in one place, then scores which to pitch. Uses Google Places or Apify, a cost ceiling and resumable runs. See `docs/HANDOFF_2026-10-02.md` §9. |
| Event & Conference Intelligence | `/strategic-agents/event-conference-intelligence` | building | Scores a client's events calendar. Its background worker is not deployed (`python -m tracker.event_intel_jobs`). Deep notes are in V30. |
| Contact Finder | `/strategic-agents/company-people-intelligence` | live | Apollo. Searching is free; enrichment costs 1 credit per record. The owner finds Apollo expensive, which is why People & Signals uses Saleshandy instead. |
| Thought Leader Intelligence | `/strategic-agents/thought-leader-pr` | building | A company's leaders' presence and PR openings. Uses Apify actors (`TLPR_APIFY_*`). |
| ABM Signal Tracker | `/abm-signal-tracker/healthcare` | live | Healthcare's top 50 accounts, refreshed weekly by a GitHub Action. Signals older than 90 days age out. |
| Anonymous Visitors | `/strategic-agents/anonymous-visitors` | live | Website-visitor de-anonymisation (`visitor_intelligence/`). |
| Job Change Alert | `/strategic-agents/job-change-alert` | live | Fed from Apollo's Slack job-change alerts. |
| LinkedIn Intelligence, LinkedIn Strategy Researcher, LinkedIn Social Researcher | `/strategic-agents/linkedin-*` | live | Older agents. The Social Researcher is an external app shown in an iframe. |
| Ad Intelligence | `/strategic-agents/ad-intelligence` | live | React app; the built output is committed in `ad_intelligence/`. |
| Sentiment Pulse | `/strategic-agents/sentiment-pulse` | live | Older agent. Earlier notes said it was switched off; verify before relying on it. |
| Slot Checker Agent | `/strategic-agents/slot-checker` | live | One fixed set of dental practices. |
| Contact Finder Lab | `/admin/contact-lab` | **hidden** | `CONTACT_LAB_HIDDEN = True` (PR #110). Its engine stays because People & Signals reuses its web-search and email-pattern helpers. |

### Market Radar (PRs #99–#104, #112, #115–#119, #131–#133)

Give it a company website and it:
1. **Profiles the company.** It reads the site for free, then one Sonnet call writes a typed profile with quotes. A separate call works out the **niche, buyer and ideal customers**; that call can fail without stopping the profile.
2. **Finds competitors.** Candidates come from five sources: the site, model knowledge, Google via Apify, "top 10" articles, and Overture Maps places nearby. Haiku judges each candidate and Sonnet ranks them.
3. **Researches only the competitors the user confirmed** (PR #132; `market_radar_tracking.py`). This research is free and needs no model:
   - locations, catalogue and prices, promotions, pages, reviews, news and jobs;
   - for B2B companies: subdomains, SEC filings, Apollo headcount, the UK Companies House register and LinkedIn posts.
4. **Writes a cited report** with these sections:
   - Overview, Moves, Nearby & new, Industry pulse, Profile;
   - rival cards and patterns across rivals;
   - a **Leaflet map** of the client's sites and rivals (PR #119). It uses OSM tiles (`MR_MAP_TILES`, `MR_MAP_ATTRIBUTION`).

Other things to know:
- **Local or chain.** A business with up to five sites competes locally around each site; above five sites, it competes with other chains.
- **Sector playbooks and outside readers:** Wikidata, Wikipedia and more (`market_radar_playbooks.py`, `market_radar_outside.py`).
- **Model settings:** `MR_*_MODEL` overrides each stage's model.
- **Costs** go to a ledger and to the admin panel.
- **Monitoring.** `market_radar_monitor.py` would re-run on a schedule, but it is OFF. It needs `MR_MONITOR_ENABLED=1` to run, and `MR_MONITOR_DISABLED=1` stops it outright. **Keep `MR_MONITOR_DISABLED` set.**
- **Real test cases:**
  - Core Care Clinic: three clinics in two states. This is why multi-site local logic exists.
  - July Mode (julymode.com): the niche/ICP work came from this run.
- **Docs:** `docs/market-radar-setup.md` and `docs/market-radar-depth.md`. The old admin URL `/admin/market-radar` redirects.

### People & Signals (PRs #106–#108, #122–#128; `docs/account-mapper-plan.md`)

Renamed from "Account Mapper". Internal module and spend names still say `account_mapper`.

- **Input:** company names plus the job titles you sell to.
- **Output:** the right people with LinkedIn and verified work email, plus a picture of each account: who's who, who is new, which teams are growing, whether the company is hiring, and who to contact first.
- **Built on Saleshandy Lead Finder** (`SALESHANDY_API_KEY`, which the owner has added):
  - search is free;
  - an email reveal costs 1 credit (about $0.026);
  - a phone reveal costs 7 credits and is off by default;
  - a run asks before spending and has a credit cap.
- **Claude (Haiku)** writes optional briefs for cents.
- **Pages:**
  - a seat-map dashboard and run management;
  - a plain-English **chat** ("marketing people at Company X"). It first makes you pick the right company when the name is ambiguous (PR #124). A reload opens a new chat, and old chats live in history.
  - a styled in-card scrollbar.

### Social Media Intelligence (PRs #136–#140)

- Analyses a company's and its competitors' organic social media across platforms (Instagram, Facebook, TikTok, X, YouTube, LinkedIn, Reddit), with Claude reading the creative.
- **LinkedIn is collected through Apify by default** (PR #138).
- **Every paid call is recorded** (`tracker/sci_spend.py`).
- **Each run has a cost cap,** `SCI_RUN_CAP_USD`, default $5.
- **One run at a time per person.** Platforms run in parallel (`SCI_PARALLEL_PLATFORMS`).
- Vision checks no longer run automatically.
- **New page design (PR #139):**
  - a hero and a command bar;
  - a live run view with steps;
  - a "how it works" strip;
  - history cards;
  - a redesigned report drawer, tabs, cards and charts;
  - SVG thumbs-up and thumbs-down feedback buttons (`static/js/agent_feedback.js`).
- **Company search uses Apollo, which is optional.** When `APOLLO_API_KEY` is missing, the page shows a quiet note (PR #140), not an error. Only admins see the variable name.

### Page Watch (PRs #54–#61)

- Watches any page and reports changes with Claude's verdict and a before/after picture.
- **Claude's judge:** Sonnet 5.5, $5 a month by default.
- **Runs on the worker service.** Sends Slack alerts and a digest, and has a watchdog workflow.
- The badge stays "building" until the launch checklist in `docs/page-watch-plan.md` §7 is complete.

### Video Studio (PRs #62–#73)

- Makes a video from a brief: Claude plans it, builds it as a HyperFrames composition, and the worker renders it. It can make any video the user defines, not only launch videos.
- Music beds are included (CC BY 4.0).
- **The worker needs 4 GB.**
- The badge stays "building" until the launch checklist in `docs/video-studio-plan.md` §7 is complete.

## 10. Google Ads: dashboard, AI review, Slack "Ads Insight"

**Pipeline** (full detail in `docs/HANDOFF_2026-10-02.md` §8 and `scripts/google_ads/README.md`):
- Three Google Ads Scripts in the manager account write one Google Sheet.
- Flask reads the sheet with a read-only service account and builds `/dashboards/google-ads`, which includes deep insight panels.

**Currency (PRs #90–#91).** Dashboards show each account in **its own currency**, with an option to convert to INR. The AI review and the Slack digest also report each account in its own currency.

**AI review** (`/dashboards/google-ads/ai-review` or `/<account>/google-ads/ai-review`):
- Claude reviews an account against its brief, taken from the account's tab in the master doc.
- Model: Opus 5.5. Each review costs about $0.50–2. Reviews are stored in Postgres.

**Slack digest, "Ads Insight" (PRs #48–#51, #130):**
- One message per account every day at **11:30 IST** (13:00 until 26 Oct 2026, 10:00 before 20 Oct), posted by the site itself (`tracker/daily_jobs.py`; `GOOGLE_ADS_DIGEST_AT` moves it, `DAILY_JOBS=off` stops the site's jobs). It was started from the `google-ads-slack-digest.yml` GitHub Action on a schedule, but GitHub ran that 4 to 6 hours late (the message reached Slack at about 18:00); the Action is now manual only. Each message has a morning overview, charts, status lights and buttons, in a professional style with no emoji.
- **Answers questions in Slack:** replies under the digest and @mentions (`tracker/gads_slack_chat.py`; needs `GOOGLE_ADS_SLACK_SIGNING_SECRET`).
- **It covers only twelve listed accounts** (`DIGEST_ACCOUNTS` in `tracker/gads_digest.py`, overridable with `GOOGLE_ADS_DIGEST_ACCOUNTS`). The owner's list: AIHS, Alphametic, AllureAvani, Basil woods school, Core Care Clinic, Madge Beauty, July Mode, Greet Technologies, Artistic Yoga (BTA), and the rest named in that constant.

## 11. Admin panel (`/admin`)

PRs #134, #135 and #141 replaced the many admin analytics tabs with **one page**, `templates/admin_panel.html` and `static/js/admin_panel.js`.

- **Sections**, each loaded from `GET /admin/panel/<section>` and cached in `_PANEL_CACHE` (`?fresh=1` forces a reload):
  - **Spend**: money by workspace, agent and person, from every ledger in `tracker/admin_spend.py` `SOURCES`. Periods come from `PANEL_PERIODS`.
  - **Team**: internal users.
  - **Clients**: external users and client-workspace cards. Clicking a card opens `GET /admin/panel/account/<slug>`, with the revoke controls described in section 8.
  - **Traffic**: the public site.
  - **Inbox**: demo requests and access requests.
- The "Client portals" section was removed (PR #135).
- Older `/admin/*` pages still exist behind it for deep views: agent feedback, anonymous traffic, internal and external usage, client usage, public page analytics.

**`SOURCES` (the ledgers):** Market Radar, Local Business Radar, Social Media Intelligence, Account Mapper (People & Signals), Contact Lab, Video Studio, Page Watch and Google Ads AI review are counted in dollars; Event Intelligence and Contact Finder in credits.

## 12. Public site

- **Copy rewritten in Northaxis's own voice (PR #93).** The home headline is "Every deal starts weeks before the first email." (PR #95).
- **Industries pages rewritten (PR #94).** Healthcare, Real Estate and Education are the focus, and Industries is in the nav.
- **Layout fixes:** the hero card deck sits beside the headline (PR #96); the login preview opens on the same headline (PR #97); the footer wordmark no longer clips "Northaxis" (PR #98).
- **Privacy Policy and Terms of Service (PR #129)** are at `/privacy` and `/terms`, linked from every public page. They follow outcomes.digital's own policy. The contact address is `LEGAL_CONTACT_EMAIL`; until that is set, the pages point to the contact form.
- The static build is also published to GitHub Pages from `/docs`.

## 13. Environment variables (names only; values live in Railway → web → Variables)

A missing variable disables only its own feature.

- **Core:** `SECRET_KEY`, `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `STAFF_EMAIL_DOMAIN`, `PUBLIC_BASE_URL`, `LEGAL_CONTACT_EMAIL`, `DB_POOL` (`off` disables pooling), `SLOW_REQUEST_S`.
- **Google:**
  - service accounts: `GOOGLE_SA_JSON`, `GOOGLE_ADS_SHEET_SA_JSON`;
  - sheets and docs: `GOOGLE_ADS_SHEET_ID`, `GOOGLE_ADS_CONTEXT_DOC`, `LOGIN_LOG_SHEET_ID`, `DEMO_REQUEST_SHEET_ID`, `DEMO_NOTIFY_EMAIL`;
  - Maps and page speed: `GOOGLE_MAPS_API_KEY`, `PAGESPEED_API_KEY`.
- **AI:** `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_INSIGHTS_MODEL`, `OPENAI_REASONING_EFFORT`.
- **Data providers:**
  - `APIFY_API_TOKEN` (this exact name);
  - `SALESHANDY_API_KEY`, `APOLLO_API_KEY` (optional), `SERPAPI_KEY`, `SERP_PLATFORM_TOKEN`;
  - `YOUTUBE_API_KEY`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`;
  - `UNIPILE_API_KEY`, `UNIPILE_DSN`, `ARENA_API_KEY`;
  - `IPINFO_TOKEN`, `IDENTIFY_TOKEN`, `HUNTER_API_KEY`, `COMPANIES_HOUSE_API_KEY`, `SEC_USER_AGENT`, `SEARXNG_URL`.
- **Social Media Intelligence:** `SCI_RUN_CAP_USD`, `SCI_PARALLEL_PLATFORMS`, `SCI_APIFY_{FACEBOOK,INSTAGRAM,LINKEDIN,TIKTOK,X}_ACTOR_ID`.
- **Thought Leader Intelligence:** `TLPR_APIFY_*_ACTOR_ID`.
- **Market Radar:** `MR_MONITOR_DISABLED` (keep it set), `MR_MONITOR_ENABLED`, `MR_OUTSIDE`, `MR_MAP_TILES`, `MR_MAP_ATTRIBUTION`, `MR_*_MODEL`.
- **Local Business Radar:** `LBR_SOURCE`, `LBR_RENDER`, `LBR_RENDER_CONCURRENCY`, `LBR_RETENTION_DAYS`, `LBR_PRICES_JSON`, `LBR_APIFY_PRICING`.
- **Event & Conference Intelligence:** `EVI_DAILY_CALL_LIMIT`, `EVI_DAILY_TOKEN_ALLOWANCE`, `EVI_MAX_ACTIVE_PER_ACCOUNT`.
- **Page Watch:** `WATCH_*` (see `docs/HANDOFF_2026-10-02.md` §9a). The worker service also needs `ANTHROPIC_API_KEY`, `SECRET_KEY`, `PUBLIC_BASE_URL` and `RAILPACK_PYTHON_PLAYWRIGHT_INSTALL=1`.
- **Video Studio:** `VIDEO_*` (see `docs/HANDOFF_2026-10-02.md`, Video Studio).
- **SEO Studio:** `SEO_STUDIO_URL`, `SEO_STUDIO_SECRET`.
- **Google Ads Slack:** `GOOGLE_ADS_SLACK_BOT_TOKEN`, `GOOGLE_ADS_SLACK_CHANNEL`, `GOOGLE_ADS_DIGEST_TOKEN` (also a GitHub secret), `GOOGLE_ADS_DIGEST_ACCOUNTS`, `GOOGLE_ADS_SLACK_SIGNING_SECRET`, `GOOGLE_ADS_SLACK_MAX_QUESTIONS_PER_DAY`.
- **Other Slack, mail and GitHub:** `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`, `SLACK_WEBHOOK_URL`, `SMTP_*`, `GMAIL_SENDER`, `GH_DISPATCH_TOKEN`, `GH_REPO`, `GH_WORKFLOW`.

The site's AI features bill the **Anthropic API key in Railway**, which is separate from any claude.ai subscription.

## 14. Railway, deploys, regions, speed

- **Services:**
  - **web**: Flask and gunicorn, Railpack builder, Python 3.11, ffmpeg and Node from `railpack.json`, health check `/health`;
  - **page-watch-worker**;
  - **seo-apps**;
  - **Postgres**.
- If a deploy doesn't start: Railway → web → Deployments → "Deploy Latest Commit".
- **Speed (PRs #120–#121, `docs/performance.md`):**
  - **Database connections** are pooled (`tracker/db_pool.py`).
  - **Static files** are served with `stale-while-revalidate`.
  - **The account list** is cached and refreshed in the background.
  - **Slow requests:** any request slower than `SLOW_REQUEST_S` is logged, and staff can see a Server-Timing breakdown.
  - **`DATABASE_URL`** must be the private `postgres.railway.internal` address.
- **Regions.** Web and Postgres are in Southeast Asia (2026-10-13). Check the worker's region matches: Railway → service → Settings → Region.

## 15. GitHub Actions

| Workflow | What it does |
|---|---|
| `run-tests.yml` | `pytest` and a real-Postgres job, on every PR and push |
| `event-intelligence-tests.yml` | Event & Conference Intelligence tests |
| `seo-studio-tests.yml` | SEO Studio tests |
| `build-frontend.yml` | Ad Intelligence build |
| `google-ads-slack-digest.yml` | The digest, by hand only (the site posts it at 11:30 IST itself) |
| `page-watch-watchdog.yml` | Page Watch watchdog |
| `refresh-dashboards.yml`, `weekly_tracker.yml` | ABM tracker refresh |
| `sync-job-change-alerts.yml` | Job Change Alert sync |

PR checks seen: `pytest`, `postgres`, `build`, `deploy`, `report-build-status`.

## 16. History: PRs #47 to #141

PRs #1–#46 are in `docs/HANDOFF_2026-10-02.md` §12.

| PR | Date | What |
|---|---|---|
| #47 | 10-02 | Handoff doc (`docs/HANDOFF_2026-10-02.md`) |
| #48–#51 | 10-02 | Google Ads Slack digest "Ads Insight": daily per-account messages at 10:00 IST; answers questions in Slack; prettier, then professional with no emoji |
| #52–#53 | 10-02 | Public site: hero fits three lines on phones; old privacy and terms pages removed |
| #54–#61 | 10-03 → 10-04 | Page Watch phases 3–5 and fixes: Claude judge, pages, Slack, watchdog, worker setup; Sonnet at $5 a month; internals taken off the main page |
| #62–#73 | 10-04 → 10-06 | Video Studio phases 1–5, render fixes, ad-quality look, music beds |
| #74–#77 | 10-06 | Client accounts: switcher and `/<account>` pages, client invites, Page Watch and Video Studio inside an account, agents and SEO tools pre-filled |
| #78 | 10-06 | kris@markifydigital.com made an admin |
| #79–#83 | 10-06 → 10-07 | Account memory, phases 1–5 |
| #84 | 10-07 | Workspace home: agent, SEO and History cards in colour |
| #85–#86 | 10-07 | Share a workspace tool by tool, fence clients inside it, Client Usage; clients run shared tools |
| #87 | 10-07 | Called "workspaces": "Kris's Workspace", "AA_New Workspace" |
| #88–#89 | 10-08 | The `video-studio` Claude Code skill, one-click for teammates |
| #90–#91 | 10-08 | Each account in its own currency (dashboard, AI review, Slack) |
| #92 | 10-08 | Site moved to northaxis.outcomes.digital |
| #93–#98 | 10-10 | Public site copy rewrite, Industries pages, new headline, hero, login preview, footer |
| #99–#104 | 10-10 → 10-11 | Market Radar added and fixed on real data; section navigation and new look |
| #105 | 10-12 | Contact Finder Lab (Phase 0) |
| #106–#108 | 10-12 | Account Mapper (Saleshandy), phases 1–5, then renamed People & Signals |
| #109–#110 | 10-12 | Market Radar and People & Signals on the agents page as Building; Contact Lab hidden |
| #111, #113, #114 | 10-12 | Every agent in every workspace; every shared tool reaches clients |
| #112, #115–#119 | 10-12 | Market Radar depth: blocked sites, nine more business types, playbooks, rival cards, benchmark, public records, real map |
| #120–#121 | 10-13 | Request timing; database connection pool; static file caching |
| #122–#128 | 10-13 → 10-14 | People & Signals redesign, seat map, chat (pick the right company, reload opens a new chat), scrollbar |
| #129 | 10-14 | Real Privacy Policy and Terms |
| #130 | 10-14 | Slack digest limited to the twelve listed accounts |
| #131–#133 | 10-14 | Market Radar: niche, buyer and ICP; only confirmed competitors researched; niche read in its own call |
| #134–#135 | 10-14 | One admin panel; Client portals section removed |
| #136–#140 | 10-15 | Social Media Intelligence: spend ledger, cap, one run at a time, LinkedIn via Apify, redesign, quiet Apollo note |
| #141 | 10-16 | Admin panel: withdraw a client's access |

## 17. Open items

### For the owner (outside the code)

1. **Google sign-in branding and verification** (started 2026-10-14, then put on hold by the owner):
   - Add `LEGAL_CONTACT_EMAIL` in Railway.
   - Verify `outcomes.digital` as a Domain property in Google Search Console (a TXT record at the DNS provider).
   - In Google Cloud → Google Auth Platform → Branding, fill in:
     - App name: `Northaxis`;
     - home page: `https://northaxis.outcomes.digital/`;
     - privacy policy: `/privacy`;
     - terms: `/terms`;
     - authorised domain: `outcomes.digital`; delete the Railway subdomain row.
   - Then click View issues → I have fixed the issues.
2. **Page Watch launch.** Finish the checklist in `docs/page-watch-plan.md` §7, then switch the badge to Live.
3. **Video Studio launch.** Finish the checklist in `docs/video-studio-plan.md` §7. The worker needs 4 GB.
4. **Rotate old keys** that were exposed in earlier sessions (Railway screenshot, old Position²-era keys), at each vendor, then update them in Railway.
5. **Google Ads:**
   - confirm the third script (`export_campaign_report.js`) runs before the insights scripts;
   - turn off the old scheduled "Daily Campaign Performance" report;
   - add master-doc tabs for any accounts that still have none.
6. **Railway region.** Confirm the worker is in the same region as web and Postgres.
7. **Old Position² carry-overs** listed in `docs/HANDOFF_2026-10-02.md` §14 (B1–B9, C1–C7, E1–E7). Check each before acting; some are done.

### In the code

- **Security gaps from the V30 audit.** Ask before changing any of these:
  - no CSRF tokens;
  - no explicit `SESSION_COOKIE_SECURE` or `SESSION_COOKIE_SAMESITE`;
  - `X-Forwarded-For` is trusted without `ProxyFix`;
  - no CSP, HSTS or `X-Content-Type-Options` headers.
- **Older agents** in `ACCT_AGENTS_EXEMPT` don't save runs to workspaces. The owner said to leave them for now.
- **Market Radar's monitor** stays disabled until the owner decides on a cadence and a budget.
- **The Event & Conference Intelligence worker** is not deployed. The B2C-profile gate issue from V30 is still open and needs a product decision.
- **The agents doc** has an open comment about where Page Watch belongs.

## 18. Gotchas learned the hard way

- **Tests:**
  - always run with `python3 -B` and `PYTHONDONTWRITEBYTECODE=1`;
  - never monkeypatch `threading.Thread` globally (patch the module's spawn helper);
  - `conftest.py` turns off the live Claude judge, Video Studio and similar features.
- **Panel cache.** After an admin write, pop `_PANEL_CACHE["clients"]` (and `g._acct_shares`) so the next read is fresh.
- **Client shares.** `shared_keys` includes audit history, so a withdrawn workspace still has a row. Use the `withdrawn` flag, not row existence.
- **CSS assertions.** Read every rule for a selector, not just the first; the cascade makes the last one win.
- **Node test shims.** A DOM shim that returns `null` for every query hides real bugs. Give it `global.window = {}` and real elements where a page script needs them.
- **Google Ads Scripts and Docs API quirks** are in `docs/HANDOFF_2026-10-02.md` §15.
- **Cloud sessions:**
  - outbound HTTPS goes through a proxy with its own CA bundle;
  - there is no `gh` CLI, so use the GitHub MCP tools;
  - LibreOffice Writer may need `apt-get install libreoffice-writer` before converting documents.

## 19. Things that live outside the repo

- **Claude Doc** "Northaxis agents: what each one does" (link in section 9).
- **Owner-held Google assets:**
  - the master/context Google Doc, which holds the account profiles and AI review notes;
  - the Google Ads Sheet;
  - the three Google Ads Scripts, installed in the manager account;
  - the service account.

  Never commit the doc or sheet IDs.
- **Marketing work made in chat**, not in the repo:
  - promo videos for Northaxis and CallVibe (a sister product), made with the video-studio and HyperFrames skills;
  - Third Share landing-page versions and ad creatives;
  - free "presenter" videos.

  Ask the owner for files if you need them.
- **The owner's CV** is handled in a separate chat. It is not part of this project.

## 20. The prompt to paste into the new chat

```text
You are taking over the Northaxis platform (repo Krishna-1812/new-agentic-platform) from a
previous Claude session. Read docs/HANDOFF.md end to end first. Then read
docs/HANDOFF_2026-10-02.md for depth (it stops at PR #46; docs/HANDOFF.md covers #47 to #141
and corrects it), and CLAUDE.md.

Run `git fetch origin main && git log origin/main -5` and tell me if main has moved past
66cbe6c (PR #141).

Then confirm your understanding in under 15 lines: what the platform is, where it is live,
how it deploys, the workspaces model, the agent list with status, and the open items in
section 17. Do not change any code yet.

Standing rules (section 3 of the file; follow them for the whole session):
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
- Ask before any paid run (Social Media Intelligence, Market Radar live runs) and tell me
  the cost first. Keep MR_MONITOR_DISABLED set.
- New agents go into every client workspace (ACCT_AGENTS) and, if they spend money, into
  SOURCES in tracker/admin_spend.py (CLAUDE.md).
- I work on a Windows laptop: give exact click-through steps for Railway, Google Cloud,
  Google Ads and Slack.

After your summary, wait for my next instruction.
```
