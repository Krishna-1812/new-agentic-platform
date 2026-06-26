import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { lpb, openStream } from '../lib/lpbApi';

const TABS = ['Keywords', 'Content', 'Schema', 'Approval', 'Export'];

function Spinner() {
  return (
    <>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <svg style={{ animation: 'spin 1s linear infinite', width: '1rem', height: '1rem', display: 'inline', verticalAlign: 'middle' }} viewBox="0 0 24 24" fill="none">
        <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </>
  );
}

function StepList({ steps }) {
  const ids = Object.keys(steps);
  if (!ids.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', margin: '0.75rem 0' }}>
      {ids.map(id => {
        const s = steps[id];
        return (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
            <span>{s.status === 'done' ? '✅' : s.status === 'active' ? <Spinner /> : '·'}</span>
            <span style={{ color: s.status === 'done' ? 'var(--text)' : 'var(--text-2)' }}>{s.message}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Keywords tab (editable) ─────────────────────────────────────────────────
const KW_BUCKETS = [
  ['primary', 'Primary', true, 2],
  ['secondary', 'Secondary', true, 10],
  ['local_modifier', 'Local modifier', true, null],
  ['semantic', 'Semantic', true, null],
  ['faq', 'FAQ', false, null],
  ['internal_linking', 'Internal linking', true, null],
  ['informational_low', 'Informational (low)', true, null],
  ['excluded', 'Excluded', false, null],
];

function KeywordsTab({ page, reload }) {
  const [steps, setSteps] = useState({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [ks, setKs] = useState(page.keyword_set);
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState({});
  const esRef = useRef(null);
  const finalized = ['Keywords Finalized', 'Content Generated', 'SEO Review', 'SEO Approved', 'Clinical Review', 'Clinical Approved', 'Content Review', 'Content Approved', 'Client Review', 'Client Approved', 'Exported'].includes(page.status);

  useEffect(() => { setKs(page.keyword_set); }, [page.keyword_set]);
  useEffect(() => () => esRef.current?.close(), []);

  async function run() {
    setRunning(true); setSteps({}); setError(''); setMsg('');
    try {
      const { token } = await lpb.runKeywords(page.id);
      esRef.current = openStream(token, {
        step: d => setSteps(prev => ({ ...prev, [d.id]: d })),
        fail: d => setError(d.message),
        done: () => { esRef.current?.close(); setRunning(false); reload(); },
      });
    } catch (e) { setError(e.message); setRunning(false); }
  }

  const kwStr = (k) => (typeof k === 'string' ? k : k.keyword);
  const isLocked = (k) => (ks.locked_keywords || []).includes(kwStr(k));

  function mutate(next) { setKs(next); setMsg(''); }
  function removeFrom(bucket, idx) {
    const next = { ...ks, [bucket]: ks[bucket].filter((_, i) => i !== idx) };
    mutate(next);
  }
  function addTo(bucket, isObj) {
    const val = (adding[bucket] || '').trim();
    if (!val) return;
    const item = isObj ? { keyword: val, volume: 0, difficulty: 0 } : val;
    mutate({ ...ks, [bucket]: [...(ks[bucket] || []), item] });
    setAdding(a => ({ ...a, [bucket]: '' }));
  }
  function move(from, to, idx) {
    const item = ks[from][idx];
    mutate({ ...ks, [from]: ks[from].filter((_, i) => i !== idx), [to]: [...(ks[to] || []), item] });
  }
  function toggleLock(k) {
    const s = kwStr(k);
    const locked = ks.locked_keywords || [];
    mutate({ ...ks, locked_keywords: locked.includes(s) ? locked.filter(x => x !== s) : [...locked, s] });
  }

  async function save() {
    setError(''); setMsg('');
    try { const saved = await lpb.saveKeywords(page.id, ks); setKs(saved); setMsg('Saved ✓'); reload(); }
    catch (e) { setError(e.message); }
  }
  async function finalize() {
    setError(''); setMsg('');
    try { await lpb.saveKeywords(page.id, ks); await lpb.finalizeKeywords(page.id); setMsg('Keywords finalized ✓ — open the Content tab to generate.'); reload(); }
    catch (e) { setError(e.message); }
  }

  const bucketView = ([key, label, isObj, cap]) => {
    const arr = ks[key] || [];
    const over = cap && arr.length > cap;
    return (
      <div style={{ marginBottom: '1rem' }} key={key}>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.375rem' }}>
          {label}{' '}
          <span style={{ color: over ? 'var(--danger,#EF4444)' : 'var(--text-3)' }}>({arr.length}{cap ? `/${cap}` : ''})</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', alignItems: 'center' }}>
          {arr.map((k, i) => (
            <span
              key={i}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '0.25rem',
                background: isLocked(k) ? '#FFFBEB' : 'var(--surface)',
                color: isLocked(k) ? '#92400E' : 'var(--text)',
                border: isLocked(k) ? '1px solid #FDE68A' : '1px solid var(--border)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {isObj && (
                <button title="lock/unlock" onClick={() => toggleLock(k)} style={{ opacity: 0.6, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  {isLocked(k) ? '🔒' : '🔓'}
                </button>
              )}
              <span>
                {kwStr(k)}
                {isObj && k.volume ? <span style={{ color: 'var(--text-3)' }}> · {k.volume}</span> : null}
              </span>
              {isObj && key === 'secondary' && (
                <button title="promote to primary" onClick={() => move('secondary', 'primary', i)} style={{ color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>↑</button>
              )}
              {isObj && key === 'primary' && (
                <button title="demote to secondary" onClick={() => move('primary', 'secondary', i)} style={{ color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>↓</button>
              )}
              <button title="remove" onClick={() => removeFrom(key, i)} style={{ color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>×</button>
            </span>
          ))}
          {!arr.length && <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>—</span>}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
            <input
              value={adding[key] || ''}
              onChange={e => setAdding(a => ({ ...a, [key]: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && addTo(key, isObj)}
              placeholder="+ add"
              style={{ fontSize: '0.75rem', border: '1px solid var(--border)', borderRadius: '0.25rem', padding: '0.25rem 0.375rem', width: '6rem', background: 'var(--card)', color: 'var(--text)' }}
            />
          </span>
        </div>
      </div>
    );
  };

  const primaryBtnStyle = (disabled) => ({
    padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 500, color: '#fff',
    background: 'var(--primary)', borderRadius: 'var(--r-md,6px)', border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  });
  const secondaryBtnStyle = {
    padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 500,
    border: '1px solid var(--border)', borderRadius: 'var(--r-md,6px)',
    background: 'var(--card)', color: 'var(--text)', cursor: 'pointer',
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-2)' }}>Stages 2–5: seeds → location-forced SERP → SEMrush → LLM prioritization. Edit, lock, promote/demote, then finalize.</p>
        <button onClick={run} disabled={running} style={primaryBtnStyle(running)}>
          {running ? 'Running…' : ks ? 'Re-run pipeline' : 'Run keyword pipeline'}
        </button>
      </div>
      {error && <p style={{ fontSize: '0.875rem', color: 'var(--danger,#EF4444)', marginBottom: '0.5rem' }}>{error}</p>}
      {msg && <p style={{ fontSize: '0.875rem', color: 'var(--success,#10B981)', marginBottom: '0.5rem' }}>{msg}</p>}
      <StepList steps={steps} />

      {ks && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '1.25rem', marginTop: '0.75rem' }}>
          {finalized && (
            <div style={{ fontSize: '0.75rem', color: 'var(--success,#065F46)', background: 'var(--success-soft,#ECFDF5)', borderRadius: '0.25rem', padding: '0.5rem 0.75rem', marginBottom: '0.75rem' }}>
              ✓ Keywords finalized (status: {page.status}). You can still edit and re-save.
            </div>
          )}
          {KW_BUCKETS.map(bucketView)}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>🔒 locked keywords survive a pipeline re-run.</span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={save} style={secondaryBtnStyle}>Save keywords</button>
              <button onClick={finalize} disabled={!(ks.primary || []).length} style={primaryBtnStyle(!(ks.primary || []).length)}>Save & finalize →</button>
            </div>
          </div>
        </div>
      )}

      {!!(page.competitor_analysis || []).length && (
        <div style={{ marginTop: '1.25rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Competitor URLs (scored)</div>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
            <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-2)', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '0.5rem 0.75rem' }}>Domain</th>
                  <th style={{ padding: '0.5rem 0.75rem' }}>Bucket</th>
                  <th style={{ padding: '0.5rem 0.75rem' }}>Score</th>
                  <th style={{ padding: '0.5rem 0.75rem' }}>Pos</th>
                </tr>
              </thead>
              <tbody>
                {page.competitor_analysis.map((u, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{u.domain}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-2)' }}>{u.bucket}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-2)' }}>{u.final_score}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-2)' }}>{u.average_position}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Content tab (full editor, matches the required section order) ────────────
const FAQ_TYPES = ['service', 'location', 'insurance', 'virtual', 'provider', 'appointment'];

// Module-scoped field helpers (defining these inside the component would remount
// them on every keystroke and steal focus).
const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' };
const inputStyle = { width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-md,6px)', padding: '0.5rem 0.75rem', fontSize: '0.875rem', background: 'var(--card)', color: 'var(--text)', boxSizing: 'border-box' };
const areaStyle = { width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-md,6px)', padding: '0.5rem 0.75rem', fontSize: '0.875rem', background: 'var(--card)', color: 'var(--text)', resize: 'vertical', boxSizing: 'border-box' };

const Label = ({ children }) => <label style={labelStyle}>{children}</label>;
const Area = ({ value, onChange, rows = 2 }) => <textarea rows={rows} style={areaStyle} value={value || ''} onChange={e => onChange(e.target.value)} />;
const Input = ({ value, onChange }) => <input style={inputStyle} value={value || ''} onChange={e => onChange(e.target.value)} />;

// ── Page Template Preview ─────────────────────────────────────────────────────

function PageTemplatePreview({ draft, page }) {
  const faqCount = (draft.faqs || []).length;
  const NAVY = '#0A2540';
  const PRIMARY = '#635BFF';
  const genWrap = { border: '2px solid rgba(220,38,38,0.35)', borderRadius: '6px', marginBottom: '0.5rem', overflow: 'hidden' };
  const tplWrap = { border: '2px solid rgba(109,40,217,0.22)', borderRadius: '6px', marginBottom: '0.5rem', overflow: 'hidden', opacity: 0.75 };
  const genHead = { background: 'rgba(220,38,38,0.06)', borderBottom: '1px solid rgba(220,38,38,0.15)', padding: '3px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
  const tplHead = { background: 'rgba(109,40,217,0.04)', borderBottom: '1px solid rgba(109,40,217,0.12)', padding: '3px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
  const lbl = (text, color) => <span style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color }}>{text}</span>;
  const genBadge = <span style={{ background: 'rgba(220,38,38,0.13)', color: '#DC2626', padding: '1px 6px', borderRadius: '3px', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Generated</span>;
  const tplBadge = <span style={{ background: 'rgba(109,40,217,0.10)', color: '#7C3AED', padding: '1px 6px', borderRadius: '3px', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Template</span>;
  const gbar = (w, h = 8) => ({ width: typeof w === 'number' ? `${w}px` : w, height: `${h}px`, background: 'var(--border)', borderRadius: '3px', display: 'block' });
  const dbar = (w, h = 8) => ({ width: typeof w === 'number' ? `${w}px` : w, height: `${h}px`, background: 'rgba(255,255,255,0.15)', borderRadius: '3px', display: 'block' });

  return (
    <div style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '0.875rem', marginBottom: '0.625rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', color: '#DC2626' }}>
          <div style={{ width: '10px', height: '10px', border: '2px solid rgba(220,38,38,0.5)', borderRadius: '2px', flexShrink: 0 }} />
          Generated content
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', color: '#7C3AED' }}>
          <div style={{ width: '10px', height: '10px', border: '2px solid rgba(109,40,217,0.4)', borderRadius: '2px', flexShrink: 0 }} />
          Template — not generated
        </div>
      </div>

      {/* SEO Metadata */}
      <div style={{ ...genWrap }}>
        <div style={{ ...genHead }}>{lbl('SEO Metadata — not rendered on page', '#DC2626')}{genBadge}</div>
        <div style={{ padding: '0.5rem 0.75rem', background: 'var(--card)' }}>
          <div style={{ marginBottom: '0.25rem' }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: '0.125rem' }}>Title Tag</div>
            <div style={{ color: 'var(--text)', fontWeight: 500, fontSize: '0.75rem' }}>{draft.meta_title || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.6rem', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: '0.125rem' }}>Meta Description</div>
            <div style={{ color: 'var(--text-2)', fontSize: '0.72rem' }}>{draft.meta_description || '—'}</div>
          </div>
        </div>
      </div>

      {/* 1. Navigation */}
      <div style={{ ...tplWrap }}>
        <div style={{ ...tplHead }}>{lbl('Navigation', '#7C3AED')}{tplBadge}</div>
        <div style={{ padding: '0.375rem 0.75rem', background: 'var(--card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ width: '52px', height: '14px', background: 'var(--border)', borderRadius: '3px' }} />
            {[40, 48, 56, 44].map((w, i) => <div key={i} style={{ width: `${w}px`, height: '8px', background: 'var(--border)', borderRadius: '3px' }} />)}
            <div style={{ marginLeft: 'auto', width: '60px', height: '20px', background: PRIMARY, borderRadius: '4px', opacity: 0.7 }} />
          </div>
        </div>
      </div>

      {/* 2. Hero Banner — GENERATED */}
      <div style={{ ...genWrap }}>
        <div style={{ ...genHead }}>{lbl('Hero Banner', '#DC2626')}{genBadge}</div>
        <div style={{ background: NAVY, padding: '0.875rem 1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '0.75rem', alignItems: 'start' }}>
            <div>
              <div style={{ display: 'flex', gap: '2px', marginBottom: '0.3rem', alignItems: 'center' }}>
                {[1,2,3,4,5].map(s => <span key={s} style={{ color: '#F59E0B', fontSize: '0.65rem' }}>★</span>)}
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.6rem', marginLeft: '0.25rem' }}>4.9 · 200+ reviews</span>
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#fff', lineHeight: 1.25, marginBottom: '0.375rem' }}>
                {draft.h1 || <span style={{ color: 'rgba(255,255,255,0.35)', fontStyle: 'italic', fontWeight: 400, fontSize: '0.75rem' }}>H1 not generated yet</span>}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.7rem', lineHeight: 1.5, marginBottom: '0.5rem' }}>
                {draft.hero_intro
                  ? (draft.hero_intro.length > 150 ? draft.hero_intro.slice(0, 150) + '…' : draft.hero_intro)
                  : <span style={{ color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>Hero intro not generated yet</span>}
              </div>
              <div style={{ display: 'flex', gap: '0.375rem' }}>
                <div style={{ background: PRIMARY, color: '#fff', fontSize: '0.62rem', fontWeight: 600, padding: '4px 10px', borderRadius: '4px' }}>Get Started</div>
                <div style={{ border: '1px solid rgba(255,255,255,0.3)', color: 'rgba(255,255,255,0.8)', fontSize: '0.62rem', fontWeight: 500, padding: '4px 10px', borderRadius: '4px' }}>Call Now</div>
              </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: '6px', minHeight: '88px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '0.25rem' }}>
              <div style={{ fontSize: '1rem' }}>🗺</div>
              <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>Map placeholder</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Sub Navigation */}
      <div style={{ ...tplWrap }}>
        <div style={{ ...tplHead }}>{lbl('Sub Navigation', '#7C3AED')}{tplBadge}</div>
        <div style={{ padding: '0.375rem 0.75rem', background: 'var(--card)' }}>
          <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
            {['Overview', 'Approach', 'Services', 'FAQs', 'Location'].map((t, i) => (
              <div key={i} style={{ fontSize: '0.62rem', padding: '2px 8px', borderRadius: '999px', background: i === 0 ? 'var(--border)' : 'var(--surface)', color: 'var(--text-3)', fontWeight: 500 }}>{t}</div>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Approach Section — GENERATED */}
      <div style={{ ...genWrap }}>
        <div style={{ ...genHead }}>{lbl('Approach Section', '#DC2626')}{genBadge}</div>
        <div style={{ padding: '0.625rem 0.75rem', background: 'var(--card)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '0.75rem', alignItems: 'start' }}>
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: PRIMARY, marginBottom: '0.25rem' }}>
                {draft.approach?.heading || <span style={{ color: 'var(--text-3)', fontStyle: 'italic', fontWeight: 400 }}>—</span>}
              </div>
              <div style={{ color: 'var(--text-2)', fontSize: '0.7rem', lineHeight: 1.5, marginBottom: '0.5rem' }}>
                {draft.approach?.intro
                  ? (draft.approach.intro.length > 120 ? draft.approach.intro.slice(0, 120) + '…' : draft.approach.intro)
                  : '—'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                {(draft.approach?.care_pillars || []).slice(0, 4).map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: '0.375rem', alignItems: 'flex-start' }}>
                    <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: PRIMARY, marginTop: '0.3rem', flexShrink: 0 }} />
                    <div style={{ fontSize: '0.7rem', color: 'var(--text)', fontWeight: 600 }}>{p.heading}</div>
                  </div>
                ))}
                {(draft.approach?.care_pillars || []).length > 4 && (
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-3)', marginLeft: '0.75rem' }}>+{draft.approach.care_pillars.length - 4} more</div>
                )}
              </div>
            </div>
            <div style={{ background: 'var(--surface)', borderRadius: '6px', minHeight: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '0.62rem', color: 'var(--text-3)', fontStyle: 'italic' }}>Photo</span>
            </div>
          </div>
        </div>
      </div>

      {/* 5. Why Choose */}
      <div style={{ ...tplWrap }}>
        <div style={{ ...tplHead }}>{lbl('Why Choose Brand', '#7C3AED')}{tplBadge}</div>
        <div style={{ padding: '0.5rem 0.75rem', background: 'var(--card)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{ width: '24px', height: '24px', background: 'var(--border)', borderRadius: '50%', margin: '0 auto 0.25rem' }} />
                <div style={{ ...gbar('70%', 8), margin: '0 auto 0.2rem' }} />
                <div style={{ ...gbar('50%'), margin: '0 auto' }} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 6. Statistics */}
      <div style={{ ...tplWrap, opacity: 1 }}>
        <div style={{ ...tplHead }}>{lbl('Statistics Section', '#7C3AED')}{tplBadge}</div>
        <div style={{ background: NAVY, padding: '0.625rem 0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-around', gap: '0.25rem', flexWrap: 'wrap' }}>
            {[['10+', 'Years'], ['92%', 'Success Rate'], ['16', 'Locations'], ['50+', 'Experts']].map(([n, l], i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1rem', fontWeight: 800, color: '#fff', lineHeight: 1.1 }}>{n}</div>
                <div style={{ fontSize: '0.58rem', color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 7. Condition / Service Deep-Dive — GENERATED */}
      {(draft.competitor_section?.blocks || []).length > 0 && (
        <div style={{ ...genWrap }}>
          <div style={{ ...genHead }}>{lbl('Condition / Service Section', '#DC2626')}{genBadge}</div>
          <div style={{ padding: '0.5rem 0.75rem', background: 'var(--card)' }}>
            {draft.competitor_section.blocks.map((blk, bi) => (
              <div key={bi} style={{ marginBottom: bi < draft.competitor_section.blocks.length - 1 ? '0.75rem' : 0 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.375rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.25rem' }}>{blk.h2 || '—'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem' }}>
                  {(blk.h3s || []).slice(0, 4).map((h, hi) => (
                    <div key={hi} style={{ background: 'var(--surface)', borderRadius: '4px', padding: '0.375rem 0.5rem' }}>
                      <div style={{ fontSize: '0.67rem', fontWeight: 700, color: PRIMARY, marginBottom: '2px' }}>{h.heading || '—'}</div>
                      <div style={{ fontSize: '0.63rem', color: 'var(--text-2)', lineHeight: 1.4 }}>
                        {h.copy ? (h.copy.length > 60 ? h.copy.slice(0, 60) + '…' : h.copy) : '—'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 8. Treatment Programs */}
      <div style={{ ...tplWrap }}>
        <div style={{ ...tplHead }}>{lbl('Treatment Programs', '#7C3AED')}{tplBadge}</div>
        <div style={{ padding: '0.5rem 0.75rem', background: 'var(--card)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.375rem' }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ background: 'var(--surface)', borderRadius: '5px', padding: '0.375rem' }}>
                <div style={{ width: '100%', height: '30px', background: 'var(--border)', borderRadius: '3px', marginBottom: '0.25rem' }} />
                <div style={{ ...gbar('80%'), marginBottom: '0.2rem' }} />
                <div style={gbar('55%')} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 9. Experts */}
      <div style={{ ...tplWrap }}>
        <div style={{ ...tplHead }}>{lbl('Experts Section', '#7C3AED')}{tplBadge}</div>
        <div style={{ padding: '0.5rem 0.75rem', background: 'var(--card)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.375rem' }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{ width: '36px', height: '36px', background: 'var(--border)', borderRadius: '50%', margin: '0 auto 0.25rem' }} />
                <div style={{ ...gbar('65%', 8), margin: '0 auto 0.2rem' }} />
                <div style={{ ...gbar('45%'), margin: '0 auto' }} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 10. Insurance */}
      <div style={{ ...tplWrap }}>
        <div style={{ ...tplHead }}>{lbl('Insurance Section', '#7C3AED')}{tplBadge}</div>
        <div style={{ padding: '0.375rem 0.75rem', background: 'var(--card)' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {[1,2,3,4,5].map(i => <div key={i} style={{ width: '48px', height: '18px', background: 'var(--border)', borderRadius: '3px' }} />)}
          </div>
        </div>
      </div>

      {/* 11. Testimonials */}
      <div style={{ ...tplWrap }}>
        <div style={{ ...tplHead }}>{lbl('Testimonials', '#7C3AED')}{tplBadge}</div>
        <div style={{ padding: '0.5rem 0.75rem', background: 'var(--card)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.375rem' }}>
            {[1,2].map(i => (
              <div key={i} style={{ background: 'var(--surface)', borderRadius: '5px', padding: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '2px', marginBottom: '0.25rem' }}>
                  {[1,2,3,4,5].map(s => <span key={s} style={{ color: '#F59E0B', fontSize: '0.62rem' }}>★</span>)}
                </div>
                <div style={{ ...gbar('100%'), marginBottom: '0.2rem' }} />
                <div style={{ ...gbar('80%'), marginBottom: '0.2rem' }} />
                <div style={gbar('60%')} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 12. Resources */}
      <div style={{ ...tplWrap }}>
        <div style={{ ...tplHead }}>{lbl('Resources Section', '#7C3AED')}{tplBadge}</div>
        <div style={{ padding: '0.5rem 0.75rem', background: 'var(--card)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.375rem' }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ background: 'var(--surface)', borderRadius: '5px', padding: '0.375rem' }}>
                <div style={{ width: '100%', height: '30px', background: 'var(--border)', borderRadius: '3px', marginBottom: '0.25rem' }} />
                <div style={{ display: 'flex', gap: '3px', marginBottom: '0.25rem' }}>
                  {['Blog', 'Guide'].map((t, ti) => <span key={ti} style={{ fontSize: '0.55rem', background: 'rgba(109,40,217,0.1)', color: '#7C3AED', padding: '1px 4px', borderRadius: '2px', fontWeight: 600 }}>{t}</span>)}
                </div>
                <div style={{ ...gbar('90%'), marginBottom: '0.2rem' }} />
                <div style={gbar('70%')} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 13. Form */}
      <div style={{ ...tplWrap }}>
        <div style={{ ...tplHead }}>{lbl('Contact Form Section', '#7C3AED')}{tplBadge}</div>
        <div style={{ padding: '0.5rem 0.75rem', background: 'var(--card)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {[1,2,3,4].map(i => <div key={i} style={{ height: '20px', background: 'var(--border)', borderRadius: '3px' }} />)}
              <div style={{ width: '72px', height: '24px', background: PRIMARY, borderRadius: '4px', marginTop: '0.125rem', opacity: 0.7 }} />
            </div>
            <div style={{ background: 'var(--surface)', borderRadius: '5px', padding: '0.5rem' }}>
              {[1,2,3].map(i => <div key={i} style={{ ...gbar(i === 1 ? '65%' : i === 2 ? '80%' : '50%'), marginBottom: '0.25rem' }} />)}
            </div>
          </div>
        </div>
      </div>

      {/* 14. FAQ Section — GENERATED */}
      <div style={{ ...genWrap }}>
        <div style={{ ...genHead }}>{lbl(`FAQ Section (${faqCount} FAQs — target 7–11)`, '#DC2626')}{genBadge}</div>
        <div style={{ padding: '0.5rem 0.75rem', background: 'var(--card)' }}>
          {faqCount === 0
            ? <div style={{ color: 'var(--text-3)', fontSize: '0.75rem', fontStyle: 'italic' }}>No FAQs generated yet.</div>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                {draft.faqs.slice(0, 5).map((f, i) => (
                  <div key={i} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.375rem' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.375rem', marginBottom: '0.125rem' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.72rem' }}>{f.question}</div>
                      <span style={{ fontSize: '0.55rem', fontWeight: 700, textTransform: 'uppercase', background: 'rgba(109,40,217,0.08)', color: '#7C3AED', padding: '1px 4px', borderRadius: '2px', whiteSpace: 'nowrap', flexShrink: 0 }}>{f.faq_type}</span>
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-2)', lineHeight: 1.5 }}>
                      {f.answer?.length > 120 ? f.answer.slice(0, 120) + '…' : f.answer}
                    </div>
                  </div>
                ))}
                {faqCount > 5 && <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', textAlign: 'center' }}>+{faqCount - 5} more FAQs</div>}
              </div>
            )
          }
        </div>
      </div>

      {/* 15. Footer */}
      <div style={{ ...tplWrap, opacity: 1 }}>
        <div style={{ ...tplHead }}>{lbl('Footer', '#7C3AED')}{tplBadge}</div>
        <div style={{ background: NAVY, padding: '0.625rem 0.75rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: '0.75rem' }}>
            <div>
              <div style={{ ...dbar(44, 14), borderRadius: '3px', marginBottom: '0.375rem' }} />
              {[68, 60, 52].map((w, i) => <div key={i} style={{ ...dbar(w), marginBottom: '0.2rem' }} />)}
            </div>
            {[1,2,3].map(col => (
              <div key={col}>
                <div style={{ ...dbar(44, 8), borderRadius: '2px', marginBottom: '0.375rem' }} />
                {[56, 64, 48, 44].map((w, i) => <div key={i} style={{ ...dbar(w), marginBottom: '0.2rem' }} />)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ContentTab({ page, reload }) {
  const [steps, setSteps] = useState({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(null);
  const esRef = useRef(null);
  const po = page.page_object;
  const finalized = ['Keywords Finalized', 'Content Generated', 'SEO Review', 'SEO Approved', 'Clinical Review', 'Clinical Approved', 'Content Review', 'Content Approved', 'Client Review', 'Client Approved', 'Exported'].includes(page.status);

  // Load an editable deep-copy of page_data whenever the generated content changes.
  useEffect(() => {
    if (po) setDraft(JSON.parse(JSON.stringify({
      meta_title: po.page_data.meta_title, meta_description: po.page_data.meta_description,
      h1: po.page_data.h1, hero_intro: po.page_data.hero_intro,
      approach: po.page_data.approach, competitor_section: po.page_data.competitor_section || { blocks: [] },
      faqs: po.page_data.faqs || [],
    })));
  }, [po?.meta?.version_no, po?.page_data?.h1, page.updated_at]);

  async function run() {
    setRunning(true); setSteps({}); setError(''); setMsg('');
    try {
      const { token } = await lpb.runContent(page.id);
      esRef.current = openStream(token, {
        step: d => setSteps(prev => ({ ...prev, [d.id]: d })),
        fail: d => setError(d.message),
        done: () => { esRef.current?.close(); setRunning(false); reload(); },
      });
    } catch (e) { setError(e.message); setRunning(false); }
  }
  useEffect(() => () => esRef.current?.close(), []);

  async function saveAll() {
    setSaving(true); setError(''); setMsg('');
    try { const r = await lpb.saveContent(page.id, draft); setMsg(`Saved ✓ — QA: ${r.qa.blocking_failures} blocking. Cleared gates were reset.`); reload(); }
    catch (e) { setError(e.message); }
    setSaving(false);
  }

  if (!finalized && !po) return <p style={{ fontSize: '0.875rem', color: 'var(--text-2)' }}>Finalize keywords first, then generate content.</p>;

  const set = (patch) => setDraft(d => ({ ...d, ...patch }));

  // competitor_section helpers
  const blocks = draft?.competitor_section?.blocks || [];
  const setBlocks = (b) => set({ competitor_section: { ...draft.competitor_section, blocks: b } });
  const updBlock = (bi, patch) => setBlocks(blocks.map((b, i) => i === bi ? { ...b, ...patch } : b));
  const updH3 = (bi, hi, patch) => updBlock(bi, { h3s: blocks[bi].h3s.map((h, i) => i === hi ? { ...h, ...patch } : h) });

  const primaryBtnStyle = (disabled) => ({
    padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 500, color: '#fff',
    background: 'var(--primary)', borderRadius: 'var(--r-md,6px)', border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-2)' }}>Stage 7: layer-aware generation. Edit any field below; Save resets cleared gates &amp; re-runs QA.</p>
        <button onClick={run} disabled={running} style={primaryBtnStyle(running)}>
          {running ? 'Generating…' : po ? 'Regenerate content' : 'Generate content'}
        </button>
      </div>
      {error && <p style={{ fontSize: '0.875rem', color: 'var(--danger,#EF4444)', marginBottom: '0.5rem' }}>{error}</p>}
      {msg && <p style={{ fontSize: '0.875rem', color: 'var(--success,#10B981)', marginBottom: '0.5rem' }}>{msg}</p>}
      <StepList steps={steps} />

      {po && draft && (
        <>
          {page.qa_result && <QAPanel qa={page.qa_result} />}
          <div style={{ display: 'grid', gridTemplateColumns: '55fr 45fr', gap: '1.25rem', marginTop: '0.75rem', alignItems: 'start' }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div><Label>Meta title</Label><Input value={draft.meta_title} onChange={v => set({ meta_title: v })} /></div>
            <div><Label>Meta description</Label><Area value={draft.meta_description} onChange={v => set({ meta_description: v })} /></div>
            <div><Label>H1 heading</Label><Input value={draft.h1} onChange={v => set({ h1: v })} /></div>
            <div><Label>Hero intro</Label><Area value={draft.hero_intro} onChange={v => set({ hero_intro: v })} rows={3} /></div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
              <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text)', marginBottom: '0.5rem' }}>H2: {draft.approach.heading}</div>
              <Label>Approach intro</Label>
              <Area value={draft.approach.intro} onChange={v => set({ approach: { ...draft.approach, intro: v } })} rows={2} />
              {draft.approach.care_pillars.map((p, i) => (
                <div key={i} style={{ marginTop: '0.75rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text)', marginBottom: '0.25rem' }}>H3: {p.heading}</div>
                  <Area value={p.copy} onChange={v => set({ approach: { ...draft.approach, care_pillars: draft.approach.care_pillars.map((x, j) => j === i ? { ...x, copy: v } : x) } })} rows={3} />
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text)' }}>
                  Competitor-based section{' '}
                  <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-3)' }}>(≥1 H2 + 3 H3s; recommended 2 H2 + 5 H3s)</span>
                </div>
                <button onClick={() => setBlocks([...blocks, { h2: '', h3s: [{ heading: '', copy: '' }] }])} style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer' }}>+ Add H2 block</button>
              </div>
              {blocks.map((b, bi) => (
                <div key={bi} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md,6px)', padding: '0.75rem', marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-3)', width: '1.75rem' }}>H2</span>
                    <input style={{ ...inputStyle, flex: 1, fontWeight: 500 }} value={b.h2} onChange={e => updBlock(bi, { h2: e.target.value })} placeholder="H2 heading" />
                    <button onClick={() => setBlocks(blocks.filter((_, i) => i !== bi))} style={{ color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem' }}>×</button>
                  </div>
                  {(b.h3s || []).map((h, hi) => (
                    <div key={hi} style={{ marginLeft: '1.75rem', marginBottom: '0.5rem', borderLeft: '2px solid var(--border)', paddingLeft: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-3)', width: '1.75rem' }}>H3</span>
                        <input style={{ ...inputStyle, flex: 1 }} value={h.heading} onChange={e => updH3(bi, hi, { heading: e.target.value })} placeholder="H3 heading" />
                        <button onClick={() => updBlock(bi, { h3s: b.h3s.filter((_, i) => i !== hi) })} style={{ color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem' }}>×</button>
                      </div>
                      <textarea rows={2} style={areaStyle} value={h.copy} onChange={e => updH3(bi, hi, { copy: e.target.value })} placeholder="H3 copy" />
                    </div>
                  ))}
                  <button onClick={() => updBlock(bi, { h3s: [...(b.h3s || []), { heading: '', copy: '' }] })} style={{ marginLeft: '1.75rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer' }}>+ Add H3</button>
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text)' }}>
                  FAQs{' '}
                  <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-3)' }}>({draft.faqs.length} — target 7-11)</span>
                </div>
                <button onClick={() => set({ faqs: [...draft.faqs, { question: '', answer: '', faq_type: 'service' }] })} style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer' }}>+ Add FAQ</button>
              </div>
              {draft.faqs.map((f, i) => (
                <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md,6px)', padding: '0.75rem', marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <input style={{ ...inputStyle, flex: 1, fontWeight: 500 }} value={f.question} onChange={e => set({ faqs: draft.faqs.map((x, j) => j === i ? { ...x, question: e.target.value } : x) })} placeholder="Question" />
                    <select style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md,6px)', padding: '0.375rem 0.5rem', fontSize: '0.75rem', background: 'var(--card)', color: 'var(--text)' }} value={f.faq_type} onChange={e => set({ faqs: draft.faqs.map((x, j) => j === i ? { ...x, faq_type: e.target.value } : x) })}>
                      {FAQ_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <button onClick={() => set({ faqs: draft.faqs.filter((_, j) => j !== i) })} style={{ color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem' }}>×</button>
                  </div>
                  <textarea rows={2} style={areaStyle} value={f.answer} onChange={e => set({ faqs: draft.faqs.map((x, j) => j === i ? { ...x, answer: e.target.value } : x) })} placeholder="Answer" />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
              <button onClick={saveAll} disabled={saving} style={primaryBtnStyle(saving)}>{saving ? 'Saving…' : 'Save content changes'}</button>
            </div>
          </div>
          <div style={{ position: 'sticky', top: '1rem', maxHeight: 'calc(100vh - 6rem)', overflowY: 'auto' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: '0.5rem', padding: '0 0.125rem' }}>Page Template Placement</div>
            <PageTemplatePreview draft={draft} page={page} />
          </div>
          </div>
        </>
      )}
    </div>
  );
}

function QAPanel({ qa }) {
  const passing = !qa.blocking_failures;
  return (
    <div style={{
      border: `1px solid ${passing ? 'var(--success,#10B981)' : 'var(--danger,#EF4444)'}`,
      borderRadius: 'var(--r-lg)',
      padding: '1rem',
      background: passing ? 'var(--success-soft,#ECFDF5)' : 'var(--danger-soft,#FEF2F2)',
    }}>
      <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text)' }}>
        {passing ? '✓ QA clean' : `⛔ ${qa.blocking_failures} blocking failure(s)`}
        {qa.warnings ? ` · ${qa.warnings} warning(s)` : ''}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        {qa.checks.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.75rem' }}>
            <span>{c.passed ? '✓' : c.severity === 'block' ? '⛔' : '⚠'}</span>
            <span style={{ color: 'var(--text)' }}><span style={{ fontWeight: 500 }}>{c.key}</span> — {c.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Schema tab ──────────────────────────────────────────────────────────────
function SchemaTab({ page }) {
  const schema = page.page_object?.page_data?.schema;
  if (!schema) return <p style={{ fontSize: '0.875rem', color: 'var(--text-2)' }}>Generate content to produce schema.</p>;
  return (
    <pre style={{ background: '#1E1E1E', color: '#D4D4D4', fontSize: '0.75rem', borderRadius: 'var(--r-lg)', padding: '1rem', overflow: 'auto', maxHeight: '600px', fontFamily: 'var(--font-mono)' }}>
      {JSON.stringify(schema, null, 2)}
    </pre>
  );
}

// ── Approval tab ──────────────────────────────────────────────────────────
const GATE_ROLE = { seo: 'seo', clinical: 'clinical', content: 'content', client: 'account_owner' };

function ApprovalTab({ page, reload }) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const gates = Object.keys(page.approval_status).filter(g => page.approval_status[g] !== 'n/a');

  async function act(gate, action) {
    setError('');
    try { await lpb.gate(page.id, { gate, action, role: GATE_ROLE[gate], comment }); setComment(''); reload(); }
    catch (e) { setError(e.message); }
  }

  const gateStatusColor = (st) => {
    if (st === 'approved') return 'var(--success,#10B981)';
    if (st === 'rejected') return 'var(--danger,#EF4444)';
    return 'var(--text-3)';
  };

  return (
    <div>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-2)', marginBottom: '1rem' }}>Sequential gates with reject-back. SEO requires QA blocking_failures = 0. Editing content resets cleared gates.</p>
      {error && <p style={{ fontSize: '0.875rem', color: 'var(--danger,#EF4444)', marginBottom: '0.5rem' }}>{error}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
        {gates.map(g => {
          const st = page.approval_status[g];
          return (
            <div key={g} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '0.75rem 1rem' }}>
              <div>
                <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)', textTransform: 'capitalize' }}>{g}</span>
                <span style={{ fontSize: '0.75rem', marginLeft: '0.5rem', color: gateStatusColor(st) }}>● {st}</span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => act(g, 'approve')}
                  style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem', fontWeight: 500, color: '#fff', background: 'var(--primary)', borderRadius: 'var(--r-md,6px)', border: 'none', cursor: 'pointer' }}
                >
                  Approve
                </button>
                <button
                  onClick={() => act(g, 'reject')}
                  style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--danger,#EF4444)', border: '1px solid var(--danger,#FECACA)', borderRadius: 'var(--r-md,6px)', background: 'var(--card)', cursor: 'pointer' }}
                >
                  Reject
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder="Comment (attached to the approval action)…"
        rows={2}
        style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-md,6px)', padding: '0.5rem 0.75rem', fontSize: '0.875rem', background: 'var(--card)', color: 'var(--text)', marginBottom: '1rem', boxSizing: 'border-box', resize: 'vertical' }}
      />

      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Audit trail</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        {(page.approval_records || []).slice().reverse().map(r => (
          <div key={r.id} style={{ fontSize: '0.75rem', color: 'var(--text-2)' }}>
            <span style={{ color: r.action === 'approve' ? 'var(--success,#10B981)' : 'var(--danger,#EF4444)' }}>{r.action}</span>
            {' · '}<span style={{ textTransform: 'capitalize' }}>{r.gate}</span>
            {' · '}{r.actor_id}
            {' · '}{new Date(r.created_at).toLocaleString()}
            {r.comment ? ` — "${r.comment}"` : ''}
          </div>
        ))}
        {!(page.approval_records || []).length && <p style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>No actions yet.</p>}
      </div>
    </div>
  );
}

// ── Export tab ──────────────────────────────────────────────────────────────
function ExportTab({ page }) {
  if (!page.page_object) return <p style={{ fontSize: '0.875rem', color: 'var(--text-2)' }}>Generate content first.</p>;
  const btn = (fmt, label) => (
    <a
      href={lpb.exportUrl(page.id, fmt)}
      style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 500, color: '#fff', background: 'var(--primary)', borderRadius: 'var(--r-md,6px)', display: 'inline-block', textDecoration: 'none' }}
      download
    >
      {label}
    </a>
  );
  return (
    <div>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-2)', marginBottom: '1rem' }}>Exports the current page version and stamps it with the approval snapshot.</p>
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {btn('json', 'Download JSON')}
        {btn('markdown', 'Download Markdown')}
        {btn('docx', 'Download DOCX')}
      </div>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Version history</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        {(page.versions || []).slice().reverse().map(v => (
          <div key={v.id} style={{ fontSize: '0.75rem', color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
            v{v.version_no} · {(v.exported_formats || []).join(', ') || 'snapshot'} · {new Date(v.created_at).toLocaleString()}
          </div>
        ))}
        {!(page.versions || []).length && <p style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>No versions exported yet.</p>}
      </div>
    </div>
  );
}

export default function LocationPageDetailPage() {
  const { id } = useParams();
  const [page, setPage] = useState(null);
  const [tab, setTab] = useState('Keywords');
  const [error, setError] = useState('');

  async function reload() {
    try { setPage(await lpb.page(id)); } catch (e) { setError(e.message); }
  }
  useEffect(() => { reload(); }, [id]);

  if (error) return <div style={{ padding: '2rem', color: 'var(--danger,#EF4444)' }}>{error}</div>;
  if (!page) return <div style={{ padding: '2rem', color: 'var(--text-2)' }}>Loading…</div>;

  const po = page.page_object;
  const title = po ? `${po.service_data.service_name} in ${po.location_data.location_name}` : 'Page';

  return (
    <main style={{ maxWidth: '64rem', margin: '0 auto', padding: '1.5rem 2rem' }}>
      {!page.eligibility?.eligible && (
        <div style={{ background: 'var(--danger-soft,#FEF2F2)', color: 'var(--danger,#EF4444)', fontSize: '0.875rem', borderRadius: 'var(--r-md,6px)', padding: '0.75rem', marginBottom: '1rem' }}>
          ⛔ {page.eligibility?.reason}
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--border)', marginBottom: '1.25rem' }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--primary)' : '2px solid transparent',
              marginBottom: '-1px',
              background: 'none',
              color: tab === t ? 'var(--primary)' : 'var(--text-3)',
              cursor: 'pointer',
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Keywords' && <KeywordsTab page={page} reload={reload} />}
      {tab === 'Content' && <ContentTab page={page} reload={reload} />}
      {tab === 'Schema' && <SchemaTab page={page} />}
      {tab === 'Approval' && <ApprovalTab page={page} reload={reload} />}
      {tab === 'Export' && <ExportTab page={page} />}
    </main>
  );
}
