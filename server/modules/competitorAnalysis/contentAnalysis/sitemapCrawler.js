// ── Sitemap-based site structure crawler ────────────────────────────────────
// Adapted from server/modules/robotsMonitor/sitemapCrawler.js's robots.txt
// discovery + sitemap-index resolution, but for a different purpose: that
// crawler samples ~100 random URLs for index-health spot-checks; this one
// needs the FULL URL set (up to a safety cap) to produce accurate page-type
// counts — a random sample would badly distort a "340 location pages vs 12"
// comparison.
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const EXCLUDED_EXTENSIONS = /\.(pdf|jpe?g|png|gif|webp|svg|zip|css|js)$/i;

// Sane crawl limits so one bloated competitor sitemap can't hang the run.
const MAX_CHILD_SITEMAPS = 50;
const MAX_TOTAL_URLS = 20000;
const FETCH_TIMEOUT_MS = 15000;

// A bot-identifying User-Agent gets blocked outright by some sites' WAF/CDN
// bot protection (Cloudflare et al. return 403/406) — a realistic browser
// header set avoids that false negative. Matches the header set already used
// by articleEnhancement.js's crawler for the same reason.
function axiosConfig() {
  return {
    timeout: FETCH_TIMEOUT_MS,
    maxRedirects: 5,
    responseType: 'text',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  };
}

function stripWww(hostname) {
  return hostname.replace(/^www\./i, '');
}

async function fetchXml(url) {
  const res = await axios.get(url, axiosConfig());
  return parser.parse(res.data);
}

function isValidSitemapXml(parsed) {
  return !!(parsed && (parsed.urlset || parsed.sitemapindex));
}

function extractUrlsFromUrlset(parsed) {
  const urlset = parsed.urlset;
  if (!urlset || !urlset.url) return [];
  const urls = Array.isArray(urlset.url) ? urlset.url : [urlset.url];
  return urls.map((u) => (typeof u === 'string' ? u : u.loc)).filter(Boolean);
}

async function extractSitemapUrlsFromRobots(baseUrl) {
  try {
    const res = await axios.get(`${baseUrl}/robots.txt`, axiosConfig());
    const matches = res.data.match(/^Sitemap:\s*(.+)$/gim) || [];
    return matches.map((line) => line.replace(/^Sitemap:\s*/i, '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// Recursively resolves a sitemap (or sitemap index) into every URL across
// every child sitemap, up to MAX_CHILD_SITEMAPS files and MAX_TOTAL_URLS
// URLs. Sets `state.capped = true` the moment either limit is hit, so the
// caller can flag the result as a partial sample rather than a true total.
async function resolveAll(entryUrl, state) {
  if (state.urls.size >= MAX_TOTAL_URLS || state.sitemapsFetched >= MAX_CHILD_SITEMAPS) {
    state.capped = true;
    return;
  }
  let parsed;
  try {
    parsed = await fetchXml(entryUrl);
  } catch {
    return; // unreachable child sitemap — skip it, don't fail the whole crawl
  }
  state.sitemapsFetched++;
  if (!isValidSitemapXml(parsed)) return;

  if (parsed.sitemapindex) {
    const raw = parsed.sitemapindex.sitemap;
    const entries = Array.isArray(raw) ? raw : [raw].filter(Boolean);
    const locs = entries.map((e) => (typeof e === 'string' ? e : e?.loc)).filter(Boolean);
    for (const loc of locs) {
      if (state.urls.size >= MAX_TOTAL_URLS || state.sitemapsFetched >= MAX_CHILD_SITEMAPS) { state.capped = true; break; }
      await resolveAll(loc, state);
    }
    return;
  }

  for (const u of extractUrlsFromUrlset(parsed)) {
    if (state.urls.size >= MAX_TOTAL_URLS) { state.capped = true; break; }
    if (!EXCLUDED_EXTENSIONS.test(u)) state.urls.add(u);
  }
}

// Discovers the domain's sitemap(s) via robots.txt (falling back to common
// well-known paths when robots.txt is missing or has no Sitemap: directive),
// then crawls every one — recursing through sitemap indexes — to produce the
// full declared URL set for that domain.
//
// Tries both the bare domain and its www-prefixed variant as the base for
// robots.txt/sitemap discovery: some sites 404/redirect-loop on one but not
// the other (e.g. a legacy Apache redirect rule on the bare-domain path),
// and hostname matching is done www-agnostic, since it's common for a site
// tracked without "www." to declare all its sitemap URLs with it (or vice
// versa) — treating that as "no same-host URLs" would silently discard a
// perfectly good sitemap.
async function crawlDomain(domain) {
  const bareHost = stripWww(domain);
  const targetHost = stripWww(bareHost); // normalized comparison target
  const baseVariants = [`https://${bareHost}`, `https://www.${bareHost}`];

  for (const base of baseVariants) {
    const fromRobots = await extractSitemapUrlsFromRobots(base);
    const candidates = [
      ...fromRobots,
      `${base}/sitemap_index.xml`,
      `${base}/sitemap.xml`,
      `${base}/sitemap-index.xml`,
      `${base}/wp-sitemap.xml`,
    ];

    for (const candidate of candidates) {
      const state = { urls: new Set(), sitemapsFetched: 0, capped: false };
      await resolveAll(candidate, state);
      if (state.sitemapsFetched === 0) continue; // candidate never resolved — try the next one

      const sameHost = [...state.urls].filter((u) => {
        try { return stripWww(new URL(u).hostname) === targetHost; } catch { return false; }
      });
      if (!sameHost.length) continue;

      return {
        sitemapUrl: candidate,
        sitemapStatus: 'found',
        urls: sameHost,
        totalUrls: sameHost.length,
        capped: state.capped,
        error: null,
      };
    }
  }

  return {
    sitemapUrl: null,
    sitemapStatus: 'not-found',
    urls: [],
    totalUrls: 0,
    capped: false,
    error: 'No accessible sitemap found via robots.txt or common paths (tried with and without www).',
  };
}

module.exports = { crawlDomain, MAX_TOTAL_URLS, MAX_CHILD_SITEMAPS };
