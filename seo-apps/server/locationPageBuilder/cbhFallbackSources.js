// ── Authoritative fallback sources ──────────────────────────────────────────
// The guidelines allow an educational subsection the competitors do not cover
// to be written from "reliable and relevant industry or authoritative
// sources", and forbid inventing information. Those two rules together mean a
// fallback section has to be TRACEABLE: the writer needs real source text to
// work from, and the reviewer needs to see where it came from.
//
// So for each H3 the planner marked `fallback`, this searches a fixed
// allowlist of clinical authorities, scrapes the best result, and returns the
// URL plus an excerpt. cbhQc fails any fallback section with no source URL, so
// a section that gets nothing here cannot quietly ship as if it were
// researched.
//
// Deliberately capped. This is a search + a scrape per thin section on top of
// the competitor pass, and an uncapped version would turn one page into a
// crawl.

const store = require('./store');
const config = require('./config');
const contract = require('./cbhContract');
const { searchGoogle } = require('../services/googleSearch');
const { scrapeUrlsDetailed } = require('../services/scraper');

// Approved by the client. Nothing outside this list is ever used as a source:
// "authoritative" has to mean a named authority, not whatever ranked.
const ALLOWLIST = [
  'nimh.nih.gov',
  'samhsa.gov',
  'apa.org',
  'psychiatry.org',
  'cdc.gov',
  'ncbi.nlm.nih.gov',
  'mayoclinic.org',
];

// At most this many lookups per page. Derived from the contract, NOT a
// standalone number: a cap below the maximum H3 count means a brief whose
// sections all need sourcing produces a page that structurally CANNOT pass
// educational_fallback_cited, no matter how many times it is regenerated.
//
// That is exactly what a hardcoded 2 did. When the planner degraded to the
// code-side plan, all four sections were marked fallback, two got a source and
// two could never get one -- a permanent Major failure with no path to green.
//
// The cost this was guarding against is real but bounded and cached: at worst
// one search + one scrape per section, once per (service, heading).
const MAX_LOOKUPS_PER_PAGE = contract.LIMITS.educational.h3Count.max;
const EXCERPT_MAX_CHARS = 1200;
// Below this, whatever came back is a stub, a nav shell or an interstitial --
// not something a section can be written from.
const EXCERPT_MIN_CHARS = 200;
// How many allowed results to try before giving up on a section.
const MAX_URL_ATTEMPTS = 3;

// A scrape can succeed, return 200, and hand back a block page. NCBI in
// particular answers automated traffic with "Access Denied ... temporarily
// blocked due to a possible misuse/abuse situation", which is 800 characters
// of perfectly scrapeable text that says nothing about the topic.
//
// Accepting it would be the worst version of this bug: the writer is told
// "write this section from the source below" and handed an error notice, then
// the page cites a clinical authority for whatever it invented instead.
const BLOCKED_PAGE_RE = new RegExp([
  'access denied',
  'temporarily blocked',
  'possible misuse',
  'are you a (human|robot)',
  'enable javascript',
  'verify you are human',
  'captcha',
  'unusual traffic',
  'rate limit',
  'request could not be satisfied',
  '\b(403|404|429|503)\b.{0,24}(forbidden|not found|too many|unavailable)',
  'page (not found|cannot be displayed)',
].join('|'), 'i');

// Accepts only text that looks like the article the citation claims.
function usableExcerpt(text) {
  const t = String(text || '').trim();
  if (t.length < EXCERPT_MIN_CHARS) return false;
  // Checked against the OPENING, where a block notice always sits -- a genuine
  // clinical page may well use the word "error" further down.
  return !BLOCKED_PAGE_RE.test(t.slice(0, 400));
}

