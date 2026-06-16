const crypto = require('crypto');
const OpenAI = require('openai');
const { GENERIC_ANCHORS } = require('./clusterGenerator');
const { enrichWithAnchorText, anchorSharesTermWithTarget } = require('./anchorTextFinder');

const LINK_TYPES = ['hub-to-spoke', 'spoke-to-hub', 'spoke-to-spoke', 'cross-cluster'];
const PLACEMENTS = ['intro', 'body', 'h2-section', 'faq', 'conclusion', 'new-sentence'];

function genRecId() {
  return `rec_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

function getClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const SYSTEM = `You are an expert SEO strategist specializing in internal linking. Generate specific, actionable interlinking recommendations. Return ONLY valid JSON. No preamble, no markdown.`;

function pageSnippet(page) {
  return {
    url: page.url,
    title: page.title || page.inferredTopic || page.url,
    h1: page.h1,
    summary: page.metaDesc,
    topic: page.inferredTopic,
    h2s: page.h2s || [],
  };
}

function buildClusterPrompt(cluster, allPages) {
  const hubPage = allPages.find(p => p.url === cluster.hubPage?.url);
  const spokePages = (cluster.spokes || [])
    .map(s => allPages.find(p => p.url === s.url))
    .filter(Boolean);

  const hubSnippet = hubPage ? pageSnippet(hubPage) : { url: cluster.hubPage?.url, title: cluster.clusterName || cluster.name };

  return `Generate interlinking recommendations for this cluster: "${cluster.clusterName || cluster.name}"

Hub page: ${JSON.stringify(hubSnippet)}

Spoke pages: ${JSON.stringify(spokePages.map(pageSnippet))}

Generate:
1. hub-to-spoke: From the hub to its 3–5 most important spokes. Prefer spokes with broad topical relevance over geo-specific location pages (e.g. a national Preventive Dentistry hub should prefer general topic spokes, not city-specific spokes like "Oral Hygiene (Belmont)").
2. spoke-to-hub: From each spoke back to the hub
3. spoke-to-spoke: Only when there is a clear topical relationship (max 2 per spoke)

Rules:
- No self-links
- Placement: choose from intro, body, h2-section, faq, conclusion, new-sentence
- Relevance score: 1–5. Score 4–5 requires demonstrable topical overlap: the source page content directly discusses or complements the target page topic. Score 3 means moderate connection. Never assign 4 or 5 purely because pages share a cluster — the topics must actually be complementary.
- confidence: 0–100
- DO NOT include an "anchorText" or "recommendedAnchorText" field — anchor text will be determined separately from live page content
- suggestedContext: write ONE concrete sentence showing exactly where on the source page a link to the target would appear. The sentence must mention the target page topic by name so anchor text can later be found within it.

Return JSON:
{
  "recommendations": [
    {
      "sourceUrl": "string",
      "targetUrl": "string",
      "linkType": "hub-to-spoke|spoke-to-hub|spoke-to-spoke",
      "suggestedPlacement": "intro|body|h2-section|faq|conclusion|new-sentence",
      "suggestedContext": "concrete sentence that mentions the target topic directly",
      "relevanceScore": 4,
      "confidenceScore": 85,
      "priority": "high|medium|low",
      "reason": "specific topical overlap between source and target — not just cluster membership"
    }
  ]
}`;
}

function buildCrossClusterPrompt(clusters, allPages) {
  const clusterSummaries = clusters.map(c => ({
    name: c.clusterName || c.name,
    hubUrl: c.hubPage?.url,
    hubTitle: c.hubPage?.title || c.clusterName || c.name,
    spokeTopics: (c.spokes || []).slice(0, 5).map(s => s.title || s.url),
  }));

  return `Identify cross-cluster interlinking opportunities across these content clusters:

${JSON.stringify(clusterSummaries, null, 2)}

Rules:
- Only recommend when there is a strong, clear topical bridge between clusters (shared conditions, complementary treatments, shared patient concerns)
- Maximum 2–3 recommendations per cluster pair
- Mark these as linkType: "cross-cluster"
- Relevance score >= 3 only. Score 4–5 requires the topics to be directly complementary, not just in the same industry.
- DO NOT include anchorText — anchor text will be determined from live page content
- suggestedContext: write a concrete sentence that mentions the target page topic, so anchor text can be found within it

Return JSON with the same "recommendations" array structure (sourceUrl, targetUrl, linkType, suggestedPlacement, suggestedContext, relevanceScore, confidenceScore, priority, reason).`;
}

function validateRec(rec, pageUrlSet) {
  if (!rec.sourceUrl || !rec.targetUrl) return null;
  if (rec.sourceUrl === rec.targetUrl) return null;
  if (!pageUrlSet.has(rec.sourceUrl) || !pageUrlSet.has(rec.targetUrl)) return null;

  rec.relevanceScore = Math.max(1, Math.min(5, parseInt(rec.relevanceScore) || 3));
  rec.confidenceScore = Math.max(0, Math.min(100, parseInt(rec.confidenceScore) || 70));

  if (!LINK_TYPES.includes(rec.linkType)) rec.linkType = 'spoke-to-spoke';
  if (!PLACEMENTS.includes(rec.suggestedPlacement)) rec.suggestedPlacement = 'body';
  if (!['high', 'medium', 'low'].includes(rec.priority)) {
    rec.priority = rec.relevanceScore >= 4 ? 'high' : rec.relevanceScore === 3 ? 'medium' : 'low';
  }

  return {
    id: genRecId(),   // ← ID assigned here so enrichWithAnchorText can key recs correctly
    ...rec,
    recommendedAnchorText: null,
    anchorTextSource: null,
    anchorTextCandidates: [],
    anchorWarnings: [],
    existingLinksOnSourcePage: 0,
    existingAnchorTextForTarget: null,
    requiresNewSentence: false,
    suggestedNewSentence: null,
    status: 'pending',
    editedAnchorText: null,
    editedPlacement: null,
  };
}

// ── Geo-specific page detection ───────────────────────────────────────────────

function isGeoSpecificPage(url) {
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    // Detect pattern: service-name-cityname or service-name-statename
    // A geo-specific page has a proper noun location appended after the main keyword
    return /[-](belmont|cambridge|brookline|arlington|burlington|lexington|malden|newton|quincy|watertown|woburn|waltham|boston|somerville|medford|revere|everett|chelsea|lynn|lowell|worcester|springfield|atlanta|chicago|dallas|denver|houston|miami|seattle|phoenix|portland|raleigh|austin|nashville|charlotte|cleveland|columbus|detroit|minneapolis|orlando|pittsburgh|sacramento|tampa|tucson|richmond|greensboro|albuquerque|louisville|baltimore|memphis|milwaukee)$/i.test(slug);
  } catch { return false; }
}

// ── Conflict resolution ───────────────────────────────────────────────────────

// Per source page: if same anchor is assigned to two different targets, keep the
// higher-scored one and try to reassign the lower-scored to its next-best candidate.
function resolveAnchorConflicts(enriched) {
  const bySource = new Map();
  for (const rec of enriched) {
    if (!bySource.has(rec.sourceUrl)) bySource.set(rec.sourceUrl, []);
    bySource.get(rec.sourceUrl).push(rec);
  }

  for (const sourceRecs of bySource.values()) {
    const anchorToFirst = new Map();
    // Sort by relevance desc so the first rec we see for each anchor is the winner
    const sorted = [...sourceRecs].sort((a, b) => b.relevanceScore - a.relevanceScore);

    for (const rec of sorted) {
      const anchor = (rec.recommendedAnchorText || '').toLowerCase().trim();
      if (!anchor) continue;

      if (!anchorToFirst.has(anchor)) {
        anchorToFirst.set(anchor, rec.targetUrl);
        continue;
      }

      // Conflict: same anchor already claimed by a different target
      if (anchorToFirst.get(anchor) !== rec.targetUrl) {
        const usedAnchors = new Set(
          sourceRecs
            .filter(r => r !== rec)
            .map(r => (r.recommendedAnchorText || '').toLowerCase().trim())
            .filter(Boolean)
        );

        const alt = (rec.anchorTextCandidates || []).find(c => {
          const lower = c.anchorText.toLowerCase().trim();
          return lower !== anchor && !usedAnchors.has(lower);
        });

        if (alt) {
          rec.recommendedAnchorText = alt.anchorText;
          rec.anchorWarnings = (rec.anchorWarnings || []).filter(w => w !== 'duplicate-anchor-diff-target');
          anchorToFirst.set(alt.anchorText.toLowerCase().trim(), rec.targetUrl);
        } else {
          rec.recommendedAnchorText = null;
          rec.anchorTextSource = 'new-sentence-required';
          rec.requiresNewSentence = true;
          if (!rec.anchorWarnings.includes('duplicate-anchor-diff-target')) {
            rec.anchorWarnings = [...rec.anchorWarnings, 'duplicate-anchor-diff-target'];
          }
        }
      }
    }
  }

  return enriched;
}

// ── Main generator ────────────────────────────────────────────────────────────

async function generateRecommendations(clusters, allPages, options = {}, onProgress) {
  const openai = getClient();
  const pageUrlSet = new Set(allPages.map(p => p.url));
  const pagesMap = new Map(allPages.map(p => [p.url, p]));
  const { includeGapHubs = false, excludedUrls = [] } = options;
  const excludedSet = new Set(excludedUrls);

  const recs = [];
  const seen = new Set();

  function addRec(rec) {
    const validated = validateRec(rec, pageUrlSet);
    if (!validated) return;
    if (validated.relevanceScore < 3) return;
    if (excludedSet.has(validated.sourceUrl) || excludedSet.has(validated.targetUrl)) return;

    const targetCluster = clusters.find(c => c.hubPage?.url === validated.targetUrl);
    if (targetCluster?.hubPage?.hubStatus === 'gap' && !includeGapHubs) return;

    const key = `${validated.sourceUrl}|${validated.targetUrl}`;
    if (seen.has(key)) return;
    seen.add(key);
    recs.push(validated);
  }

  if (onProgress) onProgress({ step: 'prepare', clustersTotal: clusters.length, pagesTotal: allPages.length });

  // Phase 1: per-cluster structural recommendations
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    let clusterError = null;
    let parsed = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: buildClusterPrompt(cluster, allPages) },
          ],
          max_tokens: 3000,
        });
        parsed = JSON.parse(completion.choices[0].message.content);
        break;
      } catch (e) {
        if (attempt === 1) {
          clusterError = e.message;
          console.error(`[HubSpoke] Rec generation failed for cluster "${cluster.clusterName || cluster.name}": ${e.message}`);
          parsed = { recommendations: [] };
        }
      }
    }

    for (const rec of (parsed?.recommendations || [])) addRec(rec);

    if (onProgress) onProgress({
      step: 'per-cluster',
      currentClusterName: cluster.clusterName || cluster.name,
      clustersProcessed: i + 1,
      clustersTotal: clusters.length,
      recommendationsGenerated: recs.length,
      clusterError,
    });
  }

  // Phase 2: cross-cluster
  if (clusters.length > 1) {
    if (onProgress) onProgress({ step: 'cross-cluster', recommendationsGenerated: recs.length });
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: buildCrossClusterPrompt(clusters, allPages) },
        ],
        max_tokens: 2000,
      });
      const crossParsed = JSON.parse(completion.choices[0].message.content);
      for (const rec of (crossParsed?.recommendations || [])) {
        addRec({ ...rec, linkType: 'cross-cluster' });
      }
    } catch (e) {
      console.error('[HubSpoke] Cross-cluster rec generation failed:', e.message);
    }
  }

  if (onProgress) onProgress({ step: 'validating', recommendationsGenerated: recs.length });

  // Phase 3: anchor text enrichment (fetch real page content, find verbatim candidates)
  const uniqueSources = new Set(recs.map(r => r.sourceUrl).filter(Boolean));
  if (onProgress) onProgress({ step: 'anchor-text', sourcesProcessed: 0, sourcesTotal: uniqueSources.size });

  let enriched = await enrichWithAnchorText(recs, pagesMap, (progress) => {
    if (onProgress) onProgress({ step: 'anchor-text', ...progress });
  });

  // Phase 4: post-enrichment validation passes

  // 4a. Anchor not in context sentence → downgrade to new-sentence-required (structural rec kept)
  enriched = enriched.map(rec => {
    if (
      rec.anchorTextSource === 'existing-content' &&
      rec.recommendedAnchorText &&
      rec.suggestedContext &&
      !rec.suggestedContext.toLowerCase().includes(rec.recommendedAnchorText.toLowerCase())
    ) {
      return {
        ...rec,
        anchorTextSource: 'new-sentence-required',
        requiresNewSentence: true,
        anchorWarnings: [...(rec.anchorWarnings || []).filter(w => w !== 'anchor-not-in-context'), 'anchor-not-in-context'],
      };
    }
    return rec;
  });

  // 4b. Hard block: anchor shares no meaningful term with target page title/topic/url
  //     Skip check for new-sentence-required or page-unavailable (no anchor chosen yet)
  enriched = enriched.filter(rec => {
    if (!rec.recommendedAnchorText) return true;
    if (rec.anchorTextSource === 'new-sentence-required' || rec.anchorTextSource === 'page-unavailable') return true;
    const targetPage = pagesMap.get(rec.targetUrl);
    if (!anchorSharesTermWithTarget(rec.recommendedAnchorText, targetPage, rec.targetUrl)) {
      console.warn(`[HubSpoke] Blocked rec ${rec.id}: anchor "${rec.recommendedAnchorText}" has no topical overlap with target "${targetPage?.title || rec.targetUrl}"`);
      return false;
    }
    return true;
  });

  // 4c. Soft warning: hub-to-spoke linking to geo-specific page
  enriched = enriched.map(rec => {
    if (rec.linkType === 'hub-to-spoke' && isGeoSpecificPage(rec.targetUrl)) {
      const warnings = rec.anchorWarnings || [];
      if (!warnings.includes('geo-specific-target')) {
        return { ...rec, anchorWarnings: [...warnings, 'geo-specific-target'] };
      }
    }
    return rec;
  });

  // 4d. Resolve same-anchor same-source different-target conflicts
  enriched = resolveAnchorConflicts(enriched);

  return enriched;
}

module.exports = { generateRecommendations };
