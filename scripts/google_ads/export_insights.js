/**
 * Google Ads dashboard: insights export (impression share, budget pacing, search terms,
 * keywords and Quality Score, devices, hours, locations, conversion actions).
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
  { key: 'actions', header: ACTIONS_HEADER }
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
    var costCol = x.header.indexOf('Cost');
    all[x.key].sort(function (a, b) { return b[costCol] - a[costCol]; });
    if (all[x.key].length > x.cap) {
      notes.push([x.label + ' trimmed', 'Kept the ' + x.cap + ' that spent most of ' + all[x.key].length]);
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
