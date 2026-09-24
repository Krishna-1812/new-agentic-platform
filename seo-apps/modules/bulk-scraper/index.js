/**
 * Bulk Page Scraper
 * Scrapes full HTML + structured data from a list of URLs.
 *
 * Usage:
 *   node index.js [urls-file]        (default: urls.txt)
 *   node index.js urls.txt --concurrency 5
 *
 * Output:
 *   output/<slug>.json   — full data per page
 *   output/summary.csv   — one row per URL with all fields
 */

// Resolve from server/node_modules since that's where puppeteer-core is installed
const serverModules = require('path').resolve(__dirname, '../../server/node_modules');
const puppeteer = require(require('path').join(serverModules, 'puppeteer-core'));
const chromium = require(require('path').join(serverModules, '@sparticuz/chromium'));
const fs = require('fs');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────────
const CONCURRENCY = parseInt(
  (process.argv.find(a => a.startsWith('--concurrency=')) || '--concurrency=5').split('=')[1],
  10
);
const PAGE_TIMEOUT = 30000;
const MAX_RETRIES = 1;
const OUTPUT_DIR = path.join(__dirname, 'output');
const URLS_FILE = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : path.join(__dirname, 'urls.txt');

// ─── Helpers ───────────────────────────────────────────────────────────────
function slugify(url) {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 120);
}

