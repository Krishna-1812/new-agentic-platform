import { useState } from 'react';

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

    let text = `CONTENT ANALYSIS REPORT: ${keyword.toUpperCase()}\n`;
    text += '='.repeat(60) + '\n\n';

    sections.forEach((section, i) => {
      text += `SECTION ${i + 1}: H2: ${section.h2}\n`;
      text += '-'.repeat(40) + '\n';
      text += `RECOMMENDATIONS:\n${section.recommendations || 'N/A'}\n\n`;
      text += `CONTENT:\n${section.content || 'N/A'}\n\n`;
    });

    text += '='.repeat(60) + '\n';
    text += `WORD COUNT BENCHMARK: ${wordCountBenchmark?.toLocaleString() || 'N/A'} words\n\n`;
    text += `SEMANTIC KEYWORDS:\n${(semanticKeywords || []).join(', ')}\n\n`;
    text += `CONTENT GAPS:\n${(contentGaps || []).map((g, i) => `${i + 1}. ${g}`).join('\n')}`;

    setCopying(true);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      // Fallback for browsers that block clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Export DOCX */}
      <button
        onClick={exportDocx}
        disabled={exporting}
        className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-sm hover:shadow"
        style={{ backgroundColor: '#1e3a5f' }}
        onMouseEnter={e => { if (!exporting) e.currentTarget.style.backgroundColor = '#2e5f8a'; }}
        onMouseLeave={e => { if (!exporting) e.currentTarget.style.backgroundColor = '#1e3a5f'; }}
      >
        {exporting ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Generating…
          </>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export as Word Doc (.docx)
          </>
        )}
      </button>

      {/* Copy to Clipboard */}
      <button
        onClick={copyToClipboard}
        disabled={copying}
        className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all border shadow-sm hover:shadow disabled:opacity-60 disabled:cursor-not-allowed"
        style={{
          backgroundColor: copied ? '#f0fdf4' : 'white',
          borderColor: copied ? '#22c55e' : '#d1d5db',
          color: copied ? '#15803d' : '#374151'
        }}
      >
        {copied ? (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Copied!
          </>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
            Copy to Clipboard
          </>
        )}
      </button>

      {exportError && (
        <span className="text-red-600 text-sm">⚠ {exportError}</span>
      )}
    </div>
  );
}
