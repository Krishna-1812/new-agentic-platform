import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const STEPS = [
  { id: 'scrape', label: 'Scraping Pages',      icon: '🔍' },
  { id: 'export', label: 'Building Excel',       icon: '📊' },
];

const DEFAULT_CONFIG = {
  brandName: 'Riccobene Associates',
  locationSuffix: ', NC',
  sitewidePrefix: '6916222bad26f3b001d31303',
  locationPrefix: '6916222bad26f3b001d31354',
  plansFilenames: 'pricing-1, pricing-2',
  concurrency: '5',
};

function StepBadge({ status }) {
  if (status === 'done') return (
    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-green-500 text-white text-xs font-bold">✓</span>
  );
  if (status === 'active') return (
    <span className="flex items-center justify-center w-7 h-7 rounded-full" style={{ backgroundColor: '#3DAA8E' }}>
      <svg className="animate-spin w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </span>
  );
  return <span className="flex items-center justify-center w-7 h-7 rounded-full bg-gray-200 text-gray-400 text-xs">·</span>;
}

function UrlStatusIcon({ status }) {
  if (status === 'done')
    return <span className="text-green-500 font-bold flex-shrink-0">✓</span>;
  if (status === 'error')
    return <span className="text-red-400 flex-shrink-0">✕</span>;
  if (status === 'loading')
    return (
      <svg className="animate-spin w-3 h-3 flex-shrink-0" style={{ color: '#3DAA8E' }} viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    );
  return <span className="w-3 h-3 rounded-full bg-gray-200 flex-shrink-0" />;
}

function parseUrlList(raw) {
  return raw
    .split(/[\r\n,]+/)
    .map(u => u.trim())
    .filter(u => u && (u.startsWith('http://') || u.startsWith('https://')));
}

