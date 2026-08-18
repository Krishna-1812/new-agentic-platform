const BASE = '/api/content-architect';

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

export const ca = {
  projects: () => req('/projects'),
  createProject: (domain) => req('/projects', { method: 'POST', body: JSON.stringify({ domain }) }),
  getProject: (id) => req(`/projects/${id}`),
  deleteProject: (id) => req(`/projects/${id}`, { method: 'DELETE' }),

  // Stage 1 — init-token + SSE stream, same pattern as keywordResearch.js.
  discoverInit: (id) => req(`/projects/${id}/discover`, { method: 'POST' }),
  discoverStreamUrl: (id, token) => `${BASE}/projects/${id}/discover/stream/${token}`,

  // Stage 2
  getPatterns: (id) => req(`/projects/${id}/patterns`),
  savePatterns: (id, included, vertical) => req(`/projects/${id}/patterns`, { method: 'PUT', body: JSON.stringify({ included, vertical }) }),
};
