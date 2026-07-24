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

// ── Dental (Gentle Dental) QC — Build Brief §6 ──────────────────────────────
// Returns { verdict, checks: [{name, severity, pass, detail}] } per the brief's
// QcResult contract. NAP-populated is downgraded to Minor in v1 — NAP is
// populated manually (out of scope for this build), so it must not block
// generation the way a truly-missing-NAP bug would.

function qc(name, severity, pass, detail) {
  return { name, severity, pass: !!pass, detail: detail || '' };
}

function dentalStripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Deterministic fields (H1/title) are built as "{Service} in {City}, {STATE}"
// — real-world primary keywords are usually the bare "{service} {city}" form
// (no "in", no comma), so a literal substring check would fail almost every
// legitimate page. Match on the keyword's significant words instead.
const STOPWORDS = new Set(['in', 'the', 'a', 'an', 'of', 'for', 'near', 'me', 'and']);
// Light plural/singular stemming — service names are plural ("Root Canals",
// "Veneers") but a chosen primary keyword is often the singular, bare form
// ("root canal malden ma"). Without this, "canal" vs "canals" never match as
// the same word even though they're an obvious close variant. Good enough
// for this domain's regular plurals; not a real stemmer.
function stem(word) {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}
function words(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).map(stem);
}
function containsAllKeywordWords(haystack, phrase, exclude) {
  const hayWords = new Set(words(haystack));
  const kwWords = words(phrase).filter(w => !STOPWORDS.has(w) && !(exclude && exclude.has(w)));
  return kwWords.length > 0 && kwWords.every(w => hayWords.has(w));
}

// Counts "close variant" occurrences of a keyword phrase in body text: slides
// a word-window across the text and counts it as one occurrence whenever all
// of the keyword's significant words appear together within that window (so
// "veneers in Boston" / "Boston veneers" / "porcelain veneers for Boston
// patients" all count) — a literal-substring match would miss all of these.
// Non-overlapping: after a match, the window jumps forward so the same run of
// words can't be counted twice.
function countKeywordOccurrences(bodyText, keywordWords, window = 8) {
  if (!keywordWords.length) return 0;
  const bodyWords = words(bodyText);
  let count = 0;
  let i = 0;
  while (i < bodyWords.length) {
    const slice = new Set(bodyWords.slice(i, i + window));
    if (keywordWords.every(w => slice.has(w))) {
      count++;
      i += window;
    } else {
      i++;
    }
  }
  return count;
}

