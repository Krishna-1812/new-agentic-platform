// ── Generic Supabase-backed store adapter ────────────────────────────────────
// Mirrors the JSON file-store API used across the app (see
// locationPageBuilder/store.js and modules/*/store.js) so each module's store
// can be reimplemented on top of Supabase with NO change to its exported
// function names, route handlers, or client code.
//
// Table convention: every collection maps to a table with the columns
//   id text primary key, data jsonb not null,
//   created_at timestamptz default now(), updated_at timestamptz default now()
// The FULL record lives in `data` (so record shape is identical to the old
// JSON files); id/created_at/updated_at are mirrored to columns for primary
// key, ordering, and expression-indexed filters (e.g. data->>'project_id').

const crypto = require('crypto');
const { getSupabase } = require('./supabase');

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function fail(op, table, error) {
  throw new Error(`[supabaseStore.${op} ${table}] ${error.message || error}`);
}

// ── Reads ────────────────────────────────────────────────────────────────────

// filter: shallow equality on record fields (matched via data->>key).
// opts.order: { column: 'created_at', ascending: true } (default), or a field
//   inside data via { field: 'name', ascending: true }. opts.limit caps rows.
async function list(table, filter = {}, opts = {}) {
  let q = getSupabase().from(table).select('data');
  for (const [k, v] of Object.entries(filter)) {
    if (v === undefined || v === null) continue;
    q = q.eq(`data->>${k}`, String(v));
  }
  const ascending = opts.ascending !== undefined ? opts.ascending : true;
  if (opts.orderField) {
    q = q.order(`data->>${opts.orderField}`, { ascending });
  } else {
    q = q.order(opts.orderColumn || 'created_at', { ascending });
  }
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) fail('list', table, error);
  return data.map(r => r.data);
}

async function get(table, id) {
  const { data, error } = await getSupabase()
    .from(table).select('data').eq('id', id).maybeSingle();
  if (error) fail('get', table, error);
  return data ? data.data : null;
}

async function findOne(table, filter) {
  const rows = await list(table, filter, { limit: 1 });
  return rows[0] || null;
}

// ── Writes ───────────────────────────────────────────────────────────────────

function rowFor(record) {
  return {
    id: record.id,
    data: record,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

async function insert(table, data, idPrefix) {
  const record = {
    id: data.id || newId(idPrefix || table.slice(0, 3)),
    created_at: data.created_at || nowIso(),
    updated_at: nowIso(),
    ...data,
  };
  // ensure id/timestamps are the canonical ones even if data omitted/overrode
  record.id = data.id || record.id;
  record.created_at = data.created_at || record.created_at;
  record.updated_at = nowIso();
  const { error } = await getSupabase().from(table).insert(rowFor(record));
  if (error) fail('insert', table, error);
  return record;
}

async function update(table, id, patch) {
  const existing = await get(table, id);
  if (!existing) return null;
  const record = { ...existing, ...patch, id, updated_at: nowIso() };
  const { error } = await getSupabase().from(table).update(rowFor(record)).eq('id', id);
  if (error) fail('update', table, error);
  return record;
}

async function remove(table, id) {
  const { error, count } = await getSupabase()
    .from(table).delete({ count: 'exact' }).eq('id', id);
  if (error) fail('remove', table, error);
  return (count || 0) > 0;
}

// Upsert by a natural key (idempotent seeding / caches keyed by a field).
async function upsertBy(table, keyField, data, idPrefix) {
  const existing = await findOne(table, { [keyField]: data[keyField] });
  if (!existing) return insert(table, data, idPrefix);
  return update(table, existing.id, data);
}

// Replace an entire collection with exactly the given rows.
async function replaceAll(table, rows, idPrefix) {
  const stamped = rows.map(r => ({
    id: r.id || newId(idPrefix || table.slice(0, 3)),
    created_at: r.created_at || nowIso(),
    updated_at: nowIso(),
    ...r,
  }));
  const sb = getSupabase();
  // wipe then bulk insert (neq on a value no id ever takes = delete all)
  const del = await sb.from(table).delete().neq('id', '__never__');
  if (del.error) fail('replaceAll(clear)', table, del.error);
  if (stamped.length) {
    const ins = await sb.from(table).insert(stamped.map(rowFor));
    if (ins.error) fail('replaceAll(insert)', table, ins.error);
  }
  return stamped;
}

// Delete every row matching a filter (e.g. all children of a parent id).
async function removeWhere(table, filter = {}) {
  let q = getSupabase().from(table).delete({ count: 'exact' });
  for (const [k, v] of Object.entries(filter)) {
    q = q.eq(`data->>${k}`, String(v));
  }
  const { error, count } = await q;
  if (error) fail('removeWhere', table, error);
  return count || 0;
}

// ── TTL cache (used by locationPageBuilder) ─────────────────────────────────
// Backed by the `cache` table: id text pk (the key), data jsonb = { at, value }.

async function cacheGet(key, ttlMs) {
  const hit = await get('cache', key);
  if (!hit) return null;
  if (ttlMs && Date.now() - hit.at > ttlMs) return null;
  return hit.value;
}

async function cacheSet(key, value) {
  const sb = getSupabase();
  const row = {
    id: key,
    data: { at: Date.now(), value },
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const { error } = await sb.from('cache').upsert(row, { onConflict: 'id' });
  if (error) fail('cacheSet', 'cache', error);
}

function cacheKey(...parts) {
  const raw = parts.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join('|');
  return crypto.createHash('sha1').update(raw).digest('hex');
}

// ── Key/value settings (shared) ──────────────────────────────────────────────
// Backed by the `settings` table: key text pk, value jsonb, updated_at.

async function getSetting(key, fallback = null) {
  const { data, error } = await getSupabase()
    .from('settings').select('value').eq('key', key).maybeSingle();
  if (error) fail('getSetting', 'settings', error);
  return data ? data.value : fallback;
}

async function setSetting(key, value) {
  const { error } = await getSupabase()
    .from('settings').upsert({ key, value, updated_at: nowIso() }, { onConflict: 'key' });
  if (error) fail('setSetting', 'settings', error);
  return value;
}

module.exports = {
  newId, nowIso,
  list, get, findOne,
  insert, update, remove, upsertBy, replaceAll, removeWhere,
  cacheGet, cacheSet, cacheKey,
  getSetting, setSetting,
};
