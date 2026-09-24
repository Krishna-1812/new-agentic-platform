const axios = require('axios');

const PSI_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

// PSI's short-window burst quota resets over roughly 100s (confirmed by
// direct testing), not the sub-second scale a naive retry might assume.
// Retrying sooner just re-triggers the same 429. Page Speed now runs as a
// background job (see dataFetcher.js/routes.js) instead of blocking the
// dashboard, so we can afford to wait out the real window.
const RATE_LIMIT_RETRY_DELAY_MS = 100_000;
const TRANSIENT_RETRY_DELAY_MS = 3_000; // timeouts/5xx clear in seconds, not minutes
const STRATEGY_GAP_MS = 1000; // gap between one domain's mobile -> desktop calls

// Primary defense against tripping the burst limit at all — process only a
// couple of domains at a time instead of firing every domain's mobile+desktop
// calls near-simultaneously (which is what turns 4 domains into 6-8
// concurrent PSI requests). The retry backoff above is only the safety net.
const DOMAIN_BATCH_SIZE = 2;
const BATCH_STAGGER_MS = 3000;
const IN_BATCH_START_STAGGER_MS = 500;

const MAX_FIXES = 5;
const PASSING_SCORE_THRESHOLD = 0.9; // Lighthouse's own "green" cutoff

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emptyStrategy() {
  return { score: null, lcp: 'N/A', cls: 'N/A', ttfb: 'N/A', fcp: 'N/A', inp: 'N/A', fixes: [] };
}

// Lighthouse descriptions ship with markdown links, e.g.
// "Defer offscreen images. [Learn more](https://web.dev/...)". Strip the URL,
// keep the link text, so a plain-text UI doesn't show a dead link.
function stripMarkdownLinks(text) {
  return (text || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
}

// Lighthouse's own opportunities/diagnostics audits, filtered to failing
// ones, sorted by estimated impact, capped to a short list. Titles and
// descriptions are Google/Lighthouse's own copy — zero extra API calls, zero
// LLM cost.
function extractFixes(lighthouseResult) {
  const audits = lighthouseResult?.audits || {};
  const failing = Object.values(audits).filter((a) => (
    a && typeof a.score === 'number' &&
    a.scoreDisplayMode !== 'notApplicable' && a.scoreDisplayMode !== 'informative' &&
    a.score < PASSING_SCORE_THRESHOLD
  ));

  return failing
    .map((a) => ({
      id: a.id,
      title: a.title,
      description: stripMarkdownLinks(a.description),
      savingsMs: typeof a.details?.overallSavingsMs === 'number' ? Math.round(a.details.overallSavingsMs) : null,
      _score: a.score,
    }))
    .sort((a, b) => {
      const aMs = a.savingsMs ?? -1;
      const bMs = b.savingsMs ?? -1;
      if (aMs !== bMs) return bMs - aMs; // biggest estimated time savings first
      return a._score - b._score; // then worst score first (diagnostics w/o an ms estimate)
    })
    .slice(0, MAX_FIXES)
    .map(({ _score, ...fix }) => fix);
}

// Client/competitor domains are sometimes stored with a scheme and/or
// trailing slash (e.g. a user pastes a full URL when adding a client)
// rather than a bare hostname. Normalize once here — without this, a
// domain already containing "https://" got double-prefixed into
// "https://https://example.com/", which PSI rejects outright (a 400,
// classified below as "unreachable") even though the domain itself is
// perfectly reachable.
function normalizeUrl(domain) {
  const bare = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return `https://${bare}`;
}

function classifyError(err) {
  const status = err.response?.status;
  if (status === 429) return { type: 'rate_limited', message: 'PageSpeed Insights rate limit hit' };
  if (status === 400) return { type: 'unreachable', message: 'Domain unreachable or invalid for PageSpeed Insights' };
  if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '')) {
    return { type: 'timeout', message: 'PageSpeed Insights request timed out' };
  }
  return { type: 'unknown', message: err.message || 'PageSpeed Insights request failed' };
}

