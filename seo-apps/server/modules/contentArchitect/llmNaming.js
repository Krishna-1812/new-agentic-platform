// ── Stage 5e: LLM naming (the only clustering LLM call) ──────────────────────
// Deterministic signals already did the grouping (Stage 5a-5d) — this ONLY
// names/describes clusters and suggests a hub candidate. The pipeline must
// complete successfully even if every LLM call fails, so every cluster gets
// a mechanical fallback name regardless of what the model returns.
const OpenAI = require('openai');
const { topTermsForCluster, mechanicalName, titleCase } = require('./clusterEngine');
const { deriveBrandTokens } = require('./termProfile');

const LLM_NAMING_TERM_COUNT = 15;
const H2_SAMPLE_COUNT = 5;
const BATCH_SIZE = 15;
const MAX_RETRIES = 2;
const MODEL = 'gpt-4o-mini';

const SYSTEM_PROMPT = `You are an SEO content architect. You will receive groups of web pages that have
already been clustered by topical similarity. Your job is ONLY to name and describe
each group, and to recommend which page should serve as the hub.

A hub page is a broad, authoritative overview page on a major topic. Spoke pages are
supporting articles that explore specific subtopics within that hub's theme.

Rules:
- Do NOT move pages between groups. Do NOT invent pages. Do NOT omit pages.
- Cluster names must be 2-5 words, human readable, and specific to the topic. Never
  use the brand name. Never use generic names like "Blog Posts" or "General Content".
- The description must be one sentence stating what the cluster covers.
- For hubRecommendation, return the URL of the page best suited as hub, or null if no
  page in the group is broad enough to serve as a hub.
- Return valid JSON only. No markdown fences, no preamble.`;

const GENERIC_NAME_BLOCKLIST = new Set(['blog posts', 'general content', 'articles', 'miscellaneous', 'other', 'uncategorized']);

function hasOpenAiKey() {
  const k = process.env.OPENAI_API_KEY;
  return !!k && k !== 'your_openai_api_key_here';
}

let _client = null;
function client() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

function buildBatchPayload(clusters, pages, profiles, idf) {
  return clusters.map((c) => ({
    id: c.id,
    pages: c.memberIndices.map((i) => ({
      url: pages[i].url,
      title: pages[i].title || '(no title — not crawled)',
      h2s: (pages[i].h2s || []).slice(0, H2_SAMPLE_COUNT),
    })),
    topTerms: topTermsForCluster(c.memberIndices, profiles, idf, LLM_NAMING_TERM_COUNT),
  }));
}

// The system prompt (used verbatim, per spec) covers behavior/rules but not
// response shape — without this, the model returns valid JSON that silently
// drops the "id" field entirely (confirmed empirically), which breaks the
// id-based validation this whole function depends on to know which output
// belongs to which input cluster.
const RESPONSE_FORMAT_INSTRUCTION = 'Respond with JSON of the exact shape '
  + '{"clusters":[{"id": "<same id as input>", "name": "...", "description": "...", "hubRecommendation": "<url or null>"}]}. '
  + 'Echo back the same "id" value for each cluster you were given — do not omit it, invent one, or change it.';

async function callBatch(payload) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const completion = await client().chat.completions.create({
        model: MODEL,
        temperature: 0.3,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `${RESPONSE_FORMAT_INSTRUCTION}\n\n${JSON.stringify({ clusters: payload })}` },
        ],
      });
      const raw = completion.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.clusters)) throw new Error('response missing "clusters" array');
      return parsed.clusters;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function isValidName(name, brandTokens) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 80) return false;
  if (GENERIC_NAME_BLOCKLIST.has(trimmed.toLowerCase())) return false;
  const words = trimmed.toLowerCase().split(/\s+/);
  if (words.some((w) => brandTokens.has(w))) return false; // "Never use the brand name"
  return true;
}

// Names every cluster, chunked into batches, with full deterministic
// validation and mechanical fallback per spec: strip any hub URL not
// actually in that cluster, require every sent cluster ID to come back
// (fall back to mechanical name otherwise), never trust the model's
// hubRecommendation as more than a suggestion (Stage 6 scores it itself).
async function nameClusters(clusters, pages, profiles, idf, domain) {
  const results = new Map(); // cluster id -> { name, description, llmHubRecommendation, source }
  const brandTokens = deriveBrandTokens(domain);

  for (const c of clusters) {
    results.set(c.id, {
      name: mechanicalName(c.memberIndices, profiles, idf),
      description: null,
      llmHubRecommendation: null,
      source: 'mechanical',
    });
  }

  if (!hasOpenAiKey()) return results; // no key configured — mechanical names stand, pipeline still completes

  for (let i = 0; i < clusters.length; i += BATCH_SIZE) {
    const batch = clusters.slice(i, i + BATCH_SIZE);
    const payload = buildBatchPayload(batch, pages, profiles, idf);
    const validUrlsByCluster = new Map(batch.map((c) => [c.id, new Set(c.memberIndices.map((idx) => pages[idx].url))]));

    let responses;
    try {
      responses = await callBatch(payload);
    } catch (err) {
      console.error('[content-architect] LLM naming batch failed, using mechanical fallback for this batch:', err.message);
      continue; // this batch's clusters keep their mechanical-name defaults
    }

    for (const entry of responses) {
      const current = results.get(entry.id);
      if (!current || !validUrlsByCluster.has(entry.id)) continue; // model invented an id — ignore

      const validName = isValidName(entry.name, brandTokens);
      const hubUrl = entry.hubRecommendation && validUrlsByCluster.get(entry.id).has(entry.hubRecommendation)
        ? entry.hubRecommendation
        : null;

      results.set(entry.id, {
        name: validName ? entry.name.trim() : current.name,
        description: typeof entry.description === 'string' && entry.description.trim() ? entry.description.trim() : null,
        llmHubRecommendation: hubUrl,
        source: validName ? 'llm' : 'mechanical',
      });
    }
  }

  return results;
}

module.exports = { nameClusters, isValidName, SYSTEM_PROMPT };
