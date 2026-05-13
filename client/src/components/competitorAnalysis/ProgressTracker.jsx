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
      <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    );
  }
  if (status === 'active') {
    return (
      <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
        <div className="w-4 h-4 border-2 border-[#245E9E] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  return (
    <div className="w-5 h-5 rounded-full border-2 border-[#E5E7EB] flex-shrink-0" />
  );
}

export default function ProgressTracker({ sectionStatuses, overallProgress }) {
  const sections = Object.keys(SECTION_LABELS);

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-[#6B7280] mb-1.5">
          <span>Analysis in progress…</span>
          <span>{overallProgress || 0}%</span>
        </div>
        <div className="h-2 bg-[#E5E7EB] rounded-full overflow-hidden">
          <div
            className="h-2 rounded-full transition-all duration-500"
            style={{ width: `${overallProgress || 0}%`, backgroundColor: '#245E9E' }}
          />
        </div>
      </div>

      {/* Section list */}
      <div className="space-y-2">
        {sections.map(section => {
          const status = sectionStatuses[section] || 'pending';
          const label = SECTION_LABELS[section];
          return (
            <div key={section} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-[#F9FAFB]">
              <StatusIcon status={status} />
              <span className={`text-sm ${
                status === 'done' ? 'text-[#374151]' :
                status === 'active' ? 'text-[#245E9E] font-medium' :
                'text-[#9CA3AF]'
              }`}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-[#9CA3AF] text-center">
        This may take 1–3 minutes depending on the number of competitors.
      </p>
    </div>
  );
}
