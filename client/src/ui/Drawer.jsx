import { useEffect, useRef } from 'react';

/**
 * Drawer — right-side slide-in panel
 * @param {boolean} open
 * @param {function} onClose
 * @param {string} title
 * @param {number} width — default 480
 * @param {React.ReactNode} footer
 * @param {React.ReactNode} children
 */
export function Drawer({ open, onClose, title, width = 480, footer, children }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  return (
    <>
      <style>{`
        @keyframes drawerIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes drawerOut { from { transform: translateX(0); } to { transform: translateX(100%); } }
        @keyframes backdropIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      {open && (
        <div
          onClick={(e) => { if (!panelRef.current?.contains(e.target)) onClose?.(); }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(10,37,64,0.45)',
            zIndex: 900,
            animation: 'backdropIn 240ms var(--ease)',
          }}
        />
      )}

      <div
        ref={panelRef}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width,
          background: 'var(--card)',
          borderLeft: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 901,
          display: 'flex',
          flexDirection: 'column',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 240ms var(--ease)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <h3 style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--text)',
          }}>
            {title}
          </h3>
          <button
            onClick={onClose}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: 6,
              border: 'none', background: 'none', cursor: 'pointer',
              color: 'var(--text-3)', outline: 'none',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div style={{
            padding: '14px 20px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
            flexShrink: 0,
          }}>
            {footer}
          </div>
        )}
      </div>
    </>
  );
}

export default Drawer;
