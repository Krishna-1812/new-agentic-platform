// ── Content Generation, Stage 7 (Spec §7) — Layer-aware ─────────────────────
// Generates L3 ONLY (page_data copy), then compose.mergeL3 stitches it onto the
// L1+L2 scaffold. Scraped competitor copy is used for MODELING coverage/structure
// only — never to copy NAP, images, providers or reviews (Spec §7.1, §15.4).

const OpenAI = require('openai');
const config = require('./config');
const text = require('./text');
const { chatParams } = require('./llmParams');

const L3_SCHEMA_HINT = `{
  "meta_title": "<=60 chars, includes service + location + brand",
  "meta_description": "150-160 chars, includes service + location",
  "og_title": "string", "og_description": "string",
  "h1": "[Adjective] [Service] in [Location] — natural, not stuffed, includes service + location",
  "hero_intro": "2-3 sentences, mentions the location",
  "approach_intro": "1-2 sentences introducing 'Our approach to [service]'",
  "care_pillars": [
    { "copy": "2-3 sentences for H3 'Our philosophy of compassionate care'" },
    { "copy": "2-3 sentences for H3 'Clinical therapies offered'" }
  ],
  "competitor_section": [
    {
      "h2": "An H2 modelled on what top competitors cover for this service",
      "h3s": [
        { "heading": "H3 subtopic", "copy": "2-4 sentences of unique copy" }
      ]
    }
  ],
  "faqs": [ { "question": "string", "answer": "2-4 sentence answer", "faq_type": "location|service|insurance|virtual|provider|appointment" } ]
}`;

function buildPrompt({ pageObject, layers, keywords, modelCopy }) {
  const { service, location, client, tone } = layers;
  const pd = pageObject.page_data;
  const ld = pageObject.location_data;

  const prohibited = (client.brand_rules?.prohibited_claims || []).join(', ');
  const ymyl = client.brand_rules?.ymyl;
  const primaryKws = (keywords.primary || []).map(k => k.keyword).join(', ');
  const secondaryKws = (keywords.secondary || []).map(k => k.keyword).join(', ');
  const faqKws = (keywords.faq || []).join(', ');

  const toneBlock = tone ? `Brand voice: ${tone.voice}\nReading level: ${tone.reading_level}\nCTA phrasing: ${(tone.cta_phrasing || []).join(' / ')}\nFormatting: ${tone.formatting_habits}` : 'Brand voice: warm, professional, clear.';

  const competitorHeadings = [...new Set((modelCopy || []).flatMap(m => m.headings || []))].slice(0, 25);

  const structureRules = `REQUIRED PAGE STRUCTURE (produce content in this exact order):
1. meta_title, meta_description, h1, hero_intro
2. "Our approach to ${service.name}" (approach_intro) with EXACTLY these two H3 pillars, in order:
   - "Our philosophy of compassionate care"
   - "Clinical therapies offered"
3. competitor_section: a body modelled on top competitors. MINIMUM 1 H2 with 3 H3s; RECOMMENDED 2 H2 blocks with 5 H3s total. Each H3 has unique copy.
4. faqs: 7 to 11 questions with answers, tagged by faq_type.`;

  const localFacts = `LOCAL FACTS (use ONLY these — do not invent NAP/providers):
- City/State: ${ld.city}, ${ld.state}
- Nearby areas: ${(ld.nearby_areas || []).join(', ')}
- Parking/access: ${ld.parking_info || 'n/a'}
- Providers at this location: ${(ld.providers || []).map(p => `${p.name} (${p.credentials})`).join('; ') || 'none listed'}
- Available: ${pageObject.service_data.available_in_person ? 'in-person' : ''}${pageObject.service_data.available_virtual ? ', virtual/online' : ''}${pageObject.service_data.teen_available ? ', teens' : ''}`;

  const modelBlock = competitorHeadings.length
    ? `COMPETITOR HEADINGS (model the competitor_section's H2/H3 COVERAGE on these — DO NOT copy phrasing, NAP, names, or reviews):\n${competitorHeadings.map(h => `- ${h}`).join('\n')}`
    : 'No competitor headings available — base the competitor_section on standard, comprehensive coverage for this service.';

  const system = `You write ONE unique Location+Service web page (L3 content only) for a ${ymyl ? 'YMYL healthcare' : ''} brand. Respond ONLY with JSON matching the schema. No prose, no markdown.
Schema:
${L3_SCHEMA_HINT}
${toneBlock}
${structureRules}
HARD RULES:
- Place primary/secondary keywords naturally — NO stuffing.
- Weave at least one concrete LOCAL detail (nearby areas, parking/access, local providers) into the hero and competitor_section, drawn from the LOCAL FACTS only.
- Minimum ${config.uniqueness.minBodyWordCount} words of unique body copy across the sections.
- competitor_section: at least 1 H2 + 3 H3s; aim for 2 H2 + 5 H3s.
- faqs: 7 to 11 questions, specific to THIS service + location (so sibling pages differ).
- NEVER use these prohibited claims: ${prohibited || '(none)'}.
${ymyl ? '- YMYL: do NOT overclaim medical outcomes. Defer specific clinical claims to provider-reviewed copy. Never invent credentials, licenses, or certifications.' : ''}`;

  const user = `PAGE: ${service.name} in ${location.location_name}, ${location.state}
Service category: ${service.category}
Primary keywords: ${primaryKws}
Secondary keywords: ${secondaryKws}
FAQ keyword seeds: ${faqKws}
Conditions/topics to weave in: ${(service.conditions_treated || []).join(', ')}

${localFacts}

${modelBlock}

Return JSON only, matching the schema. Remember: 2 care_pillars, competitor_section with H2/H3 blocks, and 7-11 faqs.`;

  return { system, user };
}

async function generateL3({ pageObject, layers, keywords, modelCopy }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured on server.');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { system, user } = buildPrompt({ pageObject, layers, keywords, modelCopy });

  let l3 = null;
  for (let attempt = 0; attempt < 2 && !l3; attempt++) {
    const completion = await openai.chat.completions.create({
      model: config.llm.generationModel,
      ...chatParams(config.llm.generationModel, { maxTokens: 4096 }),
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    try {
      const raw = JSON.parse(completion.choices[0].message.content);
      if (raw && (raw.h1 || raw.hero_intro)) l3 = raw;
    } catch { /* retry once */ }
  }
  if (!l3) throw new Error('Content generation returned invalid JSON after retry.');
  return l3;
}

// Cross-page similarity vs sibling pages for the same client (Spec §7.3).
async function crossPageSimilarity({ store, clientId, currentPageId, pageData }) {
  const body = text.pageBodyText(pageData);
  const pages = (await store.list('pages', { client_id: clientId }))
    .filter(p => p.id !== currentPageId && p.page_object?.page_data);
  let worst = { similarity: 0, page_id: null, same_location_service: false };
  for (const p of pages) {
    const sim = text.similarity(body, text.pageBodyText(p.page_object.page_data));
    if (sim > worst.similarity) {
      worst = {
        similarity: sim, page_id: p.id,
        same_location_service: p.location_id === pageData._location_id, // hint set by caller
      };
    }
  }
  return worst;
}

// Originality vs scraped competitor copy (Spec §7.3).
function competitorOverlap(pageData, modelCopy = []) {
  const body = text.pageBodyText(pageData);
  let worst = 0;
  for (const m of modelCopy) {
    if (!m.content) continue;
    const sim = text.similarity(body, m.content);
    if (sim > worst) worst = sim;
  }
  return worst;
}

module.exports = { buildPrompt, generateL3, crossPageSimilarity, competitorOverlap };
