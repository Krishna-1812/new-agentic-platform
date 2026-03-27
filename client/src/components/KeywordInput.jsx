export default function KeywordInput({ keyword, setKeyword, onSearch, disabled }) {
  function handleKeyDown(e) {
    if (e.key === 'Enter' && !disabled) onSearch();
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <label htmlFor="keyword" className="block text-sm font-semibold text-gray-700 mb-2">
        Target Keyword
      </label>
      <div className="flex gap-3">
        <input
          id="keyword"
          type="text"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. best project management software"
          disabled={disabled}
          className="flex-1 px-4 py-3 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400 transition"
        />
        <button
          onClick={onSearch}
          disabled={disabled || !keyword.trim()}
          className="px-8 py-3 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: disabled || !keyword.trim() ? '#6b7280' : '#1e3a5f' }}
          onMouseEnter={e => { if (!disabled && keyword.trim()) e.target.style.backgroundColor = '#2e5f8a'; }}
          onMouseLeave={e => { if (!disabled && keyword.trim()) e.target.style.backgroundColor = '#1e3a5f'; }}
        >
          {disabled ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Working…
            </span>
          ) : 'Research'}
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-400">
        Searches top 10 US Google results, scrapes content, and generates AI-powered recommendations.
      </p>
    </div>
  );
}
