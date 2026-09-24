// ── Competitor taxonomy (V2 Phase 2) ──────────────────────────────────────────
// Classify a domain that ranks in the density SERP as one of:
//   'you'        — the client's own site (matched on registrable root domain)
//   'directory'  — an aggregator / listing / publisher / institutional site
//   'provider'   — everything else (HEURISTIC: assumed to be a real competing
//                  provider; there is no reliable signal to prove it, so this is a
//                  best-effort bucket, not a guarantee).
//
// The DIRECTORY set is the known aggregators seen in healthcare SERPs. It is
// exported and easy to extend per vertical.

const DIRECTORY_DOMAINS = new Set([
  // Spec's core list
  'healthgrades.com', 'zocdoc.com', 'webmd.com', 'vitals.com', 'ratemds.com', 'findatopdoc.com',
  'opencare.com', 'sharecare.com', 'caredash.com', 'realself.com', 'psychologytoday.com',
  'yelp.com', 'yellowpages.com', 'mapquest.com', 'facebook.com', 'instagram.com', 'reddit.com',
  'quora.com', 'wikipedia.org', 'nerdwallet.com', 'forbes.com',
  // Common additional aggregators / publishers in healthcare SERPs
  'goodrx.com', 'healthline.com', 'medicalnewstoday.com', 'mayoclinic.org', 'clevelandclinic.org',
  'wellness.com', 'angi.com', 'thumbtack.com', 'bbb.org', 'tripadvisor.com', 'glassdoor.com',
  'indeed.com', 'youtube.com', 'linkedin.com', 'tiktok.com', 'nextdoor.com', 'usnews.com',
  'ada.com', 'zdocs.com', 'solvhealth.com', 'medlineplus.gov',
]);

// Registrable root domain, e.g. "https://www.Sub.Healthgrades.com/x" → "healthgrades.com".
// Density domains are already root-reduced upstream; this is idempotent + safe on raw input.
function rootDomain(host) {
  const h = (host || '').toLowerCase().trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0];
  const parts = h.split('.').filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join('.') : h;
}

// gov / edu / mil are institutional (hospitals, universities, agencies) — not a
// competitor a private practice bids against, so they fall in the directory bucket.
function isInstitutional(domain) {
  return /(^|\.)(gov|edu|mil)$/.test(domain) || /\.gov\.[a-z]{2}$/.test(domain);
}

function isDirectory(domain) {
  const d = rootDomain(domain);
  return DIRECTORY_DOMAINS.has(d) || isInstitutional(d);
}

// Build a classifier bound to the client's own domain (may be null/empty/undefined).
// Returns (domain) => 'you' | 'directory' | 'provider'.
function makeClassifier(ownDomain) {
  const own = ownDomain ? rootDomain(ownDomain) : null;
  return (domain) => {
    const d = rootDomain(domain);
    if (own && d === own) return 'you';
    if (isDirectory(d)) return 'directory';
    return 'provider';
  };
}

module.exports = { makeClassifier, rootDomain, isDirectory, isInstitutional, DIRECTORY_DOMAINS };
