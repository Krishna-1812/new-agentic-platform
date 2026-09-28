/**
 * Google Ads dashboard: insights export (impression share, budget pacing, search terms,
 * keywords and Quality Score, devices, hours, locations, conversion actions, ads and creatives,
 * change history, optimization score, Google's recommendations, age and gender, landing pages).
 *
 * Install once in the MANAGER (MCC) account: Tools > Bulk actions > Scripts > +.
 * Paste this file, set SPREADSHEET_URL below to the Google Ads sheet the dashboard
 * already reads (Railway variable GOOGLE_ADS_SHEET_ID), authorise, Preview once,
 * then schedule it Daily (early morning, after Google has finished yesterday's data).
 * The person who authorises it needs EDIT access to that sheet.
 *
 * It writes its tabs at the END of the sheet and never touches the first tab (the
 * existing campaign report the dashboard already reads):
 *
 *   Insights - Impression share   one row per enabled campaign, last 30 days
 *   Insights - IS weekly          impression share per campaign per week, last 13 weeks
 *   Insights - Budgets            budget, bidding and spend so far this month, per campaign
 *   Insights - Search terms       the search terms that spent, with the keyword that matched
 *   Insights - Keywords           keywords with Quality Score, its three parts and bid estimates
 *   Insights - Devices            campaign performance by device, last 30 days
 *   Insights - Hours              account performance by day of week and hour, last 30 days
 *   Insights - Locations          performance by region and city, last 30 days
 *   Insights - Conversions        conversions per campaign per conversion action, last 30 days
 *   Insights - Conversion actions every conversion action and how it is set up
 *   Insights - Ads               every live ad and PMax asset group: ad strength, approval, headlines
 *   Insights - Ad combinations   the headline and description combinations Google actually served
 *   Insights - Ad assets         each headline and description: pinning, Google's label, performance
 *   Insights - Changes           every change made to the account in the last 28 days: what, who, old and new
 *   Insights - Optimization      Google's optimization score for each account and campaign
 *   Insights - Recommendations   Google's open recommendations with their estimated weekly impact
 *   Insights - Demographics      campaign performance by age range and gender, last 30 days
 *   Insights - Landing pages     each final URL: mobile speed score, mobile-friendly clicks, performance
 *   Insights - About              when it ran, the date ranges, and anything that failed
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
 * Change history: "The date range must be within the past 30 days" and "The query must also
 * include a LIMIT clause restricting results to at most 10,000 rows"
 * (https://developers.google.com/google-ads/api/docs/change-event).
 * Impression-share values are fractions, written exactly as Google returns them:
 * "reported in the range of 0.1 to 1. Any value below 0.1 is reported as 0.0999", and the
 * lost shares "in the range of 0 to 0.9. Any value above 0.9 is reported as 0.9001".
 *
 * Limits (https://developers.google.com/google-ads/scripts/docs/limits): executeInParallel
 * takes at most 50 accounts and each may return up to 10 MB, so the busiest 50 accounts of
 * the last 30 days are exported and search terms are capped per account and overall.
 * A tab is never cleared when its new result is empty: a failed run keeps the last good data.
 */

var SPREADSHEET_URL = 'PASTE_THE_GOOGLE_ADS_SHEET_URL_HERE';
var ACCOUNT_IDS = [];                 // optional: limit to e.g. ['123-456-7890']; empty = all (busiest 50 if more)
var MAX_ACCOUNTS = 50;                // executeInParallel's own ceiling
var SEARCH_TERMS_PER_ACCOUNT = 3000;  // by spend, per account
var SEARCH_TERMS_TOTAL = 30000;       // by spend, across accounts (keeps the sheet quick to read)
var WEEKS = 13;
var KEYWORDS_PER_ACCOUNT = 4000;      // by spend, per account
var KEYWORDS_TOTAL = 40000;
var LOCATIONS_PER_ACCOUNT = 3000;     // region x city rows, by spend
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
var LANDING_PER_ACCOUNT = 500;        // final URLs, by spend
var LANDING_TOTAL = 10000;

var TABS = {
  is: 'Insights - Impression share',
  weekly: 'Insights - IS weekly',
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
  about: 'Insights - About'
};

var IS_HEADER = ['Account', 'Customer ID', 'Currency', 'Campaign ID', 'Campaign', 'Channel', 'Sub-channel',
  'Status', 'Bidding strategy', 'Impressions', 'Clicks', 'Cost', 'Conversions', 'Conv. value',
  'Search IS', 'Search top IS', 'Search abs. top IS',
  'Search lost IS (budget)', 'Search lost IS (rank)',
  'Search lost top IS (budget)', 'Search lost top IS (rank)',
  'Search lost abs. top IS (budget)', 'Search lost abs. top IS (rank)',
  'Search click share', 'Search exact match IS',
  'Display IS', 'Display lost IS (budget)', 'Display lost IS (rank)',
  'Date range', 'Exported at'];

