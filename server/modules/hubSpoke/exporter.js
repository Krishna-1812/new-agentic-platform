const ExcelJS = require('exceljs');

const TEAL = 'FF3DAA8E';
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A2E' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };

function styleHeader(row) {
  row.eachCell(cell => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  row.height = 22;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const escape = v => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map(r => r.map(escape).join(',')).join('\r\n');
}

// Hub and Spoke document export
async function exportHubSpoke(clusters, format = 'xlsx') {
  const headers = [
    'Cluster Name', 'Hub URL', 'Hub Title', 'Hub Topic', 'Primary Keyword',
    'Search Intent', 'Business Priority', 'Hub Status',
    'Spoke URL', 'Spoke Title', 'Spoke Topic', 'Spoke Keyword',
    'Spoke Intent', 'Funnel Stage', 'Is Primary Cluster', 'Confidence Score', 'Notes',
  ];

  const rows = [];
  for (const cluster of clusters) {
    for (const spoke of (cluster.spokes || [])) {
      rows.push([
        cluster.clusterName || '',
        cluster.hubPage?.url || '',
        cluster.hubPage?.title || cluster.clusterName || '',
        cluster.primaryTopic || '',
        cluster.primaryKeyword || '',
        cluster.searchIntent || '',
        cluster.businessPriority || '',
        cluster.hubPage?.hubStatus || cluster.hubPage?.isGap ? 'gap' : 'exists',
        spoke.url || '',
        spoke.title || '',
        spoke.primaryTopic || spoke.inferredTopic || '',
        spoke.primaryKeyword || '',
        spoke.searchIntent || '',
        spoke.funnelStage || '',
        spoke.isPrimaryCluster ? 'Yes' : 'No',
        spoke.confidenceScore != null ? spoke.confidenceScore : '',
        spoke.notes || '',
      ]);
    }
    // If hub has no spokes, still emit hub row
    if (!cluster.spokes || cluster.spokes.length === 0) {
      rows.push([
        cluster.clusterName || '',
        cluster.hubPage?.url || '',
        cluster.hubPage?.title || cluster.clusterName || '',
        cluster.primaryTopic || '',
        cluster.primaryKeyword || '',
        cluster.searchIntent || '',
        cluster.businessPriority || '',
        cluster.hubPage?.hubStatus || cluster.hubPage?.isGap ? 'gap' : 'exists',
        '', '', '', '', '', '', '', '', '',
      ]);
    }
  }

  if (format === 'csv') {
    return Buffer.from(toCsv([headers, ...rows]), 'utf8');
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hub and Spoke');

  ws.columns = headers.map(h => ({ header: h, width: Math.max(h.length + 4, 18) }));
  styleHeader(ws.getRow(1));

  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    row.eachCell(cell => {
      cell.alignment = { vertical: 'top', wrapText: false };
      cell.font = { size: 10 };
    });
    if (i % 2 === 0) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
      });
    }
  });

  ws.getColumn(2).width = 40; // Hub URL
  ws.getColumn(9).width = 40; // Spoke URL

  return wb.xlsx.writeBuffer();
}

// Recommendations export
async function exportRecommendations(recs, format = 'xlsx') {
  const headers = [
    'Cluster', 'Source URL', 'Source Title', 'Target URL', 'Target Title',
    'Link Type', 'Anchor Text', 'Anchor Text Source', 'Existing Anchor Text For Target',
    'Existing Internal Link Count On Source', 'Placement', 'Suggested Context',
    'Relevance Score', 'Confidence', 'Priority', 'Reason', 'Warnings', 'Status',
  ];

  const rows = recs.map(r => [
    r.clusterName || '',
    r.sourceUrl || '',
    r.sourceTitle || '',
    r.targetUrl || '',
    r.targetTitle || '',
    r.linkType || '',
    r.editedAnchorText || r.recommendedAnchorText || '',
    r.anchorTextSource || '',
    r.existingAnchorTextForTarget || '',
    r.existingLinksOnSourcePage != null ? r.existingLinksOnSourcePage : '',
    r.editedPlacement || r.suggestedPlacement || '',
    r.suggestedContext || '',
    r.relevanceScore != null ? r.relevanceScore : '',
    r.confidenceScore != null ? r.confidenceScore : '',
    r.priority || '',
    r.reason || '',
    Array.isArray(r.anchorWarnings) ? r.anchorWarnings.join('; ') : '',
    r.status || 'pending',
  ]);

  if (format === 'csv') {
    return Buffer.from(toCsv([headers, ...rows]), 'utf8');
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Recommendations');

  ws.columns = headers.map(h => ({ header: h, width: Math.max(h.length + 4, 16) }));
  styleHeader(ws.getRow(1));

  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    row.eachCell(cell => {
      cell.alignment = { vertical: 'top', wrapText: false };
      cell.font = { size: 10 };
    });
    if (i % 2 === 0) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
      });
    }
  });

  ws.getColumn(2).width = 40;  // Source URL
  ws.getColumn(4).width = 40;  // Target URL
  ws.getColumn(8).width = 22;  // Anchor Text Source
  ws.getColumn(9).width = 30;  // Existing Anchor Text For Target
  ws.getColumn(12).width = 50; // Suggested Context

  return wb.xlsx.writeBuffer();
}

module.exports = { exportHubSpoke, exportRecommendations };
