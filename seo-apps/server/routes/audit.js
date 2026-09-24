const express = require('express');
const router = express.Router();
const store = require('../services/kbStore');

// GET /api/audit  — full dependency map and health check
router.get('/', async (req, res) => {
  try {
    const [kbList, modules] = await Promise.all([store.listKBs(), store.listModules()]);
    const kbMap = Object.fromEntries(kbList.map(kb => [kb.id, kb]));

    const ninety_days_ago = Date.now() - 90 * 24 * 60 * 60 * 1000;

    // Build per-module dependency report
    const moduleReports = modules.map(mod => {
      const required = (mod.required_kbs || []).map(pattern => {
        // Patterns like "brand/{client}" are unresolved — mark as TEMPLATE
        if (pattern.includes('{')) return { pattern, resolved: false, status: 'TEMPLATE' };
        const kb = kbMap[pattern];
        if (!kb) return { pattern, id: pattern, status: 'ERROR', reason: 'Not found in index' };
        if (!kb.active) return { pattern, id: pattern, status: 'ERROR', reason: 'KB inactive but required' };
        return { pattern, id: pattern, status: 'OK' };
      });

      const optional = (mod.optional_kbs || []).map(pattern => {
        if (pattern.includes('{')) return { pattern, resolved: false, status: 'TEMPLATE' };
        const kb = kbMap[pattern];
        if (!kb) return { pattern, id: pattern, status: 'WARNING', reason: 'Not found in index' };
        if (!kb.active) return { pattern, id: pattern, status: 'WARNING', reason: 'KB inactive' };
        return { pattern, id: pattern, status: 'OK' };
      });

      const hasError = required.some(r => r.status === 'ERROR');
      const hasWarning = optional.some(o => o.status === 'WARNING');
      return {
        module_id: mod.module_id,
        label: mod.label,
        active: mod.active,
        required,
        optional,
        health: hasError ? 'ERROR' : hasWarning ? 'WARNING' : 'OK',
      };
    });

    // Build per-KB health check
    const kbReports = kbList.map(kb => {
      const flags = [];
      if (!kb.active) flags.push({ level: 'ERROR', msg: 'Inactive' });
      if (kb.linked_modules.length === 0) flags.push({ level: 'INFO', msg: 'No linked modules (orphaned)' });

      // Check if stale (not updated in 90+ days)
      // We check based on what's in the index; full frontmatter would need file read
      // Flag modules that require this inactive KB
      if (!kb.active) {
        modules.forEach(mod => {
          const allKbs = [...(mod.required_kbs || []), ...(mod.optional_kbs || [])];
          if (allKbs.includes(kb.id)) {
            const isRequired = (mod.required_kbs || []).includes(kb.id);
            flags.push({
              level: isRequired ? 'ERROR' : 'WARNING',
              msg: `Referenced by ${mod.label} as ${isRequired ? 'required' : 'optional'}`,
            });
          }
        });
      }

      return {
        id: kb.id,
        category: kb.category,
        client: kb.client,
        active: kb.active,
        linked_modules: kb.linked_modules,
        flags,
        health: flags.some(f => f.level === 'ERROR') ? 'ERROR'
              : flags.some(f => f.level === 'WARNING') ? 'WARNING'
              : flags.some(f => f.level === 'INFO') ? 'INFO'
              : 'OK',
      };
    });

    res.json({
      modules: moduleReports,
      knowledge_bases: kbReports,
      summary: {
        total_kbs: kbList.length,
        active_kbs: kbList.filter(k => k.active).length,
        total_modules: modules.length,
        errors: [...moduleReports, ...kbReports].filter(r => r.health === 'ERROR').length,
        warnings: [...moduleReports, ...kbReports].filter(r => r.health === 'WARNING').length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
