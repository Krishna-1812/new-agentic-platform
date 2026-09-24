/* ProgressSteps — pipeline indicator (fetch → scrape → analyze → done) */

const SpinnerSVG = () => (
  <svg
    width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth={2.5}
    strokeLinecap="round"
    style={{ animation: 'stepSpin 0.8s linear infinite', color: 'var(--primary)' }}
  >
    <style>{`@keyframes stepSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
  </svg>
);

const CheckSVG = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

/**
 * ProgressSteps
 * @param {Array} steps — [{ label, description?, status: 'done'|'active'|'pending' }]
 * @param {'horizontal'|'vertical'} layout
 */
export function ProgressSteps({ steps = [], layout = 'horizontal' }) {
  if (layout === 'vertical') {
    return (
      <div style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      }}>
        {steps.map((step, i) => (
          <div key={i} style={{ display: 'flex', gap: 12 }}>
            {/* Node + connector column */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 32 }}>
              <StepNode step={step} />
              {i < steps.length - 1 && (
                <div style={{
                  width: 2,
                  flex: 1,
                  minHeight: 20,
                  background: step.status === 'done' ? 'var(--primary)' : 'var(--border)',
                  margin: '4px 0',
                  transition: 'background 400ms var(--ease)',
                }} />
              )}
            </div>
            {/* Label */}
            <div style={{ paddingTop: 6, paddingBottom: i < steps.length - 1 ? 20 : 0 }}>
              <div style={{
                fontSize: 13,
                fontWeight: step.status === 'active' ? 600 : 500,
                color: step.status === 'pending' ? 'var(--text-3)' : 'var(--text)',
              }}>
                {step.label}
              </div>
              {step.description && (
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                  {step.description}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  /* Horizontal */
  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)',
      padding: '16px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 0,
    }}>
      {steps.map((step, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : undefined }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <StepNode step={step} />
            <span style={{
              fontSize: 11,
              fontWeight: step.status === 'active' ? 600 : 400,
              color: step.status === 'pending' ? 'var(--text-3)' : step.status === 'active' ? 'var(--text)' : 'var(--text-2)',
              whiteSpace: 'nowrap',
            }}>
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div style={{
              flex: 1,
              height: 2,
              background: step.status === 'done' ? 'var(--primary)' : 'var(--border)',
              margin: '-14px 8px 0',
              transition: 'background 400ms var(--ease)',
            }} />
          )}
        </div>
      ))}
    </div>
  );
}

function StepNode({ step }) {
  if (step.status === 'done') {
    return (
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        background: 'var(--success)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <CheckSVG />
      </div>
    );
  }
  if (step.status === 'active') {
    return (
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        background: 'var(--primary-soft)',
        border: '2px solid var(--primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <SpinnerSVG />
      </div>
    );
  }
  return (
    <div style={{
      width: 32, height: 32, borderRadius: '50%',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      color: 'var(--text-3)',
      fontSize: 13,
      fontFamily: 'var(--font-mono)',
      fontWeight: 500,
    }}>
      {step.number ?? '·'}
    </div>
  );
}

export default ProgressSteps;
