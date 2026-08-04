// Shared presentational primitives for the SEO & GEO tools (full Audit page and
// the Snapshot page). Moved verbatim out of SeoGeoAuditPage.jsx so both pages
// render the same scoring UI from one implementation.

export const STEPS = [
  { id: 'fetch',     label: 'Fetch Page' },
  { id: 'checks',    label: 'Run Checks' },
  { id: 'structure', label: 'Structure Findings' },
  { id: 'ai',        label: 'AI Analysis' },
];

export const GEO_BADGE = {
  ready:      { bg: 'var(--success-soft)', text: 'var(--success)', label: 'GEO Ready' },
  needs_work: { bg: 'var(--warning-soft)', text: 'var(--warning)', label: 'Needs Work' },
  not_ready:  { bg: 'var(--danger-soft)',  text: 'var(--danger)',  label: 'Not Ready' },
};

export const EEAT_BADGE = {
  strong:   { bg: 'var(--success-soft)', text: 'var(--success)' },
  moderate: { bg: 'var(--warning-soft)', text: 'var(--warning)' },
  weak:     { bg: 'var(--danger-soft)',  text: 'var(--danger)' },
};

export function scoreColor(score) {
  return score >= 70 ? 'var(--success)' : score >= 45 ? 'var(--warning)' : 'var(--danger)';
}

// Canonical bar order + labels. Used only to reconstruct a `breakdown` for runs
// persisted before the scoring redesign (which carry the flat keys but no
// `breakdown` array). Live runs always render `scores.breakdown` as-is.
export const BUCKET_ORDER = [
  ['title_meta',        'Title & Meta'],
  ['content_structure', 'Content & Structure'],
  ['indexability',      'Indexability'],
  ['schema',            'Schema'],
  ['geo_signals',       'GEO Signals'],
  ['eeat',              'E-E-A-T'],
  ['technical',         'Technical & Performance'],
  ['links_media',       'Links & Media'],
  ['keyword',           'Keyword Targeting'],
];

// Back-compat: prefer the server-supplied breakdown (which carries checks_scored,
// effective_weight and points_lost); fall back to the flat keys for older runs so
// the bars still render instead of showing "undefined".
export function resolveBreakdown(scores) {
  if (!scores) return [];
  if (Array.isArray(scores.breakdown) && scores.breakdown.length > 0) return scores.breakdown;
  return BUCKET_ORDER
    .filter(([key]) => scores[key] !== null && scores[key] !== undefined)
    .map(([key, label]) => ({ key, label, score: scores[key] }));
}

export function ScoreRing({ score, size = 80 }) {
  const r = (size / 2) - 8;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = scoreColor(score);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border)" strokeWidth="7" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="7"
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`} />
      <text x={size/2} y={size/2+1} textAnchor="middle" dominantBaseline="middle"
        fontSize="16" fontWeight="700" fill={color} fontFamily="var(--font-mono)">{score}</text>
    </svg>
  );
}

export function StepBar({ steps }) {
  return (
    <>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {STEPS.map(s => {
          const st = steps[s.id];
          const isDone = st?.status === 'done';
          const isActive = st?.status === 'active';
          const isError = st?.status === 'error';
          const dotBg = isDone ? 'var(--success)' : isActive ? 'var(--primary)' : isError ? 'var(--danger)' : 'var(--border)';
          const dotColor = (isDone || isActive || isError) ? '#fff' : 'var(--text-3)';
          const labelColor = isDone ? 'var(--success)' : isActive ? 'var(--primary)' : isError ? 'var(--danger)' : 'var(--text-3)';
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, backgroundColor: dotBg, color: dotColor, fontSize: 11,
              }}>
                {isDone ? '✓' : isActive ? (
                  <svg style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} viewBox="0 0 24 24" fill="none">
                    <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                ) : isError ? '✕' : '·'}
              </span>
              <span style={{ color: labelColor, fontWeight: isActive ? 600 : 400 }}>
                {st?.message || s.label}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// A bar renders nothing for a nullish score: a bucket with no scored checks is
// dropped from the model (never awarded 100), and a run persisted before the
// scoring redesign has no value for the newer bars at all.
export function ScoreBar({ label, score, checksScored, effectiveWeight }) {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return null;
  const color = scoreColor(score);
  const meta = [];
  if (Number.isFinite(checksScored)) meta.push(`${checksScored} check${checksScored === 1 ? '' : 's'}`);
  if (Number.isFinite(effectiveWeight)) meta.push(`${Math.round(effectiveWeight * 100)}% of score`);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 132, flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{label}</span>
        {meta.length > 0 && (
          <span style={{ display: 'block', fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>{meta.join(' · ')}</span>
        )}
      </div>
      <div style={{ flex: 1, height: 8, background: 'var(--surface)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 999, transition: 'width 500ms', width: `${score}%`, backgroundColor: color }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, width: 32, textAlign: 'right', color, fontFamily: 'var(--font-mono)' }}>{score}</span>
    </div>
  );
}
