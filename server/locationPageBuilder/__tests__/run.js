// ── Tests for the deterministic pieces (Spec §0.4) ──────────────────────────
// No test framework is configured in this app, so this is a zero-dependency
// runner using Node's built-in assert. Run: node locationPageBuilder/__tests__/run.js

const assert = require('assert');
const url = require('../urlBuilder');
const cat = require('../categoryLogic');
const approval = require('../approval');
const qaEngine = require('../qaEngine');
const schemaGenerator = require('../schemaGenerator');
const compose = require('../compose');
const internalLinks = require('../internalLinks');

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

console.log('\nDental (Gentle Dental) — URL builder (Build Brief §2.1)');
test('dentalPageUrl appends service slug to the location path', () => {
  assert.strictEqual(url.dentalPageUrl('/dental-offices/ma/quincy', 'teeth-whitening'), '/dental-offices/ma/quincy/teeth-whitening');
});
test('dentalPageUrl handles a location path with a sub-area segment', () => {
  assert.strictEqual(url.dentalPageUrl('/dental-offices/ma/boston/newbury-st', 'veneers'), '/dental-offices/ma/boston/newbury-st/veneers');
});
test('canonicalDentalUrl joins origin without double slash', () => {
  assert.strictEqual(url.canonicalDentalUrl('https://gentledental.com/', '/dental-offices/ma/quincy', 'implants'), 'https://gentledental.com/dental-offices/ma/quincy/implants');
});

console.log('\nDental — scaffold composition');
function dentalLayers() {
  return {
    client: { id: 'client_gentle_dental', name: 'Gentle Dental of New England', brand_static: { base_url: 'https://gentledental.com' } },
    service: { id: 'dsvc_teeth-whitening', name: 'Teeth Whitening', slug: 'teeth-whitening', category: 'Cosmetic' },
    location: {
      id: 'dloc_ma-quincy', location_name: 'Quincy', city: 'Quincy', region: 'South Shore',
      state: 'Massachusetts', state_abbreviation: 'MA', location_page_url: '/dental-offices/ma/quincy',
      street_address: '', phone_number: '', hours_by_day: {}, directions_url: '',
      latitude: '', longitude: '', services_available_ids: ['dsvc_teeth-whitening', 'dsvc_veneers'],
      nap_todo: ['street_address', 'phone_number', 'hours_by_day'],
    },
    allServices: [
      { id: 'dsvc_teeth-whitening', name: 'Teeth Whitening', slug: 'teeth-whitening', category: 'Cosmetic' },
      { id: 'dsvc_veneers', name: 'Veneers', slug: 'veneers', category: 'Cosmetic' },
    ],
  };
}
test('buildDentalScaffold derives urlPath/title/canonical and a deterministic breadcrumb+menu', () => {
  const scaffold = compose.buildDentalScaffold(dentalLayers());
  assert.strictEqual(scaffold.meta.urlPath, '/dental-offices/ma/quincy/teeth-whitening');
  assert.strictEqual(scaffold.meta.title, 'Teeth Whitening in Quincy, MA | Gentle Dental');
  assert.strictEqual(scaffold.sections.hero.h1, 'Teeth Whitening in Quincy, MA');
  assert.strictEqual(scaffold.sections.breadcrumb.items.length, 4);
  assert.strictEqual(scaffold.sections.servicesInCity.categories[0].items.length, 2);
  assert.deepStrictEqual(scaffold.sections.officeInfo.nap_todo, ['street_address', 'phone_number', 'hours_by_day']);
});
test('mergeDentalL3 fills in the generated subset (heroIntro/metaDescription/educationalBody/faqs) — no OG tags', () => {
  const scaffold = compose.buildDentalScaffold(dentalLayers());
  compose.mergeDentalL3(scaffold, {
    heroIntro: 'Teeth whitening in Quincy brightens smiles fast.',
    metaDescription: 'a'.repeat(155),
    educationalBody: [{ h2: 'What Is Teeth Whitening?', html: '<p>x</p>' }],
    faqs: [{ q: 'Q1', a: 'A1' }],
  });
  assert.strictEqual(scaffold.sections.hero.intro, 'Teeth whitening in Quincy brightens smiles fast.');
  assert.strictEqual(scaffold.meta.metaDescription.length, 155);
  assert.strictEqual(scaffold.sections.educationalBody.blocks.length, 1);
  assert.strictEqual(scaffold.sections.faq.items[0].q, 'Q1');
  // servicesInCity.intro is NOT generated — stays untouched (manual/optional).
  assert.strictEqual(scaffold.sections.servicesInCity.intro, '');
  // No OG tags in the contract at all.
  assert.ok(!('ogTitle' in scaffold.meta));
  assert.ok(!('ogDescription' in scaffold.meta));
  assert.ok(!('ogImageAlt' in scaffold.meta));
});

