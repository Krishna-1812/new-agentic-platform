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
      if (/FROM change_event/.test(q)) {
        if (!/change_date_time <= '\d{4}-\d{2}-\d{2}' AND change_event\.change_date_time >= '\d{4}-\d{2}-\d{2}'/.test(q) || !/LIMIT \d+$/.test(q)) {
          throw new Error("change_event needs a date window and a LIMIT: " + q);
        }
        return iter([
          { changeEvent: { changeDateTime: "2026-09-25 14:03:11.123456", changeResourceType: "CAMPAIGN_BUDGET",
              changeResourceName: "customers/1/campaignBudgets/902", resourceChangeOperation: "UPDATE",
              changedFields: "amount_micros", userEmail: "ops@example.com", clientType: "GOOGLE_ADS_WEB_CLIENT",
              oldResource: { campaignBudget: { amountMicros: "5000000000" } },
              newResource: { campaignBudget: { amountMicros: "8000000000" } } },
            campaign: { id: "12", name: "Generic - Search" } },
          { changeEvent: { changeDateTime: "2026-09-20 09:00:00", changeResourceType: "CAMPAIGN",
              changeResourceName: "customers/1/campaigns/11", resourceChangeOperation: "UPDATE",
              changedFields: { paths: ["status", "target_impression_share.location_fraction_micros"] },
              userEmail: "", clientType: "GOOGLE_ADS_RECOMMENDATIONS",
              oldResource: { campaign: { status: "PAUSED", targetImpressionShare: { locationFractionMicros: "500000" } } },
              newResource: { campaign: { status: "ENABLED", targetImpressionShare: { locationFractionMicros: "900000" } } } },
            campaign: { id: "11", name: "Brand - Search" } },
          { changeEvent: { changeDateTime: "2026-09-18 11:30:00", changeResourceType: "AD_GROUP_CRITERION",
              changeResourceName: "customers/1/adGroupCriteria/31~7009", resourceChangeOperation: "CREATE",
              changedFields: "keyword.text,keyword.match_type,status", userEmail: "ops@example.com", clientType: "GOOGLE_ADS_RECOMMENDATIONS_SUBSCRIPTION",
              newResource: { adGroupCriterion: { keyword: { text: "crm for startups", matchType: "PHRASE" }, status: "ENABLED" } } },
            campaign: { id: "12", name: "Generic - Search" }, adGroup: { name: "CRM" } }
        ]);
      }
      if (/FROM recommendation/.test(q)) {
        return iter([
          { recommendation: { type: "CAMPAIGN_BUDGET", campaign: "customers/1/campaigns/12",
              campaignBudgetRecommendation: { currentBudgetAmountMicros: "5000000000", recommendedBudgetAmountMicros: "8000000000" },
              impact: { baseMetrics: { impressions: 4000, clicks: 180, costMicros: "35000000000", conversions: 18, conversionsValue: 0 },
                        potentialMetrics: { impressions: 6200, clicks: 260, costMicros: "56000000000", conversions: 26, conversionsValue: 0 } } } },
          { recommendation: { type: "KEYWORD", campaign: "customers/1/campaigns/12",
              keywordRecommendation: { keyword: { text: "crm pricing", matchType: "PHRASE" } },
              impact: { baseMetrics: { impressions: 4000, clicks: 180 }, potentialMetrics: { impressions: 4300, clicks: 195 } } } },
          { recommendation: { type: "RESPONSIVE_SEARCH_AD_ASSET" } }
        ]);
      }
      if (/customer\.optimization_score/.test(q)) {
        return iter([{ customer: { optimizationScore: 0.72, optimizationScoreWeight: 3.5 } }]);
      }
      if (/campaign\.optimization_score/.test(q)) {
        return iter(CAMPAIGNS.map(function (c, i) {
          return { campaign: Object.assign({}, c, { optimizationScore: [0.95, 0.61, undefined][i] }) };
        }));
      }
      if (/FROM campaign WHERE campaign\.status != 'REMOVED' AND segments\.date DURING LAST_30_DAYS/.test(q)) {
        return iter([
          { campaign: { id: "11" }, metrics: { costMicros: "27000000000", conversions: 160 } },
          { campaign: { id: "12" }, metrics: { costMicros: "120000000000", conversions: 90 } },
          { campaign: { id: "13" }, metrics: { costMicros: "30000000000", conversions: 40 } }
        ]);
      }
      if (/FROM age_range_view/.test(q)) {
        return iter([
          { campaign: CAMPAIGNS[1], adGroupCriterion: { ageRange: { type: "AGE_RANGE_25_34" } },
            metrics: { impressions: "6000", clicks: "300", costMicros: "40000000000", conversions: 30, conversionsValue: 0 } },
          { campaign: CAMPAIGNS[1], adGroupCriterion: { ageRange: { type: "AGE_RANGE_25_34" } },
            metrics: { impressions: "1000", clicks: "50", costMicros: "5000000000", conversions: 5, conversionsValue: 0 } },
          { campaign: CAMPAIGNS[1], adGroupCriterion: { ageRange: { type: "AGE_RANGE_65_UP" } },
            metrics: { impressions: "2000", clicks: "40", costMicros: "20000000000", conversions: 0, conversionsValue: 0 } }
        ]);
      }
      if (/FROM gender_view/.test(q)) {
        return iter([
          { campaign: CAMPAIGNS[1], adGroupCriterion: { gender: { type: "FEMALE" } },
            metrics: { impressions: "7000", clicks: "350", costMicros: "50000000000", conversions: 40, conversionsValue: 0 } },
          { campaign: CAMPAIGNS[1], adGroupCriterion: { gender: { type: "MALE" } },
            metrics: { impressions: "6000", clicks: "250", costMicros: "45000000000", conversions: 20, conversionsValue: 0 } }
        ]);
      }
      if (/FROM landing_page_view/.test(q)) {
        return iter([
          { landingPageView: { unexpandedFinalUrl: "https://example.com/crm" },
            metrics: { speedScore: "3", mobileFriendlyClicksPercentage: 0.62, validAcceleratedMobilePagesClicksPercentage: 0,
                       impressions: "20000", clicks: "900", costMicros: "120000000000", conversions: 90, conversionsValue: 0 } },
          { landingPageView: { unexpandedFinalUrl: "https://example.com/" },
            metrics: { speedScore: "8", mobileFriendlyClicksPercentage: 1,
                       impressions: "4000", clicks: "800", costMicros: "27000000000", conversions: 160, conversionsValue: 0 } }
        ]);
      }
      if (/FROM ad_group_ad_asset_combination_view/.test(q)) {
        return iter([
          { campaign: { name: "Generic - Search" }, adGroup: { id: "31", name: "CRM" }, adGroupAd: { ad: { id: "801" } },
            adGroupAdAssetCombinationView: { servedAssets: [
              { asset: "customers/1/assets/1", servedAssetFieldType: "HEADLINE_1" },
              { asset: "customers/1/assets/2", servedAssetFieldType: "HEADLINE_2" },
              { asset: "customers/1/assets/5", servedAssetFieldType: "DESCRIPTION_1" }] },
            metrics: { impressions: "700" } },
          { campaign: { name: "Generic - Search" }, adGroup: { id: "31", name: "CRM" }, adGroupAd: { ad: { id: "801" } },
            adGroupAdAssetCombinationView: { servedAssets: [
              { asset: "customers/1/assets/2", servedAssetFieldType: "HEADLINE_1" },
              { asset: "customers/1/assets/3", servedAssetFieldType: "HEADLINE_2" }] },
            metrics: { impressions: "1200" } }
        ]);
      }
      if (/FROM asset_group_top_combination_view/.test(q)) {
        return iter([
          { campaign: { name: "PMax - All" }, assetGroup: { id: "91", name: "All products" },
            assetGroupTopCombinationView: { resourceName: "customers/1/assetGroupTopCombinationViews/91~IMAGE",
              assetGroupTopCombinations: [{ assetCombinationServedAssets: [
                { asset: "customers/1/assets/9", servedAssetFieldType: "MARKETING_IMAGE" },
                { asset: "customers/1/assets/1", servedAssetFieldType: "HEADLINE" }] }] } }
        ]);
      }
      if (/FROM asset WHERE/.test(q)) {
        var known = { "customers/1/assets/1": { textAsset: { text: "Free CRM Trial" } },
                      "customers/1/assets/2": { textAsset: { text: "Rated #1 by Users" } },
                      "customers/1/assets/3": { textAsset: { text: "Start in 5 Minutes" } },
                      "customers/1/assets/5": { textAsset: { text: "No credit card needed." } },
                      "customers/1/assets/9": { imageAsset: { fullSize: { url: "https://tpc.googlesyndication.com/simgad/123" } } } };
        return iter(Object.keys(known).filter(function (k) { return q.indexOf("'" + k + "'") > -1; })
          .map(function (k) { return { asset: Object.assign({ resourceName: k }, known[k]) }; }));
      }
      if (/FROM ad_group_ad_asset_view/.test(q)) {
        return iter([
          { campaign: { name: "Generic - Search" }, adGroup: { id: "31", name: "CRM" }, adGroupAd: { ad: { id: "801" } },
            adGroupAdAssetView: { fieldType: "HEADLINE", pinnedField: "HEADLINE_1", performanceLabel: "BEST", enabled: true },
            asset: { textAsset: { text: "Free CRM Trial" } },
            metrics: { impressions: "700", clicks: "60", costMicros: "3000000000", conversions: 4 } },
          { campaign: { name: "Generic - Search" }, adGroup: { id: "31", name: "CRM" }, adGroupAd: { ad: { id: "801" } },
            adGroupAdAssetView: { fieldType: "DESCRIPTION", performanceLabel: "LOW", enabled: true },
            asset: { textAsset: { text: "No credit card needed." } },
            metrics: { impressions: "650", clicks: "20", costMicros: "900000000", conversions: 0 } }
        ]);
      }
      if (/FROM asset_group WHERE/.test(q)) {
        if (/metrics\./.test(q)) return iter([{ assetGroup: { id: "91" }, metrics: { impressions: "9000", clicks: "300", costMicros: "30000000000", conversions: 20, conversionsValue: 0 } }]);
        return iter([{ campaign: CAMPAIGNS[2], assetGroup: { id: "91", name: "All products", status: "ENABLED", primaryStatus: "ELIGIBLE",
          adStrength: "GOOD", finalUrls: ["https://example.com/"] } }]);
      }
      if (/FROM ad_group_ad WHERE/.test(q)) {
        if (/metrics\./.test(q)) return iter([{ adGroup: { id: "31" }, adGroupAd: { ad: { id: "801" } },
          metrics: { impressions: "1900", clicks: "150", costMicros: "9000000000", conversions: 6, conversionsValue: 0 } }]);
        return iter([
          { campaign: CAMPAIGNS[1], adGroup: { id: "31", name: "CRM" },
            adGroupAd: { status: "ENABLED", primaryStatus: "ELIGIBLE", adStrength: "AVERAGE",
              policySummary: { approvalStatus: "APPROVED", reviewStatus: "REVIEWED" },
              ad: { id: "801", type: "RESPONSIVE_SEARCH_AD", finalUrls: ["https://example.com/crm"],
                responsiveSearchAd: { path1: "crm", path2: "trial",
                  headlines: [{ text: "Free CRM Trial", pinnedField: "HEADLINE_1" }, { text: "Rated #1 by Users" }, { text: "Start in 5 Minutes" }],
                  descriptions: [{ text: "No credit card needed." }, { text: "Set up in minutes." }] } } } },
          { campaign: CAMPAIGNS[0], adGroup: { id: "32", name: "Brand" },
            adGroupAd: { status: "ENABLED", primaryStatus: "NOT_ELIGIBLE", adStrength: "POOR",
              policySummary: { approvalStatus: "DISAPPROVED", reviewStatus: "REVIEWED",
                policyTopicEntries: [{ topic: "TRADEMARKS_IN_AD_TEXT", type: "PROHIBITED" }] },
              ad: { id: "802", type: "RESPONSIVE_SEARCH_AD", finalUrls: ["https://example.com/"],
                responsiveSearchAd: { headlines: [{ text: name }], descriptions: [{ text: "Official site." }] } } } }
        ]);
      }
      if (/FROM keyword_view/.test(q)) {
        return iter([
          { campaign: { id: "12", name: "Generic - Search" }, adGroup: { name: "CRM" },
            adGroupCriterion: { criterionId: "7001", status: "ENABLED", systemServingStatus: "ELIGIBLE",
              keyword: { text: "crm software", matchType: "BROAD" },
              qualityInfo: { qualityScore: 4, searchPredictedCtr: "BELOW_AVERAGE", creativeQualityScore: "AVERAGE",
                             postClickQualityScore: "BELOW_AVERAGE" },
              effectiveCpcBidMicros: "40000000", positionEstimates: { firstPageCpcMicros: "55000000", topOfPageCpcMicros: "90000000" } },
            metrics: { impressions: "5000", clicks: "250", costMicros: "11000000000", conversions: 3, conversionsValue: 0,
                       searchImpressionShare: 0.35, searchRankLostImpressionShare: 0.5 } },
          { campaign: { id: "11", name: "Brand - Search" }, adGroup: { name: "Brand" },
            adGroupCriterion: { criterionId: "7002", status: "ENABLED", systemServingStatus: "ELIGIBLE",
              keyword: { text: name.toLowerCase(), matchType: "EXACT" }, qualityInfo: {} },
            metrics: { impressions: "900", clicks: "300", costMicros: "900000000", conversions: 40, conversionsValue: 0 } }
        ]);
      }
      if (/FROM geo_target_constant/.test(q)) {
        var known = { "geoTargetConstants/2356": "India", "geoTargetConstants/20465": "Maharashtra",
                      "geoTargetConstants/1007785": "Mumbai" };
        return iter(Object.keys(known).filter(function (k) { return q.indexOf(k) > -1; })
          .map(function (k) { return { geoTargetConstant: { resourceName: k, name: known[k] } }; }));
      }
      if (/FROM geographic_view/.test(q)) {
        return iter([
          { geographicView: { locationType: "LOCATION_OF_PRESENCE", countryCriterionId: "2356" },
            segments: { geoTargetRegion: "geoTargetConstants/20465", geoTargetCity: "geoTargetConstants/1007785" },
            metrics: { impressions: "3000", clicks: "120", costMicros: "6000000000", conversions: 5, conversionsValue: 0 } },
          { geographicView: { locationType: "AREA_OF_INTEREST", countryCriterionId: "2356" },
            segments: { geoTargetRegion: "geoTargetConstants/99999" },
            metrics: { impressions: "800", clicks: "20", costMicros: "700000000", conversions: 0, conversionsValue: 0 } }
        ]);
      }
      if (/FROM conversion_action/.test(q)) {
        return iter([
          { conversionAction: { id: "501", name: "Lead form", category: "SUBMIT_LEAD_FORM", status: "ENABLED", type: "WEBPAGE",
            origin: "WEBSITE", primaryForGoal: true, includeInConversionsMetric: true, countingType: "MANY_PER_CLICK",
            clickThroughLookbackWindowDays: "30", viewThroughLookbackWindowDays: "1",
            valueSettings: { defaultValue: 1, alwaysUseDefaultValue: false }, attributionModelSettings: { attributionModel: "GOOGLE_SEARCH_ATTRIBUTION_DATA_DRIVEN" } } },
          { conversionAction: { id: "502", name: "Pricing page view", category: "PAGE_VIEW", status: "ENABLED", type: "WEBPAGE",
            origin: "WEBSITE", primaryForGoal: true, includeInConversionsMetric: true, countingType: "ONE_PER_CLICK",
            clickThroughLookbackWindowDays: "30", viewThroughLookbackWindowDays: "1", valueSettings: {} } }
        ]);
      }
      if (/segments\.conversion_action_name/.test(q)) {
        return iter([
          { campaign: { id: "12", name: "Generic - Search" },
            segments: { conversionActionName: "Lead form", conversionActionCategory: "SUBMIT_LEAD_FORM" },
            metrics: { conversions: 60, conversionsValue: 60, allConversions: 64, allConversionsValue: 64 } },
          { campaign: { id: "12", name: "Generic - Search" },
            segments: { conversionActionName: "Pricing page view", conversionActionCategory: "PAGE_VIEW" },
            metrics: { conversions: 30, conversionsValue: 0, allConversions: 30, allConversionsValue: 0 } }
        ]);
      }
      if (/segments\.day_of_week/.test(q)) {
        return iter([
          { segments: { dayOfWeek: "MONDAY", hour: 10 }, metrics: { impressions: "900", clicks: "40", costMicros: "2000000000", conversions: 4, conversionsValue: 0 } },
          { segments: { dayOfWeek: "SUNDAY", hour: 2 }, metrics: { impressions: "90", clicks: "3", costMicros: "150000000", conversions: 0, conversionsValue: 0 } }
        ]);
      }
      if (/segments\.device/.test(q)) {
        return iter([
          { campaign: CAMPAIGNS[1], segments: { device: "MOBILE" }, metrics: { impressions: "15000", clicks: "600", costMicros: "80000000000", conversions: 40, conversionsValue: 0 } },
          { campaign: CAMPAIGNS[1], segments: { device: "DESKTOP" }, metrics: { impressions: "5000", clicks: "300", costMicros: "40000000000", conversions: 50, conversionsValue: 0 } }
        ]);
      }
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
