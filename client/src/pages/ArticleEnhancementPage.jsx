import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const MODELS = [
  { id: 'gpt-4o-mini',              label: 'GPT-4o mini',           promptType: 'SEO Content Gap' },
  { id: 'gpt-4.1-mini',             label: 'GPT-4.1 mini',          promptType: 'GEO & AI Visibility' },
  { id: 'gpt-4o-mini-search-preview', label: 'GPT-4o mini Search', promptType: 'Intent & Quality' },
  { id: 'gpt-4.5-mini',             label: 'GPT-4.5 mini',          promptType: 'E-E-A-T & Trust' },
  { id: 'gpt-4o-mini',              label: 'GPT-4o mini (conv.)',    promptType: 'Conversion & UX' },
];

const STEPS = [
  { id: 'crawl',        label: 'Crawl Article' },
  { id: 'analyze',      label: 'Analyze Content' },
  { id: 'prompts',      label: 'Build Prompts' },
  { id: 'llm_fanout',   label: 'LLM Fanout' },
  { id: 'keywords',     label: 'Search Keywords' },
  { id: 'comp_crawl',   label: 'Crawl Competitors' },
  { id: 'serp_analysis',label: 'SERP Analysis' },
  { id: 'kb',           label: 'Load KB' },
  { id: 'report',       label: 'Generate Report' },
  { id: 'enhance',      label: 'Enhance Article' },
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

function StepIndicator({ stepStates, currentMessage }) {
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
      <h3 className="text-sm font-semibold text-[#111827] mb-4">Pipeline Progress</h3>
      <div className="space-y-2">
        {STEPS.map(step => {
          const state = stepStates[step.id];
          if (!state) return (
            <div key={step.id} className="flex items-center gap-2.5 py-1">
              <div className="w-4 h-4 rounded-full bg-[#E5E7EB] flex-shrink-0" />
              <span className="text-xs text-[#9CA3AF]">{step.label}</span>
            </div>
          );
          const isDone = state.status === 'done';
          const isActive = state.status === 'active';
          return (
            <div key={step.id} className="flex items-center gap-2.5 py-1">
              <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
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
                {state.message && (
                  <span className="text-xs text-[#6B7280] ml-2 truncate">{state.message}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {currentMessage && (
        <p className="mt-3 text-xs text-[#6B7280] italic border-t border-[#F3F4F6] pt-3">{currentMessage}</p>
      )}
    </div>
  );
}

function LLMResultPanel({ llmResults }) {
  const [expanded, setExpanded] = useState(null);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-[#111827]">LLM Analysis Results</h3>
      {llmResults.map(r => (
        <div key={r.key} className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <button
            onClick={() => setExpanded(expanded === r.key ? null : r.key)}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-[#F9FAFB] transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PROMPT_COLORS[r.key] || '#6B7280' }} />
              <div>
                <span className="text-sm font-semibold text-[#111827]">{PROMPT_LABELS[r.key] || r.label}</span>
                <span className="text-xs text-[#6B7280] ml-2">{r.model}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {r.success ? (
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#D1FAE5] text-[#065F46]">Done</span>
              ) : (
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#FEF2F2] text-[#DC2626]">Failed</span>
              )}
              <svg className="w-4 h-4 text-[#6B7280] transition-transform" style={{ transform: expanded === r.key ? 'rotate(180deg)' : 'none' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
                <div className="text-xs font-semibold px-2 py-0.5 rounded bg-[#EFF6FF] text-[#2563EB]">{count} pages</div>
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

function EnhancedArticlePanel({ html }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(html).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-[#6B7280]">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#FEF08A', border: '1px solid #CA8A04' }} />
            New inline content
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#D1FAE5', border: '1px solid #059669' }} />
            New sections
          </span>
        </div>
        <button onClick={copy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-[#E5E7EB] rounded-lg hover:border-[#D1D5DB] transition-colors bg-white text-[#374151]">
          {copied ? '✓ Copied' : 'Copy HTML'}
        </button>
      </div>

      <style>{`
        .enhanced-preview mark[data-enhancement="new"] {
          background-color: #FEF9C3;
          border-radius: 2px;
          padding: 0 2px;
        }
        .enhanced-preview section[data-enhancement="new-section"] {
          background-color: #F0FDF4;
          border-left: 3px solid #22C55E;
          padding: 12px 16px;
          margin: 12px 0;
          border-radius: 0 6px 6px 0;
        }
      `}</style>

      <div className="enhanced-preview bg-white rounded-xl border border-[#E5E7EB] p-6 overflow-x-auto"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)', maxHeight: 800, overflowY: 'auto' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <div className="bg-[#F9FAFB] rounded-lg border border-[#E5E7EB] p-3">
        <p className="text-xs text-[#6B7280] font-semibold mb-1">Raw HTML</p>
        <pre className="text-xs text-[#374151] whitespace-pre-wrap break-all leading-relaxed" style={{ maxHeight: 300, overflow: 'auto' }}>{html}</pre>
      </div>
    </div>
  );
}

export default function ArticleEnhancementPage() {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState('');

  const [stepStates, setStepStates] = useState({});
  const [currentMessage, setCurrentMessage] = useState('');

  const [articleMeta, setArticleMeta] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [llmResults, setLlmResults] = useState([]);
  const [serpPatterns, setSerpPatterns] = useState(null);
  const [report, setReport] = useState('');
  const [enhancedHtml, setEnhancedHtml] = useState('');

  const [activeTab, setActiveTab] = useState('report');

  const esRef = useRef(null);

  function validateUrl(val) {
    try { new URL(val); return true; }
    catch { return false; }
  }

  async function run() {
    if (!url.trim()) { setUrlError('Please enter an article URL'); return; }
    if (!validateUrl(url.trim())) { setUrlError('Please enter a valid URL (include https://)'); return; }
    setUrlError('');
    setRunning(true);
    setDone(false);
    setFailed('');
    setStepStates({});
    setCurrentMessage('');
    setArticleMeta(null);
    setAnalysis(null);
    setLlmResults([]);
    setSerpPatterns(null);
    setReport('');
    setEnhancedHtml('');

    const models = MODELS.map(m => m.id);

    let token;
    try {
      const res = await fetch('/api/article-enhancement/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url: url.trim(), models }),
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
      setCurrentMessage(d.message);
    });

    es.addEventListener('article_meta', e => {
      setArticleMeta(JSON.parse(e.data));
    });

    es.addEventListener('analysis', e => {
      setAnalysis(JSON.parse(e.data));
      setActiveTab('analysis');
    });

    es.addEventListener('llm_result', e => {
      const d = JSON.parse(e.data);
      setLlmResults(prev => {
        const existing = prev.findIndex(r => r.key === d.key);
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = { ...next[existing], ...d };
          return next;
        }
        return [...prev, d];
      });
    });

    es.addEventListener('llm_results', e => {
      const d = JSON.parse(e.data);
      setLlmResults(prev => {
        const merged = [...prev];
        for (const r of d.results) {
          const i = merged.findIndex(x => x.key === r.key);
          if (i >= 0) merged[i] = { ...merged[i], ...r };
          else merged.push(r);
        }
        return merged;
      });
      setActiveTab('llm');
    });

    es.addEventListener('serp_patterns', e => {
      setSerpPatterns(JSON.parse(e.data));
    });

    es.addEventListener('report', e => {
      setReport(JSON.parse(e.data).report);
      setActiveTab('report');
    });

    es.addEventListener('enhanced', e => {
      setEnhancedHtml(JSON.parse(e.data).html);
      setActiveTab('enhanced');
    });

    es.addEventListener('fail', e => {
      const d = JSON.parse(e.data);
      setFailed(d.message);
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

  const tabs = [
    { id: 'analysis', label: 'Analysis', show: !!analysis },
    { id: 'llm', label: `LLM Results (${llmResults.length})`, show: llmResults.length > 0 },
    { id: 'competitors', label: 'Competitors', show: !!serpPatterns },
    { id: 'report', label: 'Report', show: !!report },
    { id: 'enhanced', label: 'Enhanced Article', show: !!enhancedHtml },
  ].filter(t => t.show);

  return (
    <>
      <PageHeader navigate={navigate} />
      <main className="max-w-7xl mx-auto px-8 py-7">
        <div className="mb-6">
          <h1 className="text-[22px] font-bold text-[#111827]">Enhance Existing Article</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            Crawl a live article, run 5-model LLM analysis + SERP competitor research, and generate an enhanced HTML article.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: input + progress */}
          <div className="lg:col-span-1 space-y-5">
            {/* URL input */}
            <div className="bg-white rounded-xl border border-[#E5E7EB] p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
              <h3 className="text-sm font-semibold text-[#111827] mb-4">Article URL</h3>
              <div className="space-y-3">
                <div>
                  <input
                    type="url"
                    value={url}
                    onChange={e => { setUrl(e.target.value); setUrlError(''); }}
                    onKeyDown={e => { if (e.key === 'Enter' && !running) run(); }}
                    placeholder="https://example.com/article"
                    disabled={running}
                    className="w-full px-3 py-2.5 text-sm border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#111827] text-[#111827] placeholder-[#9CA3AF] disabled:bg-[#F9FAFB] disabled:text-[#9CA3AF]"
                  />
                  {urlError && <p className="text-xs text-red-600 mt-1.5">{urlError}</p>}
                </div>

                {/* Models */}
                <div>
                  <p className="text-xs font-semibold text-[#6B7280] mb-2 uppercase tracking-wider">Models (5 analyses)</p>
                  <div className="space-y-1.5">
                    {MODELS.map((m, i) => (
                      <div key={i} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-[#F9FAFB]">
                        <div>
                          <span className="text-xs font-semibold text-[#111827]">{m.label}</span>
                          <span className="text-xs text-[#6B7280] ml-2">{m.promptType}</span>
                        </div>
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: Object.values(PROMPT_COLORS)[i] || '#6B7280' }} />
                      </div>
                    ))}
                  </div>
                </div>

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

                {failed && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                    {failed}
                  </div>
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
                <p className="text-xs text-[#6B7280] mb-3 truncate">{articleMeta.url}</p>
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
                    <p className="text-xs font-semibold text-[#6B7280] mb-1.5">Headings</p>
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

            {/* Progress */}
            {(running || done || Object.keys(stepStates).length > 0) && (
              <StepIndicator stepStates={stepStates} currentMessage={running ? currentMessage : ''} />
            )}
          </div>

          {/* Right column: results */}
          <div className="lg:col-span-2">
            {tabs.length === 0 ? (
              <div className="flex items-center justify-center h-64 bg-white rounded-xl border border-[#E5E7EB] text-[#9CA3AF] text-sm">
                {running ? 'Running analysis…' : 'Enter an article URL and click Run Enhancement'}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Tab bar */}
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

                {/* Tab content */}
                {activeTab === 'analysis' && analysis && (
                  <div className="space-y-4">
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
                  </div>
                )}

                {activeTab === 'llm' && (
                  <LLMResultPanel llmResults={llmResults} />
                )}

                {activeTab === 'competitors' && serpPatterns && (
                  <SerpPanel serpPatterns={serpPatterns} />
                )}

                {activeTab === 'report' && (
                  <ReportPanel report={report} />
                )}

                {activeTab === 'enhanced' && enhancedHtml && (
                  <EnhancedArticlePanel html={enhancedHtml} />
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
