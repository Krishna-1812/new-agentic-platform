// ── Deterministic URL / slug builder (Spec §7.2 step 1, §9) ─────────────────
// Pure functions — no IO, no LLM. These are the highest-value unit-tested
// pieces (Spec §0.4). URL pattern: /locations/[location-slug]/[service-slug]/

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')            // drop apostrophes outright
    .replace(/[^a-z0-9]+/g, '-')     // non-alphanumerics → hyphen
    .replace(/^-+|-+$/g, '')         // trim hyphens
    .replace(/-{2,}/g, '-');         // collapse repeats
}

// Location pages already carry their own slug (e.g. "psychiatrist-brea").
// The service page nests under it.
function pageUrl(locationSlug, serviceSlug) {
  const loc = slugify(locationSlug);
  const svc = slugify(serviceSlug);
  return `/locations/${loc}/${svc}/`;
}

function canonicalUrl(baseUrl, locationSlug, serviceSlug) {
  const origin = String(baseUrl || '').replace(/\/+$/, '');
  return `${origin}${pageUrl(locationSlug, serviceSlug)}`;
}

function breadcrumbLabel(serviceName, locationName) {
  return `${serviceName} in ${locationName}`;
}

// ── Dental (Gentle Dental) URL pattern — /dental-offices/{state}/{city}/{slug} ─
// The location's own `location_page_url` (from Appendix B) already encodes the
// state + city[+sub-area] segments (e.g. "/dental-offices/ma/boston/newbury-st"),
// so the combo page is simply that path + the service slug.
function dentalPageUrl(locationPageUrl, serviceSlug) {
  const base = String(locationPageUrl || '').replace(/\/+$/, '');
  return `${base}/${slugify(serviceSlug)}`;
}

function canonicalDentalUrl(baseUrl, locationPageUrl, serviceSlug) {
  const origin = String(baseUrl || '').replace(/\/+$/, '');
  return `${origin}${dentalPageUrl(locationPageUrl, serviceSlug)}`;
}

// CBH URLs carry a trailing slash -- "/locations/<location>/<service>/" --
// which is how the client's live site serves them. Kept apart from
// dentalPageUrl because the dental pages ship without one and are not ours to
// move.
function cbhPageUrl(locationPageUrl, serviceSlug) {
  const base = String(locationPageUrl || '').replace(/\/+$/, '');
  const slug = slugify(serviceSlug);
  return slug ? `${base}/${slug}/` : `${base}/`;
}

function canonicalCbhUrl(baseUrl, locationPageUrl, serviceSlug) {
  const origin = String(baseUrl || '').replace(/\/+$/, '');
  return `${origin}${cbhPageUrl(locationPageUrl, serviceSlug)}`;
}

module.exports = {
  slugify, pageUrl, canonicalUrl, breadcrumbLabel, dentalPageUrl, canonicalDentalUrl,
  cbhPageUrl, canonicalCbhUrl,
};
