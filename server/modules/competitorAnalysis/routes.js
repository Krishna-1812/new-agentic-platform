const express = require('express');
const router = express.Router();

const store = require('./store');
const { fetchClientDashboardData } = require('./dataFetcher');
const { MAX_UNITS_PER_RUN, estimateDomainCost, maxDomainsForBudget } = require('./unitCosts');
const { hasSemrushKey } = require('./provider');

// In-memory run tracking, one entry per client — mirrors the on-page-audit
// module's job-map pattern. A run against the mock provider is instant; a
// run against live SEMrush is not, but this same shape holds either way.
const runs = new Map(); // clientId -> { status, error, startedAt, finishedAt }

router.get('/meta', (req, res) => {
  res.json({
    liveDataSource: hasSemrushKey(),
    capUnits: MAX_UNITS_PER_RUN,
    estimatedCostPerDomain: estimateDomainCost(),
    maxDomainsPerRun: maxDomainsForBudget(),
    maxCompetitors: store.MAX_COMPETITORS,
  });
});

// ── Clients ──────────────────────────────────────────────────────────────────

router.get('/clients', async (req, res) => {
  res.json({ clients: await store.getClients() });
});

router.post('/clients', async (req, res) => {
  try {
    const client = await store.createClient(req.body || {});
    res.json({ client });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.patch('/clients/:clientId', async (req, res) => {
  try {
    const client = await store.updateClient(req.params.clientId, req.body || {});
    res.json({ client });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/clients/:clientId', async (req, res) => {
  await store.deleteClient(req.params.clientId);
  runs.delete(req.params.clientId);
  res.json({ ok: true });
});

router.post('/clients/:clientId/competitors', async (req, res) => {
  try {
    const competitor = await store.addCompetitor(req.params.clientId, req.body || {});
    res.json({ competitor });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/clients/:clientId/competitors/:competitorId', async (req, res) => {
  try {
    await store.removeCompetitor(req.params.clientId, req.params.competitorId);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── Dashboard (cached read — never triggers a fetch) ─────────────────────────

router.get('/clients/:clientId/dashboard', async (req, res) => {
  const client = await store.getClient(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const snapshot = await store.getSnapshot(req.params.clientId);
  res.json({ client, snapshot });
});

// ── Run ──────────────────────────────────────────────────────────────────────

router.post('/clients/:clientId/run', async (req, res) => {
  const { clientId } = req.params;
  const client = await store.getClient(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const existing = runs.get(clientId);
  if (existing && existing.status === 'running') {
    return res.status(409).json({ error: 'A run is already in progress for this client' });
  }

  runs.set(clientId, { status: 'running', error: null, startedAt: Date.now(), finishedAt: null });
  res.json({ status: 'running' });

  // Fire-and-forget — the mock provider is instant, but a future live
  // provider won't be, so this stays async from the start.
  (async () => {
    try {
      const previousSnapshot = await store.getSnapshot(clientId);
      const snapshot = await fetchClientDashboardData(client, previousSnapshot);
      await store.saveSnapshot(clientId, snapshot);
      runs.set(clientId, { status: 'done', error: null, startedAt: runs.get(clientId).startedAt, finishedAt: Date.now() });
    } catch (err) {
      runs.set(clientId, { status: 'error', error: err.message, startedAt: runs.get(clientId)?.startedAt, finishedAt: Date.now() });
    }
  })();
});

router.get('/clients/:clientId/run/status', (req, res) => {
  const run = runs.get(req.params.clientId);
  res.json(run || { status: 'idle', error: null });
});

module.exports = router;
