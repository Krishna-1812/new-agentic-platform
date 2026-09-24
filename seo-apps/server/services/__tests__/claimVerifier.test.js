'use strict';

// Zero-dependency test runner. No test framework is configured in this app, so
// this follows the same hand-rolled pattern as checks/__tests__/seoGeo.test.js
// and locationPageBuilder/__tests__/run.js.
//
// Run: node services/__tests__/claimVerifier.test.js
//
// Every external call is a stub, so the suite spends no API quota.

const assert = require('assert');
const cv = require('../claimVerifier');

let passed = 0, failed = 0;
function group(name) { console.log(`\n${name}`); }
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') throw new Error('use atest() for async');
    console.log(`  ok    ${name}`); passed++;
  } catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); failed++; }
}
const pending = [];
function atest(name, fn) { pending.push([name, fn]); }

// ── Stub factory ──────────────────────────────────────────────────────────────
function stubs(overrides = {}) {
  const calls = { search: [], llm: [], head: [], cacheGet: [], cacheSet: [] };
  const base = {
    search: async (q) => {
      calls.search.push(q);
      return { results: [{ title: 'Source', url: 'https://cdc.gov/report', snippet: 'A supporting sentence about the figure.' }] };
    },
    llm: {
      model: 'stub',
      chat: { completions: { create: async (req) => {
        calls.llm.push(req);
        return { choices: [{ message: { content: JSON.stringify({
          verdict: 'verified', confidence: 0.95, evidenceSnippet: 'A supporting sentence about the figure.',
          evidenceUrl: 'https://cdc.gov/report', note: 'Matches the cited source.',
        }) } }] };
      } } },
    },
    headRequest: async (u) => { calls.head.push(u); return { status: 200, final: u }; },
    fetchPage: async (u) => ({ title: 'Page', bodyText: 'Body text that supports the claim.', url: u }),
    cache: null,
    now: new Date('2026-09-19T00:00:00Z'),
  };
  return { deps: { ...base, ...overrides }, calls };
}

const adjudicatorReturning = (payload, calls) => ({
  model: 'stub',
  chat: { completions: { create: async (req) => {
    if (calls) calls.llm.push(req);
    return { choices: [{ message: { content: JSON.stringify(payload) } }] };
  } } },
});

// ── Extraction and shape ──────────────────────────────────────────────────────
group('extraction');

test('only evidence-group blocks become claims', () => {
  const text = [
    '[NEW:stat]45% of teams ship weekly (Forrester, 2024).[/NEW]',
    '[NEW:list]- a bullet[/NEW]',
    '[NEW:quote]As Jane Smith, MD at Mayo Clinic (2022): "a sufficiently long quoted sentence".[/NEW]',
    '[NEW:section]## A new section[/NEW]',
    '[NEW:cite]See [the study](https://nih.gov/s).[/NEW]',
  ].join('\n');
  const c = cv.extractClaims(text);
  assert.deepStrictEqual(c.map(x => x.type), ['stat', 'quote', 'cite']);
  // Ordinals must count ALL blocks, or removal addresses the wrong one.
  assert.deepStrictEqual(c.map(x => x.ordinal), [0, 2, 4]);
});

test('shape is classified per placement', () => {
  const text = [
    '[NEW:stat]Whole line 45% (A, 2024).[/NEW]',
    'Prose here. [NEW:stat]Inline 12% (B, 2024).[/NEW]',
    '| h |',
    '[NEW:stat]| 33% | x |[/NEW]',
    '[NEW:stat]## Heading with 50% (C, 2024)[/NEW]',
    '[NEW:stat]- 7% listed (D, 2024)[/NEW]',
  ].join('\n');
  assert.deepStrictEqual(cv.extractClaims(text).map(c => c.shape),
    ['line', 'inline', 'tablerow', 'heading', 'listitem']);
});

test('a heading claim is never removable', () => {
  const c = cv.extractClaims('[NEW:stat]## Growth hit 50% (C, 2024)[/NEW]')[0];
  assert.strictEqual(c.removable, false);
});

test('an inline span mid-sentence is not removable', () => {
  const woven = cv.extractClaims('The market, [NEW:stat]up 12% (A, 2024),[/NEW] keeps growing.')[0];
  assert.strictEqual(woven.removable, false, 'mid-sentence insertion must not be cut');
  const standalone = cv.extractClaims('The market grew. [NEW:stat]It rose 12% (A, 2024).[/NEW]')[0];
  assert.strictEqual(standalone.removable, true, 'sentence-boundary insertion is safe to cut');
});

