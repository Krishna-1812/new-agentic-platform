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
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
          ✓ Scraped
        </span>
      );
      case 'failed': return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
          ✕ Failed
        </span>
      );
      case 'pending': return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-600">
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Scraping…
        </span>
      );
      default: return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
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
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-900 text-sm">Top 10 SERP Results</h2>
          <p className="text-xs text-gray-500 mt-0.5">URLs being analyzed from Google US results</p>
        </div>
        {scrapeResults && (
          <span className="text-xs font-medium text-gray-500">
            {successCount} / {results.length} scraped
          </span>
        )}
      </div>

      {/* URL list */}
      <ol className="divide-y divide-gray-50">
        {results.map((result, i) => {
          const status = getStatus(result.url);
          const errMsg = getErrorMessage(result.url);

          return (
            <li key={i} className="px-5 py-3 flex items-start gap-3 hover:bg-gray-50/50 transition-colors">
              {/* Position */}
              <span
                className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white mt-0.5"
                style={{ backgroundColor: '#1e3a5f' }}
              >
                {result.position}
              </span>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{result.title}</div>
                <div className="text-xs text-blue-600 truncate mt-0.5">
                  <a href={result.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {result.url.length > 80 ? result.url.substring(0, 80) + '…' : result.url}
                  </a>
                </div>
                {result.snippet && (
                  <div className="text-xs text-gray-400 mt-1 line-clamp-2">{result.snippet}</div>
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
