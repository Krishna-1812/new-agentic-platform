import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import MDEditor from '@uiw/react-md-editor';

const CLIENTS = ['global','gentle-dental','great-lakes','riccobene','clear-behavioral-health','neuro-wellness-spa','new-life-house'];
const INDUSTRIES = ['global','dental-service-organizations','mental-health-organizations','b2b-tech'];
const CATEGORIES = ['industry','brand','client-feedback','best-practices'];
const ALL_MODULES = ['content-research','keyword-research'];

export default function KBEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [kb, setKb] = useState(null);
  const [meta, setMeta] = useState({});
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [toggling, setToggling] = useState(false);
  const [changeNote, setChangeNote] = useState('');

  useEffect(() => {
    fetch(`/api/kb/${id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setKb(d);
        setMeta(d.meta || {});
        setBody(d.body || '');
        setLoading(false);
      })
      .catch(() => { setError('Failed to load KB.'); setLoading(false); });
  }, [id]);

  async function handleSave() {
    setSaving(true); setSaved(false); setError('');
    try {
      const res = await fetch(`/api/kb/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ meta, body, changeNote: changeNote || 'Updated' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMeta(data.meta);
      setSaved(true);
      setChangeNote('');
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle() {
    if (!window.confirm(`${meta.active ? 'Deactivate' : 'Reactivate'} this KB? ${meta.active ? 'It will be marked deprecated and skipped by all modules.' : 'It will be re-enabled for all linked modules.'}`)) return;
    setToggling(true);
    try {
      const res = await fetch(`/api/kb/${id}/toggle`, { method: 'PATCH', credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMeta(prev => ({ ...prev, active: data.active, deprecated: !data.active }));
    } catch (err) {
      setError(err.message);
    } finally {
      setToggling(false);
    }
  }

  const setMetaField = (field, value) => setMeta(prev => ({ ...prev, [field]: value }));

  const toggleModule = (mod) => {
    const current = meta.linked_modules || [];
    setMetaField('linked_modules', current.includes(mod) ? current.filter(m => m !== mod) : [...current, mod]);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F4F5F7' }}>
      <p className="text-sm text-[#6B7280]">Loading…</p>
    </div>
  );

  if (!kb && !loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F4F5F7' }}>
      <p className="text-sm text-red-500">KB not found.</p>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F4F5F7' }}>
      {/* Header */}
      <header className="bg-white border-b border-[#E5E7EB] h-14 flex items-center px-6 flex-shrink-0">
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/kb')} className="flex items-center gap-1.5 text-[#6B7280] hover:text-[#111827] text-sm font-medium transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
              Knowledge Base
            </button>
            <span className="text-[#E5E7EB]">/</span>
            <span className="text-sm font-semibold text-[#111827] font-mono">{id}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${meta.active ? 'bg-[#D1FAE5] text-[#065F46]' : 'bg-[#F3F4F6] text-[#9CA3AF]'}`}>
              {meta.active ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#9CA3AF]">v{meta.version}</span>
            <button onClick={handleToggle} disabled={toggling}
              className="px-3 py-1.5 text-xs font-semibold border border-[#E5E7EB] rounded-lg text-[#6B7280] hover:text-[#111827] bg-white transition-colors disabled:opacity-50">
              {meta.active ? 'Deactivate' : 'Reactivate'}
            </button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 text-xs font-semibold rounded-lg text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: saving ? '#6B7280' : '#111827' }}>
              {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex-shrink-0">{error}</div>
      )}

      {/* Two-pane layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left pane: frontmatter form */}
        <aside className="w-72 flex-shrink-0 bg-white border-r border-[#E5E7EB] overflow-y-auto">
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-1">ID</label>
              <div className="px-3 py-2 bg-[#F4F5F7] rounded-lg text-sm text-[#9CA3AF] font-mono">{meta.id}</div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-1">Category</label>
              <select value={meta.category || ''} onChange={e => setMetaField('category', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm text-[#111827] focus:outline-none bg-white">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-1">Client</label>
              <select value={meta.client || ''} onChange={e => setMetaField('client', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm text-[#111827] focus:outline-none bg-white">
                {CLIENTS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-1">Industry</label>
              <select value={meta.industry || ''} onChange={e => setMetaField('industry', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm text-[#111827] focus:outline-none bg-white">
                {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-1">Tags <span className="normal-case font-normal">(comma-separated)</span></label>
              <input type="text" value={(meta.tags || []).join(', ')}
                onChange={e => setMetaField('tags', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
                className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm text-[#111827] focus:outline-none" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-1">Priority <span className="normal-case font-normal">(1=highest)</span></label>
              <input type="number" min={1} max={5} value={meta.priority || 3}
                onChange={e => setMetaField('priority', parseInt(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm text-[#111827] focus:outline-none" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-2">Linked Modules</label>
              <div className="space-y-1.5">
                {ALL_MODULES.map(mod => (
                  <label key={mod} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={(meta.linked_modules || []).includes(mod)}
                      onChange={() => toggleModule(mod)}
                      className="rounded" />
                    <span className="text-sm text-[#111827]">{mod}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-1">Change Note</label>
              <input type="text" value={changeNote} onChange={e => setChangeNote(e.target.value)}
                placeholder="Describe what changed…"
                className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm text-[#111827] focus:outline-none" />
            </div>

            <div className="pt-2 border-t border-[#E5E7EB] space-y-1 text-xs text-[#9CA3AF]">
              <div>Last updated: {meta.last_updated}</div>
              <div>Version: {meta.version}</div>
            </div>
          </div>
        </aside>

        {/* Right pane: Markdown editor */}
        <div className="flex-1 overflow-hidden flex flex-col" data-color-mode="light">
          <div className="flex-1 overflow-auto">
            <MDEditor
              value={body}
              onChange={val => setBody(val || '')}
              height="100%"
              style={{ minHeight: '100%', borderRadius: 0, border: 'none' }}
              preview="edit"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
