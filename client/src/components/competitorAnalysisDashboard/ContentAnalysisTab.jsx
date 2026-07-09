import { useState } from 'react';
import { Card } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { DataTable } from '../../ui/DataTable';
import { EmptyState } from '../../ui/EmptyState';
import { fmtNum, domainLabel } from './utils';
import { RankedBarChart } from './charts/RankedBarChart';
import { CompositionBar } from './charts/CompositionBar';
import { CollapsibleTable } from './charts/CollapsibleTable';

// Deliberately broad — brands span very different industries (local/
// multi-location services, e-commerce, B2B SaaS, marketplaces, franchises),
// and a type that never occurs for one brand should just not appear rather
// than forcing every brand into the same narrow set. Must mirror
// server/modules/competitorAnalysis/contentAnalysis/taxonomy.js.
const CONTENT_TYPE_LABELS = {
  homepage: 'Homepage',
  person: 'Person',
  locationService: 'Location + Service',
  location: 'Location',
  service: 'Service',
  solution: 'Solutions',
  serviceProvider: 'Service Provider',
  product: 'Product',
  pricing: 'Pricing',
  company: 'Company',
  blog: 'Blog/Article',
  resource: 'Other Resource',
  category: 'Category',
  landing: 'Landing',
  legal: 'Legal',
  other: 'Other',
};
const TYPE_OPTIONS = Object.keys(CONTENT_TYPE_LABELS);

const NAMED_COLORS = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-5)', 'var(--viz-6)'];
const OTHER_COLOR = 'var(--text-3)';

// Only 6 distinct hues are reserved for named colors (the app's data-viz ramp
// tops out around there before adjacent slots blur), so each report picks
// its OWN top 6 types by prevalence across the domains being shown — a
// content-heavy local-service brand's chart emphasizes Location/Service
// distinctly, while a SaaS brand's emphasizes Solutions/Pricing/Product,
// automatically, with no per-industry configuration. Whatever's left over
// (including types that appear for competitors but not the brand) folds into
// a single muted "Other" segment for the CHART only — the data table below
// always shows every type's real, unbucketed count.
function buildTypeSegments(domains, countsKey) {
  const totals = {};
  for (const d of domains) {
    for (const [type, count] of Object.entries(d[countsKey] || {})) {
      totals[type] = (totals[type] || 0) + count;
    }
  }
  const present = Object.entries(totals).filter(([, count]) => count > 0).map(([type]) => type);
  const named = [...present].sort((a, b) => totals[b] - totals[a]).slice(0, NAMED_COLORS.length);
  const namedSet = new Set(named);

  const segments = named.map((type, i) => ({
    key: type,
    label: CONTENT_TYPE_LABELS[type] || type,
    color: NAMED_COLORS[i],
    valueFn: (d) => d[countsKey]?.[type] || 0,
  }));

  const hasOverflow = present.some((t) => !namedSet.has(t));
  if (hasOverflow) {
    segments.push({
      key: '__overflow',
      label: 'Other Types', // distinct from the literal "Other" content type, which may itself be one of the named segments above
      color: OTHER_COLOR,
      valueFn: (d) => Object.entries(d[countsKey] || {})
        .reduce((sum, [type, count]) => (namedSet.has(type) ? sum : sum + count), 0),
    });
  }

  return segments;
}

