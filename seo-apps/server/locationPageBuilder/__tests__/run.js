// ── Tests for the deterministic pieces (Spec §0.4) ──────────────────────────
// No test framework is configured in this app, so this is a zero-dependency
// runner using Node's built-in assert. Run: node locationPageBuilder/__tests__/run.js

const assert = require('assert');
const url = require('../urlBuilder');
const cat = require('../categoryLogic');
const approval = require('../approval');
const qaEngine = require('../qaEngine');
const schemaGenerator = require('../schemaGenerator');
const exporter = require('../exporter');

// ── Opt-in LLM stub ─────────────────────────────────────────────────────────
// keywordRelevance destructures createLlmClient at require time, so the patch
// has to land first. LLM_STUB stays null by default, which falls through to
// the real client (and its "ANTHROPIC_API_KEY is not configured" throw) so the
// fallback-path tests below still test the fallback path.
const llmProviders = require('../../services/llmProviders');
const realCreateLlmClient = llmProviders.createLlmClient;
let LLM_STUB = null;
llmProviders.createLlmClient = (model) => (LLM_STUB ? LLM_STUB(model) : realCreateLlmClient(model));

// Drives the passes independently: `select` answers the selection prompt,
// `review` the critic prompt, `synth` the synthesized-keyword prompt. `synth`
// defaults to "nothing usable", which is what makes the synthesized Primary
// the deterministic code-side pair in every test that doesn't opt in.
function stubLlm({ select, review, synth }) {
  LLM_STUB = () => ({
    model: 'claude-sonnet-5',
    provider: 'anthropic',
    chat: {
      completions: {
        create: async ({ messages }) => {
          const prompt = messages[0].content;
          const answer = prompt.includes('You are reviewing a finished keyword selection') ? review
            : prompt.includes('You write the search phrases') ? (synth || { keywords: [] })
              : select;
          return { choices: [{ message: { content: JSON.stringify(answer) } }] };
        },
      },
    },
  });
}

const keywordRelevance = require('../keywordRelevance');
const keywordUniverseMap = require('../keywordUniverseMap');
const seed = require('../seed');
const keywordAdapter = require('../keywordAdapter');
const verticals = require('../verticals');
const cbhContract = require('../cbhContract');
const cbhQc = require('../cbhQc');
const cbhCompose = require('../cbhCompose');
const cbhWriter = require('../cbhWriter');
const cbhFixture = require('./cbhFixture');
const cbhBrief = require('../cbhBrief');
const cbhSources = require('../cbhFallbackSources');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

