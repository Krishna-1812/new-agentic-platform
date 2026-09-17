// ── Primary keyword relevance check (Claude Sonnet) ─────────────────────────
// The wizard's keyword adapter (keywordAdapter.js) picks Primary/Secondary by
// raw SEMrush volume alone. That regularly promotes keywords that are
// off-location (a bigger-market competitor's own city bleeding through), not
// real search phrases at all (a bare domain SEMrush attributes volume to),
// or simply generic (no location mentioned at all) ahead of correctly-scoped
// candidates already sitting in the same pool.
//
// Primary specifically has a hard rule: every entry must literally name both
// the service and the location — "is topically relevant" isn't enough (that
// let a generic, non-location-bearing keyword like "dental care for sleep
// apnea" through as Primary). Claude Sonnet reviews the volume-sorted
// proposal plus the full candidate pool (which already includes the
// client's imported keyword-universe rows) and picks replacements that
// satisfy the rule; a deterministic code-side gate enforces it regardless of
// what the model returns, and synthesizes a "{service} in {city}"-style
// keyword for any Primary slot nothing in the pool can fill.
//
// Two LLM passes, deliberately separate:
//   1. selectPrimaryAndSecondary — chooses 2 Primary + 10 Secondary from the pool
//   2. reviewSelection           — an independent critic that only judges the picks
// A single call asked to both choose and vouch for its choice reliably
// self-approves, which is why the verdict comes from a fresh call.

const store = require('./store');
const config = require('./config');
const { createLlmClient } = require('../services/llmProviders');
const { chatParams } = require('./llmParams');

// A cache read/write must never be fatal here — see the note on these in
// store.js. Degrade to "recompute" rather than killing keyword research over
// a cache outage.
const { cacheGetSafe, cacheSetSafe } = store;

