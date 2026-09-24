/**
 * SectionHeader — page / section title row
 * @param {string} eyebrow — small mono uppercase label above title
 * @param {string} title — H1 or H2 text
 * @param {string} subtitle — one-line description
 * @param {React.ReactNode} actions — right-aligned buttons/controls
 * @param {'h1'|'h2'} as — heading level
 */
export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  as: Tag = 'h1',
  style: extraStyle,
}) {
  const sizes = {
    h1: { fontSize: 22, lineHeight: '28px' },
    h2: { fontSize: 18, lineHeight: '24px' },
  };
  const sz = sizes[Tag] || sizes.h1;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
      marginBottom: 24,
      ...extraStyle,
    }}>
      <div>
        {eyebrow && (
          <div style={{
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.10em',
            color: 'var(--primary-text)',
            marginBottom: 6,
          }}>
            {eyebrow}
          </div>
        )}
        <Tag style={{
          margin: 0,
          fontSize: sz.fontSize,
          lineHeight: sz.lineHeight,
          fontWeight: 600,
          color: 'var(--text)',
          letterSpacing: '-0.01em',
        }}>
          {title}
        </Tag>
        {subtitle && (
          <p style={{
            margin: '4px 0 0',
            fontSize: 13,
            color: 'var(--text-2)',
            lineHeight: '18px',
          }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
          paddingTop: eyebrow ? 18 : 0,
        }}>
          {actions}
        </div>
      )}
    </div>
  );
}

export default SectionHeader;
