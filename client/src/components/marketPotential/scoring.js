// ── Client-side decision scoring (V2 Phase 1) ─────────────────────────────────
// The server sends per-row normalized `components` (demand / competition / trend /
// cost, each 0–1). We combine them into a single 0–100 Opportunity Score HERE so
// weight changes reorder the board instantly with no refetch (spec §2.2).

export const WEIGHT_KEYS = ['demand', 'competition', 'trend', 'cost'];

export const COMPONENT_LABELS = {
  demand: 'Demand',
  competition: 'Openness',
  trend: 'Growth',
  cost: 'Affordability',
};

export const COMPONENT_HELP = {
  demand: 'Per-capita, city-tagged search demand (home = 100).',
  competition: 'How open the market is — fewer ranking domains scores higher.',
  trend: '12-month growth in city-tagged search volume.',
  cost: 'Cheaper clicks score higher. High CPC also signals commercial value, so this axis is deliberately low-weighted.',
};

// Presets (spec §2.2). Each set of weights sums to 1.
export const WEIGHT_PRESETS = {
  balanced:      { label: 'Balanced',       hint: 'Even view of demand, competition, growth and cost.', weights: { demand: 0.45, competition: 0.25, trend: 0.20, cost: 0.10 } },
  landGrab:      { label: 'Land Grab',      hint: 'Growth first — chase demand and momentum.',          weights: { demand: 0.60, competition: 0.15, trend: 0.20, cost: 0.05 } },
  lowResistance: { label: 'Low Resistance', hint: 'Avoid crowded markets — favor open, cheap entry.',    weights: { demand: 0.30, competition: 0.45, trend: 0.10, cost: 0.15 } },
};

export const BALANCED_WEIGHTS = WEIGHT_PRESETS.balanced.weights;

// Combine components → 0–100. Weights are renormalized over the components that are
// actually present (non-null), so a row with density disabled still scores on the
// axes it does have.
export function computeScore(components, weights) {
  if (!components) return null;
  let wsum = 0, acc = 0, any = false;
  for (const k of WEIGHT_KEYS) {
    const c = components[k];
    if (c == null || weights[k] == null) continue;
    any = true;
    wsum += weights[k];
    acc += weights[k] * c;
  }
  if (!any || wsum === 0) return null;
  return Math.round((acc / wsum) * 100);
}

// Match a weights object to a named preset (for highlighting the active chip).
export function matchPreset(weights) {
  for (const [key, p] of Object.entries(WEIGHT_PRESETS)) {
    if (WEIGHT_KEYS.every((k) => Math.abs((weights[k] ?? 0) - p.weights[k]) < 0.005)) return key;
  }
  return null;
}

// Renormalize a weights object so it sums to 1 (called after a slider moves).
export function normalizeWeights(weights) {
  const sum = WEIGHT_KEYS.reduce((a, k) => a + (weights[k] || 0), 0);
  if (sum === 0) return { ...BALANCED_WEIGHTS };
  const out = {};
  for (const k of WEIGHT_KEYS) out[k] = (weights[k] || 0) / sum;
  return out;
}

// ── Tiers (spec §2.3) — non-home rows only ────────────────────────────────────
const CONF_RANK = { insufficient: 0, low: 1, medium: 2, high: 3 };

export function tierOf(score, confidence) {
  const c = CONF_RANK[confidence] ?? 0;
  if (score == null || confidence === 'insufficient') return 'insufficient';
  if (score >= 70 && c >= CONF_RANK.medium) return 'prioritize';
  if (score >= 55 && c >= CONF_RANK.medium) return 'strong';
  if (score >= 35 && c >= CONF_RANK.low) return 'monitor';
  if (score < 35) return 'deprioritize';
  // 35–69 but confidence below the tier's floor → Monitor if we at least have Low,
  // otherwise the data is too thin to rank.
  return c >= CONF_RANK.low ? 'monitor' : 'insufficient';
}

// Label + color chip per tier. Text label ALWAYS present (never color alone, §6.3).
export const TIER_META = {
  prioritize:   { label: 'Prioritize',        color: '#0B7A4B', bg: 'var(--success-soft)' },
  strong:       { label: 'Strong',            color: '#0E9384', bg: 'rgba(0,179,164,0.14)' },
  monitor:      { label: 'Monitor',           color: 'var(--warning)', bg: 'var(--warning-soft)' },
  deprioritize: { label: 'Deprioritize',      color: 'var(--text-3)', bg: 'var(--surface)' },
  insufficient: { label: 'Insufficient Data', color: 'var(--text-3)', bg: 'var(--surface)', dashed: true },
};

export const CONFIDENCE_META = {
  high:         { label: 'High',         color: 'var(--success)', bg: 'var(--success-soft)' },
  medium:       { label: 'Medium',       color: 'var(--warning)', bg: 'var(--warning-soft)' },
  low:          { label: 'Low',          color: 'var(--info)',    bg: 'var(--info-soft)' },
  insufficient: { label: 'Insufficient', color: 'var(--text-3)',  bg: 'var(--surface)' },
};

// Attach opportunityScore + tier to each row for the current weights. Home rows get
// a score (for context) but tier stays null — home is never tiered (spec §2.1/2.3).
export function scoreRows(rows, weights) {
  return (rows || []).map((r) => {
    const opportunityScore = computeScore(r.components, weights);
    return { ...r, opportunityScore, tier: r.isHome ? null : tierOf(opportunityScore, r.confidence) };
  });
}
