const PptxGenJS = require('pptxgenjs');

// ── Brand constants ───────────────────────────────────────────────────────────
const C = {
  red:     'D3342E',
  navy:    '245E9E',
  dark:    '161616',
  cello:   '38495B',
  white:   'FFFFFF',
  light:   'F5F5F5',
  border:  'E0E0E0',
  muted:   'C4C4C4',
  text:    '161616',
  subtext: '6B7280',
};
const FONT = 'Arial'; // Poppins not available server-side; Arial is a reliable fallback

// ── Helpers ───────────────────────────────────────────────────────────────────

function addCopyright(slide) {
  slide.addText('© Position², 2025', {
    x: 0.3, y: 7.0, w: 4, h: 0.3,
    fontSize: 10, color: C.muted, fontFace: FONT,
  });
}

function addBrandMark(slide) {
  slide.addText('p²', {
    x: 12.5, y: 0.15, w: 0.7, h: 0.4,
    fontSize: 14, bold: true, color: C.red, fontFace: FONT, align: 'right',
  });
}

function addRedAccent(slide, x, y, w, h) {
  slide.addShape('roundRect', {
    x, y, w, h,
    fill: { color: C.red },
    line: { color: C.red, width: 0 },
    rectRadius: 0.03,
  });
}

// ── Slide templates ───────────────────────────────────────────────────────────

function addTitleSlide(pptx, brandName) {
  const slide = pptx.addSlide();
  slide.background = { color: C.dark };

  // Decorative circles
  slide.addShape('ellipse', { x: 10.5, y: -0.5, w: 2.2, h: 2.2, fill: { color: C.red, transparency: 70 } });
  slide.addShape('ellipse', { x: 11.2, y: 0.3, w: 1.6, h: 1.6, fill: { color: C.red, transparency: 50 } });
  slide.addShape('ellipse', { x: 11.8, y: 0.9, w: 1.0, h: 1.0, fill: { color: C.red, transparency: 30 } });

  slide.addText(brandName, {
    x: 0.8, y: 2.5, w: 9, h: 1.0,
    fontSize: 40, bold: true, color: C.white, fontFace: FONT,
  });
  slide.addText('Competitor Analysis', {
    x: 0.8, y: 3.6, w: 9, h: 0.7,
    fontSize: 26, color: C.muted, fontFace: FONT,
  });
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  slide.addText(dateStr, {
    x: 0.8, y: 4.5, w: 4, h: 0.4,
    fontSize: 14, color: C.subtext, fontFace: FONT,
  });
  addCopyright(slide);
}

function addTOCSlide(pptx, sections) {
  const slide = pptx.addSlide();
  slide.background = { color: C.dark };
  addBrandMark(slide);
  slide.addText('Table of Contents', {
    x: 0.8, y: 0.5, w: 10, h: 0.7,
    fontSize: 28, bold: true, color: C.white, fontFace: FONT,
  });
  const items = sections.map((s, i) => `${String(i + 1).padStart(2, '0')}   ${s}`).join('\n');
  slide.addText(items, {
    x: 0.8, y: 1.4, w: 11, h: 5.5,
    fontSize: 16, color: C.muted, fontFace: FONT, valign: 'top',
    lineSpacingMultiple: 1.6,
  });
  addCopyright(slide);
}

function addSectionDivider(pptx, title) {
  const slide = pptx.addSlide();
  slide.background = { color: C.cello };

  slide.addShape('roundRect', {
    x: 0.5, y: 2.5, w: 0.12, h: 2.5,
    fill: { color: C.red },
    line: { color: C.red, width: 0 },
    rectRadius: 0.06,
  });
  slide.addText(title, {
    x: 0.9, y: 2.8, w: 11, h: 1.4,
    fontSize: 36, bold: true, color: C.white, fontFace: FONT,
  });
  addCopyright(slide);
}

