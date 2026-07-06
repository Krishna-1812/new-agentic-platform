// Live SEMrush-backed provider. Same fetchDomainData(domain, ctx, opts)
// signature as mockProvider.js, so dataFetcher.js's per-run budget guard
// (unitCosts.js, hard-capped at 10,000 units/run) governs real spend
// exactly the way it already governed simulated spend — nothing about the
// budget logic changes when this provider is active instead of the mock.
const semrush = require('../../services/semrushCA');
const { ROW_LIMITS } = require('./unitCosts');

// No shared pool needed — unlike the mock, real SEMrush data naturally
// overlaps across domains (they're all real keyword/backlink universes).
function createRunContext() {
  return {};
}

async function fetchDomainData(domain, ctx, { database = 'us', brandName } = {}) {
  const [domainRank, backlinksOverview, keywords, aio, brandedCount] = await Promise.all([
    semrush.getDomainRank(domain, database).catch(() => null),
    semrush.getBacklinksOverview(domain).catch(() => null),
    semrush.getKeywordsFull(domain, database, ROW_LIMITS.keywordsFull, 'nq_desc').catch(() => []),
    semrush.getAIOKeywords(domain, database, ROW_LIMITS.aioKeywords).catch(() => ({ count: 0, keywords: [] })),
    brandName
      ? semrush.getBrandedKeywordCount(domain, database, brandName, ROW_LIMITS.brandedKeywordCount).catch(() => 0)
      : Promise.resolve(0),
  ]);

  const organicKeywords = domainRank?.organicKeywords || 0;
  const brandedKeywordCount = brandedCount || 0;

  return {
    domain,
    domainRank: {
      organicKeywords,
      organicTraffic: domainRank?.organicTraffic || 0,
    },
    authorityScore: backlinksOverview?.authorityScore || 0,
    backlinks: {
      totalBacklinks: backlinksOverview?.totalBacklinks || 0,
      referringDomains: backlinksOverview?.referringDomains || 0,
      followLinks: backlinksOverview?.followLinks || 0,
      nofollowLinks: backlinksOverview?.nofollowLinks || 0,
    },
    keywords,
    aioKeywordCount: aio?.count || 0,
    brandedKeywordCount,
    brandedKeywordCountCapped: brandedKeywordCount >= ROW_LIMITS.brandedKeywordCount,
    nonBrandedKeywordCount: Math.max(0, organicKeywords - brandedKeywordCount),
    // Not a SEMrush data point — Google PageSpeed Insights is a separate,
    // unwired integration. Leave null rather than fabricate numbers next
    // to real SEMrush data; the UI shows "not available" for this domain.
    pageSpeed: null,
  };
}

module.exports = { createRunContext, fetchDomainData };
