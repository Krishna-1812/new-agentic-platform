// ── Content Generation, Stage 7 (Spec §7) — Layer-aware ─────────────────────
// Generates L3 ONLY (page_data copy), then compose.mergeL3 stitches it onto the
// L1+L2 scaffold. Scraped competitor copy is used for MODELING coverage/structure
// only — never to copy NAP, images, providers or reviews (Spec §7.1, §15.4).

const OpenAI = require('openai');
const config = require('./config');
const text = require('./text');
const { chatParams } = require('./llmParams');

const L3_SCHEMA_HINT = `{
  "meta_title": "string — max 60 chars, includes service + location + brand",
  "meta_description": "string — 150-160 chars, includes service + location",
  "og_title": "string", "og_description": "string",
  "h1": "string — MAX 55 CHARS. Natural heading, includes service + location, not keyword-stuffed",
  "hero_intro": "string — MAX 160 CHARS. 1-2 sentences mentioning the specific location",
  "approach_intro": "string — MAX 1110 CHARS. Body copy for the 'Our approach to [service]' section. Write as 2-3 paragraphs separated by a blank line (\\n\\n). ONE H2 heading only, NO sub-headings, NO bullet points",
  "competitor_section": [
    {
      "h2": "string — H2 heading modelled on what top competitors cover for this service",
      "description": "string — MAX 450 CHARS. 1-2 sentence intro paragraph below the H2 heading",
      "h3s": [
        {
          "heading": "string — H3 subtopic title",
          "copy": "string — MAX 1500 CHARS. 3-5 sentences of unique, informative copy for this H3. No bullet points unless truly needed (bullets reduce limit to 1400 chars)"
        }
      ]
    }
  ],
  "faqs": [
    {
      "question": "string",
      "answer": "string — MAX 300 CHARS. Concise, helpful, direct answer",
      "faq_type": "location|service|insurance|virtual|provider|appointment"
    }
  ]
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
1. meta_title, meta_description, h1 (MAX 55 chars), hero_intro (MAX 160 chars)
2. approach_intro (MAX 1110 chars): body copy for "Our approach to ${service.name}". Write as 2-3 paragraphs (blank line between each). ONE H2 heading only, NO sub-headings, NO bullet points.
3. competitor_section: modelled on top competitors. MINIMUM 1 H2 block with 3 H3s; RECOMMENDED 2 H2 blocks with 5 H3s total. Each block has: h2 heading, description (MAX 450 chars), and h3s each with heading + copy (MAX 1500 chars per H3).
4. faqs: 7 to 11 questions, each answer MAX 300 chars, tagged by faq_type.

CHARACTER LIMITS — THESE ARE ABSOLUTE HARD LIMITS. COUNT EVERY CHARACTER INCLUDING SPACES:
- h1: 55 chars max
- hero_intro: 160 chars max
- approach_intro: 1110 chars max
- competitor_section[].description: 450 chars max per block
- competitor_section[].h3s[].copy: 1500 chars max per H3
- faqs[].answer: 300 chars max per answer`;

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
- CHARACTER LIMITS ARE ABSOLUTE. Before finalising each field, count characters and trim if needed: h1 ≤55, hero_intro ≤160, approach_intro ≤1110, block description ≤450, H3 copy ≤1500, FAQ answer ≤300.
- Do NOT produce a "care_pillars" key — the approach section is approach_intro only (plain paragraphs, no sub-headings).
- Each competitor_section block MUST include a "description" key (the intro paragraph under the H2).
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

// ── Single-field regeneration (per-field regen from the editor) ───────────────
const REGEN_FIELD_CONFIGS = {
  h1: {
    key: 'h1',
    promptFn: (svc, loc) => `Write the H1 page heading for a "${svc}" page in ${loc}. Natural phrasing, includes service + location, not keyword-stuffed.`,
  },
  hero_intro: {
    key: 'hero_intro',
    promptFn: (svc, loc) => `Write the hero intro paragraph for a "${svc}" page in ${loc}. 2-3 sentences mentioning the specific location and what makes this service accessible here.`,
  },
  'approach.intro': {
    key: 'approach_intro',
    promptFn: (svc, loc) => `Write the body copy for the "Our approach to ${svc}" section on a page in ${loc}. Write in 2-3 distinct paragraphs (separate with a blank line). Warm clinical authority, weave in local specifics.`,
  },
  'block.description': {
    key: 'description',
    promptFn: (svc, loc, ctx) => `Write a brief section intro paragraph for an H2 block titled "${ctx.h2 || 'this section'}" on a "${svc}" page in ${loc}. One short paragraph that introduces what this section covers.`,
  },
  'h3.copy': {
    key: 'copy',
    promptFn: (svc, loc, ctx) => `Write description copy for an H3 subsection titled "${ctx.heading || 'this subsection'}" under H2 "${ctx.h2 || ''}" on a "${svc}" page in ${loc}. Informative, unique, include local specifics where naturally relevant.`,
  },
  'faq.answer': {
    key: 'answer',
    promptFn: (svc, loc, ctx) => `Write a concise, helpful FAQ answer to: "${ctx.question || 'this question'}" on a "${svc}" page in ${loc}. Direct, conversational, accurate.`,
  },
};

async function regenField({ pageObject, layers, keywords, field, maxChars, context = {} }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured on server.');
  const cfg = REGEN_FIELD_CONFIGS[field];
  if (!cfg) throw new Error(`Unknown regen field: "${field}".`);

  const { service, location, client, tone } = layers;
  const ld = pageObject.location_data;
  const loc = `${location.location_name}, ${location.state}`;

  const prohibited = (client.brand_rules?.prohibited_claims || []).join(', ');
  const ymyl = client.brand_rules?.ymyl;
  const toneBlock = tone ? `Brand voice: ${tone.voice}. Reading level: ${tone.reading_level}.` : 'Brand voice: warm, professional, clear.';
  const primaryKws = (keywords?.primary || []).map(k => k.keyword).slice(0, 5).join(', ');
  const localFacts = `City/State: ${ld.city}, ${ld.state}. Nearby: ${(ld.nearby_areas || []).slice(0, 4).join(', ')}.`;
  const charRule = maxChars ? `HARD CHARACTER LIMIT: ${maxChars} characters maximum (every character including spaces). Do not exceed this limit.` : '';

  const system = `You are a healthcare content writer. Respond ONLY with a JSON object: { "${cfg.key}": "..." }. No prose, no markdown, no extra keys.
${toneBlock}
${charRule}
Weave in these primary keywords naturally (no stuffing): ${primaryKws || 'n/a'}.
NEVER use these prohibited claims: ${prohibited || '(none)'}.
${ymyl ? 'YMYL: do NOT overclaim medical outcomes. Never invent credentials or certifications.' : ''}`;

  const user = `${cfg.promptFn(service.name, loc, context)}

${localFacts}

Return JSON only: { "${cfg.key}": "..." }`;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: config.llm.generationModel,
    ...chatParams(config.llm.generationModel, { maxTokens: 700 }),
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });

  const raw = JSON.parse(completion.choices[0].message.content);
  const value = raw[cfg.key] || '';
  return maxChars && value.length > maxChars ? value.slice(0, maxChars) : value;
}

module.exports = { buildPrompt, generateL3, crossPageSimilarity, competitorOverlap, regenField };
