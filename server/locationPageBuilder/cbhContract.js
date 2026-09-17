// ── Clear Behavioral Health page contract ───────────────────────────────────
// The client's "Guidelines for Building the Sections", as data.
//
// ONE source of truth, because three places have to agree about every number
// in it: the writer prompt (what the model is asked for), the QC gates (what
// is accepted), and the brief + wizard (what the SEO team is shown). The
// dental side learned this the hard way -- its paragraph cap was written out
// twice and editing one silently decoupled the instruction from the gate.
//
// This contract REPLACES the dental section shape for CBH. It is not a
// variation on it: the dental body is 7-8 flat H2 blocks of HTML with headings
// forbidden inside, and this is ten sections, one of which nests 4-5
// H3s under a single H2.
//
// Every limit here is a MAXIMUM from the guidelines unless the name says
// otherwise. Character counts are on rendered text, never on markup.

const BRAND = 'Clear Behavioral Health';

// The suffix appended to every meta title. The 50-60 window is measured on the
// title WITHOUT it (confirmed with the client: the full tag runs past Google's
// truncation point on purpose, so the brand is what gets cut).
const TITLE_SUFFIX = ` | ${BRAND}`;

// Fixed headings. These are copied verbatim onto the page -- the guidelines
// say "use this H2 exactly as written" -- so they are not model output and the
// writer is never asked to produce them.
const FIXED_HEADINGS = {
  approachPhilosophy: 'Our philosophy of compassionate care',
  approachTherapies: 'Clinical therapies offered',
  insurance: 'Insurance accepted',
  uvp: `Why Choose ${BRAND}?`,
};

// The headings that interpolate the page's own service and location.
function approachHeading(serviceName) {
  return `Our approach to ${serviceName}`;
}
// Rendered exactly as the guideline writes it -- no question mark, no article
// inserted. Confirmed with the client.
function educationalHeading(serviceName) {
  return `What is ${serviceName}`;
}
function serviceHeading(serviceName, locationName) {
  return `${serviceName} in ${locationName}`;
}

// ── Limits ──────────────────────────────────────────────────────────────────
const LIMITS = {
  metaTitle: { min: 50, max: 60, excludesSuffix: true },
  metaDescription: { min: 150, max: 160 },

  hero: {
    h1MaxChars: 70,
    descriptionMaxChars: 175,
  },

  approach: {
    // The cap is on the WHOLE section: H2 body + both H3 bodies together.
    sectionMaxChars: 1200,
    paragraphMaxChars: 300,
    paragraphsPerBlock: { min: 1, max: 2 },
  },

  insurance: {
    maxChars: 200,
  },

  educational: {
    // The H2's own 1-2 paragraphs, before any H3.
    introMaxChars: 500,
    introParagraphs: { min: 1, max: 2 },
    h3Count: { min: 4, max: 5 },
    h3HeadingMaxChars: 60,
    // EVERY H3 body gets (lineMultiplier x number of H3s) lines -- confirmed
    // with the client. Five H3s means fifteen lines EACH, not fifteen shared:
    // the allowance scales with how many subsections the section has.
    //
    // Note what this does to the page. At five H3s the educational section can
    // run to roughly 6,400 characters against 1,200 for the approach section,
    // so the page becomes overwhelmingly educational. The client's call.
    lineMultiplier: 3,
    lineMaxChars: 85,
    // Two costs that were dead under the old flat cap of three -- a body that
    // short can never reach a break -- and bite now that a body runs to twelve
    // or fifteen: a bullet costs one line ON TOP of its wrapped length, and
    // the mandatory break after every third line costs one line itself.
    linesBeforeBreak: 3,
    bulletExtraLines: 1,
    // Serialised so the wizard's counter can apply the SAME rule the gates do
    // rather than carry a second regex that drifts from this one.
    bulletPattern: '^\\s*(?:[-\u2013\u2014\u2022*\u00b7]|\\d+[.)])\\s+',
  },

  uvp: {
    maxChars: 300,
  },

  service: {
    maxChars: 150,
  },

  treatment: {
    // The ONLY H2 on the page the writer composes. Every other heading is
    // either fixed verbatim or built from the service and location by code, so
    // this is the one that can drift into a slogan -- hence a gate on it
    // naming the service and the city, not just on its length.
    headingMaxChars: 60,
    maxChars: 250,
  },

  faqs: {
    count: { min: 5, max: 7 },
    answerMaxChars: 300,
    // The guidelines ask for a balanced mix. QC warns rather than blocks when
    // a type is missing -- a genuinely useful five-question set that happens
    // to skip one category is not a defect worth failing a page over.
    types: ['location', 'brand', 'intent'],
  },
};

// Derived: the most body text this contract can produce, which is what makes
// the dental 600-word floor wrong for CBH. Roughly 5,700 characters at every
// maximum, and a legitimate page can land near half that.
function maxBodyChars() {
  const l = LIMITS;
  return l.hero.h1MaxChars
    + l.hero.descriptionMaxChars
    + l.approach.sectionMaxChars
    + l.insurance.maxChars
    + l.educational.introMaxChars
    + l.educational.h3Count.max * (l.educational.h3HeadingMaxChars
        + linesPerBody(l.educational.h3Count.max) * l.educational.lineMaxChars)
    + l.uvp.maxChars
    + l.service.maxChars
    + l.treatment.headingMaxChars + l.treatment.maxChars
    + l.faqs.count.max * l.faqs.answerMaxChars;
}

