// ── Volume-data provider selector ─────────────────────────────────────────────
// Chooses which data source backs a comparison. SEMrush is the current default
// (templated method) whenever a key is present; DataForSEO (geo-accurate Method A)
// stays available via MARKET_POTENTIAL_PROVIDER=dataforseo. Both expose the same
// fetchRegionVolume(terms, geo) contract.
//
//   MARKET_POTENTIAL_PROVIDER = semrush | dataforseo   (optional override)

const semrush = require('./semrush');
const dataforseo = require('./dataForSeo');

function getProvider() {
  const forced = (process.env.MARKET_POTENTIAL_PROVIDER || '').toLowerCase();
  if (forced === 'semrush') return semrush;
  if (forced === 'dataforseo') return dataforseo;
  // Auto: prefer SEMrush when its key is configured (current default), else DFS
  // (which self-falls-back to deterministic demo data when it has no credentials).
  if (semrush.hasKey()) return semrush;
  return dataforseo;
}

// Whether the active provider bills in SEMrush API units (→ caps apply).
function unitTrackingActive() {
  const p = getProvider();
  return p.name === 'semrush' && semrush.hasKey();
}

module.exports = { getProvider, unitTrackingActive };
