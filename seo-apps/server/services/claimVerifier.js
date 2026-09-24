'use strict';

// ── claimVerifier ─────────────────────────────────────────────────────────────
// Fact-checks the statistics, expert quotes and citations that the article
// enhancer inserts, and strips the ones that actively fail.
//
// The enhancement prompts ask the model for sourced statistics, named-expert
// quotes and outbound citations. Those are the highest-risk output in the
// product and nothing verified them: a fabricated figure is embarrassing, and
// an invented quote attributed to a real person is worse than embarrassing.
//
// Four invariants govern everything here. Each exists because violating it
// would do more damage than the bad statistic the pass was meant to catch.
//
//   1. Only an ACTIVE verification failure removes a claim. Quota exhausted,
//      network error, timeout, 403, empty result set, model failure, budget cap
//      — every infrastructure problem KEEPS the claim and says so.
//
//   2. Removal only ever deletes text inside [NEW:…] markers. The original
//      article is reproduced verbatim by contract. `verifyStructure` checks
//      this after the fact and reverts wholesale if it was violated.
//
//   3. A refutation must cite evidence we actually retrieved. The adjudicator's
//      supporting URL must be one of the URLs we passed it, or the verdict is
//      downgraded. This is what stops a hallucinating judge deleting real work.
//
//   4. A mass removal is a broken verifier, not a dishonest article. Past a
//      threshold the pass abandons removal entirely and only reports.
//
// Dependencies are injected rather than required: routes/articleEnhancement.js
// attaches `.helpers` AFTER `module.exports = router`, so requiring it back from
// here would yield undefined during the require cycle. Injection also lets the
// whole pass be tested with stubs, spending no API quota.

const {
  STATISTIC_EXCLUSIONS,
  CREDENTIAL_PATTERN,
  AUTHORITATIVE_DOMAINS,
  headRequest: defaultHeadRequest,
} = require('../checks/seoGeoChecks');

// The three change types in the 'evidence' group. Mirrors CHANGE_TYPE_GROUP in
// routes/articleEnhancement.js — kept in step by a cross-check in the tests
// rather than by a require, to avoid the cycle described above.
const EVIDENCE_TYPES = new Set(['stat', 'quote', 'cite']);

// Marker grammar, same as routes/articleEnhancement.js. Built fresh on every
// use: a shared module-level /g regex carries `lastIndex` between calls, and two
// SSE runs in flight at once would corrupt each other's traversal.
const newBlockRe = () => /\[NEW(?::([a-z]+))?\]([\s\S]*?)\[\/NEW\]/g;

const DROP_LINE = '\u0000DROP\u0000';

const DEFAULTS = {
  maxLookups: 8,            // Google's free tier is 100/day shared across every tool
  concurrency: 3,
  perLookupTimeoutMs: 15000,
  minRemovalConfidence: 0.8,
  cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
  maxRemovals: 8,
  maxRemovalFraction: 0.5,
  // The fraction rule only means anything once there are enough claims for a
  // proportion to be evidence of a broken verifier. Below this, "100% removed"
  // is just one bad statistic in an article that had one statistic.
  minClaimsForFraction: 4,
  consecutiveFailureLimit: 2,
};

// Verdicts that delete. Everything else keeps the claim, which is what makes
// invariant 1 hold by construction rather than by careful casework.
const REMOVING_VERDICTS = new Set(['refuted', 'unsupported']);

// Nothing technical is ever shown to the user. A failed lookup, a 502 from the
// adjudicator, a blocked source, an exhausted budget — from where they sit
// these are all the same fact: we could not confirm it, so we left it alone.
// The cause goes in `debug`, which stays server-side for the logs and never
// reaches the report or the progress panel.
//
// Findings are different and DO get shown: "dated in the future", "no named
// speaker", "the cited page no longer exists" are conclusions about the
// content, not failures of the checker, and they are why a claim was removed.
const NOTE = {
  unverified: 'Could not be confirmed — kept for your review',
  notChecked: 'Not checked — kept for your review',
  sourceUnreadable: 'The cited source could not be read — kept for your review',
};

// ── Extraction ────────────────────────────────────────────────────────────────

function lineAt(text, index) {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  let end = text.indexOf('\n', index);
  if (end === -1) end = text.length;
  return { line: text.slice(start, end), start, end };
}

// Where a block sits, which decides how it can be safely cut out.
function shapeOf(line, raw) {
  const trimmed = line.trim();
  const bare = trimmed.replace(newBlockRe(), '$2').trim();
  if (/^#{1,6}\s/.test(bare)) return 'heading';
  if (bare.startsWith('|') && bare.endsWith('|')) return 'tablerow';
  // Before the whole-line test: a list item usually IS the whole line, and it
  // needs its own handling so ordered lists get renumbered after a removal.
  if (/^(?:[-*]\s|\d+[.)]\s)/.test(bare)) return 'listitem';
  if (trimmed === raw.trim()) return 'line';
  return 'inline';
}

