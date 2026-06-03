// ── QA / Validation Engine (Spec §9, §15) ──────────────────────────────────
// Runs after generation; gates SEO approval. Each check has severity
// 'block' | 'warn'. blocking_failures > 0 prevents advancing to SEO Approved.

const text = require('./text');
const config = require('./config');
const { slugify } = require('./urlBuilder');

function check(key, severity, passed, detail) {
  return { key, severity, passed: !!passed, detail: detail || '' };
}

// extras: { client, location, modelCopy, similarity }
function runQA(pageObject, extras = {}) {
  const pd = pageObject.page_data;
  const ld = pageObject.location_data;
  const sd = pageObject.service_data;
  const client = extras.client || pageObject._client || {};
  const location = extras.location || {};
  const checks = [];

  const svc = sd.service_name.toLowerCase();
  const loc = ld.location_name.toLowerCase();

  // Location image matches the selected location (heuristic: alt/url mention location)
  const imgHay = `${ld.hero_image_url} ${ld.hero_image_alt}`.toLowerCase();
  const imgOk = !ld.hero_image_url || imgHay.includes(loc) || imgHay.includes((ld.city || '').toLowerCase());
  checks.push(check('location_image_matches', 'block', imgOk,
    imgOk ? 'Hero image references the selected location.' : `Hero image may belong to another city (alt/url: "${ld.hero_image_alt}").`));

  // NAP matches the L2 record
  const napOk = location.street_address ? (ld.street_address === location.street_address && ld.phone_number === location.phone_number) : true;
  checks.push(check('nap_matches_l2', 'block', napOk,
    napOk ? 'Address & phone match the L2 location record.' : 'Address/phone differ from the L2 source of truth.'));

  // URL/canonical use correct slugs
  const wantUrl = `/locations/${slugify(ld.location_slug)}/${slugify(sd.service_slug)}/`;
  const urlOk = pd.page_url === wantUrl && (pd.canonical_url || '').endsWith(wantUrl);
  checks.push(check('url_slugs_correct', 'block', urlOk,
    urlOk ? 'Page URL & canonical use the correct location + service slugs.' : `Expected ${wantUrl}, got ${pd.page_url}.`));

  // meta_title includes service + location
  const mt = (pd.meta_title || '').toLowerCase();
  checks.push(check('meta_title_has_service_location', 'block', mt.includes(svc) && mt.includes(loc),
    `meta_title: "${pd.meta_title}"`));

  // h1 includes service + location
  const h1 = (pd.h1 || '').toLowerCase();
  checks.push(check('h1_has_service_location', 'block', h1.includes(svc) && h1.includes(loc),
    `h1: "${pd.h1}"`));

  // FAQ schema mirrors visible FAQs
  const visibleQ = (pd.faqs || []).map(f => (f.question || '').trim()).filter(Boolean);
  const schemaQ = (pd.schema?.faq_page?.mainEntity || []).map(e => (e.name || '').trim());
  const faqOk = visibleQ.length === schemaQ.length && visibleQ.every((q, i) => q === schemaQ[i]);
  checks.push(check('faq_schema_matches_visible', 'block', faqOk,
    faqOk ? `${visibleQ.length} FAQs mirrored in schema.` : 'FAQ schema does not match visible FAQs exactly.'));

  // Review/AggregateRating schema uses only approved real reviews
  const ratingInSchema = !!pageObject.page_data.schema?.local_business?.aggregateRating;
  const hasApprovedReviews = (ld.reviews || []).length > 0;
  const reviewOk = !ratingInSchema || hasApprovedReviews;
  checks.push(check('reviews_real_only', 'block', reviewOk,
    reviewOk ? 'Review schema only present when approved reviews exist.' : 'aggregateRating present without approved reviews.'));

  // Service actually available at the location
  const available = (location.services_available_ids || []).includes(pageObject.meta.service_id);
  checks.push(check('service_available_at_location', 'block', location.services_available_ids ? available : true,
    available ? 'Service is offered at this location.' : 'Service is NOT listed as available at this location.'));

  // Internal links resolve (have non-empty targets)
  const links = pd.internal_links || [];
  const linksOk = links.every(l => l.url && l.anchor_text);
  checks.push(check('internal_links_resolve', 'warn', linksOk,
    `${links.length} internal links.`));

  // Uniqueness: word count + similarity + local-specifics woven into the body
  const body = text.pageBodyText(pd);
  const wc = text.wordCount(body);
  const wcOk = wc >= config.uniqueness.minBodyWordCount;
  const bodyLc = body.toLowerCase();
  const localOk = !config.uniqueness.requireLocalSpecificsBlock
    || bodyLc.includes(loc) || (ld.nearby_areas || []).some(a => bodyLc.includes(a.toLowerCase()));
  const sim = extras.similarity?.similarity || 0;
  const simOk = sim < config.uniqueness.crossPageSimilarityThreshold;
  const uniqueOk = wcOk && localOk && simOk;
  checks.push(check('uniqueness_thresholds', 'block', uniqueOk,
    `word_count=${wc} (min ${config.uniqueness.minBodyWordCount}), local_specifics=${localOk ? 'present' : 'MISSING'}, max_sibling_similarity=${(sim * 100).toFixed(0)}% (max ${(config.uniqueness.crossPageSimilarityThreshold * 100)}%).`));

  // Required structure: approach has the 2 required H3s; competitor section ≥1 H2 + 3 H3s; 7-11 FAQs
  const pillarHeadings = (pd.approach?.care_pillars || []).map(p => (p.heading || '').toLowerCase());
  const approachOk = pillarHeadings.includes('our philosophy of compassionate care') && pillarHeadings.includes('clinical therapies offered')
    && (pd.approach.care_pillars || []).every(p => (p.copy || '').trim());
  checks.push(check('approach_section_present', 'block', approachOk,
    approachOk ? 'Approach has both required H3s with copy.' : 'Approach must include "Our philosophy of compassionate care" and "Clinical therapies offered" with copy.'));

  const blocks = pd.competitor_section?.blocks || [];
  const h3Count = blocks.reduce((n, b) => n + (b.h3s || []).length, 0);
  const compOk = blocks.length >= 1 && h3Count >= 3 && blocks.every(b => b.h2 && (b.h3s || []).every(h => h.heading && h.copy));
  checks.push(check('competitor_section_structure', 'block', compOk,
    `H2 blocks=${blocks.length}, H3s=${h3Count} (min 1 H2 + 3 H3s; recommended 2 H2 + 5 H3s).`));

  const faqCount = (pd.faqs || []).length;
  checks.push(check('faq_count_7_to_11', 'warn', faqCount >= 7 && faqCount <= 11,
    `${faqCount} FAQs (target 7-11).`));

  // Originality vs competitor copy
  const overlap = extras.competitorOverlap || 0;
  const origOk = overlap < config.uniqueness.competitorOverlapThreshold;
  checks.push(check('originality_vs_competitors', 'block', origOk,
    `max competitor overlap=${(overlap * 100).toFixed(0)}% (max ${(config.uniqueness.competitorOverlapThreshold * 100)}%).`));

  // Prohibited claims absent (brand rules / YMYL)
  const prohibited = (client.brand_rules?.prohibited_claims || []).filter(p => bodyLc.includes(p.toLowerCase()));
  checks.push(check('prohibited_claims_absent', 'block', prohibited.length === 0,
    prohibited.length ? `Found prohibited claims: ${prohibited.join(', ')}` : 'No prohibited claims detected.'));

  const blocking_failures = checks.filter(c => c.severity === 'block' && !c.passed).length;
  const warnings = checks.filter(c => c.severity === 'warn' && !c.passed).length;

  return { checks, blocking_failures, warnings, ran_at: new Date().toISOString() };
}

module.exports = { runQA };
