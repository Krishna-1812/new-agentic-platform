// ── Clear Behavioral Health content brief ───────────────────────────────────
// The reviewable step between approved keywords and generated copy, rebuilt
// around the CBH contract.
//
// Under this contract almost every heading is FIXED by the guidelines, so the
// brief is deliberately small. What is genuinely open is:
//   - the meta title and description
//   - the 4-5 educational H3 headings (and what each must cover)
//   - the FAQ questions and their type
// Everything else is a heading the guidelines dictate verbatim, and putting it
// in front of a reviewer as if it were editable would be a lie.
//
// The educational section is the one the guidelines require to be "fully based
// on competitor research", so each H3 carries where it came from --
// competitor or fallback -- and the reviewer sees that before approving.

const store = require('./store');
const config = require('./config');
const compose = require('./compose');
const contract = require('./cbhContract');
const cbhCompose = require('./cbhCompose');
const { briefId, tupleKey } = require('./brief');
const { researchCompetitors, ownDomainOf } = require('./competitorResearch');
const { servicePhraseDisplay } = require('./keywordRelevance');
const { attachFallbackSources } = require('./cbhFallbackSources');
const { createLlmClient } = require('../services/llmProviders');
const { chatParams } = require('./llmParams');

const { LIMITS: L, PROVENANCE } = contract;

// ── Shape ───────────────────────────────────────────────────────────────────
// Everything reaching the store or the writer passes through here, so a
// hand-edited brief cannot carry an H3 with no heading, more H3s than the
// contract allows, or an FAQ type the QC gate does not recognise.
function normalizeCbhBrief(brief = {}) {
  const str = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const validSource = new Set(Object.values(PROVENANCE));

  return {
    primaryKeyword: str(brief.primaryKeyword),
    primaryKeywords: (brief.primaryKeywords || []).map(str).filter(Boolean),
    secondaryKeywords: (brief.secondaryKeywords || []).map(str).filter(Boolean),

    meta: {
      // Stored WITHOUT the brand suffix, which is what the 50-60 window counts
      // and what the reviewer edits. compose appends the suffix on the page.
      title: contract.titleWithoutSuffix(str(brief.meta?.title)),
      description: str(brief.meta?.description),
    },

    educational: {
      h3s: (brief.educational?.h3s || [])
        .map(h => ({
          heading: str(h.heading),
          intent: str(h.intent),
          source: validSource.has(h.source) ? h.source : PROVENANCE.FALLBACK,
          sourceUrl: str(h.sourceUrl),
          // The text actually retrieved from that URL. Stored, because a
          // citation the writer never read is a claim of provenance the copy
          // does not have -- which is worse than no citation, since it looks
          // verified. The writer is given this and told to stay inside it.
          sourceExcerpt: str(h.sourceExcerpt).slice(0, 1200),
        }))
        .filter(h => h.heading)
        .slice(0, L.educational.h3Count.max),
    },

    faqs: (brief.faqs || [])
      .map(f => (typeof f === 'string' ? { q: f } : f))
      .map(f => ({
        q: str(f.q),
        type: L.faqs.types.includes(f.type) ? f.type : 'intent',
      }))
      .filter(f => f.q)
      .slice(0, L.faqs.count.max),
  };
}

// Measured the way the gates measure: rendered text, whitespace collapsed.
function withinRange(text, { min, max }) {
  const n = contract.textLength(text);
  return n >= min && n <= max;
}

// ── Persistence ─────────────────────────────────────────────────────────────
// Same table and the same deterministic id as the dental brief: one row per
// (client, service, location), so the two flows never collide and a client
// only ever has one brief per page.
async function getCbhBrief(tuple) {
  const byId = await store.get('briefs', briefId(tuple));
  if (byId) return byId;
  return store.findOne('briefs', { tuple_key: tupleKey(tuple) });
}

