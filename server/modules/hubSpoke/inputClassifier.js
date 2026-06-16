const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*/i;
const DOMAIN_RE = /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+\/\S*/;

function looksLikeUrl(str) {
  return URL_RE.test(str) || DOMAIN_RE.test(str);
}

// Classify plain text / CSV input
function classifyText(text) {
  const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { type: 'invalid', reason: 'Input is empty.' };

  // Check for tab/comma-separated structure
  const tabbedLines = lines.filter(l => l.includes('\t'));
  const csvLines = lines.filter(l => l.split(',').length >= 4);

  if (tabbedLines.length > lines.length * 0.5 || csvLines.length > lines.length * 0.5) {
    // Might be a hub-spoke document exported as CSV/TSV
    const cols = tabbedLines.length > csvLines.length
      ? tabbedLines[0].split('\t')
      : csvLines[0].split(',');

    const hasHubNum = cols.some(c => /^\d+$/.test(c.trim()));
    const hasHubPrefix = lines.some(l => l.toLowerCase().includes('hub:'));
    const hasUrls = lines.some(l => looksLikeUrl(l));

    if (hasHubNum && hasHubPrefix && hasUrls) {
      return { type: 'hub-and-spoke-complete', format: 'csv' };
    }
    if ((hasHubNum || hasHubPrefix) && hasUrls) {
      return { type: 'hub-and-spoke-partial', format: 'csv', reason: 'Partial hub/spoke structure detected in CSV.' };
    }
  }

  // Check for plain URL list
  const urlLines = lines.filter(looksLikeUrl);
  const urlRatio = urlLines.length / lines.length;

  if (urlRatio >= 0.8) {
    // Detect multiple domains
    const domains = new Set(urlLines.map(u => {
      try { return new URL(u.startsWith('http') ? u : 'https://' + u).hostname; } catch { return null; }
    }).filter(Boolean));
    const type = urlRatio === 1 ? 'url-list-only' : 'mixed';
    return { type, domains: [...domains], urlCount: urlLines.length };
  }

  if (urlLines.length > 0) {
    return { type: 'mixed', reason: 'Some lines look like URLs but others do not.', urlCount: urlLines.length };
  }

  return { type: 'invalid', reason: 'No URLs detected in the input.' };
}

// Quick-check an XLSX parse result to determine document type
function classifyParsedXlsx(parseResult) {
  if (!parseResult || !parseResult.clusters) return 'invalid';
  if (parseResult.clusters.length === 0) return 'invalid';
  if (parseResult.flaggedRows.length > parseResult.summary.spokeCount * 0.3) {
    return 'hub-and-spoke-partial';
  }
  return 'hub-and-spoke-complete';
}

// Extract unique URLs from plain text (URL list)
function extractUrls(text) {
  const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  const urls = [];
  const seen = new Set();
  for (const line of lines) {
    const url = line.split(/[\t,]/)[0].trim();
    if (!looksLikeUrl(url)) continue;
    const normalised = url.startsWith('http') ? url : 'https://' + url;
    try {
      new URL(normalised);
      if (!seen.has(normalised)) { seen.add(normalised); urls.push(normalised); }
    } catch {}
  }
  return urls;
}

module.exports = { classifyText, classifyParsedXlsx, extractUrls };
