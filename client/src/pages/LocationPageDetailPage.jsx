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
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '1.25rem', marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
