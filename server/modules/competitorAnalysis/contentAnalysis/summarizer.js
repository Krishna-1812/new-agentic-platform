// GPT 5.4 mini narrative summaries — plain-language interpretation of the
// data already shown in the charts/table above each summary, not a repeat
// of the numbers.

function domainLine(d) {
  return `${d.isClient ? 'BRAND' : 'Competitor'} — ${d.label} (${d.domain})`;
}

async function summarizeTopPages(writerClient, domains) {
  const listing = domains.map((d) => {
    const typeLine = Object.entries(d.contentTypeCounts)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');
    const topByTraffic = [...d.pages]
      .sort((a, b) => b.traffic - a.traffic)
      .slice(0, 3)
      .map((p) => `${p.url} (${p.contentType}, ~${p.traffic.toLocaleString()} est. monthly traffic)`)
      .join('; ');
    return `${domainLine(d)}\nContent type mix (top 10 pages): ${typeLine}\nTop pages by traffic: ${topByTraffic || 'none'}`;
  }).join('\n\n');

  const res = await writerClient.chat.completions.create({
    model: writerClient.model,
    max_completion_tokens: 1200,
    messages: [
      {
        role: 'system',
        content: 'You are an SEO content strategist. Write a concise, plain-language narrative summary — a few short paragraphs, not a data dump (the raw numbers are already shown in a table above your summary). Do not restate every number; interpret them.',
      },
      {
        role: 'user',
        content: `${listing}\n\nSummarize: (1) what content types are performing best for the brand, (2) what content types are performing best for each competitor, (3) how the brand's top-performing content compares to competitors' — gaps, overlaps, and opportunities.`,
      },
    ],
  });
  return res.choices[0].message.content || '';
}

async function summarizeSitemapStructure(writerClient, domains) {
  const listing = domains.map((d) => {
    if (d.sitemapStatus !== 'found') return `${domainLine(d)}: no accessible sitemap found.`;
    const typeLine = Object.entries(d.pageTypeCounts).filter(([, c]) => c > 0).map(([type, c]) => `${type}: ${c}`).join(', ');
    return `${domainLine(d)} — ${d.totalUrls} total URLs${d.capped ? ' (crawl limit reached — partial sample)' : ''}\nPage type breakdown: ${typeLine}`;
  }).join('\n\n');

  const res = await writerClient.chat.completions.create({
    model: writerClient.model,
    max_completion_tokens: 1200,
    messages: [
      {
        role: 'system',
        content: 'You are an SEO content strategist. Write a concise, plain-language narrative summary — a few short paragraphs, not a data dump. You MUST explicitly state, near the start of your summary, that this breakdown is based on each site\'s XML sitemap(s) as declared in robots.txt, not a full site crawl, so actual page counts may differ from what is listed.',
      },
      {
        role: 'user',
        content: `${listing}\n\nSummarize: (1) what kind of site structure the brand has vs. each competitor (e.g. content-heavy, location-heavy, product-heavy), (2) notable gaps or differences (e.g. "Competitor X has 340 location pages, brand has 12").`,
      },
    ],
  });
  return res.choices[0].message.content || '';
}

module.exports = { summarizeTopPages, summarizeSitemapStructure };