// An inline insertion woven into the middle of an original sentence cannot be
// cut out and leave grammatical prose. Detect that and refuse to remove it.
function inlineIsSafeToRemove(line, raw) {
  const at = line.indexOf(raw);
  if (at === -1) return false;
  const before = line.slice(0, at).trim();
  const after = line.slice(at + raw.length).trim();
  const beforeOk = before === '' || /[.!?:;—–-]$/.test(before);
  const afterOk = after === '' || /^[A-Z[(]/.test(after) || /^[.!?]/.test(after);
  return beforeOk && afterOk;
}

// Strip spans that look like a price, phone number, ZIP, time or address before
// hunting for a figure, so "$1,500 per suite" is not read as a magnitude.
function withoutExcludedSpans(s) {
  let out = String(s || '');
  for (const p of STATISTIC_EXCLUSIONS) {
    const flags = p.flags.includes('g') ? p.flags : p.flags + 'g';
    out = out.replace(new RegExp(p.source, flags), ' ');
  }
  return out;
}

const PERCENT_RE = /(\d[\d.,]*)\s*%/;
const RATIO_RE = /\b(\d[\d,]*)\s+(?:in|out of|per)\s+(\d[\d,]*)\b/i;
const MAGNITUDE_RE = /\b(\d[\d,]*(?:\.\d+)?)\s*(million|billion|thousand|percent)\b/i;
const SOURCE_YEAR_RE = /\(([^(),]{2,60}),\s*((?:19|20)\d{2})\)/;
const ACCORDING_TO_RE = /\baccording to\s+([A-Z][^,.;]{2,60})/;
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/;
const BARE_URL_RE = /(https?:\/\/[^\s)<>"']+)/;
const QUOTED_RE = /["“]([^"”]{20,})["”]|'([^']{25,})'/;
const PERSON_RE = /\b(?:As|According to)\s+([A-Z][\w.'’-]+(?:\s+[A-Z][\w.'’-]+)+)/;
const ORG_AT_RE = /\bat\s+([A-Z][^,(.]{2,60})/;
const YEAR_RE = /\((\d{4})\)/;

// The prompt's own placeholders leaking into the output. Unambiguously bogus and
// free to catch — in this prompt shape it is the most common real defect.
const TEMPLATE_LEAK_RE = /\[(?:X|Y|N|NAME|Full Name|Credential(?:\/Title)?|Title|Org(?:anisation|anization)?|Year|Source|population|action|quote)\]|\(Source,\s*Year\)/i;

function parseStat(inner) {
  const scrubbed = withoutExcludedSpans(inner);
  const pct = scrubbed.match(PERCENT_RE);
  const ratio = scrubbed.match(RATIO_RE);
  const mag = scrubbed.match(MAGNITUDE_RE);
  const sy = inner.match(SOURCE_YEAR_RE);
  const acc = inner.match(ACCORDING_TO_RE);
  return {
    figure: pct ? `${pct[1]}%` : ratio ? `${ratio[1]} in ${ratio[2]}` : mag ? `${mag[1]} ${mag[2]}` : null,
    percentValue: pct ? Number(String(pct[1]).replace(/,/g, '')) : null,
    source: sy ? sy[1].trim() : (acc ? acc[1].trim() : null),
    year: sy ? Number(sy[2]) : null,
  };
}

function parseQuote(inner) {
  const q = inner.match(QUOTED_RE);
  const person = inner.match(PERSON_RE);
  const org = inner.match(ORG_AT_RE);
  const year = inner.match(YEAR_RE);
  const cred = inner.match(CREDENTIAL_PATTERN);
  return {
    quote: q ? (q[1] || q[2] || '').trim() : null,
    person: person ? person[1].trim() : null,
    org: org ? org[1].trim() : null,
    credential: cred ? cred[0] : null,
    year: year ? Number(year[1]) : null,
  };
}

function parseCite(inner) {
  const link = inner.match(MD_LINK_RE);
  const bare = link ? null : inner.match(BARE_URL_RE);
  const acc = inner.match(ACCORDING_TO_RE);
  const sy = inner.match(SOURCE_YEAR_RE);
  return {
    url: link ? link[2] : (bare ? bare[1] : null),
    anchor: link ? link[1] : null,
    source: acc ? acc[1].trim() : (sy ? sy[1].trim() : null),
  };
}

// Walk every marker, keeping the evidence-group ones. `ordinal` is the position
// among ALL blocks: removal re-walks with the same grammar and matches on it, so
// the two passes cannot drift.
function extractClaims(text) {
  const src = String(text || '');
  const claims = [];
  let ordinal = -1;
  for (const m of src.matchAll(newBlockRe())) {
    ordinal++;
    const [raw, type, inner] = m;
    if (!type || !EVIDENCE_TYPES.has(type)) continue;
    const { line } = lineAt(src, m.index);
    const shape = shapeOf(line, raw);
    const fields = type === 'stat' ? parseStat(inner)
      : type === 'quote' ? parseQuote(inner)
      : parseCite(inner);
    claims.push({
      id: `${type}-${ordinal}`,
      ordinal,
      type,
      raw,
      inner: inner.trim(),
      shape,
      // A heading can never be cut (it would orphan its body), and an inline
      // span mid-sentence cannot be cut grammatically.
      removable: shape !== 'heading' && (shape !== 'inline' || inlineIsSafeToRemove(line, raw)),
      fields,
    });
  }
  return claims;
}

function claimKey(claim) {
  return `${claim.type}:${claim.inner.toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

// ── Deterministic screen (free, no network) ───────────────────────────────────

function screenClaim(claim, now = new Date()) {
  const year = now.getFullYear();
  const f = claim.fields;

  // Prompt scaffolding in the output, for any type.
  if (TEMPLATE_LEAK_RE.test(claim.inner)) {
    return { verdict: 'refuted', confidence: 1, note: 'Unfilled prompt placeholder in the text' };
  }

  if (claim.type === 'stat') {
    if (!f.figure) return { verdict: 'not_a_claim', note: 'No statistical figure present' };
    if (f.year && f.year > year) {
      return { verdict: 'refuted', confidence: 1, note: `Dated ${f.year}, in the future` };
    }
    // Over 100% is impossible for a share, but fine for growth or a multiple.
    if (f.percentValue !== null && f.percentValue > 100
        && !/increase|growth|grew|rose|rise|higher|more than|roi|return|faster/i.test(claim.inner)) {
      return { verdict: 'refuted', confidence: 1, note: `${f.percentValue}% of a population is impossible` };
    }
    return null;
  }

  if (claim.type === 'quote') {
    if (!f.quote) return { verdict: 'not_a_claim', note: 'No quoted text present' };
    // A quote nobody can be held to is unusable whether or not the words were
    // said. Speaker and organisation are the minimum; a formal credential is
    // NOT required — "Professor of Ergonomics" matches no medical pattern and
    // is a perfectly good attribution.
    if (!f.person || !f.org) {
      const missing = [!f.person && 'named speaker', !f.org && 'organisation'].filter(Boolean).join(' or ');
      return { verdict: 'refuted', confidence: 1, note: `Unattributable — no ${missing}` };
    }
    if (/\b(anonymous|an expert|one expert|industry expert|a leading|some experts)\b/i.test(f.person || '')) {
      return { verdict: 'refuted', confidence: 1, note: 'Anonymous attribution' };
    }
    if (f.year && f.year > year) {
      return { verdict: 'refuted', confidence: 1, note: `Dated ${f.year}, in the future` };
    }
    return null;
  }

  // cite
  if (!f.url) {
    if (!f.source) return { verdict: 'not_a_claim', note: 'No source or URL cited' };
    return null;
  }
  if (/example\.(com|org|net)|yoursite|yourdomain|lorem|\/path\/to\//i.test(f.url)) {
    return { verdict: 'refuted', confidence: 1, note: 'Placeholder URL' };
  }
  try {
    const u = new URL(f.url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { verdict: 'refuted', confidence: 1, note: `Unusable protocol ${u.protocol}` };
    }
  } catch {
    return { verdict: 'refuted', confidence: 1, note: 'Malformed URL' };
  }
  return null;
}

// ── Lookup ────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has',
  'are', 'was', 'were', 'their', 'they', 'than', 'then', 'into', 'over', 'about', 'more', 'most',
  'some', 'such', 'when', 'what', 'which', 'while', 'your', 'you']);

function subjectTerms(text, n) {
  return String(text || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\w\s%]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w.toLowerCase()))
    .slice(0, n)
    .join(' ');
}

function buildQuery(claim) {
  const f = claim.fields;
  if (claim.type === 'stat') {
    // Quoting the figure makes it a phrase match: a real statistic surfaces its
    // source, a fabricated one surfaces nothing.
    return [`"${f.figure}"`, subjectTerms(claim.inner, 6), f.source, f.year]
      .filter(Boolean).join(' ').trim();
  }
  if (claim.type === 'quote') {
    // An exact span is by far the best fabrication detector for a quote.
    const span = f.quote.split(/\s+/).slice(0, 10).join(' ');
    return [`"${span}"`, f.person, f.org].filter(Boolean).join(' ').trim();
  }
  if (f.url) {
    try { return `site:${new URL(f.url).host} ${subjectTerms(claim.inner, 5)}`.trim(); }
    catch { /* fall through */ }
  }
  return [f.source && `"${f.source}"`, subjectTerms(claim.inner, 6)].filter(Boolean).join(' ').trim();
}

function isAuthoritative(url) {
  const u = String(url || '').toLowerCase();
  return AUTHORITATIVE_DOMAINS.some(d => u.includes(d));
}

function hostOf(url) {
  try { return new URL(url).host.replace(/^www\./, '').toLowerCase(); } catch { return null; }
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  return results;
}

const ADJUDICATOR_SYSTEM =
  'You are a fact-checking adjudicator. You judge ONLY from the search results provided. ' +
  'You never use prior knowledge to confirm a claim, and you never fabricate a source. ' +
  'When the evidence does not settle the question, you say so. Respond with valid JSON only.';

function adjudicationPrompt(claim, evidence) {
  const kind = claim.type === 'stat' ? 'statistic' : claim.type === 'quote' ? 'expert quote' : 'citation';
  const attribution = claim.type === 'stat' && claim.fields.source
    ? `It attributes the figure to: ${claim.fields.source}${claim.fields.year ? ` (${claim.fields.year})` : ''}\n`
    : claim.type === 'quote'
      ? `It attributes the words to: ${claim.fields.person}${claim.fields.org ? `, ${claim.fields.org}` : ''}\n`
      : '';

  return `A content tool inserted this ${kind} into an article. Judge it against the evidence below.

CLAIM:
${claim.inner}

${attribution}
EVIDENCE:
${evidence.map((e, i) => `[${i + 1}] ${e.title || ''} — ${e.url || ''}\n${(e.snippet || '').slice(0, 600)}`).join('\n\n')}

VERDICTS:
"verified"     — a result directly states this figure/quote/source, for the same subject. A close
                 paraphrase of the same number and the same population counts.
"refuted"      — a result directly CONTRADICTS it: a different number for the SAME measure, SAME
                 population and SAME period from a comparable authority; an explicit correction; an
                 explicit statement the person never said it; or the named source demonstrably does
                 not exist.
"unsupported"  — the results are on topic yet nowhere state this specific claim, AND the claim names
                 a specific source that should have surfaced. Leaving no trace is the signature of a
                 fabrication.
"inconclusive" — anything else. Off-topic results; a different figure for a DIFFERENT population,
                 year or measure; the person exists but this quote is not reproduced.

RULES:
- "refuted" requires positive contradicting evidence IN THE RESULTS ABOVE. Never infer it from
  silence, from an empty result set, or from your own knowledge.
- A different number for a different population, year or measure is NOT a contradiction.
- If you are less than confident, return "inconclusive".
- Quote your evidence verbatim in evidenceSnippet (<=240 chars) and give the URL it came from.
  The URL must be one of the URLs listed above.

Return JSON: {"verdict":"verified|refuted|unsupported|inconclusive","confidence":0.0,"evidenceSnippet":"","evidenceUrl":"","note":"<one short sentence>"}`;
}

async function adjudicate(claim, evidence, deps) {
  const { llm, minRemovalConfidence, perLookupTimeoutMs } = deps;
  if (!llm) return { verdict: 'inconclusive', note: NOTE.unverified, debug: 'no adjudicator configured' };

  let parsed;
  try {
    const res = await withTimeout(llm.chat.completions.create({
      model: llm.model,
      max_completion_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: ADJUDICATOR_SYSTEM },
        { role: 'user', content: adjudicationPrompt(claim, evidence) },
      ],
    }), perLookupTimeoutMs);
    parsed = JSON.parse(res.choices[0].message.content || '{}');
  } catch (err) {
    return { verdict: 'inconclusive', note: NOTE.unverified, debug: `adjudication failed: ${err.message}` };
  }

  const verdict = ['verified', 'refuted', 'unsupported', 'inconclusive'].includes(parsed.verdict)
    ? parsed.verdict : 'inconclusive';
  const confidence = Number.isFinite(parsed.confidence) ? Number(parsed.confidence) : 0;
  const note = String(parsed.note || '').slice(0, 200);
  const snippet = String(parsed.evidenceSnippet || '');
  const url = typeof parsed.evidenceUrl === 'string' ? parsed.evidenceUrl : '';

  if (!REMOVING_VERDICTS.has(verdict)) {
    return { verdict, confidence, supportingUrl: /^https?:\/\//.test(url) ? url : null, note };
  }

  // Invariant 3 — a removal must be anchored in evidence we actually retrieved.
  // Everything below downgrades to inconclusive, which keeps the claim.
  const offered = new Set(evidence.map(e => hostOf(e.url)).filter(Boolean));
  const cited = hostOf(url);
  // `note` is shown to the user, `debug` never leaves the server. Why the check
  // fell short is our problem, not theirs; all they need is that it was not
  // confirmed and the claim was kept.
  const downgrade = (why) => ({
    verdict: 'inconclusive',
    confidence,
    supportingUrl: null,
    note: NOTE.unverified,
    debug: `${why}${note ? ` — ${note}` : ''}`,
  });

  if (confidence < minRemovalConfidence) return downgrade(`low confidence (${confidence.toFixed(2)})`);
  if (snippet.trim().length < 20) return downgrade('no evidence quoted');
  if (!cited || !offered.has(cited)) return downgrade('cited evidence was not among the retrieved results');

  return { verdict, confidence, supportingUrl: url, note, evidenceSnippet: snippet.slice(0, 240) };
}

// Gather evidence. Citations read the cited page directly, which costs no search
// quota and answers the question better than a snippet would.
async function gatherEvidence(claim, deps, state) {
  const { search, fetchPage, headRequest, perLookupTimeoutMs, consecutiveFailureLimit } = deps;

  if (claim.type === 'cite' && claim.fields.url) {
    // Liveness first. A 404 is a real defect; a 403 or a timeout is the site
    // refusing a bot, which says nothing about the claim.
    if (headRequest) {
      let probe;
      try { probe = await withTimeout(headRequest(claim.fields.url, 6000), perLookupTimeoutMs); }
      catch { probe = { status: 'timeout' }; }
      if (probe.status === 404 || probe.status === 410) {
        return { status: 'dead-url', code: probe.status };
      }
      if (probe.status === 'timeout' || (typeof probe.status === 'number' && probe.status >= 400)) {
        return { status: 'unreachable', code: probe.status };
      }
    }
    if (!fetchPage) return { status: 'unavailable' };
    let page = null;
    try { page = await withTimeout(fetchPage(claim.fields.url), perLookupTimeoutMs); }
    catch { page = null; }
    if (!page || !page.bodyText) return { status: 'unreachable', code: 'no-content' };
    return {
      status: 'ok',
      evidence: [{ title: page.title || claim.fields.url, url: claim.fields.url, snippet: page.bodyText.slice(0, 4000) }],
    };
  }

  if (!search) return { status: 'unavailable' };
  if (state.searchDisabled) return { status: 'error', message: 'search circuit open' };
  if (state.lookupsUsed >= deps.maxLookups) return { status: 'capped' };

  state.lookupsUsed++;
  let data;
  try {
    data = await withTimeout(search(buildQuery(claim)), perLookupTimeoutMs);
    state.consecutiveFailures = 0;
  } catch (err) {
    state.consecutiveFailures++;
    // A dead search key would otherwise cost every remaining claim a full
    // timeout on the critical path.
    if (state.consecutiveFailures >= consecutiveFailureLimit) state.searchDisabled = true;
    return { status: 'error', message: err.message };
  }
  const results = (data && data.results) || [];
  if (!results.length) return { status: 'empty' };
  return {
    status: 'ok',
    evidence: results.slice(0, 5).map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
  };
}

// ── Orchestration ─────────────────────────────────────────────────────────────

async function verifyClaims(claims, options = {}) {
  const deps = { ...DEFAULTS, headRequest: defaultHeadRequest, ...options };
  const now = options.now || new Date();
  const state = { lookupsUsed: 0, consecutiveFailures: 0, searchDisabled: false, cacheHits: 0 };

  // One verdict per distinct assertion; repeats inherit it.
  const unique = new Map();
  for (const claim of claims) {
    const key = claimKey(claim);
    if (!unique.has(key)) unique.set(key, claim);
  }

  const settled = new Map();

  await mapWithConcurrency([...unique.entries()], deps.concurrency, async ([key, claim]) => {
    const screened = screenClaim(claim, now);
    if (screened) { settled.set(key, { ...screened, checkedBy: 'screen' }); return; }

    const ck = deps.cache && deps.cache.key ? deps.cache.key('factcheck', 'v1', claim.type, key) : null;
    if (ck && deps.cache.get) {
      try {
        const hit = await deps.cache.get(ck, deps.cacheTtlMs);
        if (hit && hit.verdict) { state.cacheHits++; settled.set(key, { ...hit, checkedBy: 'cache' }); return; }
      } catch { /* a cache miss must never fail the check */ }
    }

    const got = await gatherEvidence(claim, deps, state);
    let outcome;
    switch (got.status) {
      case 'ok':
        outcome = await adjudicate(claim, got.evidence, deps);
        break;
      case 'dead-url':
        outcome = { verdict: 'refuted', confidence: 1, note: 'The cited page no longer exists', debug: `cited URL returned ${got.code}` };
        break;
      case 'unreachable':
        outcome = { verdict: 'inconclusive', note: NOTE.sourceUnreadable, debug: `cited URL unreadable (${got.code})` };
        break;
      case 'capped':
        outcome = { verdict: 'capped', note: NOTE.notChecked, debug: `lookup budget of ${deps.maxLookups} reached` };
        break;
      case 'empty':
        // The search worked and returned nothing at all. That is a failure to
        // retrieve, not a finding about the claim.
        outcome = { verdict: 'inconclusive', note: NOTE.unverified, debug: 'search returned no results' };
        break;
      case 'error':
        outcome = { verdict: 'inconclusive', note: NOTE.unverified, debug: `lookup failed: ${got.message}` };
        break;
      default:
        outcome = { verdict: 'inconclusive', note: NOTE.unverified, debug: 'no lookup available' };
    }
    outcome.checkedBy = got.status === 'ok' ? 'lookup' : 'lookup-failed';

    // Only settled verdicts are cached. Caching a failure would pin it for the
    // whole TTL and make a transient outage look like a permanent finding.
    if (ck && deps.cache && deps.cache.set && ['verified', 'refuted', 'unsupported'].includes(outcome.verdict)) {
      try { await deps.cache.set(ck, outcome, { kind: 'serp', ttlMs: deps.cacheTtlMs }); }
      catch { /* best effort */ }
    }
    settled.set(key, outcome);
  });

  const report = claims.map(claim => {
    const o = settled.get(claimKey(claim)) || { verdict: 'inconclusive', note: NOTE.notChecked };
    const failed = REMOVING_VERDICTS.has(o.verdict);
    return {
      ...claim,
      verdict: o.verdict,
      confidence: o.confidence ?? null,
      supportingUrl: o.supportingUrl || null,
      evidenceSnippet: o.evidenceSnippet || '',
      authoritative: o.supportingUrl ? isAuthoritative(o.supportingUrl) : false,
      note: o.note || '',
      debug: o.debug || '',   // server-side only; never rendered
      checkedBy: o.checkedBy || 'none',
      // Failed, but cutting it would damage the prose or orphan a heading.
      flagged: failed && !claim.removable,
      removed: failed && claim.removable,
    };
  });

  return { report, state };
}

// ── Removal ───────────────────────────────────────────────────────────────────

function repairInline(line) {
  return line
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/([.!?])\1+/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/^([ \t]*)[,;:]\s*/, '$1')
    .replace(/[ \t]+$/g, '');
}

function isRowLine(s) {
  const t = String(s || '').trim().replace(newBlockRe(), '$2').trim();
  return t.startsWith('|') && t.endsWith('|');
}
function isSepLine(s) {
  const t = String(s || '').trim().replace(newBlockRe(), '$2').trim();
  return /\|/.test(t) && /^\|?[\s\-|:]+\|?$/.test(t);
}

// A header and separator with nothing under them renders as a broken stub, so
// the remains of a gutted table go too. Those lines are original text, so they
// are reported back and excluded from the structure guard rather than tripping
// it — this is the one place removal is allowed to touch unmarked words.
function dropEmptyTables(lines) {
  const out = [];
  const dropped = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isRowLine(lines[i])) { out.push(lines[i]); continue; }
    const block = [];
    while (i < lines.length && isRowLine(lines[i])) { block.push(lines[i]); i++; }
    i--;
    if (block.filter(l => !isSepLine(l)).length >= 2) out.push(...block);
    else dropped.push(...block);
  }
  return { lines: out, dropped };
}

// Renumber a contiguous ordered run only when removal actually broke its
// sequence — a deliberately odd original list is left alone.
function renumberOrderedLists(lines) {
  const num = (s) => { const m = String(s || '').match(/^(\s*)(\d+)([.)])(\s.*)$/); return m ? { indent: m[1], n: Number(m[2]), sep: m[3], rest: m[4] } : null; };
  const out = lines.slice();
  let i = 0;
  while (i < out.length) {
    if (!num(out[i])) { i++; continue; }
    const start = i;
    const run = [];
    while (i < out.length && num(out[i])) { run.push(num(out[i])); i++; }
    const sequential = run.every((r, k) => r.n === run[0].n + k);
    if (!sequential) {
      run.forEach((r, k) => { out[start + k] = `${r.indent}${run[0].n + k}${r.sep}${r.rest}`; });
    }
  }
  return out;
}

// The words that were NOT inserted. Removal must leave these untouched;
// punctuation and whitespace repair is allowed, losing a word is not.
//
// Leading ordered-list markers are excluded: renumbering a list after an item
// is removed rewrites those digits by design, and counting them as prose would
// make every such removal look like damage.
function untouchedWords(text) {
  return String(text || '')
    .replace(newBlockRe(), ' ')
    .split('\n')
    .map(l => l.replace(/^\s*\d+[.)]\s+/, ' '))
    .join('\n')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// Invariant 2, checked after the fact. The surviving original words must be a
// subsequence of the original ones — nothing added, nothing reordered — and the
// only permitted losses are the words in `allowedLoss` (a gutted table's header
// and separator). Requiring the counts to match exactly means an accidental
// deletion anywhere else still fails, even if it happens to remove words that
// appear elsewhere in the article.
function verifyStructure(before, after, allowedLoss = []) {
  const a = untouchedWords(before);
  const b = untouchedWords(after);
  const allowed = allowedLoss.reduce((n, l) => n + untouchedWords(l).length, 0);
  if (a.length - b.length !== allowed) return false;
  let i = 0;
  for (const word of b) {
    while (i < a.length && a[i] !== word) i++;
    if (i >= a.length) return false;
    i++;
  }
  return true;
}

// Remove the claims marked for removal, and only those. Returns the original
// text unchanged if anything looks wrong.
function removeClaims(text, report, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const src = String(text || '');
  const toRemove = report.filter(r => r.removed);
  if (!toRemove.length) return { text: src, removed: [], aborted: null };

  // Invariant 4 — a mass removal is far more likely a broken adjudicator than
  // an article that is half lies.
  //
  // Only ADJUDICATED removals count toward the limit. A deterministic screen
  // failure — a date in the future, a percentage over 100, an anonymous quote,
  // an unfilled prompt placeholder — is a certainty with no model judgement in
  // it, and holding those back because there are several of them would keep
  // content we know for a fact is wrong.
  const judged = toRemove.filter(r => r.checkedBy === 'lookup' || r.checkedBy === 'cache');
  const verifiableJudged = report.filter(r =>
    r.verdict !== 'not_a_claim' && (r.checkedBy === 'lookup' || r.checkedBy === 'cache')).length || 1;
  const fractionApplies = verifiableJudged >= opts.minClaimsForFraction;
  if (judged.length > opts.maxRemovals
      || (fractionApplies && judged.length / verifiableJudged > opts.maxRemovalFraction)) {
    return { text: src, removed: [], aborted: 'too-many' };
  }

  // Cheap guard: if the text changed between extraction and removal, the
  // ordinals no longer address the blocks we judged.
  const blockCount = [...src.matchAll(newBlockRe())].length;
  const maxOrdinal = report.reduce((a, r) => Math.max(a, r.ordinal), -1);
  if (maxOrdinal >= blockCount) return { text: src, removed: [], aborted: 'ordinal-mismatch' };

  const drop = new Map(toRemove.map(r => [r.ordinal, r.shape]));
  let ordinal = -1;
  let out = src.replace(newBlockRe(), (raw) => {
    ordinal++;
    if (!drop.has(ordinal)) return raw;
    const shape = drop.get(ordinal);
    return (shape === 'inline') ? '' : DROP_LINE;
  });

  let lines = out.split('\n');
  lines = lines.filter(l => !l.includes(DROP_LINE));
  lines = lines.map(l => (l.trim() === '' ? '' : repairInline(l)));
  const tables = dropEmptyTables(lines);
  lines = renumberOrderedLists(tables.lines);
  out = lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s+$/, '');

  if (!verifyStructure(src, out, tables.dropped)) {
    // Something in the repair chewed into the author's own words. Give the
    // whole removal back rather than ship damaged prose.
    return { text: src, removed: [], aborted: 'structure-damaged' };
  }
  return { text: out, removed: toRemove.map(r => r.id), aborted: null };
}

// ── Reporting ─────────────────────────────────────────────────────────────────

const VERDICT_LABEL = {
  verified: 'Verified',
  refuted: 'Refuted',
  unsupported: 'No supporting source found',
  inconclusive: 'Could not verify',
  capped: 'Not checked — budget reached',
  not_a_claim: 'Not a factual claim',
};
const TYPE_LABEL = { stat: 'Statistic', quote: 'Expert quote', cite: 'Citation' };

function summarize(report, extra = {}) {
  return {
    checked: report.length,
    verified: report.filter(r => r.verdict === 'verified').length,
    removed: report.filter(r => r.removed).length,
    flagged: report.filter(r => r.flagged).length,
    unverifiable: report.filter(r => r.verdict === 'inconclusive' || r.verdict === 'capped').length,
    lookups: extra.lookupsUsed || 0,
    ...extra,
  };
}

function buildFactCheckMarkdown(report, summary = {}) {
  if (!report.length) {
    return `## Fact Check

No statistics, expert quotes or citations were inserted, so there was nothing to verify.`;
  }
  const cell = (v) => String(v || '').replace(/\|/g, '/').replace(/\s*\n+\s*/g, ' ').trim();
  const clip = (v, n) => { const t = cell(v); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  const s = summary;

  const section = (title, rows, headers) => rows.length
    ? `\n### ${title} (${rows.length})\n\n| ${headers.join(' | ')} |\n|${headers.map(() => '---').join('|')}|\n${rows.join('\n')}\n`
    : '';

  const removed = report.filter(r => r.removed).map(r =>
    `| ${TYPE_LABEL[r.type]} | ${clip(r.inner, 110)} | ${clip(r.note, 70)} | ${r.supportingUrl ? clip(r.supportingUrl, 50) : '—'} |`);
  const flagged = report.filter(r => r.flagged).map(r =>
    `| ${TYPE_LABEL[r.type]} | ${clip(r.inner, 110)} | ${clip(r.note, 60)} | ${
      r.abortedRemoval ? 'Removal skipped — see the note above'
      : r.shape === 'heading' ? 'Inside a heading — removing it would orphan the section'
      : 'Woven mid-sentence — cutting it would break the prose'} |`);
  const unverified = report.filter(r => !r.removed && !r.flagged && (r.verdict === 'inconclusive' || r.verdict === 'capped')).map(r =>
    `| ${TYPE_LABEL[r.type]} | ${clip(r.inner, 110)} | ${clip(r.note, 70)} |`);
  const verified = report.filter(r => r.verdict === 'verified').map(r =>
    `| ${TYPE_LABEL[r.type]} | ${clip(r.inner, 110)} | ${r.supportingUrl ? `${r.authoritative ? 'Authoritative — ' : ''}${clip(r.supportingUrl, 55)}` : '—'} |`);

  const abortNote = s.aborted === 'too-many'
    ? '\n**Nothing was removed.** More than half the inserted evidence failed verification, which points at a problem with the check rather than the article. Every finding is listed below for you to judge.\n'
    : s.aborted === 'structure-damaged'
      ? '\n**Nothing was removed.** Removing the failed claims would have altered your original text, so the article was left exactly as written. The findings are listed below.\n'
      : s.aborted === 'ordinal-mismatch'
        ? '\n**Nothing was removed.** The article changed while it was being checked, so removal was skipped as a precaution.\n'
        : '';

  return `## Fact Check

${s.checked} inserted claim${s.checked === 1 ? '' : 's'} checked · ${s.verified} verified · ${s.removed} removed · ${s.unverifiable} could not be verified.

A claim is removed only when the evidence actively contradicts it or a specifically-sourced figure leaves no trace anywhere. Anything that simply could not be checked — search unavailable, budget reached, source blocked our request — was **kept**, and is listed below for you to review.
${abortNote}${section('Removed from the article', removed, ['Type', 'Claim', 'Why removed', 'Evidence'])}${section('Failed but not removed — manual edit needed', flagged, ['Type', 'Claim', 'Why it failed', 'Why it stayed'])}${section('Kept but unverified — review before publishing', unverified, ['Type', 'Claim', 'Status'])}${section('Verified', verified, ['Type', 'Claim', 'Source'])}`;
}

// ── Entry point ───────────────────────────────────────────────────────────────

// Verify every evidence claim in `text`, strip the ones that actively failed,
// and return the cleaned text with the report. Never throws: on an unexpected
// error the original text comes back untouched, because a broken verifier must
// not cost the user their article.
async function runFactCheck(text, options = {}) {
  const original = String(text || '');
  try {
    const claims = extractClaims(original);
    if (!claims.length) {
      return { text: original, report: [], summary: summarize([]), markdown: '', skipped: true };
    }
    const { report, state } = await verifyClaims(claims, options);
    const { text: cleaned, aborted } = removeClaims(original, report, options);
    if (aborted) report.forEach(r => { if (r.removed) { r.removed = false; r.flagged = true; r.abortedRemoval = true; } });

    const summary = summarize(report, {
      lookupsUsed: state.lookupsUsed,
      cacheHits: state.cacheHits,
      searchDisabled: state.searchDisabled,
      aborted,
    });
    return { text: cleaned, report, summary, markdown: buildFactCheckMarkdown(report, summary), skipped: false };
  } catch (err) {
    return {
      text: original,
      report: [],
      summary: summarize([], { error: err.message }),
      markdown: '',
      skipped: true,
      error: err.message,
    };
  }
}

module.exports = {
  runFactCheck,
  extractClaims,
  screenClaim,
  verifyClaims,
  removeClaims,
  buildFactCheckMarkdown,
  summarize,
  verifyStructure,
  buildQuery,
  EVIDENCE_TYPES,
  REMOVING_VERDICTS,
  DEFAULTS,
};
