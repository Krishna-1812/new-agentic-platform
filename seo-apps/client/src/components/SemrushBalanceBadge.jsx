import { useEffect, useState } from 'react';
import { subscribeSemrushBalance, refreshSemrushBalance } from '../lib/semrushBalanceStore';

// Styled for the navy sidebar (matches the search box treatment just below
// it), not the light card-based `Badge` used in page content.
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
      background: 'rgba(255,255,255,0.08)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 8,
      padding: '6px 10px',
      fontSize: 11,
      fontFamily: 'var(--font-mono)',
      whiteSpace: 'nowrap',
    }}>
      <span style={{ color: '#ff642d', fontWeight: 600 }}>Semrush</span>
      <span style={{ fontWeight: 600, color: 'var(--nav-text-active)' }}>
        {state.balance.toLocaleString()}
      </span>
      <span style={{ color: 'rgba(199,210,224,0.60)' }}>units</span>
    </div>
  );
}
