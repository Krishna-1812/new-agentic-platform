// ── Phase B: GPT-driven classification of folder templates ──────────────────
// One GPT-5.4-mini call classifies every distinct folder pattern for the whole
// run (all domains, both parts). Cost scales with distinct patterns (~dozens),
// not URL count (~thousands). Indices are used in the response instead of
// echoing each template back, to keep output tokens minimal.
const { CONTENT_TYPES, TYPE_HINTS, isValidType } = require('./taxonomy');

const HINT_BLOCK = CONTENT_TYPES.map((t) => `- ${t}: ${TYPE_HINTS[t]}`).join('\n');

// templates: [{ template, example, count }]
// Returns: Map<template, type> for every template GPT validly classified;
// callers default anything missing to 'other'.
async function classifyTemplates(writerClient, templates) {
  if (!templates.length) return new Map();

  const lines = templates
    .map((t, i) => `${i}. ${t.template}  (e.g. ${t.example || 'n/a'}; ${t.count} pages)`)
    .join('\n');

  const res = await writerClient.chat.completions.create({
    model: writerClient.model,
    response_format: { type: 'json_object' },
    max_completion_tokens: Math.min(4000, 200 + templates.length * 12),
    messages: [
      {
        role: 'system',
        content:
          'You are a web information architect. You are given URL FOLDER PATTERNS from one or more sites, where "*" is a variable slug (an individual page). Classify each pattern into exactly ONE page type from this list:\n' +
          HINT_BLOCK +
          '\n\nJudge by the folder structure and the example URL. Respond with ONLY compact JSON, no prose.',
      },
      {
        role: 'user',
        content:
          `Patterns:\n${lines}\n\n` +
          'Return JSON of the form {"m":[{"i":<pattern number>,"c":"<type>"}]}, one entry per pattern, using the exact type strings from the list.',
      },
    ],
  });

  const out = new Map();
  try {
    const parsed = JSON.parse(res.choices[0].message.content || '{}');
    for (const item of parsed.m || []) {
      const idx = Number(item.i);
      const type = item.c;
      if (Number.isInteger(idx) && templates[idx] && isValidType(type)) {
        out.set(templates[idx].template, type);
      }
    }
  } catch {
    // Malformed JSON — return whatever parsed; unmapped templates become
    // 'other' downstream. A single bad response never fails the run.
  }
  return out;
}

module.exports = { classifyTemplates };
