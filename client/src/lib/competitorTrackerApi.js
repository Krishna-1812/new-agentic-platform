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
};
