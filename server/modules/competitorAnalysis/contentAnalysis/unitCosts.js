const { UNITS_PER_LINE } = require('../unitCosts');

// getTopPages (services/semrushCA.js) always requests 200 rows internally
// (display_limit: 200) to aggregate down to the top 10 pages by traffic —
// the SEMrush cost is for the 200 rows fetched, not the 10 returned.
const TOP_PAGES_ROWS = 200;
const TOP_PAGES_COST = TOP_PAGES_ROWS * UNITS_PER_LINE; // 2,000 units/domain

// Content Analysis runs as its own action, separate from the main dashboard
// "Run Analysis" — it gets its own independent per-run budget rather than
// sharing (or competing with) the dashboard's 10,000-unit cap.
const MAX_UNITS_PER_RUN = 10000;

function maxDomainsForBudget(capUnits = MAX_UNITS_PER_RUN) {
  return Math.max(1, Math.floor(capUnits / TOP_PAGES_COST));
}

module.exports = { TOP_PAGES_COST, MAX_UNITS_PER_RUN, maxDomainsForBudget };
