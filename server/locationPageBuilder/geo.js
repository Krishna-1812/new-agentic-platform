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
