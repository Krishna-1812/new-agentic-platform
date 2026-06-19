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
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#374151] hover:border-[#3DAA8E] transition-colors"
      >
        <span>{displayLabel}</span>
        <svg className={`w-3.5 h-3.5 text-[#9CA3AF] transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-white border border-[#E5E7EB] rounded-lg shadow-lg min-w-[160px] py-1 max-h-64 overflow-y-auto">
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-[#6B7280] hover:bg-[#F9FAFB]"
            onClick={() => onChange([])}
          >
            Select all
          </button>
          {options.map(opt => (
            <label key={opt} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#F9FAFB] cursor-pointer">
              <input
                type="checkbox"
                checked={value.includes(opt)}
                onChange={() => toggle(opt)}
                className="w-3.5 h-3.5 accent-[#3DAA8E]"
              />
              <span className="text-sm text-[#374151]">{opt}</span>
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
      {/* ── View tabs ────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-[#E5E7EB] px-6">
        <div className="max-w-screen-xl mx-auto flex gap-0 overflow-x-auto">
          {VIEWS.map(v => (
            <button
              key={v.id}
              onClick={() => setActiveView(v.id)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeView === v.id
                  ? 'border-[#3DAA8E] text-[#3DAA8E]'
                  : 'border-transparent text-[#6B7280] hover:text-[#111827]'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Global filters ───────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-[#E5E7EB] px-6 py-2.5">
        <div className="max-w-screen-xl mx-auto flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-[#9CA3AF] mr-1">Filter:</span>
          <MultiSelect label="Assignees" options={allAssignees} value={filterAssignee} onChange={setFilterAssignee} />
          <MultiSelect label="Clients"   options={allClients}   value={filterClient}   onChange={setFilterClient} />
          <MultiSelect label="Work Types" options={allWorkTypes} value={filterWorkType} onChange={setFilterWorkType} />
          {(filterAssignee.length || filterClient.length || filterWorkType.length) ? (
            <button
              onClick={() => { setFilterAssignee([]); setFilterClient([]); setFilterWorkType([]); }}
              className="text-xs text-[#EF4444] hover:underline ml-1"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <main className="max-w-screen-xl mx-auto px-6 py-6">
        {/* Data quality banner */}
        {showDqBanner && (
          <div className="mb-4 flex items-start justify-between gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800">
                {dqIssues.length} data quality issue{dqIssues.length !== 1 ? 's' : ''} detected in the sheet.{' '}
                <button onClick={() => setDqExpanded(e => !e)} className="underline">
                  {dqExpanded ? 'Hide details' : 'View details'}
                </button>
              </p>
              {dqExpanded && (
                <ul className="mt-2 space-y-0.5 text-xs text-amber-700">
                  {dqIssues.map((iss, i) => (
                    <li key={i}>
                      Row {iss.row} · {iss.taskId} ·{' '}
                      {iss.type === 'blank_status' && 'Blank status'}
                      {iss.type === 'duplicate_id' && `Duplicate Task ID (de-duped with suffix)`}
                      {iss.type === 'unparseable_effort' && `Unparseable effort value: "${iss.value}"`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button onClick={() => setDismissedQuality(true)} className="text-amber-500 hover:text-amber-700 flex-shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Stale/error banner */}
        {error && !data?.staleData && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center py-24 text-[#9CA3AF] text-sm gap-2">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Loading sheet data…
          </div>
        )}

        {!loading && !data && error && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <div className="text-[#6B7280] text-sm text-center max-w-md">
              <p className="font-medium text-[#111827] mb-1">Could not load sheet data</p>
              <p>{error}</p>
              <p className="mt-3 text-xs">
                Make sure <code className="bg-gray-100 px-1 rounded">GOOGLE_SHEETS_ID</code> and service account
                credentials are set in <code className="bg-gray-100 px-1 rounded">.env</code>.
              </p>
            </div>
            <button onClick={handleRefresh} className="mt-2 px-4 py-2 text-sm font-medium rounded-lg text-white" style={{ backgroundColor: '#3DAA8E' }}>
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
