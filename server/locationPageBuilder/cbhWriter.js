// ── Clear Behavioral Health writer ──────────────────────────────────────────
// Produces every generated string on a CBH page in one structured call.
//
// Its own module rather than a branch inside contentGenerator: that writer's
// entire prompt is built around a flat stack of H2 blocks with a fixed outline
// contract, and this contract is nine named sections with ten hard character
// caps, one of which nests 4-5 H3s budgeted in LINES. Bending one prompt to
// serve both would make each harder to reason about and put Gentle Dental at
// risk on every CBH change.
//
// The correction pass is driven by the QC gates themselves (cbhQc), not by a
// second copy of the limits. A model cannot count its own characters reliably,
// but it corrects well when handed the real numbers -- and taking those
// numbers from the gates means the instruction can never drift from what the
// page is actually judged against.

const config = require('./config');
const contract = require('./cbhContract');
const cbhCompose = require('./cbhCompose');
const cbhQc = require('./cbhQc');
const { createLlmClient } = require('../services/llmProviders');
const { chatParams } = require('./llmParams');

const { LIMITS: L } = contract;

const SCHEMA_HINT = `{
  "metaTitle": "string",
  "metaDescription": "string",
  "hero": { "h1": "string", "description": "string" },
  "approach": {
    "paragraphs": ["string"],
    "philosophy": ["string"],
    "therapies": ["string"]
  },
  "insurance": "string",
  "educational": {
    "paragraphs": ["string"],
    "h3s": [{ "heading": "string", "lines": ["string"] }]
  },
  "uvp": "string",
  "service": "string",
  "faqs": [{ "q": "string", "a": "string", "type": "location | brand | intent" }]
}`;

function systemPrompt() {
  return `You are an expert local-SEO content writer for ${contract.BRAND}, a behavioral health provider in California.

THIS IS A COMMERCIAL-INTENT PAGE. The reader has decided they may want this care and is choosing WHERE
to get it. They are comparing providers, not researching a topic.

EVERY LIMIT BELOW IS A CHARACTER COUNT, AND EVERY ONE IS HARD.
Count before you answer. These are not targets to approach — a value over the limit fails review, and
several of them are short enough that one extra clause breaks them. Where a limit is a range, landing
under it fails exactly as badly as landing over it.

KEYWORDS — a keyword is a SEARCH QUERY, never a phrase to reproduce.
- Keywords are typed into a search box, so they are usually not grammatical English: "anxiety treatment
  cost anaheim hills", "iop pasadena". NEVER paste one into a sentence. Write the IDEA in English.
- NEVER put the city directly after the service, and never use that pair as a label for people or
  things. "Anxiety Treatment Anaheim Hills patients" is wrong. Put a real preposition in: "anxiety
  treatment in Anaheim Hills", "our Anaheim Hills team".
- There is no frequency target. Name the topic where it belongs and stop.

HARD RULES
- Do NOT invent addresses, phone numbers, hours, prices, clinician or therapist names, patient numbers,
  review counts, credentials, awards or years in practice.
- This is health content. No guarantees of outcomes, no success rates, no claim that anyone will
  recover. Describe care factually.
- Do NOT claim insurance coverage beyond "accepts most major insurance providers" — never name a plan
  as covered, and never promise a cost.
- Headings are NOT yours to write. Every H2 and H3 on this page is fixed and is given to you below.
  Write the body that sits under each one. Do not restate a heading as the opening sentence.
- Write answer-first: each section must be useful when read on its own.

DO NOT WRITE TO A TEMPLATE.
These pages sit on one domain, in one city, and differ only by the care they describe. When four of
them were compared side by side, thirty-eight phrases of four to seven words appeared on three or
more of them. Sentence-level duplication is what makes a set of location pages read as generated.
- Never build a sentence around these shapes. They are the ones that actually repeated:
    "... most major insurance providers, helping make {service} in {city} accessible ..."
    "... our {city} team ..."
    "... {service} in {city} with individualized care plans ..."
    "... scheduling options, including evening appointments ..."
    "Clear Behavioral Health offers/provides ..." as the opening of the Why Choose paragraph
- The insurance sentence MUST still say "most major insurance providers" — that wording is required.
  Build a different sentence around it: lead with what it means for this person, or with the care
  itself, rather than with the company name and the same trailing clause every time.
- Vary how each section opens. If the Why Choose paragraph starts with the practice name, the
  insurance and service paragraphs must not.
- Say something only true of THIS care. "Individualized treatment planning, a dedicated clinical
  team, flexible scheduling" is true of every service here and therefore tells the reader nothing.

Return ONLY JSON, no prose, no markdown fences, matching the schema in the user message.`;
}

