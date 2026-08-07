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
  'invisalign': { clusters: ['Invisalign & Clear Aligners'], terms: ['invisalign', 'clear aligner'] },
  'crowns-bridges': { clusters: ['Crowns & Bridges'], terms: ['crown', 'bridge'] },
  'dental-fillings': { clusters: ['Dental Fillings'], terms: ['filling'] },
  'root-canals': { clusters: ['Root Canal & Endodontics'], terms: ['root canal', 'endodont'] },
  'gum-treatments': { clusters: ['Gum Disease & Periodontics'], terms: ['gum disease', 'gum treatment', 'periodont', 'gingivitis'] },
  'partial-and-full-dentures': { clusters: ['Dentures & Partials'], terms: ['denture'] },
  'implants': { clusters: ['Dental Implants'], terms: ['implant'] },
  'extractions': { clusters: ['Tooth Extraction'], terms: ['extraction', 'pulled tooth', 'tooth pulled'] },
  'wisdom-teeth-extractions': { clusters: ['Wisdom Teeth Removal'], terms: ['wisdom teeth', 'wisdom tooth'] },
  'braces': { clusters: ['Braces', 'Bite & Alignment Issues'], terms: ['brace', 'orthodont'] },
  'exams': { clusters: ['Teeth Cleaning & Exams'], terms: ['exam', 'checkup', 'check-up', 'check up'] },
  'cleanings': { clusters: ['Teeth Cleaning & Exams'], terms: ['cleaning'] },
  'emergency-dental-care': { clusters: ['Emergency Dental Care'], terms: ['emergency'] },
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
  'sealants': { keywordLike: ['%sealant%'], terms: ['sealant'] },
  'curodont': { keywordLike: ['%cavity%', '%cavities%', '%curodont%', '%decay%'], terms: ['cavity', 'cavities', 'curodont', 'decay'] },
  'diabetes-and-oral-health': { keywordLike: ['%diabet%'], terms: ['diabet'] },
};

function universeFilterFor(serviceSlug) {
  return SERVICE_UNIVERSE_MAP[serviceSlug] || null;
}

function relevanceTermsFor(serviceSlug) {
  return SERVICE_UNIVERSE_MAP[serviceSlug]?.terms || null;
}

module.exports = { SERVICE_UNIVERSE_MAP, universeFilterFor, relevanceTermsFor };
