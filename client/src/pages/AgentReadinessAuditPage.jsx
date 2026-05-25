import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const SC = {
  pass: { label: 'Pass', bg: '#EAF3DE', color: '#3B6D11', icon: '✓' },
  fail: { label: 'Fail', bg: '#FCEBEB', color: '#A32D2D', icon: '✗' },
  info: { label: 'Info', bg: '#FAEEDA', color: '#854F0B', icon: 'i' },
};

const EC = {
  done:   { label: 'Completed',   color: '#3B6D11' },
  quick:  { label: 'Quick win',   color: '#185FA5' },
  medium: { label: 'Medium lift', color: '#854F0B' },
  high:   { label: 'Strategic',   color: '#534AB7' },
  low:    { label: 'Low lift',    color: '#185FA5' },
};

const ROADMAP = [
  {
    tier: 'This week',
    sub: '15 min – 2 hrs each',
    color: '#3B6D11', bg: '#EAF3DE',
    checkIds: ['contentsignals', 'linkheaders', 'form_labels', 'input_type', 'autocomplete', 'cookie_banner', 'vague_buttons'],
    efforts: { contentsignals: '15 min', linkheaders: '~2 hrs', form_labels: '~1 hr', input_type: '30 min', autocomplete: '30 min', cookie_banner: '30 min', vague_buttons: '1 hr' },
  },
  {
    tier: 'This quarter',
    sub: '1 day – 2 weeks each',
    color: '#185FA5', bg: '#E6F1FB',
    checkIds: ['markdown', 'apicatalog', 'oauth', 'schema_search', 'schema_action', 'js_rendering', 'interactive_divs'],
    efforts: { markdown: '1–3 days', apicatalog: '3–5 days', oauth: '1–2 wks', schema_search: '~1 day', schema_action: '~1 day', js_rendering: '1–2 wks', interactive_divs: '~1 day' },
  },
  {
    tier: 'Strategic horizon',
    sub: '2–8 weeks each',
    color: '#534AB7', bg: '#EEEDFE',
    checkIds: ['mcp', 'agentskills', 'webmcp', 'captcha'],
    efforts: { mcp: '2–4 wks', agentskills: '4–6 wks', webmcp: '4–8 wks', captcha: '2–4 wks' },
  },
];

function ScoreRing({ score }) {
  const r = 52, cx = 64, cy = 64;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const color = score >= 70 ? '#639922' : score >= 40 ? '#EF9F27' : '#E24B4A';
  return (
    <svg width="128" height="128" viewBox="0 0 128 128">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#E2E8F0" strokeWidth="8" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="8"
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" transform="rotate(-90 64 64)" />
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="28" fontWeight="500" fill={color}>{score}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" fontSize="12" fill="#888780">/ 100</text>
    </svg>
  );
}