// The per-section instructions, each stating its own cap. Built from the
// contract so a retuned limit reaches the model and the gate together.
function sectionBrief({ scaffold, h3Plan, faqPlan, primaryKeyword }) {
  const s = scaffold.sections;
  const h3LineChars = L.educational.lineMaxChars;
  const h3Count = h3Plan.length || L.educational.h3Count.max;
  const h3Cap = contract.linesPerBody(h3Count);
  // What the model is actually asked for: the writing that fits once the
  // mandatory breaks are paid for out of the same allowance.
  const h3Lines = contract.contentAllowance(h3Cap);

  // A section marked fallback is cited to a named clinical authority, so it has
  // to be written FROM that source rather than from recall. Handing the model
  // only the heading and then publishing a citation asserts provenance the copy
  // does not have -- which the guidelines forbid ("do not invent information or
  // add unsupported claims") and which is worse than no citation, because it
  // looks verified.
  const h3Line = (h, i) => {
    const bits = [`${i + 1}. ${h.heading}`];
    if (h.intent) bits.push(`   Cover: ${h.intent}`);
    if (h.source === 'fallback' && h.sourceExcerpt) {
      bits.push('   WRITE THIS ONE FROM THE SOURCE BELOW. Use only what it states; add no facts of');
      bits.push('   your own. Rewrite in plain language — never copy its wording.');
      bits.push(`   SOURCE (${h.sourceUrl}): ${h.sourceExcerpt}`);
    } else if (h.source === 'fallback') {
      bits.push('   No source text was retrieved for this one. Keep it general and factual, and state');
      bits.push('   nothing specific enough to need a citation.');
    }
    return bits.join('\n');
  };

  const h3Block = h3Plan.length
    ? `THE H3 HEADINGS ARE FIXED. Write a body for each of these ${h3Plan.length}, in this order, copying each
heading VERBATIM into "heading". Do not add, drop, reorder or reword them:
${h3Plan.map(h3Line).join('\n')}`
    : `Write ${L.educational.h3Count.min}-${L.educational.h3Count.max} H3s, each heading at most ${L.educational.h3HeadingMaxChars} characters.`;

  const faqBlock = faqPlan.length
    ? `THE FAQ QUESTIONS ARE FIXED. Answer these ${faqPlan.length}, in this order, copying each question VERBATIM
into "q". Do not add, drop, reorder or reword them. Set "type" to the label given:
${faqPlan.map((f, i) => `${i + 1}. [${f.type || 'intent'}] ${f.q}`).join('\n')}`
    : `Write ${L.faqs.count.min}-${L.faqs.count.max} FAQs with a mix of location-specific, brand-specific and
user-intent questions, tagging each with its "type".`;

  return `META TITLE — ${L.metaTitle.min}-${L.metaTitle.max} characters. Do NOT include "${contract.TITLE_SUFFIX.trim()}"; it is appended
automatically and is NOT counted. Include the primary keyword or a close variant. Natural and readable,
never keyword-stuffed.

META DESCRIPTION — ${L.metaDescription.min}-${L.metaDescription.max} characters. Every word of the primary keyword must appear, in any
order. End on a mental-health call to action ("Get support", "Explore treatment options", "Schedule a
consultation"). Natural, not stuffed.

HERO H1 — at most ${L.hero.h1MaxChars} characters. Must contain the primary keyword and "${scaffold.locationName}". Engaging and
service-focused, not a bare label.

HERO DESCRIPTION — at most ${L.hero.descriptionMaxChars} characters. Use the primary keyword or a close variation naturally.
State the benefit of the service. Add a call to action where it fits.

APPROACH — heading "${s.approach.heading}" is fixed.
The WHOLE approach section, all three bodies together, is at most ${L.approach.sectionMaxChars} characters.
  - Under the H2: ${L.approach.paragraphsPerBlock.min}-${L.approach.paragraphsPerBlock.max} paragraphs.
  - Under "${s.approach.philosophy.heading}": ${L.approach.paragraphsPerBlock.min}-${L.approach.paragraphsPerBlock.max} paragraphs.
  - Under "${s.approach.therapies.heading}": ${L.approach.paragraphsPerBlock.min}-${L.approach.paragraphsPerBlock.max} paragraphs.
Every paragraph is at most ${L.approach.paragraphMaxChars} characters, and every one must be specific to this service — not
generic copy that would fit any page.

INSURANCE — heading "${s.insurance.heading}" is fixed. ONE paragraph, at most ${L.insurance.maxChars} characters.
Mention accessibility naturally. Say "most major insurance providers"; claim nothing more.

EDUCATIONAL — heading "${s.educational.heading}" is fixed.
Intro: ${L.educational.introParagraphs.min}-${L.educational.introParagraphs.max} paragraphs, ${L.educational.introMaxChars} characters TOTAL across them.
${h3Block}
EVERY H3 BODY MAY TAKE UP TO ${h3Lines} LINES OF WRITING. That allowance belongs to EACH body separately —
they do not share it, and one body using fewer does not give another more.
Each entry in the "lines" array is EITHER a paragraph OR a bullet:
  • A PARAGRAPH is 2-4 sentences in ONE entry. It costs one line per ${h3LineChars} characters, so a
    220-character paragraph costs three. Do NOT break a paragraph up into one sentence per entry.
  • A BULLET starts with "- " and costs TWO lines whatever its length. Use it where the content really
    is a list — options, steps, signs, what to bring — never for a point that needs explaining.
MIX THE TWO. A body of nothing but short standalone sentences reads like a slide, and a body of nothing
but prose buries the list a reader is scanning for. Lead a body with a paragraph, then bullet the part
that enumerates. Both forms must appear across the ${h3Count} subsections.
Every body needs at least one entry.
${h3Lines} is a CEILING, not a target. Use the lines the content genuinely earns and stop. A padded
subsection is worse than a short one that says something, and repeating the heading back as a sentence
counts against you.

WHY CHOOSE — heading "${s.uvp.heading}" is fixed. ONE paragraph, at most ${L.uvp.maxChars} characters.
Name real differentiators and what the patient gets. It must mention this service and ${scaffold.locationName}, because
the heading itself says neither. No superlatives, no "best", no invented credentials.

SERVICE — heading "${s.service.heading}" is fixed. ONE paragraph, at most ${L.service.maxChars} characters. Natural,
specific to the service and the location.

FREQUENTLY ASKED QUESTIONS — each answer at most ${L.faqs.answerMaxChars} characters.
${faqBlock}
Questions must be genuinely useful. Never force a keyword into a question or an answer.`;
}

