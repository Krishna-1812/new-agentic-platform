const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const OpenAI = require('openai');
const { searchGoogle } = require('../services/googleSearch');
const { getUrlKeywords } = require('../services/semrush');

// In-memory session store (token → params, expires in 2 min)
const sessions = new Map();

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

// Step 1: Client POSTs keyword + semrushKey, gets back a token
router.post('/init', (req, res) => {
  const { keyword, semrushKey } = req.body;
  if (!keyword?.trim()) return res.status(400).json({ error: 'keyword is required' });
  if (!semrushKey?.trim()) return res.status(400).json({ error: 'SEMrush API key is required' });

  const token = generateToken();
  sessions.set(token, { keyword: keyword.trim(), semrushKey: semrushKey.trim() });
  setTimeout(() => sessions.delete(token), 120000);
  res.json({ token });
});

// Step 2: Client opens SSE stream with token
router.get('/stream/:token', async (req, res) => {
  const session = sessions.get(req.params.token);
  if (!session) return res.status(404).json({ error: 'Session not found or expired. Please try again.' });
  sessions.delete(req.params.token);

  const { keyword, semrushKey } = session;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const emit = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (e) { /* client disconnected */ }
  };

  try {
    // ── Step 1: Google Search ────────────────────────────────────────────
    emit('step', { id: 'search', status: 'active', message: `Searching Google for "${keyword}"…` });

    const searchData = await searchGoogle(keyword);
    const top3 = searchData.results.slice(0, 3);

    emit('step', { id: 'search', status: 'done', message: `Found top ${top3.length} ranking pages` });
    emit('urls', { urls: top3 });

    // ── Step 2: SEMrush per URL ──────────────────────────────────────────
    emit('step', { id: 'semrush', status: 'active', message: 'Fetching keyword rankings from SEMrush…' });

    const allKeywords = [];

    for (const urlObj of top3) {
      emit('url_status', { url: urlObj.url, title: urlObj.title, status: 'loading' });
      try {
        const keywords = await getUrlKeywords(urlObj.url, semrushKey, 10);
        allKeywords.push(...keywords);
        emit('url_keywords', { url: urlObj.url, title: urlObj.title, keywords, status: 'done' });
      } catch (err) {
        // Surface invalid key error immediately
        if (err.message.includes('Invalid SEMrush')) {
          throw err;
        }
        emit('url_keywords', { url: urlObj.url, title: urlObj.title, keywords: [], status: 'error', error: err.message });
      }
    }

    const successCount = allKeywords.length;
    emit('step', { id: 'semrush', status: 'done', message: `Collected ${successCount} keyword${successCount !== 1 ? 's' : ''} across all pages` });

    if (successCount === 0) {
      throw new Error('No keyword data returned from SEMrush. These pages may not have enough ranking history, or the API key may be incorrect.');
    }

    // ── Step 3: AI Analysis ──────────────────────────────────────────────
    emit('step', { id: 'analysis', status: 'active', message: 'AI is filtering and shortlisting the best keywords…' });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Deduplicate by keyword string
    const unique = [...new Map(allKeywords.map(k => [k.keyword.toLowerCase(), k])).values()];

    const keywordList = unique.slice(0, 60).map(k =>
      `- ${k.keyword} | volume: ${k.volume || 'N/A'} | difficulty: ${k.difficulty || 'N/A'} | position: ${k.position || 'N/A'}`
    ).join('\n');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are an expert SEO strategist. Always respond with valid JSON only.'
        },
        {
          role: 'user',
          content: `Seed keyword: "${keyword}"

Competitor keywords pulled from top 3 ranking pages via SEMrush:
${keywordList}

Task: Select the best keywords for an SEO campaign targeting "${keyword}".

Return this exact JSON:
{
  "primary": [
    {"keyword": "...", "volume": 0, "difficulty": 0, "reason": "one sentence explaining why this is a strong primary keyword"}
  ],
  "secondary": [
    {"keyword": "...", "volume": 0, "difficulty": 0}
  ]
}

Rules:
- primary: exactly 2 keywords — most relevant to the seed, good search volume, achievable difficulty
- secondary: exactly 10 keywords — supporting, complementary, or long-tail variations
- Use the actual volume and difficulty numbers from the list above
- If data is missing, use 0`
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
