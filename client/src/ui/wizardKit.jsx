// ── Shared wizard primitives ────────────────────────────────────────────────
// Lifted out of LocationServiceWizardPage so a second wizard doesn't fork its
// styling. Deliberately a COPY rather than a refactor of that page: the Gentle
// Dental wizard is in daily use, and pointing it at a new module to save sixty
// lines of style objects would risk a live flow for no user-visible gain.
// Whoever next touches the dental wizard can switch it over.

export const btnStyle = (primary) => ({
  padding: '0.5rem 0.9rem', fontSize: '0.8125rem', fontWeight: 600, borderRadius: 'var(--r-md,6px)',
  border: primary ? 'none' : '1px solid var(--border)', cursor: 'pointer',
  background: primary ? 'var(--primary)' : 'var(--card)', color: primary ? '#fff' : 'var(--text-2)',
});

export const inputStyle = {
  width: '100%', padding: '0.5rem 0.625rem', borderRadius: 'var(--r-md,6px)', border: '1px solid var(--border)',
  fontSize: '0.8125rem', color: 'var(--text)', background: 'var(--surface)', boxSizing: 'border-box',
};

export const labelStyle = {
  display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-2)', marginBottom: '0.25rem',
};

// Custom clickable list rather than a native <select size>. Native listboxes
// here were unreliable: intermittent missed clicks, and the selected row fades
// to near-invisible once focus moves to the other list.
export function PickerList({ groups, selectedId, onSelect, emptyMessage, height = '22rem' }) {
  const empty = !groups.some(([, items]) => items.length);
  if (empty) {
    return (
      <div style={{
        height, display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid var(--border)', borderRadius: 'var(--r-md,6px)',
        background: 'var(--surface)', color: 'var(--text-3)', fontSize: '0.8125rem',
      }}>{emptyMessage}</div>
    );
  }
  return (
    <div style={{ height, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-md,6px)', background: 'var(--surface)' }}>
      {groups.filter(([, items]) => items.length).map(([label, items]) => (
        <div key={label}>
          <div style={{
            position: 'sticky', top: 0, zIndex: 1,
            display: 'flex', justifyContent: 'space-between', gap: '0.5rem',
            padding: '0.25rem 0.625rem', fontSize: '0.6875rem', fontWeight: 700,
            color: 'var(--text-3)', background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
            textTransform: 'uppercase', letterSpacing: '0.03em',
          }}>
            <span>{label}</span>
            <span style={{ fontWeight: 400 }}>{items.length}</span>
          </div>
          {items.map(item => {
            const active = item.id === selectedId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '0.375rem 0.625rem',
                  fontSize: '0.8125rem', border: 'none', cursor: 'pointer',
                  background: active ? 'var(--primary-soft)' : 'transparent',
                  color: active ? 'var(--primary)' : 'var(--text)',
                  fontWeight: active ? 600 : 400,
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--card)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                {active ? '✓ ' : ''}{item.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Regenerate one field. Deliberately small and unlabelled-by-default: it sits
// beside a field, not above a section, and a row of wide buttons would drown
// the content they belong to.
export function RegenButton({ onClick, busy, title = 'Regenerate this field' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={title}
      style={{
        border: '1px solid var(--border)', background: 'var(--card)',
        color: busy ? 'var(--text-3)' : 'var(--primary)',
        borderRadius: 'var(--r-md,6px)', cursor: busy ? 'default' : 'pointer',
        padding: '0.125rem 0.4rem', fontSize: '0.75rem', lineHeight: 1.4,
        whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >{busy ? '…' : '↻'}</button>
  );
}

export function SectionCard({ title, note, children, actions }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '1.25rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>{title}</h3>
          {note && <p style={{ fontSize: '0.75rem', color: 'var(--text-3)', margin: '0.125rem 0 0' }}>{note}</p>}
        </div>
        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>{actions}</div>
      </div>
      {children}
    </div>
  );
}

// Live character counter against a two-sided range. Two-sided on purpose: a
// title that is too SHORT wastes the slot just as a long one gets truncated,
// and the SEO team reviews both ends.
export function CharCount({ value, min, max }) {
  const n = (value || '').length;
  const ok = n >= min && n <= max;
  return (
    <span style={{
      fontSize: '0.6875rem', fontWeight: 600,
      color: n === 0 ? 'var(--text-3)' : ok ? 'var(--success,#16A34A)' : 'var(--warning,#B45309)',
    }}>
      {n}/{min}-{max}
    </span>
  );
}

// The provenance tag on an outline heading: where it came from before anyone
// edited it. A heading the reviewer typed has no source and shows nothing,
// rather than borrowing a neighbour's tag.
const SOURCE_LABELS = {
  competitor: { label: 'from competitors', bg: 'var(--info-soft,#EFF6FF)', fg: 'var(--info,#2563EB)' },
  blend: { label: 'blended', bg: 'var(--primary-soft)', fg: 'var(--primary)' },
  fallback: { label: 'standard', bg: 'var(--surface)', fg: 'var(--text-3)' },
  brand: { label: 'closing block', bg: 'var(--success-soft,#F0FDF4)', fg: 'var(--success,#16A34A)' },
};

// `labels` lets a caller override the vocabulary. The same `fallback` key means
// different things in different contracts -- a curated-ladder heading in the
// dental flow, a section written from a cited clinical authority in CBH -- and
// showing the wrong word next to a source URL misreads the page.
export function SourceTag({ source, labels }) {
  const s = (labels && labels[source]) || SOURCE_LABELS[source];
  if (!s) return null;
  return (
    <span style={{
      fontSize: '0.625rem', fontWeight: 700, padding: '1px 6px', borderRadius: '9999px',
      background: s.bg, color: s.fg, textTransform: 'uppercase', letterSpacing: '0.03em',
      whiteSpace: 'nowrap',
    }}>{s.label}</span>
  );
}
