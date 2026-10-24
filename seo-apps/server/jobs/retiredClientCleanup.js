// ── Removing a retired client's stored data ─────────────────────────────────
// Gentle Dental (a 42 North Dental brand, with Great Lakes Family Dental) was
// removed from SEO Studio on 2026-10-23: its builder, seed data and knowledge
// base files went with the code. What the code cannot reach on its own is what
// it had already stored:
//
//   - every Location Page Builder record for the client (lpb_* tables: its
//     template, services, offices, generated pages, approved keywords and
//     briefs, keyed by data->>'client_id'; and the client's own row, keyed by
//     its id);
//   - its imported keyword universe (lpb_keyword_universe.client_id);
//   - its known-cities setting (settings key ku-cities:<client>);
//   - on a Railway volume (SEO_DATA_ROOT), the knowledge-base copy made on
//     first boot, which still holds its brand and feedback files.
//
// This runs on every start and deletes whatever of that is still there. Once
// it has run in production it finds nothing and costs a few empty deletes; it
// can be removed then. The shared `cache` table is left to the daily sweeper
// (jobs/cachePurge.js): its keys are opaque hashes that do not name a client.

const fs = require('fs');
const path = require('path');

const RETIRED = {
  lpbClientIds: ['client_gentle_dental'],
  kbClients: ['gentle-dental', 'great-lakes'],
  kbDirs: ['client-feedback/gentle-dental'],
};

const UNIVERSE_TABLE = 'lpb_keyword_universe';

async function purgeDatabase({ lpbStore, store, wipeUniverse, clientIds = RETIRED.lpbClientIds, log = console }) {
  const out = { records: {}, universeCleared: 0, settings: 0, errors: [] };
  for (const clientId of clientIds) {
    for (const collection of lpbStore.COLLECTIONS) {
      try {
        const n = await lpbStore.removeWhere(collection, { client_id: clientId });
        if (n) out.records[collection] = (out.records[collection] || 0) + n;
      } catch (err) {
        // A table that was never created (Supabase without that migration) has nothing to delete.
        out.errors.push(`${collection}: ${err.message}`);
      }
    }
    // The client's own row carries its id, not a client_id.
    try {
      if (await lpbStore.remove('clients', clientId)) out.records.clients = (out.records.clients || 0) + 1;
    } catch (err) {
      out.errors.push(`clients: ${err.message}`);
    }
    try {
      await wipeUniverse(clientId);
      out.universeCleared += 1;
    } catch (err) {
      out.errors.push(`${UNIVERSE_TABLE}: ${err.message}`);
    }
    try {
      if (await store.deleteSetting(`ku-cities:${clientId}`)) out.settings += 1;
    } catch (err) {
      out.errors.push(`settings: ${err.message}`);
    }
  }
  const removed = Object.values(out.records).reduce((a, b) => a + b, 0);
  log.log(`[RetiredClientCleanup] Removed ${removed} stored record(s) and ${out.settings} setting(s), and cleared the keyword universe, for ${clientIds.join(', ')}.`
    + (out.errors.length ? ` Skipped: ${out.errors.join('; ')}` : ''));
  return out;
}

async function purgeKnowledgeBase({ kbStore, clients = RETIRED.kbClients, dirs = RETIRED.kbDirs, log = console }) {
  const out = { entries: [], dirs: [] };
  const entries = await kbStore.listKBs();
  for (const kb of entries) {
    if (!clients.includes(kb.client)) continue;
    await kbStore.deleteKB(kb.id);
    out.entries.push(kb.id);
  }
  for (const rel of dirs) {
    const dir = path.join(kbStore.KB_ROOT, rel);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      out.dirs.push(rel);
    }
  }
  if (out.entries.length || out.dirs.length) {
    log.log(`[RetiredClientCleanup] Removed knowledge-base entries ${out.entries.join(', ') || 'none'}`
      + ` and folders ${out.dirs.join(', ') || 'none'}.`);
  }
  return out;
}

function defaultWipeUniverse() {
  const { getSupabase, databaseBackend } = require('../services/supabase');
  const store = require('../services/supabaseStore');
  if (databaseBackend() === 'postgres') return clientId => store.universeWipe(clientId);
  return async clientId => {
    const { error } = await getSupabase().from(UNIVERSE_TABLE).delete().eq('client_id', clientId);
    if (error) throw new Error(error.message);
  };
}

// Never throws: a failed cleanup must not stop the server from starting.
async function run() {
  const result = {};
  try {
    result.kb = await purgeKnowledgeBase({ kbStore: require('../services/kbStore') });
  } catch (err) {
    console.error('[RetiredClientCleanup] Knowledge base cleanup failed:', err.message);
  }
  try {
    const { isDatabaseConfigured } = require('../services/supabase');
    if (isDatabaseConfigured()) {
      result.db = await purgeDatabase({
        lpbStore: require('../locationPageBuilder/store'),
        store: require('../services/supabaseStore'),
        wipeUniverse: defaultWipeUniverse(),
      });
    }
  } catch (err) {
    console.error('[RetiredClientCleanup] Database cleanup failed:', err.message);
  }
  return result;
}

module.exports = { run, purgeDatabase, purgeKnowledgeBase, RETIRED };