// ── Deterministic screen ──────────────────────────────────────────────────────
group('deterministic screen');

const now = new Date('2026-09-19T00:00:00Z');
const screen = (text) => cv.screenClaim(cv.extractClaims(text)[0], now);

test('future-dated statistic is refuted with no lookup', () => {
  assert.strictEqual(screen('[NEW:stat]30% of firms will adopt it (Gartner, 2031).[/NEW]').verdict, 'refuted');
});

test('impossible percentage is refuted', () => {
  assert.strictEqual(screen('[NEW:stat]140% of patients recovered (X, 2024).[/NEW]').verdict, 'refuted');
});

test('over-100% growth is allowed through', () => {
  assert.strictEqual(screen('[NEW:stat]Revenue saw a 140% increase (X, 2024).[/NEW]'), null);
});

test('unfilled prompt placeholder is refuted', () => {
  assert.strictEqual(screen('[NEW:stat][X]% of [population] [action] (Source, Year).[/NEW]').verdict, 'refuted');
});

test('quote without a named speaker is refuted', () => {
  assert.strictEqual(screen('[NEW:quote]As one expert put it: "a quoted sentence of sufficient length".[/NEW]').verdict, 'refuted');
});

test('quote with a non-medical credential is allowed through', () => {
  // "Professor of Ergonomics" matches no credential pattern and must not be
  // treated as unattributed.
  assert.strictEqual(screen('[NEW:quote]As Alan Hedge, Professor of Ergonomics at Cornell University (2022): "alternating posture beats standing all day".[/NEW]'), null);
});

test('malformed and placeholder URLs are refuted', () => {
  assert.strictEqual(screen('[NEW:cite]See [x](https://example.com/a).[/NEW]').verdict, 'refuted');
  assert.strictEqual(screen('[NEW:cite]See htp:/broken per [x](http://%%%).[/NEW]').verdict, 'refuted');
});

test('a price or phone number is not a statistical claim', () => {
  assert.strictEqual(screen('[NEW:stat]Call (555) 123-4567 to book.[/NEW]').verdict, 'not_a_claim');
  assert.strictEqual(screen('[NEW:stat]Plans start at $1,200 per year.[/NEW]').verdict, 'not_a_claim');
  assert.strictEqual(screen('[NEW:stat]Serving the area since 2015.[/NEW]').verdict, 'not_a_claim');
});

// ── Removal mechanics ─────────────────────────────────────────────────────────
group('removal');

const forceRemove = (text) => {
  const claims = cv.extractClaims(text);
  return claims.map(c => ({ ...c, verdict: 'refuted', removed: c.removable, flagged: !c.removable }));
};

test('a whole-line claim is removed without leaving a blank gap', () => {
  const text = 'Intro paragraph.\n\n[NEW:stat]Bogus 99% (X, 2024).[/NEW]\n\nNext paragraph.';
  const { text: out } = cv.removeClaims(text, forceRemove(text));
  assert.strictEqual(out, 'Intro paragraph.\n\nNext paragraph.');
});

test('an inline claim is removed and the line is repaired', () => {
  const text = 'The market grew. [NEW:stat]It rose 12% (A, 2024).[/NEW] Demand followed.';
  const { text: out } = cv.removeClaims(text, forceRemove(text));
  assert.strictEqual(out, 'The market grew. Demand followed.');
  assert.ok(!/ {2}/.test(out), 'no doubled spaces');
});

test('a table row is removed and the table survives', () => {
  const text = ['| Plan | Price |', '| --- | --- |', '[NEW:stat]| Bogus | 99% |[/NEW]', '| Real | $50 |'].join('\n');
  const { text: out } = cv.removeClaims(text, forceRemove(text));
  assert.ok(out.includes('| Plan | Price |') && out.includes('| Real | $50 |'));
  assert.ok(!out.includes('Bogus'));
});

test('a table left with no data rows is dropped whole', () => {
  const text = ['Before.', '', '| Plan | Price |', '| --- | --- |', '[NEW:stat]| Bogus | 99% |[/NEW]', '', 'After.'].join('\n');
  const { text: out } = cv.removeClaims(text, forceRemove(text));
  assert.ok(!out.includes('| Plan | Price |'), 'header-only stub must not survive');
  assert.ok(out.includes('Before.') && out.includes('After.'));
});

