export default function SerpUrls({ results, scrapeResults, isLoading }) {
  function getStatus(url) {
    if (!scrapeResults) return isLoading ? 'pending' : 'queued';
    const found = scrapeResults.find(r => r.url === url);
    if (!found) return 'queued';
    return found.success ? 'success' : 'failed';
  }

  function getStatusBadge(status) {
    switch (status) {
      case 'success': return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
          ✓ Scraped
        </span>
      );
      case 'failed': return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-600">
          ✕ Failed
        </span>
      );
      case 'pending': return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: '#3DAA8E1A', color: '#3DAA8E' }}>
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Scraping…
        </span>
      );
      default: return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[#F4F5F7] text-[#9CA3AF]">
          Queued
        </span>
      );
    }
  }

  function getErrorMessage(url) {
    if (!scrapeResults) return null;
    const found = scrapeResults.find(r => r.url === url);
    return found && !found.success ? found.error : null;
  }

  const successCount = scrapeResults ? scrapeResults.filter(r => r.success).length : 0;

  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)' }}>
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-[#E5E7EB] bg-[#F9FAFB] flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-[#111827] text-sm">Top 10 SERP Results</h2>
          <p className="text-xs text-[#6B7280] mt-0.5">URLs being analyzed from Google US results</p>
        </div>
        {scrapeResults && (
          <span className="text-xs font-medium text-[#6B7280]">
            {successCount} / {results.length} scraped
          </span>
        )}
      </div>

      {/* URL list */}
      <ol className="divide-y divide-[#F3F4F6]">
        {results.map((result, i) => {
          const status = getStatus(result.url);
          const errMsg = getErrorMessage(result.url);

          return (
            <li key={i} className="px-5 py-3 flex items-start gap-3 hover:bg-[#F9FAFB] transition-colors">
              {/* Position */}
              <span
                className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white mt-0.5"
                style={{ backgroundColor: '#3DAA8E' }}
              >
                {result.position}
              </span>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[#111827] truncate">{result.title}</div>
                <div className="text-xs truncate mt-0.5" style={{ color: '#3DAA8E' }}>
                  <a href={result.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {result.url.length > 80 ? result.url.substring(0, 80) + '…' : result.url}
                  </a>
                </div>
                {result.snippet && (
                  <div className="text-xs text-[#9CA3AF] mt-1 line-clamp-2">{result.snippet}</div>
                )}
                {errMsg && (
                  <div className="text-xs text-red-500 mt-1">⚠ {errMsg}</div>
                )}
              </div>

              {/* Status badge */}
              <div className="flex-shrink-0 mt-0.5">
                {getStatusBadge(status)}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
