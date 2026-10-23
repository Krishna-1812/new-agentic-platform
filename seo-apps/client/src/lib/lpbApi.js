// ── Location Page Builder — API helpers ─────────────────────────────────────
const BASE = '/api/location-page-builder';

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
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

export const lpb = {
  // Not seeding-as-setup: the wizard's "Sync list" re-imports a changed
  // service/location taxonomy mid-session, so a change to seed.js reaches the
  // pickers without a deploy step. Re-runnable; hand-entered NAP is preserved.
  seedClearBehavioral: () => req('/seed-clear-behavioral', { method: 'POST' }),

  // ── Clear Behavioral Health ───────────────────────────────────────────────
  // `cbhBriefBuild` and `cbhGenerate` are the billed calls; the rest are cheap.
  cbhLimits: () => req('/cbh/limits'),
  cbhBrief: ({ clientId, serviceId, locationId }) =>
    req(`/cbh/brief?clientId=${clientId}&serviceId=${serviceId}&locationId=${locationId}`),
  cbhBriefBuild: (body) => req('/cbh/brief/build', { method: 'POST', body: JSON.stringify(body) }),
  cbhBriefSave: (body) => req('/cbh/brief/save', { method: 'POST', body: JSON.stringify(body) }),
  cbhGenerate: (body) => req('/cbh/generate', { method: 'POST', body: JSON.stringify(body) }),
  cbhSavePage: (id, page) => req(`/cbh/pages/${id}`, { method: 'PUT', body: JSON.stringify({ page }) }),
  cbhQc: (page) => req('/cbh/qc', { method: 'POST', body: JSON.stringify({ page }) }),
  cbhRegenField: (body) => req('/cbh/regen-field', { method: 'POST', body: JSON.stringify(body) }),
  cbhPages: (clientId) => req(`/cbh/pages?clientId=${encodeURIComponent(clientId)}`),
  cbhPage: (id) => req(`/cbh/pages/${id}`),
  cbhDeletePage: (id) => req(`/cbh/pages/${id}`, { method: 'DELETE' }),
  cbhExportJson: (page) => req('/cbh/export/json', { method: 'POST', body: JSON.stringify({ page }) }),
  cbhExportDocx: async (page) => {
    const res = await fetch(`${BASE}/cbh/export/docx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ page }),
    });
    if (!res.ok) {
      let msg = `Export failed (${res.status})`;
      try { msg = (await res.json()).error || msg; } catch { /* non-JSON error body */ }
      throw new Error(msg);
    }
    const named = /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') || '');
    return { blob: await res.blob(), filename: named ? named[1] : 'cbh_page.docx' };
  },

  clients: () => req('/clients'),
  client: (id) => req(`/clients/${id}`),
  entities: (c, clientId) => req(`/entities/${c}${clientId ? `?client_id=${clientId}` : ''}`),
  createEntity: (c, body) => req(`/entities/${c}`, { method: 'POST', body: JSON.stringify(body) }),
  updateEntity: (c, id, body) => req(`/entities/${c}/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  pages: (clientId) => req(`/pages${clientId ? `?client_id=${clientId}` : ''}`),
  page: (id) => req(`/pages/${id}`),
  createPage: (body) => req('/pages', { method: 'POST', body: JSON.stringify(body) }),
  deletePage: (id) => req(`/pages/${id}`, { method: 'DELETE' }),

  runKeywords: (id) => req(`/pages/${id}/keywords/run`, { method: 'POST' }),
  runContent: (id) => req(`/pages/${id}/content/run`, { method: 'POST' }),
  saveKeywords: (id, body) => req(`/pages/${id}/keywords`, { method: 'PUT', body: JSON.stringify(body) }),
  finalizeKeywords: (id) => req(`/pages/${id}/keywords/finalize`, { method: 'POST' }),

  editSection: (id, body) => req(`/pages/${id}/section`, { method: 'PUT', body: JSON.stringify(body) }),
  saveContent: (id, body) => req(`/pages/${id}/content`, { method: 'PUT', body: JSON.stringify(body) }),
  rerunQA: (id) => req(`/pages/${id}/qa`, { method: 'POST' }),
  regenField: (id, body) => req(`/pages/${id}/content/regen-field`, { method: 'POST', body: JSON.stringify(body) }),
  gate: (id, body) => req(`/pages/${id}/gate`, { method: 'POST', body: JSON.stringify(body) }),
  comment: (id, body) => req(`/pages/${id}/comments`, { method: 'POST', body: JSON.stringify(body) }),

  exportUrl: (id, format) => `${BASE}/pages/${id}/export/${format}`,

  // ── Wizard keyword research (shared by the wizards) ──────────────────────
  keywordCandidates: (body) => req('/keyword-candidates', { method: 'POST', body: JSON.stringify(body) }),

  // Approved keywords, saved on approval rather than only as a byproduct of
  // generating — so leaving before generating no longer loses the work, and
  // re-opening a page never silently re-runs the billed research call.
  wizardSaveKeywords: (body) => req('/wizard/keywords', { method: 'POST', body: JSON.stringify(body) }),
  wizardGetKeywords: ({ clientId, serviceId, locationId }) =>
    req(`/wizard/keywords?clientId=${encodeURIComponent(clientId)}&serviceId=${encodeURIComponent(serviceId)}&locationId=${encodeURIComponent(locationId)}`),
};

// Open an SSE stream for a minted token; returns the EventSource.
export function openStream(token, handlers) {
  const es = new EventSource(`${BASE}/stream/${token}`);
  Object.entries(handlers).forEach(([event, fn]) => {
    es.addEventListener(event, (e) => fn(e.data ? JSON.parse(e.data) : {}));
  });
  return es;
}
