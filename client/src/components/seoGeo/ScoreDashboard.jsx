import { ScoreRing, ScoreBar, GEO_BADGE, EEAT_BADGE, scoreColor, resolveBreakdown } from './primitives';

const CAPTION = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};
const CARD = {
  background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)',
  padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
};

// The cap is never silent: without this row a noindex page shows an Indexability
// bar of 89 next to a headline of 25 and recreates the bug the cap exists to fix.
function CapBanner({ cap, composite }) {
  if (!cap?.applied) return null;
  const groups = (cap.groups || []).map(g => {
    const ids = (g.check_ids || []).join(', ');
    return ids ? `${g.reason} (${ids})` : g.reason;
  }).join(' · ');
  return (
    <div style={{
      background: 'var(--danger-soft)', border: '1px solid var(--danger)',
      borderRadius: 8, padding: '8px 12px', marginBottom: 16,
    }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)' }}>
        Capped at {cap.value} — {groups}
        {Number.isFinite(composite) ? ` Uncapped composite: ${composite}.` : ''}
      </p>
    </div>
  );
}

function BandLine({ band, score }) {
  if (!band?.label) return null;
  return (
    <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 16, lineHeight: 1.5 }}>
      <span style={{ fontWeight: 700, color: scoreColor(score) }}>{band.label}</span>
      {band.blurb ? ` — ${band.blurb}` : ''}
    </p>
  );
}

