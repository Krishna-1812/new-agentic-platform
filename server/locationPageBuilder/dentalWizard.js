// ── Gentle Dental wizard orchestrator — Build Brief §3 Step 3 ──────────────
// Kept separate from pageService.js (which drives the heavier Neuro
// pipeline: SERP/SEMrush keyword mining, competitor scraping, multi-gate
// approval, versioning). The dental wizard is deliberately lighter — one
// structured LLM call, no approval workflow — so it gets its own thin
// orchestrator rather than threading page_type conditionals through
// pageService's Neuro-specific functions.

const store = require('./store');
const config = require('./config');
const compose = require('./compose');
const contentGenerator = require('./contentGenerator');
const schemaGenerator = require('./schemaGenerator');
const qaEngine = require('./qaEngine');
const internalLinks = require('./internalLinks');
const { disambiguate } = require('./keywordAdapter');
const { searchGoogle } = require('../services/googleSearch');
const { scrapeUrlsDetailed } = require('../services/scraper');

const COMPETITOR_URL_COUNT = 5;
const OWN_DOMAIN = 'gentledental.com';

// Real-competitor research for the primary keyword: SERP it, scrape the top
// (non-Gentle-Dental) results for their H2/H3 headings and any detected FAQ
// questions, so educationalBody + faqs can be modeled on actual coverage
// rather than the LLM's unaided guess. Cached (scraping is the expensive
// part) and fully fault-tolerant — a SERP or scrape failure falls back to
// empty arrays rather than failing the whole generation (contentGenerator
// already handles the no-competitor-data case).
async function researchCompetitors(primaryKeyword) {
  const cacheK = store.cacheKey('dental-competitor-research', primaryKeyword);
  const cached = await store.cacheGet(cacheK, config.cache.serpTtlMs);
  if (cached) return cached;

  let result = { headings: [], faqs: [] };
  try {
    const serp = await searchGoogle(disambiguate(primaryKeyword));
    const urls = (serp.results || [])
      .filter(r => r.url && !r.url.includes(OWN_DOMAIN))
      .slice(0, COMPETITOR_URL_COUNT)
      .map(r => r.url);

    if (urls.length) {
      const scraped = await scrapeUrlsDetailed(urls);
      const successes = scraped.filter(s => s.success);
      const headings = new Set();
      const faqs = new Set();
      successes.forEach(s => {
        [...(s.h2s || []), ...(s.h3s || [])].forEach(h => headings.add(h));
        (s.faqs || []).forEach(f => faqs.add(f));
      });
      result = { headings: [...headings].slice(0, 25), faqs: [...faqs].slice(0, 15) };
    }
  } catch {
    // SERP/scrape failure — fall back to LLM-only generation, don't fail the wizard.
  }

  await store.cacheSet(cacheK, result);
  return result;
}

// Only one page per (client, service, location) tuple is ever allowed — every
// write path in this file goes through this lookup + upsert-by-id so a
// second generate/regenerate for the same tuple always updates the existing
// row instead of creating a duplicate.
async function findExistingPage({ clientId, serviceId, locationId }) {
  const pages = await store.list('pages', { client_id: clientId });
  return pages.find(p => p.service_id === serviceId && p.location_id === locationId) || null;
}

async function getExistingPage({ clientId, serviceId, locationId }) {
  return findExistingPage({ clientId, serviceId, locationId });
}

async function savePage({ clientId, serviceId, locationId, scaffold, existing }) {
  const record = {
    client_id: clientId, service_id: serviceId, location_id: locationId,
    page_type: 'dental_location_service',
    status: 'Content Generated',
    page_object: scaffold,
  };
  const saved = existing
    ? await store.update('pages', existing.id, record)
    : await store.insert('pages', record, 'dpg');
  return saved;
}