var WEEKLY_HEADER = ['Account', 'Customer ID', 'Campaign ID', 'Campaign', 'Channel', 'Week',
  'Impressions', 'Clicks', 'Cost', 'Conversions',
  'Search IS', 'Search top IS', 'Search abs. top IS', 'Search lost IS (budget)', 'Search lost IS (rank)',
  'Exported at'];

var BUDGET_HEADER = ['Account', 'Customer ID', 'Currency', 'Time zone', 'Campaign ID', 'Campaign', 'Channel',
  'Status', 'Bidding strategy', 'Target CPA', 'Target ROAS',
  'Budget ID', 'Budget name', 'Shared budget', 'Campaigns on budget', 'Budget period', 'Delivery',
  'Daily budget', 'Total budget', 'Recommended daily budget',
  'Cost today', 'Cost yesterday', 'Cost last 7 days', 'Cost this month', 'Clicks this month',
  'Conversions this month', 'Conv. value this month', 'Cost last month',
  'Day of month', 'Days in month', 'Month elapsed (days)', 'Exported at'];

var TERMS_HEADER = ['Account', 'Customer ID', 'Currency', 'Campaign ID', 'Campaign', 'Ad group',
  'Search term', 'Search term match', 'Keyword', 'Keyword match', 'Status',
  'Impressions', 'Clicks', 'Cost', 'Conversions', 'Conv. value', 'Date range', 'Exported at'];

var KEYWORDS_HEADER = ['Account', 'Customer ID', 'Currency', 'Campaign ID', 'Campaign', 'Ad group', 'Keyword ID',
  'Keyword', 'Match type', 'Status', 'Serving', 'Quality Score', 'Expected CTR', 'Ad relevance',
  'Landing page experience', 'Max CPC', 'First page bid', 'Top of page bid',
  'Impressions', 'Clicks', 'Cost', 'Conversions', 'Conv. value', 'Search IS', 'Search lost IS (rank)',
  'Date range', 'Exported at'];

var DEVICES_HEADER = ['Account', 'Customer ID', 'Currency', 'Campaign ID', 'Campaign', 'Channel', 'Device',
  'Impressions', 'Clicks', 'Cost', 'Conversions', 'Conv. value', 'Date range', 'Exported at'];

var HOURS_HEADER = ['Account', 'Customer ID', 'Currency', 'Time zone', 'Day of week', 'Hour',
  'Impressions', 'Clicks', 'Cost', 'Conversions', 'Conv. value', 'Date range', 'Exported at'];

var LOCATIONS_HEADER = ['Account', 'Customer ID', 'Currency', 'Location type', 'Country', 'Region', 'City',
  'Impressions', 'Clicks', 'Cost', 'Conversions', 'Conv. value', 'Date range', 'Exported at'];

var CONVERSIONS_HEADER = ['Account', 'Customer ID', 'Campaign ID', 'Campaign', 'Conversion action',
  'Category', 'Conversions', 'Conv. value', 'All conversions', 'All conv. value', 'Date range', 'Exported at'];

var ACTIONS_HEADER = ['Account', 'Customer ID', 'Action ID', 'Conversion action', 'Category', 'Status', 'Type',
  'Origin', 'Primary for goal', 'In "Conversions"', 'Counting', 'Click-through window (days)',
  'View-through window (days)', 'Default value', 'Always use default value', 'Attribution model', 'Exported at'];

var ADS_HEADER = ['Account', 'Customer ID', 'Currency', 'Campaign ID', 'Campaign', 'Channel', 'Ad group ID',
  'Ad group', 'Ad ID', 'Kind', 'Ad type', 'Status', 'Primary status', 'Approval', 'Review', 'Policy topics',
  'Ad strength', 'Final URL', 'Path 1', 'Path 2', 'Headlines', 'Descriptions', 'Headline count',
  'Description count', 'Pinned', 'Impressions', 'Clicks', 'Cost', 'Conversions', 'Conv. value',
  'Date range', 'Exported at'];

var COMBOS_HEADER = ['Account', 'Customer ID', 'Kind', 'Campaign', 'Ad group', 'Ad group ID', 'Ad ID', 'Category',
  'Rank', 'Impressions', 'Headlines', 'Descriptions', 'Assets JSON', 'Date range', 'Exported at'];

var AD_ASSETS_HEADER = ['Account', 'Customer ID', 'Currency', 'Campaign', 'Ad group', 'Ad group ID', 'Ad ID',
  'Field', 'Text', 'Pinned to', 'Performance label', 'Enabled', 'Impressions', 'Clicks', 'Cost', 'Conversions',
  'Date range', 'Exported at'];

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
  'Segment', 'Impressions', 'Clicks', 'Cost', 'Conversions', 'Conv. value', 'Date range', 'Exported at'];

