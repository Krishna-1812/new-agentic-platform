// ── Tests for the deterministic pieces (Spec §0.4) ──────────────────────────
// No test framework is configured in this app, so this is a zero-dependency
// runner using Node's built-in assert. Run: node locationPageBuilder/__tests__/run.js

const assert = require('assert');
const url = require('../urlBuilder');
const cat = require('../categoryLogic');
const approval = require('../approval');
const qaEngine = require('../qaEngine');
const schemaGenerator = require('../schemaGenerator');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('URL builder');
test('pageUrl nests service under location', () => {
  assert.strictEqual(url.pageUrl('psychiatrist-brea', 'talk-therapy'), '/locations/psychiatrist-brea/talk-therapy/');
});
test('slugify handles ampersand, accents, apostrophes', () => {
  assert.strictEqual(url.slugify("Teen Psychiatry & Psychotherapy"), 'teen-psychiatry-and-psychotherapy');
  assert.strictEqual(url.slugify("Let's Heal"), 'lets-heal');
});
test('canonicalUrl joins origin without double slash', () => {
  assert.strictEqual(url.canonicalUrl('https://x.com/', 'loc', 'svc'), 'https://x.com/locations/loc/svc/');
});

console.log('Category logic (Spec §5)');
test('medication → symptoms block', () => {
  assert.strictEqual(cat.benefitsOrSymptoms('medication', 'Medication Management', 'Brea').section_type, 'symptoms');
});
test('condition → causes decision-support', () => {
  assert.strictEqual(cat.decisionSupport('condition', 'Depression Treatment', 'Brea').section_type, 'causes');
});
test('procedure → what_to_expect + secondary when_to_consider', () => {
  const d = cat.decisionSupport('procedure', 'TMS Therapy', 'Brea');
  assert.strictEqual(d.section_type, 'what_to_expect');
  assert.strictEqual(d.secondary.section_type, 'when_to_consider');
});
test('therapy → conditions heading present, medication → null', () => {
  assert.ok(cat.conditionsTreatedHeading('therapy', 'Talk Therapy', 'Brea'));
  assert.strictEqual(cat.conditionsTreatedHeading('medication', 'Medication Management', 'Brea'), null);
});
test('orderConditions leads with relevant for Talk Therapy', () => {
  const ordered = cat.orderConditions('Talk Therapy', ['OCD', 'Depression', 'Anxiety', 'PTSD']);
  assert.strictEqual(ordered[0], 'Anxiety');
});

console.log('Approval state machine (Spec §10)');
test('clinical gate only applies to YMYL', () => {
  assert.deepStrictEqual(approval.applicableGates({ _ymyl: true }), ['seo', 'clinical', 'content', 'client']);
  assert.deepStrictEqual(approval.applicableGates({ _ymyl: false }), ['seo', 'content', 'client']);
});
test('cannot approve content before seo', () => {
  const page = { _ymyl: false, approval_status: { seo: 'pending', content: 'pending', client: 'pending' } };
  assert.throws(() => approval.approveGate(page, 'content'));
});
test('SEO gate blocked when QA has blocking failures', () => {
  const page = { _ymyl: false, approval_status: { seo: 'pending', content: 'pending', client: 'pending' } };
  assert.throws(() => approval.approveGate(page, 'seo', { qaBlockingFailures: 2 }));
});
test('approving last gate → Client Approved', () => {
  const page = { _ymyl: false, approval_status: { seo: 'approved', content: 'approved', client: 'pending' } };
  const r = approval.approveGate(page, 'client');
  assert.strictEqual(r.status, approval.STATUS.CLIENT_APPROVED);
});
test('editing resets approved gates', () => {
  const page = { _ymyl: false, approval_status: { seo: 'approved', content: 'approved', client: 'pending' } };
  const r = approval.resetGatesAfterEdit(page);
  assert.deepStrictEqual(r.reset.sort(), ['content', 'seo']);
  assert.strictEqual(r.approval_status.seo, 'pending');
});
test('only owning role can act; admin overrides', () => {
  assert.ok(approval.canActOn('clinical', 'clinical'));
  assert.ok(!approval.canActOn('clinical', 'seo'));
  assert.ok(approval.canActOn('clinical', 'admin'));
});

