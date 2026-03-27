const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const PAGE_TIMEOUT = 15000;
const MAX_CONTENT_LENGTH = 5000;
const MAX_CONCURRENCY = 3;

async function runWithConcurrency(items, maxConcurrency, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

async function scrapeSinglePage(browser, url) {
  let page;
  try {
    page = await browser.newPage();

    await page.setUserAgent(USER_AGENT);
    await page.setDefaultNavigationTimeout(PAGE_TIMEOUT);
    await page.setDefaultTimeout(PAGE_TIMEOUT);

    // Block images, fonts, media to speed up scraping
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });

    const content = await page.evaluate((maxLen) => {
      // Remove noise elements
      const removeSelectors = [
        'nav', 'header', 'footer', 'aside',
        '.nav', '.navigation', '.header', '.footer', '.sidebar',
        '.advertisement', '.ad', '.ads', '.cookie', '.cookie-banner',
        '.popup', '.modal', '.overlay', '.social-share', '.related-posts',
        '.comments', '#comments', '.comment-section',
        '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
        '[role="search"]', '[aria-label="advertisement"]',
        'script', 'style', 'noscript', 'iframe', 'svg'
      ];

      removeSelectors.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(el => el.remove());
        } catch (e) { /* ignore */ }
      });

      // Try to find main content area
      const contentSelectors = [
        'main', 'article',
        '[role="main"]',
        '.main-content', '.post-content', '.entry-content',
        '.article-content', '.article-body', '.content-body',
        '#content', '#main', '#main-content', '#post-content',
        '.page-content', '.single-content'
      ];

      let mainEl = null;
      for (const sel of contentSelectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText && el.innerText.trim().length > 200) {
          mainEl = el;
          break;
        }
      }

      if (!mainEl) mainEl = document.body;

      let text = mainEl ? (mainEl.innerText || '') : '';
      // Collapse excess whitespace
      text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      return text.substring(0, maxLen);
    }, MAX_CONTENT_LENGTH);

    // Extract h2s for context
    const headings = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('h2')).map(h => h.innerText.trim()).filter(Boolean).slice(0, 10);
    });

    return {
      url,
      content,
      headings,
      wordCount: content.split(/\s+/).filter(Boolean).length,
      success: true,
      error: null
    };
  } catch (err) {
    let errorMessage = err.message || 'Unknown error';
    if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
      errorMessage = 'Timed out after 15 seconds';
    } else if (errorMessage.includes('net::ERR')) {
      errorMessage = 'Network error — page may be blocked or unavailable';
    } else if (errorMessage.includes('Protocol error')) {
      errorMessage = 'Browser protocol error';
    }

    return {
      url,
      content: '',
      headings: [],
      wordCount: 0,
      success: false,
      error: errorMessage
    };
  } finally {
    if (page) {
      try { await page.close(); } catch (e) { /* ignore */ }
    }
  }
}

async function scrapeUrls(urls) {
  let browser;
  try {
    const isLocal = !process.env.RAILWAY_ENVIRONMENT && !process.env.RENDER;
    const executablePath = isLocal
      ? undefined
      : await chromium.executablePath();

    browser = await puppeteer.launch({
      headless: isLocal ? true : chromium.headless,
      executablePath,
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    });

    const results = await runWithConcurrency(urls, MAX_CONCURRENCY, (url) =>
      scrapeSinglePage(browser, url)
    );

    return results;
  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) { /* ignore */ }
    }
  }
}

module.exports = { scrapeUrls };
