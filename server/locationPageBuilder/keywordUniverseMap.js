// ── Keyword universe service map ─────────────────────────────────────────────
// Maps each Gentle Dental service (see seed.js GD_SERVICE_DEFS) to the
// Cluster/Pillar taxonomy used in the client-supplied keyword universe CSV
// (columns: Keyword, Semrush SV, Pillar, Cluster, Subtopic, Geo Type,
// Geo Detected, Data Confidence). A handful of services have no dedicated
// Cluster in that taxonomy (Digital X-rays, Fluoride Treatment, Oral Cancer
// Screening, Sealants, Cavity Prevention) — these are exactly the "too niche"
// services the live SERP+SEMrush pull fails on, so they fall back to a
// Pillar-level match plus a keyword-text filter (`textMatch`).
//
// `terms` (every service) is separate from the universe lookup: it's a
// relevance filter for the LIVE SERP+SEMrush pool, which borrows whatever a
// competitor's page ranks for — with no topical filter at all, that pool is
// dominated by unrelated brand/generic-dentist terms for niche services (e.g.
// "Veneers" pulled in "vanguard dental", "dentist manchester nh", etc. with
// no veneers-specific term at all). A live-pool keyword is kept only if it
// contains one of these substrings.

const SERVICE_UNIVERSE_MAP = {
  'teeth-whitening': { clusters: ['Teeth Whitening'], terms: ['whiten', 'bleach'] },
  'veneers': { clusters: ['Veneers'], terms: ['veneer'] },
  'smile-makeover': { clusters: ['Smile Makeover & Cosmetic (General)'], terms: ['smile makeover', 'smile design', 'cosmetic dentist'] },
  'invisalign-treatment': { clusters: ['Invisalign & Clear Aligners'], terms: ['invisalign', 'clear aligner'] },
  'crowns-and-bridges': { clusters: ['Crowns & Bridges'], terms: ['crown', 'bridge'] },
  'dental-fillings': { clusters: ['Dental Fillings'], terms: ['filling'] },
  'root-canals': { clusters: ['Root Canal & Endodontics'], terms: ['root canal', 'endodont'] },
  'gum-treatments': { clusters: ['Gum Disease & Periodontics'], terms: ['gum disease', 'gum treatment', 'periodont', 'gingivitis'] },
  'dentures': { clusters: ['Dentures & Partials'], terms: ['denture'] },
  'dental-implants': { clusters: ['Dental Implants'], terms: ['implant'] },
  'teeth-extractions': { clusters: ['Tooth Extraction'], terms: ['extraction', 'pulled tooth', 'tooth pulled'] },
  'wisdom-teeth-extractions': { clusters: ['Wisdom Teeth Removal'], terms: ['wisdom teeth', 'wisdom tooth'] },
  'braces': { clusters: ['Braces', 'Bite & Alignment Issues'], terms: ['brace', 'orthodont'] },
  'dental-exam': { clusters: ['Teeth Cleaning & Exams'], terms: ['exam', 'checkup', 'check-up', 'check up'] },
  'dental-cleaning': { clusters: ['Teeth Cleaning & Exams'], terms: ['cleaning'] },
  'emergency-dentist': { clusters: ['Emergency Dental Care'], terms: ['emergency'] },
  'pediatric-dentistry': { clusters: ['Pediatric Dentistry'], terms: ['pediatric', 'kids dentist', 'children dentist', 'kid-friendly'] },
  'sedation-dentistry': { clusters: ['Sedation & Dental Anxiety'], terms: ['sedation', 'dental anxiety', 'sleep dentistry'] },
  'sleep-apnea-treatment': { clusters: ['Sleep Apnea & Snoring'], terms: ['sleep apnea', 'snoring'] },
  'tmd-tmj-treatment': { clusters: ['TMJ / TMD & Bruxism'], terms: ['tmj', 'tmd', 'jaw pain', 'bruxism'] },

  // No dedicated Cluster, and the CSV's own topic classifier files these
  // under whatever Pillar/Cluster its model guessed (e.g. "sealants" landed
  // under Specialty Care > Pediatric Dentistry, not Preventive & General
  // Care) — that guess isn't reliable enough to filter on, so match the
  // keyword text itself (SQL ILIKE), across the whole universe, instead.
  'digital-x-rays': { keywordLike: ['%x-ray%', '%xray%'], terms: ['x-ray', 'xray'] },
  'fluoride-treatment': { keywordLike: ['%fluoride%'], terms: ['fluoride'] },
  'oral-cancer-screening': { keywordLike: ['%oral cancer%'], terms: ['oral cancer'] },
  'dental-sealants': { keywordLike: ['%sealant%'], terms: ['sealant'] },
  'curodont': { keywordLike: ['%cavity%', '%cavities%', '%curodont%', '%decay%'], terms: ['cavity', 'cavities', 'curodont', 'decay'] },
  'diabetes-and-oral-health': { keywordLike: ['%diabet%'], terms: ['diabet'] },
  // ── Added with the client's full taxonomy ────────────────────────────────
  // Split out of Crowns & Bridges, so they narrow that cluster's terms.
  'dental-crowns': { clusters: ['Crowns & Bridges'], terms: ['crown'] },
  'dental-bridges': { clusters: ['Crowns & Bridges'], terms: ['bridge'] },
  // Singular counterpart of teeth-extractions; same cluster, same pool.
  'tooth-extraction': { clusters: ['Tooth Extraction'], terms: ['extraction', 'pulled tooth', 'tooth pulled', 'tooth removal'] },
  // Sibling of tmd-tmj-treatment.
  'tmj-treatment': { clusters: ['TMJ / TMD & Bruxism'], terms: ['tmj', 'tmd', 'jaw pain', 'bruxism'] },
  // Periodontics as its own page, alongside the gum-treatment procedures.
  'gum-disease-treatment': { clusters: ['Gum Disease & Periodontics'], terms: ['gum disease', 'gum treatment', 'periodont', 'gingivitis'] },

  // Practitioner pages. The searcher is looking for a PERSON, so the terms
  // have to admit "orthodontist near me" style queries, not just procedures.
  'orthodontist': { clusters: ['Braces', 'Invisalign & Clear Aligners', 'Bite & Alignment Issues'], terms: ['orthodont', 'brace', 'aligner'] },
  'periodontist': { clusters: ['Gum Disease & Periodontics'], terms: ['periodont', 'gum disease', 'gum specialist'] },

  // Category hubs. Broad by design: a hub page ranks for the category term
  // itself and for the procedures underneath it, so a narrow filter would
  // throw away most of its real pool.
  'cosmetic-dentistry': {
    clusters: ['Smile Makeover & Cosmetic (General)', 'Teeth Whitening', 'Veneers', 'Invisalign & Clear Aligners'],
    terms: ['cosmetic', 'smile makeover', 'smile design', 'whiten', 'veneer'],
  },
  'restorative-dentistry': {
    clusters: ['Crowns & Bridges', 'Dental Fillings', 'Dental Implants', 'Dentures & Partials', 'Root Canal & Endodontics'],
    terms: ['restorative', 'crown', 'bridge', 'filling', 'implant', 'denture', 'root canal'],
  },
  'preventive-dentistry': {
    clusters: ['Teeth Cleaning & Exams'],
    terms: ['preventive', 'preventative', 'cleaning', 'exam', 'checkup', 'check-up', 'hygiene'],
  },
  'oral-surgery': {
    clusters: ['Tooth Extraction', 'Wisdom Teeth Removal', 'Dental Implants'],
    terms: ['oral surgery', 'oral surgeon', 'extraction', 'wisdom teeth', 'surgical'],
  },
  // The Specialty hub, covering the specialist services beneath it.
  'specialty-care': {
    clusters: ['Sedation & Dental Anxiety', 'Sleep Apnea & Snoring', 'TMJ / TMD & Bruxism', 'Pediatric Dentistry', 'Emergency Dental Care'],
    terms: ['specialty', 'specialist', 'sedation', 'sleep apnea', 'tmj', 'tmd', 'pediatric', 'emergency'],
  },
  // No dental cluster covers injectables, so match the keyword text.
  'botox-cosmetic-and-injectables': {
    keywordLike: ['%botox%', '%injectable%', '%filler%', '%dermal%'],
    terms: ['botox', 'injectable', 'filler', 'dermal', 'wrinkle'],
  },
  'orthodontics': {
    clusters: ['Braces', 'Invisalign & Clear Aligners', 'Bite & Alignment Issues'],
    terms: ['orthodont', 'brace', 'aligner', 'invisalign', 'overbite', 'underbite', 'crooked'],
  },
};

function universeFilterFor(serviceSlug) {
  return SERVICE_UNIVERSE_MAP[serviceSlug] || null;
}

function relevanceTermsFor(serviceSlug) {
  return SERVICE_UNIVERSE_MAP[serviceSlug]?.terms || null;
}

// ── Derived relevance terms ─────────────────────────────────────────────────
// The map above is Gentle Dental's, hand-written per service. Every other
// client falls through it and got NULL, which the live-pool filter reads as
// "no topical filter at all" -- so every keyword every competitor URL ranks
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
