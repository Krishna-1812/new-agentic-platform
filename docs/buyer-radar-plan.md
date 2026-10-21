# Buyer Radar

People and companies on LinkedIn showing they need what we sell, in one place, with a message ready to send.
Built 2026-10-17; job ads, comments, customer profiles, RFPs and Reddit added 2026-10-21. On the agents page as **Building**. Page:
`/strategic-agents/buyer-radar`, and inside every workspace at `/<account>/agents/buyer-radar`.

## Where it looks

Settings → "Where to look" switches each on for the workspace. All six are on by default; Reddit is
skipped quietly until its keys are set (the page shows "Reddit not set up").

| Source | What it finds | Through | Lead kind (`br_leads.source`) |
|---|---|---|---|
| LinkedIn posts | people posting that they need it | Unipile or Apify | `post` |
| Their comments | people under those posts saying they need it too | Unipile (free) | `comment` |
| Job ads | companies advertising jobs for the work, and who decides there | Unipile (free), Saleshandy's people search (free) | `jobs` |
| Customer profiles | people who fit an offer's customers at a moment that matters | Saleshandy's lead database (free to search) | `icp` |
| RFPs and tenders | organisations asking vendors for proposals, with a due date and a contact | Claude's web search (paid), every `rfp_days` days | `rfp` |
| Reddit | threads asking for a tool or an agency, answered in the thread | Reddit's own API (free) | `reddit` |

Every lead shows where it came from, and the list filters by it (Posts, Comments, Hiring, Profiles, RFPs,
Reddit). A run goes as long as one source switched on can: RFPs need only Claude.

## One company, several places

A company found in two or more places (its job ads and a customer profile, an RFP and a post), in this run
or among the workspace's leads of the last 60 days (`recent_companies`, those marked "Not a fit" left
out), is likelier to buy. Each of its leads gains 8 points for every other place, at most 16 and never past
100, and shows "Also: Hiring, Profile". Companies are compared by `buyer_radar_jobs.company_norm` (case,
punctuation and Ltd, Inc and the like taken off); "Self-employed", "Freelance", "Stealth" and names under
three letters are never matched. Slack and the spreadsheet (column "Also found in") say so too.

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

## Job ads (`tracker/buyer_radar_jobs.py`)

A company hiring a performance marketing manager or an SEO executive is building marketing in house that
it could hand to an agency (Markify). A company hiring call quality analysts or call auditors pays people
to listen to calls that CallVibe scores. Each offer lists the job titles that mean this (`OFFERS[...]["jobs"]`,
editable per workspace in Settings, up to 20).

- **The search** is LinkedIn's own job search through Unipile (`unipile_client.search_jobs`, "Classic -
  JOBS"): the last `jobs_days` days (default 14), newest first, up to `jobs_per_query` ads per title
  (default 20). "Job ads in" takes up to 5 places, turned into LinkedIn's location ids
  (`unipile_client.search_parameters`, type LOCATION). LinkedIn treats a place it does not know as
  anywhere, so the run notes it and leaves it out instead.
- **One lead per company a month.** The ads are grouped by company (`by_company`), under the key
  `jobs:<company>:<YYYY-MM>`, so five SEO roles at one company are one lead, and the same company still
  hiring next month is a fresh one.
- **Claude reads each company** with its own instructions (`buyer_radar_judge.JOB_SYSTEM`). A marketing
  agency hiring marketers, a call analytics vendor, or a recruiter hiring for unnamed clients is a
  seller or "other", held to 10 like any seller. A small or mid-sized company's first hire, or several
  roles, scores highest; a large enterprise hiring one specialist, lowest.
- **Who decides there.** For the companies kept (25 a run at most), Saleshandy's people search names
  the senior people at the company: directors and heads or above first, then the offer's own departments
  (`OFFERS[...]["decision_makers"]`: Marketing, then C-Suite, for Markify; Sales, Customer Service and
  Operations, then C-Suite, for CallVibe). So a VP Marketing comes before the CEO for an agency pitch.
  The search is free. Someone at a company with a similar name is left out (`same_company`). The lead is
  kept as `sh/<Saleshandy id>` until their email is revealed, which also gives their LinkedIn profile.
