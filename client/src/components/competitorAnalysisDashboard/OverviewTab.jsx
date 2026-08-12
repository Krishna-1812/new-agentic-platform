import { Card } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { DataTable } from '../../ui/DataTable';
import { fmtNum, domainLabel, computeClientStat } from './utils';
import { KpiScorecard } from './charts/KpiScorecard';
import { RankedBarChart } from './charts/RankedBarChart';
import { ScoreCompare } from './charts/ScoreCompare';
import { CompositionBar } from './charts/CompositionBar';
import { CollapsibleTable } from './charts/CollapsibleTable';

export default function OverviewTab({ snapshot }) {
  const domains = snapshot?.domains || [];
  const hasAio = domains.some((d) => (d.aioKeywordCount || 0) > 0);

  const rows = domains.map((d) => ({
    id: d.domain,
    label: (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {domainLabel(d)}
        {d.isClient && <Badge variant="brand">Client</Badge>}
        {d.fetchErrors?.length > 0 && (
          <span title={`Fetch failed for: ${d.fetchErrors.join(', ')} — numbers below are unverified, not confirmed zero`}>
            <Badge variant="warning">Data incomplete</Badge>
          </span>
        )}
      </span>
    ),
    organicKeywords: d.domainRank.organicKeywords,
    organicTraffic: d.domainRank.organicTraffic,
    authorityScore: d.authorityScore,
    totalBacklinks: d.backlinks.totalBacklinks,
    referringDomains: d.backlinks.referringDomains,
    aioKeywordCount: d.aioKeywordCount,
    brandedKeywordCount: d.brandedKeywordCount,
    nonBrandedKeywordCount: d.nonBrandedKeywordCount,
  }));

  const columns = [
    { key: 'label', label: 'Domain', sortable: false },
    { key: 'organicKeywords', label: 'Organic Keywords', align: 'right', mono: true, render: fmtNum },
    { key: 'organicTraffic', label: 'Organic Traffic', align: 'right', mono: true, render: fmtNum },
    { key: 'authorityScore', label: 'Authority Score', align: 'right', mono: true },
    { key: 'totalBacklinks', label: 'Backlinks', align: 'right', mono: true, render: fmtNum },
    { key: 'referringDomains', label: 'Ref. Domains', align: 'right', mono: true, render: fmtNum },
    { key: 'aioKeywordCount', label: 'AIO Kw', align: 'right', mono: true, render: fmtNum },
    { key: 'brandedKeywordCount', label: 'Branded Kw', align: 'right', mono: true, render: fmtNum },
    { key: 'nonBrandedKeywordCount', label: 'Non-Branded Kw', align: 'right', mono: true, render: fmtNum },
  ];

  if (!domains.length) {
    return <DataTable title="Domain Comparison" columns={columns} rows={rows} emptyText="No data yet — run an analysis." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPI scorecard strip — where do we stand, at a glance */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <KpiScorecard label="Organic Traffic" stat={computeClientStat(domains, (d) => d.domainRank.organicTraffic)} />
        <KpiScorecard label="Organic Keywords" stat={computeClientStat(domains, (d) => d.domainRank.organicKeywords)} />
        <KpiScorecard label="Authority Score" stat={computeClientStat(domains, (d) => d.authorityScore)} />
        <KpiScorecard label="Backlinks" stat={computeClientStat(domains, (d) => d.backlinks.totalBacklinks)} />
      </div>

      {/* Magnitude metrics — ranked bars, small multiples 2x2 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        <Card title="Organic Traffic">
          <RankedBarChart domains={domains} valueFn={(d) => d.domainRank.organicTraffic} />
        </Card>
        <Card title="Organic Keywords">
          <RankedBarChart domains={domains} valueFn={(d) => d.domainRank.organicKeywords} />
        </Card>
        <Card title="Backlinks">
          <RankedBarChart domains={domains} valueFn={(d) => d.backlinks.totalBacklinks} />
        </Card>
        <Card title="Referring Domains">
          <RankedBarChart domains={domains} valueFn={(d) => d.backlinks.referringDomains} />
        </Card>
      </div>

      {/* Authority Score — bounded 0-100, gauge/lollipop not a bar */}
      <Card title="Authority Score">
        <ScoreCompare domains={domains} />
      </Card>

      {/* Keyword mix — composition, not magnitude */}
      <Card
        title="Keyword Mix — Branded vs. Non-Branded"
        actions={hasAio ? <Badge variant="info">AI Overview keywords present</Badge> : null}
      >
        <CompositionBar
          domains={domains}
          segments={[
            { key: 'branded', label: 'Branded', color: 'var(--primary)', valueFn: (d) => d.brandedKeywordCount },
            { key: 'nonBranded', label: 'Non-Branded', color: 'var(--text-3)', valueFn: (d) => d.nonBrandedKeywordCount },
          ]}
          rowEmptyText="No keyword data"
        />
      </Card>

      <CollapsibleTable>
        <DataTable title="Domain Comparison" columns={columns} rows={rows} emptyText="No data yet — run an analysis." />
      </CollapsibleTable>
    </div>
  );
}
