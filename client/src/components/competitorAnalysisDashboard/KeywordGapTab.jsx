import { useState } from 'react';
import { DataTable } from '../../ui/DataTable';
import { MetricCard } from '../../ui/MetricCard';
import { Tabs } from '../../ui/Tabs';
import { fmtNum } from './utils';

const GAP_TABS = [
  { key: 'strikingDistance', label: 'Striking Distance' },
  { key: 'untapped', label: 'Untapped' },
  { key: 'missing', label: 'Missing' },
];

const GAP_COLUMNS = {
  strikingDistance: [
    { key: 'keyword', label: 'Keyword', sortable: false },
    { key: 'searchVolume', label: 'Volume', align: 'right', mono: true, render: fmtNum },
    { key: 'clientPosition', label: 'Client Pos', align: 'right', mono: true },
    { key: 'bestCompetitorPosition', label: 'Best Competitor Pos', align: 'right', mono: true },
    { key: 'bestCompetitorDomain', label: 'Competitor', mono: true },
  ],
  untapped: [
    { key: 'keyword', label: 'Keyword', sortable: false },
    { key: 'searchVolume', label: 'Volume', align: 'right', mono: true, render: fmtNum },
    { key: 'clientPosition', label: 'Client Pos', align: 'right', mono: true },
    { key: 'bestCompetitorPosition', label: 'Best Competitor Pos', align: 'right', mono: true },
    { key: 'bestCompetitorDomain', label: 'Competitor', mono: true },
  ],
  missing: [
    { key: 'keyword', label: 'Keyword', sortable: false },
    { key: 'searchVolume', label: 'Volume', align: 'right', mono: true, render: fmtNum },
    { key: 'bestCompetitorPosition', label: 'Best Competitor Pos', align: 'right', mono: true },
    { key: 'bestCompetitorDomain', label: 'Competitor', mono: true },
  ],
};

export default function KeywordGapTab({ snapshot }) {
  const [gapTab, setGapTab] = useState('strikingDistance');
  const gap = snapshot?.keywordGap || { strikingDistance: [], untapped: [], missing: [] };
  const detail = snapshot?.keywordDetailTable || [];
  const domains = (snapshot?.domains || []).map((d) => d.domain);

  const detailColumns = [
    { key: 'keyword', label: 'Keyword', sortable: false },
    { key: 'searchVolume', label: 'Volume', align: 'right', mono: true, render: fmtNum },
    ...domains.map((domain) => ({
      key: domain,
      label: domain,
      align: 'right',
      mono: true,
      sortable: false,
      render: (_, row) => row.positions[domain] ?? '—',
    })),
  ];
  const detailRows = detail.map((row, i) => ({ id: i, keyword: row.keyword, searchVolume: row.searchVolume, positions: row.positions }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <MetricCard label="Striking Distance" value={gap.strikingDistance.length} sub="Ranked 11–50, competitor ranks top 10" />
        <MetricCard label="Untapped" value={gap.untapped.length} sub="Client ranks 51+, competitor ranks top 10" />
        <MetricCard label="Missing" value={gap.missing.length} sub="Client doesn't rank, competitor ranks top 10" />
      </div>

      <div>
        <Tabs variant="segmented" tabs={GAP_TABS} active={gapTab} onChange={setGapTab} />
        <div style={{ marginTop: 12 }}>
          <DataTable columns={GAP_COLUMNS[gapTab]} rows={gap[gapTab].map((r, i) => ({ id: i, ...r }))} emptyText="No keywords in this bucket." />
        </div>
      </div>

      <DataTable title="Keyword Detail — all domains" columns={detailColumns} rows={detailRows} emptyText="No data yet." />
    </div>
  );
}