var LANDING_HEADER = ['Account', 'Customer ID', 'Currency', 'Landing page', 'Speed score', 'Mobile-friendly clicks',
  'Valid AMP clicks', 'Impressions', 'Clicks', 'Cost', 'Conversions', 'Conv. value', 'Date range', 'Exported at'];

var ABOUT_HEADER = ['Item', 'Value'];

// What each tab holds, in the order they are written, and how the combined rows are capped.
var SECTIONS = [
  { key: 'is', header: IS_HEADER },
  { key: 'weekly', header: WEEKLY_HEADER },
  { key: 'budgets', header: BUDGET_HEADER },
  { key: 'terms', header: TERMS_HEADER, cap: SEARCH_TERMS_TOTAL, label: 'Search terms' },
  { key: 'keywords', header: KEYWORDS_HEADER, cap: KEYWORDS_TOTAL, label: 'Keywords' },
  { key: 'devices', header: DEVICES_HEADER },
  { key: 'hours', header: HOURS_HEADER },
  { key: 'locations', header: LOCATIONS_HEADER, cap: LOCATIONS_TOTAL, label: 'Locations' },
  { key: 'conversions', header: CONVERSIONS_HEADER },
  { key: 'actions', header: ACTIONS_HEADER },
  { key: 'ads', header: ADS_HEADER },
  { key: 'combos', header: COMBOS_HEADER },
  { key: 'adAssets', header: AD_ASSETS_HEADER },
  { key: 'changes', header: CHANGES_HEADER, cap: CHANGES_TOTAL, label: 'Changes', sortBy: 'Changed at' },
  { key: 'health', header: HEALTH_HEADER },
  { key: 'recs', header: RECS_HEADER },
  { key: 'demographics', header: DEMOGRAPHICS_HEADER },
  { key: 'landing', header: LANDING_HEADER, cap: LANDING_TOTAL, label: 'Landing pages' }
];


function main() {
  if (SPREADSHEET_URL.indexOf('docs.google.com') < 0) {
    throw new Error('Set SPREADSHEET_URL at the top of the script to the Google Ads sheet first.');
  }
  if (typeof AdsManagerApp !== 'undefined') {
    var ids = ACCOUNT_IDS.length ? ACCOUNT_IDS : busiestAccounts();
    AdsManagerApp.accounts().withIds(ids).executeInParallel('processAccount', 'writeAll');
  } else {
    writeAll([{ getStatus: function () { return 'OK'; }, getReturnValue: processAccount,
                getCustomerId: function () { return AdsApp.currentAccount().getCustomerId(); } }]);
  }
}


/**
 * Every client account, or the MAX_ACCOUNTS that spent most in the last 30 days when there
 * are more. Account selectors can no longer be filtered or ordered by performance (their
 * forDateRange is deprecated), so spend is read account by account, only when needed.
 */
function busiestAccounts() {
  var it = AdsManagerApp.accounts().get(), ids = [];
  while (it.hasNext()) ids.push(it.next().getCustomerId());
  if (ids.length <= MAX_ACCOUNTS) return ids;
  var spend = {};
  var accounts = AdsManagerApp.accounts().withIds(ids).get();
  while (accounts.hasNext()) {
    var a = accounts.next();
    AdsManagerApp.select(a);
    spend[a.getCustomerId()] = 0;
    try {
      var r = AdsApp.search('SELECT metrics.cost_micros FROM customer WHERE segments.date DURING LAST_30_DAYS');
      while (r.hasNext()) spend[a.getCustomerId()] += Number(r.next().metrics.costMicros || 0);
    } catch (e) {
      Logger.log('Could not read spend for ' + a.getCustomerId() + ': ' + e);
    }
  }
  ids.sort(function (x, y) { return spend[y] - spend[x]; });
  Logger.log(ids.length + ' accounts; exporting the ' + MAX_ACCOUNTS + ' that spent most in the last 30 days.');
  return ids.slice(0, MAX_ACCOUNTS);
}


