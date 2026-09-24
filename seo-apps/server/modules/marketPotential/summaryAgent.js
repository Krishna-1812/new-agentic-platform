// ── Executive summary (V2 Phase 3) ────────────────────────────────────────────
// Grounded, cached natural-language verdict for the Decision Board. Uses OpenAI
// when a key is set, otherwise a DETERMINISTIC template built from the same fields
// so the feature is never key-dependent. The model is instructed to use ONLY the
// numbers passed in — it never sees the web and cannot invent facts.

const { hasOpenAI, chat } = require('./openaiClient');

const pct = (x) => (x == null ? 'n/a' : `${x > 0 ? '+' : ''}${x}%`);

// Deterministic fallback — same structure the LLM is asked for (verdict → top 2 →
// risk → next step), assembled from the row fields.
function fallbackSummary(service, homeName, rows) {
  const nonHome = (rows || []).filter((r) => !r.isHome && r.opportunityScore != null).sort((a, b) => b.opportunityScore - a.opportunityScore);
  if (!nonHome.length) {
    return `No comparable expansion market stood out for ${service} in this run — every candidate trailed ${homeName} on the weighted Opportunity Score. Widen the region set or broaden the service definition, then re-run.`;
  }
  const top = nonHome.slice(0, 2);
  const reason = (r) => {
    const bits = [];
    if (r.demandIndex != null) bits.push(`${(r.demandIndex / 100).toFixed(1)}× ${homeName}'s per-capita demand`);
    if (r.competitorBreakdown) bits.push(`${r.competitorBreakdown.providers} provider${r.competitorBreakdown.providers === 1 ? '' : 's'} in the top 10`);
    if (r.yoyPct != null) bits.push(`${pct(r.yoyPct)} YoY`);
    let s = `${r.region} (score ${r.opportunityScore}, ${r.tier}) — ${bits.join(', ')}`;
    if (r.competitorBreakdown?.youRankHere) s += '; you already rank here';
    return `${s}.`;
  };
  const verdict = `${top[0].region} is the strongest ${service} expansion opportunity in this set.`;
  const weak = (rows || []).filter((r) => !r.isHome && (r.confidence === 'low' || r.confidence === 'insufficient'));
  const risk = weak.length
    ? `Risk: ${weak.length} of the compared markets returned thin data (low or insufficient confidence), so treat their indexes as directional only.`
    : 'Risk: these are city-tagged relative indexes, not total market size — read them comparatively, not as forecasts.';
  const next = `Next step: open ${top[0].region} to review its named competitors and directional revenue floor before committing budget.`;
  return `${verdict} ${top.map(reason).join(' ')} ${risk} ${next}`;
}

async function generateSummary({ service, homeName, rows, weightsUsed }) {
  const clean = (rows || []).filter(Boolean);
  if (!hasOpenAI()) return { summary: fallbackSummary(service, homeName, clean), source: 'template' };

  try {
    const lines = clean.map((r) => {
      const cb = r.competitorBreakdown;
      return `${r.isHome ? '[HOME] ' : ''}${r.region}: score=${r.opportunityScore ?? 'n/a'}, tier=${r.tier ?? 'n/a'}, demandIndex=${r.demandIndex ?? 'n/a'}, searches/mo=${r.estMonthlySearches ?? 'n/a'}, competitors=${r.competitorDensity ?? 'n/a'}${cb ? ` (${cb.providers} providers/${cb.directories} directories${cb.youRankHere ? ', you rank here' : ''})` : ''}, yoy=${r.yoyPct == null ? 'n/a' : r.yoyPct + '%'}, confidence=${r.confidence ?? 'n/a'}`;
    }).join('\n');
    const w = weightsUsed ? Object.entries(weightsUsed).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ') : 'default';
    const anyWeak = clean.some((r) => !r.isHome && (r.confidence === 'low' || r.confidence === 'insufficient'));

    const user = `Service: ${service}
Home market: ${homeName}
Score weights used: ${w}

Markets (one per line; HOME is the baseline — never recommend it):
${lines}

Write an executive summary of AT MOST 180 words, plain prose (no markdown headings, no bullet symbols), with EXACTLY this structure:
1) One verdict sentence naming the single best expansion market.
2) The top two markets with their specific reasons, citing the numbers above.
3) One named risk or caveat.${anyWeak ? ' At least one market has low/insufficient confidence — you MUST state the data is sparse for those.' : ''}
4) One concrete next step.
Use ONLY the numbers provided. Never invent population, revenue, or competitor names.`;

    const out = await chat([
      { role: 'system', content: 'You are a concise market-analysis assistant writing for a busy healthcare executive. Use only the data provided; never invent facts.' },
      { role: 'user', content: user },
    ], { maxTokens: 400, temperature: 0.3 });

    const text = (out || '').trim();
    if (!text) return { summary: fallbackSummary(service, homeName, clean), source: 'template' };
    return { summary: text, source: 'openai' };
  } catch (err) {
    console.warn(`[market-potential] summary LLM failed (${err.message}) — using template`);
    return { summary: fallbackSummary(service, homeName, clean), source: 'template' };
  }
}

module.exports = { generateSummary, fallbackSummary };
