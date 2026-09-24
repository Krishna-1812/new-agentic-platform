// ── Orchestrator: high-level page operations used by the route ──────────────
// Ties the keyword pipeline, layer composition, content generation, schema, QA,
// and approval state machine together and persists to the `pages` collection.
// Page sub-objects (keyword_set, page_object, qa_result, approvals, versions,
// comments) are embedded in the page record (file-store convention).

const store = require('./store');
const pipeline = require('./pipeline');
const compose = require('./compose');
const contentGenerator = require('./contentGenerator');
const internalLinks = require('./internalLinks');
const schemaGenerator = require('./schemaGenerator');
const qaEngine = require('./qaEngine');
const approval = require('./approval');
const { scrapeUrls } = require('../services/scraper');

// ── Create / eligibility (Stage 1) ──────────────────────────────────────────
async function createPage({ clientId, serviceId, locationId, assigneeId, targetDate }) {
  const client = await store.get('clients', clientId);
  const service = await store.get('services', serviceId);
  const location = await store.get('locations', locationId);
  const eligibility = await pipeline.checkEligibility({ client, service, location });

  // "already exists" check on the tuple (Spec §6 Stage 1)
  const existing = (await store.list('pages', { client_id: clientId }))
    .find(p => p.service_id === serviceId && p.location_id === locationId);
  if (existing) return { existing: true, page: existing, eligibility };

  if (!eligibility.eligible) {
    return { existing: false, eligibility, blocked: true };
  }

  const page = await store.insert('pages', {
    client_id: clientId, service_id: serviceId, location_id: locationId,
    assignee_id: assigneeId || null, target_date: targetDate || null,
    status: approval.STATUS.DRAFT,
    eligibility,
    _ymyl: !!client.brand_rules?.ymyl,
    keyword_set: null,
    competitor_analysis: [],
    page_object: null,
    qa_result: null,
    approval_status: { seo: 'pending', clinical: client.brand_rules?.ymyl ? 'pending' : 'n/a', content: 'pending', client: 'pending' },
    approval_records: [],
    section_comments: [],
    versions: [],
    cost_estimate: { serp_calls: 0, semrush_calls: 0, llm_calls: 0 },
  }, 'page');

  return { existing: false, page, eligibility };
}

// ── Keyword pipeline (Stages 2-5) — emits progress via onStep ───────────────
async function runKeywordPipeline(pageId, onStep = () => {}) {
  const page = await store.get('pages', pageId);
  if (!page) throw new Error('Page not found.');
  const layers = await compose.loadLayers({ clientId: page.client_id, serviceId: page.service_id, locationId: page.location_id });
  const { client, service, location } = layers;

  await store.update('pages', pageId, { status: approval.STATUS.KEYWORDS_IN_PROGRESS });

  onStep({ id: 'seeds', status: 'active', message: 'Generating seed keywords…' });
  const seeds = pipeline.generateSeeds({ service, location });
  onStep({ id: 'seeds', status: 'done', message: `Generated ${seeds.length} seeds`, seeds });

  onStep({ id: 'serp', status: 'active', message: `Running location-forced SERP queries (0/${Math.min(seeds.filter(s => s.includes((location.city || '').toLowerCase()) || s.includes('near me')).length || seeds.length, 6)})…` });
  const { competitor_urls, modelAfter, discoveryOnly } = await pipeline.rankCompetitors({
    client, service, location, seeds,
    onProgress: (done, total) => onStep({ id: 'serp', status: 'active', message: `Running location-forced SERP queries (${done}/${total})…` }),
  });
  onStep({ id: 'serp', status: 'done', message: `Ranked ${competitor_urls.length} competitor URLs`, competitor_urls });

  onStep({ id: 'semrush', status: 'active', message: 'Extracting keywords via SEMrush…' });
  const pool = await pipeline.extractKeywords({ urls: [...modelAfter, ...discoveryOnly] });
  onStep({ id: 'semrush', status: 'done', message: `Built a pool of ${pool.length} keywords` });

  onStep({ id: 'llm', status: 'active', message: 'Classifying & prioritizing keywords (LLM, temp 0)…' });
  const classified = await pipeline.classifyKeywords({ service, location, keywordPool: pool });
  onStep({ id: 'llm', status: 'done', message: 'Keyword shortlist ready' });

  const keyword_set = {
    page_id: pageId,
    primary: classified.primary, secondary: classified.secondary,
    local_modifier: classified.local_modifier, semantic: classified.semantic,
    faq: classified.faq, internal_linking: classified.internal_linking,
    informational_low: classified.informational_low, excluded: classified.excluded,
    candidate_pool: classified.candidate_pool, locked_keywords: page.keyword_set?.locked_keywords || [],
    version: (page.keyword_set?.version || 0) + 1,
  };

  await store.update('pages', pageId, {
    keyword_set,
    competitor_analysis: competitor_urls,
    status: approval.STATUS.KEYWORDS_IN_PROGRESS,
    cost_estimate: { ...page.cost_estimate, serp_calls: (page.cost_estimate?.serp_calls || 0) + seeds.length, semrush_calls: modelAfter.length + discoveryOnly.length, llm_calls: (page.cost_estimate?.llm_calls || 0) + 1 },
  });

  return { keyword_set, competitor_urls };
}