/** Runs once per account (in parallel under a manager account). Returns JSON. */
function processAccount() {
  var acct = AdsApp.currentAccount();
  var tz = acct.getTimeZone();
  var ctx = {
    name: acct.getName(), cid: acct.getCustomerId(), currency: acct.getCurrencyCode(), tz: tz,
    now: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'), errors: []
  };
  var out = {
    is: guarded(ctx, 'impression share', function () { return impressionShare(ctx); }) || [],
    weekly: guarded(ctx, 'weekly impression share', function () { return weeklyShare(ctx); }) || [],
    budgets: guarded(ctx, 'budgets', function () { return budgets(ctx); }) || [],
    terms: guarded(ctx, 'search terms', function () { return searchTerms(ctx); }) || [],
    keywords: guarded(ctx, 'keywords', function () { return keywords(ctx); }) || [],
    devices: guarded(ctx, 'devices', function () { return devices(ctx); }) || [],
    hours: guarded(ctx, 'hours', function () { return hours(ctx); }) || [],
    locations: guarded(ctx, 'locations', function () { return locations(ctx); }) || [],
    conversions: guarded(ctx, 'conversions', function () { return conversions(ctx); }) || [],
    actions: guarded(ctx, 'conversion actions', function () { return conversionActions(ctx); }) || [],
    ads: guarded(ctx, 'ads', function () { return ads(ctx); }) || [],
    combos: guarded(ctx, 'ad combinations', function () { return combinations(ctx); }) || [],
    adAssets: guarded(ctx, 'ad assets', function () { return adAssets(ctx); }) || [],
    changes: guarded(ctx, 'change history', function () { return changes(ctx); }) || [],
    health: guarded(ctx, 'optimization score', function () { return optimization(ctx); }) || [],
    recs: guarded(ctx, 'recommendations', function () { return recommendations(ctx); }) || [],
    demographics: guarded(ctx, 'demographics', function () { return demographics(ctx); }) || [],
    landing: guarded(ctx, 'landing pages', function () { return landingPages(ctx); }) || [],
    account: ctx.name, errors: ctx.errors
  };
  Logger.log('[' + ctx.name + '] ' + SECTIONS.map(function (x) { return x.key + ' ' + out[x.key].length; }).join(', ') +
    (ctx.errors.length ? ', ' + ctx.errors.length + ' failed queries' : ''));
  return JSON.stringify(out);
}


// ── Impression share, last 30 days ────────────────────────────────────────────
function impressionShare(ctx) {
  var q = 'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ' +
    'campaign.advertising_channel_sub_type, campaign.bidding_strategy_type, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, ' +
    'metrics.search_impression_share, metrics.search_top_impression_share, ' +
    'metrics.search_absolute_top_impression_share, ' +
    'metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share, ' +
    'metrics.search_budget_lost_top_impression_share, metrics.search_rank_lost_top_impression_share, ' +
    'metrics.search_budget_lost_absolute_top_impression_share, ' +
    'metrics.search_rank_lost_absolute_top_impression_share, ' +
    'metrics.search_click_share, metrics.search_exact_match_impression_share, ' +
    'metrics.content_impression_share, metrics.content_budget_lost_impression_share, ' +
    'metrics.content_rank_lost_impression_share ' +
    'FROM campaign WHERE segments.date DURING LAST_30_DAYS AND metrics.impressions > 0';
  var rows = AdsApp.search(q), out = [];
  while (rows.hasNext()) {
    var r = rows.next(), c = r.campaign, m = r.metrics;
    out.push([ctx.name, ctx.cid, ctx.currency, c.id, c.name, c.advertisingChannelType,
      c.advertisingChannelSubType || '', c.status, c.biddingStrategyType || '',
      num(m.impressions), num(m.clicks), money(m.costMicros), num(m.conversions), num(m.conversionsValue),
      share(m.searchImpressionShare), share(m.searchTopImpressionShare), share(m.searchAbsoluteTopImpressionShare),
      share(m.searchBudgetLostImpressionShare), share(m.searchRankLostImpressionShare),
      share(m.searchBudgetLostTopImpressionShare), share(m.searchRankLostTopImpressionShare),
      share(m.searchBudgetLostAbsoluteTopImpressionShare), share(m.searchRankLostAbsoluteTopImpressionShare),
      share(m.searchClickShare), share(m.searchExactMatchImpressionShare),
      share(m.contentImpressionShare), share(m.contentBudgetLostImpressionShare),
      share(m.contentRankLostImpressionShare),
      'LAST_30_DAYS', ctx.now]);
  }
  return out;
}


// ── Impression share per week, last WEEKS weeks ──────────────────────────────
function weeklyShare(ctx) {
  var to = new Date(), from = new Date(to.getTime() - (WEEKS * 7 - 1) * 86400000);
  var range = "'" + Utilities.formatDate(from, ctx.tz, 'yyyy-MM-dd') + "' AND '" +
    Utilities.formatDate(to, ctx.tz, 'yyyy-MM-dd') + "'";
  var q = 'SELECT campaign.id, campaign.name, campaign.advertising_channel_type, segments.week, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, ' +
    'metrics.search_impression_share, metrics.search_top_impression_share, ' +
    'metrics.search_absolute_top_impression_share, ' +
    'metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share ' +
    'FROM campaign WHERE segments.date BETWEEN ' + range + ' AND metrics.impressions > 0';
  var rows = AdsApp.search(q), out = [];
  while (rows.hasNext()) {
    var r = rows.next(), c = r.campaign, m = r.metrics;
    if (m.searchImpressionShare == null) continue;   // not a search campaign
    out.push([ctx.name, ctx.cid, c.id, c.name, c.advertisingChannelType, r.segments.week,
      num(m.impressions), num(m.clicks), money(m.costMicros), num(m.conversions),
      share(m.searchImpressionShare), share(m.searchTopImpressionShare),
      share(m.searchAbsoluteTopImpressionShare),
      share(m.searchBudgetLostImpressionShare), share(m.searchRankLostImpressionShare), ctx.now]);
  }
  return out;
}


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


