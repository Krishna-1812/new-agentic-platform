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
  { id: 'crawl',      label: 'Crawl Article' },
  { id: 'theme',      label: 'Theme & Queries' },
  { id: 'llm_fanout', label: 'LLM Fanout (15 calls)' },
  { id: 'synthesis',  label: 'Concept Synthesis' },
  { id: 'kb',         label: 'Load KB' },
  { id: 'recommend',  label: 'Generate Recommendations' },
  { id: 'enhance',    label: 'Enhance Article' },
];

const QUERY_COLORS = [
  { bg: 'var(--info-soft)',    color: 'var(--info)',    label: 'Primary' },
  { bg: 'var(--brand-soft)',   color: 'var(--brand)',   label: 'Q2' },
  { bg: 'var(--success-soft)', color: 'var(--success)', label: 'Q3' },
];

function PageHeader({ navigate }) {
  return (
    <header style={{ background: 'var(--card)', borderBottom: '1px solid var(--border)', height: '56px', display: 'flex', alignItems: 'center', padding: '0 24px' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => navigate('/')}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-2)', fontSize: '14px', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer', transition: 'color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-2)'}
          >
            <svg style={{ width: '16px', height: '16px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            All tools
          </button>
          <span style={{ color: 'var(--border)' }}>/</span>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>Enhance Existing Article</span>
        </div>
      </div>
    </header>
  );
}

function StepIndicator({ stepStates }) {
  return (
    <div style={{ background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
      <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', marginBottom: '16px' }}>Pipeline Progress</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {STEPS.map(step => {
          const state = stepStates[step.id];
          const isDone = state?.status === 'done';
          const isActive = state?.status === 'active';
          return (
            <div key={step.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '2px 0' }}>
              <div style={{
                width: '16px', height: '16px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px',
                backgroundColor: isDone ? 'var(--success)' : isActive ? 'var(--primary)' : 'var(--surface)',
              }}>
                {isDone ? (
                  <svg style={{ width: '10px', height: '10px', color: '#fff' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : isActive ? (
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#fff', animation: 'pulse 1.5s ease-in-out infinite' }} />
                ) : null}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '12px', fontWeight: 500, color: isDone ? 'var(--success)' : isActive ? 'var(--primary)' : 'var(--text-3)' }}>
                  {step.label}
                </span>
                {state?.message && (
                  <p style={{ fontSize: '12px', color: 'var(--text-2)', marginTop: '2px', wordBreak: 'break-word', whiteSpace: 'normal' }}>
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

function LLMResultPanel({ llmResults, queries }) {
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [expandedModel, setExpandedModel] = useState(null);

  const groups = [0, 1, 2].map(qi => ({
    queryIndex: qi,
    query: queries?.[qi]?.query || `Query ${qi + 1}`,
    isPrimary: queries?.[qi]?.isPrimary || qi === 0,
    results: llmResults.filter(r => r.queryIndex === qi),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {groups.map(group => {
        const color = QUERY_COLORS[group.queryIndex] || QUERY_COLORS[0];
        const doneCount = group.results.filter(r => r.success).length;
        const isOpen = expandedGroup === group.queryIndex;
        return (
          <div key={group.queryIndex} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            {/* Query header */}
            <button
              onClick={() => setExpandedGroup(isOpen ? null : group.queryIndex)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', transition: 'background 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 7px', borderRadius: '4px', background: color.bg, color: color.color, flexShrink: 0 }}>
                  {group.isPrimary ? 'PRIMARY' : `Q${group.queryIndex + 1}`}
                </span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {group.query}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginLeft: '12px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-2)' }}>{doneCount}/{MODELS.length}</span>
                <svg style={{ width: '16px', height: '16px', color: 'var(--text-2)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </div>
            </button>
            {/* Model rows */}
            {isOpen && (
              <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
                {MODELS.map((model, mi) => {
                  const result = group.results.find(r => r.model === model || r.modelIndex === mi);
                  const rowKey = `${group.queryIndex}_${mi}`;
                  const isModelOpen = expandedModel === rowKey;
                  return (
                    <div key={mi} style={{ borderBottom: mi < MODELS.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <button
                        onClick={() => result?.text ? setExpandedModel(isModelOpen ? null : rowKey) : undefined}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', textAlign: 'left', background: 'none', border: 'none', cursor: result?.text ? 'pointer' : 'default' }}
                        onMouseEnter={e => { if (result?.text) e.currentTarget.style.background = 'rgba(0,0,0,0.03)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                      >
                        <span style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--text)' }}>{model}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {!result && (
                            <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>pending</span>
                          )}
                          {result && (
                            result.success
                              ? <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 7px', borderRadius: '4px', background: 'var(--success-soft)', color: 'var(--success)' }}>Done</span>
                              : <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 7px', borderRadius: '4px', background: 'var(--danger-soft)', color: 'var(--danger)' }}>Failed</span>
                          )}
                          {result?.text && (
                            <svg style={{ width: '14px', height: '14px', color: 'var(--text-2)', transform: isModelOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                            </svg>
                          )}
                        </div>
                      </button>
                      {isModelOpen && result?.text && (
                        <div style={{ padding: '12px 16px', background: 'var(--card)', borderTop: '1px solid var(--border)' }}>
                          <pre style={{ fontSize: '12px', color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.6, fontFamily: 'sans-serif', margin: 0 }}>{result.text}</pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RecommendationsPanel({ recommendations }) {
  if (!recommendations) return null;
  return (
    <div style={{ background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
      <pre style={{ fontSize: '14px', color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.6, fontFamily: 'sans-serif', margin: 0 }}>{recommendations}</pre>
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
          <mark key={i} style={{ backgroundColor: 'var(--success-soft)', borderRadius: '2px', padding: '0 2px', color: 'var(--success)' }}>
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
    const wrapStyle = isNewLine ? { backgroundColor: 'var(--success-soft)', borderRadius: '3px', display: 'block', padding: '0 4px' } : {};

    if (content.startsWith('# ')) {
      elements.push(<h1 key={i} style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text)', marginTop: '24px', marginBottom: '8px', ...wrapStyle }}>{parseInline(content.slice(2))}</h1>);
    } else if (content.startsWith('## ')) {
      elements.push(<h2 key={i} style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)', marginTop: '20px', marginBottom: '6px', ...wrapStyle }}>{parseInline(content.slice(3))}</h2>);
    } else if (content.startsWith('### ')) {
      elements.push(<h3 key={i} style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)', marginTop: '16px', marginBottom: '4px', ...wrapStyle }}>{parseInline(content.slice(4))}</h3>);
    } else if (content.startsWith('#### ')) {
      elements.push(<h4 key={i} style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', marginTop: '12px', marginBottom: '4px', ...wrapStyle }}>{parseInline(content.slice(5))}</h4>);
    } else if (content.startsWith('- ') || content.startsWith('* ')) {
      elements.push(
        <div key={i} style={{ display: 'flex', gap: '8px', margin: '2px 0', ...wrapStyle }}>
          <span style={{ color: 'var(--text-2)', flexShrink: 0, marginTop: '2px' }}>·</span>
          <span style={{ fontSize: '14px', color: 'var(--text)', lineHeight: 1.6 }}>{parseInline(content.slice(2))}</span>
        </div>
      );
    } else if (content.startsWith('> ')) {
      elements.push(<blockquote key={i} style={{ borderLeft: '4px solid var(--border)', paddingLeft: '12px', fontStyle: 'italic', fontSize: '14px', color: 'var(--text-2)', margin: '8px 0', ...wrapStyle }}>{parseInline(content.slice(2))}</blockquote>);
    } else {
      elements.push(<p key={i} style={{ fontSize: '14px', color: 'var(--text)', lineHeight: 1.6, margin: '6px 0', ...wrapStyle }}>{parseInline(content)}</p>);
    }
  }

  return (
    <div style={{ background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: '12px', color: 'var(--text-2)' }}>New content is</span>
        <mark style={{ backgroundColor: 'var(--success-soft)', borderRadius: '3px', padding: '1px 7px', fontSize: '11px', fontWeight: 600, color: 'var(--success)' }}>highlighted in green</mark>
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
  const [themeData, setThemeData] = useState(null);
  const [llmResults, setLlmResults] = useState([]);
  const [synthResults, setSynthResults] = useState([]);
  const [recommendations, setRecommendations] = useState('');
  const [enhancedText, setEnhancedText] = useState('');

  const [activeTab, setActiveTab] = useState('recommendations');
  const esRef = useRef(null);

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
    setThemeData(null);
    setLlmResults([]);
    setSynthResults([]);
    setRecommendations('');
    setEnhancedText('');

    let token;
    try {
      const res = await fetch('/api/article-enhancement/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url: url.trim(), kbId: selectedKbId }),
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
    es.addEventListener('theme_queries', e => {
      setThemeData(JSON.parse(e.data));
      setActiveTab('analysis');
    });
    es.addEventListener('llm_result', e => {
      const d = JSON.parse(e.data);
      const key = `${d.queryIndex}_${d.modelIndex}`;
      setLlmResults(prev => {
        const i = prev.findIndex(r => r.key === key);
        const entry = { ...d, key };
        if (i >= 0) { const next = [...prev]; next[i] = { ...next[i], ...entry }; return next; }
        return [...prev, entry];
      });
    });
    es.addEventListener('llm_results', e => {
      const d = JSON.parse(e.data);
      setLlmResults(prev => {
        const merged = [...prev];
        for (const r of d.results) {
          const key = `${r.queryIndex}_${r.modelIndex}`;
          const i = merged.findIndex(x => x.key === key);
          const entry = { ...r, key };
          if (i >= 0) merged[i] = { ...merged[i], ...entry }; else merged.push(entry);
        }
        return merged;
      });
      setActiveTab('llm');
    });
    es.addEventListener('synthesis_result', e => {
      const d = JSON.parse(e.data);
      setSynthResults(prev => {
        const key = `${d.queryIndex}_${d.model}`;
        const i = prev.findIndex(r => `${r.queryIndex}_${r.model}` === key);
        if (i >= 0) { const next = [...prev]; next[i] = d; return next; }
        return [...prev, d];
      });
    });
    es.addEventListener('recommendations', e => {
      setRecommendations(JSON.parse(e.data).recommendations || '');
      setActiveTab('recommendations');
    });
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
    if (!recommendations) return;
    setDownloading(true);
    try {
      const res = await fetch('/api/article-enhancement/export/docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ articleMeta, themeData, llmResults, recommendations, enhancedText }),
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
    { id: 'enhanced',        label: 'Enhanced Article',              show: !!enhancedText },
    { id: 'analysis',        label: 'Analysis',                      show: !!themeData },
    { id: 'llm',             label: `Models (${llmResults.length})`, show: llmResults.length > 0 },
    { id: 'recommendations', label: 'Recommendations',               show: !!recommendations },
  ].filter(t => t.show);

  // Concepts grouped by query for the Analysis tab
  const conceptsByQuery = [0, 1, 2].map(qi => ({
    queryIndex: qi,
    query: themeData?.queries?.[qi]?.query || '',
    isPrimary: themeData?.queries?.[qi]?.isPrimary || qi === 0,
    concepts: synthResults.filter(s => s.queryIndex === qi).flatMap(s => s.concepts || []),
  }));

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
      <PageHeader navigate={navigate} />
      <main style={{ maxWidth: '1280px', margin: '0 auto', padding: '28px 32px' }}>
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text)' }}>Enhance Existing Article</h1>
          <p style={{ fontSize: '14px', color: 'var(--text-2)', marginTop: '4px' }}>
            Crawl a live article, extract theme &amp; 3 queries, run 15 parallel LLM calls, synthesize concepts, and generate enhancement recommendations.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '24px' }}>
          {/* Left: input + progress */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', marginBottom: '16px' }}>Configuration</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* URL */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginBottom: '6px' }}>Article URL</label>
                  <input
                    type="url"
                    value={url}
                    onChange={e => { setUrl(e.target.value); setUrlError(''); }}
                    onKeyDown={e => { if (e.key === 'Enter' && !running) run(); }}
                    placeholder="https://example.com/article"
                    disabled={running}
                    style={{
                      width: '100%', padding: '10px 12px', fontSize: '14px',
                      border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                      background: running ? 'var(--surface)' : 'var(--card)',
                      color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
                    }}
                    onFocus={e => e.target.style.borderColor = 'var(--primary)'}
                    onBlur={e => e.target.style.borderColor = 'var(--border)'}
                  />
                  {urlError && <p style={{ fontSize: '12px', color: 'var(--danger)', marginTop: '6px' }}>{urlError}</p>}
                </div>

                {/* KB selector */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginBottom: '6px' }}>Knowledge Base</label>
                  <select
                    value={selectedKbId}
                    onChange={e => setSelectedKbId(e.target.value)}
                    disabled={running}
                    style={{
                      width: '100%', padding: '10px 12px', fontSize: '14px',
                      border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                      background: running ? 'var(--surface)' : 'var(--card)',
                      color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
                    }}
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
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginBottom: '6px' }}>Models (3 queries × 5 = 15 calls)</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {MODELS.map((m, i) => (
                      <div key={i} style={{ padding: '6px 12px', borderRadius: 'var(--r-lg)', background: 'var(--surface)', fontSize: '12px', fontFamily: 'monospace', color: 'var(--text)' }}>
                        {m}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {running ? (
                    <button
                      onClick={stop}
                      style={{ width: '100%', padding: '10px 16px', fontSize: '14px', fontWeight: 600, borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', color: 'var(--text-2)', background: 'var(--card)', cursor: 'pointer', transition: 'color 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--text-2)'}
                    >
                      Stop
                    </button>
                  ) : (
                    <button
                      onClick={run}
                      style={{ width: '100%', padding: '10px 16px', fontSize: '14px', fontWeight: 600, borderRadius: 'var(--r-lg)', border: 'none', color: '#fff', background: 'var(--primary)', cursor: 'pointer', transition: 'opacity 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
                      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                    >
                      Run Enhancement
                    </button>
                  )}

                  {done && (recommendations || enhancedText) && (
                    <button
                      onClick={downloadDocx}
                      disabled={downloading}
                      style={{ width: '100%', padding: '10px 16px', fontSize: '14px', fontWeight: 600, borderRadius: 'var(--r-lg)', border: 'none', color: '#fff', background: 'var(--primary)', cursor: downloading ? 'not-allowed' : 'pointer', opacity: downloading ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'opacity 0.15s' }}
                    >
                      <svg style={{ width: '16px', height: '16px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                      {downloading ? 'Generating…' : 'Download .docx'}
                    </button>
                  )}
                </div>

                {failed && (
                  <div style={{ padding: '12px', background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--r-lg)', fontSize: '12px', color: 'var(--danger)' }}>{failed}</div>
                )}
                {done && !failed && (
                  <div style={{ padding: '12px', background: 'var(--success-soft)', border: '1px solid var(--success)', borderRadius: 'var(--r-lg)', fontSize: '12px', fontWeight: 600, color: 'var(--success)' }}>
                    Enhancement complete
                  </div>
                )}
              </div>
            </div>

            {/* Article meta */}
            {articleMeta && (
              <div style={{ background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                <h3 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>Article</h3>
                <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', marginBottom: '4px', lineHeight: 1.3 }}>{articleMeta.title}</p>
                <p style={{ fontSize: '12px', color: 'var(--text-2)', marginBottom: '12px', wordBreak: 'break-all' }}>{articleMeta.url}</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div style={{ textAlign: 'center', padding: '8px', background: 'var(--surface)', borderRadius: 'var(--r-lg)' }}>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>{articleMeta.wordCount?.toLocaleString()}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-2)' }}>words</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '8px', background: 'var(--surface)', borderRadius: 'var(--r-lg)' }}>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>{articleMeta.h2s?.length}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-2)' }}>H2 sections</div>
                  </div>
                </div>
                {articleMeta.h2s?.length > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-2)', marginBottom: '6px' }}>H2 Headings</p>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {articleMeta.h2s.slice(0, 6).map((h, i) => (
                        <li key={i} style={{ fontSize: '12px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>— {h}</li>
                      ))}
                      {articleMeta.h2s.length > 6 && (
                        <li style={{ fontSize: '12px', color: 'var(--text-3)' }}>+{articleMeta.h2s.length - 6} more…</li>
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
          <div>
            {tabs.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '256px', background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', color: 'var(--text-3)', fontSize: '14px' }}>
                {running ? 'Running analysis…' : 'Enter an article URL and click Run Enhancement'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {tabs.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      style={activeTab === tab.id
                        ? { padding: '6px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 500, border: '1px solid var(--primary)', background: 'var(--primary)', color: '#fff', cursor: 'pointer', transition: 'all 0.15s' }
                        : { padding: '6px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 500, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text-2)', cursor: 'pointer', transition: 'all 0.15s' }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Analysis tab */}
                {activeTab === 'analysis' && themeData && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Theme */}
                    <div style={{ background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                      <p style={{ fontSize: '12px', color: 'var(--text-2)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Article Theme</p>
                      <p style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>{themeData.theme}</p>
                    </div>

                    {/* Queries */}
                    <div style={{ background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                      <p style={{ fontSize: '12px', color: 'var(--text-2)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>Search Queries</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {themeData.queries?.map((q, i) => {
                          const color = QUERY_COLORS[i] || QUERY_COLORS[0];
                          return (
                            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', background: color.bg, borderRadius: 'var(--r-lg)' }}>
                              <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.6)', color: color.color, flexShrink: 0, marginTop: '1px' }}>
                                {q.isPrimary ? 'PRIMARY' : `Q${i + 1}`}
                              </span>
                              <span style={{ fontSize: '13px', color: color.color, fontWeight: 500 }}>{q.query}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Concepts per query */}
                    {conceptsByQuery.some(g => g.concepts.length > 0) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {conceptsByQuery.filter(g => g.concepts.length > 0).map(group => {
                          const color = QUERY_COLORS[group.queryIndex] || QUERY_COLORS[0];
                          return (
                            <div key={group.queryIndex} style={{ background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                                <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: color.bg, color: color.color }}>
                                  {group.isPrimary ? 'PRIMARY' : `Q${group.queryIndex + 1}`}
                                </span>
                                <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                  Synthesized Concepts ({group.concepts.length})
                                </p>
                              </div>
                              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {group.concepts.map((c, i) => (
                                  <li key={i} style={{ fontSize: '13px', color: 'var(--text)', display: 'flex', alignItems: 'flex-start', gap: '8px', lineHeight: 1.5 }}>
                                    <span style={{ color: color.color, flexShrink: 0, marginTop: '3px' }}>·</span>{c}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'enhanced' && <EnhancedArticlePanel text={enhancedText} />}
                {activeTab === 'llm' && <LLMResultPanel llmResults={llmResults} queries={themeData?.queries} />}
                {activeTab === 'recommendations' && <RecommendationsPanel recommendations={recommendations} />}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
