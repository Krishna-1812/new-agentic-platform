// Renders the same reportData shape reportExport.js builds (previously fed
// to pptxGenerator.js) as an HTML document, then rasterizes it to PDF via a
// headless browser — same pattern as server/routes/agentReadinessAudit.js's
// PDF export (buildPdfHtml + puppeteer-core + @sparticuz/chromium), reused
// here for consistency rather than introducing a different document library.
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');

function findLocalBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    `C:\\Users\\${process.env.USERNAME}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

const C = {
  red: '#D3342E',
  navy: '#245E9E',
  dark: '#161616',
  border: '#E5E7EB',
  light: '#F5F5F5',
  text: '#161616',
  subtext: '#6B7280',
};

function fmt(n, fallback = 'N/A') {
  if (n === null || n === undefined || n === '') return fallback;
  if (typeof n === 'number') return n.toLocaleString();
  return String(n);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function table(headers, rows, clientDomain) {
  if (!rows || !rows.length) {
    return `<p style="color:${C.subtext};font-size:12px;margin:4px 0 18px;">No data available.</p>`;
  }
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows
    .map((row) => {
      const isClient = clientDomain && String(row[0]).includes(clientDomain);
      const cells = row
        .map((cell, i) => `<td style="text-align:${i === 0 ? 'left' : 'center'};">${escapeHtml(cell ?? 'N/A')}</td>`)
        .join('');
      return `<tr class="${isClient ? 'client-row' : ''}">${cells}</tr>`;
    })
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// gptAnalysisCA's Observations & Recommendations text convention: bullet
// lines start with "•", recommendation lines start with "→" — same
// convention pptxGenerator.js's addObsRecsSlide already parses.
function obsRecsBlock(text) {
  if (!text) return '';
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  const obs = lines.filter((l) => l.startsWith('•')).map((l) => l.replace(/^•\s*/, ''));
  const recs = lines.filter((l) => l.startsWith('→')).map((l) => l.replace(/^→\s*/, ''));
  if (!obs.length && !recs.length) return '';
  const obsHtml = (obs.length ? obs : ['No observations generated.']).map((l) => `<li>${escapeHtml(l)}</li>`).join('');
  const recsHtml = (recs.length ? recs : ['No recommendations generated.']).map((l) => `<li>${escapeHtml(l)}</li>`).join('');
  return `
  <div class="obsrecs">
    <div class="obs-col">
      <div class="obsrecs-label" style="color:${C.navy};">Observations</div>
      <ul>${obsHtml}</ul>
    </div>
    <div class="rec-col">
      <div class="obsrecs-label" style="color:${C.red};">Recommendations</div>
      <ul>${recsHtml}</ul>
    </div>
  </div>`;
}

function section(title, bodyHtml, obsRecsHtml) {
  return `
  <section class="section">
    <h2>${escapeHtml(title)}</h2>
    ${bodyHtml}
    ${obsRecsHtml || ''}
  </section>`;
}

function buildReportHtml(reportData) {
  const {
    brandName = 'Brand',
    clientDomain = '',
    competitors = [],
    sections = {},
    gptDrafts = {},
    executiveSummary = '',
  } = reportData;

  const allDomains = [clientDomain, ...competitors.map((c) => c.domain)].filter(Boolean);
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const overallData = sections.overallMetrics || [];
  const overallRows = allDomains.map((domain) => {
    const d = overallData.find((o) => o.domain === domain) || {};
    return [domain, fmt(d.authorityScore), fmt(d.organicTraffic), fmt(d.organicKeywords), fmt(d.backlinks), fmt(d.referringDomains), fmt(d.aiOverviewKeywords)];
  });

  const psData = sections.pageSpeed || [];
  const psRows = allDomains.map((domain) => {
    const d = psData.find((o) => o.domain === domain) || {};
    const m = d.mobile || {};
    const dt = d.desktop || {};
    return [domain, m.score != null ? `${m.score}/100` : 'N/A', dt.score != null ? `${dt.score}/100` : 'N/A', m.lcp || 'N/A', m.cls || 'N/A', m.ttfb || 'N/A', d.coreWebVitalsPassed ? 'Pass' : 'Fail'];
  });

  const kwData = sections.keywordRanking || [];
  const kwPageRows = allDomains.map((domain) => {
    const d = kwData.find((o) => o.domain === domain) || {};
    return [domain, fmt(d.page1), fmt(d.page2), fmt(d.page3to5), fmt(d.totalOrganic)];
  });

  const gapData = sections.keywordGap || {};
  const strikingRows = (gapData.strikingDistance || []).slice(0, 15).map((k) => [k.keyword, fmt(k.searchVolume), `#${k.clientPosition}`, `#${k.bestCompetitorPosition}`, k.bestCompetitorDomain]);
  const untappedRows = (gapData.untapped || []).slice(0, 15).map((k) => [k.keyword, fmt(k.searchVolume), k.clientPosition ? `#${k.clientPosition}` : 'Not ranking', `#${k.bestCompetitorPosition}`, k.bestCompetitorDomain]);
  const missingRows = (gapData.missing || []).slice(0, 15).map((k) => [k.keyword, fmt(k.searchVolume), 'Not ranking', `#${k.bestCompetitorPosition}`, k.bestCompetitorDomain]);

  const blData = sections.backlinks || [];
  const blRows = allDomains.map((domain) => {
    const d = blData.find((o) => o.domain === domain) || {};
    return [domain, fmt(d.authorityScore), fmt(d.totalBacklinks), fmt(d.referringDomains), fmt(d.followLinks), fmt(d.nofollowLinks)];
  });
  const blBucketRows = allDomains.map((domain) => {
    const d = blData.find((o) => o.domain === domain) || {};
    const b = d.buckets || {};
    return [domain, fmt(b['80+']), fmt(b['60-79']), fmt(b['40-59']), fmt(b['20-39']), fmt(b['0-19'])];
  });

  const aioData = sections.aiOverview || [];
  const aioRows = allDomains.map((domain) => {
    const d = aioData.find((o) => o.domain === domain) || {};
    return [domain, fmt(d.count, '0')];
  });

  const contentData = sections.contentAnalysis || [];
  const topPagesRows = allDomains.flatMap((domain) => {
    const d = contentData.find((o) => o.domain === domain) || {};
    return (d.topPages || []).slice(0, 3).map((p) => [domain, p.url, fmt(p.traffic), fmt(p.keywords), p.type || 'Other']);
  });
  const contentMixRows = allDomains.map((domain) => {
    const d = contentData.find((o) => o.domain === domain) || {};
    const m = d.contentMix || {};
    return [domain, fmt(m['Blog / Informational'], '0'), fmt(m['Location Page'], '0'), fmt(m['Service / Product Page'], '0'), fmt(m['Other'], '0')];
  });

  const execSummaryHtml = executiveSummary
    ? `
  <div class="exec-summary">
    <div class="exec-label">Executive Summary</div>
    <p>${escapeHtml(executiveSummary)}</p>
  </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; color: ${C.text}; font-size: 13px; padding: 36px 44px; }
  h1 { font-size: 26px; font-weight: 700; }
  h2 { font-size: 18px; font-weight: 700; color: ${C.dark}; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid ${C.red}; }
  h3 { font-size: 12px; font-weight: 600; color: ${C.subtext}; text-transform: uppercase; letter-spacing: 0.05em; margin: 16px 0 6px; }
  .section { margin-bottom: 30px; page-break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 11.5px; }
  th { background: ${C.navy}; color: #fff; text-align: center; padding: 7px 8px; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; }
  th:first-child { text-align: left; }
  td { padding: 6px 8px; border-bottom: 1px solid ${C.border}; }
  tr:nth-child(even) td { background: ${C.light}; }
  tr.client-row td { background: #FDEBEA; font-weight: 600; }
  .exec-summary { background: #EEEDFE; border-radius: 10px; padding: 16px 20px; margin: 20px 0 28px; }
  .exec-label { font-size: 10px; font-weight: 700; color: #534AB7; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
  .exec-summary p { font-size: 13px; line-height: 1.6; color: #111827; }
  .obsrecs { display: flex; gap: 16px; margin-top: 10px; }
  .obs-col, .rec-col { flex: 1; border-radius: 8px; padding: 12px 14px; }
  .obs-col { background: ${C.light}; border: 1px solid ${C.border}; }
  .rec-col { background: #FFF5F5; border: 1px solid ${C.red}; }
  .obsrecs-label { font-size: 12px; font-weight: 700; margin-bottom: 6px; }
  .obsrecs ul { padding-left: 16px; }
  .obsrecs li { font-size: 11.5px; line-height: 1.6; margin-bottom: 4px; color: ${C.text}; }
  .cover-header { padding-bottom: 18px; border-bottom: 3px solid ${C.dark}; margin-bottom: 4px; }
  .brand-mark { font-size: 12px; font-weight: 700; color: ${C.red}; text-transform: uppercase; letter-spacing: 0.06em; }
  .cover-meta { font-size: 12px; color: ${C.subtext}; margin-top: 4px; }
  .competitors-line { font-size: 11.5px; color: ${C.subtext}; margin: 6px 0 0; }
  footer { margin-top: 24px; padding-top: 14px; border-top: 1px solid ${C.border}; font-size: 10.5px; color: ${C.subtext}; }
</style>
</head>
<body>
  <div class="cover-header">
    <div class="brand-mark">Position² &nbsp;·&nbsp; Competitor Analysis Report</div>
    <h1>${escapeHtml(brandName)}</h1>
    <div class="cover-meta">${escapeHtml(clientDomain)} &nbsp;·&nbsp; ${dateStr}</div>
    <div class="competitors-line">Benchmarked against: ${competitors.map((c) => escapeHtml(c.domain)).join(', ') || '—'}</div>
  </div>

  ${execSummaryHtml}

  ${section(
    'Overall Performance Metrics',
    table(['Domain', 'Auth Score', 'Org. Traffic', 'Keywords', 'Backlinks', 'Ref. Domains', 'AIO Keywords'], overallRows, clientDomain),
    obsRecsBlock(gptDrafts.overallMetrics)
  )}

  ${section(
    'Page Speed Score Comparison',
    table(['Domain', 'Mobile Score', 'Desktop Score', 'LCP (mobile)', 'CLS (mobile)', 'TTFB (mobile)', 'Core Web Vitals'], psRows, clientDomain),
    obsRecsBlock(gptDrafts.pageSpeed)
  )}

  ${section(
    'Keyword Ranking Comparison',
    `<h3>Keywords by Page Distribution</h3>${table(['Domain', 'Page 1 (1–10)', 'Page 2 (11–20)', 'Pages 3–5 (21–50)', 'Total Organic'], kwPageRows, clientDomain)}`,
    obsRecsBlock(gptDrafts.keywordRanking)
  )}

  ${section(
    'Keyword Gap Analysis',
    `<h3>Striking Distance Keywords (Pos 11–50)</h3>${table(['Keyword', 'Search Volume', 'Client Pos.', 'Best Competitor', 'Competitor Domain'], strikingRows, null)}
     <h3>Untapped Keywords (Competitor Top 10, Client Weak)</h3>${table(['Keyword', 'Search Volume', 'Client Pos.', 'Best Competitor', 'Competitor Domain'], untappedRows, null)}
     <h3>Missing Keywords (Competitor Top 10, Client Absent)</h3>${table(['Keyword', 'Search Volume', 'Client Status', 'Best Competitor', 'Competitor Domain'], missingRows, null)}`,
    obsRecsBlock(gptDrafts.keywordGap)
  )}

  ${section(
    'Off-Page & Backlink Analysis',
    `<h3>Backlink Metrics Comparison</h3>${table(['Domain', 'Auth Score', 'Total Backlinks', 'Ref. Domains', 'Follow', 'NoFollow'], blRows, clientDomain)}
     <h3>Referring Domain Quality (Authority Score Buckets)</h3>${table(['Domain', '80+', '60–79', '40–59', '20–39', '0–19'], blBucketRows, clientDomain)}`,
    obsRecsBlock(gptDrafts.backlinks)
  )}

  ${section('AI Overview Visibility', table(['Domain', 'AIO Keywords'], aioRows, clientDomain), obsRecsBlock(gptDrafts.aiOverview))}

  ${section(
    'Content Analysis',
    `<h3>Top Pages by Organic Traffic</h3>${table(['Domain', 'URL', 'Est. Traffic', 'Keywords', 'Page Type'], topPagesRows, clientDomain)}
     <h3>Content Mix Summary</h3>${table(['Domain', 'Blog / Info', 'Location', 'Service / Product', 'Other'], contentMixRows, clientDomain)}`,
    obsRecsBlock(gptDrafts.contentAnalysis)
  )}

  <footer>Generated by Position² Competitor Analysis · ${dateStr}</footer>
</body>
</html>`;
}

async function generateReportPdf(reportData) {
  const localBrowser = findLocalBrowser();
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: localBrowser || (await chromium.executablePath()),
      headless: true,
      args: localBrowser ? ['--no-sandbox', '--disable-setuid-sandbox'] : chromium.args,
      defaultViewport: localBrowser ? { width: 1280, height: 800 } : chromium.defaultViewport,
    });
    const page = await browser.newPage();
    const html = buildReportHtml(reportData);
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' },
    });
    return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = { generateReportPdf, buildReportHtml };
