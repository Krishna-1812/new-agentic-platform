import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { rm } from '../lib/robotsMonitorApi';

const TEAL = '#3DAA8E';

// ── Icons ─────────────────────────────────────────────────────────────────────

function RobotIcon({ className = 'w-4 h-4' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
    </svg>
  );
}

function ChevronDown({ className = 'w-4 h-4' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function ChevronUp({ className = 'w-4 h-4' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function Header() {
  const navigate = useNavigate();
  return (
    <header className="bg-white border-b border-[#E5E7EB] h-14 flex items-center px-6 flex-shrink-0">
      <div className="max-w-5xl mx-auto w-full flex items-center gap-2.5">
        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: TEAL }}>
            <RobotIcon className="w-4 h-4 text-white" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-[#111827] text-sm tracking-tight">Robots Monitor</span>
            <span className="text-[#9CA3AF] text-sm">· Arena</span>
          </div>
        </button>
      </div>
    </header>
  );
}

// ── Toast banner ──────────────────────────────────────────────────────────────

function Toast({ message, type = 'error', onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  const bg = type === 'error' ? 'bg-red-50 border-red-200 text-red-800'
    : type === 'success' ? 'bg-green-50 border-green-200 text-green-800'
    : 'bg-blue-50 border-blue-200 text-blue-800';
  return (
    <div className={`fixed top-4 right-4 z-50 border rounded-lg px-4 py-3 text-sm max-w-md shadow-md ${bg}`}>
      <div className="flex items-start gap-2">
        <span className="flex-1">{message}</span>
        <button onClick={onClose} className="flex-shrink-0 opacity-60 hover:opacity-100">✕</button>
      </div>
    </div>
  );
}

// ── Nav tabs ──────────────────────────────────────────────────────────────────

function MonitorNav({ active, onChange }) {
  const tabs = [
    { id: 'clients', label: 'Clients' },
    { id: 'history', label: 'History' },
    { id: 'settings', label: 'Settings' },
  ];
  return (
    <div className="border-b border-[#E5E7EB] bg-white">
      <div className="max-w-5xl mx-auto px-6 flex gap-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              active === tab.id
                ? 'border-[#3DAA8E] text-[#3DAA8E]'
                : 'border-transparent text-[#6B7280] hover:text-[#111827]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Domain form ───────────────────────────────────────────────────────────────

function DomainForm({ onSave, onCancel, initial = {} }) {
  const [url, setUrl] = useState(initial.url || '');
  const [env, setEnv] = useState(initial.env || 'production');
  const [useAuth, setUseAuth] = useState(!!initial.auth);
  const [username, setUsername] = useState(initial.auth?.username || '');
  const [password, setPassword] = useState(initial.auth?.password || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function validateUrl(val) {
    try {
      const u = new URL(val);
      if (!['http:', 'https:'].includes(u.protocol)) return 'URL must start with http:// or https://';
      if (u.pathname.replace(/\/$/, '').length > 0) return 'Subfolders are not supported — use the subdomain only (e.g., staging.example.com)';
      return null;
    } catch {
      return 'Enter a valid URL';
    }
  }

  async function handleSave() {
    const urlErr = validateUrl(url);
    if (urlErr) return setError(urlErr);
    if (useAuth && (!username.trim() || !password)) return setError('Username and password are required for basic auth');
    setError('');
    setSaving(true);
    try {
      await onSave({ url, env, auth: useAuth ? { username: username.trim(), password } : null });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-[#E5E7EB] rounded-lg p-4 bg-[#F9FAFB] space-y-3">
      <div>
        <label className="block text-xs font-medium text-[#374151] mb-1">Domain URL</label>
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://example.com"
          className="w-full text-sm border border-[#D1D5DB] rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#3DAA8E]"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-[#374151] mb-1">Environment</label>
        <div className="flex gap-4">
          {['production', 'staging'].map(e => (
            <label key={e} className="flex items-center gap-1.5 cursor-pointer text-sm text-[#374151]">
              <input type="radio" name="env" value={e} checked={env === e} onChange={() => setEnv(e)} className="accent-[#3DAA8E]" />
              {e.charAt(0).toUpperCase() + e.slice(1)}
            </label>
          ))}
        </div>
      </div>
      <div>
        <label className="flex items-center gap-2 cursor-pointer text-sm text-[#374151]">
          <input type="checkbox" checked={useAuth} onChange={e => setUseAuth(e.target.checked)} className="accent-[#3DAA8E]" />
          This domain requires basic auth
        </label>
      </div>
      {useAuth && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#374151] mb-1">Username</label>
            <input value={username} onChange={e => setUsername(e.target.value)} className="w-full text-sm border border-[#D1D5DB] rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#3DAA8E]" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#374151] mb-1">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full text-sm border border-[#D1D5DB] rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#3DAA8E]" />
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 text-xs font-medium rounded-md text-white" style={{ backgroundColor: TEAL }}>
          {saving ? 'Saving…' : 'Save Domain'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 text-xs font-medium rounded-md text-[#374151] border border-[#D1D5DB] hover:bg-[#F9FAFB]">Cancel</button>
      </div>
    </div>
  );
}

// ── Domain row ────────────────────────────────────────────────────────────────

function DomainRow({ domain, clientId, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toggling, setToggling] = useState(false);

  async function handleToggle() {
    setToggling(true);
    try {
      const updated = await rm.updateDomain(clientId, domain.id, { enabled: !domain.enabled });
      onUpdate(updated);
    } finally {
      setToggling(false);
    }
  }

  async function handleSave(fields) {
    const updated = await rm.updateDomain(clientId, domain.id, fields);
    onUpdate(updated);
    setEditing(false);
  }

  async function handleDelete() {
    await rm.deleteDomain(clientId, domain.id);
    onDelete(domain.id);
  }

  if (editing) {
    return <DomainForm initial={domain} onSave={handleSave} onCancel={() => setEditing(false)} />;
  }

  return (
    <div className={`flex items-center gap-3 py-2.5 px-3 rounded-lg ${domain.enabled ? '' : 'opacity-50'}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[#111827] truncate">{domain.url}</span>
          {domain.auth && <LockIcon />}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            domain.env === 'production' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
          }`}>
            {domain.env}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Toggle */}
        <button
          onClick={handleToggle}
          disabled={toggling}
          title={domain.enabled ? 'Disable' : 'Enable'}
          className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${domain.enabled ? 'bg-[#3DAA8E]' : 'bg-gray-200'}`}
        >
          <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${domain.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
        <button onClick={() => setEditing(true)} className="text-xs text-[#6B7280] hover:text-[#111827]">Edit</button>
        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <span className="text-xs text-red-600">Delete?</span>
            <button onClick={handleDelete} className="text-xs font-medium text-red-600 hover:text-red-800">Yes</button>
            <button onClick={() => setConfirmDelete(false)} className="text-xs text-[#6B7280]">No</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="text-xs text-[#6B7280] hover:text-red-600">Delete</button>
        )}
      </div>
    </div>
  );
}

// ── Client card ───────────────────────────────────────────────────────────────

function ClientCard({ client, onChange, onDelete }) {
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(client.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingDomain, setAddingDomain] = useState(false);
  const [domains, setDomains] = useState(client.domains || []);
  const [nameError, setNameError] = useState('');

  async function saveName() {
    if (!nameVal.trim()) return setNameError('Name is required');
    try {
      await rm.updateClient(client.id, { name: nameVal.trim() });
      onChange({ ...client, name: nameVal.trim() });
      setEditingName(false);
      setNameError('');
    } catch (e) {
      setNameError(e.message);
    }
  }

  async function handleAddDomain(fields) {
    const domain = await rm.addDomain(client.id, fields);
    setDomains(prev => [...prev, domain]);
    setAddingDomain(false);
  }

  function handleDomainUpdate(updated) {
    setDomains(prev => prev.map(d => d.id === updated.id ? updated : d));
  }

  function handleDomainDelete(domainId) {
    setDomains(prev => prev.filter(d => d.id !== domainId));
  }

  async function handleDeleteClient() {
    await rm.deleteClient(client.id);
    onDelete(client.id);
  }

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 space-y-3" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
      {/* Client header */}
      <div className="flex items-center justify-between">
        {editingName ? (
          <div className="flex items-center gap-2 flex-1">
            <input
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
              autoFocus
              className="flex-1 text-sm font-semibold border border-[#D1D5DB] rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#3DAA8E]"
            />
            <button onClick={saveName} className="text-xs text-[#3DAA8E] font-medium">Save</button>
            <button onClick={() => { setEditingName(false); setNameVal(client.name); }} className="text-xs text-[#6B7280]">Cancel</button>
            {nameError && <span className="text-xs text-red-600">{nameError}</span>}
          </div>
        ) : (
          <h3 className="font-semibold text-[#111827] text-sm">{client.name}</h3>
        )}
        <div className="flex items-center gap-2 ml-3">
          {!editingName && <button onClick={() => setEditingName(true)} className="text-xs text-[#6B7280] hover:text-[#111827]">Rename</button>}
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-red-600">Delete client + all domains?</span>
              <button onClick={handleDeleteClient} className="text-xs font-medium text-red-600 hover:text-red-800">Yes</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-[#6B7280]">No</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="text-xs text-[#6B7280] hover:text-red-600">Delete</button>
          )}
        </div>
      </div>

      {/* Domains */}
      {domains.length > 0 ? (
        <div className="space-y-1 border-t border-[#F3F4F6] pt-3">
          {domains.map(d => (
            <DomainRow
              key={d.id}
              domain={d}
              clientId={client.id}
              onUpdate={handleDomainUpdate}
              onDelete={handleDomainDelete}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-[#9CA3AF] py-1">No domains yet — add one below.</p>
      )}

      {/* Add domain */}
      {addingDomain ? (
        <DomainForm onSave={handleAddDomain} onCancel={() => setAddingDomain(false)} />
      ) : (
        <button
          onClick={() => setAddingDomain(true)}
          className="text-xs font-medium text-[#3DAA8E] hover:opacity-80 flex items-center gap-1"
        >
          <span className="text-base leading-none">+</span> Add Domain
        </button>
      )}
    </div>
  );
}

// ── Clients tab ───────────────────────────────────────────────────────────────

function ClientsTab({ showToast }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addingClient, setAddingClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [addError, setAddError] = useState('');

  useEffect(() => {
    rm.clients()
      .then(setClients)
      .catch(e => showToast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, []);

  async function handleAddClient() {
    if (!newClientName.trim()) return setAddError('Name is required');
    try {
      const client = await rm.addClient({ name: newClientName.trim() });
      setClients(prev => [...prev, { ...client, domains: [] }]);
      setNewClientName('');
      setAddingClient(false);
      setAddError('');
    } catch (e) {
      setAddError(e.message);
    }
  }

  if (loading) return <div className="py-12 text-center text-sm text-[#9CA3AF]">Loading…</div>;

  return (
    <div className="space-y-4">
      {clients.length === 0 && !addingClient && (
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-8 text-center">
          <p className="text-sm text-[#6B7280] mb-3">No clients yet — add one to get started.</p>
          <button onClick={() => setAddingClient(true)} className="px-4 py-2 text-sm font-medium rounded-lg text-white" style={{ backgroundColor: TEAL }}>
            Add Client
          </button>
        </div>
      )}

      {clients.map(c => (
        <ClientCard
          key={c.id}
          client={c}
          onChange={updated => setClients(prev => prev.map(x => x.id === updated.id ? updated : x))}
          onDelete={id => setClients(prev => prev.filter(x => x.id !== id))}
        />
      ))}

      {addingClient ? (
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 space-y-3">
          <label className="block text-xs font-medium text-[#374151]">Client Name</label>
          <input
            value={newClientName}
            onChange={e => setNewClientName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddClient(); if (e.key === 'Escape') setAddingClient(false); }}
            autoFocus
            placeholder="e.g. Riccobene Associates"
            className="w-full text-sm border border-[#D1D5DB] rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#3DAA8E]"
          />
          {addError && <p className="text-xs text-red-600">{addError}</p>}
          <div className="flex gap-2">
            <button onClick={handleAddClient} className="px-3 py-1.5 text-xs font-medium rounded-md text-white" style={{ backgroundColor: TEAL }}>Add Client</button>
            <button onClick={() => { setAddingClient(false); setNewClientName(''); setAddError(''); }} className="px-3 py-1.5 text-xs font-medium rounded-md text-[#374151] border border-[#D1D5DB]">Cancel</button>
          </div>
        </div>
      ) : clients.length > 0 && (
        <button onClick={() => setAddingClient(true)} className="text-sm font-medium text-[#3DAA8E] hover:opacity-80">
          + Add Client
        </button>
      )}
    </div>
  );
}

// ── Run detail panel ──────────────────────────────────────────────────────────

function SitemapBadge({ status, error }) {
  if (status === 'found') return <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">Sitemap found</span>;
  if (status === 'not-found') return <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">No sitemap — homepage only</span>;
  return <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded-full">Sitemap error{error ? `: ${error}` : ''}</span>;
}

const SIGNAL_LABELS = {
  'x-robots-header': 'X-Robots-Tag',
  'meta-tag': 'meta robots',
  'both': 'X-Robots-Tag + meta',
};

function PageResultRow({ page, env }) {
  const isIssue = page.error ? false
    : env === 'production' ? page.noindex
    : !page.noindex;

  const signalLabel = page.signal ? (SIGNAL_LABELS[page.signal] || page.signal) : 'no noindex';

  return (
    <div className="flex items-start gap-2 py-1.5 text-xs border-b border-[#F3F4F6] last:border-0">
      <span className={`mt-0.5 flex-shrink-0 font-bold ${isIssue ? 'text-red-500' : 'text-green-500'}`}>
        {isIssue ? '✗' : '✓'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-mono text-[#374151] truncate max-w-xs">{page.url}</span>
          <span className="text-[#9CA3AF]">·</span>
          <span className="text-[#9CA3AF]">{page.pageType}</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
            page.noindex ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500'
          }`}>
            {signalLabel}
          </span>
          {page.httpStatus && page.httpStatus !== 200 && (
            <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-[10px]">HTTP {page.httpStatus}</span>
          )}
        </div>
        {page.redirected && page.finalUrl !== page.url && (
          <div className="text-[#9CA3AF] mt-0.5">↳ {page.finalUrl}</div>
        )}
        {page.error && <div className="text-red-500 mt-0.5">{page.error}</div>}
      </div>
    </div>
  );
}

function DomainResultSection({ domain }) {
  return (
    <div className="border border-[#E5E7EB] rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-[#111827]">{domain.url}</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
          domain.env === 'production' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
        }`}>{domain.env}</span>
        <SitemapBadge status={domain.sitemapStatus} error={domain.error} />
      </div>
      {domain.issues?.length > 0 && (
        <div className="text-xs font-medium text-red-600">{domain.issues.length} issue{domain.issues.length !== 1 ? 's' : ''} found</div>
      )}
      {domain.pagesChecked?.length > 0 && (
        <div className="mt-1">
          {domain.pagesChecked.map((p, i) => <PageResultRow key={i} page={p} env={domain.env} />)}
        </div>
      )}
    </div>
  );
}

function RunDetailPanel({ runId }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    rm.runDetail(runId).then(setDetail).finally(() => setLoading(false));
  }, [runId]);

  if (loading) return <div className="py-4 text-xs text-[#9CA3AF]">Loading run detail…</div>;
  if (!detail) return <div className="py-4 text-xs text-red-500">Failed to load run detail.</div>;

  const durationSec = Math.round((detail.durationMs || 0) / 1000);

  return (
    <div className="mt-3 space-y-4">
      {(detail.clients || []).map(client => (
        <div key={client.clientId}>
          <h4 className="text-xs font-semibold text-[#374151] mb-2 uppercase tracking-wide">{client.clientName}</h4>
          <div className="space-y-2">
            {(client.domains || []).map(d => <DomainResultSection key={d.domainId} domain={d} />)}
          </div>
        </div>
      ))}
      <div className="text-xs text-[#9CA3AF] pt-1">
        Run ID: <span className="font-mono">{detail.runId}</span> · {detail.summary?.totalPagesChecked || 0} pages · {durationSec}s
      </div>
    </div>
  );
}

// ── History tab ───────────────────────────────────────────────────────────────

function RunSummaryRow({ run }) {
  const [expanded, setExpanded] = useState(false);
  const issueCount = run.summary?.issuesFound || 0;
  const date = new Date(run.startedAt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="border border-[#E5E7EB] rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
      <button
        onClick={() => setExpanded(x => !x)}
        className="w-full flex items-center justify-between px-5 py-4 bg-white hover:bg-[#F9FAFB] transition-colors text-left"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-[#111827]">{date}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            run.triggeredBy === 'manual' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'
          }`}>{run.triggeredBy === 'manual' ? 'Manual' : 'Scheduled'}</span>
          <span className="text-xs text-[#6B7280]">{run.summary?.totalDomains || 0} domains</span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            issueCount > 0 ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
          }`}>
            {issueCount > 0 ? `${issueCount} issue${issueCount !== 1 ? 's' : ''}` : 'Clean'}
          </span>
        </div>
        <span className="text-[#9CA3AF] flex-shrink-0 ml-2">
          {expanded ? <ChevronUp /> : <ChevronDown />}
        </span>
      </button>
      {expanded && (
        <div className="px-5 pb-5 bg-white border-t border-[#F3F4F6]">
          <RunDetailPanel runId={run.runId} />
        </div>
      )}
    </div>
  );
}

function HistoryTab({ showToast }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [currentRunId, setCurrentRunId] = useState(null);
  const pollRef = useRef(null);

  const fetchHistory = useCallback(() => {
    rm.history(30).then(setHistory).catch(() => {});
  }, []);

  useEffect(() => {
    rm.history(30).then(setHistory).catch(e => showToast(e.message, 'error')).finally(() => setLoading(false));
    rm.runStatus().then(s => { setIsRunning(s.isRunning); setCurrentRunId(s.currentRunId); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (isRunning) {
      pollRef.current = setInterval(async () => {
        try {
          const s = await rm.runStatus();
          setIsRunning(s.isRunning);
          setCurrentRunId(s.currentRunId);
          if (!s.isRunning) {
            clearInterval(pollRef.current);
            fetchHistory();
          }
        } catch { /* ignore */ }
      }, 3000);
    }
    return () => clearInterval(pollRef.current);
  }, [isRunning, fetchHistory]);

  async function handleRun() {
    if (isRunning) return;
    try {
      const res = await rm.triggerRun();
      setIsRunning(true);
      setCurrentRunId(res.runId);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  return (
    <div className="space-y-4">
      {/* Run controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleRun}
          disabled={isRunning}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white disabled:opacity-60 transition-opacity"
          style={{ backgroundColor: TEAL }}
        >
          {isRunning ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Checking…
            </>
          ) : 'Run Now'}
        </button>
        {isRunning && (
          <span className="text-xs text-[#6B7280]">Run in progress — polling for completion…</span>
        )}
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-[#9CA3AF]">Loading history…</div>
      ) : history.length === 0 ? (
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-8 text-center">
          <p className="text-sm text-[#6B7280]">No runs yet. Click "Run Now" or wait for the scheduled run.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map(run => <RunSummaryRow key={run.runId} run={run} />)}
        </div>
      )}
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────────

const COMMON_TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore',
  'Asia/Tokyo', 'Australia/Sydney',
];

function SettingsTab({ showToast }) {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({ webhookUrl: '', channel: '', scheduleTime: '06:00', timezone: 'Asia/Kolkata', enabled: true });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [errors, setErrors] = useState({});

  useEffect(() => {
    rm.slackConfig()
      .then(c => { setConfig(c); setForm({ webhookUrl: c.webhookUrl || '', channel: c.channel || '', scheduleTime: c.scheduleTime || '06:00', timezone: c.timezone || 'Asia/Kolkata', enabled: c.enabled !== false }); })
      .catch(e => showToast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, []);

  function validate() {
    const errs = {};
    if (form.webhookUrl && !form.webhookUrl.includes('*') && !form.webhookUrl.startsWith('https://hooks.slack.com/')) {
      errs.webhookUrl = 'Must start with https://hooks.slack.com/';
    }
    if (form.scheduleTime && !/^\d{1,2}:\d{2}$/.test(form.scheduleTime)) {
      errs.scheduleTime = 'Use HH:MM format';
    }
    return errs;
  }

  async function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length) return setErrors(errs);
    setErrors({});
    setSaving(true);
    setSaveMsg('');
    try {
      await rm.saveSlackConfig(form);
      setSaveMsg('Settings saved.');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestMsg('');
    try {
      await rm.testSlack();
      setTestMsg('✅ Test message sent successfully.');
    } catch (e) {
      setTestMsg(`❌ ${e.message}`);
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <div className="py-12 text-center text-sm text-[#9CA3AF]">Loading…</div>;

  return (
    <div className="space-y-6 max-w-lg">
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-[#111827]">Slack Alerts</h3>

        <div>
          <label className="block text-xs font-medium text-[#374151] mb-1">Webhook URL</label>
          <input
            type="text"
            value={form.webhookUrl}
            onChange={e => setForm(f => ({ ...f, webhookUrl: e.target.value }))}
            placeholder="https://hooks.slack.com/services/…"
            className="w-full text-sm border border-[#D1D5DB] rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#3DAA8E]"
          />
          {errors.webhookUrl && <p className="text-xs text-red-600 mt-1">{errors.webhookUrl}</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-[#374151] mb-1">Channel (optional)</label>
          <input
            value={form.channel}
            onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}
            placeholder="#seo-alerts"
            className="w-full text-sm border border-[#D1D5DB] rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#3DAA8E]"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#374151] mb-1">Daily Run Time (24h)</label>
            <input
              value={form.scheduleTime}
              onChange={e => setForm(f => ({ ...f, scheduleTime: e.target.value }))}
              placeholder="06:00"
              className="w-full text-sm border border-[#D1D5DB] rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#3DAA8E]"
            />
            {errors.scheduleTime && <p className="text-xs text-red-600 mt-1">{errors.scheduleTime}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-[#374151] mb-1">Timezone</label>
            <select
              value={form.timezone}
              onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
              className="w-full text-sm border border-[#D1D5DB] rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#3DAA8E]"
            >
              {COMMON_TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
            className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${form.enabled ? 'bg-[#3DAA8E]' : 'bg-gray-200'}`}
          >
            <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${form.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
          <span className="text-sm text-[#374151]">Send Slack alerts</span>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm font-medium rounded-lg text-white" style={{ backgroundColor: TEAL }}>
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          <button onClick={handleTest} disabled={testing} className="px-4 py-2 text-sm font-medium rounded-lg text-[#374151] border border-[#D1D5DB] hover:bg-[#F9FAFB]">
            {testing ? 'Sending…' : 'Send Test Message'}
          </button>
        </div>

        {saveMsg && <p className="text-xs text-green-700">{saveMsg}</p>}
        {testMsg && <p className={`text-xs ${testMsg.startsWith('✅') ? 'text-green-700' : 'text-red-600'}`}>{testMsg}</p>}
      </div>

      <div className="bg-[#FFFBEB] border border-yellow-200 rounded-xl p-4 text-xs text-yellow-800 space-y-1">
        <p className="font-semibold">History retention note</p>
        <p>Run history is retained for 90 days. Older files are automatically pruned after each run.</p>
      </div>

      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-800 space-y-1">
        <p className="font-semibold">Security notice</p>
        <p>Client credentials and the Slack webhook URL are stored in plaintext on disk. Ensure <code className="bg-red-100 px-1 rounded">modules/robotsMonitor/data/</code> is excluded from version control.</p>
      </div>
    </div>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────────

export default function RobotsMonitorPage() {
  const [tab, setTab] = useState('clients');
  const [toast, setToast] = useState(null);

  function showToast(message, type = 'error') {
    setToast({ message, type });
  }

  return (
    <>
      <MonitorNav active={tab} onChange={setTab} />

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-6">
        {tab === 'clients' && <ClientsTab showToast={showToast} />}
        {tab === 'history' && <HistoryTab showToast={showToast} />}
        {tab === 'settings' && <SettingsTab showToast={showToast} />}
      </main>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </>
  );
}
