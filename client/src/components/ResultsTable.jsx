export default function ResultsTable({ keyword, analysis }) {
  const { sections, wordCountBenchmark, semanticKeywords, contentGaps } = analysis;

  return (
    <div id="results-table">
      {/* ── Title Banner ─────────────────────────────────────────────────── */}
      <div
        className="w-full text-white font-bold text-center py-3 px-5 text-sm tracking-wide"
        style={{ backgroundColor: '#1e3a5f' }}
      >
        CONTENT ANALYSIS REPORT: {keyword.toUpperCase()} &nbsp;(Based on Competitor Research)
      </div>

      {/* ── Main Table ───────────────────────────────────────────────────── */}
      <div className="overflow-x-auto border border-[#ddd] border-t-0">
        <table className="w-full border-collapse results-table" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '20%' }} />
            <col style={{ width: '30%' }} />
            <col style={{ width: '50%' }} />
          </colgroup>

          {/* Header */}
          <thead>
            <tr style={{ backgroundColor: '#2e5f8a' }}>
              {['Section', 'Recommendations', 'Content'].map(col => (
                <th
                  key={col}
                  className="text-left text-white font-bold text-sm border-r border-[#1e3a5f] last:border-r-0"
                  style={{ padding: '10px 14px' }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>

          {/* Rows */}
          <tbody>
            {sections.map((section, i) => (
              <tr key={i} className="border-b border-[#ddd]">
                {/* Section */}
                <td
                  className="align-top bg-white border-r border-[#ddd] p-3"
                  style={{ minHeight: '100px', fontWeight: 600, fontSize: '14px' }}
                >
                  <div className="text-xs uppercase tracking-wider text-gray-400 mb-1">Section {i + 1}</div>
                  <div>H2: {section.h2}</div>
                </td>

                {/* Recommendations — bullet points */}
                <td
                  className="align-top bg-white border-r border-[#ddd] p-3"
                  style={{ minHeight: '100px', fontSize: '13px' }}
                >
                  {Array.isArray(section.recommendations) && section.recommendations.length > 0 ? (
                    <ul className="space-y-1.5">
                      {section.recommendations.map((point, j) => (
                        <li key={j} className="flex items-start gap-1.5 text-gray-800">
                          <span className="mt-1 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-gray-500" />
                          <span className="leading-snug">{point}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="italic text-gray-400">—</span>
                  )}
                </td>

                {/* Content — empty for user to fill */}
                <td
                  className="align-top border-[#ddd] p-3"
                  style={{ minHeight: '100px', backgroundColor: '#f5f5f5' }}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Metadata Cards ───────────────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Word Count */}
        <div className="bg-white border border-[#ddd] rounded-lg p-4">
          <h3 className="font-bold text-sm mb-2" style={{ color: '#1e3a5f' }}>
            Word Count Benchmark
          </h3>
          <p className="text-3xl font-bold text-gray-800">
            {wordCountBenchmark?.toLocaleString() || '—'}
          </p>
          <p className="text-xs text-gray-500 mt-1">words — competitor page average</p>
          <p className="text-xs text-gray-400 mt-2">
            Aim for at least this many words to stay competitive in this SERP.
          </p>
        </div>

        {/* Semantic Keywords */}
        <div className="bg-white border border-[#ddd] rounded-lg p-4">
          <h3 className="font-bold text-sm mb-2" style={{ color: '#1e3a5f' }}>
            Semantic Keywords ({semanticKeywords?.length || 0})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {(semanticKeywords || []).map((kw, i) => (
              <span
                key={i}
                className="inline-block text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: '#e8f0f8', color: '#1e3a5f' }}
              >
                {kw}
              </span>
            ))}
            {(!semanticKeywords || semanticKeywords.length === 0) && (
              <span className="text-gray-400 text-sm italic">None identified</span>
            )}
          </div>
        </div>

        {/* Content Gaps */}
        <div className="bg-white border border-[#ddd] rounded-lg p-4">
          <h3 className="font-bold text-sm mb-2" style={{ color: '#1e3a5f' }}>
            Content Gaps ({contentGaps?.length || 0})
          </h3>
          <ul className="space-y-1.5">
            {(contentGaps || []).map((gap, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-amber-500 mt-0.5 flex-shrink-0">▸</span>
                <span className="text-sm text-gray-700">{gap}</span>
              </li>
            ))}
            {(!contentGaps || contentGaps.length === 0) && (
              <li className="text-gray-400 text-sm italic">None identified</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
