/* Badge / StatusPill — centralizes ALL status colors */

export const STATUS = {
  success: { bg: 'var(--success-soft)', fg: 'var(--success)' },
  warning: { bg: 'var(--warning-soft)', fg: 'var(--warning)' },
  danger:  { bg: 'var(--danger-soft)',  fg: 'var(--danger)'  },
  info:    { bg: 'var(--info-soft)',    fg: 'var(--info)'    },
  neutral: { bg: 'var(--surface)',      fg: 'var(--text-2)'  },
  brand:   { bg: 'var(--primary-soft)', fg: 'var(--primary-text)' },
};

/* Map domain strings → STATUS keys */
export function resolveStatus(value) {
  const v = (value || '').toLowerCase();
  if (['pass', 'success', 'ready', 'strong', 'high', 'good', 'done', 'active', 'present'].includes(v)) return 'success';
  if (['warning', 'moderate', 'medium', 'partial', 'needs_work', 'pending'].includes(v)) return 'warning';
  if (['fail', 'error', 'danger', 'not_ready', 'weak', 'low', 'critical', 'missing'].includes(v)) return 'danger';
  if (['info', 'notice', 'note', 'blue'].includes(v)) return 'info';
  if (['brand', 'primary', 'new'].includes(v)) return 'brand';
  return 'neutral';
}

/**
 * Badge — inline pill with status color
 * @param {'success'|'warning'|'danger'|'info'|'neutral'|'brand'} variant
 * @param {string} children
 * @param {boolean} removable — show trailing × button
 * @param {function} onRemove
 */
export function Badge({ variant = 'neutral', children, removable, onRemove, style: extraStyle }) {
  const s = STATUS[variant] || STATUS.neutral;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '0 8px',
      height: 22,
      borderRadius: 'var(--r-pill)',
      fontSize: 11,
      fontWeight: 500,
      lineHeight: 1,
      whiteSpace: 'nowrap',
      background: s.bg,
      color: s.fg,
      ...extraStyle,
    }}>
      {children}
      {removable && (
        <button
          onClick={onRemove}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 12, height: 12, borderRadius: '50%',
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'inherit', opacity: 0.7, padding: 0, outline: 'none',
          }}
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  );
}

/** Convenience wrapper — accepts a raw domain string and resolves it */
export function StatusBadge({ value, label, ...props }) {
  const variant = resolveStatus(value);
  return <Badge variant={variant} {...props}>{label ?? value}</Badge>;
}

export default Badge;