function addContentSlide(pptx, title, buildFn) {
  const slide = pptx.addSlide();
  slide.background = { color: C.white };
  addBrandMark(slide);

  slide.addText(title, {
    x: 0.5, y: 0.3, w: 11.5, h: 0.65,
    fontSize: 24, bold: true, color: C.text, fontFace: FONT,
  });
  addRedAccent(slide, 0.5, 1.0, 2.0, 0.055);

  if (buildFn) buildFn(slide, pptx);
  addCopyright(slide);
  return slide;
}

function addTable(slide, headers, rows, clientDomain) {
  if (!headers || !rows || !rows.length) {
    slide.addText('No data available.', { x: 0.5, y: 1.3, w: 12, h: 0.5, fontSize: 14, color: C.subtext, fontFace: FONT });
    return;
  }

  const tableRows = [];

  // Header row
  tableRows.push(headers.map(h => ({
    text: h,
    options: {
      bold: true, color: C.white,
      fill: { color: C.navy },
      fontSize: 12, fontFace: FONT,
      align: 'center', valign: 'middle',
    },
  })));

  // Data rows
  rows.forEach((row, i) => {
    const isClient = clientDomain && String(row[0]).includes(clientDomain);
    const isEven = i % 2 === 0;
    tableRows.push(row.map((cell, ci) => ({
      text: String(cell ?? ''),
      options: {
        bold: isClient,
        color: isClient ? C.white : C.text,
        fill: { color: isClient ? C.red : (isEven ? C.light : C.white) },
        fontSize: 11, fontFace: FONT,
        align: ci === 0 ? 'left' : 'center',
        valign: 'middle',
      },
    })));
  });

  const rowH = Math.min(0.5, 5.5 / (tableRows.length));
  slide.addTable(tableRows, {
    x: 0.5, y: 1.2, w: 12.3, h: Math.min(5.8, rowH * tableRows.length),
    rowH,
    border: { type: 'solid', color: C.border, pt: 0.5 },
  });
}

