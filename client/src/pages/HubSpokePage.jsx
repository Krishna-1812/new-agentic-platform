import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { hs } from '../lib/hubSpokeApi';

const INDUSTRIES = ['Dental', 'Healthcare', 'Legal', 'Ecommerce', 'Real Estate', 'SaaS', 'Other'];

const STATUS_LABELS = {
  input: 'Input',
  analyzing: 'Analyzing',
  reviewing: 'Review',
  approved: 'Ready',
  complete: 'Complete',
};

// Map workflow states to design-token semantic colors
const STATUS_TOKEN = {
  input: { bg: 'var(--text-3)', bgAlpha: 'var(--surface)', color: 'var(--text-3)' },
  analyzing: { bg: 'var(--warning)', bgAlpha: 'var(--warning-soft)', color: 'var(--warning)' },
  reviewing: { bg: 'var(--info)', bgAlpha: 'var(--info-soft)', color: 'var(--info)' },
  approved: { bg: 'var(--primary)', bgAlpha: 'var(--primary-soft)', color: 'var(--primary-text)' },
  complete: { bg: 'var(--success)', bgAlpha: 'var(--success-soft)', color: 'var(--success)' },
};

function Header() {
  const navigate = useNavigate();
  return (
    <header style={{
      background: 'var(--card)',
      borderBottom: '1px solid var(--border)',
      height: '3.5rem',
      display: 'flex',
      alignItems: 'center',
      padding: '0 1.5rem',
      flexShrink: 0,
    }}>
      <div style={{ maxWidth: '72rem', margin: '0 auto', width: '100%', display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
        <button
          onClick={() => navigate('/')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', background: 'none', border: 'none', cursor: 'pointer', opacity: 1, transition: 'opacity 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >
          <div style={{
            width: '1.75rem', height: '1.75rem', borderRadius: 'var(--r-md)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--primary)',
          }}>
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 3M21 7.5H7.5" />
            </svg>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.875rem', letterSpacing: '-0.01em' }}>Hub &amp; Spoke</span>
            <span style={{ color: 'var(--text-3)', fontSize: '0.875rem' }}>· Internal Linking</span>
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

  const inputStyle = {
    width: '100%',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)',
    padding: '0.5rem 0.75rem',
    fontSize: '0.875rem',
    background: 'var(--card)',
    color: 'var(--text)',
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--card)', borderRadius: 'var(--r-xl)', width: '100%', maxWidth: '32rem', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text)' }}>Create Project</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text)', marginBottom: '0.25rem' }}>
              Project Name <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="e.g. Riccobene Dental Blog Q2"
              style={inputStyle}
              onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 2px var(--primary-soft)'; }}
              onBlur={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text)', marginBottom: '0.25rem' }}>
              Website Domain <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              value={domain}
              onChange={e => setDomain(e.target.value)}
              placeholder="https://www.example.com"
              style={inputStyle}
              onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 2px var(--primary-soft)'; }}
              onBlur={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text)', marginBottom: '0.25rem' }}>Industry</label>
              <select
                value={industry}
                onChange={e => setIndustry(e.target.value)}
                style={inputStyle}
                onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 2px var(--primary-soft)'; }}
                onBlur={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }}
              >
                <option value="">Select…</option>
                {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text)', marginBottom: '0.25rem' }}>Description</label>
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Optional notes"
                style={inputStyle}
                onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 2px var(--primary-soft)'; }}
                onBlur={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }}
              />
            </div>
          </div>
        </div>

        {error && <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--danger)' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '0.5rem', paddingTop: '0.25rem' }}>
          <button
            onClick={handleCreate}
            disabled={saving}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              borderRadius: 'var(--r-md)',
              background: 'var(--primary)',
              color: '#fff',
              border: 'none',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.5 : 1,
            }}
          >
            {saving ? 'Creating…' : 'Create Project'}
          </button>
          <button
            onClick={onClose}
            style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', color: 'var(--text-2)', background: 'none', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-2)'}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ project, onDelete }) {
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [hovered, setHovered] = useState(false);

  async function handleDelete(e) {
    e.stopPropagation();
    setDeleting(true);
    try {
      await hs.deleteProject(project.id);
      onDelete(project.id);
    } catch { setDeleting(false); }
  }

  const tokenInfo = STATUS_TOKEN[project.workflowState] || STATUS_TOKEN.input;
  const statusLabel = STATUS_LABELS[project.workflowState] || project.workflowState;

  return (
    <div
      onClick={() => navigate(`/hub-spoke/${project.id}`)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--card)',
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--border)',
        padding: '1.25rem',
        cursor: 'pointer',
        boxShadow: hovered ? '0 4px 12px rgba(0,0,0,0.1)' : '0 1px 3px rgba(0,0,0,0.07)',
        transition: 'box-shadow 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
            <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {project.name}
            </h3>
            <span style={{
              fontSize: '0.75rem',
              fontWeight: 500,
              padding: '0.125rem 0.5rem',
              borderRadius: '9999px',
              flexShrink: 0,
              background: tokenInfo.bgAlpha,
              color: tokenInfo.color,
            }}>
              {statusLabel}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.domain}</p>
          {project.industry && <p style={{ margin: '0.125rem 0 0', fontSize: '0.75rem', color: 'var(--text-3)' }}>{project.industry}</p>}
        </div>
        <div
          style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: hovered ? 1 : 0, transition: 'opacity 0.15s' }}
          onClick={e => e.stopPropagation()}
        >
          {confirmDelete ? (
            <>
              <span style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>Delete?</span>
              <button onClick={handleDelete} disabled={deleting} style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer' }}>Yes</button>
              <button onClick={() => setConfirmDelete(false)} style={{ fontSize: '0.75rem', color: 'var(--text-2)', background: 'none', border: 'none', cursor: 'pointer' }}>No</button>
            </>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              style={{ fontSize: '0.75rem', color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}
            >
              Delete
            </button>
          )}
        </div>
      </div>
      <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.75rem', color: 'var(--text-3)' }}>
        <span>{new Date(project.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        {project.description && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.description}</span>}
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
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <main style={{ flex: 1, maxWidth: '72rem', margin: '0 auto', width: '100%', padding: '2rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--text)' }}>Hub &amp; Spoke Projects</h1>
            <p style={{ margin: '0.125rem 0 0', fontSize: '0.875rem', color: 'var(--text-2)' }}>Categorize content and generate internal linking recommendations</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#fff',
              background: 'var(--primary)',
              border: 'none',
              borderRadius: 'var(--r-lg)',
              cursor: 'pointer',
            }}
          >
            + New Project
          </button>
        </div>

        {error && (
          <div style={{
            marginBottom: '1rem',
            padding: '0.75rem',
            background: 'var(--danger-soft)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--r-lg)',
            fontSize: '0.875rem',
            color: 'var(--danger)',
          }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: '3rem 0', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-3)' }}>Loading…</div>
        ) : projects.length === 0 ? (
          <div style={{
            background: 'var(--card)',
            borderRadius: 'var(--r-xl)',
            border: '1px solid var(--border)',
            padding: '3rem',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
          }}>
            <div style={{
              width: '3rem', height: '3rem', borderRadius: 'var(--r-xl)',
              margin: '0 auto 1rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--primary-soft)',
            }}>
              <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="var(--primary)" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 3M21 7.5H7.5" />
              </svg>
            </div>
            <h2 style={{ margin: '0 0 0.25rem', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)' }}>No projects yet</h2>
            <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: 'var(--text-2)' }}>Create your first hub and spoke project to get started.</p>
            <button
              onClick={() => setShowCreate(true)}
              style={{
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: '#fff',
                background: 'var(--primary)',
                border: 'none',
                borderRadius: 'var(--r-lg)',
                cursor: 'pointer',
              }}
            >
              Create First Project
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
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
