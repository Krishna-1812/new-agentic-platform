const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const DATA_ROOT = path.join(__dirname, 'data');

function genId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

async function writeAtomic(filePath, data) {
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, filePath);
}

async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function init() {
  await fs.mkdir(DATA_ROOT, { recursive: true });
  const pf = path.join(DATA_ROOT, 'projects.json');
  try { await fs.access(pf); } catch { await writeAtomic(pf, []); }
}

// ── Projects ──────────────────────────────────────────────────────────────────

async function getProjects() {
  return readJson(path.join(DATA_ROOT, 'projects.json'), []);
}

async function getProject(id) {
  const list = await getProjects();
  return list.find(p => p.id === id) || null;
}

async function createProject({ name, domain, industry = '', description = '' }) {
  const list = await getProjects();
  const project = {
    id: genId('proj'),
    name,
    domain: domain || '',
    industry,
    description,
    status: 'draft',
    workflowState: 'input', // input | analyzing | reviewing | generating | complete
    inputType: null,        // hub-and-spoke-complete | url-list-only | hub-and-spoke-partial | mixed
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  list.unshift(project);
  await writeAtomic(path.join(DATA_ROOT, 'projects.json'), list);
  return project;
}

async function updateProject(id, fields) {
  const list = await getProjects();
  const idx = list.findIndex(p => p.id === id);
  if (idx === -1) throw new Error('Project not found');
  list[idx] = { ...list[idx], ...fields, updatedAt: new Date().toISOString() };
  await writeAtomic(path.join(DATA_ROOT, 'projects.json'), list);
  return list[idx];
}

async function deleteProject(id) {
  const list = await getProjects();
  await writeAtomic(path.join(DATA_ROOT, 'projects.json'), list.filter(p => p.id !== id));
  for (const suffix of ['_pages', '_clusters', '_recommendations', '_review']) {
    try { await fs.unlink(path.join(DATA_ROOT, `${id}${suffix}.json`)); } catch {}
  }
}

// ── Pages ─────────────────────────────────────────────────────────────────────

const pagesFile = id => path.join(DATA_ROOT, `${id}_pages.json`);
const getPages = id => readJson(pagesFile(id), []);
const setPages = (id, v) => writeAtomic(pagesFile(id), v);

// ── Clusters ──────────────────────────────────────────────────────────────────

const clustersFile = id => path.join(DATA_ROOT, `${id}_clusters.json`);
const getClusters = id => readJson(clustersFile(id), []);
const setClusters = (id, v) => writeAtomic(clustersFile(id), v);

// ── Recommendations ───────────────────────────────────────────────────────────

const recsFile = id => path.join(DATA_ROOT, `${id}_recommendations.json`);
const getRecommendations = id => readJson(recsFile(id), []);
const setRecommendations = (id, v) => writeAtomic(recsFile(id), v);

// ── Review state ──────────────────────────────────────────────────────────────

const reviewFile = id => path.join(DATA_ROOT, `${id}_review.json`);
const getReviewState = id => readJson(reviewFile(id), null);
const setReviewState = (id, v) => writeAtomic(reviewFile(id), v);

module.exports = {
  init, genId,
  getProjects, getProject, createProject, updateProject, deleteProject,
  getPages, setPages,
  getClusters, setClusters,
  getRecommendations, setRecommendations,
  getReviewState, setReviewState,
};
