// ── Content Generation, Stage 7 (Spec §7) — Layer-aware ─────────────────────
// Generates L3 ONLY (page_data copy), then compose.mergeL3 stitches it onto the
// L1+L2 scaffold. Scraped competitor copy is used for MODELING coverage/structure
// only — never to copy NAP, images, providers or reviews (Spec §7.1, §15.4).

const config = require('./config');
const text = require('./text');
const { chatParams } = require('./llmParams');
const { createLlmClient } = require('../services/llmProviders');

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
  const llm = createLlmClient(config.llm.generationModel);
  const { system, user } = buildPrompt({ pageObject, layers, keywords, modelCopy });

  let l3 = null;
  for (let attempt = 0; attempt < 2 && !l3; attempt++) {
    const completion = await llm.chat.completions.create({
      model: llm.model,
      ...chatParams(llm.model, { maxTokens: 4096 }),
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

  const llm = createLlmClient(config.llm.generationModel);
  const completion = await llm.chat.completions.create({
    model: llm.model,
    ...chatParams(llm.model, { maxTokens: 700 }),
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });

  const raw = JSON.parse(completion.choices[0].message.content);
  const value = raw[cfg.key] || '';
  return maxChars && value.length > maxChars ? value.slice(0, maxChars) : value;
}

// ── Dental (Gentle Dental) content generation — Build Brief §4 (narrowed) ──
// ONE structured call producing: hero.intro (short description below the H1),
// meta.metaDescription, educationalBody blocks, faq items — the keyword-critical
// fields (title is deterministic, built in compose.buildDentalScaffold).
// servicesInCity.intro is NOT generated — it's an optional manual-entry field
// in the wizard. No OG tags at all (dropped from the contract). NAP/breadcrumb/
// menu/schema scaffolding are assembled in code — never by the model.
//
// educationalBody + faqs are modeled on REAL competitor pages: dentalWizard.js
// SERPs the primary keyword, scrapes the top-ranking (non-Gentle-Dental) results
// for their H2/H3 headings and any detected FAQ questions, and passes that in
// as `competitorHeadings`/`competitorFaqs`. The model must model COVERAGE from
// these, never copy phrasing/NAP/reviews — same guardrail as the Neuro pipeline.

const DENTAL_L3_SCHEMA_HINT = `{
  "heroIntro": "string — a SHORT description that renders directly below the H1. 1-2 sentences. Optimized for the PRIMARY keyword — the first sentence should naturally include it.",
  "metaDescription": "string — MUST be 150-160 characters TOTAL, counting every character including spaces. This is a two-sided range: too short fails QA just like too long. Draft it, count it, and if it is under 150 characters add another short clause (a benefit, insurance note, or CTA) before finalizing. Includes the PRIMARY keyword, ends with a soft CTA.",
  "educationalBody": [
    { "h2": "string — heading, keyword-relevant", "html": "string — clean semantic HTML using ONLY <p>, <ul>, <li>. No inline styles/classes." }
  ],
  "faqs": [
    { "q": "string", "a": "string" }
  ]
}`;

const DENTAL_SYSTEM_PROMPT = `You are an expert local-SEO + GEO/AEO content writer for Gentle Dental of New England,
a multi-location dental group in Massachusetts and New Hampshire.

Write US English in AP style:
- Spell out one through nine; numerals for 10+. Always use numerals for data/metrics.
- Percentages as numerals + % (e.g. 14%). No Oxford comma unless needed to avoid ambiguity.
- No em dashes as stylistic connectors. Title case for section headers.
Tone: conversational but polished, trustworthy, patient-friendly. Never clinical-cold, never hypey.

Hard rules:
- Do NOT invent office addresses, phone numbers, hours, prices, dentist names, or patient reviews.
- Localize meaningfully to the specific city so this page is not a near-duplicate of other cities'
  pages: reference the city (and neighborhood/region where natural) in at least one H2's body and
  in at least one FAQ.
- The PRIMARY keyword (or a clearly recognizable close variant — plural/singular, reordered, with a
  natural preposition like "in") MUST appear a TOTAL of 5 times across the ENTIRE generated content
  (heroIntro + educationalBody + faqs combined) — NOT counting metaDescription. Do not just aim for
  "5ish" — use this exact checklist so you don't undercount, then verify before answering:
    1. heroIntro — 1 occurrence (its first sentence).
    2. educationalBody — 1 occurrence in an H2 heading or its opening sentence.
    3. educationalBody — 2 MORE occurrences spread across other blocks (different blocks, not the
       same one twice).
    4. faqs — 1 occurrence in a question or answer.
  That is 5 checklist items — hit all 5 before finalizing. It must also appear once in the meta
  description. Weave SECONDARY keywords where they read naturally elsewhere. Never keyword-stuff —
  each occurrence should read as a normal sentence, not a forced insertion.
- metaDescription is a HARD two-sided range: 150-160 characters, not "up to 160." Count it before
  answering. A description of 130-145 characters FAILS review just as badly as one over 160 — pad
  it with a genuine benefit, insurance note, or CTA clause until it lands in range.
- Write answer-first: each H2 and each FAQ answer must be self-contained and directly useful when
  lifted out of context (this is what AI answer engines cite).
- Medical accuracy: describe procedures factually; include candidacy, benefits, risks/safety where
  relevant. No guarantees of outcomes.
- When COMPETITOR HEADINGS / COMPETITOR FAQ TOPICS are provided below: model your H2 coverage and
  FAQ selection on the SUBJECT MATTER they cover — never copy their phrasing, NAP, dentist names,
  reviews, or exact sentences. If none are provided, fall back to comprehensive standard coverage.

Return ONLY JSON, no prose, no markdown fences, matching the schema provided in the user message.`;

function buildDentalPrompt({ service, location, primaryKeyword, secondaryKeywords, competitorHeadings, competitorFaqs }) {
  const officeName = location.location_name;
  const cityState = `${location.city}, ${location.state_abbreviation}`;

  const bodyStack = `EDUCATIONAL BODY — produce a service-appropriate H2 stack (adapt headings to this
specific service; do not force every heading if it doesn't fit). Default set to draw from if no
competitor headings are provided below:
1. What Is ${service.name}?
2. Benefits of ${service.name} (or "Advantages of Professional ${service.name}")
3. What to Expect / The ${service.name} Procedure (+ duration where relevant)
4. Who Is a Good Candidate for ${service.name}?
5. Types / Methods / Options (where the service has variants)
6. Effectiveness & Cost Considerations
7. Is ${service.name} Safe? / Risks (where clinically relevant)
For clinical/urgent services (e.g. Root Canals, Extractions, Emergency Dental Care), swap in:
"Signs You May Need ${service.name}", "The ${service.name} Procedure", "Alternatives to ${service.name}".
3-5 H2 blocks total, each with clean HTML (<p>/<ul>/<li> only).`;

  const competitorBlock = (competitorHeadings || []).length
    ? `COMPETITOR HEADINGS (real top-ranking pages for this keyword — model your H2 COVERAGE on the
topics these represent; do NOT copy phrasing, NAP, names, or reviews):
${competitorHeadings.map(h => `- ${h}`).join('\n')}`
    : 'No competitor headings available — base the educational body on standard, comprehensive coverage for this service.';

  const faqBlock = (competitorFaqs || []).length
    ? `COMPETITOR FAQ TOPICS (real questions competitor pages answer for this keyword — write your
own original answers, do not copy theirs):
${competitorFaqs.map(f => `- ${f}`).join('\n')}`
    : '';

  const user = `PAGE: ${service.name} in ${officeName}, ${cityState}
Service category: ${service.category}
Office name: ${officeName}
Primary keyword: ${primaryKeyword}
Secondary keywords: ${(secondaryKeywords || []).join(', ') || '(none)'}

HERO INTRO: a short description rendered directly below the H1 heading. 1-2 sentences, first
sentence naturally includes the primary keyword.

${bodyStack}

${competitorBlock}

FAQ: 4-6 Q&As phrased the way patients ask; localize at least one to ${location.city}.
${faqBlock}

KEYWORD FREQUENCY: "${primaryKeyword}" (or a close variant) must appear 5 times total across
heroIntro + educationalBody + faqs combined (not counting metaDescription). Follow the 5-item
checklist from the system prompt (heroIntro / an H2 / 2 more educationalBody spots / an FAQ) —
count your draft against it before returning JSON.

Return JSON only, matching this schema:
${DENTAL_L3_SCHEMA_HINT}`;

  return { system: DENTAL_SYSTEM_PROMPT, user };
}

async function generateDentalL3({ service, location, primaryKeyword, secondaryKeywords, competitorHeadings, competitorFaqs }) {
  const llm = createLlmClient(config.llm.generationModel);
  const { system, user } = buildDentalPrompt({ service, location, primaryKeyword, secondaryKeywords, competitorHeadings, competitorFaqs });

  let l3 = null;
  for (let attempt = 0; attempt < 2 && !l3; attempt++) {
    const completion = await llm.chat.completions.create({
      model: llm.model,
      ...chatParams(llm.model, { maxTokens: 3500 }),
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    try {
      const raw = JSON.parse(completion.choices[0].message.content);
      if (raw && (raw.metaDescription || raw.educationalBody || raw.heroIntro)) l3 = raw;
    } catch { /* retry once */ }
  }
  if (!l3) throw new Error('Dental content generation returned invalid JSON after retry.');
  l3.metaDescription = normalizeMetaDescriptionLength(l3.metaDescription, { service, location });
  return l3;
}

// A 150-160 char TWO-SIDED range is hard for an LLM to hit reliably (it's easy
// to cap a max, much harder to guarantee a min) — this is a deterministic
// safety net so QC's meta_description_length check doesn't fail on an
// otherwise-good page. Mirrors the existing Neuro pattern of clipping as a
// safety net after generation (compose.mergeL3).
function clipToWordBoundary(s, max) {
  let out = s.slice(0, max);
  const lastSpace = out.lastIndexOf(' ');
  if (lastSpace > max - 20) out = out.slice(0, lastSpace);
  return out.replace(/[.,;:\s]+$/, '') + '.';
}

function normalizeMetaDescriptionLength(desc, { service, location }) {
  const s = String(desc || '').trim().replace(/\s+/g, ' ');
  if (s.length > 160) return clipToWordBoundary(s, 160);
  if (s.length >= 150) return s;

  // Under 150 — try a set of increasingly long CTA clauses and use whichever
  // lands the combined string inside [150, 160] without truncating mid-clause.
  const base = s.replace(/\.?\s*$/, '');
  const fillers = [
    `Call ${location.city} today.`,
    `Call our ${location.city} office today to book.`,
    `Call our ${location.city} team to schedule your visit today.`,
    `Ask our ${location.city} team about ${service.name.toLowerCase()} options and book your visit today.`,
  ];
  for (const filler of fillers) {
    const candidate = `${base}. ${filler}`;
    if (candidate.length >= 150 && candidate.length <= 160) return candidate;
  }
  // Nothing landed exactly in range — fall back to the longest filler, clipped
  // cleanly as a whole (same safe path as the over-160 case above).
  const longest = `${base}. ${fillers[fillers.length - 1]}`;
  return longest.length > 160 ? clipToWordBoundary(longest, 160) : longest;
}

// ── Dental per-section regeneration ("regenerate every section") ──────────
// One small, targeted LLM call per section instead of regenerating the
// whole page. Shares the same hard rules (no fabricated NAP/reviews, AP
// style, competitor-modeled coverage) as the main generation call.
const DENTAL_REGEN_GUARDRAILS = `Write US English in AP style (spell out one-nine, numerals 10+, no em dashes,
title case headers). Tone: conversational, trustworthy, patient-friendly. Do NOT invent office
addresses, phone numbers, hours, prices, dentist names, or patient reviews. No guarantees of medical
outcomes. When COMPETITOR context is provided, model coverage/subject matter only — never copy
phrasing, NAP, names, or reviews. Return ONLY JSON, no prose, no markdown fences.`;

function competitorContextBlock(competitorHeadings, competitorFaqs) {
  const parts = [];
  if ((competitorHeadings || []).length) {
    parts.push(`COMPETITOR HEADINGS (model subject-matter coverage, don't copy phrasing):\n${competitorHeadings.map(h => `- ${h}`).join('\n')}`);
  }
  if ((competitorFaqs || []).length) {
    parts.push(`COMPETITOR FAQ TOPICS (write your own original answers):\n${competitorFaqs.map(f => `- ${f}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

async function generateDentalRegen({ service, location, primaryKeyword, secondaryKeywords, competitorHeadings, competitorFaqs, section, context = {} }) {
  const llm = createLlmClient(config.llm.generationModel);
  const cityState = `${location.city}, ${location.state_abbreviation}`;
  const competitorBlock = competitorContextBlock(competitorHeadings, competitorFaqs);
  const kwLine = `Primary keyword: ${primaryKeyword}\nSecondary keywords: ${(secondaryKeywords || []).join(', ') || '(none)'}`;

  let schemaHint, task;
  if (section === 'heroIntro') {
    schemaHint = `{ "heroIntro": "string — 1-2 sentences, first sentence naturally includes the PRIMARY keyword" }`;
    task = `Write ONLY a fresh hero intro (short description below the H1) for "${service.name}" in ${cityState}.`;
  } else if (section === 'metaDescription') {
    schemaHint = `{ "metaDescription": "string — MUST be 150-160 characters total, includes the PRIMARY keyword, ends with a soft CTA" }`;
    task = `Write ONLY a fresh meta description for "${service.name}" in ${cityState}.`;
  } else if (section === 'educationalBlock') {
    schemaHint = `{ "h2": "string — heading", "html": "string — clean HTML using ONLY <p>, <ul>, <li>" }`;
    const otherHeadings = (context.otherHeadings || []).filter(Boolean);
    task = `Write ONE fresh educational H2 block (heading + HTML body) for "${service.name}" in ${cityState}${
      context.currentH2 ? `, replacing the current heading "${context.currentH2}"` : ''
    }.${otherHeadings.length ? ` Do NOT duplicate these other headings already on the page: ${otherHeadings.join(' | ')}.` : ''}`;
  } else if (section === 'educationalBody') {
    schemaHint = `{ "educationalBody": [ { "h2": "string", "html": "string — clean HTML using ONLY <p>, <ul>, <li>" } ] }`;
    task = `Write a fresh 3-5 block educational H2 stack for "${service.name}" in ${cityState}.`;
  } else if (section === 'faqs') {
    schemaHint = `{ "faqs": [ { "q": "string", "a": "string" } ] }`;
    task = `Write a fresh set of 4-6 FAQ Q&As for "${service.name}" in ${cityState}, phrased the way patients ask; localize at least one to ${location.city}.`;
  } else if (section === 'faqItem') {
    schemaHint = `{ "q": "string", "a": "string" }`;
    const otherQuestions = (context.otherQuestions || []).filter(Boolean);
    task = `Write ONE fresh FAQ Q&A for "${service.name}" in ${cityState}${
      context.currentQ ? `, replacing the current question "${context.currentQ}"` : ''
    }, phrased the way a patient asks.${otherQuestions.length ? ` Do NOT duplicate these other questions already on the page: ${otherQuestions.join(' | ')}.` : ''}`;
  } else {
    throw new Error(`Unknown regen section "${section}".`);
  }

  const system = `${DENTAL_REGEN_GUARDRAILS}\nSchema:\n${schemaHint}`;
  const user = `${task}\n\n${kwLine}\n\n${competitorBlock}\n\nReturn JSON only, matching the schema.`;

  let result = null;
  for (let attempt = 0; attempt < 2 && !result; attempt++) {
    const completion = await llm.chat.completions.create({
      model: llm.model,
      ...chatParams(llm.model, { maxTokens: 1500 }),
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    try {
      const raw = JSON.parse(completion.choices[0].message.content);
      if (raw) result = raw;
    } catch { /* retry once */ }
  }
  if (!result) throw new Error(`Dental regeneration ("${section}") returned invalid JSON after retry.`);
  if (section === 'metaDescription') result.metaDescription = normalizeMetaDescriptionLength(result.metaDescription, { service, location });
  return result;
}

module.exports = {
  buildPrompt, generateL3, crossPageSimilarity, competitorOverlap, regenField,
  buildDentalPrompt, generateDentalL3, generateDentalRegen,
};
