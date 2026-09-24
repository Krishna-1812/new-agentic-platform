// Parse Semrush semicolon-delimited CSV responses into arrays of objects.
function parseSemrushCSV(text) {
  if (!text || typeof text !== 'string') return [];
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('ERROR')) return [];

  const lines = trimmed.split('\n').filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(';').map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(';');
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (parts[idx] || '').trim();
    });
    rows.push(obj);
  }

  return rows;
}

// Check if a Semrush response is an error
function isSemrushError(text) {
  const t = (text || '').trim();
  return !t || t.startsWith('ERROR') || t.startsWith('error');
}

// Extract error message from Semrush response
function getSemrushError(text) {
  const t = (text || '').trim();
  if (t.startsWith('ERROR')) return t;
  return 'No data returned';
}

module.exports = { parseSemrushCSV, isSemrushError, getSemrushError };
