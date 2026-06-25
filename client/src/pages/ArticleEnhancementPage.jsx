import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const MODELS = [
  'gpt-4o-mini',
  'gpt-5.4-mini',
  'gpt-4o-mini-search-preview',
  'gpt-4.1-mini',
  'gpt-5-mini',
];

const STEPS = [
  { id: 'crawl',         label: 'Crawl Article' },
  { id: 'analyze',       label: 'Analyze Content' },
  { id: 'prompts',       label: 'Build Prompts' },
  { id: 'llm_fanout',    label: 'LLM Fanout' },
  { id: 'keywords',      label: 'Search Keywords' },
  { id: 'comp_crawl',    label: 'Crawl Competitors' },
  { id: 'serp_analysis', label: 'SERP Analysis' },
  { id: 'kb',            label: 'Load KB' },
  { id: 'report',        label: 'Generate Report' },
  { id: 'enhance',       label: 'Enhance Article' },
  { id: 'structure',    label: 'Add Structure & FAQ' },
];

const PROMPT_LABELS = {
  seo:        'SEO Content Gap',
  geo:        'GEO & AI Visibility',
  intent:     'Intent & Quality',
  eeat:       'E-E-A-T & Trust',
  conversion: 'Conversion & UX',
};

const PROMPT_COLORS = {
  seo:        '#2563EB',
  geo:        '#7C3AED',
  intent:     '#0F766E',
  eeat:       '#B45309',
  conversion: '#DC2626',
};

