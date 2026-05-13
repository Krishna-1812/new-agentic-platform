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

  return (
    <div>
      <p className="text-xs text-[#6B7280] mb-1">
        {label} {required && <span className="text-red-400">*</span>}
      </p>
      <div
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => ref.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed px-3 py-2 text-center transition-colors ${
          file
            ? 'border-green-400 bg-green-50'
            : error
            ? 'border-red-300 bg-red-50'
            : 'border-[#D1D5DB] bg-white hover:border-[#245E9E] hover:bg-blue-50'
        }`}
      >
        <input
          ref={ref}
          type="file"
          accept=".csv,.txt"
          className="hidden"
          onChange={e => { if (e.target.files[0]) onFile(e.target.files[0]); }}
        />
        {file ? (
          <div className="flex items-center justify-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            <span className="text-xs font-medium text-green-700 truncate max-w-[130px]">{file.name}</span>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onFile(null); }}
              className="text-green-400 hover:text-red-500 ml-0.5"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <p className="text-xs text-[#9CA3AF]">
            {error
              ? <span className="text-red-500">{error}</span>
              : <><span className="text-[#245E9E] font-medium">Browse</span> or drop CSV</>}
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
  const inputCls = 'w-full border border-[#D1D5DB] rounded-lg px-3 py-2 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#245E9E] focus:border-transparent';

  return (
    <div className={`rounded-xl border p-4 ${isClient ? 'border-[#D3342E] bg-red-50/30' : 'border-[#E5E7EB] bg-white'}`}>
      {/* Header row */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1">
          {isClient ? (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#D3342E' }} />
              <span className="text-sm font-semibold text-[#111827]">{domain}</span>
              <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ backgroundColor: '#D3342E1A', color: '#D3342E' }}>Client</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="competitor.com"
                value={domain}
                onChange={e => onDomainChange(e.target.value)}
                className={inputCls + (errors?.domain ? ' border-red-400' : '')}
              />
              <select
                value={competitorType}
                onChange={e => onTypeChange(e.target.value)}
                className="border border-[#D1D5DB] rounded-lg px-2 py-2 text-xs text-[#374151] focus:outline-none w-32 flex-shrink-0"
              >
                {COMPETITOR_TYPES.map(t => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={onRemove}
                className="text-[#9CA3AF] hover:text-red-500 flex-shrink-0"
                title="Remove"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
          {errors?.domain && <p className="text-xs text-red-500 mt-1 ml-4">{errors.domain}</p>}
        </div>
      </div>

      {/* Uploads + authority score */}
      <div className="grid grid-cols-3 gap-3">
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
          <p className="text-xs text-[#6B7280] mb-1">Authority Score</p>
          <input
            type="number"
            min="0"
            max="100"
            placeholder="e.g. 42"
            value={authorityScore}
            onChange={e => onAuthorityScore(e.target.value)}
            className="w-full border border-[#D1D5DB] rounded-lg px-3 py-2 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#245E9E]"
          />
          <p className="text-xs text-[#9CA3AF] mt-0.5">From Domain Overview</p>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ManualUpload({ clientDomain, brandName, onRunAnalysis, loading }) {
  const emptyDomain = () => ({ domain: '', competitorType: 'direct' });

  const [competitors, setCompetitors] = useState([emptyDomain(), emptyDomain()]);

  // Per-domain file + score state — keyed by "client" or competitor index
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

    // Client positions file required
    if (!posFiles['client']) errs['client_posFile'] = 'Required';

    // Validate competitors
    const validComps = competitors.map((c, i) => ({ ...c, i })).filter(c => c.domain.trim());
    if (!validComps.length) errs.noCompetitors = 'Add at least one competitor domain.';

    validComps.forEach(c => {
      if (!posFiles[`comp_${c.i}`]) errs[`comp_${c.i}_posFile`] = 'Required';
    });

    if (Object.keys(errs).length) { setErrors(errs); return; }

    // Read all files
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
    <div className="space-y-5">

      {/* Instructions */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowInstructions(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3"
        >
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-semibold text-blue-800">What to download from Semrush (per domain)</span>
          </div>
          <svg className={`w-4 h-4 text-blue-500 transition-transform ${showInstructions ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showInstructions && (
          <div className="px-4 pb-4 pt-3 border-t border-blue-200 grid grid-cols-2 gap-4">
            <div className="bg-white rounded-lg p-3 border border-blue-100">
              <p className="text-xs font-bold text-blue-900 mb-1.5">1. Organic Positions <span className="text-red-500">*</span></p>
              <ol className="space-y-1 text-xs text-blue-800">
                <li>Go to <strong>Organic Research</strong> for the domain</li>
                <li>Click the <strong>Positions</strong> tab</li>
                <li>Set the correct country</li>
                <li>Click <strong>Export → CSV</strong></li>
              </ol>
              <p className="text-xs text-blue-600 mt-2 italic">Gives: keywords, positions, volumes, URLs, SERP features</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-blue-100">
              <p className="text-xs font-bold text-blue-900 mb-1.5">2. Referring Domains <span className="text-[#9CA3AF]">(optional)</span></p>
              <ol className="space-y-1 text-xs text-blue-800">
                <li>Go to <strong>Backlink Analytics</strong> for the domain</li>
                <li>Click the <strong>Referring Domains</strong> tab</li>
                <li>Click <strong>Export → CSV</strong></li>
              </ol>
              <p className="text-xs text-blue-600 mt-2 italic">Gives: backlinks, referring domains, follow/nofollow, authority buckets</p>
            </div>
            <div className="col-span-2 bg-white rounded-lg p-3 border border-blue-100">
              <p className="text-xs font-bold text-blue-900 mb-1">3. Authority Score <span className="text-[#9CA3AF]">(optional)</span></p>
              <p className="text-xs text-blue-800">Visible on the <strong>Domain Overview</strong> page for any domain. Enter the number directly in the field below.</p>
            </div>
          </div>
        )}
      </div>

      {/* Client domain card */}
      <div>
        <p className="text-xs font-semibold text-[#374151] mb-2">Client Domain</p>
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
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-[#374151]">Competitor Domains</p>
          {errors.noCompetitors && <p className="text-xs text-red-500">{errors.noCompetitors}</p>}
        </div>
        <div className="space-y-3">
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
          className="mt-3 flex items-center gap-1.5 text-xs font-medium text-[#245E9E] hover:text-[#1a4a7a]"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add competitor
        </button>
      </div>

      {errors.submit && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{errors.submit}</p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={loading}
        className="w-full py-3 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50"
        style={{ backgroundColor: '#245E9E' }}
      >
        {loading ? 'Processing files…' : 'Run Analysis'}
      </button>
    </div>
  );
}
