/**
 * Google Ads dashboard: the daily campaign report (the "Daily Campaign Performance" tab).
 *
 * Writes the tab the dashboard's campaign panels read, in the same shape as the Google Ads
 * report it replaces: a title row, a date-range row, then one row per campaign per day with
 * these columns (the dashboard finds them by these exact header names):
 *
 *   Account name, Customer ID, Campaign, Campaign state, Campaign type, Day, Clicks, Impr., CTR,
 *   Currency code, Avg. CPC, Avg. CPC (Converted currency), Cost, Cost (Converted currency),
 *   Impr. (Abs. Top) %, Impr. (Top) %, Conversions, View-through conv., Cost / conv.,
 *   Cost / conv. (Converted currency), Conv. rate, Converted currency code
 *
 * Install in the MANAGER (MCC) account: Tools > Bulk actions > Scripts > +. Paste this file,
 * set SPREADSHEET_URL to the Google Ads sheet the dashboard reads, authorise, Preview once,
 * then schedule it Daily, early morning. Turn off the Google Ads scheduled report that used to
 * fill this tab, so the two do not overwrite each other.
 *
 * Converted currency. The Google Ads API has no "Cost (Converted currency)" field: Google's own
 * conversion exists only in the reports built in the Google Ads interface. This script converts
 * each account's money into the manager account's currency at the European Central Bank's daily
 * reference rates (https://www.frankfurter.app, which republishes them; weekends and holidays take
 * the last published rate), and currencies fixed to the US dollar by their central bank (AED,
 * SAR, QAR, OMR, BHD, JOD) through that fixed rate. Row 2 says so, and the dashboard repeats it.
 * These rates can differ from Google's by a fraction of a percent. A currency with no rate is
 * left in its own currency (its "Converted currency code" is then its own), which the dashboard
 * flags rather than adding it to the other currencies.
 *
 * Days. Each account is read for the last DAYS days ending on its own yesterday, in its own time
 * zone (yesterday counts once it is SETTLE_HOURS old there), the same days the insights script
 * exports. Rows: every campaign and day with at least one impression.
 */

var SPREADSHEET_URL = 'PASTE_THE_GOOGLE_ADS_SHEET_URL_HERE';
var TAB = 'Daily Campaign Performance';   // the tab the dashboard reads (kept first in the sheet)
var DAYS = 30;                            // days per account, ending yesterday; up to 90 is fine
var SETTLE_HOURS = 6;                     // see "Days" above
var ACCOUNT_IDS = [];                     // optional: e.g. ['123-456-7890']; empty = every live account
var MAX_MINUTES = 25;                     // stop reading accounts after this (scripts get 30 minutes)
var RATES_URL = 'https://api.frankfurter.app';
// Fixed rates: 1 US dollar in each currency, set by its central bank.
var USD_PEGS = { AED: 3.6725, SAR: 3.75, QAR: 3.64, OMR: 0.3845, BHD: 0.376, JOD: 0.709 };

var HEADER = ['Account name', 'Customer ID', 'Campaign', 'Campaign state', 'Campaign type', 'Day', 'Clicks',
  'Impr.', 'CTR', 'Currency code', 'Avg. CPC', 'Avg. CPC (Converted currency)', 'Cost',
  'Cost (Converted currency)', 'Impr. (Abs. Top) %', 'Impr. (Top) %', 'Conversions', 'View-through conv.',
  'Cost / conv.', 'Cost / conv. (Converted currency)', 'Conv. rate', 'Converted currency code'];
// Number formats per column (null: as written). Text columns are set to text so Sheets never
// turns a day into a date or a customer ID into a number.
var FORMATS = ['@', '@', '@', '@', '@', '@', '0', '0', '0.00%', '@', '0.00', '0.00', '0.00', '0.00',
  '0.00%', '0.00%', '0.00', '0', '0.00', null, '0.00%', '@'];

var TYPES = { SEARCH: 'Search', DISPLAY: 'Display', SHOPPING: 'Shopping', VIDEO: 'Video', MULTI_CHANNEL: 'App',
  PERFORMANCE_MAX: 'Performance Max', DEMAND_GEN: 'Demand Gen', DISCOVERY: 'Demand Gen', LOCAL: 'Local',
  SMART: 'Smart', HOTEL: 'Hotel', LOCAL_SERVICES: 'Local Services', TRAVEL: 'Travel' };
var STATES = { ENABLED: 'Enabled', PAUSED: 'Paused', REMOVED: 'Removed' };


