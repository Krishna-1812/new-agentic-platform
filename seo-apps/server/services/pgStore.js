// ── Postgres-backed store adapter ────────────────────────────────────────────
// Same exported API as supabaseStore.js, talking to a plain Postgres database
// (Railway's, via DATABASE_URL) instead of Supabase's REST layer. supabaseStore
// hands every call over to this module when Supabase isn't configured but
// DATABASE_URL is, so the Location Page Builder, its cache and its settings
// work unchanged on either backend.
//
// Everything lives in its own schema (SEO_DB_SCHEMA, default "seo_studio"), so
// the SEO tables can share a database with the main platform without any
// chance of a name clash (both sides would otherwise want a table called
// `cache`). Tables are created on first use, which stands in for the
// supabase/migrations files: there is no migration step to forget.
//
// Row shape matches the Supabase tables exactly: id text primary key, the full
// record in data jsonb, and created_at/updated_at mirrored to columns.

const crypto = require('crypto');
const { Pool } = require('pg');

const SCHEMA = process.env.SEO_DB_SCHEMA || 'seo_studio';
const IDENT = /^[a-z_][a-z0-9_]*$/;

let pool = null;
let schemaReady = null;
const tablesReady = new Map();

function ident(name) {
  const s = String(name);
  if (!IDENT.test(s)) throw new Error(`[pgStore] refusing unsafe identifier "${s}"`);
  return s;
}

