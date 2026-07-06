import { Card } from '../../ui/Card';
import { ScoreRing } from '../../ui/ScoreRing';
import { Badge } from '../../ui/Badge';
import { EmptyState } from '../../ui/EmptyState';
import { domainLabel } from './utils';

function StrategyRow({ label, data }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <ScoreRing score={data.score} size={64} label={label} />
      <div style={{ display: 'flex', gap: 10, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
        <span>LCP {data.lcp}</span>
        <span>CLS {data.cls}</span>
        <span>INP {data.inp}</span>
      </div>
    </div>
  );
}

export default function PageSpeedTab({ snapshot }) {
  const domains = snapshot?.domains || [];

  if (!domains.length) {
    return <EmptyState title="No data yet" description="Run an analysis to see Page Speed scores." />;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
      {domains.map((d) => (
        <Card
          key={d.domain}
          title={domainLabel(d)}
          actions={d.isClient ? <Badge variant="brand">Client</Badge> : null}
        >
          {d.pageSpeed ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-around' }}>
                <StrategyRow label="Mobile" data={d.pageSpeed.mobile} />
                <StrategyRow label="Desktop" data={d.pageSpeed.desktop} />
              </div>
              <div style={{ marginTop: 14, textAlign: 'center' }}>
                <Badge variant={d.pageSpeed.coreWebVitalsPassed ? 'success' : 'danger'}>
                  {d.pageSpeed.coreWebVitalsPassed ? 'CWV Passed' : 'CWV Failed'}
                </Badge>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 12, color: 'var(--text-3)' }}>
              Not available — Page Speed isn't sourced from SEMrush and isn't wired up yet.
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
