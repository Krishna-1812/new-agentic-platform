// View 3 — Weekly Review
// Sections: Completion Summary · Slippage Tracker · Estimation Accuracy · Hours Logged

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

// Infer task type from name using keyword patterns
const TASK_TYPE_PATTERNS = [
  { type: 'GBP Post',               pattern: /gbp\s*post|google\s*business/i },
  { type: 'Tech Audit',             pattern: /tech(nical)?\s*audit/i },
  { type: 'Content Recommendation', pattern: /content\s*rec|content\s*brief/i },
  { type: 'L+S Page Review',        pattern: /l\+s|location.+service|service.+location/i },
  { type: 'Keyword Research',       pattern: /keyword\s*research/i },
  { type: 'Link Building',          pattern: /link\s*build/i },
  { type: 'Reporting',              pattern: /report(ing)?/i },
  { type: 'On-Page SEO',            pattern: /on.page|meta\s*tag|title\s*tag/i },
  { type: 'Article',                pattern: /article|blog\s*post|content\s*writ/i },
];

function inferTaskType(name) {
  if (!name) return 'Other';
  for (const { type, pattern } of TASK_TYPE_PATTERNS) {
    if (pattern.test(name)) return type;
  }
  return 'Other';
}

function getWeekBounds() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday, sunday };
}

