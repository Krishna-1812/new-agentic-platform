// ── Seed data: Neuro Wellness Spa (Spec — first client / worked example) ─────
// Replaces the L1 + L2 catalog wholesale so the dropdowns are exactly the
// seeded set (every service available at every location). Pages are preserved.

const store = require('./store');
const { slugify } = require('./urlBuilder');

const CLIENT_ID = 'client_neuro_wellness_spa';
const BASE_URL = 'https://neurowellnessspa.com';

const CLIENT = {
  id: CLIENT_ID,
  name: 'Neuro Wellness Spa',
  brand_static: {
    logo: `${BASE_URL}/logo.png`,
    org_schema: { '@type': 'Organization', name: 'Neuro Wellness Spa', url: BASE_URL },
    sameAs: ['https://www.facebook.com/neurowellnessspa', 'https://www.instagram.com/neurowellnessspa'],
    base_url: BASE_URL,
    stats: { years_in_business: 10, patients_treated: '5,000+', locations: 13, expert_providers: 20 },
  },
  brand_rules: {
    ymyl: true,
    prohibited_claims: [
      'guaranteed cure', 'guaranteed results', 'cure depression', 'permanent cure',
      '100% effective', 'no side effects', 'miracle', 'instant results',
    ],
    licensing_language: 'All care is provided by licensed clinicians. Credentials are pulled from the provider record only.',
  },
  global_template_id: 'gt_neuro_location_service',
};

const GLOBAL_TEMPLATE = {
  id: 'gt_neuro_location_service',
  client_id: CLIENT_ID,
  page_type: 'location_service',
  // Section order matches the requested deliverable structure (feedback §5).
  section_order: ['seo', 'hero', 'approach', 'competitor_section', 'faqs', 'schema'],
  section_layouts: {},
  seo_head_structure: {
    meta_title_pattern: '[Service] in [Location] | [Brand]',
    h1_pattern: '[Adjective] [Service] in [Location]',
  },
  schema_skeletons: { business_type: 'MedicalBusiness' },
};

// name → category (Spec §3.4). Duplicates from the brief are de-duplicated.
const SERVICE_DEFS = [
  ['Depression treatment', 'condition', ['Depression', 'Major depressive disorder', 'Seasonal depression']],
  ['Anxiety treatment', 'condition', ['Anxiety', 'Generalized anxiety disorder', 'Panic disorder']],
  ['Addiction treatment', 'condition', ['Substance use disorder', 'Alcohol dependence', 'Behavioral addiction']],
  ['Grief and loss therapy', 'therapy', ['Grief', 'Bereavement', 'Complicated grief']],
  ['Stress and anxiety therapy', 'therapy', ['Stress', 'Anxiety', 'Burnout']],
  ['Grief counseling', 'therapy', ['Grief', 'Loss', 'Life transitions']],
  ['ADHD therapy', 'therapy', ['ADHD', 'Inattention', 'Executive dysfunction']],
  ['PTSD treatment', 'condition', ['PTSD', 'Trauma', 'Acute stress']],
  ['ADHD counseling', 'therapy', ['ADHD', 'Focus difficulties', 'Organization challenges']],
  ['Medication management', 'medication', ['Depression', 'Anxiety', 'ADHD', 'Bipolar disorder', 'OCD', 'PTSD']],
  ['Psychotherapy', 'therapy', ['Anxiety', 'Depression', 'Relationship concerns', 'Stress']],
  ['Depression treatment teens', 'condition', ['Teen depression', 'Adolescent mood disorders']],
  ['OCD treatment', 'condition', ['OCD', 'Intrusive thoughts', 'Compulsions']],
  ['PTSD therapy', 'therapy', ['PTSD', 'Trauma', 'Hypervigilance']],
  ['Stress counseling', 'therapy', ['Stress', 'Work stress', 'Burnout']],
];

