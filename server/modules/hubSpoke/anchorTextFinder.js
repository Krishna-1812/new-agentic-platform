const axios = require('axios');
const cheerio = require('cheerio');
const OpenAI = require('openai');

const FETCH_TIMEOUT = 12000;
const MAX_CONTENT_CHARS = 16000;
const MAX_TARGETS_PER_BATCH = 6;
const CONCURRENT_FETCHES = 5;

function getClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function normalizeUrl(href, base) {
  try {
    const u = new URL(href, base);
    u.hash = '';
    return u.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function extractPageContent(html, sourceUrl) {
  const $ = cheerio.load(html);

  // Remove boilerplate
  $(
    'script, style, noscript, nav, header, footer, aside, ' +
    '[class*="nav"], [class*="navbar"], [class*="header"], [class*="footer"], ' +
    '[class*="sidebar"], [class*="menu"], [class*="cookie"], [class*="banner"], ' +
    '[class*="popup"], [class*="modal"], [class*="overlay"], ' +
    '[id*="nav"], [id*="header"], [id*="footer"], [id*="sidebar"]'
  ).remove();

  // Find main content
  const mainEl = $(
    'main, [role="main"], article, .content, #content, ' +
    '.main-content, #main-content, .entry-content, .post-content, .article-body'
  ).first();
  const root = mainEl.length ? mainEl : $('body');

  // Extract existing internal links
  const existingLinks = [];
  const seenLinkKeys = new Set();
  let srcHost;
  try { srcHost = new URL(sourceUrl).hostname; } catch { srcHost = ''; }

  root.find('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (!href || !text || text.length < 2) return;
    const normalized = normalizeUrl(href, sourceUrl);
    if (!normalized) return;
    try {
      if (new URL(normalized).hostname !== srcHost) return;
    } catch { return; }
    const key = `${normalized}|||${text.toLowerCase()}`;
    if (seenLinkKeys.has(key)) return;
    seenLinkKeys.add(key);
    existingLinks.push({ href: normalized, anchorText: text });
  });

  // Build structured content string
  let content = '';
  root.find('h1, h2, h3, p, li, dt, dd, blockquote').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 15) return;
    if (tag === 'p' && text.length < 30) return;
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      content += `\n\n[${tag.toUpperCase()}: ${text}]\n`;
    } else {
      content += text + ' ';
    }
  });
  content = content.trim();
  if (content.length > MAX_CONTENT_CHARS) {
    content = content.slice(0, MAX_CONTENT_CHARS) + '\n...[content truncated]';
  }

  return { content, existingLinks, existingLinkCount: existingLinks.length };
}

async function fetchSourcePage(url) {
  try {
    const res = await axios({
      url,
      timeout: FETCH_TIMEOUT,
      maxRedirects: 3,
      headers: {
        'User-Agent': 'HubSpokeAnchorBot/1.0 (SEO Anchor Text Analyzer)',
        Accept: 'text/html',
      },
      validateStatus: () => true,
    });
    if (res.status !== 200) {
      return { error: `http-${res.status}`, content: '', existingLinks: [], existingLinkCount: 0 };
    }
    const ct = res.headers['content-type'] || '';
    if (!ct.includes('text/html')) {
      return { error: 'not-html', content: '', existingLinks: [], existingLinkCount: 0 };
    }
    return extractPageContent(res.data, url);
  } catch (e) {
    const error = e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' ? 'timeout' : 'fetch-failed';
    return { error, content: '', existingLinks: [], existingLinkCount: 0 };
  }
}

// ── Anchor relevance helpers ──────────────────────────────────────────────────

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'to', 'for', 'with', 'on', 'at', 'by',
  'is', 'it', 'as', 'be', 'from', 'that', 'this', 'are', 'was', 'were', 'has', 'have',
  'had', 'not', 'but', 'can', 'will', 'your', 'our', 'their', 'its', 'how', 'what',
  'when', 'why', 'which', 'who', 'all', 'also', 'do', 'does', 'did', 'we', 'you',
  'they', 'he', 'she', 'my', 'his', 'her', 'up', 'so', 'if', 'than', 'into', 'about',
]);