async function testAsync(name, fn) {
  try { await fn(); passed++; console.log(`  [ok] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}\n    ${e.message}`); }
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

console.log('\nURL builder — product names');
test('trademarked names survive slugification', () => {
  assert.strictEqual(url.slugify('Invisalign® Treatment'), 'invisalign-treatment');
  assert.strictEqual(url.slugify('Curodont™'), 'curodont');
});

console.log('\nSeed - re-seeding keeps what the SEO team entered by hand');
test('re-seeding preserves hand-entered NAP', () => {
  // A seeder ships NAP blank on purpose, so a blind replaceAll wiped the
  // address, phone and hours the SEO team enters by hand. That made re-seeding
  // to pick up a service change cost the whole NAP effort -- and re-seeding is
  // the ONLY way a taxonomy change reaches the dropdown.
  const seeded = {
    id: 'cbhloc_pasadena', city: 'Pasadena',
    street_address: '', phone_number: '', hours_by_day: {}, nearby_areas: [],
  };
  const stored = {
    id: 'cbhloc_pasadena', city: 'Pasadena',
    street_address: '123 Colorado Blvd', phone_number: '626-555-0100',
    hours_by_day: { mon: '8-5' }, nearby_areas: ['Altadena'],
  };
  const merged = seed.mergeLocation(seeded, stored);
  assert.strictEqual(merged.street_address, '123 Colorado Blvd');
  assert.strictEqual(merged.phone_number, '626-555-0100');
  assert.deepStrictEqual(merged.hours_by_day, { mon: '8-5' });
  assert.deepStrictEqual(merged.nearby_areas, ['Altadena']);
});
test('re-seeding still applies seeded identity and geography', () => {
  // The point of re-seeding is to pick up changes, so anything the team has
  // NOT populated must take the seeded value.
  const seeded = { id: 'x', city: 'Pasadena', location_name: 'Pasadena', street_address: '' };
  const merged = seed.mergeLocation(seeded, { id: 'x', city: 'Stale', location_name: 'Stale', street_address: '' });
  assert.strictEqual(merged.city, 'Pasadena', 'identity/geo always comes from the seed');
  assert.strictEqual(merged.location_name, 'Pasadena');
});
test('a location with nothing stored seeds unchanged', () => {
  const seeded = { id: 'new', city: 'Van Nuys', street_address: '' };
  assert.deepStrictEqual(seed.mergeLocation(seeded, null), seeded);
});

// -- Keyword selection (Primary/Secondary relevance + review) ----------------
// These exercise the deterministic paths only. Both LLM passes are absent in
// tests (no ANTHROPIC_API_KEY), which is itself the behaviour under test: the
// module must degrade to the code-side gate rather than throw.
const KW_POOL = [
  { keyword: 'invisalign cost', volume: 1900, difficulty: 0, intent: 'commercial', source: 'live' },
  { keyword: 'invisalign cambridge', volume: 800, difficulty: 0, intent: 'commercial', source: 'live' },
  { keyword: 'invisalign brookline', volume: 90, difficulty: 0, intent: 'commercial', source: 'universe' },
  { keyword: 'clear aligners brookline', volume: 40, difficulty: 0, intent: 'commercial', source: 'universe' },
];
const KW_ARGS = {
  service: 'Invisalign', city: 'Brookline', state: 'MA', region: 'Greater Boston',
  relevanceTerms: ['invisalign', 'clear aligner'],
};

(async () => {
  console.log('\nKeywords - Primary eligibility gate (service AND location)');
  test('a keyword naming both service and city is eligible', () => {
    assert.strictEqual(keywordRelevance.isPrimaryEligible('invisalign brookline', 'Brookline', ['invisalign'], 'Invisalign'), true);
  });
  test('a keyword missing the city is NOT eligible for Primary', () => {
    assert.strictEqual(keywordRelevance.isPrimaryEligible('invisalign cost', 'Brookline', ['invisalign'], 'Invisalign'), false);
  });
  test('a keyword missing the service is NOT eligible for Primary', () => {
    assert.strictEqual(keywordRelevance.isPrimaryEligible('dentist brookline', 'Brookline', ['invisalign'], 'Invisalign'), false);
  });

  console.log('\nKeywords - keyword selection fallback (no LLM available)');
  await testAsync('an empty pool synthesizes the "{service} in {city}" Primary pair at volume 0', async () => {
    const r = await keywordRelevance.selectPrimaryAndSecondary({ ...KW_ARGS, candidates: [] });
    assert.strictEqual(r.primary.length, 2);
    assert.deepStrictEqual(r.primary.map(c => c.keyword),
      ['invisalign treatment in brookline', 'invisalign treatment in brookline, ma']);
    assert.ok(r.primary.every(c => c.volume === 0), 'synthesized Primary must report zero volume');
    assert.ok(r.primary.every(c => c.source === 'synthesized'));
  });
  await testAsync('an empty pool sets lowVolume so the UI states searches are low', async () => {
    const r = await keywordRelevance.selectPrimaryAndSecondary({ ...KW_ARGS, candidates: [] });
    assert.strictEqual(r.lowVolume, true);
  });
  await testAsync('the code-side gate keeps off-location keywords out of Primary', async () => {
    const r = await keywordRelevance.selectPrimaryAndSecondary({ ...KW_ARGS, candidates: KW_POOL });
    const keys = r.primary.map(c => c.keyword);
    assert.ok(!keys.includes('invisalign cost'), 'a keyword with no city must not be Primary');
    assert.ok(!keys.includes('invisalign cambridge'), 'a rival city must not be Primary');
    assert.deepStrictEqual(keys, ['invisalign brookline', 'clear aligners brookline']);
  });
  await testAsync('real location-bearing Primary keywords leave lowVolume false', async () => {
    const r = await keywordRelevance.selectPrimaryAndSecondary({ ...KW_ARGS, candidates: KW_POOL });
    assert.strictEqual(r.lowVolume, false);
  });
  await testAsync('Secondary never repeats a keyword already taken by Primary', async () => {
    const r = await keywordRelevance.selectPrimaryAndSecondary({ ...KW_ARGS, candidates: KW_POOL });
    const primaryKeys = new Set(r.primary.map(c => c.keyword.toLowerCase()));
    const overlap = r.secondary.filter(c => primaryKeys.has(c.keyword.toLowerCase()));
    assert.deepStrictEqual(overlap.map(c => c.keyword), [], 'Secondary must not duplicate Primary');
  });
  await testAsync('an unconfigured cache degrades to recompute instead of throwing', async () => {
    // store.cacheGet throws when Supabase is absent; selectPrimaryAndSecondary
    // must swallow that rather than fail the whole research request.
    const r = await keywordRelevance.selectPrimaryAndSecondary({ ...KW_ARGS, candidates: KW_POOL });
    assert.ok(Array.isArray(r.primary) && r.primary.length > 0);
  });

  console.log('\nKeywords - sub-area office labels resolve to the parent city');
  test('a "City - Street" office label resolves to the city', () => {
    assert.strictEqual(keywordAdapter.baseCity('Springfield - Main Street', 'Springfield'), 'Springfield');
    assert.strictEqual(keywordAdapter.baseCity('Redondo Beach – Outpatient'), 'Redondo Beach');
    assert.strictEqual(keywordAdapter.baseCity('Los Angeles — Mid Wilshire'), 'Los Angeles');
  });
  test('a label leading with its own region resolves to that region city', () => {
    // No " - " separator, so only the region signal catches these.
    assert.strictEqual(keywordAdapter.baseCity('Springfield Downtown', 'Springfield'), 'Springfield');
    assert.strictEqual(keywordAdapter.baseCity('Springfield at The Mill', 'Springfield'), 'Springfield');
  });
  test('a real multi-word city is left intact', () => {
    // These are genuine place names people search for -- resolving them would
    // be worse than the bug it fixes.
    assert.strictEqual(keywordAdapter.baseCity('South Pasadena', 'Pasadena'), 'South Pasadena');
    assert.strictEqual(keywordAdapter.baseCity('Manhattan Beach', 'South Bay'), 'Manhattan Beach');
    assert.strictEqual(keywordAdapter.baseCity('Santa Clarita'), 'Santa Clarita');
    assert.strictEqual(keywordAdapter.baseCity('North Hollywood', 'Los Angeles'), 'North Hollywood');
  });
  test('a city identical to its region is unchanged', () => {
    assert.strictEqual(keywordAdapter.baseCity('Pasadena', 'Pasadena'), 'Pasadena');
    assert.strictEqual(keywordAdapter.baseCity('Brookline', 'Greater Boston'), 'Brookline');
  });
  test('the parent city satisfies the Primary gate for a sub-area office', () => {
    const city = keywordAdapter.baseCity('Springfield Downtown', 'Springfield');
    assert.strictEqual(keywordRelevance.isPrimaryEligible('invisalign springfield', city, ['invisalign'], 'Invisalign'), true);
    // The raw label never matches, which is the bug this resolves.
    assert.strictEqual(keywordRelevance.isPrimaryEligible('invisalign springfield', 'Springfield Downtown', ['invisalign'], 'Invisalign'), false);
  });


  console.log('\nKeywords - rival-city filter and the broader-region exception');
  const OFFICE_CITIES = ['Boston', 'South Boston', 'West Roxbury', 'Cambridge', 'Brookline', 'Nashua', 'South Nashua', 'Manchester'];
  // Mirrors how keywordAdapter assembles the filter from its two pure halves.
  function isBlocked(keyword, { targetCity, allowTerms }) {
    const others = keywordAdapter.rivalCities({ targetCity, allowTerms, knownCities: OFFICE_CITIES });
    if (!others.length) return false;
    const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b(${others.map(esc).join('|')})\\b`, 'i');
    return re.test(keywordAdapter.stripAllowedRegions(keyword, allowTerms));
  }
  const BROOKLINE = { targetCity: 'Brookline', allowTerms: ['Greater Boston', 'MA', 'Massachusetts'] };
  const BROOKLINE_KNOWN = { ...BROOKLINE, knownCities: OFFICE_CITIES };

  test('a rival office city is blocked', () => {
    assert.strictEqual(isBlocked('invisalign cambridge', BROOKLINE), true);
    assert.strictEqual(isBlocked('dentist manchester nh', BROOKLINE), true);
    assert.strictEqual(isBlocked('invisalign boston', BROOKLINE), true);
  });
  test('the page own city is never blocked', () => {
    assert.strictEqual(isBlocked('invisalign brookline', BROOKLINE), false);
  });
  test('the broader region survives even though a rival city sits inside it', () => {
    // "boston" is a rival office city and also a substring of "greater boston";
    // a word-boundary match on the raw keyword would block this wrongly.
    assert.strictEqual(isBlocked('invisalign greater boston', BROOKLINE), false);
    assert.strictEqual(isBlocked('invisalign massachusetts', BROOKLINE), false);
  });
  test('a shorter office city inside this page own city does not block it', () => {
    // "Boston" must not knock out "invisalign south boston" on the South Boston page.
    const southBoston = { targetCity: 'South Boston', allowTerms: ['Greater Boston', 'MA', 'Massachusetts'] };
    assert.strictEqual(isBlocked('invisalign south boston', southBoston), false);
    assert.strictEqual(isBlocked('invisalign cambridge', southBoston), true);
    const southNashua = { targetCity: 'South Nashua', allowTerms: ['All New Hampshire', 'NH', 'New Hampshire'] };
    assert.strictEqual(isBlocked('invisalign south nashua', southNashua), false);
    assert.strictEqual(isBlocked('invisalign manchester', southNashua), true);
  });
  test('the rival regex uses real word boundaries, not a backspace escape', () => {
    // Regression guard: written in a template literal, a single backslash-b is
    // the backspace character and the filter silently matches nothing.
    const others = keywordAdapter.rivalCities(BROOKLINE_KNOWN);
    assert.ok(others.includes('cambridge'), 'sanity: cambridge is a rival of Brookline');
    assert.ok(isBlocked('invisalign cambridge', BROOKLINE), 'the filter must actually match');
  });

  console.log('\nKeywords - synthesized keywords are search-shaped');
  test('service-name punctuation never reaches a synthesized keyword', () => {
    const k = keywordRelevance.keywordizeService;
    assert.strictEqual(k('Crowns & Bridges'), 'crowns and bridges');
    assert.strictEqual(k('Cavity Prevention (Curodont)'), 'cavity prevention');
    assert.strictEqual(k('TMD/TMJ Treatment'), 'tmd tmj treatment');
    assert.strictEqual(k('Diabetes & Oral Health'), 'diabetes and oral health');
    assert.strictEqual(k('Digital X-rays'), 'digital x-rays');
    assert.strictEqual(k('Invisalign'), 'invisalign');
    // A trademark sign is not something anyone types into Google.
    assert.strictEqual(k('Invisalign® Treatment'), 'invisalign treatment');
    assert.strictEqual(k('BOTOX® Cosmetic & Injectables'), 'botox cosmetic and injectables');
  });

  // The complaint this guards: a condition-named service ("Anxiety") pasted
  // against a city produced "anxiety anaheim hills", which nobody searches.
  test('a bare condition gains the head noun that makes it a service', () => {
    const p = keywordRelevance.servicePhrase;
    assert.strictEqual(p('Anxiety'), 'anxiety treatment');
    assert.strictEqual(p('ADHD'), 'adhd treatment');
    assert.strictEqual(p('Bipolar disorder'), 'bipolar disorder treatment');
  });
  test('a service name that is already search-shaped is left alone', () => {
    const p = keywordRelevance.servicePhrase;
    // Covers each detection route: an -ing/-ment/-istry/-ist/-ention ending,
    // and the service nouns that have no such ending.
    ['Anxiety Treatment', 'Teeth Whitening', 'Cosmetic Dentistry', 'Orthodontist',
      'Cavity Prevention (Curodont)', 'Psychotherapy', 'Oral Surgery', 'Root Canals',
      'Veneers', 'Dental Implants', 'Smile Makeover', 'Diabetes & Oral Health',
      'Digital X-rays', 'BOTOX® Cosmetic & Injectables'].forEach((name) => {
      assert.strictEqual(p(name), keywordRelevance.keywordizeService(name),
        `"${name}" already names a service — no head noun should be added`);
    });
  });
  test('the synthesized pair reads as a phrase, not a concatenation', () => {
    assert.deepStrictEqual(
      keywordRelevance.deterministicPhrases({ service: 'Anxiety', city: 'Anaheim Hills', state: 'CA' }),
      ['anxiety treatment in anaheim hills', 'anxiety treatment in anaheim hills, ca']);
    // No state on the location record: the second phrase is dropped rather
    // than emitted with a trailing comma.
    assert.deepStrictEqual(
      keywordRelevance.deterministicPhrases({ service: 'Teeth Whitening', city: 'Quincy', state: '' }),
      ['teeth whitening in quincy']);
  });
  await testAsync('the LLM phrase pass degrades to the deterministic pair', async () => {
    // No API key in tests — synthesizePhrases must return the code-side pair
    // rather than throw, which is what keeps Primary filled during an outage.
    const phrases = await keywordRelevance.synthesizePhrases({
      service: 'Anxiety', city: 'Anaheim Hills', state: 'CA', maxPrimary: 2,
    });
    assert.deepStrictEqual(phrases,
      ['anxiety treatment in anaheim hills', 'anxiety treatment in anaheim hills, ca']);
  });

  console.log('\nKeywords - review pass (step 3) and its verdict (step 4)');
  const SELECTED = {
    primary: ['invisalign brookline', 'clear aligners brookline'],
    secondary: ['invisalign greater boston', 'invisalign price'],
    rejected: [],
  };

  await testAsync('a clean verdict keeps every discovered pick and leaves lowVolume false', async () => {
    stubLlm({ select: SELECTED, review: { ok: true, failures: [] } });
    const r = await keywordRelevance.selectPrimaryAndSecondary({ ...KW_ARGS, candidates: KW_POOL });
    assert.deepStrictEqual(r.primary.map(c => c.keyword), ['invisalign brookline', 'clear aligners brookline']);
    assert.strictEqual(r.lowVolume, false);
    LLM_STUB = null;
  });

  await testAsync('a flagged Primary replaces ONLY that slot, keeping the one that passed', async () => {
    stubLlm({
      select: SELECTED,
      review: { ok: false, failures: [{ keyword: 'clear aligners brookline', slot: 'primary', reason: 'off-service' }] },
    });
    const r = await keywordRelevance.selectPrimaryAndSecondary({ ...KW_ARGS, candidates: KW_POOL });
    assert.ok(r.primary.some(c => c.keyword === 'invisalign brookline' && c.volume === 90),
      'a Primary the critic passed must survive, not be traded for a zero-volume synonym');
    assert.ok(!r.primary.some(c => c.keyword === 'clear aligners brookline'), 'the flagged Primary must be gone');
    assert.strictEqual(r.primary.length, 2, 'the emptied slot must be refilled');
    assert.strictEqual(r.lowVolume, true, 'a synthesized slot must set lowVolume');
    LLM_STUB = null;
  });

  await testAsync('a flagged Secondary is dropped and Primary is untouched', async () => {
    stubLlm({
      select: SELECTED,
      review: { ok: false, failures: [{ keyword: 'invisalign price', slot: 'secondary', reason: 'not local' }] },
    });
    const r = await keywordRelevance.selectPrimaryAndSecondary({ ...KW_ARGS, candidates: KW_POOL });
    assert.ok(!r.secondary.some(c => c.keyword === 'invisalign price'));
    assert.deepStrictEqual(r.primary.map(c => c.keyword), ['invisalign brookline', 'clear aligners brookline']);
    assert.strictEqual(r.lowVolume, false);
    LLM_STUB = null;
  });

  await testAsync('a verdict naming a keyword never submitted for review is ignored', async () => {
    // The critic only ever sees discovered keywords. A failure naming a
    // synthesized one (or anything else it wasn't shown) must not churn Primary.
    stubLlm({
      select: { primary: [], secondary: ['invisalign price'], rejected: [] },
      review: { ok: false, failures: [{ keyword: 'invisalign brookline', slot: 'primary', reason: 'hallucinated' }] },
    });
    const r = await keywordRelevance.selectPrimaryAndSecondary({ ...KW_ARGS, candidates: KW_POOL });
    assert.deepStrictEqual(r.primary.map(c => c.keyword),
      ['invisalign treatment in brookline', 'invisalign treatment in brookline, ma'],
      'the deterministic pair must survive a bogus verdict, in order');
    assert.deepStrictEqual(r.reviewFailures, [], 'a verdict about an unsubmitted keyword must not reach the UI');
    LLM_STUB = null;
  });

  await testAsync('a keyword the model invented is dropped (never in the pool)', async () => {
    stubLlm({
      select: { primary: ['invisalign newton', 'invisalign brookline'], secondary: ['made up keyword'], rejected: [] },
      review: { ok: true, failures: [] },
    });
    const r = await keywordRelevance.selectPrimaryAndSecondary({ ...KW_ARGS, candidates: KW_POOL });
    assert.ok(!r.primary.some(c => c.keyword === 'invisalign newton'), 'off-pool Primary must be dropped');
    assert.ok(!r.secondary.some(c => c.keyword === 'made up keyword'), 'off-pool Secondary must be dropped');
    LLM_STUB = null;
  });

  console.log('\nVerticals - research must not be run in the wrong industry');
  test('a behavioral-health seed is never prefixed with an industry word', () => {
    const CBH = 'client_clear_behavioral_health';
    // The regression this guards: "Dental Anxiety Anaheim Hills" researched the
    // wrong industry entirely and returned dental keywords for a psychiatry page.
    ['Anxiety Anaheim Hills CA', 'Xanax Addiction Gardena CA', 'Teen Depression Pasadena CA']
      .forEach(seed => assert.strictEqual(keywordAdapter.disambiguate(seed, CBH), seed,
        `"${seed}" must reach the SERP untouched`));
  });
  test('an unregistered client gets no qualifier rather than a guessed one', () => {
    // Injecting the wrong industry word silently researches the wrong industry,
    // so "unknown" has to mean "add nothing", never "assume" an industry.
    assert.strictEqual(keywordAdapter.disambiguate('Anxiety Anaheim Hills CA', 'client_nope'),
      'Anxiety Anaheim Hills CA');
    assert.strictEqual(keywordAdapter.disambiguate('Anxiety Anaheim Hills CA', undefined),
      'Anxiety Anaheim Hills CA');
    assert.strictEqual(verticals.verticalFor('client_nope'), null);
    assert.strictEqual(verticals.competitorQualifierFor('client_nope'), null);
  });
  test('every registered vertical states both of its qualifiers', () => {
    // A vertical missing from either table would silently fall back to "no
    // qualifier", which for competitor research means modelling the wrong
    // industry's pages (see COMPETITOR_QUALIFIER).
    Object.entries(verticals.VERTICAL_BY_CLIENT).forEach(([clientId, vertical]) => {
      assert.ok(Object.prototype.hasOwnProperty.call(verticals.SEED_QUALIFIER, vertical),
        `${vertical} needs a seed-qualifier entry (null is a valid answer)`);
      assert.ok(Object.prototype.hasOwnProperty.call(verticals.COMPETITOR_QUALIFIER, vertical),
        `${vertical} needs a competitor-qualifier entry (null is a valid answer)`);
      assert.strictEqual(verticals.verticalFor(clientId), vertical);
    });
    assert.strictEqual(verticals.competitorQualifierFor('client_clear_behavioral_health'), 'mental health');
  });



  console.log('\nRelevance terms - a client with no curated map still gets a topical filter');
  test('terms are derived from the service name when the map has no entry', () => {
    const t = (name) => keywordUniverseMap.relevanceTermsForService('not-in-map', name);
    assert.deepStrictEqual(t('Anxiety'), ['anxiety']);
    // The audience word is not the topic: keeping "teen" would admit "teen dentist".
    assert.deepStrictEqual(t('Teen Depression'), ['depression']);
    // The substance is the topic; "addiction" alone would pool every other addiction.
    assert.deepStrictEqual(t('Xanax Addiction'), ['xanax']);
    // A parenthetical is an acronym, not a topic.
    assert.deepStrictEqual(t('Outpatient Mental Health Treatment (IOP)'), ['mental']);
  });
  test('an entirely generic name still gets a filter rather than none', () => {
    // "Family Therapy" is all generic words. A loose filter beats null, which
    // the live-pool check reads as "no topical filter at all".
    const terms = keywordUniverseMap.relevanceTermsForService('not-in-map', 'Family Therapy');
    assert.ok(Array.isArray(terms) && terms.length, 'must never fall back to null');
  });
  test('a curated entry always wins over the derived one', () => {
    // Derivation cannot know that whitening keywords also say "bleach". No
    // client ships a curated map today, so one is registered for this test.
    keywordUniverseMap.SERVICE_UNIVERSE_MAP['test-teeth-whitening'] = { clusters: ['Teeth Whitening'], terms: ['whiten', 'bleach'] };
    try {
      assert.deepStrictEqual(
        keywordUniverseMap.relevanceTermsForService('test-teeth-whitening', 'Teeth Whitening'),
        ['whiten', 'bleach']);
      assert.deepStrictEqual(keywordUniverseMap.universeFilterFor('test-teeth-whitening').clusters, ['Teeth Whitening']);
    } finally {
      delete keywordUniverseMap.SERVICE_UNIVERSE_MAP['test-teeth-whitening'];
    }
  });
  test('the derived filter removes the pool that was reported as irrelevant', () => {
    // Verbatim from the report: an "Anxiety in Anaheim Hills" pool made almost
    // entirely of veterinary and dental keywords, because no filter ran at all.
    const reported = [
      'anaheim hills pet clinic', 'orange county emergency pet clinic', 'route 66 emergency vet',
      'anaheim hills dentist', 'mission hills pediatric dentist', 'veg anaheim hills',
      'awesome dental anaheim', 'twilight dentistry', 'christian counseling orange county',
      'anxiety therapist anaheim hills',
    ];
    const terms = keywordUniverseMap.relevanceTermsForService('not-in-map', 'Anxiety');
    const kept = reported.filter(k => terms.some(t => k.includes(t)));
    assert.deepStrictEqual(kept, ['anxiety therapist anaheim hills'],
      'only the keyword actually about this page survives');
  });


  console.log('\nCBH - the contract is satisfiable, and every gate bites');

  // Builds the fixture page, optionally mutating the L3 first.
  const cbhPage = (mutate) => {
    const l3 = cbhFixture.passingL3();
    if (mutate) mutate(l3);
    const page = cbhCompose.mergeCbhL3(cbhFixture.scaffold(), l3);
    return cbhCompose.applyProvenance(page, cbhFixture.passingProvenance());
  };
  const cbhFails = (page) => cbhQc.runCbhQc(page).checks.filter(c => !c.pass).map(c => c.id);

  test('a page written to the guidelines passes every gate', () => {
    const r = cbhQc.runCbhQc(cbhPage());
    assert.deepStrictEqual(r.checks.filter(c => !c.pass).map(c => c.id), [],
      'the contract must be satisfiable - a limit no page can meet is a broken contract, not a strict one');
    assert.strictEqual(r.verdict, 'PASS');
  });

  test('the fixed headings survive whatever the writer returns', () => {
    // The guidelines say "use this H2 exactly as written", so the headings are
    // never the model's to produce. Merging output that tries to reword them
    // must change nothing.
    const page = cbhPage();
    const merged = cbhCompose.mergeCbhL3(page, {
      approach: { paragraphs: ['x'], philosophy: ['y'], therapies: ['z'] },
      insurance: 'a', uvp: 'b', service: 'c',
      educational: { paragraphs: ['d'], h3s: [{ heading: 'Rewritten', lines: ['e'] }] },
    });
    assert.strictEqual(merged.sections.insurance.heading, cbhContract.FIXED_HEADINGS.insurance);
    assert.strictEqual(merged.sections.uvp.heading, cbhContract.FIXED_HEADINGS.uvp);
    assert.strictEqual(merged.sections.approach.philosophy.heading, cbhContract.FIXED_HEADINGS.approachPhilosophy);
    assert.strictEqual(merged.sections.approach.therapies.heading, cbhContract.FIXED_HEADINGS.approachTherapies);
  });

  test('the brand suffix is appended once and excluded from the length count', () => {
    const page = cbhPage(l3 => { l3.metaTitle = 'Anxiety Treatment in Anaheim Hills for Lasting Relief'; });
    assert.ok(page.meta.fullTitle.endsWith(cbhContract.TITLE_SUFFIX), 'the shipped title carries the suffix');
    assert.ok(!page.meta.title.includes(cbhContract.BRAND), 'the counted title does not');
    // Idempotent: a reviewer pasting a title that already has the suffix must
    // not end up with it twice.
    const twice = cbhCompose.mergeCbhL3(cbhFixture.scaffold(), { metaTitle: page.meta.fullTitle });
    assert.strictEqual(twice.meta.fullTitle, page.meta.fullTitle);
  });

  test('a meta title inside 50-60 passes and one outside it fails', () => {
    assert.ok(!cbhFails(cbhPage()).includes('meta_title_length'));
    assert.ok(cbhFails(cbhPage(l3 => { l3.metaTitle = 'Anxiety Treatment'; })).includes('meta_title_length'),
      'a 17-character title is under the floor');
    assert.ok(cbhFails(cbhPage(l3 => { l3.metaTitle = 'A'.repeat(61); })).includes('meta_title_length'));
  });

  test('the meta description needs every keyword word, in any order, plus a CTA', () => {
    // The guidelines say explicitly that the words need not be in order.
    const reordered = cbhPage(l3 => {
      l3.metaDescription = 'In Anaheim Hills, treatment for anxiety is delivered by licensed clinicians '
        + 'who tailor each plan to the person in front of them. Schedule a consultation today.';
    });
    assert.ok(!cbhFails(reordered).includes('meta_description_has_keyword_words'),
      'out-of-order keyword words must satisfy the rule');
    const noCta = cbhPage(l3 => {
      l3.metaDescription = 'Evidence-based anxiety treatment in Anaheim Hills from licensed clinicians '
        + 'who tailor care to your needs, your goals and the pace that actually suits you.';
    });
    assert.ok(cbhFails(noCta).includes('meta_description_has_cta'));
  });

  test('the H1 must carry the keyword and the city, within 70 characters', () => {
    assert.ok(cbhFails(cbhPage(l3 => { l3.hero.h1 = 'Compassionate Care for You'; }))
      .includes('hero_h1_keyword_and_location'), 'no keyword, no city');
    assert.ok(cbhFails(cbhPage(l3 => { l3.hero.h1 = 'Anxiety Treatment ' + 'x'.repeat(60) + ' in Anaheim Hills'; }))
      .includes('hero_h1_length'));
  });

  test('the approach section is capped as a whole, not just per paragraph', () => {
    // Three paragraphs each inside the 300 limit can still breach the 1,200
    // section cap - which is why the section gate exists separately.
    const long = 'x'.repeat(295);
    const page = cbhPage((l3) => {
      l3.approach.paragraphs = [long, long];
      l3.approach.philosophy = [long, long];
      l3.approach.therapies = [long, long];
    });
    const fails = cbhFails(page);
    assert.ok(fails.includes('approach_section_length'), 'the section total must be gated');
    assert.ok(!fails.includes('approach_paragraph_limits'), 'while every individual paragraph is legal');
  });

  test('every H3 body gets three lines per H3 - four H3s means twelve each', () => {
    // "3 x number of H3s" is what EACH body gets, not what the bodies share.
    // The fixture has four H3s, so every one of them has twelve lines of its
    // own and a short neighbour neither lends nor constrains.
    assert.strictEqual(cbhContract.linesPerBody(4), 12);
    assert.strictEqual(cbhContract.linesPerBody(5), 15);
    const L = 'y'.repeat(80);
    // Nine content lines plus the two breaks they oblige is eleven, inside the
    // twelve. All four bodies spending that is 44 lines across the section --
    // which a pooled reading of the same sentence would reject outright.
    const full = cbhPage((l3) => { l3.educational.h3s.forEach((h) => { h.lines = Array(9).fill(L); }); });
    assert.ok(!cbhFails(full).includes('educational_h3_line_budget'),
      'four bodies of nine lines each is legal - the allowance is per body');
    // Ten content lines oblige three breaks: thirteen, past the twelve.
    const over = cbhPage((l3) => { l3.educational.h3s[2].lines = Array(10).fill(L); });
    assert.ok(cbhFails(over).includes('educational_h3_line_budget'),
      'but one body past its own twelve still fails');
  });
  test('a bullet costs the same as the words would as a sentence', () => {
    // It carried a surcharge briefly. That made the client's own pages
    // impossible -- one of their subsections is an eight-bullet list, which at
    // two lines each came to sixteen against a cap of nine to fifteen.
    const words = 'Group sessions for shared skills practice.';
    assert.strictEqual(cbhContract.lineCount(words), 1);
    assert.strictEqual(cbhContract.lineCount(`- ${words}`), 1, 'the marker is free');
    assert.strictEqual(cbhContract.lineCount(`1. ${words}`), 1);
    assert.ok(!cbhContract.isBullet('-nospace'), 'a hyphenated word is not a bullet');
    // The client's real body now fits: eight bullets are eight lines, plus the
    // two breaks they oblige.
    const B = `- ${'y'.repeat(58)}`;
    assert.strictEqual(cbhContract.linesUsed(Array(8).fill(B)), 10);
    const eight = cbhPage((l3) => { l3.educational.h3s[0].lines = Array(8).fill(B); });
    assert.ok(!cbhFails(eight).includes('educational_h3_line_budget'),
      'ten lines is inside the twelve a four-H3 page allows');
    // Breaks are now the larger charge on a list, so a long enough one still
    // overruns: 14 bullets are 14 lines plus 4 breaks.
    const overrun = cbhPage((l3) => { l3.educational.h3s[0].lines = Array(14).fill(B); });
    assert.ok(cbhFails(overrun).includes('educational_h3_line_budget'));
  });
  test('a section of one-line fragments is flagged, a mixed one is not', () => {
    // The reported defect: every H3 body a list of short standalone sentences,
    // which reads like a slide deck. The fixture mixes paragraphs and bullets
    // and must stay clean; stripping either form has to be caught.
    assert.ok(!cbhFails(cbhPage()).includes('educational_body_mix'));
    const fragments = cbhPage((l3) => {
      l3.educational.h3s.forEach((h) => { h.lines = ['A short standalone sentence.', 'And another one.']; });
    });
    assert.ok(cbhFails(fragments).includes('educational_body_mix'),
      'one-line entries throughout is the shape the client rejected');
    const noBullets = cbhPage((l3) => {
      l3.educational.h3s.forEach((h) => { h.lines = h.lines.filter(l => !cbhContract.isBullet(l)); });
    });
    assert.ok(cbhFails(noBullets).includes('educational_body_mix'), 'all prose is one-sided too');
    // Minor, not Major: a one-sided section is still a usable page. But the
    // writer retries on it, which is how the shape actually gets fixed.
    assert.strictEqual(cbhQc.runCbhQc(noBullets).verdict, 'CONDITIONAL PASS');
    assert.ok(cbhWriter.CORRECTABLE.has('educational_body_mix'));
  });
  test('an entry is a bullet, a paragraph or a fragment', () => {
    const f = cbhContract.entryForm;
    assert.strictEqual(f('- Worry that is hard to control most days'), 'bullet');
    assert.strictEqual(f('A short standalone sentence.'), 'fragment');
    assert.strictEqual(f('y'.repeat(86)), 'paragraph', 'past one line of wrap it is prose');
    assert.strictEqual(f('   '), 'empty');
  });
  test('the mandatory break after every third line is charged for', () => {
    const L = 'y'.repeat(80);
    const used = (n) => cbhContract.linesUsed(Array(n).fill(L));
    assert.strictEqual(used(3), 3, 'no break is needed after the last line');
    assert.strictEqual(used(4), 5, 'a fourth line obliges a break after the third');
    assert.strictEqual(used(7), 9, 'seven lines carry two breaks');
    // Which is why the writer is asked for nine lines and not twelve: the
    // breaks come out of the same allowance.
    assert.strictEqual(cbhContract.contentAllowance(12), 9);
    assert.strictEqual(cbhContract.contentAllowance(15), 12);
  });
  test('a long paragraph counts as several lines against its own body', () => {
    assert.strictEqual(cbhContract.lineCount('y'.repeat(200)), 3, 'a 200-char line is three lines');
    assert.strictEqual(cbhContract.linesUsed(['y'.repeat(255)]), 3);
    // 765 characters wrap to nine lines, which with two breaks fills a body.
    assert.ok(!cbhFails(cbhPage((l3) => { l3.educational.h3s[0].lines = ['y'.repeat(765)]; }))
      .includes('educational_h3_line_budget'));
    assert.ok(cbhFails(cbhPage((l3) => { l3.educational.h3s[0].lines = ['y'.repeat(766)]; }))
      .includes('educational_h3_line_budget'), 'one character more is a tenth line and overruns');
  });
  test('an H3 with no body fails', () => {
    const page = cbhPage((l3) => { l3.educational.h3s[1].lines = []; });
    assert.ok(cbhFails(page).includes('educational_h3_line_budget'));
  });
  test('the H3 count is gated at both ends', () => {
    assert.ok(cbhFails(cbhPage(l3 => { l3.educational.h3s = l3.educational.h3s.slice(0, 3); }))
      .includes('educational_h3_count'), '3 H3s is under the floor');
    const six = cbhPage((l3) => {
      while (l3.educational.h3s.length < 6) l3.educational.h3s.push({ heading: 'Extra section', lines: ['a line'] });
    });
    assert.ok(cbhFails(six).includes('educational_h3_count'), '6 H3s is over the ceiling');
  });

  test('a fallback section with no source is a failure, not a pass', () => {
    // The guidelines forbid inventing information. An unattributed fallback is
    // indistinguishable from an invented one.
    const page = cbhPage();
    page.sections.educational.h3s[2].sourceUrl = '';
    assert.ok(cbhFails(page).includes('educational_fallback_cited'));
  });

  test('every educational section has to declare where it came from', () => {
    const page = cbhPage();
    page.sections.educational.h3s[0].source = null;
    assert.ok(cbhFails(page).includes('educational_provenance_stated'));
  });

  test('the treatment H2 is gated on presence, no longer on length', () => {
    // The only H2 the writer composes. Its LENGTH gate went at the client's
    // instruction: the shape they asked for -- "<service> treatment experts at
    // Clear Behavioral Health, <city>" -- is longer than the cap it replaced.
    // So the remaining gate has to still catch a heading that is not there.
    assert.ok(!cbhFails(cbhPage()).includes('treatment_heading_present'));
    assert.ok(!cbhFails(cbhPage()).includes('treatment_length'));

    const asked = 'Anger management treatment experts at Clear Behavioral Health, Anaheim Hills';
    assert.ok(asked.length > 60, 'the requested shape is over the cap that used to gate it');
    assert.ok(!cbhFails(cbhPage(l3 => { l3.treatment.heading = asked; }))
      .includes('treatment_heading_present'), 'and it passes');

    assert.ok(cbhFails(cbhPage(l3 => { l3.treatment.heading = ''; }))
      .includes('treatment_heading_present'), 'but an empty H2 still fails');
    assert.ok(cbhFails(cbhPage(l3 => { l3.treatment.paragraph = 'z'.repeat(251); }))
      .includes('treatment_length'));
    assert.ok(cbhFails(cbhPage(l3 => { l3.treatment.paragraph = ''; }))
      .includes('treatment_length'));
    // Both are model-fixable, so both drive the correction pass.
    assert.ok(cbhWriter.CORRECTABLE.has('treatment_heading_present'));
    assert.ok(cbhWriter.CORRECTABLE.has('treatment_length'));
    assert.ok(!cbhWriter.CORRECTABLE.has('treatment_heading_length'), 'the old id is gone');
  });
  test('a general treatment H2 is accepted, because the CMS spec uses one', () => {
    // There was a gate requiring the service and the city here. The client's
    // CMS format then showed this heading as "Work With Experienced Mental
    // Health Professionals", so a general heading has to pass.
    const general = cbhPage(l3 => { l3.treatment.heading = 'Work With Experienced Mental Health Professionals'; });
    const ids = cbhFails(general);
    assert.ok(!ids.some(id => id.startsWith('treatment_')), 'no treatment gate may fail on it');
  });
  test('the treatment section sits between Service and the FAQs', () => {
    // The client asked for it directly above the FAQs, and the exports walk
    // SECTION_ORDER rather than hard-coding a sequence of their own.
    const keys = cbhContract.SECTION_ORDER.map(x => x.key);
    assert.deepStrictEqual(keys.slice(-3), ['service', 'treatment', 'faq']);
  });
  test('the scaffold leaves the treatment H2 empty for the writer', () => {
    // Every other heading is filled in by code; this one is not, and merging
    // must not blank it when a correction returns only the paragraph.
    const blank = cbhFixture.scaffold();
    assert.strictEqual(blank.sections.treatment.heading, '');
    const merged = cbhCompose.mergeCbhL3(cbhFixture.scaffold(), cbhFixture.passingL3());
    assert.ok(merged.sections.treatment.heading.length > 0);
    const kept = cbhCompose.mergeCbhL3(merged, { treatment: { paragraph: 'Only the paragraph came back.' } });
    assert.ok(kept.sections.treatment.heading.length > 0, 'the heading survives a partial correction');
    assert.strictEqual(kept.sections.treatment.paragraph, 'Only the paragraph came back.');
  });

  test('the FAQ set is gated on count, answer length and type mix', () => {
    assert.ok(cbhFails(cbhPage(l3 => { l3.faqs = l3.faqs.slice(0, 4); })).includes('faq_count'));
    assert.ok(cbhFails(cbhPage(l3 => { l3.faqs[0].a = 'z'.repeat(301); })).includes('faq_answer_length'));
    const noBrand = cbhPage(l3 => { l3.faqs.forEach((f) => { f.type = 'intent'; }); });
    assert.ok(cbhFails(noBrand).includes('faq_type_mix'), 'a missing question type is flagged');
    assert.strictEqual(cbhQc.runCbhQc(noBrand).verdict, 'CONDITIONAL PASS',
      'but only as a Minor - a useful set that skips a category is not a failed page');
  });

  test('the writer only retries on failures a model can actually fix', () => {
    // Told "your description is 138 characters, it must be 150-160" a model
    // fixes it. Told "your UVP is not specific enough" it rewrites at random.
    assert.ok(cbhWriter.CORRECTABLE.has('meta_description_length'));
    assert.ok(cbhWriter.CORRECTABLE.has('educational_h3_line_budget'));
    assert.ok(!cbhWriter.CORRECTABLE.has('uvp_is_specific'));
    assert.ok(!cbhWriter.CORRECTABLE.has('insurance_heading'), 'a fixed heading is code, not a writing error');
  });

  test('a correction that made the page worse is discarded', () => {
    const good = cbhQc.runCbhQc(cbhPage());
    const worse = cbhQc.runCbhQc(cbhPage(l3 => { l3.faqs = []; l3.educational.h3s = []; }));
    assert.ok(cbhWriter.failureWeight(worse) > cbhWriter.failureWeight(good),
      'weighting must rank a broken page above a clean one so the better draft wins');
  });

  test('the correction note quotes the real measured numbers', () => {
    const qcResult = cbhQc.runCbhQc(cbhPage(l3 => { l3.metaDescription = 'Too short.'; }));
    const note = cbhWriter.correctionFrom(qcResult);
    assert.ok(/meta description/i.test(note), 'the failing section is named');
    assert.ok(/\d+ characters/.test(note), 'with the count the model has to correct against');
  });

  console.log('\nCBH - the CMS ingest JSON');

  const cmsJson = (mutate) => {
    const page = cbhPage(mutate);
    return exporter.toCbhCmsJson(page, {
      service: { slug: 'anxiety-treatment', groups: ['mh-outpatient'] },
      location: { location_slug: 'anaheim-hills' },
    });
  };

  test('the CMS block names do not match ours, and the mapping is the client\'s', () => {
    // Confirmed with the client: their `treatment` is OUR service section, and
    // their `experts` is our treatment section. Getting this backwards puts the
    // clinician copy under a heading about the service, on every page.
    const j = cmsJson();
    // Sentence-cased on the way out, so the leading word is capitalised where
    // it is not already a protected acronym ("ADHD treatment in ..." keeps its).
    assert.strictEqual(j.treatment.heading, 'Anxiety treatment programs in Anaheim Hills');
    assert.strictEqual(j.experts.heading, 'Our anxiety treatment experts in Anaheim Hills');
    assert.ok(j.experts.description.includes('clinicians'), 'the clinician copy lands under experts');
  });

  test('headings the CMS writes differently are adapted on the way out', () => {
    const j = cmsJson();
    // The page's educational H2 now carries the question mark itself, so the
    // export's asQuestion is belt-and-braces for a page that never passed the
    // read path rather than the thing that adds it.
    assert.ok(cbhPage().sections.educational.heading.endsWith('?'));
    assert.ok(j.what_is.heading.endsWith('?'));
    assert.strictEqual(j.what_is.heading, cbhPage().sections.educational.heading);
    assert.strictEqual(j.jump_menu.service_label, j.what_is.heading);
    // The UVP H2 keeps its mark. An earlier reading of the CMS sample stripped
    // it here; the client's own example carries it, so both the page and the
    // export now end on the question.
    assert.ok(cbhPage().sections.uvp.heading.endsWith('?'));
    assert.ok(j.why_choose.heading.endsWith('?'));
    // page_title follows the client's VALUE ("<Service> in <Location>"), not
    // their comment, which says "same as H1" beside a different string.
    assert.strictEqual(j.page_title, j.treatment.heading);
    assert.notStrictEqual(j.page_title, j.banner.heading);
  });

  test('every heading comes out sentence case', () => {
    const j = cmsJson();
    assert.strictEqual(j.approach.heading, 'Our approach to anxiety treatment in Anaheim Hills');
    assert.strictEqual(j.why_choose.heading, 'Why choose Clear Behavioral Health?');
    // The fixed client headings are already sentence case, so nothing moves.
    assert.strictEqual(j.approach.items[0].heading, 'Our philosophy of compassionate care');
  });

  test('sentence case lowers title case without destroying names', () => {
    // The whole difficulty: "Treatment" and "Anaheim" are the same shape, and
    // one has to come down while the other must not. A blunt lowercase pass
    // gives "adhd treatment in anaheim hills".
    const page = { serviceName: 'ADHD treatment', locationName: 'Anaheim Hills' };
    const loc = { city: 'Anaheim Hills', state: 'California', state_abbreviation: 'CA',
      nearby_areas: ['Yorba Linda'] };
    const keep = exporter.protectedTermsFor(page, loc);
    const sc = (t) => exporter.sentenceCase(t, keep);
    assert.strictEqual(sc('Our Approach to ADHD Treatment in Anaheim Hills'),
      'Our approach to ADHD treatment in Anaheim Hills');
    assert.strictEqual(sc('ADHD Treatment in Anaheim Hills That Fits Your Life'),
      'ADHD treatment in Anaheim Hills that fits your life', 'a protected first word stays as it is');
    assert.strictEqual(sc('Treatment Options Near Yorba Linda in California'),
      'Treatment options near Yorba Linda in California', 'nearby areas and the state are names too');
    assert.strictEqual(sc('(Stress) Relief Explained'), '(Stress) relief explained',
      'the first LETTER is capitalised, not the first character');
  });

  test('sentence case leaves acronyms, roman numerals and the pronoun I alone', () => {
    const keep = exporter.protectedTermsFor({ serviceName: 'Bipolar I & II', locationName: 'El Monte' }, {});
    // "bipolar" comes DOWN: it is a common noun, and the service name grants
    // nothing protection. Protecting it was the bug that produced "Our approach
    // to Anxiety treatment". The numerals survive on the acronym rule.
    assert.strictEqual(exporter.sentenceCase('Our Approach to Bipolar I & II in El Monte', keep),
      'Our approach to bipolar I & II in El Monte');
    // "I" is all-caps but one letter, so the acronym rule alone would lower it.
    assert.strictEqual(exporter.sentenceCase('How quickly can I get an ADHD evaluation?', keep),
      'How quickly can I get an ADHD evaluation?');
    // And its contractions: "I'm" is neither all-caps nor a name, and shipped
    // once as "if i'm too drained to keep working".
    assert.strictEqual(exporter.sentenceCase("Can Therapy Help If I'm Too Drained?", keep),
      "Can therapy help if I'm too drained?");
    assert.strictEqual(exporter.sentenceCase("What If I've Tried Therapy Before?", keep),
      "What if I've tried therapy before?");
    // Idempotent: running it over text already in sentence case changes nothing.
    const once = exporter.sentenceCase('What is ADHD treatment?', keep);
    assert.strictEqual(exporter.sentenceCase(once, keep), once);
  });

  test('a service name grants no word protection, but real proper nouns keep theirs', () => {
    // The reported defect: "Our approach to Anxiety treatment", "What is
    // Anxiety treatment". Every capitalised word in the service name was being
    // treated as a name, and most service names are common nouns.
    assert.strictEqual(cbhContract.approachHeading('Anxiety treatment'), 'Our approach to anxiety treatment');
    // educationalHeading takes the RAW condition, not the display phrase.
    assert.strictEqual(cbhContract.educationalHeading('Anxiety'), 'What is anxiety?');
    assert.strictEqual(cbhContract.serviceHeading('Anxiety treatment', 'Santa Clarita'),
      'Anxiety treatment programs in Santa Clarita', 'the leading word is still capitalised');
    // But an acronym, a branded medicine and a city all keep their capitals.
    assert.strictEqual(cbhContract.approachHeading('ADHD treatment'), 'Our approach to ADHD treatment');
    assert.strictEqual(cbhContract.approachHeading('Xanax Addiction treatment'),
      'Our approach to Xanax addiction treatment', 'a branded medicine is a proper noun');
    assert.strictEqual(cbhContract.serviceHeading('Burnout treatment', 'Anaheim Hills'),
      'Burnout treatment programs in Anaheim Hills');
  });

  test('model-written headings are cased as they are merged, not merely asked for', () => {
    // A prompt is a request; casing on merge is a guarantee, and it reaches
    // pages regenerated from an older draft too.
    const page = cbhCompose.mergeCbhL3(cbhFixture.scaffold(), {
      hero: { h1: 'Compassionate Anxiety Treatment in Anaheim Hills, CA' },
      educational: { paragraphs: ['x'], h3s: [{ heading: 'Understanding Anxiety and Its Symptoms', lines: ['y'] }] },
      treatment: { heading: 'Our Anxiety Treatment Experts', paragraph: 'z' },
      faqs: [{ q: 'How Quickly Can I Be Seen?', a: 'Soon.', type: 'location' }],
    });
    assert.strictEqual(page.sections.hero.h1, 'Compassionate anxiety treatment in Anaheim Hills, CA');
    assert.strictEqual(page.sections.educational.h3s[0].heading, 'Understanding anxiety and its symptoms');
    assert.strictEqual(page.sections.treatment.heading, 'Our anxiety treatment experts');
    assert.strictEqual(page.sections.faq.items[0].q, 'How quickly can I be seen?');
  });

  test('a possessive form of a protected name keeps its capital', () => {
    // "Clear Behavioral health's approach to burnout" shipped once: the token
    // was "Health's" and the protected set holds "health".
    const keep = cbhContract.protectedTerms({ locationName: 'Torrance' });
    assert.strictEqual(cbhContract.sentenceCase("Clear Behavioral Health's Approach to Burnout", keep),
      "Clear Behavioral Health's approach to burnout");
    assert.strictEqual(cbhContract.sentenceCase("Torrance's Outpatient Team", keep),
      "Torrance's outpatient team");
  });

  test('brief headings are cased too, not only the page', () => {
    // The brief is what the reviewer reads and edits, and its H3 headings are
    // copied VERBATIM onto the page. Casing only at merge left the brief in
    // the planner's title case.
    const b = cbhBrief.normalizeCbhBrief({
      educational: { h3s: [{ heading: 'What Is Burnout and Executive Burnout?', source: 'competitor' }] },
      faqs: [{ q: 'How Quickly Can Someone Be Seen In Torrance?', type: 'location' }],
    }, { locationName: 'Torrance' });
    assert.strictEqual(b.educational.h3s[0].heading, 'What is burnout and executive burnout?');
    assert.strictEqual(b.faqs[0].q, 'How quickly can someone be seen in Torrance?');
  });

  test('the service H2 names programmes, where that reads as English', () => {
    // Every live page reads "Depression treatment programs in Van Nuys".
    const h = cbhContract.serviceHeading;
    assert.strictEqual(h('Depression treatment', 'Anaheim Hills'), 'Depression treatment programs in Anaheim Hills');
    assert.strictEqual(h('Family Therapy', 'Torrance'), 'Family therapy programs in Torrance');
    // But NOT where it would double up or read badly. A blanket append gives
    // "Partial hospitalization program program" and "(IOP) program".
    assert.strictEqual(h('Partial Hospitalization Program (PHP)', 'Torrance'),
      'Partial hospitalization program (PHP) in Torrance');
    assert.strictEqual(h('Outpatient Mental Health Treatment (IOP)', 'Torrance'),
      'Outpatient mental health treatment (IOP) in Torrance');
  });

  test('a name that says neither "treatment" nor "programs" takes both', () => {
    // "Anger management in Anaheim Hills" named the condition and stopped
    // there: "management", "groups" and "support" read as service nouns, so
    // neither of the earlier rules fired and the heading never said what the
    // care was. The client asked for both words on exactly these.
    const h = cbhContract.serviceHeading;
    assert.strictEqual(h('Anger Management', 'Anaheim Hills'),
      'Anger management treatment programs in Anaheim Hills');
    assert.strictEqual(h('Case Management', 'Pasadena'),
      'Case management treatment programs in Pasadena');
    assert.strictEqual(h('Parent Support Groups', 'Pasadena'),
      'Parent support groups treatment programs in Pasadena');
    // A trailing acronym is still left alone -- it would read as a second
    // programme -- and a name that already says "program" keeps its own.
    assert.strictEqual(h('Outpatient Addiction Treatment (IOP & PHP)', 'Gardena'),
      'Outpatient addiction treatment (IOP & PHP) in Gardena');
    assert.strictEqual(h('Cognitive Behavioral Therapy (CBT)', 'Van Nuys'),
      'Cognitive behavioral therapy (CBT) in Van Nuys');
    assert.strictEqual(h('Legal Diversion Program', 'El Monte'),
      'Legal diversion program in El Monte');
  });

  test('a multi-word name is protected as a phrase, not as loose words', () => {
    // Protecting the brand word by word capitalised those words everywhere:
    // "Health" is in "Clear Behavioral Health", so "outpatient mental health
    // treatment" came out "mental Health".
    const keep = cbhContract.protectedTerms({ locationName: 'Torrance', location: { nearby_areas: ['Redondo Beach'] } });
    assert.strictEqual(cbhContract.sentenceCase('Outpatient Mental Health Treatment In Torrance', keep),
      'Outpatient mental health treatment in Torrance');
    assert.strictEqual(cbhContract.sentenceCase("Clear Behavioral Health's Approach To Burnout", keep),
      "Clear Behavioral Health's approach to burnout");
    assert.strictEqual(cbhContract.sentenceCase('Serving Torrance And Redondo Beach', keep),
      'Serving Torrance and Redondo Beach');
  });

  test('a bold sub-label is markup: free to count, rendered on the way out', () => {
    // The client's live bodies break a long subsection up with bold labels.
    // The asterisks must not eat the line budget -- this module counts rendered
    // text, never markup.
    const withLabel = '**Biological factors** shape how depression develops over time.';
    assert.strictEqual(cbhContract.lineCount(withLabel), cbhContract.lineCount(cbhContract.stripInlineMarkup(withLabel)));
    assert.strictEqual(cbhContract.lineCount(withLabel), 1, 'four asterisks do not push it to two lines');
    // A label does not make an entry a bullet, and a bullet keeps its form.
    assert.strictEqual(cbhContract.entryForm(withLabel), 'fragment');
    assert.strictEqual(cbhContract.entryForm('- **Signs:** low mood most days'), 'bullet');
  });

  test('bold labels render as <strong>, and stray HTML is still escaped', () => {
    const html = exporter.linesToHtml([
      '**Biological factors** include family history.',
      '- **Signs:** low mood most days',
      'A closer with <b>stray</b> markup & an ampersand.',
    ]);
    assert.ok(html.includes('<p><strong>Biological factors</strong> include'));
    assert.ok(html.includes('<li><strong>Signs:</strong> low mood most days</li>'));
    // Escaped FIRST, so the only tags in the output are the ones we generate.
    assert.ok(html.includes('&lt;b&gt;stray&lt;/b&gt;'));
    assert.ok(html.includes('&amp;'));
    assert.ok(!html.includes('<b>'), 'a tag in the copy must not survive as markup');
  });

  test('the meta title is not sentence-cased, because it is not a heading', () => {
    // It is the <title> tag, read in a SERP rather than on the page, and it
    // ships as the SEO team wrote it.
    const j = cmsJson();
    assert.strictEqual(j.seo.title, cbhPage().meta.fullTitle);
  });

  test('educational bullets become one list, prose stays paragraphs', () => {
    const j = cmsJson();
    const withBullets = j.tabs.find(t => t.content.includes('<ul>'));
    assert.ok(withBullets, 'the fixture mixes prose and bullets, so a tab must carry a list');
    // ONE list, not one per bullet, and the marker is stripped -- it was a
    // costing signal for the line budget, not something a reader should see.
    assert.strictEqual((withBullets.content.match(/<ul>/g) || []).length, 1);
    assert.ok(!withBullets.content.includes('<li>- '));
    assert.ok(withBullets.content.startsWith('<p>'), 'the lead paragraph stays a paragraph');
    // FAQ answers are plain text, unlike what_is and tabs.
    assert.ok(j.faqs.length && !j.faqs[0].answer.includes('<p>'));
    assert.ok(j.what_is.content.startsWith('<p>'));
  });

  test('HTML in the copy is escaped, not passed through', () => {
    const j = cmsJson(l3 => { l3.educational.paragraphs = ['Care for <b>anxiety</b> & stress.']; });
    assert.ok(j.what_is.content.includes('&lt;b&gt;'), 'a stray tag must not become markup');
    assert.ok(j.what_is.content.includes('&amp;'));
  });

  test('service_type comes from the service groups, not a hand-kept list', () => {
    // Approved with the client: an addiction-* group means addiction, and
    // everything else -- including teen services, which carry only `teen` --
    // is mental_health.
    const t = (groups) => exporter.serviceTypeFor({ groups });
    assert.strictEqual(t(['addiction-residential']), 'addiction');
    assert.strictEqual(t(['addiction-outpatient', 'addiction-residential']), 'addiction');
    assert.strictEqual(t(['mh-outpatient']), 'mental_health');
    assert.strictEqual(t(['teen']), 'mental_health', 'teen services fall to the default');
    assert.strictEqual(t([]), 'mental_health');
    assert.strictEqual(t(undefined), 'mental_health');
  });

  test('every key the CMS asks for is present, even on a thin page', () => {
    const j = cmsJson();
    ['location_slug', 'service_slug', 'page_title', 'service_type', 'seo', 'banner', 'insurance',
      'jump_menu', 'approach', 'what_is', 'tabs', 'why_choose', 'treatment', 'experts', 'faqs']
      .forEach(k => assert.ok(k in j, `${k} is missing`));
    assert.strictEqual(j.approach.items.length, 2, 'philosophy and therapies, always two');
    assert.ok(j.seo.title.endsWith(cbhContract.TITLE_SUFFIX), 'the shipping title carries the brand suffix');
  });

  test('the CBH gates recognise a CBH page and nothing else', () => {
    const page = cbhPage();
    assert.ok(cbhQc.isCbhPage(page), 'a CBH page is recognisable by its own sections');
    assert.ok(!cbhQc.isCbhPage({ meta: {}, sections: { hero: {}, educationalBody: { blocks: [] } } }),
      'a page of another shape is not mistaken for one');
  });


  console.log('\nCBH - fallback sourcing is an allowlist, not "whatever ranked"');
  test('only the approved clinical authorities count as a source', () => {
    ['https://www.nimh.nih.gov/health/topics/anxiety-disorders',
      'https://pubmed.ncbi.nlm.nih.gov/12345', 'https://www.mayoclinic.org/anxiety']
      .forEach(u => assert.ok(cbhSources.isAllowed(u), `${u} is an approved authority`));
    ['https://example.com/anxiety', 'https://psychologytoday.com/x', 'not a url', '']
      .forEach(u => assert.ok(!cbhSources.isAllowed(u), `${u} is not`));
  });
  test('a lookalike domain cannot pass as an authority', () => {
    // Suffix matching alone would accept the first of these; the check is host
    // equality or a real subdomain, so a domain merely CONTAINING an
    // allowlisted one fails.
    assert.ok(!cbhSources.isAllowed('https://nimh.nih.gov.evil.com/anxiety'));
    assert.ok(!cbhSources.isAllowed('https://notcdc.gov/anxiety'));
    assert.ok(cbhSources.isAllowed('https://sub.nimh.nih.gov/anxiety'), 'a genuine subdomain is fine');
  });
  test('the lookup cap can never be lower than the number of sections needing one', () => {
    // A cap below the maximum H3 count produced a page that structurally could
    // not pass educational_fallback_cited: with all sections marked fallback,
    // two got a source and the rest could never get one, no matter how many
    // times it was regenerated. The cap is derived from the contract for this
    // reason; hardcoding it is how the bug happened.
    assert.ok(cbhSources.MAX_LOOKUPS_PER_PAGE >= cbhContract.LIMITS.educational.h3Count.max,
      `cap ${cbhSources.MAX_LOOKUPS_PER_PAGE} must cover ${cbhContract.LIMITS.educational.h3Count.max} sections`);
  });
  await testAsync('a fully-fallback plan leaves no section unsourceable by the cap', async () => {
    // The code-side plan marks EVERY section fallback, which is the case that
    // exposed the cap. No lookups run here (max 0 keeps it offline); what is
    // asserted is that the cap would have allowed one for each.
    const plan = cbhBrief.fallbackPlan({ serviceName: 'Depression Treatment', city: 'Anaheim Hills' });
    const r = await cbhSources.attachFallbackSources({
      h3s: plan.h3s, serviceName: 'Depression Treatment', max: 0,
    });
    assert.ok(r.needed <= cbhSources.MAX_LOOKUPS_PER_PAGE,
      `${r.needed} sections need a source but the cap allows ${cbhSources.MAX_LOOKUPS_PER_PAGE}`);
  });
  test('the search is restricted to the allowlist up front', () => {
    const q = cbhSources.buildQuery('Signs you may need support', 'Anxiety Treatment');
    cbhSources.ALLOWLIST.forEach(d => assert.ok(q.includes(`site:${d}`), `${d} must be in the query`));
  });
  await testAsync('fallback lookups are capped per page, and uncapped sections stay unsourced', async () => {
    // Beyond the cap a section keeps its fallback tag with no URL, so QC flags
    // it rather than the page shipping unsourced copy as if it were researched.
    const h3s = Array.from({ length: 4 }, (_, i) => ({ heading: `Gap ${i}`, source: 'fallback', sourceUrl: '' }));
    const r = await cbhSources.attachFallbackSources({ h3s, serviceName: 'Anxiety Treatment', max: 0 });
    assert.strictEqual(r.needed, 4);
    assert.strictEqual(r.attempted, 0);
    assert.ok(r.h3s.every(h => !h.sourceUrl), 'nothing is invented when no lookup runs');
  });
  await testAsync('a section already carrying a source is not looked up again', async () => {
    const h3s = [{ heading: 'Covered', source: 'fallback', sourceUrl: 'https://www.cdc.gov/x' }];
    const r = await cbhSources.attachFallbackSources({ h3s, serviceName: 'Anxiety Treatment' });
    assert.strictEqual(r.needed, 0, 'an attributed section needs no lookup');
    assert.strictEqual(r.h3s[0].sourceUrl, 'https://www.cdc.gov/x');
  });

  console.log('\nCBH - the brief only offers what the guidelines leave open');
  test('an unrecognised provenance becomes fallback, never competitor', () => {
    // Defaulting the other way would let an untagged section pass as
    // competitor-backed and skip the attribution gate entirely.
    const b = cbhBrief.normalizeCbhBrief({ educational: { h3s: [{ heading: 'X', source: 'nonsense' }] } });
    assert.strictEqual(b.educational.h3s[0].source, 'fallback');
  });
  test('a planner-proposed meta value outside the contract is not stored', () => {
    // It would override the writer's output AFTER the correction pass has run,
    // so an out-of-range proposal replaced a compliant title and then had no
    // way of being fixed. Left empty, the writer produces it and the correction
    // pass covers it.
    const L = cbhContract.LIMITS;
    assert.strictEqual(cbhBrief.withinRange('Depression Treatment in Anaheim Hills, CA', L.metaTitle), false,
      '41 characters is under the 50 floor');
    assert.strictEqual(cbhBrief.withinRange('Anxiety Treatment in Anaheim Hills, CA | Expert Care', L.metaTitle), true);
    assert.strictEqual(cbhBrief.withinRange('x'.repeat(163), L.metaDescription), false);
    assert.strictEqual(cbhBrief.withinRange('x'.repeat(155), L.metaDescription), true);
  });
  test('range checking measures the way the gates measure', () => {
    // Whitespace-collapsed rendered text, so a value that only passes because
    // of padding cannot slip through one check and fail the other.
    const L = cbhContract.LIMITS;
    const padded = '  ' + 'x'.repeat(155) + '   ';
    assert.strictEqual(cbhBrief.withinRange(padded, L.metaDescription), true);
    assert.strictEqual(cbhContract.textLength(padded), 155);
  });
  test('the brief stores the title without the brand suffix', () => {
    const b = cbhBrief.normalizeCbhBrief({ meta: { title: `Anxiety Treatment in Anaheim Hills${cbhContract.TITLE_SUFFIX}` } });
    assert.strictEqual(b.meta.title, 'Anxiety Treatment in Anaheim Hills',
      'the reviewer edits, and QC counts, the title without the suffix');
  });
  test('the brief cannot carry more H3s or FAQs than the contract allows', () => {
    const b = cbhBrief.normalizeCbhBrief({
      educational: { h3s: Array.from({ length: 9 }, (_, i) => ({ heading: `H${i}` })) },
      faqs: Array.from({ length: 12 }, (_, i) => ({ q: `Q${i}?` })),
    });
    assert.strictEqual(b.educational.h3s.length, cbhContract.LIMITS.educational.h3Count.max);
    assert.strictEqual(b.faqs.length, cbhContract.LIMITS.faqs.count.max);
  });
  test('the code-side plan marks every section fallback, because none was researched', () => {
    const plan = cbhBrief.fallbackPlan({ serviceName: 'Anxiety Treatment', city: 'Anaheim Hills' });
    assert.ok(plan.h3s.every(h => h.source === 'fallback'),
      'a plan written without competitor data must not claim to be competitor-driven');
    assert.ok(plan.h3s.length >= cbhContract.LIMITS.educational.h3Count.min);
    const types = new Set(plan.faqs.map(f => f.type));
    ['location', 'brand', 'intent'].forEach(t => assert.ok(types.has(t), `the default FAQ set covers ${t}`));
    assert.ok(plan.faqs.length >= cbhContract.LIMITS.faqs.count.min);
  });


  console.log('\nCBH - headings keep the client\'s own capitalisation');
  test('an acronym survives into display text', () => {
    // The regression: display text was derived from the KEYWORD phrase, which
    // is lowercase by design, then title-cased back -- turning ADHD into
    // "Adhd" and "Bipolar I & II" into "Bipolar i And ii".
    const d = keywordRelevance.servicePhraseDisplay;
    assert.strictEqual(d('ADHD'), 'ADHD treatment');
    assert.strictEqual(d('OCD'), 'OCD treatment');
    assert.strictEqual(d('Bipolar I & II'), 'Bipolar I & II treatment');
  });
  test('the acronym in a parenthetical is kept, because that is where it lives', () => {
    // Stripping it produced a heading for an OCD page that never says OCD --
    // the term people search and scan for.
    const d = keywordRelevance.servicePhraseDisplay;
    assert.strictEqual(d('Obsessive Compulsive Disorder (OCD)'),
      'Obsessive Compulsive Disorder (OCD) treatment');
    assert.strictEqual(d('Partial Hospitalization Program (PHP)'),
      'Partial Hospitalization Program (PHP)');
    assert.strictEqual(d('Outpatient Addiction Treatment (IOP & PHP)'),
      'Outpatient Addiction Treatment (IOP & PHP)');
  });
  test('a trademark sign is still dropped from display text', () => {
    assert.strictEqual(keywordRelevance.servicePhraseDisplay('Invisalign® Treatment'), 'Invisalign Treatment');
  });
  test('the head-noun rule is the same for display as for keywords', () => {
    // Only the casing differs -- a name that already says what service it is
    // gains nothing in either path.
    ['Anxiety', 'ADHD', 'Teen IOP Treatment', 'Family Therapy', 'Psychotherapy'].forEach((n) => {
      const kw = keywordRelevance.servicePhrase(n);
      const disp = keywordRelevance.servicePhraseDisplay(n);
      assert.strictEqual(disp.toLowerCase().endsWith('treatment'), kw.endsWith('treatment'),
        `"${n}" must gain the head noun in both paths or neither`);
    });
  });
  test('the keyword path is unchanged: still lowercase, parentheticals still stripped', () => {
    // Display casing must not leak into search queries.
    assert.strictEqual(keywordRelevance.servicePhrase('ADHD'), 'adhd treatment');
    assert.strictEqual(keywordRelevance.servicePhrase('Obsessive Compulsive Disorder (OCD)'),
      'obsessive compulsive disorder treatment');
  });
  test('every CBH heading carries the display phrase, not the keyword phrase', () => {
    const page = cbhCompose.buildCbhScaffold({
      client: { id: 'c', brand_static: { base_url: 'https://x.test' } },
      service: { id: 's', name: 'ADHD', slug: 'adhd' },
      location: { id: 'l', city: 'Anaheim Hills', location_page_url: '/locations/anaheim-hills/' },
    }, { servicePhrase: keywordRelevance.servicePhraseDisplay });
    assert.strictEqual(page.serviceName, 'ADHD treatment');
    assert.ok(page.sections.approach.heading.includes('ADHD'), 'approach H2');
    assert.ok(page.sections.educational.heading.includes('ADHD'), 'educational H2');
    assert.ok(page.sections.service.heading.includes('ADHD'), 'service H2');
    assert.ok(!/Adhd/.test(JSON.stringify(page)), 'no title-cased acronym anywhere on the page');
  });


  console.log('\nCBH - a citation means the writer actually read the source');
  test('a block page is not accepted as source text', () => {
    // NCBI answers automated traffic with 800 characters of perfectly
    // scrapeable "Access Denied". Accepting it would hand the writer an error
    // notice and then cite a clinical authority for whatever it wrote instead.
    const blocked = 'NCBI Error Access Denied Your access to the NCBI website has been temporarily '
      + 'blocked due to a possible misuse/abuse situation involving your site. ' + 'x'.repeat(300);
    assert.ok(!cbhSources.usableExcerpt(blocked));
    assert.ok(!cbhSources.usableExcerpt('Please verify you are human. ' + 'x'.repeat(300)));
    assert.ok(!cbhSources.usableExcerpt('Enable JavaScript to continue. ' + 'x'.repeat(300)));
  });
  test('a stub is not accepted as source text', () => {
    assert.ok(!cbhSources.usableExcerpt('too short'));
    assert.ok(!cbhSources.usableExcerpt(''));
  });
  test('genuine clinical prose is accepted, even where it says "error" later on', () => {
    const real = 'Depression is a common and serious medical illness that negatively affects how you '
      + 'feel, the way you think and how you act. Fortunately, it is also treatable. It causes '
      + 'feelings of sadness and a loss of interest in activities once enjoyed, and can lead to a '
      + 'variety of emotional and physical problems. A diagnostic error is possible in any field.';
    assert.ok(cbhSources.usableExcerpt(real), 'the block check reads the OPENING, not the whole body');
  });
  test('the query does not repeat the service word or carry page furniture', () => {
    // "Anxiety treatment" + "Treatment options available" was concatenated raw
    // into "anxiety treatment Treatment options available" -- the topic word
    // twice -- and returned nothing usable across three attempts.
    const q = cbhSources.queryTopic('Treatment options available', 'Anxiety treatment');
    assert.strictEqual(q, 'anxiety treatment options available');
    assert.strictEqual((q.match(/treatment/g) || []).length, 1, 'the topic word appears once');
  });
  test('words that distinguish one section from another are kept', () => {
    // An earlier, over-aggressive stopword list reduced "What to expect at your
    // first visit" to "visit" and lost a source that had been retrieving fine.
    const q = cbhSources.queryTopic('What to expect at your first visit', 'Anxiety treatment');
    ['expect', 'first', 'visit'].forEach(w => assert.ok(q.includes(w), `"${w}" distinguishes this section`));
  });
  test('a heading of pure stopwords still yields a usable query', () => {
    assert.strictEqual(cbhSources.queryTopic('the and of', 'Anxiety treatment'), 'anxiety treatment');
  });
  test('the site-restricted query is tried first, then an open one', () => {
    const [restricted, open] = cbhSources.buildQueries('Treatment options', 'Anxiety treatment');
    assert.ok(restricted.includes('site:'), 'precision first');
    assert.ok(!open.includes('site:'), 'then breadth, with isAllowed doing the filtering');
  });
  test('more than one authority is tried before a section is given up on', () => {
    assert.ok(cbhSources.MAX_URL_ATTEMPTS > 1,
      'stopping at the first allowed URL left a section unsourced whenever that one blocked scrapers');
  });
  test('the brief carries the source TEXT, not just the URL', () => {
    // The lookup was paid for, cited, and then discarded: the excerpt never
    // reached the brief, so the writer never saw what it was citing.
    const b = cbhBrief.normalizeCbhBrief({
      educational: { h3s: [{ heading: 'X', source: 'fallback', sourceUrl: 'https://www.cdc.gov/a', sourceExcerpt: 'Real source text.' }] },
    });
    assert.strictEqual(b.educational.h3s[0].sourceExcerpt, 'Real source text.');
  });
  test('a sourced section is told to write from its source; an unsourced one is not', () => {
    const prompt = cbhWriter.userPrompt({
      scaffold: cbhFixture.scaffold(),
      primaryKeyword: cbhFixture.PRIMARY, secondaryKeywords: [],
      faqPlan: [],
      h3Plan: [
        { heading: 'From competitors', source: 'competitor' },
        { heading: 'From a source', source: 'fallback', sourceUrl: 'https://www.nimh.nih.gov/x', sourceExcerpt: 'NIMH states CBT is first-line.' },
        { heading: 'Unsourced', source: 'fallback', sourceUrl: '', sourceExcerpt: '' },
      ],
    });
    assert.ok(prompt.includes('NIMH states CBT is first-line.'), 'the source text reaches the writer');
    assert.ok(/WRITE THIS ONE FROM THE SOURCE BELOW/.test(prompt), 'and it is told to stay inside it');
    assert.ok(/nothing specific enough to need a citation/.test(prompt),
      'while an unsourced section is told to stay general rather than invent');
    // The competitor-backed section gets neither directive.
    const firstSection = prompt.slice(prompt.indexOf('1. From competitors'), prompt.indexOf('2. From a source'));
    assert.ok(!/WRITE THIS ONE FROM THE SOURCE/.test(firstSection));
  });

  // ── Em dashes ─────────────────────────────────────────────────────────────
  console.log('\nCBH - no em dash reaches a brief, a page or an export');
  const EM = '\u2014';

  test('an aside becomes a comma, not a run-on', () => {
    assert.strictEqual(
      cbhContract.removeEmDashes(`We treat the whole person ${EM} not just the symptom.`),
      'We treat the whole person, not just the symptom.');
  });
  test('an appositive keeps both of its commas', () => {
    assert.strictEqual(
      cbhContract.removeEmDashes(`Three formats ${EM} IOP, PHP and virtual ${EM} are offered here.`),
      'Three formats, IOP, PHP and virtual, are offered here.');
  });
  test('a dash with no spaces around it is still a dash', () => {
    assert.strictEqual(cbhContract.removeEmDashes(`care${EM}fast`), 'care, fast');
  });
  test('a dash opening a bullet becomes the canonical marker, not a comma', () => {
    // It is a MARKER, not punctuation: ", Evening sessions" would stop being a
    // bullet, and a bullet costs a different number of lines than the same
    // words as prose.
    const out = cbhContract.removeEmDashes(`${EM} Evening sessions are available.`);
    assert.strictEqual(out, '- Evening sessions are available.');
    assert.ok(cbhContract.isBullet(out), 'and it is still counted as a bullet');
  });
  test('a dash next to punctuation does not stack a comma on top', () => {
    assert.strictEqual(cbhContract.removeEmDashes(`Ask us. ${EM} We answer.`), 'Ask us. We answer.');
    assert.strictEqual(cbhContract.removeEmDashes(`options, ${EM} and more`), 'options, and more');
  });
  test('a trailing dash just goes', () => {
    assert.strictEqual(cbhContract.removeEmDashes(`Call today ${EM}`), 'Call today');
  });
  test('the en dash is left alone, because this module uses it structurally', () => {
    // Office labels ("Los Angeles – Mid Wilshire") are split on it, and it is a
    // legal bullet marker. Banning it would break both.
    const label = 'Los Angeles \u2013 Mid Wilshire';
    assert.strictEqual(cbhContract.removeEmDashes(label), label);
  });
  test('clean text is returned untouched', () => {
    const s = 'Anxiety treatment in Anaheim Hills, paced to you.';
    assert.strictEqual(cbhContract.removeEmDashes(s), s);
  });

  test('the brief cannot store an em dash the planner returned', () => {
    const b = cbhBrief.normalizeCbhBrief({
      meta: { title: `Anxiety Treatment ${EM} Anaheim Hills`, description: `Care that fits ${EM} today.` },
      educational: { h3s: [{
        heading: `Signs you may need support ${EM} and when`,
        intent: `What prompts people to seek care ${EM} and what does not.`,
        source: 'fallback', sourceUrl: 'https://www.cdc.gov/a',
        sourceExcerpt: `Anxiety disorders ${EM} the most common class ${EM} are treatable.`,
      }] },
      faqs: [{ q: `How soon can I start ${EM} realistically?`, type: 'location' }],
    });
    const everything = JSON.stringify(b);
    assert.ok(!everything.includes(EM), `an em dash survived into the brief: ${everything}`);
    // The source excerpt matters as much as the copy: it goes into the writer's
    // prompt, and clinical publishers use em dashes heavily.
    assert.ok(!b.educational.h3s[0].sourceExcerpt.includes(EM));
    // And the URL is untouched, not "cleaned".
    assert.strictEqual(b.educational.h3s[0].sourceUrl, 'https://www.cdc.gov/a');
  });

  test('the writer cannot put an em dash on a page', () => {
    const l3 = cbhFixture.passingL3();
    l3.hero.h1 = `Anxiety Treatment ${EM} Anaheim Hills`;
    l3.uvp = `We treat the whole person ${EM} not just the symptom.`;
    l3.educational.h3s[0].lines.push(`${EM} Evening appointments`);
    l3.faqs[0].a = `Usually within a week ${EM} sometimes sooner.`;
    const page = cbhCompose.mergeCbhL3(cbhFixture.scaffold(), l3);
    assert.ok(!JSON.stringify(page).includes(EM), 'an em dash survived the merge');
    assert.strictEqual(page.sections.uvp.paragraph, 'We treat the whole person, not just the symptom.');
  });

  test('a page saved before this rule existed is cleaned when it is read', () => {
    // The retroactive path: no regeneration, no billed call, just the read.
    const page = cbhCompose.mergeCbhL3(cbhFixture.scaffold(), cbhFixture.passingL3());
    page.sections.insurance.paragraph = `We accept most major insurance providers ${EM} ask us.`;
    page.meta.metaDescription = `Anxiety treatment in Anaheim Hills ${EM} get support.`;
    cbhCompose.refreshCbhDerived(page, {
      client: { brand_static: { base_url: 'https://clearbehavioralhealth.com' } },
      location: { city: 'Anaheim Hills', state_abbreviation: 'CA', location_page_url: '/locations/anaheim-hills/' },
    });
    assert.ok(!JSON.stringify(page.sections).includes(EM));
    // The JSON-LD quotes the meta and the FAQs, so it has to be built AFTER the
    // strip or it ships the dash the page no longer has.
    assert.ok(!JSON.stringify(page.schema).includes(EM), 'the schema was rebuilt from the cleaned copy');
  });

  test('a URL on the page is never rewritten by the strip', () => {
    const page = cbhCompose.mergeCbhL3(cbhFixture.scaffold(), cbhFixture.passingL3());
    page.sections.educational.h3s[0].sourceUrl = 'https://www.nimh.nih.gov/health/topics/anxiety';
    cbhCompose.stripCbhEmDashes(page);
    assert.strictEqual(page.sections.educational.h3s[0].sourceUrl,
      'https://www.nimh.nih.gov/health/topics/anxiety');
  });

  test('QC reports an em dash a reviewer typed, and says where', () => {
    const page = cbhCompose.mergeCbhL3(cbhFixture.scaffold(), cbhFixture.passingL3());
    cbhCompose.applyProvenance(page, cbhFixture.passingProvenance());
    page.primaryKeyword = cbhFixture.PRIMARY;
    // Assigned AFTER the merge, which is the only way one gets onto a page:
    // the reviewer edits the field and presses Recheck before saving.
    page.sections.uvp.paragraph = `Care that fits ${EM} and a team that stays.`;
    const check = cbhQc.runCbhCheck(page, 'no_em_dash');
    assert.strictEqual(check.pass, false);
    assert.ok(/Why Choose/.test(check.detail), `the detail names the section: ${check.detail}`);
    assert.strictEqual(check.severity, 'Major');
  });

  test('QC passes the fixture, so the gate does not fire on a clean page', () => {
    const page = cbhCompose.mergeCbhL3(cbhFixture.scaffold(), cbhFixture.passingL3());
    cbhCompose.applyProvenance(page, cbhFixture.passingProvenance());
    page.primaryKeyword = cbhFixture.PRIMARY;
    assert.strictEqual(cbhQc.runCbhCheck(page, 'no_em_dash').pass, true);
  });

  test('the export cleans a page that was never saved', () => {
    // The export routes deliberately render WHAT IS ON SCREEN, so an unsaved
    // edit has not been through the save path that would have stripped it.
    const page = cbhCompose.mergeCbhL3(cbhFixture.scaffold(), cbhFixture.passingL3());
    page.sections.service.paragraph = `Care in Anaheim Hills ${EM} five days a week.`;
    const md = exporter.toCbhMarkdown(page);
    assert.ok(!md.includes(EM), 'an em dash reached the exported document');
    // And the caller's own object is not mutated by exporting it.
    assert.ok(page.sections.service.paragraph.includes(EM), 'the export worked on a copy');
  });

  test('the provenance annotation in the export carries no em dash either', () => {
    const label = exporter.cbhProvenanceLabel({ source: 'fallback', sourceUrl: 'https://www.cdc.gov/a' });
    assert.ok(!label.includes(EM), `the deliverable must be searchably clean: ${label}`);
  });

  test('every model-facing CBH prompt bans the em dash and uses none itself', () => {
    // A prompt that spends forty em dashes telling a model not to write one is
    // an argument it will lose.
    const writer = cbhWriter.systemPrompt() + cbhWriter.userPrompt({
      scaffold: cbhFixture.scaffold(),
      primaryKeyword: cbhFixture.PRIMARY, secondaryKeywords: [],
      h3Plan: [{ heading: 'Signs you may need support', intent: 'What prompts people to seek care.', source: 'competitor' }],
      faqPlan: [{ q: 'How soon can I start?', type: 'location' }],
    });
    const planner = cbhBrief.planPrompt({
      serviceName: cbhFixture.SERVICE, conditionName: cbhFixture.CONDITION, city: cbhFixture.CITY,
      primaryKeyword: cbhFixture.PRIMARY, competitorHeadings: [], competitorFaqs: [],
    });
    [['writer', writer], ['planner', planner.system + planner.user]].forEach(([name, text]) => {
      assert.ok(/em dash/i.test(text), `the ${name} prompt does not state the rule`);
      // The one em dash each prompt may contain is the character it names.
      const stray = text.split(EM).length - 1;
      assert.strictEqual(stray, 1,
        `the ${name} prompt uses ${stray} em dashes; only the one in "(\u2014)" naming the rule is allowed`);
    });
  });

  // ── CMS JSON shape ────────────────────────────────────────────────────────
  console.log('\nCBH - the CMS payload matches the client\'s sample');

  // One built page, reused: every assertion below is about the same export.
  const cmsPage = (() => {
    const p = cbhCompose.mergeCbhL3(cbhFixture.scaffold(), cbhFixture.passingL3());
    cbhCompose.applyProvenance(p, cbhFixture.passingProvenance());
    p.primaryKeyword = cbhFixture.PRIMARY;
    return p;
  })();

  test('the banner heading bolds the city', () => {
    const json = exporter.toCbhCmsJson(cmsPage, {});
    assert.ok(json.banner.heading.includes(`<b>${cbhFixture.CITY}</b>`),
      `expected the city in bold: ${json.banner.heading}`);
  });
  test('the bold survives the sentence-case pass with the city still capitalised', () => {
    // The order matters: casing first, then the tag. Wrapping first would hand
    // sentenceCase a token starting "<b>" and lower-case the city inside it.
    const json = exporter.toCbhCmsJson(cmsPage, {});
    assert.ok(!/<b>anaheim/i.test(json.banner.heading) || /<b>Anaheim Hills<\/b>/.test(json.banner.heading),
      `the city lost its capitals: ${json.banner.heading}`);
    assert.ok(/^[A-Z]/.test(json.banner.heading), 'and the heading still opens with a capital');
  });
  test('only the banner carries markup; the other headings stay plain', () => {
    const json = exporter.toCbhCmsJson(cmsPage, {});
    [json.page_title, json.treatment.heading, json.experts.heading, json.what_is.heading]
      .forEach(h => assert.ok(!/<b>/.test(h), `unexpected markup in "${h}"`));
  });
  test('the city is bolded once, not at every mention', () => {
    const doubled = structuredClone(cmsPage);
    doubled.sections.hero.h1 = `Anxiety treatment in ${cbhFixture.CITY} for ${cbhFixture.CITY} residents`;
    const json = exporter.toCbhCmsJson(doubled, {});
    assert.strictEqual(json.banner.heading.split('<b>').length - 1, 1);
  });
  test('a heading that never names the city exports unchanged', () => {
    // Should not happen -- a Critical gate requires the city in the H1 -- but an
    // export is the wrong place to start throwing.
    const noCity = structuredClone(cmsPage);
    noCity.sections.hero.h1 = 'Compassionate anxiety treatment';
    const json = exporter.toCbhCmsJson(noCity, {});
    assert.strictEqual(json.banner.heading, 'Compassionate anxiety treatment');
  });
  test('the Why Choose heading keeps its question mark', () => {
    const json = exporter.toCbhCmsJson(cmsPage, {});
    assert.strictEqual(json.why_choose.heading, 'Why choose Clear Behavioral Health?');
  });
  test('a stored heading that lost its question mark gets one back', () => {
    const stripped = structuredClone(cmsPage);
    stripped.sections.uvp.heading = 'Why choose Clear Behavioral Health';
    const json = exporter.toCbhCmsJson(stripped, {});
    assert.ok(json.why_choose.heading.endsWith('?'), json.why_choose.heading);
  });
  test('exporting does not mutate the page it was handed', () => {
    const before = JSON.stringify(cmsPage);
    exporter.toCbhCmsJson(cmsPage, {});
    assert.strictEqual(JSON.stringify(cmsPage), before, 'the export wrote back into the page object');
  });

  test('the code-side fallback plan is clean', () => {
    // It ships verbatim whenever the planner cannot run, so it is copy in its
    // own right rather than a prompt.
    const plan = cbhBrief.fallbackPlan({ serviceName: 'Anxiety treatment', city: 'Anaheim Hills' });
    assert.ok(!JSON.stringify(plan).includes(EM));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
