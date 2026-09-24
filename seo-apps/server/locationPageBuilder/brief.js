// ── The editable content brief ──────────────────────────────────────────────
// Sits between keyword approval and content generation. Until now everything
// the writer is told — the H2 stack, which FAQs to answer, what the title and
// description should say — was decided inside the generate call and never
// shown: the SEO team approved keywords and the next thing they saw was
// finished copy. The brief makes that decision visible, editable and
// reviewable BEFORE any copy is written.
//
// Two halves, deliberately separate:
//   buildBrief   — researches and drafts a brief (billed: SERP + scrape + LLM)
//   saveBrief    — persists whatever the reviewer edited it into
// A generate call then reads the SAVED brief, so what ships is what was
// approved, not a fresh draft the reviewer never saw.
//
// The brief is NOT a suggestion the writer may reinterpret. generateFromBrief
// passes its outline through as the fixed outline contract contentGenerator
// already enforces, and its FAQ questions as the exact questions to answer.

const crypto = require('crypto');
const store = require('./store');
const config = require('./config');
const compose = require('./compose');
const dentalOutline = require('./dentalOutline');
const { researchCompetitors, ownDomainOf } = require('./competitorResearch');

// ── Persistence ─────────────────────────────────────────────────────────────
// Same scheme as the keyword selections it follows in the flow: one row per
// (client, service, location), addressed by an id that is a pure function of
// the tuple so concurrent writers converge on one row instead of racing to
// insert duplicates.
function tupleKey({ clientId, serviceId, locationId }) {
  return `${clientId}|${serviceId}|${locationId}`;
}

function briefId(tuple) {
  return `brf_${crypto.createHash('sha1').update(tupleKey(tuple)).digest('hex').slice(0, 16)}`;
}

async function getBrief({ clientId, serviceId, locationId }) {
  const tuple = { clientId, serviceId, locationId };
  const byId = await store.get('briefs', briefId(tuple));
  if (byId) return byId;
  return store.findOne('briefs', { tuple_key: tupleKey(tuple) });
}

async function saveBrief({ clientId, serviceId, locationId, brief, approved = false }) {
  const tuple = { clientId, serviceId, locationId };
  const id = briefId(tuple);
  const previous = await store.get('briefs', id);
  const record = {
    id,
    tuple_key: tupleKey(tuple),
    client_id: clientId, service_id: serviceId, location_id: locationId,
    brief: normalizeBrief(brief),
    approved: !!approved,
    // The moment of the FIRST approval survives later edits, matching how
    // keyword selections treat approved_at.
    approved_at: approved ? store.nowIso() : (previous?.approved_at || null),
  };
  const saved = await store.upsertById('briefs', record, 'brf');

  // Self-heal any row left under a non-deterministic id. Best-effort — a
  // cleanup failure must never lose the brief the reviewer just saved.
  try {
    const strays = await store.list('briefs', { tuple_key: record.tuple_key });
    for (const row of strays) {
      if (row.id !== id) await store.remove('briefs', row.id);
    }
  } catch (e) {
    console.error('[brief] Failed to clean duplicate briefs:', e.message);
  }
  return saved;
}

// ── Shape ───────────────────────────────────────────────────────────────────
// Everything that reaches the store or the writer goes through here, so a
// hand-edited brief arriving from the client cannot carry a block with no
// heading, a paragraph count outside what QC accepts, or a stray field.
function normalizeBrief(brief = {}) {
  const d = config.dental;
  const clamp = (n, min, max, fallback) => {
    const v = Number(n);
    return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
  };
  const str = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

  const blocks = (brief.outline?.blocks || [])
    .map(b => ({
      h2: str(b.h2),
      // `source` is provenance for the review screen (competitor | fallback |
      // blend | brand), not something the reviewer sets. An edited heading
      // keeps its origin tag; a newly added one has none.
      source: ['competitor', 'fallback', 'blend', 'brand'].includes(b.source) ? b.source : null,
      intent: str(b.intent),
      paragraphs: clamp(b.paragraphs, d.paragraphsPerBlock.min, d.paragraphsPerBlock.max, 2),
      localize: !!b.localize,
    }))
    .filter(b => b.h2);

  return {
    primaryKeyword: str(brief.primaryKeyword),
    primaryKeywords: (brief.primaryKeywords || []).map(str).filter(Boolean),
    secondaryKeywords: (brief.secondaryKeywords || []).map(str).filter(Boolean),
    meta: {
      // Prefilled from the page template and editable. An empty description
      // means "writer, draft one" — a filled one is used verbatim.
      title: str(brief.meta?.title),
      description: str(brief.meta?.description),
      h1: str(brief.meta?.h1),
    },
    outline: {
      competitorQuality: ['good', 'partial', 'poor', 'unavailable']
        .includes(brief.outline?.competitorQuality) ? brief.outline.competitorQuality : 'unavailable',
      rationale: str(brief.outline?.rationale),
      blocks,
    },
    // The exact questions the page will answer, in order. Sourced from what
    // competitors actually answer, then edited.
    faqs: (brief.faqs || [])
      .map(f => (typeof f === 'string' ? { q: f, source: 'drafted' } : f))
      .map(f => ({
        q: str(f.q),
        source: ['competitor', 'drafted'].includes(f.source) ? f.source : 'drafted',
      }))
      .filter(f => f.q)
      .slice(0, d.faqs.max),
    // Clamped to what QC actually accepts, not to an arbitrary range: a
    // reviewer must not be able to set a target the body_word_count gate will
    // then fail the page for. min/max are also ordered, so a hand-edited
    // inversion can't instruct the writer to land above its own ceiling.
    wordTarget: orderedWordTarget(
      clamp(brief.wordTarget?.min, d.pageWords.acceptMin, d.pageWords.acceptMax, d.pageWords.targetMin),
      clamp(brief.wordTarget?.max, d.pageWords.acceptMin, d.pageWords.acceptMax, d.pageWords.targetMax),
    ),
  };
}