function actionButtonStyle(disabled) {
  return {
    padding: '6px 12px', borderRadius: 'var(--r-lg)', border: '1px solid var(--border-strong)',
    background: 'var(--card)', color: disabled ? 'var(--text-3)' : 'var(--text)',
    fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

function RunButton({ running, disabled, onRun, label = 'Run Content Analysis' }) {
  return (
    <button onClick={onRun} disabled={running || disabled} style={{ ...actionButtonStyle(running || disabled), padding: '8px 16px' }}>
      {running ? 'Running…' : label}
    </button>
  );
}

function SummaryCard({ title, summary, onRegenerate, regenerating, disabled }) {
  return (
    <Card
      title={title}
      actions={(
        <button onClick={onRegenerate} disabled={regenerating || disabled} style={actionButtonStyle(regenerating || disabled)}>
          {regenerating ? 'Regenerating…' : 'Regenerate'}
        </button>
      )}
    >
      {summary?.text ? (
        <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{summary.text}</div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No summary yet.</div>
      )}
      {summary?.generatedAt && (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)' }}>Generated {new Date(summary.generatedAt).toLocaleString()}</div>
      )}
    </Card>
  );
}

// The editable folder → page-type mapping. GPT proposes a type for every URL
// folder pattern; the user can override any of them here. Edits recompute all
// the charts/counts below with no re-crawl and no GPT call, and persist as
// overrides that win on future re-runs.
function FolderMappingCard({ folderMap = [], onSave, saving, disabled }) {
  const [drafts, setDrafts] = useState({}); // template -> pending type
  const dirtyCount = Object.keys(drafts).length;

  function setType(template, type, current) {
    setDrafts((prev) => {
      const next = { ...prev };
      if (type === current) delete next[template]; // back to original — not a change
      else next[template] = type;
      return next;
    });
  }

  async function save() {
    if (!dirtyCount) return;
    await onSave(drafts);
    setDrafts({});
  }

  const [open, setOpen] = useState(false);
  const [sortKey, setSortKey] = useState('count');
  const [sortDir, setSortDir] = useState('desc');

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'count' ? 'desc' : 'asc'); }
  }

  const COLUMNS = [
    { key: 'template', label: 'Folder Pattern', align: 'left' },
    { key: 'example', label: 'Example', align: 'left' },
    { key: 'count', label: 'Pages', align: 'right' },
    { key: 'type', label: 'Type', align: 'left' },
    { key: 'source', label: 'Source', align: 'left' },
  ];

  // Sort by the chosen column; "type" sorts by the pending (draft) value so a
  // just-changed row moves with its new type.
  const sortedRows = [...folderMap].sort((a, b) => {
    let av; let bv;
    if (sortKey === 'count') { av = a.count; bv = b.count; }
    else if (sortKey === 'type') { av = drafts[a.template] ?? a.type; bv = drafts[b.template] ?? b.type; }
    else { av = a[sortKey] ?? ''; bv = b[sortKey] ?? ''; }
    const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true });
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-fast) var(--ease)' }}>
            <path d="M19 9l-7 7-7-7" />
          </svg>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>Folder Mapping</span>
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400 }}>({folderMap.length} patterns)</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {dirtyCount > 0 && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{dirtyCount} unsaved</span>}
          <button
            onClick={save}
            disabled={!dirtyCount || saving || disabled}
            style={{ ...actionButtonStyle(!dirtyCount || saving || disabled), background: dirtyCount && !saving ? 'var(--primary)' : 'var(--card)', color: dirtyCount && !saving ? '#fff' : 'var(--text-3)', border: dirtyCount && !saving ? 'none' : '1px solid var(--border-strong)' }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {open && (
        <>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '14px 0 12px' }}>
            Each URL folder pattern (<code style={{ fontFamily: 'var(--font-mono)' }}>*</code> = a variable page slug) is auto-classified by AI. Override any type below — changes update every chart and count here instantly, with no re-crawl, and stick on future runs.
          </p>
          <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--surface)', position: 'sticky', top: 0 }}>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      onClick={() => toggleSort(col.key)}
                      style={{ textAlign: col.align, padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-2)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexDirection: col.align === 'right' ? 'row-reverse' : 'row' }}>
                        {col.label}
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: sortKey === col.key ? 1 : 0.25 }}>
                          {sortKey === col.key && sortDir === 'asc' ? <path d="M5 15l7-7 7 7" /> : <path d="M19 9l-7 7-7-7" />}
                        </svg>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
                  const current = drafts[row.template] ?? row.type;
                  const edited = row.template in drafts;
                  return (
                    <tr key={row.template} style={{ borderBottom: '1px solid var(--border)', background: edited ? 'var(--primary-soft)' : 'transparent' }}>
                      <td style={{ padding: '6px 12px', fontFamily: 'var(--font-mono)', color: 'var(--text)', whiteSpace: 'nowrap' }}>{row.template}</td>
                      <td style={{ padding: '6px 12px', color: 'var(--text-3)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.example}>{row.example}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{fmtNum(row.count)}</td>
                      <td style={{ padding: '6px 12px' }}>
                        <select
                          value={current}
                          onChange={(e) => setType(row.template, e.target.value, row.type)}
                          disabled={saving || disabled}
                          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 'var(--r-md)', border: '1px solid var(--border-strong)', background: 'var(--card)', color: 'var(--text)' }}
                        >
                          {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{CONTENT_TYPE_LABELS[t]}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '6px 12px' }}>
                        <Badge variant={row.source === 'user' ? 'brand' : 'neutral'}>{row.source === 'user' ? 'You' : 'AI'}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function TypeCountsTable({ domains, countsKey, presentTypes }) {
  const columns = [
    { key: 'label', label: 'Domain', sortable: false },
    ...presentTypes.map((t) => ({ key: t, label: CONTENT_TYPE_LABELS[t] || t, align: 'right', mono: true, render: fmtNum })),
  ];
  const rows = domains.map((d) => ({
    id: d.domain,
    label: (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {domainLabel(d)}
        {d.isClient && <Badge variant="brand">Client</Badge>}
      </span>
    ),
    ...(d[countsKey] || {}),
  }));
  return <DataTable columns={columns} rows={rows} emptyText="No data." />;
}

