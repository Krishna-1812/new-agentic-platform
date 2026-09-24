// ── Shared OpenAI client (V2 Phase 3) ─────────────────────────────────────────
// One place to instantiate the SDK + gate on the key, reused by basketAgent (basket
// proposal) and the /summary endpoint (executive summary). Both features have a
// deterministic fallback, so a missing key is never fatal.

const OpenAI = require('openai');

function hasOpenAI() {
  const k = process.env.OPENAI_API_KEY;
  return !!k && k !== 'your_openai_api_key_here';
}

let _client = null;
function client() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

// Chat completion → message string. opts: { model, maxTokens, temperature, json }.
async function chat(messages, { model = 'gpt-4o-mini', maxTokens = 800, temperature = 0.3, json = false } = {}) {
  const completion = await client().chat.completions.create({
    model,
    max_tokens: maxTokens,
    temperature,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
    messages,
  });
  return completion.choices[0]?.message?.content || '';
}

module.exports = { hasOpenAI, chat, client };
