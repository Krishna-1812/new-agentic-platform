/**
 * EmptyState — calm, instructive placeholder
 * @param {React.ReactNode} icon — 20-24px line icon
 * @param {string} title
 * @param {string} description
 * @param {React.ReactNode} action — optional primary Button
 */
export function EmptyState({ icon, title, description, action }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '64px 24px',
      textAlign: 'center',
    }}>
      {icon && (
        <div style={{
          width: 48,
          height: 48,
          borderRadius: 'var(--r-lg)',
          background: 'var(--surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-3)',
          marginBottom: 16,
        }}>
          {icon}
        </div>
      )}
      <h3 style={{
        margin: '0 0 6px',
        fontSize: 15,
        fontWeight: 600,
        color: 'var(--text)',
      }}>
        {title}
      </h3>
      {description && (
        <p style={{
          margin: '0 0 20px',
          fontSize: 13,
          color: 'var(--text-3)',
          maxWidth: 360,
          lineHeight: 1.55,
        }}>
          {description}
        </p>
      )}
      {action}
    </div>
  );
}

export default EmptyState;
