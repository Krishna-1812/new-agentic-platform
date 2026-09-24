import { useState } from 'react';

// "View data table" toggle — every chart section keeps its raw table one
// click away instead of deleting it, so executives who want to verify a
// number can still get to it.
export function CollapsibleTable({ label = 'View data table', children }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12, fontWeight: 500, color: 'var(--text-2)',
          background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
        }}
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
          strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-fast) var(--ease)' }}
        >
          <path d="M19 9l-7 7-7-7" />
        </svg>
        {open ? 'Hide data table' : label}
      </button>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

export default CollapsibleTable;
