/*
 * Runs scripts/google_ads/export_insights.js outside Google Ads, against fake
 * AdsApp / SpreadsheetApp / Utilities objects shaped like the real ones, and
 * prints the tabs it wrote as JSON. Used by tests/test_google_ads_insights.py.
 *
 *   node tests/google_ads_script_harness.js [manager]
 */
"use strict";
var fs = require("fs"), path = require("path"), vm = require("vm");

var src = fs.readFileSync(path.join(__dirname, "..", "scripts", "google_ads", "export_insights.js"), "utf8")
  .replace("PASTE_THE_GOOGLE_ADS_SHEET_URL_HERE", "https://docs.google.com/spreadsheets/d/TEST/edit");
var manager = process.argv[2] === "manager";
var queries = [];

function iter(rows) { var i = 0; return { hasNext: function () { return i < rows.length; }, next: function () { return rows[i++]; } }; }

var CAMPAIGNS = [
  { id: "11", name: "Brand - Search", advertisingChannelType: "SEARCH", advertisingChannelSubType: undefined, status: "ENABLED", biddingStrategyType: "TARGET_IMPRESSION_SHARE" },
  { id: "12", name: "Generic - Search", advertisingChannelType: "SEARCH", status: "ENABLED", biddingStrategyType: "MAXIMIZE_CONVERSIONS",
    maximizeConversions: { targetCpaMicros: "2500000000" } },
  { id: "13", name: "PMax - All", advertisingChannelType: "PERFORMANCE_MAX", status: "ENABLED", biddingStrategyType: "MAXIMIZE_CONVERSION_VALUE",
    maximizeConversionValue: { targetRoas: 4.5 } }
];

function account(cid, name) {
  return {
    search: function (q) {
      queries.push(q);
      if (/FROM search_term_view/.test(q)) {
        return iter([
          { campaign: { id: "12", name: "Generic - Search" }, adGroup: { name: "CRM" },
            searchTermView: { searchTerm: "free crm software", status: "NONE" },
            segments: { searchTermMatchType: "BROAD", keyword: { info: { text: "crm software", matchType: "BROAD" } } },
            metrics: { impressions: "900", clicks: "60", costMicros: "5400000000", conversions: 0, conversionsValue: 0 } },
          { campaign: { id: "11", name: "Brand - Search" }, adGroup: { name: "Brand" },
            searchTermView: { searchTerm: name.toLowerCase() + " login", status: "ADDED" },
            segments: { searchTermMatchType: "EXACT", keyword: { info: { text: name.toLowerCase(), matchType: "PHRASE" } } },
            metrics: { impressions: "400", clicks: "120", costMicros: "900000000", conversions: 30, conversionsValue: 0 } }
        ]);
      }
      if (/segments\.week/.test(q)) {
        return iter([
          { campaign: CAMPAIGNS[0], segments: { week: "2026-09-14" },
            metrics: { impressions: "1000", clicks: "200", costMicros: "3000000000", conversions: 40,
                       searchImpressionShare: 0.91, searchTopImpressionShare: 0.88, searchAbsoluteTopImpressionShare: 0.7,
                       searchBudgetLostImpressionShare: 0, searchRankLostImpressionShare: 0.09 } },
          { campaign: CAMPAIGNS[2], segments: { week: "2026-09-14" },
            metrics: { impressions: "5000", clicks: "50", costMicros: "1000000000", conversions: 2 } }
        ]);
      }
      if (/target_cpa/.test(q)) return iter(CAMPAIGNS.map(function (c) { return { campaign: c }; }));
      if (/campaign_budget\.amount_micros/.test(q)) {
        return iter([
          { campaign: CAMPAIGNS[0], campaignBudget: { id: "901", name: "Brand daily", amountMicros: "1000000000", period: "DAILY",
            deliveryMethod: "STANDARD", explicitlyShared: false, referenceCount: "1", hasRecommendedBudget: false } },
          { campaign: CAMPAIGNS[1], campaignBudget: { id: "902", name: "Shared generic", amountMicros: "5000000000", period: "DAILY",
            deliveryMethod: "STANDARD", explicitlyShared: true, referenceCount: "2", hasRecommendedBudget: true,
            recommendedBudgetAmountMicros: "8000000000" } },
          { campaign: CAMPAIGNS[2], campaignBudget: { id: "902", name: "Shared generic", amountMicros: "5000000000", period: "DAILY",
            deliveryMethod: "STANDARD", explicitlyShared: true, referenceCount: "2", hasRecommendedBudget: false } }
        ]);
      }
      if (/segments\.date DURING (TODAY|YESTERDAY|LAST_7_DAYS|THIS_MONTH|LAST_MONTH)/.test(q)) {
        var range = q.match(/DURING (\w+)/)[1];
        var f = { TODAY: 0.5, YESTERDAY: 1, LAST_7_DAYS: 7, THIS_MONTH: 26, LAST_MONTH: 30 }[range];
        return iter([
          { campaign: { id: "11" }, metrics: { costMicros: String(Math.round(900000000 * f)), clicks: String(20 * f), conversions: 4 * f, conversionsValue: 0 } },
          { campaign: { id: "12" }, metrics: { costMicros: String(Math.round(4000000000 * f)), clicks: String(30 * f), conversions: 3 * f, conversionsValue: 0 } }
        ]);
      }
      if (/FROM customer/.test(q)) return iter([{ metrics: { costMicros: cid === "222-222-2222" ? "900" : "100" } }]);
      if (/FROM campaign WHERE segments\.date DURING LAST_30_DAYS/.test(q)) {
        return iter([
          { campaign: CAMPAIGNS[0], metrics: { impressions: "4000", clicks: "800", costMicros: "27000000000", conversions: 160, conversionsValue: 0,
            searchImpressionShare: 0.92, searchTopImpressionShare: 0.9, searchAbsoluteTopImpressionShare: 0.75,
            searchBudgetLostImpressionShare: 0, searchRankLostImpressionShare: 0.08,
            searchBudgetLostTopImpressionShare: 0, searchRankLostTopImpressionShare: 0.1,
            searchBudgetLostAbsoluteTopImpressionShare: 0, searchRankLostAbsoluteTopImpressionShare: 0.25,
            searchClickShare: 0.8, searchExactMatchImpressionShare: 0.97 } },
          { campaign: CAMPAIGNS[1], metrics: { impressions: "20000", clicks: "900", costMicros: "120000000000", conversions: 90, conversionsValue: 0,
            searchImpressionShare: 0.0999, searchTopImpressionShare: 0.0999, searchAbsoluteTopImpressionShare: 0.0999,
            searchBudgetLostImpressionShare: 0.9001, searchRankLostImpressionShare: 0.05,
            searchClickShare: 0.0999, searchExactMatchImpressionShare: 0.3 } },
          { campaign: CAMPAIGNS[2], metrics: { impressions: "90000", clicks: "700", costMicros: "30000000000", conversions: 40, conversionsValue: 0 } }
        ]);
      }
      throw new Error("unexpected query: " + q);
    },
    currentAccount: function () {
      return { getName: function () { return name; }, getCustomerId: function () { return cid; },
               getTimeZone: function () { return "Asia/Kolkata"; }, getCurrencyCode: function () { return "INR"; } };
    }
  };
}

