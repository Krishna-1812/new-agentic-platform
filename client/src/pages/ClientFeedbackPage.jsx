import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MDEditor from '@uiw/react-md-editor';

const CLIENTS = [
  { value: 'gentle-dental', label: 'Gentle Dental' },
  { value: 'great-lakes', label: 'Great Lakes' },
  { value: 'riccobene', label: 'Riccobene' },
  { value: 'clear-behavioral-health', label: 'Clear Behavioral Health' },
  { value: 'neuro-wellness-spa', label: 'Neuro Wellness Spa' },
  { value: 'new-life-house', label: 'New Life House' },
];

function currentQuarter() {
  const d = new Date();
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return `${d.getFullYear()}-q${q}`;
}

const PERIODS = (() => {
  const p = [];
  const now = new Date();
  for (let y = now.getFullYear(); y >= now.getFullYear() - 1; y--) {
    for (let q = 4; q >= 1; q--) {
      if (y === now.getFullYear() && q > Math.ceil((now.getMonth() + 1) / 3)) continue;
      p.push(`${y}-q${q}`);
    }
  }
  return p;
})();

export default function ClientFeedbackPage() {
  const navigate = useNavigate();
  const [client, setClient] = useState('gentle-dental');
  const [period, setPeriod] = useState(currentQuarter());
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    if (!body.trim()) { setError('Please add some feedback content.'); return; }
    setSaving(true); setError('');
    const id = `${client}-feedback-${period}`;
    try {
      const res = await fetch('/api/kb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id,
          category: 'client-feedback',
          client,
          industry: 'global',
          period,
          tags: [client, 'client-feedback', period],
          linked_modules: ['content-research', 'keyword-research'],
          priority: 2,
          body,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      navigate(`/kb/${data.id}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-[22px] font-bold text-[#111827]">New Client Feedback Entry</h1>
          <p className="text-sm text-[#6B7280] mt-1">Log notes from a client call, email, or review. Each entry is versioned and never overwritten.</p>
        </div>

        <div className="bg-white rounded-xl border border-[#E5E7EB] p-6 space-y-5" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-[#111827] mb-1.5">Client</label>
              <select value={client} onChange={e => setClient(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-sm text-[#111827] focus:outline-none bg-white">
                {CLIENTS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#111827] mb-1.5">Period</label>
              <select value={period} onChange={e => setPeriod(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-sm text-[#111827] focus:outline-none bg-white">
                {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div className="p-3 bg-[#F4F5F7] rounded-lg">
            <div className="text-xs text-[#6B7280]">This will be saved as KB ID:</div>
            <div className="text-sm font-mono font-semibold text-[#111827] mt-0.5">{client}-feedback-{period}</div>
          </div>

          <div data-color-mode="light">
            <label className="block text-sm font-semibold text-[#111827] mb-1.5">Feedback Notes <span className="font-normal text-[#6B7280]">(Markdown)</span></label>
            <p className="text-xs text-[#9CA3AF] mb-2">Include: dated notes, approval preferences, rejected wording, format preferences, open questions.</p>
            <MDEditor value={body} onChange={val => setBody(val || '')} height={350} preview="edit" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => navigate('/kb')}
              className="px-5 py-2.5 text-sm font-semibold border border-[#E5E7EB] rounded-lg text-[#6B7280] hover:text-[#111827] bg-white transition-colors">
              Cancel
            </button>
            <button onClick={handleCreate} disabled={saving || !body.trim()}
              className="px-5 py-2.5 text-sm font-semibold rounded-lg text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: '#3DAA8E' }}>
              {saving ? 'Creating…' : 'Save Feedback Entry'}
            </button>
          </div>
        </div>
      </main>
  );
}
