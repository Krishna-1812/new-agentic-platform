import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import { SectionHeader } from '../ui/SectionHeader';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Field } from '../ui/Field';
import { useToast } from '../ui/Toast';
import { mp } from '../lib/marketPotentialApi';
import USMetroMap from '../components/USMetroMap';

/* ── Step machine: setup → signals → regions → results ── */
const STEPS = [
  { id: 'setup',   label: 'Home & Service' },
  { id: 'basket',  label: 'Search Demand Signals' },   // renamed (Item 7)
  { id: 'regions', label: 'Candidate Regions' },
  { id: 'results', label: 'Compare & Rank' },
];

const INTENT_META = {
  'commercial-local':   { label: 'Local',   variant: 'success' },
  'commercial-cost':    { label: 'Cost',    variant: 'warning' },
  'commercial-general': { label: 'General', variant: 'info' },
};

const SAVED_KEY = 'marketPotential_savedAnalyses';

/* ── Small helpers ── */
const fmt = (n) => (n == null ? '—' : n.toLocaleString());
const shortName = (name) => name.split(',')[0].split('–')[0].trim();

function indexColor(idx, isHome) {
  if (isHome) return 'var(--primary)';
  if (idx == null) return 'var(--text-3)';
  if (idx >= 120) return 'var(--success)';
  if (idx >= 80) return 'var(--warning)';
  return 'var(--text-3)';
}
function densityColor(n) {
  if (n == null) return 'var(--text-3)';
  if (n < 10) return 'var(--success)';
  if (n <= 25) return 'var(--warning)';
  return 'var(--danger)';
}
function radiusLabel(mi) {
  if (mi < 200) return 'Regional cluster · same-day drive market';
  if (mi <= 400) return 'Multi-state region · short-haul flight territory';
  return 'National expansion scope';
}

// Deterministic top expansion pick (Items 6 & 8): highest Demand Index with a
// non-negative trend and competitor density under 25; fall back to best index.
function topPick(rows) {
  const cands = rows.filter((r) => !r.isHome && r.demandIndex != null);
  const strong = cands.filter((r) => (r.yoyPct == null || r.yoyPct >= 0) && (r.competitorDensity == null || r.competitorDensity < 25));
  const pool = strong.length ? strong : cands;
  return pool.slice().sort((a, b) => b.demandIndex - a.demandIndex)[0] || null;
}

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch { return []; }
}

