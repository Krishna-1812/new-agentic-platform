/**
 * Google Ads dashboard: insights export (impression share, budget pacing, search terms,
 * keywords and Quality Score, devices, hours, locations, conversion actions, ads and creatives,
 * change history, optimization score, Google's recommendations, age and gender, landing pages).
 *
 * Install in the MANAGER (MCC) account: Tools > Bulk actions > Scripts > +.
 * Paste this file, set SPREADSHEET_URL below to the Google Ads sheet the dashboard
 * already reads (Railway variable GOOGLE_ADS_SHEET_ID), authorise, Preview once,
 * then schedule it Daily (early morning, after Google has finished yesterday's data).
 * The person who authorises it needs EDIT access to that sheet. To give each half its
 * own time allowance, install it twice with PART = 1 and PART = 2 (see PART below).
 *
 * It writes its tabs at the END of the sheet and never touches the first tab (the
 * existing campaign report the dashboard already reads):
 *
 *   Insights - Impression share   one row per campaign, with each day's impression share
 *   Insights - Budgets            budget, bidding and spend so far this month, per campaign
 *   Insights - Search terms       the search terms that got clicks, with the keyword that matched
 *   Insights - Keywords           keywords with Quality Score, its three parts and bid estimates
 *   Insights - Devices            campaign performance by device
 *   Insights - Hours              account performance by hour of day
 *   Insights - Locations          performance by region and city
 *   Insights - Conversions        conversions per campaign per conversion action
 *   Insights - Conversion actions every conversion action and how it is set up
 *   Insights - Ads               every live ad and PMax asset group: ad strength, approval, headlines
 *   Insights - Ad combinations   the headline and description combinations Google actually served
 *   Insights - Ad assets         each headline and description: pinning, Google's label, performance
 *   Insights - Changes           every change made to the account in the last 28 days: what, who, old and new
 *   Insights - Optimization      Google's optimization score for each account and campaign
 *   Insights - Recommendations   Google's open recommendations with their estimated weekly impact
 *   Insights - Demographics      campaign performance by age range and gender
 *   Insights - Landing pages     each final URL: mobile speed score, mobile-friendly clicks, performance
 *   Insights - About              when it ran, the date ranges, and anything that failed
 *                                 (PART = 2 writes "Insights - About (part 2)" instead)
 *
 * Date ranges. The dashboard's date filter works on these tabs: every tab with performance
 * figures has a "Daily" column holding each day's figures for the last DAYS days, as JSON
 * {"v": 1, "from": "yyyy-MM-dd", "d": [[day, figure, figure, ...], ...]}, day 0 being "from"
 * (the field order for each tab is listed with its header below). The other columns hold
 * the totals for the whole window. Where a tab keeps only the items that spent most in each
 * account, one extra row per account ("Rolled up" = how many items) carries the rest, so
 * totals still add up to the whole account.
 *
 * Impression share is rebuilt for any date range from Google's own daily figures, exactly:
 * each row's eligible impressions are its impressions divided by its impression share, and a
 * range's share is its impressions divided by the sum of its eligible impressions (likewise
 * for top and absolute-top shares, whose eligible impressions are the top impressions divided
 * by the top share, and for click share). Rows are split by network so each share is divided
 * into the impressions it describes. Google reports shares "in the range of 0.1 to 1. Any
 * value below 0.1 is reported as 0.0999", and lost shares "in the range of 0 to 0.9. Any
 * value above 0.9 is reported as 0.9001"; days carrying those values are counted ("Capped
 * rows") so the dashboard can mark the result as approximate.
 *
 * Query language reference (Google Ads API, v25):
 *   https://developers.google.com/google-ads/api/fields/v25/campaign
 *   https://developers.google.com/google-ads/api/fields/v25/campaign_budget
 *   https://developers.google.com/google-ads/api/fields/v25/search_term_view
 *   https://developers.google.com/google-ads/api/fields/v25/keyword_view
 *   https://developers.google.com/google-ads/api/fields/v25/ad_group_criterion
 *   https://developers.google.com/google-ads/api/fields/v25/geographic_view
 *   https://developers.google.com/google-ads/api/fields/v25/geo_target_constant
 *   https://developers.google.com/google-ads/api/fields/v25/conversion_action
 *   https://developers.google.com/google-ads/api/fields/v25/ad_group_ad
 *   https://developers.google.com/google-ads/api/fields/v25/asset_group
 *   https://developers.google.com/google-ads/api/fields/v25/ad_group_ad_asset_combination_view
 *   https://developers.google.com/google-ads/api/fields/v25/asset_group_top_combination_view
 *   https://developers.google.com/google-ads/api/fields/v25/ad_group_ad_asset_view
 *   https://developers.google.com/google-ads/api/fields/v25/change_event
 *   https://developers.google.com/google-ads/api/fields/v25/customer
 *   https://developers.google.com/google-ads/api/fields/v25/recommendation
 *   https://developers.google.com/google-ads/api/fields/v25/age_range_view
 *   https://developers.google.com/google-ads/api/fields/v25/gender_view
 *   https://developers.google.com/google-ads/api/fields/v25/landing_page_view
 *   https://developers.google.com/google-ads/api/fields/v25/segments (segments.date, .ad_network_type)
 * Change history: "The date range must be within the past 30 days" and "The query must also
 * include a LIMIT clause restricting results to at most 10,000 rows"
 * (https://developers.google.com/google-ads/api/docs/change-event).
 *
 * Limits (https://developers.google.com/google-ads/scripts/docs/limits): executeInParallel
 * takes at most 50 accounts and "The processAccount method from executeInParallel can return
 * up to 10MB of data", so the busiest 50 accounts are exported, the longest lists are capped
 * per account (the rest rolled up into one row), and an account whose result would pass
 * 9.5 MB has its longest lists cut further. Reports are not subject to entity limits.
 * A tab is never cleared when its new result is empty: a failed run keeps the last good data.
 */

var SPREADSHEET_URL = 'PASTE_THE_GOOGLE_ADS_SHEET_URL_HERE';
var PART = 0;                         // 0 = everything in one script. To split the work in two, install this
                                      // file twice: PART = 1 (impression share, budgets, search terms,
                                      // keywords, devices, hours, locations, conversions) in one script and
                                      // PART = 2 (ads, changes, optimization score, recommendations, age and
                                      // gender, landing pages) in the other. Each gets its own 60 minutes.
var ACCOUNT_IDS = [];                 // optional: limit to e.g. ['123-456-7890']; empty = all (busiest 50 if more)
var DAYS = 90;                        // days of daily detail (yesterday and the DAYS - 1 before it); the
                                      // dashboard's date filter works inside them. Lower it if runs time out.
var MAX_ACCOUNTS = 50;                // executeInParallel's own ceiling
var RANK_MINUTES = 6;                 // time allowed for ranking accounts by spend when there are more than 50
var SEARCH_TERMS_PER_ACCOUNT = 3000;  // by spend; the rest of an account's terms are rolled up into one row
var SEARCH_TERMS_TOTAL = 30000;       // across accounts: with many accounts, each keeps its share of this
var KEYWORDS_PER_ACCOUNT = 4000;      // by spend, rest rolled up
var KEYWORDS_TOTAL = 40000;
var LOCATIONS_PER_ACCOUNT = 3000;     // region x city, by spend, rest rolled up
var LOCATIONS_TOTAL = 30000;
var GEO_BATCH = 300;                  // location names looked up per query
var ADS_PER_ACCOUNT = 2000;           // live ads and asset groups
var COMBOS_PER_AD = 5;                // served combinations kept per RSA, by impressions
var PMAX_COMBOS = 10;                 // Google's top combinations kept per asset group and category
var COMBO_ROWS_PER_ACCOUNT = 4000;
var AD_ASSETS_PER_ACCOUNT = 8000;     // headline and description rows, by impressions
var ASSET_BATCH = 300;                // assets looked up per query
var CHANGE_DAYS = 28;                 // change history window (Google allows up to 30 days back)
var CHANGES_PER_ACCOUNT = 2000;       // newest first; Google's ceiling per query is 10,000
var CHANGES_TOTAL = 20000;
var RECS_PER_ACCOUNT = 1000;          // open (not dismissed) recommendations
var LANDING_PER_ACCOUNT = 500;        // final URLs, by spend, rest rolled up
var LANDING_TOTAL = 10000;
var RETURN_LIMIT = 9500000;           // characters one account may hand back (Google's ceiling is 10 MB)

var TABS = {
  is: 'Insights - Impression share',
  budgets: 'Insights - Budgets',
  terms: 'Insights - Search terms',
  keywords: 'Insights - Keywords',
  devices: 'Insights - Devices',
  hours: 'Insights - Hours',
  locations: 'Insights - Locations',
  conversions: 'Insights - Conversions',
  actions: 'Insights - Conversion actions',
  ads: 'Insights - Ads',
  combos: 'Insights - Ad combinations',
  adAssets: 'Insights - Ad assets',
  changes: 'Insights - Changes',
  health: 'Insights - Optimization',
  recs: 'Insights - Recommendations',
  demographics: 'Insights - Demographics',
  landing: 'Insights - Landing pages',
  about: 'Insights - About',
  about2: 'Insights - About (part 2)'
};

// The figures in each "Daily" cell, in order. Money is in the account's currency.
var PERF = ['impressions', 'clicks', 'cost', 'conversions', 'conv. value'];
var IS_DAILY = ['impressions', 'clicks', 'cost', 'conversions', 'conv. value',
  'search impressions', 'search eligible', 'search lost budget x eligible', 'search lost rank x eligible',
  'exact match share x eligible', 'exact match eligible',
  'top impressions', 'top eligible', 'top lost budget x top eligible', 'top lost rank x top eligible',
  'abs. top impressions', 'abs. top eligible', 'abs. top lost budget x abs. top eligible',
  'abs. top lost rank x abs. top eligible', 'search clicks', 'search eligible clicks',
  'display impressions', 'display eligible', 'display lost budget x display eligible',
  'display lost rank x display eligible', 'capped rows'];
var TERMS_DAILY = ['clicks', 'cost', 'conversions', 'conv. value'];
var KEYWORDS_DAILY = ['impressions', 'clicks', 'cost', 'conversions', 'conv. value',
  'search impressions', 'search eligible', 'search lost rank x eligible', 'capped rows'];