function main() {
  if (SPREADSHEET_URL.indexOf('docs.google.com') < 0) {
    throw new Error('Set SPREADSHEET_URL at the top of the script to the Google Ads sheet first.');
  }
  var started = Date.now();
  var to = AdsApp.currentAccount().getCurrencyCode();   // the manager account's currency
  var rows = [], ranges = [], skipped = [];
  forEachAccount(function (acct) {
    if (Date.now() - started > MAX_MINUTES * 60000) { skipped.push(acct.getCustomerId()); return; }
    var got = readAccount(acct);
    rows = rows.concat(got.rows);
    if (got.rows.length) ranges.push([got.from, got.to]);
  });
  if (skipped.length) Logger.log('Out of time: ' + skipped.length + ' accounts not read: ' + skipped.join(', '));

  var fx = convert(rows, to);
  rows.sort(function (a, b) { return b.clicks - a.clicks || (a.day < b.day ? 1 : a.day > b.day ? -1 : 0); });
  write(rows, ranges, to, fx);
  Logger.log('Wrote ' + rows.length + ' rows' + (fx.missing.length ? '; no rate for ' + fx.missing.join(', ') +
    ', left in their own currency' : '') + '.');
}


/** Runs fn for every live client account (or this account, outside a manager account). */
function forEachAccount(fn) {
  if (typeof AdsManagerApp === 'undefined') { fn(AdsApp.currentAccount()); return; }
  var ids = ACCOUNT_IDS.length ? ACCOUNT_IDS : liveAccounts();
  if (!ids.length) return;
  var it = AdsManagerApp.accounts().withIds(ids).get();
  while (it.hasNext()) {
    var a = it.next();
    AdsManagerApp.select(a);
    try {
      fn(AdsApp.currentAccount());
    } catch (e) {
      Logger.log('Could not read ' + a.getCustomerId() + ': ' + e);
    }
  }
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
  Logger.log(ids.length + ' live client accounts.');
  return ids;
}


/** One account's rows: every campaign and day with an impression, in the account's own currency. */
function readAccount(acct) {
  var tz = acct.getTimeZone(), now = new Date();
  var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var last = isoAdd(today, Number(Utilities.formatDate(now, tz, 'H')) < SETTLE_HOURS ? -2 : -1);
  var first = isoAdd(last, 1 - DAYS);
  var name = acct.getName(), cid = acct.getCustomerId(), cur = acct.getCurrencyCode();
  var q = AdsApp.search('SELECT campaign.name, campaign.status, campaign.advertising_channel_type, segments.date, ' +
    'metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions, ' +
    'metrics.view_through_conversions, metrics.absolute_top_impression_percentage, ' +
    'metrics.top_impression_percentage, metrics.conversions_from_interactions_rate ' +
    "FROM campaign WHERE segments.date BETWEEN '" + first + "' AND '" + last + "' AND metrics.impressions > 0");
  var rows = [];
  while (q.hasNext()) {
    var r = q.next(), m = r.metrics || {}, c = r.campaign || {};
    rows.push({
      account: name, cid: cid, cur: cur, campaign: c.name || '', state: STATES[c.status] || title(c.status),
      type: TYPES[c.advertisingChannelType] || title(c.advertisingChannelType), day: r.segments.date,
      clicks: num(m.clicks), impr: num(m.impressions), cost: num(m.costMicros) / 1e6, conv: num(m.conversions),
      vtc: num(m.viewThroughConversions), abs: num(m.absoluteTopImpressionPercentage),
      top: num(m.topImpressionPercentage), cvr: num(m.conversionsFromInteractionsRate)
    });
  }
  Logger.log(name + ' (' + cid + ', ' + cur + '): ' + rows.length + ' campaign-days, ' + first + ' to ' + last);
  return { rows: rows, from: first, to: last };
}


/**
 * Sets each row's rate into `to`: 1 where the currency is already `to`, the daily reference rate
 * where one is published (the last published one on weekends and holidays), else none.
 */
function convert(rows, to) {
  var need = {}, missing = [];
  rows.forEach(function (r) {
    if (r.cur === to) return;
    var n = need[r.cur] = need[r.cur] || { from: r.day, to: r.day };
    if (r.day < n.from) n.from = r.day;
    if (r.day > n.to) n.to = r.day;
  });
  var tables = {};
  Object.keys(need).forEach(function (cur) {
    tables[cur] = dailyRates(cur, to, isoAdd(need[cur].from, -7), need[cur].to);
    if (!tables[cur]) missing.push(cur);
  });
  rows.forEach(function (r) {
    r.rate = r.cur === to ? 1 : (tables[r.cur] ? rateOn(tables[r.cur], r.day) : null);
  });
  return { missing: missing, converted: Object.keys(tables).filter(function (c) { return tables[c]; }) };
}

var FETCHED = {};   // one request per currency pair and range