// ── Search terms, last 30 days ───────────────────────────────────────────────
function searchTerms(ctx) {
  var q = 'SELECT campaign.id, campaign.name, ad_group.name, search_term_view.search_term, ' +
    'search_term_view.status, segments.search_term_match_type, ' +
    'segments.keyword.info.text, segments.keyword.info.match_type, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value ' +
    'FROM search_term_view WHERE segments.date DURING LAST_30_DAYS AND metrics.impressions > 0 ' +
    'ORDER BY metrics.cost_micros DESC LIMIT ' + SEARCH_TERMS_PER_ACCOUNT;
  var rows = AdsApp.search(q), out = [];
  while (rows.hasNext()) {
    var r = rows.next(), m = r.metrics, kw = (r.segments.keyword && r.segments.keyword.info) || {};
    out.push([ctx.name, ctx.cid, ctx.currency, r.campaign.id, r.campaign.name, r.adGroup.name,
      r.searchTermView.searchTerm, r.segments.searchTermMatchType || '', kw.text || '', kw.matchType || '',
      r.searchTermView.status || '',
      num(m.impressions), num(m.clicks), money(m.costMicros), num(m.conversions), num(m.conversionsValue),
      'LAST_30_DAYS', ctx.now]);
  }
  return out;
}


// ── Keywords and Quality Score, last 30 days ─────────────────────────────────
function keywords(ctx) {
  var q = 'SELECT campaign.id, campaign.name, ad_group.name, ad_group_criterion.criterion_id, ' +
    'ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ' +
    'ad_group_criterion.system_serving_status, ad_group_criterion.quality_info.quality_score, ' +
    'ad_group_criterion.quality_info.search_predicted_ctr, ad_group_criterion.quality_info.creative_quality_score, ' +
    'ad_group_criterion.quality_info.post_click_quality_score, ad_group_criterion.effective_cpc_bid_micros, ' +
    'ad_group_criterion.position_estimates.first_page_cpc_micros, ' +
    'ad_group_criterion.position_estimates.top_of_page_cpc_micros, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, ' +
    'metrics.search_impression_share, metrics.search_rank_lost_impression_share ' +
    'FROM keyword_view WHERE segments.date DURING LAST_30_DAYS AND metrics.impressions > 0 ' +
    'ORDER BY metrics.cost_micros DESC LIMIT ' + KEYWORDS_PER_ACCOUNT;
  var rows = AdsApp.search(q), out = [];
  while (rows.hasNext()) {
    var r = rows.next(), k = r.adGroupCriterion, kw = k.keyword || {}, qi = k.qualityInfo || {},
        pe = k.positionEstimates || {}, m = r.metrics;
    out.push([ctx.name, ctx.cid, ctx.currency, r.campaign.id, r.campaign.name, r.adGroup.name, k.criterionId,
      kw.text || '', kw.matchType || '', k.status || '', k.systemServingStatus || '',
      qi.qualityScore == null ? '' : Number(qi.qualityScore), qi.searchPredictedCtr || '',
      qi.creativeQualityScore || '', qi.postClickQualityScore || '',
      k.effectiveCpcBidMicros ? money(k.effectiveCpcBidMicros) : '',
      pe.firstPageCpcMicros ? money(pe.firstPageCpcMicros) : '', pe.topOfPageCpcMicros ? money(pe.topOfPageCpcMicros) : '',
      num(m.impressions), num(m.clicks), money(m.costMicros), num(m.conversions), num(m.conversionsValue),
      share(m.searchImpressionShare), share(m.searchRankLostImpressionShare), 'LAST_30_DAYS', ctx.now]);
  }
  return out;
}


// ── Devices, last 30 days ────────────────────────────────────────────────────
function devices(ctx) {
  var q = 'SELECT campaign.id, campaign.name, campaign.advertising_channel_type, segments.device, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value ' +
    'FROM campaign WHERE segments.date DURING LAST_30_DAYS AND metrics.impressions > 0';
  var rows = AdsApp.search(q), out = [];
  while (rows.hasNext()) {
    var r = rows.next(), m = r.metrics;
    out.push([ctx.name, ctx.cid, ctx.currency, r.campaign.id, r.campaign.name, r.campaign.advertisingChannelType,
      r.segments.device || '', num(m.impressions), num(m.clicks), money(m.costMicros), num(m.conversions),
      num(m.conversionsValue), 'LAST_30_DAYS', ctx.now]);
  }
  return out;
}


