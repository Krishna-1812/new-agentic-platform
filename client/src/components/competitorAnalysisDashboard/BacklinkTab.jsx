import { DataTable } from '../../ui/DataTable';
import { Badge } from '../../ui/Badge';
import { fmtNum, domainLabel } from './utils';

export default function BacklinkTab({ snapshot }) {
  const domains = snapshot?.domains || [];

  const overviewRows = domains.map((d) => ({
    id: d.domain,
    label: (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {domainLabel(d)}
        {d.isClient && <Badge variant="brand">Client</Badge>}
      </span>
    ),
    authorityScore: d.authorityScore,
    totalBacklinks: d.backlinks.totalBacklinks,
    referringDomains: d.backlinks.referringDomains,
    followLinks: d.backlinks.followLinks,
    nofollowLinks: d.backlinks.nofollowLinks,
  }));

  const overviewColumns = [
    { key: 'label', label: 'Domain', sortable: false },
    { key: 'authorityScore', label: 'Authority Score', align: 'right', mono: true },
    { key: 'totalBacklinks', label: 'Backlinks', align: 'right', mono: true, render: fmtNum },
    { key: 'referringDomains', label: 'Ref. Domains', align: 'right', mono: true, render: fmtNum },
    { key: 'followLinks', label: 'Follow', align: 'right', mono: true, render: fmtNum },
    { key: 'nofollowLinks', label: 'Nofollow', align: 'right', mono: true, render: fmtNum },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <DataTable title="Backlink Comparison" columns={overviewColumns} rows={overviewRows} emptyText="No data yet — run an analysis." />
    </div>
  );
}
