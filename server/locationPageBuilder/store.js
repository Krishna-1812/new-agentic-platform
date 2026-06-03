// ── File-based persistence for the Location Page Builder module ──────────────
// Mirrors the app's existing file-store convention (see services/kbStore.js):
// no SQL/ORM in this app, so each collection is a JSON file on disk.
// Conceptual tables from Spec §3.2 map to collections here. Page sub-objects
// (keyword_set, page_object, qa_result, approvals, versions, comments,
// competitor_analysis) are embedded in the page record for atomic reads.

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const ROOT = config.dataRoot;

// Top-level collections (L1/L2 reference data + pages). One JSON file each.
const COLLECTIONS = [
  'clients', 'globalTemplates', 'services', 'locations', 'providers',
  'reviews', 'insuranceSets', 'resources', 'toneProfiles', 'pages',
];

// ── Low-level file IO ────────────────────────────────────────────────────────

function fileFor(collection) {
  return path.join(ROOT, `${collection}.json`);
}

async function readCollection(collection) {
  try {
    const raw = await fs.readFile(fileFor(collection), 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeCollection(collection, rows) {
  await fs.mkdir(ROOT, { recursive: true });
  await fs.writeFile(fileFor(collection), JSON.stringify(rows, null, 2), 'utf8');
}

// ── Generic CRUD ─────────────────────────────────────────────────────────────

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

async function list(collection, filter = {}) {
  const rows = await readCollection(collection);
  const keys = Object.keys(filter);
  if (!keys.length) return rows;
  return rows.filter(r => keys.every(k => r[k] === filter[k]));
}

async function get(collection, id) {
  const rows = await readCollection(collection);
  return rows.find(r => r.id === id) || null;
}

async function findOne(collection, filter) {
  const rows = await list(collection, filter);
  return rows[0] || null;
}

async function insert(collection, data, idPrefix) {
  const rows = await readCollection(collection);
  const record = {
    id: data.id || newId(idPrefix || collection.slice(0, 3)),
    created_at: nowIso(),
    updated_at: nowIso(),
    ...data,
  };
  rows.push(record);
  await writeCollection(collection, rows);
  return record;
}

async function update(collection, id, patch) {
  const rows = await readCollection(collection);
  const idx = rows.findIndex(r => r.id === id);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...patch, id, updated_at: nowIso() };
  await writeCollection(collection, rows);
  return rows[idx];
}

async function remove(collection, id) {
  const rows = await readCollection(collection);
  const next = rows.filter(r => r.id !== id);
  await writeCollection(collection, next);
  return next.length !== rows.length;
}

// Replace an entire collection with the given rows (used by the seeder so the
// catalog is exactly the seeded set — no stale entries from prior seeds).
async function replaceAll(collection, rows) {
  const stamped = rows.map(r => ({
    id: r.id || newId(collection.slice(0, 3)),
    created_at: r.created_at || nowIso(),
    updated_at: nowIso(),
    ...r,
  }));
  await writeCollection(collection, stamped);
  return stamped;
}

// Upsert by a natural key (used by the seeder so re-seeding is idempotent).
async function upsertBy(collection, keyField, data, idPrefix) {
  const rows = await readCollection(collection);
  const idx = rows.findIndex(r => r[keyField] === data[keyField]);
  if (idx === -1) return insert(collection, data, idPrefix);
  rows[idx] = { ...rows[idx], ...data, updated_at: nowIso() };
  await writeCollection(collection, rows);
  return rows[idx];
}

// ── Cache (Spec §14): keyed JSON blobs with TTL, so re-runs don't re-bill ────

async function cacheGet(key, ttlMs) {
  const cache = await readCollection('_cache').catch(() => ({}));
  const map = Array.isArray(cache) ? {} : cache;
  const hit = map[key];
  if (!hit) return null;
  if (ttlMs && Date.now() - hit.at > ttlMs) return null;
  return hit.value;
}

async function cacheSet(key, value) {
  let map = await readCollection('_cache').catch(() => ({}));
  if (Array.isArray(map)) map = {};
  map[key] = { at: Date.now(), value };
  await fs.mkdir(ROOT, { recursive: true });
  await fs.writeFile(fileFor('_cache'), JSON.stringify(map, null, 2), 'utf8');
}

function cacheKey(...parts) {
  const raw = parts.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join('|');
  return crypto.createHash('sha1').update(raw).digest('hex');
}

module.exports = {
  ROOT, COLLECTIONS, newId, nowIso,
  list, get, findOne, insert, update, remove, upsertBy, replaceAll,
  cacheGet, cacheSet, cacheKey,
};
