import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { lpb } from '../lib/lpbApi';

// The module's front door. It used to BE the Gentle Dental page list, which
// worked while dental was the only client in here; with Clear Behavioral
// Health added, landing on one client's pages hid the other entirely. Gentle
// Dental now lives at /location-page-builder/gentle-dental and this chooses
// between them.
//
// Client ids match server/locationPageBuilder/seed.js and verticals.js.
const CLIENTS = [
  {
    id: 'client_gentle_dental',
    name: 'Gentle Dental',
    vertical: 'Dental',
    blurb: 'Location × Service pages written to the dental outline. One page per combination, always saved.',
    path: '/location-page-builder/gentle-dental',
    count: () => lpb.wizardPages('client_gentle_dental'),
  },
  {
    id: 'client_clear_behavioral_health',
    name: 'Clear Behavioral Health',
    vertical: 'Behavioral health',
    blurb: 'Keyword research, an editable brief, then nine sections written to the client’s own section guidelines.',
    path: '/location-page-builder/clear-behavioral',
    count: () => lpb.cbhPages('client_clear_behavioral_health'),
  },
];

export default function LocationPageBuilderHubPage() {
  const navigate = useNavigate();
  // Counts are a nicety, not the point of the page: a client whose count call
  // fails still gets a card that opens. Hence null rather than an error state.
  const [counts, setCounts] = useState({});

  useEffect(() => {
    let live = true;
    CLIENTS.forEach((c) => {
      c.count()
        .then(rows => { if (live) setCounts(p => ({ ...p, [c.id]: Array.isArray(rows) ? rows.length : null })); })
        .catch(() => { if (live) setCounts(p => ({ ...p, [c.id]: null })); });
    });
    return () => { live = false; };
  }, []);

  const btnStyle = {
    padding: '0.5rem 0.75rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)',
    background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md,6px)', cursor: 'pointer',
  };

  return (
    <main style={{ maxWidth: '72rem', margin: '0 auto', padding: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--text)' }}>Location + Service Pages</h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-2)', marginTop: '0.25rem' }}>
            Pick a client. Each one writes to its own page structure and its own quality gates.
          </p>
        </div>
        <button style={btnStyle} onClick={() => navigate('/')}>← All Tools</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(19rem, 1fr))', gap: '1rem' }}>
        {CLIENTS.map((c) => {
          const n = counts[c.id];
          return (
            <button
              key={c.id}
              onClick={() => navigate(c.path)}
              style={{
                textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.5rem',
                padding: '1.25rem', background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-lg)', cursor: 'pointer', font: 'inherit', color: 'inherit',
                transition: 'border-color 0.15s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>{c.name}</span>
                <span style={{
                  fontSize: '0.6875rem', fontWeight: 600, padding: '0.125rem 0.5rem', whiteSpace: 'nowrap',
                  color: 'var(--text-2)', background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: '999px',
                }}>{c.vertical}</span>
              </div>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>{c.blurb}</p>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 'auto', paddingTop: '0.5rem' }}>
                {n === undefined ? 'Loading…' : n === null ? '' : `${n} saved ${n === 1 ? 'page' : 'pages'}`}
              </span>
            </button>
          );
        })}
      </div>
    </main>
  );
}
