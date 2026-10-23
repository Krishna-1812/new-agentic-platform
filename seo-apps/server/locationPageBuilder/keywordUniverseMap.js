// ── Keyword universe service map ─────────────────────────────────────────────
// Maps a service slug to the Cluster/Pillar taxonomy used in a client-supplied
// keyword universe CSV (columns: Keyword, Semrush SV, Pillar, Cluster,
// Subtopic, Geo Type, Geo Detected, Data Confidence; see
// scripts/importKeywordUniverse.js). An entry takes one of two shapes:
//
//   { clusters: ['Cluster A', ...], terms: [...] }
//       rows whose Cluster is one of these
//   { keywordLike: ['%text%', ...], terms: [...] }
//       for a service with no dedicated Cluster: match the keyword text itself
//       (SQL ILIKE) across the whole universe instead
//
// `terms` (every entry) is separate from the universe lookup: it's a
// relevance filter for the LIVE SERP+SEMrush pool, which borrows whatever a
// competitor's page ranks for. A live-pool keyword is kept only if it contains
// one of these substrings.
//
// No client currently has a curated map. A service without an entry gets no
// universe rows and falls back to terms derived from its name (see
// relevanceTermsForService below).

const SERVICE_UNIVERSE_MAP = {};

function universeFilterFor(serviceSlug) {
  return SERVICE_UNIVERSE_MAP[serviceSlug] || null;
}

function relevanceTermsFor(serviceSlug) {
  return SERVICE_UNIVERSE_MAP[serviceSlug]?.terms || null;
}

// ── Derived relevance terms ─────────────────────────────────────────────────
// A service with no curated entry used to get NULL, which the live-pool filter
// reads as "no topical filter at all" -- so every keyword every competitor URL ranks
// for entered the pool. For "Anxiety in Anaheim Hills" that meant the pool was
// almost entirely veterinary and dental: "anaheim hills pet clinic" (1,900),
// "anaheim hills dentist" (480), "route 66 emergency vet". Volume-sorted, the
// page's own topic never appeared at all.
//
// So derive terms from the service NAME when there is no curated entry. This
// is a floor, not a replacement: a curated entry always wins, because it can
// carry synonyms a name cannot ("teeth whitening" -> bleach).

// Words that describe the PROGRAM or the audience rather than the topic. A
// page for "Teen Depression" is about depression; keeping "teen" as a term
// would also admit "teen dentist". Dropped only when something distinctive
// survives -- a service actually called "Addiction" keeps it.
const GENERIC_SERVICE_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from',
  'teen', 'teens', 'adult', 'adults', 'child', 'children', 'kids', 'family',
  'virtual', 'online', 'evening', 'daytime',
  'inpatient', 'outpatient', 'residential', 'partial', 'intensive',
  'program', 'programs', 'treatment', 'treatments', 'therapy', 'therapies',
  'care', 'service', 'services', 'support', 'group', 'groups',
  'dual', 'diagnosis', 'management', 'center', 'centre', 'clinic', 'health',
  'addiction', 'addictions',
]);

// Singularize so a term matches its plural in the keyword (matching is a
// substring test, so the SHORTER form is the useful one): "addictions" in a
// keyword is still matched by the term "addiction".
function singular(word) {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

function deriveRelevanceTerms(serviceName) {
  const cleaned = String(serviceName || '')
    .replace(/\([^)]*\)/g, ' ')   // "(IOP)", "(PTSD)" -- the acronym is not the topic
    .replace(/[^a-zA-Z0-9\s-]/g, ' ') // trademark signs, ampersands, slashes
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const words = cleaned.split(' ').filter(w => w.length > 2);
  if (!words.length) return null;
  const distinctive = words.filter(w => !GENERIC_SERVICE_WORDS.has(w));
  // Fall back to every word when the name is ENTIRELY generic ("Family
  // Therapy", "Medication Management"): a loose filter still beats none.
  const terms = [...new Set((distinctive.length ? distinctive : words).map(singular))];
  return terms.length ? terms : null;
}

// What the live-pool filter should use for a service: the curated entry if one
// exists, otherwise a set derived from the name.
function relevanceTermsForService(serviceSlug, serviceName) {
  return relevanceTermsFor(serviceSlug) || deriveRelevanceTerms(serviceName);
}

module.exports = {
  SERVICE_UNIVERSE_MAP, universeFilterFor, relevanceTermsFor,
  relevanceTermsForService, deriveRelevanceTerms, GENERIC_SERVICE_WORDS,
};
