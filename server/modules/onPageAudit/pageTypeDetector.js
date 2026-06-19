function extractSchemas($) {
  const schemas = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const obj = JSON.parse($(el).html().trim());
      if (obj['@graph']) schemas.push(...obj['@graph']);
      else if (Array.isArray(obj)) schemas.push(...obj);
      else schemas.push(obj);
    } catch { /* ignore malformed JSON-LD */ }
  });
  return schemas;
}

function getSchemaTypes(schemas) {
  return schemas.flatMap(s => {
    const t = s['@type'];
    if (!t) return [];
    return (Array.isArray(t) ? t : [t]).map(x => x.toLowerCase());
  });
}

function detectPageType(data) {
  const url = data.finalUrl || data.inputUrl;
  const $ = data.$;

  if (!$ || !url) return { pageType: 'general', isYMYL: false };

  let path;
  try { path = new URL(url).pathname.toLowerCase(); } catch { path = '/'; }

  // ── 1. URL pattern — location ────────────────────────────────────────────────
  const locationUrlPatterns = [
    '/location/', '/locations/', '/offices/', '/office/', '/find-a-', '/near-me/',
    '/find-us/', '/contact/', '/our-office', '/visit-us',
  ];
  const geoSlugPattern = /\/(in|near|at)-[a-z-]+$|\/[a-z-]+-[a-z]{2}$|\/[0-9]{5}(\/|$)/;
  if (locationUrlPatterns.some(p => path.includes(p)) || geoSlugPattern.test(path)) {
    return { pageType: 'location', isYMYL: detectYMYL($, url) };
  }

  // ── 2. URL pattern — blog ────────────────────────────────────────────────────
  const blogUrlPatterns = ['/blog/', '/article/', '/articles/', '/resources/', '/news/', '/insights/', '/post/', '/posts/'];
  if (blogUrlPatterns.some(p => path.includes(p))) {
    return { pageType: 'blog', isYMYL: detectYMYL($, url) };
  }

  // ── 3/4. Schema type detection ───────────────────────────────────────────────
  const schemas = extractSchemas($);
  const schemaTypes = getSchemaTypes(schemas);

  const locationSchemaTypes = ['localbusiness', 'medicalclinic', 'dentist', 'physician', 'hospital', 'medicalorganization', 'geocoordinates'];
  if (schemaTypes.some(t => locationSchemaTypes.includes(t))) {
    return { pageType: 'location', isYMYL: detectYMYL($, url) };
  }

  const articleSchemaTypes = ['article', 'blogposting', 'newsarticle', 'medicalwebpage'];
  if (schemaTypes.some(t => articleSchemaTypes.includes(t))) {
    return { pageType: 'blog', isYMYL: detectYMYL($, url) };
  }

  // ── 5. H1 / address signals ───────────────────────────────────────────────────
  const h1 = $('h1').first().text();
  if (/suite|floor|\d{3,5}\s+[a-z]/i.test(h1)) {
    return { pageType: 'location', isYMYL: detectYMYL($, url) };
  }

  // ── 7. Homepage ───────────────────────────────────────────────────────────────
  if (path === '/' || path === '') {
    return { pageType: 'homepage', isYMYL: detectYMYL($, url) };
  }

  // ── 6/8. Service page or general ─────────────────────────────────────────────
  const bodyText = $('body').text().toLowerCase();
  const serviceSignals = ['treatment', 'procedure', 'therapy', 'services', 'implant', 'surgery', 'consultation'];
  if (serviceSignals.some(s => bodyText.includes(s))) {
    return { pageType: 'service', isYMYL: detectYMYL($, url) };
  }

  return { pageType: 'general', isYMYL: detectYMYL($, url) };
}

function detectYMYL($, url) {
  const ymylTerms = [
    'dental', 'dentist', 'health', 'medical', 'doctor', 'therapy', 'treatment',
    'surgery', 'mental', 'addiction', 'rehab', 'recovery', 'legal', 'attorney',
    'lawyer', 'financial', 'investment', 'insurance', 'prescription', 'medication',
    'clinic', 'hospital', 'physician',
  ];
  const lowerUrl = url.toLowerCase();
  const bodyText = ($('body').text() || '').toLowerCase().slice(0, 2000);
  const combined = lowerUrl + ' ' + bodyText;
  return ymylTerms.some(t => combined.includes(t));
}

module.exports = { detectPageType, extractSchemas, getSchemaTypes };
