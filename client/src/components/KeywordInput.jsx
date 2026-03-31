export default function KeywordInput({ keyword, setKeyword, onSearch, disabled }) {
  function handleKeyDown(e) {
    if (e.key === 'Enter' && !disabled) onSearch();
  }

  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-6" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)' }}>
      <label htmlFor="keyword" className="block text-sm font-semibold text-[#111827] mb-2">
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
          className="flex-1 px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 disabled:bg-[#F4F5F7] disabled:text-[#9CA3AF] transition-shadow"
          style={{ '--tw-ring-color': '#3DAA8E' }}
        />
        <button
          onClick={onSearch}
          disabled={disabled || !keyword.trim()}
          className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: '#111827' }}
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
      <p className="mt-2 text-xs text-[#9CA3AF]">
        Searches top 10 US Google results, scrapes content, and generates AI-powered recommendations.
      </p>
    </div>
  );
}
