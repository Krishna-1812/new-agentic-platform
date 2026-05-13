// View 2 — Monday Planning
// Sections: Recurring Hours Burden · Backlog Queue by Person · Capacity vs Load · Stale Backlog Flags

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

function weeksOverdue(dueIso) {
  if (!dueIso) return null;
  const diff = Date.now() - new Date(dueIso).getTime();
  return Math.floor(diff / (7 * 86400000));
}

function PriorityBadge({ priority }) {
  const colors = {
    'P1 - Urgent': 'bg-red-100 text-red-700',
    'P2 - High':   'bg-orange-100 text-orange-700',
    'P3 - Normal': 'bg-blue-50 text-blue-700',
    'P4 - Low':    'bg-gray-100 text-gray-500',
  };
  const short = priority?.split(' - ')[0] || '—';
  return <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${colors[priority] || 'bg-gray-100 text-gray-500'}`}>{short}</span>;
}

// ── Capacity bar ──────────────────────────────────────────────────────────────
function CapacityBar({ value, max, color = '#3DAA8E' }) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-[#F3F4F6] rounded-full h-1.5">
        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-[#6B7280] w-8 text-right">{value}h</span>
    </div>
  );
}

export default function MondayPlanningView({ tasks, recurringSchedule, config, onTaskClick }) {
  const { workWeekHours = 35, overCapacityHours = 30, wipLimit = 3, staleBacklogWeeks = 4 } = config;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const nextWeek = new Date(today.getTime() + 7 * 86400000);

  // All unique persons across tasks + recurring schedule
  const allPersons = [...new Set([
    ...tasks.map(t => t.assignedTo),
    ...recurringSchedule.map(r => r.person),
  ].filter(Boolean))].sort();

  // ── Recurring burden per person ───────────────────────────────────────────
  const recurringByPerson = allPersons.reduce((acc, p) => {
    acc[p] = recurringSchedule.filter(r => r.person === p);
    return acc;
  }, {});

  // ── Backlog per person ────────────────────────────────────────────────────
  const backlogTasks = tasks.filter(t => t.status === 'Backlog');
  const backlogByPerson = allPersons.reduce((acc, p) => {
    acc[p] = backlogTasks.filter(t => t.assignedTo === p);
    return acc;
  }, {});

  // ── Active WIP ────────────────────────────────────────────────────────────
  const wipTasks = tasks.filter(t => t.status === 'In Progress');
  const wipByPerson = allPersons.reduce((acc, p) => {
    acc[p] = wipTasks.filter(t => t.assignedTo === p);
    return acc;
  }, {});

  // ── Stale backlog ─────────────────────────────────────────────────────────
  const staleCutoff = new Date(today.getTime() - staleBacklogWeeks * 7 * 86400000);
  const staleBacklog = backlogTasks.filter(t => t.dueDate && new Date(t.dueDate) < staleCutoff);
  const staleByPerson = allPersons.reduce((acc, p) => {
    acc[p] = staleBacklog.filter(t => t.assignedTo === p);
    return acc;
  }, {});

  // ── Capacity summary ──────────────────────────────────────────────────────
  const capacitySummary = allPersons.map(p => {
    const recurHours  = recurringByPerson[p].reduce((s, r) => s + (r.effortHours ?? 0), 0);
    const wipHours    = wipByPerson[p].reduce((s, t) => s + (t.effortHours ?? 0), 0);
    const backlogHrs  = backlogByPerson[p].reduce((s, t) => s + (t.effortHours ?? 0), 0);
    const committed   = recurHours + wipHours;
    const status =
      committed > overCapacityHours ? 'Over capacity' :
      committed > overCapacityHours * 0.85 ? 'At capacity' :
      'Has room';
    return { person: p, recurHours, wipHours, backlogHrs, committed, status };
  });

  return (
    <div className="space-y-8">

      {/* ── Recurring Hours Burden ────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Recurring Hours Burden This Week"
          subtitle="Committed floor before any adhoc work is assigned"
        />
        {allPersons.length === 0 ? (
          <EmptyState message="No recurring schedule data found." />
        ) : (
          <div className="space-y-4">
            {allPersons.map(p => {
              const items = recurringByPerson[p];
              const total = items.reduce((s, r) => s + (r.effortHours ?? 0), 0);
              if (items.length === 0) return null;
              return (
                <div key={p} className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#F3F4F6] bg-[#F9FAFB]">
                    <span className="text-sm font-semibold text-[#374151]">{p}</span>
                    <span className="text-sm font-bold text-[#3DAA8E]">{total}h recurring</span>
                  </div>
                  <div className="divide-y divide-[#F3F4F6]">
                    {items.map((r, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-2.5">
                        <div>
                          <span className="text-sm text-[#111827]">{r.taskName || '—'}</span>
                          {r.client && <span className="ml-2 text-xs text-[#9CA3AF]">{r.client}</span>}
                          {r.frequency && <span className="ml-2 text-xs text-[#C4B5FD]">{r.frequency}</span>}
                        </div>
                        <span className="text-sm font-medium text-[#374151]">
                          {r.effortHours != null ? `${r.effortHours}h` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Capacity vs Load Summary ──────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Capacity vs Load"
          subtitle={`Work week: ${workWeekHours}h · Over-capacity threshold: ${overCapacityHours}h committed`}
        />
        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#E5E7EB]">
                {['Person', 'Recurring hrs', 'Active WIP hrs', 'Backlog hrs', 'Load bar', 'Status'].map(h => (
                  <Th key={h}>{h}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {capacitySummary.map(row => {
                const statusColor =
                  row.status === 'Over capacity' ? 'text-red-600 font-semibold' :
                  row.status === 'At capacity'   ? 'text-amber-600 font-medium' :
                  'text-green-600';
                const barColor =
                  row.status === 'Over capacity' ? '#EF4444' :
                  row.status === 'At capacity'   ? '#F59E0B' : '#3DAA8E';
                return (
                  <tr key={row.person} className="border-b border-[#F3F4F6] last:border-0">
                    <Td className="font-medium text-[#111827]">{row.person}</Td>
                    <Td className="text-[#6B7280]">{row.recurHours > 0 ? `${row.recurHours}h` : '—'}</Td>
                    <Td className="text-[#6B7280]">{row.wipHours > 0 ? `${row.wipHours}h` : '—'}</Td>
                    <Td className="text-[#6B7280]">{row.backlogHrs > 0 ? `${row.backlogHrs}h` : '—'}</Td>
                    <Td className="min-w-[120px]">
                      <CapacityBar value={row.committed} max={workWeekHours} color={barColor} />
                    </Td>
                    <Td className={statusColor}>{row.status}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Backlog Queue by Person ───────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Backlog Queue by Person"
          subtitle="Flags P1/P2 items due within 7 days and oldest backlog item per person"
        />
        {backlogTasks.length === 0 ? (
          <EmptyState message="No backlog tasks." />
        ) : (
          <div className="space-y-4">
            {allPersons.map(p => {
              const items = backlogByPerson[p];
              if (items.length === 0) return null;

              const urgent = items.filter(t =>
                (t.priority === 'P1 - Urgent' || t.priority === 'P2 - High') &&
                t.dueDate && new Date(t.dueDate) <= nextWeek
              );
              const oldest = items.reduce((min, t) => {
                if (!t.dueDate) return min;
                return !min || new Date(t.dueDate) < new Date(min.dueDate) ? t : min;
              }, null);
              const totalHrs = items.reduce((s, t) => s + (t.effortHours ?? 0), 0);

              return (
                <div key={p} className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#F3F4F6] bg-[#F9FAFB]">
                    <span className="text-sm font-semibold text-[#374151]">{p}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[#9CA3AF]">{items.length} tasks · {totalHrs > 0 ? `${totalHrs}h` : 'no estimates'}</span>
                      {urgent.length > 0 && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-red-100 text-red-700">
                          {urgent.length} urgent due soon
                        </span>
                      )}
                    </div>
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[#F3F4F6]">
                        {['ID', 'Task', 'Client', 'Priority', 'Due Date', 'Effort'].map(h => (
                          <Th key={h}>{h}</Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(t => {
                        const isUrgentDue = urgent.some(u => u.id === t.id);
                        const isOldest = oldest?.id === t.id;
                        return (
                          <tr
                            key={t.id}
                            onClick={() => onTaskClick(t)}
                            className={`border-b border-[#F3F4F6] last:border-0 cursor-pointer hover:bg-[#F9FAFB] transition-colors ${
                              isUrgentDue ? 'bg-red-50/40' : isOldest ? 'bg-amber-50/30' : ''
                            }`}
                          >
                            <Td className="font-mono text-xs text-[#9CA3AF]">{t.id}</Td>
                            <Td className="font-medium text-[#111827] max-w-[200px]">
                              <span className="line-clamp-2">{t.name}</span>
                              {isOldest && <span className="ml-1.5 text-[10px] font-semibold text-amber-600 bg-amber-100 px-1 rounded">Oldest</span>}
                            </Td>
                            <Td className="text-[#6B7280]">{t.client || '—'}</Td>
                            <Td><PriorityBadge priority={t.priority} /></Td>
                            <Td className={isUrgentDue ? 'text-red-600 font-semibold' : 'text-[#6B7280]'}>
                              {formatDate(t.dueDate)}
                            </Td>
                            <Td className="text-[#6B7280]">{t.effortHours != null ? `${t.effortHours}h` : '—'}</Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Stale Backlog Flags ───────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Stale Backlog Flags"
          subtitle={`Backlog tasks with a due date older than ${staleBacklogWeeks} weeks — needs a decision: close, reschedule, or escalate`}
        />
        {staleBacklog.length === 0 ? (
          <EmptyState message={`No backlog tasks older than ${staleBacklogWeeks} weeks.`} />
        ) : (
          <div className="space-y-4">
            {allPersons.map(p => {
              const items = staleByPerson[p];
              if (items.length === 0) return null;
              return (
                <div key={p} className="bg-white rounded-xl border border-amber-200 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-amber-100 bg-amber-50">
                    <span className="text-sm font-semibold text-amber-800">{p}</span>
                    <span className="ml-2 text-xs text-amber-600">{items.length} stale</span>
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[#F3F4F6]">
                        {['ID', 'Task', 'Client', 'Priority', 'Weeks Overdue'].map(h => (
                          <Th key={h}>{h}</Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(t => {
                        const weeks = weeksOverdue(t.dueDate);
                        return (
                          <tr
                            key={t.id}
                            onClick={() => onTaskClick(t)}
                            className="border-b border-[#F3F4F6] last:border-0 cursor-pointer hover:bg-[#F9FAFB] transition-colors"
                          >
                            <Td className="font-mono text-xs text-[#9CA3AF]">{t.id}</Td>
                            <Td className="font-medium text-[#111827] max-w-[220px]">
                              <span className="line-clamp-2">{t.name}</span>
                            </Td>
                            <Td className="text-[#6B7280]">{t.client || '—'}</Td>
                            <Td><PriorityBadge priority={t.priority} /></Td>
                            <Td className="text-amber-600 font-semibold">{weeks != null ? `${weeks}w` : '—'}</Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

