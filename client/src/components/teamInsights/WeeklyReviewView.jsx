// View 3 — Weekly Review
// Sections: Completion Summary · Slippage Tracker · Estimation Accuracy · Hours Logged

function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{title}</h2>
      {subtitle && <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2, marginBottom: 0 }}>{subtitle}</p>}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 14, color: 'var(--text-3)', background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}>{message}</div>
  );
}

function Td({ children, style = {} }) {
  return <td style={{ padding: '10px 16px', fontSize: 14, ...style }}>{children}</td>;
}

function Th({ children }) {
  return <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</th>;
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
  const day = now.getDay();
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

  const doneOnBoard = tasks.filter(t => {
    if (t.status !== 'Done') return false;
    if (t.dueDate) {
      const d = new Date(t.dueDate);
      return d >= monday && d <= sunday;
    }
    return false;
  });

  const allCompletedThisWeek = [...completedThisWeek, ...doneOnBoard];

  const deferred = tasks.filter(t => t.status === 'Deferred');

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

  const persons = [...new Set(allCompletedThisWeek.map(t => t.assignedTo).filter(Boolean))].sort();
  const hoursByPerson = persons.map(p => {
    const personTasks = allCompletedThisWeek.filter(t => t.assignedTo === p);
    const hours = personTasks.reduce((s, t) => s + (t.effortHours ?? 0), 0);
    return { person: p, tasks: personTasks, hours };
  });

  const tableCard = { background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', overflow: 'hidden' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* ── Completion Summary ────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Completion Summary — This Week"
          subtitle={`Week of ${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — tasks completed (by due date)`}
        />
        {allCompletedThisWeek.length === 0 ? (
          <EmptyState message="No completed tasks found for this week. Check that done tasks are archived with a due date in the current week." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {Object.entries(completionByPerson).map(([person, data]) => (
              <div key={person} style={tableCard}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--surface)', background: 'var(--surface)' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{person}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: 'var(--text-3)' }}>
                    <span><strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{data.tasks.length}</strong> completed</span>
                    <span><strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{data.hours > 0 ? `${data.hours}h` : '—'}</strong> estimated</span>
                  </div>
                </div>
                <div>
                  {data.tasks.map(t => (
                    <div
                      key={t.id}
                      onClick={() => onTaskClick(t)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid var(--surface)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', flexShrink: 0 }}>{t.id}</span>
                        <span style={{ fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                        {t.client && <span style={{ fontSize: 12, color: 'var(--text-3)', flexShrink: 0 }}>{t.client}</span>}
                      </div>
                      <span style={{ fontSize: 14, color: 'var(--text-2)', flexShrink: 0, marginLeft: 12, fontFamily: 'var(--font-mono)' }}>
                        {t.effortHours != null ? `${t.effortHours}h` : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {doneOnBoard.length > 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-3)', padding: '0 4px' }}>
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
          <div style={tableCard}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <Th>Person</Th>
                  <Th>Tasks Completed</Th>
                  <Th>Est. Hours</Th>
                </tr>
              </thead>
              <tbody>
                {hoursByPerson.map(row => (
                  <tr key={row.person} style={{ borderBottom: '1px solid var(--surface)' }}>
                    <Td style={{ fontWeight: 500, color: 'var(--text)' }}>{row.person}</Td>
                    <Td style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{row.tasks.length}</Td>
                    <Td style={{ fontWeight: 600, color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>{row.hours > 0 ? `${row.hours}h` : '—'}</Td>
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
          <div style={tableCard}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
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
                        style={{ borderBottom: '1px solid var(--surface)', cursor: 'pointer' }}
                      >
                        <Td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>{t.id}</Td>
                        <Td style={{ fontWeight: 500, color: 'var(--text)', maxWidth: 220 }}>
                          <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.name}</span>
                        </Td>
                        <Td style={{ color: 'var(--text-2)' }}>{t.assignedTo || '—'}</Td>
                        <Td style={{ color: 'var(--text-2)' }}>{formatDate(t.dueDate)}</Td>
                        <Td style={{ color: weeks != null && weeks > 0 ? 'var(--warning)' : 'var(--text-2)', fontWeight: weeks != null && weeks > 0 ? 600 : 400, fontFamily: 'var(--font-mono)' }}>
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
          <div style={tableCard}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Task Type', 'Completed', 'Avg Effort', 'Missing Effort %', 'Signal'].map(h => <Th key={h}>{h}</Th>)}
                </tr>
              </thead>
              <tbody>
                {estimationStats.map(row => (
                  <tr key={row.type} style={{ borderBottom: '1px solid var(--surface)' }}>
                    <Td style={{ fontWeight: 500, color: 'var(--text)' }}>{row.type}</Td>
                    <Td style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{row.count}</Td>
                    <Td style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{row.avgHours != null ? `${row.avgHours}h` : '—'}</Td>
                    <Td style={{ color: row.missingPct > 50 ? 'var(--danger)' : 'var(--text-2)', fontWeight: row.missingPct > 50 ? 600 : 400, fontFamily: 'var(--font-mono)' }}>
                      {row.missingPct}%
                    </Td>
                    <Td>
                      {row.missingPct > 50 ? (
                        <span style={{ fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 4, background: 'var(--danger-soft)', color: 'var(--danger)' }}>Blind spot</span>
                      ) : row.avgHours != null ? (
                        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>OK</span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--border)' }}>No data</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-3)', borderTop: '1px solid var(--surface)', margin: 0 }}>
              Task types are inferred from task names using keyword patterns. Types with few samples may not be representative.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