function orderedWordTarget(min, max) {
  return min <= max ? { min, max } : { min: max, max: min };
}

// ── Drafting ────────────────────────────────────────────────────────────────
// A question is only worth putting in front of a reviewer if it reads like
// something a person asks. Competitor scrapes return plenty that don't:
// nav labels, section headings ending in no question mark, cookie banners.
function usableQuestion(q) {
  const s = String(q || '').replace(/\s+/g, ' ').trim();
  if (s.length < 12 || s.length > 140) return false;
  if (!s.includes('?')) return false;
  return /^(what|how|why|when|where|who|which|can|do|does|did|is|are|will|would|should|am|if)\b/i.test(s);
}

// The fallback question set, used when competitors yield too few. Deliberately
// about access and logistics rather than clinical detail: those are the
// questions a location page is uniquely placed to answer, and they are true
// for any service without inventing anything clinical.
function fallbackQuestions({ service, city }) {
  const name = service?.name || 'this service';
  const where = city || 'this location';
  return [
    `What is ${name}?`,
    `Who is a good candidate for ${name}?`,
    `What should I expect at my first ${name} appointment in ${where}?`,
    `How soon can I be seen for ${name} in ${where}?`,
    `Does insurance cover ${name}?`,
    `How do I book ${name} at your ${where} location?`,
    `How long does ${name} take?`,
    `What happens after ${name}?`,
  ];
}

function draftFaqs({ competitorFaqs, service, city }) {
  const seen = new Set();
  const out = [];
  const add = (q, source) => {
    const key = q.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (!key || seen.has(key) || out.length >= config.dental.faqs.max) return;
    seen.add(key);
    out.push({ q, source });
  };
  (competitorFaqs || []).filter(usableQuestion).forEach(q => add(q.trim(), 'competitor'));
  // Top up to the MINIMUM only. The reviewer adds more if they want them —
  // padding to the maximum with generic questions buries the real ones.
  fallbackQuestions({ service, city }).forEach((q) => {
    if (out.length < config.dental.faqs.min) add(q, 'drafted');
  });
  return out;
}

// Builds a fresh brief. Billed: a SERP + scrape (cached 7 days) and the
// outline planner's LLM call (cached 30 days), so re-entering the step is
// cheap — it is the FIRST run for a tuple that costs.
//
// `primaryKeywords` / `secondaryKeywords` come from the approved keyword step.
async function buildBrief({ clientId, serviceId, locationId, primaryKeywords, secondaryKeywords }) {
  const primaries = (primaryKeywords || []).filter(Boolean);
  if (!primaries.length) throw new Error('At least one primary keyword is required to build a brief.');
  const primaryKeyword = primaries[0];
  const mergedSecondary = [...primaries.slice(1), ...(secondaryKeywords || [])];

  const layers = await compose.loadLayers({ clientId, serviceId, locationId });
  const { client, service, location } = layers;

  const scaffold = compose.buildDentalScaffold(layers);
  const brandName = scaffold.meta.brandName;

  const { headings: competitorHeadings, faqs: competitorFaqs } =
    await researchCompetitors(primaryKeyword, { ownDomain: ownDomainOf(client), clientId });

  const outline = await dentalOutline.planDentalOutline({
    service, location, primaryKeyword, secondaryKeywords: mergedSecondary,
    competitorHeadings, competitorFaqs, brandName,
  });

  return normalizeBrief({
    primaryKeyword,
    primaryKeywords: primaries,
    secondaryKeywords: mergedSecondary,
    meta: {
      // Prefilled from the same template the page itself uses, so the reviewer
      // edits the real thing rather than a preview of it.
      title: scaffold.meta.title,
      h1: scaffold.sections.hero.h1,
      description: '',
    },
    outline,
    faqs: draftFaqs({ competitorFaqs, service, city: location.city }),
    wordTarget: { min: config.dental.pageWords.targetMin, max: config.dental.pageWords.targetMax },
  });
}

module.exports = {
  buildBrief, getBrief, saveBrief, normalizeBrief,
  draftFaqs, usableQuestion, fallbackQuestions, briefId, tupleKey,
};
