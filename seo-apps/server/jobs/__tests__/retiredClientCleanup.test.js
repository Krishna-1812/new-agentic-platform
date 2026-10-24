// jobs/retiredClientCleanup.js: what a retired client left in the database and
// on the knowledge-base volume is deleted, and nothing else is.
// Run: node jobs/__tests__/retiredClientCleanup.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-cleanup-'));
process.env.KB_ROOT = kbRoot;
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const job = require('../retiredClientCleanup');
const kbStore = require('../../services/kbStore');

let passed = 0, failed = 0;
const quiet = { log() {} };
async function test(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.stack || e.message}`); failed++; }
}

function fakeDb() {
  const rows = {
    pages: [{ client_id: 'client_gentle_dental' }, { client_id: 'client_gentle_dental' }, { client_id: 'client_clear_behavioral_health' }],
    services: [{ client_id: 'client_gentle_dental' }, { client_id: 'client_neuro_wellness_spa' }],
    clients: [{ id: 'client_gentle_dental' }, { id: 'client_clear_behavioral_health' }],
    briefs: [],
  };
  const settings = { 'ku-cities:client_gentle_dental': ['Derry'], 'ku-cities:client_clear_behavioral_health': ['Brea'] };
  const universe = { client_gentle_dental: 3, client_clear_behavioral_health: 5 };
  const lpbStore = {
    COLLECTIONS: Object.keys(rows),
    async removeWhere(collection, filter) {
      const before = rows[collection].length;
      rows[collection] = rows[collection].filter(r => r.client_id !== filter.client_id);
      return before - rows[collection].length;
    },
    async remove(collection, id) {
      const before = rows[collection].length;
      rows[collection] = rows[collection].filter(r => r.id !== id);
      return before > rows[collection].length;
    },
  };
  const store = { async deleteSetting(key) { const had = key in settings; delete settings[key]; return had; } };
  const wipeUniverse = async id => { delete universe[id]; };
  return { rows, settings, universe, lpbStore, store, wipeUniverse };
}

function writeKbFixture() {
  fs.rmSync(kbRoot, { recursive: true, force: true });
  for (const f of ['brand/gentle-dental.md', 'brand/great-lakes.md', 'brand/riccobene.md',
    'client-feedback/gentle-dental/2026-q2.md', 'client-feedback/gentle-dental/2026-q3.md']) {
    fs.mkdirSync(path.join(kbRoot, path.dirname(f)), { recursive: true });
    fs.writeFileSync(path.join(kbRoot, f), '---\n---\nx\n');
  }
  fs.writeFileSync(path.join(kbRoot, '_index.json'), JSON.stringify({ knowledge_bases: [
    { id: 'gentle-dental', client: 'gentle-dental', path: 'brand/gentle-dental.md' },
    { id: 'great-lakes', client: 'great-lakes', path: 'brand/great-lakes.md' },
    { id: 'gentle-dental-feedback-2026-q2', client: 'gentle-dental', path: 'client-feedback/gentle-dental/2026-q2.md' },
    { id: 'riccobene', client: 'riccobene', path: 'brand/riccobene.md' },
  ] }));
}

(async () => {
  console.log('\nretired client cleanup — database');

  await test('every stored record of the retired client goes, and nobody else\'s', async () => {
    const db = fakeDb();
    const out = await job.purgeDatabase({ ...db, log: quiet });
    assert.deepStrictEqual(out.records, { pages: 2, services: 1, clients: 1 });
    assert.deepStrictEqual(db.rows.pages, [{ client_id: 'client_clear_behavioral_health' }]);
    assert.deepStrictEqual(db.rows.services, [{ client_id: 'client_neuro_wellness_spa' }]);
    assert.deepStrictEqual(db.rows.clients, [{ id: 'client_clear_behavioral_health' }]);
  });

  await test('its keyword universe and its known-cities setting go; the other clients\' stay', async () => {
    const db = fakeDb();
    const out = await job.purgeDatabase({ ...db, log: quiet });
    assert.deepStrictEqual(db.universe, { client_clear_behavioral_health: 5 });
    assert.deepStrictEqual(Object.keys(db.settings), ['ku-cities:client_clear_behavioral_health']);
    assert.strictEqual(out.settings, 1);
  });

  await test('a second run finds nothing and changes nothing', async () => {
    const db = fakeDb();
    await job.purgeDatabase({ ...db, log: quiet });
    const again = await job.purgeDatabase({ ...db, log: quiet });
    assert.deepStrictEqual(again.records, {});
    assert.strictEqual(again.settings, 0);
    assert.strictEqual(db.rows.pages.length, 1);
  });

  await test('a table that cannot be read is skipped and the rest are still cleaned', async () => {
    const db = fakeDb();
    const real = db.lpbStore.removeWhere;
    db.lpbStore.removeWhere = async (c, f) => { if (c === 'pages') throw new Error('relation does not exist'); return real(c, f); };
    const out = await job.purgeDatabase({ ...db, log: quiet });
    assert.deepStrictEqual(out.records, { services: 1, clients: 1 });
    assert.match(out.errors[0], /^pages: relation does not exist/);
    assert.deepStrictEqual(Object.keys(db.settings), ['ku-cities:client_clear_behavioral_health']);
  });

  await test('the retired client is the only one named', async () => {
    assert.deepStrictEqual(job.RETIRED.lpbClientIds, ['client_gentle_dental']);
    assert.deepStrictEqual(job.RETIRED.kbClients, ['gentle-dental', 'great-lakes']);
  });

  console.log('\nretired client cleanup — knowledge base on the volume');

  await test('its brand and feedback files and their index entries go; other clients\' stay', async () => {
    writeKbFixture();
    const out = await job.purgeKnowledgeBase({ kbStore, log: quiet });
    assert.deepStrictEqual(out.entries.sort(), ['gentle-dental', 'gentle-dental-feedback-2026-q2', 'great-lakes']);
    assert.deepStrictEqual((await kbStore.listKBs()).map(k => k.id), ['riccobene']);
    assert.ok(!fs.existsSync(path.join(kbRoot, 'brand/gentle-dental.md')));
    assert.ok(!fs.existsSync(path.join(kbRoot, 'brand/great-lakes.md')));
    assert.ok(fs.existsSync(path.join(kbRoot, 'brand/riccobene.md')));
  });

  await test('the feedback folder goes too, with a file the index never listed', async () => {
    writeKbFixture();
    const out = await job.purgeKnowledgeBase({ kbStore, log: quiet });
    assert.deepStrictEqual(out.dirs, ['client-feedback/gentle-dental']);
    assert.ok(!fs.existsSync(path.join(kbRoot, 'client-feedback/gentle-dental')));
    assert.ok(fs.existsSync(path.join(kbRoot, 'client-feedback')));
  });

  await test('a second run on a clean knowledge base does nothing', async () => {
    writeKbFixture();
    await job.purgeKnowledgeBase({ kbStore, log: quiet });
    const again = await job.purgeKnowledgeBase({ kbStore, log: quiet });
    assert.deepStrictEqual(again, { entries: [], dirs: [] });
    assert.deepStrictEqual((await kbStore.listKBs()).map(k => k.id), ['riccobene']);
  });

  console.log('\nretired client cleanup — at start-up');

  await test('with no database configured it cleans the knowledge base and never throws', async () => {
    writeKbFixture();
    const out = await job.run();
    assert.strictEqual(out.db, undefined);
    assert.deepStrictEqual((await kbStore.listKBs()).map(k => k.id), ['riccobene']);
  });

  fs.rmSync(kbRoot, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
