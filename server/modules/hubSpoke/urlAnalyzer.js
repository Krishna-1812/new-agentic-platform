const axios = require('axios');
const cheerio = require('cheerio');

const FETCH_TIMEOUT = 10000;
const MAX_CONCURRENT = 8;
const PRIVATE_IP_RE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

// Classify page type from URL path
function inferPageType(pathname) {
  const p = pathname.toLowerCase();
  if (p === '/' || p === '') return 'hub-candidate';
  if (/\/(blog|resources\/articles?|articles?|news|posts?)\/?$/.test(p)) return 'article-index';
  if (/\/(blog|resources\/articles?|articles?|news|posts?)\/[^/]+/.test(p)) return 'article';
  if (/\/(services?|treatments?|procedures?)\/?/.test(p)) return 'service';
  if (/\/(locations?|offices?|clinics?|cities?)\/?/.test(p)) return 'location';
  if (/\/(category|tag|topics?)\/?/.test(p)) return 'category';
  if (/\/(about|contact|team|faq|privacy|terms|sitemap)\/?/.test(p)) return 'static';
  if (/\/[^/]+\/$/.test(p) && p.split('/').length === 3) return 'hub-candidate';
  return 'article';
}

// Turn a URL slug into readable topic words
function slugToTopic(pathname) {
  const segments = pathname.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1] || '';
  return lastSegment
    .replace(/[-_]/g, ' ')
    .replace(/\.(html?|php|aspx?)$/i, '')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function isPrivateUrl(url) {
  try {
    const { hostname } = new URL(url);
    return PRIVATE_IP_RE.test(hostname);
  } catch {
    return true;
  }
}

async function fetchPageData(url, auth) {
  const config = {
    url,
    timeout: FETCH_TIMEOUT,
    maxRedirects: 3,
    headers: { 'User-Agent': 'HubSpokeBot/1.0 (SEO Content Analyzer)' },
    validateStatus: () => true,
  };
  if (auth) config.auth = { username: auth.username, password: auth.password };

  const res = await axios(config);
  if (res.status !== 200) return null;

  const ct = res.headers['content-type'] || '';
  if (!ct.includes('text/html')) return null;

  const $ = cheerio.load(res.data);

  // Remove script/style noise
  $('script, style, nav, header, footer').remove();

  const title = $('title').first().text().trim() || null;
  const h1 = $('h1').first().text().trim() || null;
  const metaDesc = $('meta[name="description"]').attr('content')?.trim() || null;
  const canonical = $('link[rel="canonical"]').attr('href')?.trim() || null;

  const robotsMeta = $('meta[name="robots"], meta[name="googlebot"]').attr('content') || '';
  const isNoindex = robotsMeta.toLowerCase().includes('noindex');

  const h2s = [];
  $('h2').each((_, el) => {
    const t = $(el).text().trim();
    if (t) h2s.push(t);
    if (h2s.length >= 5) return false;
  });

  const finalUrl = res.request?.res?.responseUrl || url;

  return { title, h1, metaDesc, canonical, isNoindex, h2s, finalUrl };
}

async function analyzeUrl(url) {
  const result = {
    url,
    slug: '',
    inferredTopic: '',
    pageType: 'article',
    title: null,
    h1: null,
    metaDesc: null,
    canonical: null,
    isNoindex: false,
    h2s: [],
    crawlStatus: 'uncrawled',
    estimated: false,
  };

  if (isPrivateUrl(url)) {
    result.crawlStatus = 'skipped';
    result.estimated = true;
  } else {
    try {
      const parsed = new URL(url);
      result.slug = parsed.pathname;
      result.inferredTopic = slugToTopic(parsed.pathname);
      result.pageType = inferPageType(parsed.pathname);

      const data = await fetchPageData(url);
      if (data) {
        Object.assign(result, data);
        result.crawlStatus = 'crawled';
      } else {
        result.crawlStatus = 'failed';
        result.estimated = true;
      }
    } catch {
      result.crawlStatus = 'failed';
      result.estimated = true;
    }
  }

  if (!result.inferredTopic && result.slug) {
    result.inferredTopic = slugToTopic(result.slug);
  }

  return result;
}

// Analyze a list of URLs with limited concurrency, emitting progress via callback
async function analyzeUrls(urls, onProgress) {
  const results = [];
  let done = 0;

  async function processOne(url) {
    const r = await analyzeUrl(url);
    done++;
    if (onProgress) onProgress(done, urls.length, url);
    return r;
  }

  // Chunked concurrency — no Promise.all of everything at once
  const queue = [...urls];
  const workers = [];
  const slots = Math.min(MAX_CONCURRENT, queue.length);

  await new Promise((resolve) => {
    let active = 0;
    let nextIdx = 0;

    function next() {
      while (active < slots && nextIdx < queue.length) {
        active++;
        const url = queue[nextIdx++];
        processOne(url).then(r => {
          results.push(r);
          active--;
          if (nextIdx < queue.length) {
            next();
          } else if (active === 0) {
            resolve();
          }
        }).catch(() => {
          results.push({ url, crawlStatus: 'failed', estimated: true, inferredTopic: slugToTopic(url) });
          active--;
          if (nextIdx < queue.length) {
            next();
          } else if (active === 0) {
            resolve();
          }
        });
      }
    }

    if (queue.length === 0) { resolve(); return; }
    next();
  });

  return results;
}

module.exports = { analyzeUrls, analyzeUrl, inferPageType, slugToTopic };