- **The message** names the roles as something public the team noticed, never as if they asked
  (`DRAFT_SYSTEM`), and greets the decision maker by first name.

## Customer profiles (`tracker/buyer_radar_icp.py`)

Posts, comments and job ads find people who show a need. A customer profile (ICP) finds the people likely to
have it before they say so. A profile describes the people an offer sells to:

- job titles, seniority and departments;
- industries, locations and company keywords;
- company size.

A trigger narrows it to a moment that makes a first message timely. Each trigger is one of Saleshandy's own
search filters (from its OpenAPI, read 2026-10-21):

| Trigger | Saleshandy filter |
|---|---|
| New in their role | people: `jobs_changed_within` 0 to N months |
| Recently funded | companies: `signalIds` 2 and 5 ("Recently Funded", "Freshly Funded & Hiring Fast") |
| New sales or marketing leaders | companies: `signalIds` 3 ("New Executive Hires in GTM") |
| Growing fast | companies: `signalIds` 1 ("Rapid Growth") |
| Uses a product | companies: `technologies_used` (a rival such as Gong or Chorus, or a product the offer works with) |
| Hiring for the work | companies: `active_job_postings_title` |
| Fit alone | none |

**How a profile searches.**

- A company trigger searches companies first. It then finds the people inside up to 15 of them, at most two
  people a company.
- Searching is free. A run takes `icp_per_run` people in all (default 30), shared by the profiles switched on.
- Each person is found once. The search reads on past people the workspace has already met, up to 5 pages,
  so the daily search does not keep finding the same first page.

**Scoring and writing.**

- A person scores 55 for fitting the profile. They score more for the trigger (up to 20), for being a
  director or above (6), for Saleshandy marking them a decision maker (4) and for the profile's own
  department (4).
- Claude does not read them, because they have written nothing. It writes them a cold first message that
  names the moment briefly and never pretends they posted or asked.
- Their email is revealed when the team asks, or automatically for strong leads when "Find work emails" is
  on. The LinkedIn profile comes with the email.

**The starting profiles** (`DEFAULT_ICPS`):

- CallVibe:
  - new sales leaders at inside-sales teams;
  - support and quality heads at contact centres;
  - sales leaders at companies on Gong, Chorus, Avoma or Fireflies.
- Markify:
  - new marketing leaders at growing companies;
  - founders of companies that just raised;
  - companies hiring their first marketers.

Settings has an editor for each offer's profiles: add, remove, switch off, and change every field. **Suggest
with Claude** (`POST /api/icps/suggest`, after a yes, about a cent, recorded in `br_spend`) writes three to
five profiles from the offer's description and the team's notes ("we sell to Indian D2C brands"). They are
checked like typed ones and only kept once Settings is saved.

## Saleshandy sequences

A single email gets one chance. A Saleshandy sequence sends a series and follows up on its own schedule.

- In Settings, each offer can name one of the account's sequences, listed from `GET /v1/sequences`. Leads go
  into its first step.
- A lead with an email address is imported with it, through `POST /v1/sequences/prospects/import-with-field-name`.
  The fields are First Name, Last Name, Email, Company and Job Title, plus the tags "Buyer Radar" and the
  offer. An existing prospect is left unchanged (`noUpdate`).
- "Saleshandy field for the message written" names a custom prospect field that carries Claude's email, so
  the sequence's first email can use it. Make the field in Saleshandy first: an unknown field fails the import.
- A lead known only by Saleshandy's id is added as a lead (`POST /v1/leads/bulk-actions/add-to-sequence`).
  Saleshandy reveals their email itself, for one credit. Buyer Radar allows that only after the team's yes,
  or automatically when "Find work emails" is on.
- Adding someone counts as an email (`br_sends`, channel email). The same opt-outs, nobody-twice rule and
  daily caps apply.
- "Add strong leads to the offer's Saleshandy sequence" (`auto_sequence`) does it automatically, in place of
  the one email, for the offers with a sequence. The drawer has "Add to the sequence" for one lead.

