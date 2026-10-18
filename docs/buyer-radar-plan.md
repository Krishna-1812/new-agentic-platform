# Buyer Radar

LinkedIn posts from people asking for what we sell, in one place, with a message ready to send.
Built 2026-10-17. On the agents page as **Building**. Page: `/strategic-agents/buyer-radar`, and inside
every workspace at `/<account>/agents/buyer-radar`.

## What it does

1. **Searches LinkedIn posts** for each offer switched on. "Search with" at the top of the page picks who
   runs LinkedIn's own post search:
   - **Unipile** (the default, `tracker/buyer_radar_unipile.py`): free per post, from the connected LinkedIn
     account (the one Buyer Radar sends from). LinkedIn's filter goes back a month at most, so "Last 3
     months" reads the last month. Unipile advises about 1,000 search results a day for a standard
     account and warns that more risks the account; `DAY_MAX` (900) holds every workspace together under
     it (`buyer_radar_store.unipile_results_today`), and the requests are spaced 2 to 5 seconds apart.
   - **Apify** ([HarvestAPI LinkedIn Post Search](https://apify.com/harvestapi/linkedin-post-search)):
     about $0.002 a post, no LinkedIn login, up to 3 months back.

   The searches are LinkedIn's own search words, at most 5 AND/OR/NOT a line, over the last 3 months by
   default (Settings: last day, week, month or 3 months).
   - **CallVibe:** "looking for a call recording", "recommend a conversation intelligence", "Gong
     alternative", call QA tools, speech analytics vendors, "anyone using Gong".
   - **Markify Digital:** "looking for a marketing agency", "recommend a digital marketing agency", "looking
     for an SEO agency", Google Ads and PPC agencies, marketing RFPs, social media, branding and web agencies.

   Each offer has two kinds of search: a buyer's exact words, and broader ones that pair the topic with
   any buying word (`("call audit" OR "call auditing") AND (looking OR vendor OR freelancer OR need)`,
   `"marketing agency" AND (hiring OR RFP OR "looking for" OR seeking)`), added after two real buyers
   ("Looking for an AI Solution / Freelancer for Call Auditing", "WAE is hiring a marketing agency... The
   RFP goes out") were missed by the exact phrases alone. The first live search (2026-10-18) used loose pairs such as
   `"marketing agency" AND "looking for"` over the last day: of 152 posts, about 150 were sellers ("Looking
   to grow? We are an agency..."), job ads and job seekers, and none was kept. Each workspace can change the
   searches in Settings.
2. **Claude Haiku reads each post** (8 at a time) and decides:
   - whether the author is a buyer, a seller promoting their own product, a job seeker, or other;
   - which offer fits, what they want, and any deadline or region;
   - a score from 0 to 100 for how welcome a message would be now.

   Sellers and job seekers are held to 10 at most, whatever the model says (`buyer_radar_judge.clean_verdict`).
   The offer is held to the run's offer keys (`judge_schema`). A post kept once is never kept again for the
   same workspace. A search that keeps nothing shows the best post it did not keep, with Claude's reason,
   and the run's notes say how many posts Claude could not read.
3. **Writes each lead an email and a LinkedIn note** (and a longer message for a first-degree connection),
   built on the post itself. There are no em dashes and no claims beyond the offer's description.
4. **Saves the leads**, newest first, with filters for strong, new, contacted, replied, not a fit, and by offer.
   **Export CSV** downloads the leads shown, with the same filter (`/api/leads/export`): the person, the post,
   what Claude read, who was written to and, for the team, the drafted messages. A client's file has no
   drafts. A cell starting with = + - @ is written as text, so a post cannot run as a spreadsheet formula.
5. **Sends**, either from the page (the team, after a confirm) or automatically for the workspace's strong
   leads where Settings switches it on.
6. **Posts the strong leads to Slack**, if a channel is set.

## What it costs

Every paid call is recorded in `br_spend`, with who ran it and the workspace. It shows in the admin panel
(`tracker/admin_spend.py` `SOURCES`: "Buyer Radar" in dollars, "Buyer Radar (Saleshandy)" in credits).

| What | Price |
|---|---|
| Unipile post search | Nothing per post (Unipile is paid per connected account) |
| Apify post search | About $2 per 1,000 posts (Apify's own figure for each run is recorded) |
| Claude Haiku, reading | About $0.01 for 300 posts |
| Claude Haiku, writing | Well under a cent per lead |
| Saleshandy email finding (optional) | 1 credit, about $0.026, per email found |

With the default settings (23 searches × 25 posts = up to 575 posts), a run through Unipile costs only
Claude's reading, a few cents; through Apify it usually costs $0.80–1.30. 575 is within Unipile's daily
limit of 900, so one run a day fits. Each search returns its newest posts first, so a daily search over 3 months
fetches (and Apify charges for) many of yesterday's posts again; Claude does not read a post already kept. Each run has a cap (`run_cap_usd`, default $2): Apify is told to stop charging at 80%
of it (`maxTotalChargeUsd`), and Claude stops at the rest. The daily run is skipped once the month's spend
reaches `monthly_cap_usd` (default $40).

## Sending, and the guard rails

All sends go through `buyer_radar_send.can_send`:

- `BUYER_RADAR_SEND=off` on the web service stops every send at once.
- Anyone who opted out is never written to again, from any workspace (`br_suppress`).
- Nobody is written to twice on the same channel, from any workspace (`br_sends`).
- The automatic send keeps to the workspace's daily caps (default 20 emails and 15 LinkedIn sends).
  It only goes to leads at or above `send_score` (default 80).
- LinkedIn sends stop at 60 a day across all workspaces, whoever sends, because there is one
  connected LinkedIn account. Unipile recommends 80–100 invitations a day for a paid account
  ([provider limits](https://developer.unipile.com/docs/provider-limits-and-restrictions)).
- Every email carries an opt-out link (`/buyer-radar/opt-out/<token>`, with one-click
  `List-Unsubscribe` per RFC 8058) and the workspace's postal address. CAN-SPAM asks for a physical
  address in commercial email.

**Email** goes through the platform's Gmail sender (`GMAIL_SENDER` with `GOOGLE_SA_JSON`,
`tracker/market_radar_deliver.py`). Each offer can send from its own address ("Send from" in Settings),
but only an address the service account may impersonate under domain-wide delegation: one in the same
Google Workspace. Replies go to that address too (Reply-To).

**LinkedIn** goes through Unipile, from the connected LinkedIn account (`UNIPILE_LINKEDIN_ACCOUNT_ID`, or
the first working one). A first-degree connection gets a message (`POST /api/v1/chats`). Anyone else gets
a connection request with the note (`POST /api/v1/users/invite`, a note of at most 300 characters).
Neither route has been confirmed against a live response yet.

**Email addresses** come, in order, from:

- the post itself, where the author wrote one;
- an address typed on the page;
- Saleshandy, when "Find work emails" is on, only for strong leads about to be emailed automatically.

## In every workspace

The steps from `CLAUDE.md` and `docs/account-memory-plan.md`:

- **`ACCT_AGENTS`:** inside a workspace, its runs, leads, settings and spend belong to the workspace's
  space (`_mr_email`).
- **History:** `account_history._br`.
- **Client routes:** a client the workspace shares it with may search and read the leads
  (`CLIENT_TOOL_ROUTES`), and a search counts as one of their runs (`CLIENT_RUN_ROUTES`). They see no
  settings, drafts or costs. Their search never sends, never finds emails and never posts to Slack.

## The daily search

`.github/workflows/buyer-radar-daily.yml` runs at 06:47 India time. It calls `POST /api/buyer-radar/daily`
with `BUYER_RADAR_CRON_TOKEN`, which starts one search for each workspace whose "Search LinkedIn every day"
is on. It skips a workspace that already ran that day, that has reached its monthly cap, or that has a
search still going.

## Variables (Railway → web → Variables)

| Variable | What for |
|---|---|
| `UNIPILE_API_KEY`, `UNIPILE_DSN` | The search with Unipile, and LinkedIn sending |
| `APIFY_API_TOKEN` | The search with Apify (already set for other agents) |
| `ANTHROPIC_API_KEY` | Reading and writing (already set) |
| `BUYER_RADAR_CRON_TOKEN` | The daily search; also a GitHub repository secret of the same name |
| `GMAIL_SENDER`, `GOOGLE_SA_JSON` | Email (as Market Radar's weekly email) |
| `UNIPILE_API_KEY`, `UNIPILE_DSN` | LinkedIn sending; `UNIPILE_LINKEDIN_ACCOUNT_ID` pins the account |
| `SALESHANDY_API_KEY` | Optional email finding (already set) |
| `BUYER_RADAR_SLACK_BOT_TOKEN` | Optional; falls back to `GOOGLE_ADS_SLACK_BOT_TOKEN`, then `SLACK_BOT_TOKEN` |
| `BUYER_RADAR_SEND` | `off` stops every send |
| `BUYER_RADAR_APIFY_ACTOR_ID` | Optional; another post-search actor |

## Before switching the badge to Live

- [ ] One live search, checked by hand: are the strong leads real buyers?
- [ ] One email and one LinkedIn send to a team member's own address and profile, through each route.
- [ ] Unipile's post search, invite and chat routes confirmed against a live response; update the docstrings.
- [ ] The opt-out link tried from a real inbox.
