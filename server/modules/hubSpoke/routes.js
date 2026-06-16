const express = require('express');
const crypto = require('crypto');
const store = require('./store');
const { parseXlsx } = require('./xlsxParser');
const { classifyText, classifyParsedXlsx, extractUrls } = require('./inputClassifier');
const { analyzeUrls } = require('./urlAnalyzer');
const { generateClusters } = require('./clusterGenerator');
const { generateRecommendations } = require('./recommendationGenerator');
const { exportHubSpoke, exportRecommendations } = require('./exporter');

const router = express.Router();

// In-memory SSE job registry: token → { send, end, done }
const jobs = new Map();

function newToken() { return crypto.randomBytes(16).toString('hex'); }

function sseStream(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (res.flush) res.flush();
  };
  const end = () => { res.write('event: done\ndata: {}\n\n'); res.end(); };
  return { send, end };
}

// ── Projects ──────────────────────────────────────────────────────────────────

router.get('/projects', async (req, res) => {
  try {
    res.json(await store.getProjects());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/projects', async (req, res) => {
  try {
    const { name, domain, industry, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Project name is required.' });
    if (!domain?.trim()) return res.status(400).json({ error: 'Domain is required.' });
    const project = await store.createProject({ name: name.trim(), domain: domain.trim(), industry, description });
    res.json(project);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/projects/:id', async (req, res) => {
  try {
    const project = await store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const [clusters, pages, reviewState] = await Promise.all([
      store.getClusters(project.id),
      store.getPages(project.id),
      store.getReviewState(project.id),
    ]);
    res.json({ ...project, clusters, pages, reviewState });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/projects/:id', async (req, res) => {
  try {
    const allowed = ['name', 'domain', 'industry', 'description', 'status', 'workflowState', 'inputType'];
    const fields = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) fields[k] = req.body[k]; });
    res.json(await store.updateProject(req.params.id, fields));
  } catch (e) {
    res.status(e.message === 'Project not found' ? 404 : 500).json({ error: e.message });
  }
});

router.delete('/projects/:id', async (req, res) => {
  try {
    await store.deleteProject(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Input: Parse XLSX ─────────────────────────────────────────────────────────

router.post('/projects/:id/parse-xlsx', async (req, res) => {
  try {
    const project = await store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const { fileData, fileName } = req.body;
    if (!fileData) return res.status(400).json({ error: 'fileData (base64) is required.' });

    const buffer = Buffer.from(fileData, 'base64');
    const parseResult = await parseXlsx(buffer);
    const inputType = classifyParsedXlsx(parseResult);

    // Save clusters to store
    const clusters = parseResult.clusters.map((c, i) => ({
      id: store.genId('cl'),
      ...c,
      order: i,
    }));

    await store.setClusters(project.id, clusters);
    await store.updateProject(project.id, {
      workflowState: 'reviewing',
      inputType,
    });

    res.json({ inputType, clusters, summary: parseResult.summary, flaggedRows: parseResult.flaggedRows, dualClusterSpokes: parseResult.dualClusterSpokes, gapHubs: parseResult.gapHubs });
  } catch (e) {
    console.error('[HubSpoke] parse-xlsx error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Input: Classify plain text ────────────────────────────────────────────────

router.post('/projects/:id/classify-input', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text is required.' });
    const classification = classifyText(text);
    const urls = classification.type !== 'invalid' ? extractUrls(text) : [];
    res.json({ ...classification, urlCount: urls.length, urls });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Input: Analyze URL list (SSE) ─────────────────────────────────────────────

router.post('/projects/:id/analyze', async (req, res) => {
  try {
    const project = await store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const { urls } = req.body;
    if (!Array.isArray(urls) || urls.length === 0) return res.status(400).json({ error: 'urls array is required.' });
    if (urls.length > 500) return res.status(400).json({ error: 'Maximum 500 URLs per analysis.' });

    const token = newToken();
    res.json({ token });

    // Run async after response
    setImmediate(async () => {
      const jobEntry = jobs.get(token);
      if (!jobEntry) return;
      const { send, end } = jobEntry;

      try {
        send('step', { id: 'fetch', status: 'active', message: `Fetching page data for ${urls.length} URLs…` });

        const analyzed = await analyzeUrls(urls, (done, total, url) => {
          send('step', { id: 'fetch', status: 'active', message: `Fetched ${done}/${total}`, url });
        });

        send('step', { id: 'fetch', status: 'done', message: `Analyzed ${analyzed.length} pages.` });
        send('step', { id: 'cluster', status: 'active', message: 'Generating hub and spoke structure with AI…' });

        const clusterResult = await generateClusters(analyzed, (msg) => {
          send('step', { id: 'cluster', status: 'active', message: msg });
        });

        // Persist pages and clusters
        const pages = analyzed.map(p => ({ ...p, id: store.genId('pg') }));
        await store.setPages(project.id, pages);

        const clusters = clusterResult.clusters.map((c, i) => ({
          id: store.genId('cl'),
          ...c,
          order: i,
        }));
        await store.setClusters(project.id, clusters);

        await store.updateProject(project.id, {
          workflowState: 'reviewing',
          inputType: 'url-list-only',
        });

        send('step', { id: 'cluster', status: 'done', message: `Generated ${clusters.length} clusters.` });
        send('ready', {
          clusters,
          pages,
          unassignedPages: clusterResult.unassignedPages,
          cannibalizationFlags: clusterResult.cannibalizationFlags,
          gapHubs: clusterResult.gapHubs,
          warnings: clusterResult.warnings,
        });
      } catch (e) {
        send('fail', { message: e.message });
      } finally {
        end();
        jobs.delete(token);
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SSE stream endpoint for analyze job
router.get('/projects/:id/analyze/stream/:token', (req, res) => {
  const { send, end } = sseStream(res);
  const token = req.params.token;
  jobs.set(token, { send, end });

  req.on('close', () => { jobs.delete(token); });

  // Heartbeat
  const hb = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(hb); }
  }, 15000);
  res.on('close', () => clearInterval(hb));
});

// ── Clusters: read / update / approve ─────────────────────────────────────────

router.get('/projects/:id/clusters', async (req, res) => {
  try {
    res.json(await store.getClusters(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Full cluster structure replace (after review edits)
router.put('/projects/:id/clusters', async (req, res) => {
  try {
    const { clusters } = req.body;
    if (!Array.isArray(clusters)) return res.status(400).json({ error: 'clusters array required.' });
    await store.setClusters(req.params.id, clusters);
    res.json({ ok: true, count: clusters.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Approve structure — triggers transition to generating state
router.post('/projects/:id/clusters/approve', async (req, res) => {
  try {
    const project = await store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const reviewState = {
      state: 'approved',
      approvedAt: new Date().toISOString(),
      notes: req.body.notes || '',
    };
    await store.setReviewState(project.id, reviewState);
    await store.updateProject(project.id, { workflowState: 'approved' });
    res.json({ ok: true, reviewState });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Recommendations: generate (polling job) ───────────────────────────────────

// In-memory job registry for recommendation generation (polling-based)
const recJobs = new Map();

// Auto-cleanup jobs older than 2 hours
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of recJobs.entries()) {
    if (new Date(job.startedAt).getTime() < cutoff) recJobs.delete(id);
  }
}, 30 * 60 * 1000);

router.post('/projects/:id/recommendations/generate', async (req, res) => {
  try {
    const project = await store.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const reviewState = await store.getReviewState(project.id);
    if (!reviewState || reviewState.state !== 'approved') {
      return res.status(400).json({ error: 'Hub and spoke structure must be approved before generating recommendations.' });
    }

    const jobId = newToken();
    const job = {
      jobId,
      projectId: project.id,
      status: 'queued',
      currentStep: 'validate',
      currentClusterName: null,
      clustersTotal: 0,
      clustersProcessed: 0,
      pagesTotal: 0,
      recommendationsGenerated: 0,
      anchorSourcesTotal: 0,
      anchorSourcesProcessed: 0,
      currentAnchorSourceUrl: null,
      errors: [],
      errorMessage: null,
      failedStep: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    recJobs.set(jobId, job);

    res.status(202).json({ jobId });

    setImmediate(async () => {
      function update(fields) {
        const j = recJobs.get(jobId);
        if (j) Object.assign(j, fields);
      }

      try {
        update({ status: 'running', currentStep: 'validate' });

        const [clusters, rawPages] = await Promise.all([
          store.getClusters(project.id),
          store.getPages(project.id),
        ]);

        // XLSX imports never run URL analysis so the pages store is empty.
        // Build a synthetic page list from the cluster data so validateRec
        // can match source/target URLs instead of silently dropping everything.
        let pages = rawPages;
        if (pages.length === 0 && clusters.length > 0) {
          const seen = new Map();
          for (const c of clusters) {
            if (c.hubPage?.url && !seen.has(c.hubPage.url)) {
              seen.set(c.hubPage.url, {
                url: c.hubPage.url,
                title: c.hubPage.title || c.name || c.clusterName,
                id: store.genId('pg'),
              });
            }
            for (const s of c.spokes || []) {
              if (s.url && !seen.has(s.url)) {
                seen.set(s.url, {
                  url: s.url,
                  title: s.title,
                  id: store.genId('pg'),
                });
              }
            }
          }
          pages = Array.from(seen.values());
        }

        update({
          currentStep: 'prepare',
          clustersTotal: clusters.length,
          pagesTotal: pages.length,
        });

        const options = {
          includeGapHubs: req.body?.includeGapHubs || false,
          excludedUrls: req.body?.excludedUrls || [],
        };

        const recs = await generateRecommendations(clusters, pages, options, (progress) => {
          if (progress.step === 'prepare') {
            update({ currentStep: 'prepare', clustersTotal: progress.clustersTotal, pagesTotal: progress.pagesTotal });
          } else if (progress.step === 'per-cluster') {
            update({
              currentStep: 'per-cluster',
              currentClusterName: progress.currentClusterName,
              clustersProcessed: progress.clustersProcessed,
              recommendationsGenerated: progress.recommendationsGenerated,
            });
            if (progress.clusterError) {
              const j = recJobs.get(jobId);
              if (j) j.errors.push(`Cluster "${progress.currentClusterName}": ${progress.clusterError}`);
            }
          } else if (progress.step === 'cross-cluster') {
            update({ currentStep: 'cross-cluster', recommendationsGenerated: progress.recommendationsGenerated });
          } else if (progress.step === 'validating') {
            update({ currentStep: 'validating', recommendationsGenerated: progress.recommendationsGenerated });
          } else if (progress.step === 'anchor-text') {
            update({
              currentStep: 'anchor-text',
              anchorSourcesTotal: progress.sourcesTotal || 0,
              anchorSourcesProcessed: progress.sourcesProcessed || 0,
              currentAnchorSourceUrl: progress.currentSourceUrl || null,
            });
          }
        });

        update({ currentStep: 'saving' });

        const pageMap = {};
        pages.forEach(p => { pageMap[p.url] = p; });

        const enriched = recs.map(r => {
          const src = pageMap[r.sourceUrl];
          const tgt = pageMap[r.targetUrl];
          const cluster = clusters.find(c =>
            c.hubPage?.url === r.sourceUrl ||
            (c.spokes || []).some(s => s.url === r.sourceUrl)
          );
          return {
            ...r,
            clusterName: cluster?.clusterName || cluster?.name || '',
            sourceTitle: src?.title || src?.inferredTopic || r.sourceUrl,
            targetTitle: tgt?.title || tgt?.inferredTopic || r.targetUrl,
          };
        });

        await store.setRecommendations(project.id, enriched);
        await store.updateProject(project.id, { workflowState: 'complete' });

        update({
          status: 'complete',
          currentStep: 'done',
          recommendationsGenerated: enriched.length,
          completedAt: new Date().toISOString(),
        });
      } catch (e) {
        const j = recJobs.get(jobId);
        update({
          status: 'failed',
          errorMessage: e.message,
          failedStep: j?.currentStep || 'unknown',
        });
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Polling endpoint for recommendation generation job status
router.get('/projects/:id/recommendations/status/:jobId', (req, res) => {
  const job = recJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired.' });
  if (job.projectId !== req.params.id) return res.status(403).json({ error: 'Job does not belong to this project.' });
  res.json(job);
});

// ── Recommendations: read / update ───────────────────────────────────────────

router.get('/projects/:id/recommendations', async (req, res) => {
  try {
    res.json(await store.getRecommendations(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update single recommendation (status, anchor, placement)
router.put('/projects/:id/recommendations/:recId', async (req, res) => {
  try {
    const recs = await store.getRecommendations(req.params.id);
    const idx = recs.findIndex(r => r.id === req.params.recId);
    if (idx === -1) return res.status(404).json({ error: 'Recommendation not found.' });
    const allowed = ['status', 'editedAnchorText', 'editedPlacement', 'anchorWarnings'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    recs[idx] = { ...recs[idx], ...updates };
    await store.setRecommendations(req.params.id, recs);
    res.json(recs[idx]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Bulk status update
router.post('/projects/:id/recommendations/bulk', async (req, res) => {
  try {
    const { ids, status, priority } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required.' });
    const recs = await store.getRecommendations(req.params.id);
    const idSet = new Set(ids);
    recs.forEach(r => {
      if (!idSet.has(r.id)) return;
      if (status) r.status = status;
      if (priority) r.priority = priority;
    });
    await store.setRecommendations(req.params.id, recs);
    res.json({ ok: true, updated: ids.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Export ────────────────────────────────────────────────────────────────────

router.get('/projects/:id/export/hub-spoke', async (req, res) => {
  try {
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
    const clusters = await store.getClusters(req.params.id);
    const buf = await exportHubSpoke(clusters, format);
    const mime = format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const ext = format === 'csv' ? 'csv' : 'xlsx';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="hub-spoke.${ext}"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/projects/:id/export/recommendations', async (req, res) => {
  try {
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
    let recs = await store.getRecommendations(req.params.id);

    // Apply filters from body
    const { filterStatus, filterLinkType, filterCluster, filterMinScore } = req.body || {};
    if (filterStatus?.length) recs = recs.filter(r => filterStatus.includes(r.status));
    if (filterLinkType?.length) recs = recs.filter(r => filterLinkType.includes(r.linkType));
    if (filterCluster?.length) recs = recs.filter(r => filterCluster.includes(r.clusterName));
    if (filterMinScore != null) recs = recs.filter(r => r.relevanceScore >= filterMinScore);

    const buf = await exportRecommendations(recs, format);
    const mime = format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const ext = format === 'csv' ? 'csv' : 'xlsx';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="recommendations.${ext}"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
