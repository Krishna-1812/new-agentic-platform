// ── Which vertical a client's pages belong to ───────────────────────────────
// One place that answers "what kind of business is this?", because several
// parts of the pipeline were written for the first client and quietly assume
// every client is a dental group:
//
//   - the SERP seed was prefixed "Dental " unconditionally, so a behavioral
//     health page researched "Dental Anxiety Anaheim Hills" and came back with
//     dental keywords and dental competitors;
//   - the writer prompt describes the practice and names a profession.
//
// Both now ask here instead of assuming.

const VERTICAL_BY_CLIENT = {
  client_gentle_dental: 'dental',
  client_clear_behavioral_health: 'behavioralHealth',
  client_neuro_wellness_spa: 'behavioralHealth',
};

// Deliberately NOT 'dental'. An unregistered client is a client we know
// nothing about, and the safe answer to "should I inject a industry word into
// their search query?" is no — injecting the wrong one silently researches
// the wrong industry, which is exactly the bug this module exists to stop.
// Every caller that needs a concrete vertical (the writer) applies its own
// default; this returns null so "unknown" stays distinguishable from "dental".
function verticalFor(clientId) {
  return VERTICAL_BY_CLIENT[clientId] || null;
}

// Some Gentle Dental service names are ambiguous outside a dental context:
// "Sealants" and "Crowns & Bridges" read as construction terms, "Braces" as
// orthopedic, "Implants" as cosmetic surgery. A bare "{service} {city} {state}"
// SERP query for those returns building departments and civic pages instead of
// dental competitors, so the query is qualified with the industry word.
//
// That qualifier is a property of the VERTICAL, not of searching in general.
// Behavioral health needs none — "Anxiety Anaheim Hills" is already
// unambiguous, and prefixing anything to it would research a different
// industry.
const SEED_QUALIFIER = {
  dental: 'Dental',
  behavioralHealth: null,
};

// A SEPARATE qualifier for competitor research, because the two searches want
// different things. A keyword seed must stay natural -- it is discovering what
// people actually type. A competitor search is discovering which PAGES to model,
// and there the query may be steered.
//
// They differ for behavioral health specifically. "anxiety treatment in anaheim
// hills" is a perfectly good keyword, but as a competitor search it returns
// sedation dentistry: "Why Anxious Patients Choose MySmile", "Sedation Dentistry
// in Anaheim Hills". Dental-anxiety practices own that local SERP, so a
// psychiatry page was being offered dental pages to model and correctly
// rejected every one of them -- leaving it with no competitor basis at all.
const COMPETITOR_QUALIFIER = {
  dental: 'Dental',
  behavioralHealth: 'mental health',
};

function competitorQualifierFor(clientIdOrVertical) {
  const vertical = COMPETITOR_QUALIFIER[clientIdOrVertical] !== undefined
    ? clientIdOrVertical
    : verticalFor(clientIdOrVertical);
  return COMPETITOR_QUALIFIER[vertical] || null;
}

function seedQualifierFor(clientIdOrVertical) {
  const vertical = SEED_QUALIFIER[clientIdOrVertical] !== undefined
    ? clientIdOrVertical
    : verticalFor(clientIdOrVertical);
  return SEED_QUALIFIER[vertical] || null;
}

module.exports = {
  verticalFor, seedQualifierFor, competitorQualifierFor,
  VERTICAL_BY_CLIENT, SEED_QUALIFIER, COMPETITOR_QUALIFIER,
};
