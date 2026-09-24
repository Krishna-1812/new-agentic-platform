// ── DataForSEO integration (Section 6) ────────────────────────────────────────
// Primary endpoint: POST /v3/keywords_data/google_ads/search_volume/live
//   - one location_code per call, up to 700 keywords, charged flat (Section 5)
//   - so ONE call per region covers the whole frozen basket.
//
// Credentials stay server-side (Section 4). When DATAFORSEO_LOGIN / _PASSWORD are
// absent the module falls back to a DETERMINISTIC DEMO generator so the tool runs
// end-to-end without keys — every demo row is flagged `source: 'demo'` so the UI
// can label it. Flip to live data purely by adding the two env vars (Decision 1).
//
// > Verify the exact google_ads namespace path + 700-keyword limit + per-request
// > price against current DataForSEO v3 docs before going live (Sections 5 & 6).

const axios = require('axios');

const ENDPOINT = 'https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live';

function hasCredentials() {
  return !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

// ── Deterministic demo generator ──────────────────────────────────────────────
// Realistic-but-fake volumes so the ranking, per-capita and trend columns all
// behave sensibly: bigger metros draw more raw volume, but per-capita can still
// crown a smaller market (the whole point of the tool). Stable across runs.

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Mulberry32 PRNG seeded by a string → repeatable [0,1).
function rng(seed) {
  let a = hashStr(seed);
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Google rounds avg monthly searches to a fixed bucket set (Section 13). Snap to it.
const BUCKETS = [
  0, 10, 20, 30, 40, 50, 70, 90, 110, 140, 170, 210, 260, 320, 390, 480, 590,
  720, 880, 1000, 1300, 1600, 1900, 2400, 2900, 3600, 4400, 5400, 6600, 8100,
  9900, 12100, 14800, 18100, 22200, 27100, 33100, 40500, 49500, 60500, 74000,
  90500, 110000, 135000, 165000, 201000, 246000, 301000, 368000, 450000,
];
function snap(v) {
  if (v <= 0) return 0;
  let best = BUCKETS[0];
  for (const b of BUCKETS) if (Math.abs(b - v) < Math.abs(best - v)) best = b;
  return best;
}

const INTENT_WEIGHT = {
  'commercial-local': 1.0,
  'commercial-cost': 0.55,
  'commercial-general': 0.8,
};

function demoTerm(term, intentTag, geo) {
  const r = rng(`${term}::${geo.id}`);
  // Demand scales with population, tempered so it is not perfectly linear, plus
  // per-term and per-region random character.
  const popFactor = geo.population / 100000;               // NY≈192, El Paso≈8.7
  const intent = INTENT_WEIGHT[intentTag] ?? 0.7;
  const termBase = 0.4 + r() * 1.6;                        // 0.4–2.0 per term
  const regionChar = 0.7 + rng(`char::${geo.id}`)() * 0.8; // metro "appetite" 0.7–1.5
  const raw = popFactor * intent * termBase * regionChar * 1.8;
  const searchVolume = snap(raw);

  // 12-month series with a mild trend + noise → trend slope is meaningful.
  const trend = (r() - 0.45) * 0.5; // -0.225 .. +0.275 per-month drift fraction
  const monthlySearches = [];
  for (let i = 0; i < 12; i++) {
    const f = 1 + trend * (i / 11) + (rng(`${term}${geo.id}m${i}`)() - 0.5) * 0.12;
    monthlySearches.push(snap(searchVolume * Math.max(0.2, f)));
  }

  const cpc = Math.round((1.5 + r() * 9 + intent * 3) * 100) / 100; // healthcare CPCs run high
  const competition = Math.round((0.35 + r() * 0.6) * 100) / 100;   // 0.35–0.95

  return { searchVolume, cpc, competition, monthlySearches };
}

// Returns { source, terms: { "<term>": { searchVolume, cpc, competition, monthlySearches[] } } }
async function fetchDemo(terms, geo) {
  const out = {};
  for (const t of terms) out[t.term] = demoTerm(t.term, t.intentTag, geo);
  return { source: 'demo', terms: out };
}

// ── Live DataForSEO call ──────────────────────────────────────────────────────

async function fetchLive(terms, geo) {
  if (!geo.locationCode) {
    throw new Error(
      `Region "${geo.displayName}" has no resolved DataForSEO location_code. ` +
      `Resolve it against /v3/keywords_data/google_ads/locations and set geoData locationCode before live fetch.`
    );
  }
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64');
  const body = [{
    location_code: geo.locationCode,
    language_code: 'en',
    keywords: terms.map((t) => t.term).slice(0, 700), // Section 5: ≤700 per call
  }];

  const res = await axios.post(ENDPOINT, body, {
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    timeout: 60000,
  });

  const items = res.data?.tasks?.[0]?.result || [];
  const byTerm = {};
  for (const it of items) {
    if (!it.keyword) continue;
    byTerm[it.keyword.toLowerCase()] = {
      searchVolume: it.search_volume ?? 0,
      cpc: it.cpc ?? 0,
      competition: typeof it.competition === 'number' ? it.competition : (it.competition_index ?? 0) / 100,
      monthlySearches: Array.isArray(it.monthly_searches)
        ? it.monthly_searches.map((m) => m.search_volume ?? 0)
        : [],
    };
  }
  // Map back onto the requested terms (so missing keywords come back as zeros).
  const out = {};
  for (const t of terms) {
    out[t.term] = byTerm[t.term.toLowerCase()] || { searchVolume: 0, cpc: 0, competition: 0, monthlySearches: [] };
  }
  return { source: 'dataforseo', terms: out };
}

// Fetch the full basket for one region. Live when credentials exist, else demo.
async function fetchRegionVolume(terms, geo) {
  if (hasCredentials()) {
    try {
      return await fetchLive(terms, geo);
    } catch (err) {
      console.warn(`[market-potential] live DataForSEO fetch failed for ${geo.displayName}: ${err.message} — falling back to demo`);
      return fetchDemo(terms, geo);
    }
  }
  return fetchDemo(terms, geo);
}

module.exports = { name: 'dataforseo', fetchRegionVolume, hasCredentials, fetchDemo };
