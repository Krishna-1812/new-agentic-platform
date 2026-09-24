'use strict';

/* ============================================================================
 * keywordMatch.js — graded keyword-variation matching engine
 * ----------------------------------------------------------------------------
 * Self-contained, ZERO npm dependencies (Node >= 18 built-ins only).
 * MUST NOT require anything from seoGeoChecks.js — seoGeoChecks.js requires US.
 *
 * Implements the corrected implementation spec:
 *   B.1  scan()            offset-preserving normalisation + tokenisation,
 *                          metadata barriers per CORRECTION C14 (| • · — –)
 *   B.2  stem()/rootKey()  two-level morphology (replaces the old stemWord),
 *                          IRREGULAR map per C13 (teeth -> tooth)
 *   B.3  matchKeyword()    graded 8-tier result, greedy + exhaustive fallback
 *                          assignment per C11
 *   B.4  proximity budget  G (3 short fields / metadata, 6 body prose)
 *   B.5  countOccurrences  non-overlapping greedy span consumption — this is
 *                          what fixes the density double-count
 *   B.7  degenerate-keyword guards (incl. the 'near me' intent-modifier guard)
 *
 * Everything here is a pure function: no I/O, no module-level mutable state.
 *
 * Tier ladder (integer ranks per C15):
 *   exact_phrase            7   100
 *   exact_phrase_inflected  6   92
 *   ordered_with_gaps       5   80 - 4*gaps
 *   unordered_proximity     4   66 - 4*gaps
 *   family_proximity        3   50 - 4*gaps  (-2 when unordered)
 *   scattered_terms         2   35
 *   partial_terms           1   round(25 * coverage)
 *   absent                  0   0
 * ==========================================================================*/

/* ------------------------------------------------------------------ tiers */

const TIER = Object.freeze({
  ABSENT: 'absent',
  PARTIAL_TERMS: 'partial_terms',
  SCATTERED_TERMS: 'scattered_terms',
  FAMILY_PROXIMITY: 'family_proximity',
  UNORDERED_PROXIMITY: 'unordered_proximity',
  ORDERED_WITH_GAPS: 'ordered_with_gaps',
  EXACT_PHRASE_INFLECTED: 'exact_phrase_inflected',
  EXACT_PHRASE: 'exact_phrase',
});

const TIER_RANK = Object.freeze({
  absent: 0,
  partial_terms: 1,
  scattered_terms: 2,
  family_proximity: 3,
  unordered_proximity: 4,
  ordered_with_gaps: 5,
  exact_phrase_inflected: 6,
  exact_phrase: 7,
});

/* --------------------------------------------------------------- lexicons */

// B.1 — stopwords are RETAINED in the token array and skipped when building
// the content index. Everything proximity-related is measured in content-token
// space; that is exactly what makes "Dentist Near You in Arlington" adjacent.
const STOP = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'of', 'for', 'to', 'and', 'or', 'with',
  'by', 'from', 'near', 'nearby', 'me', 'my', 'our', 'your', 'you', 'is',
  'are', 'was', 'were', 'be', 'this', 'that',
]);

// C13 — irregular plurals / classical forms, applied BEFORE any suffix rule.
const IRREGULAR = Object.freeze({
  teeth: 'tooth', feet: 'foot', children: 'child', men: 'man', women: 'woman',
  people: 'person', analyses: 'analysis', crises: 'crisis', bases: 'basis',
  theses: 'thesis', diagnoses: 'diagnosis', prostheses: 'prosthesis',
  indices: 'index', appendices: 'appendix', vertices: 'vertex',
});

// B.2 — words a naive trailing-s strip would mangle (business -> busines).
const PLURAL_PROTECT = new Set([
  'analysis', 'address', 'business', 'bus', 'gas', 'texas', 'kansas',
  'arkansas', 'dallas', 'vegas', 'news', 'series', 'species', 'dentures',
  'braces', 'less', 'plus', 'glass', 'class', 'across', 'process', 'access',
  'success', 'status', 'campus', 'virus', 'focus', 'crisis', 'basis',
  'thesis', 'prosthesis', 'arthritis', 'gingivitis', 'periodontitis',
  'orthodontics', 'pediatrics', 'ceramics', 'athletics', 'always',
]);

// B.2 — derivational suffixes, used ONLY by rootKey (tier 3 / family).
// Scanned longest-first; a strip is only taken when the remainder is >= 4
// chars and contains a vowel. Those two guards are the false-positive brake
// (car/care stay apart, incidental -> incid, not dent).
const DERIV_SUFFIXES = [
  'istry', 'ician', 'ology', 'istic', 'ational', 'ation', 'ically', 'ical',
  'ement', 'ment', 'ness', 'ance', 'ence', 'tion', 'sion', 'able', 'ible',
  'ship', 'hood', 'ist', 'ics', 'ing', 'ery', 'ary', 'ory', 'ant', 'ent',
  'ive', 'ize', 'ise', 'ify', 'yer', 'ic', 'al', 'ly', 'er', 'or',
].slice().sort((a, b) => b.length - a.length);

// V6 / B.2 — same-profession families morphology cannot reach. Every FAMILY
// hit is level 1 only, i.e. it can never score above the family tier.
const FAMILY_GROUPS = [
  { id: 'dent', verticals: ['healthcare', 'dental', 'medical'], words: ['dentist', 'dentists', 'dental', 'dentistry', 'dds', 'dmd'] },
  { id: 'physician', verticals: ['healthcare', 'medical'], words: ['doctor', 'doctors', 'physician', 'physicians', 'md'] },
  { id: 'legal', verticals: ['legal'], words: ['lawyer', 'lawyers', 'attorney', 'attorneys', 'legal', 'law', 'counsel'] },
  { id: 'insure', verticals: ['insurance', 'finance'], words: ['insurance', 'insurer', 'insurers', 'insure', 'insured'] },
  { id: 'realty', verticals: ['real_estate'], words: ['realtor', 'realtors', 'realty'] },
  { id: 'hvac', verticals: ['home_services'], words: ['ac', 'hvac'] },
  { id: 'plumb', verticals: ['home_services'], words: ['plumber', 'plumbers', 'plumbing'] },
];

