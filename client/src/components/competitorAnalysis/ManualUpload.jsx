import { useState, useRef } from 'react';

const COMPETITOR_TYPES = ['direct', 'indirect', 'aggregator', 'informational'];

// ── Small reusable file drop zone ─────────────────────────────────────────────

function FileZone({ file, onFile, label, required, error }) {
  const ref = useRef(null);

  function handleDrop(e) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }

  const borderColor = file ? 'var(--success)' : error ? 'var(--danger)' : 'var(--border)';
  const bg = file ? 'var(--success-soft)' : error ? 'var(--danger-soft)' : 'var(--card)';

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4, marginTop: 0 }}>
        {label} {required && <span style={{ color: 'var(--danger)' }}>*</span>}
      </p>
      <div
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => ref.current?.click()}
        style={{
          cursor: 'pointer', borderRadius: 'var(--r-lg)',
          border: `2px dashed ${borderColor}`,
          padding: '8px 12px', textAlign: 'center',
          background: bg, transition: 'border-color 0.15s',
        }}
      >
        <input
          ref={ref}
          type="file"
          accept=".csv,.txt"
          style={{ display: 'none' }}
          onChange={e => { if (e.target.files[0]) onFile(e.target.files[0]); }}
        />
        {file ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg style={{ width: 14, height: 14, color: 'var(--success)', flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--success)', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onFile(null); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--success)', padding: 0, marginLeft: 2 }}
            >
              <svg style={{ width: 12, height: 12 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <p style={{ fontSize: 12, color: error ? 'var(--danger)' : 'var(--text-3)', margin: 0 }}>
            {error
              ? error
              : <><span style={{ color: 'var(--primary)', fontWeight: 500 }}>Browse</span> or drop CSV</>}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Domain card (client or competitor) ────────────────────────────────────────

function DomainCard({ domain, isClient, competitorType, onDomainChange, onTypeChange,
                      posFile, refFile, authorityScore,
                      onPosFile, onRefFile, onAuthorityScore,
                      onRemove, errors }) {
  const inputStyle = (hasErr) => ({
    width: '100%',
    border: `1px solid ${hasErr ? 'var(--danger)' : 'var(--border)'}`,
    borderRadius: 'var(--r-lg)',
    padding: '8px 12px',
    fontSize: 14,
    color: 'var(--text)',
    background: 'var(--card)',
    outline: 'none',
    boxSizing: 'border-box',
  });

  return (
    <div style={{
      borderRadius: 'var(--r-lg)',
      border: `1px solid ${isClient ? 'var(--danger)' : 'var(--border)'}`,
      background: isClient ? 'rgba(var(--danger-rgb, 211,52,46), 0.04)' : 'var(--card)',
      padding: 16,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          {isClient ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: 'var(--danger)' }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{domain}</span>
              <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, fontWeight: 500, background: 'var(--danger-soft)', color: 'var(--danger)' }}>Client</span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="text"
                placeholder="competitor.com"
                value={domain}
                onChange={e => onDomainChange(e.target.value)}
                style={{ ...inputStyle(errors?.domain), flex: 1 }}
              />
              <select
                value={competitorType}
                onChange={e => onTypeChange(e.target.value)}
                style={{
                  border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                  padding: '8px', fontSize: 12, color: 'var(--text)', background: 'var(--card)',
                  outline: 'none', width: 128, flexShrink: 0,
                }}
              >
                {COMPETITOR_TYPES.map(t => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={onRemove}
                title="Remove"
                style={{ color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, padding: 0 }}
              >
                <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
          {errors?.domain && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4, marginLeft: 16 }}>{errors.domain}</p>}
        </div>
      </div>

      {/* Uploads + authority score */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <FileZone
          label="Organic Positions"
          required
          file={posFile}
          onFile={onPosFile}
          error={errors?.posFile}
        />
        <FileZone
          label="Referring Domains"
          required={false}
          file={refFile}
          onFile={onRefFile}
          error={errors?.refFile}
        />
        <div>
          <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4, marginTop: 0 }}>Authority Score</p>
          <input
            type="number"
            min="0"
            max="100"
            placeholder="e.g. 42"
            value={authorityScore}
            onChange={e => onAuthorityScore(e.target.value)}
            style={{
              width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
              padding: '8px 12px', fontSize: 14, color: 'var(--text)', background: 'var(--card)',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>From Domain Overview</p>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ManualUpload({ clientDomain, brandName, onRunAnalysis, loading }) {
  const emptyDomain = () => ({ domain: '', competitorType: 'direct' });

  const [competitors, setCompetitors] = useState([emptyDomain(), emptyDomain()]);

  const [posFiles,  setPosFiles]  = useState({});
  const [refFiles,  setRefFiles]  = useState({});
  const [ascores,   setAscores]   = useState({});

  const [errors, setErrors]       = useState({});
  const [showInstructions, setShowInstructions] = useState(true);

  function setCompetitorField(i, field, val) {
    setCompetitors(prev => { const n = [...prev]; n[i] = { ...n[i], [field]: val }; return n; });
    setErrors(e => ({ ...e, [`comp_${i}_domain`]: undefined }));
  }

  function setFile(map, setMap, key, file) {
    setMap(prev => { const n = { ...prev }; if (file) n[key] = file; else delete n[key]; return n; });
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = e => resolve(e.target.result);
      r.onerror = () => reject(new Error('Failed to read ' + file.name));
      r.readAsText(file, 'UTF-8');
    });
  }

  async function handleSubmit() {
    const errs = {};

    if (!posFiles['client']) errs['client_posFile'] = 'Required';

    const validComps = competitors.map((c, i) => ({ ...c, i })).filter(c => c.domain.trim());
    if (!validComps.length) errs.noCompetitors = 'Add at least one competitor domain.';

    validComps.forEach(c => {
      if (!posFiles[`comp_${c.i}`]) errs[`comp_${c.i}_posFile`] = 'Required';
    });

    if (Object.keys(errs).length) { setErrors(errs); return; }

    try {
      const positionFiles  = {};
      const refdomainFiles = {};
      const authorityScores = {};

      const clientKey = clientDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

      positionFiles[clientKey]  = await readFile(posFiles['client']);
      if (refFiles['client'])   refdomainFiles[clientKey] = await readFile(refFiles['client']);
      if (ascores['client'])    authorityScores[clientKey] = parseInt(ascores['client']) || 0;

      for (const c of validComps) {
        const d = c.domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
        positionFiles[d]  = await readFile(posFiles[`comp_${c.i}`]);
        if (refFiles[`comp_${c.i}`]) refdomainFiles[d] = await readFile(refFiles[`comp_${c.i}`]);
        if (ascores[`comp_${c.i}`])  authorityScores[d] = parseInt(ascores[`comp_${c.i}`]) || 0;
      }

      const confirmedCompetitors = validComps.map(c => ({
        domain: c.domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, ''),
        competitorType: c.competitorType,
      }));

      onRunAnalysis(confirmedCompetitors, positionFiles, refdomainFiles, authorityScores);
    } catch (err) {
      setErrors({ submit: err.message });
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Instructions */}
      <div style={{ borderRadius: 'var(--r-lg)', border: '1px solid var(--info)', background: 'var(--info-soft)', overflow: 'hidden' }}>
        <button
          type="button"
          onClick={() => setShowInstructions(v => !v)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg style={{ width: 16, height: 16, color: 'var(--info)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--info)' }}>What to download from Semrush (per domain)</span>
          </div>
          <svg
            style={{ width: 16, height: 16, color: 'var(--info)', transform: showInstructions ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showInstructions && (
          <div style={{ padding: '12px 16px 16px', borderTop: '1px solid var(--info)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ background: 'var(--card)', borderRadius: 'var(--r-lg)', padding: 12, border: '1px solid var(--info)' }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--info)', marginBottom: 6, marginTop: 0 }}>1. Organic Positions <span style={{ color: 'var(--danger)' }}>*</span></p>
              <ol style={{ margin: 0, padding: '0 0 0 16px' }}>
                <li style={{ fontSize: 12, color: 'var(--text)', marginBottom: 4 }}>Go to <strong>Organic Research</strong> for the domain</li>
                <li style={{ fontSize: 12, color: 'var(--text)', marginBottom: 4 }}>Click the <strong>Positions</strong> tab</li>
                <li style={{ fontSize: 12, color: 'var(--text)', marginBottom: 4 }}>Set the correct country</li>
                <li style={{ fontSize: 12, color: 'var(--text)' }}>Click <strong>Export → CSV</strong></li>
              </ol>
              <p style={{ fontSize: 12, color: 'var(--info)', marginTop: 8, marginBottom: 0, fontStyle: 'italic' }}>Gives: keywords, positions, volumes, URLs, SERP features</p>
            </div>
            <div style={{ background: 'var(--card)', borderRadius: 'var(--r-lg)', padding: 12, border: '1px solid var(--info)' }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--info)', marginBottom: 6, marginTop: 0 }}>2. Referring Domains <span style={{ color: 'var(--text-3)' }}>(optional)</span></p>
              <ol style={{ margin: 0, padding: '0 0 0 16px' }}>
                <li style={{ fontSize: 12, color: 'var(--text)', marginBottom: 4 }}>Go to <strong>Backlink Analytics</strong> for the domain</li>
                <li style={{ fontSize: 12, color: 'var(--text)', marginBottom: 4 }}>Click the <strong>Referring Domains</strong> tab</li>
                <li style={{ fontSize: 12, color: 'var(--text)' }}>Click <strong>Export → CSV</strong></li>
              </ol>
              <p style={{ fontSize: 12, color: 'var(--info)', marginTop: 8, marginBottom: 0, fontStyle: 'italic' }}>Gives: backlinks, referring domains, follow/nofollow, authority buckets</p>
            </div>
            <div style={{ gridColumn: '1 / -1', background: 'var(--card)', borderRadius: 'var(--r-lg)', padding: 12, border: '1px solid var(--info)' }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--info)', marginBottom: 4, marginTop: 0 }}>3. Authority Score <span style={{ color: 'var(--text-3)' }}>(optional)</span></p>
              <p style={{ fontSize: 12, color: 'var(--text)', margin: 0 }}>Visible on the <strong>Domain Overview</strong> page for any domain. Enter the number directly in the field below.</p>
            </div>
          </div>
        )}
      </div>

      {/* Client domain card */}
      <div>
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8, marginTop: 0 }}>Client Domain</p>
        <DomainCard
          domain={clientDomain}
          isClient
          posFile={posFiles['client']}
          refFile={refFiles['client']}
          authorityScore={ascores['client'] || ''}
          onPosFile={f => setFile(posFiles, setPosFiles, 'client', f)}
          onRefFile={f => setFile(refFiles, setRefFiles, 'client', f)}
          onAuthorityScore={v => setAscores(prev => ({ ...prev, client: v }))}
          errors={{ posFile: errors['client_posFile'] }}
        />
      </div>

      {/* Competitor cards */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Competitor Domains</p>
          {errors.noCompetitors && <p style={{ fontSize: 12, color: 'var(--danger)', margin: 0 }}>{errors.noCompetitors}</p>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {competitors.map((comp, i) => (
            <DomainCard
              key={i}
              domain={comp.domain}
              isClient={false}
              competitorType={comp.competitorType}
              onDomainChange={v => setCompetitorField(i, 'domain', v)}
              onTypeChange={v => setCompetitorField(i, 'competitorType', v)}
              posFile={posFiles[`comp_${i}`]}
              refFile={refFiles[`comp_${i}`]}
              authorityScore={ascores[`comp_${i}`] || ''}
              onPosFile={f => setFile(posFiles, setPosFiles, `comp_${i}`, f)}
              onRefFile={f => setFile(refFiles, setRefFiles, `comp_${i}`, f)}
              onAuthorityScore={v => setAscores(prev => ({ ...prev, [`comp_${i}`]: v }))}
              onRemove={() => setCompetitors(prev => prev.filter((_, idx) => idx !== i))}
              errors={{ domain: errors[`comp_${i}_domain`], posFile: errors[`comp_${i}_posFile`] }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setCompetitors(prev => [...prev, emptyDomain()])}
          style={{
            marginTop: 12, display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 500, color: 'var(--primary)',
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          }}
        >
          <svg style={{ width: 14, height: 14 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add competitor
        </button>
      </div>

      {errors.submit && (
        <p style={{
          fontSize: 14, color: 'var(--danger)',
          background: 'var(--danger-soft)', border: '1px solid var(--danger)',
          borderRadius: 'var(--r-lg)', padding: '8px 12px', margin: 0,
        }}>{errors.submit}</p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={loading}
        style={{
          width: '100%', padding: '12px 0', borderRadius: 'var(--r-lg)',
          fontSize: 14, fontWeight: 600, color: '#fff', border: 'none', cursor: 'pointer',
          background: 'var(--primary)', opacity: loading ? 0.5 : 1, transition: 'opacity 0.15s',
        }}
      >
        {loading ? 'Processing files…' : 'Run Analysis'}
      </button>
    </div>
  );
}
