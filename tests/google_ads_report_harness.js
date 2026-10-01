// Runs scripts/google_ads/export_campaign_report.js against fakes of Google Ads, Sheets and the rate
// service, and prints what it wrote. Args: "norates" makes every rate request fail.
var fs = require("fs"), path = require("path"), vm = require("vm");
var src = fs.readFileSync(path.join(__dirname, "..", "scripts", "google_ads", "export_campaign_report.js"), "utf8")
  .replace("PASTE_THE_GOOGLE_ADS_SHEET_URL_HERE", "https://docs.google.com/spreadsheets/d/test/edit");
var norates = process.argv.indexOf("norates") > -1;
function iter(rows) { var i = 0; return { hasNext: function () { return i < rows.length; }, next: function () { return rows[i++]; } }; }

var ACCOUNTS = {
  "111-111-1111": { name: "Acme India", cur: "INR", tz: "Asia/Kolkata" },
  "222-222-2222": { name: "Beta US", cur: "USD", tz: "America/New_York" },
  "333-333-3333": { name: "Gulf Co", cur: "AED", tz: "Asia/Dubai" },
  "444-444-4444": { name: "Euro Ltd", cur: "EUR", tz: "Europe/Berlin" }
};
var current = null, queries = [], fetched = [], logs = [];
function acct(cid) {
  var a = ACCOUNTS[cid];
  return { getCustomerId: function () { return cid; }, getName: function () { return a.name; },
           getCurrencyCode: function () { return a.cur; }, getTimeZone: function () { return a.tz; } };
}
var manager = { getCustomerId: function () { return "999-999-9999"; }, getName: function () { return "MCC"; },
                getCurrencyCode: function () { return "INR"; }, getTimeZone: function () { return "Asia/Kolkata"; } };
var AdsApp = {
  currentAccount: function () { return current ? acct(current) : manager; },
  search: function (q) {
    queries.push(q);
    if (/FROM customer_client/.test(q)) {
      return iter(Object.keys(ACCOUNTS).map(function (c) { return { customerClient: { id: c.replace(/-/g, ""), status: "ENABLED" } }; })
        .concat([{ customerClient: { id: "5555555555", status: "ENABLED", testAccount: true } }]));
    }
    var m = q.match(/BETWEEN '([\d-]+)' AND '([\d-]+)'/);
    if (!m || !/metrics\.impressions > 0/.test(q)) throw new Error("daily query expected: " + q);
    if (m[1] !== "2026-08-28" || m[2] !== "2026-09-26") throw new Error("30 days ending yesterday expected: " + q);
    var big = current === "111-111-1111";
    return iter([
      { campaign: { name: "Search | Brand", status: "ENABLED", advertisingChannelType: "SEARCH" }, segments: { date: "2026-09-26" },
        metrics: { clicks: big ? "200" : "20", impressions: "4000", costMicros: big ? "5000000000" : "50000000", conversions: 10,
                   viewThroughConversions: "1", absoluteTopImpressionPercentage: 0.5, topImpressionPercentage: 0.8,
                   conversionsFromInteractionsRate: 0.05 } },
      { campaign: { name: "PMax | All", status: "PAUSED", advertisingChannelType: "PERFORMANCE_MAX" }, segments: { date: "2026-09-20" },
        metrics: { clicks: "5", impressions: "900", costMicros: "12345678", conversions: 0, viewThroughConversions: "0",
                   conversionsFromInteractionsRate: 0 } }
    ]);
  }
};
var AdsManagerApp = {
  accounts: function () {
    var ids = null;
    var sel = { withIds: function (x) { ids = x; return sel; },
                get: function () { return iter(ids.map(function (c) { return { getCustomerId: function () { return c; } }; })); } };
    return sel;
  },
  select: function (a) { current = a.getCustomerId(); }
};
var UrlFetchApp = {
  fetch: function (url) {
    fetched.push(url);
    var code = norates || /from=EUR/.test(url) ? 503 : 200;
    // Rates for weekdays only (no 2026-09-20, a Sunday, and no 2026-09-26, a Saturday).
    var body = { rates: { "2026-09-18": { INR: 95.0 }, "2026-09-25": { INR: 96.0 } } };
    return { getResponseCode: function () { return code; }, getContentText: function () { return JSON.stringify(body); } };
  }
};
var sheets = [{ name: "Insights - About", values: {} }], formats = {}, bold = [];
function sheet(s) {
  return {
    getName: function () { return s.name; },
    clear: function () { s.values = {}; s.cleared = true; },
    getRange: function (r, c, nr, nc) {
      return {
        setValues: function (v) { if (v.length !== nr || v[0].length !== nc) throw new Error("shape"); s.grid = v; s.at = [r, c]; },
        setNumberFormat: function (f) { formats[c] = { f: f, rows: [r, nr] }; },
        setFontWeight: function (w) { bold.push([r, w]); }
      };
    }
  };
}
var ss = {
  getSheetByName: function (n) { var s = sheets.filter(function (x) { return x.name === n; })[0]; return s ? sheet(s) : null; },
  insertSheet: function (n, i) { var s = { name: n, values: {} }; sheets.splice(i, 0, s); return sheet(s); },
  getSheets: function () { return sheets.map(sheet); },
  setActiveSheet: function () {}, moveActiveSheet: function () {}
};
var sandbox = {
  AdsApp: AdsApp, AdsManagerApp: AdsManagerApp, UrlFetchApp: UrlFetchApp,
  SpreadsheetApp: { openByUrl: function () { return ss; } },
  Utilities: { formatDate: function (d, tz, fmt) { return fmt === "H" ? "10" : "2026-09-27"; } },
  Logger: { log: function (m) { logs.push(String(m)); } },
  JSON: JSON, Math: Math, Number: Number, String: String, Date: Date, Object: Object, Error: Error, isFinite: isFinite
};
vm.createContext(sandbox);
vm.runInContext(src + "\nmain();", sandbox);
var tab = sheets.filter(function (x) { return x.name === "Daily Campaign Performance"; })[0];
process.stdout.write(JSON.stringify({ grid: tab.grid, at: tab.at, order: sheets.map(function (s) { return s.name; }),
  formats: formats, bold: bold, fetched: fetched, logs: logs, queries: queries.length }));
