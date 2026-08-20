import { Card } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { DataTable } from '../../ui/DataTable';
import { fmtNum, domainLabel, computeClientStat } from './utils';
import { KpiScorecard } from './charts/KpiScorecard';
import { RankedBarChart } from './charts/RankedBarChart';
import { ScoreCompare } from './charts/ScoreCompare';
import { CollapsibleTable } from './charts/CollapsibleTable';

export default function OverviewTab({ snapshot }) {
  const domains = snapshot?.domains || [];

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
  }));

  const columns = [
    { key: 'label', label: 'Domain', sortable: false },
    { key: 'organicKeywords', label: 'Organic Keywords', align: 'right', mono: true, render: fmtNum },
    { key: 'organicTraffic', label: 'Organic Traffic', align: 'right', mono: true, render: fmtNum },
    { key: 'authorityScore', label: 'Authority Score', align: 'right', mono: true },
    { key: 'totalBacklinks', label: 'Backlinks', align: 'right', mono: true, render: fmtNum },
    { key: 'referringDomains', label: 'Ref. Domains', align: 'right', mono: true, render: fmtNum },
    { key: 'aioKeywordCount', label: 'AIO Kw', align: 'right', mono: true, render: fmtNum },
  ];

  if (!domains.length) {
    return <DataTable title="Domain Comparison" columns={columns} rows={rows} emptyText="No data yet — run an analysis." />;
  }

  const trafficStat = computeClientStat(domains, (d) => d.domainRank.organicTraffic);
  const keywordsStat = computeClientStat(domains, (d) => d.domainRank.organicKeywords);
  const authorityStat = computeClientStat(domains, (d) => d.authorityScore);
  const backlinksStat = computeClientStat(domains, (d) => d.backlinks.totalBacklinks);
  const client = domains.find((d) => d.isClient);
  const headline = client
    ? `${domainLabel(client)} is ${trafficStat.rank === keywordsStat.rank
        ? `#${trafficStat.rank} of ${trafficStat.total} on traffic and keywords`
        : `#${trafficStat.rank} of ${trafficStat.total} on traffic, #${keywordsStat.rank} of ${keywordsStat.total} on keywords`
      }, #${authorityStat.rank} on authority, #${backlinksStat.rank} on backlinks.`
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Headline restatement of the scorecards below — no new data, just a plain-English read */}
      {headline && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 16px',
          borderRadius: 'var(--r-md)', border: '1px solid var(--warning)', background: 'var(--warning-soft)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Badge variant="warning">NEW</Badge>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{headline}</span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>One headline read of the four scorecards below — no new data, only a restatement.</span>
        </div>
      )}

      {/* KPI scorecard strip — where do we stand, at a glance */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <KpiScorecard label="Organic Traffic" stat={trafficStat} />
        <KpiScorecard label="Organic Keywords" stat={keywordsStat} />
        <KpiScorecard label="Authority Score" stat={authorityStat} />
        <KpiScorecard label="Backlinks" stat={backlinksStat} />
      </div>

      {/* Magnitude metrics — ranked bars, small multiples */}
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
      </div>

      {/* Referring Domains + Authority Score, paired side by side — Authority
          Score is bounded 0-100 (a gauge/lollipop, not a magnitude bar) and
          sits in the space to the right of Referring Domains rather than
          getting its own full-width row below everything else. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        <Card title="Referring Domains">
          <RankedBarChart domains={domains} valueFn={(d) => d.backlinks.referringDomains} />
        </Card>
        <Card title="Authority Score">
          <ScoreCompare domains={domains} />
        </Card>
      </div>

      <CollapsibleTable>
        <DataTable title="Domain Comparison" columns={columns} rows={rows} emptyText="No data yet — run an analysis." />
      </CollapsibleTable>
    </div>
  );
}
