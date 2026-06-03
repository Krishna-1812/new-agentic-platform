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
  await store.replaceAll('services', SERVICES);
  await store.replaceAll('locations', LOCATIONS);
  await store.replaceAll('providers', PROVIDERS);
  await store.replaceAll('reviews', REVIEWS);
  await store.replaceAll('insuranceSets', INSURANCE_SETS);
  await store.replaceAll('resources', RESOURCES);
  await store.upsertBy('toneProfiles', 'id', TONE_PROFILE, 'tone');
  return { client_id: CLIENT_ID, services: SERVICES.length, locations: LOCATIONS.length, providers: PROVIDERS.length };
}

module.exports = { seedNeuroWellness, CLIENT_ID };
