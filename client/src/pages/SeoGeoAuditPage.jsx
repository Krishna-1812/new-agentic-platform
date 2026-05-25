import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const STEPS = [
  { id: 'fetch',     label: 'Fetch Page' },
  { id: 'checks',    label: 'Run Checks' },
  { id: 'structure', label: 'Structure Findings' },
  { id: 'ai',        label: 'AI Analysis' },
];

const SEV_COLOR = {
  error:   { bg: '#FEF2F2', text: '#DC2626', border: '#FECACA', label: 'Error' },
  warning: { bg: '#FFFBEB', text: '#D97706', border: '#FDE68A', label: 'Warning' },
  notice:  { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE', label: 'Notice' },
  info:    { bg: '#F0FDF4', text: '#16A34A', border: '#BBF7D0', label: 'Info' },
};

const GEO_BADGE = {
  ready:      { bg: '#DCFCE7', text: '#15803D', label: 'GEO Ready' },
  needs_work: { bg: '#FFFBEB', text: '#B45309', label: 'Needs Work' },
  not_ready:  { bg: '#FEF2F2', text: '#DC2626', label: 'Not Ready' },
};

const EEAT_BADGE = {
  strong:   { bg: '#DCFCE7', text: '#15803D' },
  moderate: { bg: '#FFFBEB', text: '#B45309' },
  weak:     { bg: '#FEF2F2', text: '#DC2626' },
};

const PLATFORM_BADGE = {
  ready:     { bg: '#DCFCE7', text: '#15803D' },
  partial:   { bg: '#FFFBEB', text: '#B45309' },
  not_ready: { bg: '#FEF2F2', text: '#DC2626' },
};

function ScoreRing({ score, size = 80 }) {
  const r = (size / 2) - 8;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 70 ? '#16A34A' : score >= 45 ? '#D97706' : '#DC2626';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#E5E7EB" strokeWidth="7" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="7"
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`} />
      <text x={size/2} y={size/2+1} textAnchor="middle" dominantBaseline="middle"
        fontSize="16" fontWeight="700" fill={color}>{score}</text>
    </svg>
  );
}

function StepBar({ steps }) {
  return (
    <div className="flex gap-3 items-center flex-wrap">
      {STEPS.map(s => {
        const st = steps[s.id];
        const isDone = st?.status === 'done';
        const isActive = st?.status === 'active';
        const isError = st?.status === 'error';
        return (
          <div key={s.id} className="flex items-center gap-1.5 text-xs">
            <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
              isDone ? 'bg-green-500 text-white' : isActive ? 'bg-blue-600 text-white' : isError ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-400'
            }`}>
              {isDone ? '✓' : isActive ? (
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : isError ? '✕' : '·'}
            </span>
            <span className={isDone ? 'text-green-700' : isActive ? 'text-blue-700 font-medium' : isError ? 'text-red-600' : 'text-gray-400'}>
              {st?.message || s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SeverityBadge({ severity }) {
  const c = SEV_COLOR[severity] || SEV_COLOR.info;
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
      {c.label}
    </span>
  );
}

function ScoreBar({ label, score }) {
  const color = score >= 70 ? '#16A34A' : score >= 45 ? '#D97706' : '#DC2626';
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-32 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-bold w-8 text-right" style={{ color }}>{score}</span>
    </div>
  );
}

function IssueCard({ issue }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-[#E5E7EB] rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors"
      >
        <SeverityBadge severity={issue.severity} />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-[#111827]">{issue.issue || issue.id}</span>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{issue.current_state}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {issue.effort && (
            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">{issue.effort}</span>
          )}
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-[#E5E7EB] bg-gray-50 space-y-3">
          {issue.impact && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-3 mb-1">Impact</p>
              <p className="text-sm text-gray-700">{issue.impact}</p>
            </div>
          )}
          {issue.context_note && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-2 mb-0.5">Context Note</p>
              <p className="text-xs text-gray-500 italic border-l-2 border-gray-300 pl-2">{issue.context_note}</p>
            </div>
          )}
          {issue.fix && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Fix</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{issue.fix}</p>
            </div>
          )}
          {issue.code_example && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Code Example</p>
              <pre className="text-xs bg-[#1E293B] text-[#E2E8F0] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{issue.code_example}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RawCheckRow({ check }) {
  const statusColor = check.status === 'pass' ? '#16A34A' : check.status === 'fail' ? '#DC2626' : check.status === 'warning' ? '#D97706' : check.status === 'notice' ? '#2563EB' : '#9CA3AF';
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-100 last:border-0 text-sm">
      <span className="font-mono text-xs text-gray-400 w-8 shrink-0 pt-0.5">{check.id}</span>
      <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: statusColor }} />
      <div className="flex-1 min-w-0">
        <span className="text-[#111827] font-medium">{check.name}</span>
        {check.detail && <p className="text-xs text-gray-500 mt-0.5">{check.detail}</p>}
        {check.value && <p className="text-xs font-mono text-gray-400 mt-0.5 truncate">{String(check.value).substring(0, 120)}</p>}
      </div>
      {check.status !== 'pass' && check.status !== 'skipped' && (
        <SeverityBadge severity={check.severity} />
      )}
    </div>
  );
}

const CATEGORY_ORDER = [
  'Title Tag','Meta Description','Meta Robots','Canonical','Headings',
  'Content Quality','Images','Internal Links','External Links','Schema',
  'Open Graph','Hreflang','Technical','URL Signals','Page Speed',
  'Semantic HTML','Accessibility','E-E-A-T','Security','GEO Signals','Miscellaneous'
];

