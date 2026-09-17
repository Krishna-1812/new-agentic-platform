// ── Export: JSON / Markdown / DOCX (Spec §11) ───────────────────────────────
// JSON = canonical layered Page Object (the dev contract). Markdown per the
// spec template. DOCX via the `docx` lib already used by the app's export route.

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, ShadingType, VerticalAlign,
  BorderStyle, AlignmentType, Footer, PageNumber, TabStopType,
} = require('docx');
// The CBH line rules live in one place; the export renders the breaks they
// charge for rather than restating how often they fall.
const cbhContract = require('./cbhContract');

// Palette tuned to the formatted reference doc.
const TEAL = '2C7A7B';      // section headings + content H1
const NAVY = '1F2D3D';      // document title
const GREY = '6B7280';      // muted labels / URL
const LABEL_BG = 'EAF2F1';  // metadata label cells

// ── Real Word heading styles ────────────────────────────────────────────────
// The page's headings are exported as Word's BUILT-IN Heading 1/2/3 styles,
// not as bold coloured text that merely looks like headings. It matters
// because of what happens after the download: the document is worked on in
// Word and pasted into a CMS, and only styled headings survive that trip —
// they carry the outline in the navigation pane, drive a generated table of
// contents, and paste as <h1>/<h2>/<h3> instead of <p><strong>.
//
// The look is defined ON the styles rather than on each run, so the visual
// design is unchanged while the structure underneath it becomes real. Runs
// inside a heading therefore carry no size or colour of their own — anything
// set on the run would override the style and put us back where we started.
const DOC_STYLES = {
  default: {
    title: { run: { size: 40, bold: true, color: NAVY }, paragraph: { spacing: { after: 60 } } },
    heading1: { run: { size: 30, bold: true, color: TEAL }, paragraph: { spacing: { before: 240, after: 120 } } },
    heading2: { run: { size: 26, bold: true, color: TEAL }, paragraph: { spacing: { before: 320, after: 120 } } },
    heading3: { run: { size: 22, bold: true, color: '111827' }, paragraph: { spacing: { before: 160, after: 40 } } },
  },
};

// A heading's text carries no formatting of its own — see DOC_STYLES.
const headingRun = (t) => new TextRun({ text: String(t || '') });
const headingRule = { bottom: { style: BorderStyle.SINGLE, size: 8, color: TEAL, space: 4 } };

// The page's own H1 / H2 / H3, as Word headings.
const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [headingRun(t)] });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, border: headingRule, children: [headingRun(t)] });
const h3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [headingRun(t)] });

// ── JSON ─────────────────────────────────────────────────────────────────────
function toJSON(pageObject) {
  return JSON.stringify(pageObject, null, 2);
}

// ── Markdown (Spec §11 template) ─────────────────────────────────────────────
function toMarkdown(pageObject) {
  const pd = pageObject.page_data;
  const ld = pageObject.location_data;
  const sd = pageObject.service_data;
  const kw = pageObject.keywords;
  const L = [];
  const list = (arr, fmt = x => x) => (arr || []).map(x => `- ${fmt(x)}`).join('\n') || '- (none)';
  const kwName = k => (typeof k === 'string' ? k : k.keyword);

  L.push(`# ${sd.service_name} in ${ld.location_name}, ${ld.state}`);
  L.push(`<!-- page_url: ${pd.page_url} -->\n`);

  L.push(`## Primary Keywords\n${list(kw.primary, kwName)}`);
  L.push(`## Secondary Keywords\n${list(kw.secondary, kwName)}\n`);

  L.push(`## Meta Title\n${pd.meta_title}`);
  L.push(`## Meta Description\n${pd.meta_description}`);
  L.push(`## H1\n${pd.h1}\n`);

  L.push(`## Hero Intro\n${pd.hero_intro}`);
  L.push(`## ${pd.approach.heading}\n${pd.approach.intro}`);
  pd.approach.care_pillars.forEach(p => L.push(`### ${p.heading}\n${p.copy}`));
  (pd.competitor_section?.blocks || []).forEach(b => {
    L.push(`## ${b.h2}`);
    (b.h3s || []).forEach(h => L.push(`### ${h.heading}\n${h.copy}`));
  });

  L.push(`## FAQs`);
  (pd.faqs || []).forEach((f, i) => L.push(`### Q${i + 1}: ${f.question}\n${f.answer}`));

  L.push(`## Internal Links\n| Anchor | URL | Type | Placement |\n|---|---|---|---|`);
  (pd.internal_links || []).forEach(l => L.push(`| ${l.anchor_text} | ${l.url} | ${l.link_type} | ${l.placement} |`));

  L.push(`## Schema Preview\n\`\`\`json\n${JSON.stringify(pd.schema || {}, null, 2)}\n\`\`\``);

  return L.join('\n\n');
}

