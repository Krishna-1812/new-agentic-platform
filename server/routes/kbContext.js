const express = require('express');
const router = express.Router();
const store = require('../services/kbStore');

// Check whether a KB body has real content (not just HTML comments / section headers)
function hasContent(body) {
  if (!body) return false;
  const stripped = body
    .replace(/<!--[\s\S]*?-->/g, '')   // remove HTML comments
    .replace(/^#{1,6}\s.*$/gm, '')      // remove markdown headings
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > 20;
}

// GET /api/kb-context?client=gentle-dental&module=content-research
router.get('/', async (req, res) => {
  const { client, module: moduleId } = req.query;
  if (!client || !moduleId) {
    return res.status(400).json({ error: 'client and module query params are required.' });
  }

  try {
    const index = await store.readIndex();

    // ── Brand ────────────────────────────────────────────────────────────────
    const brandEntry = index.knowledge_bases.find(
      kb => kb.category === 'brand' && kb.client === client
    );
    let brand = null;
    if (brandEntry) {
      const kb = await store.readKB(brandEntry.id);
      brand = {
        id: brandEntry.id,
        version: kb?.meta?.version || '1.0.0',
        active: brandEntry.active,
        hasContent: hasContent(kb?.body),
        industry: kb?.meta?.industry || null,
      };
    }

    // ── Industry (resolved from brand's associated industry KB) ──────────────
    let industry = null;
    if (brand?.industry && brand.industry !== 'global') {
      const industryEntry = index.knowledge_bases.find(
        kb => kb.category === 'industry' && kb.id === brand.industry
      );
      if (industryEntry) {
        const kb = await store.readKB(industryEntry.id);
        industry = {
          id: industryEntry.id,
          version: kb?.meta?.version || '1.0.0',
          active: industryEntry.active,
          hasContent: hasContent(kb?.body),
        };
      }
    }

    // ── Client Feedback options (filtered to this client/brand) ─────────────
    const feedbackOptions = index.knowledge_bases
      .filter(kb => kb.category === 'client-feedback' && kb.client === client && kb.active)
      .map(kb => ({ id: kb.id, period: kb.id.replace(`${client}-feedback-`, '') }))
      .sort((a, b) => b.period.localeCompare(a.period)); // newest first

    // Fetch versions and labels for feedback entries
    const feedbackWithVersions = await Promise.all(
      feedbackOptions.map(async f => {
        const kb = await store.readKB(f.id);
        return {
          ...f,
          label: kb?.meta?.label || f.period,
          version: kb?.meta?.version || '1.0.0',
          hasContent: hasContent(kb?.body),
        };
      })
    );

    res.json({ brand, industry, feedbackOptions: feedbackWithVersions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
