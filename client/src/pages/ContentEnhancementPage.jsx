import { useMemo, useState } from 'react';

const CATEGORY_COLORS = {
  'Content Structure': '#2563EB',
  Authority: '#DC2626',
  Schema: '#7C3AED',
  'Entity Clarity': '#0F766E',
  Input: '#6B7280',
};

const SEVERITY = {
  error: { bg: '#FEF2F2', text: '#DC2626', label: 'High' },
  warning: { bg: '#FFFBEB', text: '#B45309', label: 'Medium' },
  notice: { bg: '#EFF6FF', text: '#2563EB', label: 'Low' },
  info: { bg: '#F3F4F6', text: '#6B7280', label: 'Info' },
};

function ScoreRing({ score, size = 92 }) {
  const radius = (size / 2) - 8;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 75 ? '#16A34A' : score >= 50 ? '#D97706' : '#DC2626';

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#E5E7EB" strokeWidth="7" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x={size / 2} y={(size / 2) + 2} textAnchor="middle" dominantBaseline="middle" fontSize="18" fontWeight="700" fill={color}>
        {score}
      </text>
    </svg>
  );
}

function SeverityBadge({ severity }) {
  const style = SEVERITY[severity] || SEVERITY.info;
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: style.bg, color: style.text }}>
      {style.label}
    </span>
  );
}