test('an ordered list is renumbered after an item is removed', () => {
  const text = ['1. First step', '[NEW:stat]2. Bogus 99% step (X, 2024)[/NEW]', '3. Third step'].join('\n');
  const { text: out } = cv.removeClaims(text, forceRemove(text));
  assert.strictEqual(out, '1. First step\n2. Third step');
});

test('a heading claim is flagged, never removed', () => {
  const text = '[NEW:stat]## Growth hit 999% (X, 2024)[/NEW]\n\nBody text.';
  const report = forceRemove(text);
  assert.strictEqual(report[0].removed, false);
  assert.strictEqual(report[0].flagged, true);
  const { text: out } = cv.removeClaims(text, report);
  assert.strictEqual(out, text, 'heading must survive untouched');
});

test('INVARIANT: no original word is altered by removal', () => {
  const text = [
    '# Original Heading',
    'An original sentence that must survive verbatim.',
    '[NEW:stat]Bogus 99% (X, 2024).[/NEW]',
    'Another original sentence, with commas, and punctuation.',
    'Prose here. [NEW:quote]As A B, MD at C (2020): "a sufficiently long quoted sentence here".[/NEW] Trailing original words.',
  ].join('\n');
  const { text: out } = cv.removeClaims(text, forceRemove(text));
  assert.ok(cv.verifyStructure(text, out), 'untouched words must be identical');
  assert.ok(out.includes('# Original Heading'));
  assert.ok(out.includes('Another original sentence, with commas, and punctuation.'));
  assert.ok(out.includes('Trailing original words.'));
});

test('KILL SWITCH: a mass ADJUDICATED removal is abandoned entirely', () => {
  const lines = [];
  for (let i = 0; i < 12; i++) lines.push(`[NEW:stat]Bogus ${i}0% figure (X, 2024).[/NEW]`);
  const text = lines.join('\n');
  // checkedBy 'lookup' means the model judged these, which is exactly what the
  // kill switch is defending against.
  const report = forceRemove(text).map(r => ({ ...r, checkedBy: 'lookup' }));
  const { text: out, aborted } = cv.removeClaims(text, report);
  assert.strictEqual(aborted, 'too-many');
  assert.strictEqual(out, text, 'nothing may be removed when the adjudicator looks broken');
});

test('KILL SWITCH does not hold back deterministic screen failures', () => {
  // A future date or a percentage over 100 is a certainty with no model
  // judgement in it. Holding those back because there are several of them
  // would keep content we know for a fact is wrong.
  const lines = [];
  for (let i = 0; i < 12; i++) lines.push(`[NEW:stat]Adoption hits ${i}0% (X, 2031).[/NEW]`);
  const text = lines.join('\n');
  const report = forceRemove(text).map(r => ({ ...r, checkedBy: 'screen' }));
  const { text: out, aborted } = cv.removeClaims(text, report);
  assert.strictEqual(aborted, null);
  assert.strictEqual(out.trim(), '', 'every screen-failed claim is removed');
});

test('a stale ordinal aborts removal rather than cutting the wrong block', () => {
  const text = '[NEW:stat]Only block 50% (X, 2024).[/NEW]';
  const report = forceRemove(text);
  report[0].ordinal = 7; // pretend the text changed underneath us
  const { text: out, aborted } = cv.removeClaims(text, report);
  assert.strictEqual(aborted, 'ordinal-mismatch');
  assert.strictEqual(out, text);
});

// ── Safeguard: infrastructure failure must never delete ───────────────────────
group('SAFEGUARD — failure never deletes');

const FIXTURE = 'Original prose.\n\n[NEW:stat]Some 45% figure (OSHA, 2023).[/NEW]\n\nMore original prose.';

async function runWith(overrides) {
  const { deps, calls } = stubs(overrides);
  const out = await cv.runFactCheck(FIXTURE, deps);
  return { out, calls };
}

atest('search throws -> claim kept, verdict inconclusive', async () => {
  const { out } = await runWith({ search: async () => { throw new Error('ENOTFOUND'); } });
  assert.strictEqual(out.text, FIXTURE, 'text must be byte-identical');
  assert.strictEqual(out.report[0].verdict, 'inconclusive');
  assert.strictEqual(out.report[0].removed, false);
});

atest('search returns zero results -> kept', async () => {
  const { out } = await runWith({ search: async () => ({ results: [] }) });
  assert.strictEqual(out.text, FIXTURE);
  assert.strictEqual(out.report[0].verdict, 'inconclusive');
});