## Comments (`tracker/buyer_radar_comments.py`)

Under "Can anyone recommend a call analytics tool?" most comments are vendors pitching. Some say "we are
looking for the same", "following" or "interested". After the posts are read, the comments of the best
`comment_posts` posts kept (default 10) are read through Unipile (`list_comments`, by the post's social
id). Claude reads each comment against what the post asked for (`COMMENT_SYSTEM`). The post's own author
replying is not a new lead. A commenter is written to on LinkedIn by LinkedIn's own member id, whose case
matters, as the comment gives it.

## RFPs and tenders (`tracker/buyer_radar_rfp.py`)

An organisation that publishes an RFP has a budget, a scope and a deadline, and is asking vendors to
write. Each offer has its own searches (Settings → "RFP searches"; `{year}` is this year), run through
Claude's web search (`contact_lab_search.claude`, one search each). Claude lists what the results show,
as JSON: the title, the issuer, the due date, where, a contact address and a summary. An RFP is dropped
when its link is not one the search returned (so the model cannot invent one) or its due date has passed.
Claude then reads each one against the offers (`RFP_SYSTEM`): the offer's whole scope with time to answer
scores highest, a part of a wider scope less, local or certified vendors only or due within a week lower.

- The search runs once every `rfp_days` days (default 7), counted from the last paid RFP search in
  `br_spend` (op `rfp-search`), not every run: an RFP stays open for weeks.
- The contact address the RFP gives is the lead's email (`email_source` `rfp`). The message asks for the
  documents or the next step and never says they asked.
- An RFP is never sent, emailed or added to a sequence automatically: the team answers it with a
  proposal.

## Reddit (`tracker/buyer_radar_reddit.py`)

Founders and managers ask Reddit what they do not ask on LinkedIn ("Gong is too expensive, what else?",
"Any PPC agency you would recommend?"). Each offer's Reddit searches (Settings) go through Reddit's own
search (`sci_reddit_client.search_posts`, the last month, newest first, `reddit_per_query` threads each).
Claude reads each thread (`REDDIT_SYSTEM`). Nobody on Reddit is emailed or messaged from here: the
drawer has the reply Claude wrote, to copy and post in the thread by hand, after reading the
subreddit's rules, and "I replied" marks it contacted. Needs `REDDIT_CLIENT_ID` and
`REDDIT_CLIENT_SECRET` (a "script" app at reddit.com/prefs/apps).

## Finding an email

"Find their email" in a lead's message drawer (`POST /api/leads/<id>/find-email`, the team only, after a
yes) asks Saleshandy for one person's work email: one credit (about $0.026) if found, nothing if not. At a
hiring company the team picks which decision maker first. The credit is recorded in `br_spend` like the
automatic finding. The automatic finding (Settings: "Find work emails") now also covers decision makers.

## Reading less, finding more

- **Read once.** Every post, comment and company Claude reads is remembered (`br_seen`), kept or not, so
  the next search does not pay to read it again.
- **A fresher daily search.** When a workspace's search finished in the last 6 days and Settings looks back
  a month or 3 months, the daily search reads the last week. The newest posts are then new ones, not
  the same newest posts again.
- **Shared fairly.** Posts and job ads share the day's Unipile results (`split_room`): each gets what it
  asks for when there is room, else an equal share. A smaller one's spare share goes to the other. 20
  searches an offer now (was 12), with more ways buyers word it.
- **A bigger day for Sales Navigator.** LinkedIn allows a Sales Navigator account about 2,500 search
  results a day. Set `BUYER_RADAR_UNIPILE_DAY_MAX` (up to 2,400) when the connected account has it.

## When Claude cannot read

Added 2026-10-20, after a run found 502 posts and kept nothing because Claude read none of them. The
run did not say why.

- **A test post first.** Before the search is paid for, Claude reads one test post (`buyer_radar_judge.check`).
  If that fails (no key, a model the account cannot use, a refusal), the run stops with Claude's own error
  and nothing is charged for posts.
- **Busy, overloaded or cut short.** A rate limit or an overloaded API is waited out, up to three times a
  batch. A reply cut off at its length limit is asked again in two halves. Claude Haiku 5.5 thinks before
  it answers, and the thinking counts toward the limit, so a batch has 6,000 tokens and a draft 3,000.