function CatBar({ cat }) {
  const color = cat.score >= 70 ? '#639922' : cat.score >= 40 ? '#EF9F27' : '#E24B4A';
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 13, color: '#6B7280' }}>{cat.id}</span>
        <span style={{ fontSize: 13, fontWeight: 500, color }}>{cat.score}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: '#F3F4F6', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${cat.score}%`, background: color, borderRadius: 3 }} />
      </div>
      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3 }}>{cat.passed} of {cat.total} checks passed</div>
    </div>
  );
}

function CheckRow({ check, open, onToggle, isLast }) {
  const s = SC[check.status] || SC.info;
  const e = EC[check.effort] || EC.medium;
  return (
    <div style={{ borderBottom: isLast ? 'none' : '0.5px solid #F3F4F6' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%', background: 'none', border: 'none', padding: '13px 0',
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
        }}
      >
        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: s.bg, color: s.color }}>
          {s.icon} {check.flagOnly ? 'Flag' : s.label}
        </span>
        <span style={{ flex: 1, fontSize: 14, color: '#111827' }}>{check.label}</span>
        <span style={{ flexShrink: 0, fontSize: 11, color: '#9CA3AF', marginRight: 2 }}>{check.cat}</span>
        <span style={{ flexShrink: 0, fontSize: 11, color: e.color, border: `0.5px solid ${e.color}`, padding: '2px 7px', borderRadius: 4 }}>
          {e.label}
        </span>
        <span style={{ color: '#9CA3AF', fontSize: 12, marginLeft: 2 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ paddingBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5, fontWeight: 500 }}>
                Technical finding
              </div>
              <p style={{ fontSize: 12, color: '#6B7280', margin: 0, fontFamily: 'monospace', lineHeight: 1.6 }}>
                {check.tech}
              </p>
            </div>
            <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5, fontWeight: 500 }}>
                Business impact
              </div>
              <p style={{ fontSize: 12, color: '#111827', margin: 0, lineHeight: 1.6 }}>
                {check.business}
              </p>
            </div>
          </div>

          {check.status !== 'pass' && check.detail && check.detail !== check.tech && (
            <div style={{ background: '#FFFBEB', borderRadius: 8, padding: '10px 12px', marginBottom: 10, borderLeft: '3px solid #F59E0B' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                Specific issues found
              </div>
              <p style={{ fontSize: 12, color: '#78350F', margin: 0, lineHeight: 1.6, fontFamily: 'monospace' }}>{check.detail}</p>
            </div>
          )}

          {check.action && (
            <div style={{ background: '#E6F1FB', borderRadius: 8, padding: '10px 12px', borderLeft: '3px solid #378ADD' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#185FA5', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                Recommended action
              </div>
              <p style={{ fontSize: 12, color: '#0C447C', margin: 0, lineHeight: 1.6 }}>{check.action}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SkeletonLine({ w = '100%' }) {
  return <div style={{ height: 13, background: '#F3F4F6', borderRadius: 4, marginBottom: 7, width: w }} />;
}

export default function AgentReadinessAuditPage() {
  const navigate = useNavigate();
  const [urlHomepage, setUrlHomepage] = useState('');
  const [urlAction, setUrlAction]     = useState('');
  const [urlForm, setUrlForm]         = useState('');
  const [loading, setLoading]         = useState(false);
  const [pdfLoading, setPdfLoading]   = useState(false);
  const [error, setError]             = useState('');
  const [result, setResult]           = useState(null);
  const [tab, setTab]                 = useState('findings');
  const [expanded, setExpanded]       = useState(null);
  const [filterCat, setFilterCat]     = useState('all');

  async function handleAudit(e) {
    e.preventDefault();
    if (!urlHomepage.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    setTab('findings');
    setExpanded(null);
    setFilterCat('all');

    try {
      const res = await fetch('/api/agent-readiness-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          url_homepage: urlHomepage.trim(),
          url_action: urlAction.trim() || undefined,
          url_form: urlForm.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Audit failed');
      }
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadPdf() {
    if (!result) return;
    setPdfLoading(true);
    try {
      const res = await fetch('/api/agent-readiness-audit/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(result),
      });
      if (!res.ok) throw new Error('PDF generation failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `agent-readiness-${result.site.url}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setPdfLoading(false);
    }
  }

  const httpChecks    = result?.checks || [];
  const onPageChecks  = result?.onPageChecks || [];
  const allChecks     = [...httpChecks, ...onPageChecks];
  const passCount     = allChecks.filter(c => c.status === 'pass').length;
  const failCount     = allChecks.filter(c => c.status === 'fail').length;
  const infoCount     = allChecks.filter(c => c.status === 'info').length;
  const catFilters    = ['all', ...(result?.cats || []).map(c => c.id)];
  const filtered      = filterCat === 'all' ? allChecks : allChecks.filter(c => c.cat === filterCat);
  const hasOnPage     = onPageChecks.length > 0;
  const checkCount    = allChecks.length;

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F4F5F7' }}>
      {/* Nav */}
      <header className="bg-white border-b border-[#E5E7EB] h-14 flex items-center px-6">
        <div className="max-w-5xl mx-auto w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="text-[#6B7280] hover:text-[#111827] transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </button>
            <div className="w-px h-4 bg-[#E5E7EB]" />
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded flex items-center justify-center" style={{ background: '#534AB71A' }}>
                <span style={{ fontSize: 13 }}>🤖</span>
              </div>
              <span className="font-semibold text-[#111827] text-sm">Agent Readiness Audit</span>
            </div>
          </div>
          <span className="text-xs text-[#9CA3AF]">{checkCount || '13–23'} checks · Scores 0–100</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">

        {/* Agent importance one-liner */}
        <div style={{ background: '#534AB7', borderRadius: 10, padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>⚡</span>
          <p style={{ fontSize: 13, color: '#EEEDFe', margin: 0, lineHeight: 1.5 }}>
            <strong style={{ color: '#fff' }}>AI agents are replacing browsers as the primary interface to the web.</strong>{' '}
            Sites optimized for agents get found, cited, and transacted with — those that aren't get bypassed entirely. By 2027, agents will initiate the majority of commercial queries.
          </p>
        </div>

        {/* URL Inputs */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-6 mb-6" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          <h2 className="text-base font-semibold text-[#111827] mb-1">Audit a website's AI agent readiness</h2>
          <p className="text-sm text-[#6B7280] mb-5">
            Provide up to three URLs for a full audit: 13 HTTP checks run on all sites; 10 additional on-page checks require the action and form URLs.
          </p>
          <form onSubmit={handleAudit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Homepage <span style={{ color: '#A32D2D' }}>*</span>
                </label>
                <input
                  type="text"
                  value={urlHomepage}
                  onChange={e => setUrlHomepage(e.target.value)}
                  placeholder="https://example.com"
                  disabled={loading}
                  className="w-full border border-[#E5E7EB] rounded-lg px-4 py-2.5 text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#534AB7] focus:border-transparent"
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Key action page <span style={{ fontSize: 10, fontWeight: 400, color: '#9CA3AF', textTransform: 'none' }}>optional — product / service page</span>
                  </label>
                  <input
                    type="text"
                    value={urlAction}
                    onChange={e => setUrlAction(e.target.value)}
                    placeholder="https://example.com/product"
                    disabled={loading}
                    className="w-full border border-[#E5E7EB] rounded-lg px-4 py-2.5 text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#534AB7] focus:border-transparent"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Form / checkout page <span style={{ fontSize: 10, fontWeight: 400, color: '#9CA3AF', textTransform: 'none' }}>optional — contact / checkout</span>
                  </label>
                  <input
                    type="text"
                    value={urlForm}
                    onChange={e => setUrlForm(e.target.value)}
                    placeholder="https://example.com/contact"
                    disabled={loading}
                    className="w-full border border-[#E5E7EB] rounded-lg px-4 py-2.5 text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#534AB7] focus:border-transparent"
                  />
                </div>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || !urlHomepage.trim()}
              className="px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: '#534AB7' }}
            >
              {loading ? 'Running audit…' : 'Run Audit'}
            </button>
          </form>

          {loading && (
            <div className="mt-3 flex items-center gap-2 text-sm text-[#6B7280]">
              <div className="w-4 h-4 border-2 border-[#534AB7] border-t-transparent rounded-full animate-spin" />
              Running {urlAction || urlForm ? '23' : '13'} checks
              {(urlAction || urlForm) && ' including browser-rendered on-page checks'}… (~{urlAction || urlForm ? '35' : '15'}s)
            </div>
          )}
          {error && (
            <div className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</div>
          )}
        </div>

        {!result && !loading && (
          <div className="text-center py-16 text-[#9CA3AF]">
            <div className="text-4xl mb-3">🤖</div>
            <p className="text-sm">Enter a URL above to audit its agent readiness.</p>
            <p className="text-xs mt-1">Add the action and form URLs for on-page checks.</p>
          </div>
        )}

        {result && (
          <div style={{ paddingBottom: '1.5rem' }}>
            {/* Site header */}
            <div className="flex items-start justify-between mb-5">
              <div>
                <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>
                  Agent Readiness Audit
                </div>
                <h1 style={{ fontSize: 22, fontWeight: 500, margin: '0 0 4px', color: '#111827' }}>
                  {result.site.url}
                </h1>
                <div style={{ fontSize: 13, color: '#6B7280' }}>
                  {result.site.level} &nbsp;·&nbsp; Scanned {result.site.date}
                  {hasOnPage && <span style={{ marginLeft: 6, fontSize: 11, background: '#EEEDFE', color: '#534AB7', padding: '1px 7px', borderRadius: 10 }}>+10 on-page checks</span>}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={handleDownloadPdf}
                  disabled={pdfLoading}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 12, color: '#534AB7', background: '#EEEDFE',
                    border: '0.5px solid #C4BFEF', borderRadius: 7,
                    padding: '6px 12px', cursor: 'pointer',
                    opacity: pdfLoading ? 0.6 : 1,
                  }}
                >
                  {pdfLoading
                    ? <><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #534AB7', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Generating…</>
                    : <>⬇ Download PDF</>}
                </button>
                <a href={result.site.full} target="_blank" rel="noreferrer"
                  style={{ fontSize: 12, color: '#534AB7', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {result.site.full} ↗
                </a>
              </div>
            </div>

            {/* Sub-scores banner (only when on-page ran) */}
            {hasOnPage && result.site.onPageScore !== null && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>HTTP readiness</div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: result.site.httpScore >= 70 ? '#3B6D11' : result.site.httpScore >= 40 ? '#EF9F27' : '#E24B4A' }}>
                      {result.site.httpScore}<span style={{ fontSize: 12, fontWeight: 400, color: '#9CA3AF' }}>/100</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', lineHeight: 1.5 }}>robots, sitemap, headers,<br />bot access, MCP/OAuth</div>
                </div>
                <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>On-page readiness</div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: result.site.onPageScore >= 70 ? '#3B6D11' : result.site.onPageScore >= 40 ? '#EF9F27' : '#E24B4A' }}>
                      {result.site.onPageScore}<span style={{ fontSize: 12, fontWeight: 400, color: '#9CA3AF' }}>/100</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', lineHeight: 1.5 }}>forms, schema, CAPTCHA,<br />rendering gap, interactivity</div>
                </div>
              </div>
            )}

            {/* Score + Category bars */}
            <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 16, marginBottom: '1.25rem' }}>
              <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 text-center" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                <ScoreRing score={result.site.score} />
                <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  overall score
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={{ fontSize: 11, background: '#EAF3DE', color: '#3B6D11', padding: '3px 8px', borderRadius: 4 }}>✓ {passCount} passed</span>
                  <span style={{ fontSize: 11, background: '#FCEBEB', color: '#A32D2D', padding: '3px 8px', borderRadius: 4 }}>✗ {failCount} failed</span>
                  {infoCount > 0 && (
                    <span style={{ fontSize: 11, background: '#FAEEDA', color: '#854F0B', padding: '3px 8px', borderRadius: 4 }}>i {infoCount} info</span>
                  )}
                </div>
              </div>

              <div className="bg-white border border-[#E5E7EB] rounded-xl p-4" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Score by category
                </div>
                {result.cats.map(cat => <CatBar key={cat.id} cat={cat} />)}
                <div style={{ marginTop: 8, padding: '7px 10px', background: '#EEEDFE', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: '#534AB7' }}>
                    📈 Quick wins this week could raise your score to <strong>{Math.min(100, result.site.score + 16)}/100</strong>
                  </span>
                </div>
              </div>
            </div>

            {/* CMO Brief */}
            <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 mb-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#534AB7', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  ✦ CMO executive brief
                </span>
              </div>
              {result.cmoBrief ? (
                <>
                  <p style={{ fontSize: 17, fontWeight: 500, color: '#111827', margin: '0 0 10px', lineHeight: 1.4 }}>
                    {result.cmoBrief.headline}
                  </p>
                  <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 16px', lineHeight: 1.7 }}>
                    {result.cmoBrief.summary}
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                    <div style={{ background: '#FCEBEB', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#A32D2D', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Top risk</div>
                      <p style={{ fontSize: 12, color: '#791F1F', margin: 0, lineHeight: 1.55 }}>{result.cmoBrief.risk}</p>
                    </div>
                    <div style={{ background: '#EAF3DE', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#3B6D11', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>60-day opportunity</div>
                      <p style={{ fontSize: 12, color: '#27500A', margin: 0, lineHeight: 1.55 }}>{result.cmoBrief.opportunity}</p>
                    </div>
                    <div style={{ background: '#EEEDFE', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: '#534AB7', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Competitive context</div>
                      <p style={{ fontSize: 12, color: '#3C3489', margin: 0, lineHeight: 1.55 }}>{result.cmoBrief.competitive}</p>
                    </div>
                  </div>
                </>
              ) : (
                <div>
                  <SkeletonLine w="55%" />
                  <div style={{ height: 8 }} />
                  <SkeletonLine w="100%" /><SkeletonLine w="90%" /><SkeletonLine w="70%" />
                  <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 8 }}>CMO brief unavailable (check OPENAI_API_KEY)</div>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '0.5px solid #E5E7EB', marginBottom: '1rem' }}>
              {['findings', 'roadmap'].map(t => (
                <button key={t} type="button" onClick={() => setTab(t)}
                  style={{
                    background: 'none', border: 'none',
                    borderBottom: tab === t ? '2px solid #111827' : '2px solid transparent',
                    padding: '8px 16px', cursor: 'pointer',
                    fontSize: 14, fontWeight: tab === t ? 500 : 400,
                    color: tab === t ? '#111827' : '#6B7280',
                    textTransform: 'capitalize',
                  }}>
                  {t === 'findings' ? `Findings (${allChecks.length})` : 'Priority roadmap'}
                </button>
              ))}
            </div>

            {/* Findings */}
            {tab === 'findings' && (
              <div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '1rem' }}>
                  {catFilters.map(c => (
                    <button key={c} type="button" onClick={() => setFilterCat(c)}
                      style={{
                        fontSize: 12, padding: '4px 11px', borderRadius: 20, cursor: 'pointer',
                        border: '0.5px solid #E5E7EB',
                        background: filterCat === c ? '#111827' : '#F9FAFB',
                        color: filterCat === c ? '#fff' : '#6B7280',
                        fontWeight: filterCat === c ? 500 : 400,
                      }}>
                      {c === 'all' ? `All (${allChecks.length})` : c}
                    </button>
                  ))}
                </div>
                <div className="bg-white border border-[#E5E7EB] rounded-xl px-4" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                  {filtered.map((check, i) => (
                    <CheckRow
                      key={check.id}
                      check={check}
                      open={expanded === check.id}
                      isLast={i === filtered.length - 1}
                      onToggle={() => setExpanded(expanded === check.id ? null : check.id)}
                    />
                  ))}
                </div>
                {!hasOnPage && (
                  <div style={{ marginTop: 10, padding: '8px 14px', background: '#FFFBEB', borderRadius: 8, fontSize: 12, color: '#92400E' }}>
                    💡 Add an action page and form page URL above to unlock 10 additional on-page checks covering forms, schema markup, CAPTCHA, and rendering gaps.
                  </div>
                )}
              </div>
            )}

            {/* Roadmap */}
            {tab === 'roadmap' && (
              <div>
                <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 1rem', lineHeight: 1.6 }}>
                  Prioritized by impact-to-effort ratio. Quick wins deliver immediate governance and discoverability signal; the strategic horizon positions you for the AI agent economy.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                  {ROADMAP.map(tier => {
                    const tierChecks = tier.checkIds
                      .map(id => allChecks.find(c => c.id === id))
                      .filter(Boolean);
                    if (tierChecks.length === 0) return null;
                    return (
                      <div key={tier.tier} className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                        <div style={{ background: tier.bg, padding: '14px 16px' }}>
                          <span style={{ fontSize: 14, fontWeight: 500, color: tier.color }}>{tier.tier}</span>
                          <div style={{ fontSize: 12, color: tier.color, marginTop: 2, opacity: 0.8 }}>{tier.sub}</div>
                        </div>
                        <div style={{ padding: '12px 16px' }}>
                          {tierChecks.map((check, i) => (
                            <div key={check.id} style={{
                              paddingBottom: i < tierChecks.length - 1 ? 12 : 0,
                              marginBottom: i < tierChecks.length - 1 ? 12 : 0,
                              borderBottom: i < tierChecks.length - 1 ? '0.5px solid #F3F4F6' : 'none',
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 3, background: SC[check.status]?.bg, color: SC[check.status]?.color }}>
                                  {check.status === 'pass' ? '✓ Done' : check.flagOnly ? '⚑ Flag' : '✗ Missing'}
                                </span>
                                <span style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>{check.label}</span>
                              </div>
                              <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.4, marginBottom: 5 }}>
                                {check.action ? check.action.split('.')[0] + '.' : 'Already implemented.'}
                              </div>
                              <span style={{ fontSize: 11, color: tier.color, background: tier.bg, padding: '2px 7px', borderRadius: 3 }}>
                                {tier.efforts[check.id] || '–'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: '1rem', padding: '10px 14px', background: '#F9FAFB', borderRadius: 8 }}>
                  <span style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5 }}>
                    ℹ Effort estimates assume a developer familiar with your stack. WebMCP is not checkable via HTTP — marked fail by default. On-page checks require the action/form URLs to be provided. Score gain estimates are approximate.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
