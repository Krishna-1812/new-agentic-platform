// ── Keyword universe service map ─────────────────────────────────────────────
// Maps each Gentle Dental service (see seed.js GD_SERVICE_DEFS) to the
// Cluster/Pillar taxonomy used in the client-supplied keyword universe CSV
// (columns: Keyword, Semrush SV, Pillar, Cluster, Subtopic, Geo Type,
// Geo Detected, Data Confidence). A handful of services have no dedicated
// Cluster in that taxonomy (Digital X-rays, Fluoride Treatment, Oral Cancer
// Screening, Sealants, Cavity Prevention) — these are exactly the "too niche"
// services the live SERP+SEMrush pull fails on, so they fall back to a
// Pillar-level match plus a keyword-text filter (`textMatch`).

const SERVICE_UNIVERSE_MAP = {
  'teeth-whitening': { clusters: ['Teeth Whitening'] },
  'veneers': { clusters: ['Veneers'] },
  'smile-makeover': { clusters: ['Smile Makeover & Cosmetic (General)'] },
  'invisalign': { clusters: ['Invisalign & Clear Aligners'] },
  'crowns-bridges': { clusters: ['Crowns & Bridges'] },
  'dental-fillings': { clusters: ['Dental Fillings'] },
  'root-canals': { clusters: ['Root Canal & Endodontics'] },
  'gum-treatments': { clusters: ['Gum Disease & Periodontics'] },
  'partial-and-full-dentures': { clusters: ['Dentures & Partials'] },
  'implants': { clusters: ['Dental Implants'] },
  'extractions': { clusters: ['Tooth Extraction'] },
  'wisdom-teeth-extractions': { clusters: ['Wisdom Teeth Removal'] },
  'braces': { clusters: ['Braces', 'Bite & Alignment Issues'] },
  'exams': { clusters: ['Teeth Cleaning & Exams'] },
  'cleanings': { clusters: ['Teeth Cleaning & Exams'] },
  'emergency-dental-care': { clusters: ['Emergency Dental Care'] },
  'pediatric-dentistry': { clusters: ['Pediatric Dentistry'] },
  'sedation-dentistry': { clusters: ['Sedation & Dental Anxiety'] },
  'sleep-apnea-treatment': { clusters: ['Sleep Apnea & Snoring'] },
  'tmd-tmj-treatment': { clusters: ['TMJ / TMD & Bruxism'] },

  // No dedicated Cluster, and the CSV's own topic classifier files these
  // under whatever Pillar/Cluster its model guessed (e.g. "sealants" landed
  // under Specialty Care > Pediatric Dentistry, not Preventive & General
  // Care) — that guess isn't reliable enough to filter on, so match the
  // keyword text itself (SQL ILIKE), across the whole universe, instead.
  'digital-x-rays': { keywordLike: ['%x-ray%', '%xray%'] },
  'fluoride-treatment': { keywordLike: ['%fluoride%'] },
  'oral-cancer-screening': { keywordLike: ['%oral cancer%'] },
  'sealants': { keywordLike: ['%sealant%'] },
  'curodont': { keywordLike: ['%cavity%', '%cavities%', '%curodont%', '%decay%'] },
  'diabetes-and-oral-health': { keywordLike: ['%diabet%'] },
};

function universeFilterFor(serviceSlug) {
  return SERVICE_UNIVERSE_MAP[serviceSlug] || null;
}

module.exports = { SERVICE_UNIVERSE_MAP, universeFilterFor };