// Generates (or regenerates) the full GeneratedPage for one (service, location)
// tuple and persists it to the shared `pages` collection — ALWAYS saved,
// ALWAYS keyed by the tuple (see findExistingPage/savePage above), so
// re-running the wizard for the same page updates it in place instead of
// creating a duplicate row.
//
// primaryKeywords: up to 2 (matching the keyword-research module's model).
// The FIRST drives every QC gate (H1/title/meta, H2, 5x frequency — a single
// page realistically optimizes for one main term). The SECOND, if present,
// is folded into secondaryKeywords — woven in naturally without being held
// to the same strict structural checks.
async function generatePage({ clientId, serviceId, locationId, primaryKeywords, secondaryKeywords }) {
  const primaries = (primaryKeywords || []).filter(Boolean);
  if (!primaries.length) throw new Error('At least one primary keyword is required.');
  const primaryKeyword = primaries[0];
  const mergedSecondary = [...primaries.slice(1), ...(secondaryKeywords || [])];

  const layers = await compose.loadLayers({ clientId, serviceId, locationId });
  const { client, service, location } = layers;

  const scaffold = compose.buildDentalScaffold(layers);
  scaffold.primaryKeyword = primaryKeyword;
  scaffold.primaryKeywords = primaries;
  scaffold.secondaryKeywords = mergedSecondary;

  const { headings: competitorHeadings, faqs: competitorFaqs } = await researchCompetitors(primaryKeyword);

  const l3 = await contentGenerator.generateDentalL3({
    service, location, primaryKeyword, secondaryKeywords: mergedSecondary,
    competitorHeadings, competitorFaqs,
  });
  compose.mergeDentalL3(scaffold, l3);

  const allLocations = await store.list('locations', { client_id: clientId });
  scaffold.sections.servicesInCity.internalLinks = internalLinks.buildDentalSiblings({
    allLocations, currentLocation: location, service,
  });

  scaffold.schema = schemaGenerator.generateDentalSchema({ scaffold, client, location, service });
  scaffold.qc = qaEngine.runDentalQC(scaffold);

  const existing = await findExistingPage({ clientId, serviceId, locationId });
  const saved = await savePage({ clientId, serviceId, locationId, scaffold, existing });

  return { pageId: saved.id, page: scaffold };
}

// Regenerate ONE section of an already-generated page in place — "regenerate
// every section" without re-running (and re-billing) the whole pipeline.
// section: 'heroIntro' | 'metaDescription' | 'educationalBlock' (needs
// blockIndex) | 'educationalBody' (all blocks) | 'faqs'.
async function regenerateSection({ clientId, serviceId, locationId, section, blockIndex }) {
  const existing = await findExistingPage({ clientId, serviceId, locationId });
  if (!existing?.page_object) throw new Error('Generate the page before regenerating a section.');

  const layers = await compose.loadLayers({ clientId, serviceId, locationId });
  const { client, service, location } = layers;
  const scaffold = structuredClone(existing.page_object);
  const primaryKeyword = scaffold.primaryKeyword;
  const secondaryKeywords = scaffold.secondaryKeywords || [];

  const { headings: competitorHeadings, faqs: competitorFaqs } = await researchCompetitors(primaryKeyword);

  const context = {};
  if (section === 'educationalBlock') {
    const blocks = scaffold.sections.educationalBody.blocks || [];
    if (blockIndex == null || !blocks[blockIndex]) throw new Error('blockIndex is required and must reference an existing block.');
    context.currentH2 = blocks[blockIndex].h2;
    context.otherHeadings = blocks.filter((_, i) => i !== blockIndex).map(b => b.h2);
  } else if (section === 'faqItem') {
    const items = scaffold.sections.faq.items || [];
    if (blockIndex == null || !items[blockIndex]) throw new Error('blockIndex is required and must reference an existing FAQ item.');
    context.currentQ = items[blockIndex].q;
    context.otherQuestions = items.filter((_, i) => i !== blockIndex).map(f => f.q);
  }

  const result = await contentGenerator.generateDentalRegen({
    service, location, primaryKeyword, secondaryKeywords, competitorHeadings, competitorFaqs, section, context,
  });

  if (section === 'heroIntro') {
    scaffold.sections.hero.intro = result.heroIntro || scaffold.sections.hero.intro;
  } else if (section === 'metaDescription') {
    scaffold.meta.metaDescription = result.metaDescription || scaffold.meta.metaDescription;
  } else if (section === 'educationalBlock') {
    scaffold.sections.educationalBody.blocks[blockIndex] = { h2: result.h2 || '', html: result.html || '' };
  } else if (section === 'educationalBody') {
    if (Array.isArray(result.educationalBody)) {
      scaffold.sections.educationalBody.blocks = result.educationalBody.map(b => ({ h2: b.h2 || '', html: b.html || '' }));
    }
  } else if (section === 'faqs') {
    if (Array.isArray(result.faqs)) {
      scaffold.sections.faq.items = result.faqs.map(f => ({ q: f.q || f.question || '', a: f.a || f.answer || '' }));
    }
  } else if (section === 'faqItem') {
    scaffold.sections.faq.items[blockIndex] = { q: result.q || '', a: result.a || '' };
  }

  scaffold.schema = schemaGenerator.generateDentalSchema({ scaffold, client, location, service });
  scaffold.qc = qaEngine.runDentalQC(scaffold);

  const saved = await savePage({ clientId, serviceId, locationId, scaffold, existing });
  return { pageId: saved.id, page: scaffold };
}

module.exports = { generatePage, regenerateSection, getExistingPage };
