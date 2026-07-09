// Single source of truth for the page-type taxonomy. GPT must pick exactly
// one of these per folder pattern; the editable folder-mapping UI offers the
// same set. Deliberately broad so brands across industries (local/multi-
// location services, e-commerce, B2B SaaS, marketplaces, franchises) all map
// cleanly — a type that never occurs for a brand simply never appears.
const CONTENT_TYPES = [
  'homepage',
  'person',
  'locationService',
  'location',
  'service',
  'solution',
  'serviceProvider',
  'product',
  'pricing',
  'company',
  'blog',
  'resource',
  'category',
  'landing',
  'legal',
  'other',
];

// Short gloss per type — fed to GPT so it classifies against a shared
// definition rather than guessing from the bare label.
const TYPE_HINTS = {
  homepage: 'the site root / home page',
  person: 'an individual person profile (a specific doctor, agent, attorney, team member)',
  locationService: 'a page for a specific service AT a specific location (e.g. emergency dentist in Austin)',
  location: 'a specific physical location, office, clinic, branch, or city page',
  service: 'a service, treatment, or procedure offered',
  solution: 'a solution / use-case offering (common in B2B/SaaS)',
  serviceProvider: 'a dealer, franchise, distributor, reseller, or partner listing',
  product: 'a product, shop, store, or catalog item',
  pricing: 'pricing, plans, or packages',
  company: 'company/about pages: about, contact, careers, leadership, press, team listing',
  blog: 'a blog post, article, news, or editorial insight',
  resource: 'a non-blog resource: FAQ, help, guide, whitepaper, case study, webinar, download',
  category: 'a category / collection / tag listing that groups other pages',
  landing: 'a marketing landing or campaign page',
  legal: 'legal/utility: privacy policy, terms, disclaimer, accessibility',
  other: 'anything that does not fit the types above',
};

const VALID = new Set(CONTENT_TYPES);
function isValidType(t) { return VALID.has(t); }

module.exports = { CONTENT_TYPES, TYPE_HINTS, isValidType };
