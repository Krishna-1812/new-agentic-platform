import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import KeywordInput from '../components/KeywordInput';
import ProgressSteps from '../components/ProgressSteps';
import SerpUrls from '../components/SerpUrls';
import ResultsTable from '../components/ResultsTable';
import ExportButtons from '../components/ExportButtons';
import KBContextSelector from '../components/KBContextSelector';

const CONFIDENCE_STYLES = {
  HIGH:   { bg: '#D1FAE5', text: '#065F46', label: 'KB: HIGH' },
  MEDIUM: { bg: '#FEF9C3', text: '#92400E', label: 'KB: MEDIUM' },
  LOW:    { bg: '#FEE2E2', text: '#DC2626', label: 'KB: LOW' },
};

export default function ContentResearchPage() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [client, setClient] = useState('');
  const [feedbackKbId, setFeedbackKbId] = useState(null);
  const [step, setStep] = useState('idle');
  const [serpResults, setSerpResults] = useState(null);
  const [scrapeResults, setScrapeResults] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [kbConfidence, setKbConfidence] = useState(null);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [searchCount, setSearchCount] = useState(0);

  const isLoading = ['searching', 'scraping', 'analyzing'].includes(step);

  async function handleResearch() {
    if (!keyword.trim() || isLoading) return;

    setStep('searching');
    setSerpResults(null);
    setScrapeResults(null);
    setAnalysis(null);
    setError('');
    setWarnings([]);

    try {
      const searchRes = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim() })
      });
      if (!searchRes.ok) throw new Error((await searchRes.json()).error || 'Google search failed.');
      const searchData = await searchRes.json();
      setSerpResults(searchData.results);
      setSearchCount(searchData.searchCount || 0);

      setStep('scraping');
      const scrapeRes = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: searchData.results.map(r => r.url) })
      });
      if (!scrapeRes.ok) throw new Error((await scrapeRes.json()).error || 'Scraping failed.');
      const scrapeData = await scrapeRes.json();
      setScrapeResults(scrapeData.results);

      const allWarnings = [...(scrapeData.warnings || [])];
      const failed = scrapeData.results.filter(r => !r.success);
      if (failed.length > 0 && !allWarnings.some(w => w.includes('scraped'))) {
        allWarnings.push(`${failed.length} page(s) could not be scraped and were skipped.`);
      }

      setStep('analyzing');
      const analyzeRes = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim(), scrapedPages: scrapeData.results, client: client || undefined, feedbackKbId: feedbackKbId || undefined })
      });
      if (!analyzeRes.ok) throw new Error((await analyzeRes.json()).error || 'Analysis failed.');
      const analyzeData = await analyzeRes.json();
      setAnalysis(analyzeData.analysis);
      setKbConfidence(analyzeData.kbConfidence || null);
      setWarnings(allWarnings);
      setStep('done');
    } catch (err) {
      setError(err.message);
      setStep('error');
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F4F5F7' }}>
      <header className="bg-white border-b border-[#E5E7EB] h-14 flex items-center px-6">
        <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
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
            <div>
              <span className="text-sm font-semibold text-[#111827]">Content Research</span>
            </div>
          </div>
          {searchCount > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#6B7280]">Daily searches</span>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-24 bg-[#E5E7EB] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{
                    width: `${Math.min(100, searchCount)}%`,
                    backgroundColor: searchCount >= 90 ? '#EF4444' : searchCount >= 70 ? '#D97706' : '#3DAA8E'
                  }} />
                </div>
                <span className="text-xs font-semibold text-[#111827]">{searchCount}<span className="text-[#9CA3AF] font-normal"> / 100</span></span>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-7">
        <KBContextSelector
          module="content-research"
          onChange={({ client: c, feedbackKbId: fb }) => { setClient(c); setFeedbackKbId(fb); }}
          disabled={isLoading}
        />
        <div className="mt-4">
        <KeywordInput keyword={keyword} setKeyword={setKeyword} onSearch={handleResearch} disabled={isLoading} /></div>

        {step !== 'idle' && <div className="mt-6"><ProgressSteps step={step} /></div>}

        {warnings.length > 0 && (
          <div className="mt-4 p-4 bg-[#FEF9C3] border border-[#FDE68A] rounded-xl">
            <div className="flex items-start gap-2">
              <span className="mt-0.5" style={{ color: '#D97706' }}>⚠</span>
              <div className="space-y-1">{warnings.map((w, i) => <p key={i} className="text-sm" style={{ color: '#92400E' }}>{w}</p>)}</div>
            </div>
          </div>
        )}

        {step === 'error' && error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl">
            <div className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5 text-xs">✕</span>
              <p className="text-red-700 text-sm font-medium">{error}</p>
            </div>
          </div>
        )}

        {serpResults && (
          <div className="mt-6">
            <SerpUrls results={serpResults} scrapeResults={scrapeResults} isLoading={step === 'scraping'} />
          </div>
        )}

        {analysis && (
          <div className="mt-8">
            <div className="flex items-center gap-3 mb-3">
              <ExportButtons keyword={keyword} analysis={analysis} />
              {kbConfidence && CONFIDENCE_STYLES[kbConfidence] && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded"
                  style={{ backgroundColor: CONFIDENCE_STYLES[kbConfidence].bg, color: CONFIDENCE_STYLES[kbConfidence].text }}>
                  {CONFIDENCE_STYLES[kbConfidence].label}
                </span>
              )}
            </div>
            <ResultsTable keyword={keyword} analysis={analysis} />
          </div>
        )}
      </main>
    </div>
  );
}
