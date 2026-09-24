// Pure functions — no I/O, no provider-specific assumptions. Works
// identically whether `keywords` came from the mock provider or (later) a
// live SEMrush provider, since both produce the same shape.

function computeKeywordPositionBuckets(keywords = []) {
  const buckets = { page1: 0, page2: 0, page3to5: 0, page6to10: 0, total: keywords.length };
  for (const k of keywords) {
    if (k.position >= 1 && k.position <= 10) buckets.page1++;
    else if (k.position <= 20) buckets.page2++;
    else if (k.position <= 50) buckets.page3to5++;
    else if (k.position <= 100) buckets.page6to10++;
  }
  return buckets;
}

// clientKeywords: [{keyword,position,volume}]
// competitorEntries: [{domain, keywords: [...]}]
function computeKeywordGap(clientKeywords = [], competitorEntries = []) {
  const bestByKeyword = new Map(); // keyword -> {position, domain, volume}
  for (const entry of competitorEntries) {
    for (const k of entry.keywords) {
      if (k.position > 10) continue;
      const existing = bestByKeyword.get(k.keyword);
      if (!existing || k.position < existing.position) {
        bestByKeyword.set(k.keyword, { position: k.position, domain: entry.domain, volume: k.volume });
      }
    }
  }

  const clientByKeyword = new Map(clientKeywords.map((k) => [k.keyword, k]));

  const strikingDistance = [];
  const untapped = [];
  const missing = [];

  for (const [keyword, best] of bestByKeyword) {
    const clientEntry = clientByKeyword.get(keyword);
    if (clientEntry && clientEntry.position >= 11 && clientEntry.position <= 50) {
      strikingDistance.push({
        keyword, searchVolume: best.volume,
        clientPosition: clientEntry.position,
        bestCompetitorPosition: best.position, bestCompetitorDomain: best.domain,
      });
    } else if (!clientEntry) {
      missing.push({
        keyword, searchVolume: best.volume,
        bestCompetitorPosition: best.position, bestCompetitorDomain: best.domain,
      });
    } else if (clientEntry.position > 50) {
      untapped.push({
        keyword, searchVolume: best.volume,
        clientPosition: clientEntry.position,
        bestCompetitorPosition: best.position, bestCompetitorDomain: best.domain,
      });
    }
  }

  const byVolumeDesc = (a, b) => b.searchVolume - a.searchVolume;
  return {
    strikingDistance: strikingDistance.sort(byVolumeDesc).slice(0, 25),
    untapped: untapped.sort(byVolumeDesc).slice(0, 25),
    missing: missing.sort(byVolumeDesc).slice(0, 25),
  };
}

// allDomainsKeywords: [{domain, keywords: [...]}]
function computeKeywordDetailTable(allDomainsKeywords = [], limit = 100) {
  const rows = new Map(); // keyword -> { keyword, searchVolume, positions: {domain: pos} }
  for (const { domain, keywords } of allDomainsKeywords) {
    for (const k of keywords) {
      if (!rows.has(k.keyword)) rows.set(k.keyword, { keyword: k.keyword, searchVolume: k.volume, positions: {} });
      rows.get(k.keyword).positions[domain] = k.position;
    }
  }
  return [...rows.values()].sort((a, b) => b.searchVolume - a.searchVolume).slice(0, limit);
}

module.exports = {
  computeKeywordPositionBuckets,
  computeKeywordGap,
  computeKeywordDetailTable,
};
