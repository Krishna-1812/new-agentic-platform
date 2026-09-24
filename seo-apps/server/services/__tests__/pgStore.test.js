// The Postgres store (services/pgStore.js), against a real database.
// Run: TEST_DATABASE_URL=postgres://... node services/__tests__/pgStore.test.js
// Uses its own throwaway schema, dropped at the end. Skips without a database.
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log('pgStore: skipped (set TEST_DATABASE_URL to run)');
  process.exit(0);
}
process.env.DATABASE_URL = url;
process.env.SEO_DB_SCHEMA = 'seo_studio_test_' + process.pid;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const assert = require('assert');
const { Client } = require('pg');
const s = require('../supabaseStore');

async function dropSchema() {
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query(`drop schema if exists "${process.env.SEO_DB_SCHEMA}" cascade`);
  await c.end();
}

(async () => {
  assert.strictEqual(s.SCHEMA, process.env.SEO_DB_SCHEMA, 'supabaseStore should hand over to pgStore');
  const a = await s.insert('lpb_pages', { client_id: 'c1', name: 'b', tuple_key: 't1' }, 'pag');
  const b = await s.insert('lpb_pages', { client_id: 'c1', name: 'a' }, 'pag');
  await s.insert('lpb_pages', { client_id: 'c2', name: 'z' }, 'pag');
  assert.strictEqual((await s.list('lpb_pages', { client_id: 'c1' })).length, 2);
  assert.deepStrictEqual((await s.list('lpb_pages', { client_id: 'c1' }, { orderField: 'name' })).map(r => r.name), ['a', 'b']);
  assert.strictEqual((await s.list('lpb_pages', {}, { limit: 1, ascending: false })).length, 1);
  assert.strictEqual((await s.get('lpb_pages', a.id)).name, 'b');
  assert.strictEqual(await s.get('lpb_pages', 'nope'), null);
  assert.strictEqual((await s.findOne('lpb_pages', { tuple_key: 't1' })).id, a.id);
  const u = await s.update('lpb_pages', a.id, { name: 'bb' });
  assert.strictEqual(u.name, 'bb'); assert.strictEqual(u.created_at, a.created_at);
  assert.strictEqual(await s.update('lpb_pages', 'nope', {}), null);
  const up1 = await s.upsertById('lpb_briefs', { id: 'fixed', v: 1 });
  const up2 = await s.upsertById('lpb_briefs', { id: 'fixed', v: 2 });
  assert.strictEqual((await s.get('lpb_briefs', 'fixed')).v, 2); assert.strictEqual(up2.created_at, up1.created_at);
  await s.upsertBy('lpb_keywordselections', 'tuple_key', { tuple_key: 'k', p: 1 });
  await s.upsertBy('lpb_keywordselections', 'tuple_key', { tuple_key: 'k', p: 2 });
  const ks = await s.list('lpb_keywordselections', { tuple_key: 'k' });
  assert.strictEqual(ks.length, 1); assert.strictEqual(ks[0].p, 2);
  assert.strictEqual(await s.removeWhere('lpb_pages', { client_id: 'c2' }), 1);
  assert.strictEqual(await s.remove('lpb_pages', b.id), true);
  assert.strictEqual(await s.remove('lpb_pages', b.id), false);
  await s.replaceAll('lpb_services', [{ name: 'x' }, { name: 'y' }], 'ser');
  await s.replaceAll('lpb_services', [{ name: 'q' }], 'ser');
  assert.deepStrictEqual((await s.list('lpb_services')).map(r => r.name), ['q']);
  // cache
  const key = s.cacheKey('a', { b: 1 });
  await s.cacheSet(key, { hello: 1 }, { kind: 'serp', ttlMs: 60000 });
  assert.deepStrictEqual(await s.cacheGet(key, 60000), { hello: 1 });
  await s.cacheSet(key, { hello: 2 });
  assert.deepStrictEqual(await s.cacheGet(key), { hello: 2 });
  await s.cacheSet('old', 1, { ttlMs: -1000 });
  const pr = await s.purgeExpired({ maxAgeMs: 10 * 86400000 });
  assert.strictEqual(pr.expired, 1);
  // settings
  assert.deepStrictEqual(await s.getSetting('nope', []), []);
  await s.setSetting('ku-cities:c1', ['Derry', 'Salem']);
  await s.setSetting('ku-cities:c1', ['Derry']);
  assert.deepStrictEqual(await s.getSetting('ku-cities:c1'), ['Derry']);
  // universe
  await s.universeWipe('c1');
  await s.universeInsert([
    { client_id: 'c1', keyword: 'Veneers Derry', keyword_norm: 'veneers derry', semrush_sv: 50, cluster: 'Veneers', geo_type: 'City', geo_detected: 'Derry', geo_detected_norm: 'derry' },
    { client_id: 'c1', keyword: 'veneers derry cost', keyword_norm: 'veneers derry cost', semrush_sv: 90, cluster: 'Veneers', geo_type: 'City', geo_detected: 'Derry', geo_detected_norm: 'derry' },
    { client_id: 'c1', keyword: 'veneers near me', keyword_norm: 'veneers near me', semrush_sv: 900, cluster: 'Veneers', geo_type: 'Implicit Local (Near Me)', geo_detected: 'Derry', geo_detected_norm: 'derry' },
  ]);
  assert.strictEqual(await s.universeCount('c1'), 3);
  const ku = require('../../locationPageBuilder/keywordUniverseStore');
  assert.strictEqual(await ku.hasUniverse('c1'), true);
  assert.strictEqual(await ku.hasUniverse('c9'), false);
  const c = await ku.getUniverseCandidates({ clientId: 'c1', serviceSlug: 'veneers', city: 'Derry' });
  assert.deepStrictEqual(c.map(x => x.keyword), ['veneers derry cost', 'Veneers Derry']);
  const kl = await s.universeCandidates({ clientId: 'c1', city: 'derry', filter: { keywordLike: ['*cost*'] }, limit: 5 });
  assert.deepStrictEqual(kl.map(x => x.keyword), ['veneers derry cost']);
  assert.deepStrictEqual(await ku.getKnownCities('c1'), ['Derry']);
  // unsafe identifier refused
  await assert.rejects(() => s.list('x; drop table y'), /unsafe identifier/);
  await s.universeWipe('c1');
  await s.close();
  await dropSchema();
  console.log('pgStore: all assertions passed');
  console.log('\n1 passed, 0 failed');
})().catch(async e => { console.error('FAIL', e); await s.close().catch(() => {}); await dropSchema().catch(() => {}); process.exit(1); });
