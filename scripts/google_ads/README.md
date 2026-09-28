# Google Ads insights export

`export_insights.js` is a Google Ads Script. It feeds the Impression share, Budget pacing, Search terms, Keywords and Quality Score, Devices, Day and hour, Locations, Conversion actions, Ads, Optimization score and recommendations, Change history, Age and gender, and Landing pages panels on `/dashboards/google-ads`. It runs inside Google Ads, not on the server, so the platform needs no Google Ads API developer token.

## Install (once, about 5 minutes)

1. Sign in to the **manager (MCC) account** that holds the client accounts.
2. Go to **Tools → Bulk actions → Scripts** and click **+ New script**.
3. Paste the whole of `export_insights.js`.
4. At the top, set `SPREADSHEET_URL` to the URL of the Google Sheet the dashboard reads. This is the sheet whose ID is in the Railway variable `GOOGLE_ADS_SHEET_ID`. The person authorising the script needs **edit** access to that sheet.
5. Click **Authorize**, then **Preview**. The log should list, for each account, the number of campaigns, campaign-weeks, budgets and search terms it read.
6. Click **Run** once, then set **Frequency: Daily**, early morning (for example 06:00), so yesterday's data is complete.

The dashboard picks up the new tabs within 15 minutes, or immediately when you press **Refresh** on the page.

## What it writes

It adds these tabs at the **end** of the sheet. It never changes the first tab, which holds the campaign report the dashboard already reads.

| Tab | Contents | Period |
|---|---|---|
| Insights - Impression share | Per campaign: impression share (search, top, absolute top, exact match), share lost to budget and to ad rank at each level, click share, display share, bidding strategy, spend and conversions | Last 30 days |
| Insights - IS weekly | Search impression share and lost share per campaign per week | Last 13 weeks |
| Insights - Budgets | Per enabled campaign: budget, whether it is shared, delivery, Google's recommended budget, target CPA or ROAS, and spend today, yesterday, in the last 7 days, this month and last month | This month |
| Insights - Search terms | Search term, match type, the keyword it matched, whether it was added or excluded, and clicks, spend, conversions and value | Last 30 days, the 3,000 costliest per account |
| Insights - Keywords | Keyword, match type, serving status, Quality Score and its three parts (expected CTR, ad relevance, landing page experience), max CPC, Google's first-page and top-of-page bid estimates, performance, impression share | Last 30 days, the 4,000 costliest per account |
| Insights - Devices | Per campaign and device: impressions, clicks, spend, conversions and value | Last 30 days |
| Insights - Hours | Per account, day of week and hour (in the account's time zone): the same metrics | Last 30 days |
| Insights - Locations | Region and city, split into people who were in the place and people interested in it, with the same metrics | Last 30 days, the 3,000 costliest rows per account |
| Insights - Conversions | Per campaign and conversion action: conversions, all conversions and value | Last 30 days |
| Insights - Conversion actions | Every active conversion action: category, status, primary or secondary, counting (one or every), lookback windows, default value, attribution model | Current settings |
| Insights - Ads | Every live ad and Performance Max asset group: ad strength, approval and policy reasons, final URL, headlines and descriptions (with pinning), performance | Live now; performance last 30 days |
| Insights - Ad combinations | The headline and description combinations Google served: top 5 per search ad by impressions, and Google's top combinations per asset group (text, image, video) | Last 30 days |
| Insights - Ad assets | Each headline and description: pinned position, Google's label (Best, Good, Low, Learning), impressions, clicks, spend, conversions | Last 30 days |
| Insights - Changes | Every change Google Ads recorded: when, what (campaign, budget, ad group, keyword, ad, targeting), who, through what (website, API, script, or Google's auto-applied recommendations), and the old and new value of each changed field | Last 28 days, the newest 2,000 per account |
| Insights - Optimization | Google's optimization score for each account (with Google's score weight) and each campaign, with spend and conversions | Now; spend last 30 days |
| Insights - Recommendations | Google's open (not dismissed) recommendations: type, campaign, keyword or budget detail, and Google's estimated weekly impact (impressions, clicks, cost, conversions) before and after | Now |
| Insights - Demographics | Per campaign: performance by age range and by gender | Last 30 days |
| Insights - Landing pages | Each final URL: Google's mobile speed score (1 to 10), share of mobile clicks to mobile-friendly pages, and performance | Last 30 days, the 500 costliest per account |
| Insights - About | When it ran, the row counts, and any query that failed | – |

## Limits and safety

- **Accounts:** Google runs a manager script in parallel on at most 50 accounts ([Google Ads Scripts limits](https://developers.google.com/google-ads/scripts/docs/limits)). With more than 50, the 50 with the highest spend in the last 30 days are exported. Set `ACCOUNT_IDS` to choose them yourself.
- **A failed run keeps the last good data:** a tab is never cleared when its new result is empty. Failed queries are listed in "Insights - About".
- **Impression share is written exactly as Google reports it:** 0.0999 means below 10%, and 0.9001 means a lost share above 90% ([field reference](https://developers.google.com/google-ads/api/fields/v25/campaign)). The dashboard shows these as "<10%" and ">90%".
- **Conversion setup checks follow Google's guidance:** count every conversion for sales and one per click for leads ([About conversion counting options](https://support.google.com/google-ads/answer/3438531)). The dashboard flags lead actions set to count every conversion, page views used as primary actions, and primary actions that recorded nothing in 30 days.
- **Ad checks follow Google's guidance:** up to 15 headlines and 4 descriptions per responsive search ad, and pinning "isn't recommended for most advertisers and can affect ad strength" ([About responsive search ads](https://support.google.com/google-ads/answer/7684791)).
- **Change history stays inside Google's limits:** the query's date range "must be within the past 30 days" and it needs "a LIMIT clause restricting results to at most 10,000 rows" ([Change event](https://developers.google.com/google-ads/api/docs/change-event)). The script reads 28 days and 2,000 changes per account. Changes carry the email of the person who made them, as in Google Ads' own change history, so keep the sheet restricted to people who may see that.
- **Recommendations and optimization score are Google's estimates:** impact figures are Google's weekly forecasts if a recommendation is applied ([RecommendationMetrics](https://developers.google.com/google-ads/api/reference/rpc/v25/Recommendation.RecommendationMetrics)); the dashboard shows them as forecasts, never as results.
- **Pacing uses Google's own rules:** Google can spend up to twice the average daily budget on one day, but charges no more than the average daily budget × 30.4 in a month ([About average daily budgets](https://support.google.com/google-ads/answer/6385083)).

## Testing without Google Ads

`tests/google_ads_script_harness.js` runs the script under Node against stand-ins for `AdsApp`, `AdsManagerApp`, `SpreadsheetApp` and `Utilities`. `tests/test_google_ads_insights.py` uses it to check the tabs the script writes.
