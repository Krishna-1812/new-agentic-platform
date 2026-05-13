// View 1 — Morning Triage
// Sections: Blocked Tasks · Overdue Tasks · WIP Status per Person · Today's P1 Tasks

const P1_COLOR   = 'bg-red-50 border-red-200';
const P2_COLOR   = 'bg-orange-50';
const OVER_COLOR = 'text-red-600 font-semibold';

function SectionHeader({ title, count, subtitle }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold text-[#111827]">{title}</h2>
        {count != null && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#6B7280]">{count}</span>
        )}
      </div>
      {subtitle && <p className="text-xs text-[#9CA3AF] mt-0.5">{subtitle}</p>}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="py-6 text-center text-sm text-[#9CA3AF] bg-white rounded-xl border border-[#E5E7EB]">
      {message}
    </div>
  );
}

function TaskRow({ task, onTaskClick, children }) {
  return (
    <tr
      onClick={() => onTaskClick(task)}
      className={`border-b border-[#F3F4F6] cursor-pointer hover:bg-[#F9FAFB] transition-colors last:border-0 ${
        task.priority === 'P1 - Urgent' ? 'bg-red-50/40' : ''
      }`}
    >
      {children}
    </tr>
  );
}

function Td({ children, className = '' }) {
  return <td className={`px-4 py-2.5 text-sm ${className}`}>{children}</td>;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function PriorityBadge({ priority }) {
  const colors = {
    'P1 - Urgent': 'bg-red-100 text-red-700',
    'P2 - High':   'bg-orange-100 text-orange-700',
    'P3 - Normal': 'bg-blue-50 text-blue-700',
    'P4 - Low':    'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${colors[priority] || 'bg-gray-100 text-gray-500'}`}>
      {priority?.replace('P1 - ', '').replace('P2 - ', '').replace('P3 - ', '').replace('P4 - ', '') || '—'}
    </span>
  );
}

function StatusBadge({ status }) {
  const colors = {
    'Blocked':     'bg-red-100 text-red-700',
    'In Progress': 'bg-blue-100 text-blue-700',
    'In Review':   'bg-purple-100 text-purple-700',
    'Backlog':     'bg-gray-100 text-gray-500',
    'Today':       'bg-indigo-100 text-indigo-700',
    'This Week':   'bg-teal-100 text-teal-700',
    'Deferred':    'bg-yellow-100 text-yellow-700',
    'Done':        'bg-green-100 text-green-700',
  };
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${colors[status] || 'bg-gray-100 text-gray-500'}`}>
      {status || '—'}
    </span>
  );
}

// ── WIP card per person ───────────────────────────────────────────────────────

function WipCard({ person, tasks, config, onTaskClick }) {
  const wip       = tasks.filter(t => t.status === 'In Progress');
  const blocked   = tasks.filter(t => t.status === 'Blocked');
  const backlog   = tasks.filter(t => t.status === 'Backlog');
  const wipHours  = wip.reduce((s, t) => s + (t.effortHours ?? 0), 0);
  const wipLimit  = config.wipLimit || 3;
  const wipCount  = wip.length;

  const wipColor =
    wipCount === 0 && backlog.length > 15 ? 'border-yellow-300 bg-yellow-50' :
    wipCount <= 2 ? 'border-green-200 bg-green-50' :
    wipCount === 3 ? 'border-amber-300 bg-amber-50' :
    'border-red-300 bg-red-50';

  const wipIndicator =
    wipCount <= 2 ? { color: 'text-green-600', label: 'On track' } :
    wipCount === 3 ? { color: 'text-amber-600', label: 'At limit' } :
    { color: 'text-red-600', label: 'Over limit' };

  return (
    <div className={`rounded-xl border-2 ${wipColor} p-4`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-[#111827]">{person}</p>
          <p className={`text-xs font-medium mt-0.5 ${wipIndicator.color}`}>{wipIndicator.label}</p>
        </div>
        <div className="text-right">
          <p className={`text-2xl font-bold leading-none ${wipCount > wipLimit ? 'text-red-600' : 'text-[#111827]'}`}>
            {wipCount}
          </p>
          <p className="text-xs text-[#9CA3AF]">/ {wipLimit} WIP</p>
        </div>
      </div>

      <div className="flex gap-3 text-xs">
        <div>
          <span className="text-[#9CA3AF]">In Progress</span>
          <span className="ml-1.5 font-semibold text-[#111827]">{wipHours > 0 ? `${wipHours}h` : '—'}</span>
        </div>
        <div className="w-px bg-[#E5E7EB]" />
        <div>
          <span className="text-[#9CA3AF]">Blocked</span>
          <span className={`ml-1.5 font-semibold ${blocked.length > 0 ? 'text-red-600' : 'text-[#111827]'}`}>
            {blocked.length}
          </span>
        </div>
        <div className="w-px bg-[#E5E7EB]" />
        <div>
          <span className="text-[#9CA3AF]">Backlog</span>
          <span className={`ml-1.5 font-semibold ${backlog.length > 15 ? 'text-yellow-600' : 'text-[#111827]'}`}>
            {backlog.length}
            {backlog.length > 15 && <span className="ml-1 text-yellow-600 text-[10px] font-semibold">Large queue</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function MorningTriageView({ tasks, config, onTaskClick }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // ── Blocked tasks ─────────────────────────────────────────────────────────
  const blocked = tasks
    .filter(t => t.status === 'Blocked')
    .sort((a, b) => {
      const da = a.dueDate ? new Date(a.dueDate) : new Date('9999-12-31');
      const db = b.dueDate ? new Date(b.dueDate) : new Date('9999-12-31');
      return da - db;
    });

  // ── Overdue tasks ─────────────────────────────────────────────────────────
  const overdue = tasks
    .filter(t => t.isOverdue)
    .sort((a, b) => {
      const pa = Number(a.priority?.charAt(1) || 9);
      const pb = Number(b.priority?.charAt(1) || 9);
      if (pa !== pb) return pa - pb;
      return (b.daysOverdue || 0) - (a.daysOverdue || 0);
    });

  const overdueByPerson = overdue.reduce((acc, t) => {
    const k = t.assignedTo || 'Unassigned';
    if (!acc[k]) acc[k] = [];
    acc[k].push(t);
    return acc;
  }, {});

  // ── WIP per person ────────────────────────────────────────────────────────
  const persons = [...new Set(tasks.map(t => t.assignedTo).filter(Boolean))].sort();
  const tasksByPerson = persons.reduce((acc, p) => {
    acc[p] = tasks.filter(t => t.assignedTo === p);
    return acc;
  }, {});

  // ── Today's P1 ────────────────────────────────────────────────────────────
  const p1Tasks = tasks.filter(t =>
    t.priority === 'P1 - Urgent' && t.status !== 'Done' && t.status !== 'Archived'
  );

  return (
    <div className="space-y-8">

      {/* ── Blocked Tasks ─────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Blocked Tasks"
          count={blocked.length}
          subtitle="Sorted by due date — address these first"
        />
        {blocked.length === 0 ? (
          <EmptyState message="No blocked tasks — clear!" />
        ) : (
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E5E7EB]">
                  {['ID', 'Task', 'Client', 'Assignee', 'Due Date', 'Notes'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-[#9CA3AF] uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {blocked.map(t => {
                  const pastDue = t.dueDate && new Date(t.dueDate) < today;
                  return (
                    <TaskRow key={t.id} task={t} onTaskClick={onTaskClick}>
                      <Td className="font-mono text-xs text-[#9CA3AF]">{t.id}</Td>
                      <Td className="font-medium text-[#111827] max-w-[200px]">
                        <span className="line-clamp-2">{t.name}</span>
                      </Td>
                      <Td className="text-[#6B7280]">{t.client || '—'}</Td>
                      <Td className="text-[#6B7280]">{t.assignedTo || '—'}</Td>
                      <Td className={pastDue ? OVER_COLOR : 'text-[#6B7280]'}>
                        {formatDate(t.dueDate)}
                        {pastDue && <span className="ml-1 text-xs">⚠</span>}
                      </Td>
                      <Td className="text-[#6B7280] max-w-[180px]">
                        <span className="line-clamp-2 text-xs">{t.notes || '—'}</span>
                      </Td>
                    </TaskRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Overdue Tasks ─────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Overdue Tasks"
          count={overdue.length}
          subtitle="Grouped by assignee · P1 first, then by days overdue"
        />
        {overdue.length === 0 ? (
          <EmptyState message="No overdue tasks — all clear!" />
        ) : (
          <div className="space-y-4">
            {Object.entries(overdueByPerson).map(([person, personTasks]) => (
              <div key={person} className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#F3F4F6] bg-[#F9FAFB]">
                  <span className="text-sm font-semibold text-[#374151]">{person}</span>
                  <span className="ml-2 text-xs text-[#9CA3AF]">{personTasks.length} overdue</span>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#F3F4F6]">
                      {['ID', 'Task', 'Client', 'Priority', 'Days Overdue'].map(h => (
                        <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-[#9CA3AF] uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {personTasks.map(t => (
                      <TaskRow key={t.id} task={t} onTaskClick={onTaskClick}>
                        <Td className="font-mono text-xs text-[#9CA3AF]">{t.id}</Td>
                        <Td className="font-medium text-[#111827] max-w-[220px]">
                          <span className="line-clamp-2">{t.name}</span>
                        </Td>
                        <Td className="text-[#6B7280]">{t.client || '—'}</Td>
                        <Td><PriorityBadge priority={t.priority} /></Td>
                        <Td className={t.priority === 'P1 - Urgent' ? 'text-red-600 font-bold' : 'text-[#6B7280]'}>
                          {t.daysOverdue != null ? `${t.daysOverdue}d` : '—'}
                        </Td>
                      </TaskRow>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── WIP Status per Person ─────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="WIP Status"
          subtitle={`WIP limit: ${config.wipLimit || 3} per person · Green ≤2, Amber = 3, Red ≥4`}
        />
        {persons.length === 0 ? (
          <EmptyState message="No assignees found in active tasks." />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {persons.map(p => (
              <WipCard
                key={p}
                person={p}
                tasks={tasksByPerson[p]}
                config={config}
                onTaskClick={onTaskClick}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Today's P1 Tasks ─────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Today's P1 Tasks"
          count={p1Tasks.length}
          subtitle="All Urgent priority tasks not yet Done"
        />
        {p1Tasks.length === 0 ? (
          <EmptyState message="No P1 tasks outstanding." />
        ) : (
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E5E7EB]">
                  {['ID', 'Task', 'Client', 'Assignee', 'Status', 'Due Date'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-[#9CA3AF] uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p1Tasks.map(t => (
                  <TaskRow key={t.id} task={t} onTaskClick={onTaskClick}>
                    <Td className="font-mono text-xs text-[#9CA3AF]">{t.id}</Td>
                    <Td className="font-semibold text-[#111827] max-w-[200px]">
                      <span className="line-clamp-2">{t.name}</span>
                    </Td>
                    <Td className="text-[#6B7280]">{t.client || '—'}</Td>
                    <Td className="text-[#6B7280]">{t.assignedTo || '—'}</Td>
                    <Td><StatusBadge status={t.status} /></Td>
                    <Td className={t.isOverdue ? OVER_COLOR : 'text-[#6B7280]'}>{formatDate(t.dueDate)}</Td>
                  </TaskRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
