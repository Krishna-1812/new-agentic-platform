// ── Layer composition (Spec §2, §3.3) ───────────────────────────────────────
// PAGE = L1 (Global Template) + L2 (Location Data, pulled) + L3 (Service
// Content, generated). This module builds the L1/L2 scaffold by PULLING from
// the store — it never copies NAP/images/providers/reviews from scraped pages
// (Spec §15.4). The generator fills L3 into page_data; mergeL3 stitches it in.

const store = require('./store');
const categoryLogic = require('./categoryLogic');
const { pageUrl, canonicalUrl, breadcrumbLabel } = require('./urlBuilder');

// Pull all L2 reference data for a (client, service, location) tuple.
async function loadLayers({ clientId, serviceId, locationId }) {
  const client = await store.get('clients', clientId);
  const service = await store.get('services', serviceId);
  const location = await store.get('locations', locationId);
  if (!client || !service || !location) {
    throw new Error('Client, service, or location not found.');
  }
  const template = client.global_template_id
    ? await store.get('globalTemplates', client.global_template_id)
    : await store.findOne('globalTemplates', { client_id: clientId });

  const allProviders = await store.list('providers', { client_id: clientId });
  const providers = allProviders.filter(p =>
    (p.location_ids || []).includes(locationId) && (p.service_ids || []).includes(serviceId));

  const reviews = (await store.list('reviews', { client_id: clientId }))
    .filter(r => r.location_id === locationId && r.approved); // approved only (Spec §15.3)

  // Insurance: location-specific overrides brand-level.
  const insSets = await store.list('insuranceSets', { client_id: clientId });
  const insurance = insSets.find(i => i.location_id === locationId) || insSets.find(i => !i.location_id) || null;

  const tone = await store.findOne('toneProfiles', { client_id: clientId });

  const resources = (await store.list('resources', { client_id: clientId }))
    .filter(r => (r.related_service_ids || []).includes(serviceId));

  // Sibling services available at this location (for "services we offer").
  const allServices = await store.list('services', { client_id: clientId });
  const servicesAtLocation = allServices.filter(s => (location.services_available_ids || []).includes(s.id));

  return { client, service, location, template, providers, reviews, insurance, tone, resources, servicesAtLocation, allServices };
}

