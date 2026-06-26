import { useState, useEffect, useCallback, useRef } from 'react';
import MorningTriageView from '../components/teamInsights/MorningTriageView';
import MondayPlanningView from '../components/teamInsights/MondayPlanningView';
import WeeklyReviewView from '../components/teamInsights/WeeklyReviewView';
import ClientHealthView from '../components/teamInsights/ClientHealthView';
import TeamHealthView from '../components/teamInsights/TeamHealthView';
import TaskDrawer from '../components/teamInsights/TaskDrawer';

const VIEWS = [
  { id: 'morning-triage',   label: 'Morning Triage' },
  { id: 'monday-planning',  label: 'Monday Planning' },
  { id: 'weekly-review',    label: 'Weekly Review' },
  { id: 'client-health',    label: 'Client Health' },
  { id: 'team-health',      label: 'Team Health' },
];

// ── Multi-select dropdown ─────────────────────────────────────────────────────
function MultiSelect({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const toggle = (opt) => {
    if (value.includes(opt)) onChange(value.filter(v => v !== opt));
    else onChange([...value, opt]);
  };

  const displayLabel = value.length === 0 || value.length === options.length
    ? `All ${label}`
    : value.length === 1 ? value[0] : `${value.length} ${label}`;

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          fontSize: '0.875rem',
          color: 'var(--text)',
          cursor: 'pointer',
          transition: 'border-color 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--primary)'}
        onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
      >
        <span>{displayLabel}</span>
        <svg
          style={{
            width: '14px',
            height: '14px',
            color: 'var(--text-3)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
            flexShrink: 0,
          }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 50,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
            minWidth: '160px',
            padding: '4px 0',
            maxHeight: '256px',
            overflowY: 'auto',
          }}
        >
          <button
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '6px 12px',
              fontSize: '0.75rem',
              color: 'var(--text-2)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
            onClick={() => onChange([])}
          >
            Select all
          </button>
          {options.map(opt => (
            <label
              key={opt}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <input
                type="checkbox"
                checked={value.includes(opt)}
                onChange={() => toggle(opt)}
                style={{ width: '14px', height: '14px', accentColor: 'var(--primary)' }}
              />
              <span style={{ fontSize: '0.875rem', color: 'var(--text)' }}>{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelativeTime(isoStr) {
  if (!isoStr) return '';
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TeamInsightsPage() {
  const [activeView, setActiveView] = useState('morning-triage');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [dismissedQuality, setDismissedQuality] = useState(false);
  const [dqExpanded, setDqExpanded] = useState(false);

  // Filters
  const [filterAssignee, setFilterAssignee] = useState([]);
  const [filterClient, setFilterClient] = useState([]);
  const [filterWorkType, setFilterWorkType] = useState([]);

  const fetchData = useCallback(async (force = false) => {
    try {
      const url = force ? '/api/team-insights/refresh' : '/api/team-insights/data';
      const method = force ? 'POST' : 'GET';
      const res = await fetch(url, { method, credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(json.staleData ? `Showing cached data — live fetch failed: ${json.fetchError}` : null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData(false);
    const interval = setInterval(() => fetchData(false), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleRefresh = () => {
    setRefreshing(true);
    setDismissedQuality(false);
    fetchData(true);
  };

  // Derive filter options
  const allAssignees = data ? [...new Set(data.tasks.map(t => t.assignedTo).filter(Boolean))].sort() : [];
  const allClients   = data ? [...new Set(data.tasks.map(t => t.client).filter(Boolean))].sort() : [];
  const allWorkTypes = ['Recurring', 'Adhoc', 'Pitch'];

  // Apply filters
  const filteredTasks = data ? data.tasks.filter(t => {
    if (filterAssignee.length && !filterAssignee.includes(t.assignedTo)) return false;
    if (filterClient.length   && !filterClient.includes(t.client))       return false;
    if (filterWorkType.length && !filterWorkType.includes(t.workType))   return false;
    return true;
  }) : [];

  const filteredArchive = data ? data.archiveTasks.filter(t => {
    if (filterAssignee.length && !filterAssignee.includes(t.assignedTo)) return false;
    if (filterClient.length   && !filterClient.includes(t.client))       return false;
    if (filterWorkType.length && !filterWorkType.includes(t.workType))   return false;
    return true;
  }) : [];

  const dqIssues = data?.dataQualityIssues || [];
  const showDqBanner = !dismissedQuality && dqIssues.length > 0;

  const viewProps = {
    tasks: filteredTasks,
    archiveTasks: filteredArchive,
    recurringSchedule: data?.recurringSchedule || [],
    weeklyPlanner: data?.weeklyPlanner || [],
    config: data?.config || {},
    onTaskClick: setSelectedTask,
  };

  return (
    <>
      {/* Spinner keyframes */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>

      {/* ── View tabs ────────────────────────────────────────────────────────── */}
      <div
        style={{
          background: 'var(--card)',
          borderBottom: '1px solid var(--border)',
          padding: '0 24px',
        }}
      >
        <div
          style={{
            maxWidth: '1280px',
            margin: '0 auto',
            display: 'flex',
            gap: 0,
            overflowX: 'auto',
          }}
        >
          {VIEWS.map(v => (
            <button
              key={v.id}
              onClick={() => setActiveView(v.id)}
              style={{
                padding: '12px 16px',
                fontSize: '0.875rem',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                borderBottom: activeView === v.id
                  ? '2px solid var(--primary)'
                  : '2px solid transparent',
                color: activeView === v.id
                  ? 'var(--primary)'
                  : 'var(--text-2)',
                background: 'none',
                border: 'none',
                borderBottom: activeView === v.id
                  ? '2px solid var(--primary)'
                  : '2px solid transparent',
                cursor: 'pointer',
                transition: 'color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => {
                if (activeView !== v.id) e.currentTarget.style.color = 'var(--text)';
              }}
              onMouseLeave={e => {
                if (activeView !== v.id) e.currentTarget.style.color = 'var(--text-2)';
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Global filters ───────────────────────────────────────────────────── */}
      <div
        style={{
          background: 'var(--card)',
          borderBottom: '1px solid var(--border)',
          padding: '10px 24px',
        }}
      >
        <div
          style={{
            maxWidth: '1280px',
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 500,
              color: 'var(--text-3)',
              marginRight: '4px',
            }}
          >
            Filter:
          </span>
          <MultiSelect label="Assignees"  options={allAssignees} value={filterAssignee} onChange={setFilterAssignee} />
          <MultiSelect label="Clients"    options={allClients}   value={filterClient}   onChange={setFilterClient} />
          <MultiSelect label="Work Types" options={allWorkTypes} value={filterWorkType} onChange={setFilterWorkType} />
          {(filterAssignee.length || filterClient.length || filterWorkType.length) ? (
            <button
              onClick={() => { setFilterAssignee([]); setFilterClient([]); setFilterWorkType([]); }}
              style={{
                fontSize: '0.75rem',
                color: 'var(--danger, #EF4444)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                marginLeft: '4px',
                textDecoration: 'none',
              }}
              onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
              onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <main
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          padding: '24px',
        }}
      >
        {/* Data quality banner */}
        {showDqBanner && (
          <div
            style={{
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '12px',
              background: '#FFFBEB',
              border: '1px solid #FCD34D',
              borderRadius: 'var(--r-lg)',
              padding: '12px 16px',
            }}
          >
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '0.875rem', fontWeight: 500, color: '#92400E', margin: 0 }}>
                {dqIssues.length} data quality issue{dqIssues.length !== 1 ? 's' : ''} detected in the sheet.{' '}
                <button
                  onClick={() => setDqExpanded(e => !e)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#92400E',
                    textDecoration: 'underline',
                    padding: 0,
                    fontSize: 'inherit',
                    fontWeight: 'inherit',
                  }}
                >
                  {dqExpanded ? 'Hide details' : 'View details'}
                </button>
              </p>
              {dqExpanded && (
                <ul style={{ marginTop: '8px', paddingLeft: '16px', fontSize: '0.75rem', color: '#B45309' }}>
                  {dqIssues.map((iss, i) => (
                    <li key={i} style={{ marginBottom: '2px' }}>
                      Row {iss.row} · {iss.taskId} ·{' '}
                      {iss.type === 'blank_status' && 'Blank status'}
                      {iss.type === 'duplicate_id' && `Duplicate Task ID (de-duped with suffix)`}
                      {iss.type === 'unparseable_effort' && `Unparseable effort value: "${iss.value}"`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              onClick={() => setDismissedQuality(true)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#D97706',
                flexShrink: 0,
                padding: '2px',
                display: 'flex',
                alignItems: 'center',
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#92400E'}
              onMouseLeave={e => e.currentTarget.style.color = '#D97706'}
            >
              <svg style={{ width: '16px', height: '16px' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Stale/error banner */}
        {error && !data?.staleData && (
          <div
            style={{
              marginBottom: '16px',
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: 'var(--r-lg)',
              padding: '12px 16px',
              fontSize: '0.875rem',
              color: '#B91C1C',
            }}
          >
            {error}
          </div>
        )}

        {loading && !data && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '96px 0',
              color: 'var(--text-3)',
              fontSize: '0.875rem',
              gap: '8px',
            }}
          >
            <svg
              style={{ width: '20px', height: '20px', animation: 'spin 1s linear infinite' }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Loading sheet data…
          </div>
        )}

        {!loading && !data && error && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '96px 0',
              gap: '12px',
            }}
          >
            <div
              style={{
                color: 'var(--text-2)',
                fontSize: '0.875rem',
                textAlign: 'center',
                maxWidth: '448px',
              }}
            >
              <p style={{ fontWeight: 500, color: 'var(--text)', marginBottom: '4px' }}>
                Could not load sheet data
              </p>
              <p style={{ margin: 0 }}>{error}</p>
              <p style={{ marginTop: '12px', fontSize: '0.75rem' }}>
                Make sure{' '}
                <code
                  style={{
                    background: 'var(--surface)',
                    padding: '1px 4px',
                    borderRadius: '4px',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  GOOGLE_SHEETS_ID
                </code>{' '}
                and service account credentials are set in{' '}
                <code
                  style={{
                    background: 'var(--surface)',
                    padding: '1px 4px',
                    borderRadius: '4px',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  .env
                </code>
                .
              </p>
            </div>
            <button
              onClick={handleRefresh}
              style={{
                marginTop: '8px',
                padding: '8px 16px',
                fontSize: '0.875rem',
                fontWeight: 500,
                borderRadius: 'var(--r-lg)',
                color: '#fff',
                background: 'var(--primary)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )}

        {data && (
          <>
            {activeView === 'morning-triage'  && <MorningTriageView  {...viewProps} />}
            {activeView === 'monday-planning' && <MondayPlanningView {...viewProps} />}
            {activeView === 'weekly-review'   && <WeeklyReviewView   {...viewProps} />}
            {activeView === 'client-health'   && <ClientHealthView   {...viewProps} />}
            {activeView === 'team-health'     && <TeamHealthView     {...viewProps} />}
          </>
        )}
      </main>

      {/* ── Task drawer ──────────────────────────────────────────────────────── */}
      <TaskDrawer task={selectedTask} onClose={() => setSelectedTask(null)} />
    </>
  );
}