const SERVICES = SERVICE_DEFS.map(([name, category, conditions]) => ({
  id: `svc_${slugify(name)}`,
  client_id: CLIENT_ID,
  name,
  slug: slugify(name),
  category,
  parent_service_url: `/services/${slugify(name)}/`,
  related_service_ids: [],
  conditions_treated: conditions,
  symptoms_addressed: conditions.slice(0, 3),
  treatment_process: ['Initial assessment', 'Personalized plan', 'Ongoing care', 'Progress review'],
  available_in_person: true,
  available_virtual: category !== 'procedure',
  teen_available: /teen/i.test(name) || category === 'medication' || category === 'therapy',
  service_disclaimers: '',
  semantic_variants: [name.toLowerCase().replace(/treatment|therapy|counseling/i, '').trim()].filter(Boolean),
}));

const ALL_SERVICE_IDS = SERVICES.map(s => s.id);

// city, street, zip, nearby areas. Every location offers every service.
const LOCATION_DEFS = [
  ['Westlake Village', '2625 Townsgate Rd, Suite 330', '91361', ['Thousand Oaks', 'Agoura Hills', 'Calabasas']],
  ['Fresno', '7081 N Marks Ave, Suite 104', '93711', ['Clovis', 'Madera', 'Sanger']],
  ['Beverly Hills', '436 N Bedford Dr, Suite 308', '90210', ['West Hollywood', 'Century City', 'Westwood']],
  ['Santa Monica', '2825 Santa Monica Blvd, Suite 210', '90404', ['Venice', 'Brentwood', 'Marina del Rey']],
  ['Sacramento', '1234 H St, Suite 200', '95814', ['Davis', 'Elk Grove', 'Roseville']],
  ['Manhattan Beach', '1230 Rosecrans Ave, Suite 300', '90266', ['Hermosa Beach', 'El Segundo', 'Redondo Beach']],
  ['Torrance', '21250 Hawthorne Blvd, Suite 500', '90503', ['Carson', 'Lomita', 'Gardena']],
  ['Marina del Rey', '4640 Admiralty Way, Suite 500', '90292', ['Venice', 'Playa Vista', 'Culver City']],
  ['Long Beach', '111 W Ocean Blvd, Suite 400', '90802', ['Lakewood', 'Signal Hill', 'Seal Beach']],
  ['Encino', '16133 Ventura Blvd, Suite 700', '91436', ['Tarzana', 'Sherman Oaks', 'Studio City']],
  ['Pasadena', '65 N Madison Ave, Suite 404', '91101', ['Altadena', 'South Pasadena', 'Arcadia']],
  ['Brea', '475 S State College Blvd', '92821', ['Fullerton', 'Placentia', 'Yorba Linda']],
  ['Lake Forest', '23151 Moulton Pkwy, Suite 105', '92630', ['Mission Viejo', 'Irvine', 'Laguna Hills']],
];

const LOCATIONS = LOCATION_DEFS.map(([city, street, zip, nearby]) => {
  const citySlug = slugify(city);
  return {
    id: `loc_${citySlug}`,
    client_id: CLIENT_ID,
    location_name: city, city, state: 'California', state_abbreviation: 'CA',
    street_address: street, zip_code: zip, phone_number: '(877) 847-3984',
    latitude: '', longitude: '',
    location_slug: `psychiatrist-${citySlug}`,
    location_page_url: `/locations/psychiatrist-${citySlug}/`,
    appointment_url: `${BASE_URL}/contact/`, gbp_url: `https://g.page/neuro-${citySlug}`,
    hero_image_url: `${BASE_URL}/images/${citySlug}-office.jpg`,
    hero_image_alt: `Neuro Wellness Spa office in ${city}, CA`,
    parking_info: `Free on-site parking available at the ${city} office.`,
    nearby_areas: nearby,
    verified: true,
    services_available_ids: ALL_SERVICE_IDS, // every service available at every location
  };
});

const ALL_LOCATION_IDS = LOCATIONS.map(l => l.id);

