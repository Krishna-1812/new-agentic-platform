// ── Competitor research for a primary keyword ───────────────────────────────
// SERP the keyword, scrape the top non-own-domain results, and return their
// H2/H3 headings plus any FAQ questions found. Two consumers: the Gentle
// Dental wizard (which feeds it straight into the outline planner) and the
// brief builder (which turns it into an editable brief).
//
// Lifted out of dentalWizard.js when the brief step needed it, with one
// change: the own-domain filter is a PARAMETER rather than a hardcoded
// gentledental.com. A client's own pages ranking for their own keyword are not
// competitors, and filtering the wrong domain means modelling the page on
// itself.
//
// Fully fault-tolerant by design: a SERP or scrape failure returns empty
// arrays rather than throwing, because every caller can write a page without
// competitor data (it just falls back to the curated ladder) and none of them
// should die because a third-party site timed out.

const store = require('./store');
const config = require('./config');
const { disambiguate } = require('./keywordAdapter');
const { competitorQualifierFor } = require('./verticals');
const { searchGoogle } = require('../services/googleSearch');
const { scrapeUrlsDetailed } = require('../services/scraper');

const COMPETITOR_URL_COUNT = 5;
const MAX_HEADINGS = 25;
const MAX_FAQS = 15;

// Derives the bare hostname a client's own results are filtered by.
function ownDomainOf(client) {
  const raw = client?.brand_static?.base_url || '';
  try {
    return new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return String(raw).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  }
}

// v2: the cache key now carries the own-domain filter. Under v1 (which keyed on
// the keyword alone) two clients sharing a keyword would have read each other's
// result, with the wrong domain filtered out of it. Existing v1 entries are
// simply not read again — the first run per keyword re-scrapes, then caches.
function cacheKeyFor(primaryKeyword, ownDomain) {
  return store.cacheKey('competitor-research-v3', primaryKeyword, ownDomain || '');
}

async function researchCompetitors(primaryKeyword, { ownDomain = '', clientId = null } = {}) {
  // The industry qualifier is part of the query, so it has to be part of the
  // key: otherwise two clients researching the same keyword would share one
  // scrape of whichever industry asked first.
  // Steered toward the right INDUSTRY, not just the right keyword. See the note
  // on COMPETITOR_QUALIFIER: the keyword that ranks is not always the keyword
  // that finds the right competitors.
  const qualifier = competitorQualifierFor(clientId);
  const query = qualifier && !new RegExp(qualifier, 'i').test(primaryKeyword)
    ? `${qualifier} ${primaryKeyword}`
    : disambiguate(primaryKeyword, clientId);
  const cacheK = cacheKeyFor(query, ownDomain);
  try {
    const cached = await store.cacheGet(cacheK, config.cache.serpTtlMs);
    if (cached) return cached;
  } catch { /* cache outage — fall through to a live pull */ }

  let result = { headings: [], faqs: [] };
  try {
    const serp = await searchGoogle(query);
    const urls = (serp.results || [])
      .filter(r => r.url && !(ownDomain && r.url.includes(ownDomain)))
      .slice(0, COMPETITOR_URL_COUNT)
      .map(r => r.url);

    if (urls.length) {
      const scraped = await scrapeUrlsDetailed(urls);
      const headings = new Set();
      const faqs = new Set();
      scraped.filter(s => s.success).forEach(s => {
        [...(s.h2s || []), ...(s.h3s || [])].forEach(h => headings.add(h));
        (s.faqs || []).forEach(f => faqs.add(f));
      });
      result = { headings: [...headings].slice(0, MAX_HEADINGS), faqs: [...faqs].slice(0, MAX_FAQS) };
    }
  } catch {
    // SERP/scrape failure — fall back to LLM-only generation, don't fail the
    // caller. Deliberately NOT cached: a transient outage must not pin an
    // empty result for the whole TTL.
    return result;
  }

  try {
    await store.cacheSet(cacheK, result, { kind: 'serp', ttlMs: config.cache.serpTtlMs });
  } catch { /* non-fatal */ }
  return result;
}

module.exports = { researchCompetitors, ownDomainOf, COMPETITOR_URL_COUNT };
