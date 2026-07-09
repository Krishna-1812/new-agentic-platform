// ── Folder templating + mapping fan-out ─────────────────────────────────────
// Phase A (extractTemplates) and Phase C (fan-out) of the "classify templates,
// not URLs" process. Both are 100% deterministic and spend zero tokens — GPT
// (templateClassifier.js) makes every *semantic* decision; this file only
// compresses thousands of URLs into a few dozen folder patterns and, later,
// expands a template→type map back into per-domain counts.

const NUMERIC = /^\d+$/;
const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i;
const DATEISH = /^\d{4}$|^\d{4}-\d{2}/;

// A segment value that's clearly an instance identifier rather than a
// structural folder name — collapsed to "*" even when it isn't abundant.
function isInstanceLike(seg) {
  if (NUMERIC.test(seg)) return true;
  if (UUIDISH.test(seg)) return true;
  if (DATEISH.test(seg)) return true;
  if (seg.length > 40) return true;
  if ((seg.match(/-/g) || []).length >= 5) return true;
  return false;
}

// Above this many distinct sibling values under the same emerging template,
// values are treated as instances and collapsed to "*".
//
// At the ROOT only, a value that acts as a directory (has deeper paths under
// it) is kept literal even when abundant — top-level section names are the
// highest-signal tokens, and this shields them on otherwise-flat sites that
// have many one-off root pages. Deeper levels ignore that protection: a
// "/locations/austin/..." city is an instance to collapse even though it has
// children, so /locations/*/* forms rather than one template per city.
const SIBLING_CARDINALITY_THRESHOLD = 8;

function pathSegments(url) {
  let pathname;
  try { pathname = new URL(url).pathname; }
  catch {
    try { pathname = new URL(url, 'https://x.invalid').pathname; }
    catch { pathname = String(url || '/'); }
  }
  return pathname.split('/').filter(Boolean);
}

// Level-by-level templating. Grouping by the *emerging* templated prefix (not
// the literal path) is what makes deep instance folders collapse correctly —
// e.g. every city under /locations/* is counted together, so /locations/*/*
// forms instead of one template per city.
//
// Returns:
//   urlTemplate: Map<url, template>
//   counts:      Map<template, count>
//   examples:    Map<template, sampleUrl>
function extractTemplates(urls) {
  const segsByUrl = urls.map(pathSegments);
  const maxDepth = segsByUrl.reduce((m, s) => Math.max(m, s.length), 0);
  const templPrefix = urls.map(() => '');

  for (let depth = 0; depth < maxDepth; depth++) {
    const groups = new Map(); // emerging templated prefix -> [url indices]
    for (let i = 0; i < urls.length; i++) {
      if (segsByUrl[i].length <= depth) continue;
      const key = templPrefix[i];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }

    for (const idxs of groups.values()) {
      // Per distinct sibling value: does it act as a directory (has children)?
      const hasChildren = new Map();
      for (const i of idxs) {
        const v = segsByUrl[i][depth];
        if (!hasChildren.has(v)) hasChildren.set(v, false);
        if (segsByUrl[i].length > depth + 1) hasChildren.set(v, true);
      }
      const distinctCount = hasChildren.size;
      const abundant = distinctCount > SIBLING_CARDINALITY_THRESHOLD;

      for (const i of idxs) {
        const v = segsByUrl[i][depth];
        // Root-only directory protection (see threshold comment above).
        const protectedSection = depth === 0 && hasChildren.get(v);
        const collapse = isInstanceLike(v) || (abundant && !protectedSection);
        templPrefix[i] += '/' + (collapse ? '*' : v);
      }
    }
  }

  const urlTemplate = new Map();
  const counts = new Map();
  const examples = new Map();
  for (let i = 0; i < urls.length; i++) {
    const t = templPrefix[i] || '/';
    urlTemplate.set(urls[i], t);
    counts.set(t, (counts.get(t) || 0) + 1);
    if (!examples.has(t)) examples.set(t, urls[i]);
  }
  return { urlTemplate, counts, examples };
}

// ── Fan-out (Phase C) ────────────────────────────────────────────────────────

function mapByTemplate(folderMap) {
  const m = new Map();
  for (const entry of folderMap || []) m.set(entry.template, entry.type);
  return m;
}

function resolveType(template, byTemplate) {
  return byTemplate.get(template) || 'other';
}

// Per-domain sitemap type counts from stored template→count pairs + the
// current folder map. Pure arithmetic — no crawl, no GPT — so it re-runs
// instantly when the user edits the mapping.
function countsFromTemplateCounts(templateCounts, byTemplate) {
  const out = {};
  for (const [template, count] of Object.entries(templateCounts || {})) {
    const type = resolveType(template, byTemplate);
    out[type] = (out[type] || 0) + count;
  }
  return out;
}

// Per-domain top-pages content-type counts from each page's stored template.
function countsFromPages(pages, byTemplate) {
  const out = {};
  for (const p of pages || []) {
    const type = resolveType(p.template, byTemplate);
    out[type] = (out[type] || 0) + 1;
  }
  return out;
}

module.exports = {
  extractTemplates,
  isInstanceLike,
  mapByTemplate,
  resolveType,
  countsFromTemplateCounts,
  countsFromPages,
};