function presentTypesFor(domains, countsKey) {
  const set = new Set();
  for (const d of domains) {
    for (const [type, count] of Object.entries(d[countsKey] || {})) {
      if (count > 0) set.add(type);
    }
  }
  return [...set];
}

export default function ContentAnalysisTab({
  contentAnalysis,
  running,
  onRun,
  regeneratingTopPages,
  onRegenerateTopPages,
  regeneratingSitemap,
  onRegenerateSitemap,
  onSaveMapping,
  savingMapping,
}) {
  const anyBusy = running || regeneratingTopPages || regeneratingSitemap || savingMapping;
  const topPages = contentAnalysis?.topPages;
  const sitemap = contentAnalysis?.sitemap;

  if (!contentAnalysis) {
    return (
      <EmptyState
        title="No Content Analysis yet"
        description="Analyzes each domain's top 10 performing pages (content type mix) and declared sitemap structure, each with an AI summary."
        action={<RunButton running={running} disabled={anyBusy} onRun={onRun} />}
      />
    );
  }

  const topPagesDomains = topPages?.domains || [];
  const topPagesTypes = presentTypesFor(topPagesDomains, 'contentTypeCounts');
  const sitemapDomains = sitemap?.domains || [];
  const sitemapTypes = presentTypesFor(sitemapDomains, 'pageTypeCounts');
  const noSitemap = sitemapDomains.filter((d) => d.sitemapStatus !== 'found');
  const cappedSitemaps = sitemapDomains.filter((d) => d.capped);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          Part 1 (top pages) uses SEMrush units; Part 2 (sitemap) does not.
          {contentAnalysis.capturedAt && ` Last run ${new Date(contentAnalysis.capturedAt).toLocaleString()}.`}
        </span>
        <RunButton running={running} disabled={regeneratingTopPages || regeneratingSitemap} onRun={onRun} label="Re-run Content Analysis" />
      </div>

      {/* ── Part 1: Top Pages Content Analysis ── */}
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Top Pages Content Analysis</h3>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>Content type mix of each domain's top 10 performing pages.</p>

        {!topPages?.enabled ? (
          <EmptyState
            title="SEMrush isn't connected"
            description="Top-pages content analysis needs a live SEMrush connection. Set SEMRUSH_API_KEY to enable this part — the sitemap analysis below doesn't need it."
          />
        ) : !topPagesDomains.length ? (
          <EmptyState title="No data yet" description="Run Content Analysis to see this." action={<RunButton running={running} disabled={anyBusy} onRun={onRun} />} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {topPages.skipped?.length > 0 && (
              <Card style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)' }}>
                <div style={{ fontSize: 13, color: 'var(--text)' }}>
                  <strong>Budget cap reached.</strong> {topPages.skipped.length} domain{topPages.skipped.length === 1 ? '' : 's'} skipped: {topPages.skipped.join(', ')}.
                </div>
              </Card>
            )}
            <Card title="Content Type Distribution — Top 10 Pages">
              <CompositionBar domains={topPagesDomains} segments={buildTypeSegments(topPagesDomains, 'contentTypeCounts')} rowEmptyText="No pages found" />
            </Card>
            <SummaryCard
              title="AI Summary"
              summary={topPages.summary}
              onRegenerate={onRegenerateTopPages}
              regenerating={regeneratingTopPages}
              disabled={running || regeneratingSitemap}
            />
            <Card title="Content Type Counts">
              <TypeCountsTable domains={topPagesDomains} countsKey="contentTypeCounts" presentTypes={topPagesTypes} />
            </Card>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {topPagesDomains.map((d) => (
                <Card key={d.domain} title={domainLabel(d)} actions={d.isClient ? <Badge variant="brand">Client</Badge> : null}>
                  <CollapsibleTable label={`View top ${d.pages.length} pages`}>
                    <DataTable
                      columns={[
                        { key: 'url', label: 'URL', sortable: false, maxWidth: 240 },
                        { key: 'title', label: 'Title', sortable: false, maxWidth: 240 },
                        { key: 'contentType', label: 'Type', render: (v) => CONTENT_TYPE_LABELS[v] || v },
                        { key: 'traffic', label: 'Est. Traffic', align: 'right', mono: true, render: fmtNum },
                        { key: 'keywords', label: 'Keywords', align: 'right', mono: true, render: fmtNum },
                      ]}
                      rows={d.pages.map((p, i) => ({ id: i, ...p, title: p.title || '(title unavailable)' }))}
                      emptyText="No pages found."
                    />
                  </CollapsibleTable>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Part 2: Sitemap-Based Site Structure ── */}
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Sitemap-Based Site Structure</h3>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
          Page type breakdown from each domain's declared XML sitemap(s) as found via robots.txt — not a full site crawl, so actual page counts may differ.
        </p>

        {!sitemapDomains.length ? (
          <EmptyState title="No data yet" description="Run Content Analysis to see this." action={<RunButton running={running} disabled={anyBusy} onRun={onRun} />} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card title="Total Pages (Sitemap)">
              <RankedBarChart domains={sitemapDomains} valueFn={(d) => d.totalUrls} />
            </Card>
            <Card title="Page Type Distribution">
              <CompositionBar domains={sitemapDomains} segments={buildTypeSegments(sitemapDomains, 'pageTypeCounts')} rowEmptyText="No sitemap found" />
            </Card>
            <SummaryCard
              title="AI Summary"
              summary={sitemap.summary}
              onRegenerate={onRegenerateSitemap}
              regenerating={regeneratingSitemap}
              disabled={running || regeneratingTopPages}
            />
            <Card title="Page Type Counts">
              <TypeCountsTable domains={sitemapDomains} countsKey="pageTypeCounts" presentTypes={sitemapTypes} />
              {(noSitemap.length > 0 || cappedSitemaps.length > 0) && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {noSitemap.map((d) => (
                    <span key={d.domain} style={{ fontSize: 11, color: 'var(--text-3)' }}>{domainLabel(d)}: no accessible sitemap found.</span>
                  ))}
                  {cappedSitemaps.map((d) => (
                    <span key={`${d.domain}-capped`} style={{ fontSize: 11, color: 'var(--warning)' }}>{domainLabel(d)}: sitemap crawl limit reached — counts are a partial sample.</span>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

      {/* ── Editable folder → type mapping (collapsed by default; drives both parts above) ── */}
      {contentAnalysis.folderMap?.length > 0 && (
        <FolderMappingCard folderMap={contentAnalysis.folderMap} onSave={onSaveMapping} saving={savingMapping} disabled={running} />
      )}
    </div>
  );
}