export default function WeeklyReviewView({ tasks, archiveTasks, onTaskClick }) {
  const { monday, sunday } = getWeekBounds();

  // ── Completion summary ────────────────────────────────────────────────────
  // Tasks from archive that are Done within the current week (by dueDate or week field)
  const completedThisWeek = archiveTasks.filter(t => {
    if (t.status !== 'Done') return false;
    if (t.dueDate) {
      const d = new Date(t.dueDate);
      return d >= monday && d <= sunday;
    }
    return false;
  });

  const completionByPerson = completedThisWeek.reduce((acc, t) => {
    const k = t.assignedTo || 'Unassigned';
    if (!acc[k]) acc[k] = { tasks: [], hours: 0 };
    acc[k].tasks.push(t);
    acc[k].hours += t.effortHours ?? 0;
    return acc;
  }, {});

  // Also check main task board for Done tasks this week (might not be in archive yet)
  const doneOnBoard = tasks.filter(t => {
    if (t.status !== 'Done') return false;
    if (t.dueDate) {
      const d = new Date(t.dueDate);
      return d >= monday && d <= sunday;
    }
    return false;
  });

  const allCompletedThisWeek = [...completedThisWeek, ...doneOnBoard];

  // ── Slippage tracker ──────────────────────────────────────────────────────
  const deferred = tasks.filter(t => t.status === 'Deferred');

  // ── Estimation accuracy ───────────────────────────────────────────────────
  const allDone = [...archiveTasks.filter(t => t.status === 'Done'), ...tasks.filter(t => t.status === 'Done')];

  const byType = allDone.reduce((acc, t) => {
    const type = inferTaskType(t.name);
    if (!acc[type]) acc[type] = { tasks: [], withEffort: 0, withoutEffort: 0, totalHours: 0 };
    acc[type].tasks.push(t);
    if (t.effortHours != null) {
      acc[type].withEffort++;
      acc[type].totalHours += t.effortHours;
    } else {
      acc[type].withoutEffort++;
    }
    return acc;
  }, {});

  const estimationStats = Object.entries(byType)
    .map(([type, data]) => ({
      type,
      count: data.tasks.length,
      avgHours: data.withEffort > 0 ? (data.totalHours / data.withEffort).toFixed(1) : null,
      missingPct: Math.round((data.withoutEffort / data.tasks.length) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  // ── Hours logged ──────────────────────────────────────────────────────────
  const persons = [...new Set(allCompletedThisWeek.map(t => t.assignedTo).filter(Boolean))].sort();
  const hoursByPerson = persons.map(p => {
    const personTasks = allCompletedThisWeek.filter(t => t.assignedTo === p);
    const hours = personTasks.reduce((s, t) => s + (t.effortHours ?? 0), 0);
    return { person: p, tasks: personTasks, hours };
  });

  return (
    <div className="space-y-8">

      {/* ── Completion Summary ────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Completion Summary — This Week"
          subtitle={`Week of ${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — tasks completed (by due date)`}
        />
        {allCompletedThisWeek.length === 0 ? (
          <EmptyState message="No completed tasks found for this week. Check that done tasks are archived with a due date in the current week." />
        ) : (
          <div className="space-y-3">
            {Object.entries(completionByPerson).map(([person, data]) => (
              <div key={person} className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#F3F4F6] bg-[#F9FAFB]">
                  <span className="text-sm font-semibold text-[#374151]">{person}</span>
                  <div className="flex items-center gap-4 text-xs text-[#9CA3AF]">
                    <span><strong className="text-[#111827]">{data.tasks.length}</strong> completed</span>
                    <span><strong className="text-[#111827]">{data.hours > 0 ? `${data.hours}h` : '—'}</strong> estimated</span>
                  </div>
                </div>
                <div className="divide-y divide-[#F3F4F6]">
                  {data.tasks.map(t => (
                    <div
                      key={t.id}
                      onClick={() => onTaskClick(t)}
                      className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-[#F9FAFB] transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-mono text-[#9CA3AF] flex-shrink-0">{t.id}</span>
                        <span className="text-sm text-[#111827] truncate">{t.name}</span>
                        {t.client && <span className="text-xs text-[#9CA3AF] flex-shrink-0">{t.client}</span>}
                      </div>
                      <span className="text-sm text-[#6B7280] flex-shrink-0 ml-3">
                        {t.effortHours != null ? `${t.effortHours}h` : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {/* Board done tasks not in archive */}
            {doneOnBoard.length > 0 && (
              <p className="text-xs text-[#9CA3AF] px-1">
                Note: {doneOnBoard.length} task(s) marked Done on the Task Board but not yet archived.
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── Hours Logged This Week ────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Hours Logged This Week"
          subtitle="Sum of estimated hours on tasks completed this week (not actual time-tracked hours)"
        />
        {hoursByPerson.length === 0 ? (
          <EmptyState message="No hours data available for this week." />
        ) : (
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E5E7EB]">
                  <Th>Person</Th>
                  <Th>Tasks Completed</Th>
                  <Th>Est. Hours</Th>
                </tr>
              </thead>
              <tbody>
                {hoursByPerson.map(row => (
                  <tr key={row.person} className="border-b border-[#F3F4F6] last:border-0">
                    <Td className="font-medium text-[#111827]">{row.person}</Td>
                    <Td className="text-[#6B7280]">{row.tasks.length}</Td>
                    <Td className="font-semibold text-[#3DAA8E]">{row.hours > 0 ? `${row.hours}h` : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Slippage Tracker ─────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Slippage Tracker"
          subtitle="Tasks in Deferred status — likely pushed from an earlier week"
        />
        {deferred.length === 0 ? (
          <EmptyState message="No deferred tasks — good discipline!" />
        ) : (
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E5E7EB]">
                  {['ID', 'Task', 'Assignee', 'Original Due', 'Weeks Deferred'].map(h => <Th key={h}>{h}</Th>)}
                </tr>
              </thead>
              <tbody>
                {deferred
                  .sort((a, b) => {
                    const da = a.dueDate ? new Date(a.dueDate) : new Date();
                    const db = b.dueDate ? new Date(b.dueDate) : new Date();
                    return da - db;
                  })
                  .map(t => {
                    const weeks = t.dueDate
                      ? Math.max(0, Math.floor((Date.now() - new Date(t.dueDate).getTime()) / (7 * 86400000)))
                      : null;
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
                        <Td className="text-[#6B7280]">{t.assignedTo || '—'}</Td>
                        <Td className="text-[#6B7280]">{formatDate(t.dueDate)}</Td>
                        <Td className={weeks != null && weeks > 0 ? 'text-amber-600 font-semibold' : 'text-[#6B7280]'}>
                          {weeks != null ? `${weeks}w` : '—'}
                        </Td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Estimation Accuracy ───────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Estimation Accuracy"
          subtitle="From archived Done tasks — grouped by inferred task type. Tasks with >50% missing effort are blind spots."
        />
        {estimationStats.length === 0 ? (
          <EmptyState message="No completed tasks in archive to analyze." />
        ) : (
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E5E7EB]">
                  {['Task Type', 'Completed', 'Avg Effort', 'Missing Effort %', 'Signal'].map(h => <Th key={h}>{h}</Th>)}
                </tr>
              </thead>
              <tbody>
                {estimationStats.map(row => (
                  <tr key={row.type} className="border-b border-[#F3F4F6] last:border-0">
                    <Td className="font-medium text-[#111827]">{row.type}</Td>
                    <Td className="text-[#6B7280]">{row.count}</Td>
                    <Td className="text-[#6B7280]">{row.avgHours != null ? `${row.avgHours}h` : '—'}</Td>
                    <Td className={row.missingPct > 50 ? 'text-red-600 font-semibold' : 'text-[#6B7280]'}>
                      {row.missingPct}%
                    </Td>
                    <Td>
                      {row.missingPct > 50 ? (
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-red-100 text-red-700">Blind spot</span>
                      ) : row.avgHours != null ? (
                        <span className="text-xs text-[#9CA3AF]">OK</span>
                      ) : (
                        <span className="text-xs text-[#D1D5DB]">No data</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-4 py-2.5 text-xs text-[#9CA3AF] border-t border-[#F3F4F6]">
              Task types are inferred from task names using keyword patterns. Types with few samples may not be representative.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
