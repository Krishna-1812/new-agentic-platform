import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { hs, openStream, xlsxToBase64 } from '../lib/hubSpokeApi';

const TEAL = '#3DAA8E';

// ── Helpers ───────────────────────────────────────────────────────────────────

function stateToScreen(ws) {
  if (!ws || ws === 'input') return 'input';
  if (ws === 'analyzing') return 'analyzing';
  if (ws === 'reviewing' || ws === 'approved') return 'reviewing';
  if (ws === 'complete') return 'results';
  return 'input';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const LINK_TYPE_LABELS = {
  'hub-to-spoke': 'Hub → Spoke',
  'spoke-to-hub': 'Spoke → Hub',
  'spoke-to-spoke': 'Spoke ↔ Spoke',
  'cross-cluster': 'Cross-Cluster',
};

const PRIORITY_COLORS = { high: '#EF4444', medium: '#F59E0B', low: '#9CA3AF' };

const ANCHOR_SOURCE_BADGE = {
  'existing-content':      { label: 'Found in content',    cls: 'bg-green-50 text-green-700' },
  'new-sentence-required': { label: 'New sentence req.',   cls: 'bg-amber-50 text-amber-700' },
  'existing-link':         { label: 'Already linked',      cls: 'bg-blue-50 text-blue-600' },
  'page-unavailable':      { label: 'Page unavailable',    cls: 'bg-red-50 text-red-600' },
};

const ANCHOR_WARNING_LABELS = {
  'anchor-too-short':            'Too short (< 2 words)',
  'anchor-too-long':             'Too long (> 10 words)',
  'generic-phrase':              'Generic phrase',
  'duplicate-anchor-diff-target':'Duplicate anchor → diff target',
  'anchor-overused-for-target':  'Anchor used > 3× for target',
  'high-link-density':           'High link density on source',
  'exact-title-match':           'Exact title match',
  'page-unavailable':            'Source page unavailable',
  'anchor-not-in-context':       'Anchor not in context sentence',
  'geo-specific-target':         'Geo-specific target (hub→location page)',
};

// ── Header ────────────────────────────────────────────────────────────────────

function Header({ project }) {
  const navigate = useNavigate();
  return (
    <header className="bg-white border-b border-[#E5E7EB] h-14 flex items-center px-6 flex-shrink-0">
      <div className="max-w-7xl mx-auto w-full flex items-center gap-3">
        <button onClick={() => navigate('/hub-spoke')}
          className="text-[#9CA3AF] hover:text-[#374151] flex items-center gap-1.5 text-sm">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Projects
        </button>
        <span className="text-[#E5E7EB]">/</span>
        <span className="text-sm font-semibold text-[#111827] truncate max-w-xs">{project?.name || '…'}</span>
        {project?.domain && (
          <>
            <span className="text-[#E5E7EB]">·</span>
            <span className="text-xs text-[#9CA3AF] truncate">{project.domain}</span>
          </>
        )}
      </div>
    </header>
  );
}

// ── Stepper ───────────────────────────────────────────────────────────────────

const STEPS = [
  { key: 'input', label: 'Input' },
  { key: 'reviewing', label: 'Review' },
  { key: 'results', label: 'Recommendations' },
];

function Stepper({ screen }) {
  const active = screen === 'analyzing' ? 'reviewing' : screen === 'generating' ? 'results' : screen;
  const activeIdx = STEPS.findIndex(s => s.key === active);
  return (
    <div className="bg-white border-b border-[#E5E7EB] px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center gap-0">
        {STEPS.map((step, i) => {
          const done = i < activeIdx;
          const current = i === activeIdx;
          return (
            <div key={step.key} className="flex items-center">
              <div className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  done ? 'bg-[#3DAA8E] text-white' :
                  current ? 'bg-[#3DAA8E] text-white ring-2 ring-[#3DAA8E] ring-offset-2' :
                  'bg-[#F3F4F6] text-[#9CA3AF]'
                }`}>
                  {done ? '✓' : i + 1}
                </div>
                <span className={`text-sm font-medium ${current ? 'text-[#111827]' : done ? 'text-[#3DAA8E]' : 'text-[#9CA3AF]'}`}>
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`mx-4 h-px w-16 ${i < activeIdx ? 'bg-[#3DAA8E]' : 'bg-[#E5E7EB]'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── SSE Progress Display ──────────────────────────────────────────────────────

function ProgressDisplay({ steps, title }) {
  return (
    <div className="max-w-lg mx-auto py-16">
      <h2 className="text-base font-semibold text-[#111827] mb-6">{title}</h2>
      <div className="space-y-3">
        {steps.map((step, i) => (
          <div key={step.id + i} className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              {step.status === 'done' ? (
                <div className="w-5 h-5 rounded-full bg-[#3DAA8E] flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : step.status === 'active' ? (
                <div className="w-5 h-5 rounded-full border-2 border-[#3DAA8E] border-t-transparent animate-spin" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-[#F3F4F6]" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm ${step.status === 'done' ? 'text-[#374151]' : step.status === 'active' ? 'text-[#111827] font-medium' : 'text-[#9CA3AF]'}`}>
                {step.message}
              </p>
              {step.url && (
                <p className="text-xs text-[#9CA3AF] truncate mt-0.5">{step.url}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Input Screen ──────────────────────────────────────────────────────────────

function InputScreen({ project, onXlsxParsed, onAnalyzeStarted }) {
  const [mode, setMode] = useState('xlsx');
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [urlText, setUrlText] = useState('');
  const [classification, setClassification] = useState(null);
  const [classifyTimer, setClassifyTimer] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');
  const fileInputRef = useRef();

  async function processFile(file) {
    if (!file) return;
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setUploadError('Please upload an XLSX or XLS file.');
      return;
    }
    setUploadError('');
    setUploading(true);
    try {
      const fileData = await xlsxToBase64(file);
      const result = await hs.parseXlsx(project.id, { fileData, fileName: file.name });
      onXlsxParsed(result);
    } catch (e) {
      setUploadError(e.message);
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    processFile(file);
  }

  function handleUrlTextChange(text) {
    setUrlText(text);
    setAnalyzeError('');
    if (classifyTimer) clearTimeout(classifyTimer);
    if (!text.trim()) { setClassification(null); return; }
    const timer = setTimeout(async () => {
      try {
        const result = await hs.classifyInput(project.id, { text });
        setClassification(result);
      } catch { setClassification(null); }
    }, 600);
    setClassifyTimer(timer);
  }

  async function handleAnalyze() {
    if (!classification || !classification.urls?.length) return;
    setAnalyzeError('');
    setAnalyzing(true);
    try {
      const { token } = await hs.startAnalyze(project.id, { urls: classification.urls });
      onAnalyzeStarted(token, classification.urls.length);
    } catch (e) {
      setAnalyzeError(e.message);
      setAnalyzing(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-10">
      <h2 className="text-lg font-bold text-[#111827] mb-1">Add Content Structure</h2>
      <p className="text-sm text-[#6B7280] mb-6">Upload an existing hub and spoke document, or enter URLs to auto-categorize with AI.</p>

      {/* Mode toggle */}
      <div className="flex bg-[#F3F4F6] rounded-lg p-1 mb-6 w-fit">
        <button onClick={() => setMode('xlsx')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${mode === 'xlsx' ? 'bg-white text-[#111827] shadow-sm' : 'text-[#6B7280] hover:text-[#374151]'}`}>
          Upload XLSX
        </button>
        <button onClick={() => setMode('urls')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${mode === 'urls' ? 'bg-white text-[#111827] shadow-sm' : 'text-[#6B7280] hover:text-[#374151]'}`}>
          Enter URLs
        </button>
      </div>

      {mode === 'xlsx' ? (
        <div>
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
              dragging ? 'border-[#3DAA8E] bg-[#3DAA8E08]' : 'border-[#E5E7EB] hover:border-[#3DAA8E] hover:bg-[#3DAA8E08]'
            }`}>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => processFile(e.target.files[0])} />
            {uploading ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-6 h-6 border-2 border-[#3DAA8E] border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-[#6B7280]">Parsing XLSX…</p>
              </div>
            ) : (
              <>
                <svg className="w-8 h-8 text-[#9CA3AF] mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <p className="text-sm font-medium text-[#374151]">Drop XLSX file here, or click to browse</p>
                <p className="text-xs text-[#9CA3AF] mt-1">Supports hub and spoke spreadsheets with HUB:/spoke format</p>
              </>
            )}
          </div>
          {uploadError && <p className="mt-2 text-sm text-red-600">{uploadError}</p>}
        </div>
      ) : (
        <div>
          <textarea
            value={urlText}
            onChange={e => handleUrlTextChange(e.target.value)}
            placeholder="Paste URLs here, one per line&#10;&#10;https://example.com/blog/post-1&#10;https://example.com/services/dental-cleaning&#10;https://example.com/about"
            rows={12}
            className="w-full border border-[#E5E7EB] rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#3DAA8E] resize-none"
          />
          {classification && (
            <div className="mt-3 p-3 bg-[#F9FAFB] rounded-lg border border-[#E5E7EB] flex items-center gap-4 text-sm">
              <span className="font-medium text-[#374151]">{classification.urlCount} URLs detected</span>
              {classification.type === 'hub-and-spoke-complete' && (
                <span className="text-xs px-2 py-0.5 bg-[#3DAA8E1A] text-[#3DAA8E] rounded-full font-medium">Hub & Spoke structure found</span>
              )}
              {classification.type === 'url-list-only' && (
                <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium">AI categorization will be applied</span>
              )}
              {classification.type === 'mixed' && (
                <span className="text-xs px-2 py-0.5 bg-yellow-50 text-yellow-700 rounded-full font-medium">Mixed content — AI will categorize</span>
              )}
              {classification.type === 'invalid' && (
                <span className="text-xs px-2 py-0.5 bg-red-50 text-red-700 rounded-full font-medium">No valid URLs found</span>
              )}
            </div>
          )}
          {analyzeError && <p className="mt-2 text-sm text-red-600">{analyzeError}</p>}
          <div className="mt-4">
            <button
              onClick={handleAnalyze}
              disabled={!classification?.urlCount || classification?.type === 'invalid' || analyzing}
              className="px-5 py-2.5 text-sm font-medium text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: TEAL }}>
              {analyzing ? 'Starting…' : `Analyze ${classification?.urlCount || ''} URLs with AI`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Review Screen ─────────────────────────────────────────────────────────────

function ClusterCard({ cluster }) {
  const [open, setOpen] = useState(true);
  const spokes = cluster.spokes || [];
  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full text-left px-5 py-4 flex items-center gap-3 hover:bg-[#F9FAFB] transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[#111827]">{cluster.clusterName}</span>
            {cluster.hubPage?.isGap && (
              <span className="text-xs px-1.5 py-0.5 bg-orange-50 text-orange-700 rounded font-medium">GAP</span>
            )}
            {cluster.hubPage?.hubStatus === 'gap' && (
              <span className="text-xs px-1.5 py-0.5 bg-orange-50 text-orange-700 rounded font-medium">GAP</span>
            )}
            <span className="text-xs text-[#9CA3AF]">{spokes.length} spoke{spokes.length !== 1 ? 's' : ''}</span>
          </div>
          {cluster.hubPage?.url && (
            <p className="text-xs text-[#6B7280] mt-0.5 truncate">{cluster.hubPage.url}</p>
          )}
          {cluster.primaryKeyword && (
            <p className="text-xs text-[#9CA3AF] mt-0.5">Primary keyword: {cluster.primaryKeyword}</p>
          )}
        </div>
        <svg className={`w-4 h-4 text-[#9CA3AF] flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && spokes.length > 0 && (
        <div className="border-t border-[#F3F4F6] divide-y divide-[#F3F4F6]">
          {spokes.map((spoke, i) => (
            <div key={i} className="px-5 py-3 flex items-start gap-3">
              <div className="w-1 h-1 rounded-full bg-[#9CA3AF] mt-2 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-[#374151] truncate max-w-sm">{spoke.url}</span>
                  {spoke.isDualCluster && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded font-medium">dual-cluster</span>
                  )}
                  {spoke.isLocationArticle && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded font-medium">location</span>
                  )}
                  {spoke.confidenceScore != null && (
                    <span className="text-[10px] text-[#9CA3AF]">score: {spoke.confidenceScore}</span>
                  )}
                </div>
                {(spoke.primaryTopic || spoke.inferredTopic) && (
                  <p className="text-[11px] text-[#9CA3AF] mt-0.5">{spoke.primaryTopic || spoke.inferredTopic}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {open && spokes.length === 0 && (
        <div className="border-t border-[#F3F4F6] px-5 py-3 text-xs text-[#9CA3AF] italic">No spokes assigned</div>
      )}
    </div>
  );
}

function ReviewScreen({ project, clusters, warnings, onApprove, approving }) {
  const totalSpokes = clusters.reduce((s, c) => s + (c.spokes?.length || 0), 0);
  const gapHubs = clusters.filter(c => c.hubPage?.isGap || c.hubPage?.hubStatus === 'gap');
  const dualCluster = clusters.reduce((s, c) => s + (c.spokes?.filter(sp => sp.isDualCluster)?.length || 0), 0);

  return (
    <div className="max-w-4xl mx-auto py-8">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#111827] mb-1">Review Hub & Spoke Structure</h2>
          <p className="text-sm text-[#6B7280]">Review the cluster structure before generating linking recommendations.</p>
        </div>
        <button onClick={onApprove} disabled={approving || project?.workflowState === 'approved'}
          className="px-5 py-2.5 text-sm font-semibold text-white rounded-lg flex-shrink-0 disabled:opacity-50"
          style={{ backgroundColor: TEAL }}>
          {approving ? 'Approving…' : project?.workflowState === 'approved' ? 'Approved ✓' : 'Approve & Generate'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Clusters', value: clusters.length },
          { label: 'Total Spokes', value: totalSpokes },
          { label: 'GAP Hubs', value: gapHubs.length },
          { label: 'Dual-Cluster Spokes', value: dualCluster },
        ].map(stat => (
          <div key={stat.label} className="bg-white rounded-lg border border-[#E5E7EB] px-4 py-3 text-center" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
            <div className="text-xl font-bold text-[#111827]">{stat.value}</div>
            <div className="text-xs text-[#9CA3AF] mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Warning banners */}
      {warnings?.map((w, i) => (
        <div key={i} className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800 flex items-start gap-2">
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          {w}
        </div>
      ))}

      {/* Cluster list */}
      <div className="space-y-3">
        {clusters.map((cluster, i) => (
          <ClusterCard key={cluster.id || i} cluster={cluster} />
        ))}
      </div>
    </div>
  );
}

// ── Results Screen ────────────────────────────────────────────────────────────

const STATUS_BADGE = {
  pending: 'bg-gray-100 text-gray-600',
  approved: 'bg-green-50 text-green-700',
  rejected: 'bg-red-50 text-red-600',
};

function InlineEditCell({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const inputRef = useRef();

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => { setDraft(value || ''); }, [value]);

  function commit() {
    setEditing(false);
    if (draft !== value) onSave(draft);
  }

  if (editing) {
    return (
      <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value || ''); setEditing(false); } }}
        className="w-full border border-[#3DAA8E] rounded px-1 py-0.5 text-xs focus:outline-none" />
    );
  }
  return (
    <span onClick={() => setEditing(true)} className="cursor-text text-xs text-[#374151] hover:text-[#3DAA8E] truncate block max-w-[140px]" title={value || '—'}>
      {value || <span className="text-[#D1D5DB] italic">click to edit</span>}
    </span>
  );
}

function AnchorSourceBadge({ source }) {
  const b = ANCHOR_SOURCE_BADGE[source];
  if (!b) return null;
  return <span className={`inline-block text-[9px] font-semibold px-1 py-0.5 rounded mb-0.5 ${b.cls}`}>{b.label}</span>;
}

function CandidatesPopover({ candidates, current, onSelect, onClose }) {
  return (
    <div className="absolute top-full left-0 mt-1 bg-white border border-[#E5E7EB] rounded-lg shadow-lg p-2 w-72 space-y-0.5" style={{ zIndex: 50 }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-wide">Anchor candidates</span>
        <button onClick={onClose} className="text-[#9CA3AF] hover:text-[#374151] text-xs leading-none">✕</button>
      </div>
      {candidates.map((c, i) => (
        <button key={i} onClick={() => onSelect(c.anchorText)}
          className={`w-full text-left px-2 py-1.5 rounded hover:bg-[#F3F4F6] ${c.anchorText === current ? 'bg-[#3DAA8E0D] ring-1 ring-[#3DAA8E33]' : ''}`}>
          <span className="block text-xs text-[#111827] leading-snug">{c.anchorText}</span>
          <span className="text-[10px] text-[#9CA3AF]">R:{c.relevanceScore} N:{c.naturalness}
            {c.section && ` · ${c.section}`}
          </span>
        </button>
      ))}
    </div>
  );
}

function AnchorCell({ rec, onSave }) {
  const [showCandidates, setShowCandidates] = useState(false);
  const displayText = rec.editedAnchorText || rec.recommendedAnchorText;
  const candidates = rec.anchorTextCandidates || [];
  const altCount = candidates.filter(c => c.anchorText !== displayText).length;

  return (
    <div className="relative min-w-[140px]">
      {rec.anchorTextSource && <AnchorSourceBadge source={rec.anchorTextSource} />}

      {rec.anchorTextSource === 'page-unavailable' ? (
        <InlineEditCell value={rec.editedAnchorText || ''}
          onSave={onSave} />
      ) : (
        <InlineEditCell value={displayText} onSave={onSave} />
      )}

      <div className="flex items-center gap-2 mt-0.5">
        {altCount > 0 && (
          <button onClick={() => setShowCandidates(s => !s)}
            className="text-[10px] text-[#3DAA8E] hover:underline leading-none">
            {altCount} alt{altCount > 1 ? 's' : ''} ↓
          </button>
        )}
        {rec.anchorTextSource === 'existing-link' && (
          <span className="text-[10px] text-blue-500">existing anchor kept</span>
        )}
      </div>

      {rec.anchorTextSource === 'new-sentence-required' && rec.suggestedNewSentence && (
        <p className="text-[10px] text-amber-700 mt-0.5 leading-snug max-w-[200px]"
          title={rec.suggestedNewSentence}>
          ✏ {rec.suggestedNewSentence.length > 80
            ? rec.suggestedNewSentence.slice(0, 80) + '…'
            : rec.suggestedNewSentence}
        </p>
      )}

      {showCandidates && candidates.length > 0 && (
        <CandidatesPopover
          candidates={candidates}
          current={displayText}
          onSelect={text => { onSave(text); setShowCandidates(false); }}
          onClose={() => setShowCandidates(false)}
        />
      )}
    </div>
  );
}

function RecRow({ rec, selected, onSelect, onUpdate }) {
  return (
    <tr className={`border-b border-[#F3F4F6] hover:bg-[#FAFAFA] ${selected ? 'bg-[#3DAA8E08]' : ''}`}>
      <td className="px-4 py-2.5 w-8">
        <input type="checkbox" checked={selected} onChange={e => onSelect(rec.id, e.target.checked)}
          className="rounded border-[#D1D5DB]" />
      </td>
      <td className="px-3 py-2.5">
        <span className="text-xs text-[#6B7280] max-w-[120px] truncate block" title={rec.clusterName}>{rec.clusterName || '—'}</span>
      </td>
      <td className="px-3 py-2.5">
        <span className="text-xs font-mono text-[#374151] max-w-[160px] truncate block" title={rec.sourceUrl}>{rec.sourceUrl}</span>
        {rec.sourceTitle && <span className="text-[11px] text-[#9CA3AF] truncate block max-w-[160px]">{rec.sourceTitle}</span>}
      </td>
      <td className="px-3 py-2.5">
        <span className="text-xs font-mono text-[#374151] max-w-[160px] truncate block" title={rec.targetUrl}>{rec.targetUrl}</span>
        {rec.targetTitle && <span className="text-[11px] text-[#9CA3AF] truncate block max-w-[160px]">{rec.targetTitle}</span>}
      </td>
      <td className="px-3 py-2.5">
        <span className="text-xs text-[#374151] whitespace-nowrap">{LINK_TYPE_LABELS[rec.linkType] || rec.linkType}</span>
      </td>
      <td className="px-3 py-2.5 min-w-[160px]">
        <AnchorCell rec={rec} onSave={v => onUpdate(rec.id, { editedAnchorText: v })} />
      </td>
      <td className="px-3 py-2.5 min-w-[100px]">
        <InlineEditCell value={rec.editedPlacement || rec.suggestedPlacement}
          onSave={v => onUpdate(rec.id, { editedPlacement: v })} />
      </td>
      <td className="px-3 py-2.5 text-center">
        <span className={`text-xs font-semibold ${rec.relevanceScore >= 7 ? 'text-green-600' : rec.relevanceScore >= 4 ? 'text-yellow-600' : 'text-red-500'}`}>
          {rec.relevanceScore ?? '—'}
        </span>
      </td>
      <td className="px-3 py-2.5">
        {rec.priority && (
          <span className="text-xs font-medium" style={{ color: PRIORITY_COLORS[rec.priority] || '#9CA3AF' }}>
            {rec.priority}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 min-w-[130px]">
        {(rec.anchorWarnings || []).length === 0 ? null : (
          <div className="space-y-0.5">
            {(rec.anchorWarnings || []).map((w, i) => (
              <span key={i} className="block text-[10px] text-orange-600 leading-tight">
                ⚠ {ANCHOR_WARNING_LABELS[w] || w}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5">
        <select value={rec.status || 'pending'}
          onChange={e => onUpdate(rec.id, { status: e.target.value })}
          className={`text-xs font-medium px-1.5 py-0.5 rounded border-0 cursor-pointer focus:outline-none ${STATUS_BADGE[rec.status] || STATUS_BADGE.pending}`}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </td>
    </tr>
  );
}

function ResultsScreen({ project, recs, onRecUpdate }) {
  const [filterStatus, setFilterStatus] = useState('');
  const [filterLinkType, setFilterLinkType] = useState('');
  const [filterCluster, setFilterCluster] = useState('');
  const [filterMinScore, setFilterMinScore] = useState('');
  const [filterAnchorSource, setFilterAnchorSource] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [exporting, setExporting] = useState(false);

  const clusterNames = [...new Set(recs.map(r => r.clusterName).filter(Boolean))].sort();

  const filtered = recs.filter(r => {
    if (filterStatus && r.status !== filterStatus) return false;
    if (filterLinkType && r.linkType !== filterLinkType) return false;
    if (filterCluster && r.clusterName !== filterCluster) return false;
    if (filterMinScore && r.relevanceScore < Number(filterMinScore)) return false;
    if (filterAnchorSource && r.anchorTextSource !== filterAnchorSource) return false;
    return true;
  });

  const allSelected = filtered.length > 0 && filtered.every(r => selectedIds.has(r.id));

  function toggleAll(checked) {
    setSelectedIds(checked ? new Set(filtered.map(r => r.id)) : new Set());
  }
  function toggleOne(id, checked) {
    setSelectedIds(prev => { const s = new Set(prev); checked ? s.add(id) : s.delete(id); return s; });
  }

  async function applyBulk() {
    if (!bulkStatus || selectedIds.size === 0) return;
    const ids = [...selectedIds];
    try {
      await hs.bulkUpdateRecommendations(project.id, { ids, status: bulkStatus });
      ids.forEach(id => onRecUpdate(id, { status: bulkStatus }));
      setSelectedIds(new Set());
      setBulkStatus('');
    } catch (e) { alert(e.message); }
  }

  async function handleExport(format) {
    setExporting(true);
    try {
      const filters = {};
      if (filterStatus) filters.filterStatus = [filterStatus];
      if (filterLinkType) filters.filterLinkType = [filterLinkType];
      if (filterCluster) filters.filterCluster = [filterCluster];
      if (filterMinScore) filters.filterMinScore = Number(filterMinScore);
      const blob = await hs.exportRecommendations(project.id, filters, format);
      downloadBlob(blob, `recommendations.${format}`);
    } catch (e) { alert(e.message); }
    finally { setExporting(false); }
  }

  const byStatus = { pending: 0, approved: 0, rejected: 0 };
  recs.forEach(r => { if (byStatus[r.status] != null) byStatus[r.status]++; });

  return (
    <div className="py-6">
      <div className="flex items-center justify-between mb-4 gap-4">
        <div>
          <h2 className="text-base font-bold text-[#111827]">Linking Recommendations</h2>
          <p className="text-sm text-[#6B7280] mt-0.5">{recs.length} total · {byStatus.approved} approved · {byStatus.rejected} rejected · {byStatus.pending} pending</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => handleExport('xlsx')} disabled={exporting}
            className="px-3 py-1.5 text-xs font-medium border border-[#E5E7EB] rounded-lg hover:bg-[#F9FAFB] text-[#374151] disabled:opacity-50">
            {exporting ? '…' : 'Export XLSX'}
          </button>
          <button onClick={() => handleExport('csv')} disabled={exporting}
            className="px-3 py-1.5 text-xs font-medium border border-[#E5E7EB] rounded-lg hover:bg-[#F9FAFB] text-[#374151] disabled:opacity-50">
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-[#E5E7EB] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#3DAA8E] text-[#374151]">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select value={filterLinkType} onChange={e => setFilterLinkType(e.target.value)}
          className="border border-[#E5E7EB] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#3DAA8E] text-[#374151]">
          <option value="">All link types</option>
          {Object.entries(LINK_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filterCluster} onChange={e => setFilterCluster(e.target.value)}
          className="border border-[#E5E7EB] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#3DAA8E] text-[#374151]">
          <option value="">All clusters</option>
          {clusterNames.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterMinScore} onChange={e => setFilterMinScore(e.target.value)}
          className="border border-[#E5E7EB] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#3DAA8E] text-[#374151]">
          <option value="">Any score</option>
          <option value="3">Score ≥ 3</option>
          <option value="5">Score ≥ 5</option>
          <option value="7">Score ≥ 7</option>
          <option value="9">Score ≥ 9</option>
        </select>
        <select value={filterAnchorSource} onChange={e => setFilterAnchorSource(e.target.value)}
          className="border border-[#E5E7EB] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#3DAA8E] text-[#374151]">
          <option value="">All anchor sources</option>
          <option value="existing-content">Found in content</option>
          <option value="new-sentence-required">New sentence req.</option>
          <option value="existing-link">Already linked</option>
          <option value="page-unavailable">Page unavailable</option>
        </select>
        {(filterStatus || filterLinkType || filterCluster || filterMinScore || filterAnchorSource) && (
          <button onClick={() => { setFilterStatus(''); setFilterLinkType(''); setFilterCluster(''); setFilterMinScore(''); setFilterAnchorSource(''); }}
            className="text-xs text-[#9CA3AF] hover:text-[#374151]">Clear filters</button>
        )}
        <span className="text-xs text-[#9CA3AF] ml-auto">{filtered.length} showing</span>
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-3 p-3 bg-[#3DAA8E0D] border border-[#3DAA8E33] rounded-lg">
          <span className="text-sm font-medium text-[#3DAA8E]">{selectedIds.size} selected</span>
          <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}
            className="border border-[#E5E7EB] rounded px-2 py-1 text-xs focus:outline-none">
            <option value="">Set status…</option>
            <option value="approved">Approve</option>
            <option value="rejected">Reject</option>
            <option value="pending">Reset to pending</option>
          </select>
          <button onClick={applyBulk} disabled={!bulkStatus}
            className="px-3 py-1 text-xs font-medium text-white rounded disabled:opacity-40"
            style={{ backgroundColor: TEAL }}>Apply</button>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-[#9CA3AF] hover:text-[#374151]">Deselect</button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                <th className="px-4 py-2.5 w-8">
                  <input type="checkbox" checked={allSelected} onChange={e => toggleAll(e.target.checked)} className="rounded" />
                </th>
                <th className="px-3 py-2.5 font-semibold text-[#6B7280] whitespace-nowrap">Cluster</th>
                <th className="px-3 py-2.5 font-semibold text-[#6B7280] whitespace-nowrap">Source</th>
                <th className="px-3 py-2.5 font-semibold text-[#6B7280] whitespace-nowrap">Target</th>
                <th className="px-3 py-2.5 font-semibold text-[#6B7280] whitespace-nowrap">Type</th>
                <th className="px-3 py-2.5 font-semibold text-[#6B7280] whitespace-nowrap">Anchor Text</th>
                <th className="px-3 py-2.5 font-semibold text-[#6B7280] whitespace-nowrap">Placement</th>
                <th className="px-3 py-2.5 font-semibold text-[#6B7280] text-center whitespace-nowrap">Score</th>
                <th className="px-3 py-2.5 font-semibold text-[#6B7280] whitespace-nowrap">Priority</th>
                <th className="px-3 py-2.5 font-semibold text-[#6B7280] whitespace-nowrap">Warnings</th>
                <th className="px-3 py-2.5 font-semibold text-[#6B7280] whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-sm text-[#9CA3AF]">
                    No recommendations match your filters.
                  </td>
                </tr>
              ) : (
                filtered.map(rec => (
                  <RecRow key={rec.id} rec={rec}
                    selected={selectedIds.has(rec.id)}
                    onSelect={toggleOne}
                    onUpdate={(id, updates) => onRecUpdate(id, updates)} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Generating Screen (polling-based) ────────────────────────────────────────

const GEN_STEP_ORDER = ['validate', 'prepare', 'per-cluster', 'cross-cluster', 'validating', 'anchor-text', 'saving'];

function genStepStatus(stepId, jobState) {
  if (!jobState) return stepId === 'validate' ? 'active' : 'pending';
  if (jobState.status === 'complete') return 'complete';
  const stepIdx = GEN_STEP_ORDER.indexOf(stepId);
  const curIdx = GEN_STEP_ORDER.indexOf(jobState.currentStep);
  if (curIdx === -1) return stepIdx === 0 ? 'active' : 'pending';
  if (stepIdx < curIdx) return 'complete';
  if (stepIdx === curIdx) return 'active';
  return 'pending';
}

function GeneratingScreen({ jobState, elapsed, onRetry, onBack }) {
  if (jobState?.status === 'failed') {
    return (
      <div className="max-w-lg mx-auto py-16 text-center">
        <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-[#111827] mb-1">Generation failed</h2>
        {jobState.failedStep && (
          <p className="text-sm text-[#6B7280] mb-1">Failed at: <span className="font-medium">{jobState.failedStep}</span></p>
        )}
        <p className="text-sm text-red-600 mb-6">{jobState.errorMessage}</p>
        <div className="flex justify-center gap-3">
          <button onClick={onRetry} className="px-4 py-2 text-sm font-medium text-white rounded-lg" style={{ backgroundColor: TEAL }}>
            Retry Generation
          </button>
          <button onClick={onBack} className="px-4 py-2 text-sm border border-[#E5E7EB] rounded-lg text-[#6B7280] hover:text-[#374151]">
            Back to Review
          </button>
        </div>
      </div>
    );
  }

  const steps = [
    { id: 'validate', label: 'Validating hub and spoke structure' },
    {
      id: 'prepare',
      label: (jobState?.pagesTotal || jobState?.clustersTotal)
        ? `Preparing page data for ${jobState.pagesTotal || '?'} pages across ${jobState.clustersTotal || '?'} clusters`
        : 'Preparing page data…',
    },
    {
      id: 'per-cluster',
      label: jobState?.clustersTotal
        ? `Generating recommendations — ${jobState.clustersProcessed} of ${jobState.clustersTotal} clusters complete`
          + (jobState.currentClusterName && genStepStatus('per-cluster', jobState) === 'active'
            ? ` · ${jobState.currentClusterName}` : '')
        : 'Generating cluster recommendations…',
      warnings: jobState?.errors || [],
    },
    { id: 'cross-cluster', label: 'Generating cross-cluster recommendations' },
    { id: 'validating', label: 'Validating and deduplicating results' },
    {
      id: 'anchor-text',
      label: jobState?.anchorSourcesTotal
        ? `Finding anchor text in source pages — ${jobState.anchorSourcesProcessed ?? 0} of ${jobState.anchorSourcesTotal} pages analyzed`
        : 'Finding anchor text candidates in source pages…',
    },
    { id: 'saving', label: 'Saving recommendations' },
  ];

  return (
    <div className="max-w-lg mx-auto py-16">
      <h2 className="text-base font-semibold text-[#111827] mb-6">Generating recommendations…</h2>

      <div className="space-y-4 mb-8">
        {steps.map(step => {
          const status = genStepStatus(step.id, jobState);
          return (
            <div key={step.id} className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                {status === 'complete' ? (
                  <div className="w-5 h-5 rounded-full bg-[#3DAA8E] flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : status === 'active' ? (
                  <div className="w-5 h-5 rounded-full border-2 border-[#3DAA8E] border-t-transparent animate-spin" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-[#F3F4F6]" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm leading-snug ${
                  status === 'active' ? 'text-[#111827] font-medium' :
                  status === 'complete' ? 'text-[#374151]' : 'text-[#9CA3AF]'
                }`}>
                  {step.label}
                </p>
                {step.id === 'per-cluster' && step.warnings?.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {step.warnings.map((w, i) => (
                      <p key={i} className="text-xs text-yellow-600 flex items-start gap-1">
                        <span className="flex-shrink-0">⚠</span><span>{w}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-[#F3F4F6] pt-4 space-y-1">
        {(jobState?.recommendationsGenerated > 0) && (
          <p className="text-sm text-[#374151]">
            <span className="font-semibold">{jobState.recommendationsGenerated}</span> recommendations generated so far
          </p>
        )}
        <p className="text-xs text-[#9CA3AF]">{elapsed}s elapsed</p>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HubSpokeProjectPage() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [screen, setScreen] = useState('loading');
  const [clusters, setClusters] = useState([]);
  const [recs, setRecs] = useState([]);
  const [analyzeSteps, setAnalyzeSteps] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState('');
  const [approving, setApproving] = useState(false);
  // Polling-based generation state
  const [genJobId, setGenJobId] = useState(null);
  const [genJobState, setGenJobState] = useState(null);
  const [genStartedAt, setGenStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const esRef = useRef(null);

  // Initial load
  useEffect(() => {
    async function load() {
      try {
        const data = await hs.getProject(id);
        setProject(data);
        if (data.clusters?.length) setClusters(data.clusters);
        const ws = data.workflowState;

        if (ws === 'approved') {
          // Check if there's a running generation job to resume
          const pendingJobId = localStorage.getItem(`hs_job_${id}`);
          if (pendingJobId) {
            setGenJobId(pendingJobId);
            setGenStartedAt(Date.now());
            setScreen('generating');
          } else {
            setScreen('reviewing');
          }
        } else if (ws === 'complete') {
          const r = await hs.getRecommendations(id);
          setRecs(r);
          setScreen('results');
        } else {
          setScreen(stateToScreen(ws));
        }
      } catch (e) {
        setError(e.message);
        setScreen('error');
      }
    }
    load();
    return () => { if (esRef.current) { esRef.current.close(); esRef.current = null; } };
  }, [id]);

  // Poll generation job
  useEffect(() => {
    if (!genJobId || screen !== 'generating') return;
    let cancelled = false;

    async function poll() {
      try {
        const status = await hs.getGenerateStatus(id, genJobId);
        if (cancelled) return;
        setGenJobState(status);
        if (status.status === 'complete') {
          localStorage.removeItem(`hs_job_${id}`);
          const r = await hs.getRecommendations(id);
          if (cancelled) return;
          setRecs(r);
          setProject(p => ({ ...p, workflowState: 'complete' }));
          setScreen('results');
        }
        // 'failed' stays on generating screen — GeneratingScreen renders error state
      } catch { /* transient network error — retry next interval */ }
    }

    poll();
    const interval = setInterval(poll, 3500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [genJobId, screen, id]);

  // Elapsed timer while generating
  useEffect(() => {
    if (screen !== 'generating') return;
    if (genJobState?.status === 'complete' || genJobState?.status === 'failed') return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - genStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [screen, genJobState?.status, genStartedAt]);

  function handleXlsxParsed(result) {
    if (result.clusters) setClusters(result.clusters);
    const w = [];
    if (result.gapHubs?.length) w.push(`${result.gapHubs.length} GAP hub(s) detected — these need new hub pages created.`);
    if (result.dualClusterSpokes?.length) w.push(`${result.dualClusterSpokes.length} spoke(s) belong to multiple clusters.`);
    setWarnings(w);
    setProject(p => ({ ...p, workflowState: 'reviewing' }));
    setScreen('reviewing');
  }

  function handleAnalyzeStarted(token, urlCount) {
    setScreen('analyzing');
    setAnalyzeSteps([{ id: 'fetch', status: 'active', message: `Starting analysis of ${urlCount} URLs…` }]);

    const es = openStream(id, 'analyze', token, {
      step: (data) => {
        setAnalyzeSteps(prev => {
          const idx = prev.findIndex(s => s.id === data.id);
          if (idx === -1) return [...prev, data];
          const next = [...prev];
          next[idx] = data;
          return next;
        });
      },
      ready: (data) => {
        es.close();
        esRef.current = null;
        if (data.clusters) setClusters(data.clusters);
        const w = [];
        if (data.gapHubs?.length) w.push(`${data.gapHubs.length} GAP hub(s) detected — new hub pages will be needed.`);
        if (data.unassignedPages?.length) w.push(`${data.unassignedPages.length} page(s) could not be assigned to a cluster.`);
        if (data.cannibalizationFlags?.length) w.push(`${data.cannibalizationFlags.length} potential keyword cannibalization issue(s) detected.`);
        if (data.warnings?.length) w.push(...data.warnings);
        setWarnings(w);
        setProject(p => ({ ...p, workflowState: 'reviewing' }));
        setScreen('reviewing');
      },
      fail: (data) => {
        es.close();
        esRef.current = null;
        setError(data.message || 'Analysis failed.');
        setScreen('input');
      },
    });
    esRef.current = es;
  }

  async function handleApprove() {
    setApproving(true);
    try {
      await hs.approveClusters(id);
      setProject(p => ({ ...p, workflowState: 'approved' }));
    } catch (e) {
      setError(e.message);
      setApproving(false);
      return;
    }
    setApproving(false);
    startGenerate();
  }

  async function startGenerate() {
    setScreen('generating');
    setGenJobState({ status: 'queued', currentStep: 'validate', clustersTotal: clusters.length, pagesTotal: 0, clustersProcessed: 0, recommendationsGenerated: 0, anchorSourcesTotal: 0, anchorSourcesProcessed: 0, errors: [] });
    setGenStartedAt(Date.now());
    setElapsed(0);
    try {
      const { jobId } = await hs.startGenerate(id);
      localStorage.setItem(`hs_job_${id}`, jobId);
      setGenJobId(jobId);
    } catch (e) {
      setError(e.message);
      setScreen('reviewing');
    }
  }

  function handleRetryGenerate() {
    localStorage.removeItem(`hs_job_${id}`);
    setGenJobId(null);
    setGenJobState(null);
    startGenerate();
  }

  function handleBackToReview() {
    localStorage.removeItem(`hs_job_${id}`);
    setGenJobId(null);
    setGenJobState(null);
    setScreen('reviewing');
  }

  async function handleRecUpdate(recId, updates) {
    try {
      const updated = await hs.updateRecommendation(id, recId, updates);
      setRecs(prev => prev.map(r => r.id === recId ? { ...r, ...updated } : r));
    } catch (e) {
      alert(e.message);
    }
  }

  if (screen === 'loading') {
    return (
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F4F5F7' }}>
        <Header project={null} />
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[#3DAA8E] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (screen === 'error') {
    return (
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F4F5F7' }}>
        <Header project={project} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-600 text-sm mb-4">{error}</p>
            <button onClick={() => window.location.reload()} className="text-sm text-[#3DAA8E] underline">Reload</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F4F5F7' }}>
      <Header project={project} />
      <Stepper screen={screen} />

      {error && (
        <div className="max-w-7xl mx-auto w-full px-6 pt-4">
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-start gap-2">
            <span>{error}</span>
            <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">✕</button>
          </div>
        </div>
      )}

      <main className={`flex-1 ${screen === 'results' ? 'max-w-[1400px]' : 'max-w-7xl'} mx-auto w-full px-6`}>
        {screen === 'input' && (
          <InputScreen project={project} onXlsxParsed={handleXlsxParsed} onAnalyzeStarted={handleAnalyzeStarted} />
        )}
        {screen === 'analyzing' && (
          <ProgressDisplay steps={analyzeSteps} title="Analyzing URLs…" />
        )}
        {screen === 'reviewing' && (
          <ReviewScreen
            project={project}
            clusters={clusters}
            warnings={warnings}
            onApprove={handleApprove}
            approving={approving}
          />
        )}
        {screen === 'generating' && (
          <GeneratingScreen
            jobState={genJobState}
            elapsed={elapsed}
            onRetry={handleRetryGenerate}
            onBack={handleBackToReview}
          />
        )}
        {screen === 'results' && (
          <ResultsScreen project={project} recs={recs} onRecUpdate={handleRecUpdate} />
        )}
      </main>
    </div>
  );
}
