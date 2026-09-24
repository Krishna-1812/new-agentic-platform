// View 2 — Monday Planning
// Sections: Recurring Hours Burden · Backlog Queue by Person · Capacity vs Load · Stale Backlog Flags

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

function weeksOverdue(dueIso) {
  if (!dueIso) return null;
  const diff = Date.now() - new Date(dueIso).getTime();
  return Math.floor(diff / (7 * 86400000));
}

function PriorityBadge({ priority }) {
  const styles = {
    'P1 - Urgent': { background: 'var(--danger-soft)',  color: 'var(--danger)' },
    'P2 - High':   { background: 'var(--warning-soft)', color: 'var(--warning)' },
    'P3 - Normal': { background: 'var(--info-soft)',    color: 'var(--info)' },
    'P4 - Low':    { background: 'var(--surface)',      color: 'var(--text-2)' },
  };
  const s = styles[priority] || { background: 'var(--surface)', color: 'var(--text-2)' };
  const short = priority?.split(' - ')[0] || '—';
  return <span style={{ display: 'inline-block', fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 4, ...s }}>{short}</span>;
}

function CapacityBar({ value, max, color = 'var(--primary)' }) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, background: 'var(--surface)', borderRadius: 999, height: 6 }}>
        <div style={{ height: 6, borderRadius: 999, width: `${pct}%`, background: color }} />
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-2)', width: 32, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{value}h</span>
    </div>
  );
}

