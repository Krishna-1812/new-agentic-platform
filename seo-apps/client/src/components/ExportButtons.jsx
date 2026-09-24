import { useState } from 'react';

const DownloadIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const CopyIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
);

const CheckIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const SpinnerIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 0.8s linear infinite' }}>
    <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeOpacity="0.25" />
    <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

export default function ExportButtons({ keyword, analysis }) {
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  async function exportDocx() {
    setExporting(true);
    setExportError('');
    try {
      const res = await fetch('/api/export/docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, analysis })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Export failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${keyword.replace(/[^a-zA-Z0-9]/g, '_')}_content_analysis.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  }

  async function copyToClipboard() {
    const { sections, wordCountBenchmark, semanticKeywords, contentGaps } = analysis;
    let text = `CONTENT ANALYSIS REPORT: ${keyword.toUpperCase()}\n${'='.repeat(60)}\n\n`;
    sections.forEach((section, i) => {
      text += `SECTION ${i + 1}: H2: ${section.h2}\n${'-'.repeat(40)}\n`;
      text += `RECOMMENDATIONS:\n${section.recommendations || 'N/A'}\n\n`;
      text += `CONTENT:\n${section.content || 'N/A'}\n\n`;
    });
    text += `${'='.repeat(60)}\nWORD COUNT BENCHMARK: ${wordCountBenchmark?.toLocaleString() || 'N/A'} words\n\n`;
    text += `SEMANTIC KEYWORDS:\n${(semanticKeywords || []).join(', ')}\n\n`;
    text += `CONTENT GAPS:\n${(contentGaps || []).map((g, i) => `${i + 1}. ${g}`).join('\n')}`;

    setCopying(true);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } finally {
      setCopying(false);
    }
  }

  const btnBase = {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '8px 18px', borderRadius: 'var(--r-md)',
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
    transition: 'all var(--dur-fast) var(--ease)',
    border: 'none', outline: 'none',
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
      {/* Export DOCX */}
      <button
        onClick={exportDocx}
        disabled={exporting}
        style={{
          ...btnBase,
          background: 'var(--primary)', color: '#fff',
          opacity: exporting ? 0.6 : 1,
          cursor: exporting ? 'not-allowed' : 'pointer',
        }}
      >
        {exporting ? <SpinnerIcon /> : <DownloadIcon />}
        {exporting ? 'Generating…' : 'Export as Word Doc (.docx)'}
      </button>

      {/* Copy to Clipboard */}
      <button
        onClick={copyToClipboard}
        disabled={copying}
        style={{
          ...btnBase,
          background: copied ? 'var(--success-soft)' : 'var(--card)',
          border: `1px solid ${copied ? 'var(--success)' : 'var(--border)'}`,
          color: copied ? 'var(--success)' : 'var(--text)',
          opacity: copying ? 0.6 : 1,
          cursor: copying ? 'not-allowed' : 'pointer',
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? 'Copied!' : 'Copy to Clipboard'}
      </button>

      {exportError && (
        <span style={{ color: 'var(--danger)', fontSize: 13 }}>⚠ {exportError}</span>
      )}
    </div>
  );
}
