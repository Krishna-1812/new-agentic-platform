const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

const EXCLUDED_EXTENSIONS = /\.(pdf|jpe?g|png|gif|webp|svg|zip)$/i;

function makeAxiosConfig(auth) {
  return {
    timeout: 10000,
    maxRedirects: 5,
    headers: { 'User-Agent': 'RobotsMonitor/1.0 (Index Health Checker)' },
    auth: auth ? { username: auth.username, password: auth.password } : undefined,
  };
}

function isValidSitemapXml(parsed) {
  return parsed && (parsed.urlset || parsed.sitemapindex);
}

async function fetchXml(url, auth) {
  const res = await axios.get(url, { ...makeAxiosConfig(auth), responseType: 'text' });
  return parser.parse(res.data);
}

function extractUrlsFromUrlset(parsed) {
  const urlset = parsed.urlset;
  if (!urlset || !urlset.url) return [];
  const urls = Array.isArray(urlset.url) ? urlset.url : [urlset.url];
  return urls.map(u => (typeof u === 'string' ? u : u.loc)).filter(Boolean);
}

async function resolveSitemapIndex(parsed, auth) {
  const si = parsed.sitemapindex;
  if (!si || !si.sitemap) return [];
  const entries = Array.isArray(si.sitemap) ? si.sitemap : [si.sitemap];
  const locs = entries.map(e => (typeof e === 'string' ? e : e.loc)).filter(Boolean).slice(0, 10);

  let allUrls = [];
  for (const loc of locs) {
    try {
      const child = await fetchXml(loc, auth);
      if (child.urlset) {
        allUrls = allUrls.concat(extractUrlsFromUrlset(child));
      }
    } catch { /* skip failed child sitemaps */ }
  }
  return allUrls;
}

async function extractSitemapUrlsFromRobots(domainUrl, auth) {
  try {
    const res = await axios.get(`${domainUrl}/robots.txt`, { ...makeAxiosConfig(auth), responseType: 'text' });
    const matches = res.data.match(/^Sitemap:\s*(.+)$/gim) || [];
    return matches.map(line => line.replace(/^Sitemap:\s*/i, '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function fisherYatesShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function crawlDomain(domain) {
  const { url: domainUrl, auth } = domain;
  const base = domainUrl.replace(/\/$/, '');

  // Build candidate sitemap URLs (robots.txt directives come first)
  const fromRobots = await extractSitemapUrlsFromRobots(base, auth);
  const candidates = [
    ...fromRobots,
    `${base}/sitemap_index.xml`,
    `${base}/sitemap.xml`,
    `${base}/sitemap-index.xml`,
    `${base}/wp-sitemap.xml`,
  ];

  for (const candidate of candidates) {
    try {
      const parsed = await fetchXml(candidate, auth);
      if (!isValidSitemapXml(parsed)) continue;

      let rawUrls = [];
      if (parsed.sitemapindex) {
        rawUrls = await resolveSitemapIndex(parsed, auth);
      } else {
        rawUrls = extractUrlsFromUrlset(parsed);
      }

      // Deduplicate, strip binary files, keep only URLs on the crawl domain's hostname
      const domainHostname = new URL(base).hostname;
      const seen = new Set();
      const filtered = [];
      for (const u of rawUrls) {
        if (!u || seen.has(u) || EXCLUDED_EXTENSIONS.test(u)) continue;
        try {
          if (new URL(u).hostname !== domainHostname) continue;
        } catch { continue; }
        seen.add(u);
        filtered.push(u);
      }

      // No same-host URLs in this sitemap — try next candidate
      if (filtered.length === 0) continue;

      const urls = fisherYatesShuffle(filtered).slice(0, 100);

      return { sitemapUrl: candidate, sitemapStatus: 'found', urls, error: null };
    } catch { /* try next candidate */ }
  }

  // All candidates failed — homepage fallback
  return { sitemapUrl: null, sitemapStatus: 'not-found', urls: [base + '/'], error: null };
}

module.exports = { crawlDomain };