var CONVERSIONS_DAILY = ['conversions', 'conv. value', 'all conversions', 'all conv. value'];
var AD_ASSETS_DAILY = ['impressions', 'clicks', 'cost', 'conversions'];

var IS_HEADER = ['Account', 'Customer ID', 'Currency', 'Campaign ID', 'Campaign', 'Channel', 'Sub-channel',
  'Status', 'Bidding strategy', 'Impressions', 'Clicks', 'Cost', 'Conversions', 'Conv. value',
  'Search IS', 'Search top IS', 'Search abs. top IS',
  'Search lost IS (budget)', 'Search lost IS (rank)',
  'Search lost top IS (budget)', 'Search lost top IS (rank)',
  'Search lost abs. top IS (budget)', 'Search lost abs. top IS (rank)',
  'Search click share', 'Search exact match IS',
  'Display IS', 'Display lost IS (budget)', 'Display lost IS (rank)',
  'Capped rows', 'Date range', 'Exported at', 'Daily'];

var BUDGET_HEADER = ['Account', 'Customer ID', 'Currency', 'Time zone', 'Campaign ID', 'Campaign', 'Channel',
  'Status', 'Bidding strategy', 'Target CPA', 'Target ROAS',
  'Budget ID', 'Budget name', 'Shared budget', 'Campaigns on budget', 'Budget period', 'Delivery',
  'Daily budget', 'Total budget', 'Recommended daily budget',
  'Cost today', 'Cost yesterday', 'Cost last 7 days', 'Cost this month', 'Clicks this month',
  'Conversions this month', 'Conv. value this month', 'Cost last month',
  'Day of month', 'Days in month', 'Month elapsed (days)', 'Exported at'];

var TERMS_HEADER = ['Account', 'Customer ID', 'Currency', 'Campaign ID', 'Campaign', 'Ad group',
  'Search term', 'Search term match', 'Keyword', 'Keyword match', 'Status',
  'Clicks', 'Cost', 'Conversions', 'Conv. value', 'Rolled up', 'Date range', 'Exported at', 'Daily'];

var KEYWORDS_HEADER = ['Account', 'Customer ID', 'Currency', 'Campaign ID', 'Campaign', 'Ad group', 'Keyword ID',
  'Keyword', 'Match type', 'Status', 'Serving', 'Quality Score', 'Expected CTR', 'Ad relevance',
  'Landing page experience', 'Max CPC', 'First page bid', 'Top of page bid',
  'Impressions', 'Clicks', 'Cost', 'Conversions', 'Conv. value', 'Search IS', 'Search lost IS (rank)',
  'Rolled up', 'Date range', 'Exported at', 'Daily'];

var DEVICES_HEADER = ['Account', 'Customer ID', 'Currency', 'Campaign ID', 'Campaign', 'Channel', 'Device',
  'Impressions', 'Clicks', 'Cost', 'Conversions', 'Conv. value', 'Date range', 'Exported at', 'Daily'];

var HOURS_HEADER = ['Account', 'Customer ID', 'Currency', 'Time zone', 'Hour',
  'Impressions', 'Clicks', 'Cost', 'Conversions', 'Conv. value', 'Date range', 'Exported at', 'Daily'];

var LOCATIONS_HEADER = ['Account', 'Customer ID', 'Currency', 'Location type', 'Country', 'Region', 'City',
  'Impressions', 'Clicks', 'Cost', 'Conversions', 'Conv. value', 'Rolled up', 'Date range', 'Exported at', 'Daily'];

var CONVERSIONS_HEADER = ['Account', 'Customer ID', 'Campaign ID', 'Campaign', 'Conversion action',
  'Category', 'Conversions', 'Conv. value', 'All conversions', 'All conv. value', 'Date range', 'Exported at', 'Daily'];

var ACTIONS_HEADER = ['Account', 'Customer ID', 'Action ID', 'Conversion action', 'Category', 'Status', 'Type',
  'Origin', 'Primary for goal', 'In "Conversions"', 'Counting', 'Click-through window (days)',
  'View-through window (days)', 'Default value', 'Always use default value', 'Attribution model', 'Exported at'];

var ADS_HEADER = ['Account', 'Customer ID', 'Currency', 'Campaign ID', 'Campaign', 'Channel', 'Ad group ID',
  'Ad group', 'Ad ID', 'Kind', 'Ad type', 'Status', 'Primary status', 'Approval', 'Review', 'Policy topics',
  'Ad strength', 'Final URL', 'Path 1', 'Path 2', 'Headlines', 'Descriptions', 'Headline count',
  'Description count', 'Pinned', 'Impressions', 'Clicks', 'Cost', 'Conversions', 'Conv. value',
  'Date range', 'Exported at', 'Daily'];

var COMBOS_HEADER = ['Account', 'Customer ID', 'Kind', 'Campaign', 'Ad group', 'Ad group ID', 'Ad ID', 'Category',
  'Rank', 'Impressions', 'Headlines', 'Descriptions', 'Assets JSON', 'Date range', 'Exported at'];

var AD_ASSETS_HEADER = ['Account', 'Customer ID', 'Currency', 'Campaign', 'Ad group', 'Ad group ID', 'Ad ID',
  'Field', 'Text', 'Pinned to', 'Performance label', 'Enabled', 'Impressions', 'Clicks', 'Cost', 'Conversions',
  'Date range', 'Exported at', 'Daily'];

var CHANGES_HEADER = ['Account', 'Customer ID', 'Currency', 'Changed at', 'Resource type', 'Operation',
  'Campaign ID', 'Campaign', 'Ad group', 'Item', 'Changed by', 'Made through', 'Fields changed',
  'Old values', 'New values', 'Exported at'];

var HEALTH_HEADER = ['Account', 'Customer ID', 'Currency', 'Level', 'Campaign ID', 'Campaign', 'Channel', 'Status',
  'Optimization score', 'Score weight', 'Cost', 'Conversions', 'Date range', 'Exported at'];

var RECS_HEADER = ['Account', 'Customer ID', 'Currency', 'Type', 'Campaign ID', 'Campaign', 'Detail',
  'Current budget', 'Recommended budget', 'Base impressions', 'Base clicks', 'Base cost', 'Base conversions',
  'Base conv. value', 'Potential impressions', 'Potential clicks', 'Potential cost', 'Potential conversions',
  'Potential conv. value', 'Impact period', 'Exported at'];

var DEMOGRAPHICS_HEADER = ['Account', 'Customer ID', 'Currency', 'Campaign ID', 'Campaign', 'Channel', 'Dimension',
  'Segment', 'Impressions', 'Clicks', 'Cost', 'Conversions', 'Conv. value', 'Date range', 'Exported at', 'Daily'];

var LANDING_HEADER = ['Account', 'Customer ID', 'Currency', 'Landing page', 'Speed score', 'Mobile-friendly clicks',
  'Valid AMP clicks', 'Quality range', 'Impressions', 'Clicks', 'Cost', 'Conversions', 'Conv. value', 'Rolled up',
  'Date range', 'Exported at', 'Daily'];

var ABOUT_HEADER = ['Item', 'Value'];

// What each tab holds, in the order they are written, and which PART exports it. Recommendations
// follow optimization score: they reuse its campaign names. `cap` bounds the newest-first change rows.
var SECTIONS = [
  { key: 'is', header: IS_HEADER, part: 1, name: 'impression share', run: impressionShare, daily: IS_DAILY },
  { key: 'budgets', header: BUDGET_HEADER, part: 1, name: 'budgets', run: budgets },
  { key: 'terms', header: TERMS_HEADER, part: 1, name: 'search terms', run: searchTerms, daily: TERMS_DAILY },
  { key: 'keywords', header: KEYWORDS_HEADER, part: 1, name: 'keywords', run: keywords, daily: KEYWORDS_DAILY },
  { key: 'devices', header: DEVICES_HEADER, part: 1, name: 'devices', run: devices, daily: PERF },
  { key: 'hours', header: HOURS_HEADER, part: 1, name: 'hours', run: hours, daily: PERF },
  { key: 'locations', header: LOCATIONS_HEADER, part: 1, name: 'locations', run: locations, daily: PERF },
  { key: 'conversions', header: CONVERSIONS_HEADER, part: 1, name: 'conversions', run: conversions, daily: CONVERSIONS_DAILY },
  { key: 'actions', header: ACTIONS_HEADER, part: 1, name: 'conversion actions', run: conversionActions },
  { key: 'ads', header: ADS_HEADER, part: 2, name: 'ads', run: ads, daily: PERF },
  { key: 'combos', header: COMBOS_HEADER, part: 2, name: 'ad combinations', run: combinations },
  { key: 'adAssets', header: AD_ASSETS_HEADER, part: 2, name: 'ad assets', run: adAssets, daily: AD_ASSETS_DAILY },
  { key: 'changes', header: CHANGES_HEADER, part: 2, name: 'change history', run: changes, cap: CHANGES_TOTAL, label: 'Changes', sortBy: 'Changed at' },
  { key: 'health', header: HEALTH_HEADER, part: 2, name: 'optimization score', run: optimization },
  { key: 'recs', header: RECS_HEADER, part: 2, name: 'recommendations', run: recommendations },
  { key: 'demographics', header: DEMOGRAPHICS_HEADER, part: 2, name: 'demographics', run: demographics, daily: PERF },
  { key: 'landing', header: LANDING_HEADER, part: 2, name: 'landing pages', run: landingPages, daily: PERF }
];

function inPart(x) { return !PART || x.part === PART; }


function main() {
  if (SPREADSHEET_URL.indexOf('docs.google.com') < 0) {
    throw new Error('Set SPREADSHEET_URL at the top of the script to the Google Ads sheet first.');
  }
  if ([0, 1, 2].indexOf(PART) < 0) throw new Error('PART must be 0, 1 or 2.');
  Logger.log('Exporting ' + (PART ? 'part ' + PART + ': ' : 'everything: ') +
    SECTIONS.filter(inPart).map(function (x) { return x.name; }).join(', '));
  if (typeof AdsManagerApp !== 'undefined') {
    var ids = ACCOUNT_IDS.length ? ACCOUNT_IDS : busiestAccounts();
    Logger.log('Exporting ' + ids.length + ' accounts: ' + ids.join(', '));
    AdsManagerApp.accounts().withIds(ids).executeInParallel('processAccount', 'writeAll',
      JSON.stringify({ accounts: ids.length }));
  } else {
    var value = processAccount(JSON.stringify({ accounts: 1 }));
    writeAll([{ getStatus: function () { return 'OK'; }, getReturnValue: function () { return value; },
                getCustomerId: function () { return AdsApp.currentAccount().getCustomerId(); } }]);
  }
}


