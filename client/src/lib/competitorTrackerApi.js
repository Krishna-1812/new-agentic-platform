const BASE = '/api/competitor-tracker';

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

export const ct = {
  meta: () => req('/meta'),

  clients: () => req('/clients'),
  createClient: (body) => req('/clients', { method: 'POST', body: JSON.stringify(body) }),
  updateClient: (id, patch) => req(`/clients/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteClient: (id) => req(`/clients/${id}`, { method: 'DELETE' }),

  addCompetitor: (clientId, body) => req(`/clients/${clientId}/competitors`, { method: 'POST', body: JSON.stringify(body) }),
  removeCompetitor: (clientId, competitorId) => req(`/clients/${clientId}/competitors/${competitorId}`, { method: 'DELETE' }),

  dashboard: (clientId) => req(`/clients/${clientId}/dashboard`),
  run: (clientId) => req(`/clients/${clientId}/run`, { method: 'POST' }),
  runStatus: (clientId) => req(`/clients/${clientId}/run/status`),

  // Page Speed-only refresh — spends no SEMrush units, runs independently
  // of the main analysis.
  runPageSpeed: (clientId) => req(`/clients/${clientId}/run-pagespeed`, { method: 'POST' }),
  runPageSpeedStatus: (clientId) => req(`/clients/${clientId}/run-pagespeed/status`),

  // Content Analysis — top-pages content mix (Part 1) + sitemap structure
  // (Part 2), each with a GPT 5.4 mini summary. Independent of the main
  // analysis and Page Speed.
  contentAnalysis: (clientId) => req(`/clients/${clientId}/content-analysis`),
  runContentAnalysis: (clientId) => req(`/clients/${clientId}/content-analysis/run`, { method: 'POST' }),
  runContentAnalysisStatus: (clientId) => req(`/clients/${clientId}/content-analysis/run/status`),
  regenerateTopPagesSummary: (clientId) => req(`/clients/${clientId}/content-analysis/summary/top-pages`, { method: 'POST' }),
  regenerateSitemapSummary: (clientId) => req(`/clients/${clientId}/content-analysis/summary/sitemap`, { method: 'POST' }),
  // Edit the folder → page-type mapping. edits: { "<template>": "<type>" }.
  updateContentAnalysisMapping: (clientId, edits) => req(`/clients/${clientId}/content-analysis/mapping`, { method: 'POST', body: JSON.stringify({ edits }) }),
};
