const SECTION_LABELS = {
  overallMetrics:    'Overall Performance Metrics',
  pageSpeed:         'Page Speed Analysis',
  keywordRanking:    'Keyword Ranking Comparison',
  keywordGap:        'Keyword Gap Analysis',
  backlinks:         'Backlink & Authority Analysis',
  aiOverview:        'AI Overview Visibility',
  contentAnalysis:   'Content Analysis (Top Pages)',
  executiveSummary:  'Generating Executive Summary',
  pptx:              'Building PPTX',
};

function StatusIcon({ status }) {
  if (status === 'done') {
    return (
      <svg style={{ width: 20, height: 20, color: 'var(--success)', flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    );
  }
  if (status === 'active') {
    return (
      <div style={{ width: 20, height: 20, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: 16, height: 16,
          border: '2px solid var(--border)',
          borderTopColor: 'var(--primary)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>
    );
  }
  return (
    <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border)', flexShrink: 0 }} />
  );
}

export default function ProgressTracker({ sectionStatuses, overallProgress }) {
  const sections = Object.keys(SECTION_LABELS);

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Progress bar */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-2)', marginBottom: 6 }}>
            <span>Analysis in progress…</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{overallProgress || 0}%</span>
          </div>
          <div style={{ height: 8, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{
              height: 8, borderRadius: 999,
              width: `${overallProgress || 0}%`,
              background: 'var(--primary)',
              transition: 'width 0.5s ease',
            }} />
          </div>
        </div>

        {/* Section list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sections.map(section => {
            const status = sectionStatuses[section] || 'pending';
            const label = SECTION_LABELS[section];
            return (
              <div key={section} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 12px', borderRadius: 'var(--r-lg)',
                background: 'var(--surface)',
              }}>
                <StatusIcon status={status} />
                <span style={{
                  fontSize: 14,
                  color: status === 'done' ? 'var(--text)' : status === 'active' ? 'var(--primary)' : 'var(--text-3)',
                  fontWeight: status === 'active' ? 500 : 400,
                }}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', margin: 0 }}>
          This may take 1–3 minutes depending on the number of competitors.
        </p>
      </div>
    </>
  );
}
