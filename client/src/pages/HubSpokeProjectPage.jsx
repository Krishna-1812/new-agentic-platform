import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { hs, openStream, xlsxToBase64 } from '../lib/hubSpokeApi';

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

const PRIORITY_COLORS = {
  high: 'var(--danger,#EF4444)',
  medium: 'var(--warning,#F59E0B)',
  low: 'var(--text-3)',
};

// Anchor source badge styles using design tokens
const ANCHOR_SOURCE_BADGE = {
  'existing-content':      { label: 'Found in content',    bg: 'rgba(16,185,129,0.08)',  color: 'var(--success,#059669)' },
  'new-sentence-required': { label: 'New sentence req.',   bg: 'rgba(245,158,11,0.08)',  color: 'var(--warning,#B45309)' },
  'existing-link':         { label: 'Already linked',      bg: 'rgba(59,130,246,0.08)',  color: 'var(--info,#2563EB)' },
  'page-unavailable':      { label: 'Page unavailable',    bg: 'rgba(239,68,68,0.08)',   color: 'var(--danger,#DC2626)' },
};

const ANCHOR_WARNING_LABELS = {
  'anchor-too-short':             'Too short (< 2 words)',
  'anchor-too-long':              'Too long (> 10 words)',
  'generic-phrase':               'Generic phrase',
  'duplicate-anchor-diff-target': 'Duplicate anchor → diff target',
  'anchor-overused-for-target':   'Anchor used > 3× for target',
  'high-link-density':            'High link density on source',
  'exact-title-match':            'Exact title match',
  'page-unavailable':             'Source page unavailable',
  'anchor-not-in-context':        'Anchor not in context sentence',
  'geo-specific-target':          'Geo-specific target (hub→location page)',
};

// Spinner keyframes injected once
const SPIN_STYLE = `@keyframes spin { to { transform: rotate(360deg); } }`;

// ── Header ────────────────────────────────────────────────────────────────────