function userPrompt({ scaffold, h3Plan, faqPlan, primaryKeyword, secondaryKeywords, correction }) {
  return `PAGE: ${scaffold.serviceName} in ${scaffold.locationName}, California
Provider: ${contract.BRAND}
Primary keyword: ${primaryKeyword}
Secondary keywords: ${(secondaryKeywords || []).join(', ') || '(none)'}

${sectionBrief({ scaffold, h3Plan, faqPlan, primaryKeyword })}
${correction || ''}
Return JSON only, matching this schema:
${SCHEMA_HINT}`;
}

// Turns failing QC checks into instructions. Only length and count failures
// are worth a retry — a model told "your meta description is 138 characters,
// it must be 150-160" fixes it; one told "your UVP is not specific enough"
// mostly rewrites at random.
const CORRECTABLE = new Set([
  'meta_title_length', 'meta_description_length',
  'hero_h1_length', 'hero_description_length',
  'approach_section_length', 'approach_paragraph_limits',
  'insurance_length', 'educational_intro_length',
  'educational_h3_heading_length', 'educational_h3_line_budget',
  // A one-sided section is exactly the kind of thing a second pass fixes: the
  // content is right, the shape is not.
  'educational_body_mix',
  'uvp_length', 'service_length', 'faq_answer_length',
  'meta_description_has_cta', 'meta_description_has_keyword_words',
]);

