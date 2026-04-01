import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import KBContextSelector from '../components/KBContextSelector';

const STEP_CONFIG = [
  { id: 'search',   label: 'Google Search',      icon: '🔍', desc: 'Finding top 3 ranking pages' },
  { id: 'semrush',  label: 'SEMrush Keywords',   icon: '📊', desc: 'Pulling competitor rankings' },
  { id: 'analysis', label: 'AI Shortlisting',    icon: '🤖', desc: 'Filtering & ranking keywords' },
];

function StepBadge({ status }) {
  if (status === 'done') return (
    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-green-500 text-white text-xs font-bold">✓</span>
  );
  if (status === 'active') return (
    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-900 text-white">
      <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
      </svg>
    </span>
  );
  return <span className="flex items-center justify-center w-7 h-7 rounded-full bg-gray-200 text-gray-400 text-xs font-bold">·</span>;
}

function DifficultyBar({ value }) {
  const pct = Math.min(100, Math.max(0, value || 0));
  const color = pct >= 70 ? '#ef4444' : pct >= 40 ? '#f59e0b' : '#22c55e';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-gray-500 w-6 text-right">{value || '—'}</span>
    </div>
  );
}

export default function KeywordResearchPage() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [client, setClient] = useState('');
  const [feedbackKbIds, setFeedbackKbIds] = useState([]);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [steps, setSteps] = useState({});       // { id: { status, message } }
  const [urls, setUrls] = useState([]);
  const [urlData, setUrlData] = useState({});   // { url: { keywords, status, error } }
  const [result, setResult] = useState(null);
  const [allKeywords, setAllKeywords] = useState([]);
  const [showAllKeywords, setShowAllKeywords] = useState(false);
  const [error, setError] = useState('');
  const esRef = useRef(null);

  function reset() {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setStarted(false);
    setRunning(false);
    setSteps({});
    setUrls([]);
    setUrlData({});
    setResult(null);
    setAllKeywords([]);
    setShowAllKeywords(false);
    setError('');
  }

  async function startResearch() {
    if (!keyword.trim() || running) return;
    reset();
    setStarted(true);
    setRunning(true);

    try {
      const initRes = await fetch('/api/keyword-research/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ keyword: keyword.trim(), client: client || undefined, feedbackKbIds: feedbackKbIds.length ? feedbackKbIds : undefined })
      });
      if (!initRes.ok) {
        const err = await initRes.json();
        throw new Error(err.error || 'Failed to start');
      }
      const { token } = await initRes.json();

      const es = new EventSource(`/api/keyword-research/stream/${token}`);
      esRef.current = es;

      es.addEventListener('step', e => {
        const d = JSON.parse(e.data);
        setSteps(prev => ({ ...prev, [d.id]: { status: d.status, message: d.message } }));
      });

      es.addEventListener('urls', e => {
        setUrls(JSON.parse(e.data).urls);
      });

      es.addEventListener('url_status', e => {
        const d = JSON.parse(e.data);
        setUrlData(prev => ({ ...prev, [d.url]: { status: 'loading', keywords: [], title: d.title } }));
      });

      es.addEventListener('url_keywords', e => {
        const d = JSON.parse(e.data);
        setUrlData(prev => ({
          ...prev,
          [d.url]: { status: d.status, keywords: d.keywords || [], title: d.title, error: d.error }
        }));
      });

      es.addEventListener('allKeywords', e => {
        setAllKeywords(JSON.parse(e.data).keywords || []);
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

  const canStart = keyword.trim() && !running;

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
          <span className="text-sm font-semibold text-[#111827]">Keyword Research</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-7 space-y-5">

        {/* ── Input Card ───────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-6" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)' }}>
          <KBContextSelector
            module="keyword-research"
            onChange={({ client: c, feedbackKbIds: fb }) => { setClient(c); setFeedbackKbIds(fb || []); }}
            disabled={running}
          />

          <div className="mt-4 max-w-md">
            <label className="block text-sm font-semibold text-[#111827] mb-1.5">Seed Keyword</label>
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canStart && startResearch()}
              placeholder="e.g. dental implants"
              disabled={running}
              className="w-full px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 disabled:bg-[#F4F5F7] disabled:text-[#9CA3AF]"
              style={{ '--tw-ring-color': '#3DAA8E' }}
            />
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={startResearch}
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
                  Running…
                </>
              ) : 'Start Research'}
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
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
            <span className="text-red-500 mt-0.5 flex-shrink-0">✕</span>
            <p className="text-red-800 text-sm font-medium">{error}</p>
          </div>
        )}

        {/* ── Progress Journey ─────────────────────────────────────────── */}
        {started && (
          <div className="space-y-4">
            {STEP_CONFIG.map((stepCfg, i) => {
              const s = steps[stepCfg.id] || {};
              const isVisible = s.status || i === 0;

              return (
                <div
                  key={stepCfg.id}
                  className={`bg-white rounded-xl border overflow-hidden transition-all ${
                    s.status === 'active' ? 'border-[#3DAA8E]' : s.status === 'done' ? 'border-[#E5E7EB]' : 'border-[#E5E7EB]'
                  }`}
                  style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)' }}
                >
                  {/* Step header */}
                  <div className={`flex items-center gap-3 px-5 py-3.5 ${
                    s.status === 'active' ? 'bg-[#F0FAF7]' : s.status === 'done' ? 'bg-[#F9FAFB]' : 'bg-[#F9FAFB]'
                  }`}>
                    <StepBadge status={s.status} />
                    <span className="text-lg">{stepCfg.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-gray-800">{stepCfg.label}</span>
                        {s.status === 'active' && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium animate-pulse" style={{ backgroundColor: '#3DAA8E1A', color: '#3DAA8E' }}>
                            In progress
                          </span>
                        )}
                        {s.status === 'done' && (
                          <span className="text-xs bg-[#F4F5F7] text-[#6B7280] px-2 py-0.5 rounded-full font-medium">
                            Done
                          </span>
                        )}
                      </div>
                      {s.message && <p className="text-xs text-gray-500 mt-0.5">{s.message}</p>}
                    </div>
                  </div>

                  {/* Step 1 — URL cards */}
                  {stepCfg.id === 'search' && s.status === 'done' && urls.length > 0 && (
                    <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {urls.map((u, idx) => (
                        <div key={idx} className="border border-gray-100 rounded-lg p-3 bg-gray-50">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="w-5 h-5 rounded-full text-white text-xs flex items-center justify-center font-bold flex-shrink-0" style={{ backgroundColor: '#3DAA8E' }}>
                              {idx + 1}
                            </span>
                            <span className="text-xs font-semibold text-gray-700 truncate">{u.displayUrl || new URL(u.url).hostname}</span>
                          </div>
                          <p className="text-xs text-gray-500 line-clamp-2 leading-snug">{u.title}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Step 2 — Keywords per URL */}
                  {stepCfg.id === 'semrush' && (s.status === 'active' || s.status === 'done') && urls.length > 0 && (
                    <div className="px-5 py-4 space-y-4">
                      {urls.map((u, idx) => {
                        const ud = urlData[u.url];
                        return (
                          <div key={idx}>
                            <div className="flex items-center gap-2 mb-2">
                              {ud?.status === 'done' ? (
                                <span className="text-green-500 text-xs font-bold">✓</span>
                              ) : ud?.status === 'loading' ? (
                                <svg className="animate-spin w-3 h-3 text-blue-500" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                                </svg>
                              ) : ud?.status === 'error' ? (
                                <span className="text-red-400 text-xs">✕</span>
                              ) : (
                                <span className="text-gray-300 text-xs">·</span>
                              )}
                              <span className="text-xs font-semibold text-gray-600 truncate">
                                {new URL(u.url).hostname}{new URL(u.url).pathname !== '/' ? new URL(u.url).pathname : ''}
                              </span>
                              {ud?.keywords?.length > 0 && (
                                <span className="ml-auto text-xs text-gray-400">{ud.keywords.length} keyword{ud.keywords.length !== 1 ? 's' : ''}</span>
                              )}
                            </div>

                            {ud?.status === 'error' && (
                              <p className="text-xs text-red-500 ml-5">{ud.error}</p>
                            )}

                            {ud?.keywords?.length > 0 && (
                              <div className="ml-5 flex flex-wrap gap-1.5">
                                {ud.keywords.slice(0, 10).map((kw, ki) => (
                                  <span key={ki} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                                    {kw.keyword}
                                    {kw.volume > 0 && <span className="text-gray-400">{(kw.volume / 1000).toFixed(kw.volume >= 1000 ? 1 : 0)}{kw.volume >= 1000 ? 'k' : ''}</span>}
                                  </span>
                                ))}
                              </div>
                            )}

                            {ud?.status === 'loading' && (
                              <div className="ml-5 flex gap-1.5">
                                {[...Array(5)].map((_, i) => (
                                  <div key={i} className="h-5 rounded-full bg-gray-100 animate-pulse" style={{ width: `${50 + i * 15}px` }} />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Step 3 — Analysis in progress */}
                  {stepCfg.id === 'analysis' && s.status === 'active' && (
                    <div className="px-5 py-4">
                      <div className="flex items-center gap-3 text-sm text-gray-500">
                        <svg className="animate-spin w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        Deduplicating keywords and running GPT-4o analysis…
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Results ──────────────────────────────────────────────────── */}
        {result && (
          <div className="space-y-5">
            {/* Primary Keywords */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-base font-bold text-gray-900">Primary Keywords</h2>
                <span className="text-xs bg-green-100 text-green-800 font-semibold px-2 py-0.5 rounded-full">
                  {result.primary?.length || 0} selected
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(result.primary || []).map((kw, i) => (
                  <div
                    key={i}
                    className="bg-white rounded-xl p-5 border-l-4 border border-[#E5E7EB]"
                    style={{ borderLeftColor: '#3DAA8E', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <h3 className="font-bold text-gray-900 text-base leading-snug">{kw.keyword}</h3>
                      <span
                        className="flex-shrink-0 text-xs font-semibold px-2.5 py-0.5 rounded"
                        style={{ backgroundColor: '#3DAA8E1A', color: '#3DAA8E' }}
                      >
                        PRIMARY
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <div className="text-xs text-gray-400 mb-0.5">Search Volume</div>
                        <div className="text-lg font-bold text-gray-800">
                          {kw.volume > 0 ? kw.volume.toLocaleString() : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 mb-1">Keyword Difficulty</div>
                        <DifficultyBar value={kw.difficulty} />
                      </div>
                    </div>
                    {kw.reason && (
                      <p className="text-xs text-gray-500 leading-relaxed border-t border-gray-100 pt-3 mt-1">
                        {kw.reason}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Secondary Keywords */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-base font-bold text-gray-900">Secondary Keywords</h2>
                <span className="text-xs bg-blue-100 text-blue-800 font-semibold px-2 py-0.5 rounded-full">
                  {result.secondary?.length || 0} selected
                </span>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: '#111827' }}>
                      <th className="text-left text-white font-semibold px-4 py-3 text-xs uppercase tracking-wider">#</th>
                      <th className="text-left text-white font-semibold px-4 py-3 text-xs uppercase tracking-wider">Keyword</th>
                      <th className="text-left text-white font-semibold px-4 py-3 text-xs uppercase tracking-wider">Volume</th>
                      <th className="text-left text-white font-semibold px-4 py-3 text-xs uppercase tracking-wider w-40">Difficulty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(result.secondary || []).map((kw, i) => (
                      <tr key={i} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-gray-400 text-xs">{i + 1}</td>
                        <td className="px-4 py-3 font-medium text-gray-800">{kw.keyword}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {kw.volume > 0 ? kw.volume.toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-3 w-40">
                          <DifficultyBar value={kw.difficulty} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* All source keywords toggle */}
            {allKeywords.length > 0 && (
              <div className="bg-white rounded-xl border border-[#E5E7EB]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                <button
                  onClick={() => setShowAllKeywords(v => !v)}
                  className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-[#F9FAFB] transition-colors rounded-xl"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[#111827]">All source keywords</span>
                    <span className="text-xs bg-[#F4F5F7] text-[#6B7280] font-semibold px-2 py-0.5 rounded-full">
                      {allKeywords.length} total
                    </span>
                  </div>
                  <svg
                    className={`w-4 h-4 text-[#6B7280] transition-transform ${showAllKeywords ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>

                {showAllKeywords && (
                  <div className="border-t border-[#E5E7EB] overflow-hidden rounded-b-xl">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-[#F9FAFB]">
                          <th className="text-left text-[#6B7280] font-semibold px-4 py-2.5 text-xs uppercase tracking-wider">#</th>
                          <th className="text-left text-[#6B7280] font-semibold px-4 py-2.5 text-xs uppercase tracking-wider">Keyword</th>
                          <th className="text-left text-[#6B7280] font-semibold px-4 py-2.5 text-xs uppercase tracking-wider">Volume</th>
                          <th className="text-left text-[#6B7280] font-semibold px-4 py-2.5 text-xs uppercase tracking-wider w-40">Difficulty</th>
                          <th className="text-left text-[#6B7280] font-semibold px-4 py-2.5 text-xs uppercase tracking-wider">Position</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {allKeywords.map((kw, i) => (
                          <tr key={i} className="hover:bg-[#F9FAFB] transition-colors">
                            <td className="px-4 py-2.5 text-[#9CA3AF] text-xs">{i + 1}</td>
                            <td className="px-4 py-2.5 text-[#111827] font-medium text-xs">{kw.keyword}</td>
                            <td className="px-4 py-2.5 text-[#6B7280] text-xs">
                              {kw.volume > 0 ? kw.volume.toLocaleString() : '—'}
                            </td>
                            <td className="px-4 py-2.5 w-40">
                              <DifficultyBar value={kw.difficulty} />
                            </td>
                            <td className="px-4 py-2.5 text-[#6B7280] text-xs">
                              {kw.position || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
