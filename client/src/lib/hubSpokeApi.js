const BASE = '/api/hub-spoke';

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.blob();
}

export function openStream(projectId, type, token, handlers) {
  const url = type === 'analyze'
    ? `${BASE}/projects/${projectId}/analyze/stream/${token}`
    : `${BASE}/projects/${projectId}/recommendations/stream/${token}`;
  const es = new EventSource(url);
  Object.entries(handlers).forEach(([event, fn]) =>
    es.addEventListener(event, (e) => fn(e.data ? JSON.parse(e.data) : {}))
  );
  return es;
}

export async function xlsxToBase64(file) {
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const chunks = [];
  for (let i = 0; i < uint8Array.length; i += 8192) {
    chunks.push(String.fromCharCode.apply(null, uint8Array.subarray(i, i + 8192)));
  }
  return btoa(chunks.join(''));
}

export const hs = {
  // Projects
  projects: () => req('/projects'),
  createProject: (body) => req('/projects', { method: 'POST', body: JSON.stringify(body) }),
  getProject: (id) => req(`/projects/${id}`),
  updateProject: (id, body) => req(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteProject: (id) => req(`/projects/${id}`, { method: 'DELETE' }),

  // Input
  parseXlsx: (id, body) => req(`/projects/${id}/parse-xlsx`, { method: 'POST', body: JSON.stringify(body) }),
  classifyInput: (id, body) => req(`/projects/${id}/classify-input`, { method: 'POST', body: JSON.stringify(body) }),
  startAnalyze: (id, body) => req(`/projects/${id}/analyze`, { method: 'POST', body: JSON.stringify(body) }),

  // Clusters
  getClusters: (id) => req(`/projects/${id}/clusters`),
  saveClusters: (id, clusters) => req(`/projects/${id}/clusters`, { method: 'PUT', body: JSON.stringify({ clusters }) }),
  approveClusters: (id, body = {}) => req(`/projects/${id}/clusters/approve`, { method: 'POST', body: JSON.stringify(body) }),

  // Recommendations
  startGenerate: (id, body = {}) => req(`/projects/${id}/recommendations/generate`, { method: 'POST', body: JSON.stringify(body) }),
  getGenerateStatus: (id, jobId) => req(`/projects/${id}/recommendations/status/${jobId}`),
  getRecommendations: (id) => req(`/projects/${id}/recommendations`),
  updateRecommendation: (id, recId, body) => req(`/projects/${id}/recommendations/${recId}`, { method: 'PUT', body: JSON.stringify(body) }),
  bulkUpdateRecommendations: (id, body) => req(`/projects/${id}/recommendations/bulk`, { method: 'POST', body: JSON.stringify(body) }),

  // Export — returns blob
  exportHubSpoke: (id, format = 'xlsx') => req(`/projects/${id}/export/hub-spoke?format=${format}`),
  exportRecommendations: (id, body = {}, format = 'xlsx') =>
    req(`/projects/${id}/export/recommendations?format=${format}`, { method: 'POST', body: JSON.stringify(body) }),
};
