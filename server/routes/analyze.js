const express = require('express');
const router = express.Router();
const { analyzeContent } = require('../services/claude');

router.post('/', async (req, res) => {
  const { keyword, scrapedPages } = req.body;

  if (!keyword || typeof keyword !== 'string') {
    return res.status(400).json({ error: 'A keyword is required.' });
  }

  if (!scrapedPages || !Array.isArray(scrapedPages)) {
    return res.status(400).json({ error: 'scrapedPages array is required.' });
  }

  try {
    console.log(`[analyze] Sending ${scrapedPages.filter(p => p.success).length} pages to Claude for keyword: "${keyword}"`);
    const analysis = await analyzeContent(keyword, scrapedPages);
    res.json({ analysis });
  } catch (err) {
    console.error('[analyze] Error:', err.message);

    if (err.message.includes('API key') || err.message.includes('not configured')) {
      return res.status(401).json({ error: err.message });
    }

    if (err.message.includes('rate limit') || err.status === 429) {
      return res.status(429).json({ error: 'Claude API rate limit reached. Please wait a moment and try again.' });
    }

    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