// ── DOCX (formatted; restricted to the agreed section set) ───────────────────
// Contained sections only: doc heading, page URL, SEO metadata (meta title /
// description / H1), hero intro, "Our approach to <Service>" (philosophy of
// compassionate care + clinical therapies offered), the competitor-based
// section (H2/H3 blocks), and FAQs. Nothing else (no internal links, keywords,
// schema, services, experts, etc.).
async function toDocxBuffer(pageObject) {
  const pd = pageObject.page_data;
  const ld = pageObject.location_data;
  const sd = pageObject.service_data;
  const brand = pageObject.global_template?.brand_name || '';
  const docTitle = `${sd.service_name} in ${ld.location_name}, ${ld.state}`;

  const children = [];
  const run = (text, opts = {}) => new TextRun({ text: String(text || ''), size: 22, ...opts });

  // Small teal eyebrow label.
  const eyebrow = (t) => new Paragraph({ spacing: { after: 40 }, children: [run(t, { bold: true, color: TEAL, size: 17, characterSpacing: 30 })] });
  // Big document title — Word's Title style, above the page's own H1.
  const title = (t) => new Paragraph({ heading: HeadingLevel.TITLE, children: [headingRun(t)] });
  // Teal furniture label with a bottom rule ("SEO Metadata", "Page Content").
  // Not a Word heading — see the note on DOC_STYLES.
  const section = (t) => new Paragraph({
    spacing: { before: 320, after: 120 },
    border: headingRule,
    children: [run(t, { bold: true, color: TEAL, size: 26 })],
  });
  const body = (t) => new Paragraph({ spacing: { after: 80 }, children: [run(t)] });
  const bullet = (t) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 20 }, children: [run(t)] });
  const thickRule = () => new Paragraph({ spacing: { before: 120, after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: TEAL } }, children: [run('')] });

  // ── Title block ─────────────────────────────────────────────────────────
  children.push(eyebrow('SEO PAGE CONTENT'));
  children.push(title(docTitle));
  children.push(new Paragraph({ spacing: { after: 60 }, children: [run('Page URL:  ', { bold: true, color: GREY, size: 18 }), run(pd.page_url, { color: GREY, size: 18 })] }));
  children.push(thickRule());

  // ── SEO Metadata table ──────────────────────────────────────────────────
  children.push(section('SEO Metadata'));
  const labelCell = (t) => new TableCell({
    width: { size: 26, type: WidthType.PERCENTAGE },
    shading: { fill: LABEL_BG, type: ShadingType.SOLID, color: 'auto' },
    margins: { top: 80, bottom: 80, left: 140, right: 140 }, verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [run(t, { bold: true, color: TEAL })] })],
  });
  const valueCell = (t) => new TableCell({
    width: { size: 74, type: WidthType.PERCENTAGE },
    margins: { top: 80, bottom: 80, left: 140, right: 140 }, verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [run(t)] })],
  });
  const metaRow = (label, value) => new TableRow({ children: [labelCell(label), valueCell(value)] });
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [metaRow('Meta Title', pd.meta_title), metaRow('Meta Description', pd.meta_description), metaRow('H1', pd.h1)],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: 'D8DEE4' }, bottom: { style: BorderStyle.SINGLE, size: 2, color: 'D8DEE4' },
      left: { style: BorderStyle.SINGLE, size: 2, color: 'D8DEE4' }, right: { style: BorderStyle.SINGLE, size: 2, color: 'D8DEE4' },
      insideH: { style: BorderStyle.SINGLE, size: 2, color: 'D8DEE4' }, insideV: { style: BorderStyle.SINGLE, size: 2, color: 'D8DEE4' },
    },
  }));

  // ── Page Content ──────────────────────────────────────────────────────────
  children.push(section('Page Content'));
  children.push(h1(pd.h1));

  children.push(new Paragraph({ spacing: { before: 160, after: 40 }, children: [run('Hero', { bold: true, color: '111827' })] }));
  children.push(body(pd.hero_intro));

  // Our approach to <Service>
  children.push(h2(pd.approach.heading));
  if (pd.approach.intro) children.push(body(pd.approach.intro));
  (pd.approach.care_pillars || []).forEach(p => { children.push(h3(p.heading)); children.push(body(p.copy)); });

  // Competitor-based section (H2 → H3s)
  (pd.competitor_section?.blocks || []).forEach(b => {
    children.push(h2(b.h2));
    (b.h3s || []).forEach(h => { children.push(h3(h.heading)); children.push(body(h.copy)); });
  });

  // FAQs
  children.push(h2('FAQs'));
  (pd.faqs || []).forEach((f, i) => {
    children.push(h3(`Q${i + 1}. ${f.question}`));
    children.push(body(f.answer));
  });

  const footer = new Footer({
    children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D8DEE4', space: 6 } },
      children: [run(`${brand}  |  ${ld.location_name} ${sd.service_name}`, { color: GREY, size: 16 }), run('\tPage ', { color: GREY, size: 16 }), new TextRun({ children: [PageNumber.CURRENT], color: GREY, size: 16 })],
    })],
  });

  const doc = new Document({
    styles: DOC_STYLES,
    sections: [{
      properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
      footers: { default: footer },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

// ── Gentle Dental ────────────────────────────────────────────────────────────
// The wizard's page_object shares none of the Neuro shape above (no
// service_data / location_data / page_data), so every exporter needs a dental
// counterpart rather than a conditional threaded through the Neuro ones.
// A dental page is recognised by its sections.hero block.
function isDentalPage(pageObject) {
  return !!(pageObject && pageObject.sections && pageObject.sections.hero);
}

// The educational body is stored as HTML fragments. Both exporters need it as
// structured text, so unwrap the handful of tags the writer is allowed to emit
// (<p>, <ul>/<ol>/<li>, <h3>) into typed lines and let each format render them.
function htmlToLines(html) {
  const out = [];
  const clean = (s) => String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
  const re = /<(h3|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const textValue = clean(m[2]);
    if (textValue) out.push({ type: m[1].toLowerCase(), text: textValue });
  }
  // A fragment with no recognised tags at all still has to export its copy.
  if (!out.length) {
    const bare = clean(html);
    if (bare) out.push({ type: 'p', text: bare });
  }
  return out;
}

function toDentalMarkdown(pageObject) {
  const m = pageObject.meta || {};
  const s = pageObject.sections || {};
  const L = [];
  const list = (arr) => (arr || []).map((x) => `- ${typeof x === 'string' ? x : x.keyword}`).join('\n') || '- (none)';

  L.push(`# ${s.hero?.h1 || ''}`);
  L.push(`<!-- page_url: ${m.urlPath || ''} -->\n`);
  // The wizard folds a SECOND primary into secondaryKeywords so the writer
  // weaves it in without holding it to the strict structural gates. That is
  // right for generation but wrong to print: the deliverable would list the
  // same keyword under both headings. Show each keyword once, as Primary.
  const primaries = pageObject.primaryKeywords || [pageObject.primaryKeyword].filter(Boolean);
  const primaryKeys = new Set(primaries.map((k) => String(typeof k === 'string' ? k : k.keyword).toLowerCase()));
  const secondaries = (pageObject.secondaryKeywords || [])
    .filter((k) => !primaryKeys.has(String(typeof k === 'string' ? k : k.keyword).toLowerCase()));
  L.push(`## Primary Keywords\n${list(primaries)}`);
  L.push(`## Secondary Keywords\n${list(secondaries)}\n`);
  L.push(`## Meta Title\n${m.title || ''}`);
  L.push(`## Meta Description\n${m.metaDescription || ''}`);
  L.push(`## Canonical\n${m.canonical || ''}\n`);
  L.push(`## Hero Intro\n${s.hero?.intro || ''}`);

  (s.educationalBody?.blocks || []).forEach((b) => {
    L.push(`## ${b.h2}`);
    htmlToLines(b.html).forEach((ln) => {
      if (ln.type === 'h3') L.push(`### ${ln.text}`);
      else if (ln.type === 'li') L.push(`- ${ln.text}`);
      else L.push(ln.text);
    });
  });

  L.push(`## ${s.faq?.heading || 'FAQs'}`);
  (s.faq?.items || []).forEach((f, i) => L.push(`### Q${i + 1}: ${f.q}\n${f.a}`));

  const links = s.servicesInCity?.internalLinks || [];
  L.push(`## Internal Links\n| Anchor | URL |\n|---|---|`);
  links.forEach((l) => L.push(`| ${l.anchor_text || l.label || ''} | ${l.url || ''} |`));

  L.push(`## Schema\n\`\`\`json\n${JSON.stringify(pageObject.schema || {}, null, 2)}\n\`\`\``);
  return L.join('\n\n');
}

async function toDentalDocxBuffer(pageObject) {
  const m = pageObject.meta || {};
  const s = pageObject.sections || {};
  const children = [];
  const run = (t, opts = {}) => new TextRun({ text: String(t || ''), size: 22, ...opts });
  const eyebrow = (t) => new Paragraph({ spacing: { after: 40 }, children: [run(t, { bold: true, color: TEAL, size: 17, characterSpacing: 30 })] });
  // Document furniture — the labels that organise the DELIVERABLE ("SEO
  // Metadata", "Page Content", "Hero"). Deliberately NOT Word headings: they
  // are not part of the page, and styling them as headings would put them in
  // the same outline as the page's own H2s and paste into a CMS as content.
  const section = (t) => new Paragraph({
    spacing: { before: 320, after: 120 },
    border: headingRule,
    children: [run(t, { bold: true, color: TEAL, size: 26 })],
  });
  const label = (t, color = '111827') => new Paragraph({ spacing: { before: 160, after: 40 }, children: [run(t, { bold: true, color })] });
  const body = (t) => new Paragraph({ spacing: { after: 80 }, children: [run(t)] });
  const bullet = (t) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 20 }, children: [run(t)] });

  children.push(eyebrow('SEO PAGE CONTENT'));
  // The document's title IS the page's H1, so it is exported as Heading 1
  // rather than repeated further down as a second copy of the same string.
  children.push(h1(s.hero?.h1 || ''));
  children.push(new Paragraph({ spacing: { after: 60 }, children: [run('Page URL:  ', { bold: true, color: GREY, size: 18 }), run(m.urlPath || '', { color: GREY, size: 18 })] }));

  children.push(section('SEO Metadata'));
  children.push(label('Meta Title')); children.push(body(m.title));
  children.push(label('Meta Description')); children.push(body(m.metaDescription));
  children.push(label('H1')); children.push(body(s.hero?.h1));

  children.push(section('Page Content'));
  children.push(label('Hero'));
  children.push(body(s.hero?.intro));

  (s.educationalBody?.blocks || []).forEach((b) => {
    children.push(h2(b.h2));
    htmlToLines(b.html).forEach((ln) => {
      if (ln.type === 'h3') children.push(h3(ln.text));
      else if (ln.type === 'li') children.push(bullet(ln.text));
      else children.push(body(ln.text));
    });
  });

  // The FAQ heading is an H2 on the page and each question an H3 under it.
  children.push(h2(s.faq?.heading || 'FAQs'));
  (s.faq?.items || []).forEach((f, i) => {
    children.push(h3(`Q${i + 1}. ${f.q}`));
    children.push(body(f.a));
  });

  const footer = new Footer({
    children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D8DEE4', space: 6 } },
      children: [run(`${m.brandName || 'Gentle Dental'}  |  ${s.hero?.h1 || ''}`, { color: GREY, size: 16 }), run('\tPage ', { color: GREY, size: 16 }), new TextRun({ children: [PageNumber.CURRENT], color: GREY, size: 16 })],
    })],
  });

  const doc = new Document({
    styles: DOC_STYLES,
    sections: [{
      properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
      footers: { default: footer },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

// ── CBH → CMS JSON (the client's ingest format) ─────────────────────────────
// A DIFFERENT shape from the page object, not a dump of it. The CMS names some
// blocks differently from the way this module names its sections, and the two
// do not line up one to one -- confirmed with the client:
//
//   CMS `treatment`  <- our SERVICE section   ("<Service> in <Location>")
//   CMS `experts`    <- our TREATMENT section (the clinicians one)
//
// Where a CMS value disagrees with what the page generates -- a question mark
// the page's H2 does not carry, a heading the CMS wants title-cased and with
// the city appended -- it is adapted HERE, not fixed in the generator. That was
// the client's call, and it means nothing already written has to be
// regenerated to export cleanly.

const contract = require('./cbhContract');

// Every heading the CMS receives is sentence case -- the client's rule.
//
// It CANNOT be done by lowercasing everything after the first word. "Treatment"
// and "Anaheim" are the same shape, and one has to come down while the other
// must not; a blunt pass produces "adhd treatment in anaheim hills". So nothing
// is lowered unless it is known not to be a name. Three things are protected:
//
//   1. anything already all-caps ("ADHD", "OCD", "PTSD", "IOP", "CA", "II"),
//   2. the pronoun "I", which is all-caps but only one letter, and
//   3. the proper nouns we actually hold for this page -- the brand, the city,
//      the state, the location's own name and nearby areas, and whichever words
//      of the service name the CLIENT capitalised.
//
// The service name matters most here: its display phrase is deliberately
// lower-cased apart from acronyms ("ADHD treatment", "anxiety treatment"), so
// taking the capitalised words from it protects "ADHD" and correctly leaves
// "treatment" free to come down.
function protectedTermsFor(page, location) {
  const keep = new Set();
  // Only the words someone capitalised on purpose. A lowercase word in a name
  // we hold is a lowercase word in the heading too.
  const addCapitalised = (value) => String(value || '').split(/\s+/).forEach((w) => {
    const bare = w.replace(/[^A-Za-z0-9&'-]/g, '');
    if (bare && /^[A-Z]/.test(bare)) keep.add(bare.toLowerCase());
  });
  addCapitalised(contract.BRAND);
  addCapitalised(page?.serviceName);
  addCapitalised(page?.locationName);
  addCapitalised(location?.city);
  addCapitalised(location?.state);
  addCapitalised(location?.state_abbreviation);
  addCapitalised(location?.location_name);
  (location?.nearby_areas || []).forEach(addCapitalised);
  return keep;
}

function sentenceCase(text, keep = new Set()) {
  const s = String(text || '').trim();
  if (!s) return '';
  let seenWord = false;
  // Split KEEPING the separators, so spacing and punctuation survive untouched.
  return s.split(/(\s+)/).map((tok) => {
    if (!tok.trim()) return tok;
    const bare = tok.replace(/[^A-Za-z0-9&'-]/g, '');
    const isFirst = !seenWord;
    seenWord = true;
    if (!bare) return tok;
    const protectedWord = /^[A-Z0-9&'-]{2,}$/.test(bare)   // ADHD, OCD, II, CA
      || bare === 'I'                                      // the pronoun
      || keep.has(bare.toLowerCase());                     // a name we hold
    if (protectedWord) return tok;
    const lowered = tok.toLowerCase();
    // Capitalise the first LETTER, not the first character: "(stress" must not
    // be left alone because it opens with a bracket.
    return isFirst ? lowered.replace(/[a-z]/, ch => ch.toUpperCase()) : lowered;
  }).join('');
}

// Built from the service and city rather than the page's own H2, because the
// CMS wants the city appended and the page's heading does not carry it.
function approachHeadingFor(page) {
  const svc = String(page.serviceName || '').trim();
  const city = String(page.locationName || '').trim();
  if (!svc) return page.sections?.approach?.heading || '';
  return city ? `Our approach to ${svc} in ${city}` : `Our approach to ${svc}`;
}

// The CMS writes this one as a question; the page's H2 deliberately does not
// (confirmed with the client when the contract was built).
function asQuestion(heading) {
  const s = String(heading || '').trim();
  if (!s) return '';
  return s.endsWith('?') ? s : `${s}?`;
}

// And this one the other way round: the page's H2 is "Why Choose Clear
// Behavioral Health?", the CMS wants it without the mark.
function withoutQuestion(heading) {
  return String(heading || '').trim().replace(/\?+$/, '');
}

// PROVISIONAL. The client's sample slug ("mental-health-treatment-teens-santa-
// clarita") matches none of the 14 stored locations, whose slugs are plain
// ("santa-clarita", "gardena-residential"), and they are sending the rule
// separately. Until then this exports what the location record actually holds,
// which is the honest reading of "use the location slug provided".
//
// Everything about that decision lives in this one function on purpose: when
// the rule arrives, this is the only thing that changes.
function locationSlugFor(location, page) {
  return String(location?.location_slug || '').trim()
    || String(page?.locationName || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Which of the CMS's two buckets a service falls in. Derived from the service
// record's own groups rather than a hand-kept list, so a service added to the
// taxonomy is classified without editing code. Approved with the client:
// anything carrying an addiction-* group is "addiction", everything else --
// including the teen services, which carry only a `teen` group -- is
// "mental_health".
function serviceTypeFor(service) {
  const groups = Array.isArray(service?.groups) ? service.groups : [];
  return groups.some(g => String(g).startsWith('addiction-')) ? 'addiction' : 'mental_health';
}

const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Paragraph array -> one <p> per paragraph.
function paragraphsToHtml(paragraphs = []) {
  return (paragraphs || [])
    .map(p => String(p || '').trim())
    .filter(Boolean)
    .map(p => `<p>${escapeHtml(p)}</p>`)
    .join('');
}

// An educational body -> HTML. The bodies mix prose and bullets, so consecutive
// bullets become ONE <ul> rather than a list per item or a flattened paragraph.
// The bullet marker is stripped: it was a costing signal for the line budget,
// not something a reader should see inside an <li>.
function linesToHtml(lines = []) {
  const out = [];
  let list = [];
  const flush = () => {
    if (list.length) { out.push(`<ul>${list.map(li => `<li>${escapeHtml(li)}</li>`).join('')}</ul>`); list = []; }
  };
  (lines || []).forEach((raw) => {
    const s = String(raw || '').trim();
    if (!s) return;
    if (contract.isBullet(s)) {
      list.push(s.replace(new RegExp(contract.LIMITS.educational.bulletPattern), '').trim());
    } else {
      flush();
      out.push(`<p>${escapeHtml(s)}</p>`);
    }
  });
  flush();
  return out.join('');
}

// Paragraph array -> one plain string, for the CMS fields that are not HTML.
function joinParagraphs(paragraphs = []) {
  return (paragraphs || []).map(p => String(p || '').trim()).filter(Boolean).join(' ');
}

// `service` and `location` are the reference rows; the slugs, and the
// mental_health/addiction split, live on them rather than on the page.
function toCbhCmsJson(pageObject, { service, location } = {}) {
  const s = pageObject.sections || {};
  const m = pageObject.meta || {};

  // Every heading is sentence-cased here, at the edge -- the page keeps its own
  // casing, per the client's "transform on export" call. `seo.title` is NOT a
  // heading: it is the <title> tag, it is read in a SERP rather than on the
  // page, and it ships as the SEO team wrote it.
  const keep = protectedTermsFor(pageObject, location);
  const sc = (text) => sentenceCase(text, keep);

  return {
    location_slug: locationSlugFor(location, pageObject),
    // The PAGE's slug, not the service record's: it is editable per page, and
    // the record's value is only ever the seed for it.
    service_slug: String(m.serviceSlug || service?.slug || '').trim(),
    // The CMS sample sets this to "<Service> in <Location>" -- the Service H2 --
    // even though its comment says "use same as H1", and the same sample's H1
    // is a longer line. The VALUE is what the CMS ingests, so the value wins.
    page_title: sc(s.service?.heading),
    service_type: serviceTypeFor(service),

    seo: {
      // The shipping title, brand suffix included.
      title: m.fullTitle || contract.fullTitle(m.title || ''),
      description: m.metaDescription || '',
    },

    banner: {
      heading: sc(s.hero?.h1),
      description: s.hero?.description || '',
    },

    insurance: {
      description: s.insurance?.paragraph || '',
    },

    jump_menu: {
      service_label: sc(asQuestion(s.educational?.heading)),
    },

    approach: {
      heading: sc(approachHeadingFor(pageObject)),
      intro: joinParagraphs(s.approach?.paragraphs),
      items: [
        { heading: sc(s.approach?.philosophy?.heading), content: joinParagraphs(s.approach?.philosophy?.paragraphs) },
        { heading: sc(s.approach?.therapies?.heading), content: joinParagraphs(s.approach?.therapies?.paragraphs) },
      ],
    },

    what_is: {
      heading: sc(asQuestion(s.educational?.heading)),
      content: paragraphsToHtml(s.educational?.paragraphs),
    },

    tabs: (s.educational?.h3s || []).map(h => ({
      title: sc(h.heading),
      content: linesToHtml(h.lines),
    })),

    why_choose: {
      heading: sc(withoutQuestion(s.uvp?.heading)),
      description: s.uvp?.paragraph || '',
    },

    // Our SERVICE section. The CMS calls it treatment; the heading is already
    // "<Service> in <Location>", which is what its sample shows.
    treatment: {
      heading: sc(s.service?.heading),
      description: s.service?.paragraph || '',
    },

    // Our TREATMENT section -- the clinicians one.
    experts: {
      heading: sc(s.treatment?.heading),
      description: s.treatment?.paragraph || '',
    },

    faqs: (s.faq?.items || []).map(f => ({
      question: sc(f.q),
      // Plain text, unlike what_is and tabs. The client's sample is explicit
      // about the difference.
      answer: f.a || '',
    })),
  };
}

function safeFilename(pageObject) {
  if (isDentalPage(pageObject) || isCbhPage(pageObject)) {
    // "/dental-offices/ma/boston/implants" -> "ma_boston_implants"
    const parts = String(pageObject.meta?.urlPath || '').split('/').filter(Boolean).slice(1);
    return (parts.join('_') || 'location_service_page').replace(/[^a-z0-9_-]/gi, '_');
  }
  const sd = pageObject.service_data, ld = pageObject.location_data;
  return `${sd.service_slug}_${ld.location_slug}`.replace(/[^a-z0-9_-]/gi, '_');
}


// ── Clear Behavioral Health ─────────────────────────────────────────────────
// The CBH contract shares no section with either shape above: nine named
// sections, one nesting 4-5 H3s whose bodies are LINES rather than HTML, and a
// per-section provenance tag the guidelines require to be stated.
//
// That tag is the reason this is a separate exporter rather than a branch. The
// deliverable has to show, next to each educational subsection, whether it was
// modelled on competitor research or written from an authoritative source --
// and for the latter, which source. On the page itself it never appears.

function isCbhPage(pageObject) {
  return !!(pageObject && pageObject.sections
    && pageObject.sections.educational && pageObject.sections.uvp);
}

function cbhProvenanceLabel(h3) {
  if (h3.source === 'competitor') return 'Competitor-driven';
  if (h3.source === 'fallback') return h3.sourceUrl ? `Fallback — ${h3.sourceUrl}` : 'Fallback — NO SOURCE';
  return 'Source not stated';
}

function toCbhMarkdown(pageObject) {
  const m = pageObject.meta || {};
  const s = pageObject.sections || {};
  const L = [];
  L.push(`# ${s.hero?.h1 || ''}`);
  L.push(`Page URL: ${m.urlPath || ''}`);
  L.push(`## Meta Title\n${m.fullTitle || m.title || ''}`);
  L.push(`## Meta Description\n${m.metaDescription || ''}`);
  L.push(`## Hero\n${s.hero?.description || ''}`);

  const paras = (arr) => (arr || []).join('\n\n');
  L.push(`## ${s.approach?.heading || 'Approach'}\n${paras(s.approach?.paragraphs)}`);
  L.push(`### ${s.approach?.philosophy?.heading || ''}\n${paras(s.approach?.philosophy?.paragraphs)}`);
  L.push(`### ${s.approach?.therapies?.heading || ''}\n${paras(s.approach?.therapies?.paragraphs)}`);
  L.push(`## ${s.insurance?.heading || ''}\n${s.insurance?.paragraph || ''}`);

  L.push(`## ${s.educational?.heading || ''}\n${paras(s.educational?.paragraphs)}`);
  (s.educational?.h3s || []).forEach((h) => {
    L.push(`### ${h.heading}\n_${cbhProvenanceLabel(h)}_`);
    (h.lines || []).forEach(line => L.push(line));
  });

  L.push(`## ${s.uvp?.heading || ''}\n${s.uvp?.paragraph || ''}`);
  L.push(`## ${s.service?.heading || ''}\n${s.service?.paragraph || ''}`);
  L.push(`## ${s.treatment?.heading || ''}\n${s.treatment?.paragraph || ''}`);
  L.push(`## ${s.faq?.heading || 'FAQs'}`);
  (s.faq?.items || []).forEach((f, i) => L.push(`### Q${i + 1}: ${f.q}\n_[${f.type || 'untyped'}]_\n${f.a}`));
  L.push(`## Schema\n\`\`\`json\n${JSON.stringify(pageObject.schema || {}, null, 2)}\n\`\`\``);
  return L.join('\n\n');
}

async function toCbhDocxBuffer(pageObject) {
  const m = pageObject.meta || {};
  const s = pageObject.sections || {};
  const children = [];
  const run = (t, opts = {}) => new TextRun({ text: String(t || ''), size: 22, ...opts });
  const eyebrow = (t) => new Paragraph({ spacing: { after: 40 }, children: [run(t, { bold: true, color: TEAL, size: 17, characterSpacing: 30 })] });
  const section = (t) => new Paragraph({
    spacing: { before: 320, after: 120 }, border: headingRule,
    children: [run(t, { bold: true, color: TEAL, size: 26 })],
  });
  const label = (t) => new Paragraph({ spacing: { before: 160, after: 40 }, children: [run(t, { bold: true })] });
  const body = (t) => new Paragraph({ spacing: { after: 80 }, children: [run(t)] });
  const note = (t) => new Paragraph({ spacing: { after: 60 }, children: [run(t, { color: GREY, size: 17, italics: true })] });
  const paras = (arr) => (arr || []).filter(Boolean).forEach(pp => children.push(body(pp)));

  children.push(eyebrow('SEO PAGE CONTENT'));
  children.push(h1(s.hero?.h1 || ''));
  children.push(new Paragraph({ spacing: { after: 60 }, children: [run('Page URL:  ', { bold: true, color: GREY, size: 18 }), run(m.urlPath || '', { color: GREY, size: 18 })] }));

  children.push(section('SEO Metadata'));
  // The shipped tag, since that is what appears in the SERP -- and separately
  // the counted part, because the 50-60 window excludes the brand suffix and a
  // reviewer checking the number needs to see what it was measured on.
  children.push(label('Meta Title (as it ships)')); children.push(body(m.fullTitle || m.title));
  children.push(label('Meta Title (counted, excluding brand)')); children.push(body(m.title));
  children.push(label('Meta Description')); children.push(body(m.metaDescription));

  children.push(section('Hero'));
  children.push(label('H1')); children.push(body(s.hero?.h1));
  children.push(label('Description')); children.push(body(s.hero?.description));

  children.push(section('Page Content'));
  children.push(h2(s.approach?.heading || ''));
  paras(s.approach?.paragraphs);
  children.push(h3(s.approach?.philosophy?.heading || ''));
  paras(s.approach?.philosophy?.paragraphs);
  children.push(h3(s.approach?.therapies?.heading || ''));
  paras(s.approach?.therapies?.paragraphs);

  children.push(h2(s.insurance?.heading || ''));
  children.push(body(s.insurance?.paragraph));

  children.push(h2(s.educational?.heading || ''));
  paras(s.educational?.paragraphs);
  (s.educational?.h3s || []).forEach((h) => {
    children.push(h3(h.heading || ''));
    // Required by the guidelines: every educational section states whether it
    // is competitor-driven or fallback-based, and a fallback names its source.
    children.push(note(cbhProvenanceLabel(h)));
    // The guidelines require a paragraph break after every third line and
    // charge a line for it. Render it, so the docx shows the grouping the
    // budget paid for instead of an undifferentiated run of paragraphs.
    //
    // Counted in LINES, not entries: a bullet is worth two, so breaking every
    // third entry would put the break somewhere the budget never charged for.
    // No break after the last line -- a trailing one separates nothing.
    //
    // This will not always place exactly as many breaks as the budget charged.
    // breaksFor counts on a flat line total and so can land a break inside a
    // wrapped entry; a document can only break BETWEEN entries. The budget is
    // the rule, this is the nearest honest rendering of it.
    const breakEvery = cbhContract.LIMITS.educational.linesBeforeBreak;
    const lines = (h.lines || []).filter(Boolean);
    let since = 0;
    lines.forEach((line, n) => {
      children.push(body(line));
      since += cbhContract.lineCount(line);
      if (since >= breakEvery && n < lines.length - 1) {
        children.push(body(''));
        since = 0;
      }
    });
  });

  children.push(h2(s.uvp?.heading || ''));
  children.push(body(s.uvp?.paragraph));
  children.push(h2(s.service?.heading || ''));
  children.push(body(s.service?.paragraph));
  children.push(h2(s.treatment?.heading || ''));
  children.push(body(s.treatment?.paragraph));

  children.push(h2(s.faq?.heading || 'Frequently Asked Questions'));
  (s.faq?.items || []).forEach((f, i) => {
    children.push(label(`Q${i + 1}. ${f.q}`));
    children.push(note(`[${f.type || 'untyped'}]`));
    children.push(body(f.a));
  });

  const footer = new Footer({
    children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D8DEE4', space: 6 } },
      children: [
        run(`${m.brandName || ''}  |  ${pageObject.locationName || ''} ${pageObject.serviceName || ''}`, { color: GREY, size: 16 }),
        run('\tPage ', { color: GREY, size: 16 }),
        new TextRun({ children: [PageNumber.CURRENT], color: GREY, size: 16 }),
      ],
    })],
  });

  const doc = new Document({
    styles: DOC_STYLES,
    sections: [{
      properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
      footers: { default: footer },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

module.exports = {
  toJSON, toMarkdown, toDocxBuffer, safeFilename,
  isDentalPage, toDentalMarkdown, toDentalDocxBuffer, htmlToLines,
  isCbhPage, toCbhMarkdown, toCbhDocxBuffer, cbhProvenanceLabel,
  toCbhCmsJson, serviceTypeFor, linesToHtml, sentenceCase, protectedTermsFor,
};
