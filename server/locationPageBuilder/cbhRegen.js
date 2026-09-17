// ── Regenerate ONE field ────────────────────────────────────────────────────
// Every editable field in the brief and in the page editor has a regenerate
// button, and they all come here. The reviewer's problem is almost never "redo
// the page" -- it is "this one sentence isn't right" -- and regenerating the
// whole page to fix a meta description throws away eight sections of accepted
// copy and costs a full write.
//
// Two rules hold for every field:
//   1. The limit comes from the contract, so a regenerated value is judged by
//      the same numbers as a written one. A field that regenerates outside its
//      own gate is worse than no button.
//   2. The new value must DIFFER from the current one. "Regenerate" that hands
//      back the same sentence reads as a broken button.

const config = require('./config');
const contract = require('./cbhContract');
const compose = require('./compose');
const cbhCompose = require('./cbhCompose');
const { createLlmClient } = require('../services/llmProviders');
const { chatParams } = require('./llmParams');
const { servicePhraseDisplay } = require('./keywordRelevance');

const { LIMITS: L } = contract;

// ── Field registry ──────────────────────────────────────────────────────────
// `kind` is how the value comes back: a single string, or a list (paragraphs,
// or the lines under an H3). `indexed` fields address one item in a list.
// `limit` is { min?, max } in characters, measured the way the gates measure.
const FIELDS = {
  // ── Page ────────────────────────────────────────────────────────────────
  'meta.title': {
    scope: 'page', kind: 'text', limit: L.metaTitle,
    label: 'meta title',
    ask: () => `Write a fresh meta title. Do NOT include "${contract.TITLE_SUFFIX.trim()}" — it is appended automatically
and is not counted. Include the primary keyword or a close variant. Natural and readable.`,
  },
  'meta.metaDescription': {
    scope: 'page', kind: 'text', limit: L.metaDescription,
    label: 'meta description',
    ask: () => `Write a fresh meta description. Every word of the primary keyword must appear, in any order.
End on a mental-health call to action ("Get support", "Explore treatment options", "Schedule a consultation").`,
  },
  'hero.h1': {
    heading: true, scope: 'page', kind: 'text', limit: { max: L.hero.h1MaxChars },
    label: 'H1',
    ask: (ctx) => `Write a fresh H1. It must contain the primary keyword and "${ctx.city}". Engaging and
service-focused, not a bare label.`,
  },
  'hero.description': {
    scope: 'page', kind: 'text', limit: { max: L.hero.descriptionMaxChars },
    label: 'hero description',
    ask: () => `Write a fresh hero description. Use the primary keyword or a close variation naturally, state the
benefit of the service, and add a call to action where it fits.`,
  },
  'approach.paragraphs': {
    scope: 'page', kind: 'lines', limit: { max: L.approach.paragraphMaxChars },
    count: L.approach.paragraphsPerBlock, label: 'approach body',
    ask: (ctx) => `Rewrite the body under "${ctx.page.sections.approach.heading}". Specific to this service, not copy
that would fit any page.`,
  },
  'approach.philosophy': {
    scope: 'page', kind: 'lines', limit: { max: L.approach.paragraphMaxChars },
    count: L.approach.paragraphsPerBlock, label: 'philosophy body',
    ask: () => `Rewrite the body under "${contract.FIXED_HEADINGS.approachPhilosophy}". How care is approached here,
specific to this service.`,
  },
  'approach.therapies': {
    scope: 'page', kind: 'lines', limit: { max: L.approach.paragraphMaxChars },
    count: L.approach.paragraphsPerBlock, label: 'therapies body',
    ask: () => `Rewrite the body under "${contract.FIXED_HEADINGS.approachTherapies}". Name the actual approaches used
for this service. No invented credentials.`,
  },
  'insurance.paragraph': {
    scope: 'page', kind: 'text', limit: { max: L.insurance.maxChars },
    label: 'insurance paragraph',
    ask: () => `Rewrite the insurance paragraph. It MUST say "most major insurance providers" and claim nothing
beyond that — never name a plan as covered, never promise a cost. Build a DIFFERENT sentence around that
required phrase: do not open with the practice name and close on the same "accessible and affordable" clause.`,
  },
  'educational.paragraphs': {
    scope: 'page', kind: 'lines', limit: { max: L.educational.introMaxChars },
    count: L.educational.introParagraphs, label: 'educational intro',
    ask: (ctx) => `Rewrite the intro under "${ctx.page.sections.educational.heading}". ${L.educational.introMaxChars} characters TOTAL across
all paragraphs.`,
  },
  'educational.h3.heading': {
    heading: true, scope: 'page', kind: 'text', indexed: true, limit: { max: L.educational.h3HeadingMaxChars },
    label: 'H3 heading',
    ask: (ctx) => `Write a fresh heading for this subsection. It must still describe the same content, and must not
duplicate any other heading in the section: ${ctx.siblings.join(' | ')}`,
  },
  'educational.h3.lines': {
    scope: 'page', kind: 'lines', indexed: true, limit: { max: L.educational.lineMaxChars },
    label: 'H3 body',
    ask: (ctx) => `Rewrite the body under "${ctx.item.heading}". Return each line as its own array entry; one line is at
most ${L.educational.lineMaxChars} characters, and a longer one wraps to another line. At most ${ctx.lineAllowance} lines.
Mix the two forms: a paragraph is 2-4 sentences in ONE entry, a bullet starts with "- " and costs
${1 + L.educational.bulletExtraLines} line${L.educational.bulletExtraLines ? 's' : ''}. Lead with a paragraph and bullet only what genuinely enumerates — do not
return a list of one-sentence entries. An entry may open with a bold sub-label written "**Like this**",
which is the only markup allowed. Use fewer lines if the content does not earn them.${ctx.sourceBlock}`,
  },
  // ONE line inside an H3 body. The body as a whole has its own button; this
  // is for the common case of a single line reading badly while the rest of
  // the section is fine. It rewrites in place, so the body's line count is
  // unchanged and its cap cannot be breached by a rewrite.
  'educational.h3.line': {
    scope: 'page', kind: 'text', indexed: true, limit: { max: L.educational.lineMaxChars },
    label: 'line',
    ask: (ctx) => `Rewrite this ONE entry under "${ctx.item.heading}". Keep its form: if it starts with "- " it
stays a bullet of that shape, if it opens with a bold label written "**Like this**" it keeps a label,
and otherwise it stays prose of about the same length. It must not repeat
what the other entries here already say:
${ctx.siblings.map(x => `- ${x}`).join('\n')}${ctx.sourceBlock}`,
  },
  'uvp.paragraph': {
    scope: 'page', kind: 'text', limit: { max: L.uvp.maxChars },
    label: 'Why Choose paragraph',
    ask: (ctx) => `Rewrite the "${contract.FIXED_HEADINGS.uvp}" paragraph. The heading names neither the service nor the
city, so this paragraph must name both. Say something true of THIS care specifically — "individualized
treatment planning, a dedicated clinical team, flexible scheduling" is true of every service here and
therefore tells the reader nothing. Do not open with "${contract.BRAND} offers" or "${contract.BRAND} provides".`,
  },
  'service.paragraph': {
    scope: 'page', kind: 'text', limit: { max: L.service.maxChars },
    label: 'service paragraph',
    ask: (ctx) => `Rewrite the paragraph under "${ctx.page.sections.service.heading}". Natural, specific to the service
and the location.`,
  },
  'treatment.heading': {
    heading: true, scope: 'page', kind: 'text', limit: { max: L.treatment.headingMaxChars },
    label: 'Treatment H2',
    ask: (ctx) => `Write a fresh H2 for the treatment section. Name the team, the service and the city — "Our ADHD
treatment experts in El Monte" is the shape. Not a slogan, not a sentence, not a question. It must not
repeat the wording of "${ctx.page.sections.service.heading}", which sits directly above it.`,
  },
  'treatment.paragraph': {
    scope: 'page', kind: 'text', limit: { max: L.treatment.maxChars },
    label: 'Treatment paragraph',
    ask: (ctx) => `Rewrite the paragraph under "${ctx.page.sections.treatment.heading || 'the treatment H2'}". It is about the
CLINICIANS — their experience and how they treat people. Do not name a qualification, a licence, a
school, a headcount or a number of years, and promise no outcome.`,
  },
  'faq.q': {
    heading: true, scope: 'page', kind: 'text', indexed: true, limit: { max: 140 },
    label: 'FAQ question',
    ask: (ctx) => `Write a fresh question of type "${ctx.item.type || 'intent'}". It must be specific to this service — a
question that would read the same on a page about a different condition is filler. It must not duplicate
any other question on the page: ${ctx.siblings.join(' | ')}`,
  },
  'faq.a': {
    scope: 'page', kind: 'text', indexed: true, limit: { max: L.faqs.answerMaxChars },
    label: 'FAQ answer',
    ask: (ctx) => `Rewrite the answer to: "${ctx.item.q}". Answer it directly and usefully. Invent no specifics about
hours, prices, staff or wait times.`,
  },

  // ── Brief ───────────────────────────────────────────────────────────────
  'brief.meta.title': {
    scope: 'brief', kind: 'text', limit: L.metaTitle, label: 'meta title',
    ask: () => `Write a fresh meta title. Do NOT include "${contract.TITLE_SUFFIX.trim()}". Include the primary keyword
or a close variant.`,
  },
  'brief.meta.description': {
    scope: 'brief', kind: 'text', limit: L.metaDescription, label: 'meta description',
    ask: () => `Write a fresh meta description. Every word of the primary keyword must appear, in any order, and it
must end on a mental-health call to action.`,
  },
  'brief.h3.heading': {
    heading: true, scope: 'brief', kind: 'text', indexed: true, limit: { max: L.educational.h3HeadingMaxChars },
    label: 'H3 heading',
    ask: (ctx) => `Write a fresh heading for this subsection, covering the same ground. It must not duplicate any
other heading in the plan: ${ctx.siblings.join(' | ')}`,
  },
  'brief.h3.intent': {
    scope: 'brief', kind: 'text', indexed: true, limit: { max: 200 },
    label: 'section intent',
    ask: (ctx) => `Write a fresh one-sentence instruction for what the subsection "${ctx.item.heading}" must cover.
This is the brief the writer follows, so be concrete.`,
  },
  'brief.faq.q': {
    heading: true, scope: 'brief', kind: 'text', indexed: true, limit: { max: 140 },
    label: 'FAQ question',
    ask: (ctx) => `Write a fresh question of type "${ctx.item.type || 'intent'}", specific to this service. It must not
duplicate any other question in the plan: ${ctx.siblings.join(' | ')}`,
  },
};

