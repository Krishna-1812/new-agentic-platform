const express = require('express');
const router = express.Router();
const { getApiUnitsBalance } = require('../services/semrushBalance');

// Short cache so bursts (e.g. React double-mount in dev, or a run finishing
// right after the header widget already fetched) don't double-hit Semrush.
const CACHE_TTL = 5000;
let cache = null; // { balance, checkedAt }

router.get('/balance', async (req, res) => {
  if (cache && Date.now() - cache.checkedAt < CACHE_TTL) {
    return res.json(cache);
  }
  try {
    const balance = await getApiUnitsBalance();
    cache = { balance, checkedAt: Date.now() };
    res.json(cache);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