function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const str = String(val).replace(/"/g, '""');
  return /[",\n\r]/.test(str) ? `"${str}"` : str;
}

function readUrls(file) {
  if (!fs.existsSync(file)) {
    console.error(`URLs file not found: ${file}`);
    process.exit(1);
  }
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

// ─── Scraper ───────────────────────────────────────────────────────────────
async function scrapePage(browser, url) {
  let page;
  try {
    page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setDefaultNavigationTimeout(PAGE_TIMEOUT);
    await page.setDefaultTimeout(PAGE_TIMEOUT);

    // Don't block stylesheets — they can affect DOM. Block only images/fonts/media.
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (['image', 'font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Try domcontentloaded first; fall back to 'load' on retry
    let response;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
    } catch (firstErr) {
      if (/timeout/i.test(firstErr.message)) {
        // Retry with 'load' and a bit more patience
        response = await page.goto(url, { waitUntil: 'load', timeout: PAGE_TIMEOUT + 10000 });
      } else {
        throw firstErr;
      }
    }
    const statusCode = response ? response.status() : null;

    // Capture full raw HTML before any DOM mutations
    const rawHtml = await page.content();

    // Extract all structured data in one evaluate call
    const data = await page.evaluate(() => {
      // Meta helpers
      const getMeta = name =>
        document.querySelector(`meta[name="${name}"]`)?.content ||
        document.querySelector(`meta[property="${name}"]`)?.content || '';

      // All meta tags as key→value
      const allMeta = {};
      document.querySelectorAll('meta[name], meta[property]').forEach(el => {
        const key = el.getAttribute('name') || el.getAttribute('property');
        if (key) allMeta[key] = el.content || '';
      });

      // OG tags
      const ogTags = {};
      document.querySelectorAll('meta[property^="og:"]').forEach(el => {
        ogTags[el.getAttribute('property')] = el.content || '';
      });

      // Twitter card tags
      const twitterTags = {};
      document.querySelectorAll('meta[name^="twitter:"]').forEach(el => {
        twitterTags[el.getAttribute('name')] = el.content || '';
      });

      // Canonical
      const canonical = document.querySelector('link[rel="canonical"]')?.href || '';

      // Headings — all levels, preserve order
      const headings = {
        h1: Array.from(document.querySelectorAll('h1')).map(h => h.innerText.trim()).filter(Boolean),
        h2: Array.from(document.querySelectorAll('h2')).map(h => h.innerText.trim()).filter(Boolean),
        h3: Array.from(document.querySelectorAll('h3')).map(h => h.innerText.trim()).filter(Boolean),
        h4: Array.from(document.querySelectorAll('h4')).map(h => h.innerText.trim()).filter(Boolean),
        h5: Array.from(document.querySelectorAll('h5')).map(h => h.innerText.trim()).filter(Boolean),
        h6: Array.from(document.querySelectorAll('h6')).map(h => h.innerText.trim()).filter(Boolean),
      };

      // Heading order (flattened with level label)
      const headingOrder = [];
      document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(el => {
        headingOrder.push({ tag: el.tagName.toLowerCase(), text: el.innerText.trim() });
      });

      // Paragraphs
      const paragraphs = Array.from(document.querySelectorAll('p'))
        .map(p => p.innerText.trim())
        .filter(p => p.length > 20);

      // JSON-LD schema markup
      const schemaMarkup = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
        try {
          schemaMarkup.push(JSON.parse(el.textContent));
        } catch (e) {
          schemaMarkup.push({ _raw: el.textContent, _parseError: e.message });
        }
      });

      // Images (src + alt)
      const images = Array.from(document.querySelectorAll('img[src]')).map(img => ({
        src: img.src,
        alt: img.alt || '',
      }));

      // Internal/external links
      const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
        href: a.href,
        text: a.innerText.trim(),
      }));

      // Full visible body text (no nav/footer noise)
      const bodyText = (document.body?.innerText || '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      return {
        metaTitle: document.title || '',
        metaDescription: getMeta('description'),
        canonical,
        allMeta,
        ogTags,
        twitterTags,
        headings,
        headingOrder,
        paragraphs,
        schemaMarkup,
        images,
        links,
        bodyText,
        wordCount: bodyText.split(/\s+/).filter(Boolean).length,
      };
    });

    return {
      url,
      statusCode,
      scrapedAt: new Date().toISOString(),
      success: true,
      error: null,
      rawHtml,
      ...data,
    };
  } catch (err) {
    let errorMessage = err.message || 'Unknown error';
    if (/timeout/i.test(errorMessage)) errorMessage = `Timed out after ${PAGE_TIMEOUT / 1000}s`;
    else if (/net::ERR/.test(errorMessage)) errorMessage = 'Network error — page blocked or unavailable';
    else if (/Protocol error/.test(errorMessage)) errorMessage = 'Browser protocol error';

    console.error(`  ✗ FAILED  ${url} — ${errorMessage}`);
    return {
      url,
      statusCode: null,
      scrapedAt: new Date().toISOString(),
      success: false,
      error: errorMessage,
      rawHtml: '',
      metaTitle: '', metaDescription: '', canonical: '',
      allMeta: {}, ogTags: {}, twitterTags: {},
      headings: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
      headingOrder: [],
      paragraphs: [],
      schemaMarkup: [],
      images: [],
      links: [],
      bodyText: '',
      wordCount: 0,
    };
  } finally {
    if (page) {
      try { await page.close(); } catch (_) { /* ignore */ }
    }
  }
}

// ─── Concurrency runner ────────────────────────────────────────────────────
async function runWithConcurrency(items, maxConcurrency, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, items.length) }, () => worker())
  );
  return results;
}