// ── Reading and writing the addressed field ────────────────────────────────
function readField(field, { page, brief, index, lineIndex }) {
  const s = page?.sections;
  switch (field) {
    case 'meta.title': return page.meta.title;
    case 'meta.metaDescription': return page.meta.metaDescription;
    case 'hero.h1': return s.hero.h1;
    case 'hero.description': return s.hero.description;
    case 'approach.paragraphs': return s.approach.paragraphs;
    case 'approach.philosophy': return s.approach.philosophy.paragraphs;
    case 'approach.therapies': return s.approach.therapies.paragraphs;
    case 'insurance.paragraph': return s.insurance.paragraph;
    case 'educational.paragraphs': return s.educational.paragraphs;
    case 'educational.h3.heading': return s.educational.h3s[index]?.heading;
    case 'educational.h3.lines': return s.educational.h3s[index]?.lines;
    case 'educational.h3.line': return s.educational.h3s[index]?.lines?.[lineIndex];
    case 'uvp.paragraph': return s.uvp.paragraph;
    case 'service.paragraph': return s.service.paragraph;
    case 'treatment.heading': return s.treatment.heading;
    case 'treatment.paragraph': return s.treatment.paragraph;
    case 'faq.q': return s.faq.items[index]?.q;
    case 'faq.a': return s.faq.items[index]?.a;
    case 'brief.meta.title': return brief.meta.title;
    case 'brief.meta.description': return brief.meta.description;
    case 'brief.h3.heading': return brief.educational.h3s[index]?.heading;
    case 'brief.h3.intent': return brief.educational.h3s[index]?.intent;
    case 'brief.faq.q': return brief.faqs[index]?.q;
    default: return undefined;
  }
}