async function saveCbhBrief({ clientId, serviceId, locationId, brief, approved = false }) {
  const tuple = { clientId, serviceId, locationId };
  const id = briefId(tuple);
  const previous = await store.get('briefs', id);
  const record = {
    id,
    tuple_key: tupleKey(tuple),
    client_id: clientId, service_id: serviceId, location_id: locationId,
    // Tagged so a reader can tell which contract the stored brief belongs to
    // without inferring it from the client id.
    contract: 'cbh',
    brief: normalizeCbhBrief(brief),
    approved: !!approved,
    approved_at: approved ? store.nowIso() : (previous?.approved_at || null),
  };
  const saved = await store.upsertById('briefs', record, 'brf');
  try {
    const strays = await store.list('briefs', { tuple_key: record.tuple_key });
    for (const row of strays) if (row.id !== id) await store.remove('briefs', row.id);
  } catch (e) {
    console.error('[cbhBrief] Failed to clean duplicate briefs:', e.message);
  }
  return saved;
}

// ── Planning ────────────────────────────────────────────────────────────────
// Nav and CTA furniture a competitor scrape always returns. Filtered before
// the planner sees it, so the model is choosing between real content sections
// rather than being asked to ignore the chrome.
const BOILERPLATE_RE = /^(meet |our team|our (doctors|clinicians|staff|office|offices)|about us|contact|book |schedule an|schedule your|request |reviews?\b|testimonials|hours|directions|locations?\b|careers|blog|related |why choose|insurance we accept|follow us|sitemap|privacy|get in touch|call )/i;

