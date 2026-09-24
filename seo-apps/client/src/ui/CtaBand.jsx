/**
 * CtaBand — premium navy action band
 * @param {string} title
 * @param {string} subtitle
 * @param {React.ReactNode} action — primary Button
 */
export function CtaBand({ title, subtitle, action, style: extraStyle }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, var(--nav-bg-top) 0%, var(--nav-bg-bot) 100%)',
      borderRadius: 'var(--r-xl)',
      padding: '24px 28px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 24,
      flexWrap: 'wrap',
      ...extraStyle,
    }}>
      <div>
        <div style={{
          fontSize: 18,
          fontWeight: 600,
          color: '#FFFFFF',
          letterSpacing: '-0.01em',
          marginBottom: subtitle ? 4 : 0,
        }}>
          {title}
        </div>
        {subtitle && (
          <div style={{
            fontSize: 13,
            color: 'rgba(199,210,224,0.85)',
            lineHeight: '18px',
          }}>
            {subtitle}
          </div>
        )}
      </div>
      {action && (
        <div style={{ flexShrink: 0 }}>
          {action}
        </div>
      )}
    </div>
  );
}

export default CtaBand;