// The item an indexed field belongs to, and its siblings -- both are what let
// the prompt say "do not duplicate any of these".
function fieldContext(field, { page, brief, index, lineIndex }) {
  const s = page?.sections;
  if (field.startsWith('brief.h3')) {
    return { item: brief.educational.h3s[index] || {}, siblings: brief.educational.h3s.map(h => h.heading) };
  }
  if (field === 'brief.faq.q') {
    return { item: brief.faqs[index] || {}, siblings: brief.faqs.map(f => f.q) };
  }
  if (field === 'educational.h3.line') {
    const h3 = s.educational.h3s[index] || {};
    // Siblings are the OTHER lines in this body -- that is what "do not repeat"
    // has to mean here, not the other headings.
    return { item: h3, siblings: (h3.lines || []).filter((_, i) => i !== lineIndex) };
  }
  if (field.startsWith('educational.h3')) {
    return { item: s.educational.h3s[index] || {}, siblings: s.educational.h3s.map(h => h.heading) };
  }
  if (field.startsWith('faq.')) {
    return { item: s.faq.items[index] || {}, siblings: s.faq.items.map(f => f.q) };
  }
  return { item: {}, siblings: [] };
}

// How many lines of writing a regenerated H3 body may take: the allowance every
// body gets, which scales with how many H3s the section has, less the mandatory
// breaks that allowance has to cover. Bodies do not share, so what the rest of
// the section spends is irrelevant.
function lineAllowanceFor(page) {
  const h3s = page?.sections?.educational?.h3s || [];
  return contract.contentAllowance(contract.linesPerBody(h3s.length));
}

