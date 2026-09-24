import { useEffect, useState } from 'react';
import { subscribeSemrushBalance, refreshSemrushBalance } from '../lib/semrushBalanceStore';

// Styled for the light paper sidebar, matching the search box treatment
// just below it.
export default function SemrushBalanceBadge() {
  const [state, setState] = useState({ balance: null, loading: false, error: null });

  useEffect(() => {
    const unsubscribe = subscribeSemrushBalance(setState);
    refreshSemrushBalance();
    return unsubscribe;
  }, []);

  // Fail silently (e.g. key not configured) — this is a status widget, not
  // core functionality, so it shouldn't clutter the sidebar with an error.
  if (state.error || state.balance === null) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'center',
      gap: 5,
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '6px 10px',
      fontSize: 11,
      fontFamily: 'var(--font-mono)',
      whiteSpace: 'nowrap',
    }}>
      <span style={{ color: 'var(--primary)', fontWeight: 600 }}>Semrush</span>
      <span style={{ fontWeight: 600, color: 'var(--text)' }}>
        {state.balance.toLocaleString()}
      </span>
      <span style={{ color: 'var(--text-3)' }}>units</span>
    </div>
  );
}
