const STEPS = [
  { id: 'searching', label: 'Searching Google', icon: '🔍', description: 'Fetching top 10 US results' },
  { id: 'scraping', label: 'Scraping Pages', icon: '📄', description: 'Extracting content from each URL' },
  { id: 'analyzing', label: 'AI Analysis', icon: '🤖', description: 'Generating recommendations' },
  { id: 'done', label: 'Complete', icon: '✅', description: 'Report ready' },
];

const ORDER = ['searching', 'scraping', 'analyzing', 'done'];

function getStepStatus(stepId, currentStep) {
  if (currentStep === 'error') {
    const idx = ORDER.indexOf(stepId);
    const curIdx = ORDER.indexOf(currentStep === 'error' ? 'done' : currentStep);
    return idx < curIdx ? 'done' : 'pending';
  }
  const stepIdx = ORDER.indexOf(stepId);
  const currentIdx = ORDER.indexOf(currentStep);
  if (stepIdx < currentIdx) return 'done';
  if (stepIdx === currentIdx) return 'active';
  return 'pending';
}

export default function ProgressSteps({ step }) {
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)' }}>
      <div className="flex items-center justify-between">
        {STEPS.map((s, i) => {
          const status = getStepStatus(s.id, step);
          return (
            <div key={s.id} className="flex items-center flex-1">
              {/* Step */}
              <div className="flex flex-col items-center flex-1">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-base font-bold transition-all"
                  style={
                    status === 'done'
                      ? { backgroundColor: '#3DAA8E', color: '#fff' }
                      : status === 'active'
                      ? { backgroundColor: '#3DAA8E1A', color: '#3DAA8E', border: '2px solid #3DAA8E' }
                      : { backgroundColor: '#F4F5F7', color: '#9CA3AF' }
                  }
                >
                  {status === 'done' ? '✓' : s.icon}
                </div>
                <div className="mt-2 text-center">
                  <div
                    className="text-xs font-semibold"
                    style={
                      status === 'active'
                        ? { color: '#3DAA8E' }
                        : status === 'done'
                        ? { color: '#111827' }
                        : { color: '#9CA3AF' }
                    }
                  >
                    {s.label}
                  </div>
                  <div className="text-xs text-[#9CA3AF] mt-0.5 hidden sm:block">{s.description}</div>
                </div>
              </div>

              {/* Connector */}
              {i < STEPS.length - 1 && (
                <div
                  className="h-0.5 flex-1 mx-2 mb-6 transition-all"
                  style={{
                    backgroundColor:
                      getStepStatus(STEPS[i + 1].id, step) !== 'pending' || status === 'done'
                        ? '#3DAA8E'
                        : '#E5E7EB'
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Active step message */}
      {step === 'searching' && (
        <p className="text-center text-sm text-[#6B7280] mt-3 pt-3 border-t border-[#E5E7EB]">
          Querying Google Custom Search API for top 10 US results…
        </p>
      )}
      {step === 'scraping' && (
        <p className="text-center text-sm text-[#6B7280] mt-3 pt-3 border-t border-[#E5E7EB]">
          Scraping pages with headless browser (max 3 concurrent) — this may take 30–60 seconds…
        </p>
      )}
      {step === 'analyzing' && (
        <p className="text-center text-sm text-[#6B7280] mt-3 pt-3 border-t border-[#E5E7EB]">
          Sending content to AI for SEO analysis and content generation…
        </p>
      )}
      {step === 'done' && (
        <p className="text-center text-sm font-medium mt-3 pt-3 border-t border-[#E5E7EB]" style={{ color: '#3DAA8E' }}>
          Analysis complete — your content report is ready below.
        </p>
      )}
    </div>
  );
}