var ACCOUNTS = [["111-111-1111", "Acme"], ["222-222-2222", "Beta"]];
var current = account(ACCOUNTS[0][0], ACCOUNTS[0][1]);
var AdsApp = {
  search: function (q) { return current.search(q); },
  currentAccount: function () { return current.currentAccount(); }
};

var tabs = {}, order = ["Campaign report"];
var ss = {
  getSheetByName: function (n) { return tabs[n] ? sheet(n) : null; },
  insertSheet: function (n, idx) { tabs[n] = []; order.splice(idx, 0, n); return sheet(n); },
  getNumSheets: function () { return order.length; },
  getSpreadsheetTimeZone: function () { return "Asia/Kolkata"; }
};
function sheet(n) {
  return {
    clearContents: function () { tabs[n] = []; },
    getRange: function (r, c, h, w) {
      return { setValues: function (v) {
        if (v.length !== h || v.some(function (row) { return row.length !== w; })) throw new Error("range size mismatch in " + n);
        tabs[n] = JSON.parse(JSON.stringify(v));
      } };
    },
    setFrozenRows: function () {}
  };
}

var sandbox = {
  AdsApp: AdsApp,
  SpreadsheetApp: { openByUrl: function () { return ss; } },
  Utilities: {
    formatDate: function (d, tz, fmt) {
      var fixed = new Date(Date.UTC(2026, 8, 27, 10, 30));   // 27 Sep 2026, 10:30 in the account's zone
      var p = { yyyy: "2026", MM: "09", dd: "27", HH: "10", mm: "30" };
      if (fmt === "d") return "27";
      if (fmt === "H") return "10";
      if (fmt === "m") return "30";
      if (fmt === "M") return "9";
      if (fmt === "yyyy") return "2026";
      if (fmt === "yyyy-MM-dd") {
        var x = d.getTime() > fixed.getTime() - 86400000 ? fixed : d;
        return x.toISOString().slice(0, 10);
      }
      return fmt.replace(/yyyy|MM|dd|HH|mm/g, function (k) { return p[k]; });
    }
  },
  Logger: { log: function () {} },
  JSON: JSON, Math: Math, Number: Number, String: String, Date: Date, Object: Object, Error: Error
};
if (manager) {
  sandbox.AdsManagerApp = {
    accounts: function () {
      var ids = null;
      var sel = {
        withIds: function (x) { ids = x; return sel; },
        get: function () {
          return iter(ACCOUNTS.filter(function (a) { return !ids || ids.indexOf(a[0]) >= 0; }).map(function (a) {
            return { getCustomerId: function () { return a[0]; }, getName: function () { return a[1]; } };
          }));
        },
        executeInParallel: function (fn, cb) {
          var results = ACCOUNTS.filter(function (a) { return !ids || ids.indexOf(a[0]) >= 0; }).map(function (a) {
            current = account(a[0], a[1]);
            var v = vm.runInContext(fn + "()", sandbox);
            return { getStatus: function () { return "OK"; }, getReturnValue: function () { return v; },
                     getCustomerId: function () { return a[0]; }, getError: function () { return null; } };
          });
          vm.runInContext(cb + "(__results)", Object.assign(sandbox, { __results: results }));
        }
      };
      return sel;
    },
    select: function (a) { current = account(a.getCustomerId(), a.getName()); }
  };
  sandbox.MAX_OVERRIDE = true;
}
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
if (manager) vm.runInContext("MAX_ACCOUNTS = 1;", sandbox);
vm.runInContext("main()", sandbox);
process.stdout.write(JSON.stringify({ tabs: tabs, order: order, queries: queries.length }));