// points_lost sums to (100 − composite), so the headline is explainable on screen.
function PointsLostWaterfall({ breakdown, composite, formula }) {
  const rows = breakdown.filter(b => Number.isFinite(b.points_lost) && b.points_lost > 0);
  if (rows.length === 0) return null;
  const total = Math.round(rows.reduce((s, b) => s + b.points_lost, 0) * 10) / 10;
  const worst = Math.max(...rows.map(b => b.points_lost));
  return (
    <div title={formula || undefined} style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p style={CAPTION}>Points Lost</p>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>−{total}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map(b => (
          <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
            <span style={{ color: 'var(--text-2)', width: 118, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.label}</span>
            <div style={{ flex: 1, height: 4, background: 'var(--surface)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 999, width: `${worst > 0 ? (b.points_lost / worst) * 100 : 0}%`, backgroundColor: 'var(--danger)' }} />
            </div>
            <span style={{ width: 36, textAlign: 'right', color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>−{b.points_lost}</span>
          </div>
        ))}
      </div>
      {Number.isFinite(composite) && (
        <p style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
          100 − {total} = {composite}
        </p>
      )}
    </div>
  );
}

// Rule-based answerability (F28), not the model's re-derivation — so the card
// survives an AI failure. C/S/Q are never rendered for a commercial page.
function AnswerabilityCard({ findings }) {
  const geo = findings.geo;
  if (!geo) return null;
  const ans = geo.answerability_breakdown;
  const rubric = geo.answerability_rubric ?? 'CSQAF';
  const score = geo.answerability_score ?? geo.csqaf_score ?? 0;
  const maxPts = geo.answerability_max ?? 10;
  const earned = geo.answerability_earned;
  const intent = findings.meta?.page_intent ?? 'informational';
  const cols = Array.isArray(ans) && ans.length > 0 ? Math.min(ans.length, 5) : 5;
  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div>
          <p style={CAPTION}>GEO Answerability — {rubric}</p>
          {intent === 'commercial' && (
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
              Commercial-intent rubric · citations, statistics and quotations are not scored on this page.
            </p>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{score}/10</span>
          {maxPts !== 10 && Number.isFinite(earned) && (
            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-3)' }}>({earned} of {maxPts} pts)</span>
          )}
        </div>
      </div>
      {Array.isArray(ans) && ans.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8 }}>
          {ans.map(c => (
            <div key={c.key} title={c.finding || undefined} style={{ background: 'var(--surface)', borderRadius: 8, padding: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{c.key}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{c.label}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: c.points >= c.max ? 'var(--success)' : c.points > 0 ? 'var(--warning)' : 'var(--danger)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                {c.points}/{c.max}
              </div>
              {c.finding && (
                <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.4 }}>{c.finding}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 3×3 either way: commercial swaps the five editorial tiles for the five
// entity/local tiles and keeps FAQ, BLUF, Promo and the composite.
function GeoSignalsCard({ findings }) {
  const geo = findings.geo;
  if (!geo) return null;
  const intent = findings.meta?.page_intent ?? 'informational';
  const rubric = geo.answerability_rubric ?? 'CSQAF';
  const score = geo.answerability_score ?? geo.csqaf_score ?? 0;
  const head = intent === 'commercial'
    ? [
        ['NAP Complete',   geo.nap_complete ? 'Yes' : 'No',       !!geo.nap_complete],
        ['Hours Valid',    geo.hours_valid ? 'Yes' : 'No',        !!geo.hours_valid],
        ['Review Markup',  geo.review_markup ? 'Yes' : 'No',      !!geo.review_markup],
        ['sameAs',         geo.sameas_count ?? 0,                 (geo.sameas_count ?? 0) >= 3],
        ['Service Area',   geo.service_area_clear ? 'Yes' : 'No', !!geo.service_area_clear],
      ]
    : [
        ['Stats',           geo.statistics_count,                     geo.statistics_count >= 4],
        ['Expert Quotes',   geo.expert_quotes,                        geo.expert_quotes > 0],
        ['Named Author',    geo.named_author ? 'Yes' : 'No',          geo.named_author],
        ['Primary Sources', geo.primary_source_citations,             geo.primary_source_citations > 0],
        ['HTML Tables',     geo.html_tables,                          geo.html_tables > 0],
      ];
  const tiles = [
    ...head,
    ['FAQ Section',  geo.faq_section ? 'Yes' : 'No',           geo.faq_section],
    ['BLUF Opening', geo.direct_answer_opening ? 'Yes' : 'No', geo.direct_answer_opening],
    ['Promo Words',  geo.promotional_language_count,           geo.promotional_language_count === 0],
    [rubric,         `${score}/10`,                            score >= 7],
  ];
  return (
    <div style={CARD}>
      <p style={{ ...CAPTION, marginBottom: 12 }}>GEO Signals</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {tiles.map(([label, val, good]) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'var(--surface)', borderRadius: 8, padding: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: good ? 'var(--success)' : 'var(--danger)', fontFamily: 'var(--font-mono)' }}>{String(val ?? '—')}</span>
            <span style={{ fontSize: 12, color: 'var(--text-2)', textAlign: 'center', marginTop: 2 }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ScoreDashboard({ findings, ai }) {
  const scores = findings?.scores;
  const aiSummary = ai?.summary;
  if (!scores) return null;

  const breakdown = resolveBreakdown(scores);
  const overall = Number.isFinite(scores.overall) ? scores.overall : 0;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>

      {/* Overall score */}
      <div style={{ ...CARD, gridColumn: 'span 1' }}>
        <p style={{ ...CAPTION, marginBottom: 16 }}>Overall Score</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <ScoreRing score={overall} size={88} />
          <div>
            {aiSummary?.geo_readiness && (
              <span style={{
                fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999, display: 'block', marginBottom: 8,
                background: GEO_BADGE[aiSummary.geo_readiness]?.bg,
                color: GEO_BADGE[aiSummary.geo_readiness]?.text,
              }}>
                {GEO_BADGE[aiSummary.geo_readiness]?.label}
              </span>
            )}
            {aiSummary?.eeat_strength && (
              <span style={{
                fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999, display: 'block',
                background: EEAT_BADGE[aiSummary.eeat_strength]?.bg,
                color: EEAT_BADGE[aiSummary.eeat_strength]?.text,
              }}>
                E-E-A-T: {aiSummary.eeat_strength}
              </span>
            )}
          </div>
        </div>

        {scores.cap?.applied
          ? <CapBanner cap={scores.cap} composite={scores.composite} />
          : <BandLine band={scores.band} score={overall} />}

        {aiSummary?.priority_verdict && (
          <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)', marginBottom: 4 }}>Priority Issue</p>
            <p style={{ fontSize: 14, color: 'var(--danger)' }}>{aiSummary.priority_verdict}</p>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {breakdown.map(b => (
            <ScoreBar
              key={b.key}
              label={b.label}
              score={b.score}
              checksScored={b.checks_scored}
              effectiveWeight={b.effective_weight}
            />
          ))}
        </div>

        <PointsLostWaterfall breakdown={breakdown} composite={scores.composite} formula={scores.formula} />
      </div>

      {/* Quick wins + keyword analysis + answerability + GEO signals */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, gridColumn: 'span 2' }}>

        {aiSummary?.quick_wins?.length > 0 && (
          <div style={CARD}>
            <p style={{ ...CAPTION, marginBottom: 12 }}>Quick Wins</p>
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', padding: 0, margin: 0 }}>
              {aiSummary.quick_wins.map((w, i) => (
                <li key={i} style={{ display: 'flex', gap: 10, fontSize: 14 }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, color: '#fff', background: 'var(--primary)' }}>{i + 1}</span>
                  <span style={{ color: 'var(--text)' }}>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Keyword Analysis */}
        {findings.meta.keywords?.length > 0 && findings.kwChecks?.length > 0 && (
          <div style={CARD}>
            <p style={{ ...CAPTION, marginBottom: 12 }}>
              Keyword Analysis — "{findings.meta.keywords[0]}"
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              {[
                ['Title', findings.kwChecks.find(c => c.id === 'KW1')],
                ['H1', findings.kwChecks.find(c => c.id === 'KW2')],
                ['Meta Desc', findings.kwChecks.find(c => c.id === 'KW3')],
                ['Density', findings.kwChecks.find(c => c.id === 'KW8')],
                ['URL', findings.kwChecks.find(c => c.id === 'KW5')],
                ['H2', findings.kwChecks.find(c => c.id === 'KW6')],
                ['Alt Text', findings.kwChecks.find(c => c.id === 'KW7')],
                ['Schema', findings.kwChecks.find(c => c.id === 'KW9')],
              ].map(([label, chk]) => {
                if (!chk) return null;
                const statusColor = {
                  pass: 'var(--success)', fail: 'var(--danger)',
                  warning: 'var(--warning)', notice: 'var(--info)', skipped: 'var(--text-3)',
                  na: 'var(--text-3)', informational: 'var(--text-3)',
                }[chk.status] || 'var(--text-3)';
                const statusIcon = chk.status === 'pass' ? '✓' : chk.status === 'fail' ? '✕'
                  : (chk.status === 'na' || chk.status === 'informational') ? '–' : '~';
                const detail = [chk.tier, Number.isFinite(chk.matchScore) ? `${chk.matchScore}%` : null]
                  .filter(Boolean).join(' · ');
                return (
                  <div key={label} title={chk.evidence || chk.detail || undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, padding: 8 }}>
                    <span style={{ fontWeight: 700, color: statusColor }}>{statusIcon}</span>
                    <span style={{ color: 'var(--text-2)' }}>{label}</span>
                    {detail && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{detail}</span>}
                  </div>
                );
              })}
            </div>
            {ai?.keyword_analysis && (
              <p style={{ fontSize: 12, color: 'var(--text)', fontStyle: 'italic' }}>{ai.keyword_analysis.summary}</p>
            )}
          </div>
        )}

        <AnswerabilityCard findings={findings} />
        <GeoSignalsCard findings={findings} />
      </div>
    </div>
  );
}

export function AuditMetaBar({ findings }) {
  if (!findings?.meta) return null;
  return (
    <div style={{
      background: 'var(--card)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)',
      padding: '12px 20px', marginBottom: 16,
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      fontSize: 12, color: 'var(--text-2)', boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>{findings.meta.url}</span>
      <span>HTTP {findings.meta.http_status || '—'}</span>
      <span>{Math.round(findings.meta.html_size_bytes / 1024)}KB</span>
      <span>{findings.meta.fetch_time_ms}ms</span>
      <span>{findings.meta.total_checks_run} checks</span>
      <span style={{ color: 'var(--danger)', fontWeight: 500 }}>{findings.meta.errors} errors</span>
      <span style={{ color: 'var(--warning)', fontWeight: 500 }}>{findings.meta.warnings} warnings</span>
      <span style={{ color: 'var(--info)' }}>{findings.meta.notices} notices</span>
      <span style={{ color: 'var(--success)' }}>{findings.meta.passed} passed</span>
      {findings.meta.page_type && findings.meta.page_type !== 'unknown' && (
        <span style={{ fontWeight: 500, textTransform: 'capitalize', color: 'var(--primary)' }}>
          {findings.meta.page_type.replace('_', ' ')} page
          {findings.meta.is_ymyl ? ' · YMYL' : ''}
        </span>
      )}
      {findings.meta.page_intent && (
        <span style={{ fontWeight: 500, textTransform: 'capitalize', color: 'var(--text-2)' }}>
          {findings.meta.page_intent} intent{findings.meta.page_intent_source === 'detected' ? ' (auto)' : ''}
        </span>
      )}
      {findings.meta.keywords?.length > 0 && (
        <span style={{ color: 'var(--primary)' }}>KW: {findings.meta.keywords.join(', ')}</span>
      )}
    </div>
  );
}
