import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import InputForm from '../components/competitorAnalysis/InputForm';
import CompetitorConfirmation from '../components/competitorAnalysis/CompetitorConfirmation';
import ManualUpload from '../components/competitorAnalysis/ManualUpload';
import ProgressTracker from '../components/competitorAnalysis/ProgressTracker';
import ReportPreview from '../components/competitorAnalysis/ReportPreview';

const API_STEPS  = [{ id: 1, label: 'Input' }, { id: 2, label: 'Discovery' }, { id: 3, label: 'Confirm' }, { id: 4, label: 'Analysis' }, { id: 5, label: 'Report' }];
const MANUAL_STEPS = [{ id: 1, label: 'Input' }, { id: 3, label: 'Upload' }, { id: 4, label: 'Analysis' }, { id: 5, label: 'Report' }];

function StepBar({ step, mode }) {
  const steps = mode === 'manual' ? MANUAL_STEPS : API_STEPS;
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((s, i) => {
        const done = step > s.id;
        const active = step === s.id;
        return (
          <div key={s.id} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                done ? 'bg-green-500 text-white' : active ? 'text-white' : 'bg-[#E5E7EB] text-[#9CA3AF]'
              }`} style={active ? { backgroundColor: '#245E9E' } : {}}>
                {done ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (i + 1)}
              </div>
              <span className={`text-xs mt-1 font-medium ${active ? 'text-[#245E9E]' : done ? 'text-green-600' : 'text-[#9CA3AF]'}`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-0.5 flex-1 mb-4 transition-colors ${done ? 'bg-green-400' : 'bg-[#E5E7EB]'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function CompetitorAnalysisPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState('api'); // 'api' | 'manual'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 3 data
  const [jobId, setJobId] = useState(null);
  const [competitors, setCompetitors] = useState([]);
  const [gptSummary, setGptSummary] = useState('');
  const [brandInfo, setBrandInfo] = useState(null);

  // Step 4 data
  const [sectionStatuses, setSectionStatuses] = useState({});
  const [overallProgress, setOverallProgress] = useState(0);

  // Step 5 data
  const [reportData, setReportData] = useState(null);

  const esRef = useRef(null);

  useEffect(() => {
    return () => {
      if (esRef.current) esRef.current.close();
    };
  }, []);

  // ── Step 1: Form submit — branches on mode ──────────────────────────────────

  async function handleDiscover(formData) {
    setLoading(true);
    setError('');
    setBrandInfo(formData);

    if (formData.mode === 'manual') {
      // Just create the job without hitting Semrush
      try {
        const res = await fetch('/api/competitor-analysis/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to prepare job');
        setJobId(data.jobId);
        setStep(3); // ManualUpload step
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
      return;
    }

    // API mode: discover via Semrush
    setStep(2);
    try {
      const res = await fetch('/api/competitor-analysis/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Discovery failed');
      setJobId(data.jobId);
      setCompetitors(data.competitors || []);
      setGptSummary(data.gptSummary || '');
      setStep(3);
    } catch (err) {
      setError(err.message);
      setStep(1);
    } finally {
      setLoading(false);
    }
  }

  // ── Step 3 (API mode) → 4: Run Full Analysis ───────────────────────────────

  async function handleRunAnalysis(confirmedCompetitors) {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/competitor-analysis/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, competitors: confirmedCompetitors }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start analysis');
      setStep(4);
      setLoading(false);
      connectSSE(jobId);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  // ── Step 3 (Manual mode) → 4: Upload CSVs and run ─────────────────────────

  async function handleManualRun(confirmedCompetitors, positionFiles, refdomainFiles, authorityScores) {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/competitor-analysis/run-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, competitors: confirmedCompetitors, positionFiles, refdomainFiles, authorityScores }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start analysis');
      setStep(4);
      setLoading(false);
      connectSSE(jobId);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  function connectSSE(id) {
    if (esRef.current) esRef.current.close();

    const es = new EventSource(`/api/competitor-analysis/progress/${id}`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        handleSSEEvent(event);
      } catch {}
    };

    es.onerror = () => {
      es.close();
    };
  }

  function handleSSEEvent(event) {
    if (event.type === 'section_start') {
      setSectionStatuses(s => ({ ...s, [event.section]: 'active' }));
    } else if (event.type === 'section_done') {
      setSectionStatuses(s => ({ ...s, [event.section]: 'done' }));
      setOverallProgress(event.progress || 0);
    } else if (event.type === 'done') {
      setSectionStatuses(s => {
        const all = { ...s };
        Object.keys(all).forEach(k => { all[k] = 'done'; });
        return all;
      });
      setOverallProgress(100);
      setReportData(event.reportData);
      setTimeout(() => setStep(5), 800);
      if (esRef.current) esRef.current.close();
    } else if (event.type === 'error') {
      setError(event.message || 'Analysis failed');
      if (esRef.current) esRef.current.close();
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const stepTitles = {
    1: 'New Competitor Analysis',
    2: 'Discovering Competitors…',
    3: mode === 'manual' ? 'Upload Semrush Reports' : 'Confirm Competitor List',
    4: 'Running Full Analysis…',
    5: 'Report Preview',
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F4F5F7' }}>
      {/* Top nav */}
      <header className="bg-white border-b border-[#E5E7EB] h-14 flex items-center px-6">
        <div className="max-w-4xl mx-auto w-full flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-[#6B7280] hover:text-[#111827] transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </button>
            <div className="w-px h-4 bg-[#E5E7EB]" />
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded flex items-center justify-center" style={{ backgroundColor: '#D3342E1A' }}>
                <svg className="w-3.5 h-3.5" style={{ color: '#D3342E' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <span className="font-semibold text-[#111827] text-sm">Competitor Analysis</span>
            </div>
          </div>
          {brandInfo && (
            <span className="text-xs text-[#6B7280]">
              {brandInfo.brandName} · {brandInfo.targetUrl} · {brandInfo.country}
            </span>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <StepBar step={step} mode={mode} />

        {/* Error banner */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-red-800">Error</p>
              <p className="text-sm text-red-700 mt-0.5">{error}</p>
            </div>
            <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        <div className="bg-white rounded-xl border border-[#E5E7EB] p-6" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          <h2 className="text-lg font-bold text-[#111827] mb-5">{stepTitles[step]}</h2>

          {/* Step 1: Input */}
          {step === 1 && (
            <InputForm
              onSubmit={handleDiscover}
              loading={loading}
              mode={mode}
              onModeChange={m => setMode(m)}
            />
          )}

          {/* Step 2: Auto-discovery loading (API mode only) */}
          {step === 2 && (
            <div className="flex flex-col items-center justify-center py-12 gap-5">
              <div className="w-12 h-12 border-4 border-[#245E9E] border-t-transparent rounded-full animate-spin" />
              <div className="text-center">
                <p className="text-sm font-semibold text-[#374151]">Discovering competitors…</p>
                <p className="text-xs text-[#9CA3AF] mt-1">Pulling Semrush data and running AI validation</p>
              </div>
            </div>
          )}

          {/* Step 3: Confirm competitors (API) or Upload CSVs (manual) */}
          {step === 3 && mode === 'api' && (
            <CompetitorConfirmation
              competitors={competitors}
              gptSummary={gptSummary}
              onConfirm={handleRunAnalysis}
              loading={loading}
            />
          )}
          {step === 3 && mode === 'manual' && (
            <ManualUpload
              clientDomain={brandInfo?.targetUrl || ''}
              brandName={brandInfo?.brandName || ''}
              onRunAnalysis={(comps, posFiles, refFiles, ascores) => handleManualRun(comps, posFiles, refFiles, ascores)}
              loading={loading}
            />
          )}

          {/* Step 4: Progress */}
          {step === 4 && (
            <ProgressTracker
              sectionStatuses={sectionStatuses}
              overallProgress={overallProgress}
            />
          )}

          {/* Step 5: Report */}
          {step === 5 && reportData && (
            <ReportPreview
              reportData={reportData}
              jobId={jobId}
              brandName={brandInfo?.brandName || 'Brand'}
            />
          )}
        </div>

        {step === 5 && (
          <p className="text-center text-xs text-[#9CA3AF] mt-4">
            {mode === 'manual'
              ? 'Data sourced from uploaded Semrush CSV exports · 0 API units used'
              : 'Semrush API · approximately 150,000–200,000 units per report'}
          </p>
        )}
      </main>
    </div>
  );
}
