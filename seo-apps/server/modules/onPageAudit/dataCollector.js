const axios = require('axios');
const cheerio = require('cheerio');

const FETCH_TIMEOUT = 15000;
const UA = 'Mozilla/5.0 (compatible; SEO-Auditor/1.0; +https://positionintelligence.com)';

// Follow redirects manually so we capture the full chain
async function fetchWithChain(url) {
  const chain = [];
  let current = url;
  let finalHtml = '';
  let finalStatus = 0;
  let finalHeaders = {};

  for (let hops = 0; hops < 10; hops++) {
    let res;
    try {
      res = await axios({
        method: 'GET',
        url: current,
        timeout: FETCH_TIMEOUT,
        maxRedirects: 0,
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        validateStatus: () => true,
        responseType: 'text',
      });
    } catch (e) {
      chain.push({ url: current, status: 0, error: e.message });
      throw e;
    }

    chain.push({ url: current, status: res.status, location: res.headers['location'] || null });

    if (res.status >= 300 && res.status < 400 && res.headers['location']) {
      try {
        current = new URL(res.headers['location'], current).href;
      } catch {
        break;
      }
    } else {
      finalStatus = res.status;
      finalHeaders = res.headers;
      finalHtml = typeof res.data === 'string' ? res.data : '';
      break;
    }
  }

  return { chain, finalUrl: current, finalStatus, finalHeaders, html: finalHtml };
}

async function fetchPSI(url, strategy) {
  const key = process.env.GOOGLE_PSI_API_KEY || '';
  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}${key ? `&key=${key}` : ''}`;

  const res = await axios({ url: endpoint, timeout: 60000, validateStatus: () => true });
  if (res.status !== 200) throw new Error(`PSI returned ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);

  const lr = res.data.lighthouseResult;
  if (!lr) throw new Error('No lighthouseResult in PSI response');

  const a = lr.audits || {};

  return {
    score: Math.round((lr.categories?.performance?.score ?? 0) * 100),
    lcp: a['largest-contentful-paint']?.displayValue || null,
    cls: a['cumulative-layout-shift']?.displayValue || null,
    inp: a['interaction-to-next-paint']?.displayValue || null,
    fcp: a['first-contentful-paint']?.displayValue || null,
    ttfb: a['server-response-time']?.displayValue || null,
    opportunities: Object.values(a)
      .filter(x => x.details?.type === 'opportunity' && x.score !== null && x.score < 1)
      .sort((x, y) => (x.score ?? 1) - (y.score ?? 1))
      .slice(0, 3)
      .map(x => ({ id: x.id, title: x.title, description: x.description })),
    audits: {
      tapTargets: a['tap-targets']?.score ?? null,
      fontSize: a['font-size']?.score ?? null,
      responsiveImages: a['uses-responsive-images']?.score ?? null,
      webpImages: a['uses-webp-images']?.score ?? null,
      optimizedImages: a['uses-optimized-images']?.score ?? null,
      viewport: a['viewport']?.score ?? null,
      colorContrast: a['color-contrast']?.score ?? null,
    },
    accessibilityScore: Math.round((lr.categories?.accessibility?.score ?? 0) * 100),
  };
}

function isBlockedByRobots(robotsTxt, url) {
  if (!robotsTxt) return false;
  try {
    const pagePath = new URL(url).pathname;
    const lines = robotsTxt.split('\n').map(l => l.trim());
    let ua = null;
    let blocked = false;

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.startsWith('user-agent:')) {
        ua = line.split(':').slice(1).join(':').trim().toLowerCase();
      } else if (lower.startsWith('disallow:') && (ua === '*' || ua === 'googlebot')) {
        const disallow = line.split(':').slice(1).join(':').trim();
        if (disallow && pagePath.startsWith(disallow)) {
          blocked = true;
        }
      }
    }
    return blocked;
  } catch { return false; }
}