/**
 * The live client accounts, or the MAX_ACCOUNTS that spent most in the last 30 days when there
 * are more. One query to the manager account lists every client with its status, so closed,
 * cancelled, suspended, hidden, test and sub-manager accounts are never opened
 * (https://developers.google.com/google-ads/api/fields/v25/customer_client). Account selectors
 * can no longer be ordered by performance (their forDateRange is deprecated), so spend is then
 * read account by account, for at most RANK_MINUTES.
 */
function busiestAccounts() {
  var ids = liveAccounts();
  if (ids.length <= MAX_ACCOUNTS) return ids;
  Logger.log(ids.length + ' live accounts; ranking them by spend in the last 30 days to pick ' + MAX_ACCOUNTS + '.');
  var spend = {}, started = Date.now(), done = 0;
  var accounts = AdsManagerApp.accounts().withIds(ids).get();
  while (accounts.hasNext()) {
    if (Date.now() - started > RANK_MINUTES * 60000) {
      Logger.log('Ranking stopped after ' + RANK_MINUTES + ' minutes (' + done + ' of ' + ids.length +
        ' read); the rest are ranked last. Set ACCOUNT_IDS to choose accounts yourself.');
      break;
    }
    var a = accounts.next();
    AdsManagerApp.select(a);
    spend[a.getCustomerId()] = 0;
    try {
      var r = AdsApp.search('SELECT metrics.cost_micros FROM customer WHERE segments.date DURING LAST_30_DAYS');
      while (r.hasNext()) spend[a.getCustomerId()] += Number(r.next().metrics.costMicros || 0);
    } catch (e) {
      Logger.log('Could not read spend for ' + a.getCustomerId() + ': ' + e);
    }
    if (++done % 25 === 0) Logger.log('Ranked ' + done + ' of ' + ids.length + ' accounts.');
  }
  ids.sort(function (x, y) { return (spend[y] || 0) - (spend[x] || 0); });
  return ids.slice(0, MAX_ACCOUNTS);
}

/** Enabled, non-manager, non-test, visible client accounts, as 123-456-7890. */
function liveAccounts() {
  var ids = [];
  try {
    var rows = AdsApp.search('SELECT customer_client.id, customer_client.status, customer_client.manager, ' +
      'customer_client.test_account, customer_client.hidden FROM customer_client ' +
      "WHERE customer_client.status = 'ENABLED' AND customer_client.manager = FALSE");
    while (rows.hasNext()) {
      var c = rows.next().customerClient;
      if (c.testAccount || c.hidden) continue;
      var d = String(c.id);
      ids.push(d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6));
    }
  } catch (e) {
    Logger.log('Could not list client accounts in one query (' + e + '); listing them one by one.');
    var it = AdsManagerApp.accounts().get();
    while (it.hasNext()) ids.push(it.next().getCustomerId());
  }
  Logger.log(ids.length + ' live client accounts under this manager account.');
  return ids;
}


/** Runs once per account (in parallel under a manager account). Returns JSON. */
function processAccount(input) {
  var acct = AdsApp.currentAccount();
  var tz = acct.getTimeZone();
  var opts = {};
  try { opts = JSON.parse(input || '{}') || {}; } catch (e) { opts = {}; }
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var ctx = {
    name: acct.getName(), cid: acct.getCustomerId(), currency: acct.getCurrencyCode(), tz: tz,
    now: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'), errors: [], lists: {},
    accounts: Math.max(1, Number(opts.accounts) || 1),
    from: isoAdd(today, -DAYS), to: isoAdd(today, -1)
  };
  ctx.during = "segments.date BETWEEN '" + ctx.from + "' AND '" + ctx.to + "'";
  ctx.range = ctx.from + ' to ' + ctx.to;
  Logger.log('[' + ctx.name + '] started; daily detail ' + ctx.range + '.');
  var out = { account: ctx.name, errors: ctx.errors, from: ctx.from, to: ctx.to, rolled: {} };
  SECTIONS.filter(inPart).forEach(function (x) {
    var started = Date.now();
    out[x.key] = guarded(ctx, x.name, function () { return x.run(ctx); }) || [];
    Logger.log('[' + ctx.name + '] ' + x.name + ': ' + out[x.key].length + ' rows in ' +
      Math.round((Date.now() - started) / 1000) + ' s');
  });
  fitReturn(ctx, out);
  Object.keys(ctx.lists).forEach(function (k) { if (ctx.lists[k].rolled) out.rolled[k] = ctx.lists[k].rolled; });
  Logger.log('[' + ctx.name + '] done' + (ctx.errors.length ? ', ' + ctx.errors.length + ' failed queries' : ''));
  return JSON.stringify(out);
}

/** An account's share of a cross-account total, never more than the per-account cap. */
function capFor(ctx, perAccount, total) {
  return Math.max(1, Math.min(perAccount, Math.floor(total / ctx.accounts)));
}

/**
 * Keeps one account's result under Google's 10 MB ceiling: while it is too long, the longest
 * capped list keeps 30% fewer items and rolls the rest into its "Rolled up" row.
 */
function fitReturn(ctx, out) {
  for (var round = 0; round < 40 && JSON.stringify(out).length > RETURN_LIMIT; round++) {
    var keys = Object.keys(ctx.lists).filter(function (k) { return out[k] && ctx.lists[k].kept > 1; });
    if (!keys.length) break;
    keys.sort(function (a, b) { return out[b].length - out[a].length; });
    var l = ctx.lists[keys[0]];
    l.cap = Math.max(1, Math.floor(Math.min(l.cap, l.kept) * 0.7));
    out[keys[0]] = l.build();
    Logger.log('[' + ctx.name + '] result too large; ' + keys[0] + ' cut to the top ' + l.cap + ' items.');
  }
}


// ── Daily detail ─────────────────────────────────────────────────────────────
// Each item's figures per day. The rows written carry the window's totals and a "Daily" cell.

function isoAdd(iso, n) {
  var p = iso.split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)).toISOString().slice(0, 10);
}
function dayIndex(from, iso) {
  var a = from.split('-'), b = String(iso).slice(0, 10).split('-');
  return Math.round((Date.UTC(+b[0], +b[1] - 1, +b[2]) - Date.UTC(+a[0], +a[1] - 1, +a[2])) / 86400000);
}
function zeros(n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; }
function r4(x) { return Math.round(x * 10000) / 10000; }

function Daily(width) { this.width = width; this.items = {}; this.keys = []; }
/** Adds one day's figures to an item (created with `info` the first time). */
Daily.prototype.add = function (key, info, date, vals) {
  var it = this.items[key], w = this.width;
  if (!it) {
    it = this.items[key] = { info: info, days: {}, sum: zeros(w), n: 1 };
    this.keys.push(key);
  }
  var d = it.days[date] || (it.days[date] = zeros(w));
  for (var i = 0; i < w; i++) { d[i] += vals[i] || 0; it.sum[i] += vals[i] || 0; }
  return it;
};
Daily.prototype.list = function () {
  var self = this;
  return this.keys.map(function (k) { return self.items[k]; });
};
/**
 * The `cap` items highest on figure `by`, and the others folded together: one item per group
 * (groupOf(item) -> {key, info}; one per campaign keeps every filter on the dashboard exact),
 * or a single one when there is no groupOf.
 */
Daily.prototype.top = function (by, cap, groupOf) {
  var list = this.list(), w = this.width;
  list.sort(function (a, b) { return b.sum[by] - a.sum[by]; });
  if (list.length <= cap) return { kept: list, rests: [] };
  var rests = {}, order = [];
  list.slice(cap).forEach(function (it) {
    var g = groupOf ? groupOf(it) : { key: '', info: null };
    var rest = rests[g.key];
    if (!rest) { rest = rests[g.key] = { info: g.info, days: {}, sum: zeros(w), n: 0 }; order.push(g.key); }
    rest.n++;
    for (var i = 0; i < w; i++) rest.sum[i] += it.sum[i];
    Object.keys(it.days).forEach(function (d) {
      var x = rest.days[d] || (rest.days[d] = zeros(w));
      for (var j = 0; j < w; j++) x[j] += it.days[d][j];
    });
  });
  return { kept: list.slice(0, cap), rests: order.map(function (k) { return rests[k]; }) };
};

/** {"v":1,"from":...,"d":[[day, figures...]]} for one item. */
function dailyJson(ctx, it) {
  var d = Object.keys(it.days).sort().map(function (day) {
    return [dayIndex(ctx.from, day)].concat(it.days[day].map(r4));
  });
  return JSON.stringify({ v: 1, from: ctx.from, d: d });
}

/**
 * A capped list: the `cap` items highest on figure `by` become rows, the rest rolled-up rows (one per
 * group, see Daily.top). Registered so fitReturn can cut it further. toRow(item) and restRow(rest)
 * build the rows.
 */
function cappedRows(ctx, key, daily, by, cap, toRow, restRow, groupOf) {
  var l = ctx.lists[key] = { cap: cap, rolled: 0 };
  l.build = function () {
    var t = daily.top(by, l.cap, groupOf), rows = t.kept.map(toRow);
    l.kept = t.kept.length;
    l.rolled = t.rests.reduce(function (n, r) { return n + r.n; }, 0);
    return rows.concat(t.rests.map(restRow));
  };
  return l.build();
}

/** "(3 more search terms)": the name of a rolled-up row. */
function more(n, noun) { return '(' + n + ' more ' + noun + (n === 1 ? '' : 's') + ')'; }

function perfOf(m) {
  return [num(m.impressions), num(m.clicks), cost(m.costMicros), num(m.conversions), num(m.conversionsValue)];
}
function perfCols(sum) { return [sum[0], sum[1], r2(sum[2]), r4(sum[3]), r4(sum[4])]; }
var LOW_SHARE = 0.0999, HIGH_LOST = 0.9001;
function isCapped(v, lost) { return v != null && Math.abs(v - (lost ? HIGH_LOST : LOW_SHARE)) < 1e-9; }


