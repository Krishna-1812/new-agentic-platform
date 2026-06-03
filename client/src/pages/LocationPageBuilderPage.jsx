import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { lpb } from '../lib/lpbApi';

const TEAL = '#3DAA8E';

const STAGE_COLORS = {
  'Draft': '#9CA3AF', 'Keywords In Progress': '#F59E0B', 'Keywords Finalized': '#3B82F6',
  'Content Generated': '#8B5CF6', 'SEO Review': '#F59E0B', 'SEO Approved': '#10B981',
  'Clinical Review': '#F59E0B', 'Clinical Approved': '#10B981', 'Content Review': '#F59E0B',
  'Content Approved': '#10B981', 'Client Review': '#F59E0B', 'Client Approved': '#059669', 'Exported': '#059669',
};

function Header() {
  return (
    <header className="bg-white border-b border-[#E5E7EB] h-14 flex items-center px-6">
      <div className="max-w-6xl mx-auto w-full flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: TEAL }}>
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
        </div>
        <span className="font-bold text-[#111827] text-sm tracking-tight">Location + Service Page Builder</span>
        <span className="text-[#9CA3AF] text-sm">· Arena</span>
      </div>
    </header>
  );
}

function StatusPill({ status }) {
  const c = STAGE_COLORS[status] || '#9CA3AF';
  return <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: c + '1A', color: c }}>{status}</span>;
}

function NewPageWizard({ onClose, onCreated }) {
  const [data, setData] = useState(null);
  const [serviceId, setServiceId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    lpb.clients().then(async (clients) => {
      if (!clients.length) { setError('No clients found. Click "Seed Neuro Wellness Spa" first.'); return; }
      const full = await lpb.client(clients[0].id);
      setData(full);
    }).catch(e => setError(e.message));
  }, []);

  async function check() {
    setBusy(true); setError(''); setResult(null);
    try {
      const r = await lpb.createPage({ clientId: data.client.id, serviceId, locationId });
      setResult(r);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-[#111827] mb-1">New Page</h2>
        <p className="text-sm text-[#6B7280] mb-4">Select a Client · Service · Location. Eligibility is GBP-backed (§15.1).</p>
        {!data && !error && <p className="text-sm text-[#6B7280]">Loading…</p>}
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        {data && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[#6B7280] mb-1">Client</label>
              <div className="text-sm font-medium text-[#111827] px-3 py-2 bg-[#F4F5F7] rounded-md">{data.client.name}</div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B7280] mb-1">Service</label>
              <select className="w-full border border-[#E5E7EB] rounded-md px-3 py-2 text-sm" value={serviceId} onChange={e => { setServiceId(e.target.value); setResult(null); }}>
                <option value="">Select a service…</option>
                {data.services.map(s => <option key={s.id} value={s.id}>{s.name} ({s.category})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B7280] mb-1">Location</label>
              <select className="w-full border border-[#E5E7EB] rounded-md px-3 py-2 text-sm" value={locationId} onChange={e => { setLocationId(e.target.value); setResult(null); }}>
                <option value="">Select a location…</option>
                {data.locations.map(l => <option key={l.id} value={l.id}>{l.location_name}{l.verified ? '' : ' (not GBP-verified)'}</option>)}
              </select>
            </div>

            {result && (
              <div className={`text-sm rounded-md p-3 ${result.blocked ? 'bg-red-50 text-red-700' : result.existing ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                {result.blocked && <>⛔ Not eligible: {result.eligibility.reason}</>}
                {result.existing && <>⚠ A page for this tuple already exists. <button className="underline font-medium" onClick={() => onCreated(result.page.id)}>Open it →</button></>}
                {!result.blocked && !result.existing && result.page && <>✓ Eligible — page created. <button className="underline font-medium" onClick={() => onCreated(result.page.id)}>Open page →</button></>}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button className="px-4 py-2 text-sm text-[#6B7280]" onClick={onClose}>Cancel</button>
              <button disabled={!serviceId || !locationId || busy} className="px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50" style={{ backgroundColor: TEAL }} onClick={check}>
                {busy ? 'Checking…' : 'Check eligibility & create'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LocationPageBuilderPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wizard, setWizard] = useState(false);
  const [filter, setFilter] = useState('');
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try { setRows(await lpb.pages()); } catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function seed() {
    setSeeding(true);
    try { await lpb.seed(); await load(); } catch (e) { setError(e.message); }
    setSeeding(false);
  }

  const filtered = rows.filter(r =>
    !filter || [r.service_name, r.location_name, r.status, ...(r.primary_keywords || [])].join(' ').toLowerCase().includes(filter.toLowerCase()));

  // Aging flag: not updated in 7+ days and not exported (SLA surface, §12).
  const isStale = (r) => r.status !== 'Exported' && (Date.now() - new Date(r.updated_at).getTime()) > 7 * 864e5;

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F4F5F7' }}>
      <Header />
      <main className="max-w-6xl mx-auto px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-bold text-[#111827]">Pages</h1>
            <p className="text-sm text-[#6B7280] mt-1">Every Location × Service page, its stage, approvals, and QA status.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={seed} disabled={seeding} className="px-3 py-2 text-sm border border-[#E5E7EB] bg-white rounded-md text-[#6B7280] disabled:opacity-50">
              {seeding ? 'Seeding…' : 'Seed Neuro Wellness Spa'}
            </button>
            <button onClick={() => setWizard(true)} className="px-4 py-2 text-sm font-medium text-white rounded-md" style={{ backgroundColor: TEAL }}>+ New Page</button>
          </div>
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by service, location, status, keyword…"
          className="w-full mb-4 border border-[#E5E7EB] rounded-md px-3 py-2 text-sm bg-white" />

        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#6B7280] border-b border-[#E5E7EB] bg-[#FAFAFA]">
                <th className="px-4 py-3 font-medium">Service</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3 font-medium">Primary keywords</th>
                <th className="px-4 py-3 font-medium">QA</th>
                <th className="px-4 py-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="px-4 py-8 text-center text-[#9CA3AF]">Loading…</td></tr>}
              {!loading && !filtered.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-[#9CA3AF]">No pages yet. Seed the client, then create one.</td></tr>}
              {filtered.map(r => (
                <tr key={r.id} className="border-b border-[#F1F1F1] hover:bg-[#F9FAFB] cursor-pointer" onClick={() => navigate(`/location-page-builder/${r.id}`)}>
                  <td className="px-4 py-3 font-medium text-[#111827]">{r.service_name}</td>
                  <td className="px-4 py-3 text-[#6B7280]">{r.location_name}</td>
                  <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                  <td className="px-4 py-3 text-[#6B7280]">{(r.primary_keywords || []).join(', ') || '—'}</td>
                  <td className="px-4 py-3">{r.qa_blocking == null ? '—' : r.qa_blocking === 0 ? <span className="text-green-600">✓ clean</span> : <span className="text-red-600">{r.qa_blocking} blocking</span>}</td>
                  <td className="px-4 py-3 text-[#9CA3AF] text-xs">{isStale(r) && <span className="text-amber-600 mr-1" title="Stalled 7+ days">⏳</span>}{new Date(r.updated_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
      {wizard && <NewPageWizard onClose={() => { setWizard(false); load(); }} onCreated={(id) => navigate(`/location-page-builder/${id}`)} />}
    </div>
  );
}
