const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const OpenAI = require('openai');
const { searchGoogle } = require('../services/googleSearch');
const { getUrlKeywords } = require('../services/semrush');
const { loadKBContext } = require('../services/kbLoader');

// In-memory session store (token → params, expires in 2 min)
const sessions = new Map();

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

// Step 1: Client POSTs keyword + optional client slug, gets back a token
router.post('/init', (req, res) => {
  const { keyword, client, feedbackKbIds } = req.body;
  if (!keyword?.trim()) return res.status(400).json({ error: 'keyword is required' });
  if (!process.env.SEMRUSH_API_KEY) return res.status(500).json({ error: 'SEMrush API key not configured on server.' });

  const token = generateToken();
  sessions.set(token, { keyword: keyword.trim(), client: client || null, feedbackKbIds: feedbackKbIds || null });
  setTimeout(() => sessions.delete(token), 120000); // TTL for unconsumed tokens
  res.json({ token });
});

// Step 2: Client opens SSE stream with token
router.get('/stream/:token', async (req, res) => {
  const session = sessions.get(req.params.token);
  if (!session) return res.status(404).json({ error: 'Session not found or expired. Please try again.' });
  sessions.delete(req.params.token);

  const { keyword, client, feedbackKbIds } = session;
  const semrushKey = process.env.SEMRUSH_API_KEY;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let isClosed = false;
  res.on('close', () => { isClosed = true; });

  const emit = (event, data) => {
    if (isClosed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (e) { isClosed = true; }
  };

  try {
    // ── Step 1: Google Search ────────────────────────────────────────────
    emit('step', { id: 'search', status: 'active', message: `Searching Google for "${keyword}"…` });

    const searchData = await searchGoogle(keyword);
    const top3 = searchData.results.slice(0, 10);

    emit('step', { id: 'search', status: 'done', message: `Found top ${top3.length} ranking pages` });

    emit('urls', { urls: top3 });

    // ── Step 2: SEMrush per URL (parallel, max 3 concurrent) ────────────
    emit('step', { id: 'semrush', status: 'active', message: 'Fetching keyword rankings from SEMrush…' });

    const CONCURRENCY = 3;
    const allKeywords = [];

    for (let i = 0; i < top3.length; i += CONCURRENCY) {
      if (isClosed) break;
      const batch = top3.slice(i, i + CONCURRENCY);
      batch.forEach(urlObj => emit('url_status', { url: urlObj.url, title: urlObj.title, status: 'loading' }));

      const batchResults = await Promise.all(batch.map(async urlObj => {
        try {
          const keywords = await getUrlKeywords(urlObj.url, semrushKey, 30);
          emit('url_keywords', { url: urlObj.url, title: urlObj.title, keywords, status: 'done' });
          return keywords;
        } catch (err) {
          if (err.message.includes('Invalid SEMrush')) throw err;
          emit('url_keywords', { url: urlObj.url, title: urlObj.title, keywords: [], status: 'error', error: err.message });
          return [];
        }
      }));

      allKeywords.push(...batchResults.flat());
    }

    const successCount = allKeywords.length;
    emit('step', { id: 'semrush', status: 'done', message: `Collected ${successCount} keyword${successCount !== 1 ? 's' : ''} across all pages` });

    if (successCount === 0) {
      throw new Error('No keyword data returned from SEMrush. These pages may not have enough ranking history, or the API key may be incorrect.');
    }

    // ── Step 3: AI Analysis ──────────────────────────────────────────────
    emit('step', { id: 'analysis', status: 'active', message: 'AI is filtering and shortlisting the best keywords…' });

    // Load KB context if client provided
    const kbContext = client ? await loadKBContext('keyword-research', client, feedbackKbIds || null) : null;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Deduplicate by keyword string
    const unique = [...new Map(allKeywords.map(k => [k.keyword.toLowerCase(), k])).values()];

    // Emit full deduplicated pool so the frontend can show "view all source keywords"
    emit('allKeywords', { keywords: unique });

    const keywordList = unique.slice(0, 60).map(k =>
      `- ${k.keyword} | volume: ${k.volume || 'N/A'} | difficulty: ${k.difficulty || 'N/A'} | position: ${k.position || 'N/A'}`
    ).join('\n');

    const kbSystemPrompt = 'You are an expert SEO strategist. Always respond with valid JSON only.'
      + (kbContext?.systemPromptSuffix || '');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: kbSystemPrompt
        },
        {
          role: 'user',
          content: `Seed keyword: "${keyword}"

${kbContext ? 'Brand context is available in your system prompt — use it as a low-priority secondary signal to prefer keywords that fit the brand\'s vertical, audience, and positioning, but do not let it override the core selection rules below.' : ''}

Competitor keywords from top ranking pages (via SEMrush):
${keywordList}

---

PRIMARY SELECTION RULES (EXACTLY 2)

Each primary keyword must satisfy ALL of the following simultaneously:

1. Semantic core match — Directly targets the same core topic and intent as the seed keyword. Not a tangential subtopic or loose association.
2. Intent alignment — Matches the commercial or informational intent appropriate for the stated content goal. For service/product pages: transactional or commercial intent only. For blog/informational: clear informational intent with strong demand signal.
3. Mutual distinctiveness — Both primaries must differ meaningfully from each other. Different modifier angle, different intent signal, or different funnel position. Near-duplicates are not permitted.

Each primary keyword must include a one-sentence reason that specifically justifies its selection against these criteria.

---

SECONDARY SELECTION RULES (EXACTLY 10)

Select exactly 10 keywords that collectively:
- Are complementary, supporting, or long-tail extensions of the seed keyword
- Are viable for: supporting FAQs or sections on the same page, OR as separate blog/content pieces within the same topical cluster

---

HARD REJECTION CRITERIA

Discard any keyword that meets one or more of the following — regardless of volume:
- Branded or competitor-branded terms (unless the seed keyword itself is branded)
- Navigational queries (user clearly looking for a specific website or brand)
- Intent mismatch — superficial keyword overlap with the seed but clearly different user need
- Near-duplicate of an already-selected keyword (trivial pluralisation, word reorder, minor variation)
- Implausibly low search demand with no realistic audience at scale
- Excessively broad head terms with no realistic ranking pathway (volume traps)
- Out-of-vertical terms — keyword touches the industry loosely but does not serve the stated business or audience

---

Return this exact JSON:
{
  "primary": [
    {"keyword": "...", "volume": 0, "difficulty": 0, "reason": "one sentence justifying selection against the primary criteria above"}
  ],
  "secondary": [
    {"keyword": "...", "volume": 0, "difficulty": 0}
  ]
}

Use the actual volume and difficulty numbers from the input list. If data is missing, use 0.`
        }
      ]
    });

    const result = JSON.parse(completion.choices[0].message.content);
    emit('step', { id: 'analysis', status: 'done', message: 'Keyword shortlist ready' });
    emit('result', result);

  } catch (err) {
    console.error('[keyword-research] Error:', err.message);
    emit('fail', { message: err.message });
  }

  emit('done', {});
  res.end();
});

module.exports = router;
