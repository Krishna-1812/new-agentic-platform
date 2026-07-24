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
  seed: () => req('/seed', { method: 'POST' }),
  seedGentleDental: () => req('/seed-gentle-dental', { method: 'POST' }),
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

  // ── Gentle Dental wizard ──────────────────────────────────────────────────
  keywordCandidates: (body) => req('/keyword-candidates', { method: 'POST', body: JSON.stringify(body) }),
  wizardGenerate: (body) => req('/wizard/generate', { method: 'POST', body: JSON.stringify(body) }),
  wizardQc: (page) => req('/wizard/qc', { method: 'POST', body: JSON.stringify({ page }) }),
  wizardExisting: ({ clientId, serviceId, locationId }) =>
    req(`/wizard/existing?clientId=${encodeURIComponent(clientId)}&serviceId=${encodeURIComponent(serviceId)}&locationId=${encodeURIComponent(locationId)}`),
  wizardRegenerate: (body) => req('/wizard/regenerate', { method: 'POST', body: JSON.stringify(body) }),
  wizardPages: (clientId) => req(`/wizard/pages?clientId=${encodeURIComponent(clientId)}`),
  wizardPage: (id) => req(`/wizard/pages/${id}`),
};

// Open an SSE stream for a minted token; returns the EventSource.
export function openStream(token, handlers) {
  const es = new EventSource(`${BASE}/stream/${token}`);
  Object.entries(handlers).forEach(([event, fn]) => {
    es.addEventListener(event, (e) => fn(e.data ? JSON.parse(e.data) : {}));
  });
  return es;
}