function addObsRecsSlide(pptx, sectionTitle, obsRecsText) {
  const slide = pptx.addSlide();
  slide.background = { color: C.white };
  addBrandMark(slide);

  slide.addText('Observations & Recommendations', {
    x: 0.5, y: 0.3, w: 11.5, h: 0.65,
    fontSize: 24, bold: true, color: C.text, fontFace: FONT,
  });
  addRedAccent(slide, 0.5, 1.0, 3.0, 0.055);

  const lines = (obsRecsText || '').split('\n').filter(l => l.trim());
  const observations = lines.filter(l => l.startsWith('•')).join('\n');
  const recommendations = lines.filter(l => l.startsWith('→')).join('\n');

  // Observation card
  slide.addShape('roundRect', {
    x: 0.5, y: 1.2, w: 5.8, h: 5.5,
    fill: { color: C.light }, line: { color: C.border, width: 1 }, rectRadius: 0.1,
  });
  slide.addText('Observations', {
    x: 0.7, y: 1.35, w: 5.4, h: 0.4,
    fontSize: 16, bold: true, color: C.navy, fontFace: FONT,
  });
  slide.addText(observations || '• No observations generated.', {
    x: 0.7, y: 1.85, w: 5.4, h: 4.6,
    fontSize: 13, color: C.text, fontFace: FONT, valign: 'top', wrap: true,
    lineSpacingMultiple: 1.5,
  });

  // Recommendation card
  slide.addShape('roundRect', {
    x: 6.8, y: 1.2, w: 5.8, h: 5.5,
    fill: { color: 'FFF5F5' }, line: { color: C.red, width: 1.5 }, rectRadius: 0.1,
  });
  slide.addText('Recommendations', {
    x: 7.0, y: 1.35, w: 5.4, h: 0.4,
    fontSize: 16, bold: true, color: C.red, fontFace: FONT,
  });
  slide.addText(recommendations || '→ No recommendations generated.', {
    x: 7.0, y: 1.85, w: 5.4, h: 4.6,
    fontSize: 13, color: C.text, fontFace: FONT, valign: 'top', wrap: true,
    lineSpacingMultiple: 1.5,
  });

  addCopyright(slide);
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(n, fallback = 'N/A') {
  if (n === null || n === undefined || n === '') return fallback;
  if (typeof n === 'number') return n.toLocaleString();
  return String(n);
}

// ── Main generator ────────────────────────────────────────────────────────────

async function generatePptx(reportData) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Position²';
  pptx.company = 'Position²';

  const {
    brandName = 'Brand',
    clientDomain = '',
    competitors = [],
    sections = {},
    gptDrafts = {},
    executiveSummary = '',
    includeGbp = true, // default preserves the exact prior output for every existing caller
  } = reportData;

  const allDomains = [clientDomain, ...competitors.map(c => c.domain)].filter(Boolean);

  // ── Slide 1: Cover ──────────────────────────────────────────────────────────
  addTitleSlide(pptx, brandName);

  // ── Slide 2: TOC ────────────────────────────────────────────────────────────
  addTOCSlide(pptx, [
    'Overall Performance Metrics',
    'Page Speed Analysis',
    'Keyword Ranking Comparison',
    'Keyword Gap Analysis',
    'Off-Page & Backlink Analysis',
    'AI Overview Visibility',
    'Content Analysis',
    ...(includeGbp ? ['GBP / Local Pack'] : []),
  ]);

  // ── Overall Performance ─────────────────────────────────────────────────────
  addSectionDivider(pptx, 'Overall Analysis');

  const overallData = sections.overallMetrics || [];
  addContentSlide(pptx, 'Overall Performance Metrics', (slide) => {
    const headers = ['Domain', 'Auth Score', 'Org. Traffic', 'Keywords', 'Backlinks', 'Ref. Domains', 'AIO Keywords'];
    const rows = allDomains.map(domain => {
      const d = overallData.find(o => o.domain === domain) || {};
      return [
        domain,
        fmt(d.authorityScore),
        fmt(d.organicTraffic),
        fmt(d.organicKeywords),
        fmt(d.backlinks),
        fmt(d.referringDomains),
        fmt(d.aiOverviewKeywords),
      ];
    });
    addTable(slide, headers, rows, clientDomain);
  });

  if (gptDrafts.overallMetrics) addObsRecsSlide(pptx, 'Overall Analysis', gptDrafts.overallMetrics);

  // ── Page Speed ──────────────────────────────────────────────────────────────
  addSectionDivider(pptx, 'Page Speed Score Comparison');

  const psData = sections.pageSpeed || [];
  addContentSlide(pptx, 'Page Speed Score Comparison', (slide) => {
    const headers = ['Domain', 'Mobile Score', 'Desktop Score', 'LCP (mobile)', 'CLS (mobile)', 'TTFB (mobile)', 'Core Web Vitals'];
    const rows = allDomains.map(domain => {
      const d = psData.find(o => o.domain === domain) || {};
      const m = d.mobile || {};
      const dt = d.desktop || {};
      return [
        domain,
        m.score !== null ? `${m.score}/100` : 'N/A',
        dt.score !== null ? `${dt.score}/100` : 'N/A',
        m.lcp || 'N/A',
        m.cls || 'N/A',
        m.ttfb || 'N/A',
        d.coreWebVitalsPassed ? 'Pass' : 'Fail',
      ];
    });
    addTable(slide, headers, rows, clientDomain);
  });

  if (gptDrafts.pageSpeed) addObsRecsSlide(pptx, 'Page Speed', gptDrafts.pageSpeed);

  // ── Keyword Ranking ─────────────────────────────────────────────────────────
  addSectionDivider(pptx, 'Keyword Ranking Comparison');

  const kwData = sections.keywordRanking || [];
  addContentSlide(pptx, 'Keywords by Page Distribution', (slide) => {
    const headers = ['Domain', 'Page 1 (1–10)', 'Page 2 (11–20)', 'Pages 3–5 (21–50)', 'Total Organic'];
    const rows = allDomains.map(domain => {
      const d = kwData.find(o => o.domain === domain) || {};
      return [domain, fmt(d.page1), fmt(d.page2), fmt(d.page3to5), fmt(d.totalOrganic)];
    });
    addTable(slide, headers, rows, clientDomain);
  });

  addContentSlide(pptx, 'Branded vs. Non-Branded Split', (slide) => {
    const headers = ['Domain', 'Total Keywords', 'Branded', 'Non-Branded', 'Non-Branded %'];
    const rows = allDomains.map(domain => {
      const d = kwData.find(o => o.domain === domain) || {};
      return [
        domain,
        fmt(d.totalOrganic),
        fmt(d.branded),
        fmt(d.nonBranded),
        d.nonBrandedPct !== undefined ? `${d.nonBrandedPct}%` : 'N/A',
      ];
    });
    addTable(slide, headers, rows, clientDomain);
  });

  if (gptDrafts.keywordRanking) addObsRecsSlide(pptx, 'Keyword Ranking', gptDrafts.keywordRanking);

  // ── Keyword Gap ─────────────────────────────────────────────────────────────
  addSectionDivider(pptx, 'Keyword Gap Analysis');

  const gapData = sections.keywordGap || {};

  addContentSlide(pptx, 'Striking Distance Keywords (Pos 11–50)', (slide) => {
    const rows = (gapData.strikingDistance || []).slice(0, 15).map(k => [
      k.keyword, fmt(k.searchVolume), `#${k.clientPosition}`, `#${k.bestCompetitorPosition}`, k.bestCompetitorDomain,
    ]);
    addTable(slide, ['Keyword', 'Search Volume', 'Client Pos.', 'Best Competitor', 'Competitor Domain'], rows, null);
  });

  addContentSlide(pptx, 'Untapped Keywords (Competitor Top 10, Client Weak)', (slide) => {
    const rows = (gapData.untapped || []).slice(0, 15).map(k => [
      k.keyword, fmt(k.searchVolume), k.clientPosition ? `#${k.clientPosition}` : 'Not ranking', `#${k.bestCompetitorPosition}`, k.bestCompetitorDomain,
    ]);
    addTable(slide, ['Keyword', 'Search Volume', 'Client Pos.', 'Best Competitor', 'Competitor Domain'], rows, null);
  });

  addContentSlide(pptx, 'Missing Keywords (Competitor Top 10, Client Absent)', (slide) => {
    const rows = (gapData.missing || []).slice(0, 15).map(k => [
      k.keyword, fmt(k.searchVolume), 'Not ranking', `#${k.bestCompetitorPosition}`, k.bestCompetitorDomain,
    ]);
    addTable(slide, ['Keyword', 'Search Volume', 'Client Status', 'Best Competitor', 'Competitor Domain'], rows, null);
  });

  if (gptDrafts.keywordGap) addObsRecsSlide(pptx, 'Keyword Gap Analysis', gptDrafts.keywordGap);

  // ── Backlinks ───────────────────────────────────────────────────────────────
  addSectionDivider(pptx, 'Off-Page & Backlink Analysis');

  const blData = sections.backlinks || [];
  addContentSlide(pptx, 'Backlink Metrics Comparison', (slide) => {
    const headers = ['Domain', 'Auth Score', 'Total Backlinks', 'Ref. Domains', 'Follow', 'NoFollow'];
    const rows = allDomains.map(domain => {
      const d = blData.find(o => o.domain === domain) || {};
      return [domain, fmt(d.authorityScore), fmt(d.totalBacklinks), fmt(d.referringDomains), fmt(d.followLinks), fmt(d.nofollowLinks)];
    });
    addTable(slide, headers, rows, clientDomain);
  });

  addContentSlide(pptx, 'Referring Domain Quality (Authority Score Buckets)', (slide) => {
    const headers = ['Domain', '80+', '60–79', '40–59', '20–39', '0–19'];
    const rows = allDomains.map(domain => {
      const d = blData.find(o => o.domain === domain) || {};
      const b = d.buckets || {};
      return [domain, fmt(b['80+']), fmt(b['60-79']), fmt(b['40-59']), fmt(b['20-39']), fmt(b['0-19'])];
    });
    addTable(slide, headers, rows, clientDomain);
  });

  if (gptDrafts.backlinks) addObsRecsSlide(pptx, 'Backlinks', gptDrafts.backlinks);

  // ── AI Overview ─────────────────────────────────────────────────────────────
  addSectionDivider(pptx, 'AI Overview Visibility');

  const aioData = sections.aiOverview || [];
  addContentSlide(pptx, 'AI Overview Keyword Count', (slide) => {
    const headers = ['Domain', 'AIO Keywords'];
    const rows = allDomains.map(domain => {
      const d = aioData.find(o => o.domain === domain) || {};
      return [domain, fmt(d.count, '0')];
    });
    addTable(slide, headers, rows, clientDomain);
  });

  if (gptDrafts.aiOverview) addObsRecsSlide(pptx, 'AI Overview', gptDrafts.aiOverview);

  // ── Content Analysis ────────────────────────────────────────────────────────
  addSectionDivider(pptx, 'Content Analysis');

  const contentData = sections.contentAnalysis || [];
  addContentSlide(pptx, 'Top Pages by Organic Traffic', (slide) => {
    const allPages = allDomains.flatMap(domain => {
      const d = contentData.find(o => o.domain === domain) || {};
      return (d.topPages || []).slice(0, 3).map(p => [domain, p.url, fmt(p.traffic), fmt(p.keywords), p.type || 'Other']);
    });
    addTable(slide, ['Domain', 'URL', 'Est. Traffic', 'Keywords', 'Page Type'], allPages, clientDomain);
  });

  addContentSlide(pptx, 'Content Mix Summary', (slide) => {
    const headers = ['Domain', 'Blog / Info', 'Location', 'Service / Product', 'Other'];
    const rows = allDomains.map(domain => {
      const d = contentData.find(o => o.domain === domain) || {};
      const m = d.contentMix || {};
      return [
        domain,
        fmt(m['Blog / Informational'], '0'),
        fmt(m['Location Page'], '0'),
        fmt(m['Service / Product Page'], '0'),
        fmt(m['Other'], '0'),
      ];
    });
    addTable(slide, headers, rows, clientDomain);
  });

  if (gptDrafts.contentAnalysis) addObsRecsSlide(pptx, 'Content Analysis', gptDrafts.contentAnalysis);

  // ── GBP Placeholder ─────────────────────────────────────────────────────────
  if (includeGbp) {
    addSectionDivider(pptx, 'GBP / Local Pack');

    addContentSlide(pptx, 'GBP / Local Pack — Location 1', (slide) => {
      slide.addText('Screenshot placeholder — add GBP local pack screenshot here.', {
        x: 0.5, y: 2.5, w: 12, h: 1,
        fontSize: 16, color: C.subtext, fontFace: FONT, align: 'center',
        border: { type: 'dashed', color: C.border, pt: 1 },
      });
    });

    addContentSlide(pptx, 'GBP / Local Pack — Location 2', (slide) => {
      slide.addText('Screenshot placeholder — add GBP local pack screenshot here.', {
        x: 0.5, y: 2.5, w: 12, h: 1,
        fontSize: 16, color: C.subtext, fontFace: FONT, align: 'center',
        border: { type: 'dashed', color: C.border, pt: 1 },
      });
    });
  }

  // ── Closing ─────────────────────────────────────────────────────────────────
  const closing = pptx.addSlide();
  closing.background = { color: C.dark };
  closing.addShape('ellipse', { x: 10.5, y: -0.5, w: 2.2, h: 2.2, fill: { color: C.red, transparency: 70 } });
  closing.addText('Thank You', {
    x: 0.8, y: 2.8, w: 9, h: 1.0,
    fontSize: 40, bold: true, color: C.white, fontFace: FONT,
  });
  if (executiveSummary) {
    closing.addText(executiveSummary, {
      x: 0.8, y: 4.0, w: 10, h: 2.0,
      fontSize: 14, color: C.muted, fontFace: FONT, wrap: true,
    });
  }
  addCopyright(closing);

  // ── Export ──────────────────────────────────────────────────────────────────
  const result = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(result) ? result : Buffer.from(result);
}

module.exports = { generatePptx };