function CategoryScore({ item }) {
  const color = CATEGORY_COLORS[item.category] || '#3DAA8E';
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-[#111827]">{item.category}</span>
        <span className="text-sm font-bold" style={{ color }}>{item.score}</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${item.score}%`, backgroundColor: color }} />
      </div>
      <p className="text-xs text-gray-500 mt-2">{item.passed}/{item.total} checks passed</p>
    </div>
  );
}

function PriorityCard({ item, index }) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-lg p-4">
      <div className="flex items-start gap-3">
        <span className="w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0" style={{ backgroundColor: '#111827' }}>
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-[#111827]">{item.title}</h3>
            <SeverityBadge severity={item.severity || (item.priority <= 2 ? 'error' : 'warning')} />
            {item.effort && <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">{item.effort}</span>}
          </div>
          {(item.why_it_matters || item.current_state) && (
            <p className="text-sm text-gray-600 mt-2">{item.why_it_matters || item.current_state}</p>
          )}
          {(item.how_to_fix || item.recommendation) && (
            <p className="text-sm text-gray-800 mt-2">{item.how_to_fix || item.recommendation}</p>
          )}
          {item.example_copy && (
            <div className="mt-3 bg-gray-50 border border-gray-100 rounded-md p-3">
              <p className="text-xs font-semibold text-gray-500 mb-1">Example</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.example_copy}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ListCard({ title, items, empty = 'No items detected.' }) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-lg p-4">
      <h3 className="text-sm font-bold text-[#111827] mb-3">{title}</h3>
      {items?.length ? (
        <ul className="space-y-2">
          {items.map((item, idx) => (
            <li key={idx} className="flex gap-2 text-sm text-gray-700">
              <span className="w-1.5 h-1.5 rounded-full mt-2 shrink-0" style={{ backgroundColor: '#3DAA8E' }} />
              <span>{typeof item === 'string' ? item : item.text || item.href || JSON.stringify(item)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-400">{empty}</p>
      )}
    </div>
  );
}

function CheckRow({ check }) {
  const color = check.status === 'pass' ? '#16A34A' : check.severity === 'error' ? '#DC2626' : check.severity === 'warning' ? '#D97706' : '#2563EB';
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <span className="font-mono text-xs text-gray-400 w-12 pt-0.5 shrink-0">{check.id}</span>
      <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-[#111827]">{check.name}</span>
          <span className="text-xs text-gray-400">{check.category}</span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{check.detail}</p>
        {check.recommendation && <p className="text-xs text-gray-700 mt-1">{check.recommendation}</p>}
      </div>
    </div>
  );
}

function CodeBlock({ value }) {
  if (!value) return null;
  return (
    <pre className="text-xs bg-[#111827] text-[#E5E7EB] rounded-lg p-4 overflow-x-auto whitespace-pre-wrap max-h-80">
      {value}
    </pre>
  );
}

function TableRecommendation({ table }) {
  if (!table) return null;
  const columns = table.columns || [];
  const rows = table.rows || [];
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-lg overflow-hidden">
      <div className="p-4 border-b border-gray-100">
        <h3 className="text-sm font-bold text-[#111827]">{table.title || 'Recommended Table'}</h3>
        {table.why_it_helps && <p className="text-sm text-gray-600 mt-1">{table.why_it_helps}</p>}
      </div>
      {columns.length > 0 && rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {columns.map((col, idx) => (
                  <th key={idx} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="border-b border-gray-50 last:border-0">
                  {row.map((cell, cellIdx) => (
                    <td key={cellIdx} className="px-3 py-2 text-gray-700 align-top">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-4 text-sm text-gray-400">No table rows returned.</p>
      )}
    </div>
  );
}

function FaqRecommendation({ faq }) {
  if (!faq?.questions?.length) return null;
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-lg p-4">
      <h3 className="text-sm font-bold text-[#111827] mb-1">Recommended FAQ Block</h3>
      {faq.why_it_helps && <p className="text-sm text-gray-600 mb-3">{faq.why_it_helps}</p>}
      <div className="space-y-3">
        {faq.questions.map((item, idx) => (
          <div key={idx} className="bg-gray-50 rounded-lg p-3">
            <p className="text-sm font-semibold text-[#111827]">{item.question}</p>
            <p className="text-sm text-gray-700 mt-1">{item.answer}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function TextBlock({ title, value }) {
  if (!value) return null;
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-lg p-4">
      <h3 className="text-sm font-bold text-[#111827] mb-2">{title}</h3>
      <p className="text-sm text-gray-700 whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function CitationTargets({ items }) {
  if (!items?.length) return <ListCard title="Citation Targets" items={['No citation targets returned.']} />;
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-lg p-4">
      <h3 className="text-sm font-bold text-[#111827] mb-3">Citation Targets</h3>
      <div className="space-y-3">
        {items.map((item, idx) => (
          <div key={idx} className="bg-gray-50 rounded-lg p-3">
            <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:underline" style={{ color: '#111827' }}>
              {item.source_title || item.source_url}
            </a>
            <div className="flex gap-2 flex-wrap mt-1">
              {item.source_type && <span className="text-xs px-2 py-0.5 rounded bg-white text-gray-500 border border-gray-200">{item.source_type}</span>}
              {item.where_to_add && <span className="text-xs px-2 py-0.5 rounded bg-white text-gray-500 border border-gray-200">{item.where_to_add}</span>}
            </div>
            {item.claim_to_support && <p className="text-xs text-gray-500 mt-2">Claim: {item.claim_to_support}</p>}
            {item.draft_sentence && <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{item.draft_sentence}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatisticsRecommendations({ items }) {
  if (!items?.length) return <ListCard title="Statistics to Add" items={['No statistics recommendations returned.']} />;
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-lg p-4">
      <h3 className="text-sm font-bold text-[#111827] mb-3">Statistics to Add</h3>
      <div className="space-y-3">
        {items.map((item, idx) => (
          <div key={idx} className="bg-gray-50 rounded-lg p-3">
            <p className="text-sm font-semibold text-[#111827]">{item.claim_or_stat_needed || item}</p>
            {item.recommended_source_url ? (
              <a href={item.recommended_source_url} target="_blank" rel="noopener noreferrer" className="text-xs hover:underline" style={{ color: '#3DAA8E' }}>
                {item.recommended_source_title || item.recommended_source_url}
              </a>
            ) : item.recommended_source_type ? (
              <p className="text-xs text-gray-500 mt-1">Source: {item.recommended_source_type}</p>
            ) : null}
            {item.where_to_place && <p className="text-xs text-gray-500 mt-1">Placement: {item.where_to_place}</p>}
            {item.sample_sentence_template && <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{item.sample_sentence_template}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function CsqafRecommendations({ items }) {
  if (!items?.length) return <ListCard title="CSQAF Recommendations" items={[]} empty="No CSQAF recommendations returned." />;
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-lg p-4">
      <h3 className="text-sm font-bold text-[#111827] mb-3">CSQAF Recommendations</h3>
      <div className="space-y-3">
        {items.map((item, idx) => (
          <div key={idx} className="bg-gray-50 rounded-lg p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-[#111827]">{item.element || `Fix ${idx + 1}`}</span>
              {item.placement && <span className="text-xs px-2 py-0.5 rounded bg-white text-gray-500 border border-gray-200">{item.placement}</span>}
            </div>
            {item.specific_action && <p className="text-sm text-gray-700 mt-2">{item.specific_action}</p>}
            {item.draft_copy && <p className="text-sm text-gray-800 mt-2 whitespace-pre-wrap">{item.draft_copy}</p>}
            {item.source_url && (
              <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="text-xs hover:underline mt-2 inline-block" style={{ color: '#3DAA8E' }}>
                {item.source_title || item.source_url}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ContentEnhancementPage() {
  const [inputMode, setInputMode] = useState('html');
  const [url, setUrl] = useState('');
  const [html, setHtml] = useState('');
  const [primaryKeyword, setPrimaryKeyword] = useState('');
  const [pageType, setPageType] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [activeTab, setActiveTab] = useState('summary');
  const [copied, setCopied] = useState(false);

  const canRun = inputMode === 'url' ? url.trim() : html.trim().length >= 80;

  const ai = result?.ai;
  const findings = result?.findings;
  const priorityItems = useMemo(() => {
    if (ai?.priority_recommendations?.length) return ai.priority_recommendations;
    return findings?.recommendations?.topFixes || [];
  }, [ai, findings]);

  async function runAudit() {
    if (!canRun || loading) return;
    setLoading(true);
    setError('');
    setResult(null);
    setCopied(false);

    try {
      const response = await fetch('/api/content-enhancement/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          inputMode,
          url: url.trim() || undefined,
          html: inputMode === 'html' ? html : undefined,
          primaryKeyword: primaryKeyword.trim() || undefined,
          pageType: pageType.trim() || undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Analysis failed.');
      setResult(data);
      setActiveTab('summary');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function copySummary() {
    const payload = ai || findings?.recommendations || {};
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
      <main className="max-w-6xl mx-auto px-8 py-7 space-y-5">
        <div>
          <h1 className="text-[22px] font-bold text-[#111827]">Content Enhancement Recommendations</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            Audit content structure, authority, citations, schema, and AI-answer readiness from a URL or pasted HTML.
          </p>
        </div>

        <section className="bg-white rounded-xl border border-[#E5E7EB] p-6" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-5">
            {[
              ['html', 'Paste HTML'],
              ['url', 'Fetch URL'],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setInputMode(id)}
                className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${inputMode === id ? 'bg-white text-[#111827] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              {inputMode === 'url' ? (
                <div>
                  <label className="block text-sm font-semibold text-[#111827] mb-1.5">Page URL</label>
                  <input
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    placeholder="https://example.com/resources/article"
                    className="w-full px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': '#3DAA8E' }}
                  />
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-semibold text-[#111827]">HTML Source</label>
                    <span className="text-xs text-gray-400">{html.length.toLocaleString()} chars</span>
                  </div>
                  <textarea
                    value={html}
                    onChange={e => setHtml(e.target.value)}
                    placeholder="Paste the page HTML here. Use this for sites that block scraping or bots."
                    rows={10}
                    className="w-full px-4 py-3 rounded-lg border border-[#E5E7EB] text-sm font-mono focus:outline-none focus:ring-2 resize-y"
                    style={{ '--tw-ring-color': '#3DAA8E' }}
                  />
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-[#111827] mb-1.5">Primary Keyword</label>
                <input
                  value={primaryKeyword}
                  onChange={e => setPrimaryKeyword(e.target.value)}
                  placeholder="e.g. hypodontia"
                  className="w-full px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': '#3DAA8E' }}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#111827] mb-1.5">Page Type</label>
                <input
                  value={pageType}
                  onChange={e => setPageType(e.target.value)}
                  placeholder="article, service, location"
                  className="w-full px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': '#3DAA8E' }}
                />
              </div>
              {inputMode === 'html' && url.trim() && (
                <p className="text-xs text-gray-500">The URL will be used only for canonical/internal-link context. The pasted HTML is the source of truth.</p>
              )}
              {inputMode === 'html' && (
                <div>
                  <label className="block text-sm font-semibold text-[#111827] mb-1.5">Optional Page URL</label>
                  <input
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    placeholder="https://example.com/page"
                    className="w-full px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': '#3DAA8E' }}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={runAudit}
              disabled={!canRun || loading}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#111827' }}
            >
              {loading && (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {loading ? 'Analyzing...' : 'Generate Recommendations'}
            </button>
            {result && (
              <button onClick={copySummary} className="px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-sm font-semibold bg-white text-gray-700 hover:bg-gray-50">
                {copied ? 'Copied' : 'Copy JSON'}
              </button>
            )}
          </div>
        </section>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-sm font-medium text-red-800">{error}</p>
          </div>
        )}

        {findings && (
          <section className="space-y-4">
            <div className="bg-white rounded-xl border border-[#E5E7EB] p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
              <div className="flex flex-col md:flex-row md:items-center gap-5">
                <ScoreRing score={findings.scores.overall} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-[#111827]">{findings.meta.h1 || findings.meta.title || 'Analyzed Content'}</h2>
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">{findings.meta.inputType === 'html_paste' ? 'HTML paste' : 'URL fetch'}</span>
                  </div>
                  <p className="text-sm text-gray-600 mt-2">
                    {ai?.executive_summary?.verdict || `${findings.scores.counts.fail} improvement opportunities found across structure, authority, schema, and entity clarity.`}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3 text-xs text-gray-500">
                    <span>{findings.meta.wordCount.toLocaleString()} words</span>
                    <span>{findings.signals.h2s.length} H2s</span>
                    <span>{findings.signals.authoritativeCitations.length} trusted citations</span>
                    <span>{findings.signals.schemaTypes.length || 0} schema types</span>
                  </div>
                </div>
                {ai?.executive_summary?.readiness && (
                  <div className="rounded-lg bg-gray-50 px-4 py-3 min-w-[150px]">
                    <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Readiness</p>
                    <p className="text-lg font-bold capitalize text-[#111827]">{ai.executive_summary.readiness}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {findings.scores.categories.map(cat => <CategoryScore key={cat.category} item={cat} />)}
            </div>

            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
              {[
                ['summary', 'Recommendations'],
                ['research', 'Research'],
                ['structure', 'Structure'],
                ['authority', 'Authority'],
                ['assets', 'Copy-Ready Assets'],
                ['schema', 'Schema'],
                ['checks', 'All Checks'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${activeTab === id ? 'bg-white text-[#111827] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {activeTab === 'summary' && (
              <div className="space-y-3">
                {ai?.executive_summary?.highest_impact_fix && (
                  <div className="bg-white border border-[#3DAA8E] rounded-lg p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#3DAA8E' }}>Highest Impact Fix</p>
                    <p className="text-sm text-gray-800">{ai.executive_summary.highest_impact_fix}</p>
                  </div>
                )}
                {priorityItems.map((item, index) => <PriorityCard key={index} item={item} index={index} />)}
              </div>
            )}

            {activeTab === 'structure' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ListCard title="Recommended Outline Changes" items={ai?.content_structure?.recommended_outline_changes || findings.recommendations.sectionIdeas} />
                <ListCard title="Answer Blocks to Add" items={ai?.content_structure?.answer_blocks_to_add || findings.recommendations.sectionIdeas} />
                <ListCard title="Detected H2s" items={findings.signals.h2s} />
                <ListCard title="FAQ Recommendations" items={ai?.content_structure?.faq_questions || findings.recommendations.faqIdeas} />
              </div>
            )}

            {activeTab === 'research' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ListCard title="Competitor Patterns" items={ai?.research_summary?.competitor_patterns || []} empty="No competitor patterns returned." />
                <ListCard title="Content Gaps to Exploit" items={ai?.research_summary?.content_gaps || []} empty="No content gaps returned." />
                <div className="lg:col-span-2 bg-white border border-[#E5E7EB] rounded-lg p-4">
                  <h3 className="text-sm font-bold text-[#111827] mb-3">Top Ranking Sources Used</h3>
                  {ai?.research_summary?.source_urls?.length ? (
                    <div className="space-y-2">
                      {ai.research_summary.source_urls.map((source, idx) => (
                        <div key={idx} className="flex items-start gap-3 text-sm">
                          <span className="w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0" style={{ backgroundColor: '#3DAA8E' }}>{idx + 1}</span>
                          <div>
                            <a href={source.url} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline" style={{ color: '#111827' }}>{source.title || source.url}</a>
                            {source.use_for && <p className="text-xs text-gray-500 mt-0.5">{source.use_for}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">No researched source list returned.</p>
                  )}
                </div>
                {result.researchError && (
                  <div className="lg:col-span-2 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-sm text-amber-800">Research warning: {result.researchError}</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'authority' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ListCard title="Expert Signal Recommendations" items={ai?.authority?.expert_signal_recommendations || findings.recommendations.authorityIdeas} />
                <CitationTargets items={ai?.authority?.citation_targets} />
                <StatisticsRecommendations items={ai?.authority?.statistics_to_add} />
                <ListCard title="Detected Trusted Citations" items={findings.signals.authoritativeCitations.map(c => `${c.host} - ${c.text || c.href}`)} />
                <CsqafRecommendations items={ai?.csqaf?.recommendations} />
                <TextBlock title="Expert Quote Integration" value={ai?.authority?.expert_quote_integration ? `${ai.authority.expert_quote_integration.credential_to_request}\n\nPlacement: ${ai.authority.expert_quote_integration.placement}\n\nPrompt: ${ai.authority.expert_quote_integration.sample_quote_prompt}\n\nFormat: ${ai.authority.expert_quote_integration.sample_quote_format}` : ''} />
                <TextBlock title="Author Bio & Byline Optimization" value={ai?.authority?.author_bio_byline ? `${ai.authority.author_bio_byline.recommendation}\n\nByline: ${ai.authority.author_bio_byline.sample_byline}\n\nBio: ${ai.authority.author_bio_byline.sample_bio}` : ''} />
              </div>
            )}

            {activeTab === 'assets' && (
              <div className="space-y-4">
                <TextBlock title="Direct Answer Block" value={ai?.direct_answer_formatting?.recommended_block} />
                <FaqRecommendation faq={ai?.faq_block} />
                {(ai?.html_comparison_tables || []).map((table, idx) => <TableRecommendation key={idx} table={table} />)}
                {!ai?.direct_answer_formatting?.recommended_block && !ai?.faq_block?.questions?.length && !ai?.html_comparison_tables?.length && (
                  <div className="bg-white border border-[#E5E7EB] rounded-lg p-4">
                    <p className="text-sm text-gray-400">No copy-ready assets returned.</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'schema' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ListCard title="Detected Schema Types" items={findings.signals.schemaTypes} empty="No JSON-LD schema types detected." />
                <ListCard title="Schema Recommendations" items={ai?.schema?.missing_or_improved_schema || ['Article or MedicalWebPage schema with author, reviewedBy, datePublished, dateModified, and citation fields.']} />
                <div className="lg:col-span-2 bg-white border border-[#E5E7EB] rounded-lg p-4">
                  <h3 className="text-sm font-bold text-[#111827] mb-3">Starter JSON-LD</h3>
                  <CodeBlock value={ai?.schema?.starter_json_ld} />
                  {!ai?.schema?.starter_json_ld && <p className="text-sm text-gray-400">No starter schema returned.</p>}
                </div>
              </div>
            )}

            {activeTab === 'checks' && (
              <div className="bg-white border border-[#E5E7EB] rounded-xl px-4" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                {findings.checks.map(check => <CheckRow key={check.id} check={check} />)}
              </div>
            )}
          </section>
        )}
      </main>
  );
}
