// View 4 — Client Health
// Sections: Active Load by Client · Blocked/Overdue by Client · Recurring Cadence · SOW Coverage

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
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Simple horizontal bar
function HBar({ value, max, label, color = '#3DAA8E' }) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-[#F3F4F6] rounded-full h-2">
        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-[#6B7280] w-16 text-right">{label}</span>
    </div>
  );
}

function CadenceFlag({ flag }) {
  const map = {
    'On Track':  { cls: 'bg-green-100 text-green-700',  label: 'On Track' },
    'At Risk':   { cls: 'bg-amber-100 text-amber-700',  label: 'At Risk' },
    'Missed':    { cls: 'bg-red-100 text-red-700',      label: 'Missed' },
  };
  const style = map[flag] || { cls: 'bg-gray-100 text-gray-500', label: flag };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded ${style.cls}`}>{style.label}</span>;
}

// ── Cadence compliance ─────────────────────────────────────────────────────────
// For each unique (client, task type from recurringSchedule), check Task Board + Archive
// for a completed task within the last ~30 days. Best-effort.

const FREQUENCY_DAYS = {
  'weekly': 7,
  'bi-weekly': 14,
  'biweekly': 14,
  'monthly': 30,
  'quarterly': 90,
};

function getWindowDays(frequency) {
  if (!frequency) return 30;
  const lower = frequency.toLowerCase();
  for (const [key, days] of Object.entries(FREQUENCY_DAYS)) {
    if (lower.includes(key)) return days;
  }
  return 30;
}

export default function ClientHealthView({ tasks, archiveTasks, recurringSchedule, onTaskClick }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const allTasks = [...tasks, ...archiveTasks];

  // ── Active load by client ─────────────────────────────────────────────────
  const activeStatuses = ['In Progress', 'Backlog', 'This Week', 'Today', 'Blocked'];
  const activeTasks = tasks.filter(t => activeStatuses.includes(t.status));

  const clientLoad = Object.values(
    activeTasks.reduce((acc, t) => {
      const c = t.client || 'Unknown';
      if (!acc[c]) acc[c] = { client: c, inProgress: 0, backlog: 0, totalHours: 0, tasks: [] };
      acc[c].tasks.push(t);
      if (t.status === 'In Progress') acc[c].inProgress++;
      else acc[c].backlog++;
      acc[c].totalHours += t.effortHours ?? 0;
      return acc;
    }, {})
  ).sort((a, b) => b.totalHours - a.totalHours);

  const maxHours = Math.max(...clientLoad.map(r => r.totalHours), 1);

  // ── Blocked/overdue by client ─────────────────────────────────────────────
  const atRisk = tasks.filter(t => t.status === 'Blocked' || t.isOverdue);
  const riskByClient = atRisk.reduce((acc, t) => {
    const c = t.client || 'Unknown';
    if (!acc[c]) acc[c] = [];
    acc[c].push(t);
    return acc;
  }, {});

  // ── Recurring cadence compliance ──────────────────────────────────────────
  const cadenceRows = recurringSchedule
    .filter(r => r.client && r.taskName)
    .map(r => {
      const windowDays = getWindowDays(r.frequency);
      const cutoff = new Date(today.getTime() - windowDays * 86400000);
      const halfWindow = new Date(today.getTime() - (windowDays / 2) * 86400000);

      // Find matching done tasks in the window
      const matchingDone = allTasks.filter(t => {
        if (t.status !== 'Done') return false;
        if (t.client !== r.client) return false;
        if (!t.name.toLowerCase().includes(r.taskName.toLowerCase().split(' ')[0])) return false;
        return t.dueDate && new Date(t.dueDate) >= cutoff;
      });

      // Find if any in-progress or upcoming task matches
      const upcoming = tasks.filter(t => {
        if (!['In Progress', 'This Week', 'Today', 'Backlog'].includes(t.status)) return false;
        if (t.client !== r.client) return false;
        return t.name.toLowerCase().includes(r.taskName.toLowerCase().split(' ')[0]);
      });

      let flag;
      if (matchingDone.length > 0) {
        flag = 'On Track';
      } else if (upcoming.length > 0) {
        flag = 'At Risk';
      } else {
        // Check if window has passed
        flag = 'Missed';
      }

      const lastDone = matchingDone.sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate))[0];

      return {
        client: r.client,
        taskType: r.taskName,
        person: r.person,
        frequency: r.frequency,
        flag,
        lastCompleted: lastDone?.dueDate || null,
      };
    });

  // ── SOW coverage — clients in recurring with zero active tasks ────────────
  const recurringClients = [...new Set(recurringSchedule.map(r => r.client).filter(Boolean))];
  const activeClientNames = new Set(activeTasks.map(t => t.client));

  const sowGaps = recurringClients
    .filter(c => !activeClientNames.has(c))
    .map(c => {
      const lastTask = archiveTasks
        .filter(t => t.client === c && t.status === 'Done' && t.dueDate)
        .sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate))[0];
      const daysSince = lastTask?.dueDate
        ? Math.floor((Date.now() - new Date(lastTask.dueDate).getTime()) / 86400000)
        : null;
      return { client: c, lastTask, daysSince };
    });

  return (
    <div className="space-y-8">

      {/* ── Active Load by Client ─────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Active Load by Client"
          subtitle="In Progress + Backlog tasks sorted by total estimated hours"
        />
        {clientLoad.length === 0 ? (
          <EmptyState message="No active tasks found." />
        ) : (
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E5E7EB]">
                  {['Client', 'In Progress', 'Backlog', 'Total Hours', 'Load'].map(h => <Th key={h}>{h}</Th>)}
                </tr>
              </thead>
              <tbody>
                {clientLoad.map(row => (
                  <tr key={row.client} className="border-b border-[#F3F4F6] last:border-0">
                    <Td className="font-semibold text-[#111827]">{row.client}</Td>
                    <Td className="text-[#6B7280]">{row.inProgress}</Td>
                    <Td className="text-[#6B7280]">{row.backlog}</Td>
                    <Td className="font-medium text-[#374151]">{row.totalHours > 0 ? `${row.totalHours}h` : '—'}</Td>
                    <Td className="min-w-[160px]">
                      <HBar value={row.totalHours} max={maxHours} label={`${row.totalHours}h`} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Blocked or Overdue by Client ──────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Blocked or Overdue by Client"
          subtitle="Client relationship risks to address before the next call"
        />
        {Object.keys(riskByClient).length === 0 ? (
          <EmptyState message="No blocked or overdue tasks across any client." />
        ) : (
          <div className="space-y-4">
            {Object.entries(riskByClient).map(([client, items]) => (
              <div key={client} className="bg-white rounded-xl border border-red-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-red-100 bg-red-50">
                  <span className="text-sm font-semibold text-red-800">{client}</span>
                  <span className="text-xs text-red-600">{items.length} at-risk task{items.length !== 1 ? 's' : ''}</span>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#F3F4F6]">
                      {['ID', 'Task', 'Assignee', 'Status', 'Due Date'].map(h => <Th key={h}>{h}</Th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(t => (
                      <tr
                        key={t.id}
                        onClick={() => onTaskClick(t)}
                        className="border-b border-[#F3F4F6] last:border-0 cursor-pointer hover:bg-[#F9FAFB] transition-colors"
                      >
                        <Td className="font-mono text-xs text-[#9CA3AF]">{t.id}</Td>
                        <Td className="font-medium text-[#111827] max-w-[220px]">
                          <span className="line-clamp-2">{t.name}</span>
                        </Td>
                        <Td className="text-[#6B7280]">{t.assignedTo || '—'}</Td>
                        <Td>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                            t.status === 'Blocked' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                          }`}>{t.status}</span>
                        </Td>
                        <Td className={t.isOverdue ? 'text-red-600 font-semibold' : 'text-[#6B7280]'}>
                          {formatDate(t.dueDate) || '—'}
                          {t.isOverdue && t.daysOverdue && <span className="ml-1 text-xs">(+{t.daysOverdue}d)</span>}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Recurring Cadence Compliance ──────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Recurring Cadence Compliance"
          subtitle="Best-effort check: matches recurring task names against completed tasks in the expected window. Results are approximate — verify in the sheet."
        />
        {cadenceRows.length === 0 ? (
          <EmptyState message="No recurring schedule data to analyze." />
        ) : (
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E5E7EB]">
                  {['Client', 'Task Type', 'Assignee', 'Frequency', 'Last Completed', 'Status'].map(h => <Th key={h}>{h}</Th>)}
                </tr>
              </thead>
              <tbody>
                {cadenceRows.map((row, i) => (
                  <tr key={i} className="border-b border-[#F3F4F6] last:border-0">
                    <Td className="font-medium text-[#111827]">{row.client}</Td>
                    <Td className="text-[#6B7280]">{row.taskType}</Td>
                    <Td className="text-[#6B7280]">{row.person || '—'}</Td>
                    <Td className="text-[#6B7280]">{row.frequency || '—'}</Td>
                    <Td className="text-[#6B7280]">{formatDate(row.lastCompleted) || 'None on record'}</Td>
                    <Td><CadenceFlag flag={row.flag} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-4 py-2.5 text-xs text-[#9CA3AF] border-t border-[#F3F4F6]">
              Matching is based on task name keywords and due date windows. Manual verification recommended before client calls.
            </p>
          </div>
        )}
      </section>

      {/* ── SOW Coverage Flag ────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="SOW Coverage Flag"
          subtitle="Clients in the Recurring Schedule with zero active tasks on the board — may be dormant or working outside the system"
        />
        {sowGaps.length === 0 ? (
          <EmptyState message="All clients in the recurring schedule have active tasks." />
        ) : (
          <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-amber-100 bg-amber-50">
                  {['Client', 'Last Completed Task', 'Last Activity', 'Days Since'].map(h => <Th key={h}>{h}</Th>)}
                </tr>
              </thead>
              <tbody>
                {sowGaps.map(row => (
                  <tr key={row.client} className="border-b border-[#F3F4F6] last:border-0">
                    <Td className="font-semibold text-[#111827]">{row.client}</Td>
                    <Td className="text-[#6B7280] max-w-[200px]">
                      {row.lastTask ? <span className="line-clamp-1">{row.lastTask.name}</span> : <span className="text-[#D1D5DB]">No history</span>}
                    </Td>
                    <Td className="text-[#6B7280]">{formatDate(row.lastTask?.dueDate) || '—'}</Td>
                    <Td className={row.daysSince != null && row.daysSince > 14 ? 'text-amber-600 font-semibold' : 'text-[#6B7280]'}>
                      {row.daysSince != null ? `${row.daysSince}d ago` : '—'}
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
