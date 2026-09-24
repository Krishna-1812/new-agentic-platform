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

// ── Decision-layer normalization (V2 Phase 1) ─────────────────────────────────
// All tunable in one place — the composite Opportunity Score is computed CLIENT
// side from these `components` so weight sliders respond with no refetch.

const TREND_CLAMP = 50;      // percentage points — clamp YoY so one outlier city
                             // doesn't own the trend axis before min–max.
const HOME_VOLUME_MIN = 100; // aggregate home cluster volume below this → the whole
                             // run's indexes are unstable (home_volume_low warning).

// Confidence thresholds — tune here. Coverage = share of rankable terms that
// returned any volume for the city; clusterVolume = summed monthly searches.
const CONFIDENCE = {
  high:   { minVolume: 500, minCoverage: 0.5 },
  medium: { minVolume: 100, minCoverage: 0.3 },
};
function confidenceOf(clusterVolume, coverage) {
  if (clusterVolume <= 0) return 'insufficient';
  if (clusterVolume >= CONFIDENCE.high.minVolume && coverage >= CONFIDENCE.high.minCoverage) return 'high';
  if (clusterVolume >= CONFIDENCE.medium.minVolume && coverage >= CONFIDENCE.medium.minCoverage) return 'medium';
  return 'low';
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// Min–max normalize x within arr's range → [0,1]. Returns 0.5 for a degenerate
// range (all values equal); null in → null out so a missing metric never gets a
// fabricated score.
function minMax(x, arr) {
  if (x == null) return null;
  const vals = arr.filter((v) => v != null);
  if (!vals.length) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi === lo) return 0.5;
  return (x - lo) / (hi - lo);
}

// Percentile rank of value within arr → 0–100 (min→0, max→100). Single value → 100.
function percentileRank(value, arr) {
  if (value == null) return null;
  const vals = arr.filter((v) => v != null);
  if (vals.length <= 1) return vals.length ? 100 : null;
  const below = vals.filter((v) => v < value).length;
  return Math.round((below / (vals.length - 1)) * 100);
}

