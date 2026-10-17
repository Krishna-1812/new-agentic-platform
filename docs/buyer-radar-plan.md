# Buyer Radar

LinkedIn posts from people asking for what we sell, in one place, with a message ready to send.
Built 2026-10-17. On the agents page as **Building**. Page: `/strategic-agents/buyer-radar`, and inside
every workspace at `/<account>/agents/buyer-radar`.

## What it does

1. **Searches LinkedIn posts** for each offer switched on, through Apify's
   [HarvestAPI LinkedIn Post Search](https://apify.com/harvestapi/linkedin-post-search) actor. It needs no
   LinkedIn login. The searches are LinkedIn's own search words, at most 5 AND/OR/NOT a line.
   - **CallVibe:** call analytics, conversation intelligence, call audit and QA, speech analytics, call
     recording, "Gong alternative".
   - **Markify Digital:** marketing agency, digital marketing agency, Google Ads, SEO agency, marketing RFP,
     performance marketing agency.

   Each workspace can change the searches in Settings.
2. **Claude Haiku reads each post** (8 at a time) and decides:
   - whether the author is a buyer, a seller promoting their own product, a job seeker, or other;
   - which offer fits, what they want, and any deadline or region;
   - a score from 0 to 100 for how welcome a message would be now.

   Sellers and job seekers are held to 10 at most, whatever the model says (`buyer_radar_judge.clean_verdict`).
   A post kept once is never kept again for the same workspace.
3. **Writes each lead an email and a LinkedIn note** (and a longer message for a first-degree connection),
   built on the post itself. There are no em dashes and no claims beyond the offer's description.
4. **Saves the leads**, newest first, with filters for strong, new, contacted, replied, not a fit, and by offer.
5. **Sends**, either from the page (the team, after a confirm) or automatically for the workspace's strong
   leads where Settings switches it on.
6. **Posts the strong leads to Slack**, if a channel is set.

## What it costs

Every paid call is recorded in `br_spend`, with who ran it and the workspace. It shows in the admin panel
(`tracker/admin_spend.py` `SOURCES`: "Buyer Radar" in dollars, "Buyer Radar (Saleshandy)" in credits).

| What | Price |
|---|---|
| Apify post search | About $2 per 1,000 posts (Apify's own figure for each run is recorded) |
| Claude Haiku, reading | About $0.01 for 300 posts |
| Claude Haiku, writing | Well under a cent per lead |
| Saleshandy email finding (optional) | 1 credit, about $0.026, per email found |

With the default settings (13 searches × 25 posts = up to 325 posts a day), a run usually costs $0.40–0.70,
about $15–20 a month. Each run has a cap (`run_cap_usd`, default $2): Apify is told to stop charging at 80%
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
| `APIFY_API_TOKEN` | The search (already set for other agents) |
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
- [ ] Unipile's invite and chat routes confirmed against a live response; update the docstrings.
- [ ] The opt-out link tried from a real inbox.