atest('adjudicator throws -> kept', async () => {
  const { out } = await runWith({ llm: { model: 's', chat: { completions: { create: async () => { throw new Error('502'); } } } } });
  assert.strictEqual(out.text, FIXTURE);
  assert.strictEqual(out.report[0].verdict, 'inconclusive');
});

atest('adjudicator returns malformed JSON -> kept', async () => {
  const { out } = await runWith({ llm: { model: 's', chat: { completions: { create: async () => ({ choices: [{ message: { content: 'not json' } }] }) } } } });
  assert.strictEqual(out.text, FIXTURE);
  assert.strictEqual(out.report[0].verdict, 'inconclusive');
});

atest('CLAMP: refuted citing a URL we never retrieved -> downgraded, kept', async () => {
  const { out } = await runWith({
    llm: adjudicatorReturning({
      verdict: 'refuted', confidence: 0.99,
      evidenceSnippet: 'This is a long enough fabricated evidence snippet.',
      evidenceUrl: 'https://somewhere-we-never-searched.example/x', note: 'made up',
    }),
  });
  assert.strictEqual(out.text, FIXTURE, 'a hallucinated citation must not delete content');
  assert.strictEqual(out.report[0].verdict, 'inconclusive');
  // The reason is diagnostic, so it belongs in the server-side debug field; the
  // user just sees that it could not be confirmed.
  assert.ok(/not among the retrieved/i.test(out.report[0].debug));
  assert.ok(/could not be confirmed/i.test(out.report[0].note));
});

atest('CLAMP: refuted below the confidence floor -> downgraded, kept', async () => {
  const { out } = await runWith({
    llm: adjudicatorReturning({
      verdict: 'refuted', confidence: 0.4,
      evidenceSnippet: 'A long enough snippet of contradicting evidence text.',
      evidenceUrl: 'https://cdc.gov/report', note: 'contradicted',
    }),
  });
  assert.strictEqual(out.text, FIXTURE);
  assert.strictEqual(out.report[0].verdict, 'inconclusive');
});

atest('CLAMP: refuted with no quoted evidence -> downgraded, kept', async () => {
  const { out } = await runWith({
    llm: adjudicatorReturning({ verdict: 'refuted', confidence: 0.99, evidenceSnippet: '', evidenceUrl: 'https://cdc.gov/report', note: 'x' }),
  });
  assert.strictEqual(out.text, FIXTURE);
  assert.strictEqual(out.report[0].verdict, 'inconclusive');
});

atest('budget cap -> surplus claims kept as capped, and no extra searches', async () => {
  const many = Array.from({ length: 6 }, (_, i) => `[NEW:stat]Figure ${i + 1}${i}% of users did it (Src${i}, 2023).[/NEW]`).join('\n\n');
  const { deps, calls } = stubs({ maxLookups: 2 });
  const out = await cv.runFactCheck(many, deps);
  assert.strictEqual(calls.search.length, 2, 'must not exceed the lookup budget');
  const capped = out.report.filter(r => r.verdict === 'capped');
  assert.strictEqual(capped.length, 4);
  assert.ok(capped.every(r => !r.removed), 'a capped claim is never removed');
});

atest('circuit breaker stops calling a dead search backend', async () => {
  const many = Array.from({ length: 6 }, (_, i) => `[NEW:stat]Figure ${i + 1}${i}% of users did it (Src${i}, 2023).[/NEW]`).join('\n\n');
  let n = 0;
  const { deps } = stubs({ concurrency: 1, search: async () => { n++; throw new Error('down'); } });
  const out = await cv.runFactCheck(many, deps);
  assert.strictEqual(n, 2, 'opens the circuit after two consecutive failures');
  assert.ok(out.report.every(r => !r.removed));
});

atest('a 403 on a cited URL is inconclusive, not a dead link', async () => {
  const text = '[NEW:cite]Backed by [the report](https://www.sciencedirect.com/x).[/NEW]';
  const { deps } = stubs({ headRequest: async () => ({ status: 403 }) });
  const out = await cv.runFactCheck(text, deps);
  assert.strictEqual(out.report[0].verdict, 'inconclusive');
  assert.strictEqual(out.text, text, 'a bot-blocking source must not lose its citation');
});