function PageHeader({ navigate }) {
  return (
    <header className="bg-white border-b border-[#E5E7EB] h-14 flex items-center px-6">
      <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-[#6B7280] hover:text-[#111827] text-sm font-medium transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
            All tools
          </button>
          <span className="text-[#E5E7EB]">/</span>
          <span className="text-sm font-semibold text-[#111827]">Enhance Existing Article</span>
        </div>
      </div>
    </header>
  );
}

function StepIndicator({ stepStates }) {
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
      <h3 className="text-sm font-semibold text-[#111827] mb-4">Pipeline Progress</h3>
      <div className="space-y-2">
        {STEPS.map(step => {
          const state = stepStates[step.id];
          const isDone = state?.status === 'done';
          const isActive = state?.status === 'active';
          return (
            <div key={step.id} className="flex items-start gap-2.5 py-0.5">
              <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ backgroundColor: isDone ? '#3DAA8E' : isActive ? '#111827' : '#E5E7EB' }}>
                {isDone ? (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : isActive ? (
                  <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                ) : null}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium" style={{ color: isDone ? '#3DAA8E' : isActive ? '#111827' : '#9CA3AF' }}>
                  {step.label}
                </span>
                {state?.message && (
                  <p className="text-xs text-[#6B7280] mt-0.5" style={{ wordBreak: 'break-word', whiteSpace: 'normal' }}>
                    {state.message}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LLMResultPanel({ llmResults }) {
  const [expanded, setExpanded] = useState(null);
  return (
    <div className="space-y-3">
      {llmResults.map(r => (
        <div key={r.key} className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <button
            onClick={() => setExpanded(expanded === r.key ? null : r.key)}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-[#F9FAFB] transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: PROMPT_COLORS[r.key] || '#6B7280' }} />
              <div>
                <span className="text-sm font-semibold text-[#111827]">{PROMPT_LABELS[r.key] || r.label}</span>
                <span className="text-xs text-[#6B7280] ml-2">{r.model}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {r.success
                ? <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#D1FAE5] text-[#065F46]">Done</span>
                : <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#FEF2F2] text-[#DC2626]">Failed</span>}
              <svg className="w-4 h-4 text-[#6B7280] transition-transform flex-shrink-0" style={{ transform: expanded === r.key ? 'rotate(180deg)' : 'none' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </div>
          </button>
          {expanded === r.key && r.text && (
            <div className="border-t border-[#F3F4F6] p-4 bg-[#FAFAFA]">
              <pre className="text-xs text-[#374151] whitespace-pre-wrap leading-relaxed font-sans">{r.text}</pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SerpPanel({ serpPatterns }) {
  if (!serpPatterns) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="bg-white rounded-lg border border-[#E5E7EB] px-4 py-3 text-center">
          <div className="text-xl font-bold text-[#111827]">{serpPatterns.successfulPages}</div>
          <div className="text-xs text-[#6B7280]">Pages crawled</div>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] px-4 py-3 text-center">
          <div className="text-xl font-bold text-[#111827]">{serpPatterns.avgWordCount?.toLocaleString()}</div>
          <div className="text-xs text-[#6B7280]">Avg words</div>
        </div>
      </div>
      {serpPatterns.contentPatterns?.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-4">
          <h4 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-3">Content Patterns</h4>
          <ul className="space-y-1">
            {serpPatterns.contentPatterns.map((p, i) => (
              <li key={i} className="text-sm text-[#374151] flex items-start gap-2">
                <span className="text-[#3DAA8E] mt-0.5">·</span>{p}
              </li>
            ))}
          </ul>
        </div>
      )}
      {serpPatterns.commonH2Topics?.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-4">
          <h4 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-3">Common H2 Topics Across Competitors</h4>
          <div className="space-y-2">
            {serpPatterns.commonH2Topics.slice(0, 8).map(({ topic, count }) => (
              <div key={topic} className="flex items-center gap-3">
                <div className="flex-1 text-sm text-[#374151] truncate">{topic}</div>
                <div className="text-xs font-semibold px-2 py-0.5 rounded bg-[#EFF6FF] text-[#2563EB] flex-shrink-0">{count} pages</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {serpPatterns.topFAQs?.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-4">
          <h4 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-3">Common FAQ Topics</h4>
          <div className="space-y-1">
            {serpPatterns.topFAQs.slice(0, 6).map(({ topic }) => (
              <div key={topic} className="text-sm text-[#374151] py-1 border-b border-[#F3F4F6] last:border-0">? {topic}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReportPanel({ report }) {
  if (!report) return null;
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-6" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
      <pre className="text-sm text-[#374151] whitespace-pre-wrap leading-relaxed font-sans">{report}</pre>
    </div>
  );
}

function EnhancedArticlePanel({ text }) {
  if (!text) return null;

  function parseInline(str) {
    const parts = str.split(/(\[NEW\][\s\S]*?\[\/NEW\])/g);
    return parts.map((part, i) => {
      if (part.startsWith('[NEW]') && part.endsWith('[/NEW]')) {
        return (
          <mark key={i} style={{ backgroundColor: '#bbf7d0', borderRadius: '2px', padding: '0 2px' }}>
            {part.slice(5, -6)}
          </mark>
        );
      }
      return part || null;
    });
  }

  const lines = text.split('\n');
  const elements = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) { elements.push(<div key={i} style={{ height: '0.6rem' }} />); continue; }

    const isNewLine = trimmed.startsWith('[NEW]') && trimmed.endsWith('[/NEW]');
    const content = isNewLine ? trimmed.slice(5, -6).trim() : trimmed;
    const wrapStyle = isNewLine ? { backgroundColor: '#bbf7d0', borderRadius: '3px', display: 'block', padding: '0 4px' } : {};

    if (content.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-xl font-bold text-[#111827] mt-6 mb-2" style={wrapStyle}>{parseInline(content.slice(2))}</h1>);
    } else if (content.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-lg font-bold text-[#111827] mt-5 mb-1.5" style={wrapStyle}>{parseInline(content.slice(3))}</h2>);
    } else if (content.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-base font-semibold text-[#111827] mt-4 mb-1" style={wrapStyle}>{parseInline(content.slice(4))}</h3>);
    } else if (content.startsWith('#### ')) {
      elements.push(<h4 key={i} className="text-sm font-semibold text-[#374151] mt-3 mb-1" style={wrapStyle}>{parseInline(content.slice(5))}</h4>);
    } else if (content.startsWith('- ') || content.startsWith('* ')) {
      elements.push(
        <div key={i} className="flex gap-2 my-0.5" style={wrapStyle}>
          <span className="text-[#6B7280] flex-shrink-0 mt-0.5">·</span>
          <span className="text-sm text-[#374151] leading-relaxed">{parseInline(content.slice(2))}</span>
        </div>
      );
    } else if (content.startsWith('> ')) {
      elements.push(<blockquote key={i} className="border-l-4 border-[#E5E7EB] pl-3 italic text-sm text-[#6B7280] my-2" style={wrapStyle}>{parseInline(content.slice(2))}</blockquote>);
    } else {
      elements.push(<p key={i} className="text-sm text-[#374151] leading-relaxed my-1.5" style={wrapStyle}>{parseInline(content)}</p>);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-6" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
      <div className="flex items-center gap-2 mb-5 pb-3 border-b border-[#F3F4F6]">
        <span className="text-xs text-[#6B7280]">New content is</span>
        <mark style={{ backgroundColor: '#bbf7d0', borderRadius: '3px', padding: '1px 7px', fontSize: '11px', fontWeight: 600, color: '#166534' }}>highlighted in green</mark>
      </div>
      <div style={{ fontFamily: 'Georgia, "Times New Roman", serif', lineHeight: '1.75' }}>
        {elements}
      </div>
    </div>
  );
}

export default function ArticleEnhancementPage() {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [kbs, setKbs] = useState([]);
  const [selectedKbId, setSelectedKbId] = useState('seo-geo-article-enhancement-knowledge-base');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState('');
  const [downloading, setDownloading] = useState(false);

  const [stepStates, setStepStates] = useState({});

  const [articleMeta, setArticleMeta] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [llmResults, setLlmResults] = useState([]);
  const [serpPatterns, setSerpPatterns] = useState(null);
  const [report, setReport] = useState('');
  const [enhancedText, setEnhancedText] = useState('');

  const [activeTab, setActiveTab] = useState('report');
  const esRef = useRef(null);

  // Load KB list on mount
  useEffect(() => {
    fetch('/api/kb', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const list = (d.knowledge_bases || []).filter(kb => kb.active);
        setKbs(list);
      })
      .catch(() => {});
  }, []);

  function validateUrl(val) {
    try { new URL(val); return true; } catch { return false; }
  }

  async function run() {
    if (!url.trim()) { setUrlError('Please enter an article URL'); return; }
    if (!validateUrl(url.trim())) { setUrlError('Please enter a valid URL (include https://)'); return; }
    setUrlError('');
    setRunning(true);
    setDone(false);
    setFailed('');
    setStepStates({});
    setArticleMeta(null);
    setAnalysis(null);
    setLlmResults([]);
    setSerpPatterns(null);
    setReport('');
    setEnhancedText('');

    let token;
    try {
      const res = await fetch('/api/article-enhancement/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url: url.trim(), models: MODELS, kbId: selectedKbId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start');
      token = data.token;
    } catch (err) {
      setFailed(err.message);
      setRunning(false);
      return;
    }

    const es = new EventSource(`/api/article-enhancement/stream/${token}`);
    esRef.current = es;

    es.addEventListener('step', e => {
      const d = JSON.parse(e.data);
      setStepStates(prev => ({ ...prev, [d.id]: { status: d.status, message: d.message } }));
    });
    es.addEventListener('article_meta', e => setArticleMeta(JSON.parse(e.data)));
    es.addEventListener('analysis', e => { setAnalysis(JSON.parse(e.data)); setActiveTab('analysis'); });
    es.addEventListener('llm_result', e => {
      const d = JSON.parse(e.data);
      setLlmResults(prev => {
        const i = prev.findIndex(r => r.key === d.key);
        if (i >= 0) { const next = [...prev]; next[i] = { ...next[i], ...d }; return next; }
        return [...prev, d];
      });
    });
    es.addEventListener('llm_results', e => {
      const d = JSON.parse(e.data);
      setLlmResults(prev => {
        const merged = [...prev];
        for (const r of d.results) {
          const i = merged.findIndex(x => x.key === r.key);
          if (i >= 0) merged[i] = { ...merged[i], ...r }; else merged.push(r);
        }
        return merged;
      });
      setActiveTab('llm');
    });
    es.addEventListener('serp_patterns', e => setSerpPatterns(JSON.parse(e.data)));
    es.addEventListener('report', e => { setReport(JSON.parse(e.data).report); setActiveTab('report'); });
    es.addEventListener('enhanced', e => { setEnhancedText(JSON.parse(e.data).text || ''); setActiveTab('enhanced'); });
    es.addEventListener('fail', e => {
      setFailed(JSON.parse(e.data).message);
      setRunning(false);
      es.close();
    });
    es.addEventListener('done', () => {
      setDone(true);
      setRunning(false);
      es.close();
    });
    es.onerror = () => {
      setFailed('Connection lost. Please try again.');
      setRunning(false);
      es.close();
    };
  }

  function stop() {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setRunning(false);
  }

  async function downloadDocx() {
    if (!report) return;
    setDownloading(true);
    try {
      const res = await fetch('/api/article-enhancement/export/docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ articleMeta, analysis, llmResults, serpPatterns, report, enhancedText }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Export failed');
      }
      const blob = await res.blob();
      const burl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const slug = (articleMeta?.title || 'article').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
      a.href = burl;
      a.download = `${slug}-enhancement.docx`;
      a.click();
      URL.revokeObjectURL(burl);
    } catch (err) {
      alert(err.message);
    } finally {
      setDownloading(false);
    }
  }

  const tabs = [
    { id: 'enhanced',    label: 'Enhanced Article',                show: !!enhancedText },
    { id: 'analysis',    label: 'Analysis',                        show: !!analysis },
    { id: 'llm',         label: `Models (${llmResults.length})`,   show: llmResults.length > 0 },
    { id: 'competitors', label: 'Competitors',                     show: !!serpPatterns },
    { id: 'report',      label: 'Report',                          show: !!report },
  ].filter(t => t.show);

  return (
    <>
      <PageHeader navigate={navigate} />
      <main className="max-w-7xl mx-auto px-8 py-7">
        <div className="mb-6">
          <h1 className="text-[22px] font-bold text-[#111827]">Enhance Existing Article</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            Crawl a live article, run 5-model LLM analysis + SERP competitor research, and download an enhancement report as Word doc.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: input + progress */}
          <div className="lg:col-span-1 space-y-5">
            <div className="bg-white rounded-xl border border-[#E5E7EB] p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
              <h3 className="text-sm font-semibold text-[#111827] mb-4">Configuration</h3>
              <div className="space-y-4">
                {/* URL */}
                <div>
                  <label className="block text-xs font-semibold text-[#374151] mb-1.5">Article URL</label>
                  <input
                    type="url"
                    value={url}
                    onChange={e => { setUrl(e.target.value); setUrlError(''); }}
                    onKeyDown={e => { if (e.key === 'Enter' && !running) run(); }}
                    placeholder="https://example.com/article"
                    disabled={running}
                    className="w-full px-3 py-2.5 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#111827] text-[#111827] placeholder-[#9CA3AF] disabled:bg-[#F9FAFB]"
                  />
                  {urlError && <p className="text-xs text-red-600 mt-1.5">{urlError}</p>}
                </div>

                {/* KB selector */}
                <div>
                  <label className="block text-xs font-semibold text-[#374151] mb-1.5">Knowledge Base</label>
                  <select
                    value={selectedKbId}
                    onChange={e => setSelectedKbId(e.target.value)}
                    disabled={running}
                    className="w-full px-3 py-2.5 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#111827] text-[#111827] bg-white disabled:bg-[#F9FAFB]"
                  >
                    {kbs.length === 0 && (
                      <option value="seo-geo-article-enhancement-knowledge-base">seo-geo-article-enhancement-knowledge-base</option>
                    )}
                    {kbs.map(kb => (
                      <option key={kb.id} value={kb.id}>{kb.id}</option>
                    ))}
                  </select>
                </div>

                {/* Models */}
                <div>
                  <label className="block text-xs font-semibold text-[#374151] mb-1.5">Models (5 analyses)</label>
                  <div className="space-y-1">
                    {MODELS.map((m, i) => (
                      <div key={i} className="py-1.5 px-3 rounded-lg bg-[#F9FAFB] text-xs font-mono text-[#374151]">
                        {m}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="space-y-2">
                  {running ? (
                    <button onClick={stop}
                      className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg border border-[#E5E7EB] text-[#6B7280] hover:text-[#111827] bg-white transition-colors">
                      Stop
                    </button>
                  ) : (
                    <button onClick={run}
                      className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg text-white transition-colors"
                      style={{ backgroundColor: '#111827' }}>
                      Run Enhancement
                    </button>
                  )}

                  {done && (report || enhancedText) && (
                    <button onClick={downloadDocx} disabled={downloading}
                      className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg text-white transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                      style={{ backgroundColor: '#3DAA8E' }}>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                      {downloading ? 'Generating…' : 'Download .docx'}
                    </button>
                  )}
                </div>

                {failed && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{failed}</div>
                )}
                {done && !failed && (
                  <div className="p-3 bg-[#F0FAF7] border border-[#3DAA8E] rounded-lg text-xs font-semibold text-[#3DAA8E]">
                    Enhancement complete
                  </div>
                )}
              </div>
            </div>

            {/* Article meta */}
            {articleMeta && (
              <div className="bg-white rounded-xl border border-[#E5E7EB] p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                <h3 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-3">Article</h3>
                <p className="text-sm font-semibold text-[#111827] mb-1 leading-snug">{articleMeta.title}</p>
                <p className="text-xs text-[#6B7280] mb-3 break-all">{articleMeta.url}</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-center py-2 bg-[#F9FAFB] rounded-lg">
                    <div className="text-base font-bold text-[#111827]">{articleMeta.wordCount?.toLocaleString()}</div>
                    <div className="text-xs text-[#6B7280]">words</div>
                  </div>
                  <div className="text-center py-2 bg-[#F9FAFB] rounded-lg">
                    <div className="text-base font-bold text-[#111827]">{articleMeta.h2s?.length}</div>
                    <div className="text-xs text-[#6B7280]">H2 sections</div>
                  </div>
                </div>
                {articleMeta.h2s?.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-[#6B7280] mb-1.5">H2 Headings</p>
                    <ul className="space-y-1">
                      {articleMeta.h2s.slice(0, 6).map((h, i) => (
                        <li key={i} className="text-xs text-[#374151] truncate">— {h}</li>
                      ))}
                      {articleMeta.h2s.length > 6 && (
                        <li className="text-xs text-[#9CA3AF]">+{articleMeta.h2s.length - 6} more…</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Pipeline progress */}
            {Object.keys(stepStates).length > 0 && (
              <StepIndicator stepStates={stepStates} />
            )}
          </div>

          {/* Right: results */}
          <div className="lg:col-span-2">
            {tabs.length === 0 ? (
              <div className="flex items-center justify-center h-64 bg-white rounded-xl border border-[#E5E7EB] text-[#9CA3AF] text-sm">
                {running ? 'Running analysis…' : 'Enter an article URL and click Run Enhancement'}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex gap-1.5 flex-wrap">
                  {tabs.map(tab => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                      className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
                      style={activeTab === tab.id
                        ? { backgroundColor: '#111827', color: '#fff', borderColor: '#111827' }
                        : { backgroundColor: '#fff', color: '#6B7280', borderColor: '#E5E7EB' }}>
                      {tab.label}
                    </button>
                  ))}
                </div>

                {activeTab === 'analysis' && analysis && (
                  <div className="bg-white rounded-xl border border-[#E5E7EB] p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                    <div className="grid grid-cols-2 gap-4 mb-5">
                      <div>
                        <p className="text-xs text-[#6B7280] font-semibold uppercase tracking-wider mb-1">Topic</p>
                        <p className="text-sm font-semibold text-[#111827]">{analysis.topic}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[#6B7280] font-semibold uppercase tracking-wider mb-1">Primary Keyword</p>
                        <p className="text-sm font-semibold text-[#111827]">{analysis.primaryKeyword}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[#6B7280] font-semibold uppercase tracking-wider mb-1">Intent</p>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#EFF6FF] text-[#2563EB]">{analysis.intent}</span>
                      </div>
                      <div>
                        <p className="text-xs text-[#6B7280] font-semibold uppercase tracking-wider mb-1">Target Audience</p>
                        <p className="text-sm text-[#374151]">{analysis.targetAudience}</p>
                      </div>
                    </div>
                    {analysis.contentGaps?.length > 0 && (
                      <div className="mb-4">
                        <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-2">Content Gaps</p>
                        <ul className="space-y-1">
                          {analysis.contentGaps.map((g, i) => (
                            <li key={i} className="text-sm text-[#374151] flex items-start gap-2">
                              <span className="text-red-400 mt-0.5 flex-shrink-0">·</span>{g}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {analysis.contentStrengths?.length > 0 && (
                      <div className="mb-4">
                        <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-2">Content Strengths</p>
                        <ul className="space-y-1">
                          {analysis.contentStrengths.map((s, i) => (
                            <li key={i} className="text-sm text-[#374151] flex items-start gap-2">
                              <span className="text-[#3DAA8E] mt-0.5 flex-shrink-0">·</span>{s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {analysis.seoIssues?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-2">SEO Issues</p>
                        <ul className="space-y-1">
                          {analysis.seoIssues.map((s, i) => (
                            <li key={i} className="text-sm text-[#374151] flex items-start gap-2">
                              <span className="text-amber-500 mt-0.5 flex-shrink-0">·</span>{s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'enhanced' && <EnhancedArticlePanel text={enhancedText} />}
                {activeTab === 'llm' && <LLMResultPanel llmResults={llmResults} />}
                {activeTab === 'competitors' && <SerpPanel serpPatterns={serpPatterns} />}
                {activeTab === 'report' && <ReportPanel report={report} />}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