// ── Impression share, per campaign per day ───────────────────────────────────
function impressionShare(ctx) {
  var q = 'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ' +
    'campaign.advertising_channel_sub_type, campaign.bidding_strategy_type, segments.date, ' +
    'segments.ad_network_type, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, ' +
    'metrics.search_impression_share, metrics.search_top_impression_share, ' +
    'metrics.search_absolute_top_impression_share, ' +
    'metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share, ' +
    'metrics.search_budget_lost_top_impression_share, metrics.search_rank_lost_top_impression_share, ' +
    'metrics.search_budget_lost_absolute_top_impression_share, ' +
    'metrics.search_rank_lost_absolute_top_impression_share, ' +
    'metrics.search_click_share, metrics.search_exact_match_impression_share, ' +
    'metrics.content_impression_share, metrics.content_budget_lost_impression_share, ' +
    'metrics.content_rank_lost_impression_share, metrics.top_impression_percentage, ' +
    'metrics.absolute_top_impression_percentage ' +
    'FROM campaign WHERE ' + ctx.during + ' AND metrics.impressions > 0';
  var rows = AdsApp.search(q), daily = new Daily(IS_DAILY.length);
  while (rows.hasNext()) {
    var r = rows.next(), c = r.campaign;
    daily.add(c.id, c, r.segments.date, shareFigures(r.metrics));
  }
  return daily.list().map(function (it) {
    var c = it.info, s = it.sum;
    return [ctx.name, ctx.cid, ctx.currency, c.id, c.name, c.advertisingChannelType,
      c.advertisingChannelSubType || '', c.status, c.biddingStrategyType || ''].concat(perfCols(s), [
      ratio(s[5], s[6]), ratio(s[11], s[12]), ratio(s[15], s[16]),
      ratio(s[7], s[6]), ratio(s[8], s[6]), ratio(s[13], s[12]), ratio(s[14], s[12]),
      ratio(s[17], s[16]), ratio(s[18], s[16]), ratio(s[19], s[20]), ratio(s[9], s[10]),
      ratio(s[21], s[22]), ratio(s[23], s[22]), ratio(s[24], s[22]),
      s[25], ctx.range, ctx.now, dailyJson(ctx, it)]);
  });
}

/**
 * One row's figures in IS_DAILY order. Eligible impressions = impressions / share; the lost
 * shares are fractions of the same eligible impressions, so each is carried as share x eligible.
 */
function shareFigures(m) {
  var v = zeros(IS_DAILY.length), I = num(m.impressions), K = num(m.clicks);
  var p = perfOf(m);
  for (var i = 0; i < 5; i++) v[i] = p[i];
  var S = pos(m.searchImpressionShare), capped = false;
  if (S) {
    var E = I / S;
    v[5] = I; v[6] = E;
    v[7] = (nz(m.searchBudgetLostImpressionShare)) * E;
    v[8] = (nz(m.searchRankLostImpressionShare)) * E;
    if (m.searchExactMatchImpressionShare != null && m.searchExactMatchImpressionShare !== '') {
      v[9] = Number(m.searchExactMatchImpressionShare) * E; v[10] = E;
    }
    capped = capped || isCapped(S) || isCapped(nz(m.searchBudgetLostImpressionShare), true) ||
      isCapped(nz(m.searchRankLostImpressionShare), true) || isCapped(share(m.searchExactMatchImpressionShare));
  }
  var T = pos(m.searchTopImpressionShare), tp = m.topImpressionPercentage;
  if (T && tp != null && tp !== '') {
    var TI = I * Number(tp), ET = TI / T;
    v[11] = TI; v[12] = ET;
    v[13] = nz(m.searchBudgetLostTopImpressionShare) * ET;
    v[14] = nz(m.searchRankLostTopImpressionShare) * ET;
    capped = capped || isCapped(T) || isCapped(nz(m.searchBudgetLostTopImpressionShare), true) ||
      isCapped(nz(m.searchRankLostTopImpressionShare), true);
  }
  var A = pos(m.searchAbsoluteTopImpressionShare), ap = m.absoluteTopImpressionPercentage;
  if (A && ap != null && ap !== '') {
    var AI = I * Number(ap), EA = AI / A;
    v[15] = AI; v[16] = EA;
    v[17] = nz(m.searchBudgetLostAbsoluteTopImpressionShare) * EA;
    v[18] = nz(m.searchRankLostAbsoluteTopImpressionShare) * EA;
    capped = capped || isCapped(A) || isCapped(nz(m.searchBudgetLostAbsoluteTopImpressionShare), true) ||
      isCapped(nz(m.searchRankLostAbsoluteTopImpressionShare), true);
  }
  var C = pos(m.searchClickShare);
  if (C) { v[19] = K; v[20] = K / C; capped = capped || isCapped(C); }
  var D = pos(m.contentImpressionShare);
  if (D) {
    var ED = I / D;
    v[21] = I; v[22] = ED;
    v[23] = nz(m.contentBudgetLostImpressionShare) * ED;
    v[24] = nz(m.contentRankLostImpressionShare) * ED;
    capped = capped || isCapped(D) || isCapped(nz(m.contentBudgetLostImpressionShare), true) ||
      isCapped(nz(m.contentRankLostImpressionShare), true);
  }
  v[25] = capped ? 1 : 0;
  return v;
}
function pos(v) { var x = v == null || v === '' ? 0 : Number(v); return x > 0 ? x : 0; }
function nz(v) { return v == null || v === '' ? 0 : Number(v); }
function ratio(a, b) { return b > 0 ? r6(a / b) : ''; }
function r6(x) { return Math.round(x * 1e6) / 1e6; }


// ── Budgets and pacing ───────────────────────────────────────────────────────
function budgets(ctx) {
  var camps = {}, order = [];
  var q = 'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ' +
    'campaign.bidding_strategy_type, campaign_budget.id, campaign_budget.name, ' +
    'campaign_budget.amount_micros, campaign_budget.total_amount_micros, campaign_budget.period, ' +
    'campaign_budget.delivery_method, campaign_budget.explicitly_shared, campaign_budget.reference_count, ' +
    'campaign_budget.has_recommended_budget, campaign_budget.recommended_budget_amount_micros ' +
    "FROM campaign WHERE campaign.status = 'ENABLED'";
  var rows = AdsApp.search(q);
  while (rows.hasNext()) {
    var r = rows.next(), c = r.campaign, b = r.campaignBudget || {};
    camps[c.id] = {
      c: c, b: b, tcpa: '', troas: '',
      cost: { TODAY: 0, YESTERDAY: 0, LAST_7_DAYS: 0, THIS_MONTH: 0, LAST_MONTH: 0 },
      clicks: 0, conv: 0, value: 0
    };
    order.push(c.id);
  }
  guarded(ctx, 'bidding targets', function () {
    var t = AdsApp.search('SELECT campaign.id, campaign.target_cpa.target_cpa_micros, ' +
      'campaign.target_roas.target_roas, campaign.maximize_conversions.target_cpa_micros, ' +
      "campaign.maximize_conversion_value.target_roas FROM campaign WHERE campaign.status = 'ENABLED'");
    while (t.hasNext()) {
      var r = t.next(), x = camps[r.campaign.id];
      if (!x) continue;
      var c = r.campaign;
      var cpa = (c.targetCpa && c.targetCpa.targetCpaMicros) ||
        (c.maximizeConversions && c.maximizeConversions.targetCpaMicros);
      var roas = (c.targetRoas && c.targetRoas.targetRoas) ||
        (c.maximizeConversionValue && c.maximizeConversionValue.targetRoas);
      x.tcpa = cpa ? money(cpa) : '';
      x.troas = roas ? Number(roas) : '';
    }
  });
  ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'THIS_MONTH', 'LAST_MONTH'].forEach(function (range) {
    guarded(ctx, 'spend ' + range, function () {
      var s = AdsApp.search('SELECT campaign.id, metrics.cost_micros, metrics.clicks, metrics.conversions, ' +
        "metrics.conversions_value FROM campaign WHERE campaign.status = 'ENABLED' " +
        'AND segments.date DURING ' + range);
      while (s.hasNext()) {
        var r = s.next(), x = camps[r.campaign.id];
        if (!x) continue;
        x.cost[range] = money(r.metrics.costMicros);
        if (range === 'THIS_MONTH') {
          x.clicks = num(r.metrics.clicks);
          x.conv = num(r.metrics.conversions);
          x.value = num(r.metrics.conversionsValue);
        }
      }
    });
  });
  var now = new Date();
  var day = Number(Utilities.formatDate(now, ctx.tz, 'd'));
  var hour = Number(Utilities.formatDate(now, ctx.tz, 'H')) + Number(Utilities.formatDate(now, ctx.tz, 'm')) / 60;
  var y = Number(Utilities.formatDate(now, ctx.tz, 'yyyy')), mo = Number(Utilities.formatDate(now, ctx.tz, 'M'));
  var dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  var elapsed = Math.round(((day - 1) + hour / 24) * 1000) / 1000;
  return order.map(function (id) {
    var x = camps[id], c = x.c, b = x.b;
    return [ctx.name, ctx.cid, ctx.currency, ctx.tz, c.id, c.name, c.advertisingChannelType, c.status,
      c.biddingStrategyType || '', x.tcpa, x.troas,
      b.id || '', b.name || '', b.explicitlyShared === true, num(b.referenceCount), b.period || '',
      b.deliveryMethod || '', b.amountMicros ? money(b.amountMicros) : '',
      b.totalAmountMicros ? money(b.totalAmountMicros) : '',
      b.hasRecommendedBudget ? money(b.recommendedBudgetAmountMicros) : '',
      x.cost.TODAY, x.cost.YESTERDAY, x.cost.LAST_7_DAYS, x.cost.THIS_MONTH, x.clicks, x.conv, x.value,
      x.cost.LAST_MONTH, day, dim, elapsed, ctx.now];
  });
}