// ── Stage 6 — keyword editing + finalize ────────────────────────────────────
async function saveKeywords(pageId, keyword_set) {
  const page = await store.get('pages', pageId);
  if (!page) throw new Error('Page not found.');
  const merged = { ...page.keyword_set, ...keyword_set, version: (page.keyword_set?.version || 0) + 1 };
  await store.update('pages', pageId, { keyword_set: merged });
  return merged;
}

async function finalizeKeywords(pageId) {
  const page = await store.get('pages', pageId);
  if (!page?.keyword_set?.primary?.length) throw new Error('Cannot finalize: no primary keywords selected.');
  await store.update('pages', pageId, { status: approval.STATUS.KEYWORDS_FINALIZED });
  return true;
}

// ── Stage 7 — content generation + schema + QA ──────────────────────────────
async function generateContent(pageId, onStep = () => {}) {
  const page = await store.get('pages', pageId);
  if (!page) throw new Error('Page not found.');
  if (!page.keyword_set?.primary?.length) throw new Error('Finalize keywords before generating content.');

  const layers = await compose.loadLayers({ clientId: page.client_id, serviceId: page.service_id, locationId: page.location_id });

  // Scrape model_after URLs for structure modeling + originality (not NAP/copy).
  onStep({ id: 'scrape', status: 'active', message: 'Modeling competitor structure…' });
  const modelUrls = (page.competitor_analysis || []).filter(u => u.bucket === 'model_after').slice(0, 5).map(u => u.url);
  let modelCopy = [];
  try { modelCopy = modelUrls.length ? (await scrapeUrls(modelUrls)).filter(r => r.success) : []; }
  catch { modelCopy = []; }
  onStep({ id: 'scrape', status: 'done', message: `Modeled ${modelCopy.length} competitor pages` });

  // Build L1+L2 scaffold, generate L3, merge.
  onStep({ id: 'generate', status: 'active', message: 'Generating unique page content (L3)…' });
  const scaffold = compose.buildScaffold(layers);
  scaffold.meta.page_id = pageId;
  scaffold.keywords = {
    primary: page.keyword_set.primary, secondary: page.keyword_set.secondary,
    local_modifier: page.keyword_set.local_modifier, semantic: page.keyword_set.semantic,
    faq: page.keyword_set.faq, internal_linking: page.keyword_set.internal_linking,
    informational_low: page.keyword_set.informational_low, excluded: page.keyword_set.excluded,
  };
  const l3 = await contentGenerator.generateL3({ pageObject: scaffold, layers, keywords: scaffold.keywords, modelCopy });
  compose.mergeL3(scaffold, l3);
  onStep({ id: 'generate', status: 'done', message: 'Content generated' });

  // Internal links + schema.
  scaffold.page_data.internal_links = internalLinks.build({ layers });
  scaffold._client = layers.client;
  scaffold.page_data.schema = schemaGenerator.generateSchema(scaffold);

  // QA (uniqueness + originality + guardrails).
  onStep({ id: 'qa', status: 'active', message: 'Running QA / validation…' });
  scaffold.page_data._location_id = page.location_id;
  const similarity = await contentGenerator.crossPageSimilarity({ store, clientId: page.client_id, currentPageId: pageId, pageData: scaffold.page_data });
  const competitorOverlap = contentGenerator.competitorOverlap(scaffold.page_data, modelCopy);
  const qa = qaEngine.runQA(scaffold, { client: layers.client, location: layers.location, similarity, competitorOverlap });
  delete scaffold.page_data._location_id;
  delete scaffold._client;
  onStep({ id: 'qa', status: 'done', message: `QA complete — ${qa.blocking_failures} blocking, ${qa.warnings} warnings` });

  scaffold.meta.status = approval.STATUS.CONTENT_GENERATED;
  scaffold.qa_result = qa;

  await store.update('pages', pageId, {
    page_object: scaffold,
    qa_result: qa,
    status: approval.STATUS.CONTENT_GENERATED,
    cost_estimate: { ...page.cost_estimate, llm_calls: (page.cost_estimate?.llm_calls || 0) + 1 },
  });

  return { page_object: scaffold, qa_result: qa };
}

// Re-run QA on the current page_object (e.g. after a manual section edit).
async function rerunQA(pageId) {
  const page = await store.get('pages', pageId);
  if (!page?.page_object) throw new Error('No generated content to validate.');
  const layers = await compose.loadLayers({ clientId: page.client_id, serviceId: page.service_id, locationId: page.location_id });
  const po = page.page_object;
  po.page_data.schema = schemaGenerator.generateSchema({ ...po, _client: layers.client });
  po.page_data._location_id = page.location_id;
  const similarity = await contentGenerator.crossPageSimilarity({ store, clientId: page.client_id, currentPageId: pageId, pageData: po.page_data });
  const qa = qaEngine.runQA(po, { client: layers.client, location: layers.location, similarity, competitorOverlap: 0 });
  delete po.page_data._location_id;
  po.qa_result = qa;
  await store.update('pages', pageId, { page_object: po, qa_result: qa });
  return qa;
}

