import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { saveAs } from 'file-saver';

const STEPS = [
  { id: 'search',   label: 'Searching Google US',  icon: '🔍' },
  { id: 'scrape',   label: 'Scraping Pages',        icon: '📄' },
  { id: 'analysis', label: 'Analyzing Content',     icon: '🔬' },
  { id: 'brief',    label: 'Building Brief',         icon: '✍️' },
];

function StepBadge({ status }) {
  if (status === 'done') return (
    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-green-500 text-white text-xs font-bold">✓</span>
  );
  if (status === 'active') return (
    <span className="flex items-center justify-center w-7 h-7 rounded-full" style={{ backgroundColor: '#3DAA8E' }}>
      <svg className="animate-spin w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
      </svg>
    </span>
  );
  return <span className="flex items-center justify-center w-7 h-7 rounded-full bg-gray-200 text-gray-400 text-xs">·</span>;
}

// Renders inline markdown (bold, plain)
function InlineText({ text }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={i} className="font-semibold text-[#111827]">{part.slice(2, -2)}</strong>
          : <span key={i}>{part}</span>
      )}
    </>
  );
}

// Full markdown renderer with Visual Opportunity callout support
function BriefRenderer({ markdown }) {
  const lines = markdown.split('\n');
  const elements = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();

    if (!t) {
      elements.push(<div key={i} className="h-1" />);
      continue;
    }

    if (t.startsWith('# ')) {
      elements.push(
        <h1 key={i} className="text-2xl font-bold text-[#111827] mt-2 mb-5 pb-3 border-b-2" style={{ borderColor: '#3DAA8E' }}>
          {t.slice(2)}
        </h1>
      );
    } else if (t.startsWith('## ')) {
      elements.push(
        <h2 key={i} className="text-lg font-bold text-[#111827] mt-7 mb-2 pt-2">
          <span className="inline-block w-1 h-5 rounded mr-2 align-middle" style={{ backgroundColor: '#3DAA8E' }} />
          {t.slice(3)}
        </h2>
      );
    } else if (t.startsWith('### ')) {
      elements.push(
        <h3 key={i} className="text-sm font-bold text-[#374151] mt-4 mb-1.5 ml-3">
          {t.slice(4)}
        </h3>
      );
    } else if (t.startsWith('#### ')) {
      elements.push(
        <h4 key={i} className="text-sm font-semibold text-[#6B7280] mt-3 mb-1 ml-5">
          {t.slice(5)}
        </h4>
      );
    } else if (/^\*\*\[Visual Opportunity/i.test(t)) {
      // Amber callout box
      const inner = t.replace(/^\*\*\[/, '').replace(/\]\*\*$/, '').replace(/^\*\*/, '').replace(/\*\*$/, '');
      const desc = inner.replace(/^Visual Opportunity:\s*/i, '');
      elements.push(
        <div key={i} className="my-3 ml-3 flex gap-3 px-4 py-3 rounded-lg border border-amber-200"
          style={{ backgroundColor: '#FFFBEB' }}>
          <span className="text-base flex-shrink-0 mt-0.5">💡</span>
          <div>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#D97706' }}>Visual Opportunity</span>
            <p className="text-sm mt-0.5 leading-relaxed" style={{ color: '#92400E' }}>{desc}</p>
          </div>
        </div>
      );
    } else if (/^---+$/.test(t)) {
      elements.push(<hr key={i} className="my-5 border-[#E5E7EB]" />);
    } else if (t.startsWith('- ') || t.startsWith('* ')) {
      elements.push(
        <div key={i} className="flex gap-2 text-sm text-[#374151] my-0.5 ml-4">
          <span className="flex-shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#3DAA8E' }} />
          <span><InlineText text={t.slice(2)} /></span>
        </div>
      );
    } else {
      elements.push(
        <p key={i} className="text-sm text-[#374151] my-1 ml-1 leading-relaxed">
          <InlineText text={t} />
        </p>
      );
    }
  }

  return <div>{elements}</div>;
}

