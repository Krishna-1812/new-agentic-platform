const { getDatabase } = require('../../../utils/countryToDatabase');
const { hasSemrushKey } = require('../provider');
const { createLlmClient, WRITER_MODEL_ID } = require('../../../services/llmProviders');
const { crawlSitemaps } = require('./sitemapAnalyzer');
const { fetchTopPages } = require('./topPagesAnalyzer');
const { classifyTemplates } = require('./templateClassifier');
const {
  extractTemplates, mapByTemplate, resolveType,
  countsFromTemplateCounts, countsFromPages,
} = require('./folderMapping');
const { summarizeTopPages, summarizeSitemapStructure } = require('./summarizer');
const { isValidType } = require('./taxonomy');
const { TOP_PAGES_COST, MAX_UNITS_PER_RUN } = require('./unitCosts');

function domainEntriesFor(client) {
  return [
    { domain: client.domain, label: client.name, isClient: true },
    ...client.competitors.map((c) => ({ domain: c.domain, label: c.label, isClient: false })),
  ];
}

// GPT (templateClassifier) drives every type decision, but its output is
// arranged so a human can see and correct it: the folder map is a flat,
// editable list of pattern → type, user edits win over GPT and persist across
// re-runs (userOverrides), and unchanged patterns are served from the prior
// run's cache so re-runs re-classify only genuinely new folders.
async function runContentAnalysis(client, previous) {
  const allEntries = domainEntriesFor(client);
  const database = getDatabase(client.country);
  const writerClient = createLlmClient(WRITER_MODEL_ID);
  const enabled = hasSemrushKey();

  // ── Fetch (Part 2 always; Part 1 needs SEMrush + fits its own budget) ──
  const sitemapRaw = await crawlSitemaps(allEntries);

  let topRaw = [];
  const topPagesSkipped = [];
  if (enabled) {
    const included = [];
    let usedUnits = 0;
    for (const entry of allEntries) {
      if (usedUnits + TOP_PAGES_COST > MAX_UNITS_PER_RUN) { topPagesSkipped.push(entry.domain); continue; }
      included.push(entry);
      usedUnits += TOP_PAGES_COST;
    }
    topRaw = await fetchTopPages(included, database);
  }
  const topByDomain = new Map(topRaw.map((d) => [d.domain, d]));

  // ── Template extraction (per domain, over its sitemap + top-page URLs) ──
  const globalTemplates = new Map(); // template -> { example, count }
  const sitemapTemplateCounts = new Map(); // domain -> { template: count }
  const taggedTopPages = new Map(); // domain -> pages[] with .template

  for (const s of sitemapRaw) {
    const top = topByDomain.get(s.domain);
    const sitemapUrls = s.urls || [];
    const topFullUrls = (top?.pages || []).map((p) => p.fullUrl);
    const { urlTemplate } = extractTemplates([...sitemapUrls, ...topFullUrls]);

    const perTemplate = {};
    for (const u of sitemapUrls) {
      const t = urlTemplate.get(u);
      perTemplate[t] = (perTemplate[t] || 0) + 1;
    }
    sitemapTemplateCounts.set(s.domain, perTemplate);

    if (top) {
      taggedTopPages.set(s.domain, top.pages.map((p) => ({ ...p, template: urlTemplate.get(p.fullUrl) })));
    }

    for (const [u, t] of urlTemplate) {
      const g = globalTemplates.get(t) || { example: u, count: 0 };
      g.count += 1;
      globalTemplates.set(t, g);
    }
  }

  // ── Classify: cache (prior run) + user overrides + GPT for new only ──
  const cache = new Map((previous?.folderMap || []).map((e) => [e.template, e]));
  const userOverrides = { ...(previous?.userOverrides || {}) };

  const allTemplates = [...globalTemplates.keys()];
  const needGpt = allTemplates
    .filter((t) => !cache.has(t) && !(t in userOverrides))
    .map((t) => ({ template: t, example: globalTemplates.get(t).example, count: globalTemplates.get(t).count }));
  const gptMap = needGpt.length ? await classifyTemplates(writerClient, needGpt) : new Map();

  const folderMap = allTemplates
    .sort((a, b) => globalTemplates.get(b).count - globalTemplates.get(a).count)
    .map((t) => {
      let type, source;
      if (t in userOverrides && isValidType(userOverrides[t])) { type = userOverrides[t]; source = 'user'; }
      else if (gptMap.has(t)) { type = gptMap.get(t); source = 'gpt'; }
      else if (cache.has(t)) { type = cache.get(t).type; source = cache.get(t).source || 'gpt'; }
      else { type = 'other'; source = 'gpt'; }
      return { template: t, example: globalTemplates.get(t).example, count: globalTemplates.get(t).count, type, source };
    });

  const byTemplate = mapByTemplate(folderMap);
  const now = new Date().toISOString();

  // ── Fan out to per-domain counts (raw sitemap URLs are NOT persisted) ──
  const sitemapDomains = sitemapRaw.map((s) => {
    const templateCounts = sitemapTemplateCounts.get(s.domain) || {};
    return {
      domain: s.domain, label: s.label, isClient: s.isClient,
      sitemapUrl: s.sitemapUrl, sitemapStatus: s.sitemapStatus, totalUrls: s.totalUrls,
      capped: s.capped, error: s.error,
      templateCounts,
      pageTypeCounts: countsFromTemplateCounts(templateCounts, byTemplate),
    };
  });

  const topPagesDomains = topRaw.map((d) => {
    const pages = (taggedTopPages.get(d.domain) || []).map((p) => ({ ...p, contentType: resolveType(p.template, byTemplate) }));
    return {
      domain: d.domain, label: d.label, isClient: d.isClient,
      pages,
      contentTypeCounts: countsFromPages(pages, byTemplate),
    };
  });

  // ── Summaries ──
  let topPagesSummary = '';
  if (topPagesDomains.length) {
    topPagesSummary = await summarizeTopPages(writerClient, topPagesDomains).catch((e) => `Summary generation failed: ${e.message}`);
  }
  const sitemapSummary = await summarizeSitemapStructure(writerClient, sitemapDomains).catch((e) => `Summary generation failed: ${e.message}`);

  return {
    capturedAt: now,
    folderMap,
    userOverrides,
    topPages: {
      enabled,
      fetchedAt: enabled ? now : null,
      skipped: topPagesSkipped,
      domains: topPagesDomains,
      summary: { text: topPagesSummary, generatedAt: topPagesDomains.length ? now : null },
    },
    sitemap: {
      fetchedAt: now,
      domains: sitemapDomains,
      summary: { text: sitemapSummary, generatedAt: now },
    },
  };
}

