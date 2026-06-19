import { useState, useEffect, useRef, useCallback } from 'react';
import { startAudit, pollStatus, getResult, listAudits, deleteAudit } from '../lib/onPageAuditApi';

const TEAL = '#3DAA8E';
const POLL_MS = 3500;

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_COLORS = {
  pass:    { bg: '#D1FAE5', text: '#065F46', label: 'Pass'    },
  fail:    { bg: '#FEE2E2', text: '#991B1B', label: 'Fail'    },
  warning: { bg: '#FEF3C7', text: '#92400E', label: 'Warning' },
  manual:  { bg: '#DBEAFE', text: '#1E40AF', label: 'Manual'  },
  na:      { bg: '#F3F4F6', text: '#6B7280', label: 'N/A'     },
};

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.na;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
      style={{ backgroundColor: c.bg, color: c.text }}>
      {c.label}
    </span>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function MagnifyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}

function ChevronDown({ open }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function CheckCircle() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function XCircle() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function AlertTriangle() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function Header({ onBack }) {
  return (
    <header className="bg-white border-b border-[#E5E7EB] h-14 flex items-center px-6 flex-shrink-0">
      <div className="max-w-5xl mx-auto w-full flex items-center gap-2.5">
        <button onClick={onBack} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: TEAL }}>
            <MagnifyIcon />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-[#111827] text-sm tracking-tight">On-Page SEO Audit</span>
            <span className="text-[#9CA3AF] text-sm">· Arena</span>
          </div>
        </button>
      </div>
    </header>
  );
}

// ── Scorecard ─────────────────────────────────────────────────────────────────

