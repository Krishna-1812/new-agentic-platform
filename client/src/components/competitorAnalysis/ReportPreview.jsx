import { useState } from 'react';

function fmt(n, fallback = 'N/A') {
  if (n === null || n === undefined || n === '') return fallback;
  if (typeof n === 'number') return n.toLocaleString();
  return String(n);
}

function scoreColor(score) {
  if (score === null || score === undefined) return 'var(--text-3)';
  if (score >= 90) return 'var(--success)';
  if (score >= 50) return 'var(--warning)';
  return 'var(--danger)';
}

function Table({ headers, rows, clientDomain }) {
  if (!rows?.length) return <p style={{ fontSize: 14, color: 'var(--text-3)', fontStyle: 'italic' }}>No data available.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {headers.map(h => (
              <th key={h} style={{
                textAlign: 'left', padding: '8px 12px',
                fontSize: 12, fontWeight: 600, color: '#fff',
                background: 'var(--primary)', whiteSpace: 'nowrap',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isClient = clientDomain && String(row[0]).includes(clientDomain);
            return (
              <tr key={i} style={{
                background: isClient ? 'var(--primary)' : i % 2 === 0 ? 'var(--surface)' : 'var(--card)',
                color: isClient ? '#fff' : 'inherit',
                fontWeight: isClient ? 600 : 400,
              }}>
                {row.map((cell, j) => (
                  <td key={j} style={{
                    padding: '8px 12px', whiteSpace: 'nowrap', fontSize: 12,
                    fontFamily: typeof cell === 'number' ? 'var(--font-mono)' : 'inherit',
                  }}>{cell ?? 'N/A'}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ObsRecsEditor({ sectionKey, value, onChange, onRegenerate, regenerating }) {
  const lines = (value || '').split('\n').filter(l => l.trim());
  const observations = lines.filter(l => l.startsWith('•'));
  const recommendations = lines.filter(l => l.startsWith('→'));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', marginBottom: 8, marginTop: 0 }}>Observations</p>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {observations.length ? observations.map((o, i) => (
            <li key={i} style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{o}</li>
          )) : <li style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>No observations.</li>}
        </ul>
      </div>
      <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--r-lg)', padding: 16 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)', marginBottom: 8, marginTop: 0 }}>Recommendations</p>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {recommendations.length ? recommendations.map((r, i) => (
            <li key={i} style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{r}</li>
          )) : <li style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>No recommendations.</li>}
        </ul>
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', margin: 0 }}>Edit draft</p>
          <button
            onClick={() => onRegenerate(sectionKey)}
            disabled={regenerating}
            style={{
              fontSize: 12, color: 'var(--primary)', background: 'none', border: 'none',
              cursor: 'pointer', textDecoration: 'underline', opacity: regenerating ? 0.5 : 1,
            }}
          >
            {regenerating ? 'Regenerating…' : 'Regenerate'}
          </button>
        </div>
        <textarea
          value={value || ''}
          onChange={e => onChange(sectionKey, e.target.value)}
          rows={6}
          style={{
            width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
            padding: '8px 12px', fontSize: 12, color: 'var(--text)', background: 'var(--card)',
            outline: 'none', fontFamily: 'var(--font-mono)', resize: 'vertical', boxSizing: 'border-box',
          }}
        />
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
          {(value || '').length} chars · Use • for observations, → for recommendations
        </p>
      </div>
    </div>
  );
}

function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', background: 'var(--surface)', border: 'none', cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{title}</span>
        <svg style={{ width: 16, height: 16, color: 'var(--text-2)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div style={{ padding: 20, background: 'var(--card)', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {children}
        </div>
      )}
    </div>
  );
}

export default function ReportPreview({ reportData, jobId, brandName }) {
  const { sections = {}, gptDrafts: initialDrafts = {}, executiveSummary = '' } = reportData;
  const [drafts, setDrafts] = useState(initialDrafts);
  const [regenerating, setRegenerating] = useState({});
  const [downloading, setDownloading] = useState(false);

  const clientDomain = reportData.clientDomain || '';
  const allDomains = [clientDomain, ...(reportData.competitors || []).map(c => c.domain)].filter(Boolean);

  function updateDraft(key, val) {
    setDrafts(d => ({ ...d, [key]: val }));
  }

  async function regenerate(sectionKey) {
    setRegenerating(r => ({ ...r, [sectionKey]: true }));
    try {
      const res = await fetch(`/api/competitor-analysis/regenerate-obs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, section: sectionKey }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.obsRecs) updateDraft(sectionKey, data.obsRecs);
      }
    } catch {}
    setRegenerating(r => ({ ...r, [sectionKey]: false }));
  }

  async function downloadPptx() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/competitor-analysis/export/${jobId}`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${brandName.replace(/\s+/g, '_')}_Competitor_Analysis.pptx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('PPTX download failed: ' + err.message);
    }
    setDownloading(false);
  }

  const overallMetrics = sections.overallMetrics || [];
  const pageSpeed = sections.pageSpeed || [];
  const kwRanking = sections.keywordRanking || [];
  const gapData = sections.keywordGap || {};
  const backlinks = sections.backlinks || [];
  const aioData = sections.aiOverview || [];
  const contentData = sections.contentAnalysis || [];

  const downloadBtnStyle = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 20px', borderRadius: 'var(--r-lg)',
    fontSize: 14, fontWeight: 600, color: '#fff', border: 'none', cursor: 'pointer',
    background: 'var(--primary)', opacity: downloading ? 0.5 : 1, transition: 'opacity 0.15s',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Executive Summary */}
      {executiveSummary && (
        <div style={{ background: 'var(--info-soft)', border: '1px solid var(--info)', borderRadius: 'var(--r-lg)', padding: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--info)', marginBottom: 8, marginTop: 0 }}>Executive Summary</p>
          <p style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.6, margin: 0 }}>{executiveSummary}</p>
        </div>
      )}

      {/* Download */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={downloadPptx} disabled={downloading} style={downloadBtnStyle}>
          <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {downloading ? 'Generating PPTX…' : 'Download PPTX'}
        </button>
      </div>

      {/* Overall Performance */}
      <Section title="Overall Performance Metrics" defaultOpen>
        <Table
          headers={['Domain', 'Auth Score', 'Org. Traffic', 'Keywords', 'Backlinks', 'Ref. Domains', 'AIO Keywords']}
          rows={allDomains.map(d => {
            const m = overallMetrics.find(o => o.domain === d) || {};
            return [d, fmt(m.authorityScore), fmt(m.organicTraffic), fmt(m.organicKeywords), fmt(m.backlinks), fmt(m.referringDomains), fmt(m.aiOverviewKeywords)];
          })}
          clientDomain={clientDomain}
        />
        <ObsRecsEditor sectionKey="overallMetrics" value={drafts.overallMetrics} onChange={updateDraft} onRegenerate={regenerate} regenerating={regenerating.overallMetrics} />
      </Section>

      {/* Page Speed */}
      <Section title="Page Speed Analysis">
        <Table
          headers={['Domain', 'Mobile Score', 'Desktop Score', 'LCP (m)', 'CLS (m)', 'TTFB (m)', 'Core Web Vitals']}
          rows={allDomains.map(d => {
            const ps = pageSpeed.find(o => o.domain === d) || {};
            const mob = ps.mobile || {};
            const desk = ps.desktop || {};
            return [
              d,
              mob.score !== null && mob.score !== undefined ? `${mob.score}/100` : 'N/A',
              desk.score !== null && desk.score !== undefined ? `${desk.score}/100` : 'N/A',
              mob.lcp || 'N/A', mob.cls || 'N/A', mob.ttfb || 'N/A',
              ps.coreWebVitalsPassed ? '✓ Pass' : '✗ Fail',
            ];
          })}
          clientDomain={clientDomain}
        />
        <ObsRecsEditor sectionKey="pageSpeed" value={drafts.pageSpeed} onChange={updateDraft} onRegenerate={regenerate} regenerating={regenerating.pageSpeed} />
      </Section>

      {/* Keyword Ranking */}
      <Section title="Keyword Ranking Comparison">
        <Table
          headers={['Domain', 'Page 1 (1–10)', 'Page 2 (11–20)', 'Pages 3–5 (21–50)', 'Total Organic', 'Non-Branded %']}
          rows={allDomains.map(d => {
            const kw = kwRanking.find(o => o.domain === d) || {};
            return [d, fmt(kw.page1, '0'), fmt(kw.page2, '0'), fmt(kw.page3to5, '0'), fmt(kw.totalOrganic, '0'), kw.nonBrandedPct !== undefined ? `${kw.nonBrandedPct}%` : 'N/A'];
          })}
          clientDomain={clientDomain}
        />
        <ObsRecsEditor sectionKey="keywordRanking" value={drafts.keywordRanking} onChange={updateDraft} onRegenerate={regenerate} regenerating={regenerating.keywordRanking} />
      </Section>

      {/* Keyword Gap */}
      <Section title="Keyword Gap Analysis">
        {[
          { key: 'strikingDistance', label: 'Striking Distance (Pos 11–50)', headers: ['Keyword', 'Volume', 'Client Pos.', 'Best Competitor', 'Domain'] },
          { key: 'untapped', label: 'Untapped Keywords', headers: ['Keyword', 'Volume', 'Client Pos.', 'Best Competitor', 'Domain'] },
          { key: 'missing', label: 'Missing Keywords', headers: ['Keyword', 'Volume', 'Client Status', 'Best Competitor', 'Domain'] },
        ].map(({ key, label, headers }) => {
          const items = (gapData[key] || []).slice(0, 20);
          return (
            <div key={key}>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8, marginTop: 0 }}>{label} ({items.length})</p>
              <Table
                headers={headers}
                rows={items.map(k => [
                  k.keyword,
                  fmt(k.searchVolume),
                  k.clientPosition ? `#${k.clientPosition}` : 'Not ranking',
                  `#${k.bestCompetitorPosition}`,
                  k.bestCompetitorDomain,
                ])}
                clientDomain={null}
              />
            </div>
          );
        })}
        <ObsRecsEditor sectionKey="keywordGap" value={drafts.keywordGap} onChange={updateDraft} onRegenerate={regenerate} regenerating={regenerating.keywordGap} />
      </Section>

      {/* Backlinks */}
      <Section title="Backlink & Authority Analysis">
        <Table
          headers={['Domain', 'Auth Score', 'Total Backlinks', 'Ref. Domains', 'Follow', 'NoFollow']}
          rows={allDomains.map(d => {
            const bl = backlinks.find(o => o.domain === d) || {};
            return [d, fmt(bl.authorityScore), fmt(bl.totalBacklinks), fmt(bl.referringDomains), fmt(bl.followLinks), fmt(bl.nofollowLinks)];
          })}
          clientDomain={clientDomain}
        />
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8, marginTop: 0 }}>Referring Domain Quality (Authority Buckets)</p>
          <Table
            headers={['Domain', '80+', '60–79', '40–59', '20–39', '0–19']}
            rows={allDomains.map(d => {
              const bl = backlinks.find(o => o.domain === d) || {};
              const b = bl.buckets || {};
              return [d, fmt(b['80+'], '0'), fmt(b['60-79'], '0'), fmt(b['40-59'], '0'), fmt(b['20-39'], '0'), fmt(b['0-19'], '0')];
            })}
            clientDomain={clientDomain}
          />
        </div>
        <ObsRecsEditor sectionKey="backlinks" value={drafts.backlinks} onChange={updateDraft} onRegenerate={regenerate} regenerating={regenerating.backlinks} />
      </Section>

      {/* AI Overview */}
      <Section title="AI Overview Visibility">
        <Table
          headers={['Domain', 'AIO Keywords']}
          rows={allDomains.map(d => {
            const aio = aioData.find(o => o.domain === d) || {};
            return [d, fmt(aio.count, '0')];
          })}
          clientDomain={clientDomain}
        />
        <ObsRecsEditor sectionKey="aiOverview" value={drafts.aiOverview} onChange={updateDraft} onRegenerate={regenerate} regenerating={regenerating.aiOverview} />
      </Section>

      {/* Content Analysis */}
      <Section title="Content Analysis">
        <Table
          headers={['Domain', 'URL', 'Est. Traffic', 'Keywords', 'Page Type']}
          rows={allDomains.flatMap(d => {
            const cd = contentData.find(o => o.domain === d) || {};
            return (cd.topPages || []).slice(0, 3).map(p => [d, p.url, fmt(p.traffic), fmt(p.keywords), p.type || 'Other']);
          })}
          clientDomain={clientDomain}
        />
        <ObsRecsEditor sectionKey="contentAnalysis" value={drafts.contentAnalysis} onChange={updateDraft} onRegenerate={regenerate} regenerating={regenerating.contentAnalysis} />
      </Section>

      {/* Download again at bottom */}
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
        <button onClick={downloadPptx} disabled={downloading} style={{ ...downloadBtnStyle, padding: '12px 24px' }}>
          <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {downloading ? 'Generating…' : 'Download PPTX Report'}
        </button>
      </div>
    </div>
  );
}
