# Google Ads insights export

`export_insights.js` is a Google Ads Script. It feeds the Impression share, Budget pacing, Search terms, Keywords and Quality Score, Devices, Day and hour, Locations, Conversion actions, Ads, Optimization score and recommendations, Change history, Age and gender, and Landing pages panels on `/dashboards/google-ads`. It runs inside Google Ads, not on the server, so the platform needs no Google Ads API developer token.

## Install (once, about 10 minutes)

The work is split in two so each half gets Google's full time allowance (a manager script with `executeInParallel` may run for 60 minutes). You install the **same file twice**, changing one number.

**Script 1: groups 1 and 2**

1. Sign in to the **manager (MCC) account** that holds the client accounts.
2. Go to **Tools → Bulk actions → Scripts** and click **+ → New script**. Name it `Dashboard insights part 1`.
3. Paste the whole of `export_insights.js`.
4. At the top, set:
   - `SPREADSHEET_URL` to the URL of the Google Sheet the dashboard reads (the sheet whose ID is in the Railway variable `GOOGLE_ADS_SHEET_ID`). The person authorising the script needs **edit** access to that sheet.
   - `PART = 1`.
5. Click **Authorize**, then **Preview**. Preview reads Google Ads without changing it but does write the sheet ([Preview mode](https://developers.google.com/google-ads/scripts/docs/preview)). The log starts with the number of live client accounts, then one line per account as it finishes.
6. Save. On the Scripts list, set **Frequency: Daily**, early morning (for example 06:00).

**Script 2: groups 3 and 4**

7. Repeat steps 2 to 6 with a new script named `Dashboard insights part 2`, the same `SPREADSHEET_URL`, and `PART = 2`. Schedule it an hour after part 1 (for example 07:00).

`PART = 0` runs everything in one script, for managers with few accounts.

**Choosing accounts.** Leave `ACCOUNT_IDS = []` to export every live client account (enabled, not a manager, not a test or hidden account, read in one query). With more than 50, the script ranks them by 30-day spend for up to `RANK_MINUTES` and exports the top 50. To choose them yourself, list them, for example `['123-456-7890', '234-567-8901']`. For a first test, list two or three.

The dashboard picks up the new tabs within 15 minutes, or immediately when you press **Refresh** on the page.

**Updating from an earlier version.** Paste the new file over the old one in both scripts (keep your `SPREADSHEET_URL`, `PART` and `ACCOUNT_IDS`), then **Run** part 1 and, when it has finished, part 2. The first run rewrites every tab with daily figures and removes the old "Insights - IS weekly" tab. Until then the dashboard shows the old tabs as they were exported and labels them "Last 30 days, as exported".

## Dates and filters

Every panel on the dashboard follows every filter above it: the dates (Last day, 7D, 14D, 30D, All or any custom range), the account, campaign type, status, the search box and a campaign you click into. To make that possible the script reads each performance figure **per day** for the last `DAYS` days (90 by default, ending yesterday) and writes, on each row, a **Daily** cell with that item's figures for every day. The dashboard's server adds up the days inside the range being shown, so every total covers everything exported, not only what fits on the page. Each panel heading states the dates it covers; if the range picked reaches beyond the 90 days, the heading says where the figures start.

- **Impression share is rebuilt exactly for any range.** Each day's eligible impressions are its impressions divided by its impression share, and the range's share is its impressions divided by the sum of those. The same holds for top and absolute-top share (using top impressions), click share (using clicks) and every lost share. Rows are read per network, so each share is divided into the impressions it describes. Averaging daily percentages would be wrong and is never done. Days where Google reports "<10%" or ">90%" make the result approximate, and the dashboard marks it "≈".
- **Search terms** are read for days with clicks: cost and conversions are reported on the day of the click, so nothing is left out.
- **Rolled-up rows.** Where an account has more search terms, keywords, locations or landing pages than the script keeps (the costliest `…_PER_ACCOUNT`), the rest are added together into a "(N more …)" row, one per campaign for search terms and keywords. They count toward spend, clicks and conversions but are not listed, so totals still cover the whole account.
- **Current states follow the filters but not the dates:** budgets and pacing (this month), Quality Score, ad strength and approval, optimization score and recommendations are shown as they are now, labelled "Now".
- **Account-level reports** (hours of the day, locations, landing pages) follow the dates and the account; Google does not split them by campaign in this export, so their headings say when a campaign filter does not apply to them.
- **Every account covers the same days.** Each account is exported up to its own yesterday, in its own time zone, so when the script runs, an account in India may already have a day that one in New York does not. A panel showing several accounts adds up only the days all of them have and says "later days are not yet exported for every account shown"; one account on its own shows all of its days. Yesterday counts only once it is `SETTLE_HOURS` (6) hours old in the account's time zone, since Google keeps adding a day's late clicks for a few hours after midnight. Even so, the latest day can differ by a fraction of a percent from a campaign report pulled hours later.
- **How much of the spend a panel covers.** Google's search terms, geographic, landing page and ad reports do not always add up to the campaigns' cost: rare search terms are withheld, some clicks are not placed or assigned to a page, and ads paused or removed since are not listed. Where the campaign report has every day shown, these panels say how much of its spend they account for, e.g. "₹6,10,591 of the ₹9,37,265 spent on Search campaigns in these dates (65%)".
- **Fixed windows** that Google only reports as a whole: served ad combinations, landing-page speed score and mobile-friendly clicks (last 30 days), and change history (last 28 days; the date filter picks the changes inside it).

## The campaign report script (optional)

`export_campaign_report.js` writes the **Daily Campaign Performance** tab, the campaign report the dashboard's main panels read, so it no longer has to come from a report scheduled in the Google Ads interface. It writes the same columns and the same title and date rows, one row per campaign per day with an impression, for the last `DAYS` days (30 by default) ending on each account's own yesterday. Install it in the manager account like the insights script, schedule it daily before the insights script, and **turn off the Google Ads scheduled report** that filled the tab, so the two never overwrite each other.

One difference: the Google Ads API has no converted-currency cost (Google's own conversion exists only in reports built in the Google Ads interface). The script converts each account into the manager account's currency at the **European Central Bank's daily reference rates** (from frankfurter.app; a weekend or holiday takes the last published rate), and US-dollar-pegged currencies (AED, SAR, QAR, OMR, BHD, JOD) through their fixed rate. Row 2 says so, and the dashboard's currency notes then name these rates instead of Google's. They can differ from Google's by a fraction of a percent. A currency with no rate stays in its own currency and the dashboard flags it.

## Currencies

Accounts can be billed in different currencies. The script writes each account's figures in its own currency (the "Currency" column), exactly as Google reports them. The dashboard then shows everything in the campaign report's currency, using **Google's own rates**:

- The scheduled campaign report (the first tab) carries each campaign-day's cost twice: "Cost" in the account's currency and "Cost (Converted currency)" in the manager account's currency. For each account and day, converted ÷ own is the rate Google used. The insights are converted day by day with that rate, so every panel agrees with the campaign report to the paisa. A day with no spend in the report takes the nearest earlier day's rate.
- Settings and forecasts (budgets, bids, targets, recommendation impact) are converted at the account's latest rate. Budget pacing is unaffected, because one rate applies to the whole budget.
- The change history keeps each change in the currency it was typed in: a USD budget change reads "$50 → $80".
- If the report cannot give a rate for an account (the account is missing from it, or the converted columns are missing), that account's money stays in its own currency and is never added to another currency's totals. Panel headings then say "INR accounts only", and the insights heading names the accounts affected.
- If the campaign report itself has no converted-currency columns while accounts bill in different currencies, the dashboard shows a warning at the top: add "Cost (Converted currency)" and "Converted currency code" to the scheduled report.

If a run times out with many large accounts, lower `DAYS` (for example to 60); the dashboard's presets need at most 30.

## What it writes

It adds these tabs at the **end** of the sheet. It never changes the first tab, which holds the campaign report the dashboard already reads.

| Tab | Contents | Period |
|---|---|---|
| Insights - Impression share | Per campaign: impression share (search, top, absolute top, exact match), share lost to budget and to ad rank at each level, click share, display share, bidding strategy, spend and conversions; the dashboard's day-by-day and week-by-week trend comes from the same figures | Daily, last 90 days |
| Insights - Budgets | Per enabled campaign: budget, whether it is shared, delivery, Google's recommended budget, target CPA or ROAS, and spend today, yesterday, in the last 7 days, this month and last month | This month |
| Insights - Search terms | Search term, match type, the keyword it matched, whether it was added or excluded, and clicks, spend, conversions and value | Daily (days with clicks), last 90 days; the 3,000 costliest per account, the rest rolled up |
| Insights - Keywords | Keyword, match type, serving status, Quality Score and its three parts (expected CTR, ad relevance, landing page experience), max CPC, Google's first-page and top-of-page bid estimates, performance, impression share | Daily, last 90 days; the 4,000 costliest per account, the rest rolled up |
| Insights - Devices | Per campaign and device: impressions, clicks, spend, conversions and value | Daily, last 90 days |
| Insights - Hours | Per account and hour (in the account's time zone): the same metrics; the dashboard takes the day of the week from each date | Daily, last 90 days |
| Insights - Locations | Region and city, split into people who were in the place and people interested in it, with the same metrics | Daily, last 90 days; the 3,000 costliest per account, the rest rolled up |
| Insights - Conversions | Per campaign and conversion action: conversions, all conversions and value | Daily, last 90 days |
| Insights - Conversion actions | Every active conversion action: category, status, primary or secondary, counting (one or every), lookback windows, default value, attribution model | Current settings |
| Insights - Ads | Every live ad and Performance Max asset group: ad strength, approval and policy reasons, final URL, headlines and descriptions (with pinning), performance | Live now; performance daily, last 90 days |
| Insights - Ad combinations | The headline and description combinations Google served: top 5 per search ad by impressions, and Google's top combinations per asset group (text, image, video) | Last 30 days |
| Insights - Ad assets | Each headline and description: pinned position, Google's label (Best, Good, Low, Learning), impressions, clicks, spend, conversions | Label now; performance daily, last 90 days |
| Insights - Changes | Every change Google Ads recorded: when, what (campaign, budget, ad group, keyword, ad, targeting), who, through what (website, API, script, or Google's auto-applied recommendations), and the old and new value of each changed field | Last 28 days, the newest 2,000 per account |
| Insights - Optimization | Google's optimization score for each account (with Google's score weight) and each campaign, with spend and conversions | Now; spend last 30 days |
| Insights - Recommendations | Google's open (not dismissed) recommendations: type, campaign, keyword or budget detail, and Google's estimated weekly impact (impressions, clicks, cost, conversions) before and after | Now |
| Insights - Demographics | Per campaign: performance by age range and by gender | Daily, last 90 days |
| Insights - Landing pages | Each final URL: Google's mobile speed score (1 to 10), share of mobile clicks to mobile-friendly pages, and performance | Performance daily, last 90 days (the 500 costliest per account, the rest rolled up); speed and mobile-friendly clicks last 30 days |
| Insights - About | When part 1 (or the single script) ran, the row counts, and any query that failed | – |
| Insights - About (part 2) | The same for part 2 | – |

## AI review

**Dashboard → AI review** (`/dashboards/google-ads/ai-review`) has Claude review one account, every campaign, against the account's **brief**.

- **The account context comes from one running Google Doc** for all accounts, linked once on that page (or with `GOOGLE_ADS_CONTEXT_DOC`). Give each account a heading, or a tab, with its name exactly as in Google Ads, and keep its notes under it: objectives, targets such as budget, ROAS or CPA and conversions, locations, audiences, campaign types, conversion actions, what the account manager is responsible for, and dated updates as things change (where notes conflict, the latest wins). A heading or tab called "General" or "All accounts" is read for every account. Share the doc with the service account that reads the Google Ads sheet (Viewer), and turn on the **Google Docs API** in that service account's Google Cloud project. Each review reads the doc fresh and keeps a copy of exactly what it read. For an account the doc does not cover, notes can still be written or uploaded on the page.
- **A review** reads everything the dashboard has for the account (every campaign for the last 30 days against the 30 before, month-to-date pacing, bidding, impression share, search terms, keywords and Quality Score, ads, devices, age and gender, conversions and their setup, locations, hours, landing pages, change history and Google's recommendations). Claude lists the brief's targets and requirements. The server then measures each target from the data itself: spend and pace, ROAS, CPA, conversions, rates, impression share, and spend inside and outside the target locations. Claude (`claude-opus-5-5`, thinking at high effort) then writes the review: a scorecard against the brief, where the account does not follow it, what is working and what is not, prioritised actions (P1–P3) and a verdict per campaign, plus what the brief is missing.
- **Needs:** `ANTHROPIC_API_KEY` (already set for Local Business Radar) and `DATABASE_URL`, so briefs and reviews survive a deploy. A review takes a few minutes and costs roughly US$0.50–2 of Claude usage; the cost of each review is shown next to it.

## Daily Slack digest

Every day at about **13:00 India time**, the site posts to one Slack channel.

**Which accounts.** Only twelve: AIHS, Alphametic, AllureAvani, Basil woods school, Core Care Clinic, Madge Beauty, July Mode, Greet Technologies, Artistic Yoga(BTA), Turquoise Institute, City College and KFI (`DIGEST_ACCOUNTS` in `tracker/gads_digest.py`). Some accounts go by another name in the digest than in Google Ads (`DISPLAY_NAMES` in `tracker/gads_digest.py`): AA_New is AllureAvani, JulyMode x 2025 is July Mode, BTay is Artistic Yoga (BTA) and Krishnamurti Foundation India is KFI; the list and the Pacing Desk match either name. Case, spaces, punctuation and a bracketed tag such as `(BTA)` don't have to match the sheet, but the rest of the name does: "KFI" will not pick up "KFI Foods". Every other account is left out of the overview and gets no message. To change the list without a deploy, set `GOOGLE_ADS_DIGEST_ACCOUNTS` in Railway → web → Variables (names separated by commas or new lines; `*` sends every account). A listed name that matches nothing in the sheet is not skipped quietly: the Action's reply counts it as `not_found`, and the staff preview names it.

- **First, an overview.** Yesterday's total spend (one line per currency) and conversions, then every account, biggest spend first, each with its main alert.
- **Then one message per account**: a picture laid out like the client report (since 2026-10-20), with what needs attention and the buttons below it. There are no status labels (no "On track", "Worth a look" or "Needs action"), and every message has the same navy side bar. The report is always for **yesterday in India time**: sent on 20 Oct, it covers 19 Oct, and the month so far runs from the 1st to 19 Oct, whatever day the sheet has reached. If the sheet has not reached yesterday and the API cannot stand in, the day is not judged (no "spent nothing" alert). The picture holds:
  - **the month so far** (the 1st to the account's latest day): impressions, clicks, CTR, average CPC, cost, conversions, phone calls, cost per conversion and conversion rate (conversions per click);
  - **yesterday** as a one-row table with the same figures;
  - **the budget**: the month's allocation from the Pacing Desk, the projected budget (the allocation spread evenly over the month, up to the latest day), what has been spent, and the difference, marked *Overspent* (+) or *Underspent* (−). With no Pacing Desk budget for the account that month, its campaigns' daily budgets for the whole month stand in, and the card says so;
  - and, under the picture as text, **what needs attention**, only when there is something, as plain bullets, most urgent first: yesterday against the 7 days before it. For example spend up or down by half or more, or none at all; no conversions on a day the account usually gets one; cost per conversion up 30% or ROAS down 30%; budgets pacing over or under; campaigns losing 10% or more of searches to budget; disapproved ads; data that stopped arriving;
  - buttons to the dashboard and the AI review for that account.
  - **What needs you** (since 2026-10-21): when a client workspace holds the account, the digest's own alerts are replaced by that workspace's briefing (the home's "What needs you", `tracker/account_insights.py`). One line says what the day holds, then the three most important insights follow, each a link to the agent that found it. A first button, **Open the briefing**, opens the workspace's home at the briefing. If the briefing cannot be built, the message goes out with its own alerts.

The month-so-far and latest-day figures, phone calls among them, are read from the **Google Ads API** (`tracker/paid_gads.py`, the same reads the Paid Marketing agents use): one request per account a morning, then its stored days, so about a dozen of the day's 15,000 operations. If the API is not connected, cannot answer for an account, or bills it in another currency than the sheet shows, that card uses the sheet's figures instead and says so; the sheet has no phone calls, so they show "—", never 0. Alerts still compare the sheet's latest day with its 7 days before. The Pacing Desk budget is matched to the account by name (the row's account, else its client), Google rows only.

The figures come from the same sheet and the same conversions as the dashboard. The work happens on the site (`tracker/gads_digest.py`). The GitHub Action `.github/workflows/google-ads-slack-digest.yml` only starts it, at 04:25 UTC. The site remembers the day it last posted for each account, so a retried run never posts twice. Staff can see what would be posted, without posting, at `/api/dashboards/google-ads/slack-digest/preview` (add `?account=` for one account). To see the pictures themselves, open `/api/dashboards/google-ads/slack-digest/preview/cards`: every account's card on one page, as Slack would get it.

**Setup.**

1. Make a Slack app with the `chat:write` scope and invite it to the channel.
2. In Railway → web → Variables, set:
   - `GOOGLE_ADS_SLACK_BOT_TOKEN` (the bot token);
   - `GOOGLE_ADS_SLACK_CHANNEL` (the channel ID);
   - `GOOGLE_ADS_DIGEST_TOKEN` (any long random string).
3. Put the same `GOOGLE_ADS_DIGEST_TOKEN` in GitHub → Settings → Secrets and variables → Actions as a repository secret.

The picture is drawn by `tracker/gads_digest_card.py` and fetched by Slack from `/api/dashboards/google-ads/slack-card/…`: the morning run saves the few figures it shows (a few hundred bytes per account a day), and each address is signed for one account and day with `GOOGLE_ADS_DIGEST_TOKEN` and expires after 45 days. Without that token the figures are written out in the message instead. Messages before 2026-10-20 had a chart, a PNG that Slack fetches from `/api/dashboards/google-ads/slack-chart/…`; the address stays up so those messages keep their pictures until it expires after 45 days. The buttons need the app's **Interactivity** pointed at `/api/slack/interactions`, which only acknowledges the click. To post again on the same day, run the Action by hand with **force** ticked.

The digest never uses `SLACK_BOT_TOKEN` or `SLACK_CHANNEL_ID`. The Action's log shows only counts and Slack error codes, never account names or figures.

### Asking Ads Insight questions in Slack

The Slack app (named **Ads Insight**) also answers questions in its channel.

- **Reply in the thread under an account's morning message** ("why did CPA rise?", "which search terms wasted money?", "what should we change this week?"). The question is about that account. Follow-up replies in the same thread are answered too, unless they @mention someone else.
- **@mention it anywhere in the channel** (`@Ads Insight how is Acme pacing this month?`). It answers in a thread about the account the question names, or compares every account when it names none.

It posts "Checking the numbers..." at once, then replaces it with the answer, usually within a minute.

**What the answer is based on.** Claude (`claude-opus-5-5`, medium effort) answers from:

- the same figures as the dashboard and the AI review: last 30 days against the previous 30 for every campaign, pacing, search terms, keywords, ads and so on;
- the campaign report day by day for the last 30 days;
- the account's part of the context Google Doc;
- the latest AI review.

It is told to quote exact figures and to say when the data does not hold the answer. Most answers cost a few US cents; follow-ups within a few minutes reuse the cached data.

**Limits.**

- Only the channel in `GOOGLE_ADS_SLACK_CHANNEL` is answered, never direct messages or other channels, so client figures stay in that channel. Everyone in the channel can ask.
- At most `GOOGLE_ADS_SLACK_MAX_QUESTIONS_PER_DAY` questions a day (default 150, India time).

**Setup** (once, after the digest works).

1. In Railway, set `GOOGLE_ADS_SLACK_SIGNING_SECRET`. The value is on the Slack app's **Basic Information** page under **App Credentials**.
2. Update the app's manifest with the event subscription and these scopes:
   - `app_mentions:read`
   - `channels:history`
   - `groups:history`
3. The events address is `https://<site>/api/slack/events`.
4. Reinstall the app to the workspace.

The endpoint refuses any request not signed with that secret, or older than five minutes.

## Limits and safety

- **Accounts:** Google runs a manager script in parallel on at most 50 accounts ([Google Ads Scripts limits](https://developers.google.com/google-ads/scripts/docs/limits)). With more than 50, the 50 with the highest spend in the last 30 days are exported. Set `ACCOUNT_IDS` to choose them yourself.
- **Google's 10 MB limit per account:** `processAccount` "can return up to 10MB of data" ([limits](https://developers.google.com/google-ads/scripts/docs/limits)). If an account's result would pass 9.5 MB, the script keeps fewer items in its longest lists and rolls the rest up, so totals stay complete, and logs it.
- **A failed run keeps the last good data:** a tab is never cleared when its new result is empty. Failed queries are listed in "Insights - About".
- **Impression share keeps Google's markers:** 0.0999 means below 10%, and 0.9001 means a lost share above 90% ([field reference](https://developers.google.com/google-ads/api/fields/v25/campaign)). The dashboard shows these as "<10%" and ">90%", and any range built on such a day as "≈".
- **Conversion setup checks follow Google's guidance:** count every conversion for sales and one per click for leads ([About conversion counting options](https://support.google.com/google-ads/answer/3438531)). The dashboard flags lead actions set to count every conversion, page views used as primary actions, and primary actions that recorded nothing in the last 30 days exported (whatever dates are shown).
- **Ad checks follow Google's guidance:** up to 15 headlines and 4 descriptions per responsive search ad, and pinning "isn't recommended for most advertisers and can affect ad strength" ([About responsive search ads](https://support.google.com/google-ads/answer/7684791)).
- **Change history stays inside Google's limits:** the query's date range "must be within the past 30 days" and it needs "a LIMIT clause restricting results to at most 10,000 rows" ([Change event](https://developers.google.com/google-ads/api/docs/change-event)). The script reads 28 days and 2,000 changes per account. Changes carry the email of the person who made them, as in Google Ads' own change history, so keep the sheet restricted to people who may see that.
- **Recommendations and optimization score are Google's estimates:** impact figures are Google's weekly forecasts if a recommendation is applied ([RecommendationMetrics](https://developers.google.com/google-ads/api/reference/rpc/v25/Recommendation.RecommendationMetrics)); the dashboard shows them as forecasts, never as results.
- **Pacing uses Google's own rules:** Google can spend up to twice the average daily budget on one day, but charges no more than the average daily budget × 30.4 in a month ([About average daily budgets](https://support.google.com/google-ads/answer/6385083)).

## Testing without Google Ads

`tests/google_ads_script_harness.js` runs the script under Node against stand-ins for `AdsApp`, `AdsManagerApp`, `SpreadsheetApp` and `Utilities`. `tests/test_google_ads_insights.py` uses it to check the tabs the script writes.