// V7 — US states. Single-word names alias at token level; multi-word names are
// phrase aliases (see PHRASE_ALIASES). `trad` is the AP-style abbreviation.
const US_STATES = [
  ['al', 'alabama', 'ala'], ['ak', 'alaska', null], ['az', 'arizona', 'ariz'],
  ['ar', 'arkansas', 'ark'], ['ca', 'california', 'calif'], ['co', 'colorado', 'colo'],
  ['ct', 'connecticut', 'conn'], ['de', 'delaware', 'del'], ['fl', 'florida', 'fla'],
  ['ga', 'georgia', null], ['hi', 'hawaii', null], ['id', 'idaho', null],
  ['il', 'illinois', 'ill'], ['in', 'indiana', 'ind'], ['ia', 'iowa', null],
  ['ks', 'kansas', 'kan'], ['ky', 'kentucky', null], ['la', 'louisiana', null],
  ['me', 'maine', null], ['md', 'maryland', null], ['ma', 'massachusetts', 'mass'],
  ['mi', 'michigan', 'mich'], ['mn', 'minnesota', 'minn'], ['ms', 'mississippi', 'miss'],
  ['mo', 'missouri', null], ['mt', 'montana', 'mont'], ['ne', 'nebraska', 'neb'],
  ['nv', 'nevada', 'nev'], ['oh', 'ohio', null], ['ok', 'oklahoma', 'okla'],
  ['or', 'oregon', 'ore'], ['pa', 'pennsylvania', 'penn'], ['tn', 'tennessee', 'tenn'],
  ['tx', 'texas', null], ['ut', 'utah', null], ['vt', 'vermont', null],
  ['va', 'virginia', null], ['wa', 'washington', 'wash'], ['wi', 'wisconsin', 'wis'],
  ['wy', 'wyoming', 'wyo'],
];

// Multi-word state names (and other multi-token synonyms) live here.
const MULTI_STATES = [
  ['nh', ['new', 'hampshire']], ['nj', ['new', 'jersey']], ['nm', ['new', 'mexico']],
  ['ny', ['new', 'york']], ['nc', ['north', 'carolina']], ['nd', ['north', 'dakota']],
  ['ri', ['rhode', 'island']], ['sc', ['south', 'carolina']], ['sd', ['south', 'dakota']],
  ['wv', ['west', 'virginia']], ['dc', ['district', 'of', 'columbia']],
];

// V12 — single-token abbreviations. Containment-only matching (never set
// intersection) so `street` and `saint` do not become synonyms of each other.
const ABBREV = {
  dr: ['doctor'], doctor: ['dr'],
  st: ['street', 'saint'], street: ['st'], saint: ['st'],
  ave: ['avenue'], avenue: ['ave'],
  blvd: ['boulevard'], boulevard: ['blvd'],
  rd: ['road'], road: ['rd'],
  mt: ['mount'], mount: ['mt'],
  ft: ['fort'], fort: ['ft'],
};

// C18 — multi-token aliases expand on the KEYWORD side only, capped at 8, and
// only for short fields. An alias-derived win is capped at the family tier.
const PHRASE_ALIASES = (() => {
  const list = [
    { from: ['dentist'], to: ['dental', 'office'] },
    { from: ['dentist'], to: ['dental', 'practice'] },
    { from: ['dentist'], to: ['dental', 'clinic'] },
    { from: ['realtor'], to: ['real', 'estate', 'agent'] },
    { from: ['ac'], to: ['air', 'conditioning'] },
    { from: ['nyc'], to: ['new', 'york', 'city'] },
  ];
  for (const [code, words] of MULTI_STATES) {
    list.push({ from: [code], to: words.slice() });
    list.push({ from: words.slice(), to: [code] });
  }
  return list;
})();

// B.1 — a barrier after these never helps, so suppress it (optional polish).
const ABBR_NO_BARRIER = new Set(['dr', 'mr', 'mrs', 'ms', 'st', 'ave', 'inc', 'ltd', 'no', 'vs', 'approx', 'e', 'g', 'i']);

// C14 — in these fields `|`, `•`, `·`, `—`, `–` separate independent messages
// and are therefore BARRIERS, not plain boundaries.
const METADATA_FIELDS = new Set([
  'title', 'meta', 'meta_description', 'metadescription', 'description',
  'og:title', 'og_title', 'ogtitle', 'og:description', 'og_description',
  'ogdescription', 'schema', 'schema_name', 'twitter:title', 'twitter:description',
]);

// Fields that get the tighter proximity budget (G = 3).
const SHORT_FIELDS = new Set([
  ...METADATA_FIELDS, 'h1', 'h2', 'h3', 'h4', 'heading', 'headings',
  'alt', 'alt_text', 'slug', 'url', 'path', 'anchor', 'link',
]);

// Body-scale fields get G = 6 (prose legitimately spreads terms out).
const LONG_FIELDS = new Set(['body', 'content', 'prose', 'text', 'article', 'main']);

const NAMED_ENTITIES = {
  amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>',
  rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201D', ldquo: '\u201C',
  ndash: '\u2013', mdash: '\u2014', shy: '\u00AD', hellip: '\u2026',
  middot: '\u00B7', bull: '\u2022', times: '\u00D7', deg: '\u00B0',
  reg: '\u00AE', copy: '\u00A9', trade: '\u2122', eacute: '\u00E9',
};