const PROVIDERS = [
  {
    id: 'prov_chen', client_id: CLIENT_ID, name: 'Dr. Emily Chen', credentials: 'MD',
    title: 'Board-Certified Psychiatrist', specialty: 'Adult & adolescent psychiatry',
    bio: 'Dr. Chen specializes in mood and anxiety disorders with a focus on integrative, evidence-based care.',
    image_url: `${BASE_URL}/images/dr-chen.jpg`, linkedin_url: 'https://linkedin.com/in/dr-emily-chen',
    location_ids: ALL_LOCATION_IDS, service_ids: ALL_SERVICE_IDS,
  },
  {
    id: 'prov_patel', client_id: CLIENT_ID, name: 'Dr. Anil Patel', credentials: 'MD',
    title: 'Psychiatrist & Medical Director', specialty: 'Treatment-resistant depression & medication management',
    bio: 'Dr. Patel leads clinical care and has treated thousands of patients across mood and anxiety conditions.',
    image_url: `${BASE_URL}/images/dr-patel.jpg`, linkedin_url: 'https://linkedin.com/in/dr-anil-patel',
    location_ids: ALL_LOCATION_IDS, service_ids: ALL_SERVICE_IDS,
  },
  {
    id: 'prov_rivera', client_id: CLIENT_ID, name: 'Sofia Rivera', credentials: 'LMFT',
    title: 'Licensed Marriage & Family Therapist', specialty: 'Talk therapy, grief & relationship counseling',
    bio: 'Sofia provides compassionate therapy for individuals, couples, and teens.',
    image_url: `${BASE_URL}/images/sofia-rivera.jpg`, linkedin_url: 'https://linkedin.com/in/sofia-rivera-lmft',
    location_ids: ALL_LOCATION_IDS, service_ids: ALL_SERVICE_IDS,
  },
];

// A couple of approved reviews per a few locations (real-reviews-only guardrail).
const REVIEWS = [];
['loc_brea', 'loc_beverly-hills', 'loc_santa-monica', 'loc_pasadena', 'loc_long-beach'].forEach((locId, i) => {
  REVIEWS.push(
    { id: `rev_${locId}_1`, client_id: CLIENT_ID, location_id: locId, reviewer_name: ['Jessica M.', 'Karen T.', 'David R.', 'Priya S.', 'Marcus L.'][i], rating: 5, text: 'Compassionate, professional care that genuinely helped. Highly recommend this office.', date: '2026-03-12', source: 'Google', approved: true },
    { id: `rev_${locId}_2`, client_id: CLIENT_ID, location_id: locId, reviewer_name: 'Anon', rating: 5, text: 'Easy to schedule and welcoming providers.', date: '2026-02-02', source: 'Google', approved: true },
  );
});

const INSURANCE_SETS = [
  {
    id: 'ins_brand', client_id: CLIENT_ID, location_id: null,
    providers: [
      { name: 'Aetna', logo_url: `${BASE_URL}/images/aetna.png`, alt_text: 'Aetna logo' },
      { name: 'Cigna', logo_url: `${BASE_URL}/images/cigna.png`, alt_text: 'Cigna logo' },
      { name: 'Anthem Blue Cross', logo_url: `${BASE_URL}/images/anthem.png`, alt_text: 'Anthem Blue Cross logo' },
      { name: 'UnitedHealthcare', logo_url: `${BASE_URL}/images/uhc.png`, alt_text: 'UnitedHealthcare logo' },
    ],
    copy: 'We accept most major insurance plans and offer flexible self-pay options.',
    disclaimer: 'Coverage varies by plan. Please contact us to verify your specific benefits.',
  },
];

const RESOURCES = [
  { id: 'res_1', client_id: CLIENT_ID, title: 'Understanding Therapy: What to Expect', url: '/blog/understanding-therapy/', image_url: '', related_service_ids: ['svc_psychotherapy', 'svc_anxiety-treatment'], related_condition_tags: ['anxiety', 'depression'], published_date: '2026-01-10' },
  { id: 'res_2', client_id: CLIENT_ID, title: 'A Guide to Psychiatric Medication Management', url: '/blog/medication-management-guide/', image_url: '', related_service_ids: ['svc_medication-management'], related_condition_tags: ['adhd', 'anxiety'], published_date: '2026-03-01' },
  { id: 'res_3', client_id: CLIENT_ID, title: 'Coping with Grief and Loss', url: '/blog/coping-with-grief/', image_url: '', related_service_ids: ['svc_grief-counseling', 'svc_grief-and-loss-therapy'], related_condition_tags: ['grief'], published_date: '2026-02-15' },
];

