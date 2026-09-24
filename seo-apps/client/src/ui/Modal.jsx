import { useEffect, useRef } from 'react';

/**
 * Modal / Dialog
 * @param {boolean} open
 * @param {function} onClose
 * @param {string} title
 * @param {'sm'|'md'|'lg'} size
 * @param {React.ReactNode} footer
 * @param {React.ReactNode} children
 */
export function Modal({ open, onClose, title, size = 'md', footer, children }) {
  const panelRef = useRef(null);

  const widths = { sm: 420, md: 560, lg: 720 };

  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={(e) => { if (!panelRef.current?.contains(e.target)) onClose?.(); }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,37,64,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 24,
        animation: 'modalBackdropIn 240ms var(--ease)',
      }}
    >
      <style>{`
        @keyframes modalBackdropIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes modalPanelIn { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
      `}</style>
      <div
        ref={panelRef}
        style={{
          background: 'var(--card)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-lg)',
          width: '100%',
          maxWidth: widths[size] || widths.md,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'calc(100vh - 48px)',
          animation: 'modalPanelIn 240ms var(--ease)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '18px 24px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <h2 style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 600,
            color: 'var(--text)',
            letterSpacing: '-0.01em',
          }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 6,
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: 'var(--text-3)',
              outline: 'none',
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
        <div style={{
          padding: 24,
          overflowY: 'auto',
          flex: 1,
        }}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div style={{
            padding: '14px 24px',
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
    </div>
  );
}

export default Modal;