export default function ImageAltAuditPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const esRef = useRef(null);

  const [urlInput, setUrlInput] = useState('');
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [showConfig, setShowConfig] = useState(false);

  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [steps, setSteps] = useState({});
  const [urlStatuses, setUrlStatuses] = useState({}); // index → { url, status, locationName, contentCount, decorativeCount, error }
  const [error, setError] = useState('');
  const [download, setDownload] = useState(null); // { token, filename }

  const parsedUrls = parseUrlList(urlInput);
  const urlCount = parsedUrls.length;
  const canStart = urlCount > 0 && !running;

  function reset() {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setStarted(false);
    setRunning(false);
    setSteps({});
    setUrlStatuses({});
    setError('');
    setDownload(null);
  }

  function handleConfigChange(key, value) {
    setConfig(prev => ({ ...prev, [key]: value }));
  }

  function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target.result || '';
      const lines = text.split(/[\r\n]+/).map(l => l.split(',')[0].trim()).filter(Boolean);
      setUrlInput(lines.join('\n'));
    };
    reader.readAsText(file);
    // Reset file input so the same file can be re-uploaded
    e.target.value = '';
  }

  async function startAudit() {
    if (!canStart) return;
    reset();
    setStarted(true);
    setRunning(true);

    // Pre-populate url status slots
    const initial = {};
    parsedUrls.forEach((url, idx) => { initial[idx] = { url, status: 'pending' }; });
    setUrlStatuses(initial);

    try {
      const configPayload = {
        brandName: config.brandName,
        locationSuffix: config.locationSuffix,
        sitewidePrefix: config.sitewidePrefix,
        locationPrefix: config.locationPrefix,
        plansFilenames: config.plansFilenames.split(',').map(s => s.trim()).filter(Boolean),
        concurrency: parseInt(config.concurrency) || 5,
      };

      const initRes = await fetch('/api/image-alt-audit/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ urls: parsedUrls, config: configPayload }),
      });
      if (!initRes.ok) {
        const err = await initRes.json();
        throw new Error(err.error || 'Failed to start audit');
      }
      const { token } = await initRes.json();

      const es = new EventSource(`/api/image-alt-audit/stream/${token}`);
      esRef.current = es;

      es.addEventListener('step', e => {
        const d = JSON.parse(e.data);
        setSteps(prev => ({ ...prev, [d.id]: { status: d.status, message: d.message } }));
      });

      es.addEventListener('url_start', e => {
        const d = JSON.parse(e.data);
        setUrlStatuses(prev => ({ ...prev, [d.index]: { ...prev[d.index], url: d.url, status: 'loading' } }));
      });

      es.addEventListener('url_done', e => {
        const d = JSON.parse(e.data);
        setUrlStatuses(prev => ({
          ...prev,
          [d.index]: {
            url: d.url,
            status: d.success ? 'done' : 'error',
            locationName: d.locationName,
            contentCount: d.contentCount,
            decorativeCount: d.decorativeCount,
            error: d.error,
          },
        }));
      });

      es.addEventListener('ready', e => {
        const d = JSON.parse(e.data);
        setDownload({ token: d.downloadToken, filename: d.filename });
      });

      es.addEventListener('fail', e => {
        setError(JSON.parse(e.data).message);
      });

      es.addEventListener('done', () => {
        es.close();
        esRef.current = null;
        setRunning(false);
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        setRunning(false);
        setError(prev => prev || 'Connection lost. Please try again.');
      };

    } catch (err) {
      setError(err.message);
      setRunning(false);
    }
  }

  function handleDownload() {
    if (!download) return;
    window.location.href = `/api/image-alt-audit/download/${download.token}`;
  }

  const urlStatusList = Object.values(urlStatuses);
  const doneCount = urlStatusList.filter(u => u.status === 'done' || u.status === 'error').length;
  const successCount = urlStatusList.filter(u => u.status === 'done').length;
  const failedCount = urlStatusList.filter(u => u.status === 'error').length;
  const totalContentImages = urlStatusList.reduce((s, u) => s + (u.contentCount || 0), 0);
  const totalDecorativeImages = urlStatusList.reduce((s, u) => s + (u.decorativeCount || 0), 0);

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F4F5F7' }}>
      {/* Header */}
      <header className="bg-white border-b border-[#E5E7EB] h-14 flex items-center px-6">
        <div className="max-w-5xl mx-auto w-full flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-[#6B7280] hover:text-[#111827] text-sm font-medium transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            All tools
          </button>
          <span className="text-[#E5E7EB]">/</span>
          <span className="text-sm font-semibold text-[#111827]">Image Alt Tag Audit</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-7 space-y-5">

        {/* ── Input Card ──────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-6" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          <div className="mb-4">
            <label className="block text-sm font-semibold text-[#111827] mb-1.5">Location Page URLs</label>
            <p className="text-xs text-[#6B7280] mb-2">One URL per line. Paste directly or upload a .txt / .csv file.</p>
            <textarea
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              disabled={running}
              rows={6}
              placeholder={`https://www.brushandfloss.com/locations/cary-family-specialty\nhttps://www.brushandfloss.com/locations/apex\nhttps://www.brushandfloss.com/locations/raleigh`}
              className="w-full px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-sm text-[#111827] placeholder-[#9CA3AF] font-mono focus:outline-none focus:ring-2 disabled:bg-[#F4F5F7] disabled:text-[#9CA3AF] resize-none"
              style={{ '--tw-ring-color': '#3DAA8E' }}
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-[#6B7280]">
                {urlCount > 0 ? (
                  <span className="font-semibold" style={{ color: '#3DAA8E' }}>{urlCount} URL{urlCount !== 1 ? 's' : ''} ready</span>
                ) : 'No URLs entered yet'}
              </span>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={running}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB] transition-colors disabled:opacity-50"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                Upload .txt / .csv
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.csv"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
          </div>

          {/* Config toggle */}
          <div className="border-t border-[#F3F4F6] pt-4">
            <button
              onClick={() => setShowConfig(v => !v)}
              className="flex items-center gap-2 text-xs font-semibold text-[#6B7280] hover:text-[#111827] transition-colors"
            >
              <svg
                className={`w-3.5 h-3.5 transition-transform ${showConfig ? 'rotate-90' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
              Configuration
              <span className="text-[#9CA3AF] font-normal">(optional overrides)</span>
            </button>

            {showConfig && (
              <div className="mt-4 grid grid-cols-2 gap-4">
                {[
                  { key: 'brandName',       label: 'Brand name',              placeholder: DEFAULT_CONFIG.brandName },
                  { key: 'locationSuffix',  label: 'Location suffix',         placeholder: DEFAULT_CONFIG.locationSuffix },
                  { key: 'sitewidePrefix',  label: 'Sitewide CDN prefix',     placeholder: DEFAULT_CONFIG.sitewidePrefix },
                  { key: 'locationPrefix',  label: 'Location CDN prefix',     placeholder: DEFAULT_CONFIG.locationPrefix },
                  { key: 'plansFilenames',  label: 'Plans image filenames',   placeholder: DEFAULT_CONFIG.plansFilenames },
                  { key: 'concurrency',     label: 'Concurrency (1–10)',      placeholder: DEFAULT_CONFIG.concurrency },
                ].map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-[#374151] mb-1">{label}</label>
                    <input
                      type="text"
                      value={config[key]}
                      onChange={e => handleConfigChange(key, e.target.value)}
                      disabled={running}
                      placeholder={placeholder}
                      className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-xs text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 disabled:bg-[#F4F5F7] font-mono"
                      style={{ '--tw-ring-color': '#3DAA8E' }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={startAudit}
              disabled={!canStart}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#111827' }}
            >
              {running ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Running audit…
                </>
              ) : 'Run Audit'}
            </button>
            {started && !running && (
              <button onClick={reset} className="text-sm text-gray-500 hover:text-gray-700 underline">
                Reset
              </button>
            )}
          </div>
        </div>

        {/* ── Error ───────────────────────────────────────────────────── */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
            <span className="text-red-500 mt-0.5 flex-shrink-0">✕</span>
            <p className="text-red-800 text-sm font-medium flex-1">{error}</p>
            <button
              onClick={startAudit}
              disabled={!urlCount}
              className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50"
              style={{ backgroundColor: '#111827' }}
            >
              Retry
            </button>
          </div>
        )}

        {/* ── Progress ─────────────────────────────────────────────────── */}
        {started && (
          <div className="space-y-3">
            {STEPS.map(stepCfg => {
              const s = steps[stepCfg.id] || {};
              return (
                <div
                  key={stepCfg.id}
                  className={`bg-white rounded-xl border overflow-hidden transition-all ${s.status === 'active' ? 'border-[#3DAA8E]' : 'border-[#E5E7EB]'}`}
                  style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}
                >
                  <div className={`flex items-center gap-3 px-5 py-3.5 ${s.status === 'active' ? 'bg-[#F0FAF7]' : 'bg-[#F9FAFB]'}`}>
                    <StepBadge status={s.status} />
                    <span className="text-base">{stepCfg.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-gray-800">{stepCfg.label}</span>
                        {s.status === 'active' && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium animate-pulse" style={{ backgroundColor: '#3DAA8E1A', color: '#3DAA8E' }}>
                            In progress
                          </span>
                        )}
                        {s.status === 'done' && (
                          <span className="text-xs bg-[#F4F5F7] text-[#6B7280] px-2 py-0.5 rounded-full font-medium">Done</span>
                        )}
                      </div>
                      {s.message && <p className="text-xs text-gray-500 mt-0.5">{s.message}</p>}
                    </div>
                  </div>

                  {/* Per-URL grid (scrape step only) */}
                  {stepCfg.id === 'scrape' && urlStatusList.length > 0 && (
                    <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-1.5">
                      {urlStatusList.map((u, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-xs">
                          <div className="mt-0.5"><UrlStatusIcon status={u.status} /></div>
                          <div className="min-w-0 flex-1">
                            <span className={`truncate block ${u.status === 'error' ? 'text-red-400' : 'text-[#6B7280]'}`}>
                              {(() => { try { return new URL(u.url).pathname.replace(/\/$/, '').split('/').pop() || new URL(u.url).hostname; } catch { return u.url; } })()}
                            </span>
                            {u.status === 'done' && u.locationName && (
                              <span className="text-[#9CA3AF]">{u.locationName} · {u.contentCount} content, {u.decorativeCount} decorative</span>
                            )}
                            {u.status === 'error' && u.error && (
                              <span className="text-red-300">{u.error.substring(0, 60)}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Summary stats (shown once scraping is underway) ──────────── */}
        {doneCount > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Pages processed', value: `${doneCount} / ${urlStatusList.length}`, color: '#3DAA8E' },
              { label: 'Successful', value: successCount, color: '#22C55E' },
              { label: 'Failed', value: failedCount, color: failedCount > 0 ? '#EF4444' : '#9CA3AF' },
              { label: 'Content images', value: totalContentImages, color: '#3DAA8E' },
            ].map(stat => (
              <div key={stat.label} className="bg-white rounded-xl border border-[#E5E7EB] px-4 py-3" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <p className="text-xs text-[#6B7280] font-medium">{stat.label}</p>
                <p className="text-xl font-bold mt-0.5" style={{ color: stat.color }}>{stat.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Download ─────────────────────────────────────────────────── */}
        {download && (
          <div className="bg-white rounded-xl border border-[#3DAA8E] p-5 flex items-center justify-between" style={{ boxShadow: '0 1px 3px rgba(61,170,142,0.15)' }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#F0FAF7' }}>
                <svg className="w-5 h-5" style={{ color: '#3DAA8E' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#111827]">Audit complete</p>
                <p className="text-xs text-[#6B7280] mt-0.5">{download.filename}</p>
              </div>
            </div>
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all"
              style={{ backgroundColor: '#111827' }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Download .xlsx
            </button>
          </div>
        )}

        {/* ── Legend ──────────────────────────────────────────────────── */}
        {started && (
          <div className="bg-white rounded-xl border border-[#E5E7EB] px-5 py-4" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <p className="text-xs font-semibold text-[#6B7280] mb-3 uppercase tracking-wider">Excel row colours</p>
            <div className="flex flex-wrap gap-3">
              {[
                { label: 'Doctor',      color: '#E8F0FE' },
                { label: 'Service',     color: '#E6F4EA' },
                { label: 'Dental Plan', color: '#FFF8E1' },
                { label: 'Hero Banner', color: '#FCE4EC' },
                { label: 'Unknown',     color: '#FFE0B2' },
              ].map(({ label, color }) => (
                <div key={label} className="flex items-center gap-1.5 text-xs text-[#374151]">
                  <span className="w-3.5 h-3.5 rounded-sm border border-[#E5E7EB] flex-shrink-0" style={{ backgroundColor: color }} />
                  {label}
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
