const axios = require('axios');
const cheerio = require('cheerio');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeConfig(auth) {
  return {
    timeout: 10000,
    maxRedirects: 5,
    headers: { 'User-Agent': 'RobotsMonitor/1.0 (Index Health Checker)' },
    auth: auth ? { username: auth.username, password: auth.password } : undefined,
    validateStatus: () => true, // never throw on HTTP errors
  };
}

function parseXRobotsHeader(headerValue) {
  if (!headerValue) return false;
  // Handle bot-specific prefix: "googlebot: noindex" → strip prefix
  const val = headerValue.toLowerCase().replace(/^[a-z-]+:\s*/i, '');
  return val.includes('noindex');
}

function parseMetaRobots(html) {
  try {
    const $ = cheerio.load(html);
    let noindex = false;
    $('meta[name="robots"], meta[name="googlebot"]').each((_, el) => {
      const content = ($(el).attr('content') || '').toLowerCase();
      if (content.includes('noindex')) noindex = true;
    });
    return noindex;
  } catch {
    return false;
  }
}

function isHtml(contentType) {
  return !contentType || contentType.includes('text/html');
}

async function attemptFetch(pageUrl, auth) {
  const res = await axios.get(pageUrl, makeConfig(auth));
  return res;
}

async function checkPage(pageUrl, auth) {
  let res;
  try {
    res = await attemptFetch(pageUrl, auth);
  } catch (err) {
    // Retry once after 2s
    await delay(2000);
    try {
      res = await attemptFetch(pageUrl, auth);
    } catch (err2) {
      return {
        url: pageUrl, finalUrl: pageUrl, redirected: false,
        httpStatus: null, noindex: false, signal: null,
        error: err2.message,
      };
    }
  }

  // Axios with maxRedirects captures the final URL here
  const finalUrl = res.request?.res?.responseUrl || res.config?.url || pageUrl;
  const redirected = finalUrl !== pageUrl;
  const httpStatus = res.status;

  if (httpStatus === 401) {
    return {
      url: pageUrl, finalUrl, redirected, httpStatus,
      noindex: false, signal: null,
      error: 'Authentication required (401)',
    };
  }

  const contentType = res.headers['content-type'] || '';
  const headerNoindex = parseXRobotsHeader(res.headers['x-robots-tag']);
  const metaNoindex = isHtml(contentType) ? parseMetaRobots(res.data || '') : false;

  let signal = null;
  let noindex = false;
  if (headerNoindex && metaNoindex) { signal = 'both'; noindex = true; }
  else if (headerNoindex)           { signal = 'x-robots-header'; noindex = true; }
  else if (metaNoindex)             { signal = 'meta-tag'; noindex = true; }

  return { url: pageUrl, finalUrl, redirected, httpStatus, noindex, signal, error: null };
}

module.exports = { checkPage };