function Scorecard({ audit }) {
  const counts = { pass: 0, fail: 0, warning: 0, manual: 0, na: 0 };
  (audit.sections || []).forEach(s => s.checks.forEach(c => { counts[c.status] = (counts[c.status] || 0) + 1; }));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const scored = counts.pass + counts.fail + counts.warning;
  const score = scored > 0 ? Math.round((counts.pass / scored) * 100) : 0;

  const scoreColor = score >= 80 ? '#065F46' : score >= 60 ? '#92400E' : '#991B1B';
  const scoreBg = score >= 80 ? '#D1FAE5' : score >= 60 ? '#FEF3C7' : '#FEE2E2';

  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-6 mb-6">
      <div className="flex flex-col md:flex-row md:items-center gap-6">
        <div className="flex-shrink-0 text-center">
          <div className="text-5xl font-bold" style={{ color: scoreColor }}>{score}</div>
          <div className="text-xs text-[#6B7280] mt-1">Score (pass%)</div>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-base font-semibold text-[#111827] truncate max-w-xs">{audit.url}</span>
            {audit.pageType && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#EDE9FE', color: '#5B21B6' }}>
                {audit.pageType}
              </span>
            )}
            {audit.isYMYL && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>YMYL</span>
            )}
          </div>
          <div className="text-xs text-[#6B7280] mb-3">
            Keywords: {(audit.primaryKeywords || []).join(', ')} · {new Date(audit.auditDate).toLocaleString()}
          </div>
          <div className="flex gap-4 flex-wrap">
            {[
              ['pass', counts.pass, '#065F46', '#D1FAE5'],
              ['fail', counts.fail, '#991B1B', '#FEE2E2'],
              ['warning', counts.warning, '#92400E', '#FEF3C7'],
              ['manual', counts.manual, '#1E40AF', '#DBEAFE'],
              ['na', counts.na, '#6B7280', '#F3F4F6'],
            ].map(([label, count, color, bg]) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-sm font-semibold" style={{ color }}>{count}</span>
                <span className="text-xs text-[#6B7280] capitalize">{label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-shrink-0 text-center rounded-lg px-5 py-3" style={{ backgroundColor: scoreBg }}>
          <div className="text-2xl font-bold" style={{ color: scoreColor }}>{score}%</div>
          <div className="text-xs mt-1" style={{ color: scoreColor }}>Pass Rate</div>
        </div>
      </div>
    </div>
  );
}

// ── Priority Action List ───────────────────────────────────────────────────────

function PriorityActions({ actions }) {
  if (!actions?.length) return null;
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] mb-6 overflow-hidden">
      <div className="px-6 py-4 border-b border-[#F3F4F6]">
        <h2 className="font-semibold text-[#111827] text-sm">Top Priority Actions</h2>
        <p className="text-xs text-[#6B7280] mt-0.5">Highest-impact fixes ordered by SEO priority</p>
      </div>
      <div className="divide-y divide-[#F3F4F6]">
        {actions.map((a, i) => (
          <div key={i} className="px-6 py-4 flex gap-4">
            <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ backgroundColor: a.status === 'fail' ? '#EF4444' : '#F59E0B' }}>
              {a.rank}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-sm font-semibold text-[#111827]">{a.issue}</span>
                <StatusBadge status={a.status} />
                <span className="text-xs text-[#9CA3AF]">{a.sectionName}</span>
              </div>
              <p className="text-xs text-[#6B7280] mb-1">{a.why}</p>
              <p className="text-xs text-[#374151] bg-[#F9FAFB] rounded px-3 py-2 border border-[#E5E7EB]">
                Fix: {a.fix}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Check row ─────────────────────────────────────────────────────────────────

function CheckRow({ check }) {
  const [open, setOpen] = useState(check.status === 'fail');
  const showExpand = check.evidence || check.recommendation;
  return (
    <div className="border-b border-[#F3F4F6] last:border-b-0">
      <button
        onClick={() => showExpand && setOpen(o => !o)}
        className={`w-full flex items-center gap-3 px-6 py-3 text-left ${showExpand ? 'hover:bg-[#FAFAFA] cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex-shrink-0 w-5 h-5" style={{ color: STATUS_COLORS[check.status]?.text || '#6B7280' }}>
          {check.status === 'pass' && <CheckCircle />}
          {check.status === 'fail' && <XCircle />}
          {(check.status === 'warning' || check.status === 'manual') && <AlertTriangle />}
        </div>
        <span className="flex-1 text-sm text-[#374151]">{check.label}</span>
        <StatusBadge status={check.status} />
        {showExpand && (
          <span className="flex-shrink-0 text-[#9CA3AF]">
            <ChevronDown open={open} />
          </span>
        )}
      </button>
      {open && showExpand && (
        <div className="px-6 pb-4 ml-8 space-y-2">
          {check.evidence && (
            <div className="text-xs bg-[#F9FAFB] border border-[#E5E7EB] rounded px-3 py-2 text-[#374151] font-mono whitespace-pre-wrap break-all">
              {check.evidence}
            </div>
          )}
          {check.recommendation && (
            <div className="text-xs text-[#374151] bg-[#EFF6FF] border border-[#BFDBFE] rounded px-3 py-2">
              <span className="font-semibold text-[#1E40AF]">Recommendation: </span>
              {check.recommendation}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

function SectionCard({ section }) {
  const [open, setOpen] = useState(section.status === 'fail' || section.status === 'warning');
  const c = STATUS_COLORS[section.status] || STATUS_COLORS.na;
  const counts = section.checks.reduce((acc, c) => { acc[c.status] = (acc[c.status] || 0) + 1; return acc; }, {});
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] mb-3 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-[#FAFAFA] transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold" style={{ color: c.text, backgroundColor: c.bg, padding: '2px 8px', borderRadius: 4 }}>{c.label}</span>
          <span className="text-sm font-semibold text-[#111827]">{section.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex gap-2 text-xs">
            {counts.fail > 0 && <span className="font-semibold" style={{ color: '#EF4444' }}>{counts.fail} fail</span>}
            {counts.warning > 0 && <span className="font-semibold" style={{ color: '#F59E0B' }}>{counts.warning} warn</span>}
            {counts.pass > 0 && <span className="font-semibold" style={{ color: '#10B981' }}>{counts.pass} pass</span>}
            {counts.manual > 0 && <span className="font-semibold" style={{ color: '#3B82F6' }}>{counts.manual} manual</span>}
          </div>
          <span className="text-[#9CA3AF]"><ChevronDown open={open} /></span>
        </div>
      </button>
      {open && (
        <div className="border-t border-[#F3F4F6]">
          {section.checks.map((c, i) => <CheckRow key={i} check={c} />)}
        </div>
      )}
    </div>
  );
}

// ── Manual Items Summary ──────────────────────────────────────────────────────

function ManualSummary({ items }) {
  if (!items?.length) return null;
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] mb-6 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-[#FAFAFA]"
        onClick={() => setOpen(o => !o)}
      >
        <div>
          <span className="text-sm font-semibold text-[#111827]">Manual Checks Summary</span>
          <span className="ml-2 text-xs text-[#6B7280]">{items.length} items require human verification</span>
        </div>
        <span className="text-[#9CA3AF]"><ChevronDown open={open} /></span>
      </button>
      {open && (
        <div className="divide-y divide-[#F3F4F6] border-t border-[#F3F4F6]">
          {items.map((item, i) => (
            <div key={i} className="px-6 py-4">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <StatusBadge status="manual" />
                <span className="text-xs text-[#9CA3AF]">{item.sectionName}</span>
                <span className="text-sm font-medium text-[#111827]">{item.label}</span>
              </div>
              {item.evidence && (
                <p className="text-xs text-[#6B7280] mb-1">{item.evidence}</p>
              )}
              {item.instructions && (
                <p className="text-xs text-[#1E40AF] bg-[#EFF6FF] rounded px-3 py-2 border border-[#BFDBFE]">{item.instructions}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Data errors banner ────────────────────────────────────────────────────────

function DataErrorsBanner({ errors }) {
  const entries = Object.entries(errors || {}).filter(([, v]) => v);
  if (!entries.length) return null;
  return (
    <div className="bg-[#FFFBEB] border border-[#FCD34D] rounded-lg px-4 py-3 mb-4 text-xs text-[#92400E]">
      <span className="font-semibold">Data collection warnings:</span>
      {entries.map(([k, v]) => (
        <span key={k} className="ml-2">{k}: {String(v).slice(0, 80)}</span>
      ))}
    </div>
  );
}

// ── Report view ───────────────────────────────────────────────────────────────

function ReportView({ audit, onNewAudit }) {
  return (
    <div className="max-w-4xl mx-auto px-4 pb-12">
      <div className="flex items-center justify-between py-5">
        <h1 className="text-lg font-bold text-[#111827]">Audit Report</h1>
        <button
          onClick={onNewAudit}
          className="text-sm px-4 py-2 rounded-lg font-medium text-white transition-colors"
          style={{ backgroundColor: TEAL }}
        >
          New Audit
        </button>
      </div>

      <DataErrorsBanner errors={audit.dataErrors} />
      <Scorecard audit={audit} />
      <PriorityActions actions={audit.priorityActions} />
      <ManualSummary items={audit.manualItems} />

      <h2 className="text-sm font-semibold text-[#111827] mb-3 mt-6">All {audit.sections?.length} Sections</h2>
      {(audit.sections || []).map((s, i) => <SectionCard key={i} section={s} />)}
    </div>
  );
}

// ── Progress screen ───────────────────────────────────────────────────────────

function ProgressScreen({ progress }) {
  return (
    <div className="max-w-xl mx-auto px-4 py-24 flex flex-col items-center text-center">
      <div className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin mb-6" style={{ borderColor: `${TEAL}40`, borderTopColor: TEAL }} />
      <h2 className="text-base font-semibold text-[#111827] mb-2">Running Audit…</h2>
      <p className="text-sm text-[#6B7280]">{progress || 'Initializing…'}</p>
      <p className="text-xs text-[#9CA3AF] mt-3">PageSpeed Insights can take 30–60 seconds. Please wait.</p>
    </div>
  );
}

// ── History list ──────────────────────────────────────────────────────────────

function HistoryList({ audits, onSelect, onDelete }) {
  if (!audits.length) return null;
  return (
    <div className="mt-8">
      <h3 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-3">Recent Audits</h3>
      <div className="space-y-2">
        {audits.map(a => (
          <div key={a.id} className="bg-white rounded-lg border border-[#E5E7EB] px-4 py-3 flex items-center gap-3 hover:shadow-sm transition-shadow">
            <button className="flex-1 text-left" onClick={() => onSelect(a.id)}>
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <span className="text-sm font-medium text-[#111827] truncate max-w-xs">{a.url}</span>
                {a.pageType && (
                  <span className="text-xs px-1.5 py-0 rounded text-[#5B21B6] bg-[#EDE9FE]">{a.pageType}</span>
                )}
                {a.status === 'failed' && (
                  <span className="text-xs px-1.5 py-0 rounded text-[#991B1B] bg-[#FEE2E2]">Failed</span>
                )}
              </div>
              <div className="text-xs text-[#9CA3AF]">
                {new Date(a.auditDate).toLocaleString()} · {a.failCount} fail · {a.passCount}/{a.totalSections} sections pass
              </div>
            </button>
            <button
              onClick={() => onDelete(a.id)}
              className="flex-shrink-0 text-[#9CA3AF] hover:text-[#EF4444] transition-colors text-xs"
              title="Delete"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Input form ────────────────────────────────────────────────────────────────

function InputForm({ onSubmit, loading }) {
  const [url, setUrl] = useState('');
  const [keywords, setKeywords] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const trimUrl = url.trim();
    if (!trimUrl || !/^https?:\/\/./.test(trimUrl)) {
      setError('Please enter a valid URL starting with http:// or https://');
      return;
    }
    const kws = keywords.split(',').map(k => k.trim()).filter(Boolean);
    if (!kws.length) {
      setError('Please enter at least one primary keyword');
      return;
    }
    onSubmit(trimUrl, kws);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-[#374151] mb-1.5">Page URL</label>
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://example.com/service-page/"
          disabled={loading}
          className="w-full border border-[#D1D5DB] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#3DAA8E] focus:ring-1 focus:ring-[#3DAA8E] disabled:opacity-50 bg-white"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-[#374151] mb-1.5">Primary Keywords <span className="text-[#9CA3AF] font-normal">(comma-separated, e.g. "dental implants, dental implants cost")</span></label>
        <input
          type="text"
          value={keywords}
          onChange={e => setKeywords(e.target.value)}
          placeholder="dental implants, dental implants near me"
          disabled={loading}
          className="w-full border border-[#D1D5DB] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#3DAA8E] focus:ring-1 focus:ring-[#3DAA8E] disabled:opacity-50 bg-white"
        />
      </div>
      {error && <p className="text-xs text-[#EF4444]">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: TEAL }}
      >
        {loading ? 'Running…' : 'Run Audit'}
      </button>
    </form>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OnPageAuditPage() {
  const [view, setView] = useState('input'); // input | progress | report
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState('');
  const [audit, setAudit] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    listAudits().then(setHistory).catch(() => {});
    return () => clearInterval(pollRef.current);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  async function handleSubmit(url, kws) {
    setLoading(true);
    setView('progress');
    setProgress('Starting…');
    try {
      const { jobId: jid } = await startAudit(url, kws);
      setJobId(jid);
      pollRef.current = setInterval(async () => {
        try {
          const job = await pollStatus(jid);
          setProgress(job.progress || '');
          if (job.status === 'complete') {
            stopPolling();
            const result = await getResult(job.auditId);
            setAudit(result);
            setView('report');
            setLoading(false);
            listAudits().then(setHistory).catch(() => {});
          } else if (job.status === 'failed') {
            stopPolling();
            setView('input');
            setLoading(false);
            alert(`Audit failed: ${job.error || 'Unknown error'}`);
          }
        } catch (err) {
          // network blip — keep polling
        }
      }, POLL_MS);
    } catch (err) {
      setView('input');
      setLoading(false);
      alert(`Failed to start audit: ${err.message}`);
    }
  }

  async function handleSelectHistory(auditId) {
    const result = await getResult(auditId);
    if (result) { setAudit(result); setView('report'); }
  }

  async function handleDeleteHistory(auditId) {
    await deleteAudit(auditId);
    setHistory(h => h.filter(a => a.id !== auditId));
  }

  function handleNewAudit() {
    setView('input');
    setAudit(null);
    setJobId(null);
    setProgress('');
  }

  return (
    <>
      {view === 'input' && (
        <main className="flex-1 flex items-start justify-center pt-12 px-4">
          <div className="w-full max-w-xl">
            <div className="bg-white rounded-xl border border-[#E5E7EB] p-8 shadow-sm">
              <div className="mb-6">
                <h1 className="text-xl font-bold text-[#111827] mb-1">On-Page SEO Audit</h1>
                <p className="text-sm text-[#6B7280]">
                  Run 23 sections of automated checks — URL, meta, headings, content, schema, Core Web Vitals, mobile, E-E-A-T, local SEO, and more. Live data from the page + PageSpeed Insights API.
                </p>
              </div>
              <InputForm onSubmit={handleSubmit} loading={loading} />
            </div>
            <HistoryList audits={history} onSelect={handleSelectHistory} onDelete={handleDeleteHistory} />
          </div>
        </main>
      )}

      {view === 'progress' && <ProgressScreen progress={progress} />}

      {view === 'report' && audit && (
        <main className="flex-1">
          <ReportView audit={audit} onNewAudit={handleNewAudit} />
        </main>
      )}
    </>
  );
}
