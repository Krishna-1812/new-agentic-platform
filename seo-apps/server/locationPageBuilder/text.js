// ── Text utilities for uniqueness / originality checks (Spec §7.3) ──────────
// Dependency-free. Used by the QA engine and the generator's cross-page check.

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// An office can carry a sub-area label in its `city` field rather than a city
// name -- "Springfield - Main Street", "Springfield Downtown". Nobody searches
// "{service} springfield main street", the keyword universe files those rows
// under the parent city, the Primary eligibility gate needs a literal city
// match, and the page's H1 / title / schema locality all have to name a real
// city -- so every consumer
// resolves the parent city through here. The office's own label is preserved
// separately in `location_name`.
//
// Lives in text.js, not in keywordAdapter, because compose.js needs it too and
// must not pull the SERP/SEMrush/LLM stack in to call one string function.
//
// Two signals, both narrow on purpose. Real multi-word cities ("South
// Pasadena", "Manhattan Beach", "Santa Clarita") match neither and pass
// through unchanged:
//   1. an explicit " - " / " – " separator  -> take the part before it
//   2. a label that LEADS with its own region's city name -> take the region
function baseCity(city, region) {
  const c = String(city || '').trim();
  const split = c.split(/\s+[-–—]\s+/)[0].trim();
  if (split && split !== c) return split;
  const r = String(region || '').trim();
  if (r && c.toLowerCase() !== r.toLowerCase()
        && new RegExp('^' + escapeRegex(r) + '\\s', 'i').test(c)) return r;
  return c;
}

function wordCount(s) {
  const n = normalize(s);
  return n ? n.split(' ').length : 0;
}

// k-word shingles for n-gram overlap similarity.
function shingles(s, k = 3) {
  const words = normalize(s).split(' ').filter(Boolean);
  const set = new Set();
  for (let i = 0; i + k <= words.length; i++) set.add(words.slice(i, i + k).join(' '));
  return set;
}

// Jaccard similarity over shingles → 0..1.
function similarity(a, b, k = 3) {
  const A = shingles(a, k), B = shingles(b, k);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const sh of A) if (B.has(sh)) inter++;
  return inter / (A.size + B.size - inter);
}

// Flatten a page_data object into a single body string for comparison.
function pageBodyText(pageData = {}) {
  const parts = [];
  const push = (v) => { if (typeof v === 'string' && v.trim()) parts.push(v); };
  push(pageData.hero_intro);
  push(pageData.approach?.intro);
  (pageData.approach?.care_pillars || []).forEach(p => push(p.copy));
  (pageData.competitor_section?.blocks || []).forEach(b => {
    push(b.h2);
    (b.h3s || []).forEach(h => { push(h.heading); push(h.copy); });
  });
  (pageData.faqs || []).forEach(f => { push(f.question); push(f.answer); });
  return parts.join('\n');
}

module.exports = {
  normalize, escapeRegex, baseCity, wordCount, shingles, similarity, pageBodyText,
};