async function runPageSpeedOnce(url, strategy) {
  const params = { url: url.startsWith('http') ? url : `https://${url}`, strategy };
  const apiKey = process.env.GOOGLE_PSI_API_KEY;
  if (apiKey) params.key = apiKey;

  const res = await axios.get(PSI_URL, { params, timeout: 30000 });
  const lhr = res.data.lighthouseResult || {};
  const cats = lhr.categories || {};
  const audits = lhr.audits || {};

  return {
    score: Math.round((cats.performance?.score ?? 0) * 100),
    lcp: audits['largest-contentful-paint']?.displayValue || 'N/A',
    cls: audits['cumulative-layout-shift']?.displayValue || 'N/A',
    ttfb: audits['server-response-time']?.displayValue || 'N/A',
    fcp: audits['first-contentful-paint']?.displayValue || 'N/A',
    inp: audits['interaction-to-next-paint']?.displayValue || 'N/A',
    coreWebVitalsPassed: res.data.loadingExperience?.overall_category === 'FAST',
    fixes: extractFixes(lhr),
  };
}

// Never throws — always resolves to { data, error }. This is the actual fix
// for the old bug where a 429 on one strategy call threw out of
// runPageSpeed() and, via plain awaits in getPageSpeedForDomain, silently
// discarded an already-successful sibling call for the OTHER strategy.
// 400s (genuinely unreachable/invalid) are never retried — retrying can't
// fix them. Everything else gets exactly one retry, with backoff sized to
// the error's real cause.
async function runPageSpeed(url, strategy) {
  try {
    return { data: await runPageSpeedOnce(url, strategy), error: null };
  } catch (err) {
    const classified = classifyError(err);
    if (classified.type === 'unreachable') return { data: null, error: classified };

    await sleep(classified.type === 'rate_limited' ? RATE_LIMIT_RETRY_DELAY_MS : TRANSIENT_RETRY_DELAY_MS);
    try {
      return { data: await runPageSpeedOnce(url, strategy), error: null };
    } catch (err2) {
      return { data: null, error: classifyError(err2) };
    }
  }
}

async function getPageSpeedForDomain(domain) {
  const url = normalizeUrl(domain);
  const mobile = await runPageSpeed(url, 'mobile');
  await sleep(STRATEGY_GAP_MS);
  const desktop = await runPageSpeed(url, 'desktop');

  const fixesSource = mobile.data || desktop.data; // prefer mobile; fall back to desktop only if mobile fully failed

  return {
    domain,
    mobile: mobile.data || emptyStrategy(),
    desktop: desktop.data || emptyStrategy(),
    coreWebVitalsPassed: mobile.data?.coreWebVitalsPassed || false,
    dataUnavailable: !mobile.data && !desktop.data,
    fixes: fixesSource ? fixesSource.fixes : [],
    strategyErrors: { mobile: mobile.error, desktop: desktop.error }, // explicit reason, never silently null
  };
}

async function getPageSpeedForAllDomains(domains) {
  const results = [];
  for (let i = 0; i < domains.length; i += DOMAIN_BATCH_SIZE) {
    const batch = domains.slice(i, i + DOMAIN_BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map((d, idx) => sleep(idx * IN_BATCH_START_STAGGER_MS).then(() => getPageSpeedForDomain(d)))
    );
    settled.forEach((r, j) => {
      if (r.status === 'fulfilled') { results.push(r.value); return; }
      results.push({
        domain: batch[j],
        mobile: emptyStrategy(),
        desktop: emptyStrategy(),
        coreWebVitalsPassed: false,
        dataUnavailable: true,
        fixes: [],
        strategyErrors: {
          mobile: { type: 'unknown', message: r.reason?.message },
          desktop: { type: 'unknown', message: r.reason?.message },
        },
        error: r.reason?.message,
      });
    });
    if (i + DOMAIN_BATCH_SIZE < domains.length) await sleep(BATCH_STAGGER_MS);
  }
  return results;
}

function scoreColor(score) {
  if (score === null || score === undefined) return '#9CA3AF';
  if (score >= 90) return '#1DA64B';
  if (score >= 50) return '#F0B816';
  return '#D3342E';
}

module.exports = { getPageSpeedForAllDomains, scoreColor };
