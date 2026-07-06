const { estimateDomainCost, MAX_UNITS_PER_RUN } = require('./unitCosts');
const { getProvider } = require('./provider');
const { getDatabase } = require('../../utils/countryToDatabase');
const gap = require('./gapAnalysis');

const MAX_HISTORY_POINTS = 12;

function appendHistory(previousSnapshot, newSnapshot) {
  const history = (previousSnapshot && Array.isArray(previousSnapshot.history)) ? previousSnapshot.history.slice() : [];
  history.push({
    capturedAt: newSnapshot.capturedAt,
    domains: newSnapshot.domains.map((d) => ({ domain: d.domain, organicTraffic: d.domainRank.organicTraffic, organicKeywords: d.domainRank.organicKeywords })),
  });
  return history.slice(-MAX_HISTORY_POINTS);
}

// Runs the pipeline for one client. Provider-agnostic budget guard: stops
// fetching new domains the moment the next one would push cumulative
// estimated spend over the hard per-run cap (client is always fetched
// first, so it's never the one skipped).
async function fetchClientDashboardData(client, previousSnapshot, capUnits = MAX_UNITS_PER_RUN) {
  const domainEntries = [
    { domain: client.domain, label: client.name, isClient: true },
    ...client.competitors.map((c) => ({ domain: c.domain, label: c.label, isClient: false })),
  ];

  const provider = getProvider();
  const database = getDatabase(client.country);
  const perDomainCost = estimateDomainCost();
  const ctx = provider.createRunContext(domainEntries.map((d) => d.domain));

  const fetched = [];
  const skipped = [];
  let usedUnits = 0;

  for (const entry of domainEntries) {
    if (usedUnits + perDomainCost > capUnits) {
      skipped.push(entry.domain);
      continue;
    }
    const raw = await provider.fetchDomainData(entry.domain, ctx, { database, brandName: client.brandName });
    usedUnits += perDomainCost;
    fetched.push({
      ...raw,
      label: entry.label,
      isClient: entry.isClient,
      keywordBuckets: gap.computeKeywordPositionBuckets(raw.keywords),
    });
  }

  const clientDomain = fetched.find((d) => d.isClient);
  const competitorDomains = fetched.filter((d) => !d.isClient);

  const keywordGap = clientDomain
    ? gap.computeKeywordGap(clientDomain.keywords, competitorDomains.map((d) => ({ domain: d.domain, keywords: d.keywords })))
    : { strikingDistance: [], untapped: [], missing: [] };

  const keywordDetailTable = gap.computeKeywordDetailTable(fetched.map((d) => ({ domain: d.domain, keywords: d.keywords })));

  const snapshot = {
    capturedAt: new Date().toISOString(),
    usedUnits,
    capUnits,
    skipped,
    domains: fetched,
    keywordGap,
    keywordDetailTable,
  };
  snapshot.history = appendHistory(previousSnapshot, snapshot);

  return snapshot;
}

module.exports = { fetchClientDashboardData };
