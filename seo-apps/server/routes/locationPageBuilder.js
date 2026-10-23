// ── Location + Service Page Content Builder — HTTP API (Build Spec) ──────────
// Mounted at /api/location-page-builder. File-store backed; reuses the app's
// SERP/SEMrush/OpenAI/scraper services. Long-running pipeline + generation run
// over SSE (matching the app's keywordResearch route convention).

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const config = require('../locationPageBuilder/config');
const store = require('../locationPageBuilder/store');
const { seedClearBehavioral } = require('../locationPageBuilder/seed');
const cbhBrief = require('../locationPageBuilder/cbhBrief');
const cbhWizard = require('../locationPageBuilder/cbhWizard');
const cbhRegen = require('../locationPageBuilder/cbhRegen');
const cbhQc = require('../locationPageBuilder/cbhQc');
const cbhContract = require('../locationPageBuilder/cbhContract');
const cbhCompose = require('../locationPageBuilder/cbhCompose');
const compose = require('../locationPageBuilder/compose');
const pageService = require('../locationPageBuilder/pageService');
const exporter = require('../locationPageBuilder/exporter');
const keywordAdapter = require('../locationPageBuilder/keywordAdapter');
const keywordSelections = require('../locationPageBuilder/keywordSelections');

// Feature flag (Spec §0.2)
router.use((req, res, next) => {
  if (!config.enabled) return res.status(404).json({ error: 'Module disabled (LPB_ENABLED=false).' });
  next();
});

// Express 4 does not catch a rejected promise returned by an async handler:
// the rejection goes unhandled, and on modern Node that terminates the whole
// server process. The read routes below have no try/catch of their own, so a
// single store error in any of them took the entire app down (this is exactly
// how the export route once killed the server). wrap() turns any such
// rejection into a 500 on that one request.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  console.error(`[LPB] ${req.method} ${req.originalUrl} failed:`, e.message);
  if (!res.headersSent) res.status(500).json({ error: e.message });
});

// Short-lived tokens for SSE streams (same pattern as keywordResearch).
const sseTokens = new Map();
function mintToken(payload) {
  const token = crypto.randomBytes(16).toString('hex');
  sseTokens.set(token, payload);
  setTimeout(() => sseTokens.delete(token), 120000);
  return token;
}

