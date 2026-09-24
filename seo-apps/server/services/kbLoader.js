/**
 * KB Loader — resolves module KB dependencies and returns injected context.
 *
 * Usage:
 *   const { loaded, confidence, missing, systemPromptSuffix } = await loadKBContext('content-research', 'gentle-dental', feedbackKbIds);
 *
 * feedbackKbIds: string (legacy single) or array of KB ids — all will be loaded.
 * The systemPromptSuffix is a pre-formatted string ready to append to any AI system prompt.
 */

const store = require('./kbStore');

// Client → industry mapping — accepts pre-loaded index to avoid re-read
async function resolveClientIndustry(clientSlug, index) {
  const brandKB = index.knowledge_bases.find(
    kb => kb.category === 'brand' && kb.client === clientSlug
  );
  if (!brandKB) return null;
  const kb = await store.readKB(brandKB.id);
  return kb?.meta?.industry || null;
}

// Resolve a KB pattern like "brand/{client}" or "industry/{client-industry}" to an id.
// Returns '__feedback__' as a sentinel for client-feedback patterns (handled below).
function resolvePattern(pattern, clientSlug, clientIndustry) {
  if (!pattern.includes('{')) return pattern;
  if (pattern.startsWith('brand/')) return clientSlug;
  if (pattern.startsWith('industry/')) return clientIndustry;
  if (pattern.startsWith('client-feedback/')) return '__feedback__';
  return null;
}

async function loadKBContext(moduleId, clientSlug, feedbackKbIds = null) {
  // Normalise: accept string (legacy single) or array
  if (typeof feedbackKbIds === 'string' && feedbackKbIds) {
    feedbackKbIds = [feedbackKbIds];
  } else if (!Array.isArray(feedbackKbIds) || feedbackKbIds.length === 0) {
    feedbackKbIds = null;
  }

  const result = {
    loaded: [],    // { id, category, meta, body }
    missing: [],   // required KB ids that could not be loaded
    skipped: [],   // optional KB ids not found or inactive
    confidence: 'HIGH',
    systemPromptSuffix: '',
  };

  if (!clientSlug) {
    result.confidence = 'LOW';
    result.systemPromptSuffix = '\n\n⚠ BEST-EFFORT MODE: No client selected. Output will not be client-specific. Review carefully before use.';
    return result;
  }

  let manifest;
  try {
    manifest = await store.readModule(moduleId);
  } catch {
    result.confidence = 'LOW';
    return result;
  }

  // Read index ONCE and pass it to all helpers
  const index = await store.readIndex();
  const clientIndustry = await resolveClientIndustry(clientSlug, index);

  // Helper: load one KB by id
  async function loadOne(id) {
    if (!id) return null;
    const kb = await store.readKB(id);
    if (!kb || !kb.meta.active) return null;
    return kb;
  }

  // Helper: resolve pattern → ids, expanding __feedback__ into the feedbackKbIds array
  // or auto-selecting most recent if none specified
  function resolveIds(pattern) {
    const id = resolvePattern(pattern, clientSlug, clientIndustry);
    if (id !== '__feedback__') return id ? [id] : [];

    // Feedback pattern
    if (feedbackKbIds && feedbackKbIds.length > 0) return feedbackKbIds;

    // Auto-select most recent if nothing specified — use already-loaded index
    const feedbackKBs = index.knowledge_bases.filter(
      kb => kb.category === 'client-feedback' && kb.client === clientSlug && kb.active
    );
    if (feedbackKBs.length === 0) return [];
    feedbackKBs.sort((a, b) => b.id.localeCompare(a.id));
    return [feedbackKBs[0].id];
  }

  // Load required KBs
  for (const pattern of (manifest.required_kbs || [])) {
    const ids = resolveIds(pattern);
    if (ids.length === 0) {
      result.missing.push(pattern);
      result.confidence = 'LOW';
      continue;
    }
    const kbs = await Promise.all(ids.map(loadOne));
    let anyLoaded = false;
    kbs.forEach((kb, i) => {
      if (kb) { result.loaded.push(kb); anyLoaded = true; }
      else { result.missing.push(ids[i]); }
    });
    if (!anyLoaded) result.confidence = 'LOW';
  }

  // Load optional KBs
  for (const pattern of (manifest.optional_kbs || [])) {
    const ids = resolveIds(pattern);
    if (ids.length === 0) {
      result.skipped.push(pattern);
      if (result.confidence === 'HIGH') result.confidence = 'MEDIUM';
      continue;
    }
    const kbs = await Promise.all(ids.map(loadOne));
    kbs.forEach((kb, i) => {
      if (!kb) {
        result.skipped.push(ids[i]);
        if (result.confidence === 'HIGH') result.confidence = 'MEDIUM';
      } else {
        result.loaded.push(kb);
      }
    });
  }

  // Build system prompt suffix
  if (result.loaded.length > 0) {
    const parts = [
      '\n\n=== KNOWLEDGE BASE CONTEXT (LOW PRIORITY SUPPLEMENTAL) ===',
      'Use the context below as a low-priority supplemental signal only.',
      'It should inform — not override — decisions based on primary SERP/keyword data.\n',
    ];
    // Order: Industry → Brand → Client Feedback → Best Practices
    const order = ['industry', 'brand', 'client-feedback', 'best-practices'];
    const sorted = [...result.loaded].sort(
      (a, b) => order.indexOf(a.meta.category) - order.indexOf(b.meta.category)
    );
    for (const kb of sorted) {
      const label = kb.meta.label ? ` "${kb.meta.label}"` : '';
      parts.push(`--- KB: ${kb.id}${label} (${kb.meta.category}) | v${kb.meta.version} ---`);
      parts.push(kb.body.trim());
      parts.push('');
    }
    parts.push('=== END KNOWLEDGE BASE CONTEXT ===');
    result.systemPromptSuffix = parts.join('\n');
  }

  if (result.missing.length > 0) {
    result.systemPromptSuffix = `\n\n⚠ BEST-EFFORT MODE: Required KB(s) [${result.missing.join(', ')}] not loaded. Output may not be client-specific.`
      + result.systemPromptSuffix;
  }

  return result;
}

module.exports = { loadKBContext };
