// ── Named caps, all in one place per the build spec's guardrails ─────────────
module.exports = {
  MAX_SITEMAP_URLS: 25000,
  MAX_SITEMAP_RECURSION_DEPTH: 3,
  MAX_CHILD_SITEMAPS: 50, // safety valve independent of the URL cap — one bloated index can't hang discovery
  CRAWL_FALLBACK_DEPTH: 3,
  CRAWL_FALLBACK_MAX_URLS: 500,
  LARGE_SELECTION_THRESHOLD: 800, // above this, offer sample/all/skip before crawling (Stage 4)
  CRAWL_CONCURRENCY: 16,
  CRAWL_REQUEST_TIMEOUT_MS: 6000,
  CRAWL_TOTAL_BUDGET_MS: 90000,
  MAX_REDIRECT_HOPS: 3,
  FETCH_TIMEOUT_MS: 15000, // sitemap/robots fetches (Stage 1) — more lenient than the per-page crawl timeout
};
