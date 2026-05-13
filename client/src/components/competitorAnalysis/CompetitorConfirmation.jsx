import { useState } from 'react';

function TypeBadge({ type }) {
  const map = {
    direct: ['bg-red-100 text-red-700', 'Direct'],
    indirect: ['bg-yellow-100 text-yellow-700', 'Indirect'],
    aggregator: ['bg-purple-100 text-purple-700', 'Aggregator'],
    informational: ['bg-blue-100 text-blue-700', 'Informational'],
  };
  const [cls, label] = map[type] || ['bg-gray-100 text-gray-600', type || 'Unknown'];
  return <span className={`text-xs font-medium px-2 py-0.5 rounded ${cls}`}>{label}</span>;
}

export default function CompetitorConfirmation({ competitors, gptSummary, onConfirm, loading }) {
  const [list, setList] = useState(competitors);
  const [addDomain, setAddDomain] = useState('');
  const [addError, setAddError] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  function remove(domain) {
    setList(l => l.filter(c => c.domain !== domain));
  }

  async function addCompetitor() {
    const domain = addDomain.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase().trim();
    if (!domain) { setAddError('Enter a domain'); return; }
    if (list.find(c => c.domain === domain)) { setAddError('Already in list'); return; }

    setAddLoading(true);
    setAddError('');
    try {
      // We'll just add it directly — validation against Semrush is optional
      setList(l => [...l, {
        domain,
        authorityScore: 0,
        organicTraffic: 0,
        organicKeywords: 0,
        competitionLevel: 0,
        gptReasoning: 'Manually added by analyst.',
        competitorType: 'direct',
        gptStatus: 'keep',
      }]);
      setAddDomain('');
    } catch {
      setAddError('Failed to add domain');
    } finally {
      setAddLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* GPT Summary */}
      {gptSummary && (
        <div className="bg-[#F0F7FF] border border-[#BAD5F5] rounded-xl p-4">
          <p className="text-xs font-semibold text-[#245E9E] mb-1.5">AI Competitive Landscape Summary</p>
          <p className="text-sm text-[#374151] leading-relaxed">{gptSummary}</p>
        </div>
      )}

      {/* Competitor cards */}
      <div className="space-y-3">
        {list.map(c => (
          <div key={c.domain} className="bg-white border border-[#E5E7EB] rounded-xl p-4 flex gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="text-sm font-semibold text-[#111827]">{c.domain}</span>
                <TypeBadge type={c.competitorType} />
              </div>
              <div className="flex gap-4 text-xs text-[#6B7280] mb-2 flex-wrap">
                {c.authorityScore > 0 && <span>Authority: <b className="text-[#374151]">{c.authorityScore}</b></span>}
                {c.organicTraffic > 0 && <span>Traffic: <b className="text-[#374151]">{c.organicTraffic.toLocaleString()}</b></span>}
                {c.organicKeywords > 0 && <span>Keywords: <b className="text-[#374151]">{c.organicKeywords.toLocaleString()}</b></span>}
                {c.competitionLevel > 0 && <span>Competition: <b className="text-[#374151]">{(c.competitionLevel * 100).toFixed(0)}%</b></span>}
              </div>
              {c.gptReasoning && (
                <p className="text-xs text-[#6B7280] leading-relaxed italic">"{c.gptReasoning}"</p>
              )}
            </div>
            <button
              onClick={() => remove(c.domain)}
              className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[#9CA3AF] hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Remove"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Add competitor */}
      <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-4">
        <p className="text-xs font-semibold text-[#374151] mb-2">Add a Competitor Manually</p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="e.g. competitor.com"
            value={addDomain}
            onChange={e => { setAddDomain(e.target.value); setAddError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCompetitor(); } }}
            className="flex-1 border border-[#D1D5DB] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#245E9E]"
          />
          <button
            onClick={addCompetitor}
            disabled={addLoading}
            className="px-4 py-2 bg-[#245E9E] text-white text-sm font-medium rounded-lg hover:bg-[#1d4f87] disabled:opacity-50 transition-colors"
          >
            Add
          </button>
        </div>
        {addError && <p className="text-xs text-red-500 mt-1">{addError}</p>}
      </div>

      {/* Run button */}
      <div>
        {list.length < 3 && (
          <p className="text-xs text-amber-600 mb-2 text-center">Add at least 3 competitors to run the analysis.</p>
        )}
        <button
          onClick={() => onConfirm(list)}
          disabled={loading || list.length < 3}
          className="w-full py-3 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50"
          style={{ backgroundColor: '#D3342E' }}
        >
          {loading ? 'Starting Analysis…' : `Run Full Analysis (${list.length} competitor${list.length !== 1 ? 's' : ''})`}
        </button>
      </div>
    </div>
  );
}