function usableHeadings(headings = []) {
  const seen = new Set();
  return headings
    .map(h => String(h || '').replace(/\s+/g, ' ').trim())
    .filter((h) => {
      if (!h || h.length > 90 || h.split(' ').length < 2) return false;
      if (BOILERPLATE_RE.test(h)) return false;
      const k = h.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

function usableQuestion(q) {
  const s = String(q || '').replace(/\s+/g, ' ').trim();
  if (s.length < 12 || s.length > 140 || !s.includes('?')) return false;
  return /^(what|how|why|when|where|who|which|can|do|does|did|is|are|will|would|should|am|if)\b/i.test(s);
}

function planPrompt({ serviceName, city, primaryKeyword, competitorHeadings, competitorFaqs }) {
  const system = `You plan the content brief for one Location + Service page for ${contract.BRAND}, a behavioral health provider in California. You do NOT write the page.

Return ONLY JSON, no prose, no markdown fences:
{
  "metaTitle": "string",
  "metaDescription": "string",
  "h3s": [{ "heading": "string", "intent": "string", "source": "competitor | fallback" }],
  "faqs": [{ "q": "string", "type": "location | brand | intent" }]
}

RULES
- "h3s": EXACTLY ${L.educational.h3Count.min}-${L.educational.h3Count.max} headings, each at most ${L.educational.h3HeadingMaxChars} characters. These are the subsections of a single
  "What is ..." section, so they must together answer what this care is, who it suits, what it
  involves and how to start.
- The educational section must be based on competitor research. Take a heading from the competitor
  list wherever one covers a real topic, rewrite it in plain language, and mark it "competitor".
  Only where the competitors leave a genuine gap, propose the missing heading and mark it
  "fallback" — that section will be written from an authoritative clinical source, not invented.
- "intent": one sentence on what that subsection must cover. This is the instruction the writer
  follows, so be concrete.
- "metaTitle": ${L.metaTitle.min}-${L.metaTitle.max} characters, EXCLUDING the brand suffix, which is added later and must not
  appear. Include "${primaryKeyword}" or a close variant. Natural, never keyword-stuffed.
- "metaDescription": ${L.metaDescription.min}-${L.metaDescription.max} characters. Every word of the primary keyword must appear, in any
  order. End on a call to action such as "Get support" or "Schedule a consultation".
- "faqs": ${L.faqs.count.min}-${L.faqs.count.max} questions. Aim for ${L.faqs.count.max - 1}-${L.faqs.count.max}; return only ${L.faqs.count.min} when there genuinely is
  nothing further worth asking. A mix of types:
    location: answerable only for this office (being seen quickly, evening hours, booking here)
    brand:    about ${contract.BRAND} specifically (insurance, how care is delivered)
    intent:   what a person researching this care actually asks (how long, what happens, who it suits)
  Include at least one of each. Never force a keyword into a question.
- EVERY question must be SPECIFIC TO ${serviceName}. A question that would read word-for-word the
  same on a page about a different condition is not doing any work — "How long does treatment take?"
  is filler, "How long before ADHD medication is adjusted to the right dose?" is a real question.
  Name the condition, the therapy, or the thing people actually worry about with THIS care.
  This applies to the location and brand questions too: ask what someone seeking ${serviceName}
  in ${city} specifically needs to know.`;

  const user = `PAGE: ${serviceName} in ${city}, California
Primary keyword: ${primaryKeyword}

COMPETITOR HEADINGS (real sections ranking pages use for this keyword):
${competitorHeadings.length ? competitorHeadings.map(h => `- ${h}`).join('\n') : '(none found)'}

COMPETITOR FAQ QUESTIONS:
${competitorFaqs.length ? competitorFaqs.map(f => `- ${f}`).join('\n') : '(none found)'}

Return JSON only.`;

  return { system, user };
}

// The brief a page gets when the planner cannot run (no API key, or two
// unusable responses). Pure code, no model: every heading is marked fallback,
// because none of it came from competitor research.
function fallbackPlan({ serviceName, city }) {
  // NOT lowercased. The service name arrives display-cased and lowercasing it
  // turns "ADHD treatment" into "adhd treatment" in a question a reader sees --
  // the same acronym corruption that had to be fixed in the headings.
  const svc = String(serviceName || 'this care').trim();
  return {
    metaTitle: '',
    metaDescription: '',
    h3s: [
      { heading: 'Signs you may need support', intent: `What prompts people to seek ${serviceName.toLowerCase()}.`, source: PROVENANCE.FALLBACK },
      { heading: 'Treatment options available', intent: 'The forms of care offered and how they differ.', source: PROVENANCE.FALLBACK },
      { heading: 'What to expect at your first visit', intent: 'The assessment and how a plan is agreed.', source: PROVENANCE.FALLBACK },
      { heading: 'How to get started', intent: 'Booking, benefit checks and what happens next.', source: PROVENANCE.FALLBACK },
    ],
    // Named after the SERVICE, not a fixed template. The previous set was five
    // constants, so every page that fell back to this plan shipped the same
    // five questions verbatim -- which is exactly what turned up when the four
    // Anaheim Hills pages were compared side by side.
    faqs: [
      { q: `How soon can I start ${svc} in ${city}?`, type: 'location' },
      { q: `Is ${svc} at your ${city} location offered in person, online, or both?`, type: 'location' },
      { q: `Does ${contract.BRAND} take insurance for ${svc}?`, type: 'brand' },
      { q: `Who on the ${contract.BRAND} team provides ${svc}?`, type: 'brand' },
      { q: `How long does ${svc} usually take to help?`, type: 'intent' },
      { q: `What happens in a first ${svc} appointment?`, type: 'intent' },
    ],
  };
}

async function plan({ serviceName, city, primaryKeyword, competitorHeadings, competitorFaqs }) {
  const cacheK = store.cacheKey('cbh-brief-plan-v1', serviceName, city, primaryKeyword,
    competitorHeadings.slice().sort(), competitorFaqs.slice().sort());
  try {
    const cached = await store.cacheGet(cacheK, config.cache.llmTtlMs);
    if (cached) return cached;
  } catch { /* recompute */ }

  const { system, user } = planPrompt({ serviceName, city, primaryKeyword, competitorHeadings, competitorFaqs });
  let parsed = null;
  try {
    const llm = createLlmClient(config.llm.dentalOutlineModel);
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      const completion = await llm.chat.completions.create({
        model: llm.model,
        // Budget generously. The PLAN is small -- five headings, a title, a
        // description and seven questions, well under 800 tokens -- so almost
        // all of this is reasoning headroom, and the prompt asks the model to
        // weigh twenty competitor headings against a contract.
        //
        // At 3,000 it spent the entire budget reasoning and returned
        // finish_reason "length" with ZERO characters, on every page. The
        // failure was invisible: plan() caught it and degraded to the
        // code-side plan, so pages came out looking fine while none of the
        // educational section was actually based on competitor research --
        // which is the one thing the guidelines require it to be.
        ...chatParams(llm.model, { maxTokens: 12000 }),
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      });
      try {
        const raw = JSON.parse(completion.choices[0].message.content);
        if (raw && Array.isArray(raw.h3s) && raw.h3s.length) parsed = raw;
      } catch { /* retry once */ }
    }
  } catch (e) {
    console.error('[cbhBrief] planner failed, using the code-side plan:', e.message);
    return fallbackPlan({ serviceName, city });
  }
  if (!parsed) {
    // Loud on purpose. A silent degrade here produces a page that passes every
    // gate while quietly ignoring the competitor research it is meant to be
    // built from.
    console.error(`[cbhBrief] planner returned no usable plan for "${serviceName}" in ${city}; `
      + 'falling back to the code-side plan, so NO section will be competitor-backed.');
    return fallbackPlan({ serviceName, city });
  }

  try { await store.cacheSet(cacheK, parsed, { kind: 'llm', ttlMs: config.cache.llmTtlMs }); } catch { /* non-fatal */ }
  return parsed;
}

// Builds a fresh brief. Billed: a SERP + competitor scrape (cached 7 days) and
// one planning call (cached 30 days).
async function buildCbhBrief({ clientId, serviceId, locationId, primaryKeywords, secondaryKeywords }) {
  const primaries = (primaryKeywords || []).filter(Boolean);
  if (!primaries.length) throw new Error('At least one primary keyword is required to build a brief.');
  const primaryKeyword = primaries[0];
  const mergedSecondary = [...primaries.slice(1), ...(secondaryKeywords || [])];

  const layers = await compose.loadLayers({ clientId, serviceId, locationId });
  const { client, location } = layers;
  const scaffold = cbhCompose.buildCbhScaffold(layers, { servicePhrase: servicePhraseDisplay });

  const research = await researchCompetitors(primaryKeyword, {
    ownDomain: ownDomainOf(client), clientId,
  });

  const planned = await plan({
    serviceName: scaffold.serviceName,
    city: location.city,
    primaryKeyword,
    competitorHeadings: usableHeadings(research.headings),
    competitorFaqs: (research.faqs || []).filter(usableQuestion),
  });

  // Any subsection the competitors did not cover is written from a named
  // clinical authority, not from the model's own recall -- the guidelines
  // allow authoritative sources to fill gaps but forbid inventing anything.
  // Each one gets a real URL attached here; QC fails any that does not.
  const sourced = await attachFallbackSources({
    h3s: normalizeCbhBrief({ educational: { h3s: planned.h3s } }).educational.h3s,
    serviceName: scaffold.serviceName,
  });

  return normalizeCbhBrief({
    primaryKeyword,
    primaryKeywords: primaries,
    secondaryKeywords: mergedSecondary,
    // The planner's meta is a PROPOSAL, and it is kept only if it satisfies the
    // contract. An out-of-range value here is not harmless: the brief's meta
    // overrides the writer's output AFTER the correction pass has run, so a
    // 41-character title proposed by the planner silently replaced a compliant
    // one and no longer had any way of being fixed. Left empty, the writer
    // produces the meta and the correction pass covers it -- which is exactly
    // how the pages with no proposed meta came out passing.
    //
    // A value the REVIEWER types still wins unconditionally; the wizard shows
    // them a live counter, so that is an informed choice rather than a silent one.
    meta: {
      title: withinRange(planned.metaTitle, L.metaTitle) ? planned.metaTitle : '',
      description: withinRange(planned.metaDescription, L.metaDescription) ? planned.metaDescription : '',
    },
    educational: {
      // Attach the retrieved text to the section it was retrieved for. Without
      // this the lookup is paid for, cited, and then thrown away.
      h3s: sourced.h3s.map(h => ({ ...h, sourceExcerpt: sourced.excerpts[h.heading] || '' })),
    },
    faqs: planned.faqs,
  });
}

module.exports = {
  withinRange,
  buildCbhBrief, getCbhBrief, saveCbhBrief, normalizeCbhBrief,
  plan, fallbackPlan, planPrompt, usableHeadings, usableQuestion,
};
