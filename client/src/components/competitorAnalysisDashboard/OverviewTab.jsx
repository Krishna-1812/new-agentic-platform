import { DataTable } from '../../ui/DataTable';
import { Badge } from '../../ui/Badge';
import { fmtNum, domainLabel } from './utils';

export default function OverviewTab({ snapshot }) {
  const domains = snapshot?.domains || [];

  const rows = domains.map((d) => ({
    id: d.domain,
    label: (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {domainLabel(d)}
        {d.isClient && <Badge variant="brand">Client</Badge>}
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

  const bucketRows = domains.map((d) => ({
    id: d.domain,
    label: domainLabel(d),
    page1: d.keywordBuckets.page1,
    page2: d.keywordBuckets.page2,
    page3to5: d.keywordBuckets.page3to5,
    page6to10: d.keywordBuckets.page6to10,
  }));

  const bucketColumns = [
    { key: 'label', label: 'Domain', sortable: false },
    { key: 'page1', label: 'Pos 1–10', align: 'right', mono: true },
    { key: 'page2', label: 'Pos 11–20', align: 'right', mono: true },
    { key: 'page3to5', label: 'Pos 21–50', align: 'right', mono: true },
    { key: 'page6to10', label: 'Pos 51–100', align: 'right', mono: true },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <DataTable title="Domain Comparison" columns={columns} rows={rows} emptyText="No data yet — run an analysis." />
      <DataTable title="Keyword Position Buckets" columns={bucketColumns} rows={bucketRows} emptyText="No data yet." />
    </div>
  );
}
