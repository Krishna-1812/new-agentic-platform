#!/usr/bin/env node
// ── Import a client's keyword universe CSV into Supabase ────────────────────
// The Location Page Builder's live keyword research (keywordAdapter.js) pulls
// keywords from competitors' SEMrush ranking profiles, which is too broad/
// off-topic for niche service+location combos. This script loads a client's
// own pre-scored keyword export (keyword, volume, Pillar/Cluster/Subtopic,
// Geo Type/Geo Detected, Data Confidence) into `lpb_keyword_universe` so
// keywordAdapter can merge in matching rows (see keywordUniverseStore.js).
//
// Usage (from repo root, with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set,
// or with DATABASE_URL pointing at the Railway Postgres):
//   node server/scripts/importKeywordUniverse.js <csvPath> <clientId>
//
// Idempotent per client: wipes that client's existing universe rows first,
// then bulk-inserts the CSV — safe to re-run after a refreshed export.
// Requires supabase/migrations/0007_keyword_universe.sql to have been applied.

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const readline = require('readline');
const { getSupabase, databaseBackend } = require('../services/supabase');
const supabaseStore = require('../services/supabaseStore');
const { KNOWN_CITIES_SETTING_KEY } = require('../locationPageBuilder/keywordUniverseStore');

const [, , csvPath, clientId] = process.argv;

if (!csvPath || !clientId) {
  console.error('Usage: node server/scripts/importKeywordUniverse.js <csvPath> <clientId>');
  process.exit(1);
}
if (!databaseBackend()) {
  console.error('✗ Neither SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY nor DATABASE_URL is set. Aborting.');
  process.exit(1);
}

const EXPECTED_COLUMNS = [
  'Keyword', 'Semrush SV', 'Pillar', 'Cluster', 'Subtopic',
  'Geo Type', 'Geo Detected', 'Data Confidence',
];
const BATCH_SIZE = 500;

// Minimal CSV line splitter — handles double-quoted fields (with embedded
// commas), which is all this export uses; no embedded newlines in fields.
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === ',' && !inQuotes) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function norm(s) {
  return String(s || '').toLowerCase().trim();
}

async function wipeExisting(sb) {
  if (!sb) return supabaseStore.universeWipe(clientId);
  const { error } = await sb.from('lpb_keyword_universe').delete().eq('client_id', clientId);
  if (error) throw new Error(`[wipe] ${error.message}`);
}

async function insertBatch(sb, rows) {
  if (!sb) return supabaseStore.universeInsert(rows);
  const { error } = await sb.from('lpb_keyword_universe').insert(rows);
  if (error) throw new Error(`[insert] ${error.message}`);
}

async function main() {
  // null = Railway Postgres, where supabaseStore is pgStore.
  const sb = databaseBackend() === 'supabase' ? getSupabase() : null;
  console.log(`Wiping existing universe rows for ${clientId}…`);
  await wipeExisting(sb);

  const rl = readline.createInterface({ input: fs.createReadStream(csvPath, 'utf8') });
  let header = null;
  let idx = {};
  let batch = [];
  let total = 0;
  let skipped = 0;
  const citySet = new Set();

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!header) {
      header = splitCsvLine(line).map(h => h.trim());
      const missing = EXPECTED_COLUMNS.filter(c => !header.includes(c));
      if (missing.length) throw new Error(`CSV is missing expected column(s): ${missing.join(', ')}`);
      header.forEach((h, i) => { idx[h] = i; });
      continue;
    }
    const cols = splitCsvLine(line);
    const keyword = (cols[idx['Keyword']] || '').trim();
    if (!keyword) { skipped++; continue; }
    const geoDetected = (cols[idx['Geo Detected']] || '').trim();
    if (geoDetected && geoDetected !== '-') citySet.add(geoDetected);

    batch.push({
      client_id: clientId,
      keyword,
      keyword_norm: norm(keyword),
      semrush_sv: parseInt(cols[idx['Semrush SV']], 10) || 0,
      pillar: (cols[idx['Pillar']] || '').trim() || null,
      cluster: (cols[idx['Cluster']] || '').trim() || null,
      subtopic: (cols[idx['Subtopic']] || '').trim() || null,
      geo_type: (cols[idx['Geo Type']] || '').trim() || null,
      geo_detected: geoDetected || null,
      geo_detected_norm: norm(geoDetected),
      data_confidence: (cols[idx['Data Confidence']] || '').trim() || null,
    });

    if (batch.length >= BATCH_SIZE) {
      await insertBatch(sb, batch);
      total += batch.length;
      process.stdout.write(`\r  imported ${total} rows…`);
      batch = [];
    }
  }
  if (batch.length) { await insertBatch(sb, batch); total += batch.length; }

  // Cache the full set of cities this universe knows about — used by
  // keywordAdapter to exclude a competitor's other-city keywords (e.g.
  // "veneers goffstown nh" on a Derry page), which is broader than just this
  // client's own office cities.
  await supabaseStore.setSetting(KNOWN_CITIES_SETTING_KEY(clientId), [...citySet]);

  console.log(`\n✓ Imported ${total} rows for ${clientId} (${skipped} skipped: no keyword text).`);
  console.log(`✓ Cached ${citySet.size} distinct cities for other-city keyword exclusion.`);
}

main()
  .then(() => supabaseStore.close && supabaseStore.close())
  .catch(e => { console.error('✗', e.message); process.exit(1); });
