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

module.exports = { slugify, pageUrl, canonicalUrl, breadcrumbLabel };