// ── Search terms that got clicks, per day ────────────────────────────────────
// Only days with clicks are read: cost, clicks and conversions all fall on click days (conversions
// are reported against the date of the click), so no spend or conversion is left out.
function searchTerms(ctx) {
  var q = 'SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, search_term_view.search_term, ' +
    'search_term_view.status, segments.search_term_match_type, ' +
    'segments.keyword.info.text, segments.keyword.info.match_type, segments.date, ' +
    'metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value ' +
    'FROM search_term_view WHERE ' + ctx.during + ' AND metrics.clicks > 0';
  var rows = AdsApp.search(q), daily = new Daily(TERMS_DAILY.length);
  while (rows.hasNext()) {
    var r = rows.next(), m = r.metrics, kw = (r.segments.keyword && r.segments.keyword.info) || {};
    var info = { cid: r.campaign.id, campaign: r.campaign.name, adGroup: r.adGroup.name,
                 term: r.searchTermView.searchTerm, match: r.segments.searchTermMatchType || '',
                 kw: kw.text || '', kwMatch: kw.matchType || '', status: r.searchTermView.status || '' };
    var key = [r.campaign.id, r.adGroup.id, info.term, info.match, info.kw, info.kwMatch].join('\u0001');
    daily.add(key, info, r.segments.date,
      [num(m.clicks), cost(m.costMicros), num(m.conversions), num(m.conversionsValue)]);
  }
  var cols = function (s) { return [s[0], r2(s[1]), r4(s[2]), r4(s[3])]; };
  return cappedRows(ctx, 'terms', daily, 1, capFor(ctx, SEARCH_TERMS_PER_ACCOUNT, SEARCH_TERMS_TOTAL),
    function (it) {
      var x = it.info;
      return [ctx.name, ctx.cid, ctx.currency, x.cid, x.campaign, x.adGroup, x.term, x.match, x.kw, x.kwMatch,
        x.status].concat(cols(it.sum), ['', ctx.range, ctx.now, dailyJson(ctx, it)]);
    },
    function (rest) {
      return [ctx.name, ctx.cid, ctx.currency, rest.info.cid, rest.info.campaign, '', more(rest.n, 'search term'),
        '', '', '', ''].concat(cols(rest.sum), [rest.n, ctx.range, ctx.now, dailyJson(ctx, rest)]);
    },
    function (it) { return { key: it.info.cid, info: { cid: it.info.cid, campaign: it.info.campaign } }; });
}


// ── Keywords and Quality Score, per day ──────────────────────────────────────
// Split by network so each impression share is divided into the impressions it describes.
function keywords(ctx) {
  var q = 'SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ' +
    'ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ' +
    'ad_group_criterion.system_serving_status, ad_group_criterion.quality_info.quality_score, ' +
    'ad_group_criterion.quality_info.search_predicted_ctr, ad_group_criterion.quality_info.creative_quality_score, ' +
    'ad_group_criterion.quality_info.post_click_quality_score, ad_group_criterion.effective_cpc_bid_micros, ' +
    'ad_group_criterion.position_estimates.first_page_cpc_micros, ' +
    'ad_group_criterion.position_estimates.top_of_page_cpc_micros, segments.date, segments.ad_network_type, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, ' +
    'metrics.search_impression_share, metrics.search_rank_lost_impression_share ' +
    'FROM keyword_view WHERE ' + ctx.during + ' AND metrics.impressions > 0';
  var rows = AdsApp.search(q), daily = new Daily(KEYWORDS_DAILY.length);
  while (rows.hasNext()) {
    var r = rows.next(), k = r.adGroupCriterion, m = r.metrics;
    var v = perfOf(m).concat([0, 0, 0, 0]), S = pos(m.searchImpressionShare);
    if (S) {
      v[5] = num(m.impressions); v[6] = v[5] / S; v[7] = nz(m.searchRankLostImpressionShare) * v[6];
      v[8] = isCapped(S) || isCapped(nz(m.searchRankLostImpressionShare), true) ? 1 : 0;
    }
    daily.add(r.adGroup.id + '~' + k.criterionId, { r: r }, r.segments.date, v);
  }
  var cols = function (s) {
    return perfCols(s).concat([ratio(s[5], s[6]), ratio(s[7], s[6])]);
  };
  return cappedRows(ctx, 'keywords', daily, 2, capFor(ctx, KEYWORDS_PER_ACCOUNT, KEYWORDS_TOTAL),
    function (it) {
      var r = it.info.r, k = r.adGroupCriterion, kw = k.keyword || {}, qi = k.qualityInfo || {},
          pe = k.positionEstimates || {};
      return [ctx.name, ctx.cid, ctx.currency, r.campaign.id, r.campaign.name, r.adGroup.name, k.criterionId,
        kw.text || '', kw.matchType || '', k.status || '', k.systemServingStatus || '',
        qi.qualityScore == null ? '' : Number(qi.qualityScore), qi.searchPredictedCtr || '',
        qi.creativeQualityScore || '', qi.postClickQualityScore || '',
        k.effectiveCpcBidMicros ? money(k.effectiveCpcBidMicros) : '',
        pe.firstPageCpcMicros ? money(pe.firstPageCpcMicros) : '', pe.topOfPageCpcMicros ? money(pe.topOfPageCpcMicros) : ''
      ].concat(cols(it.sum), ['', ctx.range, ctx.now, dailyJson(ctx, it)]);
    },
    function (rest) {
      return [ctx.name, ctx.cid, ctx.currency, rest.info.id, rest.info.name, '', '', more(rest.n, 'keyword'), '', '', '',
        '', '', '', '', '', '', ''].concat(cols(rest.sum), [rest.n, ctx.range, ctx.now, dailyJson(ctx, rest)]);
    },
    function (it) { var c = it.info.r.campaign; return { key: c.id, info: { id: c.id, name: c.name } }; });
}


// ── Devices, per campaign per day ────────────────────────────────────────────
function devices(ctx) {
  var q = 'SELECT campaign.id, campaign.name, campaign.advertising_channel_type, segments.device, segments.date, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value ' +
    'FROM campaign WHERE ' + ctx.during + ' AND metrics.impressions > 0';
  var rows = AdsApp.search(q), daily = new Daily(PERF.length);
  while (rows.hasNext()) {
    var r = rows.next();
    daily.add(r.campaign.id + '~' + (r.segments.device || ''), { c: r.campaign, device: r.segments.device || '' },
      r.segments.date, perfOf(r.metrics));
  }
  return daily.list().map(function (it) {
    var c = it.info.c;
    return [ctx.name, ctx.cid, ctx.currency, c.id, c.name, c.advertisingChannelType, it.info.device]
      .concat(perfCols(it.sum), [ctx.range, ctx.now, dailyJson(ctx, it)]);
  });
}


// ── Hour of day (account time zone), per day ─────────────────────────────────
// One row per hour; the dashboard takes the day of the week from each day's date.
function hours(ctx) {
  var q = 'SELECT segments.date, segments.hour, metrics.impressions, metrics.clicks, ' +
    'metrics.cost_micros, metrics.conversions, metrics.conversions_value ' +
    'FROM customer WHERE ' + ctx.during + ' AND metrics.impressions > 0';
  var rows = AdsApp.search(q), daily = new Daily(PERF.length);
  while (rows.hasNext()) {
    var r = rows.next(), h = num(r.segments.hour);
    daily.add(String(h), h, r.segments.date, perfOf(r.metrics));
  }
  return daily.list().sort(function (a, b) { return a.info - b.info; }).map(function (it) {
    return [ctx.name, ctx.cid, ctx.currency, ctx.tz, it.info].concat(perfCols(it.sum),
      [ctx.range, ctx.now, dailyJson(ctx, it)]);
  });
}


// ── Locations: region and city, per day ──────────────────────────────────────
function locations(ctx) {
  var base = 'geographic_view.location_type, geographic_view.country_criterion_id, segments.date, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value ' +
    'FROM geographic_view WHERE ' + ctx.during + ' AND metrics.impressions > 0';
  var rows, withCity = true;
  try {
    rows = AdsApp.search('SELECT segments.geo_target_region, segments.geo_target_city, ' + base);
  } catch (e) {
    ctx.errors.push('locations by city (fell back to regions): ' + String(e).slice(0, 200));
    rows = AdsApp.search('SELECT segments.geo_target_region, ' + base);
    withCity = false;
  }
  var daily = new Daily(PERF.length);
  while (rows.hasNext()) {
    var r = rows.next(), g = r.geographicView, s = r.segments || {};
    var x = { type: g.locationType || '', country: g.countryCriterionId ? 'geoTargetConstants/' + g.countryCriterionId : '',
              region: s.geoTargetRegion || '', city: withCity ? (s.geoTargetCity || '') : '' };
    daily.add([x.type, x.country, x.region, x.city].join('~'), x, s.date, perfOf(r.metrics));
  }
  // Names are looked up for the locations that are kept (a later cut only keeps fewer).
  var cap = capFor(ctx, LOCATIONS_PER_ACCOUNT, LOCATIONS_TOTAL), names = {};
  daily.top(2, cap).kept.forEach(function (k) {
    [k.info.country, k.info.region, k.info.city].forEach(function (n) { if (n) names[n] = ''; });
  });
  lookupGeoNames(ctx, names);
  return cappedRows(ctx, 'locations', daily, 2, cap,
    function (it) {
      var x = it.info;
      return [ctx.name, ctx.cid, ctx.currency, x.type, geoName(names, x.country), geoName(names, x.region),
        geoName(names, x.city)].concat(perfCols(it.sum), ['', ctx.range, ctx.now, dailyJson(ctx, it)]);
    },
    function (rest) {
      return [ctx.name, ctx.cid, ctx.currency, '', '', more(rest.n, 'location'), '']
        .concat(perfCols(rest.sum), [rest.n, ctx.range, ctx.now, dailyJson(ctx, rest)]);
    });
}

/** A location's name, or "Location <id>" when its name could not be looked up. */
function geoName(names, resource) {
  if (!resource) return '';
  return names[resource] || 'Location ' + resource.split('/').pop();
}

/** Fills {resourceName: ''} with each location's English name. */
function lookupGeoNames(ctx, names) {
  var keys = Object.keys(names);
  for (var i = 0; i < keys.length; i += GEO_BATCH) {
    var batch = keys.slice(i, i + GEO_BATCH);
    guarded(ctx, 'location names', function () {
      var q = 'SELECT geo_target_constant.resource_name, geo_target_constant.name ' +
        'FROM geo_target_constant WHERE geo_target_constant.resource_name IN (' +
        batch.map(function (n) { return "'" + n + "'"; }).join(', ') + ')';
      var rows = AdsApp.search(q);
      while (rows.hasNext()) {
        var g = rows.next().geoTargetConstant;
        names[g.resourceName] = g.name;
      }
    });
  }
}