// ── Recompute on folder-map edit (no crawl, no GPT) ─────────────────────────
// The user edits pattern → type in the UI; this re-derives every per-domain
// count from the already-stored template counts and page templates. Edits are
// recorded as userOverrides so they survive future re-runs. Summaries are left
// as-is (now potentially stale) — the UI exposes "Regenerate" for those.
function applyMappingEdits(previous, edits) {
  if (!previous?.folderMap) throw new Error('Run Content Analysis first — there is no folder map to edit.');

  const cleanEdits = {};
  for (const [template, type] of Object.entries(edits || {})) {
    if (isValidType(type)) cleanEdits[template] = type;
  }

  const userOverrides = { ...(previous.userOverrides || {}), ...cleanEdits };
  const folderMap = previous.folderMap.map((e) =>
    e.template in cleanEdits ? { ...e, type: cleanEdits[e.template], source: 'user' } : e
  );
  const byTemplate = mapByTemplate(folderMap);

  const sitemapDomains = (previous.sitemap?.domains || []).map((d) => ({
    ...d,
    pageTypeCounts: countsFromTemplateCounts(d.templateCounts, byTemplate),
  }));
  const topPagesDomains = (previous.topPages?.domains || []).map((d) => {
    const pages = (d.pages || []).map((p) => ({ ...p, contentType: resolveType(p.template, byTemplate) }));
    return { ...d, pages, contentTypeCounts: countsFromPages(pages, byTemplate) };
  });

  return {
    ...previous,
    folderMap,
    userOverrides,
    mappingEditedAt: new Date().toISOString(),
    topPages: { ...previous.topPages, domains: topPagesDomains },
    sitemap: { ...previous.sitemap, domains: sitemapDomains },
  };
}

async function regenerateTopPagesSummary(previous) {
  if (!previous?.topPages?.domains?.length) throw new Error('Run Content Analysis first — there is no top-pages data to summarize.');
  const writerClient = createLlmClient(WRITER_MODEL_ID);
  const text = await summarizeTopPages(writerClient, previous.topPages.domains);
  return { ...previous, topPages: { ...previous.topPages, summary: { text, generatedAt: new Date().toISOString() } } };
}

async function regenerateSitemapSummary(previous) {
  if (!previous?.sitemap?.domains?.length) throw new Error('Run Content Analysis first — there is no sitemap data to summarize.');
  const writerClient = createLlmClient(WRITER_MODEL_ID);
  const text = await summarizeSitemapStructure(writerClient, previous.sitemap.domains);
  return { ...previous, sitemap: { ...previous.sitemap, summary: { text, generatedAt: new Date().toISOString() } } };
}

module.exports = { runContentAnalysis, applyMappingEdits, regenerateTopPagesSummary, regenerateSitemapSummary };