export default function MondayPlanningView({ tasks, recurringSchedule, config, onTaskClick }) {
  const { workWeekHours = 35, overCapacityHours = 30, wipLimit = 3, staleBacklogWeeks = 4 } = config;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const nextWeek = new Date(today.getTime() + 7 * 86400000);

  const allPersons = [...new Set([
    ...tasks.map(t => t.assignedTo),
    ...recurringSchedule.map(r => r.person),
  ].filter(Boolean))].sort();

  const recurringByPerson = allPersons.reduce((acc, p) => {
    acc[p] = recurringSchedule.filter(r => r.person === p);
    return acc;
  }, {});

  const backlogTasks = tasks.filter(t => t.status === 'Backlog');
  const backlogByPerson = allPersons.reduce((acc, p) => {
    acc[p] = backlogTasks.filter(t => t.assignedTo === p);
    return acc;
  }, {});

  const wipTasks = tasks.filter(t => t.status === 'In Progress');
  const wipByPerson = allPersons.reduce((acc, p) => {
    acc[p] = wipTasks.filter(t => t.assignedTo === p);
    return acc;
  }, {});

  const staleCutoff = new Date(today.getTime() - staleBacklogWeeks * 7 * 86400000);
  const staleBacklog = backlogTasks.filter(t => t.dueDate && new Date(t.dueDate) < staleCutoff);
  const staleByPerson = allPersons.reduce((acc, p) => {
    acc[p] = staleBacklog.filter(t => t.assignedTo === p);
    return acc;
  }, {});

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

  const tableCard = { background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', overflow: 'hidden' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* ── Recurring Hours Burden ────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Recurring Hours Burden This Week" subtitle="Committed floor before any adhoc work is assigned" />
        {allPersons.length === 0 ? (
          <EmptyState message="No recurring schedule data found." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {allPersons.map(p => {
              const items = recurringByPerson[p];
              const total = items.reduce((s, r) => s + (r.effortHours ?? 0), 0);
              if (items.length === 0) return null;
              return (
                <div key={p} style={tableCard}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--surface)', background: 'var(--surface)' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{p}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)', fontFamily: 'var(--font-mono)' }}>{total}h recurring</span>
                  </div>
                  <div>
                    {items.map((r, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--surface)' }}>
                        <div>
                          <span style={{ fontSize: 14, color: 'var(--text)' }}>{r.taskName || '—'}</span>
                          {r.client && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-3)' }}>{r.client}</span>}
                          {r.frequency && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--info)' }}>{r.frequency}</span>}
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
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
        <div style={tableCard}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Person', 'Recurring hrs', 'Active WIP hrs', 'Backlog hrs', 'Load bar', 'Status'].map(h => (
                  <Th key={h}>{h}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {capacitySummary.map(row => {
                const statusColor =
                  row.status === 'Over capacity' ? 'var(--danger)' :
                  row.status === 'At capacity'   ? 'var(--warning)' :
                  'var(--success)';
                const barColor =
                  row.status === 'Over capacity' ? 'var(--danger)' :
                  row.status === 'At capacity'   ? 'var(--warning)' : 'var(--primary)';
                return (
                  <tr key={row.person} style={{ borderBottom: '1px solid var(--surface)' }}>
                    <Td style={{ fontWeight: 500, color: 'var(--text)' }}>{row.person}</Td>
                    <Td style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{row.recurHours > 0 ? `${row.recurHours}h` : '—'}</Td>
                    <Td style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{row.wipHours > 0 ? `${row.wipHours}h` : '—'}</Td>
                    <Td style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{row.backlogHrs > 0 ? `${row.backlogHrs}h` : '—'}</Td>
                    <Td style={{ minWidth: 120 }}>
                      <CapacityBar value={row.committed} max={workWeekHours} color={barColor} />
                    </Td>
                    <Td style={{ color: statusColor, fontWeight: row.status !== 'Has room' ? 600 : 400 }}>{row.status}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Backlog Queue by Person ───────────────────────────────────────── */}
      <section>
        <SectionHeader title="Backlog Queue by Person" subtitle="Flags P1/P2 items due within 7 days and oldest backlog item per person" />
        {backlogTasks.length === 0 ? (
          <EmptyState message="No backlog tasks." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                <div key={p} style={tableCard}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--surface)', background: 'var(--surface)' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{p}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{items.length} tasks · {totalHrs > 0 ? `${totalHrs}h` : 'no estimates'}</span>
                      {urgent.length > 0 && (
                        <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: 'var(--danger-soft)', color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>
                          {urgent.length} urgent due soon
                        </span>
                      )}
                    </div>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--surface)' }}>
                        {['ID', 'Task', 'Client', 'Priority', 'Due Date', 'Effort'].map(h => <Th key={h}>{h}</Th>)}
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
                            style={{
                              borderBottom: '1px solid var(--surface)', cursor: 'pointer',
                              background: isUrgentDue ? 'var(--danger-soft)' : isOldest ? 'var(--warning-soft)' : 'transparent',
                            }}
                          >
                            <Td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>{t.id}</Td>
                            <Td style={{ fontWeight: 500, color: 'var(--text)', maxWidth: 200 }}>
                              <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.name}</span>
                              {isOldest && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--warning)', background: 'var(--warning-soft)', padding: '1px 4px', borderRadius: 3 }}>Oldest</span>}
                            </Td>
                            <Td style={{ color: 'var(--text-2)' }}>{t.client || '—'}</Td>
                            <Td><PriorityBadge priority={t.priority} /></Td>
                            <Td style={{ color: isUrgentDue ? 'var(--danger)' : 'var(--text-2)', fontWeight: isUrgentDue ? 600 : 400 }}>
                              {formatDate(t.dueDate)}
                            </Td>
                            <Td style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{t.effortHours != null ? `${t.effortHours}h` : '—'}</Td>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {allPersons.map(p => {
              const items = staleByPerson[p];
              if (items.length === 0) return null;
              return (
                <div key={p} style={{ background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--warning)', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--warning-soft)', background: 'var(--warning-soft)' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--warning)' }}>{p}</span>
                    <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--warning)', fontFamily: 'var(--font-mono)' }}>{items.length} stale</span>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--surface)' }}>
                        {['ID', 'Task', 'Client', 'Priority', 'Weeks Overdue'].map(h => <Th key={h}>{h}</Th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(t => {
                        const weeks = weeksOverdue(t.dueDate);
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
                            <Td style={{ color: 'var(--text-2)' }}>{t.client || '—'}</Td>
                            <Td><PriorityBadge priority={t.priority} /></Td>
                            <Td style={{ color: 'var(--warning)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{weeks != null ? `${weeks}w` : '—'}</Td>
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
