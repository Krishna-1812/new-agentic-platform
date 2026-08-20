// Live SEMrush-backed provider. Same fetchDomainData(domain, ctx, opts)
// signature as mockProvider.js, so dataFetcher.js's per-run budget guard
// (unitCosts.js, hard-capped at 10,000 units/run) governs real spend
// exactly the way it already governed simulated spend — nothing about the
// budget logic changes when this provider is active instead of the mock.
const semrush = require('../../services/semrushCA');
const { ROW_LIMITS } = require('./unitCosts');

const RETRY_DELAY_MS = 800;

// No shared pool needed — unlike the mock, real SEMrush data naturally
// overlaps across domains (they're all real keyword/backlink universes).
function createRunContext() {
  return {};
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One retry survives the transient network/rate-limit blips SEMrush
// occasionally returns. A call that still fails after the retry is recorded
// in `errors` (by label) instead of being silently swallowed — a domain that
// genuinely has zero backlinks and a domain whose fetch failed must not look
// identical to the UI, or a real outage reads as "this competitor has no
// backlinks" instead of "we don't actually know."
async function withRetry(fn, label, errors) {
  try {
    return await fn();
  } catch {
    await sleep(RETRY_DELAY_MS);
    try {
      return await fn();
    } catch (err) {
      errors.push(label);
      console.error(`[CompetitorAnalysis] ${label} failed twice:`, err.message);
      return null;
    }
  }
}

async function fetchDomainData(domain, ctx, { database = 'us' } = {}) {
  const fetchErrors = [];

  const [domainRank, backlinksOverview, keywords, aio] = await Promise.all([
    withRetry(() => semrush.getDomainRank(domain, database), 'domainRank', fetchErrors),
    withRetry(() => semrush.getBacklinksOverview(domain), 'backlinksOverview', fetchErrors),
    withRetry(() => semrush.getKeywordsFull(domain, database, ROW_LIMITS.keywordsFull, 'nq_desc'), 'keywords', fetchErrors).then((r) => r || []),
    withRetry(() => semrush.getAIOKeywords(domain, database, ROW_LIMITS.aioKeywords), 'aioKeywords', fetchErrors).then((r) => r || { count: 0, keywords: [] }),
  ]);

  const organicKeywords = domainRank?.organicKeywords || 0;

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
    // Empty array means every call succeeded. Non-empty names exactly which
    // fields are unverified zeroes rather than confirmed data — see UI badge.
    fetchErrors,
    // Not a SEMrush data point. dataFetcher.js resolves the real `pageSpeed`
    // field (batched, cached, and independent of this per-domain call) and
    // overwrites whatever's returned here — see resolvePageSpeed().
  };
}

module.exports = { createRunContext, fetchDomainData };