console.log('\nDental — internal links (Appendix C sibling-location cluster)');
test('buildDentalSiblings caps at maxSiblingLocations and prefers same region', () => {
  const currentLocation = { id: 'a', region: 'South Shore', city: 'Quincy', location_page_url: '/dental-offices/ma/quincy' };
  const allLocations = [
    currentLocation,
    { id: 'b', region: 'South Shore', city: 'Braintree', location_page_url: '/dental-offices/ma/braintree' },
    { id: 'c', region: 'South Shore', city: 'Hanover', location_page_url: '/dental-offices/ma/hanover' },
    { id: 'd', region: 'Worcester', city: 'Worcester', location_page_url: '/dental-offices/ma/worcester' },
    { id: 'e', region: 'Boston', city: 'Boston', location_page_url: '/dental-offices/ma/boston' },
  ];
  const links = internalLinks.buildDentalSiblings({ allLocations, currentLocation, service: { name: 'Teeth Whitening', slug: 'teeth-whitening' } });
  assert.strictEqual(links.length, 3);
  assert.ok(links.every(l => l.link_type === 'sibling_location'));
  assert.strictEqual(links[0].url, '/dental-offices/ma/braintree/teeth-whitening');
});

console.log('\nDental — schema (5 JSON-LD blocks, Appendix C layering)');
function dentalScaffoldWithContent() {
  const scaffold = compose.buildDentalScaffold(dentalLayers());
  let metaDescription = 'Get professional teeth whitening in Quincy, MA at Gentle Dental.';
  while (metaDescription.length < 152) metaDescription += ' Visit our caring Quincy team today.';
  metaDescription = metaDescription.slice(0, 158);
  compose.mergeDentalL3(scaffold, {
    heroIntro: 'Teeth whitening in Quincy can brighten your smile with safe, professional care close to home.',
    metaDescription,
    educationalBody: [
      { h2: 'What Is Teeth Whitening?', html: '<p>Teeth whitening in Quincy is a cosmetic procedure that lightens stains.</p>' },
      { h2: 'Benefits of Teeth Whitening', html: '<p>A brighter smile boosts confidence for Quincy patients.</p>' },
      { h2: 'What to Expect During the Procedure', html: '<p>Sessions run about sixty minutes chairside.</p>' },
    ],
    faqs: [
      { q: 'How long does teeth whitening take?', a: 'Most Quincy patients finish in one visit.' },
      { q: 'Is teeth whitening safe?', a: 'Yes, professional whitening is safe under a dentist’s care.' },
      { q: 'How much does teeth whitening cost?', a: 'Cost varies by case; ask our Quincy team for a quote.' },
      { q: 'Will insurance cover it?', a: 'Whitening is typically cosmetic and not covered.' },
    ],
  });
  scaffold.primaryKeyword = 'teeth whitening quincy';
  scaffold.secondaryKeywords = ['teeth whitening ma'];
  scaffold.sections.servicesInCity.internalLinks = [
    { anchor_text: 'Teeth Whitening in Braintree', url: '/dental-offices/ma/braintree/teeth-whitening', link_type: 'sibling_location', placement: 'services_in_city' },
    { anchor_text: 'Teeth Whitening in Hanover', url: '/dental-offices/ma/hanover/teeth-whitening', link_type: 'sibling_location', placement: 'services_in_city' },
    { anchor_text: 'Teeth Whitening in Worcester', url: '/dental-offices/ma/worcester/teeth-whitening', link_type: 'sibling_location', placement: 'services_in_city' },
  ];
  return scaffold;
}
test('generateDentalSchema returns 5 parseable JSON-LD strings, FAQ mirrors visible FAQs', () => {
  const layers = dentalLayers();
  const scaffold = dentalScaffoldWithContent();
  const schema = schemaGenerator.generateDentalSchema({ scaffold, client: layers.client, location: layers.location, service: layers.service });
  ['breadcrumbList', 'dentist', 'medicalWebPage', 'medicalProcedure', 'faqPage'].forEach(k => {
    assert.doesNotThrow(() => JSON.parse(schema[k]), `${k} should be valid JSON`);
  });
  const faqPage = JSON.parse(schema.faqPage);
  assert.strictEqual(faqPage.mainEntity.length, scaffold.sections.faq.items.length);
});

