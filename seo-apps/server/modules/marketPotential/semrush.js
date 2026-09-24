// ── SEMrush provider (templated "[service] [city]" method) ────────────────────
// SEMrush Keyword Analytics is COUNTRY-level only (database=us) — it cannot
// geo-target a metro like DataForSEO can. So metro demand is approximated by
// querying the national database for "[service] [city]" phrases: a national
// keyword like "dental implants phoenix" is attributable to that metro.
//
// This is the `is_geo_template` method the spec stored but excluded from ranking
// under DataForSEO (Method A). With SEMrush it is the only option — it captures
// only searchers who type the city name, so absolute volume undercounts true
// in-market demand, but the RELATIVE cross-metro index this tool reports stays
// directionally valid.
//
// Endpoint: type=phrase_these (batch), database=us, columns Ph,Nq,Cp,Co,Td.
//   Nq=avg monthly volume · Cp=CPC · Co=competition · Td=12-pt relative trend.
// Billing is per LINE RETURNED (see usageStore for unit accounting).

const axios = require('axios');
const { fetchDemo } = require('./dataForSeo');

const BASE = 'https://api.semrush.com/';
const BATCH = 100; // phrase_these accepts up to 100 phrases per request

function hasKey() {
  const k = process.env.SEMRUSH_API_KEY;
  return !!k && k !== 'your_semrush_api_key_here';
}

// Metro display name → bare city token, e.g. "Dallas–Ft. Worth, TX" → "dallas".
function cityOf(geo) {
  return geo.displayName.split(',')[0].split('–')[0].split('/')[0].trim();
}

// Turn a bare basket term into a city-templated national phrase.
//   "dental implants"          → "dental implants phoenix"
//   "dental implants near me"  → "dental implants phoenix"   (near-me stripped)
//   "dental implants [city]"   → "dental implants phoenix"   (placeholder filled)
function templatePhrase(term, city) {
  let t = (term || '').trim();
  if (t.includes('[city]')) {
    return t.replace(/\[city\]/g, city).replace(/\s+/g, ' ').trim().toLowerCase();
  }
  t = t.replace(/\bnear me\b/gi, '').replace(/\s+/g, ' ').trim();
  return `${t} ${city}`.replace(/\s+/g, ' ').trim().toLowerCase();
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parseRows(raw, skip = 1) {
  const t = (raw || '').toString().trim();
  if (!t || t.startsWith('ERROR') || t.startsWith('error')) return [];
  const lines = t.split('\n').filter(Boolean);
  if (lines.length <= skip) return [];
  return lines.slice(skip).map((line) => line.split(';').map((v) => (v || '').trim()));
}

async function phraseThese(phrases) {
  const key = process.env.SEMRUSH_API_KEY;
  const out = [];
  for (const group of chunk(phrases, BATCH)) {
    const res = await axios.get(BASE, {
      params: {
        type: 'phrase_these',
        key,
        database: 'us',
        phrase: group.join(';'),
        export_columns: 'Ph,Nq,Cp,Co,Td',
      },
      timeout: 30000,
    });
    // Td holds comma-separated values, so a ';' column split is safe.
    for (const p of parseRows(res.data)) {
      out.push({
        phrase: (p[0] || '').toLowerCase(),
        nq: parseInt(p[1]) || 0,
        cp: parseFloat(p[2]) || 0,
        co: parseFloat(p[3]) || 0,
        td: (p[4] || '').split(',').map(Number).filter((n) => !isNaN(n)),
      });
    }
  }
  return out;
}

// Fetch the full (templated) basket for one region.
// Returns { source, terms: { "<originalTerm>": {...} }, linesReturned }.
// `linesReturned` is the count of billable SEMrush lines actually returned.
async function fetchRegionVolume(terms, geo) {
  if (!hasKey()) {
    const d = await fetchDemo(terms, geo); // free — no key, no units
    return { source: 'demo', terms: d.terms, linesReturned: 0 };
  }

  const city = cityOf(geo);
  // Map templated phrase → original term (dedupe phrases so we don't over-query).
  const phraseToTerm = new Map();
  for (const t of terms) {
    const ph = templatePhrase(t.term, city);
    if (!phraseToTerm.has(ph)) phraseToTerm.set(ph, t.term);
  }
  const phrases = [...phraseToTerm.keys()];

  let data;
  try {
    data = await phraseThese(phrases);
  } catch (err) {
    console.warn(`[market-potential] SEMrush fetch failed for ${geo.displayName}: ${err.message} — using demo`);
    const d = await fetchDemo(terms, geo);
    return { source: 'semrush-demo-fallback', terms: d.terms, linesReturned: 0 };
  }

  const byPhrase = {};
  for (const d of data) byPhrase[d.phrase] = d;

  const outTerms = {};
  for (const t of terms) {
    const ph = templatePhrase(t.term, city);
    const d = byPhrase[ph];
    if (d) {
      // Td is relative (0–1). Approximate a monthly series from the average
      // volume so trend/sparkline work; ranking uses the average (nq) directly.
      const monthlySearches = d.td.length >= 2 ? d.td.map((r) => Math.round(d.nq * r)) : [];
      outTerms[t.term] = { searchVolume: d.nq, cpc: d.cp, competition: d.co, monthlySearches };
    } else {
      outTerms[t.term] = { searchVolume: 0, cpc: 0, competition: 0, monthlySearches: [] };
    }
  }

  return { source: 'semrush', terms: outTerms, linesReturned: data.length };
}

// ── Competitor density (Item 3) ───────────────────────────────────────────────
// phrase_organic returns the organic SERP for a keyword. We count the unique root
// domains ranking in the top N for the city-templated head term(s) — a proxy for
// how contested a metro is. Billed per line returned (topN lines per term).
//
// Cost warning: this is the dominant unit cost, so callers query only a few HEAD
// terms per metro (MP_DENSITY_TERMS), never the whole basket.

function rootDomain(host) {
  const h = (host || '').toLowerCase().replace(/^www\./, '').split('/')[0];
  const parts = h.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : h;
}

// Returns { count, domains, linesReturned } — count = unique root domains in the
// top N (domains = the actual list), or null/[] when SEMrush has no SERP.
async function fetchCompetitorDensity(terms, geo, topN = 10) {
  if (!hasKey()) return { count: null, domains: [], linesReturned: 0 };
  const key = process.env.SEMRUSH_API_KEY;
  const city = cityOf(geo);
  const domains = new Set();
  let lines = 0;
  let anyData = false;

  for (const t of terms) {
    const phrase = templatePhrase(t.term, city);
    try {
      const res = await axios.get(BASE, {
        params: { type: 'phrase_organic', key, database: 'us', phrase, display_limit: topN, export_columns: 'Dn,Ur,Po' },
        timeout: 30000,
      });
      const rows = parseRows(res.data);
      lines += rows.length;
      if (rows.length) anyData = true;
      for (const p of rows) {
        const d = rootDomain(p[0] || '');
        if (d) domains.add(d);
      }
    } catch (err) {
      console.warn(`[market-potential] density fetch failed (${phrase}): ${err.message}`);
    }
  }

  return { count: anyData ? domains.size : null, domains: [...domains].sort(), linesReturned: lines };
}

module.exports = { name: 'semrush', fetchRegionVolume, fetchCompetitorDensity, hasKey, templatePhrase, cityOf };