atest('a 404 on a cited URL is refuted and removed', async () => {
  const text = 'Prose.\n\n[NEW:cite]Backed by [the report](https://nih.gov/missing).[/NEW]\n\nMore prose.';
  const { deps } = stubs({ headRequest: async () => ({ status: 404 }) });
  const out = await cv.runFactCheck(text, deps);
  assert.strictEqual(out.report[0].verdict, 'refuted');
  assert.strictEqual(out.report[0].removed, true);
  assert.ok(!out.text.includes('nih.gov/missing'));
});

// ── Happy paths and reporting ─────────────────────────────────────────────────
group('verification and reporting');

atest('a verified statistic is kept with its supporting source', async () => {
  const { out } = await runWith({});
  assert.strictEqual(out.report[0].verdict, 'verified');
  assert.strictEqual(out.text, FIXTURE);
  assert.strictEqual(out.report[0].supportingUrl, 'https://cdc.gov/report');
  assert.strictEqual(out.report[0].authoritative, true);
});

atest('an unsupported statistic is removed', async () => {
  const { out } = await runWith({
    llm: adjudicatorReturning({
      verdict: 'unsupported', confidence: 0.9,
      evidenceSnippet: 'On topic, but this figure appears nowhere in the result.',
      evidenceUrl: 'https://cdc.gov/report', note: 'No trace of the figure',
    }),
  });
  assert.strictEqual(out.report[0].removed, true);
  assert.ok(!out.text.includes('45%'));
  assert.ok(out.text.includes('Original prose.') && out.text.includes('More original prose.'));
});

atest('screened-out claims cost zero searches', async () => {
  const { deps, calls } = stubs();
  await cv.runFactCheck('[NEW:stat]Call (555) 123-4567 today.[/NEW]\n[NEW:stat]Plans from $1,200.[/NEW]', deps);
  assert.strictEqual(calls.search.length, 0);
  assert.strictEqual(calls.llm.length, 0);
});

atest('an identical claim is looked up once', async () => {
  const dup = '[NEW:stat]Some 45% figure (OSHA, 2023).[/NEW]\n\n[NEW:stat]Some 45% figure (OSHA, 2023).[/NEW]';
  const { deps, calls } = stubs();
  const out = await cv.runFactCheck(dup, deps);
  assert.strictEqual(calls.search.length, 1, 'repeats share one verdict');
  assert.strictEqual(out.report.length, 2);
  assert.strictEqual(out.report[0].verdict, out.report[1].verdict);
});

atest('a failed lookup is never cached', async () => {
  const sets = [];
  const cache = { key: (...p) => p.join(':'), get: async () => null, set: async (k, v) => { sets.push(v.verdict); } };
  const { deps } = stubs({ cache, search: async () => { throw new Error('down'); } });
  await cv.runFactCheck(FIXTURE, deps);
  assert.strictEqual(sets.length, 0, 'a transient outage must not be pinned for the TTL');
});

atest('no claims at all is a clean skip', async () => {
  const { deps, calls } = stubs();
  const out = await cv.runFactCheck('Just an article with no insertions.', deps);
  assert.strictEqual(out.skipped, true);
  assert.strictEqual(out.report.length, 0);
  assert.strictEqual(calls.search.length, 0);
});

