import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import KBStatusBadge from '../components/KBStatusBadge';

const CATEGORIES = ['all', 'industry', 'brand', 'client-feedback'];
const CATEGORY_LABELS = {
  all: 'All',
  industry: 'Industry',
  brand: 'Brand',
  'client-feedback': 'Client Feedback',
};

const CLIENTS = [
  { value: '', label: 'All clients' },
  { value: 'gentle-dental', label: 'Gentle Dental' },
  { value: 'great-lakes', label: 'Great Lakes' },
  { value: 'riccobene', label: 'Riccobene' },
  { value: 'clear-behavioral-health', label: 'Clear Behavioral Health' },
  { value: 'neuro-wellness-spa', label: 'Neuro Wellness Spa' },
  { value: 'new-life-house', label: 'New Life House' },
  { value: 'global', label: 'Global' },
];

function PageHeader({ navigate }) {
  return (
    <header className="bg-white border-b border-[#E5E7EB] h-14 flex items-center px-6">
      <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-[#6B7280] hover:text-[#111827] text-sm font-medium transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
            All tools
          </button>
          <span className="text-[#E5E7EB]">/</span>
          <span className="text-sm font-semibold text-[#111827]">Knowledge Base</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/kb/audit')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-[#E5E7EB] rounded-lg text-[#6B7280] hover:text-[#111827] hover:border-[#D1D5DB] transition-colors bg-white">
            Audit
          </button>
          <button onClick={() => navigate('/kb/feedback/new')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-[#E5E7EB] rounded-lg text-[#6B7280] hover:text-[#111827] hover:border-[#D1D5DB] transition-colors bg-white">
            + Client Feedback
          </button>
          <button onClick={() => navigate('/kb/new')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-white transition-colors"
            style={{ backgroundColor: '#111827' }}>
            + New KB
          </button>
        </div>
      </div>
    </header>
  );
}

export default function KnowledgeBasePage() {
  const navigate = useNavigate();
  const [kbs, setKbs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all | active | inactive

  useEffect(() => {
    fetch('/api/kb', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setKbs(d.knowledge_bases || []); setLoading(false); })
      .catch(() => { setError('Failed to load knowledge bases.'); setLoading(false); });
  }, []);

  const filtered = kbs.filter(kb => {
    if (activeCategory !== 'all' && kb.category !== activeCategory) return false;
    if (clientFilter && kb.client !== clientFilter) return false;
    if (statusFilter === 'active' && !kb.active) return false;
    if (statusFilter === 'inactive' && kb.active) return false;
    return true;
  });

  const grouped = CATEGORIES.slice(1).reduce((acc, cat) => {
    acc[cat] = filtered.filter(kb => kb.category === cat);
    return acc;
  }, {});

  return (
      <main className="max-w-7xl mx-auto px-8 py-7">
        <div className="mb-6">
          <h1 className="text-[22px] font-bold text-[#111827]">Knowledge Base</h1>
          <p className="text-sm text-[#6B7280] mt-1">Manage client context, industry rules, and best practices injected into AI tools.</p>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          {/* Category tabs */}
          <div className="flex gap-1.5 flex-wrap">
            {CATEGORIES.map(cat => (
              <button key={cat} onClick={() => setActiveCategory(cat)}
                className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
                style={activeCategory === cat
                  ? { backgroundColor: '#111827', color: '#fff', borderColor: '#111827' }
                  : { backgroundColor: '#fff', color: '#6B7280', borderColor: '#E5E7EB' }}>
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <select value={clientFilter} onChange={e => setClientFilter(e.target.value)}
              className="text-xs border border-[#E5E7EB] rounded-lg px-3 py-1.5 bg-white text-[#6B7280] focus:outline-none">
              {CLIENTS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="text-xs border border-[#E5E7EB] rounded-lg px-3 py-1.5 bg-white text-[#6B7280] focus:outline-none">
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </div>
        </div>

        {loading && <p className="text-sm text-[#6B7280]">Loading…</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}

        {!loading && !error && (
          <div className="space-y-8">
            {(activeCategory === 'all' ? CATEGORIES.slice(1) : [activeCategory]).map(cat => {
              const items = activeCategory === 'all' ? grouped[cat] : filtered;
              if (items.length === 0) return null;
              return (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-3">
                    <h2 className="text-base font-semibold text-[#111827]">{CATEGORY_LABELS[cat]}</h2>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#E5E7EB] text-[#6B7280]">{items.length}</span>
                  </div>
                  <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                          <th className="text-left text-xs font-semibold text-[#6B7280] px-4 py-3">ID</th>
                          <th className="text-left text-xs font-semibold text-[#6B7280] px-4 py-3">Client</th>
                          <th className="text-left text-xs font-semibold text-[#6B7280] px-4 py-3">Tags</th>
                          <th className="text-left text-xs font-semibold text-[#6B7280] px-4 py-3">Modules</th>
                          <th className="text-left text-xs font-semibold text-[#6B7280] px-4 py-3">Status</th>
                          <th className="px-4 py-3" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F3F4F6]">
                        {items.map(kb => (
                          <tr key={kb.id} className="hover:bg-[#F9FAFB] transition-colors">
                            <td className="px-4 py-3 font-medium text-[#111827]">{kb.id}</td>
                            <td className="px-4 py-3 text-[#6B7280]">{kb.client}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1">
                                {(kb.tags || []).slice(0, 3).map(tag => (
                                  <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-[#F4F5F7] text-[#6B7280]">{tag}</span>
                                ))}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-[#6B7280] text-xs">{(kb.linked_modules || []).join(', ') || '—'}</td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded ${kb.active ? 'bg-[#D1FAE5] text-[#065F46]' : 'bg-[#F3F4F6] text-[#9CA3AF]'}`}>
                                {kb.active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <button onClick={() => navigate(`/kb/${kb.id}`)}
                                className="text-xs font-medium transition-colors"
                                style={{ color: '#3DAA8E' }}>
                                Edit →
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="text-center py-16 text-[#9CA3AF] text-sm">No knowledge bases match your filters.</div>
            )}
          </div>
        )}
      </main>
  );
}
