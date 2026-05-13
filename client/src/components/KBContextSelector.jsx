import { useState, useEffect, useCallback, memo } from 'react';

const CLIENTS = [
  { value: '', label: 'No client (generic)' },
  { value: 'gentle-dental', label: 'Gentle Dental' },
  { value: 'great-lakes', label: 'Great Lakes' },
  { value: 'riccobene', label: 'Riccobene' },
  { value: 'clear-behavioral-health', label: 'Clear Behavioral Health' },
  { value: 'neuro-wellness-spa', label: 'Neuro Wellness Spa' },
  { value: 'new-life-house', label: 'New Life House' },
];

function KBContextSelector({ module: moduleId, onChange, disabled }) {
  const [client, setClient] = useState('');
  const [feedbackKbIds, setFeedbackKbIds] = useState([]);
  const [kbData, setKbData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Fetch KB context whenever client changes
  useEffect(() => {
    if (!client) {
      setKbData(null);
      setFeedbackKbIds([]);
      onChange?.({ client: '', feedbackKbIds: [] });
      return;
    }
    setLoading(true);
    fetch(
      `/api/kb-context?client=${encodeURIComponent(client)}&module=${encodeURIComponent(moduleId)}`,
      { credentials: 'include' }
    )
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        setKbData(data);
        setFeedbackKbIds([]);
        onChange?.({ client, feedbackKbIds: [] });
      })
      .catch(() => setKbData(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, moduleId]);

  // Notify parent when feedback selection changes
  useEffect(() => {
    if (!client) return;
    onChange?.({ client, feedbackKbIds });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedbackKbIds]);

  const toggleFeedback = useCallback((id) => {
    setFeedbackKbIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }, []);

  // Build summary + warnings
  const summaryItems = [];
  const warnings = [];
  if (client && kbData && !loading) {
    if (kbData.brand) {
      summaryItems.push({ label: 'Brand', id: kbData.brand.id, hasContent: kbData.brand.hasContent });
      if (!kbData.brand.hasContent) warnings.push(`Brand KB "${kbData.brand.id}" has no content`);
    }
    if (kbData.industry) {
      summaryItems.push({ label: 'Industry', id: kbData.industry.id, hasContent: kbData.industry.hasContent });
      if (!kbData.industry.hasContent) warnings.push(`Industry KB "${kbData.industry.id}" has no content`);
    }
    for (const id of feedbackKbIds) {
      const fb = kbData.feedbackOptions?.find(f => f.id === id);
      if (fb) {
        summaryItems.push({ label: `Feedback: ${fb.label}`, id: fb.id, hasContent: fb.hasContent });
        if (!fb.hasContent) warnings.push(`Feedback KB "${fb.label}" has no content`);
      }
    }
  }

  const feedbackOptions = kbData?.feedbackOptions || [];
  const selectedCount = feedbackKbIds.length;

  return (
    <div className="space-y-2">
      {/* Selector row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Brand */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-[#6B7280] whitespace-nowrap">Brand</label>
          <select
            value={client}
            onChange={e => setClient(e.target.value)}
            disabled={disabled}
            className="text-xs border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 bg-white text-[#111827] focus:outline-none disabled:opacity-50 disabled:bg-[#F4F5F7]"
          >
            {CLIENTS.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {client && (
          <>
            {/* Industry (auto-resolved from brand's associated industry KB) */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-[#6B7280]">Industry</span>
              {loading ? (
                <span className="text-xs text-[#9CA3AF]">…</span>
              ) : kbData?.industry ? (
                <span className="text-xs px-2 py-0.5 rounded bg-[#F4F5F7] text-[#111827] font-medium">{kbData.industry.id}</span>
              ) : (
                <span className="text-xs text-[#9CA3AF]">not set</span>
              )}
              <span className="text-xs text-[#9CA3AF]">(auto)</span>
            </div>

            {/* Client Feedback — multi-select */}
            <div className="relative flex items-center gap-2">
              <span className="text-xs font-semibold text-[#6B7280]">Feedback</span>
              {loading ? (
                <span className="text-xs text-[#9CA3AF]">…</span>
              ) : feedbackOptions.length === 0 ? (
                <span className="text-xs text-[#9CA3AF]">No feedback available</span>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setFeedbackOpen(o => !o)}
                    className="text-xs border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 bg-white text-[#111827] focus:outline-none disabled:opacity-50 disabled:bg-[#F4F5F7] flex items-center gap-1.5 min-w-[120px]"
                  >
                    <span className="flex-1 text-left">
                      {selectedCount === 0 ? 'None selected' : `${selectedCount} selected`}
                    </span>
                    <svg className={`w-3 h-3 text-[#9CA3AF] transition-transform ${feedbackOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {feedbackOpen && (
                    <div className="absolute top-full mt-1 left-0 z-20 bg-white border border-[#E5E7EB] rounded-lg shadow-md min-w-[200px] py-1">
                      {feedbackOptions.map(f => (
                        <label
                          key={f.id}
                          className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#F4F5F7] cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={feedbackKbIds.includes(f.id)}
                            onChange={() => toggleFeedback(f.id)}
                            className="w-3.5 h-3.5 accent-[#3DAA8E]"
                          />
                          <span className="text-xs text-[#111827] font-medium">{f.label}</span>
                          {!f.hasContent && (
                            <span className="text-[10px] text-[#D97706]">empty</span>
                          )}
                        </label>
                      ))}
                      <div className="border-t border-[#E5E7EB] mt-1 pt-1 px-3 pb-1">
                        <button
                          type="button"
                          onClick={() => setFeedbackOpen(false)}
                          className="text-[10px] text-[#6B7280] hover:text-[#111827]"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Injection summary */}
      {client && !loading && summaryItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-xs">
          <span className="text-[#9CA3AF] font-medium mr-0.5">Context injected:</span>
          {summaryItems.map(item => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: item.hasContent ? '#D1FAE5' : '#FEE2E2',
                color: item.hasContent ? '#065F46' : '#DC2626',
              }}
            >
              {item.hasContent ? '✓' : '⚠'} {item.label}: {item.id}
            </span>
          ))}
        </div>
      )}

      {/* No-content warnings */}
      {warnings.length > 0 && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[#FEF9C3] border border-[#FDE68A] text-xs">
          <span style={{ color: '#D97706' }} className="mt-0.5 flex-shrink-0">⚠</span>
          <div className="space-y-0.5">
            {warnings.map((w, i) => (
              <p key={i} style={{ color: '#92400E' }}>
                {w} —{' '}
                <a href="/kb" className="underline hover:opacity-75">edit in KB</a>
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(KBContextSelector);