// Client-side .docx generator from markdown
async function downloadDocx(keyword, markdown) {
  const lines = markdown.split('\n');
  const children = [];

  for (const raw of lines) {
    const t = raw.trim();
    if (!t) {
      children.push(new Paragraph({ text: '' }));
      continue;
    }
    if (t.startsWith('# ')) {
      children.push(new Paragraph({ text: t.slice(2), heading: HeadingLevel.HEADING_1 }));
    } else if (t.startsWith('## ')) {
      children.push(new Paragraph({ text: t.slice(3), heading: HeadingLevel.HEADING_2 }));
    } else if (t.startsWith('### ')) {
      children.push(new Paragraph({ text: t.slice(4), heading: HeadingLevel.HEADING_3 }));
    } else if (/^\*\*\[Visual Opportunity/i.test(t)) {
      const desc = t.replace(/^\*\*\[/, '').replace(/\]\*\*$/, '').replace(/^\*\*/, '').replace(/\*\*$/, '');
      children.push(new Paragraph({
        children: [new TextRun({ text: `💡 ${desc}`, bold: true, color: 'D97706', size: 20 })],
        shading: { fill: 'FFFBEB', type: 'clear', color: 'auto' },
        indent: { left: 400 },
      }));
    } else if (/^---+$/.test(t)) {
      children.push(new Paragraph({ text: '' }));
    } else if (t.startsWith('- ') || t.startsWith('* ')) {
      const text = t.slice(2).replace(/\*\*([^*]+)\*\*/g, '$1');
      children.push(new Paragraph({ text, bullet: { level: 0 } }));
    } else {
      const isBoldLine = t.startsWith('**') && t.endsWith('**');
      const text = t.replace(/\*\*([^*]+)\*\*/g, '$1');
      children.push(new Paragraph({ children: [new TextRun({ text, bold: isBoldLine, size: 20 })] }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const filename = `${keyword.replace(/[^a-zA-Z0-9]/g, '_')}_content_brief.docx`;
  saveAs(blob, filename);
}

export default function ArticleRecommendationPage() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [steps, setSteps] = useState({});
  const [urls, setUrls] = useState([]);
  const [scrapeProgress, setScrapeProgress] = useState([]);
  const [warning, setWarning] = useState('');
  const [result, setResult] = useState(null);   // { brief, sourceUrls }
  const [error, setError] = useState('');
  const [showUrls, setShowUrls] = useState(false);
  const [copying, setCopying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const esRef = useRef(null);

  function reset() {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setStarted(false);
    setRunning(false);
    setSteps({});
    setUrls([]);
    setScrapeProgress([]);
    setWarning('');
    setResult(null);
    setError('');
    setShowUrls(false);
  }

  async function startGeneration() {
    if (!keyword.trim() || running) return;
    reset();
    setStarted(true);
    setRunning(true);

    try {
      const initRes = await fetch('/api/article-recommendation/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ keyword: keyword.trim() })
      });
      if (!initRes.ok) {
        const err = await initRes.json();
        throw new Error(err.error || 'Failed to start');
      }
      const { token } = await initRes.json();

      const es = new EventSource(`/api/article-recommendation/stream/${token}`);
      esRef.current = es;

      es.addEventListener('step', e => {
        const d = JSON.parse(e.data);
        setSteps(prev => ({ ...prev, [d.id]: { status: d.status, message: d.message } }));
      });

      es.addEventListener('urls', e => {
        setUrls(JSON.parse(e.data).urls);
      });

      es.addEventListener('scrape_progress', e => {
        const d = JSON.parse(e.data);
        setScrapeProgress(prev => {
          const next = [...prev];
          next[d.index] = { url: d.url, status: d.status, error: d.error };
          return next;
        });
      });

      es.addEventListener('warning', e => {
        setWarning(JSON.parse(e.data).message);
      });

      es.addEventListener('result', e => {
        setResult(JSON.parse(e.data));
      });

      es.addEventListener('fail', e => {
        setError(JSON.parse(e.data).message);
      });

      es.addEventListener('done', () => {
        es.close();
        esRef.current = null;
        setRunning(false);
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        setRunning(false);
        setError(prev => prev || 'Connection lost. Please try again.');
      };

    } catch (err) {
      setError(err.message);
      setRunning(false);
    }
  }

  async function copyBrief() {
    if (!result?.brief) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(result.brief);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = result.brief;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setTimeout(() => setCopying(false), 1500);
  }

  async function handleDownloadDocx() {
    if (!result?.brief) return;
    setDownloading(true);
    try {
      await downloadDocx(keyword, result.brief);
    } catch (err) {
      console.error('docx error', err);
    }
    setDownloading(false);
  }

  const canStart = keyword.trim() && !running;
  const scrapeStep = steps['scrape'];
  const scrapeLabel = STEPS.find(s => s.id === 'scrape')?.label;

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F4F5F7' }}>
      {/* Header */}
      <header className="bg-white border-b border-[#E5E7EB] h-14 flex items-center px-6">
        <div className="max-w-5xl mx-auto w-full flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-[#6B7280] hover:text-[#111827] text-sm font-medium transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            All tools
          </button>
          <span className="text-[#E5E7EB]">/</span>
          <span className="text-sm font-semibold text-[#111827]">Article Recommendation</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-7 space-y-5">

        {/* ── Input Card ───────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-6" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          <div className="max-w-md">
            <label className="block text-sm font-semibold text-[#111827] mb-1.5">Primary Keyword</label>
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canStart && startGeneration()}
              placeholder="e.g. dental implants"
              disabled={running}
              className="w-full px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 disabled:bg-[#F4F5F7] disabled:text-[#9CA3AF]"
              style={{ '--tw-ring-color': '#3DAA8E' }}
            />
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={startGeneration}
              disabled={!canStart}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#111827' }}
            >
              {running ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Generating…
                </>
              ) : 'Generate Recommendations'}
            </button>
            {started && !running && (
              <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-700 underline">
                Reset
              </button>
            )}
          </div>
        </div>

        {/* ── Error ────────────────────────────────────────────────────── */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
            <span className="text-red-500 mt-0.5 flex-shrink-0">✕</span>
            <div className="flex-1">
              <p className="text-red-800 text-sm font-medium">{error}</p>
            </div>
            <button
              onClick={startGeneration}
              disabled={!keyword.trim()}
              className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50"
              style={{ backgroundColor: '#111827' }}
            >
              Retry
            </button>
          </div>
        )}

        {/* ── Warning ──────────────────────────────────────────────────── */}
        {warning && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
            <span style={{ color: '#D97706' }} className="mt-0.5 flex-shrink-0">⚠</span>
            <p className="text-sm" style={{ color: '#92400E' }}>{warning}</p>
          </div>
        )}

        {/* ── Progress Steps ───────────────────────────────────────────── */}
        {started && (
          <div className="space-y-3">
            {STEPS.map((stepCfg) => {
              const s = steps[stepCfg.id] || {};
              return (
                <div
                  key={stepCfg.id}
                  className={`bg-white rounded-xl border overflow-hidden transition-all ${
                    s.status === 'active' ? 'border-[#3DAA8E]' : 'border-[#E5E7EB]'
                  }`}
                  style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}
                >
                  <div className={`flex items-center gap-3 px-5 py-3.5 ${s.status === 'active' ? 'bg-[#F0FAF7]' : 'bg-[#F9FAFB]'}`}>
                    <StepBadge status={s.status} />
                    <span className="text-base">{stepCfg.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-gray-800">{stepCfg.label}</span>
                        {s.status === 'active' && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium animate-pulse" style={{ backgroundColor: '#3DAA8E1A', color: '#3DAA8E' }}>
                            In progress
                          </span>
                        )}
                        {s.status === 'done' && (
                          <span className="text-xs bg-[#F4F5F7] text-[#6B7280] px-2 py-0.5 rounded-full font-medium">Done</span>
                        )}
                      </div>
                      {s.message && <p className="text-xs text-gray-500 mt-0.5">{s.message}</p>}
                    </div>
                  </div>

                  {/* Search — show URL list */}
                  {stepCfg.id === 'search' && s.status === 'done' && urls.length > 0 && (
                    <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-2">
                      {urls.map((u, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs text-[#6B7280]">
                          <span className="w-5 h-5 rounded-full text-white text-xs flex items-center justify-center font-bold flex-shrink-0" style={{ backgroundColor: '#3DAA8E' }}>
                            {idx + 1}
                          </span>
                          <span className="truncate">{u.displayUrl || new URL(u.url).hostname}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Scrape — per-URL status */}
                  {stepCfg.id === 'scrape' && (s.status === 'active' || s.status === 'done') && scrapeProgress.length > 0 && (
                    <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-1.5">
                      {scrapeProgress.map((p, idx) => p ? (
                        <div key={idx} className="flex items-center gap-2 text-xs">
                          {p.status === 'done' ? (
                            <span className="text-green-500 font-bold flex-shrink-0">✓</span>
                          ) : p.status === 'error' ? (
                            <span className="text-red-400 flex-shrink-0">✕</span>
                          ) : (
                            <svg className="animate-spin w-3 h-3 flex-shrink-0" style={{ color: '#3DAA8E' }} viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                            </svg>
                          )}
                          <span className={`truncate ${p.status === 'error' ? 'text-red-400' : 'text-[#6B7280]'}`}>
                            {(() => { try { return new URL(p.url).hostname; } catch { return p.url; } })()}
                          </span>
                        </div>
                      ) : null)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Result ───────────────────────────────────────────────────── */}
        {result && (
          <div className="space-y-4">
            {/* Action bar */}
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#111827]">Content Brief</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={copyBrief}
                  className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg border border-[#E5E7EB] bg-white text-[#374151] hover:bg-[#F9FAFB] transition-colors"
                >
                  {copying ? (
                    <><span className="text-green-500">✓</span> Copied!</>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy Brief
                    </>
                  )}
                </button>
                <button
                  onClick={handleDownloadDocx}
                  disabled={downloading}
                  className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg text-white transition-all disabled:opacity-60"
                  style={{ backgroundColor: '#111827' }}
                >
                  {downloading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Exporting…
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                      Download .docx
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Brief content */}
            <div className="bg-white rounded-xl border border-[#E5E7EB] px-8 py-7" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
              <BriefRenderer markdown={result.brief} />
            </div>

            {/* Reference URLs collapsible */}
            {result.sourceUrls?.length > 0 && (
              <div className="bg-white rounded-xl border border-[#E5E7EB]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                <button
                  onClick={() => setShowUrls(v => !v)}
                  className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-[#F9FAFB] transition-colors rounded-xl"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[#111827]">Reference URLs</span>
                    <span className="text-xs bg-[#F4F5F7] text-[#6B7280] font-semibold px-2 py-0.5 rounded-full">
                      {result.sourceUrls.length}
                    </span>
                  </div>
                  <svg
                    className={`w-4 h-4 text-[#6B7280] transition-transform ${showUrls ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>
                {showUrls && (
                  <div className="border-t border-[#E5E7EB] px-5 py-4 space-y-2">
                    {result.sourceUrls.map((u, idx) => (
                      <div key={idx} className="flex items-start gap-3">
                        <span className="w-5 h-5 rounded-full text-white text-xs flex items-center justify-center font-bold flex-shrink-0 mt-0.5" style={{ backgroundColor: '#3DAA8E' }}>
                          {idx + 1}
                        </span>
                        <div>
                          <p className="text-xs font-medium text-[#111827]">{u.title}</p>
                          <a href={u.url} target="_blank" rel="noopener noreferrer"
                            className="text-xs hover:underline break-all" style={{ color: '#3DAA8E' }}>
                            {u.url}
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