atest('the report names removals, keeps and the reason', async () => {
  const { out } = await runWith({
    llm: adjudicatorReturning({
      verdict: 'unsupported', confidence: 0.9,
      evidenceSnippet: 'On topic, but this figure appears nowhere in the result.',
      evidenceUrl: 'https://cdc.gov/report', note: 'No trace of the figure',
    }),
  });
  const md = out.markdown;
  assert.ok(/## Fact Check/.test(md));
  assert.ok(/Removed from the article/.test(md));
  assert.ok(/No trace of the figure/.test(md), 'the reason must be shown');
  assert.ok(/was \*\*kept\*\*|kept/i.test(md), 'the keep-on-failure policy must be stated');
});

// ── No technical detail reaches the user ──────────────────────────────────────
group('error messages never reach the user');

// A distinctive string that must never survive into anything user-facing.
const SECRET = 'ECONNREFUSED 10.0.0.7:6379 at Object.internalConnect';
// Anything that reads as plumbing rather than as a finding about the content.
const LEAKY = [
  /ECONNREFUSED/i, /ENOTFOUND/i, /ETIMEDOUT/i, /\b5\d\d\b/, /\b40[0-9]\b/,
  /stack/i, /\bat Object\./, /undefined/i, /\[object /i,
  /exception/i, /traceback/i, /apikey|api[_ ]key|token/i,
];

function assertClean(markdown, label) {
  LEAKY.forEach(p => assert.ok(!p.test(markdown), `${label}: leaked ${p} into the report`));
  assert.ok(!markdown.includes(SECRET), `${label}: leaked the raw error text`);
}

atest('a thrown search error never appears in the report', async () => {
  const { deps } = stubs({ search: async () => { throw new Error(SECRET); } });
  const out = await cv.runFactCheck(FIXTURE, deps);
  assertClean(out.markdown, 'search throw');
  // The user still learns the claim was not confirmed, which is the part that
  // matters for safety.
  assert.ok(/could not be confirmed/i.test(out.markdown));
  // …and the cause is still available to the server log.
  assert.ok(/ECONNREFUSED/.test(out.report[0].debug), 'debug must keep the real cause');
});

atest('a thrown adjudicator error never appears in the report', async () => {
  const { deps } = stubs({ llm: { model: 's', chat: { completions: { create: async () => { throw new Error(SECRET); } } } } });
  const out = await cv.runFactCheck(FIXTURE, deps);
  assertClean(out.markdown, 'adjudicator throw');
  assert.ok(/ECONNREFUSED/.test(out.report[0].debug));
});

atest('an HTTP status on a blocked source never appears in the report', async () => {
  const text = '[NEW:cite]Backed by [the report](https://www.sciencedirect.com/x).[/NEW]';
  const { deps } = stubs({ headRequest: async () => ({ status: 403 }) });
  const out = await cv.runFactCheck(text, deps);
  assertClean(out.markdown, '403 source');
  assert.ok(/could not be read/i.test(out.markdown), 'the user is still told it was not checked');
  assert.ok(/403/.test(out.report[0].debug));
});

atest('the lookup budget is not exposed as a number in the report', async () => {
  const many = Array.from({ length: 4 }, (_, i) => `[NEW:stat]Figure ${i + 1}${i}% of users did it (Src${i}, 2023).[/NEW]`).join('\n\n');
  const { deps } = stubs({ maxLookups: 1 });
  const out = await cv.runFactCheck(many, deps);
  assertClean(out.markdown, 'budget');
  assert.ok(/not checked/i.test(out.markdown));
});

atest('a dead link is reported as a finding, not as a status code', async () => {
  const text = 'Prose.\n\n[NEW:cite]Backed by [the report](https://nih.gov/missing).[/NEW]\n\nMore prose.';
  const { deps } = stubs({ headRequest: async () => ({ status: 404 }) });
  const out = await cv.runFactCheck(text, deps);
  assertClean(out.markdown, 'dead link');
  assert.ok(/no longer exists/i.test(out.markdown), 'the reason for removal is still explained');
});

atest('a total collapse of the pass says nothing technical', async () => {
  // extractClaims itself blowing up is the worst case: the article is returned
  // untouched and the report is empty, so there is nothing to leak.
  const out = await cv.runFactCheck(FIXTURE, {
    search: async () => { throw new Error(SECRET); },
    llm: null,
    get now() { throw new Error(SECRET); },
  });
  assert.strictEqual(out.text, FIXTURE);
  assertClean(out.markdown || '', 'total collapse');
});

// ── Drift guard ───────────────────────────────────────────────────────────────
group('drift guard');

test('EVIDENCE_TYPES still matches the route taxonomy', () => {
  // claimVerifier deliberately does not require articleEnhancement (the require
  // cycle would yield undefined), so this test is what keeps the two in step.
  const { CHANGE_GROUPS } = require('../../routes/articleEnhancement').helpers;
  assert.ok(CHANGE_GROUPS.evidence, 'the evidence group must still exist');
  const expected = ['stat', 'quote', 'cite'];
  assert.deepStrictEqual([...cv.EVIDENCE_TYPES].sort(), expected.slice().sort());
  // The hint text names the three types the group covers.
  expected.forEach(t => {
    const word = { stat: 'statistic', quote: 'quote', cite: 'citation' }[t];
    assert.ok(CHANGE_GROUPS.evidence.hint.includes(word), `evidence hint should mention ${word}`);
  });
});

// ── Runner ────────────────────────────────────────────────────────────────────
(async () => {
  for (const [name, fn] of pending) {
    try { await fn(); console.log(`  ok    ${name}`); passed++; }
    catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); failed++; }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