console.log('\nDental — QC (Build Brief §6 QcResult)');
test('a fully-formed dental page has no Critical failures', () => {
  const layers = dentalLayers();
  const scaffold = dentalScaffoldWithContent();
  scaffold.schema = schemaGenerator.generateDentalSchema({ scaffold, client: layers.client, location: layers.location, service: layers.service });
  const qc = qaEngine.runDentalQC(scaffold);
  const criticalFails = qc.checks.filter(c => c.severity === 'Critical' && !c.pass);
  assert.deepStrictEqual(criticalFails, [], 'unexpected critical failures: ' + JSON.stringify(criticalFails));
  assert.notStrictEqual(qc.verdict, 'FAIL');
});
test('missing primary keyword in H1/title/meta is a Critical failure → FAIL', () => {
  const layers = dentalLayers();
  const scaffold = dentalScaffoldWithContent();
  scaffold.primaryKeyword = 'something totally unrelated';
  scaffold.schema = schemaGenerator.generateDentalSchema({ scaffold, client: layers.client, location: layers.location, service: layers.service });
  const qc = qaEngine.runDentalQC(scaffold);
  assert.strictEqual(qc.verdict, 'FAIL');
});
test('fewer than 4 FAQs is a Critical failure', () => {
  const layers = dentalLayers();
  const scaffold = dentalScaffoldWithContent();
  scaffold.sections.faq.items = scaffold.sections.faq.items.slice(0, 2);
  scaffold.schema = schemaGenerator.generateDentalSchema({ scaffold, client: layers.client, location: layers.location, service: layers.service });
  const qc = qaEngine.runDentalQC(scaffold);
  assert.ok(qc.checks.find(c => c.name === 'faq_count_min_4' && !c.pass));
  assert.strictEqual(qc.verdict, 'FAIL');
});
test('primary keyword frequency check counts close variants (not just literal substring), no OG check exists', () => {
  const layers = dentalLayers();
  const scaffold = dentalScaffoldWithContent();
  scaffold.schema = schemaGenerator.generateDentalSchema({ scaffold, client: layers.client, location: layers.location, service: layers.service });
  const qc = qaEngine.runDentalQC(scaffold);
  const freqCheck = qc.checks.find(c => c.name === 'primary_keyword_frequency_5x');
  assert.ok(freqCheck, 'primary_keyword_frequency_5x check should exist');
  assert.strictEqual(freqCheck.severity, 'Major');
  assert.ok(!qc.checks.find(c => c.name === 'og_fields_present'), 'og_fields_present check should no longer exist');
});
test('primary keyword frequency check fails when the keyword never appears in the body', () => {
  const layers = dentalLayers();
  const scaffold = dentalScaffoldWithContent();
  scaffold.primaryKeyword = 'dental implants worcester'; // never appears anywhere in this fixture's body
  scaffold.schema = schemaGenerator.generateDentalSchema({ scaffold, client: layers.client, location: layers.location, service: layers.service });
  const qc = qaEngine.runDentalQC(scaffold);
  const freqCheck = qc.checks.find(c => c.name === 'primary_keyword_frequency_5x');
  assert.strictEqual(freqCheck.pass, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