console.log('QA engine (Spec §9)');
function minimalPage() {
  const copy = 'word '.repeat(120);
  return {
    meta: { service_id: 'svc1' },
    global_template: { brand_name: 'Brand', business_type: 'MedicalBusiness' },
    location_data: {
      location_name: 'Brea', city: 'Brea', state: 'California', state_abbreviation: 'CA',
      street_address: '1 Main', phone_number: '(877) 000-0000', zip_code: '92821',
      location_slug: 'psychiatrist-brea', location_page_url: '/locations/psychiatrist-brea/',
      hero_image_url: 'https://x.com/brea.jpg', hero_image_alt: 'Office in Brea, CA',
      nearby_areas: ['Fullerton'],
      reviews: [{ reviewer_name: 'A', rating: 5, text: 'great', date: '2026-01-01' }],
    },
    service_data: { service_name: 'Talk Therapy', service_slug: 'talk-therapy', service_category: 'therapy', conditions_treated: [] },
    page_data: {
      page_url: '/locations/psychiatrist-brea/talk-therapy/',
      canonical_url: 'https://x.com/locations/psychiatrist-brea/talk-therapy/',
      meta_title: 'Talk Therapy in Brea | Brand', h1: 'Effective talk therapy in Brea',
      hero_intro: 'Talk therapy in Brea near Fullerton. ' + copy,
      approach: { heading: 'Our approach to Talk Therapy', intro: 'intro', care_pillars: [
        { heading: 'Our philosophy of compassionate care', copy },
        { heading: 'Clinical therapies offered', copy },
      ] },
      competitor_section: { blocks: [
        { h2: 'What talk therapy involves', h3s: [
          { heading: 'Approach', copy }, { heading: 'Sessions', copy }, { heading: 'Outcomes', copy },
        ] },
      ] },
      services_for_schema: [],
      faqs: Array.from({ length: 7 }, (_, i) => ({ question: `Q${i + 1}`, answer: `A${i + 1}`, faq_type: 'service' })),
      internal_links: [],
    },
  };
}
test('clean page → 0 blocking failures', () => {
  const p = minimalPage();
  p._client = { brand_static: {}, brand_rules: { prohibited_claims: [] } };
  p.page_data.schema = schemaGenerator.generateSchema(p);
  const r = qaEngine.runQA(p, { client: p._client, location: { street_address: '1 Main', phone_number: '(877) 000-0000', services_available_ids: ['svc1'] }, similarity: { similarity: 0 }, competitorOverlap: 0 });
  assert.strictEqual(r.blocking_failures, 0, 'failed: ' + JSON.stringify(r.checks.filter(c => !c.passed)));
});
test('NAP mismatch is a blocking failure', () => {
  const p = minimalPage();
  p._client = { brand_static: {}, brand_rules: { prohibited_claims: [] } };
  p.page_data.schema = schemaGenerator.generateSchema(p);
  const r = qaEngine.runQA(p, { client: p._client, location: { street_address: 'DIFFERENT', phone_number: 'x', services_available_ids: ['svc1'] }, similarity: { similarity: 0 }, competitorOverlap: 0 });
  assert.ok(r.checks.find(c => c.key === 'nap_matches_l2' && !c.passed));
});
test('prohibited claim is caught', () => {
  const p = minimalPage();
  p.page_data.hero_intro = 'We guarantee a cure for everyone. ' + 'word '.repeat(700);
  p._client = { brand_static: {}, brand_rules: { prohibited_claims: ['guarantee a cure'] } };
  p.page_data.schema = schemaGenerator.generateSchema(p);
  const r = qaEngine.runQA(p, { client: p._client, location: { street_address: '1 Main', phone_number: '(877) 000-0000', services_available_ids: ['svc1'] }, similarity: { similarity: 0 }, competitorOverlap: 0 });
  assert.ok(r.checks.find(c => c.key === 'prohibited_claims_absent' && !c.passed));
});
test('FAQ schema mismatch caught', () => {
  const p = minimalPage();
  p._client = { brand_static: {}, brand_rules: { prohibited_claims: [] } };
  p.page_data.schema = schemaGenerator.generateSchema(p);
  p.page_data.faqs.push({ question: 'Q2 added after schema', answer: 'A2' }); // schema now stale
  const r = qaEngine.runQA(p, { client: p._client, location: { street_address: '1 Main', phone_number: '(877) 000-0000', services_available_ids: ['svc1'] }, similarity: { similarity: 0 }, competitorOverlap: 0 });
  assert.ok(r.checks.find(c => c.key === 'faq_schema_matches_visible' && !c.passed));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
