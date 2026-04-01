import { useState, useEffect } from 'react';

const CLIENTS = [
  { value: '', label: 'No client (generic)' },
  { value: 'gentle-dental', label: 'Gentle Dental' },
  { value: 'great-lakes', label: 'Great Lakes' },
  { value: 'riccobene', label: 'Riccobene' },
  { value: 'clear-behavioral-health', label: 'Clear Behavioral Health' },
  { value: 'neuro-wellness-spa', label: 'Neuro Wellness Spa' },
  { value: 'new-life-house', label: 'New Life House' },
];

export default function KBContextSelector({ module: moduleId, onChange, disabled }) {
  const [client, setClient] = useState('');
  const [feedbackKbId, setFeedbackKbId] = useState('');
  const [kbData, setKbData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Fetch KB context whenever client changes
  useEffect(() => {
    if (!client) {
      setKbData(null);
      setFeedbackKbId('');
      onChange?.({ client: '', feedbackKbId: null });
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
        const newest = data?.feedbackOptions?.[0]?.id || '';
        setFeedbackKbId(newest);
        onChange?.({ client, feedbackKbId: newest || null });
      })
      .catch(() => setKbData(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, moduleId]);

  // Notify parent when feedback selection changes
  useEffect(() => {
    if (!client) return;
    onChange?.({ client, feedbackKbId: feedbackKbId || null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedbackKbId]);

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
    if (kbData.bestPractices) {
      summaryItems.push({ label: 'Best Practices', id: kbData.bestPractices.id, hasContent: kbData.bestPractices.hasContent });
      if (!kbData.bestPractices.hasContent) warnings.push(`Best Practices KB "${kbData.bestPractices.id}" has no content`);
    }
    const selectedFb = kbData.feedbackOptions?.find(f => f.id === feedbackKbId);
    if (selectedFb) {
      summaryItems.push({ label: 'Feedback', id: selectedFb.id, hasContent: selectedFb.hasContent });
      if (!selectedFb.hasContent) warnings.push(`Feedback KB "${selectedFb.id}" has no content`);
    }
  }

  return (
    <div className="space-y-2">
      {/* Selector row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Brand / Client */}
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
            {/* Industry (auto-resolved from brand frontmatter) */}
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

            {/* Best Practices (auto from module) */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-[#6B7280]">Best Practices</span>
              {loading ? (
                <span className="text-xs text-[#9CA3AF]">…</span>
              ) : kbData?.bestPractices ? (
                <span className="text-xs px-2 py-0.5 rounded bg-[#F4F5F7] text-[#111827] font-medium">{kbData.bestPractices.id}</span>
              ) : (
                <span className="text-xs text-[#9CA3AF]">none</span>
              )}
              <span className="text-xs text-[#9CA3AF]">(auto)</span>
            </div>

            {/* Client Feedback — dropdown if multiple, label if single */}
            {!loading && kbData?.feedbackOptions?.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[#6B7280]">Feedback</span>
                {kbData.feedbackOptions.length === 1 ? (
                  <span className="text-xs px-2 py-0.5 rounded bg-[#F4F5F7] text-[#111827] font-medium">
                    {kbData.feedbackOptions[0].period}
                  </span>
                ) : (
                  <select
                    value={feedbackKbId}
                    onChange={e => setFeedbackKbId(e.target.value)}
                    disabled={disabled}
                    className="text-xs border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 bg-white text-[#111827] focus:outline-none disabled:opacity-50"
                  >
                    <option value="">None</option>
                    {kbData.feedbackOptions.map(f => (
                      <option key={f.id} value={f.id}>{f.period}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
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
