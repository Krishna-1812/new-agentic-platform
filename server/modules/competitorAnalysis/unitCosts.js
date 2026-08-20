// Per-domain SEMrush unit cost model, calibrated against SEMrush's actual
// published per-report pricing (confirmed against the live API — see
// developer.semrush.com/api/seo/domain-reports/ and .../analytics/backlinks/):
//   - domain_rank / domain_organic report lines: 10 API units PER LINE
//   - backlinks_overview: 45 API units FLAT per request, regardless of rows
// An earlier version of this file assumed 1 unit per row across the board —
// that undercounted real spend by ~10x. Row limits below are chosen so a
// full run (client + 4 competitors, the store.js MAX_COMPETITORS cap) fits
// under the 10,000-unit hard cap with real SEMrush data.

const UNITS_PER_LINE = 10;          // domain_rank & domain_organic report lines
const BACKLINKS_OVERVIEW_COST = 45; // flat, independent of row count

// Row limits actually passed to the SEMrush API calls — kept separate from
// COSTS so the real provider always requests exactly what the budget below
// assumes it will pay for.
const ROW_LIMITS = {
  keywordsFull: 100,        // top 100 keywords by volume — position-bucket sample
  aioKeywords: 50,          // AI-Overview keyword count (capped)
};

const COSTS = {
  domainRank: 1 * UNITS_PER_LINE,
  backlinksOverview: BACKLINKS_OVERVIEW_COST,
  keywordsFull: ROW_LIMITS.keywordsFull * UNITS_PER_LINE,
  aioKeywords: ROW_LIMITS.aioKeywords * UNITS_PER_LINE,
};

const PER_DOMAIN_COST = Object.values(COSTS).reduce((a, b) => a + b, 0);

// The hard, non-negotiable ceiling for a single run (client + competitors).
const MAX_UNITS_PER_RUN = 10000;

function estimateDomainCost() {
  return PER_DOMAIN_COST;
}

function maxDomainsForBudget(capUnits = MAX_UNITS_PER_RUN) {
  return Math.max(1, Math.floor(capUnits / PER_DOMAIN_COST));
}

// ── Discovery (one-time, per client — not per analysis run) ─────────────────
// domain_organic_organic (the discovery report) is in the same domain_organic
// report family as domain_rank/domain_organic — same 10-units-per-line model.
// This is spent once when a user clicks "Find Competitors For Me", not on
// every /run, so it's tracked and surfaced separately from
// MAX_UNITS_PER_RUN / PER_DOMAIN_COST rather than folded into either.
const DISCOVERY_DISPLAY_LIMIT = 20; // rows requested
const DISCOVERY_COST = DISCOVERY_DISPLAY_LIMIT * UNITS_PER_LINE; // 200 units, worst case

function estimateDiscoveryCost() {
  return DISCOVERY_COST;
}

module.exports = {
  COSTS, ROW_LIMITS, UNITS_PER_LINE, PER_DOMAIN_COST, MAX_UNITS_PER_RUN,
  estimateDomainCost, maxDomainsForBudget,
  DISCOVERY_DISPLAY_LIMIT, DISCOVERY_COST, estimateDiscoveryCost,
};
