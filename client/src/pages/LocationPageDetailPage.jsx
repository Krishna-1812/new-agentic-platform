import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { lpb, openStream } from '../lib/lpbApi';

const TEAL = '#3DAA8E';
const TABS = ['Keywords', 'Content', 'Schema', 'Approval', 'Export'];

function Spinner() {
  return <svg className="animate-spin w-4 h-4 inline" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>;
}

function StepList({ steps }) {
  const ids = Object.keys(steps);
  if (!ids.length) return null;
  return (
    <div className="space-y-1.5 my-3">
      {ids.map(id => {
        const s = steps[id];
        return (
          <div key={id} className="flex items-center gap-2 text-sm">
            <span>{s.status === 'done' ? '✅' : s.status === 'active' ? <Spinner /> : '·'}</span>
            <span className={s.status === 'done' ? 'text-[#111827]' : 'text-[#6B7280]'}>{s.message}</span>
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
      <div className="mb-4" key={key}>
        <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-1.5">
          {label} <span className={over ? 'text-red-500' : 'text-[#9CA3AF]'}>({arr.length}{cap ? `/${cap}` : ''})</span>
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          {arr.map((k, i) => (
            <span key={i} className={`group inline-flex items-center gap-1 text-xs px-2 py-1 rounded ${isLocked(k) ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-[#F4F5F7] text-[#374151]'}`}>
              {isObj && <button title="lock/unlock" onClick={() => toggleLock(k)} className="opacity-60 hover:opacity-100">{isLocked(k) ? '🔒' : '🔓'}</button>}
              <span>{kwStr(k)}{isObj && k.volume ? <span className="text-[#9CA3AF]"> · {k.volume}</span> : null}</span>
              {isObj && key === 'secondary' && <button title="promote to primary" onClick={() => move('secondary', 'primary', i)} className="text-[#3DAA8E]">↑</button>}
              {isObj && key === 'primary' && <button title="demote to secondary" onClick={() => move('primary', 'secondary', i)} className="text-[#9CA3AF]">↓</button>}
              <button title="remove" onClick={() => removeFrom(key, i)} className="text-[#9CA3AF] hover:text-red-500">×</button>
            </span>
          ))}
          {!arr.length && <span className="text-xs text-[#9CA3AF]">—</span>}
          <span className="inline-flex items-center gap-1">
            <input value={adding[key] || ''} onChange={e => setAdding(a => ({ ...a, [key]: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && addTo(key, isObj)} placeholder="+ add"
              className="text-xs border border-[#E5E7EB] rounded px-1.5 py-1 w-24" />
          </span>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-[#6B7280]">Stages 2–5: seeds → location-forced SERP → SEMrush → LLM prioritization. Edit, lock, promote/demote, then finalize.</p>
        <button onClick={run} disabled={running} className="px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50" style={{ backgroundColor: TEAL }}>
          {running ? 'Running…' : ks ? 'Re-run pipeline' : 'Run keyword pipeline'}
        </button>
      </div>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      {msg && <p className="text-sm text-green-600 mb-2">{msg}</p>}
      <StepList steps={steps} />

      {ks && (
        <div className="bg-white border border-[#E5E7EB] rounded-lg p-5 mt-3">
          {finalized && <div className="text-xs text-green-700 bg-green-50 rounded px-3 py-2 mb-3">✓ Keywords finalized (status: {page.status}). You can still edit and re-save.</div>}
          {KW_BUCKETS.map(bucketView)}
          <div className="flex justify-between items-center pt-2 border-t border-[#F1F1F1]">
            <span className="text-xs text-[#9CA3AF]">🔒 locked keywords survive a pipeline re-run.</span>
            <div className="flex gap-2">
              <button onClick={save} className="px-4 py-2 text-sm font-medium border border-[#E5E7EB] rounded-md text-[#374151]">Save keywords</button>
              <button onClick={finalize} disabled={!(ks.primary || []).length} className="px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50" style={{ backgroundColor: TEAL }}>Save & finalize →</button>
            </div>
          </div>
        </div>
      )}

      {!!(page.competitor_analysis || []).length && (
        <div className="mt-5">
          <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-2">Competitor URLs (scored)</div>
          <div className="bg-white border border-[#E5E7EB] rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-[#6B7280] bg-[#FAFAFA] border-b border-[#E5E7EB]"><th className="px-3 py-2">Domain</th><th className="px-3 py-2">Bucket</th><th className="px-3 py-2">Score</th><th className="px-3 py-2">Pos</th></tr></thead>
              <tbody>
                {page.competitor_analysis.map((u, i) => (
                  <tr key={i} className="border-b border-[#F1F1F1]"><td className="px-3 py-2 text-[#374151]">{u.domain}</td><td className="px-3 py-2">{u.bucket}</td><td className="px-3 py-2">{u.final_score}</td><td className="px-3 py-2">{u.average_position}</td></tr>
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
const Label = ({ children }) => <label className="block text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-1">{children}</label>;
const Area = ({ value, onChange, rows = 2 }) => <textarea rows={rows} className="w-full border border-[#E5E7EB] rounded-md px-3 py-2 text-sm" value={value || ''} onChange={e => onChange(e.target.value)} />;
const Input = ({ value, onChange }) => <input className="w-full border border-[#E5E7EB] rounded-md px-3 py-2 text-sm" value={value || ''} onChange={e => onChange(e.target.value)} />;

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

  if (!finalized && !po) return <p className="text-sm text-[#6B7280]">Finalize keywords first, then generate content.</p>;

  const set = (patch) => setDraft(d => ({ ...d, ...patch }));

  // competitor_section helpers
  const blocks = draft?.competitor_section?.blocks || [];
  const setBlocks = (b) => set({ competitor_section: { ...draft.competitor_section, blocks: b } });
  const updBlock = (bi, patch) => setBlocks(blocks.map((b, i) => i === bi ? { ...b, ...patch } : b));
  const updH3 = (bi, hi, patch) => updBlock(bi, { h3s: blocks[bi].h3s.map((h, i) => i === hi ? { ...h, ...patch } : h) });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-[#6B7280]">Stage 7: layer-aware generation. Edit any field below; Save resets cleared gates & re-runs QA.</p>
        <button onClick={run} disabled={running} className="px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50" style={{ backgroundColor: TEAL }}>
          {running ? 'Generating…' : po ? 'Regenerate content' : 'Generate content'}
        </button>
      </div>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      {msg && <p className="text-sm text-green-600 mb-2">{msg}</p>}
      <StepList steps={steps} />

      {po && draft && (
        <>
          {page.qa_result && <QAPanel qa={page.qa_result} />}
          <div className="bg-white border border-[#E5E7EB] rounded-lg p-5 mt-3 space-y-4">
            <div><Label>Meta title</Label><Input value={draft.meta_title} onChange={v => set({ meta_title: v })} /></div>
            <div><Label>Meta description</Label><Area value={draft.meta_description} onChange={v => set({ meta_description: v })} /></div>
            <div><Label>H1 heading</Label><Input value={draft.h1} onChange={v => set({ h1: v })} /></div>
            <div><Label>Hero intro</Label><Area value={draft.hero_intro} onChange={v => set({ hero_intro: v })} rows={3} /></div>

            <div className="border-t border-[#F1F1F1] pt-4">
              <div className="text-sm font-bold text-[#111827] mb-2">H2: {draft.approach.heading}</div>
              <Label>Approach intro</Label><Area value={draft.approach.intro} onChange={v => set({ approach: { ...draft.approach, intro: v } })} rows={2} />
              {draft.approach.care_pillars.map((p, i) => (
                <div key={i} className="mt-3">
                  <div className="text-xs font-semibold text-[#374151] mb-1">H3: {p.heading}</div>
                  <Area value={p.copy} onChange={v => set({ approach: { ...draft.approach, care_pillars: draft.approach.care_pillars.map((x, j) => j === i ? { ...x, copy: v } : x) } })} rows={3} />
                </div>
              ))}
            </div>

            <div className="border-t border-[#F1F1F1] pt-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-bold text-[#111827]">Competitor-based section <span className="text-xs font-normal text-[#9CA3AF]">(≥1 H2 + 3 H3s; recommended 2 H2 + 5 H3s)</span></div>
                <button onClick={() => setBlocks([...blocks, { h2: '', h3s: [{ heading: '', copy: '' }] }])} className="text-xs font-medium" style={{ color: TEAL }}>+ Add H2 block</button>
              </div>
              {blocks.map((b, bi) => (
                <div key={bi} className="border border-[#E5E7EB] rounded-md p-3 mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-[#9CA3AF] w-7">H2</span>
                    <input className="flex-1 border border-[#E5E7EB] rounded-md px-3 py-2 text-sm font-medium" value={b.h2} onChange={e => updBlock(bi, { h2: e.target.value })} placeholder="H2 heading" />
                    <button onClick={() => setBlocks(blocks.filter((_, i) => i !== bi))} className="text-[#9CA3AF] hover:text-red-500 text-sm">×</button>
                  </div>
                  {(b.h3s || []).map((h, hi) => (
                    <div key={hi} className="ml-7 mb-2 border-l-2 border-[#F1F1F1] pl-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-[#9CA3AF] w-7">H3</span>
                        <input className="flex-1 border border-[#E5E7EB] rounded-md px-2 py-1.5 text-sm" value={h.heading} onChange={e => updH3(bi, hi, { heading: e.target.value })} placeholder="H3 heading" />
                        <button onClick={() => updBlock(bi, { h3s: b.h3s.filter((_, i) => i !== hi) })} className="text-[#9CA3AF] hover:text-red-500 text-sm">×</button>
                      </div>
                      <textarea rows={2} className="w-full border border-[#E5E7EB] rounded-md px-2 py-1.5 text-sm" value={h.copy} onChange={e => updH3(bi, hi, { copy: e.target.value })} placeholder="H3 copy" />
                    </div>
                  ))}
                  <button onClick={() => updBlock(bi, { h3s: [...(b.h3s || []), { heading: '', copy: '' }] })} className="ml-7 text-xs font-medium" style={{ color: TEAL }}>+ Add H3</button>
                </div>
              ))}
            </div>

            <div className="border-t border-[#F1F1F1] pt-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-bold text-[#111827]">FAQs <span className="text-xs font-normal text-[#9CA3AF]">({draft.faqs.length} — target 7-11)</span></div>
                <button onClick={() => set({ faqs: [...draft.faqs, { question: '', answer: '', faq_type: 'service' }] })} className="text-xs font-medium" style={{ color: TEAL }}>+ Add FAQ</button>
              </div>
              {draft.faqs.map((f, i) => (
                <div key={i} className="border border-[#E5E7EB] rounded-md p-3 mb-2">
                  <div className="flex items-center gap-2 mb-1">
                    <input className="flex-1 border border-[#E5E7EB] rounded-md px-2 py-1.5 text-sm font-medium" value={f.question} onChange={e => set({ faqs: draft.faqs.map((x, j) => j === i ? { ...x, question: e.target.value } : x) })} placeholder="Question" />
                    <select className="border border-[#E5E7EB] rounded-md px-2 py-1.5 text-xs" value={f.faq_type} onChange={e => set({ faqs: draft.faqs.map((x, j) => j === i ? { ...x, faq_type: e.target.value } : x) })}>
                      {FAQ_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <button onClick={() => set({ faqs: draft.faqs.filter((_, j) => j !== i) })} className="text-[#9CA3AF] hover:text-red-500 text-sm">×</button>
                  </div>
                  <textarea rows={2} className="w-full border border-[#E5E7EB] rounded-md px-2 py-1.5 text-sm" value={f.answer} onChange={e => set({ faqs: draft.faqs.map((x, j) => j === i ? { ...x, answer: e.target.value } : x) })} placeholder="Answer" />
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2 border-t border-[#F1F1F1]">
              <button onClick={saveAll} disabled={saving} className="px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50" style={{ backgroundColor: TEAL }}>{saving ? 'Saving…' : 'Save content changes'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function QAPanel({ qa }) {
  return (
    <div className={`border rounded-lg p-4 ${qa.blocking_failures ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
      <div className="text-sm font-semibold mb-2">{qa.blocking_failures ? `⛔ ${qa.blocking_failures} blocking failure(s)` : '✓ QA clean'}{qa.warnings ? ` · ${qa.warnings} warning(s)` : ''}</div>
      <div className="space-y-1">
        {qa.checks.map((c, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <span>{c.passed ? '✓' : c.severity === 'block' ? '⛔' : '⚠'}</span>
            <span className="text-[#374151]"><span className="font-medium">{c.key}</span> — {c.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Schema tab ──────────────────────────────────────────────────────────────
function SchemaTab({ page }) {
  const schema = page.page_object?.page_data?.schema;
  if (!schema) return <p className="text-sm text-[#6B7280]">Generate content to produce schema.</p>;
  return <pre className="bg-[#1E1E1E] text-[#D4D4D4] text-xs rounded-lg p-4 overflow-auto max-h-[600px]">{JSON.stringify(schema, null, 2)}</pre>;
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

  return (
    <div>
      <p className="text-sm text-[#6B7280] mb-4">Sequential gates with reject-back. SEO requires QA blocking_failures = 0. Editing content resets cleared gates.</p>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      <div className="space-y-2 mb-5">
        {gates.map(g => {
          const st = page.approval_status[g];
          const color = st === 'approved' ? '#10B981' : st === 'rejected' ? '#EF4444' : '#9CA3AF';
          return (
            <div key={g} className="flex items-center justify-between bg-white border border-[#E5E7EB] rounded-lg px-4 py-3">
              <div><span className="text-sm font-medium text-[#111827] capitalize">{g}</span> <span className="text-xs ml-2" style={{ color }}>● {st}</span></div>
              <div className="flex gap-2">
                <button onClick={() => act(g, 'approve')} className="px-3 py-1.5 text-xs font-medium text-white rounded-md" style={{ backgroundColor: TEAL }}>Approve</button>
                <button onClick={() => act(g, 'reject')} className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-md">Reject</button>
              </div>
            </div>
          );
        })}
      </div>
      <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Comment (attached to the approval action)…" rows={2} className="w-full border border-[#E5E7EB] rounded-md px-3 py-2 text-sm mb-4" />

      <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-2">Audit trail</div>
      <div className="space-y-1.5">
        {(page.approval_records || []).slice().reverse().map(r => (
          <div key={r.id} className="text-xs text-[#6B7280]"><span className={r.action === 'approve' ? 'text-green-600' : 'text-red-600'}>{r.action}</span> · <span className="capitalize">{r.gate}</span> · {r.actor_id} · {new Date(r.created_at).toLocaleString()}{r.comment ? ` — "${r.comment}"` : ''}</div>
        ))}
        {!(page.approval_records || []).length && <p className="text-xs text-[#9CA3AF]">No actions yet.</p>}
      </div>
    </div>
  );
}

// ── Export tab ──────────────────────────────────────────────────────────────
function ExportTab({ page }) {
  if (!page.page_object) return <p className="text-sm text-[#6B7280]">Generate content first.</p>;
  const btn = (fmt, label) => <a href={lpb.exportUrl(page.id, fmt)} className="px-4 py-2 text-sm font-medium text-white rounded-md inline-block" style={{ backgroundColor: TEAL }} download>{label}</a>;
  return (
    <div>
      <p className="text-sm text-[#6B7280] mb-4">Exports the current page version and stamps it with the approval snapshot.</p>
      <div className="flex gap-3 mb-6">{btn('json', 'Download JSON')}{btn('markdown', 'Download Markdown')}{btn('docx', 'Download DOCX')}</div>
      <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-2">Version history</div>
      <div className="space-y-1.5">
        {(page.versions || []).slice().reverse().map(v => <div key={v.id} className="text-xs text-[#6B7280]">v{v.version_no} · {(v.exported_formats || []).join(', ') || 'snapshot'} · {new Date(v.created_at).toLocaleString()}</div>)}
        {!(page.versions || []).length && <p className="text-xs text-[#9CA3AF]">No versions exported yet.</p>}
      </div>
    </div>
  );
}

export default function LocationPageDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState(null);
  const [tab, setTab] = useState('Keywords');
  const [error, setError] = useState('');

  async function reload() {
    try { setPage(await lpb.page(id)); } catch (e) { setError(e.message); }
  }
  useEffect(() => { reload(); }, [id]);

  if (error) return <div className="p-8 text-red-600">{error}</div>;
  if (!page) return <div className="p-8 text-[#6B7280]">Loading…</div>;

  const po = page.page_object;
  const title = po ? `${po.service_data.service_name} in ${po.location_data.location_name}` : 'Page';

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F4F5F7' }}>
      <header className="bg-white border-b border-[#E5E7EB] h-14 flex items-center px-6">
        <div className="max-w-5xl mx-auto w-full flex items-center gap-3">
          <button onClick={() => navigate('/location-page-builder')} className="text-[#6B7280] text-sm">← Pages</button>
          <span className="font-bold text-[#111827] text-sm">{title}</span>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: TEAL + '1A', color: TEAL }}>{page.status}</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-6">
        {!page.eligibility?.eligible && <div className="bg-red-50 text-red-700 text-sm rounded-md p-3 mb-4">⛔ {page.eligibility?.reason}</div>}
        <div className="flex gap-1 border-b border-[#E5E7EB] mb-5">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'text-[#111827]' : 'text-[#9CA3AF] border-transparent'}`} style={tab === t ? { borderBottomColor: TEAL, color: TEAL } : {}}>{t}</button>
          ))}
        </div>
        {tab === 'Keywords' && <KeywordsTab page={page} reload={reload} />}
        {tab === 'Content' && <ContentTab page={page} reload={reload} />}
        {tab === 'Schema' && <SchemaTab page={page} />}
        {tab === 'Approval' && <ApprovalTab page={page} reload={reload} />}
        {tab === 'Export' && <ExportTab page={page} />}
      </main>
    </div>
  );
}