function isAllowed(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return ALLOWLIST.some(d => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

// Genuine stopwords only. An earlier, much longer list also dropped "expect",
// "options", "signs", "started" and "first" as page furniture -- but those are
// precisely what distinguishes one section's query from another's. Stripping
// them reduced "What to expect at your first visit" to "visit" and lost a
// source that had been retrieving fine. Dedupe is what this needed; denoising
// past the stopwords did more harm than good.
const QUERY_NOISE = new Set([
  'the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'at', 'and', 'or',
  'your', 'you', 'our', 'we', 'is', 'are', 'it', 'this', 'that', 'may',
]);

// Restricting the query to the allowlist up front is what keeps a general SERP
// from deciding what counts as authoritative.
//
// The service and the heading are DEDUPED before they are joined. Concatenating
// them raw produced "Anxiety treatment Treatment options available", where the
// topic word appears twice and three of the remaining words describe a page
// layout -- a query that returned nothing usable across three attempts while
// the same section sourced fine for other services.
function queryTopic(heading, serviceName) {
  const seen = new Set();
  const terms = `${serviceName} ${heading}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => {
      if (QUERY_NOISE.has(w) || seen.has(w)) return false;
      seen.add(w);
      return true;
    });
  // If the heading was entirely stopwords, the service alone is still a query.
  return terms.length ? terms.join(' ') : String(serviceName || '').toLowerCase();
}

function buildQuery(heading, serviceName) {
  const sites = ALLOWLIST.map(d => `site:${d}`).join(' OR ');
  return `${queryTopic(heading, serviceName)} (${sites})`;
}

// Two queries, tried in order, because neither alone is reliable:
//
//   1. site-restricted -- high precision, but a seven-way `site:` OR is
//      brittle on a narrow query and returns nothing at all for some headings
//      ("depression treatment how start" found no results this way);
//   2. unrestricted -- always returns something, and `isAllowed` filters it
//      down, so precision is preserved by the filter rather than the query.
//
// The second only runs when the first yields no allowed URL, so the common
// case still costs one search.
function buildQueries(heading, serviceName) {
  const topic = queryTopic(heading, serviceName);
  return [buildQuery(heading, serviceName), topic];
}

// One lookup: search the allowlist, scrape the first allowed result, return
// { url, excerpt } or null. Never throws -- a failed lookup leaves the section
// unsourced, which QC then flags, and that is the correct outcome.
async function lookupOne({ heading, serviceName }) {
  const cacheK = store.cacheKey('cbh-fallback-source-v8', serviceName, heading);
  try {
    const cached = await store.cacheGet(cacheK, config.cache.serpTtlMs);
    if (cached) return cached;
  } catch { /* live lookup */ }

  let result = null;
  try {
    // Try more than the first hit. Some authorities block scrapers outright
    // (PMC answers automated traffic with an access-denied page), and stopping
    // at the first allowed URL meant a whole section went unsourced whenever
    // the top result happened to be one of them -- while still recording that
    // URL as its citation.
    // One candidate per HOST. The allowlist is seven authorities, but a single
    // query commonly returns ten results from one of them -- "depression
    // treatment who right" returned ten NCBI links, and NCBI blocks scrapers,
    // so all three attempts were spent being refused by the same site while
    // six other authorities went untried.
    //
    // The second query only runs when the first has not produced enough
    // distinct hosts, so the common case still costs one search.
    const byHost = new Map();
    const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
    for (const q of buildQueries(heading, serviceName)) {
      if (byHost.size >= MAX_URL_ATTEMPTS) break;
      const serp = await searchGoogle(q);
      for (const url of (serp.results || []).map(r => r.url).filter(Boolean).filter(isAllowed)) {
        const h = hostOf(url);
        if (h && !byHost.has(h)) byHost.set(h, url);
        if (byHost.size >= MAX_URL_ATTEMPTS) break;
      }
    }
    const urls = [...byHost.values()];
    for (const url of urls) {
      if (result) break;
      const [scraped] = await scrapeUrlsDetailed([url]);
      if (scraped?.success) {
        // `bodyText` is what scrapeUrlsDetailed returns. Reading `text` or
        // `content` -- neither of which it has -- silently produced an empty
        // excerpt on EVERY lookup, so every fallback section was cited to a
        // source the writer had never been shown.
        const text = String(scraped.bodyText || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, EXCERPT_MAX_CHARS);
        if (usableExcerpt(text)) result = { url, excerpt: text };
      }
    }
    // A URL whose text could not be read is NOT recorded. Recording it would
    // publish a citation to a source the writer was never shown -- the precise
    // thing the guidelines forbid, dressed up as diligence. Returning nothing
    // leaves the section unsourced, which QC reports as a Major failure and a
    // reviewer can then act on.
  } catch {
    return null; // deliberately not cached -- a transient failure must not pin
  }

  if (result) {
    try { await store.cacheSet(cacheK, result, { kind: 'serp', ttlMs: config.cache.serpTtlMs }); } catch { /* non-fatal */ }
  }
  return result;
}

// Fills `sourceUrl` (and returns excerpts for the writer) on every H3 the
// planner marked fallback, up to the per-page cap. Returns a NEW h3 list plus
// a map of heading -> excerpt.
//
// Sections beyond the cap keep their fallback tag and no URL, so QC flags them
// rather than the page silently shipping unsourced copy.
async function attachFallbackSources({ h3s = [], serviceName, max = MAX_LOOKUPS_PER_PAGE }) {
  const excerpts = {};
  const out = h3s.map(h => ({ ...h }));

  const needing = out.filter(h => h.source === 'fallback' && !String(h.sourceUrl || '').trim());
  // Sequential on purpose: two searches back to back is cheap, and running
  // them together would double the burst against a quota the competitor pass
  // is already spending.
  for (const h3 of needing.slice(0, max)) {
    const found = await lookupOne({ heading: h3.heading, serviceName });
    if (found) {
      h3.sourceUrl = found.url;
      if (found.excerpt) excerpts[h3.heading] = found.excerpt;
    }
  }

  return { h3s: out, excerpts, attempted: Math.min(needing.length, max), needed: needing.length };
}

module.exports = {
  attachFallbackSources, lookupOne, isAllowed, buildQuery, usableExcerpt,
  ALLOWLIST, MAX_LOOKUPS_PER_PAGE, MAX_URL_ATTEMPTS, QUERY_NOISE, buildQueries, queryTopic,
};