// ── Conversions by action, per day ───────────────────────────────────────────
function conversions(ctx) {
  var q = 'SELECT campaign.id, campaign.name, segments.conversion_action_name, ' +
    'segments.conversion_action_category, segments.date, metrics.conversions, metrics.conversions_value, ' +
    'metrics.all_conversions, metrics.all_conversions_value ' +
    'FROM campaign WHERE ' + ctx.during + ' AND metrics.all_conversions > 0';
  var rows = AdsApp.search(q), daily = new Daily(CONVERSIONS_DAILY.length);
  while (rows.hasNext()) {
    var r = rows.next(), m = r.metrics, s = r.segments;
    var x = { c: r.campaign, action: s.conversionActionName || '', category: s.conversionActionCategory || '' };
    daily.add([r.campaign.id, x.action, x.category].join('\u0001'), x, s.date,
      [num(m.conversions), num(m.conversionsValue), num(m.allConversions), num(m.allConversionsValue)]);
  }
  return daily.list().map(function (it) {
    var x = it.info;
    return [ctx.name, ctx.cid, x.c.id, x.c.name, x.action, x.category].concat(it.sum.map(r4),
      [ctx.range, ctx.now, dailyJson(ctx, it)]);
  });
}


// ── How each conversion action is set up ─────────────────────────────────────
function conversionActions(ctx) {
  var q = 'SELECT conversion_action.id, conversion_action.name, conversion_action.category, ' +
    'conversion_action.status, conversion_action.type, conversion_action.origin, ' +
    'conversion_action.primary_for_goal, conversion_action.include_in_conversions_metric, ' +
    'conversion_action.counting_type, conversion_action.click_through_lookback_window_days, ' +
    'conversion_action.view_through_lookback_window_days, conversion_action.value_settings.default_value, ' +
    'conversion_action.value_settings.always_use_default_value, ' +
    'conversion_action.attribution_model_settings.attribution_model ' +
    "FROM conversion_action WHERE conversion_action.status != 'REMOVED'";
  var rows = AdsApp.search(q), out = [];
  while (rows.hasNext()) {
    var a = rows.next().conversionAction, v = a.valueSettings || {}, am = a.attributionModelSettings || {};
    out.push([ctx.name, ctx.cid, a.id, a.name, a.category || '', a.status || '', a.type || '', a.origin || '',
      a.primaryForGoal === true, a.includeInConversionsMetric === true, a.countingType || '',
      num(a.clickThroughLookbackWindowDays), num(a.viewThroughLookbackWindowDays),
      v.defaultValue == null ? '' : Number(v.defaultValue), v.alwaysUseDefaultValue === true,
      am.attributionModel || '', ctx.now]);
  }
  return out;
}


// ── Ads and asset groups ─────────────────────────────────────────────────────
var LIVE = "campaign.status = 'ENABLED' AND ad_group.status = 'ENABLED' AND ad_group_ad.status = 'ENABLED'";

function textAssets(list) {
  return (list || []).map(function (a) { return { t: a.text || '', pin: a.pinnedField || '' }; });
}

function ads(ctx) {
  var out = [], byKey = {}, daily = new Daily(PERF.length);
  var rows = AdsApp.search('SELECT campaign.id, campaign.name, campaign.advertising_channel_type, ad_group.id, ' +
    'ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status, ad_group_ad.primary_status, ' +
    'ad_group_ad.ad_strength, ad_group_ad.policy_summary.approval_status, ' +
    'ad_group_ad.policy_summary.review_status, ad_group_ad.policy_summary.policy_topic_entries, ' +
    'ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ' +
    'ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.responsive_search_ad.path1, ' +
    'ad_group_ad.ad.responsive_search_ad.path2 FROM ad_group_ad WHERE ' + LIVE + ' LIMIT ' + ADS_PER_ACCOUNT);
  while (rows.hasNext()) {
    var r = rows.next(), aga = r.adGroupAd, ad = aga.ad || {}, rsa = ad.responsiveSearchAd || {}, pol = aga.policySummary || {};
    var heads = textAssets(rsa.headlines), descs = textAssets(rsa.descriptions);
    var pinned = heads.concat(descs).filter(function (x) { return x.pin; }).length;
    var topics = (pol.policyTopicEntries || []).map(function (e) { return e.topic + (e.type ? ' (' + e.type + ')' : ''); });
    var row = [ctx.name, ctx.cid, ctx.currency, r.campaign.id, r.campaign.name, r.campaign.advertisingChannelType,
      r.adGroup.id, r.adGroup.name, ad.id, ad.type === 'RESPONSIVE_SEARCH_AD' ? 'RSA' : 'AD', ad.type || '',
      aga.status || '', aga.primaryStatus || '', pol.approvalStatus || '', pol.reviewStatus || '', topics.join('; '),
      aga.adStrength || '', (ad.finalUrls || [])[0] || '', rsa.path1 || '', rsa.path2 || '',
      JSON.stringify(heads), JSON.stringify(descs), heads.length, descs.length, pinned];
    byKey['ad:' + r.adGroup.id + '~' + ad.id] = row;
    out.push(row);
  }
  guarded(ctx, 'ad metrics', function () {
    var m = AdsApp.search('SELECT ad_group.id, ad_group_ad.ad.id, segments.date, metrics.impressions, metrics.clicks, ' +
      'metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM ad_group_ad WHERE ' + LIVE +
      ' AND ' + ctx.during + ' AND metrics.impressions > 0');
    while (m.hasNext()) {
      var r = m.next(), key = 'ad:' + r.adGroup.id + '~' + r.adGroupAd.ad.id;
      if (byKey[key]) daily.add(key, null, r.segments.date, perfOf(r.metrics));
    }
  });
  guarded(ctx, 'asset groups', function () {
    var g = AdsApp.search('SELECT campaign.id, campaign.name, campaign.advertising_channel_type, ' +
      'asset_group.id, asset_group.name, asset_group.status, asset_group.primary_status, asset_group.ad_strength, ' +
      "asset_group.final_urls FROM asset_group WHERE campaign.status = 'ENABLED' AND asset_group.status = 'ENABLED'");
    while (g.hasNext()) {
      var r = g.next(), a = r.assetGroup;
      var row = [ctx.name, ctx.cid, ctx.currency, r.campaign.id, r.campaign.name, r.campaign.advertisingChannelType,
        a.id, a.name, a.id, 'ASSET_GROUP', 'PERFORMANCE_MAX_ASSET_GROUP', a.status || '', a.primaryStatus || '', '', '', '',
        a.adStrength || '', (a.finalUrls || [])[0] || '', '', '', '[]', '[]', 0, 0, 0];
      byKey['group:' + a.id] = row;
      out.push(row);
    }
    var m = AdsApp.search('SELECT asset_group.id, segments.date, metrics.impressions, metrics.clicks, ' +
      "metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM asset_group WHERE campaign.status = 'ENABLED' " +
      "AND asset_group.status = 'ENABLED' AND " + ctx.during + ' AND metrics.impressions > 0');
    while (m.hasNext()) {
      var r = m.next(), key = 'group:' + r.assetGroup.id;
      if (byKey[key]) daily.add(key, null, r.segments.date, perfOf(r.metrics));
    }
  });
  Object.keys(byKey).forEach(function (key) {
    var it = daily.items[key] || { days: {}, sum: zeros(PERF.length) };
    byKey[key].push.apply(byKey[key], perfCols(it.sum).concat([ctx.range, ctx.now, dailyJson(ctx, it)]));
  });
  return out;
}


// ── The combinations Google served ───────────────────────────────────────────
function combinations(ctx) {
  var combos = [];
  guarded(ctx, 'RSA combinations', function () {
    var byAd = {}, rows = AdsApp.search('SELECT campaign.name, ad_group.id, ad_group.name, ad_group_ad.ad.id, ' +
      'ad_group_ad_asset_combination_view.served_assets, metrics.impressions ' +
      'FROM ad_group_ad_asset_combination_view WHERE segments.date DURING LAST_30_DAYS AND metrics.impressions > 0 ' +
      'AND ' + LIVE);
    while (rows.hasNext()) {
      var r = rows.next(), k = r.adGroup.id + '~' + r.adGroupAd.ad.id;
      (byAd[k] = byAd[k] || []).push({ kind: 'RSA', campaign: r.campaign.name, adGroup: r.adGroup.name,
        adGroupId: r.adGroup.id, adId: r.adGroupAd.ad.id, category: '', impressions: num(r.metrics.impressions),
        usages: r.adGroupAdAssetCombinationView.servedAssets || [] });
    }
    Object.keys(byAd).forEach(function (k) {
      byAd[k].sort(function (a, b) { return b.impressions - a.impressions; }).slice(0, COMBOS_PER_AD)
        .forEach(function (c, i) { c.rank = i + 1; combos.push(c); });
    });
  });
  guarded(ctx, 'Performance Max top combinations', function () {
    var rows = AdsApp.search('SELECT campaign.name, asset_group.id, asset_group.name, ' +
      'asset_group_top_combination_view.resource_name, asset_group_top_combination_view.asset_group_top_combinations ' +
      'FROM asset_group_top_combination_view WHERE segments.date DURING LAST_30_DAYS ' +
      "AND campaign.status = 'ENABLED' AND asset_group.status = 'ENABLED'");
    while (rows.hasNext()) {
      var r = rows.next(), tv = r.assetGroupTopCombinationView || {};
      var category = String(tv.resourceName || '').split('~').pop();
      (tv.assetGroupTopCombinations || []).slice(0, PMAX_COMBOS).forEach(function (c, i) {
        combos.push({ kind: 'PMAX', campaign: r.campaign.name, adGroup: r.assetGroup.name, adGroupId: r.assetGroup.id,
          adId: r.assetGroup.id, category: category, rank: i + 1, impressions: '',
          usages: c.assetCombinationServedAssets || [] });
      });
    }
  });
  combos = combos.slice(0, COMBO_ROWS_PER_ACCOUNT);
  var needed = {};
  combos.forEach(function (c) { c.usages.forEach(function (u) { if (u.asset) needed[u.asset] = 1; }); });
  var assets = lookupAssets(ctx, Object.keys(needed));
  return combos.map(function (c) {
    var parts = c.usages.map(function (u) {
      var a = assets[u.asset] || {}, p = { f: u.servedAssetFieldType || '' };
      if (a.text) p.x = a.text;
      if (a.url) p.img = a.url;
      if (a.video) p.vid = a.video;
      return p;
    });
    var pick = function (re) {
      return parts.filter(function (p) { return re.test(p.f) && p.x; }).map(function (p) { return p.x; }).join(' | ');
    };
    return [ctx.name, ctx.cid, c.kind, c.campaign, c.adGroup, c.adGroupId, c.adId, c.category, c.rank, c.impressions,
      pick(/^HEADLINE/), pick(/^DESCRIPTION/), JSON.stringify(parts), 'LAST_30_DAYS', ctx.now];
  });
}

