const express = require('express');
const router = express.Router();
const { analyzeContent } = require('../services/claude');
const { loadKBContext } = require('../services/kbLoader');

router.post('/', async (req, res) => {
  const { keyword, scrapedPages, client, feedbackKbIds } = req.body;

  if (!keyword || typeof keyword !== 'string') {
    return res.status(400).json({ error: 'A keyword is required.' });
  }

  if (!scrapedPages || !Array.isArray(scrapedPages)) {
    return res.status(400).json({ error: 'scrapedPages array is required.' });
  }

  try {
    // Load KB context if a client is provided
    const kbContext = client ? await loadKBContext('content-research', client, feedbackKbIds || null) : null;

    console.log(`[analyze] Sending ${scrapedPages.filter(p => p.success).length} pages to Claude for keyword: "${keyword}"${client ? ` (client: ${client}, KB confidence: ${kbContext?.confidence})` : ''}`);
    const analysis = await analyzeContent(keyword, scrapedPages, kbContext);
    res.json({ analysis, kbConfidence: kbContext?.confidence || null });
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