// Build the canonical Page Object scaffold (L1 + L2 + empty L3 with headings).
function buildScaffold(layers) {
  const { client, service, location, template, providers, reviews, insurance, servicesAtLocation } = layers;
  const baseUrl = client.brand_static?.base_url || '';

  const url = pageUrl(location.location_slug, service.slug);

  return {
    meta: {
      page_id: '', client_id: client.id, service_id: service.id, location_id: location.id,
      status: 'draft', version_no: 1,
      eligibility: { eligible: true, gbp_backed: !!location.verified, reason: '' },
    },
    global_template: {
      page_type: template?.page_type || 'location_service',
      brand_name: client.name,
      business_type: template?.schema_skeletons?.business_type || 'LocalBusiness',
      section_order: template?.section_order || [],
    },
    location_data: {
      location_name: location.location_name, city: location.city, state: location.state,
      state_abbreviation: location.state_abbreviation, street_address: location.street_address,
      zip_code: location.zip_code, phone_number: location.phone_number,
      latitude: location.latitude, longitude: location.longitude,
      location_slug: location.location_slug, location_page_url: location.location_page_url,
      appointment_url: location.appointment_url, gbp_url: location.gbp_url,
      hero_image_url: location.hero_image_url, hero_image_alt: location.hero_image_alt,
      parking_info: location.parking_info, nearby_areas: location.nearby_areas || [],
      insurance: insurance ? { providers: insurance.providers || [], copy: insurance.copy || '', disclaimer: insurance.disclaimer || '' } : { providers: [], copy: '', disclaimer: '' },
      providers: providers.map(p => ({ name: p.name, credentials: p.credentials, title: p.title, specialty: p.specialty, bio: p.bio, image_url: p.image_url, linkedin_url: p.linkedin_url })),
      reviews: reviews.map(r => ({ reviewer_name: r.reviewer_name, rating: r.rating, text: r.text, date: r.date, source: r.source })),
    },
    service_data: {
      service_name: service.name, service_slug: service.slug, service_category: service.category,
      parent_service_url: service.parent_service_url, related_services: service.related_service_ids || [],
      conditions_treated: service.conditions_treated || [], symptoms_addressed: service.symptoms_addressed || [],
      treatment_process: service.treatment_process || [],
      available_in_person: !!service.available_in_person, available_virtual: !!service.available_virtual,
      teen_available: !!service.teen_available,
    },
    keywords: { primary: [], secondary: [], local_modifier: [], semantic: [], faq: [], internal_linking: [], informational_low: [], excluded: [] },
    page_data: {
      page_url: url,
      canonical_url: canonicalUrl(baseUrl, location.location_slug, service.slug),
      meta_title: `${service.name} in ${location.location_name} | ${client.name}`,
      meta_description: '',
      og_title: '', og_description: '', og_url: canonicalUrl(baseUrl, location.location_slug, service.slug), og_image: location.hero_image_url || '',
      breadcrumb_label: breadcrumbLabel(service.name, location.location_name),
      h1: '',
      hero_intro: '',
      // Our approach to <Service> — always carries the two required H3s (feedback §4/§5).
      approach: { heading: `Our approach to ${service.name}`, intro: '', care_pillars: categoryLogic.APPROACH_PILLARS.map(h => ({ heading: h, copy: '' })) },
      // Competitor-modelled body: ≥1 H2 + 3 H3s; recommended 2 H2 + 5 H3s (feedback §5).
      competitor_section: { blocks: [] },
      faqs: [], // 7-11 Q&A (feedback §5)
      internal_links: [],
      // L2-derived list kept for OfferCatalog schema only (not part of visible body order).
      services_for_schema: servicesAtLocation.map(s => ({ name: s.name, url: s.parent_service_url, is_current: s.id === service.id })),
      schema: {},
    },
    competitor_analysis: [],
    qa_result: {},
    approval_status: { seo: 'pending', clinical: client.brand_rules?.ymyl ? 'pending' : 'n/a', content: 'pending', client: 'pending' },
  };
}

// Merge generated L3 fields into the scaffold's page_data (new structure).
function mergeL3(pageObject, l3) {
  const pd = pageObject.page_data;
  if (l3.meta_title) pd.meta_title = l3.meta_title;
  if (l3.meta_description) pd.meta_description = l3.meta_description;
  if (l3.og_title) pd.og_title = l3.og_title;
  if (l3.og_description) pd.og_description = l3.og_description;
  if (l3.h1) pd.h1 = l3.h1;
  if (l3.hero_intro) pd.hero_intro = l3.hero_intro;
  if (l3.approach_intro) pd.approach.intro = l3.approach_intro;
  // care_pillars: keep the fixed H3 headings, fill copy by index.
  if (Array.isArray(l3.care_pillars)) {
    l3.care_pillars.forEach((c, i) => { if (pd.approach.care_pillars[i]) pd.approach.care_pillars[i].copy = (typeof c === 'string' ? c : c.copy) || ''; });
  }
  // competitor_section: blocks of { h2, h3s: [{heading, copy}] }
  if (Array.isArray(l3.competitor_section)) {
    pd.competitor_section.blocks = l3.competitor_section;
  } else if (l3.competitor_section && Array.isArray(l3.competitor_section.blocks)) {
    pd.competitor_section.blocks = l3.competitor_section.blocks;
  }
  if (Array.isArray(l3.faqs)) pd.faqs = l3.faqs;
  return pageObject;
}

module.exports = { loadLayers, buildScaffold, mergeL3 };
