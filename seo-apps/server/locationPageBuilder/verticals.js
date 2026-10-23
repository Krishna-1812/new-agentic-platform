// ── Which vertical a client's pages belong to ───────────────────────────────
// One place that answers "what kind of business is this?", so the parts of the
// pipeline that steer a search by industry ask here instead of assuming:
//
//   - the SERP seed must not be prefixed with an industry word the client is
//     not in, or a behavioral health page researches another industry's
//     keywords and competitors;
//   - competitor research may steer its query toward the client's industry.

const VERTICAL_BY_CLIENT = {
  client_clear_behavioral_health: 'behavioralHealth',
  client_neuro_wellness_spa: 'behavioralHealth',
};

// An unregistered client is a client we know nothing about, and the safe
// answer to "should I inject an industry word into their search query?" is no
// -- injecting the wrong one silently researches the wrong industry, which is
// exactly the bug this module exists to stop. So this returns null for
// "unknown" rather than guessing.
function verticalFor(clientId) {
  return VERTICAL_BY_CLIENT[clientId] || null;
}

// Some service names are ambiguous outside their industry ("Sealants" reads
// as a construction term), and a bare "{service} {city} {state}" SERP query
// for those returns civic pages instead of competitors, so the query is
// qualified with the industry word.
//
// That qualifier is a property of the VERTICAL, not of searching in general.
// Behavioral health needs none -- "Anxiety Anaheim Hills" is already
// unambiguous, and prefixing anything to it would research a different
// industry.
const SEED_QUALIFIER = {
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