const BARRIER_META_CHARS = /[|\u2022\u00B7\u2014\u2013]/;
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u00AD]/;
const NBSP_LIKE = /[\u00A0\u2007\u202F]/;

/* ------------------------------------------------- derived lexicon indexes */

const STATE_ALIAS = (() => {
  const m = new Map();
  const add = (k, v) => {
    if (!k || !v || k === v) return;
    if (!m.has(k)) m.set(k, []);
    const arr = m.get(k);
    if (!arr.includes(v)) arr.push(v);
  };
  for (const [code, name, trad] of US_STATES) {
    add(code, name); add(code, trad);
    add(name, code); add(name, trad);
    if (trad) { add(trad, code); add(trad, name); }
  }
  return m;
})();

const STATE_CODES = new Set(US_STATES.map((s) => s[0]).concat(MULTI_STATES.map((s) => s[0])));
const STATE_TRAD = new Set(US_STATES.map((s) => s[2]).filter(Boolean));

function familyIndex(vertical) {
  const m = new Map();
  for (const g of FAMILY_GROUPS) {
    if (vertical && g.verticals.length && !g.verticals.includes(vertical)) continue;
    for (const w of g.words) m.set(w, g.id);
  }
  return m;
}
const FAMILY_ALL = familyIndex(null);

/* ---------------------------------------------------------- normalisation */

/**
 * normalizeToken(raw) — C19: NFKD, strip combining marks, lowercase.
 * No length filter and no charset filter: every /[\p{L}\p{N}]+/ token is kept.
 */
function normalizeToken(raw) {
  if (raw == null) return '';
  return String(raw)
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase();
}

/* ------------------------------------------------------------- B.2 stem() */

// Undo an inflection-created doubled consonant, then restore a silent `e`
// where the base form needs one. `f`, `l`, `s` are excluded from the doubled
// set because they are legitimately doubled in base forms (fill, pass, staff),
// and unsplitting them would break symmetry with the base word.
const DOUBLED = /([bdgkmnprt])\1$/;
const SILENT_E = /(ur|ac|is|os|as|ov|iv|iz|bl)$/;

function stripVerbInflection(s) {
  let rem = null;
  if (s.endsWith('ing')) rem = s.slice(0, -3);
  else if (s.endsWith('ed')) rem = s.slice(0, -2);
  else return s;
  if (rem.length < 4 || !/[aeiouy]/.test(rem)) return s;
  if (DOUBLED.test(rem) && rem.length - 1 >= 3) return rem.slice(0, -1);
  if (SILENT_E.test(rem)) return rem + 'e';
  return rem;
}

/**
 * stem(w) — inflection only: plural, possessive-stripped forms and verb
 * endings. Safe, symmetric and idempotent; NEVER strips a derivational
 * suffix (er/or/ly/al/ist/ic) — those belong to rootKey(). Tiers 4-7 use it.
 */
function stem(w) {
  if (!w) return '';
  let s = String(w);
  if (IRREGULAR[s]) return IRREGULAR[s];
  if (/\d/.test(s)) return s;                 // digit-bearing: literal only
  if (s.length <= 3) return s;
  if (PLURAL_PROTECT.has(s)) return s;

  if (s.endsWith('ss')) {
    /* keep */
  } else if (s.endsWith('ies') && s.length > 4) {
    s = s.slice(0, -3) + 'y';
  } else if (/(ch|sh|x|z|s)es$/.test(s)) {
    s = s.slice(0, -2);
  } else if (s.endsWith('oes')) {
    s = s.slice(0, -2);
  } else if (/[^su]s$/.test(s)) {
    s = s.slice(0, -1);
  }

  if (IRREGULAR[s]) return IRREGULAR[s];
  if (PLURAL_PROTECT.has(s)) return s;
  if (s.length <= 3) return s;

  return stripVerbInflection(s);
}

/**
 * rootKey(w) — derivational family key, used ONLY for the family tier.
 * Hard rule (B.2): callers must not consult rootKey when the KEYWORD token's
 * root is shorter than 4 chars (car, law, spa, gym, ada get inflection only).
 */
function rootKey(w) {
  if (!w) return '';
  let s = stem(String(w));
  if (/\d/.test(s)) return s;
  for (let pass = 0; pass < 2; pass++) {
    let hit = false;
    for (const suf of DERIV_SUFFIXES) {
      if (s.length <= suf.length || !s.endsWith(suf)) continue;
      const rem = s.slice(0, -suf.length);
      if (rem.length >= 4 && /[aeiouy]/.test(rem)) { s = rem; hit = true; break; }
    }
    if (!hit) break;
  }
  if (s.length >= 5 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}

/* ---------------------------------------------------------------- B.1 scan */

function decodeEntity(body) {
  if (body[0] === '#') {
    const hex = body[1] === 'x' || body[1] === 'X';
    const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10FFFF) return null;
    try { return String.fromCodePoint(code); } catch { return null; }
  }
  const named = NAMED_ENTITIES[body.toLowerCase()];
  return named === undefined ? null : named;
}

/**
 * Offset-mapped pre-pass: decode a small set of entities, delete zero-width
 * and soft hyphens, map NBSP-family to a plain space — while recording, for
 * every character of the working string, its [start, end) span in the ORIGINAL
 * string so evidence quoting and KW14's character offset stay exact.
 */