/** {day: units of `to` per 1 `cur`} from the reference rates, through a dollar peg where needed. */
function dailyRates(cur, to, from, until) {
  var base = USD_PEGS[cur] ? 'USD' : cur, quote = USD_PEGS[to] ? 'USD' : to;
  var scale = (USD_PEGS[cur] ? 1 / USD_PEGS[cur] : 1) * (USD_PEGS[to] || 1);   // cur -> base, quote -> to
  if (base === quote) {
    var flat = {};
    flat[from] = scale;
    return flat;
  }
  try {
    var url = RATES_URL + '/' + from + '..' + until + '?from=' + base + '&to=' + quote;
    if (!(url in FETCHED)) {
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      FETCHED[url] = res.getResponseCode() === 200 ? JSON.parse(res.getContentText()).rates || {} : null;
      if (FETCHED[url] === null) Logger.log('No rate for ' + base + ' to ' + quote + ' (HTTP ' + res.getResponseCode() + ').');
    }
    if (FETCHED[url] === null) return null;
    var rates = FETCHED[url], out = {}, any = false;
    Object.keys(rates).forEach(function (d) {
      if (rates[d][quote]) { out[d] = rates[d][quote] * scale; any = true; }
    });
    return any ? out : null;
  } catch (e) {
    Logger.log('No rate for ' + cur + ' to ' + to + ': ' + e);
    return null;
  }
}

function rateOn(table, day) {
  var best = null, bestDay = '';
  Object.keys(table).forEach(function (d) {
    if (d <= day && d > bestDay) { bestDay = d; best = table[d]; }
  });
  if (best === null) {   // nothing on or before the day: the earliest one
    Object.keys(table).sort().slice(0, 1).forEach(function (d) { best = table[d]; });
  }
  return best;
}


function write(rows, ranges, to, fx) {
  var ss = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
  var sheet = ss.getSheetByName(TAB) || ss.insertSheet(TAB, 0);
  sheet.clear();
  var from = ranges.map(function (r) { return r[0]; }).sort()[0] || '';
  var until = ranges.map(function (r) { return r[1]; }).sort().slice(-1)[0] || '';
  var note = fx.converted.length
    ? 'Converted to ' + to + ' at the European Central Bank daily reference rates' +
      (fx.converted.some(function (c) { return USD_PEGS[c]; }) ? ' (pegged currencies through their fixed US dollar rate)' : '') +
      '; Google\'s own rates can differ slightly.'
    : '';
  var out = [['Daily Campaign Performance'].concat(blank(HEADER.length - 1)),
             [from ? longDate(from) + ' - ' + longDate(until) : ''].concat(blank(HEADER.length - 1)),
             HEADER];
  out[1][2] = note;
  rows.forEach(function (r) {
    var conv = r.rate !== null && r.rate !== undefined;
    var rate = conv ? r.rate : 1;
    var cpc = r.clicks ? r.cost / r.clicks : 0;
    out.push([r.account, r.cid, r.campaign, r.state, r.type, r.day, r.clicks, r.impr,
      r.impr ? r.clicks / r.impr : 0, r.cur, round2(cpc), round2(cpc * rate), round2(r.cost), round2(r.cost * rate),
      r.abs, r.top, round2(r.conv), r.vtc, r.conv ? round2(r.cost / r.conv) : 0,
      r.conv ? round2(r.cost * rate / r.conv) : '--', r.cvr, conv ? to : r.cur]);
  });
  if (out.length > 3) {
    FORMATS.forEach(function (f, i) {
      if (f) sheet.getRange(4, i + 1, out.length - 3, 1).setNumberFormat(f);
    });
  }
  sheet.getRange(1, 1, out.length, HEADER.length).setValues(out);
  sheet.getRange(3, 1, 1, HEADER.length).setFontWeight('bold');
  if (ss.getSheets()[0].getName() !== TAB) {
    try {
      ss.setActiveSheet(sheet);
      ss.moveActiveSheet(1);   // the dashboard reads the first tab that is not an insights tab
    } catch (e) {
      Logger.log('Move the "' + TAB + '" tab to the first position by hand (' + e + ').');
    }
  }
}


function isoAdd(iso, n) {
  var p = iso.split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)).toISOString().slice(0, 10);
}
function longDate(iso) {
  var p = iso.split('-');
  var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December'];
  return Number(p[2]) + ' ' + months[Number(p[1]) - 1] + ' ' + p[0];
}
function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function round2(v) { return Math.round(v * 100) / 100; }
function blank(n) { var a = []; for (var i = 0; i < n; i++) a.push(''); return a; }
function title(s) {
  return String(s || '').toLowerCase().split('_').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
}
