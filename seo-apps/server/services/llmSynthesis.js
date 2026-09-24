// ── llmSynthesis ─────────────────────────────────────────────────────────────
// When a user selects more than one analysis/recommendation model, each stage
// runs once per selected model and the independent results are merged here —
// on the fixed writer client, so merge cost stays flat regardless of how many
// models were queried. Callers skip these entirely when only one model ran.

async function synthesizeSubtopics(writerClient, perModelResults) {
  const listing = perModelResults
    .map(({ model, subtopics }) => `Reviewer (${model}):\n${(subtopics || []).map(s => `- ${s.topic} [${s.covered ? 'covered' : 'gap'}]`).join('\n')}`)
    .join('\n\n');

  const res = await writerClient.chat.completions.create({
    model: writerClient.model,
    response_format: { type: 'json_object' },
    max_completion_tokens: 1800,
    messages: [
      { role: 'system', content: 'You merge topic-coverage analyses of the SAME article from multiple independent reviewers into one deduplicated, authoritative list. Respond with valid JSON only.' },
      {
        role: 'user',
        content: `${listing}

Merge these into ONE list of distinct subtopics. Rules:
- Merge near-duplicate topics from different reviewers into a single entry (keep the clearest phrasing).
- Mark "covered": true only if a majority of the reviewers who listed it (or an equivalent topic) marked it covered.
- 8-14 subtopics total.
- "topic" is a LABEL only — no statistics, sources, or factual claims.

Return JSON: { "subtopics": [ { "topic": "short subtopic or question label, 3-9 words", "covered": true|false } ] }`,
      },
    ],
  });
  const parsed = JSON.parse(res.choices[0].message.content || '{}');
  const subtopics = Array.isArray(parsed.subtopics)
    ? parsed.subtopics
        .filter(s => s && typeof s.topic === 'string' && s.topic.trim())
        .map(s => ({ topic: s.topic.trim(), covered: !!s.covered }))
    : [];
  return { subtopics };
}

async function synthesizeRecommendations(writerClient, perModelDocs) {
  const listing = perModelDocs.map(({ model, text }) => `── Draft from ${model} ──\n${text}`).join('\n\n');

  const res = await writerClient.chat.completions.create({
    model: writerClient.model,
    max_completion_tokens: 3400,
    messages: [
      {
        role: 'system',
        content: 'You are an expert content strategist. You merge multiple independent drafts of the same enhancement-recommendations document (written by different reviewers for the same article) into one unified, non-redundant, well-organized document. Preserve every distinct, valuable recommendation; merge overlapping ones; drop exact duplicates. Do not simply concatenate the drafts, and do not mention the reviewers or the merging process in your output.',
      },
      { role: 'user', content: `${listing}\n\nProduce ONE merged recommendations document in the same style and structure as the drafts above.` },
    ],
  });
  return res.choices[0].message.content || perModelDocs[0]?.text || '';
}

module.exports = { synthesizeSubtopics, synthesizeRecommendations };
