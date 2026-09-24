// ── SUPERSEDED for Clear Behavioral Health ──────────────────────────────────
// CBH now runs its own contract (cbhContract / cbhBrief / cbhWizard), and the
// HTTP routes that reached this module have been removed, so nothing in the
// product calls it.
//
// It is kept rather than deleted because it is a WORKING, tested generic
// "brief -> dental-scaffold page" flow: if Gentle Dental ever wants a
// reviewable brief step, this is it. Do not wire it to CBH -- it builds the
// dental section shape, which that client's guidelines replaced.
//
// ── Generate a page FROM an approved brief ──────────────────────────────────
// The counterpart to dentalWizard.generatePage. Same machinery — scaffold,
// writer, schema, QC, one page row per tuple — with one structural difference
// that is the whole point of this flow:
//
//   dentalWizard:  keywords -> [research + plan outline + write] -> review
//   briefWizard:   keywords -> brief (reviewed, edited, saved) -> write -> review
//
// So this module does NOT research or plan. It reads what a human approved and
// hands that to the writer. If it re-planned the outline here, the brief step
// would be decorative — the reviewer would edit an outline the generator then
// discarded.

const store = require('./store');
const compose = require('./compose');
const contentGenerator = require('./contentGenerator');
const schemaGenerator = require('./schemaGenerator');
const qaEngine = require('./qaEngine');
const internalLinks = require('./internalLinks');
const { getBrief, normalizeBrief } = require('./brief');
const { verticalFor: clientVertical } = require('./verticals');

// Which prompt vocabulary a client's pages are written in. The mapping lives
// in verticals.js, which the SERP seed reads too -- one client must not be
// able to be dental to the keyword research and behavioral health to the
// writer. An unregistered client falls back to the writer's own default.
function verticalFor(clientId) {
  return clientVertical(clientId) || contentGenerator.DEFAULT_VERTICAL;
}

async function findExistingPage({ clientId, serviceId, locationId }) {
  const pages = await store.list('pages', { client_id: clientId });
  return pages.find(p => p.service_id === serviceId && p.location_id === locationId) || null;
}

// The brief's outline is handed to the writer as the fixed outline contract
// contentGenerator already enforces (alignToOutline / matchesOutline). It
// needs `source` on the brand block so the writer applies the "Why Choose"
// brief to it, which normalizeBrief preserves.
function outlineFromBrief(brief) {
  return {
    competitorQuality: brief.outline.competitorQuality,
    rationale: brief.outline.rationale,
    blocks: brief.outline.blocks,
  };
}

// What the review screen shows about where each heading came from. Same shape
// dentalWizard persists, so the wizard renders both flows identically — except
// the source here is the BRIEF, and a heading the reviewer typed themselves
// carries a null source rather than a fabricated provenance tag.
function outlineMetaOf(brief, scaffold) {
  const planned = brief.outline.blocks || [];
  const blocks = scaffold?.sections?.educationalBody?.blocks || planned;
  return {
    competitorQuality: brief.outline.competitorQuality,
    rationale: brief.outline.rationale,
    sources: blocks.map((b, i) => ({ h2: b.h2, source: planned[i]?.source || null })),
  };
}

async function generateFromBrief({ clientId, serviceId, locationId, brief: briefInput }) {
  // Prefer the SAVED brief: what ships must be what was approved. A brief
  // passed inline is accepted (the wizard generates straight after saving, and
  // making that a two-round-trip read would only add a race), but it is
  // normalized exactly the same way.
  const stored = await getBrief({ clientId, serviceId, locationId });
  const brief = briefInput ? normalizeBrief(briefInput) : stored?.brief;
  if (!brief) throw new Error('No brief found for this location + service. Build and save a brief first.');
  if (!brief.outline.blocks.length) throw new Error('The brief has no outline blocks to write.');
  if (!brief.primaryKeyword) throw new Error('The brief has no primary keyword.');

  const layers = await compose.loadLayers({ clientId, serviceId, locationId });
  const { client, service, location } = layers;

  const scaffold = compose.buildDentalScaffold(layers);
  scaffold.primaryKeyword = brief.primaryKeyword;
  scaffold.primaryKeywords = brief.primaryKeywords;
  scaffold.secondaryKeywords = brief.secondaryKeywords;

  // The reviewer's title and H1 win over the template's. They were edited in
  // the brief precisely so they could differ from the default pattern.
  if (brief.meta.title) scaffold.meta.title = brief.meta.title;
  if (brief.meta.h1) scaffold.sections.hero.h1 = brief.meta.h1;

  const l3 = await contentGenerator.generateDentalL3({
    service, location,
    primaryKeyword: brief.primaryKeyword,
    secondaryKeywords: brief.secondaryKeywords,
    outline: outlineFromBrief(brief),
    // The brief already fixed the questions, so there is nothing for the
    // competitor-topic block to add; passing them too would give the model a
    // second, looser list beside the one it must follow verbatim.
    competitorFaqs: [],
    brandName: scaffold.meta.brandName,
    brief,
    vertical: verticalFor(clientId),
  });
  compose.mergeDentalL3(scaffold, l3);

  // A reviewer-written meta description is used as written. It was approved;
  // the writer's is only a draft of something nobody had opinions about.
  if (brief.meta.description) scaffold.meta.metaDescription = brief.meta.description;

  scaffold.outlineMeta = outlineMetaOf(brief, scaffold);

  const allLocations = await store.list('locations', { client_id: clientId });
  scaffold.sections.servicesInCity.internalLinks = internalLinks.buildDentalSiblings({
    allLocations, currentLocation: location, service,
  });

  scaffold.schema = schemaGenerator.generateDentalSchema({ scaffold, client, location, service });
  scaffold.qc = qaEngine.runDentalQC(scaffold);

  const existing = await findExistingPage({ clientId, serviceId, locationId });
  const record = {
    client_id: clientId, service_id: serviceId, location_id: locationId,
    page_type: 'location_service_brief',
    status: 'Content Generated',
    page_object: scaffold,
  };
  const saved = existing
    ? await store.update('pages', existing.id, record)
    : await store.insert('pages', record, 'bpg');

  return { pageId: saved.id, page: scaffold };
}

module.exports = { generateFromBrief, verticalFor, outlineMetaOf };