// regionData: [{ geo, terms: { term: {searchVolume,cpc,competition,monthlySearches} }, source }]
// rankableTerms: basket terms with isGeoTemplate === false (un-templated, Method A).
// homeGeoIds: set of geo ids that constitute the home market (index = 100 base).
// classifyDomain: optional (domain) => 'you'|'directory'|'provider' (Phase 2). When
//   supplied, each row also carries a competitorBreakdown.
function buildComparison(regionData, rankableTerms, homeGeoIds, classifyDomain = null) {
  const rankableSet = new Set(rankableTerms.map((t) => t.term));
  const rankableCount = rankableTerms.length;

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

    // Confidence (Phase 1): how much of the basket actually returned volume here.
    const termsWithVolume = used.filter(([, v]) => (v.searchVolume || 0) > 0).length;
    const coverage = rankableCount ? termsWithVolume / rankableCount : 0;

    // Term contribution (Phase 2): top 8 rankable terms by volume, rest → "other".
    const termBreakdown = buildTermBreakdown(used, clusterVolume);

    // Competitor classification (Phase 2): split the density domain list.
    const domains = Array.isArray(densityDomains) ? densityDomains : [];
    const competitorBreakdown = classifyDomain
      ? classifyDomains(domains, classifyDomain)
      : null;

    return {
      geoId: geo.id,
      region: geo.displayName,
      isHome: homeGeoIds.has(geo.id),
      centroidLat: geo.centroidLat,
      centroidLng: geo.centroidLng,
      population: geo.population,
      clusterVolume,
      estMonthlySearches: clusterVolume,   // display alias (leader-facing copy, §6.4)
      perCapita,                       // null when population unmapped → UI hides it
      perCapitaRaw,                    // unrounded — used for the home-indexed Demand Index
      competitorDensity: density == null ? null : density,   // unique top-10 domains (Item 3)
      competitorDomains: domains,
      competitorBreakdown,             // { providers, directories, youRankHere } | null
      medianCpc: Math.round(median(used.map(([, v]) => v.cpc || 0)) * 100) / 100,
      avgCompetition: Math.round(mean(used.map(([, v]) => v.competition || 0)) * 100) / 100,
      trendPct,
      yoyPct,
      trendDirection: trendDirection(trendPct),
      monthlyTotals,
      termsWithVolume,
      coverage: Math.round(coverage * 100) / 100,
      confidence: confidenceOf(clusterVolume, coverage),
      termBreakdown,
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

  // ── Component normalization (Phase 1) — each metric min–max'd WITHIN this run.
  // Home rows are IN the pool (so the leader sees home in context) but the client
  // excludes home from tiering. Higher component = more attractive:
  //   demand  ↑ = more per-capita demand
  //   competition ↑ = FEWER ranking domains (more open market)  → 1 − minMax
  //   trend   ↑ = faster YoY growth (clamped so an outlier can't own the axis)
  //   cost    ↑ = CHEAPER clicks (lower CPC) → 1 − minMax. NB: high CPC also signals
  //               commercial value, so this axis is ambiguous → low default weight.
  const demandArr = rows.map((r) => r.demandIndex);
  const densArr = rows.map((r) => r.competitorDensity);
  const trendArr = rows.map((r) => (r.yoyPct == null ? null : clamp(r.yoyPct, -TREND_CLAMP, TREND_CLAMP)));
  const cpcArr = rows.map((r) => r.medianCpc);
  for (const r of rows) {
    const competitionM = r.competitorDensity == null ? null : minMax(r.competitorDensity, densArr);
    const costM = minMax(r.medianCpc, cpcArr);
    r.components = {
      demand: minMax(r.demandIndex, demandArr),
      competition: competitionM == null ? null : 1 - competitionM,
      trend: minMax(r.yoyPct == null ? null : clamp(r.yoyPct, -TREND_CLAMP, TREND_CLAMP), trendArr),
      cost: costM == null ? null : 1 - costM,
    };
    r.percentileDemand = percentileRank(r.demandIndex, demandArr);
  }

  // Sort by cluster volume desc (Decision 2). Home rows kept in-line, flagged.
  rows.sort((a, b) => b.clusterVolume - a.clusterVolume);

  const warnings = [];
  if (homeBase < HOME_VOLUME_MIN) warnings.push('home_volume_low');

  return { rows, homeBase, warnings };
}

// Top-N rankable terms by volume; the tail collapses into a single "other" row.
// Adds a skewed flag when one phrase drives > 60% of the cluster (fragile index).
function buildTermBreakdown(used, clusterVolume, topN = 8) {
  if (!clusterVolume) return [];
  const sorted = used
    .map(([term, v]) => ({ term, volume: v.searchVolume || 0 }))
    .filter((t) => t.volume > 0)
    .sort((a, b) => b.volume - a.volume);
  const head = sorted.slice(0, topN);
  const tailVol = sorted.slice(topN).reduce((a, t) => a + t.volume, 0);
  const out = head.map((t) => ({ term: t.term, volume: t.volume, share: Math.round((t.volume / clusterVolume) * 100) / 100 }));
  if (tailVol > 0) out.push({ term: 'other', volume: tailVol, share: Math.round((tailVol / clusterVolume) * 100) / 100, isOther: true });
  return out;
}

// Split a density domain list into provider / directory counts + a youRankHere flag,
// and carry the per-domain typed list so the drill-down can name each competitor.
function classifyDomains(domains, classifyDomain) {
  let providers = 0, directories = 0, youRankHere = false;
  const list = [];
  for (const d of domains) {
    const type = classifyDomain(d);
    if (type === 'you') { youRankHere = true; providers++; }   // your own site is a provider
    else if (type === 'directory') directories++;
    else providers++;
    list.push({ domain: d, type });
  }
  return { providers, directories, youRankHere, domains: list };
}

module.exports = { haversineMiles, suggestAdjacent, buildComparison, trendSlopePct, trendDirection, confidenceOf };
