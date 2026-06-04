// ── Location + Service Page Content Builder — HTTP API (Build Spec) ──────────
// Mounted at /api/location-page-builder. File-store backed; reuses the app's
// SERP/SEMrush/OpenAI/scraper services. Long-running pipeline + generation run
// over SSE (matching the app's keywordResearch route convention).

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const config = require('../locationPageBuilder/config');
const store = require('../locationPageBuilder/store');
const { seedNeuroWellness } = require('../locationPageBuilder/seed');
const compose = require('../locationPageBuilder/compose');
const pageService = require('../locationPageBuilder/pageService');
const exporter = require('../locationPageBuilder/exporter');

// Feature flag (Spec §0.2)
router.use((req, res, next) => {
  if (!config.enabled) return res.status(404).json({ error: 'Module disabled (LPB_ENABLED=false).' });
  next();
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
router.post('/seed', async (req, res) => {
  try { res.json(await seedNeuroWellness()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/clients', async (req, res) => res.json(await store.list('clients')));
router.get('/clients/:id', async (req, res) => {
  const client = await store.get('clients', req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found.' });
  const [services, locations, providers] = await Promise.all([
    store.list('services', { client_id: client.id }),
    store.list('locations', { client_id: client.id }),
    store.list('providers', { client_id: client.id }),
  ]);
  res.json({ client, services, locations, providers });
});

// Generic CRUD for L1/L2 entities (Spec §M1 intake).
const CRUD_COLLECTIONS = ['clients', 'services', 'locations', 'providers', 'reviews', 'insuranceSets', 'resources', 'toneProfiles', 'globalTemplates'];
router.get('/entities/:collection', async (req, res) => {
  if (!CRUD_COLLECTIONS.includes(req.params.collection)) return res.status(404).json({ error: 'Unknown collection.' });
  res.json(await store.list(req.params.collection, req.query.client_id ? { client_id: req.query.client_id } : {}));
});
router.post('/entities/:collection', async (req, res) => {
  if (!CRUD_COLLECTIONS.includes(req.params.collection)) return res.status(404).json({ error: 'Unknown collection.' });
  res.json(await store.insert(req.params.collection, req.body));
});
router.put('/entities/:collection/:id', async (req, res) => {
  if (!CRUD_COLLECTIONS.includes(req.params.collection)) return res.status(404).json({ error: 'Unknown collection.' });
  const updated = await store.update(req.params.collection, req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Not found.' });
  res.json(updated);
});
router.delete('/entities/:collection/:id', async (req, res) => {
  if (!CRUD_COLLECTIONS.includes(req.params.collection)) return res.status(404).json({ error: 'Unknown collection.' });
  res.json({ removed: await store.remove(req.params.collection, req.params.id) });
});

// ── Pages: tracking dashboard + detail ──────────────────────────────────────
router.get('/pages', async (req, res) => {
  const pages = await store.list('pages', req.query.client_id ? { client_id: req.query.client_id } : {});
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
});

router.get('/pages/:id', async (req, res) => {
  const page = await store.get('pages', req.params.id);
  if (!page) return res.status(404).json({ error: 'Page not found.' });
  res.json(page);
});

// New Page wizard — eligibility + already-exists (Stage 1)
router.post('/pages', async (req, res) => {
  try {
    const { clientId, serviceId, locationId, assigneeId, targetDate } = req.body;
    if (!clientId || !serviceId || !locationId) return res.status(400).json({ error: 'clientId, serviceId, locationId are required.' });
    res.json(await pageService.createPage({ clientId, serviceId, locationId, assigneeId, targetDate }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/pages/:id', async (req, res) => res.json({ removed: await store.remove('pages', req.params.id) }));

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

// ── Export (Spec §11) ────────────────────────────────────────────────────────
router.get('/pages/:id/export/:format', async (req, res) => {
  const page = await store.get('pages', req.params.id);
  if (!page?.page_object) return res.status(400).json({ error: 'No generated content to export.' });
  const fmt = req.params.format;
  const fname = exporter.safeFilename(page.page_object);
  try {
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
});

// Inline preview (JSON/markdown) without download.
router.get('/pages/:id/preview/:format', async (req, res) => {
  const page = await store.get('pages', req.params.id);
  if (!page?.page_object) return res.status(400).json({ error: 'No generated content.' });
  if (req.params.format === 'markdown') return res.type('text/plain').send(exporter.toMarkdown(page.page_object));
  res.json(page.page_object);
});

module.exports = router;
