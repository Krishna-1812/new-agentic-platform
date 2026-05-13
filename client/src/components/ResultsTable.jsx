import { memo } from 'react';

function ResultsTable({ keyword, analysis }) {
  const { sections, wordCountBenchmark, semanticKeywords, contentGaps } = analysis;

  return (
    <div id="results-table">
      {/* ── Title Banner ─────────────────────────────────────────────────── */}
      <div
        className="w-full text-white font-semibold text-center py-2.5 px-5 text-sm tracking-wide rounded-t-xl"
        style={{ backgroundColor: '#111827' }}
      >
        CONTENT ANALYSIS REPORT: {keyword.toUpperCase()} &nbsp;(Based on Competitor Research)
      </div>

      {/* ── Main Table ───────────────────────────────────────────────────── */}
      <div className="overflow-x-auto border border-[#E5E7EB] border-t-0 rounded-b-xl overflow-hidden">
        <table className="w-full border-collapse results-table" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '20%' }} />
            <col style={{ width: '30%' }} />
            <col style={{ width: '50%' }} />
          </colgroup>

          {/* Header */}
          <thead>
            <tr style={{ backgroundColor: '#F9FAFB' }}>
              {['Section', 'Recommendations', 'Content'].map(col => (
                <th
                  key={col}
                  className="text-left font-semibold border-b border-r border-[#E5E7EB] last:border-r-0"
                  style={{ padding: '10px 16px', fontSize: '13px', color: '#6B7280' }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>

          {/* Rows */}
          <tbody>
            {sections.map((section, i) => (
              <tr key={i} className="border-b border-[#F3F4F6]">
                {/* Section */}
                <td
                  className="align-top bg-white border-r border-[#E5E7EB] p-4"
                  style={{ fontSize: '13px' }}
                >
                  <div className="text-xs uppercase tracking-wider text-[#9CA3AF] mb-1">Section {i + 1}</div>
                  <div className="font-semibold text-[#111827]">H2: {section.h2}</div>
                </td>

                {/* Recommendations — bullet points */}
                <td
                  className="align-top bg-white border-r border-[#E5E7EB] p-4"
                  style={{ fontSize: '13px' }}
                >
                  {Array.isArray(section.recommendations) && section.recommendations.length > 0 ? (
                    <ul className="space-y-1.5">
                      {section.recommendations.map((point, j) => (
                        <li key={j} className="flex items-start gap-2 text-[#374151]">
                          <span className="mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#3DAA8E' }} />
                          <span className="leading-snug">{point}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="italic text-[#9CA3AF]">—</span>
                  )}
                </td>

                {/* Content — empty for user to fill */}
                <td
                  className="align-top border-[#E5E7EB] p-4"
                  style={{ backgroundColor: '#F9FAFB' }}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Metadata Cards ───────────────────────────────────────────────── */}
      <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Word Count */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          <h3 className="font-semibold text-sm text-[#111827] mb-3">
            Word Count Benchmark
          </h3>
          <p className="text-3xl font-bold" style={{ color: '#3DAA8E' }}>
            {wordCountBenchmark?.toLocaleString() || '—'}
          </p>
          <p className="text-xs text-[#6B7280] mt-1">words — competitor page average</p>
          <p className="text-xs text-[#9CA3AF] mt-2">
            Aim for at least this many words to stay competitive in this SERP.
          </p>
        </div>

        {/* Semantic Keywords */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          <h3 className="font-semibold text-sm text-[#111827] mb-3">
            Semantic Keywords <span className="text-[#9CA3AF] font-normal">({semanticKeywords?.length || 0})</span>
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {(semanticKeywords || []).map((kw, i) => (
              <span
                key={i}
                className="inline-block text-xs px-2 py-0.5 rounded font-medium"
                style={{ backgroundColor: '#3DAA8E1A', color: '#3DAA8E' }}
              >
                {kw}
              </span>
            ))}
            {(!semanticKeywords || semanticKeywords.length === 0) && (
              <span className="text-[#9CA3AF] text-sm italic">None identified</span>
            )}
          </div>
        </div>

        {/* Content Gaps */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          <h3 className="font-semibold text-sm text-[#111827] mb-3">
            Content Gaps <span className="text-[#9CA3AF] font-normal">({contentGaps?.length || 0})</span>
          </h3>
          <ul className="space-y-1.5">
            {(contentGaps || []).map((gap, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-0.5 flex-shrink-0" style={{ color: '#D97706' }}>▸</span>
                <span className="text-sm text-[#374151]">{gap}</span>
              </li>
            ))}
            {(!contentGaps || contentGaps.length === 0) && (
              <li className="text-[#9CA3AF] text-sm italic">None identified</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default memo(ResultsTable);
