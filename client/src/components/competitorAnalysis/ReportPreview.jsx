import { useState } from 'react';

function fmt(n, fallback = 'N/A') {
  if (n === null || n === undefined || n === '') return fallback;
  if (typeof n === 'number') return n.toLocaleString();
  return String(n);
}

function scoreColor(score) {
  if (score === null || score === undefined) return '#9CA3AF';
  if (score >= 90) return '#1DA64B';
  if (score >= 50) return '#F0B816';
  return '#D3342E';
}

function Table({ headers, rows, clientDomain }) {
  if (!rows?.length) return <p className="text-sm text-[#9CA3AF] italic">No data available.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            {headers.map(h => (
              <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-white bg-[#245E9E] whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isClient = clientDomain && String(row[0]).includes(clientDomain);
            return (
              <tr key={i} className={isClient ? 'bg-[#D3342E] text-white font-semibold' : i % 2 === 0 ? 'bg-[#F9FAFB]' : 'bg-white'}>
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2 whitespace-nowrap text-xs">{cell ?? 'N/A'}</td>
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
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-4">
        <p className="text-xs font-bold text-[#245E9E] mb-2">Observations</p>
        <ul className="space-y-1.5">
          {observations.length ? observations.map((o, i) => (
            <li key={i} className="text-xs text-[#374151] leading-relaxed">{o}</li>
          )) : <li className="text-xs text-[#9CA3AF] italic">No observations.</li>}
        </ul>
      </div>
      <div className="bg-[#FFF5F5] border border-[#D3342E] rounded-xl p-4">
        <p className="text-xs font-bold text-[#D3342E] mb-2">Recommendations</p>
        <ul className="space-y-1.5">
          {recommendations.length ? recommendations.map((r, i) => (
            <li key={i} className="text-xs text-[#374151] leading-relaxed">{r}</li>
          )) : <li className="text-xs text-[#9CA3AF] italic">No recommendations.</li>}
        </ul>
      </div>

      <div className="md:col-span-2">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-medium text-[#6B7280]">Edit draft</p>
          <button
            onClick={() => onRegenerate(sectionKey)}
            disabled={regenerating}
            className="text-xs text-[#245E9E] hover:underline disabled:opacity-50"
          >
            {regenerating ? 'Regenerating…' : 'Regenerate'}
          </button>
        </div>
        <textarea
          value={value || ''}
          onChange={e => onChange(sectionKey, e.target.value)}
          rows={6}
          className="w-full border border-[#D1D5DB] rounded-lg px-3 py-2 text-xs text-[#374151] focus:outline-none focus:ring-2 focus:ring-[#245E9E] font-mono"
        />
        <p className="text-xs text-[#9CA3AF] mt-1">{(value || '').length} chars · Use • for observations, → for recommendations</p>
      </div>
    </div>
  );
}

function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[#E5E7EB] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-[#F9FAFB] hover:bg-[#F3F4F6] transition-colors"
      >
        <span className="text-sm font-semibold text-[#111827]">{title}</span>
        <svg className={`w-4 h-4 text-[#6B7280] transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="p-5 bg-white space-y-4">{children}</div>}
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

  return (
    <div className="space-y-4">
      {/* Executive Summary */}
      {executiveSummary && (
        <div className="bg-[#F0F7FF] border border-[#BAD5F5] rounded-xl p-5">
          <p className="text-xs font-bold text-[#245E9E] mb-2">Executive Summary</p>
          <p className="text-sm text-[#374151] leading-relaxed">{executiveSummary}</p>
        </div>
      )}

      {/* Download */}
      <div className="flex justify-end">
        <button
          onClick={downloadPptx}
          disabled={downloading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-colors"
          style={{ backgroundColor: '#D3342E' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
              <p className="text-xs font-semibold text-[#374151] mb-2">{label} ({items.length})</p>
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
        <div className="mt-4">
          <p className="text-xs font-semibold text-[#374151] mb-2">Referring Domain Quality (Authority Buckets)</p>
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
      <div className="flex justify-center pt-2">
        <button
          onClick={downloadPptx}
          disabled={downloading}
          className="flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-colors"
          style={{ backgroundColor: '#D3342E' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {downloading ? 'Generating…' : 'Download PPTX Report'}
        </button>
      </div>
    </div>
  );
}