function q(table) {
  return `"${ident(SCHEMA)}"."${ident(table)}"`;
}

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Database is not configured. Set DATABASE_URL (or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
  }
  pool = new Pool({ connectionString, max: Number(process.env.SEO_DB_POOL_MAX || 5) });
  pool.on('error', err => console.error('[pgStore] idle client error:', err.message));
  return pool;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getPool().query(`create schema if not exists "${ident(SCHEMA)}"`)
      .catch(err => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

// DDL for the three table shapes the app uses.
function ddlFor(table) {
  if (table === 'settings') {
    return [`create table if not exists ${q('settings')} (
      key text primary key, value jsonb, updated_at timestamptz not null default now())`];
  }
  if (table === 'lpb_keyword_universe') {
    const t = q(table);
    return [
      `create table if not exists ${t} (
        id bigint generated always as identity primary key,
        client_id text not null, keyword text not null, keyword_norm text not null,
        semrush_sv integer not null default 0, pillar text, cluster text, subtopic text,
        geo_type text, geo_detected text, geo_detected_norm text not null default '',
        data_confidence text, imported_at timestamptz not null default now())`,
      `create index if not exists lpb_ku_client_geo on ${t} (client_id, geo_detected_norm)`,
      `create index if not exists lpb_ku_client_cluster on ${t} (client_id, cluster)`,
    ];
  }
  const t = q(table);
  const stmts = [
    `create table if not exists ${t} (
      id text primary key, data jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
      ${table === 'cache' ? ', kind text, expires_at timestamptz' : ''})`,
  ];
  if (table === 'cache') {
    stmts.push(`create index if not exists cache_expires_idx on ${t} (expires_at) where expires_at is not null`);
  } else {
    stmts.push(`create index if not exists ${ident(table)}_client_idx on ${t} ((data->>'client_id'))`);
    stmts.push(`create index if not exists ${ident(table)}_tuple_idx on ${t} ((data->>'tuple_key'))`);
  }
  return stmts;
}

async function ensureTable(table) {
  ident(table);
  if (!tablesReady.has(table)) {
    const p = (async () => {
      await ensureSchema();
      for (const sql of ddlFor(table)) await getPool().query(sql);
    })().catch(err => { tablesReady.delete(table); throw err; });
    tablesReady.set(table, p);
  }
  return tablesReady.get(table);
}

async function run(table, sql, params = []) {
  await ensureTable(table);
  return getPool().query(sql, params);
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function fail(op, table, error) {
  throw new Error(`[pgStore.${op} ${table}] ${error.message || error}`);
}

// filter keys become data->>'key' = $n; values are compared as text, the same
// as the Supabase adapter's .eq('data->>key', String(v)).
function whereFor(filter, params) {
  const parts = [];
  for (const [k, v] of Object.entries(filter || {})) {
    if (v === undefined || v === null) continue;
    params.push(String(k), String(v));
    parts.push(`data->>$${params.length - 1} = $${params.length}`);
  }
  return parts.length ? `where ${parts.join(' and ')}` : '';
}

// ── Reads ────────────────────────────────────────────────────────────────────

async function list(table, filter = {}, opts = {}) {
  const params = [];
  const where = whereFor(filter, params);
  const dir = opts.ascending === false ? 'desc' : 'asc';
  let order;
  if (opts.orderField) {
    params.push(String(opts.orderField));
    order = `data->>$${params.length} ${dir}`;
  } else {
    const col = opts.orderColumn || 'created_at';
    if (!['created_at', 'updated_at', 'id'].includes(col)) throw new Error(`[pgStore.list] bad order column ${col}`);
    order = `${col} ${dir}`;
  }
  let limit = '';
  if (opts.limit) { params.push(Number(opts.limit)); limit = `limit $${params.length}`; }
  try {
    const { rows } = await run(table, `select data from ${q(table)} ${where} order by ${order} ${limit}`, params);
    return rows.map(r => r.data);
  } catch (e) { fail('list', table, e); }
}

async function get(table, id) {
  try {
    const { rows } = await run(table, `select data from ${q(table)} where id = $1`, [String(id)]);
    return rows[0] ? rows[0].data : null;
  } catch (e) { fail('get', table, e); }
}

async function findOne(table, filter) {
  const rows = await list(table, filter, { limit: 1 });
  return rows[0] || null;
}

// ── Writes ───────────────────────────────────────────────────────────────────

async function writeRow(table, record, onConflict) {
  const sql = `insert into ${q(table)} (id, data, created_at, updated_at) values ($1, $2, $3, $4)`
    + (onConflict ? ' on conflict (id) do update set data = excluded.data, created_at = excluded.created_at, updated_at = excluded.updated_at' : '');
  await run(table, sql, [record.id, JSON.stringify(record), record.created_at, record.updated_at]);
}

async function insert(table, data, idPrefix) {
  const record = {
    id: data.id || newId(idPrefix || table.slice(0, 3)),
    created_at: data.created_at || nowIso(),
    updated_at: nowIso(),
    ...data,
  };
  record.id = data.id || record.id;
  record.created_at = data.created_at || record.created_at;
  record.updated_at = nowIso();
  try { await writeRow(table, record, false); } catch (e) { fail('insert', table, e); }
  return record;
}

async function update(table, id, patch) {
  const existing = await get(table, id);
  if (!existing) return null;
  const record = { ...existing, ...patch, id, updated_at: nowIso() };
  try {
    await run(table, `update ${q(table)} set data = $2, created_at = $3, updated_at = $4 where id = $1`,
      [id, JSON.stringify(record), record.created_at || existing.created_at || nowIso(), record.updated_at]);
  } catch (e) { fail('update', table, e); }
  return record;
}

async function remove(table, id) {
  try {
    const { rowCount } = await run(table, `delete from ${q(table)} where id = $1`, [String(id)]);
    return rowCount > 0;
  } catch (e) { fail('remove', table, e); }
}

// A single upsert on the primary key, so concurrent writers converge on one row.
async function upsertById(table, data, idPrefix) {
  const id = data.id || newId(idPrefix || table.slice(0, 3));
  let created_at = data.created_at;
  if (!created_at) {
    const existing = await get(table, id);
    created_at = existing?.created_at || nowIso();
  }
  const record = { ...data, id, created_at, updated_at: nowIso() };
  try { await writeRow(table, record, true); } catch (e) { fail('upsertById', table, e); }
  return record;
}

async function upsertBy(table, keyField, data, idPrefix) {
  const existing = await findOne(table, { [keyField]: data[keyField] });
  if (!existing) return insert(table, data, idPrefix);
  return update(table, existing.id, data);
}

// Replace a whole collection, atomically (the Supabase version could leave the
// table empty if the insert failed after the wipe).
async function replaceAll(table, rows, idPrefix) {
  const stamped = rows.map(r => ({
    id: r.id || newId(idPrefix || table.slice(0, 3)),
    created_at: r.created_at || nowIso(),
    updated_at: nowIso(),
    ...r,
  }));
  await ensureTable(table);
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query(`delete from ${q(table)}`);
    for (const r of stamped) {
      await client.query(`insert into ${q(table)} (id, data, created_at, updated_at) values ($1, $2, $3, $4)`,
        [r.id, JSON.stringify(r), r.created_at, r.updated_at]);
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    fail('replaceAll', table, e);
  } finally {
    client.release();
  }
  return stamped;
}

async function removeWhere(table, filter = {}) {
  const params = [];
  const where = whereFor(filter, params);
  try {
    const { rowCount } = await run(table, `delete from ${q(table)} ${where}`, params);
    return rowCount || 0;
  } catch (e) { fail('removeWhere', table, e); }
}

// ── TTL cache ────────────────────────────────────────────────────────────────

async function cacheGet(key, ttlMs) {
  const hit = await get('cache', key);
  if (!hit) return null;
  if (ttlMs && Date.now() - hit.at > ttlMs) return null;
  return hit.value;
}

async function cacheSet(key, value, opts = {}) {
  const data = { at: Date.now(), value };
  const expires = opts.ttlMs ? new Date(Date.now() + opts.ttlMs).toISOString() : null;
  try {
    await run('cache',
      `insert into ${q('cache')} (id, data, created_at, updated_at, kind, expires_at)
       values ($1, $2, now(), now(), $3, $4)
       on conflict (id) do update set data = excluded.data, updated_at = now(),
         kind = excluded.kind, expires_at = excluded.expires_at`,
      [key, JSON.stringify(data), opts.kind || null, expires]);
  } catch (e) { fail('cacheSet', 'cache', e); }
}

async function purgeExpired({ maxAgeMs = 180 * 24 * 60 * 60 * 1000 } = {}) {
  try {
    const expired = await run('cache',
      `delete from ${q('cache')} where expires_at is not null and expires_at < now()`);
    const stale = await run('cache',
      `delete from ${q('cache')} where expires_at is null and (data->>'at')::bigint < $1`,
      [Date.now() - maxAgeMs]);
    return { expired: expired.rowCount || 0, stale: stale.rowCount || 0 };
  } catch (e) { fail('purgeExpired', 'cache', e); }
}

function cacheKey(...parts) {
  const raw = parts.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join('|');
  return crypto.createHash('sha1').update(raw).digest('hex');
}

// ── Key/value settings ───────────────────────────────────────────────────────

async function getSetting(key, fallback = null) {
  try {
    const { rows } = await run('settings', `select value from ${q('settings')} where key = $1`, [key]);
    return rows[0] ? rows[0].value : fallback;
  } catch (e) { fail('getSetting', 'settings', e); }
}

async function setSetting(key, value) {
  try {
    await run('settings',
      `insert into ${q('settings')} (key, value, updated_at) values ($1, $2, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [key, JSON.stringify(value)]);
  } catch (e) { fail('setSetting', 'settings', e); }
  return value;
}

// ── Keyword universe (typed table, see 0007_keyword_universe.sql) ────────────

const KU = 'lpb_keyword_universe';

async function universeCount(clientId) {
  const { rows } = await run(KU, `select count(*)::int as n from ${q(KU)} where client_id = $1`, [clientId]);
  return rows[0].n;
}

// filter: { clusters: [...] } or { keywordLike: ['*veneer*', ...] } (PostgREST
// wildcards), as keywordUniverseMap produces.
async function universeCandidates({ clientId, city, filter, limit }) {
  const params = [clientId, String(city || '').toLowerCase().trim(), 'Implicit Local (Near Me)'];
  let match;
  if (filter.clusters) {
    params.push(filter.clusters);
    match = `cluster = any($${params.length})`;
  } else {
    params.push(filter.keywordLike.map(p => p.replace(/\*/g, '%')));
    match = `keyword_norm ilike any($${params.length})`;
  }
  params.push(Number(limit));
  const { rows } = await run(KU,
    `select keyword, semrush_sv from ${q(KU)}
     where client_id = $1 and geo_detected_norm = $2 and geo_type is distinct from $3 and ${match}
     order by semrush_sv desc limit $${params.length}`, params);
  return rows;
}

async function universeWipe(clientId) {
  await run(KU, `delete from ${q(KU)} where client_id = $1`, [clientId]);
}

async function universeInsert(rows) {
  if (!rows.length) return;
  const cols = ['client_id', 'keyword', 'keyword_norm', 'semrush_sv', 'pillar', 'cluster', 'subtopic',
    'geo_type', 'geo_detected', 'geo_detected_norm', 'data_confidence'];
  const params = [];
  const values = rows.map(r => `(${cols.map(c => { params.push(r[c] ?? null); return `$${params.length}`; }).join(',')})`);
  await run(KU, `insert into ${q(KU)} (${cols.join(',')}) values ${values.join(',')}`, params);
}

async function close() {
  if (pool) { const p = pool; pool = null; schemaReady = null; tablesReady.clear(); await p.end(); }
}

module.exports = {
  newId, nowIso,
  list, get, findOne,
  insert, update, remove, upsertBy, upsertById, replaceAll, removeWhere,
  cacheGet, cacheSet, cacheKey, purgeExpired,
  getSetting, setSetting,
  universeCount, universeCandidates, universeWipe, universeInsert,
  close, SCHEMA,
};