// ── IssuesBySeverity ─────────────────────────────────────────────────────────
function IssuesBySeverity({ ai, checksByCategory }) {
  const [errOpen, setErrOpen] = useState(true);
  const [warnOpen, setWarnOpen] = useState(true);
  const [noticeOpen, setNoticeOpen] = useState(false);

  const allIssues = (ai?.sections || []).flatMap(s =>
    (s.issues || []).map(i => ({ ...i, category: s.category }))
  );
  const errors  = allIssues.filter(i => i.severity === 'error');
  const warnings = allIssues.filter(i => i.severity === 'warning');
  const notices  = allIssues.filter(i => i.severity === 'notice');

  const Section = ({ label, items, color, bgColor, open, onToggle }) => (
    <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden mb-3">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color }}>{label}</span>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: bgColor, color }}>{items.length}</span>
        </div>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>
      {open && items.length > 0 && (
        <div className="px-4 pb-3 border-t border-gray-100 space-y-2 pt-3">
          {items.map((issue, i) => (
            <div key={i}>
              <IssueCard issue={issue} />
              {issue.category && <p className="text-xs text-gray-400 mt-0.5 pl-1">Category: {issue.category}</p>}
            </div>
          ))}
        </div>
      )}
      {open && items.length === 0 && (
        <p className="px-5 py-3 text-sm text-gray-400 border-t border-gray-100">No {label.toLowerCase()} found.</p>
      )}
    </div>
  );

  return (
    <div>
      <Section label="Errors"   items={errors}   color="#DC2626" bgColor="#FEE2E2" open={errOpen}    onToggle={() => setErrOpen(o => !o)} />
      <Section label="Warnings" items={warnings} color="#D97706" bgColor="#FEF3C7" open={warnOpen}   onToggle={() => setWarnOpen(o => !o)} />
      <Section label="Notices"  items={notices}  color="#2563EB" bgColor="#DBEAFE" open={noticeOpen} onToggle={() => setNoticeOpen(o => !o)} />
    </div>
  );
}

