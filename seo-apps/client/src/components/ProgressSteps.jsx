const STEPS = [
  { id: 'searching', label: 'Searching Google',  description: 'Fetching top 10 US results' },
  { id: 'scraping',  label: 'Scraping Pages',    description: 'Extracting content from each URL' },
  { id: 'analyzing', label: 'AI Analysis',       description: 'Generating recommendations' },
  { id: 'done',      label: 'Complete',          description: 'Report ready' },
];

const ORDER = ['searching', 'scraping', 'analyzing', 'done'];

function getStepStatus(stepId, currentStep) {
  const stepIdx = ORDER.indexOf(stepId);
  const currentIdx = ORDER.indexOf(currentStep === 'error' ? 'done' : currentStep);
  if (stepIdx < currentIdx) return 'done';
  if (stepIdx === currentIdx) return 'active';
  return 'pending';
}

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

const SpinnerIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 0.8s linear infinite' }}>
    <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeOpacity="0.25" />
    <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

const MSG = {
  searching: 'Querying Google Custom Search API for top 10 US results…',
  scraping:  'Scraping pages with headless browser (max 3 concurrent) — this may take 30–60 seconds…',
  analyzing: 'Sending content to AI for SEO analysis and content generation…',
  done:      'Analysis complete — your content report is ready below.',
};

export default function ProgressSteps({ step }) {
  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)',
      padding: 20,
      boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {STEPS.map((s, i) => {
          const status = getStepStatus(s.id, step);
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                {/* Circle */}
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, transition: 'all var(--dur-std) var(--ease)',
                  ...(status === 'done'
                    ? { background: 'var(--success)', color: '#fff' }
                    : status === 'active'
                    ? { background: 'var(--primary-soft)', color: 'var(--primary)', border: '2px solid var(--primary)' }
                    : { background: 'var(--surface)', color: 'var(--text-3)', border: '2px solid var(--border)' })
                }}>
                  {status === 'done' ? <CheckIcon /> : status === 'active' ? <SpinnerIcon /> : (
                    <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)' }}>{i + 1}</span>
                  )}
                </div>

                {/* Labels */}
                <div style={{ marginTop: 8, textAlign: 'center' }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600,
                    color: status === 'active' ? 'var(--primary)' : status === 'done' ? 'var(--text)' : 'var(--text-3)',
                    transition: 'color var(--dur-std) var(--ease)',
                  }}>
                    {s.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{s.description}</div>
                </div>
              </div>

              {/* Connector */}
              {i < STEPS.length - 1 && (
                <div style={{
                  height: 2, flex: 1, margin: '0 8px 28px',
                  background: status === 'done' || getStepStatus(STEPS[i + 1].id, step) !== 'pending'
                    ? 'var(--primary)' : 'var(--border)',
                  transition: 'background var(--dur-std) var(--ease)',
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Status message */}
      {MSG[step] && (
        <p style={{
          textAlign: 'center',
          fontSize: 13,
          color: step === 'done' ? 'var(--success)' : 'var(--text-2)',
          fontWeight: step === 'done' ? 600 : 400,
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px solid var(--border)',
        }}>
          {MSG[step]}
        </p>
      )}
    </div>
  );
}
