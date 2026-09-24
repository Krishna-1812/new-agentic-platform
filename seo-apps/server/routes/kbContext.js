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
    // Read index once
    const index = await store.readIndex();

    // ── Identify entries from index ──────────────────────────────────────────
    const brandEntry = index.knowledge_bases.find(
      kb => kb.category === 'brand' && kb.client === client
    );
    const feedbackEntries = index.knowledge_bases
      .filter(kb => kb.category === 'client-feedback' && kb.client === client && kb.active);

    // ── Parallel: brand KB file + all feedback KB files ──────────────────────
    const [brandKb, ...feedbackKbs] = await Promise.all([
      brandEntry ? store.readKB(brandEntry.id) : Promise.resolve(null),
      ...feedbackEntries.map(f => store.readKB(f.id)),
    ]);

    // ── Brand ────────────────────────────────────────────────────────────────
    let brand = null;
    if (brandEntry) {
      brand = {
        id: brandEntry.id,
        version: brandKb?.meta?.version || '1.0.0',
        active: brandEntry.active,
        hasContent: hasContent(brandKb?.body),
        industry: brandKb?.meta?.industry || null,
      };
    }

    // ── Industry (sequential — depends on brand.industry) ────────────────────
    let industry = null;
    if (brand?.industry && brand.industry !== 'global') {
      const industryEntry = index.knowledge_bases.find(
        kb => kb.category === 'industry' && kb.id === brand.industry
      );
      if (industryEntry) {
        const industryKb = await store.readKB(industryEntry.id);
        if (industryKb) {
          industry = {
            id: industryEntry.id,
            version: industryKb.meta?.version || '1.0.0',
            active: industryEntry.active,
            hasContent: hasContent(industryKb.body),
          };
        }
      }
    }

    // ── Client Feedback options (built from already-fetched KB files) ─────────
    const feedbackWithVersions = feedbackEntries
      .map((f, i) => {
        const kb = feedbackKbs[i];
        const period = f.id.replace(`${client}-feedback-`, '');
        return {
          id: f.id,
          period,
          label: kb?.meta?.label || period,
          version: kb?.meta?.version || '1.0.0',
          hasContent: hasContent(kb?.body),
        };
      })
      .sort((a, b) => b.period.localeCompare(a.period)); // newest first

    res.json({ brand, industry, feedbackOptions: feedbackWithVersions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