function preprocess(src) {
  let work = '';
  const mapS = [];
  const mapE = [];
  const push = (chunk, s, e) => {
    for (const ch of chunk) {
      if (ZERO_WIDTH.test(ch)) continue;
      work += NBSP_LIKE.test(ch) ? ' ' : ch;
      mapS.push(s); mapE.push(e);
    }
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '&') {
      const m = /^&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,10});/.exec(src.slice(i, i + 14));
      if (m) {
        const rep = decodeEntity(m[1]);
        if (rep !== null) { push(rep, i, i + m[0].length); i += m[0].length; continue; }
      }
    }
    push(ch, i, i + 1);
    i++;
  }
  return { work, mapS, mapE };
}

function isBarrierGap(gap, prevTok, metadata) {
  if (!gap) return false;
  if (/[.!?;:](\s|$)/.test(gap)) {
    if (prevTok && ABBR_NO_BARRIER.has(prevTok.norm) && /^\s*\.\s*$/.test(gap)) return false;
    return true;
  }
  if (metadata && BARRIER_META_CHARS.test(gap)) return true;
  if (/\n[ \t]*\n/.test(gap)) return true;
  return false;
}

/**
 * scan(text, opts) -> Token[]
 *
 * opts:
 *   field      string   field name; drives the metadata-barrier rule (C14)
 *   metadata   boolean  force the metadata-barrier rule on/off
 *   side       'text'|'keyword'  keyword-side tokens are never alias-gated
 *   vertical   string   restricts the FAMILY lexicon (pageContext.detectedVertical)
 *
 * Token: { raw, norm, srcStart, srcEnd, stem, root, alias, fam, isStop,
 *          barrierBefore, glueNext, wasUpper, wasCap, hasDigit,
 *          aliasBlocked, dropped, idx }
 *
 * Stopwords are RETAINED (offsets and wasUpper survive); the content index
 * built by matchKeyword skips them.
 */
