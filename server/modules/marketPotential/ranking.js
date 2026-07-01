// ── Adjacency (Section 10, Step 2) ────────────────────────────────────────────
// Haversine distance between metro centroids → nearest N within a radius.
// Pure geometry, zero API calls. (Drive-time is a deferred upgrade, Section 12.)

function haversineMiles(a, b) {
  const R = 3958.8; // Earth radius, miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// homeGeos: array of geo_constants; allGeos: every candidate. Returns suggestions
// (excluding the home set) sorted nearest-first, within radiusMiles, capped to limit.
function suggestAdjacent(homeGeos, allGeos, { radiusMiles = 350, limit = 8 } = {}) {
  const homeIds = new Set(homeGeos.map((g) => g.id));
  const homePts = homeGeos.map((g) => ({ lat: g.centroidLat, lng: g.centroidLng }));

  const scored = allGeos
    .filter((g) => !homeIds.has(g.id))
    .map((g) => {
      // distance to the NEAREST home market (handles multi-home entries)
      const dist = Math.min(...homePts.map((h) => haversineMiles(h, { lat: g.centroidLat, lng: g.centroidLng })));
      return { geo: g, distanceMiles: Math.round(dist) };
    })
    .filter((s) => s.distanceMiles <= radiusMiles)
    .sort((a, b) => a.distanceMiles - b.distanceMiles);

  return scored.slice(0, limit);
}

// ── Ranking (Section 10, Step 4) ──────────────────────────────────────────────
// Rank by summed commercial cluster volume (un-templated terms only). Index to
// home = 100. Per-capita / CPC / competition / trend are COLUMNS, not sort inputs
// (Decision 2).

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

// Least-squares slope over the 12-month series, normalized to % change/month
// relative to the series mean → robust trend direction.
function trendSlopePct(series) {
  if (!series || series.length < 2) return 0;
  const n = series.length;
  const xs = series.map((_, i) => i);
  const xMean = mean(xs);
  const yMean = mean(series);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (series[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den ? num / den : 0;
  return yMean ? Math.round((slope / yMean) * 100 * 10) / 10 : 0; // % of mean per month
}

function trendDirection(pct) {
  if (pct > 1.5) return 'up';
  if (pct < -1.5) return 'down';
  return 'flat';
}

// regionData: [{ geo, terms: { term: {searchVolume,cpc,competition,monthlySearches} }, source }]
// rankableTerms: basket terms with isGeoTemplate === false (un-templated, Method A).
// homeGeoIds: set of geo ids that constitute the home market (index = 100 base).
function buildComparison(regionData, rankableTerms, homeGeoIds) {
  const rankableSet = new Set(rankableTerms.map((t) => t.term));

  const rows = regionData.map(({ geo, terms, source, density, densityDomains }) => {
    const used = Object.entries(terms).filter(([term]) => rankableSet.has(term));
    const volumes = used.map(([, v]) => v.searchVolume || 0);
    const clusterVolume = volumes.reduce((a, b) => a + b, 0);

    // Aggregate the 12-month series across the cluster for a single trend signal.
    const monthlyTotals = new Array(12).fill(0);
    for (const [, v] of used) {
      (v.monthlySearches || []).slice(0, 12).forEach((m, i) => { monthlyTotals[i] += m || 0; });
    }
    const trendPct = trendSlopePct(monthlyTotals);
    // YoY (Item 4): trailing-12-month series → last month vs first month.
    const first = monthlyTotals[0], last = monthlyTotals[monthlyTotals.length - 1];
    const yoyPct = first > 0 ? Math.round(((last - first) / first) * 100) : null;

    const perCapitaRaw = geo.population ? clusterVolume / (geo.population / 100000) : null;
    const perCapita = perCapitaRaw == null ? null : Math.round(perCapitaRaw * 10) / 10;

    return {
      geoId: geo.id,
      region: geo.displayName,
      isHome: homeGeoIds.has(geo.id),
      centroidLat: geo.centroidLat,
      centroidLng: geo.centroidLng,
      population: geo.population,
      clusterVolume,
      perCapita,                       // null when population unmapped → UI hides it
      perCapitaRaw,                    // unrounded — used for the home-indexed Demand Index
      competitorDensity: density == null ? null : density,   // unique top-10 domains (Item 3)
      competitorDomains: Array.isArray(densityDomains) ? densityDomains : [],
      medianCpc: Math.round(median(used.map(([, v]) => v.cpc || 0)) * 100) / 100,
      avgCompetition: Math.round(mean(used.map(([, v]) => v.competition || 0)) * 100) / 100,
      trendPct,
      yoyPct,
      trendDirection: trendDirection(trendPct),
      monthlyTotals,
      source,
    };
  });

  // Home index base = summed cluster volume across all home rows.
  const homeBase = rows.filter((r) => r.isHome).reduce((a, r) => a + r.clusterVolume, 0);
  // Per-capita basis for the home market (Item 2 Demand Index).
  const homeRows = rows.filter((r) => r.isHome);
  const homePop = homeRows.reduce((a, r) => a + (r.population || 0), 0);
  const homePerCapita = homePop ? homeBase / (homePop / 100000) : 0;
  for (const r of rows) {
    r.vsHomeIndex = homeBase ? Math.round((r.clusterVolume / homeBase) * 100) : null;
    // Demand Index (vs home): per-capita demand indexed so home = 100.
    // Use the RAW per-capita (not the display-rounded value) so a single home
    // market reads exactly 100 rather than 99/101 from rounding.
    r.demandIndex = (homePerCapita && r.perCapitaRaw != null)
      ? Math.round((r.perCapitaRaw / homePerCapita) * 100)
      : null;
  }

  // Sort by cluster volume desc (Decision 2). Home rows kept in-line, flagged.
  rows.sort((a, b) => b.clusterVolume - a.clusterVolume);
  return { rows, homeBase };
}

module.exports = { haversineMiles, suggestAdjacent, buildComparison, trendSlopePct, trendDirection };
