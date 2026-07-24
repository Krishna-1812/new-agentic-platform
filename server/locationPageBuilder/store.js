// ── Location Page Builder persistence — backed by Supabase ───────────────────
// Was JSON files on disk; now delegates to the shared Supabase store adapter.
// The public API (list/get/findOne/insert/update/remove/upsertBy/replaceAll +
// cache*) is unchanged, so routes and the seeder need no changes. Each
// collection maps to a table named `lpb_<lowercased collection>` (see
// supabase/migrations/0001_init.sql).

const crypto = require('crypto');
const config = require('./config');
const store = require('../services/supabaseStore');

const ROOT = config.dataRoot; // kept for backward-compat exports (unused for IO)

// Top-level collections (L1/L2 reference data + pages).
const COLLECTIONS = [
  'clients', 'globalTemplates', 'services', 'locations', 'providers',
  'reviews', 'insuranceSets', 'resources', 'toneProfiles', 'pages',
];

function tableFor(collection) {
  return `lpb_${String(collection).toLowerCase()}`;
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

// ── Generic CRUD (delegates to the Supabase adapter) ─────────────────────────

async function list(collection, filter = {}) {
  return store.list(tableFor(collection), filter);
}

async function get(collection, id) {
  return store.get(tableFor(collection), id);
}

async function findOne(collection, filter) {
  return store.findOne(tableFor(collection), filter);
}

async function insert(collection, data, idPrefix) {
  return store.insert(tableFor(collection), data, idPrefix || collection.slice(0, 3));
}

async function update(collection, id, patch) {
  return store.update(tableFor(collection), id, patch);
}

async function remove(collection, id) {
  return store.remove(tableFor(collection), id);
}

async function replaceAll(collection, rows) {
  return store.replaceAll(tableFor(collection), rows, collection.slice(0, 3));
}

async function upsertBy(collection, keyField, data, idPrefix) {
  return store.upsertBy(tableFor(collection), keyField, data, idPrefix || collection.slice(0, 3));
}

async function removeWhere(collection, filter) {
  return store.removeWhere(tableFor(collection), filter);
}

// Replace only the rows belonging to one client, leaving other clients'
// rows in the same (shared) table untouched. Use this instead of
// `replaceAll` for any multi-client collection (services/locations/etc.) —
// `replaceAll` wipes the WHOLE table, which would delete every other
// client's rows too.
async function replaceAllForClient(collection, clientId, rows) {
  await removeWhere(collection, { client_id: clientId });
  const inserted = [];
  for (const row of rows) {
    inserted.push(await insert(collection, row, collection.slice(0, 3)));
  }
  return inserted;
}

// ── Cache (Spec §14): keyed JSON blobs with TTL ──────────────────────────────

const cacheGet = (key, ttlMs) => store.cacheGet(key, ttlMs);
const cacheSet = (key, value) => store.cacheSet(key, value);
const cacheKey = (...parts) => store.cacheKey(...parts);

module.exports = {
  ROOT, COLLECTIONS, newId, nowIso,
  list, get, findOne, insert, update, remove, upsertBy, replaceAll,
  removeWhere, replaceAllForClient,
  cacheGet, cacheSet, cacheKey,
};
