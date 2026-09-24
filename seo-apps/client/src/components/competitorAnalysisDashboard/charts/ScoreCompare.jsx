import { ScoreRing } from '../../../ui/ScoreRing';
import { Badge } from '../../../ui/Badge';
import { domainLabel } from '../utils';
import { ScoreLollipop } from './ScoreLollipop';

// Authority Score is a bounded 0-100 index, so it gets a gauge, not a bar.
// Gauge small multiples work up to a handful of domains; past that they
// crowd, so this auto-switches to a shared-axis lollipop. Single source of
// truth for both the Overview and Authority tabs.
const LOLLIPOP_THRESHOLD = 5;

export function ScoreCompare({ domains = [] }) {
  if (!domains.length) {
    return <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-3)' }}>No data yet.</div>;
  }

  if (domains.length >= LOLLIPOP_THRESHOLD) {
    return <ScoreLollipop domains={domains} />;
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, justifyContent: domains.length <= 1 ? 'flex-start' : 'space-around' }}>
      {domains.map((d) => (
        <div key={d.domain} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ padding: 4, borderRadius: '50%', boxShadow: d.isClient ? '0 0 0 2px var(--primary)' : 'none' }}>
            <ScoreRing score={d.authorityScore || 0} size={80} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: 150 }}>
            <span style={{
              fontSize: 12, fontWeight: d.isClient ? 700 : 400,
              color: d.isClient ? 'var(--text)' : 'var(--text-2)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {domainLabel(d)}
            </span>
            {d.isClient && <Badge variant="brand" style={{ flexShrink: 0 }}>Client</Badge>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default ScoreCompare;