/** {resourceName: {text, url, video}} for the given assets, in batches. */
function lookupAssets(ctx, names) {
  var map = {};
  for (var i = 0; i < names.length; i += ASSET_BATCH) {
    var batch = names.slice(i, i + ASSET_BATCH);
    guarded(ctx, 'asset lookup', function () {
      var rows = AdsApp.search('SELECT asset.resource_name, asset.type, asset.text_asset.text, ' +
        'asset.image_asset.full_size.url, asset.youtube_video_asset.youtube_video_id, ' +
        'asset.call_to_action_asset.call_to_action FROM asset WHERE asset.resource_name IN (' +
        batch.map(function (n) { return "'" + n + "'"; }).join(', ') + ')');
      while (rows.hasNext()) {
        var a = rows.next().asset;
        map[a.resourceName] = {
          text: (a.textAsset && a.textAsset.text) || (a.callToActionAsset && a.callToActionAsset.callToAction) || '',
          url: (a.imageAsset && a.imageAsset.fullSize && a.imageAsset.fullSize.url) || '',
          video: (a.youtubeVideoAsset && a.youtubeVideoAsset.youtubeVideoId) || ''
        };
      }
    });
  }
  return map;
}


// ── Each headline and description, per day ───────────────────────────────────
function adAssets(ctx) {
  var q = 'SELECT campaign.name, ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad_asset_view.resource_name, ' +
    'ad_group_ad_asset_view.field_type, ad_group_ad_asset_view.pinned_field, ad_group_ad_asset_view.performance_label, ' +
    'ad_group_ad_asset_view.enabled, asset.text_asset.text, segments.date, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
    "FROM ad_group_ad_asset_view WHERE ad_group_ad_asset_view.field_type IN ('HEADLINE', 'DESCRIPTION') " +
    'AND ' + ctx.during + ' AND metrics.impressions > 0 AND ' + LIVE;
  var rows = AdsApp.search(q), daily = new Daily(AD_ASSETS_DAILY.length);
  while (rows.hasNext()) {
    var r = rows.next(), v = r.adGroupAdAssetView, m = r.metrics;
    daily.add(v.resourceName || [r.adGroup.id, r.adGroupAd.ad.id, v.fieldType, r.asset && r.asset.textAsset &&
      r.asset.textAsset.text].join('~'), r, r.segments.date,
      [num(m.impressions), num(m.clicks), cost(m.costMicros), num(m.conversions)]);
  }
  // Kept by impressions; a headline left out has no row (nothing here adds them up).
  return daily.top(0, AD_ASSETS_PER_ACCOUNT).kept.map(function (it) {
    var r = it.info, v = r.adGroupAdAssetView, s = it.sum;
    return [ctx.name, ctx.cid, ctx.currency, r.campaign.name, r.adGroup.name, r.adGroup.id, r.adGroupAd.ad.id,
      v.fieldType || '', (r.asset && r.asset.textAsset && r.asset.textAsset.text) || '', v.pinnedField || '',
      v.performanceLabel || '', v.enabled !== false, s[0], s[1], r2(s[2]), r4(s[3]), ctx.range, ctx.now,
      dailyJson(ctx, it)];
  });
}


// ── Change history, last CHANGE_DAYS days ────────────────────────────────────
function changes(ctx) {
  var now = new Date();
  var from = Utilities.formatDate(new Date(now.getTime() - CHANGE_DAYS * 86400000), ctx.tz, 'yyyy-MM-dd');
  var to = Utilities.formatDate(new Date(now.getTime() + 86400000), ctx.tz, 'yyyy-MM-dd');   // tomorrow, as Google's own example does
  var q = 'SELECT change_event.change_date_time, change_event.change_resource_type, ' +
    'change_event.change_resource_name, change_event.resource_change_operation, change_event.changed_fields, ' +
    'change_event.old_resource, change_event.new_resource, change_event.user_email, change_event.client_type, ' +
    'campaign.id, campaign.name, ad_group.name FROM change_event ' +
    "WHERE change_event.change_date_time <= '" + to + "' AND change_event.change_date_time >= '" + from + "' " +
    'ORDER BY change_event.change_date_time DESC LIMIT ' + CHANGES_PER_ACCOUNT;
  var rows = AdsApp.search(q), out = [];
  while (rows.hasNext()) {
    var r = rows.next(), e = r.changeEvent || {}, type = e.changeResourceType || '';
    var oldRes = changedResource(e.oldResource, type), newRes = changedResource(e.newResource, type);
    var paths = changedPaths(e.changedFields);
    out.push([ctx.name, ctx.cid, ctx.currency, String(e.changeDateTime || '').slice(0, 19), type,
      e.resourceChangeOperation || '', (r.campaign && r.campaign.id) || '', (r.campaign && r.campaign.name) || '',
      (r.adGroup && r.adGroup.name) || '', itemName(newRes, oldRes, e.changeResourceName),
      e.userEmail || '', e.clientType || '', paths.join(', '),
      changeValues(oldRes, paths), changeValues(newRes, paths), ctx.now]);
  }
  return out;
}

/** The one resource set inside a ChangedResource (campaign, campaignBudget, adGroupAd, ...). */
function changedResource(changed, type) {
  if (!changed) return {};
  var key = camel(String(type).toLowerCase());
  if (changed[key]) return changed[key];
  var keys = Object.keys(changed);
  return keys.length ? changed[keys[0]] || {} : {};
}

/** changed_fields is a FieldMask: "a,b.c" in JSON, or {paths: [...]}. */
function changedPaths(mask) {
  if (!mask) return [];
  var list = typeof mask === 'string' ? mask.split(',') : (mask.paths || []);
  return list.map(function (p) { return String(p).trim(); }).filter(String);
}

function camel(s) { return s.replace(/_([a-z])/g, function (m, c) { return c.toUpperCase(); }); }

function fieldAt(obj, path) {
  var parts = path.split('.'), v = obj;
  for (var i = 0; i < parts.length && v != null; i++) v = v[camel(parts[i])];
  return v;
}

/** {field: value} for the changed fields, as JSON: micros become money, long values are cut. */
function changeValues(res, paths) {
  var out = {}, n = 0;
  paths.forEach(function (p) {
    if (n >= 12) return;
    var v = fieldAt(res, p);
    if (v == null) return;
    if (/micros$/i.test(p)) v = money(v);
    else if (typeof v === 'object') v = JSON.stringify(v).slice(0, 200);
    else if (typeof v === 'string') v = v.slice(0, 200);
    out[p] = v;
    n++;
  });
  return n ? JSON.stringify(out) : '';
}

function itemName(newRes, oldRes, resourceName) {
  var r = newRes && Object.keys(newRes).length ? newRes : oldRes || {};
  var name = r.name || (r.keyword && r.keyword.text) || (r.ad && r.ad.name) || (r.textAsset && r.textAsset.text) || '';
  return String(name || String(resourceName || '').split('/').pop()).slice(0, 200);
}


// ── Optimization score ───────────────────────────────────────────────────────
function optimization(ctx) {
  var out = [], camps = {}, order = [];
  var rows = AdsApp.search('SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ' +
    "campaign.optimization_score FROM campaign WHERE campaign.status != 'REMOVED'");
  while (rows.hasNext()) {
    var c = rows.next().campaign;
    camps[c.id] = { c: c, cost: 0, conv: 0 };
    order.push(c.id);
  }
  guarded(ctx, 'campaign spend', function () {
    var m = AdsApp.search('SELECT campaign.id, metrics.cost_micros, metrics.conversions FROM campaign ' +
      "WHERE campaign.status != 'REMOVED' AND segments.date DURING LAST_30_DAYS");
    while (m.hasNext()) {
      var r = m.next(), x = camps[r.campaign.id];
      if (x) { x.cost = money(r.metrics.costMicros); x.conv = num(r.metrics.conversions); }
    }
  });
  var total = 0, conv = 0;
  order.forEach(function (id) { total += camps[id].cost; conv += camps[id].conv; });
  var acct = {};
  guarded(ctx, 'account optimization score', function () {
    var a = AdsApp.search('SELECT customer.optimization_score, customer.optimization_score_weight FROM customer');
    if (a.hasNext()) acct = a.next().customer || {};
  });
  out.push([ctx.name, ctx.cid, ctx.currency, 'ACCOUNT', '', '', '', '',
    share(acct.optimizationScore), share(acct.optimizationScoreWeight), Math.round(total * 100) / 100,
    Math.round(conv * 100) / 100, 'LAST_30_DAYS', ctx.now]);
  order.forEach(function (id) {
    var x = camps[id], c = x.c;
    if (c.optimizationScore == null && !x.cost) return;   // nothing to show
    out.push([ctx.name, ctx.cid, ctx.currency, 'CAMPAIGN', c.id, c.name, c.advertisingChannelType || '',
      c.status || '', share(c.optimizationScore), '', x.cost, x.conv, 'LAST_30_DAYS', ctx.now]);
  });
  ctx.campaignNames = {};
  order.forEach(function (id) { ctx.campaignNames[id] = camps[id].c.name; });
  return out;
}


// ── Google's open recommendations ────────────────────────────────────────────
function recommendations(ctx) {
  var names = ctx.campaignNames || {};
  var rows = AdsApp.search('SELECT recommendation.type, recommendation.campaign, recommendation.impact, ' +
    'recommendation.campaign_budget_recommendation, recommendation.keyword_recommendation ' +
    'FROM recommendation WHERE recommendation.dismissed = FALSE LIMIT ' + RECS_PER_ACCOUNT);
  var out = [];
  while (rows.hasNext()) {
    var rec = rows.next().recommendation || {}, imp = rec.impact || {};
    var base = imp.baseMetrics || {}, pot = imp.potentialMetrics || {};
    var cid = rec.campaign ? String(rec.campaign).split('/').pop() : '';
    var bud = rec.campaignBudgetRecommendation || {}, kw = rec.keywordRecommendation || {};
    var detail = '';
    if (kw.keyword && kw.keyword.text) detail = kw.keyword.text + (kw.keyword.matchType ? ' (' + kw.keyword.matchType + ')' : '');
    out.push([ctx.name, ctx.cid, ctx.currency, rec.type || '', cid, names[cid] || '', detail,
      bud.currentBudgetAmountMicros ? money(bud.currentBudgetAmountMicros) : '',
      bud.recommendedBudgetAmountMicros ? money(bud.recommendedBudgetAmountMicros) : '',
      num(base.impressions), num(base.clicks), money(base.costMicros), num(base.conversions), num(base.conversionsValue),
      num(pot.impressions), num(pot.clicks), money(pot.costMicros), num(pot.conversions), num(pot.conversionsValue),
      'WEEKLY', ctx.now]);
  }
  return out;
}


