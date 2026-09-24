const SpinnerIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 0.8s linear infinite' }}>
    <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeOpacity="0.25" />
    <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

export default function KeywordInput({ keyword, setKeyword, onSearch, disabled, placeholder, label, hint }) {
  function handleKeyDown(e) {
    if (e.key === 'Enter' && !disabled) onSearch();
  }

  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)',
      padding: 24,
      boxShadow: 'var(--shadow-sm)',
    }}>
      <label htmlFor="keyword" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
        {label || 'Target Keyword'}
      </label>
      <div style={{ display: 'flex', gap: 10 }}>
        <input
          id="keyword"
          type="text"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || 'e.g. best project management software'}
          disabled={disabled}
          style={{
            flex: 1, padding: '9px 14px',
            borderRadius: 'var(--r-md)',
            border: '1px solid var(--border)',
            fontSize: 14, color: 'var(--text)',
            background: disabled ? 'var(--surface)' : 'var(--card)',
            outline: 'none',
            transition: 'border-color var(--dur-fast) var(--ease)',
          }}
          onFocus={e => e.target.style.borderColor = 'var(--primary)'}
          onBlur={e => e.target.style.borderColor = 'var(--border)'}
        />
        <button
          onClick={onSearch}
          disabled={disabled || !keyword.trim()}
          style={{
            padding: '9px 22px',
            borderRadius: 'var(--r-md)',
            fontSize: 13, fontWeight: 600,
            color: '#fff',
            background: 'var(--primary)',
            border: 'none', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 8,
            opacity: disabled || !keyword.trim() ? 0.5 : 1,
            transition: 'opacity var(--dur-fast) var(--ease)',
          }}
        >
          {disabled ? (
            <><SpinnerIcon /> Working…</>
          ) : 'Research'}
        </button>
      </div>
      <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-3)' }}>
        {hint || 'Searches top 10 US Google results, scrapes content, and generates AI-powered recommendations.'}
      </p>
    </div>
  );
}
