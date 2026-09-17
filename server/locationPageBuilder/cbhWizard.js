// ── Generate a Clear Behavioral Health page from its approved brief ─────────
// The CBH counterpart to briefWizard.generateFromBrief. It does NOT research
// or plan: it reads what a human approved and hands that to the writer. If it
// re-planned here, the brief step would be decorative -- the reviewer would
// edit an outline the generator then discarded.

const store = require('./store');
const compose = require('./compose');
const contract = require('./cbhContract');
const cbhCompose = require('./cbhCompose');
const cbhQc = require('./cbhQc');
const cbhWriter = require('./cbhWriter');
const { getCbhBrief, normalizeCbhBrief, caseContext } = require('./cbhBrief');
const { servicePhraseDisplay } = require('./keywordRelevance');

const PAGE_TYPE = 'cbh_location_service';


async function findExistingPage({ clientId, serviceId, locationId }) {
  const pages = await store.list('pages', { client_id: clientId });
  return pages.find(p => p.service_id === serviceId && p.location_id === locationId) || null;
}

async function generateFromBrief({ clientId, serviceId, locationId, brief: briefInput }) {
  // Prefer the SAVED brief: what ships must be what was approved. An inline
  // brief is accepted because the wizard generates straight after saving, and
  // making that a second round trip would only add a race.
  const stored = await getCbhBrief({ clientId, serviceId, locationId });
  const brief = briefInput
    ? normalizeCbhBrief(briefInput, await caseContext({ clientId, serviceId, locationId }))
    : stored?.brief;
  if (!brief) throw new Error('No brief found for this location + service. Build and save a brief first.');
  if (!brief.primaryKeyword) throw new Error('The brief has no primary keyword.');

  const h3s = brief.educational?.h3s || [];
  const { min, max } = contract.LIMITS.educational.h3Count;
  if (h3s.length < min || h3s.length > max) {
    throw new Error(`The brief needs ${min}-${max} educational H3s; it has ${h3s.length}.`);
  }

  const layers = await compose.loadLayers({ clientId, serviceId, locationId });
  // `service` is needed for refreshCbhDerived below, which takes the raw
  // condition name from it for the educational H2.
  const { client, location, service } = layers;

  let scaffold = cbhCompose.buildCbhScaffold(layers, { servicePhrase: servicePhraseDisplay });
  scaffold.primaryKeyword = brief.primaryKeyword;
  scaffold.primaryKeywords = brief.primaryKeywords;
  scaffold.secondaryKeywords = brief.secondaryKeywords;

  const l3 = await cbhWriter.generateCbhL3({
    scaffold,
    primaryKeyword: brief.primaryKeyword,
    secondaryKeywords: brief.secondaryKeywords,
    h3Plan: h3s,
    faqPlan: brief.faqs || [],
  });

  scaffold = cbhCompose.mergeCbhL3(scaffold, l3, location);

  // The reviewer's meta wins over the writer's. It was approved; the writer's
  // is only a draft of something nobody had opinions about yet.
  if (brief.meta?.title) {
    scaffold.meta.title = brief.meta.title;
    scaffold.meta.fullTitle = contract.fullTitle(brief.meta.title);
  }
  if (brief.meta?.description) scaffold.meta.metaDescription = brief.meta.description;

  // Provenance comes from the BRIEF, not the model: the writer does not get to
  // declare its own output competitor-backed.
  scaffold = cbhCompose.applyProvenance(scaffold, h3s);

  // URLs and schema together, so the JSON-LD can never quote a URL the page
  // does not have.
  cbhCompose.refreshCbhDerived(scaffold, { client, location, service });
  scaffold.qc = cbhQc.runCbhQc(scaffold);

  const existing = await findExistingPage({ clientId, serviceId, locationId });
  const record = {
    client_id: clientId, service_id: serviceId, location_id: locationId,
    page_type: PAGE_TYPE,
    status: 'Content Generated',
    page_object: scaffold,
  };
  const saved = existing
    ? await store.update('pages', existing.id, record)
    : await store.insert('pages', record, 'cbh');

  return { pageId: saved.id, page: scaffold };
}

// Re-run QC over an edited page and persist it. Mirrors dentalWizard.saveContent.
async function saveContent({ pageId, page }) {
  const existing = await store.get('pages', pageId);
  if (!existing || existing.page_type !== PAGE_TYPE) throw new Error('Page not found.');
  if (!cbhQc.isCbhPage(page)) throw new Error('A valid CBH page object (meta + sections) is required.');
  // Re-derive the shipped title so an edited title cannot lose its suffix.
  const next = structuredClone(page);
  next.meta.title = contract.titleWithoutSuffix(next.meta.title || '');
  next.meta.fullTitle = contract.fullTitle(next.meta.title);
  // The reviewer edits the SLUG; urlPath and canonical are derived from it here
  // rather than trusted from the client, so a hand-edited URL cannot disagree
  // with the slug it is supposed to come from.
  const [client, location, service] = await Promise.all([
    store.get('clients', existing.client_id),
    store.get('locations', existing.location_id),
    store.get('services', existing.service_id),
  ]);
  // Also restate the fixed headings. saveContent did not, so a page that
  // reached save without passing the read route kept a stale one and failed a
  // Critical gate on a heading nobody had touched. Idempotent.
  cbhCompose.ensureCbhSections(next);
  // Rebuilds the URLs AND the JSON-LD. The schema quotes the canonical, the
  // meta and the FAQ pairs, so an edit to any of them has to reach it.
  cbhCompose.refreshCbhDerived(next, { client, location, service });
  next.qc = cbhQc.runCbhQc(next);
  const saved = await store.update('pages', pageId, { page_object: next });
  return { saved: true, updatedAt: saved.updated_at, qc: next.qc, page: next };
}

// buildCbhSchema is re-exported from its new home in cbhCompose so existing
// callers keep working.
module.exports = {
  generateFromBrief, saveContent, buildCbhSchema: cbhCompose.buildCbhSchema, PAGE_TYPE,
};
