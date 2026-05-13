import { useEffect } from 'react';

const PRIORITY_COLORS = {
  'P1 - Urgent': 'bg-red-100 text-red-700',
  'P2 - High':   'bg-orange-100 text-orange-700',
  'P3 - Normal': 'bg-blue-100 text-blue-700',
  'P4 - Low':    'bg-gray-100 text-gray-600',
};

const STATUS_COLORS = {
  'Blocked':     'bg-red-100 text-red-700',
  'In Progress': 'bg-blue-100 text-blue-700',
  'In Review':   'bg-purple-100 text-purple-700',
  'Done':        'bg-green-100 text-green-700',
  'Deferred':    'bg-yellow-100 text-yellow-700',
  'Backlog':     'bg-gray-100 text-gray-600',
  'This Week':   'bg-teal-100 text-teal-700',
  'Today':       'bg-indigo-100 text-indigo-700',
};

function Field({ label, value, children }) {
  return (
    <div className="py-3 border-b border-[#F3F4F6] last:border-0">
      <p className="text-xs font-medium text-[#9CA3AF] mb-1">{label}</p>
      {children || <p className="text-sm text-[#111827]">{value || <span className="text-[#D1D5DB]">—</span>}</p>}
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
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="fixed right-0 top-0 h-full w-[420px] max-w-full bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-[#E5E7EB]">
          <div className="flex-1 min-w-0 pr-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-[#9CA3AF]">{task.id}</span>
              {task.workType && (
                <span className="text-xs px-2 py-0.5 bg-[#F4F5F7] text-[#6B7280] rounded">{task.workType}</span>
              )}
            </div>
            <h2 className="text-[15px] font-semibold text-[#111827] leading-snug">{task.name || 'Untitled task'}</h2>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1.5 text-[#9CA3AF] hover:text-[#374151] rounded-md hover:bg-[#F3F4F6] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Badge row */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-[#E5E7EB]">
          {task.status && (
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLORS[task.status] || 'bg-gray-100 text-gray-600'}`}>
              {task.status}
            </span>
          )}
          {task.priority && (
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${PRIORITY_COLORS[task.priority] || 'bg-gray-100 text-gray-600'}`}>
              {task.priority}
            </span>
          )}
          {task.isOverdue && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-red-50 text-red-600 border border-red-200">
              {task.daysOverdue}d overdue
            </span>
          )}
        </div>

        {/* Fields */}
        <div className="flex-1 overflow-y-auto px-5">
          <Field label="Client" value={task.client} />
          <Field label="Assigned To" value={task.assignedTo} />
          <Field label="Due Date">
            {formattedDue
              ? <p className={`text-sm ${task.isOverdue ? 'text-red-600 font-medium' : 'text-[#111827]'}`}>{formattedDue}</p>
              : <p className="text-sm text-[#D1D5DB]">—</p>}
          </Field>
          <Field label="Effort (hrs)" value={task.effortHours != null ? String(task.effortHours) : null} />
          <Field label="Week" value={task.week} />
          <Field label="Notes" value={task.notes} />
          <Field label="Documentation">
            {task.docs && isUrl(task.docs)
              ? <a href={task.docs} target="_blank" rel="noopener noreferrer" className="text-sm text-[#3DAA8E] underline break-all">{task.docs}</a>
              : task.docs
                ? <p className="text-sm text-[#111827] break-all">{task.docs}</p>
                : <p className="text-sm text-[#D1D5DB]">—</p>
            }
          </Field>
        </div>

        <div className="p-4 border-t border-[#E5E7EB] text-center">
          <p className="text-xs text-[#D1D5DB]">Read-only · Source: Google Sheets</p>
        </div>
      </div>
    </>
  );
}