function runDentalQC(scaffold) {
  const m = scaffold.meta;
  const sec = scaffold.sections;
  const primary = (scaffold.primaryKeyword || '').toLowerCase().trim();
  const h1Match = /^(.*) in (.+),\s*([A-Za-z]{2})$/.exec(sec.hero.h1.trim());
  const city = (h1Match?.[2] || '').toLowerCase();
  const stateAbbr = (h1Match?.[3] || '').toLowerCase();
  const checks = [];

  const hay = (s) => String(s || '').toLowerCase();
  const h1 = hay(sec.hero.h1), title = hay(m.title), metaDesc = hay(m.metaDescription);

  // ── Critical ────────────────────────────────────────────────────────────
  checks.push(qc('primary_keyword_in_h1_title_meta', 'Critical',
    primary && containsAllKeywordWords(h1, primary) && containsAllKeywordWords(title, primary) && containsAllKeywordWords(metaDesc, primary),
    `primary="${scaffold.primaryKeyword}"`));

  const mdLen = (m.metaDescription || '').length;
  checks.push(qc('meta_description_length', 'Critical', mdLen >= 150 && mdLen <= 160,
    `meta_description length=${mdLen} (target 150-160)`));

  const faqCount = (sec.faq.items || []).length;
  checks.push(qc('faq_count_min_4', 'Critical', faqCount >= 4, `${faqCount} FAQs (min 4).`));

  const schemaBlocks = scaffold.schema || {};
  const schemaKeys = ['breadcrumbList', 'dentist', 'medicalWebPage', 'medicalProcedure', 'faqPage'];
  const schemaParses = schemaKeys.every(k => {
    try { JSON.parse(schemaBlocks[k] || ''); return true; } catch { return false; }
  });
  checks.push(qc('schema_blocks_valid_json', 'Critical', schemaParses, '5 JSON-LD blocks parse.'));

  // ── Major ───────────────────────────────────────────────────────────────
  const h2s = (sec.educationalBody.blocks || []).map(b => hay(b.h2));
  const eduBodies = (sec.educationalBody.blocks || []).map(b => hay(dentalStripHtml(b.html)));
  // H2 headings are short topic labels — they won't naturally include the full
  // "{service} {city} {state}" primary phrase (city/state coverage is checked
  // separately by city_localization below). Match on the service-only terms.
  const geoExclude = new Set([stateAbbr, ...words(city)]);
  const h2ServiceMatch = h2s.some(h => containsAllKeywordWords(h, primary, geoExclude));
  checks.push(qc('primary_keyword_in_h2', 'Major', primary && h2ServiceMatch,
    'Primary keyword\'s service terms appear in >= 1 educationalBody H2.'));

  // hero.intro is generated content again (short description below the H1) —
  // it counts toward body word count / keyword frequency / localization, same
  // as educationalBody + faq. servicesInCity.intro stays in the join too
  // (harmless — usually empty, it's optional/manual).
  const bodyText = [
    sec.hero.intro, sec.servicesInCity.intro,
    ...(sec.educationalBody.blocks || []).map(b => dentalStripHtml(b.html)),
    ...(sec.faq.items || []).flatMap(f => [f.q, f.a]),
  ].join(' ');
  const wc = text.wordCount(bodyText);
  checks.push(qc('body_word_count_500_900', 'Major', wc >= 500 && wc <= 900, `word_count=${wc} (target 500-900).`));

  // Primary keyword (or a close variant) must appear 5x across hero/body/FAQ,
  // NOT counting metaDescription (bodyText already excludes it).
  const freqExclude = new Set([stateAbbr]);
  const freqWords = words(primary).filter(w => !STOPWORDS.has(w) && !freqExclude.has(w));
  const keywordOccurrences = countKeywordOccurrences(bodyText, freqWords);
  checks.push(qc('primary_keyword_frequency_5x', 'Major', primary && keywordOccurrences >= 5,
    `Primary keyword (or close variants) appears ${keywordOccurrences}x across hero/body/FAQ (target >= 5, meta description excluded).`));

  const cityInBody = city && eduBodies.some(t => t.includes(city));
  const cityInFaq = city && (sec.faq.items || []).some(f => hay(f.q).includes(city) || hay(f.a).includes(city));
  checks.push(qc('city_localization', 'Major', cityInBody && cityInFaq,
    `city="${city}" in educationalBody=${cityInBody}, in FAQ=${cityInFaq}.`));

  const linkCount = (sec.servicesInCity.internalLinks || []).length;
  checks.push(qc('internal_links_min_3', 'Major', linkCount >= 3, `${linkCount} internal links (min 3).`));

  // ── Minor ───────────────────────────────────────────────────────────────
  const emDashOveruse = (bodyText.match(/—/g) || []).length > 2;
  const oxfordComma = /,\s+and\s+\w+[.,]/i.test(bodyText) && /\w+,\s+\w+,\s+and\s+\w+/.test(bodyText);
  const spelledTenPlus = /\b(ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|forty|fifty)\b/i.test(bodyText);
  checks.push(qc('ap_style', 'Minor', !emDashOveruse && !oxfordComma && !spelledTenPlus,
    `em_dash_overuse=${emDashOveruse}, oxford_comma=${oxfordComma}, spelled_10_plus=${spelledTenPlus}.`));

  const density = wc ? keywordOccurrences / wc : 0;
  checks.push(qc('keyword_density', 'Minor', density <= 0.025, `density=${(density * 100).toFixed(1)}% based on ${keywordOccurrences} occurrences (max 2.5%).`));

  const placeholderRe = /lorem ipsum|\{\{|\btodo\b|\bTBD\b/i;
  checks.push(qc('no_placeholder_text', 'Minor', !placeholderRe.test(bodyText), 'No placeholder text detected.'));

  const napPopulated = !!(sec.officeInfo.address && sec.officeInfo.phone && Object.keys(sec.officeInfo.hoursByDay || {}).length);
  checks.push(qc('nap_populated', 'Minor', napPopulated,
    napPopulated ? 'NAP fields populated.' : 'NAP is populated manually (out of scope) — currently empty.'));

  const criticalFail = checks.some(c => c.severity === 'Critical' && !c.pass);
  const majorFail = checks.some(c => c.severity === 'Major' && !c.pass);
  const minorFail = checks.some(c => c.severity === 'Minor' && !c.pass);
  const verdict = criticalFail ? 'FAIL' : majorFail ? 'REVISIONS REQUIRED' : minorFail ? 'CONDITIONAL PASS' : 'PASS';

  return { verdict, checks };
}

module.exports = { runQA, runDentalQC };
