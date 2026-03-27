const express = require('express');
const router = express.Router();
const { scrapeUrls } = require('../services/scraper');

router.post('/', async (req, res) => {
  const { urls } = req.body;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'An array of URLs is required.' });
  }

  if (urls.length > 10) {
    return res.status(400).json({ error: 'Maximum 10 URLs allowed per request.' });
  }

  try {
    console.log(`[scrape] Starting scrape of ${urls.length} URLs...`);
    const results = await scrapeUrls(urls);

    const successCount = results.filter(r => r.success).length;
    console.log(`[scrape] Completed: ${successCount}/${urls.length} pages scraped successfully`);

    const warnings = [];
    if (successCount < 5) {
      warnings.push(`Only ${successCount} of ${urls.length} pages were successfully scraped. Results may be less comprehensive.`);
    }

    res.json({ results, warnings });
  } catch (err) {
    console.error('[scrape] Fatal error:', err.message);
    res.status(500).json({ error: `Scraping failed: ${err.message}` });
  }
});

module.exports = router;
