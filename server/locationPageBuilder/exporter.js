// ── Export: JSON / Markdown / DOCX (Spec §11) ───────────────────────────────
// JSON = canonical layered Page Object (the dev contract). Markdown per the
// spec template. DOCX via the `docx` lib already used by the app's export route.

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, ShadingType, VerticalAlign,
  BorderStyle, AlignmentType, Footer, PageNumber, TabStopType,
} = require('docx');

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

function safeFilename(pageObject) {
  if (isDentalPage(pageObject)) {
    // "/dental-offices/ma/boston/implants" -> "ma_boston_implants"
    const parts = String(pageObject.meta?.urlPath || '').split('/').filter(Boolean).slice(1);
    return (parts.join('_') || 'gentle_dental_page').replace(/[^a-z0-9_-]/gi, '_');
  }
  const sd = pageObject.service_data, ld = pageObject.location_data;
  return `${sd.service_slug}_${ld.location_slug}`.replace(/[^a-z0-9_-]/gi, '_');
}

module.exports = {
  toJSON, toMarkdown, toDocxBuffer, safeFilename,
  isDentalPage, toDentalMarkdown, toDentalDocxBuffer, htmlToLines,
};
