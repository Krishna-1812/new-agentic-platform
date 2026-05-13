// Parses Semrush Organic Research > Positions CSV exports (UI download, not API).
// Handles semicolon and comma delimiters, UTF-8 BOM, quoted fields, and column
// name variations across different Semrush UI versions.

function splitLine(line, delimiter) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function normaliseHeader(h) {
  return (h || '').toLowerCase().replace(/[^a-z0-9 ()%]/g, '').trim();
}

function parseNum(str) {
  return parseInt((str || '').replace(/[,\s]/g, '')) || 0;
}

function parseOrganicCSV(text) {
  if (!text || typeof text !== 'string') return { error: 'Empty file.' };

  // Strip BOM and trim
  const clean = text.replace(/^﻿/, '').trim();
  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { error: 'File has fewer than 2 rows.' };

  // Auto-detect delimiter
  const headerLine = lines[0];
  const semiCount = (headerLine.match(/;/g) || []).length;
  const commaCount = (headerLine.match(/,/g) || []).length;
  const delimiter = semiCount >= commaCount ? ';' : ',';

  const headers = splitLine(headerLine, delimiter).map(normaliseHeader);

  function findCol(...names) {
    for (const name of names) {
      const idx = headers.indexOf(name.toLowerCase());
      if (idx !== -1) return idx;
    }
    return -1;
  }

  const kwIdx  = findCol('keyword', 'ph', 'keywords');
  const posIdx = findCol('position', 'pos', 'po', 'current position');
  const volIdx = findCol('search volume', 'volume', 'nq', 'avg monthly searches');
  const urlIdx = findCol('url', 'ur', 'landing page', 'landing url');
  const trfIdx = findCol('traffic', 'tr', 'organic traffic', 'estimated traffic');
  const srpIdx = findCol('serp features', 'fp', 'serp features keywords', 'serp feature');
  const cpcIdx = findCol('cpc usd', 'cpc', 'cp');

  if (kwIdx === -1) {
    return {
      error: 'Cannot find "Keyword" column. Please export from: Semrush → Domain Overview → Organic Research → Positions tab → Export.',
    };
  }
  if (posIdx === -1) {
    return {
      error: 'Cannot find "Position" column. Please export from: Semrush → Domain Overview → Organic Research → Positions tab → Export.',
    };
  }

  const keywords = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i], delimiter);
    const keyword = cols[kwIdx] || '';
    const position = parseInt(cols[posIdx]) || 0;
    if (!keyword || position <= 0) continue;

    keywords.push({
      keyword,
      position,
      volume: volIdx >= 0 ? parseNum(cols[volIdx]) : 0,
      url:    urlIdx >= 0 ? (cols[urlIdx] || '') : '',
      traffic: trfIdx >= 0 ? parseFloat((cols[trfIdx] || '').replace(/[,%\s]/g, '')) || 0 : 0,
      serpFeatures: srpIdx >= 0 ? (cols[srpIdx] || '') : '',
      cpc: cpcIdx >= 0 ? parseFloat(cols[cpcIdx]) || 0 : 0,
    });
  }

  if (!keywords.length) {
    return { error: 'No valid keyword rows found. Check the file is the Positions export, not a different report.' };
  }

  return keywords;
}

// Parses Semrush Backlink Analytics > Referring Domains CSV export.
// Returns summary metrics + per-domain rows for bucket analysis.
function parseReferringDomainsCSV(text) {
  if (!text || typeof text !== 'string') return { error: 'Empty file.' };

  const clean = text.replace(/^﻿/, '').trim();
  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { error: 'File has fewer than 2 rows.' };

  const headerLine = lines[0];
  const semiCount = (headerLine.match(/;/g) || []).length;
  const commaCount = (headerLine.match(/,/g) || []).length;
  const delimiter = semiCount >= commaCount ? ';' : ',';

  const headers = splitLine(headerLine, delimiter).map(normaliseHeader);

  function findCol(...names) {
    for (const name of names) {
      const idx = headers.indexOf(name.toLowerCase());
      if (idx !== -1) return idx;
    }
    return -1;
  }

  // Column name variations across Semrush UI versions
  const domIdx = findCol('domain', 'root domain', 'referring domain');
  const asIdx  = findCol('authority score', 'domain as', 'as', 'domain authority score');
  const blIdx  = findCol('backlinks', 'active backlinks', 'links');
  const flIdx  = findCol('follow', 'follow links', 'dofollow', 'dofollow links');
  const nfIdx  = findCol('nofollow', 'nofollow links', 'no follow', 'no-follow links');

  if (domIdx === -1) {
    return { error: 'Cannot find "Domain" column. Please export from: Semrush → Backlink Analytics → Referring Domains → Export.' };
  }

  const refdomains = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i], delimiter);
    const domain = cols[domIdx] || '';
    if (!domain) continue;
    refdomains.push({
      domain,
      ascore:    asIdx >= 0 ? parseNum(cols[asIdx]) : 0,
      backlinks: blIdx >= 0 ? parseNum(cols[blIdx]) : 0,
      follow:    flIdx >= 0 ? parseNum(cols[flIdx]) : 0,
      nofollow:  nfIdx >= 0 ? parseNum(cols[nfIdx]) : 0,
    });
  }

  if (!refdomains.length) {
    return { error: 'No referring domain rows found. Check this is the Referring Domains export.' };
  }

  const totalBacklinks    = refdomains.reduce((s, r) => s + r.backlinks, 0);
  const followLinks       = refdomains.reduce((s, r) => s + r.follow,    0);
  const nofollowLinks     = refdomains.reduce((s, r) => s + r.nofollow,  0);
  const referringDomains  = refdomains.length;

  const buckets = {
    '80+':   refdomains.filter(r => r.ascore >= 80).length,
    '60-79': refdomains.filter(r => r.ascore >= 60 && r.ascore < 80).length,
    '40-59': refdomains.filter(r => r.ascore >= 40 && r.ascore < 60).length,
    '20-39': refdomains.filter(r => r.ascore >= 20 && r.ascore < 40).length,
    '0-19':  refdomains.filter(r => r.ascore < 20).length,
  };

  return { referringDomains, totalBacklinks, followLinks, nofollowLinks, buckets, refdomains };
}

module.exports = { parseOrganicCSV, parseReferringDomainsCSV };