function Header({ project }) {
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
      <div style={{ maxWidth: '80rem', margin: '0 auto', width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button
          onClick={() => navigate('/hub-spoke')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.875rem', color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}
        >
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Projects
        </button>
        <span style={{ color: 'var(--border)', fontSize: '1rem' }}>/</span>
        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)', maxWidth: '16rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project?.name || '…'}
        </span>
        {project?.domain && (
          <>
            <span style={{ color: 'var(--border)' }}>·</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.domain}</span>
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
    <div style={{ background: 'var(--card)', borderBottom: '1px solid var(--border)', padding: '0.75rem 1.5rem' }}>
      <div style={{ maxWidth: '80rem', margin: '0 auto', display: 'flex', alignItems: 'center', gap: 0 }}>
        {STEPS.map((step, i) => {
          const done = i < activeIdx;
          const current = i === activeIdx;
          return (
            <div key={step.key} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: '1.5rem', height: '1.5rem', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.75rem', fontWeight: 700,
                  background: done || current ? 'var(--primary)' : 'var(--surface)',
                  color: done || current ? '#fff' : 'var(--text-3)',
                  boxShadow: current ? '0 0 0 3px var(--primary-soft)' : 'none',
                  transition: 'background 0.2s, box-shadow 0.2s',
                }}>
                  {done ? '✓' : i + 1}
                </div>
                <span style={{
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: current ? 'var(--text)' : done ? 'var(--primary)' : 'var(--text-3)',
                }}>
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{
                  margin: '0 1rem',
                  height: '1px',
                  width: '4rem',
                  background: i < activeIdx ? 'var(--primary)' : 'var(--border)',
                }} />
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
    <div style={{ maxWidth: '32rem', margin: '0 auto', padding: '4rem 0' }}>
      <h2 style={{ margin: '0 0 1.5rem', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text)' }}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {steps.map((step, i) => (
          <div key={step.id + i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            <div style={{ flexShrink: 0, marginTop: '0.125rem' }}>
              {step.status === 'done' ? (
                <div style={{ width: '1.25rem', height: '1.25rem', borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : step.status === 'active' ? (
                <div style={{ width: '1.25rem', height: '1.25rem', borderRadius: '50%', border: '2px solid var(--primary)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
              ) : (
                <div style={{ width: '1.25rem', height: '1.25rem', borderRadius: '50%', background: 'var(--surface)' }} />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                margin: 0,
                fontSize: '0.875rem',
                color: step.status === 'done' ? 'var(--text)' : step.status === 'active' ? 'var(--text)' : 'var(--text-3)',
                fontWeight: step.status === 'active' ? 500 : 400,
              }}>
                {step.message}
              </p>
              {step.url && (
                <p style={{ margin: '0.125rem 0 0', fontSize: '0.75rem', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.url}</p>
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

  const modeTabBase = {
    padding: '0.375rem 1rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    borderRadius: 'var(--r-md)',
    border: 'none',
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
  };

  const inputStyle = {
    width: '100%',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-xl)',
    padding: '0.75rem 1rem',
    fontSize: '0.875rem',
    background: 'var(--card)',
    color: 'var(--text)',
    outline: 'none',
    resize: 'none',
    boxSizing: 'border-box',
    fontFamily: 'var(--font-mono)',
  };

  return (
    <div style={{ maxWidth: '40rem', margin: '0 auto', padding: '2.5rem 0' }}>
      <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.125rem', fontWeight: 700, color: 'var(--text)' }}>Add Content Structure</h2>
      <p style={{ margin: '0 0 1.5rem', fontSize: '0.875rem', color: 'var(--text-2)' }}>Upload an existing hub and spoke document, or enter URLs to auto-categorize with AI.</p>

      {/* Mode toggle */}
      <div style={{ display: 'flex', background: 'var(--surface)', borderRadius: 'var(--r-lg)', padding: '0.25rem', marginBottom: '1.5rem', width: 'fit-content' }}>
        <button
          onClick={() => setMode('xlsx')}
          style={{ ...modeTabBase, background: mode === 'xlsx' ? 'var(--card)' : 'transparent', color: mode === 'xlsx' ? 'var(--text)' : 'var(--text-2)', boxShadow: mode === 'xlsx' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}
        >
          Upload XLSX
        </button>
        <button
          onClick={() => setMode('urls')}
          style={{ ...modeTabBase, background: mode === 'urls' ? 'var(--card)' : 'transparent', color: mode === 'urls' ? 'var(--text)' : 'var(--text-2)', boxShadow: mode === 'urls' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}
        >
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
            style={{
              border: `2px dashed ${dragging ? 'var(--primary)' : 'var(--border)'}`,
              borderRadius: 'var(--r-xl)',
              padding: '3rem',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragging ? 'var(--primary-soft)' : 'var(--card)',
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onMouseEnter={e => { if (!dragging) { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.background = 'var(--primary-soft)'; } }}
            onMouseLeave={e => { if (!dragging) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--card)'; } }}
          >
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              onChange={e => processFile(e.target.files[0])} />
            {uploading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: '1.5rem', height: '1.5rem', borderRadius: '50%', border: '2px solid var(--primary)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
                <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-2)' }}>Parsing XLSX…</p>
              </div>
            ) : (
              <>
                <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="var(--text-3)" strokeWidth={1.5} style={{ margin: '0 auto 0.75rem', display: 'block' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <p style={{ margin: '0 0 0.25rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)' }}>Drop XLSX file here, or click to browse</p>
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-3)' }}>Supports hub and spoke spreadsheets with HUB:/spoke format</p>
              </>
            )}
          </div>
          {uploadError && <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--danger,#DC2626)' }}>{uploadError}</p>}
        </div>
      ) : (
        <div>
          <textarea
            value={urlText}
            onChange={e => handleUrlTextChange(e.target.value)}
            placeholder={"Paste URLs here, one per line\n\nhttps://example.com/blog/post-1\nhttps://example.com/services/dental-cleaning\nhttps://example.com/about"}
            rows={12}
            style={inputStyle}
            onFocus={e => { e.target.style.borderColor = 'var(--primary)'; e.target.style.boxShadow = '0 0 0 2px var(--primary-soft)'; }}
            onBlur={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }}
          />
          {classification && (
            <div style={{
              marginTop: '0.75rem',
              padding: '0.75rem',
              background: 'var(--surface)',
              borderRadius: 'var(--r-lg)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              fontSize: '0.875rem',
            }}>
              <span style={{ fontWeight: 500, color: 'var(--text)' }}>{classification.urlCount} URLs detected</span>
              {classification.type === 'hub-and-spoke-complete' && (
                <span style={{ fontSize: '0.75rem', padding: '0.125rem 0.5rem', background: 'var(--primary-soft)', color: 'var(--primary-text)', borderRadius: '9999px', fontWeight: 500 }}>Hub &amp; Spoke structure found</span>
              )}
              {classification.type === 'url-list-only' && (
                <span style={{ fontSize: '0.75rem', padding: '0.125rem 0.5rem', background: 'rgba(59,130,246,0.1)', color: 'var(--info,#1D4ED8)', borderRadius: '9999px', fontWeight: 500 }}>AI categorization will be applied</span>
              )}
              {classification.type === 'mixed' && (
                <span style={{ fontSize: '0.75rem', padding: '0.125rem 0.5rem', background: 'rgba(245,158,11,0.1)', color: 'var(--warning,#92400E)', borderRadius: '9999px', fontWeight: 500 }}>Mixed content — AI will categorize</span>
              )}
              {classification.type === 'invalid' && (
                <span style={{ fontSize: '0.75rem', padding: '0.125rem 0.5rem', background: 'rgba(239,68,68,0.1)', color: 'var(--danger,#DC2626)', borderRadius: '9999px', fontWeight: 500 }}>No valid URLs found</span>
              )}
            </div>
          )}
          {analyzeError && <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--danger,#DC2626)' }}>{analyzeError}</p>}
          <div style={{ marginTop: '1rem' }}>
            <button
              onClick={handleAnalyze}
              disabled={!classification?.urlCount || classification?.type === 'invalid' || analyzing}
              style={{
                padding: '0.625rem 1.25rem',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: '#fff',
                background: 'var(--primary)',
                border: 'none',
                borderRadius: 'var(--r-lg)',
                cursor: (!classification?.urlCount || classification?.type === 'invalid' || analyzing) ? 'not-allowed' : 'pointer',
                opacity: (!classification?.urlCount || classification?.type === 'invalid' || analyzing) ? 0.5 : 1,
              }}
            >
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
    <div style={{ background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', textAlign: 'left', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'none', border: 'none', cursor: 'pointer', transition: 'background 0.15s' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)' }}>{cluster.clusterName}</span>
            {(cluster.hubPage?.isGap || cluster.hubPage?.hubStatus === 'gap') && (
              <span style={{ fontSize: '0.75rem', padding: '0.125rem 0.375rem', background: 'rgba(245,158,11,0.1)', color: 'var(--warning,#92400E)', borderRadius: 'var(--r-sm)', fontWeight: 500 }}>GAP</span>
            )}
            <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>{spokes.length} spoke{spokes.length !== 1 ? 's' : ''}</span>
          </div>
          {cluster.hubPage?.url && (
            <p style={{ margin: '0.125rem 0 0', fontSize: '0.75rem', color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cluster.hubPage.url}</p>
          )}
          {cluster.primaryKeyword && (
            <p style={{ margin: '0.125rem 0 0', fontSize: '0.75rem', color: 'var(--text-3)' }}>Primary keyword: {cluster.primaryKeyword}</p>
          )}
        </div>
        <svg
          width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="var(--text-3)" strokeWidth={2}
          style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && spokes.length > 0 && (
        <div style={{ borderTop: '1px solid var(--surface)' }}>
          {spokes.map((spoke, i) => (
            <div key={i} style={{ padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'flex-start', gap: '0.75rem', borderBottom: i < spokes.length - 1 ? '1px solid var(--surface)' : 'none' }}>
              <div style={{ width: '0.25rem', height: '0.25rem', borderRadius: '50%', background: 'var(--text-3)', marginTop: '0.5rem', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '24rem' }}>{spoke.url}</span>
                  {spoke.isDualCluster && (
                    <span style={{ fontSize: '0.625rem', padding: '0.125rem 0.375rem', background: 'rgba(59,130,246,0.1)', color: 'var(--info,#1D4ED8)', borderRadius: 'var(--r-sm)', fontWeight: 500 }}>dual-cluster</span>
                  )}
                  {spoke.isLocationArticle && (
                    <span style={{ fontSize: '0.625rem', padding: '0.125rem 0.375rem', background: 'rgba(147,51,234,0.1)', color: '#6D28D9', borderRadius: 'var(--r-sm)', fontWeight: 500 }}>location</span>
                  )}
                  {spoke.confidenceScore != null && (
                    <span style={{ fontSize: '0.625rem', color: 'var(--text-3)' }}>score: {spoke.confidenceScore}</span>
                  )}
                </div>
                {(spoke.primaryTopic || spoke.inferredTopic) && (
                  <p style={{ margin: '0.125rem 0 0', fontSize: '0.6875rem', color: 'var(--text-3)' }}>{spoke.primaryTopic || spoke.inferredTopic}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {open && spokes.length === 0 && (
        <div style={{ borderTop: '1px solid var(--surface)', padding: '0.75rem 1.25rem', fontSize: '0.75rem', color: 'var(--text-3)', fontStyle: 'italic' }}>No spokes assigned</div>
      )}
    </div>
  );
}

function ReviewScreen({ project, clusters, warnings, onApprove, approving }) {
  const totalSpokes = clusters.reduce((s, c) => s + (c.spokes?.length || 0), 0);
  const gapHubs = clusters.filter(c => c.hubPage?.isGap || c.hubPage?.hubStatus === 'gap');
  const dualCluster = clusters.reduce((s, c) => s + (c.spokes?.filter(sp => sp.isDualCluster)?.length || 0), 0);

  return (
    <div style={{ maxWidth: '56rem', margin: '0 auto', padding: '2rem 0' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.125rem', fontWeight: 700, color: 'var(--text)' }}>Review Hub &amp; Spoke Structure</h2>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-2)' }}>Review the cluster structure before generating linking recommendations.</p>
        </div>
        <button
          onClick={onApprove}
          disabled={approving || project?.workflowState === 'approved'}
          style={{
            padding: '0.625rem 1.25rem',
            fontSize: '0.875rem',
            fontWeight: 600,
            color: '#fff',
            background: 'var(--primary)',
            border: 'none',
            borderRadius: 'var(--r-lg)',
            flexShrink: 0,
            cursor: (approving || project?.workflowState === 'approved') ? 'not-allowed' : 'pointer',
            opacity: (approving || project?.workflowState === 'approved') ? 0.5 : 1,
          }}
        >
          {approving ? 'Approving…' : project?.workflowState === 'approved' ? 'Approved ✓' : 'Approve & Generate'}
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
        {[
          { label: 'Clusters', value: clusters.length },
          { label: 'Total Spokes', value: totalSpokes },
          { label: 'GAP Hubs', value: gapHubs.length },
          { label: 'Dual-Cluster Spokes', value: dualCluster },
        ].map(stat => (
          <div key={stat.label} style={{
            background: 'var(--card)',
            borderRadius: 'var(--r-lg)',
            border: '1px solid var(--border)',
            padding: '0.75rem 1rem',
            textAlign: 'center',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          }}>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{stat.value}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: '0.125rem' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Warning banners */}
      {warnings?.map((w, i) => (
        <div key={i} style={{
          marginBottom: '0.75rem',
          padding: '0.75rem',
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: 'var(--r-lg)',
          fontSize: '0.875rem',
          color: 'var(--warning,#92400E)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.5rem',
        }}>
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ flexShrink: 0, marginTop: '0.125rem' }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          {w}
        </div>
      ))}

      {/* Cluster list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {clusters.map((cluster, i) => (
          <ClusterCard key={cluster.id || i} cluster={cluster} />
        ))}
      </div>
    </div>
  );
}

// ── Results Screen ────────────────────────────────────────────────────────────

// Status badge styles using design tokens
const STATUS_BADGE_STYLE = {
  pending:  { background: 'var(--surface)', color: 'var(--text-2)' },
  approved: { background: 'rgba(16,185,129,0.1)', color: 'var(--success,#059669)' },
  rejected: { background: 'rgba(239,68,68,0.1)', color: 'var(--danger,#DC2626)' },
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
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value || ''); setEditing(false); } }}
        style={{ width: '100%', border: '1px solid var(--primary)', borderRadius: 'var(--r-sm)', padding: '0.125rem 0.25rem', fontSize: '0.75rem', outline: 'none', background: 'var(--card)', color: 'var(--text)' }}
      />
    );
  }
  return (
    <span
      onClick={() => setEditing(true)}
      title={value || '—'}
      style={{ cursor: 'text', fontSize: '0.75rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: '8.75rem' }}
      onMouseEnter={e => e.currentTarget.style.color = 'var(--primary)'}
      onMouseLeave={e => e.currentTarget.style.color = 'var(--text)'}
    >
      {value || <span style={{ color: 'var(--border)', fontStyle: 'italic' }}>click to edit</span>}
    </span>
  );
}

function AnchorSourceBadge({ source }) {
  const b = ANCHOR_SOURCE_BADGE[source];
  if (!b) return null;
  return (
    <span style={{
      display: 'inline-block',
      fontSize: '0.5625rem',
      fontWeight: 600,
      padding: '0.125rem 0.25rem',
      borderRadius: 'var(--r-sm)',
      marginBottom: '0.125rem',
      background: b.bg,
      color: b.color,
    }}>
      {b.label}
    </span>
  );
}

function CandidatesPopover({ candidates, current, onSelect, onClose }) {
  return (
    <div style={{
      position: 'absolute', top: '100%', left: 0, marginTop: '0.25rem',
      background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: '0.5rem', width: '18rem',
      zIndex: 50, display: 'flex', flexDirection: 'column', gap: '0.125rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
        <span style={{ fontSize: '0.625rem', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Anchor candidates</span>
        <button onClick={onClose} style={{ color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', lineHeight: 1 }}>✕</button>
      </div>
      {candidates.map((c, i) => (
        <button key={i} onClick={() => onSelect(c.anchorText)}
          style={{
            width: '100%', textAlign: 'left', padding: '0.375rem 0.5rem',
            borderRadius: 'var(--r-md)', border: 'none', cursor: 'pointer',
            background: c.anchorText === current ? 'var(--primary-soft)' : 'none',
            outline: c.anchorText === current ? '1px solid rgba(61,170,142,0.2)' : 'none',
          }}
          onMouseEnter={e => { if (c.anchorText !== current) e.currentTarget.style.background = 'var(--surface)'; }}
          onMouseLeave={e => { if (c.anchorText !== current) e.currentTarget.style.background = 'none'; }}
        >
          <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text)', lineHeight: 1.4 }}>{c.anchorText}</span>
          <span style={{ fontSize: '0.625rem', color: 'var(--text-3)' }}>
            R:{c.relevanceScore} N:{c.naturalness}{c.section && ` · ${c.section}`}
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
    <div style={{ position: 'relative', minWidth: '8.75rem' }}>
      {rec.anchorTextSource && <AnchorSourceBadge source={rec.anchorTextSource} />}

      {rec.anchorTextSource === 'page-unavailable' ? (
        <InlineEditCell value={rec.editedAnchorText || ''} onSave={onSave} />
      ) : (
        <InlineEditCell value={displayText} onSave={onSave} />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.125rem' }}>
        {altCount > 0 && (
          <button onClick={() => setShowCandidates(s => !s)}
            style={{ fontSize: '0.625rem', color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', lineHeight: 1 }}>
            {altCount} alt{altCount > 1 ? 's' : ''} ↓
          </button>
        )}
        {rec.anchorTextSource === 'existing-link' && (
          <span style={{ fontSize: '0.625rem', color: 'var(--info,#2563EB)' }}>existing anchor kept</span>
        )}
      </div>

      {rec.anchorTextSource === 'new-sentence-required' && rec.suggestedNewSentence && (
        <p style={{ margin: '0.125rem 0 0', fontSize: '0.625rem', color: 'var(--warning,#92400E)', lineHeight: 1.4, maxWidth: '12.5rem' }}
          title={rec.suggestedNewSentence}>
          ✏ {rec.suggestedNewSentence.length > 80 ? rec.suggestedNewSentence.slice(0, 80) + '…' : rec.suggestedNewSentence}
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
    <tr style={{ borderBottom: '1px solid var(--surface)', background: selected ? 'var(--primary-soft)' : 'transparent', transition: 'background 0.1s' }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--surface)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = selected ? 'var(--primary-soft)' : 'transparent'; }}
    >
      <td style={{ padding: '0.625rem 1rem', width: '2rem' }}>
        <input type="checkbox" checked={selected} onChange={e => onSelect(rec.id, e.target.checked)} style={{ borderRadius: 'var(--r-sm)' }} />
      </td>
      <td style={{ padding: '0.625rem 0.75rem' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-2)', maxWidth: '7.5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }} title={rec.clusterName}>{rec.clusterName || '—'}</span>
      </td>
      <td style={{ padding: '0.625rem 0.75rem' }}>
        <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text)', maxWidth: '10rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }} title={rec.sourceUrl}>{rec.sourceUrl}</span>
        {rec.sourceTitle && <span style={{ fontSize: '0.6875rem', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: '10rem' }}>{rec.sourceTitle}</span>}
      </td>
      <td style={{ padding: '0.625rem 0.75rem' }}>
        <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text)', maxWidth: '10rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }} title={rec.targetUrl}>{rec.targetUrl}</span>
        {rec.targetTitle && <span style={{ fontSize: '0.6875rem', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: '10rem' }}>{rec.targetTitle}</span>}
      </td>
      <td style={{ padding: '0.625rem 0.75rem' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text)', whiteSpace: 'nowrap' }}>{LINK_TYPE_LABELS[rec.linkType] || rec.linkType}</span>
      </td>
      <td style={{ padding: '0.625rem 0.75rem', minWidth: '10rem' }}>
        <AnchorCell rec={rec} onSave={v => onUpdate(rec.id, { editedAnchorText: v })} />
      </td>
      <td style={{ padding: '0.625rem 0.75rem', minWidth: '6.25rem' }}>
        <InlineEditCell value={rec.editedPlacement || rec.suggestedPlacement} onSave={v => onUpdate(rec.id, { editedPlacement: v })} />
      </td>
      <td style={{ padding: '0.625rem 0.75rem', textAlign: 'center' }}>
        <span style={{
          fontSize: '0.75rem',
          fontWeight: 600,
          fontFamily: 'var(--font-mono)',
          color: rec.relevanceScore >= 7 ? 'var(--success,#059669)' : rec.relevanceScore >= 4 ? 'var(--warning,#D97706)' : 'var(--danger,#DC2626)',
        }}>
          {rec.relevanceScore ?? '—'}
        </span>
      </td>
      <td style={{ padding: '0.625rem 0.75rem' }}>
        {rec.priority && (
          <span style={{ fontSize: '0.75rem', fontWeight: 500, color: PRIORITY_COLORS[rec.priority] || 'var(--text-3)' }}>
            {rec.priority}
          </span>
        )}
      </td>
      <td style={{ padding: '0.625rem 0.75rem', minWidth: '8.125rem' }}>
        {(rec.anchorWarnings || []).length === 0 ? null : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
            {(rec.anchorWarnings || []).map((w, i) => (
              <span key={i} style={{ display: 'block', fontSize: '0.625rem', color: 'var(--warning,#D97706)', lineHeight: 1.4 }}>
                ⚠ {ANCHOR_WARNING_LABELS[w] || w}
              </span>
            ))}
          </div>
        )}
      </td>
      <td style={{ padding: '0.625rem 0.75rem' }}>
        <select
          value={rec.status || 'pending'}
          onChange={e => onUpdate(rec.id, { status: e.target.value })}
          style={{
            fontSize: '0.75rem',
            fontWeight: 500,
            padding: '0.125rem 0.375rem',
            borderRadius: 'var(--r-sm)',
            border: 'none',
            cursor: 'pointer',
            outline: 'none',
            ...STATUS_BADGE_STYLE[rec.status] || STATUS_BADGE_STYLE.pending,
          }}
        >
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

  const filterSelectStyle = {
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-lg)',
    padding: '0.375rem 0.75rem',
    fontSize: '0.75rem',
    color: 'var(--text)',
    background: 'var(--card)',
    outline: 'none',
    cursor: 'pointer',
  };

  return (
    <div style={{ padding: '1.5rem 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: '0 0 0.125rem', fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text)' }}>Linking Recommendations</h2>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-2)' }}>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{recs.length}</span> total ·{' '}
            <span style={{ fontFamily: 'var(--font-mono)' }}>{byStatus.approved}</span> approved ·{' '}
            <span style={{ fontFamily: 'var(--font-mono)' }}>{byStatus.rejected}</span> rejected ·{' '}
            <span style={{ fontFamily: 'var(--font-mono)' }}>{byStatus.pending}</span> pending
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            onClick={() => handleExport('xlsx')}
            disabled={exporting}
            style={{
              padding: '0.375rem 0.75rem', fontSize: '0.75rem', fontWeight: 500,
              border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
              background: 'var(--card)', color: 'var(--text)', cursor: exporting ? 'not-allowed' : 'pointer',
              opacity: exporting ? 0.5 : 1,
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--card)'}
          >
            {exporting ? '…' : 'Export XLSX'}
          </button>
          <button
            onClick={() => handleExport('csv')}
            disabled={exporting}
            style={{
              padding: '0.375rem 0.75rem', fontSize: '0.75rem', fontWeight: 500,
              border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
              background: 'var(--card)', color: 'var(--text)', cursor: exporting ? 'not-allowed' : 'pointer',
              opacity: exporting ? 0.5 : 1,
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--card)'}
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={filterSelectStyle}
          onFocus={e => e.target.style.borderColor = 'var(--primary)'}
          onBlur={e => e.target.style.borderColor = 'var(--border)'}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select value={filterLinkType} onChange={e => setFilterLinkType(e.target.value)} style={filterSelectStyle}
          onFocus={e => e.target.style.borderColor = 'var(--primary)'}
          onBlur={e => e.target.style.borderColor = 'var(--border)'}>
          <option value="">All link types</option>
          {Object.entries(LINK_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filterCluster} onChange={e => setFilterCluster(e.target.value)} style={filterSelectStyle}
          onFocus={e => e.target.style.borderColor = 'var(--primary)'}
          onBlur={e => e.target.style.borderColor = 'var(--border)'}>
          <option value="">All clusters</option>
          {clusterNames.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterMinScore} onChange={e => setFilterMinScore(e.target.value)} style={filterSelectStyle}
          onFocus={e => e.target.style.borderColor = 'var(--primary)'}
          onBlur={e => e.target.style.borderColor = 'var(--border)'}>
          <option value="">Any score</option>
          <option value="3">Score ≥ 3</option>
          <option value="5">Score ≥ 5</option>
          <option value="7">Score ≥ 7</option>
          <option value="9">Score ≥ 9</option>
        </select>
        <select value={filterAnchorSource} onChange={e => setFilterAnchorSource(e.target.value)} style={filterSelectStyle}
          onFocus={e => e.target.style.borderColor = 'var(--primary)'}
          onBlur={e => e.target.style.borderColor = 'var(--border)'}>
          <option value="">All anchor sources</option>
          <option value="existing-content">Found in content</option>
          <option value="new-sentence-required">New sentence req.</option>
          <option value="existing-link">Already linked</option>
          <option value="page-unavailable">Page unavailable</option>
        </select>
        {(filterStatus || filterLinkType || filterCluster || filterMinScore || filterAnchorSource) && (
          <button
            onClick={() => { setFilterStatus(''); setFilterLinkType(''); setFilterCluster(''); setFilterMinScore(''); setFilterAnchorSource(''); }}
            style={{ fontSize: '0.75rem', color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}
          >
            Clear filters
          </button>
        )}
        <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>{filtered.length} showing</span>
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          marginBottom: '0.75rem', padding: '0.75rem',
          background: 'var(--primary-soft)', border: '1px solid rgba(61,170,142,0.2)',
          borderRadius: 'var(--r-lg)',
        }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--primary-text)', fontFamily: 'var(--font-mono)' }}>{selectedIds.size} selected</span>
          <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}
            style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: 'var(--card)', color: 'var(--text)', outline: 'none' }}>
            <option value="">Set status…</option>
            <option value="approved">Approve</option>
            <option value="rejected">Reject</option>
            <option value="pending">Reset to pending</option>
          </select>
          <button
            onClick={applyBulk}
            disabled={!bulkStatus}
            style={{
              padding: '0.25rem 0.75rem', fontSize: '0.75rem', fontWeight: 500,
              color: '#fff', background: 'var(--primary)', border: 'none',
              borderRadius: 'var(--r-md)', cursor: bulkStatus ? 'pointer' : 'not-allowed', opacity: bulkStatus ? 1 : 0.4,
            }}
          >
            Apply
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            style={{ fontSize: '0.75rem', color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}
          >
            Deselect
          </button>
        </div>
      )}

      {/* Table */}
      <div style={{ background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', textAlign: 'left', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '0.625rem 1rem', width: '2rem' }}>
                  <input type="checkbox" checked={allSelected} onChange={e => toggleAll(e.target.checked)} style={{ borderRadius: 'var(--r-sm)' }} />
                </th>
                {['Cluster', 'Source', 'Target', 'Type', 'Anchor Text', 'Placement', 'Score', 'Priority', 'Warnings', 'Status'].map(h => (
                  <th key={h} style={{ padding: '0.625rem 0.75rem', fontWeight: 600, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ padding: '2rem 1rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-3)' }}>
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
      <div style={{ maxWidth: '32rem', margin: '0 auto', padding: '4rem 0', textAlign: 'center' }}>
        <div style={{
          width: '3rem', height: '3rem', borderRadius: 'var(--r-xl)',
          background: 'rgba(239,68,68,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem',
        }}>
          <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="var(--danger,#EF4444)" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 style={{ margin: '0 0 0.25rem', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text)' }}>Generation failed</h2>
        {jobState.failedStep && (
          <p style={{ margin: '0 0 0.25rem', fontSize: '0.875rem', color: 'var(--text-2)' }}>Failed at: <span style={{ fontWeight: 500 }}>{jobState.failedStep}</span></p>
        )}
        <p style={{ margin: '0 0 1.5rem', fontSize: '0.875rem', color: 'var(--danger,#DC2626)' }}>{jobState.errorMessage}</p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem' }}>
          <button
            onClick={onRetry}
            style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 500, color: '#fff', background: 'var(--primary)', border: 'none', borderRadius: 'var(--r-lg)', cursor: 'pointer' }}
          >
            Retry Generation
          </button>
          <button
            onClick={onBack}
            style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--card)', color: 'var(--text-2)', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-2)'}
          >
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
    <div style={{ maxWidth: '32rem', margin: '0 auto', padding: '4rem 0' }}>
      <h2 style={{ margin: '0 0 1.5rem', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text)' }}>Generating recommendations…</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
        {steps.map(step => {
          const status = genStepStatus(step.id, jobState);
          return (
            <div key={step.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
              <div style={{ flexShrink: 0, marginTop: '0.125rem' }}>
                {status === 'complete' ? (
                  <div style={{ width: '1.25rem', height: '1.25rem', borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : status === 'active' ? (
                  <div style={{ width: '1.25rem', height: '1.25rem', borderRadius: '50%', border: '2px solid var(--primary)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
                ) : (
                  <div style={{ width: '1.25rem', height: '1.25rem', borderRadius: '50%', background: 'var(--surface)' }} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  margin: 0,
                  fontSize: '0.875rem',
                  lineHeight: 1.5,
                  color: status === 'active' ? 'var(--text)' : status === 'complete' ? 'var(--text)' : 'var(--text-3)',
                  fontWeight: status === 'active' ? 500 : 400,
                }}>
                  {step.label}
                </p>
                {step.id === 'per-cluster' && step.warnings?.length > 0 && (
                  <div style={{ marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                    {step.warnings.map((w, i) => (
                      <p key={i} style={{ margin: 0, fontSize: '0.75rem', color: 'var(--warning,#D97706)', display: 'flex', alignItems: 'flex-start', gap: '0.25rem' }}>
                        <span style={{ flexShrink: 0 }}>⚠</span><span>{w}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ borderTop: '1px solid var(--surface)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        {(jobState?.recommendationsGenerated > 0) && (
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text)' }}>
            <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{jobState.recommendationsGenerated}</span> recommendations generated so far
          </p>
        )}
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{elapsed}s elapsed</p>
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
      <>
        <style>{SPIN_STYLE}</style>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: '1.5rem', height: '1.5rem', borderRadius: '50%', border: '2px solid var(--primary)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
        </div>
      </>
    );
  }

  if (screen === 'error') {
    return (
      <>
        <style>{SPIN_STYLE}</style>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--danger,#DC2626)', fontSize: '0.875rem', marginBottom: '1rem' }}>{error}</p>
            <button
              onClick={() => window.location.reload()}
              style={{ fontSize: '0.875rem', color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Reload
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{SPIN_STYLE}</style>
      <Stepper screen={screen} />

      {error && (
        <div style={{ maxWidth: '80rem', margin: '0 auto', width: '100%', padding: '1rem 1.5rem 0' }}>
          <div style={{
            padding: '0.75rem',
            background: 'rgba(239,68,68,0.07)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 'var(--r-lg)',
            fontSize: '0.875rem',
            color: 'var(--danger,#DC2626)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.5rem',
          }}>
            <span>{error}</span>
            <button
              onClick={() => setError('')}
              style={{ marginLeft: 'auto', color: 'rgba(239,68,68,0.6)', background: 'none', border: 'none', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--danger,#DC2626)'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(239,68,68,0.6)'}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <main style={{
        flex: 1,
        maxWidth: screen === 'results' ? '87.5rem' : '80rem',
        margin: '0 auto',
        width: '100%',
        padding: '0 1.5rem',
      }}>
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
    </>
  );
}
