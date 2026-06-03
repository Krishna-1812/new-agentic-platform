// ── Section heading & content logic by service category (Spec §5) ───────────
// The generator must NOT force the same heading for every service. These pure
// helpers pick section_type + heading from service.category. Switch source is
// service.category (Spec §3.4): therapy | medication | procedure | condition | psychiatry

// §5.1 Benefits / Symptoms / Conditions block
function benefitsOrSymptoms(category, serviceName, locationName) {
  switch (category) {
    case 'medication':
      return { section_type: 'symptoms', heading: 'Symptoms managed with medication' };
    case 'condition':
      return { section_type: 'symptoms', heading: `Symptoms of ${serviceName}` };
    case 'procedure':
    case 'therapy':
    case 'psychiatry':
    default:
      return { section_type: 'benefits', heading: `Benefits of ${serviceName}` };
  }
}

// Secondary "conditions treated" heading where the category warrants it.
function conditionsTreatedHeading(category, serviceName, locationName) {
  if (category === 'therapy') return `Conditions treated with ${serviceName} in ${locationName}`;
  if (category === 'procedure') return `Conditions treated with ${serviceName}`;
  return null; // medication/condition use the symptoms block instead
}

// §5.2 Decision-support block (Causes / What to expect / When to seek)
function decisionSupport(category, serviceName, locationName) {
  switch (category) {
    case 'condition':
      return { section_type: 'causes', heading: `Causes of ${serviceName}` };
    case 'medication':
      return { section_type: 'causes', heading: 'Causes of medication needs' };
    case 'procedure':
      return {
        section_type: 'what_to_expect',
        heading: `What to expect during ${serviceName}`,
        secondary: { section_type: 'when_to_consider', heading: `When to consider ${serviceName}` },
      };
    case 'therapy':
    case 'psychiatry':
    default:
      return { section_type: 'when_to_seek', heading: `When to seek ${locationName} ${serviceName}` };
  }
}

// §5.3 Definition heading
function definitionHeading(category, serviceName) {
  // condition pages ask "What is [condition]?"; everything else "What is [service]?"
  return `What is ${serviceName}?`;
}

// §5.4 Personalized-care ordering by service. Reorders the client condition
// list to lead with what's most relevant. Leading terms matched case-insensitively.
const CARE_ORDER = {
  'depression treatment': ['depression'],
  'talk therapy': ['anxiety', 'depression', 'ptsd', 'stress', 'ocd', 'relationship'],
  'medication management': ['depression', 'anxiety', 'adhd', 'bipolar', 'ocd', 'ptsd'],
  'tms therapy': ['depression'],
};

function orderConditions(serviceName, conditions = []) {
  const lead = CARE_ORDER[(serviceName || '').toLowerCase()] || [];
  const score = (c) => {
    const lc = c.toLowerCase();
    const idx = lead.findIndex(term => lc.includes(term));
    return idx === -1 ? lead.length + 100 : idx;
  };
  return [...conditions].sort((a, b) => score(a) - score(b));
}

// §5.5 Care pillars — L1-common headings; copy is L3 (rewritten per service).
const CARE_PILLARS = [
  'Our philosophy of compassionate care',
  'Clinical therapies offered',
  'Accessible care',
  'Built for you',
  'Connected to community',
];

// "Our approach to <Service>" must always carry these two H3s (feedback §4/§5).
const APPROACH_PILLARS = [
  'Our philosophy of compassionate care',
  'Clinical therapies offered',
];

module.exports = {
  benefitsOrSymptoms, conditionsTreatedHeading, decisionSupport,
  definitionHeading, orderConditions, CARE_PILLARS, APPROACH_PILLARS,
};
