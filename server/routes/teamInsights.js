const express = require('express');
const router = express.Router();
const { fetchAllSheetData, clearCache, getCachedData } = require('../services/sheetsService');

// GET /api/team-insights/data — returns normalized sheet data (cached up to 5 min)
router.get('/data', async (req, res) => {
  try {
    const data = await fetchAllSheetData(false);
    res.json(data);
  } catch (err) {
    console.error('[team-insights] fetch error:', err.message);

    // Return stale cache with warning if available
    const stale = getCachedData();
    if (stale) {
      return res.json({ ...stale, staleData: true, fetchError: err.message });
    }

    res.status(503).json({
      error: 'Unable to load sheet data.',
      detail: err.message,
    });
  }
});

// POST /api/team-insights/refresh — force-clears cache and re-fetches
router.post('/refresh', async (req, res) => {
  try {
    clearCache();
    const data = await fetchAllSheetData(true);
    res.json(data);
  } catch (err) {
    console.error('[team-insights] refresh error:', err.message);
    const stale = getCachedData();
    if (stale) {
      return res.json({ ...stale, staleData: true, fetchError: err.message });
    }
    res.status(503).json({ error: 'Refresh failed.', detail: err.message });
  }
});

module.exports = router;
