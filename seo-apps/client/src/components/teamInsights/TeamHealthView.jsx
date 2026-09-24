// View 5 — Team Health
// Sections: Work Type Distribution · Deferred Task Aging · Review Bottleneck · Pitch Pipeline · P1 Backlog

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

// ── Donut chart (inline SVG) ──────────────────────────────────────────────────
function DonutChart({ segments, size = 80 }) {
  const r = 28;
  const cx = size / 2;
  const circumference = 2 * Math.PI * r;
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--border)' }}>No data</div>;

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
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--surface)" strokeWidth={10} />
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
      <text x={cx} y={cx + 5} textAnchor="middle" fontSize="11" fill="var(--text)" fontWeight="600">
        {total}
      </text>
    </svg>
  );
}

const WORK_TYPE_COLORS = {
  'Recurring': 'var(--primary)',
  'Adhoc':     '#6366F1',
  'Pitch':     'var(--warning)',
};

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
    <div style={{
      background: 'var(--card)', borderRadius: 'var(--r-lg)', padding: 16,
      border: `1px solid ${recurringPct > 75 ? 'var(--warning)' : 'var(--border)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{person}</p>
          {recurringPct > 75 && (
            <p style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 500, marginTop: 2, marginBottom: 0 }}>Recurring &gt;75%</p>
          )}
        </div>
        <DonutChart segments={segments} size={60} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {types.map(t => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: WORK_TYPE_COLORS[t] }} />
              <span style={{ color: 'var(--text-2)' }}>{t}</span>
            </div>
            <span style={{ fontWeight: 500, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
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

  const activeTasks = tasks.filter(t => t.status !== 'Done');
  const typesByPerson = persons.reduce((acc, p) => {
    acc[p] = activeTasks.filter(t => t.assignedTo === p);
    return acc;
  }, {});

  const globalTypes = ['Recurring', 'Adhoc', 'Pitch'].map(t => ({
    label: t, value: activeTasks.filter(task => task.workType === t).length, color: WORK_TYPE_COLORS[t],
  }));
  const globalTotal = activeTasks.length;

  const deferred = tasks.filter(t => t.status === 'Deferred');
  const deferredByPerson = deferred.reduce((acc, t) => {
    const k = t.assignedTo || 'Unassigned';
    if (!acc[k]) acc[k] = [];
    acc[k].push(t);
    return acc;
  }, {});

  const inReview = tasks.filter(t => t.status === 'In Review');
  const inReviewByClient = inReview.reduce((acc, t) => {
    const c = t.client || 'Unknown';
    if (!acc[c]) acc[c] = [];
    acc[c].push(t);
    return acc;
  }, {});

  const activePitch = tasks.filter(t => t.workType === 'Pitch');
  const donePitch = archiveTasks.filter(t => t.workType === 'Pitch' && t.status === 'Done');
  const totalPitchHours = activePitch.reduce((s, t) => s + (t.effortHours ?? 0), 0);

  const p1Backlog = tasks.filter(t => t.priority === 'P1 - Urgent' && t.status === 'Backlog');

  const tableCard = { background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', overflow: 'hidden' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* ── Work Type Distribution ────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Work Type Distribution" subtitle="Recurring vs Adhoc vs Pitch across active tasks. Flag: any person with recurring > 75%." />
        <div style={{ ...tableCard, padding: 16, display: 'flex', alignItems: 'center', gap: 24, marginBottom: 16 }}>
          <DonutChart segments={globalTypes} size={80} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {globalTypes.map(t => (
              <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', flexShrink: 0, background: t.color }} />
                <span style={{ color: 'var(--text-2)' }}>{t.label}</span>
                <span style={{ fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                  {t.value}
                  {globalTotal > 0 ? <span style={{ color: 'var(--text-3)', fontWeight: 400, marginLeft: 4 }}>({Math.round((t.value / globalTotal) * 100)}%)</span> : ''}
                </span>
              </div>
            ))}
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '4px 0 0' }}>Total active: {globalTotal}</p>
          </div>
        </div>
        {persons.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
            {persons.map(p => <WorkTypeCard key={p} person={p} tasks={typesByPerson[p]} />)}
          </div>
        )}
      </section>

      {/* ── Deferred Task Aging ────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Deferred Task Aging" subtitle={`Highlight: tasks deferred more than ${deferredWarningDays} days`} />
        {deferred.length === 0 ? (
          <EmptyState message="No deferred tasks." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {Object.entries(deferredByPerson).map(([person, items]) => (
              <div key={person} style={tableCard}>
                <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--surface)', background: 'var(--surface)' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{person}</span>
                  <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{items.length} deferred</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--surface)' }}>
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
                          style={{
                            borderBottom: '1px solid var(--surface)', cursor: 'pointer',
                            background: warn ? 'var(--warning-soft)' : 'transparent',
                          }}
                        >
                          <Td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>{t.id}</Td>
                          <Td style={{ fontWeight: 500, color: 'var(--text)', maxWidth: 200 }}>
                            <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.name}</span>
                          </Td>
                          <Td style={{ color: 'var(--text-2)' }}>{t.client || '—'}</Td>
                          <Td style={{ color: 'var(--text-2)' }}>{formatDate(t.dueDate)}</Td>
                          <Td style={{ color: warn ? 'var(--warning)' : 'var(--text-2)', fontWeight: warn ? 700 : 400, fontFamily: 'var(--font-mono)' }}>
                            {days != null ? `${days}d` : '—'}
                            {warn && <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--warning-soft)', color: 'var(--warning)', padding: '1px 4px', borderRadius: 3, fontWeight: 600 }}>stale</span>}
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
        <SectionHeader title="Review Bottleneck" subtitle="Tasks in In Review status, grouped by client. Flags past-due review tasks." />
        {inReview.length === 0 ? (
          <EmptyState message="No tasks in review." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {Object.entries(inReviewByClient).map(([client, items]) => (
              <div key={client} style={tableCard}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--surface)', background: 'var(--surface)' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{client}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{items.length} in review</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--surface)' }}>
                      {['ID', 'Task', 'Assignee', 'Due Date', 'Days in Status'].map(h => <Th key={h}>{h}</Th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(t => (
                      <tr
                        key={t.id}
                        onClick={() => onTaskClick(t)}
                        style={{
                          borderBottom: '1px solid var(--surface)', cursor: 'pointer',
                          background: t.isOverdue ? 'var(--danger-soft)' : 'transparent',
                        }}
                      >
                        <Td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>{t.id}</Td>
                        <Td style={{ fontWeight: 500, color: 'var(--text)', maxWidth: 200 }}>
                          <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.name}</span>
                        </Td>
                        <Td style={{ color: 'var(--text-2)' }}>{t.assignedTo || '—'}</Td>
                        <Td style={{ color: t.isOverdue ? 'var(--danger)' : 'var(--text-2)', fontWeight: t.isOverdue ? 600 : 400 }}>
                          {formatDate(t.dueDate)}
                          {t.isOverdue && <span style={{ marginLeft: 4 }}>⚠</span>}
                        </Td>
                        <Td style={{ color: 'var(--text-3)', fontSize: 12, fontStyle: 'italic' }}>
                          {t.daysInCurrentStatus != null ? `${t.daysInCurrentStatus}d` : 'Date tracking not available'}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {inReview.some(t => t.daysInCurrentStatus === null) && (
              <p style={{ fontSize: 12, color: 'var(--text-3)', padding: '0 4px' }}>
                Day tracking requires a "Date Entered Status" column in the sheet (currently not present).
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── Pitch Pipeline ────────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Pitch Pipeline" subtitle="Active pitch work and historical log from archive" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {activePitch.length === 0 ? (
            <EmptyState message="No active pitch tasks." />
          ) : (
            <div style={tableCard}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--surface)', background: 'var(--surface)' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Active Pitch Work</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--warning)', fontFamily: 'var(--font-mono)' }}>
                  {totalPitchHours > 0 ? `${totalPitchHours}h committed` : `${activePitch.length} tasks`}
                </span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--surface)' }}>
                    {['ID', 'Task', 'Assignee', 'Status', 'Effort', 'Due'].map(h => <Th key={h}>{h}</Th>)}
                  </tr>
                </thead>
                <tbody>
                  {activePitch.map(t => (
                    <tr
                      key={t.id}
                      onClick={() => onTaskClick(t)}
                      style={{ borderBottom: '1px solid var(--surface)', cursor: 'pointer' }}
                    >
                      <Td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>{t.id}</Td>
                      <Td style={{ fontWeight: 500, color: 'var(--text)', maxWidth: 200 }}>
                        <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.name}</span>
                      </Td>
                      <Td style={{ color: 'var(--text-2)' }}>{t.assignedTo || '—'}</Td>
                      <Td>
                        <span style={{ fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 4, background: 'var(--warning-soft)', color: 'var(--warning)' }}>{t.status}</span>
                      </Td>
                      <Td style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{t.effortHours != null ? `${t.effortHours}h` : '—'}</Td>
                      <Td style={{ color: t.isOverdue ? 'var(--danger)' : 'var(--text-2)', fontWeight: t.isOverdue ? 600 : 400 }}>{formatDate(t.dueDate)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {donePitch.length > 0 && (
            <div style={tableCard}>
              <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--surface)', background: 'var(--surface)' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Completed Pitch Work</span>
                <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{donePitch.length} tasks</span>
              </div>
              <div>
                {donePitch.slice(0, 20).map(t => (
                  <div
                    key={t.id}
                    onClick={() => onTaskClick(t)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid var(--surface)' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', flexShrink: 0 }}>{t.id}</span>
                      <span style={{ fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, marginLeft: 12 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{t.assignedTo || '—'}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{formatDate(t.dueDate)}</span>
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
        <SectionHeader title="P1 Backlog" subtitle="Urgent tasks that haven't started — these should not exist. Any P1 in Backlog is a process failure." />
        {p1Backlog.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 14, color: 'var(--success)', background: 'var(--success-soft)', borderRadius: 'var(--r-lg)', border: '1px solid var(--success)' }}>
            No P1 tasks sitting in Backlog. Process health is good here.
          </div>
        ) : (
          <div style={{ background: 'var(--danger-soft)', borderRadius: 'var(--r-lg)', border: '2px solid var(--danger)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--danger)', background: 'rgba(211,52,46,0.12)' }}>
              <svg style={{ width: 16, height: 16, color: 'var(--danger)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--danger)' }}>
                {p1Backlog.length} P1 task{p1Backlog.length !== 1 ? 's' : ''} sitting in Backlog — needs immediate attention
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--danger)' }}>
                  {['ID', 'Task', 'Client', 'Assignee', 'Due Date'].map(h => <Th key={h}>{h}</Th>)}
                </tr>
              </thead>
              <tbody>
                {p1Backlog.map(t => (
                  <tr
                    key={t.id}
                    onClick={() => onTaskClick(t)}
                    style={{ borderBottom: '1px solid rgba(211,52,46,0.2)', cursor: 'pointer' }}
                  >
                    <Td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--danger)' }}>{t.id}</Td>
                    <Td style={{ fontWeight: 700, color: 'var(--danger)', maxWidth: 200 }}>
                      <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.name}</span>
                    </Td>
                    <Td style={{ color: 'var(--danger)' }}>{t.client || '—'}</Td>
                    <Td style={{ color: 'var(--danger)' }}>{t.assignedTo || 'Unassigned'}</Td>
                    <Td style={{ color: 'var(--danger)', fontWeight: t.isOverdue ? 700 : 400, fontFamily: 'var(--font-mono)' }}>
                      {formatDate(t.dueDate)}
                      {t.isOverdue && <span style={{ marginLeft: 4 }}>(+{t.daysOverdue}d)</span>}
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