// ─── CSV writer ────────────────────────────────────────────────────────────
function writeCsv(results, file) {
  const headers = [
    'url', 'success', 'statusCode', 'scrapedAt', 'error',
    'metaTitle', 'metaDescription', 'canonical',
    'wordCount',
    'h1_count', 'h2_count', 'h3_count',
    'h1_first', 'h2_first', 'h2_all',
    'schemaTypes',
    'og_title', 'og_description', 'og_type',
  ];

  const rows = results.map(r => [
    r.url,
    r.success,
    r.statusCode ?? '',
    r.scrapedAt,
    r.error ?? '',
    r.metaTitle,
    r.metaDescription,
    r.canonical,
    r.wordCount,
    r.headings.h1.length,
    r.headings.h2.length,
    r.headings.h3.length,
    r.headings.h1[0] ?? '',
    r.headings.h2[0] ?? '',
    r.headings.h2.join(' | '),
    r.schemaMarkup.map(s => s['@type'] || '?').join(' | '),
    r.ogTags?.['og:title'] ?? '',
    r.ogTags?.['og:description'] ?? '',
    r.ogTags?.['og:type'] ?? '',
  ]);

  const lines = [
    headers.map(escapeCsv).join(','),
    ...rows.map(row => row.map(escapeCsv).join(',')),
  ];
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const urls = readUrls(URLS_FILE);
  if (urls.length === 0) {
    console.error('No URLs found in file. Add one URL per line.');
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`\n=== Bulk Scraper ===`);
  console.log(`URLs:        ${urls.length}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Output:      ${OUTPUT_DIR}`);
  console.log(`Input file:  ${URLS_FILE}`);
  console.log('===================\n');

  // Launch browser
  const isLocal = !process.env.RAILWAY_ENVIRONMENT && !process.env.RENDER;

  // Auto-detect Chrome/Edge on local machine
  function findLocalBrowser() {
    const candidates = [
      process.env.CHROME_PATH,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      `C:\\Users\\${process.env.USERNAME}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ].filter(Boolean);

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  const executablePath = isLocal
    ? findLocalBrowser()
    : await chromium.executablePath();

  const browser = await puppeteer.launch({
    headless: isLocal ? true : chromium.headless,
    executablePath,
    args: [
      ...chromium.args,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080',
    ],
  });

  let completed = 0;
  const startTime = Date.now();

  try {
    const results = await runWithConcurrency(urls, CONCURRENCY, async (url, idx) => {
      console.log(`  [${idx + 1}/${urls.length}] Scraping: ${url}`);
      const result = await scrapePage(browser, url);
      completed++;

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const remaining = urls.length - completed;
      const avgTime = (Date.now() - startTime) / completed;
      const eta = ((remaining * avgTime) / 1000).toFixed(0);

      if (result.success) {
        console.log(`  ✓ ${idx + 1}/${urls.length}  [${elapsed}s elapsed, ~${eta}s left]  ${url}`);
      }

      // Save individual JSON (without rawHtml to keep summary small — rawHtml in separate file)
      const slug = slugify(url);
      const { rawHtml, ...summaryData } = result;

      fs.writeFileSync(
        path.join(OUTPUT_DIR, `${slug}.json`),
        JSON.stringify(summaryData, null, 2),
        'utf8'
      );
      fs.writeFileSync(
        path.join(OUTPUT_DIR, `${slug}.html`),
        rawHtml || '',
        'utf8'
      );

      return result;
    });

    // Write summary CSV
    const csvPath = path.join(OUTPUT_DIR, 'summary.csv');
    writeCsv(results, csvPath);

    // Write full JSON array (without rawHtml to keep file manageable)
    const allData = results.map(({ rawHtml: _html, ...r }) => r);
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'all_results.json'),
      JSON.stringify(allData, null, 2),
      'utf8'
    );

    const successCount = results.filter(r => r.success).length;
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n=== Done ===`);
    console.log(`Success: ${successCount}/${urls.length}`);
    console.log(`Failed:  ${urls.length - successCount}/${urls.length}`);
    console.log(`Time:    ${totalTime}s`);
    console.log(`\nOutput files:`);
    console.log(`  ${OUTPUT_DIR}/<slug>.json   — structured data per page`);
    console.log(`  ${OUTPUT_DIR}/<slug>.html   — raw HTML per page`);
    console.log(`  ${OUTPUT_DIR}/summary.csv   — spreadsheet-ready summary`);
    console.log(`  ${OUTPUT_DIR}/all_results.json  — all structured data combined`);

    if (successCount < urls.length) {
      console.log('\nFailed URLs:');
      results.filter(r => !r.success).forEach(r => {
        console.log(`  ✗ ${r.url}  —  ${r.error}`);
      });
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
