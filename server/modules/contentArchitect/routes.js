const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const store = require('./store');
const { resolveDomain, UnreachableDomainError } = require('./domainResolver');
const { discoverUrls, crawlFallback } = require('./sitemapDiscovery');
const { buildPatternTable, detectVertical } = require('./patternClassifier');
const { UnsafeUrlError } = require('./urlSafety');

// Init-token + SSE stream — work starts only once the stream itself is open
// (headers flushed) so no progress event can be emitted before the client is
// listening. Same pattern as server/routes/keywordResearch.js and this app's
// GBP QC bulk-generation endpoint.
const discoverSessions = new Map();

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

router.get('/projects', async (req, res) => {
  res.json(await store.listProjects());
});

router.post('/projects', async (req, res) => {
  const { domain } = req.body || {};
  if (!domain || !String(domain).trim()) return res.status(400).json({ error: 'Domain is required.' });
  try {
    const { canonicalOrigin, host } = await resolveDomain(domain);
    const project = await store.createProject({ domain: canonicalOrigin, host });
    res.json(project);
  } catch (err) {
    if (err instanceof UnreachableDomainError || err instanceof UnsafeUrlError) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id', async (req, res) => {
  const project = await store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

router.delete('/projects/:id', async (req, res) => {
  await store.deleteProject(req.params.id);
  res.json({ ok: true });
});

// ── Stage 1: sitemap discovery (SSE) ──────────────────────────────────────────

router.post('/projects/:id/discover', async (req, res) => {
  const project = await store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const token = generateToken();
  discoverSessions.set(token, { projectId: project.id });
  setTimeout(() => discoverSessions.delete(token), 120000);
  res.json({ token });
});

router.get('/projects/:id/discover/stream/:token', async (req, res) => {
  const session = discoverSessions.get(req.params.token);
  if (!session || session.projectId !== req.params.id) {
    return res.status(404).json({ error: 'Session not found or expired. Please try again.' });
  }
  discoverSessions.delete(req.params.token);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let isClosed = false;
  res.on('close', () => { isClosed = true; });
  const emit = (event, data) => {
    if (isClosed) return;
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { isClosed = true; }
  };

  try {
    const project = await store.getProject(req.params.id);
    if (!project) throw new Error('Project not found');

    emit('step', { id: 'sitemap', status: 'active', message: 'Looking for a sitemap…' });
    const result = await discoverUrls(project.domain);

    let urls = result.urls;
    let sitemapSource = result.source;
    let crawlMode = 'sitemap';

    if (result.mode === 'not-found') {
      emit('step', { id: 'sitemap', status: 'done', message: 'No sitemap found — falling back to a shallow site crawl' });
      emit('step', { id: 'crawl-fallback', status: 'active', message: 'No sitemap found. Crawling from the homepage instead (slower, may miss pages)…' });
      urls = await crawlFallback(project.domain);
      sitemapSource = 'crawl-fallback';
      crawlMode = 'slug-only'; // no page content yet either way — Stage 4 will crawl content separately
      emit('step', { id: 'crawl-fallback', status: 'done', message: `Found ${urls.length} URLs via crawl` });
    } else {
      emit('step', {
        id: 'sitemap',
        status: 'done',
        message: result.capped
          ? `Found ${urls.length} URLs (capped — hit the ${result.capReason} limit)`
          : `Found ${urls.length} URLs via ${sitemapSource}`,
      });
    }

    emit('step', { id: 'patterns', status: 'active', message: 'Grouping URLs into patterns…' });
    const urlStrings = urls.map((u) => u.url);
    const patterns = buildPatternTable(urlStrings);
    const vertical = detectVertical(urlStrings);
    await store.savePatterns(project.id, patterns);
    emit('step', { id: 'patterns', status: 'done', message: `Found ${patterns.length} URL patterns` });

    await store.updateProject(project.id, {
      workflowState: 'patterns',
      vertical,
      sitemapSource,
      crawlMode,
      stats: { ...project.stats, urlsFound: urls.length },
    });

    emit('ready', {
      patterns,
      vertical,
      sitemapSource,
      crawlMode,
      capped: result.capped || false,
      capReason: result.capReason || null,
      skippedSitemaps: result.skippedSitemaps || [],
      urlCount: urls.length,
    });
  } catch (err) {
    console.error('[content-architect] discover error:', err.message);
    emit('fail', { message: err.message });
  }
  emit('done', {});
  if (!isClosed) res.end();
});

// ── Stage 2: pattern selection ────────────────────────────────────────────────

router.get('/projects/:id/patterns', async (req, res) => {
  const patterns = await store.getPatterns(req.params.id);
  if (!patterns) return res.status(404).json({ error: 'No patterns yet — run discovery first.' });
  res.json(patterns);
});

router.put('/projects/:id/patterns', async (req, res) => {
  const { included, vertical } = req.body || {};
  const patterns = await store.getPatterns(req.params.id);
  if (!patterns) return res.status(404).json({ error: 'No patterns yet — run discovery first.' });

  const includedMap = new Map((included || []).map((p) => [p.pattern, p.included]));
  const updated = patterns.map((p) => (includedMap.has(p.pattern) ? { ...p, included: includedMap.get(p.pattern) } : p));
  await store.savePatterns(req.params.id, updated);

  const project = await store.getProject(req.params.id);
  const urlsSelected = updated.filter((p) => p.included).reduce((sum, p) => sum + p.count, 0);
  const patch = { stats: { ...project.stats, urlsSelected } };
  if (vertical) patch.vertical = vertical;
  await store.updateProject(req.params.id, patch);

  res.json(updated);
});

module.exports = router;