// ── Section editing — resets gates + re-runs QA (Spec §10) ──────────────────
async function editSection(pageId, sectionKey, value, actorId) {
  const page = await store.get('pages', pageId);
  if (!page?.page_object) throw new Error('No content to edit.');
  const po = page.page_object;
  // Shallow set into page_data by key path (dot-allowed).
  setByPath(po.page_data, sectionKey, value);

  const { approval_status, reset, status } = approval.resetGatesAfterEdit(page);
  po.approval_status = approval_status;
  po.meta.status = status;
  await store.update('pages', pageId, { page_object: po, approval_status, status });
  const qa = await rerunQA(pageId);
  return { reset, qa };
}

// Bulk-save edited content fields (the content editor). Merges the patch into
// page_data, resets cleared gates, regenerates schema, and re-runs QA once.
async function saveContent(pageId, patch) {
  const page = await store.get('pages', pageId);
  if (!page?.page_object) throw new Error('No content to edit.');
  const po = page.page_object;
  const EDITABLE = ['meta_title', 'meta_description', 'og_title', 'og_description', 'h1', 'hero_intro', 'approach', 'competitor_section', 'faqs'];
  for (const k of EDITABLE) if (patch[k] !== undefined) po.page_data[k] = patch[k];

  const { approval_status, status } = approval.resetGatesAfterEdit(page);
  po.approval_status = approval_status;
  po.meta.status = status;
  await store.update('pages', pageId, { page_object: po, approval_status, status });
  const qa = await rerunQA(pageId);
  return { qa, status, reset: approval.resetGatesAfterEdit(page).reset };
}

function setByPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

// ── Single-field regeneration (editor per-field regen) ──────────────────────
async function regenField(pageId, { field, maxChars, context = {} }) {
  const page = await store.get('pages', pageId);
  if (!page?.page_object) throw new Error('No generated content to regen.');
  const layers = await compose.loadLayers({ clientId: page.client_id, serviceId: page.service_id, locationId: page.location_id });
  return contentGenerator.regenField({ pageObject: page.page_object, layers, keywords: page.keyword_set || {}, field, maxChars: maxChars || null, context });
}

// ── Approval actions ─────────────────────────────────────────────────────────
async function actOnGate(pageId, gate, action, { role, comment, actorId }) {
  const page = await store.get('pages', pageId);
  if (!page) throw new Error('Page not found.');
  if (!approval.canActOn(gate, role)) throw new Error(`Role "${role}" cannot stamp the "${gate}" gate.`);

  let result;
  if (action === 'approve') {
    result = approval.approveGate(page, gate, { qaBlockingFailures: page.qa_result?.blocking_failures || 0 });
  } else if (action === 'reject') {
    result = approval.rejectGate(page, gate);
  } else {
    throw new Error(`Unknown action "${action}".`);
  }

  const record = { id: store.newId('appr'), page_id: pageId, gate, action, actor_id: actorId || role, comment: comment || '', created_at: store.nowIso() };
  const po = page.page_object;
  if (po) { po.approval_status = result.approval_status; po.meta.status = result.status; }

  await store.update('pages', pageId, {
    approval_status: result.approval_status,
    status: result.status,
    approval_records: [...(page.approval_records || []), record],
    page_object: po || page.page_object,
  });

  const notify = action === 'approve' ? approval.nextOwnerAfter(page, gate) : approval.GATE_META[gate].role;
  return { ...result, record, notify };
}

// ── Comments ─────────────────────────────────────────────────────────────────
async function addComment(pageId, { sectionKey, body, authorId, parentId }) {
  const page = await store.get('pages', pageId);
  if (!page) throw new Error('Page not found.');
  const comment = { id: store.newId('cmt'), page_id: pageId, section_key: sectionKey || 'page', author_id: authorId || 'user', body, parent_id: parentId || null, resolved: false, created_at: store.nowIso() };
  await store.update('pages', pageId, { section_comments: [...(page.section_comments || []), comment] });
  return comment;
}

// ── Versioning ─────────────────────────────────────────────────────────────
async function snapshotVersion(pageId, exportedFormats = []) {
  const page = await store.get('pages', pageId);
  if (!page?.page_object) throw new Error('Nothing to version.');
  const versions = page.versions || [];
  const version_no = versions.length + 1;
  const version = {
    id: store.newId('ver'), page_id: pageId, version_no,
    page_object: JSON.parse(JSON.stringify(page.page_object)),
    approval_snapshot: page.approval_status,
    exported_formats: exportedFormats,
    created_at: store.nowIso(),
  };
  page.page_object.meta.version_no = version_no;
  await store.update('pages', pageId, { versions: [...versions, version], page_object: page.page_object });
  return version;
}

module.exports = {
  createPage, runKeywordPipeline, saveKeywords, finalizeKeywords,
  generateContent, rerunQA, editSection, saveContent, regenField, actOnGate, addComment, snapshotVersion,
};