function serviceWords(service) {
  return String(service || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
}

// Mechanical, code-enforced gate — not left to the model's judgment — for
// the one rule that must always hold: a Primary keyword names the service
// AND the location.
function isPrimaryEligible(keyword, city, relevanceTerms, service) {
  const lower = String(keyword || '').toLowerCase();
  const hasLocation = !!city && lower.includes(city.toLowerCase().trim());
  const hasService = relevanceTerms?.length
    ? relevanceTerms.some(t => lower.includes(t))
    : serviceWords(service).some(w => lower.includes(w));
  return hasLocation && hasService;
}

// Human-readable list of the place names Secondary may legitimately mention
// (the office's broader region and its state) — everything else geographic is
// a rival location and stays invalid.
function regionClause(regionTerms) {
  const terms = (regionTerms || []).filter(Boolean);
  if (!terms.length) return '';
  return terms.map(t => `"${t}"`).join(' or ');
}

function buildPrompt({ service, city, state, regionTerms, proposedPrimary, proposedSecondary, pool, maxPrimary, maxSecondary }) {
  const poolList = pool.map((k, i) => `${i}. ${k.keyword} | vol:${k.volume || 0}`).join('\n');
  const allowed = regionClause(regionTerms);
  const schemaHint = `{
  "primary": ["string", ...exactly ${maxPrimary}],
  "secondary": ["string", ...up to ${maxSecondary}],
  "rejected": [{ "keyword": "string", "reason": "string" }]
}`;
  const system = `You vet keyword picks for a single Location+Service landing page: "${service}" in ${city}, ${state}.
HARD RULE for "primary" specifically: every primary keyword MUST literally name both the service and ${city} (or ${city}, ${state}) — a generic, non-location-bearing keyword (e.g. just "${service}") is INVALID for primary even if it's on-topic.
A candidate (primary or secondary) is also INVALID if it:
- names a different city/town than ${city} (e.g. a bigger-market competitor's own city bleeding into this pool),
- is a bare domain/URL, brand name, or otherwise not a real search phrase a person would type,
- is off-topic for "${service}".
${allowed ? `BROADER-REGION EXCEPTION (secondary only): a secondary keyword MAY name ${allowed} — that is this office's own broader region/state, not a rival location, and it is legitimate reach for this page. Primary still requires ${city} itself.` : ''}
Respond ONLY with JSON matching this schema (no prose, no markdown):
${schemaHint}
Rules:
- Start from the proposed primary/secondary lists. Keep every candidate that is valid (primary additionally needs the location named explicitly).
- Replace each INVALID primary candidate with the best still-unused pool keyword that names both the service and ${city} (prefer higher volume among valid options). If no such replacement exists in the pool, leave that primary slot out — it will be filled deterministically elsewhere, don't guess.
- Replace each INVALID secondary candidate similarly (secondary does not require an explicit location mention, only topical/geo validity). If no valid replacement exists, drop it rather than keep an invalid one.
- "secondary" should be topically related keywords, up to ${maxSecondary} entries.
- List every candidate you rejected (from the original proposed lists) in "rejected" with a short reason.
- Never invent a keyword that isn't in the proposed lists or the extended pool.`;

  const user = `Proposed primary: ${JSON.stringify(proposedPrimary)}
Proposed secondary: ${JSON.stringify(proposedSecondary)}

Extended pool (index | keyword | volume):
${poolList}

Return JSON only.`;

  return { system, user };
}

// ── Step 3: independent review of the selection (second LLM pass) ───────────
// A fresh critic that sees ONLY the final picks plus the rules — not the pool,
// not the volume ordering, not its own earlier reasoning.
function buildReviewPrompt({ service, city, state, regionTerms, primary, secondary }) {
  const allowed = regionClause(regionTerms);
  const system = `You are reviewing a finished keyword selection for a single Location+Service landing page: "${service}" in ${city}, ${state}. Judge it against the rules; do not propose replacements.
RULES
- Every PRIMARY keyword must literally name both the service and ${city}. A keyword that omits ${city} fails, even if on-topic.
- No keyword may name a different city/town than ${city}.
${allowed ? `- EXCEPTION (secondary only): naming ${allowed} is allowed — that is this office's own broader region/state, not a rival location.` : ''}
- No keyword may be a bare domain/URL, a brand name, or anything that isn't a real search phrase a person would type.
- No keyword may be off-topic for "${service}".
- SECONDARY keywords must be topically related to "${service}".
Respond ONLY with JSON (no prose, no markdown):
{ "ok": boolean, "failures": [{ "keyword": "string", "slot": "primary" | "secondary", "reason": "string" }] }
Set "ok" to true only when EVERY keyword in both lists passes every rule. List one entry in "failures" per failing keyword, naming which slot it came from. If nothing fails, "failures" must be an empty array.`;

  const user = `Primary: ${JSON.stringify(primary.map(c => c.keyword))}
Secondary: ${JSON.stringify(secondary.map(c => c.keyword))}

Return JSON only.`;

  return { system, user };
}

// Returns { ok, failures: [{ keyword, slot, reason }] }.
// Fails OPEN: an LLM outage must not block keyword research, so an error or
// unparseable response is treated as "no objection" rather than a rejection.
async function reviewSelection({ service, city, state, regionTerms, primary, secondary }) {
  if (!primary.length && !secondary.length) return { ok: true, failures: [] };

  // regionTerms changes the rules the critic applies, so it belongs in the key.
  const cacheK = store.cacheKey(
    'dental-kw-review-v2', service, city, state, (regionTerms || []).slice().sort(),
    primary.map(c => c.keyword).sort(), secondary.map(c => c.keyword).sort(),
  );
  const cached = await cacheGetSafe(cacheK, config.cache.llmTtlMs);
  if (cached) return cached;

  const { system, user } = buildReviewPrompt({ service, city, state, regionTerms, primary, secondary });

  let parsed = null;
  try {
    const llm = createLlmClient(config.llm.generationModel);
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      const completion = await llm.chat.completions.create({
        model: llm.model,
        ...chatParams(llm.model, { maxTokens: 4000 }),
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      });
      try {
        const raw = JSON.parse(completion.choices[0].message.content);
        if (raw && typeof raw.ok === 'boolean') parsed = raw;
      } catch { /* retry once on schema-invalid output */ }
    }
  } catch (e) {
    console.error('[keywordRelevance] review pass failed, accepting selection as-is:', e.message);
    return { ok: true, failures: [] };
  }
  if (!parsed) return { ok: true, failures: [] };

  // Re-derive `ok` from the failures list rather than trusting the flag — the
  // model has been observed setting ok:true while still listing failures.
  const failures = (Array.isArray(parsed.failures) ? parsed.failures : [])
    .filter(f => f && f.keyword)
    .map(f => ({
      keyword: String(f.keyword),
      slot: f.slot === 'primary' ? 'primary' : 'secondary',
      reason: String(f.reason || 'unspecified'),
    }));
  const result = { ok: !failures.length, failures };
  await cacheSetSafe(cacheK, result, { kind: 'llm', ttlMs: config.cache.llmTtlMs });
  return result;
}

// candidates: full volume-sorted KeywordCandidate[] from keywordAdapter.
// relevanceTerms: this service's topical substrings (keywordUniverseMap.js), or null.
// regionTerms: place names Secondary may legitimately mention (region + state).
// Returns { primary, secondary, rejected, reviewFailures, lowVolume }.
// `lowVolume` is true when Primary is the synthesized "{service} in {city}" pair
// rather than real discovered keywords — the UI MUST say searches are low.
async function selectPrimaryAndSecondary({ service, city, state, region, candidates, relevanceTerms, regionTerms }) {
  const maxPrimary = config.keywords.maxPrimary;
  const maxSecondary = config.keywords.maxSecondary;
  const eligible = c => isPrimaryEligible(c.keyword, city, relevanceTerms, service);
  const allowedRegion = regionTerms || [region, state].filter(Boolean);
  const withLowVolume = r => ({ ...r, lowVolume: r.primary.some(c => c.source === 'synthesized') });

  const proposedPrimary = candidates.slice(0, maxPrimary).map(c => c.keyword);
  const proposedSecondary = candidates.slice(maxPrimary, maxPrimary + maxSecondary).map(c => c.keyword);

  // Primary is eligibility-filtered, so a positional slice for Secondary would
  // re-list the same keywords (the LLM path dedupes via usedKeys; this path has
  // to do it explicitly). Exclude whatever Primary took.
  const fallbackPrimary = candidates.filter(eligible).slice(0, maxPrimary);
  const fallbackPrimaryKeys = new Set(fallbackPrimary.map(c => c.keyword.toLowerCase()));
  const fallback = {
    primary: fallbackPrimary,
    secondary: candidates
      .filter(c => !fallbackPrimaryKeys.has(c.keyword.toLowerCase()))
      .slice(0, maxSecondary),
    rejected: [],
    reviewFailures: [],
  };
  // Synthesizing costs an LLM call (synthesizePhrases), so it is deferred
  // until a Primary slot actually needs filling — the successful path returns
  // real keywords and never touches `fallback`, and must not pay for it.
  let synthetic = null;
  const fillSynthetic = async (primary) => {
    if (primary.length >= maxPrimary) return primary;
    synthetic = synthetic || await synthesizePhrases({ service, city, state, maxPrimary });
    fillPrimaryFromSynthetic({ primary, synthetic, maxPrimary });
    return primary;
  };
  const returnFallback = async () => {
    await fillSynthetic(fallback.primary);
    return withLowVolume(fallback);
  };
  if (!candidates.length) return returnFallback();

  // v8: bumped after the synthesized Primary changed shape — a bare
  // "{service} {city}" concatenation ("anxiety anaheim hills") became a real
  // search phrase ("anxiety treatment in anaheim hills"), so a v7 result is
  // cached with keywords the SEO team has already rejected.
  // v7: bumped after keywordizeService changed the synthesized keywords a
  // cached result can contain ("cavity prevention (curodont) manchester" ->
  // "cavity prevention manchester"), and after a flagged Primary began
  // replacing only its own slot instead of the whole list. v6 added the region
  // exception, the second review pass, and the lowVolume flag.
  const cacheK = store.cacheKey('dental-kw-primary-check-v8', service, city, state, allowedRegion, candidates.map(c => c.keyword).sort());
  const cached = await cacheGetSafe(cacheK, config.cache.llmTtlMs);
  if (cached) return cached;

  // Extended pool for replacements — everything beyond the proposed lists,
  // capped to keep the prompt bounded.
  const pool = candidates.slice(0, config.llm.maxKeywordsToClassify);
  const { system, user } = buildPrompt({ service, city, state, regionTerms: allowedRegion, proposedPrimary, proposedSecondary, pool, maxPrimary, maxSecondary });

  let parsed = null;
  try {
    const llm = createLlmClient(config.llm.generationModel);
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      const completion = await llm.chat.completions.create({
        model: llm.model,
        // Budget generously: a tight cap makes Claude spend its whole budget
        // reasoning and return finish_reason:"length" with empty content
        // (see the same note in contentGenerator.js).
        ...chatParams(llm.model, { maxTokens: 8000 }),
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      });
      try {
        const raw = JSON.parse(completion.choices[0].message.content);
        if (raw && Array.isArray(raw.primary) && Array.isArray(raw.secondary)) parsed = raw;
      } catch { /* retry once on schema-invalid output */ }
    }
  } catch (e) {
    // LLM unavailable/misconfigured — fall back to the raw volume sort
    // rather than blocking keyword research entirely.
    console.error('[keywordRelevance] Claude Sonnet primary check failed, falling back to volume sort:', e.message);
    return returnFallback();
  }
  if (!parsed) return returnFallback();

  const byKeyword = new Map(candidates.map(c => [c.keyword.toLowerCase(), c]));
  const resolve = (kw) => byKeyword.get(String(kw || '').toLowerCase());
  // The model doesn't reliably keep "secondary" consistent with its own
  // "rejected" verdicts (it has echoed a keyword in both) — re-derive
  // validity in code instead of trusting the raw list.
  const rejected = Array.isArray(parsed.rejected) ? parsed.rejected : [];
  const rejectedKeys = new Set(rejected.map(r => String(r.keyword || '').toLowerCase()));
  const toCandidates = (list, max, { requirePrimaryEligible = false } = {}) => {
    const out = [];
    const used = new Set();
    for (const kw of list) {
      const key = String(kw || '').toLowerCase();
      if (rejectedKeys.has(key) || used.has(key)) continue;
      const c = resolve(kw);
      if (!c) continue;
      // Same hard gate applied to whatever the model proposes — never trust
      // "the model said it's fine" for the one rule that must always hold.
      if (requirePrimaryEligible && !eligible(c)) continue;
      used.add(key);
      out.push(c);
      if (out.length >= max) break;
    }
    return out;
  };

  const primary = toCandidates(parsed.primary, maxPrimary, { requirePrimaryEligible: true });
  const usedKeys = new Set(primary.map(c => c.keyword.toLowerCase()));
  const secondary = toCandidates(parsed.secondary.filter(kw => !usedKeys.has(String(kw || '').toLowerCase())), maxSecondary);

  // The discovered pool won't always contain enough valid, location-bearing
  // candidates to fill Primary (a thin/heavily-filtered pool, e.g. a niche
  // service in a small market) — Primary must still carry the page's actual
  // service+location, even at 0 volume, rather than come up short.
  await fillSynthetic(primary);

  // ── Step 3 + 4: review the selection, then act on the verdict ─────────────
  // Synthesized entries are built to the rules already: there is nothing
  // better to swap them for, so sending them to the critic only wastes a call
  // and produces a self-contradictory result (it rejects "invisalign
  // brookline" as not a real search phrase, and the only replacement
  // available is "invisalign brookline"). Review discovered keywords only.
  const discoveredPrimary = primary.filter(c => c.source !== 'synthesized');
  const review = await reviewSelection({
    service, city, state, regionTerms: allowedRegion,
    primary: discoveredPrimary, secondary,
  });

  // Discard any verdict naming a keyword that was never submitted. The critic
  // can echo a keyword it wasn't shown (or mislabel which slot one came from),
  // and acting on that churns Primary — dropping an entry only for
  // fillPrimaryFromSynthetic to re-add it in a different order. Same
  // philosophy as the Primary eligibility gate: re-derive in code, never
  // trust the model's bookkeeping.
  const submitted = new Set(
    [...discoveredPrimary, ...secondary].map(c => c.keyword.toLowerCase()),
  );
  const failures = review.failures.filter(f => submitted.has(f.keyword.toLowerCase()));

  // A flagged SECONDARY is simply dropped — it's supplementary reach.
  const secondaryFailed = new Set(
    failures.filter(f => f.slot === 'secondary').map(f => f.keyword.toLowerCase()),
  );
  const reviewedSecondary = secondary.filter(c => !secondaryFailed.has(c.keyword.toLowerCase()));

  // A flagged PRIMARY is dropped and its slot refilled from the synthesized
  // "{service} in {city}" pair at zero volume. Only the flagged entries go — a
  // keyword the critic passed is real, location-bearing demand and keeping it
  // beats replacing it with a zero-volume synonym. lowVolume then drives the
  // explicit "searches are low" notice in the wizard.
  const primaryFailed = new Set(
    failures.filter(f => f.slot === 'primary').map(f => f.keyword.toLowerCase()),
  );
  const finalPrimary = primary.filter(c => !primaryFailed.has(c.keyword.toLowerCase()));
  await fillSynthetic(finalPrimary);

  const result = withLowVolume({
    primary: finalPrimary,
    secondary: reviewedSecondary,
    rejected,
    reviewFailures: failures,
  });
  await cacheSetSafe(cacheK, result, { kind: 'llm', ttlMs: config.cache.llmTtlMs });
  return result;
}

// Service names carry punctuation that never appears in a search query:
// "Crowns & Bridges", "Cavity Prevention (Curodont)", "TMD/TMJ Treatment",
// "Diabetes & Oral Health", "Partial & Full Dentures". Dropped straight into a
// synthesized keyword they produce "cavity prevention (curodont) manchester",
// which is what the SEO team then sees as the page's stated Primary target.
// (The QC gates themselves strip punctuation, so this is keyword quality, not
// a failing page.) Normalize to something a person could plausibly type.
function keywordizeService(service) {
  return String(service || '')
    .replace(/\([^)]*\)/g, ' ')   // drop parentheticals: "(Curodont)"
    .replace(/[®™©]/g, ' ')        // "Invisalign® Treatment" -> "invisalign treatment"
    .replace(/&/g, ' and ')        // "Crowns & Bridges" -> "crowns and bridges"
    .replace(/[\/]/g, ' ')         // "TMD/TMJ" -> "tmd tmj"
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ── Making a synthesized keyword read like a real search ────────────────────
// A service name is only half a search phrase when it names a CONDITION rather
// than the service for it. "Teeth Whitening", "Root Canals", "Psychotherapy"
// and "Anxiety Treatment" are things people type; "Anxiety", "ADHD" and
// "Insomnia" are not — pasted against a city they produced "anxiety anaheim
// hills", which nobody searches for and which reads as a mistake on the brief.
//
// Rather than carry a list of every condition a client might sell a page for,
// detect the SERVICE half and add a head noun only when it is missing. Two
// signals: a procedure/discipline/practitioner ending (which covers
// "whitening", "treatment", "dentistry", "orthodontist", "psychiatry",
// "sedation", "prevention"), and the everyday service nouns that have no such
// ending.
const SERVICE_NOUN_SUFFIX_RE = /(ment|ing|apy|iatry|istry|ology|ics|ist|ician|ation|ention|ery|ectomy|plasty|scopy)$/;
const SERVICE_NOUNS = new Set([
  'care', 'service', 'services', 'exam', 'exams', 'checkup', 'check-up',
  'x-ray', 'x-rays', 'xray', 'xrays', 'crown', 'crowns', 'bridge', 'bridges',
  'denture', 'dentures', 'veneer', 'veneers', 'brace', 'braces', 'aligner',
  'aligners', 'sealant', 'sealants', 'implant', 'implants', 'canal', 'canals',
  'makeover', 'injectable', 'injectables', 'filler', 'fillers', 'extraction',
  'extractions', 'removal', 'repair', 'rehab', 'detox', 'program', 'programs',
  'health', 'wellness', 'clinic', 'doctor', 'surgeon', 'support', 'medication',
]);
// The generic head noun. Deliberately the broadest one — it is right for a
// condition page in any vertical, where "therapy" or "surgery" would not be.
const DEFAULT_SERVICE_NOUN = 'treatment';

// Does this name already say what SERVICE it is, or only what condition?
function namesAService(phrase) {
  return String(phrase || '').toLowerCase().split(' ')
    .some(t => SERVICE_NOUN_SUFFIX_RE.test(t) || SERVICE_NOUNS.has(t));
}

// "Anxiety" -> "anxiety treatment"; "Teeth Whitening" -> "teeth whitening".
// LOWERCASE, because a keyword is a search query.
function servicePhrase(service) {
  const svc = keywordizeService(service);
  if (!svc) return svc;
  return namesAService(svc) ? svc : `${svc} ${DEFAULT_SERVICE_NOUN}`;
}

// The same head-noun rule, for text a READER sees: headings, the page title,
// the service name shown in the wizard.
//
// It cannot reuse servicePhrase, because that lowercases by design -- correct
// for a search query, and wrong for a heading. Running "ADHD" through it and
// title-casing the result produced "Adhd Treatment", and "Bipolar I & II"
// became "Bipolar i And ii": the acronym and the numerals are destroyed by the
// round trip. So this preserves the client's own capitalisation and only
// appends the head noun.
function servicePhraseDisplay(service) {
  // Deliberately minimal. The keyword path strips parentheticals and expands
  // "&" because a search query carries neither; a HEADING carries both, and
  // the parenthetical is usually where the acronym lives -- stripping it turned
  // "Obsessive Compulsive Disorder (OCD)" into a heading that never says OCD,
  // which is the term people actually search and scan for. Only the trademark
  // signs go, since nobody reads those.
  const cleaned = String(service || '')
    .replace(/[®™©]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return cleaned;
  return namesAService(cleaned) ? cleaned : `${cleaned} ${DEFAULT_SERVICE_NOUN}`;
}

// The deterministic pair — used when the LLM is unavailable, and as the top-up
// whenever it returns fewer than maxPrimary usable phrases. "in {city}" rather
// than a bare concatenation: it is how the phrase is actually typed, and "in"
// is a stopword in the QC matcher (text.js STOPWORDS), so adding it cannot
// change whether a page counts as using its own keyword.
function deterministicPhrases({ service, city, state }) {
  const svc = servicePhrase(service);
  const town = String(city || '').trim();
  const st = String(state || '').trim();
  return [
    `${svc} in ${town}`,
    st ? `${svc} in ${town}, ${st}` : '',
  ].filter(Boolean).map(kw => kw.replace(/\s+/g, ' ').trim().toLowerCase());
}

// Guards against the model answering with something that isn't a usable
// Primary for THIS page: it must name the city, stay on the service, and not
// be the "near me" phrasing the client has explicitly ruled out (see the
// NEAR_ME_RE note in keywordAdapter.js).
function isUsableSynthetic(phrase, { service, city }) {
  const kw = String(phrase || '').trim().toLowerCase();
  if (!kw || kw.length > 80 || kw.split(/\s+/).length > 8) return false;
  if (/\bnear me\b/.test(kw)) return false;
  const town = String(city || '').trim().toLowerCase();
  if (!town || !kw.includes(town)) return false;
  // At least one word of the service itself, so an invented phrase about some
  // other service cannot take a Primary slot.
  return keywordizeService(service).split(' ').some(w => w.length > 2 && kw.includes(w));
}

// Asks the writer model for the phrase a person would actually type. The
// deterministic pair above knows one head noun ("treatment"); the model knows
// that a psychiatry page reads "anxiety treatment in anaheim hills" while the
// same service might read "anxiety therapy" or "anxiety counseling" elsewhere.
// Cached per service+city+state, and EVERY failure mode — no API key, an
// outage, unparseable JSON, an off-page suggestion — degrades to the
// deterministic pair rather than blocking keyword research.
async function synthesizePhrases({ service, city, state, maxPrimary }) {
  const deterministic = deterministicPhrases({ service, city, state });
  const cacheK = store.cacheKey('dental-kw-synth-v1', service, city, state, maxPrimary);
  const cached = await cacheGetSafe(cacheK, config.cache.llmTtlMs);
  if (Array.isArray(cached) && cached.length) return cached;

  const system = `You write the search phrases a real person types into Google to find a local provider.
Respond ONLY with JSON (no prose, no markdown): { "keywords": ["string", ...exactly ${maxPrimary}] }
Rules:
- Every phrase is for the service "${service}" offered in ${city}, ${state}, and every phrase must name ${city}.
- If the service name is a condition, symptom or bare topic (e.g. "Anxiety", "ADHD"), add the word people search alongside it — "anxiety treatment", "adhd therapy". NEVER leave a bare condition sitting next to a city ("anxiety ${city}" is wrong).
- If the service name is already what people search for (e.g. "Teeth Whitening", "Root Canals"), keep it as it is.
- Phrase 1 is "<service phrase> in ${city}". Phrase 2 is a natural variant — the state, or a common alternative head noun.
- All lowercase. No brand or practice names. No "near me". No punctuation except a comma before the state.`;
  const user = `Service: ${service}\nCity: ${city}\nState: ${state}\n\nReturn JSON only.`;

  let phrases = [];
  try {
    const llm = createLlmClient(config.llm.generationModel);
    const completion = await llm.chat.completions.create({
      model: llm.model,
      ...chatParams(llm.model, { maxTokens: 1000 }),
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    const raw = JSON.parse(completion.choices[0].message.content);
    phrases = (Array.isArray(raw?.keywords) ? raw.keywords : [])
      .map(k => String(k || '').trim().replace(/\s+/g, ' ').toLowerCase())
      .filter(kw => isUsableSynthetic(kw, { service, city }));
  } catch (e) {
    console.error('[keywordRelevance] synthesized-keyword pass failed, using the deterministic phrase:', e.message);
    return deterministic;
  }
  if (!phrases.length) return deterministic;

  // Top up from the deterministic pair so a model that answers with a single
  // usable phrase still fills every Primary slot.
  const result = [...new Set([...phrases, ...deterministic])].slice(0, maxPrimary);
  await cacheSetSafe(cacheK, result, { kind: 'llm', ttlMs: config.cache.llmTtlMs });
  return result;
}

function fillPrimaryFromSynthetic({ primary, synthetic, maxPrimary }) {
  const usedKeys = new Set(primary.map(c => c.keyword.toLowerCase()));
  for (const kw of synthetic) {
    if (primary.length >= maxPrimary) break;
    if (usedKeys.has(kw)) continue;
    usedKeys.add(kw);
    primary.push({ keyword: kw, volume: 0, difficulty: 0, intent: 'commercial', source: 'synthesized' });
  }
}

module.exports = {
  selectPrimaryAndSecondary, reviewSelection, isPrimaryEligible,
  keywordizeService, servicePhrase, servicePhraseDisplay, namesAService,
  deterministicPhrases, synthesizePhrases,
};
