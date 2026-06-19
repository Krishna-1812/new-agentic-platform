import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { hs } from '../lib/hubSpokeApi';

const TEAL = '#3DAA8E';

const INDUSTRIES = ['Dental', 'Healthcare', 'Legal', 'Ecommerce', 'Real Estate', 'SaaS', 'Other'];

const STATUS_LABELS = {
  input: 'Input',
  analyzing: 'Analyzing',
  reviewing: 'Review',
  approved: 'Ready',
  complete: 'Complete',
};
const STATUS_COLORS = {
  input: '#9CA3AF',
  analyzing: '#F59E0B',
  reviewing: '#3B82F6',
  approved: TEAL,
  complete: '#10B981',
};

function Header() {
  const navigate = useNavigate();
  return (
    <header className="bg-white border-b border-[#E5E7EB] h-14 flex items-center px-6 flex-shrink-0">
      <div className="max-w-6xl mx-auto w-full flex items-center gap-2.5">
        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: TEAL }}>
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 3M21 7.5H7.5" />
            </svg>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-[#111827] text-sm tracking-tight">Hub & Spoke</span>
            <span className="text-[#9CA3AF] text-sm">· Internal Linking</span>
          </div>
        </button>
      </div>
    </header>
  );
}

function CreateProjectModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [industry, setIndustry] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    if (!name.trim()) return setError('Project name is required.');
    if (!domain.trim()) return setError('Domain is required.');
    setError('');
    setSaving(true);
    try {
      const project = await hs.createProject({ name: name.trim(), domain: domain.trim(), industry, description });
      onCreate(project);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-[#111827]">Create Project</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[#374151] mb-1">Project Name <span className="text-red-500">*</span></label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="e.g. Riccobene Dental Blog Q2"
              className="w-full border border-[#E5E7EB] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#3DAA8E]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#374151] mb-1">Website Domain <span className="text-red-500">*</span></label>
            <input
              value={domain}
              onChange={e => setDomain(e.target.value)}
              placeholder="https://www.example.com"
              className="w-full border border-[#E5E7EB] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#3DAA8E]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1">Industry</label>
              <select value={industry} onChange={e => setIndustry(e.target.value)}
                className="w-full border border-[#E5E7EB] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#3DAA8E]">
                <option value="">Select…</option>
                {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#374151] mb-1">Description</label>
              <input value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Optional notes"
                className="w-full border border-[#E5E7EB] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#3DAA8E]" />
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={handleCreate} disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded-md text-white disabled:opacity-50"
            style={{ backgroundColor: TEAL }}>
            {saving ? 'Creating…' : 'Create Project'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#6B7280] hover:text-[#111827]">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ project, onDelete }) {
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e) {
    e.stopPropagation();
    setDeleting(true);
    try {
      await hs.deleteProject(project.id);
      onDelete(project.id);
    } catch { setDeleting(false); }
  }

  const statusColor = STATUS_COLORS[project.workflowState] || '#9CA3AF';
  const statusLabel = STATUS_LABELS[project.workflowState] || project.workflowState;

  return (
    <div onClick={() => navigate(`/hub-spoke/${project.id}`)}
      className="bg-white rounded-xl border border-[#E5E7EB] p-5 cursor-pointer hover:shadow-md transition-shadow group"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="text-sm font-semibold text-[#111827] truncate">{project.name}</h3>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: statusColor + '1A', color: statusColor }}>
              {statusLabel}
            </span>
          </div>
          <p className="text-xs text-[#6B7280] truncate">{project.domain}</p>
          {project.industry && <p className="text-xs text-[#9CA3AF] mt-0.5">{project.industry}</p>}
        </div>
        <div className="flex-shrink-0 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
          {confirmDelete ? (
            <>
              <span className="text-xs text-red-600">Delete?</span>
              <button onClick={handleDelete} disabled={deleting} className="text-xs font-medium text-red-600 hover:text-red-800">Yes</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-[#6B7280]">No</button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="text-xs text-[#9CA3AF] hover:text-red-500">Delete</button>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-[#9CA3AF]">
        <span>{new Date(project.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        {project.description && <span className="truncate">{project.description}</span>}
      </div>
    </div>
  );
}

export default function HubSpokePage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    hs.projects()
      .then(setProjects)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function handleCreate(project) {
    setProjects(prev => [project, ...prev]);
    setShowCreate(false);
    navigate(`/hub-spoke/${project.id}`);
  }

  return (
    <>
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-[#111827]">Hub & Spoke Projects</h1>
            <p className="text-sm text-[#6B7280] mt-0.5">Categorize content and generate internal linking recommendations</p>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg"
            style={{ backgroundColor: TEAL }}>
            + New Project
          </button>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

        {loading ? (
          <div className="py-12 text-center text-sm text-[#9CA3AF]">Loading…</div>
        ) : projects.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#E5E7EB] p-12 text-center" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
            <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: TEAL + '1A' }}>
              <svg className="w-6 h-6" style={{ color: TEAL }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 3M21 7.5H7.5" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-[#111827] mb-1">No projects yet</h2>
            <p className="text-sm text-[#6B7280] mb-4">Create your first hub and spoke project to get started.</p>
            <button onClick={() => setShowCreate(true)}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg"
              style={{ backgroundColor: TEAL }}>
              Create First Project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map(p => (
              <ProjectCard key={p.id} project={p} onDelete={id => setProjects(prev => prev.filter(x => x.id !== id))} />
            ))}
          </div>
        )}
      </main>

      {showCreate && <CreateProjectModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
    </>
  );
}