const TONE_PROFILE = {
  id: 'tone_neuro', client_id: CLIENT_ID,
  voice: 'Warm, compassionate, professional, and reassuring. Patient-centered and hopeful without overpromising.',
  reading_level: 'Grade 8-9', avg_sentence_length: 18,
  vocabulary_notes: 'Plain-language mental-health terms; avoids clinical jargon; uses "care", "support", "healing".',
  cta_phrasing: ['Schedule a consultation', 'Take the first step', "Let's talk"],
  formatting_habits: 'Short paragraphs, descriptive H2/H3s, scannable bullet lists, FAQ accordions.',
  structural_signals: { hero_cta: true, care_pillars: 2 },
  sample_urls: [`${BASE_URL}/locations/psychiatrist-brea/psychotherapy/`],
  confirmed: true,
};

async function seedNeuroWellness() {
  await store.upsertBy('clients', 'id', CLIENT, 'client');
  await store.upsertBy('globalTemplates', 'id', GLOBAL_TEMPLATE, 'gt');
  // Scoped to this client_id — does NOT touch other clients' rows in the
  // same shared table (see store.replaceAllForClient).
  await store.replaceAllForClient('services', CLIENT_ID, SERVICES);
  await store.replaceAllForClient('locations', CLIENT_ID, LOCATIONS);
  await store.replaceAllForClient('providers', CLIENT_ID, PROVIDERS);
  await store.replaceAllForClient('reviews', CLIENT_ID, REVIEWS);
  await store.replaceAllForClient('insuranceSets', CLIENT_ID, INSURANCE_SETS);
  await store.replaceAllForClient('resources', CLIENT_ID, RESOURCES);
  await store.upsertBy('toneProfiles', 'id', TONE_PROFILE, 'tone');
  return { client_id: CLIENT_ID, services: SERVICES.length, locations: LOCATIONS.length, providers: PROVIDERS.length };
}

// ── Re-seeding without losing hand-entered data ─────────────────────────────
// Location fields the SEO team fills in by hand. A seed ships them EMPTY
// (never fabricated), so a blind replaceAll silently destroyed that work --
// which made re-seeding to pick up a service change cost the entire NAP
// effort, and is why this used to be a one-shot bootstrap rather than
// something safe to re-run.
const PRESERVED_LOCATION_FIELDS = [
  'street_address', 'zip_code', 'phone_number', 'hours_by_day', 'directions_url',
  'map_image_url', 'hero_image_url', 'hero_image_alt', 'latitude', 'longitude',
  'nearby_areas', 'gbp_url',
];

