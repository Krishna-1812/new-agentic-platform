const OpenAI = require('openai');

const BATCH_SIZE = 40; // max pages per LLM call
const GENERIC_ANCHORS = new Set(['click here', 'read more', 'learn more', 'here', 'this article', 'this page', 'more information', 'more info', 'link', 'page']);

function getClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const SYSTEM_PROMPT = `You are an expert SEO content strategist. Your task is to analyze a list of web pages and organize them into a hub and spoke content architecture.

A hub page is a broad, authoritative overview page on a major topic. Spoke pages are supporting articles that explore specific subtopics within that hub's theme.

Return ONLY valid JSON. No preamble, no explanation, no markdown fences.`;

function buildUserPrompt(pages, priorClusterNames = []) {
  const pageList = pages.map(p => ({
    url: p.url,
    slug: p.slug,
    title: p.title || p.inferredTopic,
    h1: p.h1,
    summary: p.metaDesc,
    inferredTopic: p.inferredTopic,
    pageType: p.pageType,
  }));

  const priorContext = priorClusterNames.length > 0
    ? `\n\nExisting clusters already identified (do not duplicate these, but you may assign spokes to them):\n${priorClusterNames.map(n => `- ${n}`).join('\n')}`
    : '';

  return `Here are the web pages to analyze:

${JSON.stringify(pageList, null, 2)}${priorContext}

Your task:
1. Identify 3–8 hub topics. If a page is clearly a hub candidate (broad topic, short URL), use it. If a hub topic is needed but no page exists, flag it as a gap.
2. Assign each non-hub page as a spoke to the most relevant hub.
3. If a page genuinely bridges two hubs, mark it as dual-cluster (isPrimaryCluster: false for the secondary assignment).
4. Flag pages you cannot confidently assign as unassigned.
5. Flag pages that appear to target nearly identical intent as cannibalization risks.

Return exactly this JSON structure:
{
  "clusters": [
    {
      "clusterName": "string",
      "primaryTopic": "string",
      "primaryKeyword": "string",
      "searchIntent": "informational|navigational|transactional|commercial",
      "businessPriority": "high|medium|low",
      "hubPage": {
        "url": "string or null",
        "title": "string",
        "isGap": false,
        "gapUrl": "string or null"
      },
      "spokes": [
        {
          "url": "string",
          "title": "string",
          "primaryTopic": "string",
          "searchIntent": "informational|navigational|transactional|commercial",
          "funnelStage": "awareness|consideration|decision",
          "isPrimaryCluster": true,
          "confidenceScore": 85,
          "notes": "string or null"
        }
      ],
      "confidenceScore": 80
    }
  ],
  "unassignedPages": ["url1", "url2"],
  "cannibalizationFlags": [
    { "urls": ["url1", "url2"], "reason": "string" }
  ],
  "gapHubs": [
    { "clusterName": "string", "reason": "string", "suggestedUrl": "string or null" }
  ]
}`;
}

function validateAndCleanResponse(raw, inputUrls) {
  const inputSet = new Set(inputUrls);
  const seen = new Set();
  const warnings = [];

  if (!raw.clusters || !Array.isArray(raw.clusters)) {
    throw new Error('AI response missing "clusters" array');
  }

  // Remove hallucinated URLs; collect all assigned URLs
  raw.clusters = raw.clusters.map(cluster => {
    if (cluster.hubPage?.url && !inputSet.has(cluster.hubPage.url)) {
      if (!cluster.hubPage.isGap) {
        warnings.push(`Hub URL not in input: ${cluster.hubPage.url}`);
        cluster.hubPage.url = null;
        cluster.hubPage.isGap = true;
      }
    }
    if (cluster.hubPage?.url) seen.add(cluster.hubPage.url);

    cluster.spokes = (cluster.spokes || []).filter(s => {
      if (!inputSet.has(s.url)) {
        warnings.push(`Hallucinated spoke URL removed: ${s.url}`);
        return false;
      }
      seen.add(s.url);
      // Clamp confidence
      s.confidenceScore = Math.max(0, Math.min(100, parseInt(s.confidenceScore) || 70));
      // Validate enums
      if (!['informational', 'navigational', 'transactional', 'commercial'].includes(s.searchIntent)) {
        s.searchIntent = 'informational';
      }
      if (!['awareness', 'consideration', 'decision'].includes(s.funnelStage)) {
        s.funnelStage = 'awareness';
      }
      return true;
    });

    cluster.confidenceScore = Math.max(0, Math.min(100, parseInt(cluster.confidenceScore) || 70));
    if (!['informational', 'navigational', 'transactional', 'commercial'].includes(cluster.searchIntent)) {
      cluster.searchIntent = 'informational';
    }
    if (!['high', 'medium', 'low'].includes(cluster.businessPriority)) {
      cluster.businessPriority = 'medium';
    }
    return cluster;
  });

  // Add missing URLs to unassigned
  const unassigned = Array.isArray(raw.unassignedPages) ? [...raw.unassignedPages] : [];
  for (const url of inputUrls) {
    if (!seen.has(url) && !unassigned.includes(url)) {
      unassigned.push(url);
    }
  }
  raw.unassignedPages = unassigned.filter(u => inputSet.has(u));

  if (!Array.isArray(raw.cannibalizationFlags)) raw.cannibalizationFlags = [];
  if (!Array.isArray(raw.gapHubs)) raw.gapHubs = [];

  return { ...raw, _warnings: warnings };
}

async function generateClusters(analyzedPages, onProgress) {
  const openai = getClient();
  const allUrls = analyzedPages.map(p => p.url);

  // Split into batches
  const batches = [];
  for (let i = 0; i < analyzedPages.length; i += BATCH_SIZE) {
    batches.push(analyzedPages.slice(i, i + BATCH_SIZE));
  }

  let mergedClusters = [];
  let mergedUnassigned = [];
  let mergedCannibalization = [];
  let mergedGapHubs = [];
  const allWarnings = [];

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const priorNames = mergedClusters.map(c => c.clusterName);

    if (onProgress) onProgress(`Generating clusters for pages ${batchIdx * BATCH_SIZE + 1}–${Math.min((batchIdx + 1) * BATCH_SIZE, analyzedPages.length)} of ${analyzedPages.length}…`);

    let parsed = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(batch, priorNames) },
          ],
          max_tokens: 4000,
        });
        parsed = JSON.parse(completion.choices[0].message.content);
        break;
      } catch (e) {
        if (attempt === 1) throw new Error(`AI cluster generation failed after 2 attempts: ${e.message}`);
      }
    }

    const validated = validateAndCleanResponse(parsed, batch.map(p => p.url));
    allWarnings.push(...(validated._warnings || []));

    // Merge clusters (same name → merge spokes)
    for (const newCluster of validated.clusters) {
      const existing = mergedClusters.find(c => c.clusterName.toLowerCase() === newCluster.clusterName.toLowerCase());
      if (existing) {
        existing.spokes.push(...newCluster.spokes);
      } else {
        mergedClusters.push(newCluster);
      }
    }
    mergedUnassigned.push(...validated.unassignedPages);
    mergedCannibalization.push(...validated.cannibalizationFlags);
    mergedGapHubs.push(...validated.gapHubs);
  }

  return {
    clusters: mergedClusters,
    unassignedPages: [...new Set(mergedUnassigned)],
    cannibalizationFlags: mergedCannibalization,
    gapHubs: mergedGapHubs,
    warnings: allWarnings,
  };
}

module.exports = { generateClusters, GENERIC_ANCHORS };