// ── Day of week x hour (account time zone), last 30 days ─────────────────────
function hours(ctx) {
  var q = 'SELECT segments.day_of_week, segments.hour, metrics.impressions, metrics.clicks, ' +
    'metrics.cost_micros, metrics.conversions, metrics.conversions_value ' +
    'FROM customer WHERE segments.date DURING LAST_30_DAYS';
  var rows = AdsApp.search(q), out = [];
  while (rows.hasNext()) {
    var r = rows.next(), m = r.metrics;
    out.push([ctx.name, ctx.cid, ctx.currency, ctx.tz, r.segments.dayOfWeek || '', num(r.segments.hour),
      num(m.impressions), num(m.clicks), money(m.costMicros), num(m.conversions), num(m.conversionsValue),
      'LAST_30_DAYS', ctx.now]);
  }
  return out;
}


// ── Locations: region and city, last 30 days ─────────────────────────────────
function locations(ctx) {
  var base = 'geographic_view.location_type, geographic_view.country_criterion_id, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value ' +
    'FROM geographic_view WHERE segments.date DURING LAST_30_DAYS AND metrics.impressions > 0 ' +
    'ORDER BY metrics.cost_micros DESC LIMIT ' + LOCATIONS_PER_ACCOUNT;
  var rows, withCity = true;
  try {
    rows = AdsApp.search('SELECT segments.geo_target_region, segments.geo_target_city, ' + base);
  } catch (e) {
    ctx.errors.push('locations by city (fell back to regions): ' + String(e).slice(0, 200));
    rows = AdsApp.search('SELECT segments.geo_target_region, ' + base);
    withCity = false;
  }
  var raw = [], names = {};
  while (rows.hasNext()) {
    var r = rows.next(), g = r.geographicView, s = r.segments || {}, m = r.metrics;
    var country = g.countryCriterionId ? 'geoTargetConstants/' + g.countryCriterionId : '';
    var region = s.geoTargetRegion || '', city = withCity ? (s.geoTargetCity || '') : '';
    [country, region, city].forEach(function (n) { if (n) names[n] = ''; });
    raw.push([g.locationType || '', country, region, city, m]);
  }
  lookupGeoNames(ctx, names);
  return raw.map(function (x) {
    var m = x[4];
    return [ctx.name, ctx.cid, ctx.currency, x[0], geoName(names, x[1]), geoName(names, x[2]), geoName(names, x[3]),
      num(m.impressions), num(m.clicks), money(m.costMicros), num(m.conversions), num(m.conversionsValue),
      'LAST_30_DAYS', ctx.now];
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


// ── Conversions by action, last 30 days ──────────────────────────────────────
function conversions(ctx) {
  var q = 'SELECT campaign.id, campaign.name, segments.conversion_action_name, ' +
    'segments.conversion_action_category, metrics.conversions, metrics.conversions_value, ' +
    'metrics.all_conversions, metrics.all_conversions_value ' +
    'FROM campaign WHERE segments.date DURING LAST_30_DAYS AND metrics.all_conversions > 0';
  var rows = AdsApp.search(q), out = [];
  while (rows.hasNext()) {
    var r = rows.next(), m = r.metrics, s = r.segments;
    out.push([ctx.name, ctx.cid, r.campaign.id, r.campaign.name, s.conversionActionName || '',
      s.conversionActionCategory || '', num(m.conversions), num(m.conversionsValue), num(m.allConversions),
      num(m.allConversionsValue), 'LAST_30_DAYS', ctx.now]);
  }
  return out;
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
  var out = [], byKey = {};
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
      JSON.stringify(heads), JSON.stringify(descs), heads.length, descs.length, pinned, 0, 0, 0, 0, 0,
      'LAST_30_DAYS', ctx.now];
    byKey[r.adGroup.id + '~' + ad.id] = row;
    out.push(row);
  }
  guarded(ctx, 'ad metrics', function () {
    var m = AdsApp.search('SELECT ad_group.id, ad_group_ad.ad.id, metrics.impressions, metrics.clicks, ' +
      'metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM ad_group_ad WHERE ' + LIVE +
      ' AND segments.date DURING LAST_30_DAYS');
    var at = ADS_HEADER.indexOf('Impressions');
    while (m.hasNext()) {
      var r = m.next(), row = byKey[r.adGroup.id + '~' + r.adGroupAd.ad.id], x = r.metrics;
      if (!row) continue;
      row[at] = num(x.impressions); row[at + 1] = num(x.clicks); row[at + 2] = money(x.costMicros);
      row[at + 3] = num(x.conversions); row[at + 4] = num(x.conversionsValue);
    }
  });
  guarded(ctx, 'asset groups', function () {
    var groups = {}, g = AdsApp.search('SELECT campaign.id, campaign.name, campaign.advertising_channel_type, ' +
      'asset_group.id, asset_group.name, asset_group.status, asset_group.primary_status, asset_group.ad_strength, ' +
      "asset_group.final_urls FROM asset_group WHERE campaign.status = 'ENABLED' AND asset_group.status = 'ENABLED'");
    while (g.hasNext()) {
      var r = g.next(), a = r.assetGroup;
      var row = [ctx.name, ctx.cid, ctx.currency, r.campaign.id, r.campaign.name, r.campaign.advertisingChannelType,
        a.id, a.name, a.id, 'ASSET_GROUP', 'PERFORMANCE_MAX_ASSET_GROUP', a.status || '', a.primaryStatus || '', '', '', '',
        a.adStrength || '', (a.finalUrls || [])[0] || '', '', '', '[]', '[]', 0, 0, 0, 0, 0, 0, 0, 0,
        'LAST_30_DAYS', ctx.now];
      groups[a.id] = row;
      out.push(row);
    }
    var m = AdsApp.search('SELECT asset_group.id, metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
      "metrics.conversions, metrics.conversions_value FROM asset_group WHERE campaign.status = 'ENABLED' " +
      "AND asset_group.status = 'ENABLED' AND segments.date DURING LAST_30_DAYS");
    var at = ADS_HEADER.indexOf('Impressions');
    while (m.hasNext()) {
      var r = m.next(), row = groups[r.assetGroup.id], x = r.metrics;
      if (!row) continue;
      row[at] = num(x.impressions); row[at + 1] = num(x.clicks); row[at + 2] = money(x.costMicros);
      row[at + 3] = num(x.conversions); row[at + 4] = num(x.conversionsValue);
    }
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


// ── Each headline and description ────────────────────────────────────────────
function adAssets(ctx) {
  var q = 'SELECT campaign.name, ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad_asset_view.field_type, ' +
    'ad_group_ad_asset_view.pinned_field, ad_group_ad_asset_view.performance_label, ad_group_ad_asset_view.enabled, ' +
    'asset.text_asset.text, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
    "FROM ad_group_ad_asset_view WHERE ad_group_ad_asset_view.field_type IN ('HEADLINE', 'DESCRIPTION') " +
    'AND segments.date DURING LAST_30_DAYS AND ' + LIVE +
    ' ORDER BY metrics.impressions DESC LIMIT ' + AD_ASSETS_PER_ACCOUNT;
  var rows = AdsApp.search(q), out = [];
  while (rows.hasNext()) {
    var r = rows.next(), v = r.adGroupAdAssetView, m = r.metrics;
    out.push([ctx.name, ctx.cid, ctx.currency, r.campaign.name, r.adGroup.name, r.adGroup.id, r.adGroupAd.ad.id,
      v.fieldType || '', (r.asset && r.asset.textAsset && r.asset.textAsset.text) || '', v.pinnedField || '',
      v.performanceLabel || '', v.enabled !== false, num(m.impressions), num(m.clicks), money(m.costMicros),
      num(m.conversions), 'LAST_30_DAYS', ctx.now]);
  }
  return out;
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


// ── Age range and gender, last 30 days (summed over each campaign's ad groups) ──
function demographics(ctx) {
  var sums = {}, order = [];
  [['Age', 'age_range_view', 'ad_group_criterion.age_range.type', function (k) { return k.ageRange && k.ageRange.type; }],
   ['Gender', 'gender_view', 'ad_group_criterion.gender.type', function (k) { return k.gender && k.gender.type; }]
  ].forEach(function (d) {
    guarded(ctx, d[1], function () {
      var rows = AdsApp.search('SELECT campaign.id, campaign.name, campaign.advertising_channel_type, ' + d[2] + ', ' +
        'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value ' +
        'FROM ' + d[1] + ' WHERE segments.date DURING LAST_30_DAYS AND metrics.impressions > 0');
      while (rows.hasNext()) {
        var r = rows.next(), seg = d[3](r.adGroupCriterion || {}) || 'UNKNOWN', m = r.metrics;
        var k = r.campaign.id + '~' + d[0] + '~' + seg;
        if (!sums[k]) {
          sums[k] = { c: r.campaign, dim: d[0], seg: seg, imp: 0, clicks: 0, cost: 0, conv: 0, value: 0 };
          order.push(k);
        }
        var s = sums[k];
        s.imp += num(m.impressions); s.clicks += num(m.clicks); s.cost += Number(m.costMicros || 0);
        s.conv += num(m.conversions); s.value += num(m.conversionsValue);
      }
    });
  });
  return order.map(function (k) {
    var s = sums[k];
    return [ctx.name, ctx.cid, ctx.currency, s.c.id, s.c.name, s.c.advertisingChannelType || '', s.dim, s.seg,
      s.imp, s.clicks, money(s.cost), Math.round(s.conv * 100) / 100, Math.round(s.value * 100) / 100,
      'LAST_30_DAYS', ctx.now];
  });
}


// ── Landing pages, last 30 days ──────────────────────────────────────────────
function landingPages(ctx) {
  var rows = AdsApp.search('SELECT landing_page_view.unexpanded_final_url, metrics.speed_score, ' +
    'metrics.mobile_friendly_clicks_percentage, metrics.valid_accelerated_mobile_pages_clicks_percentage, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value ' +
    'FROM landing_page_view WHERE segments.date DURING LAST_30_DAYS AND metrics.impressions > 0 ' +
    'ORDER BY metrics.cost_micros DESC LIMIT ' + LANDING_PER_ACCOUNT);
  var out = [];
  while (rows.hasNext()) {
    var r = rows.next(), m = r.metrics;
    out.push([ctx.name, ctx.cid, ctx.currency, (r.landingPageView && r.landingPageView.unexpandedFinalUrl) || '',
      m.speedScore == null ? '' : Number(m.speedScore), share(m.mobileFriendlyClicksPercentage),
      share(m.validAcceleratedMobilePagesClicksPercentage),
      num(m.impressions), num(m.clicks), money(m.costMicros), num(m.conversions), num(m.conversionsValue),
      'LAST_30_DAYS', ctx.now]);
  }
  return out;
}


// ── Writing the sheet ────────────────────────────────────────────────────────
function writeAll(results) {
  var all = {}, notes = [], accounts = 0;
  SECTIONS.forEach(function (x) { all[x.key] = []; });
  results.forEach(function (res) {
    var id = res.getCustomerId ? res.getCustomerId() : '';
    if (res.getStatus() !== 'OK') {
      notes.push(['Account failed', id + ': ' + (res.getError ? res.getError() : res.getStatus())]);
      return;
    }
    var d = JSON.parse(res.getReturnValue());
    accounts++;
    SECTIONS.forEach(function (x) { all[x.key] = all[x.key].concat(d[x.key] || []); });
    (d.errors || []).forEach(function (e) { notes.push(['Query failed', d.account + ': ' + e]); });
  });
  SECTIONS.forEach(function (x) {
    if (!x.cap) return;
    var col = x.header.indexOf(x.sortBy || 'Cost');
    all[x.key].sort(function (a, b) { return a[col] < b[col] ? 1 : a[col] > b[col] ? -1 : 0; });
    if (all[x.key].length > x.cap) {
      notes.push([x.label + ' trimmed', 'Kept the ' + x.cap + (x.sortBy ? ' newest' : ' that spent most') +
        ' of ' + all[x.key].length]);
      all[x.key] = all[x.key].slice(0, x.cap);
    }
  });
  var ss = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
  var written = SECTIONS.map(function (x) {
    return x.key + ' ' + writeTab(ss, TABS[x.key], x.header, all[x.key]);
  });
  var tz = ss.getSpreadsheetTimeZone();
  var about = [
    ['Exported at', Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm') + ' (' + tz + ')'],
    ['Accounts', String(accounts)],
    ['Impression share range', 'LAST_30_DAYS'],
    ['Weekly range', 'last ' + WEEKS + ' weeks'],
    ['Search terms range', 'LAST_30_DAYS, top ' + SEARCH_TERMS_PER_ACCOUNT + ' per account by spend'],
    ['Keywords range', 'LAST_30_DAYS, top ' + KEYWORDS_PER_ACCOUNT + ' per account by spend'],
    ['Devices, hours, locations, conversions range', 'LAST_30_DAYS'],
    ['Ads', 'live ads and asset groups now; performance LAST_30_DAYS; top ' + COMBOS_PER_AD +
      ' served combinations per ad'],
    ['Changes range', 'last ' + CHANGE_DAYS + ' days, newest ' + CHANGES_PER_ACCOUNT + ' per account'],
    ['Recommendations', 'open (not dismissed) now; impact is Google\'s weekly estimate'],
    ['Demographics, landing pages range', 'LAST_30_DAYS'],
    ['Rows written', written.join(', ')]
  ].concat(notes);
  writeTab(ss, TABS.about, ABOUT_HEADER, about, true);
  Logger.log(about.map(function (r) { return r.join(': '); }).join('\n'));
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
