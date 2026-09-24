import { useEffect } from 'react';

const PRIORITY_STYLES = {
  'P1 - Urgent': { background: 'var(--danger-soft)',  color: 'var(--danger)' },
  'P2 - High':   { background: 'var(--warning-soft)', color: 'var(--warning)' },
  'P3 - Normal': { background: 'var(--info-soft)',    color: 'var(--info)' },
  'P4 - Low':    { background: 'var(--surface)',      color: 'var(--text-2)' },
};

const STATUS_STYLES = {
  'Blocked':     { background: 'var(--danger-soft)',  color: 'var(--danger)' },
  'In Progress': { background: 'var(--info-soft)',    color: 'var(--info)' },
  'In Review':   { background: 'var(--info-soft)',    color: 'var(--info)' },
  'Done':        { background: 'var(--success-soft)', color: 'var(--success)' },
  'Deferred':    { background: 'var(--warning-soft)', color: 'var(--warning)' },
  'Backlog':     { background: 'var(--surface)',      color: 'var(--text-2)' },
  'This Week':   { background: 'var(--primary-soft)', color: 'var(--primary)' },
  'Today':       { background: 'var(--primary-soft)', color: 'var(--primary)' },
};

function Field({ label, value, children }) {
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--surface)' }}>
      <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-3)', marginBottom: 4, marginTop: 0 }}>{label}</p>
      {children || <p style={{ fontSize: 14, color: 'var(--text)', margin: 0 }}>{value || <span style={{ color: 'var(--border)' }}>—</span>}</p>}
    </div>
  );
}

export default function TaskDrawer({ task, onClose }) {
  useEffect(() => {
    if (!task) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [task, onClose]);

  if (!task) return null;

  const formattedDue = task.dueDate
    ? new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  const isUrl = (str) => {
    try { new URL(str); return true; } catch { return false; }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 40 }}
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div style={{
        position: 'fixed', right: 0, top: 0, height: '100%', width: 420, maxWidth: '100%',
        background: 'var(--card)', boxShadow: '0 25px 50px rgba(0,0,0,0.15)', zIndex: 50,
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: 20, borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{task.id}</span>
              {task.workType && (
                <span style={{ fontSize: 12, padding: '2px 8px', background: 'var(--surface)', color: 'var(--text-2)', borderRadius: 4 }}>{task.workType}</span>
              )}
            </div>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4, margin: 0 }}>{task.name || 'Untitled task'}</h2>
          </div>
          <button
            onClick={onClose}
            style={{
              flexShrink: 0, padding: 6, color: 'var(--text-3)', background: 'none',
              border: 'none', cursor: 'pointer', borderRadius: 6,
            }}
          >
            <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Badge row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
          {task.status && (
            <span style={{ fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 999, ...(STATUS_STYLES[task.status] || { background: 'var(--surface)', color: 'var(--text-2)' }) }}>
              {task.status}
            </span>
          )}
          {task.priority && (
            <span style={{ fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 999, ...(PRIORITY_STYLES[task.priority] || { background: 'var(--surface)', color: 'var(--text-2)' }) }}>
              {task.priority}
            </span>
          )}
          {task.isOverdue && (
            <span style={{ fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 999, background: 'var(--danger-soft)', color: 'var(--danger)', border: '1px solid var(--danger)' }}>
              {task.daysOverdue}d overdue
            </span>
          )}
        </div>

        {/* Fields */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
          <Field label="Client" value={task.client} />
          <Field label="Assigned To" value={task.assignedTo} />
          <Field label="Due Date">
            {formattedDue
              ? <p style={{ fontSize: 14, color: task.isOverdue ? 'var(--danger)' : 'var(--text)', fontWeight: task.isOverdue ? 600 : 400, margin: 0 }}>{formattedDue}</p>
              : <p style={{ fontSize: 14, color: 'var(--border)', margin: 0 }}>—</p>}
          </Field>
          <Field label="Effort (hrs)" value={task.effortHours != null ? String(task.effortHours) : null} />
          <Field label="Week" value={task.week} />
          <Field label="Notes" value={task.notes} />
          <Field label="Documentation">
            {task.docs && isUrl(task.docs)
              ? <a href={task.docs} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, color: 'var(--primary)', wordBreak: 'break-all' }}>{task.docs}</a>
              : task.docs
                ? <p style={{ fontSize: 14, color: 'var(--text)', wordBreak: 'break-all', margin: 0 }}>{task.docs}</p>
                : <p style={{ fontSize: 14, color: 'var(--border)', margin: 0 }}>—</p>
            }
          </Field>
        </div>

        <div style={{ padding: 16, borderTop: '1px solid var(--border)', textAlign: 'center' }}>
          <p style={{ fontSize: 12, color: 'var(--border)', margin: 0 }}>Read-only · Source: Google Sheets</p>
        </div>
      </div>
    </>
  );
}