function withinLimit(value, limit) {
  if (!limit) return true;
  const n = contract.textLength(value);
  if (limit.max && n > limit.max) return false;
  if (limit.min && n < limit.min) return false;
  return true;
}

function describeLimit(limit) {
  if (!limit) return '';
  return limit.min ? `${limit.min}-${limit.max} characters` : `at most ${limit.max} characters`;
}

async function regenerateField({ clientId, serviceId, locationId, page, brief, field, index, lineIndex }) {
  const cfg = FIELDS[field];
  if (!cfg) throw new Error(`Unknown field: "${field}".`);
  if (cfg.scope === 'page' && !page) throw new Error('page is required for this field.');
  if (cfg.scope === 'brief' && !brief) throw new Error('brief is required for this field.');

  const layers = await compose.loadLayers({ clientId, serviceId, locationId });
  const scaffold = cbhCompose.buildCbhScaffold(layers, { servicePhrase: servicePhraseDisplay });
  const city = layers.location.city;
  const serviceName = scaffold.serviceName;
  const primaryKeyword = page?.primaryKeyword || brief?.primaryKeyword || '';
  const current = readField(field, { page, brief, index, lineIndex });
  const { item, siblings } = fieldContext(field, { page, brief, index, lineIndex });

  const lineAllowance = field === 'educational.h3.lines' ? lineAllowanceFor(page) : null;
  // A fallback section is cited to a named authority, so a rewrite of its body
  // has to come from that source too -- otherwise regenerating quietly turns a
  // sourced section into an unsourced one while the citation stays on the page.
  const sourceBlock = (field.startsWith('educational.h3.line') && item.source === 'fallback' && item.sourceExcerpt)
    ? `\nWRITE IT FROM THIS SOURCE, using only what it states and rewriting in plain language:\n${item.sourceExcerpt}`
    : '';

  const ctx = { page, brief, city, serviceName, item, siblings, lineAllowance, sourceBlock };
  const isList = cfg.kind === 'lines';

  const system = `You are an expert local-SEO content writer for ${contract.BRAND}, a behavioral health provider in California.
You are rewriting ONE field on an existing page. Everything else stays as it is.

- Do NOT invent addresses, phone numbers, hours, prices, clinician names, credentials or review counts.
- Health content: no guaranteed outcomes, no success rates, no promise of recovery.
- A keyword is a search query, not a phrase to paste. Put a preposition between the service and the city.
- THE LENGTH IS HARD. Count before answering.

Return ONLY JSON: ${isList ? '{ "lines": ["string", ...] }' : '{ "value": "string" }'}`;

  const buildUser = (correction) => `PAGE: ${serviceName} in ${city}, California
Primary keyword: ${primaryKeyword}

FIELD: ${cfg.label}
LIMIT: ${describeLimit(cfg.limit)}${isList && cfg.count ? `, ${cfg.count.min}-${cfg.count.max} entries, each within that limit` : ''}${isList && lineAllowance ? `, at most ${lineAllowance} entries` : ''}

CURRENT VALUE (your rewrite MUST differ from this):
${Array.isArray(current) ? (current || []).map(x => `- ${x}`).join('\n') : (current || '(empty)')}

${cfg.ask(ctx)}
${correction || ''}
Return JSON only.`;

  const llm = createLlmClient(config.llm.cbhWriterModel);
  const attempt = async (correction) => {
    const completion = await llm.chat.completions.create({
      model: llm.model,
      // One short field, but the same reasoning-overhead risk as the full
      // writer: too tight a cap returns finish_reason "length" and no content.
      ...chatParams(llm.model, { maxTokens: 4000 }),
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: buildUser(correction) }],
    });
    try {
      const raw = JSON.parse(completion.choices[0].message.content);
      if (isList) {
        const lines = (Array.isArray(raw.lines) ? raw.lines : []).map(x => String(x || '').trim()).filter(Boolean);
        return lines.length ? lines : null;
      }
      const v = String(raw.value || '').replace(/\s+/g, ' ').trim();
      return v || null;
    } catch { return null; }
  };

  let value = await attempt(null);
  if (!value) throw new Error(`Could not regenerate the ${cfg.label}.`);

  // One bounded correction, against the SAME limit the gate uses.
  const bad = isList
    ? value.filter(v => !withinLimit(v, cfg.limit))
    : (withinLimit(value, cfg.limit) ? [] : [value]);
  if (bad.length) {
    const measured = bad.map(v => `"${String(v).slice(0, 40)}…" is ${contract.textLength(v)} characters`).join('; ');
    const fixed = await attempt(`\nCORRECTION — the previous attempt broke the limit: ${measured}. It must be ${describeLimit(cfg.limit)}.`);
    if (fixed) value = fixed;
  }

  // Headings are cased the way every other heading on this page is. The model
  // writes headlines in title case whatever the prompt says, and a regenerated
  // field must not be the one that looks different.
  if (cfg.heading && typeof value === 'string') {
    value = contract.sentenceCase(value, contract.protectedTerms({
      serviceName: page?.serviceName, locationName: page?.locationName,
    }));
  }

  return { field, index: index ?? null, lineIndex: lineIndex ?? null, value, kind: cfg.kind };
}

module.exports = { regenerateField, FIELDS, readField, lineAllowanceFor, withinLimit };