async function checkSitemap(sitemapUrl, targetUrl, depth = 0) {
  if (depth > 2) return null;
  try {
    const res = await axios({ url: sitemapUrl, timeout: 10000, validateStatus: () => true, responseType: 'text' });
    if (res.status !== 200) return null;
    const xml = typeof res.data === 'string' ? res.data : '';
    const normTarget = targetUrl.replace(/\/$/, '');

    if (xml.includes('<sitemapindex')) {
      const childUrls = [...xml.matchAll(/<loc>(.*?)<\/loc>/gs)].map(m => m[1].trim());
      for (const child of childUrls.slice(0, 5)) {
        const found = await checkSitemap(child, targetUrl, depth + 1);
        if (found === true) return true;
      }
      return false;
    }

    const pageUrls = [...xml.matchAll(/<loc>(.*?)<\/loc>/gs)].map(m => m[1].trim().replace(/\/$/, ''));
    return pageUrls.includes(normTarget);
  } catch { return null; }
}

async function collectData(url, onProgress) {
  const result = {
    inputUrl: url,
    finalUrl: null,
    statusCode: null,
    redirectChain: [],
    responseHeaders: {},
    html: null,
    $: null,
    robotsTxt: null,
    robotsBlocked: false,
    sitemapUrl: null,
    inSitemap: null,
    psi: { mobile: null, desktop: null },
    httpRedirect: null,
    errors: {},
  };

  // Phase 1A/1B: Fetch HTML with redirect chain
  onProgress?.('Fetching page HTML…');
  try {
    const { chain, finalUrl, finalStatus, finalHeaders, html } = await fetchWithChain(url);
    result.redirectChain = chain;
    result.finalUrl = finalUrl;
    result.statusCode = finalStatus;
    result.responseHeaders = finalHeaders;
    result.html = html;
    result.$ = cheerio.load(html);
  } catch (e) {
    result.errors.html = e.message;
  }

  // 1B: HTTP → HTTPS redirect check
  onProgress?.('Checking HTTP redirect…');
  try {
    const httpUrl = url.replace(/^https:\/\//, 'http://');
    const res = await axios({
      method: 'GET', url: httpUrl, timeout: 8000, maxRedirects: 0,
      headers: { 'User-Agent': UA }, validateStatus: () => true,
    });
    result.httpRedirect = { status: res.status, location: res.headers['location'] || null };
  } catch (e) {
    result.errors.httpRedirect = e.message;
  }

  // 1C: robots.txt
  onProgress?.('Fetching robots.txt…');
  try {
    const origin = new URL(result.finalUrl || url).origin;
    const res = await axios({ url: `${origin}/robots.txt`, timeout: 8000, validateStatus: () => true, responseType: 'text' });
    if (res.status === 200 && typeof res.data === 'string') {
      result.robotsTxt = res.data;
      result.robotsBlocked = isBlockedByRobots(result.robotsTxt, result.finalUrl || url);
      const sitemapMatch = result.robotsTxt.match(/^Sitemap:\s*(.+)$/mi);
      if (sitemapMatch) result.sitemapUrl = sitemapMatch[1].trim();
    }
  } catch (e) {
    result.errors.robots = e.message;
  }

  // 1D: PSI — run both in parallel
  onProgress?.('Running PageSpeed Insights (this may take 30–60s)…');
  const [psiM, psiD] = await Promise.allSettled([
    fetchPSI(result.finalUrl || url, 'mobile'),
    fetchPSI(result.finalUrl || url, 'desktop'),
  ]);
  if (psiM.status === 'fulfilled') result.psi.mobile = psiM.value;
  else result.errors.psiMobile = psiM.reason?.message;
  if (psiD.status === 'fulfilled') result.psi.desktop = psiD.value;
  else result.errors.psiDesktop = psiD.reason?.message;

  // 1E: Sitemap check
  onProgress?.('Checking XML sitemap…');
  try {
    const sitemapUrl = result.sitemapUrl || `${new URL(result.finalUrl || url).origin}/sitemap.xml`;
    result.inSitemap = await checkSitemap(sitemapUrl, result.finalUrl || url);
  } catch (e) {
    result.errors.sitemap = e.message;
  }

  return result;
}

module.exports = { collectData };