// ── AllChecksTable ────────────────────────────────────────────────────────────
function AllChecksTable({ findings }) {
  const [page, setPage] = useState(0);
  const PER_PAGE = 50;
  const checks = findings?.checks || [];
  const pageChecks = checks.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            {['ID', 'Category', 'Check', 'Status', 'Value'].map(h => (
              <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageChecks.map(c => {
            const statusColor = { pass: '#16A34A', fail: '#DC2626', warning: '#D97706', notice: '#2563EB', skipped: '#9CA3AF' }[c.status] || '#9CA3AF';
            return (
              <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-3 py-1.5 font-mono text-gray-400">{c.id}</td>
                <td className="px-3 py-1.5 text-gray-500">{c.category}</td>
                <td className="px-3 py-1.5 text-gray-700">{c.name}</td>
                <td className="px-3 py-1.5"><span className="font-semibold" style={{ color: statusColor }}>{c.status}</span></td>
                <td className="px-3 py-1.5 text-gray-400 font-mono truncate max-w-[200px]">{String(c.value || '').substring(0, 60)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 text-xs text-gray-500">
        <span>{checks.length} total checks</span>
        <div className="flex gap-1">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40">←</button>
          <span className="px-2 py-1">{page + 1} / {Math.ceil(checks.length / PER_PAGE) || 1}</span>
          <button onClick={() => setPage(p => Math.min(Math.ceil(checks.length / PER_PAGE) - 1, p + 1))} disabled={(page + 1) * PER_PAGE >= checks.length} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40">→</button>
        </div>
      </div>
    </div>
  );
}

// ── SchemaDetectedCard ────────────────────────────────────────────────────────
function SchemaDetectedCard({ schema }) {
  const [open, setOpen] = useState(false);
  const hasErrors = schema.validation_errors?.length > 0;
  const statusColor = schema.status === 'valid' ? '#16A34A' : schema.status === 'has_errors' ? '#DC2626' : '#D97706';
  return (
    <div className={`border rounded-lg overflow-hidden ${hasErrors ? 'border-red-200' : 'border-gray-200'}`}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#111827]">{schema.type}</span>
          <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{
            background: schema.status === 'valid' ? '#DCFCE7' : schema.status === 'has_errors' ? '#FEE2E2' : '#FEF3C7',
            color: statusColor
          }}>{schema.status?.replace('_', ' ')}</span>
          {hasErrors && <span className="text-xs text-red-600">{schema.validation_errors.length} error(s)</span>}
        </div>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-3 border-t border-gray-100 space-y-2">
          {schema.fields_missing?.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1">Missing fields</p>
              <div className="flex flex-wrap gap-1">
                {schema.fields_missing.map(f => (
                  <span key={f} className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">{f}</span>
                ))}
              </div>
            </div>
          )}
          {schema.validation_errors?.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1">Validation errors</p>
              {schema.validation_errors.map((err, i) => (
                <div key={i} className="text-xs bg-red-50 text-red-800 rounded p-2 mb-1">
                  <span className="font-semibold">{err.field}:</span> {err.error}
                  {err.fix && <p className="mt-1 font-mono text-red-700">→ {err.fix}</p>}
                </div>
              ))}
            </div>
          )}
          {schema.corrected_json_ld && (
            <div>
              <p className="text-xs text-gray-400 mb-1">Corrected JSON-LD</p>
              <pre className="text-xs bg-[#1E293B] text-[#E2E8F0] rounded p-3 overflow-x-auto whitespace-pre-wrap max-h-64">{schema.corrected_json_ld}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── SchemaRecommendedCard ─────────────────────────────────────────────────────
function SchemaRecommendedCard({ rec }) {
  const [open, setOpen] = useState(false);
  const priorityColor = rec.priority === 'required' ? '#DC2626' : rec.priority === 'recommended' ? '#D97706' : '#6B7280';
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#111827]">{rec.type}</span>
          <span className="text-xs font-semibold" style={{ color: priorityColor }}>{rec.priority}</span>
        </div>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-3 border-t border-gray-100 space-y-2">
          {rec.reason && <p className="text-sm text-gray-600">{rec.reason}</p>}
          {rec.key_fields?.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1">Key fields to include</p>
              <div className="flex flex-wrap gap-1">
                {rec.key_fields.map(f => (
                  <span key={f} className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">{f}</span>
                ))}
              </div>
            </div>
          )}
          {rec.starter_template && (
            <div>
              <p className="text-xs text-gray-400 mb-1">Starter template</p>
              <pre className="text-xs bg-[#1E293B] text-[#E2E8F0] rounded p-3 overflow-x-auto whitespace-pre-wrap max-h-48">{rec.starter_template}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── downloadReport (7 sheets) ─────────────────────────────────────────────────
function downloadReport(findings, ai) {
  const wb = XLSX.utils.book_new();

  const statusFill = (status) => {
    const fills = {
      pass:    { fgColor: { rgb: 'D1FAE5' } },
      fail:    { fgColor: { rgb: 'FEE2E2' } },
      warning: { fgColor: { rgb: 'FEF3C7' } },
      notice:  { fgColor: { rgb: 'DBEAFE' } },
      skipped: { fgColor: { rgb: 'F3F4F6' } },
      na:      { fgColor: { rgb: 'F3F4F6' } },
    };
    return fills[status] || fills.skipped;
  };

  // Sheet 1: Summary
  const summaryRows = [
    ['SEO & GEO Audit Report', ''],
    [''],
    ['Field', 'Value'],
    ['URL', findings.meta.url],
    ['Page Type', findings.meta.page_type || '—'],
    ['Content Vertical', findings.meta.content_vertical || '—'],
    ['Is YMYL', findings.meta.is_ymyl ? 'Yes' : 'No'],
    ['Audit Date', new Date(findings.meta.fetch_timestamp).toLocaleString()],
    ['HTTP Status', findings.meta.http_status ?? '—'],
    ['HTML Size', `${Math.round(findings.meta.html_size_bytes / 1024)}KB`],
    ['Total Checks', findings.meta.total_checks_run],
    ['Errors', findings.meta.errors],
    ['Warnings', findings.meta.warnings],
    ['Notices', findings.meta.notices],
    ['Passed', findings.meta.passed],
    ['Keywords Audited', (findings.meta.keywords || []).join(', ') || '(none)'],
    [''],
    ['Scores', ''],
    ['Overall Score', findings.scores.overall],
    ['Title & Meta', findings.scores.title_meta],
    ['Content', findings.scores.content_structure],
    ['Technical', findings.scores.technical],
    ['Schema', findings.scores.schema],
    ['GEO Signals', findings.scores.geo_signals],
    ['E-E-A-T', findings.scores.eeat],
    [''],
    ['AI Assessment', ''],
    ['GEO Readiness', ai?.summary?.geo_readiness ?? '—'],
    ['E-E-A-T Strength', ai?.summary?.eeat_strength ?? '—'],
    ['Priority Verdict', ai?.summary?.priority_verdict ?? '—'],
    [''],
    ['Quick Wins', ''],
    ...(ai?.summary?.quick_wins ?? []).map((w, i) => [`${i + 1}`, w]),
    [''],
    ['CSQAF Score', ai?.geo_analysis?.csqaf_breakdown?.total ?? '—'],
    ['Citations (C)', ai?.geo_analysis?.csqaf_breakdown?.citations_c ?? '—'],
    ['Statistics (S)', ai?.geo_analysis?.csqaf_breakdown?.statistics_s ?? '—'],
    ['Quotations (Q)', ai?.geo_analysis?.csqaf_breakdown?.quotations_q ?? '—'],
    ['Authoritativeness (A)', ai?.geo_analysis?.csqaf_breakdown?.authoritativeness_a ?? '—'],
    ['Fluency (F)', ai?.geo_analysis?.csqaf_breakdown?.fluency_f ?? '—'],
  ];

  // Sheet 2: Keyword Analysis (only if keywords provided)
  const kwRows = [['ID', 'Check', 'Keyword', 'Status', 'Found Value', 'Fix']];
  for (const c of findings.kwChecks || []) {
    kwRows.push([c.id, c.name, (findings.meta.keywords || []).join(', '), c.status, c.value ?? '', c.detail ?? '']);
  }

  // Sheet 3: Issues (errors + warnings)
  const issueRowsMain = [['Category', 'ID', 'Severity', 'Issue', 'Current State', 'Impact', 'Context Note', 'Fix', 'Code Example', 'Effort', 'Priority']];
  for (const section of ai?.sections ?? []) {
    for (const issue of section.issues ?? []) {
      if (issue.severity === 'error' || issue.severity === 'warning') {
        issueRowsMain.push([
          section.category ?? '',
          issue.id ?? '',
          issue.severity ?? '',
          issue.issue ?? '',
          issue.current_state ?? '',
          issue.impact ?? '',
          issue.context_note ?? '',
          issue.fix ?? '',
          issue.code_example ?? '',
          issue.effort ?? '',
          issue.priority ?? '',
        ]);
      }
    }
  }

  // Sheet 4: Notices
  const noticeRows = [['Category', 'ID', 'Issue', 'Current State', 'Fix', 'Effort']];
  for (const section of ai?.sections ?? []) {
    for (const issue of section.issues ?? []) {
      if (issue.severity === 'notice') {
        noticeRows.push([section.category ?? '', issue.id ?? '', issue.issue ?? '', issue.current_state ?? '', issue.fix ?? '', issue.effort ?? '']);
      }
    }
  }

  // Sheet 5: All Checks
  const checkRows = [['ID', 'Category', 'Name', 'Status', 'Severity', 'Value', 'Detail']];
  for (const c of findings.checks ?? []) {
    checkRows.push([c.id, c.category, c.name, c.status, c.severity, c.value ?? '', c.detail ?? '']);
  }

  // Sheet 6: Schema Analysis
  const schemaRows = [['Schema Analysis', '']];
  schemaRows.push([''], ['Detected Schemas', '']);
  for (const s of ai?.schema_analysis?.detected ?? []) {
    schemaRows.push([s.type, s.status]);
    schemaRows.push(['Fields Present', (s.fields_present || []).join(', ')]);
    schemaRows.push(['Fields Missing', (s.fields_missing || []).join(', ')]);
    for (const err of s.validation_errors || []) {
      schemaRows.push([`Error: ${err.field}`, err.error]);
      if (err.fix) schemaRows.push(['Fix', err.fix]);
    }
    if (s.corrected_json_ld) schemaRows.push(['Corrected JSON-LD', s.corrected_json_ld]);
    schemaRows.push(['']);
  }
  schemaRows.push(['Recommended Schemas', '']);
  for (const r of ai?.schema_analysis?.recommended ?? []) {
    schemaRows.push([r.type, r.relevant ? r.priority : 'NOT RELEVANT']);
    if (r.reason) schemaRows.push(['Reason', r.reason]);
    if (r.starter_template) schemaRows.push(['Starter Template', r.starter_template]);
    schemaRows.push(['']);
  }

  // Sheet 7: GEO & Content
  const pr = ai?.geo_analysis?.platform_readiness ?? {};
  const cr = ai?.content_recommendations ?? {};
  const geoRows = [
    ['Platform Readiness', ''],
    ['Google AIO', pr.google_aio ?? '—'],
    ['ChatGPT', pr.chatgpt ?? '—'],
    ['Perplexity', pr.perplexity ?? '—'],
    ['Claude', pr.claude_ai ?? '—'],
    ['Gemini', pr.gemini ?? '—'],
    ['Copilot', pr.copilot ?? '—'],
    [''],
    ['Top GEO Fix', ai?.geo_analysis?.top_geo_fix ?? '—'],
    [''],
    ['Content Recommendations', ''],
    ['Rewrite Priority', cr.rewrite_priority ?? '—'],
    ['Statistics to Add', cr.statistics_to_add ?? '—'],
    ['Expert Quote Guidance', cr.expert_quote_guidance ?? '—'],
    ['FAQ Recommendations', cr.faq_recommendation ?? '—'],
    ['Word Count Verdict', cr.word_count_verdict ?? '—'],
  ];

  const wsCols = (rows) => {
    const maxLen = {};
    rows.forEach(row => row.forEach((cell, i) => {
      maxLen[i] = Math.min(80, Math.max(maxLen[i] ?? 10, String(cell ?? '').length + 2));
    }));
    return Object.values(maxLen).map(w => ({ wch: w }));
  };

  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
  const ws2 = XLSX.utils.aoa_to_sheet(kwRows);
  const ws3 = XLSX.utils.aoa_to_sheet(issueRowsMain);
  const ws4 = XLSX.utils.aoa_to_sheet(noticeRows);
  const ws5 = XLSX.utils.aoa_to_sheet(checkRows);
  const ws6 = XLSX.utils.aoa_to_sheet(schemaRows);
  const ws7 = XLSX.utils.aoa_to_sheet(geoRows);

  [ws1, ws2, ws3, ws4, ws5, ws6, ws7].forEach((ws, idx) => {
    const rows = [summaryRows, kwRows, issueRowsMain, noticeRows, checkRows, schemaRows, geoRows][idx];
    ws['!cols'] = wsCols(rows);
  });

  // Color-code the status column in All Checks sheet (column D = index 3)
  for (let r = 1; r < checkRows.length; r++) {
    const status = checkRows[r][3];
    const cellRef = XLSX.utils.encode_cell({ r, c: 3 });
    if (ws5[cellRef]) {
      ws5[cellRef].s = {
        fill: statusFill(status),
        font: { color: { rgb: status === 'pass' ? '065F46' : status === 'fail' ? '991B1B' : status === 'warning' ? '92400E' : '1E40AF' } }
      };
    }
  }

  const sheetNames = ['Summary', 'Keyword Analysis', 'Errors & Warnings', 'Notices', 'All Checks', 'Schema Analysis', 'GEO & Content'];
  [ws1, ws2, ws3, ws4, ws5, ws6, ws7].forEach((ws, i) => XLSX.utils.book_append_sheet(wb, ws, sheetNames[i]));

  const domain = (() => { try { return new URL(findings.meta.url).hostname.replace(/^www\./, ''); } catch { return 'audit'; } })();
  const date = new Date().toISOString().slice(0, 10);
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveAs(new Blob([buf], { type: 'application/octet-stream' }), `seo-geo-audit-${domain}-${date}.xlsx`);
}

// ── Main page component ───────────────────────────────────────────────────────
export default function SeoGeoAuditPage() {
  const navigate = useNavigate();
  const [inputType, setInputType] = useState('url');
  const [urlInput, setUrlInput] = useState('');
  const [htmlInput, setHtmlInput] = useState('');
  const [keyword1, setKeyword1] = useState('');
  const [keyword2, setKeyword2] = useState('');
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState({});
  const [findings, setFindings] = useState(null);
  const [ai, setAi] = useState(null);
  const [error, setError] = useState('');
  const [activePanel, setActivePanel] = useState('dashboard');
  const [expandedCats, setExpandedCats] = useState({});
  const [issueTab, setIssueTab] = useState('severity');
  const esRef = useRef(null);

  function reset() {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setRunning(false); setSteps({}); setFindings(null); setAi(null); setError('');
    // keywords intentionally not reset so users can re-run
  }

  async function runAudit() {
    reset();
    setRunning(true);
    setError('');

    const keywords = [keyword1.trim(), keyword2.trim()].filter(Boolean);
    const body = inputType === 'url'
      ? { url: urlInput.trim(), keywords }
      : { html: htmlInput.trim(), keywords };

    try {
      const resp = await fetch('/api/seo-geo-audit/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Request failed' }));
        setError(err.error || 'Audit request failed');
        setRunning(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = null; // persists across read() chunks

      const processEvents = (text) => {
        buffer += text;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === 'step') {
                setSteps(prev => ({ ...prev, [data.id]: data }));
              } else if (currentEvent === 'result') {
                setFindings(data.findings);
                setAi(data.ai);
                setRunning(false);
                setActivePanel('dashboard');
              } else if (currentEvent === 'error') {
                setError(data.message);
                setRunning(false);
              }
            } catch {}
            currentEvent = null;
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        processEvents(decoder.decode(value, { stream: true }));
      }
      setRunning(false);
    } catch (err) {
      setError(err.message || 'Connection failed');
      setRunning(false);
    }
  }

  // Group raw checks by category
  const checksByCategory = {};
  if (findings?.checks) {
    for (const c of findings.checks) {
      const cat = c.category || 'Other';
      if (!checksByCategory[cat]) checksByCategory[cat] = [];
      checksByCategory[cat].push(c);
    }
  }

  // Group AI issues by category
  const aiByCategory = {};
  if (ai?.sections) {
    for (const sec of ai.sections) {
      aiByCategory[sec.category] = sec;
    }
  }

  const scores = findings?.scores;
  const aiSummary = ai?.summary;

  const orderedCats = CATEGORY_ORDER.filter(c => checksByCategory[c]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F4F5F7' }}>
      {/* Header */}
      <header className="bg-white border-b border-[#E5E7EB] h-14 flex items-center px-6">
        <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="text-gray-400 hover:text-gray-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: '#3DAA8E' }}>
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span className="font-bold text-[#111827] text-sm">SEO & GEO Audit</span>
          </div>
          {findings && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => downloadReport(findings, ai)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-colors"
                style={{ backgroundColor: '#3DAA8E' }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Report
              </button>
              <button onClick={reset} className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg">
                New Audit
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">

        {/* Input panel */}
        {!findings && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-xl border border-[#E5E7EB] p-6" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
              <h1 className="text-lg font-bold text-[#111827] mb-1">SEO & GEO Audit</h1>
              <p className="text-sm text-gray-500 mb-5">Run 200+ checks across all SEO and GEO parameters. Get a scored report with AI-powered recommendations.</p>

              {/* Primary Keywords */}
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Primary Keywords (optional)</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={keyword1}
                    onChange={e => setKeyword1(e.target.value)}
                    placeholder="e.g. dentist brockton ma"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3DAA8E]"
                  />
                  <input
                    type="text"
                    value={keyword2}
                    onChange={e => setKeyword2(e.target.value)}
                    placeholder="Secondary keyword (optional)"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3DAA8E]"
                  />
                </div>
              </div>

              {/* URL / HTML toggle */}
              <div className="flex gap-2 mb-4">
                {[['url', 'URL'], ['html', 'Paste HTML']].map(([t, l]) => (
                  <button key={t} onClick={() => setInputType(t)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${inputType === t ? 'border-[#3DAA8E] text-[#3DAA8E] bg-[#3DAA8E0D]' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                    {l}
                  </button>
                ))}
              </div>

              {inputType === 'url' ? (
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={urlInput}
                    onChange={e => setUrlInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !running && urlInput.trim() && runAudit()}
                    placeholder="https://example.com/page"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3DAA8E] focus:border-transparent"
                  />
                  <button
                    onClick={runAudit}
                    disabled={running || !urlInput.trim()}
                    className="px-5 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50"
                    style={{ backgroundColor: '#3DAA8E' }}
                  >
                    {running ? 'Running…' : 'Audit'}
                  </button>
                </div>
              ) : (
                <div>
                  <textarea
                    value={htmlInput}
                    onChange={e => setHtmlInput(e.target.value)}
                    placeholder="Paste raw HTML here…"
                    rows={8}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#3DAA8E] focus:border-transparent resize-none"
                  />
                  <button
                    onClick={runAudit}
                    disabled={running || !htmlInput.trim()}
                    className="mt-2 w-full py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50"
                    style={{ backgroundColor: '#3DAA8E' }}
                  >
                    {running ? 'Running…' : 'Audit HTML'}
                  </button>
                </div>
              )}

              {error && <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

              {running && (
                <div className="mt-5 p-4 bg-gray-50 rounded-lg">
                  <StepBar steps={steps} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Results */}
        {findings && (
          <div>
            {/* Meta bar */}
            <div className="bg-white rounded-xl border border-[#E5E7EB] px-5 py-3 mb-4 flex items-center gap-4 flex-wrap text-xs text-gray-500" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
              <span className="font-mono text-[#111827] truncate max-w-xs">{findings.meta.url}</span>
              <span>HTTP {findings.meta.http_status || '—'}</span>
              <span>{Math.round(findings.meta.html_size_bytes / 1024)}KB</span>
              <span>{findings.meta.fetch_time_ms}ms</span>
              <span>{findings.meta.total_checks_run} checks</span>
              <span className="text-red-600 font-medium">{findings.meta.errors} errors</span>
              <span className="text-amber-600 font-medium">{findings.meta.warnings} warnings</span>
              <span className="text-blue-600">{findings.meta.notices} notices</span>
              <span className="text-green-600">{findings.meta.passed} passed</span>
              {findings.meta.page_type && findings.meta.page_type !== 'unknown' && (
                <span className="font-medium capitalize" style={{ color: '#3DAA8E' }}>
                  {findings.meta.page_type.replace('_', ' ')} page
                  {findings.meta.is_ymyl ? ' · YMYL' : ''}
                </span>
              )}
              {findings.meta.keywords?.length > 0 && (
                <span className="text-[#3DAA8E]">KW: {findings.meta.keywords.join(', ')}</span>
              )}
            </div>

            {/* Panel tabs */}
            <div className="flex gap-1 mb-4">
              {[
                { id: 'dashboard', label: 'Score Dashboard' },
                { id: 'issues',    label: 'Issues' },
                { id: 'geo',       label: 'GEO & Content' },
              ].map(p => (
                <button key={p.id} onClick={() => setActivePanel(p.id)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activePanel === p.id ? 'bg-white text-[#111827] border border-[#E5E7EB] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {p.label}
                </button>
              ))}
            </div>

            {/* ── Panel 1: Score Dashboard ── */}
            {activePanel === 'dashboard' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                {/* Overall score */}
                <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 lg:col-span-1" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Overall Score</p>
                  <div className="flex items-center gap-4 mb-5">
                    <ScoreRing score={scores.overall} size={88} />
                    <div>
                      {aiSummary?.geo_readiness && (
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full block mb-2"
                          style={{ background: GEO_BADGE[aiSummary.geo_readiness]?.bg, color: GEO_BADGE[aiSummary.geo_readiness]?.text }}>
                          {GEO_BADGE[aiSummary.geo_readiness]?.label}
                        </span>
                      )}
                      {aiSummary?.eeat_strength && (
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full block"
                          style={{ background: EEAT_BADGE[aiSummary.eeat_strength]?.bg, color: EEAT_BADGE[aiSummary.eeat_strength]?.text }}>
                          E-E-A-T: {aiSummary.eeat_strength}
                        </span>
                      )}
                    </div>
                  </div>

                  {aiSummary?.priority_verdict && (
                    <div className="bg-red-50 border border-red-100 rounded-lg p-3 mb-4">
                      <p className="text-xs font-semibold text-red-700 mb-1">Priority Issue</p>
                      <p className="text-sm text-red-800">{aiSummary.priority_verdict}</p>
                    </div>
                  )}

                  <div className="space-y-2.5">
                    <ScoreBar label="Title & Meta" score={scores.title_meta} />
                    <ScoreBar label="Content" score={scores.content_structure} />
                    <ScoreBar label="Technical" score={scores.technical} />
                    <ScoreBar label="Schema" score={scores.schema} />
                    <ScoreBar label="GEO Signals" score={scores.geo_signals} />
                    <ScoreBar label="E-E-A-T" score={scores.eeat} />
                  </div>
                </div>

                {/* Quick wins + keyword analysis + CSQAF + GEO signals */}
                <div className="space-y-4 lg:col-span-2">

                  {aiSummary?.quick_wins?.length > 0 && (
                    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Quick Wins</p>
                      <ul className="space-y-2">
                        {aiSummary.quick_wins.map((w, i) => (
                          <li key={i} className="flex gap-2.5 text-sm">
                            <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 text-white" style={{ backgroundColor: '#3DAA8E' }}>{i + 1}</span>
                            <span className="text-gray-700">{w}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Keyword Analysis */}
                  {findings.meta.keywords?.length > 0 && findings.kwChecks?.length > 0 && (
                    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                        Keyword Analysis — "{findings.meta.keywords[0]}"
                      </p>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        {[
                          ['Title', findings.kwChecks.find(c => c.id === 'KW1')],
                          ['H1', findings.kwChecks.find(c => c.id === 'KW2')],
                          ['Meta Desc', findings.kwChecks.find(c => c.id === 'KW3')],
                          ['Density', findings.kwChecks.find(c => c.id === 'KW8')],
                          ['URL', findings.kwChecks.find(c => c.id === 'KW5')],
                          ['H2', findings.kwChecks.find(c => c.id === 'KW6')],
                          ['Alt Text', findings.kwChecks.find(c => c.id === 'KW7')],
                          ['Schema', findings.kwChecks.find(c => c.id === 'KW9')],
                        ].map(([label, chk]) => {
                          if (!chk) return null;
                          const statusColor = { pass: '#16A34A', fail: '#DC2626', warning: '#D97706', notice: '#2563EB', skipped: '#9CA3AF' }[chk.status] || '#9CA3AF';
                          const statusIcon = chk.status === 'pass' ? '✓' : chk.status === 'fail' ? '✕' : '~';
                          return (
                            <div key={label} className="flex items-center gap-2 text-xs border border-gray-100 rounded p-2">
                              <span className="font-bold" style={{ color: statusColor }}>{statusIcon}</span>
                              <span className="text-gray-600">{label}</span>
                            </div>
                          );
                        })}
                      </div>
                      {ai?.keyword_analysis && (
                        <p className="text-xs text-gray-600 italic">{ai.keyword_analysis.summary}</p>
                      )}
                    </div>
                  )}

                  {/* CSQAF */}
                  {ai?.geo_analysis?.csqaf_breakdown && (
                    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">CSQAF Score</p>
                        <span className="text-2xl font-bold text-[#111827]">{ai.geo_analysis.csqaf_breakdown.total}</span>
                      </div>
                      <div className="grid grid-cols-5 gap-2">
                        {[
                          ['C', 'Citations', ai.geo_analysis.csqaf_breakdown.citations_c],
                          ['S', 'Statistics', ai.geo_analysis.csqaf_breakdown.statistics_s],
                          ['Q', 'Quotes', ai.geo_analysis.csqaf_breakdown.quotations_q],
                          ['A', 'Authority', ai.geo_analysis.csqaf_breakdown.authoritativeness_a],
                          ['F', 'Fluency', ai.geo_analysis.csqaf_breakdown.fluency_f],
                        ].map(([letter, name, val]) => (
                          <div key={letter} className="bg-gray-50 rounded-lg p-2.5 text-center">
                            <div className="text-lg font-bold text-[#111827]">{letter}</div>
                            <div className="text-xs text-gray-500">{name}</div>
                            <div className="text-xs font-semibold text-[#3DAA8E] mt-1">{val?.split(' ')[0] || '—'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* GEO data from raw checks */}
                  {findings.geo && (
                    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">GEO Signals</p>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          ['Stats', findings.geo.statistics_count, findings.geo.statistics_count >= 4],
                          ['Expert Quotes', findings.geo.expert_quotes, findings.geo.expert_quotes > 0],
                          ['Named Author', findings.geo.named_author ? 'Yes' : 'No', findings.geo.named_author],
                          ['Primary Sources', findings.geo.primary_source_citations, findings.geo.primary_source_citations > 0],
                          ['HTML Tables', findings.geo.html_tables, findings.geo.html_tables > 0],
                          ['FAQ Section', findings.geo.faq_section ? 'Yes' : 'No', findings.geo.faq_section],
                          ['BLUF Opening', findings.geo.direct_answer_opening ? 'Yes' : 'No', findings.geo.direct_answer_opening],
                          ['Promo Words', findings.geo.promotional_language_count, findings.geo.promotional_language_count === 0],
                          ['CSQAF', `${findings.geo.csqaf_score}/10`, findings.geo.csqaf_score >= 7],
                        ].map(([label, val, good]) => (
                          <div key={label} className="flex flex-col items-center bg-gray-50 rounded-lg p-2.5">
                            <span className="text-lg font-bold" style={{ color: good ? '#16A34A' : '#DC2626' }}>{String(val)}</span>
                            <span className="text-xs text-gray-500 text-center mt-0.5">{label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Panel 2: Issues (3-tab layout) ── */}
            {activePanel === 'issues' && (
              <div>
                {/* Tab switcher */}
                <div className="flex gap-1 mb-3">
                  {[['severity', 'By Severity'], ['category', 'By Category'], ['all', 'All Checks']].map(([id, label]) => (
                    <button key={id} onClick={() => setIssueTab(id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${issueTab === id ? 'bg-white border-[#E5E7EB] text-[#111827] shadow-sm' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* Tab 1: By Severity */}
                {issueTab === 'severity' && (
                  <IssuesBySeverity ai={ai} checksByCategory={checksByCategory} />
                )}

                {/* Tab 2: By Category */}
                {issueTab === 'category' && (
                  <div className="space-y-3">
                    {orderedCats.map(cat => {
                      const catChecks = checksByCategory[cat] || [];
                      const aiCat = aiByCategory[cat] || aiByCategory[cat?.replace(/ /g, '_')];
                      const failures = catChecks.filter(c => c.status !== 'pass' && c.status !== 'skipped');
                      const isExpanded = expandedCats[cat] !== false;

                      return (
                        <div key={cat} className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                          <button
                            onClick={() => setExpandedCats(prev => ({ ...prev, [cat]: !isExpanded }))}
                            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <span className="font-semibold text-sm text-[#111827]">{cat}</span>
                              {failures.filter(c => c.severity === 'error').length > 0 && (
                                <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">{failures.filter(c => c.severity === 'error').length} error</span>
                              )}
                              {failures.filter(c => c.severity === 'warning' || c.status === 'warning').length > 0 && (
                                <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{failures.filter(c => c.severity === 'warning' || c.status === 'warning').length} warn</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              {aiCat?.score !== undefined && (
                                <span className="text-sm font-bold" style={{ color: aiCat.score >= 70 ? '#16A34A' : aiCat.score >= 45 ? '#D97706' : '#DC2626' }}>{aiCat.score}</span>
                              )}
                              <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="border-t border-[#E5E7EB]">
                              {/* AI issues first */}
                              {aiCat?.issues?.length > 0 && (
                                <div className="p-4 border-b border-gray-100">
                                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">AI Recommendations</p>
                                  <div className="space-y-2">
                                    {aiCat.issues.sort((a, b) => (a.priority || 99) - (b.priority || 99)).map((issue, i) => (
                                      <IssueCard key={i} issue={issue} />
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Raw check results */}
                              <div className="px-4 pb-2">
                                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-3 mb-1">All Checks</p>
                                {catChecks.map(c => <RawCheckRow key={c.id} check={c} />)}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Tab 3: All Checks */}
                {issueTab === 'all' && (
                  <AllChecksTable findings={findings} />
                )}
              </div>
            )}

            {/* ── Panel 3: GEO & Content ── */}
            {activePanel === 'geo' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                {/* Platform readiness */}
                {ai?.geo_analysis?.platform_readiness && (
                  <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 lg:col-span-2" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Platform Readiness</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {Object.entries({
                        'Google AIO': ai.geo_analysis.platform_readiness.google_aio,
                        'ChatGPT': ai.geo_analysis.platform_readiness.chatgpt,
                        'Perplexity': ai.geo_analysis.platform_readiness.perplexity,
                        'Claude': ai.geo_analysis.platform_readiness.claude_ai,
                        'Gemini': ai.geo_analysis.platform_readiness.gemini,
                        'Copilot': ai.geo_analysis.platform_readiness.copilot,
                      }).map(([platform, value]) => {
                        const status = typeof value === 'string' ? value.split(' ')[0]?.toLowerCase().replace('not_ready', 'not_ready') : 'partial';
                        const normalized = status === 'not_ready' || value?.toLowerCase().startsWith('not_ready') ? 'not_ready' : status;
                        const badgeStyle = PLATFORM_BADGE[normalized] || PLATFORM_BADGE.partial;
                        return (
                          <div key={platform} className="border border-gray-100 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-semibold text-[#111827]">{platform}</span>
                              <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: badgeStyle.bg, color: badgeStyle.text }}>
                                {normalized === 'not_ready' ? 'Not Ready' : normalized.charAt(0).toUpperCase() + normalized.slice(1)}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 leading-relaxed">{typeof value === 'string' ? value.replace(/^(ready|partial|not_ready)\s*—?\s*/i, '') : ''}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Top GEO fix */}
                {ai?.geo_analysis?.top_geo_fix && (
                  <div className="bg-white rounded-xl border border-[#3DAA8E] p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#3DAA8E' }}>Top GEO Fix</p>
                    <p className="text-sm text-gray-700">{ai.geo_analysis.top_geo_fix}</p>
                  </div>
                )}

                {/* Schema Analysis (richer version) */}
                {(ai?.schema_analysis || findings?.detectedSchemas?.length > 0) && (
                  <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 lg:col-span-2" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Schema Analysis</p>

                    {/* Detected schemas */}
                    {ai?.schema_analysis?.detected?.length > 0 && (
                      <div className="mb-4">
                        <p className="text-xs text-gray-500 font-medium mb-2">Detected</p>
                        <div className="space-y-2">
                          {ai.schema_analysis.detected.map((schema, i) => (
                            <SchemaDetectedCard key={i} schema={schema} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Recommended schemas */}
                    {ai?.schema_analysis?.recommended?.filter(r => r.relevant !== false).length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 font-medium mb-2">Recommended / Missing</p>
                        <div className="space-y-2">
                          {ai.schema_analysis.recommended.filter(r => r.relevant !== false).map((rec, i) => (
                            <SchemaRecommendedCard key={i} rec={rec} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Content recommendations */}
                {ai?.content_recommendations && (
                  <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 lg:col-span-2" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Content Recommendations</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {[
                        ['Rewrite Priority', ai.content_recommendations.rewrite_priority],
                        ['Statistics to Add', ai.content_recommendations.statistics_to_add],
                        ['Expert Quote Guidance', ai.content_recommendations.expert_quote_guidance],
                        ['Word Count Verdict', ai.content_recommendations.word_count_verdict],
                      ].filter(([, v]) => v).map(([label, value]) => (
                        <div key={label} className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs font-semibold text-gray-500 mb-1">{label}</p>
                          <p className="text-sm text-gray-700">{value}</p>
                        </div>
                      ))}
                      {ai.content_recommendations.faq_recommendation && (
                        <div className="bg-gray-50 rounded-lg p-3 md:col-span-2">
                          <p className="text-xs font-semibold text-gray-500 mb-1">FAQ Recommendations</p>
                          <p className="text-sm text-gray-700 whitespace-pre-line">{ai.content_recommendations.faq_recommendation}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* No AI analysis fallback */}
                {!ai && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 lg:col-span-2">
                    <p className="text-sm font-semibold text-amber-800 mb-1">AI analysis unavailable</p>
                    <p className="text-sm text-amber-700">The GPT-4o mini analysis did not complete. Raw check results are available in the Issues tab.</p>
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
