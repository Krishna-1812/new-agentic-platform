export default function KBStatusBadge({ health, size = 'sm' }) {
  const pad = size === 'sm'
    ? { padding: '2px 8px', fontSize: 11 }
    : { padding: '4px 10px', fontSize: 11 };

  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    borderRadius: 4, fontWeight: 600, ...pad,
  };

  if (health === 'ERROR')
    return <span style={{ ...base, background: 'var(--danger-soft)', color: 'var(--danger)' }}>● ERROR</span>;
  if (health === 'WARNING')
    return <span style={{ ...base, background: 'var(--warning-soft)', color: 'var(--warning)' }}>● WARNING</span>;
  if (health === 'INFO')
    return <span style={{ ...base, background: 'var(--info-soft)', color: 'var(--info)' }}>● INFO</span>;
  return <span style={{ ...base, background: 'var(--success-soft)', color: 'var(--success)' }}>● OK</span>;
}
