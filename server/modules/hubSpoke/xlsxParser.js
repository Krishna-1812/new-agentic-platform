const ExcelJS = require('exceljs');

// Extract plain text from an ExcelJS cell (handles rich text, numbers, strings)
function cellText(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return String(v);
  if (v && typeof v === 'object') {
    if (v.richText) return v.richText.map(rt => rt.text || '').join('').trim();
    if (v.result !== undefined) return String(v.result).trim(); // formula cell
    if (v.text !== undefined) return String(v.text).trim();
    if (v.hyperlink) return v.hyperlink; // hyperlink cell — use href
  }
  return String(v).trim();
}

const LOCATION_RE = /\([A-Z][a-zA-Z\s.,'-]{2,}\)$/;

function classifyRow(row) {
  const hubNum = cellText(row.getCell(1));
  const spokeNum = cellText(row.getCell(2));
  const theme = cellText(row.getCell(3));
  const title = cellText(row.getCell(4));
  const url = cellText(row.getCell(5));
  const statusRaw = cellText(row.getCell(6));

  const hasHubNum = /^\d+$/.test(hubNum);
  const hasSpokeNum = /^\d+$/.test(spokeNum);
  const titleIsHub = title.toUpperCase().startsWith('HUB:');

  if (hasHubNum && !hasSpokeNum && titleIsHub) {
    return { type: 'hub', hubNum: parseInt(hubNum, 10), theme, title, url, statusRaw };
  }
  if (!hasHubNum && hasSpokeNum) {
    return { type: 'spoke', spokeNum: parseInt(spokeNum, 10), theme, title, url };
  }
  if (hasHubNum && !hasSpokeNum && !titleIsHub) {
    // Hub row but title doesn't start with "HUB:" — still treat as hub, flag it
    return { type: 'hub', hubNum: parseInt(hubNum, 10), theme, title, url, statusRaw, flagged: true };
  }
  return { type: 'unknown', hubNum, spokeNum, theme, title, url, statusRaw };
}

function hubStatus(rawValue) {
  const v = (rawValue || '').trim().toLowerCase();
  if (v === 'exists') return 'exists';
  if (v.includes('gap')) return 'gap';
  if (v === '') return 'unknown';
  return 'other';
}

function pageTypeFromTitle(title) {
  return LOCATION_RE.test(title) ? 'location-article' : 'article';
}

// ── Main parser ───────────────────────────────────────────────────────────────

async function parseXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const ws = wb.worksheets[0];
  if (!ws) throw new Error('No worksheets found in the uploaded file.');

  const clusters = [];
  const flaggedRows = [];
  let currentCluster = null;
  const urlIndex = {}; // url → [clusterIdx, ...]

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // Skip header-like rows (first row if it looks like a header)
    const firstCell = cellText(row.getCell(1)).toLowerCase();
    if (rowNumber === 1 && (firstCell === 'hub #' || firstCell === 'hub#' || firstCell === '' || firstCell === 'hub')) {
      const urlCell = cellText(row.getCell(5)).toLowerCase();
      if (!urlCell.startsWith('http')) return; // skip header row
    }

    const classified = classifyRow(row);

    if (classified.type === 'hub') {
      if (!classified.url && !classified.theme) return; // completely empty
      currentCluster = {
        id: null, // assigned after parse
        name: classified.theme || classified.title.replace(/^HUB:\s*/i, '').trim(),
        hubPage: {
          url: classified.url,
          title: classified.title.replace(/^HUB:\s*/i, '').trim(),
          hubStatus: hubStatus(classified.statusRaw),
          rawStatus: classified.statusRaw,
        },
        spokes: [],
        confidenceScore: 100,
        notes: '',
      };
      if (classified.flagged) {
        flaggedRows.push({ rowNumber, reason: 'Hub row detected without "HUB:" title prefix', data: classified });
      }
      clusters.push(currentCluster);

      if (classified.url) {
        if (!urlIndex[classified.url]) urlIndex[classified.url] = [];
        urlIndex[classified.url].push({ clusterIdx: clusters.length - 1, role: 'hub' });
      }
    } else if (classified.type === 'spoke') {
      if (!classified.url) {
        flaggedRows.push({ rowNumber, reason: 'Spoke row has no URL', data: classified });
        return;
      }

      // Attempt to attach to cluster by theme name match (handles theme column populated on spoke rows)
      if (!currentCluster && classified.theme) {
        const match = clusters.find(c => c.name.toLowerCase() === classified.theme.toLowerCase());
        if (match) currentCluster = match;
      }

      if (!currentCluster) {
        flaggedRows.push({ rowNumber, reason: 'Spoke row encountered before any hub row', data: classified });
        return;
      }

      const spoke = {
        url: classified.url,
        title: classified.title,
        pageType: pageTypeFromTitle(classified.title),
        spokeNumber: classified.spokeNum,
        isPrimaryCluster: true,
        confidenceScore: 90,
        notes: '',
      };

      currentCluster.spokes.push(spoke);

      if (!urlIndex[classified.url]) urlIndex[classified.url] = [];
      urlIndex[classified.url].push({ clusterIdx: clusters.length - 1, role: 'spoke' });
    } else {
      if (classified.url || classified.title) {
        flaggedRows.push({ rowNumber, reason: 'Row could not be classified as hub or spoke', data: classified });
      }
    }
  });

  if (clusters.length === 0) {
    throw new Error('No hub or spoke rows were found. Verify the file matches the expected format: Hub # in column A, Spoke # in column B, Theme in column C, Title in column D, URL in column E.');
  }

  // Detect dual-cluster spokes
  const dualClusterSpokes = [];
  for (const [url, entries] of Object.entries(urlIndex)) {
    const spokeEntries = entries.filter(e => e.role === 'spoke');
    if (spokeEntries.length > 1) {
      // Mark subsequent appearances as secondary
      spokeEntries.forEach((entry, i) => {
        const cluster = clusters[entry.clusterIdx];
        const spoke = cluster.spokes.find(s => s.url === url);
        if (spoke) spoke.isPrimaryCluster = (i === 0);
      });
      dualClusterSpokes.push({
        url,
        clusters: spokeEntries.map(e => clusters[e.clusterIdx].name),
      });
    }
  }

  // Detect orphan hubs (hub with no spokes)
  const orphanHubs = clusters.filter(c => c.spokes.length === 0).map(c => c.name);

  // Count GAP hubs
  const gapHubs = clusters
    .filter(c => c.hubPage.hubStatus === 'gap')
    .map(c => ({ name: c.name, url: c.hubPage.url }));

  // Count location articles
  const locationArticleCount = clusters.reduce((sum, c) =>
    sum + c.spokes.filter(s => s.pageType === 'location-article').length, 0);

  // Total unique URLs
  const allUrls = new Set();
  clusters.forEach(c => {
    if (c.hubPage.url) allUrls.add(c.hubPage.url);
    c.spokes.forEach(s => allUrls.add(s.url));
  });

  return {
    clusters,
    flaggedRows,
    dualClusterSpokes,
    orphanHubs,
    gapHubs,
    summary: {
      clusterCount: clusters.length,
      uniqueUrlCount: allUrls.size,
      spokeCount: clusters.reduce((s, c) => s + c.spokes.length, 0),
      dualClusterSpokeCount: dualClusterSpokes.length,
      gapHubCount: gapHubs.length,
      locationArticleCount,
      flaggedRowCount: flaggedRows.length,
    },
  };
}

module.exports = { parseXlsx };