function correctionFrom(qc) {
  const notes = qc.checks
    .filter(c => !c.pass && CORRECTABLE.has(c.id))
    .map(c => `- ${c.name}. ${c.detail}`);
  if (!notes.length) return '';
  return `
CORRECTION — the previous draft broke these. Fix exactly these and change nothing else. Keep every
heading, every section and the order they are in:
${notes.join('\n')}
`;
}

// `h3Plan`  : [{ heading, intent, source, sourceUrl }] from the approved brief.
// `faqPlan` : [{ q, type }] from the approved brief.
async function generateCbhL3({ scaffold, primaryKeyword, secondaryKeywords, h3Plan = [], faqPlan = [] }) {
  const llm = createLlmClient(config.llm.cbhWriterModel);
  const base = { scaffold, h3Plan, faqPlan, primaryKeyword, secondaryKeywords };

  let lastFinishReason = null;

  const draft = async (correction) => {
    const user = userPrompt({ ...base, correction });
    for (let attempt = 0; attempt < 2; attempt++) {
      const completion = await llm.chat.completions.create({
        model: llm.model,
        // Budget generously. The PAGE is small -- roughly 5,700 characters at
        // every maximum, under 1,500 tokens -- so nearly all of this is
        // reasoning headroom, and this prompt is unusually dense: nine
        // sections, ten character caps, fixed headings, and up to five source
        // excerpts the fallback sections must be written from.
        //
        // At 10,000 the model spent the lot reasoning and was cut off
        // mid-JSON, returning finish_reason "length" with 1,438 characters of
        // a half-finished object. A truncated draft costs the whole call and
        // buys nothing, so the cap is set well clear of that.
        ...chatParams(llm.model, { maxTokens: 20000 }),
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: systemPrompt() }, { role: 'user', content: user }],
      });
      lastFinishReason = completion.choices?.[0]?.finish_reason || null;
      try {
        const raw = JSON.parse(completion.choices[0].message.content);
        if (raw && (raw.metaTitle || raw.hero || raw.educational)) return raw;
      } catch { /* retry once on schema-invalid output */ }
    }
    return null;
  };

  const first = await draft(null);
  if (!first) {
    // Name the actual cause. "Invalid JSON" sent whoever reads it looking for a
    // schema problem, when the response was simply cut off part-way.
    throw new Error(lastFinishReason === 'length'
      ? 'CBH content generation ran out of output budget before finishing its JSON '
        + '(finish_reason "length"). Raise maxTokens in cbhWriter, or shorten the source excerpts.'
      : 'CBH content generation returned invalid JSON after retry.');
  }

  // Score the first draft against the REAL gates, then give the model its own
  // numbers back. One bounded correction pass: a page still failing after that
  // goes to a reviewer, which is the right place for it.
  const provisional = cbhCompose.mergeCbhL3(structuredClone(scaffold), first);
  provisional.primaryKeyword = primaryKeyword;
  const qc = cbhQc.runCbhQc(provisional);
  const correction = correctionFrom(qc);
  if (!correction) return first;

  const second = await draft(correction);
  if (!second) return first;

  // Keep whichever draft QC likes better. A correction pass that made things
  // worse must not be allowed to ship over the draft it was correcting.
  const corrected = cbhCompose.mergeCbhL3(structuredClone(scaffold), second);
  corrected.primaryKeyword = primaryKeyword;
  const after = cbhQc.runCbhQc(corrected);
  return failureWeight(after) <= failureWeight(qc) ? second : first;
}

// Critical failures dominate, then Major, then Minor -- so a correction that
// trades one Critical for three Minors is still an improvement.
function failureWeight(qc) {
  const w = { Critical: 100, Major: 10, Minor: 1 };
  return qc.checks.filter(c => !c.pass).reduce((n, c) => n + (w[c.severity] || 1), 0);
}

module.exports = { generateCbhL3, systemPrompt, userPrompt, sectionBrief, correctionFrom, failureWeight, CORRECTABLE };