- **Said, not hidden.** Any other failure skips that batch and keeps the reason. A run that read no post
  fails with the reason. A run that read some notes how many it could not read, and why. Drafts that could
  not be written are noted the same way. The team sees the notes under each search in Recent searches.

### An API key outside a workspace

The test post caught the next failure the same day: Anthropic refused every request with "This API key is
not scoped to a workspace". An organization-level key must name a workspace on each request. Setting
`ANTHROPIC_WORKSPACE_ID` (the `wrkspc_…` ID from console.anthropic.com → Settings → Workspaces) in Railway →
web and worker → Variables sends it on every Claude call in the app (`tracker/claude_workspace.py`, run from
`tracker/__init__.py`). Replacing the key with one made inside a workspace works too. The run shows these
steps instead of the raw error.

## What it costs

Every paid call is recorded in `br_spend`, with who ran it and the workspace. It shows in the admin panel
(`tracker/admin_spend.py` `SOURCES`: "Buyer Radar" in dollars, "Buyer Radar (Saleshandy)" in credits).

| What | Price |
|---|---|
| Unipile post search | Nothing per post (Unipile is paid per connected account) |
| Apify post search | About $2 per 1,000 posts (Apify's own figure for each run is recorded) |
| Claude Haiku, reading | About $0.01 for 300 posts, comments or companies |
| Unipile job search and comments | Nothing per result |
| Saleshandy people search (decision makers, customer profiles) | Nothing; only revealing an email costs |
| Claude Haiku, suggesting customer profiles | About a cent, only on a yes |
| Saleshandy sequences | Nothing to add a prospect with an email; one credit when Saleshandy reveals one |
| Claude Haiku, writing | Well under a cent per lead |
| Claude's web search for RFPs | $10 per 1,000 searches plus the reading, about $0.03 a search; 10 searches once a week by default |
| Reddit search | Nothing |
| Saleshandy email finding (optional) | 1 credit, about $0.026, per email found |

With the default settings (37 post searches × 25 posts, and 19 job titles × 20 ads), a run through Unipile reads about 520 posts and 380 job ads, Unipile's daily 900 shared between them, and costs only Claude's reading: usually about $0.30, at most about $0.95. Through Apify the posts cost about $2 per 1,000 more. A daily search reads the last week once a search has finished that week, and Claude never reads a post, comment or company twice. Each run has a cap (`run_cap_usd`, default $2): Apify is told to stop charging at 80%
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
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | Reddit threads (a Reddit "script" app; already used by Social Media Intelligence if set) |
| `BUYER_RADAR_SLACK_BOT_TOKEN` | Optional; falls back to `GOOGLE_ADS_SLACK_BOT_TOKEN`, then `SLACK_BOT_TOKEN` |
| `BUYER_RADAR_SEND` | `off` stops every send |
| `BUYER_RADAR_APIFY_ACTOR_ID` | Optional; another post-search actor |
| `BUYER_RADAR_UNIPILE_DAY_MAX` | Optional; the day's LinkedIn search results across workspaces (default 900, up to 2,400 for Sales Navigator) |

## Before switching the badge to Live

- [ ] One live search, checked by hand: are the strong leads real buyers?
- [ ] One email and one LinkedIn send to a team member's own address and profile, through each route.
- [ ] Unipile's post search, invite and chat routes confirmed against a live response; update the docstrings.
- [ ] Unipile's job search, location ids and post comments confirmed against a live response.
- [ ] Saleshandy's enrichment by lead id returns the LinkedIn profile with the email (`enriched()["linkedin"]`).
- [ ] Saleshandy's company signals, `jobs_changed_within` (months?) and `technologies_used` confirmed on a live search.
- [ ] One prospect added to a test sequence, with and without the message field.
- [ ] The opt-out link tried from a real inbox.
- [ ] One RFP search per offer checked by hand: are the RFPs real, open and in scope? Tune the searches.
- [ ] One Reddit search with the keys set: are the threads buyers?
