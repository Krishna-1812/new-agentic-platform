import { memo } from 'react';

const SpinnerIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 0.8s linear infinite' }}>
    <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeOpacity="0.25" />
    <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

function StatusBadge({ status }) {
  const styles = {
    success: { bg: 'var(--success-soft)', color: 'var(--success)', label: 'Scraped' },
    failed:  { bg: 'var(--danger-soft)',  color: 'var(--danger)',  label: 'Failed' },
    pending: { bg: 'var(--primary-soft)', color: 'var(--primary)', label: 'Scraping…', spinner: true },
    queued:  { bg: 'var(--surface)',      color: 'var(--text-3)',  label: 'Queued' },
  };
  const s = styles[status] || styles.queued;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 'var(--r-pill)',
      fontSize: 11, fontWeight: 600,
      background: s.bg, color: s.color,
    }}>
      {s.spinner ? <SpinnerIcon /> : null}
      {s.label}
    </span>
  );
}

function SerpUrls({ results, scrapeResults, isLoading }) {
  function getStatus(url) {
    if (!scrapeResults) return isLoading ? 'pending' : 'queued';
    const found = scrapeResults.find(r => r.url === url);
    if (!found) return 'queued';
    return found.success ? 'success' : 'failed';
  }

  function getErrorMessage(url) {
    if (!scrapeResults) return null;
    const found = scrapeResults.find(r => r.url === url);
    return found && !found.success ? found.error : null;
  }

  const successCount = scrapeResults ? scrapeResults.filter(r => r.success).length : 0;

  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)',
      overflow: 'hidden',
      boxShadow: 'var(--shadow-sm)',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <h2 style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14, margin: 0 }}>Top 10 SERP Results</h2>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2, marginBottom: 0 }}>URLs being analyzed from Google US results</p>
        </div>
        {scrapeResults && (
          <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>
            {successCount} / {results.length} scraped
          </span>
        )}
      </div>

      {/* URL list */}
      <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {results.map((result, i) => {
          const status = getStatus(result.url);
          const errMsg = getErrorMessage(result.url);
          return (
            <li key={i} style={{
              padding: '12px 20px',
              display: 'flex', alignItems: 'flex-start', gap: 12,
              borderBottom: i < results.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              {/* Position bubble */}
              <span style={{
                flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
                background: 'var(--primary)', color: '#fff', marginTop: 2,
              }}>
                {result.position}
              </span>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {result.title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--primary-text)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <a href={result.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}
                    onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                    onMouseLeave={e => e.target.style.textDecoration = 'none'}
                  >
                    {result.url.length > 80 ? result.url.substring(0, 80) + '…' : result.url}
                  </a>
                </div>
                {result.snippet && (
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {result.snippet}
                  </div>
                )}
                {errMsg && (
                  <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>⚠ {errMsg}</div>
                )}
              </div>

              {/* Status badge */}
              <div style={{ flexShrink: 0, marginTop: 2 }}>
                <StatusBadge status={status} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default memo(SerpUrls);
