// View 1 — Morning Triage
// Sections: Blocked Tasks · Overdue Tasks · WIP Status per Person · Today's P1 Tasks

function SectionHeader({ title, count, subtitle }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{title}</h2>
        {count != null && (
          <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--surface)', color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{count}</span>
        )}
      </div>
      {subtitle && <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2, marginBottom: 0 }}>{subtitle}</p>}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 14, color: 'var(--text-3)', background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}>
      {message}
    </div>
  );
}

function TaskRow({ task, onTaskClick, children }) {
  return (
    <tr
      onClick={() => onTaskClick(task)}
      style={{
        borderBottom: '1px solid var(--surface)',
        cursor: 'pointer',
        background: task.priority === 'P1 - Urgent' ? 'rgba(var(--danger-rgb, 211,52,46), 0.04)' : 'transparent',
      }}
    >
      {children}
    </tr>
  );
}

function Td({ children, style = {} }) {
  return <td style={{ padding: '10px 16px', fontSize: 14, ...style }}>{children}</td>;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function PriorityBadge({ priority }) {
  const styles = {
    'P1 - Urgent': { background: 'var(--danger-soft)',  color: 'var(--danger)' },
    'P2 - High':   { background: 'var(--warning-soft)', color: 'var(--warning)' },
    'P3 - Normal': { background: 'var(--info-soft)',    color: 'var(--info)' },
    'P4 - Low':    { background: 'var(--surface)',      color: 'var(--text-2)' },
  };
  const s = styles[priority] || { background: 'var(--surface)', color: 'var(--text-2)' };
  const label = priority?.replace('P1 - ', '').replace('P2 - ', '').replace('P3 - ', '').replace('P4 - ', '') || '—';
  return <span style={{ display: 'inline-block', fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 4, ...s }}>{label}</span>;
}

function StatusBadge({ status }) {
  const styles = {
    'Blocked':     { background: 'var(--danger-soft)',  color: 'var(--danger)' },
    'In Progress': { background: 'var(--info-soft)',    color: 'var(--info)' },
    'In Review':   { background: 'var(--info-soft)',    color: 'var(--info)' },
    'Backlog':     { background: 'var(--surface)',      color: 'var(--text-2)' },
    'Today':       { background: 'var(--primary-soft)', color: 'var(--primary)' },
    'This Week':   { background: 'var(--primary-soft)', color: 'var(--primary)' },
    'Deferred':    { background: 'var(--warning-soft)', color: 'var(--warning)' },
    'Done':        { background: 'var(--success-soft)', color: 'var(--success)' },
  };
  const s = styles[status] || { background: 'var(--surface)', color: 'var(--text-2)' };
  return <span style={{ display: 'inline-block', fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 4, ...s }}>{status || '—'}</span>;
}

function Th({ children }) {
  return (
    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {children}
    </th>
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

  const cardBorder =
    wipCount === 0 && backlog.length > 15 ? 'var(--warning)' :
    wipCount <= 2 ? 'var(--success)' :
    wipCount === 3 ? 'var(--warning)' :
    'var(--danger)';

  const cardBg =
    wipCount === 0 && backlog.length > 15 ? 'var(--warning-soft)' :
    wipCount <= 2 ? 'var(--success-soft)' :
    wipCount === 3 ? 'var(--warning-soft)' :
    'var(--danger-soft)';

  const wipIndicator =
    wipCount <= 2 ? { color: 'var(--success)', label: 'On track' } :
    wipCount === 3 ? { color: 'var(--warning)', label: 'At limit' } :
    { color: 'var(--danger)', label: 'Over limit' };

  return (
    <div style={{ borderRadius: 'var(--r-lg)', border: `2px solid ${cardBorder}`, background: cardBg, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{person}</p>
          <p style={{ fontSize: 12, fontWeight: 500, marginTop: 2, marginBottom: 0, color: wipIndicator.color }}>{wipIndicator.label}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, margin: 0, fontFamily: 'var(--font-mono)', color: wipCount > wipLimit ? 'var(--danger)' : 'var(--text)' }}>
            {wipCount}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '2px 0 0', fontFamily: 'var(--font-mono)' }}>/ {wipLimit} WIP</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
        <div>
          <span style={{ color: 'var(--text-3)' }}>In Progress</span>
          <span style={{ marginLeft: 6, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{wipHours > 0 ? `${wipHours}h` : '—'}</span>
        </div>
        <div style={{ width: 1, background: 'var(--border)' }} />
        <div>
          <span style={{ color: 'var(--text-3)' }}>Blocked</span>
          <span style={{ marginLeft: 6, fontWeight: 600, color: blocked.length > 0 ? 'var(--danger)' : 'var(--text)', fontFamily: 'var(--font-mono)' }}>
            {blocked.length}
          </span>
        </div>
        <div style={{ width: 1, background: 'var(--border)' }} />
        <div>
          <span style={{ color: 'var(--text-3)' }}>Backlog</span>
          <span style={{ marginLeft: 6, fontWeight: 600, color: backlog.length > 15 ? 'var(--warning)' : 'var(--text)', fontFamily: 'var(--font-mono)' }}>
            {backlog.length}
            {backlog.length > 15 && <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 600, color: 'var(--warning)' }}>Large queue</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function MorningTriageView({ tasks, config, onTaskClick }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const blocked = tasks
    .filter(t => t.status === 'Blocked')
    .sort((a, b) => {
      const da = a.dueDate ? new Date(a.dueDate) : new Date('9999-12-31');
      const db = b.dueDate ? new Date(b.dueDate) : new Date('9999-12-31');
      return da - db;
    });

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

  const persons = [...new Set(tasks.map(t => t.assignedTo).filter(Boolean))].sort();
  const tasksByPerson = persons.reduce((acc, p) => {
    acc[p] = tasks.filter(t => t.assignedTo === p);
    return acc;
  }, {});

  const p1Tasks = tasks.filter(t =>
    t.priority === 'P1 - Urgent' && t.status !== 'Done' && t.status !== 'Archived'
  );

  const tableCard = { background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', overflow: 'hidden' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* ── Blocked Tasks ─────────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Blocked Tasks" count={blocked.length} subtitle="Sorted by due date — address these first" />
        {blocked.length === 0 ? (
          <EmptyState message="No blocked tasks — clear!" />
        ) : (
          <div style={tableCard}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['ID', 'Task', 'Client', 'Assignee', 'Due Date', 'Notes'].map(h => <Th key={h}>{h}</Th>)}
                </tr>
              </thead>
              <tbody>
                {blocked.map(t => {
                  const pastDue = t.dueDate && new Date(t.dueDate) < today;
                  return (
                    <TaskRow key={t.id} task={t} onTaskClick={onTaskClick}>
                      <Td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>{t.id}</Td>
                      <Td style={{ fontWeight: 500, color: 'var(--text)', maxWidth: 200 }}>
                        <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.name}</span>
                      </Td>
                      <Td style={{ color: 'var(--text-2)' }}>{t.client || '—'}</Td>
                      <Td style={{ color: 'var(--text-2)' }}>{t.assignedTo || '—'}</Td>
                      <Td style={{ color: pastDue ? 'var(--danger)' : 'var(--text-2)', fontWeight: pastDue ? 600 : 400 }}>
                        {formatDate(t.dueDate)}
                        {pastDue && <span style={{ marginLeft: 4 }}>⚠</span>}
                      </Td>
                      <Td style={{ color: 'var(--text-2)', maxWidth: 180 }}>
                        <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: 12 }}>{t.notes || '—'}</span>
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
        <SectionHeader title="Overdue Tasks" count={overdue.length} subtitle="Grouped by assignee · P1 first, then by days overdue" />
        {overdue.length === 0 ? (
          <EmptyState message="No overdue tasks — all clear!" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {Object.entries(overdueByPerson).map(([person, personTasks]) => (
              <div key={person} style={tableCard}>
                <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--surface)', background: 'var(--surface)' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{person}</span>
                  <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{personTasks.length} overdue</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--surface)' }}>
                      {['ID', 'Task', 'Client', 'Priority', 'Days Overdue'].map(h => <Th key={h}>{h}</Th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {personTasks.map(t => (
                      <TaskRow key={t.id} task={t} onTaskClick={onTaskClick}>
                        <Td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>{t.id}</Td>
                        <Td style={{ fontWeight: 500, color: 'var(--text)', maxWidth: 220 }}>
                          <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.name}</span>
                        </Td>
                        <Td style={{ color: 'var(--text-2)' }}>{t.client || '—'}</Td>
                        <Td><PriorityBadge priority={t.priority} /></Td>
                        <Td style={{ color: t.priority === 'P1 - Urgent' ? 'var(--danger)' : 'var(--text-2)', fontWeight: t.priority === 'P1 - Urgent' ? 700 : 400, fontFamily: 'var(--font-mono)' }}>
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
        <SectionHeader title="WIP Status" subtitle={`WIP limit: ${config.wipLimit || 3} per person · Green ≤2, Amber = 3, Red ≥4`} />
        {persons.length === 0 ? (
          <EmptyState message="No assignees found in active tasks." />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
            {persons.map(p => (
              <WipCard key={p} person={p} tasks={tasksByPerson[p]} config={config} onTaskClick={onTaskClick} />
            ))}
          </div>
        )}
      </section>

      {/* ── Today's P1 Tasks ─────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Today's P1 Tasks" count={p1Tasks.length} subtitle="All Urgent priority tasks not yet Done" />
        {p1Tasks.length === 0 ? (
          <EmptyState message="No P1 tasks outstanding." />
        ) : (
          <div style={tableCard}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['ID', 'Task', 'Client', 'Assignee', 'Status', 'Due Date'].map(h => <Th key={h}>{h}</Th>)}
                </tr>
              </thead>
              <tbody>
                {p1Tasks.map(t => (
                  <TaskRow key={t.id} task={t} onTaskClick={onTaskClick}>
                    <Td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>{t.id}</Td>
                    <Td style={{ fontWeight: 600, color: 'var(--text)', maxWidth: 200 }}>
                      <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.name}</span>
                    </Td>
                    <Td style={{ color: 'var(--text-2)' }}>{t.client || '—'}</Td>
                    <Td style={{ color: 'var(--text-2)' }}>{t.assignedTo || '—'}</Td>
                    <Td><StatusBadge status={t.status} /></Td>
                    <Td style={{ color: t.isOverdue ? 'var(--danger)' : 'var(--text-2)', fontWeight: t.isOverdue ? 600 : 400 }}>{formatDate(t.dueDate)}</Td>
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
