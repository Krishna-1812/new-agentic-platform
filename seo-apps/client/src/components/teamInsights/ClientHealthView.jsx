// View 4 — Client Health
// Sections: Active Load by Client · Blocked/Overdue by Client · Recurring Cadence · SOW Coverage

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
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function HBar({ value, max, label, color = 'var(--primary)' }) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, background: 'var(--surface)', borderRadius: 999, height: 8 }}>
        <div style={{ height: 8, borderRadius: 999, width: `${pct}%`, background: color, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-2)', width: 64, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{label}</span>
    </div>
  );
}

function CadenceFlag({ flag }) {
  const map = {
    'On Track': { background: 'var(--success-soft)', color: 'var(--success)' },
    'At Risk':  { background: 'var(--warning-soft)', color: 'var(--warning)' },
    'Missed':   { background: 'var(--danger-soft)',  color: 'var(--danger)' },
  };
  const s = map[flag] || { background: 'var(--surface)', color: 'var(--text-2)' };
  return <span style={{ fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 4, ...s }}>{flag}</span>;
}

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

  const atRisk = tasks.filter(t => t.status === 'Blocked' || t.isOverdue);
  const riskByClient = atRisk.reduce((acc, t) => {
    const c = t.client || 'Unknown';
    if (!acc[c]) acc[c] = [];
    acc[c].push(t);
    return acc;
  }, {});

  const cadenceRows = recurringSchedule
    .filter(r => r.client && r.taskName)
    .map(r => {
      const windowDays = getWindowDays(r.frequency);
      const cutoff = new Date(today.getTime() - windowDays * 86400000);

      const matchingDone = allTasks.filter(t => {
        if (t.status !== 'Done') return false;
        if (t.client !== r.client) return false;
        if (!t.name.toLowerCase().includes(r.taskName.toLowerCase().split(' ')[0])) return false;
        return t.dueDate && new Date(t.dueDate) >= cutoff;
      });

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

  const tableCard = { background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', overflow: 'hidden' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* ── Active Load by Client ─────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Active Load by Client" subtitle="In Progress + Backlog tasks sorted by total estimated hours" />
        {clientLoad.length === 0 ? (
          <EmptyState message="No active tasks found." />
        ) : (
          <div style={tableCard}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Client', 'In Progress', 'Backlog', 'Total Hours', 'Load'].map(h => <Th key={h}>{h}</Th>)}
                </tr>
              </thead>
              <tbody>
                {clientLoad.map(row => (
                  <tr key={row.client} style={{ borderBottom: '1px solid var(--surface)' }}>
                    <Td style={{ fontWeight: 600, color: 'var(--text)' }}>{row.client}</Td>
                    <Td style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{row.inProgress}</Td>
                    <Td style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{row.backlog}</Td>
                    <Td style={{ fontWeight: 500, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{row.totalHours > 0 ? `${row.totalHours}h` : '—'}</Td>
                    <Td style={{ minWidth: 160 }}>
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
        <SectionHeader title="Blocked or Overdue by Client" subtitle="Client relationship risks to address before the next call" />
        {Object.keys(riskByClient).length === 0 ? (
          <EmptyState message="No blocked or overdue tasks across any client." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {Object.entries(riskByClient).map(([client, items]) => (
              <div key={client} style={{ background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--danger)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--danger-soft)', background: 'var(--danger-soft)' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--danger)' }}>{client}</span>
                  <span style={{ fontSize: 12, color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>{items.length} at-risk task{items.length !== 1 ? 's' : ''}</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--surface)' }}>
                      {['ID', 'Task', 'Assignee', 'Status', 'Due Date'].map(h => <Th key={h}>{h}</Th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(t => (
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
                        <Td>
                          <span style={{
                            fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 4,
                            background: t.status === 'Blocked' ? 'var(--danger-soft)' : 'var(--warning-soft)',
                            color: t.status === 'Blocked' ? 'var(--danger)' : 'var(--warning)',
                          }}>{t.status}</span>
                        </Td>
                        <Td style={{ color: t.isOverdue ? 'var(--danger)' : 'var(--text-2)', fontWeight: t.isOverdue ? 600 : 400 }}>
                          {formatDate(t.dueDate) || '—'}
                          {t.isOverdue && t.daysOverdue && <span style={{ marginLeft: 4, fontSize: 12, fontFamily: 'var(--font-mono)' }}>(+{t.daysOverdue}d)</span>}
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
          <div style={tableCard}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Client', 'Task Type', 'Assignee', 'Frequency', 'Last Completed', 'Status'].map(h => <Th key={h}>{h}</Th>)}
                </tr>
              </thead>
              <tbody>
                {cadenceRows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--surface)' }}>
                    <Td style={{ fontWeight: 500, color: 'var(--text)' }}>{row.client}</Td>
                    <Td style={{ color: 'var(--text-2)' }}>{row.taskType}</Td>
                    <Td style={{ color: 'var(--text-2)' }}>{row.person || '—'}</Td>
                    <Td style={{ color: 'var(--text-2)' }}>{row.frequency || '—'}</Td>
                    <Td style={{ color: 'var(--text-2)' }}>{formatDate(row.lastCompleted) || 'None on record'}</Td>
                    <Td><CadenceFlag flag={row.flag} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-3)', borderTop: '1px solid var(--surface)', margin: 0 }}>
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
          <div style={{ background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--warning)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--warning-soft)', background: 'var(--warning-soft)' }}>
                  {['Client', 'Last Completed Task', 'Last Activity', 'Days Since'].map(h => <Th key={h}>{h}</Th>)}
                </tr>
              </thead>
              <tbody>
                {sowGaps.map(row => (
                  <tr key={row.client} style={{ borderBottom: '1px solid var(--surface)' }}>
                    <Td style={{ fontWeight: 600, color: 'var(--text)' }}>{row.client}</Td>
                    <Td style={{ color: 'var(--text-2)', maxWidth: 200 }}>
                      {row.lastTask
                        ? <span style={{ display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{row.lastTask.name}</span>
                        : <span style={{ color: 'var(--border)' }}>No history</span>}
                    </Td>
                    <Td style={{ color: 'var(--text-2)' }}>{formatDate(row.lastTask?.dueDate) || '—'}</Td>
                    <Td style={{ color: row.daysSince != null && row.daysSince > 14 ? 'var(--warning)' : 'var(--text-2)', fontWeight: row.daysSince != null && row.daysSince > 14 ? 600 : 400, fontFamily: 'var(--font-mono)' }}>
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
