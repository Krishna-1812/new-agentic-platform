// ── Top-25-pages fetch (Part 1) ─────────────────────────────────────────────
// Reuses the existing SEMrush "top pages" source (semrushCA.getTopPages) — no
// new data source or paid API. Page titles aren't in that SEMrush report, so
// they're fetched directly (axios + cheerio, both already project deps) purely
// for DISPLAY in the top-pages table. Classification is NOT done here anymore:
// each page's type is resolved centrally from the shared folder map (see
// orchestrator), the same mapping that drives the sitemap breakdown, so the
// two parts stay consistent and the user only edits one mapping.
const axios = require('axios');
const cheerio = require('cheerio');
const semrushCA = require('../../../services/semrushCA');

const TITLE_FETCH_TIMEOUT_MS = 8000;

// Client/competitor domains are sometimes stored with a scheme and/or
// trailing slash (e.g. a user pastes a full URL when adding a client)
// rather than a bare hostname. Normalize once here — without this, a
// domain already containing "https://" got double-prefixed into
// "https://https://example.com/...", which broke both the title fetch
// (bad URL, always 404s) and downstream folder-template classification
// (the malformed URL's path parsing put the domain itself into the path).
function normalizeUrl(domain) {
  const bare = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return `https://${bare}`;
}

async function fetchTitle(fullUrl) {
  try {
    const res = await axios.get(fullUrl, {
      timeout: TITLE_FETCH_TIMEOUT_MS,
      maxRedirects: 5,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ContentAnalysisBot/1.0)' },
      responseType: 'text',
    });
    const title = cheerio.load(res.data)('title').first().text().trim();
    return title || null;
  } catch {
    return null;
  }
}

async function fetchTopPagesForDomain(domain, database) {
  const rawPages = await semrushCA.getTopPages(domain, database, 25);
  return Promise.all(rawPages.map(async (p) => {
    const fullUrl = `${normalizeUrl(domain)}${p.url}`;
    const title = await fetchTitle(fullUrl);
    return { url: p.url, fullUrl, title, traffic: p.traffic, keywords: p.keywords, trafficShare: p.trafficShare };
  }));
}

// domainEntries: [{ domain, label, isClient }]
async function fetchTopPages(domainEntries, database) {
  return Promise.all(domainEntries.map(async (entry) => ({
    ...entry,
    pages: await fetchTopPagesForDomain(entry.domain, database),
  })));
}

module.exports = { fetchTopPages };
