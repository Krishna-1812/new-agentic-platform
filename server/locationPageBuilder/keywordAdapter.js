// ── Keyword adapter — Build Brief §3 Step 2 ─────────────────────────────────
// Thin adapter over the app's shared SERP + SEMrush primitives — NOT the
// standalone SSE `/api/keyword-research` route (which has no city/state
// params and no callable function to wrap) and NOT LPB's heavier
// generateSeeds/rankCompetitors/extractKeywords/classifyKeywords pipeline
// (which pulls in an LLM classification pass this wizard doesn't need).
//
// Builds a seed query, pulls the top organic result URLs for it, extracts
// each URL's ranking keywords via SEMrush (`url_organic`), and merges/dedupes
// into a flat KeywordCandidate[] the wizard's Step 2 table can sort/pick from.

const store = require('./store');
const config = require('./config');
const { searchGoogle } = require('../services/googleSearch');
const { getUrlKeywords } = require('../services/semrush');
const { getUniverseCandidates, getKnownCities } = require('./keywordUniverseStore');
const { relevanceTermsFor } = require('./keywordUniverseMap');

const TOP_URLS = 5;
const KEYWORDS_PER_URL = 20;

function classifyIntent(keyword) {
  const kw = String(keyword || '').toLowerCase();
  if (/\b(what is|how|why|guide|vs\.?|difference|symptoms|causes)\b/.test(kw)) return 'informational';
  if (/\b(book|appointment|schedule|near me|call|cost|price|emergency)\b/.test(kw)) return 'commercial';
  return 'commercial';
}

// Several Gentle Dental service names are ambiguous outside a dental context
// ("Sealants" and "Crowns & Bridges" read as construction/civil-engineering
// terms, "Braces" as orthopedic, "Implants" as medical/cosmetic-surgery) — a
// bare "{service} {city} {state}" SERP query for these returns building
// departments, civic pages, etc. instead of dental competitors. Disambiguate
// by ensuring "dental" is in the query whenever it isn't already implied.
function disambiguate(seed) {
  return /dental|dentist/i.test(seed) ? seed : `Dental ${seed}`;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A competitor's SEMrush ranking-keyword set spans every city they compete
// in, not just the page's own — e.g. a "Veneers Derry" search surfaces a
// multi-location competitor whose top keywords include "veneers manchester
// nh", "veneers goffstown nh", etc. Those aren't off-topic, just off-location
// for this page, so build a regex of every OTHER city — this client's own
// office cities, plus the broader place-name vocabulary the imported
// keyword universe already knows about — and drop live-pool keywords that
// mention one.
async function getOtherCityRegex(clientId, targetCity) {
  if (!clientId) return null;
  try {
    const [locations, universeCities] = await Promise.all([
      store.list('locations', { client_id: clientId }),
      getKnownCities(clientId),
    ]);
    const target = String(targetCity || '').toLowerCase().trim();
    const others = [...new Set([
      ...locations.map(l => (l.city || '').trim()),
      ...universeCities,
    ].filter(Boolean))].filter(c => c.toLowerCase() !== target);
    if (!others.length) return null;
    return new RegExp(`\\b(${others.map(escapeRegex).join('|')})\\b`, 'i');
  } catch {
    return null;
  }
}

async function getKeywordCandidates({ service, city, state, seedQuery, clientId, serviceSlug }) {
  const rawSeed = (seedQuery || `${service} ${city} ${state}`).trim();
  if (!rawSeed) throw new Error('A service+city+state or seedQuery is required.');
  if (!process.env.SEMRUSH_API_KEY) throw new Error('SEMRUSH_API_KEY not configured on server.');
  const seed = disambiguate(rawSeed);

  // v4: bumped after adding live-pool relevance filtering, near-me
  // exclusion, and other-city exclusion, so previously-cached (unfiltered)
  // results don't linger.
  const cacheK = store.cacheKey('dental-kw-adapter-v4', seed, clientId, serviceSlug);
  const cached = await store.cacheGet(cacheK, config.cache.serpTtlMs);
  if (cached) return cached;

  const serp = await searchGoogle(seed);
  const urls = (serp.results || []).slice(0, TOP_URLS).map(r => r.url).filter(Boolean);

  // With no topical filter, a competitor URL's SEMrush ranking keywords are
  // dominated by unrelated brand/generic-dentist terms for niche services
  // (e.g. "Veneers" pulling in "vanguard dental", "dentist manchester nh" —
  // nothing veneers-specific at all). Keep only keywords containing one of
  // the service's relevance terms, when we have them for this service.
  const relevanceTerms = serviceSlug ? relevanceTermsFor(serviceSlug) : null;
  const otherCityRe = await getOtherCityRegex(clientId, city);
  const isRelevant = kw => {
    const lower = kw.toLowerCase();
    if (relevanceTerms && !relevanceTerms.some(t => lower.includes(t))) return false;
    if (otherCityRe && otherCityRe.test(lower)) return false;
    return true;
  };

  const pool = [];
  for (const url of urls) {
    try {
      const kws = await getUrlKeywords(url, process.env.SEMRUSH_API_KEY, KEYWORDS_PER_URL);
      pool.push(...kws.filter(k => isRelevant(k.keyword || '')).map(k => ({ ...k, source: 'live' })));
    } catch {
      // A single failing URL shouldn't fail the whole request — skip it.
    }
  }

  // The live SERP+SEMrush pull borrows whatever a competitor's page ranks
  // for — for niche service+location combos that's often off-topic (the page
  // ranks mainly for unrelated terms). Merge in the client's own pre-scored
  // keyword universe, when one has been imported, to fill that gap.
  if (clientId && serviceSlug) {
    try {
      pool.push(...await getUniverseCandidates({ clientId, serviceSlug, city }));
    } catch {
      // Universe lookup is a supplement, not a dependency — never fail the
      // whole request because of it.
    }
  }

  // Client wants location-specific keywords, not generic "near me" phrasing —
  // drop those outright rather than just deprioritizing (even a 0-volume
  // location-specific keyword beats a high-volume "near me" one here).
  const NEAR_ME_RE = /\bnear me\b/i;

  const byKeyword = new Map();
  for (const k of pool) {
    const key = (k.keyword || '').toLowerCase().trim();
    if (!key || NEAR_ME_RE.test(key)) continue;
    const existing = byKeyword.get(key);
    if (!existing || (k.volume || 0) > (existing.volume || 0)) {
      byKeyword.set(key, {
        keyword: k.keyword,
        volume: k.volume || 0,
        difficulty: k.difficulty || 0,
        intent: classifyIntent(k.keyword),
        source: k.source || 'live',
      });
    }
  }

  const candidates = [...byKeyword.values()].sort((a, b) => b.volume - a.volume);
  await store.cacheSet(cacheK, candidates);
  return candidates;
}

module.exports = { getKeywordCandidates, disambiguate };
