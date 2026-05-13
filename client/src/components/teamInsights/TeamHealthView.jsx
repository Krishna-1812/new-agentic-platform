// View 5 — Team Health
// Sections: Work Type Distribution · Deferred Task Aging · Review Bottleneck · Pitch Pipeline · P1 Backlog

function SectionHeader({ title, subtitle }) {
  return (
    <div className="mb-4">
      <h2 className="text-[15px] font-semibold text-[#111827]">{title}</h2>
      {subtitle && <p className="text-xs text-[#9CA3AF] mt-0.5">{subtitle}</p>}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="py-6 text-center text-sm text-[#9CA3AF] bg-white rounded-xl border border-[#E5E7EB]">{message}</div>
  );
}

function Td({ children, className = '' }) {
  return <td className={`px-4 py-2.5 text-sm ${className}`}>{children}</td>;
}

function Th({ children }) {
  return <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#9CA3AF] uppercase tracking-wide">{children}</th>;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Donut chart (inline SVG) ──────────────────────────────────────────────────
function DonutChart({ segments, size = 80 }) {
  const r = 28;
  const cx = size / 2;
  const circumference = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return <div style={{ width: size, height: size }} className="flex items-center justify-center text-xs text-[#D1D5DB]">No data</div>;

  let offset = 0;
  const arcs = segments.map(seg => {
    const pct = seg.value / total;
    const dash = pct * circumference;
    const arc = { ...seg, dash, offset, pct };
    offset += dash;
    return arc;
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#F3F4F6" strokeWidth={10} />
      {arcs.map((arc, i) => (
        <circle
          key={i}
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke={arc.color}
          strokeWidth={10}
          strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
          strokeDashoffset={-(arc.offset - circumference * 0.25)}
          style={{ transform: `rotate(-90deg)`, transformOrigin: `${cx}px ${cx}px` }}
        />
      ))}
      <text x={cx} y={cx + 5} textAnchor="middle" className="text-[10px]" fontSize="11" fill="#374151" fontWeight="600">
        {total}
      </text>
    </svg>
  );
}

const WORK_TYPE_COLORS = {
  'Recurring': '#3DAA8E',
  'Adhoc':     '#6366F1',
  'Pitch':     '#F59E0B',
};

// ── Work type card per person ─────────────────────────────────────────────────
function WorkTypeCard({ person, tasks }) {
  const types = ['Recurring', 'Adhoc', 'Pitch'];
  const counts = types.reduce((acc, t) => {
    acc[t] = tasks.filter(task => task.workType === t).length;
    return acc;
  }, {});
  const total = tasks.length;
  const recurringPct = total > 0 ? Math.round((counts['Recurring'] / total) * 100) : 0;

  const segments = types.map(t => ({ value: counts[t], color: WORK_TYPE_COLORS[t] }));

  return (
    <div className={`bg-white rounded-xl border p-4 ${recurringPct > 75 ? 'border-amber-300' : 'border-[#E5E7EB]'}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-[#111827]">{person}</p>
          {recurringPct > 75 && (
            <p className="text-xs text-amber-600 font-medium mt-0.5">Recurring &gt;75%</p>
          )}
        </div>
        <DonutChart segments={segments} size={60} />
      </div>
      <div className="space-y-1">
        {types.map(t => (
          <div key={t} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: WORK_TYPE_COLORS[t] }} />
              <span className="text-[#6B7280]">{t}</span>
            </div>
            <span className="font-medium text-[#374151]">
              {counts[t]}{total > 0 ? ` (${Math.round((counts[t] / total) * 100)}%)` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TeamHealthView({ tasks, archiveTasks, config, onTaskClick }) {
  const { deferredWarningDays = 21 } = config;
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const persons = [...new Set(tasks.map(t => t.assignedTo).filter(Boolean))].sort();

  // ── Work type distribution ────────────────────────────────────────────────
  const activeTasks = tasks.filter(t => t.status !== 'Done');
  const typesByPerson = persons.reduce((acc, p) => {
    acc[p] = activeTasks.filter(t => t.assignedTo === p);
    return acc;
  }, {});

  const globalTypes = ['Recurring', 'Adhoc', 'Pitch'].map(t => ({
    label: t, value: activeTasks.filter(task => task.workType === t).length, color: WORK_TYPE_COLORS[t],
  }));
  const globalTotal = activeTasks.length;

  // ── Deferred task aging ───────────────────────────────────────────────────
  const deferred = tasks.filter(t => t.status === 'Deferred');
  const deferredByPerson = deferred.reduce((acc, t) => {
    const k = t.assignedTo || 'Unassigned';
    if (!acc[k]) acc[k] = [];
    acc[k].push(t);
    return acc;
  }, {});

  // ── Review bottleneck ─────────────────────────────────────────────────────
  const inReview = tasks.filter(t => t.status === 'In Review');
  const inReviewByClient = inReview.reduce((acc, t) => {
    const c = t.client || 'Unknown';
    if (!acc[c]) acc[c] = [];
    acc[c].push(t);
    return acc;
  }, {});

  // ── Pitch pipeline ────────────────────────────────────────────────────────
  const activePitch = tasks.filter(t => t.workType === 'Pitch');
  const donePitch = archiveTasks.filter(t => t.workType === 'Pitch' && t.status === 'Done');
  const totalPitchHours = activePitch.reduce((s, t) => s + (t.effortHours ?? 0), 0);

  // ── P1 Backlog ────────────────────────────────────────────────────────────
  const p1Backlog = tasks.filter(t => t.priority === 'P1 - Urgent' && t.status === 'Backlog');

  return (
    <div className="space-y-8">

      {/* ── Work Type Distribution ────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Work Type Distribution"
          subtitle="Recurring vs Adhoc vs Pitch across active tasks. Flag: any person with recurring > 75%."
        />
        {/* Global summary */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-4 mb-4 flex items-center gap-6">
          <DonutChart segments={globalTypes} size={80} />
          <div className="space-y-1.5">
            {globalTypes.map(t => (
              <div key={t.label} className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                <span className="text-[#6B7280]">{t.label}</span>
                <span className="font-semibold text-[#111827]">
                  {t.value}
                  {globalTotal > 0 ? <span className="text-[#9CA3AF] font-normal ml-1">({Math.round((t.value / globalTotal) * 100)}%)</span> : ''}
                </span>
              </div>
            ))}
            <p className="text-xs text-[#9CA3AF] pt-1">Total active: {globalTotal}</p>
          </div>
        </div>
        {/* Per-person cards */}
        {persons.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {persons.map(p => <WorkTypeCard key={p} person={p} tasks={typesByPerson[p]} />)}
          </div>
        )}
      </section>

      {/* ── Deferred Task Aging ────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Deferred Task Aging"
          subtitle={`Highlight: tasks deferred more than ${deferredWarningDays} days`}
        />
        {deferred.length === 0 ? (
          <EmptyState message="No deferred tasks." />
        ) : (
          <div className="space-y-4">
            {Object.entries(deferredByPerson).map(([person, items]) => (
              <div key={person} className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#F3F4F6] bg-[#F9FAFB]">
                  <span className="text-sm font-semibold text-[#374151]">{person}</span>
                  <span className="ml-2 text-xs text-[#9CA3AF]">{items.length} deferred</span>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#F3F4F6]">
                      {['ID', 'Task', 'Client', 'Original Due', 'Days Deferred'].map(h => <Th key={h}>{h}</Th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(t => {
                      const days = t.dueDate
                        ? Math.max(0, Math.floor((Date.now() - new Date(t.dueDate).getTime()) / 86400000))
                        : null;
                      const warn = days != null && days > deferredWarningDays;
                      return (
                        <tr
                          key={t.id}
                          onClick={() => onTaskClick(t)}
                          className={`border-b border-[#F3F4F6] last:border-0 cursor-pointer hover:bg-[#F9FAFB] transition-colors ${warn ? 'bg-amber-50/30' : ''}`}
                        >
                          <Td className="font-mono text-xs text-[#9CA3AF]">{t.id}</Td>
                          <Td className="font-medium text-[#111827] max-w-[200px]">
                            <span className="line-clamp-2">{t.name}</span>
                          </Td>
                          <Td className="text-[#6B7280]">{t.client || '—'}</Td>
                          <Td className="text-[#6B7280]">{formatDate(t.dueDate)}</Td>
                          <Td className={warn ? 'text-amber-600 font-bold' : 'text-[#6B7280]'}>
                            {days != null ? `${days}d` : '—'}
                            {warn && <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-700 px-1 rounded">stale</span>}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Review Bottleneck ─────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Review Bottleneck"
          subtitle="Tasks in In Review status, grouped by client. Flags past-due review tasks."
        />
        {inReview.length === 0 ? (
          <EmptyState message="No tasks in review." />
        ) : (
          <div className="space-y-4">
            {Object.entries(inReviewByClient).map(([client, items]) => (
              <div key={client} className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#F3F4F6] bg-[#F9FAFB]">
                  <span className="text-sm font-semibold text-[#374151]">{client}</span>
                  <span className="text-xs text-[#9CA3AF]">{items.length} in review</span>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#F3F4F6]">
                      {['ID', 'Task', 'Assignee', 'Due Date', 'Days in Status'].map(h => <Th key={h}>{h}</Th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(t => (
                      <tr
                        key={t.id}
                        onClick={() => onTaskClick(t)}
                        className={`border-b border-[#F3F4F6] last:border-0 cursor-pointer hover:bg-[#F9FAFB] transition-colors ${t.isOverdue ? 'bg-red-50/20' : ''}`}
                      >
                        <Td className="font-mono text-xs text-[#9CA3AF]">{t.id}</Td>
                        <Td className="font-medium text-[#111827] max-w-[200px]">
                          <span className="line-clamp-2">{t.name}</span>
                        </Td>
                        <Td className="text-[#6B7280]">{t.assignedTo || '—'}</Td>
                        <Td className={t.isOverdue ? 'text-red-600 font-semibold' : 'text-[#6B7280]'}>
                          {formatDate(t.dueDate)}
                          {t.isOverdue && <span className="ml-1 text-xs">⚠</span>}
                        </Td>
                        <Td className="text-[#9CA3AF] text-xs italic">
                          {/* daysInCurrentStatus is null until Date Entered Status column is added */}
                          {t.daysInCurrentStatus != null ? `${t.daysInCurrentStatus}d` : 'Date tracking not available'}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {inReview.some(t => t.daysInCurrentStatus === null) && (
              <p className="text-xs text-[#9CA3AF] px-1">
                Day tracking requires a "Date Entered Status" column in the sheet (currently not present).
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── Pitch Pipeline ────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Pitch Pipeline"
          subtitle="Active pitch work and historical log from archive"
        />
        <div className="space-y-4">
          {activePitch.length === 0 ? (
            <EmptyState message="No active pitch tasks." />
          ) : (
            <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#F3F4F6] bg-[#F9FAFB]">
                <span className="text-sm font-semibold text-[#374151]">Active Pitch Work</span>
                <span className="text-sm font-bold text-[#F59E0B]">
                  {totalPitchHours > 0 ? `${totalPitchHours}h committed` : `${activePitch.length} tasks`}
                </span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#F3F4F6]">
                    {['ID', 'Task', 'Assignee', 'Status', 'Effort', 'Due'].map(h => <Th key={h}>{h}</Th>)}
                  </tr>
                </thead>
                <tbody>
                  {activePitch.map(t => (
                    <tr
                      key={t.id}
                      onClick={() => onTaskClick(t)}
                      className="border-b border-[#F3F4F6] last:border-0 cursor-pointer hover:bg-[#F9FAFB] transition-colors"
                    >
                      <Td className="font-mono text-xs text-[#9CA3AF]">{t.id}</Td>
                      <Td className="font-medium text-[#111827] max-w-[200px]">
                        <span className="line-clamp-2">{t.name}</span>
                      </Td>
                      <Td className="text-[#6B7280]">{t.assignedTo || '—'}</Td>
                      <Td>
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-amber-100 text-amber-700">{t.status}</span>
                      </Td>
                      <Td className="text-[#6B7280]">{t.effortHours != null ? `${t.effortHours}h` : '—'}</Td>
                      <Td className={t.isOverdue ? 'text-red-600 font-semibold' : 'text-[#6B7280]'}>{formatDate(t.dueDate)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {donePitch.length > 0 && (
            <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#F3F4F6] bg-[#F9FAFB]">
                <span className="text-sm font-semibold text-[#374151]">Completed Pitch Work</span>
                <span className="ml-2 text-xs text-[#9CA3AF]">{donePitch.length} tasks</span>
              </div>
              <div className="divide-y divide-[#F3F4F6]">
                {donePitch.slice(0, 20).map(t => (
                  <div
                    key={t.id}
                    onClick={() => onTaskClick(t)}
                    className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-[#F9FAFB] transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-mono text-[#9CA3AF] flex-shrink-0">{t.id}</span>
                      <span className="text-sm text-[#374151] truncate">{t.name}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                      <span className="text-xs text-[#9CA3AF]">{t.assignedTo || '—'}</span>
                      <span className="text-xs text-[#9CA3AF]">{formatDate(t.dueDate)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── P1 Backlog ────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="P1 Backlog"
          subtitle="Urgent tasks that haven't started — these should not exist. Any P1 in Backlog is a process failure."
        />
        {p1Backlog.length === 0 ? (
          <div className="py-6 text-center text-sm text-green-600 bg-green-50 rounded-xl border border-green-200">
            No P1 tasks sitting in Backlog. Process health is good here.
          </div>
        ) : (
          <div className="bg-red-50 rounded-xl border-2 border-red-300 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-red-200 bg-red-100">
              <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span className="text-sm font-semibold text-red-800">
                {p1Backlog.length} P1 task{p1Backlog.length !== 1 ? 's' : ''} sitting in Backlog — needs immediate attention
              </span>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-red-200">
                  {['ID', 'Task', 'Client', 'Assignee', 'Due Date'].map(h => <Th key={h}>{h}</Th>)}
                </tr>
              </thead>
              <tbody>
                {p1Backlog.map(t => (
                  <tr
                    key={t.id}
                    onClick={() => onTaskClick(t)}
                    className="border-b border-red-100 last:border-0 cursor-pointer hover:bg-red-100/30 transition-colors"
                  >
                    <Td className="font-mono text-xs text-red-400">{t.id}</Td>
                    <Td className="font-bold text-red-800 max-w-[200px]">
                      <span className="line-clamp-2">{t.name}</span>
                    </Td>
                    <Td className="text-red-700">{t.client || '—'}</Td>
                    <Td className="text-red-700">{t.assignedTo || 'Unassigned'}</Td>
                    <Td className={t.isOverdue ? 'text-red-600 font-bold' : 'text-red-700'}>
                      {formatDate(t.dueDate)}
                      {t.isOverdue && <span className="ml-1">(+{t.daysOverdue}d)</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