function getContentWords(text) {
  return (text || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

// Returns true if anchorText shares at least one content word with the target page
// title, h1, topic, or URL slug — used to block "tooth decay" anchoring to a whitening page.
function anchorSharesTermWithTarget(anchorText, targetPage, targetUrl) {
  if (!anchorText) return false;
  const anchorWords = new Set(getContentWords(anchorText));

  let slug = '';
  try {
    slug = new URL(targetUrl || '').pathname.split('/').filter(Boolean).pop() || '';
    slug = slug.replace(/-/g, ' ');
  } catch { /* ignore */ }

  const targetText = [
    targetPage?.title,
    targetPage?.h1,
    targetPage?.inferredTopic,
    targetPage?.summary,
    slug,
  ].filter(Boolean).join(' ');

  if (!targetText.trim()) return true; // no info to check against, allow
  const targetWords = getContentWords(targetText);
  if (targetWords.length === 0) return true;

  return targetWords.some(w => anchorWords.has(w));
}

// ── LLM prompt ────────────────────────────────────────────────────────────────

const ANCHOR_SYSTEM = `You are an SEO specialist identifying anchor text for internal links. Find phrases that ALREADY EXIST verbatim in the source page content. Do NOT invent phrases. Only use text literally present in the provided source content.`;

function buildAnchorPrompt(sourceContent, existingLinks, targets) {
  const linksStr = existingLinks.length
    ? existingLinks.map(l => `  "${l.anchorText}" → ${l.href}`).join('\n')
    : '  (none detected)';

  const targetsStr = targets.map((t, i) =>
    `Target ${i + 1}:\n  targetUrl: ${t.targetUrl}\n  title: ${t.title || 'unknown'}\n  h1: ${t.h1 || 'unknown'}\n  description: ${t.metaDesc || t.summary || 'n/a'}\n  topic: ${t.topic || t.inferredTopic || 'unknown'}`
  ).join('\n\n');

  return `SOURCE PAGE CONTENT:
${sourceContent}

EXISTING INTERNAL LINKS ON THIS PAGE:
${linksStr}

FIND ANCHOR TEXT CANDIDATES FOR EACH TARGET:
${targetsStr}

Rules:
- Phrases must appear VERBATIM in the source content above
- CRITICAL: The anchor phrase must describe what the TARGET page is about — it must share at least one meaningful word with the target's title, H1, or topic. Never use an anchor about an unrelated concept (e.g. "tooth decay" as anchor for a teeth whitening page is WRONG).
- 2–7 words preferred; never generic ("click here", "read more", "learn more", "here", "this page", "this article", "more information", "find out more", "check out", "visit")
- Do NOT select a phrase already used as anchor text to a DIFFERENT target URL on this page
- If the target URL is already linked from this source, set existingLinkToTarget: true and existingAnchorText to the current anchor text — still provide candidates for potential anchor text improvement
- Score relevance (how well the phrase describes the target) and naturalness (how natural it reads as link text) 1–5; include up to 5 candidates per target
- If no suitable phrase exists that both appears verbatim AND relates to the target topic, set requiresNewSentence: true and provide suggestedNewSentence with a [LINK] placeholder embedding the target topic

Return JSON only:
{
  "results": [
    {
      "targetUrl": "same URL as provided",
      "existingLinkToTarget": false,
      "existingAnchorText": null,
      "candidates": [
        {
          "anchorText": "exact phrase from source content",
          "section": "H2 heading or paragraph description",
          "relevanceScore": 1,
          "naturalness": 1,
          "reason": "brief explanation"
        }
      ],
      "requiresNewSentence": false,
      "suggestedNewSentence": null
    }
  ]
}`;
}

function verifyCandidate(anchorText, content) {
  if (!anchorText || !content) return false;
  return content.toLowerCase().includes(anchorText.toLowerCase().trim());
}

async function findAnchorTextForBatch(sourceContent, existingLinks, targets) {
  const openai = getClient();
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: ANCHOR_SYSTEM },
        { role: 'user', content: buildAnchorPrompt(sourceContent, existingLinks, targets) },
      ],
      max_tokens: 4000,
    });
    const parsed = JSON.parse(completion.choices[0].message.content);
    const results = parsed.results || [];

    // Verify each candidate exists verbatim AND is topically relevant to its target
    return results.map(r => {
      const target = targets.find(t => t.targetUrl === r.targetUrl);
      return {
        ...r,
        candidates: (r.candidates || []).filter(c =>
          verifyCandidate(c.anchorText, sourceContent) &&
          anchorSharesTermWithTarget(c.anchorText, target, r.targetUrl)
        ),
      };
    });
  } catch (e) {
    console.error('[HubSpoke] Anchor text LLM error:', e.message);
    return targets.map(t => ({
      targetUrl: t.targetUrl,
      existingLinkToTarget: false,
      existingAnchorText: null,
      candidates: [],
      requiresNewSentence: false,
      suggestedNewSentence: null,
    }));
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

const GENERIC_SET = new Set([
  'click here', 'read more', 'learn more', 'here', 'this', 'this page',
  'this article', 'more information', 'find out more', 'check out',
  'click', 'link', 'see more', 'view more', 'more details', 'visit',
]);

function validateAnchorText(anchorText, rec, allRecs) {
  if (!anchorText) return [];
  const text = anchorText.trim();
  const words = text.split(/\s+/).filter(Boolean);
  const warnings = [];

  if (words.length < 2) warnings.push('anchor-too-short');
  if (words.length > 10) warnings.push('anchor-too-long');
  if (GENERIC_SET.has(text.toLowerCase())) warnings.push('generic-phrase');

  // Same anchor → different target, same source
  const dupDiffTarget = allRecs.some(r =>
    r.id !== rec.id &&
    r.sourceUrl === rec.sourceUrl &&
    r.targetUrl !== rec.targetUrl &&
    (r.editedAnchorText || r.recommendedAnchorText || '').toLowerCase() === text.toLowerCase()
  );
  if (dupDiffTarget) warnings.push('duplicate-anchor-diff-target');

  // Same anchor → same target, used ≥ 3 times across project
  const overused = allRecs.filter(r =>
    r.id !== rec.id &&
    r.targetUrl === rec.targetUrl &&
    (r.editedAnchorText || r.recommendedAnchorText || '').toLowerCase() === text.toLowerCase()
  ).length >= 3;
  if (overused) warnings.push('anchor-overused-for-target');

  return warnings;
}

// ── Main export ───────────────────────────────────────────────────────────────

async function enrichWithAnchorText(recs, pagesMap, onProgress) {
  // Group recs by sourceUrl
  const bySource = new Map();
  for (const rec of recs) {
    if (!rec.sourceUrl) continue;
    if (!bySource.has(rec.sourceUrl)) bySource.set(rec.sourceUrl, []);
    bySource.get(rec.sourceUrl).push(rec);
  }

  const sourceUrls = Array.from(bySource.keys());
  const sourcesTotal = sourceUrls.length;
  let sourcesProcessed = 0;
  const contentCache = new Map();
  const anchorResultsById = new Map();

  if (onProgress) onProgress({ sourcesProcessed: 0, sourcesTotal, currentSourceUrl: null });

  async function processSource(sourceUrl) {
    let pageData = contentCache.get(sourceUrl);
    if (!pageData) {
      pageData = await fetchSourcePage(sourceUrl);
      contentCache.set(sourceUrl, pageData);
    }

    const sourceRecs = bySource.get(sourceUrl);

    if (pageData.error) {
      for (const rec of sourceRecs) {
        anchorResultsById.set(rec.id, {
          anchorTextSource: 'page-unavailable',
          recommendedAnchorText: null,
          anchorTextCandidates: [],
          existingLinksOnSourcePage: 0,
          existingAnchorTextForTarget: null,
          requiresNewSentence: false,
          suggestedNewSentence: null,
        });
      }
      sourcesProcessed++;
      if (onProgress) onProgress({ sourcesProcessed, sourcesTotal, currentSourceUrl: sourceUrl, error: pageData.error });
      return;
    }

    // Build targets for this source
    const targets = sourceRecs.map(rec => {
      const page = pagesMap.get(rec.targetUrl) || {};
      return {
        recId: rec.id,
        targetUrl: rec.targetUrl,
        title: page.title || rec.targetTitle || '',
        h1: page.h1 || '',
        metaDesc: page.metaDesc || '',
        topic: page.inferredTopic || '',
        summary: page.summary || '',
      };
    });

    // Batch into groups of MAX_TARGETS_PER_BATCH
    const allBatchResults = [];
    for (let i = 0; i < targets.length; i += MAX_TARGETS_PER_BATCH) {
      const batch = targets.slice(i, i + MAX_TARGETS_PER_BATCH);
      const batchResults = await findAnchorTextForBatch(
        pageData.content,
        pageData.existingLinks,
        batch
      );
      allBatchResults.push(...batchResults);
    }

    const resultByTarget = new Map(allBatchResults.map(r => [r.targetUrl, r]));

    for (const rec of sourceRecs) {
      const found = resultByTarget.get(rec.targetUrl);

      if (!found) {
        anchorResultsById.set(rec.id, {
          anchorTextSource: 'page-unavailable',
          recommendedAnchorText: null,
          anchorTextCandidates: [],
          existingLinksOnSourcePage: pageData.existingLinkCount,
          existingAnchorTextForTarget: null,
          requiresNewSentence: false,
          suggestedNewSentence: null,
        });
        continue;
      }

      const candidates = (found.candidates || [])
        .sort((a, b) => (b.relevanceScore + b.naturalness) - (a.relevanceScore + a.naturalness));
      const best = candidates[0];

      if (found.existingLinkToTarget) {
        anchorResultsById.set(rec.id, {
          anchorTextSource: 'existing-link',
          recommendedAnchorText: found.existingAnchorText || (best?.anchorText ?? null),
          anchorTextCandidates: candidates,
          existingLinksOnSourcePage: pageData.existingLinkCount,
          existingAnchorTextForTarget: found.existingAnchorText,
          requiresNewSentence: false,
          suggestedNewSentence: null,
        });
      } else if (found.requiresNewSentence || !best) {
        anchorResultsById.set(rec.id, {
          anchorTextSource: 'new-sentence-required',
          recommendedAnchorText: best?.anchorText ?? null,
          anchorTextCandidates: candidates,
          existingLinksOnSourcePage: pageData.existingLinkCount,
          existingAnchorTextForTarget: null,
          requiresNewSentence: true,
          suggestedNewSentence: found.suggestedNewSentence || null,
        });
      } else {
        anchorResultsById.set(rec.id, {
          anchorTextSource: 'existing-content',
          recommendedAnchorText: best.anchorText,
          anchorTextCandidates: candidates,
          existingLinksOnSourcePage: pageData.existingLinkCount,
          existingAnchorTextForTarget: null,
          requiresNewSentence: false,
          suggestedNewSentence: null,
        });
      }
    }

    sourcesProcessed++;
    if (onProgress) onProgress({ sourcesProcessed, sourcesTotal, currentSourceUrl: sourceUrl });
  }

  // Bounded concurrency
  await new Promise((resolve) => {
    let active = 0;
    let idx = 0;
    function next() {
      while (active < CONCURRENT_FETCHES && idx < sourceUrls.length) {
        active++;
        const url = sourceUrls[idx++];
        processSource(url).finally(() => {
          active--;
          if (idx < sourceUrls.length) next();
          else if (active === 0) resolve();
        });
      }
    }
    if (sourceUrls.length === 0) { resolve(); return; }
    next();
  });

  // Apply anchor results to recs
  const enriched = recs.map(rec => {
    const anchor = anchorResultsById.get(rec.id);
    if (!anchor) return rec;
    return { ...rec, ...anchor };
  });

  // Run validation pass
  return enriched.map(rec => {
    const anchorText = rec.editedAnchorText || rec.recommendedAnchorText;
    const baseWarnings = rec.anchorTextSource === 'page-unavailable' ? ['page-unavailable'] : [];
    const valWarnings = anchorText ? validateAnchorText(anchorText, rec, enriched) : [];
    const densityWarn = (rec.existingLinksOnSourcePage || 0) >= 5 ? ['high-link-density'] : [];
    return { ...rec, anchorWarnings: [...baseWarnings, ...valWarnings, ...densityWarn] };
  });
}

module.exports = { enrichWithAnchorText, validateAnchorText, fetchSourcePage, anchorSharesTermWithTarget };
