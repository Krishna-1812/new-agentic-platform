const STEPS = [
  { id: 'searching', label: 'Searching Google', icon: '🔍', description: 'Fetching top 10 US results' },
  { id: 'scraping', label: 'Scraping Pages', icon: '📄', description: 'Extracting content from each URL' },
  { id: 'analyzing', label: 'AI Analysis', icon: '🤖', description: 'Claude generating recommendations' },
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
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-center justify-between">
        {STEPS.map((s, i) => {
          const status = getStepStatus(s.id, step);
          return (
            <div key={s.id} className="flex items-center flex-1">
              {/* Step */}
              <div className="flex flex-col items-center flex-1">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold transition-all ${
                    status === 'done'
                      ? 'bg-green-500 text-white'
                      : status === 'active'
                      ? 'text-white animate-pulse'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                  style={status === 'active' ? { backgroundColor: '#1e3a5f' } : {}}
                >
                  {status === 'done' ? '✓' : s.icon}
                </div>
                <div className="mt-2 text-center">
                  <div
                    className={`text-xs font-semibold ${
                      status === 'active' ? 'text-blue-900' : status === 'done' ? 'text-green-700' : 'text-gray-400'
                    }`}
                  >
                    {s.label}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5 hidden sm:block">{s.description}</div>
                </div>
              </div>

              {/* Connector */}
              {i < STEPS.length - 1 && (
                <div
                  className="h-0.5 flex-1 mx-2 mb-6 transition-all"
                  style={{
                    backgroundColor:
                      getStepStatus(STEPS[i + 1].id, step) !== 'pending' || status === 'done'
                        ? '#22c55e'
                        : '#e5e7eb'
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Active step message */}
      {step === 'searching' && (
        <p className="text-center text-sm text-gray-500 mt-3 pt-3 border-t border-gray-100">
          Querying Google Custom Search API for top 10 US results…
        </p>
      )}
      {step === 'scraping' && (
        <p className="text-center text-sm text-gray-500 mt-3 pt-3 border-t border-gray-100">
          Scraping pages with headless browser (max 3 concurrent) — this may take 30–60 seconds…
        </p>
      )}
      {step === 'analyzing' && (
        <p className="text-center text-sm text-gray-500 mt-3 pt-3 border-t border-gray-100">
          Sending content to Claude for SEO analysis and content generation…
        </p>
      )}
      {step === 'done' && (
        <p className="text-center text-sm text-green-600 mt-3 pt-3 border-t border-gray-100 font-medium">
          Analysis complete — your content report is ready below.
        </p>
      )}
    </div>
  );
}