/* ── Trend sparkline ── */
function Sparkline({ series, dir }) {
  if (!series || series.length < 2) return <span style={{ color: 'var(--text-3)' }}>—</span>;
  const w = 54, h = 18, pad = 2;
  const max = Math.max(...series), min = Math.min(...series);
  const range = max - min || 1;
  const pts = series.map((v, i) => {
    const x = pad + (i / (series.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / range) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const color = dir === 'up' ? 'var(--success)' : dir === 'down' ? 'var(--danger)' : 'var(--text-3)';
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Geo picker with debounced candidate search ── */
function GeoPicker({ onPick, placeholder }) {
  const [q, setQ] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (!q.trim()) { setCandidates([]); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const { candidates } = await mp.searchGeo(q);
        setCandidates(candidates);
        setOpen(true);
      } catch { /* ignore */ }
    }, 220);
    return () => clearTimeout(timer.current);
  }, [q]);

  return (
    <div style={{ position: 'relative' }}>
      <Field
        as="input"
        placeholder={placeholder || 'Type a metro… e.g. Phoenix'}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => candidates.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && candidates.length > 0 && (
        <div style={{
          position: 'absolute', top: 40, left: 0, right: 0, zIndex: 20,
          background: 'var(--card)', border: '1px solid var(--border-strong)',
          borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-md)', maxHeight: 240, overflowY: 'auto',
        }}>
          {candidates.map((c) => (
            <button
              key={c.id}
              onMouseDown={() => { onPick(c); setQ(''); setCandidates([]); setOpen(false); }}
              style={{
                display: 'flex', justifyContent: 'space-between', width: '100%', textAlign: 'left',
                padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, color: 'var(--text)', borderBottom: '1px solid var(--border)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <span>{c.displayName}</span>
              <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{(c.population / 1e6).toFixed(1)}M</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Region chip ── */
function RegionChip({ region, onRemove, tone = 'neutral', meta }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 8px 5px 10px',
      borderRadius: 'var(--r-pill)', fontSize: 12, background: tone === 'home' ? 'var(--primary-soft)' : 'var(--surface)',
      color: tone === 'home' ? 'var(--primary-text)' : 'var(--text)', border: '1px solid var(--border)',
    }}>
      {region.displayName}
      {meta && <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{meta}</span>}
      {onRemove && (
        <button onClick={onRemove} style={{ display: 'flex', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.6, padding: 0 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      )}
    </span>
  );
}

/* ── Sortable table header cell ── */
function Th({ label, k, sort, setSort, tip, align = 'left' }) {
  const active = k && sort.key === k;
  return (
    <th
      title={tip || undefined}
      onClick={() => k && setSort((s) => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }))}
      style={{ ...thStyle, textAlign: align, cursor: k ? 'pointer' : 'default', userSelect: 'none' }}
    >
      {label}
      {k && <span style={{ opacity: active ? 1 : 0.3, marginLeft: 3 }}>{active ? (sort.dir === 'desc' ? '▼' : '▲') : '↕'}</span>}
      {tip && <span style={{ marginLeft: 3, opacity: 0.5 }}>ⓘ</span>}
    </th>
  );
}

export default function MarketPotentialPage() {
  const toastCtx = useToast();
  // Toast wrapper (Item 1): useToast() exposes { add, remove }, NOT .error/.success.
  const toast = {
    error: (m) => toastCtx.add({ title: m, variant: 'danger' }),
    success: (m) => toastCtx.add({ title: m, variant: 'success' }),
    info: (m) => toastCtx.add({ title: m, variant: 'info' }),
  };

  const [step, setStep] = useState('setup');
  const [meta, setMeta] = useState(null);

  // setup
  const [serviceName, setServiceName] = useState('');
  const [homeRegions, setHomeRegions] = useState([]);

  // basket / signals
  const [service, setService] = useState(null);
  const [basket, setBasket] = useState(null);
  const [basketState, setBasketState] = useState(null); // 'draft' | 'active'
  const [proposalSource, setProposalSource] = useState(null);
  const [newTerm, setNewTerm] = useState('');

  // regions
  const [suggestions, setSuggestions] = useState([]);
  const [radius, setRadius] = useState(350);
  const [compared, setCompared] = useState([]);

  // results
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState({ key: 'demandIndex', dir: 'desc' });
  const [insightOpen, setInsightOpen] = useState(true);
  const [expandedGeo, setExpandedGeo] = useState(null); // metro whose density domains are shown

  // saved analyses (Item 5)
  const [saved, setSaved] = useState(loadSaved());
  const [savedOpen, setSavedOpen] = useState(false);

  // all metros (for the interactive selection map)
  const [allMetros, setAllMetros] = useState([]);

  const radiusTimer = useRef(null);

  useEffect(() => { mp.meta().then(setMeta).catch(() => {}); }, []);
  useEffect(() => { mp.allGeo().then((d) => setAllMetros(d.regions || [])).catch(() => {}); }, []);

  const maxRegions = meta?.maxCompareRegions || 10;

  // Toggle a metro in/out of the comparison (home stays fixed). Enforces the cap.
  const toggleCompared = (m) => {
    if (homeRegions.find((r) => r.id === m.id)) return;
    if (compared.find((r) => r.id === m.id)) {
      setCompared((prev) => prev.filter((r) => r.id !== m.id));
      return;
    }
    if (compared.length >= maxRegions) {
      toast.error(`You can compare at most ${maxRegions} regions — remove one first.`);
      return;
    }
    setCompared((prev) => [...prev, m]);
  };

  const isDemo = meta?.dataSource === 'demo';
  const units = meta?.units?.enabled ? meta.units : null;
  const densityCfg = meta?.density?.enabled ? meta.density : null;
  const lowCredits = units && units.dailyRemaining < units.dailyCap * 0.1;

  // Upper-bound per-run estimate incl. competitor density (Item 3).
  const rankableCount = basket ? basket.terms.filter((t) => !t.isGeoTemplate).length : 0;
  const pendingRegions = homeRegions.length + compared.length;
  const perRegionLines = rankableCount + (densityCfg ? densityCfg.terms * densityCfg.topN : 0);
  const estUnits = units ? pendingRegions * perRegionLines * units.rate : 0;
  const overRun = units && estUnits > units.perRunCap;
  const overDay = units && estUnits > units.dailyRemaining;

  const sortedRows = useMemo(() => {
    if (!result) return [];
    const rows = [...result.rows];
    const { key, dir } = sort;
    rows.sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir === 'desc' ? bv - av : av - bv;
    });
    return rows;
  }, [result, sort]);

  /* ── Step 1 → resolve service + basket ── */
  const startAnalysis = async () => {
    if (!serviceName.trim()) return toast.error('Enter a service.');
    if (!homeRegions.length) return toast.error('Add at least one home market.');
    setBusy(true);
    try {
      const r = await mp.resolveService(serviceName.trim());
      setService(r.service);
      setBasket(r.basket);
      setBasketState(r.basketState);
      setProposalSource(r.proposalSource || null);
      setStep('basket');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const regenerateBasket = async () => {
    setBusy(true);
    try {
      const r = await mp.proposeBasket(service.id);
      setBasket(r.basket);
      setProposalSource(r.proposalSource);
      toast.success('Fresh signals proposed.');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const removeTerm = (termId) => setBasket((b) => ({ ...b, terms: b.terms.filter((t) => t.id !== termId) }));
  const addTerm = () => {
    const t = newTerm.trim().toLowerCase();
    if (!t) return;
    setBasket((b) => ({ ...b, terms: [...b.terms, { id: `tmp_${Date.now()}`, term: t, intentTag: 'commercial-general', isGeoTemplate: false }] }));
    setNewTerm('');
  };

  const fetchSuggestions = useCallback(async (radiusVal) => {
    const { suggestions } = await mp.adjacency(homeRegions.map((r) => r.id), { radiusMiles: radiusVal, limit: 8 });
    setSuggestions(suggestions);
    return suggestions;
  }, [homeRegions]);

  const approveBasket = async () => {
    setBusy(true);
    try {
      if (basketState === 'draft') {
        await mp.saveDraft(service.id, basket.terms.map((t) => ({ term: t.term, intentTag: t.intentTag, isGeoTemplate: t.isGeoTemplate })));
        const frozen = await mp.freezeBasket(service.id);
        setBasket(frozen.basket);
        setBasketState('active');
        toast.success(`Signals confirmed (v${frozen.basket.version}).`);
      }
      const s = await fetchSuggestions(radius);
      setCompared(s.slice(0, maxRegions)); // default: approve suggestions up to the cap
      setStep('regions');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  // Live-update the suggested metros as the radius slider moves (Item 9, debounced).
  useEffect(() => {
    if (step !== 'regions' || !homeRegions.length) return;
    clearTimeout(radiusTimer.current);
    radiusTimer.current = setTimeout(() => { fetchSuggestions(radius).catch(() => {}); }, 300);
    return () => clearTimeout(radiusTimer.current);
  }, [radius, step, homeRegions, fetchSuggestions]);

  const runCompare = async () => {
    setBusy(true);
    try {
      const body = {
        serviceId: service.id,
        homeGeoIds: homeRegions.map((r) => r.id),
        comparedGeoIds: compared.map((r) => r.id),
      };
      const r = await mp.compare(body);
      setResult(r);
      setInsightOpen(true);
      if (r.usage) setMeta((m) => (m ? { ...m, units: { ...m.units, ...r.usage } } : m));
      setStep('results');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  /* ── Save & export (Items 5, 6) ── */
  const saveAnalysis = () => {
    const dflt = `${service.name} — ${shortName(homeRegions[0].displayName)} — ${new Date().toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`;
    const name = window.prompt('Name this analysis', dflt);
    if (!name) return;
    const entry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name, createdAt: new Date().toISOString(),
      service: service.name, homeMarkets: homeRegions, candidateRegions: compared, results: result,
    };
    const next = [entry, ...saved];
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    setSaved(next);
    toast.success('Analysis saved.');
  };

  const openSaved = (entry) => {
    setService({ id: entry.results?.service?.id || null, name: entry.service });
    setHomeRegions(entry.homeMarkets || []);
    setCompared(entry.candidateRegions || []);
    setResult(entry.results);
    setSavedOpen(false);
    setStep('results');
    toast.info(`Opened “${entry.name}” (read-only)`);
  };

  const deleteSaved = (id) => {
    const next = saved.filter((s) => s.id !== id);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    setSaved(next);
  };

  const exportCsv = () => {
    if (!result) return;
    const pick = topPick(result.rows);
    const summary = pick
      ? `Top recommendation: ${pick.region} — highest per-capita demand${pick.yoyPct != null ? `, ${pick.yoyPct > 0 ? '+' : ''}${pick.yoyPct}% YoY growth` : ''}, ${pick.competitorDensity != null ? pick.competitorDensity : 'n/a'} competitors`
      : 'No clear top recommendation from this run';
    const header = ['Metro', 'Search Volume', 'Demand Index (vs. home)', 'Competitor Density', 'Trend (12mo)', 'CPC', 'Population'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [[esc(summary)], header.map(esc)];
    for (const r of sortedRows) {
      lines.push([esc(r.region), r.clusterVolume, r.demandIndex ?? '', r.competitorDensity ?? '', r.yoyPct == null ? '' : `${r.yoyPct}%`, r.medianCpc, r.population ?? ''].map((v, i) => (i === 0 ? v : esc(v))));
    }
    const csv = lines.map((l) => l.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `market-potential-${(service.name || 'analysis').replace(/\s+/g, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setStep('setup'); setService(null); setBasket(null); setBasketState(null);
    setSuggestions([]); setCompared([]); setResult(null);
  };

  const homeName = result?.rows.find((r) => r.isHome)?.region || homeRegions[0]?.displayName || 'your home market';
  const pick = result ? topPick(result.rows) : null;

  /* ── Render ── */
  return (
    <div style={{ padding: '28px 32px 64px', maxWidth: 1080, margin: '0 auto' }}>
      <SectionHeader
        eyebrow="Market Intelligence"
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          Healthcare Market Potential
          <Badge variant="info">Beta</Badge>
          {meta && (
            <span
              title={`${meta.method === 'templated' ? 'Live via SEMrush · templated [service] [city] method' : 'Live via ' + meta.dataSource} · ${meta.metroCount} metros · bucket ${meta.yearMonth}`}
              style={{ fontSize: 12, color: 'var(--text-3)', cursor: 'help', border: '1px solid var(--border)', borderRadius: '50%', width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >i</span>
          )}
        </span>}
        subtitle="Live via SEMrush · Beta — compare commercial search demand for a service across the metros you operate in and adjacent metros you might expand into."
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {units && (
              <Badge variant={lowCredits ? 'warning' : 'info'}>SEMrush: {units.dailyRemaining.toLocaleString()} credits</Badge>
            )}
            {saved.length > 0 && (
              <div style={{ position: 'relative' }}>
                <Button variant="ghost" size="sm" onClick={() => setSavedOpen((v) => !v)}>Saved ({saved.length})</Button>
                {savedOpen && (
                  <div style={{ position: 'absolute', right: 0, top: 36, zIndex: 30, width: 300, background: 'var(--card)', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-md)', maxHeight: 320, overflowY: 'auto' }}>
                    {saved.map((s) => (
                      <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
                        <button onClick={() => openSaved(s)} style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', fontSize: 12 }}>
                          <div style={{ fontWeight: 600 }}>{s.name}</div>
                          <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{new Date(s.createdAt).toLocaleDateString()}</div>
                        </button>
                        <button onClick={() => deleteSaved(s.id)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex' }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {step !== 'setup' && <Button variant="ghost" size="sm" onClick={reset}>Start over</Button>}
          </div>
        }
      />

      {/* Warning banners only — demo mode or low credits (Item 12) */}
      {isDemo && (
        <div style={{ marginBottom: 20, padding: '8px 12px', borderRadius: 'var(--r-md)', fontSize: 12, background: 'var(--warning-soft)', color: 'var(--warning)' }}>
          <b>Demo data</b> — no provider key configured. Volumes are deterministic placeholders.
        </div>
      )}
      {lowCredits && (
        <div style={{ marginBottom: 20, padding: '8px 12px', borderRadius: 'var(--r-md)', fontSize: 12, background: 'var(--warning-soft)', color: 'var(--warning)' }}>
          <b>Low SEMrush credits</b> — only {units.dailyRemaining.toLocaleString()} of {units.dailyCap.toLocaleString()} units left today (resets 00:00 UTC).
        </div>
      )}

      {/* Stepper */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 28, flexWrap: 'wrap' }}>
        {STEPS.map((s, i) => {
          const active = s.id === step;
          const done = STEPS.findIndex((x) => x.id === step) > i;
          return (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 'var(--r-pill)',
              fontSize: 12, fontWeight: active ? 600 : 500,
              background: active ? 'var(--primary-soft)' : done ? 'var(--success-soft)' : 'var(--surface)',
              color: active ? 'var(--primary-text)' : done ? 'var(--success)' : 'var(--text-3)',
              border: '1px solid var(--border)',
            }}>
              <span style={{
                width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, background: active ? 'var(--primary)' : done ? 'var(--success)' : 'var(--border)',
                color: active || done ? '#fff' : 'var(--text-3)',
              }}>{done ? '✓' : i + 1}</span>
              {s.label}
            </div>
          );
        })}
      </div>

      {/* ── STEP 1: setup ── */}
      {step === 'setup' && (
        <div style={{ display: 'grid', gap: 24, maxWidth: 620 }}>
          <div>
            <label style={labelStyle}>Service</label>
            <Field
              as="input"
              placeholder="e.g. dental implants, behavioral health, physical therapy"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              helper="One service per comparison. A fixed set of search terms is measured across all regions."
            />
          </div>
          <div>
            <label style={labelStyle}>Home market(s)</label>
            <GeoPicker onPick={(c) => setHomeRegions((prev) => prev.find((r) => r.id === c.id) ? prev : [...prev, c])} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {homeRegions.length === 0
                ? <span style={{ fontSize: 12, color: 'var(--text-3)' }}>No home markets yet — search and confirm the exact metro.</span>
                : homeRegions.map((r) => (
                  <RegionChip key={r.id} region={r} tone="home" onRemove={() => setHomeRegions((prev) => prev.filter((x) => x.id !== r.id))} />
                ))}
            </div>
          </div>
          <div>
            <Button onClick={startAnalysis} loading={busy} disabled={!serviceName.trim() || !homeRegions.length}>
              Continue →
            </Button>
          </div>

          {/* What you'll get (Item 10) */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '16px 18px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', marginBottom: 10 }}>What you'll get</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {[
                'A ranked table of up to 10 metros by per-capita search demand',
                'Competitor density and 12-month growth trend per market',
                'A US bubble map visualising relative demand by metro',
                'An exportable summary to share with your team',
              ].map((t, i) => (
                <li key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-2)' }}>
                  <span style={{ color: 'var(--success)' }}>✓</span>{t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── STEP 2: signals ── */}
      {step === 'basket' && basket && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 720 }}>
              {basketState === 'active'
                ? <>These <b>{rankableCount}</b> service terms represent how patients look for this service. Each is measured as <code>[term] [city]</code> in every market — SEMrush is national, so the city in the query supplies the local signal.</>
                : <>Proposed service terms{proposalSource ? ` (${proposalSource})` : ''}. Each is combined with a city (<code>[term] [city]</code>) to measure local demand. Review, edit, then confirm.</>}
            </div>
            {basketState === 'draft' && <Button variant="secondary" size="sm" onClick={regenerateBasket} loading={busy}>Regenerate</Button>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {basket.terms.map((t) => {
              const im = INTENT_META[t.intentTag] || INTENT_META['commercial-general'];
              return (
                <div key={t.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                }}>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>
                    {t.term} <span style={{ color: 'var(--text-3)' }}>+ [city]</span>
                  </span>
                  <Badge variant={im.variant}>{im.label}</Badge>
                  {basketState === 'draft' && (
                    <button onClick={() => removeTerm(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {basketState === 'draft' && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, maxWidth: 460 }}>
              <div style={{ flex: 1 }}>
                <Field as="input" placeholder="Add a service term (city is added automatically)…" value={newTerm}
                  onChange={(e) => setNewTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTerm()} />
              </div>
              <Button variant="secondary" onClick={addTerm}>Add</Button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="ghost" onClick={() => setStep('setup')}>← Back</Button>
            <Button onClick={approveBasket} loading={busy}>Confirm signals &amp; continue →</Button>
          </div>
        </div>
      )}

      {/* ── STEP 3: regions ── */}
      {step === 'regions' && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Adjacency radius</span>
              <input type="range" min={100} max={800} step={50} value={radius}
                onChange={(e) => setRadius(Number(e.target.value))} style={{ width: 220 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{radius} mi</span>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>· {suggestions.length} metros in range</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--primary-text)', marginTop: 4 }}>{radiusLabel(radius)}</div>
          </div>

          {/* Interactive US map — click a metro to add/remove it from the comparison */}
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Pick regions on the map</label>
            <USMetroMap
              mode="select"
              metros={allMetros}
              homeIds={homeRegions.map((r) => r.id)}
              selectedIds={compared.map((r) => r.id)}
              onToggle={toggleCompared}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Home markets</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {homeRegions.map((r) => <RegionChip key={r.id} region={r} tone="home" />)}
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>
              Candidate regions to compare ({compared.length} / {maxRegions})
              {compared.length >= maxRegions && <span style={{ color: 'var(--warning)', fontWeight: 500 }}> · limit reached</span>}
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {compared.length === 0
                ? <span style={{ fontSize: 12, color: 'var(--text-3)' }}>None selected.</span>
                : compared.map((r) => (
                  <RegionChip key={r.id} region={r} meta={r.distanceMiles != null ? `${r.distanceMiles} mi` : undefined}
                    onRemove={() => setCompared((prev) => prev.filter((x) => x.id !== r.id))} />
                ))}
            </div>
            <div style={{ maxWidth: 360 }}>
              <GeoPicker placeholder="Add another metro to compare…"
                onPick={(c) => {
                  if (homeRegions.find((r) => r.id === c.id)) return toast.error('That is a home market.');
                  if (compared.find((r) => r.id === c.id)) return;
                  if (compared.length >= maxRegions) return toast.error(`You can compare at most ${maxRegions} regions.`);
                  setCompared((prev) => [...prev, c]);
                }} />
            </div>
          </div>

          {suggestions.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>Suggested (nearest metros within {radius} mi)</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {suggestions.map((s) => {
                  const on = compared.find((r) => r.id === s.id);
                  return (
                    <button key={s.id}
                      onClick={() => toggleCompared(s)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', cursor: 'pointer',
                        borderRadius: 'var(--r-pill)', fontSize: 12, border: '1px solid var(--border)',
                        background: on ? 'var(--success-soft)' : 'var(--card)', color: on ? 'var(--success)' : 'var(--text-2)',
                      }}>
                      {on ? '✓ ' : '+ '}{s.displayName}
                      <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{s.distanceMiles} mi</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {units && pendingRegions > 0 && (
            <div style={{
              marginBottom: 16, padding: '10px 12px', borderRadius: 'var(--r-md)', fontSize: 12,
              background: (overRun || overDay) ? 'var(--danger-soft)' : 'var(--surface)',
              color: (overRun || overDay) ? 'var(--danger)' : 'var(--text-2)',
              border: '1px solid var(--border)',
            }}>
              Est. cost this run: <b>up to ~{estUnits.toLocaleString()} units</b> ({pendingRegions} regions × {perRegionLines} lines × {units.rate})
              {densityCfg && <> · includes competitor density ({densityCfg.terms} term × top {densityCfg.topN})</>}
              {' · '}per-run cap {units.perRunCap.toLocaleString()} · {units.dailyRemaining.toLocaleString()} left today
              {overRun && <div style={{ marginTop: 4 }}><b>Over the per-run cap</b> — remove regions or basket terms to proceed.</div>}
              {!overRun && overDay && <div style={{ marginTop: 4 }}><b>Not enough daily budget left</b> — wait for the 00:00 UTC reset or reduce the run.</div>}
              <div style={{ marginTop: 4, opacity: 0.8 }}>Cached regions cost 0 — the actual bill is usually lower.</div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="ghost" onClick={() => setStep('basket')}>← Back</Button>
            <Button onClick={runCompare} loading={busy} disabled={!compared.length || overRun || overDay}>
              Fetch volume &amp; rank →
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 4: results ── */}
      {step === 'results' && result && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              <b>{result.service.name}</b>{result.basketVersion ? ` · v${result.basketVersion}` : ''} · {result.stats?.regions ?? result.rows.length} regions
              {result.stats?.apiCalls != null && <> · {result.stats.apiCalls} fetched / {result.stats.cacheHits} cached</>}
              {units && result.stats?.unitsUsed != null && <> · <b>{result.stats.unitsUsed.toLocaleString()} units used</b></>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" size="sm" onClick={exportCsv}>⬇ Export results</Button>
              <Button variant="secondary" size="sm" onClick={saveAnalysis}>Save this analysis</Button>
            </div>
          </div>

          {/* Decision insight panel (Item 8) */}
          <div style={{
            marginBottom: 20, borderRadius: 'var(--r-lg)', border: '1px solid rgba(99,91,255,0.35)',
            background: 'linear-gradient(180deg, var(--primary-soft), var(--card))', padding: '14px 16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary-text)' }}>Decision summary</div>
              <button onClick={() => setInsightOpen((v) => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 11 }}>
                {insightOpen ? 'Hide' : 'Show'}
              </button>
            </div>
            {insightOpen && (
              <div style={{ marginTop: 8 }}>
                {pick ? (
                  <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600, lineHeight: 1.5 }}>
                    🎯 Top opportunity: {pick.region} — {pick.demandIndex != null ? `${(pick.demandIndex / 100).toFixed(1)}× the per-capita demand of ${shortName(homeName)}` : 'strongest relative demand'}
                    {pick.yoyPct != null && `, ${pick.yoyPct > 0 ? '+' : ''}${pick.yoyPct}% YoY`}
                    {pick.competitorDensity != null && `, and ${pick.competitorDensity} competing domains`}.
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--text-2)' }}>No standout expansion market in this set — all candidates trail the home market on per-capita demand.</div>
                )}
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6 }}>
                  Your home market ({shortName(homeName)}) has a Demand Index of 100. Markets above 120 represent meaningful expansion opportunity.
                </div>
              </div>
            )}
          </div>

          <div style={{ marginBottom: 24 }}>
            <USMetroMap mode="result" rows={result.rows} />
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
              <thead>
                <tr style={{ background: 'var(--surface)' }}>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>Region</th>
                  <Th label="Search Volume" k="clusterVolume" sort={sort} setSort={setSort} align="right" />
                  <Th label="Demand Index (vs. home)" k="demandIndex" sort={sort} setSort={setSort} align="right"
                    tip="Search demand per 100k residents, indexed to your home market. 100 = same as home. Higher = more relative demand." />
                  <Th label="Competitor Density" k="competitorDensity" sort={sort} setSort={setSort} align="right"
                    tip="Number of unique domains ranking in the top 10 for this service in this market. Click a value to list the domains." />
                  <Th label="Trend (12mo)" k="yoyPct" sort={sort} setSort={setSort} align="right"
                    tip="Year-over-year change in search volume for this service in this market." />
                  <Th label="CPC" k="medianCpc" sort={sort} setSort={setSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r, i) => {
                  const dir = r.yoyPct == null ? 'flat' : r.yoyPct > 0 ? 'up' : r.yoyPct < 0 ? 'down' : 'flat';
                  const domains = r.competitorDomains || [];
                  const canExpand = r.competitorDensity != null && domains.length > 0;
                  const isOpen = expandedGeo === r.geoId;
                  return (
                    <Fragment key={r.geoId}>
                      <tr style={{ borderTop: '1px solid var(--border)', background: r.isHome ? 'var(--primary-soft)' : 'transparent' }}>
                        <td style={tdStyle}>{i + 1}</td>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>
                          {r.region}
                          {r.isHome && <Badge variant="brand" style={{ marginLeft: 8 }}>Home</Badge>}
                          <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-3)' }}>{r.population ? `${(r.population / 1e6).toFixed(1)}M residents` : ''}</div>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(r.clusterVolume)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: indexColor(r.demandIndex, r.isHome) }}>
                          {r.demandIndex != null ? r.demandIndex : '—'}
                          {!r.isHome && r.demandIndex != null && <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-3)' }}> ({(r.demandIndex / 100).toFixed(1)}×)</span>}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {r.competitorDensity == null
                            ? <span style={{ color: 'var(--text-3)' }}>—</span>
                            : canExpand
                              ? <button
                                  onClick={() => setExpandedGeo(isOpen ? null : r.geoId)}
                                  title="Show the ranking domains"
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', fontWeight: 600, color: densityColor(r.competitorDensity), display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                >
                                  {r.competitorDensity} domains <span style={{ fontSize: 9 }}>{isOpen ? '▲' : '▾'}</span>
                                </button>
                              : <span style={{ fontWeight: 600, color: densityColor(r.competitorDensity) }}>{r.competitorDensity} domains</span>}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                            <Sparkline series={r.monthlyTotals} dir={dir} />
                            <span style={{ fontSize: 12, minWidth: 44, textAlign: 'right', color: dir === 'up' ? 'var(--success)' : dir === 'down' ? 'var(--danger)' : 'var(--text-3)' }}>
                              {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '▬'} {r.yoyPct == null ? '—' : `${r.yoyPct > 0 ? '+' : ''}${r.yoyPct}%`}
                            </span>
                          </div>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>${r.medianCpc.toFixed(2)}</td>
                      </tr>
                      {isOpen && (
                        <tr style={{ background: 'var(--surface)' }}>
                          <td colSpan={7} style={{ padding: '10px 14px 12px' }}>
                            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
                              Unique domains ranking in the top {result.stats?.densityTopN ?? 10} for this service in <b>{r.region}</b> ({domains.length}):
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {domains.map((d) => (
                                <a key={d} href={`https://${d}`} target="_blank" rel="noopener noreferrer"
                                  style={{ fontSize: 12, padding: '3px 9px', borderRadius: 'var(--r-pill)', background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--primary-text)', textDecoration: 'none' }}>
                                  {d}
                                </a>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 12, lineHeight: 1.6 }}>
            Demand Index normalises search volume by metro population (per 100k residents) and indexes it to your home market (=100).
            {result.dataSource === 'semrush' && ' Data via SEMrush using the templated [service] [city] method — it captures searchers who include the city name, so it is best read as a relative index across metros.'}
            {result.dataSource === 'demo' && ' Figures are deterministic demo placeholders until a provider key is configured.'}
          </p>

          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <Button variant="ghost" onClick={() => setStep('regions')}>← Adjust regions</Button>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 };
const thStyle = { padding: '10px 14px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-3)', whiteSpace: 'nowrap', textAlign: 'left' };
const tdStyle = { padding: '11px 14px', color: 'var(--text)', whiteSpace: 'nowrap' };