function hasValue(v) {
  if (v == null || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

// Seeded values win for identity and geography (that is the point of
// re-seeding); anything a human populated wins over the seed's blank.
function mergeLocation(seeded, stored) {
  if (!stored) return seeded;
  const merged = { ...seeded };
  for (const field of PRESERVED_LOCATION_FIELDS) {
    if (hasValue(stored[field])) merged[field] = stored[field];
  }
  return merged;
}

// ── Seed data: Clear Behavioral Health ──────────────────────────────────────
// Taxonomy supplied by the SEO team from the live site's navigation: the
// service/condition tree, the addiction sub-trees, and the location list
// grouped by program type.
//
// NAP is deliberately EMPTY on every office. The client does not want address
// or phone on these pages, so the fields stay blank rather than invented:
// qaEngine's nap_matches_l2 check only compares when the L2 record carries a
// street address, so a blank record passes rather than failing.
const CBH_CLIENT_ID = 'client_clear_behavioral_health';
const CBH_BASE_URL = 'https://clearbehavioralhealth.com';

const CBH_CLIENT = {
  id: CBH_CLIENT_ID,
  name: 'Clear Behavioral Health',
  brand_static: {
    logo: '',
    org_schema: { '@type': 'Organization', name: 'Clear Behavioral Health', url: CBH_BASE_URL },
    sameAs: [],
    base_url: CBH_BASE_URL,
    // The name that appears in the title tag, the body copy, the schema and
    // the exported document.
    page_brand_name: 'Clear Behavioral Health',
  },
  brand_rules: {
    ymyl: true,
    // Behavioral health AND addiction marketing. Outcome guarantees and
    // success/relapse-rate claims are the two that draw regulatory attention
    // in this vertical, so they are banned alongside the usual cure language.
    // qaEngine's prohibited_claims_absent gate is a blocking check.
    prohibited_claims: [
      'guaranteed recovery', 'guaranteed results', 'guarantee', 'cure addiction',
      'cure depression', 'cure anxiety', 'permanent cure', '100% success',
      '100% effective', 'success rate', 'no relapse', 'relapse-free',
      'miracle', 'instant results',
    ],
    licensing_language: 'All care is provided by licensed clinicians. Credentials are pulled from the provider record only.',
  },
  global_template_id: 'gt_cbh_location_service',
};

const CBH_GLOBAL_TEMPLATE = {
  id: 'gt_cbh_location_service',
  client_id: CBH_CLIENT_ID,
  page_type: 'location_service',
  section_order: ['seo', 'hero', 'approach', 'competitor_section', 'faqs', 'schema'],
  section_layouts: {},
  seo_head_structure: {
    meta_title_pattern: '[Service] in [Location] | [Brand]',
    h1_pattern: '[Adjective] [Service] in [Location]',
  },
  schema_skeletons: { business_type: 'MedicalBusiness' },
};

// The condition vocabularies, kept as named lists because the program services
// reference them as conditions_treated and the condition services are built
// from them directly.
const CBH_ADULT_MH = [
  'Depression', 'Anxiety', 'Stress', 'ADHD', 'Anger Management', 'Burnout',
  'Bipolar I & II', 'Grief Disorder', 'Obsessive Compulsive Disorder (OCD)',
  'Personality Disorder', 'Post-Traumatic Stress Disorder (PTSD)', 'Psychosis',
];
const CBH_TEEN_MH = [
  'Depression', 'Anxiety', 'ADHD', 'Burnout', 'Stress', 'Bipolar Disorder',
  'PTSD (Post-Traumatic Stress Disorder)', 'School Issues', 'Failure to Launch',
  'Obsessive Compulsive Disorder (OCD)', 'Anger Management', 'Autism',
];
// The addiction tree. Each entry is [name, parent] — the sub-addictions come
// from the site's mega-menu (Opioid, Stimulant and Benzodiazepine each open a
// sub-list), and the parent link becomes related_service_ids so the generated
// pages cross-link instead of sitting isolated.
const CBH_ADDICTION_DEFS = [
  ['Alcohol Addiction', null],
  ['Marijuana Addiction', null],
  ['Prescription Drug Addiction', null],
  ['Suboxone Addiction', null],
  ['Opioid Addiction', null],
  ['Heroin Addiction', 'Opioid Addiction'],
  ['Fentanyl Addiction', 'Opioid Addiction'],
  ['Painkiller Addiction', 'Opioid Addiction'],
  ['Vicodin Addiction', 'Opioid Addiction'],
  ['Kratom Addiction', 'Opioid Addiction'],
  ['Stimulant Addiction', null],
  ['Adderall Addiction', 'Stimulant Addiction'],
  ['Cocaine Addiction', 'Stimulant Addiction'],
  ['Meth Addiction', 'Stimulant Addiction'],
  ['Benzodiazepine Addiction', null],
  ['Valium Addiction', 'Benzodiazepine Addiction'],
  ['Klonopin Addiction', 'Benzodiazepine Addiction'],
  ['Xanax Addiction', 'Benzodiazepine Addiction'],
];
const CBH_ADDICTIONS = CBH_ADDICTION_DEFS.map(([name]) => name);

// Every service carries the PROGRAM GROUP it belongs to. It is what the
// wizard's service picker groups under (ClearBehavioralWizardPage GROUP_LABELS),
// which is how the whole catalogue stays scannable, and what available_virtual
// and teen_available are derived from below.
//
// It does NOT decide where a service can be generated. Every office offers the
// whole catalogue (CBH_ALL_SERVICE_IDS), which is how Neuro Wellness is seeded
// too. Deriving services_available_ids from the groups hid
// any service whose group an office had not declared -- the therapy modalities
// never appeared at Anaheim Hills, for one -- and the SEO team wants every
// service reachable from every office.
//
// `category` is NOT free text: categoryLogic.js switches on it to choose the
// section headings, and only therapy | medication | procedure | condition |
// psychiatry are handled. Programs are 'procedure' ("What to expect during…",
// "When to consider…"); conditions are 'condition' ("Symptoms of…",
// "Causes of…").
//   [groups, name, category, conditions_treated]
const CBH_SERVICE_DEFS = [
  // Mental health programs
  [['mh-residential'], 'Residential Mental Health Treatment', 'procedure', CBH_ADULT_MH],
  [['mh-outpatient'], 'Partial Hospitalization Program (PHP)', 'procedure', CBH_ADULT_MH],
  [['mh-outpatient'], 'Outpatient Mental Health Treatment (IOP)', 'procedure', CBH_ADULT_MH],
  [['mh-outpatient'], 'Legal Diversion Program', 'procedure', CBH_ADULT_MH],
  [['mh-outpatient'], 'Labor Union Support', 'therapy', CBH_ADULT_MH],

  // Addiction programs
  [['addiction-residential'], 'Inpatient Alcohol and Drug Detox Program', 'procedure', CBH_ADDICTIONS],
  [['addiction-residential'], 'Inpatient Addiction Treatment', 'procedure', CBH_ADDICTIONS],
  [['addiction-outpatient'], 'Outpatient Addiction Treatment (IOP & PHP)', 'procedure', CBH_ADDICTIONS],
  [['addiction-residential', 'addiction-outpatient'], 'Dual Diagnosis Addiction Treatment', 'procedure', CBH_ADDICTIONS],

  // Virtual. No physical office of its own — offered from every outpatient and
  // teen location. INFERRED: confirm whether these should instead be a single
  // statewide "Virtual — California" location, which is how the site files them.
  [['mh-outpatient', 'teen'], 'Virtual Intensive Outpatient Program (IOP)', 'procedure', CBH_ADULT_MH],
  [['mh-outpatient', 'teen'], 'Evening Online Mental Health Treatment', 'procedure', CBH_ADULT_MH],

  // Therapy modalities and support services. These appear in the client's live
  // sitemap as pages in their own right, not only as things a programme offers.
  [['mh-outpatient', 'teen'], 'Cognitive Behavioral Therapy (CBT)', 'therapy', CBH_ADULT_MH],
  [['mh-outpatient', 'teen'], 'Dialectical Behavioral Therapy (DBT)', 'therapy', CBH_ADULT_MH],
  [['mh-outpatient', 'teen'], 'Group Therapy', 'therapy', CBH_ADULT_MH],
  [['mh-outpatient', 'teen'], 'Case Management', 'therapy', CBH_ADULT_MH],

  // Teen programs
  [['teen'], 'Teen IOP Treatment', 'procedure', CBH_TEEN_MH],
  [['teen'], 'Parent Support Groups', 'therapy', CBH_TEEN_MH],
  [['teen'], 'Family Therapy', 'therapy', CBH_TEEN_MH],

  // Adult mental-health conditions
  ...CBH_ADULT_MH.map(name => [['mh-residential', 'mh-outpatient'], name, 'condition', [name]]),

  // Teen conditions. Prefixed because a slug is unique per client and the adult
  // list already holds Depression, Anxiety, ADHD and the rest — and because
  // "teen depression in pasadena" is the page the teen programs actually want.
  ...CBH_TEEN_MH.map(name => [['teen'], `Teen ${name}`, 'condition', [name]]),

  // Addictions
  ...CBH_ADDICTION_DEFS.map(([name]) => [['addiction-residential', 'addiction-outpatient'], name, 'condition', [name]]),
];

// The client's URLs are /depression-treatment/, not /depression/ — a bare
// condition is not what anyone searches, and their live pages all carry the
// service word. Agreed with the client service by service.
//
// Kept as a RULE plus a short exception list rather than 56 literals, so a
// service added to the taxonomy above is slugged correctly without a second
// edit here. The exceptions are the names where the rule would read badly: a
// long clinical name that has a common short form, or a trailing acronym that
// adds nothing to a URL.
const CBH_SLUG_EXCEPTIONS = {
  'Bipolar I & II': 'bipolar-treatment',
  'Teen Bipolar Disorder': 'teen-bipolar-treatment',
  'Grief Disorder': 'grief-treatment',
  'Obsessive Compulsive Disorder (OCD)': 'ocd-treatment',
  'Teen Obsessive Compulsive Disorder (OCD)': 'teen-ocd-treatment',
  'Post-Traumatic Stress Disorder (PTSD)': 'ptsd-treatment',
  'Teen PTSD (Post-Traumatic Stress Disorder)': 'teen-ptsd-treatment',
  // The client's own live URL for this one.
  'Stress': 'stress-relief-programs',
  'Case Management': 'case-management',
  // Trailing acronyms dropped: they add nothing to a URL.
  'Outpatient Addiction Treatment (IOP & PHP)': 'outpatient-addiction-treatment',
  'Outpatient Mental Health Treatment (IOP)': 'outpatient-mental-health-treatment',
  'Partial Hospitalization Program (PHP)': 'partial-hospitalization-program',
  'Virtual Intensive Outpatient Program (IOP)': 'virtual-intensive-outpatient-program',
};

// A name that already says what kind of care it is keeps its slug; anything
// else is a bare condition and takes the service word.
const CBH_SERVICE_WORD_RE = /\b(treatment|therapy|programs?|groups?|support|detox)\b/i;

// The ID is derived from the NAME, so adding an acronym to a name changes it
// -- and a page or brief row holds the OLD id, which would leave it pointing at
// a service that no longer exists once the seed re-runs. These two were seeded
// before the acronyms were added, so their ids are pinned to what those rows
// already reference. New services need no entry here.
const CBH_ID_EXCEPTIONS = {
  'Cognitive Behavioral Therapy (CBT)': 'cognitive-behavioral-therapy',
  'Dialectical Behavioral Therapy (DBT)': 'dialectical-behavioral-therapy',
};

function cbhServiceSlug(name) {
  if (CBH_SLUG_EXCEPTIONS[name]) return CBH_SLUG_EXCEPTIONS[name];
  const base = slugify(name);
  return CBH_SERVICE_WORD_RE.test(name) ? base : `${base}-treatment`;
}

const CBH_SERVICES = CBH_SERVICE_DEFS.map(([groups, name, category, conditions]) => {
  // The ID stays keyed to the NAME, not the URL slug. Page rows reference
  // service ids, so re-slugging a service must not orphan its pages -- and for
  // the same reason a RENAME keeps the id it was first seeded under.
  const idSlug = CBH_ID_EXCEPTIONS[name] || slugify(name);
  const slug = cbhServiceSlug(name);
  const parent = CBH_ADDICTION_DEFS.find(([n]) => n === name)?.[1];
  return {
    id: `cbh_${idSlug}`,
    client_id: CBH_CLIENT_ID,
    name,
    slug,
    category,
    groups,
    parent_service_url: `/${slug}/`,
    related_service_ids: parent ? [`cbh_${slugify(parent)}`] : [],
    conditions_treated: conditions,
    // Left EMPTY on purpose. This is a YMYL client: symptom lists and clinical
    // process steps are facts the writer is allowed to state as the client's
    // own, so they must come from the client, not from a seeder's guess. The
    // generator degrades to the conditions list until these are filled in.
    symptoms_addressed: [],
    treatment_process: [],
    available_in_person: true,
    available_virtual: groups.includes('mh-outpatient') || groups.includes('teen'),
    teen_available: groups.includes('teen'),
    semantic_variants: [],
  };
});

const CBH_ALL_SERVICE_IDS = CBH_SERVICES.map(s => s.id);

// city | office label | program groups | nearby areas
// `program groups` records what each office actually runs. It is kept as the
// office's own description — the label only says so for the sites that share a
// city — and is no longer read when building services_available_ids.
//
// The label is the office's identity; `city` is the geographic claim and is
// resolved from the label by compose.loadLayers via text.baseCity, which
// splits on " – ". That is why the multi-program sites are named
// "Redondo Beach – Outpatient" rather than "Redondo Beach Outpatient".
const CBH_LOCATION_DEFS = [
  ['Gardena', 'Gardena – Residential', ['addiction-residential'], ['Torrance', 'Hawthorne', 'Carson', 'Compton']],
  ['Redondo Beach', 'Redondo Beach – Residential', ['addiction-residential'], ['Hermosa Beach', 'Torrance', 'Manhattan Beach']],
  ['Redondo Beach', 'Redondo Beach – Outpatient', ['addiction-outpatient', 'mh-outpatient', 'teen'], ['Hermosa Beach', 'Torrance', 'Manhattan Beach']],
  ['Los Angeles', 'Los Angeles – Residential', ['mh-residential', 'teen'], ['Culver City', 'Inglewood', 'West Hollywood']],
  ['Manhattan Beach', 'Manhattan Beach', ['mh-residential'], ['Hermosa Beach', 'El Segundo', 'Redondo Beach']],
  ['South Bay', 'South Bay', ['mh-residential'], ['Torrance', 'Redondo Beach', 'Gardena']],
  ['Torrance', 'Torrance', ['mh-residential'], ['Gardena', 'Lomita', 'Carson', 'Redondo Beach']],
  ['Anaheim Hills', 'Anaheim Hills', ['mh-outpatient', 'teen'], ['Anaheim', 'Yorba Linda', 'Orange', 'Villa Park']],
  ['El Monte', 'El Monte', ['mh-outpatient', 'teen'], ['Baldwin Park', 'Rosemead', 'Temple City']],
  ['El Segundo', 'El Segundo', ['mh-outpatient', 'teen'], ['Manhattan Beach', 'Hawthorne', 'Inglewood']],
  ['Los Angeles', 'Los Angeles – Mid Wilshire', ['mh-outpatient'], ['Koreatown', 'Hancock Park', 'Beverly Hills']],
  ['Pasadena', 'Pasadena', ['mh-outpatient', 'teen'], ['Altadena', 'South Pasadena', 'Arcadia', 'Glendale']],
  ['Santa Clarita', 'Santa Clarita', ['mh-outpatient', 'teen'], ['Valencia', 'Newhall', 'Canyon Country', 'Stevenson Ranch']],
  ['Van Nuys', 'Van Nuys', ['mh-outpatient', 'teen'], ['Sherman Oaks', 'Panorama City', 'Reseda', 'North Hollywood']],
];

const CBH_LOCATIONS = CBH_LOCATION_DEFS.map(([city, label, , nearby]) => {
  const slug = slugify(label);
  return {
    id: `cbhloc_${slug}`,
    client_id: CBH_CLIENT_ID,
    location_name: label, city, state: 'California', state_abbreviation: 'CA',
    // NAP intentionally blank — see the note at the top of this section.
    street_address: '', zip_code: '', phone_number: '',
    latitude: '', longitude: '',
    location_slug: slug,
    location_page_url: `/locations/${slug}/`,
    appointment_url: `${CBH_BASE_URL}/contact/`, gbp_url: '',
    // Blank so qaEngine's location_image_matches check no-ops rather than
    // failing on a stock image that names the wrong city.
    hero_image_url: '', hero_image_alt: '',
    parking_info: '',
    nearby_areas: nearby,
    // Required: checkEligibility refuses to generate for an unverified
    // location (doorway-page guardrail, Spec §15.1).
    verified: true,
    services_available_ids: CBH_ALL_SERVICE_IDS, // every service at every office
  };
});

// Re-runnable, and scoped to this client_id — it never touches another
// client's rows in the same shared tables.
async function seedClearBehavioral() {
  await store.upsertBy('clients', 'id', CBH_CLIENT, 'client');
  await store.upsertBy('globalTemplates', 'id', CBH_GLOBAL_TEMPLATE, 'gt');
  // `groups` is stored rather than stripped: it is the program family a
  // service belongs to, and it is how the wizard's picker turns 56 services
  // into something scannable. Grouping by `category` instead would give three
  // buckets, one of them holding forty-two conditions.
  await store.replaceAllForClient('services', CBH_CLIENT_ID, CBH_SERVICES);

  const stored = await store.list('locations', { client_id: CBH_CLIENT_ID });
  const storedById = new Map(stored.map(l => [l.id, l]));
  const locations = CBH_LOCATIONS.map(l => mergeLocation(l, storedById.get(l.id)));
  await store.replaceAllForClient('locations', CBH_CLIENT_ID, locations);

  return {
    client_id: CBH_CLIENT_ID,
    services: CBH_SERVICES.length,
    locations: locations.length,
  };
}

module.exports = {
  seedNeuroWellness, CLIENT_ID,
  seedClearBehavioral, CBH_CLIENT_ID, CBH_SERVICES, CBH_LOCATIONS,
  mergeLocation, PRESERVED_LOCATION_FIELDS,
};
