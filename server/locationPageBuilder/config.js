// ── Location + Service Page Content Builder — module config ──────────────────
// All tunables live here so the SEO team can adjust without code changes.
// Build Spec Sections 3, 6, 7, 9, 15, 18.

const path = require('path');

module.exports = {
  // Feature flag — the whole module is gated on this (Spec §0.2).
  enabled: process.env.LPB_ENABLED !== 'false',

  // Where the file-based store persists (matches kbStore's data-root convention).
  dataRoot: process.env.LPB_DATA_ROOT || path.join(__dirname, '../../data/location-page-builder'),

  // Stage-3 competitor scoring weights (Spec §6 Stage 3). Tunable.
  serpScoreWeights: {
    rankingFrequency: 25, // appears across several seed SERPs
    pageTypeMatch: 20,    // real local service / location+service page
    localIntentMatch: 15, // same city/state/nearby area
    serviceIntentMatch: 15, // clearly the selected service
    conversionIntent: 10, // call/book/quote/appointment CTAs
    organicPosition: 10,  // top 3 / top 10
    schemaQuality: 5,     // LocalBusiness/MedicalBusiness/Service/FAQ/Breadcrumb
  },
  serp: {
    maxPerDomain: 2,        // cap ~2 URLs per domain
    modelAfterCount: 10,    // take top 10 into model_after
    // Directory domains tagged discovery_only (used for keywords, not modelled).
    directoryDomains: [
      'yelp.com', 'angi.com', 'angieslist.com', 'thumbtack.com', 'bbb.org',
      'yellowpages.com', 'healthgrades.com', 'zocdoc.com', 'webmd.com',
      'psychologytoday.com', 'vitals.com', 'wellness.com', 'mapquest.com',
      'facebook.com', 'tripadvisor.com',
    ],
  },

  // Stage-4 SEMrush extraction (Spec §6 Stage 4).
  semrush: {
    keywordsPerUrl: 30,
    database: 'us',
  },

  // Stage-5 LLM relevance / generation (Spec §6 Stage 5, §7).
  llm: {
    classificationModel: process.env.LPB_LLM_MODEL || 'gpt-5.4-mini',
    generationModel: process.env.LPB_GEN_MODEL || 'gpt-5.4-mini',
    classificationTemperature: 0, // Spec §6 Stage 5: temperature 0
    maxKeywordsToClassify: 200,   // master pool cap
  },

  keywords: {
    maxPrimary: 2,
    maxSecondary: 10,
  },

  // Stage-7 uniqueness controls (Spec §7.3, §15.6). REQUIRED guardrails.
  uniqueness: {
    minBodyWordCount: 600,          // ≥ 600 words of unique body copy
    crossPageSimilarityThreshold: 0.80, // block if L3 body too similar to a sibling page
    competitorOverlapThreshold: 0.80,   // plagiarism block vs scraped competitor copy
    requireLocalSpecificsBlock: true,
  },

  // Internal-link caps (Spec §16, §18) to avoid manipulative sibling patterns.
  internalLinks: {
    maxTotal: 12,
    maxSiblingLocations: 3,
  },

  // Caching TTLs for billed API calls (Spec §14). Milliseconds.
  cache: {
    serpTtlMs: 7 * 24 * 60 * 60 * 1000,    // 7 days
    semrushTtlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    llmTtlMs: 30 * 24 * 60 * 60 * 1000,    // 30 days
  },

  // Tone-profile usability (Spec §13, §18).
  tone: {
    minSampleCount: 2,
  },
};