// ── Reference data (L1/L2) ───────────────────────────────────────────────────
// Seeding a client is ONBOARDING and is not a general product surface: there is
// no route that seeds an arbitrary client, and adding one would put setup back
// in the app.
//
// This route is the exception, and not for setup: the Clear Behavioral wizard's
// "Sync list" re-imports a changed service/location taxonomy without making the
// SEO team leave the page. It is re-runnable and preserves hand-entered NAP
// (see seed.mergeLocation).
//
// It re-seeds ONE client, by calling that client's seeder directly, so a sync
// cannot touch any other client's rows (the seeder is scoped with
// store.replaceAllForClient).
router.post('/seed-clear-behavioral', async (req, res) => {
  try { res.json(await seedClearBehavioral()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/clients', wrap(async (req, res) => res.json(await store.list('clients'))));
router.get('/clients/:id', wrap(async (req, res) => {
  // Reference data changes the moment the service list is re-synced, and a
  // browser-cached copy makes a completed sync look like it did nothing —
  // which is indistinguishable, from the wizard, from the seed having failed.
  res.setHeader('Cache-Control', 'no-store');
  const client = await store.get('clients', req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found.' });
  const [services, locations, providers] = await Promise.all([
    store.list('services', { client_id: client.id }),
    store.list('locations', { client_id: client.id }),
    store.list('providers', { client_id: client.id }),
  ]);
  res.json({ client, services, locations, providers });
}));

// Generic CRUD for L1/L2 entities (Spec §M1 intake).
const CRUD_COLLECTIONS = ['clients', 'services', 'locations', 'providers', 'reviews', 'insuranceSets', 'resources', 'toneProfiles', 'globalTemplates'];
router.get('/entities/:collection', wrap(async (req, res) => {
  if (!CRUD_COLLECTIONS.includes(req.params.collection)) return res.status(404).json({ error: 'Unknown collection.' });
  res.json(await store.list(req.params.collection, req.query.client_id ? { client_id: req.query.client_id } : {}));
}));
router.post('/entities/:collection', wrap(async (req, res) => {
  if (!CRUD_COLLECTIONS.includes(req.params.collection)) return res.status(404).json({ error: 'Unknown collection.' });
  res.json(await store.insert(req.params.collection, req.body));
}));
router.put('/entities/:collection/:id', wrap(async (req, res) => {
  if (!CRUD_COLLECTIONS.includes(req.params.collection)) return res.status(404).json({ error: 'Unknown collection.' });
  const updated = await store.update(req.params.collection, req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Not found.' });
  res.json(updated);
}));
router.delete('/entities/:collection/:id', wrap(async (req, res) => {
  if (!CRUD_COLLECTIONS.includes(req.params.collection)) return res.status(404).json({ error: 'Unknown collection.' });
  res.json({ removed: await store.remove(req.params.collection, req.params.id) });
}));

// ── Pages: tracking dashboard + detail ──────────────────────────────────────
// This dashboard + LocationPageDetailPage.jsx are built entirely around the
// Neuro page_object shape (approach/competitor_section/faqs). Wizard pages
// (CBH) have a completely different shape and are reviewed inline in their
// wizard, not through this dashboard.
//
// A Neuro page is created by pageService.createPage, which sets no page_type,
// so only those rows are listed. Filtering positively rather than excluding
// known wizard types means a row of any other type -- including one left
// behind by a retired wizard -- never appears here as a row that breaks the
// moment it is opened.
function isNeuroPage(p) {
  return !p.page_type || p.page_type === 'location_service';
}

router.get('/pages', wrap(async (req, res) => {
  const all = await store.list('pages', req.query.client_id ? { client_id: req.query.client_id } : {});
  const pages = all.filter(isNeuroPage);
  // Enrich with service/location names for the dashboard.
  const [services, locations, clients] = await Promise.all([
    store.list('services'), store.list('locations'), store.list('clients'),
  ]);
  const byId = (arr) => Object.fromEntries(arr.map(x => [x.id, x]));
  const S = byId(services), L = byId(locations), C = byId(clients);
  const rows = pages.map(p => ({
    id: p.id, status: p.status, client_id: p.client_id,
    client_name: C[p.client_id]?.name || '', service_name: S[p.service_id]?.name || '',
    location_name: L[p.location_id]?.location_name || '',
    assignee_id: p.assignee_id, target_date: p.target_date, updated_at: p.updated_at,
    primary_keywords: (p.keyword_set?.primary || []).map(k => k.keyword),
    approval_status: p.approval_status,
    qa_blocking: p.qa_result?.blocking_failures ?? null,
    exported: (p.versions || []).some(v => (v.exported_formats || []).length),
  }));
  res.json(rows);
}));

router.get('/pages/:id', wrap(async (req, res) => {
  const page = await store.get('pages', req.params.id);
  if (!page) return res.status(404).json({ error: 'Page not found.' });
  if (!isNeuroPage(page)) {
    return res.status(400).json({ error: 'This page belongs to a wizard — review it from that wizard, not this detail view.' });
  }
  res.json(page);
}));

// New Page wizard — eligibility + already-exists (Stage 1)
router.post('/pages', async (req, res) => {
  try {
    const { clientId, serviceId, locationId, assigneeId, targetDate } = req.body;
    if (!clientId || !serviceId || !locationId) return res.status(400).json({ error: 'clientId, serviceId, locationId are required.' });
    res.json(await pageService.createPage({ clientId, serviceId, locationId, assigneeId, targetDate }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Hard delete (the module's retention rule is "kept forever unless deleted").
// The page's approved-keyword record is keyed by the same tuple and is deleted
// with it, so nothing is orphaned behind the page it belonged to.
router.delete('/pages/:id', async (req, res) => {
  try {
    const page = await store.get('pages', req.params.id);
    const removed = await store.remove('pages', req.params.id);
    // Non-fatal: the page itself is already gone, so a failure to tidy up its
    // keyword record must not report the delete as having failed.
    if (page) {
      try {
        const tuple_key = keywordSelections.tupleKey({
          clientId: page.client_id, serviceId: page.service_id, locationId: page.location_id,
        });
        await store.removeWhere('keywordSelections', { tuple_key });
      } catch (e) {
        console.error('[LPB] Failed to remove keyword selection for deleted page:', e.message);
      }
    }
    res.json({ removed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Keyword pipeline (SSE) ───────────────────────────────────────────────────
router.post('/pages/:id/keywords/run', (req, res) => {
  res.json({ token: mintToken({ kind: 'pipeline', pageId: req.params.id }) });
});
router.post('/pages/:id/content/run', (req, res) => {
  res.json({ token: mintToken({ kind: 'generate', pageId: req.params.id }) });
});

router.get('/stream/:token', async (req, res) => {
  const job = sseTokens.get(req.params.token);
  if (!job) return res.status(404).json({ error: 'Stream token not found or expired.' });
  sseTokens.delete(req.params.token);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  res.on('close', () => { closed = true; });
  const emit = (event, data) => { if (!closed) { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { closed = true; } } };
  const onStep = (step) => emit('step', step);

  // Heartbeat: a comment line every 15s keeps the SSE connection warm through
  // proxies (Railway/Envoy) during slow stages (SERP/SEMrush/LLM).
  const heartbeat = setInterval(() => { if (!closed) { try { res.write(': keepalive\n\n'); } catch { closed = true; } } }, 15000);

  try {
    if (job.kind === 'pipeline') {
      const result = await pageService.runKeywordPipeline(job.pageId, onStep);
      emit('result', result);
    } else if (job.kind === 'generate') {
      const result = await pageService.generateContent(job.pageId, onStep);
      emit('result', { qa_result: result.qa_result, status: result.page_object.meta.status });
    }
  } catch (e) {
    emit('fail', { message: e.message });
  }
  clearInterval(heartbeat);
  emit('done', {});
  res.end();
});

// ── Keyword editing (Stage 6) ────────────────────────────────────────────────
router.put('/pages/:id/keywords', async (req, res) => {
  try { res.json(await pageService.saveKeywords(req.params.id, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/pages/:id/keywords/finalize', async (req, res) => {
  try { res.json({ ok: await pageService.finalizeKeywords(req.params.id) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Content editing + QA ─────────────────────────────────────────────────────
router.put('/pages/:id/section', async (req, res) => {
  try {
    const { sectionKey, value, actorId } = req.body;
    res.json(await pageService.editSection(req.params.id, sectionKey, value, actorId));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.put('/pages/:id/content', async (req, res) => {
  try { res.json(await pageService.saveContent(req.params.id, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/pages/:id/qa', async (req, res) => {
  try { res.json(await pageService.rerunQA(req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/pages/:id/content/regen-field', async (req, res) => {
  try {
    const { field, maxChars, context } = req.body;
    const value = await pageService.regenField(req.params.id, { field, maxChars: maxChars || null, context: context || {} });
    res.json({ value });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Approval (Spec §10) ──────────────────────────────────────────────────────
router.post('/pages/:id/gate', async (req, res) => {
  try {
    const { gate, action, role, comment, actorId } = req.body;
    // Role comes from the request (app auth is currently a stub — Spec §0 RBAC).
    res.json(await pageService.actOnGate(req.params.id, gate, action, { role: role || 'admin', comment, actorId }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/pages/:id/comments', async (req, res) => {
  try { res.json(await pageService.addComment(req.params.id, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Wizard keyword research ─────────────────────────────────────────────────
// Keyword candidates for one service + location. Deliberately separate from
// the Neuro pages/keywords/content routes above — no SSE, no approval workflow.
router.post('/keyword-candidates', async (req, res) => {
  try {
    const { service, city, state, stateName, region, seedQuery, clientId, serviceSlug } = req.body;
    if (!service || !city || !state) return res.status(400).json({ error: 'service, city, state are required.' });
    // region + stateName are optional: they widen what Secondary may name
    // (this office's own broader region/state) without opening the door to
    // rival cities. Absent them, only the city itself is treated as local.
    res.json(await keywordAdapter.getKeywordCandidates({ service, city, state, stateName, region, seedQuery, clientId, serviceSlug }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Clear Behavioral Health flow ────────────────────────────────────────────
// Its own contract (cbhContract.js): ten sections with hard character
// caps. Keyword research in front of this is the shared /keyword-candidates
// and /wizard/keywords routes.

// The limits the wizard shows beside each field. Served rather than duplicated
// in the client: a target displayed in the UI that differs from the one QC
// gates on is worse than showing none.
router.get('/cbh/limits', (req, res) => {
  res.json({
    limits: cbhContract.LIMITS,
    fixedHeadings: cbhContract.FIXED_HEADINGS,
    sectionOrder: cbhContract.SECTION_ORDER,
    titleSuffix: cbhContract.TITLE_SUFFIX,
  });
});

router.get('/cbh/brief', async (req, res) => {
  try {
    const { clientId, serviceId, locationId } = req.query;
    if (!clientId || !serviceId || !locationId) {
      return res.status(400).json({ error: 'clientId, serviceId, locationId are required.' });
    }
    res.json(await cbhBrief.getCbhBrief({ clientId, serviceId, locationId }) || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// BILLED: SERP + competitor scrape + one planning call (both cached). Drafts a
// brief; does NOT save one. Saving is the reviewer's action, so a draft nobody
// accepted never becomes the thing a page is written from.
router.post('/cbh/brief/build', async (req, res) => {
  try {
    const { clientId, serviceId, locationId, primaryKeywords, secondaryKeywords } = req.body;
    if (!clientId || !serviceId || !locationId) {
      return res.status(400).json({ error: 'clientId, serviceId, locationId are required.' });
    }
    if (!Array.isArray(primaryKeywords) || !primaryKeywords.filter(Boolean).length) {
      return res.status(400).json({ error: 'primaryKeywords (array, at least 1) is required.' });
    }
    res.json(await cbhBrief.buildCbhBrief({
      clientId, serviceId, locationId,
      primaryKeywords, secondaryKeywords: secondaryKeywords || [],
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/cbh/brief/save', async (req, res) => {
  try {
    const { clientId, serviceId, locationId, brief, approved } = req.body;
    if (!clientId || !serviceId || !locationId) {
      return res.status(400).json({ error: 'clientId, serviceId, locationId are required.' });
    }
    if (!brief || typeof brief !== 'object') return res.status(400).json({ error: 'brief (object) is required.' });
    res.json(await cbhBrief.saveCbhBrief({ clientId, serviceId, locationId, brief, approved: !!approved }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// BILLED: the writer, plus up to one correction pass.
router.post('/cbh/generate', async (req, res) => {
  try {
    const { clientId, serviceId, locationId, brief } = req.body;
    if (!clientId || !serviceId || !locationId) {
      return res.status(400).json({ error: 'clientId, serviceId, locationId are required.' });
    }
    res.json(await cbhWizard.generateFromBrief({ clientId, serviceId, locationId, brief }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Persist reviewer edits. QC is re-run server-side over what is actually
// stored, so a saved page can never carry a verdict describing older content.
router.put('/cbh/pages/:id', async (req, res) => {
  try {
    const { page } = req.body;
    if (!page) return res.status(400).json({ error: 'page is required.' });
    res.json(await cbhWizard.saveContent({ pageId: req.params.id, page }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Every saved CBH page, newest first. Denormalised with the service and
// location names because the list renders them and the page object stores ids.
router.get('/cbh/pages', async (req, res) => {
  try {
    const clientId = req.query.clientId;
    if (!clientId) return res.status(400).json({ error: 'clientId is required.' });
    const [pages, services, locations] = await Promise.all([
      store.list('pages', { client_id: clientId }),
      store.list('services', { client_id: clientId }),
      store.list('locations', { client_id: clientId }),
    ]);
    const byId = (rows) => Object.fromEntries(rows.map(r => [r.id, r]));
    const S = byId(services); const L = byId(locations);
    res.json(pages
      .filter(p => p.page_type === cbhWizard.PAGE_TYPE && p.page_object)
      .map(p => ({
        id: p.id,
        serviceId: p.service_id,
        locationId: p.location_id,
        serviceName: S[p.service_id]?.name || '',
        locationName: L[p.location_id]?.location_name || '',
        // Read straight off the stored blob rather than through the read
        // route, so this is the one place a page written before the em-dash
        // rule would still show one. Cleaned here too, or the list disagrees
        // with the page it links to.
        title: cbhContract.removeEmDashes(p.page_object?.meta?.title || ''),
        urlPath: p.page_object?.meta?.urlPath || '',
        verdict: p.page_object?.qc?.verdict || null,
        updatedAt: p.updated_at,
      }))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/cbh/pages/:id', async (req, res) => {
  try {
    const page = await store.get('pages', req.params.id);
    if (!page || page.page_type !== cbhWizard.PAGE_TYPE) return res.status(404).json({ error: 'Page not found.' });
    // A page saved before a section existed has no key for it, and the wizard
    // assigns straight into sections.<key>. Fill the shape in on the way out.
    const pageObject = cbhCompose.ensureCbhSections(page.page_object);
    // And rebuild the URLs, so a page written before the client sent their
    // location slugs opens showing the URL it would ship on today rather than
    // the one it happened to be generated with.
    const [client, location, service] = await Promise.all([
      store.get('clients', page.client_id),
      store.get('locations', page.location_id),
      store.get('services', page.service_id),
    ]);
    if (!pageObject.meta.serviceSlug) pageObject.meta.serviceSlug = service?.slug || '';
    cbhCompose.refreshCbhDerived(pageObject, { client, location, service });
    res.json({ pageId: page.id, page: pageObject, serviceId: page.service_id, locationId: page.location_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Deletes ONE generated page. The saved BRIEF for the same service+location is
// deliberately left in place: it cost a billed research call and usually some
// hand editing, and "delete this page" is not a request to throw that away.
// The tuple simply returns to the state it was in between approving a brief and
// generating from it, which the wizard already handles.
router.delete('/cbh/pages/:id', async (req, res) => {
  try {
    const page = await store.get('pages', req.params.id);
    // Type-checked before removing: this route is reachable with any id, and a
    // CBH list must not be able to delete a Neuro page.
    if (!page || page.page_type !== cbhWizard.PAGE_TYPE) return res.status(404).json({ error: 'Page not found.' });
    const removed = await store.remove('pages', req.params.id);
    res.json({ removed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// BILLED, but small: one focused call to rewrite a single field. The reviewer's
// problem is usually one sentence, and regenerating the whole page to fix it
// discards eight sections of accepted copy.
router.post('/cbh/regen-field', async (req, res) => {
  try {
    const { clientId, serviceId, locationId, page, brief, field, index, lineIndex } = req.body;
    if (!clientId || !serviceId || !locationId) {
      return res.status(400).json({ error: 'clientId, serviceId, locationId are required.' });
    }
    if (!field) return res.status(400).json({ error: 'field is required.' });
    res.json(await cbhRegen.regenerateField({ clientId, serviceId, locationId, page, brief, field, index, lineIndex }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Exports what is ON SCREEN, saved or not -- a reviewer who edits then exports
// must get the document they are looking at.
router.post('/cbh/export/docx', async (req, res) => {
  try {
    const { page } = req.body;
    if (!exporter.isCbhPage(page)) return res.status(400).json({ error: 'A CBH page object is required.' });
    const buffer = await exporter.toCbhDocxBuffer(page);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${exporter.safeFilename(page)}.docx"`);
    return res.send(buffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// The CMS ingest payload. Server-side rather than a client-side stringify,
// because the shape needs the SERVICE and LOCATION rows -- the slugs and the
// mental_health/addiction split live there, not on the page. Exports what is ON
// SCREEN, like the DOCX route, so a reviewer's edits are in the file.
router.post('/cbh/export/json', async (req, res) => {
  try {
    const { page } = req.body;
    if (!exporter.isCbhPage(page)) return res.status(400).json({ error: 'A CBH page object is required.' });
    const [service, location] = await Promise.all([
      store.get('services', page.meta?.service_id),
      store.get('locations', page.meta?.location_id),
    ]);
    res.json({
      filename: `${exporter.safeFilename(page)}.json`,
      json: exporter.toCbhCmsJson(page, { service, location }),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Re-run QC against a (possibly edited) page without regenerating or saving.
router.post('/cbh/qc', (req, res) => {
  try {
    const { page } = req.body;
    if (!cbhQc.isCbhPage(page)) return res.status(400).json({ error: 'A CBH page object is required.' });
    res.json(cbhQc.runCbhQc(page));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Approved keywords (durable) ─────────────────────────────────────────────
// Approval used to be implicit in generation, so approving and leaving lost the
// work, and re-opening a page had nothing to rehydrate from and silently re-ran
// the billed /keyword-candidates research. These two routes give the approval
// its own permanent record.
router.post('/wizard/keywords', async (req, res) => {
  try {
    const { clientId, serviceId, locationId, primary, secondary, candidates, approved } = req.body;
    if (!clientId || !serviceId || !locationId) return res.status(400).json({ error: 'clientId, serviceId, locationId are required.' });
    const saved = await keywordSelections.saveSelection({
      clientId, serviceId, locationId,
      primary: primary || [], secondary: secondary || [], candidates: candidates || [],
      // Default true: an explicit POST with no flag is a deliberate approval.
      approved: approved !== false,
    });
    res.json({ saved: true, approved: saved.approved, approvedAt: saved.approved_at });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/wizard/keywords', async (req, res) => {
  try {
    const { clientId, serviceId, locationId } = req.query;
    if (!clientId || !serviceId || !locationId) return res.status(400).json({ error: 'clientId, serviceId, locationId are required.' });
    const sel = await keywordSelections.getSelection({ clientId, serviceId, locationId });
    if (!sel) return res.json({ exists: false, primary: [], secondary: [], candidates: [] });
    res.json({
      exists: true, primary: sel.primary || [], secondary: sel.secondary || [],
      candidates: sel.candidates || [],
      approved: sel.approved !== false, approvedAt: sel.approved_at || null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Export (Spec §11) ────────────────────────────────────────────────────────
router.get('/pages/:id/export/:format', wrap(async (req, res) => {
  const page = await store.get('pages', req.params.id);
  if (!page?.page_object) return res.status(400).json({ error: 'No generated content to export.' });
  // The Neuro exporters read service_data/location_data/page_data, which no
  // wizard page has. Exporting one used to throw inside safeFilename — and
  // because that call sat OUTSIDE the try below, in an async handler, the
  // rejection went unhandled and took the whole server process down. Every
  // shape-dependent call stays inside the try, and a wizard page is refused.
  if (!isNeuroPage(page)) return res.status(400).json({ error: 'Export this page from its wizard.' });
  const fmt = req.params.format;
  try {
    const fname = exporter.safeFilename(page.page_object);
    if (fmt === 'json') {
      await pageService.snapshotVersion(req.params.id, ['json']);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}.json"`);
      return res.send(exporter.toJSON(page.page_object));
    }
    if (fmt === 'markdown' || fmt === 'md') {
      await pageService.snapshotVersion(req.params.id, ['markdown']);
      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}.md"`);
      return res.send(exporter.toMarkdown(page.page_object));
    }
    if (fmt === 'docx') {
      const buffer = await exporter.toDocxBuffer(page.page_object);
      await pageService.snapshotVersion(req.params.id, ['docx']);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}.docx"`);
      return res.send(buffer);
    }
    res.status(400).json({ error: `Unknown format "${fmt}".` });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// Inline preview (JSON/markdown) without download.
router.get('/pages/:id/preview/:format', wrap(async (req, res) => {
  const page = await store.get('pages', req.params.id);
  if (!page?.page_object) return res.status(400).json({ error: 'No generated content.' });
  if (req.params.format === 'markdown') {
    if (!isNeuroPage(page)) return res.status(400).json({ error: 'Preview this page from its wizard.' });
    return res.type('text/plain').send(exporter.toMarkdown(page.page_object));
  }
  res.json(page.page_object);
}));

module.exports = router;
