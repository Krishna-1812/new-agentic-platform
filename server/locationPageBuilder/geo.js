// ── Geo expansion: city → metro → county → state (Spec §6 Stage 2) ──────────
// The spec calls for a geo dataset (GeoNames/census) rather than a hand table.
// To keep the module self-contained and dependency-free for v1, this ships a
// compact California-focused map (the first client's footprint) with a graceful
// fallback. Swap getGeo() for a GeoNames/census lookup later without touching
// callers — the contract is { city, metro, county, region, state, stateAbbr }.

const CA_GEO = {
  'beverly hills':    { metro: 'Los Angeles', county: 'Los Angeles County', region: 'Westside Los Angeles' },
  'santa monica':     { metro: 'Los Angeles', county: 'Los Angeles County', region: 'Westside Los Angeles' },
  'pasadena':         { metro: 'Los Angeles', county: 'Los Angeles County', region: 'San Gabriel Valley' },
  'brea':             { metro: 'Los Angeles', county: 'Orange County',      region: 'North Orange County' },
  'westlake village': { metro: 'Los Angeles', county: 'Los Angeles County', region: 'Conejo Valley' },
  'fresno':           { metro: 'Fresno',      county: 'Fresno County',      region: 'Central Valley' },
  'sacramento':       { metro: 'Sacramento',  county: 'Sacramento County',  region: 'Greater Sacramento' },
  'manhattan beach':  { metro: 'Los Angeles', county: 'Los Angeles County', region: 'South Bay' },
  'torrance':         { metro: 'Los Angeles', county: 'Los Angeles County', region: 'South Bay' },
  'marina del rey':   { metro: 'Los Angeles', county: 'Los Angeles County', region: 'Westside Los Angeles' },
  'long beach':       { metro: 'Los Angeles', county: 'Los Angeles County', region: 'South Bay / Harbor' },
  'encino':           { metro: 'Los Angeles', county: 'Los Angeles County', region: 'San Fernando Valley' },
  'lake forest':      { metro: 'Los Angeles', county: 'Orange County',      region: 'South Orange County' },

  // ── Clear Behavioral Health's footprint ──────────────────────────────────
  // Without an entry, getGeo degrades silently: metro falls back to the city
  // itself and region to empty, so generateSeeds emits a duplicate of
  // "{service} {city}" instead of a metro seed and skips the region seed
  // entirely — a narrower SERP pull with no error to show for it.
  'los angeles':      { metro: 'Los Angeles', county: 'Los Angeles County', region: 'Los Angeles' },
  'redondo beach':    { metro: 'Los Angeles', county: 'Los Angeles County', region: 'South Bay' },
  'gardena':          { metro: 'Los Angeles', county: 'Los Angeles County', region: 'South Bay' },
  'el segundo':       { metro: 'Los Angeles', county: 'Los Angeles County', region: 'South Bay' },
  'el monte':         { metro: 'Los Angeles', county: 'Los Angeles County', region: 'San Gabriel Valley' },
  'van nuys':         { metro: 'Los Angeles', county: 'Los Angeles County', region: 'San Fernando Valley' },
  'santa clarita':    { metro: 'Los Angeles', county: 'Los Angeles County', region: 'Santa Clarita Valley' },
  'anaheim hills':    { metro: 'Los Angeles', county: 'Orange County',      region: 'North Orange County' },
  // Not a city — a region the client runs an office under. Its own name is
  // therefore both city and region, which keeps the region seed from
  // duplicating the city one.
  'south bay':        { metro: 'Los Angeles', county: 'Los Angeles County', region: 'South Bay' },
};

function getGeo({ city, state = 'California', stateAbbreviation = 'CA' }) {
  const key = (city || '').trim().toLowerCase();
  const hit = CA_GEO[key] || {};
  return {
    city: city || '',
    metro: hit.metro || city || '',
    county: hit.county || '',
    region: hit.region || hit.metro || '',
    state,
    stateAbbr: stateAbbreviation,
  };
}

module.exports = { getGeo, CA_GEO };