// ── Age range and gender, per campaign per day (summed over each campaign's ad groups) ──
function demographics(ctx) {
  var daily = new Daily(PERF.length);
  [['Age', 'age_range_view', 'ad_group_criterion.age_range.type', function (k) { return k.ageRange && k.ageRange.type; }],
   ['Gender', 'gender_view', 'ad_group_criterion.gender.type', function (k) { return k.gender && k.gender.type; }]
  ].forEach(function (d) {
    guarded(ctx, d[1], function () {
      var rows = AdsApp.search('SELECT campaign.id, campaign.name, campaign.advertising_channel_type, ' + d[2] + ', ' +
        'segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, ' +
        'metrics.conversions_value FROM ' + d[1] + ' WHERE ' + ctx.during + ' AND metrics.impressions > 0');
      while (rows.hasNext()) {
        var r = rows.next(), seg = d[3](r.adGroupCriterion || {}) || 'UNKNOWN';
        daily.add(r.campaign.id + '~' + d[0] + '~' + seg, { c: r.campaign, dim: d[0], seg: seg }, r.segments.date,
          perfOf(r.metrics));
      }
    });
  });
  return daily.list().map(function (it) {
    var x = it.info;
    return [ctx.name, ctx.cid, ctx.currency, x.c.id, x.c.name, x.c.advertisingChannelType || '', x.dim, x.seg]
      .concat(perfCols(it.sum), [ctx.range, ctx.now, dailyJson(ctx, it)]);
  });
}


// ── Landing pages, per day ───────────────────────────────────────────────────
// Performance per day; Google's speed score and mobile-friendly and AMP click shares are
// quality readings, read once for the last 30 days ("Quality range").
function landingPages(ctx) {
  var rows = AdsApp.search('SELECT landing_page_view.unexpanded_final_url, segments.date, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value ' +
    'FROM landing_page_view WHERE ' + ctx.during + ' AND metrics.impressions > 0');
  var daily = new Daily(PERF.length);
  while (rows.hasNext()) {
    var r = rows.next(), url = (r.landingPageView && r.landingPageView.unexpandedFinalUrl) || '';
    daily.add(url, url, r.segments.date, perfOf(r.metrics));
  }
  var quality = {};
  guarded(ctx, 'landing page speed', function () {
    var q = AdsApp.search('SELECT landing_page_view.unexpanded_final_url, metrics.speed_score, ' +
      'metrics.mobile_friendly_clicks_percentage, metrics.valid_accelerated_mobile_pages_clicks_percentage ' +
      'FROM landing_page_view WHERE segments.date DURING LAST_30_DAYS AND metrics.impressions > 0');
    while (q.hasNext()) {
      var r = q.next(), m = r.metrics;
      quality[(r.landingPageView && r.landingPageView.unexpandedFinalUrl) || ''] = [
        m.speedScore == null || m.speedScore === '' ? '' : Number(m.speedScore),
        share(m.mobileFriendlyClicksPercentage), share(m.validAcceleratedMobilePagesClicksPercentage)];
    }
  });
  return cappedRows(ctx, 'landing', daily, 2, capFor(ctx, LANDING_PER_ACCOUNT, LANDING_TOTAL),
    function (it) {
      var qy = quality[it.info] || ['', '', ''];
      return [ctx.name, ctx.cid, ctx.currency, it.info, qy[0], qy[1], qy[2], 'LAST_30_DAYS']
        .concat(perfCols(it.sum), ['', ctx.range, ctx.now, dailyJson(ctx, it)]);
    },
    function (rest) {
      return [ctx.name, ctx.cid, ctx.currency, more(rest.n, 'landing page'), '', '', '', '']
        .concat(perfCols(rest.sum), [rest.n, ctx.range, ctx.now, dailyJson(ctx, rest)]);
    });
}


// ── Writing the sheet ────────────────────────────────────────────────────────
function writeAll(results) {
  var parts = SECTIONS.filter(inPart), all = {}, notes = [], accounts = 0, from = '', to = '', rolled = {};
  parts.forEach(function (x) { all[x.key] = []; });
  results.forEach(function (res) {
    var id = res.getCustomerId ? res.getCustomerId() : '';
    if (res.getStatus() !== 'OK') {
      notes.push(['Account failed', id + ': ' + (res.getError ? res.getError() : res.getStatus())]);
      return;
    }
    var d = JSON.parse(res.getReturnValue());
    accounts++;
    if (d.from && (!from || d.from < from)) from = d.from;
    if (d.to && d.to > to) to = d.to;
    parts.forEach(function (x) { all[x.key] = all[x.key].concat(d[x.key] || []); });
    Object.keys(d.rolled || {}).forEach(function (k) { rolled[k] = (rolled[k] || 0) + d.rolled[k]; });
    (d.errors || []).forEach(function (e) { notes.push(['Query failed', d.account + ': ' + e]); });
  });
  parts.forEach(function (x) {
    var col = x.header.indexOf(x.sortBy || 'Cost');
    if (col < 0) return;
    all[x.key].sort(function (a, b) { return a[col] < b[col] ? 1 : a[col] > b[col] ? -1 : 0; });
    if (x.cap && all[x.key].length > x.cap) {
      notes.push([x.label + ' trimmed', 'Kept the ' + x.cap + ' newest of ' + all[x.key].length]);
      all[x.key] = all[x.key].slice(0, x.cap);
    }
  });
  Object.keys(rolled).forEach(function (k) {
    notes.push(['Rolled up (' + k + ')', rolled[k] + ' smaller items folded into "(N more ...)" rows (one per campaign for ' +
      'search terms and keywords, per account otherwise); totals still cover everything']);
  });
  var ss = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
  var written = parts.map(function (x) {
    return x.key + ' ' + writeTab(ss, TABS[x.key], x.header, all[x.key]);
  });
  // The weekly impression-share tab of earlier versions is now worked out from the daily figures.
  var old = PART === 2 ? null : ss.getSheetByName('Insights - IS weekly');
  if (old && all.is.length) { ss.deleteSheet(old); notes.push(['Removed', 'Insights - IS weekly (no longer needed)']); }
  var tz = timeZoneOf(ss);
  var about = [
    ['Exported at', Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm') + ' (' + tz + ')'],
    ['Part', PART ? String(PART) + ' of 2' : 'everything'],
    ['Accounts', String(accounts)],
    ['Daily detail', (from && to ? from + ' to ' + to : 'none') + ' (' + DAYS + ' days, each account\'s time zone)'],
    ['Search terms', 'days with clicks; top ' + SEARCH_TERMS_PER_ACCOUNT + ' per account by spend, the rest rolled up'],
    ['Keywords', 'top ' + KEYWORDS_PER_ACCOUNT + ' per account by spend, the rest rolled up; Quality Score is current'],
    ['Locations, landing pages', 'top ' + LOCATIONS_PER_ACCOUNT + ' and ' + LANDING_PER_ACCOUNT +
      ' per account by spend, the rest rolled up; speed and mobile-friendly clicks: last 30 days'],
    ['Ads', 'live ads and asset groups now, with daily performance; served combinations: last 30 days, top ' +
      COMBOS_PER_AD + ' per ad'],
    ['Budgets', 'this month so far, and yesterday and today'],
    ['Changes range', 'last ' + CHANGE_DAYS + ' days, newest ' + CHANGES_PER_ACCOUNT + ' per account'],
    ['Optimization score, recommendations', 'current; recommendation impact is Google\'s weekly estimate'],
    ['Rows written', written.join(', ')]
  ].concat(notes);
  writeTab(ss, PART === 2 ? TABS.about2 : TABS.about, ABOUT_HEADER, about, true);
  Logger.log(about.map(function (r) { return r.join(': '); }).join('\n'));
}

/**
 * A time zone ID for the About tab: the sheet's, else the manager account's, else UTC. In a manager
 * script the sheet's zone has come back as something other than a string, which Utilities.formatDate
 * rejects ("Invalid argument: timeZone"), so each candidate is tried before it is used.
 */
function timeZoneOf(ss) {
  var tries = [function () { return ss.getSpreadsheetTimeZone(); },
               function () { return AdsApp.currentAccount().getTimeZone(); }];
  for (var i = 0; i < tries.length; i++) {
    try {
      var tz = tries[i]();
      tz = tz == null ? '' : String(tz);
      if (tz && tz !== '[object Object]') {
        Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');   // throws if Google does not accept it
        return tz;
      }
    } catch (e) {
      Logger.log('Time zone candidate ' + (i + 1) + ' not usable: ' + e);
    }
  }
  return 'Etc/UTC';
}

/** Replaces a tab's contents; an empty result leaves the tab as it was. Returns rows written. */
function writeTab(ss, name, header, rows, always) {
  if (!rows.length && !always) {
    Logger.log('No rows for "' + name + '": left it untouched.');
    return 0;
  }
  var sh = ss.getSheetByName(name) || ss.insertSheet(name, ss.getNumSheets());
  sh.clearContents();
  var data = [header].concat(rows);
  sh.getRange(1, 1, data.length, header.length).setValues(data);
  sh.setFrozenRows(1);
  return rows.length;
}


// ── Helpers ──────────────────────────────────────────────────────────────────
function num(v) { return v == null || v === '' ? 0 : Number(v); }
function money(micros) { return micros == null || micros === '' ? 0 : Math.round(Number(micros) / 10000) / 100; }
function cost(micros) { return micros == null || micros === '' ? 0 : Number(micros) / 1e6; }
function r2(x) { return Math.round(x * 100) / 100; }
function share(v) { return v == null || v === '' ? '' : Number(v); }

function guarded(ctx, label, fn) {
  try {
    return fn();
  } catch (e) {
    ctx.errors.push(label + ': ' + String(e).slice(0, 300));
    Logger.log('[' + ctx.name + '] ' + label + ' failed (continuing): ' + e);
    return null;
  }
}
