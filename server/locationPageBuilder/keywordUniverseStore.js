// ── Keyword universe store — queries the imported bulk keyword list ─────────
// See supabase/migrations/0007_keyword_universe.sql for the table and
// server/scripts/importKeywordUniverse.js for how rows get in it.

const { getSupabase, isSupabaseConfigured } = require('../services/supabase');
const { universeFilterFor, UNSPECIFIED_GEO } = require('./keywordUniverseMap');

const TABLE = 'lpb_keyword_universe';

function norm(s) {
  return String(s || '').toLowerCase().trim();
}

// True once a client has actually imported a universe (avoids a wasted query
// + a Supabase-not-configured throw for clients that never will).
async function hasUniverse(clientId) {
  if (!isSupabaseConfigured()) return false;
  const { count, error } = await getSupabase()
    .from(TABLE).select('id', { count: 'exact', head: true }).eq('client_id', clientId);
  if (error) return false;
  return (count || 0) > 0;
}

// Returns CandidateShape rows ({ keyword, volume, difficulty, intent, source })
// for a given client+service+city, matched via the static Cluster/Pillar map
// (see keywordUniverseMap.js) plus the city (or the geo-unspecific '-' rows,
// which apply to every location).
async function getUniverseCandidates({ clientId, serviceSlug, city }) {
  const filter = universeFilterFor(serviceSlug);
  if (!filter || !clientId) return [];
  if (!(await hasUniverse(clientId))) return [];

  let q = getSupabase().from(TABLE).select('*').eq('client_id', clientId)
    .in('geo_detected_norm', [norm(city), UNSPECIFIED_GEO]);
  q = filter.clusters
    ? q.in('cluster', filter.clusters)
    : q.or(filter.keywordLike.map(p => `keyword_norm.ilike.${p}`).join(','));

  const { data, error } = await q.limit(2000);
  if (error) throw new Error(`[keywordUniverseStore.getUniverseCandidates] ${error.message}`);

  return data.map(r => ({
    keyword: r.keyword,
    volume: r.semrush_sv || 0,
    difficulty: 0,
    source: 'universe',
  }));
}

module.exports = { getUniverseCandidates, hasUniverse };
