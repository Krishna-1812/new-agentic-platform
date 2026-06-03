// ── Model-aware chat params (Spec §14 resilience) ───────────────────────────
// Newer OpenAI model families (gpt-5.x, o-series) renamed `max_tokens` to
// `max_completion_tokens` and only accept the default temperature (1). Older
// models (gpt-4o, gpt-4o-mini) use `max_tokens` and accept any temperature.
// This keeps the module working across both without per-call branching.

function isNewFamily(model) {
  return /^(gpt-5|o\d)/i.test(String(model || ''));
}

// Build the extra params for chat.completions.create for a given model.
// opts: { maxTokens?, temperature? }
function chatParams(model, { maxTokens, temperature } = {}) {
  const params = {};
  if (maxTokens != null) {
    if (isNewFamily(model)) params.max_completion_tokens = maxTokens;
    else params.max_tokens = maxTokens;
  }
  // Only send a non-default temperature to models that support it.
  if (temperature != null && !isNewFamily(model)) {
    params.temperature = temperature;
  }
  return params;
}

module.exports = { chatParams, isNewFamily };