// Section order on the page, as the guidelines list them. `key` is the field
// in the page object; `label` is what the wizard and the export call it.
const SECTION_ORDER = [
  { key: 'hero', label: 'Hero' },
  { key: 'approach', label: 'Approach' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'educational', label: 'Educational' },
  { key: 'uvp', label: 'Why Choose Us' },
  { key: 'service', label: 'Service' },
  { key: 'treatment', label: 'Treatment' },
  { key: 'faq', label: 'FAQs' },
];

// Where a section's content came from. The guidelines require this to be
// stated per section; it is shown in the wizard and the exports, never on the
// page itself.
const PROVENANCE = {
  COMPETITOR: 'competitor',
  FALLBACK: 'fallback',
};

// A bullet, as the writer emits one: a marker at the start of the entry. That
// marker is the only signal there is -- lines are stored as plain strings --
// and it matters because a bullet costs a line more than the same words would
// as a sentence.
const BULLET_RE = new RegExp(LIMITS.educational.bulletPattern);
function isBullet(text) {
  return BULLET_RE.test(String(text || ''));
}

// Counts one entry the way the guidelines do: a paragraph of N characters
// occupies ceil(N / 85) lines, and a bullet costs one extra on top of that.
function lineCount(text, lineMaxChars = LIMITS.educational.lineMaxChars) {
  const s = String(text || '').trim();
  if (!s) return 0;
  return Math.ceil(s.length / lineMaxChars)
    + (isBullet(s) ? LIMITS.educational.bulletExtraLines : 0);
}

// An entry is one of two things, and the difference is what the body reads
// like. A BULLET is a scannable item; a PARAGRAPH is 2-4 sentences that wrap
// over several lines. A non-bullet entry short enough to occupy a single line
// is neither -- it is a fragment, and a body made only of those reads like a
// slide deck rather than a page. The gates need to be able to say so.
function entryForm(text, lineMaxChars = LIMITS.educational.lineMaxChars) {
  const s = String(text || '').trim();
  if (!s) return 'empty';
  if (isBullet(s)) return 'bullet';
  return s.length > lineMaxChars ? 'paragraph' : 'fragment';
}

// The lines a body's content occupies, before the breaks that content obliges.
function contentLines(lines = []) {
  return lines.reduce((n, l) => n + lineCount(l), 0);
}

// Breaks a run of N lines requires: one after every third, none after the last
// (a trailing break is not a break between anything). Six lines take one, seven
// take two. They count against the allowance because the guidelines say a
// paragraph break counts as a line.
function breaksFor(n) {
  return n > 0 ? Math.floor((n - 1) / LIMITS.educational.linesBeforeBreak) : 0;
}

// What one H3 body costs in full: its content plus its mandatory breaks.
function linesUsed(lines = []) {
  const n = contentLines(lines);
  return n + breaksFor(n);
}

// What EACH H3 body is allowed: three lines per H3 in the section, so five H3s
// give fifteen lines to every one of them.
function linesPerBody(h3Count) {
  return LIMITS.educational.lineMultiplier * Number(h3Count || 0);
}

// How much CONTENT fits inside that allowance once the breaks are paid for.
// Twelve content lines cost fifteen (twelve plus three breaks), so a cap of
// fifteen buys twelve lines of writing, not fifteen. This is the number the
// writer is given -- telling a model "fifteen lines, but budget for breaks you
// have to work out yourself" produces overruns.
function contentAllowance(cap) {
  let n = 0;
  while (n + 1 + breaksFor(n + 1) <= Number(cap || 0)) n += 1;
  return n;
}

// The section ceiling if every body spent its full allowance. Informational --
// what is GATED is each body against linesPerBody.
function sectionLineTotal(h3Count) {
  const n = Number(h3Count || 0);
  return linesPerBody(n) * n;
}

// The character length the gates measure: rendered text, whitespace collapsed,
// markup stripped. Every cap in the guidelines is about what a reader sees.
function textLength(text) {
  return String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
}

// The title as it ships, and the part the 50-60 window applies to.
function fullTitle(title) {
  const t = String(title || '').trim();
  return t.endsWith(TITLE_SUFFIX) ? t : `${t}${TITLE_SUFFIX}`;
}
function titleWithoutSuffix(title) {
  const t = String(title || '').trim();
  return t.endsWith(TITLE_SUFFIX) ? t.slice(0, -TITLE_SUFFIX.length).trim() : t;
}

module.exports = {
  BRAND, TITLE_SUFFIX, FIXED_HEADINGS, LIMITS, SECTION_ORDER, PROVENANCE,
  approachHeading, educationalHeading, serviceHeading,
  lineCount, textLength, fullTitle, titleWithoutSuffix, maxBodyChars,
  isBullet, entryForm, contentLines, breaksFor, linesUsed,
  linesPerBody, contentAllowance, sectionLineTotal,
};