function scan(text, opts = {}) {
  const src = text == null ? '' : String(text);
  const field = String(opts.field || '').toLowerCase();
  const metadata = opts.metadata != null ? !!opts.metadata : METADATA_FIELDS.has(field);
  const keywordSide = opts.side === 'keyword';
  const fam = opts.vertical ? familyIndex(String(opts.vertical).toLowerCase()) : FAMILY_ALL;

  const { work, mapS, mapE } = preprocess(src);
  const tokens = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m;
  let prevEnd = 0;

  const makeToken = (raw, s, e, gap) => {
    const norm = normalizeToken(raw);
    const hasDigit = /\d/.test(norm);
    const wasUpper = /^[^\p{Ll}]+$/u.test(raw) && /\p{Lu}/u.test(raw);
    const wasCap = /^\p{Lu}/u.test(raw);
    const prevTok = tokens.length ? tokens[tokens.length - 1] : null;
    const aliasList = [];
    if (!hasDigit) {
      const st = STATE_ALIAS.get(norm);
      if (st) for (const a of st) if (!aliasList.includes(a)) aliasList.push(a);
      const ab = ABBREV[norm];
      if (ab) for (const a of ab) if (!aliasList.includes(a)) aliasList.push(a);
    }
    // V7.7 — two-letter state codes are all English words or stopwords when
    // lowercased, and traditional abbreviations are proper nouns; on the TEXT
    // side require the original surface to prove it is really the state.
    let aliasBlocked = false;
    if (!keywordSide) {
      if (norm.length <= 2 && STATE_CODES.has(norm) && !wasUpper) aliasBlocked = true;
      else if (STATE_TRAD.has(norm) && !wasCap) aliasBlocked = true;
    }
    return {
      raw, norm,
      srcStart: s, srcEnd: e,
      stem: hasDigit ? norm : stem(norm),
      root: hasDigit ? norm : rootKey(norm),
      alias: aliasList,
      fam: hasDigit ? null : (fam.get(norm) || null),
      isStop: STOP.has(norm),
      barrierBefore: isBarrierGap(gap, prevTok, metadata),
      glueNext: false,
      wasUpper, wasCap, hasDigit, aliasBlocked,
      dropped: false,
      idx: tokens.length,
    };
  };

  while ((m = re.exec(work)) !== null) {
    const gap = work.slice(prevEnd, m.index);
    // `&` standing alone reads as the word "and" (Crowns & Bridges).
    if (tokens.length && /(^|\s)&(\s|$)/.test(gap)) {
      const at = m.index - (gap.length - gap.indexOf('&'));
      const amp = makeToken('&', mapS[at] != null ? mapS[at] : m.index, mapE[at] != null ? mapE[at] : m.index + 1, gap.slice(0, gap.indexOf('&')));
      amp.norm = 'and';
      amp.stem = 'and';
      amp.root = 'and';
      amp.isStop = true;
      tokens.push(amp);
    }
    const tok = makeToken(
      work.slice(m.index, m.index + m[0].length),
      mapS[m.index],
      mapE[m.index + m[0].length - 1],
      gap
    );
    // V4 — possessive: `Arlington's` keeps the owner and drops the clitic `s`.
    const prev = tokens.length ? tokens[tokens.length - 1] : null;
    if (prev && tok.norm === 's' && /^['\u2019]$/.test(gap) && !prev.hasDigit) {
      tok.dropped = true;
      prev.srcEnd = tok.srcEnd;
    }
    // glue: `-` or `'` with no whitespace (e-commerce, walk-in).
    if (prev && /^[-'\u2019\u2011]$/.test(gap)) prev.glueNext = true;
    tokens.push(tok);
    prevEnd = m.index + m[0].length;
  }
  for (let i = 0; i < tokens.length; i++) tokens[i].idx = i;
  return tokens;
}

/* --------------------------------------------------------- content indexing */

function buildContent(tokens, kwNorms, kwStems) {
  const out = [];
  let barrier = false;
  for (const t of tokens) {
    if (t.barrierBefore) barrier = true;
    if (t.dropped || t.isStop) continue;
    const c = t;
    out.push({
      norm: c.norm, stem: c.stem, root: c.root, alias: c.alias, fam: c.fam,
      srcStart: c.srcStart, srcEnd: c.srcEnd, hasDigit: c.hasDigit,
      aliasBlocked: c.aliasBlocked, barrierBefore: barrier, tokIdx: c.idx,
      merged: false,
    });
    barrier = false;
  }
  // V8 — glued forms: merge an adjacent hyphen/apostrophe-joined pair when the
  // concatenation is what the keyword actually says (ecommerce ~ e-commerce).
  if (kwNorms && kwNorms.size) {
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i], b = out[i + 1];
      if (b.tokIdx !== a.tokIdx + 1) continue;
      if (!tokens[a.tokIdx] || !tokens[a.tokIdx].glueNext) continue;
      const merged = a.norm + b.norm;
      const ms = stem(merged);
      if (!kwNorms.has(merged) && !(kwStems && kwStems.has(ms))) continue;
      out.splice(i, 2, {
        norm: merged, stem: ms, root: rootKey(merged), alias: [], fam: a.fam || b.fam,
        srcStart: a.srcStart, srcEnd: b.srcEnd, hasDigit: a.hasDigit || b.hasDigit,
        aliasBlocked: true, barrierBefore: a.barrierBefore, tokIdx: a.tokIdx,
        merged: true,
      });
    }
  }
  return out;
}

/* ---------------------------------------------------------- B.3 match level */

function aliasHit(k, c) {
  if (c.aliasBlocked) return false;
  for (const a of k.alias) if (a === c.norm) return true;
  for (const a of c.alias) if (a === k.norm) return true;
  return false;
}

/** level(k, c): 3 literal \u00B7 2 inflected/alias/glued \u00B7 1 family \u00B7 0 none */
function levelOf(k, c) {
  if (k.norm === c.norm) return c.merged ? 2 : 3;
  if (k.hasDigit || c.hasDigit) return 0;      // digits match literally only
  if (k.stem && k.stem === c.stem) return 2;
  if (aliasHit(k, c)) return 2;
  if (k.fam && c.fam && k.fam === c.fam) return 1;
  if (k.root && k.root.length >= 4 && k.root === c.root) return 1;
  return 0;
}

function buildLevels(kw, content) {
  const levels = [];
  for (let i = 0; i < kw.length; i++) {
    const row = new Int8Array(content.length);
    for (let p = 0; p < content.length; p++) row[p] = levelOf(kw[i], content[p]);
    levels.push(row);
  }
  return levels;
}

/* -------------------------------------------------------------- assignment */

// Ordered (order-preserving) assignment at level threshold L: earliest
// feasible position for each keyword token. Greedy-earliest is optimal both
// for feasibility and for minimising `hi` given the scan start.
function orderedAssign(levels, n, s, e, L) {
  const assign = new Array(n);
  let p = s;
  for (let i = 0; i < n; i++) {
    while (p <= e && levels[i][p] < L) p++;
    if (p > e) return null;
    assign[i] = p;
    p++;
  }
  return assign;
}

// C11 — greedy token->position assignment is NOT correct on its own; fall back
// to an exhaustive (bipartite augmenting-path) search so a coverage check is
// never failed when an optimal assignment exists.
function augment(i, levels, s, e, L, seen, posToKw) {
  for (let p = s; p <= e; p++) {
    if (levels[i][p] < L || seen[p - s]) continue;
    seen[p - s] = 1;
    const owner = posToKw[p - s];
    if (owner === -1 || augment(owner, levels, s, e, L, seen, posToKw)) {
      posToKw[p - s] = i;
      return true;
    }
  }
  return false;
}

function unorderedAssign(levels, n, s, e, L) {
  const width = e - s + 1;
  if (width < n) return null;
  // Greedy first (cheap): most-constrained keyword token first.
  const order = [];
  for (let i = 0; i < n; i++) {
    let cands = 0;
    for (let p = s; p <= e; p++) if (levels[i][p] >= L) cands++;
    if (cands === 0) return null;
    order.push([i, cands]);
  }
  order.sort((a, b) => a[1] - b[1]);
  const used = new Set();
  const greedy = new Array(n);
  let ok = true;
  for (const [i] of order) {
    let bestP = -1, bestLv = 0;
    for (let p = s; p <= e; p++) {
      if (used.has(p) || levels[i][p] < L) continue;
      if (levels[i][p] > bestLv) { bestLv = levels[i][p]; bestP = p; }
    }
    if (bestP === -1) { ok = false; break; }
    used.add(bestP);
    greedy[i] = bestP;
  }
  if (ok) return greedy;
  // Exhaustive fallback (bounded by n <= keyword length, width <= n + G).
  const posToKw = new Int16Array(width).fill(-1);
  for (let i = 0; i < n; i++) {
    const seen = new Uint8Array(width);
    if (!augment(i, levels, s, e, L, seen, posToKw)) return null;
  }
  const assign = new Array(n).fill(-1);
  for (let p = 0; p < width; p++) if (posToKw[p] !== -1) assign[posToKw[p]] = p + s;
  return assign.some((v) => v === -1) ? null : assign;
}

/* -------------------------------------------------------- tier arithmetic */

function scoreFor(tier, { gaps = 0, ordered = true, coverage = 1 } = {}) {
  switch (tier) {
    case TIER.EXACT_PHRASE: return 100;
    case TIER.EXACT_PHRASE_INFLECTED: return 92;
    case TIER.ORDERED_WITH_GAPS: return Math.max(1, 80 - 4 * gaps);
    case TIER.UNORDERED_PROXIMITY: return Math.max(1, 66 - 4 * gaps);
    case TIER.FAMILY_PROXIMITY: return Math.max(1, 50 - 4 * gaps - (ordered ? 0 : 2));
    case TIER.SCATTERED_TERMS: return 35;
    case TIER.PARTIAL_TERMS: return Math.max(1, Math.round(25 * coverage));
    default: return 0;
  }
}

function classify(minLevel, ordered, gaps) {
  if (minLevel >= 2) {
    if (gaps === 0 && ordered) return minLevel >= 3 ? TIER.EXACT_PHRASE : TIER.EXACT_PHRASE_INFLECTED;
    return ordered ? TIER.ORDERED_WITH_GAPS : TIER.UNORDERED_PROXIMITY;
  }
  return TIER.FAMILY_PROXIMITY;
}

/* ------------------------------------------------------------ core search */

function searchBest(content, kw, levels, G, anchorLo) {
  const n = kw.length;
  const len = content.length;
  const maxSpan = n + G;
  let best = null;

  const consider = (assign) => {
    let lo = assign[0], hi = assign[0], minLevel = 4, ordered = true;
    for (let i = 0; i < n; i++) {
      const p = assign[i];
      if (p < lo) lo = p;
      if (p > hi) hi = p;
      const lv = levels[i][p];
      if (lv < minLevel) minLevel = lv;
      if (i > 0 && p <= assign[i - 1]) ordered = false;
    }
    if (anchorLo != null && lo !== anchorLo) return;
    const span = hi - lo + 1;
    const gaps = span - n;
    if (gaps < 0 || gaps > G) return;
    const tier = classify(minLevel, ordered, gaps);
    const score = scoreFor(tier, { gaps, ordered, coverage: 1 });
    if (best) {
      if (score < best.score) return;
      if (score === best.score) {
        if (TIER_RANK[tier] < TIER_RANK[best.tier]) return;
        if (TIER_RANK[tier] === TIER_RANK[best.tier] && span >= best.span && lo >= best.lo) return;
      }
    }
    best = { tier, score, minLevel, ordered, gaps, span, lo, hi, assign: assign.slice() };
  };

  for (let s = 0; s < len; s++) {
    if (anchorLo != null && s > anchorLo) break;
    let anyHere = false;
    for (let i = 0; i < n; i++) if (levels[i][s] > 0) { anyHere = true; break; }
    if (!anyHere) continue;
    for (let e = s; e < len && e - s + 1 <= maxSpan; e++) {
      if (e > s && content[e].barrierBefore) break;
      for (const L of [3, 2, 1]) {
        const oa = orderedAssign(levels, n, s, e, L);
        if (oa) consider(oa);
        if (n > 1) {
          const ua = unorderedAssign(levels, n, s, e, L);
          if (ua) consider(ua);
        }
      }
      if (best && best.score === 100) return best;
    }
  }
  return best;
}

/* ----------------------------------------------------------------- helpers */

function keywordTokens(keyword, opts) {
  const all = scan(keyword, { side: 'keyword', vertical: opts.vertical }).filter((t) => !t.dropped);
  return {
    all,
    content: all.filter((t) => !t.isStop),
    stops: all.filter((t) => t.isStop).map((t) => t.norm),
  };
}

function resolveOpts(text, opts = {}) {
  const field = String(opts.field || 'auto').toLowerCase();
  const long = LONG_FIELDS.has(field) || (field === 'auto' && String(text == null ? '' : text).length > 400);
  const G = Number.isFinite(opts.G) ? Math.max(0, Math.trunc(opts.G)) : (long ? 6 : 3);
  const shortField = SHORT_FIELDS.has(field) || (field === 'auto' && !long);
  const phraseAliases = opts.phraseAliases != null ? !!opts.phraseAliases : shortField;
  return { field, long, G, shortField, phraseAliases };
}

function absentResult(keyword) {
  return {
    tier: TIER.ABSENT, rank: 0, score: 0, minLevel: 0, ordered: false, gaps: 0,
    coverage: 0, srcStart: -1, srcEnd: -1, evidence: '', flags: [],
    keyword: String(keyword == null ? '' : keyword), terms: 0, found: [], missing: [],
  };
}

function applyCap(res, capTier) {
  if (!capTier || TIER_RANK[res.tier] <= TIER_RANK[capTier]) return res;
  res.tier = capTier;
  res.rank = TIER_RANK[capTier];
  res.score = scoreFor(capTier, { gaps: res.gaps, ordered: res.ordered, coverage: res.coverage });
  return res;
}

function stopwordsSkipped(tokens, content, assign, kwStops) {
  let lo = Infinity, hi = -Infinity;
  for (const p of assign) {
    const ti = content[p].tokIdx;
    if (ti < lo) lo = ti;
    if (ti > hi) hi = ti;
  }
  const kws = new Set(kwStops);
  const seen = [];
  for (let i = lo + 1; i < hi; i++) {
    const t = tokens[i];
    if (!t || !t.isStop || t.dropped) continue;
    if (kws.has(t.norm)) continue;            // 'in' is in the keyword itself
    if (!seen.includes(t.norm)) seen.push(t.norm);
  }
  return seen;
}

function expandPhraseVariants(kwContent, cap = 8) {
  const variants = [];
  const baseNorms = kwContent.map((t) => t.norm);
  for (const rule of PHRASE_ALIASES) {
    if (variants.length >= cap) break;
    const from = rule.from;
    for (let i = 0; i + from.length <= baseNorms.length; i++) {
      let ok = true;
      for (let j = 0; j < from.length; j++) if (baseNorms[i + j] !== from[j]) { ok = false; break; }
      if (!ok) continue;
      const replacement = rule.to.map((w) => ({
        raw: w, norm: w, stem: stem(w), root: rootKey(w),
        alias: (STATE_ALIAS.get(w) || []).concat(ABBREV[w] || []),
        fam: FAMILY_ALL.get(w) || null, hasDigit: /\d/.test(w), aliasBlocked: false,
        isStop: STOP.has(w),
      })).filter((t) => !t.isStop);
      if (!replacement.length) continue;
      const next = kwContent.slice(0, i).concat(replacement, kwContent.slice(i + from.length));
      variants.push(next);
      if (variants.length >= cap) break;
    }
  }
  return variants;
}

function brandSpans(text, brandName, opts) {
  if (!brandName) return [];
  const kw = keywordTokens(brandName, opts);
  if (!kw.content.length) return [];
  const res = countCore(text, kw, { G: 1, minRank: TIER_RANK.exact_phrase_inflected, vertical: opts.vertical, field: opts.field });
  return res.hits.map((h) => [h.srcStart, h.srcEnd]);
}

function inSpans(spans, s, e) {
  for (const [a, b] of spans) if (s >= a && e <= b) return true;
  return false;
}

/* ------------------------------------------------------- B.3 matchKeyword */

function matchOne(text, kwContent, kwAll, kwStops, cfg) {
  const kwNorms = new Set(kwContent.map((t) => t.norm));
  const kwStemSet = new Set(kwContent.map((t) => t.stem));
  const tokens = scan(text, { field: cfg.field, metadata: cfg.metadata, vertical: cfg.vertical });
  const content = buildContent(tokens, kwNorms, kwStemSet);
  const n = kwContent.length;

  // Per-term presence anywhere in the text (drives scattered vs partial).
  const levels = buildLevels(kwContent, content);
  const found = [], missing = [];
  for (let i = 0; i < n; i++) {
    let maxLv = 0, at = -1;
    for (let p = 0; p < content.length; p++) if (levels[i][p] > maxLv) { maxLv = levels[i][p]; at = p; }
    if (maxLv > 0) found.push({ term: kwContent[i].norm, level: maxLv, at });
    else missing.push(kwContent[i].norm);
  }
  const coverage = n ? found.length / n : 0;

  // B.7.3 — keyword longer than the field: short-circuit, no scanning.
  const best = (n > content.length) ? null : searchBest(content, kwContent, levels, cfg.G, null);

  if (best) {
    const flags = [];
    const skipped = stopwordsSkipped(tokens, content, best.assign, kwStops);
    if (skipped.length) flags.push('stopwords_skipped:' + skipped.join(','));
    if (!best.ordered) flags.push('word_order_reversed');
    if (best.minLevel <= 1) flags.push('family_match_only');
    const srcStart = content[best.lo].srcStart;
    const srcEnd = content[best.hi].srcEnd;
    return {
      tier: best.tier, rank: TIER_RANK[best.tier], score: best.score,
      minLevel: best.minLevel, ordered: best.ordered, gaps: best.gaps, coverage: 1,
      srcStart, srcEnd, evidence: String(text).slice(srcStart, srcEnd),
      flags, terms: n, found: found.map((f) => f.term), missing: [],
    };
  }

  if (!found.length) return Object.assign(absentResult(''), { terms: n, missing });

  const anchor = content[found[0].at];
  const scattered = missing.length === 0;
  const tier = scattered ? TIER.SCATTERED_TERMS : TIER.PARTIAL_TERMS;
  return {
    tier, rank: TIER_RANK[tier], score: scoreFor(tier, { coverage }),
    minLevel: Math.min(...found.map((f) => f.level)), ordered: false, gaps: 0, coverage,
    srcStart: anchor.srcStart, srcEnd: anchor.srcEnd,
    evidence: String(text).slice(anchor.srcStart, anchor.srcEnd),
    flags: scattered ? ['no_phrase_window'] : [],
    terms: n, found: found.map((f) => f.term), missing,
  };
}

/**
 * matchKeyword(keyword, text, opts) -> graded result
 *
 * opts: { field, metadata, G, vertical, brandName, phraseAliases }
 * result: { tier, rank, score, minLevel, ordered, gaps, coverage,
 *           srcStart, srcEnd, evidence, flags[] , keyword, terms, found, missing }
 */
function matchKeyword(keyword, text, opts = {}) {
  const kwRaw = keyword == null ? '' : String(keyword);
  const src = text == null ? '' : String(text);
  const cfg = resolveOpts(src, opts);
  const field = String(opts.field || 'auto').toLowerCase();
  const metadata = opts.metadata != null ? !!opts.metadata : METADATA_FIELDS.has(field);
  const base = { field, metadata, G: cfg.G, vertical: opts.vertical };

  const kw = keywordTokens(kwRaw, opts);
  if (!kw.all.length || !src) return Object.assign(absentResult(kwRaw), { terms: kw.content.length });

  // B.7.1 — keyword collapses to nothing but stopwords: literal phrase test.
  if (!kw.content.length) {
    const phrase = kw.all.map((t) => t.norm).join(' ');
    const tokens = scan(src, base);
    const flat = tokens.filter((t) => !t.dropped).map((t) => t.norm).join(' ');
    const at = flat.indexOf(phrase);
    const res = absentResult(kwRaw);
    res.flags.push('all_stopword_keyword');
    if (at >= 0) {
      res.tier = TIER.EXACT_PHRASE; res.rank = 7; res.score = 100; res.minLevel = 3;
      res.ordered = true; res.coverage = 1;
      const first = tokens.find((t) => !t.dropped);
      if (first) { res.srcStart = first.srcStart; res.srcEnd = first.srcEnd; res.evidence = src.slice(first.srcStart, first.srcEnd); }
    }
    return res;
  }

  // B.7.1 — intent modifiers ('near me', 'in the area') cannot appear on-page.
  let capTier = null;
  const extraFlags = [];
  if (kw.content.length === 1 && kw.all.length >= 3) {
    capTier = TIER.ORDERED_WITH_GAPS;
    extraFlags.push('intent_modifier_stripped:' + kw.stops.join(','));
  }

  let best = matchOne(src, kw.content, kw.all, kw.stops, base);
  let viaAlias = false;

  // C18 — phrase aliases: keyword side only, short fields only, capped at 8,
  // and an alias win can never score above the family tier (V10).
  if (cfg.phraseAliases) {
    for (const variant of expandPhraseVariants(kw.content, 8)) {
      const alt = matchOne(src, variant, kw.all, kw.stops, base);
      const capped = applyCap(alt, TIER.FAMILY_PROXIMITY);
      // A synonym exists to prevent a FALSE NEGATIVE, never to polish a score:
      // it is adopted only when it lifts the TIER the base match reached. That
      // keeps `/dental-offices/ma/arlington` at family_proximity/42 (the gap
      // arithmetic of the literal path) instead of letting the `dental office`
      // alias re-score the same tier upward.
      if (TIER_RANK[capped.tier] > TIER_RANK[best.tier]) {
        best = capped;
        viaAlias = true;
      }
    }
  }

  best.keyword = kwRaw;
  if (viaAlias) best.flags.push('phrase_alias');
  applyCap(best, capTier);
  for (const f of extraFlags) best.flags.push(f);

  if (opts.brandName) {
    const spans = brandSpans(src, opts.brandName, { vertical: opts.vertical, field });
    if (best.srcStart >= 0 && inSpans(spans, best.srcStart, best.srcEnd)) best.flags.push('brand_incidental');
  }
  best.rank = TIER_RANK[best.tier];
  return best;
}

/* ---------------------------------------------------- B.5 countOccurrences */

function countCore(text, kw, cfg) {
  const src = text == null ? '' : String(text);
  const kwNorms = new Set(kw.content.map((t) => t.norm));
  const kwStemSet = new Set(kw.content.map((t) => t.stem));
  const tokens = scan(src, { field: cfg.field, metadata: cfg.metadata, vertical: cfg.vertical });
  const content = buildContent(tokens, kwNorms, kwStemSet);
  const levels = buildLevels(kw.content, content);
  const n = kw.content.length;
  const hits = [];
  let cursor = 0;
  // Single left-to-right pass with GREEDY SPAN CONSUMPTION: an accepted match
  // advances the cursor past its last token, so no token can participate in
  // two counted occurrences. That is structurally what kills the old
  // sum-over-variants double-count.
  while (cursor < content.length) {
    const m = (n > content.length) ? null : searchBest(content, kw.content, levels, cfg.G, cursor);
    if (m && TIER_RANK[m.tier] >= cfg.minRank) {
      const srcStart = content[m.lo].srcStart;
      const srcEnd = content[m.hi].srcEnd;
      hits.push({
        tier: m.tier, rank: TIER_RANK[m.tier], score: m.score, minLevel: m.minLevel,
        ordered: m.ordered, gaps: m.gaps, coverage: 1,
        srcStart, srcEnd, evidence: src.slice(srcStart, srcEnd),
        flags: m.ordered ? [] : ['word_order_reversed'],
        loIdx: m.lo, hiIdx: m.hi,
      });
      cursor = m.hi + 1;
    } else {
      cursor++;
    }
  }
  return { count: hits.length, hits, contentTokens: content.length };
}

/**
 * countOccurrences(keyword, text, opts) -> { count, hits[], contentTokens }
 *
 * opts: { minTier='ordered_with_gaps', G=3, field, metadata, vertical, brandName }
 * Non-overlapping by construction (B.5).
 */
function countOccurrences(keyword, text, opts = {}) {
  const kwRaw = keyword == null ? '' : String(keyword);
  const src = text == null ? '' : String(text);
  const minTier = opts.minTier && TIER_RANK[opts.minTier] != null ? opts.minTier : TIER.ORDERED_WITH_GAPS;
  let minRank = TIER_RANK[minTier];
  const field = String(opts.field || 'body').toLowerCase();
  const metadata = opts.metadata != null ? !!opts.metadata : METADATA_FIELDS.has(field);
  const G = Number.isFinite(opts.G) ? Math.max(0, Math.trunc(opts.G)) : 3;

  const kw = keywordTokens(kwRaw, opts);
  if (!kw.content.length || !src) return { count: 0, hits: [], contentTokens: 0, minTier };

  // B.7.1 — an intent-modifier keyword is capped at ordered_with_gaps; make
  // sure the cap cannot silently disqualify every hit.
  let capTier = null;
  if (kw.content.length === 1 && kw.all.length >= 3) {
    capTier = TIER.ORDERED_WITH_GAPS;
    if (minRank > TIER_RANK[capTier]) minRank = TIER_RANK[capTier];
  }

  const out = countCore(src, kw, { G, minRank, field, metadata, vertical: opts.vertical });
  if (capTier) for (const h of out.hits) { applyCap(h, capTier); h.flags.push('intent_modifier_stripped:' + kw.stops.join(',')); }

  if (opts.brandName) {
    const spans = brandSpans(src, opts.brandName, { vertical: opts.vertical, field });
    out.brandIncidental = 0;
    for (const h of out.hits) {
      if (inSpans(spans, h.srcStart, h.srcEnd)) { h.flags.push('brand_incidental'); out.brandIncidental++; }
    }
  }
  out.minTier = minTier;
  return out;
}

/* ------------------------------------------------------------------ export */

module.exports = {
  scan,
  normalizeToken,
  stem,
  rootKey,
  matchKeyword,
  countOccurrences,
  TIER,
  TIER_RANK,
};
