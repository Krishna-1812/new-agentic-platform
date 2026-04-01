/**
 * KB Loader — resolves module KB dependencies and returns injected context.
 *
 * Usage:
 *   const { context, confidence, missing, systemPromptSuffix } = await loadKBContext('content-research', 'gentle-dental');
 *
 * The systemPromptSuffix is a pre-formatted string ready to append to any AI system prompt.
 */

const store = require('./kbStore');

// Client → industry mapping (derived from the index at load time, cached per call)
async function resolveClientIndustry(clientSlug) {
  const index = await store.readIndex();
  const brandKB = index.knowledge_bases.find(
    kb => kb.category === 'brand' && kb.client === clientSlug
  );
  if (!brandKB) return null;
  // Read the file to get the industry field from frontmatter
  const kb = await store.readKB(brandKB.id);
  return kb?.meta?.industry || null;
}

// Resolve a KB pattern like "brand/{client}" or "industry/{client-industry}" to an actual id
async function resolvePattern(pattern, clientSlug, clientIndustry, feedbackKbId = null) {
  if (!pattern.includes('{')) return pattern;

  if (pattern.startsWith('brand/')) {
    return clientSlug; // brand KB id = client slug
  }
  if (pattern.startsWith('industry/')) {
    return clientIndustry; // industry KB id = industry slug
  }
  if (pattern.startsWith('client-feedback/')) {
    // Use explicit feedback KB if provided, otherwise auto-select most recent
    if (feedbackKbId) return feedbackKbId;
    const index = await store.readIndex();
    const feedbackKBs = index.knowledge_bases.filter(
      kb => kb.category === 'client-feedback' && kb.client === clientSlug && kb.active
    );
    if (feedbackKBs.length === 0) return null;
    // Sort by id descending (relies on date-based naming like 2026-q1)
    feedbackKBs.sort((a, b) => b.id.localeCompare(a.id));
    return feedbackKBs[0].id;
  }
  return null;
}

async function loadKBContext(moduleId, clientSlug, feedbackKbId = null) {
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

  const clientIndustry = await resolveClientIndustry(clientSlug);

  // Helper: load one KB by id
  async function loadOne(id) {
    if (!id) return null;
    const kb = await store.readKB(id);
    if (!kb || !kb.meta.active) return null;
    return kb;
  }

  // Load required KBs
  for (const pattern of (manifest.required_kbs || [])) {
    const id = await resolvePattern(pattern, clientSlug, clientIndustry, feedbackKbId);
    const kb = await loadOne(id);
    if (!kb) {
      result.missing.push(id || pattern);
      result.confidence = 'LOW';
    } else {
      result.loaded.push(kb);
    }
  }

  // Load optional KBs
  for (const pattern of (manifest.optional_kbs || [])) {
    const id = await resolvePattern(pattern, clientSlug, clientIndustry, feedbackKbId);
    const kb = await loadOne(id);
    if (!kb) {
      result.skipped.push(id || pattern);
      if (result.confidence === 'HIGH') result.confidence = 'MEDIUM';
    } else {
      result.loaded.push(kb);
    }
  }

  // Build system prompt suffix
  if (result.loaded.length > 0) {
    const parts = ['\n\n=== LOADED KNOWLEDGE BASE CONTEXT ===\n'];
    // Order: Industry → Brand → Client Feedback → Best Practices
    const order = ['industry', 'brand', 'client-feedback', 'best-practices'];
    const sorted = [...result.loaded].sort(
      (a, b) => order.indexOf(a.meta.category) - order.indexOf(b.meta.category)
    );
    for (const kb of sorted) {
      parts.push(`--- KB: ${kb.id} (${kb.meta.category}) | v${kb.meta.version} ---`);
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
