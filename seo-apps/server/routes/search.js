const express = require('express');
const router = express.Router();
const { searchGoogle, getDailyCount } = require('../services/googleSearch');

router.post('/', async (req, res) => {
  const { keyword } = req.body;

  if (!keyword || typeof keyword !== 'string' || !keyword.trim()) {
    return res.status(400).json({ error: 'A keyword is required.' });
  }

  try {
    const data = await searchGoogle(keyword.trim());
    res.json(data);
  } catch (err) {
    if (err.code === 'QUOTA_EXCEEDED') {
      return res.status(429).json({ error: err.message });
    }
    console.error('[search] Error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

router.get('/count', (req, res) => {
  res.json({ searchCount: getDailyCount() });
});

module.exports = router;
